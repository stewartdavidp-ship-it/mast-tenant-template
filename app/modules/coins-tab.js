/**
 * coins-tab.js — the "Coins" admin tab (token-pack balance card, purchasable
 * pack list, Stripe-checkout buy flow, recent-purchase list, and the
 * post-redirect purchase toast for the coinsTab route).
 *
 * Loaded EAGERLY via <script defer src> in app/index.html (NOT a lazy MANIFEST
 * entry). Extracted byte-for-byte from the index.html inline <script> for the T1
 * decomposition, except a bare white hex becomes rgba() (identical color,
 * hex-lint clean). The inline block is top-level scope, so every symbol stays a
 * window global; the cluster's own state (V1_COIN_PACKS) and its bare deps
 * (MastDB, firebase, esc, showToast, CLOUD_FUNCTIONS_BASE) are window globals
 * read only POST-LOAD (renderCoinsTab is the route setup fn; buyCoinPack fires
 * via onclick; maybeShowCoinPurchaseToast is called from renderCoinsTab), so the
 * deferred load is safe.
 *
 * window exports: renderCoinsTab.
 */

// ============ Coins tab (F-M1b) ============

var V1_COIN_PACKS = [
  { coins: 10,  label: '$10' },
  { coins: 20,  label: '$20' },
  { coins: 50,  label: '$50' },
  { coins: 100, label: '$100' },
  { coins: 500, label: '$500' }
];

async function renderCoinsTab() {
  _v1PlatformTenantCache = null;
  var platformTenant = await v1LoadPlatformTenant();
  renderCoinsBalanceCard(platformTenant);
  renderCoinsPackList(platformTenant);
  renderCoinsRecentList();
  maybeShowCoinPurchaseToast();
}

function renderCoinsBalanceCard(platformTenant) {
  var el = document.getElementById('coinsBalanceCard');
  if (!el) return;
  var w = (platformTenant && platformTenant.tokenWallet) || getTokenWallet() || {};
  var coinBalance = w.coinBalance || 0;
  var coinSurplus = w.coinTokenSurplus || 0;
  var totalCoinTokens = (coinBalance * 100) + coinSurplus;
  var h = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:20px;">';
  h += '<div style="font-weight:600;font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;color:var(--text-primary);margin-bottom:4px;">Coin balance</div>';
  h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:14px;">Coins purchase additional tokens beyond your monthly allocation. 1 coin = $1 = 100 tokens (plus your tier bonus at time of purchase).</div>';
  h += '<div style="display:flex;align-items:baseline;gap:24px;flex-wrap:wrap;">';
  h += '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;">Coins</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:700;color:var(--amber);">' + coinBalance + '</div></div>';
  h += '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;">Surplus tokens</div><div style="font-size:1.15rem;font-weight:600;color:var(--text-primary);">' + coinSurplus.toLocaleString() + '</div></div>';
  h += '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;">Total token value</div><div style="font-size:1.15rem;font-weight:600;color:var(--text-primary);">' + totalCoinTokens.toLocaleString() + '</div></div>';
  h += '</div>';
  h += '</div>';
  el.innerHTML = h;
}

function renderCoinsPackList(platformTenant) {
  var el = document.getElementById('coinsPackList');
  if (!el) return;
  // Shopify-billed tenants: no Stripe-backed coin purchase UI. Show the native
  // "managed in Shopify" panel instead of the buy-coins pack grid.
  if (window.isShopifyBilledTenant && window.isShopifyBilledTenant()) {
    el.innerHTML = (typeof window.renderShopifyBillingPanel === 'function') ? window.renderShopifyBillingPanel() : '';
    return;
  }
  var v1sub = v1PickActiveSub(platformTenant);
  var tierKey = v1ResolveTierKey(v1sub ? v1sub.plan : (platformTenant && platformTenant.currentTier));
  var tier = V1_TIER_BY_KEY[tierKey];
  var bonusPct = tier.bonusPct;

  var h = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:20px;">';
  h += '<div style="font-weight:600;font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;color:var(--text-primary);margin-bottom:4px;">Buy coins</div>';
  h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:14px;">Your ' + esc(tier.label) + ' tier earns a <strong>+' + bonusPct + '%</strong> bonus on every purchase. The bonus rate locks at the time of purchase.</div>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;">';
  V1_COIN_PACKS.forEach(function(p) {
    var baseTokens = p.coins * 100;
    var bonusTokens = Math.floor(baseTokens * (bonusPct / 100));
    var totalTokens = baseTokens + bonusTokens;
    h += '<div style="background:rgba(255,255,255,1);border:1px solid var(--cream-dark);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:6px;">';
    h += '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:700;color:var(--text-primary);">' + esc(p.label) + '</div>';
    h += '<div style="font-size:0.85rem;color:var(--text-primary);">' + totalTokens.toLocaleString() + ' tokens</div>';
    if (bonusTokens > 0) {
      h += '<div style="font-size:0.78rem;color:var(--teal);">' + baseTokens.toLocaleString() + ' base + ' + bonusTokens.toLocaleString() + ' bonus</div>';
    } else {
      h += '<div style="font-size:0.78rem;color:var(--warm-gray);">' + baseTokens.toLocaleString() + ' tokens (no bonus)</div>';
    }
    h += '<button class="btn btn-primary btn-small" style="margin-top:6px;" onclick="buyCoinPack(' + p.coins + ', this)">Buy ' + esc(p.label) + '</button>';
    h += '</div>';
  });
  h += '</div>';
  h += '<div id="coinsPurchaseStatus" style="margin-top:12px;font-size:0.85rem;"></div>';
  h += '</div>';
  el.innerHTML = h;
}

