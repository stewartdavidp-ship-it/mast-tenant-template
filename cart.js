/* =========================================================
   Tenant Shopping Cart Module
   Loaded on all public pages. Provides:
     - window.MastCart API (localStorage + Firebase sync)
     - Cart drawer UI (injected into DOM)
     - Cart icon/badge in nav
     - Google auth for cart persistence
     - Analytics tracking
   ========================================================= */
(function () {
  'use strict';

  // ── Constants ──
  // These are set lazily in init() after TENANT_READY resolves
  var STORAGE_KEY = 'mast_cart'; // default; overwritten in init()
  var FIREBASE_CONFIG = {};      // default; overwritten in init()
  var MAX_QTY = 10;
  var MAX_QTY_WHOLESALE = 9999;

  // ── Firebase App ──
  // Use the default Firebase app (initialized by the page) so auth state
  // is shared with siteSignIn() and other page-level Firebase usage.
  var fireApp, fireDb, fireAuth, currentUser = null;
  var _cartFreeThreshold = null; // loaded from shipping config
  var _cartWholesaleFreeThreshold = 350; // default, loaded from config

  function initFirebase() {
    try {
      fireApp = firebase.app(); // use default app — shared auth state
    } catch (e) {
      fireApp = firebase.initializeApp(FIREBASE_CONFIG);
    }
    fireDb = fireApp.database();
    if (firebase.auth) {
      fireAuth = fireApp.auth();
      fireAuth.onAuthStateChanged(onAuthChanged);
    }
    // Re-sync auth UI when dynamic nav is built (may arrive after onAuthStateChanged)
    window.addEventListener('storefront-nav-ready', function () {
      if (currentUser) updateNavAuth(currentUser);
    });
  }

  function loadFreeShippingThreshold() {
    if (!fireDb || !TENANT_ID) return;
    fireDb.ref(TENANT_ID + '/public/config/shippingRates').once('value').then(function(snap) {
      var config = snap.val() || {};
      // New format: shippingRules
      if (config.shippingRules) {
        var retail = config.shippingRules.retail || {};
        var wholesale = config.shippingRules.wholesale || {};
        var retailMods = retail.modifiers || [];
        var wsMods = wholesale.modifiers || [];
        _cartFreeThreshold = null;
        _cartWholesaleFreeThreshold = 350;
        if (retail.strategy === 'free') _cartFreeThreshold = 0;
        for (var i = 0; i < retailMods.length; i++) { if (retailMods[i].type === 'free-above') _cartFreeThreshold = retailMods[i].threshold; }
        if (wholesale.strategy === 'free') _cartWholesaleFreeThreshold = 0;
        for (var j = 0; j < wsMods.length; j++) { if (wsMods[j].type === 'free-above') _cartWholesaleFreeThreshold = wsMods[j].threshold; }
        return;
      }
      // Legacy format
      var val = config.freeThreshold;
      _cartFreeThreshold = (val != null && val > 0) ? val : null;
      if (config.wholesaleFreeThreshold != null) _cartWholesaleFreeThreshold = config.wholesaleFreeThreshold;
    }).catch(function() { /* silent */ });
  }

  // ── Cart State ──
  var cart = [];

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      cart = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(cart)) cart = [];
    } catch (e) {
      cart = [];
    }
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch (e) { /* quota exceeded — silent */ }
  }

  function generateId() {
    return 'ci_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  }

  // Build a key that uniquely identifies a product + option combo
  function optionKey(pid, options, bookingType, sessionId, passDefinitionId) {
    var parts = [pid];
    // Class bookings dedup by sessionId so same class on different dates stays separate
    if (bookingType === 'class' && sessionId) {
      parts.push('session=' + sessionId);
    }
    // Pass purchases dedup by passDefinitionId
    if (bookingType === 'pass' && passDefinitionId) {
      parts.push('pass=' + passDefinitionId);
    }
    if (options && typeof options === 'object') {
      var keys = Object.keys(options).sort();
      for (var i = 0; i < keys.length; i++) {
        parts.push(keys[i] + '=' + options[keys[i]]);
      }
    }
    return parts.join('|');
  }

  // ── Public API ──
  function getItems() {
    return cart.slice();
  }

  function getCount() {
    var total = 0;
    for (var i = 0; i < cart.length; i++) total += (cart[i].qty || 1);
    return total;
  }

  function addItem(item) {
    if (!item || !item.pid || !item.name) return cart;

    var maxQty = item.isWholesale ? MAX_QTY_WHOLESALE : MAX_QTY;
    // For strict-mode products, cap at available stock
    if (typeof item.availableStock === 'number' && item.availableStock > 0) {
      maxQty = Math.min(maxQty, item.availableStock);
    }
    var key = optionKey(item.pid, item.options, item.bookingType, item.sessionId, item.passDefinitionId);
    for (var i = 0; i < cart.length; i++) {
      if (optionKey(cart[i].pid, cart[i].options, cart[i].bookingType, cart[i].sessionId, cart[i].passDefinitionId) === key) {
        var itemMax = cart[i].isWholesale ? MAX_QTY_WHOLESALE : MAX_QTY;
        if (typeof cart[i].availableStock === 'number' && cart[i].availableStock > 0) {
          itemMax = Math.min(itemMax, cart[i].availableStock);
        }
        cart[i].qty = Math.min((cart[i].qty || 1) + (item.qty || 1), itemMax);
        persist();
        trackEvent('cart_add', item.pid);
        renderDrawerItems();
        updateBadge();
        return cart;
      }
    }

    var newItem = {
      cartItemId: generateId(),
      pid: item.pid,
      name: item.name,
      price: item.price || '',
      priceCents: item.priceCents || 0,
      image: item.image || '',
      options: item.options || {},
      qty: Math.min(Math.max(item.qty || 1, 1), maxQty),
      isWholesale: item.isWholesale || false,
      originalPrice: item.originalPrice || null,
      salePriceCents: item.salePriceCents || null,
      leadTimeText: item.leadTimeText || null,
      stockType: item.stockType || null,
      availableStock: typeof item.availableStock === 'number' ? item.availableStock : null,
      bookingType: item.bookingType || null,
      sessionId: item.sessionId || null,
      classId: item.classId || null,
      passDefinitionId: item.passDefinitionId || null,
      passId: item.passId || null,
      addedAt: Date.now()
    };
    cart.push(newItem);
    persist();
    trackEvent('cart_add', item.pid);
    renderDrawerItems();
    updateBadge();
    return cart;
  }

  function removeItem(cartItemId) {
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].cartItemId === cartItemId) {
        var removed = cart[i];
        cart.splice(i, 1);

        // If removing a class booking, also remove linked materials item (and vice versa)
        if (removed.bookingType === 'class' || removed.bookingType === 'class-materials') {
          var linkedType = removed.bookingType === 'class' ? 'class-materials' : 'class';
          for (var j = cart.length - 1; j >= 0; j--) {
            if (cart[j].bookingType === linkedType &&
                ((removed.sessionId && cart[j].sessionId === removed.sessionId) ||
                 (!removed.sessionId && cart[j].classId === removed.classId))) {
              cart.splice(j, 1);
            }
          }
        }

        persist();
        trackEvent('cart_remove', removed.pid);
        renderDrawerItems();
        updateBadge();
        return cart;
      }
    }
    return cart;
  }

  function updateQty(cartItemId, qty) {
    qty = parseInt(qty, 10);
    if (isNaN(qty) || qty < 0) return cart;
    if (qty === 0) return removeItem(cartItemId);
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].cartItemId === cartItemId) {
        var itemMaxQty = cart[i].isWholesale ? MAX_QTY_WHOLESALE : MAX_QTY;
        if (typeof cart[i].availableStock === 'number' && cart[i].availableStock > 0) {
          itemMaxQty = Math.min(itemMaxQty, cart[i].availableStock);
        }
        qty = Math.min(qty, itemMaxQty);
        cart[i].qty = qty;
        persist();
        trackEvent('cart_update', cart[i].pid);
        renderDrawerItems();
        updateBadge();
        return cart;
      }
    }
    return cart;
  }

  function clearCart() {
    cart = [];
    persist();
    renderDrawerItems();
    updateBadge();
  }

  function persist() {
    saveLocal();
    if (currentUser) {
      syncToFirebase();
    }
  }

  // ── Firebase Sync ──
  function cartRef() {
    if (!fireDb || !currentUser) return null;
    return fireDb.ref(TENANT_ID + '/users/' + currentUser.uid + '/cart');
  }

  function syncToFirebase() {
    var ref = cartRef();
    if (!ref) return;

    var data = {};
    for (var i = 0; i < cart.length; i++) {
      var item = cart[i];
      data[item.cartItemId] = {
        pid: item.pid,
        name: item.name,
        price: item.price || '',
        image: item.image || '',
        options: item.options || {},
        qty: item.qty,
        addedAt: item.addedAt || Date.now()
      };
    }
    ref.set(data).catch(function (err) {
      console.warn('Cart sync error:', err.message);
    });
  }

  function loadFromFirebase(callback) {
    var ref = cartRef();
    if (!ref) { callback([]); return; }

    ref.once('value').then(function (snap) {
      var val = snap.val();
      if (!val) { callback([]); return; }
      var items = [];
      var keys = Object.keys(val);
      for (var i = 0; i < keys.length; i++) {
        var item = val[keys[i]];
        item.cartItemId = keys[i];
        items.push(item);
      }
      callback(items);
    }).catch(function () {
      callback([]);
    });
  }

  function mergeFirebaseCart(firebaseItems) {
    // Merge: firebase items win for duplicates (same pid+options), add new ones
    var localKeys = {};
    for (var i = 0; i < cart.length; i++) {
      localKeys[optionKey(cart[i].pid, cart[i].options)] = i;
    }

    for (var j = 0; j < firebaseItems.length; j++) {
      var fbItem = firebaseItems[j];
      var key = optionKey(fbItem.pid, fbItem.options);
      if (key in localKeys) {
        // Take higher qty
        var idx = localKeys[key];
        cart[idx].qty = Math.max(cart[idx].qty || 1, fbItem.qty || 1);
        cart[idx].cartItemId = fbItem.cartItemId || cart[idx].cartItemId;
      } else {
        if (!fbItem.cartItemId) fbItem.cartItemId = generateId();
        cart.push(fbItem);
      }
    }
    persist();
    renderDrawerItems();
    updateBadge();
  }

  // ── Auth ──
  function onAuthChanged(user) {
    currentUser = user;
    updateAuthUI();
    updateNavAuth(user);
    if (user && !user.isAnonymous) {
      ensureCustomerAccount(user);
      // Load from Firebase and merge with local
      loadFromFirebase(function (fbItems) {
        if (fbItems.length > 0) {
          mergeFirebaseCart(fbItems);
        } else {
          // Push local cart to Firebase
          syncToFirebase();
        }
      });
    }
  }

  function signIn() {
    if (!fireAuth) return;
    var provider = new firebase.auth.GoogleAuthProvider();
    fireAuth.signInWithPopup(provider).catch(function (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        console.warn('Sign-in error:', err.message);
      }
    });
  }

  function signOut() {
    if (!fireAuth) return;
    fireAuth.signOut();
    currentUser = null;
    updateAuthUI();
    updateNavAuth(null);
  }

  // Create or update account record in Firebase on sign-in
  // Migrated from customers/{uid} to public/accounts/{uid} (Phase 3)
  function ensureCustomerAccount(user) {
    if (!fireDb || !user) return;
    var accountRef = fireDb.ref(TENANT_ID + '/public/accounts/' + user.uid);
    accountRef.once('value').then(function(snap) {
      var existing = snap.val();
      var now = new Date().toISOString();
      var updates = {
        name: user.displayName || '',
        email: user.email || '',
        photoUrl: user.photoURL || '',
        lastSignIn: now
      };
      if (!existing) {
        updates.createdAt = now;
        updates.phone = user.phoneNumber || '';
        updates.roles = ['student'];
        updates.address = { address1: '', address2: '', city: '', state: '', zip: '', country: 'US' };
        updates.emergencyContact = null;
        updates.studentProfile = {};
        updates.wholesaleProfile = {};
      }
      accountRef.update(updates);

      // Write redirect marker to legacy path for backward compat
      if (!existing) {
        fireDb.ref(TENANT_ID + '/customers/' + user.uid).update({
          migratedTo: 'public/accounts',
          migratedAt: now
        }).catch(function() {});
      }
    }).catch(function() { /* silent — RTDB may be unavailable */ });
  }

  // Update nav sign-in / sign-out links across all pages
  function updateNavAuth(user) {
    // Find all clickable elements that invoke siteSignIn
    var els = document.querySelectorAll('[onclick*="siteSignIn"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (user && !user.isAnonymous) {
        var name = user.displayName || user.email || 'Account';
        var first = name.split(' ')[0];
        el.textContent = first;
        el.classList.add('nav-user');
        el.setAttribute('onclick', "event.preventDefault(); siteSignOut();" + (el.getAttribute('onclick').indexOf('closeMobileMenu') !== -1 ? ' closeMobileMenu();' : ''));
      }
    }
    // When signed out, find sign-out links and revert to sign-in
    if (!user || user.isAnonymous) {
      var outEls = document.querySelectorAll('[onclick*="siteSignOut"]');
      for (var j = 0; j < outEls.length; j++) {
        var oel = outEls[j];
        oel.textContent = 'Sign In';
        var isMobile = oel.getAttribute('onclick').indexOf('closeMobileMenu') !== -1;
        oel.setAttribute('onclick', "event.preventDefault(); siteSignIn();" + (isMobile ? ' closeMobileMenu();' : ''));
      }
    }
  }

  // ── Analytics ──
  function trackEvent(action, pid) {
    try {
      var hitRef = fireDb.ref(TENANT_ID + '/analytics/hits').push();
      var page = location.pathname.split('/').pop().replace('.html', '') || 'index';
      if (page.length > 20) page = page.substring(0, 20);

      var now = new Date();
      var d = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');

      var hit = {
        t: 'ev',
        p: page,
        ts: Date.now(),
        d: d,
        a: action
      };
      if (pid) hit.a = action + ':' + pid;
      if (hit.a && hit.a.length > 40) hit.a = hit.a.substring(0, 40);

      hitRef.set(hit).catch(function () { /* silent */ });
    } catch (e) { /* silent */ }
  }

  // ── Gift Card Icon Visibility ──
  // Called from init() after TENANT_READY so TENANT_ID and FIREBASE_CONFIG are set
  function checkGiftCardEnabled() {
    if (!TENANT_ID || !FIREBASE_CONFIG.databaseURL) return;
    fetch(FIREBASE_CONFIG.databaseURL + '/' + TENANT_ID + '/public/config/walletConfig/giftCardsEnabled.json')
      .then(function(r) { return r.ok ? r.json() : false; })
      .then(function(enabled) {
        if (enabled) {
          var li = document.getElementById('giftCardIconLi');
          var mob = document.getElementById('giftCardIconMobile');
          if (li) li.style.display = '';
          if (mob) mob.style.display = '';
        }
      }).catch(function() {});
  }

  // ── Drawer HTML Injection ──
  function injectDrawer() {
    // Cart icon SVG template
    var cartSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM7.16 14.26l.04-.12.96-1.74h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 20.07 4H5.21l-.94-2H1v2h2l3.6 7.59-1.35 2.44C4.52 15.37 5.48 17 7 17h12v-2H7.42c-.14 0-.25-.11-.25-.25z"/>' +
      '</svg>';

    // Gift card icon SVG template
    var giftCardSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.05 0-1.96.54-2.5 1.35l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 12 7.4 15.38 12 17 10.83 14.92 8H20v6z"/>' +
      '</svg>';

    // Wallet icon SVG template
    var walletSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M21 7H3c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm0 8H3V9h18v6zm-3-3.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM21 4H3c-1.1 0-2 .45-2 1v1h22V5c0-.55-.9-1-2-1z"/>' +
      '</svg>';

    // Desktop + mobile cart & wallet icons — inject into nav once it's built
    function injectCartIcons() {
      var navLinks = document.querySelector('.nav-links');
      if (navLinks && !document.getElementById('cartIconWrap')) {
        // Gift card icon (before wallet) — hidden until config check
        var giftLi = document.createElement('li');
        giftLi.id = 'giftCardIconLi';
        giftLi.style.display = 'none';
        giftLi.innerHTML =
          '<a href="gift-cards.html" class="cart-icon-wrap" id="giftCardIconWrap" title="Gift Cards">' +
            giftCardSvg +
          '</a>';
        navLinks.appendChild(giftLi);

        // Wallet icon (before cart)
        var walletLi = document.createElement('li');
        walletLi.innerHTML =
          '<a href="my-wallet.html" class="cart-icon-wrap" id="walletIconWrap" title="My Wallet">' +
            walletSvg +
          '</a>';
        navLinks.appendChild(walletLi);

        // Cart icon
        var li = document.createElement('li');
        li.innerHTML =
          '<div class="cart-icon-wrap" id="cartIconWrap" title="Shopping Cart">' +
            cartSvg +
            '<span class="cart-badge hidden" id="cartBadge">0</span>' +
          '</div>';
        navLinks.appendChild(li);
        document.getElementById('cartIconWrap').addEventListener('click', openDrawer);
      }

      var navToggle = document.querySelector('.nav-toggle');
      if (navToggle && !document.getElementById('cartIconMobile')) {
        // Gift card icon mobile (before wallet) — hidden until config check
        if (!document.getElementById('giftCardIconMobile')) {
          var giftMobile = document.createElement('a');
          giftMobile.href = 'gift-cards.html';
          giftMobile.className = 'cart-icon-wrap cart-icon-mobile';
          giftMobile.id = 'giftCardIconMobile';
          giftMobile.title = 'Gift Cards';
          giftMobile.style.display = 'none';
          giftMobile.innerHTML = giftCardSvg;
          navToggle.parentNode.insertBefore(giftMobile, navToggle);
        }

        // Wallet icon mobile (before cart)
        if (!document.getElementById('walletIconMobile')) {
          var walletMobile = document.createElement('a');
          walletMobile.href = 'my-wallet.html';
          walletMobile.className = 'cart-icon-wrap cart-icon-mobile';
          walletMobile.id = 'walletIconMobile';
          walletMobile.title = 'My Wallet';
          walletMobile.innerHTML = walletSvg;
          navToggle.parentNode.insertBefore(walletMobile, navToggle);
        }

        // Cart icon mobile
        var mobileIcon = document.createElement('div');
        mobileIcon.className = 'cart-icon-wrap cart-icon-mobile';
        mobileIcon.id = 'cartIconMobile';
        mobileIcon.title = 'Shopping Cart';
        mobileIcon.innerHTML = cartSvg +
          '<span class="cart-badge hidden" id="cartBadgeMobile">0</span>';
        navToggle.parentNode.insertBefore(mobileIcon, navToggle);
        mobileIcon.addEventListener('click', openDrawer);
      }
      updateBadge();
    }

    // Try immediately; if nav not built yet, wait for the event
    injectCartIcons();
    if (!document.querySelector('.nav-links')) {
      window.addEventListener('storefront-nav-ready', injectCartIcons);
    }

    // Gift card icon config check is in checkGiftCardEnabled() at IIFE scope

    // Overlay
    var overlay = document.createElement('div');
    overlay.className = 'cart-overlay';
    overlay.id = 'cartOverlay';
    document.body.appendChild(overlay);

    // Drawer
    var drawer = document.createElement('div');
    drawer.className = 'cart-drawer';
    drawer.id = 'cartDrawer';
    drawer.innerHTML =
      '<div class="cart-drawer-header">' +
        '<div>' +
          '<span class="cart-drawer-title">Your Cart</span>' +
          '<span class="cart-drawer-count" id="cartDrawerCount"></span>' +
        '</div>' +
        '<button class="cart-drawer-close" id="cartDrawerClose" aria-label="Close cart">&times;</button>' +
      '</div>' +
      '<div class="cart-drawer-body" id="cartDrawerBody"></div>' +
      '<div class="cart-drawer-footer" id="cartDrawerFooter">' +
        '<div class="cart-footer-summary" id="cartFooterSummary"></div>' +
        '<div class="cart-footer-actions">' +
          '<button class="cart-checkout-btn" id="cartCheckoutBtn" style="display:none" onclick="if(window.MastCheckout)MastCheckout.start()">Checkout</button>' +
          '<button onclick="MastCart.closeDrawer()" style="' +
            'display:block;padding:10px 28px;background:transparent;color:var(--primary);' +
            'border:1px solid var(--primary);border-radius:4px;font-family:DM Sans,sans-serif;font-size:0.8rem;' +
            'letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;text-align:center;' +
            'transition:background 0.3s;width:100%;"' +
            ' onmouseover="this.style.background=\'rgba(200,150,60,0.1)\'" onmouseout="this.style.background=\'transparent\'">' +
            'Continue Shopping</button>' +
        '</div>' +
        '<div id="cartAuthArea"></div>' +
      '</div>';
    document.body.appendChild(drawer);

    // Toast container (stacking, bottom-center — matches admin app)
    var toastContainer = document.createElement('div');
    toastContainer.className = 'cart-toast-container';
    toastContainer.id = 'cartToastContainer';
    document.body.appendChild(toastContainer);

    // Event listeners (cart icon click is handled in injectCartIcons)
    document.getElementById('cartDrawerClose').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);

    // Escape key closes drawer
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });
  }

  // ── Drawer Open / Close ──
  function openDrawer() {
    document.getElementById('cartOverlay').classList.add('open');
    document.getElementById('cartDrawer').classList.add('open');
    document.body.style.overflow = 'hidden';
    trackEvent('cart_view', '');
    renderDrawerItems();
  }

  function closeDrawer() {
    document.getElementById('cartOverlay').classList.remove('open');
    document.getElementById('cartDrawer').classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── Badge ──
  function updateBadge() {
    var count = getCount();
    var ids = ['cartBadge', 'cartBadgeMobile'];
    for (var i = 0; i < ids.length; i++) {
      var badge = document.getElementById(ids[i]);
      if (!badge) continue;
      badge.textContent = count;
      if (count > 0) {
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }

  // ── Render Drawer Items ──
  function renderDrawerItems() {
    var body = document.getElementById('cartDrawerBody');
    var countEl = document.getElementById('cartDrawerCount');
    var summaryEl = document.getElementById('cartFooterSummary');
    var footerEl = document.getElementById('cartDrawerFooter');
    if (!body) return;

    var count = getCount();

    // Update header count
    if (countEl) {
      countEl.textContent = count > 0 ? '(' + count + ')' : '';
    }

    // Empty state
    if (cart.length === 0) {
      body.innerHTML =
        '<div class="cart-empty">' +
          '<div class="cart-empty-icon">&#128722;</div>' +
          '<h3>Your cart is empty</h3>' +
          '<p>Browse our collection and add pieces you love.</p>' +
          '<a href="shop.html" style="' +
            'display:inline-block;padding:10px 24px;background:var(--primary);color:#fff;' +
            'border-radius:4px;font-family:DM Sans,sans-serif;font-size:0.8rem;' +
            'letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;' +
            'transition:background 0.3s,filter 0.3s;"' +
            ' onmouseover="this.style.filter=\'brightness(0.85)\'" onmouseout="this.style.filter=\'none\'">' +
            'Browse Shop</a>' +
        '</div>';
      if (footerEl) footerEl.style.display = 'none';
      return;
    }

    if (footerEl) footerEl.style.display = '';

    // Show/hide checkout button
    var checkoutBtn = document.getElementById('cartCheckoutBtn');
    if (checkoutBtn) {
      checkoutBtn.style.display = cart.length > 0 ? '' : 'none';
    }

    // Build items HTML
    var html = '';
    for (var i = 0; i < cart.length; i++) {
      var item = cart[i];
      var optionsHtml = '';
      if (item.options && typeof item.options === 'object') {
        var optKeys = Object.keys(item.options);
        var optParts = [];
        for (var j = 0; j < optKeys.length; j++) {
          optParts.push(escHtml(optKeys[j]) + ': ' + escHtml(item.options[optKeys[j]]));
        }
        if (optParts.length > 0) {
          optionsHtml = '<div class="cart-item-options">' + optParts.join(' &middot; ') + '</div>';
        }
      }

      var imgHtml = item.image
        ? '<img class="cart-item-img" src="' + escAttr(item.image) + '" alt="' + escAttr(item.name) + '">'
        : '<div class="cart-item-img" style="display:flex;align-items:center;justify-content:center;color:#9B958E;font-size:1.5rem;">&#9670;</div>';

      var itemMaxQty = item.isWholesale ? MAX_QTY_WHOLESALE : MAX_QTY;
      if (typeof item.availableStock === 'number' && item.availableStock > 0) {
        itemMaxQty = Math.min(itemMaxQty, item.availableStock);
      }
      var qtyHtml;
      if (item.isWholesale) {
        // Wholesale: editable input for qty
        qtyHtml = '<div class="qty-stepper">' +
          '<button class="qty-btn" data-action="dec" data-id="' + escAttr(item.cartItemId) + '"' +
            (item.qty <= 1 ? ' disabled' : '') + '>&minus;</button>' +
          '<input type="number" class="qty-input" data-id="' + escAttr(item.cartItemId) + '" value="' + item.qty + '" min="1" max="' + itemMaxQty + '" style="width:48px;text-align:center;border:1px solid #ddd;border-radius:3px;padding:2px 4px;font-size:0.85rem;">' +
          '<button class="qty-btn" data-action="inc" data-id="' + escAttr(item.cartItemId) + '">+</button>' +
        '</div>';
      } else {
        qtyHtml = '<div class="qty-stepper">' +
          '<button class="qty-btn" data-action="dec" data-id="' + escAttr(item.cartItemId) + '"' +
            (item.qty <= 1 ? ' disabled' : '') + '>&minus;</button>' +
          '<span class="qty-value">' + item.qty + '</span>' +
          '<button class="qty-btn" data-action="inc" data-id="' + escAttr(item.cartItemId) + '"' +
            (item.qty >= itemMaxQty ? ' disabled' : '') + '>+</button>' +
        '</div>';
      }

      var wholesaleBadge = item.isWholesale ? '<span style="font-size:0.65rem;background:rgba(21,101,192,0.15);color:#1565C0;padding:2px 6px;border-radius:3px;margin-left:6px;">WHOLESALE</span>' : '';
      var leadTimeHtml = item.leadTimeText ? '<div style="font-size:0.75rem;color:var(--text-muted,#9e9890);font-style:italic;margin-top:2px;">' + escHtml(item.leadTimeText) + '</div>' : '';

      html +=
        '<div class="cart-item" data-cart-id="' + escAttr(item.cartItemId) + '">' +
          imgHtml +
          '<div class="cart-item-details">' +
            '<div class="cart-item-name">' + escHtml(item.name) + wholesaleBadge + '</div>' +
            optionsHtml +
            leadTimeHtml +
            '<div class="cart-item-row">' +
              '<span class="cart-item-price">' +
                (item.originalPrice && item.salePriceCents
                  ? '<span style="text-decoration:line-through;color:var(--warm-gray,#6B6560);font-weight:400;font-size:0.85em;">' + escHtml(item.originalPrice) + '</span> <span style="font-weight:700;color:var(--accent,var(--primary,#c05621));">' + escHtml(item.price) + '</span>'
                  : escHtml(item.price || 'Price on request')) +
              '</span>' +
              qtyHtml +
            '</div>' +
            '<button class="cart-item-remove" data-action="remove" data-id="' + escAttr(item.cartItemId) + '">Remove</button>' +
          '</div>' +
        '</div>';
    }
    body.innerHTML = html;

    // Summary + free shipping reminder
    if (summaryEl) {
      var subtotal = 0;
      var hasWholesale = false;
      for (var s = 0; s < cart.length; s++) {
        // Use sale price (already in display price) for subtotal
        var p = parseFloat(String(cart[s].price || '0').replace(/[^0-9.]/g, '')) || 0;
        subtotal += p * (cart[s].qty || 1);
        if (cart[s].isWholesale) hasWholesale = true;
      }
      var freeThreshold = hasWholesale ? _cartWholesaleFreeThreshold : _cartFreeThreshold;
      var summaryText = count + ' item' + (count !== 1 ? 's' : '') + ' in cart';
      if (subtotal > 0) summaryText += ' \u00B7 $' + subtotal.toFixed(2);
      var shippingHtml = '';
      if (freeThreshold != null && subtotal >= freeThreshold) {
        shippingHtml = '<div style="color:#2D7D46;font-size:0.75rem;margin-top:6px;letter-spacing:0.08em;">&#10003; FREE SHIPPING</div>';
      } else if (freeThreshold != null && subtotal > 0) {
        var away = (freeThreshold - subtotal).toFixed(2);
        shippingHtml = '<div style="color:var(--warm-gray);font-size:0.75rem;margin-top:6px;letter-spacing:0.08em;">You\'re $' + away + ' away from free shipping!</div>';
      }
      summaryEl.innerHTML = summaryText + shippingHtml;
    }

    // Auth area
    updateAuthUI();

    // Delegate clicks on qty buttons and remove
    body.addEventListener('click', handleDrawerClick);

    // Handle wholesale qty input changes
    body.querySelectorAll('.qty-input').forEach(function(inp) {
      inp.addEventListener('change', function() {
        var id = this.getAttribute('data-id');
        var val = parseInt(this.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        updateQty(id, val);
      });
    });
  }

  function handleDrawerClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');
    if (!id) return;

    if (action === 'inc') {
      var item = findItem(id);
      if (item) updateQty(id, item.qty + 1);
    } else if (action === 'dec') {
      var item2 = findItem(id);
      if (item2) updateQty(id, item2.qty - 1);
    } else if (action === 'remove') {
      removeItem(id);
    }
  }

  function findItem(cartItemId) {
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].cartItemId === cartItemId) return cart[i];
    }
    return null;
  }

  // ── Auth UI ──
  function updateAuthUI() {
    var area = document.getElementById('cartAuthArea');
    if (!area) return;

    if (currentUser) {
      var name = currentUser.displayName || currentUser.email || 'Signed in';
      area.innerHTML =
        '<div class="cart-user-info">' +
          'Signed in as <span>' + escHtml(name) + '</span>' +
          ' &middot; <button onclick="MastCart.signOut()" style="' +
          'background:none;border:none;color:#9B958E;cursor:pointer;font-size:0.78rem;' +
          'font-family:DM Sans,sans-serif;text-decoration:underline;">Sign out</button>' +
        '</div>';
    } else {
      area.innerHTML =
        '<div class="cart-auth-link">' +
          '<button onclick="MastCart.signIn()">Sign in to save your cart</button>' +
        '</div>';
    }
  }

  // ── Toast ──
  function showToast(message, isError) {
    var container = document.getElementById('cartToastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'cart-toast' + (isError ? ' error' : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 5000);
  }

  // ── Helpers ──
  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Initialize ──
  function init() {
    // Re-read tenant globals now that TENANT_READY has resolved
    STORAGE_KEY = (typeof TENANT_ID !== 'undefined' ? TENANT_ID : 'mast') + '_cart';
    FIREBASE_CONFIG = (typeof TENANT_FIREBASE_CONFIG !== 'undefined') ? TENANT_FIREBASE_CONFIG : {};
    loadLocal();
    initFirebase();
    loadFreeShippingThreshold();
    checkGiftCardEnabled();
    injectDrawer();
    updateBadge();
    renderDrawerItems();
  }

  // Wait for tenant resolution then DOM ready
  function startCart() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  if (typeof window.TENANT_READY !== 'undefined') {
    window.TENANT_READY.then(startCart).catch(function(err) {
      console.error('[cart] Tenant resolution failed:', err.message);
    });
  } else {
    startCart();
  }

  // ── Expose Public API ──
  function hasWholesaleItems() {
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].isWholesale) return true;
    }
    return false;
  }

  window.MastCart = {
    getItems: getItems,
    getCount: getCount,
    addItem: addItem,
    removeItem: removeItem,
    updateQty: updateQty,
    clear: clearCart,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    showToast: showToast,
    signIn: signIn,
    signOut: signOut,
    getCurrentUser: function () { return currentUser; },
    getFirebaseApp: function () { return fireApp; },
    refreshDrawer: function () { renderDrawerItems(); updateBadge(); },
    hasWholesaleItems: hasWholesaleItems,
    hasClassItems: function() { return cart.some(function(i) { return i.bookingType === 'class'; }); },
    hasPassItems: function() { return cart.some(function(i) { return i.bookingType === 'pass'; }); },
    isNonShippableCart: function() { return cart.length > 0 && cart.every(function(i) { return i.bookingType === 'class' || i.bookingType === 'pass' || i.bookingType === 'class-materials' || i.bookingType === 'gift-card'; }); },
    isClassOnlyCart: function() { return cart.length > 0 && cart.every(function(i) { return i.bookingType === 'class'; }); },
    hasProductItems: function() { return cart.some(function(i) { return !i.bookingType; }); }
  };

  // Backward-compat alias
  window.ShirCart = window.MastCart;

  // Global auth functions — used by nav onclick handlers across all pages.
  // Centralised here so every page shares the same Firebase Auth instance.
  window.siteSignIn = signIn;
  window.siteSignOut = signOut;

})();
