// app/modules/audit-log.js  (T1 extraction)
//
// Audit Log Viewer (Phase E3): the paginated audit-event list with entity/action/
// actor filters, plus renderRecordHistory (per-record history drilldown).
// Extracted byte-identical from the inline block in index.html. Top-level
// functions and vars stay window globals (the inline block is not an IIFE), so
// the route dispatcher and the filter onchange/onclick handlers in the markup
// still resolve loadAuditLog / renderAuditLog / renderRecordHistory et al.

// ============================================================
// Audit Log Viewer (Phase E3)
// ============================================================
var auditEntries = [];
var auditLoaded = false;
var auditPageSize = 50;
var auditLastTime = null;
var auditHasMore = false;
var auditKnownActors = {};

// Entity display names for the UI
var ENTITY_LABELS = {
  orders: 'Orders', products: 'Products', inventory: 'Inventory',
  jobs: 'Jobs', buildJobs: 'Build Jobs', salesEvents: 'Sales Events',
  gallery: 'Gallery', schedule: 'Schedule', locations: 'Locations',
  coupons: 'Coupons', promotions: 'Sale Promotions', settings: 'Settings', operators: 'Operators',
  pos: 'PoS', stories: 'Stories', receipts: 'Day Close',
  users: 'Users', roles: 'Roles'
};

// Normalize audit `time` (Firestore Timestamp, ISO string, or millis) to millis for sorting.
function _auditTimeMs(entry) {
  if (!entry || entry.time == null) return 0;
  var t = entry.time;
  if (typeof t === 'number') return t;
  if (typeof t === 'string') return new Date(t).getTime() || 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t.seconds != null) return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6);
  return 0;
}

function loadAuditLog() {
  if (!can('auditlog', 'view')) {
    document.getElementById('auditEmpty').style.display = '';
    document.getElementById('auditEmpty').innerHTML = '<p>You do not have permission to view the audit log.</p>';
    return;
  }
  if (auditLoaded) { renderAuditLog(); return; }
  document.getElementById('auditLoading').style.display = '';
  var ref = MastDB.auditLog.ref().orderByChild('time').limitToLast(auditPageSize + 1);
  ref.once('value').then(function(snap) {
    auditEntries = [];
    auditKnownActors = {};
    var rows = snap || {};
    // Firestore auto IDs aren't time-ordered — sort by `time` DESC for newest-first display.
    var keys = Object.keys(rows).sort(function(a, b) {
      return _auditTimeMs(rows[b]) - _auditTimeMs(rows[a]);
    });
    keys.forEach(function(childKey) {
      var entry = rows[childKey];
      if (!entry) return;
      entry._key = childKey;
      auditEntries.push(entry);
      if (entry.actor && entry.actor.displayName) {
        auditKnownActors[entry.actor.uid] = entry.actor.displayName;
      }
    });
    if (auditEntries.length > auditPageSize) {
      auditHasMore = true;
      var oldest = auditEntries[auditEntries.length - 1];
      auditLastTime = (oldest && oldest.time) || null;
      auditEntries.pop();
    } else {
      auditHasMore = false;
    }
    auditLoaded = true;
    document.getElementById('auditLoading').style.display = 'none';
    populateActorFilter();
    renderAuditLog();
  }).catch(function(err) {
    console.error('Failed to load audit log:', err);
    document.getElementById('auditLoading').style.display = 'none';
    document.getElementById('auditEmpty').style.display = '';
    document.getElementById('auditEmpty').innerHTML = '<p>Failed to load audit log.</p>';
  });
}

