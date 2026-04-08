/**
 * Shows Module — Find, Apply, Prep, Execute, History
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

var showsLoaded = false;
var showsData = {};
var showsListener = null;
var selectedShowId = null;
var editingShowId = null;
var showSubView = 'apply';

var SHOW_STATUS_COLORS = {
  considering: '#6366f1',
  applied: '#2563eb',
  accepted: '#16a34a',
  waitlisted: '#f59e0b',
  rejected: '#dc2626',
  withdrawn: '#9ca3af'
};

function showStatusBadgeStyle(status) {
  var bg = SHOW_STATUS_COLORS[status] || '#9ca3af';
  return 'background:' + bg + ';color:white;';
}

var SHOW_TYPE_LABELS = {
  juried: 'Juried',
  'pop-up': 'Pop-Up',
  market: 'Market',
  recurring: 'Recurring',
  trade: 'Trade',
  other: 'Other'
};

function updateShowTabBadges() {
  var today = new Date().toISOString().split('T')[0];
  var arr = getShowsArray();
  // Apply: active applications (considering + applied + waitlisted)
  var applyCount = arr.filter(function(s) {
    var st = s.applicationStatus;
    return st === 'considering' || st === 'applied' || st === 'waitlisted';
  }).length;
  // Prep: accepted shows
  var prepCount = arr.filter(function(s) { return s.applicationStatus === 'accepted'; }).length;
  // History: past or terminal
  var historyCount = arr.filter(function(s) {
    var endDate = s.endDate || s.startDate;
    return (endDate && endDate < today) || s.applicationStatus === 'rejected' || s.applicationStatus === 'withdrawn';
  }).length;
  var badges = { apply: applyCount, prep: prepCount, history: historyCount };
  document.querySelectorAll('#showSubNav .view-tab').forEach(function(tab) {
    var view = tab.getAttribute('data-show-view');
    var count = badges[view];
    var badge = tab.querySelector('.show-tab-badge');
    if (count && count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'show-tab-badge';
        badge.style.cssText = 'font-size:0.7rem;background:var(--text-secondary, #888);color:white;padding:1px 6px;border-radius:8px;margin-left:4px;';
        tab.appendChild(badge);
      }
      badge.textContent = count;
    } else if (badge) {
      badge.remove();
    }
  });
}

function switchShowSubView(view) {
  showSubView = view;
  // Update sub-nav active state
  document.querySelectorAll('#showSubNav .view-tab').forEach(function(tab) {
    tab.classList.toggle('active', tab.getAttribute('data-show-view') === view);
  });
  // Update route
  currentRoute = 'show-' + view;
  location.hash = currentRoute;

  // If a show detail is open, switch its content section via sidebar
  if (selectedShowId && view !== 'find') {
    var tabMap = { apply: 'info', prep: 'prep', execute: 'execute', history: 'history' };
    showDetailTab = tabMap[view] || 'info';
    renderShowDetail(selectedShowId);
    return;
  }

  // Otherwise show the list view
  var viewIds = ['showFindView', 'showApplyView', 'showPrepView', 'showExecuteView', 'showHistoryView', 'showDetailView'];
  var activeId = {
    find: 'showFindView',
    apply: 'showApplyView',
    prep: 'showPrepView',
    execute: 'showExecuteView',
    history: 'showHistoryView'
  }[view];
  viewIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = id === activeId ? '' : 'none';
  });
  selectedShowId = null;
  if (view === 'apply') renderShowsList();
  if (view === 'prep') renderShowPrepView();
  if (view === 'execute') renderShowExecuteView();
  if (view === 'history') renderShowHistoryView();
}

function loadShows() {
  if (showsLoaded) { renderShowsList(); return; }
  showsListener = MastDB.shows.listen(200, function(snap) {
    showsData = snap.val() || {};
    window.showsData = showsData; // Expose globally for cross-module access (trips)
    showsLoaded = true;
    var loading = document.getElementById('showsLoading');
    if (loading) loading.style.display = 'none';
    updateShowTabBadges();
    if (showSubView === 'apply') renderShowsList();
    else if (showSubView === 'prep') renderShowPrepView();
    else if (showSubView === 'execute') renderShowExecuteView();
    else if (showSubView === 'history') renderShowHistoryView();
  }, function(err) {
    console.error('Shows listen error:', err);
    var loading = document.getElementById('showsLoading');
    if (loading) loading.style.display = 'none';
  });
}

function getShowsArray() {
  var arr = [];
  Object.keys(showsData).forEach(function(key) {
    var s = showsData[key];
    s._key = key;
    arr.push(s);
  });
  arr.sort(function(a, b) {
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  return arr;
}

function renderShowsList() {
  var emptyEl = document.getElementById('showsEmpty');
  var cardsEl = document.getElementById('showsCards');
  var countEl = document.getElementById('showsCount');
  var loadingEl = document.getElementById('showsLoading');
  if (!cardsEl) return;

  if (loadingEl) loadingEl.style.display = 'none';

  var arr = getShowsArray();
  var statusFilter = document.getElementById('showStatusFilter');
  var typeFilter = document.getElementById('showTypeFilter');
  if (statusFilter && statusFilter.value !== 'all') {
    arr = arr.filter(function(s) { return s.applicationStatus === statusFilter.value; });
  }
  if (typeFilter && typeFilter.value !== 'all') {
    arr = arr.filter(function(s) { return s.type === typeFilter.value; });
  }

  if (countEl) countEl.textContent = arr.length + ' show' + (arr.length !== 1 ? 's' : '');

  if (arr.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    cardsEl.style.display = 'none';
    cardsEl.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  cardsEl.style.display = 'flex';

  var cards = '';
  arr.forEach(function(s) {
    var statusClass = s.applicationStatus || 'considering';
    var statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
    var typeLabel = SHOW_TYPE_LABELS[s.type] || s.type || 'Other';
    var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
    var dates = '';
    if (s.startDate) {
      dates = formatShowDate(s.startDate);
      if (s.endDate && s.endDate !== s.startDate) dates += ' – ' + formatShowDate(s.endDate);
    }
    var deadlineBadge = '';
    if (s.applicationDeadline && (statusClass === 'considering' || statusClass === 'applied')) {
      var daysUntil = Math.ceil((new Date(s.applicationDeadline + 'T00:00:00') - new Date()) / 86400000);
      if (daysUntil < 0) {
        deadlineBadge = '<span class="status-badge" style="background:#fecaca;color:#dc2626;">Past due</span>';
      } else if (daysUntil <= 14) {
        deadlineBadge = '<span class="status-badge" style="background:#fef3c7;color:#92400e;">' + daysUntil + 'd left</span>';
      }
    }
    var fees = '';
    if (s.boothFee) fees += 'Booth: $' + (s.boothFee / 100).toFixed(0);
    if (s.juryFee) fees += (fees ? ' · ' : '') + 'Jury: $' + (s.juryFee / 100).toFixed(0);

    cards += '<div class="order-card" onclick="viewShowDetail(\'' + s._key + '\')" style="cursor:pointer;">' +
      '<div class="order-card-header" style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span class="order-card-id" style="font-weight:600;">' + esc(s.name || 'Unnamed Show') + '</span>' +
        '<span class="status-badge" style="' + showStatusBadgeStyle(statusClass) + '">' + statusLabel + '</span>' +
      '</div>' +
      '<div class="order-card-details">' +
        '<span>' + esc(typeLabel) + '</span>' +
        (location ? '<span>' + esc(location) + '</span>' : '') +
        (dates ? '<span>' + dates + '</span>' : '') +
        (fees ? '<span>' + fees + '</span>' : '') +
        (deadlineBadge ? '<span>' + deadlineBadge + '</span>' : '') +
      '</div>' +
    '</div>';
  });
  cardsEl.innerHTML = cards;
}

function formatShowDate(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
}

// === Create / Edit Show ===

function openCreateShowModal(showId) {
  editingShowId = showId || null;
  document.getElementById('showModalTitle').textContent = showId ? 'Edit Show' : 'New Show';
  document.getElementById('saveShowBtn').textContent = showId ? 'Save' : 'Create Show';

  if (showId && showsData[showId]) {
    var s = showsData[showId];
    document.getElementById('showNameInput').value = s.name || '';
    document.getElementById('showTypeInput').value = s.type || 'juried';
    document.getElementById('showCityInput').value = s.locationCity || '';
    document.getElementById('showStateInput').value = s.locationState || '';
    document.getElementById('showStartDateInput').value = s.startDate || '';
    document.getElementById('showEndDateInput').value = s.endDate || '';
    document.getElementById('showWebsiteInput').value = s.websiteUrl || '';
    document.getElementById('showBoothFeeInput').value = s.boothFee ? (s.boothFee / 100).toFixed(2) : '';
    document.getElementById('showJuryFeeInput').value = s.juryFee ? (s.juryFee / 100).toFixed(2) : '';
    document.getElementById('showDeadlineInput').value = s.applicationDeadline || '';
    document.getElementById('showAppUrlInput').value = s.applicationUrl || '';
    document.getElementById('showNotesInput').value = s.notes || '';
  } else {
    ['showNameInput', 'showCityInput', 'showStateInput', 'showStartDateInput', 'showEndDateInput',
     'showWebsiteInput', 'showBoothFeeInput', 'showJuryFeeInput', 'showDeadlineInput', 'showAppUrlInput', 'showNotesInput'].forEach(function(id) {
      document.getElementById(id).value = '';
    });
    document.getElementById('showTypeInput').value = 'juried';
  }
  document.getElementById('createShowModal').style.display = 'flex';
}

function closeCreateShowModal() {
  document.getElementById('createShowModal').style.display = 'none';
  editingShowId = null;
}

async function saveShow() {
  var name = document.getElementById('showNameInput').value.trim();
  if (!name) { showToast('Show name is required.', true); return; }

  var boothFeeVal = parseFloat(document.getElementById('showBoothFeeInput').value);
  var juryFeeVal = parseFloat(document.getElementById('showJuryFeeInput').value);

  var data = {
    name: name,
    type: document.getElementById('showTypeInput').value,
    locationCity: document.getElementById('showCityInput').value.trim(),
    locationState: document.getElementById('showStateInput').value.trim(),
    startDate: document.getElementById('showStartDateInput').value || null,
    endDate: document.getElementById('showEndDateInput').value || null,
    websiteUrl: document.getElementById('showWebsiteInput').value.trim() || null,
    boothFee: boothFeeVal ? Math.round(boothFeeVal * 100) : null,
    juryFee: juryFeeVal ? Math.round(juryFeeVal * 100) : null,
    applicationDeadline: document.getElementById('showDeadlineInput').value || null,
    applicationUrl: document.getElementById('showAppUrlInput').value.trim() || null,
    notes: document.getElementById('showNotesInput').value.trim() || null,
    updatedAt: new Date().toISOString()
  };

  try {
    if (editingShowId) {
      await MastDB.shows.update(editingShowId, data);
      showToast('Show updated.');
    } else {
      var key = MastDB.shows.newKey();
      data.id = key;
      data.applicationStatus = 'considering';
      data.aiGenerated = false;
      data.createdAt = new Date().toISOString();
      data.createdBy = auth.currentUser ? auth.currentUser.uid : 'unknown';
      await MastDB.shows.set(key, data);
      showToast('Show created.');
    }
    closeCreateShowModal();
  } catch (err) {
    showToast('Error saving show: ' + err.message, true);
  }
}

// === Show Detail View ===

var showDetailTab = 'info';

function viewShowDetail(showId, tab) {
  selectedShowId = showId;
  var s = showsData[showId];
  if (!s) { showToast('Show not found.', true); return; }
  // Default tab from sidebar context if not explicitly passed
  if (tab) {
    showDetailTab = tab;
  } else {
    var tabMap = { apply: 'info', prep: 'prep', execute: 'execute', history: 'history' };
    showDetailTab = tabMap[showSubView] || 'info';
  }

  ['showApplyView', 'showFindView', 'showPrepView', 'showExecuteView', 'showHistoryView'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  var detailView = document.getElementById('showDetailView');
  if (detailView) detailView.style.display = '';

  renderShowDetail(showId);
}

function switchShowDetailTab(tab) {
  showDetailTab = tab;
  if (selectedShowId) renderShowDetail(selectedShowId);
}

function renderShowDetail(showId) {
  var s = showsData[showId];
  if (!s) return;
  var detailView = document.getElementById('showDetailView');
  var statusClass = s.applicationStatus || 'considering';
  var statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
  var typeLabel = SHOW_TYPE_LABELS[s.type] || s.type || 'Other';
  var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
  var dates = '';
  if (s.startDate) {
    dates = formatShowDate(s.startDate);
    if (s.endDate && s.endDate !== s.startDate) dates += ' – ' + formatShowDate(s.endDate);
  }

  var h = '<button class="detail-back" onclick="backToShowsList()">&larr; Back to Shows</button>';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px;">';
  h += '<div>';
  h += '<h2 style="margin:0 0 4px 0;">' + esc(s.name || 'Unnamed Show') + '</h2>';
  h += '<span class="status-badge" style="' + showStatusBadgeStyle(statusClass) + '">' + statusLabel + '</span>';
  h += ' <span style="font-size:0.85rem;color:var(--text-secondary, #888);">' + esc(typeLabel) + '</span>';
  if (s.aiGenerated) h += ' <span style="font-size:0.75rem;background:var(--teal, #2a7c6f);color:white;padding:2px 6px;border-radius:4px;">AI Found</span>';
  h += '</div>';
  h += '<div style="display:flex;gap:8px;">';
  if (hasPermission('shows', 'update') && s.websiteUrl) h += '<button id="deepDiveBtn-' + showId + '" class="btn btn-sm" onclick="runShowDeepDive(\'' + showId + '\')" style="background:var(--teal, #2a7c6f);color:white;border:none;">Deep Dive</button>';
  if (hasPermission('shows', 'update')) h += '<button class="btn btn-secondary btn-sm" onclick="openCreateShowModal(\'' + showId + '\')">Edit</button>';
  if (hasPermission('shows', 'delete')) h += '<button class="btn btn-sm" onclick="archiveShow(\'' + showId + '\')" style="background:#dc2626;color:white;border:none;">Delete</button>';
  h += '</div>';
  h += '</div>';

  // Detail tab is driven by sidebar — no tab bar rendered

  // Tab content
  if (showDetailTab === 'info') {
    h += renderShowDetailInfo(showId, s, location, dates, statusClass);
  } else if (showDetailTab === 'prep') {
    h += renderShowDetailPrep(showId, s);
  } else if (showDetailTab === 'execute') {
    h += renderShowDetailExecute(showId, s);
  } else if (showDetailTab === 'history') {
    h += renderShowDetailHistory(showId, s);
  }

  detailView.innerHTML = h;
}

function renderShowDetailInfo(showId, s, location, dates, statusClass) {
  var h = '';
  // Info grid
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;margin-bottom:24px;">';
  h += showDetailCard('Location', location || '—');
  h += showDetailCard('Dates', dates || '—');
  h += showDetailCard('Website', s.websiteUrl ? '<a href="' + esc(s.websiteUrl) + '" target="_blank" style="color:var(--primary, #2a7c6f);">' + esc(s.websiteUrl) + '</a>' : '—');
  h += showDetailCard('Booth Fee', s.boothFee ? '$' + (s.boothFee / 100).toFixed(2) : '—');
  h += showDetailCard('Jury Fee', s.juryFee ? '$' + (s.juryFee / 100).toFixed(2) : '—');
  h += showDetailCard('Application Deadline', s.applicationDeadline ? formatShowDate(s.applicationDeadline) : '—');
  h += showDetailCard('Application URL', s.applicationUrl ? '<a href="' + esc(s.applicationUrl) + '" target="_blank" style="color:var(--primary, #2a7c6f);">Open</a>' : '—');
  h += showDetailCard('Notes', s.notes ? esc(s.notes) : '—');
  h += '</div>';

  // Deep dive details (if available)
  var dd = s.deepDive || {};
  if (Object.keys(dd).length > 0) {
    h += '<div style="margin-bottom:24px;">';
    h += '<h3 style="margin:0 0 12px 0;">Deep Dive Details <span style="font-size:0.75rem;background:var(--teal, #2a7c6f);color:white;padding:2px 6px;border-radius:4px;">AI Researched</span></h3>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;">';
    if (dd.applicationMethod) h += showDetailCard('Apply Via', esc(dd.applicationMethod) + (dd.applicationUrl ? ' — <a href="' + esc(dd.applicationUrl) + '" target="_blank" style="color:var(--primary, #2a7c6f);">Open</a>' : ''));
    if (dd.boothFeeNotes) h += showDetailCard('Booth Fee Details', esc(dd.boothFeeNotes));
    if (dd.juryFeeNotes) h += showDetailCard('Jury Fee Details', esc(dd.juryFeeNotes));
    if (dd.applicationDeadline) h += showDetailCard('Application Deadline', formatShowDate(dd.applicationDeadline) + (dd.lateDeadline ? ' (Late: ' + formatShowDate(dd.lateDeadline) + ')' : ''));
    if (dd.notificationDate) h += showDetailCard('Notification Date', formatShowDate(dd.notificationDate));
    if (dd.juryRequirements) h += showDetailCard('Jury Requirements', esc(dd.juryRequirements));
    if (dd.boothSize) h += showDetailCard('Booth Size', esc(dd.boothSize));
    if (dd.boothOptions) h += showDetailCard('Booth Options', esc(dd.boothOptions));
    h += showDetailCard('Electricity', dd.electricity === true ? 'Yes' + (dd.electricityNotes ? ' — ' + esc(dd.electricityNotes) : '') : dd.electricity === false ? 'No' + (dd.electricityNotes ? ' — ' + esc(dd.electricityNotes) : '') : '—');
    h += showDetailCard('WiFi', dd.wifi === true ? 'Yes' : dd.wifi === false ? 'No' : '—');
    if (dd.setupTime) h += showDetailCard('Setup', esc(dd.setupTime));
    if (dd.teardownTime) h += showDetailCard('Teardown', esc(dd.teardownTime));
    if (dd.insuranceRequired !== null && dd.insuranceRequired !== undefined) h += showDetailCard('Insurance', (dd.insuranceRequired ? 'Required' : 'Not required') + (dd.insuranceNotes ? ' — ' + esc(dd.insuranceNotes) : ''));
    if (dd.permits) h += showDetailCard('Permits', esc(dd.permits));
    if (dd.attendance) h += showDetailCard('Attendance', esc(String(dd.attendance)));
    if (dd.eligibility) h += showDetailCard('Eligibility', esc(dd.eligibility));
    if (dd.additionalNotes) h += showDetailCard('Additional Notes', esc(dd.additionalNotes));
    h += '</div></div>';
  }

  // Application status actions
  h += '<div style="margin-bottom:24px;">';
  h += '<h3 style="margin:0 0 12px 0;">Application Status</h3>';
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  var statuses = ['considering', 'applied', 'accepted', 'waitlisted', 'rejected', 'withdrawn'];
  statuses.forEach(function(st) {
    var isCurrent = statusClass === st;
    h += '<button class="btn btn-sm" onclick="updateShowStatus(\'' + showId + '\', \'' + st + '\')" ' +
      'style="background:' + (isCurrent ? SHOW_STATUS_COLORS[st] : 'var(--bg-secondary, #f5f5f5)') + ';' +
      'color:' + (isCurrent ? 'white' : 'var(--text-primary, #333)') + ';' +
      'border:1px solid ' + (isCurrent ? SHOW_STATUS_COLORS[st] : 'var(--border-color, #ddd)') + ';">' +
      st.charAt(0).toUpperCase() + st.slice(1) + '</button>';
  });
  h += '</div></div>';

  // Application history
  h += '<div>';
  h += '<h3 style="margin:0 0 12px 0;">Status History</h3>';
  var history = s.applicationHistory ? Object.values(s.applicationHistory).sort(function(a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); }) : [];
  if (history.length === 0) {
    h += '<p style="color:var(--text-secondary, #888);font-size:0.9rem;">No status changes yet.</p>';
  } else {
    history.forEach(function(entry) {
      h += '<div style="padding:8px 0;border-bottom:1px solid var(--border-color, #eee);font-size:0.9rem;">';
      h += '<span class="status-badge" style="font-size:0.7rem;' + showStatusBadgeStyle(entry.newStatus || '') + '">' + (entry.newStatus || '').charAt(0).toUpperCase() + (entry.newStatus || '').slice(1) + '</span>';
      if (entry.oldStatus) h += ' <span style="color:var(--text-secondary, #888);">from ' + entry.oldStatus + '</span>';
      h += ' <span style="color:var(--text-secondary, #888);font-size:0.8rem;">' + (entry.timestamp ? new Date(entry.timestamp).toLocaleDateString() : '') + '</span>';
      h += '</div>';
    });
  }
  h += '</div>';
  return h;
}

// === Show Detail — Prep Tab ===

function renderShowDetailPrep(showId, s) {
  var h = '';
  var prep = s.prep || {};

  // --- Staffing Section ---
  h += '<div style="margin-bottom:32px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  h += '<h3 style="margin:0;">Staffing</h3>';
  if (hasPermission('shows', 'update')) {
    h += '<button class="btn btn-sm" onclick="openShowStaffingModal(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">+ Assign Staff</button>';
  }
  h += '</div>';
  var staffing = prep.staffing || {};
  var staffKeys = Object.keys(staffing);
  if (staffKeys.length === 0) {
    h += '<p style="color:var(--text-secondary, #888);font-size:0.9rem;">No staff assigned yet.</p>';
  } else {
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">';
    staffKeys.forEach(function(uid) {
      var entry = staffing[uid];
      var roleBadgeColor = entry.showRole === 'lead' ? '#2563eb' : entry.showRole === 'driver' ? '#7c3aed' : 'var(--teal, #2a7c6f)';
      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;">';
      h += '<div>';
      h += '<div style="font-weight:600;font-size:0.9rem;">' + esc(entry.name || 'Unknown') + '</div>';
      h += '<span style="font-size:0.75rem;background:' + roleBadgeColor + ';color:white;padding:2px 8px;border-radius:4px;">' + esc((entry.showRole || 'support').charAt(0).toUpperCase() + (entry.showRole || 'support').slice(1)) + '</span>';
      h += '</div>';
      if (hasPermission('shows', 'update')) {
        h += '<button onclick="removeShowStaff(\'' + showId + '\', \'' + uid + '\')" style="background:none;border:none;color:var(--text-secondary, #888);cursor:pointer;font-size:1.1rem;" title="Remove">&times;</button>';
      }
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div>';

  // --- Inventory Pull List ---
  h += '<div style="margin-bottom:32px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  h += '<h3 style="margin:0;">Inventory Pull List</h3>';
  if (hasPermission('shows', 'update')) {
    h += '<button class="btn btn-sm" onclick="addShowInventoryItem(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">+ Add Item</button>';
  }
  h += '</div>';
  var inventory = prep.inventory || {};
  var invKeys = Object.keys(inventory);
  if (invKeys.length === 0) {
    h += '<p style="color:var(--text-secondary, #888);font-size:0.9rem;">No items in pull list yet.</p>';
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:8px;">';
    invKeys.forEach(function(itemId) {
      var item = inventory[itemId];
      var packed = item.packed || false;
      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:12px;' + (packed ? 'opacity:0.6;' : '') + '">';
      h += '<input type="checkbox" ' + (packed ? 'checked' : '') + ' onchange="toggleShowInventoryPacked(\'' + showId + '\', \'' + itemId + '\', this.checked)" style="width:18px;height:18px;cursor:pointer;">';
      h += '<div style="flex:1;">';
      h += '<div style="font-weight:600;font-size:0.9rem;' + (packed ? 'text-decoration:line-through;' : '') + '">' + esc(item.name || 'Unnamed Item') + '</div>';
      var meta = [];
      if (item.quantity) meta.push('Qty: ' + item.quantity);
      if (item.notes) meta.push(esc(item.notes));
      if (item.linkedMakeJob) meta.push('<span style="color:var(--primary, #2a7c6f);font-size:0.8rem;">🔗 Linked to Make</span>');
      if (meta.length) h += '<div style="font-size:0.8rem;color:var(--text-secondary, #888);">' + meta.join(' · ') + '</div>';
      h += '</div>';
      if (hasPermission('shows', 'update')) {
        h += '<button onclick="editShowInventoryItem(\'' + showId + '\', \'' + itemId + '\')" style="background:none;border:none;color:var(--text-secondary, #888);cursor:pointer;font-size:0.85rem;" title="Edit">✏️</button>';
        h += '<button onclick="removeShowInventoryItem(\'' + showId + '\', \'' + itemId + '\')" style="background:none;border:none;color:var(--text-secondary, #888);cursor:pointer;font-size:1.1rem;" title="Remove">&times;</button>';
      }
      h += '</div>';
    });
    h += '</div>';
    // Pack progress
    var packedCount = invKeys.filter(function(k) { return inventory[k].packed; }).length;
    h += '<div style="margin-top:8px;font-size:0.85rem;color:var(--text-secondary, #888);">' + packedCount + ' of ' + invKeys.length + ' items packed</div>';
  }
  h += '</div>';

  // --- Logistics ---
  h += '<div style="margin-bottom:32px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  h += '<h3 style="margin:0;">Logistics</h3>';
  if (hasPermission('shows', 'update')) {
    h += '<button class="btn btn-sm" onclick="editShowLogistics(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">Edit</button>';
  }
  h += '</div>';
  var logistics = prep.logistics || {};
  var hasLogistics = logistics.boothSize || logistics.setupTime || logistics.teardownTime || logistics.parkingNotes || logistics.hotelNotes || logistics.travelNotes || logistics.notes;
  if (!hasLogistics) {
    h += '<p style="color:var(--text-secondary, #888);font-size:0.9rem;">No logistics details yet. Click Edit to add booth, travel, and setup info.</p>';
  } else {
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;">';
    if (logistics.boothSize) h += showDetailCard('Booth Size', esc(logistics.boothSize));
    if (logistics.setupTime) h += showDetailCard('Setup Time', esc(logistics.setupTime));
    if (logistics.teardownTime) h += showDetailCard('Teardown Time', esc(logistics.teardownTime));
    if (logistics.parkingNotes) h += showDetailCard('Parking / Load-In', esc(logistics.parkingNotes));
    if (logistics.hotelNotes) h += showDetailCard('Hotel / Accommodation', esc(logistics.hotelNotes));
    if (logistics.travelNotes) h += showDetailCard('Travel Notes', esc(logistics.travelNotes));
    h += '</div>';
    if (logistics.notes) {
      h += '<div style="margin-top:12px;background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:12px;">';
      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">Notes</div>';
      h += '<div style="font-size:0.9rem;white-space:pre-wrap;">' + esc(logistics.notes) + '</div>';
      h += '</div>';
    }
  }
  h += '</div>';

  return h;
}

// === Show Detail — Execute Tab ===

function isShowLive(s) {
  if (s.applicationStatus !== 'accepted') return false;
  var today = new Date().toISOString().split('T')[0];
  return s.startDate && s.startDate <= today && (s.endDate || s.startDate) >= today;
}

function isMultiDayShow(s) {
  return s.startDate && s.endDate && s.endDate !== s.startDate;
}

function getShowDates(s) {
  if (!s.startDate) return [];
  var dates = [];
  var d = new Date(s.startDate + 'T00:00:00');
  var end = new Date((s.endDate || s.startDate) + 'T00:00:00');
  while (d <= end) {
    dates.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function renderShowDetailExecute(showId, s) {
  var h = '';
  var live = isShowLive(s);
  var today = new Date().toISOString().split('T')[0];
  var exec = s.execute || {};
  var multiDay = isMultiDayShow(s);

  // --- Show Day Mode / Live Indicator ---
  if (live) {
    h += '<div style="background:linear-gradient(135deg, #16a34a, #15803d);color:white;border-radius:12px;padding:16px 20px;margin-bottom:24px;display:flex;align-items:center;gap:12px;">';
    h += '<div style="width:12px;height:12px;border-radius:50%;background:white;animation:pulse 2s infinite;flex-shrink:0;"></div>';
    h += '<div>';
    h += '<div style="font-weight:700;font-size:1.1rem;">Show Day — Live</div>';
    h += '<div style="font-size:0.85rem;opacity:0.9;">' + esc(s.name || 'Show') + ' is happening now</div>';
    h += '</div></div>';
  } else if (s.applicationStatus === 'accepted' && s.startDate && s.startDate > today) {
    var daysUntil = Math.ceil((new Date(s.startDate + 'T00:00:00') - new Date()) / 86400000);
    h += '<div class="exec-upcoming-banner" style="background:var(--bg-secondary, #f5f5f5);border-radius:12px;padding:16px 20px;margin-bottom:24px;display:flex;align-items:center;gap:12px;">';
    h += '<div style="font-size:1.5rem;">&#128197;</div>';
    h += '<div>';
    h += '<div style="font-weight:600;">Show starts in ' + daysUntil + ' day' + (daysUntil !== 1 ? 's' : '') + '</div>';
    h += '<div style="font-size:0.85rem;color:var(--text-secondary, #888);">Execute tools become active on show day.</div>';
    h += '</div></div>';
  } else if (s.applicationStatus !== 'accepted') {
    h += '<div class="exec-status-gate" style="background:var(--bg-secondary, #f5f5f5);border-radius:12px;padding:16px 20px;margin-bottom:24px;color:var(--text-secondary, #888);text-align:center;">';
    h += '<p style="margin:0;">Show must be in "Accepted" status to use Execute tools.</p>';
    h += '</div>';
  }

  // --- Multi-day date selector ---
  var selectedDate = executeSelectedDate || today;
  if (multiDay) {
    var showDates = getShowDates(s);
    // Default to today if within show range, otherwise first date
    if (showDates.indexOf(selectedDate) === -1) selectedDate = showDates.indexOf(today) !== -1 ? today : (showDates[0] || today);
    h += '<div style="margin-bottom:20px;">';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Show Day</label>';
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    showDates.forEach(function(dt) {
      var isSelected = dt === selectedDate;
      var dayLabel = new Date(dt + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      var isToday = dt === today;
      h += '<button class="btn btn-small exec-day-btn' + (isSelected ? ' active' : '') + '" onclick="switchExecuteDate(\'' + showId + '\', \'' + dt + '\')" style="' +
        'border:1px solid ' + (isSelected ? 'var(--teal, #2a7c6f)' : '#ddd') + ';' +
        'background:' + (isSelected ? 'var(--teal, #2a7c6f)' : 'var(--cream, #FAF6F0)') + ';' +
        'color:' + (isSelected ? 'white' : 'var(--charcoal, #1A1A1A)') + ';font-weight:' + (isSelected ? '600' : '400') + ';">' +
        dayLabel + (isToday ? ' (Today)' : '') + '</button>';
    });
    h += '</div></div>';
  }

  // Store selected date in a data attribute for use by modals
  h += '<div id="executeContent" data-show-id="' + showId + '" data-selected-date="' + selectedDate + '">';

  // --- At-Show Sales Log ---
  h += '<div style="margin-bottom:32px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  h += '<h3 style="margin:0;">Sales Log</h3>';
  if (hasPermission('shows', 'update')) {
    h += '<button class="btn btn-sm" onclick="openShowSaleModal(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">+ Record Sale</button>';
  }
  h += '</div>';

  // Get sales for selected date (multi-day) or all sales (single-day)
  var sales = exec.sales || {};
  var daySales = {};
  if (multiDay) {
    daySales = sales[selectedDate] || {};
  } else {
    daySales = sales;
    // Exclude date sub-keys (which are YYYY-MM-DD format)
    var cleanSales = {};
    Object.keys(daySales).forEach(function(k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) cleanSales[k] = daySales[k];
    });
    daySales = cleanSales;
  }
  var saleKeys = Object.keys(daySales);
  if (saleKeys.length === 0) {
    h += '<p style="color:var(--text-secondary, #888);font-size:0.9rem;">No sales recorded' + (multiDay ? ' for this day' : '') + ' yet.</p>';
  } else {
    // Summary
    var totalRevenue = 0;
    var cashCount = 0; var cardCount = 0; var squareCount = 0;
    saleKeys.forEach(function(k) { var sl = daySales[k]; totalRevenue += (sl.priceCents || 0); if (sl.paymentMethod === 'cash') cashCount++; else if (sl.paymentMethod === 'card') cardCount++; else if (sl.paymentMethod === 'square') squareCount++; });
    h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">';
    h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">';
    h += '<div style="font-size:1.25rem;font-weight:700;">$' + (totalRevenue / 100).toFixed(2) + '</div>';
    h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Revenue</div></div>';
    h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">';
    h += '<div style="font-size:1.25rem;font-weight:700;">' + saleKeys.length + '</div>';
    h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Sales</div></div>';
    var methodParts = [];
    if (cashCount) methodParts.push(cashCount + ' cash');
    if (cardCount) methodParts.push(cardCount + ' card');
    if (squareCount) methodParts.push(squareCount + ' square');
    if (methodParts.length) {
      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">';
      h += '<div style="font-size:0.85rem;font-weight:600;">' + methodParts.join(', ') + '</div>';
      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">By Method</div></div>';
    }
    h += '</div>';

    // Sales list
    var sortedSales = saleKeys.map(function(k) { return Object.assign({ _key: k }, daySales[k]); })
      .sort(function(a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });
    h += '<div style="display:flex;flex-direction:column;gap:8px;">';
    sortedSales.forEach(function(sl) {
      var time = sl.timestamp ? new Date(sl.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
      var methodBadge = '';
      var methodColors = { cash: '#16a34a', card: '#2563eb', square: '#7c3aed' };
      if (sl.paymentMethod) {
        methodBadge = '<span style="font-size:0.7rem;background:' + (methodColors[sl.paymentMethod] || '#888') + ';color:white;padding:2px 6px;border-radius:4px;">' + sl.paymentMethod.charAt(0).toUpperCase() + sl.paymentMethod.slice(1) + '</span>';
      }
      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:12px;">';
      h += '<div style="flex:1;">';
      h += '<div style="font-weight:600;font-size:0.9rem;">' + esc(sl.description || 'Sale') + '</div>';
      h += '<div style="font-size:0.8rem;color:var(--text-secondary, #888);">' + time + ' ' + methodBadge + '</div>';
      h += '</div>';
      h += '<div style="font-weight:700;font-size:0.95rem;">$' + ((sl.priceCents || 0) / 100).toFixed(2) + '</div>';
      if (hasPermission('shows', 'update')) {
        h += '<button onclick="editShowSale(\'' + showId + '\', \'' + sl._key + '\')" style="background:none;border:none;color:var(--text-secondary, #888);cursor:pointer;font-size:0.85rem;" title="Edit">&#9998;</button>';
        h += '<button onclick="deleteShowSale(\'' + showId + '\', \'' + sl._key + '\')" style="background:none;border:none;color:var(--text-secondary, #888);cursor:pointer;font-size:1.1rem;" title="Delete">&times;</button>';
      }
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div>';

  // --- Inventory Reconciliation ---
  h += '<div style="margin-bottom:32px;">';
  h += '<h3 style="margin:0 0 12px 0;">Inventory Reconciliation</h3>';
  var prepInventory = (s.prep && s.prep.inventory) || {};
  var prepKeys = Object.keys(prepInventory);
  var reconciliation = exec.reconciliation || {};
  if (prepKeys.length === 0) {
    h += '<p style="color:var(--text-secondary, #888);font-size:0.9rem;">No prep inventory items to reconcile. Add items in the Prep tab first.</p>';
  } else {
    // Running tally
    var totalBrought = 0; var totalSold = 0; var totalReturned = 0; var totalDamaged = 0; var totalGifted = 0;
    prepKeys.forEach(function(itemId) {
      var item = prepInventory[itemId];
      var qty = item.quantity || 1;
      totalBrought += qty;
      var rec = reconciliation[itemId] || {};
      totalSold += (rec.sold || 0);
      totalReturned += (rec.returned || 0);
      totalDamaged += (rec.damaged || 0);
      totalGifted += (rec.gifted || 0);
    });
    h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">';
    h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">';
    h += '<div style="font-size:1.25rem;font-weight:700;">' + totalBrought + '</div>';
    h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Brought</div></div>';
    h += '<div style="background:#16a34a22;border-radius:8px;padding:10px 16px;text-align:center;">';
    h += '<div style="font-size:1.25rem;font-weight:700;color:#16a34a;">' + totalSold + '</div>';
    h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Sold</div></div>';
    h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">';
    h += '<div style="font-size:1.25rem;font-weight:700;">' + totalReturned + '</div>';
    h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Returned</div></div>';
    if (totalDamaged > 0) {
      h += '<div style="background:#dc262622;border-radius:8px;padding:10px 16px;text-align:center;">';
      h += '<div style="font-size:1.25rem;font-weight:700;color:#dc2626;">' + totalDamaged + '</div>';
      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Damaged</div></div>';
    }
    if (totalGifted > 0) {
      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">';
      h += '<div style="font-size:1.25rem;font-weight:700;">' + totalGifted + '</div>';
      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Gifted</div></div>';
    }
    h += '</div>';

    // Item-by-item reconciliation
    h += '<div style="display:flex;flex-direction:column;gap:8px;">';
    prepKeys.forEach(function(itemId) {
      var item = prepInventory[itemId];
      if (!item.packed) return; // Only show packed items
      var rec = reconciliation[itemId] || {};
      var qty = item.quantity || 1;
      var accounted = (rec.sold || 0) + (rec.returned || 0) + (rec.damaged || 0) + (rec.gifted || 0);
      var statusColor = accounted === qty ? '#16a34a' : accounted > 0 ? '#f59e0b' : 'var(--text-secondary, #888)';
      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
      h += '<div style="flex:1;min-width:150px;">';
      h += '<div style="font-weight:600;font-size:0.9rem;">' + esc(item.name || 'Item') + '</div>';
      h += '<div style="font-size:0.8rem;color:var(--text-secondary, #888);">Brought: ' + qty + ' | Accounted: ' + accounted + '</div>';
      h += '</div>';
      h += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">';
      if (hasPermission('shows', 'update')) {
        h += reconCounterButton(showId, itemId, 'sold', rec.sold || 0, '#16a34a');
        h += reconCounterButton(showId, itemId, 'returned', rec.returned || 0, '#2563eb');
        h += reconCounterButton(showId, itemId, 'damaged', rec.damaged || 0, '#dc2626');
        h += reconCounterButton(showId, itemId, 'gifted', rec.gifted || 0, '#7c3aed');
      } else {
        if (rec.sold) h += '<span style="font-size:0.8rem;color:#16a34a;">Sold: ' + rec.sold + '</span> ';
        if (rec.returned) h += '<span style="font-size:0.8rem;color:#2563eb;">Ret: ' + rec.returned + '</span> ';
        if (rec.damaged) h += '<span style="font-size:0.8rem;color:#dc2626;">Dmg: ' + rec.damaged + '</span> ';
        if (rec.gifted) h += '<span style="font-size:0.8rem;color:#7c3aed;">Gift: ' + rec.gifted + '</span> ';
      }
      h += '</div>';
      h += '<div style="width:8px;height:8px;border-radius:50%;background:' + statusColor + ';flex-shrink:0;" title="' + accounted + '/' + qty + ' accounted"></div>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div>';

  // --- Show Notes ---
  h += '<div style="margin-bottom:32px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  h += '<h3 style="margin:0;">Show Notes</h3>';
  if (hasPermission('shows', 'update')) {
    h += '<button class="btn btn-sm" onclick="editShowNotes(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">Edit Notes</button>';
  }
  h += '</div>';
  var notes = exec.notes || {};
  var notesContent = multiDay ? (notes[selectedDate] || '') : (typeof notes === 'string' ? notes : (notes._default || ''));
  if (!notesContent) {
    h += '<p style="color:var(--text-secondary, #888);font-size:0.9rem;">No notes yet. Capture weather, foot traffic, booth neighbors, lessons learned.</p>';
  } else {
    h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:16px;white-space:pre-wrap;font-size:0.9rem;line-height:1.5;">' + esc(notesContent) + '</div>';
  }
  h += '</div>';

  // --- Daily Summary (for multi-day shows) ---
  if (multiDay) {
    h += '<div style="margin-bottom:32px;">';
    h += '<h3 style="margin:0 0 12px 0;">All Days Summary</h3>';
    var showDates = getShowDates(s);
    var grandTotal = 0;
    var grandSalesCount = 0;
    h += '<div style="display:flex;flex-direction:column;gap:8px;">';
    showDates.forEach(function(dt) {
      var daySls = (exec.sales || {})[dt] || {};
      var dayKeys = Object.keys(daySls);
      var dayRevenue = 0;
      dayKeys.forEach(function(k) { dayRevenue += (daySls[k].priceCents || 0); });
      grandTotal += dayRevenue;
      grandSalesCount += dayKeys.length;
      var dayLabel = new Date(dt + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      var isToday = dt === today;
      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;' + (isToday ? 'border-left:3px solid var(--primary, #2a7c6f);' : '') + '">';
      h += '<div>';
      h += '<div style="font-weight:600;font-size:0.9rem;">' + dayLabel + (isToday ? ' (Today)' : '') + '</div>';
      h += '<div style="font-size:0.8rem;color:var(--text-secondary, #888);">' + dayKeys.length + ' sale' + (dayKeys.length !== 1 ? 's' : '') + '</div>';
      h += '</div>';
      h += '<div style="font-weight:700;font-size:0.95rem;">$' + (dayRevenue / 100).toFixed(2) + '</div>';
      h += '</div>';
    });
    h += '</div>';
    h += '<div style="margin-top:12px;background:var(--primary, #2a7c6f);color:white;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">';
    h += '<div style="font-weight:600;">Show Total</div>';
    h += '<div><span style="font-size:0.85rem;opacity:0.9;margin-right:12px;">' + grandSalesCount + ' sales</span><span style="font-weight:700;font-size:1.1rem;">$' + (grandTotal / 100).toFixed(2) + '</span></div>';
    h += '</div>';
    h += '</div>';
  }

  h += '</div>'; // close #executeContent
  return h;
}

function reconCounterButton(showId, itemId, field, count, color) {
  return '<div style="display:flex;align-items:center;gap:2px;">' +
    '<button onclick="updateReconCount(\'' + showId + '\', \'' + itemId + '\', \'' + field + '\', -1)" style="background:none;border:1px solid var(--border-color, #ddd);border-radius:4px 0 0 4px;padding:2px 6px;cursor:pointer;font-size:0.8rem;color:var(--text-primary, #333);font-family:inherit;">&minus;</button>' +
    '<span style="font-size:0.8rem;font-weight:600;min-width:40px;text-align:center;padding:2px 4px;border-top:1px solid var(--border-color, #ddd);border-bottom:1px solid var(--border-color, #ddd);color:' + color + ';">' + field.charAt(0).toUpperCase() + field.slice(1) + ': ' + count + '</span>' +
    '<button onclick="updateReconCount(\'' + showId + '\', \'' + itemId + '\', \'' + field + '\', 1)" style="background:none;border:1px solid var(--border-color, #ddd);border-radius:0 4px 4px 0;padding:2px 6px;cursor:pointer;font-size:0.8rem;color:var(--text-primary, #333);font-family:inherit;">+</button>' +
  '</div>';
}

// === Execute Tab — Date Switching ===

var executeSelectedDate = null;

function switchExecuteDate(showId, date) {
  executeSelectedDate = date;
  renderShowDetail(showId);
}

// === Execute Tab — Sales CRUD ===

function openShowSaleModal(showId, saleId) {
  var s = showsData[showId];
  var exec = (s && s.execute) || {};
  var multiDay = isMultiDayShow(s);
  var dateEl = document.getElementById('executeContent');
  var selectedDate = (dateEl && dateEl.getAttribute('data-selected-date')) || new Date().toISOString().split('T')[0];
  var existing = null;
  if (saleId) {
    if (multiDay) {
      existing = exec.sales && exec.sales[selectedDate] && exec.sales[selectedDate][saleId];
    } else {
      existing = exec.sales && exec.sales[saleId];
    }
  }
  var sale = existing || {};

  var h = '<div id="showSaleModal" class="exec-modal-wrap" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">';
  h += '<div style="background:var(--bg-primary, #fff);border-radius:12px;padding:24px;max-width:450px;width:90%;max-height:80vh;overflow-y:auto;">';
  h += '<h3 style="margin:0 0 16px 0;">' + (saleId ? 'Edit' : 'Record') + ' Sale</h3>';
  // Description
  h += '<div style="margin-bottom:12px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Item Description *</label>';
  h += '<input id="saleDescription" type="text" placeholder="e.g. Blue Hollow Bird, Cup set of 4" value="' + esc(sale.description || '') + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div>';
  // Price and payment method
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">';
  h += '<div>';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Sale Price ($) *</label>';
  h += '<input id="salePrice" type="number" step="0.01" min="0" placeholder="25.00" value="' + (sale.priceCents ? (sale.priceCents / 100).toFixed(2) : '') + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div>';
  h += '<div>';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Payment Method</label>';
  h += '<select id="salePaymentMethod" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);">';
  ['cash', 'card', 'square'].forEach(function(m) {
    h += '<option value="' + m + '"' + (sale.paymentMethod === m ? ' selected' : '') + '>' + m.charAt(0).toUpperCase() + m.slice(1) + '</option>';
  });
  h += '</select></div></div>';
  // Timestamp
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Time</label>';
  var defaultTime = sale.timestamp ? new Date(sale.timestamp).toTimeString().slice(0, 5) : new Date().toTimeString().slice(0, 5);
  h += '<input id="saleTimestamp" type="time" value="' + defaultTime + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div>';
  // Linked product (optional)
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Link to Product (optional)</label>';
  h += '<select id="saleLinkedProduct" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);">';
  h += '<option value="">— None —</option>';
  if (productsData && productsData.length) {
    productsData.forEach(function(p) {
      h += '<option value="' + esc(p.pid || '') + '"' + (sale.linkedProductId === p.pid ? ' selected' : '') + '>' + esc(p.name || p.pid) + '</option>';
    });
  }
  h += '</select></div>';
  h += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
  h += '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'showSaleModal\').remove()">Cancel</button>';
  h += '<button class="btn btn-sm" onclick="saveShowSale(\'' + showId + '\', ' + (saleId ? '\'' + saleId + '\'' : 'null') + ')" style="background:var(--primary, #2a7c6f);color:white;border:none;">Save</button>';
  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}

async function saveShowSale(showId, saleId) {
  var desc = document.getElementById('saleDescription').value.trim();
  if (!desc) { showToast('Item description is required.', true); return; }
  var priceVal = parseFloat(document.getElementById('salePrice').value);
  if (isNaN(priceVal) || priceVal < 0) { showToast('Valid sale price is required.', true); return; }
  var priceCents = Math.round(priceVal * 100);
  var timeInput = document.getElementById('saleTimestamp').value;
  var dateEl = document.getElementById('executeContent');
  var selectedDate = (dateEl && dateEl.getAttribute('data-selected-date')) || new Date().toISOString().split('T')[0];
  var ts = new Date(selectedDate + 'T' + (timeInput || '12:00') + ':00').toISOString();

  var data = {
    description: desc,
    priceCents: priceCents,
    paymentMethod: document.getElementById('salePaymentMethod').value,
    linkedProductId: document.getElementById('saleLinkedProduct').value || null,
    timestamp: ts,
    updatedAt: new Date().toISOString()
  };

  var s = showsData[showId];
  var multiDay = isMultiDayShow(s);

  try {
    if (multiDay) {
      if (saleId) {
        await MastDB.shows.subRef(showId, 'execute', 'sales', selectedDate, saleId).update(data);
      } else {
        data.createdAt = new Date().toISOString();
        await MastDB.shows.subRef(showId, 'execute', 'sales', selectedDate).push().set(data);
      }
    } else {
      if (saleId) {
        await MastDB.shows.subRef(showId, 'execute', 'sales', saleId).update(data);
      } else {
        data.createdAt = new Date().toISOString();
        await MastDB.shows.subRef(showId, 'execute', 'sales').push().set(data);
      }
    }
    var modal = document.getElementById('showSaleModal');
    if (modal) modal.remove();
    showToast(saleId ? 'Sale updated.' : 'Sale recorded.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error saving sale: ' + err.message, true);
  }
}

function editShowSale(showId, saleId) {
  openShowSaleModal(showId, saleId);
}

async function deleteShowSale(showId, saleId) {
  if (!await mastConfirm('Delete this sale record?', { title: 'Delete Sale', danger: true })) return;
  var s = showsData[showId];
  var multiDay = isMultiDayShow(s);
  var dateEl = document.getElementById('executeContent');
  var selectedDate = (dateEl && dateEl.getAttribute('data-selected-date')) || new Date().toISOString().split('T')[0];
  try {
    if (multiDay) {
      await MastDB.shows.subRef(showId, 'execute', 'sales', selectedDate, saleId).remove();
    } else {
      await MastDB.shows.subRef(showId, 'execute', 'sales', saleId).remove();
    }
    showToast('Sale deleted.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error deleting sale: ' + err.message, true);
  }
}

// === Execute Tab — Inventory Reconciliation ===

async function updateReconCount(showId, itemId, field, delta) {
  var s = showsData[showId];
  var rec = (s && s.execute && s.execute.reconciliation && s.execute.reconciliation[itemId]) || {};
  var current = rec[field] || 0;
  var newVal = Math.max(0, current + delta);
  try {
    var updates = {};
    updates[field] = newVal;
    updates.updatedAt = new Date().toISOString();
    await MastDB.shows.subRef(showId, 'execute', 'reconciliation', itemId).update(updates);
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error updating reconciliation: ' + err.message, true);
  }
}

// === Execute Tab — Show Notes ===

function editShowNotes(showId) {
  var s = showsData[showId];
  var exec = (s && s.execute) || {};
  var multiDay = isMultiDayShow(s);
  var dateEl = document.getElementById('executeContent');
  var selectedDate = (dateEl && dateEl.getAttribute('data-selected-date')) || new Date().toISOString().split('T')[0];
  var notes = exec.notes || {};
  var currentNotes = multiDay ? (notes[selectedDate] || '') : (typeof notes === 'string' ? notes : (notes._default || ''));

  var h = '<div id="showNotesModal" class="exec-modal-wrap" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">';
  h += '<div style="background:var(--bg-primary, #fff);border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;">';
  h += '<h3 style="margin:0 0 16px 0;">Show Notes' + (multiDay ? ' — ' + new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '') + '</h3>';
  h += '<div style="margin-bottom:12px;">';
  h += '<label style="font-size:0.85rem;color:var(--text-secondary, #888);display:block;margin-bottom:4px;">Weather, foot traffic, booth neighbors, lessons learned...</label>';
  h += '<textarea id="showNotesText" rows="8" style="width:100%;padding:10px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;line-height:1.5;">' + esc(currentNotes) + '</textarea>';
  h += '</div>';
  h += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
  h += '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'showNotesModal\').remove()">Cancel</button>';
  h += '<button class="btn btn-sm" onclick="saveShowNotes(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">Save</button>';
  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}

async function saveShowNotes(showId) {
  var text = document.getElementById('showNotesText').value.trim();
  var s = showsData[showId];
  var multiDay = isMultiDayShow(s);
  var dateEl = document.getElementById('executeContent');
  var selectedDate = (dateEl && dateEl.getAttribute('data-selected-date')) || new Date().toISOString().split('T')[0];

  try {
    if (multiDay) {
      await MastDB.shows.subRef(showId, 'execute', 'notes', selectedDate).set(text || null);
    } else {
      await MastDB.shows.subRef(showId, 'execute', 'notes', '_default').set(text || null);
    }
    var modal = document.getElementById('showNotesModal');
    if (modal) modal.remove();
    showToast('Notes saved.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error saving notes: ' + err.message, true);
  }
}

// === Show Detail — History Tab ===

function renderShowDetailHistory(showId, s) {
  var h = '';
  var exec = s.execute || {};
  var multiDay = isMultiDayShow(s);
  var today = new Date().toISOString().split('T')[0];
  var endDate = s.endDate || s.startDate;
  var showEnded = endDate && endDate < today;
  var historyData = s.history || {};

  // --- Post-Show Summary ---
  h += '<div style="margin-bottom:32px;">';
  h += '<h3 style="margin:0 0 16px 0;">Post-Show Summary</h3>';

  if (!showEnded) {
    h += '<div class="history-empty-msg" style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:16px;color:var(--text-secondary, #888);font-size:0.9rem;">';
    h += 'Summary will be available after the show ends' + (endDate ? ' (' + formatShowDate(endDate) + ')' : '') + '.';
    h += '</div>';
  } else {
    var sales = exec.sales || {};
    var reconciliation = exec.reconciliation || {};
    var totalRevenue = 0;
    var totalSalesCount = 0;
    var cashCount = 0; var cardCount = 0; var squareCount = 0;
    var cashRevenue = 0; var cardRevenue = 0; var squareRevenue = 0;
    var perDayRevenue = {};

    if (multiDay) {
      var showDates = getShowDates(s);
      showDates.forEach(function(dt) {
        var daySales = sales[dt] || {};
        var dayRev = 0;
        var dayCount = 0;
        Object.keys(daySales).forEach(function(k) {
          var sl = daySales[k];
          var amt = sl.priceCents || 0;
          totalRevenue += amt;
          totalSalesCount++;
          dayRev += amt;
          dayCount++;
          if (sl.paymentMethod === 'cash') { cashCount++; cashRevenue += amt; }
          else if (sl.paymentMethod === 'card') { cardCount++; cardRevenue += amt; }
          else if (sl.paymentMethod === 'square') { squareCount++; squareRevenue += amt; }
        });
        perDayRevenue[dt] = { revenue: dayRev, count: dayCount };
      });
    } else {
      Object.keys(sales).forEach(function(k) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
        var sl = sales[k];
        var amt = sl.priceCents || 0;
        totalRevenue += amt;
        totalSalesCount++;
        if (sl.paymentMethod === 'cash') { cashCount++; cashRevenue += amt; }
        else if (sl.paymentMethod === 'card') { cardCount++; cardRevenue += amt; }
        else if (sl.paymentMethod === 'square') { squareCount++; squareRevenue += amt; }
      });
    }

    // Reconciliation totals
    var totalItemsSold = 0; var totalDamaged = 0; var totalGifted = 0;
    Object.keys(reconciliation).forEach(function(itemId) {
      var rec = reconciliation[itemId];
      totalItemsSold += (rec.sold || 0);
      totalDamaged += (rec.damaged || 0);
      totalGifted += (rec.gifted || 0);
    });

    // Summary stats row
    h += '<div class="history-summary-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:16px;">';
    h += historyStat('$' + (totalRevenue / 100).toFixed(2), 'Total Revenue', '#16a34a');
    h += historyStat(totalSalesCount.toString(), 'Total Sales', '');
    h += historyStat(totalItemsSold.toString(), 'Items Sold', '');
    if (totalDamaged > 0) h += historyStat(totalDamaged.toString(), 'Damaged', '#dc2626');
    if (totalGifted > 0) h += historyStat(totalGifted.toString(), 'Gifted', '#7c3aed');
    h += '</div>';

    // Payment method breakdown
    if (cashCount || cardCount || squareCount) {
      h += '<div class="history-payment-breakdown" style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:12px 16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:8px;">Sales by Payment Method</div>';
      h += '<div style="display:flex;gap:16px;flex-wrap:wrap;">';
      if (cashCount) h += '<div><span style="font-weight:600;color:#16a34a;">Cash:</span> ' + cashCount + ' sales / $' + (cashRevenue / 100).toFixed(2) + '</div>';
      if (cardCount) h += '<div><span style="font-weight:600;color:#2563eb;">Card:</span> ' + cardCount + ' sales / $' + (cardRevenue / 100).toFixed(2) + '</div>';
      if (squareCount) h += '<div><span style="font-weight:600;color:#7c3aed;">Square:</span> ' + squareCount + ' sales / $' + (squareRevenue / 100).toFixed(2) + '</div>';
      h += '</div></div>';
    }

    // Per-day breakdown for multi-day shows
    if (multiDay && Object.keys(perDayRevenue).length > 0) {
      h += '<div class="history-daily-breakdown" style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:12px 16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:8px;">Per-Day Revenue</div>';
      h += '<div style="display:flex;flex-direction:column;gap:6px;">';
      Object.keys(perDayRevenue).sort().forEach(function(dt) {
        var d = perDayRevenue[dt];
        var dayLabel = new Date(dt + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        var pct = totalRevenue > 0 ? Math.round((d.revenue / totalRevenue) * 100) : 0;
        h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        h += '<span style="font-size:0.9rem;">' + dayLabel + ' <span style="color:var(--text-secondary, #888);font-size:0.8rem;">(' + d.count + ' sale' + (d.count !== 1 ? 's' : '') + ')</span></span>';
        h += '<span style="font-weight:600;">$' + (d.revenue / 100).toFixed(2) + ' <span style="color:var(--text-secondary, #888);font-size:0.8rem;">(' + pct + '%)</span></span>';
        h += '</div>';
      });
      h += '</div></div>';
    }

    if (totalSalesCount === 0 && totalItemsSold === 0) {
      h += '<div class="history-empty-msg" style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:16px;color:var(--text-secondary, #888);font-size:0.9rem;">No sales or reconciliation data recorded for this show.</div>';
    }
  }
  h += '</div>';

  // --- P&L Section ---
  h += '<div style="margin-bottom:32px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  h += '<h3 style="margin:0;">Profit &amp; Loss</h3>';
  if (hasPermission('shows', 'update')) {
    h += '<button class="btn btn-sm" onclick="openShowExpenseModal(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">+ Add Expense</button>';
  }
  h += '</div>';

  // Revenue
  var plRevenue = 0;
  if (showEnded) {
    var plSales = exec.sales || {};
    if (multiDay) {
      getShowDates(s).forEach(function(dt) {
        var ds = plSales[dt] || {};
        Object.keys(ds).forEach(function(k) { plRevenue += (ds[k].priceCents || 0); });
      });
    } else {
      Object.keys(plSales).forEach(function(k) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) plRevenue += (plSales[k].priceCents || 0);
      });
    }
  }

  // Costs
  var boothFeeCents = s.boothFee || 0;
  var juryFeeCents = s.juryFee || 0;
  var expenses = historyData.expenses || {};
  var expenseKeys = Object.keys(expenses);
  var additionalExpensesCents = 0;
  expenseKeys.forEach(function(k) { additionalExpensesCents += (expenses[k].amountCents || 0); });
  var totalCostsCents = boothFeeCents + juryFeeCents + additionalExpensesCents;
  var netCents = plRevenue - totalCostsCents;
  var roi = totalCostsCents > 0 ? ((netCents / totalCostsCents) * 100).toFixed(1) : '—';

  h += '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">';
  // Revenue line
  h += '<div class="history-pl-row" style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary, #f5f5f5);border-radius:6px;">';
  h += '<span style="font-size:0.9rem;">Revenue</span>';
  h += '<span style="font-weight:600;color:#16a34a;">$' + (plRevenue / 100).toFixed(2) + '</span>';
  h += '</div>';
  // Booth fee
  if (boothFeeCents) {
    h += '<div class="history-pl-row" style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary, #f5f5f5);border-radius:6px;">';
    h += '<span style="font-size:0.9rem;">Booth Fee</span>';
    h += '<span style="font-weight:600;color:#dc2626;">-$' + (boothFeeCents / 100).toFixed(2) + '</span>';
    h += '</div>';
  }
  // Jury fee
  if (juryFeeCents) {
    h += '<div class="history-pl-row" style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary, #f5f5f5);border-radius:6px;">';
    h += '<span style="font-size:0.9rem;">Jury Fee</span>';
    h += '<span style="font-weight:600;color:#dc2626;">-$' + (juryFeeCents / 100).toFixed(2) + '</span>';
    h += '</div>';
  }
  // Additional expenses
  expenseKeys.forEach(function(k) {
    var exp = expenses[k];
    h += '<div class="history-pl-row" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-secondary, #f5f5f5);border-radius:6px;">';
    h += '<span style="font-size:0.9rem;">' + esc(exp.description || 'Expense') + '</span>';
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += '<span style="font-weight:600;color:#dc2626;">-$' + ((exp.amountCents || 0) / 100).toFixed(2) + '</span>';
    if (hasPermission('shows', 'update')) {
      h += '<button onclick="editShowExpense(\'' + showId + '\', \'' + k + '\')" style="background:none;border:none;color:var(--text-secondary, #888);cursor:pointer;font-size:0.85rem;" title="Edit">&#9998;</button>';
      h += '<button onclick="deleteShowExpense(\'' + showId + '\', \'' + k + '\')" style="background:none;border:none;color:var(--text-secondary, #888);cursor:pointer;font-size:1.1rem;" title="Delete">&times;</button>';
    }
    h += '</div></div>';
  });
  h += '</div>';

  // Net result
  var netColor = netCents >= 0 ? '#16a34a' : '#dc2626';
  h += '<div class="history-pl-net" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:' + (netCents >= 0 ? '#16a34a15' : '#dc262615') + ';border-radius:8px;border:1px solid ' + netColor + '33;">';
  h += '<div>';
  h += '<div style="font-weight:700;font-size:1.1rem;color:' + netColor + ';">' + (netCents >= 0 ? 'Profit' : 'Loss') + ': $' + (Math.abs(netCents) / 100).toFixed(2) + '</div>';
  h += '<div style="font-size:0.8rem;color:var(--text-secondary, #888);">ROI: ' + (roi === '—' ? '—' : roi + '%') + '</div>';
  h += '</div>';
  h += '<div style="text-align:right;font-size:0.8rem;color:var(--text-secondary, #888);">';
  h += 'Costs: $' + (totalCostsCents / 100).toFixed(2);
  h += '</div></div>';
  h += '</div>';

  // --- Show Review ---
  h += '<div style="margin-bottom:32px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  h += '<h3 style="margin:0;">Show Review</h3>';
  if (hasPermission('shows', 'update')) {
    h += '<button class="btn btn-sm" onclick="openShowReviewModal(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">Edit Review</button>';
  }
  h += '</div>';
  var review = historyData.review || {};
  if (!review.rating && !review.wouldAttendAgain && !review.bestSellers && !review.lessonsLearned) {
    h += '<div class="history-empty-msg" style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:16px;color:var(--text-secondary, #888);font-size:0.9rem;">No review yet. Add your post-show reflection.</div>';
  } else {
    h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:12px;padding:16px;">';
    // Rating
    if (review.rating) {
      h += '<div style="margin-bottom:12px;">';
      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">Rating</div>';
      h += '<div style="font-size:1.2rem;">';
      for (var i = 1; i <= 5; i++) {
        h += '<span style="color:' + (i <= review.rating ? '#f59e0b' : '#d1d5db') + ';">&#9733;</span>';
      }
      h += '</div></div>';
    }
    // Would attend again
    if (review.wouldAttendAgain) {
      var attendColors = { yes: '#16a34a', maybe: '#f59e0b', no: '#dc2626' };
      var attendLabels = { yes: 'Yes', maybe: 'Maybe', no: 'No' };
      h += '<div style="margin-bottom:12px;">';
      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">Would Attend Again</div>';
      h += '<span style="font-size:0.85rem;font-weight:600;color:' + (attendColors[review.wouldAttendAgain] || '#888') + ';">' + (attendLabels[review.wouldAttendAgain] || review.wouldAttendAgain) + '</span>';
      h += '</div>';
    }
    // Best sellers
    if (review.bestSellers) {
      h += '<div style="margin-bottom:12px;">';
      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">Best Sellers</div>';
      h += '<div style="font-size:0.9rem;white-space:pre-wrap;line-height:1.5;">' + esc(review.bestSellers) + '</div>';
      h += '</div>';
    }
    // Lessons learned
    if (review.lessonsLearned) {
      h += '<div>';
      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">Lessons Learned</div>';
      h += '<div style="font-size:0.9rem;white-space:pre-wrap;line-height:1.5;">' + esc(review.lessonsLearned) + '</div>';
      h += '</div>';
    }
    h += '</div>';
  }
  h += '</div>';

  // --- Notes Archive ---
  h += '<div style="margin-bottom:32px;">';
  h += '<h3 style="margin:0 0 12px 0;">Notes Archive</h3>';
  var notes = exec.notes || {};
  var hasNotes = false;
  if (multiDay) {
    var showDates = getShowDates(s);
    var notesHtml = '';
    showDates.forEach(function(dt) {
      var noteText = notes[dt];
      if (noteText) {
        hasNotes = true;
        var dayLabel = new Date(dt + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        notesHtml += '<div class="history-note-entry" style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:12px 16px;margin-bottom:8px;border-left:3px solid var(--primary, #2a7c6f);">';
        notesHtml += '<div style="font-size:0.8rem;font-weight:600;color:var(--primary, #2a7c6f);margin-bottom:6px;">' + dayLabel + '</div>';
        notesHtml += '<div style="font-size:0.9rem;white-space:pre-wrap;line-height:1.5;">' + esc(noteText) + '</div>';
        notesHtml += '</div>';
      }
    });
    if (hasNotes) h += notesHtml;
  } else {
    var singleNote = typeof notes === 'string' ? notes : (notes._default || '');
    if (singleNote) {
      hasNotes = true;
      h += '<div class="history-note-entry" style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:12px 16px;border-left:3px solid var(--primary, #2a7c6f);">';
      h += '<div style="font-size:0.9rem;white-space:pre-wrap;line-height:1.5;">' + esc(singleNote) + '</div>';
      h += '</div>';
    }
  }
  if (!hasNotes) {
    h += '<div class="history-empty-msg" style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:16px;color:var(--text-secondary, #888);font-size:0.9rem;">No show notes recorded.</div>';
  }
  h += '</div>';

  return h;
}

function historyStat(value, label, color) {
  return '<div class="history-stat-card" style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">' +
    '<div style="font-size:1.25rem;font-weight:700;' + (color ? 'color:' + color + ';' : '') + '">' + value + '</div>' +
    '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">' + label + '</div>' +
  '</div>';
}

// === History Tab — Expense CRUD ===

function openShowExpenseModal(showId, expenseId) {
  var s = showsData[showId];
  var existing = null;
  if (expenseId && s && s.history && s.history.expenses) {
    existing = s.history.expenses[expenseId];
  }
  var exp = existing || {};

  var h = '<div id="showExpenseModal" class="history-modal-wrap" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">';
  h += '<div style="background:var(--bg-primary, #fff);border-radius:12px;padding:24px;max-width:400px;width:90%;">';
  h += '<h3 style="margin:0 0 16px 0;">' + (expenseId ? 'Edit' : 'Add') + ' Expense</h3>';
  h += '<div style="margin-bottom:12px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Description *</label>';
  h += '<input id="expenseDescription" type="text" placeholder="e.g. Gas, Parking, Supplies" value="' + esc(exp.description || '') + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div>';
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Amount ($) *</label>';
  h += '<input id="expenseAmount" type="number" step="0.01" min="0" placeholder="25.00" value="' + (exp.amountCents ? (exp.amountCents / 100).toFixed(2) : '') + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div>';
  h += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
  h += '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'showExpenseModal\').remove()">Cancel</button>';
  h += '<button class="btn btn-sm" onclick="saveShowExpense(\'' + showId + '\', ' + (expenseId ? '\'' + expenseId + '\'' : 'null') + ')" style="background:var(--primary, #2a7c6f);color:white;border:none;">Save</button>';
  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}

async function saveShowExpense(showId, expenseId) {
  var desc = document.getElementById('expenseDescription').value.trim();
  if (!desc) { showToast('Description is required.', true); return; }
  var amtVal = parseFloat(document.getElementById('expenseAmount').value);
  if (isNaN(amtVal) || amtVal < 0) { showToast('Valid amount is required.', true); return; }
  var amountCents = Math.round(amtVal * 100);

  var data = {
    description: desc,
    amountCents: amountCents,
    updatedAt: new Date().toISOString()
  };

  try {
    if (expenseId) {
      await MastDB.shows.subRef(showId, 'history', 'expenses', expenseId).update(data);
    } else {
      data.createdAt = new Date().toISOString();
      await MastDB.shows.subRef(showId, 'history', 'expenses').push().set(data);
    }
    var modal = document.getElementById('showExpenseModal');
    if (modal) modal.remove();
    showToast(expenseId ? 'Expense updated.' : 'Expense added.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error saving expense: ' + err.message, true);
  }
}

function editShowExpense(showId, expenseId) {
  openShowExpenseModal(showId, expenseId);
}

async function deleteShowExpense(showId, expenseId) {
  if (!await mastConfirm('Delete this expense?', { title: 'Delete Expense', danger: true })) return;
  try {
    await MastDB.shows.subRef(showId, 'history', 'expenses', expenseId).remove();
    showToast('Expense deleted.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error deleting expense: ' + err.message, true);
  }
}

// === History Tab — Show Review CRUD ===

function openShowReviewModal(showId) {
  var s = showsData[showId];
  var review = (s && s.history && s.history.review) || {};

  var h = '<div id="showReviewModal" class="history-modal-wrap" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">';
  h += '<div style="background:var(--bg-primary, #fff);border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;">';
  h += '<h3 style="margin:0 0 16px 0;">Show Review</h3>';

  // Rating
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Rating</label>';
  h += '<div id="reviewStars" style="display:flex;gap:4px;">';
  for (var i = 1; i <= 5; i++) {
    h += '<span class="review-star" data-value="' + i + '" onclick="setReviewRating(' + i + ')" style="font-size:1.8rem;cursor:pointer;color:' + (i <= (review.rating || 0) ? '#f59e0b' : '#d1d5db') + ';">&#9733;</span>';
  }
  h += '</div>';
  h += '<input type="hidden" id="reviewRating" value="' + (review.rating || 0) + '">';
  h += '</div>';

  // Would attend again
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Would Attend Again</label>';
  h += '<div style="display:flex;gap:8px;">';
  ['yes', 'maybe', 'no'].forEach(function(val) {
    var label = val.charAt(0).toUpperCase() + val.slice(1);
    var colors = { yes: '#16a34a', maybe: '#f59e0b', no: '#dc2626' };
    var isSelected = review.wouldAttendAgain === val;
    h += '<button class="btn btn-small review-attend-btn" data-value="' + val + '" onclick="setReviewAttend(\'' + val + '\')" style="' +
      'border:1px solid ' + (isSelected ? colors[val] : '#ddd') + ';' +
      'background:' + (isSelected ? colors[val] : 'var(--cream, #FAF6F0)') + ';' +
      'color:' + (isSelected ? 'white' : 'var(--charcoal, #1A1A1A)') + ';font-weight:' + (isSelected ? '600' : '400') + ';">' + label + '</button>';
  });
  h += '</div>';
  h += '<input type="hidden" id="reviewAttend" value="' + (review.wouldAttendAgain || '') + '">';
  h += '</div>';

  // Best sellers
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Best Sellers</label>';
  h += '<textarea id="reviewBestSellers" rows="3" placeholder="What sold best? What got the most attention?" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;line-height:1.5;">' + esc(review.bestSellers || '') + '</textarea>';
  h += '</div>';

  // Lessons learned
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Lessons Learned</label>';
  h += '<textarea id="reviewLessons" rows="3" placeholder="What would you do differently? Any surprises?" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;line-height:1.5;">' + esc(review.lessonsLearned || '') + '</textarea>';
  h += '</div>';

  h += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
  h += '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'showReviewModal\').remove()">Cancel</button>';
  h += '<button class="btn btn-sm" onclick="saveShowReview(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">Save</button>';
  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}

function setReviewRating(val) {
  document.getElementById('reviewRating').value = val;
  var stars = document.querySelectorAll('#reviewStars .review-star');
  stars.forEach(function(star) {
    var sv = parseInt(star.getAttribute('data-value'));
    star.style.color = sv <= val ? '#f59e0b' : '#d1d5db';
  });
}

function setReviewAttend(val) {
  document.getElementById('reviewAttend').value = val;
  var colors = { yes: '#16a34a', maybe: '#f59e0b', no: '#dc2626' };
  var btns = document.querySelectorAll('.review-attend-btn');
  btns.forEach(function(btn) {
    var bv = btn.getAttribute('data-value');
    var isSelected = bv === val;
    btn.style.background = isSelected ? colors[bv] : 'var(--cream, #FAF6F0)';
    btn.style.color = isSelected ? 'white' : 'var(--charcoal, #1A1A1A)';
    btn.style.borderColor = isSelected ? colors[bv] : '#ddd';
    btn.style.fontWeight = isSelected ? '600' : '400';
  });
}

async function saveShowReview(showId) {
  var rating = parseInt(document.getElementById('reviewRating').value) || 0;
  var wouldAttendAgain = document.getElementById('reviewAttend').value || null;
  var bestSellers = document.getElementById('reviewBestSellers').value.trim() || null;
  var lessonsLearned = document.getElementById('reviewLessons').value.trim() || null;

  var data = {
    rating: rating || null,
    wouldAttendAgain: wouldAttendAgain,
    bestSellers: bestSellers,
    lessonsLearned: lessonsLearned,
    updatedAt: new Date().toISOString()
  };

  try {
    await MastDB.shows.subRef(showId, 'history', 'review').set(data);
    var modal = document.getElementById('showReviewModal');
    if (modal) modal.remove();
    showToast('Review saved.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error saving review: ' + err.message, true);
  }
}

function showDetailCard(label, value) {
  return '<div style="background:var(--bg-secondary, #f9f9f9);border-radius:8px;padding:12px;">' +
    '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">' + label + '</div>' +
    '<div style="font-size:0.9rem;">' + value + '</div>' +
  '</div>';
}

function backToShowsList() {
  if (window.MastNavStack && MastNavStack.size() > 0) {
    selectedShowId = null;
    var dv = document.getElementById('showDetailView');
    if (dv) dv.style.display = 'none';
    MastNavStack.popAndReturn();
    return;
  }
  selectedShowId = null;
  var detailView = document.getElementById('showDetailView');
  if (detailView) detailView.style.display = 'none';
  var viewMap = {
    find: 'showFindView',
    apply: 'showApplyView',
    prep: 'showPrepView',
    execute: 'showExecuteView',
    history: 'showHistoryView'
  };
  var targetId = viewMap[showSubView];
  if (targetId) {
    var el = document.getElementById(targetId);
    if (el) el.style.display = '';
  }
}

// === Show Prep — Staffing Functions ===

async function openShowStaffingModal(showId) {
  // Ensure admin users are loaded
  if (!adminUsersLoaded) {
    try {
      var snap = await MastDB.adminUsers.ref().once('value');
      adminUsers = snap.val() || {};
      adminUsersLoaded = true;
    } catch (err) {
      showToast('Failed to load users.', true);
      return;
    }
  }
  var s = showsData[showId];
  var existingStaff = (s && s.prep && s.prep.staffing) ? s.prep.staffing : {};
  var availableUsers = [];
  Object.keys(adminUsers).forEach(function(uid) {
    if (!existingStaff[uid] && adminUsers[uid].role !== 'guest') {
      availableUsers.push({ uid: uid, name: adminUsers[uid].name || adminUsers[uid].email || uid });
    }
  });

  if (availableUsers.length === 0) {
    showToast('All eligible users are already assigned to this show.', true);
    return;
  }

  var h = '<div id="showStaffingModal" class="show-modal-wrap" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">';
  h += '<div style="background:var(--bg-primary, #fff);border-radius:12px;padding:24px;max-width:400px;width:90%;max-height:80vh;overflow-y:auto;">';
  h += '<h3 style="margin:0 0 16px 0;">Assign Staff to Show</h3>';
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Team Member</label>';
  h += '<select id="staffingUserSelect" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);">';
  availableUsers.forEach(function(u) {
    h += '<option value="' + u.uid + '">' + esc(u.name) + '</option>';
  });
  h += '</select></div>';
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Role at Show</label>';
  h += '<select id="staffingRoleSelect" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);">';
  h += '<option value="lead">Lead (runs the booth)</option>';
  h += '<option value="support" selected>Support (assists)</option>';
  h += '<option value="driver">Driver (logistics)</option>';
  h += '</select></div>';
  h += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
  h += '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'showStaffingModal\').remove()">Cancel</button>';
  h += '<button class="btn btn-sm" onclick="saveShowStaff(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">Assign</button>';
  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}

async function saveShowStaff(showId) {
  var uid = document.getElementById('staffingUserSelect').value;
  var showRole = document.getElementById('staffingRoleSelect').value;
  if (!uid) return;
  var userName = (adminUsers[uid] && (adminUsers[uid].name || adminUsers[uid].email)) || uid;
  try {
    await MastDB.shows.subRef(showId, 'prep', 'staffing', uid).set({
      name: userName,
      showRole: showRole,
      assignedAt: new Date().toISOString()
    });
    var modal = document.getElementById('showStaffingModal');
    if (modal) modal.remove();
    showToast(userName + ' assigned as ' + showRole + '.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error assigning staff: ' + err.message, true);
  }
}

async function removeShowStaff(showId, uid) {
  if (!await mastConfirm('Remove this staff member from the show?', { title: 'Remove Staff' })) return;
  try {
    await MastDB.shows.subRef(showId, 'prep', 'staffing', uid).remove();
    showToast('Staff removed.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error removing staff: ' + err.message, true);
  }
}

// === Show Prep — Inventory Functions ===

function addShowInventoryItem(showId) {
  openShowInventoryModal(showId, null);
}

function editShowInventoryItem(showId, itemId) {
  var s = showsData[showId];
  var item = s && s.prep && s.prep.inventory && s.prep.inventory[itemId];
  openShowInventoryModal(showId, itemId, item);
}

function openShowInventoryModal(showId, itemId, existing) {
  var item = existing || {};
  var h = '<div id="showInventoryModal" class="show-modal-wrap" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">';
  h += '<div style="background:var(--bg-primary, #fff);border-radius:12px;padding:24px;max-width:450px;width:90%;max-height:80vh;overflow-y:auto;">';
  h += '<h3 style="margin:0 0 16px 0;">' + (itemId ? 'Edit' : 'Add') + ' Inventory Item</h3>';
  h += '<div style="margin-bottom:12px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Item Name *</label>';
  h += '<input id="invItemName" type="text" value="' + esc(item.name || '') + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">';
  h += '<div>';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Quantity</label>';
  h += '<input id="invItemQty" type="number" min="1" value="' + (item.quantity || '') + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div>';
  h += '<div>';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Link to Make Job</label>';
  h += '<input id="invItemMakeJob" type="text" placeholder="Job name or ID" value="' + esc(item.linkedMakeJob || '') + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div></div>';
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Notes</label>';
  h += '<textarea id="invItemNotes" rows="2" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">' + esc(item.notes || '') + '</textarea>';
  h += '</div>';
  h += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
  h += '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'showInventoryModal\').remove()">Cancel</button>';
  h += '<button class="btn btn-sm" onclick="saveShowInventoryItem(\'' + showId + '\', ' + (itemId ? '\'' + itemId + '\'' : 'null') + ')" style="background:var(--primary, #2a7c6f);color:white;border:none;">Save</button>';
  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}

async function saveShowInventoryItem(showId, itemId) {
  var name = document.getElementById('invItemName').value.trim();
  if (!name) { showToast('Item name is required.', true); return; }
  var data = {
    name: name,
    quantity: parseInt(document.getElementById('invItemQty').value) || null,
    linkedMakeJob: document.getElementById('invItemMakeJob').value.trim() || null,
    notes: document.getElementById('invItemNotes').value.trim() || null,
    updatedAt: new Date().toISOString()
  };
  try {
    if (itemId) {
      // Preserve packed state on edit
      var s = showsData[showId];
      var existing = s && s.prep && s.prep.inventory && s.prep.inventory[itemId];
      if (existing && existing.packed) data.packed = true;
      await MastDB.shows.subRef(showId, 'prep', 'inventory', itemId).update(data);
    } else {
      data.packed = false;
      data.createdAt = new Date().toISOString();
      await MastDB.shows.subRef(showId, 'prep', 'inventory').push().set(data);
    }
    var modal = document.getElementById('showInventoryModal');
    if (modal) modal.remove();
    showToast(itemId ? 'Item updated.' : 'Item added.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error saving item: ' + err.message, true);
  }
}

async function toggleShowInventoryPacked(showId, itemId, packed) {
  try {
    await MastDB.shows.subRef(showId, 'prep', 'inventory', itemId, 'packed').set(packed);
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error updating item: ' + err.message, true);
  }
}

async function removeShowInventoryItem(showId, itemId) {
  if (!await mastConfirm('Remove this item from the pull list?', { title: 'Remove Item' })) return;
  try {
    await MastDB.shows.subRef(showId, 'prep', 'inventory', itemId).remove();
    showToast('Item removed.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error removing item: ' + err.message, true);
  }
}

// === Show Prep — Logistics Functions ===

function editShowLogistics(showId) {
  var s = showsData[showId];
  var logistics = (s && s.prep && s.prep.logistics) || {};
  var h = '<div id="showLogisticsModal" class="show-modal-wrap" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">';
  h += '<div style="background:var(--bg-primary, #fff);border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;">';
  h += '<h3 style="margin:0 0 16px 0;">Show Logistics</h3>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">';
  h += '<div>';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Booth Size</label>';
  h += '<input id="logBoothSize" type="text" placeholder="e.g. 10x10" value="' + esc(logistics.boothSize || '') + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div>';
  h += '<div>';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Setup Time</label>';
  h += '<input id="logSetupTime" type="text" placeholder="e.g. 7:00 AM" value="' + esc(logistics.setupTime || '') + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div></div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">';
  h += '<div>';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Teardown Time</label>';
  h += '<input id="logTeardownTime" type="text" placeholder="e.g. 6:00 PM" value="' + esc(logistics.teardownTime || '') + '" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">';
  h += '</div>';
  h += '<div></div></div>';
  h += '<div style="margin-bottom:12px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Parking / Load-In Notes</label>';
  h += '<textarea id="logParkingNotes" rows="2" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">' + esc(logistics.parkingNotes || '') + '</textarea>';
  h += '</div>';
  h += '<div style="margin-bottom:12px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Hotel / Accommodation</label>';
  h += '<textarea id="logHotelNotes" rows="2" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">' + esc(logistics.hotelNotes || '') + '</textarea>';
  h += '</div>';
  h += '<div style="margin-bottom:12px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Travel Notes</label>';
  h += '<textarea id="logTravelNotes" rows="2" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">' + esc(logistics.travelNotes || '') + '</textarea>';
  h += '</div>';
  h += '<div style="margin-bottom:16px;">';
  h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">General Notes</label>';
  h += '<textarea id="logNotes" rows="3" style="width:100%;padding:8px;border:1px solid var(--border-color, #ddd);border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical;background:var(--bg-primary, #fff);color:var(--text-primary, #333);box-sizing:border-box;">' + esc(logistics.notes || '') + '</textarea>';
  h += '</div>';
  h += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
  h += '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'showLogisticsModal\').remove()">Cancel</button>';
  h += '<button class="btn btn-sm" onclick="saveShowLogistics(\'' + showId + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;">Save</button>';
  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}

async function saveShowLogistics(showId) {
  var data = {
    boothSize: document.getElementById('logBoothSize').value.trim() || null,
    setupTime: document.getElementById('logSetupTime').value.trim() || null,
    teardownTime: document.getElementById('logTeardownTime').value.trim() || null,
    parkingNotes: document.getElementById('logParkingNotes').value.trim() || null,
    hotelNotes: document.getElementById('logHotelNotes').value.trim() || null,
    travelNotes: document.getElementById('logTravelNotes').value.trim() || null,
    notes: document.getElementById('logNotes').value.trim() || null,
    updatedAt: new Date().toISOString()
  };
  try {
    await MastDB.shows.subRef(showId, 'prep', 'logistics').set(data);
    var modal = document.getElementById('showLogisticsModal');
    if (modal) modal.remove();
    showToast('Logistics saved.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error saving logistics: ' + err.message, true);
  }
}

async function updateShowStatus(showId, newStatus) {
  var s = showsData[showId];
  if (!s) return;
  var oldStatus = s.applicationStatus || 'considering';
  if (oldStatus === newStatus) return;

  try {
    var updates = {
      applicationStatus: newStatus,
      updatedAt: new Date().toISOString()
    };
    // Track specific timestamps
    if (newStatus === 'applied') updates.appliedAt = new Date().toISOString();
    if (newStatus === 'accepted' || newStatus === 'rejected' || newStatus === 'waitlisted') updates.resultNotifiedAt = new Date().toISOString();

    await MastDB.shows.update(showId, updates);

    // Log to applicationHistory
    var historyRef = MastDB.shows.applicationHistory(showId).push();
    await historyRef.set({
      oldStatus: oldStatus,
      newStatus: newStatus,
      timestamp: new Date().toISOString(),
      changedBy: auth.currentUser ? auth.currentUser.uid : 'unknown'
    });

    // Auto-publish to public events when accepted (admin-only — public path requires admin write)
    if (newStatus === 'accepted') {
      if (currentUserRole === 'admin') {
        await autoPublishShow(showId, s);
      } else {
        showToast('Show accepted. An admin must publish it to the public calendar.', false);
      }
    }

    showToast('Status updated to ' + newStatus + '.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Error updating status: ' + err.message, true);
  }
}

async function autoPublishShow(showId, showData) {
  try {
    var publicEvent = {
      name: showData.name || 'Unnamed Show',
      date: showData.startDate || '',
      endDate: showData.endDate || null,
      location: [showData.locationCity, showData.locationState].filter(Boolean).join(', '),
      description: (SHOW_TYPE_LABELS[showData.type] || 'Show') + (showData.websiteUrl ? ' — ' + showData.websiteUrl : ''),
      visible: true,
      source: 'show-section',
      showId: showId,
      updatedAt: new Date().toISOString()
    };
    await MastDB.events.ref(showId).set(publicEvent);
  } catch (err) {
    console.error('Auto-publish failed:', err);
  }
}

async function archiveShow(showId) {
  if (!hasPermission('shows', 'delete')) { showToast('You do not have permission to delete shows.', true); return; }
  if (!await mastConfirm('Delete this show? This cannot be undone.', { title: 'Delete Show', danger: true })) return;
  try {
    await MastDB.shows.remove(showId);
    // Also remove from public events if it was published
    try { await MastDB.events.ref(showId).remove(); } catch(e) { /* ignore */ }
    showToast('Show deleted.');
    backToShowsList();
  } catch (err) {
    showToast('Error deleting show: ' + err.message, true);
  }
}

