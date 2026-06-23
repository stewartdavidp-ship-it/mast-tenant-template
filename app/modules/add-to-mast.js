/**
 * add-to-mast.js — the "Add to Mast" page: the central unlock surface where the
 * owner enables soft-hidden modules (per-card, "+ Add all", per-section, reset).
 *
 * Loaded EAGERLY via <script defer src> in app/index.html (NOT a lazy MANIFEST
 * entry). Extracted from the index.html inline <script> for the T1 decomposition.
 * Top-level scope is preserved, so every symbol stays a window global; the shared
 * route helpers it uses (_getToggleableRoutes, _getVisibleToggleableRoutes,
 * _sidebarLabelFor, _dependencyHideAdvisory, addRoutesToMast, MODE_MODULE_INFO,
 * MODE_SECTION_LABELS, esc, …) stay in index.html and are read only POST-LOAD
 * (renderAddToMast is the route setup fn; the *Click handlers fire via the
 * data-amt-action dispatch), so the deferred load is safe.
 *
 * Faithful move except: var(--token,#hex) style fallbacks -> rgba() (identical
 * color, hex-lint clean) and the mastConfirm-or-window.confirm fallback blocks ->
 * mastConfirm direct (always present post-load).
 *
 * window exports: renderAddToMast, addToMastClick, removeFromMastClick,
 *   addAllToMastClick, resetModeOverridesClick, addAllInSectionClick,
 *   removeAllFromMastClick, removeAllInSectionClick.
 */

