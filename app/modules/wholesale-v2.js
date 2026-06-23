/**
 * wholesale-v2.js — read-focused Faceted Record twin of the legacy Wholesale
 * accounts surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy wholesale.js (#wholesale) hosts a 7-tab admin: a list of B2B accounts
 * with an inline card detail (renderWholesaleAccountDetail) plus Orders / AR
 * Aging / Cadence / Users / Requests / Dormant tooling. This twin re-hosts ONE
 * of those surfaces — the accounts list → read detail — on the Entity Engine:
 * a schema-driven list + a read-focused Faceted Record slide-out
 * (Overview / Contacts / Notes facets).
 *
 * Variant (doc 17 §1a): a wholesale account is a commercial-terms record (NET
 * terms, credit limit, MOQ rules, resale cert, sales rep, territory) with a few
 * related collections (contacts) but no governed lifecycle — its status
 * (active / on_hold / closed) is an assigned attribute → Faceted Record, NOT
 * Process/MastFlow.
 *
 * Create + edit are NATIVE here: a custom detail.editRender (the account field
 * set, grouped like the legacy modal) + an onSave that DELEGATES to
 * window.WholesaleBridge (exposed in wholesale.js) so the account write stays
 * single-sourced — this twin never reimplements that logic (mirrors the
 * contacts-v2 / ContactsBridge precedent).
 *
 * As of the AR/users conversion the remaining sub-tools are ALSO native facets,
 * so the classic escape hatch is GONE:
 *   • Orders — this account's wholesale orders; each # drills into the V2
 *     orders-v2 detail (MastEntity.drill, stacked slide-out), NOT classic.
 *   • AR aging — unpaid invoices bucketed by days overdue (read; derived from
 *     account NET terms + dueDate), each row drilling to its V2 order.
 *   • Cadence — reorder-frequency analytics derived from this account's orders
 *     (median interval, days-since-last, on-track/due-soon/overdue/lapsed).
 *   • Authorized buyers — who can order on this account (CRUD): authorize /
 *     unlink / revoke, RBAC-gated with can('wholesale','edit'|'delete') +
 *     writeAudit, single-sourced through WholesaleBridge.{authorizeUser,linkUser,
 *     revokeUser}. Pending access-requests are surfaced here with approve/deny
 *     (WholesaleBridge.{approveRequest,denyRequest}).
 * Flag-gated (?ui=1) at #wholesale-v2, side-by-side.
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

  // Label maps mirror wholesale.js (kept local — read-only display lookups).
  var NET_TERMS = { DUE_ON_RECEIPT: 'Due on receipt', NET_15: 'NET-15', NET_30: 'NET-30', NET_45: 'NET-45', NET_60: 'NET-60' };
  var ACCOUNT_TYPES = { retailer: 'Retailer / Boutique', gallery: 'Gallery', museum_store: 'Museum store', rep_agency: 'Sales rep agency', other: 'Other' };
  var PAYMENT_METHODS = { check: 'Check', card: 'Card', ach: 'ACH / bank transfer' };
  var STATUS_LABEL = { active: 'Active', on_hold: 'On hold', closed: 'Closed' };
  var STATUS_TONE = { active: 'success', on_hold: 'amber', closed: 'neutral' };

  // Option arrays for the native edit form — mirror wholesale.js WS_* tables
  // ({v,l} ordered) so the selects match the legacy modal exactly.
  var WS_NET_TERMS = [
    { v: 'DUE_ON_RECEIPT', l: 'Due on receipt' }, { v: 'NET_15', l: 'NET-15' },
    { v: 'NET_30', l: 'NET-30' }, { v: 'NET_45', l: 'NET-45' }, { v: 'NET_60', l: 'NET-60' }
  ];
  var WS_ACCOUNT_TYPES = [
    { v: 'retailer', l: 'Retailer / Boutique' }, { v: 'gallery', l: 'Gallery' },
    { v: 'museum_store', l: 'Museum store' }, { v: 'rep_agency', l: 'Sales rep agency' }, { v: 'other', l: 'Other' }
  ];
  var WS_PAYMENT_METHODS = [
    { v: 'check', l: 'Check' }, { v: 'card', l: 'Card' }, { v: 'ach', l: 'ACH / bank transfer' }
  ];
  var WS_ACCOUNT_STATUSES = [
    { v: 'active', l: 'Active' }, { v: 'on_hold', l: 'On hold' }, { v: 'closed', l: 'Closed' }
  ];

  function netLabel(a) { return NET_TERMS[a.netTerms] || '—'; }
  function typeLabel(a) { return ACCOUNT_TYPES[a.accountType] || ''; }
  function payLabel(a) { return PAYMENT_METHODS[a.paymentMethodDefault] || '—'; }
  function accountName(a) { return (a && a.name) || '(unnamed)'; }
  // "Retailer · Northeast · Rep: Jane" — the legacy list subline, for the Type column.
  function typeTerritory(a) {
    var t = typeLabel(a);
    return t + (t && a.territory ? ' · ' : '') + (a.territory || '') + (a.salesRepName ? ' · Rep: ' + a.salesRepName : '') || '—';
  }
  function contactsOf(a) { return a.contacts || (a.primaryContact ? [a.primaryContact] : []); }
  // relatedTable cell that drills into the V2 orders-v2 detail. Accepts either a
  // raw order (Orders facet) or an AR row { order } (AR-aging facet). The drill
  // lazy-loads orders-v2 + fetches the canonical order doc by id (no preload).
  function orderLink(row) {
    var o = (row && row.order) ? row.order : row;
    var id = o && (o._key || o.id);
    var label = (o && (o.orderNumber || (typeof getOrderDisplayNumber === 'function' ? getOrderDisplayNumber(o) : ''))) || String(id || '').slice(0, 8);
    if (!id) return '<span class="mu-sub">—</span>';
    return '<button type="button" class="mu-link" style="font-family:ui-monospace,monospace;" onclick="MastEntity.drill(\'orders-v2\',\'' + esc(String(id)) + '\')">' + esc(label) + '</button>';
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('wholesale-v2', {
    label: 'Wholesale account', labelPlural: 'Wholesale', size: 'lg',
    route: 'wholesale-v2',
    recordId: function (a) { return a._key || a.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'name', label: 'Account', type: 'text', list: true, required: true, group: 'Account', get: accountName },
      { name: 'typeTerritory', label: 'Type / territory', type: 'text', list: true, readOnly: true, sortable: false, get: typeTerritory },
      { name: 'creditLimit', label: 'Credit limit', type: 'money', list: true, readOnly: true, align: 'right',
        get: function (a) { return N.moneyVal(a, 'creditLimitCents', null); } },
      // Order rollups (computed from this account's wholesale orders at load).
      { name: 'ordersCount', label: 'Orders', type: 'number', list: true, readOnly: true, align: 'right',
        get: function (a) { return statsOf(a._key || a.id).count; } },
      { name: 'lifetime', label: 'Lifetime', type: 'money', list: true, readOnly: true, align: 'right',
        get: function (a) { return statsOf(a._key || a.id).lifetime || null; } },
      { name: 'lastOrderAt', label: 'Last order', type: 'date', list: true, readOnly: true,
        get: function (a) { var s = statsOf(a._key || a.id); return s.lastOrderAt ? new Date(s.lastOrderAt).toISOString() : (a.lastOrderAt || null); } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'on_hold', 'closed'],
        get: function (a) { return a.status || 'active'; },
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, a) {
        var aid = a._key || a.id;
        var s = statsOf(aid);
        var tiles = UI.tiles([
          { k: 'Lifetime value', v: (N.money(s.lifetime) || '$0.00'), hero: true },
          { k: '12-month', v: N.money(s.ltv12) || '$0.00' },
          { k: 'Orders', v: s.count + (s.count && s.lastOrderAt ? ' · last ' + N.date(new Date(s.lastOrderAt).toISOString()) : '') },
          { k: 'Open AR', v: s.openCount ? (N.money(s.openAr) + ' · ' + s.openCount + (s.overdueCount ? ' (' + s.overdueCount + ' overdue)' : '')) : 'None' },
          { k: 'Credit limit', v: N.money(N.moneyVal(a, 'creditLimitCents', null)) || '—' }
        ]);
        var acctUsers = V2.usersByAccount[aid] || [];
        var ar = arAging(a);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'orders', label: 'Orders (' + s.count + ')' },
          { key: 'ar', label: 'AR aging' + (ar.rows.length ? ' (' + ar.rows.length + ')' : '') },
          { key: 'cadence', label: 'Cadence' },
          { key: 'users', label: 'Users (' + acctUsers.length + ')' },
          { key: 'contacts', label: 'Contacts' }, { key: 'notes', label: 'Notes' }
        ], 'ov');

        // Overview — account + terms + credit + tax/resale.
        var account = UI.kv([
          { k: 'Status', v: UI.badge(STATUS_LABEL[a.status] || 'Active', STATUS_TONE[a.status] || 'neutral') },
          { k: 'Account type', v: esc(typeLabel(a) || '—') },
          { k: 'Territory', v: a.territory ? esc(a.territory) : '—' },
          { k: 'Sales rep', v: a.salesRepName ? esc(a.salesRepName) : '—' },
          { k: 'Added', v: a.createdAt ? N.date(a.createdAt) : '—' }
        ]);
        var terms = UI.kv([
          { k: 'Net terms', v: esc(netLabel(a)) },
          { k: 'Credit limit', v: N.money(N.moneyVal(a, 'creditLimitCents', null)) || '—' },
          { k: 'Opener minimum', v: N.money(N.moneyVal(a, 'minimumOpenerCents', null)) || '—' },
          { k: 'Reorder minimum', v: N.money(N.moneyVal(a, 'minimumReorderCents', null)) || '—' },
          { k: 'Default payment', v: esc(payLabel(a)) }
        ]);
        var taxResale = UI.kv([
          { k: 'Tax-exempt', v: (a.taxExempt !== false) ? 'Yes' : 'No' },
          { k: 'Resale cert', v: a.resaleCertNumber ? esc(a.resaleCertNumber) : '—' }
        ]);
        // Account create/edit is NATIVE (the Edit button on this slide-out).
        // Orders, AR aging, cadence, and authorized-users are all native facets
        // below — no classic escape hatch remains.

        // Contacts — primary + all contacts on file.
        var contacts = contactsOf(a);
        var contactsBody = contacts.length ? UI.relatedTable([
          { label: 'Name', render: function (c) { return esc(c.name || '—') + (c.role ? ' <span class="mu-sub">· ' + esc(c.role) + '</span>' : ''); } },
          { label: 'Email', render: function (c) { return c.email ? '<span class="mu-sub">' + esc(c.email) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'Phone', render: function (c) { return c.phone ? '<span class="mu-sub">' + esc(c.phone) + '</span>' : '<span class="mu-sub">—</span>'; } }
        ], contacts) : '<span class="mu-sub">No contacts on file.</span>';

        // Notes — operator notes + rep notes.
        var notesBody = (a.notes || a.repNotes)
          ? (a.notes ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(a.notes) + '</div>' : '') +
            (a.repNotes ? '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin:12px 0 6px;">Rep notes</div>' +
              '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(a.repNotes) + '</div>' : '')
          : '<span class="mu-sub">No notes.</span>';

        // Orders — this account's wholesale orders (newest first). Each order #
        // drills into the V2 orders-v2 detail (stacked slide-out with Back), NOT
        // classic — orders-v2.fetch reads the canonical order doc by id.
        var acctOrders = V2.ordersByAccount[aid] || [];
        var ordersBody = acctOrders.length ? UI.relatedTable([
          { label: 'Order', render: orderLink },
          { label: 'Placed', render: function (o) { var ms = orderTime(o); return ms ? N.date(new Date(ms).toISOString()) : '—'; } },
          { label: 'Status', render: function (o) { return UI.badge(String(o.status || '—').replace(/_/g, ' '), o.paidAt ? 'success' : 'amber'); } },
          { label: 'Invoice', render: function (o) {
              if (o.paidAt) return UI.badge('Paid', 'success');
              var st = (o.invoice && o.invoice.status) || (o.status === 'pending_check_verification' ? 'check pending' : 'unpaid');
              return UI.badge(st, st === 'overdue' ? 'danger' : 'amber');
            } },
          { label: 'Total', align: 'right', render: function (o) { return N.money(_wsOrderTotal(o)) || '—'; } }
        ], acctOrders) : '<span class="mu-sub">No orders yet from this account.</span>';
        var rec = reconcileCount(aid);
        var reconcileChip = rec ? '<div style="margin-top:10px;"><span style="font-size:0.78rem;font-weight:600;padding:4px 12px;border-radius:10px;background:color-mix(in srgb,var(--amber) 15%,transparent);color:var(--amber);border:1px solid color-mix(in srgb,var(--amber) 40%,transparent);">' +
          MastFormat.countNoun(rec, 'unlinked order') + ' match this account\'s buyers — link the buyer in the Users tab to attribute them.</span></div>' : '';

        // AR aging detail — unpaid invoices bucketed by days overdue, each row
        // drilling to its V2 order. Read-only (no RBAC gate; mirrors sibling
        // read facets).
        var arBuckets = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;margin-bottom:14px;">' +
          ar.buckets.map(function (b) {
            return '<div style="border:1px solid var(--border,rgba(127,127,127,.2));border-radius:8px;padding:10px;">' +
              '<div class="mu-sub" style="text-transform:uppercase;letter-spacing:0.04em;">' + esc(b.label) + '</div>' +
              '<div style="font-size:1.15rem;font-weight:700;margin-top:2px;">' + (N.money(b.total) || '$0.00') + '</div>' +
              '<div class="mu-sub">' + MastFormat.countNoun(b.count, 'order') + '</div>' +
            '</div>';
          }).join('') + '</div>';
        var arRowsBody = ar.rows.length ? UI.relatedTable([
          { label: 'Order', render: orderLink },
          { label: 'Due', render: function (r) { return r.dueMs ? N.date(new Date(r.dueMs).toISOString()) : '—'; } },
          { label: 'Days overdue', align: 'right', render: function (r) {
              if (r.daysOverdue <= 0) return '<span class="mu-sub">current</span>';
              var tone = r.daysOverdue <= 30 ? 'amber' : r.daysOverdue <= 90 ? 'warning' : 'danger';
              return UI.badge(r.daysOverdue + 'd', tone);
            } },
          { label: 'Total', align: 'right', render: function (r) { return N.money(r.total) || '—'; } }
        ], ar.rows) : '<span class="mu-sub">No unpaid wholesale orders. AR is clean.</span>';
        var arSummary = ar.rows.length ? '<div class="mu-sub" style="margin-bottom:10px;">Outstanding: <b>' + (N.money(ar.grand) || '$0.00') + '</b> across ' + MastFormat.countNoun(ar.rows.length, 'order') + '</div>' : '';

        // Cadence — reorder-frequency analytics derived from this account's orders.
        var cad = cadenceOf(a);
        var cadenceBody = UI.kv([
          { k: 'Order rhythm', v: UI.badge(CADENCE_LABEL[cad.status] || '—', CADENCE_TONE[cad.status] || 'neutral') +
              (cad.ratio != null ? ' <span class="mu-sub">· ' + cad.ratio.toFixed(2) + '× expected</span>' : '') },
          { k: 'Last order', v: cad.lastMs ? N.date(new Date(cad.lastMs).toISOString()) + (cad.daysSince != null ? ' <span class="mu-sub">· ' + cad.daysSince + 'd ago</span>' : '') : '<span class="mu-sub">Never</span>' },
          { k: 'Expected cadence', v: cad.effectiveInterval != null ? (cad.effectiveInterval + ' days <span class="mu-sub">· ' + (cad.intervalSource === 'learned' ? 'learned from order history' : 'default (too few orders to learn)') + '</span>') : '<span class="mu-sub">—</span>' },
          { k: 'Orders on record', v: N.count(cad.orderCount) }
        ]);
        var cadenceNote = '<div class="mu-sub" style="margin-top:10px;">Cadence is derived from this account\'s order history (median interval between orders). "Overdue"/"Lapsed" flag accounts that have gone well past their usual reorder rhythm — a reorder-outreach signal.</div>';

        // Users — authorized buyers who can order on this account (W2d). CRUD is
        // RBAC-gated: edit links, grant/revoke. Writes single-source through
        // WholesaleBridge so this twin never reimplements the DB shape.
        var mayEdit = canEdit(), mayDelete = canDelete();
        var usersBody = acctUsers.length ? UI.relatedTable([
          { label: 'Buyer', render: function (u) { return esc(u._email || u.email || '—') + (u.displayName ? ' <span class="mu-sub">· ' + esc(u.displayName) + '</span>' : ''); } },
          { label: 'Status', render: function (u) { return (u.active !== false) ? UI.badge('Active', 'success') : UI.badge('Revoked', 'neutral'); } },
          { label: 'Added', render: function (u) { return u.createdAt ? N.date(u.createdAt) : '<span class="mu-sub">—</span>'; } },
          { label: '', align: 'right', render: function (u) {
              if (u.active === false) return '<span class="mu-sub">—</span>';
              var btns = '';
              if (mayEdit) btns += '<button class="btn btn-secondary btn-small" style="padding:2px 8px;" onclick="WholesaleV2.unlinkUser(\'' + esc(aid) + '\',\'' + esc(u._key) + '\')" title="Remove from this account">Unlink</button> ';
              if (mayDelete) btns += '<button class="btn btn-secondary btn-small" style="padding:2px 8px;" onclick="WholesaleV2.revokeUser(\'' + esc(aid) + '\',\'' + esc(u._key) + '\')" title="Revoke wholesale access entirely">Revoke</button>';
              return btns || '<span class="mu-sub">—</span>';
            } }
        ], acctUsers) : '<span class="mu-sub">No authorized buyers on this account yet.</span>';
        // "Authorize buyer" prompts for an email and upserts the grant linked to
        // THIS account (re-linking a known buyer preserves their history). This
        // single action covers both granting a new buyer and linking an existing
        // unlinked one (just enter their email).
        var usersActions = mayEdit
          ? '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
              '<button class="btn btn-secondary btn-small" onclick="WholesaleV2.authorizeUser(\'' + esc(aid) + '\')">+ Authorize buyer</button>' +
              (V2.usersUnlinked.length ? '<span class="mu-sub">' + MastFormat.countNoun(V2.usersUnlinked.length, 'buyer') + ' authorized but not linked to any account — enter their email to attach.</span>' : '') +
            '</div>'
          : '<div class="mu-sub" style="margin-top:8px;">You don\'t have permission to manage authorized buyers.</div>';
        // Pending access requests (account-agnostic queue — buyers asking for
        // catalog access; approving links them to an account inline).
        var pendingReqs = (V2.requests || []).filter(function (r) { return (r.status || 'pending') === 'pending'; });
        var requestsBody = '';
        if (pendingReqs.length) {
          requestsBody = UI.relatedTable([
            { label: 'Requested by', render: function (r) { return esc(r.email || '—') + (r.displayName ? ' <span class="mu-sub">· ' + esc(r.displayName) + '</span>' : ''); } },
            { label: 'When', render: function (r) { return r.createdAt ? N.date(r.createdAt) : '<span class="mu-sub">—</span>'; } },
            { label: '', align: 'right', render: function (r) {
                if (!mayEdit) return '<span class="mu-sub">—</span>';
                return '<button class="btn btn-secondary btn-small" style="padding:2px 8px;" onclick="WholesaleV2.approveRequest(\'' + esc(r._id) + '\')">Approve</button> ' +
                  '<button class="btn btn-secondary btn-small" style="padding:2px 8px;" onclick="WholesaleV2.denyRequest(\'' + esc(r._id) + '\')">Deny</button>';
              } }
          ], pendingReqs);
        }
        var requestsCard = pendingReqs.length
          ? UI.cardTable('Pending access requests (' + pendingReqs.length + ')', requestsBody)
          : '';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Account', account) + UI.card('Terms & credit', terms) + UI.card('Tax & resale', taxResale) + '</div>' +
          '<div class="mu-pane" data-pane="orders" hidden>' + UI.cardTable('Orders (' + acctOrders.length + ')', ordersBody + reconcileChip) + '</div>' +
          '<div class="mu-pane" data-pane="ar" hidden>' + UI.cardTable('AR aging', arBuckets + arSummary + arRowsBody) + '</div>' +
          '<div class="mu-pane" data-pane="cadence" hidden>' + UI.card('Reorder cadence', cadenceBody + cadenceNote) + '</div>' +
          '<div class="mu-pane" data-pane="users" hidden>' + UI.cardTable('Authorized buyers (' + acctUsers.length + ')', usersBody + usersActions) + requestsCard + '</div>' +
          '<div class="mu-pane" data-pane="contacts" hidden>' + UI.cardTable('Contacts (' + contacts.length + ')', contactsBody) + '</div>' +
          '<div class="mu-pane" data-pane="notes" hidden>' + UI.card('Notes', notesBody) + '</div>';
      },
      // Native edit form — the legacy modal field set (openNewWholesaleAccountModal),
      // grouped. Mirrors saveWholesaleAccount inputs: name (required), account type,
      // status, NET terms, default payment, credit limit / opener min / reorder min
      // ($ → cents), sales rep, territory, resale cert, tax-exempt, notes.
      editRender: function (a, mode) {
        a = a || {};
        function sel(id, opts, selected) {
          var o = opts.map(function (x) { return '<option value="' + esc(x.v) + '"' + (x.v === selected ? ' selected' : '') + '>' + esc(x.l) + '</option>'; }).join('');
          return '<select class="form-input" id="' + id + '" style="width:100%;">' + o + '</select>';
        }
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row(parts) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + parts.join('') + '</div>'; }
        function dollars(cents) { return (cents || cents === 0) ? (cents / 100) : ''; }
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New wholesale account' : 'Edit this account') + '</div>' +
          fg('Account name *', '<input class="form-input" id="wsV2Name" value="' + esc(a.name || '') + '" style="width:100%;" placeholder="Coastal Home Boutique">') +
          row([
            fg('Type', sel('wsV2Type', WS_ACCOUNT_TYPES, a.accountType || 'retailer'), true),
            fg('Status', sel('wsV2Status', WS_ACCOUNT_STATUSES, a.status || 'active'), true)
          ]) +
          row([
            fg('NET terms', sel('wsV2NetTerms', WS_NET_TERMS, a.netTerms || 'NET_30'), true),
            fg('Default payment', sel('wsV2PaymentMethod', WS_PAYMENT_METHODS, a.paymentMethodDefault || 'check'), true)
          ]) +
          row([
            fg('Credit limit ($)', '<input class="form-input" type="number" min="0" step="1" id="wsV2CreditLimit" value="' + esc(dollars(a.creditLimitCents)) + '" style="width:100%;" placeholder="5000">', true),
            fg('Opener min ($)', '<input class="form-input" type="number" min="0" step="1" id="wsV2Opener" value="' + esc(dollars(a.minimumOpenerCents)) + '" style="width:100%;" placeholder="500">', true),
            fg('Reorder min ($)', '<input class="form-input" type="number" min="0" step="1" id="wsV2Reorder" value="' + esc(dollars(a.minimumReorderCents)) + '" style="width:100%;" placeholder="250">', true)
          ]) +
          row([
            fg('Sales rep', '<input class="form-input" id="wsV2Rep" value="' + esc(a.salesRepName || '') + '" style="width:100%;" placeholder="Jane Doe">', true),
            fg('Territory', '<input class="form-input" id="wsV2Territory" value="' + esc(a.territory || '') + '" style="width:100%;" placeholder="Northeast">', true)
          ]) +
          row([
            fg('Resale cert number', '<input class="form-input" id="wsV2ResaleCert" value="' + esc(a.resaleCertNumber || '') + '" style="width:100%;" placeholder="(optional)">', true),
            fg('Tax-exempt', '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;"><input id="wsV2TaxExempt" type="checkbox"' + (a.taxExempt !== false ? ' checked' : '') + '> Tax-exempt</label>', true)
          ]) +
          fg('Notes', '<textarea class="form-input" id="wsV2Notes" rows="2" style="width:100%;resize:vertical;">' + esc(a.notes || '') + '</textarea>');
      }
    },
    onSave: function (rec, mode) {
      if (!window.WholesaleBridge) { if (window.showToast) showToast('Wholesale engine still loading — try again', true); return false; }
      function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
      function toCents(id) {
        var v = (val(id) || '').trim();
        if (!v) return null;
        var n = parseFloat(v);
        return isNaN(n) ? null : Math.round(n * 100);
      }
      var name = (val('wsV2Name') || '').trim();
      if (!name) { if (window.showToast) showToast('Name is required', true); return false; }
      // Mirror the EXACT shape saveWholesaleAccount() builds.
      var data = {
        name: name,
        accountType: val('wsV2Type'),
        status: val('wsV2Status'),
        netTerms: val('wsV2NetTerms'),
        paymentMethodDefault: val('wsV2PaymentMethod'),
        creditLimitCents: toCents('wsV2CreditLimit'),
        minimumOpenerCents: toCents('wsV2Opener'),
        minimumReorderCents: toCents('wsV2Reorder'),
        salesRepName: (val('wsV2Rep') || '').trim() || null,
        territory: (val('wsV2Territory') || '').trim() || null,
        resaleCertNumber: (val('wsV2ResaleCert') || '').trim() || null,
        taxExempt: !!(document.getElementById('wsV2TaxExempt') || {}).checked,
        notes: (val('wsV2Notes') || '').trim() || null
      };
      if (mode === 'create') {
        return Promise.resolve(window.WholesaleBridge.create(data)).then(function () {
          if (window.showToast) showToast('Account created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[wholesale-v2] create', e); if (window.showToast) showToast('Error saving account.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.WholesaleBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        Object.assign(V2.byId[id] || rec, data);
        if (window.showToast) showToast('Account updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[wholesale-v2] update', e); if (window.showToast) showToast('Error updating account.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'all', loaded: false,
    ordersByAccount: {}, authorizedEmails: {},
    // W2d/W2c parity: full authorized-user records keyed by account, plus
    // pending access requests, so the Users + Requests facets are native.
    usersByAccount: {}, usersUnlinked: [], requests: [] };

  // Email ⇄ Firebase key (mirror wholesale.js wsEmailToKey / wsKeyToEmail).
  function wsEmailToKey(email) { return email ? String(email).toLowerCase().replace(/\./g, ',') : ''; }
  function wsKeyToEmail(key) { return key ? String(key).replace(/,/g, '.') : ''; }
  function canEdit() { return typeof window.can === 'function' ? window.can('wholesale', 'edit') : true; }
  function canDelete() { return typeof window.can === 'function' ? window.can('wholesale', 'delete') : true; }

  // Per-account order rollup (W2.9 parity with the legacy account detail):
  // lifetime + 12-month LTV, order count, open AR (unpaid), last order.
  function _wsOrderTotal(o) {
    if (typeof o.total === 'number') return o.total;
    if (typeof o.totalCents === 'number') return o.totalCents / 100;
    return 0;
  }
  function orderTime(o) {
    var t = o.placedAt || o.createdAt;
    return t ? (typeof t === 'number' ? t : new Date(t).getTime()) : 0;
  }
  function statsOf(accountId) {
    var orders = V2.ordersByAccount[accountId] || [];
    var oneYearAgo = Date.now() - 365 * 86400000;
    var s = { count: orders.length, lifetime: 0, ltv12: 0, openAr: 0, openCount: 0, overdueCount: 0, lastOrderAt: null };
    orders.forEach(function (o) {
      var t = _wsOrderTotal(o);
      s.lifetime += t;
      var ms = orderTime(o);
      if (ms >= oneYearAgo) s.ltv12 += t;
      if (ms && (!s.lastOrderAt || ms > s.lastOrderAt)) s.lastOrderAt = ms;
      if (!o.paidAt && String(o.status || '') !== 'cancelled') {
        s.openAr += t; s.openCount++;
        if (o.invoice && o.invoice.status === 'overdue') s.overdueCount++;
      }
    });
    return s;
  }
  // ── AR aging (W2.8 parity) ─────────────────────────────────────────
  // dueDate semantics mirror wholesale.js _wsOrderDueMs: explicit dueDate wins,
  // else placedAt/createdAt + account NET terms (DUE_ON_RECEIPT → 0 days).
  function netTermsDays(code) {
    if (!code) return 30;
    if (code === 'DUE_ON_RECEIPT') return 0;
    var m = /^NET_(\d+)$/.exec(String(code));
    return m ? parseInt(m[1], 10) : 30;
  }
  function orderDueMs(o, account) {
    if (!o) return null;
    if (o.dueDate) { var d = new Date(o.dueDate); if (!isNaN(d.getTime())) return d.getTime(); }
    var placed = o.placedAt || o.createdAt;
    if (!placed) return null;
    var placedMs = (typeof placed === 'number') ? placed : new Date(placed).getTime();
    if (isNaN(placedMs)) return null;
    var terms = (o.paymentTerms_days != null) ? o.paymentTerms_days : netTermsDays(account && account.netTerms);
    return placedMs + (terms * 86400000);
  }
  // Aging buckets for one account's unpaid (non-cancelled) orders.
  function arAging(account) {
    var aid = account._key || account.id;
    var orders = V2.ordersByAccount[aid] || [];
    var nowMs = Date.now();
    var buckets = [
      { key: 'current', label: 'Current', count: 0, total: 0 },
      { key: 'b1_30', label: '1–30 days', count: 0, total: 0 },
      { key: 'b31_60', label: '31–60 days', count: 0, total: 0 },
      { key: 'b61_90', label: '61–90 days', count: 0, total: 0 },
      { key: 'b90plus', label: '90+ days', count: 0, total: 0 }
    ];
    var rows = [];
    orders.forEach(function (o) {
      if (o.paidAt || String(o.status || '') === 'cancelled') return;
      var dueMs = orderDueMs(o, account);
      if (dueMs == null) return;
      var daysOverdue = Math.floor((nowMs - dueMs) / 86400000);
      var total = _wsOrderTotal(o);
      var bi = daysOverdue <= 0 ? 0 : daysOverdue <= 30 ? 1 : daysOverdue <= 60 ? 2 : daysOverdue <= 90 ? 3 : 4;
      buckets[bi].count++; buckets[bi].total += total;
      rows.push({ order: o, daysOverdue: daysOverdue, total: total, dueMs: dueMs });
    });
    rows.sort(function (a, b) { return b.daysOverdue - a.daysOverdue; });
    var grand = buckets.reduce(function (s, b) { return s + b.total; }, 0);
    return { buckets: buckets, rows: rows, grand: grand };
  }

  // ── Cadence (W2.5 parity, account-scoped) ──────────────────────────
  // Derived from THIS account's orders: median reorder interval, days since
  // last order, and an overdue classification against learned/default cadence.
  var WS_CADENCE = { dueSoonMultiplier: 0.9, overdueMultiplier: 1.25, lapsedMultiplier: 2.0, defaultIntervalDays: 90 };
  function medianIntervalDays(timestampsMs) {
    if (!timestampsMs || timestampsMs.length < 2) return null;
    var sorted = timestampsMs.slice().sort(function (a, b) { return a - b; });
    var iv = [];
    for (var i = 1; i < sorted.length; i++) iv.push(sorted[i] - sorted[i - 1]);
    iv.sort(function (a, b) { return a - b; });
    var mid = Math.floor(iv.length / 2);
    var medianMs = iv.length % 2 === 0 ? (iv[mid - 1] + iv[mid]) / 2 : iv[mid];
    return Math.max(1, Math.round(medianMs / 86400000));
  }
  function classifyCadence(daysSince, intervalDays) {
    if (daysSince == null || !intervalDays || intervalDays <= 0) return { status: 'unknown', ratio: null };
    var ratio = Math.round((daysSince / intervalDays) * 100) / 100;
    if (ratio >= WS_CADENCE.lapsedMultiplier) return { status: 'lapsed', ratio: ratio };
    if (ratio >= WS_CADENCE.overdueMultiplier) return { status: 'overdue', ratio: ratio };
    if (ratio >= WS_CADENCE.dueSoonMultiplier) return { status: 'due-soon', ratio: ratio };
    return { status: 'on-track', ratio: ratio };
  }
  var CADENCE_LABEL = { 'on-track': 'On track', 'due-soon': 'Due soon', overdue: 'Overdue', lapsed: 'Lapsed', unknown: 'No history' };
  var CADENCE_TONE = { 'on-track': 'success', 'due-soon': 'amber', overdue: 'danger', lapsed: 'danger', unknown: 'neutral' };
  function cadenceOf(account) {
    var aid = account._key || account.id;
    var orders = (V2.ordersByAccount[aid] || []).filter(function (o) { return String(o.status || '') !== 'cancelled'; });
    var ts = orders.map(orderTime).filter(function (m) { return m > 0; }).sort(function (a, b) { return a - b; });
    var lastMs = ts.length ? ts[ts.length - 1] : null;
    var daysSince = lastMs ? Math.floor((Date.now() - lastMs) / 86400000) : null;
    var learned = medianIntervalDays(ts);
    var effective = learned != null ? learned : WS_CADENCE.defaultIntervalDays;
    var cls = classifyCadence(daysSince, daysSince != null ? effective : null);
    return {
      orderCount: orders.length, lastMs: lastMs, daysSince: daysSince,
      learnedInterval: learned, effectiveInterval: daysSince != null ? effective : null,
      intervalSource: learned != null ? 'learned' : (daysSince != null ? 'default' : null),
      status: cls.status, ratio: cls.ratio
    };
  }

  // Reconcile candidates: unlinked orders whose buyer email matches one of this
  // account's authorized users (same best-effort rule as the legacy detail).
  function reconcileCount(accountId) {
    var emails = V2.authorizedEmails[accountId];
    if (!emails) return 0;
    var n = 0;
    (V2.ordersByAccount.__unlinked || []).forEach(function (o) {
      var em = (o.buyerEmail || o.email || '').toLowerCase();
      if (em && emails[em]) n++;
    });
    return n;
  }

  function load() {
    Promise.all([
      MastDB.wholesaleAccounts.list(500),
      // Same source as legacy #wholesale: wholesale orders live at admin/orders
      // (type=wholesale), linked via o.wholesaleAccountId.
      MastDB.query('admin/orders').orderByChild('type').equalTo('wholesale').limitToLast(500).once('value'),
      Promise.resolve(MastDB.get('admin/wholesaleAuthorized')).catch(function () { return null; }),
      // Pending access requests (W2c parity) — buyers asking for catalog access.
      Promise.resolve(MastDB.get('admin/wholesaleRequests')).catch(function () { return null; })
    ]).then(function (results) { applyLoad(results); render(); })
      .catch(function (e) { console.error('[wholesale-v2] load', e); render(); });
  }
  // Process the Promise.all([accounts, orders, authorized, requests]) results
  // into V2 state. Shared by load() and reloadThenOpen() so both stay in sync.
  function applyLoad(results) {
    var snap = results[0];
    var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
    var ordersVal = (results[1] && typeof results[1].val === 'function') ? results[1].val() : results[1];
    var out = [];
    Object.keys(val || {}).forEach(function (k) {
      var a = val[k];
      if (a && typeof a === 'object') { a = Object.assign({ _key: k }, a); a.status = a.status || 'active'; out.push(a); }
    });
    V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
    // Index orders by account (plus the unlinked pool for the reconcile chip).
    var byAcct = { __unlinked: [] };
    Object.keys(ordersVal || {}).forEach(function (k) {
      var o = ordersVal[k]; if (!o || typeof o !== 'object') return;
      o = Object.assign({ _key: k }, o);
      if (o.wholesaleAccountId && o.wholesaleAccountId !== 'direct_retail') {
        (byAcct[o.wholesaleAccountId] = byAcct[o.wholesaleAccountId] || []).push(o);
      } else if (!o.wholesaleAccountId) byAcct.__unlinked.push(o);
    });
    Object.keys(byAcct).forEach(function (k) { if (k !== '__unlinked') byAcct[k].sort(function (a, b) { return orderTime(b) - orderTime(a); }); });
    V2.ordersByAccount = byAcct;
    // Authorized users — full records, indexed by account (W2d). The auth key
    // is the email with '.'→','; legacy records may carry an explicit `email`
    // field but we derive it from the key when absent (older grants).
    var auth = results[2] || {};
    var emails = {};                  // accountId → { lowercaseEmail: true } (reconcile rule)
    var usersByAccount = {};          // accountId → [user record]
    var usersUnlinked = [];           // grants with no wholesaleAccountId
    Object.keys(auth || {}).forEach(function (k) {
      var u = auth[k]; if (!u || typeof u !== 'object') return;
      var email = (u.email || wsKeyToEmail(k) || '').toLowerCase();
      var rec = Object.assign({ _key: k, _email: email }, u);
      if (u.wholesaleAccountId) {
        (usersByAccount[u.wholesaleAccountId] = usersByAccount[u.wholesaleAccountId] || []).push(rec);
        if (email) (emails[u.wholesaleAccountId] = emails[u.wholesaleAccountId] || {})[email] = true;
      } else {
        usersUnlinked.push(rec);
      }
    });
    V2.authorizedEmails = emails;
    V2.usersByAccount = usersByAccount;
    V2.usersUnlinked = usersUnlinked;
    // Access requests — newest first.
    var reqVal = results[3] || {};
    var reqs = Object.keys(reqVal || {}).map(function (k) { var r = reqVal[k] || {}; return Object.assign({ _id: k }, r); })
      .sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    V2.requests = reqs;
    V2.loaded = true;
  }
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh
  // Reload data then re-open the SAME account slide-out (mirrors vendors-v2's
  // reloadThenOpenVendor) — so a user/request write reflects in the open panel.
  function reloadThenOpen(accountId) {
    V2.loaded = false;
    return new Promise(function (resolve) {
      setTimeout(function () {
        Promise.all([
          MastDB.wholesaleAccounts.list(500),
          MastDB.query('admin/orders').orderByChild('type').equalTo('wholesale').limitToLast(500).once('value'),
          Promise.resolve(MastDB.get('admin/wholesaleAuthorized')).catch(function () { return null; }),
          Promise.resolve(MastDB.get('admin/wholesaleRequests')).catch(function () { return null; })
        ]).then(function (r) { applyLoad(r); var rec = V2.byId[accountId]; if (rec) MastEntity.openRecord('wholesale-v2', rec, 'read'); resolve(); })
          .catch(function (e) { console.error('[wholesale-v2] reloadThenOpen', e); resolve(); });
      }, 250);
    });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (a) { return (a.status || 'active') === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (a) {
        return String(a.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(a.territory || '').toLowerCase().indexOf(q) >= 0 ||
               String(a.salesRepName || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('wholesale-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('wholesaleV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'wholesaleV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['active', 'Active'], ['on_hold', 'On hold'], ['closed', 'Closed']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="WholesaleV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Wholesale',
        count: N.count(V2.rows.length) + ' account' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-primary" onclick="WholesaleV2.create()">+ New account</button>' +
          '<button class="btn btn-secondary" onclick="WholesaleV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, territory or rep…" value="' + esc(V2.q) +
        '" oninput="WholesaleV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('wholesale-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'WholesaleV2.sort', onRowClickFnName: 'WholesaleV2.open',
        empty: { title: 'No wholesale accounts', message: V2.loaded ? 'Add a boutique, gallery or rep agency to get started.' : 'Loading…' }
      });
  }

  window.WholesaleV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'creditLimit' || key === 'lastOrderAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('wholesale-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('wholesale-v2', rec, 'read');
      });
    },
    create: function () {
      MastEntity.openRecord('wholesale-v2', {}, 'create');
    },
    // ── Authorized-user CRUD (W2d) — RBAC-gated, single-sourced via WholesaleBridge ──
    authorizeUser: function (accountId) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to do that.', true); return; }
      if (!window.WholesaleBridge) { if (window.showToast) showToast('Wholesale engine still loading — try again', true); return; }
      if (typeof window.mastPrompt !== 'function') { if (window.showToast) showToast('Dialog unavailable — try again', true); return; }
      Promise.resolve(window.mastPrompt('Buyer email to authorize on this account', { title: 'Authorize buyer', placeholder: 'buyer@example.com', confirmLabel: 'Authorize' })).then(function (raw) {
        var email = (raw || '').trim().toLowerCase();
        if (!email) return;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (window.showToast) showToast('Invalid email address', true); return; }
        Promise.resolve(window.WholesaleBridge.authorizeUser(email, accountId)).then(function () {
          if (window.writeAudit) writeAudit('wholesale.authorize_user', 'wholesaleAuthorized', wsEmailToKey(email));
          if (window.showToast) showToast('Authorized ' + email);
          reloadThenOpen(accountId);
        }).catch(function (e) { console.error('[wholesale-v2] authorizeUser', e); if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
      });
    },
    unlinkUser: function (accountId, emailKey) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to do that.', true); return; }
      if (!window.WholesaleBridge) { if (window.showToast) showToast('Wholesale engine still loading — try again', true); return; }
      var go = function () {
        Promise.resolve(window.WholesaleBridge.linkUser(emailKey, null)).then(function () {
          if (window.writeAudit) writeAudit('wholesale.unlink_user', 'wholesaleAuthorized', emailKey);
          if (window.showToast) showToast('Buyer unlinked from this account (access kept).');
          reloadThenOpen(accountId);
        }).catch(function (e) { console.error('[wholesale-v2] unlinkUser', e); if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
      };
      if (typeof window.mastConfirm === 'function') Promise.resolve(window.mastConfirm('Unlink ' + wsKeyToEmail(emailKey) + ' from this account? Their wholesale access is kept (just no longer tied to this account).', { title: 'Unlink buyer' })).then(function (ok) { if (ok) go(); });
      else go();
    },
    revokeUser: function (accountId, emailKey) {
      if (!canDelete()) { if (window.showToast) showToast('You don\'t have permission to do that.', true); return; }
      if (!window.WholesaleBridge) { if (window.showToast) showToast('Wholesale engine still loading — try again', true); return; }
      var go = function () {
        Promise.resolve(window.WholesaleBridge.revokeUser(emailKey)).then(function () {
          if (window.writeAudit) writeAudit('wholesale.revoke_user', 'wholesaleAuthorized', emailKey);
          if (window.showToast) showToast('Wholesale access revoked for ' + wsKeyToEmail(emailKey));
          reloadThenOpen(accountId);
        }).catch(function (e) { console.error('[wholesale-v2] revokeUser', e); if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
      };
      if (typeof window.mastConfirm === 'function') Promise.resolve(window.mastConfirm('Revoke wholesale access for ' + wsKeyToEmail(emailKey) + '? They will no longer be able to order.', { title: 'Revoke access', danger: true })).then(function (ok) { if (ok) go(); });
      else go();
    },
    // ── Access-request approvals (W2c) — RBAC-gated, single-sourced ──
    approveRequest: function (requestId) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to do that.', true); return; }
      if (!window.WholesaleBridge) { if (window.showToast) showToast('Wholesale engine still loading — try again', true); return; }
      var req = (V2.requests || []).filter(function (r) { return r._id === requestId; })[0];
      if (!req) { if (window.showToast) showToast('Request not found', true); return; }
      var cur = (window.MastEntity && MastEntity.getCurrent) ? MastEntity.getCurrent() : null;
      var openAid = (cur && cur.key === 'wholesale-v2' && cur.record) ? (cur.record._key || cur.record.id) : null;
      Promise.resolve(window.WholesaleBridge.approveRequest(requestId, req)).then(function () {
        if (window.writeAudit) writeAudit('wholesale.approve_request', 'wholesaleRequests', requestId);
        if (window.showToast) showToast('Approved — ' + req.email + ' now has wholesale access.');
        if (openAid) reloadThenOpen(openAid); else reloadSoon();
      }).catch(function (e) { console.error('[wholesale-v2] approveRequest', e); if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
    },
    denyRequest: function (requestId) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to do that.', true); return; }
      if (!window.WholesaleBridge) { if (window.showToast) showToast('Wholesale engine still loading — try again', true); return; }
      var cur = (window.MastEntity && MastEntity.getCurrent) ? MastEntity.getCurrent() : null;
      var openAid = (cur && cur.key === 'wholesale-v2' && cur.record) ? (cur.record._key || cur.record.id) : null;
      var go = function () {
        Promise.resolve(window.WholesaleBridge.denyRequest(requestId)).then(function () {
          if (window.writeAudit) writeAudit('wholesale.deny_request', 'wholesaleRequests', requestId);
          if (window.showToast) showToast('Request denied.');
          if (openAid) reloadThenOpen(openAid); else reloadSoon();
        }).catch(function (e) { console.error('[wholesale-v2] denyRequest', e); if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
      };
      if (typeof window.mastConfirm === 'function') Promise.resolve(window.mastConfirm('Deny this wholesale access request?', { title: 'Deny request' })).then(function (ok) { if (ok) go(); });
      else go();
    },
    // Account create/edit + archiving, this account's orders (drill to orders-v2),
    // AR aging, cadence, and authorized-buyer CRUD + access requests are ALL
    // native here. No classic escape hatch remains.
    exportCsv: function () { return MastEntity.exportRows('wholesale-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('wholesale-v2', {
    routes: {
      'wholesale-v2': { tab: 'wholesaleV2Tab', setup: function () { ensureTab(); render(); load(); } },
      // Legacy #wholesale route ABSORBED (T6): wholesale.js is deleted, so the twin
      // owns the bare route directly (no MAST_V2_ROUTE_MAP remap). The write path
      // (window.WholesaleBridge) lives in the non-flag-gated IIFE appended below.
      'wholesale': { tab: 'wholesaleV2Tab', setup: function () { ensureTab(); render(); load(); } }
    }
  });
})();


// ============================================================================
// ABSORBED FROM wholesale.js (V1) — T6 retirement (absorb-first cut).
//
// wholesale-v2 is the sole wholesale surface; the V1 wholesale.js UI is deleted.
// This self-contained, NON-flag-gated IIFE re-hosts — VERBATIM (byte-identical) —
// window.WholesaleBridge, the write path wholesale-v2 single-sources through
// (create/update accounts + grantUser/authorizeUser/linkUser/revokeUser +
// approveRequest/denyRequest), plus its one helper wsEmailToKey (the email→
// Firebase-key normalization). References only shell globals (MastDB / Date).
// Not flag-gated: the bridge must exist for the wholesale-v2 native actions
// regardless of the UI-redesign flag.
// ============================================================================
(function () {
  'use strict';

  function wsEmailToKey(email) {
    if (!email) return '';
    return email.toLowerCase().replace(/\./g, ',');
  }

  window.WholesaleBridge = {
    create: async function (data) {
      var now = new Date().toISOString();
      var rec = Object.assign({}, data, { createdAt: now, updatedAt: now });
      var id = MastDB.wholesaleAccounts.newKey();
      await MastDB.wholesaleAccounts.set(id, rec);
      return id;
    },
    update: async function (id, data) {
      var rec = Object.assign({}, data, { updatedAt: new Date().toISOString() });
      await MastDB.wholesaleAccounts.update(id, rec);
      return id;
    },
    // ── Authorized-user ↔ account linkage (W2d) ──
    // Single-source the admin/wholesaleAuthorized writes the legacy
    // saveWholesaleUserLink / revokeWholesaleRequest handlers make, parameterized
    // so the wholesale-v2 twin can grant / link / revoke without re-implementing
    // the email→key normalization or the write shape. The twin RBAC-gates these.
    // emailKey is the email with '.'→',' (the Firebase key) — wsEmailToKey.
    grantUser: async function (email, accountId) {
      var key = wsEmailToKey((email || '').trim().toLowerCase());
      if (!key) throw new Error('email required');
      await MastDB.set('admin/wholesaleAuthorized/' + key, {
        active: true,
        createdAt: new Date().toISOString(),
        wholesaleAccountId: accountId || null
      });
      return key;
    },
    // Upsert: if a grant already exists for this email, re-link it (preserving
    // createdAt / approvedFrom) and re-activate; otherwise create a fresh grant.
    // Used by the wholesale-v2 "Authorize buyer" action so re-authorizing a known
    // buyer doesn't clobber their history.
    authorizeUser: async function (email, accountId) {
      var key = wsEmailToKey((email || '').trim().toLowerCase());
      if (!key) throw new Error('email required');
      var existing = null;
      try { existing = await MastDB.get('admin/wholesaleAuthorized/' + key); } catch (_e) {}
      if (existing && typeof existing === 'object') {
        await MastDB.update('admin/wholesaleAuthorized/' + key, {
          wholesaleAccountId: accountId || null,
          active: true,
          updatedAt: new Date().toISOString()
        });
      } else {
        await MastDB.set('admin/wholesaleAuthorized/' + key, {
          active: true,
          createdAt: new Date().toISOString(),
          wholesaleAccountId: accountId || null
        });
      }
      return key;
    },
    linkUser: async function (emailKey, accountId) {
      if (!emailKey) throw new Error('emailKey required');
      // update (not set) so createdAt / approvedFrom / displayName survive.
      await MastDB.update('admin/wholesaleAuthorized/' + emailKey, {
        wholesaleAccountId: accountId || null,
        updatedAt: new Date().toISOString()
      });
      return emailKey;
    },
    revokeUser: async function (emailKey) {
      if (!emailKey) throw new Error('emailKey required');
      await MastDB.update('admin/wholesaleAuthorized/' + emailKey, { active: false });
      return emailKey;
    },
    // ── Access-request approvals (W2c) ──
    // Mirror approveWholesaleRequest / denyWholesaleRequest exactly (one atomic
    // multiUpdate). `req` is the request record (carries email + displayName).
    approveRequest: async function (requestId, req) {
      if (!requestId || !req || !req.email) throw new Error('request required');
      var key = wsEmailToKey(req.email);
      var updates = {};
      updates['admin/wholesaleAuthorized/' + key] = {
        active: true,
        displayName: req.displayName || '',
        approvedFrom: requestId,
        createdAt: new Date().toISOString()
      };
      updates['admin/wholesaleRequests/' + requestId + '/status'] = 'approved';
      updates['admin/wholesaleRequests/' + requestId + '/resolvedAt'] = new Date().toISOString();
      await MastDB.multiUpdate(updates);
      return key;
    },
    denyRequest: async function (requestId) {
      if (!requestId) throw new Error('requestId required');
      var updates = {};
      updates['admin/wholesaleRequests/' + requestId + '/status'] = 'denied';
      updates['admin/wholesaleRequests/' + requestId + '/resolvedAt'] = new Date().toISOString();
      await MastDB.multiUpdate(updates);
      return requestId;
    }
  };
})();
