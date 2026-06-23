// app/modules/intake-ops.js  (T1 extraction)
//
// Inventory Intake (camera-first training-quality capture flow), the Operators
// roster (Settings), and the Storage Info readout. Extracted byte-identical from
// the inline block in index.html. Top-level functions and intake state vars stay
// window globals (the inline block is not an IIFE), so the intake overlay markup
// handlers and the Settings route dispatcher still resolve startIntakeMode /
// loadOperators / loadStorageInfo et al. post-load.

// ============================================================
// INVENTORY INTAKE (Camera-First, Training-Quality Photos)
// ============================================================

var intakeCamera = null;
var intakeJobId = null;
var intakeLoggedCount = 0;
var intakeTargetCount = 0;
var intakeItems = [];
var intakeLastBase64 = null;
var intakeTrainingMode = false; // true when taking extra training photos for the same piece
var intakeCurrentPiece = null; // { pid, variantKey, variantDesc, locationId, attrTags }
var intakeTrainingPhotoCount = 0;

function startIntakeMode(jobId) {
  intakeJobId = jobId;
  intakeLoggedCount = 0;
  intakeItems = [];
  intakeLastBase64 = null;

  // Calculate target from job line items
  intakeTargetCount = 0;
  if (jobId) {
    var job = productionJobs[jobId];
    if (job && job.lineItems) {
      Object.values(job.lineItems).forEach(function(li) {
        intakeTargetCount += (li.completedQuantity || li.targetQuantity || 0);
      });
    }
  }

  // Make sure locations are loaded
  if (!locationsLoaded) { loadLocations(); }

  document.getElementById('intakeOverlay').style.display = '';
  document.getElementById('intakeResult').style.display = 'none';
  document.getElementById('intakeManualPicker').style.display = 'none';
  updateIntakeTally();
  renderIntakeLoggedItems();
  startIntakeCamera();
}

function updateIntakeTally() {
  var el = document.getElementById('intakeTally');
  if (!el) return;
  if (intakeTargetCount > 0) {
    el.textContent = '✅ ' + intakeLoggedCount + ' of ' + intakeTargetCount + ' pieces logged';
  } else if (intakeLoggedCount > 0) {
    el.textContent = '✅ ' + intakeLoggedCount + ' pieces logged';
  } else {
    el.textContent = 'Snap a photo of each finished piece to log it.';
  }
}

function startIntakeCamera() {
  var videoEl = document.getElementById('intakeVideo');
  if (!videoEl) return;
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
  }).then(function(stream) {
    intakeCamera = stream;
    videoEl.srcObject = stream;
  }).catch(function(err) {
    showToast('Camera error: ' + err.message, true);
  });
}

function stopIntakeCamera() {
  if (intakeCamera) {
    intakeCamera.getTracks().forEach(function(t) { t.stop(); });
    intakeCamera = null;
  }
  var videoEl = document.getElementById('intakeVideo');
  if (videoEl) videoEl.srcObject = null;
}

async function captureIntakePhoto() {
  var videoEl = document.getElementById('intakeVideo');
  if (!videoEl || !intakeCamera) { showToast('Camera not ready', true); return; }

  var btn = document.getElementById('intakeCaptureBtn');
  btn.disabled = true;
  btn.textContent = '⏳';

  // Capture at high quality for training
  var canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth || 1280;
  canvas.height = videoEl.videoHeight || 960;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  var base64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  intakeLastBase64 = base64;

  // Run classification with training context
  try {
    var token = await auth.currentUser.getIdToken();
    var catalog = buildProductCatalogForVision();
    var resp = await callCF('/classifyImage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ image: base64, catalog: catalog, context: 'inventory' })
    });
    var result = await resp.json();
    showIntakeResult(result);
  } catch (err) {
    showToast('Classification error: ' + err.message, true);
    document.getElementById('intakeManualPicker').style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '📸';
  }
}