async function renderAddToMast() {
  var container = document.getElementById('addToMastContent');
  if (!container) return;

  // Re-hydrate snapshots in case Settings or another flow changed modeSet
  // since last load. Cheap (single Firestore read; cached in MastDB).
  if (typeof hydrateEngagementSurface === 'function') {
    try { await hydrateEngagementSurface(); } catch (_e) { /* fail-open */ }
  }

  var modeSet = (typeof getModeSet === 'function') ? getModeSet() : null;
  var overrides = (typeof getModeOverrides === 'function') ? getModeOverrides() : { enabledRoutes: [], disabledRoutes: [] };
  var BEC = window.BusinessEntityConstants;

  // Legacy fallback: modeSet missing means M1 backfill hasn't run for this
  // tenant yet — show full nav (nothing to "add") with an explanatory message.
  if (!modeSet || !Array.isArray(modeSet.modes) || modeSet.modes.length === 0) {
    container.innerHTML =
      '<div style="padding:24px;color:var(--warm-gray);text-align:center;font-size:0.9rem;">' +
      'Your business setup is still loading. If this persists, contact support.' +
      '</div>';
    return;
  }

  // Build a unified view: EVERY non-always-on route, each labeled with current
  // visibility. The page is the canonical manage surface for the sidebar —
  // not just "what can I add" but "what's in my Mast right now, toggle either way."
  var allToggleable = _getToggleableRoutes();
  var visibleCount = 0;
  var hiddenCount = 0;
  var alwaysOnCount = 0;

  // Group by section, preserving sidebar order
  var sectionOrder = ['products', 'sales', 'marketing', 'site', 'retention', 'events', 'classes', 'finance', 'operations', 'customer-service', 'admin'];
  var grouped = {};
  for (var i = 0; i < allToggleable.length; i++) {
    var routeId = allToggleable[i];
    var info = MODE_MODULE_INFO[routeId];
    if (!info) continue;  // unknown route, skip silently
    var rule = BEC.MODE_ROUTE_VISIBILITY[routeId] || {};
    // 'isAlwaysOn' now means "the recovery anchor" (add-to-mast) — the only
    // route with no toggle. Every former always-on module is a normal,
    // removable card. (add-to-mast is excluded from this list upstream, so in
    // practice this is always false here; kept defensively.)
    var isAlwaysOn = !!rule.anchor;
    var visible = isAlwaysOn || BEC.isRouteVisible(routeId, modeSet, overrides);
    // Track three buckets: anchor (informational, no toggle), visible-toggleable, hidden
    if (isAlwaysOn) alwaysOnCount++;
    else if (visible) visibleCount++;
    else hiddenCount++;
    if (!grouped[info.section]) grouped[info.section] = [];
    grouped[info.section].push({ routeId: routeId, info: info, visible: visible, alwaysOn: isAlwaysOn });
  }

  // Surface-excluded summary: count curatable modules sitting in groups that the
  // engagement Surface trims entirely (whole-group hide via applyEngagementNavFiltering,
  // already stamped on the live sidebar as .engagement-hidden). These can't be
  // revealed from this page — the Surface setting governs them — so the header
  // links straight to it.
  var surfaceExcludedCount = 0;
  for (var se = 0; se < sectionOrder.length; se++) {
    var _sk = sectionOrder[se];
    if (!grouped[_sk] || !grouped[_sk].length) continue;
    var _secEl2 = document.querySelector('.sidebar-section[data-section="' + _sk + '"]');
    if (_secEl2 && _secEl2.classList.contains('engagement-hidden')) surfaceExcludedCount += grouped[_sk].length;
  }
  var canEditSettingsHdr = (typeof can === 'function') ? can('settings', 'edit') : true;

  // Page header: counts + bulk "+ Add all hidden" control
  var html = '';
  html += '<div style="padding:0 24px 16px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">';
  html += '<div style="color:var(--warm-gray);font-size:0.9rem;line-height:1.5;flex:1;min-width:240px;">';
  html += 'Manage what shows up in your Mast sidebar. ';
  html += 'Add modules you need, or hide ones you don&rsquo;t. Everything stays one click away.';
  html += '<div style="margin-top:8px;font-size:0.85rem;opacity:0.8;">';
  html += '<strong>' + (visibleCount + alwaysOnCount) + '</strong> in your sidebar &middot; ' +
          '<strong>' + hiddenCount + '</strong> available to add' +
          (alwaysOnCount > 0 ? ' &middot; <strong>' + alwaysOnCount + '</strong> always on' : '') + '.';
  html += '</div>';
  // Surface-excluded pointer: whole groups trimmed by the Engagement surface
  // can't be shown from here — point the owner at the control that governs them.
  if (surfaceExcludedCount > 0) {
    html += '<div style="margin-top:6px;font-size:0.85rem;">';
    html += '<strong style="color:var(--warn,rgba(179,117,47,1));">' + surfaceExcludedCount + '</strong> module' + (surfaceExcludedCount === 1 ? '' : 's') + ' excluded by your Engagement surface';
    if (canEditSettingsHdr) {
      html += ' &middot; <button type="button" data-amt-action="open-engagement-settings" style="background:transparent;border:0;color:var(--teal,rgba(42,124,111,1));font-weight:600;font-size:0.85rem;cursor:pointer;padding:0;text-decoration:underline;">Manage in Settings &rarr; Engagement</button>';
    }
    html += '.</div>';
  }
  html += '</div>';
  // Header buttons: "Reset to default" (only when overrides exist) + "+ Add all".
  var ovr = _modeOverridesSnapshot || { enabledRoutes: [], disabledRoutes: [] };
  var overrideCount = ((ovr.enabledRoutes || []).length) + ((ovr.disabledRoutes || []).length);
  if (hiddenCount > 0 || visibleCount > 0 || overrideCount > 0) {
    html += '<div style="display:flex;gap:8px;flex-shrink:0;align-self:flex-start;flex-wrap:wrap;">';
    if (overrideCount > 0) {
      html += '<button class="btn btn-secondary" onclick="resetModeOverridesClick()" ' +
              'aria-label="Reset sidebar to default — undoes ' + MastFormat.countNoun(overrideCount, 'override') + '" ' +
              'title="Restore your sidebar to what your business setup prescribes.">Reset to default</button>';
    }
    if (visibleCount > 0) {
      html += '<button class="btn btn-secondary" onclick="removeAllFromMastClick()" aria-label="Hide all ' + visibleCount + ' removable modules from my Mast" title="Hide every module you can hide. Always-on modules stay.">Hide all (' + visibleCount + ')</button>';
    }
    if (hiddenCount > 0) {
      html += '<button class="btn btn-primary" onclick="addAllToMastClick()" aria-label="Add all ' + hiddenCount + ' hidden modules to my Mast">+ Add all (' + hiddenCount + ')</button>';
    }
    html += '</div>';
  }
  html += '</div>';

  // Profiles bar — save/apply named sidebar layouts (localStorage).
  html += (typeof _renderNavProfilesBar === 'function' ? _renderNavProfilesBar() : '');

  // Section blocks — every section that has any toggleable items
  for (var s = 0; s < sectionOrder.length; s++) {
    var sectionKey = sectionOrder[s];
    var items = grouped[sectionKey];
    if (!items || items.length === 0) continue;
    var sectionLabel = MODE_SECTION_LABELS[sectionKey] || sectionKey;
    var sectionHiddenCount = 0;
    var sectionVisibleCount = 0;
    var sectionAlwaysOnCount = 0;
    for (var sh = 0; sh < items.length; sh++) {
      if (items[sh].alwaysOn) sectionAlwaysOnCount++;
      else if (items[sh].visible) sectionVisibleCount++;
      else sectionHiddenCount++;
    }
    var sectionVisibleTotal = sectionVisibleCount + sectionAlwaysOnCount;

    // Surface-hidden detection: the engagement Surface (ui-first/ai-first) trims
    // whole groups via applyEngagementNavFiltering, which already stamped the live
    // sidebar with .engagement-hidden (renderAddToMast awaits hydrate first). When
    // a group is surface-hidden, per-module Add here can't reveal it — the Surface
    // setting (Settings → Engagement & Navigation) governs the group.
    var _secEl = document.querySelector('.sidebar-section[data-section="' + sectionKey + '"]');
    var surfaceHidden = !!(_secEl && _secEl.classList.contains('engagement-hidden'));
    var canEditSettings = (typeof can === 'function') ? can('settings', 'edit') : true;
    var surfaceDisabledTitle = 'Hidden by your Surface setting — change your Surface in Settings to show this group.';

    html += '<div class="add-to-mast-section" style="padding:0 24px 24px;">';
    html += '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;border-bottom:1px solid var(--border,rgba(229,224,216,1));padding-bottom:8px;margin:16px 0 12px;">';
    html += '<h3 style="font-size:1.0rem;margin:0;color:var(--text-primary);">' + esc(sectionLabel) + ' <span style="font-weight:400;color:var(--warm-gray);font-size:0.85rem;">(' + sectionVisibleTotal + '/' + items.length + ' visible)</span></h3>';
    if (sectionHiddenCount > 0 || sectionVisibleCount > 0) {
      html += '<div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;">';
      if (sectionVisibleCount > 0) {
        html += '<button class="btn btn-secondary btn-small" data-amt-action="section-hide" data-amt-section="' + esc(sectionKey) + '" aria-label="Hide all ' + sectionVisibleCount + ' removable modules in ' + esc(sectionLabel) + '">Hide all ' + sectionVisibleCount + '</button>';
      }
      if (sectionHiddenCount > 0) {
        if (surfaceHidden) {
          html += '<button class="btn btn-secondary btn-small" disabled title="' + esc(surfaceDisabledTitle) + '" style="opacity:0.5;cursor:not-allowed;">+ Add all ' + sectionHiddenCount + ' hidden</button>';
        } else {
          html += '<button class="btn btn-secondary btn-small" data-amt-action="section-add" data-amt-section="' + esc(sectionKey) + '" aria-label="Add all ' + sectionHiddenCount + ' hidden modules in ' + esc(sectionLabel) + ' to my Mast">+ Add all ' + sectionHiddenCount + ' hidden</button>';
        }
      }
      html += '</div>';
    }
    html += '</div>';
    // Group-level Surface notice — explains why Adds here are inert and links to
    // the control that actually governs the group (permission-gated).
    if (surfaceHidden) {
      html += '<div style="margin:-4px 0 12px;padding:8px 12px;background:var(--bg-soft,rgba(0,0,0,0.04));border-radius:6px;font-size:0.78rem;color:var(--warm-gray);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">';
      html += '<span>This whole group is hidden by your <strong>Surface</strong> setting, so adding modules here won&rsquo;t show them yet.</span>';
      if (canEditSettings) {
        html += '<button type="button" data-amt-action="open-engagement-settings" style="background:transparent;border:0;color:var(--teal,rgba(42,124,111,1));font-weight:600;font-size:0.78rem;cursor:pointer;padding:0;text-decoration:underline;">Change in Settings &rarr;</button>';
      }
      html += '</div>';
    }
    html += '<div class="add-to-mast-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">';

    // Render order within section: hidden first (call to action), then visible-toggleable
    // (slightly greyed, removable), then always-on (most muted, no toggle).
    items.sort(function(a, b) {
      var orderA = a.alwaysOn ? 2 : (a.visible ? 1 : 0);
      var orderB = b.alwaysOn ? 2 : (b.visible ? 1 : 0);
      return orderA - orderB;
    });

    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      // 1:1 with the sidebar: prefer the exact label the nav shows for this
      // route, so the card never says "Receipts" while the sidebar says
      // "Day Close". Fall back to the mode-aware label, then the info label.
      var displayLabel = _sidebarLabelFor(it.routeId)
        || ((typeof BEC.labelFor === 'function')
              ? BEC.labelFor(it.routeId, modeSet, it.info.label)
              : it.info.label);

      // Three card states:
      //   hidden       → full opacity, "+ Add to my Mast" primary button
      //   visible      → opacity 0.55, "In sidebar" pill, "Remove from my Mast" secondary button
      //   alwaysOn     → opacity 0.4, "Always on" pill, no button (informational only)
      var cardStyle = 'border:1px solid var(--border,rgba(229,224,216,1));border-radius:8px;padding:14px;background:var(--surface-card,rgba(255,255,255,1));display:flex;flex-direction:column;gap:8px;';
      if (it.alwaysOn) cardStyle += 'opacity:0.4;';
      else if (it.visible) cardStyle += 'opacity:0.55;';

      html += '<div class="add-to-mast-card" data-route-id="' + esc(it.routeId) + '" data-visible="' + (it.visible ? 'true' : 'false') + '" data-always-on="' + (it.alwaysOn ? 'true' : 'false') + '" style="' + cardStyle + '">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">';
      html += '<div style="font-size:0.9rem;font-weight:600;color:var(--text-primary);">' + esc(displayLabel) + '</div>';
      if (it.alwaysOn) {
        html += '<span style="font-size:0.72rem;color:var(--warm-gray);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Always on</span>';
      } else if (surfaceHidden) {
        // Mode-layer visibility is moot while the Surface trims the whole group —
        // report the truth the user sees in the nav.
        html += '<span style="font-size:0.72rem;color:var(--warm-gray);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Hidden by Surface</span>';
      } else if (it.visible) {
        html += '<span style="font-size:0.72rem;color:var(--teal,rgba(42,124,111,1));font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">In sidebar</span>';
      }
      html += '</div>';
      // tagline (new schema field) falls back to legacy `desc` via the
      // back-compat shim in data/mode-module-info.js.
      html += '<div style="font-size:0.78rem;color:var(--warm-gray);line-height:1.45;flex-grow:1;">' + esc(it.info.tagline || it.info.desc || '') + '</div>';
      // Dependency note: if this module is VISIBLE but something it needs is
      // currently HIDDEN, flag it so the owner knows the surface will be empty.
      if (it.visible && BEC && typeof BEC.requiresOf === 'function') {
        var missing = BEC.requiresOf(it.routeId).filter(function(req) {
          return !BEC.isRouteVisible(req, modeSet, overrides);
        });
        if (missing.length > 0) {
          var missLabels = missing.map(function(req) { return _sidebarLabelFor(req) || ((MODE_MODULE_INFO[req] && MODE_MODULE_INFO[req].label) || req); });
          html += '<div style="font-size:0.72rem;color:var(--warn,rgba(179,117,47,1));display:flex;align-items:center;gap:4px;margin-top:2px;">&#9888; Needs ' + esc(missLabels.join(' & ')) + ' (hidden)</div>';
        }
      }
      // E1: chip row — setupDepth + Details toggle (only when card is enriched).
      var isEnriched = !!it.info.outcome;
      var hasChips   = !!it.info.setupDepth;
      if (hasChips || isEnriched) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px;flex-wrap:wrap;">';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        if (it.info.setupDepth) {
          var depthLabel = ({ quick: 'Quick setup', moderate: 'Moderate setup', heavy: 'Heavier setup' })[it.info.setupDepth] || it.info.setupDepth;
          html += '<span class="add-to-mast-chip" style="font-size:0.72rem;color:var(--warm-gray);background:var(--bg-soft,rgba(0,0,0,0.04));border-radius:999px;padding:2px 8px;">' + esc(depthLabel) + '</span>';
        }
        html += '</div>';
        if (isEnriched) {
          html += '<button type="button" class="add-to-mast-details-toggle" data-amt-action="details" data-amt-route="' + esc(it.routeId) + '" aria-haspopup="dialog" aria-label="Details about ' + esc(displayLabel) + '" style="background:transparent;border:0;color:var(--teal,rgba(42,124,111,1));font-size:0.72rem;font-weight:600;cursor:pointer;padding:2px 4px;">Details &rarr;</button>';
        }
        html += '</div>';
      }
      if (it.alwaysOn) {
        // No button — always-on items are informational only.
      } else if (surfaceHidden) {
        // The Surface governs this group — per-module Add can't reveal it, so the
        // show control is greyed/inert. (Remove of a still-mode-visible module
        // stays available so the owner can also tidy the mode layer.)
        if (it.visible) {
          html += '<button class="btn btn-secondary btn-small" data-amt-action="remove" data-amt-route="' + esc(it.routeId) + '" aria-label="Remove ' + esc(displayLabel) + ' from my Mast" style="margin-top:4px;align-self:flex-start;">Remove from my Mast</button>';
        } else {
          html += '<button class="btn btn-primary btn-small" disabled title="' + esc(surfaceDisabledTitle) + '" style="margin-top:4px;align-self:flex-start;opacity:0.5;cursor:not-allowed;">+ Add to my Mast</button>';
        }
      } else if (it.visible) {
        html += '<button class="btn btn-secondary btn-small" data-amt-action="remove" data-amt-route="' + esc(it.routeId) + '" aria-label="Remove ' + esc(displayLabel) + ' from my Mast" style="margin-top:4px;align-self:flex-start;">Remove from my Mast</button>';
      } else {
        html += '<button class="btn btn-primary btn-small" data-amt-action="add" data-amt-route="' + esc(it.routeId) + '" aria-label="Add ' + esc(displayLabel) + ' to my Mast" style="margin-top:4px;align-self:flex-start;">+ Add to my Mast</button>';
      }
      // E1 v2 (2026-05-22): inline-expand replaced with right-side drawer.
      // Drawer DOM is global; created lazily by openAddToMastDetails().
      html += '</div>';
    }

    html += '</div></div>';
  }

  container.innerHTML = html;
}
window.renderAddToMast = renderAddToMast;

