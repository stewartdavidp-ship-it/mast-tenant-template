// ============================================================
// WHOLESALE MODULE (lazy-loaded)
// ============================================================
(function() {
'use strict';

var wholesaleTokensData = {};
var wholesaleOrdersData = {};
var wholesaleAuthorizedData = {};
var wholesaleRequestsData = {};
var wholesaleSubView = 'orders'; // orders | users | requests | setup
var wholesaleQRLib = null; // lazy-loaded QRCode library

// ── Wholesale catalog product seed data ──
var WHOLESALE_SEED = {
  // Existing products: add wpid + wholesalePriceCents
  existing: {
    p84:  { wpid: '1',   wholesalePriceCents: 4200 },   // Spiral Cups
    p83:  { wpid: '3',   wholesalePriceCents: 2200 },   // Speckle Cups
    p88:  { wpid: '9',   wholesalePriceCents: 1500 },   // Flowers
    p42:  { wpid: '10',  wholesalePriceCents: 2200,      // Pumpkins — medium default
            wholesalePriceVariants: { '10L': 2800, '10M': 2200, '10S': 1600 } },
    p112: { wpid: '11',  wholesalePriceCents: 1500 },   // Birds
    p90:  { wpid: '12',  wholesalePriceCents: 4200 },   // Jellyfish Pendant
    p66:  { wpid: '13',  wholesalePriceCents: 4200 },   // Heart Pendant
    p116: { wpid: '14',  wholesalePriceCents: 4200 },   // Honey Pendant
    p101: { wpid: '15L', wholesalePriceCents: 85000 },  // Large Octopus
    p100: { wpid: '15S', wholesalePriceCents: 6000 },   // Small Octopus
    p76:  { wpid: '16a', wholesalePriceCents: 1800 },   // Snail
    p106: { wpid: '16b', wholesalePriceCents: 1800 }    // Snake
  },
  // New products to create
  newProducts: [
    {
      pid: 'pw2', name: 'Pitchers', wpid: '2',
      wholesalePriceCents: 6400, priceCents: null,
      categories: ['drinkware'], businessLine: 'production',
      availability: 'available',
      options: [{ label: 'Color', choices: ['Rose', 'Gold', 'Emerald', 'Cobalt', 'Aqua', 'Violet'] }],
      shortDescription: 'Hand-blown glass pitcher with spiral pattern.',
      description: 'Each pitcher is individually hand-blown with a unique spiral pattern. Available in six signature colors.'
    },
    {
      pid: 'pw4', name: 'Bowls', wpid: '4',
      wholesalePriceCents: 2200, priceCents: null,
      categories: ['drinkware'], businessLine: 'production',
      availability: 'available',
      options: [{ label: 'Color', choices: ['Emerald', 'Rose', 'Aqua', 'Cobalt', 'Gold', 'Violet'] }],
      shortDescription: 'Speckled glass bowl.',
      description: 'Hand-blown glass bowl with our signature speckle pattern. Perfect for serving or display.'
    },
    {
      pid: 'pw5', name: 'Small Dispensers', wpid: '5',
      wholesalePriceCents: 2200, priceCents: null,
      categories: ['decoration'], businessLine: 'production',
      availability: 'available',
      options: [{ label: 'Color', choices: ['Aqua', 'Emerald', 'Rose', 'Gold', 'Cobalt', 'Violet'] }],
      shortDescription: 'Small glass oil or vinegar dispenser.',
      description: 'Compact hand-blown glass dispenser with pour spout. Ideal for olive oil or vinegar.'
    },
    {
      pid: 'pw6', name: 'Pump Dispensers', wpid: '6',
      wholesalePriceCents: 3300, priceCents: null,
      categories: ['decoration'], businessLine: 'production',
      availability: 'available',
      options: [{ label: 'Color', choices: ['Violet', 'Cobalt', 'Emerald', 'Rose', 'Aqua', 'Gold'] }],
      shortDescription: 'Glass soap dispenser with pump.',
      description: 'Hand-blown glass soap or lotion dispenser with stainless steel pump top.'
    },
    {
      pid: 'pw7', name: 'Large Dispensers', wpid: '7',
      wholesalePriceCents: 3300, priceCents: null,
      categories: ['decoration'], businessLine: 'production',
      availability: 'available',
      options: [{ label: 'Color', choices: ['Violet', 'Cobalt', 'Gold', 'Emerald', 'Aqua', 'Rose'] }],
      shortDescription: 'Large glass oil dispenser.',
      description: 'Tall hand-blown glass dispenser with pour spout. Statement piece for kitchen or bar.'
    },
    {
      pid: 'pw8', name: 'Vases', wpid: '8',
      wholesalePriceCents: 2200, priceCents: null,
      categories: ['vases', 'decoration'], businessLine: 'production',
      availability: 'available',
      options: [
        { label: 'Style', choices: ['Gold Cone', 'Rose Cylinder', 'Violet Sphere', 'Aqua Cone', 'Emerald Cylinder', 'Cobalt Sphere'] }
      ],
      shortDescription: 'Small decorative glass vase.',
      description: 'Hand-blown glass vase in three shapes (cone, cylinder, sphere) and six colors.'
    },
    {
      pid: 'pw17', name: 'Speckle Ornaments', wpid: '17',
      wholesalePriceCents: 1500, priceCents: null,
      categories: ['decoration'], businessLine: 'production',
      availability: 'available',
      options: [{ label: 'Color', choices: ['Violet', 'Aqua', 'Gold', 'Emerald', 'Rose', 'Cobalt', 'Mix', 'Scarlet', 'White', 'Yellow'] }],
      shortDescription: 'Hand-blown speckled glass ornament.',
      description: 'Delicate speckled glass ornament. Each one is unique. Available in ten colors.'
    },
    {
      pid: 'pw18', name: 'Charm Ornaments', wpid: '18',
      wholesalePriceCents: 8200, priceCents: null,
      categories: ['decoration'], businessLine: 'production',
      availability: 'available',
      options: [{ label: 'Color', choices: ['Emerald', 'Gold', 'Mix', 'White', 'Aqua', 'Cobalt', 'Rose', 'Violet', 'Scarlet', 'Yellow'] }],
      shortDescription: 'Glass ornament with blown glass charm.',
      description: 'Hand-blown lattice glass ornament with a unique glass charm attached. Premium collector item.'
    }
  ]
};

// Also update existing product color options to match wholesale catalog
var WHOLESALE_COLOR_UPDATES = {
  p112: { options: [{ label: 'Color', choices: ['Cobalt', 'White', 'Tangerine', 'Blue', 'Mix', 'Pink', 'Aqua', 'Yellow', 'Emerald', 'Scarlet', 'Rose', 'Violet'] }] }
};

// ── Render main wholesale admin view ──

function renderWholesaleAdmin() {
  var el = document.getElementById('wholesaleContent');
  if (!el) return;

  var html = '<div style="max-width:1100px;margin:0 auto;padding:24px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">' +
      '<h2 style="font-size:1.4rem;font-weight:700;color:var(--charcoal);">Wholesale</h2>' +
    '</div>' +
    '<div class="view-tabs" style="margin-bottom:20px;">' +
      '<div class="view-tab' + (wholesaleSubView === 'orders' ? ' active' : '') + '" onclick="switchWholesaleView(\'orders\')">Orders</div>' +
      '<div class="view-tab' + (wholesaleSubView === 'users' ? ' active' : '') + '" onclick="switchWholesaleView(\'users\')">Authorized Users</div>' +
      '<div class="view-tab' + (wholesaleSubView === 'requests' ? ' active' : '') + '" onclick="switchWholesaleView(\'requests\')">Access Requests <span id="wsRequestBadge"></span></div>' +
      '<div class="view-tab' + (wholesaleSubView === 'setup' ? ' active' : '') + '" onclick="switchWholesaleView(\'setup\')">Setup</div>' +
    '</div>' +
    '<div id="wholesaleSubContent"></div>' +
  '</div>';

  el.innerHTML = html;

  // Update request count badge
  updateWholesaleRequestBadge();

  if (wholesaleSubView === 'users') renderWholesaleUsers();
  else if (wholesaleSubView === 'requests') renderWholesaleRequests();
  else if (wholesaleSubView === 'orders') renderWholesaleOrders();
  else if (wholesaleSubView === 'setup') renderWholesaleSetup();
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

  MastDB._ref('admin/wholesaleAuthorized').once('value').then(function(snap) {
    wholesaleAuthorizedData = snap.val() || {};
    var users = Object.keys(wholesaleAuthorizedData).map(function(k) {
      var u = wholesaleAuthorizedData[k];
      u._key = k;
      u._email = wsKeyToEmail(k);
      return u;
    }).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);">' + users.length + ' authorized user' + (users.length !== 1 ? 's' : '') + '</div>' +
      '<button class="btn-small" onclick="addWholesaleUser()" style="background:var(--teal);color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.8rem;">+ Add User</button>' +
    '</div>';

    // PDF catalog link section
    html += '<div style="background:rgba(42,124,111,0.08);border:1px solid rgba(42,124,111,0.2);border-radius:8px;padding:16px;margin-bottom:20px;">' +
      '<div style="font-weight:600;font-size:0.85rem;margin-bottom:8px;">PDF Catalog</div>' +
      '<div style="display:flex;gap:12px;align-items:center;">' +
        '<button class="btn-small" onclick="uploadWholesalePDF()" style="background:var(--amber);color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.8rem;">Upload PDF</button>' +
        '<span id="wholesalePdfStatus" style="font-size:0.8rem;color:var(--warm-gray);">Checking...</span>' +
      '</div>' +
      '<div id="wholesalePdfQR" style="margin-top:12px;"></div>' +
    '</div>';
    checkWholesalePdfStatus();

    if (users.length === 0) {
      html += '<div style="text-align:center;padding:60px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:2rem;margin-bottom:12px;">&#128100;</div>' +
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
            '<div style="font-size:0.75rem;color:var(--warm-gray);margin-top:2px;">' +
              (u.displayName ? esc(u.displayName) + ' &middot; ' : '') +
              'Added ' + formatDate(u.createdAt) +
              (u.approvedFrom ? ' &middot; From request' : '') +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<span style="font-size:0.7rem;padding:3px 8px;border-radius:4px;' + (isActive ? 'background:rgba(45,125,70,0.15);color:#2D7D46;' : 'background:rgba(220,53,69,0.15);color:#DC3545;') + '">' + (isActive ? 'Active' : 'Revoked') + '</span>' +
            (isActive ? '<button onclick="revokeWholesaleUser(\'' + esc(u._key) + '\')" style="background:none;border:1px solid #DC3545;color:#DC3545;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;">Revoke</button>' : '') +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  });
}

function addWholesaleUser() {
  var email = prompt('Enter the buyer\'s Google email address:');
  if (!email) return;
  email = email.trim().toLowerCase();
  if (!email.includes('@')) { showToast('Invalid email address', true); return; }

  var key = wsEmailToKey(email);
  var data = {
    active: true,
    createdAt: new Date().toISOString()
  };

  MastDB._ref('admin/wholesaleAuthorized/' + key).set(data).then(function() {
    showToast('Wholesale access granted to ' + email);
    renderWholesaleUsers();
  }).catch(function(err) {
    showToast('Error: ' + err.message, true);
  });
}

function revokeWholesaleUser(key) {
  var email = wsKeyToEmail(key);
  if (!confirm('Revoke wholesale access for ' + email + '?')) return;
  MastDB._ref('admin/wholesaleAuthorized/' + key).update({ active: false }).then(function() {
    showToast('Access revoked for ' + email);
    renderWholesaleUsers();
  });
}

// ── Access Requests sub-view ──

function updateWholesaleRequestBadge() {
  MastDB._ref('admin/wholesaleRequests').orderByChild('status').equalTo('pending')
    .once('value').then(function(snap) {
      var count = snap.numChildren();
      var badge = document.getElementById('wsRequestBadge');
      if (badge) {
        badge.textContent = count > 0 ? '(' + count + ')' : '';
        badge.style.color = count > 0 ? '#DC3545' : '';
        badge.style.fontWeight = count > 0 ? '700' : '';
      }
    });
}

function renderWholesaleRequests() {
  var container = document.getElementById('wholesaleSubContent');
  if (!container) return;

  container.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading requests...</div>';

  MastDB._ref('admin/wholesaleRequests').once('value').then(function(snap) {
    wholesaleRequestsData = snap.val() || {};
    var requests = Object.keys(wholesaleRequestsData).map(function(k) {
      var r = wholesaleRequestsData[k];
      r._id = k;
      return r;
    }).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

    if (requests.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:2rem;margin-bottom:12px;">&#128233;</div>' +
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
              '<div style="font-size:0.75rem;color:var(--warm-gray);margin-top:2px;">' +
                (r.displayName ? esc(r.displayName) + ' &middot; ' : '') +
                'Requested ' + formatDate(r.createdAt) +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
              '<button onclick="approveWholesaleRequest(\'' + esc(r._id) + '\')" style="background:var(--teal);color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Approve</button>' +
              '<button onclick="denyWholesaleRequest(\'' + esc(r._id) + '\')" style="background:none;border:1px solid #DC3545;color:#DC3545;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Deny</button>' +
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
        var statusStyle = r.status === 'approved' ? 'background:rgba(45,125,70,0.15);color:#2D7D46;' : 'background:rgba(220,53,69,0.15);color:#DC3545;';
        html += '<div style="background:#fff;border:1px solid #e8e0d4;border-radius:8px;padding:14px 16px;opacity:0.7;display:flex;justify-content:space-between;align-items:center;">' +
          '<div>' +
            '<div style="font-weight:500;font-size:0.9rem;">' + esc(r.email) + '</div>' +
            '<div style="font-size:0.75rem;color:var(--warm-gray);margin-top:2px;">' +
              (r.displayName ? esc(r.displayName) + ' &middot; ' : '') +
              formatDate(r.createdAt) +
            '</div>' +
          '</div>' +
          '<span style="font-size:0.7rem;padding:3px 8px;border-radius:4px;text-transform:capitalize;' + statusStyle + '">' + esc(r.status) + '</span>' +
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

  MastDB._multiUpdate(updates).then(function() {
    showToast('Approved! ' + r.email + ' now has wholesale access.');
    renderWholesaleRequests();
    updateWholesaleRequestBadge();
  }).catch(function(err) {
    showToast('Error: ' + err.message, true);
  });
}

function denyWholesaleRequest(requestId) {
  var r = wholesaleRequestsData[requestId];
  if (!r) return;
  if (!confirm('Deny wholesale access request from ' + r.email + '?')) return;

  var updates = {};
  updates['admin/wholesaleRequests/' + requestId + '/status'] = 'denied';
  updates['admin/wholesaleRequests/' + requestId + '/resolvedAt'] = new Date().toISOString();

  MastDB._multiUpdate(updates).then(function() {
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
      MastDB._ref('admin/wholesaleConfig/pdfUrl').set(url);
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
  MastDB._ref('admin/wholesaleConfig/pdfUrl').once('value').then(function(snap) {
    var url = snap.val();
    var statusEl = document.getElementById('wholesalePdfStatus');
    var qrEl = document.getElementById('wholesalePdfQR');
    if (url) {
      if (statusEl) statusEl.innerHTML = '<a href="' + esc(url) + '" target="_blank" style="color:var(--teal);">View PDF</a>';
      if (qrEl) {
        qrEl.innerHTML = '<div style="display:flex;gap:16px;align-items:center;">' +
          '<div id="pdfQRCanvas" style="display:inline-block;"></div>' +
          '<div>' +
            '<div style="font-size:0.8rem;font-weight:600;">PDF Catalog QR</div>' +
            '<div style="font-size:0.75rem;color:var(--warm-gray);margin-top:4px;">Links directly to the downloadable PDF</div>' +
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
              colorDark: '#1A1A1A',
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
        '<div style="font-size:2rem;margin-bottom:12px;">&#128230;</div>' +
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
        shipped: 'background:rgba(42,124,111,0.15);color:#2A7C6F;',
        completed: 'background:rgba(45,125,70,0.15);color:#2D7D46;',
        cancelled: 'background:rgba(220,53,69,0.15);color:#DC3545;'
      };
      var statusStyle = statusColors[o.status] || 'background:#f0f0f0;color:#666;';
      var statusLabel = (o.status || 'unknown').replace(/_/g, ' ');

      html += '<tr onclick="viewWholesaleOrder(\'' + esc(o._id) + '\')" style="cursor:pointer;">' +
        '<td style="font-family:monospace;font-size:0.8rem;">' + esc(o.orderNumber || o._id.substr(-6)) + '</td>' +
        '<td>' + esc(o.buyerName || o.buyerEmail || 'Unknown') + '</td>' +
        '<td style="font-size:0.8rem;">' + formatDate(o.createdAt) + '</td>' +
        '<td style="text-align:center;">' + itemCount + '</td>' +
        '<td>$' + ((o.totalCents || 0) / 100).toFixed(2) + '</td>' +
        '<td style="font-size:0.75rem;">' + esc(o.paymentMethod === 'check' ? 'Check' : 'Card') + '</td>' +
        '<td><span style="font-size:0.7rem;padding:3px 8px;border-radius:4px;text-transform:capitalize;' + statusStyle + '">' + statusLabel + '</span></td>' +
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
      '<td>' + esc(it.name) + (opts ? '<div style="font-size:0.75rem;color:var(--warm-gray);">' + esc(opts) + '</div>' : '') + '</td>' +
      '<td style="text-align:center;">' + (it.qty || 1) + '</td>' +
      '<td style="text-align:right;">$' + ((it.priceCents || 0) / 100).toFixed(2) + '</td>' +
      '<td style="text-align:right;">$' + (((it.priceCents || 0) * (it.qty || 1)) / 100).toFixed(2) + '</td>' +
    '</tr>';
  }).join('');

  var statusOptions = ['pending_check_verification', 'paid', 'processing', 'shipped', 'completed', 'cancelled'];
  var statusSelect = '<select onchange="updateWholesaleOrderStatus(\'' + esc(orderId) + '\', this.value)" style="padding:4px 8px;border-radius:4px;border:1px solid #ccc;font-size:0.8rem;">';
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
        '<h3 style="font-weight:700;font-size:1.1rem;">Order ' + esc(o.orderNumber || orderId.substr(-6)) + '</h3>' +
        '<div style="font-size:0.8rem;color:var(--warm-gray);margin-top:4px;">' + formatDate(o.createdAt) + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        '<span style="font-size:0.8rem;">Status:</span>' + statusSelect +
      '</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">' +
      '<div>' +
        '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Buyer</div>' +
        '<div style="font-size:0.9rem;">' + esc(o.buyerName || 'N/A') + '</div>' +
        '<div style="font-size:0.8rem;color:var(--warm-gray);">' + esc(o.buyerEmail || '') + '</div>' +
        '<div style="font-size:0.8rem;color:var(--warm-gray);">' + esc(o.buyerPhone || '') + '</div>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Shipping</div>' +
        '<div style="font-size:0.85rem;">' + esc(o.shipping ? (o.shipping.name || '') : '') + '</div>' +
        '<div style="font-size:0.8rem;color:var(--warm-gray);">' +
          esc(o.shipping ? [o.shipping.address1, o.shipping.city, o.shipping.state, o.shipping.zip].filter(Boolean).join(', ') : 'N/A') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Payment: ' + esc(o.paymentMethod === 'check' ? 'Pay by Check' : 'Credit Card') + '</div>' +
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

function renderWholesaleSetup() {
  var container = document.getElementById('wholesaleSubContent');
  if (!container) return;

  container.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Checking product data...</div>';

  // Check how many products already have wpid set
  MastDB.products.list().then(function(snap) {
    var products = snap.val() || {};
    var withWpid = 0;
    var totalExpected = Object.keys(WHOLESALE_SEED.existing).length + WHOLESALE_SEED.newProducts.length;
    Object.keys(products).forEach(function(pid) {
      if (products[pid].wpid) withWpid++;
    });

    var allSeeded = withWpid >= totalExpected;

    var html = '<div style="background:#fff;border:1px solid #e8e0d4;border-radius:8px;padding:24px;max-width:700px;">' +
      '<h3 style="font-weight:700;font-size:1rem;margin-bottom:16px;">Wholesale Product Data</h3>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">' +
        'The 2026 wholesale catalog includes 18 product lines (' + Object.keys(WHOLESALE_SEED.existing).length + ' existing + ' + WHOLESALE_SEED.newProducts.length + ' new). ' +
        'Currently <strong>' + withWpid + '</strong> of <strong>' + totalExpected + '</strong> products have wholesale data.' +
      '</div>';

    if (allSeeded) {
      html += '<div style="background:rgba(45,125,70,0.1);color:#2D7D46;padding:12px;border-radius:6px;font-size:0.85rem;">All wholesale products are configured.</div>';
    } else {
      html += '<div style="margin-bottom:16px;">' +
        '<h4 style="font-size:0.85rem;font-weight:600;margin-bottom:8px;">Existing products to update:</h4>' +
        '<div style="font-size:0.8rem;color:var(--warm-gray);">';
      Object.keys(WHOLESALE_SEED.existing).forEach(function(pid) {
        var s = WHOLESALE_SEED.existing[pid];
        var existing = products[pid];
        var already = existing && existing.wpid;
        html += '<div style="padding:2px 0;' + (already ? 'text-decoration:line-through;opacity:0.5;' : '') + '">  ' + pid + ' (' + (existing ? existing.name : '?') + ') → wpid ' + s.wpid + ', $' + (s.wholesalePriceCents / 100).toFixed(2) + '</div>';
      });
      html += '</div></div>';

      html += '<div style="margin-bottom:16px;">' +
        '<h4 style="font-size:0.85rem;font-weight:600;margin-bottom:8px;">New products to create:</h4>' +
        '<div style="font-size:0.8rem;color:var(--warm-gray);">';
      WHOLESALE_SEED.newProducts.forEach(function(np) {
        var already = products[np.pid];
        html += '<div style="padding:2px 0;' + (already ? 'text-decoration:line-through;opacity:0.5;' : '') + '">  ' + np.pid + ' — ' + np.name + ' (wpid ' + np.wpid + ', $' + (np.wholesalePriceCents / 100).toFixed(2) + ')</div>';
      });
      html += '</div></div>';

      html += '<button onclick="runWholesaleSeed()" style="background:var(--teal);color:#fff;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:0.85rem;">Seed Wholesale Data</button>';
    }

    html += '</div>';
    container.innerHTML = html;
  });
}

async function runWholesaleSeed() {
  var btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Seeding...';

  try {
    // 1. Update existing products
    var updates = {};
    Object.keys(WHOLESALE_SEED.existing).forEach(function(pid) {
      var data = WHOLESALE_SEED.existing[pid];
      Object.keys(data).forEach(function(field) {
        updates['public/products/' + pid + '/' + field] = data[field];
      });
    });

    // Update bird colors to match wholesale catalog
    Object.keys(WHOLESALE_COLOR_UPDATES).forEach(function(pid) {
      var data = WHOLESALE_COLOR_UPDATES[pid];
      Object.keys(data).forEach(function(field) {
        updates['public/products/' + pid + '/' + field] = data[field];
      });
    });

    // 2. Create new products
    WHOLESALE_SEED.newProducts.forEach(function(np) {
      var product = {
        pid: np.pid,
        name: np.name,
        wpid: np.wpid,
        wholesalePriceCents: np.wholesalePriceCents,
        categories: np.categories,
        businessLine: np.businessLine,
        availability: np.availability,
        options: np.options,
        shortDescription: np.shortDescription,
        description: np.description,
        images: [],
        imageIds: [],
        slug: np.name.toLowerCase().replace(/\s+/g, '-'),
        createdAt: new Date().toISOString()
      };
      if (np.priceCents) product.priceCents = np.priceCents;
      if (np.priceCents) product.price = '$' + (np.priceCents / 100).toFixed(2);
      updates['public/products/' + np.pid] = product;
    });

    await MastDB._multiUpdate(updates);
    showToast('Wholesale data seeded successfully! ' + Object.keys(WHOLESALE_SEED.existing).length + ' products updated, ' + WHOLESALE_SEED.newProducts.length + ' new products created.');
    renderWholesaleSetup();
  } catch (err) {
    showToast('Seed error: ' + err.message, true);
    btn.disabled = false;
    btn.textContent = 'Seed Wholesale Data';
  }
}

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
window.renderWholesaleSetup = renderWholesaleSetup;
window.runWholesaleSeed = runWholesaleSeed;
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
