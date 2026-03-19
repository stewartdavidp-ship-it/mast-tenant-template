/**
 * Production Module — Production System, Build Tracking, Stories
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var productionLoaded = false;
  var selectedProductionJobId = null;
  var productionSubView = 'jobs';
  var activeBuildId = null;
  var storiesData = {};
  var storiesLoaded = false;
  var storiesListener = null;
  var selectedStoryId = null;
  var currentBuildMedia = {};
  var storyDraft = null;
  var storyCurationJobId = null;
  var _lkApiKeyCache = null;
  var LK_API_URL = 'https://labelkeeper-api-1075204398975.us-central1.run.app';

// ============================================================
// PRODUCTION SYSTEM
// ============================================================

var PURPOSE_LABELS = {
  'inventory-event': '🎪 Event Inventory',
  'inventory-general': '📦 General Inventory',
  'fulfillment': '📋 Fulfillment',
  'custom': '✨ Custom',
  'wholesale': '🏪 Wholesale',
  'experimental': '🧪 Experimental'
};

var PURPOSE_COLORS = {
  'fulfillment': { bg: 'rgba(196,133,60,0.2)', color: '#FFB74D', border: 'rgba(196,133,60,0.35)' },
  'custom': { bg: 'rgba(42,124,111,0.2)', color: '#4DB6AC', border: 'rgba(42,124,111,0.35)' },
  'inventory-general': { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' },
  'inventory-event': { bg: 'rgba(123,31,162,0.2)', color: '#CE93D8', border: 'rgba(123,31,162,0.35)' },
  'wholesale': { bg: 'rgba(21,101,192,0.2)', color: '#64B5F6', border: 'rgba(21,101,192,0.35)' },
  'experimental': { bg: 'rgba(85,139,47,0.2)', color: '#AED581', border: 'rgba(85,139,47,0.35)' }
};

function purposeBadgeStyle(purpose) {
  var c = PURPOSE_COLORS[purpose];
  if (!c) return '';
  return 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
}

var PROD_JOB_TRANSITIONS = {
  definition: ['in-progress', 'on-hold', 'cancelled'],
  'in-progress': ['completed', 'on-hold', 'cancelled'],
  'on-hold': ['in-progress', 'cancelled'],
  completed: [],
  cancelled: []
};

function loadProduction() {
  productionLoaded = true;
  // Attach jobs listener
  if (!productionJobsListener) {
    productionJobsListener = MastDB.productionJobs.listen(100, function(snap) {
      productionJobs = snap.val() || {};
      renderProductionJobs();
      if (selectedProductionJobId) renderProductionJobDetail(selectedProductionJobId);
    }, function(err) {
      showToast('Error loading production jobs: ' + err.message, true);
    });
  }
  // Attach operators listener
  if (!operatorsListener) {
    operatorsListener = MastDB.operators.listen(50, function(snap) {
      operators = snap.val() || {};
    });
  }
  renderProductionQueue();
  renderProductionJobs();
  updateQueueBadge();
  // Show Forecast tab for Owner/Manager only (not Staff)
  var forecastBtn = document.getElementById('prodSubForecast');
  if (forecastBtn) {
    forecastBtn.style.display = hasPermission('forecast', 'read') ? '' : 'none';
  }
}


function renderPendingRequestsBanner() {
  var banner = document.getElementById('pendingRequestsBanner');
  if (!banner) return;
  var count = Object.keys(productionRequests).filter(function(k) {
    return productionRequests[k].status === 'pending';
  }).length;
  banner.style.display = count > 0 ? '' : 'none';
  updateQueueBadge();
  renderProductionQueue();
}

function togglePendingRequests() {
  var content = document.getElementById('pendingRequestsContent');
  var arrow = document.getElementById('pendingRequestsArrow');
  if (!content) return;
  var isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
}

function updateQueueBadge() {
  var badge = document.getElementById('queueBadge');
  if (!badge) return;
  var count = Object.keys(productionRequests).filter(function(k) {
    return productionRequests[k].status === 'pending';
  }).length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline' : 'none';
}

// ---- Production Queue ----
function renderProductionQueue() {
  var listEl = document.getElementById('productionQueueList');
  var emptyEl = document.getElementById('productionQueueEmpty');
  if (!listEl) return;
  var pending = Object.keys(productionRequests).filter(function(k) {
    return productionRequests[k].status === 'pending';
  }).sort(function(a, b) {
    var pa = productionRequests[a].priority === 'urgent' ? 0 : 1;
    var pb = productionRequests[b].priority === 'urgent' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (productionRequests[a].createdAt || '').localeCompare(productionRequests[b].createdAt || '');
  });
  updateQueueBadge();
  if (pending.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  var html = '';
  pending.forEach(function(k) {
    var pr = productionRequests[k];
    var ago = getTimeAgo(pr.createdAt);
    var priorityBadge = pr.priority === 'urgent' ? '<span style="background:#C62828;color:white;padding:1px 6px;border-radius:4px;font-size:0.7rem;font-weight:600;">URGENT</span> ' : '';
    html += '<div class="prod-queue-card">' +
      '<div>' +
        priorityBadge +
        '<strong>' + esc(pr.productName || '') + '</strong> x' + (pr.qty || 1) +
        (pr.options ? '<br><span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(Object.values(pr.options).join(', ')) + '</span>' : '') +
        '<br><span style="font-size:0.78rem;color:var(--warm-gray);">Order: ' + esc(pr.orderNumber || pr.orderId || '') + ' &middot; ' + ago + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0;">' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:6px 12px;" onclick="openFulfillModal(\'' + esc(k) + '\', \'' + esc(pr.orderId || '') + '\')">Fulfill</button>' +
        '<button class="btn btn-primary" style="font-size:0.78rem;padding:6px 12px;" onclick="openAssignToJobModal(\'' + esc(k) + '\')">Assign to Job</button>' +
      '</div>' +
    '</div>';
  });
  listEl.innerHTML = html;
}

function getTimeAgo(isoStr) {
  if (!isoStr) return '';
  var diff = Date.now() - new Date(isoStr).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  return days + 'd ago';
}

// ---- Fulfill Modal ----
function openFulfillModal(requestId, orderId) {
  var pr = productionRequests[requestId];
  if (!pr) return;
  var opOptions = getOperatorNames().map(function(name) {
    return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
  }).join('');
  var html = '<div style="max-width:400px;">' +
    '<h3>Fulfill Production Request</h3>' +
    '<p style="margin:8px 0;font-size:0.85rem;color:var(--warm-gray);">' +
      '<strong>' + esc(pr.productName || '') + '</strong> x' + (pr.qty || 1) +
      '<br>Order: ' + esc(pr.orderNumber || '') +
    '</p>' +
    '<div class="form-group">' +
      '<label>Fulfilled By</label>' +
      '<select id="fulfillOperator" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">' +
        '<option value="">Select operator...</option>' +
        opOptions +
      '</select>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>Notes (optional)</label>' +
      '<input type="text" id="fulfillNotes" placeholder="Quick note...">' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="doFulfillRequest(\'' + esc(requestId) + '\', \'' + esc(orderId) + '\')">Fulfill</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

async function doFulfillRequest(requestId, orderId) {
  var operator = document.getElementById('fulfillOperator').value || 'admin';
  var notes = document.getElementById('fulfillNotes').value.trim();
  if (notes) {
    await MastDB.productionRequests.subRef(requestId, 'notes').set(notes);
  }
  await writeAudit('update', 'buildJobs', requestId);
  await fulfillProductionRequest(requestId, orderId, operator);
  closeModal();
  renderProductionQueue();
}

// ---- Assign to Job Modal ----
function openAssignToJobModal(requestId) {
  var pr = productionRequests[requestId];
  if (!pr) return;
  // Get active production jobs for dropdown
  var activeJobs = Object.keys(productionJobs).filter(function(k) {
    var j = productionJobs[k];
    return j.status === 'definition' || j.status === 'in-progress';
  });
  var jobOptions = activeJobs.map(function(k) {
    var j = productionJobs[k];
    return '<option value="' + esc(k) + '">' + esc(j.name || 'Untitled') + ' (' + (j.status || '') + ')</option>';
  }).join('');

  var html = '<div style="max-width:450px;">' +
    '<h3>Assign to Production Job</h3>' +
    '<p style="margin:8px 0;font-size:0.85rem;color:var(--warm-gray);">' +
      '<strong>' + esc(pr.productName || '') + '</strong> x' + (pr.qty || 1) +
      '<br>Order: ' + esc(pr.orderNumber || '') +
    '</p>' +
    '<div style="display:flex;gap:8px;margin:16px 0;">' +
      '<button class="btn btn-primary" style="flex:1;" onclick="doAssignNewJob(\'' + esc(requestId) + '\')">New Job</button>' +
      (activeJobs.length > 0 ? '<button class="btn btn-secondary" style="flex:1;" id="assignExistingBtn" onclick="document.getElementById(\'existingJobSelect\').style.display=\'\'">Existing Job</button>' : '') +
    '</div>' +
    (activeJobs.length > 0 ? '<div id="existingJobSelect" style="display:none;">' +
      '<select id="assignJobDropdown" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;margin-bottom:12px;">' +
        jobOptions +
      '</select>' +
      '<button class="btn btn-primary" onclick="doAssignExistingJob(\'' + esc(requestId) + '\')">Assign</button>' +
    '</div>' : '') +
    '<div style="margin-top:16px;text-align:right;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

async function doAssignNewJob(requestId) {
  var pr = productionRequests[requestId];
  if (!pr) return;
  try {
    // Create new job
    var jobRef = MastDB.productionJobs.ref().push();
    var jobId = jobRef.key;
    var lineItemRef = MastDB.productionJobs.lineItems(jobId).push();
    var lineItemId = lineItemRef.key;
    await jobRef.set({
      name: 'Order ' + (pr.orderNumber || '') + ' - ' + (pr.productName || 'Fulfillment'),
      description: '',
      purpose: 'fulfillment',
      workType: 'flameshop',
      priority: pr.priority === 'urgent' ? 'high' : 'medium',
      status: 'definition',
      deadline: null,
      eventName: null,
      orderId: pr.orderId || null,
      customerId: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null
    });
    await lineItemRef.set({
      productId: pr.productId || null,
      productName: pr.productName || '',
      targetQuantity: pr.qty || 1,
      completedQuantity: 0,
      lossQuantity: 0,
      specifications: pr.options ? Object.values(pr.options).join(', ') : '',
      productionRequestId: requestId
    });
    await writeAudit('create', 'jobs', jobId);
    await assignRequestToJob(requestId, jobId, lineItemId);
    closeModal();
    navigateTo('jobs');
    viewProductionJob(jobId);
    showToast('New job created and request assigned');
  } catch (err) {
    showToast('Error creating job: ' + err.message, true);
  }
}

async function doAssignExistingJob(requestId) {
  var pr = productionRequests[requestId];
  var jobId = document.getElementById('assignJobDropdown').value;
  if (!pr || !jobId) return;
  try {
    var lineItemRef = MastDB.productionJobs.lineItems(jobId).push();
    var lineItemId = lineItemRef.key;
    await lineItemRef.set({
      productId: pr.productId || null,
      productName: pr.productName || '',
      targetQuantity: pr.qty || 1,
      completedQuantity: 0,
      lossQuantity: 0,
      specifications: pr.options ? Object.values(pr.options).join(', ') : '',
      productionRequestId: requestId
    });
    await writeAudit('update', 'jobs', jobId);
    await assignRequestToJob(requestId, jobId, lineItemId);
    closeModal();
    showToast('Request assigned to existing job');
  } catch (err) {
    showToast('Error assigning to job: ' + err.message, true);
  }
}

// ---- Production Jobs List ----
function renderProductionJobs() {
  var listEl = document.getElementById('productionJobsList');
  var emptyEl = document.getElementById('productionJobsEmpty');
  if (!listEl) return;
  var statusFilter = document.getElementById('prodFilterStatus');
  var purposeFilter = document.getElementById('prodFilterPurpose');
  var workTypeFilter = document.getElementById('prodFilterWorkType');
  var sf = statusFilter ? statusFilter.value : 'active';
  var pf = purposeFilter ? purposeFilter.value : 'all';
  var wf = workTypeFilter ? workTypeFilter.value : 'all';

  var jobs = Object.keys(productionJobs).map(function(k) {
    var j = productionJobs[k];
    j._key = k;
    return j;
  }).filter(function(j) {
    if (sf === 'active') return j.status === 'definition' || j.status === 'in-progress';
    if (sf !== 'all') return j.status === sf;
    return true;
  }).filter(function(j) {
    if (pf !== 'all') return j.purpose === pf;
    return true;
  }).filter(function(j) {
    if (wf !== 'all') return j.workType === wf;
    return true;
  });

  // Sort: priority (high first), then deadline
  var priorityOrder = { high: 0, medium: 1, low: 2 };
  jobs.sort(function(a, b) {
    var pa = priorityOrder[a.priority] || 1;
    var pb = priorityOrder[b.priority] || 1;
    if (pa !== pb) return pa - pb;
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  if (jobs.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  var html = '';
  jobs.forEach(function(j) {
    var progress = getJobProgress(j);
    var deadlineHtml = '';
    if (j.deadline) {
      var daysLeft = Math.ceil((new Date(j.deadline) - Date.now()) / 86400000);
      var deadlineColor = daysLeft < 3 ? '#C62828' : daysLeft < 7 ? '#F57F17' : 'var(--warm-gray)';
      deadlineHtml = '<span style="font-size:0.78rem;color:' + deadlineColor + ';">Due: ' + j.deadline + '</span>';
    }
    var orderBadge = j.orderId ? '<span style="font-size:0.72rem;background:var(--cream-dark);padding:1px 6px;border-radius:4px;">Order</span> ' : '';
    html += '<div class="prod-job-card" onclick="viewProductionJob(\'' + esc(j._key) + '\')">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
        '<div style="flex:1;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
            '<span class="prod-priority-dot ' + (j.priority || 'medium') + '"></span>' +
            '<strong style="font-size:0.95rem;">' + esc(j.name || 'Untitled') + '</strong>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
            '<span class="status-badge" style="' + purposeBadgeStyle(j.purpose) + '">' + (PURPOSE_LABELS[j.purpose] || j.purpose || '') + '</span>' +
            '<span class="status-badge prod-status-pill ' + (j.status || '') + '">' + (j.status || '').replace('-', ' ') + '</span>' +
            orderBadge +
            deadlineHtml +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;font-size:0.82rem;color:var(--warm-gray);min-width:60px;">' +
          (progress.total > 0 ? Math.round(progress.pct) + '%' : '') +
        '</div>' +
      '</div>' +
      (progress.total > 0 ? '<div class="prod-progress-bar"><div class="prod-progress-fill" style="width:' + progress.pct + '%;"></div></div>' : '') +
    '</div>';
  });
  listEl.innerHTML = html;
}

function getJobProgress(job) {
  var lineItems = job.lineItems || {};
  var completed = 0;
  var total = 0;
  Object.values(lineItems).forEach(function(li) {
    completed += (li.completedQuantity || 0);
    total += (li.targetQuantity || 0);
  });
  return { completed: completed, total: total, pct: total > 0 ? Math.min(100, (completed / total) * 100) : 0 };
}

// ---- New Job Modal ----
function openNewJobModal() {
  var purposeButtons = Object.keys(PURPOSE_LABELS).map(function(key) {
    return '<button class="btn btn-secondary" style="font-size:0.85rem;padding:8px 14px;margin:4px;" onclick="doCreateJob(\'' + key + '\')">' +
      PURPOSE_LABELS[key] + '</button>';
  }).join('');
  var html = '<div style="max-width:450px;">' +
    '<h3>New Production Job</h3>' +
    '<div class="form-group">' +
      '<label class="field-required">Job Name</label>' +
      '<input type="text" id="newJobName" placeholder="e.g. Spring Craft Fair Prep">' +
    '</div>' +
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

async function doCreateJob(purpose) {
  var nameInput = document.getElementById('newJobName');
  var name = nameInput ? nameInput.value.trim() : '';
  if (!validateRequired([{ el: 'newJobName', msg: 'Job name is required' }])) {
    showToast('Enter a job name', true); return;
  }
  try {
    var jobRef = MastDB.productionJobs.ref().push();
    var jobId = jobRef.key;
    await jobRef.set({
      name: name,
      description: '',
      purpose: purpose,
      workType: 'flameshop',
      priority: 'medium',
      status: 'definition',
      deadline: null,
      eventName: null,
      orderId: null,
      customerId: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null
    });
    await writeAudit('create', 'jobs', jobId);
    closeModal();
    viewProductionJob(jobId);
    showToast('Job created');
    emitTestingEvent('createJob', {});
  } catch (err) {
    showToast('Error creating job: ' + err.message, true);
  }
}

// ---- Production Job Detail ----
function viewProductionJob(jobId) {
  selectedProductionJobId = jobId;
  var jobsView = document.getElementById('productionJobsView');
  var detailView = document.getElementById('productionJobDetail');
  var buildView = document.getElementById('productionBuildView');
  var banner = document.getElementById('pendingRequestsBanner');
  if (jobsView) jobsView.style.display = 'none';
  if (buildView) buildView.style.display = 'none';
  if (banner) banner.style.display = 'none';
  if (detailView) detailView.style.display = '';
  renderProductionJobDetail(jobId);
}

function backToProductionList() {
  selectedProductionJobId = null;
  var jobsView = document.getElementById('productionJobsView');
  var detailView = document.getElementById('productionJobDetail');
  var buildView = document.getElementById('productionBuildView');
  if (detailView) detailView.style.display = 'none';
  if (buildView) buildView.style.display = 'none';
  if (jobsView) jobsView.style.display = '';
  renderPendingRequestsBanner();
}

function renderProductionJobDetail(jobId) {
  var el = document.getElementById('productionJobDetail');
  if (!el) return;
  var job = productionJobs[jobId];
  if (!job) { el.innerHTML = '<p>Job not found.</p>'; return; }

  var status = job.status || 'definition';
  var transitions = PROD_JOB_TRANSITIONS[status] || [];
  var statusBtns = transitions.map(function(t) {
    var btnClass = t === 'cancelled' ? 'btn-danger' : (t === 'completed' ? 'btn-primary' : 'btn-secondary');
    var label = t === 'cancelled' ? '✕ Cancel Job' : t === 'completed' ? '✓ Mark Complete' : t === 'in-progress' ? '▶ Start Work' : t === 'on-hold' ? '⏸ Put On Hold' : t.replace('-', ' ');
    return '<button class="btn ' + btnClass + '" style="font-size:0.78rem;padding:4px 12px;" onclick="transitionProductionJob(\'' + esc(jobId) + '\', \'' + t + '\')">' + label + '</button>';
  }).join(' ');

  // Line items
  var lineItems = job.lineItems || {};
  var liKeys = Object.keys(lineItems);
  var liHtml = '';
  liKeys.forEach(function(k) {
    var li = lineItems[k];
    var pct = li.targetQuantity > 0 ? Math.min(100, Math.round((li.completedQuantity || 0) / li.targetQuantity * 100)) : 0;
    var isEditable = (status === 'in-progress' || status === 'queued');
    liHtml += '<div class="prod-line-item-row">' +
      '<div style="flex:1;">' +
        '<strong>' + esc(li.productName || '') + '</strong>' +
        (li.specifications ? '<br><span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(li.specifications) + '</span>' : '') +
      '</div>' +
      '<div style="text-align:right;font-size:0.82rem;">' +
        (isEditable ?
          '<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;">' +
            '<input type="number" min="0" value="' + (li.completedQuantity || 0) + '" style="width:42px;text-align:center;padding:2px 4px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.82rem;background:var(--cream);" onblur="updateLineItemProgress(\'' + esc(jobId) + '\',\'' + esc(k) + '\',this.value,null)">' +
            '<span style="color:var(--warm-gray);">/ ' + (li.targetQuantity || 0) + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;margin-top:2px;">' +
            '<span style="font-size:0.72rem;color:#C62828;">loss:</span>' +
            '<input type="number" min="0" value="' + (li.lossQuantity || 0) + '" style="width:42px;text-align:center;padding:2px 4px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.75rem;background:var(--cream);" onblur="updateLineItemProgress(\'' + esc(jobId) + '\',\'' + esc(k) + '\',null,this.value)">'  +
          '</div>'
        :
          (li.completedQuantity || 0) + '/' + (li.targetQuantity || 0) +
          (li.lossQuantity > 0 ? ' <span style="color:#C62828;">(-' + li.lossQuantity + ')</span>' : '') +
          '<br><span style="font-size:0.72rem;color:var(--warm-gray);">' + pct + '%</span>'
        ) +
      '</div>' +
      (status !== 'completed' && status !== 'cancelled' ? '<div style="margin-left:8px;"><button class="btn btn-secondary" style="font-size:0.7rem;padding:2px 8px;" onclick="removeLineItem(\'' + esc(jobId) + '\', \'' + esc(k) + '\')">×</button></div>' : '') +
    '</div>';
  });

  // Builds
  var builds = job.builds || {};
  var buildKeys = Object.keys(builds).sort(function(a, b) {
    return (builds[a].buildNumber || 0) - (builds[b].buildNumber || 0);
  });
  var buildsHtml = '';
  buildKeys.forEach(function(k) {
    var b = builds[k];
    var bStatus = b.status || 'draft';
    var duration = b.durationMinutes ? b.durationMinutes + ' min' : (bStatus === 'draft' ? 'In progress...' : '');
    var outputSummary = '';
    if (b.output) {
      var totalCompleted = 0, totalLoss = 0;
      Object.values(b.output).forEach(function(o) { totalCompleted += (o.completedQuantity || 0); totalLoss += (o.lossQuantity || 0); });
      outputSummary = totalCompleted + ' made' + (totalLoss > 0 ? ', ' + totalLoss + ' lost' : '');
    }
    buildsHtml += '<div class="prod-build-card' + (bStatus === 'draft' ? ' prod-build-active' : '') + '" ' +
      (bStatus === 'draft' ? 'onclick="openActiveBuild(\'' + esc(jobId) + '\', \'' + esc(k) + '\')"' : '') +
      ' style="cursor:' + (bStatus === 'draft' ? 'pointer' : 'default') + ';">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<div>' +
          '<strong>Build #' + (b.buildNumber || '?') + '</strong>' +
          ' &middot; ' + (b.sessionDate || '') +
          ' &middot; <span class="status-badge prod-status-pill ' + bStatus + '">' + bStatus + '</span>' +
          ' <span id="buildMediaBadge_' + k + '" class="media-count-badge" style="display:none;"></span>' +
        '</div>' +
        '<div style="font-size:0.82rem;color:var(--warm-gray);">' +
          duration +
          (outputSummary ? '<br>' + outputSummary : '') +
        '</div>' +
      '</div>' +
      (b.operators && b.operators.length > 0 ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Operators: ' + b.operators.map(esc).join(', ') + '</div>' : '') +
      '<div id="buildMediaThumbs_' + k + '" style="display:none;margin-top:8px;" class="media-gallery"></div>' +
    '</div>';
  });

  var progress = getJobProgress(job);
  var deadlineHtml = job.deadline ? '<span style="font-size:0.85rem;color:var(--warm-gray);">Due: ' + job.deadline + '</span>' : '';
  var eventHtml = job.eventName ? '<span style="font-size:0.85rem;color:var(--warm-gray);">Event: ' + esc(job.eventName) + '</span>' : '';

  // Check for active (draft) build
  var hasActiveBuild = buildKeys.some(function(k) { return builds[k].status === 'draft'; });
  var startBuildBtn = (status === 'definition' || status === 'in-progress') && !hasActiveBuild ?
    '<button class="btn btn-primary" style="padding:14px 18px;font-size:0.95rem;" onclick="startBuild(\'' + esc(jobId) + '\')">&#x1F525; Start Build</button>' : '';
  var activeBuildBtn = hasActiveBuild ?
    '<button class="btn btn-primary" style="padding:14px 18px;font-size:0.95rem;" onclick="openActiveBuild(\'' + esc(jobId) + '\', \'' + esc(buildKeys.find(function(k) { return builds[k].status === 'draft'; })) + '\')">&#x1F3AD; Continue Active Build</button>' : '';

  el.innerHTML = '<button class="detail-back" onclick="backToProductionList()">&#8592; Back to Jobs</button>' +
    '<div style="margin-bottom:16px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">' +
        '<div>' +
          '<h2 style="margin:0 0 8px 0;font-family:\'Cormorant Garamond\',serif;">' + esc(job.name || 'Untitled') + '</h2>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<span class="status-badge" style="' + purposeBadgeStyle(job.purpose) + '">' + (PURPOSE_LABELS[job.purpose] || '') + '</span>' +
            '<span class="status-badge prod-status-pill ' + status + '">' + status.replace('-', ' ') + '</span>' +
            '<span class="prod-priority-dot ' + (job.priority || 'medium') + '"></span>' +
            '<span style="font-size:0.82rem;text-transform:capitalize;">' + (job.priority || 'medium') + '</span>' +
            deadlineHtml + eventHtml +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          statusBtns +
          ' <button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="openEditJobModal(\'' + esc(jobId) + '\')">Edit</button>' +
        '</div>' +
      '</div>' +
      (job.description ? '<p style="margin-top:8px;font-size:0.85rem;color:var(--warm-gray);">' + esc(job.description) + '</p>' : '') +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:0.82rem;color:var(--warm-gray);">' +
        (job.workType ? '<span><strong style="color:var(--text-secondary);">Type:</strong> ' + esc(job.workType.charAt(0).toUpperCase() + job.workType.slice(1)) + '</span>' : '') +
        (job.createdAt ? '<span><strong style="color:var(--text-secondary);">Created:</strong> ' + new Date(job.createdAt).toLocaleDateString() + '</span>' : '') +
        (job.startedAt ? '<span><strong style="color:var(--text-secondary);">Started:</strong> ' + new Date(job.startedAt).toLocaleDateString() + '</span>' : '') +
        (job.completedAt ? '<span><strong style="color:var(--text-secondary);">Completed:</strong> ' + new Date(job.completedAt).toLocaleDateString() + '</span>' : '') +
      '</div>' +
      (progress.total > 0 ? '<div class="prod-progress-bar" style="margin-top:12px;height:8px;"><div class="prod-progress-fill" style="width:' + progress.pct + '%;"></div></div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' + progress.completed + ' / ' + progress.total + ' (' + Math.round(progress.pct) + '%)</div>' : '') +
    '</div>' +

    '<div class="prod-detail-section">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
        '<strong>Line Items</strong>' +
        (status !== 'completed' && status !== 'cancelled' ? '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="openAddLineItemModal(\'' + esc(jobId) + '\')">+ Add Item</button>' : '') +
      '</div>' +
      (liKeys.length > 0 ? liHtml : '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">No line items yet. Add items to track production goals.</p>') +
    '</div>' +

    '<div class="prod-detail-section">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
        '<strong>Builds</strong>' +
        '<div style="display:flex;gap:8px;">' + startBuildBtn + activeBuildBtn + '</div>' +
      '</div>' +
      (buildKeys.length > 0 ? buildsHtml : '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">No builds yet. Start a build session to begin tracking production.</p>') +
    '</div>' +

    '<div class="prod-detail-section">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
        '<strong>Story</strong>' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="openStoryCuration(\'' + esc(jobId) + '\')">&#x1F4F7; Curate Story</button>' +
      '</div>' +
      '<div id="jobStoryStatus_' + jobId + '" style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">Loading...</div>' +
    '</div>' +

    (status === 'completed' ? '<div class="prod-detail-section">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
        '<strong>Product Links</strong>' +
      '</div>' +
      '<div id="jobProductLinks_' + jobId + '"></div>' +
    '</div>' : '') +

    // Pipeline status section
    (function() {
      var purpose = job.purpose || '';
      if (purpose === 'fulfillment' || purpose === 'custom') {
        return '<div class="prod-detail-section">' +
          '<strong style="display:block;margin-bottom:8px;">Pipeline</strong>' +
          '<div id="jobPipelineStatus_' + jobId + '" style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">Loading order status...</div>' +
        '</div>';
      }
      if (purpose === 'inventory-general') {
        var invIndicators = '';
        buildKeys.forEach(function(bk) {
          var b = builds[bk];
          if (b.status === 'completed') {
            var pushed = b.inventoryPushed ? '✓ Pushed to inventory' : '— Not pushed';
            var style = b.inventoryPushed ? 'color:var(--teal);' : 'color:var(--warm-gray);';
            invIndicators += '<div style="font-size:0.82rem;' + style + '">Build #' + (b.buildNumber || '?') + ': ' + pushed + '</div>';
          }
        });
        return '<div class="prod-detail-section">' +
          '<strong style="display:block;margin-bottom:8px;">Pipeline — Inventory</strong>' +
          (invIndicators || '<div style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">No completed builds yet.</div>') +
        '</div>';
      }
      if (purpose === 'wholesale' || purpose === 'experimental' || purpose === 'inventory-event') {
        return '<div class="prod-detail-section">' +
          '<div style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">⚠ Manual handling required — no automated pipeline for ' + (PURPOSE_LABELS[purpose] || purpose) + ' jobs.</div>' +
        '</div>';
      }
      return '';
    })();

  // Load photo badges for each build
  buildKeys.forEach(function(bk) { loadBuildMediaBadge(bk); });
  // Load story status
  loadJobStoryStatus(jobId);
  // Load product links if completed
  if (status === 'completed') loadJobProductLinks(jobId);
  // Load pipeline status for fulfillment/custom
  if (job.purpose === 'fulfillment' || job.purpose === 'custom') loadJobPipelineStatus(jobId);
}

async function transitionProductionJob(jobId, newStatus) {
  if (newStatus === 'cancelled' && !confirm('Cancel this job?')) return;
  try {
    var updates = { status: newStatus };
    var now = new Date().toISOString();
    if (newStatus === 'in-progress') updates.startedAt = now;
    if (newStatus === 'completed') {
      updates.completedAt = now;
      // Auto-update inventory for each completed line item
      var job = productionJobs[jobId];
      var lineItems = job ? (job.lineItems || {}) : {};
      var invCount = 0;
      for (var liKey of Object.keys(lineItems)) {
        var li = lineItems[liKey];
        if (!li.productId || !(li.completedQuantity > 0)) continue;
        var qty = (li.completedQuantity || 0) - (li.lossQuantity || 0);
        if (qty <= 0) continue;
        try {
          var stockRef = MastDB.inventory.stockAvailable(li.productId);
          await stockRef.transaction(function(current) { return (current || 0) + qty; });
          await writeAudit('update', 'inventory', li.productId);
          invCount++;
        } catch (e) { console.error('Inventory update error for ' + li.productId + ':', e); }
      }
    }
    await MastDB.productionJobs.ref(jobId).update(updates);
    await writeAudit('update', 'jobs', jobId);
    if (newStatus === 'completed' && invCount > 0) {
      showToast('Job completed — ' + invCount + ' product' + (invCount > 1 ? 's' : '') + ' updated in inventory');
    } else {
      showToast('Job status updated to ' + newStatus);
    }
    emitTestingEvent('transitionJob', { newStatus: newStatus });
  } catch (err) {
    showToast('Error updating job: ' + err.message, true);
  }
}

async function updateLineItemProgress(jobId, liKey, completedQty, lossQty) {
  try {
    var updates = {};
    if (completedQty !== null) updates.completedQuantity = parseInt(completedQty) || 0;
    if (lossQty !== null) updates.lossQuantity = parseInt(lossQty) || 0;
    await MastDB.productionJobs.lineItems(jobId, liKey).update(updates);
    // Update local cache
    if (productionJobs[jobId] && productionJobs[jobId].lineItems && productionJobs[jobId].lineItems[liKey]) {
      Object.assign(productionJobs[jobId].lineItems[liKey], updates);
    }
    emitTestingEvent('updateLineItem', {});
  } catch (err) {
    showToast('Error saving progress: ' + err.message, true);
  }
}

// ---- Edit Job Modal ----
function openEditJobModal(jobId) {
  var job = productionJobs[jobId];
  if (!job) return;
  var purposeOptions = Object.keys(PURPOSE_LABELS).map(function(k) {
    return '<option value="' + k + '"' + (job.purpose === k ? ' selected' : '') + '>' + PURPOSE_LABELS[k] + '</option>';
  }).join('');
  var html = '<div style="max-width:450px;">' +
    '<h3>Edit Job</h3>' +
    '<div class="form-group"><label>Name</label><input type="text" id="editJobName" value="' + esc(job.name || '') + '"></div>' +
    '<div class="form-group"><label>Description</label><textarea id="editJobDesc" rows="2">' + esc(job.description || '') + '</textarea></div>' +
    '<div class="form-group"><label>Purpose</label><select id="editJobPurpose">' + purposeOptions + '</select></div>' +
    '<div class="form-group"><label>Work Type</label><select id="editJobWorkType">' +
      '<option value="flameshop"' + (job.workType === 'flameshop' ? ' selected' : '') + '>Flameshop</option>' +
      '<option value="hotshop"' + (job.workType === 'hotshop' ? ' selected' : '') + '>Hotshop</option>' +
      '<option value="hybrid"' + (job.workType === 'hybrid' ? ' selected' : '') + '>Hybrid</option>' +
      '<option value="other"' + (job.workType === 'other' ? ' selected' : '') + '>Other</option>' +
    '</select></div>' +
    '<div class="form-group"><label>Priority</label><select id="editJobPriority">' +
      '<option value="high"' + (job.priority === 'high' ? ' selected' : '') + '>High</option>' +
      '<option value="medium"' + (job.priority === 'medium' ? ' selected' : '') + '>Medium</option>' +
      '<option value="low"' + (job.priority === 'low' ? ' selected' : '') + '>Low</option>' +
    '</select></div>' +
    '<div class="form-group"><label>Deadline</label><input type="date" id="editJobDeadline" value="' + (job.deadline || '') + '"></div>' +
    '<div class="form-group"><label>Event Name</label><input type="text" id="editJobEvent" value="' + esc(job.eventName || '') + '" placeholder="e.g. Spring Craft Fair March 15"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="doEditJob(\'' + esc(jobId) + '\')">Save</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

async function doEditJob(jobId) {
  try {
    await MastDB.productionJobs.ref(jobId).update({
      name: document.getElementById('editJobName').value.trim(),
      description: document.getElementById('editJobDesc').value.trim(),
      purpose: document.getElementById('editJobPurpose').value,
      workType: document.getElementById('editJobWorkType').value,
      priority: document.getElementById('editJobPriority').value,
      deadline: document.getElementById('editJobDeadline').value || null,
      eventName: document.getElementById('editJobEvent').value.trim() || null
    });
    await writeAudit('update', 'jobs', jobId);
    closeModal();
    showToast('Job updated');
  } catch (err) {
    showToast('Error updating job: ' + err.message, true);
  }
}

// ---- Add Line Item Modal ----
function openAddLineItemModal(jobId) {
  // Build product picker from existing products
  var productOptions = '<option value="">-- Freeform (type below) --</option>';
  if (productsData && productsData.length) {
    productsData.forEach(function(p) {
      if (p.pid) {
        productOptions += '<option value="' + esc(p.pid) + '">' + esc(p.name || p.pid) + '</option>';
      }
    });
  }
  var html = '<div style="max-width:400px;">' +
    '<h3>Add Line Item</h3>' +
    '<div class="form-group"><label>Product</label><select id="liProductPicker" onchange="onLineItemProductSelect()" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">' + productOptions + '</select></div>' +
    '<div class="form-group"><label>Product Name</label><input type="text" id="liProductName" placeholder="Product name"></div>' +
    '<div class="form-group"><label>Target Quantity</label><input type="number" id="liTargetQty" min="1" value="1" style="width:100px;"></div>' +
    '<div class="form-group"><label>Specifications</label><input type="text" id="liSpecs" placeholder="Color, size, notes..."></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="doAddLineItem(\'' + esc(jobId) + '\')">Add</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

function onLineItemProductSelect() {
  var picker = document.getElementById('liProductPicker');
  var nameInput = document.getElementById('liProductName');
  if (picker.value && productsData && productsData.length) {
    var match = productsData.find(function(p) { return p.pid === picker.value; });
    if (match) nameInput.value = match.name || '';
  }
}

async function doAddLineItem(jobId) {
  var pid = document.getElementById('liProductPicker').value || null;
  var name = document.getElementById('liProductName').value.trim();
  var qty = parseInt(document.getElementById('liTargetQty').value) || 1;
  var specs = document.getElementById('liSpecs').value.trim();
  if (!name) { showToast('Enter a product name', true); return; }
  try {
    var ref = MastDB.productionJobs.lineItems(jobId).push();
    await ref.set({
      productId: pid,
      productName: name,
      targetQuantity: qty,
      completedQuantity: 0,
      lossQuantity: 0,
      specifications: specs,
      productionRequestId: null
    });
    await writeAudit('update', 'jobs', jobId);
    closeModal();
    showToast('Line item added');
  } catch (err) {
    showToast('Error adding line item: ' + err.message, true);
  }
}

async function removeLineItem(jobId, lineItemId) {
  if (!confirm('Remove this line item?')) return;
  try {
    await writeAudit('update', 'jobs', jobId);
    await MastDB.productionJobs.lineItems(jobId, lineItemId).remove();
    showToast('Line item removed');
  } catch (err) {
    showToast('Error removing line item: ' + err.message, true);
  }
}

// ---- Build Workflow ----

// START BUILD (Moment 1)
function startBuild(jobId) {
  var job = productionJobs[jobId];
  if (!job) return;
  var opNames = getOperatorNames();
  var opCheckboxes = opNames.map(function(name) {
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:0.9rem;">' +
      '<input type="checkbox" class="buildOperatorCheck" value="' + esc(name) + '" style="width:20px;height:20px;cursor:pointer;"> ' +
      esc(name) + '</label>';
  }).join('');
  var html = '<div style="max-width:400px;">' +
    '<h3>Start Build Session</h3>' +
    '<div class="form-group">' +
      '<label>Operators</label>' +
      opCheckboxes +
      '<div style="margin-top:8px;"><input type="text" id="buildNewOperator" placeholder="Add new operator..." style="font-size:0.9rem;"></div>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>Work Type</label>' +
      '<select id="buildWorkType" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">' +
        '<option value="flameshop"' + (job.workType === 'flameshop' ? ' selected' : '') + '>Flameshop</option>' +
        '<option value="hotshop"' + (job.workType === 'hotshop' ? ' selected' : '') + '>Hotshop</option>' +
        '<option value="hybrid"' + (job.workType === 'hybrid' ? ' selected' : '') + '>Hybrid</option>' +
        '<option value="other"' + (job.workType === 'other' ? ' selected' : '') + '>Other</option>' +
      '</select>' +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="doStartBuild(\'' + esc(jobId) + '\')">&#x1F525; Start</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

async function doStartBuild(jobId) {
  var job = productionJobs[jobId];
  if (!job) return;
  var selectedOps = [];
  document.querySelectorAll('.buildOperatorCheck:checked').forEach(function(cb) {
    selectedOps.push(cb.value);
  });
  var newOp = document.getElementById('buildNewOperator').value.trim();
  if (newOp) selectedOps.push(newOp);
  if (selectedOps.length === 0) { showToast('Select at least one operator', true); return; }

  var workType = document.getElementById('buildWorkType').value;
  var existingBuilds = job.builds || {};
  var buildNumber = Object.keys(existingBuilds).length + 1;
  var now = new Date();

  try {
    var buildRef = MastDB.productionJobs.builds(jobId).push();
    var buildId = buildRef.key;
    await buildRef.set({
      buildNumber: buildNumber,
      sessionDate: now.toISOString().split('T')[0],
      startTime: now.toISOString(),
      endTime: null,
      durationMinutes: null,
      workType: workType,
      status: 'draft',
      operators: selectedOps,
      notes: '',
      createdAt: now.toISOString(),
      completedAt: null
    });
    await writeAudit('update', 'jobs', jobId);

    // Auto-transition job to in-progress if still in definition
    if (job.status === 'definition') {
      await MastDB.productionJobs.ref(jobId).update({
        status: 'in-progress',
        startedAt: now.toISOString()
      });
    }

    closeModal();
    openActiveBuild(jobId, buildId);
    showToast('Build #' + buildNumber + ' started');
    emitTestingEvent('startBuild', {});
  } catch (err) {
    showToast('Error starting build: ' + err.message, true);
  }
}

// DURING BUILD (Moment 2)
function openActiveBuild(jobId, buildId) {
  activeBuildId = buildId;
  var jobsView = document.getElementById('productionJobsView');
  var detailView = document.getElementById('productionJobDetail');
  var buildView = document.getElementById('productionBuildView');
  var banner = document.getElementById('pendingRequestsBanner');
  if (jobsView) jobsView.style.display = 'none';
  if (detailView) detailView.style.display = 'none';
  if (banner) banner.style.display = 'none';
  if (buildView) buildView.style.display = '';
  renderActiveBuild(jobId, buildId);
}

function renderActiveBuild(jobId, buildId) {
  var el = document.getElementById('productionBuildView');
  if (!el) return;
  var job = productionJobs[jobId];
  if (!job || !job.builds || !job.builds[buildId]) { el.innerHTML = '<p>Build not found.</p>'; return; }
  var build = job.builds[buildId];
  var milestones = build.milestones || {};
  var milestoneKeys = Object.keys(milestones).sort();
  var milestonesHtml = milestoneKeys.map(function(k) {
    var m = milestones[k];
    return '<div class="prod-milestone">' + esc(m.text || '') + ' <span style="font-size:0.72rem;">(' + formatTime(m.timestamp) + ')</span></div>';
  }).join('');

  var elapsed = '';
  if (build.startTime) {
    var mins = Math.round((Date.now() - new Date(build.startTime).getTime()) / 60000);
    elapsed = mins + ' min elapsed';
  }

  el.innerHTML = '<button class="detail-back" onclick="viewProductionJob(\'' + esc(jobId) + '\')">&#8592; Back to Job</button>' +
    '<div style="text-align:center;margin:20px 0;">' +
      '<h2 style="font-family:\'Cormorant Garamond\',serif;margin:0;">Build #' + (build.buildNumber || '?') + '</h2>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;">' + esc(job.name || '') + ' &middot; ' + (build.sessionDate || '') + '</p>' +
      '<p style="color:var(--teal);font-size:1.1rem;font-weight:600;">' + elapsed + '</p>' +
      '<p style="color:var(--warm-gray);font-size:0.82rem;">Operators: ' + (build.operators || []).map(esc).join(', ') + '</p>' +
    '</div>' +

    '<div style="text-align:center;margin:24px 0;">' +
      '<button class="btn btn-primary" style="padding:16px 28px;font-size:1.1rem;border-radius:12px;" onclick="capturePhoto(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">' +
        '&#x1F4F7; Capture Photo</button>' +
      '<input type="file" id="buildPhotoInput" accept="image/*" capture="environment" multiple style="display:none;" ' +
        'onchange="handlePhotoUpload(this, \'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">' +
    '</div>' +

    '<div id="buildMediaGallery" class="media-gallery" style="margin-bottom:24px;"></div>' +

    '<div style="display:flex;gap:12px;justify-content:center;margin:24px 0;flex-wrap:wrap;">' +
      '<button class="btn btn-secondary" style="padding:14px 18px;font-size:0.95rem;" onclick="addBuildNote(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">&#x1F4DD; Add Note</button>' +
      '<button class="btn btn-secondary" style="padding:14px 18px;font-size:0.95rem;" onclick="addBuildMilestone(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">&#x2B50; Add Milestone</button>' +
    '</div>' +

    (build.notes ? '<div class="prod-detail-section"><strong>Notes</strong><p style="margin-top:8px;font-size:0.85rem;white-space:pre-wrap;">' + esc(build.notes) + '</p></div>' : '') +

    (milestoneKeys.length > 0 ? '<div class="prod-detail-section"><strong>Milestones</strong><div style="margin-top:8px;">' + milestonesHtml + '</div></div>' : '') +

    '<div style="text-align:center;margin-top:32px;">' +
      '<button class="btn btn-primary" style="padding:14px 18px;font-size:0.95rem;min-width:200px;" onclick="openCompleteBuild(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">&#x2705; Complete Build</button>' +
    '</div>';
  // Load and display media for this build
  loadBuildMedia(buildId);
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  var d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function addBuildNote(jobId, buildId) {
  var html = '<div style="max-width:400px;">' +
    '<h3>Add Note</h3>' +
    '<textarea id="buildNoteText" rows="4" placeholder="Kiln conditions, techniques, observations..." style="font-size:1rem;"></textarea>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="doAddBuildNote(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">Save</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

async function doAddBuildNote(jobId, buildId) {
  var text = document.getElementById('buildNoteText').value.trim();
  if (!text) { closeModal(); return; }
  try {
    var job = productionJobs[jobId];
    var existing = (job && job.builds && job.builds[buildId]) ? job.builds[buildId].notes || '' : '';
    var newNotes = existing ? existing + '\n' + text : text;
    await MastDB.productionJobs.buildField(jobId, buildId, 'notes').set(newNotes);
    await writeAudit('update', 'jobs', jobId);
    closeModal();
    renderActiveBuild(jobId, buildId);
    showToast('Note added');
    emitTestingEvent('addBuildNote', {});
  } catch (err) {
    showToast('Error adding note: ' + err.message, true);
  }
}

function addBuildMilestone(jobId, buildId) {
  var html = '<div style="max-width:400px;">' +
    '<h3>Add Milestone</h3>' +
    '<input type="text" id="milestoneText" placeholder="e.g. body formed, first anneal..." style="font-size:1rem;">' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="doAddMilestone(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">Save</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

async function doAddMilestone(jobId, buildId) {
  var text = document.getElementById('milestoneText').value.trim();
  if (!text) { closeModal(); return; }
  try {
    var ref = MastDB.productionJobs.subRef(jobId, 'builds', buildId, 'milestones').push();
    await ref.set({ text: text, timestamp: new Date().toISOString() });
    await writeAudit('update', 'jobs', jobId);
    closeModal();
    renderActiveBuild(jobId, buildId);
    showToast('Milestone added');
    emitTestingEvent('addMilestone', {});
  } catch (err) {
    showToast('Error adding milestone: ' + err.message, true);
  }
}

// COMPLETE BUILD (Moment 3)
function openCompleteBuild(jobId, buildId) {
  var job = productionJobs[jobId];
  if (!job) return;
  var lineItems = job.lineItems || {};
  var liKeys = Object.keys(lineItems);
  var outputFields = liKeys.map(function(k) {
    var li = lineItems[k];
    return '<div style="margin-bottom:16px;padding:12px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;">' +
      '<strong>' + esc(li.productName || '') + '</strong>' +
      (li.specifications ? '<br><span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(li.specifications) + '</span>' : '') +
      '<div style="display:flex;gap:12px;margin-top:8px;">' +
        '<div><label style="font-size:0.78rem;">Good pieces</label><input type="number" class="buildOutput" data-li="' + esc(k) + '" data-field="completed" min="0" value="0" style="width:70px;padding:8px;font-size:1rem;"></div>' +
        '<div><label style="font-size:0.78rem;">Lost pieces</label><input type="number" class="buildOutput" data-li="' + esc(k) + '" data-field="loss" min="0" value="0" style="width:70px;padding:8px;font-size:1rem;"></div>' +
      '</div>' +
      '<div style="margin-top:6px;"><label style="font-size:0.78rem;">Loss notes</label><input type="text" class="buildOutput" data-li="' + esc(k) + '" data-field="lossNotes" placeholder="What went wrong?" style="width:100%;font-size:0.85rem;box-sizing:border-box;"></div>' +
    '</div>';
  }).join('');

  // Count photos for this build
  var mediaCount = currentBuildMedia ? Object.keys(currentBuildMedia).length : 0;
  var mediaNote = mediaCount > 0 ? '<p style="font-size:0.85rem;color:var(--teal);margin-bottom:12px;">📷 This build has ' + mediaCount + ' photo' + (mediaCount !== 1 ? 's' : '') + '</p>' : '';

  var html = '<div style="max-width:500px;">' +
    '<h3>Complete Build</h3>' +
    mediaNote +
    (liKeys.length > 0 ? '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Record output for each line item:</p>' + outputFields :
      '<p style="font-size:0.85rem;color:var(--warm-gray);">No line items to record output for.</p>') +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="doCompleteBuild(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">&#x2705; Complete</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

async function doCompleteBuild(jobId, buildId) {
  var job = productionJobs[jobId];
  if (!job) return;
  var now = new Date();
  var build = job.builds ? job.builds[buildId] : null;

  // Gather output
  var output = {};
  document.querySelectorAll('.buildOutput').forEach(function(input) {
    var li = input.dataset.li;
    var field = input.dataset.field;
    if (!output[li]) output[li] = { completedQuantity: 0, lossQuantity: 0, lossNotes: '' };
    if (field === 'completed') output[li].completedQuantity = parseInt(input.value) || 0;
    if (field === 'loss') output[li].lossQuantity = parseInt(input.value) || 0;
    if (field === 'lossNotes') output[li].lossNotes = input.value.trim();
  });

  // Calculate duration
  var durationMinutes = null;
  if (build && build.startTime) {
    durationMinutes = Math.round((now.getTime() - new Date(build.startTime).getTime()) / 60000);
  }

  try {
    // Update build
    await MastDB.productionJobs.builds(jobId, buildId).update({
      status: 'completed',
      endTime: now.toISOString(),
      durationMinutes: durationMinutes,
      completedAt: now.toISOString(),
      output: output
    });
    await writeAudit('update', 'jobs', jobId);

    // Firebase transaction: aggregate tallies across all builds
    var lineItems = job.lineItems || {};
    var liKeys = Object.keys(lineItems);
    var allBuilds = job.builds || {};
    // Include current build output in aggregation
    for (var bk in allBuilds) {
      if (bk === buildId) continue; // skip — we'll use our fresh output
    }

    // Re-read all builds to get accurate tallies
    var jobSnap = await MastDB.productionJobs.ref(jobId).once('value');
    var freshJob = jobSnap.val();
    var tallies = {};
    if (freshJob && freshJob.lineItems) {
      var freshBuilds = freshJob.builds || {};
      liKeys.forEach(function(liKey) { tallies[liKey] = { completed: 0, loss: 0 }; });
      Object.values(freshBuilds).forEach(function(b) {
        if (b.status === 'completed' && b.output) {
          Object.keys(b.output).forEach(function(liKey) {
            if (!tallies[liKey]) tallies[liKey] = { completed: 0, loss: 0 };
            tallies[liKey].completed += (b.output[liKey].completedQuantity || 0);
            tallies[liKey].loss += (b.output[liKey].lossQuantity || 0);
          });
        }
      });
      // Write tallies
      var tallyUpdates = {};
      Object.keys(tallies).forEach(function(liKey) {
        tallyUpdates['lineItems/' + liKey + '/completedQuantity'] = tallies[liKey].completed;
        tallyUpdates['lineItems/' + liKey + '/lossQuantity'] = tallies[liKey].loss;
      });
      await MastDB.productionJobs.ref(jobId).update(tallyUpdates);

      // Check if all line items met target
      var allMet = true;
      Object.keys(freshJob.lineItems).forEach(function(liKey) {
        var target = freshJob.lineItems[liKey].targetQuantity || 0;
        var completed = tallies[liKey] ? tallies[liKey].completed : 0;
        if (completed < target) allMet = false;
      });
      if (allMet && liKeys.length > 0) {
        if (confirm('All line items have met their targets! Mark job as completed?')) {
          await MastDB.productionJobs.ref(jobId).update({
            status: 'completed',
            completedAt: now.toISOString()
          });
        }
      }
    }

    // ── Pipeline Automation Hooks ──
    var purpose = freshJob ? freshJob.purpose : (job.purpose || '');
    var summaryItems = [];
    summaryItems.push('Build #' + (build ? build.buildNumber : '?') + ' completed' + (durationMinutes ? ' — ' + durationMinutes + ' min' : ''));

    // Report line items that met target
    if (freshJob && freshJob.lineItems) {
      Object.keys(freshJob.lineItems).forEach(function(liKey) {
        var li = freshJob.lineItems[liKey];
        var target = li.targetQuantity || 0;
        var completed = tallies[liKey] ? tallies[liKey].completed : 0;
        if (completed >= target && target > 0) {
          summaryItems.push('🎯 ' + (li.productName || 'Item') + ' reached target (' + completed + '/' + target + ')');
        }
      });
    }

    // Fulfillment auto-advance (fulfillment + custom purposes)
    if (purpose === 'fulfillment' || purpose === 'custom') {
      var fulfillResults = await autoFulfillLinkedRequests(jobId, freshJob, tallies);
      fulfillResults.forEach(function(r) { summaryItems.push(r); });
    }

    // Inventory auto-push (inventory-general only)
    if (purpose === 'inventory-general') {
      var invResults = await autoUpdateInventory(jobId, buildId, output, freshJob);
      invResults.forEach(function(r) { summaryItems.push(r); });
    }

    // Custom piece story prompt
    if (purpose === 'custom' && freshJob) {
      var hasStory = false;
      try {
        var storyCheck = await MastDB.stories.queryByJob(jobId);
        if (storyCheck.val()) {
          Object.values(storyCheck.val()).forEach(function(s) {
            if (s.status === 'published') hasStory = true;
          });
        }
      } catch (e) { /* ignore */ }
      if (hasStory) {
        summaryItems.push('✨ Custom piece has a story — share with customer?');
      }
    }

    closeModal();
    activeBuildId = null;
    viewProductionJob(jobId);
    showCompletionSummary(summaryItems);
    emitTestingEvent('completeBuild', {});
  } catch (err) {
    showToast('Error completing build: ' + err.message, true);
  }
}

