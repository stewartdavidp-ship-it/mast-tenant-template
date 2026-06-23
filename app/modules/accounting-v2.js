/**
 * accounting-v2.js — QBO accounting surface, V2 (QBO-1 of the QuickBooks→V2 conversion).
 *
 * A flag-gated (?ui=1) twin of the four QBO sub-views that legacy accounting.js
 * renders into Settings → Integrations → QuickBooks (#qboPanelBody): Connection
 * summary, COA Map, Sync Log, Conflicts — plus the bulk-backfill row and the
 * bank-feed collision banner. Ported to the V2 engine (MastUI badge/list/card/kv
 * + the `U` primitives) for visual parity with the rest of the redesign.
 *
 * THIS IS A FINANCIAL-DATA SURFACE. The bar (per QBO-1 brief):
 *   - Reuse the existing QBO Cloud Functions VERBATIM — the CFs are the single
 *     source for every QBO write. No new bridge, no new write path. The twin
 *     calls the same callables with the same envelopes V1 uses.
 *   - PRESERVE EVERY GATE exactly:
 *       • Backfill 3 gates (itemBridge.ready / no pending bank-feed collisions /
 *         qbo.allowBackfill kill-switch) — re-derived here for the disabled-state
 *         UI, AND the actual start delegates to the loaded V1 `_qboStartBackfill`
 *         which re-checks server-side (startQboHistoricalBackfill blockedBy).
 *       • COA required-field gate (COA_REQUIRED) — ported verbatim into the V2
 *         save handler before it calls setQboMapping.
 *       • Closed-period block — surfaced as the `blocked-closed-period` Sync Log
 *         status chip, same as V1 (the block itself lives server-side).
 *   - Gate mutating UI actions on can('integrations','edit') + writeAudit each.
 *   - FREEZE the finance.js cross-module contract: window.__qboConflicts,
 *     _qboFindConflict, _qboPreloadConflicts, openQboConflictModal, triggerQboPush
 *     / _firTriggerQboPush stay defined in V1 accounting.js (still loaded). This
 *     module NEVER redefines or shadows them — for conflict resolve / backfill /
 *     retry / collision-ack / default-sales-item it DELEGATES to the loaded V1
 *     globals, so the one write path and its modals are unchanged.
 *
 * V1 stays the live default; this twin renders only when ?ui=1 is present.
 * Cutover (route the QuickBooks tab here unconditionally) is a later PR (QBO-3).
 */
