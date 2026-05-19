// ============================================================
// WHOLESALE MODULE (lazy-loaded)
// ============================================================
(function() {
'use strict';

var wholesaleTokensData = {};
var wholesaleOrdersData = {};
var wholesaleAuthorizedData = {};
var wholesaleRequestsData = {};
// W2a — accounts is the canonical commercial-terms record per buyer.
var wholesaleAccountsData = {};
var wholesaleSubView = 'orders'; // accounts | orders | users | requests
var wholesaleQRLib = null; // lazy-loaded QRCode library

// WHOLESALE_SEED and WHOLESALE_COLOR_UPDATES removed in unified pricing model Phase 4.
// Products now use isWholesale flag + wholesalePriceCents on product records.
// Seed data preserved in ~/.claude/plans/mast-pricing-model-build-plan.md.

// ── Render main wholesale admin view ──

// Tenant-TZ-aware date helpers for URL filter (createdAt is ISO timestamp).
var _wsTenantTz = null;
function wsEnsureTenantTz() {
  if (_wsTenantTz !== null) return Promise.resolve(_wsTenantTz);
  try {
    return MastDB.businessEntity.get('operations').then(function(snap) {
      var ops = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var tz = ops && ops.localization && ops.localization.timezone;
      _wsTenantTz = (tz && typeof tz === 'string') ? tz : 'UTC';
      return _wsTenantTz;
    }).catch(function() { _wsTenantTz = 'UTC'; return 'UTC'; });
  } catch (e) {
    _wsTenantTz = 'UTC';
    return Promise.resolve('UTC');
  }
}
function wsTzPartsFromIso(iso) {
  if (!iso) return null;
  var dt = new Date(iso);
  if (isNaN(dt.getTime())) return null;
  var fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: _wsTenantTz || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  var parts = {};
  fmt.formatToParts(dt).forEach(function(x) { if (x.type !== 'literal') parts[x.type] = x.value; });
  return parts;
}

function renderWholesaleAdmin() {
  var el = document.getElementById('wholesaleContent');
  if (!el) return;

  // URL-driven sub-tab forcing (MCP admin links). #wholesale?subView=accounts|orders|users|requests
  var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var urlSubView = (rp && typeof rp.subView === 'string') ? rp.subView : '';
  if (urlSubView && (urlSubView === 'accounts' || urlSubView === 'orders' || urlSubView === 'users' || urlSubView === 'requests')) {
    wholesaleSubView = urlSubView;
  }

  var html = '<div style="max-width:1100px;margin:0 auto;padding:24px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
      '<h2 style="font-size:1.6rem;font-weight:700;color:var(--charcoal);">Wholesale</h2>' +
    '</div>' +
    '<div style="background:rgba(42,124,111,0.08);border:1px solid rgba(42,124,111,0.2);border-radius:8px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">' +
      '<div style="font-weight:600;font-size:0.85rem;">PDF Catalog</div>' +
      '<button class="btn-small" onclick="uploadWholesalePDF()" style="background:var(--amber);color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Upload PDF</button>' +
      '<span id="wholesalePdfStatus" style="font-size:0.78rem;color:var(--warm-gray);">Checking...</span>' +
      '<div id="wholesalePdfQR"></div>' +
    '</div>' +
    '<div class="view-tabs" style="margin-bottom:20px;">' +
      '<div class="view-tab' + (wholesaleSubView === 'accounts' ? ' active' : '') + '" onclick="switchWholesaleView(\'accounts\')">Accounts</div>' +
      '<div class="view-tab' + (wholesaleSubView === 'orders' ? ' active' : '') + '" onclick="switchWholesaleView(\'orders\')">Orders</div>' +
      '<div class="view-tab' + (wholesaleSubView === 'users' ? ' active' : '') + '" onclick="switchWholesaleView(\'users\')">Authorized Users</div>' +
      '<div class="view-tab' + (wholesaleSubView === 'requests' ? ' active' : '') + '" onclick="switchWholesaleView(\'requests\')">Access Requests <span id="wsRequestBadge"></span></div>' +
    '</div>' +
    '<div id="wholesaleSubContent"></div>' +
  '</div>';

  el.innerHTML = html;

  // Check PDF status now that the element is in the DOM
  checkWholesalePdfStatus();

  // Update request count badge
  updateWholesaleRequestBadge();

  if (wholesaleSubView === 'accounts') renderWholesaleAccounts();
  else if (wholesaleSubView === 'users') renderWholesaleUsers();
  else if (wholesaleSubView === 'requests') renderWholesaleRequests();
  else if (wholesaleSubView === 'orders') renderWholesaleOrders();
}

function switchWholesaleView(view) {
  wholesaleSubView = view;
  renderWholesaleAdmin();
}

// ── Authorized Users sub-view ──

function wsEmailToKey(email) {
  if (!email) return '';
  return email.toLowerCase().replace(/\./g, ',');
}

function wsKeyToEmail(key) {
  if (!key) return '';
  return key.replace(/,/g, '.');
}

function renderWholesaleUsers() {
  var container = document.getElementById('wholesaleSubContent');
  if (!container) return;

  container.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading authorized users...</div>';

  // URL-driven filters (#wholesale?subView=users&active=true&accountIds=...)
  var rpUsers = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var urlActiveRawU = (rpUsers && typeof rpUsers.active === 'string') ? rpUsers.active : '';
  var urlActiveU = urlActiveRawU === 'true' ? true : (urlActiveRawU === 'false' ? false : null);
  var urlAccountIdsParam = (rpUsers && typeof rpUsers.accountIds === 'string') ? rpUsers.accountIds : '';
  var urlAccountIds = urlAccountIdsParam ? urlAccountIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  var urlAccountKeyLookup = urlAccountIds.length > 0 ? Object.create(null) : null;
  if (urlAccountKeyLookup) urlAccountIds.forEach(function(s) {
    urlAccountKeyLookup[s] = true;
    if (s.indexOf('@') >= 0) urlAccountKeyLookup[wsEmailToKey(s)] = true;
  });
  var hasUrlFilterU = !!(urlActiveU !== null || urlAccountIds.length);

  MastDB.get('admin/wholesaleAuthorized').then(function(snapVal) {
    wholesaleAuthorizedData = snapVal || {};
    var users = Object.keys(wholesaleAuthorizedData).map(function(k) {
      var u = wholesaleAuthorizedData[k];
      u._key = k;
      u._email = wsKeyToEmail(k);
      return u;
    }).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

    if (hasUrlFilterU) {
      users = users.filter(function(u) {
        var isActive = u.active !== false;
        if (urlActiveU !== null && isActive !== urlActiveU) return false;
        if (urlAccountKeyLookup && !urlAccountKeyLookup[u._key] && !urlAccountKeyLookup[u._email]) return false;
        return true;
      });
    }

    var html = '';
    if (hasUrlFilterU) {
      var bpartsU = [];
      if (urlAccountIds.length) bpartsU.push(urlAccountIds.length + ' selected account' + (urlAccountIds.length === 1 ? '' : 's'));
      if (urlActiveU === true) bpartsU.push('active only');
      if (urlActiveU === false) bpartsU.push('revoked only');
      html += '<div id="wholesaleUsersUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>👤 Showing ' + bpartsU.join(', ') + ' (' + users.length + ')</span>' +
        '<button type="button" onclick="clearWholesaleFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);">' + users.length + ' authorized user' + (users.length !== 1 ? 's' : '') + '</div>' +
      '<button class="btn-small" onclick="addWholesaleUser()" style="background:var(--teal);color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.78rem;">+ New User</button>' +
    '</div>';

    if (users.length === 0) {
      html += '<div style="text-align:center;padding:60px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#128100;</div>' +
        '<h3 style="font-weight:600;margin-bottom:8px;">No authorized users yet</h3>' +
        '<p style="font-size:0.85rem;">Add a buyer\'s Google email address to grant them wholesale catalog access.</p>' +
      '</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px;">';
      users.forEach(function(u) {
        var isActive = u.active !== false;
        html += '<div style="background:#fff;border:1px solid #e8e0d4;border-radius:8px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;' + (!isActive ? 'opacity:0.5;' : '') + '">' +
          '<div>' +
            '<div style="font-weight:500;font-size:0.9rem;">' + esc(u._email) + '</div>' +
            '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' +
              (u.displayName ? esc(u.displayName) + ' &middot; ' : '') +
              'Added ' + formatDate(u.createdAt) +
              (u.approvedFrom ? ' &middot; From request' : '') +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<span style="font-size:0.72rem;padding:3px 8px;border-radius:4px;' + (isActive ? 'background:rgba(45,125,70,0.15);color:#2D7D46;' : 'background:rgba(220,53,69,0.15);color:var(--danger);') + '">' + (isActive ? 'Active' : 'Revoked') + '</span>' +
            (isActive ? '<button onclick="revokeWholesaleUser(\'' + esc(u._key) + '\')" style="background:none;border:1px solid var(--danger);color:var(--danger);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;">Revoke</button>' : '') +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  });
}

async function addWholesaleUser() {
  var email = await mastPrompt('Enter the buyer\'s Google email address:', { title: 'Add Wholesale User' });
  if (!email) return;
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showToast('Invalid email address', true); return; }

  var key = wsEmailToKey(email);
  var data = {
    active: true,
    createdAt: new Date().toISOString()
  };

  MastDB.set('admin/wholesaleAuthorized/' + key, data).then(function() {
    showToast('Wholesale access granted to ' + email);
    renderWholesaleUsers();
  }).catch(function(err) {
    showToast('Error: ' + err.message, true);
  });
}

async function revokeWholesaleUser(key) {
  var email = wsKeyToEmail(key);
  if (!await mastConfirm('Revoke wholesale access for ' + email + '?', { title: 'Revoke Access', danger: true })) return;
  MastDB.update('admin/wholesaleAuthorized/' + key, { active: false }).then(function() {
    showToast('Access revoked for ' + email);
    renderWholesaleUsers();
  });
}

// ── Accounts sub-view (W2a) ──
// Wholesale "account" = the buyer entity (boutique / gallery / rep agency) that
// carries NET terms, credit limit, MOQ rules, resale cert, sales rep, territory.
// Authorized users in admin/wholesaleAuthorized reference an account via
// wholesaleAccountId; wholesale orders reference one too so AR aging + dormant-
// account rollups become joins. URL filter banner already lives in the
// Authorized Users sub-view (?accountIds=...) — see line 118+.

var WS_NET_TERMS = [
  { v: 'DUE_ON_RECEIPT', l: 'Due on receipt' },
  { v: 'NET_15', l: 'NET-15' },
  { v: 'NET_30', l: 'NET-30' },
  { v: 'NET_45', l: 'NET-45' },
  { v: 'NET_60', l: 'NET-60' }
];
var WS_ACCOUNT_TYPES = [
  { v: 'retailer', l: 'Retailer / Boutique' },
  { v: 'gallery', l: 'Gallery' },
  { v: 'museum_store', l: 'Museum store' },
  { v: 'rep_agency', l: 'Sales rep agency' },
  { v: 'other', l: 'Other' }
];
var WS_PAYMENT_METHODS = [
  { v: 'check', l: 'Check' },
  { v: 'card', l: 'Card' },
  { v: 'ach', l: 'ACH / bank transfer' }
];
var WS_ACCOUNT_STATUSES = [
  { v: 'active', l: 'Active' },
  { v: 'on_hold', l: 'On hold' },
  { v: 'closed', l: 'Closed' }
];

function renderWholesaleAccounts() {
  var container = document.getElementById('wholesaleSubContent');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading accounts...</div>';

  MastDB.wholesaleAccounts.list(200).then(function(snap) {
    var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
    wholesaleAccountsData = val || {};
    var accounts = Object.keys(wholesaleAccountsData).map(function(id) {
      var a = wholesaleAccountsData[id];
      a._id = id;
      return a;
    }).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);">' + accounts.length + ' wholesale account' + (accounts.length !== 1 ? 's' : '') + '</div>' +
      '<button class="btn-small" onclick="openNewWholesaleAccountModal()" style="background:var(--teal);color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.78rem;">+ New Account</button>' +
    '</div>';

    if (accounts.length === 0) {
      html += '<div style="text-align:center;padding:60px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#127970;</div>' +
        '<h3 style="font-weight:600;margin-bottom:8px;">No wholesale accounts yet</h3>' +
        '<p style="font-size:0.85rem;max-width:420px;margin:0 auto;">Add a boutique, gallery, or rep agency. Stores their NET terms, credit limit, MOQ, resale cert, and sales rep — so the Generate Invoice button on their orders fills in the right defaults.</p>' +
      '</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px;">';
      accounts.forEach(function(a) {
        var statusColor = a.status === 'on_hold' ? '#F59E0B' : (a.status === 'closed' ? '#9ca3af' : '#16a34a');
        var statusLabel = (WS_ACCOUNT_STATUSES.find(function(s) { return s.v === a.status; }) || { l: 'Active' }).l;
        var termsLabel = (WS_NET_TERMS.find(function(t) { return t.v === a.netTerms; }) || { l: '—' }).l;
        var typeLabel = (WS_ACCOUNT_TYPES.find(function(t) { return t.v === a.accountType; }) || { l: '' }).l;
        var creditStr = a.creditLimitCents ? '$' + (a.creditLimitCents / 100).toLocaleString() : '—';
        html += '<div onclick="editWholesaleAccount(\'' + esc(a._id) + '\')" style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:16px;">';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="font-weight:600;font-size:0.9rem;color:var(--charcoal);">' + esc(a.name || '(unnamed)') + '</div>';
        html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + esc(typeLabel) + (typeLabel && a.territory ? ' · ' : '') + esc(a.territory || '') + (a.salesRepName ? ' · Rep: ' + esc(a.salesRepName) : '') + '</div>';
        html += '</div>';
        html += '<div style="text-align:right;font-size:0.78rem;color:var(--warm-gray);min-width:120px;">';
        html += '<div>' + esc(termsLabel) + '</div>';
        html += '<div>Credit: ' + esc(creditStr) + '</div>';
        html += '</div>';
        html += '<span style="font-size:0.72rem;font-weight:600;padding:3px 10px;border-radius:10px;background:' + statusColor + '22;color:' + statusColor + ';border:1px solid ' + statusColor + '55;">' + esc(statusLabel) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }).catch(function(err) {
    container.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading accounts: ' + esc(err.message || String(err)) + '</div>';
  });
}

function openNewWholesaleAccountModal(existingId) {
  var a = existingId ? (wholesaleAccountsData[existingId] || {}) : {};
  var isEdit = !!existingId;
  var overlay = document.createElement('div');
  overlay.id = 'wsAccountModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';

  function optsHtml(opts, selected) {
    return opts.map(function(o) { return '<option value="' + esc(o.v) + '"' + (o.v === selected ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('');
  }

  overlay.innerHTML =
    '<div style="background:#fff;border-radius:12px;padding:24px;width:100%;max-width:560px;margin-top:40px;color:var(--charcoal);">' +
      '<h3 style="margin:0 0 16px;font-size:1.15rem;">' + (isEdit ? 'Edit Wholesale Account' : 'New Wholesale Account') + '</h3>' +
      '<form id="wsAccountForm" onsubmit="event.preventDefault();saveWholesaleAccount(' + (isEdit ? '\'' + esc(existingId) + '\'' : 'null') + ');return false;">' +
        '<div style="margin-bottom:12px;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Account name *</label>' +
          '<input id="wsa_name" required value="' + esc(a.name || '') + '" placeholder="Coastal Home Boutique" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Type</label>' +
            '<select id="wsa_type" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;background:#fff;">' + optsHtml(WS_ACCOUNT_TYPES, a.accountType || 'retailer') + '</select></div>' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Status</label>' +
            '<select id="wsa_status" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;background:#fff;">' + optsHtml(WS_ACCOUNT_STATUSES, a.status || 'active') + '</select></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">NET terms</label>' +
            '<select id="wsa_netTerms" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;background:#fff;">' + optsHtml(WS_NET_TERMS, a.netTerms || 'NET_30') + '</select></div>' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Default payment</label>' +
            '<select id="wsa_paymentMethod" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;background:#fff;">' + optsHtml(WS_PAYMENT_METHODS, a.paymentMethodDefault || 'check') + '</select></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Credit limit ($)</label>' +
            '<input id="wsa_creditLimit" type="number" min="0" step="1" value="' + esc(a.creditLimitCents ? (a.creditLimitCents / 100) : '') + '" placeholder="5000" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Opener min ($)</label>' +
            '<input id="wsa_opener" type="number" min="0" step="1" value="' + esc(a.minimumOpenerCents ? (a.minimumOpenerCents / 100) : '') + '" placeholder="500" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Reorder min ($)</label>' +
            '<input id="wsa_reorder" type="number" min="0" step="1" value="' + esc(a.minimumReorderCents ? (a.minimumReorderCents / 100) : '') + '" placeholder="250" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Sales rep (name)</label>' +
            '<input id="wsa_rep" value="' + esc(a.salesRepName || '') + '" placeholder="Jane Doe" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Territory</label>' +
            '<input id="wsa_territory" value="' + esc(a.territory || '') + '" placeholder="Northeast" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px;">' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Resale cert number</label>' +
            '<input id="wsa_resaleCert" value="' + esc(a.resaleCertNumber || '') + '" placeholder="(optional)" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
          '<div style="display:flex;align-items:flex-end;padding-bottom:6px;"><label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;"><input id="wsa_taxExempt" type="checkbox"' + (a.taxExempt !== false ? ' checked' : '') + '> Tax-exempt</label></div>' +
        '</div>' +
        '<div style="margin-bottom:16px;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Notes</label>' +
          '<textarea id="wsa_notes" rows="2" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;font-family:inherit;">' + esc(a.notes || '') + '</textarea></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button type="button" onclick="closeWholesaleAccountModal()" class="btn-small" style="background:#fff;color:var(--charcoal);border:1px solid #ddd;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.85rem;">Cancel</button>' +
          (isEdit ? '<button type="button" onclick="deleteWholesaleAccount(\'' + esc(existingId) + '\')" class="btn-small" style="background:#fff;color:var(--danger);border:1px solid var(--danger);padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.85rem;">Delete</button>' : '') +
          '<button type="submit" class="btn-small" style="background:var(--teal);color:#fff;border:none;padding:8px 18px;border-radius:4px;cursor:pointer;font-size:0.85rem;">' + (isEdit ? 'Save' : 'Create account') + '</button>' +
        '</div>' +
      '</form>' +
    '</div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeWholesaleAccountModal(); });
  document.body.appendChild(overlay);
  setTimeout(function() { var nameEl = document.getElementById('wsa_name'); if (nameEl) nameEl.focus(); }, 30);
}

function closeWholesaleAccountModal() {
  var el = document.getElementById('wsAccountModal');
  if (el) el.parentNode.removeChild(el);
}

function editWholesaleAccount(id) { openNewWholesaleAccountModal(id); }

async function deleteWholesaleAccount(id) {
  var a = wholesaleAccountsData[id];
  if (!a) return;
  if (!await mastConfirm('Delete "' + (a.name || 'this account') + '"? Authorized users + orders linked to this account will be unlinked but not removed.', { title: 'Delete account', danger: true })) return;
  try {
    await MastDB.wholesaleAccounts.remove(id);
    showToast('Account deleted');
    closeWholesaleAccountModal();
    renderWholesaleAccounts();
  } catch (err) {
    showToast('Error: ' + (err.message || String(err)), true);
  }
}

async function saveWholesaleAccount(existingId) {
  var name = (document.getElementById('wsa_name').value || '').trim();
  if (!name) { showToast('Name is required', true); return; }
  function toCents(elId) {
    var v = (document.getElementById(elId).value || '').trim();
    if (!v) return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : Math.round(n * 100);
  }
  function selVal(elId) { return document.getElementById(elId).value; }
  function txt(elId) { return (document.getElementById(elId).value || '').trim(); }
  var now = new Date().toISOString();
  var data = {
    name: name,
    accountType: selVal('wsa_type'),
    status: selVal('wsa_status'),
    netTerms: selVal('wsa_netTerms'),
    paymentMethodDefault: selVal('wsa_paymentMethod'),
    creditLimitCents: toCents('wsa_creditLimit'),
    minimumOpenerCents: toCents('wsa_opener'),
    minimumReorderCents: toCents('wsa_reorder'),
    salesRepName: txt('wsa_rep') || null,
    territory: txt('wsa_territory') || null,
    resaleCertNumber: txt('wsa_resaleCert') || null,
    taxExempt: !!document.getElementById('wsa_taxExempt').checked,
    notes: txt('wsa_notes') || null,
    updatedAt: now
  };
  try {
    var id;
    if (existingId) {
      await MastDB.wholesaleAccounts.update(existingId, data);
      id = existingId;
      showToast('Account updated');
    } else {
      data.createdAt = now;
      id = MastDB.wholesaleAccounts.newKey();
      await MastDB.wholesaleAccounts.set(id, data);
      showToast('Account created');
    }
    closeWholesaleAccountModal();
    renderWholesaleAccounts();
  } catch (err) {
    showToast('Error: ' + (err.message || String(err)), true);
  }
}

// ── Access Requests sub-view ──

function updateWholesaleRequestBadge() {
  MastDB.query('admin/wholesaleRequests').orderByChild('status').equalTo('pending')
    .once().then(function(snap) {
      var data = snap.val() || {};
      var count = Object.keys(data).length;
      var badge = document.getElementById('wsRequestBadge');
      if (badge) {
        badge.textContent = count > 0 ? '(' + count + ')' : '';
        badge.style.color = count > 0 ? 'var(--danger)' : '';
        badge.style.fontWeight = count > 0 ? '700' : '';
      }
    });
}

function renderWholesaleRequests() {
  var container = document.getElementById('wholesaleSubContent');
  if (!container) return;

  container.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading requests...</div>';

  // URL-driven filters (#wholesale?subView=requests&status=...&dateFrom=...&dateTo=...&requestIds=...)
  var rpReq = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var urlReqStatus = (rpReq && typeof rpReq.status === 'string') ? rpReq.status : '';
  var urlReqDateFrom = (rpReq && typeof rpReq.dateFrom === 'string') ? rpReq.dateFrom.slice(0, 10) : '';
  var urlReqDateTo = (rpReq && typeof rpReq.dateTo === 'string') ? rpReq.dateTo.slice(0, 10) : '';
  var urlReqIdsParam = (rpReq && typeof rpReq.requestIds === 'string') ? rpReq.requestIds : '';
  var urlReqIds = urlReqIdsParam ? urlReqIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  var urlReqIdLookup = urlReqIds.length > 0 ? Object.create(null) : null;
  if (urlReqIdLookup) urlReqIds.forEach(function(id) { urlReqIdLookup[id] = true; });
  var hasUrlFilterR = !!(urlReqStatus || urlReqDateFrom || urlReqDateTo || urlReqIds.length);
  if (hasUrlFilterR && (urlReqDateFrom || urlReqDateTo) && _wsTenantTz === null) {
    wsEnsureTenantTz().then(function() { renderWholesaleRequests(); });
  }

  MastDB.get('admin/wholesaleRequests').then(function(snapVal) {
    wholesaleRequestsData = snapVal || {};
    var requests = Object.keys(wholesaleRequestsData).map(function(k) {
      var r = wholesaleRequestsData[k];
      r._id = k;
      return r;
    }).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

    if (hasUrlFilterR) {
      requests = requests.filter(function(r) {
        if (urlReqStatus && (r.status || 'pending') !== urlReqStatus) return false;
        if (urlReqIdLookup && !urlReqIdLookup[r._id]) return false;
        if (urlReqDateFrom || urlReqDateTo) {
          var p = wsTzPartsFromIso(r.createdAt || '');
          if (!p) return false;
          var ds = p.year + '-' + p.month + '-' + p.day;
          if (urlReqDateFrom && ds < urlReqDateFrom) return false;
          if (urlReqDateTo && ds > urlReqDateTo) return false;
        }
        return true;
      });
    }

    if (requests.length === 0 && !hasUrlFilterR) {
      container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#128233;</div>' +
        '<h3 style="font-weight:600;margin-bottom:8px;">No access requests</h3>' +
        '<p style="font-size:0.85rem;">When buyers request wholesale access from the catalog page, their requests will appear here.</p>' +
      '</div>';
      return;
    }

    var html = '';

    // URL-filter banner
    if (hasUrlFilterR) {
      var bpartsR = [];
      if (urlReqIds.length) bpartsR.push(urlReqIds.length + ' selected request' + (urlReqIds.length === 1 ? '' : 's'));
      if (urlReqStatus) bpartsR.push('status: ' + urlReqStatus);
      if (urlReqDateFrom && urlReqDateTo) bpartsR.push('from ' + urlReqDateFrom + ' to ' + urlReqDateTo);
      else if (urlReqDateFrom) bpartsR.push('from ' + urlReqDateFrom + ' onward');
      else if (urlReqDateTo) bpartsR.push('through ' + urlReqDateTo);
      html += '<div id="wholesaleReqUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>📨 Showing ' + bpartsR.join(', ') + ' (' + requests.length + ')</span>' +
        '<button type="button" onclick="clearWholesaleFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    if (requests.length === 0) {
      html += '<div style="text-align:center;padding:30px;color:#999;font-size:0.85rem;">No requests match the filter.</div>';
      container.innerHTML = html;
      return;
    }

    // Pending first, then resolved
    var pending = requests.filter(function(r) { return r.status === 'pending'; });
    var resolved = requests.filter(function(r) { return r.status !== 'pending'; });

    if (pending.length > 0) {
      html += '<div style="font-weight:600;font-size:0.85rem;margin-bottom:12px;color:var(--charcoal);">Pending (' + pending.length + ')</div>';
      html += '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;">';
      pending.forEach(function(r) {
        html += '<div style="background:#fff;border:1px solid #e8e0d4;border-radius:8px;padding:16px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
            '<div>' +
              '<div style="font-weight:500;font-size:0.9rem;">' + esc(r.email) + '</div>' +
              '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' +
                (r.displayName ? esc(r.displayName) + ' &middot; ' : '') +
                'Requested ' + formatDate(r.createdAt) +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
              '<button onclick="approveWholesaleRequest(\'' + esc(r._id) + '\')" style="background:var(--teal);color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Approve</button>' +
              '<button onclick="denyWholesaleRequest(\'' + esc(r._id) + '\')" style="background:none;border:1px solid var(--danger);color:var(--danger);padding:6px 14px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Deny</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    if (resolved.length > 0) {
      html += '<div style="font-weight:600;font-size:0.85rem;margin-bottom:12px;color:var(--warm-gray);">Resolved</div>';
      html += '<div style="display:flex;flex-direction:column;gap:8px;">';
      resolved.forEach(function(r) {
        var statusStyle = r.status === 'approved' ? 'background:rgba(45,125,70,0.15);color:#2D7D46;' : 'background:rgba(220,53,69,0.15);color:var(--danger);';
        html += '<div style="background:#fff;border:1px solid #e8e0d4;border-radius:8px;padding:14px 16px;opacity:0.7;display:flex;justify-content:space-between;align-items:center;">' +
          '<div>' +
            '<div style="font-weight:500;font-size:0.9rem;">' + esc(r.email) + '</div>' +
            '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' +
              (r.displayName ? esc(r.displayName) + ' &middot; ' : '') +
              formatDate(r.createdAt) +
            '</div>' +
          '</div>' +
          '<span style="font-size:0.72rem;padding:3px 8px;border-radius:4px;text-transform:capitalize;' + statusStyle + '">' + esc(r.status) + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  });
}

function approveWholesaleRequest(requestId) {
  var r = wholesaleRequestsData[requestId];
  if (!r) return;

  // 1. Add to authorized users
  var key = wsEmailToKey(r.email);
  var authData = {
    active: true,
    displayName: r.displayName || '',
    approvedFrom: requestId,
    createdAt: new Date().toISOString()
  };

  // 2. Update request status
  var updates = {};
  updates['admin/wholesaleAuthorized/' + key] = authData;
  updates['admin/wholesaleRequests/' + requestId + '/status'] = 'approved';
  updates['admin/wholesaleRequests/' + requestId + '/resolvedAt'] = new Date().toISOString();

  MastDB.multiUpdate(updates).then(function() {
    showToast('Approved! ' + r.email + ' now has wholesale access.');
    renderWholesaleRequests();
    updateWholesaleRequestBadge();
  }).catch(function(err) {
    showToast('Error: ' + err.message, true);
  });
}

async function denyWholesaleRequest(requestId) {
  var r = wholesaleRequestsData[requestId];
  if (!r) return;
  if (!await mastConfirm('Deny wholesale access request from ' + r.email + '?', { title: 'Deny Request' })) return;

  var updates = {};
  updates['admin/wholesaleRequests/' + requestId + '/status'] = 'denied';
  updates['admin/wholesaleRequests/' + requestId + '/resolvedAt'] = new Date().toISOString();

  MastDB.multiUpdate(updates).then(function() {
    showToast('Request denied for ' + r.email);
    renderWholesaleRequests();
    updateWholesaleRequestBadge();
  }).catch(function(err) {
    showToast('Error: ' + err.message, true);
  });
}

function loadQRLibrary(callback) {
  if (window.QRCode) { callback(); return; }
  var script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  script.onload = callback;
  script.onerror = function() { showToast('Failed to load QR library', true); };
  document.head.appendChild(script);
}

// ── PDF Catalog hosting ──

function copyQRImage() {
  // Try canvas first, fall back to img (qrcodejs generates both)
  var canvas = document.querySelector('#pdfQRCanvas canvas');
  var img = document.querySelector('#pdfQRCanvas img');
  var src = canvas ? canvas.toDataURL('image/png') : (img ? img.src : null);
  if (!src) { showToast('QR code not ready yet'); return; }

  // Convert data URL to blob synchronously to preserve user gesture
  var parts = src.split(',');
  var mime = parts[0].match(/:(.*?);/)[1];
  var raw = atob(parts[1]);
  var arr = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  var blob = new Blob([arr], { type: mime });

  navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]).then(function() {
    showToast('QR image copied to clipboard!');
  }).catch(function() {
    // Fallback: download if clipboard blocked
    var a = document.createElement('a');
    a.href = src;
    a.download = MastDB.tenantId() + '-wholesale-qr.png';
    a.click();
    showToast('QR image downloaded (clipboard not available)');
  });
}

function uploadWholesalePDF() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf';
  input.onchange = function() {
    var file = input.files[0];
    if (!file) return;
    var statusEl = document.getElementById('wholesalePdfStatus');
    if (statusEl) statusEl.textContent = 'Uploading...';

    var ref = storage.ref(MastDB.tenantId() + '/wholesale/catalog-2026.pdf');
    ref.put(file, { contentType: 'application/pdf' }).then(function() {
      return ref.getDownloadURL();
    }).then(function(url) {
      // Save URL in config
      MastDB.set('admin/wholesaleConfig/pdfUrl', url);
      if (statusEl) statusEl.textContent = 'Uploaded!';
      showToast('PDF uploaded successfully');
      checkWholesalePdfStatus();
    }).catch(function(err) {
      if (statusEl) statusEl.textContent = 'Upload failed';
      showToast('Upload error: ' + err.message, true);
    });
  };
  input.click();
}

function checkWholesalePdfStatus() {
  MastDB.get('admin/wholesaleConfig/pdfUrl').then(function(snapVal) {
    var url = snapVal;
    var statusEl = document.getElementById('wholesalePdfStatus');
    var qrEl = document.getElementById('wholesalePdfQR');
    if (url) {
      if (statusEl) statusEl.innerHTML = '<a href="' + esc(url) + '" target="_blank" style="color:var(--teal);">View PDF</a>';
      if (qrEl) {
        qrEl.innerHTML = '<div style="display:flex;gap:16px;align-items:center;">' +
          '<div id="pdfQRCanvas" style="display:inline-block;"></div>' +
          '<div>' +
            '<div style="font-size:0.78rem;font-weight:600;">PDF Catalog QR</div>' +
            '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Links directly to the downloadable PDF</div>' +
            '<button onclick="copyToClipboard(\'' + esc(url) + '\'); showToast(\'PDF link copied!\')" style="margin-top:8px;background:none;border:1px solid #ccc;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;">Copy PDF Link</button>' +
            '<button onclick="copyQRImage()" style="margin-top:4px;background:none;border:1px solid #ccc;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;">Copy QR Image</button>' +
          '</div>' +
        '</div>';
        loadQRLibrary(function() {
          var canvas = document.getElementById('pdfQRCanvas');
          if (canvas) {
            new QRCode(canvas, {
              text: url,
              width: 120,
              height: 120,
              colorDark: 'var(--charcoal)',
              colorLight: '#ffffff',
              correctLevel: QRCode.CorrectLevel.M
            });
          }
        });
      }
    } else {
      if (statusEl) statusEl.textContent = 'No PDF uploaded yet';
      if (qrEl) qrEl.innerHTML = '';
    }
  });
}

// ── Wholesale Orders sub-view ──

function renderWholesaleOrders() {
  var container = document.getElementById('wholesaleSubContent');
  if (!container) return;

  container.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading orders...</div>';

  MastDB.wholesaleOrders.list(100).then(function(snap) {
    wholesaleOrdersData = snap.val() || {};
    var orders = Object.keys(wholesaleOrdersData).map(function(k) {
      var o = wholesaleOrdersData[k];
      o._id = k;
      return o;
    }).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

    if (orders.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#128230;</div>' +
        '<h3 style="font-weight:600;margin-bottom:8px;">No wholesale orders yet</h3>' +
        '<p style="font-size:0.85rem;">Share your catalog link to get started. Orders placed by wholesale buyers will appear here.</p>' +
      '</div>';
      return;
    }

    var html = '<div style="margin-bottom:16px;font-size:0.85rem;color:var(--warm-gray);">' + orders.length + ' order' + (orders.length !== 1 ? 's' : '') + '</div>';
    html += '<table class="data-table" style="width:100%;">' +
      '<thead><tr>' +
        '<th>Order #</th><th>Buyer</th><th>Date</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th>' +
      '</tr></thead><tbody>';

    orders.forEach(function(o) {
      var itemCount = (o.items || []).reduce(function(sum, it) { return sum + (it.qty || 1); }, 0);
      var statusColors = {
        pending_check_verification: 'background:rgba(245,158,11,0.15);color:#D97706;',
        paid: 'background:rgba(45,125,70,0.15);color:#2D7D46;',
        processing: 'background:rgba(59,130,246,0.15);color:#3B82F6;',
        shipped: 'background:rgba(42,124,111,0.15);color:var(--teal);',
        completed: 'background:rgba(45,125,70,0.15);color:#2D7D46;',
        cancelled: 'background:rgba(220,53,69,0.15);color:var(--danger);'
      };
      var statusStyle = statusColors[o.status] || 'background:#f0f0f0;color:#666;';
      var statusLabel = (o.status || 'unknown').replace(/_/g, ' ');

      html += '<tr onclick="viewWholesaleOrder(\'' + esc(o._id) + '\')" style="cursor:pointer;">' +
        '<td style="font-family:monospace;font-size:0.78rem;">' + esc(o.orderNumber || o._id.substr(-6)) + '</td>' +
        '<td>' + esc(o.buyerName || o.buyerEmail || 'Unknown') + '</td>' +
        '<td style="font-size:0.78rem;">' + formatDate(o.createdAt) + '</td>' +
        '<td style="text-align:center;">' + itemCount + '</td>' +
        '<td>$' + ((o.totalCents || 0) / 100).toFixed(2) + '</td>' +
        '<td style="font-size:0.78rem;">' + esc(o.paymentMethod === 'check' ? 'Check' : 'Card') + '</td>' +
        '<td><span style="font-size:0.72rem;padding:3px 8px;border-radius:4px;text-transform:capitalize;' + statusStyle + '">' + statusLabel + '</span></td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  });
}

function viewWholesaleOrder(orderId) {
  var o = wholesaleOrdersData[orderId];
  if (!o) return;

  var items = o.items || [];
  var itemsHtml = items.map(function(it) {
    var opts = it.options ? Object.entries(it.options).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ') : '';
    return '<tr>' +
      '<td>' + esc(it.name) + (opts ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(opts) + '</div>' : '') + '</td>' +
      '<td style="text-align:center;">' + (it.qty || 1) + '</td>' +
      '<td style="text-align:right;">$' + ((it.priceCents || 0) / 100).toFixed(2) + '</td>' +
      '<td style="text-align:right;">$' + (((it.priceCents || 0) * (it.qty || 1)) / 100).toFixed(2) + '</td>' +
    '</tr>';
  }).join('');

  var statusOptions = ['pending_check_verification', 'paid', 'processing', 'shipped', 'completed', 'cancelled'];
  var statusSelect = '<select onchange="updateWholesaleOrderStatus(\'' + esc(orderId) + '\', this.value)" style="padding:4px 8px;border-radius:4px;border:1px solid #ccc;font-size:0.78rem;">';
  statusOptions.forEach(function(s) {
    statusSelect += '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>';
  });
  statusSelect += '</select>';

  var html = '<div style="margin-bottom:16px;">' +
    '<a href="javascript:void(0)" onclick="renderWholesaleOrders()" style="color:var(--teal);font-size:0.85rem;text-decoration:none;">&larr; Back to orders</a>' +
  '</div>' +
  '<div style="background:#fff;border:1px solid #e8e0d4;border-radius:8px;padding:20px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">' +
      '<div>' +
        '<h3 style="font-weight:700;font-size:1.15rem;">Order ' + esc(o.orderNumber || orderId.substr(-6)) + '</h3>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' + formatDate(o.createdAt) + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        '<span style="font-size:0.78rem;">Status:</span>' + statusSelect +
      '</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">' +
      '<div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Buyer</div>' +
        '<div style="font-size:0.9rem;">' + esc(o.buyerName || 'N/A') + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(o.buyerEmail || '') + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(o.buyerPhone || '') + '</div>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Shipping</div>' +
        '<div style="font-size:0.85rem;">' + esc(o.shipping ? (o.shipping.name || '') : '') + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">' +
          esc(o.shipping ? [o.shipping.address1, o.shipping.city, o.shipping.state, o.shipping.zip].filter(Boolean).join(', ') : 'N/A') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Payment: ' + esc(o.paymentMethod === 'check' ? 'Pay by Check' : 'Credit Card') + '</div>' +
    '<table class="data-table" style="width:100%;">' +
      '<thead><tr><th>Product</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
      '<tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;">Total</td><td style="text-align:right;font-weight:700;">$' + ((o.totalCents || 0) / 100).toFixed(2) + '</td></tr></tfoot>' +
    '</table>' +
  '</div>';

  document.getElementById('wholesaleSubContent').innerHTML = html;
}

function updateWholesaleOrderStatus(orderId, newStatus) {
  MastDB.wholesaleOrders.update(orderId, { status: newStatus, updatedAt: new Date().toISOString() }).then(function() {
    showToast('Order status updated to ' + newStatus.replace(/_/g, ' '));
  }).catch(function(err) {
    showToast('Error: ' + err.message, true);
  });
}

// ── Setup sub-view (seed data migration) ──

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(function() {
    // Fallback
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

// ── Window exports for onclick handlers ──
window.renderWholesaleAdmin = renderWholesaleAdmin;
window.clearWholesaleFilter = function() {
  var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var clean = {};
  Object.keys(rp || {}).forEach(function(k) {
    if (k !== 'subView' && k !== 'active' && k !== 'accountIds' && k !== 'status' && k !== 'dateFrom' && k !== 'dateTo' && k !== 'requestIds') clean[k] = rp[k];
  });
  if (typeof window.navigateTo === 'function') window.navigateTo('wholesale', clean);
  else location.hash = '#wholesale';
  setTimeout(function() { if (typeof renderWholesaleAdmin === 'function') renderWholesaleAdmin(); }, 0);
};
window.switchWholesaleView = switchWholesaleView;
window.renderWholesaleUsers = renderWholesaleUsers;
window.addWholesaleUser = addWholesaleUser;
window.revokeWholesaleUser = revokeWholesaleUser;
window.renderWholesaleRequests = renderWholesaleRequests;
window.approveWholesaleRequest = approveWholesaleRequest;
window.denyWholesaleRequest = denyWholesaleRequest;
window.renderWholesaleOrders = renderWholesaleOrders;
window.viewWholesaleOrder = viewWholesaleOrder;
window.updateWholesaleOrderStatus = updateWholesaleOrderStatus;
// W2a wholesale accounts
window.renderWholesaleAccounts = renderWholesaleAccounts;
window.openNewWholesaleAccountModal = openNewWholesaleAccountModal;
window.closeWholesaleAccountModal = closeWholesaleAccountModal;
window.editWholesaleAccount = editWholesaleAccount;
window.deleteWholesaleAccount = deleteWholesaleAccount;
window.saveWholesaleAccount = saveWholesaleAccount;
// renderWholesaleSetup and runWholesaleSeed removed — wholesale products now managed via product admin
window.uploadWholesalePDF = uploadWholesalePDF;
window.copyQRImage = copyQRImage;
window.copyToClipboard = copyToClipboard;

// ── Module registration ──
MastAdmin.registerModule('wholesale', {
  routes: {
    'wholesale': { tab: 'wholesaleTab', setup: function() { renderWholesaleAdmin(); } }
  }
});

})();