// ── Pipeline: Auto-fulfill linked production requests ──
async function autoFulfillLinkedRequests(jobId, freshJob, tallies) {
  var results = [];
  if (!freshJob || !freshJob.lineItems) return results;
  var lineItems = freshJob.lineItems;

  for (var liKey of Object.keys(lineItems)) {
    var li = lineItems[liKey];
    if (!li.productionRequestId) continue;
    if (li.requestFulfilled) continue; // double-fulfill guard
    var target = li.targetQuantity || 0;
    var completed = tallies[liKey] ? tallies[liKey].completed : 0;
    if (completed < target) continue;

    try {
      // Read the production request to get orderId
      var reqSnap = await MastDB.productionRequests.ref(li.productionRequestId).once('value');
      var req = reqSnap.val();
      if (!req || req.status !== 'assigned') continue;

      // Get operator name from builds
      var operatorName = 'admin';
      if (freshJob.builds) {
        var ops = {};
        Object.values(freshJob.builds).forEach(function(b) {
          if (b.operators) b.operators.forEach(function(o) { ops[o] = true; });
        });
        var opNames = Object.keys(ops);
        if (opNames.length) operatorName = opNames[0];
      }

      await fulfillProductionRequest(li.productionRequestId, req.orderId || '', operatorName);
      // Mark fulfilled on line item to prevent double-advance
      await MastDB.productionJobs.subRef(jobId, 'lineItems', liKey, 'requestFulfilled').set(true);
      await writeAudit('update', 'buildJobs', li.productionRequestId);

      var orderNum = '';
      if (req.orderId && orders[req.orderId]) {
        orderNum = orders[req.orderId].orderNumber || req.orderId;
      }
      results.push('📋 Order #' + orderNum + ' item fulfilled');
    } catch (e) {
      console.error('Auto-fulfill error:', e);
    }
  }
  return results;
}