(function () {
  'use strict';
  function flagOn() {
    // V1-default-preserving gate: ONLY an explicit ?ui=1 (or a prior ?ui=1 that
    // persisted the flag) opts in. We deliberately do NOT treat the boot-seeded
    // mastUiRedesign='1' default as "on" here — the QBO tab's live default must
    // stay V1 until the QBO-3 cutover. So the persisted flag check is gated
    // behind having seen ?ui=1 at least once in this browser.
    try {
      if (/[?&#]ui=1\b/.test(location.href)) {
        localStorage.setItem('mastUiRedesign', '1');
        localStorage.setItem('mastQboV2OptIn', '1');
        return true;
      }
      if (localStorage.getItem('mastQboV2OptIn') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastUI) return;

  var U = window.MastUI, esc = U._esc;

  // Webhook URL is one-per-Intuit-App (NOT per-tenant) — same constant V1 uses.
  // Intuit routes every realm's events to this single URL; the CF reverse-looks-up
  // the tenant via platform_qboRealmIndex/{realmId}. Operator pastes it into the
  // Intuit Developer Portal once; verifier token lives in Secret Manager. Kept
  // reachable in this Connection sub-view per QBO-3 scope (operator config — not a
  // per-tenant connect concern, but operators need the URL).
  var QBO_WEBHOOK_URL = 'https://us-central1-mast-platform-prod.cloudfunctions.net/qboWebhook';

  // ── Same Mast→QBO category map + required-field gate as V1 (kept in lockstep;
  //    these are the ratified D-ACC-2/3 concepts). If V1 changes them, this twin
  //    must follow — they are the contract the setQboMapping CF validates against. ──
  var COA_CATEGORIES = [
    { key: 'cash', label: 'Cash on Hand', section: 'Assets' },
    { key: 'revenue_dtc', label: 'Revenue · Direct to Consumer (DTC)', section: 'Revenue' },
    { key: 'revenue_wholesale', label: 'Revenue · Wholesale', section: 'Revenue' },
    { key: 'revenue_gallery', label: 'Revenue · Gallery / Consignment', section: 'Revenue' },
    { key: 'cogs', label: 'Cost of Goods Sold', section: 'COGS' },
    { key: 'gallery_commission', label: 'Gallery Commission Expense', section: 'COGS' },
    { key: 'expense_materials', label: 'Expense · Materials & Supplies', section: 'Expenses' },
    { key: 'expense_studio', label: 'Expense · Studio (rent, utilities)', section: 'Expenses' },
    { key: 'expense_equipment', label: 'Expense · Equipment', section: 'Expenses' },
    { key: 'expense_shipping', label: 'Expense · Shipping & Packaging', section: 'Expenses' },
    { key: 'expense_marketing', label: 'Expense · Marketing', section: 'Expenses' },
    { key: 'expense_software', label: 'Expense · Software & Subscriptions', section: 'Expenses' },
    { key: 'expense_travel', label: 'Expense · Travel & Shows', section: 'Expenses' },
    { key: 'expense_professional', label: 'Expense · Professional Services', section: 'Expenses' },
    { key: 'expense_fees', label: 'Expense · Bank & Processing Fees', section: 'Expenses' },
    { key: 'expense_other', label: 'Expense · Other', section: 'Expenses' },
    { key: 'sales_tax_payable', label: 'Sales Tax Payable', section: 'Liabilities' }
  ];
  // Required for save — PORTED VERBATIM from accounting.js. This is the COA gate.
  var COA_REQUIRED = ['cash', 'revenue_dtc', 'revenue_wholesale', 'revenue_gallery', 'cogs', 'sales_tax_payable',
                      'expense_materials', 'expense_studio', 'expense_shipping'];

  // ── helpers ──
  function tenantId() {
    return (typeof MastDB !== 'undefined' && MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID || '';
  }
  function toastOk(msg) { if (typeof showToast === 'function') showToast(msg); else console.log('[accounting-v2]', msg); }
  function toastErr(msg) { if (typeof showToast === 'function') showToast(msg, true); else console.error('[accounting-v2]', msg); }
  function canEdit() { return typeof window.can === 'function' ? window.can('integrations', 'edit') : true; }
  function audit(action, detail) {
    try { if (typeof window.writeAudit === 'function') window.writeAudit(action, 'qbo', tenantId(), detail || {}); } catch (e) {}
  }
  function panelBody() { return document.getElementById('qboPanelBody'); }
  function callable(name) { return firebase.functions().httpsCallable(name); }
  function tsFmt(t) {
    if (!t) return '—';
    var d = (typeof t === 'number') ? new Date(t) : new Date(t);
    if (isNaN(d.getTime())) return String(t);
    return d.toLocaleString();
  }
  function rel(iso) {
    if (!iso) return 'never';
    var ms = (typeof iso === 'number') ? iso : Date.parse(iso);
    if (!isFinite(ms)) return 'never';
    var d = (Date.now() - ms) / 60000;
    if (d < 1) return 'just now';
    if (d < 60) return Math.round(d) + ' min ago';
    if (d < 1440) return Math.round(d / 60) + 'h ago';
    return Math.round(d / 1440) + 'd ago';
  }
  function truncate(s, n) { s = (s == null) ? '' : String(s); return s.length <= n ? s : s.substring(0, n) + '…'; }

  // ── Canonical entry — render a sub-view into #qboPanelBody (V2 twin of
  //    window.renderQboPanel). switchQboInnerTab calls this when ?ui=1. ──
  function renderQboPanelV2(subView) {
    subView = subView || window.__qboInnerActiveTab || 'connection';
    window.__qboInnerActiveTab = subView;
    var body = panelBody();
    if (!body) return;
    if (subView === 'map') renderCoaMapView(body);
    else if (subView === 'log') renderSyncLogView(body);
    else if (subView === 'conflicts') renderConflictsView(body);
    else renderConnectView(body);
  }
  window.renderQboPanelV2 = renderQboPanelV2;

  // ── shared loading/empty/not-connected fragments ──
  function loadingHtml(label) {
    return '<div style="color:var(--warm-gray);font-size:0.9rem;padding:24px 0;">' + esc(label || 'Loading…') + '</div>';
  }
  function notConnectedCard(message, ctaHtml) {
    return U.card('QuickBooks not connected',
      '<p style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;margin:0 0 12px;">' + esc(message) + '</p>' +
      (ctaHtml || ''));
  }

  // QBO-3: the Connections board (Settings → Channels) is the canonical connect /
  // disconnect surface. This sub-view shows a read-only status summary and links
  // back to that board instead of hosting standalone Connect/Disconnect buttons.
  // switchSettingsSubView('channels') renders the board (renderConnectionsBoard),
  // where the QBO card owns connect/disconnect/status.
  function manageInConnectionsLink(label) {
    return '<button class="btn btn-secondary" onclick="window.AccountingV2.openConnectionsBoard()">' +
      esc(label || 'Manage connection in Connections') + ' →</button>';
  }

  // ════════════════════════ Connection sub-view ════════════════════════
  function renderConnectView(body) {
    body.innerHTML = loadingHtml();
    Promise.all([
      MastDB.get('admin/integrations/qbo'),
      MastDB.get('admin/integrations/_meta').catch(function () { return null; }),
      MastDB.get('admin/integrations/qboMapping').catch(function () { return null; })
    ]).then(function (results) {
      var doc = results[0];
      var meta = results[1] || {};
      var mapping = results[2] || {};
      // Same window stash V1 uses so the shared _renderBackfillRow gate logic
      // (which we re-derive below) reads the same source.
      window.__qboMappingCache = mapping;
      var connected = doc && doc.realmId && !doc.disconnectedAt && (doc.status !== 'disconnected');
      var html = collisionBanner(meta);
      if (connected) {
        html += connectedCard(doc) + webhookCard(meta) + backfillRow(doc, meta) + connectionActions();
      } else {
        // QBO-3: the Connections board owns connect/disconnect. This sub-view no
        // longer hosts a standalone Connect button — it deep-links to the board card.
        html += notConnectedCard(
          'QuickBooks Online isn\'t connected yet. Connect it from the Connections board — you authorize once on Intuit, then return here to map your chart of accounts on the COA Map tab. Once mapping is saved, every day close, wholesale invoice, vendor bill, and reviewed expense syncs automatically to QBO.',
          manageInConnectionsLink('Connect in Connections'));
      }
      body.innerHTML = html;
    }).catch(function (err) {
      body.innerHTML = U.card('Connection',
        '<div style="color:var(--danger);font-size:0.85rem;">Failed to load connection state: ' + esc(err && err.message) + '</div>');
    });
  }

  function connectedCard(doc) {
    var env = doc.env || 'sandbox';
    var realmShort = String(doc.realmId).slice(0, 8) + '…';
    var connectedAt = doc.connectedAt ? tsFmt(doc.connectedAt) : '—';
    var countdown = reconnectCountdownBadge(doc);
    var rows = U.kv([
      { k: 'Status', v: U.badge('Connected', 'success') + (countdown ? ' ' + countdown : '') },
      { k: 'Environment', v: esc(env) },
      { k: 'Realm', v: '<code style="font-size:0.78rem;">' + esc(realmShort) + '</code>' },
      { k: 'Since', v: esc(connectedAt) }
    ]);
    var note = '<p style="color:var(--warm-gray);font-size:0.85rem;line-height:1.5;margin:12px 0 0;">' +
      'Next steps: confirm your COA Map tab is set up, then check the Sync Log tab after writing a Day Close or wholesale invoice to verify your first sync.' +
    '</p>';
    return U.card('QuickBooks connection', rows + note);
  }

  // Webhook (real-time pull) section — one-per-Intuit-App operator config. Status
  // pill from _meta.lastWebhookAt with the same fresh/stale bands V1 used (<30d
  // green, 30-90d amber, >90d red), the copyable webhook URL, and the operator
  // note. The Copy action reuses the loaded V1 window._qboCopyWebhookUrl util.
  // Kept reachable here per QBO-3 scope (operators need the URL to register in the
  // Intuit Developer Portal); verifier token is platform-wide so no paste field.
  function webhookCard(meta) {
    var lastWebhookAt = meta && meta.lastWebhookAt ? meta.lastWebhookAt : null;
    var tone, label, ageLine;
    if (!lastWebhookAt) {
      tone = 'danger'; label = 'Not registered';
      ageLine = 'No webhook events received yet. Register the URL below in the Intuit Developer Portal to enable real-time pulls.';
    } else {
      var lastMs = (typeof lastWebhookAt === 'number') ? lastWebhookAt : Date.parse(lastWebhookAt);
      var ageDays = isFinite(lastMs) ? Math.floor((Date.now() - lastMs) / 86400000) : 999;
      if (ageDays < 30) { tone = 'success'; label = 'Registered'; }
      else if (ageDays < 90) { tone = 'warning'; label = 'Stale'; }
      else { tone = 'danger'; label = 'Stale (' + ageDays + 'd)'; }
      ageLine = 'Last webhook event: ' + tsFmt(lastMs) + '.';
    }
    var copyBtn = '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" ' +
      'onclick="window._qboCopyWebhookUrl && window._qboCopyWebhookUrl()">Copy URL</button>';
    var inner =
      '<div style="font-size:0.78rem;color:var(--warm-gray);line-height:1.4;margin-bottom:8px;">' + esc(ageLine) + '</div>' +
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">' +
        '<code style="font-size:0.78rem;background:var(--border,rgba(127,127,127,0.12));padding:4px 8px;border-radius:4px;color:var(--text-primary);word-break:break-all;flex:1;min-width:0;">' + esc(QBO_WEBHOOK_URL) + '</code>' +
        copyBtn +
      '</div>' +
      '<div style="font-size:0.72rem;color:var(--warm-gray);line-height:1.4;">' +
        esc('Register this URL in Intuit Developer Portal → Webhooks for your app. Verifier token is managed centrally — no paste step needed.') +
      '</div>';
    return U.card('Webhook (real-time pull)', inner, { headerRight: U.badge(label, tone) });
  }

  // Countdown badge — same daysUntilReconnect math + tier thresholds as V1's
  // _renderReconnectCountdownChip (100d idle, 30d amber, 7d red), rendered via
  // MastUI.badge tones for engine parity.
  function reconnectCountdownBadge(doc) {
    if (!doc) return '';
    var IDLE_DAYS = 100, AMBER = 30, RED = 7;
    var lastUsedAt = doc.lastUsedAt || doc.refreshedAt || doc.connectedAt;
    if (!lastUsedAt) return '';
    var lastMs = (typeof lastUsedAt === 'number') ? lastUsedAt : Date.parse(lastUsedAt);
    if (!isFinite(lastMs)) return '';
    var idleDays = (Date.now() - lastMs) / 86400000;
    var days = Math.max(0, Math.floor(IDLE_DAYS - idleDays));
    var tone, label;
    if (days > AMBER) { tone = 'success'; label = days + 'd until reconnect'; }
    else if (days > RED) { tone = 'warning'; label = days + 'd until reconnect'; }
    else { tone = 'danger'; label = days === 0 ? 'Reconnect required' : (days + 'd until reconnect'); }
    return U.badge(label, tone);
  }

  // QBO-3: connect/disconnect moved to the Connections board card. This row keeps
  // only the operational collision-check action and a deep-link to the board for
  // connection management (disconnect lives there now). The "Check for collisions"
  // button is a sync-hygiene action, NOT a connect/disconnect control, so it stays.
  function connectionActions() {
    var manageLink = '<div style="margin-top:16px;font-size:0.85rem;color:var(--warm-gray);line-height:1.5;">' +
      'Connect or disconnect QuickBooks from the Connections board.' +
      '<div style="margin-top:8px;">' + manageInConnectionsLink('Manage connection in Connections') + '</div>' +
    '</div>';
    if (!canEdit()) return manageLink;
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="window.AccountingV2.checkCollisions()">Check for collisions</button>' +
    '</div>' + manageLink;
  }

  // Bank-feed collision banner — reads _meta.bankFeedCollisions[] pending-ack,
  // same source + acknowledge action as V1 (delegates the ack write to V1's
  // _qboAckCollision, which is the single write path for the flip).
  function collisionBanner(meta) {
    var collisions = (meta && Array.isArray(meta.bankFeedCollisions)) ? meta.bankFeedCollisions : [];
    var pending = collisions.filter(function (c) { return c && c.status === 'pending-ack'; });
    if (pending.length === 0) return '';
    var rows = pending.map(function (c, idx) {
      var name = c.accountName || c.accountId || '(unnamed bank account)';
      var when = c.detectedAt ? tsFmt(c.detectedAt) : '';
      var ackBtn = canEdit()
        ? '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="window.AccountingV2.ackCollision(\'' + esc(c.accountId || String(idx)) + '\')">Acknowledge</button>'
        : '';
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border,rgba(127,127,127,0.12));">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">' + esc(name) + '</div>' +
          (when ? '<div style="font-size:0.72rem;color:var(--warm-gray);">' + esc('Detected ' + when) + '</div>' : '') +
        '</div>' + ackBtn +
      '</div>';
    }).join('');
    return U.card(
      MastFormat.countNoun(pending.length, 'bank-feed collision') + ' detected',
      '<div style="font-size:0.78rem;color:var(--warm-gray);line-height:1.4;margin-bottom:8px;">' +
        esc('One or more QBO bank accounts share a routing/last-4 with a Plaid-connected account. Acknowledging marks the collision reviewed; it does not auto-resolve the duplicate-feed risk.') +
      '</div>' + rows,
      { headerRight: U.badge('Action needed', 'danger') });
  }

  // ── Bulk backfill row — THE 3 GATES, re-derived for the disabled-state UI
  //    exactly as V1's _renderBackfillRow:
  //      1. qboMapping.itemBridge.ready === true
  //      2. _meta.bankFeedCollisions has no pending-ack
  //      3. qbo.allowBackfill === true  (operator kill-switch)
  //    The actual start delegates to V1 window._qboStartBackfill, which calls
  //    startQboHistoricalBackfill (server re-checks all three → blockedBy). ──
  function backfillRow(doc, meta) {
    var mapping = window.__qboMappingCache || {};
    var itemBridgeReady = mapping.itemBridge && mapping.itemBridge.ready === true;
    var pendingCollisions = (meta && Array.isArray(meta.bankFeedCollisions))
      ? meta.bankFeedCollisions.filter(function (c) { return c && c.status === 'pending-ack'; }).length
      : 0;
    var allowBackfill = doc && doc.allowBackfill === true;
    var disabled = false, reason = '';
    if (!itemBridgeReady) { disabled = true; reason = 'Set the Default Sales Item on the COA Map tab first'; }
    else if (pendingCollisions > 0) { disabled = true; reason = 'Acknowledge ' + MastFormat.countNoun(pendingCollisions, 'pending bank-feed collision') + ' above first'; }
    else if (!allowBackfill) { disabled = true; reason = 'Enable Backfill in admin/integrations/qbo.allowBackfill (operator-set kill switch)'; }
    if (!canEdit()) { disabled = true; reason = reason || 'You don\'t have permission to run a backfill'; }

    var btn = disabled
      ? '<button class="btn btn-primary" style="font-size:0.85rem;opacity:0.55;" disabled title="' + esc(reason) + '">Start backfill…</button>'
      : '<button class="btn btn-primary" style="font-size:0.85rem;" title="Pull historical invoices, bills, payments from QBO" onclick="window.AccountingV2.startBackfill()">Start backfill…</button>';
    var inner =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);max-width:60ch;">Pull last 90 days of invoices, bills, payments, estimates from QuickBooks into Mast.</div>' +
        btn +
      '</div>' +
      (disabled && reason ? '<div style="font-size:0.72rem;color:var(--warning, var(--warm-gray));margin-top:8px;">' + esc(reason) + '</div>' : '');
    return U.card('Bulk backfill historical data', inner);
  }

  // ════════════════════════ COA Map sub-view ════════════════════════
  function renderCoaMapView(body) {
    body.innerHTML = loadingHtml('Loading QuickBooks chart of accounts…');
    var tid = tenantId();
    if (!tid) { body.innerHTML = U.card('COA Map', '<div style="color:var(--danger);">Tenant ID not resolved.</div>'); return; }

    Promise.all([
      callable('fetchQboChart')({ tenantId: tid }),
      callable('getQboMapping')({ tenantId: tid })
    ]).then(function (results) {
      var accounts = (results[0] && results[0].data && results[0].data.accounts) || [];
      var mappingDoc = (results[1] && results[1].data) || {};
      var savedMapping = (mappingDoc && mappingDoc.mapping) || null;
      // Preserve saved selections; leave gaps blank (V1 fuzzy auto-suggest is a
      // convenience the operator still re-confirms before save — the required-
      // field gate is the actual contract, so we keep parity on the gate, not
      // on the heuristic pre-fill).
      var mapping = {};
      COA_CATEGORIES.forEach(function (cat) {
        if (savedMapping && savedMapping[cat.key]) mapping[cat.key] = savedMapping[cat.key];
      });
      renderCoaMapTable(body, accounts, mapping, mappingDoc);
    }).catch(function (err) {
      var msg = (err && err.message) || String(err);
      if (/unauth|not.*connect|no.*token|invalid.*token/i.test(msg)) {
        body.innerHTML = notConnectedCard('Connect first, then return to map your categories.',
          '<button class="btn btn-primary" onclick="switchQboInnerTab(\'connection\')">Go to Connection</button>');
      } else {
        body.innerHTML = U.card('COA Map', '<div style="color:var(--danger);font-size:0.85rem;">Failed to load: ' + esc(msg) + '</div>');
      }
    });
  }

  function renderCoaMapTable(body, accounts, mapping, mappingDoc) {
    // Group active accounts by AccountType for grouped <optgroup>, same order V1 uses.
    var byType = {};
    accounts.forEach(function (a) {
      if (a.Active === false) return;
      var t = a.AccountType || 'Other';
      (byType[t] = byType[t] || []).push(a);
    });
    Object.keys(byType).forEach(function (t) {
      byType[t].sort(function (a, b) {
        return String(a.FullyQualifiedName || a.Name || '').localeCompare(String(b.FullyQualifiedName || b.Name || ''));
      });
    });
    var typeOrder = ['Income', 'Cost of Goods Sold', 'Expense', 'Other Current Liability', 'Other Current Asset', 'Bank', 'Credit Card', 'Long Term Liability', 'Equity', 'Other'];
    var allTypes = Object.keys(byType).sort(function (a, b) {
      var ai = typeOrder.indexOf(a); var bi = typeOrder.indexOf(b);
      if (ai < 0) ai = 999; if (bi < 0) bi = 999;
      return ai - bi;
    });
    function optionsHtml(currentId) {
      var h = '<option value="">— Select QBO account —</option>';
      allTypes.forEach(function (t) {
        h += '<optgroup label="' + esc(t) + '">';
        byType[t].forEach(function (a) {
          var label = a.FullyQualifiedName || a.Name || a.Id;
          var sel = (String(a.Id) === String(currentId)) ? ' selected' : '';
          h += '<option value="' + esc(a.Id) + '"' + sel + '>' + esc(label) + '</option>';
        });
        h += '</optgroup>';
      });
      return h;
    }

    var hasSaved = !!(mappingDoc && mappingDoc.confirmedAt);
    var disabledAttr = canEdit() ? '' : ' disabled';
    var rows = '', section = null;
    COA_CATEGORIES.forEach(function (cat) {
      if (cat.section !== section) {
        section = cat.section;
        rows += '<tr><td colspan="2" class="qbo-section-header">' + esc(section) + '</td></tr>';
      }
      var required = COA_REQUIRED.indexOf(cat.key) >= 0;
      rows +=
        '<tr>' +
          '<td style="width:42%;">' + esc(cat.label) + (required ? ' <span style="color:var(--danger);font-size:0.72rem;" aria-label="required">*</span>' : '') + '</td>' +
          '<td><select class="qbo-map-select-v2 qbo-select" data-mast-key="' + esc(cat.key) + '"' + disabledAttr + '>' + optionsHtml(mapping[cat.key] || '') + '</select></td>' +
        '</tr>';
    });

    // Configuration: Default Sales Item (item bridge). Saved out-of-band via V1's
    // _qboPickDefaultSalesItem (single write path for itemBridge).
    var itemBridge = (mappingDoc && mappingDoc.itemBridge) || {};
    var defaultItemId = itemBridge.defaultSalesItemId || '';
    var defaultItemName = itemBridge.defaultSalesItemName || '';
    var itemReady = itemBridge.ready === true;
    rows += '<tr><td colspan="2" class="qbo-section-header">Configuration</td></tr>';
    rows +=
      '<tr>' +
        '<td style="width:42%;">Default Sales Item <span style="color:var(--danger);font-size:0.72rem;" aria-label="required">*</span>' +
          '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:2px;line-height:1.3;">Used when a Mast product has no QBO Item mapping yet.</div>' +
        '</td>' +
        '<td><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
          '<span style="font-size:0.85rem;color:var(--text-primary);min-width:120px;">' +
            (defaultItemId ? esc(defaultItemName || ('Item ' + defaultItemId)) : '<span style="color:var(--warm-gray);">Not set</span>') +
          '</span>' +
          (canEdit() ? '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="window.AccountingV2.pickDefaultSalesItem()">Browse QBO Items</button>' : '') +
          (itemReady ? ' ' + U.badge('ready', 'success') : '') +
        '</div></td>' +
      '</tr>';

    var lastSaved = hasSaved
      ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:12px;">Last saved: ' + esc(tsFmt(mappingDoc.confirmedAt)) + (mappingDoc.confirmedBy ? ' by ' + esc(mappingDoc.confirmedBy) : '') + '</div>'
      : '';
    var unsaved = hasSaved ? '' :
      '<div style="margin:0 0 16px;">' + U.badge('Unsaved', 'warning') +
        ' <span style="font-size:0.85rem;color:var(--text-primary);margin-left:6px;">Set a QBO account for each category, then click Save mapping below.</span></div>';
    var saveBtn = canEdit()
      ? '<button id="qboMapSaveBtnV2" class="btn btn-primary" onclick="window.AccountingV2.saveMapping()">' + (hasSaved ? 'Save changes' : 'Save mapping') + '</button>'
      : '<div style="font-size:0.78rem;color:var(--warm-gray);">You don\'t have permission to edit the COA mapping.</div>';

    var tableInner =
      '<p style="color:var(--warm-gray);font-size:0.85rem;line-height:1.5;margin:0 0 12px;">' +
        (hasSaved ? 'Your QBO account mappings. Editing these affects future syncs only; existing QBO entries are unchanged.'
                  : 'Map each Mast category to a QBO account so syncs post to the right places.') +
      '</p>' + lastSaved +
      '<div style="overflow-x:auto;"><table class="qbo-table"><thead><tr><th>Mast Category</th><th>QBO Account</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div style="margin-top:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' + saveBtn +
        '<span id="qboMapStatusV2" style="font-size:0.85rem;color:var(--warm-gray);"></span></div>';

    body.innerHTML = unsaved + U.card('Chart of accounts mapping', tableInner);
  }

  // COA save — REUSES the setQboMapping CF verbatim, with the COA_REQUIRED gate
  // ported verbatim from V1 _qboSaveMapping. Gated on can('integrations','edit')
  // + writeAudit on success.
  function saveMapping() {
    if (!canEdit()) { toastErr('You don\'t have permission to edit the COA mapping.'); return; }
    var btn = document.getElementById('qboMapSaveBtnV2');
    var status = document.getElementById('qboMapStatusV2');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Saving…';
    var selects = document.querySelectorAll('select.qbo-map-select-v2');
    var mapping = {};
    var missingRequired = [];
    selects.forEach(function (sel) {
      var k = sel.getAttribute('data-mast-key');
      var v = sel.value;
      if (v) mapping[k] = v;
      else if (COA_REQUIRED.indexOf(k) >= 0) missingRequired.push(k);
    });
    if (missingRequired.length > 0) {
      if (status) status.innerHTML = '<span style="color:var(--danger);">Missing required: ' + esc(missingRequired.join(', ')) + '</span>';
      if (btn) btn.disabled = false;
      return;
    }
    callable('setQboMapping')({ tenantId: tenantId(), mapping: mapping }).then(function () {
      audit('qbo.mapping.save', { categories: Object.keys(mapping).length });
      if (status) status.innerHTML = '<span style="color:var(--success, var(--warm-gray));">Saved.</span>';
      toastOk('COA mapping saved');
      setTimeout(function () { var b = panelBody(); if (b) renderCoaMapView(b); }, 600);
    }).catch(function (err) {
      if (status) status.innerHTML = '<span style="color:var(--danger);">Save failed: ' + esc(err && err.message) + '</span>';
      toastErr('Save failed: ' + (err && err.message));
      if (btn) btn.disabled = false;
    });
  }

  // ════════════════════════ Sync Log sub-view ════════════════════════
  var SYNC_LOG_PAGE_SIZE = 50;
  var _log = { rows: [], filterStatus: 'all', filterEntity: 'all', filterDirection: 'all', filterFrom: '', filterTo: '', hasMore: true, fetchedLimit: 0 };

  function renderSyncLogView(body) {
    _log = { rows: [], filterStatus: 'all', filterEntity: 'all', filterDirection: 'all', filterFrom: '', filterTo: '', hasMore: true, fetchedLimit: 0 };
    body.innerHTML =
      '<p style="color:var(--warm-gray);font-size:0.85rem;line-height:1.5;margin:0 0 12px;">' +
        'Every push to QuickBooks creates a row here. The log fills automatically when you write a Day Close, wholesale invoice, vendor bill, or reviewed expense. Failed pushes show a Retry button. Pull receipts (webhook / polling / backfill) also land here.' +
      '</p>' +
      '<div id="qboLogPollChipV2" style="margin-bottom:10px;"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;font-size:0.85rem;">' +
        '<label>Status: <select id="qboLogFilterStatusV2" class="qbo-select" style="width:auto;">' +
          ['all|All', 'queued|Queued', 'in-flight|In flight', 'success|Success', 'failed|Failed', 'blocked-closed-period|Blocked (closed period)', 'orphaned|Orphaned']
            .map(function (o) { var p = o.split('|'); return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('') +
        '</select></label>' +
        '<label>Entity: <select id="qboLogFilterEntityV2" class="qbo-select" style="width:auto;">' +
          ['all|All', 'expense|Expense', 'wholesaleInvoice|Wholesale Invoice', 'apBill|AP Bill', 'dayClose|Day Close']
            .map(function (o) { var p = o.split('|'); return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('') +
        '</select></label>' +
        '<label>Direction: <select id="qboLogFilterDirectionV2" class="qbo-select" style="width:auto;">' +
          '<option value="all">All</option><option value="push">Push only</option><option value="pull">Pull only</option>' +
        '</select></label>' +
        '<label>From: <input type="date" id="qboLogFilterFromV2" class="qbo-select" style="width:auto;"></label>' +
        '<label>To: <input type="date" id="qboLogFilterToV2" class="qbo-select" style="width:auto;"></label>' +
        '<button class="btn btn-secondary" onclick="window.AccountingV2.applyLogFilters()">Apply</button>' +
      '</div>' +
      '<div id="qboLogTableWrapV2">' + loadingHtml('Loading sync log…') + '</div>' +
      '<div id="qboLogMoreWrapV2" style="margin-top:12px;text-align:center;"></div>';
    loadPollChip();
    loadSyncLogPage();
  }

  // "Last poll / Last webhook" chip — reads _meta.lastPollAt / .lastWebhookAt
  // with the same fresh/stale bands V1 uses.
  function loadPollChip() {
    var wrap = document.getElementById('qboLogPollChipV2');
    if (!wrap) return;
    MastDB.get('admin/integrations/_meta').then(function (meta) {
      meta = meta || {};
      function tone(iso, freshMins, staleMins) {
        if (!iso) return 'neutral';
        var ms = (typeof iso === 'number') ? iso : Date.parse(iso);
        var minsAgo = (Date.now() - ms) / 60000;
        if (minsAgo <= freshMins) return 'success';
        if (minsAgo <= staleMins) return 'warning';
        return 'danger';
      }
      wrap.innerHTML =
        U.badge('Last poll: ' + rel(meta.lastPollAt), tone(meta.lastPollAt, 30, 120)) + ' ' +
        U.badge('Last webhook: ' + rel(meta.lastWebhookAt), tone(meta.lastWebhookAt, 60 * 24, 60 * 24 * 7));
    }).catch(function () {});
  }

  function applyLogFilters() {
    function val(id) { var el = document.getElementById(id); return (el && el.value) || ''; }
    _log.filterStatus = val('qboLogFilterStatusV2') || 'all';
    _log.filterEntity = val('qboLogFilterEntityV2') || 'all';
    _log.filterDirection = val('qboLogFilterDirectionV2') || 'all';
    _log.filterFrom = val('qboLogFilterFromV2');
    _log.filterTo = val('qboLogFilterToV2');
    _log.rows = []; _log.fetchedLimit = 0; _log.hasMore = true;
    var w = document.getElementById('qboLogTableWrapV2'); if (w) w.innerHTML = loadingHtml();
    loadSyncLogPage();
  }

  // Paged read of admin/qboSync — same limitToLast(N) + bump-by-page + 1000 cap
  // + client-side filter logic as V1 loadSyncLogPage.
  function loadSyncLogPage() {
    var nextLimit = (_log.fetchedLimit || 0) + SYNC_LOG_PAGE_SIZE;
    if (nextLimit > 1000) nextLimit = 1000;
    _log.fetchedLimit = nextLimit;
    MastDB.query('admin/qboSync').orderByChild('createdAt').limitToLast(nextLimit).once().then(function (snap) {
      var raw = snap || {};
      var arr = [];
      if (Array.isArray(raw)) arr = raw.slice();
      else Object.keys(raw).forEach(function (k) {
        var v = raw[k];
        if (v && typeof v === 'object') { if (!v.id) v.id = k; arr.push(v); }
      });
      arr.sort(function (a, b) { var ax = a.createdAt || 0, bx = b.createdAt || 0; return ax < bx ? 1 : ax > bx ? -1 : 0; });
      var filtered = arr.filter(function (r) {
        if (_log.filterStatus !== 'all' && r.status !== _log.filterStatus) return false;
        if (_log.filterEntity !== 'all' && r.mastEntityType !== _log.filterEntity) return false;
        if (_log.filterDirection !== 'all' && (r.direction || 'push') !== _log.filterDirection) return false;
        if (_log.filterFrom) {
          var fromTs = new Date(_log.filterFrom + 'T00:00:00').getTime();
          var rt = typeof r.createdAt === 'number' ? r.createdAt : Date.parse(r.createdAt);
          if (!isFinite(rt) || rt < fromTs) return false;
        }
        if (_log.filterTo) {
          var toTs = new Date(_log.filterTo + 'T23:59:59').getTime();
          var rt2 = typeof r.createdAt === 'number' ? r.createdAt : Date.parse(r.createdAt);
          if (!isFinite(rt2) || rt2 > toTs) return false;
        }
        return true;
      });
      _log.rows = filtered;
      _log.hasMore = (arr.length >= nextLimit) && (nextLimit < 1000);
      renderSyncLogTable();
    }).catch(function (err) {
      var w = document.getElementById('qboLogTableWrapV2');
      if (w) w.innerHTML = '<div style="color:var(--danger);padding:12px;">Failed to load sync log: ' + esc(err && err.message) + '</div>';
    });
  }

  function statusTone(s) {
    if (s === 'success') return 'success';
    if (s === 'queued' || s === 'in-flight') return 'warning';
    if (s === 'failed') return 'danger';
    if (s === 'blocked-closed-period') return 'info';
    return 'neutral';
  }

  function renderSyncLogTable() {
    var wrap = document.getElementById('qboLogTableWrapV2');
    var moreWrap = document.getElementById('qboLogMoreWrapV2');
    if (!wrap) return;
    var html = U.list({
      columns: [
        { key: 'createdAt', label: 'Timestamp', render: function (r) { return '<span style="white-space:nowrap;">' + esc(tsFmt(r.createdAt)) + '</span>'; } },
        { key: 'entity', label: 'Entity', render: function (r) {
            var dir = r.direction || 'push';
            var dirBadge = U.badge(dir === 'pull' ? '↓ ' + (r.pullSource || 'pull') : '↑ push', dir === 'pull' ? 'info' : 'success');
            return dirBadge + ' ' + esc(r.mastEntityType || r.entityType || '—');
          } },
        { key: 'mastId', label: 'Mast ID', render: function (r) { return '<span style="font-family:monospace;font-size:0.78rem;">' + esc(truncate(r.mastEntityId || r.mastId || r.entityId || '', 24)) + '</span>'; } },
        { key: 'qboId', label: 'QBO ID', render: function (r) { return '<span style="font-family:monospace;font-size:0.78rem;">' + esc(truncate(r.qboId || '', 18)) + '</span>'; } },
        { key: 'status', label: 'Status', render: function (r) { return U.badge(r.status || '—', statusTone(r.status)); } },
        { key: 'fault', label: 'Last fault', render: function (r) { var f = r.lastFault || r.error || ''; return '<span style="color:var(--warm-gray);" title="' + esc(f) + '">' + esc(truncate(f, 48)) + '</span>'; } },
        { key: 'action', label: '', align: 'right', render: function (r) {
            var requestId = r.requestId || r.id || '';
            if (r.status === 'failed' && requestId && canEdit()) {
              return '<button class="btn btn-secondary" style="font-size:0.78rem;padding:2px 8px;" onclick="event.stopPropagation();window.AccountingV2.retrySync(\'' + esc(requestId) + '\')">Retry</button>';
            }
            return '';
          } }
      ],
      rows: _log.rows,
      empty: { title: 'No sync records match the current filters', message: 'Pushes and pulls appear here once QuickBooks activity occurs.' }
    });
    wrap.innerHTML = html;
    if (moreWrap) {
      moreWrap.innerHTML = _log.hasMore
        ? '<button class="btn btn-secondary" onclick="window.AccountingV2.loadMoreLog()">Load more</button>'
        : (_log.rows.length ? '<div style="font-size:0.78rem;color:var(--warm-gray);">End of log</div>' : '');
    }
  }

  function loadMoreLog() { if (_log.hasMore) loadSyncLogPage(); }

  // Retry — delegates to the loaded V1 window._qboRetrySync, which owns the
  // PENDING_ITEM_CONFIRM item-match modal flow and the retryQboSync /
  // confirmQboItemMatch / lookupOrCreateQboItem CF calls (the single write path).
  // V2 just gates + audits, then hands off; on completion V1 reloads its own
  // state — we refresh ours too so the V2 table reflects the new status.
  function retrySync(requestId) {
    if (!canEdit()) { toastErr('You don\'t have permission to retry syncs.'); return; }
    if (!requestId) return;
    audit('qbo.sync.retry', { requestId: requestId });
    if (typeof window._qboRetrySync === 'function') {
      // V1's retry mutates window-level _syncLogState (its own); after it queues
      // we re-pull our page so the V2 view stays accurate.
      window._qboRetrySync(requestId);
      setTimeout(function () { _log.rows = []; _log.fetchedLimit = 0; loadSyncLogPage(); }, 1200);
    } else {
      // Fallback: V1 not loaded for some reason — call the CF directly (same envelope).
      callable('retryQboSync')({ tenantId: tenantId(), requestId: requestId }).then(function () {
        toastOk('Retry queued');
        setTimeout(function () { _log.rows = []; _log.fetchedLimit = 0; loadSyncLogPage(); }, 600);
      }).catch(function (err) { toastErr('Retry failed: ' + (err && err.message)); });
    }
  }

  // ════════════════════════ Conflicts sub-view ════════════════════════
  function renderConflictsView(body) {
    body.innerHTML = loadingHtml('Loading conflicts…');
    MastDB.get('admin/integrations/_meta').then(function (meta) {
      meta = meta || {};
      var conflicts = Array.isArray(meta.conflicts) ? meta.conflicts.slice() : [];
      // Keep the finance.js cross-module cache in sync, EXACTLY as V1's
      // renderConflictsView does (the frozen contract). We write the same global.
      window.__qboConflicts = conflicts;
      renderConflictsTable(body, conflicts);
    }).catch(function (err) {
      body.innerHTML = U.card('Conflicts', '<div style="color:var(--danger);font-size:0.85rem;">Failed to load conflicts: ' + esc(err && err.message) + '</div>');
    });
  }

  function renderConflictsTable(body, conflicts) {
    var pending = conflicts.filter(function (c) { return c && !c.resolution; });
    var resolved = conflicts.filter(function (c) { return c && c.resolution; });
    var summary =
      '<p style="color:var(--warm-gray);font-size:0.85rem;line-height:1.5;margin:0 0 12px;">' +
        'Conflicts are detected when QBO field values diverge from Mast on a pull (webhook, polling, or backfill). Resolve each one by choosing whose values to keep — Mast or QBO.' +
      '</p>' +
      '<div style="display:flex;gap:8px;margin-bottom:14px;">' +
        U.badge(pending.length + ' pending', pending.length ? 'danger' : 'neutral') + ' ' +
        U.badge(resolved.length + ' resolved', 'success') +
      '</div>';
    if (conflicts.length === 0) {
      body.innerHTML = U.card('Conflicts', summary +
        '<div style="font-size:0.85rem;color:var(--success, var(--warm-gray));">No conflicts. Mast and QuickBooks are aligned.</div>');
      return;
    }
    function divergedSummary(divergedFields) {
      var arr = Array.isArray(divergedFields) ? divergedFields : [];
      if (arr.length === 0) return '—';
      var first = arr[0] && arr[0].fieldName ? String(arr[0].fieldName) : '?';
      return arr.length === 1 ? first : first + ' +' + (arr.length - 1) + ' more';
    }
    var sorted = conflicts.slice().sort(function (a, b) {
      if (!a.resolution && b.resolution) return -1;
      if (a.resolution && !b.resolution) return 1;
      return String(b.detectedAt || '').localeCompare(String(a.detectedAt || ''));
    });
    var table = U.list({
      columns: [
        { key: 'entityType', label: 'Entity', render: function (c) { return esc(c.entityType || '—'); } },
        { key: 'mastId', label: 'Mast ID', render: function (c) { return '<span style="font-family:monospace;font-size:0.78rem;">' + esc(String(c.mastId || '').slice(-12) || '—') + '</span>'; } },
        { key: 'qboId', label: 'QBO ID', render: function (c) { return '<span style="font-family:monospace;font-size:0.78rem;">' + esc(String(c.qboId || '').slice(-12) || '—') + '</span>'; } },
        { key: 'diverged', label: 'Diverged fields', render: function (c) { return esc(divergedSummary(c.divergedFields)); } },
        { key: 'detectedAt', label: 'Detected', render: function (c) { return '<span style="white-space:nowrap;color:var(--warm-gray);font-size:0.78rem;">' + esc(tsFmt(c.detectedAt)) + '</span>'; } },
        { key: 'detectedBy', label: 'By', render: function (c) { return '<span style="color:var(--warm-gray);font-size:0.78rem;">' + esc(c.detectedBy || '—') + '</span>'; } },
        { key: 'action', label: '', align: 'right', render: function (c) {
            if (c.resolution) {
              return U.badge(c.resolution === 'accepted-qbo' ? 'Accepted QBO' : 'Kept Mast', c.resolution === 'accepted-qbo' ? 'info' : 'success');
            }
            if (!canEdit()) return '<span style="font-size:0.72rem;color:var(--warm-gray);">view only</span>';
            return '<button class="btn btn-primary" style="font-size:0.78rem;padding:3px 10px;" onclick="event.stopPropagation();window.AccountingV2.resolveConflict(\'' + esc(c.conflictId || '') + '\')">Resolve</button>';
          } }
      ],
      rows: sorted,
      rowId: function (c) { return c.conflictId; }
    });
    body.innerHTML = U.card('Sync conflicts', summary + table);
  }

  // Resolve — delegates to the loaded V1 window.openQboConflictModal (FROZEN
  // cross-module global; finance.js AR/AP/Day-Close chips deep-link into it).
  // That modal owns the resolveQboConflict CF call and the always-refetch race
  // guard. V2 gates + audits, then hands off. We re-render conflicts on a short
  // delay so the V2 table reflects the resolution.
  function resolveConflict(conflictId) {
    if (!canEdit()) { toastErr('You don\'t have permission to resolve conflicts.'); return; }
    if (!conflictId) { toastErr('Missing conflictId'); return; }
    audit('qbo.conflict.resolve.open', { conflictId: conflictId });
    if (typeof window.openQboConflictModal === 'function') {
      window.openQboConflictModal(conflictId);
      // V1's onAccept re-renders only if __qboInnerActiveTab==='conflicts' via
      // its OWN renderConflictsView; since we're the V2 panel, re-pull ourselves.
      setTimeout(function () { var b = panelBody(); if (b && window.__qboInnerActiveTab === 'conflicts') renderConflictsView(b); }, 1400);
    } else {
      toastErr('Conflict resolver unavailable (accounting module not loaded)');
    }
  }

  // ════════════════════════ Action delegations (single write paths) ════════════════════════
  // Each gates on can('integrations','edit') + writeAudit, then delegates to the
  // loaded V1 global (the canonical write path / modal). We NEVER redefine the
  // V1 globals; we call them.
  window.AccountingV2 = {
    // QBO-3: connect/disconnect are owned by the Connections board card now (which
    // delegates to the V1 connectQbo / disconnectQbo globals). This sub-view links
    // to the board instead of hosting those buttons.
    openConnectionsBoard: function () {
      audit('qbo.manage.openBoard', {});
      if (typeof window.switchSettingsSubView === 'function') window.switchSettingsSubView('channels');
      else toastErr('Connections board unavailable');
    },
    checkCollisions: function () {
      if (!canEdit()) { toastErr('You don\'t have permission to run a collision check.'); return; }
      audit('qbo.collisions.check', {});
      if (typeof window._qboCheckBankFeedCollisions === 'function') {
        window._qboCheckBankFeedCollisions();
        setTimeout(function () { var b = panelBody(); if (b) renderConnectView(b); }, 1200);
      } else toastErr('Collision check unavailable (accounting module not loaded)');
    },
    ackCollision: function (accountId) {
      if (!canEdit()) { toastErr('You don\'t have permission to acknowledge collisions.'); return; }
      audit('qbo.collision.ack', { accountId: accountId });
      if (typeof window._qboAckCollision === 'function') {
        window._qboAckCollision(accountId);
        setTimeout(function () { var b = panelBody(); if (b) renderConnectView(b); }, 800);
      } else toastErr('Acknowledge unavailable (accounting module not loaded)');
    },
    startBackfill: function () {
      if (!canEdit()) { toastErr('You don\'t have permission to run a backfill.'); return; }
      audit('qbo.backfill.start', {});
      // V1 _qboStartBackfill enforces the server gates (startQboHistoricalBackfill
      // mode=preview → blockedBy) and owns the 3-step preview→confirm→progress
      // modal. The client-side 3-gate disabled-state above is belt-and-suspenders.
      if (typeof window._qboStartBackfill === 'function') window._qboStartBackfill();
      else toastErr('Backfill unavailable (accounting module not loaded)');
    },
    pickDefaultSalesItem: function () {
      if (!canEdit()) { toastErr('You don\'t have permission to set the default sales item.'); return; }
      audit('qbo.itemBridge.pick.open', {});
      if (typeof window._qboPickDefaultSalesItem === 'function') {
        window._qboPickDefaultSalesItem();
        // V1 reloads via its renderCoaMapView; re-pull the V2 COA view too.
        setTimeout(function () { var b = panelBody(); if (b && window.__qboInnerActiveTab === 'map') renderCoaMapView(b); }, 1400);
      } else toastErr('Item picker unavailable (accounting module not loaded)');
    },
    saveMapping: saveMapping,
    applyLogFilters: applyLogFilters,
    loadMoreLog: loadMoreLog,
    retrySync: retrySync,
    resolveConflict: resolveConflict,
    flagOn: flagOn
  };
})();
