/**
 * nav-profiles.js — sidebar "Profiles" feature (save / apply / delete a named
 * sidebar layout) for the Add-to-Mast surface.
 *
 * Loaded EAGERLY via a plain <script defer src> in app/index.html (NOT a lazy
 * MODULE_MANIFEST entry). Extracted byte-for-byte from the index.html inline
 * <script> as part of the T1 decomposition (shrinking the eager inline block).
 * That block is top-level (non-IIFE) scope, so every symbol here stays a window
 * global exactly as before, and the bare cross-references it uses at runtime
 * (getModeSet, getModeOverrides, _getVisibleToggleableRoutes, _getToggleableRoutes,
 * applyModeNavFilter, _modeOverridesSnapshot, MODE_MODULE_INFO,
 * BusinessEntityConstants, MastDB, esc, showToast, mastConfirm, renderAddToMast)
 * are window globals defined by the shell / shared cores. They are only read
 * POST-LOAD (the profiles bar renders inside renderAddToMast; the click handlers
 * fire on user action), so the deferred load order is safe.
 *
 * window exports: loadNavProfiles, saveCurrentNavProfile, applyNavProfile,
 *   deleteNavProfile, _renderNavProfilesBar, saveCurrentNavProfileClick,
 *   navProfileSaveCancelClick, navProfileSaveConfirmClick, applyNavProfileClick,
 *   deleteNavProfileClick.
 */

// ============================================================
// Nav profiles (2026-06-05) — save the current sidebar layout under a name and
// restore it later. Profiles are LOCAL recipes (localStorage, this browser);
// APPLYING one writes the tenant's actual modeOverrides doc — the same layer
// Add-to-Mast edits — so the restored layout sticks across reloads and devices.
// A profile captures the absolute set of currently-visible, user-curatable
// routes, so it reproduces the same sidebar even if the tenant's modeSet later
// changes. It does NOT capture the engagement surface (a separate tenant-level
// setting), only the mode-override layer.
// ============================================================
var _NAV_PROFILES_VERSION = 1;

function _navProfilesKey() {
  var tid = '';
  try { tid = (window.MastDB && MastDB.tenantId && MastDB.tenantId()) || ''; } catch (e) { tid = ''; }
  return 'mast.navProfiles.' + (tid || 'default');
}

// Returns the saved profiles array (possibly empty). Never throws.
function loadNavProfiles() {
  try {
    var raw = localStorage.getItem(_navProfilesKey());
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.profiles)) return parsed.profiles;
    return [];
  } catch (e) {
    console.warn('[navProfiles] load failed:', e && e.message);
    return [];
  }
}

function _saveNavProfiles(profiles) {
  try {
    localStorage.setItem(_navProfilesKey(), JSON.stringify({ version: _NAV_PROFILES_VERSION, profiles: profiles }));
    return true;
  } catch (e) {
    console.warn('[navProfiles] save failed:', e && e.message);
    return false;
  }
}

// Snapshot the current sidebar (visible, user-curatable routes) under `name`.
function saveCurrentNavProfile(name) {
  name = (name || '').trim();
  if (!name) return { success: false, error: 'A profile needs a name.' };
  var modeSet = (typeof getModeSet === 'function') ? getModeSet() : null;
  var overrides = (typeof getModeOverrides === 'function') ? getModeOverrides() : { enabledRoutes: [], disabledRoutes: [] };
  var visibleRoutes = (typeof _getVisibleToggleableRoutes === 'function')
    ? _getVisibleToggleableRoutes(modeSet, overrides) : [];
  var profiles = loadNavProfiles();
  // Overwrite a same-named profile rather than duplicating.
  var idx = -1;
  for (var i = 0; i < profiles.length; i++) {
    if (profiles[i] && typeof profiles[i].name === 'string' &&
        profiles[i].name.toLowerCase() === name.toLowerCase()) { idx = i; break; }
  }
  var entry = {
    id: 'np_' + Date.now().toString(36) + '_' + Math.floor(profiles.length),
    name: name,
    createdAt: new Date().toISOString(),
    visibleRoutes: visibleRoutes
  };
  var replaced = false;
  if (idx !== -1) { entry.id = profiles[idx].id || entry.id; profiles[idx] = entry; replaced = true; }
  else { profiles.push(entry); }
  if (!_saveNavProfiles(profiles)) return { success: false, error: 'Could not save to this browser.' };
  return { success: true, profile: entry, replaced: replaced, count: visibleRoutes.length };
}

