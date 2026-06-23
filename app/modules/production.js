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
window.PURPOSE_LABELS = PURPOSE_LABELS;

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
    var priorityBadge = pr.priority === 'urgent' ? '<span style="background:#C62828;color:white;padding:1px 6px;border-radius:4px;font-size:0.72rem;font-weight:600;">URGENT</span> ' : '';
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
  var html = '<div style="max-width:400px;padding:24px;">' +
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

  var html = '<div style="max-width:450px;padding:24px;">' +
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

// Channel-First Phase 1d (D42) — resolve an order item's options object to a stable
// variant id by looking up the product's variants[] and matching the combo. Returns
// {variantId, variantLabel} or {variantId: null, variantLabel: null} when no match.
function resolveVariantFromOptions(productId, options) {
  if (!productId || !options || typeof options !== 'object' || !Object.keys(options).length) {
    return { variantId: null, variantLabel: null };
  }
  var prod = (window.productsData || []).find(function(p) { return p.pid === productId; });
  if (!prod || !Array.isArray(prod.variants) || !prod.variants.length) {
    return { variantId: null, variantLabel: null };
  }
  var optKeys = Object.keys(options);
  for (var i = 0; i < prod.variants.length; i++) {
    var v = prod.variants[i];
    if (!v || !v.id || !v.combo) continue;
    var comboKeys = Object.keys(v.combo);
    if (comboKeys.length !== optKeys.length) continue;
    var match = true;
    for (var j = 0; j < optKeys.length; j++) {
      if (v.combo[optKeys[j]] !== options[optKeys[j]]) { match = false; break; }
    }
    if (match) {
      var label = comboKeys.map(function(k) { return v.combo[k]; }).filter(Boolean).join(' / ');
      return { variantId: v.id, variantLabel: label };
    }
  }
  return { variantId: null, variantLabel: null };
}

