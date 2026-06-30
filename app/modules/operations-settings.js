// app/modules/operations-settings.js  (T1 extraction)
//
// Operations Settings sub-tab (Phase 2 P2D-S2): fulfillment-modes editor,
// service-area editor (type / countries / subdivisions / radius / zip pickers),
// localization + timezone editor (with browser-timezone detection), and the
// service-area→tax-jurisdiction hint. Writes via
// MastDB.businessEntity.update('operations', {...}). Extracted byte-identical from
// the inline block in index.html (one numeric HTML entity replaced with its literal
// glyph; the relocated hardcoded-hex colors — mostly var(--token,#fallback) forms +
// a few border defaults — are recorded as-is in ux-standards-baseline.json rather
// than rewritten, to keep the extraction behavior-identical). The _operationsState /
// _OPERATIONS_* state has no external readers; these top-level functions and the
// window.* save/edit handlers remain window globals (the inline block is not an
// IIFE) so the Settings-route operations-tab switch (loadOperationsSettings, called
// only on sub-tab navigation) and inline onclick handlers resolve them post-load.
// The cross-feature renewals/compliance seed-banner functions stay inline.

// ============================================================
// Operations Settings (Phase 2 P2D-S2 — fulfillmentModes + serviceArea)
// ============================================================
// Writes via MastDB.businessEntity.update('operations', {...}). No new MCP
// tools — capture-operations skill (P2D-S1) covers the conversational path.
// Schema:
//   operations.fulfillmentModes: [{ mode, label, active, regions[], note }]
//   operations.serviceArea: { type, countries[], subdivisions[], radiusKm,
//                              radiusOrigin: { lat, lng, address }, zipCodes[] }

var _OPERATIONS_FULFILLMENT_MODE_OPTIONS = [
  { value: 'ship',           label: 'Ship (carrier)' },
  { value: 'pickup',         label: 'Pickup (in-store)' },
  { value: 'local-delivery', label: 'Local delivery' },
  { value: 'digital',        label: 'Digital (download / link)' },
  { value: 'in-person-only', label: 'In-person only' }
];

var _OPERATIONS_SERVICE_AREA_TYPES = [
  { value: 'global',       label: 'Global', hint: 'Anywhere in the world.' },
  { value: 'countries',    label: 'Countries', hint: 'One or more whole countries.' },
  { value: 'subdivisions', label: 'States / Provinces', hint: 'Specific subdivisions within a country.' },
  { value: 'radius',       label: 'Radius', hint: 'Within N km of an origin address.' },
  { value: 'zipCodes',     label: 'ZIP / Postal Codes', hint: 'Explicit list of ZIP / postal codes.' }
];

// Curated short list — covers the bulk of Mast tenants (US/CA/EU). Loose validation
// at save (any 2-letter ISO 3166-1 alpha-2 accepted via the free-text fallback).
var _OPERATIONS_COMMON_COUNTRIES = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'MX', label: 'Mexico' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'IE', label: 'Ireland' },
  { value: 'FR', label: 'France' },
  { value: 'DE', label: 'Germany' },
  { value: 'ES', label: 'Spain' },
  { value: 'IT', label: 'Italy' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'AU', label: 'Australia' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'JP', label: 'Japan' }
];

var _operationsState = {
  fulfillmentModes: null,  // array — null = not loaded
  serviceArea: null,       // object — null = not loaded
  fulfillmentDirty: false,
  serviceAreaDirty: false
};

