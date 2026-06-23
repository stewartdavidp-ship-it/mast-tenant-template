/**
 * Shopify dev/test harness — the read-only coverage harness + the Phase 2–8
 * write/revert integration tests + seed/cleanup of sample products, plus their
 * report builders.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §1,
 * Track 1 — recipe B, a self-contained dev/test surface). This is a settings-page
 * dev harness invoked from static onclick="runShopifyN()" buttons; it has no
 * route. Lazy-loaded on demand via the eager runShopifyHarness / runShopifySeed /
 * runShopifyCleanup / runShopifyPhase2..8 shims in index.html.
 *
 * Reads eager shell globals only (all defined before a user can reach the Shopify
 * settings surface): can, showToast, mastConfirm, firebase, MastDB, writeAudit,
 * esc. All logic moved VERBATIM (behavior-preserving). The report builders and
 * the generic phase runner are harness-internal (window-exported for the modal
 * onclick targets / cross-references within this module).
 */
(function () {
  'use strict';

// ============================================================
// Shopify Test Harness — Phase 1 (read-only)
// ============================================================
async function runShopifyHarness() {
  if (!can('settings', 'edit')) { showToast('You do not have permission to run the harness.', true); return; }
  var btn = document.getElementById('shopifyHarnessRunBtn');
  var statusEl = document.getElementById('shopifyHarnessStatus');
  var reportEl = document.getElementById('shopifyHarnessReport');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-small"></span> Running…'; }
  if (statusEl) statusEl.textContent = 'Calling Shopify API…';
  if (reportEl) reportEl.innerHTML = '';

  try {
    var result = await firebase.functions().httpsCallable('shopifyHarnessRun')({
      tenantId: MastDB.tenantId()
    });
    var data = result.data || {};
    await writeAudit('update', 'settings', 'shopifyHarnessRun:' + (data.runId || ''));

    if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">&#10003; Run complete — ' + data.summary.passed + ' passed, ' + data.summary.failed + ' failed</span>';
    renderShopifyHarnessReport(data);
    showToast('Harness complete: ' + data.summary.passed + '/' + data.summary.totalReads + ' reads OK');
  } catch (err) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">&#10007; ' + esc(err.message || 'Unknown error') + '</span>';
    showToast('Harness failed: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Run Read-Only Harness'; }
  }
}

async function runShopifySeed() {
  if (!can('settings', 'edit')) { showToast('You do not have permission to run the seed.', true); return; }
  var confirmed = await mastConfirm(
    'Create 3 sample products (Mast Seed — T-Shirt, Mug, Art Print) in your Shopify store? They will be marked as DRAFT (not visible on the storefront) and tagged "mast-seed-data" so they can be removed later with the Clean Up button. This is a real write to your store.',
    { title: 'Seed sample products?', confirmLabel: 'Seed', cancelLabel: 'Cancel' }
  );
  if (!confirmed) return;

  var btn = document.getElementById('shopifySeedBtn');
  var statusEl = document.getElementById('shopifySeedStatus');
  var reportEl = document.getElementById('shopifySeedReport');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-small"></span> Seeding…'; }
  if (statusEl) statusEl.textContent = 'Creating products in Shopify…';
  if (reportEl) reportEl.innerHTML = '';

  try {
    var result = await firebase.functions().httpsCallable('shopifyHarnessSeedStore')({
      tenantId: MastDB.tenantId()
    });
    var data = result.data || {};
    await writeAudit('create', 'settings', 'shopifyHarnessSeed:' + (data.seedId || ''));
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">&#10003; ' + data.createdCount + ' created, ' + data.failedCount + ' failed</span>';
    renderShopifySeedReport(data, 'created');
    showToast('Seeded ' + data.createdCount + ' sample products');
  } catch (err) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">&#10007; ' + esc(err.message || 'Unknown error') + '</span>';
    showToast('Seed failed: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Seed Sample Products'; }
  }
}