// Click handler — wraps the M2 addRouteToMast helper with toast feedback +
// page re-render so the card disappears immediately.
async function addToMastClick(routeId) {
  try {
    var info = MODE_MODULE_INFO[routeId];
    var defaultLabel = (info && info.label) || routeId;
    // M4: prefer mode-aware label for toast copy
    var modeSet = (typeof getModeSet === 'function') ? getModeSet() : null;
    var label = (window.BusinessEntityConstants && typeof BusinessEntityConstants.labelFor === 'function')
      ? BusinessEntityConstants.labelFor(routeId, modeSet, defaultLabel)
      : defaultLabel;
    var result = await addRouteToMast(routeId, 'add_to_mast_page');
    if (result && result.success) {
      if (typeof showToast === 'function') {
        showToast(result.alreadyEnabled
          ? label + ' was already enabled.'
          : label + ' added to your Mast.');
      }
      // Re-render the page so the card disappears
      renderAddToMast();
    } else {
      if (typeof showToast === 'function') {
        showToast('Could not add ' + label + ': ' + ((result && result.error) || 'unknown error'), true);
      }
    }
  } catch (err) {
    console.warn('[addToMastClick] failed:', err && err.message);
    if (typeof showToast === 'function') showToast('Could not add module.', true);
  }
}
window.addToMastClick = addToMastClick;