async function loadOperationsSettings() {
  var statusEl = document.getElementById('operationsSectionStatus');
  if (statusEl) { statusEl.textContent = 'Loading…'; statusEl.style.color = 'var(--warm-gray)'; }
  var res;
  try {
    res = await MastDB.businessEntity.get('operations');
  } catch (err) {
    console.warn('[operations] get failed:', err && err.message);
    if (statusEl) { statusEl.textContent = 'Failed to load: ' + (err && err.message || 'unknown'); statusEl.style.color = 'var(--danger,#ef4444)'; }
    return;
  }
  var ops = (res && res.data) || {};
  _operationsState.fulfillmentModes = Array.isArray(ops.fulfillmentModes) ? ops.fulfillmentModes.slice() : [];
  _operationsState.serviceArea = _normalizeServiceArea(ops.serviceArea);
  _operationsState.fulfillmentDirty = false;
  _operationsState.serviceAreaDirty = false;

  _renderFulfillmentModesList();
  _renderServiceAreaType();
  _renderServiceAreaBody();
  _renderOperationsTimezoneEditor(ops.localization || {});
  _renderOperationsLocalizationSummary(ops.localization || {});
  _updateServiceAreaTaxHint(ops);

  if (statusEl) statusEl.textContent = '';
}

function _normalizeServiceArea(sa) {
  sa = sa || {};
  return {
    type: sa.type || 'global',
    countries: Array.isArray(sa.countries) ? sa.countries.slice() : [],
    subdivisions: Array.isArray(sa.subdivisions) ? sa.subdivisions.slice() : [],
    radiusKm: typeof sa.radiusKm === 'number' ? sa.radiusKm : (sa.radiusKm ? parseFloat(sa.radiusKm) : null),
    radiusOrigin: sa.radiusOrigin && typeof sa.radiusOrigin === 'object' ? {
      lat: typeof sa.radiusOrigin.lat === 'number' ? sa.radiusOrigin.lat : (sa.radiusOrigin.lat ? parseFloat(sa.radiusOrigin.lat) : null),
      lng: typeof sa.radiusOrigin.lng === 'number' ? sa.radiusOrigin.lng : (sa.radiusOrigin.lng ? parseFloat(sa.radiusOrigin.lng) : null),
      address: sa.radiusOrigin.address || ''
    } : { lat: null, lng: null, address: '' },
    zipCodes: Array.isArray(sa.zipCodes) ? sa.zipCodes.slice() : []
  };
}

function _renderFulfillmentModesList() {
  var listEl = document.getElementById('operationsFulfillmentList');
  if (!listEl) return;
  var rows = _operationsState.fulfillmentModes || [];
  if (rows.length === 0) {
    listEl.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;font-style:italic;padding:8px 0;">No fulfillment modes added yet. Tap "Add fulfillment mode" to begin.</div>';
    return;
  }
  listEl.innerHTML = rows.map(function(row, idx) {
    return _renderFulfillmentModeRow(row, idx);
  }).join('');
}