// === Show Prep View ===

function renderShowPrepView() {
  var cardsEl = document.getElementById('showPrepCards');
  var emptyEl = document.getElementById('showPrepEmpty');
  if (!cardsEl) return;

  var today = new Date().toISOString().split('T')[0];
  var accepted = getShowsArray().filter(function(s) {
    return s.applicationStatus === 'accepted';
  });
  // Sort by startDate ascending (soonest first)
  accepted.sort(function(a, b) {
    return (a.startDate || '9999').localeCompare(b.startDate || '9999');
  });

  if (accepted.length === 0) {
    cardsEl.style.display = 'none';
    cardsEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  cardsEl.style.display = 'flex';

  var cards = '';
  accepted.forEach(function(s) {
    var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
    var dates = '';
    if (s.startDate) {
      dates = formatShowDate(s.startDate);
      if (s.endDate && s.endDate !== s.startDate) dates += ' – ' + formatShowDate(s.endDate);
    }
    var daysUntil = s.startDate ? Math.ceil((new Date(s.startDate + 'T00:00:00') - new Date()) / 86400000) : null;
    var daysBadge = '';
    if (daysUntil !== null) {
      if (daysUntil < 0) {
        daysBadge = '<span style="background:#16a34a;color:white;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">In Progress</span>';
      } else if (daysUntil === 0) {
        daysBadge = '<span style="background:#f59e0b;color:white;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">Today</span>';
      } else {
        daysBadge = '<span style="background:var(--bg-tertiary, #e5e5e5);color:var(--text-primary, #333);padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">' + daysUntil + ' day' + (daysUntil !== 1 ? 's' : '') + ' away</span>';
      }
    }

    var prep = s.prep || {};
    var staffCount = prep.staffing ? Object.keys(prep.staffing).length : 0;
    var invItems = prep.inventory ? Object.keys(prep.inventory) : [];
    var invTotal = invItems.length;
    var invPacked = invItems.filter(function(k) { return prep.inventory[k].packed; }).length;
    var hasLogistics = prep.logistics && (prep.logistics.boothSize || prep.logistics.setupTime || prep.logistics.travelNotes);

    cards += '<div class="order-card" onclick="viewShowDetail(\'' + s._key + '\', \'prep\')" style="cursor:pointer;">' +
      '<div class="order-card-header" style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span class="order-card-id" style="font-weight:600;">' + esc(s.name || 'Unnamed Show') + '</span>' +
        daysBadge +
      '</div>' +
      '<div class="order-card-details">' +
        (dates ? '<span>' + dates + '</span>' : '') +
        (location ? '<span>' + esc(location) + '</span>' : '') +
      '</div>' +
      '<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">' +
        '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:6px;padding:10px;">' +
          '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">Staffing</div>' +
          '<div style="font-size:0.85rem;' + (staffCount ? '' : 'color:var(--text-secondary, #888);font-style:italic;') + '">' + (staffCount ? staffCount + ' assigned' : 'Not assigned') + '</div>' +
        '</div>' +
        '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:6px;padding:10px;">' +
          '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">Inventory</div>' +
          '<div style="font-size:0.85rem;' + (invTotal ? '' : 'color:var(--text-secondary, #888);font-style:italic;') + '">' + (invTotal ? invPacked + '/' + invTotal + ' packed' : 'No items') + '</div>' +
        '</div>' +
        '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:6px;padding:10px;">' +
          '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">Logistics</div>' +
          '<div style="font-size:0.85rem;' + (hasLogistics ? '' : 'color:var(--text-secondary, #888);font-style:italic;') + '">' + (hasLogistics ? '✓ Details added' : 'Not set') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  });
  cardsEl.innerHTML = cards;
}

// === Show Execute View ===

function renderShowExecuteView() {
  var cardsEl = document.getElementById('showExecuteCards');
  var emptyEl = document.getElementById('showExecuteEmpty');
  if (!cardsEl) return;

  var today = new Date().toISOString().split('T')[0];
  var accepted = getShowsArray().filter(function(s) {
    return s.applicationStatus === 'accepted';
  });

  // Shows happening now: startDate <= today <= endDate
  var liveShows = accepted.filter(function(s) {
    return s.startDate && s.startDate <= today && (s.endDate || s.startDate) >= today;
  });

  var displayShows;
  var isUpcoming = false;
  if (liveShows.length > 0) {
    displayShows = liveShows;
  } else {
    // Upcoming within 7 days
    var sevenDaysOut = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    displayShows = accepted.filter(function(s) {
      return s.startDate && s.startDate > today && s.startDate <= sevenDaysOut;
    });
    isUpcoming = true;
  }
  // Sort by startDate ascending
  displayShows.sort(function(a, b) {
    return (a.startDate || '9999').localeCompare(b.startDate || '9999');
  });

  if (accepted.length === 0) {
    cardsEl.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = ''; emptyEl.querySelector('p').textContent = 'No accepted shows yet.'; }
    return;
  }
  if (displayShows.length === 0) {
    cardsEl.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = ''; emptyEl.querySelector('p').textContent = 'No shows happening right now. Active shows appear here during their event dates.'; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  var cards = '';
  displayShows.forEach(function(s) {
    var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
    var liveBadge = '';
    if (!isUpcoming) {
      liveBadge = '<span style="background:#16a34a;color:white;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;animation:pulse 2s infinite;">Live Now</span>';
    } else {
      var daysUntil = Math.ceil((new Date(s.startDate + 'T00:00:00') - new Date()) / 86400000);
      liveBadge = '<span style="background:#2563eb;color:white;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">Starts in ' + daysUntil + ' day' + (daysUntil !== 1 ? 's' : '') + '</span>';
    }

    // Calculate real execute data for this show
    var exec = s.execute || {};
    var salesObj = exec.sales || {};
    var totalSalesCount = 0;
    var totalRevenue = 0;
    var multi = s.startDate && s.endDate && s.endDate !== s.startDate;
    if (multi) {
      // Multi-day: sales are under date sub-keys
      Object.keys(salesObj).forEach(function(dateKey) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && typeof salesObj[dateKey] === 'object') {
          Object.keys(salesObj[dateKey]).forEach(function(saleKey) {
            totalSalesCount++;
            totalRevenue += (salesObj[dateKey][saleKey].priceCents || 0);
          });
        }
      });
    } else {
      Object.keys(salesObj).forEach(function(k) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) {
          totalSalesCount++;
          totalRevenue += (salesObj[k].priceCents || 0);
        }
      });
    }
    var reconObj = exec.reconciliation || {};
    var reconCount = Object.keys(reconObj).length;
    var prepInv = (s.prep && s.prep.inventory) ? Object.keys(s.prep.inventory).filter(function(k) { return s.prep.inventory[k].packed; }).length : 0;

    cards += '<div class="order-card" onclick="viewShowDetail(\'' + s._key + '\', \'execute\')" style="cursor:pointer;">' +
      '<div class="order-card-header" style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span class="order-card-id" style="font-weight:600;">' + esc(s.name || 'Unnamed Show') + '</span>' +
        liveBadge +
      '</div>' +
      '<div class="order-card-details">' +
        (location ? '<span>' + esc(location) + '</span>' : '') +
      '</div>' +
      '<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">' +
        '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:6px;padding:10px;">' +
          '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">Sales</div>' +
          '<div style="font-size:0.85rem;' + (totalSalesCount ? '' : 'color:var(--text-secondary, #888);font-style:italic;') + '">' +
            (totalSalesCount ? '$' + (totalRevenue / 100).toFixed(2) + ' (' + totalSalesCount + ' sale' + (totalSalesCount !== 1 ? 's' : '') + ')' : 'No sales yet') +
          '</div>' +
        '</div>' +
        '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:6px;padding:10px;">' +
          '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;margin-bottom:4px;">Reconciliation</div>' +
          '<div style="font-size:0.85rem;' + (reconCount ? '' : 'color:var(--text-secondary, #888);font-style:italic;') + '">' +
            (reconCount ? reconCount + '/' + prepInv + ' items tracked' : (prepInv ? prepInv + ' items to track' : 'No inventory')) +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  });
  cardsEl.innerHTML = cards;
}

