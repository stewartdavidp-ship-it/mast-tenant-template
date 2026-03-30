(function() {
  'use strict';

  // ============================================================
  // Cart Module — Wallet dashboard, Gift Cards admin, Loyalty admin
  // Coupons and Promotions remain in their own modules; this module
  // owns the Cart sidebar routes: wallet, gift-cards, loyalty.
  // ============================================================

  var walletLoaded = false;
  var giftCardsData = {};
  var giftCardsListener = null;
  var giftCardsLoaded = false;
  var giftCardConfig = null;
  var currentGiftCardFilter = 'all';

  // ---- Helpers ----

  function formatMoney(cents) {
    return '$' + (Math.abs(cents) / 100).toFixed(2);
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  function gcStatusBadge(status) {
    var colors = {
      issued: 'background:#2563eb;color:white;',
      claimed: 'background:#16a34a;color:white;',
      expired: 'background:#9ca3af;color:white;'
    };
    return '<span class="status-badge" style="' + (colors[status] || 'background:#9ca3af;color:white;') + '">' + esc((status || 'unknown').toUpperCase()) + '</span>';
  }

  // ============================================================
  // WALLET DASHBOARD (Admin read-only overview)
  // ============================================================

  function loadWalletDashboard() {
    var container = document.getElementById('walletDashboard');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading wallet overview...</div>';

    var db = MastAdmin.getData('db');
    var tenantId = MastAdmin.getData('tenantId');
    if (!db || !tenantId) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);"><p>Not connected.</p></div>';
      return;
    }

    db.ref(tenantId + '/admin/walletConfig').once('value').then(function(snap) {
      var config = snap.val() || {};
      walletLoaded = true;
      giftCardConfig = config;

      var giftCardsEnabled = config.giftCardsEnabled || false;
      var loyaltyEnabled = config.loyaltyEnabled || false;
      var creditsEnabled = config.creditsEnabled !== false;

      container.innerHTML =
        '<div style="margin-bottom:24px;">' +
          '<p style="font-size:0.9rem;color:var(--warm-gray);margin-bottom:16px;">The wallet is a unified view of all customer financial instruments. Each instrument is managed in its own section.</p>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;">' +
          renderInstrumentCard('&#128179;', 'Store Credits', 'Returns, admin grants, promotions. Never expire.', creditsEnabled ? 'Active' : 'Off', creditsEnabled) +
          renderInstrumentCard('&#127873;', 'Gift Cards', 'eGift cards \u2014 purchase, send, redeem.', giftCardsEnabled ? 'Active' : 'Off', giftCardsEnabled, "navigateTo('gift-cards')") +
          renderInstrumentCard('&#11088;', 'Loyalty Program', 'Points-based rewards for repeat customers.', loyaltyEnabled ? 'Active' : 'Off', loyaltyEnabled, "navigateTo('loyalty')") +
          renderInstrumentCard('&#127915;', 'Coupons', 'Discount codes for customers.', 'Active', true, "navigateTo('coupons')") +
          renderInstrumentCard('&#127991;', 'Sale Promotions', 'Seasonal sales, markdowns, clearance.', 'Active', true, "navigateTo('promotions')") +
        '</div>';
    }).catch(function(err) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--danger);">Error: ' + esc(err.message) + '</div>';
    });
  }

  function renderInstrumentCard(icon, name, desc, statusLabel, isActive, onclick) {
    var clickAttr = onclick ? ' cursor:pointer;" onclick="' + onclick + '"' : '"';
    return '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);' + (onclick ? 'cursor:pointer;' : '') + '" ' + (onclick ? 'onclick="' + onclick + '"' : '') + '>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<span style="font-size:1.2rem;">' + icon + '</span>' +
        '<span class="status-badge" style="background:' + (isActive ? '#16a34a' : '#9ca3af') + ';color:white;">' + esc(statusLabel) + '</span>' +
      '</div>' +
      '<div style="font-size:0.95rem;font-weight:500;color:var(--charcoal);margin-bottom:4px;">' + esc(name) + '</div>' +
      '<div style="font-size:0.8rem;color:var(--warm-gray);">' + esc(desc) + '</div>' +
    '</div>';
  }

  // ============================================================
  // GIFT CARDS ADMIN — Config + Management
  // ============================================================

  function loadGiftCards() {
    var container = document.getElementById('giftCardsTab');
    if (!container) return;

    // Load config first, then issued cards
    var db = MastAdmin.getData('db');
    var tenantId = MastAdmin.getData('tenantId');
    if (!db || !tenantId) return;

    Promise.all([
      db.ref(tenantId + '/admin/walletConfig').once('value'),
      MastDB.giftCards.list(200)
    ]).then(function(results) {
      giftCardConfig = results[0].val() || {};
      var cardsSnap = results[1].val() || {};
      giftCardsData = cardsSnap;
      giftCardsLoaded = true;
      renderGiftCardsAdmin(container);
    }).catch(function(err) {
      container.innerHTML = '<div class="section-header"><h2>Gift Cards</h2></div>' +
        '<div style="text-align:center;padding:40px;color:var(--danger);">Error: ' + esc(err.message) + '</div>';
    });
  }

  function renderGiftCardsAdmin(container) {
    var config = giftCardConfig || {};
    var enabled = config.giftCardsEnabled || false;
    var denominations = config.giftCardDenominations || [];
    var customEnabled = config.giftCardCustomEnabled || false;
    var customMin = config.giftCardCustomMin || 500;
    var customMax = config.giftCardCustomMax || 50000;

    var html = '<div class="section-header">' +
      '<h2>Gift Cards</h2>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn btn-secondary btn-small" onclick="window._gcOpenConfig()">&#9881; Settings</button>' +
        '<button class="btn btn-primary btn-small" onclick="window._gcOpenManualIssue()">+ Issue Gift Card</button>' +
      '</div>' +
    '</div>';

    // Status banner
    if (!enabled) {
      html += '<div style="padding:12px 16px;background:rgba(196,133,60,0.12);border-radius:6px;margin-bottom:16px;font-size:0.85rem;color:var(--charcoal);">' +
        '&#9888; Gift cards are <strong>disabled</strong>. Enable them in Settings to make the storefront page visible.' +
      '</div>';
    } else {
      html += '<div style="padding:12px 16px;background:rgba(22,163,74,0.1);border-radius:6px;margin-bottom:16px;font-size:0.85rem;color:var(--charcoal);">' +
        '&#10003; Gift cards are <strong>enabled</strong>. Denominations: ' +
        (denominations.length > 0 ? denominations.map(function(c) { return formatMoney(c); }).join(', ') : 'none configured') +
        (customEnabled ? ' + custom (' + formatMoney(customMin) + '\u2013' + formatMoney(customMax) + ')' : '') +
      '</div>';
    }

    // Filter tabs
    var cards = Object.keys(giftCardsData).map(function(code) {
      var gc = giftCardsData[code];
      gc._code = code;
      return gc;
    }).sort(function(a, b) {
      return (b.issuedAt || '').localeCompare(a.issuedAt || '');
    });

    var issuedCount = cards.filter(function(c) { return c.status === 'issued'; }).length;
    var claimedCount = cards.filter(function(c) { return c.status === 'claimed'; }).length;
    var expiredCount = cards.filter(function(c) { return c.status === 'expired'; }).length;

    html += '<div class="view-tabs" style="margin-bottom:16px;">' +
      '<button class="view-tab' + (currentGiftCardFilter === 'all' ? ' active' : '') + '" onclick="window._gcFilter(\'all\')">All (' + cards.length + ')</button>' +
      '<button class="view-tab' + (currentGiftCardFilter === 'issued' ? ' active' : '') + '" onclick="window._gcFilter(\'issued\')">Issued (' + issuedCount + ')</button>' +
      '<button class="view-tab' + (currentGiftCardFilter === 'claimed' ? ' active' : '') + '" onclick="window._gcFilter(\'claimed\')">Claimed (' + claimedCount + ')</button>' +
      '<button class="view-tab' + (currentGiftCardFilter === 'expired' ? ' active' : '') + '" onclick="window._gcFilter(\'expired\')">Expired (' + expiredCount + ')</button>' +
    '</div>';

    // Filter
    var filtered = cards;
    if (currentGiftCardFilter !== 'all') {
      filtered = cards.filter(function(c) { return c.status === currentGiftCardFilter; });
    }

    if (filtered.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:2rem;margin-bottom:12px;">&#127873;</div>' +
        '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No gift cards' + (currentGiftCardFilter !== 'all' ? ' (' + currentGiftCardFilter + ')' : '') + '</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Gift cards will appear here when purchased or manually issued.</p>' +
      '</div>';
    } else {
      // Table (desktop)
      html += '<div class="events-table data-table" style="margin-bottom:16px;">' +
        '<table><thead><tr>' +
          '<th>Code</th><th>Amount</th><th>Balance</th><th>Status</th><th>Buyer</th><th>Recipient</th><th>Issued</th><th>Actions</th>' +
        '</tr></thead><tbody>';

      filtered.forEach(function(gc) {
        html += '<tr>' +
          '<td style="font-family:monospace;font-size:0.82rem;">' + esc(gc._code) + '</td>' +
          '<td>' + formatMoney(gc.amountCents || 0) + '</td>' +
          '<td>' + formatMoney(gc.balanceCents != null ? gc.balanceCents : (gc.amountCents || 0)) + '</td>' +
          '<td>' + gcStatusBadge(gc.status) + '</td>' +
          '<td style="font-size:0.82rem;">' + esc(gc.purchasedBy || 'admin') + '</td>' +
          '<td style="font-size:0.82rem;">' + esc(gc.recipientEmail || (gc.status === 'claimed' ? 'self' : '')) + '</td>' +
          '<td style="font-size:0.82rem;">' + formatDate(gc.issuedAt) + '</td>' +
          '<td><button class="btn btn-secondary btn-small" onclick="window._gcViewDetail(\'' + esc(gc._code) + '\')">View</button></td>' +
        '</tr>';
      });

      html += '</tbody></table></div>';

      // Mobile cards
      html += '<div class="coupon-cards" id="gcMobileCards">';
      filtered.forEach(function(gc) {
        html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;margin-bottom:8px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span style="font-family:monospace;font-size:0.82rem;">' + esc(gc._code) + '</span>' +
            gcStatusBadge(gc.status) +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="font-weight:500;">' + formatMoney(gc.amountCents || 0) + '</span>' +
            '<span style="font-size:0.8rem;color:var(--warm-gray);">Bal: ' + formatMoney(gc.balanceCents != null ? gc.balanceCents : (gc.amountCents || 0)) + '</span>' +
          '</div>' +
          '<div style="font-size:0.8rem;color:var(--warm-gray);margin-top:4px;">' + formatDate(gc.issuedAt) + '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  // ---- Gift Card Config Modal (Step 2.1) ----

  window._gcOpenConfig = function() {
    var config = giftCardConfig || {};
    var denoms = (config.giftCardDenominations || []).map(function(c) { return (c / 100).toFixed(2); }).join(', ');

    var html = '<h3 style="margin-top:0;">Gift Card Settings</h3>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">' +
          '<input type="checkbox" id="gcConfigEnabled" ' + (config.giftCardsEnabled ? 'checked' : '') + '>' +
          'Enable gift cards on storefront' +
        '</label>' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Denominations (dollar amounts, comma-separated)</label>' +
        '<input type="text" id="gcConfigDenoms" value="' + esc(denoms) + '" placeholder="25, 50, 75, 100" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">e.g. 25, 50, 75, 100</div>' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">' +
          '<input type="checkbox" id="gcConfigCustom" ' + (config.giftCardCustomEnabled ? 'checked' : '') + '>' +
          'Allow custom amount' +
        '</label>' +
      '</div>' +
      '<div style="display:flex;gap:12px;margin-bottom:16px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Min ($)</label>' +
          '<input type="number" id="gcConfigMin" value="' + ((config.giftCardCustomMin || 500) / 100).toFixed(2) + '" min="1" step="0.01" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Max ($)</label>' +
          '<input type="number" id="gcConfigMax" value="' + ((config.giftCardCustomMax || 50000) / 100).toFixed(2) + '" min="1" step="0.01" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="window._gcSaveConfig()">Save</button>' +
      '</div>';

    openModal(html);
  };

  window._gcSaveConfig = async function() {
    var enabled = document.getElementById('gcConfigEnabled').checked;
    var denomsRaw = document.getElementById('gcConfigDenoms').value;
    var customEnabled = document.getElementById('gcConfigCustom').checked;
    var minVal = parseFloat(document.getElementById('gcConfigMin').value) || 5;
    var maxVal = parseFloat(document.getElementById('gcConfigMax').value) || 500;

    // Parse denominations
    var denoms = denomsRaw.split(',').map(function(s) {
      return Math.round(parseFloat(s.trim()) * 100);
    }).filter(function(n) { return n > 0 && !isNaN(n); });

    if (enabled && denoms.length === 0 && !customEnabled) {
      showToast('Add at least one denomination or enable custom amounts.', true);
      return;
    }

    var data = {
      giftCardsEnabled: enabled,
      giftCardDenominations: denoms,
      giftCardCustomEnabled: customEnabled,
      giftCardCustomMin: Math.round(minVal * 100),
      giftCardCustomMax: Math.round(maxVal * 100),
      updatedAt: new Date().toISOString()
    };

    try {
      await MastDB.walletConfig.update(data);
      writeAudit('update', 'wallet-config', 'giftCards');
      giftCardConfig = Object.assign(giftCardConfig || {}, data);
      closeModal();
      showToast('Gift card settings saved');
      loadGiftCards();
    } catch (err) {
      showToast('Failed to save: ' + err.message, true);
    }
  };

  // ---- Manual Gift Card Issue Modal (Step 2.7) ----

  window._gcOpenManualIssue = function() {
    var html = '<h3 style="margin-top:0;">Issue Gift Card</h3>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Manually issue a gift card (e.g., for compensation or promotions).</p>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Amount ($)</label>' +
        '<input type="number" id="gcIssueAmount" min="1" step="0.01" placeholder="50.00" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Recipient Email (optional)</label>' +
        '<input type="email" id="gcIssueEmail" placeholder="customer@example.com" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Note (internal)</label>' +
        '<input type="text" id="gcIssueNote" placeholder="Reason for issuance" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="window._gcIssueCard()">Issue Gift Card</button>' +
      '</div>';

    openModal(html);
  };

  window._gcIssueCard = async function() {
    var amountVal = parseFloat(document.getElementById('gcIssueAmount').value);
    if (!amountVal || amountVal <= 0) {
      showToast('Enter a valid amount.', true);
      return;
    }
    var amountCents = Math.round(amountVal * 100);
    var email = (document.getElementById('gcIssueEmail').value || '').trim();
    var note = (document.getElementById('gcIssueNote').value || '').trim();
    var currentUser = MastAdmin.getData('currentUser');
    var adminUid = currentUser ? currentUser.uid : 'admin';

    // Generate code (client-side for manual issuance)
    var CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    var raw = '';
    for (var i = 0; i < 16; i++) {
      raw += CHARSET[Math.floor(Math.random() * CHARSET.length)];
    }
    var code = raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16);

    var now = new Date().toISOString();
    var expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 2);

    var gcData = {
      code: code,
      amountCents: amountCents,
      balanceCents: amountCents,
      purchasedBy: adminUid,
      recipientEmail: email,
      senderMessage: '',
      senderName: '',
      orderId: null,
      orderNumber: null,
      productId: null,
      status: 'issued',
      issuedAt: now,
      expiresAt: expiresAt.toISOString(),
      claimedBy: null,
      claimedAt: null,
      adminNote: note,
      isManualIssue: true
    };

    try {
      await MastDB.giftCards.set(code, gcData);
      writeAudit('create', 'gift-card', code);
      closeModal();
      showToast('Gift card ' + code + ' issued for ' + formatMoney(amountCents));
      loadGiftCards();
    } catch (err) {
      showToast('Failed to issue: ' + err.message, true);
    }
  };

  // ---- Gift Card Detail Modal ----

  window._gcViewDetail = function(code) {
    var gc = giftCardsData[code];
    if (!gc) return;

    var balance = gc.balanceCents != null ? gc.balanceCents : (gc.amountCents || 0);

    var html = '<h3 style="margin-top:0;">Gift Card Details</h3>' +
      '<div style="text-align:center;margin-bottom:16px;">' +
        '<div style="font-family:monospace;font-size:1.4rem;letter-spacing:2px;color:var(--charcoal);margin-bottom:8px;">' + esc(code) + '</div>' +
        gcStatusBadge(gc.status) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:0.85rem;margin-bottom:16px;">' +
        '<div><strong>Original Amount:</strong> ' + formatMoney(gc.amountCents || 0) + '</div>' +
        '<div><strong>Balance:</strong> ' + formatMoney(balance) + '</div>' +
        '<div><strong>Issued:</strong> ' + formatDate(gc.issuedAt) + '</div>' +
        '<div><strong>Expires:</strong> ' + formatDate(gc.expiresAt) + '</div>' +
        '<div><strong>Buyer:</strong> ' + esc(gc.purchasedBy || 'admin') + '</div>' +
        '<div><strong>Recipient:</strong> ' + esc(gc.recipientEmail || 'self') + '</div>' +
        (gc.claimedBy ? '<div><strong>Claimed by:</strong> ' + esc(gc.claimedBy) + '</div>' : '') +
        (gc.claimedAt ? '<div><strong>Claimed:</strong> ' + formatDate(gc.claimedAt) + '</div>' : '') +
        (gc.orderNumber ? '<div><strong>Order:</strong> ' + esc(gc.orderNumber) + '</div>' : '') +
        (gc.adminNote ? '<div style="grid-column:1/3;"><strong>Note:</strong> ' + esc(gc.adminNote) + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
      '</div>';

    openModal(html);
  };

  // ---- Filter ----

  window._gcFilter = function(filter) {
    currentGiftCardFilter = filter;
    var container = document.getElementById('giftCardsTab');
    if (container && giftCardsLoaded) renderGiftCardsAdmin(container);
  };

  // ============================================================
  // MODULE REGISTRATION
  // ============================================================

  MastAdmin.registerModule('cart', {
    routes: {
      'wallet': {
        tab: 'walletTab',
        setup: function() { loadWalletDashboard(); }
      },
      'gift-cards': {
        tab: 'giftCardsTab',
        setup: function() { loadGiftCards(); }
      },
      'loyalty': {
        tab: 'loyaltyTab',
        setup: function() { /* Phase 3 */ }
      }
    },
    lazyLoad: function() { loadWalletDashboard(); },
    attachListeners: function() {
      if (!giftCardsListener) {
        giftCardsListener = MastDB.giftCards.listen(200, function(snap) {
          giftCardsData = snap.val() || {};
          giftCardsLoaded = true;
          var tab = document.getElementById('giftCardsTab');
          if (tab && tab.style.display !== 'none') {
            renderGiftCardsAdmin(tab);
          }
        });
      }
    },
    detachListeners: function() {
      if (giftCardsListener) {
        MastDB.giftCards.unlisten(giftCardsListener);
        giftCardsListener = null;
      }
      walletLoaded = false;
      giftCardsLoaded = false;
      giftCardsData = {};
      giftCardConfig = null;
    }
  });

})();
