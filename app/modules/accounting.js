(function() {
  'use strict';
  // QBO Accounting module — Mast W1 (Idea -OtKxQEhTDampnjEBjvS)
  // Sub-views: connect | map | log
  // W1.1 (this commit): real OAuth client via mintQboAuthState + popup +
  // postMessage handler with strict origin check.
  // COA Map + Sync log come in W1.2 + W1.10 Phase 2 (subsequent commits).

  var QBO_CF_ORIGIN = 'https://us-central1-mast-platform-prod.cloudfunctions.net';

  // ---- Mast → QBO category map (left col of COA Map UI) ----
  // Source: D-ACC-2/3 ratified concepts. Order = how operators think about
  // it (revenue first, then COGS, then expenses, then liabilities).
  var COA_CATEGORIES = [
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
  var COA_REQUIRED = ['revenue_dtc', 'revenue_wholesale', 'revenue_gallery', 'cogs', 'sales_tax_payable',
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

  // ---- COA Map sub-view (W1.2) ----
  function renderCoaMapView() {
    var body = document.getElementById('accountingSubviewBody');
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
      var mapping = (mappingDoc && mappingDoc.mapping) || {};
      renderCoaMapTable(body, accounts, mapping, mappingDoc);
    }).catch(function(err) {
      var msg = (err && err.message) || String(err);
      var isAuth = /unauth|not.*connect|no.*token|invalid.*token/i.test(msg);
      if (isAuth) {
        body.innerHTML =
          '<div style="background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.25);border-radius:8px;padding:12px 16px;">' +
            '<div style="font-size:0.9rem;font-weight:600;color:#eab308;margin-bottom:4px;">QuickBooks not connected</div>' +
            '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Connect first, then return to map your categories.</div>' +
            '<a class="btn btn-primary" href="#accounting?subView=connect">Go to Connection</a>' +
          '</div>';
      } else {
        body.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">Failed to load: ' + esc(msg) + '</div>';
      }
    });
  }

  function renderCoaMapTable(body, accounts, mapping, mappingDoc) {
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
        rows += '<tr><td colspan="2" style="padding:14px 10px 6px;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.05);">' + esc(section) + '</td></tr>';
      }
      var required = COA_REQUIRED.indexOf(cat.key) >= 0;
      var current = mapping[cat.key] || '';
      rows +=
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
          '<td style="padding:10px;font-size:0.9rem;width:42%;">' + esc(cat.label) + (required ? ' <span style="color:#ef4444;font-size:0.72rem;">*</span>' : '') + '</td>' +
          '<td style="padding:10px;">' +
            '<select class="qbo-map-select" data-mast-key="' + esc(cat.key) + '" style="width:100%;padding:6px 8px;font-size:0.85rem;background:var(--bg-secondary,#232323);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:4px;">' +
              optionsHtmlForRow(current) +
            '</select>' +
          '</td>' +
        '</tr>';
    });

    body.innerHTML =
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">' +
        'Map each Mast category to a QBO account. Required (*) categories must be mapped before saving. Mappings can be updated anytime; future syncs use the new mapping.' +
      '</div>' +
      lastSaved +
      '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">' +
        '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">' +
          '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Mast Category</th>' +
          '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">QBO Account</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div style="margin-top:16px;display:flex;gap:8px;align-items:center;">' +
        '<button id="qboMapSaveBtn" class="btn btn-primary" onclick="window._qboSaveMapping && window._qboSaveMapping()">Save mapping</button>' +
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
    var body = document.getElementById('accountingSubviewBody');
    if (!body) return;
    _syncLogState = { rows: [], filterStatus: 'all', filterEntity: 'all', filterFrom: '', filterTo: '', hasMore: true, fetchedLimit: 0 };
    body.innerHTML =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;font-size:0.85rem;">' +
        '<label>Status: <select id="qboLogFilterStatus" style="padding:4px 6px;background:var(--bg-secondary,#232323);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:4px;font-size:0.85rem;">' +
          '<option value="all">All</option>' +
          '<option value="queued">Queued</option>' +
          '<option value="in-flight">In flight</option>' +
          '<option value="success">Success</option>' +
          '<option value="failed">Failed</option>' +
          '<option value="blocked-closed-period">Blocked (closed period)</option>' +
          '<option value="orphaned">Orphaned</option>' +
        '</select></label>' +
        '<label>Entity: <select id="qboLogFilterEntity" style="padding:4px 6px;background:var(--bg-secondary,#232323);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:4px;font-size:0.85rem;">' +
          '<option value="all">All</option>' +
          '<option value="journalEntry">journalEntry</option>' +
          '<option value="invoice">invoice</option>' +
          '<option value="bill">bill</option>' +
          '<option value="customer">customer</option>' +
          '<option value="vendor">vendor</option>' +
        '</select></label>' +
        '<label>From: <input type="date" id="qboLogFilterFrom" style="padding:4px 6px;background:var(--bg-secondary,#232323);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:4px;font-size:0.85rem;"></label>' +
        '<label>To: <input type="date" id="qboLogFilterTo" style="padding:4px 6px;background:var(--bg-secondary,#232323);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:4px;font-size:0.85rem;"></label>' +
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
        if (_syncLogState.filterEntity !== 'all' && r.entityType !== _syncLogState.filterEntity) return false;
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
    function jsAttr(s) {
      if (typeof window._jsAttr === 'function') return window._jsAttr(s);
      return esc(s).replace(/'/g, '&#39;');
    }

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
      var mastId = r.mastId || r.entityId || '';
      var requestId = r.requestId || r.id || '';
      var retryHtml = '<button class="btn btn-secondary" disabled title="Retry available after retryQboSync CF deploys" style="font-size:0.78rem;padding:2px 8px;opacity:0.5;">Retry</button>';
      if (r.status === 'failed' && requestId) {
        retryHtml = '<button class="btn btn-secondary" onclick="window._qboRetrySync &amp;&amp; window._qboRetrySync(&#39;' + jsAttr(requestId) + '&#39;)" style="font-size:0.78rem;padding:2px 8px;">Retry</button>';
      }
      var copyBtn = qboId ? ' <button onclick="navigator.clipboard &amp;&amp; navigator.clipboard.writeText(&#39;' + jsAttr(qboId) + '&#39;);" title="Copy QBO ID" style="background:none;border:none;cursor:pointer;color:var(--warm-gray);font-size:0.78rem;">⧉</button>' : '';
      html +=
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
          '<td style="padding:8px 10px;white-space:nowrap;">' + esc(tsFmt(r.createdAt)) + '</td>' +
          '<td style="padding:8px 10px;">' + esc(r.entityType || '—') + '</td>' +
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