// === Show History View ===

function renderShowHistoryView() {
  var cardsEl = document.getElementById('showHistoryCards');
  var emptyEl = document.getElementById('showHistoryEmpty');
  var statsEl = document.getElementById('showHistoryStats');
  if (!cardsEl) return;

  var today = new Date().toISOString().split('T')[0];
  var allShows = getShowsArray();

  // Past shows: endDate < today OR rejected/withdrawn
  var historyShows = allShows.filter(function(s) {
    var endDate = s.endDate || s.startDate;
    var isPast = endDate && endDate < today;
    var isTerminal = s.applicationStatus === 'rejected' || s.applicationStatus === 'withdrawn';
    return isPast || isTerminal;
  });

  // Apply filters
  var statusFilter = document.getElementById('showHistoryStatusFilter');
  var typeFilter = document.getElementById('showHistoryTypeFilter');
  var filtered = historyShows.slice();
  if (statusFilter && statusFilter.value !== 'all') {
    filtered = filtered.filter(function(s) { return s.applicationStatus === statusFilter.value; });
  }
  if (typeFilter && typeFilter.value !== 'all') {
    filtered = filtered.filter(function(s) { return s.type === typeFilter.value; });
  }

  // Sort by endDate descending (most recent first)
  filtered.sort(function(a, b) {
    return (b.endDate || b.startDate || '').localeCompare(a.endDate || a.startDate || '');
  });

  // Summary stats (before filtering)
  if (statsEl) {
    var acceptedCount = historyShows.filter(function(s) { return s.applicationStatus === 'accepted'; }).length;
    var rejectedCount = historyShows.filter(function(s) { return s.applicationStatus === 'rejected'; }).length;
    statsEl.style.display = historyShows.length > 0 ? 'flex' : 'none';
    statsEl.innerHTML =
      '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">' +
        '<div style="font-size:1.25rem;font-weight:700;">' + historyShows.length + '</div>' +
        '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Total</div>' +
      '</div>' +
      '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">' +
        '<div style="font-size:1.25rem;font-weight:700;color:#16a34a;">' + acceptedCount + '</div>' +
        '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Accepted</div>' +
      '</div>' +
      '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">' +
        '<div style="font-size:1.25rem;font-weight:700;color:#dc2626;">' + rejectedCount + '</div>' +
        '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Rejected</div>' +
      '</div>';
  }

  if (filtered.length === 0) {
    cardsEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  var cards = '';
  filtered.forEach(function(s) {
    var statusClass = s.applicationStatus || 'considering';
    var statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
    var typeLabel = SHOW_TYPE_LABELS[s.type] || s.type || 'Other';
    var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
    var dates = '';
    if (s.startDate) {
      dates = formatShowDate(s.startDate);
      if (s.endDate && s.endDate !== s.startDate) dates += ' – ' + formatShowDate(s.endDate);
    }

    // Calculate metrics for comparison view
    var exec = s.execute || {};
    var salesObj = exec.sales || {};
    var totalRevenue = 0;
    var totalSalesCount = 0;
    var multiDay = s.startDate && s.endDate && s.endDate !== s.startDate;
    if (multiDay) {
      Object.keys(salesObj).forEach(function(dateKey) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && typeof salesObj[dateKey] === 'object') {
          Object.keys(salesObj[dateKey]).forEach(function(saleKey) {
            totalSalesCount++;
            totalRevenue += (salesObj[dateKey][saleKey].priceCents || 0);
          });
        }
      });
    } else {
      Object.keys(salesObj).forEach(function(k) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) {
          totalSalesCount++;
          totalRevenue += (salesObj[k].priceCents || 0);
        }
      });
    }

    var reconObj = exec.reconciliation || {};
    var itemsSold = 0;
    Object.keys(reconObj).forEach(function(k) { itemsSold += (reconObj[k].sold || 0); });

    // P&L
    var totalCosts = (s.boothFee || 0) + (s.juryFee || 0);
    var histExpenses = (s.history && s.history.expenses) || {};
    Object.keys(histExpenses).forEach(function(k) { totalCosts += (histExpenses[k].amountCents || 0); });
    var net = totalRevenue - totalCosts;

    // Review
    var review = (s.history && s.history.review) || {};
    var ratingStars = '';
    if (review.rating) {
      for (var i = 1; i <= 5; i++) {
        ratingStars += '<span style="color:' + (i <= review.rating ? '#f59e0b' : '#d1d5db') + ';font-size:0.85rem;">&#9733;</span>';
      }
    }

    var endDate = s.endDate || s.startDate;
    var showEnded = endDate && endDate < today;

    cards += '<div class="order-card history-comparison-card" onclick="viewShowDetail(\'' + s._key + '\', \'history\')" style="cursor:pointer;">' +
      '<div class="order-card-header" style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span class="order-card-id" style="font-weight:600;">' + esc(s.name || 'Unnamed Show') + '</span>' +
        '<span class="status-badge" style="' + showStatusBadgeStyle(statusClass) + '">' + statusLabel + '</span>' +
      '</div>' +
      '<div class="order-card-details">' +
        '<span>' + esc(typeLabel) + '</span>' +
        (location ? '<span>' + esc(location) + '</span>' : '') +
        (dates ? '<span>' + dates + '</span>' : '') +
      '</div>';

    // Metrics row (only for accepted shows that have ended)
    if (showEnded && s.applicationStatus === 'accepted') {
      cards += '<div class="history-card-metrics" style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;">';
      cards += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:6px;padding:8px;text-align:center;">' +
        '<div style="font-size:1rem;font-weight:700;color:#16a34a;">$' + (totalRevenue / 100).toFixed(0) + '</div>' +
        '<div style="font-size:0.7rem;color:var(--text-secondary, #888);text-transform:uppercase;">Revenue</div></div>';
      cards += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:6px;padding:8px;text-align:center;">' +
        '<div style="font-size:1rem;font-weight:700;">' + (itemsSold || totalSalesCount) + '</div>' +
        '<div style="font-size:0.7rem;color:var(--text-secondary, #888);text-transform:uppercase;">Items</div></div>';
      var netColor = net >= 0 ? '#16a34a' : '#dc2626';
      cards += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:6px;padding:8px;text-align:center;">' +
        '<div style="font-size:1rem;font-weight:700;color:' + netColor + ';">' + (net >= 0 ? '+' : '-') + '$' + (Math.abs(net) / 100).toFixed(0) + '</div>' +
        '<div style="font-size:0.7rem;color:var(--text-secondary, #888);text-transform:uppercase;">Net</div></div>';
      if (ratingStars) {
        cards += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:6px;padding:8px;text-align:center;">' +
          '<div>' + ratingStars + '</div>' +
          '<div style="font-size:0.7rem;color:var(--text-secondary, #888);text-transform:uppercase;">Rating</div></div>';
      }
      cards += '</div>';
    }

    cards += '</div>';
  });

  // Update summary stats to include total revenue across all history shows
  if (statsEl && historyShows.length > 0) {
    var totalHistoryRevenue = 0;
    historyShows.forEach(function(s) {
      var exec = s.execute || {};
      var salesObj = exec.sales || {};
      var multiDay = s.startDate && s.endDate && s.endDate !== s.startDate;
      if (multiDay) {
        Object.keys(salesObj).forEach(function(dateKey) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && typeof salesObj[dateKey] === 'object') {
            Object.keys(salesObj[dateKey]).forEach(function(saleKey) {
              totalHistoryRevenue += (salesObj[dateKey][saleKey].priceCents || 0);
            });
          }
        });
      } else {
        Object.keys(salesObj).forEach(function(k) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) totalHistoryRevenue += (salesObj[k].priceCents || 0);
        });
      }
    });
    var acceptedCount = historyShows.filter(function(s) { return s.applicationStatus === 'accepted'; }).length;
    var rejectedCount = historyShows.filter(function(s) { return s.applicationStatus === 'rejected'; }).length;
    statsEl.innerHTML =
      '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">' +
        '<div style="font-size:1.25rem;font-weight:700;">' + historyShows.length + '</div>' +
        '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Total</div>' +
      '</div>' +
      '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">' +
        '<div style="font-size:1.25rem;font-weight:700;color:#16a34a;">' + acceptedCount + '</div>' +
        '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Accepted</div>' +
      '</div>' +
      '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">' +
        '<div style="font-size:1.25rem;font-weight:700;color:#dc2626;">' + rejectedCount + '</div>' +
        '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Rejected</div>' +
      '</div>' +
      (totalHistoryRevenue > 0 ? '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;text-align:center;">' +
        '<div style="font-size:1.25rem;font-weight:700;color:#16a34a;">$' + (totalHistoryRevenue / 100).toFixed(0) + '</div>' +
        '<div style="font-size:0.75rem;color:var(--text-secondary, #888);text-transform:uppercase;">Total Revenue</div>' +
      '</div>' : '');
  }

  cardsEl.innerHTML = cards;
}