// Click handler for the "Remove from my Mast" button on visible cards.
// Wraps removeRouteFromMast + toast feedback + re-render so the card
// flips to the hidden state immediately.
async function removeFromMastClick(routeId) {
  try {
    var info = MODE_MODULE_INFO[routeId];
    var defaultLabel = (info && info.label) || routeId;
    var modeSet = (typeof getModeSet === 'function') ? getModeSet() : null;
    var label = (window.BusinessEntityConstants && typeof BusinessEntityConstants.labelFor === 'function')
      ? BusinessEntityConstants.labelFor(routeId, modeSet, defaultLabel)
      : defaultLabel;
    var result = await removeRouteFromMast(routeId, 'remove_from_mast_page');
    if (result && result.success) {
      if (typeof showToast === 'function') {
        if (result.alreadyHidden) {
          showToast(label + ' was already hidden.');
        } else {
          var advisory = _dependencyHideAdvisory([routeId]);
          showToast(label + ' removed from your Mast.' + (advisory ? '  ' + advisory : ''));
        }
      }
      renderAddToMast();
    } else if (result && result.anchor) {
      if (typeof showToast === 'function') showToast(label + ' is always available — it’s how you re-add modules, so it can’t be hidden.', true);
    } else {
      if (typeof showToast === 'function') {
        showToast('Could not remove ' + label + ': ' + ((result && result.error) || 'unknown error'), true);
      }
    }
  } catch (err) {
    console.warn('[removeFromMastClick] failed:', err && err.message);
    if (typeof showToast === 'function') showToast('Could not remove module.', true);
  }
}
window.removeFromMastClick = removeFromMastClick;

