/* =========================================================
   Shir Glassworks — Checkout Module
   Multi-step checkout within the cart drawer.
   Steps: Cart → Address → Shipping → Review → Confirmation
   Depends on: cart.js (ShirCart), Firebase compat SDK
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
    coupon: null,              // { code, type, value, discount } or null
    taxRate: 0,
    taxState: ''
  };

  var shippingRates = null; // cached from Firebase
  var isSubmitting = false;

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

  function formatMoney(n) {
    return '$' + n.toFixed(2);
  }

  function calcSubtotal() {
    var items = window.ShirCart.getItems();
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      total += parsePrice(items[i].price) * (items[i].qty || 1);
    }
    return Math.round(total * 100) / 100;
  }

  // ── Firebase helpers ──
  function getDb() {
    var app = window.ShirCart.getFirebaseApp();
    return app ? app.database() : null;
  }

  function fetchShippingRates(callback) {
    if (shippingRates) { callback(shippingRates); return; }
    var db = getDb();
    if (!db) { callback({}); return; }
    db.ref('shirglassworks/public/shipping').once('value').then(function (snap) {
      shippingRates = snap.val() || {};
      callback(shippingRates);
    }).catch(function () { callback({}); });
  }

  function fetchTaxRate(state, callback) {
    var db = getDb();
    if (!db || !state) { callback(0); return; }
    db.ref('shirglassworks/public/taxRates/' + state.toUpperCase()).once('value').then(function (snap) {
      callback(snap.val() || 0);
    }).catch(function () { callback(0); });
  }

  function callFunction(name, data, callback) {
    var app = window.ShirCart.getFirebaseApp();
    if (!app) { callback({ success: false, error: 'Firebase not available' }); return; }

    // Use Firebase callable function
    var projectId = 'word-boxing';
    var url = 'https://us-central1-' + projectId + '.cloudfunctions.net/' + name;

    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
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
    xhr.send(JSON.stringify({ data: data }));
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
      '<div class="checkout-form-group small">' +
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

    body.innerHTML = html;

    // Footer
    footer.style.display = '';
    footer.innerHTML =
      '<button class="checkout-btn-primary" data-co="addr-next">Continue to Shipping</button>' +
      '<button class="checkout-back-link" data-co="addr-back">Back to Cart</button>';

    // Billing same checkbox (only element needing change listener)
    document.getElementById('billingSame').addEventListener('change', function () {
      checkoutData.billing.same = this.checked;
      document.getElementById('billingFields').style.display = this.checked ? 'none' : '';
    });
  }

  function saveAddressData() {
    var email = document.getElementById('coEmail');
    if (email) checkoutData.email = email.value.trim();

    var fields = ['Name', 'Addr1', 'Addr2', 'City', 'State', 'Zip'];
    for (var i = 0; i < fields.length; i++) {
      var shipEl = document.getElementById('ship' + fields[i]);
      if (shipEl) {
        var key = fields[i] === 'Addr1' ? 'address1' : fields[i] === 'Addr2' ? 'address2' : fields[i].toLowerCase();
        checkoutData.shipping[key] = shipEl.value.trim();
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

    // Email
    var emailEl = document.getElementById('coEmail');
    if (emailEl) {
      var emailVal = emailEl.value.trim();
      if (!emailVal || !emailVal.includes('@') || !emailVal.includes('.')) {
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
    check('shipAddr1', 'Address required');
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

    return valid;
  }

  // ── Render: Shipping Step ──
  function renderShipping() {
    currentStep = 'shipping';
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body || !footer) return;

    body.innerHTML = stepIndicatorHtml('shipping') +
      '<div class="checkout-section"><div style="text-align:center;color:#9B958E;padding:2rem 0;">Loading shipping options...</div></div>';

    fetchShippingRates(function (rates) {
      var subtotal = calcSubtotal();

      // Also fetch tax for the shipping state
      fetchTaxRate(checkoutData.shipping.state, function (rate) {
        checkoutData.taxRate = rate;
        checkoutData.taxState = checkoutData.shipping.state;

        var html = stepIndicatorHtml('shipping');

        // Shipping options
        html += '<div class="checkout-section">' +
          '<div class="checkout-section-title">Shipping Method</div>' +
          '<div class="shipping-options" id="shippingOptions">';

        var keys = Object.keys(rates);
        // Sort by price ascending
        keys.sort(function (a, b) { return (rates[a].price || 0) - (rates[b].price || 0); });

        for (var i = 0; i < keys.length; i++) {
          var r = rates[keys[i]];
          var sel = checkoutData.shippingMethod && checkoutData.shippingMethod.key === keys[i] ? ' selected' : '';
          html += '<div class="shipping-option' + sel + '" data-ship-key="' + esc(keys[i]) + '">' +
            '<div class="shipping-option-radio"></div>' +
            '<div class="shipping-option-details">' +
              '<div class="shipping-option-label">' + esc(r.label) + '</div>' +
              '<div class="shipping-option-desc">' + esc(r.description) + '</div>' +
            '</div>' +
            '<div class="shipping-option-price">' + formatMoney(r.price || 0) + '</div>' +
          '</div>';
        }
        html += '</div></div>';

        // Coupon
        html += '<div class="checkout-section">' +
          '<div class="checkout-section-title">Coupon Code</div>' +
          '<div class="coupon-row">' +
            '<input class="checkout-input" id="coCouponInput" type="text" placeholder="Enter code" value="' +
              (checkoutData.coupon ? esc(checkoutData.coupon.code) : '') + '">' +
            '<button class="coupon-apply-btn" data-co="apply-coupon">Apply</button>' +
          '</div>' +
          '<div id="coCouponMsg"></div>' +
        '</div>';

        // Totals
        html += '<div class="checkout-section">' + buildTotalsHtml(subtotal) + '</div>';

        body.innerHTML = html;

        // Show existing coupon if any
        if (checkoutData.coupon) {
          var msgEl = document.getElementById('coCouponMsg');
          if (msgEl) {
            msgEl.innerHTML = '<div class="coupon-success">Coupon ' + esc(checkoutData.coupon.code) +
              ' applied: -' + formatMoney(checkoutData.coupon.discount) + '</div>';
          }
        }

        // Select first shipping option if none selected
        if (!checkoutData.shippingMethod && keys.length > 0) {
          var firstEl = document.querySelector('.shipping-option');
          if (firstEl) {
            firstEl.classList.add('selected');
            var firstKey = keys[0];
            checkoutData.shippingMethod = {
              key: firstKey,
              label: rates[firstKey].label,
              description: rates[firstKey].description,
              price: rates[firstKey].price
            };
            updateTotals();
          }
        }
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
      updateTotals();
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    callFunction('shirValidateCoupon', { code: code, subtotal: calcSubtotal() }, function (result) {
      if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }

      if (result && result.valid) {
        checkoutData.coupon = {
          code: code,
          type: result.type,
          value: result.value,
          discount: result.discount
        };
        msgEl.innerHTML = '<div class="coupon-success">Coupon ' + esc(code) +
          ' applied: -' + formatMoney(result.discount) + '</div>';
      } else {
        checkoutData.coupon = null;
        msgEl.innerHTML = '<div class="coupon-error">' + esc(result && result.reason ? result.reason : 'Invalid coupon') + '</div>';
      }
      updateTotals();
    });
  }

  function buildTotalsHtml(subtotal) {
    var shipCost = checkoutData.shippingMethod ? checkoutData.shippingMethod.price : 0;
    var tax = Math.round(subtotal * checkoutData.taxRate * 100) / 100;
    var couponDiscount = checkoutData.coupon ? checkoutData.coupon.discount : 0;
    var total = Math.round((subtotal + tax + shipCost - couponDiscount) * 100) / 100;
    if (total < 0) total = 0;

    var html = '<div class="order-totals">';
    html += '<div class="order-total-row"><span class="order-total-label">Subtotal</span><span class="order-total-value">' + formatMoney(subtotal) + '</span></div>';
    html += '<div class="order-total-row"><span class="order-total-label">Shipping</span><span class="order-total-value">' + (shipCost ? formatMoney(shipCost) : '--') + '</span></div>';

    var taxLabel = 'Tax';
    if (checkoutData.taxState) taxLabel += ' (' + checkoutData.taxState + ')';
    html += '<div class="order-total-row"><span class="order-total-label">' + esc(taxLabel) + '</span><span class="order-total-value">' + formatMoney(tax) + '</span></div>';

    if (couponDiscount > 0) {
      html += '<div class="order-total-row discount"><span class="order-total-label">Coupon (' + esc(checkoutData.coupon.code) + ')</span><span class="order-total-value">-' + formatMoney(couponDiscount) + '</span></div>';
    }

    html += '<div class="order-total-row grand-total"><span class="order-total-label">Total</span><span class="order-total-value">' + formatMoney(total) + '</span></div>';
    html += '</div>';
    return html;
  }

  function updateTotals() {
    var container = document.querySelector('.order-totals');
    if (!container) return;
    var parent = container.parentNode;
    var subtotal = calcSubtotal();
    parent.innerHTML = buildTotalsHtml(subtotal);
  }

  // ── Render: Review Step ──
  function renderReview() {
    currentStep = 'review';
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body || !footer) return;

    var items = window.ShirCart.getItems();
    var subtotal = calcSubtotal();

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

      var lineTotal = parsePrice(item.price) * (item.qty || 1);
      html += '<div class="review-item">' +
        imgHtml +
        '<div class="review-item-info">' +
          '<div class="review-item-name">' + esc(item.name) + '</div>' +
          (optStr ? '<div class="review-item-meta">' + optStr + '</div>' : '') +
          '<div class="review-item-meta">Qty: ' + item.qty + '</div>' +
        '</div>' +
        '<div class="review-item-price">' + formatMoney(lineTotal) + '</div>' +
      '</div>';
    }
    html += '</div>';

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

    // Totals
    html += '<div class="review-section">' + buildTotalsHtml(subtotal) + '</div>';

    html += '</div>'; // close checkout-section

    body.innerHTML = html;

    // Footer
    footer.style.display = '';
    footer.innerHTML =
      '<button class="checkout-btn-primary" data-co="place-order">Place Order</button>' +
      '<button class="checkout-back-link" data-co="review-back">Back to Shipping</button>';
  }

  // ── Place Order ──
  function placeOrder() {
    if (isSubmitting) return;
    isSubmitting = true;

    var btn = document.querySelector('[data-co="place-order"]');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="checkout-spinner"></span> Placing Order...';
    }

    var items = window.ShirCart.getItems();
    var user = window.ShirCart.getCurrentUser();

    var payload = {
      email: checkoutData.email,
      shipping: checkoutData.shipping,
      billing: checkoutData.billing,
      items: items.map(function (it) {
        return { pid: it.pid, name: it.name, options: it.options, price: it.price, qty: it.qty };
      }),
      shippingMethodKey: checkoutData.shippingMethod.key,
      couponCode: checkoutData.coupon ? checkoutData.coupon.code : null,
      uid: user ? user.uid : 'anonymous'
    };

    callFunction('shirSubmitOrder', payload, function (result) {
      isSubmitting = false;
      if (result && result.success) {
        // Clear cart
        window.ShirCart.clear();
        renderConfirmation(result.orderId);
        trackCheckoutEvent('checkout_complete');
      } else {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Place Order';
        }
        window.ShirCart.showToast(result && result.error ? result.error : 'Order failed. Please try again.');
      }
    });
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
      var db = getDb();
      if (!db) return;
      var hitRef = db.ref('shirglassworks/analytics/hits').push();
      var page = location.pathname.split('/').pop().replace('.html', '') || 'index';
      if (page.length > 20) page = page.substring(0, 20);
      var now = new Date();
      var d = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
      var hit = { t: 'ev', p: page, ts: Date.now(), d: d, a: action };
      if (hit.a && hit.a.length > 40) hit.a = hit.a.substring(0, 40);
      hitRef.set(hit).catch(function () {});
    } catch (e) { /* silent */ }
  }

  // ── Cancel / Reset ──
  function cancelCheckout() {
    currentStep = 'cart';
    // Restore cart drawer
    var titleEl = document.querySelector('.cart-drawer-title');
    var countEl = document.getElementById('cartDrawerCount');
    if (titleEl) titleEl.textContent = 'Your Cart';
    window.ShirCart.refreshDrawer();
  }

  function resetCheckout() {
    currentStep = 'cart';
    checkoutData = {
      email: '',
      shipping: { name: '', address1: '', address2: '', city: '', state: '', zip: '' },
      billing: { same: true, name: '', address1: '', address2: '', city: '', state: '', zip: '' },
      shippingMethod: null,
      coupon: null,
      taxRate: 0,
      taxState: ''
    };
    var titleEl = document.querySelector('.cart-drawer-title');
    if (titleEl) titleEl.textContent = 'Your Cart';
    window.ShirCart.refreshDrawer();
  }

  // ── Delegated Click Handler ──
  // Single handler on the drawer body — survives innerHTML replacements.
  var delegateAttached = false;

  function attachDelegate() {
    if (delegateAttached) return;
    var body = document.getElementById('cartDrawerBody');
    var footer = document.getElementById('cartDrawerFooter');
    if (!body) return;
    delegateAttached = true;

    function handleClick(e) {
      var btn = e.target.closest('[data-co]');
      if (!btn) return;
      var action = btn.getAttribute('data-co');

      if (action === 'apply-coupon') {
        applyCoupon();
      } else if (action === 'addr-next') {
        if (validateAddress()) { saveAddressData(); renderShipping(); }
      } else if (action === 'addr-back') {
        saveAddressData(); cancelCheckout();
      } else if (action === 'ship-next') {
        if (!checkoutData.shippingMethod) { window.ShirCart.showToast('Please select a shipping method'); return; }
        renderReview();
      } else if (action === 'ship-back') {
        renderAddress();
      } else if (action === 'place-order') {
        placeOrder();
      } else if (action === 'review-back') {
        renderShipping();
      } else if (action === 'conf-done') {
        resetCheckout(); window.ShirCart.closeDrawer();
      } else if (action === 'edit-address') {
        renderAddress();
      } else if (action === 'edit-shipping') {
        renderShipping();
      }

      // Shipping option selection
      var shipOpt = e.target.closest('[data-ship-key]');
      if (shipOpt && shippingRates) {
        var allOpts = body.querySelectorAll('.shipping-option');
        for (var k = 0; k < allOpts.length; k++) allOpts[k].classList.remove('selected');
        shipOpt.classList.add('selected');
        var key = shipOpt.getAttribute('data-ship-key');
        if (shippingRates[key]) {
          checkoutData.shippingMethod = {
            key: key,
            label: shippingRates[key].label,
            description: shippingRates[key].description,
            price: shippingRates[key].price
          };
          updateTotals();
        }
      }
    }

    body.addEventListener('click', handleClick);
    footer.addEventListener('click', handleClick);

    // Enter key on coupon input
    body.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.id === 'coCouponInput') {
        e.preventDefault();
        applyCoupon();
      }
    });
  }

  // ── Public API ──
  window.ShirCheckout = {
    start: function () {
      attachDelegate();
      trackCheckoutEvent('checkout_start');
      renderAddress();
    },
    goToStep: function (step) {
      attachDelegate();
      if (step === 'address') renderAddress();
      else if (step === 'shipping') renderShipping();
      else if (step === 'review') renderReview();
    },
    cancel: cancelCheckout
  };

})();