function loadMoreAuditEntries() {
  if (!auditLastTime) return;
  var ref = MastDB.auditLog.ref().orderByChild('time').endBefore(auditLastTime).limitToLast(auditPageSize + 1);
  ref.once('value').then(function(snap) {
    var newEntries = [];
    var rows = snap || {};
    var keys = Object.keys(rows).sort(function(a, b) {
      return _auditTimeMs(rows[b]) - _auditTimeMs(rows[a]);
    });
    keys.forEach(function(childKey) {
      var entry = rows[childKey];
      entry._key = childKey;
      newEntries.push(entry);
      if (entry.actor && entry.actor.displayName) {
        auditKnownActors[entry.actor.uid] = entry.actor.displayName;
      }
    });
    if (newEntries.length > auditPageSize) {
      auditHasMore = true;
      var oldest = newEntries[newEntries.length - 1];
      auditLastTime = (oldest && oldest.time) || null;
      newEntries.pop();
    } else {
      auditHasMore = false;
      auditLastTime = null;
    }
    auditEntries = auditEntries.concat(newEntries);
    populateActorFilter();
    renderAuditLog();
  });
}

function populateActorFilter() {
  var sel = document.getElementById('auditFilterActor');
  var current = sel.value;
  var actors = Object.entries(auditKnownActors).sort(function(a, b) { return a[1].localeCompare(b[1]); });
  sel.innerHTML = '<option value="">All Actors</option>';
  actors.forEach(function(pair) {
    sel.innerHTML += '<option value="' + pair[0] + '">' + pair[1] + '</option>';
  });
  sel.value = current;
}

function renderAuditLog() {
  var entityFilter = document.getElementById('auditFilterEntity').value;
  var actionFilter = document.getElementById('auditFilterAction').value;
  var actorFilter = document.getElementById('auditFilterActor').value;
  var fromDate = document.getElementById('auditFilterFrom').value;
  var toDate = document.getElementById('auditFilterTo').value;
  var fromTs = fromDate ? new Date(fromDate + 'T00:00:00').getTime() : 0;
  var toTs = toDate ? new Date(toDate + 'T23:59:59').getTime() : Infinity;

  var filtered = auditEntries.filter(function(e) {
    if (entityFilter && e.event && e.event.entity !== entityFilter) return false;
    if (actionFilter && e.event && e.event.action !== actionFilter) return false;
    if (actorFilter && e.actor && e.actor.uid !== actorFilter) return false;
    if (e.time) { var tms = _auditTimeMs(e); if (tms < fromTs || tms > toTs) return false; }
    return true;
  });

  // Stats
  var statsEl = document.getElementById('auditStats');
  statsEl.innerHTML = '<div class="audit-stat">Showing <strong>' + filtered.length + '</strong> of ' + auditEntries.length + ' loaded entries</div>';

  // Empty state
  var emptyEl = document.getElementById('auditEmpty');
  var tableEl = document.getElementById('auditTableWrap');
  var cardsEl = document.getElementById('auditCards');
  if (filtered.length === 0) {
    emptyEl.style.display = '';
    emptyEl.innerHTML = '<p>No audit entries match your filters.</p>';
    tableEl.style.display = 'none';
    cardsEl.style.display = 'none';
  } else {
    emptyEl.style.display = 'none';
    tableEl.style.display = '';
    cardsEl.style.display = '';
  }

  // Table rows
  var tbody = document.getElementById('auditTableBody');
  tbody.innerHTML = '';
  filtered.forEach(function(e) {
    var time = e.time ? MastFormat.dateTime(_auditTimeMs(e)) : '—';
    var actor = (e.actor && e.actor.displayName) || 'Unknown';
    var action = (e.event && e.event.action) || '—';
    var entity = (e.event && e.event.entity) || '—';
    var entityId = (e.event && e.event.entityId) || '—';
    var gpsMode = (e.context && e.context.gpsMode) || '—';

    var actionBadge = '<span class="status-badge audit-action-badge ' + action + '">' + action + '</span>';
    var entityBadge = '<span class="audit-entity-badge">' + (ENTITY_LABELS[entity] || entity) + '</span>';
    var gpsBadge = gpsMode !== '—' ? '<span class="audit-gps-badge ' + gpsMode + '">' + gpsMode + '</span>' : '—';

    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + time + '</td>' +
      '<td>' + actor + '</td>' +
      '<td>' + actionBadge + '</td>' +
      '<td>' + entityBadge + '</td>' +
      '<td style="font-family:monospace;font-size:0.78rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + entityId + '">' + entityId + '</td>' +
      '<td>' + gpsBadge + '</td>';
    tbody.appendChild(tr);
  });

  // Mobile cards
  cardsEl.innerHTML = '';
  filtered.forEach(function(e) {
    var time = e.time ? MastFormat.dateTime(_auditTimeMs(e)) : '—';
    var actor = (e.actor && e.actor.displayName) || 'Unknown';
    var action = (e.event && e.event.action) || '—';
    var entity = (e.event && e.event.entity) || '—';
    var entityId = (e.event && e.event.entityId) || '—';
    var gpsMode = (e.context && e.context.gpsMode) || '—';

    var card = document.createElement('div');
    card.className = 'audit-card';
    card.innerHTML = '<div class="audit-card-header">' +
      '<span class="status-badge audit-action-badge ' + action + '">' + action + '</span>' +
      '<span style="font-size:0.78rem;color:var(--warm-gray-light);">' + time + '</span>' +
    '</div>' +
    '<div class="audit-card-detail"><strong>' + actor + '</strong> — ' + (ENTITY_LABELS[entity] || entity) + '</div>' +
    '<div class="audit-card-detail" style="font-family:monospace;font-size:0.78rem;">' + entityId + '</div>' +
    (gpsMode !== '—' ? '<div class="audit-card-detail"><span class="audit-gps-badge ' + gpsMode + '">' + gpsMode + '</span></div>' : '');
    cardsEl.appendChild(card);
  });

  // Load more
  var loadMoreEl = document.getElementById('auditLoadMore');
  loadMoreEl.style.display = auditHasMore ? '' : 'none';
}

