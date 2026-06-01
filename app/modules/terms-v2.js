/**
 * terms-v2.js — config-singleton reference build for the global shape decision
 * (doc 17 §13). Proves that a singleton is just an OBJECT reached by a *launcher*
 * producer instead of a list — and is presented/edited in the SAME slide-out as
 * every other object. No bespoke "config-page chrome".
 *
 * Legacy: the 'terms' route (sidebar "Policies") in sales.js renders a full-page
 * form + a separate edit modal + Publish button. This twin: a launcher card →
 * MastEntity slide-out (read + edit). Flag-gated (?ui=1) at #terms-v2,
 * side-by-side with legacy #terms; never touches sales.js.
 *
 * Save persists the config (MastDB.termsConfig.set — merged so untouched fields
 * like categoryRules survive). PUBLISH stays on legacy (a "Publish in classic
 * view" link) because it also writes the public storefront terms page
 * (public/content/terms) — a storefront side effect this view does not reimplement.
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

  // ── schema (config singleton presented as an object) ────────────────
  MastEntity.define('terms-v2', {
    label: 'Policy', labelPlural: 'Policies', size: 'lg',
    route: 'terms-v2',
    recordId: function () { return 'config'; },   // singleton
    fields: [
      { name: '_name', label: 'Policy', type: 'text', readOnly: true },
      { name: 'lastPublished', label: 'Last published', type: 'date', readOnly: true, get: function (c) { return c.lastPublishedAt || null; } }
    ],
    fetch: function () {
      return Promise.resolve(MastDB.termsConfig.get()).then(function (c) {
        V2.cfg = Object.assign({ _key: 'config', _name: 'Terms & Conditions' }, c || {});
        return V2.cfg;
      });
    },
    detail: {
      render: function (UI, c) {
        var returnKv = UI.kv([
          { k: 'Return window', v: esc(String(c.returnWindowDays != null ? c.returnWindowDays : 30)) + ' days' },
          { k: 'Restocking fee', v: esc(String(c.restockingFeePercent || 0)) + '%' },
          { k: 'Shipping', v: esc(shipLabel(c.shippingReturnPolicy)) },
          { k: 'Reasons', v: c.anyReason ? 'Any reason' : ((c.allowedReturnReasons || []).length ? esc((c.allowedReturnReasons || []).join(', ')) : 'None specified') }
        ]);
        var catBody = (c.categoryRules && c.categoryRules.length)
          ? UI.kv(c.categoryRules.map(function (cr) { return { k: cr.category, v: esc(ruleLabel(cr.rule)) }; }))
          : '<span class="mu-sub">No category-specific rules.</span>';
        function termsCard(title, text) { return UI.card(title, text ? '<div style="font-size:0.9rem;white-space:pre-wrap;color:var(--charcoal,var(--text));line-height:1.5;">' + esc(text) + '</div>' : '<span class="mu-sub">Not set.</span>'); }

        var published = c.lastPublishedAt
          ? '<div class="mu-sub" style="margin-bottom:10px;">Last published ' + N.date(c.lastPublishedAt) + '.</div>'
          : '<div class="mu-sub" style="margin-bottom:10px;">Not yet published to the storefront.</div>';
        var publishAction = '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary" onclick="TermsV2.classic()">Publish to storefront (classic view) →</button></div>';

        // Labeled facet tabs (the standard detail shape — scan + jump, no long
        // scroll), with a thin headline strip above. Matches orders/customers/etc.;
        // terms-v2 was the lone flat-stack outlier.
        var tiles = UI.tiles([
          { k: 'Return window', v: esc(String(c.returnWindowDays != null ? c.returnWindowDays : 30)) + ' days', hero: true },
          { k: 'Restocking', v: esc(String(c.restockingFeePercent || 0)) + '%' },
          { k: 'Last published', v: c.lastPublishedAt ? N.date(c.lastPublishedAt) : '—' }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'returns', label: 'Returns' }, { key: 'giftcard', label: 'Gift card' },
          { key: 'loyalty', label: 'Loyalty' }, { key: 'additional', label: 'Additional' }, { key: 'publish', label: 'Publish' }
        ], 'returns');
        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="returns">' + UI.card('Return policy', returnKv) + UI.cardTable('Category-specific rules', catBody) + '</div>' +
          '<div class="mu-pane" data-pane="giftcard" hidden>' + termsCard('Gift card terms', c.giftCardTerms) + '</div>' +
          '<div class="mu-pane" data-pane="loyalty" hidden>' + termsCard('Loyalty program terms', c.loyaltyTerms) + '</div>' +
          '<div class="mu-pane" data-pane="additional" hidden>' + termsCard('Additional terms', c.additionalTerms) + '</div>' +
          '<div class="mu-pane" data-pane="publish" hidden>' + UI.card('Publish', published + publishAction) + '</div>';
      },
      editRender: function (c) {
        c = c || {};
        var shipOpts = SHIPPING.map(function (o) { return '<option value="' + esc(o.value) + '"' + (c.shippingReturnPolicy === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
        var reasons = (c.allowedReturnReasons || []).join('\n');
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function ta(id, val, rows, ph) { return '<textarea class="form-input" id="' + id + '" rows="' + (rows || 3) + '" placeholder="' + esc(ph || '') + '" style="width:100%;resize:vertical;">' + esc(val || '') + '</textarea>'; }

        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Update policies</div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Return window (days)', '<input class="form-input" type="number" min="0" max="365" id="tcV2ReturnDays" value="' + esc(c.returnWindowDays != null ? c.returnWindowDays : 30) + '" style="width:100%;">', true) +
            fg('Restocking fee (%)', '<input class="form-input" type="number" min="0" max="100" id="tcV2Restock" value="' + esc(c.restockingFeePercent || 0) + '" style="width:100%;">', true) +
          '</div>' +
          fg('Shipping return policy', '<select class="form-input" id="tcV2Shipping" style="width:100%;">' + shipOpts + '</select>') +
          '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="tcV2AnyReason"' + (c.anyReason ? ' checked' : '') + ' onchange="document.getElementById(\'tcV2ReasonsWrap\').style.display=this.checked?\'none\':\'\';"> Accept returns for any reason</label></div>' +
          '<div id="tcV2ReasonsWrap" class="form-group"' + (c.anyReason ? ' style="display:none;"' : '') + '><label class="form-label">Allowed return reasons (one per line)</label>' + ta('tcV2Reasons', reasons, 3, 'Defective item\nWrong size\nChanged mind') + '</div>' +
          fg('Gift card terms', ta('tcV2Gift', c.giftCardTerms, 3, 'e.g. Gift cards never expire. Non-refundable.')) +
          fg('Loyalty program terms', ta('tcV2Loyalty', c.loyaltyTerms, 3, 'e.g. Points expire after 12 months of inactivity.')) +
          fg('Additional terms', ta('tcV2Additional', c.additionalTerms, 5, 'Any additional terms, disclaimers, or policies…')) +
          '<div class="mu-sub" style="margin-top:6px;">Category-specific rules are preserved; edit them in the classic Policies view.</div>';
      }
    },
    onSave: function () {
      var cur = V2.cfg || {};
      var returnDays = parseInt(byId('tcV2ReturnDays').value, 10);
      var restock = parseInt(byId('tcV2Restock').value, 10);
      if (isNaN(returnDays) || returnDays < 0 || returnDays > 365) { showToast('Return window must be 0–365 days', true); return false; }
      if (isNaN(restock) || restock < 0 || restock > 100) { showToast('Restocking fee must be 0–100%', true); return false; }
      var anyReason = !!byId('tcV2AnyReason').checked;
      var reasonsText = (byId('tcV2Reasons').value || '').trim();
      var reasons = (!anyReason && reasonsText) ? reasonsText.split('\n').map(function (r) { return r.trim(); }).filter(Boolean) : [];
      var gift = (byId('tcV2Gift').value || '').trim();
      var loyalty = (byId('tcV2Loyalty').value || '').trim();
      var additional = (byId('tcV2Additional').value || '').trim();
      // Merge over the current config so untouched fields (categoryRules, etc.) survive.
      var merged = Object.assign({}, cur, {
        returnWindowDays: returnDays, anyReason: anyReason, allowedReturnReasons: reasons,
        restockingFeePercent: restock, shippingReturnPolicy: byId('tcV2Shipping').value,
        giftCardTerms: gift || null, loyaltyTerms: loyalty || null, additionalTerms: additional || null,
        updatedAt: new Date().toISOString()
      });
      delete merged._key; delete merged._name;   // synthetic display fields — don't persist
      return Promise.resolve(MastDB.termsConfig.set(merged)).then(function () {
        if (window.writeAudit) writeAudit('update', 'terms-config', 'config');
        Object.assign(V2.cfg, merged);   // live ref → fresh post-save read (PR-123 lesson)
        showToast('Policies saved'); render(); return true;
      }).catch(function (e) { console.error('[terms-v2] save', e); showToast('Save failed', true); return false; });
    }
  });

  // ── module state + launcher (the producer for a singleton) ──────────
  var V2 = { cfg: null, loaded: false };

  function ensureTab() {
    var el = document.getElementById('termsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'termsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var c = V2.cfg;
    var sub = !V2.loaded ? 'Loading…' : (c && c.lastPublishedAt ? ('Last published ' + N.date(c.lastPublishedAt)) : 'Not yet published');
    // Launcher: a single config card whose click opens the object in the slide-out.
    // This is the singleton's producer — the same role a list plays for an entity.
    var launcher =
      '<button type="button" onclick="TermsV2.open()" style="all:unset;display:block;cursor:pointer;width:100%;max-width:520px;box-sizing:border-box;">' +
        '<div class="mu-card" style="margin:0;">' +
          '<h3>Terms &amp; Conditions</h3>' +
          '<div class="mu-cc">' +
            '<div style="font-size:0.9rem;color:var(--charcoal,var(--text));">Return policy, category rules, gift-card / loyalty / additional terms.</div>' +
            '<div class="mu-sub" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;">' +
              '<span>' + esc(sub) + '</span><span style="color:var(--teal);font-weight:600;">Open →</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</button>';
    tab.innerHTML = U.pageHeader({ title: 'Policies', subtitle: 'Store policies & terms' }) +
      '<div style="margin-top:14px;">' + launcher + '</div>';
  }

  window.TermsV2 = {
    open: function () { MastEntity.get('terms-v2').fetch().then(function (cfg) { if (cfg) MastEntity.openRecord('terms-v2', cfg, 'read'); }); },
    classic: function () { if (typeof navigateTo === 'function') navigateTo('terms'); },
    refresh: function () { render(); }
  };

  function load() {
    Promise.resolve(MastDB.termsConfig.get()).then(function (c) {
      V2.cfg = Object.assign({ _key: 'config', _name: 'Terms & Conditions' }, c || {});
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[terms-v2] load', e); V2.loaded = true; render(); });
  }

  MastAdmin.registerModule('terms-v2', {
    routes: { 'terms-v2': { tab: 'termsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
