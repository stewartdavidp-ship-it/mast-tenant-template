(function() {
  'use strict';
  // QBO Accounting module — Mast W1 (Idea -OtKxQEhTDampnjEBjvS)
  // Sub-views: connection | map | log
  // Consolidation refactor (2026-05-25): UI moved from standalone #accounting route
  // into Settings → Integrations → QuickBooks tab. Renderer is now
  // window.renderQboPanel(subView), targeting #qboPanelBody. Outer tab strip lives
  // in index.html (switchQboInnerTab).

  var QBO_CF_ORIGIN = 'https://us-central1-mast-platform-prod.cloudfunctions.net';
  // W2b.1 — webhook URL is one-per-Intuit-App (NOT per-tenant). Intuit routes
  // every realm's events to this single URL; the CF reverse-lookups tenantId
  // via platform_qboRealmIndex/{realmId}. Operator pastes this URL into the
  // Intuit Developer Portal once; verifier token lives in Secret Manager.
  var QBO_WEBHOOK_URL = QBO_CF_ORIGIN + '/qboWebhook';

  // Module-local JS-attribute escape per W2a sprinkle pattern (-OtSIF2XO7NmEgye6bEo).
  // Use this in any new onclick handler in this module. Falls back to a quoted
  // string literal when window._jsAttr isn't loaded yet (it's defined inline
  // in index.html and present by the time accounting.js is lazy-loaded).
  function _jsAttrSafe(s) {
    if (typeof window._jsAttr === 'function') return window._jsAttr(s);
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/"/g, '&quot;').replace(/</g, '\\u003C');
  }

  // ---- Mast → QBO category map (left col of COA Map UI) ----
  // Source: D-ACC-2/3 ratified concepts. Order = how operators think about
  // it (revenue first, then COGS, then expenses, then liabilities).
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
  // Required for save (all rev + COGS + sales tax + core expenses).
  var COA_REQUIRED = ['cash', 'revenue_dtc', 'revenue_wholesale', 'revenue_gallery', 'cogs', 'sales_tax_payable',
                      'expense_materials', 'expense_studio', 'expense_shipping'];

  // ---- helpers ----
  function esc(s) {
    s = (s == null) ? '' : String(s);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function tenantId() {
    return (typeof MastDB !== 'undefined' && MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID || '';
  }
  function toastOk(msg) { if (typeof showToast === 'function') showToast(msg); else console.log('[accounting]', msg); }
  function toastErr(msg) { if (typeof showToast === 'function') showToast(msg, true); else console.error('[accounting]', msg); }

  function panelBody() { return document.getElementById('qboPanelBody'); }

  // ---- Canonical entry: render a sub-view into #qboPanelBody ----
  function renderQboPanel(subView) {
    subView = subView || window.__qboInnerActiveTab || 'connection';
    window.__qboInnerActiveTab = subView;
    var body = panelBody();
    if (!body) return;
    if (subView === 'map') renderCoaMapView();
    else if (subView === 'log') renderSyncLogView();
    else renderConnectView();
  }
  window.renderQboPanel = renderQboPanel;

  // ---- Connection sub-view (W1.1) ----
  function renderConnectView() {
    var body = panelBody();
    if (!body) return;
    body.innerHTML = '<div id="qboConnViewStatus" style="font-size:0.9rem;color:var(--warm-gray);">Loading…</div>';

    // Load qbo doc + _meta in parallel for collision banner + countdown chip.
    Promise.all([
      MastDB.get('admin/integrations/qbo'),
      MastDB.get('admin/integrations/_meta').catch(function() { return null; })
    ]).then(function(results) {
      var doc = results[0];
      var meta = results[1] || {};
      var connected = doc && doc.realmId && !doc.disconnectedAt && (doc.status !== 'disconnected');
      var collisionBannerHtml = _renderCollisionBanner(meta);
      var html;
      if (connected) {
        var env = doc.env || 'sandbox';
        var realmShort = String(doc.realmId).slice(0, 8) + '…';
        var connectedAt = doc.connectedAt ? new Date(doc.connectedAt).toLocaleString() : '—';
        var countdownChipHtml = _renderReconnectCountdownChip(doc);
        var webhookSectionHtml = _renderWebhookSection(meta);
        html =
          collisionBannerHtml +
          '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:8px;padding:12px 16px;margin-bottom:16px;">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap;">' +
              '<span style="font-size:0.9rem;font-weight:600;color:#22c55e;">Connected</span>' +
              countdownChipHtml +
            '</div>' +
            '<div style="font-size:0.85rem;color:var(--warm-gray);">' +
              'Environment: <strong>' + esc(env) + '</strong> · Realm: <code style="font-size:0.78rem;">' + esc(realmShort) + '</code> · Since: ' + esc(connectedAt) +
            '</div>' +
          '</div>' +
          webhookSectionHtml +
          '<p style="color:var(--text-secondary);font-size:0.85rem;line-height:1.5;margin:0 0 12px;">' +
            'Next steps: confirm your <strong>COA Map</strong> tab is set up, then check the <strong>Sync Log</strong> tab ' +
            'after writing a Day Close or wholesale invoice to verify your first sync.' +
          '</p>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-secondary" onclick="window._qboCheckBankFeedCollisions && window._qboCheckBankFeedCollisions()">Check for collisions</button>' +
            '<button class="btn btn-danger" onclick="window.disconnectQbo && window.disconnectQbo()">Disconnect</button>' +
          '</div>';
      } else {
        html =
          collisionBannerHtml +
          '<p style="color:var(--text-secondary);font-size:0.85rem;line-height:1.5;margin-bottom:12px;">' +
            'Connect your QuickBooks Online sandbox to start syncing data. After connecting, map your chart of accounts ' +
            'on the <strong>COA Map</strong> tab. Once mapping is saved, every day close, wholesale invoice, vendor bill, ' +
            'and reviewed expense will sync automatically to QBO.' +
          '</p>' +
          '<button class="btn btn-primary" onclick="window.connectQbo && window.connectQbo()">Connect QuickBooks</button>';
      }
      body.innerHTML = html;
      reflectStatusChip(connected, doc);
    }).catch(function(err) {
      body.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">Failed to load connection state: ' + esc(err && err.message) + '</div>' +
        '<button class="btn btn-primary" onclick="window.connectQbo && window.connectQbo()">Connect QuickBooks</button>';
    });
  }

  function reflectStatusChip(connected, doc) {
    // The standalone status chip (#qboStatusChip) was retired in the consolidation
    // refactor — connection state now reads from the Connection tab body. Kept as
    // a no-op-safe function in case any legacy DOM still references it.
    var chip = document.getElementById('qboStatusChip');
    if (chip) {
      if (!chip.classList.contains('qbo-status-chip')) chip.classList.add('qbo-status-chip');
      chip.style.background = '';
      chip.style.color = '';
      if (connected) {
        var env = (doc && doc.env) || 'sandbox';
        var realm = (doc && doc.realmId) ? String(doc.realmId).slice(0, 8) + '…' : '';
        chip.textContent = 'Connected · ' + env + (realm ? ' · realm ' + realm : '');
        chip.classList.add('connected');
      } else {
        chip.textContent = 'Not connected';
        chip.classList.remove('connected');
      }
    }
  }

  // ---- W2a.2 Bank-feed collision banner ----
  // Reads admin/integrations/_meta.bankFeedCollisions[] where status==='pending-ack'.
  // Renders count + expandable list above Connect/Disconnect. Per-collision
  // "Acknowledge" flips status to 'acknowledged' so the row stops blocking.
  function _renderCollisionBanner(meta) {
    var collisions = (meta && Array.isArray(meta.bankFeedCollisions)) ? meta.bankFeedCollisions : [];
    var pending = collisions.filter(function(c) { return c && c.status === 'pending-ack'; });
    if (pending.length === 0) return '';
    var rows = pending.map(function(c, idx) {
      var name = c.accountName || c.accountId || '(unnamed bank account)';
      var when = c.detectedAt ? new Date(c.detectedAt).toLocaleString() : '';
      var safeIdx = window._jsAttr ? window._jsAttr(c.accountId || String(idx)) : esc(c.accountId || String(idx));
      return '<li style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid rgba(0,0,0,0.06);">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:0.85rem;font-weight:600;color:var(--text,#1f2937);">' + esc(name) + '</div>' +
          (when ? '<div style="font-size:0.72rem;color:var(--warm-gray);">' + esc('Detected ' + when) + '</div>' : '') +
        '</div>' +
        '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="window._qboAckCollision &amp;&amp; window._qboAckCollision(&#39;' + safeIdx + '&#39;)">Acknowledge</button>' +
      '</li>';
    }).join('');
    return '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.35);border-radius:8px;padding:12px 14px;margin-bottom:16px;">' +
      '<div style="font-size:0.9rem;font-weight:600;color:#ef4444;margin-bottom:4px;">' +
        esc(pending.length + ' bank-feed collision' + (pending.length === 1 ? '' : 's') + ' detected') +
      '</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);line-height:1.4;margin-bottom:8px;">' +
        esc('One or more QBO bank accounts share a routing/last-4 with a Plaid-connected account. Acknowledging marks the collision reviewed; it does not auto-resolve the duplicate-feed risk.') +
      '</div>' +
      '<ul style="list-style:none;margin:0;padding:0;">' + rows + '</ul>' +
    '</div>';
  }

  // W2a.4 — countdown chip next to "Connected" indicator.
  // daysUntilReconnect = refreshTokenIdleDays - (now - lastUsedAt)
  //   = days remaining before the QBO refresh token force-expires due to idle.
  // Color tiers track how soon the operator needs to act:
  //   > 30d remaining → green (plenty of headroom)
  //   7-30d remaining → amber (refresh soon — sync once or reconnect)
  //   ≤ 7d remaining  → red   (reconnect imminent — refresh window critical)
  // Morgan persona-verify W2a follow-up: previously the label "Xd until
  // reconnect" was computed as `IDLE - idle - 30`, which read "30d less than
  // truth" and made the chip claim "reconnect in 69d" on a fresh connection
  // where the real force-expiry was 100d out. Fixed by computing
  // daysUntilForceReconnect directly; tier thresholds re-aligned to bands.
  function _renderReconnectCountdownChip(doc) {
    if (!doc) return '';
    var IDLE_DAYS = 100;       // QBO per C-ACC-1 (Intuit Nov-2025 policy)
    var AMBER_THRESHOLD = 30;  // per provider-policy.qbo.oauth.refreshAheadDays
    var RED_THRESHOLD = 7;     // per provider-policy.qbo.oauth.criticalDays
    var lastUsedAt = doc.lastUsedAt || doc.refreshedAt || doc.connectedAt;
    if (!lastUsedAt) return '';
    var lastMs = (typeof lastUsedAt === 'number') ? lastUsedAt : Date.parse(lastUsedAt);
    if (!isFinite(lastMs)) return '';
    var idleDays = (Date.now() - lastMs) / 86400000;
    var daysUntilReconnect = Math.max(0, Math.floor(IDLE_DAYS - idleDays));
    var bg, fg, label, tooltip;
    if (daysUntilReconnect > AMBER_THRESHOLD) {
      bg = 'rgba(34,197,94,0.15)'; fg = '#22c55e';
      label = daysUntilReconnect + 'd until reconnect';
      tooltip = 'QBO refresh-on-use rotates the token automatically on every sync. The token only force-expires after ~100 days of zero use — you have ' + daysUntilReconnect + ' days of headroom.';
    } else if (daysUntilReconnect > RED_THRESHOLD) {
      bg = 'rgba(234,179,8,0.18)'; fg = '#eab308';
      label = daysUntilReconnect + 'd until reconnect';
      tooltip = 'Refresh window narrowing. Trigger any sync (or click Disconnect → Connect) to rotate the token and reset the idle clock.';
    } else {
      bg = 'rgba(239,68,68,0.18)'; fg = '#ef4444';
      label = daysUntilReconnect === 0 ? 'Reconnect required' : (daysUntilReconnect + 'd until reconnect');
      tooltip = 'QBO refresh window is critical. Reconnect within ' + (daysUntilReconnect || 0) + ' day' + ((daysUntilReconnect === 1) ? '' : 's') + ' to avoid sync failures.';
    }
    return '<span title="' + esc(tooltip) + '" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;background:' + bg + ';color:' + fg + ';font-size:0.72rem;font-weight:600;">' +
      '<span style="width:6px;height:6px;border-radius:50%;background:' + fg + ';display:inline-block;"></span>' + esc(label) +
    '</span>';
  }

  // W2b.1 — Webhook setup section. Renders status pill + Copy URL button + a
  // short operator note. Status sourced from `_meta.lastWebhookAt`:
  //   no value         → "Not registered" (red dot)
  //   < 30 days        → "Registered" (green)
  //   30-90 days       → "Stale" (amber) — webhook may have stopped firing
  //   > 90 days        → "Stale" (red)   — needs operator re-registration in Intuit Portal
  // Verifier token is platform-wide (Secret Manager `qbo-webhook-verifier-token`)
  // so no per-tenant paste field — operator only needs the URL.
  function _renderWebhookSection(meta) {
    var lastWebhookAt = meta && meta.lastWebhookAt ? meta.lastWebhookAt : null;
    var pillBg, pillFg, pillLabel, ageLine;
    if (!lastWebhookAt) {
      pillBg = 'rgba(239,68,68,0.18)'; pillFg = '#ef4444';
      pillLabel = '✗ Not registered';
      ageLine = 'No webhook events received yet. Register the URL below in the Intuit Developer Portal to enable real-time pulls.';
    } else {
      var lastMs = (typeof lastWebhookAt === 'number') ? lastWebhookAt : Date.parse(lastWebhookAt);
      var ageDays = isFinite(lastMs) ? Math.floor((Date.now() - lastMs) / 86400000) : 999;
      if (ageDays < 30) {
        pillBg = 'rgba(34,197,94,0.18)'; pillFg = '#22c55e';
        pillLabel = '✓ Registered';
      } else if (ageDays < 90) {
        pillBg = 'rgba(234,179,8,0.18)'; pillFg = '#eab308';
        pillLabel = '⚠ Stale';
      } else {
        pillBg = 'rgba(239,68,68,0.18)'; pillFg = '#ef4444';
        pillLabel = '⚠ Stale (' + ageDays + 'd)';
      }
      ageLine = 'Last webhook event: ' + new Date(lastMs).toLocaleString() + '.';
    }
    return '<div style="background:var(--bg-secondary,#1a1a1a);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 14px;margin-bottom:16px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">' +
        '<div style="font-size:0.9rem;font-weight:600;color:var(--text,#fff);">Webhook (real-time pull)</div>' +
        '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:10px;background:' + pillBg + ';color:' + pillFg + ';font-size:0.72rem;font-weight:600;">' +
          '<span style="width:6px;height:6px;border-radius:50%;background:' + pillFg + ';display:inline-block;"></span>' + esc(pillLabel) +
        '</span>' +
      '</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);line-height:1.4;margin-bottom:8px;">' + esc(ageLine) + '</div>' +
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">' +
        '<code style="font-size:0.78rem;background:rgba(0,0,0,0.25);padding:4px 8px;border-radius:4px;color:var(--text,#fff);word-break:break-all;flex:1;min-width:0;">' + esc(QBO_WEBHOOK_URL) + '</code>' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="window._qboCopyWebhookUrl && window._qboCopyWebhookUrl()">Copy URL</button>' +
      '</div>' +
      '<div style="font-size:0.72rem;color:var(--warm-gray);line-height:1.4;">' +
        esc('Register this URL in Intuit Developer Portal → Webhooks for your app. Verifier token is managed centrally — no paste step needed.') +
      '</div>' +
    '</div>';
  }

  window._qboCopyWebhookUrl = function() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(QBO_WEBHOOK_URL).then(function() {
          toastOk('Webhook URL copied');
        }, function() {
          toastErr('Copy blocked — select the URL and copy manually');
        });
      } else {
        toastErr('Clipboard API unavailable — select the URL and copy manually');
      }
    } catch (err) {
      toastErr('Copy failed: ' + (err && err.message));
    }
  };

  // Acknowledge a single collision row by accountId — flips status.
  window._qboAckCollision = async function(accountId) {
    if (!accountId) return;
    try {
      var meta = await MastDB.get('admin/integrations/_meta').catch(function() { return null; });
      if (!meta || !Array.isArray(meta.bankFeedCollisions)) {
        toastErr('No collisions to acknowledge'); return;
      }
      var updated = meta.bankFeedCollisions.map(function(c) {
        if (c && String(c.accountId) === String(accountId) && c.status === 'pending-ack') {
          return Object.assign({}, c, {
            status: 'acknowledged',
            acknowledgedAt: new Date().toISOString()
          });
        }
        return c;
      });
      await MastDB.set('admin/integrations/_meta', Object.assign({}, meta, { bankFeedCollisions: updated }));
      toastOk('Collision acknowledged');
      renderConnectView();
    } catch (err) {
      toastErr('Acknowledge failed: ' + (err && err.message));
    }
  };

  // Trigger detectBankFeedCollisions CF (admin onCall).
  window._qboCheckBankFeedCollisions = async function() {
    try {
      var fn = firebase.functions().httpsCallable('detectBankFeedCollisions');
      var result = await fn({ tenantId: tenantId() });
      var data = (result && result.data) || {};
      var count = data.detected || 0;
      toastOk('Checked — ' + count + ' collision' + (count === 1 ? '' : 's') + ' detected');
      renderConnectView();
    } catch (err) {
      toastErr('Collision check failed: ' + (err && err.message));
    }
  };

  // ---- Levenshtein + COA fuzzy auto-suggest (W1 fix-up) ----
  // Greenlit-earlier spec: when no saved mapping exists, pre-select best
  // fuzzy match per Mast category against the QBO chart-of-accounts.
  function _levenshtein(a, b) {
    a = String(a || '').toLowerCase();
    b = String(b || '').toLowerCase();
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1);
    var curr = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
        curr[k] = Math.min(curr[k - 1] + 1, prev[k] + 1, prev[k - 1] + cost);
      }
      for (var n = 0; n <= b.length; n++) prev[n] = curr[n];
    }
    return prev[b.length];
  }
  function _normDist(a, b) {
    var d = _levenshtein(a, b);
    var ml = Math.max(String(a || '').length, String(b || '').length) || 1;
    return d / ml;
  }
  // Seed keywords per Mast category. Scored against each Active QBO account
  // via a 3-tier match (exact > substring > shared-token > Levenshtein fallback).
  // Expanded 2026-05-25 after operator surfaced 3 unresolved (shipping, professional services, sales tax payable).
  var COA_SUGGEST_HINTS = {
    cash: ['Cash', 'Cash on Hand', 'Checking', 'Bank Account', 'Cash and cash equivalents'],
    revenue_dtc: ['Sales', 'Sales of Product Income', 'Services'],
    revenue_wholesale: ['Sales of Product Income', 'Wholesale', 'Sales'],
    revenue_gallery: ['Consignment', 'Sales', 'Other Income'],
    cogs: ['Cost of Goods Sold'],
    gallery_commission: ['Commissions and Fees', 'Sales Commissions'],
    expense_materials: ['Supplies', 'Job Materials', 'Materials & Supplies', 'Office Supplies'],
    expense_studio: ['Rent', 'Utilities', 'Studio Expense', 'Rent or Lease'],
    expense_equipment: ['Equipment Rental', 'Tools', 'Equipment', 'Machinery'],
    expense_shipping: ['Shipping', 'Postage', 'Freight', 'Postage and Delivery', 'Shipping, Freight & Delivery', 'Delivery'],
    expense_marketing: ['Advertising', 'Marketing', 'Promotional'],
    expense_software: ['Software', 'Subscriptions', 'Dues & Subscriptions'],
    expense_travel: ['Travel', 'Meals', 'Shows', 'Travel Meals'],
    expense_professional: ['Legal', 'Accounting', 'Professional Services', 'Legal & Professional Fees', 'Consulting', 'Professional Fees'],
    expense_fees: ['Bank Charges', 'Merchant', 'Processing Fees', 'Bank Service Charges'],
    expense_other: ['Other Expense', 'Miscellaneous', 'Other'],
    sales_tax_payable: ['Sales Tax Payable', 'Sales Tax', 'Out of Scope Agency Payable', 'Tax Payable', 'Sales Tax Agency Payable']
  };
  // Score one account name against one hint. Lower = better. Range [0..1].
  // Tier 1: exact (0.0) > Tier 2: substring either direction (0.05–0.20) >
  // Tier 3: shared token overlap (0.10–0.50) > Tier 4: Levenshtein fallback.
  function _scoreMatch(accountName, hint) {
    var a = String(accountName || '').toLowerCase().trim();
    var h = String(hint || '').toLowerCase().trim();
    if (!a || !h) return 1.0;
    if (a === h) return 0.0;
    // Substring match either direction
    if (a.indexOf(h) >= 0) return 0.05 + 0.15 * (1 - h.length / a.length);
    if (h.indexOf(a) >= 0) return 0.05 + 0.15 * (1 - a.length / h.length);
    // Shared-token overlap (split on non-alphanumeric)
    var aTokens = a.split(/[^a-z0-9]+/).filter(Boolean);
    var hTokens = h.split(/[^a-z0-9]+/).filter(Boolean);
    var shared = 0;
    hTokens.forEach(function(t) { if (aTokens.indexOf(t) >= 0) shared++; });
    if (shared > 0) {
      var ratio = shared / Math.max(aTokens.length, hTokens.length);
      return 0.50 - 0.40 * ratio;  // 1/1 → 0.10; 1/2 → 0.30; 1/3 → 0.37
    }
    // Levenshtein fallback
    return _normDist(a, h);
  }
  // Returns { [catKey]: qboAccountId } for any cat that has a match ≤ 0.4.
  function _suggestCoaMapping(accounts) {
    var active = (accounts || []).filter(function(a) { return a.Active !== false; });
    var out = {};
    Object.keys(COA_SUGGEST_HINTS).forEach(function(catKey) {
      var hints = COA_SUGGEST_HINTS[catKey];
      var best = null;
      active.forEach(function(a) {
        var name = a.FullyQualifiedName || a.Name || '';
        if (!name) return;
        for (var i = 0; i < hints.length; i++) {
          var d = _scoreMatch(name, hints[i]);
          if (d <= 0.4 && (best === null || d < best.d)) {
            best = { id: a.Id, d: d };
          }
        }
      });
      if (best) out[catKey] = best.id;
    });
    return out;
  }

  // ---- COA Map sub-view (W1.2) ----
  function renderCoaMapView() {
    var body = panelBody();
    if (!body) return;
    body.innerHTML = '<div style="color:var(--warm-gray);font-size:0.9rem;padding:24px 0;">Loading QuickBooks chart of accounts…</div>';

    var tid = tenantId();
    if (!tid) {
      body.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">Tenant ID not resolved.</div>';
      return;
    }

    var fetchFn = firebase.functions().httpsCallable('fetchQboChart');
    var getMapFn = firebase.functions().httpsCallable('getQboMapping');

    Promise.all([
      fetchFn({ tenantId: tid }),
      getMapFn({ tenantId: tid })
    ]).then(function(results) {
      var accounts = (results[0] && results[0].data && results[0].data.accounts) || [];
      var mappingDoc = (results[1] && results[1].data) || {};
      var savedMapping = (mappingDoc && mappingDoc.mapping) || null;
      // Auto-suggest fills GAPS: preserve all saved selections, but for any
      // category not yet mapped (including newly-added categories like 'cash'
      // shipped in a later release) compute a fuzzy suggestion. This way a
      // tenant who saved their map before a category was added still gets
      // an auto-suggest for the new field on next visit.
      var suggested = false;
      var mapping = {};
      var suggestions = _suggestCoaMapping(accounts);
      COA_CATEGORIES.forEach(function(cat) {
        if (savedMapping && savedMapping[cat.key]) {
          mapping[cat.key] = savedMapping[cat.key];
        } else if (suggestions[cat.key]) {
          mapping[cat.key] = suggestions[cat.key];
          suggested = true;
        }
      });
      renderCoaMapTable(body, accounts, mapping, mappingDoc, suggested);
    }).catch(function(err) {
      var msg = (err && err.message) || String(err);
      var isAuth = /unauth|not.*connect|no.*token|invalid.*token/i.test(msg);
      if (isAuth) {
        body.innerHTML =
          '<div style="background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.25);border-radius:8px;padding:12px 16px;">' +
            '<div style="font-size:0.9rem;font-weight:600;color:#eab308;margin-bottom:4px;">QuickBooks not connected</div>' +
            '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Connect first, then return to map your categories.</div>' +
            '<button class="btn btn-primary" onclick="switchQboInnerTab(\'connection\')">Go to Connection</button>' +
          '</div>';
      } else {
        body.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">Failed to load: ' + esc(msg) + '</div>';
      }
    });
  }

  function renderCoaMapTable(body, accounts, mapping, mappingDoc, suggested) {
    // Group accounts by AccountType for grouped <optgroup>.
    var byType = {};
    accounts.forEach(function(a) {
      if (a.Active === false) return;
      var t = a.AccountType || 'Other';
      if (!byType[t]) byType[t] = [];
      byType[t].push(a);
    });
    Object.keys(byType).forEach(function(t) {
      byType[t].sort(function(a, b) {
        return String(a.FullyQualifiedName || a.Name || '').localeCompare(String(b.FullyQualifiedName || b.Name || ''));
      });
    });
    var typeOrder = ['Income', 'Cost of Goods Sold', 'Expense', 'Other Current Liability', 'Other Current Asset', 'Bank', 'Credit Card', 'Long Term Liability', 'Equity', 'Other'];
    var allTypes = Object.keys(byType).sort(function(a, b) {
      var ai = typeOrder.indexOf(a); var bi = typeOrder.indexOf(b);
      if (ai < 0) ai = 999; if (bi < 0) bi = 999;
      return ai - bi;
    });

    function optionsHtmlForRow(currentId) {
      var h = '<option value="">— Select QBO account —</option>';
      allTypes.forEach(function(t) {
        h += '<optgroup label="' + esc(t) + '">';
        byType[t].forEach(function(a) {
          var label = a.FullyQualifiedName || a.Name || a.Id;
          var sel = (String(a.Id) === String(currentId)) ? ' selected' : '';
          h += '<option value="' + esc(a.Id) + '"' + sel + '>' + esc(label) + '</option>';
        });
        h += '</optgroup>';
      });
      return h;
    }

    var lastSaved = '';
    if (mappingDoc && mappingDoc.confirmedAt) {
      var when = new Date(mappingDoc.confirmedAt).toLocaleString();
      var who = mappingDoc.confirmedBy || '';
      lastSaved = '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:12px;">Last saved: ' + esc(when) + (who ? ' by ' + esc(who) : '') + '</div>';
    }

    var rows = '';
    var section = null;
    COA_CATEGORIES.forEach(function(cat) {
      if (cat.section !== section) {
        section = cat.section;
        rows += '<tr><td colspan="2" class="qbo-section-header">' + esc(section) + '</td></tr>';
      }
      var required = COA_REQUIRED.indexOf(cat.key) >= 0;
      var current = mapping[cat.key] || '';
      rows +=
        '<tr>' +
          '<td style="width:42%;">' + esc(cat.label) + (required ? ' <span style="color:#ef4444;font-size:0.72rem;" aria-label="required">*</span>' : '') + '</td>' +
          '<td>' +
            '<select class="qbo-map-select qbo-select" data-mast-key="' + esc(cat.key) + '">' +
              optionsHtmlForRow(current) +
            '</select>' +
          '</td>' +
        '</tr>';
    });

    // W2a.1 — Configuration section: Default Sales Item (Item bridge).
    // Reads from mappingDoc.itemBridge per C5 / C7. Saves out-of-band via
    // _qboPickDefaultSalesItem (not part of the COA mapping save batch — item
    // bridge has its own field at itemBridge.defaultSalesItemId).
    var itemBridge = (mappingDoc && mappingDoc.itemBridge) || {};
    var defaultItemId = itemBridge.defaultSalesItemId || '';
    var defaultItemName = itemBridge.defaultSalesItemName || '';
    var itemBridgeReady = itemBridge.ready === true;
    rows += '<tr><td colspan="2" class="qbo-section-header">' + esc('Configuration') + '</td></tr>';
    rows +=
      '<tr>' +
        '<td style="width:42%;">' + esc('Default Sales Item') +
          ' <span style="color:#ef4444;font-size:0.72rem;" aria-label="required">*</span>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;line-height:1.3;">' +
            esc('Used when a Mast product has no QBO Item mapping yet.') +
          '</div>' +
        '</td>' +
        '<td>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
            '<span id="qboDefaultSalesItemLabel" style="font-size:0.85rem;color:var(--text,#1f2937);min-width:120px;">' +
              (defaultItemId
                ? esc(defaultItemName || ('Item ' + defaultItemId))
                : '<span style="color:var(--warm-gray);">' + esc('Not set') + '</span>') +
            '</span>' +
            '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="window._qboPickDefaultSalesItem && window._qboPickDefaultSalesItem()">' +
              esc('Browse QBO Items') +
            '</button>' +
            (itemBridgeReady
              ? '<span style="font-size:0.72rem;color:#22c55e;">' + esc('● ready') + '</span>'
              : '') +
          '</div>' +
        '</td>' +
      '</tr>';

    var hasSaved = !!(mappingDoc && mappingDoc.confirmedAt);
    var unsavedBanner = '';
    // Banner cases:
    //   (1) no saved mapping yet — full unsaved state
    //   (2) saved mapping + fuzzy suggested new categories (e.g. Cash on Hand
    //       added in a later release) — partial unsaved state
    if (!hasSaved || suggested) {
      // Loud, top-of-page unsaved indicator. Operator surfaced 2026-05-25 that
      // the prior soft "Suggested matches" copy wasn't enough — readers
      // thought the pre-filled values were already persisted.
      unsavedBanner =
        '<div id="qboMapUnsavedBanner" style="display:flex;align-items:center;gap:10px;padding:12px 14px;margin:0 0 16px;border-radius:8px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.45);font-size:0.9rem;line-height:1.4;">' +
          '<span style="display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:10px;background:#f59e0b;color:#fff;font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;flex-shrink:0;">' +
            '<span style="width:6px;height:6px;border-radius:50%;background:#fff;display:inline-block;"></span>Unsaved' +
          '</span>' +
          '<span style="color:var(--text,#1f2937);">' +
            (suggested && hasSaved ? 'New categories were added since your last save. We pre-filled suggested matches — review and click <strong>Save changes</strong> below to apply.' :
             suggested ? 'We pre-filled suggested matches. Review and click <strong>Save mapping</strong> below to apply.' :
             'Set a QBO account for each category, then click <strong>Save mapping</strong> below.') +
          '</span>' +
        '</div>';
    }
    var guidance = hasSaved
      ? 'Your QBO account mappings. Editing these affects future syncs only; existing QBO entries are unchanged.'
      : 'Map each Mast category to a QBO account so syncs post to the right places.' + (suggested ? ' Suggestions are heuristic based on account names.' : '');
    body.innerHTML =
      unsavedBanner +
      '<p style="color:var(--text-secondary);font-size:0.85rem;line-height:1.5;margin:0 0 12px;">' +
        guidance +
      '</p>' +
      lastSaved +
      '<div style="overflow-x:auto;"><table class="qbo-table">' +
        '<thead><tr>' +
          '<th>Mast Category</th>' +
          '<th>QBO Account</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div style="margin-top:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<button id="qboMapSaveBtn" class="btn btn-primary" onclick="window._qboSaveMapping && window._qboSaveMapping()">' + (hasSaved ? 'Save changes' : 'Save mapping') + '</button>' +
        '<span id="qboMapStatus" style="font-size:0.85rem;color:var(--warm-gray);"></span>' +
      '</div>';
  }

  window._qboSaveMapping = async function() {
    var btn = document.getElementById('qboMapSaveBtn');
    var status = document.getElementById('qboMapStatus');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Saving…';
    try {
      var selects = document.querySelectorAll('select.qbo-map-select');
      var mapping = {};
      var missingRequired = [];
      selects.forEach(function(sel) {
        var k = sel.getAttribute('data-mast-key');
        var v = sel.value;
        if (v) mapping[k] = v;
        else if (COA_REQUIRED.indexOf(k) >= 0) missingRequired.push(k);
      });
      if (missingRequired.length > 0) {
        if (status) status.innerHTML = '<span style="color:#ef4444;">Missing required: ' + esc(missingRequired.join(', ')) + '</span>';
        if (btn) btn.disabled = false;
        return;
      }
      var setMapFn = firebase.functions().httpsCallable('setQboMapping');
      await setMapFn({ tenantId: tenantId(), mapping: mapping });
      if (status) status.innerHTML = '<span style="color:#22c55e;">Saved.</span>';
      toastOk('COA mapping saved');
      // Reload to show fresh confirmedAt timestamp.
      setTimeout(function() { renderCoaMapView(); }, 600);
    } catch (err) {
      if (status) status.innerHTML = '<span style="color:#ef4444;">Save failed: ' + esc(err && err.message) + '</span>';
      toastErr('Save failed: ' + (err && err.message));
      if (btn) btn.disabled = false;
    }
  };

  // ---- Sync Log sub-view (W1.10 Phase 2) ----
  var SYNC_LOG_PAGE_SIZE = 50;
  var _syncLogState = { rows: [], filterStatus: 'all', filterEntity: 'all', filterFrom: '', filterTo: '', hasMore: true, fetchedLimit: 0 };

  function renderSyncLogView() {
    var body = panelBody();
    if (!body) return;
    _syncLogState = { rows: [], filterStatus: 'all', filterEntity: 'all', filterFrom: '', filterTo: '', hasMore: true, fetchedLimit: 0 };
    body.innerHTML =
      '<p style="color:var(--text-secondary);font-size:0.85rem;line-height:1.5;margin:0 0 12px;">' +
        'Every push to QuickBooks creates a row here. The log fills automatically when you write a Day Close, wholesale invoice, vendor bill, or reviewed expense. Failed pushes show a Retry button.' +
      '</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;font-size:0.85rem;">' +
        '<label>Status: <select id="qboLogFilterStatus" class="qbo-select" style="width:auto;">' +
          '<option value="all">All</option>' +
          '<option value="queued">Queued</option>' +
          '<option value="in-flight">In flight</option>' +
          '<option value="success">Success</option>' +
          '<option value="failed">Failed</option>' +
          '<option value="blocked-closed-period">Blocked (closed period)</option>' +
          '<option value="orphaned">Orphaned</option>' +
        '</select></label>' +
        '<label>Entity: <select id="qboLogFilterEntity" class="qbo-select" style="width:auto;">' +
          '<option value="all">All</option>' +
          '<option value="expense">Expense</option>' +
          '<option value="wholesaleInvoice">Wholesale Invoice</option>' +
          '<option value="apBill">AP Bill</option>' +
          '<option value="dayClose">Day Close</option>' +
        '</select></label>' +
        '<label>From: <input type="date" id="qboLogFilterFrom" class="qbo-select" style="width:auto;"></label>' +
        '<label>To: <input type="date" id="qboLogFilterTo" class="qbo-select" style="width:auto;"></label>' +
        '<button class="btn btn-secondary" onclick="window._qboLogApplyFilters && window._qboLogApplyFilters()">Apply</button>' +
      '</div>' +
      '<div id="qboLogTableWrap"><div style="color:var(--warm-gray);font-size:0.9rem;padding:24px 0;">Loading sync log…</div></div>' +
      '<div id="qboLogMoreWrap" style="margin-top:12px;text-align:center;"></div>';

    loadSyncLogPage();
  }

  window._qboLogApplyFilters = function() {
    var s = document.getElementById('qboLogFilterStatus');
    var e = document.getElementById('qboLogFilterEntity');
    var f = document.getElementById('qboLogFilterFrom');
    var t = document.getElementById('qboLogFilterTo');
    _syncLogState.filterStatus = (s && s.value) || 'all';
    _syncLogState.filterEntity = (e && e.value) || 'all';
    _syncLogState.filterFrom = (f && f.value) || '';
    _syncLogState.filterTo = (t && t.value) || '';
    _syncLogState.rows = [];
    _syncLogState.fetchedLimit = 0;
    _syncLogState.hasMore = true;
    document.getElementById('qboLogTableWrap').innerHTML = '<div style="color:var(--warm-gray);font-size:0.9rem;padding:24px 0;">Loading…</div>';
    loadSyncLogPage();
  };

  function loadSyncLogPage() {
    // Read directly from admin/qboSync — admin auth gates read per C2 rules.
    // No native cursor on MastDB.query, so we fetch limitToLast(N) and bump
    // N by SYNC_LOG_PAGE_SIZE on each "Load more". Hard cap 1000.
    var nextLimit = (_syncLogState.fetchedLimit || 0) + SYNC_LOG_PAGE_SIZE;
    if (nextLimit > 1000) nextLimit = 1000;
    _syncLogState.fetchedLimit = nextLimit;

    var q = MastDB.query('admin/qboSync').orderByChild('createdAt').limitToLast(nextLimit);
    q.once().then(function(snap) {
      var raw = snap || {};
      var arr = [];
      if (Array.isArray(raw)) arr = raw.slice();
      else {
        Object.keys(raw).forEach(function(k) {
          var v = raw[k];
          if (v && typeof v === 'object') {
            if (!v.id) v.id = k;
            arr.push(v);
          }
        });
      }
      // Sort desc by createdAt (most-recent first)
      arr.sort(function(a, b) {
        var ax = a.createdAt || 0; var bx = b.createdAt || 0;
        if (ax < bx) return 1; if (ax > bx) return -1; return 0;
      });
      // Filter client-side
      var filtered = arr.filter(function(r) {
        if (_syncLogState.filterStatus !== 'all' && r.status !== _syncLogState.filterStatus) return false;
        if (_syncLogState.filterEntity !== 'all' && r.mastEntityType !== _syncLogState.filterEntity) return false;
        if (_syncLogState.filterFrom) {
          var fromTs = new Date(_syncLogState.filterFrom + 'T00:00:00').getTime();
          var rt = typeof r.createdAt === 'number' ? r.createdAt : Date.parse(r.createdAt);
          if (!isFinite(rt) || rt < fromTs) return false;
        }
        if (_syncLogState.filterTo) {
          var toTs = new Date(_syncLogState.filterTo + 'T23:59:59').getTime();
          var rt2 = typeof r.createdAt === 'number' ? r.createdAt : Date.parse(r.createdAt);
          if (!isFinite(rt2) || rt2 > toTs) return false;
        }
        return true;
      });
      _syncLogState.rows = filtered;
      _syncLogState.hasMore = (arr.length >= nextLimit) && (nextLimit < 1000);
      renderSyncLogTable();
    }).catch(function(err) {
      var w = document.getElementById('qboLogTableWrap');
      if (w) w.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">Failed to load sync log: ' + esc(err && err.message) + '</div>';
    });
  }

  function renderSyncLogTable() {
    var wrap = document.getElementById('qboLogTableWrap');
    var moreWrap = document.getElementById('qboLogMoreWrap');
    if (!wrap) return;
    var rows = _syncLogState.rows;
    if (rows.length === 0) {
      wrap.innerHTML = '<div style="color:var(--warm-gray);font-size:0.9rem;padding:24px 0;text-align:center;">No sync records match the current filters.</div>';
      if (moreWrap) moreWrap.innerHTML = '';
      return;
    }
    function statusChip(s) {
      var bg = '#444', fg = '#fff';
      if (s === 'success') { bg = 'rgba(34,197,94,0.18)'; fg = '#22c55e'; }
      else if (s === 'queued' || s === 'in-flight') { bg = 'rgba(234,179,8,0.15)'; fg = '#eab308'; }
      else if (s === 'failed') { bg = 'rgba(239,68,68,0.15)'; fg = '#ef4444'; }
      else if (s === 'blocked-closed-period') { bg = 'rgba(168,85,247,0.15)'; fg = '#a855f7'; }
      else if (s === 'orphaned') { bg = 'rgba(148,163,184,0.18)'; fg = '#94a3b8'; }
      return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:' + bg + ';color:' + fg + ';font-size:0.72rem;">' + esc(s || '—') + '</span>';
    }
    function tsFmt(t) {
      if (!t) return '—';
      var d = (typeof t === 'number') ? new Date(t) : new Date(t);
      if (isNaN(d.getTime())) return esc(String(t));
      return d.toLocaleString();
    }
    function truncate(s, n) {
      s = (s == null) ? '' : String(s);
      if (s.length <= n) return s;
      return s.substring(0, n) + '…';
    }
    // Canonical _jsAttr lives on window (index.html). Local wrapper removed
    // 2026-05-25 per sprinkle -OtSIF2XO7NmEgye6bEo.
    function jsAttr(s) { return window._jsAttr(s); }

    var html =
      '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
        '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">' +
          '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Timestamp</th>' +
          '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Entity</th>' +
          '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Mast ID</th>' +
          '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">QBO ID</th>' +
          '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Status</th>' +
          '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Last fault</th>' +
          '<th style="text-align:right;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Action</th>' +
        '</tr></thead><tbody>';
    rows.forEach(function(r) {
      var fault = r.lastFault || r.error || '';
      var qboId = r.qboId || '';
      // Receipt schema (sync-execute.js writes): mastEntityType + mastEntityId.
      // Older fallback names (mastId/entityType/entityId) kept for any legacy rows.
      var mastId = r.mastEntityId || r.mastId || r.entityId || '';
      var entityType = r.mastEntityType || r.entityType || '';
      var requestId = r.requestId || r.id || '';
      var retryHtml = '<button class="btn btn-secondary" disabled title="Retry available after retryQboSync CF deploys" style="font-size:0.78rem;padding:2px 8px;opacity:0.5;">Retry</button>';
      if (r.status === 'failed' && requestId) {
        retryHtml = '<button class="btn btn-secondary" onclick="window._qboRetrySync &amp;&amp; window._qboRetrySync(&#39;' + jsAttr(requestId) + '&#39;)" style="font-size:0.78rem;padding:2px 8px;">Retry</button>';
      }
      var copyBtn = qboId ? ' <button onclick="navigator.clipboard &amp;&amp; navigator.clipboard.writeText(&#39;' + jsAttr(qboId) + '&#39;);" title="Copy QBO ID" style="background:none;border:none;cursor:pointer;color:var(--warm-gray);font-size:0.78rem;">⧉</button>' : '';
      html +=
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
          '<td style="padding:8px 10px;white-space:nowrap;">' + esc(tsFmt(r.createdAt)) + '</td>' +
          '<td style="padding:8px 10px;">' + esc(entityType || '—') + '</td>' +
          '<td style="padding:8px 10px;font-family:monospace;font-size:0.78rem;">' + esc(truncate(mastId, 24)) + '</td>' +
          '<td style="padding:8px 10px;font-family:monospace;font-size:0.78rem;">' + esc(truncate(qboId, 18)) + copyBtn + '</td>' +
          '<td style="padding:8px 10px;">' + statusChip(r.status) + '</td>' +
          '<td style="padding:8px 10px;color:var(--warm-gray);" title="' + esc(fault) + '">' + esc(truncate(fault, 48)) + '</td>' +
          '<td style="padding:8px 10px;text-align:right;">' + retryHtml + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    wrap.innerHTML = html;

    if (moreWrap) {
      if (_syncLogState.hasMore) {
        moreWrap.innerHTML = '<button class="btn btn-secondary" onclick="window._qboLogLoadMore && window._qboLogLoadMore()">Load more</button>';
      } else {
        moreWrap.innerHTML = '<div style="font-size:0.78rem;color:var(--warm-gray);">End of log</div>';
      }
    }
  }

  window._qboLogLoadMore = function() {
    if (!_syncLogState.hasMore) return;
    loadSyncLogPage();
  };

  window._qboRetrySync = async function(requestId) {
    if (!requestId) return;
    // W2a.1 — if receipt is parked at PENDING_ITEM_CONFIRM, open the fuzzy
    // match modal first to resolve the candidate, then re-enqueue.
    var row = (_syncLogState.rows || []).filter(function(r) {
      return (r.requestId || r.id) === requestId;
    })[0];
    if (row && (row.code === 'PENDING_ITEM_CONFIRM' || row.faultCode === 'PENDING_ITEM_CONFIRM')) {
      var candidates = Array.isArray(row.candidates) ? row.candidates : [];
      var productId = row.productId || row.mastEntityRef || '';
      window.openMatchConfirmModal({
        title: 'Confirm QBO Item match',
        description: candidates.length
          ? 'We found multiple possible QBO Items for this product. Pick the correct one to continue this sync.'
          : 'No fuzzy candidates were returned. Choose "Create new in QBO" or cancel.',
        candidates: candidates.map(function(c) {
          return {
            id: c.qboItemId || c.id,
            label: c.name || c.label || ('Item ' + (c.qboItemId || c.id)),
            sublabel: c.incomeAccountName ? ('Income: ' + c.incomeAccountName) : '',
            score: typeof c.score === 'number' ? c.score : 1
          };
        }),
        onAccept: async function(qboItemId) {
          if (!qboItemId) { toastErr('No item selected'); return; }
          try {
            var confirmFn = firebase.functions().httpsCallable('confirmQboItemMatch');
            await confirmFn({ tid: tenantId(), productId: productId, qboItemId: qboItemId });
            toastOk('Item match confirmed; re-queueing sync');
            var retryFn = firebase.functions().httpsCallable('retryQboSync');
            await retryFn({ tenantId: tenantId(), requestId: requestId });
            setTimeout(function() {
              _syncLogState.rows = [];
              _syncLogState.fetchedLimit = 0;
              loadSyncLogPage();
            }, 600);
          } catch (err) {
            toastErr('Confirm failed: ' + (err && err.message));
          }
        },
        onCreateNew: async function() {
          try {
            var lookupFn = firebase.functions().httpsCallable('lookupOrCreateQboItem');
            await lookupFn({ tid: tenantId(), productId: productId, name: row.productName || ('Product ' + productId), forceCreate: true });
            toastOk('Item created in QBO; re-queueing sync');
            var retryFn = firebase.functions().httpsCallable('retryQboSync');
            await retryFn({ tenantId: tenantId(), requestId: requestId });
            setTimeout(function() {
              _syncLogState.rows = [];
              _syncLogState.fetchedLimit = 0;
              loadSyncLogPage();
            }, 600);
          } catch (err) {
            toastErr('Create-new failed: ' + (err && err.message));
          }
        },
        onCancel: function() {}
      });
      return;
    }
    try {
      var fn = firebase.functions().httpsCallable('retryQboSync');
      await fn({ tenantId: tenantId(), requestId: requestId });
      toastOk('Retry queued');
      setTimeout(function() {
        _syncLogState.rows = [];
        _syncLogState.fetchedLimit = 0;
        loadSyncLogPage();
      }, 600);
    } catch (err) {
      toastErr('Retry failed: ' + (err && err.message));
    }
  };

  // W2a.1 — Default Sales Item picker. Lists QBO Items via lookupOrCreateQboItem
  // in "list" mode (Agent A boundary — if list mode isn't supported by the CF,
  // we fall back to operator entry of a QBO Item ID).
  window._qboPickDefaultSalesItem = async function() {
    var tid = tenantId();
    if (!tid) { toastErr('Tenant ID not resolved'); return; }
    var loadingToast = (typeof showToast === 'function') ? showToast('Loading QBO Items…') : null;
    try {
      // Best-effort: call lookupOrCreateQboItem in list mode (no productId →
      // returns top-25 items as candidates). If CF rejects, fall back.
      var fn = firebase.functions().httpsCallable('lookupOrCreateQboItem');
      var result = await fn({ tid: tid, listMode: true, limit: 25 });
      var candidates = (result && result.data && result.data.candidates) || [];
      if (!candidates.length) {
        toastErr('No QBO Items found — create one in QuickBooks first');
        return;
      }
      window.openMatchConfirmModal({
        title: 'Pick default Sales Item',
        description: 'This Item will be used when a Mast product has no QBO Item mapping. You can change it later.',
        candidates: candidates.map(function(c) {
          return {
            id: c.qboItemId || c.id,
            label: c.name || c.label || ('Item ' + (c.qboItemId || c.id)),
            sublabel: c.incomeAccountName ? ('Income: ' + c.incomeAccountName) : '',
            score: 0.05  // not a fuzzy match — just decorative pill
          };
        }),
        onAccept: async function(qboItemId) {
          if (!qboItemId) return;
          var picked = candidates.filter(function(c) { return String(c.qboItemId || c.id) === String(qboItemId); })[0];
          await MastDB.set('admin/integrations/qboMapping/itemBridge', {
            ready: true,
            defaultSalesItemId: String(qboItemId),
            defaultSalesItemName: (picked && (picked.name || picked.label)) || '',
            lastValidatedAt: new Date().toISOString()
          });
          toastOk('Default Sales Item saved');
          renderCoaMapView();
        },
        onCreateNew: function() {
          toastErr('To create a new Item, use QuickBooks → Sales → Products & services');
        },
        onCancel: function() {}
      });
    } catch (err) {
      var msg = (err && err.message) || String(err);
      toastErr('Failed to list QBO Items: ' + msg);
    } finally {
      // toast auto-dismisses
      void loadingToast;
    }
  };

  // ---- Connect / Disconnect (W1.1) ----
  window.connectQbo = async function() {
    try {
      var tid = tenantId();
      if (!tid) { toastErr('Tenant ID not resolved'); return; }
      var mintFn = firebase.functions().httpsCallable('mintQboAuthState');
      var result = await mintFn({ tenantId: tid, openerOrigin: window.location.origin });
      var authorizeUrl = result && result.data && result.data.authorizeUrl;
      if (!authorizeUrl) throw new Error('No authorize URL returned');

      var w = 700, h = 800;
      var left = (screen.width - w) / 2, top = (screen.height - h) / 2;
      var popup = window.open(authorizeUrl, 'qbo-oauth',
        'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
      if (!popup) { alert('Popup blocked. Allow popups for this site and try again.'); return; }

      var handler = function(ev) {
        // Strict origin check — callback CF is at us-central1 cloudfunctions origin.
        if (ev.origin !== QBO_CF_ORIGIN) return;
        var msg = ev.data || {};
        if (msg.type === 'qbo-oauth-success') {
          window.removeEventListener('message', handler);
          try { popup && popup.close(); } catch (e) {}
          toastOk('QuickBooks connected');
          // Refresh consolidated panel.
          renderQboPanel(window.__qboInnerActiveTab || 'connection');
        } else if (msg.type === 'qbo-oauth-error') {
          window.removeEventListener('message', handler);
          try { popup && popup.close(); } catch (e) {}
          toastErr('QuickBooks connect failed: ' + (msg.message || 'Unknown error'));
        }
      };
      window.addEventListener('message', handler);

      // Cleanup listener if popup closes without sending a message.
      var poll = setInterval(function() {
        try {
          if (popup.closed) {
            clearInterval(poll);
            window.removeEventListener('message', handler);
          }
        } catch (e) { clearInterval(poll); }
      }, 500);
    } catch (err) {
      console.error('[accounting] connectQbo failed', err);
      toastErr('Failed to start QuickBooks connect: ' + ((err && err.message) || err));
    }
  };

  window.disconnectQbo = async function() {
    // Design-system rule 19: no native confirm() — use mastConfirm (themed, dark-mode aware).
    var msg = 'Disconnecting will not delete data in QuickBooks. You can reconnect anytime; previously-pushed entries remain. Continue?';
    var ok;
    if (typeof window.mastConfirm === 'function') {
      ok = await window.mastConfirm(msg, { title: 'Disconnect QuickBooks', confirmLabel: 'Disconnect', dangerous: true });
    } else {
      ok = confirm(msg);
    }
    if (!ok) return;
    try {
      var fn = firebase.functions().httpsCallable('disconnectQbo');
      await fn({ tenantId: tenantId() });
      toastOk('QuickBooks disconnected');
      renderQboPanel('connection');
    } catch (err) {
      toastErr('Disconnect failed: ' + (err && err.message));
    }
  };

  // MastAdmin.registerModule call removed in the consolidation refactor — the
  // #accounting top-level route no longer exists. The module is lazy-loaded on
  // demand by switchQboInnerTab via MastAdmin.loadModule('accounting').
})();
