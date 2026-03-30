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
  var instructorsData = [];
  var instructorsLoaded = false;
  var instructorsMap = {}; // id → instructor
  var resourcesData = [];
  var resourcesLoaded = false;
  var resourcesMap = {}; // id → resource
  var currentSubTab = 'classes';

  var CLASS_TYPES = ['series', 'single', 'dropin', 'private'];
  var CLASS_STATUSES = ['active', 'draft', 'archived'];
  var ENROLLMENT_STATUSES = ['confirmed', 'waitlisted', 'cancelled', 'no-show', 'completed'];
  var DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  var RESOURCE_TYPES = ['room', 'equipment'];
  var PASS_TYPES = ['drop-in', 'pack', 'unlimited', 'limited', 'series', 'intro'];
  var PASS_PRIORITIES = ['high', 'medium', 'low'];
  var passDefsData = [];
  var passDefsLoaded = false;

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
    hideAllViews();
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
    html += _infoCard('Instructor', cls.instructorName || '—');
    html += _infoCard('Resource', cls.resourceName || '—');
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
      html += '<table class="data-table"><thead><tr><th>Date</th><th>Time</th><th>Instructor</th><th>Resource</th><th>Enrolled</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      sessionsData.forEach(function(s) {
        var isPast = s.date < today;
        var rowStyle = isPast ? 'opacity:0.5;' : '';
        html += '<tr style="' + rowStyle + '">' +
          '<td>' + formatDate(s.date) + '</td>' +
          '<td>' + formatTime(s.startTime) + ' - ' + formatTime(s.endTime) + '</td>' +
          '<td>' + esc(s.instructorName || '—') + '</td>' +
          '<td>' + esc(s.resourceName || '—') + '</td>' +
          '<td>' + (s.enrolled || 0) + ' / ' + (s.capacity || cls.capacity || '—') + (s.waitlisted ? ' (+' + s.waitlisted + ' waitlisted)' : '') + '</td>' +
          '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, s.status) + '">' + esc(s.status) + '</span></td>' +
          '<td style="display:flex;gap:4px;">' +
          '<button class="btn btn-sm" onclick="window._bookAssignSession(\'' + esc(s.id) + '\',\'' + esc(cls.id) + '\')">Assign</button>' +
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

  async function showClassForm(classId) {
    var cls = classId ? classesData.find(function(c) { return c.id === classId; }) : null;
    var isNew = !cls;

    // Ensure instructors/resources loaded for dropdowns
    if (!instructorsLoaded) await loadInstructors();
    if (!resourcesLoaded) await loadResources();

    hideAllViews();
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
      '<div style="display:grid;grid-template-columns:1fr 2fr;gap:1rem;margin-bottom:1rem;">' +
      '<div><label class="form-label">Materials Included</label><select id="bcfMaterials" class="form-input"><option value="false"' + (cls && cls.materialsIncluded ? '' : ' selected') + '>No</option><option value="true"' + (cls && cls.materialsIncluded ? ' selected' : '') + '>Yes</option></select></div>' +
      '<div><label class="form-label">Materials Note</label><input type="text" id="bcfMaterialsNote" class="form-input" value="' + esc(cls ? cls.materialsNote : '') + '" placeholder="e.g. 25lbs of clay + glazes included"></div>' +
      '</div>' +

      // Assignment
      '<fieldset style="border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:1.5rem;">' +
      '<legend style="font-weight:600;padding:0 8px;">Assignment</legend>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">' +
      '<div><label class="form-label">Instructor</label><select id="bcfInstructor" class="form-input">' +
      '<option value="">None</option>' +
      instructorsData.filter(function(i) { return i.status === 'active'; }).map(function(i) {
        return '<option value="' + esc(i.id) + '"' + (cls && cls.instructorId === i.id ? ' selected' : '') + '>' + esc(i.name) + '</option>';
      }).join('') +
      '</select></div>' +
      '<div><label class="form-label">Resource</label><select id="bcfResource" class="form-input">' +
      '<option value="">None</option>' +
      resourcesData.filter(function(r) { return r.status === 'active'; }).map(function(r) {
        return '<option value="' + esc(r.id) + '"' + (cls && cls.resourceId === r.id ? ' selected' : '') + '>' + esc(r.name) + ' (' + esc(r.type) + ')</option>';
      }).join('') +
      '</select></div>' +
      '</div></fieldset>' +

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

    // Assignment fields
    var instrId = document.getElementById('bcfInstructor').value || null;
    var resId = document.getElementById('bcfResource').value || null;
    data.instructorId = instrId;
    data.instructorName = instrId && instructorsMap[instrId] ? instructorsMap[instrId].name : null;
    data.resourceId = resId;
    data.resourceName = resId && resourcesMap[resId] ? resourcesMap[resId].name : null;

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
        instructorId: cls.instructorId || null,
        instructorName: cls.instructorName || null,
        resourceId: cls.resourceId || null,
        resourceName: cls.resourceName || null,
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
    hideAllViews();
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
  // Sub-Tab Navigation
  // ============================================================

  var BOOK_VIEWS = ['bookListView', 'bookDetailView', 'bookEnrollmentsView', 'bookInstructorsView', 'bookInstructorDetailView', 'bookResourcesView', 'bookResourceDetailView', 'bookPassesView', 'bookPassDetailView'];

  function hideAllViews() {
    BOOK_VIEWS.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function switchSubTab(tab) {
    currentSubTab = tab;
    // Update tab bar active state
    var tabs = document.querySelectorAll('#bookSubNav .view-tab');
    tabs.forEach(function(t) { t.classList.remove('active'); });
    var tabMap = { classes: 0, instructors: 1, resources: 2, passes: 3, enrollments: 4 };
    if (tabs[tabMap[tab]]) tabs[tabMap[tab]].classList.add('active');

    hideAllViews();
    if (tab === 'classes') { document.getElementById('bookListView').style.display = ''; renderClassList(); }
    else if (tab === 'instructors') { document.getElementById('bookInstructorsView').style.display = ''; loadInstructors(); }
    else if (tab === 'resources') { document.getElementById('bookResourcesView').style.display = ''; loadResources(); }
    else if (tab === 'passes') { document.getElementById('bookPassesView').style.display = ''; loadPassDefinitions(); }
    else if (tab === 'enrollments') { document.getElementById('bookEnrollmentsView').style.display = ''; loadEnrollments(); }
  }

  // ============================================================
  // Instructors — Load & Render
  // ============================================================

  async function loadInstructors() {
    try {
      var snap = await MastDB.instructors.list(100);
      var data = snap.val() || {};
      instructorsData = Object.keys(data).map(function(id) {
        var i = data[id];
        i.id = id;
        return i;
      });
      instructorsMap = {};
      instructorsData.forEach(function(i) { instructorsMap[i.id] = i; });
      instructorsLoaded = true;
      renderInstructorList();
    } catch (err) {
      console.error('[Book] Failed to load instructors:', err);
      document.getElementById('bookInstructorsTable').innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">Failed to load instructors.</p>';
    }
  }

  function renderInstructorList() {
    var container = document.getElementById('bookInstructorsTable');
    if (!container) return;

    var statusFilter = (document.getElementById('instrFilterStatus') || {}).value || 'active';
    var filtered = instructorsData.filter(function(i) {
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      return true;
    });

    filtered.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    if (filtered.length === 0) {
      container.innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">No instructors found. Click <strong>+ New Instructor</strong> to add one.</p>';
      return;
    }

    var html = '<table class="data-table"><thead><tr>' +
      '<th>Name</th><th>Specialties</th><th>Email</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(function(i) {
      var specs = (i.specialties || []).join(', ') || '—';
      html += '<tr>' +
        '<td><strong>' + esc(i.name) + '</strong></td>' +
        '<td>' + esc(specs) + '</td>' +
        '<td>' + esc(i.email || '—') + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, i.status) + '">' + esc(i.status) + '</span></td>' +
        '<td><button class="btn btn-sm" onclick="window._instrEdit(\'' + esc(i.id) + '\')">Edit</button></td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ============================================================
  // Instructor Create / Edit
  // ============================================================

  function showInstructorForm(instrId) {
    var instr = instrId ? instructorsData.find(function(i) { return i.id === instrId; }) : null;
    var isNew = !instr;

    hideAllViews();
    document.getElementById('bookInstructorDetailView').style.display = '';

    var content = document.getElementById('bookInstructorDetailContent');

    var statusOpts = ['active', 'inactive'].map(function(s) {
      return '<option value="' + s + '"' + (instr && instr.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
    }).join('');

    var html = '<h2 style="margin:0 0 1.5rem;">' + (isNew ? 'New Instructor' : 'Edit: ' + esc(instr.name)) + '</h2>' +
      '<form id="instrForm" onsubmit="return false;" style="max-width:700px;">' +

      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div><label class="form-label">Name *</label><input type="text" id="ifName" class="form-input" value="' + esc(instr ? instr.name : '') + '" required></div>' +
      '<div><label class="form-label">Status</label><select id="ifStatus" class="form-input">' + statusOpts + '</select></div>' +
      '</div>' +

      '<div style="margin-bottom:1rem;"><label class="form-label">Bio</label>' +
      '<textarea id="ifBio" class="form-input" rows="3">' + esc(instr ? instr.bio : '') + '</textarea></div>' +

      '<div style="margin-bottom:1rem;"><label class="form-label">Specialties (comma-separated)</label>' +
      '<input type="text" id="ifSpecialties" class="form-input" value="' + esc(instr && instr.specialties ? instr.specialties.join(', ') : '') + '" placeholder="e.g. Wheel Throwing, Glazing, Hand Building"></div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div><label class="form-label">Email</label><input type="email" id="ifEmail" class="form-input" value="' + esc(instr ? instr.email : '') + '"></div>' +
      '<div><label class="form-label">Phone</label><input type="text" id="ifPhone" class="form-input" value="' + esc(instr ? instr.phone : '') + '"></div>' +
      '<div><label class="form-label">Pay Rate ($/hr)</label><input type="number" id="ifPayRate" class="form-input" min="0" step="0.01" value="' + (instr && instr.payRateCents ? (instr.payRateCents / 100).toFixed(2) : '') + '"></div>' +
      '</div>' +

      '<div style="margin-bottom:1rem;"><label class="form-label">Photo URL</label>' +
      '<input type="text" id="ifPhoto" class="form-input" value="' + esc(instr ? instr.photoUrl : '') + '" placeholder="https://..."></div>' +

      '<div style="margin-bottom:1.5rem;"><label class="form-label">Notes (internal)</label>' +
      '<textarea id="ifNotes" class="form-input" rows="2">' + esc(instr ? instr.notes : '') + '</textarea></div>' +

      '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-primary" onclick="window._instrSave(\'' + (instrId || '') + '\')">Save Instructor</button>' +
      '<button class="btn" onclick="window._instrBackToList()">Cancel</button>' +
      '</div></form>';

    content.innerHTML = html;
  }

  async function saveInstructor(instrId) {
    var name = document.getElementById('ifName').value.trim();
    if (!name) { MastAdmin.showToast('Name is required', true); return; }

    var specialtiesStr = document.getElementById('ifSpecialties').value.trim();
    var specialties = specialtiesStr ? specialtiesStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];

    var payRate = parseFloat(document.getElementById('ifPayRate').value);

    var data = {
      name: name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      bio: document.getElementById('ifBio').value.trim() || null,
      specialties: specialties,
      email: document.getElementById('ifEmail').value.trim() || null,
      phone: document.getElementById('ifPhone').value.trim() || null,
      payRateCents: isNaN(payRate) ? null : Math.round(payRate * 100),
      photoUrl: document.getElementById('ifPhoto').value.trim() || null,
      notes: document.getElementById('ifNotes').value.trim() || null,
      status: document.getElementById('ifStatus').value,
      updatedAt: new Date().toISOString()
    };

    try {
      var isNew = !instrId;
      if (isNew) {
        instrId = MastDB.instructors.newKey();
        data.createdAt = data.updatedAt;
      }
      await MastDB.instructors.set(instrId, data);
      MastAdmin.showToast(isNew ? 'Instructor created!' : 'Instructor updated!');
      instructorsLoaded = false;
      await loadInstructors();
      switchSubTab('instructors');
    } catch (err) {
      console.error('[Book] Instructor save failed:', err);
      MastAdmin.showToast('Save failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Resources — Load & Render
  // ============================================================

  async function loadResources() {
    try {
      var snap = await MastDB.resources.list(100);
      var data = snap.val() || {};
      resourcesData = Object.keys(data).map(function(id) {
        var r = data[id];
        r.id = id;
        return r;
      });
      resourcesMap = {};
      resourcesData.forEach(function(r) { resourcesMap[r.id] = r; });
      resourcesLoaded = true;
      renderResourceList();
    } catch (err) {
      console.error('[Book] Failed to load resources:', err);
      document.getElementById('bookResourcesTable').innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">Failed to load resources.</p>';
    }
  }

  function renderResourceList() {
    var container = document.getElementById('bookResourcesTable');
    if (!container) return;

    var typeFilter = (document.getElementById('resFilterType') || {}).value || 'all';
    var statusFilter = (document.getElementById('resFilterStatus') || {}).value || 'active';

    var filtered = resourcesData.filter(function(r) {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });

    filtered.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    if (filtered.length === 0) {
      container.innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">No resources found. Click <strong>+ New Resource</strong> to add one.</p>';
      return;
    }

    var html = '<table class="data-table"><thead><tr>' +
      '<th>Name</th><th>Type</th><th>Capacity</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(function(r) {
      html += '<tr>' +
        '<td><strong>' + esc(r.name) + '</strong>' + (r.subType ? '<br><span style="font-size:0.8rem;color:var(--warm-gray);">' + esc(r.subType) + '</span>' : '') + '</td>' +
        '<td><span style="' + badgeStyle(TYPE_BADGE_COLORS, r.type === 'room' ? 'series' : 'single') + '">' + esc(r.type) + '</span></td>' +
        '<td>' + (r.capacity || '—') + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, r.status) + '">' + esc(r.status) + '</span></td>' +
        '<td><button class="btn btn-sm" onclick="window._resEdit(\'' + esc(r.id) + '\')">Edit</button></td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ============================================================
  // Resource Create / Edit
  // ============================================================

  function showResourceForm(resId) {
    var res = resId ? resourcesData.find(function(r) { return r.id === resId; }) : null;
    var isNew = !res;

    hideAllViews();
    document.getElementById('bookResourceDetailView').style.display = '';

    var content = document.getElementById('bookResourceDetailContent');

    var typeOpts = RESOURCE_TYPES.map(function(t) {
      return '<option value="' + t + '"' + (res && res.type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    }).join('');

    var statusOpts = ['active', 'inactive'].map(function(s) {
      return '<option value="' + s + '"' + (res && res.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
    }).join('');

    var html = '<h2 style="margin:0 0 1.5rem;">' + (isNew ? 'New Resource' : 'Edit: ' + esc(res.name)) + '</h2>' +
      '<form id="resForm" onsubmit="return false;" style="max-width:700px;">' +

      '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div><label class="form-label">Name *</label><input type="text" id="rfName" class="form-input" value="' + esc(res ? res.name : '') + '" required></div>' +
      '<div><label class="form-label">Type *</label><select id="rfType" class="form-input">' + typeOpts + '</select></div>' +
      '<div><label class="form-label">Status</label><select id="rfStatus" class="form-input">' + statusOpts + '</select></div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div><label class="form-label">Sub-type</label><input type="text" id="rfSubType" class="form-input" value="' + esc(res ? res.subType : '') + '" placeholder="e.g. Kiln, Pottery Wheel, Main Studio"></div>' +
      '<div><label class="form-label">Capacity</label><input type="number" id="rfCapacity" class="form-input" min="0" value="' + (res ? res.capacity || '' : '') + '"></div>' +
      '</div>' +

      '<div style="margin-bottom:1rem;"><label class="form-label">Description</label>' +
      '<textarea id="rfDesc" class="form-input" rows="2">' + esc(res ? res.description : '') + '</textarea></div>' +

      '<div style="margin-bottom:1.5rem;"><label class="form-label">Notes (internal)</label>' +
      '<textarea id="rfNotes" class="form-input" rows="2">' + esc(res ? res.notes : '') + '</textarea></div>' +

      '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-primary" onclick="window._resSave(\'' + (resId || '') + '\')">Save Resource</button>' +
      '<button class="btn" onclick="window._resBackToList()">Cancel</button>' +
      '</div></form>';

    content.innerHTML = html;
  }

  async function saveResource(resId) {
    var name = document.getElementById('rfName').value.trim();
    if (!name) { MastAdmin.showToast('Name is required', true); return; }

    var data = {
      name: name,
      type: document.getElementById('rfType').value,
      subType: document.getElementById('rfSubType').value.trim() || null,
      capacity: parseInt(document.getElementById('rfCapacity').value, 10) || null,
      description: document.getElementById('rfDesc').value.trim() || null,
      notes: document.getElementById('rfNotes').value.trim() || null,
      status: document.getElementById('rfStatus').value,
      updatedAt: new Date().toISOString()
    };

    try {
      var isNew = !resId;
      if (isNew) {
        resId = MastDB.resources.newKey();
        data.createdAt = data.updatedAt;
      }
      await MastDB.resources.set(resId, data);
      MastAdmin.showToast(isNew ? 'Resource created!' : 'Resource updated!');
      resourcesLoaded = false;
      await loadResources();
      switchSubTab('resources');
    } catch (err) {
      console.error('[Book] Resource save failed:', err);
      MastAdmin.showToast('Save failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Pass Definitions — Load & Render
  // ============================================================

  async function loadPassDefinitions() {
    try {
      var snap = await MastDB.passDefinitions.list(100);
      var data = snap.val() || {};
      passDefsData = Object.keys(data).map(function(id) {
        var p = data[id];
        p.id = id;
        return p;
      });
      passDefsLoaded = true;
      renderPassDefList();
    } catch (err) {
      console.error('[Book] Failed to load pass definitions:', err);
      document.getElementById('bookPassesTable').innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">Failed to load pass definitions.</p>';
    }
  }

  function renderPassDefList() {
    var container = document.getElementById('bookPassesTable');
    if (!container) return;

    var typeFilter = (document.getElementById('passFilterType') || {}).value || 'all';
    var statusFilter = (document.getElementById('passFilterStatus') || {}).value || 'active';

    var filtered = passDefsData.filter(function(p) {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      return true;
    });

    filtered.sort(function(a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0) || (a.name || '').localeCompare(b.name || ''); });

    if (filtered.length === 0) {
      container.innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">No pass definitions found. Click <strong>+ New Pass</strong> to create one.</p>';
      return;
    }

    var html = '<table class="data-table"><thead><tr>' +
      '<th>Name</th><th>Type</th><th>Price</th><th>Visits</th><th>Validity</th><th>Priority</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(function(p) {
      var visits = p.visitCount ? p.visitCount + ' visits' : 'Unlimited';
      var validity = p.validityDays ? p.validityDays + ' days' : 'No limit';
      html += '<tr>' +
        '<td><strong>' + esc(p.name) + '</strong>' + (p.introOnly ? '<br><span style="font-size:0.75rem;color:var(--amber);">Intro only</span>' : '') + '</td>' +
        '<td><span style="' + badgeStyle(TYPE_BADGE_COLORS, p.type === 'drop-in' ? 'single' : p.type === 'pack' ? 'series' : p.type === 'unlimited' ? 'dropin' : 'private') + '">' + esc(p.type) + '</span></td>' +
        '<td>' + formatPrice(p.priceCents) + (p.autoRenew ? '<br><span style="font-size:0.75rem;color:var(--warm-gray);">/' + (p.renewFrequency || 'month') + '</span>' : '') + '</td>' +
        '<td>' + esc(visits) + '</td>' +
        '<td>' + esc(validity) + '</td>' +
        '<td><span style="font-size:0.8rem;">' + esc(p.priority || 'medium') + '</span></td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, p.status) + '">' + esc(p.status) + '</span></td>' +
        '<td><button class="btn btn-sm" onclick="window._passEdit(\'' + esc(p.id) + '\')">Edit</button></td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ============================================================
  // Pass Definition Create / Edit
  // ============================================================

  async function showPassDefForm(passDefId) {
    var pd = passDefId ? passDefsData.find(function(p) { return p.id === passDefId; }) : null;
    var isNew = !pd;

    // Load classes for scope selector
    if (!classesLoaded) await loadClasses();

    hideAllViews();
    document.getElementById('bookPassDetailView').style.display = '';

    var content = document.getElementById('bookPassDetailContent');

    var typeOpts = PASS_TYPES.map(function(t) {
      return '<option value="' + t + '"' + (pd && pd.type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    }).join('');

    var statusOpts = CLASS_STATUSES.map(function(s) {
      return '<option value="' + s + '"' + (pd && pd.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
    }).join('');

    var priorityOpts = PASS_PRIORITIES.map(function(p) {
      return '<option value="' + p + '"' + (pd && pd.priority === p ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>';
    }).join('');

    var activationOpts = ['purchase', 'first_use'].map(function(a) {
      return '<option value="' + a + '"' + (pd && pd.activationTrigger === a ? ' selected' : '') + '>' + (a === 'purchase' ? 'On Purchase' : 'On First Use') + '</option>';
    }).join('');

    var renewOpts = ['monthly', 'quarterly', 'yearly'].map(function(r) {
      return '<option value="' + r + '"' + (pd && pd.renewFrequency === r ? ' selected' : '') + '>' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>';
    }).join('');

    // Class scope checkboxes
    var allowedIds = (pd && pd.allowedClassIds) || [];
    var classScopeHtml = classesData.filter(function(c) { return c.status === 'active'; }).map(function(c) {
      var checked = allowedIds.indexOf(c.id) !== -1 ? ' checked' : '';
      return '<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;">' +
        '<input type="checkbox" name="passClassScope" value="' + esc(c.id) + '"' + checked + '> ' + esc(c.name) + '</label>';
    }).join('');

    var html = '<h2 style="margin:0 0 1.5rem;">' + (isNew ? 'New Pass Definition' : 'Edit: ' + esc(pd.name)) + '</h2>' +
      '<form id="passDefForm" onsubmit="return false;" style="max-width:700px;">' +

      '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div><label class="form-label">Name *</label><input type="text" id="pdfName" class="form-input" value="' + esc(pd ? pd.name : '') + '" required></div>' +
      '<div><label class="form-label">Type *</label><select id="pdfType" class="form-input" onchange="window._passToggleFields()">' + typeOpts + '</select></div>' +
      '<div><label class="form-label">Status</label><select id="pdfStatus" class="form-input">' + statusOpts + '</select></div>' +
      '</div>' +

      '<div style="margin-bottom:1rem;"><label class="form-label">Description</label>' +
      '<textarea id="pdfDesc" class="form-input" rows="2">' + esc(pd ? pd.description : '') + '</textarea></div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div><label class="form-label">Price ($) *</label><input type="number" id="pdfPrice" class="form-input" min="0" step="0.01" value="' + (pd ? (pd.priceCents / 100).toFixed(2) : '') + '" required></div>' +
      '<div id="pdfVisitCountWrap"><label class="form-label">Visit Count</label><input type="number" id="pdfVisitCount" class="form-input" min="1" value="' + (pd && pd.visitCount ? pd.visitCount : '') + '" placeholder="Unlimited if blank"></div>' +
      '<div><label class="form-label">Validity (days)</label><input type="number" id="pdfValidityDays" class="form-input" min="1" value="' + (pd && pd.validityDays ? pd.validityDays : '') + '" placeholder="No limit if blank"></div>' +
      '<div><label class="form-label">Activation</label><select id="pdfActivation" class="form-input">' + activationOpts + '</select></div>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:1rem;margin-bottom:1rem;">' +
      '<div><label class="form-label">Priority</label><select id="pdfPriority" class="form-input">' + priorityOpts + '</select></div>' +
      '<div><label class="form-label">Sort Order</label><input type="number" id="pdfSortOrder" class="form-input" min="0" value="' + (pd ? pd.sortOrder || 0 : 0) + '"></div>' +
      '<div><label class="form-label">Online Purchase</label><select id="pdfOnline" class="form-input"><option value="true"' + (pd && pd.onlinePurchasable === false ? '' : ' selected') + '>Yes</option><option value="false"' + (pd && pd.onlinePurchasable === false ? ' selected' : '') + '>No</option></select></div>' +
      '<div><label class="form-label">Intro Only</label><select id="pdfIntroOnly" class="form-input"><option value="false"' + (pd && pd.introOnly ? '' : ' selected') + '>No</option><option value="true"' + (pd && pd.introOnly ? ' selected' : '') + '>Yes</option></select></div>' +
      '</div>' +

      // Auto-renew
      '<fieldset id="pdfRenewFields" style="border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:1rem;">' +
      '<legend style="font-weight:600;padding:0 8px;">Auto-Renew</legend>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">' +
      '<div><label class="form-label">Auto-Renew</label><select id="pdfAutoRenew" class="form-input" onchange="window._passToggleFields()"><option value="false"' + (pd && pd.autoRenew ? '' : ' selected') + '>No</option><option value="true"' + (pd && pd.autoRenew ? ' selected' : '') + '>Yes</option></select></div>' +
      '<div id="pdfRenewFreqWrap"' + (pd && pd.autoRenew ? '' : ' style="display:none;"') + '><label class="form-label">Frequency</label><select id="pdfRenewFreq" class="form-input">' + renewOpts + '</select></div>' +
      '</div></fieldset>' +

      // Class scope
      '<fieldset style="border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:1.5rem;">' +
      '<legend style="font-weight:600;padding:0 8px;">Class Scope (leave unchecked for all classes)</legend>' +
      '<div style="max-height:200px;overflow-y:auto;">' +
      (classScopeHtml || '<p style="color:var(--warm-gray);">No active classes.</p>') +
      '</div></fieldset>' +

      '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-primary" onclick="window._passSave(\'' + (passDefId || '') + '\')">Save Pass Definition</button>' +
      '<button class="btn" onclick="window._passBackToList()">Cancel</button>' +
      '</div></form>';

    content.innerHTML = html;
    window._passToggleFields();
  }

  async function savePassDefinition(passDefId) {
    var name = document.getElementById('pdfName').value.trim();
    if (!name) { MastAdmin.showToast('Name is required', true); return; }

    var priceDollars = parseFloat(document.getElementById('pdfPrice').value);
    if (isNaN(priceDollars) || priceDollars < 0) { MastAdmin.showToast('Valid price is required', true); return; }

    var type = document.getElementById('pdfType').value;
    var visitCount = parseInt(document.getElementById('pdfVisitCount').value, 10) || null;
    var validityDays = parseInt(document.getElementById('pdfValidityDays').value, 10) || null;

    // For unlimited type, visitCount must be null
    if (type === 'unlimited') visitCount = null;

    // Collect class scope
    var scopeCheckboxes = document.querySelectorAll('input[name="passClassScope"]:checked');
    var allowedClassIds = scopeCheckboxes.length > 0 ? Array.from(scopeCheckboxes).map(function(cb) { return cb.value; }) : null;

    var data = {
      name: name,
      description: document.getElementById('pdfDesc').value.trim() || null,
      type: type,
      priceCents: Math.round(priceDollars * 100),
      visitCount: visitCount,
      validityDays: validityDays,
      activationTrigger: document.getElementById('pdfActivation').value,
      allowedClassIds: allowedClassIds,
      allowedCategories: null,
      autoRenew: document.getElementById('pdfAutoRenew').value === 'true',
      renewFrequency: document.getElementById('pdfAutoRenew').value === 'true' ? document.getElementById('pdfRenewFreq').value : null,
      onlinePurchasable: document.getElementById('pdfOnline').value === 'true',
      introOnly: document.getElementById('pdfIntroOnly').value === 'true',
      priority: document.getElementById('pdfPriority').value,
      sortOrder: parseInt(document.getElementById('pdfSortOrder').value, 10) || 0,
      status: document.getElementById('pdfStatus').value,
      updatedAt: new Date().toISOString()
    };

    try {
      var isNew = !passDefId;
      if (isNew) {
        passDefId = MastDB.passDefinitions.newKey();
        data.createdAt = data.updatedAt;
      }
      await MastDB.passDefinitions.set(passDefId, data);
      MastAdmin.showToast(isNew ? 'Pass definition created!' : 'Pass definition updated!');
      passDefsLoaded = false;
      await loadPassDefinitions();
      switchSubTab('passes');
    } catch (err) {
      console.error('[Book] Pass definition save failed:', err);
      MastAdmin.showToast('Save failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Conflict Detection
  // ============================================================

  async function checkConflicts(date, startTime, endTime, instructorId, resourceId, excludeSessionId) {
    if (!instructorId && !resourceId) return [];
    var conflicts = [];

    try {
      // Query all sessions on the same date
      var snap = await MastDB.classSessions.ref().orderByChild('date').equalTo(date).once('value');
      var sessions = snap.val() || {};

      Object.keys(sessions).forEach(function(id) {
        if (id === excludeSessionId) return;
        var s = sessions[id];
        if (s.status !== 'scheduled') return;

        // Check time overlap
        if (s.startTime >= endTime || s.endTime <= startTime) return;

        if (instructorId && s.instructorId === instructorId) {
          var instrName = instructorsMap[instructorId] ? instructorsMap[instructorId].name : 'Instructor';
          conflicts.push(instrName + ' is already assigned to a session at ' + formatTime(s.startTime) + ' on ' + formatDate(date));
        }
        if (resourceId && s.resourceId === resourceId) {
          var resName = resourcesMap[resourceId] ? resourcesMap[resourceId].name : 'Resource';
          conflicts.push(resName + ' is already booked at ' + formatTime(s.startTime) + ' on ' + formatDate(date));
        }
      });
    } catch (err) {
      console.warn('[Book] Conflict check failed:', err);
    }

    return conflicts;
  }

  // ============================================================
  // Session Assignment Override
  // ============================================================

  async function assignToSession(sessionId, classId) {
    // Load instructors/resources if not loaded
    if (!instructorsLoaded) await loadInstructors();
    if (!resourcesLoaded) await loadResources();

    var session = sessionsData.find(function(s) { return s.id === sessionId; });
    if (!session) return;

    var instrOpts = '<option value="">None</option>' +
      instructorsData.filter(function(i) { return i.status === 'active'; }).map(function(i) {
        return '<option value="' + esc(i.id) + '"' + (session.instructorId === i.id ? ' selected' : '') + '>' + esc(i.name) + '</option>';
      }).join('');

    var resOpts = '<option value="">None</option>' +
      resourcesData.filter(function(r) { return r.status === 'active'; }).map(function(r) {
        return '<option value="' + esc(r.id) + '"' + (session.resourceId === r.id ? ' selected' : '') + '>' + esc(r.name) + ' (' + esc(r.type) + ')</option>';
      }).join('');

    var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;" id="assignOverlay">' +
      '<div style="background:var(--surface-dark);border:1px solid var(--border);border-radius:12px;padding:1.5rem;max-width:400px;width:90%;">' +
      '<h3 style="margin:0 0 1rem;">Assign Session — ' + formatDate(session.date) + '</h3>' +
      '<div style="margin-bottom:1rem;"><label class="form-label">Instructor</label><select id="assignInstr" class="form-input">' + instrOpts + '</select></div>' +
      '<div style="margin-bottom:1.5rem;"><label class="form-label">Resource</label><select id="assignRes" class="form-input">' + resOpts + '</select></div>' +
      '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-primary" onclick="window._assignSave(\'' + esc(sessionId) + '\',\'' + esc(classId) + '\')">Save</button>' +
      '<button class="btn" onclick="document.getElementById(\'assignOverlay\').remove()">Cancel</button>' +
      '</div></div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  async function saveSessionAssignment(sessionId, classId) {
    var instrId = document.getElementById('assignInstr').value || null;
    var resId = document.getElementById('assignRes').value || null;

    var session = sessionsData.find(function(s) { return s.id === sessionId; });
    if (!session) return;

    // Conflict check
    var conflicts = await checkConflicts(session.date, session.startTime, session.endTime, instrId, resId, sessionId);
    if (conflicts.length > 0) {
      MastAdmin.showToast('Warning: ' + conflicts[0], true);
      // Non-blocking — proceed anyway
    }

    var update = {
      instructorId: instrId,
      instructorName: instrId && instructorsMap[instrId] ? instructorsMap[instrId].name : null,
      resourceId: resId,
      resourceName: resId && resourcesMap[resId] ? resourcesMap[resId].name : null
    };

    try {
      await MastDB.classSessions.update(sessionId, update);
      MastAdmin.showToast('Session assignment updated');
      var overlay = document.getElementById('assignOverlay');
      if (overlay) overlay.remove();
      if (classId) loadClassDetail(classId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Navigation helpers
  // ============================================================

  function backToList() {
    selectedClassId = null;
    hideAllViews();
    document.getElementById('bookListView').style.display = '';
    switchSubTab('classes');
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

  // Sub-tab navigation
  window._bookSubTab = function(tab) { switchSubTab(tab); };

  // Instructor callbacks
  window._instrFilterStatus = function() { renderInstructorList(); };
  window._instrCreate = function() { showInstructorForm(null); };
  window._instrEdit = function(id) { showInstructorForm(id); };
  window._instrSave = function(id) { saveInstructor(id || null); };
  window._instrBackToList = function() { switchSubTab('instructors'); };

  // Resource callbacks
  window._resFilterType = function() { renderResourceList(); };
  window._resFilterStatus = function() { renderResourceList(); };
  window._resCreate = function() { showResourceForm(null); };
  window._resEdit = function(id) { showResourceForm(id); };
  window._resSave = function(id) { saveResource(id || null); };
  window._resBackToList = function() { switchSubTab('resources'); };

  // Pass definition callbacks
  window._passFilterType = function() { renderPassDefList(); };
  window._passFilterStatus = function() { renderPassDefList(); };
  window._passCreate = function() { showPassDefForm(null); };
  window._passEdit = function(id) { showPassDefForm(id); };
  window._passSave = function(id) { savePassDefinition(id || null); };
  window._passBackToList = function() { switchSubTab('passes'); };
  window._passToggleFields = function() {
    var type = document.getElementById('pdfType');
    var visitWrap = document.getElementById('pdfVisitCountWrap');
    var renewFreqWrap = document.getElementById('pdfRenewFreqWrap');
    var autoRenew = document.getElementById('pdfAutoRenew');
    if (type && visitWrap) visitWrap.style.display = type.value === 'unlimited' ? 'none' : '';
    if (autoRenew && renewFreqWrap) renewFreqWrap.style.display = autoRenew.value === 'true' ? '' : 'none';
  };

  // Session assignment
  window._bookAssignSession = function(sessionId, classId) { assignToSession(sessionId, classId); };
  window._assignSave = function(sessionId, classId) { saveSessionAssignment(sessionId, classId); };

  // ============================================================
  // Module Registration
  // ============================================================

  MastAdmin.registerModule('book', {
    routes: {
      'book': { tab: 'bookTab', setup: function() { loadClasses(); switchSubTab('classes'); } },
      'book-detail': { tab: 'bookTab', setup: function(id) { if (id) { loadClassDetail(id); } else { loadClasses(); switchSubTab('classes'); } } },
      'enrollments': { tab: 'bookTab', setup: function() { switchSubTab('enrollments'); } },
      'instructors': { tab: 'bookTab', setup: function() { switchSubTab('instructors'); } },
      'instructor-detail': { tab: 'bookTab', setup: function(id) { if (id) { showInstructorForm(id); } else { switchSubTab('instructors'); } } },
      'resources': { tab: 'bookTab', setup: function() { switchSubTab('resources'); } },
      'resource-detail': { tab: 'bookTab', setup: function(id) { if (id) { showResourceForm(id); } else { switchSubTab('resources'); } } },
      'passes': { tab: 'bookTab', setup: function() { switchSubTab('passes'); } },
      'pass-detail': { tab: 'bookTab', setup: function(id) { if (id) { showPassDefForm(id); } else { switchSubTab('passes'); } } }
    },
    detachListeners: function() {
      classesData = [];
      classesLoaded = false;
      selectedClassId = null;
      sessionsData = [];
      enrollmentsData = [];
      enrollmentsLoaded = false;
      allClassesMap = {};
      instructorsData = [];
      instructorsLoaded = false;
      instructorsMap = {};
      resourcesData = [];
      resourcesLoaded = false;
      resourcesMap = {};
      passDefsData = [];
      passDefsLoaded = false;
      currentSubTab = 'classes';
    }
  });

})();
