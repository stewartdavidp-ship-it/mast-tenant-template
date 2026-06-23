// app/modules/studio-locations.js  (T1 extraction)
//
// Studio Locations settings surface: the studio-location roster (load/render),
// reverse-geocoding + address confirm/edit/save, add/remove, default ship-from
// selection, and the haversine / isNearAnyStudio geofence helpers. Extracted
// byte-identical from the inline block in index.html. Top-level functions and
// the studioLocations / STUDIO_RADIUS_METERS state stay window globals (the
// inline block is not an IIFE), so the Settings route dispatcher and the
// workshop-tab markup handlers still resolve them post-load.

// ============================================================
// Studio Locations (Settings)
// ============================================================

var studioLocations = {};
var STUDIO_RADIUS_METERS = 500;

function loadStudioLocations() {
  MastDB.studioLocations.get().then(function(snap) {
    studioLocations = snap || {};
    renderStudioLocations();
  });
}

function renderStudioLocations() {
  var el = document.getElementById('studioLocationsList');
  if (!el) return;
  var keys = Object.keys(studioLocations);
  if (keys.length === 0) {
    el.innerHTML = '<div style="padding:12px;background:var(--cream);border-radius:6px;color:var(--warm-gray);font-size:0.85rem;">No studio locations set. Add your first one while at the studio.</div>';
    if (typeof refreshWorkshopTabStatus === 'function') refreshWorkshopTabStatus();
    return;
  }
  var html = '';
  keys.forEach(function(k) {
    var loc = studioLocations[k];
    var addrLine = loc.address1 ? [loc.address1, loc.city, loc.state, loc.zip].filter(Boolean).join(', ') : '';
    var isDefault = loc.isDefaultShipFrom;
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 12px;background:var(--cream);border-radius:6px;margin-bottom:6px;">' +
      '<div style="flex:1;">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span style="font-weight:600;font-size:0.9rem;">' + esc(loc.name || 'Unnamed') + '</span>' +
          (isDefault ? '<span style="font-size:0.72rem;background:var(--teal);color:white;padding:2px 6px;border-radius:4px;font-weight:600;">Default Ship-From</span>' : '') +
        '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">📍 ' + (loc.lat ? loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5) : 'No GPS') + '</div>' +
        (addrLine ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">📦 ' + esc(addrLine) + '</div>' : '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:2px;font-style:italic;">No shipping address set</div>') +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0;">' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="editStudioLocationAddress(\'' + k + '\')">Edit Address</button>' +
        (!isDefault ? '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="setDefaultShipFrom(\'' + k + '\')">Set Default</button>' : '') +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;color:rgba(229,57,53,1);" onclick="removeStudioLocation(\'' + k + '\')">Remove</button>' +
      '</div>' +
    '</div>';
  });
  el.innerHTML = html;
  if (typeof refreshWorkshopTabStatus === 'function') refreshWorkshopTabStatus();
}

async function _reverseGeocode(lat, lng) {
  // Try OpenStreetMap Nominatim (free, no API key needed)
  try {
    var resp = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&addressdetails=1&zoom=18', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'MastPlatform/1.0' }
    });
    var data = await resp.json();
    if (data && data.address) {
      var a = data.address;
      var streetNum = a.house_number || '';
      var street = a.road || '';
      return {
        address1: (streetNum + ' ' + street).trim(),
        city: a.city || a.town || a.village || a.hamlet || '',
        state: a.state || '',
        zip: a.postcode || ''
      };
    }
  } catch (e) {
    console.warn('Nominatim reverse geocode failed:', e.message);
  }

  // Fallback: try Google Maps Geocoding API if key is available
  try {
    var keySnap = await MastDB.config.googleMaps().once('value');
    var apiKey = keySnap.val();
    if (!apiKey) return null;

    var resp2 = await fetch('https://maps.googleapis.com/maps/api/geocode/json?latlng=' + lat + ',' + lng + '&key=' + apiKey);
    var data2 = await resp2.json();
    if (data2.status !== 'OK' || !data2.results || !data2.results.length) return null;

    var components = data2.results[0].address_components || [];
    var get = function(type) {
      var c = components.find(function(c) { return c.types.indexOf(type) !== -1; });
      return c ? c.short_name : '';
    };
    var getLong = function(type) {
      var c = components.find(function(c) { return c.types.indexOf(type) !== -1; });
      return c ? c.long_name : '';
    };

    return {
      address1: (get('street_number') + ' ' + getLong('route')).trim(),
      city: getLong('locality') || getLong('sublocality') || '',
      state: get('administrative_area_level_1') || '',
      zip: get('postal_code') || ''
    };
  } catch (e2) {
    console.warn('Google reverse geocode failed:', e2.message);
    return null;
  }
}