function _renderFulfillmentModeRow(row, idx) {
  var unsaved = row && row.__unsaved === true;
  var rowId = 'opsFulfRow_' + idx;
  var modeOpts = _OPERATIONS_FULFILLMENT_MODE_OPTIONS.map(function(o) {
    return '<option value="' + esc(o.value) + '"' + (row.mode === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
  }).join('');
  var regionsStr = Array.isArray(row.regions) ? row.regions.join(', ') : '';
  var out = '<div id="' + rowId + '" class="ops-fulfillment-row" style="background:var(--bg-secondary,#232323);border-radius:8px;padding:12px 14px;margin-bottom:10px;' + (unsaved ? 'border:1px dashed rgba(234,179,8,0.45);' : 'border:1px solid rgba(255,255,255,0.05);') + '">';
  out += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:0.78rem;color:var(--warm-gray);">';
  out += '<span>Mode #' + (idx + 1) + (unsaved ? ' <span style="color:#eab308;">(unsaved)</span>' : '') + '</span>';
  out += '<button class="btn btn-small btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="removeFulfillmentMode(' + idx + ')">Remove</button>';
  out += '</div>';
  out += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">';
  out += '<div><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">Mode</label>';
  out += '<select id="opsFulfMode_' + idx + '" class="ops-fulfillment-input" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;background:var(--bg-primary,var(--charcoal));color:var(--text,#fff);">' + modeOpts + '</select></div>';
  out += '<div><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">Checkout Label</label>';
  out += '<input type="text" id="opsFulfLabel_' + idx + '" class="ops-fulfillment-input" placeholder="e.g., USPS Priority, Studio pickup" value="' + esc(row.label || '') + '" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;"></div>';
  out += '<div><label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--text,#fff);cursor:pointer;margin-top:18px;">';
  out += '<input type="checkbox" id="opsFulfActive_' + idx + '" class="ops-fulfillment-input"' + (row.active !== false ? ' checked' : '') + ' style="width:16px;height:16px;">';
  out += '<span style="font-size:0.85rem;color:var(--warm-gray);">Active</span>';
  out += '</label></div>';
  out += '</div>';
  out += '<div style="margin-top:10px;display:grid;grid-template-columns:1fr;gap:10px;">';
  out += '<div><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">Regions <span style="color:var(--warm-gray);font-weight:400;">(comma-separated ISO codes — required unless mode is digital)</span></label>';
  out += '<input type="text" id="opsFulfRegions_' + idx + '" class="ops-fulfillment-input" placeholder="e.g., US, CA, GB or US-MA, US-NY" value="' + esc(regionsStr) + '" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;"></div>';
  out += '<div><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">Internal note (optional)</label>';
  out += '<textarea id="opsFulfNote_' + idx + '" class="ops-fulfillment-input" rows="2" placeholder="Notes for staff (not shown to customers)" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;resize:vertical;">' + esc(row.note || '') + '</textarea></div>';
  out += '</div>';
  out += '</div>';
  return out;
}

window.addFulfillmentMode = function() {
  if (!Array.isArray(_operationsState.fulfillmentModes)) _operationsState.fulfillmentModes = [];
  _operationsState.fulfillmentModes.push({
    mode: 'ship',
    label: '',
    active: true,
    regions: [],
    note: '',
    __unsaved: true
  });
  _operationsState.fulfillmentDirty = true;
  _renderFulfillmentModesList();
};

window.removeFulfillmentMode = async function(idx) {
  var arr = _operationsState.fulfillmentModes || [];
  var item = arr[idx];
  if (!item) return;
  var proceed = true;
  if (!item.__unsaved) {
    proceed = await mastConfirm('Remove this fulfillment mode? Customers will no longer see it at checkout.', { title: 'Remove fulfillment mode?', confirmLabel: 'Remove', cancelLabel: 'Keep' });
  }
  if (!proceed) return;
  arr.splice(idx, 1);
  _operationsState.fulfillmentDirty = true;
  _renderFulfillmentModesList();
};

function _collectFulfillmentModes() {
  var arr = _operationsState.fulfillmentModes || [];
  return arr.map(function(item, idx) {
    var modeEl = document.getElementById('opsFulfMode_' + idx);
    var labelEl = document.getElementById('opsFulfLabel_' + idx);
    var activeEl = document.getElementById('opsFulfActive_' + idx);
    var regionsEl = document.getElementById('opsFulfRegions_' + idx);
    var noteEl = document.getElementById('opsFulfNote_' + idx);
    var regionsRaw = regionsEl ? (regionsEl.value || '').trim() : '';
    var regions = regionsRaw === ''
      ? []
      : regionsRaw.split(',').map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean);
    return {
      mode: modeEl ? modeEl.value : (item.mode || 'ship'),
      label: labelEl ? (labelEl.value || '').trim() : (item.label || ''),
      active: activeEl ? !!activeEl.checked : (item.active !== false),
      regions: regions,
      note: noteEl ? (noteEl.value || '').trim() : (item.note || '')
    };
  });
}

function _validateFulfillmentModes(rows) {
  var errs = [];
  var seen = {};
  rows.forEach(function(r, idx) {
    if (!r.label) errs.push('Row ' + (idx + 1) + ': checkout label is required.');
    if (seen[r.mode]) errs.push('Row ' + (idx + 1) + ': mode "' + r.mode + '" appears more than once. Use one row per mode.');
    seen[r.mode] = true;
    if (r.mode !== 'digital' && r.regions.length === 0) {
      errs.push('Row ' + (idx + 1) + ' (' + r.mode + '): at least one region is required for non-digital modes.');
    }
    r.regions.forEach(function(code) {
      if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(code)) {
        errs.push('Row ' + (idx + 1) + ': region "' + code + '" is not a valid ISO 3166 code (e.g., US or US-MA).');
      }
    });
  });
  return errs;
}