// === Show Finder (AI-assisted discovery) ===

var showFinderResults = [];

async function runShowFinder() {
  var showName = document.getElementById('showFinderName').value.trim();
  var city = document.getElementById('showFinderCity').value.trim();
  var state = document.getElementById('showFinderState').value.trim().toUpperCase();
  if (!showName && !city && !state) {
    showToast('Enter a show name or location to search.', true);
    return;
  }

  var entryType = document.getElementById('showFinderEntry').value || undefined;
  var showFormat = document.getElementById('showFinderFormat').value || undefined;

  var body = {
    showName: showName || undefined,
    locationCity: city || undefined,
    locationState: state || undefined,
    radius: parseInt(document.getElementById('showFinderRadius').value) || undefined,
    entryType: entryType,
    showFormat: showFormat,
    dateRangeStart: document.getElementById('showFinderDateStart').value || undefined,
    dateRangeEnd: document.getElementById('showFinderDateEnd').value || undefined,
    maxFee: parseInt(document.getElementById('showFinderMaxFee').value) || undefined,
    count: 10
  };

  // UI states
  var btn = document.getElementById('showFinderBtn');
  var loadingEl = document.getElementById('showFinderLoading');
  var errorEl = document.getElementById('showFinderError');
  var resultsEl = document.getElementById('showFinderResults');
  btn.disabled = true;
  btn.textContent = 'Searching...';
  loadingEl.style.display = '';
  errorEl.style.display = 'none';
  resultsEl.style.display = 'none';

  try {
    var token = await auth.currentUser.getIdToken();
    var resp = await callCF('/showFinder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Search failed');

    showFinderResults = data.shows || [];
    loadingEl.style.display = 'none';

    if (showFinderResults.length === 0) {
      errorEl.style.display = '';
      document.getElementById('showFinderErrorMsg').textContent = 'No shows found matching your criteria. Try broadening your search.';
      document.getElementById('showFinderErrorMsg').style.color = 'var(--text-secondary, #888)';
      errorEl.style.background = 'var(--bg-secondary, #f9f9f9)';
      errorEl.style.borderColor = 'var(--border-color, #ddd)';
    } else {
      renderShowFinderResults();
    }
  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.style.display = '';
    document.getElementById('showFinderErrorMsg').textContent = 'Search failed: ' + err.message;
    document.getElementById('showFinderErrorMsg').style.color = '#dc2626';
    errorEl.style.background = '#fef2f2';
    errorEl.style.borderColor = '#fecaca';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find Shows';
  }
}

