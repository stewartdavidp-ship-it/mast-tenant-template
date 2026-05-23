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
var wholesaleSubView = 'orders'; // accounts | orders | users | requests | dormant
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
  if (urlSubView && (urlSubView === 'accounts' || urlSubView === 'orders' || urlSubView === 'users' || urlSubView === 'requests' || urlSubView === 'dormant' || urlSubView === 'cadence' || urlSubView === 'account')) {
    wholesaleSubView = urlSubView;
  }
  // W1.8: read accountId param for inline detail view.
  var urlAccountId = (rp && typeof rp.accountId === 'string') ? rp.accountId : '';

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
      '<div class="view-tab' + (wholesaleSubView === 'cadence' ? ' active' : '') + '" onclick="switchWholesaleView(\'cadence\')">Cadence</div>' +
      '<div class="view-tab' + (wholesaleSubView === 'users' ? ' active' : '') + '" onclick="switchWholesaleView(\'users\')">Authorized Users</div>' +
      '<div class="view-tab' + (wholesaleSubView === 'requests' ? ' active' : '') + '" onclick="switchWholesaleView(\'requests\')">Access Requests <span id="wsRequestBadge"></span></div>' +
      '<div class="view-tab' + (wholesaleSubView === 'dormant' ? ' active' : '') + '" onclick="switchWholesaleView(\'dormant\')">Dormant</div>' +
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
  else if (wholesaleSubView === 'dormant') renderWholesaleDormant();
  else if (wholesaleSubView === 'cadence') renderWholesaleCadence();
  else if (wholesaleSubView === 'account') renderWholesaleAccountDetail(urlAccountId);
}