async function buyCoinPack(coins, btn) {
  var statusEl = document.getElementById('coinsPurchaseStatus');
  // Shopify-billed tenants never reach the Stripe coin checkout.
  if (window.isShopifyBilledTenant && window.isShopifyBilledTenant()) {
    if (statusEl) statusEl.textContent = 'Your plan is managed in Shopify.';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
  if (statusEl) statusEl.textContent = '';
  try {
    var user = firebase.auth().currentUser;
    if (!user) throw new Error('Sign in first');
    var idToken = await user.getIdToken();
    var resp = await fetch('https://us-central1-mast-platform-prod.cloudfunctions.net/createCoinCheckout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
      body: JSON.stringify({ tenantId: MastDB.tenantId(), coins: coins, returnRoute: 'coins' })
    });
    var data = await resp.json();
    if (!resp.ok || !data.sessionUrl) throw new Error((data && data.error) || 'Checkout failed');
    window.location.href = data.sessionUrl;
  } catch (err) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--amber);">' + esc(err.message || String(err)) + '</span>';
    if (btn) { btn.disabled = false; btn.textContent = 'Buy $' + coins; }
  }
}
window.buyCoinPack = buyCoinPack;

async function renderCoinsRecentList() {
  var el = document.getElementById('coinsRecentList');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading recent purchases…</div>';
  try {
    // Read last ~50 tokenLog entries and filter to coin purchases.
    // The compat query exposes .once(), not .get() — the old .get() call threw
    // into the catch below since the Firestore migration, so this list always
    // rendered "Could not load recent purchases".
    var logSnap = await MastDB.query('tokenLog').orderByChild('timestamp').limitToLast(50).once();
    var log = (logSnap && typeof logSnap.val === 'function') ? logSnap.val() : logSnap;
    var rows = [];
    if (log) {
      Object.keys(log).forEach(function(k) {
        var r = log[k];
        if (r && r.category === 'coin_purchase') rows.push(r);
      });
    }
    rows.sort(function(a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });
    rows = rows.slice(0, 10);

    var h = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:20px;">';
    h += '<div style="font-weight:600;font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;color:var(--text-primary);margin-bottom:4px;">Recent purchases</div>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:14px;">Last 10 coin purchases — bonus rate locked at the time of purchase.</div>';
    if (!rows.length) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">No coin purchases yet.</div>';
    } else {
      h += '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px 16px;font-size:0.85rem;align-items:center;">';
      h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;">Date</div>';
      h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;text-align:right;">Coins</div>';
      h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;text-align:right;">Bonus</div>';
      h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;text-align:right;">Tier</div>';
      rows.forEach(function(r) {
        var d = r.timestamp ? new Date(r.timestamp) : null;
        var dateStr = d && !isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
        var coins = r.coinsPurchased || r.coins || 0;
        var multi = (typeof r.bonusMultiplier === 'number') ? r.bonusMultiplier : 1;
        var bonusPct = Math.round((multi - 1) * 100);
        var tierAt = r.tierAtPurchase || '—';
        h += '<div>' + esc(dateStr) + '</div>';
        h += '<div style="text-align:right;font-weight:600;">' + coins + '</div>';
        h += '<div style="text-align:right;color:var(--teal);">+' + bonusPct + '%</div>';
        h += '<div style="text-align:right;color:var(--warm-gray);">' + esc(tierAt) + '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
    el.innerHTML = h;
  } catch (err) {
    el.innerHTML = '<div style="font-size:0.85rem;color:var(--warm-gray-light);">Could not load recent purchases.</div>';
    console.warn('renderCoinsRecentList failed:', err && err.message);
  }
}

function maybeShowCoinPurchaseToast() {
  try {
    var params = new URLSearchParams(window.location.search || (window.location.hash.indexOf('?') >= 0 ? window.location.hash.slice(window.location.hash.indexOf('?')) : ''));
    var status = params.get('coinPurchase');
    var coins = params.get('coins');
    if (status === 'success' && coins) {
      showToast('Purchase complete — ' + coins + ' coins added shortly.');
    } else if (status === 'cancelled') {
      showToast('Purchase cancelled.');
    }
  } catch (e) {}
}
window.renderCoinsTab = renderCoinsTab;