function renderShowFinderResults() {
  var resultsEl = document.getElementById('showFinderResults');
  var cardsEl = document.getElementById('showFinderCards');
  var countEl = document.getElementById('showFinderResultsCount');
  resultsEl.style.display = '';
  countEl.textContent = showFinderResults.length + ' show' + (showFinderResults.length !== 1 ? 's' : '') + ' found';

  var cards = '';
  showFinderResults.forEach(function(s, idx) {
    var entryLabel = s.entryType === 'juried' ? 'Juried' : s.entryType === 'open' ? 'Open' : '';
    var formatLabels = { market: 'Market', festival: 'Festival', 'pop-up': 'Pop-Up', trade: 'Trade Show', recurring: 'Recurring', other: 'Other' };
    var formatLabel = formatLabels[s.format] || s.format || '';
    var typeLabel = [entryLabel, formatLabel].filter(Boolean).join(' · ') || SHOW_TYPE_LABELS[s.type] || s.type || 'Other';
    var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
    var dates = '';
    if (s.startDate) {
      dates = formatShowDate(s.startDate);
      if (s.endDate && s.endDate !== s.startDate) dates += ' – ' + formatShowDate(s.endDate);
    }
    var fees = '';
    if (s.boothFee) fees += 'Booth: $' + (s.boothFee / 100).toFixed(0);
    if (s.juryFee) fees += (fees ? ' · ' : '') + 'Jury: $' + (s.juryFee / 100).toFixed(0);
    var deadline = s.applicationDeadline ? 'Deadline: ' + formatShowDate(s.applicationDeadline) : '';

    cards += '<div class="order-card" id="showFinderCard-' + idx + '" style="position:relative;">' +
      '<div class="order-card-header" style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span class="order-card-id" style="font-weight:600;">' + esc(s.name) + '</span>' +
        '<span style="font-size:0.75rem;background:var(--teal, #2a7c6f);color:white;padding:2px 6px;border-radius:4px;">AI Found</span>' +
      '</div>' +
      '<div class="order-card-details">' +
        '<span>' + esc(typeLabel) + '</span>' +
        (location ? '<span>' + esc(location) + '</span>' : '') +
        (dates ? '<span>' + dates + '</span>' : '') +
        (fees ? '<span>' + fees + '</span>' : '') +
        (deadline ? '<span style="color:var(--text-secondary, #888);">' + deadline + '</span>' : '') +
      '</div>';

    // Extra details
    if (s.audienceProfile) {
      cards += '<div style="margin-top:8px;font-size:0.8rem;color:var(--text-secondary, #888);">' + esc(s.audienceProfile) + '</div>';
    }
    if (s.notes) {
      cards += '<div style="margin-top:4px;font-size:0.8rem;color:var(--text-secondary, #888);font-style:italic;">' + esc(s.notes) + '</div>';
    }

    // Links
    var links = '';
    if (s.websiteUrl) links += '<a href="' + esc(s.websiteUrl) + '" target="_blank" style="color:var(--primary, #2a7c6f);font-size:0.8rem;">Website</a>';
    if (s.applicationUrl) links += (links ? ' · ' : '') + '<a href="' + esc(s.applicationUrl) + '" target="_blank" style="color:var(--primary, #2a7c6f);font-size:0.8rem;">Apply</a>';
    if (links) cards += '<div style="margin-top:8px;">' + links + '</div>';

    // Action buttons
    cards += '<div style="margin-top:12px;display:flex;gap:8px;">' +
      '<button class="btn btn-primary btn-sm" onclick="addShowToPipeline(' + idx + ')">Add to Pipeline</button>' +
      '<button class="btn btn-secondary btn-sm" onclick="dismissFinderResult(' + idx + ')">Dismiss</button>' +
    '</div>' +
    '</div>';
  });
  cardsEl.innerHTML = cards;
}