function clearAuditFilters() {
  document.getElementById('auditFilterEntity').value = '';
  document.getElementById('auditFilterAction').value = '';
  document.getElementById('auditFilterActor').value = '';
  document.getElementById('auditFilterFrom').value = '';
  document.getElementById('auditFilterTo').value = '';
  renderAuditLog();
}

/**
 * Render per-record audit history for any entity.
 * Returns HTML string to embed in a detail view.
 * Usage: var historyHtml = await renderRecordHistory('orders', orderId);
 */
async function renderRecordHistory(entity, entityId) {
  if (!can('auditlog', 'view') || !entityId) return '';
  try {
    var snap = await MastDB.auditIndex.ref(entity, entityId)
      .orderByChild('time').limitToLast(20).once('value');
    var rows = snap || {};
    var keys = Object.keys(rows);
    if (keys.length === 0) return '';
    var entries = [];
    keys.forEach(function(childKey) {
      var e = rows[childKey];
      if (!e) return;
      e._key = childKey;
      entries.push(e);
    });
    // Firestore auto IDs aren't time-ordered — sort by `time` DESC for newest-first display.
    entries.sort(function(a, b) {
      return _auditTimeMs(b) - _auditTimeMs(a);
    });
    var html = '<div class="record-history">' +
      '<div class="record-history-title">Change History</div>';
    entries.forEach(function(e) {
      var time = e.time ? MastFormat.dateTime(_auditTimeMs(e)) : '—';
      var actor = (e.actor && e.actor.displayName) || 'Unknown';
      var action = (e.event && e.event.action) || '—';
      html += '<div class="record-history-item">' +
        '<span class="record-history-time">' + time + '</span>' +
        '<span class="record-history-actor">' + actor + '</span>' +
        '<span class="status-badge audit-action-badge ' + action + '">' + action + '</span>' +
      '</div>';
    });
    html += '</div>';
    return html;
  } catch (err) {
    console.error('Record history load failed:', err);
    return '';
  }
}

  // Employees & Permissions admin (users list, role matrix, per-user override editor, permissions panel) extracted to app/modules/users-admin.js (T1 decomposition; eager <script defer src> in head).