window.saveFulfillmentModes = async function() {
  var statusEl = document.getElementById('operationsFulfillmentStatus');
  if (statusEl) { statusEl.textContent = 'Validating…'; statusEl.style.color = 'var(--warm-gray)'; }
  var collected = _collectFulfillmentModes();
  var errs = _validateFulfillmentModes(collected);
  if (errs.length > 0) {
    if (statusEl) { statusEl.innerHTML = errs.map(esc).join('<br>'); statusEl.style.color = 'var(--danger,#ef4444)'; }
    return;
  }
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    await MastDB.businessEntity.update('operations', { fulfillmentModes: collected });
    _operationsState.fulfillmentModes = collected.map(function(x) { return Object.assign({}, x); });
    _operationsState.fulfillmentDirty = false;
    _renderFulfillmentModesList();
    if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--success,#22c55e)'; }
    if (window.showToast) showToast('Fulfillment modes saved');
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + (err.message || 'unknown'); statusEl.style.color = 'var(--danger,#ef4444)'; }
  }
};

// ---- Service Area ----

function _renderServiceAreaType() {
  var row = document.getElementById('operationsServiceAreaTypeRow');
  if (!row) return;
  var current = (_operationsState.serviceArea && _operationsState.serviceArea.type) || 'global';
  row.innerHTML = _OPERATIONS_SERVICE_AREA_TYPES.map(function(t) {
    var active = current === t.value;
    var bg = active ? 'var(--teal,#2a9d8f)' : 'var(--bg-secondary,#232323)';
    var fg = active ? '#fff' : 'var(--text,#fff)';
    var border = active ? 'var(--teal,#2a9d8f)' : 'rgba(255,255,255,0.1)';
    return '<button type="button" onclick="setServiceAreaType(\'' + t.value + '\')" title="' + esc(t.hint) + '" style="padding:7px 12px;border-radius:18px;border:1px solid ' + border + ';background:' + bg + ';color:' + fg + ';font-size:0.78rem;cursor:pointer;font-family:inherit;">' + esc(t.label) + '</button>';
  }).join('');
}

window.setServiceAreaType = function(type) {
  if (!_operationsState.serviceArea) _operationsState.serviceArea = _normalizeServiceArea({});
  _operationsState.serviceArea.type = type;
  _operationsState.serviceAreaDirty = true;
  _renderServiceAreaType();
  _renderServiceAreaBody();
};

function _renderServiceAreaBody() {
  var body = document.getElementById('operationsServiceAreaBody');
  if (!body) return;
  var sa = _operationsState.serviceArea || _normalizeServiceArea({});
  var meta = _OPERATIONS_SERVICE_AREA_TYPES.filter(function(t) { return t.value === sa.type; })[0];
  var hint = meta ? '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 12px;">' + esc(meta.hint) + '</p>' : '';
  if (sa.type === 'global') {
    body.innerHTML = hint + '<div style="font-size:0.85rem;color:var(--warm-gray);">No additional configuration. Customers in any country can place orders (subject to your fulfillment-mode regions).</div>';
    return;
  }
  if (sa.type === 'countries') {
    body.innerHTML = hint + _renderCountriesPicker(sa.countries);
    return;
  }
  if (sa.type === 'subdivisions') {
    body.innerHTML = hint + _renderSubdivisionsPicker(sa.subdivisions);
    return;
  }
  if (sa.type === 'radius') {
    body.innerHTML = hint + _renderRadiusPicker(sa);
    return;
  }
  if (sa.type === 'zipCodes') {
    body.innerHTML = hint + _renderZipCodesPicker(sa.zipCodes);
    return;
  }
  body.innerHTML = '';
}