async function runShopifyCleanup() {
  if (!can('settings', 'edit')) { showToast('You do not have permission to run cleanup.', true); return; }
  var confirmed = await mastConfirm(
    'Delete every product in your Shopify store tagged "mast-seed-data"? This cannot be undone — Shopify does not restore deleted products. Only products created by the Mast seed action will be removed.',
    { title: 'Clean up seed data?', confirmLabel: 'Delete', cancelLabel: 'Cancel', danger: true }
  );
  if (!confirmed) return;

  var btn = document.getElementById('shopifyCleanupBtn');
  var statusEl = document.getElementById('shopifySeedStatus');
  var reportEl = document.getElementById('shopifySeedReport');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-small"></span> Cleaning…'; }
  if (statusEl) statusEl.textContent = 'Finding and deleting seed products…';
  if (reportEl) reportEl.innerHTML = '';

  try {
    var result = await firebase.functions().httpsCallable('shopifyHarnessCleanupSeed')({
      tenantId: MastDB.tenantId()
    });
    var data = result.data || {};
    await writeAudit('delete', 'settings', 'shopifyHarnessCleanup:' + (data.cleanupId || ''));
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">&#10003; ' + data.deletedCount + ' deleted, ' + data.failedCount + ' failed</span>';
    renderShopifySeedReport(data, 'deleted');
    showToast('Cleaned up ' + data.deletedCount + ' seed products');
  } catch (err) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">&#10007; ' + esc(err.message || 'Unknown error') + '</span>';
    showToast('Cleanup failed: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Clean Up Seed Data'; }
  }
}

function renderShopifySeedReport(data, kind) {
  var reportEl = document.getElementById('shopifySeedReport');
  if (!reportEl || !data) return;
  var list = (kind === 'created' ? data.created : data.deleted) || [];
  var fails = data.failed || [];
  var html = '';
  html += '<div style="background:var(--cream,#faf8f5);border:1px solid #e8e0d4;border-radius:8px;padding:12px 14px;font-size:0.85rem;">';
  if (list.length > 0) {
    html += '<div style="font-weight:600;margin-bottom:6px;color:var(--teal);">' + (kind === 'created' ? '&#10003; Created' : '&#10003; Deleted') + ' ' + MastFormat.countNoun(list.length, 'product') + '</div>';
    html += '<ul style="margin:0;padding-left:20px;">';
    list.forEach(function(p) {
      html += '<li><code style="font-size:0.78rem;">' + esc(p.id || '') + '</code> — ' + esc(p.title || '') + (p.variantCount != null ? ' <span style="color:var(--warm-gray);">(' + MastFormat.countNoun(p.variantCount, 'variant') + ')</span>' : '') + '</li>';
    });
    html += '</ul>';
  } else {
    html += '<div style="color:var(--warm-gray);">No ' + (kind === 'created' ? 'products created' : 'products found to delete') + '.</div>';
  }
  if (fails.length > 0) {
    html += '<div style="margin-top:10px;font-weight:600;color:#ef4444;">&#10007; ' + fails.length + ' failed</div>';
    html += '<ul style="margin:4px 0 0;padding-left:20px;">';
    fails.forEach(function(f) {
      html += '<li>' + esc(f.title || f.id || '?') + ' — <span style="color:#ef4444;">' + esc(f.error || 'unknown') + '</span></li>';
    });
    html += '</ul>';
  }
  html += '</div>';
  reportEl.innerHTML = html;
}

