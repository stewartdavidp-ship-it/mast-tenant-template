/**
 * wallet-v2.js — config-singleton twin for Wallet & instruments settings
 * (doc 17 §13/§14c). Like terms-v2, proves a config singleton is just an OBJECT
 * reached by a *launcher* producer instead of a list, presented/edited in the
 * SAME slide-out as every other object. No bespoke "config-page chrome".
 *
 * Legacy: the gift-card + loyalty SETTINGS live as two scattered modals on the
 * 'gift-cards' and 'loyalty' list routes in cart.js, both writing the single
 * 'admin/walletConfig' object. This twin collapses them into ONE config object
 * with facet tabs (Gift cards / Loyalty / Store credit). Flag-gated (?ui=1) at
 * #wallet-v2, side-by-side with the legacy #wallet hub; never touches cart.js.
 *
 * Save persists the config (MastDB.walletConfig.update — a shallow merge so
 * untouched fields survive). Both legacy saves are side-effect-free
 * (MastDB.walletConfig.update + writeAudit — no Cloud Function, no public
 * mirror; the public cart reads admin/walletConfig directly, so the config IS
 * the single source). Gift-card / loyalty LISTS + issue/grant ACTIONS, and the
 * per-customer wallet adjustments, stay on legacy ("manage in classic view").
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

  function money(cents) { return '$' + (Math.round(Math.abs(cents || 0)) / 100).toFixed(2); }
  function byId(id) { return document.getElementById(id) || {}; }
  // denominations <-> dollar-string helpers (stored as a cents array)
  function denomsToStr(arr) { return (arr || []).map(function (c) { return (c / 100).toFixed(2).replace(/\.00$/, ''); }).join(', '); }
  function strToDenoms(s) {
    return (s || '').split(',').map(function (x) { return Math.round(parseFloat(x.trim()) * 100); })
      .filter(function (n) { return n > 0 && !isNaN(n); });
  }

  // ── schema (config singleton presented as an object) ────────────────
  MastEntity.define('wallet-v2', {
    label: 'Wallet', labelPlural: 'Wallet & instruments', size: 'lg',
    route: 'wallet-v2',
    recordId: function () { return 'config'; },   // singleton
    fields: [
      { name: '_name', label: 'Settings', type: 'text', readOnly: true },
      { name: '_updated', label: 'Last updated', type: 'date', readOnly: true, get: function (c) { return c.updatedAt || null; } }
    ],
    fetch: function () {
      return Promise.resolve(MastDB.walletConfig.get()).then(function (c) {
        V2.cfg = Object.assign({ _key: 'config', _name: 'Wallet & instruments' }, c || {});
        return V2.cfg;
      });
    },
    detail: {
      render: function (UI, c) {
        var gcOn = !!c.giftCardsEnabled;
        var loyOn = !!c.loyaltyEnabled;
        var creditsOn = c.creditsEnabled !== false;
        var pointName = c.loyaltyPointName || 'Points';

        // ── Gift cards facet
        var denoms = c.giftCardDenominations || [];
        var gcKv = UI.kv([
          { k: 'Status', v: gcOn ? 'Enabled' : 'Disabled' },
          { k: 'Denominations', v: denoms.length ? esc(denoms.map(money).join(', ')) : 'None configured' },
          { k: 'Custom amount', v: c.giftCardCustomEnabled ? (money(c.giftCardCustomMin || 500) + ' – ' + money(c.giftCardCustomMax || 50000)) : 'Off' }
        ]);
        var gcManage = '<div style="margin-top:10px;"><button class="btn btn-secondary" onclick="WalletV2.classic(\'gift-cards\')">Manage issued gift cards (classic view) →</button></div>';

        // ── Loyalty facet
        var loyKv = UI.kv([
          { k: 'Status', v: loyOn ? 'Enabled' : 'Disabled' },
          { k: 'Point name', v: esc(pointName) },
          { k: 'Earn rate', v: esc(String(c.loyaltyEarnRate || 1)) + ' ' + esc(pointName) + ' per $1' },
          { k: 'Redemption', v: esc(String(c.loyaltyRedemptionRate || 50)) + ' ' + esc(pointName) + ' = $1.00 off' },
          { k: 'Expiry', v: esc(String(c.loyaltyExpiryDays || 365)) + ' days of inactivity' },
          { k: 'Excluded categories', v: (c.loyaltyExclusions || []).length ? esc((c.loyaltyExclusions || []).join(', ')) : 'None' }
        ]);
        var loyManage = '<div style="margin-top:10px;"><button class="btn btn-secondary" onclick="WalletV2.classic(\'loyalty\')">Open loyalty program (classic view) →</button></div>';

        // ── Store credit facet (read-only — legacy has no config editor; grants
        // are per-customer on the customer Wallet tab)
        var creditBody = UI.kv([{ k: 'Status', v: creditsOn ? 'Enabled' : 'Disabled' }]) +
          '<div style="font-size:0.9rem;color:var(--charcoal,var(--text));line-height:1.5;margin-top:10px;">Store credit comes from returns, admin grants, and promotions, and never expires. ' +
          'Per-customer adjustments happen on the customer detail Wallet tab and write an audit row.</div>' +
          '<div style="margin-top:10px;"><button class="btn btn-secondary" onclick="WalletV2.classic(\'wallet\')">Open wallet dashboard (classic view) →</button></div>';

        var tiles = UI.tiles([
          { k: 'Gift cards', v: gcOn ? 'On' : 'Off', hero: true },
          { k: 'Loyalty', v: loyOn ? 'On' : 'Off' },
          { k: 'Store credit', v: creditsOn ? 'On' : 'Off' }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'giftcards', label: 'Gift cards' },
          { key: 'loyalty', label: 'Loyalty' },
          { key: 'credit', label: 'Store credit' }
        ], 'giftcards');
        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="giftcards">' + UI.card('Gift cards', gcKv + gcManage) + '</div>' +
          '<div class="mu-pane" data-pane="loyalty" hidden>' + UI.card('Loyalty program', loyKv + loyManage) + '</div>' +
          '<div class="mu-pane" data-pane="credit" hidden>' + UI.card('Store credit', creditBody) + '</div>';
      },
      editRender: function (c) {
        c = c || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function num(id, val, min, max, step) { return '<input class="form-input" type="number"' + (min != null ? ' min="' + min + '"' : '') + (max != null ? ' max="' + max + '"' : '') + (step != null ? ' step="' + step + '"' : '') + ' id="' + id + '" value="' + esc(val) + '" style="width:100%;">'; }
        function txt(id, val, ph) { return '<input class="form-input" type="text" id="' + id + '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '" style="width:100%;">'; }
        function chk(id, on, label, onchange) { return '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + (onchange ? ' onchange="' + onchange + '"' : '') + '> ' + label + '</label>'; }

        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Wallet &amp; instruments settings</div>' +
          // Gift cards
          '<div class="form-section-label" style="font-weight:600;font-size:0.9rem;margin:4px 0 8px;">Gift cards</div>' +
          chk('wcGcEnabled', !!c.giftCardsEnabled, 'Enable gift cards on storefront') +
          fg('Denominations (dollar amounts, comma-separated)', txt('wcGcDenoms', denomsToStr(c.giftCardDenominations), '25, 50, 75, 100')) +
          chk('wcGcCustom', !!c.giftCardCustomEnabled, 'Allow custom amount') +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Custom min ($)', num('wcGcMin', ((c.giftCardCustomMin || 500) / 100).toFixed(2), 1, null, 0.01), true) +
            fg('Custom max ($)', num('wcGcMax', ((c.giftCardCustomMax || 50000) / 100).toFixed(2), 1, null, 0.01), true) +
          '</div>' +
          // Loyalty
          '<div class="form-section-label" style="font-weight:600;font-size:0.9rem;margin:14px 0 8px;">Loyalty program</div>' +
          chk('wcLoyEnabled', !!c.loyaltyEnabled, 'Enable loyalty program') +
          fg('Point name', txt('wcLoyName', c.loyaltyPointName || 'Points', 'Points')) +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Earn rate (points per $1)', num('wcLoyEarn', c.loyaltyEarnRate || 1, 0.1, null, 0.1), true) +
            fg('Redemption rate (points per $1)', num('wcLoyRedeem', c.loyaltyRedemptionRate || 50, 1, null, 1), true) +
          '</div>' +
          fg('Expiry window (days of inactivity)', num('wcLoyExpiry', c.loyaltyExpiryDays || 365, 30, null, 1)) +
          fg('Excluded categories (comma-separated)', txt('wcLoyExclude', (c.loyaltyExclusions || []).join(', '), 'Gift Cards, Classes')) +
          '<div class="mu-sub" style="margin-top:8px;">Store credit has no settings to edit here — grants are per-customer on the customer Wallet tab.</div>';
      }
    },
    onSave: function () {
      var cur = V2.cfg || {};
      var gcEnabled = !!byId('wcGcEnabled').checked;
      var gcCustom = !!byId('wcGcCustom').checked;
      var denoms = strToDenoms(byId('wcGcDenoms').value);
      if (gcEnabled && !denoms.length && !gcCustom) { showToast('Add at least one denomination or enable custom amounts', true); return false; }
      var gcMin = Math.round((parseFloat(byId('wcGcMin').value) || 5) * 100);
      var gcMax = Math.round((parseFloat(byId('wcGcMax').value) || 500) * 100);

      var loyRedeem = parseInt(byId('wcLoyRedeem').value, 10) || 50;
      if (loyRedeem < 1) { showToast('Redemption rate must be at least 1 point per $1', true); return false; }
      var loyExpiry = parseInt(byId('wcLoyExpiry').value, 10) || 365;
      var loyExclude = (byId('wcLoyExclude').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

      var data = {
        giftCardsEnabled: gcEnabled,
        giftCardDenominations: denoms,
        giftCardCustomEnabled: gcCustom,
        giftCardCustomMin: gcMin,
        giftCardCustomMax: gcMax,
        loyaltyEnabled: !!byId('wcLoyEnabled').checked,
        loyaltyPointName: (byId('wcLoyName').value || '').trim() || 'Points',
        loyaltyEarnRate: parseFloat(byId('wcLoyEarn').value) || 1,
        loyaltyRedemptionRate: loyRedeem,
        loyaltyExpiryDays: loyExpiry,
        loyaltyExclusions: loyExclude,
        updatedAt: new Date().toISOString()
      };
      // walletConfig.update is a shallow merge → untouched fields (creditsEnabled,
      // membership cross-refs, etc.) survive. Mirrors legacy _gcSaveConfig /
      // _loyaltySaveConfig exactly (side-effect-free: update + audit, no CF).
      return Promise.resolve(MastDB.walletConfig.update(data)).then(function () {
        if (window.writeAudit) writeAudit('update', 'wallet-config', 'config');
        Object.assign(V2.cfg, data);   // live ref → fresh post-save read (PR-123 lesson)
        showToast('Wallet settings saved'); render(); return true;
      }).catch(function (e) { console.error('[wallet-v2] save', e); showToast('Save failed', true); return false; });
    }
  });

  // ── module state + launcher (the producer for a singleton) ──────────
  var V2 = { cfg: null, loaded: false };

  function ensureTab() {
    var el = document.getElementById('walletV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'walletV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var c = V2.cfg || {};
    var on = [];
    if (!V2.loaded) { on = null; }
    else {
      if (c.giftCardsEnabled) on.push('Gift cards');
      if (c.loyaltyEnabled) on.push('Loyalty');
      if (c.creditsEnabled !== false) on.push('Store credit');
    }
    var sub = !V2.loaded ? 'Loading…' : (on && on.length ? (on.join(' · ') + ' active') : 'No instruments enabled');
    // Launcher: a single config card whose click opens the object in the slide-out.
    var launcher =
      '<button type="button" onclick="WalletV2.open()" style="all:unset;display:block;cursor:pointer;width:100%;max-width:520px;box-sizing:border-box;">' +
        '<div class="mu-card" style="margin:0;">' +
          '<h3>Wallet &amp; instruments</h3>' +
          '<div class="mu-cc">' +
            '<div style="font-size:0.9rem;color:var(--charcoal,var(--text));">Gift-card, loyalty &amp; store-credit settings.</div>' +
            '<div class="mu-sub" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;">' +
              '<span>' + esc(sub) + '</span><span style="color:var(--teal);font-weight:600;">Open →</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</button>';
    tab.innerHTML = U.pageHeader({ title: 'Wallet & instruments', subtitle: 'Gift cards, loyalty & store credit' }) +
      '<div style="margin-top:14px;">' + launcher + '</div>';
  }

  window.WalletV2 = {
    open: function () { MastEntity.get('wallet-v2').fetch().then(function (cfg) { if (cfg) MastEntity.openRecord('wallet-v2', cfg, 'read'); }); },
    classic: function (route) { if (typeof navigateTo === 'function') navigateTo(route || 'wallet'); },
    refresh: function () { render(); }
  };

  function load() {
    Promise.resolve(MastDB.walletConfig.get()).then(function (c) {
      V2.cfg = Object.assign({ _key: 'config', _name: 'Wallet & instruments' }, c || {});
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[wallet-v2] load', e); V2.loaded = true; render(); });
  }

  MastAdmin.registerModule('wallet-v2', {
    routes: { 'wallet-v2': { tab: 'walletV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