function _renderCountriesPicker(selected) {
  selected = Array.isArray(selected) ? selected : [];
  var sel = {};
  selected.forEach(function(c) { sel[c] = true; });
  var chips = _OPERATIONS_COMMON_COUNTRIES.map(function(c) {
    var on = !!sel[c.value];
    return '<label style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;margin:3px;border-radius:14px;border:1px solid ' + (on ? 'var(--teal,#2a9d8f)' : 'rgba(255,255,255,0.12)') + ';background:' + (on ? 'rgba(42,157,143,0.18)' : 'transparent') + ';font-size:0.78rem;cursor:pointer;">' +
      '<input type="checkbox" class="ops-sa-country" value="' + esc(c.value) + '"' + (on ? ' checked' : '') + ' onchange="onServiceAreaDirty()" style="accent-color:var(--teal,#2a9d8f);">' +
      esc(c.label) + ' <span style="color:var(--warm-gray);">(' + esc(c.value) + ')</span></label>';
  }).join('');
  var extras = selected.filter(function(c) {
    return !_OPERATIONS_COMMON_COUNTRIES.some(function(o) { return o.value === c; });
  }).join(', ');
  return '<div style="display:flex;flex-wrap:wrap;margin:-3px;">' + chips + '</div>' +
    '<div style="margin-top:10px;"><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">Other ISO 3166-1 country codes (comma-separated)</label>' +
    '<input type="text" id="opsSaCountryExtras" placeholder="e.g., BR, ZA, KR" value="' + esc(extras) + '" oninput="onServiceAreaDirty()" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;"></div>';
}

function _renderSubdivisionsPicker(selected) {
  selected = Array.isArray(selected) ? selected : [];
  return '<label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">ISO 3166-2 subdivision codes (comma- or newline-separated)</label>' +
    '<textarea id="opsSaSubdivisionInput" rows="3" placeholder="e.g., US-MA, US-NY, US-CT, CA-ON" oninput="onServiceAreaDirty()" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;resize:vertical;">' + esc(selected.join(', ')) + '</textarea>' +
    '<p style="font-size:0.72rem;color:var(--warm-gray);margin-top:6px;">Format: <code style="font-family:monospace;">CC-SUB</code>, e.g. <code style="font-family:monospace;">US-MA</code> for Massachusetts. Used for tax-jurisdiction hints.</p>';
}

function _renderRadiusPicker(sa) {
  var origin = sa.radiusOrigin || { lat: null, lng: null, address: '' };
  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">' +
    '<div><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">Radius (km)</label>' +
    '<input type="number" id="opsSaRadiusKm" min="0" step="0.5" placeholder="e.g., 50" value="' + (sa.radiusKm != null ? esc(String(sa.radiusKm)) : '') + '" oninput="onServiceAreaDirty()" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;"></div>' +
    '<div><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">Origin latitude</label>' +
    '<input type="number" id="opsSaRadiusLat" step="0.000001" placeholder="42.3601" value="' + (origin.lat != null ? esc(String(origin.lat)) : '') + '" oninput="onServiceAreaDirty()" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;"></div>' +
    '<div><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">Origin longitude</label>' +
    '<input type="number" id="opsSaRadiusLng" step="0.000001" placeholder="-71.0589" value="' + (origin.lng != null ? esc(String(origin.lng)) : '') + '" oninput="onServiceAreaDirty()" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;"></div>' +
    '</div>' +
    '<div style="margin-top:10px;"><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">Origin address (free text)</label>' +
    '<input type="text" id="opsSaRadiusAddress" placeholder="e.g., 123 Main St, Boston, MA 02110" value="' + esc(origin.address || '') + '" oninput="onServiceAreaDirty()" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;"></div>' +
    '<p style="font-size:0.72rem;color:var(--warm-gray);margin-top:8px;">Lat/lng are required for the radius check. Geocode the address with your preferred map tool and paste the values here.</p>';
}