async function runShopifyPhase2() {
  if (!can('settings', 'edit')) { showToast('You do not have permission to run Phase 2.', true); return; }
  var confirmed = await mastConfirm(
    'Run Phase 2 write/revert test? This creates a metafield on one of your seed products, verifies it, then deletes it. Every step is audited. If any step fails, the run halts and a recovery report is written with the original data so you can restore by hand.',
    { title: 'Run Phase 2?', confirmLabel: 'Run', cancelLabel: 'Cancel' }
  );
  if (!confirmed) return;

  var btn = document.getElementById('shopifyPhase2Btn');
  var statusEl = document.getElementById('shopifyPhase2Status');
  var reportEl = document.getElementById('shopifyPhase2Report');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-small"></span> Running…'; }
  if (statusEl) statusEl.textContent = 'Capturing → writing → verifying → reverting → confirming…';
  if (reportEl) reportEl.innerHTML = '';

  try {
    var result = await firebase.functions().httpsCallable('shopifyHarnessRunPhase2')({
      tenantId: MastDB.tenantId()
    });
    var data = result.data || {};
    await writeAudit('update', 'settings', 'shopifyHarnessPhase2:' + (data.runId || ''));

    if (data.status === 'halted') {
      if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">&#10007; HALTED — ' + esc(data.haltReason || 'unknown') + '</span>';
    } else {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">&#10003; Complete — ' + data.summary.passed + '/' + data.summary.total + ' tests passed</span>';
    }
    renderShopifyPhase2Report(data);
    if (data.hasLeftoverChanges) {
      showToast('CRITICAL: revert failed. Check recovery report.', true);
    } else if (data.status === 'halted') {
      showToast('Phase 2 halted: ' + (data.haltReason || 'unknown'), true);
    } else {
      showToast('Phase 2 complete — all reverts verified');
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">&#10007; ' + esc(err.message || 'Unknown error') + '</span>';
    showToast('Phase 2 failed: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Run Phase 2 (metafields)'; }
  }
}

async function runShopifyPhase3() {
  if (!can('settings', 'edit')) { showToast('You do not have permission to run Phase 3.', true); return; }
  var confirmed = await mastConfirm(
    'Run Phase 3 write/revert test? This updates the seed product\'s title and body_html, verifies, then reverts to the captured pre-state with a full PUT. Every step is audited. If any step fails, the run halts and a recovery report is written with the original data.',
    { title: 'Run Phase 3?', confirmLabel: 'Run', cancelLabel: 'Cancel' }
  );
  if (!confirmed) return;

  var btn = document.getElementById('shopifyPhase3Btn');
  var statusEl = document.getElementById('shopifyPhase3Status');
  var reportEl = document.getElementById('shopifyPhase3Report');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-small"></span> Running…'; }
  if (statusEl) statusEl.textContent = 'Capturing → writing → verifying → reverting → confirming…';
  if (reportEl) reportEl.innerHTML = '';

  try {
    var result = await firebase.functions().httpsCallable('shopifyHarnessRunPhase3')({
      tenantId: MastDB.tenantId()
    });
    var data = result.data || {};
    await writeAudit('update', 'settings', 'shopifyHarnessPhase3:' + (data.runId || ''));

    if (data.status === 'halted') {
      if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">&#10007; HALTED — ' + esc(data.haltReason || 'unknown') + '</span>';
    } else {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">&#10003; Complete — ' + data.summary.passed + '/' + data.summary.total + ' tests passed</span>';
    }
    // Reuse the phase2 report renderer — same shape
    reportEl.innerHTML = buildShopifyPhaseReportHtml(data);
    if (data.hasLeftoverChanges) {
      showToast('CRITICAL: revert failed. Check recovery report.', true);
    } else if (data.status === 'halted') {
      showToast('Phase 3 halted: ' + (data.haltReason || 'unknown'), true);
    } else {
      showToast('Phase 3 complete — all reverts verified');
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">&#10007; ' + esc(err.message || 'Unknown error') + '</span>';
    showToast('Phase 3 failed: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Run Phase 3 (product content)'; }
  }
}

// Generic handler for Phases 4–8. All share the same UI flow and report shape.
async function runShopifyGenericPhase(cfg) {
  if (!can('settings', 'edit')) { showToast('You do not have permission to run ' + cfg.phaseLabel + '.', true); return; }
  var confirmed = await mastConfirm(cfg.confirmText, {
    title: 'Run ' + cfg.phaseLabel + '?', confirmLabel: 'Run', cancelLabel: 'Cancel'
  });
  if (!confirmed) return;

  var btn = document.getElementById(cfg.btnId);
  var statusEl = document.getElementById(cfg.statusId);
  var reportEl = document.getElementById(cfg.reportId);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-small"></span> Running…'; }
  if (statusEl) statusEl.textContent = 'Capturing → writing → verifying → reverting → confirming…';
  if (reportEl) reportEl.innerHTML = '';

  try {
    var result = await firebase.functions().httpsCallable(cfg.callable)({
      tenantId: MastDB.tenantId()
    });
    var data = result.data || {};
    await writeAudit('update', 'settings', cfg.callable + ':' + (data.runId || ''));

    if (data.status === 'halted') {
      if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">&#10007; HALTED — ' + esc(data.haltReason || 'unknown') + '</span>';
    } else {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">&#10003; Complete — ' + data.summary.passed + '/' + data.summary.total + ' tests passed</span>';
    }
    if (reportEl) reportEl.innerHTML = buildShopifyPhaseReportHtml(data);
    if (data.hasLeftoverChanges) {
      showToast('CRITICAL: revert failed. Check recovery report.', true);
    } else if (data.status === 'halted') {
      showToast(cfg.phaseLabel + ' halted: ' + (data.haltReason || 'unknown'), true);
    } else {
      showToast(cfg.phaseLabel + ' complete — all reverts verified');
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">&#10007; ' + esc(err.message || 'Unknown error') + '</span>';
    showToast(cfg.phaseLabel + ' failed: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = cfg.btnLabel; }
  }
}

function runShopifyPhase4() {
  return runShopifyGenericPhase({
    phaseLabel: 'Phase 4',
    callable: 'shopifyHarnessRunPhase4',
    btnId: 'shopifyPhase4Btn',
    btnLabel: 'Run Phase 4 (variant price)',
    statusId: 'shopifyPhase4Status',
    reportId: 'shopifyPhase4Report',
    confirmText: 'Run Phase 4 write/revert test? Captures the first seed variant\'s price + related fields, bumps price by $1, verifies, then PUTs every tracked field back to the captured values. Halts on any anomaly and writes a recovery report.'
  });
}

function runShopifyPhase5() {
  return runShopifyGenericPhase({
    phaseLabel: 'Phase 5',
    callable: 'shopifyHarnessRunPhase5',
    btnId: 'shopifyPhase5Btn',
    btnLabel: 'Run Phase 5 (inventory delta)',
    statusId: 'shopifyPhase5Status',
    reportId: 'shopifyPhase5Report',
    confirmText: 'Run Phase 5 write/revert test? Adjusts the first seed variant\'s inventory +1 at the primary location, verifies, then adjusts −1 and confirms the level matches the captured pre-state. Delta-based so it\'s race-safe. Halts on any anomaly.'
  });
}

function runShopifyPhase6() {
  return runShopifyGenericPhase({
    phaseLabel: 'Phase 6',
    callable: 'shopifyHarnessRunPhase6',
    btnId: 'shopifyPhase6Btn',
    btnLabel: 'Run Phase 6 (image add/delete)',
    statusId: 'shopifyPhase6Status',
    reportId: 'shopifyPhase6Report',
    confirmText: 'Run Phase 6 write/revert test? Uploads a tiny hermetic 1×1 PNG to the seed product, verifies it appeared in the image list, then deletes it and confirms the image list is back to the captured state. Halts on any anomaly.'
  });
}

function runShopifyPhase7() {
  return runShopifyGenericPhase({
    phaseLabel: 'Phase 7',
    callable: 'shopifyHarnessRunPhase7',
    btnId: 'shopifyPhase7Btn',
    btnLabel: 'Run Phase 7 (product lifecycle)',
    statusId: 'shopifyPhase7Status',
    reportId: 'shopifyPhase7Report',
    confirmText: 'Run Phase 7 write/revert test? Creates a throwaway draft product (NOT a seed — brand new), verifies it exists, deletes it, confirms the GET returns 404. This is the highest-risk write path. Halts on any anomaly and writes a recovery report.'
  });
}

function runShopifyPhase8() {
  return runShopifyGenericPhase({
    phaseLabel: 'Phase 8',
    callable: 'shopifyHarnessRunPhase8',
    btnId: 'shopifyPhase8Btn',
    btnLabel: 'Run Phase 8 (webhook)',
    statusId: 'shopifyPhase8Status',
    reportId: 'shopifyPhase8Report',
    confirmText: 'Run Phase 8 write/revert test? Creates a products/update webhook pointing at example.com/mast-harness-test, verifies it appeared in the webhook list, deletes it, confirms the list is back to the captured pre-state. Shop-level — isolated from product data. Halts on any anomaly.'
  });
}

// Shared HTML builder used by Phase 2 and Phase 3 reports.
function buildShopifyPhaseReportHtml(data) {
  if (!data) return '';
  var html = '';
  html += '<div style="background:var(--cream,#faf8f5);border:1px solid #e8e0d4;border-radius:8px;padding:14px;font-size:0.85rem;">';
  html += '<div style="font-weight:600;margin-bottom:6px;">Run ID: <code>' + esc(data.runId || '') + '</code></div>';
  if (data.targetProduct) {
    html += '<div style="margin-bottom:10px;color:var(--warm-gray);">Target: ' + esc(data.targetProduct.title || '') + ' <code style="font-size:0.78rem;">' + esc(data.targetProduct.id || '') + '</code></div>';
  }
  if (data.trackedFields) {
    html += '<div style="margin-bottom:10px;color:var(--warm-gray);font-size:0.78rem;">Tracked fields: ' + data.trackedFields.map(function(f){return '<code>' + esc(f) + '</code>';}).join(', ') + '</div>';
  }
  if (data.hasLeftoverChanges) {
    html += '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.35);border-radius:6px;padding:10px 12px;margin-bottom:10px;">';
    html += '<div style="color:#ef4444;font-weight:700;">&#9888; CRITICAL: Revert Failed</div>';
    html += '<div style="margin-top:4px;">Data in your Shopify store was modified and could not be automatically reverted. Check <code>admin/shopifyHarness/runs/' + esc(data.runId || '') + '/recoveryReport</code> for the captured state to restore by hand.</div>';
    html += '</div>';
  } else if (data.status === 'halted') {
    html += '<div style="color:#f59e0b;margin-bottom:10px;">Halted: ' + esc(data.haltReason || 'unknown') + '</div>';
  }
  html += '<table style="width:100%;border-collapse:collapse;">';
  html += '<thead><tr style="border-bottom:1px solid #e8e0d4;">';
  html += '<th style="text-align:left;padding:6px 8px;">Test</th>';
  html += '<th style="text-align:left;padding:6px 8px;">Status</th>';
  html += '<th style="text-align:left;padding:6px 8px;">Detail</th>';
  html += '</tr></thead><tbody>';
  (data.tests || []).forEach(function(t) {
    var color = t.ok ? 'var(--teal)' : '#ef4444';
    var symbol = t.ok ? '&#10003;' : '&#10007;';
    html += '<tr style="border-bottom:1px solid #f0ebe0;">';
    html += '<td style="padding:6px 8px;">' + esc(t.name || '') + '</td>';
    html += '<td style="padding:6px 8px;color:' + color + ';">' + symbol + ' ' + (t.ok ? 'passed' : 'failed') + '</td>';
    html += '<td style="padding:6px 8px;color:var(--warm-gray);">' + esc(t.correlationId || t.error || '') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += '<div style="margin-top:10px;font-size:0.78rem;color:var(--warm-gray);">Full audit: <code>admin/shopifyHarness/runs/' + esc(data.runId || '') + '/events</code></div>';
  html += '</div>';
  return html;
}

function renderShopifyPhase2Report(data) {
  var reportEl = document.getElementById('shopifyPhase2Report');
  if (!reportEl || !data) return;
  reportEl.innerHTML = buildShopifyPhaseReportHtml(data);
}

function renderShopifyHarnessReport(data) {
  var reportEl = document.getElementById('shopifyHarnessReport');
  if (!reportEl || !data || !data.matrix) return;
  var rows = Object.keys(data.matrix).sort();
  var html = '';
  html += '<div style="background:var(--cream,#faf8f5);border:1px solid #e8e0d4;border-radius:8px;padding:16px;">';
  html += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:10px;">Coverage Matrix</div>';
  html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:12px;">Run ID: <code>' + esc(data.runId || '') + '</code></div>';
  html += '<div style="overflow-x:auto;">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  html += '<thead><tr style="border-bottom:1px solid #e8e0d4;">';
  html += '<th style="text-align:left;padding:6px 8px;">Resource</th>';
  html += '<th style="text-align:left;padding:6px 8px;">Status</th>';
  html += '<th style="text-align:right;padding:6px 8px;">Count</th>';
  html += '<th style="text-align:right;padding:6px 8px;">Time</th>';
  html += '<th style="text-align:left;padding:6px 8px;">Note</th>';
  html += '</tr></thead><tbody>';
  rows.forEach(function(resource) {
    var r = data.matrix[resource];
    var statusColor = r.ok ? 'var(--teal)' : '#ef4444';
    var statusSymbol = r.ok ? '&#10003; ' + r.status : '&#10007; ' + (r.status || r.error || 'fail');
    html += '<tr style="border-bottom:1px solid #f0ebe0;">';
    html += '<td style="padding:6px 8px;font-family:monospace;font-size:0.78rem;">' + esc(resource) + '</td>';
    html += '<td style="padding:6px 8px;color:' + statusColor + ';">' + statusSymbol + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-family:monospace;">' + (r.count != null ? r.count : '—') + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-family:monospace;color:var(--warm-gray);">' + (r.durationMs != null ? r.durationMs + 'ms' : '—') + '</td>';
    html += '<td style="padding:6px 8px;color:var(--warm-gray);font-size:0.78rem;">' + esc(r.note || '') + (r.error ? ' — <span style="color:#ef4444;">' + esc(r.error) + '</span>' : '') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += '</div>';
  html += '<div style="margin-top:10px;font-size:0.78rem;color:var(--warm-gray);">Full audit trail: <code>' + esc(MastDB.tenantId()) + '/admin/shopifyHarness/runs/' + esc(data.runId || '') + '/events</code></div>';
  html += '</div>';
  reportEl.innerHTML = html;
}

  // Impls for the eager shims (static onclick buttons) — *Impl suffix so the
  // shim name and the export never collide.
  window.runShopifyHarnessImpl = runShopifyHarness;
  window.runShopifySeedImpl = runShopifySeed;
  window.runShopifyCleanupImpl = runShopifyCleanup;
  window.runShopifyPhase2Impl = runShopifyPhase2;
  window.runShopifyPhase3Impl = runShopifyPhase3;
  window.runShopifyPhase4Impl = runShopifyPhase4;
  window.runShopifyPhase5Impl = runShopifyPhase5;
  window.runShopifyPhase6Impl = runShopifyPhase6;
  window.runShopifyPhase7Impl = runShopifyPhase7;
  window.runShopifyPhase8Impl = runShopifyPhase8;

  // Harness-internal helpers + report builders (referenced within this module).
  window.renderShopifyHarnessReport = renderShopifyHarnessReport;
  window.renderShopifySeedReport = renderShopifySeedReport;
  window.renderShopifyPhase2Report = renderShopifyPhase2Report;
  window.buildShopifyPhaseReportHtml = buildShopifyPhaseReportHtml;
  window.runShopifyGenericPhase = runShopifyGenericPhase;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('shopifyHarness', {});
  }
})();