// Reconcile the tenant's modeOverrides so exactly the profile's routes are
// visible. One businessEntity write, then re-filter the live sidebar. Mirrors
// addRoutesToMast / removeRoutesFromMast.
async function applyNavProfile(id) {
  var profiles = loadNavProfiles();
  var profile = null;
  for (var i = 0; i < profiles.length; i++) { if (profiles[i] && profiles[i].id === id) { profile = profiles[i]; break; } }
  if (!profile) return { success: false, error: 'Profile not found.' };
  var BEC = window.BusinessEntityConstants;
  if (!BEC || typeof BEC.setRouteVisibilityOverride !== 'function') return { success: false, error: 'BEC not loaded' };
  var wantVisible = {};
  (profile.visibleRoutes || []).forEach(function(r) { wantVisible[r] = true; });
  var modeSet = (typeof getModeSet === 'function') ? getModeSet() : null;
  var current = _modeOverridesSnapshot || { enabledRoutes: [], disabledRoutes: [] };
  var next = {
    enabledRoutes: (current.enabledRoutes || []).slice(),
    disabledRoutes: (current.disabledRoutes || []).slice()
  };
  var universe = (typeof _getToggleableRoutes === 'function') ? _getToggleableRoutes() : [];
  for (var u = 0; u < universe.length; u++) {
    var routeId = universe[u];
    var rule = BEC.MODE_ROUTE_VISIBILITY[routeId] || {};
    if (rule.anchor) continue;                       // anchor is never toggled
    if (!MODE_MODULE_INFO[routeId]) continue;         // only user-curatable cards
    next = BEC.setRouteVisibilityOverride(next, routeId, !!wantVisible[routeId], modeSet);
  }
  try {
    if (window.MastDB && window.MastDB.businessEntity) {
      await window.MastDB.businessEntity.update('modeOverrides', next);
    }
    _modeOverridesSnapshot = next;
    if (typeof applyModeNavFilter === 'function') applyModeNavFilter();
    return { success: true, name: profile.name, count: (profile.visibleRoutes || []).length };
  } catch (err) {
    console.warn('[navProfiles] apply failed:', err && err.message);
    return { success: false, error: err && err.message };
  }
}

function deleteNavProfile(id) {
  var profiles = loadNavProfiles();
  var next = profiles.filter(function(p) { return p && p.id !== id; });
  if (next.length === profiles.length) return { success: false, error: 'Profile not found.' };
  if (!_saveNavProfiles(next)) return { success: false, error: 'Could not update this browser.' };
  return { success: true };
}
window.loadNavProfiles = loadNavProfiles;
window.saveCurrentNavProfile = saveCurrentNavProfile;
window.applyNavProfile = applyNavProfile;
window.deleteNavProfile = deleteNavProfile;

// Profiles bar HTML for the Add-to-Mast header. All names esc()'d (owner input).
function _renderNavProfilesBar() {
  var profiles = loadNavProfiles();
  var h = '';
  h += '<div style="padding:0 24px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
  h += '<span style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Profiles</span>';
  if (profiles.length === 0) {
    h += '<span style="font-size:0.85rem;color:var(--warm-gray);opacity:0.8;">Save your current sidebar as a profile, then apply it again later.</span>';
  } else {
    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i];
      if (!p || !p.id) continue;
      var n = (p.visibleRoutes && p.visibleRoutes.length) || 0;
      h += '<span style="display:inline-flex;align-items:center;background:var(--bg-soft,rgba(0,0,0,0.06));border-radius:999px;padding:2px 4px 2px 4px;">';
      h += '<button type="button" data-amt-action="profile-apply" data-amt-profile="' + esc(p.id) + '" ' +
           'title="Apply this profile" aria-label="Apply profile ' + esc(p.name) + '" ' +
           'style="background:transparent;border:0;color:var(--text-primary);font-size:0.85rem;font-weight:600;cursor:pointer;padding:2px 8px;border-radius:999px;">' +
           esc(p.name) + ' <span style="font-weight:400;opacity:0.6;">(' + n + ')</span></button>';
      h += '<button type="button" data-amt-action="profile-delete" data-amt-profile="' + esc(p.id) + '" ' +
           'title="Delete profile" aria-label="Delete profile ' + esc(p.name) + '" ' +
           'style="background:transparent;border:0;color:var(--warm-gray);font-size:1rem;line-height:1;cursor:pointer;padding:0 6px;">&times;</button>';
      h += '</span>';
    }
  }
  h += '<span style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;">';
  h += '<button type="button" id="navProfileSaveBtn" class="btn btn-secondary btn-small" data-amt-action="profile-save" ' +
       'title="Save the current sidebar layout as a named profile">+ Save current setup</button>';
  h += '<span id="navProfileSaveForm" style="display:none;align-items:center;gap:6px;">';
  h += '<input id="navProfileNameInput" type="text" maxlength="40" placeholder="Profile name" ' +
       'style="font-size:0.85rem;padding:5px 8px;border-radius:6px;border:1px solid var(--border,rgba(207,200,189,1));background:var(--bg,rgba(255,255,255,1));color:var(--text-primary);min-width:160px;" />';
  h += '<button type="button" class="btn btn-primary btn-small" data-amt-action="profile-save-confirm">Save</button>';
  h += '<button type="button" class="btn btn-secondary btn-small" data-amt-action="profile-save-cancel">Cancel</button>';
  h += '</span>';
  h += '</span>';
  h += '</div>';
  return h;
}
window._renderNavProfilesBar = _renderNavProfilesBar;

