/**
 * cs-members-v2.js — read-focused Faceted Record twin of the legacy
 * Customer-Service MEMBERS surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy customer-service.js (#cs-members, the "CS Members" tab) shows a
 * membership-health roster in two sub-tabs — "At Risk" (cancelled OR
 * failed-payment members) and "All Active" (active subscriptions, with a small
 * KPI band: active count, payment issues, renewing-in-30d). Each row carries a
 * "View Contact" button only; the surface is already read-only (no grant/revoke
 * here — that lives on the Membership admin). This twin re-hosts that VIEW on the
 * Entity Engine: a schema-driven list + a read-focused Faceted Record slide-out
 * (a single Overview facet). Flag-gated (?ui=1) at #cs-members-v2, side-by-side
 * with legacy #cs-members; it NEVER touches customer-service.js.
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
 * Read-focused: granting / revoking / reactivating a membership, and editing the
 * program config, stay single-sourced on legacy via a "manage in classic view"
 * link to the CS Members tab. This twin re-hosts the VIEW only — no onSave, no
 * edit form, no Grant/Revoke button.
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

        // Grant / revoke / reactivate + program config editing stay on the legacy
        // CS Members tab. Use navigateToClassic so the V2 route remap doesn't loop
        // us back to this twin.
        var manage = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary" onclick="CsMembersV2.classic()">Manage in classic view &rarr;</button>' +
          (memberEmail(m) ? '<button class="btn btn-secondary" onclick="CsMembersV2.viewContact(' + JSON.stringify(memberEmail(m)) + ')">View contact &rarr;</button>' : '') +
          '</div>';

        return tiles +
          UI.card('Membership', membership) +
          UI.card('Payment & risk', billing + manage);
      }
    }
    // No onSave → no Edit button (grant/revoke + config editing stay on legacy).
  });

  // ── module state + data ─────────────────────────────────────────────
  // statusFilter: 'all' | 'at-risk' | 'active' | 'cancelled' | 'expired'.
  // 'at-risk' is the legacy At-Risk lens (cancelled OR failed payment), not a
  // status value — handled in visibleRows().
  var V2 = { rows: [], byId: {}, sortKey: 'renews', sortDir: 'asc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Members are derived from `customers` (every customer with a `.membership`
    // sub-object). Bounded read (limitToLast) — no unbounded listener. Mirrors the
    // membership-v2 reader; the CS surface is a different lens over the same data.
    Promise.resolve(MastDB.query('customers').limitToLast(500).once()).then(function (snap) {
      // .once() resolves to the raw keyed object (with a non-enumerable .val());
      // accept either shape defensively.
      var custData = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      custData = custData || {};
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
        actionsHtml: '<button class="btn btn-secondary" onclick="CsMembersV2.exportCsv()">&darr; Export</button>'
      }) +
      kpis +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:16px 0 12px;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search member, email or plan&hellip;" value="' + esc(V2.q) +
        '" oninput="CsMembersV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('cs-members-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CsMembersV2.sort', onRowClickFnName: 'CsMembersV2.open',
        empty: { title: 'No members', message: V2.loaded ? 'Grant a membership in the classic Members view.' : 'Loading…' }
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
    // Grant/revoke + program config editing → classic CS Members view. Use
    // navigateToClassic so the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('cs-members');
      else if (typeof navigateTo === 'function') navigateTo('cs-members');
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