async function addShowToPipeline(idx) {
  var s = showFinderResults[idx];
  if (!s) return;

  try {
    var key = MastDB.shows.newKey();
    var data = {
      id: key,
      name: s.name,
      type: s.format || s.type || 'other',
      entryType: s.entryType || 'unknown',
      format: s.format || s.type || 'other',
      locationCity: s.locationCity || '',
      locationState: s.locationState || '',
      startDate: s.startDate || null,
      endDate: s.endDate || null,
      websiteUrl: s.websiteUrl || null,
      boothFee: s.boothFee || null,
      juryFee: s.juryFee || null,
      applicationDeadline: s.applicationDeadline || null,
      applicationUrl: s.applicationUrl || null,
      audienceProfile: s.audienceProfile || null,
      juryType: s.juryType || 'unknown',
      notes: s.notes || null,
      applicationStatus: 'considering',
      aiGenerated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: auth.currentUser ? auth.currentUser.uid : 'unknown'
    };
    await MastDB.shows.set(key, data);
    showToast(esc(s.name) + ' added to pipeline.');

    // Remove from finder results and re-render
    showFinderResults.splice(idx, 1);
    if (showFinderResults.length > 0) {
      renderShowFinderResults();
    } else {
      clearShowFinderResults();
    }
  } catch (err) {
    showToast('Error adding show: ' + err.message, true);
  }
}

