(function() {
  'use strict';
  // QBO Accounting module — Mast W1.10 scaffold (Idea -OtKxQEhTDampnjEBjvS)
  // Sub-views: connect | map | log
  // Real OAuth + COA Map + Sync log come in W1.1, W1.2, W1.10 Phase 2.

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

    var body = document.getElementById('accountingSubviewBody');
    if (!body) return;
    if (subView === 'map') {
      body.innerHTML = '<p style="color:var(--warm-gray);font-size:0.9rem;">Chart-of-Accounts mapping lands in W1.2.</p>';
    } else if (subView === 'log') {
      body.innerHTML = '<p style="color:var(--warm-gray);font-size:0.9rem;">Sync log lands in W1.10 Phase 2.</p>';
    } else {
      body.innerHTML =
        '<p style="color:var(--warm-gray);font-size:0.9rem;margin-bottom:12px;">' +
          'Connect your QuickBooks Online sandbox to begin. Use <strong>Settings &rarr; Integrations &rarr; QuickBooks Online</strong> ' +
          'for now; this page will host status + Disconnect controls in W1.1 Phase 2.' +
        '</p>' +
        '<button class="btn btn-primary" onclick="window.connectQbo && window.connectQbo()">Connect QuickBooks</button>';
    }
  }

  // Stubs exposed for Settings + Connection-subview buttons.
  // Replace in W1.1 Phase 2 with httpsCallable('mintQboAuthState') + popup-window opener
  // listening for postMessage({type:'qbo-oauth-success', realmId, tenantId}) from Agent A2's qboOauthCallback CF.
  window.connectQbo = function() {
    console.warn('[accounting] connectQbo not yet implemented (W1.1 Phase 2). Will mint authorizeUrl via mintQboAuthState CF and open popup.');
  };
  window.disconnectQbo = function() {
    console.warn('[accounting] disconnectQbo not yet implemented (W1.1 Phase 2).');
  };

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('accounting', {
      routes: {
        'accounting': { tab: 'accountingTab', setup: renderAccounting }
      }
    });
  }
})();