// Reveal the inline name field. No full re-render (would drop focus); the form
// is pre-rendered hidden in the bar.
function saveCurrentNavProfileClick() {
  var btn = document.getElementById('navProfileSaveBtn');
  var form = document.getElementById('navProfileSaveForm');
  var input = document.getElementById('navProfileNameInput');
  if (!form || !input) return;
  if (btn) btn.style.display = 'none';
  form.style.display = 'inline-flex';
  input.value = '';
  input.focus();
  input.onkeydown = function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); navProfileSaveConfirmClick(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); navProfileSaveCancelClick(); }
  };
}
function navProfileSaveCancelClick() {
  var btn = document.getElementById('navProfileSaveBtn');
  var form = document.getElementById('navProfileSaveForm');
  if (form) form.style.display = 'none';
  if (btn) btn.style.display = '';
}
function navProfileSaveConfirmClick() {
  var input = document.getElementById('navProfileNameInput');
  var name = input ? input.value : '';
  var result = saveCurrentNavProfile(name);
  if (result && result.success) {
    if (typeof showToast === 'function') {
      showToast('Saved profile "' + result.profile.name + '" (' + MastFormat.countNoun(result.count, 'module') + ')' +
                (result.replaced ? ' — replaced the previous one.' : '.'));
    }
    renderAddToMast();
  } else {
    if (typeof showToast === 'function') showToast((result && result.error) || 'Could not save profile.', true);
    if (input) input.focus();
  }
}
async function applyNavProfileClick(id) {
  var profiles = loadNavProfiles();
  var profile = null;
  for (var i = 0; i < profiles.length; i++) { if (profiles[i] && profiles[i].id === id) { profile = profiles[i]; break; } }
  if (!profile) return;
  var count = (profile.visibleRoutes && profile.visibleRoutes.length) || 0;
  var prompt = 'Apply profile "' + profile.name + '"? Your sidebar will switch to the ' +
               MastFormat.countNoun(count, 'module') + ' saved in it. You can change it any time.';
  var ok = await mastConfirm(prompt, { title: 'Apply profile', confirmLabel: 'Apply' });
  if (!ok) return;
  try {
    var result = await applyNavProfile(id);
    if (result && result.success) {
      if (typeof showToast === 'function') showToast('Applied profile "' + result.name + '".');
      renderAddToMast();
    } else {
      if (typeof showToast === 'function') showToast('Could not apply profile: ' + ((result && result.error) || 'unknown error'), true);
    }
  } catch (err) {
    console.warn('[applyNavProfileClick] failed:', err && err.message);
    if (typeof showToast === 'function') showToast('Could not apply profile.', true);
  }
}
async function deleteNavProfileClick(id) {
  var profiles = loadNavProfiles();
  var profile = null;
  for (var i = 0; i < profiles.length; i++) { if (profiles[i] && profiles[i].id === id) { profile = profiles[i]; break; } }
  if (!profile) return;
  var prompt = 'Delete profile "' + profile.name + '"? This only removes the saved layout from this browser — your current sidebar stays as is.';
  var ok = await mastConfirm(prompt, { title: 'Delete profile', confirmLabel: 'Delete' });
  if (!ok) return;
  var result = deleteNavProfile(id);
  if (result && result.success) {
    if (typeof showToast === 'function') showToast('Deleted profile "' + profile.name + '".');
    renderAddToMast();
  } else {
    if (typeof showToast === 'function') showToast((result && result.error) || 'Could not delete profile.', true);
  }
}
window.saveCurrentNavProfileClick = saveCurrentNavProfileClick;
window.navProfileSaveCancelClick = navProfileSaveCancelClick;
window.navProfileSaveConfirmClick = navProfileSaveConfirmClick;
window.applyNavProfileClick = applyNavProfileClick;
window.deleteNavProfileClick = deleteNavProfileClick;