function showIntakeResult(result) {
  var el = document.getElementById('intakeResult');
  var content = document.getElementById('intakeResultContent');
  el.style.display = '';

  var pid = result.productId;
  var product = productsData.find(function(p) { return p.pid === pid; });
  var conf = result.confidence || 0;
  var confColor = conf >= 80 ? 'rgba(76,175,80,1)' : conf >= 50 ? 'rgba(255,152,0,1)' : 'rgba(244,67,54,1)';

  if (!product) {
    content.innerHTML = '<div style="color:white;">' +
      '<p style="color:rgba(255,152,0,1);font-weight:600;">Could not identify product.</p>' +
      '<button onclick="toggleIntakeManualPicker()" style="background:rgba(255,152,0,1);color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Select Manually</button>' +
    '</div>';
    return;
  }

  // Build variant options
  var variantInfo = getProductVariantCombos(product);
  var variantHtml = '';
  if (variantInfo.combos.length > 0) {
    variantInfo.labels.forEach(function(label, idx) {
      var uniqueValues = [];
      variantInfo.combos.forEach(function(combo) {
        if (uniqueValues.indexOf(combo[idx]) === -1) uniqueValues.push(combo[idx]);
      });
      // Pre-select from classification if possible
      var detectedValue = result.color || '';
      variantHtml += '<div style="margin-bottom:8px;">' +
        '<label style="font-size:0.78rem;color:rgba(255,255,255,0.6);">' + esc(label) + '</label>' +
        '<select id="intakeVariant_' + idx + '" style="width:100%;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:white;font-family:\'DM Sans\',sans-serif;">' +
        uniqueValues.map(function(v) {
          var selected = (v.toLowerCase() === detectedValue.toLowerCase()) ? ' selected' : '';
          return '<option value="' + esc(v) + '"' + selected + '>' + esc(v) + '</option>';
        }).join('') +
        '</select></div>';
    });
  }

  // Build location picker
  var activeLocs = getLocationsArray('active');
  var homeId = getHomeLocationId();
  var locOptions = activeLocs.map(function(loc) {
    var icon = loc.type === 'home' ? '🏠' : loc.type === 'event' ? '🎪' : loc.type === 'container' ? '📦' : '📍';
    var sel = (loc.id === homeId) ? ' selected' : '';
    return '<option value="' + esc(loc.id) + '"' + sel + '>' + icon + ' ' + esc(loc.name) + '</option>';
  }).join('');

  content.innerHTML = '<div style="color:white;">' +
    '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;">' +
      (product.images && product.images.length ? '<img src="' + esc(firstProductImage(product)) + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;">' : '') +
      '<div>' +
        '<div style="font-weight:600;font-size:1rem;">' + esc(product.name) + '</div>' +
        '<div style="font-size:0.78rem;color:' + confColor + ';">' + conf + '% confidence</div>' +
      '</div>' +
    '</div>' +
    variantHtml +
    '<div style="display:flex;gap:12px;margin-bottom:8px;">' +
      '<div style="flex:1;">' +
        '<label style="font-size:0.78rem;color:rgba(255,255,255,0.6);">Storage Location</label>' +
        '<select id="intakeLocation" style="width:100%;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:white;font-family:\'DM Sans\',sans-serif;">' +
          locOptions +
        '</select>' +
      '</div>' +
      '<div style="width:80px;">' +
        '<label style="font-size:0.78rem;color:rgba(255,255,255,0.6);">Qty</label>' +
        '<input type="number" id="intakeQty" min="1" value="1" style="width:100%;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:white;font-family:\'DM Sans\',sans-serif;text-align:center;font-size:1rem;">' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button onclick="confirmIntakeItem(\'' + esc(pid) + '\')" style="flex:1;background:rgba(76,175,80,1);color:white;border:none;padding:10px;border-radius:6px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600;">✅ Confirm & Log</button>' +
      '<button onclick="toggleIntakeManualPicker()" style="background:rgba(255,255,255,0.15);color:white;border:none;padding:10px 14px;border-radius:6px;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Wrong product?</button>' +
    '</div>' +
  '</div>';
}

async function confirmIntakeItem(pid) {
  var product = productsData.find(function(p) { return p.pid === pid; });
  if (!product) return;

  var variantInfo = getProductVariantCombos(product);
  var variantKey = '_default';
  var variantDesc = '';
  var attrTags = [];

  if (variantInfo.combos.length > 0) {
    var values = variantInfo.labels.map(function(label, idx) {
      var sel = document.getElementById('intakeVariant_' + idx);
      var val = sel ? sel.value : '';
      attrTags.push(label.toLowerCase() + ':' + val.toLowerCase());
      return val;
    });
    variantKey = comboKey(values);
    variantDesc = values.join(' / ');
  }

  var locationId = document.getElementById('intakeLocation').value || getHomeLocationId();
  var locationName = locationsData[locationId] ? locationsData[locationId].name : 'Home';
  var intakeQtyEl = document.getElementById('intakeQty');
  var qty = intakeQtyEl ? (parseInt(intakeQtyEl.value) || 1) : 1;
  if (qty < 1) qty = 1;

  try {
    // 1. Add to inventory at location (supports qty > 1)
    await addToLocation(pid, variantKey, locationId, qty);

    // 2. Upload training image to library
    if (intakeLastBase64) {
      var token = await auth.currentUser.getIdToken();
      var tags = ['training', 'inventory-intake', pid].concat(attrTags);
      callCF('/uploadImage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ image: intakeLastBase64, tags: tags, source: 'intake', productId: pid })
      }).catch(function() { /* non-blocking */ });
    }

    // 3. Track logged item
    intakeLoggedCount += qty;
    intakeItems.push({
      pid: pid,
      productName: product.name,
      variant: variantDesc,
      location: locationName,
      qty: qty,
      timestamp: new Date().toISOString()
    });

    updateIntakeTally();
    renderIntakeLoggedItems();
    intakeLastBase64 = null;
    showToast('+' + qty + ' ' + product.name + (variantDesc ? ' (' + variantDesc + ')' : '') + ' → ' + locationName);

    // 4. Check if product needs more training photos — offer multi-photo mode
    intakeCurrentPiece = { pid: pid, variantKey: variantKey, variantDesc: variantDesc, locationId: locationId, attrTags: attrTags };
    intakeTrainingPhotoCount = 0;
    var trainingPhotoCount = countTrainingPhotos(pid);
    showTrainingPrompt(product.name, trainingPhotoCount);

  } catch (err) {
    showToast('Error logging item: ' + err.message, true);
  }
}