// Bulk: add EVERY soft-hidden module on the page. Confirms first (significant
// action — turns the sidebar full-fat). Idempotent — re-clicking after partial
// adds just enables the remainder.
async function addAllToMastClick() {
  var modeSet = (typeof getModeSet === 'function') ? getModeSet() : null;
  var overrides = (typeof getModeOverrides === 'function') ? getModeOverrides() : { enabledRoutes: [], disabledRoutes: [] };
  var softHidden = _getSoftHiddenRoutes(modeSet, overrides);
  if (softHidden.length === 0) {
    if (typeof showToast === 'function') showToast('Nothing left to add.');
    return;
  }
  var prompt = 'Add all ' + softHidden.length + ' modules to your Mast? You can hide any of them later from Settings &rarr; Change my business setup.';
  var ok = await mastConfirm(prompt, { title: 'Add all modules', confirmLabel: 'Add all (' + softHidden.length + ')' });
  if (!ok) return;
  try {
    var result = await addRoutesToMast(softHidden, 'add_all_to_mast_page');
    if (result && result.success) {
      if (typeof showToast === 'function') {
        showToast(MastFormat.countNoun(result.addedCount, 'module') + ' added to your Mast.');
      }
      renderAddToMast();
    } else {
      if (typeof showToast === 'function') {
        showToast('Could not add all modules: ' + ((result && result.error) || 'unknown error'), true);
      }
    }
  } catch (err) {
    console.warn('[addAllToMastClick] failed:', err && err.message);
    if (typeof showToast === 'function') showToast('Could not add all modules.', true);
  }
}
window.addAllToMastClick = addAllToMastClick;