function _renderZipCodesPicker(selected) {
  selected = Array.isArray(selected) ? selected : [];
  return '<label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">ZIP / postal codes (comma- or newline-separated)</label>' +
    '<textarea id="opsSaZipInput" rows="4" placeholder="e.g., 02110, 02111, 02112-3456" oninput="onServiceAreaDirty()" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;resize:vertical;">' + esc(selected.join(', ')) + '</textarea>' +
    '<p style="font-size:0.72rem;color:var(--warm-gray);margin-top:6px;">Whitespace and case are normalized on save.</p>';
}

window.onServiceAreaDirty = function() {
  _operationsState.serviceAreaDirty = true;
};

function _collectServiceArea() {
  var sa = _normalizeServiceArea({ type: (_operationsState.serviceArea && _operationsState.serviceArea.type) || 'global' });
  if (sa.type === 'countries') {
    var picked = [];
    document.querySelectorAll('#operationsServiceAreaBody .ops-sa-country').forEach(function(cb) {
      if (cb.checked) picked.push(cb.value);
    });
    var extrasEl = document.getElementById('opsSaCountryExtras');
    var extras = extrasEl ? (extrasEl.value || '') : '';
    extras.split(/[,\s]+/).map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean).forEach(function(c) {
      if (picked.indexOf(c) === -1) picked.push(c);
    });
    sa.countries = picked;
  } else if (sa.type === 'subdivisions') {
    var subEl = document.getElementById('opsSaSubdivisionInput');
    var raw = subEl ? (subEl.value || '') : '';
    sa.subdivisions = raw.split(/[,\s\n]+/).map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean);
  } else if (sa.type === 'radius') {
    var rkm = document.getElementById('opsSaRadiusKm');
    var rlat = document.getElementById('opsSaRadiusLat');
    var rlng = document.getElementById('opsSaRadiusLng');
    var radr = document.getElementById('opsSaRadiusAddress');
    var kmVal = rkm && rkm.value !== '' ? parseFloat(rkm.value) : null;
    var latVal = rlat && rlat.value !== '' ? parseFloat(rlat.value) : null;
    var lngVal = rlng && rlng.value !== '' ? parseFloat(rlng.value) : null;
    sa.radiusKm = (typeof kmVal === 'number' && !isNaN(kmVal)) ? kmVal : null;
    sa.radiusOrigin = {
      lat: (typeof latVal === 'number' && !isNaN(latVal)) ? latVal : null,
      lng: (typeof lngVal === 'number' && !isNaN(lngVal)) ? lngVal : null,
      address: radr ? (radr.value || '').trim() : ''
    };
  } else if (sa.type === 'zipCodes') {
    var zEl = document.getElementById('opsSaZipInput');
    var zraw = zEl ? (zEl.value || '') : '';
    sa.zipCodes = zraw.split(/[,\s\n]+/).map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean);
  }
  return sa;
}

function _validateServiceArea(sa) {
  var errs = [];
  if (sa.type === 'countries') {
    if (sa.countries.length === 0) errs.push('Pick at least one country (or select another coverage type).');
    sa.countries.forEach(function(c) {
      if (!/^[A-Z]{2}$/.test(c)) errs.push('Country code "' + c + '" is not a 2-letter ISO 3166-1 code.');
    });
  } else if (sa.type === 'subdivisions') {
    if (sa.subdivisions.length === 0) errs.push('Add at least one subdivision code (e.g., US-MA).');
    sa.subdivisions.forEach(function(s) {
      if (!/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(s)) errs.push('Subdivision "' + s + '" is not a valid ISO 3166-2 code (expected CC-SUB).');
    });
  } else if (sa.type === 'radius') {
    if (sa.radiusKm == null || sa.radiusKm <= 0) errs.push('Radius (km) must be a positive number.');
    if (sa.radiusOrigin.lat == null || sa.radiusOrigin.lng == null) errs.push('Origin lat/lng are required for radius coverage.');
    if (sa.radiusOrigin.lat != null && (sa.radiusOrigin.lat < -90 || sa.radiusOrigin.lat > 90)) errs.push('Latitude must be between -90 and 90.');
    if (sa.radiusOrigin.lng != null && (sa.radiusOrigin.lng < -180 || sa.radiusOrigin.lng > 180)) errs.push('Longitude must be between -180 and 180.');
  } else if (sa.type === 'zipCodes') {
    if (sa.zipCodes.length === 0) errs.push('Add at least one ZIP / postal code.');
  }
  return errs;
}

