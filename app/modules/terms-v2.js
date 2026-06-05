/**
 * terms-v2.js — Policies, the read-on-page / edit-in-slide-out model.
 *
 * Global model (operator, 2026-06-01): NAV takes you to a READ-ONLY view; clicking
 * an item takes you STRAIGHT TO EDIT for a config object (the page already IS the
 * read view). So here:
 *   • the Policies PAGE is the read-only view — cards showing the current policy
 *     settings at a glance (no bare "Open" launcher);
 *   • the SLIDE-OUT is automatically the EDITOR — clicking an editable area opens
 *     its own focused editor directly in edit mode.
 *
 * Terms & Conditions is ONE document (one admin/termsConfig record), so unlike the
 * wallet instruments these areas are slices of one object, not separate objects.
 * Two editable slices keep each editor small (no wall): Return & exchange policy
 * and Store terms (gift-card / loyalty / additional copy). Each merge-saves its
 * slice (termsConfig.update — shallow merge, so untouched fields incl. categoryRules
 * survive). PUBLISH is now NATIVE: a Publish action delegates to window.TermsBridge
 * .publish(cfg) (exposed in sales.js) — the twin never reimplements the storefront
 * write (public/content/terms). The bridge lives in sales.js, so the route setup
 * loadModule('sales') (mirrors materials-v2 / ContactsBridge) and the publish call
 * guards on window.TermsBridge. Flag-gated (?ui=1) at #terms-v2, side-by-side with
 * the legacy #terms (sidebar "Policies"). categoryRules editing remains legacy-only
 * (navigateToClassic kept solely for that slice).
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
  var SHIPPING = [
    { value: 'customer_pays', label: 'Customer pays return shipping' },
    { value: 'store_pays', label: 'Store pays return shipping' },
    { value: 'label_provided', label: 'Prepaid return label provided' }
  ];
  var CAT_RULES = [
    { value: 'full_refund', label: 'Full refund' },
    { value: 'store_credit_only', label: 'Store credit only' },
    { value: 'exchange_only', label: 'Exchange only' },
    { value: 'final_sale', label: 'Final sale (no returns)' }
  ];
  function shipLabel(v) { var m = SHIPPING.filter(function (o) { return o.value === v; })[0]; return m ? m.label : (v || 'Not set'); }
  function ruleLabel(v) { var m = CAT_RULES.filter(function (o) { return o.value === v; })[0]; return m ? m.label : (v || 'Not set'); }
  function byId(id) { return document.getElementById(id) || {}; }
  function isSet(t) { return t && String(t).trim() ? 'Set' : 'Not set'; }

  // ── module state ────────────────────────────────────────────────────
  var V2 = { cfg: null, loaded: false };

  function stamp(c) {
    // Per-area title fields, materialised on the shared live ref so an onSave
    // mutation reaches the post-save read re-render (PR-123 lesson).
    c._retName = 'Return & exchange policy';
    c._txtName = 'Store terms';
    return c;
  }

  // ── editable slices (each edits its part of termsConfig) ─────────────
  MastEntity.define('terms-returns-v2', {
    label: 'Policies', labelPlural: 'Policies', size: 'lg', route: 'terms-v2',
    recordId: function () { return 'config'; },
    fields: [{ name: '_retName', label: 'Policy', type: 'text', readOnly: true }],
    fetch: function () { return Promise.resolve(V2.cfg); },
    detail: {
      render: function (UI, c) {
        var catBody = (c.categoryRules && c.categoryRules.length)
          ? UI.kv(c.categoryRules.map(function (cr) { return { k: cr.category, v: esc(ruleLabel(cr.rule)) }; }))
          : '<span class="mu-sub">No category-specific rules.</span>';
        return UI.card('Return & exchange policy', UI.kv([
          { k: 'Return window', v: esc(String(c.returnWindowDays != null ? c.returnWindowDays : 30)) + ' days' },
          { k: 'Restocking fee', v: esc(String(c.restockingFeePercent || 0)) + '%' },
          { k: 'Shipping', v: esc(shipLabel(c.shippingReturnPolicy)) },
          { k: 'Reasons', v: c.anyReason ? 'Any reason' : ((c.allowedReturnReasons || []).length ? esc((c.allowedReturnReasons || []).join(', ')) : 'None specified') }
        ])) + UI.cardTable('Category-specific rules', catBody);
      },
      editRender: function (c) {
        c = c || {};
        var shipOpts = SHIPPING.map(function (o) { return '<option value="' + esc(o.value) + '"' + (c.shippingReturnPolicy === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Return &amp; exchange policy</div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Return window (days)', '<input class="form-input" type="number" min="0" max="365" id="tcRetDays" value="' + esc(c.returnWindowDays != null ? c.returnWindowDays : 30) + '" style="width:100%;">', true) +
            fg('Restocking fee (%)', '<input class="form-input" type="number" min="0" max="100" id="tcRetRestock" value="' + esc(c.restockingFeePercent || 0) + '" style="width:100%;">', true) +
          '</div>' +
          fg('Shipping return policy', '<select class="form-input" id="tcRetShipping" style="width:100%;">' + shipOpts + '</select>') +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="tcRetAnyReason"' + (c.anyReason ? ' checked' : '') + ' onchange="document.getElementById(\'tcRetReasonsWrap\').style.display=this.checked?\'none\':\'\';"> Accept returns for any reason</label>' +
          '<div id="tcRetReasonsWrap" class="form-group"' + (c.anyReason ? ' style="display:none;"' : '') + '><label class="form-label">Allowed return reasons (one per line)</label><textarea class="form-input" id="tcRetReasons" rows="3" placeholder="Defective item&#10;Wrong size&#10;Changed mind" style="width:100%;resize:vertical;">' + esc((c.allowedReturnReasons || []).join('\n')) + '</textarea></div>' +
          '<div class="mu-sub" style="margin-top:6px;">Category-specific rules are preserved; <a href="#" onclick="TermsV2.classic();return false;">edit them in the classic Policies view</a>.</div>';
      }
    },
    onSave: function () {
      var days = parseInt(byId('tcRetDays').value, 10);
      var restock = parseInt(byId('tcRetRestock').value, 10);
      if (isNaN(days) || days < 0 || days > 365) { showToast('Return window must be 0–365 days', true); return false; }
      if (isNaN(restock) || restock < 0 || restock > 100) { showToast('Restocking fee must be 0–100%', true); return false; }
      var anyReason = !!byId('tcRetAnyReason').checked;
      var reasonsText = (byId('tcRetReasons').value || '').trim();
      var reasons = (!anyReason && reasonsText) ? reasonsText.split('\n').map(function (r) { return r.trim(); }).filter(Boolean) : [];
      return persist({ returnWindowDays: days, restockingFeePercent: restock, shippingReturnPolicy: byId('tcRetShipping').value, anyReason: anyReason, allowedReturnReasons: reasons }, 'returns');
    }
  });

  MastEntity.define('terms-text-v2', {
    label: 'Policies', labelPlural: 'Policies', size: 'lg', route: 'terms-v2',
    recordId: function () { return 'config'; },
    fields: [{ name: '_txtName', label: 'Policy', type: 'text', readOnly: true }],
    fetch: function () { return Promise.resolve(V2.cfg); },
    detail: {
      render: function (UI, c) {
        function termsCard(title, text) { return UI.card(title, text ? '<div style="font-size:0.9rem;white-space:pre-wrap;color:var(--charcoal,var(--text));line-height:1.5;">' + esc(text) + '</div>' : '<span class="mu-sub">Not set.</span>'); }
        return termsCard('Gift card terms', c.giftCardTerms) + termsCard('Loyalty program terms', c.loyaltyTerms) + termsCard('Additional terms', c.additionalTerms);
      },
      editRender: function (c) {
        c = c || {};
        function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function ta(id, val, rows, ph) { return '<textarea class="form-input" id="' + id + '" rows="' + (rows || 3) + '" placeholder="' + esc(ph || '') + '" style="width:100%;resize:vertical;">' + esc(val || '') + '</textarea>'; }
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Store terms</div>' +
          fg('Gift card terms', ta('tcTxtGift', c.giftCardTerms, 3, 'e.g. Gift cards never expire. Non-refundable.')) +
          fg('Loyalty program terms', ta('tcTxtLoyalty', c.loyaltyTerms, 3, 'e.g. Points expire after 12 months of inactivity.')) +
          fg('Additional terms', ta('tcTxtAdditional', c.additionalTerms, 5, 'Any additional terms, disclaimers, or policies…'));
      }
    },
    onSave: function () {
      return persist({
        giftCardTerms: (byId('tcTxtGift').value || '').trim() || null,
        loyaltyTerms: (byId('tcTxtLoyalty').value || '').trim() || null,
        additionalTerms: (byId('tcTxtAdditional').value || '').trim() || null
      }, 'terms');
    }
  });

  // termsConfig.update is a shallow merge → untouched fields (categoryRules, the
  // other slice) survive. PUBLISH (public/content/terms) stays on legacy.
  function persist(slice, scope) {
    slice.updatedAt = new Date().toISOString();
    return Promise.resolve(MastDB.termsConfig.update(slice)).then(function () {
      if (window.writeAudit) writeAudit('update', 'terms-config', scope);
      Object.assign(V2.cfg, slice);   // live ref → fresh post-save read + page refresh
      render(); return true;
    }).catch(function (e) { console.error('[terms-v2] save', e); showToast('Save failed', true); return false; });
  }

  // ── the read-only PAGE (cards of current policy settings) ───────────
  function ensureTab() {
    var el = document.getElementById('termsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'termsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function editCard(key, title, rows) {
    var summary = rows.map(function (r) {
      return '<div class="mu-sub" style="display:flex;justify-content:space-between;gap:12px;"><span>' + esc(r.k) + '</span><span style="color:var(--charcoal,var(--text));text-align:right;">' + (r.v == null || r.v === '' ? '—' : r.v) + '</span></div>';
    }).join('');
    return U.launchCard({ title: title, body: summary, onClickFnName: 'TermsV2.edit', arg: key, arrow: 'Edit →' });
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) { tab.innerHTML = U.pageHeader({ title: 'Policies', subtitle: 'Store policies & terms' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>'; return; }
    var c = V2.cfg || {};
    var returns = editCard('returns', 'Return & exchange policy', [
      { k: 'Return window', v: esc(String(c.returnWindowDays != null ? c.returnWindowDays : 30)) + ' days' },
      { k: 'Restocking fee', v: esc(String(c.restockingFeePercent || 0)) + '%' },
      { k: 'Shipping', v: esc(shipLabel(c.shippingReturnPolicy)) },
      { k: 'Category rules', v: (c.categoryRules || []).length ? ((c.categoryRules || []).length + ' set') : 'None' }
    ]);
    var terms = editCard('text', 'Store terms', [
      { k: 'Gift card terms', v: isSet(c.giftCardTerms) },
      { k: 'Loyalty terms', v: isSet(c.loyaltyTerms) },
      { k: 'Additional terms', v: isSet(c.additionalTerms) }
    ]);
    var published = c.lastPublishedAt
      ? '<div style="font-size:0.9rem;color:var(--charcoal,var(--text));">Last published ' + N.date(c.lastPublishedAt) + '.</div>'
      : '<div style="font-size:0.9rem;color:var(--charcoal,var(--text));">Not yet published to the storefront.</div>';
    var publish = U.card('Publish', published +
      '<div class="mu-sub" style="margin-top:10px;">Publishes the current policy settings to your public storefront terms page.</div>' +
      '<div style="margin-top:10px;"><button class="btn btn-primary" onclick="TermsV2.publish()">Publish to storefront →</button></div>', { fill: true });

    var grid = U.cardGrid([returns, terms, publish]);
    tab.innerHTML = U.pageHeader({ title: 'Policies', subtitle: 'Store policies & terms' }) + grid;
  }

  window.TermsV2 = {
    // Config slice → straight to edit (the page is already the read view).
    edit: function (which) {
      var key = which === 'text' ? 'terms-text-v2' : 'terms-returns-v2';
      Promise.resolve(MastDB.termsConfig.get()).then(function (c) {
        V2.cfg = stamp(Object.assign(V2.cfg || {}, c || {}));
        MastEntity.openRecord(key, V2.cfg, 'edit');
      });
    },
    // Native publish → delegates to the legacy storefront write via TermsBridge
    // (sales.js). The twin NEVER reimplements the public/content/terms write.
    publish: function () {
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('sales'); } catch (e) {} }
      if (!window.TermsBridge) { if (window.showToast) showToast('Publish engine still loading — try again', true); return; }
      var msg = 'Publish your current policy settings to the public storefront terms page? This updates what customers see.';
      Promise.resolve(typeof mastConfirm === 'function' ? mastConfirm(msg, { title: 'Publish to storefront', confirmLabel: 'Publish' }) : Promise.resolve(true)).then(function (ok) {
        if (!ok) return;
        // Pull the freshest config so publish reflects any just-saved slice edits.
        Promise.resolve(MastDB.termsConfig.get()).then(function (c) {
          var cfg = Object.assign(V2.cfg || {}, c || {});
          return Promise.resolve(window.TermsBridge.publish(cfg)).then(function (publishedAt) {
            V2.cfg.lastPublishedAt = publishedAt;   // live ref → fresh re-render
            if (window.writeAudit) writeAudit('publish', 'terms-config', 'storefront');
            if (window.showToast) showToast('Terms published to storefront.');
            render();
          });
        });
      }).catch(function (e) { console.error('[terms-v2] publish', e); if (window.showToast) showToast('Publish failed', true); });
    },
    // categoryRules editing remains legacy-only — keep classic re-entry for it.
    classic: function () { if (typeof navigateToClassic === 'function') navigateToClassic('terms'); else if (typeof navigateTo === 'function') navigateTo('terms'); },
    refresh: function () { render(); }
  };

  function load() {
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('sales'); } catch (e) {} } // ensure window.TermsBridge
    Promise.resolve(MastDB.termsConfig.get()).then(function (c) {
      V2.cfg = stamp(Object.assign({ _key: 'config' }, c || {}));
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[terms-v2] load', e); V2.loaded = true; render(); });
  }

  MastAdmin.registerModule('terms-v2', {
    routes: { 'terms-v2': { tab: 'termsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
