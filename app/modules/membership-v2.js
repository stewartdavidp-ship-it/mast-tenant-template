/**
 * membership-v2.js — Faceted Record twin of the legacy Membership surface
 * (doc 17 §11/§12; conversion playbook).
 *
 * Legacy cart.js (#membership, owned by the Cart/Storefront module) hosts the
 * Membership admin: a program config block (program name, annual price, discount
 * tiers, free-shipping, loyalty multiplier, Stripe wiring) PLUS a members table
 * (renderMembershipAdmin → the "Members (N)" list with Grant / Revoke / Reactivate).
 * This twin re-hosts BOTH on the Entity Engine:
 *   • the MEMBERS list → a read-focused Faceted Record slide-out, and
 *   • the program CONFIG → a singleton edit object (Program settings card).
 *
 * Variant (doc 17 §1a): a member is a person + plan + status + since-date record.
 * Its status (active / cancelled / expired) is an assigned attribute with no
 * governed lifecycle (a manual Grant/Revoke flips it; there is no MastFlow phase
 * machine) — so a Faceted Record, NOT Process/MastFlow.
 *
 * Native actions (all four are clean CLIENT writes — none Cloud-Function-backed —
 * so all delegate-able): grant / revoke / reactivate a membership and edit the
 * program config are NATIVE here. Each delegates to the EXACT legacy write via
 * window.MembershipBridge (the thin shim in cart.js) so the writes stay
 * single-sourced — this twin never reimplements them. Mirrors the
 * WholesaleBridge (config/form) + CsReviewsBridge (action) precedents.
 *
 *   • Program config: the "Program settings" card edits its slice of
 *     admin/membership/config via MembershipBridge.saveConfig (= legacy
 *     _membershipSaveConfig's MastDB.update + writeAudit).
 *   • Grant: header "+ Grant" → a UID prompt → MembershipBridge.grant.
 *   • Revoke / Reactivate: action buttons in the member read slide-out →
 *     MembershipBridge.revoke / .reactivate (each = the legacy public-wallet +
 *     customers/<uid>/membership writes + writeAudit).
 *
 * NOTHING stays on classic for a CF reason — there is no membership Cloud Function
 * here; LOYALTY point-adjust is a separate surface and out of scope.
 * Flag-gated (?ui=1) at #membership-v2, side-by-side.
 *
 * Data (mirrors cart.js loadMembershipAdmin exactly): members are DERIVED from the
 * top-level `customers` collection — every customer whose record carries a
 * `membership` sub-object is a member. The row is that sub-object merged with the
 * customer id (_uid) and a resolved email. Member fields on `c.membership`:
 *   status ('active'|'cancelled'|'expired'), plan (the tier, e.g. 'manual-grant'),
 *   startDate (joined), renewalDate / expiryDate (renews), processor, paymentStatus.
 * The program config (programName, annualPrice, …) is one cheap one-shot read at
 * admin/membership/config — read context for the page + the source for the editor.
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

  // Status vocabulary mirrors cart.js (active / cancelled / expired — there is no
  // 'paused' state in the real membership data).
  var STATUS_LABEL = { active: 'Active', cancelled: 'Cancelled', expired: 'Expired' };
  var STATUS_TONE = { active: 'success', cancelled: 'amber', expired: 'neutral' };

  // A member's display name is its email (resolved from the customer record, with
  // the customer id as the last-resort fallback) — mirrors cart.js's "Email / UID".
  function memberName(m) { return (m && (m.email || m._uid)) || '(unknown)'; }
  function statusOf(m) { return (m && m.status) || 'expired'; }
  // The tier/plan label. cart.js stores it on `plan` (e.g. 'manual-grant'); the
  // canonical wallet shape may carry `tier`/`tierName` instead — accept all three.
  function planOf(m) {
    var p = m && (m.plan || m.tier || m.tierName);
    return p ? String(p) : '';
  }
  function planLabel(m) { return planOf(m) || '—'; }
  function joinedOf(m) { return (m && m.startDate) || null; }
  // "Renews" mirrors cart.js: renewalDate, falling back to expiryDate.
  function renewsOf(m) { return (m && (m.renewalDate || m.expiryDate)) || null; }
  function processorOf(m) { return (m && m.processor) || 'manual'; }

  function byId(id) { return document.getElementById(id) || {}; }

  // ── schema (read-only Faceted Record for the member) ─────────────────
  MastEntity.define('membership-v2', {
    label: 'Member', labelPlural: 'Members', size: 'md',
    route: 'membership-v2',
    recordId: function (m) { return m._uid || m.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'member', label: 'Member', type: 'text', list: true, readOnly: true, group: 'Membership', get: memberName },
      { name: 'plan', label: 'Plan', type: 'text', list: true, readOnly: true, get: planLabel },
      { name: 'startDate', label: 'Since', type: 'date', list: true, readOnly: true, get: joinedOf },
      { name: 'renews', label: 'Renews', type: 'date', list: true, readOnly: true, get: renewsOf },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'cancelled', 'expired'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      // Single Overview facet: a member has no cheap related collection (the plan
      // benefits live on the program config, not the member) — so one facet, no padding.
      render: function (UI, m) {
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(m)] || 'Unknown', STATUS_TONE[statusOf(m)] || 'neutral'), hero: true },
          { k: 'Plan', v: esc(planLabel(m)) },
          { k: 'Since', v: joinedOf(m) ? N.date(joinedOf(m)) : '—' },
          { k: 'Renews', v: renewsOf(m) ? N.date(renewsOf(m)) : '—' }
        ]);

        var membership = UI.kv([
          { k: 'Email', v: m.email ? esc(m.email) : '—' },
          { k: 'Customer ID', v: m._uid ? esc(m._uid) : '—' },
          { k: 'Plan', v: esc(planLabel(m)) },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(m)] || 'Unknown', STATUS_TONE[statusOf(m)] || 'neutral') },
          { k: 'Joined', v: joinedOf(m) ? N.date(joinedOf(m)) : '—' },
          { k: 'Renews', v: renewsOf(m) ? N.date(renewsOf(m)) : '—' }
        ]);

        // Billing context (read-only). Per-member price is not stored on the member;
        // the program's annual price comes from the config (loaded alongside, read-only).
        var price = (V2.config && V2.config.annualPrice != null && V2.config.annualPrice !== '')
          ? (N.money(Number(V2.config.annualPrice)) + '/yr') : '—';
        var billing = UI.kv([
          { k: 'Program', v: (V2.config && V2.config.programName) ? esc(V2.config.programName) : 'Membership' },
          { k: 'Program price', v: price },
          { k: 'Processor', v: esc(processorOf(m)) },
          { k: 'Payment status', v: m.paymentStatus ? esc(m.paymentStatus) : '—' },
          { k: 'Subscription', v: m.processorSubscriptionId ? esc(m.processorSubscriptionId) : '—' },
          { k: 'Last updated', v: m.updatedAt ? N.date(m.updatedAt) : '—' }
        ]);

        // ── Membership actions — native buttons (delegate to MembershipBridge) ──
        // Mirror legacy renderMembershipAdmin per status: active → Revoke;
        // expired/cancelled → Reactivate. Each delegates to the existing client
        // write via the bridge (cs-reviews-v2 precedent). No CF involved.
        var uid = esc(String(m._uid || ''));
        var actBtns = [];
        if (statusOf(m) === 'active') {
          actBtns.push('<button class="btn btn-danger btn-small" onclick="MembershipV2.revoke(\'' + uid + '\')">Revoke</button>');
        } else {
          actBtns.push('<button class="btn btn-primary btn-small" onclick="MembershipV2.reactivate(\'' + uid + '\')">Reactivate</button>');
        }
        var actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + actBtns.join('') + '</div>';

        return tiles +
          UI.card('Actions', actions) +
          UI.card('Membership', membership) +
          UI.card('Billing', billing);
      }
    }
    // No onSave on the member object → no Edit button (member fields are derived;
    // status changes go through the native Revoke/Reactivate actions above).
  });

  // ── program config (singleton edit object) ──────────────────────────
  // The page already IS the read view (a settings summary card), so this object
  // goes STRAIGHT TO EDIT on click — the wallet-v2 config-object pattern. Edits
  // its slice of admin/membership/config and delegates the write to
  // MembershipBridge.saveConfig (= legacy _membershipSaveConfig).
  MastEntity.define('membership-config-v2', {
    label: 'Membership', labelPlural: 'Membership', size: 'md', route: 'membership-v2',
    recordId: function () { return 'config'; },
    fields: [{ name: '_cfgName', label: 'Program', type: 'text', readOnly: true }],
    fetch: function () { return Promise.resolve(V2.config); },
    detail: {
      render: function (UI, c) {
        c = c || {};
        var price = (c.annualPrice != null && c.annualPrice !== '') ? (N.money(Number(c.annualPrice)) + '/yr') : 'Not set';
        var discounts = [];
        if (c.productDiscountPct) discounts.push('Products ' + c.productDiscountPct + '%');
        if (c.serviceDiscountPct) discounts.push('Services ' + c.serviceDiscountPct + '%');
        if (c.classSeatDiscountPct) discounts.push('Classes ' + c.classSeatDiscountPct + '%');
        if (c.classMaterialsDiscountPct) discounts.push('Materials ' + c.classMaterialsDiscountPct + '%');
        return UI.card('Program settings', UI.kv([
          { k: 'Status', v: c.enabled ? 'Enabled' : 'Disabled' },
          { k: 'Program name', v: esc(c.programName || 'Membership') },
          { k: 'Annual price', v: price },
          { k: 'Member discounts', v: discounts.length ? esc(discounts.join(', ')) : 'None' },
          { k: 'Free shipping', v: (c.freeShippingThreshold != null) ? (c.freeShippingThreshold === 0 ? 'Always for members' : 'Over ' + N.money(Number(c.freeShippingThreshold))) : 'Off' },
          { k: 'Loyalty multiplier', v: (c.loyaltyPointMultiplier && c.loyaltyPointMultiplier > 1) ? (c.loyaltyPointMultiplier + 'x') : 'Off' },
          { k: 'Priority enrollment', v: c.priorityEnrollmentDays ? (c.priorityEnrollmentDays + ' days') : 'Off' },
          { k: 'Early product access', v: c.earlyProductAccessHours ? (c.earlyProductAccessHours + ' hrs') : 'Off' },
          { k: 'Promo stacking', v: c.allowPromoStack ? 'Allowed' : 'Membership only' },
          { k: 'Stripe', v: c.stripeProductId ? 'Connected' : 'Auto-create on first signup' }
        ]));
      },
      // Mirrors the legacy _membershipOpenConfig modal field set EXACTLY
      // (enabled, program name, annual price, four discount %s, free-shipping
      // threshold, loyalty multiplier, priority-enrollment days, early-access
      // hours, promo stacking).
      editRender: function (c) {
        c = c || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row(parts) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + parts.join('') + '</div>'; }
        function num(id, val, attrs) { return '<input class="form-input" type="number" id="' + id + '" value="' + esc(val == null ? '' : val) + '"' + (attrs || '') + ' style="width:100%;">'; }
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Membership settings</div>' +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="msV2Enabled"' + (c.enabled ? ' checked' : '') + '> Enable membership program</label>' +
          row([
            fg('Program name', '<input class="form-input" type="text" id="msV2Name" value="' + esc(c.programName || '') + '" placeholder="Membership" style="width:100%;">', true),
            fg('Annual price ($)', num('msV2Price', c.annualPrice, ' min="0" step="0.01" placeholder="49.99"'), true)
          ]) +
          '<div class="form-label" style="margin-top:8px;">Member discounts (%)</div>' +
          row([
            fg('Products', num('msV2ProdPct', c.productDiscountPct, ' min="0" max="100" step="1" placeholder="0"'), true),
            fg('Services', num('msV2SvcPct', c.serviceDiscountPct, ' min="0" max="100" step="1" placeholder="0"'), true)
          ]) +
          row([
            fg('Class seats', num('msV2ClassPct', c.classSeatDiscountPct, ' min="0" max="100" step="1" placeholder="0"'), true),
            fg('Class materials', num('msV2MatPct', c.classMaterialsDiscountPct, ' min="0" max="100" step="1" placeholder="0"'), true)
          ]) +
          row([
            fg('Free shipping threshold ($)', num('msV2ShipThresh', (c.freeShippingThreshold != null ? c.freeShippingThreshold : ''), ' min="0" step="1" placeholder="0 = always free"'), true),
            fg('Loyalty multiplier', num('msV2LoyaltyMult', c.loyaltyPointMultiplier, ' min="1" step="0.5" placeholder="2"'), true)
          ]) +
          row([
            fg('Priority enrollment (days)', num('msV2PriorityDays', c.priorityEnrollmentDays, ' min="0" step="1" placeholder="e.g. 7"'), true),
            fg('Early product access (hours)', num('msV2EarlyHrs', c.earlyProductAccessHours, ' min="0" step="1" placeholder="e.g. 48"'), true)
          ]) +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="msV2PromoStack"' + (c.allowPromoStack ? ' checked' : '') + '> Allow promo stacking (sale discount + membership discount)</label>';
      }
    },
    onSave: function () {
      if (!window.MembershipBridge) { if (window.showToast) showToast('Membership engine still loading — try again', true); return false; }
      // Collect the form, hand the raw values to the bridge (it owns the exact
      // build + validation + write + audit, identical to legacy _membershipSaveConfig).
      var data = {
        enabled: !!byId('msV2Enabled').checked,
        programName: byId('msV2Name').value,
        annualPrice: byId('msV2Price').value,
        productDiscountPct: byId('msV2ProdPct').value,
        serviceDiscountPct: byId('msV2SvcPct').value,
        classSeatDiscountPct: byId('msV2ClassPct').value,
        classMaterialsDiscountPct: byId('msV2MatPct').value,
        freeShippingThreshold: byId('msV2ShipThresh').value,
        loyaltyPointMultiplier: byId('msV2LoyaltyMult').value,
        priorityEnrollmentDays: byId('msV2PriorityDays').value,
        earlyProductAccessHours: byId('msV2EarlyHrs').value,
        allowPromoStack: !!byId('msV2PromoStack').checked
      };
      return Promise.resolve(window.MembershipBridge.saveConfig(data)).then(function (saved) {
        if (!saved) return false;   // bridge already toasted the validation failure
        // Mutate the live config ref (=== the page's read source) so the post-save
        // re-render shows the new settings; reloadSoon refreshes for the next open.
        V2.config = Object.assign(V2.config || {}, saved, { _cfgName: 'Program settings' });
        reloadSoon(); return true;
      }).catch(function (e) { console.error('[membership-v2] saveConfig', e); if (window.showToast) showToast('Error saving settings.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, config: null, sortKey: 'startDate', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false, busy: false };

  function load() {
    // Ensure the legacy cart module is loaded so window.MembershipBridge (the
    // delegated write path) exists — mirrors wholesale-v2 / contacts-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('cart'); } catch (e) {} }
    // Members are derived from `customers` (every customer with a `.membership`
    // sub-object); the program config is a separate cheap one-shot read used for
    // read context + the editor source. Both loaded together; bounded (limitToLast).
    Promise.all([
      Promise.resolve(MastDB.query('customers').limitToLast(500).once()).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/membership/config')).catch(function () { return null; })
    ]).then(function (res) {
      // .once() resolves to the raw keyed object (with a non-enumerable .val());
      // accept either shape defensively (matches the wholesale-v2 reader).
      var snap = res[0];
      var custData = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      custData = custData || {};
      V2.config = Object.assign({ _cfgName: 'Program settings' }, res[1] || {});
      var out = [];
      Object.keys(custData).forEach(function (uid) {
        var c = custData[uid];
        if (c && typeof c === 'object' && c.membership && typeof c.membership === 'object') {
          var m = Object.assign({ _uid: uid }, c.membership, { email: c.email || c.membership.email || uid });
          out.push(m);
        }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._uid] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[membership-v2] load', e); render(); });
  }
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (m) { return statusOf(m) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (m) {
        return memberName(m).toLowerCase().indexOf(q) >= 0 ||
               planLabel(m).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('membership-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('membershipV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'membershipV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  // The program-settings summary card (the page is the read view; clicking it
  // goes straight to edit — wallet-v2 config-object pattern).
  function settingsCard() {
    var c = V2.config || {};
    var price = (c.annualPrice != null && c.annualPrice !== '') ? (N.money(Number(c.annualPrice)) + '/yr') : 'Not set';
    var rows = [
      { k: 'Program', v: esc(c.programName || 'Membership') },
      { k: 'Annual price', v: price }
    ];
    return U.launchCard({
      title: 'Program settings',
      body: rows.map(function (r) {
        return '<div class="mu-sub" style="display:flex;justify-content:space-between;gap:12px;"><span>' + esc(r.k) + '</span><span style="color:var(--text-primary);text-align:right;">' + r.v + '</span></div>';
      }).join(''),
      onClickFnName: 'MembershipV2.settings', arrow: 'Edit →',
      headerRight: U.badge(c.enabled ? 'Enabled' : 'Disabled', c.enabled ? 'success' : 'neutral')
    });
  }

  function render() {
    var tab = ensureTab();
    var counts = { active: 0, cancelled: 0, expired: 0 };
    V2.rows.forEach(function (m) { var s = statusOf(m); if (counts[s] != null) counts[s]++; });
    var filters = [['all', 'All', V2.rows.length], ['active', 'Active', counts.active], ['cancelled', 'Cancelled', counts.cancelled], ['expired', 'Expired', counts.expired]]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="MembershipV2.filter(\'' + f[0] + '\')">' + esc(f[1]) + ' (' + N.count(f[2]) + ')</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Membership',
        count: N.count(V2.rows.length) + ' member' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-primary" onclick="MembershipV2.grant()">+ Grant</button>' +
          '<button class="btn btn-secondary" onclick="MembershipV2.exportCsv()">&darr; Export</button>'
      }) +
      '<div style="margin:12px 0;">' + settingsCard() + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search member or plan&hellip;" value="' + esc(V2.q) +
        '" oninput="MembershipV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('membership-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'MembershipV2.sort', onRowClickFnName: 'MembershipV2.open',
        empty: { title: 'No members', message: V2.loaded ? 'Use “+ Grant” to add a member by customer UID.' : 'Loading…' }
      });
  }

  // Delegate a member status action to the legacy write via MembershipBridge,
  // then refresh the page + the open slide-out. Guarded by V2.busy so a double-tap
  // can't fire two writes (cs-reviews-v2 moderate() precedent).
  function act(action, uid) {
    if (V2.busy) return Promise.resolve();
    var bridge = window.MembershipBridge;
    if (!bridge || typeof bridge[action] !== 'function') {
      if (window.showToast) showToast('Membership action unavailable', true);
      return Promise.resolve();
    }
    V2.busy = true;
    return Promise.resolve(bridge[action](uid)).then(function (ok) {
      V2.busy = false;
      if (!ok) return;   // bridge already toasted the failure / no-op
      // Reflect the new status locally so the immediate re-render is correct, then
      // reloadSoon refreshes the derived rows from `customers`.
      var row = V2.byId[uid];
      if (row) {
        if (action === 'revoke') row.status = 'expired';
        else if (action === 'reactivate') row.status = 'active';
      }
      render();
      if (row) MastEntity.openRecord('membership-v2', row, 'read');
      reloadSoon();
    }).catch(function (e) {
      V2.busy = false;
      console.error('[membership-v2] ' + action, e);
      if (window.showToast) showToast('Action failed: ' + (e && e.message || e), true);
    });
  }

  window.MembershipV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'startDate' || key === 'renews' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('membership-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('membership-v2', rec, 'read');
      });
    },
    // Program config object → straight to edit (the page already IS the read view).
    settings: function () {
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('cart'); } catch (e) {} }
      Promise.resolve((window.MembershipBridge && MembershipBridge.getConfig) ? MembershipBridge.getConfig() : MastDB.get('admin/membership/config'))
        .then(function (c) {
          V2.config = Object.assign({ _cfgName: 'Program settings' }, V2.config || {}, c || {});
          MastEntity.openRecord('membership-config-v2', V2.config, 'edit');
        }).catch(function () {
          V2.config = V2.config || { _cfgName: 'Program settings' };
          MastEntity.openRecord('membership-config-v2', V2.config, 'edit');
        });
    },
    // Grant by customer UID — a single-field mastPrompt dialog (mirrors the
    // legacy grant modal's lone UID input) → MembershipBridge.grant.
    // Standards-clean: mastPrompt, never the native window dialog.
    grant: function () {
      if (typeof mastPrompt !== 'function') { if (window.showToast) showToast('Grant unavailable', true); return; }
      mastPrompt('Enter the customer UID to grant a membership. Find it in Contacts or the Firebase Auth console.', {
        title: 'Grant Membership', placeholder: 'Firebase UID', confirmLabel: 'Grant'
      }).then(function (uid) {
        uid = (uid || '').trim();
        if (!uid) return;   // cancelled / empty
        return act('grant', uid);
      });
    },
    revoke: function (uid) {
      return Promise.resolve(
        (typeof mastConfirm === 'function')
          ? mastConfirm('Revoke this membership? The customer will lose all benefits immediately.', { title: 'Revoke Membership', danger: true })
          : true
      ).then(function (ok) { if (ok) return act('revoke', uid); });
    },
    reactivate: function (uid) { return act('reactivate', uid); },
    exportCsv: function () { return MastEntity.exportRows('membership-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('membership-v2', {
    routes: { 'membership-v2': { tab: 'membershipV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