function dismissFinderResult(idx) {
  var card = document.getElementById('showFinderCard-' + idx);
  if (card) card.style.display = 'none';
  showFinderResults[idx] = null;

  // Check if all dismissed
  var remaining = showFinderResults.filter(function(s) { return s !== null; });
  if (remaining.length === 0) {
    clearShowFinderResults();
  } else {
    document.getElementById('showFinderResultsCount').textContent = remaining.length + ' show' + (remaining.length !== 1 ? 's' : '') + ' found';
  }
}

function clearShowFinderResults() {
  showFinderResults = [];
  document.getElementById('showFinderResults').style.display = 'none';
  document.getElementById('showFinderCards').innerHTML = '';
  document.getElementById('showFinderError').style.display = 'none';
}

// === Show Deep Dive ===

async function runShowDeepDive(showId) {
  var s = showsData[showId];
  if (!s || !s.websiteUrl) {
    showToast('No website URL available for deep dive.', true);
    return;
  }

  var btn = document.getElementById('deepDiveBtn-' + showId);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Researching...';
  }

  try {
    var token = await auth.currentUser.getIdToken();
    var resp = await callCF('/showDeepDive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        websiteUrl: s.websiteUrl,
        showName: s.name || '',
        notes: s.notes || ''
      })
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Deep dive failed');

    var details = data.details || {};
    if (Object.keys(details).length === 0) {
      showToast('Deep dive completed but no additional details found.', true);
      return;
    }

    // Update show record with deep dive details
    var updates = { deepDive: details };

    // Deep dive has more accurate data from the actual application page — always overwrite
    if (details.boothFee) updates.boothFee = Math.round(details.boothFee * 100);
    if (details.juryFee) updates.juryFee = Math.round(details.juryFee * 100);
    if (details.applicationDeadline) updates.applicationDeadline = details.applicationDeadline;
    if (details.applicationUrl) updates.applicationUrl = details.applicationUrl;

    await MastDB.shows.update(showId, updates);
    showToast('Deep dive complete! Details updated.');
    renderShowDetail(showId);
  } catch (err) {
    showToast('Deep dive failed: ' + err.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Deep Dive';
    }
  }
}

  // ============================================================
  // Window exports (onclick handlers referenced in HTML templates)
  // ============================================================

  window.switchShowSubView = switchShowSubView;
  window.loadShows = loadShows;
  window.renderShowsList = renderShowsList;
  window.openCreateShowModal = openCreateShowModal;
  window.closeCreateShowModal = closeCreateShowModal;
  window.saveShow = saveShow;
  window.viewShowDetail = viewShowDetail;
  window.switchShowDetailTab = switchShowDetailTab;
  window.renderShowDetail = renderShowDetail;
  window.backToShowsList = backToShowsList;
  window.updateShowStatus = updateShowStatus;
  window.archiveShow = archiveShow;
  window.runShowDeepDive = runShowDeepDive;
  window.openShowStaffingModal = openShowStaffingModal;
  window.saveShowStaff = saveShowStaff;
  window.removeShowStaff = removeShowStaff;
  window.addShowInventoryItem = addShowInventoryItem;
  window.editShowInventoryItem = editShowInventoryItem;
  window.saveShowInventoryItem = saveShowInventoryItem;
  window.toggleShowInventoryPacked = toggleShowInventoryPacked;
  window.removeShowInventoryItem = removeShowInventoryItem;
  window.editShowLogistics = editShowLogistics;
  window.saveShowLogistics = saveShowLogistics;
  window.openShowSaleModal = openShowSaleModal;
  window.saveShowSale = saveShowSale;
  window.editShowSale = editShowSale;
  window.deleteShowSale = deleteShowSale;
  window.updateReconCount = updateReconCount;
  window.switchExecuteDate = switchExecuteDate;
  window.editShowNotes = editShowNotes;
  window.saveShowNotes = saveShowNotes;
  window.openShowExpenseModal = openShowExpenseModal;
  window.saveShowExpense = saveShowExpense;
  window.editShowExpense = editShowExpense;
  window.deleteShowExpense = deleteShowExpense;
  window.openShowReviewModal = openShowReviewModal;
  window.saveShowReview = saveShowReview;
  window.setReviewRating = setReviewRating;
  window.setReviewAttend = setReviewAttend;
  window.renderShowPrepView = renderShowPrepView;
  window.renderShowExecuteView = renderShowExecuteView;
  window.renderShowHistoryView = renderShowHistoryView;
  window.runShowFinder = runShowFinder;
  window.renderShowFinderResults = renderShowFinderResults;
  window.addShowToPipeline = addShowToPipeline;
  window.dismissFinderResult = dismissFinderResult;
  window.clearShowFinderResults = clearShowFinderResults;
  // ============================================================
  // Register with MastAdmin
  // ============================================================

  function ensureShowsData() {
    if (!showsLoaded) loadShows();
    if (!productsLoaded) loadProducts();
  }

  // MastNavStack restorer for show routes — re-opens a show detail
  // when popping back from a cross-module navigation.
  if (window.MastNavStack) {
    var showRestorer = function(view, state) {
      if (view !== 'detail' || !state || !state.showId) return;
      var openIt = function() {
        if (typeof viewShowDetail === 'function') {
          selectedShowId = state.showId;
          viewShowDetail(state.showId);
        }
      };
      if (!showsLoaded) {
        var tries = 0;
        var iv = setInterval(function() {
          if (showsLoaded || tries++ > 25) { clearInterval(iv); openIt(); }
        }, 100);
      } else openIt();
    };
    ['show', 'show-apply', 'show-prep', 'show-execute', 'show-history'].forEach(function(r) {
      window.MastNavStack.registerRestorer(r, showRestorer);
    });
  }

  MastAdmin.registerModule('shows', {
    routes: {
      'show':          { tab: 'showTab', setup: function() { ensureShowsData(); navigateTo('show-apply'); } },
      'show-find':     { tab: 'showTab', setup: function() { ensureShowsData(); switchShowSubView('find'); } },
      'show-apply':    { tab: 'showTab', setup: function() { ensureShowsData(); switchShowSubView('apply'); } },
      'show-prep':     { tab: 'showTab', setup: function() { ensureShowsData(); switchShowSubView('prep'); } },
      'show-execute':  { tab: 'showTab', setup: function() { ensureShowsData(); switchShowSubView('execute'); } },
      'show-history':  { tab: 'showTab', setup: function() { ensureShowsData(); switchShowSubView('history'); } }
    }
  });

})();
