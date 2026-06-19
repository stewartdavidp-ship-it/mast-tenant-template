/**
 * Module-selection modal — the first-login "Choose Your Module(s)" overlay shown
 * to launch/operate-tier tenants who must pick their plan's additional modules.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager showModuleSelectionModal shim in
 * index.html, which the boot-time needsModuleSelection() gate triggers. The
 * overlay markup (#moduleSelectionOverlay, #moduleSelectionModalCards, the
 * confirm button) and its dark-mode CSS stay static in the shell; only the JS
 * moved here. needsModuleSelection() (the gate predicate) stays eager in the shell.
 *
 * Reads eager shell globals: getTenantSubscription, TIER_CONFIG, MODULE_REGISTRY,
 * esc, MastDB, loadTenantSubscription, showToast. All defined at boot, before this
 * modal can open. Logic moved VERBATIM (behavior-preserving).
 */
(function () {
  'use strict';

var _moduleSelectionModalState = { selected: [], limit: 0, selectable: [] };

function showModuleSelectionModal() {
  var sub = getTenantSubscription();
  var limit = sub.moduleLimit || 0;
  var selectable = sub.selectableModules || [];
  if (limit === 0 || selectable.length === 0) return;

  _moduleSelectionModalState = { selected: [], limit: limit, selectable: selectable };

  var titleEl = document.getElementById('moduleSelectionTitle');
  var subtitleEl = document.getElementById('moduleSelectionSubtitle');
  var tierName = (TIER_CONFIG[sub.tier] || {}).name || sub.tier;

  if (limit === 1) {
    titleEl.textContent = 'Choose Your Module';
    subtitleEl.textContent = 'Your ' + tierName + ' plan includes Web. Pick 1 additional module to activate.';
  } else {
    titleEl.textContent = 'Choose Your Modules';
    subtitleEl.textContent = 'Your ' + tierName + ' plan includes Web. Pick ' + limit + ' additional modules to activate.';
  }

  renderModuleSelectionModalCards();
  document.getElementById('moduleSelectionOverlay').style.display = '';
}

function renderModuleSelectionModalCards() {
  var container = document.getElementById('moduleSelectionModalCards');
  if (!container) return;

  var state = _moduleSelectionModalState;
  var atLimit = state.selected.length >= state.limit;
  var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;">';

  state.selectable.forEach(function(moduleId) {
    var mod = MODULE_REGISTRY[moduleId];
    if (!mod || mod.status === 'coming-soon') return;

    var isSelected = state.selected.indexOf(moduleId) >= 0;
    var canClick = !atLimit || isSelected;
    var border = isSelected ? '2px solid var(--amber, var(--amber))' : '2px solid var(--cream-dark, var(--cream-dark))';
    var bg = isSelected ? 'var(--cream, var(--cream))' : 'white';
    var opacity = (atLimit && !isSelected) ? '0.45' : '1';
    var shadow = isSelected ? '0 2px 12px rgba(196, 133, 60, 0.25)' : '0 1px 4px rgba(0,0,0,0.06)';
    var cursor = canClick ? 'pointer' : 'default';
    var onclick = canClick ? 'onclick="toggleModuleModalSelection(\'' + moduleId + '\')"' : '';

    h += '<div ' + onclick + ' style="background:' + bg + ';border:' + border + ';border-radius:12px;padding:18px;cursor:' + cursor + ';opacity:' + opacity + ';box-shadow:' + shadow + ';transition:all 0.2s;position:relative;">';

    if (isSelected) {
      h += '<span style="position:absolute;top:10px;right:10px;background:var(--amber, var(--amber));color:white;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.78rem;font-weight:700;">&#10003;</span>';
    }

    h += '<div style="font-size:1.6rem;margin-bottom:4px;">' + mod.icon + '</div>';
    h += '<div style="font-size:1.0rem;font-weight:700;font-family:\'Cormorant Garamond\', serif;color:var(--text-primary);margin-bottom:3px;">' + esc(mod.name) + '</div>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray, var(--warm-gray));line-height:1.4;">' + esc(mod.description) + '</div>';
    h += '</div>';
  });

  h += '</div>';
  container.innerHTML = h;

  // Update confirm button state
  var btn = document.getElementById('moduleSelectionConfirmBtn');
  if (btn) {
    var ready = state.selected.length === state.limit;
    btn.disabled = !ready;
    btn.textContent = ready
      ? 'Activate ' + state.selected.length + ' Module' + (state.selected.length !== 1 ? 's' : '')
      : 'Select ' + (state.limit - state.selected.length) + ' more';
    btn.style.opacity = ready ? '1' : '0.6';
  }
}

function toggleModuleModalSelection(moduleId) {
  var state = _moduleSelectionModalState;
  var idx = state.selected.indexOf(moduleId);
  if (idx >= 0) {
    state.selected.splice(idx, 1);
  } else if (state.selected.length < state.limit) {
    state.selected.push(moduleId);
  }
  renderModuleSelectionModalCards();
}

async function confirmModuleSelection() {
  var state = _moduleSelectionModalState;
  if (state.selected.length !== state.limit) return;

  var btn = document.getElementById('moduleSelectionConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Activating...'; }

  try {
    var sub = getTenantSubscription();
    var baseModules = sub.baseModules || ['web'];
    var newModules = baseModules.concat(state.selected);

    await MastDB.subscription.update({
      selectedModules: state.selected,
      modules: newModules,
      needsModuleSelection: false,
      updatedAt: new Date().toISOString()
    });

    // Re-fetch subscription from Firebase to ensure local state matches persisted state
    await loadTenantSubscription();

    // Hide modal
    document.getElementById('moduleSelectionOverlay').style.display = 'none';

    showToast('Modules activated! Your workspace is ready.');
  } catch (err) {
    console.error('Module selection failed:', err);
    showToast('Failed to save module selection: ' + err.message, true);
    if (btn) { btn.disabled = false; btn.textContent = 'Try Again'; }
  }
}

  // Impl for the eager shim (only external entry point) + the overlay's onclick
  // targets (static confirm button + module-card / generated onclick handlers).
  window.showModuleSelectionModalImpl = showModuleSelectionModal;
  window.confirmModuleSelection = confirmModuleSelection;
  window.toggleModuleModalSelection = toggleModuleModalSelection;
  window.renderModuleSelectionModalCards = renderModuleSelectionModalCards;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('moduleSelectionModal', {});
  }
})();