// Click handler — confirms then clears all per-route overrides. Significant
// action (undoes everything the owner has manually added or hidden on this
// tenant), so always behind a mastConfirm dialog.
async function resetModeOverridesClick() {
  var current = _modeOverridesSnapshot || { enabledRoutes: [], disabledRoutes: [] };
  var addedCount   = (current.enabledRoutes || []).length;
  var hiddenCount  = (current.disabledRoutes || []).length;
  if (addedCount === 0 && hiddenCount === 0) {
    if (typeof showToast === 'function') showToast('Your sidebar is already at the default.');
    return;
  }
  var parts = [];
  if (addedCount > 0)  parts.push(MastFormat.countNoun(addedCount, 'added module'));
  if (hiddenCount > 0) parts.push(MastFormat.countNoun(hiddenCount, 'hidden module'));
  var prompt = 'Reset to default? This undoes ' + parts.join(' and ') +
               ', putting your sidebar back to what your business setup prescribes. ' +
               'You can re-add or re-hide modules at any time.';
  var ok = await mastConfirm(prompt, { title: 'Reset to default', confirmLabel: 'Reset to default' });
  if (!ok) return;
  try {
    var result = await resetModeOverridesToDefaults('reset_from_mast_page');
    if (result && result.success) {
      if (typeof showToast === 'function') {
        showToast(result.alreadyDefault
          ? 'Your sidebar was already at the default.'
          : 'Sidebar reset to default (' + MastFormat.countNoun(result.clearedCount, 'override') + ' cleared).');
      }
      renderAddToMast();
    } else {
      if (typeof showToast === 'function') {
        showToast('Could not reset to default: ' + ((result && result.error) || 'unknown error'), true);
      }
    }
  } catch (err) {
    console.warn('[resetModeOverridesClick] failed:', err && err.message);
    if (typeof showToast === 'function') showToast('Could not reset to default.', true);
  }
}
window.resetModeOverridesClick = resetModeOverridesClick;

