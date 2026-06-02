/**
 * wallet-v2.js — Wallet & instruments, the read-on-page / edit-in-slide-out model.
 *
 * Global model (operator, 2026-06-01): NAV takes you to a READ-ONLY view (a list,
 * a calendar, or — for config — a set of read-only fields). Clicking an item takes
 * you to detail mode (read slide-out) for most objects, or STRAIGHT TO EDIT for
 * config objects like wallet, because the page already IS the read view. So here:
 *   • the Wallet PAGE is the read-only view  — a grid of instrument cards showing
 *     each instrument's *live* settings at a glance (no bare "Open" launcher);
 *   • the SLIDE-OUT is automatically the EDITOR — clicking an editable instrument
 *     opens its own focused slide-out directly in edit mode.
 *
 * Each instrument is its OWN object (doc 17 §13: distinct objects → distinct
 * producers/presenters, not facet tabs of one blob). Gift Cards + Loyalty are
 * editable objects (each edits its slice of the single admin/walletConfig record
 * and merge-saves). Store Credit has no settings (grants are per-customer on the
 * customer Wallet tab) and Membership is a separate object — both render as
 * read-only cards with a "manage in classic view" link for this pass.
 *
 * Flag-gated (?ui=1) at #wallet-v2, side-by-side with legacy #wallet; cart.js
 * untouched. Both legacy saves are side-effect-free (walletConfig.update +
 * writeAudit — no Cloud Function, no public mirror; the public cart reads
 * admin/walletConfig directly, so the config IS the single source).
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

  function money(cents) { return '$' + (Math.round(Math.abs(cents || 0)) / 100).toFixed(2).replace(/\.00$/, ''); }
  function byId(id) { return document.getElementById(id) || {}; }
  function denomsToStr(arr) { return (arr || []).map(function (c) { return (c / 100).toFixed(2).replace(/\.00$/, ''); }).join(', '); }
  function strToDenoms(s) {
    return (s || '').split(',').map(function (x) { return Math.round(parseFloat(x.trim()) * 100); })
      .filter(function (n) { return n > 0 && !isNaN(n); });
  }
  function onPill(on) { return U.badge(on ? 'On' : 'Off', on ? 'success' : 'neutral'); }

  // ── module state ────────────────────────────────────────────────────
  var V2 = { cfg: null, membership: null, loaded: false };

  function stamp(cfg) {
    // Materialise per-instrument title fields once (slide-out title is read
    // directly from record[fields[0].name]); kept on the shared live ref so an
    // onSave mutation reaches the post-save read re-render (PR-123 lesson).
    cfg._gcName = 'Gift Cards';
    cfg._loyName = 'Loyalty program';
    return cfg;
  }

  // ── editable instrument objects (each edits its slice of walletConfig) ──
  MastEntity.define('gift-cards-v2', {
    label: 'Wallet', labelPlural: 'Wallet', size: 'md', route: 'wallet-v2',
    recordId: function () { return 'config'; },
    fields: [{ name: '_gcName', label: 'Instrument', type: 'text', readOnly: true }],
    fetch: function () { return Promise.resolve(V2.cfg); },
    detail: {
      render: function (UI, c) {
        return UI.card('Gift cards', UI.kv([
          { k: 'Status', v: c.giftCardsEnabled ? 'Enabled' : 'Disabled' },
          { k: 'Denominations', v: (c.giftCardDenominations || []).length ? esc((c.giftCardDenominations || []).map(money).join(', ')) : 'None configured' },
          { k: 'Custom amount', v: c.giftCardCustomEnabled ? (money(c.giftCardCustomMin || 500) + ' – ' + money(c.giftCardCustomMax || 50000)) : 'Off' }
        ]) + '<div style="margin-top:10px;"><button class="btn btn-secondary" onclick="WalletV2.classic(\'gift-cards\')">Manage issued gift cards (classic view) →</button></div>');
      },
      editRender: function (c) {
        c = c || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Gift card settings</div>' +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="wcGcEnabled"' + (c.giftCardsEnabled ? ' checked' : '') + '> Enable gift cards on storefront</label>' +
          fg('Denominations (dollar amounts, comma-separated)', '<input class="form-input" type="text" id="wcGcDenoms" value="' + esc(denomsToStr(c.giftCardDenominations)) + '" placeholder="25, 50, 75, 100" style="width:100%;">') +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="wcGcCustom"' + (c.giftCardCustomEnabled ? ' checked' : '') + '> Allow custom amount</label>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Custom min ($)', '<input class="form-input" type="number" min="1" step="0.01" id="wcGcMin" value="' + ((c.giftCardCustomMin || 500) / 100).toFixed(2) + '" style="width:100%;">', true) +
            fg('Custom max ($)', '<input class="form-input" type="number" min="1" step="0.01" id="wcGcMax" value="' + ((c.giftCardCustomMax || 50000) / 100).toFixed(2) + '" style="width:100%;">', true) +
          '</div>';
      }
    },
    onSave: function () {
      var enabled = !!byId('wcGcEnabled').checked, custom = !!byId('wcGcCustom').checked;
      var denoms = strToDenoms(byId('wcGcDenoms').value);
      if (enabled && !denoms.length && !custom) { showToast('Add at least one denomination or enable custom amounts', true); return false; }
      var data = {
        giftCardsEnabled: enabled, giftCardDenominations: denoms, giftCardCustomEnabled: custom,
        giftCardCustomMin: Math.round((parseFloat(byId('wcGcMin').value) || 5) * 100),
        giftCardCustomMax: Math.round((parseFloat(byId('wcGcMax').value) || 500) * 100),
        updatedAt: new Date().toISOString()
      };
      return persist(data, 'giftCards');
    }
  });

  MastEntity.define('loyalty-v2', {
    label: 'Wallet', labelPlural: 'Wallet', size: 'md', route: 'wallet-v2',
    recordId: function () { return 'config'; },
    fields: [{ name: '_loyName', label: 'Instrument', type: 'text', readOnly: true }],
    fetch: function () { return Promise.resolve(V2.cfg); },
    detail: {
      render: function (UI, c) {
        var pn = c.loyaltyPointName || 'Points';
        return UI.card('Loyalty program', UI.kv([
          { k: 'Status', v: c.loyaltyEnabled ? 'Enabled' : 'Disabled' },
          { k: 'Point name', v: esc(pn) },
          { k: 'Earn rate', v: esc(String(c.loyaltyEarnRate || 1)) + ' ' + esc(pn) + ' per $1' },
          { k: 'Redemption', v: esc(String(c.loyaltyRedemptionRate || 50)) + ' ' + esc(pn) + ' = $1.00 off' },
          { k: 'Expiry', v: esc(String(c.loyaltyExpiryDays || 365)) + ' days of inactivity' },
          { k: 'Excluded categories', v: (c.loyaltyExclusions || []).length ? esc((c.loyaltyExclusions || []).join(', ')) : 'None' }
        ]) + '<div style="margin-top:10px;"><button class="btn btn-secondary" onclick="WalletV2.classic(\'loyalty\')">Open loyalty program (classic view) →</button></div>');
      },
      editRender: function (c) {
        c = c || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Loyalty program settings</div>' +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="wcLoyEnabled"' + (c.loyaltyEnabled ? ' checked' : '') + '> Enable loyalty program</label>' +
          fg('Point name', '<input class="form-input" type="text" id="wcLoyName" value="' + esc(c.loyaltyPointName || 'Points') + '" placeholder="Points" style="width:100%;">') +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Earn rate (points per $1)', '<input class="form-input" type="number" min="0.1" step="0.1" id="wcLoyEarn" value="' + esc(c.loyaltyEarnRate || 1) + '" style="width:100%;">', true) +
            fg('Redemption rate (points per $1)', '<input class="form-input" type="number" min="1" step="1" id="wcLoyRedeem" value="' + esc(c.loyaltyRedemptionRate || 50) + '" style="width:100%;">', true) +
          '</div>' +
          fg('Expiry window (days of inactivity)', '<input class="form-input" type="number" min="30" step="1" id="wcLoyExpiry" value="' + esc(c.loyaltyExpiryDays || 365) + '" style="width:100%;">') +
          fg('Excluded categories (comma-separated)', '<input class="form-input" type="text" id="wcLoyExclude" value="' + esc((c.loyaltyExclusions || []).join(', ')) + '" placeholder="Gift Cards, Classes" style="width:100%;">');
      }
    },
    onSave: function () {
      var redeem = parseInt(byId('wcLoyRedeem').value, 10) || 50;
      if (redeem < 1) { showToast('Redemption rate must be at least 1 point per $1', true); return false; }
      var data = {
        loyaltyEnabled: !!byId('wcLoyEnabled').checked,
        loyaltyPointName: (byId('wcLoyName').value || '').trim() || 'Points',
        loyaltyEarnRate: parseFloat(byId('wcLoyEarn').value) || 1,
        loyaltyRedemptionRate: redeem,
        loyaltyExpiryDays: parseInt(byId('wcLoyExpiry').value, 10) || 365,
        loyaltyExclusions: (byId('wcLoyExclude').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        updatedAt: new Date().toISOString()
      };
      return persist(data, 'loyalty');
    }
  });

  // walletConfig.update is a shallow merge → untouched fields survive. Mirrors
  // legacy _gcSaveConfig / _loyaltySaveConfig exactly (side-effect-free).
  function persist(data, scope) {
    return Promise.resolve(MastDB.walletConfig.update(data)).then(function () {
      if (window.writeAudit) writeAudit('update', 'wallet-config', scope);
      Object.assign(V2.cfg, data);   // live ref → fresh post-save read + page refresh
      render(); return true;
    }).catch(function (e) { console.error('[wallet-v2] save', e); showToast('Save failed', true); return false; });
  }

  // ── the read-only PAGE (a grid of instrument cards) ─────────────────
  function ensureTab() {
    var el = document.getElementById('walletV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'walletV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  // An editable instrument card: read-only live settings + the whole card is the
  // click target into edit (operator: config objects go straight to edit).
  function editCard(key, title, statusOn, rows) {
    var summary = rows.map(function (r) {
      return '<div class="mu-sub" style="display:flex;justify-content:space-between;gap:12px;"><span>' + esc(r.k) + '</span><span style="color:var(--charcoal,var(--text));text-align:right;">' + (r.v == null || r.v === '' ? '—' : r.v) + '</span></div>';
    }).join('');
    return U.launchCard({ title: title, body: summary, onClickFnName: 'WalletV2.edit', arg: key, arrow: 'Edit →', headerRight: onPill(statusOn) });
  }

  // A read-only card with no editable settings here (link out to classic).
  function infoCard(title, statusOn, desc, classicRoute, classicLabel) {
    var body = '<div style="font-size:0.9rem;color:var(--charcoal,var(--text));line-height:1.5;">' + esc(desc) + '</div>' +
      '<div class="mu-sub" style="margin-top:10px;"><button class="btn btn-secondary" onclick="WalletV2.classic(\'' + classicRoute + '\')">' + esc(classicLabel) + ' →</button></div>';
    return U.card(title, body, { fill: true, headerRight: onPill(statusOn) });
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) { tab.innerHTML = U.pageHeader({ title: 'Wallet & instruments', subtitle: 'Gift cards, loyalty & store credit' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>'; return; }
    var c = V2.cfg || {};
    var gc = editCard('giftcards', 'Gift Cards', !!c.giftCardsEnabled, [
      { k: 'Denominations', v: (c.giftCardDenominations || []).length ? esc((c.giftCardDenominations || []).map(money).join(', ')) : 'None' },
      { k: 'Custom amount', v: c.giftCardCustomEnabled ? (money(c.giftCardCustomMin || 500) + '–' + money(c.giftCardCustomMax || 50000)) : 'Off' }
    ]);
    var pn = c.loyaltyPointName || 'Points';
    var loy = editCard('loyalty', 'Loyalty program', !!c.loyaltyEnabled, [
      { k: 'Earn', v: esc(String(c.loyaltyEarnRate || 1)) + ' ' + esc(pn) + ' / $1' },
      { k: 'Redeem', v: esc(String(c.loyaltyRedemptionRate || 50)) + ' = $1' },
      { k: 'Expiry', v: esc(String(c.loyaltyExpiryDays || 365)) + ' days' }
    ]);
    var credit = infoCard('Store Credit', c.creditsEnabled !== false,
      'From returns, admin grants & promotions. Never expires. Per-customer adjustments happen on the customer Wallet tab.',
      'wallet', 'Open wallet dashboard');
    var member = infoCard('Membership', !!(V2.membership && V2.membership.enabled),
      'Subscription program with exclusive benefits. Managed as its own program.',
      'membership', 'Open membership');

    tab.innerHTML = U.pageHeader({ title: 'Wallet & instruments', subtitle: 'Gift cards, loyalty & store credit' }) + U.cardGrid([gc, loy, credit, member]);
  }

  window.WalletV2 = {
    // Config object → straight to edit (the page is already the read view).
    edit: function (which) {
      var key = which === 'loyalty' ? 'loyalty-v2' : 'gift-cards-v2';
      Promise.resolve(MastDB.walletConfig.get()).then(function (c) {
        V2.cfg = stamp(Object.assign(V2.cfg || {}, c || {}));
        MastEntity.openRecord(key, V2.cfg, 'edit');
      });
    },
    classic: function (route) { if (typeof navigateTo === 'function') navigateTo(route || 'wallet'); },
    refresh: function () { render(); }
  };

  function load() {
    Promise.all([
      Promise.resolve(MastDB.walletConfig.get()),
      Promise.resolve(MastDB.get('admin/membership/config')).catch(function () { return null; })
    ]).then(function (r) {
      V2.cfg = stamp(Object.assign({ _key: 'config' }, r[0] || {}));
      V2.membership = r[1] || null;
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[wallet-v2] load', e); V2.loaded = true; render(); });
  }

  MastAdmin.registerModule('wallet-v2', {
    routes: { 'wallet-v2': { tab: 'walletV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