// W1.8: inline detail surface for one wholesale account. Reachable via
// #wholesale?subView=account&accountId=<id>.
function renderWholesaleAccountDetail(accountId) {
  var container = document.getElementById('wholesaleSubContent');
  if (!container) return;
  if (!accountId) {
    container.innerHTML = '<div style="padding:24px;color:var(--warm-gray);">No account selected. <a href="#wholesale?subView=accounts" style="color:var(--teal);">Back to accounts</a>.</div>';
    return;
  }
  container.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading account...</div>';

  // Load account + orders in parallel. Reuse cached data where possible.
  var loadAccount = wholesaleAccountsData[accountId]
    ? Promise.resolve(wholesaleAccountsData[accountId])
    : MastDB.wholesaleAccounts.list(500).then(function(snap) {
        var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
        wholesaleAccountsData = val || {};
        return wholesaleAccountsData[accountId] || null;
      });
  var loadOrders = (wholesaleOrdersData && Object.keys(wholesaleOrdersData).length)
    ? Promise.resolve(wholesaleOrdersData)
    : MastDB.query('admin/orders').orderByChild('type').equalTo('wholesale').limitToLast(500).once('value').then(function(snap) {
        wholesaleOrdersData = snap.val() || {};
        return wholesaleOrdersData;
      });

  Promise.all([loadAccount, loadOrders]).then(function(results) {
    var a = results[0];
    var allOrders = results[1] || {};
    if (!a) {
      container.innerHTML = '<div style="padding:24px;color:var(--danger);">Account not found. <a href="#wholesale?subView=accounts" style="color:var(--teal);">Back to accounts</a>.</div>';
      return;
    }
    // Filter orders by wholesaleAccountId.
    var linkedOrders = Object.keys(allOrders).map(function(k) {
      var o = allOrders[k]; o._id = k; return o;
    }).filter(function(o) { return o.wholesaleAccountId === accountId; })
      .sort(function(x, y) { return (y.createdAt || 0) - (x.createdAt || 0); });

    var openInvoices = linkedOrders.filter(function(o) {
      var inv = o.invoice || {};
      return inv && (inv.status === 'sent' || inv.status === 'partial' || inv.status === 'overdue');
    });

    var contacts = a.contacts || (a.primaryContact ? [a.primaryContact] : []);
    var contactsHtml = contacts.length === 0
      ? '<div style="color:var(--warm-gray);font-size:0.85rem;">No contacts on file.</div>'
      : contacts.map(function(c) {
          return '<div style="padding:6px 0;border-bottom:1px solid var(--cream-dark,#e8e0d4);font-size:0.85rem;">' +
            '<div style="font-weight:600;">' + esc(c.name || '—') + (c.role ? ' <span style="color:var(--warm-gray);font-weight:400;">· ' + esc(c.role) + '</span>' : '') + '</div>' +
            '<div style="color:var(--warm-gray);">' + esc(c.email || '') + (c.phone ? ' · ' + esc(c.phone) : '') + '</div>' +
          '</div>';
        }).join('');

    var ordersHtml = linkedOrders.length === 0
      ? '<div style="color:var(--warm-gray);font-size:0.85rem;padding:8px 0;">No linked orders yet.</div>'
      : '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
          '<thead><tr style="border-bottom:1px solid var(--cream-dark,#e8e0d4);text-align:left;">' +
            '<th style="padding:6px 0;">Order</th><th>Date</th><th>Status</th><th align="right">Total</th>' +
          '</tr></thead><tbody>' +
          linkedOrders.slice(0, 50).map(function(o) {
            var num = (window.getOrderDisplayNumber ? window.getOrderDisplayNumber(o) : (o._id || '').substring(0, 8));
            var dt = o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '—';
            var total = (typeof o.total === 'number') ? '$' + o.total.toFixed(2) : '—';
            return '<tr style="border-bottom:1px solid var(--cream-dark,#e8e0d4);"><td style="padding:6px 0;font-family:monospace;">' + esc(num) + '</td><td>' + dt + '</td><td>' + esc(o.status || '—') + '</td><td align="right">' + total + '</td></tr>';
          }).join('') +
        '</tbody></table>';

    var invHtml = openInvoices.length === 0
      ? '<div style="color:var(--warm-gray);font-size:0.85rem;padding:8px 0;">No open invoices.</div>'
      : openInvoices.map(function(o) {
          var inv = o.invoice || {};
          var num = (window.getOrderDisplayNumber ? window.getOrderDisplayNumber(o) : (o._id || '').substring(0, 8));
          return '<div style="padding:6px 0;border-bottom:1px solid var(--cream-dark,#e8e0d4);font-size:0.85rem;display:flex;justify-content:space-between;">' +
            '<span style="font-family:monospace;">' + esc(num) + '</span>' +
            '<span style="color:' + (inv.status === 'overdue' ? '#dc2626' : 'var(--amber)') + ';">' + esc(inv.status || 'open') + '</span>' +
          '</div>';
        }).join('');

    var termsLabel = (WS_NET_TERMS.find(function(t) { return t.v === a.netTerms; }) || { l: '—' }).l;
    var termsVersion = a.termsVersion || '—';

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
      '<div>' +
        '<a href="#wholesale?subView=accounts" style="color:var(--teal);font-size:0.85rem;text-decoration:none;">&larr; All accounts</a>' +
        '<h3 style="margin:6px 0 0;font-size:1.15rem;">' + esc(a.name || '(unnamed)') + '</h3>' +
      '</div>' +
      '<button class="btn-small" onclick="editWholesaleAccount(\'' + esc(accountId) + '\')" style="background:var(--teal);color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Edit account</button>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
      '<section style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:16px;">' +
        '<h4 style="margin:0 0 10px;font-size:0.9rem;">Terms</h4>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);">NET: ' + esc(termsLabel) + ' · Version: ' + esc(termsVersion) + '</div>' +
      '</section>' +
      '<section style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:16px;">' +
        '<h4 style="margin:0 0 10px;font-size:0.9rem;">Open invoices (' + openInvoices.length + ')</h4>' + invHtml +
      '</section>' +
      '<section style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:16px;">' +
        '<h4 style="margin:0 0 10px;font-size:0.9rem;">Contacts</h4>' + contactsHtml +
      '</section>' +
      '<section style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:16px;">' +
        '<h4 style="margin:0 0 10px;font-size:0.9rem;">Rep notes</h4>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);white-space:pre-wrap;">' + esc(a.repNotes || a.notes || '—') + '</div>' +
      '</section>' +
      '<section style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:16px;grid-column:1 / -1;">' +
        '<h4 style="margin:0 0 10px;font-size:0.9rem;">Linked orders (' + linkedOrders.length + ')</h4>' + ordersHtml +
      '</section>' +
    '</div>';
    container.innerHTML = html;
  }).catch(function(err) {
    container.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading account: ' + esc(err && err.message || String(err)) + '</div>';
  });
}
window.renderWholesaleAccountDetail = renderWholesaleAccountDetail;

function switchWholesaleView(view) {
  wholesaleSubView = view;
  renderWholesaleAdmin();
}

