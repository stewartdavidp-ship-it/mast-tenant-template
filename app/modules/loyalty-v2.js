/**
 * loyalty-v2.js — read-focused Faceted Record twin of the legacy Loyalty MEMBERS
 * surface (doc 17 conversion playbook; sibling of membership-v2.js).
 *
 * Legacy cart.js (#loyalty, owned by the Cart/Storefront module) hosts the
 * Loyalty admin — but that surface is ONLY the program CONFIG (earn rate,
 * redemption rate, expiry window, point name, excluded categories). It has no
 * members table. The loyalty program config is already converted by wallet-v2.js
 * (the 'loyalty-v2' instrument object there edits admin/walletConfig). This twin
 * converts the OTHER loyalty surface — the MEMBERS: customers who hold a points
 * balance — to the Entity Engine: a schema-driven list and a read-focused Faceted
 * Record slide-out (Overview + a points-history facet). Config stays on legacy.
 *
 * Variant (doc 17 §1a): a loyalty member is a person + points balance + last
 * activity + a points ledger — a faceted record with NO governed lifecycle (points
 * are earned/redeemed by the storefront + Cloud Functions, not advanced through a
 * MastFlow phase machine). So a Faceted Record, NOT Process/MastFlow.
 *
 * Read-focused MEMBER roster (no member edits — points are earned/redeemed by the
 * storefront + Cloud Functions, and per-customer point adjustments live on the
 * customer Wallet). But the program CONFIG (enable/disable, point name, earn rate,
 * redemption rate, expiry, excluded categories) is now NATIVE here too: a singleton
 * "Program settings" config object that goes straight to edit and delegates the
 * write to window.LoyaltyBridge.saveProgramConfig (the thin shim in cart.js =
 * legacy _loyaltySaveConfig's MastDB.walletConfig.update + writeAudit), so the
 * write stays single-sourced and this twin never reimplements it. There is NO
 * loyalty Cloud Function for the config; the public storefront reads
 * admin/walletConfig directly, so the config IS the single source. The roster
 * stays read-only by design — the member slide-out's "Adjust points" link opens
 * the native Wallet point-adjust modal (the adjustCustomerWallet CF), not a
 * roster write. Flag-gated (?ui=1) at #loyalty-v2, side-by-side with legacy
 * #loyalty. The classic escape hatch (navigateToClassic('loyalty')) is gone.
 *
 * Data derivation (VERIFIED against cart.js + customers.js + the Cloud Functions
 * that own the writes — and it DIFFERS from membership-v2 by necessity):
 *   • membership-v2 derives members from the `customers` collection (= admin/
 *     customers, mastdb path alias) because the functions write membership to
 *     `customers/{uid}/membership` — it sits ON the customer row.
 *   • LOYALTY does NOT sit on the customer row. The functions write points to
 *     `public/accounts/{uid}/wallet/loyalty/totalPoints` (the customer-facing
 *     account wallet); the admin customer detail reads it via MastDB.get(
 *     'public/accounts/{uid}/wallet'). So loyalty members are derived from the
 *     `public/accounts` collection: every account whose wallet carries a loyalty
 *     balance is a member. The account row also carries identity at the top level
 *     (name / displayName / email, written on sign-in — tenant-functions signin
 *     handler), so one bounded read yields BOTH points and identity (no N+1).
 * Member fields off `account.wallet.loyalty` (canonical first, legacy fallbacks —
 * mirrors customers.js renderWalletTab + customers-v2 wallet facet exactly):
 *   totalPoints ?? points ?? balance (current balance), lastEarningPurchaseAt
 *   (last activity), expiresAt, transactions{} (the earn/redeem/adjust ledger).
 * Lifetime points are DERIVED (no stored field) by summing positive ledger entries.
 * The program config (point name / redemption rate) is one cheap one-shot read of
 * admin/walletConfig used only for read-only context; it stays editable on legacy.
 */
