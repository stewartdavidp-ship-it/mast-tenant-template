/* =========================================================
   Tenant Checkout Module
   Multi-step checkout within the cart drawer.
   Steps: Cart → Address → Shipping → Review → Confirmation
   Depends on: cart.js (MastCart), Firebase compat SDK
   ========================================================= */
(function () {
  'use strict';

  // ── State ──
  var currentStep = 'cart'; // cart | address | shipping | review | confirmation
  var checkoutData = {
    email: '',
    shipping: { name: '', address1: '', address2: '', city: '', state: '', zip: '' },
    billing: { same: true, name: '', address1: '', address2: '', city: '', state: '', zip: '' },
    shippingMethod: null,      // { key, label, description, price }
    paymentMethod: 'card',     // 'card' | 'check' — check bypasses Square for wholesale
    coupon: null,              // { code, type, value, discount } or null
    taxRate: 0,
    taxState: '',
    resaleCertNumber: '',      // wholesale: state tax resale certificate number
    walletCredits: [],         // [{ id, amountCents, ... }] active credits for this user
    walletCreditApplied: false, // whether to apply wallet credits to this order
    loyaltyConfig: null,       // { enabled, pointName, earnRate, redemptionRate, expiryDays, exclusions }
    loyaltyBalance: null,      // { totalPoints, lastEarningPurchaseAt, expiresAt }
    loyaltyApplied: false,     // whether to apply loyalty points to this order
    walletGiftCards: [],       // [{ id, code, remainingCents, ... }] active gift cards
    walletGiftCardApplied: false, // whether to apply gift cards to this order
    savedCoupons: [],          // [{ code, ... }] saved coupons from wallet
    customerPasses: [],        // [{ _id, passDefinitionId, visitsRemaining, expiresAt, status, priority, _def }] active passes with definitions
    passApplied: false,        // whether to apply class passes to this order
    passAssignments: {},        // { cartItemIndex: { passes: [{ passId, passName, visitsUsed, coversCents, surchargeCents }], totalCoveredCents, totalSurchargeCents, totalVisitsUsed } } — multi-pass support
    serverBreakdown: null,      // cached response from computeOrderBreakdown engine
    seatAttendees: {},          // { cartItemIndex: [{ email }] } — attendee emails for multi-seat class items
    membershipConfig: null,     // tenant membership config (if enabled)
    membershipStatus: null,     // customer membership status from wallet
    effectiveMember: false      // computed: active or cancelled-but-not-expired
  };

  var shippingConfigCache = null; // cached flat-rate config
  var breakdownTimer = null;      // debounce timer for engine calls
  var isSubmitting = false;
  var walletLoadedResolve = null;
  var walletLoadedPromise = new Promise(function(resolve) { walletLoadedResolve = resolve; });
  var walletLoadPending = 5;       // credits, gift cards, loyalty, passes, membership
  function walletLoadDone() { walletLoadPending--; if (walletLoadPending <= 0 && walletLoadedResolve) { walletLoadedResolve(); walletLoadedResolve = null; } }
  var placesLoaded = false;
  var placesApiKey = null;

  // ── Shipping defaults ──
  var DEFAULT_SHIPPING_CONFIG = {
    small:     { rate: 6,  boxL: 6,  boxW: 6,  boxH: 6 },
    medium:    { rate: 10, boxL: 10, boxW: 8,  boxH: 6 },
    large:     { rate: 15, boxL: 14, boxW: 12, boxH: 8 },
    oversized: { rate: 22, boxL: 20, boxW: 16, boxH: 12 },
    additionalItemSurcharge: 2,
    freeThreshold: null,
    packingBufferOz: 8
  };

  // US states for dropdown
  var US_STATES = [
    ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
    ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],
    ['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],
    ['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
    ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],
    ['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],
    ['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],
    ['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
    ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],
    ['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
    ['DC','District of Columbia']
  ];

  // ── Helpers ──
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function parsePrice(s) {
    if (typeof s === 'number') return s;
    return parseFloat(String(s).replace(/[^0-9.]/g, '')) || 0;
  }

  // Cents-native formatter. Takes integer cents, returns "$X.XX".
  // Kept as `formatMoney` (alias for cart.js's formatCents) for minimal churn.
  function formatMoney(cents) {
    var n = (typeof cents === 'number' && isFinite(cents)) ? cents : 0;
    return '$' + (n / 100).toFixed(2);
  }
  var formatCents = formatMoney;

  // Returns cart subtotal in integer cents.
  function calcSubtotal() {
    var items = window.MastCart.getItems();
    var cents = 0;
    for (var i = 0; i < items.length; i++) {
      cents += (items[i].priceCents || 0) * (items[i].qty || 1);
    }
    return cents;
  }

  // Taxable subtotal in cents, excludes gift cards (stored value, not taxable).
  function calcTaxableSubtotal() {
    var items = window.MastCart.getItems();
    var cents = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].bookingType === 'gift-card') continue;
      cents += (items[i].priceCents || 0) * (items[i].qty || 1);
    }
    return cents;
  }

  // ── Firebase helpers ──
  // Ensure MastDB is initialized before any data operation.
  // Returns true when ready, false when Firebase app isn't available yet.
  function ensureMastDB() {
    if (typeof MastDB === 'undefined') return false;
    var app = window.MastCart.getFirebaseApp();
    if (!app) return false;
    if (!MastDB.tenantId()) {
      MastDB.init({ firestore: app.firestore(), tenantId: TENANT_ID });
    }
    return !!MastDB.tenantId();
  }

  function fetchShippingConfig(callback) {
    if (shippingConfigCache) { callback(shippingConfigCache); return; }
    if (!ensureMastDB()) { callback(DEFAULT_SHIPPING_CONFIG); return; }
    MastDB.get('public/config/shippingRates').then(function (val) {
      shippingConfigCache = val || DEFAULT_SHIPPING_CONFIG;
      callback(shippingConfigCache);
    }).catch(function () { callback(DEFAULT_SHIPPING_CONFIG); });
  }

  function fetchProductShippingData(pids, callback) {
    if (!ensureMastDB() || pids.length === 0) { callback({}); return; }
    var result = {};
    var remaining = pids.length;
    for (var i = 0; i < pids.length; i++) {
      (function (pid) {
        MastDB.get('public/products/' + pid).then(function (prod) {
          if (prod) {
            result[pid] = { weightOz: prod.weightOz || 16, shippingCategory: prod.shippingCategory || 'small' };
          } else {
            result[pid] = { weightOz: 16, shippingCategory: 'small' };
          }
          remaining--;
          if (remaining === 0) callback(result);
        }).catch(function () {
          result[pid] = { weightOz: 16, shippingCategory: 'small' };
          remaining--;
          if (remaining === 0) callback(result);
        });
      })(pids[i]);
    }
  }

  function isWholesaleCart() {
    return window.MastCart && window.MastCart.hasWholesaleItems && window.MastCart.hasWholesaleItems();
  }

  // ── Shipping Rules Engine ──
  // Evaluates a strategy + modifiers rule set to calculate shipping.
  // Config can be new format (shippingRules.retail/wholesale) or legacy flat format.

  function resolveRuleSet(config, isWholesale) {
    // New format: shippingRules.retail / shippingRules.wholesale
    if (config.shippingRules) {
      var rules = config.shippingRules;
      return isWholesale && rules.wholesale ? rules.wholesale : (rules.retail || rules);
    }
    // Legacy format: convert to rule set on the fly
    if (isWholesale) {
      return {
        strategy: 'percent-of-subtotal',
        rate: config.wholesaleShippingPercent != null ? config.wholesaleShippingPercent : 10,
        modifiers: config.wholesaleFreeThreshold != null ? [{ type: 'free-above', threshold: config.wholesaleFreeThreshold }] : [{ type: 'free-above', threshold: 35000 }]
      };
    }
    // Legacy config format: rates stored as integer cents (Phase C).
    return {
      strategy: 'category-flat',
      rates: { small: (config.small || {}).rate || 600, medium: (config.medium || {}).rate || 1000, large: (config.large || {}).rate || 1500, oversized: (config.oversized || {}).rate || 2200 },
      additionalItemSurcharge: config.additionalItemSurcharge != null ? config.additionalItemSurcharge : 200,
      modifiers: config.freeThreshold != null ? [{ type: 'free-above', threshold: config.freeThreshold }] : []
    };
  }

  // Cents-native. `subtotal` is integer cents. ruleSet.rate / rates / threshold / maxRate
  // / additionalItemSurcharge are all integer cents (Phase C). Returns { price: cents, ... }.
  // `wholesaleShippingPercent` stays as a plain percent number (e.g. 10 = 10%).
  function evaluateStrategy(ruleSet, subtotal, items, productMap) {
    var strategy = ruleSet.strategy || 'category-flat';
    switch (strategy) {
      case 'free':
        return { price: 0, label: 'Free Shipping', description: 'Free shipping on all orders', category: 'free' };
      case 'flat':
        var rate = Math.round(ruleSet.rate || 0);
        return { price: rate, label: 'Flat Rate Shipping', description: formatMoney(rate) + ' flat rate', category: 'flat' };
      case 'percent-of-subtotal':
        var pct = ruleSet.rate != null ? ruleSet.rate : 10;
        var pctPrice = Math.round(subtotal * pct / 100);
        return { price: pctPrice, label: 'Standard Shipping', description: pct + '% of order subtotal', category: 'percent' };
      case 'category-flat':
      default:
        var catOrder = ['small', 'medium', 'large', 'oversized'];
        var rates = ruleSet.rates || { small: 600, medium: 1000, large: 1500, oversized: 2200 };
        var highestIdx = 0;
        var totalItems = 0;
        for (var i = 0; i < items.length; i++) {
          var ps = productMap[items[i].pid] || { shippingCategory: 'small' };
          var idx = catOrder.indexOf(ps.shippingCategory || 'small');
          if (idx > highestIdx) highestIdx = idx;
          totalItems += (items[i].qty || 1);
        }
        var cat = catOrder[highestIdx];
        var baseRate = rates[cat] != null ? rates[cat] : 600;
        var surcharge = ruleSet.additionalItemSurcharge != null ? ruleSet.additionalItemSurcharge : 200;
        var additional = Math.max(totalItems - 1, 0) * surcharge;
        var price = Math.round(baseRate + additional);
        var desc = cat.charAt(0).toUpperCase() + cat.slice(1) + ' package';
        if (totalItems > 1) desc += ' + ' + (totalItems - 1) + ' additional item' + (totalItems > 2 ? 's' : '');
        return { price: price, label: 'Standard Shipping', description: desc, category: cat };
    }
  }

  function applyModifiers(result, modifiers, subtotal) {
    if (!modifiers || !modifiers.length) return result;
    for (var i = 0; i < modifiers.length; i++) {
      var mod = modifiers[i];
      if (mod.type === 'free-above' && mod.threshold != null && subtotal >= mod.threshold) {
        return { price: 0, label: 'Free Shipping', description: 'Free shipping on orders over ' + formatMoney(mod.threshold), category: 'free' };
      }
      if (mod.type === 'cap' && mod.maxRate != null && result.price > mod.maxRate) {
        result.price = Math.round(mod.maxRate);
        result.description += ' (capped at ' + formatMoney(mod.maxRate) + ')';
      }
    }
    return result;
  }

  function getShippingThreshold() {
    if (!shippingConfigCache) return null;
    var ruleSet = resolveRuleSet(shippingConfigCache, isWholesaleCart());
    var modifiers = ruleSet.modifiers || [];
    for (var i = 0; i < modifiers.length; i++) {
      if (modifiers[i].type === 'free-above') return modifiers[i].threshold;
    }
    if (ruleSet.strategy === 'free') return 0;
    return null;
  }

  function calculateShipping(items, productMap, config) {
    var subtotal = calcSubtotal();
    var ws = isWholesaleCart();
    var ruleSet = resolveRuleSet(config, ws);
    var result = evaluateStrategy(ruleSet, subtotal, items, productMap);
    return applyModifiers(result, ruleSet.modifiers, subtotal);
  }

  function fetchTaxRate(state, callback) {
    if (!ensureMastDB() || !state) { callback(0); return; }
    MastDB.get('public/taxRates/' + state.toUpperCase()).then(function (val) {
      callback(val || 0);
    }).catch(function () { callback(0); });
  }

  // Ensure we have at least anonymous auth for secure Cloud Function calls
  function ensureAuth() {
    var app = window.MastCart.getFirebaseApp();
    if (!app) return Promise.reject(new Error('Firebase not available'));
    var auth = app.auth();
    if (auth.currentUser) return auth.currentUser.getIdToken();
    return auth.signInAnonymously().then(function(cred) {
      return cred.user.getIdToken();
    });
  }

  function callFunction(name, data, callback) {
    var app = window.MastCart.getFirebaseApp();
    if (!app) { callback({ success: false, error: 'Firebase not available' }); return; }

    // Get auth token before calling Cloud Function
    // Derive Cloud Functions base URL from shared tenant config
    var cfBase = (typeof TENANT_FIREBASE_CONFIG !== 'undefined' && TENANT_FIREBASE_CONFIG.cloudFunctionsBase)
      ? TENANT_FIREBASE_CONFIG.cloudFunctionsBase
      : 'https://us-central1-' + ((app.options && app.options.projectId) || 'unknown') + '.cloudfunctions.net';
    var url = cfBase + '/' + name;

    ensureAuth().then(function(token) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        try {
          var resp = JSON.parse(xhr.responseText);
          // Firebase callable wraps result in { result: ... }
          callback(resp.result || resp);
        } catch (e) {
          callback({ success: false, error: 'Network error' });
        }
      };
      xhr.onerror = function () {
        callback({ success: false, error: 'Network error' });
      };
      data = data || {};
      data.tenantId = TENANT_ID;
      xhr.send(JSON.stringify({ data: data }));
    }).catch(function(err) {
      callback({ success: false, error: 'Authentication failed: ' + err.message });
    });
  }

  // ── Wallet Deductions Payload (shared by engine call + submitOrder) ──
  function buildWalletDeductionsPayload() {
    if (!checkoutData.passApplied && !checkoutData.loyaltyApplied && !checkoutData.walletGiftCardApplied && !checkoutData.walletCreditApplied) {
      return null;
    }
    var wd = {};
    if (checkoutData.passApplied && Object.keys(checkoutData.passAssignments).length > 0) {
      wd.passes = Object.keys(checkoutData.passAssignments).map(function(idx) {
        var a = checkoutData.passAssignments[idx];
        return {
          itemIndex: parseInt(idx, 10),
          passes: a.passes,
          totalCoversCents: a.totalCoveredCents,
          totalSurchargeCents: a.totalSurchargeCents,
          totalVisitsUsed: a.totalVisitsUsed
        };
      });
    }
    if (checkoutData.loyaltyApplied && checkoutData.loyaltyBalance && checkoutData.loyaltyConfig) {
      wd.loyalty = {
        pointsToRedeem: checkoutData.loyaltyBalance.totalPoints || 0,
        amountCents: calcLoyaltyRedemptionCents()
      };
    }
    if (checkoutData.walletGiftCardApplied && checkoutData.walletGiftCards.length > 0) {
      wd.giftCards = checkoutData.walletGiftCards.map(function(g) {
        return { id: g._id || g.id, code: g.code || '', amountCents: g.remainingCents || 0 };
      });
    }
    if (checkoutData.walletCreditApplied && checkoutData.walletCredits.length > 0) {
      wd.credits = checkoutData.walletCredits.map(function(c) {
        return { id: c._id || c.id, amountCents: c.remainingCents != null ? c.remainingCents : (c.amountCents || 0) };
      });
    }
    return Object.keys(wd).length > 0 ? wd : null;
  }

  // ── Order Breakdown Engine Call (with 1 retry) ──
  function callBreakdownEngine(callback) {
    var items = window.MastCart.getItems();
    var user = window.MastCart.getCurrentUser();
    var payload = {
      items: items.map(function(it) {
        var mapped = { pid: it.pid, name: it.name, options: it.options, priceCents: it.priceCents || 0, qty: it.qty, isWholesale: it.isWholesale || false };
        if (it.variantId) mapped.variantId = it.variantId;
        if (it.bookingType) mapped.bookingType = it.bookingType;
        if (it.classId) mapped.classId = it.classId;
        if (it.sessionId) mapped.sessionId = it.sessionId;
        if (it.shippingCategory) mapped.shippingCategory = it.shippingCategory;
        if (it.totalSessions) mapped.totalSessions = it.totalSessions;
        return mapped;
      }),
      shipping: checkoutData.shipping,
      uid: user ? user.uid : 'anonymous',
      isWholesale: isWholesaleCart(),
      couponCode: checkoutData.coupon ? checkoutData.coupon.code : null,
      walletDeductions: buildWalletDeductionsPayload()
    };
    function attempt(retryCount) {
      callFunction('computeOrderBreakdown', payload, function(result) {
        if (result && result.success && result.breakdown) {
          checkoutData.serverBreakdown = result.breakdown;
          callback(result.breakdown);
        } else if (retryCount > 0) {
          console.warn('Order engine failed, retrying...', result && result.error ? result.error : '');
          setTimeout(function() { attempt(retryCount - 1); }, 1500);
        } else {
          console.error('Order engine failed after retry:', result && result.error ? result.error : 'Unknown error');
          callback(null);
        }
      });
    }
    attempt(1);
  }

  // ── Error display when engine fails (no client-side fallback) ──
  function buildTotalsErrorHtml() {
    return '<div class="order-totals" style="text-align:center;padding:16px;">' +
      '<div style="color:var(--error-red, #E53935);font-size:0.9rem;margin-bottom:8px;">Unable to calculate order totals</div>' +
      '<button class="checkout-btn-secondary" style="font-size:0.82rem;padding:6px 16px;" onclick="window.MastCheckout.retryEngine()">Try Again</button>' +
    '</div>';
  }

  // ── Debounced engine call for wallet toggles ──
  function debouncedBreakdownRefresh() {
    if (breakdownTimer) clearTimeout(breakdownTimer);
    // Show loading indicator immediately
    var container = document.querySelector('.order-totals');
    if (container) {
      container.style.opacity = '0.5';
      container.style.pointerEvents = 'none';
    }
    breakdownTimer = setTimeout(function() {
      callBreakdownEngine(function(breakdown) {
        var totalsContainer = document.querySelector('.engine-totals-container');
        if (totalsContainer) {
          if (breakdown) {
            totalsContainer.innerHTML = buildTotalsFromBreakdown(breakdown);
            syncCouponMessage(breakdown);
          } else {
            totalsContainer.innerHTML = buildTotalsErrorHtml();
          }
        }
      });
    }, 300);
  }

  // ── Update coupon message to reflect engine-computed discount ──
  function syncCouponMessage(breakdown) {
    if (!breakdown || !checkoutData.coupon) return;
    var msgEl = document.getElementById('coCouponMsg');
    if (!msgEl) return;
    if (breakdown.couponDiscountCents > 0) {
      msgEl.innerHTML = '<div class="coupon-success">Coupon ' + esc(checkoutData.coupon.code) +
        ' applied: -' + formatMoney(breakdown.couponDiscountCents) + '</div>';
    } else if (breakdown.couponData && breakdown.couponData.code) {
      // Coupon recognized but $0 discount (e.g. all items non-discountable)
      msgEl.innerHTML = '<div class="coupon-success">Coupon ' + esc(checkoutData.coupon.code) +
        ' applied (no eligible items)</div>';
    }
  }

  // ── Step Indicator HTML ──
  function stepIndicatorHtml(active) {
    var steps = [
      { num: 1, label: 'Address', key: 'address' },
      { num: 2, label: 'Shipping', key: 'shipping' },
      { num: 3, label: 'Review', key: 'review' }
    ];
    var stepOrder = ['address', 'shipping', 'review'];
    var activeIdx = stepOrder.indexOf(active);

    var html = '<div class="checkout-steps">';
    for (var i = 0; i < steps.length; i++) {
      var cls = '';
      if (i < activeIdx) cls = 'completed';
      else if (i === activeIdx) cls = 'active';

      if (i > 0) html += '<span class="checkout-step-arrow">&#8250;</span>';
      html += '<div class="checkout-step ' + cls + '">' +
        '<span class="checkout-step-num">' + (i < activeIdx ? '&#10003;' : steps[i].num) + '</span>' +
        '<span>' + steps[i].label + '</span>' +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  // ── State Dropdown Options ──
  function stateOptionsHtml(selected) {
    var html = '<option value="">Select State</option>';
    for (var i = 0; i < US_STATES.length; i++) {
      var sel = selected === US_STATES[i][0] ? ' selected' : '';
      html += '<option value="' + US_STATES[i][0] + '"' + sel + '>' + esc(US_STATES[i][1]) + '</option>';
    }
    return html;
  }

  // ── Address Form HTML ──
  function addressFormHtml(prefix, data) {
    return '<div class="checkout-form-group">' +
      '<label class="checkout-label" for="' + prefix + 'Name">Full Name</label>' +
      '<input class="checkout-input" id="' + prefix + 'Name" type="text" value="' + esc(data.name) + '" autocomplete="name">' +
    '</div>' +
    '<div class="checkout-form-group">' +
      '<label class="checkout-label" for="' + prefix + 'Addr1">Address</label>' +
      '<input class="checkout-input" id="' + prefix + 'Addr1" type="text" value="' + esc(data.address1) + '" placeholder="Street address" autocomplete="address-line1">' +
    '</div>' +
    '<div class="checkout-form-group">' +
      '<input class="checkout-input" id="' + prefix + 'Addr2" type="text" value="' + esc(data.address2) + '" placeholder="Apt, suite, unit (optional)" autocomplete="address-line2">' +
    '</div>' +
    '<div class="checkout-row">' +
      '<div class="checkout-form-group">' +
        '<label class="checkout-label" for="' + prefix + 'City">City</label>' +
        '<input class="checkout-input" id="' + prefix + 'City" type="text" value="' + esc(data.city) + '" autocomplete="address-level2">' +
      '</div>' +
      '<div class="checkout-form-group state">' +
        '<label class="checkout-label" for="' + prefix + 'State">State</label>' +
        '<select class="checkout-select" id="' + prefix + 'State" autocomplete="address-level1">' +
          stateOptionsHtml(data.state) +
        '</select>' +
      '</div>' +
      '<div class="checkout-form-group small">' +
        '<label class="checkout-label" for="' + prefix + 'Zip">ZIP</label>' +
        '<input class="checkout-input" id="' + prefix + 'Zip" type="text" value="' + esc(data.zip) + '" maxlength="10" autocomplete="postal-code">' +
      '</div>' +
    '</div>';
  }

  // ── Render: Address Step ──
  function renderAddress() {
    currentStep = 'address';
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body || !footer) return;

    // Update header
    var titleEl = document.querySelector('.cart-drawer-title');
    var countEl = document.getElementById('cartDrawerCount');
    if (titleEl) titleEl.textContent = 'Checkout';
    if (countEl) countEl.textContent = '';

    var html = stepIndicatorHtml('address');

    // Email
    html += '<div class="checkout-section">' +
      '<div class="checkout-section-title">Contact</div>' +
      '<div class="checkout-form-group">' +
        '<label class="checkout-label" for="coEmail">Email</label>' +
        '<input class="checkout-input" id="coEmail" type="email" value="' + esc(checkoutData.email) + '" placeholder="For order confirmation" autocomplete="email">' +
      '</div>' +
    '</div>';

    // Shipping address
    html += '<div class="checkout-section">' +
      '<div class="checkout-section-title">Shipping Address</div>' +
      addressFormHtml('ship', checkoutData.shipping) +
    '</div>';

    // Billing
    html += '<div class="checkout-section">' +
      '<label class="checkout-checkbox">' +
        '<input type="checkbox" id="billingSame"' + (checkoutData.billing.same ? ' checked' : '') + '>' +
        'Billing address same as shipping' +
      '</label>' +
      '<div id="billingFields" style="' + (checkoutData.billing.same ? 'display:none' : '') + '">' +
        '<div class="checkout-section-title" style="margin-top:12px;">Billing Address</div>' +
        addressFormHtml('bill', checkoutData.billing) +
      '</div>' +
    '</div>';

    // Resale certificate field (wholesale only)
    if (isWholesaleCart()) {
      html += '<div class="checkout-section">' +
        '<div class="checkout-section-title">Tax Exemption</div>' +
        '<div class="checkout-form-group">' +
          '<label class="checkout-label" for="coResaleCert">State Tax Resale Certificate #</label>' +
          '<input class="checkout-input" id="coResaleCert" type="text" value="' + esc(checkoutData.resaleCertNumber) + '" placeholder="Required for tax-exempt wholesale orders">' +
        '</div>' +
        '<div style="font-size:0.75rem;color:var(--warm-gray,#9B958E);margin-top:4px;">Provide your resale certificate number for tax-exempt status.</div>' +
      '</div>';
    }

    // Free shipping reminder on address step (only if threshold is configured)
    var addrSubtotalCents = calcSubtotal();
    var addrFreeThresholdCents = getShippingThreshold();
    if (addrFreeThresholdCents != null) {
      if (addrSubtotalCents >= addrFreeThresholdCents) {
        html += '<div style="text-align:center;color:#2D7D46;font-size:0.75rem;margin:12px 0 4px;letter-spacing:0.08em;">&#10003; FREE SHIPPING on this order!</div>';
      } else if (addrSubtotalCents > 0) {
        html += '<div style="text-align:center;color:var(--warm-gray,#9B958E);font-size:0.75rem;margin:12px 0 4px;letter-spacing:0.08em;">You\'re ' + formatMoney(addrFreeThresholdCents - addrSubtotalCents) + ' away from free shipping!</div>';
      }
    }

    body.innerHTML = html;

    // Test mode banner
    checkTestMode(function (isSandbox) {
      if (isSandbox) showTestBanner(body);
    });

    // Attach Google Places autocomplete if loaded
    attachPlacesAutocomplete();

    // Footer
    footer.style.display = '';
    footer.innerHTML =
      '<button class="checkout-btn-primary" data-co="addr-next">' + (window.MastCart && window.MastCart.isNonShippableCart() ? 'Continue to Review' : 'Continue to Shipping') + '</button>' +
      '<button class="checkout-back-link" data-co="addr-back">Back to Cart</button>';

    // Billing same checkbox (only element needing change listener)
    document.getElementById('billingSame').addEventListener('change', function () {
      checkoutData.billing.same = this.checked;
      document.getElementById('billingFields').style.display = this.checked ? 'none' : '';
    });

    // Auto-save email on change so it persists for returning customers
    var coEmailEl = document.getElementById('coEmail');
    if (coEmailEl) {
      coEmailEl.addEventListener('change', function () {
        checkoutData.email = this.value.trim();
        try {
          var existing = JSON.parse(localStorage.getItem('mast_checkout_info') || '{}');
          existing.email = checkoutData.email;
          localStorage.setItem('mast_checkout_info', JSON.stringify(existing));
        } catch (e) { /* private browsing */ }
      });
    }

    // Pre-fill from logged-in user (Google auth)
    if (window.MastCart && window.MastCart.getCurrentUser) {
      var authUser = window.MastCart.getCurrentUser();
      if (authUser) {
        if (!checkoutData.email && authUser.email) {
          checkoutData.email = authUser.email;
          var authEml = document.getElementById('coEmail');
          if (authEml) {
            authEml.value = authUser.email;
            authEml.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        if (!checkoutData.shipping.name && authUser.displayName) {
          checkoutData.shipping.name = authUser.displayName;
          var authName = document.getElementById('shipName');
          if (authName) {
            authName.value = authUser.displayName;
            authName.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        // Load saved address + optional wholesale resale cert via CF
        // (accounts/{uid} and admin/wholesaleAuthorized are admin-only).
        if (!authUser.isAnonymous) {
          var includeCert = isWholesaleCart() && !!authUser.email;
          callFunction('upsertCustomerAccount', {
            action: 'get',
            includeResaleCert: includeCert,
            email: includeCert ? authUser.email : undefined
          }, function(resp) {
            if (!resp || resp.success === false) return;
            var addr = resp.address;
            if (addr && addr.address1) {
              // Server truth wins over localStorage for signed-in users — overwrite.
              var addrMap = { address1: 'shipAddr1', address2: 'shipAddr2', city: 'shipCity', state: 'shipState', zip: 'shipZip' };
              var filled = false;
              for (var aKey in addrMap) {
                if (addr[aKey]) {
                  checkoutData.shipping[aKey] = addr[aKey];
                  var aEl = document.getElementById(addrMap[aKey]);
                  var isPac = false;
                  if (!aEl && aKey === 'address1') {
                    aEl = document.getElementById('shipAddr1Pac');
                    isPac = true;
                  }
                  if (aEl) {
                    aEl.value = addr[aKey];
                    // PAC web component renders from the value attribute — set both.
                    if (isPac) aEl.setAttribute('value', addr[aKey]);
                    aEl.dispatchEvent(new Event('input', { bubbles: true }));
                    aEl.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                  if (aKey === 'address1') filled = true;
                }
              }
              if (filled) setTimeout(function () { checkoutData._addressValidated = true; }, 0);
            }
            if (resp.resaleCertNumber && !checkoutData.resaleCertNumber) {
              checkoutData.resaleCertNumber = resp.resaleCertNumber;
              var certEl = document.getElementById('coResaleCert');
              if (certEl) certEl.value = resp.resaleCertNumber;
            }
          });
        }
      }
    }

    // Restore saved checkout info from localStorage (fills remaining fields)
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('mast_checkout_info')); } catch (e) { /* ignore */ }
    if (saved) {
      if (saved.email && !checkoutData.email) {
        checkoutData.email = saved.email;
        var eml = document.getElementById('coEmail');
        if (eml) {
          eml.value = saved.email;
          eml.dispatchEvent(new Event('input', { bubbles: true }));
          eml.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      if (saved.shipping) {
        var shipMap = { name: 'shipName', address1: 'shipAddr1', address2: 'shipAddr2', city: 'shipCity', state: 'shipState', zip: 'shipZip' };
        var restoredAddr = false;
        for (var sKey in shipMap) {
          if (saved.shipping[sKey] && !checkoutData.shipping[sKey]) {
            checkoutData.shipping[sKey] = saved.shipping[sKey];
            var sEl = document.getElementById(shipMap[sKey]);
            // PAC element replaces shipAddr1
            if (!sEl && sKey === 'address1') sEl = document.getElementById('shipAddr1Pac');
            if (sEl) {
              sEl.value = saved.shipping[sKey];
              sEl.dispatchEvent(new Event('input', { bubbles: true }));
              sEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (sKey === 'address1') restoredAddr = true;
          }
        }
        // Trust address from a previous order — skip Places validation gate
        // Use setTimeout to ensure this runs after any input listeners triggered by value restore
        if (restoredAddr) setTimeout(function () { checkoutData._addressValidated = true; }, 0);
      }
      if (saved.billing && !saved.billing.same) {
        var cb = document.getElementById('billingSame');
        if (cb && cb.checked) {
          cb.checked = false;
          cb.dispatchEvent(new Event('change'));
        }
        checkoutData.billing.same = false;
        // Fill billing fields after the section becomes visible
        setTimeout(function () {
          var billMap = { name: 'billName', address1: 'billAddr1', address2: 'billAddr2', city: 'billCity', state: 'billState', zip: 'billZip' };
          for (var bKey in billMap) {
            if (saved.billing[bKey] && !checkoutData.billing[bKey]) {
              checkoutData.billing[bKey] = saved.billing[bKey];
              var bEl = document.getElementById(billMap[bKey]);
              if (bEl) {
                bEl.value = saved.billing[bKey];
                bEl.dispatchEvent(new Event('input', { bubbles: true }));
                bEl.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }
        }, 50);
      }
    }
  }

  function saveAddressData() {
    var email = document.getElementById('coEmail');
    if (email) checkoutData.email = email.value.trim();

    var fields = ['Name', 'Addr1', 'Addr2', 'City', 'State', 'Zip'];
    for (var i = 0; i < fields.length; i++) {
      var shipEl = document.getElementById('ship' + fields[i]);
      var isPac = false;
      // PlaceAutocompleteElement replaces shipAddr1 with shipAddr1Pac
      if (!shipEl && fields[i] === 'Addr1') { shipEl = document.getElementById('shipAddr1Pac'); isPac = true; }
      if (shipEl) {
        var key = fields[i] === 'Addr1' ? 'address1' : fields[i] === 'Addr2' ? 'address2' : fields[i].toLowerCase();
        // PAC element .value is the full formatted place string, not the street address.
        // fillAddressFromPlace already wrote the parsed street to checkoutData — don't overwrite.
        if (isPac) {
          if (!checkoutData.shipping[key]) checkoutData.shipping[key] = (shipEl.value || '').trim();
        } else {
          checkoutData.shipping[key] = shipEl.value.trim();
        }
      }
    }

    checkoutData.billing.same = document.getElementById('billingSame') ? document.getElementById('billingSame').checked : true;
    if (!checkoutData.billing.same) {
      for (var j = 0; j < fields.length; j++) {
        var billEl = document.getElementById('bill' + fields[j]);
        if (billEl) {
          var bkey = fields[j] === 'Addr1' ? 'address1' : fields[j] === 'Addr2' ? 'address2' : fields[j].toLowerCase();
          checkoutData.billing[bkey] = billEl.value.trim();
        }
      }
    }

    // Capture resale cert for wholesale
    var certEl = document.getElementById('coResaleCert');
    if (certEl) checkoutData.resaleCertNumber = certEl.value.trim();

    // Persist to localStorage so returning users don't re-enter
    try {
      localStorage.setItem('mast_checkout_info', JSON.stringify({
        email: checkoutData.email,
        shipping: checkoutData.shipping,
        billing: checkoutData.billing
      }));
    } catch (e) { /* private browsing may block localStorage */ }
  }

  function validateAddress() {
    var valid = true;
    // Clear old errors
    var olds = document.querySelectorAll('.checkout-error-msg');
    for (var k = 0; k < olds.length; k++) olds[k].remove();
    var oldInputs = document.querySelectorAll('.checkout-input.error');
    for (var l = 0; l < oldInputs.length; l++) oldInputs[l].classList.remove('error');

    function check(id, msg) {
      var el = document.getElementById(id);
      if (!el) return true;
      var val = el.value.trim();
      if (!val) {
        el.classList.add('error');
        var err = document.createElement('div');
        err.className = 'checkout-error-msg';
        err.textContent = msg;
        el.parentNode.appendChild(err);
        if (valid) el.focus();
        valid = false;
        return false;
      }
      return true;
    }

    // Email – regex validates format: no spaces, has @, has domain with dot
    var emailEl = document.getElementById('coEmail');
    if (emailEl) {
      var emailVal = emailEl.value.trim();
      var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailVal || !emailRegex.test(emailVal)) {
        emailEl.classList.add('error');
        var errE = document.createElement('div');
        errE.className = 'checkout-error-msg';
        errE.textContent = 'Valid email required';
        emailEl.parentNode.appendChild(errE);
        if (valid) emailEl.focus();
        valid = false;
      }
    }

    check('shipName', 'Name required');
    // PlaceAutocompleteElement replaces shipAddr1 with shipAddr1Pac
    if (!document.getElementById('shipAddr1')) {
      check('shipAddr1Pac', 'Address required');
    } else {
      check('shipAddr1', 'Address required');
    }
    check('shipCity', 'City required');
    check('shipState', 'State required');
    check('shipZip', 'ZIP code required');

    // Billing if not same
    var sameCb = document.getElementById('billingSame');
    if (sameCb && !sameCb.checked) {
      check('billName', 'Name required');
      check('billAddr1', 'Address required');
      check('billCity', 'City required');
      check('billState', 'State required');
      check('billZip', 'ZIP code required');
    }

    // Google Places address validation (soft gate)
    if (valid && placesLoaded && !checkoutData._addressValidated) {
      if (!checkoutData._addressValidateAttempts) {
        checkoutData._addressValidateAttempts = 1;
        var addrEl = document.getElementById('shipAddr1') || document.getElementById('shipAddr1Pac');
        if (addrEl) {
          addrEl.classList.add('error');
          var warnDiv = document.createElement('div');
          warnDiv.className = 'checkout-error-msg';
          warnDiv.style.color = '#B3742E';
          warnDiv.textContent = 'Please select an address from the dropdown to validate. Click Continue again to skip.';
          addrEl.parentNode.appendChild(warnDiv);
          try { addrEl.focus(); } catch(e) {}
        }
        valid = false;
      } else {
        // Second attempt — let them through
        checkoutData._addressValidateAttempts = 0;
      }
    }

    return valid;
  }

  // ── Render: Shipping Step ──
  function renderShipping() {
    currentStep = 'shipping';
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body || !footer) return;

    body.innerHTML = stepIndicatorHtml('shipping') +
      '<div class="checkout-section"><div style="text-align:center;color:#9B958E;padding:2rem 0;">Calculating shipping...</div></div>';

    var items = window.MastCart.getItems();
    var pids = [];
    for (var i = 0; i < items.length; i++) {
      if (pids.indexOf(items[i].pid) === -1) pids.push(items[i].pid);
    }

    // Fetch product shipping data, shipping config, tax, and wait for wallet in parallel
    fetchProductShippingData(pids, function (productMap) {
      fetchShippingConfig(function (config) {
        fetchTaxRate(checkoutData.shipping.state, function (rate) {
          // Wait for wallet data before rendering (prevents missing toggles on fast address fill)
          walletLoadedPromise.then(function() {
          // Wholesale orders: no tax (buyers provide resale certificate)
          checkoutData.taxRate = isWholesaleCart() ? 0 : rate;
          checkoutData.taxState = checkoutData.shipping.state;

          // Store for CSV generation later
          checkoutData.itemShippingData = productMap;
          checkoutData.shippingConfig = config;

          // Filter to shippable items only (exclude classes, passes, gift cards, etc.)
          var shippableItems = items.filter(function(it) {
            var meta = window.MastCart.getItemMetadata
              ? window.MastCart.getItemMetadata(window.MastCart.resolveItemType(it), it._metaOverrides || null)
              : null;
            return meta ? meta.requiresShipping : !it.bookingType;
          });

          // Calculate flat-rate shipping
          var shipResult = calculateShipping(shippableItems, productMap, config);
          checkoutData.shippingMethod = {
            key: 'calculated',
            label: shipResult.label,
            description: shipResult.description,
            price: shipResult.price
          };

          var subtotalCents = calcSubtotal();
          var html = stepIndicatorHtml('shipping');

          // Display calculated shipping (single line, no radio options)
          html += '<div class="checkout-section">' +
            '<div class="checkout-section-title">Shipping</div>' +
            '<div class="shipping-option selected" style="cursor:default;">' +
              '<div class="shipping-option-details">' +
                '<div class="shipping-option-label">' + esc(shipResult.label) + '</div>' +
                '<div class="shipping-option-desc">' + esc(shipResult.description) + '</div>' +
              '</div>' +
              '<div class="shipping-option-price">' + (shipResult.price === 0 ? 'FREE' : formatMoney(shipResult.price)) + '</div>' +
            '</div>' +
          '</div>';

          // Coupon
          html += '<div class="checkout-section">' +
            '<div class="checkout-section-title">Coupon Code</div>' +
            '<div class="coupon-row">' +
              '<input class="checkout-input" id="coCouponInput" type="text" placeholder="Enter code" value="' +
                (checkoutData.coupon ? esc(checkoutData.coupon.code) : '') + '">' +
              '<button class="coupon-apply-btn" data-co="apply-coupon">Apply</button>' +
            '</div>' +
            '<div id="coCouponMsg"></div>';

          // Saved wallet coupons as clickable chips
          if (checkoutData.savedCoupons.length > 0 && !checkoutData.coupon) {
            html += '<div id="coSavedCoupons" style="margin-top:8px;">' +
              '<div style="font-size:0.78rem;color:var(--warm-gray,#6B6560);margin-bottom:6px;">\uD83D\uDCB3 Saved coupons:</div>' +
              '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
            for (var sci = 0; sci < checkoutData.savedCoupons.length; sci++) {
              var sc = checkoutData.savedCoupons[sci];
              var scLabel = esc(sc.code) + ' \u2014 ' + (sc.type === 'percent' ? sc.value + '% off' : '$' + (sc.value || 0).toFixed(2) + ' off');
              html += '<button data-coupon-code="' + esc(sc.code) + '" data-co="apply-wallet-coupon" ' +
                'style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;font-size:0.8rem;font-family:\'DM Sans\',sans-serif;' +
                'background:rgba(42,124,111,0.06);color:var(--teal,#2A7C6F);border:1px dashed rgba(42,124,111,0.3);border-radius:6px;cursor:pointer;transition:all 0.15s;">' +
                '\uD83C\uDFF7\uFE0F ' + scLabel +
              '</button>';
            }
            html += '</div></div>';
          }

          html += '</div>';

          // ── Wallet Deductions (order: Passes → Coupons → Loyalty → Gift Cards → Credits) ──
          var hasAnyWalletInstrument = checkoutData.walletCredits.length > 0 ||
            checkoutData.walletGiftCards.length > 0 ||
            (checkoutData.loyaltyConfig && checkoutData.loyaltyConfig.enabled && checkoutData.loyaltyBalance && checkoutData.loyaltyBalance.totalPoints > 0) ||
            (checkoutData.customerPasses.length > 0 && Object.keys(checkoutData.passAssignments).length > 0);

          if (hasAnyWalletInstrument) {
            html += '<div class="checkout-section">' +
              '<div class="checkout-section-title">Wallet Deductions</div>';

            var sRunning = subtotalCents;
            var sCouponCents = checkoutData.coupon ? Math.round((checkoutData.coupon.discount || 0) * 100) : 0;

            // Class passes (1st in priority)
            if (checkoutData.customerPasses.length > 0 && Object.keys(checkoutData.passAssignments).length > 0) {
              var passCoversCents = 0;
              var passVisitsUsed = 0;
              var uniquePassIds = {};
              Object.keys(checkoutData.passAssignments).forEach(function(idx) {
                var a = checkoutData.passAssignments[idx];
                passCoversCents += a.totalCoveredCents || 0;
                passVisitsUsed += a.totalVisitsUsed || 0;
                (a.passes || []).forEach(function(p) { uniquePassIds[p.passId] = true; });
              });
              var passCount = Object.keys(uniquePassIds).length;
              var passLabel = passCount > 1
                ? '&#127915; Use class passes (' + passVisitsUsed + ' visit' + (passVisitsUsed !== 1 ? 's' : '') + ' across ' + passCount + ' passes, ' + formatMoney(passCoversCents) + ' off)'
                : '&#127915; Use class pass (' + passVisitsUsed + ' visit' + (passVisitsUsed !== 1 ? 's' : '') + ', ' + formatMoney(passCoversCents) + ' off)';
              html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;color:var(--text);margin-bottom:8px;">' +
                '<input type="checkbox" id="coPassToggle" ' + (checkoutData.passApplied ? 'checked' : '') + ' data-co="toggle-pass">' +
                passLabel +
              '</label>';
              if (checkoutData.passApplied) sRunning -= passCoversCents;
            }
            sRunning -= sCouponCents;
            sRunning = Math.max(0, sRunning);

            // Loyalty (2nd in priority)
            if (checkoutData.loyaltyConfig && checkoutData.loyaltyConfig.enabled && checkoutData.loyaltyBalance && checkoutData.loyaltyBalance.totalPoints > 0) {
              var lc = checkoutData.loyaltyConfig;
              var lb = checkoutData.loyaltyBalance;
              var loyaltyValueCents = Math.round((lb.totalPoints / lc.redemptionRate) * 100);
              var sLoyDis = sRunning <= 0;
              html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;color:var(--text);margin-bottom:8px;' + (sLoyDis ? 'opacity:0.4;' : '') + '">' +
                '<input type="checkbox" id="coLoyaltyToggle" ' + (checkoutData.loyaltyApplied && !sLoyDis ? 'checked' : '') + (sLoyDis ? ' disabled' : '') + ' data-co="toggle-loyalty">' +
                '&#11088; Apply ' + lb.totalPoints + ' ' + esc(lc.pointName) + ' (' + formatMoney(loyaltyValueCents) + ' off)' +
                (sLoyDis ? ' <span style="font-size:0.75rem;color:var(--warm-gray);">— already covered</span>' : '') +
              '</label>';
              if (checkoutData.loyaltyApplied && !sLoyDis) sRunning -= Math.min(loyaltyValueCents, sRunning);
            }

            // Gift Cards (3rd in priority)
            if (checkoutData.walletGiftCards.length > 0) {
              var totalGcCents = checkoutData.walletGiftCards.reduce(function(sum, g) { return sum + (g.remainingCents || 0); }, 0);
              var sGcDis = sRunning <= 0;
              html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;color:var(--text);margin-bottom:8px;' + (sGcDis ? 'opacity:0.4;' : '') + '">' +
                '<input type="checkbox" id="coGiftCardToggle" ' + (checkoutData.walletGiftCardApplied && !sGcDis ? 'checked' : '') + (sGcDis ? ' disabled' : '') + ' data-co="toggle-giftcard">' +
                '&#127873; Apply gift cards (' + formatMoney(totalGcCents) + ' available)' +
                (sGcDis ? ' <span style="font-size:0.75rem;color:var(--warm-gray);">— already covered</span>' : '') +
              '</label>';
              if (checkoutData.walletGiftCardApplied && !sGcDis) sRunning -= Math.min(totalGcCents, sRunning);
            }

            // Credits (4th, last priority)
            if (checkoutData.walletCredits.length > 0) {
              var totalCreditCents = checkoutData.walletCredits.reduce(function(sum, c) { return sum + (c.remainingCents != null ? c.remainingCents : (c.amountCents || 0)); }, 0);
              var sCrDis = sRunning <= 0;
              html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;color:var(--text);margin-bottom:4px;' + (sCrDis ? 'opacity:0.4;' : '') + '">' +
                '<input type="checkbox" id="coWalletToggle" ' + (checkoutData.walletCreditApplied && !sCrDis ? 'checked' : '') + (sCrDis ? ' disabled' : '') + ' data-co="toggle-wallet">' +
                '&#128179; Apply store credits (' + formatMoney(totalCreditCents) + ' available)' +
                (sCrDis ? ' <span style="font-size:0.75rem;color:var(--warm-gray);">— already covered</span>' : '') +
              '</label>';
            }

            html += '<div style="font-size:0.75rem;color:var(--warm-gray-light);margin-top:6px;">Deductions applied in order: passes \u2192 coupons \u2192 loyalty \u2192 gift cards \u2192 credits</div>' +
              '</div>';
          }

          // Totals — loading placeholder, then engine call
          html += '<div class="checkout-section engine-totals-container">' + buildTotalsLoadingHtml() + '</div>';

          body.innerHTML = html;

          // Show existing coupon if any
          if (checkoutData.coupon) {
            var msgEl = document.getElementById('coCouponMsg');
            if (msgEl) {
              msgEl.innerHTML = '<div class="coupon-success">Coupon ' + esc(checkoutData.coupon.code) +
                ' applied: -' + formatMoney(Math.round((checkoutData.coupon.discount || 0) * 100)) + '</div>';
            }
          }

          // Call engine for server-computed totals
          callBreakdownEngine(function(breakdown) {
            var tc = document.querySelector('.engine-totals-container');
            if (tc) {
              tc.innerHTML = breakdown ? buildTotalsFromBreakdown(breakdown) : buildTotalsErrorHtml();
            }
            if (breakdown) syncCouponMessage(breakdown);
          });
          }); // walletLoadedPromise.then
        });
      });
    });

    // Footer
    footer.style.display = '';
    footer.innerHTML =
      '<button class="checkout-btn-primary" data-co="ship-next">Continue to Review</button>' +
      '<button class="checkout-back-link" data-co="ship-back">Back to Address</button>';
  }

  function applyCoupon() {
    var input = document.getElementById('coCouponInput');
    var msgEl = document.getElementById('coCouponMsg');
    var btn = document.querySelector('[data-co="apply-coupon"]');
    if (!input || !msgEl) return;

    var code = input.value.trim().toUpperCase();
    if (!code) {
      // Clear coupon
      checkoutData.coupon = null;
      msgEl.innerHTML = '';
      debouncedBreakdownRefresh();
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    // validateCoupon Cloud Function still expects dollars in subtotal and returns
    // discount in dollars (not cents-converted). Convert for the call.
    callFunction('validateCoupon', { code: code, subtotal: calcSubtotal() / 100 }, function (result) {
      if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }

      if (result && result.valid) {
        checkoutData.coupon = {
          code: code,
          type: result.type,
          value: result.value,
          discount: result.discount
        };
        msgEl.innerHTML = '<div class="coupon-success">Coupon ' + esc(code) +
          ' applied: -' + formatMoney(Math.round((result.discount || 0) * 100)) + '</div>';
      } else {
        checkoutData.coupon = null;
        msgEl.innerHTML = '<div class="coupon-error">' + esc(result && result.reason ? result.reason : 'Invalid coupon') + '</div>';
      }
      debouncedBreakdownRefresh();
    });
  }

  // ── Build Totals from Server Breakdown (pure renderer, no math) ──
  function buildTotalsFromBreakdown(b) {
    var html = '<div class="order-totals">';
    html += '<div class="order-total-row"><span class="order-total-label">Subtotal</span><span class="order-total-value">' + formatMoney(b.preDiscountSubtotalCents || b.subtotalCents) + '</span></div>';

    // Sale discounts — server entry has saleId, saleName, pid, originalPriceCents,
    // salePriceCents (NOT discountCents). Compute from price fields and per-line qty
    // looked up from cart by pid.
    if (b.saleDiscounts && b.saleDiscounts.length > 0) {
      var saleItemsByPid = {};
      var saleCartItems = window.MastCart && window.MastCart.getItems ? window.MastCart.getItems() : [];
      for (var sci = 0; sci < saleCartItems.length; sci++) {
        var sit = saleCartItems[sci];
        saleItemsByPid[sit.pid] = (saleItemsByPid[sit.pid] || 0) + (sit.qty || 1);
      }
      for (var si = 0; si < b.saleDiscounts.length; si++) {
        var sd = b.saleDiscounts[si];
        var sdCents = (typeof sd.discountCents === 'number') ? sd.discountCents : null;
        if (sdCents == null && typeof sd.originalPriceCents === 'number' && typeof sd.salePriceCents === 'number') {
          var sdQty = saleItemsByPid[sd.pid] || 1;
          sdCents = (sd.originalPriceCents - sd.salePriceCents) * sdQty;
        }
        if (sdCents == null || isNaN(sdCents)) sdCents = 0;
        html += '<div class="order-total-row discount"><span class="order-total-label">Sale' + (sd.saleName ? ' (' + esc(sd.saleName) + ')' : '') + '</span><span class="order-total-value">-' + formatMoney(sdCents) + '</span></div>';
      }
    }

    // Pass deduction
    if (b.passDeductionCents > 0) {
      html += '<div class="order-total-row discount"><span class="order-total-label">Class Pass</span><span class="order-total-value">-' + formatMoney(b.passDeductionCents) + '</span></div>';
    }

    // Membership discount
    if (b.membershipApplied && b.membershipDiscountCents > 0) {
      var memberLabel = (b.membershipData && b.membershipData.programName) ? b.membershipData.programName : 'Member Discount';
      html += '<div class="order-total-row discount"><span class="order-total-label">' + esc(memberLabel) + '</span><span class="order-total-value">-' + formatMoney(b.membershipDiscountCents) + '</span></div>';
    }

    // Shipping
    var shipLabel = b.shippingLabel || 'Shipping';
    html += '<div class="order-total-row"><span class="order-total-label">' + esc(shipLabel) + '</span><span class="order-total-value">' + (b.shippingCents > 0 ? formatMoney(b.shippingCents) : '--') + '</span></div>';

    // Tax
    var taxLabel = 'Tax';
    if (b.taxState) taxLabel += ' (' + b.taxState + ')';
    if (b.taxExempt) taxLabel += ' (exempt)';
    html += '<div class="order-total-row"><span class="order-total-label">' + esc(taxLabel) + '</span><span class="order-total-value">' + formatMoney(b.taxCents) + '</span></div>';

    // Coupon
    if (b.couponDiscountCents > 0) {
      var couponLabel = 'Coupon';
      if (b.couponData && b.couponData.code) couponLabel += ' (' + esc(b.couponData.code) + ')';
      html += '<div class="order-total-row discount"><span class="order-total-label">' + couponLabel + '</span><span class="order-total-value">-' + formatMoney(b.couponDiscountCents) + '</span></div>';
    }

    // Loyalty
    if (b.loyaltyDeductionCents > 0) {
      var loyaltyLabel = (b.loyaltyConfig && b.loyaltyConfig.pointName) ? b.loyaltyConfig.pointName : 'Loyalty';
      html += '<div class="order-total-row discount"><span class="order-total-label">' + esc(loyaltyLabel) + '</span><span class="order-total-value">-' + formatMoney(b.loyaltyDeductionCents) + '</span></div>';
    }

    // Gift Cards — show source (e.g. last 4 of code) when available
    if (b.giftCardDeductionCents > 0) {
      var gcLabel = 'Wallet credit';
      var appliedCards = (checkoutData.walletGiftCards || []).filter(function(g) { return (g.remainingCents || 0) > 0; });
      if (appliedCards.length === 1 && appliedCards[0].code) {
        var code = String(appliedCards[0].code);
        gcLabel = 'Wallet credit (ends ' + esc(code.slice(-4)) + ')';
      } else if (appliedCards.length > 1) {
        gcLabel = 'Wallet credit (' + appliedCards.length + ' cards)';
      }
      html += '<div class="order-total-row discount"><span class="order-total-label">' + gcLabel + '</span><span class="order-total-value">-' + formatMoney(b.giftCardDeductionCents) + '</span></div>';
    }

    // Store Credits
    if (b.creditDeductionCents > 0) {
      html += '<div class="order-total-row discount"><span class="order-total-label">Store Credit</span><span class="order-total-value">-' + formatMoney(b.creditDeductionCents) + '</span></div>';
    }

    // Total
    html += '<div class="order-total-row grand-total"><span class="order-total-label">Total</span><span class="order-total-value">' + formatMoney(b.chargeAmountCents) + '</span></div>';

    // Loyalty earning message
    if (b.loyaltyPointsEarned > 0 && b.loyaltyConfig) {
      var earnSuffix = (b.membershipData && b.membershipData.loyaltyMultiplier > 1)
        ? ' (' + b.membershipData.loyaltyMultiplier + 'x Member)' : '';
      html += '<div style="text-align:center;color:#2D7D46;font-size:0.75rem;margin-top:8px;letter-spacing:0.08em;">&#11088; You\'ll earn ' + b.loyaltyPointsEarned + ' ' + esc(b.loyaltyConfig.pointName || 'points') + esc(earnSuffix) + '</div>';
    }

    // Free shipping threshold
    var totFreeThresholdCents = getShippingThreshold();
    if (totFreeThresholdCents != null) {
      var totSubtotalCents = b.subtotalCents || 0;
      if (totSubtotalCents >= totFreeThresholdCents) {
        html += '<div style="text-align:center;color:#2D7D46;font-size:0.75rem;margin-top:8px;letter-spacing:0.08em;">&#10003; FREE SHIPPING</div>';
      } else if (totSubtotalCents > 0) {
        html += '<div style="text-align:center;color:var(--warm-gray,#9B958E);font-size:0.75rem;margin-top:8px;letter-spacing:0.08em;">You\'re ' + formatMoney(totFreeThresholdCents - totSubtotalCents) + ' away from free shipping!</div>';
      }
    }

    html += '</div>';
    return html;
  }

  // ── Loading placeholder for totals ──
  function buildTotalsLoadingHtml() {
    return '<div class="order-totals" style="text-align:center;padding:20px 0;color:var(--warm-gray,#9B958E);font-size:0.85rem;">' +
      '<span class="checkout-spinner" style="display:inline-block;margin-right:8px;"></span> Calculating totals...' +
    '</div>';
  }

  // ── Wallet Credits ──
  function loadWalletCredits() {
    checkoutData.walletCredits = [];
    checkoutData.walletCreditApplied = false;
    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user) { walletLoadDone(); return; }
    if (!ensureMastDB()) { walletLoadDone(); return; }

    MastDB.query('public/accounts/' + user.uid + '/wallet/credits')
      .orderByChild('status').equalTo('active').once()
      .then(function(data) {
        data = data || {};
        var now = new Date().toISOString();
        checkoutData.walletCredits = Object.keys(data).map(function(id) {
          var c = data[id];
          c._id = id;
          return c;
        }).filter(function(c) {
          if (c.depleted) return false;
          var remaining = c.remainingCents != null ? c.remainingCents : (c.amountCents || 0);
          if (remaining <= 0) return false;
          // Lazy expiration check
          return !c.expiresAt || c.expiresAt >= now;
        }).sort(function(a, b) {
          // FIFO: oldest first
          return (a.createdAt || '').localeCompare(b.createdAt || '');
        });
        // Auto-apply if any credits available
        if (checkoutData.walletCredits.length > 0) {
          checkoutData.walletCreditApplied = true;
        }
        walletLoadDone();
      })
      .catch(function(err) {
        console.warn('[checkout] Failed to load wallet credits:', err);
        walletLoadDone();
      });
  }

  // ── Gift Cards: Load wallet gift cards ──
  function loadWalletGiftCards() {
    checkoutData.walletGiftCards = [];
    checkoutData.walletGiftCardApplied = false;
    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user) { walletLoadDone(); return; }
    if (!ensureMastDB()) { walletLoadDone(); return; }

    MastDB.get('public/accounts/' + user.uid + '/wallet/giftCards')
      .then(function(data) {
        data = data || {};
        var now = new Date().toISOString();
        checkoutData.walletGiftCards = Object.keys(data).map(function(id) {
          var g = data[id];
          g._id = id;
          return g;
        }).filter(function(g) {
          // Only active cards with balance
          if (g.status !== 'active') return false;
          if ((g.remainingCents || 0) <= 0) return false;
          // Lazy expiration check
          if (g.expiresAt && g.expiresAt < now) return false;
          return true;
        }).sort(function(a, b) {
          // Expiring soonest first (per deduction rule)
          if (a.expiresAt && b.expiresAt) return a.expiresAt.localeCompare(b.expiresAt);
          if (a.expiresAt) return -1;
          if (b.expiresAt) return 1;
          return (a.claimedAt || '').localeCompare(b.claimedAt || '');
        });
        // Auto-apply if any cards available
        if (checkoutData.walletGiftCards.length > 0) {
          checkoutData.walletGiftCardApplied = true;
        }
        walletLoadDone();
      })
      .catch(function(err) {
        console.warn('[checkout] Failed to load wallet gift cards:', err);
        walletLoadDone();
      });
  }

  // ── Saved Coupons: Load from wallet ──
  function loadSavedCoupons() {
    checkoutData.savedCoupons = [];
    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user) return;
    if (!ensureMastDB()) return;

    MastDB.get('public/accounts/' + user.uid + '/wallet/coupons')
      .then(function(data) {
        data = data || {};
        checkoutData.savedCoupons = Object.keys(data).map(function(id) {
          var c = data[id];
          c._id = id;
          return c;
        }).filter(function(c) {
          // Only unexpired coupons
          if (c.expiresAt && c.expiresAt < new Date().toISOString()) return false;
          return true;
        });
      })
      .catch(function(err) {
        console.warn('[checkout] Failed to load saved coupons:', err);
      });
  }

  // ── Customer Passes: Load active passes with definitions for auto-apply ──
  function loadCustomerPasses() {
    checkoutData.customerPasses = [];
    checkoutData.passAssignments = {};
    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user) { walletLoadDone(); return; }
    if (!ensureMastDB()) { walletLoadDone(); return; }

    MastDB.get('public/accounts/' + user.uid + '/passes')
      .then(function(data) {
        data = data || {};
        var now = new Date().toISOString();
        var activePasses = Object.keys(data).map(function(id) {
          var p = data[id];
          p._id = id;
          return p;
        }).filter(function(p) {
          if (p.status !== 'active') return false;
          if (p.expiresAt && p.expiresAt < now) return false;
          if (p.visitsRemaining !== null && p.visitsRemaining !== undefined && p.visitsRemaining <= 0) return false;
          return true;
        });

        if (activePasses.length === 0) { walletLoadDone(); return; }

        // Load pass definitions for scope checking
        var defIds = {};
        activePasses.forEach(function(p) { if (p.passDefinitionId) defIds[p.passDefinitionId] = true; });
        var defKeys = Object.keys(defIds);
        var defPromises = defKeys.map(function(defId) {
          return MastDB.get('public/passDefinitions/' + defId)
            .then(function(val) { return { id: defId, val: val }; });
        });

        // Also fetch class data for class items in cart (for category matching)
        var cartItems = window.MastCart.getItems();
        var classIds = {};
        cartItems.forEach(function(it) { if (it.bookingType === 'class' && it.classId) classIds[it.classId] = true; });
        var classPromises = Object.keys(classIds).map(function(cid) {
          // Strip -series suffix if present
          var baseId = cid.replace(/-series$/, '');
          return MastDB.get('public/classes/' + baseId)
            .then(function(val) { return { id: cid, val: val }; })
            .catch(function() { return { id: cid, val: null }; });
        });

        return Promise.all([Promise.all(defPromises), Promise.all(classPromises)]).then(function(results) {
          var defs = results[0];
          var classes = results[1];

          var defMap = {};
          defs.forEach(function(d) { if (d.val) defMap[d.id] = d.val; });

          // Store class category info for pass matching
          var classMap = {};
          classes.forEach(function(c) { if (c.val) classMap[c.id] = c.val; });
          // Attach class metadata to cart items for pass matching
          cartItems.forEach(function(it) {
            if (it.classId && classMap[it.classId]) {
              var cls = classMap[it.classId];
              it._classCategory = cls.category || null;
              // For series: ensure totalSessions is set from class data (cart item may not have it)
              if (cls.type === 'series' && cls.seriesInfo && cls.seriesInfo.totalSessions && !it.totalSessions) {
                it.totalSessions = cls.seriesInfo.totalSessions;
              }
            }
          });

          // Attach definition to each pass and sort: priority desc, soonest expiry first
          var priorityMap = { high: 3, medium: 2, low: 1 };
          checkoutData.customerPasses = activePasses.map(function(p) {
            p._def = defMap[p.passDefinitionId] || null;
            return p;
          }).filter(function(p) {
            return p._def != null; // skip passes with missing definitions
          }).sort(function(a, b) {
            var pa = priorityMap[a.priority] || 1;
            var pb = priorityMap[b.priority] || 1;
            if (pb !== pa) return pb - pa;
            var ea = a.expiresAt || '9999';
            var eb = b.expiresAt || '9999';
            return ea.localeCompare(eb);
          });

          // Auto-apply if any applicable passes found
          if (checkoutData.customerPasses.length > 0) {
            checkoutData.passApplied = true;
            autoApplyPasses();
          }
          walletLoadDone();
        });
      })
      .catch(function(err) {
        console.warn('[checkout] Failed to load customer passes:', err);
        walletLoadDone();
      });
  }

  // Check if a pass covers a given class item
  function passCoversClass(pass, classId, classCategory) {
    var def = pass._def;
    if (!def) return false;
    // allowedClassIds: if set, class must be in the list
    if (def.allowedClassIds && def.allowedClassIds.length > 0) {
      if (def.allowedClassIds.indexOf(classId) === -1) return false;
    }
    // allowedCategories: if set, class category must be in the list
    if (def.allowedCategories && def.allowedCategories.length > 0) {
      if (!classCategory || def.allowedCategories.indexOf(classCategory) === -1) return false;
    }
    return true;
  }

  // Auto-apply passes to class items in cart (greedy: soonest-expiring first, spans multiple passes)
  function autoApplyPasses() {
    checkoutData.passAssignments = {};
    var passes = checkoutData.customerPasses;
    if (!passes || passes.length === 0) return;

    var items = window.MastCart.getItems();
    // Sort passes: soonest-expiring first, fewest remaining visits as tiebreaker
    passes.sort(function(a, b) {
      var aExp = a.expiresAt || '9999-12-31';
      var bExp = b.expiresAt || '9999-12-31';
      if (aExp !== bExp) return aExp < bExp ? -1 : 1;
      var aVis = (a.visitsRemaining != null) ? a.visitsRemaining : 999;
      var bVis = (b.visitsRemaining != null) ? b.visitsRemaining : 999;
      return aVis - bVis;
    });
    // Track remaining visits per pass (don't mutate originals)
    var visitBudget = {};
    passes.forEach(function(p) {
      visitBudget[p._id] = (p.visitsRemaining != null) ? p.visitsRemaining : 999; // unlimited
    });

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.bookingType !== 'class') continue;
      var classId = item.classId;
      if (!classId) continue;

      // Each session/seat needs a visit — series uses totalSessions, multi-seat uses qty
      var visitsNeeded = item.totalSessions || item.qty || 1;
      var qty = visitsNeeded;
      // For series: priceCents is total series price, divide by totalSessions for per-session cost
      // For single-session: priceCents is already per-seat, don't divide by qty
      var priceForDivision = item.totalSessions || 1;
      var unitPriceCents = Math.round((item.priceCents || 0) / priceForDivision);
      var totalCoveredCents = 0;
      var totalSurchargeCents = 0;
      var totalVisitsUsed = 0;
      // Track per-pass usage: { passId: { passName, visitsUsed, coversCents, surchargeCents } }
      var passesUsedMap = {};

      // Track per-pass visits used for THIS item (unlimited passes cap at 1 seat)
      var itemPassVisits = {};

      for (var q = 0; q < qty; q++) {
        for (var j = 0; j < passes.length; j++) {
          var pass = passes[j];
          if (visitBudget[pass._id] <= 0) continue;
          if (!passCoversClass(pass, classId, item._classCategory)) continue;

          // Unlimited passes: 1 seat only (cover totalSessions for that seat, not extra seats)
          var def = pass._def;
          if (def.type === 'unlimited') {
            var maxForUnlimited = item.totalSessions || 1;
            if ((itemPassVisits[pass._id] || 0) >= maxForUnlimited) continue;
          }

          var unitCoversCents = unitPriceCents;
          var unitSurchargeCents = 0;

          if (def.maxClassPriceCents && unitPriceCents > def.maxClassPriceCents) {
            unitCoversCents = def.maxClassPriceCents;
            unitSurchargeCents = unitPriceCents - def.maxClassPriceCents;
          }

          totalCoveredCents += unitCoversCents;
          totalSurchargeCents += unitSurchargeCents;
          totalVisitsUsed++;
          visitBudget[pass._id]--;
          itemPassVisits[pass._id] = (itemPassVisits[pass._id] || 0) + 1;

          // Accumulate into per-pass map
          if (!passesUsedMap[pass._id]) {
            passesUsedMap[pass._id] = {
              passId: pass._id,
              passName: def.name || pass.passDefinitionName || 'Class Pass',
              visitsUsed: 0, coversCents: 0, surchargeCents: 0
            };
          }
          passesUsedMap[pass._id].visitsUsed++;
          passesUsedMap[pass._id].coversCents += unitCoversCents;
          passesUsedMap[pass._id].surchargeCents += unitSurchargeCents;
          break;
        }
      }

      if (totalVisitsUsed > 0) {
        var passesArr = Object.keys(passesUsedMap).map(function(pid) { return passesUsedMap[pid]; });
        checkoutData.passAssignments[i] = {
          passes: passesArr,
          totalCoveredCents: totalCoveredCents,
          totalSurchargeCents: totalSurchargeCents,
          totalVisitsUsed: totalVisitsUsed
        };
      }
    }
  }


  // ── Loyalty: Load config + balance ──
  function loadLoyaltyData() {
    checkoutData.loyaltyConfig = null;
    checkoutData.loyaltyBalance = null;
    checkoutData.loyaltyApplied = false;
    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user) { walletLoadDone(); return; }
    if (!ensureMastDB()) { walletLoadDone(); return; }

    // Load config
    MastDB.get('admin/walletConfig')
      .then(function(config) {
        config = config || {};
        if (!config.loyaltyEnabled) { walletLoadDone(); return null; }
        checkoutData.loyaltyConfig = {
          enabled: true,
          pointName: config.loyaltyPointName || 'Points',
          earnRate: config.loyaltyEarnRate || 1,
          redemptionRate: config.loyaltyRedemptionRate || 50,
          expiryDays: config.loyaltyExpiryDays || 365,
          exclusions: config.loyaltyExclusions || []
        };

        // Load balance
        return MastDB.get('public/accounts/' + user.uid + '/wallet/loyalty').then(function(data) {
          if (data && data.totalPoints > 0) {
            var now = new Date();
            if (!data.expiresAt || new Date(data.expiresAt) >= now) {
              checkoutData.loyaltyBalance = data;
            }
          }
          walletLoadDone();
        });
      })
      .catch(function(err) {
        console.warn('[checkout] Failed to load loyalty data:', err);
        walletLoadDone();
      });
  }

  // ── Membership: Load config + status ──
  function loadMembershipData() {
    checkoutData.membershipConfig = null;
    checkoutData.membershipStatus = null;
    checkoutData.effectiveMember = false;
    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user) { walletLoadDone(); return; }
    if (!ensureMastDB()) { walletLoadDone(); return; }

    MastDB.get('admin/membership/config')
      .then(function(config) {
        if (!config || !config.enabled) { walletLoadDone(); return null; }
        checkoutData.membershipConfig = config;

        return MastDB.get('public/accounts/' + user.uid + '/wallet/membership').then(function(status) {
          if (status) {
            checkoutData.membershipStatus = status;
            var today = new Date().toISOString().slice(0, 10);
            checkoutData.effectiveMember = (
              status.status === 'active' ||
              (status.status === 'cancelled' && status.expiryDate && status.expiryDate > today)
            );
          }
          walletLoadDone();
        });
      })
      .catch(function(err) {
        console.warn('[checkout] Failed to load membership data:', err);
        walletLoadDone();
      });
  }

  // ── Loyalty: Calculate earning ──
  function calcLoyaltyEarning() {
    var config = checkoutData.loyaltyConfig;
    if (!config || !config.enabled) return 0;

    var items = window.MastCart ? window.MastCart.getItems() : [];
    // Restore items from sessionStorage if cart was cleared (Square redirect)
    if (items.length === 0) {
      try {
        var ws = JSON.parse(sessionStorage.getItem('mast_checkout_wallet'));
        if (ws && ws.cartItems) items = ws.cartItems;
      } catch (e) {}
    }
    var couponDiscount = checkoutData.coupon ? checkoutData.coupon.discount : 0;
    if (couponDiscount === 0) {
      try {
        var ws2 = JSON.parse(sessionStorage.getItem('mast_checkout_wallet'));
        if (ws2) couponDiscount = ws2.couponDiscount || 0;
      } catch (e) {}
    }
    var exclusions = config.exclusions || [];

    // Eligible subtotal: product subtotal minus excluded categories
    var eligibleCents = 0;
    items.forEach(function(item) {
      // Skip gift cards and excluded categories
      if (item.isGiftCard || item.bookingType === 'gift-card') return;
      if (item.options && item.options.bookingType === 'gift-card') return;
      if (exclusions.length > 0 && item.category && exclusions.indexOf(item.category) !== -1) return;
      eligibleCents += (item.priceCents || 0) * (item.qty || 1);
    });

    // Subtract coupon discount
    var eligibleDollars = (eligibleCents / 100) - couponDiscount;

    // Subtract loyalty redeemed (if applied)
    if (checkoutData.loyaltyApplied && checkoutData.loyaltyBalance) {
      var redeemValue = checkoutData.loyaltyBalance.totalPoints / config.redemptionRate;
      eligibleDollars -= redeemValue;
    }

    // Gift card and credit redemptions do NOT reduce earning base (per RULE)
    if (eligibleDollars <= 0) return 0;

    return Math.floor(eligibleDollars * config.earnRate);
  }

  // ── Loyalty: Calculate redemption value ──
  function calcLoyaltyRedemptionCents() {
    var config = checkoutData.loyaltyConfig;
    if (!config || !config.enabled || !checkoutData.loyaltyApplied || !checkoutData.loyaltyBalance) return 0;
    var points = checkoutData.loyaltyBalance.totalPoints || 0;
    if (points <= 0) return 0;
    var valueCents = Math.round((points / config.redemptionRate) * 100);
    return valueCents;
  }

  // ── Loyalty: Award + consume on order completion ──
  function processLoyaltyForOrder(orderId) {
    var walletState = null;
    try { walletState = JSON.parse(sessionStorage.getItem('mast_checkout_wallet')); } catch (e) {}
    var config = checkoutData.loyaltyConfig || (walletState ? walletState.loyaltyConfig : null);
    if (!config || !config.enabled) return Promise.resolve();
    // Restore loyalty state if cart was cleared
    if (!checkoutData.loyaltyConfig && walletState) {
      checkoutData.loyaltyConfig = walletState.loyaltyConfig;
      checkoutData.loyaltyBalance = walletState.loyaltyBalance;
      checkoutData.loyaltyApplied = walletState.loyaltyApplied;
    }
    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user || user.isAnonymous) return Promise.resolve();
    if (!ensureMastDB()) return Promise.resolve();

    var now = new Date().toISOString();
    var basePath = 'public/accounts/' + user.uid + '/wallet/loyalty';
    var updates = {};
    var currentPoints = (checkoutData.loyaltyBalance && checkoutData.loyaltyBalance.totalPoints) || 0;

    // Consume redeemed points
    if (checkoutData.loyaltyApplied && currentPoints > 0) {
      var redeemPoints = currentPoints; // all-or-nothing
      var redeemKey = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
      updates[basePath + '/transactions/' + redeemKey] = {
        type: 'redeemed',
        points: -redeemPoints,
        orderId: orderId,
        timestamp: now,
        note: 'Applied at checkout'
      };
      currentPoints -= redeemPoints;
      if (currentPoints < 0) currentPoints = 0;
    }

    // Award earned points
    var earned = calcLoyaltyEarning();
    if (earned > 0) {
      var earnKey = Date.now().toString(36) + 'e' + Math.random().toString(36).substr(2, 4);
      updates[basePath + '/transactions/' + earnKey] = {
        type: 'earned',
        points: earned,
        orderId: orderId,
        timestamp: now,
        note: 'Purchase earning'
      };
      currentPoints += earned;
    }

    // Update balance + reset expiry clock
    if (Object.keys(updates).length > 0 || earned > 0) {
      var expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (config.expiryDays || 365));
      updates[basePath + '/totalPoints'] = currentPoints;
      updates[basePath + '/lastEarningPurchaseAt'] = now;
      updates[basePath + '/expiresAt'] = expiresAt.toISOString();
    }

    if (Object.keys(updates).length === 0) return Promise.resolve();
    return MastDB.multiUpdate(updates);
  }

  // ── Gift Cards: Consume at checkout ──
  function consumeWalletGiftCards(orderId) {
    // Restore wallet state from sessionStorage if cart was cleared (Square redirect)
    var walletState = null;
    try { walletState = JSON.parse(sessionStorage.getItem('mast_checkout_wallet')); } catch (e) {}
    var gcApplied = checkoutData.walletGiftCardApplied || (walletState && walletState.walletGiftCardApplied);
    var gcCards = checkoutData.walletGiftCards.length > 0 ? checkoutData.walletGiftCards : (walletState ? walletState.walletGiftCards || [] : []);
    if (!gcApplied || gcCards.length === 0) return Promise.resolve();

    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user || user.isAnonymous) return Promise.resolve();
    if (!ensureMastDB()) return Promise.resolve();

    // Calculate how much gift card to apply — cents-native. Use saved state if cart is empty.
    // walletState fields may still be dollar-era from pre-refactor redirects — convert on the fly.
    var subtotalCents = calcSubtotal();
    if (subtotalCents === 0 && walletState) subtotalCents = Math.round((walletState.subtotal || 0) * 100);
    var shipCents = checkoutData.shippingMethod ? checkoutData.shippingMethod.price : (walletState ? Math.round((walletState.shippingCost || 0) * 100) : 0);
    var taxableCents = calcTaxableSubtotal();
    if (taxableCents === 0 && walletState) taxableCents = Math.round((walletState.taxableSubtotal || 0) * 100);
    var taxRate = checkoutData.taxRate || (walletState ? walletState.taxRate || 0 : 0);
    var taxCents = Math.round(taxableCents * taxRate);
    var couponDiscountCents = checkoutData.coupon ? Math.round((checkoutData.coupon.discount || 0) * 100) : (walletState ? Math.round((walletState.couponDiscount || 0) * 100) : 0);
    var runningCents = subtotalCents + taxCents + shipCents - couponDiscountCents;

    // Subtract loyalty first
    if (checkoutData.loyaltyApplied && checkoutData.loyaltyBalance && checkoutData.loyaltyConfig) {
      var loyaltyCents = calcLoyaltyRedemptionCents();
      runningCents -= Math.min(loyaltyCents, Math.max(0, runningCents));
    }

    if (runningCents <= 0) return Promise.resolve();

    var now = new Date().toISOString();
    var updates = {};
    var remaining = runningCents;

    // Consume cards expiring soonest first (already sorted)
    for (var i = 0; i < gcCards.length && remaining > 0; i++) {
      var g = gcCards[i];
      var available = g.remainingCents || 0;
      var useCents = Math.min(available, remaining);
      var gcPath = 'public/accounts/' + user.uid + '/wallet/giftCards/' + g._id;

      updates[gcPath + '/remainingCents'] = available - useCents;
      updates[gcPath + '/updatedAt'] = now;
      if (available - useCents <= 0) {
        updates[gcPath + '/status'] = 'depleted';
      }

      // Transaction log — use timestamp key to avoid push() compatibility issues
      var txnKey = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
      updates[gcPath + '/transactions/' + txnKey] = {
        type: 'applied',
        amountCents: useCents,
        orderId: orderId,
        timestamp: now
      };

      remaining -= useCents;
    }

    if (Object.keys(updates).length === 0) return Promise.resolve();
    return MastDB.multiUpdate(updates);
  }

  function consumeWalletCredits(orderId) {
    var walletState = null;
    try { walletState = JSON.parse(sessionStorage.getItem('mast_checkout_wallet')); } catch (e) {}
    var crApplied = checkoutData.walletCreditApplied || (walletState && walletState.walletCreditApplied);
    var credits = checkoutData.walletCredits.length > 0 ? checkoutData.walletCredits : (walletState ? walletState.walletCredits || [] : []);
    if (!crApplied || credits.length === 0) return Promise.resolve();

    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user || user.isAnonymous) return Promise.resolve();
    if (!ensureMastDB()) return Promise.resolve();

    // Cents-native. walletState fields may be dollar-era — convert on the fly.
    var subtotalCents = calcSubtotal();
    if (subtotalCents === 0 && walletState) subtotalCents = Math.round((walletState.subtotal || 0) * 100);
    var shipCents = checkoutData.shippingMethod ? checkoutData.shippingMethod.price : (walletState ? Math.round((walletState.shippingCost || 0) * 100) : 0);
    var taxableCents = calcTaxableSubtotal();
    if (taxableCents === 0 && walletState) taxableCents = Math.round((walletState.taxableSubtotal || 0) * 100);
    var taxRate = checkoutData.taxRate || (walletState ? walletState.taxRate || 0 : 0);
    var taxCents = Math.round(taxableCents * taxRate);
    var couponDiscountCents = checkoutData.coupon ? Math.round((checkoutData.coupon.discount || 0) * 100) : (walletState ? Math.round((walletState.couponDiscount || 0) * 100) : 0);
    var remainingCents = subtotalCents + taxCents + shipCents - couponDiscountCents;
    if (remainingCents <= 0) return Promise.resolve();

    var now = new Date().toISOString();
    var updates = {};

    // FIFO: process credits oldest first (already sorted by createdAt)
    for (var i = 0; i < credits.length && remainingCents > 0; i++) {
      var c = credits[i];
      var available = c.remainingCents != null ? c.remainingCents : (c.amountCents || 0);
      var useCents = Math.min(available, remainingCents);
      var creditPath = 'public/accounts/' + user.uid + '/wallet/credits/' + c._id;
      var newRemaining = available - useCents;

      // Update remaining balance
      updates[creditPath + '/remainingCents'] = newRemaining;
      updates[creditPath + '/updatedAt'] = now;

      // Mark depleted if fully consumed
      if (newRemaining <= 0) {
        updates[creditPath + '/status'] = 'depleted';
      }

      // Append transaction record
      var creditTxnKey = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
      updates[creditPath + '/transactions/' + creditTxnKey] = {
        type: 'applied',
        amountCents: useCents,
        orderId: orderId,
        timestamp: now
      };

      remainingCents -= useCents;
    }

    if (Object.keys(updates).length === 0) return Promise.resolve();
    return MastDB.multiUpdate(updates);
  }

  // ── Render: Review Step ──
  function renderReview() {
    currentStep = 'review';
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body || !footer) return;
    attachDelegate(); // ensure delegation is live before rendering Place Order button

    var items = window.MastCart.getItems();
    var subtotalCents = calcSubtotal();

    var html = stepIndicatorHtml('review');
    html += '<div class="checkout-section">';

    // Items
    html += '<div class="review-section">';
    html += '<div class="review-section-header"><span class="review-section-title">Items (' + items.length + ')</span></div>';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var imgHtml = item.image
        ? '<img class="review-item-img" src="' + esc(item.image) + '" alt="' + esc(item.name) + '">'
        : '<div class="review-item-img"></div>';

      var optStr = '';
      if (item.options) {
        var oKeys = Object.keys(item.options);
        var oParts = [];
        for (var j = 0; j < oKeys.length; j++) oParts.push(esc(oKeys[j]) + ': ' + esc(item.options[oKeys[j]]));
        optStr = oParts.join(' &middot; ');
      }

      var lineTotalCents = (item.priceCents || 0) * (item.qty || 1);
      html += '<div class="review-item">' +
        imgHtml +
        '<div class="review-item-info">' +
          '<div class="review-item-name">' + esc(item.name) + '</div>' +
          (optStr ? '<div class="review-item-meta">' + optStr + '</div>' : '') +
          '<div class="review-item-meta">Qty: ' + item.qty + '</div>' +
        '</div>' +
        '<div class="review-item-price">' + formatMoney(lineTotalCents) + '</div>' +
      '</div>';
    }
    html += '</div>';

    // Multi-seat attendee emails (class items with qty > 1)
    var multiSeatItems = [];
    for (var ms = 0; ms < items.length; ms++) {
      if (items[ms].bookingType === 'class' && (items[ms].qty || 1) > 1) {
        multiSeatItems.push({ idx: ms, item: items[ms] });
      }
    }
    if (multiSeatItems.length > 0) {
      html += '<div class="review-section">';
      html += '<div class="review-section-header"><span class="review-section-title">Seat Attendees</span></div>';
      html += '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-bottom:10px;">Enter an email for each seat. You may use your own email for all seats now &mdash; each seat will need a unique email entered prior to class start.</div>';
      for (var msi = 0; msi < multiSeatItems.length; msi++) {
        var msItem = multiSeatItems[msi];
        var msQty = msItem.item.qty || 1;
        html += '<div style="margin-bottom:12px;"><div style="font-size:0.85rem;font-weight:500;margin-bottom:6px;">' + esc(msItem.item.name) + ' (' + msQty + ' seats)</div>';
        // Initialize attendee data if not set
        if (!checkoutData.seatAttendees[msItem.idx]) {
          checkoutData.seatAttendees[msItem.idx] = [];
          for (var sq = 0; sq < msQty; sq++) {
            checkoutData.seatAttendees[msItem.idx].push({ email: checkoutData.email || '' });
          }
        }
        for (var seat = 0; seat < msQty; seat++) {
          var seatEmail = (checkoutData.seatAttendees[msItem.idx][seat] || {}).email || '';
          html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
            '<span style="font-size:0.78rem;color:var(--warm-gray);min-width:50px;">Seat ' + (seat + 1) + '</span>' +
            '<input type="email" class="checkout-input" data-co="seat-email" data-item-idx="' + msItem.idx + '" data-seat-idx="' + seat + '" value="' + esc(seatEmail) + '" placeholder="Email address" style="flex:1;padding:6px 10px;font-size:0.85rem;">' +
          '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // Shipping address
    html += '<div class="review-section">' +
      '<div class="review-section-header">' +
        '<span class="review-section-title">Ship To</span>' +
        '<button class="review-edit-link" data-co="edit-address">Edit</button>' +
      '</div>' +
      '<div class="review-address">' +
        esc(checkoutData.shipping.name) + '<br>' +
        esc(checkoutData.shipping.address1) +
        (checkoutData.shipping.address2 ? '<br>' + esc(checkoutData.shipping.address2) : '') +
        '<br>' + esc(checkoutData.shipping.city) + ', ' + esc(checkoutData.shipping.state) + ' ' + esc(checkoutData.shipping.zip) +
      '</div>' +
    '</div>';

    // Billing
    if (!checkoutData.billing.same) {
      html += '<div class="review-section">' +
        '<div class="review-section-header">' +
          '<span class="review-section-title">Bill To</span>' +
          '<button class="review-edit-link" data-co="edit-address">Edit</button>' +
        '</div>' +
        '<div class="review-address">' +
          esc(checkoutData.billing.name) + '<br>' +
          esc(checkoutData.billing.address1) +
          (checkoutData.billing.address2 ? '<br>' + esc(checkoutData.billing.address2) : '') +
          '<br>' + esc(checkoutData.billing.city) + ', ' + esc(checkoutData.billing.state) + ' ' + esc(checkoutData.billing.zip) +
        '</div>' +
      '</div>';
    }

    // Shipping method
    html += '<div class="review-section">' +
      '<div class="review-section-header">' +
        '<span class="review-section-title">Shipping</span>' +
        '<button class="review-edit-link" data-co="edit-shipping">Edit</button>' +
      '</div>' +
      '<div class="review-address">' + esc(checkoutData.shippingMethod.label) +
        ' &mdash; ' + formatMoney(checkoutData.shippingMethod.price) +
      '</div>' +
    '</div>';

    // Contact
    html += '<div class="review-section">' +
      '<div class="review-section-header">' +
        '<span class="review-section-title">Contact</span>' +
        '<button class="review-edit-link" data-co="edit-address">Edit</button>' +
      '</div>' +
      '<div class="review-address">' + esc(checkoutData.email) + '</div>' +
    '</div>';

    // Payment method — show check option for wholesale orders
    var hasWholesale = window.MastCart.hasWholesaleItems && window.MastCart.hasWholesaleItems();
    if (hasWholesale) {
      var selectedMethod = checkoutData.paymentMethod || 'card';
      html += '<div class="review-section">' +
        '<div class="review-section-header"><span class="review-section-title">Payment Method</span></div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">' +
          '<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid ' + (selectedMethod === 'card' ? 'var(--teal)' : '#ddd') + ';border-radius:6px;cursor:pointer;background:' + (selectedMethod === 'card' ? 'color-mix(in srgb, var(--accent) 5%, transparent)' : '#fff') + ';">' +
            '<input type="radio" name="payMethod" value="card" data-co="pay-method"' + (selectedMethod === 'card' ? ' checked' : '') + '>' +
            '<div><div style="font-size:0.85rem;font-weight:500;">Credit Card</div><div style="font-size:0.75rem;color:var(--warm-gray);">Pay now via Square</div></div>' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid ' + (selectedMethod === 'check' ? 'var(--teal)' : '#ddd') + ';border-radius:6px;cursor:pointer;background:' + (selectedMethod === 'check' ? 'color-mix(in srgb, var(--accent) 5%, transparent)' : '#fff') + ';">' +
            '<input type="radio" name="payMethod" value="check" data-co="pay-method"' + (selectedMethod === 'check' ? ' checked' : '') + '>' +
            '<div><div style="font-size:0.85rem;font-weight:500;">Pay by Check</div><div style="font-size:0.75rem;color:var(--warm-gray);">Mail check — order held until verification</div></div>' +
          '</label>' +
        '</div>' +
      '</div>';
    }

    // ── Wallet Deductions (for non-shippable carts that skipped the shipping step) ──
    var isNonShippable = window.MastCart && window.MastCart.isNonShippableCart && window.MastCart.isNonShippableCart();
    var hasAnyWallet = checkoutData.walletCredits.length > 0 ||
      checkoutData.walletGiftCards.length > 0 ||
      (checkoutData.loyaltyConfig && checkoutData.loyaltyConfig.enabled && checkoutData.loyaltyBalance && checkoutData.loyaltyBalance.totalPoints > 0) ||
      (checkoutData.customerPasses.length > 0 && Object.keys(checkoutData.passAssignments).length > 0);

    if (isNonShippable && hasAnyWallet) {
      html += '<div class="review-section">' +
        '<div class="review-section-header"><span class="review-section-title">Wallet Deductions</span></div>';

      // Track running remaining to disable lower-priority instruments when total is already covered
      var walletRunningCents = subtotalCents;
      var couponDiscountCents = checkoutData.coupon ? Math.round((checkoutData.coupon.discount || 0) * 100) : 0;

      // Class passes (1st priority)
      if (checkoutData.customerPasses.length > 0 && Object.keys(checkoutData.passAssignments).length > 0) {
        var pCoversCents = 0;
        var pVisits = 0;
        var pUniqueIds = {};
        Object.keys(checkoutData.passAssignments).forEach(function(idx) {
          var a = checkoutData.passAssignments[idx];
          pCoversCents += a.totalCoveredCents || 0;
          pVisits += a.totalVisitsUsed || 0;
          (a.passes || []).forEach(function(p) { pUniqueIds[p.passId] = true; });
        });
        var pCount = Object.keys(pUniqueIds).length;
        var pLabel = pCount > 1
          ? '&#127915; Use class passes (' + pVisits + ' visit' + (pVisits !== 1 ? 's' : '') + ' across ' + pCount + ' passes, ' + formatMoney(pCoversCents) + ' off)'
          : '&#127915; Use class pass (' + pVisits + ' visit' + (pVisits !== 1 ? 's' : '') + ', ' + formatMoney(pCoversCents) + ' off)';
        html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;color:var(--text);margin-bottom:8px;">' +
          '<input type="checkbox" id="coPassToggle" ' + (checkoutData.passApplied ? 'checked' : '') + ' data-co="toggle-pass">' +
          pLabel +
        '</label>';
        if (checkoutData.passApplied) walletRunningCents -= pCoversCents;
      }
      walletRunningCents -= couponDiscountCents; // coupons always applied if present
      walletRunningCents = Math.max(0, walletRunningCents);

      // Loyalty (2nd priority)
      if (checkoutData.loyaltyConfig && checkoutData.loyaltyConfig.enabled && checkoutData.loyaltyBalance && checkoutData.loyaltyBalance.totalPoints > 0) {
        var rlc = checkoutData.loyaltyConfig;
        var rlb = checkoutData.loyaltyBalance;
        var rLoyaltyVal = Math.round((rlb.totalPoints / rlc.redemptionRate) * 100);
        var loyaltyDisabled = walletRunningCents <= 0;
        html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;color:var(--text);margin-bottom:8px;' + (loyaltyDisabled ? 'opacity:0.4;' : '') + '">' +
          '<input type="checkbox" id="coLoyaltyToggle" ' + (checkoutData.loyaltyApplied && !loyaltyDisabled ? 'checked' : '') + (loyaltyDisabled ? ' disabled' : '') + ' data-co="toggle-loyalty">' +
          '&#11088; Apply ' + rlb.totalPoints + ' ' + esc(rlc.pointName) + ' (' + formatMoney(rLoyaltyVal) + ' off)' +
          (loyaltyDisabled ? ' <span style="font-size:0.75rem;color:var(--warm-gray);">— already covered</span>' : '') +
        '</label>';
        if (checkoutData.loyaltyApplied && !loyaltyDisabled) walletRunningCents -= Math.min(rLoyaltyVal, walletRunningCents);
      }

      // Gift Cards (3rd priority)
      if (checkoutData.walletGiftCards.length > 0) {
        var rTotalGc = checkoutData.walletGiftCards.reduce(function(sum, g) { return sum + (g.remainingCents || 0); }, 0);
        var gcDisabled = walletRunningCents <= 0;
        html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;color:var(--text);margin-bottom:8px;' + (gcDisabled ? 'opacity:0.4;' : '') + '">' +
          '<input type="checkbox" id="coGiftCardToggle" ' + (checkoutData.walletGiftCardApplied && !gcDisabled ? 'checked' : '') + (gcDisabled ? ' disabled' : '') + ' data-co="toggle-giftcard">' +
          '&#127873; Apply gift cards (' + formatMoney(rTotalGc) + ' available)' +
          (gcDisabled ? ' <span style="font-size:0.75rem;color:var(--warm-gray);">— already covered</span>' : '') +
        '</label>';
        if (checkoutData.walletGiftCardApplied && !gcDisabled) walletRunningCents -= Math.min(rTotalGc, walletRunningCents);
      }

      // Credits (4th priority)
      if (checkoutData.walletCredits.length > 0) {
        var rTotalCr = checkoutData.walletCredits.reduce(function(sum, c) { return sum + (c.remainingCents != null ? c.remainingCents : (c.amountCents || 0)); }, 0);
        var crDisabled = walletRunningCents <= 0;
        html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;color:var(--text);margin-bottom:8px;' + (crDisabled ? 'opacity:0.4;' : '') + '">' +
          '<input type="checkbox" id="coWalletToggle" ' + (checkoutData.walletCreditApplied && !crDisabled ? 'checked' : '') + (crDisabled ? ' disabled' : '') + ' data-co="toggle-wallet">' +
          '&#128179; Apply store credits (' + formatMoney(rTotalCr) + ' available)' +
          (crDisabled ? ' <span style="font-size:0.75rem;color:var(--warm-gray);">— already covered</span>' : '') +
        '</label>';
      }

      html += '<div style="font-size:0.75rem;color:var(--warm-gray-light);margin-top:6px;">Deductions applied in order: passes \u2192 coupons \u2192 loyalty \u2192 gift cards \u2192 credits</div>' +
        '</div>';
    }

    // Membership upsell banner (non-members only, dismissible)
    if (!checkoutData.effectiveMember && checkoutData.membershipConfig && checkoutData.membershipConfig.enabled) {
      var dismissed = false;
      try { dismissed = localStorage.getItem('mast_membership_upsell_dismissed') === '1'; } catch (_) {}
      if (!dismissed) {
        var programName = esc(checkoutData.membershipConfig.programName || 'Membership');
        var annualPrice = checkoutData.membershipConfig.annualPrice;
        // annualPrice is stored as dollars in membership config — convert for cents-native formatter.
        var priceStr = annualPrice ? formatMoney(Math.round(annualPrice * 100)) + '/year' : '';
        html += '<div class="review-section" id="coMembershipUpsell" style="background:linear-gradient(135deg,rgba(42,124,111,0.08),rgba(196,133,60,0.08));border:1px solid rgba(42,124,111,0.2);border-radius:8px;padding:14px 16px;margin-bottom:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
            '<a href="/membership.html" style="text-decoration:none;display:block;flex:1;min-width:0;">' +
              '<div style="font-size:0.82rem;font-weight:600;color:var(--teal,#2A7C6F);margin-bottom:4px;">' + programName + '</div>' +
              '<div style="font-size:0.78rem;color:var(--warm-gray,#888);line-height:1.4;">Save on every order with member discounts' + (priceStr ? ' \u2014 ' + priceStr : '') + '. <span style="text-decoration:underline;">Learn more \u2192</span></div>' +
            '</a>' +
            '<button style="background:none;border:none;color:var(--warm-gray,#888);cursor:pointer;font-size:1.1rem;padding:0 4px;line-height:1;" data-co="dismiss-membership-upsell">&times;</button>' +
          '</div>' +
        '</div>';
      }
    }

    // Wallet toggle — show when customer has wallet gift cards with balance so they can opt out of auto-apply
    var walletCards = checkoutData.walletGiftCards || [];
    if (walletCards.length > 0) {
      var totalBalance = walletCards.reduce(function(s, g) { return s + (g.remainingCents || 0); }, 0);
      var applied = !!checkoutData.walletGiftCardApplied;
      html += '<div class="review-section" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;margin:8px 0;">';
      html += '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.9rem;">';
      html += '<input type="checkbox" data-co="wallet-toggle"' + (applied ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer;">';
      html += '<span><strong>Apply wallet balance</strong> (' + formatMoney(totalBalance) + ' available across ' + walletCards.length + ' card' + (walletCards.length === 1 ? '' : 's') + ')</span>';
      html += '</label>';
      html += '</div>';
    }

    // Totals — loading placeholder, then engine call
    html += '<div class="review-section engine-totals-container">' + buildTotalsLoadingHtml() + '</div>';

    html += '</div>'; // close checkout-section

    body.innerHTML = html;

    // Wire wallet toggle — re-render review so banner/button state stays in sync
    var walletToggle = body.querySelector('[data-co="wallet-toggle"]');
    if (walletToggle) {
      walletToggle.addEventListener('change', function() {
        checkoutData.walletGiftCardApplied = this.checked;
        checkoutData._walletConfirmed = false; // re-require confirmation
        // Also re-apply to credits with the same toggle (keep UX simple)
        checkoutData.walletCreditApplied = this.checked;
        // Remove stale banner/button-label state before re-render picks the correct one
        var staleBanner = document.getElementById('walletCoveredBanner');
        if (staleBanner) staleBanner.remove();
        var staleBtn = document.querySelector('[data-co="place-order"]');
        if (staleBtn) staleBtn.removeAttribute('data-wallet-covered');
        renderReview();
      });
    }

    // Attach seat attendee email listeners
    var seatInputs = body.querySelectorAll('[data-co="seat-email"]');
    for (var si = 0; si < seatInputs.length; si++) {
      seatInputs[si].addEventListener('blur', function() {
        var itemIdx = parseInt(this.getAttribute('data-item-idx'), 10);
        var seatIdx = parseInt(this.getAttribute('data-seat-idx'), 10);
        if (checkoutData.seatAttendees[itemIdx] && checkoutData.seatAttendees[itemIdx][seatIdx]) {
          checkoutData.seatAttendees[itemIdx][seatIdx].email = this.value.trim();
        }
      });
    }

    // Attach payment method change listeners
    if (hasWholesale) {
      var radios = body.querySelectorAll('[data-co="pay-method"]');
      for (var r = 0; r < radios.length; r++) {
        radios[r].addEventListener('change', function() {
          checkoutData.paymentMethod = this.value;
          renderReview(); // re-render to update styling
        });
      }
    }

    // Call engine for server-computed totals
    callBreakdownEngine(function(breakdown) {
      var tc = document.querySelector('.engine-totals-container');
      if (tc) {
        tc.innerHTML = breakdown ? buildTotalsFromBreakdown(breakdown) : buildTotalsErrorHtml();
      }
      if (breakdown) syncCouponMessage(breakdown);
      // Wallet-covered order ($0 charge): surface banner + require explicit confirm
      if (breakdown && breakdown.chargeAmountCents <= 0) {
        var btn = document.querySelector('[data-co="place-order"]');
        if (btn) {
          btn.textContent = 'Place Order';
          btn.setAttribute('data-wallet-covered', '1');
        }
        // Inject "no card will be charged" banner just above the footer
        var footerEl = document.querySelector('.checkout-footer') || document.querySelector('[data-co="place-order"]');
        if (footerEl && !document.getElementById('walletCoveredBanner')) {
          var totalDeducted = (breakdown.giftCardDeductionCents || 0) + (breakdown.creditDeductionCents || 0);
          var banner = document.createElement('div');
          banner.id = 'walletCoveredBanner';
          banner.style.cssText = 'background:#f0f9ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 12px;margin:12px 0;font-size:0.85rem;color:#1e40af;line-height:1.4;';
          banner.innerHTML = '<strong>No card will be charged.</strong><br>This order is fully covered by your wallet balance (' + formatMoney(totalDeducted) + ' will be deducted).';
          footerEl.parentNode.insertBefore(banner, footerEl);
        }
      } else {
        // Remove banner if breakdown changed and wallet no longer covers
        var existingBanner = document.getElementById('walletCoveredBanner');
        if (existingBanner) existingBanner.remove();
      }
    });

    // Footer
    var btnLabel = (hasWholesale && checkoutData.paymentMethod === 'check') ? 'Place Order (Pay by Check)' : 'Proceed to Payment';
    footer.style.display = '';
    footer.innerHTML =
      '<button class="checkout-btn-primary" data-co="place-order">' + btnLabel + '</button>' +
      '<button class="checkout-back-link" data-co="review-back">Back to Shipping</button>';
  }

  // ── Place Order ──
  function placeOrder() {
    if (isSubmitting) return;

    // Check if this is a pay-by-check wholesale order
    var hasWholesale = window.MastCart.hasWholesaleItems && window.MastCart.hasWholesaleItems();
    if (hasWholesale && checkoutData.paymentMethod === 'check') {
      placeCheckOrder();
      return;
    }

    // Wallet-covered $0 order — require explicit confirmation so the customer
    // doesn't miss that wallet balance is being spent.
    var btn = document.querySelector('[data-co="place-order"]');
    if (btn && btn.getAttribute('data-wallet-covered') === '1' && !checkoutData._walletConfirmed) {
      var bd = checkoutData.serverBreakdown || {};
      var deducted = (bd.giftCardDeductionCents || 0) + (bd.creditDeductionCents || 0);
      var ok = window.confirm('Place this order? ' + formatMoney(deducted) + ' will be deducted from your wallet. No card will be charged.');
      if (!ok) return;
      checkoutData._walletConfirmed = true;
    }

    // All orders (including $0 wallet-covered) go through submitOrder server-side.
    // Server verifies wallet balances, applies deductions, and handles $0 path.

    isSubmitting = true;

    var btn = document.querySelector('[data-co="place-order"]');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="checkout-spinner"></span> Processing...';
    }

    var items = window.MastCart.getItems();
    var user = window.MastCart.getCurrentUser();

    // SECURITY: prices are sent for display/logging only.
    // The Cloud Function (submitOrder) MUST look up prices from its own
    // product database and calculate totals server-side. Never trust client prices.
    var payload = {
      email: checkoutData.email,
      shipping: checkoutData.shipping,
      billing: checkoutData.billing,
      items: items.map(function (it, idx) {
        var mapped = { pid: it.pid, name: it.name, options: it.options, priceCents: it.priceCents || 0, qty: it.qty, isWholesale: it.isWholesale || false };
        if (it.variantId) mapped.variantId = it.variantId;
        // Pass booking fields so server can verify prices from class data instead of products
        if (it.bookingType) mapped.bookingType = it.bookingType;
        if (it.classId) mapped.classId = it.classId;
        if (it.sessionId) mapped.sessionId = it.sessionId;
        // Attach pass assignment for server-side deduction (multi-pass)
        var passAssignment = checkoutData.passAssignments[idx];
        if (passAssignment && passAssignment.passes && passAssignment.passes.length > 0) {
          mapped.passAssignments = passAssignment.passes;
          mapped.passId = passAssignment.passes[0].passId; // backward compat
          mapped.passCoversAmountCents = passAssignment.totalCoveredCents;
          mapped.surchargeAmountCents = passAssignment.totalSurchargeCents;
          mapped.passVisitsUsed = passAssignment.totalVisitsUsed;
        }
        // Attach seat attendee emails for multi-seat class items
        if (checkoutData.seatAttendees[idx] && checkoutData.seatAttendees[idx].length > 0) {
          mapped.seatAttendees = checkoutData.seatAttendees[idx];
        }
        return mapped;
      }),
      shippingMethodKey: 'calculated',
      couponCode: checkoutData.coupon ? checkoutData.coupon.code : null,
      couponSource: checkoutData.couponSource || null,
      uid: user ? user.uid : 'anonymous',
      isWholesale: isWholesaleCart(),
      resaleCertNumber: checkoutData.resaleCertNumber || ''
    };

    // Wallet deductions — server verifies actual balances
    var wd = buildWalletDeductionsPayload();
    if (wd) payload.walletDeductions = wd;

    callFunction('submitOrder', payload, function (result) {
      isSubmitting = false;

      // $0 wallet-covered order: server handled everything
      if (result && result.success && result.zeroDollar) {
        window.MastCart.clear();
        // Provision passes/enrollments for booking items
        if (items) {
          provisionCustomerPasses(items, result.orderId);
          provisionSeriesEnrollments(items, result.orderId);
        }
        renderWalletOrderConfirmation(result);
        return;
      }

      if (result && result.success && result.checkoutUrl) {
        // Save order info for post-payment confirmation
        try {
          sessionStorage.setItem('mast_pending_order', JSON.stringify({
            orderId: result.orderId,
            orderNumber: result.orderNumber,
            email: checkoutData.email,
            items: payload.items,
            cartItems: items.map(function(ci) { return { bookingType: ci.bookingType, passDefinitionId: ci.passDefinitionId, classId: ci.classId, sessionId: ci.sessionId, name: ci.name }; }),
            shipping: checkoutData.shipping,
            itemShippingData: checkoutData.itemShippingData || {},
            shippingConfig: checkoutData.shippingConfig || DEFAULT_SHIPPING_CONFIG
          }));
        } catch (e) { /* sessionStorage not available */ }

        // Wallet consumption is now handled server-side in submitOrder.
        // No need to save wallet state to sessionStorage.

        // Clear cart before redirect but keep checkout info for returning customer auto-fill
        window.MastCart.clear();

        // Save address + optional resale cert via CF (admin-only writes).
        if (user && !user.isAnonymous) {
          var savePayload = {
            action: 'save',
            address: {
              address1: checkoutData.shipping.address1 || '',
              address2: checkoutData.shipping.address2 || '',
              city: checkoutData.shipping.city || '',
              state: checkoutData.shipping.state || '',
              zip: checkoutData.shipping.zip || '',
              country: 'US'
            }
          };
          if (checkoutData.resaleCertNumber && user.email) {
            savePayload.resaleCertNumber = checkoutData.resaleCertNumber;
            savePayload.email = user.email;
          }
          callFunction('upsertCustomerAccount', savePayload, function() { /* best-effort */ });
        }
        trackCheckoutEvent('checkout_redirect_to_payment');

        // Redirect to payment processor's hosted checkout (Square or Stripe)
        window.location.href = result.checkoutUrl;
      } else {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Proceed to Payment';
        }
        window.MastCart.showToast(result && result.error ? result.error : 'Order failed. Please try again.');
      }
    });
  }

  // ── Place Order: Pay by Check (wholesale) ──
  // Bypasses Square — creates order in Firebase wholesale orders queue
  // ── $0 Payment Orders (Step 4.2) ──
  // When wallet deductions fully cover the order, skip payment processor.
  function placeZeroDollarOrder() {
    isSubmitting = true;
    var btn = document.querySelector('[data-co="place-order"]');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="checkout-spinner"></span> Processing...';
    }

    var items = window.MastCart.getItems();
    var user = window.MastCart.getCurrentUser();
    var db = getDb();
    if (!db) { isSubmitting = false; return; }

    var subtotalCents = calcSubtotal();
    var shipCostCents = checkoutData.shippingMethod ? checkoutData.shippingMethod.price : 0;
    var taxCents = Math.round(calcTaxableSubtotal() * checkoutData.taxRate);
    var couponDiscount = checkoutData.coupon ? checkoutData.coupon.discount : 0;
    var now = new Date().toISOString();

    // Generate order number
    var orderNumber = 'WL-' + Date.now().toString(36).toUpperCase();

    // Build payment references for audit trail
    var paymentRefs = [];
    if (checkoutData.loyaltyApplied) paymentRefs.push('loyalty:applied');
    if (checkoutData.walletGiftCardApplied) {
      checkoutData.walletGiftCards.forEach(function(g) { paymentRefs.push('gift-card:' + (g.code || g._id)); });
    }
    if (checkoutData.walletCreditApplied) paymentRefs.push('credit:applied');

    var orderData = {
      orderNumber: orderNumber,
      status: 'placed',
      paymentMethod: 'wallet',
      type: 'retail',
      source: 'online',
      buyerName: checkoutData.shipping.name || '',
      buyerEmail: checkoutData.email || '',
      email: checkoutData.email || '',
      shipping: checkoutData.shipping,
      billing: checkoutData.billing.same ? checkoutData.shipping : checkoutData.billing,
      items: items.map(function(it) {
        var mapped = { pid: it.pid, name: it.name, options: it.options, priceCents: it.priceCents || 0, qty: it.qty };
        if (it.variantId) mapped.variantId = it.variantId;
        if (it.bookingType) mapped.bookingType = it.bookingType;
        if (it.classId) mapped.classId = it.classId;
        if (it.sessionId) mapped.sessionId = it.sessionId;
        if (it.isGiftCard) mapped.isGiftCard = true;
        return mapped;
      }),
      subtotalCents: subtotalCents,
      shippingCents: shipCostCents,
      taxCents: taxCents,
      couponDiscount: couponDiscount,
      coupon: checkoutData.coupon || null,
      totalCents: 0,
      total: 0,
      paidAmount: 0,
      shippingMethod: checkoutData.shippingMethod || null,
      uid: user ? user.uid : 'anonymous',
      placedAt: now,
      createdAt: now,
      walletPayment: true,
      walletPaymentRefs: paymentRefs,
      statusHistory: [{ status: 'placed', at: now, by: 'wallet-checkout' }]
    };

    var orderKey = MastDB.newKey('orders');
    MastDB.set('orders/' + orderKey, orderData).then(function() {
      trackCheckoutEvent('wallet_order_placed');

      // Consume wallet instruments BEFORE clearing cart (calcSubtotal needs cart items)
      consumeWalletGiftCards(orderKey);
      consumeWalletCredits(orderKey);
      processLoyaltyForOrder(orderKey);

      // Provision passes, enrollments, gift cards
      provisionCustomerPasses(items, orderKey);
      provisionSeriesEnrollments(items, orderKey);
      issueGiftCardsClientSide(items, orderKey, orderNumber);

      // Clear cart after all processing
      window.MastCart.clear();

      // Render confirmation
      isSubmitting = false;
      renderZeroDollarConfirmation(orderNumber, orderData);
    }).catch(function(err) {
      isSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
      window.MastCart.showToast('Order failed: ' + (err.message || 'Unknown error'), true);
    });
  }

  function renderZeroDollarConfirmation(orderNumber, orderData) {
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body) return;

    body.innerHTML =
      '<div style="text-align:center;padding:40px 20px;">' +
        '<div style="font-size:2.5rem;margin-bottom:16px;">&#10003;</div>' +
        '<h3 style="margin:0 0 8px;font-size:1.2rem;">Order Confirmed!</h3>' +
        '<p style="font-size:0.9rem;color:var(--warm-gray);">Order #' + esc(orderNumber) + '</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray);margin-top:12px;">Paid in full with wallet balance. No card charge.</p>' +
        '<div style="margin-top:24px;padding:16px;background:rgba(22,163,74,0.1);border-radius:8px;">' +
          '<div style="font-size:0.85rem;color:var(--charcoal);">A confirmation email will be sent to ' + esc(orderData.email || '') + '</div>' +
        '</div>' +
      '</div>';

    if (footer) {
      footer.style.display = '';
      footer.innerHTML = '<button class="checkout-btn-primary" onclick="window.location.reload()">Done</button>';
    }
  }

  // Server-side $0 wallet order confirmation (submitOrder returned zeroDollar: true)
  function renderWalletOrderConfirmation(result) {
    isSubmitting = false;
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body) return;

    var titleEl = document.querySelector('.cart-drawer-title');
    var countEl = document.getElementById('cartDrawerCount');
    if (titleEl) titleEl.textContent = 'Order Confirmed';
    if (countEl) countEl.textContent = '';

    var loyaltyHtml = '';
    if (result.loyaltyEarned && result.loyaltyEarned.points > 0) {
      loyaltyHtml = '<div style="margin-top:16px;padding:14px;background:var(--surface-card,#FAF6F0);border-radius:8px;border:1px solid var(--border-subtle,#E8E0D4);">' +
        '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;">Rewards Earned</div>' +
        '<div style="font-size:1.2rem;font-weight:600;color:var(--accent,#C6A96C);margin-top:4px;">+' + result.loyaltyEarned.points + ' ' + esc(result.loyaltyEarned.pointName || 'Points') + '</div>' +
      '</div>';
    }

    body.innerHTML =
      '<div style="text-align:center;padding:40px 20px;">' +
        '<div style="font-size:2.5rem;margin-bottom:16px;">&#10003;</div>' +
        '<h3 style="margin:0 0 8px;font-size:1.2rem;">Order Confirmed!</h3>' +
        '<p style="font-size:0.9rem;color:var(--warm-gray);">Order #' + esc(result.orderNumber || '') + '</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray);margin-top:12px;">Paid in full with wallet balance. No card charge.</p>' +
        loyaltyHtml +
        '<div style="margin-top:16px;padding:16px;background:rgba(22,163,74,0.1);border-radius:8px;">' +
          '<div style="font-size:0.85rem;color:var(--charcoal);">A confirmation email will be sent to ' + esc(checkoutData.email || '') + '</div>' +
        '</div>' +
      '</div>';

    if (footer) {
      footer.style.display = '';
      footer.innerHTML = '<button class="checkout-btn-primary" onclick="window.location.reload()">Done</button>';
    }

    trackCheckoutEvent('wallet_order_placed');
  }

  function placeCheckOrder() {
    isSubmitting = true;
    var btn = document.querySelector('[data-co="place-order"]');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="checkout-spinner"></span> Placing Order...';
    }

    var items = window.MastCart.getItems();
    var user = window.MastCart.getCurrentUser();
    var subtotalCents = calcSubtotal();
    var shippingCents = checkoutData.shippingMethod ? checkoutData.shippingMethod.price : 0;
    var totalCents = subtotalCents + shippingCents;

    var orderNumber = 'WS-' + Date.now().toString(36).toUpperCase();

    var orderData = {
      orderNumber: orderNumber,
      status: 'pending_check_verification',
      paymentMethod: 'check',
      type: 'wholesale',
      source: 'wholesale_catalog',
      buyerName: checkoutData.shipping.name || '',
      buyerEmail: checkoutData.email || '',
      email: checkoutData.email || '',
      buyerPhone: '',
      shipping: checkoutData.shipping,
      billing: checkoutData.billing,
      items: items.map(function(it) {
        return {
          pid: it.pid,
          name: it.name,
          productName: it.name,
          options: it.options || {},
          selectedOptions: it.options || {},
          priceCents: it.priceCents || 0,
          qty: it.qty || 1,
          isWholesale: it.isWholesale || false
        };
      }),
      subtotalCents: subtotalCents,
      shippingCents: shippingCents,
      totalCents: totalCents,
      total: totalCents / 100,
      shippingMethod: checkoutData.shippingMethod || null,
      uid: user ? user.uid : 'anonymous',
      resaleCertNumber: checkoutData.resaleCertNumber || '',
      taxExempt: true,
      taxCents: 0,
      placedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    // Write to Firebase orders (same path as retail, with type: 'wholesale')
    if (!ensureMastDB()) {
      isSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Place Order (Pay by Check)'; }
      window.MastCart.showToast('Database not available', true);
      return;
    }

    var orderKey = MastDB.newKey('orders');
    MastDB.set('orders/' + orderKey, orderData).then(function() {
      isSubmitting = false;
      window.MastCart.clear();
      trackCheckoutEvent('wholesale_check_order_placed');

      // Save wholesale buyer as a customer/contact: address + optional resale cert.
      // admin paths are admin-only in Firestore — route through CF.
      if (user && user.email) {
        var wsSavePayload = {
          action: 'save',
          email: user.email,
          address: {
            address1: checkoutData.shipping.address1 || '',
            address2: checkoutData.shipping.address2 || '',
            city: checkoutData.shipping.city || '',
            state: checkoutData.shipping.state || '',
            zip: checkoutData.shipping.zip || '',
            country: 'US'
          }
        };
        if (checkoutData.resaleCertNumber) {
          wsSavePayload.resaleCertNumber = checkoutData.resaleCertNumber;
        }
        callFunction('upsertCustomerAccount', wsSavePayload, function() { /* best-effort — order already placed */ });
      }

      // Provision CustomerPass records for any pass items
      provisionCustomerPasses(items, orderKey);
      provisionSeriesEnrollments(items, orderKey);
      // Wallet consumption handled server-side for pay-by-card orders.
      // Check orders bypass submitOrder, so wallet isn't typically used here.

      // Show confirmation
      renderCheckOrderConfirmation(orderNumber);
    }).catch(function(err) {
      isSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Place Order (Pay by Check)'; }
      window.MastCart.showToast('Order failed: ' + err.message, true);
    });
  }

  function renderCheckOrderConfirmation(orderNumber) {
    currentStep = 'confirmation';
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body) return;

    body.innerHTML =
      '<div class="checkout-confirmation">' +
        '<div class="confirmation-icon">&#10003;</div>' +
        '<div class="confirmation-title">Order Placed!</div>' +
        '<div class="confirmation-order-id">Order: ' + esc(orderNumber) + '</div>' +
        '<div class="confirmation-message">' +
          'Thank you for your wholesale order! Your order is being held pending check payment.<br><br>' +
          '<strong>Please mail your check to:</strong><br>' +
          ((typeof TENANT_BRAND !== 'undefined') ? TENANT_BRAND.name : 'Shop') + '<br>' +
          ((typeof TENANT_BRAND !== 'undefined' && TENANT_BRAND.address) ? TENANT_BRAND.address.replace(/\n/g, '<br>') + '<br><br>' : '') +
          'A confirmation has been sent to <strong>' + esc(checkoutData.email) + '</strong>.<br>' +
          'Your order will be processed once payment is verified.' +
        '</div>' +
      '</div>';

    if (footer) {
      footer.style.display = '';
      footer.innerHTML =
        '<button class="checkout-btn-primary" data-co="conf-done">Continue Browsing</button>';
    }
  }

  // ── Render: Confirmation ──
  function renderConfirmation(orderId) {
    currentStep = 'confirmation';
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body) return;

    body.innerHTML =
      '<div class="checkout-confirmation">' +
        '<div class="confirmation-icon">&#10003;</div>' +
        '<div class="confirmation-title">Order Placed!</div>' +
        '<div class="confirmation-order-id">Order: ' + esc(orderId) + '</div>' +
        '<div class="confirmation-message">' +
          'Thank you for your order! A confirmation will be sent to <strong>' + esc(checkoutData.email) + '</strong>.' +
        '</div>' +
      '</div>';

    if (footer) {
      footer.style.display = '';
      footer.innerHTML =
        '<button class="checkout-btn-primary" data-co="conf-done">Continue Shopping</button>';
    }
  }

  // ── Analytics ──
  function trackCheckoutEvent(action) {
    try {
      if (!ensureMastDB()) return;
      var page = location.pathname.split('/').pop().replace('.html', '') || 'index';
      if (page.length > 20) page = page.substring(0, 20);
      var now = new Date();
      var d = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
      var hit = { t: 'ev', p: page, ts: Date.now(), d: d, a: action };
      if (hit.a && hit.a.length > 40) hit.a = hit.a.substring(0, 40);
      MastDB.push('analytics/hits', hit).catch(function () {});
    } catch (e) { /* silent */ }
  }

  // ── Cancel / Reset ──
  function cancelCheckout() {
    currentStep = 'cart';
    // Restore cart drawer
    var titleEl = document.querySelector('.cart-drawer-title');
    var countEl = document.getElementById('cartDrawerCount');
    if (titleEl) titleEl.textContent = 'Your Cart';
    window.MastCart.refreshDrawer();
  }

  function resetCheckout() {
    currentStep = 'cart';
    checkoutData = {
      email: '',
      shipping: { name: '', address1: '', address2: '', city: '', state: '', zip: '' },
      billing: { same: true, name: '', address1: '', address2: '', city: '', state: '', zip: '' },
      shippingMethod: null,
      paymentMethod: 'card',
      coupon: null,
      taxRate: 0,
      taxState: '',
      walletCredits: [],
      walletCreditApplied: false,
      seatAttendees: {}
    };
    var titleEl = document.querySelector('.cart-drawer-title');
    if (titleEl) titleEl.textContent = 'Your Cart';
    window.MastCart.refreshDrawer();
  }

  // ── Delegated Click Handler ──
  // Single handler on the drawer body — survives innerHTML replacements.
  // Uses a WeakSet to track which elements have listeners, so we can
  // safely re-call attachDelegate() without duplicating handlers.
  var _delegatedElements = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  function handleCheckoutClick(e) {
    var btn = e.target.closest('[data-co]');
    if (!btn) return;
    var action = btn.getAttribute('data-co');

    if (action === 'toggle-wallet') {
      checkoutData.walletCreditApplied = !!btn.checked;
      if (currentStep === 'review') { renderReview(); } else { debouncedBreakdownRefresh(); }
      return;
    } else if (action === 'toggle-loyalty') {
      checkoutData.loyaltyApplied = !!btn.checked;
      if (currentStep === 'review') { renderReview(); } else { debouncedBreakdownRefresh(); }
      return;
    } else if (action === 'toggle-giftcard') {
      checkoutData.walletGiftCardApplied = !!btn.checked;
      if (currentStep === 'review') { renderReview(); } else { debouncedBreakdownRefresh(); }
      return;
    } else if (action === 'toggle-pass') {
      checkoutData.passApplied = !!btn.checked;
      if (currentStep === 'review') { renderReview(); } else { debouncedBreakdownRefresh(); }
      return;
    } else if (action === 'dismiss-membership-upsell') {
      try { localStorage.setItem('mast_membership_upsell_dismissed', '1'); } catch (_) {}
      var upsell = document.getElementById('coMembershipUpsell');
      if (upsell) upsell.remove();
      return;
    } else if (action === 'apply-coupon') {
      applyCoupon();
    } else if (action === 'apply-wallet-coupon') {
      var walletCode = btn.getAttribute('data-coupon-code');
      if (walletCode) {
        // Find the saved coupon to get its source for tracking
        var matchedCoupon = checkoutData.savedCoupons.find(function(sc) { return sc.code === walletCode; });
        checkoutData.couponSource = matchedCoupon ? (matchedCoupon.source || 'direct') : 'direct';
        var input = document.getElementById('coCouponInput');
        if (input) input.value = walletCode;
        applyCoupon();
        // Hide saved coupons after applying
        var savedEl = document.getElementById('coSavedCoupons');
        if (savedEl) savedEl.style.display = 'none';
      }
    } else if (action === 'addr-next') {
      if (validateAddress()) {
        saveAddressData();
        // Skip shipping for non-shippable carts (classes + passes)
        if (window.MastCart && window.MastCart.isNonShippableCart()) {
          checkoutData.shippingMethod = { key: 'none', label: 'No shipping required', price: 0 };
          renderReview();
        } else {
          renderShipping();
        }
      }
    } else if (action === 'addr-back') {
      saveAddressData(); cancelCheckout();
    } else if (action === 'ship-next') {
      if (!checkoutData.shippingMethod) { window.MastCart.showToast('Shipping is still loading, please wait'); return; }
      renderReview();
    } else if (action === 'ship-back') {
      renderAddress();
    } else if (action === 'place-order') {
      placeOrder();
    } else if (action === 'review-back') {
      // If non-shippable cart, go back to address (skipping shipping)
      if (window.MastCart && window.MastCart.isNonShippableCart()) {
        renderAddress();
      } else {
        renderShipping();
      }
    } else if (action === 'conf-done') {
      resetCheckout(); window.MastCart.closeDrawer();
    } else if (action === 'edit-address') {
      renderAddress();
    } else if (action === 'edit-shipping') {
      renderShipping();
    }

    // CSV download button
    if (action === 'download-csv') {
      var csvData = sessionStorage.getItem('mast_csv_data');
      var csvName = sessionStorage.getItem('mast_csv_name') || 'pirateship-order.csv';
      if (csvData) downloadCSV(csvData, csvName);
    }
  }

  function attachDelegate() {
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body || !footer) return;

    // Attach to body if not already attached
    if (!_delegatedElements || !_delegatedElements.has(body)) {
      body.addEventListener('click', handleCheckoutClick);
      body.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.id === 'coCouponInput') {
          e.preventDefault();
          applyCoupon();
        }
      });
      if (_delegatedElements) _delegatedElements.add(body);
    }

    // Attach to footer if not already attached
    if (!_delegatedElements || !_delegatedElements.has(footer)) {
      footer.addEventListener('click', handleCheckoutClick);
      if (_delegatedElements) _delegatedElements.add(footer);
    }
  }

  // ── CustomerPass Provisioning ──
  // After checkout completes, create CustomerPass records for any pass items.
  // Reads the pass definition from public/passDefinitions to get activation rules.
  function provisionCustomerPasses(items, orderId) {
    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user || user.isAnonymous) return;
    if (!ensureMastDB()) return;

    var passItems = (items || []).filter(function(it) {
      return it.bookingType === 'pass' && it.passDefinitionId;
    });
    if (passItems.length === 0) return;

    passItems.forEach(function(item) {
      // Idempotency: check if server already provisioned a pass for this order+definition
      MastDB.query('public/accounts/' + user.uid + '/passes')
        .orderByChild('orderId').equalTo(orderId || '__none__').limitToLast(10).once()
        .then(function(existMap) {
          existMap = existMap || {};
          var alreadyProvisioned = Object.keys(existMap).some(function(k) {
            return existMap[k].passDefinitionId === item.passDefinitionId;
          });
          if (alreadyProvisioned) {
            console.log('[checkout] Pass already provisioned for', item.passDefinitionId, '— skipping');
            return;
          }

          return MastDB.get('public/passDefinitions/' + item.passDefinitionId)
            .then(function(def) {
              if (!def) {
                console.warn('[checkout] Pass definition not found:', item.passDefinitionId);
                return;
              }

              var now = new Date().toISOString();
              var activatedAt = null;
              var expiresAt = null;

              // Purchase-triggered activation: compute dates now
              if (def.activationTrigger === 'purchase' || !def.activationTrigger) {
                activatedAt = now;
                if (def.validityDays) {
                  var exp = new Date();
                  exp.setDate(exp.getDate() + def.validityDays);
                  expiresAt = exp.toISOString();
                }
              }
              // first_use: activatedAt and expiresAt stay null until first deduction

              var passData = {
                passDefinitionId: item.passDefinitionId,
                passDefinitionName: def.name || item.name || '',
                status: 'active',
                visitsUsed: 0,
                visitsRemaining: def.visitCount || null,
                purchasedAt: now,
                activatedAt: activatedAt,
                expiresAt: expiresAt,
                autoRenewEnabled: def.autoRenew || false,
                priority: def.priority || 'medium',
                orderId: orderId || null
              };

              var passId = MastDB.newKey('public/accounts/' + user.uid + '/wallet/passes');
              return MastDB.set('public/accounts/' + user.uid + '/passes/' + passId, passData)
                .then(function() { console.log('[checkout] CustomerPass created:', passId); });
            });
        })
        .catch(function(err) {
          console.error('[checkout] Pass provisioning failed:', err);
        });
    });
  }

  // ── Gift Card Issuance (client-side for $0 orders) ──
  // For wallet-paid orders, Square webhook doesn't fire so we issue gift cards here.
  // Self-purchase: add to buyer's wallet. Gift: call cloud function for email delivery.
  function issueGiftCardsClientSide(items, orderId, orderNumber) {
    var gcItems = items.filter(function(i) { return i.bookingType === 'gift-card' || i.isGiftCard; });
    if (gcItems.length === 0) return;
    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user) return;
    if (!ensureMastDB()) return;
    var now = new Date().toISOString();
    var expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 2);
    var expiresIso = expiresAt.toISOString();

    gcItems.forEach(function(item) {
      var qty = item.qty || 1;
      var amountCents = item.priceCents || 0;
      var giftType = (item.options && item.options.giftType) || 'self';
      var recipientEmail = (item.options && item.options.recipientEmail) || '';

      for (var i = 0; i < qty; i++) {
        // Generate a simple code (server generates better ones, but this works for $0 orders)
        var chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        var code = '';
        for (var c = 0; c < 16; c++) code += chars.charAt(Math.floor(Math.random() * chars.length));
        code = code.slice(0,4) + '-' + code.slice(4,8) + '-' + code.slice(8,12) + '-' + code.slice(12,16);

        var isSelf = giftType === 'self';

        if (isSelf) {
          // Add to buyer's wallet
          MastDB.push('public/accounts/' + user.uid + '/wallet/giftCards', {
            code: code, amountCents: amountCents, remainingCents: amountCents,
            sourceOrderId: orderId, issuedAt: now, expiresAt: expiresIso,
            status: 'active', claimedAt: now
          });
        } else if (recipientEmail) {
          // For gift-type on $0 orders, write tracking and trigger email via cloud function
          MastDB.set('public/accounts/' + user.uid + '/giftCardsSent/' + code, {
            recipientEmail: recipientEmail, amountCents: amountCents,
            status: 'sent', issuedAt: now
          });
          callFunction('issueGiftCardEmail', {
            tenantId: TENANT_ID, code: code, amountCents: amountCents,
            recipientEmail: recipientEmail,
            senderName: (item.options && item.options.senderName) || checkoutData.shipping.name || '',
            senderMessage: (item.options && item.options.senderMessage) || '',
            orderId: orderId,
            uid: user.uid
          }, function() { /* fire and forget */ });
        }
      }
    });
  }

  // ── Student Auto-Create ──
  // After enrollment, ensure a student record exists for this user.
  function ensureStudentRecord(user) {
    if (!user || user.isAnonymous || !user.uid) return;
    if (!ensureMastDB()) return;
    MastDB.query('students').orderByChild('uid').equalTo(user.uid).limitToFirst(1).once()
      .then(function(existing) {
        if (existing && Object.keys(existing).length > 0) return; // Student record already exists
        // Create minimal student record
        var studentId = 'stu_' + Date.now();
        MastDB.set('students/' + studentId, {
          uid: user.uid,
          displayName: user.displayName || '',
          email: user.email || '',
          waiverStatus: 'pending',
          safetyOrientationCompleted: false,
          status: 'active',
          onboardingChecklist: {
            liabilityWaiver: 'pending',
            safetyOrientation: 'pending',
            photoRelease: 'pending'
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }).then(function() {
          console.log('[checkout] Auto-created student record:', studentId);
        }).catch(function(err) {
          console.error('[checkout] Failed to auto-create student:', err);
        });
      })
      .catch(function(err) {
        console.error('[checkout] Student lookup failed:', err);
      });
  }

  // ── Series Auto-Enrollment ──
  // After checkout for a series item, enroll the student in all future sessions.
  function provisionSeriesEnrollments(items, orderId) {
    var user = window.MastCart && window.MastCart.getCurrentUser();
    if (!user || user.isAnonymous) return;
    if (!ensureMastDB()) return;

    var seriesItems = (items || []).filter(function(it) {
      return it.bookingType === 'class' && it.classId && !it.sessionId;
    });
    if (seriesItems.length === 0) return;

    // Auto-create student record if needed
    ensureStudentRecord(user);

    var today = new Date().toISOString().slice(0, 10);

    seriesItems.forEach(function(item) {
      var classId = item.classId.replace('-series', '');

      // Increment seriesEnrolled on the class (atomic)
      MastDB.transaction('public/classes/' + classId + '/seriesEnrolled',
        function(current) { return (current || 0) + 1; });

      // Find all future sessions for this class and create enrollments
      MastDB.query('public/classSessions').orderByChild('classId').equalTo(classId).once()
        .then(function(sessData) {
          sessData = sessData || {};
          var futureSessions = Object.keys(sessData).filter(function(sid) {
            var s = sessData[sid];
            return s.status === 'scheduled' && s.date >= today;
          });

          futureSessions.forEach(function(sid) {
            // Idempotency: check if server already created this enrollment
            MastDB.query('public/enrollments')
              .orderByChild('sessionId').equalTo(sid).limitToLast(10).once()
              .then(function(enrMap) {
                enrMap = enrMap || {};
                var exists = Object.keys(enrMap).some(function(k) {
                  var e = enrMap[k];
                  return e.studentUid === user.uid && e.status === 'confirmed';
                });
                if (exists) {
                  console.log('[checkout] Enrollment already exists for session:', sid, '— skipping');
                  return;
                }
                var enrollId = MastDB.newKey('public/enrollments');
                return MastDB.set('public/enrollments/' + enrollId, {
                  classId: classId,
                  sessionId: sid,
                  studentUid: user.uid,
                  studentName: user.displayName || '',
                  studentEmail: user.email || '',
                  status: 'confirmed',
                  enrollmentType: 'series',
                  paymentMethod: 'checkout',
                  orderId: orderId || null,
                  pricePaid: 0,
                  enrolledAt: new Date().toISOString()
                });
              }).catch(function(err) {
                console.error('[checkout] Series enrollment failed for session:', sid, err);
              });
          });

          console.log('[checkout] Series enrolled in', futureSessions.length, 'sessions for class:', classId);
        })
        .catch(function(err) {
          console.error('[checkout] Failed to load sessions for series enrollment:', err);
        });
    });
  }

  // ── Payment Return Handler ──
  // Detects ?payment=success&order={orderId} after payment checkout redirect (Square or Stripe)
  function checkPaymentReturn() {
    // Skip on orders.html — that page handles payment return itself
    if (window.location.pathname.indexOf('orders.html') !== -1) return;

    var params = new URLSearchParams(window.location.search);
    var paymentStatus = params.get('payment');
    var orderId = params.get('order');

    if (paymentStatus === 'success' && orderId) {
      // Clean URL without reloading
      window.history.replaceState({}, document.title, window.location.pathname);

      // Get order details from sessionStorage
      var pendingOrder = null;
      try {
        var stored = sessionStorage.getItem('mast_pending_order');
        if (stored) {
          pendingOrder = JSON.parse(stored);
          sessionStorage.removeItem('mast_pending_order');
        }
      } catch (e) { /* silent */ }

      var email = pendingOrder ? pendingOrder.email : '';
      var orderNumber = pendingOrder ? pendingOrder.orderNumber : orderId;

      // Open cart drawer and show payment confirmation
      if (window.MastCart && window.MastCart.openDrawer) {
        window.MastCart.openDrawer();
      }

      setTimeout(function () {
        renderPaymentConfirmation(orderNumber, email, orderId, pendingOrder);
      }, 150);
    }
  }

  function renderPaymentConfirmation(orderNumber, email, orderId, pendingOrder) {
    currentStep = 'confirmation';
    attachDelegate();
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body) return;

    var titleEl = document.querySelector('.cart-drawer-title');
    var countEl = document.getElementById('cartDrawerCount');
    if (titleEl) titleEl.textContent = 'Order Confirmed';
    if (countEl) countEl.textContent = '';

    body.innerHTML =
      '<div class="checkout-confirmation">' +
        '<div class="confirmation-icon">&#10003;</div>' +
        '<div class="confirmation-title">Payment Received!</div>' +
        '<div class="confirmation-order-id">Order: ' + esc(orderNumber) + '</div>' +
        '<div class="confirmation-message">' +
          'Thank you for your order!' +
          (email ? ' A confirmation will be sent to <strong>' + esc(email) + '</strong>.' : '') +
        '</div>' +
        '<div id="loyaltyEarnedBadge"></div>' +
        '<div id="csvStatus" style="font-size:0.8rem;color:#9B958E;margin-top:12px;">Preparing shipping label data...</div>' +
      '</div>';

    // Load loyalty earned from order record
    if (orderId && ensureMastDB()) {
      MastDB.get('orders/' + orderId + '/loyaltyEarned').then(function(earned) {
        if (earned && earned.points > 0) {
          var el = document.getElementById('loyaltyEarnedBadge');
          if (el) {
            el.innerHTML = '<div style="margin-top:16px;padding:14px;background:var(--surface-card,#FAF6F0);border-radius:8px;border:1px solid var(--border-subtle,#E8E0D4);">' +
              '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;">Rewards Earned</div>' +
              '<div style="font-size:1.2rem;font-weight:600;color:var(--accent,#C6A96C);margin-top:4px;">+' + earned.points + ' ' + esc(earned.pointName || 'Points') + '</div>' +
            '</div>';
          }
        }
      });
    }

    if (footer) {
      footer.style.display = '';
      footer.innerHTML =
        '<button class="checkout-btn-primary" data-co="conf-done">Continue Shopping</button>';
    }

    // Provision CustomerPass records for any pass items
    if (pendingOrder && pendingOrder.cartItems) {
      provisionCustomerPasses(pendingOrder.cartItems, orderId);
      provisionSeriesEnrollments(pendingOrder.cartItems, orderId);
    }

    // Wallet consumption and loyalty are now handled server-side in submitOrder.
    // No client-side consumption needed after payment redirect.

    // Watch for order status to become 'placed' and generate CSV
    if (orderId && pendingOrder && pendingOrder.items) {
      watchOrderAndDownloadCSV(orderId, pendingOrder);
    }

    trackCheckoutEvent('payment_success');
  }

  // ── Google Places Integration ──
  function loadGooglePlaces(callback) {
    if (placesLoaded) { callback(); return; }
    if (!placesApiKey) {
      // 1. Check platform-level key (set by storefront-tenant.js from publicConfig)
      if (window.MAST_GOOGLE_MAPS_KEY) {
        placesApiKey = window.MAST_GOOGLE_MAPS_KEY;
        injectPlacesScript(callback);
        return;
      }
      // 2. Fallback: tenant-level key in Firebase
      if (!ensureMastDB()) { callback(); return; }
      MastDB.get('public/config/googleMapsApiKey').then(function (key) {
        placesApiKey = key;
        if (!placesApiKey) { callback(); return; }
        injectPlacesScript(callback);
      }).catch(function () { callback(); });
    } else {
      injectPlacesScript(callback);
    }
  }

  function injectPlacesScript(callback) {
    var script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + placesApiKey + '&libraries=places&callback=__mastPlacesReady';
    window.__mastPlacesReady = function () {
      placesLoaded = true;
      callback();
    };
    script.onerror = function () { callback(); };
    document.head.appendChild(script);
  }

  function attachPlacesAutocomplete() {
    if (!window.google || !google.maps || !google.maps.places) return;
    var input = document.getElementById('shipAddr1');
    if (!input) return;

    // Use new PlaceAutocompleteElement API if available, fall back to legacy
    if (google.maps.places.PlaceAutocompleteElement) {
      var pac = new google.maps.places.PlaceAutocompleteElement({
        includedRegionCodes: ['us'],
        includedPrimaryTypes: ['street_address']
      });
      pac.style.cssText = 'width:100%;';
      // Carry over any address1 already loaded (from CF get or localStorage) so
      // the PAC's initial render shows the saved street — the plain input's
      // .value doesn't transfer through replaceChild.
      var carryAddr1 = (input.value || '') || (checkoutData.shipping && checkoutData.shipping.address1) || '';
      if (carryAddr1) {
        pac.setAttribute('value', carryAddr1);
        pac.value = carryAddr1;
      }
      input.parentNode.replaceChild(pac, input);
      pac.id = 'shipAddr1Pac';
      if (carryAddr1) checkoutData._addressValidated = true;

      pac.addEventListener('gmp-select', function (e) {
        var prediction = e.placePrediction || (e.detail && e.detail.placePrediction);
        if (!prediction) return;
        var place = prediction.toPlace();
        place.fetchFields({ fields: ['addressComponents'] }).then(function () {
          fillAddressFromPlace(place);
          checkoutData._addressValidated = true;
        });
      });
    } else {
      // Legacy fallback
      var autocomplete = new google.maps.places.Autocomplete(input, {
        types: ['address'],
        componentRestrictions: { country: 'us' }
      });
      autocomplete.addListener('place_changed', function () {
        var place = autocomplete.getPlace();
        if (place && place.address_components) {
          fillAddressFromPlace(place);
          checkoutData._addressValidated = true;
        }
      });
    }
    // Reset validation if user manually edits
    ['shipAddr1', 'shipAddr1Pac', 'shipCity', 'shipState', 'shipZip'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        var lastKnown = el.value || '';
        el.addEventListener('input', function () {
          if ((el.value || '') !== lastKnown) {
            checkoutData._addressValidated = false;
            lastKnown = el.value || '';
          }
        });
      }
    });
  }

  function fillAddressFromPlace(place) {
    // Support both old (address_components/long_name) and new (addressComponents/longText) API
    var raw = place.addressComponents || place.address_components || [];
    var components = {};
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      var types = c.types || [];
      for (var j = 0; j < types.length; j++) {
        components[types[j]] = { long: c.longText || c.long_name || '', short: c.shortText || c.short_name || '' };
      }
    }
    var streetNum = components.street_number ? components.street_number.long : '';
    var route = components.route ? components.route.long : '';
    var setVal = function (id, val) { var el = document.getElementById(id); if (el) el.value = val; };
    var addr1 = (streetNum + ' ' + route).trim();
    var city = components.locality ? components.locality.long : (components.sublocality_level_1 ? components.sublocality_level_1.long : '');
    var state = components.administrative_area_level_1 ? components.administrative_area_level_1.short : '';
    var zip = components.postal_code ? components.postal_code.long : '';
    setVal('shipAddr1', addr1);
    var pacEl = document.getElementById('shipAddr1Pac');
    if (pacEl && pacEl.value !== undefined) pacEl.value = addr1;
    setVal('shipCity', city);
    var stateEl = document.getElementById('shipState');
    if (stateEl && state) stateEl.value = state;
    setVal('shipZip', zip);
    // Write directly to checkoutData — the PAC element replaces shipAddr1,
    // so saveAddressData may not find it in the DOM
    checkoutData.shipping.address1 = addr1;
    checkoutData.shipping.city = city;
    checkoutData.shipping.state = state;
    checkoutData.shipping.zip = zip;
  }

  // ── Test Mode Banner ──
  function checkTestMode(callback) {
    if (!ensureMastDB()) { callback(false); return; }
    MastDB.get('public/config/testMode').then(function (val) {
      callback(val === true);
    }).catch(function () { callback(false); });
  }

  function showTestBanner(container) {
    if (document.getElementById('testModeBanner')) return;
    var banner = document.createElement('div');
    banner.id = 'testModeBanner';
    banner.className = 'test-mode-banner';
    banner.innerHTML = '&#9888; TEST MODE &mdash; No real charges will be made';
    container.insertBefore(banner, container.firstChild);
  }

  // ── Pirate Ship CSV Generation ──
  function generatePirateShipCSV(orderData) {
    var s = orderData.shipping || {};
    var items = orderData.items || [];
    var productMap = orderData.itemShippingData || {};
    var config = orderData.shippingConfig || DEFAULT_SHIPPING_CONFIG;

    var totalWeightOz = 0;
    var highestCat = 'small';
    var catOrder = ['small', 'medium', 'large', 'oversized'];

    for (var i = 0; i < items.length; i++) {
      var ps = productMap[items[i].pid] || { weightOz: 16, shippingCategory: 'small' };
      var qty = items[i].qty || 1;
      totalWeightOz += (ps.weightOz || 16) * qty + (config.packingBufferOz || 8) * qty;
      var catIdx = catOrder.indexOf(ps.shippingCategory || 'small');
      if (catIdx > catOrder.indexOf(highestCat)) highestCat = ps.shippingCategory || 'small';
    }

    var box = config[highestCat] || DEFAULT_SHIPPING_CONFIG[highestCat];
    var desc = items.map(function (it) { return it.name + ' x' + (it.qty || 1); }).join(', ');
    if (desc.length > 100) desc = desc.substring(0, 97) + '...';

    // Rubber Stamp 1: ######SG-XXXX###### (USPS 25 char limit)
    var orderNum = orderData.orderNumber || orderData.orderId || '';
    var digits = orderNum.replace(/[^0-9]/g, '');
    while (digits.length < 4) digits = '0' + digits;
    var rubberStamp = '######SG-' + digits + '######';

    var headers = ['Name', 'Company', 'Address1', 'Address2', 'City', 'State', 'Zip', 'Country', 'Phone', 'Weight_oz', 'Length', 'Width', 'Height', 'Description', 'Order_ID', 'Rubber_Stamp_1'];
    var row = [
      s.name || '', '', s.address1 || '', s.address2 || '', s.city || '', s.state || '', s.zip || '',
      'US', '', Math.ceil(totalWeightOz),
      box.boxL || 6, box.boxW || 6, box.boxH || 6,
      desc, orderNum, rubberStamp
    ];

    function csvEsc(val) {
      var str = String(val);
      // Prevent CSV formula injection
      if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
      if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    return headers.map(csvEsc).join(',') + '\n' + row.map(csvEsc).join(',') + '\n';
  }

  function downloadCSV(content, filename) {
    var blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    // Delay cleanup — Safari can open a new tab if the element is removed
    // before the browser finishes processing the programmatic click.
    setTimeout(function() {
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    }, 100);
  }

  function watchOrderAndDownloadCSV(orderId, pendingOrder) {
    if (!ensureMastDB() || !pendingOrder) return;

    var unsub = MastDB.subscribe('orders/' + orderId + '/status', function (status) {
      if (status === 'placed') {
        unsub();
        var csv = generatePirateShipCSV(pendingOrder);
        var csvName = 'pirateship-' + (pendingOrder.orderNumber || orderId) + '.csv';

        // Store for re-download via button
        try {
          sessionStorage.setItem('mast_csv_data', csv);
          sessionStorage.setItem('mast_csv_name', csvName);
        } catch (e) { /* silent */ }

        downloadCSV(csv, csvName);
        showCSVDownloadButton();
      }
    });
    // Safety: auto-detach after 90 seconds
    setTimeout(function () { unsub(); }, 90000);
  }

  function showCSVDownloadButton() {
    var container = document.querySelector('.checkout-confirmation');
    if (!container || document.getElementById('csvDownloadBtn')) return;

    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin-top:16px;text-align:center;';
    wrapper.innerHTML =
      '<button id="csvDownloadBtn" class="checkout-btn-secondary" data-co="download-csv" style="font-size:0.85rem;">' +
        '&#128230; Download Shipping CSV' +
      '</button>' +
      '<div style="font-size:0.75rem;color:#9B958E;margin-top:4px;">For Pirate Ship import</div>';
    container.appendChild(wrapper);
  }

  // ── Public API ──
  window.MastCheckout = {
    start: function () {
      attachDelegate();
      trackCheckoutEvent('checkout_start');
      // Load wallet instruments for authenticated user
      loadWalletCredits();
      loadWalletGiftCards();
      loadLoyaltyData();
      loadSavedCoupons();
      loadCustomerPasses();
      loadMembershipData();
      // Load Google Places lazily, then render address
      loadGooglePlaces(function () {
        renderAddress();
      });
    },
    goToStep: function (step) {
      attachDelegate();
      if (step === 'address') renderAddress();
      else if (step === 'shipping') renderShipping();
      else if (step === 'review') renderReview();
    },
    cancel: cancelCheckout,
    _debug: function() { return { passes: (checkoutData.customerPasses || []).map(function(p) { return { id: p._id, name: p.passDefinitionName, rem: p.visitsRemaining }; }), assignments: checkoutData.passAssignments, passApplied: checkoutData.passApplied }; },
    checkPaymentReturn: checkPaymentReturn,
    retryEngine: function() {
      var tc = document.querySelector('.engine-totals-container');
      if (tc) tc.innerHTML = buildTotalsLoadingHtml();
      callBreakdownEngine(function(breakdown) {
        if (tc) tc.innerHTML = breakdown ? buildTotalsFromBreakdown(breakdown) : buildTotalsErrorHtml();
        if (breakdown) syncCouponMessage(breakdown);
      });
    },
    // Expose CSV helpers for orders page
    watchOrderAndDownloadCSV: watchOrderAndDownloadCSV,
    generatePirateShipCSV: generatePirateShipCSV,
    downloadCSV: downloadCSV
  };

  // Auto-check for payment return on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPaymentReturn);
  } else {
    checkPaymentReturn();
  }

})();
