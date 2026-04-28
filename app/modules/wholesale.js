// ============================================================
// WHOLESALE MODULE (lazy-loaded)
// ============================================================
(function() {
'use strict';

var wholesaleTokensData = {};
var wholesaleOrdersData = {};
var wholesaleAuthorizedData = {};
var wholesaleRequestsData = {};
var wholesaleSubView = 'orders'; // orders | users | requests
var wholesaleQRLib = null; // lazy-loaded QRCode library

// WHOLESALE_SEED and WHOLESALE_COLOR_UPDATES removed in unified pricing model Phase 4.
// Products now use isWholesale flag + wholesalePriceCents on product records.
// Seed data preserved in ~/.claude/plans/mast-pricing-model-build-plan.md.

// ── Render main wholesale admin view ──

function renderWholesaleAdmin() {
  var el = document.getElementById('wholesaleContent');
  if (!el) return;

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

  if (wholesaleSubView === 'users') renderWholesaleUsers();
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

  MastDB.get('admin/wholesaleAuthorized').then(function(snapVal) {
    wholesaleAuthorizedData = snap.val() || {};
    var users = Object.keys(wholesaleAuthorizedData).map(function(k) {
      var u = wholesaleAuthorizedData[k];
      u._key = k;
      u._email = wsKeyToEmail(k);
      return u;
    }).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
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
  if (!email.includes('@')) { showToast('Invalid email address', true); return; }

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

  MastDB.get('admin/wholesaleRequests').then(function(snapVal) {
    wholesaleRequestsData = snap.val() || {};
    var requests = Object.keys(wholesaleRequestsData).map(function(k) {
      var r = wholesaleRequestsData[k];
      r._id = k;
      return r;
    }).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

    if (requests.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#128233;</div>' +
        '<h3 style="font-weight:600;margin-bottom:8px;">No access requests</h3>' +
        '<p style="font-size:0.85rem;">When buyers request wholesale access from the catalog page, their requests will appear here.</p>' +
      '</div>';
      return;
    }

    var html = '';
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
    var url = snap.val();
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
