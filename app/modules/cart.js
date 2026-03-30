(function() {
  'use strict';

  // ============================================================
  // Cart Module — Wallet dashboard, Gift Cards, Loyalty admin
  // Coupons and Promotions remain in their own modules; this module
  // owns the new Cart sidebar section routes: wallet, gift-cards, loyalty.
  // ============================================================

  var walletListener = null;
  var walletStats = null;
  var walletLoaded = false;

  // ---- Helpers ----

  function formatMoney(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  // ---- Wallet Dashboard (Admin read-only overview) ----

  function loadWalletDashboard() {
    var container = document.getElementById('walletDashboard');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading wallet overview...</div>';

    // Read aggregate stats from admin path (future) or compute from accounts
    // For now, render the instrument settings dashboard
    renderWalletDashboard(container);
  }

  function renderWalletDashboard(container) {
    var db = MastAdmin.getData('db');
    var tenantId = MastAdmin.getData('tenantId');
    if (!db || !tenantId) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);"><p>Not connected.</p></div>';
      return;
    }

    // Load wallet config (if exists)
    db.ref(tenantId + '/admin/walletConfig').once('value').then(function(snap) {
      var config = snap.val() || {};
      walletLoaded = true;

      var giftCardsEnabled = config.giftCardsEnabled || false;
      var loyaltyEnabled = config.loyaltyEnabled || false;
      var creditsEnabled = config.creditsEnabled !== false; // default true

      container.innerHTML =
        '<div style="margin-bottom:24px;">' +
          '<p style="font-size:0.9rem;color:var(--warm-gray);margin-bottom:16px;">The wallet is a unified view of all customer financial instruments. Each instrument is managed in its own section.</p>' +
        '</div>' +

        // Instruments grid
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;">' +

          // Credits
          '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<span style="font-size:1.2rem;">&#128179;</span>' +
              '<span class="status-badge" style="background:' + (creditsEnabled ? '#16a34a' : '#9ca3af') + ';color:white;">' + (creditsEnabled ? 'Active' : 'Off') + '</span>' +
            '</div>' +
            '<div style="font-size:0.95rem;font-weight:500;color:var(--charcoal);margin-bottom:4px;">Store Credits</div>' +
            '<div style="font-size:0.8rem;color:var(--warm-gray);">Returns, admin grants, promotions. Never expire.</div>' +
          '</div>' +

          // Gift Cards
          '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<span style="font-size:1.2rem;">&#127873;</span>' +
              '<span class="status-badge" style="background:' + (giftCardsEnabled ? '#16a34a' : '#9ca3af') + ';color:white;">' + (giftCardsEnabled ? 'Active' : 'Coming Soon') + '</span>' +
            '</div>' +
            '<div style="font-size:0.95rem;font-weight:500;color:var(--charcoal);margin-bottom:4px;">Gift Cards</div>' +
            '<div style="font-size:0.8rem;color:var(--warm-gray);">eGift cards — purchase, send, redeem.</div>' +
          '</div>' +

          // Loyalty
          '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<span style="font-size:1.2rem;">&#11088;</span>' +
              '<span class="status-badge" style="background:' + (loyaltyEnabled ? '#16a34a' : '#9ca3af') + ';color:white;">' + (loyaltyEnabled ? 'Active' : 'Coming Soon') + '</span>' +
            '</div>' +
            '<div style="font-size:0.95rem;font-weight:500;color:var(--charcoal);margin-bottom:4px;">Loyalty Program</div>' +
            '<div style="font-size:0.8rem;color:var(--warm-gray);">Points-based rewards for repeat customers.</div>' +
          '</div>' +

          // Coupons (link to existing)
          '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);cursor:pointer;" onclick="navigateTo(\'coupons\')">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<span style="font-size:1.2rem;">&#127915;</span>' +
              '<span class="status-badge" style="background:#16a34a;color:white;">Active</span>' +
            '</div>' +
            '<div style="font-size:0.95rem;font-weight:500;color:var(--charcoal);margin-bottom:4px;">Coupons</div>' +
            '<div style="font-size:0.8rem;color:var(--warm-gray);">Discount codes for customers.</div>' +
          '</div>' +

          // Promotions (link to existing)
          '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);cursor:pointer;" onclick="navigateTo(\'promotions\')">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<span style="font-size:1.2rem;">&#127991;</span>' +
              '<span class="status-badge" style="background:#16a34a;color:white;">Active</span>' +
            '</div>' +
            '<div style="font-size:0.95rem;font-weight:500;color:var(--charcoal);margin-bottom:4px;">Sale Promotions</div>' +
            '<div style="font-size:0.8rem;color:var(--warm-gray);">Seasonal sales, markdowns, clearance.</div>' +
          '</div>' +

        '</div>';
    }).catch(function(err) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--danger);">Error loading wallet config: ' + esc(err.message) + '</div>';
    });
  }

  // ---- Module Registration ----

  MastAdmin.registerModule('cart', {
    routes: {
      'wallet': {
        tab: 'walletTab',
        setup: function() { loadWalletDashboard(); }
      },
      'gift-cards': {
        tab: 'giftCardsTab',
        setup: function() { /* Phase 2 */ }
      },
      'loyalty': {
        tab: 'loyaltyTab',
        setup: function() { /* Phase 3 */ }
      }
    },
    lazyLoad: function() { loadWalletDashboard(); },
    attachListeners: function() {
      // Future: listen for wallet config changes
    },
    detachListeners: function() {
      if (walletListener) {
        walletListener = null;
      }
      walletLoaded = false;
      walletStats = null;
    }
  });

})();
