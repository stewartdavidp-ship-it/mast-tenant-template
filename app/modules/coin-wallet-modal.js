/**
 * Coin / token wallet modal — the "Token Wallet" slide-up showing balance,
 * upcoming charges, transaction history, and the buy-coins purchase flow.
 *
 * Extracted from app/index.html's inline block (decomposition master plan,
 * Track 1 — second leaf, proving the EAGER-SHIM recipe for a surface with
 * cross-module callers). Lazy-loaded on demand: index.html keeps a tiny eager
 * `openCoinPurchaseModal` shim that loadModule()s this then calls the impl, so
 * existing callers (shows.js, shows-v2.js, settings) work unchanged.
 *
 * Reads only eager globals (getTokenWallet, getTenantSubscription, TIER_CONFIG,
 * esc, openModal, closeModal, callCF, auth, MastDB, showToast) — all defined
 * before a user can open the modal. The token-balance state (_tokenWallet) and
 * the eager top-bar indicator stay in the shell; this module only reads via
 * getTokenWallet(). Exposes the impl + the modal's onclick targets on window.
 */
(function () {
  'use strict';

  var _coinPurchaseReturnRoute = null;
  var _coinPurchaseReturnAction = null;
  var _walletHistoryCache = null;

  function toggleWalletSection(sectionId) {
    var el = document.getElementById(sectionId);
    var arrow = document.getElementById(sectionId + 'Arrow');
    if (!el) return;
    if (el.style.display === 'none') {
      el.style.display = 'block';
      if (arrow) arrow.textContent = '▾';
      if (sectionId === 'walletHistory' && !el.dataset.loaded) {
        loadWalletHistory();
      }
      if (sectionId === 'walletUpcoming' && !el.dataset.loaded) {
        renderWalletUpcoming();
      }
    } else {
      el.style.display = 'none';
      if (arrow) arrow.textContent = '▸';
    }
  }

  async function loadWalletHistory() {
    var container = document.getElementById('walletHistory');
    if (!container) return;
    container.dataset.loaded = '1';
    container.innerHTML = '<div style="padding:8px;font-size:0.78rem;color:var(--warm-gray);">Loading...</div>';
    try {
      var snap = await MastDB.tokenLog.recent(50);
      var entries = [];
      var rows = snap || {};
      Object.keys(rows).forEach(function(childKey) { entries.push(rows[childKey]); });
      // Filter to last 30 days
      var cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
      entries = entries.filter(function(e) { var ts = e.at || e.timestamp; return ts && new Date(ts).getTime() > cutoff; });
      entries.sort(function(a, b) { return new Date(b.at || b.timestamp).getTime() - new Date(a.at || a.timestamp).getTime(); });

      if (entries.length === 0) {
        container.innerHTML = '<div style="padding:8px;font-size:0.78rem;color:var(--warm-gray);">No transactions in the last 30 days.</div>';
        return;
      }

      var h = '<div style="max-height:200px;overflow-y:auto;">';
      entries.forEach(function(e, i) {
        var ts = e.at || e.timestamp;
        var d = new Date(ts);
        var dateStr = (d.getMonth() + 1) + '/' + d.getDate();
        var isCredit = (e.type || '').indexOf('credit') >= 0 || (e.type || '').indexOf('reset') >= 0;
        var amtColor = isCredit ? 'var(--sage, #7A8B6F)' : 'var(--danger, #dc2626)';
        var amtPrefix = isCredit ? '+' : '−';
        var label = e.reason || e.description || e.type || 'Transaction';
        var bg = i % 2 === 0 ? 'transparent' : 'rgba(122,139,111,0.04)';
        h += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:0.78rem;background:' + bg + ';border-radius:4px;">';
        h += '<span style="color:var(--warm-gray);min-width:36px;">' + dateStr + '</span>';
        h += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(label) + '</span>';
        h += '<span style="color:' + amtColor + ';font-weight:600;min-width:48px;text-align:right;">' + amtPrefix + Math.abs(e.amount || 0) + '</span>';
        if (e.balanceAfter !== undefined) {
          h += '<span style="color:var(--warm-gray);font-size:0.72rem;min-width:36px;text-align:right;">' + e.balanceAfter + '</span>';
        }
        h += '</div>';
      });
      h += '</div>';
      container.innerHTML = h;
    } catch (err) {
      container.innerHTML = '<div style="padding:8px;font-size:0.78rem;color:var(--danger);">Failed to load history.</div>';
    }
  }

  async function renderWalletUpcoming() {
    var container = document.getElementById('walletUpcoming');
    if (!container) return;
    container.dataset.loaded = '1';
    var w = getTokenWallet();
    var allocation = w.monthlyAllocation || 0;
    var borrowed = w.borrowedAmount || 0;

    // Count extra bank connections
    var extraBankCost = 0;
    try {
      if (typeof MastDB !== 'undefined' && MastDB.plaidItems) {
        var allItems = (await MastDB.plaidItems.list()) || {};
        var activeCount = Object.values(allItems).filter(function(i) { return i.status === 'active'; }).length;
        // Bank limits per plan (mirrors PLAID_BANK_LIMITS in expenses module)
        var bankLimits = { 'free': 0, 'publish': 2, 'launch': 2, 'operate': 3, 'command': 5 };
        var sub = getTenantSubscription();
        var plan = sub.plan || sub.tier || 'publish';
        var includedLimit = bankLimits[plan] !== undefined ? bankLimits[plan] : 1;
        var extraBanks = Math.max(0, activeCount - includedLimit);
        extraBankCost = extraBanks * 100;
      }
    } catch (e) { /* ignore — expenses module may not be loaded */ }

    var net = allocation - borrowed - extraBankCost;

    var h = '<div style="padding:4px 0;">';
    // Line items
    h += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem;">';
    h += '<span>Monthly allocation</span>';
    h += '<span style="color:var(--sage, #7A8B6F);font-weight:600;">+' + allocation + '</span>';
    h += '</div>';

    if (borrowed > 0) {
      h += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem;">';
      h += '<span>Borrowed payback</span>';
      h += '<span style="color:var(--danger, #dc2626);font-weight:600;">−' + borrowed + '</span>';
      h += '</div>';
    }

    if (extraBankCost > 0) {
      var extraCount = extraBankCost / 100;
      h += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem;">';
      h += '<span>Extra bank' + (extraCount > 1 ? 's' : '') + ' (' + extraCount + ' over limit)</span>';
      h += '<span style="color:var(--danger, #dc2626);font-weight:600;">−' + extraBankCost + '</span>';
      h += '</div>';
    }

    if (borrowed > 0 || extraBankCost > 0) {
      h += '<div style="border-top:1px solid var(--cream-dark, var(--cream-dark));margin:6px 0;"></div>';
      var netColor = net >= 0 ? 'var(--sage, #7A8B6F)' : 'var(--danger, #dc2626)';
      h += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem;font-weight:600;">';
      h += '<span>Est. available after reset</span>';
      h += '<span style="color:' + netColor + ';">' + net + '</span>';
      h += '</div>';
    } else {
      h += '<div style="padding:4px 0;font-size:0.78rem;color:var(--warm-gray);">No recurring charges. Full allocation available at reset.</div>';
    }

    h += '</div>';
    container.innerHTML = h;
  }

  function openCoinPurchaseModal(returnRoute, returnAction) {
    _coinPurchaseReturnRoute = returnRoute || null;
    _coinPurchaseReturnAction = returnAction || null;
    _walletHistoryCache = null;
    var w = getTokenWallet();
    var sub = getTenantSubscription();
    var tier = TIER_CONFIG[sub.tier] || {};
    var resetDate = w.lastResetAt ? MastFormat.date(new Date(w.lastResetAt).getTime() + 30 * 24 * 60 * 60 * 1000) : 'next billing cycle';

    var h = '<div style="padding:20px;position:relative;">';
    h += '<button class="modal-close" onclick="closeModal()" style="position:absolute;top:12px;right:12px;">&times;</button>';
    h += '<h3 style="margin:0 0 16px;font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;">Token Wallet</h3>';

    // Status summary
    var totalTokens = (w.currentBalance || 0) + (w.coinTokenSurplus || 0) + ((w.coinBalance || 0) * 100);
    h += '<div style="background:var(--cream-dark, var(--cream-dark));border-radius:10px;padding:16px;margin-bottom:16px;">';
    h += '<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:12px;">';
    h += '<div style="font-size:1.6rem;font-weight:700;">' + totalTokens.toLocaleString() + '</div>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);">tokens available</div>';
    h += '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr' + (w.coinTokenSurplus ? ' 1fr' : '') + ';gap:12px;">';
    h += '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;">Monthly</div><div style="font-size:1rem;font-weight:600;">' + (w.currentBalance || 0) + '<span style="font-size:0.78rem;font-weight:400;opacity:0.7">/' + (w.monthlyAllocation || 0) + '</span></div></div>';
    h += '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;">Coins</div><div style="font-size:1rem;font-weight:600;">' + (w.coinBalance || 0) + '</div></div>';
    if (w.coinTokenSurplus) {
      h += '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;">Surplus</div><div style="font-size:1rem;font-weight:600;">' + w.coinTokenSurplus + '</div></div>';
    }
    h += '</div>';
    if (w.status === 'suspended') {
      h += '<div style="margin-top:12px;padding:8px 12px;background:rgba(220,38,38,0.1);border-radius:6px;color:var(--danger);font-size:0.85rem;">AI features paused until ' + esc(resetDate) + ' or coin purchase.</div>';
    } else if (w.status === 'borrowing') {
      h += '<div style="margin-top:12px;padding:8px 12px;background:rgba(196,133,60,0.1);border-radius:6px;color:var(--amber);font-size:0.85rem;">Borrowing against next month. ' + (w.borrowedAmount || 0) + ' tokens borrowed.</div>';
    }
    h += '<div style="margin-top:8px;font-size:0.78rem;color:var(--warm-gray);">Resets: ' + esc(resetDate) + '</div>';
    h += '</div>';

    // Expandable: Upcoming Charges
    h += '<div style="border-top:1px solid var(--cream-dark, var(--cream-dark));padding:0;">';
    h += '<div onclick="toggleWalletSection(\'walletUpcoming\')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:10px 0;font-size:0.9rem;font-weight:600;">';
    h += '<span>Upcoming Charges</span>';
    h += '<span id="walletUpcomingArrow" style="font-size:0.78rem;color:var(--warm-gray);">▸</span>';
    h += '</div>';
    h += '<div id="walletUpcoming" style="display:none;padding-bottom:8px;"></div>';
    h += '</div>';

    // Expandable: Transaction History
    h += '<div style="border-top:1px solid var(--cream-dark, var(--cream-dark));padding:0;">';
    h += '<div onclick="toggleWalletSection(\'walletHistory\')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:10px 0;font-size:0.9rem;font-weight:600;">';
    h += '<span>Transaction History</span>';
    h += '<span id="walletHistoryArrow" style="font-size:0.78rem;color:var(--warm-gray);">▸</span>';
    h += '</div>';
    h += '<div id="walletHistory" style="display:none;padding-bottom:8px;"></div>';
    h += '</div>';

    // Purchase section
    h += '<div style="border-top:1px solid var(--cream-dark, var(--cream-dark));padding-top:16px;margin-top:4px;">';
    h += '<h4 style="margin:0 0 8px;font-size:0.9rem;">Buy Coins</h4>';
    h += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 12px;">1 coin = 100 tokens = $1. Minimum 10 coins ($10). Coins never expire.</p>';
    h += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">';
    h += '<input type="number" id="coinPurchaseAmount" min="10" value="10" step="5" style="width:80px;padding:8px 12px;border:1px solid var(--cream-dark);border-radius:8px;font-size:1rem;text-align:center;" />';
    h += '<span style="font-size:0.9rem;color:var(--warm-gray);">coins</span>';
    h += '<span style="margin-left:auto;font-size:1.15rem;font-weight:600;" id="coinPurchaseTotal">$10</span>';
    h += '</div>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:16px;" id="coinPurchaseEstimate">1,000 tokens ≈ 303 Studio Assistant calls</div>';
    h += '<button onclick="purchaseCoins()" id="coinPurchaseBtn" style="width:100%;padding:12px;background:var(--amber, var(--amber));color:white;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;">Purchase Coins</button>';
    h += '</div>';

    h += '</div>';

    openModal(h);

    // Wire up the amount input
    var amountInput = document.getElementById('coinPurchaseAmount');
    if (amountInput) {
      amountInput.addEventListener('input', function() {
        var val = parseInt(this.value) || 0;
        var totalEl = document.getElementById('coinPurchaseTotal');
        var estEl = document.getElementById('coinPurchaseEstimate');
        var btn = document.getElementById('coinPurchaseBtn');
        if (val < 10) {
          if (totalEl) totalEl.textContent = '$' + val;
          if (estEl) { estEl.textContent = 'Minimum purchase is 10 coins ($10)'; estEl.style.color = 'var(--danger, #dc2626)'; }
          if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
        } else {
          if (totalEl) totalEl.textContent = '$' + val;
          if (estEl) { estEl.textContent = (val * 100).toLocaleString() + ' tokens ≈ ' + Math.floor(val * 100 / 3.3).toLocaleString() + ' Studio Assistant calls'; estEl.style.color = 'var(--warm-gray)'; }
          if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
        }
      });
    }
  }

  async function purchaseCoins() {
    var amountInput = document.getElementById('coinPurchaseAmount');
    var coins = parseInt(amountInput ? amountInput.value : '0');
    if (!coins || coins < 10) {
      showToast('Minimum purchase is 10 coins ($10)', true);
      return;
    }
    var btn = document.getElementById('coinPurchaseBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening checkout...'; }
    try {
      var token = await auth.currentUser.getIdToken();
      var resp = await callCF('/createCoinCheckout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ tenantId: MastDB.tenantId(), coins: coins, returnRoute: _coinPurchaseReturnRoute || undefined, returnAction: _coinPurchaseReturnAction || undefined })
      });
      var data = await resp.json();
      if (data.sessionUrl) {
        window.location.href = data.sessionUrl;
      } else {
        showToast(data.error || 'Failed to create checkout', true);
        if (btn) { btn.disabled = false; btn.textContent = 'Purchase Coins'; }
      }
    } catch (err) {
      showToast('Purchase failed: ' + err.message, true);
      if (btn) { btn.disabled = false; btn.textContent = 'Purchase Coins'; }
    }
  }

  // Expose the impl + the modal's inline-onclick targets on window. The eager
  // `openCoinPurchaseModal` shim in index.html calls openCoinPurchaseModalImpl
  // after loadModule(); toggleWalletSection/purchaseCoins are referenced by the
  // modal HTML's onclick handlers (resolved once the modal — i.e. this module —
  // is open).
  window.openCoinPurchaseModalImpl = openCoinPurchaseModal;
  window.toggleWalletSection = toggleWalletSection;
  window.purchaseCoins = purchaseCoins;
  window.loadWalletHistory = loadWalletHistory;
  window.renderWalletUpcoming = renderWalletUpcoming;

  // No route, no listeners — register only so loadModule() short-circuits on
  // repeat opens instead of re-fetching the script.
  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('coinWalletModal', {});
  }
})();