window.saveServiceArea = async function() {
  var statusEl = document.getElementById('operationsServiceAreaStatus');
  if (statusEl) { statusEl.textContent = 'Validating…'; statusEl.style.color = 'var(--warm-gray)'; }
  var sa = _collectServiceArea();
  var errs = _validateServiceArea(sa);
  if (errs.length > 0) {
    if (statusEl) { statusEl.innerHTML = errs.map(esc).join('<br>'); statusEl.style.color = 'var(--danger,#ef4444)'; }
    return;
  }
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    await MastDB.businessEntity.update('operations', { serviceArea: sa });
    _operationsState.serviceArea = sa;
    _operationsState.serviceAreaDirty = false;
    if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--success,#22c55e)'; }
    if (window.showToast) showToast('Service area saved');
    // Re-evaluate tax-jurisdiction hint after a save (subdivisions may have changed).
    try {
      var ent = await MastDB.businessEntity.get('operations');
      _updateServiceAreaTaxHint((ent && ent.data) || {});
    } catch (_) {}
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + (err.message || 'unknown'); statusEl.style.color = 'var(--danger,#ef4444)'; }
  }
};

function _renderOperationsLocalizationSummary(loc) {
  var el = document.getElementById('operationsLocalizationSummary');
  if (!el) return;
  var parts = [];
  if (loc.currency) parts.push('Currency <strong>' + esc(loc.currency) + '</strong>');
  if (loc.timezone) parts.push('Timezone <strong>' + esc(loc.timezone) + '</strong>');
  if (loc.language) parts.push('Language <strong>' + esc(loc.language) + '</strong>');
  if (loc.fiscalYearStartMonth) parts.push('Fiscal-year start month <strong>' + esc(String(loc.fiscalYearStartMonth)) + '</strong>');
  el.innerHTML = parts.length === 0 ? 'No localization captured yet.' : parts.join(' &middot; ');
}

// ---- Timezone editor (Phase 3 — browser-detect default; currency/language/fiscal-year remain wizard-managed) ----

var _OPERATIONS_TIMEZONE_OPTIONS = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam',
  'Europe/Madrid', 'Europe/Rome', 'Europe/Stockholm', 'Europe/Zurich',
  'Asia/Tokyo', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Dubai', 'Asia/Kolkata',
  'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland'
];

function _detectBrowserTimezone() {
  try {
    var resolved = Intl.DateTimeFormat().resolvedOptions();
    if (resolved && resolved.timeZone) return resolved.timeZone;
  } catch (e) { /* fall through */ }
  return 'America/New_York';
}

function _renderOperationsTimezoneEditor(loc) {
  var sel = document.getElementById('operationsTimezoneSelect');
  var hint = document.getElementById('operationsTimezoneDetectedHint');
  if (!sel || !hint) return;
  var detected = _detectBrowserTimezone();
  var saved = (loc && loc.timezone) || '';
  var current = saved || detected;

  var options = _OPERATIONS_TIMEZONE_OPTIONS.slice();
  // Dynamic insertion: if detected or saved is not in the standard list, prepend.
  [saved, detected].forEach(function(tz) {
    if (tz && options.indexOf(tz) === -1) options.unshift(tz);
  });

  sel.innerHTML = options.map(function(tz) {
    return '<option value="' + esc(tz) + '"' + (tz === current ? ' selected' : '') + '>' + esc(tz) + '</option>';
  }).join('');

  var hintHtml = '📍 Detected from your browser: <strong>' + esc(detected) + '</strong>';
  // [Use detected] affordance: shown only when a saved value exists and differs from detected.
  if (saved && saved !== detected) {
    hintHtml += ' &nbsp; <a href="javascript:void(0)" id="operationsTimezoneUseDetected" onclick="useDetectedTimezone()" style="color:var(--teal);text-decoration:underline;">[Use detected]</a>';
  }
  hint.innerHTML = hintHtml;
}