function countTrainingPhotos(pid) {
  // Count existing training images for this product in the image library
  var count = 0;
  Object.values(imageLibrary).forEach(function(img) {
    if (img.productId === pid || (img.tags && img.tags.indexOf(pid) >= 0)) {
      count++;
    }
  });
  return count;
}

function showTrainingPrompt(productName, existingPhotos) {
  var el = document.getElementById('intakeResult');
  var content = document.getElementById('intakeResultContent');
  el.style.display = '';
  intakeTrainingMode = true;

  var suggestion = '';
  if (existingPhotos < 5) {
    suggestion = '<div style="color:rgba(255,152,0,1);font-size:0.85rem;margin-bottom:8px;">📷 This product has few training photos (' + existingPhotos + '). <strong>3 angles recommended</strong> — front, side, detail.</div>';
  } else if (existingPhotos < 15) {
    suggestion = '<div style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin-bottom:8px;">📷 ' + existingPhotos + ' training photos exist. Additional angles help improve recognition.</div>';
  } else {
    suggestion = '<div style="color:rgba(255,255,255,0.4);font-size:0.85rem;margin-bottom:8px;">📷 ' + existingPhotos + ' training photos — recognition should be solid. Skip unless this piece looks unusual.</div>';
  }

  content.innerHTML = '<div style="color:white;">' +
    '<div style="font-weight:600;margin-bottom:8px;">✅ ' + esc(productName) + ' logged to inventory</div>' +
    suggestion +
    (intakeTrainingPhotoCount > 0 ? '<div style="color:rgba(76,175,80,1);font-size:0.85rem;margin-bottom:8px;">+' + intakeTrainingPhotoCount + ' training photo' + (intakeTrainingPhotoCount > 1 ? 's' : '') + ' captured</div>' : '') +
    '<div style="display:flex;gap:8px;">' +
      '<button onclick="captureTrainingPhoto()" style="flex:1;background:rgba(25,118,210,1);color:white;border:none;padding:10px;border-radius:6px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600;">📸 Add Training Photo</button>' +
      '<button onclick="finishCurrentPiece()" style="flex:1;background:rgba(255,255,255,0.15);color:white;border:none;padding:10px;border-radius:6px;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Done → Next Piece</button>' +
    '</div>' +
  '</div>';
}

