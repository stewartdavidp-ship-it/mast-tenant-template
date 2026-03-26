/**
 * Fulfillment Module — Pack Queue, Scan-to-Ship, Bundles, Ship/Deliver, Production Request fulfillment
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var bundles = {};
  var bundlesLoaded = false;
  var bundlesListener = null;
  var packSubView = 'queue';
  var shipSubView = 'deliver';
  var activeBundleId = null;
  var scanCamera = null;
  var scanInterval = null;
  var scanProcessing = false;
  var _fulfillmentShipProvider = 'manual';

  // Load shipping provider setting
  MastDB.config.shippingProvider('provider').once('value').then(function(snap) {
    _fulfillmentShipProvider = snap.val() || 'manual';
  });
  var tesseractLoaded = false;
  var _pirateShipCSVDownloaded = {};

  // ============================================================
  // Functions
  // ============================================================

  function loadBundles() {
    if (bundlesListener) return;
    bundlesListener = MastDB.bundles.listen(50, function(snap) {
      bundles = snap.val() || {};
      bundlesLoaded = true;
      if (currentRoute === 'ship') {
        if (shipSubView === 'bundles') renderBundlesView();
        if (shipSubView === 'deliver') renderDeliverView();
      }
    }, function(err) {
      showToast('Error loading bundles: ' + err.message, true);
    });
  }

  function switchPackSubView(view) {
    packSubView = view;
    document.querySelectorAll('#packSubNav .view-tab').forEach(function(b) { b.classList.remove('active'); });
    var views = { queue: 'fulfPackView', scan: 'fulfScanView' };
    Object.keys(views).forEach(function(v) {
      var btn = document.getElementById('packSub' + v.charAt(0).toUpperCase() + v.slice(1));
      var el = document.getElementById(views[v]);
      if (btn && v === view) btn.classList.add('active');
      if (el) el.style.display = v === view ? '' : 'none';
    });
    if (view !== 'scan') stopScanCamera();
    if (view === 'queue') renderPackQueue();
    else if (view === 'scan') renderScanView();
  }

  function switchShipSubView(view) {
    shipSubView = view;
    document.querySelectorAll('#shipSubNav .view-tab').forEach(function(b) { b.classList.remove('active'); });
    var views = { deliver: 'fulfDeliverView', bundles: 'fulfBundlesView' };
    Object.keys(views).forEach(function(v) {
      var btn = document.getElementById('shipSub' + v.charAt(0).toUpperCase() + v.slice(1));
      var el = document.getElementById(views[v]);
      if (btn && v === view) btn.classList.add('active');
      if (el) el.style.display = v === view ? '' : 'none';
    });
    stopScanCamera();
    if (view === 'deliver') renderDeliverView();
    else if (view === 'bundles') renderBundlesView();
  }

  // ---- Pack Queue ----
  function renderPackQueue() {
    var el = document.getElementById('fulfPackView');
    var packable = getOrdersArray().filter(function(o) {
      return o.status === 'packing' || o.status === 'ready' || o.status === 'packed';
    });

    if (packable.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128230;</div><p>No orders ready for packing.</p></div>';
      return;
    }

    var html = '<div style="margin-top:12px;">';
    packable.forEach(function(o) {
      var key = o._key;
      var num = esc(getOrderDisplayNumber(o));
      var status = o.status || 'placed';
      var itemNames = (o.items || []).map(function(it) { return it.name + ' x' + (it.qty || 1); }).join(', ');
      var custName = o.shipping ? esc(o.shipping.name || '') : '';
      html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
          '<div>' +
            '<div style="font-weight:600;font-family:monospace;">' + num + ' <span class="status-badge pill" style="' + orderStatusBadgeStyle(status) + '">' + status.replace(/_/g, ' ') + '</span></div>' +
            '<div style="font-size:0.85rem;color:var(--warm-gray);">' + custName + ' &mdash; ' + esc(itemNames) + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;">';
      if (status === 'ready') {
        html += '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 12px;" onclick="event.stopPropagation();packQueueTransition(\'' + esc(key) + '\', \'packing\')">Packing</button>';
      }
      if (status === 'packing') {
        html += '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 12px;" onclick="event.stopPropagation();packQueueTransition(\'' + esc(key) + '\', \'packed\')">Packed</button>';
      }
      if (status === 'packed') {
        html += '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 12px;" onclick="event.stopPropagation();packQueueTransition(\'' + esc(key) + '\', \'handed_to_carrier\')">Handed to Carrier</button>';
      }
      var shipDisabled = (status !== 'packed' && status !== 'handed_to_carrier') ? ' disabled style="font-size:0.78rem;padding:4px 12px;opacity:0.4;cursor:not-allowed;"' : ' style="font-size:0.78rem;padding:4px 12px;"';
      html += '<button class="btn btn-primary"' + shipDisabled + ' onclick="event.stopPropagation();openShippingModal(\'' + esc(key) + '\')">Ship</button>' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="event.stopPropagation();viewOrder(\'' + esc(key) + '\')">View</button>' +
        '</div></div>' +
        renderOrderProgress(status) +
        '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function downloadOrderCSV(orderId) {
    var o = orders[orderId];
    if (!o) return;
    var csv = generateAdminPirateShipCSV(o);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'pirateship-' + (o.orderNumber || orderId) + '.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  function openPirateShip(orderId) {
    // Step 1: Download CSV if not already done for this order
    if (!_pirateShipCSVDownloaded[orderId]) {
      downloadOrderCSV(orderId);
      _pirateShipCSVDownloaded[orderId] = true;
    }
    emitTestingEvent('openPirateShip', {}); // Testing Mode

    // Step 2: Check first-time usage — show mapping guide or go straight to Pirate Ship
    var hasUsed = localStorage.getItem('sgw_pirateship_mapped');
    if (hasUsed) {
      window.open('https://ship.pirateship.com/ship/spreadsheet', '_blank');
      return;
    }
    var html = '<div class="modal-header">' +
      '<h3 style="margin:0;">First Time Using Pirate Ship CSV?</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body" style="padding:16px;">' +
      '<p style="margin:0 0 12px;color:var(--warm-gray-light);font-size:0.9rem;">Your CSV has been downloaded. Pirate Ship auto-maps address fields, but the following fields need to be <strong style="color:var(--amber);">manually mapped</strong> the first time you upload a CSV:</p>' +
      '<table style="width:100%;border-collapse:collapse;margin:12px 0;">' +
        '<thead><tr style="border-bottom:2px solid var(--cream-dark);text-align:left;">' +
          '<th style="padding:6px 10px;font-size:0.82rem;">Our CSV Column</th>' +
          '<th style="padding:6px 10px;font-size:0.82rem;">Map To in Pirate Ship</th>' +
        '</tr></thead>' +
        '<tbody>' +
          '<tr style="border-bottom:1px solid var(--cream-dark);">' +
            '<td style="padding:6px 10px;font-size:0.85rem;">Weight (oz)</td>' +
            '<td style="padding:6px 10px;font-size:0.85rem;color:var(--amber);">Weight (oz)</td>' +
          '</tr>' +
          '<tr style="border-bottom:1px solid var(--cream-dark);">' +
            '<td style="padding:6px 10px;font-size:0.85rem;">Package Length</td>' +
            '<td style="padding:6px 10px;font-size:0.85rem;color:var(--amber);">Length</td>' +
          '</tr>' +
          '<tr style="border-bottom:1px solid var(--cream-dark);">' +
            '<td style="padding:6px 10px;font-size:0.85rem;">Package Width</td>' +
            '<td style="padding:6px 10px;font-size:0.85rem;color:var(--amber);">Width</td>' +
          '</tr>' +
          '<tr style="border-bottom:1px solid var(--cream-dark);">' +
            '<td style="padding:6px 10px;font-size:0.85rem;">Package Height</td>' +
            '<td style="padding:6px 10px;font-size:0.85rem;color:var(--amber);">Height</td>' +
          '</tr>' +
          '<tr style="border-bottom:1px solid var(--cream-dark);">' +
            '<td style="padding:6px 10px;font-size:0.85rem;">Order ID</td>' +
            '<td style="padding:6px 10px;font-size:0.85rem;color:var(--amber);">Order ID</td>' +
          '</tr>' +
          '<tr style="border-bottom:1px solid var(--cream-dark);">' +
            '<td style="padding:6px 10px;font-size:0.85rem;">Description</td>' +
            '<td style="padding:6px 10px;font-size:0.85rem;color:var(--amber);">Description</td>' +
          '</tr>' +
          '<tr>' +
            '<td style="padding:6px 10px;font-size:0.85rem;">Rubber Stamp 1</td>' +
            '<td style="padding:6px 10px;font-size:0.85rem;color:var(--amber);">Rubber Stamp 1</td>' +
          '</tr>' +
        '</tbody>' +
      '</table>' +
      '<p style="margin:12px 0 0;color:var(--warm-gray);font-size:0.82rem;">Pirate Ship remembers your mappings — you only need to do this once.</p>' +
    '</div>' +
    '<div class="modal-footer" style="padding:12px 16px;display:flex;gap:8px;justify-content:flex-end;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="localStorage.setItem(\'sgw_pirateship_mapped\',\'1\');closeModal();window.open(\'https://ship.pirateship.com/ship/spreadsheet\',\'_blank\');">Got It — Open Pirate Ship</button>' +
    '</div>';
    openModal(html);
  }

  function generateAdminPirateShipCSV(o) {
    var s = o.shipping || {};
    var items = o.items || [];
    var productMap = o.itemShippingData || {};
    var config = o.shippingConfig || { small: { rate: 6, boxL: 6, boxW: 6, boxH: 6 }, medium: { rate: 10, boxL: 10, boxW: 8, boxH: 6 }, large: { rate: 15, boxL: 14, boxW: 12, boxH: 8 }, oversized: { rate: 22, boxL: 20, boxW: 16, boxH: 12 }, packingBufferOz: 8 };
    var totalWeightOz = 0;
    var highestCat = 'small';
    var catOrder = ['small', 'medium', 'large', 'oversized'];
    for (var i = 0; i < items.length; i++) {
      var ps = productMap[items[i].pid] || { weightOz: 16, shippingCategory: 'small' };
      var qty = items[i].qty || 1;
      totalWeightOz += (ps.weightOz || 16) * qty + (config.packingBufferOz || 8) * qty;
      var catIdx = catOrder.indexOf(ps.shippingCategory || 'small');
      if (catIdx > catOrder.indexOf(highestCat)) highestCat = ps.shippingCategory || 'small';
    }
    var box = config[highestCat] || { boxL: 6, boxW: 6, boxH: 6 };
    var desc = items.map(function(it) { return it.name + ' x' + (it.qty || 1); }).join(', ');
    if (desc.length > 100) desc = desc.substring(0, 97) + '...';
    var orderNum = o.orderNumber || o.orderId || '';
    var digits = orderNum.replace(/[^0-9]/g, '');
    while (digits.length < 4) digits = '0' + digits;
    var rubberStamp = '######SG-' + digits + '######';
    function csvEsc(val) {
      var str = String(val);
      if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
      if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) return '"' + str.replace(/"/g, '""') + '"';
      return str;
    }
    var headers = ['Name', 'Company', 'Address Line 1', 'Address Line 2', 'City', 'State', 'Zip', 'Country', 'Phone', 'Weight (oz)', 'Package Length', 'Package Width', 'Package Height', 'Description', 'Order ID', 'Rubber Stamp 1'];
    var row = [s.name || '', '', s.address1 || '', s.address2 || '', s.city || '', s.state || '', s.zip || '', 'US', '', Math.ceil(totalWeightOz), box.boxL || 6, box.boxW || 6, box.boxH || 6, desc, orderNum, rubberStamp];
    return headers.map(csvEsc).join(',') + '\n' + row.map(csvEsc).join(',') + '\n';
  }

  // ---- Bundles ----
  async function createBundle() {
    try {
      var ref = MastDB.bundles.push();
      var bundleId = ref.key;
      await ref.set({
        id: bundleId,
        name: 'New Bundle',
        status: 'open',
        carrier: null,
        dropOffLocation: null,
        orderIds: [],
        scannedAtDropOff: [],
        deliveredAt: null,
        createdAt: new Date().toISOString(),
        createdBy: 'admin'
      });
      activeBundleId = bundleId;
      return bundleId;
    } catch (err) {
      showToast('Error creating bundle: ' + err.message, true);
      return null;
    }
  }

  async function addToBundle(bundleId, orderId) {
    try {
      var bundle = bundles[bundleId];
      if (!bundle) return;
      var orderIds = (bundle.orderIds || []).slice();
      if (orderIds.indexOf(orderId) === -1) {
        orderIds.push(orderId);
        await MastDB.bundles.subRef(bundleId, 'orderIds').set(orderIds);
      }
    } catch (err) {
      showToast('Error adding to bundle: ' + err.message, true);
    }
  }

  async function markScannedAtDropOff(bundleId, orderId) {
    try {
      var bundle = bundles[bundleId];
      if (!bundle) return;
      var scanned = (bundle.scannedAtDropOff || []).slice();
      if (scanned.indexOf(orderId) === -1) {
        scanned.push(orderId);
        var updates = { scannedAtDropOff: scanned };
        // Auto-close bundle when all scanned
        var allOrderIds = bundle.orderIds || [];
        if (scanned.length >= allOrderIds.length && allOrderIds.length > 0) {
          updates.status = 'delivered';
          updates.deliveredAt = new Date().toISOString();
        }
        await MastDB.bundles.update(bundleId, updates);
        if (updates.status === 'delivered') {
          showToast('Bundle delivered! All packages confirmed.');
        }
      }
    } catch (err) {
      showToast('Error updating bundle: ' + err.message, true);
    }
  }

  async function updateBundleCarrier(bundleId, carrier, location) {
    try {
      var bundle = bundles[bundleId];
      if (!bundle) return;
      var count = (bundle.orderIds || []).length;
      var name = count + ' Package' + (count !== 1 ? 's' : '') + ' Drop-off ' + carrier;
      await MastDB.bundles.update(bundleId, {
        carrier: carrier,
        dropOffLocation: location || null,
        name: name
      });
    } catch (err) {
      showToast('Error updating bundle: ' + err.message, true);
    }
  }

  function getOpenBundle() {
    var keys = Object.keys(bundles);
    for (var i = keys.length - 1; i >= 0; i--) {
      if (bundles[keys[i]].status === 'open') return keys[i];
    }
    return null;
  }

  function renderBundlesView() {
    var el = document.getElementById('fulfBundlesView');
    var keys = Object.keys(bundles).sort(function(a, b) {
      return (bundles[b].createdAt || '').localeCompare(bundles[a].createdAt || '');
    });

    if (keys.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128230;</div><p>No bundles yet. Bundles are created automatically when you scan packages.</p></div>';
      return;
    }

    var openHtml = '';
    var closedHtml = '';
    keys.forEach(function(k) {
      var b = bundles[k];
      var isOpen = b.status === 'open';
      var total = (b.orderIds || []).length;
      var scanned = (b.scannedAtDropOff || []).length;
      var pct = total > 0 ? Math.round(scanned / total * 100) : 0;
      var card = '<div style="background:var(--cream);border:1px solid ' + (isOpen ? 'var(--teal)' : 'var(--cream-dark)') + ';border-radius:8px;padding:12px 16px;margin-bottom:8px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div><strong>' + esc(b.name || 'Unnamed Bundle') + '</strong>' +
            ' <span class="status-badge pill" style="' + orderStatusBadgeStyle(isOpen ? 'packing' : 'delivered') + '">' + b.status + '</span></div>' +
          '<div style="font-size:0.85rem;color:var(--warm-gray);">' + total + ' package' + (total !== 1 ? 's' : '') + '</div>' +
        '</div>';
      if (b.carrier) {
        card += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">' + esc(b.carrier) + (b.dropOffLocation ? ' — ' + esc(b.dropOffLocation) : '') + '</div>';
      }
      if (total > 0) {
        card += '<div style="margin-top:8px;background:#e0e0e0;border-radius:4px;height:6px;overflow:hidden;">' +
          '<div style="background:var(--teal);height:100%;width:' + pct + '%;transition:width 0.3s;"></div></div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + scanned + '/' + total + ' scanned at drop-off</div>';
      }
      // Show order list
      if (isOpen && total > 0) {
        card += '<div style="margin-top:8px;font-size:0.85rem;">';
        (b.orderIds || []).forEach(function(oid) {
          var o = orders[oid];
          var num = o ? getOrderDisplayNumber(o) : oid;
          var isDone = (b.scannedAtDropOff || []).indexOf(oid) !== -1;
          card += '<div style="padding:2px 0;">' + (isDone ? '&#10003; ' : '&#9744; ') + esc(num) + '</div>';
        });
        card += '</div>';
      }
      card += '</div>';
      if (isOpen) openHtml += card; else closedHtml += card;
    });

    var html = '<div style="margin-top:12px;">';
    if (openHtml) {
      html += '<h3 style="margin:0 0 8px;font-size:1rem;">Open Bundles</h3>' + openHtml;
    }
    if (closedHtml) {
      html += '<details style="margin-top:16px;"><summary style="cursor:pointer;font-weight:600;font-size:0.9rem;color:var(--warm-gray);">Completed Bundles</summary>' +
        '<div style="margin-top:8px;">' + closedHtml + '</div></details>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  // ---- Studio Scan ----
  async function loadTesseract() {
    if (window.Tesseract) { tesseractLoaded = true; return; }
    return new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = function() { tesseractLoaded = true; resolve(); };
      script.onerror = function() { reject(new Error('Failed to load Tesseract.js')); };
      document.head.appendChild(script);
    });
  }

  function renderScanView() {
    var el = document.getElementById('fulfScanView');
    var openBundleId = getOpenBundle();
    var bundleInfo = '';
    if (openBundleId && bundles[openBundleId]) {
      var b = bundles[openBundleId];
      bundleInfo = '<div style="background:var(--cream);border:1px solid var(--teal);border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:0.85rem;">' +
        'Active bundle: <strong>' + esc(b.name || 'New Bundle') + '</strong> — ' + (b.orderIds || []).length + ' package(s)' +
      '</div>';
    }
    el.innerHTML = '<div style="margin-top:12px;">' +
      bundleInfo +
      '<div id="scanStatus" style="text-align:center;padding:12px;font-size:0.9rem;color:var(--warm-gray);">Loading camera...</div>' +
      '<div style="position:relative;max-width:640px;margin:0 auto;">' +
        '<video id="scanVideo" autoplay playsinline muted style="width:100%;border-radius:8px;background:#000;"></video>' +
        '<div id="scanOverlay" style="position:absolute;top:0;left:0;right:0;bottom:0;border:3px solid transparent;border-radius:8px;pointer-events:none;transition:border-color 0.3s;"></div>' +
      '</div>' +
      '<canvas id="scanCanvas" style="display:none;"></canvas>' +
      '<div id="scanResult" style="display:none;margin-top:12px;"></div>' +
      '<div style="display:flex;gap:8px;justify-content:center;margin-top:12px;">' +
        '<button class="btn btn-secondary" id="scanManualBtn" style="display:none;" onclick="showManualOrderEntry()">Enter Order # Manually</button>' +
        '<button class="btn btn-secondary" onclick="switchPackSubView(\'queue\')">Done Packing</button>' +
      '</div>' +
      '<div id="scanManualEntry" style="display:none;margin-top:12px;text-align:center;">' +
        '<input type="text" id="scanManualInput" placeholder="Order number (e.g. SGW-0042)" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;width:200px;">' +
        '<button class="btn btn-primary" style="margin-left:8px;" onclick="processManualScan()">Look Up</button>' +
      '</div>' +
    '</div>';
    startScanCamera();
  }

  async function startScanCamera() {
    try {
      await loadTesseract();
      var video = document.getElementById('scanVideo');
      if (!video) return;
      var statusEl = document.getElementById('scanStatus');

      var constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
      var stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      scanCamera = stream;

      video.onloadedmetadata = function() {
        if (statusEl) statusEl.textContent = 'Point camera at shipping label...';
        startScanLoop();
      };
    } catch (err) {
      var statusEl = document.getElementById('scanStatus');
      if (statusEl) statusEl.textContent = 'Camera error: ' + err.message;
      var manualBtn = document.getElementById('scanManualBtn');
      if (manualBtn) manualBtn.style.display = '';
      showToast('Camera access denied or unavailable', true);
    }
  }

  function startScanLoop() {
    var noMatchCount = 0;
    scanInterval = setInterval(function() {
      if (scanProcessing) return;
      noMatchCount++;
      // Show manual entry after ~5 seconds of no match (10 ticks at 500ms)
      if (noMatchCount >= 10) {
        var manualBtn = document.getElementById('scanManualBtn');
        if (manualBtn) manualBtn.style.display = '';
      }
      captureAndOCR();
    }, 500);
  }

  async function captureAndOCR() {
    scanProcessing = true;
    try {
      var video = document.getElementById('scanVideo');
      var canvas = document.getElementById('scanCanvas');
      if (!video || !canvas || !video.videoWidth) { scanProcessing = false; return; }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);

      // Scale up for OCR accuracy (LabelKeeper pattern)
      var w = canvas.width, h = canvas.height;
      var minDim = 1500;
      if (w < minDim && h < minDim) {
        var scale = minDim / Math.max(w, h);
        var ocrCanvas = document.createElement('canvas');
        ocrCanvas.width = Math.round(w * scale);
        ocrCanvas.height = Math.round(h * scale);
        ocrCanvas.getContext('2d').drawImage(canvas, 0, 0, ocrCanvas.width, ocrCanvas.height);
        var result = await Tesseract.recognize(ocrCanvas, 'eng');
      } else {
        var result = await Tesseract.recognize(canvas, 'eng');
      }

      var text = result.data.text || '';
      var match = text.match(/#{4,}(SG-\d{3,6})#{4,}/);
      if (match) {
        var sgId = match[1]; // e.g. "SG-0042"
        var overlay = document.getElementById('scanOverlay');
        if (overlay) overlay.style.borderColor = '#2E7D32';
        if (navigator.vibrate) navigator.vibrate(200);
        clearInterval(scanInterval);
        scanInterval = null;
        await processScanMatch(sgId);
      }
    } catch (err) {
      // OCR errors are expected on some frames, silently continue
    }
    scanProcessing = false;
  }

  async function processScanMatch(sgId) {
    // sgId is like "SG-0042" — find matching order
    var digits = sgId.replace(/[^0-9]/g, '');
    var num = parseInt(digits, 10);
    var matchedKey = null;
    var allOrders = getOrdersArray();
    for (var i = 0; i < allOrders.length; i++) {
      var o = allOrders[i];
      var oNum = (o.orderNumber || '').replace(/[^0-9]/g, '');
      if (oNum && parseInt(oNum, 10) === num) {
        matchedKey = o._key;
        break;
      }
    }

    var resultEl = document.getElementById('scanResult');
    var statusEl = document.getElementById('scanStatus');
    if (!matchedKey) {
      if (resultEl) resultEl.innerHTML = '<div style="text-align:center;color:var(--danger);padding:12px;">No order found for ' + esc(sgId) + '</div>';
      if (resultEl) resultEl.style.display = '';
      if (statusEl) statusEl.textContent = 'No match — try again or enter manually';
      // Resume scanning
      setTimeout(function() { startScanLoop(); }, 2000);
      return;
    }

    var o = orders[matchedKey];
    var status = o.status || 'placed';

    // Check if order is in a packable state
    if (status !== 'packing' && status !== 'ready') {
      if (resultEl) {
        resultEl.innerHTML = '<div style="text-align:center;padding:12px;background:#FFF3E0;border-radius:8px;">' +
          '<div style="font-weight:600;">' + esc(getOrderDisplayNumber(o)) + '</div>' +
          '<div style="color:var(--warm-gray);font-size:0.85rem;">Status: ' + status.replace(/_/g, ' ') + ' — cannot pack</div>' +
        '</div>';
        resultEl.style.display = '';
      }
      setTimeout(function() { startScanLoop(); }, 2000);
      return;
    }

    // Transition to packed
    if (status === 'ready') {
      await transitionOrder(matchedKey, 'packing');
    }
    await transitionOrder(matchedKey, 'packed');

    // Add to bundle
    var bundleId = getOpenBundle();
    if (!bundleId) bundleId = await createBundle();
    if (bundleId) await addToBundle(bundleId, matchedKey);

    // Show success
    var itemNames = (o.items || []).map(function(it) { return it.name + ' x' + (it.qty || 1); }).join(', ');
    if (resultEl) {
      resultEl.innerHTML = '<div style="text-align:center;padding:16px;background:#E8F5E9;border-radius:8px;">' +
        '<div style="font-size:2rem;">&#10003;</div>' +
        '<div style="font-weight:600;font-size:1.1rem;">' + esc(getOrderDisplayNumber(o)) + ' — Packed!</div>' +
        '<div style="color:var(--warm-gray);font-size:0.85rem;">' + esc(o.shipping ? o.shipping.name : '') + '</div>' +
        '<div style="color:var(--warm-gray);font-size:0.85rem;">' + esc(itemNames) + '</div>' +
        (bundleId ? '<div style="color:var(--teal);font-size:0.78rem;margin-top:4px;">Added to bundle (' + ((bundles[bundleId] || {}).orderIds || []).length + ' packages)</div>' : '') +
      '</div>';
      resultEl.style.display = '';
    }
    if (statusEl) statusEl.textContent = 'Scanned! Ready for next label...';
    var overlay = document.getElementById('scanOverlay');
    if (overlay) overlay.style.borderColor = 'transparent';

    // Resume scanning after a brief pause
    setTimeout(function() {
      if (resultEl) resultEl.style.display = 'none';
      startScanLoop();
    }, 2500);
  }

  function showManualOrderEntry() {
    var el = document.getElementById('scanManualEntry');
    if (el) el.style.display = '';
    var input = document.getElementById('scanManualInput');
    if (input) input.focus();
  }

  async function processManualScan() {
    var input = document.getElementById('scanManualInput');
    if (!input || !input.value.trim()) return;
    var val = input.value.trim();

    // Try to find order by number
    var matchedKey = null;
    var allOrders = getOrdersArray();
    var searchNum = val.replace(/[^0-9]/g, '');
    for (var i = 0; i < allOrders.length; i++) {
      var o = allOrders[i];
      var oNum = (o.orderNumber || '').replace(/[^0-9]/g, '');
      if (oNum && searchNum && parseInt(oNum, 10) === parseInt(searchNum, 10)) {
        matchedKey = o._key;
        break;
      }
    }

    if (!matchedKey) {
      showToast('Order not found: ' + val, true);
      return;
    }

    // Stop scan loop temporarily
    if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    var sgId = 'SG-' + searchNum;
    await processScanMatch(sgId);
    input.value = '';
  }

  function stopScanCamera() {
    if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    if (scanCamera) {
      scanCamera.getTracks().forEach(function(t) { t.stop(); });
      scanCamera = null;
    }
    scanProcessing = false;
  }

  // ---- Drop-off Scan ----
  function renderDeliverView() {
    var el = document.getElementById('fulfDeliverView');
    var openBundleId = getOpenBundle();

    if (!openBundleId) {
      // Check for packed orders not in any bundle
      var packedOrders = getOrdersArray().filter(function(o) { return o.status === 'packed'; });
      if (packedOrders.length === 0) {
        el.innerHTML = '<div class="empty-state" style="margin-top:12px;"><div class="empty-icon">&#128666;</div><p>No open bundles. Scan packages in Studio Scan first.</p></div>';
        return;
      }
      el.innerHTML = '<div class="empty-state" style="margin-top:12px;"><div class="empty-icon">&#128666;</div><p>No open bundles but ' + packedOrders.length + ' packed order(s) found. Go to Studio Scan to create a bundle.</p></div>';
      return;
    }

    activeBundleId = openBundleId;
    var b = bundles[openBundleId];
    var allIds = b.orderIds || [];
    var scanned = b.scannedAtDropOff || [];
    var total = allIds.length;
    var doneCount = scanned.length;
    var pct = total > 0 ? Math.round(doneCount / total * 100) : 0;

    var listHtml = '';
    allIds.forEach(function(oid) {
      var o = orders[oid];
      var num = o ? getOrderDisplayNumber(o) : oid;
      var isDone = scanned.indexOf(oid) !== -1;
      listHtml += '<div style="padding:6px 0;display:flex;align-items:center;gap:8px;">' +
        '<span style="font-size:1.1rem;">' + (isDone ? '&#10003;' : '&#9744;') + '</span>' +
        '<span style="font-family:monospace;font-weight:' + (isDone ? '400' : '600') + ';' + (isDone ? 'color:var(--warm-gray);text-decoration:line-through;' : '') + '">' + esc(num) + '</span>' +
      '</div>';
    });

    var carrierHtml = '';
    if (!b.carrier) {
      carrierHtml = '<div style="background:#FFF3E0;border:1px solid #F1641E;border-radius:8px;padding:12px;margin-bottom:12px;">' +
        '<div style="font-weight:600;margin-bottom:8px;">Set carrier before scanning</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<select id="deliverCarrier" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;">' +
            '<option value="USPS">USPS</option><option value="UPS">UPS</option><option value="Other">Other</option>' +
          '</select>' +
          '<input type="text" id="deliverLocation" placeholder="Drop-off location" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;flex:1;min-width:150px;">' +
          '<button class="btn btn-primary" onclick="setDeliverCarrier()">Set</button>' +
        '</div>' +
      '</div>';
    } else {
      carrierHtml = '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:8px;">' +
        esc(b.carrier) + (b.dropOffLocation ? ' — ' + esc(b.dropOffLocation) : '') + '</div>';
    }

    el.innerHTML = '<div style="margin-top:12px;">' +
      '<div style="background:var(--cream);border:1px solid var(--teal);border-radius:8px;padding:12px 16px;margin-bottom:12px;">' +
        '<div style="font-weight:600;">' + esc(b.name || 'Bundle') + '</div>' +
        carrierHtml +
        '<div style="background:#e0e0e0;border-radius:4px;height:8px;overflow:hidden;margin:8px 0;">' +
          '<div style="background:var(--teal);height:100%;width:' + pct + '%;transition:width 0.3s;"></div></div>' +
        '<div style="font-size:0.85rem;font-weight:600;">' + doneCount + ' of ' + total + ' scanned</div>' +
        listHtml +
      '</div>' +
      (b.carrier ? '<div id="deliverScanArea">' +
        '<div id="deliverStatus" style="text-align:center;padding:8px;font-size:0.9rem;color:var(--warm-gray);">Loading camera...</div>' +
        '<div style="position:relative;max-width:640px;margin:0 auto;">' +
          '<video id="deliverVideo" autoplay playsinline muted style="width:100%;border-radius:8px;background:#000;"></video>' +
          '<div id="deliverOverlay" style="position:absolute;top:0;left:0;right:0;bottom:0;border:3px solid transparent;border-radius:8px;pointer-events:none;transition:border-color 0.3s;"></div>' +
        '</div>' +
        '<canvas id="deliverCanvas" style="display:none;"></canvas>' +
        '<div id="deliverResult" style="display:none;margin-top:12px;"></div>' +
      '</div>' : '') +
      '<div style="display:flex;gap:8px;justify-content:center;margin-top:12px;">' +
        '<button class="btn btn-secondary" onclick="openConfirmAllDeliveredModal()">Confirm All Delivered</button>' +
      '</div>' +
    '</div>';

    if (b.carrier) startDeliverCamera();
  }

  async function setDeliverCarrier() {
    var carrier = document.getElementById('deliverCarrier').value;
    var location = (document.getElementById('deliverLocation').value || '').trim();
    if (!activeBundleId) return;
    await updateBundleCarrier(activeBundleId, carrier, location);
    renderDeliverView();
  }

  async function startDeliverCamera() {
    try {
      await loadTesseract();
      var video = document.getElementById('deliverVideo');
      if (!video) return;
      var statusEl = document.getElementById('deliverStatus');

      var constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
      var stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      scanCamera = stream;

      video.onloadedmetadata = function() {
        if (statusEl) statusEl.textContent = 'Scan labels at drop-off...';
        startDeliverScanLoop();
      };
    } catch (err) {
      var statusEl = document.getElementById('deliverStatus');
      if (statusEl) statusEl.textContent = 'Camera error: ' + err.message;
      showToast('Camera access denied or unavailable', true);
    }
  }

  function startDeliverScanLoop() {
    scanInterval = setInterval(function() {
      if (scanProcessing) return;
      captureAndOCRDeliver();
    }, 500);
  }

  async function captureAndOCRDeliver() {
    scanProcessing = true;
    try {
      var video = document.getElementById('deliverVideo');
      var canvas = document.getElementById('deliverCanvas');
      if (!video || !canvas || !video.videoWidth) { scanProcessing = false; return; }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);

      var w = canvas.width, h = canvas.height;
      var minDim = 1500;
      if (w < minDim && h < minDim) {
        var scale = minDim / Math.max(w, h);
        var ocrCanvas = document.createElement('canvas');
        ocrCanvas.width = Math.round(w * scale);
        ocrCanvas.height = Math.round(h * scale);
        ocrCanvas.getContext('2d').drawImage(canvas, 0, 0, ocrCanvas.width, ocrCanvas.height);
        var result = await Tesseract.recognize(ocrCanvas, 'eng');
      } else {
        var result = await Tesseract.recognize(canvas, 'eng');
      }

      var text = result.data.text || '';
      var match = text.match(/#{4,}(SG-\d{3,6})#{4,}/);
      if (match) {
        var sgId = match[1];
        var overlay = document.getElementById('deliverOverlay');
        if (overlay) overlay.style.borderColor = '#2E7D32';
        if (navigator.vibrate) navigator.vibrate(200);
        clearInterval(scanInterval);
        scanInterval = null;
        await processDeliverMatch(sgId);
      }
    } catch (err) { /* OCR frame errors expected */ }
    scanProcessing = false;
  }

  async function processDeliverMatch(sgId) {
    var digits = sgId.replace(/[^0-9]/g, '');
    var num = parseInt(digits, 10);
    var matchedKey = null;
    var allOrders = getOrdersArray();
    for (var i = 0; i < allOrders.length; i++) {
      var o = allOrders[i];
      var oNum = (o.orderNumber || '').replace(/[^0-9]/g, '');
      if (oNum && parseInt(oNum, 10) === num) { matchedKey = o._key; break; }
    }

    var resultEl = document.getElementById('deliverResult');
    var statusEl = document.getElementById('deliverStatus');

    if (!matchedKey || !activeBundleId) {
      if (resultEl) { resultEl.innerHTML = '<div style="text-align:center;color:var(--danger);padding:8px;">Not found: ' + esc(sgId) + '</div>'; resultEl.style.display = ''; }
      setTimeout(function() { startDeliverScanLoop(); }, 2000);
      return;
    }

    var bundle = bundles[activeBundleId];
    if (!bundle || (bundle.orderIds || []).indexOf(matchedKey) === -1) {
      if (resultEl) { resultEl.innerHTML = '<div style="text-align:center;color:var(--danger);padding:8px;">' + esc(sgId) + ' is not in this bundle</div>'; resultEl.style.display = ''; }
      setTimeout(function() { startDeliverScanLoop(); }, 2000);
      return;
    }

    // Mark scanned + transition order
    await markScannedAtDropOff(activeBundleId, matchedKey);
    await transitionOrder(matchedKey, 'handed_to_carrier');

    // Add fulfillment log entry with bundle/carrier info
    var o = orders[matchedKey];
    if (o) {
      var ffLog = o.fulfillmentLog ? o.fulfillmentLog.slice() : [];
      // The transitionOrder already added a basic entry; update the last one with bundle info
      if (ffLog.length > 0) {
        var last = ffLog[ffLog.length - 1];
        if (last.event === 'handed_to_carrier') {
          last.bundleId = activeBundleId;
          last.carrier = bundle.carrier || '';
          last.dropOffLocation = bundle.dropOffLocation || '';
          last.method = 'ocr';
          await MastDB.orders.subRef(matchedKey, 'fulfillmentLog').set(ffLog);
        }
      }
    }

    var overlay = document.getElementById('deliverOverlay');
    if (overlay) overlay.style.borderColor = 'transparent';

    // Re-render to update checklist
    renderDeliverView();
  }

  function openConfirmAllDeliveredModal() {
    if (!activeBundleId || !bundles[activeBundleId]) return;
    var b = bundles[activeBundleId];
    var allIds = b.orderIds || [];
    var scanned = b.scannedAtDropOff || [];

    var checklistHtml = '';
    allIds.forEach(function(oid) {
      var o = orders[oid];
      var num = o ? getOrderDisplayNumber(o) : oid;
      var isDone = scanned.indexOf(oid) !== -1;
      checklistHtml += '<div style="padding:4px 0;">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
          '<input type="checkbox" class="confirm-deliver-cb" data-oid="' + esc(oid) + '" ' + (isDone ? 'checked disabled' : 'checked') + '>' +
          '<span style="font-family:monospace;">' + esc(num) + '</span>' +
          (isDone ? ' <span style="color:var(--warm-gray);font-size:0.78rem;">(already scanned)</span>' : '') +
        '</label>' +
      '</div>';
    });

    openModal('<div style="max-width:400px;">' +
      '<h3>Confirm All Delivered</h3>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);">Uncheck any packages NOT handed to the carrier.</p>' +
      checklistHtml +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="submitConfirmAllDelivered()">Confirm</button>' +
      '</div>' +
    '</div>');
  }

  async function submitConfirmAllDelivered() {
    if (!activeBundleId) return;
    var checkboxes = document.querySelectorAll('.confirm-deliver-cb');
    var bundle = bundles[activeBundleId];
    var scanned = (bundle.scannedAtDropOff || []).slice();

    for (var i = 0; i < checkboxes.length; i++) {
      var cb = checkboxes[i];
      var oid = cb.getAttribute('data-oid');
      if (cb.checked && scanned.indexOf(oid) === -1) {
        scanned.push(oid);
        // Transition order
        if (orders[oid] && orders[oid].status === 'packed') {
          await transitionOrder(oid, 'handed_to_carrier');
          // Update fulfillment log with manual_confirmation method
          var o = orders[oid];
          if (o && o.fulfillmentLog) {
            var ffLog = o.fulfillmentLog.slice();
            if (ffLog.length > 0 && ffLog[ffLog.length - 1].event === 'handed_to_carrier') {
              ffLog[ffLog.length - 1].method = 'manual_confirmation';
              ffLog[ffLog.length - 1].bundleId = activeBundleId;
              ffLog[ffLog.length - 1].carrier = bundle.carrier || '';
              ffLog[ffLog.length - 1].dropOffLocation = bundle.dropOffLocation || '';
              await MastDB.orders.subRef(oid, 'fulfillmentLog').set(ffLog);
            }
          }
        }
      }
    }

    // Update bundle
    var updates = { scannedAtDropOff: scanned };
    if (scanned.length >= (bundle.orderIds || []).length) {
      updates.status = 'delivered';
      updates.deliveredAt = new Date().toISOString();
    }
    await MastDB.bundles.update(activeBundleId, updates);

    closeModal();
    if (updates.status === 'delivered') {
      showToast('Bundle delivered! All packages confirmed.');
    }
    renderDeliverView();
  }

  // ---- Production Request Fulfillment ----
  async function fulfillProductionRequest(requestId, orderId, operatorName) {
    try {
      var now = new Date().toISOString();
      await MastDB.productionRequests.ref(requestId).update({
        status: 'fulfilled',
        fulfilledAt: now,
        fulfilledBy: operatorName || 'admin'
      });
      await writeAudit('update', 'buildJobs', requestId);

      // Update order fulfillment - mark item as ready (same logic as before)
      var o = orders[orderId];
      if (o && o.fulfillment) {
        var allReady = true;
        var ffUpdates = {};
        Object.keys(o.fulfillment).forEach(function(key) {
          var ff = o.fulfillment[key];
          if (ff.buildJobId === requestId) {
            ffUpdates['fulfillment/' + key + '/ready'] = true;
          }
          if (ff.buildJobId !== requestId && !ff.ready) {
            allReady = false;
          }
        });
        await MastDB.orders.ref(orderId).update(ffUpdates);

        // If all items ready, auto-transition order to ready
        if (allReady) {
          var history = o.statusHistory ? o.statusHistory.slice() : [];
          history.push({ status: 'ready', at: now, by: 'system', note: 'All production requests fulfilled' });
          await MastDB.orders.ref(orderId).update({
            status: 'ready',
            readyAt: now,
            statusHistory: history
          });
          showToast('All items ready! Order moved to Ready.');
        } else {
          showToast('Production request fulfilled');
        }
        emitTestingEvent('fulfillRequest', {});
      }
    } catch (err) {
      showToast('Error fulfilling request: ' + err.message, true);
    }
  }

  async function assignRequestToJob(requestId, jobId, lineItemId) {
    try {
      await MastDB.productionRequests.ref(requestId).update({
        status: 'assigned',
        jobId: jobId,
        lineItemId: lineItemId
      });
      await writeAudit('update', 'buildJobs', requestId);
      showToast('Request assigned to job');
    } catch (err) {
      showToast('Error assigning request: ' + err.message, true);
    }
  }

  // ============================================================
  // Window exports
  // ============================================================

  window.loadBundles = loadBundles;
  window.switchPackSubView = switchPackSubView;
  window.switchShipSubView = switchShipSubView;
  window.renderPackQueue = renderPackQueue;
  window.packQueueTransition = async function(orderId, newStatus) {
    await transitionOrder(orderId, newStatus);
    renderPackQueue();
  };
  window.downloadOrderCSV = downloadOrderCSV;
  window.openPirateShip = openPirateShip;
  window.generateAdminPirateShipCSV = generateAdminPirateShipCSV;
  window.createBundle = createBundle;
  window.addToBundle = addToBundle;
  window.markScannedAtDropOff = markScannedAtDropOff;
  window.updateBundleCarrier = updateBundleCarrier;
  window.getOpenBundle = getOpenBundle;
  window.renderBundlesView = renderBundlesView;
  window.loadTesseract = loadTesseract;
  window.renderScanView = renderScanView;
  window.startScanCamera = startScanCamera;
  window.stopScanCamera = stopScanCamera;
  window.processScanMatch = processScanMatch;
  window.showManualOrderEntry = showManualOrderEntry;
  window.processManualScan = processManualScan;
  window.renderDeliverView = renderDeliverView;
  window.setDeliverCarrier = setDeliverCarrier;
  window.startDeliverCamera = startDeliverCamera;
  window.openConfirmAllDeliveredModal = openConfirmAllDeliveredModal;
  window.submitConfirmAllDelivered = submitConfirmAllDelivered;
  window.fulfillProductionRequest = fulfillProductionRequest;
  window.assignRequestToJob = assignRequestToJob;

  // ============================================================
  // Module registration
  // ============================================================

  function ensureFulfillmentData() {
    if (!ordersLoaded && typeof loadOrders === 'function') loadOrders();
  }

  MastAdmin.registerModule('fulfillment', {
    routes: {
      'pack': { tab: 'packTab', setup: function() { ensureFulfillmentData(); switchPackSubView('queue'); } },
      'ship': { tab: 'shipTab', setup: function() { ensureFulfillmentData(); if (!bundlesLoaded) loadBundles(); switchShipSubView('deliver'); } },
      'fulfillment': { tab: 'packTab', setup: function() { ensureFulfillmentData(); switchPackSubView('queue'); currentRoute = 'pack'; location.hash = 'pack'; } }
    },
    detachListeners: function() {
      if (bundlesListener) {
        MastDB.bundles.unlisten(bundlesListener);
        bundlesListener = null;
      }
      bundles = {};
      bundlesLoaded = false;
      stopScanCamera();
    }
  });

})();
