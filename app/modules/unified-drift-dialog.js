/**
 * Unified drift dialog — the admin "Review drift" modal that groups a product's
 * cross-channel drift alerts by channel and renders per-channel diff cards with
 * Overwrite/Accept/Dismiss actions.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager openUnifiedDriftDialog shim in
 * index.html (the surface's only opener is a generated "Review drift" onclick
 * button). renderUnifiedDriftDialogCard is a private helper called only by the
 * dialog — moved verbatim alongside it.
 *
 * Reads eager shell globals: window.__mastDriftAlerts, window.__mastChannelsCache,
 * showToast, loadAdminChannels, loadDriftSeverity, loadUnifiedSyncRules,
 * resolveDriftChannel, maxSeverity, phase4SeverityVisual, driftChannelLabel,
 * getFieldSeverity, MAST_PHASE4_FIELD_LABELS, esc. The per-card action onclicks
 * reference the SHARED eager globals overwriteChannelFromDrift / acceptChannelEdits
 * / dismissDriftAlert (also called by the drift-review queue) — those stay in the
 * shell. All globals are defined at boot, long before this lazy module loads.
 * Logic moved VERBATIM (behavior-preserving).
 */
(function () {
  'use strict';

async function openUnifiedDriftDialog(pid) {
  var alerts = window.__mastDriftAlerts[pid] || [];
  if (!alerts.length) { showToast('No drift to review'); return; }
  // Warm caches if a tab jumped straight to the banner without visiting the
  // drift queue first.
  await Promise.all([
    new Promise(function(resolve) { loadAdminChannels(resolve); }),
    loadDriftSeverity(),
    loadUnifiedSyncRules()
  ]);

  var channelsCache = window.__mastChannelsCache || {};
  var groups = {}; var order = [];
  alerts.forEach(function(d) {
    var resolved = resolveDriftChannel(d, channelsCache);
    var key = resolved.channelId || ('legacy:' + (resolved.legacyPlatform || 'unknown'));
    if (!groups[key]) { groups[key] = { resolved: resolved, drifts: [] }; order.push(key); }
    groups[key].drifts.push(d);
  });
  // Sort channels by max severity, then by count desc
  order.sort(function(a, b) {
    var rank = { critical: 3, warning: 2, info: 1 };
    var aFields = []; groups[a].drifts.forEach(function(d) { (d.diffs || []).forEach(function(df) { if (df.field && aFields.indexOf(df.field) === -1) aFields.push(df.field); }); });
    var bFields = []; groups[b].drifts.forEach(function(d) { (d.diffs || []).forEach(function(df) { if (df.field && bFields.indexOf(df.field) === -1) bFields.push(df.field); }); });
    return (rank[maxSeverity(bFields)] || 0) - (rank[maxSeverity(aFields)] || 0);
  });

  // Build overlay + modal. Uses the modal CSS tokens from mast-ux-widgets.
  var existing = document.getElementById('unifiedDriftDialog');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'unifiedDriftDialog';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'unifiedDriftDialogTitle');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow-y:auto;';
  overlay.addEventListener('click', function(ev) { if (ev.target === overlay) overlay.remove(); });

  var cards = order.map(function(k) { return renderUnifiedDriftDialogCard(pid, groups[k]); }).join('');
  var bodyHtml =
    '<div class="modal" style="background:var(--cream);border-radius:10px;max-width:720px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,0.2);padding:20px 24px;max-height:90vh;overflow-y:auto;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;">' +
        '<div>' +
          '<h3 id="unifiedDriftDialogTitle" style="margin:0;font-size:1.15rem;font-weight:600;">Drift across ' + MastFormat.countNoun(order.length, 'channel') + '</h3>' +
          '<p style="margin:4px 0 0;font-size:0.78rem;color:var(--warm-gray);">Review per-channel diffs and pick an action. Rules can be updated in the Rules tab.</p>' +
        '</div>' +
        '<button class="btn btn-secondary btn-small" aria-label="Close" onclick="document.getElementById(\'unifiedDriftDialog\').remove()">Close</button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:12px;">' + cards + '</div>' +
    '</div>';
  overlay.innerHTML = bodyHtml;
  document.body.appendChild(overlay);

  // Esc key closes
  function escHandler(ev) {
    if (ev.key === 'Escape') {
      var n = document.getElementById('unifiedDriftDialog');
      if (n) n.remove();
      document.removeEventListener('keydown', escHandler);
    }
  }
  document.addEventListener('keydown', escHandler);
}

function renderUnifiedDriftDialogCard(pid, group) {
  var resolved = group.resolved;
  var drifts = group.drifts;
  var fields = [];
  drifts.forEach(function(d) { (d.diffs || []).forEach(function(df) { if (df.field && fields.indexOf(df.field) === -1) fields.push(df.field); }); });
  var sev = maxSeverity(fields);
  var v = phase4SeverityVisual(sev);
  var platformStr = (resolved.channel && (resolved.channel.platform || resolved.channel.externalPlatform)) || resolved.legacyPlatform || '';

  var html = '';
  html += '<div class="unified-drift-card" style="border:1px solid ' + v.border + ';border-left-width:4px;border-radius:8px;padding:12px 16px;background:var(--cream);box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;flex-wrap:wrap;">';
  html += '<div>';
  html += '<div style="font-size:1.0rem;font-weight:500;">' + esc(driftChannelLabel(resolved)) + '</div>';
  if (platformStr) {
    html += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;">' + esc(platformStr) + '</div>';
  }
  html += '</div>';
  html += '<span class="status-badge pill" style="background:' + v.border + ';color:white;">' + esc(sev) + '</span>';
  html += '</div>';

  // Per-drift diff blocks
  drifts.forEach(function(d) {
    var detDate = d.detectedAt ? new Date(d.detectedAt).toLocaleString() : '';
    html += '<div style="border-top:1px dashed var(--cream-dark);padding-top:10px;margin-top:10px;">';
    html += '<div style="font-size:0.72rem;color:var(--warm-gray);margin-bottom:6px;">Detected ' + esc(detDate) + ' \u00b7 drift id ' + esc(d.driftId) + '</div>';
    (d.diffs || []).forEach(function(df) {
      var fieldSev = getFieldSeverity(df.field);
      var fv = phase4SeverityVisual(fieldSev);
      var mastVal = (df.mast !== undefined) ? df.mast : df.mastValue;
      var chanVal = (df.shopify !== undefined) ? df.shopify : (df.channelValue !== undefined ? df.channelValue : df.squareValue);
      html += '<div style="margin:6px 0;">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">';
      html += '<strong style="font-size:0.85rem;">' + esc(MAST_PHASE4_FIELD_LABELS[df.field] || df.field) + '</strong>';
      html += '<span class="status-badge" style="background:' + fv.bg + ';color:' + fv.label + ';">' + esc(fieldSev) + '</span>';
      html += '</div>';
      html += '<div style="font-size:0.78rem;padding:6px 8px;border-radius:4px;background:rgba(42,124,111,0.25);border-left:3px solid var(--teal);word-break:break-word;white-space:pre-wrap;margin-bottom:4px;">';
      html += '<span style="color:var(--warm-gray);font-size:0.72rem;">Mast (source of truth):</span><br>' + esc(String(mastVal == null ? '' : mastVal));
      html += '</div>';
      html += '<div style="font-size:0.78rem;padding:6px 8px;border-radius:4px;background:' + fv.bg + ';border-left:3px solid ' + fv.border + ';word-break:break-word;white-space:pre-wrap;">';
      html += '<span style="color:var(--warm-gray);font-size:0.72rem;">Channel (changed):</span><br>' + esc(String(chanVal == null ? '' : chanVal));
      html += '</div>';
      html += '</div>';
    });
    // Per-drift action buttons — dispatch to channel-aware handlers.
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">';
    html += '<button class="btn btn-secondary btn-small" onclick="overwriteChannelFromDrift(\'' + esc(pid) + '\',\'' + esc(d.driftId) + '\',\'' + esc(platformStr) + '\')">Overwrite Channel</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="acceptChannelEdits(\'' + esc(pid) + '\',\'' + esc(d.driftId) + '\',\'' + esc(platformStr) + '\')">Accept Channel Edits</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="dismissDriftAlert(\'' + esc(d.driftId) + '\',\'' + esc(pid) + '\')">Dismiss</button>';
    html += '</div>';
    html += '</div>';
  });

  html += '</div>';
  return html;
}

  // Impl for the eager shim; the dialog's only external opener is a generated onclick.
  window.openUnifiedDriftDialogImpl = openUnifiedDriftDialog;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('unifiedDriftDialog', {});
  }
})();