async function captureTrainingPhoto() {
  if (!intakeCurrentPiece) return;
  var videoEl = document.getElementById('intakeVideo');
  if (!videoEl || !intakeCamera) { showToast('Camera not ready', true); return; }

  // Capture high-quality training photo
  var canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth || 1280;
  canvas.height = videoEl.videoHeight || 960;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  var base64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];

  // Upload as training-only (no inventory increment)
  try {
    var token = await auth.currentUser.getIdToken();
    var tags = ['training', 'inventory-intake', intakeCurrentPiece.pid].concat(intakeCurrentPiece.attrTags);
    callCF('/uploadImage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ image: base64, tags: tags, source: 'training', productId: intakeCurrentPiece.pid })
    }).catch(function() { /* non-blocking */ });

    intakeTrainingPhotoCount++;
    var product = productsData.find(function(p) { return p.pid === intakeCurrentPiece.pid; });
    var trainingPhotoCount = countTrainingPhotos(intakeCurrentPiece.pid) + intakeTrainingPhotoCount;
    showTrainingPrompt(product ? product.name : 'Product', trainingPhotoCount);
    showToast('Training photo ' + intakeTrainingPhotoCount + ' captured');
  } catch (err) {
    showToast('Error capturing training photo: ' + err.message, true);
  }
}

function finishCurrentPiece() {
  intakeTrainingMode = false;
  intakeCurrentPiece = null;
  intakeTrainingPhotoCount = 0;
  document.getElementById('intakeResult').style.display = 'none';
}

function toggleIntakeManualPicker() {
  var el = document.getElementById('intakeManualPicker');
  el.style.display = el.style.display === 'none' ? '' : 'none';
  if (el.style.display !== 'none') {
    filterIntakeProducts();
    document.getElementById('intakeProductSearch').focus();
  }
}

function filterIntakeProducts() {
  var q = (document.getElementById('intakeProductSearch').value || '').toLowerCase();
  var el = document.getElementById('intakeProductList');
  if (!productsData || !productsData.length) { el.innerHTML = ''; return; }

  var filtered = productsData.filter(function(p) {
    if (p.availability === 'discontinued') return false;
    if (!q) return true;
    return (p.name || '').toLowerCase().indexOf(q) >= 0 || (p.pid || '').toLowerCase().indexOf(q) >= 0;
  }).slice(0, 20);

  el.innerHTML = filtered.map(function(p) {
    return '<div onclick="selectIntakeProduct(\'' + esc(p.pid) + '\')" style="padding:8px;cursor:pointer;color:white;border-bottom:1px solid rgba(255,255,255,0.1);">' +
      '<strong>' + esc(p.name) + '</strong>' +
      (p.categories && p.categories.length ? '<span style="font-size:0.78rem;color:rgba(255,255,255,0.5);margin-left:8px;">' + p.categories.join(', ') + '</span>' : '') +
    '</div>';
  }).join('');
}

function selectIntakeProduct(pid) {
  var product = productsData.find(function(p) { return p.pid === pid; });
  if (!product) return;
  // Show result with manual selection
  showIntakeResult({ productId: pid, product: product.name, confidence: 100, color: '' });
  document.getElementById('intakeManualPicker').style.display = 'none';
}