// ── Pipeline: Auto-push inventory for inventory-general builds ──
async function autoUpdateInventory(jobId, buildId, buildOutput, freshJob) {
  var results = [];
  if (!freshJob || !freshJob.lineItems) return results;

  // Check double-push guard on the build
  try {
    var buildSnap = await MastDB.productionJobs.buildField(jobId, buildId, 'inventoryPushed').once('value');
    if (buildSnap.val()) return results; // already pushed
  } catch (e) { /* proceed */ }

  var lineItems = freshJob.lineItems;

  for (var liKey of Object.keys(buildOutput)) {
    var qty = buildOutput[liKey].completedQuantity || 0;
    if (qty <= 0) continue;
    var li = lineItems[liKey];
    if (!li) continue;
    if (!li.productId) {
      results.push('⚠️ ' + (li.productName || 'item') + ': no product linked, inventory not updated');
      continue;
    }

    try {
      // Firebase transaction for atomic increment
      var stockRef = MastDB.inventory.stockAvailable(li.productId);
      await stockRef.transaction(function(current) {
        return (current || 0) + qty;
      });
      results.push('📦 Inventory +' + qty + ' ' + (li.productName || 'item'));
    } catch (e) {
      console.error('Inventory update error:', e);
    }
  }

  // Set guard flag
  if (results.length > 0) {
    await MastDB.productionJobs.buildField(jobId, buildId, 'inventoryPushed').set(true);
    await writeAudit('update', 'jobs', jobId);
  }
  return results;
}

