/**
 * cs-members-v2.js — Faceted Record twin of the legacy Customer-Service MEMBERS
 * surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy customer-service.js (#cs-members, the "CS Members" tab) shows a
 * membership-health roster in two sub-tabs — "At Risk" (cancelled OR
 * failed-payment members) and "All Active" (active subscriptions, with a small
 * KPI band: active count, payment issues, renewing-in-30d). The legacy tab was
 * itself read-only (a "View Contact" button only) and pointed staff at the
 * separate Membership admin (cart.js #membership) for every write. This twin
 * re-hosts the VIEW on the Entity Engine AND closes that gap: a support rep can
 * now grant / revoke / reactivate a membership and edit the program config
 * WITHOUT bouncing to another surface. Flag-gated (?ui=1) at #cs-members-v2,
 * side-by-side with legacy #cs-members; it NEVER touches customer-service.js.
 *
 * What CS members ARE (verified against customer-service.js loadMembersData):
 * members are DERIVED from the top-level `customers` collection — every customer
 * record that carries a `membership` sub-object is a member. The legacy reader
 * queries customers by membership.status (active / cancelled) and
 * membership.paymentStatus (failed). The row is that `c.membership` sub-object
 * merged with the customer id (_uid) and a resolved email/name. Member fields on
 * `c.membership`: status ('active'|'cancelled'|'expired'), plan (the tier),
 * paymentStatus ('failed' = at risk; else current), expiryDate (cancelled members
 * lapse on), renewalDate (active members renew on), activeSince (joined).
 *
 * Variant (doc 17 §1a test): a member is a person + plan + status + dates record.
 * Its status is an assigned attribute with no governed lifecycle (a manual
 * cancel/renew flips it; there is no MastFlow phase machine) — so a Faceted
 * Record, NOT Process/MastFlow. A member has no cheap related collection (the
 * plan's benefits live on the Membership program config, not the member) — so a
 * single Overview facet, no padding. The CS lens emphasises payment health and
 * days-until-expiry, so those get list columns + a slim KPI band, mirroring the
 * legacy "At Risk" framing.
 *
 * Native actions (the SAME object as membership-v2 — both lenses derive the member
 * from customers/<uid>.membership). All writes delegate to the EXACT legacy write
 * via window.MembershipBridge (the thin shim in cart.js, lines ~829–972) so the
 * write logic stays single-sourced — this twin never reimplements it. Every action
 * is a plain CLIENT write (MastDB + writeAudit); NONE is Cloud-Function-backed and
 * NONE touches Stripe (admin grants are processor:'manual', subscriptionId:null),
 * so all four are delegate-able with no cross-repo dependency. Mirrors the
 * membership-v2 + MembershipBridge precedent exactly:
 *   • Grant: header "+ Grant" → a UID prompt → MembershipBridge.grant.
 *   • Revoke / Reactivate: action buttons in the member slide-out →
 *     MembershipBridge.revoke / .reactivate.
 *   • Program config: the "Program settings" card → an edit object whose onSave
 *     delegates to MembershipBridge.saveConfig (= legacy _membershipSaveConfig).
 *
 * Limitation (pre-existing; shared with legacy + membership-v2, OUT OF SCOPE here):
 * revoke flips the Firestore status to expired but does NOT cancel a live Stripe
 * subscription for a self-service member (processor:'stripe' + a real
 * processorSubscriptionId). True processor-cancel-on-revoke would be gated
 * mast-architecture CF work; the manual admin lifecycle this surface drives needs
 * no CF.
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
  // RBAC: members surface gates on the LEGACY route id (cs-reviews-v2 precedent —
  // can('cs-members', axis) resolves through the customer-service section triad).
  // edit → grant / reactivate / program-config save; delete → revoke (destructive).
  function canCs(axis) { return (typeof window.can === 'function') ? window.can('cs-members', axis) : true; }

  // Status vocabulary mirrors customer-service.js (active / cancelled / expired —
  // the legacy queries use active + cancelled; expired is the safe default for any
  // membership lacking a status).
  var STATUS_LABEL = { active: 'Active', cancelled: 'Cancelled', expired: 'Expired' };
  var STATUS_TONE = { active: 'success', cancelled: 'amber', expired: 'neutral' };

  // A member's display name prefers the customer displayName/name, then email,
  // then the customer id (mirrors the legacy "Name / Email" cell + its fallbacks).
  function memberName(m) { return (m && (m.displayName || m.name || m.email || m._uid)) || '(unknown)'; }
  function memberEmail(m) { return (m && m.email) || ''; }
  function statusOf(m) { return (m && m.status) || 'expired'; }
  function planOf(m) {
    var p = m && (m.plan || m.tier || m.tierName);
    return p ? String(p) : '';
  }
  function planLabel(m) { return planOf(m) || '—'; }
  function joinedOf(m) { return (m && (m.activeSince || m.startDate || m.createdAt)) || null; }
  // "Renews / lapses": active members renew on renewalDate; cancelled members
  // lapse on expiryDate. Mirrors the legacy split (active list shows Next Renewal;
  // at-risk list shows Expiry Date). Accept either, renewal first.
  function renewsOf(m) { return (m && (m.renewalDate || m.expiryDate)) || null; }
  function paymentOf(m) { return (m && m.paymentStatus) || ''; }
  function paymentFailed(m) { return paymentOf(m) === 'failed'; }
  function processorOf(m) { return (m && m.processor) || 'manual'; }
  // "At risk" = the legacy At-Risk set: cancelled OR a failed payment.
  function atRisk(m) { return statusOf(m) === 'cancelled' || paymentFailed(m); }

  // Days until a date (whole days from today; null when unparseable). Mirrors the
  // legacy daysUntil helper — drives the read-only "Days remaining" emphasis.
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var t = new Date(dateStr);
    if (isNaN(t.getTime())) return null;
    var now = new Date(); now.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
    return Math.round((t - now) / (1000 * 60 * 60 * 24));
  }
  // Tone for a "days remaining" value (mirrors the legacy danger/amber/teal bands).
  function daysTone(d) { return d == null ? 'neutral' : (d <= 7 ? 'danger' : (d <= 30 ? 'amber' : 'teal')); }
  function daysLabel(d) { return d == null ? '—' : (d < 0 ? (Math.abs(d) + 'd ago') : (d + 'd')); }
  // Payment-health pill: failed → danger, otherwise current → neutral.
  function paymentBadge(m) {
    return paymentFailed(m) ? U.badge('Failed', 'danger') : U.badge('Current', 'neutral');
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('cs-members-v2', {
    label: 'Member', labelPlural: 'Members', size: 'md',
    route: 'cs-members-v2',
    recordId: function (m) { return m._uid || m.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'member', label: 'Member', type: 'text', list: true, readOnly: true, group: 'Membership', get: memberName },
      { name: 'plan', label: 'Plan', type: 'text', list: true, readOnly: true, get: planLabel },
      // Payment health — the CS "at risk" signal. Rendered as a tone badge.
      { name: 'payment', label: 'Payment', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (m) { return paymentFailed(m) ? 'Failed' : 'Current'; },
        tone: function () { return 'neutral'; } },
      { name: 'renews', label: 'Renews / lapses', type: 'date', list: true, readOnly: true, get: renewsOf },
      { name: 'startDate', label: 'Since', type: 'date', list: true, readOnly: true, get: joinedOf },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'cancelled', 'expired'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      // Single Overview facet: a member has no cheap related collection (plan
      // benefits live on the program config, not the member). The interior leads
      // with payment-health + days-to-renewal tiles (the CS lens), then the
      // membership + billing detail — no padding, no second facet.
      render: function (UI, m) {
        var dRenew = daysUntil(renewsOf(m));
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(m)] || 'Unknown', STATUS_TONE[statusOf(m)] || 'neutral'), hero: true },
          { k: 'Payment', v: paymentBadge(m) },
          { k: (statusOf(m) === 'cancelled' ? 'Lapses in' : 'Renews in'), v: UI.badge(daysLabel(dRenew), daysTone(dRenew)) },
          { k: 'Plan', v: esc(planLabel(m)) }
        ]);

        var membership = UI.kv([
          { k: 'Name', v: (m.displayName || m.name) ? esc(m.displayName || m.name) : '—' },
          { k: 'Email', v: memberEmail(m) ? esc(memberEmail(m)) : '—' },
          { k: 'Customer ID', v: m._uid ? esc(m._uid) : '—' },
          { k: 'Plan', v: esc(planLabel(m)) },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(m)] || 'Unknown', STATUS_TONE[statusOf(m)] || 'neutral') },
          { k: 'Since', v: joinedOf(m) ? N.date(joinedOf(m)) : '—' },
          { k: (statusOf(m) === 'cancelled' ? 'Lapses' : 'Renews'), v: renewsOf(m) ? N.date(renewsOf(m)) : '—' }
        ]);

        // Payment / billing context (read-only). At-risk emphasis: failed payments
        // and a cancelled status are the two CS escalation signals.
        var billing = UI.kv([
          { k: 'Payment status', v: paymentBadge(m) },
          { k: 'Processor', v: esc(processorOf(m)) },
          { k: 'Subscription', v: m.processorSubscriptionId ? esc(m.processorSubscriptionId) : '—' },
          { k: 'At risk', v: atRisk(m) ? UI.badge('At risk', 'danger') : UI.badge('Healthy', 'success') },
          { k: 'Last updated', v: m.updatedAt ? N.date(m.updatedAt) : '—' }
        ]);

        // ── Native lifecycle actions (delegate to MembershipBridge) ─────────
        // Mirror legacy renderMembershipAdmin per status: active → Revoke;
        // expired/cancelled → Reactivate. Each delegates to the existing client
        // write via the bridge (membership-v2 + cs-reviews-v2 precedent). No CF.
        // RBAC (cs-reviews-v2 precedent): hide the levers a role can't use — Revoke
        // requires delete (destructive), Reactivate requires edit. View-only roles
        // keep the read-only "View contact" affordance only.
        var uid = esc(String(m._uid || ''));
        var actBtns = [];
        if (statusOf(m) === 'active') {
          if (canCs('delete')) actBtns.push('<button class="btn btn-danger btn-small" onclick="CsMembersV2.revoke(\'' + uid + '\')">Revoke</button>');
        } else {
          if (canCs('edit')) actBtns.push('<button class="btn btn-primary btn-small" onclick="CsMembersV2.reactivate(\'' + uid + '\')">Reactivate</button>');
        }
        if (memberEmail(m)) {
          actBtns.push('<button class="btn btn-secondary btn-small" onclick="CsMembersV2.viewContact(' + JSON.stringify(memberEmail(m)) + ')">View contact &rarr;</button>');
        }
        var actions = actBtns.length
          ? '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + actBtns.join('') + '</div>'
          : '<span class="mu-sub">View-only access.</span>';

        return tiles +
          UI.card('Actions', actions) +
          UI.card('Membership', membership) +
          UI.card('Payment & risk', billing);
      }
    }
    // No onSave on the member object → no Edit button (member fields are derived;
    // status changes go through the native Revoke/Reactivate actions above).
  });

  // ── program config (singleton edit object) ──────────────────────────
  // The same singleton as membership-config-v2 (admin/membership/config). cs-members
  // owns its own edit object so the CS surface is self-sufficient — but the WRITE is
  // single-sourced through MembershipBridge.saveConfig (= legacy _membershipSaveConfig),
  // never reimplemented. The "Program settings" card on the list opens this in edit.
  MastEntity.define('cs-members-config-v2', {
    label: 'Membership', labelPlural: 'Membership', size: 'md', route: 'cs-members-v2',
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
      // Mirrors the legacy _membershipOpenConfig field set EXACTLY (enabled, program
      // name, annual price, four discount %s, free-shipping threshold, loyalty
      // multiplier, priority-enrollment days, early-access hours, promo stacking).
      // Distinct id prefix (csms) so it never collides with membership-v2's editor.
      editRender: function (c) {
        c = c || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row(parts) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + parts.join('') + '</div>'; }
        function num(id, val, attrs) { return '<input class="form-input" type="number" id="' + id + '" value="' + esc(val == null ? '' : val) + '"' + (attrs || '') + ' style="width:100%;">'; }
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Membership settings</div>' +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="csmsEnabled"' + (c.enabled ? ' checked' : '') + '> Enable membership program</label>' +
          row([
            fg('Program name', '<input class="form-input" type="text" id="csmsName" value="' + esc(c.programName || '') + '" placeholder="Membership" style="width:100%;">', true),
            fg('Annual price ($)', num('csmsPrice', c.annualPrice, ' min="0" step="0.01" placeholder="49.99"'), true)
          ]) +
          '<div class="form-label" style="margin-top:8px;">Member discounts (%)</div>' +
          row([
            fg('Products', num('csmsProdPct', c.productDiscountPct, ' min="0" max="100" step="1" placeholder="0"'), true),
            fg('Services', num('csmsSvcPct', c.serviceDiscountPct, ' min="0" max="100" step="1" placeholder="0"'), true)
          ]) +
          row([
            fg('Class seats', num('csmsClassPct', c.classSeatDiscountPct, ' min="0" max="100" step="1" placeholder="0"'), true),
            fg('Class materials', num('csmsMatPct', c.classMaterialsDiscountPct, ' min="0" max="100" step="1" placeholder="0"'), true)
          ]) +
          row([
            fg('Free shipping threshold ($)', num('csmsShipThresh', (c.freeShippingThreshold != null ? c.freeShippingThreshold : ''), ' min="0" step="1" placeholder="0 = always free"'), true),
            fg('Loyalty multiplier', num('csmsLoyaltyMult', c.loyaltyPointMultiplier, ' min="1" step="0.5" placeholder="2"'), true)
          ]) +
          row([
            fg('Priority enrollment (days)', num('csmsPriorityDays', c.priorityEnrollmentDays, ' min="0" step="1" placeholder="e.g. 7"'), true),
            fg('Early product access (hours)', num('csmsEarlyHrs', c.earlyProductAccessHours, ' min="0" step="1" placeholder="e.g. 48"'), true)
          ]) +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="csmsPromoStack"' + (c.allowPromoStack ? ' checked' : '') + '> Allow promo stacking (sale discount + membership discount)</label>';
      }
    },
    onSave: function () {
      if (!canCs('edit')) { if (window.showToast) showToast('Membership write access required.', true); return false; }
      if (!window.MembershipBridge) { if (window.showToast) showToast('Membership engine still loading — try again', true); return false; }
      function byId(id) { return document.getElementById(id) || {}; }
      // Collect the form, hand the raw values to the bridge (it owns the exact
      // build + validation + write + audit, identical to legacy _membershipSaveConfig).
      var data = {
        enabled: !!byId('csmsEnabled').checked,
        programName: byId('csmsName').value,
        annualPrice: byId('csmsPrice').value,
        productDiscountPct: byId('csmsProdPct').value,
        serviceDiscountPct: byId('csmsSvcPct').value,
        classSeatDiscountPct: byId('csmsClassPct').value,
        classMaterialsDiscountPct: byId('csmsMatPct').value,
        freeShippingThreshold: byId('csmsShipThresh').value,
        loyaltyPointMultiplier: byId('csmsLoyaltyMult').value,
        priorityEnrollmentDays: byId('csmsPriorityDays').value,
        earlyProductAccessHours: byId('csmsEarlyHrs').value,
        allowPromoStack: !!byId('csmsPromoStack').checked
      };
      return Promise.resolve(window.MembershipBridge.saveConfig(data)).then(function (saved) {
        if (!saved) return false;   // bridge already toasted the validation failure
        // Mutate the live config ref (=== the page's settings-card source) so the
        // re-render shows the new settings; reloadSoon refreshes for the next open.
        V2.config = Object.assign(V2.config || {}, saved, { _cfgName: 'Program settings' });
        reloadSoon(); return true;
      }).catch(function (e) { console.error('[cs-members-v2] saveConfig', e); if (window.showToast) showToast('Error saving settings.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  // statusFilter: 'all' | 'at-risk' | 'active' | 'cancelled' | 'expired'.
  // 'at-risk' is the legacy At-Risk lens (cancelled OR failed payment), not a
  // status value — handled in visibleRows().
  var V2 = { rows: [], byId: {}, config: null, sortKey: 'renews', sortDir: 'asc', q: '', statusFilter: 'all', loaded: false, busy: false };

  function load() {
    // Ensure the legacy cart module is loaded so window.MembershipBridge (the
    // delegated write path for grant/revoke/reactivate/saveConfig) exists —
    // mirrors membership-v2 / wholesale-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('cart'); } catch (e) {} }
    // Members are derived from `customers` (every customer with a `.membership`
    // sub-object); the program config is a cheap one-shot read for the settings
    // card + the editor source. Both bounded (limitToLast), no unbounded listener.
    // Mirrors the membership-v2 reader; the CS surface is a different lens.
    Promise.all([
      Promise.resolve(MastDB.query('customers').limitToLast(500).once()).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/membership/config')).catch(function () { return null; })
    ]).then(function (res) {
      // .once() resolves to the raw keyed object (with a non-enumerable .val());
      // accept either shape defensively.
      var snap = res[0];
      var custData = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      custData = custData || {};
      V2.config = Object.assign({ _cfgName: 'Program settings' }, res[1] || {});
      var out = [];
      Object.keys(custData).forEach(function (uid) {
        var c = custData[uid];
        if (c && typeof c === 'object' && c.membership && typeof c.membership === 'object') {
          var m = Object.assign({ _uid: uid }, c.membership, {
            email: c.email || c.membership.email || '',
            displayName: c.displayName || c.name || '',
            name: c.name || c.displayName || '',
            createdAt: c.membership.activeSince || c.membership.startDate || c.createdAt || null
          });
          out.push(m);
        }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._uid] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[cs-members-v2] load', e); render(); });
  }
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter === 'at-risk') rows = rows.filter(atRisk);
    else if (V2.statusFilter !== 'all') rows = rows.filter(function (m) { return statusOf(m) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (m) {
        return memberName(m).toLowerCase().indexOf(q) >= 0 ||
               memberEmail(m).toLowerCase().indexOf(q) >= 0 ||
               planLabel(m).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('cs-members-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('csMembersV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'csMembersV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  // The program-settings summary card (clicking it goes straight to edit — the
  // wallet-v2 config-object pattern, mirrors membership-v2's settingsCard).
  function settingsCard() {
    var c = V2.config || {};
    var price = (c.annualPrice != null && c.annualPrice !== '') ? (N.money(Number(c.annualPrice)) + '/yr') : 'Not set';
    var rows = [
      { k: 'Program', v: esc(c.programName || 'Membership') },
      { k: 'Annual price', v: price }
    ];
    var body = rows.map(function (r) {
      return '<div class="mu-sub" style="display:flex;justify-content:space-between;gap:12px;"><span>' + esc(r.k) + '</span><span style="color:var(--text-primary);text-align:right;">' + r.v + '</span></div>';
    }).join('');
    var enabledBadge = U.badge(c.enabled ? 'Enabled' : 'Disabled', c.enabled ? 'success' : 'neutral');
    // Editing the program config is a write — gate the click-to-edit on edit
    // (cs-reviews-v2 precedent). View-only roles see a plain read card, no Edit lever.
    if (!canCs('edit')) {
      return U.card('Program settings', body, { headerRight: enabledBadge });
    }
    return U.launchCard({
      title: 'Program settings',
      body: body,
      onClickFnName: 'CsMembersV2.editProgram', arrow: 'Edit →',
      headerRight: enabledBadge
    });
  }

  function render() {
    var tab = ensureTab();
    var counts = { atRisk: 0, active: 0, cancelled: 0, expired: 0, paymentIssues: 0, renewingSoon: 0 };
    V2.rows.forEach(function (m) {
      var s = statusOf(m);
      if (counts[s] != null) counts[s]++;
      if (atRisk(m)) counts.atRisk++;
      if (paymentFailed(m)) counts.paymentIssues++;
      var d = daysUntil(renewsOf(m));
      if (s === 'active' && d != null && d >= 0 && d <= 30) counts.renewingSoon++;
    });

    // Slim KPI band (the CS lens) built from on-standard cards — active /
    // payment issues / renewing-in-30d, mirroring the legacy renderMembersAllActive.
    var kpis = U.cardGrid([
      U.card('Active members', '<div style="font-size:1.6rem;font-weight:600;color:var(--text-primary);">' + N.count(counts.active) + '</div><div style="font-size:0.78rem;color:var(--warm-gray);">current subscriptions</div>', { fill: true }),
      U.card('Payment issues', '<div style="font-size:1.6rem;font-weight:600;color:var(--text-primary);">' + N.count(counts.paymentIssues) + '</div><div style="font-size:0.78rem;color:var(--warm-gray);">failed payments</div>', { fill: true }),
      U.card('Renewing in 30d', '<div style="font-size:1.6rem;font-weight:600;color:var(--text-primary);">' + N.count(counts.renewingSoon) + '</div><div style="font-size:0.78rem;color:var(--warm-gray);">upcoming renewals</div>', { fill: true })
    ]);

    var filters = [
      ['all', 'All', V2.rows.length], ['at-risk', 'At risk', counts.atRisk],
      ['active', 'Active', counts.active], ['cancelled', 'Cancelled', counts.cancelled], ['expired', 'Expired', counts.expired]
    ].map(function (f) {
      var on = V2.statusFilter === f[0];
      return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="CsMembersV2.filter(\'' + f[0] + '\')">' + esc(f[1]) + ' (' + N.count(f[2]) + ')</button>';
    }).join(' ');

    tab.innerHTML =
      U.pageHeader({
        title: 'Members',
        count: N.count(V2.rows.length) + ' member' + (V2.rows.length === 1 ? '' : 's'),
        // Grant is a write — gate the affordance on edit (cs-reviews-v2 precedent).
        actionsHtml: (canCs('edit') ? '<button class="btn btn-primary" onclick="CsMembersV2.grant()">+ Grant</button>' : '') +
          '<button class="btn btn-secondary" onclick="CsMembersV2.exportCsv()">&darr; Export</button>'
      }) +
      kpis +
      '<div style="margin:12px 0;">' + settingsCard() + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:16px 0 12px;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search member, email or plan&hellip;" value="' + esc(V2.q) +
        '" oninput="CsMembersV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('cs-members-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CsMembersV2.sort', onRowClickFnName: 'CsMembersV2.open',
        empty: { title: 'No members', message: V2.loaded ? 'Use “+ Grant” to add a member by customer UID.' : 'Loading…' }
      });
  }

  // Delegate a member status action to the legacy write via MembershipBridge, then
  // refresh the page + the open slide-out. Guarded by V2.busy so a double-tap can't
  // fire two writes (membership-v2 act() / cs-reviews-v2 precedent).
  function act(action, uid) {
    if (V2.busy) return Promise.resolve();
    // Single write funnel → final RBAC backstop (revoke is destructive = delete;
    // grant/reactivate = edit). The shared MembershipBridge is intentionally left
    // ungated (membership-v2 gates on its own 'membership' route), so the gate
    // lives here in the cs-members twin (cs-reviews-v2 precedent).
    var axis = (action === 'revoke') ? 'delete' : 'edit';
    if (!canCs(axis)) { if (window.showToast) showToast('Membership ' + (axis === 'delete' ? 'delete' : 'write') + ' access required.', true); return Promise.resolve(); }
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
      // reloadSoon refreshes the derived rows from `customers`. (grant adds a NEW
      // member not yet in byId → no optimistic row; reloadSoon picks it up.)
      var row = V2.byId[uid];
      if (row) {
        if (action === 'revoke') row.status = 'expired';
        else if (action === 'reactivate') row.status = 'active';
      }
      render();
      if (row) MastEntity.openRecord('cs-members-v2', row, 'read');
      reloadSoon();
    }).catch(function (e) {
      V2.busy = false;
      console.error('[cs-members-v2] ' + action, e);
      if (window.showToast) showToast('Action failed: ' + (e && e.message || e), true);
    });
  }

  window.CsMembersV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'startDate' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('cs-members-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('cs-members-v2', rec, 'read');
      });
    },
    // Grant by customer UID — a single-field mastPrompt dialog (mirrors the legacy
    // grant modal's lone UID input) → MembershipBridge.grant. Standards-clean:
    // mastPrompt, never the native window dialog.
    grant: function () {
      if (!canCs('edit')) { if (window.showToast) showToast('Membership write access required.', true); return; }
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
      // Destructive → delete axis (cs-reviews-v2 precedent: revoke == the CS "delete").
      if (!canCs('delete')) { if (window.showToast) showToast('Membership delete access required.', true); return; }
      return Promise.resolve(
        (typeof mastConfirm === 'function')
          ? mastConfirm('Revoke this membership? The customer will lose all benefits immediately.', { title: 'Revoke Membership', danger: true })
          : true
      ).then(function (ok) { if (ok) return act('revoke', uid); });
    },
    reactivate: function (uid) {
      if (!canCs('edit')) { if (window.showToast) showToast('Membership write access required.', true); return; }
      return act('reactivate', uid);
    },
    // Program config → straight to edit (the settings card already IS the read
    // view). Single-sources the write through MembershipBridge.saveConfig.
    editProgram: function () {
      if (!canCs('edit')) { if (window.showToast) showToast('Membership write access required.', true); return; }
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('cart'); } catch (e) {} }
      Promise.resolve((window.MembershipBridge && MembershipBridge.getConfig) ? MembershipBridge.getConfig() : MastDB.get('admin/membership/config'))
        .then(function (c) {
          V2.config = Object.assign({ _cfgName: 'Program settings' }, V2.config || {}, c || {});
          MastEntity.openRecord('cs-members-config-v2', V2.config, 'edit');
        }).catch(function () {
          V2.config = V2.config || { _cfgName: 'Program settings' };
          MastEntity.openRecord('cs-members-config-v2', V2.config, 'edit');
        });
    },
    // Drill to the member's contact record (mirrors the legacy "View Contact").
    viewContact: function (email) {
      if (!email) return;
      if (typeof navigateTo === 'function') navigateTo('contacts', { email: email });
    },
    exportCsv: function () { return MastEntity.exportRows('cs-members-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('cs-members-v2', {
    routes: { 'cs-members-v2': { tab: 'csMembersV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
