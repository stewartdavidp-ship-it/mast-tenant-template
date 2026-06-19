/**
 * Forecast "New Production Job" modal — the dialog opened from the Forecast
 * demand table's "Create production job" affordance, plus the worktype/purpose
 * submit handler that mints the job.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager openForecastJobModal /
 * doCreateForecastJob shims in index.html. The Forecast surface drives these
 * through a delegated [data-create-job-pid] click handler (left eager in the
 * shell); products-v2.js also calls window.openForecastJobModal from its
 * Forecast tab — hence the recipe-B eager shims.
 *
 * Reads eager shell globals: productsData, esc, openModal, closeModal, can,
 * validateRequired, showToast, writeAudit, MastDB. Also reads production.js's
 * PURPOSE_LABELS + viewProductionJob as runtime globals — production.js is
 * route-loaded (routes: jobs/production/forecast) on every surface from which
 * this modal is reachable, so they are always present when these run (unchanged
 * from the pre-extraction shell behavior). Logic moved VERBATIM.
 */
(function () {
  'use strict';

function openForecastJobModal(pid, suggestedQty) {
  var product = productsData.find(function(p) { return p.pid === pid; });
  var name = product ? product.name : pid;
  var purposeButtons = Object.keys(PURPOSE_LABELS).map(function(key) {
    // W1-followup OPEN -OtEkpFjIRwH_z-1CJuB: data-attrs + delegated handler.
    // The delegated listener branches on the presence of data-create-job-purpose
    // — with it → doCreateForecastJob(pid, qty, purpose); without it →
    // openForecastJobModal(pid, qty).
    return '<button class="btn btn-secondary" style="font-size:0.85rem;padding:8px 14px;margin:4px;" data-create-job-pid="' + esc(pid) + '" data-create-job-qty="' + suggestedQty + '" data-create-job-purpose="' + esc(key) + '">' +
      PURPOSE_LABELS[key] + '</button>';
  }).join('');
  var html = '<div style="max-width:450px;padding:24px;">' +
    '<h3>New Production Job</h3>' +
    '<div class="form-group">' +
      '<label class="field-required">Job Name</label>' +
      '<input type="text" id="newJobName" value="Build ' + esc(name) + ' (' + suggestedQty + ' pcs)">' +
    '</div>' +
    '<div class="form-group">' +
      '<label>Work Type</label>' +
      '<select id="forecastJobWorkType" style="width:100%;">' +
        '<option value="flameshop">Flameshop</option>' +
        '<option value="hotshop">Hotshop</option>' +
        '<option value="hybrid">Hybrid</option>' +
        '<option value="other">Other</option>' +
      '</select>' +
    '</div>' +
    '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Suggested: ' + suggestedQty + ' pieces of ' + esc(name) + '</div>' +
    '<div class="form-group">' +
      '<label>Purpose</label>' +
      '<div style="display:flex;flex-wrap:wrap;gap:0;">' + purposeButtons + '</div>' +
    '</div>' +
    '<div style="margin-top:16px;text-align:right;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

async function doCreateForecastJob(pid, suggestedQty, purpose) {
  if (!can('jobs', 'edit')) {
    showToast('You do not have permission to create production jobs.', true);
    return;
  }
  var nameInput = document.getElementById('newJobName');
  var name = nameInput ? nameInput.value.trim() : '';
  if (!validateRequired([{ el: 'newJobName', msg: 'Job name is required' }])) {
    showToast('Enter a job name', true); return;
  }
  try {
    var workTypeEl = document.getElementById('forecastJobWorkType');
    var workType = workTypeEl ? workTypeEl.value : 'flameshop';
    var product = productsData.find(function(p) { return p.pid === pid; });
    var jobId = MastDB.productionJobs.newKey();
    var lineItemId = MastDB.productionJobs.newLineItemKey(jobId);
    await MastDB.productionJobs.set(jobId, {
      name: name,
      description: 'Auto-suggested from Forecast view',
      purpose: purpose,
      workType: workType,
      priority: 'medium',
      status: 'definition',
      deadline: null,
      eventName: null,
      orderId: null,
      customerId: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      lineItems: {}
    });
    await MastDB.productionJobs.setLineItem(jobId, lineItemId, {
      productId: pid,
      productName: product ? product.name : pid,
      targetQuantity: suggestedQty,
      completedQuantity: 0,
      notes: ''
    });
    await writeAudit('create', 'jobs', jobId);
    closeModal();
    viewProductionJob(jobId);
    showToast('Job created with ' + suggestedQty + ' ' + (product ? product.name : '') + ' pre-added');
  } catch (err) {
    showToast('Error creating job: ' + err.message, true);
  }
}

  // Impls for the eager shims (recipe B) + the modal's submit handler.
  window.openForecastJobModalImpl = openForecastJobModal;
  window.doCreateForecastJobImpl = doCreateForecastJob;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('forecastJobModal', {});
  }
})();