// ── Pipeline: Completion summary feedback ──
function showCompletionSummary(items) {
  if (!items || items.length === 0) {
    showToast('Build completed');
    return;
  }
  if (items.length === 1) {
    showToast(items[0]);
    return;
  }
  // Multi-action: show summary modal
  var html = '<div style="padding:16px;max-width:440px;">' +
    '<h3 style="margin:0 0 16px;font-size:1.1rem;">Build Completed</h3>' +
    '<div style="display:flex;flex-direction:column;gap:8px;">';
  items.forEach(function(item) {
    html += '<div style="font-size:0.9rem;padding:6px 10px;background:var(--cream-dark,#f5f0e8);border-radius:6px;">' + esc(item) + '</div>';
  });
  // Offer camera intake if inventory was updated
  var hasInventoryUpdate = items.some(function(i) { return i.indexOf('📦 Inventory') >= 0; });
  var intakeBtn = hasInventoryUpdate
    ? '<button class="btn btn-secondary" style="margin-right:8px;" onclick="closeModal();startIntakeMode(null);">📷 Camera Intake</button>'
    : '';

  html += '</div>' +
    '<div style="text-align:right;margin-top:16px;">' +
    intakeBtn +
    '<button class="btn btn-primary" onclick="closeModal()">OK</button>' +
    '</div></div>';
  openModal(html);
}