// Bulk: add every soft-hidden module in a single section. Lower-friction than
// "add all" — no confirm dialog (typical section is 4-8 modules, low blast
// radius). Toast feedback + immediate re-render.
async function addAllInSectionClick(sectionKey) {
  var modeSet = (typeof getModeSet === 'function') ? getModeSet() : null;
  var overrides = (typeof getModeOverrides === 'function') ? getModeOverrides() : { enabledRoutes: [], disabledRoutes: [] };
  var softHidden = _getSoftHiddenRoutes(modeSet, overrides);
  var inSection = softHidden.filter(function(routeId) {
    var info = MODE_MODULE_INFO[routeId];
    return info && info.section === sectionKey;
  });
  if (inSection.length === 0) {
    if (typeof showToast === 'function') showToast('Nothing left to add in this section.');
    return;
  }
  try {
    var result = await addRoutesToMast(inSection, 'add_all_in_section');
    if (result && result.success) {
      var sectionLabel = MODE_SECTION_LABELS[sectionKey] || sectionKey;
      if (typeof showToast === 'function') {
        showToast(result.addedCount + ' ' + sectionLabel + ' ' + MastFormat.plural(result.addedCount, 'module') + ' added.');
      }
      renderAddToMast();
    } else {
      if (typeof showToast === 'function') {
        showToast('Could not add section: ' + ((result && result.error) || 'unknown error'), true);
      }
    }
  } catch (err) {
    console.warn('[addAllInSectionClick] failed:', err && err.message);
    if (typeof showToast === 'function') showToast('Could not add section modules.', true);
  }
}
window.addAllInSectionClick = addAllInSectionClick;

