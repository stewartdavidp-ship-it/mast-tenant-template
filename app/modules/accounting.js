(function() {
  'use strict';
  // QBO Accounting module — Mast W1 (Idea -OtKxQEhTDampnjEBjvS)
  // Sub-views: connect | map | log
  // W1.1 (this commit): real OAuth client via mintQboAuthState + popup +
  // postMessage handler with strict origin check.
  // COA Map + Sync log come in W1.2 + W1.10 Phase 2 (subsequent commits).

  var QBO_CF_ORIGIN = 'https://us-central1-mast-platform-prod.cloudfunctions.net';

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

  // ---- render shell ----
  function renderAccounting() {
    var tab = document.getElementById('accountingTab');
    if (!tab) return;
    var hash = (location.hash || '');
    var qIdx = hash.indexOf('?');
    var qs = qIdx >= 0 ? hash.substring(qIdx + 1) : '';
    var params = new URLSearchParams(qs);
    var subView = params.get('subView') || 'connect';

    function tabAttr(v) {
      return 'class="subview-tab' + (subView === v ? ' active' : '') + '"';
    }

    tab.innerHTML =
      '<div class="page-header" style="padding:24px 24px 0;">' +
        '<h1 style="font-size:1.6rem;margin:0 0 4px;">QuickBooks Online</h1>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 16px;">Sync day-close journals, AR invoices, and bills to QBO. Sandbox V1.</p>' +
      '</div>' +
      '<div class="view-tabs" style="padding:0 24px;margin-bottom:16px;">' +
        '<a href="#accounting?subView=connect" ' + tabAttr('connect') + ' style="margin-right:12px;font-size:0.9rem;">Connection</a>' +
        '<a href="#accounting?subView=map" ' + tabAttr('map') + ' style="margin-right:12px;font-size:0.9rem;">COA Map</a>' +
        '<a href="#accounting?subView=log" ' + tabAttr('log') + ' style="font-size:0.9rem;">Sync Log</a>' +
      '</div>' +
      '<div id="accountingSubviewBody" style="padding:0 24px 24px;"></div>';

    if (subView === 'map') renderCoaMapView();
    else if (subView === 'log') renderSyncLogView();
    else renderConnectView();
  }

  // ---- Connection sub-view (W1.1) ----
  function renderConnectView() {
    var body = document.getElementById('accountingSubviewBody');
    if (!body) return;
    body.innerHTML = '<div id="qboConnViewStatus" style="font-size:0.9rem;color:var(--warm-gray);">Loading…</div>';

    MastDB.get('admin/integrations/qbo').then(function(doc) {
      var connected = doc && doc.realmId && !doc.disconnectedAt && (doc.status !== 'disconnected');
      var html;
      if (connected) {
        var env = doc.env || 'sandbox';
        var realmShort = String(doc.realmId).slice(0, 8) + '…';
        var connectedAt = doc.connectedAt ? new Date(doc.connectedAt).toLocaleString() : '—';
        html =
          '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:8px;padding:12px 16px;margin-bottom:16px;">' +
            '<div style="font-size:0.9rem;font-weight:600;color:#22c55e;margin-bottom:4px;">Connected</div>' +
            '<div style="font-size:0.85rem;color:var(--warm-gray);">' +
              'Environment: <strong>' + esc(env) + '</strong> · Realm: <code style="font-size:0.78rem;">' + esc(realmShort) + '</code> · Since: ' + esc(connectedAt) +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-secondary" onclick="navigateTo(\'accounting\',\'subView=map\')">Manage COA Map</button>' +
            '<button class="btn btn-secondary" onclick="navigateTo(\'accounting\',\'subView=log\')">View Sync Log</button>' +
            '<button class="btn btn-danger" onclick="window.disconnectQbo && window.disconnectQbo()">Disconnect</button>' +
          '</div>';
      } else {
        html =
          '<p style="color:var(--warm-gray);font-size:0.9rem;margin-bottom:12px;">' +
            'Connect your QuickBooks Online sandbox to begin. After connecting, map your Mast categories to QBO accounts in the COA Map tab.' +
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
    var chip = document.getElementById('qboStatusChip');
    var disc = document.getElementById('qboDisconnected');
    var conn = document.getElementById('qboConnected');
    if (chip) {
      if (connected) {
        var env = (doc && doc.env) || 'sandbox';
        var realm = (doc && doc.realmId) ? String(doc.realmId).slice(0, 8) + '…' : '';
        chip.textContent = 'Connected · ' + env + (realm ? ' · realm ' + realm : '');
        chip.style.background = 'rgba(34,197,94,0.15)';
        chip.style.color = '#22c55e';
      } else {
        chip.textContent = 'Not connected';
        chip.style.background = '#eee';
        chip.style.color = '#555';
      }
    }
    if (disc) disc.style.display = connected ? 'none' : '';
    if (conn) conn.style.display = connected ? '' : 'none';
  }

  // ---- COA Map sub-view (placeholder — W1.2 next commit) ----
  function renderCoaMapView() {
    var body = document.getElementById('accountingSubviewBody');
    if (!body) return;
    body.innerHTML = '<p style="color:var(--warm-gray);font-size:0.9rem;">Chart-of-Accounts mapping lands in W1.2.</p>';
  }

  // ---- Sync Log sub-view (placeholder — W1.10 Phase 2 next commit) ----
  function renderSyncLogView() {
    var body = document.getElementById('accountingSubviewBody');
    if (!body) return;
    body.innerHTML = '<p style="color:var(--warm-gray);font-size:0.9rem;">Sync log lands in W1.10 Phase 2.</p>';
  }

  // ---- Connect / Disconnect (W1.1) ----
  window.connectQbo = async function() {
    try {
      var tid = tenantId();
      if (!tid) { toastErr('Tenant ID not resolved'); return; }
      var mintFn = firebase.functions().httpsCallable('mintQboAuthState');
      var result = await mintFn({ tenantId: tid });
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
          // Refresh views.
          if (typeof renderAccounting === 'function') renderAccounting();
          MastDB.get('admin/integrations/qbo').then(function(doc) {
            reflectStatusChip(true, doc || { realmId: msg.realmId, env: msg.env });
          }).catch(function() {
            reflectStatusChip(true, { realmId: msg.realmId, env: msg.env });
          });
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
    if (!confirm('Disconnecting will not delete data in QuickBooks. You can reconnect anytime; previously-pushed entries remain. Continue?')) return;
    try {
      var fn = firebase.functions().httpsCallable('disconnectQbo');
      await fn({ tenantId: tenantId() });
      toastOk('QuickBooks disconnected');
      reflectStatusChip(false, null);
      if (typeof renderAccounting === 'function') renderAccounting();
    } catch (err) {
      toastErr('Disconnect failed: ' + (err && err.message));
    }
  };

  // ---- Settings panel chip hydration ----
  // When Settings → Integrations renders, hydrate the QBO chip from the doc.
  function hydrateSettingsChip() {
    if (!document.getElementById('qboStatusChip')) return;
    MastDB.get('admin/integrations/qbo').then(function(doc) {
      var connected = doc && doc.realmId && !doc.disconnectedAt && (doc.status !== 'disconnected');
      reflectStatusChip(connected, doc);
    }).catch(function() {});
  }
  if (typeof MastDB !== 'undefined' && MastDB.get) {
    try { hydrateSettingsChip(); } catch (e) {}
  }

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('accounting', {
      routes: {
        'accounting': { tab: 'accountingTab', setup: renderAccounting }
      }
    });
  }
})();
