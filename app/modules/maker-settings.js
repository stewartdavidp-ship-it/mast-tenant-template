// app/modules/maker-settings.js — lazy-loaded on demand by the 'maker' branch of
// switchSettingsSubView (decomposition Track 1). The Settings → Develop ("maker")
// sub-panel: cost-tracking toggle, recipe-recalc cadence, drift-severity
// overrides, and the repricing-threshold editor — extracted VERBATIM from the
// inline shell. The dispatcher stays eager and lazy-loads this module before
// calling loadMakerSettings (mirrors settings-panels.js).
//
// Exposes window.loadMakerSettings (entry) + the onMaker* onclick/onchange
// targets. Reads eager shell globals (all defined before a user can reach a
// settings sub-panel): MastDB, esc, showToast, mastConfirm, firebase, MastDirty,
// and the eager drift-severity core loadDriftSeverity (which STAYS in the shell —
// it is also read by the lazy unified-drift-dialog.js). The MAST_MAKER_* field
// registries + loadLatestDriftScan are maker-private and move with the panel.
(function () {
  'use strict';

// ============================================================
// Phase 6b.1 — Maker Settings (Paradigm A + Atomic Widgets)
// ============================================================
// Data paths:
//   admin/config/trackMaterialInventory      (bool, atomic toggle)
//   admin/config/recipeRecalcCadence         (weekly|monthly|off, atomic dropdown)
//   admin/config/makerSettings/repricingThresholdPct  (number %, non-atomic)
//   admin/syncRuleSeverity/{field}           (tenant override per field, atomic dropdown)
//   mast-platform/driftSeverityDefaults/{field}  (platform defaults, read-only)

var MAST_MAKER_DRIFT_FIELDS = ['title', 'description', 'price', 'status', 'inventory'];
var MAST_MAKER_FIELD_LABELS = {
  title: 'Title',
  description: 'Description',
  price: 'Price',
  status: 'Status',
  inventory: 'Inventory'
};
var MAST_MAKER_SEVERITY_FALLBACK = {
  inventory: 'critical',
  title: 'warning',
  description: 'warning',
  price: 'warning',
  status: 'warning'
};

// Phase 7c.4 — drift scan lookup (read-only, bounded 7-day scan). Reads the
// tenant-local mirror written by scheduledPriceCentsDriftScan at
// {tenantId}/admin/driftScans/{YYYY-MM-DD}. Walks back up to 7 days.
async function loadLatestDriftScan(tenantId) {
  try {
    for (var i = 0; i < 7; i++) {
      var d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      var dateKey = d.toISOString().slice(0, 10);
      var val = await MastDB.get('admin/driftScans/' + dateKey);
      if (val) return { date: dateKey, record: val };
    }
  } catch (e) { /* non-fatal */ }
  return null;
}

async function loadMakerSettings() {
  var container = document.getElementById('makerSettingsContent');
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading maker settings…</div>';
  try {
    var tenantId = MastDB.tenantId();
    // Reset cached severity so reloading picks up any external edits.
    window.__mastDriftSeverity = null;
    var results = await Promise.all([
      MastDB.get('admin/config'),
      loadDriftSeverity(),
      // Phase 7c.4 — look back up to 7 days for the most recent scheduled
      // priceCents drift scan record for this tenant. Returns { date, record }
      // or null when no scan has fired.
      loadLatestDriftScan(tenantId)
    ]);
    var cfg = results[0] || {};
    var sev = results[1];
    var latestScan = results[2];
    window.__mastMakerSettings = {
      trackMaterialInventory: cfg.trackMaterialInventory === true,
      recipeRecalcCadence: (cfg.recipeRecalcCadence || 'off'),
      repricingThresholdPct: (cfg.makerSettings && typeof cfg.makerSettings.repricingThresholdPct === 'number') ? cfg.makerSettings.repricingThresholdPct : 15,
      severityOverrides: sev.tenantOverrides || {},
      severityDefaults: sev.platformDefaults || {},
      latestDriftScan: latestScan || null
    };
    renderMakerSettings();
  } catch (err) {
    container.innerHTML = '<p role="alert" style="color:var(--danger);font-size:0.85rem;">Failed to load: ' + esc(err.message || err) + '</p>';
  }
}

function renderMakerSettings() {
  var container = document.getElementById('makerSettingsContent');
  if (!container) return;
  var s = window.__mastMakerSettings || {};
  var html = '';

  // ── Section 1: Cost Tracking (all atomic widgets) ────────────────────────
  html += '<section aria-labelledby="makerCostHeading" style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;margin-bottom:16px;">';
  html += '<h3 id="makerCostHeading" style="font-size:1.15rem;font-weight:600;margin:0 0 4px;">Cost tracking</h3>';
  html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 16px;">Deduct materials on build complete and recalculate estimated recipe costs on a schedule.</p>';

  // Toggle: trackMaterialInventory (atomic)
  html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px;padding:8px 0;border-bottom:1px solid var(--cream-dark);">';
  html += '<div style="flex:1;">';
  html += '<label for="mkTrackMat" style="font-size:0.9rem;font-weight:500;cursor:pointer;">Deduct materials on build complete</label>';
  html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:2px 0 0;">When on, completing a build transactionally decrements materials used.</p>';
  html += '</div>';
  html += '<label class="switch" style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;">';
  html += '<input type="checkbox" id="mkTrackMat" ' + (s.trackMaterialInventory ? 'checked' : '') + ' aria-label="Deduct materials on build complete" onchange="onMakerToggleTrackMat(this.checked)" style="opacity:0;width:0;height:0;">';
  html += '<span style="position:absolute;cursor:pointer;inset:0;background:' + (s.trackMaterialInventory ? 'var(--copper)' : '#ccc') + ';border-radius:24px;transition:0.2s;"></span>';
  html += '<span style="position:absolute;height:18px;width:18px;left:' + (s.trackMaterialInventory ? '23px' : '3px') + ';top:3px;background:white;border-radius:50%;transition:0.2s;"></span>';
  html += '</label>';
  html += '</div>';

  // Cadence dropdown (atomic — 3 options, valid-from-any-state)
  html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px;padding:8px 0;border-bottom:1px solid var(--cream-dark);flex-wrap:wrap;">';
  html += '<div style="flex:1;min-width:220px;">';
  html += '<label for="mkCadence" style="font-size:0.9rem;font-weight:500;">Recalc cadence</label>';
  html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:2px 0 0;">How often the 03:00 UTC cron recomputes estimated cost against current materials.</p>';
  html += '</div>';
  html += '<select id="mkCadence" aria-label="Recipe recalc cadence" onchange="onMakerCadenceChange(this.value)" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--text-primary);font-family:\'DM Sans\';font-size:0.85rem;min-width:140px;">';
  ['off', 'weekly', 'monthly'].forEach(function(v) {
    var label = v.charAt(0).toUpperCase() + v.slice(1);
    html += '<option value="' + v + '"' + (s.recipeRecalcCadence === v ? ' selected' : '') + '>' + label + '</option>';
  });
  html += '</select>';
  html += '</div>';

  // Run-now button (atomic action with confirm)
  html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0;flex-wrap:wrap;">';
  html += '<div style="flex:1;min-width:220px;">';
  html += '<div style="font-size:0.9rem;font-weight:500;">Run recalc now</div>';
  html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:2px 0 0;">Manually trigger the recalc pass immediately (ignores cadence).</p>';
  html += '</div>';
  html += '<button id="mkRecalcNowBtn" class="btn btn-secondary btn-small" onclick="onMakerRunRecalcNow()">Run recalc now</button>';
  html += '</div>';

  html += '</section>';

  // ── Section 2: Drift Severity (5 atomic rows) ────────────────────────────
  html += '<section aria-labelledby="makerSevHeading" style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;margin-bottom:16px;">';
  html += '<h3 id="makerSevHeading" style="font-size:1.15rem;font-weight:600;margin:0 0 4px;">Drift severity</h3>';
  html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 16px;">Override how each drift field is classified. Platform defaults shown in italics; your override (if any) takes precedence.</p>';

  MAST_MAKER_DRIFT_FIELDS.forEach(function(field) {
    var platformDefault = s.severityDefaults[field] || MAST_MAKER_SEVERITY_FALLBACK[field] || 'warning';
    var override = s.severityOverrides[field] || null;
    var effective = override || platformDefault;
    var hasOverride = !!override;
    var label = MAST_MAKER_FIELD_LABELS[field] || field;
    var rowId = 'mkSev_' + field;

    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--cream-dark);flex-wrap:wrap;">';
    html += '<div style="flex:1;min-width:200px;">';
    html += '<label for="' + rowId + '" style="font-size:0.9rem;font-weight:500;">' + esc(label) + '</label>';
    html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:2px 0 0;">Platform default: <em>' + esc(platformDefault) + '</em>' + (hasOverride ? ' · Currently overridden to <strong>' + esc(override) + '</strong>' : '') + '</p>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    html += '<select id="' + rowId + '" aria-label="Severity for ' + esc(label) + '" onchange="onMakerSeverityChange(\'' + esc(field) + '\', this.value)" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--text-primary);font-family:\'DM Sans\';font-size:0.85rem;">';
    ['critical', 'warning', 'info'].forEach(function(sv) {
      html += '<option value="' + sv + '"' + (effective === sv ? ' selected' : '') + '>' + sv.charAt(0).toUpperCase() + sv.slice(1) + '</option>';
    });
    html += '</select>';
    html += '<button class="btn btn-secondary btn-small" aria-label="Reset ' + esc(label) + ' to platform default" onclick="onMakerResetSeverity(\'' + esc(field) + '\')" ' + (hasOverride ? '' : 'disabled') + ' title="Reset to platform default">Reset</button>';
    html += '</div>';
    html += '</div>';
  });

  html += '</section>';

  // ── Section 3: Repricing Threshold (Paradigm A edit mode) ────────────────
  var editMode = !!window.__mkThresholdEditMode;
  html += '<section aria-labelledby="makerReprHeading" style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;margin-bottom:16px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px;">';
  html += '<h3 id="makerReprHeading" style="font-size:1.15rem;font-weight:600;margin:0;">Repricing threshold</h3>';
  if (editMode) {
    html += '<span class="status-badge" style="background:#f59e0b;color:#fff;font-size:0.72rem;padding:2px 8px;border-radius:4px;">Editing</span>';
  } else {
    html += '<button class="btn btn-secondary btn-small" onclick="onMakerEnterThresholdEdit()" aria-label="Edit repricing threshold">Edit</button>';
  }
  html += '</div>';
  html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 16px;">Alert when a recipe\'s observed cost drifts past this percent from the published estimate.</p>';

  if (editMode) {
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">';
    html += '<input type="number" id="mkThresholdInput" value="' + esc(String(s.repricingThresholdPct)) + '" min="0" max="100" step="0.1" aria-label="Repricing threshold percent" style="width:120px;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    html += '<span style="font-size:0.9rem;color:var(--warm-gray);">%</span>';
    html += '<div style="flex-basis:100%;height:0;"></div>';
    html += '<button class="btn btn-primary" onclick="onMakerSaveThreshold()">Save</button>';
    html += '<button class="btn btn-secondary" onclick="onMakerCancelThreshold()">Cancel</button>';
    html += '</div>';
  } else {
    html += '<div style="font-size:1.6rem;font-weight:600;">' + esc(String(s.repricingThresholdPct)) + '<span style="font-size:0.9rem;font-weight:400;color:var(--warm-gray);margin-left:4px;">%</span></div>';
  }

  // Phase 7c.4 — dwell-period indicator for the scheduled priceCents drift scan.
  var latest = s.latestDriftScan;
  html += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--cream-dark);font-size:0.78rem;color:var(--warm-gray);" aria-live="polite">';
  if (latest && latest.record && !latest.record.error) {
    var scannedAt = latest.record.scannedAt || latest.date;
    var scanDate;
    try { scanDate = MastFormat.dateTime(scannedAt); } catch (e) { scanDate = scannedAt; }
    var driftCount = Number(latest.record.driftCount || 0);
    var pieces = ['Last price drift scan: <strong>' + esc(scanDate) + '</strong>'];
    if (driftCount === 0) {
      pieces.push('<span style="color:var(--warm-gray);">No drift detected</span>');
    } else {
      var maxDollars = Number(latest.record.maxSingleDriftDollars || 0);
      pieces.push('<span>' + driftCount + ' product(s) with drift · max $' + maxDollars.toFixed(2) + '</span>');
    }
    html += pieces.join(' · ');
  } else {
    html += 'No drift scan run yet — scheduled daily at 03:30 UTC, or trigger via <em>Run recalc now</em> above.';
  }
  html += '</div>';

  html += '</section>';

  container.innerHTML = html;
}

// ── Atomic handlers: toggle, dropdown, reset ────────────────────────────────
async function onMakerToggleTrackMat(checked) {
  try {
    await MastDB.set('admin/config/trackMaterialInventory', !!checked);
    window.__mastMakerSettings.trackMaterialInventory = !!checked;
    showToast('Material deduction ' + (checked ? 'enabled' : 'disabled'));
    renderMakerSettings();
  } catch (err) {
    showToast('Save failed: ' + (err.message || err), true);
    renderMakerSettings(); // revert UI
  }
}

async function onMakerCadenceChange(value) {
  if (['off', 'weekly', 'monthly'].indexOf(value) < 0) return;
  try {
    await MastDB.set('admin/config/recipeRecalcCadence', value);
    window.__mastMakerSettings.recipeRecalcCadence = value;
    showToast('Cadence set to ' + value);
  } catch (err) {
    showToast('Save failed: ' + (err.message || err), true);
    renderMakerSettings();
  }
}

async function onMakerRunRecalcNow() {
  var btn = document.getElementById('mkRecalcNowBtn');
  var ok = await mastConfirm('Run recipe cost recalc now? This touches every published recipe.', { title: 'Run recalc now' });
  if (!ok) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
  try {
    var res = await firebase.functions().httpsCallable('triggerRecipeCostRecalc')({ tenantId: MastDB.tenantId(), force: true });
    var data = (res && res.data) || {};
    showToast('Recalc complete · ' + (data.recipesProcessed || 0) + ' recipes · ' + (data.alertsFired || 0) + ' alerts');
  } catch (err) {
    showToast('Recalc failed: ' + (err.message || err), true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Run recalc now'; }
  }
}

async function onMakerSeverityChange(field, value) {
  if (['critical', 'warning', 'info'].indexOf(value) < 0) return;
  try {
    await MastDB.set('admin/syncRuleSeverity/' + field, value);
    if (!window.__mastMakerSettings.severityOverrides) window.__mastMakerSettings.severityOverrides = {};
    window.__mastMakerSettings.severityOverrides[field] = value;
    // Invalidate the unified cache so the drift queue re-reads on next render.
    window.__mastDriftSeverity = null;
    showToast(MAST_MAKER_FIELD_LABELS[field] + ' severity set to ' + value);
    renderMakerSettings();
  } catch (err) {
    showToast('Save failed: ' + (err.message || err), true);
    renderMakerSettings();
  }
}

async function onMakerResetSeverity(field) {
  try {
    await MastDB.remove('admin/syncRuleSeverity/' + field);
    if (window.__mastMakerSettings.severityOverrides) delete window.__mastMakerSettings.severityOverrides[field];
    window.__mastDriftSeverity = null;
    showToast(MAST_MAKER_FIELD_LABELS[field] + ' reset to platform default');
    renderMakerSettings();
  } catch (err) {
    showToast('Reset failed: ' + (err.message || err), true);
    renderMakerSettings();
  }
}

// ── Non-atomic: Repricing threshold (Paradigm A) ────────────────────────────
function onMakerEnterThresholdEdit() {
  window.__mkThresholdEditMode = true;
  window.__mkThresholdBaseline = window.__mastMakerSettings.repricingThresholdPct;
  renderMakerSettings();
  // Register with MastDirty so sidebar nav prompts unsaved-changes.
  if (window.MastDirty) {
    MastDirty.register('makerThresholdEdit', function() {
      var input = document.getElementById('mkThresholdInput');
      if (!input) return false;
      return parseFloat(input.value) !== window.__mkThresholdBaseline;
    }, { label: 'Repricing threshold' });
  }
  // Focus the input so keyboard users land in edit mode cleanly.
  setTimeout(function() {
    var input = document.getElementById('mkThresholdInput');
    if (input) { input.focus(); input.select(); }
  }, 30);
}

function onMakerCancelThreshold() {
  window.__mkThresholdEditMode = false;
  if (window.MastDirty) MastDirty.unregister('makerThresholdEdit');
  renderMakerSettings();
}

async function onMakerSaveThreshold() {
  var input = document.getElementById('mkThresholdInput');
  if (!input) return;
  var parsed = parseFloat(input.value);
  if (isNaN(parsed) || parsed < 0 || parsed > 100) {
    showToast('Threshold must be between 0 and 100', true);
    input.focus();
    return;
  }
  try {
    await MastDB.set('admin/config/makerSettings/repricingThresholdPct', parsed);
    window.__mastMakerSettings.repricingThresholdPct = parsed;
    window.__mkThresholdEditMode = false;
    if (window.MastDirty) MastDirty.unregister('makerThresholdEdit');
    showToast('Repricing threshold saved: ' + parsed + '%');
    renderMakerSettings();
  } catch (err) {
    showToast('Save failed: ' + (err.message || err), true);
  }
}

  // ── Exports for the eager dispatcher + the panel's onclick/onchange targets.
  window.loadMakerSettings = loadMakerSettings;
  window.onMakerToggleTrackMat = onMakerToggleTrackMat;
  window.onMakerCadenceChange = onMakerCadenceChange;
  window.onMakerRunRecalcNow = onMakerRunRecalcNow;
  window.onMakerSeverityChange = onMakerSeverityChange;
  window.onMakerResetSeverity = onMakerResetSeverity;
  window.onMakerEnterThresholdEdit = onMakerEnterThresholdEdit;
  window.onMakerCancelThreshold = onMakerCancelThreshold;
  window.onMakerSaveThreshold = onMakerSaveThreshold;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('maker-settings', {});
  }
})();