// W1.8: navigate to inline account detail. Updates the hash so the
// browser back button + subView reload work via the URL-driven branch.
function viewWholesaleAccount(accountId) {
  if (!accountId) return;
  location.hash = '#wholesale?subView=account&accountId=' + encodeURIComponent(accountId);
}
window.viewWholesaleAccount = viewWholesaleAccount;

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
        // W2d — linked wholesale account display (resolved from wholesaleAccountsData
        // when available; falls back to "—" when missing or the cache hasn't loaded).
        var linkedAccount = u.wholesaleAccountId ? (wholesaleAccountsData[u.wholesaleAccountId] || null) : null;
        var linkedAccountLabel = linkedAccount ? linkedAccount.name : (u.wholesaleAccountId ? '(account removed)' : 'No linked account');
        html += '<div style="background:#fff;border:1px solid #e8e0d4;border-radius:8px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;' + (!isActive ? 'opacity:0.5;' : '') + '">' +
          '<div>' +
            '<div style="font-weight:500;font-size:0.9rem;">' + esc(u._email) + '</div>' +
            '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' +
              (u.displayName ? esc(u.displayName) + ' &middot; ' : '') +
              'Added ' + formatDate(u.createdAt) +
              (u.approvedFrom ? ' &middot; From request' : '') +
            '</div>' +
            '<div style="font-size:0.78rem;color:' + (u.wholesaleAccountId ? 'var(--teal)' : 'var(--warm-gray)') + ';margin-top:4px;">' + esc(linkedAccountLabel) + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<span style="font-size:0.72rem;padding:3px 8px;border-radius:4px;' + (isActive ? 'background:rgba(45,125,70,0.15);color:#2D7D46;' : 'background:rgba(220,53,69,0.15);color:var(--danger);') + '">' + (isActive ? 'Active' : 'Revoked') + '</span>' +
            (isActive ? '<button onclick="openWholesaleUserModal(\'' + esc(u._key) + '\')" style="background:none;border:1px solid var(--teal);color:var(--teal);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;">' + (u.wholesaleAccountId ? 'Edit' : 'Link') + '</button>' : '') +
            (isActive ? '<button onclick="revokeWholesaleUser(\'' + esc(u._key) + '\')" style="background:none;border:1px solid var(--danger);color:var(--danger);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;">Revoke</button>' : '') +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  });
}

// W2d — replaced primitive mastPrompt-based addWholesaleUser with a real modal
// that includes a wholesaleAccount picker, so a buyer's authorization can be
// linked to the commercial-terms record at the moment of grant (or later via
// the same modal in edit mode). The legacy addWholesaleUser export is kept
// pointing at the new flow for backward compat.
async function openWholesaleUserModal(existingEmailKey) {
  var isEdit = !!existingEmailKey;
  var existing = isEdit ? (wholesaleAuthorizedData[existingEmailKey] || {}) : {};
  var existingEmail = isEdit ? wsKeyToEmail(existingEmailKey) : '';

  // Ensure wholesaleAccountsData is fresh — picker lists from it.
  try {
    var snap = await MastDB.wholesaleAccounts.list(200);
    var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
    wholesaleAccountsData = val || {};
  } catch (_e) {}

  var accountOptions = '<option value="">— None / unlinked —</option>';
  Object.keys(wholesaleAccountsData).forEach(function(id) {
    var a = wholesaleAccountsData[id];
    var selected = existing.wholesaleAccountId === id ? ' selected' : '';
    accountOptions += '<option value="' + esc(id) + '"' + selected + '>' + esc(a.name || '(unnamed)') + '</option>';
  });

  var overlay = document.createElement('div');
  overlay.id = 'wsUserModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:12px;padding:24px;width:100%;max-width:480px;margin-top:40px;color:var(--charcoal);">' +
      '<h3 style="margin:0 0 16px;font-size:1.15rem;">' + (isEdit ? 'Edit Wholesale User' : 'Add Wholesale User') + '</h3>' +
      '<form id="wsUserForm" onsubmit="event.preventDefault();saveWholesaleUserLink(' + (isEdit ? '\'' + esc(existingEmailKey) + '\'' : 'null') + ');return false;">' +
        '<div style="margin-bottom:14px;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Buyer email *</label>' +
          '<input id="wsu_email" required value="' + esc(existingEmail) + '"' + (isEdit ? ' disabled style="background:#f5f5f5;color:#666;"' : '') + ' placeholder="buyer@example.com" type="email" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div style="margin-bottom:14px;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Linked wholesale account</label>' +
          '<select id="wsu_accountId" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;background:#fff;">' + accountOptions + '</select>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' +
            (Object.keys(wholesaleAccountsData).length === 0
              ? 'No accounts yet — create one on the Accounts tab to enable linking.'
              : 'Links this buyer to the commercial-terms record (NET terms, credit, MOQ, etc).') +
          '</div></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button type="button" onclick="closeWholesaleUserModal()" class="btn-small" style="background:#fff;color:var(--charcoal);border:1px solid #ddd;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.85rem;">Cancel</button>' +
          '<button type="submit" class="btn-small" style="background:var(--teal);color:#fff;border:none;padding:8px 18px;border-radius:4px;cursor:pointer;font-size:0.85rem;">' + (isEdit ? 'Save' : 'Add user') + '</button>' +
        '</div>' +
      '</form>' +
    '</div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeWholesaleUserModal(); });
  document.body.appendChild(overlay);
  setTimeout(function() { var f = document.getElementById(isEdit ? 'wsu_accountId' : 'wsu_email'); if (f) f.focus(); }, 30);
}

