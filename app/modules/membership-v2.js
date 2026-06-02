/**
 * membership-v2.js — read-focused Faceted Record twin of the legacy Membership
 * MEMBERS list (doc 17 §11/§12; conversion playbook).
 *
 * Legacy cart.js (#membership, owned by the Cart/Storefront module) hosts the
 * Membership admin: a program config block (program name, annual price, discount
 * tiers, free-shipping, loyalty multiplier, Stripe wiring) PLUS a members table
 * (renderMembershipAdmin → the "Members (N)" list with Grant / Revoke / Reactivate).
 * This twin re-hosts ONE of those surfaces — the MEMBERS list to read detail — on
 * the Entity Engine: a schema-driven list and a read-focused Faceted Record
 * slide-out (a single Overview facet). The membership CONFIG / plan settings stay
 * on legacy (that surface is not converted here).
 *
 * Variant (doc 17 §1a): a member is a person + plan + status + since-date record.
 * Its status (active / cancelled / expired) is an assigned attribute with no
 * governed lifecycle (a manual Grant/Revoke flips it; there is no MastFlow phase
 * machine) — so a Faceted Record, NOT Process/MastFlow.
 *
 * Read-focused: granting / revoking / reactivating a membership and editing the
 * program config (price, discount tiers, Stripe product, promo stacking) all stay
 * single-sourced on legacy #membership via a "manage in classic view" link. This
 * twin re-hosts the VIEW only — no onSave, no edit form, no Grant button.
 * Flag-gated (?ui=1) at #membership-v2, side-by-side; never touches cart.js.
 *
 * Data (mirrors cart.js loadMembershipAdmin exactly): members are DERIVED from the
 * top-level `customers` collection — every customer whose record carries a
 * `membership` sub-object is a member. The row is that sub-object merged with the
 * customer id (_uid) and a resolved email. Member fields on `c.membership`:
 *   status ('active'|'cancelled'|'expired'), plan (the tier, e.g. 'manual-grant'),
 *   startDate (joined), renewalDate / expiryDate (renews), processor, paymentStatus.
 * The program config (programName, annualPrice) is one cheap one-shot read at
 * admin/membership/config — used only for read context (price + program label);
 * it is NOT the members and stays editable on legacy.
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

  // ── schema (read-only Faceted Record) ───────────────────────────────
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

        // Grant / revoke / reactivate + program config editing stay on legacy
        // #membership. Use navigateToClassic so the V2 route remap doesn't loop
        // us back to this twin.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="MembershipV2.classic()">Manage in classic view &rarr;</button></div>';

        return tiles +
          UI.card('Membership', membership) +
          UI.card('Billing', billing + manage);
      }
    }
    // No onSave → no Edit button (granting/editing stays on legacy #membership).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, config: null, sortKey: 'startDate', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Members are derived from `customers` (every customer with a `.membership`
    // sub-object); the program config is a separate cheap one-shot read used for
    // read-only billing context. Both loaded together; bounded (limitToLast).
    Promise.all([
      Promise.resolve(MastDB.query('customers').limitToLast(500).once()).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/membership/config')).catch(function () { return null; })
    ]).then(function (res) {
      // .once() resolves to the raw keyed object (with a non-enumerable .val());
      // accept either shape defensively (matches the wholesale-v2 reader).
      var snap = res[0];
      var custData = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      custData = custData || {};
      V2.config = res[1] || {};
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
        title: 'Members',
        count: N.count(V2.rows.length) + ' member' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-secondary" onclick="MembershipV2.exportCsv()">&darr; Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search member or plan&hellip;" value="' + esc(V2.q) +
        '" oninput="MembershipV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('membership-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'MembershipV2.sort', onRowClickFnName: 'MembershipV2.open',
        empty: { title: 'No members', message: V2.loaded ? 'Grant a membership in the classic Membership view.' : 'Loading…' }
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
    // Grant/revoke + program config editing → classic Membership view. Use
    // navigateToClassic so the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('membership');
      else if (typeof navigateTo === 'function') navigateTo('membership');
    },
    exportCsv: function () { return MastEntity.exportRows('membership-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('membership-v2', {
    routes: { 'membership-v2': { tab: 'membershipV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