// ============================================================
// Build Media — Compression, Capture, Upload, Gallery
// ============================================================

async function compressImage(file) {
  var bitmap = await createImageBitmap(file);
  var maxDim = 1600;
  var w = bitmap.width, h = bitmap.height;
  if (w > maxDim || h > maxDim) {
    if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
    else { w = Math.round(w * maxDim / h); h = maxDim; }
  }
  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise(function(resolve) {
    canvas.toBlob(function(blob) { resolve(blob); }, 'image/jpeg', 0.8);
  });
}

function capturePhoto(jobId, buildId) {
  var input = document.getElementById('buildPhotoInput');
  if (input) input.click();
}

async function handlePhotoUpload(input, jobId, buildId) {
  var files = Array.from(input.files || []);
  if (files.length === 0) return;
  input.value = '';
  for (var i = 0; i < files.length; i++) {
    await uploadBuildPhoto(files[i], jobId, buildId);
  }
}

async function uploadBuildPhoto(file, jobId, buildId) {
  try {
    var mediaId = db.ref().push().key;
    var galleryEl = document.getElementById('buildMediaGallery');

    // Create placeholder thumbnail with progress
    if (galleryEl) {
      var placeholder = document.createElement('div');
      placeholder.className = 'media-thumb';
      placeholder.id = 'upload_' + mediaId;
      placeholder.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--warm-gray);font-size:0.75rem;">Uploading...</div>' +
        '<div class="upload-progress"><div class="upload-progress-fill" id="progress_' + mediaId + '" style="width:0%;"></div></div>';
      galleryEl.appendChild(placeholder);
    }

    var compressed = await compressImage(file);
    var storageRef = storage.ref(MastDB.storagePath('builds/' + buildId + '/' + mediaId + '.jpg'));
    var uploadTask = storageRef.put(compressed);

    await new Promise(function(resolve, reject) {
      uploadTask.on('state_changed',
        function(snapshot) {
          var pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          var bar = document.getElementById('progress_' + mediaId);
          if (bar) bar.style.width = pct + '%';
        },
        function(error) { reject(error); },
        function() { resolve(); }
      );
    });

    var url = await uploadTask.snapshot.ref.getDownloadURL();
    await MastDB.buildMedia.ref(buildId, mediaId).set({
      type: 'photo',
      url: url,
      caption: '',
      uploadedAt: new Date().toISOString(),
      uploadedBy: getActiveOperatorName(),
      originalFilename: file.name,
      sizeBytes: compressed.size
    });
    await writeAudit('update', 'jobs', jobId);

    // Replace placeholder with actual thumbnail
    var ph = document.getElementById('upload_' + mediaId);
    if (ph) {
      ph.innerHTML = '<img src="' + url + '" alt="Build photo" onclick="previewPhoto(\'' + esc(url) + '\')">' +
        '<button class="delete-media" onclick="event.stopPropagation();deleteBuildMedia(\'' + esc(buildId) + '\', \'' + esc(mediaId) + '\')">×</button>';
    }
    updateBuildMediaCount(buildId);
    showToast('Photo uploaded');
  } catch (err) {
    showToast('Upload error: ' + err.message, true);
    var ph2 = document.getElementById('upload_' + mediaId);
    if (ph2) ph2.remove();
  }
}

function getActiveOperatorName() {
  // Try to get from the current active build's operator list
  if (activeBuildId && selectedProductionJobId) {
    var job = productionJobs[selectedProductionJobId];
    if (job && job.builds && job.builds[activeBuildId]) {
      var ops = job.builds[activeBuildId].operators || [];
      if (ops.length > 0) return ops[0];
    }
  }
  return 'admin';
}

async function loadBuildMedia(buildId) {
  try {
    var snap = await MastDB.buildMedia.ref(buildId).once('value');
    var media = snap.val() || {};
    currentBuildMedia = media;
    renderBuildMediaGallery(buildId, media);
  } catch (err) {
    console.error('Error loading build media:', err);
  }
}

function renderBuildMediaGallery(buildId, media) {
  var el = document.getElementById('buildMediaGallery');
  if (!el) return;
  var keys = Object.keys(media).sort(function(a, b) {
    return (media[a].uploadedAt || '').localeCompare(media[b].uploadedAt || '');
  });
  if (keys.length === 0) {
    el.innerHTML = '<p style="font-size:0.82rem;color:var(--warm-gray);text-align:center;grid-column:1/-1;">No photos yet. Tap the camera button to capture build photos.</p>';
    return;
  }
  el.innerHTML = '<div style="grid-column:1/-1;font-size:0.82rem;color:var(--warm-gray);margin-bottom:4px;">' + keys.length + ' photo' + (keys.length !== 1 ? 's' : '') + '</div>' +
    keys.map(function(k) {
      var m = media[k];
      return '<div class="media-thumb">' +
        '<img src="' + esc(m.url) + '" alt="Build photo" onclick="previewPhoto(\'' + esc(m.url) + '\')">' +
        '<button class="delete-media" onclick="event.stopPropagation();deleteBuildMedia(\'' + esc(buildId) + '\', \'' + esc(k) + '\')">×</button>' +
      '</div>';
    }).join('');
}

function updateBuildMediaCount(buildId) {
  MastDB.buildMedia.ref(buildId).once('value').then(function(snap) {
    var count = snap.numChildren();
    var badge = document.getElementById('buildMediaBadge_' + buildId);
    if (badge) {
      badge.textContent = '📷 ' + count;
      badge.style.display = count > 0 ? '' : 'none';
    }
  });
}

async function deleteBuildMedia(buildId, mediaId) {
  if (!confirm('Delete this photo?')) return;
  try {
    await writeAudit('update', 'jobs', selectedProductionJobId || buildId);
    await storage.ref(MastDB.storagePath('builds/' + buildId + '/' + mediaId + '.jpg')).delete();
    await MastDB.buildMedia.ref(buildId, mediaId).remove();
    showToast('Photo deleted');
    loadBuildMedia(buildId);
  } catch (err) {
    showToast('Error deleting: ' + err.message, true);
  }
}

function previewPhoto(url) {
  var overlay = document.createElement('div');
  overlay.className = 'photo-preview-overlay';
  overlay.onclick = function() { overlay.remove(); };
  overlay.innerHTML = '<img src="' + url + '">';
  document.body.appendChild(overlay);
}

async function loadBuildMediaBadge(buildId) {
  try {
    var snap = await MastDB.buildMedia.ref(buildId).once('value');
    var count = snap.numChildren();
    var badge = document.getElementById('buildMediaBadge_' + buildId);
    if (badge && count > 0) {
      badge.textContent = '📷 ' + count;
      badge.style.display = '';
      // Also make build card clickable to expand photos
      var thumbs = document.getElementById('buildMediaThumbs_' + buildId);
      if (thumbs) {
        var media = snap.val() || {};
        var mKeys = Object.keys(media).sort(function(a, b) {
          return (media[a].uploadedAt || '').localeCompare(media[b].uploadedAt || '');
        });
        thumbs.innerHTML = mKeys.map(function(k) {
          return '<div class="media-thumb" style="max-width:80px;">' +
            '<img src="' + esc(media[k].url) + '" alt="" onclick="previewPhoto(\'' + esc(media[k].url) + '\')">' +
          '</div>';
        }).join('');
        // Toggle on badge click
        badge.style.cursor = 'pointer';
        badge.onclick = function(e) {
          e.stopPropagation();
          thumbs.style.display = thumbs.style.display === 'none' ? 'grid' : 'none';
        };
      }
    }
  } catch (err) { /* ignore badge load errors */ }
}

// ============================================================
// Story Curation
// ============================================================

async function loadJobPipelineStatus(jobId) {
  var el = document.getElementById('jobPipelineStatus_' + jobId);
  if (!el) return;
  var job = productionJobs[jobId];
  if (!job || !job.lineItems) { el.innerHTML = 'No line items.'; return; }
  var html = '';
  var lineItems = job.lineItems;
  for (var liKey of Object.keys(lineItems)) {
    var li = lineItems[liKey];
    if (!li.productionRequestId) continue;
    var statusText = li.requestFulfilled ? '<span style="color:var(--teal);font-weight:600;">✓ Fulfilled</span>' : '<span style="color:var(--amber);">Pending</span>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:0.85rem;">' +
      '<span>' + esc(li.productName || 'Item') + '</span>' + statusText + '</div>';
    // Try to show order status
    if (li.productionRequestId) {
      try {
        var reqSnap = await MastDB.productionRequests.ref(li.productionRequestId).once('value');
        var req = reqSnap.val();
        if (req && req.orderId && orders[req.orderId]) {
          var order = orders[req.orderId];
          html += '<div style="font-size:0.78rem;color:var(--warm-gray);padding-left:12px;margin-bottom:4px;">Order #' + esc(order.orderNumber || req.orderId) + ' — ' + esc(order.status || '?') + '</div>';
        }
      } catch (e) { /* ignore */ }
    }
  }
  el.innerHTML = html || '<div style="font-size:0.85rem;color:var(--warm-gray);">No linked production requests.</div>';
}

// ---- Stories Tab: Data Loading & List View ----
function loadStories() {
  if (storiesLoaded) {
    renderStoriesList();
    return;
  }
  storiesLoaded = true;
  if (!storiesListener) {
    storiesListener = MastDB.stories.listen(200, function(snap) {
      storiesData = snap.val() || {};
      renderStoriesList();
      if (selectedStoryId) renderStoryDetail(selectedStoryId);
    }, function(err) {
      showToast('Error loading stories: ' + err.message, true);
    });
  }
}

