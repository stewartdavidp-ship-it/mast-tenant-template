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
    resaleCertNumber: ''       // wholesale: state tax resale certificate number
  };

  var shippingConfigCache = null; // cached flat-rate config
  var isSubmitting = false;
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

  function formatMoney(n) {
    return '$' + n.toFixed(2);
  }

  function calcSubtotal() {
    var items = window.MastCart.getItems();
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      total += parsePrice(items[i].price) * (items[i].qty || 1);
    }
    return Math.round(total * 100) / 100;
  }

  // ── Firebase helpers ──
  function getDb() {
    var app = window.MastCart.getFirebaseApp();
    return app ? app.database() : null;
  }

  function fetchShippingConfig(callback) {
    if (shippingConfigCache) { callback(shippingConfigCache); return; }
    var db = getDb();
    if (!db) { callback(DEFAULT_SHIPPING_CONFIG); return; }
    db.ref(TENANT_ID + '/public/config/shippingRates').once('value').then(function (snap) {
      shippingConfigCache = snap.val() || DEFAULT_SHIPPING_CONFIG;
      callback(shippingConfigCache);
    }).catch(function () { callback(DEFAULT_SHIPPING_CONFIG); });
  }

  function fetchProductShippingData(pids, callback) {
    var db = getDb();
    if (!db || pids.length === 0) { callback({}); return; }
    var result = {};
    var remaining = pids.length;
    for (var i = 0; i < pids.length; i++) {
      (function (pid) {
        db.ref(TENANT_ID + '/public/products/' + pid).once('value').then(function (snap) {
          var prod = snap.val();
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

  function getShippingThreshold() {
    if (isWholesaleCart()) return 350;
    return shippingConfig && shippingConfig.freeThreshold != null ? shippingConfig.freeThreshold : null;
  }

  function calculateShipping(items, productMap, config) {
    var subtotal = calcSubtotal();
    var ws = isWholesaleCart();
    var threshold = ws ? 350 : (config.freeThreshold != null ? config.freeThreshold : null);
    if (threshold != null && subtotal >= threshold) {
      return { price: 0, label: 'Free Shipping', description: 'Free shipping on orders over ' + formatMoney(threshold), category: 'free' };
    }
    // Wholesale: 10% of subtotal
    if (ws) {
      var wsPrice = Math.round(subtotal * 10) / 100;
      return { price: wsPrice, label: 'Standard Shipping', description: '10% of order subtotal', category: 'wholesale' };
    }
    var catOrder = ['small', 'medium', 'large', 'oversized'];
    var highestIdx = 0;
    var totalItems = 0;
    for (var i = 0; i < items.length; i++) {
      var ps = productMap[items[i].pid] || { shippingCategory: 'small' };
      var idx = catOrder.indexOf(ps.shippingCategory || 'small');
      if (idx > highestIdx) highestIdx = idx;
      totalItems += (items[i].qty || 1);
    }
    var cat = catOrder[highestIdx];
    var catConfig = config[cat] || DEFAULT_SHIPPING_CONFIG[cat];
    var baseRate = catConfig ? catConfig.rate : 6;
    var additional = Math.max(totalItems - 1, 0) * (config.additionalItemSurcharge || 2);
    var price = Math.round((baseRate + additional) * 100) / 100;
    var desc = cat.charAt(0).toUpperCase() + cat.slice(1) + ' package';
    if (totalItems > 1) desc += ' + ' + (totalItems - 1) + ' additional item' + (totalItems > 2 ? 's' : '');
    return { price: price, label: 'Standard Shipping', description: desc, category: cat };
  }

  function fetchTaxRate(state, callback) {
    var db = getDb();
    if (!db || !state) { callback(0); return; }
    db.ref(TENANT_ID + '/public/taxRates/' + state.toUpperCase()).once('value').then(function (snap) {
      callback(snap.val() || 0);
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
    var addrSubtotal = calcSubtotal();
    var addrFreeThreshold = getShippingThreshold();
    if (addrFreeThreshold != null) {
      if (addrSubtotal >= addrFreeThreshold) {
        html += '<div style="text-align:center;color:#2D7D46;font-size:0.75rem;margin:12px 0 4px;letter-spacing:0.08em;">&#10003; FREE SHIPPING on this order!</div>';
      } else if (addrSubtotal > 0) {
        var addrAway = (addrFreeThreshold - addrSubtotal).toFixed(2);
        html += '<div style="text-align:center;color:var(--warm-gray,#9B958E);font-size:0.75rem;margin:12px 0 4px;letter-spacing:0.08em;">You\'re $' + addrAway + ' away from free shipping!</div>';
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
      '<button class="checkout-btn-primary" data-co="addr-next">Continue to Shipping</button>' +
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
        // Load saved address from Firebase customer record
        if (!authUser.isAnonymous && window.MastCart.getFirebaseApp) {
          try {
            var custDb = window.MastCart.getFirebaseApp().database();
            custDb.ref(TENANT_ID + '/customers/' + authUser.uid + '/address').once('value').then(function(snap) {
              var addr = snap.val();
              if (!addr || !addr.address1) return;
              var addrMap = { address1: 'shipAddr1', address2: 'shipAddr2', city: 'shipCity', state: 'shipState', zip: 'shipZip' };
              var filled = false;
              for (var aKey in addrMap) {
                if (addr[aKey] && !checkoutData.shipping[aKey]) {
                  checkoutData.shipping[aKey] = addr[aKey];
                  var aEl = document.getElementById(addrMap[aKey]);
                  if (aEl) {
                    aEl.value = addr[aKey];
                    aEl.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  if (aKey === 'address1') filled = true;
                }
              }
              if (filled) setTimeout(function () { checkoutData._addressValidated = true; }, 0);
            }).catch(function() { /* silent */ });
          } catch (e) { /* silent */ }
        }

        // Fetch resale cert from wholesaleAuthorized record
        if (isWholesaleCart() && authUser.email) {
          try {
            var wsDb = window.MastCart.getFirebaseApp().database();
            var emailKey = authUser.email.toLowerCase().replace(/\./g, ',');
            wsDb.ref(TENANT_ID + '/admin/wholesaleAuthorized/' + emailKey + '/resaleCertNumber').once('value').then(function(snap) {
              var cert = snap.val();
              if (cert && !checkoutData.resaleCertNumber) {
                checkoutData.resaleCertNumber = cert;
                var certEl = document.getElementById('coResaleCert');
                if (certEl) certEl.value = cert;
              }
            }).catch(function() { /* silent */ });
          } catch (e) { /* silent */ }
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

    // Google Places address validation (soft gate)
    if (valid && placesLoaded && !checkoutData._addressValidated) {
      if (!checkoutData._addressValidateAttempts) {
        checkoutData._addressValidateAttempts = 1;
        var addrEl = document.getElementById('shipAddr1');
        if (addrEl) {
          addrEl.classList.add('error');
          var warnDiv = document.createElement('div');
          warnDiv.className = 'checkout-error-msg';
          warnDiv.style.color = '#B3742E';
          warnDiv.textContent = 'Please select an address from the dropdown to validate. Click Continue again to skip.';
          addrEl.parentNode.appendChild(warnDiv);
          addrEl.focus();
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

    // Fetch product shipping data, shipping config, and tax in parallel
    fetchProductShippingData(pids, function (productMap) {
      fetchShippingConfig(function (config) {
        fetchTaxRate(checkoutData.shipping.state, function (rate) {
          // Wholesale orders: no tax (buyers provide resale certificate)
          checkoutData.taxRate = isWholesaleCart() ? 0 : rate;
          checkoutData.taxState = checkoutData.shipping.state;

          // Store for CSV generation later
          checkoutData.itemShippingData = productMap;
          checkoutData.shippingConfig = config;

          // Calculate flat-rate shipping
          var shipResult = calculateShipping(items, productMap, config);
          checkoutData.shippingMethod = {
            key: 'calculated',
            label: shipResult.label,
            description: shipResult.description,
            price: shipResult.price
          };

          var subtotal = calcSubtotal();
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
      updateTotals();
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    callFunction('validateCoupon', { code: code, subtotal: calcSubtotal() }, function (result) {
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
    var totFreeThreshold = getShippingThreshold();
    if (totFreeThreshold != null) {
      if (subtotal >= totFreeThreshold) {
        html += '<div style="text-align:center;color:#2D7D46;font-size:0.75rem;margin-top:8px;letter-spacing:0.08em;">&#10003; FREE SHIPPING</div>';
      } else if (subtotal > 0) {
        var away = (totFreeThreshold - subtotal).toFixed(2);
        html += '<div style="text-align:center;color:var(--warm-gray,#9B958E);font-size:0.75rem;margin-top:8px;letter-spacing:0.08em;">You\'re $' + away + ' away from free shipping!</div>';
      }
    }
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
    attachDelegate(); // ensure delegation is live before rendering Place Order button

    var items = window.MastCart.getItems();
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

    // Totals
    html += '<div class="review-section">' + buildTotalsHtml(subtotal) + '</div>';

    html += '</div>'; // close checkout-section

    body.innerHTML = html;

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
      items: items.map(function (it) {
        return { pid: it.pid, name: it.name, options: it.options, price: it.price, qty: it.qty, isWholesale: it.isWholesale || false };
      }),
      shippingMethodKey: 'calculated',
      couponCode: checkoutData.coupon ? checkoutData.coupon.code : null,
      uid: user ? user.uid : 'anonymous',
      isWholesale: isWholesaleCart(),
      resaleCertNumber: checkoutData.resaleCertNumber || ''
    };

    callFunction('submitOrder', payload, function (result) {
      isSubmitting = false;
      if (result && result.success && result.checkoutUrl) {
        // Save order info for post-payment confirmation
        try {
          sessionStorage.setItem('mast_pending_order', JSON.stringify({
            orderId: result.orderId,
            orderNumber: result.orderNumber,
            email: checkoutData.email,
            items: payload.items,
            shipping: checkoutData.shipping,
            itemShippingData: checkoutData.itemShippingData || {},
            shippingConfig: checkoutData.shippingConfig || DEFAULT_SHIPPING_CONFIG
          }));
        } catch (e) { /* sessionStorage not available */ }

        // Clear cart before redirect but keep checkout info for returning customer auto-fill
        window.MastCart.clear();

        // Save address to Firebase customer record for logged-in users
        if (user && !user.isAnonymous && window.MastCart.getFirebaseApp) {
          try {
            var custDb = window.MastCart.getFirebaseApp().database();
            custDb.ref(TENANT_ID + '/customers/' + user.uid + '/address').update({
              address1: checkoutData.shipping.address1 || '',
              address2: checkoutData.shipping.address2 || '',
              city: checkoutData.shipping.city || '',
              state: checkoutData.shipping.state || '',
              zip: checkoutData.shipping.zip || '',
              country: 'US'
            });
            // Update wholesaler resale cert if provided
            if (checkoutData.resaleCertNumber && user.email) {
              var emailKey = user.email.toLowerCase().replace(/\./g, ',');
              custDb.ref(TENANT_ID + '/admin/wholesaleAuthorized/' + emailKey + '/resaleCertNumber')
                .set(checkoutData.resaleCertNumber);
            }
          } catch (e) { /* silent */ }
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
  function placeCheckOrder() {
    isSubmitting = true;
    var btn = document.querySelector('[data-co="place-order"]');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="checkout-spinner"></span> Placing Order...';
    }

    var items = window.MastCart.getItems();
    var user = window.MastCart.getCurrentUser();
    var subtotal = calcSubtotal();
    var shippingCost = checkoutData.shippingMethod ? checkoutData.shippingMethod.price : 0;
    var totalCents = Math.round((subtotal + shippingCost) * 100);

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
          priceCents: it.priceCents || Math.round(parsePrice(it.price) * 100),
          price: (it.priceCents || Math.round(parsePrice(it.price) * 100)) / 100,
          qty: it.qty || 1,
          isWholesale: it.isWholesale || false
        };
      }),
      subtotalCents: Math.round(subtotal * 100),
      shippingCents: Math.round(shippingCost * 100),
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
    var db = getDb();
    if (!db) {
      isSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Place Order (Pay by Check)'; }
      window.MastCart.showToast('Database not available', true);
      return;
    }

    var orderRef = db.ref(TENANT_ID + '/orders').push();
    orderRef.set(orderData).then(function() {
      isSubmitting = false;
      window.MastCart.clear();
      trackCheckoutEvent('wholesale_check_order_placed');

      // Update wholesaler resale cert if provided
      if (checkoutData.resaleCertNumber && user && user.email && window.MastCart.getFirebaseApp) {
        try {
          var wsDb = window.MastCart.getFirebaseApp().database();
          var emailKey = user.email.toLowerCase().replace(/\./g, ',');
          wsDb.ref(TENANT_ID + '/admin/wholesaleAuthorized/' + emailKey + '/resaleCertNumber')
            .set(checkoutData.resaleCertNumber);
        } catch (e) { /* silent — order already placed successfully */ }
      }

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
      var db = getDb();
      if (!db) return;
      var hitRef = db.ref(TENANT_ID + '/analytics/hits').push();
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
      taxState: ''
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

    if (action === 'apply-coupon') {
      applyCoupon();
    } else if (action === 'addr-next') {
      if (validateAddress()) { saveAddressData(); renderShipping(); }
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
      renderShipping();
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
        '<div id="csvStatus" style="font-size:0.8rem;color:#9B958E;margin-top:12px;">Preparing shipping label data...</div>' +
      '</div>';

    if (footer) {
      footer.style.display = '';
      footer.innerHTML =
        '<button class="checkout-btn-primary" data-co="conf-done">Continue Shopping</button>';
    }

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
      var db = getDb();
      if (!db) { callback(); return; }
      db.ref(TENANT_ID + '/public/config/googleMapsApiKey').once('value').then(function (snap) {
        placesApiKey = snap.val();
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
    // Reset validation if user manually edits (but not if restored from previous order)
    ['shipAddr1', 'shipCity', 'shipState', 'shipZip'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        var lastKnown = el.value;
        el.addEventListener('input', function () {
          if (el.value !== lastKnown) {
            checkoutData._addressValidated = false;
            lastKnown = el.value;
          }
        });
      }
    });
  }

  function fillAddressFromPlace(place) {
    var components = {};
    for (var i = 0; i < place.address_components.length; i++) {
      var c = place.address_components[i];
      for (var j = 0; j < c.types.length; j++) {
        components[c.types[j]] = c;
      }
    }
    var streetNum = components.street_number ? components.street_number.long_name : '';
    var route = components.route ? components.route.long_name : '';
    var setVal = function (id, val) { var el = document.getElementById(id); if (el) el.value = val; };
    setVal('shipAddr1', (streetNum + ' ' + route).trim());
    setVal('shipCity', components.locality ? components.locality.long_name : (components.sublocality_level_1 ? components.sublocality_level_1.long_name : ''));
    var stateEl = document.getElementById('shipState');
    if (stateEl && components.administrative_area_level_1) stateEl.value = components.administrative_area_level_1.short_name;
    setVal('shipZip', components.postal_code ? components.postal_code.long_name : '');
  }

  // ── Test Mode Banner ──
  function checkTestMode(callback) {
    var db = getDb();
    if (!db) { callback(false); return; }
    db.ref(TENANT_ID + '/public/config/testMode').once('value').then(function (snap) {
      callback(snap.val() === true);
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
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  function watchOrderAndDownloadCSV(orderId, pendingOrder) {
    var db = getDb();
    if (!db || !pendingOrder) return;

    var ref = db.ref(TENANT_ID + '/orders/' + orderId + '/status');
    var handler = ref.on('value', function (snap) {
      var status = snap.val();
      if (status === 'placed') {
        ref.off('value', handler);
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
    setTimeout(function () { ref.off('value', handler); }, 90000);
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
    checkPaymentReturn: checkPaymentReturn,
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