function addStudioLocation() {
  var name = document.getElementById('newStudioLocationName').value.trim();
  if (!name) { showToast('Enter a location name first', true); return; }

  var statusEl = document.getElementById('studioLocationStatus');
  statusEl.innerHTML = '<span style="color:var(--warm-gray);">📡 Getting your location...</span>';

  if (!navigator.geolocation) {
    statusEl.innerHTML = '<span style="color:rgba(229,57,53,1);">Geolocation not supported on this device.</span>';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function(pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;
      var newKey = MastDB.studioLocations.newKey();
      var locData = { name: name, lat: lat, lng: lng, radius: STUDIO_RADIUS_METERS, createdAt: new Date().toISOString() };

      // Save location with GPS first (no address yet)
      MastDB.studioLocations.set(newKey, locData).then(function() {
        writeAudit('create', 'locations', newKey);
        document.getElementById('newStudioLocationName').value = '';
        studioLocations[newKey] = locData;
        renderStudioLocations();
        statusEl.innerHTML = '<span style="color:var(--warm-gray);">Looking up address...</span>';

        // Reverse-geocode, then open address form pre-filled for user to confirm
        _reverseGeocode(lat, lng).then(function(addr) {
          statusEl.innerHTML = '';
          _openAddressConfirmation(newKey, addr);
        });
      }).catch(function(err) {
        statusEl.innerHTML = '<span style="color:var(--danger);">Error: ' + esc(err.message) + '</span>';
      });
    },
    function(err) {
      var msg = 'Location error: ';
      if (err.code === 1) msg += 'Permission denied. Allow location access in your browser settings.';
      else if (err.code === 2) msg += 'Position unavailable.';
      else if (err.code === 3) msg += 'Request timed out.';
      else msg += err.message;
      statusEl.innerHTML = '<span style="color:rgba(229,57,53,1);">' + msg + '</span>';
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

async function removeStudioLocation(locId) {
  if (!await mastConfirm('Remove this studio location?', { title: 'Remove Location', danger: true })) return;
  try {
    await writeAudit('delete', 'locations', locId);
    await MastDB.studioLocations.remove(locId);
    showToast('Location removed.');
    loadStudioLocations();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

function _openAddressConfirmation(locId, geocodedAddr) {
  var loc = studioLocations[locId] || {};
  var addr = geocodedAddr || {};
  var html = '<div style="max-width:400px;padding:24px;">' +
    '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:500;margin:0 0 4px;">Confirm Ship-From Address</h3>' +
    '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 16px;">' + esc(loc.name || 'Location') + ' — review and correct if needed, then save.</p>' +
    '<div class="form-group"><label>Address Line 1</label><input type="text" id="slAddr1" value="' + esc(addr.address1 || '') + '" placeholder="123 Main St"></div>' +
    '<div class="form-group"><label>Address Line 2</label><input type="text" id="slAddr2" value="" placeholder="Suite 100"></div>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
      '<div class="form-group" style="flex:2;min-width:140px;"><label>City</label><input type="text" id="slCity" value="' + esc(addr.city || '') + '"></div>' +
      '<div class="form-group" style="flex:1;min-width:60px;"><label>State</label><input type="text" id="slState" value="' + esc(addr.state || '') + '" maxlength="2" placeholder="CA"></div>' +
      '<div class="form-group" style="flex:1;min-width:80px;"><label>ZIP</label><input type="text" id="slZip" value="' + esc(addr.zip || '') + '" maxlength="10"></div>' +
    '</div>' +
    '<div class="form-group"><label>Phone</label><input type="text" id="slPhone" value="" placeholder="(555) 123-4567"></div>' +
    '<div style="display:flex;gap:8px;margin-top:16px;">' +
      '<button class="btn btn-primary" onclick="saveStudioLocationAddress(\'' + locId + '\')">Save Address</button>' +
      '<button class="btn btn-secondary" onclick="closeModal()">Skip for Now</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

function editStudioLocationAddress(locId) {
  var loc = studioLocations[locId] || {};
  var html = '<div style="max-width:400px;padding:24px;">' +
    '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:500;margin:0 0 16px;">Ship-From Address: ' + esc(loc.name || 'Location') + '</h3>' +
    '<div class="form-group"><label>Address Line 1</label><input type="text" id="slAddr1" value="' + esc(loc.address1 || '') + '" placeholder="123 Main St"></div>' +
    '<div class="form-group"><label>Address Line 2</label><input type="text" id="slAddr2" value="' + esc(loc.address2 || '') + '" placeholder="Suite 100"></div>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
      '<div class="form-group" style="flex:2;min-width:140px;"><label>City</label><input type="text" id="slCity" value="' + esc(loc.city || '') + '"></div>' +
      '<div class="form-group" style="flex:1;min-width:60px;"><label>State</label><input type="text" id="slState" value="' + esc(loc.state || '') + '" maxlength="2" placeholder="CA"></div>' +
      '<div class="form-group" style="flex:1;min-width:80px;"><label>ZIP</label><input type="text" id="slZip" value="' + esc(loc.zip || '') + '" maxlength="10"></div>' +
    '</div>' +
    '<div class="form-group"><label>Phone</label><input type="text" id="slPhone" value="' + esc(loc.phone || '') + '" placeholder="(555) 123-4567"></div>' +
    '<div style="display:flex;gap:8px;margin-top:16px;">' +
      '<button class="btn btn-primary" onclick="saveStudioLocationAddress(\'' + locId + '\')">Save Address</button>' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

async function saveStudioLocationAddress(locId) {
  var updates = {
    address1: document.getElementById('slAddr1').value.trim(),
    address2: document.getElementById('slAddr2').value.trim(),
    city: document.getElementById('slCity').value.trim(),
    state: document.getElementById('slState').value.trim().toUpperCase(),
    zip: document.getElementById('slZip').value.trim(),
    phone: document.getElementById('slPhone').value.trim()
  };
  try {
    await MastDB.studioLocations.update(locId, updates);
    Object.assign(studioLocations[locId], updates);
    closeModal();
    renderStudioLocations();
    showToast('Address saved');
    // Auto-set as default ship-from if first location with an address
    if (updates.address1) {
      var hasDefault = Object.keys(studioLocations).some(function(k) { return studioLocations[k].isDefaultShipFrom; });
      if (!hasDefault) setDefaultShipFrom(locId);
    }
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

async function setDefaultShipFrom(locId) {
  try {
    // Clear existing default
    var keys = Object.keys(studioLocations);
    var updates = {};
    keys.forEach(function(k) {
      if (studioLocations[k].isDefaultShipFrom) {
        updates[k + '/isDefaultShipFrom'] = null;
        studioLocations[k].isDefaultShipFrom = false;
      }
    });
    updates[locId + '/isDefaultShipFrom'] = true;
    await MastDB.update('config/studioLocations', updates);
    studioLocations[locId].isDefaultShipFrom = true;
    renderStudioLocations();
    showToast('Default ship-from set: ' + esc(studioLocations[locId].name || locId));
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

// Haversine distance in meters
function haversineDistance(lat1, lng1, lat2, lng2) {
  var R = 6371000; // Earth radius meters
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isNearAnyStudio(lat, lng, locations) {
  var keys = Object.keys(locations);
  for (var i = 0; i < keys.length; i++) {
    var loc = locations[keys[i]];
    var dist = haversineDistance(lat, lng, loc.lat, loc.lng);
    if (dist <= (loc.radius || STUDIO_RADIUS_METERS)) return { near: true, name: loc.name, distance: Math.round(dist) };
  }
  return { near: false };
}