function renderStoriesList() {
  var listEl = document.getElementById('storiesListContent');
  var emptyEl = document.getElementById('storiesEmpty');
  if (!listEl) return;

  var filterVal = (document.getElementById('storiesStatusFilter') || {}).value || 'all';

  // Build stories array with keys
  var items = Object.keys(storiesData).map(function(k) {
    var s = storiesData[k];
    s._key = k;
    return s;
  }).filter(function(s) {
    if (filterVal === 'all') return true;
    return s.status === filterVal;
  }).sort(function(a, b) {
    // Published first, then drafts, then by updatedAt desc
    var statusOrder = { published: 0, draft: 1 };
    var sa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 2;
    var sb = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 2;
    if (sa !== sb) return sa - sb;
    return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
  });

  if (items.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    renderMissingStories();
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  var html = '';
  items.forEach(function(s) {
    var entryCount = s.entries ? Object.keys(s.entries).length : 0;
    var jobName = '';
    if (s.jobId && productionJobs[s.jobId]) {
      jobName = productionJobs[s.jobId].name || 'Untitled Job';
    }
    var statusColor = s.status === 'published' ? 'var(--teal)' : 'var(--amber)';
    var statusLabel = s.status || 'draft';

    // Find first image from entries for thumbnail
    var thumbUrl = '';
    if (s.entries) {
      var sorted = Object.values(s.entries).sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
      for (var i = 0; i < sorted.length; i++) {
        if (sorted[i].mediaUrl) { thumbUrl = sorted[i].mediaUrl; break; }
      }
    }

    var publishedInfo = s.status === 'published' && s.publishedAt
      ? '<span style="font-size:0.75rem;color:var(--warm-gray);">Published ' + getTimeAgo(s.publishedAt) + '</span>'
      : '<span style="font-size:0.75rem;color:var(--warm-gray);">Updated ' + getTimeAgo(s.updatedAt || s.createdAt) + '</span>';

    html += '<div class="prod-job-card" onclick="viewStoryDetail(\'' + esc(s._key) + '\')" style="display:flex;gap:12px;align-items:flex-start;">' +
      (thumbUrl ? '<div style="width:60px;height:60px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--cream);">' +
        '<img src="' + esc(thumbUrl) + '" style="width:100%;height:100%;object-fit:cover;" alt="">' +
      '</div>' : '<div style="width:60px;height:60px;border-radius:6px;flex-shrink:0;background:var(--cream);display:flex;align-items:center;justify-content:center;font-size:1.5rem;">📖</div>') +
      '<div style="flex:1;min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
          '<strong style="font-size:0.95rem;">' + esc(s.title || 'Untitled Story') + '</strong>' +
          '<span class="status-badge prod-status-pill" style="background:' + statusColor + ';color:white;font-size:0.7rem;padding:1px 8px;border-radius:4px;">' + statusLabel + '</span>' +
        '</div>' +
        '<div style="font-size:0.82rem;color:var(--warm-gray);">' +
          (jobName ? '🔗 ' + esc(jobName) + ' · ' : '') +
          entryCount + ' entr' + (entryCount === 1 ? 'y' : 'ies') +
        '</div>' +
        '<div style="margin-top:4px;">' + publishedInfo + '</div>' +
      '</div>' +
    '</div>';
  });
  listEl.innerHTML = html;
  renderMissingStories();
}

function renderMissingStories() {
  var promptEl = document.getElementById('storiesMissingPrompt');
  var listEl = document.getElementById('missingStoriesList');
  var badgeEl = document.getElementById('missingStoriesBadge');
  if (!promptEl || !listEl) return;

  // Find completed jobs that have no story
  var jobsWithStories = {};
  Object.values(storiesData).forEach(function(s) {
    if (s.jobId) jobsWithStories[s.jobId] = true;
  });

  var missing = Object.keys(productionJobs).filter(function(k) {
    var j = productionJobs[k];
    return j.status === 'completed' && !jobsWithStories[k];
  }).map(function(k) {
    return { key: k, job: productionJobs[k] };
  }).sort(function(a, b) {
    return (b.job.updatedAt || b.job.createdAt || '').localeCompare(a.job.updatedAt || a.job.createdAt || '');
  });

  if (missing.length === 0) {
    promptEl.style.display = 'none';
    return;
  }
  promptEl.style.display = '';
  if (badgeEl) {
    badgeEl.textContent = missing.length;
    badgeEl.style.display = 'inline';
  }

  var html = '';
  missing.forEach(function(m) {
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eee;">' +
      '<div>' +
        '<strong style="font-size:0.85rem;">' + esc(m.job.name || 'Untitled') + '</strong>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">Completed ' + getTimeAgo(m.job.updatedAt || m.job.createdAt) + '</div>' +
      '</div>' +
      '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="event.stopPropagation(); openStoryCuration(\'' + esc(m.key) + '\')">📷 Create Story</button>' +
    '</div>';
  });
  listEl.innerHTML = html;
}

function toggleMissingStories() {
  var content = document.getElementById('missingStoriesContent');
  var arrow = document.getElementById('missingStoriesArrow');
  if (!content) return;
  var isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
}

function viewStoryDetail(storyId) {
  selectedStoryId = storyId;
  var listView = document.getElementById('storiesListView');
  var detailView = document.getElementById('storyDetailView');
  if (listView) listView.style.display = 'none';
  if (detailView) detailView.style.display = '';
  renderStoryDetail(storyId);
}

function backToStoriesList() {
  selectedStoryId = null;
  var listView = document.getElementById('storiesListView');
  var detailView = document.getElementById('storyDetailView');
  if (detailView) detailView.style.display = 'none';
  if (listView) listView.style.display = '';
  renderStoriesList();
}

function renderStoryDetail(storyId) {
  var el = document.getElementById('storyDetailContent');
  if (!el) return;
  var story = storiesData[storyId];
  if (!story) {
    el.innerHTML = '<p style="color:var(--warm-gray);">Story not found.</p>';
    return;
  }

  var jobName = '';
  var jobId = story.jobId;
  if (jobId && productionJobs[jobId]) {
    jobName = productionJobs[jobId].name || 'Untitled Job';
  }

  var statusColor = story.status === 'published' ? 'var(--teal)' : 'var(--amber)';
  var statusLabel = story.status || 'draft';
  var entryCount = story.entries ? Object.keys(story.entries).length : 0;

  // Sort entries by order
  var entries = [];
  if (story.entries) {
    entries = Object.keys(story.entries).map(function(ek) {
      var e = story.entries[ek];
      e._key = ek;
      return e;
    }).sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
  }

  // Action buttons
  var actions = '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="previewStory(\'' + esc(storyId) + '\')">👁 Preview</button> ';
  if (jobId) {
    actions += '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 10px;" onclick="openStoryCuration(\'' + esc(jobId) + '\')">✏️ Edit Story</button> ';
  }
  if (story.status === 'published') {
    actions += '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="unpublishStoryFromDetail(\'' + esc(storyId) + '\')">Unpublish</button>';
  } else if (story.status === 'draft' && entryCount > 0) {
    actions += '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 10px;" onclick="publishStoryFromDetail(\'' + esc(storyId) + '\')">🚀 Publish</button>';
  }

  var html = '<button class="detail-back" onclick="backToStoriesList()">← Back to Stories</button>' +
    '<div class="section-header" style="margin-bottom:0;">' +
      '<h2>' + esc(story.title || 'Untitled Story') + '</h2>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">' +
      '<span class="status-badge prod-status-pill" style="background:' + statusColor + ';color:white;">' + statusLabel + '</span>' +
      (jobName ? '<span style="font-size:0.85rem;color:var(--warm-gray);">🔗 From job: <strong style="color:var(--text);">' + esc(jobName) + '</strong></span>' : '') +
      '<span style="font-size:0.85rem;color:var(--warm-gray);">' + entryCount + ' entr' + (entryCount === 1 ? 'y' : 'ies') + '</span>' +
      (story.publishedAt ? '<span style="font-size:0.85rem;color:var(--warm-gray);">Published ' + getTimeAgo(story.publishedAt) + '</span>' : '') +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:20px;">' + actions + '</div>';

  // Show entries
  if (entries.length > 0) {
    html += '<div class="prod-detail-section"><strong>Entries</strong>';
    entries.forEach(function(e, i) {
      html += '<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #eee;align-items:flex-start;">';
      if (e.mediaUrl) {
        html += '<div style="width:80px;height:80px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--cream);">' +
          '<img src="' + esc(e.mediaUrl) + '" style="width:100%;height:100%;object-fit:cover;" alt="">' +
        '</div>';
      } else {
        html += '<div style="width:80px;height:80px;border-radius:6px;flex-shrink:0;background:var(--cream);display:flex;align-items:center;justify-content:center;font-size:0.8rem;color:var(--warm-gray);">Text</div>';
      }
      html += '<div style="flex:1;min-width:0;">' +
        (e.milestone ? '<div style="font-weight:600;font-size:0.85rem;margin-bottom:4px;">' + esc(e.milestone) + '</div>' : '') +
        (e.caption ? '<div style="font-size:0.85rem;color:var(--warm-gray);">' + esc(e.caption) + '</div>' : '<div style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">No caption</div>') +
      '</div>';
      html += '</div>';
    });
    html += '</div>';
  } else {
    html += '<div class="prod-detail-section">' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">No entries yet. Click <strong>Edit Story</strong> to add photos and narrative.</p>' +
    '</div>';
  }

  // Operators
  if (story.operators && story.operators.length > 0) {
    html += '<div class="prod-detail-section"><strong>Artists</strong>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">';
    story.operators.forEach(function(op) {
      var opName = operators[op] ? (operators[op].name || op) : op;
      html += '<span style="background:var(--cream);padding:4px 10px;border-radius:12px;font-size:0.82rem;">' + esc(opName) + '</span>';
    });
    html += '</div></div>';
  }

  // QR Codes
  if (story.qrCodes && story.qrCodes.length > 0) {
    html += '<div class="prod-detail-section"><strong>QR Codes</strong>' +
      '<p style="font-size:0.82rem;color:var(--warm-gray);margin:4px 0 12px;">Scan to view the product page with this story.</p>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;">';
    story.qrCodes.forEach(function(qr) {
      html += '<div style="text-align:center;background:white;padding:12px;border-radius:8px;border:1px solid var(--cream-dark);">' +
        '<img src="' + esc(qr.dataUrl) + '" style="width:150px;height:150px;" alt="QR Code">' +
        '<div style="font-size:0.82rem;font-weight:600;margin-top:6px;">' + esc(qr.productName) + '</div>' +
        '<div style="display:flex;gap:6px;margin-top:8px;justify-content:center;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="printStoryQR(\'' + esc(qr.dataUrl) + '\', \'' + esc(qr.productName) + '\')">🖨 Print</button>' +
          '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="copyStoryQRUrl(\'' + esc(qr.url) + '\')">📋 Copy URL</button>' +
          '<button class="btn btn-primary" style="font-size:0.72rem;padding:3px 8px;" onclick="printProductCard(\'' + esc(qr.productId) + '\', \'' + esc(qr.productName) + '\', \'' + esc(qr.url) + '\')">🃏 Print Card</button>' +
        '</div>' +
      '</div>';
    });
    html += '</div></div>';
  }

  el.innerHTML = html;
}

function printStoryQR(dataUrl, productName) {
  var win = window.open('', '_blank', 'width=400,height=500');
  win.document.write('<html><head><title>QR Code - ' + esc(productName) + '</title>' +
    '<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;margin:0;}' +
    'img{width:250px;height:250px;}h3{margin:16px 0 4px;font-size:1rem;}p{font-size:0.8rem;color:#666;}</style></head><body>' +
    '<img src="' + esc(dataUrl) + '" alt="QR Code">' +
    '<h3>' + esc(productName) + '</h3>' +
    '<p>' + ((typeof TENANT_BRAND !== 'undefined' && TENANT_BRAND.name) || 'My Business') + '</p>' +
    '<script>setTimeout(function(){window.print();},300);<\/script>' +
    '</body></html>');
  win.document.close();
}

function copyStoryQRUrl(url) {
  navigator.clipboard.writeText(url).then(function() {
    showToast('Product URL copied');
  }).catch(function() {
    prompt('Copy this URL:', url);
  });
}

var LK_API_URL = 'https://labelkeeper-api-1075204398975.us-central1.run.app';
var _lkApiKeyCache = null;

async function _getLkApiKey() {
  if (_lkApiKeyCache) return _lkApiKeyCache;
  var snap = await MastDB._ref('admin/config/labelkeeper/apiKey').once('value');
  _lkApiKeyCache = snap.val();
  return _lkApiKeyCache;
}

async function printProductCard(productId, productName, storyUrl) {
  var product = productsData ? productsData.find(function(p) { return p.pid === productId; }) : null;
  var imageUrl = product && product.images && product.images.length ? product.images[0] : null;

  var payload = {
    productId: productId,
    productName: productName,
    storyUrl: storyUrl,
    productImage: imageUrl,
    source: MastDB.tenantId() + '-admin',
    timestamp: new Date().toISOString()
  };

  try {
    showToast('Creating print session...');
    var apiKey = await _getLkApiKey();
    if (!apiKey) throw new Error('LabelKeeper API key not configured — add it in Settings > Integrations');
    var resp = await fetch(LK_API_URL + '/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error('Failed to create session');
    var result = await resp.json();
    window.open(result.url, '_blank');
    showToast('Opening Label Keeper...');
  } catch (e) {
    // Fallback to legacy localStorage method
    console.warn('LK API failed, falling back to localStorage:', e.message);
    localStorage.setItem('lk_printCard', JSON.stringify(payload));
    window.open('https://stewartdavidp-ship-it.github.io/labelkeeper/?action=printCard&t=' + Date.now(), '_blank');
    showToast('Opening Label Keeper...');
  }
}

// ---- QR Code Generation for Stories ----
function ensureQRLib() {
  return new Promise(function(resolve, reject) {
    if (window.qrcode) { resolve(); return; }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    script.onload = resolve;
    script.onerror = function() { reject(new Error('Failed to load QR library')); };
    document.head.appendChild(script);
  });
}

async function generateStoryQRCodes(storyId, jobId) {
  var job = productionJobs[jobId];
  if (!job || !job.lineItems) return [];

  // Find linked products
  var linkedProducts = [];
  Object.values(job.lineItems).forEach(function(li) {
    if (li.productId && li.productLinked) {
      linkedProducts.push({ productId: li.productId, productName: li.productName || 'Unknown' });
    }
  });
  if (linkedProducts.length === 0) return [];

  // Load QR library
  try { await ensureQRLib(); } catch (e) { console.error(e); return []; }

  var qrCodes = [];
  linkedProducts.forEach(function(p) {
    var url = GITHUB_PAGES_BASE + '/product.html?id=' + p.productId + '&view=story';
    // Generate QR code data URL
    var qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    var dataUrl = qr.createDataURL(6, 0);
    qrCodes.push({
      productId: p.productId,
      productName: p.productName,
      url: url,
      dataUrl: dataUrl
    });
  });
  return qrCodes;
}

async function publishStoryFromDetail(storyId) {
  var story = storiesData[storyId];
  if (!story) return;
  if (!confirm('Publish this story? It will be visible to customers.')) return;
  try {
    var updates = {
      status: 'published',
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Collect operators from job builds
    if (story.jobId) {
      var job = productionJobs[story.jobId];
      if (job && job.builds) {
        var ops = {};
        Object.values(job.builds).forEach(function(b) {
          if (b.operators) b.operators.forEach(function(o) { ops[o] = true; });
        });
        updates.operators = Object.keys(ops);
      }
    }

    // Generate QR codes for linked products
    if (story.jobId) {
      var qrCodes = await generateStoryQRCodes(storyId, story.jobId);
      if (qrCodes.length > 0) updates.qrCodes = qrCodes;
    }

    await MastDB.stories.ref(storyId).update(updates);
    await writeAudit('update', 'products', storyId);

    // Back-fill storyId on linked products
    if (story.jobId) {
      var job = productionJobs[story.jobId];
      if (job && job.lineItems) {
        var productUpdates = [];
        Object.values(job.lineItems).forEach(function(li) {
          if (li.productId && li.productLinked) {
            productUpdates.push(
              MastDB.products.storyIdRef(li.productId).set(storyId)
            );
          }
        });
        if (productUpdates.length) await Promise.all(productUpdates);
      }
    }

    showToast('Story published!');
    renderStoryDetail(storyId);
  } catch (err) {
    showToast('Error publishing: ' + err.message, true);
  }
}

async function unpublishStoryFromDetail(storyId) {
  if (!confirm('Unpublish this story?')) return;
  try {
    var story = storiesData[storyId];
    await MastDB.stories.ref(storyId).update({ status: 'draft', updatedAt: new Date().toISOString() });
    await writeAudit('update', 'products', storyId);

    // Clear storyId from linked products
    if (story && story.jobId) {
      var job = productionJobs[story.jobId];
      if (job && job.lineItems) {
        var clearUpdates = [];
        Object.values(job.lineItems).forEach(function(li) {
          if (li.productId && li.productLinked) {
            clearUpdates.push(
              MastDB.products.storyIdRef(li.productId).remove()
            );
          }
        });
        if (clearUpdates.length) await Promise.all(clearUpdates);
      }
    }

    showToast('Story unpublished');
    renderStoryDetail(storyId);
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

async function loadJobStoryStatus(jobId) {
  var el = document.getElementById('jobStoryStatus_' + jobId);
  if (!el) return;
  try {
    var snap = await MastDB.stories.queryByJob(jobId);
    var stories = snap.val() || {};
    var keys = Object.keys(stories);
    if (keys.length === 0) {
      el.innerHTML = 'No story yet. Click "Curate Story" to create one from build photos.';
      return;
    }
    var story = stories[keys[0]];
    var storyId = keys[0];
    var entryCount = story.entries ? Object.keys(story.entries).length : 0;
    var statusColor = story.status === 'published' ? 'var(--teal)' : 'var(--amber)';
    el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<div><strong>' + esc(story.title || 'Untitled') + '</strong> &middot; ' +
        '<span style="color:' + statusColor + ';font-weight:600;">' + (story.status || 'draft') + '</span> &middot; ' +
        entryCount + ' entries</div>' +
      '<div style="display:flex;gap:6px;">' +
        '<button class="btn btn-secondary" style="font-size:0.75rem;padding:3px 8px;" onclick="previewStory(\'' + esc(storyId) + '\')">Preview</button>' +
        (story.status === 'published' ? '<button class="btn btn-secondary" style="font-size:0.75rem;padding:3px 8px;" onclick="unpublishStory(\'' + esc(storyId) + '\')">Unpublish</button>' : '') +
      '</div>' +
    '</div>';
  } catch (err) {
    el.innerHTML = 'Error loading story status.';
  }
}

async function openStoryCuration(jobId) {
  storyCurationJobId = jobId;
  var job = productionJobs[jobId];
  if (!job) return;

  // Determine if we should render inline (on stories tab) or in modal
  var isInline = currentRoute === 'stories';

  // Load all media from all builds for this job
  var builds = job.builds || {};
  var buildKeys = Object.keys(builds).sort(function(a, b) {
    return (builds[a].buildNumber || 0) - (builds[b].buildNumber || 0);
  });

  var allMedia = {};
  for (var i = 0; i < buildKeys.length; i++) {
    var bk = buildKeys[i];
    try {
      var snap = await MastDB.buildMedia.ref(bk).once('value');
      var media = snap.val();
      if (media) allMedia[bk] = media;
    } catch (e) { /* skip */ }
  }

  // Load existing story draft if any
  var existingStory = null;
  var existingStoryId = null;
  try {
    var storySnap = await MastDB.stories.queryByJob(jobId);
    var stories = storySnap.val() || {};
    var sKeys = Object.keys(stories);
    if (sKeys.length > 0) {
      existingStoryId = sKeys[0];
      existingStory = stories[sKeys[0]];
    }
  } catch (e) { /* no existing story */ }

  var html = buildStoryCurationHtml(job, builds, buildKeys, allMedia, existingStory, existingStoryId, isInline);

  emitTestingEvent('openStoryCuration', {});

  if (isInline) {
    // Render inline in the stories tab detail view
    selectedStoryId = existingStoryId;
    var listView = document.getElementById('storiesListView');
    var detailView = document.getElementById('storyDetailView');
    var detailContent = document.getElementById('storyDetailContent');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = '';
    if (detailContent) detailContent.innerHTML = html;
  } else {
    // Navigate to stories tab and render inline there
    navigateTo('stories');
    // Small delay to let the tab render
    await new Promise(function(r) { setTimeout(r, 50); });
    selectedStoryId = existingStoryId;
    var listView = document.getElementById('storiesListView');
    var detailView = document.getElementById('storyDetailView');
    var detailContent = document.getElementById('storyDetailContent');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = '';
    if (detailContent) detailContent.innerHTML = html;
  }

  // Initialize entries from existing story or selected photos
  if (existingStory && existingStory.entries) {
    storyDraft = Object.keys(existingStory.entries).map(function(ek) {
      var e = existingStory.entries[ek];
      return { id: ek, mediaUrl: e.mediaUrl || '', milestone: e.milestone || '', caption: e.caption || '', buildId: e.buildId || '', order: e.order || 0 };
    }).sort(function(a, b) { return a.order - b.order; });
  } else {
    storyDraft = [];
  }
  renderStoryEntries();
}

function buildStoryCurationHtml(job, builds, buildKeys, allMedia, existingStory, existingStoryId, isInline) {
  var totalPhotos = 0;
  buildKeys.forEach(function(bk) { totalPhotos += Object.keys(allMedia[bk] || {}).length; });

  var html = '';

  // Back button and header
  if (existingStoryId) {
    html += '<button class="detail-back" onclick="viewStoryDetail(\'' + esc(existingStoryId) + '\')">← Back to Story</button>';
  } else {
    html += '<button class="detail-back" onclick="backToStoriesList()">← Back to Stories</button>';
  }

  html += '<div class="section-header" style="margin-bottom:4px;">' +
    '<h2>' + (existingStory ? 'Edit Story' : 'Create Story') + '</h2>' +
  '</div>' +
  '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:20px;">From job: <strong style="color:var(--text);">' + esc(job.name || 'Untitled') + '</strong></div>';

  // Title input
  html += '<div class="form-group" style="margin-bottom:20px;">' +
    '<label style="font-weight:600;font-size:0.85rem;margin-bottom:4px;display:block;">Story Title</label>' +
    '<input type="text" id="storyTitle" value="' + esc(existingStory ? existingStory.title : job.name || '') + '" placeholder="Give your story a title..." style="font-size:1rem;width:100%;padding:10px 14px;border:1px solid var(--cream-dark);border-radius:8px;box-sizing:border-box;">' +
  '</div>';

  // Photo selection per build
  if (totalPhotos > 0) {
    html += '<div class="prod-detail-section">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<strong>Select Photos</strong>' +
        '<span style="font-size:0.78rem;color:var(--warm-gray);">' + totalPhotos + ' available</span>' +
      '</div>' +
      '<p style="font-size:0.82rem;color:var(--warm-gray);margin:0 0 12px;">Tap photos to add or remove them from the story.</p>';

    var selectedMediaIds = {};
    if (existingStory && existingStory.entries) {
      Object.values(existingStory.entries).forEach(function(e) {
        if (e.mediaUrl) selectedMediaIds[e.mediaUrl] = true;
      });
    }

    buildKeys.forEach(function(bk) {
      var b = builds[bk];
      var media = allMedia[bk] || {};
      var mKeys = Object.keys(media).sort(function(a, c) {
        return (media[a].uploadedAt || '').localeCompare(media[c].uploadedAt || '');
      });
      if (mKeys.length === 0) return;
      html += '<div style="margin-bottom:12px;">' +
        '<div style="font-size:0.82rem;font-weight:600;margin-bottom:6px;">Build #' + (b.buildNumber || '?') + ' — ' + (b.sessionDate || '') + ' (' + mKeys.length + ' photos)</div>' +
        '<div class="media-select-grid">';
      mKeys.forEach(function(mk) {
        var m = media[mk];
        var sel = selectedMediaIds[m.url] ? ' selected' : '';
        html += '<div class="media-select-thumb' + sel + '" data-url="' + esc(m.url) + '" data-buildid="' + esc(bk) + '" data-mediaid="' + esc(mk) + '" onclick="toggleStoryMediaSelect(this)">' +
          '<img src="' + esc(m.url) + '" alt="">' +
          '<div class="check-overlay">✓</div>' +
        '</div>';
      });
      html += '</div></div>';
    });

    html += '</div>';
  } else {
    html += '<div class="prod-detail-section">' +
      '<strong>Photos</strong>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;margin:8px 0 0;">No build photos found for this job. Add photos during a build session, or add text-only entries below.</p>' +
    '</div>';
  }

  // Story entries assembly
  html += '<div class="prod-detail-section">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
      '<strong>Story Entries</strong>' +
      '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="addTextOnlyEntry()">+ Text Entry</button>' +
    '</div>' +
    '<div id="storyEntriesList"></div>' +
  '</div>';

  // Action buttons — sticky at bottom
  html += '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:16px 0;border-top:1px solid var(--cream-dark);margin-top:8px;">' +
    '<button class="btn btn-secondary" onclick="previewStoryFromCuration()">👁 Preview</button>' +
    '<button class="btn btn-secondary" onclick="saveDraftStory(\'' + esc(existingStoryId || '') + '\')">💾 Save Draft</button>' +
    '<button class="btn btn-primary" onclick="publishStory(\'' + esc(existingStoryId || '') + '\')">🚀 Publish</button>' +
  '</div>';

  return html;
}

function toggleStoryMediaSelect(el) {
  el.classList.toggle('selected');
  var url = el.getAttribute('data-url');
  var buildId = el.getAttribute('data-buildid');
  if (el.classList.contains('selected')) {
    // Add entry
    var id = db.ref().push().key;
    storyDraft.push({ id: id, mediaUrl: url, milestone: '', caption: '', buildId: buildId, order: storyDraft.length });
  } else {
    // Remove entry
    storyDraft = storyDraft.filter(function(e) { return e.mediaUrl !== url; });
    // Re-order
    storyDraft.forEach(function(e, i) { e.order = i; });
  }
  renderStoryEntries();
}

function addTextOnlyEntry() {
  var id = db.ref().push().key;
  storyDraft.push({ id: id, mediaUrl: '', milestone: '', caption: '', buildId: '', order: storyDraft.length });
  renderStoryEntries();
}

function renderStoryEntries() {
  var el = document.getElementById('storyEntriesList');
  if (!el) return;
  if (storyDraft.length === 0) {
    el.innerHTML = '<p style="font-size:0.82rem;color:var(--warm-gray);font-style:italic;">Select photos above to add them to the story, or add a text-only entry.</p>';
    return;
  }
  el.innerHTML = storyDraft.map(function(entry, idx) {
    return '<div class="story-entry-card" data-idx="' + idx + '">' +
      (entry.mediaUrl ? '<img class="story-entry-thumb" src="' + esc(entry.mediaUrl) + '">' : '<div class="story-entry-thumb" style="background:#e8e2d8;display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:var(--warm-gray);">Text</div>') +
      '<div class="story-entry-fields">' +
        '<input type="text" placeholder="Milestone (e.g. body formed...)" value="' + esc(entry.milestone) + '" onchange="updateStoryEntry(' + idx + ', \'milestone\', this.value)">' +
        '<textarea rows="2" placeholder="Caption..." onchange="updateStoryEntry(' + idx + ', \'caption\', this.value)">' + esc(entry.caption) + '</textarea>' +
      '</div>' +
      '<div class="story-entry-actions">' +
        '<button class="btn btn-small btn-secondary" style="width:30px;height:30px;padding:0;display:flex;align-items:center;justify-content:center;" onclick="moveStoryEntry(' + idx + ', -1)" ' + (idx === 0 ? 'disabled style="opacity:0.3;width:30px;height:30px;padding:0;display:flex;align-items:center;justify-content:center;"' : '') + '>↑</button>' +
        '<button class="btn btn-small btn-secondary" style="width:30px;height:30px;padding:0;display:flex;align-items:center;justify-content:center;" onclick="moveStoryEntry(' + idx + ', 1)" ' + (idx === storyDraft.length - 1 ? 'disabled style="opacity:0.3;width:30px;height:30px;padding:0;display:flex;align-items:center;justify-content:center;"' : '') + '>↓</button>' +
        '<button class="btn btn-small btn-danger" style="width:30px;height:30px;padding:0;display:flex;align-items:center;justify-content:center;" onclick="removeStoryEntry(' + idx + ')">×</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function updateStoryEntry(idx, field, value) {
  if (storyDraft[idx]) storyDraft[idx][field] = value;
}

function moveStoryEntry(idx, dir) {
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= storyDraft.length) return;
  var temp = storyDraft[idx];
  storyDraft[idx] = storyDraft[newIdx];
  storyDraft[newIdx] = temp;
  storyDraft.forEach(function(e, i) { e.order = i; });
  renderStoryEntries();
}

function removeStoryEntry(idx) {
  storyDraft.splice(idx, 1);
  storyDraft.forEach(function(e, i) { e.order = i; });
  renderStoryEntries();
  // Deselect the photo in the grid if it was a photo entry
  var removed = storyDraft[idx];
  // Sync selection visuals
  document.querySelectorAll('.media-select-thumb').forEach(function(thumb) {
    var url = thumb.getAttribute('data-url');
    var inDraft = storyDraft.some(function(e) { return e.mediaUrl === url; });
    if (inDraft) thumb.classList.add('selected');
    else thumb.classList.remove('selected');
  });
}

function getStoryData(storyId) {
  var title = (document.getElementById('storyTitle') || {}).value || '';
  var entries = {};
  storyDraft.forEach(function(e) {
    entries[e.id] = {
      order: e.order,
      milestone: e.milestone,
      mediaUrl: e.mediaUrl,
      mediaType: e.mediaUrl ? 'photo' : 'text',
      caption: e.caption,
      buildId: e.buildId
    };
  });
  return {
    jobId: storyCurationJobId,
    title: title,
    entries: entries
  };
}

async function saveDraftStory(existingId) {
  try {
    var data = getStoryData();
    data.status = 'draft';
    data.updatedAt = new Date().toISOString();
    var storyId = existingId;
    if (existingId) {
      await MastDB.stories.ref(existingId).update(data);
      await writeAudit('update', 'products', existingId);
    } else {
      data.createdAt = new Date().toISOString();
      var ref = MastDB.stories.ref().push();
      storyId = ref.key;
      await ref.set(data);
      await writeAudit('update', 'products', ref.key);
    }
    showToast('Story draft saved');
    if (storyCurationJobId) loadJobStoryStatus(storyCurationJobId);
    // Navigate to story detail view if on stories tab
    if (currentRoute === 'stories' && storyId) {
      viewStoryDetail(storyId);
    } else {
      closeModal();
    }
  } catch (err) {
    showToast('Error saving draft: ' + err.message, true);
  }
}

async function publishStory(existingId) {
  try {
    var data = getStoryData();
    data.status = 'published';
    data.publishedAt = new Date().toISOString();
    data.updatedAt = new Date().toISOString();

    // Collect deduplicated operators from all builds for public story
    var jobId = data.jobId;
    if (jobId) {
      var job = productionJobs[jobId];
      if (job && job.builds) {
        var ops = {};
        Object.values(job.builds).forEach(function(b) {
          if (b.operators) b.operators.forEach(function(o) { ops[o] = true; });
        });
        data.operators = Object.keys(ops);
      }
    }

    // Generate QR codes for linked products
    if (jobId) {
      var qrCodes = await generateStoryQRCodes(existingId || 'new', jobId);
      if (qrCodes.length > 0) data.qrCodes = qrCodes;
    }

    var storyId = existingId;
    if (existingId) {
      await MastDB.stories.ref(existingId).update(data);
    } else {
      data.createdAt = new Date().toISOString();
      var ref = MastDB.stories.ref().push();
      storyId = ref.key;
      await ref.set(data);
    }
    await writeAudit('update', 'products', storyId);

    // Back-fill storyId on linked products
    if (jobId && storyId) {
      var job = productionJobs[jobId];
      if (job && job.lineItems) {
        var productUpdates = [];
        Object.values(job.lineItems).forEach(function(li) {
          if (li.productId && li.productLinked) {
            productUpdates.push(
              MastDB.products.storyIdRef(li.productId).set(storyId)
            );
          }
        });
        if (productUpdates.length) await Promise.all(productUpdates);
      }
    }

    showToast('Story published!');
    emitTestingEvent('publishStory', {});
    if (storyCurationJobId) loadJobStoryStatus(storyCurationJobId);
    // Navigate to story detail view if on stories tab
    if (currentRoute === 'stories' && storyId) {
      viewStoryDetail(storyId);
    } else {
      closeModal();
    }
  } catch (err) {
    showToast('Error publishing: ' + err.message, true);
  }
}

async function unpublishStory(storyId) {
  if (!confirm('Unpublish this story?')) return;
  try {
    // Read story to get jobId before unpublishing
    var storySnap = await MastDB.stories.ref(storyId).once('value');
    var story = storySnap.val();

    await MastDB.stories.ref(storyId).update({ status: 'draft', updatedAt: new Date().toISOString() });
    await writeAudit('update', 'products', storyId);

    // Clear storyId from linked products
    if (story && story.jobId) {
      var job = productionJobs[story.jobId];
      if (job && job.lineItems) {
        var clearUpdates = [];
        Object.values(job.lineItems).forEach(function(li) {
          if (li.productId && li.productLinked) {
            clearUpdates.push(
              MastDB.products.storyIdRef(li.productId).remove()
            );
          }
        });
        if (clearUpdates.length) await Promise.all(clearUpdates);
      }
    }

    showToast('Story unpublished');
    if (selectedProductionJobId) loadJobStoryStatus(selectedProductionJobId);
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

function previewStoryFromCuration() {
  var data = getStoryData();
  var entries = storyDraft.slice().sort(function(a, b) { return a.order - b.order; });
  showStoryPreview(data.title, entries);
}

async function previewStory(storyId) {
  try {
    var snap = await MastDB.stories.ref(storyId).once('value');
    var story = snap.val();
    if (!story) { showToast('Story not found', true); return; }
    var entries = [];
    if (story.entries) {
      entries = Object.values(story.entries).sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
    }
    showStoryPreview(story.title || '', entries);
  } catch (err) {
    showToast('Error loading preview: ' + err.message, true);
  }
}

function showStoryPreview(title, entries) {
  var html = '<div class="story-preview-container">' +
    '<h1>' + esc(title || 'Untitled Story') + '</h1>';
  entries.forEach(function(e) {
    html += '<div class="story-preview-entry">';
    if (e.milestone) html += '<div class="milestone">' + esc(e.milestone) + '</div>';
    if (e.mediaUrl) html += '<img src="' + esc(e.mediaUrl) + '" alt="">';
    if (e.caption) html += '<div class="caption">' + esc(e.caption) + '</div>';
    html += '</div>';
  });
  html += '<div style="text-align:center;margin-top:32px;">' +
    '<button class="btn btn-secondary" onclick="closeModal()">Close</button></div></div>';
  openModal(html);
}

// ============================================================
// Product ↔ Build Linkage
// ============================================================

async function loadJobProductLinks(jobId) {
  var el = document.getElementById('jobProductLinks_' + jobId);
  if (!el) return;
  var job = productionJobs[jobId];
  if (!job) return;
  var lineItems = job.lineItems || {};
  var liKeys = Object.keys(lineItems);
  if (liKeys.length === 0) {
    el.innerHTML = '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">No line items to link.</p>';
    return;
  }

  var html = '';
  liKeys.forEach(function(lk) {
    var li = lineItems[lk];
    var linked = li.productLinked ? '<span style="color:var(--teal);font-size:0.82rem;">✓ Linked</span>' :
      '<button class="btn btn-secondary" style="font-size:0.72rem;padding:2px 8px;" onclick="linkProductToBuild(\'' + esc(jobId) + '\', \'' + esc(lk) + '\')">Link to Product</button>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #eee;">' +
      '<span style="font-size:0.85rem;">' + esc(li.productName || 'Unknown') + '</span>' +
      linked +
    '</div>';
  });
  el.innerHTML = html;
}

async function linkProductToBuild(jobId, lineItemId) {
  var job = productionJobs[jobId];
  if (!job || !job.lineItems || !job.lineItems[lineItemId]) return;
  var li = job.lineItems[lineItemId];
  var productId = li.productId;
  if (!productId) {
    showToast('No product ID on this line item — select product manually', true);
    return;
  }
  try {
    // Get existing buildIds on the product
    var snap = await MastDB.products.buildIdsRef(productId).once('value');
    var existing = snap.val() || [];
    if (!Array.isArray(existing)) existing = [];
    // Add all build IDs from this job
    var builds = job.builds || {};
    Object.keys(builds).forEach(function(bk) {
      if (existing.indexOf(bk) === -1) existing.push(bk);
    });
    await MastDB.products.buildIdsRef(productId).set(existing);
    // Mark linked on line item
    await MastDB.productionJobs.subRef(jobId, 'lineItems', lineItemId, 'productLinked').set(true);
    await writeAudit('update', 'jobs', jobId);

    // Check if a published story exists for this job and write storyId
    var storiesSnap = await MastDB.stories.queryByJob(jobId);
    var stories = storiesSnap.val() || {};
    Object.keys(stories).forEach(function(sk) {
      if (stories[sk].status === 'published') {
        MastDB.products.storyIdRef(productId).set(sk);
      }
    });

    showToast('Product linked to builds');
    loadJobProductLinks(jobId);
  } catch (err) {
    showToast('Error linking: ' + err.message, true);
  }
}


  // ============================================================
  // Window exports for onclick handlers
  // ============================================================

  window.renderPendingRequestsBanner = renderPendingRequestsBanner;
  window.togglePendingRequests = togglePendingRequests;
  window.updateQueueBadge = updateQueueBadge;
  window.renderProductionQueue = renderProductionQueue;
  window.openFulfillModal = openFulfillModal;
  window.doFulfillRequest = doFulfillRequest;
  window.openAssignToJobModal = openAssignToJobModal;
  window.doAssignNewJob = doAssignNewJob;
  window.doAssignExistingJob = doAssignExistingJob;
  window.renderProductionJobs = renderProductionJobs;
  window.openNewJobModal = openNewJobModal;
  window.doCreateJob = doCreateJob;
  window.viewProductionJob = viewProductionJob;
  window.backToProductionList = backToProductionList;
  window.renderProductionJobDetail = renderProductionJobDetail;
  window.transitionProductionJob = transitionProductionJob;
  window.updateLineItemProgress = updateLineItemProgress;
  window.openEditJobModal = openEditJobModal;
  window.doEditJob = doEditJob;
  window.openAddLineItemModal = openAddLineItemModal;
  window.onLineItemProductSelect = onLineItemProductSelect;
  window.doAddLineItem = doAddLineItem;
  window.removeLineItem = removeLineItem;
  window.startBuild = startBuild;
  window.doStartBuild = doStartBuild;
  window.openActiveBuild = openActiveBuild;
  window.renderActiveBuild = renderActiveBuild;
  window.addBuildNote = addBuildNote;
  window.doAddBuildNote = doAddBuildNote;
  window.addBuildMilestone = addBuildMilestone;
  window.doAddMilestone = doAddMilestone;
  window.openCompleteBuild = openCompleteBuild;
  window.doCompleteBuild = doCompleteBuild;
  window.compressImage = compressImage;
  window.capturePhoto = capturePhoto;
  window.handlePhotoUpload = handlePhotoUpload;
  window.uploadBuildPhoto = uploadBuildPhoto;
  window.previewPhoto = previewPhoto;
  window.deleteBuildMedia = deleteBuildMedia;
  window.loadBuildMediaBadge = loadBuildMediaBadge;
  window.loadStories = loadStories;
  window.renderStoriesList = renderStoriesList;
  window.renderMissingStories = renderMissingStories;
  window.toggleMissingStories = toggleMissingStories;
  window.viewStoryDetail = viewStoryDetail;
  window.backToStoriesList = backToStoriesList;
  window.renderStoryDetail = renderStoryDetail;
  window.printStoryQR = printStoryQR;
  window.copyStoryQRUrl = copyStoryQRUrl;
  window._getLkApiKey = _getLkApiKey;
  window.printProductCard = printProductCard;
  window.ensureQRLib = ensureQRLib;
  window.generateStoryQRCodes = generateStoryQRCodes;
  window.publishStoryFromDetail = publishStoryFromDetail;
  window.unpublishStoryFromDetail = unpublishStoryFromDetail;
  window.openStoryCuration = openStoryCuration;
  window.buildStoryCurationHtml = buildStoryCurationHtml;
  window.toggleStoryMediaSelect = toggleStoryMediaSelect;
  window.addTextOnlyEntry = addTextOnlyEntry;
  window.renderStoryEntries = renderStoryEntries;
  window.updateStoryEntry = updateStoryEntry;
  window.moveStoryEntry = moveStoryEntry;
  window.removeStoryEntry = removeStoryEntry;
  window.saveDraftStory = saveDraftStory;
  window.publishStory = publishStory;
  window.unpublishStory = unpublishStory;
  window.previewStoryFromCuration = previewStoryFromCuration;
  window.previewStory = previewStory;
  window.showStoryPreview = showStoryPreview;
  window.loadJobProductLinks = loadJobProductLinks;
  window.linkProductToBuild = linkProductToBuild;
  window.loadProduction = loadProduction;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  function ensureProductionData() {
    if (!productionLoaded) loadProduction();
    if (!productsLoaded) loadProducts();
  }

  MastAdmin.registerModule('production', {
    routes: {
      'jobs': { tab: 'productionTab', setup: function() {
        ensureProductionData();
        var jobsView = document.getElementById('productionJobsView');
        var detailView = document.getElementById('productionJobDetail');
        var buildView = document.getElementById('productionBuildView');
        if (jobsView) jobsView.style.display = '';
        if (detailView) detailView.style.display = 'none';
        if (buildView) buildView.style.display = 'none';
        selectedProductionJobId = null;
        renderPendingRequestsBanner();
      } },
      'production': { tab: 'productionTab', setup: function() { ensureProductionData(); navigateTo('jobs'); } },
      'stories': { tab: 'storiesTab', setup: function() {
        ensureProductionData();
        if (!storiesLoaded) loadStories();
        var listView = document.getElementById('storiesListView');
        var detailView = document.getElementById('storyDetailView');
        if (listView) listView.style.display = '';
        if (detailView) detailView.style.display = 'none';
        selectedStoryId = null;
      } }
    },
    detachListeners: function() {
      // Detach module-managed listeners on sign-out
      if (productionJobsListener) {
        MastDB.productionJobs.unlisten(productionJobsListener);
        productionJobsListener = null;
      }
      if (operatorsListener) {
        MastDB.operators.unlisten(operatorsListener);
        operatorsListener = null;
      }
      if (storiesListener) {
        MastDB.stories.unlisten(storiesListener);
        storiesListener = null;
      }
      productionLoaded = false;
      storiesLoaded = false;
      selectedProductionJobId = null;
      activeBuildId = null;
      storiesData = {};
      selectedStoryId = null;
      currentBuildMedia = {};
      storyDraft = null;
      storyCurationJobId = null;
    }
  });

})();
