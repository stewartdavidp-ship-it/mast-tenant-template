/**
 * Book Module — Class Scheduling, Session Management & Enrollment
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var classesData = [];
  var classesLoaded = false;
  var selectedClassId = null;
  var sessionsData = [];
  var enrollmentsData = [];
  var enrollmentsLoaded = false;
  var allClassesMap = {}; // id → class for enrollment lookups

  var CLASS_TYPES = ['series', 'single', 'dropin', 'private'];
  var CLASS_STATUSES = ['active', 'draft', 'archived'];
  var ENROLLMENT_STATUSES = ['confirmed', 'waitlisted', 'cancelled', 'no-show', 'completed'];
  var DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

  // ============================================================
  // Badge Styles
  // ============================================================

  var TYPE_BADGE_COLORS = {
    series:  { bg: 'rgba(91,33,182,0.2)',  color: '#B39DDB', border: 'rgba(91,33,182,0.35)' },
    single:  { bg: 'rgba(30,64,175,0.2)',  color: '#64B5F6', border: 'rgba(30,64,175,0.35)' },
    dropin:  { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    'private': { bg: 'rgba(146,64,14,0.2)', color: '#FFD54F', border: 'rgba(146,64,14,0.35)' }
  };

  var STATUS_BADGE_COLORS = {
    active:    { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    draft:     { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' },
    archived:  { bg: 'rgba(146,64,14,0.2)',  color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    scheduled: { bg: 'rgba(30,64,175,0.2)',  color: '#64B5F6', border: 'rgba(30,64,175,0.35)' },
    cancelled: { bg: 'rgba(183,28,28,0.2)',  color: '#EF9A9A', border: 'rgba(183,28,28,0.35)' },
    completed: { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    confirmed: { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    waitlisted: { bg: 'rgba(146,64,14,0.2)', color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    'no-show':  { bg: 'rgba(183,28,28,0.2)', color: '#EF9A9A', border: 'rgba(183,28,28,0.35)' }
  };

  function badgeStyle(map, key) {
    var c = map[(key || '').toLowerCase()] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

  function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function formatDate(d) {
    if (!d) return '';
    var parts = d.split('-');
    return parts[1] + '/' + parts[2] + '/' + parts[0];
  }

  function formatTime(t) {
    if (!t) return '';
    var parts = t.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1];
    var ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return h + ':' + m + ' ' + ampm;
  }

  function formatPrice(cents) {
    if (typeof cents !== 'number') return '$0.00';
    return '$' + (cents / 100).toFixed(2);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ============================================================
  // Classes — Load & Render
  // ============================================================

  async function loadClasses() {
    try {
      var snap = await MastDB.classes.list(200);
      var data = snap.val() || {};
      classesData = Object.keys(data).map(function(id) {
        var c = data[id];
        c.id = id;
        return c;
      });
      allClassesMap = {};
      classesData.forEach(function(c) { allClassesMap[c.id] = c; });
      classesLoaded = true;
      renderClassList();
    } catch (err) {
      console.error('[Book] Failed to load classes:', err);
      document.getElementById('bookClassesTable').innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">Failed to load classes.</p>';
    }
  }

  function renderClassList() {
    var container = document.getElementById('bookClassesTable');
    if (!container) return;

    var typeFilter = (document.getElementById('bookFilterType') || {}).value || 'all';
    var statusFilter = (document.getElementById('bookFilterStatus') || {}).value || 'active';

    var filtered = classesData.filter(function(c) {
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      return true;
    });

    filtered.sort(function(a, b) {
      return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
    });

    if (filtered.length === 0) {
      container.innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">No classes found. Click <strong>+ New Class</strong> to create one.</p>';
      return;
    }

    var html = '<table class="data-table"><thead><tr>' +
      '<th>Name</th><th>Type</th><th>Schedule</th><th>Capacity</th><th>Price</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(function(c) {
      var schedSummary = '';
      if (c.schedule) {
        if (c.schedule.type === 'recurring' && c.schedule.days) {
          schedSummary = c.schedule.days.map(function(d) { return DAY_LABELS[d] || d; }).join(', ');
          if (c.schedule.startTime) schedSummary += ' ' + formatTime(c.schedule.startTime);
        } else if (c.schedule.type === 'once') {
          schedSummary = formatDate(c.schedule.date || c.schedule.startDate);
          if (c.schedule.startTime) schedSummary += ' ' + formatTime(c.schedule.startTime);
        }
      }

      var priceStr = formatPrice(c.priceCents);
      if (c.type === 'series' && c.seriesInfo && c.seriesInfo.seriesPriceCents) {
        priceStr = formatPrice(c.seriesInfo.seriesPriceCents) + ' (series)';
      }

      html += '<tr style="cursor:pointer;" onclick="window._bookViewClass(\'' + esc(c.id) + '\')">' +
        '<td><strong>' + esc(c.name) + '</strong></td>' +
        '<td><span style="' + badgeStyle(TYPE_BADGE_COLORS, c.type) + '">' + esc(c.type) + '</span></td>' +
        '<td>' + esc(schedSummary) + '</td>' +
        '<td>' + (c.capacity || '—') + '</td>' +
        '<td>' + priceStr + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, c.status) + '">' + esc(c.status) + '</span></td>' +
        '<td><button class="btn btn-sm" onclick="event.stopPropagation();window._bookEditClass(\'' + esc(c.id) + '\')">Edit</button></td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ============================================================
  // Class Detail View
  // ============================================================

  async function loadClassDetail(classId) {
    selectedClassId = classId;
    document.getElementById('bookListView').style.display = 'none';
    document.getElementById('bookEnrollmentsView').style.display = 'none';
    document.getElementById('bookDetailView').style.display = '';

    var content = document.getElementById('bookDetailContent');
    content.innerHTML = '<p style="color:var(--warm-gray);">Loading...</p>';

    try {
      var snap = await MastDB.classes.get(classId);
      var cls = snap.val();
      if (!cls) { content.innerHTML = '<p>Class not found.</p>'; return; }
      cls.id = classId;

      // Load sessions for this class
      var sessSnap = await MastDB.classSessions.byClass(classId);
      var sessData = sessSnap.val() || {};
      sessionsData = Object.keys(sessData).map(function(id) {
        var s = sessData[id];
        s.id = id;
        return s;
      }).sort(function(a, b) { return (a.date + a.startTime).localeCompare(b.date + b.startTime); });

      renderClassDetail(cls);
    } catch (err) {
      console.error('[Book] Failed to load class detail:', err);
      content.innerHTML = '<p style="color:#EF9A9A;">Failed to load class details.</p>';
    }
  }

  function renderClassDetail(cls) {
    var content = document.getElementById('bookDetailContent');
    var schedDesc = '';
    if (cls.schedule) {
      if (cls.schedule.type === 'recurring' && cls.schedule.days) {
        schedDesc = cls.schedule.days.map(function(d) { return DAY_LABELS[d] || d; }).join(', ');
        if (cls.schedule.startTime) schedDesc += ' at ' + formatTime(cls.schedule.startTime);
        if (cls.schedule.startDate) schedDesc += ' from ' + formatDate(cls.schedule.startDate);
        if (cls.schedule.endDate) schedDesc += ' to ' + formatDate(cls.schedule.endDate);
      } else if (cls.schedule.type === 'once') {
        schedDesc = formatDate(cls.schedule.date || cls.schedule.startDate);
        if (cls.schedule.startTime) schedDesc += ' at ' + formatTime(cls.schedule.startTime);
      }
    }

    var html = '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;">' +
      '<div>' +
      '<h2 style="margin:0 0 4px;">' + esc(cls.name) + '</h2>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
      '<span style="' + badgeStyle(TYPE_BADGE_COLORS, cls.type) + '">' + esc(cls.type) + '</span>' +
      '<span style="' + badgeStyle(STATUS_BADGE_COLORS, cls.status) + '">' + esc(cls.status) + '</span>' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-primary" onclick="window._bookEditClass(\'' + esc(cls.id) + '\')">Edit</button>' +
      '<button class="btn" onclick="window._bookGenerateSessions(\'' + esc(cls.id) + '\')">Generate Sessions</button>' +
      '</div>' +
      '</div>';

    // Info grid
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-bottom:2rem;">';
    html += _infoCard('Category', cls.category || '—');
    html += _infoCard('Duration', (cls.duration || 0) + ' min');
    html += _infoCard('Capacity', (cls.capacity || '—') + (cls.minEnrollment ? ' (min ' + cls.minEnrollment + ')' : ''));
    html += _infoCard('Price', formatPrice(cls.priceCents));
    if (cls.type === 'series' && cls.seriesInfo) {
      html += _infoCard('Series Price', formatPrice(cls.seriesInfo.seriesPriceCents));
      html += _infoCard('Sessions', cls.seriesInfo.totalSessions || '—');
      html += _infoCard('Drop-in OK', cls.seriesInfo.allowDropIn ? 'Yes' : 'No');
    }
    html += _infoCard('Schedule', schedDesc || '—');
    html += _infoCard('Materials', cls.materialsIncluded ? (cls.materialsNote || 'Included') : 'Not included');
    html += '</div>';

    if (cls.description) {
      html += '<div style="margin-bottom:2rem;"><h3 style="margin:0 0 8px;">Description</h3><p style="color:var(--warm-gray);line-height:1.6;">' + esc(cls.description) + '</p></div>';
    }

    // Sessions table
    html += '<h3 style="margin:0 0 12px;">Sessions (' + sessionsData.length + ')</h3>';
    if (sessionsData.length === 0) {
      html += '<p style="color:var(--warm-gray);">No sessions generated yet. Click <strong>Generate Sessions</strong> above.</p>';
    } else {
      var today = todayStr();
      html += '<table class="data-table"><thead><tr><th>Date</th><th>Time</th><th>Enrolled</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      sessionsData.forEach(function(s) {
        var isPast = s.date < today;
        var rowStyle = isPast ? 'opacity:0.5;' : '';
        html += '<tr style="' + rowStyle + '">' +
          '<td>' + formatDate(s.date) + '</td>' +
          '<td>' + formatTime(s.startTime) + ' - ' + formatTime(s.endTime) + '</td>' +
          '<td>' + (s.enrolled || 0) + ' / ' + (s.capacity || cls.capacity || '—') + (s.waitlisted ? ' (+' + s.waitlisted + ' waitlisted)' : '') + '</td>' +
          '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, s.status) + '">' + esc(s.status) + '</span></td>' +
          '<td style="display:flex;gap:4px;">' +
          '<button class="btn btn-sm" onclick="window._bookViewSessionEnrollments(\'' + esc(s.id) + '\',\'' + esc(cls.id) + '\')">Enrollments</button>';
        if (s.status === 'scheduled' && !isPast) {
          html += '<button class="btn btn-sm" style="color:#EF9A9A;" onclick="window._bookCancelSession(\'' + esc(s.id) + '\')">Cancel</button>';
        }
        if (s.status === 'scheduled' && isPast) {
          html += '<button class="btn btn-sm" onclick="window._bookCompleteSession(\'' + esc(s.id) + '\')">Complete</button>';
        }
        html += '</td></tr>';
      });
      html += '</tbody></table>';
    }

    content.innerHTML = html;
  }

  function _infoCard(label, value) {
    return '<div style="background:var(--surface-dark);border-radius:8px;padding:12px 16px;">' +
      '<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin-bottom:4px;">' + esc(label) + '</div>' +
      '<div style="font-size:0.95rem;color:var(--on-dark);">' + esc(String(value)) + '</div></div>';
  }

  // ============================================================
  // Class Create / Edit
  // ============================================================

  function showClassForm(classId) {
    var cls = classId ? classesData.find(function(c) { return c.id === classId; }) : null;
    var isNew = !cls;

    document.getElementById('bookListView').style.display = 'none';
    document.getElementById('bookEnrollmentsView').style.display = 'none';
    document.getElementById('bookDetailView').style.display = '';

    var content = document.getElementById('bookDetailContent');
    var sched = (cls && cls.schedule) || {};
    var series = (cls && cls.seriesInfo) || {};

    var daysHtml = DAYS_OF_WEEK.map(function(d) {
      var checked = sched.days && sched.days.indexOf(d) !== -1 ? ' checked' : '';
      return '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;cursor:pointer;">' +
        '<input type="checkbox" name="schedDays" value="' + d + '"' + checked + '> ' + DAY_LABELS[d] + '</label>';
    }).join('');

    var typeOptions = CLASS_TYPES.map(function(t) {
      return '<option value="' + t + '"' + (cls && cls.type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    }).join('');

    var statusOptions = CLASS_STATUSES.map(function(s) {
      return '<option value="' + s + '"' + (cls && cls.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
    }).join('');

    var schedTypeOnce = sched.type === 'once' ? ' checked' : '';
    var schedTypeRecurring = sched.type === 'recurring' || !sched.type ? ' checked' : '';

    var html = '<h2 style="margin:0 0 1.5rem;">' + (isNew ? 'New Class' : 'Edit: ' + esc(cls.name)) + '</h2>' +
      '<form id="bookClassForm" onsubmit="return false;" style="max-width:700px;">' +

      '<div style="margin-bottom:1rem;"><label class="form-label">Name *</label>' +
      '<input type="text" id="bcfName" class="form-input" value="' + esc(cls ? cls.name : '') + '" required></div>' +

      '<div style="margin-bottom:1rem;"><label class="form-label">Description</label>' +
      '<textarea id="bcfDesc" class="form-input" rows="3">' + esc(cls ? cls.description : '') + '</textarea></div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div><label class="form-label">Type *</label><select id="bcfType" class="form-input" onchange="window._bookToggleSeriesFields()">' + typeOptions + '</select></div>' +
      '<div><label class="form-label">Category</label><input type="text" id="bcfCategory" class="form-input" value="' + esc(cls ? cls.category : '') + '" placeholder="e.g. Pottery, Glass"></div>' +
      '<div><label class="form-label">Status</label><select id="bcfStatus" class="form-input">' + statusOptions + '</select></div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div><label class="form-label">Capacity *</label><input type="number" id="bcfCapacity" class="form-input" min="1" value="' + (cls ? cls.capacity || '' : '') + '" required></div>' +
      '<div><label class="form-label">Min Enrollment</label><input type="number" id="bcfMinEnroll" class="form-input" min="0" value="' + (cls && cls.minEnrollment ? cls.minEnrollment : '') + '"></div>' +
      '<div><label class="form-label">Drop-in Price ($) *</label><input type="number" id="bcfPrice" class="form-input" min="0" step="0.01" value="' + (cls ? (cls.priceCents / 100).toFixed(2) : '') + '" required></div>' +
      '<div><label class="form-label">Duration (min) *</label><input type="number" id="bcfDuration" class="form-input" min="1" value="' + (cls ? cls.duration || '' : '') + '" required></div>' +
      '</div>' +

      // Schedule section
      '<fieldset style="border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:1rem;">' +
      '<legend style="font-weight:600;padding:0 8px;">Schedule</legend>' +
      '<div style="margin-bottom:0.75rem;">' +
      '<label style="margin-right:1rem;cursor:pointer;"><input type="radio" name="schedType" value="recurring"' + schedTypeRecurring + ' onchange="window._bookToggleSchedType()"> Recurring</label>' +
      '<label style="cursor:pointer;"><input type="radio" name="schedType" value="once"' + schedTypeOnce + ' onchange="window._bookToggleSchedType()"> One-time</label>' +
      '</div>' +
      '<div id="bcfSchedRecurring">' +
      '<div style="margin-bottom:0.75rem;"><label class="form-label">Days</label><div>' + daysHtml + '</div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">' +
      '<div><label class="form-label">Start Time</label><input type="time" id="bcfStartTime" class="form-input" value="' + esc(sched.startTime || '') + '"></div>' +
      '<div><label class="form-label">Start Date</label><input type="date" id="bcfStartDate" class="form-input" value="' + esc(sched.startDate || '') + '"></div>' +
      '<div><label class="form-label">End Date</label><input type="date" id="bcfEndDate" class="form-input" value="' + esc(sched.endDate || '') + '"></div>' +
      '</div></div>' +
      '<div id="bcfSchedOnce" style="display:none;">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">' +
      '<div><label class="form-label">Date</label><input type="date" id="bcfOnceDate" class="form-input" value="' + esc(sched.date || sched.startDate || '') + '"></div>' +
      '<div><label class="form-label">Time</label><input type="time" id="bcfOnceTime" class="form-input" value="' + esc(sched.startTime || '') + '"></div>' +
      '</div></div>' +
      '</fieldset>' +

      // Series fields
      '<fieldset id="bcfSeriesFields" style="border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:1rem;' + (cls && cls.type === 'series' ? '' : 'display:none;') + '">' +
      '<legend style="font-weight:600;padding:0 8px;">Series Details</legend>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:1rem;">' +
      '<div><label class="form-label">Total Sessions</label><input type="number" id="bcfSeriesTotal" class="form-input" min="1" value="' + (series.totalSessions || '') + '"></div>' +
      '<div><label class="form-label">Series Price ($)</label><input type="number" id="bcfSeriesPrice" class="form-input" min="0" step="0.01" value="' + (series.seriesPriceCents ? (series.seriesPriceCents / 100).toFixed(2) : '') + '"></div>' +
      '<div><label class="form-label">Allow Drop-in</label><select id="bcfSeriesDropin" class="form-input"><option value="true"' + (series.allowDropIn !== false ? ' selected' : '') + '>Yes</option><option value="false"' + (series.allowDropIn === false ? ' selected' : '') + '>No</option></select></div>' +
      '<div><label class="form-label">Allow Late Enroll</label><select id="bcfSeriesLateEnroll" class="form-input"><option value="false"' + (series.allowLateEnroll !== true ? ' selected' : '') + '>No</option><option value="true"' + (series.allowLateEnroll === true ? ' selected' : '') + '>Yes</option></select></div>' +
      '</div></fieldset>' +

      // Materials
      '<div style="display:grid;grid-template-columns:1fr 2fr;gap:1rem;margin-bottom:1.5rem;">' +
      '<div><label class="form-label">Materials Included</label><select id="bcfMaterials" class="form-input"><option value="false"' + (cls && cls.materialsIncluded ? '' : ' selected') + '>No</option><option value="true"' + (cls && cls.materialsIncluded ? ' selected' : '') + '>Yes</option></select></div>' +
      '<div><label class="form-label">Materials Note</label><input type="text" id="bcfMaterialsNote" class="form-input" value="' + esc(cls ? cls.materialsNote : '') + '" placeholder="e.g. 25lbs of clay + glazes included"></div>' +
      '</div>' +

      '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-primary" onclick="window._bookSaveClass(\'' + (classId || '') + '\')">Save Class</button>' +
      '<button class="btn" onclick="window._bookBackToList()">Cancel</button>' +
      '</div>' +
      '</form>';

    content.innerHTML = html;

    // Toggle schedule type visibility
    window._bookToggleSchedType();
  }

  // ============================================================
  // Save Class + Session Materialization
  // ============================================================

  async function saveClass(classId) {
    var name = document.getElementById('bcfName').value.trim();
    if (!name) { MastAdmin.showToast('Name is required', true); return; }

    var priceDollars = parseFloat(document.getElementById('bcfPrice').value);
    if (isNaN(priceDollars)) { MastAdmin.showToast('Price is required', true); return; }

    var type = document.getElementById('bcfType').value;
    var schedType = document.querySelector('input[name="schedType"]:checked').value;

    var schedule = { type: schedType };
    if (schedType === 'recurring') {
      var dayCheckboxes = document.querySelectorAll('input[name="schedDays"]:checked');
      schedule.days = Array.from(dayCheckboxes).map(function(cb) { return cb.value; });
      schedule.startTime = document.getElementById('bcfStartTime').value;
      schedule.startDate = document.getElementById('bcfStartDate').value;
      schedule.endDate = document.getElementById('bcfEndDate').value || null;
    } else {
      schedule.date = document.getElementById('bcfOnceDate').value;
      schedule.startTime = document.getElementById('bcfOnceTime').value;
      schedule.startDate = document.getElementById('bcfOnceDate').value;
    }

    var data = {
      name: name,
      description: document.getElementById('bcfDesc').value.trim(),
      type: type,
      category: document.getElementById('bcfCategory').value.trim().toLowerCase(),
      status: document.getElementById('bcfStatus').value,
      capacity: parseInt(document.getElementById('bcfCapacity').value, 10) || 8,
      minEnrollment: parseInt(document.getElementById('bcfMinEnroll').value, 10) || null,
      priceCents: Math.round(priceDollars * 100),
      duration: parseInt(document.getElementById('bcfDuration').value, 10) || 60,
      schedule: schedule,
      materialsIncluded: document.getElementById('bcfMaterials').value === 'true',
      materialsNote: document.getElementById('bcfMaterialsNote').value.trim() || null,
      imageIds: [],
      updatedAt: new Date().toISOString()
    };

    // Series info
    if (type === 'series') {
      var seriesPrice = parseFloat(document.getElementById('bcfSeriesPrice').value);
      data.seriesInfo = {
        totalSessions: parseInt(document.getElementById('bcfSeriesTotal').value, 10) || null,
        seriesPriceCents: isNaN(seriesPrice) ? null : Math.round(seriesPrice * 100),
        allowDropIn: document.getElementById('bcfSeriesDropin').value === 'true',
        allowLateEnroll: document.getElementById('bcfSeriesLateEnroll').value === 'true'
      };
    } else {
      data.seriesInfo = null;
    }

    try {
      var isNew = !classId;
      if (isNew) {
        classId = MastDB.classes.newKey();
        data.createdAt = data.updatedAt;
      }
      await MastDB.classes.set(classId, data);
      MastAdmin.showToast(isNew ? 'Class created!' : 'Class updated!');

      // Auto-generate sessions
      await materializeSessions(classId, data);

      classesLoaded = false;
      await loadClasses();
      loadClassDetail(classId);
    } catch (err) {
      console.error('[Book] Save failed:', err);
      MastAdmin.showToast('Save failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Session Materialization
  // ============================================================

  async function materializeSessions(classId, cls) {
    if (!cls.schedule) return;

    // Fetch existing sessions to avoid duplicates
    var existingSnap = await MastDB.classSessions.byClass(classId);
    var existing = existingSnap.val() || {};
    var existingDates = {};
    Object.values(existing).forEach(function(s) {
      existingDates[s.date + '_' + s.startTime] = true;
    });

    var sessionsToCreate = [];
    var duration = cls.duration || 60;
    var capacity = cls.capacity || 8;

    if (cls.schedule.type === 'once') {
      var date = cls.schedule.date || cls.schedule.startDate;
      var time = cls.schedule.startTime;
      if (date && time && !existingDates[date + '_' + time]) {
        sessionsToCreate.push({ date: date, startTime: time });
      }
    } else if (cls.schedule.type === 'recurring' && cls.schedule.days && cls.schedule.days.length > 0) {
      var startDate = cls.schedule.startDate ? new Date(cls.schedule.startDate + 'T00:00:00') : new Date();
      var endDate;
      if (cls.schedule.endDate) {
        endDate = new Date(cls.schedule.endDate + 'T23:59:59');
      } else {
        // Generate 8 weeks out from start
        endDate = new Date(startDate.getTime());
        endDate.setDate(endDate.getDate() + 56);
      }

      var dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      var targetDays = cls.schedule.days.map(function(d) { return dayMap[d]; }).filter(function(d) { return d !== undefined; });

      var cursor = new Date(startDate.getTime());
      while (cursor <= endDate) {
        if (targetDays.indexOf(cursor.getDay()) !== -1) {
          var dateStr = cursor.getFullYear() + '-' +
            String(cursor.getMonth() + 1).padStart(2, '0') + '-' +
            String(cursor.getDate()).padStart(2, '0');
          var timeStr = cls.schedule.startTime || '09:00';
          if (!existingDates[dateStr + '_' + timeStr]) {
            sessionsToCreate.push({ date: dateStr, startTime: timeStr });
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    if (sessionsToCreate.length === 0) return;

    // Calculate end time
    function calcEndTime(startTime, durationMin) {
      var parts = startTime.split(':');
      var totalMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + durationMin;
      var h = Math.floor(totalMin / 60) % 24;
      var m = totalMin % 60;
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    // Batch write
    var updates = {};
    sessionsToCreate.forEach(function(s) {
      var sessionId = MastDB.classSessions.newKey();
      updates[sessionId] = {
        classId: classId,
        date: s.date,
        startTime: s.startTime,
        endTime: calcEndTime(s.startTime, duration),
        capacity: capacity,
        enrolled: 0,
        waitlisted: 0,
        status: 'scheduled',
        cancelReason: null,
        notes: null,
        createdAt: new Date().toISOString()
      };
    });

    // Write all sessions under public/classSessions
    var multiUpdates = {};
    Object.keys(updates).forEach(function(id) {
      multiUpdates[MastDB.classSessions.PATH + '/' + id] = updates[id];
    });

    await MastDB._ref('').update(multiUpdates);
    MastAdmin.showToast(sessionsToCreate.length + ' session(s) generated');
  }

  // ============================================================
  // Session Actions
  // ============================================================

  async function cancelSession(sessionId) {
    if (!confirm('Cancel this session? Students will need to be notified.')) return;
    try {
      await MastDB.classSessions.update(sessionId, { status: 'cancelled', cancelReason: 'Admin cancelled' });
      MastAdmin.showToast('Session cancelled');
      if (selectedClassId) loadClassDetail(selectedClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  }

  async function completeSession(sessionId) {
    try {
      await MastDB.classSessions.update(sessionId, { status: 'completed' });
      MastAdmin.showToast('Session marked complete');
      if (selectedClassId) loadClassDetail(selectedClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Enrollments
  // ============================================================

  async function loadEnrollments(sessionFilter, classFilter) {
    document.getElementById('bookListView').style.display = 'none';
    document.getElementById('bookDetailView').style.display = 'none';
    document.getElementById('bookEnrollmentsView').style.display = '';

    var table = document.getElementById('bookEnrollmentsTable');
    table.innerHTML = '<p style="color:var(--warm-gray);">Loading enrollments...</p>';

    // Populate class filter dropdown
    if (!classesLoaded) await loadClasses();
    var classSelect = document.getElementById('enrollFilterClass');
    if (classSelect) {
      var opts = '<option value="all">All Classes</option>';
      classesData.forEach(function(c) {
        opts += '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
      });
      classSelect.innerHTML = opts;
      if (classFilter) classSelect.value = classFilter;
    }

    try {
      var snap;
      if (sessionFilter) {
        snap = await MastDB.enrollments.bySession(sessionFilter);
      } else if (classFilter && classFilter !== 'all') {
        snap = await MastDB.enrollments.byClass(classFilter);
      } else {
        snap = await MastDB.enrollments.list(500);
      }

      var data = snap.val() || {};
      enrollmentsData = Object.keys(data).map(function(id) {
        var e = data[id];
        e.id = id;
        return e;
      });
      enrollmentsLoaded = true;
      renderEnrollmentList();
    } catch (err) {
      console.error('[Book] Failed to load enrollments:', err);
      table.innerHTML = '<p style="color:#EF9A9A;">Failed to load enrollments.</p>';
    }
  }

  function renderEnrollmentList() {
    var table = document.getElementById('bookEnrollmentsTable');
    if (!table) return;

    var statusFilter = (document.getElementById('enrollFilterStatus') || {}).value || 'all';
    var classFilter = (document.getElementById('enrollFilterClass') || {}).value || 'all';

    var filtered = enrollmentsData.filter(function(e) {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (classFilter !== 'all' && e.classId !== classFilter) return false;
      return true;
    });

    filtered.sort(function(a, b) {
      return (b.enrolledAt || '').localeCompare(a.enrolledAt || '');
    });

    if (filtered.length === 0) {
      table.innerHTML = '<p style="color:var(--warm-gray);padding:1rem;">No enrollments found.</p>';
      return;
    }

    var html = '<table class="data-table"><thead><tr>' +
      '<th>Student</th><th>Class</th><th>Session</th><th>Paid</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(function(e) {
      var className = allClassesMap[e.classId] ? allClassesMap[e.classId].name : e.classId;

      html += '<tr>' +
        '<td><strong>' + esc(e.customerName || '—') + '</strong><br><span style="font-size:0.8rem;color:var(--warm-gray);">' + esc(e.customerEmail || '') + '</span></td>' +
        '<td>' + esc(className) + '</td>' +
        '<td>' + esc(e.sessionId || '—') + '</td>' +
        '<td>' + formatPrice(e.pricePaidCents) + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, e.status) + '">' + esc(e.status) + '</span></td>' +
        '<td style="display:flex;gap:4px;flex-wrap:wrap;">';

      if (e.status === 'confirmed') {
        html += '<button class="btn btn-sm" onclick="window._bookMarkAttended(\'' + esc(e.id) + '\')">Attended</button>';
        html += '<button class="btn btn-sm" onclick="window._bookMarkNoShow(\'' + esc(e.id) + '\')">No-Show</button>';
        html += '<button class="btn btn-sm" style="color:#EF9A9A;" onclick="window._bookCancelEnrollment(\'' + esc(e.id) + '\')">Cancel</button>';
      }
      if (e.status === 'waitlisted') {
        html += '<button class="btn btn-sm" onclick="window._bookConfirmEnrollment(\'' + esc(e.id) + '\')">Confirm</button>';
        html += '<button class="btn btn-sm" style="color:#EF9A9A;" onclick="window._bookCancelEnrollment(\'' + esc(e.id) + '\')">Cancel</button>';
      }

      html += '</td></tr>';
    });

    html += '</tbody></table>';
    table.innerHTML = html;
  }

  async function updateEnrollmentStatus(enrollmentId, newStatus) {
    try {
      var updateData = { status: newStatus };
      if (newStatus === 'cancelled') updateData.cancelledAt = new Date().toISOString();
      if (newStatus === 'completed') updateData.attendedAt = new Date().toISOString();
      if (newStatus === 'no-show') updateData.attendedAt = null;

      // Get enrollment to update session count
      var snap = await MastDB.enrollments.get(enrollmentId);
      var enrollment = snap.val();

      await MastDB.enrollments.update(enrollmentId, updateData);

      // Update session enrolled count
      if (enrollment && enrollment.sessionId) {
        if (newStatus === 'cancelled' && enrollment.status === 'confirmed') {
          await adjustSessionCount(enrollment.sessionId, 'enrolled', -1);
        } else if (newStatus === 'confirmed' && enrollment.status === 'waitlisted') {
          await adjustSessionCount(enrollment.sessionId, 'enrolled', 1);
          await adjustSessionCount(enrollment.sessionId, 'waitlisted', -1);
        }
      }

      MastAdmin.showToast('Enrollment updated');
      // Refresh current view
      var classFilter = (document.getElementById('enrollFilterClass') || {}).value;
      loadEnrollments(null, classFilter);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  }

  async function adjustSessionCount(sessionId, field, delta) {
    var snap = await MastDB.classSessions.get(sessionId);
    var session = snap.val();
    if (!session) return;
    var current = session[field] || 0;
    var update = {};
    update[field] = Math.max(0, current + delta);
    await MastDB.classSessions.update(sessionId, update);
  }

  // ============================================================
  // Navigation helpers
  // ============================================================

  function backToList() {
    selectedClassId = null;
    document.getElementById('bookDetailView').style.display = 'none';
    document.getElementById('bookEnrollmentsView').style.display = 'none';
    document.getElementById('bookListView').style.display = '';
    renderClassList();
  }

  // ============================================================
  // Window-scoped callbacks (for onclick handlers in HTML)
  // ============================================================

  window._bookFilterType = function() { renderClassList(); };
  window._bookFilterStatus = function() { renderClassList(); };
  window._bookCreateClass = function() { showClassForm(null); };
  window._bookEditClass = function(id) { showClassForm(id); };
  window._bookViewClass = function(id) { navigateTo('book-detail', id); };
  window._bookBackToList = function() { backToList(); };
  window._bookSaveClass = function(id) { saveClass(id || null); };
  window._bookGenerateSessions = function(id) {
    var cls = classesData.find(function(c) { return c.id === id; });
    if (cls) materializeSessions(id, cls).then(function() { loadClassDetail(id); });
  };
  window._bookCancelSession = function(id) { cancelSession(id); };
  window._bookCompleteSession = function(id) { completeSession(id); };
  window._bookViewSessionEnrollments = function(sessionId, classId) { loadEnrollments(sessionId, classId); };
  window._bookMarkAttended = function(id) { updateEnrollmentStatus(id, 'completed'); };
  window._bookMarkNoShow = function(id) { updateEnrollmentStatus(id, 'no-show'); };
  window._bookCancelEnrollment = function(id) {
    if (confirm('Cancel this enrollment?')) updateEnrollmentStatus(id, 'cancelled');
  };
  window._bookConfirmEnrollment = function(id) { updateEnrollmentStatus(id, 'confirmed'); };

  window._enrollFilterStatus = function() { renderEnrollmentList(); };
  window._enrollFilterClass = function() {
    var classFilter = document.getElementById('enrollFilterClass').value;
    loadEnrollments(null, classFilter);
  };

  window._bookToggleSeriesFields = function() {
    var type = document.getElementById('bcfType').value;
    var fields = document.getElementById('bcfSeriesFields');
    if (fields) fields.style.display = type === 'series' ? '' : 'none';
  };

  window._bookToggleSchedType = function() {
    var schedType = document.querySelector('input[name="schedType"]:checked');
    if (!schedType) return;
    var recurring = document.getElementById('bcfSchedRecurring');
    var once = document.getElementById('bcfSchedOnce');
    if (recurring) recurring.style.display = schedType.value === 'recurring' ? '' : 'none';
    if (once) once.style.display = schedType.value === 'once' ? '' : 'none';
  };

  // ============================================================
  // Module Registration
  // ============================================================

  MastAdmin.registerModule('book', {
    routes: {
      'book': { tab: 'bookTab', setup: function() { loadClasses(); backToList(); } },
      'book-detail': { tab: 'bookTab', setup: function(id) { if (id) { loadClassDetail(id); } else { loadClasses(); backToList(); } } },
      'enrollments': { tab: 'bookTab', setup: function() { loadEnrollments(); } }
    },
    detachListeners: function() {
      classesData = [];
      classesLoaded = false;
      selectedClassId = null;
      sessionsData = [];
      enrollmentsData = [];
      enrollmentsLoaded = false;
      allClassesMap = {};
    }
  });

})();