async function doAssignNewJob(requestId) {
  var pr = productionRequests[requestId];
  if (!pr) return;
  try {
    // Create new job
    var jobId = MastDB.productionJobs.newKey();
    var lineItemId = MastDB.productionJobs.newLineItemKey(jobId);
    await MastDB.productionJobs.set(jobId, {
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
    // Channel-First Phase 1d (D42, D48) — resolve variant + freeze BOM at line creation
    var resolvedNew = resolveVariantFromOptions(pr.productId, pr.options);
    var bomNew = await snapshotBomForecast(pr.productId, resolvedNew.variantId);
    await MastDB.productionJobs.setLineItem(jobId, lineItemId, {
      productId: pr.productId || null,
      productName: pr.productName || '',
      variantId: resolvedNew.variantId,
      variantLabel: resolvedNew.variantLabel,
      targetQuantity: pr.qty || 1,
      completedQuantity: 0,
      lossQuantity: 0,
      specifications: pr.options ? Object.values(pr.options).join(', ') : '',
      productionRequestId: requestId,
      bomForecast: bomNew,
      actualMaterialCostCents: null,
      actualLaborCostCents: null
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
    var lineItemId = MastDB.productionJobs.newLineItemKey(jobId);
    // Channel-First Phase 1d (D42, D48) — resolve variant + freeze BOM at line creation
    var resolvedExist = resolveVariantFromOptions(pr.productId, pr.options);
    var bomExist = await snapshotBomForecast(pr.productId, resolvedExist.variantId);
    await MastDB.productionJobs.setLineItem(jobId, lineItemId, {
      productId: pr.productId || null,
      productName: pr.productName || '',
      variantId: resolvedExist.variantId,
      variantLabel: resolvedExist.variantLabel,
      targetQuantity: pr.qty || 1,
      completedQuantity: 0,
      lossQuantity: 0,
      specifications: pr.options ? Object.values(pr.options).join(', ') : '',
      productionRequestId: requestId,
      bomForecast: bomExist,
      actualMaterialCostCents: null,
      actualLaborCostCents: null
    });
    await writeAudit('update', 'jobs', jobId);
    await assignRequestToJob(requestId, jobId, lineItemId);
    closeModal();
    showToast('Request assigned to existing job');
  } catch (err) {
    showToast('Error assigning to job: ' + err.message, true);
  }
}

// Tenant-TZ-aware date helpers for URL filter (createdAt is ISO timestamp).
var _prodTenantTz = null;
function prodEnsureTenantTz() {
  if (_prodTenantTz !== null) return Promise.resolve(_prodTenantTz);
  try {
    return MastDB.businessEntity.get('operations').then(function(snap) {
      var ops = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var tz = ops && ops.localization && ops.localization.timezone;
      _prodTenantTz = (tz && typeof tz === 'string') ? tz : 'UTC';
      return _prodTenantTz;
    }).catch(function() { _prodTenantTz = 'UTC'; return 'UTC'; });
  } catch (e) {
    _prodTenantTz = 'UTC';
    return Promise.resolve('UTC');
  }
}
function prodTzPartsFromIso(iso) {
  if (!iso) return null;
  var dt = new Date(iso);
  if (isNaN(dt.getTime())) return null;
  var fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: _prodTenantTz || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  var parts = {};
  fmt.formatToParts(dt).forEach(function(x) { if (x.type !== 'literal') parts[x.type] = x.value; });
  return parts;
}

// ---- Production Jobs List ----
function renderProductionJobs() {
  var listEl = document.getElementById('productionJobsList');
  var emptyEl = document.getElementById('productionJobsEmpty');
  if (!listEl) return;

  // URL-driven filters from MCP admin links: status, purpose, workType, dateFrom, dateTo, jobIds
  var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
  var urlPurpose = (rp && typeof rp.purpose === 'string') ? rp.purpose : '';
  var urlWorkType = (rp && typeof rp.workType === 'string') ? rp.workType : '';
  var urlDateFrom = (rp && typeof rp.dateFrom === 'string') ? rp.dateFrom.slice(0, 10) : '';
  var urlDateTo = (rp && typeof rp.dateTo === 'string') ? rp.dateTo.slice(0, 10) : '';
  var urlIdsParam = (rp && typeof rp.jobIds === 'string') ? rp.jobIds : '';
  var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
  if (urlIdLookup) urlIds.forEach(function(id) { urlIdLookup[id] = true; });
  var hasUrlFilter = !!(urlStatus || urlPurpose || urlWorkType || urlDateFrom || urlDateTo || urlIds.length);
  if (hasUrlFilter && (urlDateFrom || urlDateTo) && _prodTenantTz === null) {
    prodEnsureTenantTz().then(function() { renderProductionJobs(); });
  }

  var statusFilter = document.getElementById('prodFilterStatus');
  var purposeFilter = document.getElementById('prodFilterPurpose');
  var workTypeFilter = document.getElementById('prodFilterWorkType');
  var sf = statusFilter ? statusFilter.value : 'active';
  var pf = purposeFilter ? purposeFilter.value : 'all';
  var wf = workTypeFilter ? workTypeFilter.value : 'all';

  var jobs;
  if (hasUrlFilter) {
    jobs = Object.keys(productionJobs).map(function(k) {
      var j = productionJobs[k];
      j._key = k;
      return j;
    }).filter(function(j) {
      if (urlStatus && j.status !== urlStatus) return false;
      if (urlPurpose && j.purpose !== urlPurpose) return false;
      if (urlWorkType && j.workType !== urlWorkType) return false;
      if (urlIdLookup && !urlIdLookup[j._key]) return false;
      if (urlDateFrom || urlDateTo) {
        var p = prodTzPartsFromIso(j.createdAt || '');
        if (!p) return false;
        var ds = p.year + '-' + p.month + '-' + p.day;
        if (urlDateFrom && ds < urlDateFrom) return false;
        if (urlDateTo && ds > urlDateTo) return false;
      }
      return true;
    });
  } else {
    jobs = Object.keys(productionJobs).map(function(k) {
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
  }

  // URL-filter banner — surfaces active MCP-link filters with Clear button.
  var bannerEl = document.getElementById('productionJobsUrlFilterBanner');
  if (!bannerEl && hasUrlFilter && listEl.parentNode) {
    bannerEl = document.createElement('div');
    bannerEl.id = 'productionJobsUrlFilterBanner';
    bannerEl.style.cssText = 'background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;';
    listEl.parentNode.insertBefore(bannerEl, listEl);
  }
  if (bannerEl) {
    if (hasUrlFilter) {
      var bparts = [];
      if (urlIds.length) bparts.push(MastFormat.countNoun(urlIds.length, 'selected job'));
      if (urlStatus) bparts.push('status: ' + String(urlStatus).replace(/-/g, ' '));
      if (urlPurpose) bparts.push('purpose: ' + urlPurpose);
      if (urlWorkType) bparts.push('workType: ' + urlWorkType);
      if (urlDateFrom && urlDateTo) bparts.push('from ' + urlDateFrom + ' to ' + urlDateTo);
      else if (urlDateFrom) bparts.push('from ' + urlDateFrom + ' onward');
      else if (urlDateTo) bparts.push('through ' + urlDateTo);
      bannerEl.innerHTML = '<span>🛠️ Showing ' + bparts.join(', ') + ' (' + jobs.length + ')</span>' +
        '<button type="button" onclick="clearProductionJobsFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>';
      bannerEl.style.display = 'flex';
    } else {
      bannerEl.style.display = 'none';
    }
  }

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
            '<strong style="font-size:0.9rem;">' + esc(j.name || 'Untitled') + '</strong>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
            '<span class="status-badge" style="' + purposeBadgeStyle(j.purpose) + '">' + (PURPOSE_LABELS[j.purpose] || j.purpose || '') + '</span>' +
            '<span class="status-badge prod-status-pill ' + (j.status || '') + '">' + (j.status || '').replace('-', ' ') + '</span>' +
            orderBadge +
            deadlineHtml +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;font-size:0.85rem;color:var(--warm-gray);min-width:60px;">' +
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
  var html = '<div style="max-width:450px;padding:24px;">' +
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
    // Single-sourced write — ProductionBridge.createJob mirrors this record
    // shape and is the same path jobs-v2's native "+ New job" calls.
    var jobId = await window.ProductionBridge.createJob({ name: name, purpose: purpose });
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

  // Line items — Channel-First Phase 1d (D43): group by productId, parent header per
  // product when any line in the group targets a variant; variant rows render indented.
  var lineItems = job.lineItems || {};
  var liKeys = Object.keys(lineItems);
  var liHtml = '';

  // Group line items by productId (or '_freeform' for items with no productId)
  var groupOrder = [];
  var groups = {};
  liKeys.forEach(function(k) {
    var li = lineItems[k];
    var gk = li && li.productId ? li.productId : '_freeform_' + k;
    if (!groups[gk]) { groups[gk] = []; groupOrder.push(gk); }
    groups[gk].push({ key: k, li: li });
  });

  groupOrder.forEach(function(gk) {
    var entries = groups[gk];
    var hasVariantLine = entries.some(function(e) { return e.li && e.li.variantId; });
    // Emit parent product header when any line in this group targets a variant
    if (hasVariantLine) {
      var headerName = (entries[0].li && entries[0].li.productName) || 'Product';
      liHtml += '<div class="prod-line-item-group-header" style="font-size:0.78rem;font-weight:600;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;padding:6px 0 4px;border-bottom:1px solid var(--cream-dark);margin-top:4px;">' + esc(headerName) + '</div>';
    }
    entries.forEach(function(entry) {
      var k = entry.key;
      var li = entry.li;
      var pct = li.targetQuantity > 0 ? Math.min(100, Math.round((li.completedQuantity || 0) / li.targetQuantity * 100)) : 0;
      var isEditable = (status === 'in-progress' || status === 'queued');
      // Indent + variant-only label when this line is under a parent header
      var indentStyle = hasVariantLine ? 'padding-left:18px;' : '';
      var labelHtml;
      if (hasVariantLine) {
        // Variant row under header — show ↳ + variant label (or specifications fallback)
        var vLabel = li.variantLabel || li.specifications || (li.variantId ? li.variantId : 'Default');
        labelHtml = '<span style="color:var(--warm-gray);">↳</span> <strong>' + esc(vLabel) + '</strong>';
      } else {
        // Standalone product row — full product name + spec sub-line
        labelHtml = '<strong>' + esc(li.productName || '') + '</strong>' +
          (li.specifications ? '<br><span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(li.specifications) + '</span>' : '');
      }
      liHtml += '<div class="prod-line-item-row" style="' + indentStyle + '">' +
        '<div style="flex:1;">' + labelHtml + '</div>' +
        '<div style="text-align:right;font-size:0.85rem;">' +
          (isEditable ?
            '<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;">' +
              '<input type="number" min="0" value="' + (li.completedQuantity || 0) + '" style="width:42px;text-align:center;padding:2px 4px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);" onblur="updateLineItemProgress(\'' + esc(jobId) + '\',\'' + esc(k) + '\',this.value,null)">' +
              '<span style="color:var(--warm-gray);">/ ' + (li.targetQuantity || 0) + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;margin-top:2px;">' +
              '<span style="font-size:0.72rem;color:#C62828;">loss:</span>' +
              '<input type="number" min="0" value="' + (li.lossQuantity || 0) + '" style="width:42px;text-align:center;padding:2px 4px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.78rem;background:var(--cream);" onblur="updateLineItemProgress(\'' + esc(jobId) + '\',\'' + esc(k) + '\',null,this.value)">'  +
            '</div>'
          :
            (li.completedQuantity || 0) + '/' + (li.targetQuantity || 0) +
            (li.lossQuantity > 0 ? ' <span style="color:#C62828;">(-' + li.lossQuantity + ')</span>' : '') +
            '<br><span style="font-size:0.72rem;color:var(--warm-gray);">' + pct + '%</span>'
          ) +
        '</div>' +
        (status !== 'completed' && status !== 'cancelled' ? '<div style="margin-left:8px;"><button class="btn btn-secondary" style="font-size:0.72rem;padding:2px 8px;" onclick="removeLineItem(\'' + esc(jobId) + '\', \'' + esc(k) + '\')">×</button></div>' : '') +
      '</div>';
    });
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
        '<div style="font-size:0.85rem;color:var(--warm-gray);">' +
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
    '<button class="btn btn-primary" style="padding:14px 18px;font-size:0.9rem;" onclick="startBuild(\'' + esc(jobId) + '\')">&#x1F525; Start Build</button>' : '';
  var activeBuildBtn = hasActiveBuild ?
    '<button class="btn btn-primary" style="padding:14px 18px;font-size:0.9rem;" onclick="openActiveBuild(\'' + esc(jobId) + '\', \'' + esc(buildKeys.find(function(k) { return builds[k].status === 'draft'; })) + '\')">&#x1F3AD; Continue Active Build</button>' : '';

  el.innerHTML = '<button class="detail-back" onclick="backToProductionList()">&#8592; Back to Jobs</button>' +
    '<div style="margin-bottom:16px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">' +
        '<div>' +
          '<h2 style="margin:0 0 8px 0;font-family:\'Cormorant Garamond\',serif;">' + esc(job.name || 'Untitled') + '</h2>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<span class="status-badge" style="' + purposeBadgeStyle(job.purpose) + '">' + (PURPOSE_LABELS[job.purpose] || '') + '</span>' +
            '<span class="status-badge prod-status-pill ' + status + '">' + status.replace('-', ' ') + '</span>' +
            '<span class="prod-priority-dot ' + (job.priority || 'medium') + '"></span>' +
            '<span style="font-size:0.85rem;text-transform:capitalize;">' + (job.priority || 'medium') + '</span>' +
            deadlineHtml + eventHtml +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          statusBtns +
          ' <button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="openEditJobModal(\'' + esc(jobId) + '\')">Edit</button>' +
        '</div>' +
      '</div>' +
      (job.description ? '<p style="margin-top:8px;font-size:0.85rem;color:var(--warm-gray);">' + esc(job.description) + '</p>' : '') +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:0.85rem;color:var(--warm-gray);">' +
        (job.workType ? '<span><strong style="color:var(--text-secondary);">Type:</strong> ' + esc(job.workType.charAt(0).toUpperCase() + job.workType.slice(1)) + '</span>' : '') +
        (job.createdAt ? '<span><strong style="color:var(--text-secondary);">Created:</strong> ' + MastFormat.date(job.createdAt) + '</span>' : '') +
        (job.startedAt ? '<span><strong style="color:var(--text-secondary);">Started:</strong> ' + MastFormat.date(job.startedAt) + '</span>' : '') +
        (job.completedAt ? '<span><strong style="color:var(--text-secondary);">Completed:</strong> ' + MastFormat.date(job.completedAt) + '</span>' : '') +
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

    renderCostTracking(jobId, job) +

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
            invIndicators += '<div style="font-size:0.85rem;' + style + '">Build #' + (b.buildNumber || '?') + ': ' + pushed + '</div>';
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
  if (newStatus === 'cancelled' && !await mastConfirm('Cancel this job?', { title: 'Cancel Job', danger: true })) return;
  try {
    var updates = { status: newStatus };
    var now = new Date().toISOString();
    var job = productionJobs[jobId];
    var lineItems = job ? (job.lineItems || {}) : {};

    if (newStatus === 'in-progress') {
      updates.startedAt = now;
      // Increment incoming for each line item with a product
      for (var liKey of Object.keys(lineItems)) {
        var li = lineItems[liKey];
        if (!li.productId || !(li.targetQuantity > 0)) continue;
        try {
          await MastDB.transaction(MastDB.inventory.stockIncomingPath(li.productId), function(current) { return (current || 0) + (li.targetQuantity || 0); });
          await MastDB.push('admin/inventory/' + li.productId + '/history', {
            action: 'incoming', reason: 'production_started', qty: li.targetQuantity,
            jobId: jobId, actor: 'maker', actorType: 'maker', timestamp: now
          });
          await syncStockInfoToPublic(li.productId);
        } catch (e) { console.error('Incoming increment error for ' + li.productId + ':', e); }
      }
    }

    if (newStatus === 'completed') {
      updates.completedAt = now;
      // Phase 6a.3: double-push guard. If ANY build on this job already set
      // inventoryPushed:true (via autoUpdateInventory at build-completion time),
      // skip the job-level inventory push entirely — it would double-count.
      // Still record completedAt and history for loss entries below.
      var buildsMap = job ? (job.builds || {}) : {};
      var anyBuildPushed = false;
      for (var bId of Object.keys(buildsMap)) {
        if (buildsMap[bId] && buildsMap[bId].inventoryPushed) { anyBuildPushed = true; break; }
      }
      // Auto-update inventory: decrement incoming, increment onHand
      var invCount = 0;
      if (anyBuildPushed) {
        console.log('transitionProductionJob(completed): skipping job-level inventory push — per-build push already ran (jobId=' + jobId + ')');
      } else {
        for (var liKey of Object.keys(lineItems)) {
          var li = lineItems[liKey];
          if (!li.productId || !(li.completedQuantity > 0)) continue;
          var qty = (li.completedQuantity || 0) - (li.lossQuantity || 0);
          try {
            // Channel-First Phase 1d (D42) — push to per-variant stock when line targets a variant
            var liVariantKey = li.variantId || null; // stockOnHand defaults to '_default' when null
            // Decrement incoming by target quantity (what was planned)
            await MastDB.transaction(MastDB.inventory.stockIncomingPath(li.productId, liVariantKey), function(current) { return Math.max(0, (current || 0) - (li.targetQuantity || 0)); });
            // Increment onHand by actual completed (minus loss)
            if (qty > 0) {
              await MastDB.transaction(MastDB.inventory.stockOnHandPath(li.productId, liVariantKey), function(current) { return (current || 0) + qty; });
              await MastDB.push('admin/inventory/' + li.productId + '/history', {
                action: 'adjusted', reason: 'production_completed', qty: qty,
                variantId: liVariantKey,
                jobId: jobId, actor: 'maker', actorType: 'maker', timestamp: now
              });
              invCount++;
            }
            // Log loss separately if any
            if ((li.lossQuantity || 0) > 0) {
              await MastDB.push('admin/inventory/' + li.productId + '/history', {
                action: 'adjusted', reason: 'production_loss', qty: -(li.lossQuantity),
                jobId: jobId, actor: 'maker', actorType: 'maker', timestamp: now
              });
            }
            await writeAudit('update', 'inventory', li.productId);
            await syncStockInfoToPublic(li.productId);
          } catch (e) { console.error('Inventory update error for ' + li.productId + ':', e); }
        }
      }
    }

    if (newStatus === 'cancelled') {
      // Decrement incoming for any in-progress job being cancelled
      if (job && job.status === 'in-progress') {
        for (var liKey of Object.keys(lineItems)) {
          var li = lineItems[liKey];
          if (!li.productId || !(li.targetQuantity > 0)) continue;
          try {
            await MastDB.transaction(MastDB.inventory.stockIncomingPath(li.productId), function(current) { return Math.max(0, (current || 0) - (li.targetQuantity || 0)); });
            await MastDB.push('admin/inventory/' + li.productId + '/history', {
              action: 'adjusted', reason: 'production_cancelled', qty: -(li.targetQuantity),
              jobId: jobId, actor: 'maker', actorType: 'maker', timestamp: now
            });
            await syncStockInfoToPublic(li.productId);
          } catch (e) { console.error('Incoming decrement error for ' + li.productId + ':', e); }
        }
      }
    }

    await MastDB.productionJobs.update(jobId, updates);
    await writeAudit('update', 'jobs', jobId);
    if (newStatus === 'completed' && invCount > 0) {
      showToast('Job completed — ' + MastFormat.countNoun(invCount, 'product') + ' updated in inventory');
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
    await MastDB.productionJobs.updateLineItem(jobId, liKey, updates);
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
  var html = '<div style="max-width:450px;padding:24px;">' +
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
    await MastDB.productionJobs.update(jobId, {
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
  var html = '<div style="max-width:400px;padding:24px;">' +
    '<h3>Add Line Item</h3>' +
    '<div class="form-group"><label>Product</label><select id="liProductPicker" onchange="onLineItemProductSelect()" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">' + productOptions + '</select></div>' +
    '<div class="form-group"><label>Product Name</label><input type="text" id="liProductName" placeholder="Product name"></div>' +
    // Channel-First Phase 1d (D42) — variant picker. Hidden when product has no variants;
    // populated + made required when a variant product is selected.
    '<div class="form-group" id="liVariantWrap" style="display:none;"><label>Variant <span style="color:var(--danger);">*</span></label>' +
      '<select id="liVariantPicker" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;"></select>' +
    '</div>' +
    '<div class="form-group"><label>Target Quantity</label><input type="number" id="liTargetQty" min="1" value="1" style="width:100px;"></div>' +
    '<div class="form-group"><label>Specifications</label><input type="text" id="liSpecs" placeholder="Color, size, notes..."></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="doAddLineItem(\'' + esc(jobId) + '\')">Add</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

// Channel-First Phase 1d (D42) — when product changes, populate variant dropdown if applicable.
function onLineItemProductSelect() {
  var picker = document.getElementById('liProductPicker');
  var nameInput = document.getElementById('liProductName');
  var variantWrap = document.getElementById('liVariantWrap');
  var variantPicker = document.getElementById('liVariantPicker');
  if (picker.value && productsData && productsData.length) {
    var match = productsData.find(function(p) { return p.pid === picker.value; });
    if (match) nameInput.value = match.name || '';
    var variants = (match && Array.isArray(match.variants)) ? match.variants : [];
    if (variants.length > 0) {
      var opts = '<option value="">-- Pick a variant --</option>';
      variants.forEach(function(v) {
        if (!v || !v.id) return;
        var label = v.combo
          ? Object.keys(v.combo).map(function(k){ return v.combo[k]; }).filter(Boolean).join(' / ')
          : (v.name || v.id);
        opts += '<option value="' + esc(v.id) + '">' + esc(label) + '</option>';
      });
      variantPicker.innerHTML = opts;
      variantWrap.style.display = '';
    } else {
      variantWrap.style.display = 'none';
      variantPicker.innerHTML = '';
    }
  } else if (variantWrap) {
    variantWrap.style.display = 'none';
    variantPicker.innerHTML = '';
  }
}

/**
 * Snapshot a per-unit BOM forecast from a product's active recipe, if one exists.
 * Returns { recipeId, recipeVersion, recipeName, variantId, materialCostPerUnitCents,
 *           laborCostPerUnitCents, laborMinutesPerUnit, totalCostPerUnitCents, snapshotAt }
 * or null.
 * Snapshot is taken at add-time so later recipe edits don't ripple into existing jobs (D48).
 * Channel-First Phase 1d: variantId param pulls the matching recipe variant's totals
 * instead of the legacy "first variant as representative" heuristic.
 */
async function snapshotBomForecast(productId, variantId) {
  if (!productId) return null;
  try {
    var recipes = (await MastDB.recipes.list(200)) || {};
    var recipe = null;
    Object.keys(recipes).forEach(function(rid) {
      var r = recipes[rid];
      if (!r || r.status === 'archived') return;
      if (r.productId === productId && !recipe) recipe = r;
    });
    if (!recipe) return null;
    var totalCost = recipe.totalCost || 0;
    var materialCost = recipe.totalMaterialCost || 0;
    var laborCost = recipe.laborCost || 0;
    var laborMinutes = recipe.laborMinutes || 0;
    if (recipe.variants && variantId && recipe.variants[variantId]) {
      // Phase 1d — pull the matching variant's costs (D42 / D48)
      var v = recipe.variants[variantId];
      totalCost = v.totalCost || totalCost;
      materialCost = v.totalMaterialCost || materialCost;
      laborMinutes = v.laborMinutes || laborMinutes;
      laborCost = Math.round((laborMinutes / 60) * (recipe.laborRatePerHour || 0) * 100) / 100;
    } else if (recipe.isVariantEnabled && recipe.variants && !variantId) {
      // Legacy fallback: no variantId provided, take first variant as representative.
      // Should be rare after Phase 1d (line items now carry variantId for variant products).
      var firstKey = Object.keys(recipe.variants)[0];
      if (firstKey) {
        var fv = recipe.variants[firstKey];
        totalCost = fv.totalCost || totalCost;
        materialCost = fv.totalMaterialCost || materialCost;
        laborMinutes = fv.laborMinutes || laborMinutes;
        laborCost = Math.round((laborMinutes / 60) * (recipe.laborRatePerHour || 0) * 100) / 100;
      }
    }
    return {
      recipeId: recipe.recipeId || null,
      // Channel-First Phase 1d (D48) — freeze recipe version on the line item
      recipeVersion: typeof recipe.version === 'number' ? recipe.version : 1,
      recipeName: recipe.name || '',
      variantId: variantId || null,
      materialCostPerUnitCents: Math.round(materialCost * 100),
      laborCostPerUnitCents: Math.round(laborCost * 100),
      laborMinutesPerUnit: laborMinutes,
      totalCostPerUnitCents: Math.round(totalCost * 100),
      snapshotAt: new Date().toISOString()
    };
  } catch (err) {
    console.warn('snapshotBomForecast failed:', err);
    return null;
  }
}

/**
 * Compute and render the cost-tracking section: budgeted vs actual material/labor/total.
 * Pulls per-line-item bomForecast snapshots and reconciles against completed quantities
 * and any operator-entered actual overrides.
 */
function renderCostTracking(jobId, job) {
  if (!job) return '';
  var lineItems = job.lineItems || {};
  var liKeys = Object.keys(lineItems);
  if (liKeys.length === 0) return '';

  // Skip if no line item has any forecast at all
  var anyForecast = liKeys.some(function(k) { return lineItems[k] && lineItems[k].bomForecast; });
  if (!anyForecast) {
    return '<div class="prod-detail-section">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
        '<strong>Cost Tracking</strong>' +
      '</div>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">No BOM forecast available. Line items added before recipes existed have no cost snapshot. Re-add line items to capture forecasts.</p>' +
    '</div>';
  }

  var totalBudgetMaterialCents = 0;
  var totalBudgetLaborCents = 0;
  var totalActualMaterialCents = 0;
  var totalActualLaborCents = 0;

  var rows = '';
  liKeys.forEach(function(k) {
    var li = lineItems[k];
    var f = li.bomForecast;
    var target = li.targetQuantity || 0;
    var completed = li.completedQuantity || 0;
    if (!f) {
      rows += '<tr><td style="padding:6px 8px;font-size:0.85rem;">' + esc(li.productName || '') + '</td>' +
        '<td colspan="6" style="padding:6px 8px;font-size:0.78rem;color:var(--warm-gray-light);font-style:italic;">no recipe forecast</td></tr>';
      return;
    }
    var budMatCents = (f.materialCostPerUnitCents || 0) * target;
    var budLabCents = (f.laborCostPerUnitCents || 0) * target;
    var actMatCents = li.actualMaterialCostCents != null
      ? li.actualMaterialCostCents
      : (f.materialCostPerUnitCents || 0) * completed;
    var actLabCents = li.actualLaborCostCents != null
      ? li.actualLaborCostCents
      : (f.laborCostPerUnitCents || 0) * completed;

    totalBudgetMaterialCents += budMatCents;
    totalBudgetLaborCents += budLabCents;
    totalActualMaterialCents += actMatCents;
    totalActualLaborCents += actLabCents;

    var actMatOverride = li.actualMaterialCostCents != null ? ' style="background:rgba(196,133,60,0.08);"' : '';
    var actLabOverride = li.actualLaborCostCents != null ? ' style="background:rgba(196,133,60,0.08);"' : '';

    rows += '<tr>' +
      '<td style="padding:6px 8px;font-size:0.85rem;">' + esc(li.productName || '') + '<div style="font-size:0.72rem;color:var(--warm-gray-light);">' + completed + '/' + target + ' done</div></td>' +
      '<td style="text-align:right;padding:6px 8px;font-family:monospace;font-size:0.85rem;">$' + MastFormat.moneyRaw(budMatCents, { cents: true }) + '</td>' +
      '<td style="text-align:right;padding:6px 8px;">' +
        '<input type="number" step="0.01" min="0" value="' + MastFormat.moneyRaw(actMatCents, { cents: true }) + '" ' + actMatOverride +
        ' style="width:80px;text-align:right;padding:3px 6px;border:1px solid var(--cream-dark);border-radius:4px;font-family:monospace;font-size:0.85rem;background:var(--cream);color:var(--text-primary);"' +
        ' onchange="setLineItemActual(\'' + esc(jobId) + '\',\'' + esc(k) + '\',\'material\',this.value)"' +
        ' title="Actual material cost. Defaults to forecast × completed; type to override.">' +
      '</td>' +
      '<td style="text-align:right;padding:6px 8px;font-family:monospace;font-size:0.85rem;">$' + MastFormat.moneyRaw(budLabCents, { cents: true }) + '</td>' +
      '<td style="text-align:right;padding:6px 8px;">' +
        '<input type="number" step="0.01" min="0" value="' + MastFormat.moneyRaw(actLabCents, { cents: true }) + '" ' + actLabOverride +
        ' style="width:80px;text-align:right;padding:3px 6px;border:1px solid var(--cream-dark);border-radius:4px;font-family:monospace;font-size:0.85rem;background:var(--cream);color:var(--text-primary);"' +
        ' onchange="setLineItemActual(\'' + esc(jobId) + '\',\'' + esc(k) + '\',\'labor\',this.value)"' +
        ' title="Actual labor cost. Defaults to forecast × completed; type to override.">' +
      '</td>' +
      '<td style="text-align:right;padding:6px 8px;font-family:monospace;font-size:0.85rem;font-weight:600;">$' + MastFormat.moneyRaw(budMatCents + budLabCents, { cents: true }) + '</td>' +
      '<td style="text-align:right;padding:6px 8px;font-family:monospace;font-size:0.85rem;font-weight:600;">$' + MastFormat.moneyRaw(actMatCents + actLabCents, { cents: true }) + '</td>' +
    '</tr>';
  });

  var totalBudget = totalBudgetMaterialCents + totalBudgetLaborCents;
  var totalActual = totalActualMaterialCents + totalActualLaborCents;
  var variance = totalActual - totalBudget;
  var varPct = totalBudget > 0 ? (variance / totalBudget) * 100 : 0;
  var varColor = variance > 0 ? 'var(--danger)' : '#16a34a';
  var varSign = variance >= 0 ? '+' : '';

  return '<div class="prod-detail-section">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<strong>Cost Tracking</strong>' +
      '<span style="font-size:0.78rem;color:var(--warm-gray);">Budgeted from BOM forecast vs actual</span>' +
    '</div>' +
    '<div style="overflow-x:auto;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
        '<thead><tr style="border-bottom:1px solid var(--cream-dark);">' +
          '<th style="text-align:left;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--warm-gray);">Item</th>' +
          '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--warm-gray);">Bud Mat</th>' +
          '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--warm-gray);">Act Mat</th>' +
          '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--warm-gray);">Bud Labor</th>' +
          '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--warm-gray);">Act Labor</th>' +
          '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--warm-gray);">Bud Total</th>' +
          '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--warm-gray);">Act Total</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr style="border-top:2px solid var(--charcoal);font-weight:700;">' +
          '<td style="padding:8px;">Job Total</td>' +
          '<td style="text-align:right;padding:8px;font-family:monospace;">$' + MastFormat.moneyRaw(totalBudgetMaterialCents, { cents: true }) + '</td>' +
          '<td style="text-align:right;padding:8px;font-family:monospace;">$' + MastFormat.moneyRaw(totalActualMaterialCents, { cents: true }) + '</td>' +
          '<td style="text-align:right;padding:8px;font-family:monospace;">$' + MastFormat.moneyRaw(totalBudgetLaborCents, { cents: true }) + '</td>' +
          '<td style="text-align:right;padding:8px;font-family:monospace;">$' + MastFormat.moneyRaw(totalActualLaborCents, { cents: true }) + '</td>' +
          '<td style="text-align:right;padding:8px;font-family:monospace;">$' + MastFormat.moneyRaw(totalBudget, { cents: true }) + '</td>' +
          '<td style="text-align:right;padding:8px;font-family:monospace;">$' + MastFormat.moneyRaw(totalActual, { cents: true }) + '</td>' +
        '</tr></tfoot>' +
      '</table>' +
    '</div>' +
    '<div style="margin-top:10px;text-align:right;font-size:0.85rem;color:' + varColor + ';font-weight:600;">' +
      'Variance: ' + varSign + '$' + MastFormat.moneyRaw(variance, { cents: true }) + ' (' + varSign + varPct.toFixed(1) + '%)' +
    '</div>' +
  '</div>';
}

/**
 * Save an actual cost override (material or labor) on a job line item.
 * Empty value clears the override (reverts to forecast × completed derivation).
 */
async function setLineItemActual(jobId, lineItemId, kind, value) {
  try {
    var cents = (value === '' || value == null) ? null : MastFormat.parseCents(value);
    if (cents != null && (isNaN(cents) || cents < 0)) {
      showToast('Invalid amount', true);
      return;
    }
    var field = kind === 'labor' ? 'actualLaborCostCents' : 'actualMaterialCostCents';
    var updates = {};
    updates[field] = cents;
    await MastDB.productionJobs.updateLineItem(jobId, lineItemId, updates);
    if (productionJobs[jobId] && productionJobs[jobId].lineItems && productionJobs[jobId].lineItems[lineItemId]) {
      productionJobs[jobId].lineItems[lineItemId][field] = cents;
    }
    await writeAudit('update', 'jobs', jobId);
    showToast(cents == null ? 'Override cleared (reverted to forecast)' : 'Actual ' + kind + ' saved');
    // Re-render the detail to refresh totals
    if (typeof renderProductionJobDetail === 'function') renderProductionJobDetail(jobId);
  } catch (err) {
    showToast('Error saving actual: ' + err.message, true);
  }
}

async function doAddLineItem(jobId) {
  var pid = document.getElementById('liProductPicker').value || null;
  var name = document.getElementById('liProductName').value.trim();
  var qty = parseInt(document.getElementById('liTargetQty').value) || 1;
  var specs = document.getElementById('liSpecs').value.trim();
  if (!name) { showToast('Enter a product name', true); return; }
  // Channel-First Phase 1d (D42) — variantId mandatory when product has variants
  var variantId = null;
  var variantLabel = null;
  if (pid && productsData) {
    var prod = productsData.find(function(p) { return p.pid === pid; });
    if (prod && Array.isArray(prod.variants) && prod.variants.length > 0) {
      var picker = document.getElementById('liVariantPicker');
      variantId = picker ? picker.value : null;
      if (!variantId) { showToast('Pick a variant for this product', true); return; }
      var v = prod.variants.find(function(x) { return x && x.id === variantId; });
      if (v && v.combo) {
        variantLabel = Object.keys(v.combo).map(function(k){ return v.combo[k]; }).filter(Boolean).join(' / ');
      }
    }
  }
  try {
    // Single-sourced write — ProductionBridge.addLineItem snapshots the BOM
    // forecast (D48) and persists the line item; jobs-v2's native add calls it too.
    var res = await window.ProductionBridge.addLineItem(jobId, {
      productId: pid,
      productName: name,
      variantId: variantId,       // Channel-First Phase 1d (D42)
      variantLabel: variantLabel,
      targetQuantity: qty,
      specifications: specs
    });
    var bomForecast = res && res.bomForecast;
    closeModal();
    showToast(bomForecast
      ? 'Line item added with BOM forecast ($' + MastFormat.moneyRaw(bomForecast.totalCostPerUnitCents, { cents: true }) + '/unit)'
      : 'Line item added');
  } catch (err) {
    showToast('Error adding line item: ' + err.message, true);
  }
}

async function removeLineItem(jobId, lineItemId) {
  if (!await mastConfirm('Remove this line item?', { title: 'Remove Line Item' })) return;
  try {
    await writeAudit('update', 'jobs', jobId);
    await MastDB.productionJobs.removeLineItem(jobId, lineItemId);
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
  var html = '<div style="max-width:400px;padding:24px;">' +
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
    var pushResult = await MastDB.productionJobs.pushBuild(jobId, {
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
    var buildId = pushResult.key;
    await writeAudit('update', 'jobs', jobId);

    // Auto-transition job to in-progress if still in definition
    if (job.status === 'definition') {
      await MastDB.productionJobs.update(jobId, {
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
      '<p style="color:var(--teal);font-size:1.15rem;font-weight:600;">' + elapsed + '</p>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;">Operators: ' + (build.operators || []).map(esc).join(', ') + '</p>' +
    '</div>' +

    '<div style="text-align:center;margin:24px 0;">' +
      '<button class="btn btn-primary" style="padding:16px 28px;font-size:1.15rem;border-radius:12px;" onclick="capturePhoto(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">' +
        '&#x1F4F7; Capture Photo</button>' +
      '<input type="file" id="buildPhotoInput" accept="image/*" capture="environment" multiple style="display:none;" ' +
        'onchange="handlePhotoUpload(this, \'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">' +
    '</div>' +

    '<div id="buildMediaGallery" class="media-gallery" style="margin-bottom:24px;"></div>' +

    '<div style="display:flex;gap:12px;justify-content:center;margin:24px 0;flex-wrap:wrap;">' +
      '<button class="btn btn-secondary" style="padding:14px 18px;font-size:0.9rem;" onclick="addBuildNote(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">&#x1F4DD; Add Note</button>' +
      '<button class="btn btn-secondary" style="padding:14px 18px;font-size:0.9rem;" onclick="addBuildMilestone(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">&#x2B50; Add Milestone</button>' +
    '</div>' +

    (build.notes ? '<div class="prod-detail-section"><strong>Notes</strong><p style="margin-top:8px;font-size:0.85rem;white-space:pre-wrap;">' + esc(build.notes) + '</p></div>' : '') +

    (milestoneKeys.length > 0 ? '<div class="prod-detail-section"><strong>Milestones</strong><div style="margin-top:8px;">' + milestonesHtml + '</div></div>' : '') +

    '<div style="text-align:center;margin-top:32px;">' +
      '<button class="btn btn-primary" style="padding:14px 18px;font-size:0.9rem;min-width:200px;" onclick="openCompleteBuild(\'' + esc(jobId) + '\', \'' + esc(buildId) + '\')">&#x2705; Complete Build</button>' +
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
  var html = '<div style="max-width:400px;padding:24px;">' +
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
    await MastDB.productionJobs.setBuildField(jobId, buildId, 'notes', newNotes);
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
  var html = '<div style="max-width:400px;padding:24px;">' +
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
    await MastDB.push(MastDB.productionJobs.sub(jobId, 'builds', buildId, 'milestones'), { text: text, timestamp: new Date().toISOString() });
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
  var mediaNote = mediaCount > 0 ? '<p style="font-size:0.85rem;color:var(--teal);margin-bottom:12px;">📷 This build has ' + MastFormat.countNoun(mediaCount, 'photo') + '</p>' : '';

  var html = '<div style="max-width:500px;padding:24px;">' +
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
    await MastDB.productionJobs.updateBuild(jobId, buildId, {
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
    var freshJob = await MastDB.productionJobs.get(jobId);
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
      await MastDB.productionJobs.update(jobId, tallyUpdates);

      // Check if all line items met target
      var allMet = true;
      Object.keys(freshJob.lineItems).forEach(function(liKey) {
        var target = freshJob.lineItems[liKey].targetQuantity || 0;
        var completed = tallies[liKey] ? tallies[liKey].completed : 0;
        if (completed < target) allMet = false;
      });
      if (allMet && liKeys.length > 0) {
        if (await mastConfirm('All line items have met their targets! Mark job as completed?', { title: 'Complete Job' })) {
          await MastDB.productionJobs.update(jobId, {
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

    // Fulfillment auto-advance (fulfillment + custom purposes — client-side; not in
    // the Phase 5 cloud function because it touches productionRequest state outside
    // the build/recipe surface).
    if (purpose === 'fulfillment' || purpose === 'custom') {
      var fulfillResults = await autoFulfillLinkedRequests(jobId, freshJob, tallies);
      fulfillResults.forEach(function(r) { summaryItems.push(r); });
    }

    // Channel-First Phase 5 (D44/D45/D46/D47) — server-side completion: material
    // deduction (if trackMaterialInventory on), observedCost rolling-avg recording,
    // auto-push by purpose matrix, build lock + drift alert eval. Replaces the
    // client autoUpdateInventory call. autoFulfillLinkedRequests above handles
    // the productionRequest side; the cloud function handles inventory + recipes.
    try {
      var completeRes = await firebase.functions().httpsCallable('completeBuildJob')({
        tenantId: MastDB.tenantId(),
        jobId: jobId,
        buildId: buildId,
        output: output
      });
      var data = completeRes && completeRes.data;
      if (data && data.alreadyCompleted) {
        summaryItems.push('ℹ️ Build was already completed (idempotent re-call)');
      } else if (data) {
        if (data.autoPushed && data.autoPushed.length) {
          data.autoPushed.forEach(function(p) {
            var label = p.productId + (p.variantId ? ' (' + p.variantId + ')' : '');
            summaryItems.push('📦 Inventory +' + p.qty + ' ' + label + (p.linkedShowId ? ' [show:' + p.linkedShowId + ']' : ''));
          });
        }
        if (data.materialsDeducted && data.materialsDeducted.length) {
          summaryItems.push('🧪 Materials deducted: ' + data.materialsDeducted.length + ' line(s)');
        }
        if (data.driftAlertsFired && data.driftAlertsFired.length) {
          data.driftAlertsFired.forEach(function(a) {
            summaryItems.push('⚠️ Recipe ' + a.recipeId + ' cost drifted ' + a.driftPct.toFixed(1) + '% — alert fired');
          });
        }
        if (data.warnings && data.warnings.length) {
          data.warnings.forEach(function(w) { summaryItems.push('⚠️ ' + w); });
        }
      }
    } catch (cfErr) {
      console.error('completeBuildJob failed:', cfErr);
      summaryItems.push('⚠️ Server completion failed: ' + (cfErr.message || cfErr) + ' — inventory + observed cost not updated');
      showToast('Server completion failed — see summary', true);
    }

    // Custom piece story prompt
    if (purpose === 'custom' && freshJob) {
      var hasStory = false;
      try {
        var storyCheck = await MastDB.stories.queryByJob(jobId);
        if (storyCheck) {
          Object.values(storyCheck).forEach(function(s) {
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
      var req = await MastDB.productionRequests.get(li.productionRequestId);
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
      await MastDB.productionJobs.updateLineItem(jobId, liKey, { requestFulfilled: true });
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
    var alreadyPushed = await MastDB.productionJobs.getBuildField(jobId, buildId, 'inventoryPushed');
    if (alreadyPushed) return results; // already pushed
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
      // Channel-First Phase 1d (D42) — push to per-variant stock when line targets a variant
      var liVariantKey = li.variantId || null;
      await MastDB.transaction(MastDB.inventory.stockOnHandPath(li.productId, liVariantKey), function(current) {
        return (current || 0) + qty;
      });
      var label = (li.variantLabel ? ' (' + li.variantLabel + ')' : '');
      results.push('📦 Inventory +' + qty + ' ' + (li.productName || 'item') + label);
    } catch (e) {
      console.error('Inventory update error:', e);
    }
  }

  // Set guard flag
  if (results.length > 0) {
    await MastDB.productionJobs.setBuildField(jobId, buildId, 'inventoryPushed', true);
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
    '<h3 style="margin:0 0 16px;font-size:1.15rem;">Build Completed</h3>' +
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
    var mediaId = MastDB.newKey('_ids');
    var galleryEl = document.getElementById('buildMediaGallery');

    // Create placeholder thumbnail with progress
    if (galleryEl) {
      var placeholder = document.createElement('div');
      placeholder.className = 'media-thumb';
      placeholder.id = 'upload_' + mediaId;
      placeholder.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--warm-gray);font-size:0.78rem;">Uploading...</div>' +
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
    await MastDB.buildMedia.set(buildId, mediaId, {
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
    var media = (await MastDB.buildMedia.get(buildId)) || {};
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
    el.innerHTML = '<p style="font-size:0.85rem;color:var(--warm-gray);text-align:center;grid-column:1/-1;">No photos yet. Tap the camera button to capture build photos.</p>';
    return;
  }
  el.innerHTML = '<div style="grid-column:1/-1;font-size:0.85rem;color:var(--warm-gray);margin-bottom:4px;">' + MastFormat.countNoun(keys.length, 'photo') + '</div>' +
    keys.map(function(k) {
      var m = media[k];
      return '<div class="media-thumb">' +
        '<img src="' + esc(m.url) + '" alt="Build photo" onclick="previewPhoto(\'' + esc(m.url) + '\')">' +
        '<button class="delete-media" onclick="event.stopPropagation();deleteBuildMedia(\'' + esc(buildId) + '\', \'' + esc(k) + '\')">×</button>' +
      '</div>';
    }).join('');
}

function updateBuildMediaCount(buildId) {
  MastDB.buildMedia.get(buildId).then(function(media) {
    var count = media ? Object.keys(media).length : 0;
    var badge = document.getElementById('buildMediaBadge_' + buildId);
    if (badge) {
      badge.textContent = '📷 ' + count;
      badge.style.display = count > 0 ? '' : 'none';
    }
  });
}

async function deleteBuildMedia(buildId, mediaId) {
  if (!await mastConfirm('Delete this photo?', { title: 'Delete Photo', danger: true })) return;
  try {
    await writeAudit('update', 'jobs', selectedProductionJobId || buildId);
    await storage.ref(MastDB.storagePath('builds/' + buildId + '/' + mediaId + '.jpg')).delete();
    await MastDB.buildMedia.remove(buildId, mediaId);
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
    var media = (await MastDB.buildMedia.get(buildId)) || {};
    var count = Object.keys(media).length;
    var badge = document.getElementById('buildMediaBadge_' + buildId);
    if (badge && count > 0) {
      badge.textContent = '📷 ' + count;
      badge.style.display = '';
      // Also make build card clickable to expand photos
      var thumbs = document.getElementById('buildMediaThumbs_' + buildId);
      if (thumbs) {
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
        var req = await MastDB.productionRequests.get(li.productionRequestId);
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
      ? '<span style="font-size:0.78rem;color:var(--warm-gray);">Published ' + getTimeAgo(s.publishedAt) + '</span>'
      : '<span style="font-size:0.78rem;color:var(--warm-gray);">Updated ' + getTimeAgo(s.updatedAt || s.createdAt) + '</span>';

    html += '<div class="prod-job-card" onclick="viewStoryDetail(\'' + esc(s._key) + '\')" style="display:flex;gap:12px;align-items:flex-start;">' +
      (thumbUrl ? '<div style="width:60px;height:60px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--cream);">' +
        '<img src="' + esc(thumbUrl) + '" style="width:100%;height:100%;object-fit:cover;" alt="">' +
      '</div>' : '<div style="width:60px;height:60px;border-radius:6px;flex-shrink:0;background:var(--cream);display:flex;align-items:center;justify-content:center;font-size:1.6rem;">📖</div>') +
      '<div style="flex:1;min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
          '<strong style="font-size:0.9rem;">' + esc(s.title || 'Untitled Story') + '</strong>' +
          '<span class="status-badge prod-status-pill" style="background:' + statusColor + ';color:white;font-size:0.72rem;padding:1px 8px;border-radius:4px;">' + statusLabel + '</span>' +
        '</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);">' +
          (jobName ? '🔗 ' + esc(jobName) + ' · ' : '') +
          MastFormat.countNoun(entryCount, 'entry', 'entries') +
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
  // If we were pushed here from another route (e.g., a job), pop back to it
  if (window.MastNavStack && MastNavStack.size() > 0) {
    MastNavStack.popAndReturn();
    return;
  }
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

  // Action bar — Add photos · Edit always available (the unified editor
  // supports job-linked, composer-spawned, and freeform-orphan stories).
  // Routes through openStoryEditor which resolves the right context from
  // the story doc itself.
  var actions = '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="previewStory(\'' + esc(storyId) + '\')">👁 Preview</button> ';
  actions += '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 10px;" onclick="openStoryEditor(\'' + esc(storyId) + '\')">📸 Add photos · Edit</button> ';
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
      '<span style="font-size:0.85rem;color:var(--warm-gray);">' + MastFormat.countNoun(entryCount, 'entry', 'entries') + '</span>' +
      (story.publishedAt ? '<span style="font-size:0.85rem;color:var(--warm-gray);">Published ' + getTimeAgo(story.publishedAt) + '</span>' : '') +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">' + actions + '</div>';

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
        html += '<div style="width:80px;height:80px;border-radius:6px;flex-shrink:0;background:var(--cream);display:flex;align-items:center;justify-content:center;font-size:0.78rem;color:var(--warm-gray);">Text</div>';
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
      '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">No entries yet. ' +
        'Click <strong>📸 Add photos · Edit</strong> above to ' +
        (jobId ? 'pick build photos, upload new ones, ' : 'upload photos ') +
        'and add captions.' +
      '</p>' +
    '</div>';
  }

  // Operators
  if (story.operators && story.operators.length > 0) {
    html += '<div class="prod-detail-section"><strong>Artists</strong>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">';
    story.operators.forEach(function(op) {
      var opName = operators[op] ? (operators[op].name || op) : op;
      html += '<span style="background:var(--cream);padding:4px 10px;border-radius:12px;font-size:0.85rem;">' + esc(opName) + '</span>';
    });
    html += '</div></div>';
  }

  // QR Codes
  if (story.qrCodes && story.qrCodes.length > 0) {
    html += '<div class="prod-detail-section"><strong>QR Codes</strong>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);margin:4px 0 12px;">Scan to view the product page with this story.</p>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;">';
    story.qrCodes.forEach(function(qr) {
      html += '<div style="text-align:center;background:white;padding:12px;border-radius:8px;border:1px solid var(--cream-dark);">' +
        '<img src="' + esc(qr.dataUrl) + '" style="width:150px;height:150px;" alt="QR Code">' +
        '<div style="font-size:0.85rem;font-weight:600;margin-top:6px;">' + esc(qr.productName) + '</div>' +
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
    'img{width:250px;height:250px;}h3{margin:16px 0 4px;font-size:1rem;}p{font-size:0.78rem;color:#666;}</style></head><body>' +
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
    mastCopyFallback('Copy this URL', url);
  });
}

var LK_API_URL = 'https://labelkeeper-api-1075204398975.us-central1.run.app';
var _lkApiKeyCache = null;

async function _getLkApiKey() {
  if (_lkApiKeyCache) return _lkApiKeyCache;
  // Check admin path first (UI-saved), then config path (MCP/provisioning)
  var snap = await MastDB.get('admin/config/labelkeeper/apiKey');
  _lkApiKeyCache = snap.val();
  if (!_lkApiKeyCache) {
    snap = await MastDB.get('config/labelkeeper/apiKey');
    _lkApiKeyCache = snap.val();
  }
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

async function generateStoryQRCodes(storyId, jobId, jobObj) {
  // jobObj lets a caller (e.g. StoriesBridge.publish in the V2 twin) pass a
  // freshly-fetched job so QR generation doesn't depend on the legacy in-memory
  // productionJobs cache (which is only populated when the Production route ran).
  var job = jobObj || productionJobs[jobId];
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
  if (!await mastConfirm('Publish this story? It will be visible to customers.', { title: 'Publish Story' })) return;
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

    await MastDB.stories.update(storyId, updates);
    await writeAudit('update', 'products', storyId);

    // Back-fill storyId on linked products
    if (story.jobId) {
      var job = productionJobs[story.jobId];
      if (job && job.lineItems) {
        var productUpdates = [];
        Object.values(job.lineItems).forEach(function(li) {
          if (li.productId && li.productLinked) {
            productUpdates.push(
              MastDB.products.setStoryId(li.productId, storyId)
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
  if (!await mastConfirm('Unpublish this story?', { title: 'Unpublish Story' })) return;
  try {
    var story = storiesData[storyId];
    await MastDB.stories.update(storyId, { status: 'draft', updatedAt: new Date().toISOString() });
    await writeAudit('update', 'products', storyId);

    // Clear storyId from linked products
    if (story && story.jobId) {
      var job = productionJobs[story.jobId];
      if (job && job.lineItems) {
        var clearUpdates = [];
        Object.values(job.lineItems).forEach(function(li) {
          if (li.productId && li.productLinked) {
            clearUpdates.push(
              MastDB.products.removeStoryId(li.productId)
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
    var stories = (await MastDB.stories.queryByJob(jobId)) || {};
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
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 8px;" onclick="previewStory(\'' + esc(storyId) + '\')">Preview</button>' +
        (story.status === 'published' ? '<button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 8px;" onclick="unpublishStory(\'' + esc(storyId) + '\')">Unpublish</button>' : '') +
      '</div>' +
    '</div>';
  } catch (err) {
    el.innerHTML = 'Error loading story status.';
  }
}

// Unified editor entry point for orphan + composer-spawned stories (no jobId).
// Loads the story doc, resolves jobId / sourceContentId from it, and routes to
// openStoryCuration with the right context. When there's no jobId the editor
// renders without the build-media section but with content-images (if
// sourceContentId is set) and the freeform upload section (always).
async function openStoryEditor(storyId) {
  var story = storiesData[storyId];
  if (!story) {
    if (typeof showToast === 'function') showToast('Story not found', true);
    return;
  }
  if (story.jobId) {
    // Job-linked path — preserves existing behaviour. queryByJob picks the
    // same story up so editing-by-job and editing-by-story land in the same
    // editor state.
    return openStoryCuration(story.jobId);
  }
  // Orphan / composer-spawned path — no job context, no build media.
  return openStoryCuration(null, { story: story, storyId: storyId });
}

async function openStoryCuration(jobId, opts) {
  opts = opts || {};
  storyCurationJobId = jobId || null;

  // Determine if we should render inline (on stories tab) or in modal
  var isInline = currentRoute === 'stories';

  var job = jobId ? productionJobs[jobId] : null;
  if (jobId && !job) return; // unknown job id — preserve prior fail-safe

  // Load all media from all builds for this job (only when job-linked).
  var builds = job ? (job.builds || {}) : {};
  var buildKeys = Object.keys(builds).sort(function(a, b) {
    return (builds[a].buildNumber || 0) - (builds[b].buildNumber || 0);
  });

  var allMedia = {};
  if (jobId) {
    for (var i = 0; i < buildKeys.length; i++) {
      var bk = buildKeys[i];
      try {
        var media = await MastDB.buildMedia.get(bk);
        if (media) allMedia[bk] = media;
      } catch (e) { /* skip */ }
    }
  }

  // Resolve existing story: from explicit opts (orphan path) or via queryByJob
  // (job-linked path). queryByJob returns the first existing story for the
  // job, which preserves the prior "one story per job" assumption.
  var existingStory = opts.story || null;
  var existingStoryId = opts.storyId || null;
  if (jobId && !existingStory) {
    try {
      var stories = (await MastDB.stories.queryByJob(jobId)) || {};
      var sKeys = Object.keys(stories);
      if (sKeys.length > 0) {
        existingStoryId = sKeys[0];
        existingStory = stories[sKeys[0]];
      }
    } catch (e) { /* no existing story */ }
  }

  // Resolve content-doc images for composer-spawned stories so the editor
  // can show them as a selectable source. Lazy — only fetch if the story
  // has sourceContentId set.
  var contentImages = [];
  if (existingStory && existingStory.sourceContentId) {
    try {
      var content = await MastDB.get('admin/content/' + existingStory.sourceContentId);
      if (content && Array.isArray(content.images)) {
        contentImages = content.images.filter(function(im) {
          return im && (typeof im === 'string' ? im : im.url);
        }).map(function(im) {
          return typeof im === 'string' ? { url: im } : im;
        });
      }
    } catch (e) { /* content gone — leave empty */ }
  }
  // Composer-spawned stories may have inherited images on the story doc
  // itself (story.images[]) before any entries were built. Merge those in
  // alongside content-doc images so the operator can promote them.
  if (existingStory && Array.isArray(existingStory.images)) {
    existingStory.images.forEach(function(im) {
      if (!im) return;
      var url = typeof im === 'string' ? im : im.url;
      if (!url) return;
      if (!contentImages.some(function(c) { return c.url === url; })) {
        contentImages.push({ url: url });
      }
    });
  }

  var html = buildStoryCurationHtml(job, builds, buildKeys, allMedia, existingStory, existingStoryId, isInline, contentImages);

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
    // Push origin context so back button can return to the job that triggered curation
    if (window.MastNavStack && typeof currentRoute !== 'undefined' && currentRoute && currentRoute !== 'stories') {
      var _fromRoute = currentRoute;
      var _fromLabel = _fromRoute === 'jobs' ? 'Job' : _fromRoute;
      // Navigate first (which clears the stack), then push the origin
      navigateTo('stories');
      MastNavStack.push({ route: _fromRoute, label: _fromLabel });
    } else {
      navigateTo('stories');
    }
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

function buildStoryCurationHtml(job, builds, buildKeys, allMedia, existingStory, existingStoryId, isInline, contentImages) {
  contentImages = contentImages || [];
  var totalBuildPhotos = 0;
  buildKeys.forEach(function(bk) { totalBuildPhotos += Object.keys(allMedia[bk] || {}).length; });

  var html = '';

  // Back button and header
  if (existingStoryId) {
    html += '<button class="detail-back" onclick="viewStoryDetail(\'' + esc(existingStoryId) + '\')">← Back to Story</button>';
  } else {
    html += '<button class="detail-back" onclick="backToStoriesList()">← Back to Stories</button>';
  }

  // Header — provenance label varies by story source. Job-linked, content-
  // spawned, and freeform orphan all use the same editor; the label tells the
  // operator where photos can come from.
  var provenance = '';
  if (job) provenance = 'From job: <strong style="color:var(--text);">' + esc(job.name || 'Untitled') + '</strong>';
  else if (existingStory && existingStory.sourceContentId) provenance = 'From content composer';
  else provenance = 'Freeform story';

  html += '<div class="section-header" style="margin-bottom:4px;">' +
    '<h2>' + (existingStory ? 'Edit Story' : 'Create Story') + '</h2>' +
  '</div>' +
  '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:20px;">' + provenance + '</div>';

  // Title input
  var defaultTitle = '';
  if (existingStory) defaultTitle = existingStory.title || '';
  else if (job) defaultTitle = job.name || '';
  html += '<div class="form-group" style="margin-bottom:20px;">' +
    '<label style="font-weight:600;font-size:0.85rem;margin-bottom:4px;display:block;">Story Title</label>' +
    '<input type="text" id="storyTitle" value="' + esc(defaultTitle) + '" placeholder="Give your story a title..." style="font-size:1rem;width:100%;padding:10px 14px;border:1px solid var(--cream-dark);border-radius:8px;box-sizing:border-box;">' +
  '</div>';

  // Track which photos are already in the draft so source pickers can show
  // selection state consistently across all three sources.
  var selectedMediaIds = {};
  if (existingStory && existingStory.entries) {
    Object.values(existingStory.entries).forEach(function(e) {
      if (e.mediaUrl) selectedMediaIds[e.mediaUrl] = true;
    });
  }

  // ── Source 1: Build media (when job-linked) ──
  if (job && totalBuildPhotos > 0) {
    html += '<div class="prod-detail-section">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<strong>From build media</strong>' +
        '<span style="font-size:0.78rem;color:var(--warm-gray);">' + totalBuildPhotos + ' available</span>' +
      '</div>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 12px;">Tap photos to add or remove them from the story.</p>';

    buildKeys.forEach(function(bk) {
      var b = builds[bk];
      var media = allMedia[bk] || {};
      var mKeys = Object.keys(media).sort(function(a, c) {
        return (media[a].uploadedAt || '').localeCompare(media[c].uploadedAt || '');
      });
      if (mKeys.length === 0) return;
      html += '<div style="margin-bottom:12px;">' +
        '<div style="font-size:0.85rem;font-weight:600;margin-bottom:6px;">Build #' + (b.buildNumber || '?') + ' — ' + (b.sessionDate || '') + ' (' + mKeys.length + ' photos)</div>' +
        '<div class="media-select-grid">';
      mKeys.forEach(function(mk) {
        var m = media[mk];
        var sel = selectedMediaIds[m.url] ? ' selected' : '';
        html += '<div class="media-select-thumb' + sel + '" data-url="' + esc(m.url) + '" data-buildid="' + esc(bk) + '" data-mediaid="' + esc(mk) + '" data-source="build" onclick="toggleStoryMediaSelect(this)">' +
          '<img src="' + esc(m.url) + '" alt="">' +
          '<div class="check-overlay">✓</div>' +
        '</div>';
      });
      html += '</div></div>';
    });

    html += '</div>';
  }

  // ── Source 2: Content images (composer-spawned stories) ──
  if (contentImages.length > 0) {
    html += '<div class="prod-detail-section">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<strong>From content composer</strong>' +
        '<span style="font-size:0.78rem;color:var(--warm-gray);">' + contentImages.length + ' available</span>' +
      '</div>' +
      '<div class="media-select-grid">';
    contentImages.forEach(function(im) {
      var sel = selectedMediaIds[im.url] ? ' selected' : '';
      html += '<div class="media-select-thumb' + sel + '" data-url="' + esc(im.url) + '" data-source="content" onclick="toggleStoryMediaSelect(this)">' +
        '<img src="' + esc(im.url) + '" alt="">' +
        '<div class="check-overlay">✓</div>' +
      '</div>';
    });
    html += '</div></div>';
  }

  // ── Source 3: Upload new (always available) ──
  // Always shown — closes the operator's reported gap (orphan stories had no
  // way to add photos). Uploads land in a story-scoped Storage path and are
  // appended to the draft as entries with source='upload'.
  html += '<div class="prod-detail-section">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<strong>Upload new</strong>' +
      '<label class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;cursor:pointer;">' +
        '<input type="file" accept="image/*" multiple style="display:none;" onchange="uploadStoryMediaFromInput(this, \'' + esc(existingStoryId || '') + '\')">' +
        '+ Add photos' +
      '</label>' +
    '</div>' +
    '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0;">Photos you upload here are tied to this story.' +
      (existingStoryId ? '' : ' (Save the draft first, then upload — uploads need a story ID.)') +
    '</p>' +
    '<div id="storyUploadProgress" style="margin-top:8px;"></div>' +
  '</div>';

  // When there are no available photos from any source AND no entries yet,
  // hint at the upload action (replaces the prior dead-end "no photos" message).
  if (!job && contentImages.length === 0) {
    // Nothing else inferred here — the Upload new section already invites action.
  } else if (job && totalBuildPhotos === 0 && contentImages.length === 0) {
    html += '<div class="prod-detail-section">' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;margin:0;">No build photos for this job yet. Upload photos above, capture them during a build session, or add text-only entries below.</p>' +
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
  var buildId = el.getAttribute('data-buildid') || '';
  var source = el.getAttribute('data-source') || 'build';
  if (el.classList.contains('selected')) {
    // Add entry — source preserves where the photo came from so future
    // editor opens can highlight the right section.
    var id = MastDB.newKey('_ids');
    storyDraft.push({ id: id, mediaUrl: url, milestone: '', caption: '', buildId: buildId, source: source, order: storyDraft.length });
  } else {
    // Remove entry
    storyDraft = storyDraft.filter(function(e) { return e.mediaUrl !== url; });
    // Re-order
    storyDraft.forEach(function(e, i) { e.order = i; });
  }
  renderStoryEntries();
}

function addTextOnlyEntry() {
  var id = MastDB.newKey('_ids');
  storyDraft.push({ id: id, mediaUrl: '', milestone: '', caption: '', buildId: '', order: storyDraft.length });
  renderStoryEntries();
}

function renderStoryEntries() {
  var el = document.getElementById('storyEntriesList');
  if (!el) return;
  if (storyDraft.length === 0) {
    el.innerHTML = '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">Select photos above to add them to the story, or add a text-only entry.</p>';
    return;
  }
  el.innerHTML = storyDraft.map(function(entry, idx) {
    return '<div class="story-entry-card" data-idx="' + idx + '">' +
      (entry.mediaUrl ? '<img class="story-entry-thumb" src="' + esc(entry.mediaUrl) + '">' : '<div class="story-entry-thumb" style="background:#e8e2d8;display:flex;align-items:center;justify-content:center;font-size:0.78rem;color:var(--warm-gray);">Text</div>') +
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
      buildId: e.buildId,
      // Source preserved so the editor and downstream consumers can tell
      // build-media photos apart from content-spawn or freeform-upload.
      // Backward-compat: entries without source default to 'build' on read.
      source: e.source || 'build'
    };
  });
  return {
    jobId: storyCurationJobId,
    title: title,
    entries: entries
  };
}

// Freeform upload — file picker → compress → Storage write → append entry.
// Mirrors the production-job uploadBuildMedia path (see line ~1957) so quotas
// and lifecycle look the same.
async function uploadStoryMediaFromInput(input, storyId) {
  var files = Array.from(input.files || []);
  if (files.length === 0) return;
  input.value = ''; // allow re-selecting the same file later

  if (!storyId) {
    if (typeof showToast === 'function') showToast('Save the draft first, then upload photos.', true);
    return;
  }
  if (typeof storage === 'undefined') {
    if (typeof showToast === 'function') showToast('Storage not ready', true);
    return;
  }

  // compressImage uses createImageBitmap which is raster-only. Skip
  // compression for SVG (and any other vector / not-decodable type) and
  // upload the original blob. The contentType is preserved so the storefront
  // renders the right MIME.
  function _shouldCompress(file) {
    if (!file || !file.type) return false;
    if (file.type === 'image/svg+xml') return false;
    if (file.type === 'image/gif') return false; // preserve animation
    return /^image\//.test(file.type);
  }
  function _extForFile(file) {
    if (!file) return 'bin';
    if (file.type === 'image/svg+xml') return 'svg';
    if (file.type === 'image/png') return 'png';
    if (file.type === 'image/webp') return 'webp';
    if (file.type === 'image/gif') return 'gif';
    // Fallback: pull extension from the filename when we can't infer from MIME.
    var m = (file.name || '').match(/\.([a-z0-9]{1,8})$/i);
    return m ? m[1].toLowerCase() : 'jpg';
  }
  // Authoritative contentType for the stored object. Storage serves whatever
  // we set here; if it's wrong, browsers may refuse to render inline (Safari
  // in particular silently shows a "?" placeholder for an SVG served as
  // application/octet-stream). Prefer file.type when it's a real image MIME,
  // otherwise map from the inferred extension.
  function _contentTypeForFile(file, ext) {
    if (file && file.type && /^image\//.test(file.type)) return file.type;
    var map = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    return map[ext] || 'application/octet-stream';
  }

  var progressEl = document.getElementById('storyUploadProgress');
  var uploadedCount = 0;
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (!/^image\//.test(file.type)) continue;
    var mediaId = MastDB.newKey('_ids');
    var pidNode = null;
    if (progressEl) {
      pidNode = document.createElement('div');
      pidNode.style.cssText = 'font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;';
      pidNode.textContent = 'Uploading ' + file.name + '…';
      progressEl.appendChild(pidNode);
    }
    try {
      // Compress when we can; fall back to the original blob if compression
      // fails (covers SVG, exotic formats, browsers without createImageBitmap).
      var blob = file;
      if (_shouldCompress(file)) {
        try { blob = await compressImage(file); }
        catch (compressErr) {
          console.warn('[story-upload] compressImage failed, uploading original:', compressErr && compressErr.message);
          blob = file;
        }
      }
      var ext = _extForFile(file);
      var contentType = _contentTypeForFile(file, ext);
      var path = MastDB.storagePath('storyMedia/' + storyId + '/' + mediaId + '.' + ext);
      var ref = storage.ref(path);
      var task = ref.put(blob, { contentType: contentType });
      await new Promise(function(resolve, reject) {
        task.on('state_changed',
          function(snap) {
            if (pidNode) {
              var pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
              pidNode.textContent = 'Uploading ' + file.name + '… ' + pct + '%';
            }
          },
          function(err) { reject(err); },
          function() { resolve(); }
        );
      });
      var url = await task.snapshot.ref.getDownloadURL();
      var id = MastDB.newKey('_ids');
      storyDraft.push({ id: id, mediaUrl: url, milestone: '', caption: '', buildId: '', source: 'upload', order: storyDraft.length });
      renderStoryEntries();
      if (pidNode) pidNode.textContent = '✓ ' + file.name;
      uploadedCount++;
    } catch (err) {
      if (pidNode) pidNode.textContent = '✗ ' + file.name + ' — ' + (err && err.message);
    }
  }
  if (uploadedCount > 0 && typeof showToast === 'function') {
    showToast(MastFormat.countNoun(uploadedCount, 'photo') + ' uploaded — save the draft to keep changes.');
  } else if (uploadedCount === 0 && typeof showToast === 'function') {
    showToast('Upload failed for all files. Check the messages above the section.', true);
  }
}
window.uploadStoryMediaFromInput = uploadStoryMediaFromInput;

async function saveDraftStory(existingId) {
  try {
    var data = getStoryData();
    data.status = 'draft';
    data.updatedAt = new Date().toISOString();
    var storyId = existingId;
    if (existingId) {
      await MastDB.stories.update(existingId, data);
      await writeAudit('update', 'products', existingId);
    } else {
      data.createdAt = new Date().toISOString();
      storyId = MastDB.stories.newKey();
      await MastDB.stories.set(storyId, data);
      await writeAudit('update', 'products', storyId);
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
      await MastDB.stories.update(existingId, data);
    } else {
      data.createdAt = new Date().toISOString();
      storyId = MastDB.stories.newKey();
      await MastDB.stories.set(storyId, data);
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
              MastDB.products.setStoryId(li.productId, storyId)
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
  if (!await mastConfirm('Unpublish this story?', { title: 'Unpublish Story' })) return;
  try {
    // Read story to get jobId before unpublishing
    var story = await MastDB.stories.get(storyId);

    await MastDB.stories.update(storyId, { status: 'draft', updatedAt: new Date().toISOString() });
    await writeAudit('update', 'products', storyId);

    // Clear storyId from linked products
    if (story && story.jobId) {
      var job = productionJobs[story.jobId];
      if (job && job.lineItems) {
        var clearUpdates = [];
        Object.values(job.lineItems).forEach(function(li) {
          if (li.productId && li.productLinked) {
            clearUpdates.push(
              MastDB.products.removeStoryId(li.productId)
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
    var story = await MastDB.stories.get(storyId);
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
    var linked = li.productLinked ? '<span style="color:var(--teal);font-size:0.85rem;">✓ Linked</span>' :
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
    var existing = (await MastDB.products.getBuildIds(productId)) || [];
    if (!Array.isArray(existing)) existing = [];
    // Add all build IDs from this job
    var builds = job.builds || {};
    Object.keys(builds).forEach(function(bk) {
      if (existing.indexOf(bk) === -1) existing.push(bk);
    });
    await MastDB.products.setBuildIds(productId, existing);
    // Mark linked on line item
    await MastDB.productionJobs.updateLineItem(jobId, lineItemId, { productLinked: true });
    await writeAudit('update', 'jobs', jobId);

    // Check if a published story exists for this job and write storyId
    var stories = (await MastDB.stories.queryByJob(jobId)) || {};
    Object.keys(stories).forEach(function(sk) {
      if (stories[sk].status === 'published') {
        MastDB.products.setStoryId(productId, sk);
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
  window.openStoryEditor = openStoryEditor;
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

  // ProductionBridge — delegated write path for jobs-v2's native job CREATE +
  // ADD LINE ITEM (both writes lived only in legacy production.js, so the V2
  // surface had no way to start a build without flipping to Legacy UI). The
  // bridge single-sources the exact MastDB writes + BOM-forecast snapshot the
  // legacy modals use; doCreateJob / doAddLineItem now call through it too, so
  // V1 and V2 stay byte-identical on the persisted record shape. No DOM / no
  // legacy in-memory cache (productionJobs) — callable from the V2 twin.
  window.ProductionBridge = {
    // Mirrors doCreateJob's record shape (status:'definition' job skeleton).
    // data: { name, purpose }. Returns the new jobId.
    createJob: async function (data) {
      data = data || {};
      var name = (data.name || '').trim();
      var purpose = data.purpose || 'custom';
      if (!name) throw new Error('Job name is required');
      var jobId = MastDB.productionJobs.newKey();
      await MastDB.productionJobs.set(jobId, {
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
      try { await writeAudit('create', 'jobs', jobId); } catch (e) {}
      return jobId;
    },
    // Mirrors doAddLineItem's line-item shape, including the at-add-time BOM
    // forecast snapshot (D48 — frozen so later recipe edits don't ripple).
    // data: { productId, productName, variantId, variantLabel, targetQuantity,
    //         specifications }. Returns { lineItemId, bomForecast }.
    addLineItem: async function (jobId, data) {
      data = data || {};
      var name = (data.productName || '').trim();
      if (!name) throw new Error('Product name is required');
      var pid = data.productId || null;
      var variantId = data.variantId || null;
      var variantLabel = data.variantLabel || null;
      var qty = parseInt(data.targetQuantity, 10) || 1;
      var specs = (data.specifications || '').trim();
      // Snapshot recipe BOM forecast if the product has an active recipe.
      var bomForecast = await snapshotBomForecast(pid, variantId);
      var lineItemId = MastDB.productionJobs.newLineItemKey(jobId);
      await MastDB.productionJobs.setLineItem(jobId, lineItemId, {
        productId: pid,
        productName: name,
        variantId: variantId,
        variantLabel: variantLabel,
        targetQuantity: qty,
        completedQuantity: 0,
        lossQuantity: 0,
        specifications: specs,
        productionRequestId: null,
        bomForecast: bomForecast,
        actualMaterialCostCents: null,
        actualLaborCostCents: null
      });
      try { await writeAudit('update', 'jobs', jobId); } catch (e) {}
      return { lineItemId: lineItemId, bomForecast: bomForecast };
    },
    // ── Order → production pipeline (closes the loop orders-v2 triage opens) ──
    // orders-v2 triage SEEDS pending build requests under admin/buildJobs
    // (MastDB.productionRequests). These three delegators give jobs-v2 the
    // CONSUME side — the queue + request→job conversion — that previously lived
    // only in the legacy production.js modals (doAssignNewJob/doAssignExistingJob,
    // both DOM-bound + dependent on the in-memory productionRequests cache).
    // All three are DOM-free, fetch the request FRESH (MastDB.productionRequests.get),
    // and reuse the same snapshotBomForecast + resolveVariantFromOptions cores the
    // legacy modals use, so V1 and V2 stay byte-identical on the persisted shape.

    // Read the pending build-request queue. filter defaults to { status: 'pending' }.
    // Returns an array of request docs (each with _key) sorted newest-first; pass
    // filter:{} (or status:'all') for every request. No in-memory cache dependency.
    listRequests: async function (filter) {
      filter = filter || {};
      var wantStatus = ('status' in filter) ? filter.status : 'pending';
      var raw = await MastDB.productionRequests.list();
      raw = raw || {};
      var out = [];
      Object.keys(raw).forEach(function (k) {
        var pr = raw[k];
        if (!pr || typeof pr !== 'object') return;
        if (wantStatus && wantStatus !== 'all' && (pr.status || 'pending') !== wantStatus) return;
        out.push(Object.assign({ _key: k }, pr));
      });
      out.sort(function (a, b) {
        var pa = a.priority === 'urgent' ? 0 : 1;
        var pb = b.priority === 'urgent' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      return out;
    },
    // Convert a pending request into a NEW production job. Wraps doAssignNewJob's
    // core: mint a fulfillment-purpose job skeleton + one line item with a FROZEN
    // BOM forecast (snapshotBomForecast at variant resolved from the request's
    // options), then flip the request to status:'assigned' with jobId/lineItemId
    // (the canonical assignRequestToJob write). Returns { jobId, lineItemId }.
    convertRequestToJob: async function (requestId, opts) {
      opts = opts || {};
      if (!requestId) throw new Error('request id required');
      var pr = await MastDB.productionRequests.get(requestId);
      if (!pr) throw new Error('Build request not found');
      var jobId = MastDB.productionJobs.newKey();
      var lineItemId = MastDB.productionJobs.newLineItemKey(jobId);
      await MastDB.productionJobs.set(jobId, {
        name: 'Order ' + (pr.orderNumber || '') + ' - ' + (pr.productName || 'Fulfillment'),
        description: '',
        purpose: opts.purpose || 'fulfillment',
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
      var resolved = resolveVariantFromOptions(pr.productId, pr.options);
      var bom = await snapshotBomForecast(pr.productId, resolved.variantId);
      await MastDB.productionJobs.setLineItem(jobId, lineItemId, {
        productId: pr.productId || null,
        productName: pr.productName || '',
        variantId: resolved.variantId,
        variantLabel: resolved.variantLabel,
        targetQuantity: pr.qty || 1,
        completedQuantity: 0,
        lossQuantity: 0,
        specifications: pr.options ? Object.values(pr.options).join(', ') : '',
        productionRequestId: requestId,
        bomForecast: bom,
        actualMaterialCostCents: null,
        actualLaborCostCents: null
      });
      try { await writeAudit('create', 'jobs', jobId); } catch (e) {}
      await MastDB.productionRequests.update(requestId, { status: 'assigned', jobId: jobId, lineItemId: lineItemId });
      try { await writeAudit('update', 'buildJobs', requestId); } catch (e) {}
      return { jobId: jobId, lineItemId: lineItemId, bomForecast: bom };
    },
    // Assign a pending request to an EXISTING job. Wraps doAssignExistingJob's
    // core: append one line item (frozen BOM) to the chosen job, then flip the
    // request to status:'assigned' with jobId/lineItemId. Returns { jobId, lineItemId }.
    assignRequestToExistingJob: async function (requestId, jobId) {
      if (!requestId) throw new Error('request id required');
      if (!jobId) throw new Error('job id required');
      var pr = await MastDB.productionRequests.get(requestId);
      if (!pr) throw new Error('Build request not found');
      var job = await MastDB.productionJobs.get(jobId);
      if (!job) throw new Error('Job not found');
      var lineItemId = MastDB.productionJobs.newLineItemKey(jobId);
      var resolved = resolveVariantFromOptions(pr.productId, pr.options);
      var bom = await snapshotBomForecast(pr.productId, resolved.variantId);
      await MastDB.productionJobs.setLineItem(jobId, lineItemId, {
        productId: pr.productId || null,
        productName: pr.productName || '',
        variantId: resolved.variantId,
        variantLabel: resolved.variantLabel,
        targetQuantity: pr.qty || 1,
        completedQuantity: 0,
        lossQuantity: 0,
        specifications: pr.options ? Object.values(pr.options).join(', ') : '',
        productionRequestId: requestId,
        bomForecast: bom,
        actualMaterialCostCents: null,
        actualLaborCostCents: null
      });
      try { await writeAudit('update', 'jobs', jobId); } catch (e) {}
      await MastDB.productionRequests.update(requestId, { status: 'assigned', jobId: jobId, lineItemId: lineItemId });
      try { await writeAudit('update', 'buildJobs', requestId); } catch (e) {}
      return { jobId: jobId, lineItemId: lineItemId, bomForecast: bom };
    }
  };

  // StoriesBridge — delegated write path for stories-v2's native create + light
  // edit (free/trial tenants reach the twin without the curation canvas as their
  // only authoring path). CREATE mints a DRAFT skeleton (title only); EDIT
  // renames it. The photo-curation canvas (entries, captions, QR codes) +
  // publish side effects stay on the Production module — that's the rich bridge,
  // not a create punt. Mirrors saveDraftStory's record shape.
  window.StoriesBridge = {
    create: async function (data) {
      data = data || {};
      var storyId = MastDB.stories.newKey();
      var story = {
        title: (data.title || '').trim(),
        status: 'draft',
        jobId: data.jobId || null,
        entries: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedAt: null
      };
      await MastDB.stories.set(storyId, story);
      return storyId;
    },
    update: async function (id, data) {
      data = data || {};
      var updates = { updatedAt: new Date().toISOString() };
      if (typeof data.title === 'string') updates.title = data.title.trim();
      await MastDB.stories.update(id, updates);
      return updates;
    },
    // Save the full curation draft (title + entries) as a DRAFT. Mirrors
    // saveDraftStory's record shape; the V2 curation canvas (stories-v2) is the
    // single caller. the V2 twin holds the stories edit permission before calling.
    saveEntries: async function (storyId, data) {
      data = data || {};
      var payload = {
        title: (data.title || '').trim(),
        entries: data.entries || {},
        jobId: data.jobId || null,
        status: 'draft',
        updatedAt: new Date().toISOString()
      };
      await MastDB.stories.update(storyId, payload);
      try { await writeAudit('update', 'products', storyId); } catch (e) {}
      return payload;
    },
    // Publish a story — mirrors publishStory's full side effects: operator
    // aggregation + QR codes + product storyId back-fill. Fetches the job FRESH
    // (MastDB.productionJobs.get) so it never depends on the legacy in-memory
    // productionJobs cache. the V2 twin holds the stories edit permission before calling.
    publish: async function (storyId, data) {
      data = data || {};
      var payload = {
        title: (data.title || '').trim(),
        entries: data.entries || {},
        jobId: data.jobId || null,
        status: 'published',
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      var job = null;
      if (payload.jobId) { try { job = await MastDB.productionJobs.get(payload.jobId); } catch (e) {} }
      if (job && job.builds) {
        var ops = {};
        Object.values(job.builds).forEach(function (b) { if (b.operators) b.operators.forEach(function (o) { ops[o] = true; }); });
        payload.operators = Object.keys(ops);
      }
      if (payload.jobId) {
        try { var qr = await generateStoryQRCodes(storyId, payload.jobId, job); if (qr && qr.length) payload.qrCodes = qr; } catch (e) {}
      }
      await MastDB.stories.update(storyId, payload);
      try { await writeAudit('update', 'products', storyId); } catch (e) {}
      if (job && job.lineItems) {
        var ups = [];
        Object.values(job.lineItems).forEach(function (li) { if (li.productId && li.productLinked) ups.push(MastDB.products.setStoryId(li.productId, storyId)); });
        if (ups.length) { try { await Promise.all(ups); } catch (e) { console.error('[StoriesBridge] product storyId back-fill', e); } }
      }
      return payload;
    },
    // Unpublish — mirrors unpublishStory: status→draft + clears the product
    // storyId back-fill. the V2 twin holds the stories edit permission before calling.
    unpublish: async function (storyId) {
      var story = null;
      try { story = await MastDB.stories.get(storyId); } catch (e) {}
      await MastDB.stories.update(storyId, { status: 'draft', updatedAt: new Date().toISOString() });
      try { await writeAudit('update', 'products', storyId); } catch (e) {}
      if (story && story.jobId) {
        var job = null; try { job = await MastDB.productionJobs.get(story.jobId); } catch (e) {}
        if (job && job.lineItems) {
          var ups = [];
          Object.values(job.lineItems).forEach(function (li) { if (li.productId && li.productLinked) ups.push(MastDB.products.removeStoryId(li.productId)); });
          if (ups.length) { try { await Promise.all(ups); } catch (e) { console.error('[StoriesBridge] product storyId clear', e); } }
        }
      }
      return true;
    },
    // Single-sourced freeform photo upload (compress + Storage put) → returns the
    // download URL. Mirrors uploadStoryMediaFromInput's per-file logic; the V2
    // curation canvas manages the draft + progress around it.
    uploadMedia: async function (storyId, file) {
      if (!storyId) throw new Error('story id required');
      if (typeof storage === 'undefined') throw new Error('storage not ready');
      function _shouldCompress(f) { if (!f || !f.type) return false; if (f.type === 'image/svg+xml') return false; if (f.type === 'image/gif') return false; return /^image\//.test(f.type); }
      function _extForFile(f) { if (!f) return 'bin'; if (f.type === 'image/svg+xml') return 'svg'; if (f.type === 'image/png') return 'png'; if (f.type === 'image/webp') return 'webp'; if (f.type === 'image/gif') return 'gif'; var m = (f.name || '').match(/\.([a-z0-9]{1,8})$/i); return m ? m[1].toLowerCase() : 'jpg'; }
      function _ct(f, ext) { if (f && f.type && /^image\//.test(f.type)) return f.type; var map = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }; return map[ext] || 'application/octet-stream'; }
      var mediaId = MastDB.newKey('_ids');
      var blob = file;
      if (_shouldCompress(file)) { try { blob = await compressImage(file); } catch (e) { blob = file; } }
      var ext = _extForFile(file);
      var ref = storage.ref(MastDB.storagePath('storyMedia/' + storyId + '/' + mediaId + '.' + ext));
      await ref.put(blob, { contentType: _ct(file, ext) });
      return await ref.getDownloadURL();
    }
  };
  window.previewStoryFromCuration = previewStoryFromCuration;
  window.previewStory = previewStory;
  window.showStoryPreview = showStoryPreview;
  window.loadJobProductLinks = loadJobProductLinks;
  window.linkProductToBuild = linkProductToBuild;
  window.loadProduction = loadProduction;

  // URL-filter clear (MCP admin-link landings)
  window.clearProductionJobsFilter = function() {
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var clean = {};
    Object.keys(rp || {}).forEach(function(k) {
      if (k !== 'status' && k !== 'purpose' && k !== 'workType' && k !== 'dateFrom' && k !== 'dateTo' && k !== 'jobIds') clean[k] = rp[k];
    });
    if (typeof window.navigateTo === 'function') window.navigateTo('jobs', clean);
    else location.hash = '#jobs';
    setTimeout(function() { if (typeof renderProductionJobs === 'function') renderProductionJobs(); }, 0);
  };
  window.renderProductionJobs = renderProductionJobs;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  function ensureProductionData() {
    if (!productionLoaded) loadProduction();
    if (!productsLoaded) loadProducts();
  }

  // ============================================================
  // W2.2 — Composer hook: story from Content
  // ============================================================
  // Composer can target Stories. The resulting story is "loose" — not
  // bound to a production job — and is marked source='composer' so it can
  // be distinguished from job-driven stories.
  async function storyOpenFromContent(contentId) {
    try {
      var c = await MastDB.get('admin/content/' + contentId);
      if (!c) { if (typeof showToast === 'function') showToast('Content not found', true); return; }
      var storyId = MastDB.stories.newKey();
      await MastDB.stories.set(storyId, {
        id: storyId,
        title: c.title || '',
        body: c.body || '',
        images: c.images || [],
        source: 'composer',
        sourceContentId: contentId,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      if (typeof navigateTo === 'function') navigateTo('stories');
      if (typeof showToast === 'function') showToast('Story drafted from content');
    } catch (e) { console.warn('[stories] openFromContent', e); }
  }
  window.storyOpenFromContent = storyOpenFromContent;

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
        if (productionLoaded) renderProductionJobs();
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