function renderIntakeLoggedItems() {
  var el = document.getElementById('intakeLoggedItems');
  if (!el) return;
  if (intakeItems.length === 0) { el.innerHTML = ''; return; }

  var html = '<h4 style="color:rgba(255,255,255,0.6);margin:0 0 8px 0;font-size:0.85rem;">Logged Items</h4>';
  intakeItems.slice().reverse().forEach(function(item, idx) {
    html += '<div style="display:flex;justify-content:space-between;padding:6px 10px;background:rgba(255,255,255,0.05);border-radius:4px;margin-bottom:4px;color:white;font-size:0.85rem;">' +
      '<span>' + (item.qty && item.qty > 1 ? item.qty + 'x ' : '') + esc(item.productName) + (item.variant ? ' (' + item.variant + ')' : '') + '</span>' +
      '<span style="color:rgba(255,255,255,0.5);">→ ' + esc(item.location) + '</span>' +
    '</div>';
  });
  el.innerHTML = html;
}

function exitIntakeMode() {
  stopIntakeCamera();
  document.getElementById('intakeOverlay').style.display = 'none';
  intakeLastBase64 = null;

  if (intakeLoggedCount > 0) {
    showToast('Intake complete: ' + intakeLoggedCount + ' items logged');
    // Refresh inventory display
    if (currentTab === 'production') renderInventoryOverview();
  }
  intakeJobId = null;
}

// PRODUCTION SYSTEM — loadProduction, PURPOSE_LABELS, PROD_JOB_TRANSITIONS moved to production module
function loadOperators() {
  MastDB.operators.get().then(function(snap) {
    operators = snap || {};
    renderOperatorsList();
  });
}

function renderOperatorsList() {
  var el = document.getElementById('operatorsList');
  if (!el) return;
  var keys = Object.keys(operators);
  if (keys.length === 0) {
    el.innerHTML = '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">No operators added yet.</p>';
    if (typeof refreshWorkshopTabStatus === 'function') refreshWorkshopTabStatus();
    return;
  }
  var html = '';
  keys.forEach(function(k) {
    var op = operators[k];
    html += '<span class="operator-tag">' + esc(op.name || k) +
      ' <span class="remove-op" onclick="removeOperator(\'' + esc(k) + '\')">&times;</span></span>';
  });
  el.innerHTML = html;
  if (typeof refreshWorkshopTabStatus === 'function') refreshWorkshopTabStatus();
}

async function addOperator() {
  var input = document.getElementById('newOperatorName');
  var name = input.value.trim();
  if (!name) { showToast('Enter an operator name', true); return; }
  try {
    var newKey = MastDB.operators.newKey();
    await MastDB.operators.set(newKey, { name: name, addedAt: new Date().toISOString() });
    await writeAudit('create', 'operators', newKey);
    input.value = '';
    loadOperators();
    showToast('Operator added');
  } catch (err) {
    showToast('Error adding operator: ' + err.message, true);
  }
}

async function removeOperator(opId) {
  if (!await mastConfirm('Remove this operator?', { title: 'Remove Operator' })) return;
  try {
    await writeAudit('delete', 'operators', opId);
    await MastDB.operators.remove(opId);
    loadOperators();
    showToast('Operator removed');
  } catch (err) {
    showToast('Error removing operator: ' + err.message, true);
  }
}

function getOperatorNames() {
  return Object.values(operators).map(function(op) { return op.name; });
}

// Production functions (renderPendingRequestsBanner through linkProductToBuild) moved to production module
// ============================================================
// Storage Info (Settings)
// ============================================================

function loadStorageInfo() {
  // The Workshop → Media storage tab's purpose is to confirm where build photos
  // are saved. Real aggregate stats (photo count, total bytes) would require
  // either iterating every build's subcollection (O(builds × media) reads —
  // expensive) or denormalizing counters at write time (schema change in
  // production.js → MastDB.buildMedia.set). Neither is worth doing for a
  // confirmation tab — the bucket line is the answer to "where do my photos go?".
  var el = document.getElementById('storageInfo');
  if (!el) return;
  var bucket = (typeof firebaseConfig !== 'undefined' && firebaseConfig.storageBucket) ? firebaseConfig.storageBucket : 'unknown';
  el.innerHTML = '<div>Bucket: <code style="font-size:0.85rem;">' + bucket + '</code></div>';
}