(function () {
  'use strict';
  function flagOn() {
    try {
      if (/[?&#]ui=1\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;

  // RBAC: the loyalty surface gates on its own (legacy) route id 'loyalty' (the
  // retention section route — wallet-v2 / membership-v2 twin precedent: edit a
  // config slice → can('loyalty','edit')). The shared LoyaltyBridge (cart.js)
  // stays ungated; each twin owns its gate. The MEMBER roster is read-only, so
  // only the program-config edit + the Wallet-adjust affordance are gated here.
  function canL(axis) { return (typeof window.can === 'function') ? window.can('loyalty', axis) : true; }
  function byId(id) { return document.getElementById(id) || {}; }

  // ── member field readers (off account.wallet.loyalty) ───────────────
  function loyaltyOf(m) { return (m && m._loyalty) || {}; }
  // A member's display name is its account name, falling back to email then uid —
  // mirrors the account profile shape (name / displayName / email).
  function memberName(m) {
    return (m && (m.displayName || m.name || m.email || m._uid)) || '(unknown)';
  }
  function emailOf(m) { return (m && m.email) || ''; }
  // Current balance: canonical totalPoints, then legacy points / balance.
  function pointsOf(m) {
    var l = loyaltyOf(m);
    var p = (l.totalPoints != null) ? l.totalPoints
          : (l.points != null) ? l.points
          : (l.balance != null) ? l.balance : 0;
    var n = Number(p);
    return isNaN(n) ? 0 : n;
  }
  // Lifetime points earned — no stored field, so DERIVE it by summing the positive
  // ledger entries (earned + positive admin adjusts). Falls back to the current
  // balance when there is no ledger (e.g. a pre-ledger grant).
  function lifetimeOf(m) {
    var l = loyaltyOf(m);
    var txns = l.transactions;
    if (txns && typeof txns === 'object') {
      var sum = 0, saw = false;
      Object.keys(txns).forEach(function (k) {
        var t = txns[k]; if (!t || typeof t !== 'object') return;
        saw = true;
        var pts = Number(t.points != null ? t.points : t.delta);
        if (!isNaN(pts) && pts > 0) sum += pts;
      });
      if (saw) return sum;
    }
    return pointsOf(m);
  }
  // Loyalty has NO tier in the real data (only membership carries a tier). Accept a
  // tier if a record ever grows one; otherwise it reads as None — honest, not invented.
  function tierOf(m) {
    var l = loyaltyOf(m);
    var t = l.tier || l.tierName;
    return t ? String(t) : '';
  }
  function tierLabel(m) { return tierOf(m) || 'None'; }
  function lastActivityOf(m) {
    var l = loyaltyOf(m);
    return l.lastEarningPurchaseAt || l.lastActivityAt || l.updatedAt || null;
  }
  function expiresOf(m) { return loyaltyOf(m).expiresAt || null; }
  // Status is derived from the balance for at-a-glance scanning: a positive balance
  // is Active; zero (drained / forfeited) is Empty. Read-only, list-only colour.
  function statusOf(m) { return pointsOf(m) > 0 ? 'active' : 'empty'; }
  var STATUS_LABEL = { active: 'Active', empty: 'Empty' };
  var STATUS_TONE = { active: 'success', empty: 'neutral' };

  function pointName() { return (V2.config && V2.config.loyaltyPointName) || 'Points'; }
  // points → "1,234 Points" using the tenant's configured point name.
  function pointsStr(n) { return N.count(n || 0) + ' ' + esc(pointName()); }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  // NOTE: the entity KEY is 'loyalty-members-v2' (NOT 'loyalty-v2') because
  // wallet-v2.js already registers a 'loyalty-v2' entity for the program config —
  // MastEntity.define is fail-loud on a duplicate key. The MODULE/route is still
  // 'loyalty-v2' (the members surface).
  MastEntity.define('loyalty-members-v2', {
    label: 'Member', labelPlural: 'Members', size: 'md',
    route: 'loyalty-v2',
    recordId: function (m) { return m._uid || m.id; },
    fields: [
      // fields[0] (the slide-out title source) materialises a real name string.
      { name: 'member', label: 'Member', type: 'text', list: true, readOnly: true, group: 'Member', get: memberName },
      { name: 'email', label: 'Email', type: 'text', list: true, readOnly: true, get: emailOf },
      { name: 'points', label: 'Points', type: 'number', list: true, readOnly: true, get: pointsOf },
      { name: 'lifetime', label: 'Lifetime', type: 'number', list: true, readOnly: true, get: lifetimeOf },
      { name: 'tier', label: 'Tier', type: 'text', list: true, readOnly: true, get: tierLabel },
      { name: 'lastActivity', label: 'Last activity', type: 'date', list: true, readOnly: true, get: lastActivityOf },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'empty'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, m) {
        var pts = pointsOf(m), life = lifetimeOf(m), last = lastActivityOf(m);
        var tiles = UI.tiles([
          { k: 'Points', v: pointsStr(pts), hero: true },
          { k: 'Lifetime', v: pointsStr(life) },
          { k: 'Tier', v: esc(tierLabel(m)) },
          { k: 'Last activity', v: last ? N.date(last) : '—' }
        ]);

        // Overview facet — member identity + points + program context (read-only).
        var member = UI.kv([
          { k: 'Member', v: esc(memberName(m)) },
          { k: 'Email', v: m.email ? esc(m.email) : '—' },
          { k: 'Account ID', v: m._uid ? esc(m._uid) : '—' },
          { k: 'Points balance', v: pointsStr(pts) },
          { k: 'Lifetime points', v: pointsStr(life) },
          { k: 'Tier', v: esc(tierLabel(m)) },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(m)] || 'Unknown', STATUS_TONE[statusOf(m)] || 'neutral') },
          { k: 'Last activity', v: last ? N.date(last) : '—' },
          { k: 'Points expire', v: expiresOf(m) ? N.date(expiresOf(m)) : '—' }
        ]);

        // How points work — program config (read-only context from walletConfig).
        var cfg = V2.config || {};
        var earn = (cfg.loyaltyEarnRate != null ? cfg.loyaltyEarnRate : 1);
        var redeem = (cfg.loyaltyRedemptionRate != null ? cfg.loyaltyRedemptionRate : 50);
        var howRows = [
          { k: 'Program', v: cfg.loyaltyEnabled === false ? 'Disabled' : 'Enabled' },
          { k: 'Point name', v: esc(pointName()) },
          { k: 'Earn rate', v: esc(String(earn)) + ' ' + esc(pointName()) + ' per $1' },
          { k: 'Redemption', v: esc(String(redeem)) + ' ' + esc(pointName()) + ' = $1.00 off' }
        ];
        var redeemValue = (pts > 0 && Number(redeem) > 0) ? N.money(pts / Number(redeem)) : null;
        if (redeemValue) howRows.push({ k: 'Redeemable value', v: redeemValue });
        var how = UI.kv(howRows);

        // Points adjustments are NOT a roster write — they live on the customer
        // Wallet (the adjustCustomerWallet CF). The button opens that native
        // point-adjust modal for this member's account, gated on edit. View-only
        // roles see no button (the roster stays a pure read surface for them).
        var manage = '';
        if (canL('edit') && m._uid) {
          manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="LoyaltyV2.adjustPoints(\'' + esc(String(m._uid)) + '\')">Adjust points on Wallet &rarr;</button></div>';
        }

        var body = tiles + UI.card('Member', member) + UI.card('How points work', how + manage);

        // Optional second facet — the points ledger (earned / redeemed / adjusted).
        // Cheap: it's already on the account record (account.wallet.loyalty.transactions).
        var ledger = ledgerRows(m);
        if (ledger.length) {
          var rel = UI.relatedTable(
            [
              { label: 'When', render: function (r) { return r.when ? N.date(r.when) : '—'; } },
              { label: 'Type', render: function (r) { return r.typeHtml; } },
              { label: 'Via', render: function (r) { return r.viaHtml; } },
              { label: pointName(), align: 'right', render: function (r) { return r.pointsHtml; } }
            ],
            ledger
          );
          body += UI.card('Points history', rel);
        }

        return body;
      }
    }
    // No onSave on the MEMBER object → no Edit button (member fields are derived;
    // per-customer point adjustments go through the native Wallet modal above).
  });

  // ── program config (singleton edit object) ──────────────────────────
  // The page already IS the read view (a settings summary card), so this object
  // goes STRAIGHT TO EDIT on click — the wallet-v2 / membership-v2 config-object
  // pattern. Edits its slice of admin/walletConfig and delegates the write to
  // LoyaltyBridge.saveProgramConfig (= legacy _loyaltySaveConfig). Field set
  // mirrors the legacy _loyaltyOpenConfig modal EXACTLY (enable, point name, earn
  // rate, redemption rate, expiry window, excluded categories — nothing invented).
  // NOTE: the entity KEY is 'loyalty-config-v2' (NOT 'loyalty-v2', which wallet-v2
  // already registers for the same walletConfig slice on its own route).
  MastEntity.define('loyalty-config-v2', {
    label: 'Loyalty', labelPlural: 'Loyalty', size: 'md', route: 'loyalty-v2',
    recordId: function () { return 'config'; },
    fields: [{ name: '_cfgName', label: 'Program', type: 'text', readOnly: true }],
    fetch: function () { return Promise.resolve(V2.config); },
    detail: {
      render: function (UI, c) {
        c = c || {};
        var pn = c.loyaltyPointName || 'Points';
        var earn = (c.loyaltyEarnRate != null ? c.loyaltyEarnRate : 1);
        var redeem = (c.loyaltyRedemptionRate != null ? c.loyaltyRedemptionRate : 50);
        return UI.card('Program settings', UI.kv([
          { k: 'Status', v: c.loyaltyEnabled ? 'Enabled' : 'Disabled' },
          { k: 'Point name', v: esc(pn) },
          { k: 'Earn rate', v: esc(String(earn)) + ' ' + esc(pn) + ' per $1' },
          { k: 'Redemption', v: esc(String(redeem)) + ' ' + esc(pn) + ' = $1.00 off' },
          { k: 'Expiry', v: esc(String(c.loyaltyExpiryDays || 365)) + ' days of inactivity' },
          { k: 'Excluded categories', v: (c.loyaltyExclusions || []).length ? esc((c.loyaltyExclusions || []).join(', ')) : 'None' }
        ]));
      },
      editRender: function (c) {
        c = c || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Loyalty program settings</div>' +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="loyV2Enabled"' + (c.loyaltyEnabled ? ' checked' : '') + '> Enable loyalty program</label>' +
          fg('Point name', '<input class="form-input" type="text" id="loyV2Name" value="' + esc(c.loyaltyPointName || 'Points') + '" placeholder="Points" style="width:100%;">') +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Earn rate (points per $1)', '<input class="form-input" type="number" min="0.1" step="0.1" id="loyV2Earn" value="' + esc(c.loyaltyEarnRate || 1) + '" style="width:100%;">', true) +
            fg('Redemption rate (points per $1)', '<input class="form-input" type="number" min="1" step="1" id="loyV2Redeem" value="' + esc(c.loyaltyRedemptionRate || 50) + '" style="width:100%;">', true) +
          '</div>' +
          fg('Expiry window (days of inactivity)', '<input class="form-input" type="number" min="30" step="1" id="loyV2Expiry" value="' + esc(c.loyaltyExpiryDays || 365) + '" style="width:100%;">') +
          fg('Excluded categories (comma-separated)', '<input class="form-input" type="text" id="loyV2Exclude" value="' + esc((c.loyaltyExclusions || []).join(', ')) + '" placeholder="Gift Cards, Classes" style="width:100%;">');
      }
    },
    onSave: function () {
      if (!canL('edit')) { if (window.showToast) showToast('Loyalty write access required.', true); return false; }
      if (!window.LoyaltyBridge) { if (window.showToast) showToast('Loyalty engine still loading — try again', true); return false; }
      // Collect the form, hand the raw values to the bridge (it owns the exact
      // build + validation + write + audit, identical to legacy _loyaltySaveConfig).
      var data = {
        enabled: !!byId('loyV2Enabled').checked,
        pointName: byId('loyV2Name').value,
        earnRate: byId('loyV2Earn').value,
        redeemRate: byId('loyV2Redeem').value,
        expiryDays: byId('loyV2Expiry').value,
        exclusions: byId('loyV2Exclude').value
      };
      return Promise.resolve(window.LoyaltyBridge.saveProgramConfig(data)).then(function (saved) {
        if (!saved) return false;   // bridge already toasted the validation failure
        // Mutate the live config ref (=== the page's + member slide-out's read
        // source) so the post-save re-render shows the new settings.
        V2.config = Object.assign(V2.config || {}, saved, { _cfgName: 'Program settings' });
        render(); return true;
      }).catch(function (e) { console.error('[loyalty-v2] saveProgramConfig', e); if (window.showToast) showToast('Error saving settings.', true); return false; });
    }
  });

  // Flatten the loyalty.transactions ledger to newest-first display rows.
  function ledgerRows(m) {
    var txns = loyaltyOf(m).transactions;
    if (!txns || typeof txns !== 'object') return [];
    var rows = [];
    Object.keys(txns).forEach(function (k) {
      var t = txns[k]; if (!t || typeof t !== 'object') return;
      var pts = Number(t.points != null ? t.points : t.delta);
      if (isNaN(pts)) pts = 0;
      var when = t.createdAt || t.at || null;
      var type = t.type || (t.source === 'admin-adjust' ? 'adjusted' : (pts < 0 ? 'redeemed' : 'earned'));
      // Origin label: storefront earns from an external channel stamp
      // source '<platform>-order:<id>' (e.g. 'shopify-order:123'); native orders
      // carry an orderId; admin tweaks carry source 'admin-adjust'.
      var src = String(t.source || '');
      var om = src.match(/^([a-z]+)-order:/);
      var via = om ? (om[1].charAt(0).toUpperCase() + om[1].slice(1) + ' order')
        : src === 'admin-adjust' ? 'Manual'
          : t.orderId ? 'Order' : '';
      rows.push({ _t: when, when: when, type: type, points: pts, via: via });
    });
    rows.sort(function (a, b) { return String(b._t || '').localeCompare(String(a._t || '')); });
    return rows.slice(0, 25).map(function (r) {
      var tone = r.points < 0 ? 'amber' : 'success';
      var sign = r.points > 0 ? '+' : '';
      return {
        when: r.when,
        typeHtml: U.badge(String(r.type), tone),
        viaHtml: r.via ? esc(r.via) : '—',
        pointsHtml: '<span style="font-variant-numeric:tabular-nums;">' + sign + N.count(r.points) + '</span>'
      };
    });
  }

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, config: null, sortKey: 'points', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Ensure the legacy cart module is loaded so window.LoyaltyBridge (the
    // delegated config write path) exists — mirrors membership-v2 / wholesale-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('cart'); } catch (e) {} }
    // Members are derived from `public/accounts` (every account whose wallet
    // carries a loyalty balance); the program config is a separate cheap one-shot
    // read used for read context + the editor source. Both loaded together; bounded.
    Promise.all([
      Promise.resolve(MastDB.query('public/accounts').limitToLast(500).once()).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/walletConfig')).catch(function () { return null; })
    ]).then(function (res) {
      // .once() resolves to the raw keyed object (with a non-enumerable .val());
      // accept either shape defensively (matches the membership-v2 / wholesale-v2 readers).
      var snap = res[0];
      var acctData = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      acctData = acctData || {};
      V2.config = Object.assign({ _cfgName: 'Program settings' }, res[1] || {});
      var out = [];
      Object.keys(acctData).forEach(function (uid) {
        var a = acctData[uid];
        if (!a || typeof a !== 'object') return;
        var wallet = (a.wallet && typeof a.wallet === 'object') ? a.wallet : null;
        var loy = (wallet && wallet.loyalty && typeof wallet.loyalty === 'object') ? wallet.loyalty : null;
        if (!loy) return;
        // Only surface accounts that actually have a points history with the
        // program — a current OR historical balance (lifetime > 0). An account that
        // merely has an empty {loyalty:{}} node from a one-off write is not a member.
        var m = {
          _uid: uid,
          _loyalty: loy,
          name: a.name || '',
          displayName: a.displayName || '',
          email: a.email || (loy && loy.email) || ''
        };
        if (pointsOf(m) > 0 || lifetimeOf(m) > 0) out.push(m);
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._uid] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[loyalty-v2] load', e); V2.loaded = true; render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (m) { return statusOf(m) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (m) {
        return memberName(m).toLowerCase().indexOf(q) >= 0 ||
               emailOf(m).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('loyalty-members-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('loyaltyV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'loyaltyV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  // The program-settings summary card (the page is the read view; clicking it
  // goes straight to edit — the membership-v2 / wallet-v2 config-object pattern).
  function settingsCard() {
    var c = V2.config || {};
    var pn = c.loyaltyPointName || 'Points';
    var earn = (c.loyaltyEarnRate != null ? c.loyaltyEarnRate : 1);
    var redeem = (c.loyaltyRedemptionRate != null ? c.loyaltyRedemptionRate : 50);
    var rows = [
      { k: 'Point name', v: esc(pn) },
      { k: 'Earn', v: esc(String(earn)) + ' ' + esc(pn) + ' / $1' },
      { k: 'Redeem', v: esc(String(redeem)) + ' ' + esc(pn) + ' = $1' }
    ];
    var body = rows.map(function (r) {
      return '<div class="mu-sub" style="display:flex;justify-content:space-between;gap:12px;"><span>' + esc(r.k) + '</span><span style="color:var(--text-primary);text-align:right;">' + r.v + '</span></div>';
    }).join('');
    var enabledBadge = U.badge(c.loyaltyEnabled ? 'Enabled' : 'Disabled', c.loyaltyEnabled ? 'success' : 'neutral');
    // Editing the program config is a write — gate the click-to-edit on edit
    // (membership-v2 twin precedent). View-only roles see a plain read card.
    if (!canL('edit')) {
      return U.card('Program settings', body, { headerRight: enabledBadge });
    }
    return U.launchCard({
      title: 'Program settings',
      body: body,
      onClickFnName: 'LoyaltyV2.settings', arrow: 'Edit →',
      headerRight: enabledBadge
    });
  }

  function render() {
    var tab = ensureTab();
    var counts = { active: 0, empty: 0 };
    V2.rows.forEach(function (m) { var s = statusOf(m); if (counts[s] != null) counts[s]++; });
    var filters = [['all', 'All', V2.rows.length], ['active', 'Active', counts.active], ['empty', 'Empty', counts.empty]]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="LoyaltyV2.filter(\'' + f[0] + '\')">' + esc(f[1]) + ' (' + N.count(f[2]) + ')</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Loyalty members',
        count: N.count(V2.rows.length) + ' ' + MastFormat.plural(V2.rows.length, 'member'),
        actionsHtml: '<button class="btn btn-secondary" onclick="LoyaltyV2.exportCsv()">&darr; Export</button>'
      }) +
      '<div style="margin:12px 0;">' + settingsCard() + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search member or email&hellip;" value="' + esc(V2.q) +
        '" oninput="LoyaltyV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('loyalty-members-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'LoyaltyV2.sort', onRowClickFnName: 'LoyaltyV2.open',
        empty: { title: 'No loyalty members', message: V2.loaded ? 'Customers appear here once they earn points. Tune the program in Program settings above.' : 'Loading…' }
      });
  }

  window.LoyaltyV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'points' || key === 'lifetime' || key === 'lastActivity' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('loyalty-members-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('loyalty-members-v2', rec, 'read');
      });
    },
    // Program config object → straight to edit (the page already IS the read
    // view). Re-reads via LoyaltyBridge so the form opens on the freshest config.
    settings: function () {
      if (!canL('edit')) { if (window.showToast) showToast('Loyalty write access required.', true); return; }
      // Loyalty program config relocated to My Website › Wallet & loyalty (PR4).
      // This page stays for operational management (members, points, history).
      if (typeof navigateTo === 'function') navigateTo('website-v2');
      if (window.showToast) showToast('Configure loyalty in My Website → Wallet & loyalty');
    },
    // Per-customer point adjustment is NOT a roster write — it lives on the
    // customer Wallet (the adjustCustomerWallet CF). Open that native modal for
    // this member's account uid (which is the wallet uid). The CF uses walletUid;
    // customerId is only post-save cache invalidation, so the uid serves both.
    adjustPoints: function (uid) {
      if (!canL('edit')) { if (window.showToast) showToast('Loyalty write access required.', true); return; }
      uid = (uid || '').trim();
      if (!uid) { if (window.showToast) showToast('No linked account for this member.', true); return; }
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        Promise.resolve(MastAdmin.loadModule('customers-core')).then(function () {
          if (window.customersOpenWalletAdjust) customersOpenWalletAdjust('loyalty', uid, uid);
          else if (window.showToast) showToast('Wallet tools still loading — try again', true);
        });
      }
    },
    exportCsv: function () { return MastEntity.exportRows('loyalty-members-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('loyalty-v2', {
    routes: { 'loyalty-v2': { tab: 'loyaltyV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