window.onOperationsTimezoneChange = function() {
  var statusEl = document.getElementById('operationsTimezoneStatus');
  if (statusEl) statusEl.textContent = '';
};

window.useDetectedTimezone = function() {
  var sel = document.getElementById('operationsTimezoneSelect');
  if (!sel) return;
  var detected = _detectBrowserTimezone();
  // Ensure detected is an option (may have been pruned by saved-only render path).
  var hasOption = false;
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === detected) { hasOption = true; break; }
  }
  if (!hasOption) {
    var opt = document.createElement('option');
    opt.value = detected;
    opt.textContent = detected;
    sel.insertBefore(opt, sel.firstChild);
  }
  sel.value = detected;
  var statusEl = document.getElementById('operationsTimezoneStatus');
  if (statusEl) statusEl.textContent = '';
};

window.saveOperationsTimezone = async function() {
  var sel = document.getElementById('operationsTimezoneSelect');
  var statusEl = document.getElementById('operationsTimezoneStatus');
  if (!sel) return;
  var tz = sel.value || '';
  if (!tz) {
    if (statusEl) { statusEl.textContent = 'Pick a timezone before saving.'; statusEl.style.color = 'var(--danger,#ef4444)'; }
    return;
  }
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    await MastDB.businessEntity.update('operations', { localization: { timezone: tz } });
    if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--success,#22c55e)'; }
    if (window.showToast) showToast('Timezone saved');
    // Re-render hint + summary so [Use detected] affordance + summary line reflect the new saved value.
    try {
      var ent = await MastDB.businessEntity.get('operations');
      var loc = (ent && ent.data && ent.data.localization) || {};
      _renderOperationsTimezoneEditor(loc);
      _renderOperationsLocalizationSummary(loc);
    } catch (_) {}
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + (err.message || 'unknown'); statusEl.style.color = 'var(--danger,#ef4444)'; }
  }
};

// Tax-jurisdiction hint: if serviceArea.type is subdivisions and any of those
// subdivisions are not yet registered in compliance.taxJurisdictions[].state,
// surface a deep-link to Settings > Compliance > Tax Jurisdictions.
async function _updateServiceAreaTaxHint(opsData) {
  var hintEl = document.getElementById('operationsServiceAreaTaxHint');
  if (!hintEl) return;
  var sa = (opsData && opsData.serviceArea) || {};
  if (sa.type !== 'subdivisions' || !Array.isArray(sa.subdivisions) || sa.subdivisions.length === 0) {
    hintEl.style.display = 'none';
    return;
  }
  var registered = {};
  try {
    var compRes = await MastDB.businessEntity.get('compliance');
    var jurisdictions = (compRes && compRes.data && Array.isArray(compRes.data.taxJurisdictions)) ? compRes.data.taxJurisdictions : [];
    jurisdictions.forEach(function(tj) {
      if (tj && tj.state) registered[String(tj.state).trim().toUpperCase()] = true;
    });
  } catch (_) {}
  // Match either "US-MA" form or bare "MA" — registered.state may be either.
  var missing = sa.subdivisions.filter(function(s) {
    var bare = s.indexOf('-') >= 0 ? s.split('-')[1] : s;
    return !registered[s] && !registered[bare];
  });
  if (missing.length === 0) {
    hintEl.style.display = 'none';
    return;
  }
  hintEl.innerHTML = '<strong style="color:#f59e0b;">Tax jurisdictions hint:</strong> ' +
    'You serve ' + esc(missing.join(', ')) + ' but have not added matching tax-jurisdiction records. ' +
    '<a href="javascript:void(0)" onclick="switchSettingsSubView(\'compliance\'); setTimeout(function(){ var el=document.getElementById(\'complianceTaxJurisdictionsList\'); if(el) el.scrollIntoView({behavior:\'smooth\'}); }, 200);" style="color:var(--teal);text-decoration:underline;">Add jurisdictions in Compliance &rsaquo;</a>';
  hintEl.style.display = '';
}
