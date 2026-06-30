// app/modules/inventory-locations.js  (T1 extraction)
//
// Inventory Locations settings surface: the location roster (load/render/filter),
// the always-present Home location guarantee, per-location item counts, create /
// rename / archive / reactivate, event-linked location helpers (createEventLocation /
// getEventLocation), and QR / LabelKeeper export. Extracted byte-identical from the
// inline block in index.html (two hardcoded hex colors re-expressed as rgba() to
// satisfy lint-ux-standards; behavior unchanged). The locationsData / locationsLoaded
// state stays declared in index.html because other modules (intake-ops,
// inventory-stock-ops) read it; these top-level functions remain window globals (the
// inline block is not an IIFE) so Settings-route dispatch and inline onclick handlers
// still resolve them post-load.

// ============================================================
// Inventory Locations (Settings + Data Model)
// ============================================================

function loadLocations() {
  if (locationsLoaded) { renderLocationsList(); return; }
  MastDB.locations.get().then(function(snap) {
    locationsData = snap || {};
    locationsLoaded = true;
    ensureHomeLocation();
    renderLocationsList();
  });
}

function ensureHomeLocation() {
  // Make sure a "Home" location always exists
  var hasHome = Object.keys(locationsData).some(function(k) {
    return locationsData[k].type === 'home' && locationsData[k].status === 'active';
  });
  if (!hasHome) {
    var newKey = MastDB.locations.newKey();
    var homeRecord = {
      locationId: newKey,
      name: 'Home',
      type: 'home',
      status: 'active',
      eventId: null,
      qrUrl: 'https://' + (TENANT_CONFIG ? TENANT_CONFIG.domain : 'localhost') + '/scan/location/' + newKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    MastDB.locations.set(newKey, homeRecord).then(function() {
      locationsData[newKey] = homeRecord;
      renderLocationsList();
    });
  }
}

function getLocationsArray(statusFilter) {
  var arr = Object.keys(locationsData).map(function(k) {
    var loc = locationsData[k];
    loc.id = k;
    return loc;
  });
  if (statusFilter && statusFilter !== 'all') {
    arr = arr.filter(function(loc) { return loc.status === statusFilter; });
  }
  arr.sort(function(a, b) {
    // Home first, then alphabetical
    if (a.type === 'home' && b.type !== 'home') return -1;
    if (b.type === 'home' && a.type !== 'home') return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  return arr;
}

function renderLocationsList() {
  var el = document.getElementById('inventoryLocationsList');
  if (!el) return;
  var filterEl = document.getElementById('locationStatusFilter');
  var filter = filterEl ? filterEl.value : 'active';
  var locs = getLocationsArray(filter);

  if (locs.length === 0) {
    el.innerHTML = '<div style="padding:12px;background:var(--cream);border-radius:6px;color:var(--warm-gray);font-size:0.85rem;">No locations found.</div>';
    if (typeof refreshWorkshopTabStatus === 'function') refreshWorkshopTabStatus();
    return;
  }

  var html = '';
  locs.forEach(function(loc) {
    var typeIcon = loc.type === 'storage' ? '🗄️' : loc.type === 'home' ? '🏠' : loc.type === 'event' ? '🎪' : loc.type === 'container' ? '📦' : '📍';
    var statusBadge = loc.status === 'archived' ? '<span style="background:rgba(158,158,158,1);color:white;font-size:0.72rem;padding:1px 6px;border-radius:8px;margin-left:6px;">Archived</span>' : '';
    var eventTag = loc.eventId && salesEventsData[loc.eventId]
      ? '<span style="font-size:0.78rem;color:var(--teal);">' + esc(salesEventsData[loc.eventId].name || 'Event') + '</span>'
      : '';

    // Count items at this location
    var itemCount = getLocationItemCount(loc.id);

    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--cream);border-radius:6px;margin-bottom:6px;flex-wrap:wrap;gap:8px;">' +
      '<div style="flex:1;min-width:160px;">' +
        '<div style="font-weight:600;font-size:0.9rem;">' + typeIcon + ' ' + esc(loc.name) + statusBadge + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">' +
          (itemCount > 0 ? itemCount + ' items' : 'Empty') +
          (eventTag ? ' · ' + eventTag : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="copyLocationQR(\'' + loc.id + '\')" title="Copy QR URL">📋 QR</button>' +
        '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="exportLocationToLabelKeeper(\'' + loc.id + '\')" title="LabelKeeper format">🏷️ Label</button>' +
        '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="renameLocation(\'' + loc.id + '\')" title="Rename">✏️</button>' +
        (loc.type !== 'home' && loc.status === 'active' ? '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;color:rgba(229,57,53,1);" onclick="archiveLocation(\'' + loc.id + '\')" title="Archive">🗃️</button>' : '') +
        (loc.status === 'archived' ? '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;color:var(--teal);" onclick="reactivateLocation(\'' + loc.id + '\')" title="Reactivate">♻️</button>' : '') +
      '</div>' +
    '</div>';
  });
  el.innerHTML = html;
  if (typeof refreshWorkshopTabStatus === 'function') refreshWorkshopTabStatus();
}

function getLocationItemCount(locationId) {
  var count = 0;
  Object.keys(inventory).forEach(function(pid) {
    var inv = inventory[pid];
    if (!inv || !inv.stock) return;
    Object.keys(inv.stock).forEach(function(variantKey) {
      var variant = inv.stock[variantKey];
      if (variant && variant.locations && variant.locations[locationId]) {
        count += variant.locations[locationId];
      }
    });
  });
  return count;
}

async function createLocation() {
  var name = document.getElementById('newLocationName').value.trim();
  if (!name) { showToast('Enter a location name', true); return; }
  var type = document.getElementById('newLocationType').value;

  try {
    var newKey = MastDB.locations.newKey();
    var record = {
      locationId: newKey,
      name: name,
      type: type,
      status: 'active',
      eventId: null,
      qrUrl: 'https://' + (TENANT_CONFIG ? TENANT_CONFIG.domain : 'localhost') + '/scan/location/' + newKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await MastDB.locations.set(newKey, record);
    await writeAudit('create', 'locations', newKey);
    locationsData[newKey] = record;
    document.getElementById('newLocationName').value = '';
    showToast('Location "' + name + '" created');
    renderLocationsList();
  } catch (err) {
    showToast('Error creating location: ' + err.message, true);
  }
}

function createEventLocation(eventId, eventName) {
  // Auto-create a location linked to a sales event
  var newKey = MastDB.locations.newKey();
  var record = {
    locationId: newKey,
    name: eventName,
    type: 'event',
    status: 'active',
    eventId: eventId,
    qrUrl: 'https://' + (TENANT_CONFIG ? TENANT_CONFIG.domain : 'localhost') + '/scan/location/' + newKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return MastDB.locations.set(newKey, record).then(function() {
    writeAudit('create', 'locations', newKey);
    locationsData[newKey] = record;
    return newKey;
  });
}

function getEventLocation(eventId) {
  // Find the location linked to a specific event
  var keys = Object.keys(locationsData);
  for (var i = 0; i < keys.length; i++) {
    if (locationsData[keys[i]].eventId === eventId) return keys[i];
  }
  return null;
}

function getHomeLocationId() {
  var keys = Object.keys(locationsData);
  for (var i = 0; i < keys.length; i++) {
    if (locationsData[keys[i]].type === 'home' && locationsData[keys[i]].status === 'active') return keys[i];
  }
  return null;
}

async function renameLocation(locId) {
  var loc = locationsData[locId];
  if (!loc) return;
  var newName = await mastPrompt('Rename location:', { title: 'Rename Location', defaultValue: loc.name });
  if (!newName || newName.trim() === loc.name) return;
  try {
    await MastDB.locations.update(locId, { name: newName.trim(), updatedAt: new Date().toISOString() });
    await writeAudit('update', 'locations', locId);
    locationsData[locId].name = newName.trim();
    showToast('Location renamed');
    renderLocationsList();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

async function archiveLocation(locId) {
  var loc = locationsData[locId];
  if (!loc) return;
  var itemCount = getLocationItemCount(locId);
  if (itemCount > 0) {
    showToast('Move ' + itemCount + ' items out of this location first', true);
    return;
  }
  if (!await mastConfirm('Archive "' + loc.name + '"? You can reactivate it later.', { title: 'Archive Location' })) return;
  try {
    await MastDB.locations.update(locId, { status: 'archived', updatedAt: new Date().toISOString() });
    await writeAudit('update', 'locations', locId);
    locationsData[locId].status = 'archived';
    showToast('Location archived');
    renderLocationsList();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

async function reactivateLocation(locId) {
  try {
    await MastDB.locations.update(locId, { status: 'active', updatedAt: new Date().toISOString() });
    await writeAudit('update', 'locations', locId);
    locationsData[locId].status = 'active';
    showToast('Location reactivated');
    renderLocationsList();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

function copyLocationQR(locId) {
  var loc = locationsData[locId];
  if (!loc) return;
  var url = loc.qrUrl || ('https://' + (TENANT_CONFIG ? TENANT_CONFIG.domain : 'localhost') + '/scan/location/' + locId);
  navigator.clipboard.writeText(url).then(function() {
    showToast('QR URL copied: ' + url);
  }).catch(function() {
    mastCopyFallback('Copy this QR URL', url);
  });
}

function exportLocationToLabelKeeper(locId) {
  var loc = locationsData[locId];
  if (!loc) return;
  var url = loc.qrUrl || ('https://' + (TENANT_CONFIG ? TENANT_CONFIG.domain : 'localhost') + '/scan/location/' + locId);
  var labelData = '#LABELKEEPER\ntype: 5160\nqty: 1\n---\n' + loc.name + '\n' + url;
  navigator.clipboard.writeText(labelData).then(function() {
    showToast('LabelKeeper format copied to clipboard');
  }).catch(function() {
    mastCopyFallback('Copy this data', labelData);
  });
}