function closeWholesaleUserModal() {
  var el = document.getElementById('wsUserModal');
  if (el) el.parentNode.removeChild(el);
}

async function saveWholesaleUserLink(existingEmailKey) {
  var isEdit = !!existingEmailKey;
  var email = isEdit ? wsKeyToEmail(existingEmailKey) : (document.getElementById('wsu_email').value || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showToast('Invalid email address', true); return; }
  var accountId = (document.getElementById('wsu_accountId').value || '').trim();
  var key = wsEmailToKey(email);
  try {
    if (isEdit) {
      // Use update so we don't clobber other fields (createdAt, approvedFrom, etc).
      await MastDB.update('admin/wholesaleAuthorized/' + key, {
        wholesaleAccountId: accountId || null,
        updatedAt: new Date().toISOString()
      });
      showToast('User updated');
    } else {
      await MastDB.set('admin/wholesaleAuthorized/' + key, {
        active: true,
        createdAt: new Date().toISOString(),
        wholesaleAccountId: accountId || null
      });
      showToast('Wholesale access granted to ' + email);
    }
    closeWholesaleUserModal();
    renderWholesaleUsers();
  } catch (err) {
    showToast('Error: ' + (err.message || String(err)), true);
  }
}

// Backward-compat — older onclick handlers still reference addWholesaleUser.
async function addWholesaleUser() { return openWholesaleUserModal(null); }

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
        html += '<div onclick="viewWholesaleAccount(\'' + esc(a._id) + '\')" style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:16px;">';
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

// ── Dormant accounts (W2e) ──
// Wholesale orders today carry a buyerEmail but no direct wholesaleAccountId.
// ── Cadence sub-view (Build 2) ─────────────────────────────────────────
// Per-account learned reorder cadence (median of own intervals) + cadence-
// aware overdue chip using tenant-configurable thresholds. Mirrors the
// server-side wholesale.getWholesaleActivity compute so the URL-shared
// admin view stays consistent with what AI assistants see via MCP.
//
// Thresholds live at admin/config/customerSuccess/wholesaleCadenceThresholds.
// If absent, fall back to defaults: dueSoon=0.9, overdue=1.25, lapsed=2.0,
// defaultIntervalDays=90.

var WS_CADENCE_DEFAULTS = { dueSoonMultiplier: 0.9, overdueMultiplier: 1.25, lapsedMultiplier: 2.0, defaultIntervalDays: 90 };

function wsMedianIntervalDays(timestampsMs) {
  if (!timestampsMs || timestampsMs.length < 2) return null;
  var sorted = timestampsMs.slice().sort(function(a,b){ return a-b; });
  var intervals = [];
  for (var i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i-1]);
  intervals.sort(function(a,b){ return a-b; });
  var mid = Math.floor(intervals.length / 2);
  var medianMs = intervals.length % 2 === 0 ? (intervals[mid-1] + intervals[mid]) / 2 : intervals[mid];
  return Math.max(1, Math.round(medianMs / 86400000));
}

function wsClassifyOverdue(daysSince, intervalDays, t) {
  if (daysSince == null || !intervalDays || intervalDays <= 0) return { status: 'unknown', ratio: null };
  var ratio = Math.round((daysSince / intervalDays) * 100) / 100;
  if (ratio >= t.lapsedMultiplier) return { status: 'lapsed', ratio: ratio };
  if (ratio >= t.overdueMultiplier) return { status: 'overdue', ratio: ratio };
  if (ratio >= t.dueSoonMultiplier) return { status: 'due-soon', ratio: ratio };
  return { status: 'on-track', ratio: ratio };
}

function wsCadenceChip(status, ratio) {
  if (!status || status === 'unknown') return '<span style="color:var(--warm-gray-light);font-size:0.72rem;">—</span>';
  var bg, color, label;
  if (status === 'on-track')      { bg = 'rgba(34,197,94,0.20)'; color = '#7ddca0'; label = 'On track'; }
  else if (status === 'due-soon') { bg = 'rgba(245,158,11,0.30)'; color = '#fbcc70'; label = 'Due soon'; }
  else if (status === 'overdue')  { bg = 'rgba(220,53,69,0.30)'; color = '#f49aa3'; label = 'Overdue'; }
  else                            { bg = 'rgba(155,28,28,0.40)'; color = '#f49aa3'; label = 'Lapsed'; }
  var tip = (typeof ratio === 'number') ? (' title="' + ratio.toFixed(2) + '× expected interval"') : '';
  return '<span class="status-badge" style="background:' + bg + ';color:' + color + ';"' + tip + '>' + esc(label) + '</span>';
}

