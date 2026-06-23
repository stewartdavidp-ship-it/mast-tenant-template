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

    var tenantId = MastDB.tenantId();
    if (!db || !tenantId) return;
    if (!db || !tenantId) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);"><p>Not connected.</p></div>';
      return;
    }

    Promise.all([
      MastDB.get('admin/walletConfig'),
      MastDB.get('admin/membership/config')
    ]).then(function(results) {
      var config = results[0] || {};
      var msConfig = results[1] || {};
      walletLoaded = true;
      giftCardConfig = config;

      var giftCardsEnabled = config.giftCardsEnabled || false;
      var loyaltyEnabled = config.loyaltyEnabled || false;
      var creditsEnabled = config.creditsEnabled !== false;
      var membershipEnabled = msConfig.enabled || false;

      container.innerHTML =
        '<div class="view-tabs" id="walletDashTabBar" style="margin-bottom:16px;">' +
          '<button class="view-tab active" data-tab="overview" onclick="walletDashSwitchTab(\'overview\')">Overview</button>' +
          '<button class="view-tab" data-tab="history" onclick="walletDashSwitchTab(\'history\')">History</button>' +
        '</div>' +
        '<div id="walletDashTab-overview">' +
          '<div style="margin-bottom:24px;">' +
            '<p style="font-size:0.9rem;color:var(--warm-gray);margin-bottom:16px;">The wallet is a unified view of all customer financial instruments. Each instrument is managed in its own section. Per-customer adjustments happen on the customer detail Wallet tab and write an audit row visible under the History tab.</p>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;">' +
            renderInstrumentCard('&#128179;', 'Store Credits', 'Returns, admin grants, promotions. Never expire.', creditsEnabled ? 'Active' : 'Off', creditsEnabled) +
            renderInstrumentCard('&#127873;', 'Gift Cards', 'eGift cards \u2014 purchase, send, redeem.', giftCardsEnabled ? 'Active' : 'Off', giftCardsEnabled, "navigateTo('gift-cards')") +
            renderInstrumentCard('&#11088;', 'Loyalty Program', 'Points-based rewards for repeat customers.', loyaltyEnabled ? 'Active' : 'Off', loyaltyEnabled, "navigateTo('loyalty')") +
            renderInstrumentCard('&#127941;', 'Membership', 'Subscription program with exclusive benefits.', membershipEnabled ? 'Active' : 'Off', membershipEnabled, "navigateTo('membership')") +
            renderInstrumentCard('&#127915;', 'Coupons', 'Discount codes for customers.', 'Active', true, "navigateTo('coupons')") +
            renderInstrumentCard('&#127991;', 'Sale Promotions', 'Seasonal sales, markdowns, clearance.', 'Active', true, "navigateTo('promotions')") +
          '</div>' +
        '</div>' +
        '<div id="walletDashTab-history" style="display:none;">' +
          renderWalletHistorySkeleton() +
        '</div>';
    }).catch(function(err) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--danger);">Error: ' + esc(err.message) + '</div>';
    });
  }

  // D4 \u2014 Wallet History tab (global audit log of every wallet adjustment
  // recorded by adjustCustomerWallet CF). Filters by kind/action and a
  // customer search. Sorted newest-first.
  var _walletHistoryLoaded = false;
  var _walletHistoryRows = [];
  var _walletHistoryFilter = { kind: 'all', action: 'all', search: '' };

  function renderWalletHistorySkeleton() {
    return '<div id="walletHistoryBody"><div class="loading">Loading wallet history\u2026</div></div>';
  }

  function loadWalletHistory() {
    if (_walletHistoryLoaded) { renderWalletHistory(); return; }
    var body = document.getElementById('walletHistoryBody');
    if (body) body.innerHTML = '<div class="loading">Loading wallet history\u2026</div>';
    MastDB.query('admin/walletAdjustments').orderByChild('createdAt').limitToLast(500).once()
      .then(function(snap) {
        var data = (snap && snap.val && snap.val()) || (snap || {});
        var rows = [];
        Object.keys(data || {}).forEach(function(k) { if (data[k]) rows.push(data[k]); });
        rows.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        _walletHistoryRows = rows;
        _walletHistoryLoaded = true;
        renderWalletHistory();
      })
      .catch(function(err) {
        var b = document.getElementById('walletHistoryBody');
        if (b) b.innerHTML = '<div style="color:var(--danger);font-size:0.85rem;">Failed to load history: ' + esc((err && err.message) || '') + '</div>';
      });
  }

  function renderWalletHistory() {
    var body = document.getElementById('walletHistoryBody');
    if (!body) return;
    var f = _walletHistoryFilter;
    var filtered = _walletHistoryRows.filter(function(a) {
      if (f.kind !== 'all' && a.kind !== f.kind) return false;
      if (f.action !== 'all' && a.action !== f.action) return false;
      if (f.search) {
        var hay = ((a.customerId || '') + ' ' + (a.reason || '') + ' ' + (a.operatorName || '')).toLowerCase();
        if (hay.indexOf(f.search.toLowerCase()) === -1) return false;
      }
      return true;
    });
    var h = '';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;font-size:0.85rem;">';
    h += '<input type="text" id="walletHistorySearch" placeholder="Search customer / reason / operator" oninput="walletHistoryOnFilter(\'search\', this.value)" style="flex:1;min-width:220px;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">';
    h += '<select id="walletHistoryKind" onchange="walletHistoryOnFilter(\'kind\', this.value)" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">';
    ['all','credit','pass','membership','loyalty'].forEach(function(k){ h += '<option value="' + k + '"' + (f.kind===k?' selected':'') + '>' + (k==='all'?'All kinds':k) + '</option>'; });
    h += '</select>';
    h += '<select id="walletHistoryAction" onchange="walletHistoryOnFilter(\'action\', this.value)" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">';
    ['all','grant','revoke','adjust'].forEach(function(a){ h += '<option value="' + a + '"' + (f.action===a?' selected':'') + '>' + (a==='all'?'All actions':a) + '</option>'; });
    h += '</select>';
    h += '<span style="color:var(--warm-gray);font-size:0.78rem;margin-left:auto;">' + filtered.length + ' of ' + _walletHistoryRows.length + '</span>';
    h += '</div>';

    if (filtered.length === 0) {
      h += '<div style="color:var(--warm-gray-light);font-size:0.85rem;padding:20px;text-align:center;">No matching adjustments.</div>';
    } else {
      h += '<table class="data-table" style="font-size:0.85rem;width:100%;">';
      h += '<thead><tr><th>When</th><th>Customer</th><th>Kind</th><th>Action</th><th>Detail</th><th>Reason</th><th>Operator</th></tr></thead><tbody>';
      filtered.forEach(function(a) {
        var detail = '';
        if (typeof a.amountCents === 'number') detail = '$' + (a.amountCents/100).toFixed(2);
        else if (typeof a.delta === 'number') detail = (a.delta > 0 ? '+' : '') + a.delta + ' pts';
        else if (a.tier) detail = 'tier=' + a.tier;
        else if (a.passDefId) detail = 'pass=' + a.passDefId;
        var custLink = a.customerId
          ? '<a href="#" onclick="if(window.MastAdmin&&MastAdmin.loadModule){MastAdmin.loadModule(\'customers-core\').then(function(){if(window.customersOpenDetail)customersOpenDetail(\'' + esc(a.customerId) + '\')})}return false;" style="color:var(--teal);text-decoration:underline;">' + esc(a.customerId.slice(0,12)) + '\u2026</a>'
          : '<span style="color:var(--warm-gray-light);">\u2014</span>';
        h += '<tr>';
        h += '<td>' + esc(a.createdAt || '').slice(0, 19).replace('T', ' ') + '</td>';
        h += '<td>' + custLink + '</td>';
        h += '<td>' + esc(a.kind || '') + '</td>';
        h += '<td>' + esc(a.action || '') + '</td>';
        h += '<td>' + esc(detail) + '</td>';
        h += '<td style="max-width:280px;">' + esc(a.reason || '') + '</td>';
        h += '<td>' + esc(a.operatorName || a.operatorUid || '') + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    }
    body.innerHTML = h;
  }

  function walletHistoryOnFilter(field, value) {
    _walletHistoryFilter[field] = value;
    renderWalletHistory();
  }

  function walletDashSwitchTab(tab) {
    var bar = document.getElementById('walletDashTabBar');
    if (bar) {
      Array.prototype.forEach.call(bar.querySelectorAll('.view-tab'), function(b) {
        if (b.getAttribute('data-tab') === tab) b.classList.add('active');
        else b.classList.remove('active');
      });
    }
    var ov = document.getElementById('walletDashTab-overview');
    var hi = document.getElementById('walletDashTab-history');
    if (ov) ov.style.display = (tab === 'overview') ? '' : 'none';
    if (hi) hi.style.display = (tab === 'history') ? '' : 'none';
    if (tab === 'history') loadWalletHistory();
  }

  window.walletDashSwitchTab = walletDashSwitchTab;
  window.walletHistoryOnFilter = walletHistoryOnFilter;

  function renderInstrumentCard(icon, name, desc, statusLabel, isActive, onclick) {
    var clickAttr = onclick ? ' cursor:pointer;" onclick="' + onclick + '"' : '"';
    return '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);' + (onclick ? 'cursor:pointer;' : '') + '" ' + (onclick ? 'onclick="' + onclick + '"' : '') + '>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<span style="font-size:1.15rem;">' + icon + '</span>' +
        '<span class="status-badge" style="background:' + (isActive ? '#16a34a' : '#9ca3af') + ';color:white;">' + esc(statusLabel) + '</span>' +
      '</div>' +
      '<div style="font-size:0.9rem;font-weight:500;color:var(--text-primary);margin-bottom:4px;">' + esc(name) + '</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(desc) + '</div>' +
    '</div>';
  }

  // ============================================================
  // GIFT CARDS ADMIN — Config + Management
  // ============================================================

  function loadGiftCards() {
    var container = document.getElementById('giftCardsTab');
    if (!container) return;

    // Load config first, then issued cards
    var tenantId = MastDB.tenantId();
    if (!db || !tenantId) return;
    if (!db || !tenantId) return;

    Promise.all([
      MastDB.get('admin/walletConfig'),
      MastDB.giftCards.list(200)
    ]).then(function(results) {
      giftCardConfig = results[0] || {};
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
        (hasPermission('wallet', 'grantCredit') ? '<button class="btn btn-secondary btn-small" onclick="window._gcOpenPromoCredit()">&#127873; Promo Credit</button>' : '') +
        (hasPermission('giftCards', 'issue') ? '<button class="btn btn-primary btn-small" onclick="window._gcOpenManualIssue()">+ Issue Gift Card</button>' : '') +
      '</div>' +
    '</div>';

    // Contextual URL hint for features-only tenants with gift-cards enabled
    (function() {
      try {
        var presence = window._cachedPresenceForBanners || {};
        var featureMode = presence.featureMode || '';
        var enabledPages = Array.isArray(presence.enabledFeaturePages) ? presence.enabledFeaturePages : [];
        if (featureMode === 'features-only' && enabledPages.indexOf('gift-cards') !== -1) {
          var domain = (window.TENANT_CONFIG && window.TENANT_CONFIG.domain) || window.location.hostname;
          var gcUrl = 'https://' + domain + '/gift-cards';
          html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:rgba(42,124,111,0.09);border:1px solid rgba(42,124,111,0.2);border-radius:8px;margin-bottom:16px;font-size:0.85rem;">' +
            '<span style="color:var(--teal);flex-shrink:0;margin-top:1px;">&#9432;</span>' +
            '<span>Gift card purchases go to your Mast URL: ' +
            '<a href="' + esc(gcUrl) + '" target="_blank" rel="noopener" style="color:var(--teal);font-family:monospace;">' + esc(gcUrl) + '</a></span>' +
            '</div>';
        }
      } catch (e) { /* non-fatal */ }
    }());

    // Status banner
    if (!enabled) {
      html += '<div style="padding:12px 16px;background:rgba(196,133,60,0.12);border-radius:6px;margin-bottom:16px;font-size:0.85rem;color:var(--text-primary);">' +
        '&#9888; Gift cards are <strong>disabled</strong>. Enable them in Settings to make the storefront page visible.' +
      '</div>';
    } else {
      html += '<div style="padding:12px 16px;background:rgba(22,163,74,0.1);border-radius:6px;margin-bottom:16px;font-size:0.85rem;color:var(--text-primary);">' +
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

    // URL-driven filters from MCP admin links: status, dateFrom, dateTo, codes.
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlDateFrom = (rp && typeof rp.dateFrom === 'string') ? rp.dateFrom.slice(0, 10) : '';
    var urlDateTo = (rp && typeof rp.dateTo === 'string') ? rp.dateTo.slice(0, 10) : '';
    var urlCodesParam = (rp && typeof rp.codes === 'string') ? rp.codes : '';
    var urlCodes = urlCodesParam ? urlCodesParam.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    var urlCodeLookup = urlCodes.length > 0 ? Object.create(null) : null;
    if (urlCodeLookup) urlCodes.forEach(function(c){urlCodeLookup[c]=true;});
    var hasUrlFilter = !!(urlStatus || urlDateFrom || urlDateTo || urlCodes.length);

    html += '<div class="view-tabs" style="margin-bottom:16px;">' +
      '<button class="view-tab' + (currentGiftCardFilter === 'all' ? ' active' : '') + '" onclick="window._gcFilter(\'all\')">All (' + cards.length + ')</button>' +
      '<button class="view-tab' + (currentGiftCardFilter === 'issued' ? ' active' : '') + '" onclick="window._gcFilter(\'issued\')">Issued (' + issuedCount + ')</button>' +
      '<button class="view-tab' + (currentGiftCardFilter === 'claimed' ? ' active' : '') + '" onclick="window._gcFilter(\'claimed\')">Claimed (' + claimedCount + ')</button>' +
      '<button class="view-tab' + (currentGiftCardFilter === 'expired' ? ' active' : '') + '" onclick="window._gcFilter(\'expired\')">Expired (' + expiredCount + ')</button>' +
    '</div>';

    if (hasUrlFilter) {
      var bParts = [];
      if (urlCodes.length) bParts.push(MastFormat.countNoun(urlCodes.length, 'selected card'));
      if (urlStatus) bParts.push('status: ' + urlStatus);
      if (urlDateFrom) bParts.push('from ' + urlDateFrom);
      if (urlDateTo) bParts.push('to ' + urlDateTo);
      html += '<div id="giftCardsUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>&#127873; Showing ' + bParts.join(', ') + '</span>' +
        '<button type="button" onclick="clearGiftCardsFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    // Filter
    var filtered;
    if (hasUrlFilter) {
      filtered = cards.filter(function(c) {
        if (urlStatus && c.status !== urlStatus) return false;
        var d = (c.issuedAt || '').slice(0, 10);
        if (urlDateFrom && (!d || d < urlDateFrom)) return false;
        if (urlDateTo && (!d || d > urlDateTo)) return false;
        if (urlCodeLookup && !urlCodeLookup[c._code]) return false;
        return true;
      });
    } else if (currentGiftCardFilter !== 'all') {
      filtered = cards.filter(function(c) { return c.status === currentGiftCardFilter; });
    } else {
      filtered = cards;
    }

    if (filtered.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#127873;</div>' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No gift cards' + (currentGiftCardFilter !== 'all' ? ' (' + currentGiftCardFilter + ')' : '') + '</p>' +
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
          '<td style="font-family:monospace;font-size:0.85rem;">' + esc(gc._code) + '</td>' +
          '<td>' + formatMoney(gc.amountCents || 0) + '</td>' +
          '<td>' + formatMoney(gc.balanceCents != null ? gc.balanceCents : (gc.amountCents || 0)) + '</td>' +
          '<td>' + gcStatusBadge(gc.status) + (gc.source === 'migrated' ? ' <span class="status-badge" style="background:#7c3aed;color:white;font-size:0.72rem;">MIG</span>' : '') + '</td>' +
          '<td style="font-size:0.85rem;">' + esc(gc.purchasedBy || 'admin') + '</td>' +
          '<td style="font-size:0.85rem;">' + esc(gc.recipientEmail || (gc.status === 'claimed' ? 'self' : '')) + '</td>' +
          '<td style="font-size:0.85rem;">' + formatDate(gc.issuedAt) + '</td>' +
          '<td><button class="btn btn-secondary btn-small" onclick="window._gcViewDetail(\'' + esc(gc._code) + '\')">View</button></td>' +
        '</tr>';
      });

      html += '</tbody></table></div>';

      // Mobile cards
      html += '<div class="coupon-cards" id="gcMobileCards">';
      filtered.forEach(function(gc) {
        html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;margin-bottom:8px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span style="font-family:monospace;font-size:0.85rem;">' + esc(gc._code) + '</span>' +
            gcStatusBadge(gc.status) +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="font-weight:500;">' + formatMoney(gc.amountCents || 0) + '</span>' +
            '<span style="font-size:0.78rem;color:var(--warm-gray);">Bal: ' + formatMoney(gc.balanceCents != null ? gc.balanceCents : (gc.amountCents || 0)) + '</span>' +
          '</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' + formatDate(gc.issuedAt) + '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  // ---- Gift Card Config Modal (Step 2.1) ----

  window.clearGiftCardsFilter = function() {
    var p = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var next = {};
    var DROP = { status: 1, dateFrom: 1, dateTo: 1, codes: 1 };
    Object.keys(p).forEach(function(k) { if (!DROP[k]) next[k] = p[k]; });
    if (typeof navigateTo === 'function') navigateTo('gift-cards', next);
  };

  window._gcOpenConfig = function() {
    // Gift-card config relocated to My Website › Wallet & loyalty (PR4).
    if (typeof navigateTo === 'function') { navigateTo('website-v2'); if (window.showToast) showToast('Configure gift cards in My Website → Wallet & loyalty'); return; }
    var config = giftCardConfig || {};
    var denoms = (config.giftCardDenominations || []).map(function(c) { return (c / 100).toFixed(2); }).join(', ');

    var html = '<div style="padding:24px;">' +
      '<h3 style="margin-top:0;">Gift Card Settings</h3>' +
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
      '<div style="display:flex;gap:12px;margin-bottom:20px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Min ($)</label>' +
          '<input type="number" id="gcConfigMin" value="' + ((config.giftCardCustomMin || 500) / 100).toFixed(2) + '" min="1" step="0.01" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Max ($)</label>' +
          '<input type="number" id="gcConfigMax" value="' + ((config.giftCardCustomMax || 50000) / 100).toFixed(2) + '" min="1" step="0.01" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="window._gcSaveConfig()">Save</button>' +
      '</div>' +
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
    var html = '<div style="padding:24px;">' +
      '<h3 style="margin-top:0;">Issue Gift Card</h3>' +
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
      '</div>' +
      '</div>';

    openModal(html);
  };

  window._gcIssueCard = async function() {
    if (!hasPermission('giftCards', 'issue')) { showToast('You do not have permission to issue gift cards.', true); return; }
    var amountVal = parseFloat(document.getElementById('gcIssueAmount').value);
    if (!amountVal || amountVal <= 0) {
      showToast('Enter a valid amount.', true);
      return;
    }
    var amountCents = Math.round(amountVal * 100);
    var email = (document.getElementById('gcIssueEmail').value || '').trim();
    var note = (document.getElementById('gcIssueNote').value || '').trim();
    var currentUser = firebase.auth().currentUser;
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

  // ---- Promotional Credit Modal (Step 2.8) ----
  // Promotional credits are gift cards with type 'promotion' and short expiration.

  window._gcOpenPromoCredit = function() {
    var html = '<div style="padding:24px;">' +
      '<h3 style="margin-top:0;">Create Promotional Credit</h3>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Issue a promotional gift card (e.g., sign-up bonus, birthday credit, compensation).</p>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Amount ($)</label>' +
        '<input type="number" id="gcPromoAmount" min="1" step="0.01" placeholder="10.00" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Expires in (days)</label>' +
        '<input type="number" id="gcPromoDays" min="1" max="365" value="30" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">Short expiration encourages quick redemption.</div>' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Promo Code (optional)</label>' +
        '<input type="text" id="gcPromoCode" placeholder="Auto-generated if blank" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">Custom promo code for marketing (e.g., WELCOME10). Leave blank for random.</div>' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Recipient Email</label>' +
        '<input type="email" id="gcPromoEmail" placeholder="customer@example.com" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Note (internal)</label>' +
        '<input type="text" id="gcPromoNote" placeholder="e.g., Welcome bonus for new subscriber" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="window._gcIssuePromo()">Create Promo Credit</button>' +
      '</div>' +
      '</div>';

    openModal(html);
  };

  window._gcIssuePromo = async function() {
    if (!hasPermission('wallet', 'grantCredit')) { showToast('You do not have permission to grant promo credit.', true); return; }
    var amountVal = parseFloat(document.getElementById('gcPromoAmount').value);
    if (!amountVal || amountVal <= 0) {
      showToast('Enter a valid amount.', true);
      return;
    }
    var amountCents = Math.round(amountVal * 100);
    var days = parseInt(document.getElementById('gcPromoDays').value) || 30;
    var customCode = (document.getElementById('gcPromoCode').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    var email = (document.getElementById('gcPromoEmail').value || '').trim();
    var note = (document.getElementById('gcPromoNote').value || '').trim();
    var currentUser = firebase.auth().currentUser;
    var adminUid = currentUser ? currentUser.uid : 'admin';

    // Generate code or use custom
    var code;
    if (customCode && customCode.length >= 4) {
      // Format custom code as XXXX-XXXX... pattern if long enough
      if (customCode.length <= 8) {
        code = customCode;
      } else {
        code = customCode.match(/.{1,4}/g).join('-');
      }
      // Check if code already exists
      try {
        var existing = await MastDB.giftCards.get(code);
        if (existing) {
          showToast('Code "' + code + '" already exists. Choose a different one.', true);
          return;
        }
      } catch (e) { /* ok */ }
    } else {
      var CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      var raw = '';
      for (var i = 0; i < 16; i++) {
        raw += CHARSET[Math.floor(Math.random() * CHARSET.length)];
      }
      code = raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16);
    }

    var now = new Date().toISOString();
    var expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

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
      isManualIssue: true,
      isPromotion: true,
      promotionExpiryDays: days
    };

    try {
      await MastDB.giftCards.set(code, gcData);
      writeAudit('create', 'gift-card-promo', code);
      closeModal();
      showToast('Promo credit ' + code + ' created for ' + formatMoney(amountCents) + ' (expires in ' + days + ' days)');
      loadGiftCards();
    } catch (err) {
      showToast('Failed to create: ' + err.message, true);
    }
  };

  // ---- Bridge for the gift-cards-v2 redesign twin (flag-gated #gift-cards-v2) ----
  // The twin delegates manual issuance + promo-credit creation here so the
  // gift-card write, the client-side code generation, the 'issued' / promotion
  // object shape, the permission gate, and the writeAudit call stay single-
  // sourced — the twin never reimplements that logic. Additive; no behavior
  // change to the legacy #gift-cards surface. These mirror the EXACT client
  // writes _gcIssueCard() / _gcIssuePromo() make, parameterized by a data object
  // (the legacy handlers read the modal DOM, so they can't be called directly).
  // Mirrors window.ContactsBridge / window.MakerMaterialsBridge.
  window.GiftCardsBridge = {
    // Mirrors _gcIssueCard: hasPermission('giftCards','issue') gate, 16-char
    // CHARSET code in XXXX-XXXX-XXXX-XXXX form, 2-year expiry, 'issued' shape
    // with isManualIssue, MastDB.giftCards.set(code, gcData) +
    // writeAudit('create','gift-card',code). data: { amountVal($), email, note }.
    issue: async function(data) {
      if (!hasPermission('giftCards', 'issue')) { showToast('You do not have permission to issue gift cards.', true); return null; }
      var amountVal = parseFloat(data && data.amountVal);
      if (!amountVal || amountVal <= 0) { showToast('Enter a valid amount.', true); return null; }
      var amountCents = Math.round(amountVal * 100);
      var email = ((data && data.email) || '').trim();
      var note = ((data && data.note) || '').trim();
      var currentUser = firebase.auth().currentUser;
      var adminUid = currentUser ? currentUser.uid : 'admin';

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

      await MastDB.giftCards.set(code, gcData);
      writeAudit('create', 'gift-card', code);
      showToast('Gift card ' + code + ' issued for ' + formatMoney(amountCents));
      return { code: code, gcData: gcData };
    },
    // Mirrors _gcIssuePromo: hasPermission('wallet','grantCredit') gate, custom-
    // code OR random-code generation (custom: dup-check via giftCards.get, format
    // XXXX-XXXX… when >8 chars), N-day expiry, promotion shape with isPromotion +
    // promotionExpiryDays, MastDB.giftCards.set(code, gcData) +
    // writeAudit('create','gift-card-promo',code). data: { amountVal($), days,
    // customCode, email, note }.
    issuePromo: async function(data) {
      if (!hasPermission('wallet', 'grantCredit')) { showToast('You do not have permission to grant promo credit.', true); return null; }
      var amountVal = parseFloat(data && data.amountVal);
      if (!amountVal || amountVal <= 0) { showToast('Enter a valid amount.', true); return null; }
      var amountCents = Math.round(amountVal * 100);
      var days = parseInt(data && data.days, 10) || 30;
      var customCode = ((data && data.customCode) || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      var email = ((data && data.email) || '').trim();
      var note = ((data && data.note) || '').trim();
      var currentUser = firebase.auth().currentUser;
      var adminUid = currentUser ? currentUser.uid : 'admin';

      var code;
      if (customCode && customCode.length >= 4) {
        if (customCode.length <= 8) {
          code = customCode;
        } else {
          code = customCode.match(/.{1,4}/g).join('-');
        }
        try {
          var existing = await MastDB.giftCards.get(code);
          if (existing) {
            showToast('Code "' + code + '" already exists. Choose a different one.', true);
            return null;
          }
        } catch (e) { /* ok */ }
      } else {
        var CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        var raw = '';
        for (var i = 0; i < 16; i++) {
          raw += CHARSET[Math.floor(Math.random() * CHARSET.length)];
        }
        code = raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16);
      }

      var now = new Date().toISOString();
      var expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + days);

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
        isManualIssue: true,
        isPromotion: true,
        promotionExpiryDays: days
      };

      await MastDB.giftCards.set(code, gcData);
      writeAudit('create', 'gift-card-promo', code);
      showToast('Promo credit ' + code + ' created for ' + formatMoney(amountCents) + ' (expires in ' + days + ' days)');
      return { code: code, gcData: gcData };
    }
  };

  // ---- Membership bridge (thin shim for membership-v2.js) ----
  // Re-hosts the exact CLIENT writes the legacy #membership handlers make
  // (window._membershipSaveConfig / _membershipGrant / _membershipRevoke /
  // _membershipReactivate), parameterized by data so the V2 twin can drive them
  // without reimplementing the write. None of these is Cloud-Function-backed —
  // each is a plain MastDB write + writeAudit, so all four are delegate-able.
  // Mirrors window.GiftCardsBridge / window.CsReviewsBridge.
  window.MembershipBridge = {
    // Latest program config (read context for the V2 page + edit form). Mirrors
    // loadMembershipAdmin's `MastDB.get('admin/membership/config')`.
    getConfig: function() { return Promise.resolve(MastDB.get('admin/membership/config')); },

    // Mirrors _membershipSaveConfig EXACTLY: builds the same config record (same
    // field set, same `enabled && price <= 0` guard, same 0–100 percentage guard,
    // same updatedAt), then MastDB.update('admin/membership/config', data) +
    // writeAudit('update','membership-config','settings'). data: {
    //   enabled, programName, annualPrice, productDiscountPct, serviceDiscountPct,
    //   classSeatDiscountPct, classMaterialsDiscountPct, freeShippingThreshold,
    //   loyaltyPointMultiplier, priorityEnrollmentDays, earlyProductAccessHours,
    //   allowPromoStack }. Returns the persisted config object.
    saveConfig: async function(d) {
      d = d || {};
      var enabled = !!d.enabled;
      var name = (d.programName || '').trim() || 'Membership';
      var price = parseFloat(d.annualPrice) || 0;
      // parseFloat(x)||null — exactly mirrors legacy _membershipSaveConfig (0/NaN/empty → null).
      var prodPct = parseFloat(d.productDiscountPct) || null;
      var svcPct = parseFloat(d.serviceDiscountPct) || null;
      var classPct = parseFloat(d.classSeatDiscountPct) || null;
      var matPct = parseFloat(d.classMaterialsDiscountPct) || null;
      var shipThresh = d.freeShippingThreshold;
      var loyaltyMult = parseFloat(d.loyaltyPointMultiplier) || null;
      var priorityDays = parseInt(d.priorityEnrollmentDays, 10) || null;
      var earlyHrs = parseInt(d.earlyProductAccessHours, 10) || null;
      var promoStack = !!d.allowPromoStack;

      if (enabled && price <= 0) { showToast('Annual price must be greater than $0 when enabled.', true); return null; }
      var bad = [prodPct, svcPct, classPct, matPct].some(function(v) { return v !== null && (v < 0 || v > 100); });
      if (bad) { showToast('Discount percentages must be between 0 and 100.', true); return null; }

      var data = {
        enabled: enabled,
        programName: name,
        annualPrice: price,
        productDiscountPct: prodPct,
        serviceDiscountPct: svcPct,
        classSeatDiscountPct: classPct,
        classMaterialsDiscountPct: matPct,
        freeShippingThreshold: (shipThresh !== '' && shipThresh != null) ? parseFloat(shipThresh) : null,
        loyaltyPointMultiplier: loyaltyMult,
        priorityEnrollmentDays: priorityDays,
        earlyProductAccessHours: earlyHrs,
        allowPromoStack: promoStack,
        updatedAt: new Date().toISOString()
      };
      var tenantId = MastDB.tenantId();
      if (!db || !tenantId) { showToast('Not connected.', true); return null; }
      try {
        await MastDB.update('admin/membership/config', data);
        writeAudit('update', 'membership-config', 'settings');
        membershipConfig = Object.assign(membershipConfig || {}, data);
        showToast('Membership settings saved');
        return data;
      } catch (err) {
        showToast('Failed to save: ' + err.message, true);
        return null;
      }
    },

    // Mirrors _membershipGrant EXACTLY: same memberData shape (status active,
    // startDate today, 1-year renewal/expiry, processor manual, plan manual-grant),
    // both client writes (public wallet mirror + customers/<uid>/membership) +
    // writeAudit('create','membership-grant',uid). uid: customer UID string.
    grant: async function(uid) {
      uid = (uid || '').trim();
      if (!uid) { showToast('UID is required.', true); return false; }
      var tenantId = MastDB.tenantId();
      if (!db || !tenantId) { showToast('Not connected.', true); return false; }
      var now = new Date().toISOString();
      var oneYear = MastFormat.dateRaw(MastFormat.addDays(new Date(), 365));
      var memberData = {
        status: 'active',
        startDate: now.slice(0, 10),
        renewalDate: oneYear,
        expiryDate: oneYear,
        processor: 'manual',
        processorSubscriptionId: null,
        processorCustomerId: null,
        plan: 'manual-grant',
        paymentStatus: null,
        updatedAt: now
      };
      try {
        await MastDB.set('public/accounts/' + uid + '/wallet/membership', memberData);
        await MastDB.set('customers/' + uid + '/membership', memberData);
        writeAudit('create', 'membership-grant', uid);
        showToast('Membership granted');
        return true;
      } catch (err) { showToast('Failed: ' + err.message, true); return false; }
    },

    // Mirrors _membershipRevoke EXACTLY: same update set (status expired,
    // expiredAt, paymentStatus null), both client writes + writeAudit. NOTE: the
    // mastConfirm prompt is the V2 caller's responsibility (mirrors cs-reviews-v2,
    // where the bridge is write-only and the twin owns the confirm UX).
    revoke: async function(uid) {
      uid = (uid || '').trim();
      if (!uid) return false;
      var tenantId = MastDB.tenantId();
      if (!db || !tenantId) { showToast('Not connected.', true); return false; }
      var now = new Date().toISOString();
      var updates = { status: 'expired', expiredAt: now, updatedAt: now, paymentStatus: null };
      try {
        await MastDB.update('public/accounts/' + uid + '/wallet/membership', updates);
        await MastDB.update('customers/' + uid + '/membership', updates);
        writeAudit('update', 'membership-revoke', uid);
        showToast('Membership revoked');
        return true;
      } catch (err) { showToast('Failed: ' + err.message, true); return false; }
    },

    // Mirrors _membershipReactivate EXACTLY: same update set (status active, fresh
    // start/renewal/expiry, cancelledAt/expiredAt cleared), both client writes +
    // writeAudit.
    reactivate: async function(uid) {
      uid = (uid || '').trim();
      if (!uid) return false;
      var tenantId = MastDB.tenantId();
      if (!db || !tenantId) { showToast('Not connected.', true); return false; }
      var now = new Date().toISOString();
      var oneYear = MastFormat.dateRaw(MastFormat.addDays(new Date(), 365));
      var updates = {
        status: 'active',
        startDate: now.slice(0, 10),
        renewalDate: oneYear,
        expiryDate: oneYear,
        processor: 'manual',
        paymentStatus: null,
        cancelledAt: null,
        expiredAt: null,
        updatedAt: now
      };
      try {
        await MastDB.update('public/accounts/' + uid + '/wallet/membership', updates);
        await MastDB.update('customers/' + uid + '/membership', updates);
        writeAudit('update', 'membership-reactivate', uid);
        showToast('Membership reactivated');
        return true;
      } catch (err) { showToast('Failed: ' + err.message, true); return false; }
    }
  };

  // ---- Gift Card Detail Modal ----

  window._gcViewDetail = function(code) {
    var gc = giftCardsData[code];
    if (!gc) return;

    var balance = gc.balanceCents != null ? gc.balanceCents : (gc.amountCents || 0);

    var html = '<div style="padding:24px;">' +
      '<h3 style="margin-top:0;">Gift Card Details</h3>' +
      '<div style="text-align:center;margin-bottom:16px;">' +
        '<div style="font-family:monospace;font-size:1.6rem;letter-spacing:2px;color:var(--text-primary);margin-bottom:8px;">' + esc(code) + '</div>' +
        gcStatusBadge(gc.status) +
        (gc.source === 'migrated' ? ' <span class="status-badge" style="background:#7c3aed;color:white;">MIGRATED</span>' : '') +
      '</div>' +
      (gc.legacyCode ? '<div style="text-align:center;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray,#888);">Legacy code: <span style="font-family:monospace;">' + esc(gc.legacyCode) + '</span>' + (gc.legacyPlatform ? ' (' + esc(gc.legacyPlatform) + ')' : '') + '</div>' : '') +
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
      '</div>' +
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
  // LOYALTY ADMIN (Steps 3.1, 3.2)
  // ============================================================

  var loyaltyConfig = null;

  function loadLoyaltyAdmin() {
    var container = document.getElementById('loyaltyTab');
    if (!container) return;

    var tenantId = MastDB.tenantId();
    if (!db || !tenantId) return;
    if (!db || !tenantId) return;

    container.innerHTML = '<div class="section-header"><h2>Loyalty Program</h2></div><div class="loading">Loading...</div>';

    MastDB.get('admin/walletConfig').then(function(config) {
      config = config || {};
      loyaltyConfig = config;
      renderLoyaltyAdmin(container, config);
    }).catch(function(err) {
      container.innerHTML = '<div class="section-header"><h2>Loyalty Program</h2></div>' +
        '<div style="text-align:center;padding:40px;color:var(--danger);">Error: ' + esc(err.message) + '</div>';
    });
  }

  function renderLoyaltyAdmin(container, config) {
    var enabled = config.loyaltyEnabled || false;
    var pointName = config.loyaltyPointName || 'Points';
    var earnRate = config.loyaltyEarnRate || 1;
    var redeemRate = config.loyaltyRedemptionRate || 50;
    var expiryDays = config.loyaltyExpiryDays || 365;
    var exclusions = config.loyaltyExclusions || [];

    var html = '<div class="section-header">' +
      '<h2>Loyalty Program</h2>' +
      '<button class="btn btn-primary btn-small" onclick="window._loyaltyOpenConfig()">&#9881; Settings</button>' +
    '</div>';

    if (!enabled) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#11088;</div>' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">Loyalty program is disabled</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Enable it in Settings to start rewarding your customers.</p>' +
      '</div>';
    } else {
      // Config summary
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px;">' +
        // Earn rate card
        '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Earn Rate</div>' +
          '<div style="font-size:1.6rem;font-weight:500;color:var(--text-primary);">' + earnRate + ' ' + esc(pointName) + '</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);">per $1 spent</div>' +
        '</div>' +
        // Redemption rate card
        '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Redemption</div>' +
          '<div style="font-size:1.6rem;font-weight:500;color:var(--text-primary);">' + redeemRate + ' ' + esc(pointName) + '</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);">= $1.00 off</div>' +
        '</div>' +
        // Expiry card
        '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Expiry Window</div>' +
          '<div style="font-size:1.6rem;font-weight:500;color:var(--text-primary);">' + expiryDays + ' days</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);">of inactivity</div>' +
        '</div>' +
        // Point name card
        '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Point Name</div>' +
          '<div style="font-size:1.6rem;font-weight:500;color:var(--text-primary);">' + esc(pointName) + '</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);">Customer-facing label</div>' +
        '</div>' +
      '</div>';

      // Exclusions
      if (exclusions.length > 0) {
        html += '<div style="margin-bottom:16px;">' +
          '<div style="font-size:0.85rem;font-weight:500;color:var(--warm-gray);margin-bottom:8px;">Excluded Categories (earn zero points)</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
        exclusions.forEach(function(cat) {
          html += '<span style="display:inline-block;padding:3px 10px;border-radius:12px;background:rgba(196,133,60,0.15);color:var(--amber);font-size:0.78rem;font-weight:500;">' + esc(cat) + '</span>';
        });
        html += '</div></div>';
      }

      // How it works summary
      html += '<div style="padding:16px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;">' +
        '<div style="font-size:0.85rem;font-weight:500;margin-bottom:8px;color:var(--text-primary);">How it works for customers</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.6;">' +
          '1. Customers earn <strong>' + earnRate + ' ' + esc(pointName) + '</strong> per $1 of eligible spend at checkout.<br>' +
          '2. At checkout, they can redeem all their points: <strong>' + redeemRate + ' ' + esc(pointName) + ' = $1.00 off</strong> (all-or-nothing).<br>' +
          '3. Points expire after <strong>' + expiryDays + ' days</strong> of inactivity. Any purchase resets the clock.<br>' +
          '4. Gift card and credit redemptions do NOT reduce earning base.' +
        '</div>' +
      '</div>';
    }

    container.innerHTML = html;
  }

  // ---- Loyalty Config Modal ----

  window._loyaltyOpenConfig = function() {
    // Loyalty config relocated to My Website › Wallet & loyalty (PR4).
    if (typeof navigateTo === 'function') { navigateTo('website-v2'); if (window.showToast) showToast('Configure loyalty in My Website → Wallet & loyalty'); return; }
    var config = loyaltyConfig || {};
    var exclusions = (config.loyaltyExclusions || []).join(', ');

    var html = '<div class="modal-body">' +
      '<h3 style="margin-top:0;">Loyalty Program Settings</h3>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">' +
          '<input type="checkbox" id="loyaltyConfigEnabled" ' + (config.loyaltyEnabled ? 'checked' : '') + '>' +
          'Enable loyalty program' +
        '</label>' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Point Name</label>' +
        '<input type="text" id="loyaltyConfigName" value="' + esc(config.loyaltyPointName || 'Points') + '" placeholder="Points" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">e.g., Stars, Gems, Rewards Points</div>' +
      '</div>' +
      '<div style="display:flex;gap:12px;margin-bottom:16px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Earn Rate (points per $1)</label>' +
          '<input type="number" id="loyaltyConfigEarn" value="' + (config.loyaltyEarnRate || 1) + '" min="0.1" step="0.1" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Redemption Rate (points per $1)</label>' +
          '<input type="number" id="loyaltyConfigRedeem" value="' + (config.loyaltyRedemptionRate || 50) + '" min="1" step="1" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Expiry Window (days of inactivity)</label>' +
        '<input type="number" id="loyaltyConfigExpiry" value="' + (config.loyaltyExpiryDays || 365) + '" min="30" step="1" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Excluded Categories (comma-separated)</label>' +
        '<input type="text" id="loyaltyConfigExclude" value="' + esc(exclusions) + '" placeholder="Gift Cards, Classes" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">Products in these categories earn zero points.</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="window._loyaltySaveConfig()">Save</button>' +
      '</div>' +
    '</div>';

    openModal(html);
  };

  window._loyaltySaveConfig = async function() {
    var enabled = document.getElementById('loyaltyConfigEnabled').checked;
    var pointName = (document.getElementById('loyaltyConfigName').value || '').trim() || 'Points';
    var earnRate = parseFloat(document.getElementById('loyaltyConfigEarn').value) || 1;
    var redeemRate = parseInt(document.getElementById('loyaltyConfigRedeem').value) || 50;
    var expiryDays = parseInt(document.getElementById('loyaltyConfigExpiry').value) || 365;
    var excludeRaw = document.getElementById('loyaltyConfigExclude').value || '';
    var exclusions = excludeRaw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });

    if (redeemRate < 1) {
      showToast('Redemption rate must be at least 1 point per $1.', true);
      return;
    }

    var data = {
      loyaltyEnabled: enabled,
      loyaltyPointName: pointName,
      loyaltyEarnRate: earnRate,
      loyaltyRedemptionRate: redeemRate,
      loyaltyExpiryDays: expiryDays,
      loyaltyExclusions: exclusions,
      updatedAt: new Date().toISOString()
    };

    try {
      await MastDB.walletConfig.update(data);
      writeAudit('update', 'wallet-config', 'loyalty');
      loyaltyConfig = Object.assign(loyaltyConfig || {}, data);
      closeModal();
      showToast('Loyalty settings saved');
      loadLoyaltyAdmin();
    } catch (err) {
      showToast('Failed to save: ' + err.message, true);
    }
  };

  // ---- Loyalty bridge (thin shim for loyalty-v2.js) ----
  // Re-hosts the exact CLIENT loyalty-config read + write the legacy #loyalty
  // handlers make (loadLoyaltyAdmin's read + window._loyaltySaveConfig's write),
  // parameterized by a data object so the V2 twin can drive them without
  // reimplementing the build/validation/write/audit. Neither is Cloud-Function-
  // backed — the write is a plain MastDB.walletConfig.update + writeAudit, and the
  // public storefront reads admin/walletConfig directly, so the config IS the
  // single source (no public mirror, no side effects to fire). Mirrors
  // window.MembershipBridge / GiftCardsBridge (its siblings in this module).
  window.LoyaltyBridge = {
    // Latest program config (read context for the V2 page + the edit form).
    // Mirrors loadLoyaltyAdmin's `MastDB.get('admin/walletConfig')`.
    getProgramConfig: function() { return Promise.resolve(MastDB.get('admin/walletConfig')); },

    // Mirrors _loyaltySaveConfig EXACTLY: same defaults (Points / 1 / 50 / 365),
    // same `loyaltyPointName || 'Points'`, same `redeemRate < 1` guard, same
    // exclusions split, same updatedAt, then MastDB.walletConfig.update(data) +
    // writeAudit('update','wallet-config','loyalty'). walletConfig.update is a
    // shallow merge so the gift-card slice of the same record survives untouched.
    // data: { enabled, pointName, earnRate, redeemRate, expiryDays, exclusions }
    // (exclusions may be a comma-separated string OR an array). Returns the
    // persisted config object, or null on a validation failure (already toasted).
    saveProgramConfig: async function(d) {
      d = d || {};
      var enabled = !!d.enabled;
      var pointName = ((d.pointName || '') + '').trim() || 'Points';
      var earnRate = parseFloat(d.earnRate) || 1;
      var redeemRate = parseInt(d.redeemRate, 10) || 50;
      var expiryDays = parseInt(d.expiryDays, 10) || 365;
      var exclusions = Array.isArray(d.exclusions)
        ? d.exclusions.map(function(s) { return ('' + s).trim(); }).filter(function(s) { return s; })
        : (('' + (d.exclusions || '')).split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; }));

      if (redeemRate < 1) {
        showToast('Redemption rate must be at least 1 point per $1.', true);
        return null;
      }

      var data = {
        loyaltyEnabled: enabled,
        loyaltyPointName: pointName,
        loyaltyEarnRate: earnRate,
        loyaltyRedemptionRate: redeemRate,
        loyaltyExpiryDays: expiryDays,
        loyaltyExclusions: exclusions,
        updatedAt: new Date().toISOString()
      };
      var tenantId = MastDB.tenantId();
      if (!db || !tenantId) { showToast('Not connected.', true); return null; }
      try {
        await MastDB.walletConfig.update(data);
        writeAudit('update', 'wallet-config', 'loyalty');
        loyaltyConfig = Object.assign(loyaltyConfig || {}, data);
        showToast('Loyalty settings saved');
        return data;
      } catch (err) {
        showToast('Failed to save: ' + err.message, true);
        return null;
      }
    }
  };

  // ============================================================
  // MEMBERSHIP ADMIN
  // ============================================================

  var membershipConfig = null;
  var membershipMembers = [];
  var currentMemberFilter = 'all';

  function loadMembershipAdmin() {
    var container = document.getElementById('membershipAdmin');
    if (!container) return;

    var tenantId = MastDB.tenantId();
    if (!db || !tenantId) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);"><p>Not connected.</p></div>';
      return;
    }

    container.innerHTML = '<div class="loading">Loading membership...</div>';

    // Load config first, then members separately (customers query may be slow/empty)
    MastDB.get('admin/membership/config').then(function(cfg) {
      membershipConfig = cfg || {};
      // Try loading members but don't block render on it
      return MastDB.query('customers').limitToLast(200).once().then(function(custData) {
        custData = custData || {};
        membershipMembers = [];
        Object.keys(custData).forEach(function(uid) {
          var c = custData[uid];
          if (c.membership) {
            membershipMembers.push(Object.assign({ _uid: uid }, c.membership, { email: c.email || c.membership.email || uid }));
          }
        });
        membershipMembers.sort(function(a, b) {
          return (b.startDate || '').localeCompare(a.startDate || '');
        });
      }).catch(function(custErr) {
        console.warn('[Membership] Could not load customer list:', custErr.message);
        membershipMembers = [];
      });
    }).then(function() {
      renderMembershipAdmin(container);
    }).catch(function(err) {
      console.error('[Membership] load error:', err);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">Error: ' + esc(err.message) + '</div>';
    });
  }

  function msStatusBadge(status) {
    var colors = {
      active: 'background:#16a34a;color:white;',
      cancelled: 'background:#f59e0b;color:white;',
      expired: 'background:#9ca3af;color:white;'
    };
    return '<span class="status-badge" style="' + (colors[status] || 'background:#9ca3af;color:white;') + '">' + esc((status || 'unknown').toUpperCase()) + '</span>';
  }

  function renderMembershipAdmin(container) {
    var config = membershipConfig || {};
    var enabled = config.enabled || false;

    var html = '<div class="section-header">' +
      '<h2>Membership</h2>' +
      '<button class="btn btn-primary btn-small" onclick="window._membershipOpenConfig()">&#9881; Settings</button>' +
    '</div>';

    if (!enabled) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#127941;</div>' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">Membership program is disabled</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Enable it in Settings to offer subscription-based benefits to your customers.</p>' +
      '</div>';
      container.innerHTML = html;
      return;
    }

    // Config summary cards
    var programName = config.programName || 'Membership';
    var price = config.annualPrice ? '$' + Number(config.annualPrice).toFixed(2) + '/yr' : 'Not set';

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:24px;">';

    function summaryCard(label, value, detail) {
      return '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">' + esc(label) + '</div>' +
        '<div style="font-size:1.15rem;font-weight:500;color:var(--text-primary);">' + esc(value) + '</div>' +
        (detail ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(detail) + '</div>' : '') +
      '</div>';
    }

    html += summaryCard('Program', programName, price);

    // Discounts
    var discounts = [];
    if (config.productDiscountPct) discounts.push('Products ' + config.productDiscountPct + '%');
    if (config.serviceDiscountPct) discounts.push('Services ' + config.serviceDiscountPct + '%');
    if (config.classSeatDiscountPct) discounts.push('Classes ' + config.classSeatDiscountPct + '%');
    if (config.classMaterialsDiscountPct) discounts.push('Materials ' + config.classMaterialsDiscountPct + '%');
    html += summaryCard('Discounts', discounts.length > 0 ? discounts.length + ' active' : 'None', discounts.join(', '));

    if (config.freeShippingThreshold != null) {
      html += summaryCard('Free Shipping', config.freeShippingThreshold === 0 ? 'Always' : 'Over $' + config.freeShippingThreshold, 'Member benefit');
    }
    if (config.loyaltyPointMultiplier && config.loyaltyPointMultiplier > 1) {
      html += summaryCard('Loyalty', config.loyaltyPointMultiplier + 'x', 'Point multiplier');
    }
    if (config.priorityEnrollmentDays) {
      html += summaryCard('Early Enrollment', config.priorityEnrollmentDays + ' days', 'Priority access');
    }
    if (config.earlyProductAccessHours) {
      html += summaryCard('Early Products', config.earlyProductAccessHours + ' hrs', 'Before public');
    }
    html += summaryCard('Promo Stacking', config.allowPromoStack ? 'Allowed' : 'Membership only', config.allowPromoStack ? 'Sale + membership combo' : 'Replaces sale price');

    // Stripe info
    if (config.stripeProductId) {
      html += summaryCard('Stripe', 'Connected', 'Product: ' + config.stripeProductId.slice(0, 12) + '...');
    } else {
      html += summaryCard('Stripe', 'Auto-create', 'On first signup');
    }

    html += '</div>';

    // Active member count
    var activeCt = membershipMembers.filter(function(m) { return m.status === 'active'; }).length;
    var cancelledCt = membershipMembers.filter(function(m) { return m.status === 'cancelled'; }).length;
    var expiredCt = membershipMembers.filter(function(m) { return m.status === 'expired'; }).length;

    // Member list
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<div style="font-size:0.9rem;font-weight:500;color:var(--text-primary);">Members (' + membershipMembers.length + ')</div>' +
      '<button class="btn btn-outline btn-small" onclick="window._membershipGrantModal()">+ Grant</button>' +
    '</div>';

    // Filter pills
    html += '<div style="display:flex;gap:6px;margin-bottom:12px;">';
    ['all', 'active', 'cancelled', 'expired'].forEach(function(f) {
      var ct = f === 'all' ? membershipMembers.length : (f === 'active' ? activeCt : f === 'cancelled' ? cancelledCt : expiredCt);
      var isActive = currentMemberFilter === f;
      html += '<button style="padding:5px 12px;border-radius:12px;font-size:0.78rem;font-weight:500;cursor:pointer;border:1px solid ' + (isActive ? 'var(--amber)' : 'var(--cream-dark)') + ';background:' + (isActive ? 'rgba(196,133,60,0.15)' : 'var(--cream)') + ';color:' + (isActive ? 'var(--amber)' : 'var(--warm-gray)') + ';" onclick="window._membershipFilter(\'' + f + '\')">' +
        esc(f.charAt(0).toUpperCase() + f.slice(1)) + ' (' + ct + ')</button>';
    });
    html += '</div>';

    var filtered = currentMemberFilter === 'all' ? membershipMembers : membershipMembers.filter(function(m) { return m.status === currentMemberFilter; });

    if (filtered.length === 0) {
      html += '<div style="text-align:center;padding:24px;color:var(--warm-gray);font-size:0.85rem;">No members' + (currentMemberFilter !== 'all' ? ' with status "' + esc(currentMemberFilter) + '"' : '') + '.</div>';
    } else {
      html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
        '<thead><tr style="border-bottom:2px solid var(--cream-dark);">' +
          '<th style="text-align:left;padding:8px;color:var(--warm-gray);font-weight:500;">Email / UID</th>' +
          '<th style="text-align:left;padding:8px;color:var(--warm-gray);font-weight:500;">Status</th>' +
          '<th style="text-align:left;padding:8px;color:var(--warm-gray);font-weight:500;">Since</th>' +
          '<th style="text-align:left;padding:8px;color:var(--warm-gray);font-weight:500;">Renewal</th>' +
          '<th style="text-align:left;padding:8px;color:var(--warm-gray);font-weight:500;">Processor</th>' +
          '<th style="text-align:right;padding:8px;color:var(--warm-gray);font-weight:500;">Actions</th>' +
        '</tr></thead><tbody>';
      filtered.forEach(function(m) {
        html += '<tr style="border-bottom:1px solid var(--cream-dark);">' +
          '<td style="padding:8px;">' + esc(m.email) + '</td>' +
          '<td style="padding:8px;">' + msStatusBadge(m.status) + '</td>' +
          '<td style="padding:8px;">' + formatDate(m.startDate) + '</td>' +
          '<td style="padding:8px;">' + formatDate(m.renewalDate || m.expiryDate) + '</td>' +
          '<td style="padding:8px;font-size:0.78rem;color:var(--warm-gray);">' + esc(m.processor || 'manual') + '</td>' +
          '<td style="padding:8px;text-align:right;">' +
            (m.status === 'active' ? '<button class="btn btn-danger btn-small" onclick="window._membershipRevoke(\'' + esc(m._uid) + '\')">Revoke</button>' : '') +
            (m.status === 'expired' || m.status === 'cancelled' ? '<button class="btn btn-outline btn-small" onclick="window._membershipReactivate(\'' + esc(m._uid) + '\')">Reactivate</button>' : '') +
          '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }

    container.innerHTML = html;
  }

  window._membershipFilter = function(filter) {
    currentMemberFilter = filter;
    var container = document.getElementById('membershipAdmin');
    if (container) renderMembershipAdmin(container);
  };

  // ---- Settings Modal ----

  window._membershipOpenConfig = function() {
    var c = membershipConfig || {};

    var html = '<div class="modal-body">' +
      '<h3 style="margin-top:0;">Membership Settings</h3>' +
      // Enable toggle
      '<div style="margin-bottom:16px;">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">' +
          '<input type="checkbox" id="msConfigEnabled" ' + (c.enabled ? 'checked' : '') + '>' +
          'Enable membership program' +
        '</label>' +
      '</div>' +
      // Program name + price
      '<div style="display:flex;gap:12px;margin-bottom:16px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Program Name</label>' +
          '<input type="text" id="msConfigName" value="' + esc(c.programName || '') + '" placeholder="Membership" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Annual Price ($)</label>' +
          '<input type="number" id="msConfigPrice" value="' + (c.annualPrice || '') + '" min="0" step="0.01" placeholder="49.99" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
      '</div>' +
      // Discounts
      '<div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;">Member Discounts (%)</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">' +
        '<div><label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:2px;">Products</label>' +
          '<input type="number" id="msConfigProdPct" value="' + (c.productDiscountPct || '') + '" min="0" max="100" step="1" placeholder="0" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;"></div>' +
        '<div><label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:2px;">Services</label>' +
          '<input type="number" id="msConfigSvcPct" value="' + (c.serviceDiscountPct || '') + '" min="0" max="100" step="1" placeholder="0" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;"></div>' +
        '<div><label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:2px;">Class Seats</label>' +
          '<input type="number" id="msConfigClassPct" value="' + (c.classSeatDiscountPct || '') + '" min="0" max="100" step="1" placeholder="0" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;"></div>' +
        '<div><label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:2px;">Class Materials</label>' +
          '<input type="number" id="msConfigMatPct" value="' + (c.classMaterialsDiscountPct || '') + '" min="0" max="100" step="1" placeholder="0" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;"></div>' +
      '</div>' +
      // Shipping + loyalty
      '<div style="display:flex;gap:12px;margin-bottom:16px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Free Shipping Threshold ($)</label>' +
          '<input type="number" id="msConfigShipThresh" value="' + (c.freeShippingThreshold != null ? c.freeShippingThreshold : '') + '" min="0" step="1" placeholder="0 = always free" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">0 = always free for members</div>' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Loyalty Multiplier</label>' +
          '<input type="number" id="msConfigLoyaltyMult" value="' + (c.loyaltyPointMultiplier || '') + '" min="1" step="0.5" placeholder="2" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">e.g., 2 = double loyalty points</div>' +
        '</div>' +
      '</div>' +
      // Access gates
      '<div style="display:flex;gap:12px;margin-bottom:16px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Priority Enrollment (days)</label>' +
          '<input type="number" id="msConfigPriorityDays" value="' + (c.priorityEnrollmentDays || '') + '" min="0" step="1" placeholder="e.g., 7" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Early Product Access (hours)</label>' +
          '<input type="number" id="msConfigEarlyHrs" value="' + (c.earlyProductAccessHours || '') + '" min="0" step="1" placeholder="e.g., 48" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
      '</div>' +
      // Stacking
      '<div style="margin-bottom:16px;">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">' +
          '<input type="checkbox" id="msConfigPromoStack" ' + (c.allowPromoStack ? 'checked' : '') + '>' +
          'Allow promo stacking (sale discount + membership discount)' +
        '</label>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;margin-left:24px;">When off, membership discount replaces sale price (no double discount).</div>' +
      '</div>' +
      // Footer
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="window._membershipSaveConfig()">Save</button>' +
      '</div>' +
    '</div>';

    openModal(html);
  };

  window._membershipSaveConfig = async function() {
    // Single-sourced through MembershipBridge.saveConfig (same write + audit);
    // this handler just collects the modal DOM, then closes + reloads on success.
    var shipThresh = document.getElementById('msConfigShipThresh').value;
    var saved = await window.MembershipBridge.saveConfig({
      enabled: document.getElementById('msConfigEnabled').checked,
      programName: document.getElementById('msConfigName').value,
      annualPrice: document.getElementById('msConfigPrice').value,
      productDiscountPct: document.getElementById('msConfigProdPct').value,
      serviceDiscountPct: document.getElementById('msConfigSvcPct').value,
      classSeatDiscountPct: document.getElementById('msConfigClassPct').value,
      classMaterialsDiscountPct: document.getElementById('msConfigMatPct').value,
      freeShippingThreshold: shipThresh,
      loyaltyPointMultiplier: document.getElementById('msConfigLoyaltyMult').value,
      priorityEnrollmentDays: document.getElementById('msConfigPriorityDays').value,
      earlyProductAccessHours: document.getElementById('msConfigEarlyHrs').value,
      allowPromoStack: document.getElementById('msConfigPromoStack').checked
    });
    if (saved) {
      closeModal();
      loadMembershipAdmin();
    }
  };

  // ---- Grant / Revoke / Reactivate ----

  window._membershipGrantModal = function() {
    var html = '<div style="padding:24px;">' +
      '<h3 style="margin-top:0;">Grant Membership</h3>' +
      '<div style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Customer UID</label>' +
        '<input type="text" id="msGrantUid" placeholder="Firebase UID" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">Find the UID in Contacts or Firebase Auth console.</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="window._membershipGrant()">Grant</button>' +
      '</div>' +
      '</div>';
    openModal(html);
  };

  window._membershipGrant = async function() {
    // Single-sourced through MembershipBridge.grant (same writes + audit).
    var uid = (document.getElementById('msGrantUid').value || '').trim();
    if (await window.MembershipBridge.grant(uid)) {
      closeModal();
      loadMembershipAdmin();
    }
  };

  window._membershipRevoke = async function(uid) {
    if (!await mastConfirm('Revoke this membership? The customer will lose all benefits immediately.', { title: 'Revoke Membership', danger: true })) return;
    // Single-sourced through MembershipBridge.revoke (same writes + audit).
    if (await window.MembershipBridge.revoke(uid)) loadMembershipAdmin();
  };

  window._membershipReactivate = async function(uid) {
    // Single-sourced through MembershipBridge.reactivate (same writes + audit).
    if (await window.MembershipBridge.reactivate(uid)) loadMembershipAdmin();
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
        setup: function() { loadLoyaltyAdmin(); }
      },
      'membership': {
        tab: 'membershipTab',
        setup: function() { loadMembershipAdmin(); }
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
      loyaltyConfig = null;
      membershipConfig = null;
      membershipMembers = [];
      currentMemberFilter = 'all';
    }
  });

})();