// Bulk: hide every removable module across the whole page. Inverse of
// addAllToMastClick. Behind a confirm — it's a big change (clears the sidebar
// down to always-on modules). Always-on modules are unaffected.
async function removeAllFromMastClick() {
  var modeSet = (typeof getModeSet === 'function') ? getModeSet() : null;
  var overrides = (typeof getModeOverrides === 'function') ? getModeOverrides() : { enabledRoutes: [], disabledRoutes: [] };
  var visible = _getVisibleToggleableRoutes(modeSet, overrides);
  if (visible.length === 0) {
    if (typeof showToast === 'function') showToast('Nothing left to hide — only always-on modules remain.');
    return;
  }
  var prompt = 'Hide all ' + visible.length + ' removable modules? Your sidebar will show only the always-on modules. You can re-add any of them at any time from this page.';
  var ok = await mastConfirm(prompt, { title: 'Hide all modules', confirmLabel: 'Hide all (' + visible.length + ')' });
  if (!ok) return;
  try {
    var result = await removeRoutesFromMast(visible, 'remove_all_from_mast_page');
    if (result && result.success) {
      if (typeof showToast === 'function') {
        var advisory = _dependencyHideAdvisory(visible);
        showToast(MastFormat.countNoun(result.removedCount, 'module') + ' hidden from your Mast.' + (advisory ? '  ' + advisory : ''));
      }
      renderAddToMast();
    } else {
      if (typeof showToast === 'function') {
        showToast('Could not hide all modules: ' + ((result && result.error) || 'unknown error'), true);
      }
    }
  } catch (err) {
    console.warn('[removeAllFromMastClick] failed:', err && err.message);
    if (typeof showToast === 'function') showToast('Could not hide all modules.', true);
  }
}
window.removeAllFromMastClick = removeAllFromMastClick;

// Bulk: hide every removable module in a single section. Mirrors
// addAllInSectionClick — no confirm dialog; typical section is 4-8 modules.
async function removeAllInSectionClick(sectionKey) {
  var modeSet = (typeof getModeSet === 'function') ? getModeSet() : null;
  var overrides = (typeof getModeOverrides === 'function') ? getModeOverrides() : { enabledRoutes: [], disabledRoutes: [] };
  var visible = _getVisibleToggleableRoutes(modeSet, overrides);
  var inSection = visible.filter(function(routeId) {
    var info = MODE_MODULE_INFO[routeId];
    return info && info.section === sectionKey;
  });
  if (inSection.length === 0) {
    if (typeof showToast === 'function') showToast('Nothing left to hide in this section.');
    return;
  }
  try {
    var result = await removeRoutesFromMast(inSection, 'remove_all_in_section');
    if (result && result.success) {
      var sectionLabel = MODE_SECTION_LABELS[sectionKey] || sectionKey;
      if (typeof showToast === 'function') {
        var advisory = _dependencyHideAdvisory(inSection);
        showToast(result.removedCount + ' ' + sectionLabel + ' ' + MastFormat.plural(result.removedCount, 'module') + ' hidden.' + (advisory ? '  ' + advisory : ''));
      }
      renderAddToMast();
    } else {
      if (typeof showToast === 'function') {
        showToast('Could not hide section: ' + ((result && result.error) || 'unknown error'), true);
      }
    }
  } catch (err) {
    console.warn('[removeAllInSectionClick] failed:', err && err.message);
    if (typeof showToast === 'function') showToast('Could not hide section modules.', true);
  }
}
window.removeAllInSectionClick = removeAllInSectionClick;