function renderWholesaleCadence() {
  var container = document.getElementById('wholesaleSubContent');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading cadence…</div>';

  Promise.all([
    MastDB.query('admin/wholesaleAuthorized').once(),
    MastDB.query('orders').orderByChild('createdAt').limitToLast(2000).once(),
    MastDB.get('admin/config/customerSuccess/wholesaleCadenceThresholds').catch(function(){ return null; })
  ]).then(function(results) {
    var authData = (results[0] && typeof results[0].val === 'function' ? results[0].val() : results[0]) || {};
    var ordersData = (results[1] && typeof results[1].val === 'function' ? results[1].val() : results[1]) || {};
    var storedThresh = results[2] || null;
    var t = Object.assign({}, WS_CADENCE_DEFAULTS, storedThresh || {});

    var now = Date.now();
    var yearStartMs = Date.UTC(new Date().getUTCFullYear(), 0, 1);
    var twelveMonthsAgoMs = now - 365 * 86400000;

    // Index orders by email (lowercase). Skip cancelled.
    var perEmail = Object.create(null);
    Object.keys(ordersData).forEach(function(oid) {
      var o = ordersData[oid];
      if (!o || o.status === 'cancelled') return;
      var em = (o.email || o.customerEmail || (o.customer && o.customer.email) || '').toLowerCase();
      if (!em) return;
      var ts = o.createdAt ? new Date(o.createdAt).getTime() : NaN;
      if (isNaN(ts)) return;
      var rec = perEmail[em];
      if (!rec) { rec = perEmail[em] = { lastIso: '', count: 0, total: 0, ytd: 0, t12m: 0, timestamps: [] }; }
      rec.count++;
      var amount = (typeof o.totalCents === 'number') ? o.totalCents : (o.total || 0);
      rec.total += amount;
      if (ts >= yearStartMs) rec.ytd += amount;
      if (ts >= twelveMonthsAgoMs) rec.t12m += amount;
      rec.timestamps.push(ts);
      if ((o.createdAt || '') > rec.lastIso) rec.lastIso = o.createdAt || '';
    });

    var rows = Object.keys(authData).map(function(emailKey) {
      var rec = authData[emailKey] || {};
      var email = wsKeyToEmail(emailKey);
      var act = perEmail[email.toLowerCase()];
      var daysSince = act && act.lastIso ? Math.floor((now - new Date(act.lastIso).getTime()) / 86400000) : null;
      var learned = act ? wsMedianIntervalDays(act.timestamps) : null;
      var effective = learned != null ? learned : t.defaultIntervalDays;
      var cls = wsClassifyOverdue(daysSince, daysSince != null ? effective : null, t);
      return {
        email: email,
        displayName: rec.displayName || null,
        active: rec.active !== false,
        lastIso: (act && act.lastIso) || '',
        count: (act && act.count) || 0,
        ytdSpend: (act && act.ytd) || 0,
        t12mSpend: (act && act.t12m) || 0,
        daysSince: daysSince,
        learnedInterval: learned,
        effectiveInterval: daysSince != null ? effective : null,
        intervalSource: learned != null ? 'learned' : (daysSince != null ? 'default' : null),
        status: cls.status,
        ratio: cls.ratio
      };
    });

    // Sort: lapsed → overdue → due-soon → on-track → unknown. Within
    // bucket, highest ratio first.
    var statusRank = { lapsed: 0, overdue: 1, 'due-soon': 2, 'on-track': 3, unknown: 4 };
    rows.sort(function(a, b) {
      var ra = statusRank[a.status] != null ? statusRank[a.status] : 99;
      var rb = statusRank[b.status] != null ? statusRank[b.status] : 99;
      if (ra !== rb) return ra - rb;
      return (b.ratio || 0) - (a.ratio || 0);
    });

    var overdueCount = rows.filter(function(r){ return r.active && (r.status === 'overdue' || r.status === 'lapsed'); }).length;
    var dueSoonCount = rows.filter(function(r){ return r.active && r.status === 'due-soon'; }).length;

    var html = '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:12px;">' +
      esc(String(rows.length)) + ' authorized account' + (rows.length === 1 ? '' : 's') +
      ' &middot; <span style="color:#f49aa3;font-weight:600;">' + esc(String(overdueCount)) + ' overdue+lapsed</span>' +
      ' &middot; <span style="color:#fbcc70;font-weight:600;">' + esc(String(dueSoonCount)) + ' due soon</span>' +
      ' &middot; thresholds: dueSoon ' + t.dueSoonMultiplier + '× &middot; overdue ' + t.overdueMultiplier + '× &middot; lapsed ' + t.lapsedMultiplier + '×' +
      ' &middot; default cadence ' + t.defaultIntervalDays + 'd' +
      '</div>';

    if (rows.length === 0) {
      html += '<div style="text-align:center;padding:60px 20px;color:var(--warm-gray);">No authorized wholesale accounts yet.</div>';
    } else {
      html += '<div class="data-table"><table><thead><tr>' +
        '<th>Account</th>' +
        '<th>Last order</th>' +
        '<th>Days since</th>' +
        '<th>Expected cadence</th>' +
        '<th>Status</th>' +
        '<th>YTD spend</th>' +
        '<th>Trailing 12m</th>' +
        '<th>Orders</th>' +
        '</tr></thead><tbody>';
      rows.forEach(function(r) {
        var nameStr = r.displayName ? (r.displayName + ' (' + r.email + ')') : r.email;
        var lastStr = r.lastIso ? new Date(r.lastIso).toLocaleDateString() : '—';
        var daysStr = (r.daysSince == null) ? '—' : (r.daysSince + 'd');
        var intervalStr = (r.effectiveInterval == null) ? '—'
          : (r.effectiveInterval + 'd' + (r.intervalSource === 'learned' ? '' : ' (default)'));
        var ytdStr = '$' + (r.ytdSpend / 100).toFixed(2);
        var t12mStr = '$' + (r.t12mSpend / 100).toFixed(2);
        html += '<tr' + (r.active ? '' : ' style="opacity:0.5;"') + '>' +
          '<td>' + esc(nameStr) + '</td>' +
          '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(lastStr) + '</td>' +
          '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(daysStr) + '</td>' +
          '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(intervalStr) + '</td>' +
          '<td>' + wsCadenceChip(r.status, r.ratio) + '</td>' +
          '<td>' + esc(ytdStr) + '</td>' +
          '<td style="color:var(--warm-gray);">' + esc(t12mStr) + '</td>' +
          '<td style="color:var(--warm-gray);">' + esc(String(r.count)) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    container.innerHTML = html;
  }).catch(function(err) {
    container.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading cadence: ' + esc(err.message || String(err)) + '</div>';
  });
}

// We aggregate dormancy by walking authorized users (which DO carry the link)
// and matching wholesale orders by buyerEmail. Accounts with no linked users
// or no orders yet appear as "No orders yet" — useful because they flag
// accounts you've signed up but never sold to.
function renderWholesaleDormant() {
  var container = document.getElementById('wholesaleSubContent');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading dormant report...</div>';

  Promise.all([
    MastDB.wholesaleAccounts.list(200).then(function(s) { return (s && typeof s.val === 'function') ? s.val() : s; }),
    MastDB.get('admin/wholesaleAuthorized'),
    MastDB.query('admin/orders').orderByChild('type').equalTo('wholesale').limitToLast(500).once()
  ]).then(function(results) {
    var accounts = results[0] || {};
    var users = results[1] || {};
    var ordersRaw = results[2];
    var orders = (ordersRaw && typeof ordersRaw.val === 'function') ? (ordersRaw.val() || {}) : (ordersRaw || {});
    wholesaleAccountsData = accounts;

    // Build email → accountId via authorized users
    var emailToAccount = {};
    Object.keys(users).forEach(function(k) {
      var u = users[k];
      if (u && u.wholesaleAccountId) {
        var email = wsKeyToEmail(k);
        if (email) emailToAccount[email.toLowerCase()] = u.wholesaleAccountId;
      }
    });

    // Walk orders → account → track lastOrderAt + orderCount
    var stats = {}; // accountId → { lastOrderAt: ISO, orderCount: N, lastOrderId }
    Object.keys(orders).forEach(function(oid) {
      var o = orders[oid];
      if (!o) return;
      var email = (o.buyerEmail || o.email || '').toLowerCase();
      var accountId = emailToAccount[email];
      if (!accountId) return;
      var when = o.placedAt || o.createdAt || o.updatedAt;
      if (!when) return;
      if (!stats[accountId]) stats[accountId] = { lastOrderAt: when, orderCount: 1, lastOrderId: oid };
      else {
        stats[accountId].orderCount += 1;
        if (when > stats[accountId].lastOrderAt) {
          stats[accountId].lastOrderAt = when;
          stats[accountId].lastOrderId = oid;
        }
      }
    });

    // Build rows
    var nowMs = Date.now();
    var rows = Object.keys(accounts).map(function(id) {
      var a = accounts[id];
      var s = stats[id] || { lastOrderAt: null, orderCount: 0 };
      var daysSince = s.lastOrderAt ? Math.floor((nowMs - new Date(s.lastOrderAt).getTime()) / 86400000) : null;
      return {
        id: id,
        account: a,
        lastOrderAt: s.lastOrderAt,
        daysSince: daysSince,
        orderCount: s.orderCount,
        status: a.status || 'active'
      };
    });

    // Sort: never-ordered first (most concerning for an account you set up), then by daysSince desc.
    rows.sort(function(a, b) {
      if (a.lastOrderAt === null && b.lastOrderAt !== null) return -1;
      if (a.lastOrderAt !== null && b.lastOrderAt === null) return 1;
      if (a.lastOrderAt === null) return 0;
      return b.daysSince - a.daysSince;
    });

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);">' + rows.length + ' wholesale account' + (rows.length !== 1 ? 's' : '') + ' — sorted by days since last order</div>' +
      '<button class="btn-small" onclick="renderWholesaleDormant()" style="background:transparent;border:1px solid var(--teal);color:var(--teal);padding:8px 14px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Refresh</button>' +
    '</div>';

    if (rows.length === 0) {
      html += '<div style="text-align:center;padding:60px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#128203;</div>' +
        '<h3 style="font-weight:600;margin-bottom:8px;">No accounts yet</h3>' +
        '<p style="font-size:0.85rem;max-width:420px;margin:0 auto;">Once you create wholesale accounts and link authorized users to them, dormant accounts will surface here as days-since-last-order grows.</p>' +
      '</div>';
    } else {
      var anyLinked = rows.some(function(r) { return r.lastOrderAt !== null; });
      if (!anyLinked) {
        html += '<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#92400e;padding:10px 14px;margin-bottom:12px;border-radius:6px;font-size:0.85rem;">' +
          'No orders are linked to accounts yet. Open Authorized Users → click Link on each row to attach a buyer email to its account; orders from that buyer then attribute to the account here.' +
        '</div>';
      }
      html += '<div style="display:flex;flex-direction:column;gap:8px;">';
      rows.forEach(function(r) {
        var dormantBadge;
        if (r.lastOrderAt === null) dormantBadge = { color: '#9ca3af', label: 'No orders yet' };
        else if (r.daysSince >= 84) dormantBadge = { color: '#dc2626', label: r.daysSince + ' days' };
        else if (r.daysSince >= 56) dormantBadge = { color: '#F59E0B', label: r.daysSince + ' days' };
        else dormantBadge = { color: '#16a34a', label: r.daysSince + ' days' };
        var lastOrderStr = r.lastOrderAt ? new Date(r.lastOrderAt).toLocaleDateString() : '—';
        html += '<div onclick="editWholesaleAccount(\'' + esc(r.id) + '\')" style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:16px;">';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="font-weight:600;font-size:0.9rem;color:var(--charcoal);">' + esc(r.account.name || '(unnamed)') + '</div>';
        html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + r.orderCount + ' order' + (r.orderCount !== 1 ? 's' : '') + ' &middot; Last: ' + esc(lastOrderStr) + '</div>';
        html += '</div>';
        html += '<span style="font-size:0.72rem;font-weight:600;padding:3px 10px;border-radius:10px;background:' + dormantBadge.color + '22;color:' + dormantBadge.color + ';border:1px solid ' + dormantBadge.color + '55;">' + esc(dormantBadge.label) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }).catch(function(err) {
    container.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading dormant report: ' + esc(err.message || String(err)) + '</div>';
  });
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
    renderWholesaleOrderAccountLink(o, orderId) +
    '<table class="data-table" style="width:100%;">' +
      '<thead><tr><th>Product</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
      '<tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;">Total</td><td style="text-align:right;font-weight:700;">$' + ((o.totalCents || 0) / 100).toFixed(2) + '</td></tr></tfoot>' +
    '</table>' +
    // W2c — invoice section. The Generate Invoice action existed in orders.js
    // but the wholesale-tab order detail had its own template that never
    // invoked it, so the persona's "no invoice button on wholesale orders"
    // report was correct end-to-end. Reuse window.generateInvoice (now
    // cache-tolerant) and refresh this view in place after it returns.
    renderWholesaleInvoiceSection(o, orderId) +
  '</div>';

  document.getElementById('wholesaleSubContent').innerHTML = html;
}

// W2d follow-up #7 — Linked-account picker on the wholesale-tab order detail.
// Lets the user retroactively bind an order to a wholesaleAccount so AR aging
// and Dormant Accounts can attribute it without depending on the buyerEmail →
// authorized-user join chain (which doesn't exist for orders pre-dating W2d).
function renderWholesaleOrderAccountLink(o, orderId) {
  var currentId = o.wholesaleAccountId || '';
  var current = currentId ? (wholesaleAccountsData[currentId] || null) : null;
  var currentLabel = current ? current.name : (currentId ? '(account removed)' : 'Not linked');
  var html = '<div style="margin-bottom:16px;padding:12px;border:1px solid #e8e0d4;border-radius:6px;background:#fafaf7;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">';
  html += '<div>';
  html += '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.08em;">Linked account</div>';
  html += '<div style="font-size:0.9rem;margin-top:2px;color:' + (currentId ? 'var(--teal)' : 'var(--warm-gray)') + ';">' + esc(currentLabel) + '</div>';
  html += '</div>';
  // Picker — Object.values sorted by name for a stable list.
  var accounts = Object.keys(wholesaleAccountsData).map(function(k) {
    var v = wholesaleAccountsData[k] || {}; v._key = k; return v;
  }).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
  if (accounts.length === 0) {
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);">No wholesale accounts yet — create one from the Accounts tab.</div>';
  } else {
    html += '<select onchange="setWholesaleOrderAccount(\'' + esc(orderId) + '\', this.value)" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:0.85rem;min-width:200px;">';
    html += '<option value=""' + (currentId ? '' : ' selected') + '>— Not linked —</option>';
    accounts.forEach(function(a) {
      var sel = (a._key === currentId) ? ' selected' : '';
      html += '<option value="' + esc(a._key) + '"' + sel + '>' + esc(a.name || a._key) + '</option>';
    });
    html += '</select>';
  }
  html += '</div></div>';
  return html;
}

async function setWholesaleOrderAccount(orderId, accountId) {
  var update = { wholesaleAccountId: accountId || null, updatedAt: new Date().toISOString() };
  try {
    await MastDB.orders.update(orderId, update);
    if (wholesaleOrdersData[orderId]) wholesaleOrdersData[orderId].wholesaleAccountId = accountId || null;
    showToast(accountId ? 'Account linked' : 'Account unlinked');
    viewWholesaleOrder(orderId);
  } catch (e) {
    showToast('Link failed: ' + (e && e.message), true);
  }
}
window.setWholesaleOrderAccount = setWholesaleOrderAccount;

function renderWholesaleInvoiceSection(o, orderId) {
  var hasInvoice = !!o.invoiceNumber;
  var status = o.invoiceStatus || (hasInvoice ? 'draft' : null);
  var canGenerate = !status || status === 'draft';
  var statusColors = {
    draft:   '#9ca3af',
    sent:    '#3b82f6',
    paid:    '#16a34a',
    overdue: '#dc2626'
  };
  var statusColor = statusColors[status] || '#9ca3af';
  var html = '<div style="margin-top:20px;padding-top:16px;border-top:1px solid #e8e0d4;">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">';
  html += '<div>';
  html += '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.08em;">Invoice</div>';
  if (hasInvoice) {
    html += '<div style="font-weight:600;margin-top:4px;">' + esc(o.invoiceNumber) +
      ' <span style="font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:10px;background:' + statusColor + '22;color:' + statusColor + ';border:1px solid ' + statusColor + '55;margin-left:6px;">' + esc(status) + '</span></div>';
    if (o.invoiceDueDate) html += '<div style="font-size:0.78rem;color:var(--warm-gray);">Due ' + esc(o.invoiceDueDate) + '</div>';
  } else {
    html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">No invoice generated yet.</div>';
  }
  html += '</div>';
  if (canGenerate) {
    html += '<button class="btn-small" onclick="generateInvoiceForWholesale(\'' + esc(orderId) + '\')" style="background:var(--teal);color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.78rem;">' +
      (hasInvoice ? 'Regenerate' : 'Generate Invoice') + '</button>';
  }
  html += '</div></div>';
  return html;
}

async function generateInvoiceForWholesale(orderId) {
  if (typeof window.generateInvoice !== 'function') {
    // generateInvoice is defined in modules/orders.js; trigger module load if
    // the user hasn't visited Orders yet this session.
    try { await MastAdmin.loadModule('orders'); } catch (_e) {}
  }
  if (typeof window.generateInvoice !== 'function') {
    showToast('Invoice helper not available yet — try again', true);
    return;
  }
  await window.generateInvoice(orderId);
  // W2c — wholesale orders pay by check (not Square), so there's no
  // separate "send" step that triggers an external API. Promote the
  // freshly-generated invoice from draft → sent immediately so it shows
  // up in Finance → AR aging (which filters for status 'sent' / 'overdue').
  // For retail orders the orders-tab flow keeps draft + a dedicated Send
  // button that hits the Square Invoices API.
  try {
    await MastDB.orders.update(orderId, { invoiceStatus: 'sent', updatedAt: new Date().toISOString() });
  } catch (_e) {}
  // Re-fetch so the wholesale-tab cache picks up the freshly-written invoice fields.
  try {
    var snap = await MastDB.orders.get(orderId);
    var fresh = (snap && typeof snap.val === 'function') ? snap.val() : snap;
    if (fresh) wholesaleOrdersData[orderId] = fresh;
  } catch (_e) {}
  viewWholesaleOrder(orderId);
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
// W2c — wholesale-side invoice action bridge
window.generateInvoiceForWholesale = generateInvoiceForWholesale;
// W2d — authorized-user → account linkage
window.openWholesaleUserModal = openWholesaleUserModal;
window.closeWholesaleUserModal = closeWholesaleUserModal;
window.saveWholesaleUserLink = saveWholesaleUserLink;
// W2e — dormant accounts view
window.renderWholesaleDormant = renderWholesaleDormant;
window.renderWholesaleCadence = renderWholesaleCadence;
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
