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

  // Calendar state
  var calendarYear = new Date().getFullYear();
  var calendarMonth = new Date().getMonth();
  var calendarSessions = [];
  var calendarClassesMap = {};
  var calendarLoaded = false;
  var selectedCalendarDay = null;

  // Reports state
  var reportsLoaded = false;

  // ============================================================
  // Shared Style Constants
  // ============================================================

  var SUCCESS_COLOR = '#4DB6AC';
  var DANGER_COLOR = '#EF9A9A';
  var WARNING_COLOR = '#FFD54F';
  var CARD_STYLE = 'background:var(--surface-dark);border-radius:8px;padding:12px 16px;';
  var FORM_SELECT_STYLE = 'padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.85rem;';
  var FILTER_SELECT_STYLE = 'padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.85rem;';
  var SECTION_H3 = 'margin:1.5rem 0 0.75rem;';
  var EMPTY_STATE_STYLE = 'color:var(--warm-gray);padding:2rem;text-align:center;';
  var LOADING_HTML = '<div style="padding:2rem;text-align:center;"><div style="display:inline-block;width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--text);border-radius:50%;animation:bookSpin 0.8s linear infinite;"></div><p style="color:var(--warm-gray);margin-top:8px;font-size:0.85rem;">Loading...</p></div>';

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

  var SEVERITY_BADGE_COLORS = {
    low:      { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    medium:   { bg: 'rgba(146,64,14,0.2)',  color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    high:     { bg: 'rgba(230,81,0,0.2)',   color: '#FF8A65', border: 'rgba(230,81,0,0.35)' },
    critical: { bg: 'rgba(183,28,28,0.2)',  color: '#EF9A9A', border: 'rgba(183,28,28,0.35)' }
  };

  var PASS_TYPE_BADGE_COLORS = {
    'drop-in':  TYPE_BADGE_COLORS.single,
    'pack':     TYPE_BADGE_COLORS.series,
    'unlimited': TYPE_BADGE_COLORS.dropin,
    'limited':  TYPE_BADGE_COLORS['private'],
    'series':   TYPE_BADGE_COLORS.series,
    'intro':    { bg: 'rgba(146,64,14,0.2)', color: '#FFD54F', border: 'rgba(146,64,14,0.35)' }
  };

  var RESOURCE_TYPE_BADGE_COLORS = {
    'room':      TYPE_BADGE_COLORS.series,
    'equipment': TYPE_BADGE_COLORS.single
  };

  function badgeStyle(map, key) {
    var c = map[(key || '').toLowerCase()] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

  // Inject book-specific CSS
  (function() {
    if (!document.getElementById('bookModuleStyles')) {
      var style = document.createElement('style');
      style.id = 'bookModuleStyles';
      style.textContent =
        '@keyframes bookSpin{to{transform:rotate(360deg)}}' +

        /* Responsive utilities */
        '@media(max-width:600px){.book-hide-narrow{display:none!important;}}' +
        '.book-responsive-grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));}' +

        /* .form-label and .form-input are now defined globally in index.html */

        /* Form section cards */
        '.book-form-section{background:var(--surface-card,#2a2a2a);border:1px solid var(--border,#444);' +
          'border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1.25rem;}' +
        '.book-form-section-title{font-size:0.8rem;font-weight:700;text-transform:uppercase;' +
          'letter-spacing:0.06em;color:var(--primary,#C4853C);margin:0 0 1rem;padding-bottom:0.6rem;' +
          'border-bottom:1px solid var(--border,#444);display:flex;align-items:center;gap:8px;}' +

        /* Field hint text */
        '.book-field-hint{font-size:0.72rem;color:var(--warm-gray,#888);margin-top:4px;line-height:1.4;}' +

        /* Required marker */
        '.book-required{color:' + DANGER_COLOR + ';margin-left:2px;}' +

        /* Form field group — consistent spacing */
        '.book-field{margin-bottom:1rem;}' +
        '.book-field:last-child{margin-bottom:0;}' +

        /* Checkbox / radio styling */
        '.book-check{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9rem;color:var(--text,#e0e0e0);}' +
        '.book-check input[type="checkbox"],.book-check input[type="radio"]{' +
          'width:18px;height:18px;accent-color:var(--primary,#C4853C);cursor:pointer;}' +

        /* Form action buttons area */
        '.book-form-actions{display:flex;gap:10px;margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--border,#444);}' +

        /* Day-of-week pill selector */
        '.book-day-pills{display:flex;flex-wrap:wrap;gap:6px;}' +
        '.book-day-pill{display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border-radius:20px;' +
          'border:1px solid var(--border,#444);background:transparent;color:var(--text,#e0e0e0);' +
          'font-size:0.8rem;cursor:pointer;transition:all 0.2s;}' +
        '.book-day-pill:has(input:checked){background:var(--primary,#C4853C);color:#fff;border-color:var(--primary,#C4853C);}' +
        '.book-day-pill input{display:none;}' +

        /* Override for schedule radio */
        '.book-sched-toggle{display:flex;gap:0;border:1px solid var(--border,#444);border-radius:8px;overflow:hidden;}' +
        '.book-sched-toggle label{padding:8px 20px;cursor:pointer;font-size:0.85rem;color:var(--text,#e0e0e0);' +
          'transition:all 0.2s;border-right:1px solid var(--border,#444);}' +
        '.book-sched-toggle label:last-child{border-right:none;}' +
        '.book-sched-toggle label:has(input:checked){background:var(--primary,#C4853C);color:#fff;}' +
        '.book-sched-toggle input{display:none;}' +

        '';
      document.head.appendChild(style);
    }
  })();

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
        '<td><div class="event-actions"><button class="btn-icon" onclick="event.stopPropagation();window._bookEditClass(\'' + esc(c.id) + '\')" title="Edit">&#9998;</button></div></td>' +
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
    content.innerHTML = LOADING_HTML;

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
      content.innerHTML = '<p style="color:' + DANGER_COLOR + ';padding:2rem;">Failed to load class details.</p>';
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
      '<h2 style="margin:0 0 6px;font-size:1.4rem;">' + esc(cls.name) + '</h2>' +
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

    // ── Class Details card ──
    html += '<div class="book-form-section">' +
      '<div class="book-form-section-title">Class Details</div>' +
      '<div class="book-responsive-grid">' +
      _detailField('Category', cls.category || '—') +
      _detailField('Duration', (cls.duration || 0) + ' min') +
      _detailField('Capacity', (cls.capacity || '—') + (cls.minEnrollment ? ' (min ' + cls.minEnrollment + ')' : '')) +
      _detailField('Price', formatPrice(cls.priceCents));
    if (cls.type === 'series' && cls.seriesInfo) {
      html += _detailField('Series Price', formatPrice(cls.seriesInfo.seriesPriceCents)) +
      _detailField('Sessions', cls.seriesInfo.totalSessions || '—') +
      _detailField('Drop-in OK', cls.seriesInfo.allowDropIn ? 'Yes' : 'No');
    }
    html += '</div></div>';

    // ── Schedule & Assignment card ──
    html += '<div class="book-form-section">' +
      '<div class="book-form-section-title">Schedule &amp; Assignment</div>' +
      '<div class="book-responsive-grid">' +
      _detailField('Schedule', schedDesc || '—') +
      _detailField('Materials', cls.materialsIncluded ? (cls.materialsNote || 'Included') : (cls.materialsCostCents ? formatPrice(cls.materialsCostCents) + ' fee' + (cls.materialsNote ? ' — ' + esc(cls.materialsNote) : '') : 'Not included')) +
      _detailField('Instructor', cls.instructorName || '—') +
      _detailField('Resource', cls.resourceName || '—') +
      '</div></div>';

    if (cls.description) {
      html += '<div class="book-form-section">' +
        '<div class="book-form-section-title">Description</div>' +
        '<p style="color:var(--warm-gray);line-height:1.6;margin:0;">' + esc(cls.description) + '</p>' +
        '</div>';
    }

    // ── Sessions table ──
    html += '<div class="book-form-section">' +
      '<div class="book-form-section-title">Sessions <span style="font-weight:400;color:var(--warm-gray);text-transform:none;letter-spacing:0;">(' + sessionsData.length + ')</span></div>';
    if (sessionsData.length === 0) {
      html += '<p style="color:var(--warm-gray);">No sessions generated yet. Click <strong>Generate Sessions</strong> above.</p>';
    } else {
      var today = todayStr();
      html += '<table class="data-table"><thead><tr><th>Date</th><th>Time</th><th class="book-hide-narrow">Instructor</th><th class="book-hide-narrow">Resource</th><th>Enrolled</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      sessionsData.forEach(function(s) {
        var isPast = s.date < today;
        var rowStyle = isPast ? 'opacity:0.5;' : '';
        html += '<tr style="' + rowStyle + '">' +
          '<td>' + formatDate(s.date) + '</td>' +
          '<td>' + formatTime(s.startTime) + ' - ' + formatTime(s.endTime) + '</td>' +
          '<td class="book-hide-narrow">' + esc(s.instructorName || '—') + '</td>' +
          '<td class="book-hide-narrow">' + esc(s.resourceName || '—') + '</td>' +
          '<td>' + (s.enrolled || 0) + ' / ' + (s.capacity || cls.capacity || '—') + (s.waitlisted ? ' (+' + s.waitlisted + ' waitlisted)' : '') + '</td>' +
          '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, s.status) + '">' + esc(s.status) + '</span></td>' +
          '<td><div class="event-actions">' +
          '<button class="btn-icon" onclick="window._bookAssignSession(\'' + esc(s.id) + '\',\'' + esc(cls.id) + '\')" title="Assign Instructor/Resource">&#128100;</button>' +
          '<button class="btn-icon" onclick="window._bookViewSessionEnrollments(\'' + esc(s.id) + '\',\'' + esc(cls.id) + '\')" title="View Enrollments">&#128203;</button>';
        if (s.status === 'scheduled') {
          html += '<button class="btn-icon" onclick="window._bookSessionChecklist(\'' + esc(s.id) + '\',\'' + esc(cls.id) + '\')" title="Startup Checklist">&#9745;</button>';
        }
        if (s.status === 'scheduled' && isPast) {
          html += '<button class="btn-icon" onclick="window._bookSessionReport(\'' + esc(s.id) + '\',\'' + esc(cls.id) + '\')" title="Completion Report">&#128221;</button>';
        }
        if (s.status === 'scheduled' && !isPast) {
          html += '<button class="btn-icon danger" onclick="window._bookCancelSession(\'' + esc(s.id) + '\')" title="Cancel Session">&#10006;</button>';
        }
        html += '</div></td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>'; // close sessions book-form-section

    content.innerHTML = html;
  }

  function _detailField(label, value) {
    return '<div style="margin-bottom:0.75rem;">' +
      '<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin-bottom:4px;">' + esc(label) + '</div>' +
      '<div style="font-size:0.95rem;color:var(--text);">' + esc(String(value)) + '</div></div>';
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

    var daysHtml = '<div class="book-day-pills">' + DAYS_OF_WEEK.map(function(d) {
      var checked = sched.days && sched.days.indexOf(d) !== -1 ? ' checked' : '';
      return '<label class="book-day-pill"><input type="checkbox" name="schedDays" value="' + d + '"' + checked + '>' + DAY_LABELS[d] + '</label>';
    }).join('') + '</div>';

    var typeOptions = CLASS_TYPES.map(function(t) {
      return '<option value="' + t + '"' + (cls && cls.type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    }).join('');

    var statusOptions = CLASS_STATUSES.map(function(s) {
      return '<option value="' + s + '"' + (cls && cls.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
    }).join('');

    var schedTypeOnce = sched.type === 'once' ? ' checked' : '';
    var schedTypeRecurring = sched.type === 'recurring' || !sched.type ? ' checked' : '';

    var html = '<h2 style="margin:0 0 1.5rem;font-size:1.4rem;">' + (isNew ? 'New Class' : 'Edit: ' + esc(cls.name)) + '</h2>' +
      '<form id="bookClassForm" onsubmit="return false;" style="max-width:720px;">' +

      // ── Basic Info ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Basic Info</div>' +
      '<div class="book-field"><label class="form-label">Name <span class="book-required">*</span></label>' +
      '<input type="text" id="bcfName" class="form-input" value="' + esc(cls ? cls.name : '') + '" required placeholder="e.g. Wheel Throwing Basics"></div>' +
      '<div class="book-field"><label class="form-label">Description</label>' +
      '<textarea id="bcfDesc" class="form-input" rows="3" placeholder="Class description for students...">' + esc(cls ? cls.description : '') + '</textarea></div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Type <span class="book-required">*</span></label><select id="bcfType" class="form-input" onchange="window._bookToggleSeriesFields()">' + typeOptions + '</select></div>' +
      '<div class="book-field"><label class="form-label">Category</label><input type="text" id="bcfCategory" class="form-input" value="' + esc(cls ? cls.category : '') + '" placeholder="e.g. Pottery, Glass"></div>' +
      '<div class="book-field"><label class="form-label">Status</label><select id="bcfStatus" class="form-input">' + statusOptions + '</select></div>' +
      '</div></div>' +

      // ── Pricing & Capacity ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Pricing &amp; Capacity</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Capacity <span class="book-required">*</span></label><input type="number" id="bcfCapacity" class="form-input" min="1" value="' + (cls ? cls.capacity || '' : '') + '" required></div>' +
      '<div class="book-field"><label class="form-label">Drop-in Price ($) <span class="book-required">*</span></label><input type="number" id="bcfPrice" class="form-input" min="0" step="0.01" value="' + (cls ? (cls.priceCents / 100).toFixed(2) : '') + '" required></div>' +
      '<div class="book-field"><label class="form-label">Duration (min) <span class="book-required">*</span></label><input type="number" id="bcfDuration" class="form-input" min="1" value="' + (cls ? cls.duration || '' : '') + '" required></div>' +
      '</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Min Enrollment</label><input type="number" id="bcfMinEnroll" class="form-input" min="0" value="' + (cls && cls.minEnrollment ? cls.minEnrollment : '') + '" placeholder="Optional">' +
      '<div class="book-field-hint">Minimum students needed to run the session</div></div>' +
      '<div class="book-field"><label class="form-label">Cancel Lead Days</label><input type="number" id="bcfCancelLead" class="form-input" min="0" max="30" value="' + (cls && cls.cancellationLeadDays ? cls.cancellationLeadDays : '2') + '">' +
      '<div class="book-field-hint">Days before session to check minimum enrollment</div></div>' +
      '</div></div>' +

      // ── Schedule ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Schedule</div>' +
      '<div class="book-field" style="margin-bottom:1.25rem;">' +
      '<div class="book-sched-toggle">' +
      '<label><input type="radio" name="schedType" value="recurring"' + schedTypeRecurring + ' onchange="window._bookToggleSchedType()">Recurring</label>' +
      '<label><input type="radio" name="schedType" value="once"' + schedTypeOnce + ' onchange="window._bookToggleSchedType()">One-time</label>' +
      '</div></div>' +
      '<div id="bcfSchedRecurring">' +
      '<div class="book-field"><label class="form-label">Days of Week</label>' + daysHtml + '</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Start Time</label><input type="time" id="bcfStartTime" class="form-input" value="' + esc(sched.startTime || '') + '"></div>' +
      '<div class="book-field"><label class="form-label">Start Date</label><input type="date" id="bcfStartDate" class="form-input" value="' + esc(sched.startDate || '') + '"></div>' +
      '<div class="book-field"><label class="form-label">End Date</label><input type="date" id="bcfEndDate" class="form-input" value="' + esc(sched.endDate || '') + '">' +
      '<div class="book-field-hint">Leave blank to auto-generate 8 weeks</div></div>' +
      '</div></div>' +
      '<div id="bcfSchedOnce" style="display:none;">' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Date</label><input type="date" id="bcfOnceDate" class="form-input" value="' + esc(sched.date || sched.startDate || '') + '"></div>' +
      '<div class="book-field"><label class="form-label">Time</label><input type="time" id="bcfOnceTime" class="form-input" value="' + esc(sched.startTime || '') + '"></div>' +
      '</div></div>' +
      '</div>' +

      // ── Series Details (conditional) ──
      '<div id="bcfSeriesFields" class="book-form-section" style="' + (cls && cls.type === 'series' ? '' : 'display:none;') + '">' +
      '<div class="book-form-section-title">Series Details</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Total Sessions</label><input type="number" id="bcfSeriesTotal" class="form-input" min="1" value="' + (series.totalSessions || '') + '"></div>' +
      '<div class="book-field"><label class="form-label">Series Price ($)</label><input type="number" id="bcfSeriesPrice" class="form-input" min="0" step="0.01" value="' + (series.seriesPriceCents ? (series.seriesPriceCents / 100).toFixed(2) : '') + '"></div>' +
      '<div class="book-field"><label class="form-label">Allow Drop-in</label><select id="bcfSeriesDropin" class="form-input"><option value="true"' + (series.allowDropIn !== false ? ' selected' : '') + '>Yes</option><option value="false"' + (series.allowDropIn === false ? ' selected' : '') + '>No</option></select></div>' +
      '<div class="book-field"><label class="form-label">Allow Late Enroll</label><select id="bcfSeriesLateEnroll" class="form-input"><option value="false"' + (series.allowLateEnroll !== true ? ' selected' : '') + '>No</option><option value="true"' + (series.allowLateEnroll === true ? ' selected' : '') + '>Yes</option></select></div>' +
      '</div></div>' +

      // ── Materials ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Materials</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Materials Included</label><select id="bcfMaterials" class="form-input" onchange="window._bookToggleMaterialsCost()"><option value="false"' + (cls && cls.materialsIncluded ? '' : ' selected') + '>No</option><option value="true"' + (cls && cls.materialsIncluded ? ' selected' : '') + '>Yes</option></select></div>' +
      '<div class="book-field" id="bcfMaterialsCostWrap" style="' + (cls && cls.materialsIncluded ? 'display:none;' : '') + '"><label class="form-label">Materials Cost ($)</label><input type="number" id="bcfMaterialsCost" class="form-input" min="0" step="0.01" value="' + (cls && cls.materialsCostCents ? (cls.materialsCostCents / 100).toFixed(2) : '') + '" placeholder="0.00">' +
      '<div class="book-field-hint">Added as separate line item at checkout</div></div>' +
      '<div class="book-field"><label class="form-label">Materials Note</label><input type="text" id="bcfMaterialsNote" class="form-input" value="' + esc(cls ? cls.materialsNote : '') + '" placeholder="e.g. 25lbs of clay + glazes"></div>' +
      '</div></div>' +

      // ── Assignment ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Assignment</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Instructor</label><select id="bcfInstructor" class="form-input">' +
      '<option value="">None</option>' +
      instructorsData.filter(function(i) { return i.status === 'active'; }).map(function(i) {
        return '<option value="' + esc(i.id) + '"' + (cls && cls.instructorId === i.id ? ' selected' : '') + '>' + esc(i.name) + '</option>';
      }).join('') +
      '</select></div>' +
      '<div class="book-field"><label class="form-label">Resource</label><select id="bcfResource" class="form-input">' +
      '<option value="">None</option>' +
      resourcesData.filter(function(r) { return r.status === 'active'; }).map(function(r) {
        return '<option value="' + esc(r.id) + '"' + (cls && cls.resourceId === r.id ? ' selected' : '') + '>' + esc(r.name) + ' (' + esc(r.type) + ')</option>';
      }).join('') +
      '</select></div>' +
      '</div></div>' +

      // ── Actions ──
      '<div class="book-form-actions">' +
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
      cancellationLeadDays: parseInt(document.getElementById('bcfCancelLead').value, 10) || 2,
      priceCents: Math.round(priceDollars * 100),
      duration: parseInt(document.getElementById('bcfDuration').value, 10) || 60,
      schedule: schedule,
      materialsIncluded: document.getElementById('bcfMaterials').value === 'true',
      materialsCostCents: document.getElementById('bcfMaterials').value === 'true' ? null : (function() { var v = parseFloat(document.getElementById('bcfMaterialsCost').value); return isNaN(v) || v <= 0 ? null : Math.round(v * 100); })(),
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
      switchSubTab('classes');
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
        materialsCostCents: cls.materialsCostCents || null,
        materialsIncluded: cls.materialsIncluded || false,
        materialsNote: cls.materialsNote || null,
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
    table.innerHTML = LOADING_HTML;

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
      table.innerHTML = '<p style="color:' + DANGER_COLOR + ';">Failed to load enrollments.</p>';
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
      // Waitlisted sort by position, everything else by date descending
      if (a.status === 'waitlisted' && b.status === 'waitlisted') {
        return (a.waitlistPosition || 999) - (b.waitlistPosition || 999);
      }
      return (b.enrolledAt || '').localeCompare(a.enrolledAt || '');
    });

    if (filtered.length === 0) {
      table.innerHTML = '<p style="' + EMPTY_STATE_STYLE + '">No enrollments found.</p>';
      return;
    }

    var html = '<table class="data-table"><thead><tr>' +
      '<th>Student</th><th>Class</th><th>Session</th><th>Paid</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(function(e) {
      var className = allClassesMap[e.classId] ? allClassesMap[e.classId].name : e.classId;
      var statusLabel = e.status === 'waitlisted' && e.waitlistPosition
        ? e.status + ' #' + e.waitlistPosition : e.status;

      html += '<tr>' +
        '<td><strong>' + esc(e.studentName || e.customerName || '—') + '</strong><br><span style="font-size:0.8rem;color:var(--warm-gray);">' + esc(e.studentEmail || e.customerEmail || '') + '</span></td>' +
        '<td>' + esc(className) + '</td>' +
        '<td>' + esc(e.sessionId || '—') + '</td>' +
        '<td>' + formatPrice(e.pricePaidCents || e.pricePaid) + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, e.status) + '">' + esc(statusLabel) + '</span></td>' +
        '<td><div class="event-actions">';

      if (e.status === 'confirmed') {
        html += '<button class="btn-icon" onclick="window._bookMarkAttended(\'' + esc(e.id) + '\')" title="Mark Attended">&#10003;</button>';
        html += '<button class="btn-icon" onclick="window._bookMarkNoShow(\'' + esc(e.id) + '\')" title="Mark No-Show">&#128683;</button>';
        html += '<button class="btn-icon danger" onclick="window._bookCancelEnrollment(\'' + esc(e.id) + '\')" title="Cancel Enrollment">&#10006;</button>';
      }
      if (e.status === 'waitlisted') {
        html += '<button class="btn-icon" onclick="window._bookPromoteWaitlist(\'' + esc(e.id) + '\')" title="Promote to Confirmed">&#9650;</button>';
        html += '<button class="btn-icon danger" onclick="window._bookCancelEnrollment(\'' + esc(e.id) + '\')" title="Cancel Enrollment">&#10006;</button>';
      }

      html += '</div></td></tr>';
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

  var BOOK_VIEWS = ['bookListView', 'bookDetailView', 'bookEnrollmentsView', 'bookInstructorsView', 'bookInstructorDetailView', 'bookResourcesView', 'bookResourceDetailView', 'bookPassesView', 'bookPassDetailView', 'bookSessionOpsView', 'bookCalendarView', 'bookReportsView'];

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
    var tabMap = { classes: 0, instructors: 1, resources: 2, passes: 3, enrollments: 4, calendar: 5, 'book-reports': 6 };
    if (tabs[tabMap[tab]]) tabs[tabMap[tab]].classList.add('active');

    hideAllViews();
    if (tab === 'classes') { document.getElementById('bookListView').style.display = ''; renderClassList(); }
    else if (tab === 'instructors') { document.getElementById('bookInstructorsView').style.display = ''; loadInstructors(); }
    else if (tab === 'resources') { document.getElementById('bookResourcesView').style.display = ''; loadResources(); }
    else if (tab === 'passes') { document.getElementById('bookPassesView').style.display = ''; loadPassDefinitions(); }
    else if (tab === 'enrollments') { document.getElementById('bookEnrollmentsView').style.display = ''; loadEnrollments(); }
    else if (tab === 'calendar') { document.getElementById('bookCalendarView').style.display = ''; loadCalendar(); }
    else if (tab === 'book-reports') { document.getElementById('bookReportsView').style.display = ''; loadReports(); }
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
        '<td><div class="event-actions"><button class="btn-icon" onclick="window._instrEdit(\'' + esc(i.id) + '\')" title="Edit">&#9998;</button></div></td>' +
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

    var html = '<h2 style="margin:0 0 1.5rem;font-size:1.4rem;">' + (isNew ? 'New Instructor' : 'Edit: ' + esc(instr.name)) + '</h2>' +
      '<form id="instrForm" onsubmit="return false;" style="max-width:720px;">' +

      // ── Basic Info ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Basic Info</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field" style="grid-column:span 2;"><label class="form-label">Name <span class="book-required">*</span></label><input type="text" id="ifName" class="form-input" value="' + esc(instr ? instr.name : '') + '" required placeholder="Full name"></div>' +
      '<div class="book-field"><label class="form-label">Status</label><select id="ifStatus" class="form-input">' + statusOpts + '</select></div>' +
      '</div></div>' +

      // ── Details ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Details</div>' +
      '<div class="book-field"><label class="form-label">Bio</label>' +
      '<textarea id="ifBio" class="form-input" rows="3" placeholder="Teaching background and experience...">' + esc(instr ? instr.bio : '') + '</textarea></div>' +
      '<div class="book-field"><label class="form-label">Specialties</label>' +
      '<input type="text" id="ifSpecialties" class="form-input" value="' + esc(instr && instr.specialties ? instr.specialties.join(', ') : '') + '" placeholder="e.g. Wheel Throwing, Glazing, Hand Building">' +
      '<div class="book-field-hint">Separate multiple specialties with commas</div></div>' +
      '</div>' +

      // ── Contact ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Contact &amp; Pay</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Email</label><input type="email" id="ifEmail" class="form-input" value="' + esc(instr ? instr.email : '') + '" placeholder="instructor@email.com"></div>' +
      '<div class="book-field"><label class="form-label">Phone</label><input type="text" id="ifPhone" class="form-input" value="' + esc(instr ? instr.phone : '') + '" placeholder="(555) 123-4567"></div>' +
      '<div class="book-field"><label class="form-label">Pay Rate ($/hr)</label><input type="number" id="ifPayRate" class="form-input" min="0" step="0.01" value="' + (instr && instr.payRateCents ? (instr.payRateCents / 100).toFixed(2) : '') + '"></div>' +
      '</div></div>' +

      // ── Media & Notes ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Media &amp; Notes</div>' +
      '<div class="book-field"><label class="form-label">Photo URL</label>' +
      '<input type="text" id="ifPhoto" class="form-input" value="' + esc(instr ? instr.photoUrl : '') + '" placeholder="https://..."></div>' +
      '<div class="book-field"><label class="form-label">Internal Notes</label>' +
      '<textarea id="ifNotes" class="form-input" rows="2" placeholder="Notes visible to admin only...">' + esc(instr ? instr.notes : '') + '</textarea></div>' +
      '</div>' +

      // ── Actions ──
      '<div class="book-form-actions">' +
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
        '<td><span style="' + badgeStyle(RESOURCE_TYPE_BADGE_COLORS, r.type) + '">' + esc(r.type) + '</span></td>' +
        '<td>' + (r.capacity || '—') + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, r.status) + '">' + esc(r.status) + '</span></td>' +
        '<td><div class="event-actions"><button class="btn-icon" onclick="window._resEdit(\'' + esc(r.id) + '\')" title="Edit">&#9998;</button></div></td>' +
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

    var html = '<h2 style="margin:0 0 1.5rem;font-size:1.4rem;">' + (isNew ? 'New Resource' : 'Edit: ' + esc(res.name)) + '</h2>' +
      '<form id="resForm" onsubmit="return false;" style="max-width:720px;">' +

      // ── Basic Info ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Basic Info</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field" style="grid-column:span 2;"><label class="form-label">Name <span class="book-required">*</span></label><input type="text" id="rfName" class="form-input" value="' + esc(res ? res.name : '') + '" required placeholder="e.g. Main Studio, Kiln #1"></div>' +
      '<div class="book-field"><label class="form-label">Type <span class="book-required">*</span></label><select id="rfType" class="form-input">' + typeOpts + '</select></div>' +
      '<div class="book-field"><label class="form-label">Status</label><select id="rfStatus" class="form-input">' + statusOpts + '</select></div>' +
      '</div></div>' +

      // ── Details ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Details</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Sub-type</label><input type="text" id="rfSubType" class="form-input" value="' + esc(res ? res.subType : '') + '" placeholder="e.g. Kiln, Pottery Wheel"></div>' +
      '<div class="book-field"><label class="form-label">Capacity</label><input type="number" id="rfCapacity" class="form-input" min="0" value="' + (res ? res.capacity || '' : '') + '" placeholder="Max students"></div>' +
      '</div>' +
      '<div class="book-field"><label class="form-label">Description</label>' +
      '<textarea id="rfDesc" class="form-input" rows="2" placeholder="What is this resource used for?">' + esc(res ? res.description : '') + '</textarea></div>' +
      '</div>' +

      // ── Internal ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Internal Notes</div>' +
      '<div class="book-field"><label class="form-label">Notes</label>' +
      '<textarea id="rfNotes" class="form-input" rows="2" placeholder="Admin-only notes...">' + esc(res ? res.notes : '') + '</textarea></div>' +
      '</div>' +

      // ── Actions ──
      '<div class="book-form-actions">' +
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
        '<td><span style="' + badgeStyle(PASS_TYPE_BADGE_COLORS, p.type) + '">' + esc(p.type) + '</span></td>' +
        '<td>' + formatPrice(p.priceCents) + (p.autoRenew ? '<br><span style="font-size:0.75rem;color:var(--warm-gray);">/' + (p.renewFrequency || 'month') + '</span>' : '') + '</td>' +
        '<td>' + esc(visits) + '</td>' +
        '<td>' + esc(validity) + '</td>' +
        '<td><span style="font-size:0.8rem;">' + esc(p.priority || 'medium') + '</span></td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, p.status) + '">' + esc(p.status) + '</span></td>' +
        '<td><div class="event-actions"><button class="btn-icon" onclick="window._passEdit(\'' + esc(p.id) + '\')" title="Edit">&#9998;</button></div></td>' +
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
      return '<label class="book-check" style="margin-bottom:6px;">' +
        '<input type="checkbox" name="passClassScope" value="' + esc(c.id) + '"' + checked + '> ' + esc(c.name) + '</label>';
    }).join('<br>');

    var html = '<h2 style="margin:0 0 1.5rem;font-size:1.4rem;">' + (isNew ? 'New Pass Definition' : 'Edit: ' + esc(pd.name)) + '</h2>' +
      '<form id="passDefForm" onsubmit="return false;" style="max-width:720px;">' +

      // ── Basic Info ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Basic Info</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field" style="grid-column:span 2;"><label class="form-label">Name <span class="book-required">*</span></label><input type="text" id="pdfName" class="form-input" value="' + esc(pd ? pd.name : '') + '" required placeholder="e.g. 10-Class Pack"></div>' +
      '<div class="book-field"><label class="form-label">Type <span class="book-required">*</span></label><select id="pdfType" class="form-input" onchange="window._passToggleFields()">' + typeOpts + '</select></div>' +
      '<div class="book-field"><label class="form-label">Status</label><select id="pdfStatus" class="form-input">' + statusOpts + '</select></div>' +
      '</div>' +
      '<div class="book-field"><label class="form-label">Description</label>' +
      '<textarea id="pdfDesc" class="form-input" rows="2" placeholder="What does this pass include?">' + esc(pd ? pd.description : '') + '</textarea></div>' +
      '</div>' +

      // ── Pricing & Terms ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Pricing &amp; Terms</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Price ($) <span class="book-required">*</span></label><input type="number" id="pdfPrice" class="form-input" min="0" step="0.01" value="' + (pd ? (pd.priceCents / 100).toFixed(2) : '') + '" required></div>' +
      '<div class="book-field" id="pdfVisitCountWrap"><label class="form-label">Visit Count</label><input type="number" id="pdfVisitCount" class="form-input" min="1" value="' + (pd && pd.visitCount ? pd.visitCount : '') + '" placeholder="Unlimited">' +
      '<div class="book-field-hint">Leave blank for unlimited visits</div></div>' +
      '<div class="book-field"><label class="form-label">Validity (days)</label><input type="number" id="pdfValidityDays" class="form-input" min="1" value="' + (pd && pd.validityDays ? pd.validityDays : '') + '" placeholder="No limit">' +
      '<div class="book-field-hint">Days from activation until expiry</div></div>' +
      '<div class="book-field"><label class="form-label">Activation</label><select id="pdfActivation" class="form-input">' + activationOpts + '</select></div>' +
      '</div></div>' +

      // ── Options ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Options</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Priority</label><select id="pdfPriority" class="form-input">' + priorityOpts + '</select>' +
      '<div class="book-field-hint">Higher priority passes are auto-applied first</div></div>' +
      '<div class="book-field"><label class="form-label">Sort Order</label><input type="number" id="pdfSortOrder" class="form-input" min="0" value="' + (pd ? pd.sortOrder || 0 : 0) + '"></div>' +
      '<div class="book-field"><label class="form-label">Online Purchase</label><select id="pdfOnline" class="form-input"><option value="true"' + (pd && pd.onlinePurchasable === false ? '' : ' selected') + '>Yes</option><option value="false"' + (pd && pd.onlinePurchasable === false ? ' selected' : '') + '>No</option></select></div>' +
      '<div class="book-field"><label class="form-label">Intro Only</label><select id="pdfIntroOnly" class="form-input"><option value="false"' + (pd && pd.introOnly ? '' : ' selected') + '>No</option><option value="true"' + (pd && pd.introOnly ? ' selected' : '') + '>Yes</option></select></div>' +
      '</div></div>' +

      // ── Auto-Renew ──
      '<div class="book-form-section" id="pdfRenewFields">' +
      '<div class="book-form-section-title">Auto-Renew</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Auto-Renew</label><select id="pdfAutoRenew" class="form-input" onchange="window._passToggleFields()"><option value="false"' + (pd && pd.autoRenew ? '' : ' selected') + '>No</option><option value="true"' + (pd && pd.autoRenew ? ' selected' : '') + '>Yes</option></select></div>' +
      '<div class="book-field" id="pdfRenewFreqWrap"' + (pd && pd.autoRenew ? '' : ' style="display:none;"') + '><label class="form-label">Frequency</label><select id="pdfRenewFreq" class="form-input">' + renewOpts + '</select></div>' +
      '</div></div>' +

      // ── Class Scope ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Class Scope</div>' +
      '<div class="book-field-hint" style="margin-bottom:0.75rem;">Leave all unchecked to allow this pass for any class.</div>' +
      '<div style="max-height:200px;overflow-y:auto;padding:4px 0;">' +
      (classScopeHtml || '<p style="color:var(--warm-gray);text-align:center;">No active classes.</p>') +
      '</div></div>' +

      // ── Actions ──
      '<div class="book-form-actions">' +
      '<button class="btn btn-primary" onclick="window._passSave(\'' + (passDefId || '') + '\')">Save Pass Definition</button>' +
      '<button class="btn" onclick="window._passBackToList()">Cancel</button>' +
      '</div></form>';

    content.innerHTML = html;
    window._passToggleFields();
  }

  // Sync pass definition to public path for storefront access.
  // Only active + onlinePurchasable defs are published; others are removed.
  async function syncPassDefToPublic(passDefId, data) {
    var pubRef = MastDB._ref('public/passDefinitions/' + passDefId);
    if (data.status === 'active' && data.onlinePurchasable) {
      await pubRef.set({
        name: data.name,
        description: data.description || null,
        type: data.type,
        priceCents: data.priceCents,
        visitCount: data.visitCount || null,
        validityDays: data.validityDays || null,
        allowedClassIds: data.allowedClassIds || null,
        allowedCategories: data.allowedCategories || null,
        introOnly: data.introOnly || false,
        sortOrder: data.sortOrder || 0,
        updatedAt: data.updatedAt
      });
    } else {
      await pubRef.remove();
    }
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
      // Dual-write to public path for storefront access
      await syncPassDefToPublic(passDefId, data);
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
  window._bookViewClass = function(id) { loadClassDetail(id); };
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
  window._bookCancelEnrollment = async function(id) {
    if (!confirm('Cancel this enrollment?')) return;
    // Get enrollment to check if waitlisted (for renumbering)
    try {
      var snap = await MastDB.enrollments.get(id);
      var enrollment = snap.val();
      await updateEnrollmentStatus(id, 'cancelled');
      if (enrollment && enrollment.status === 'waitlisted') {
        // Decrement waitlist counter
        var isSeries = enrollment.enrollmentType === 'series';
        if (isSeries) {
          await MastDB.classes.ref(enrollment.classId + '/seriesWaitlisted').transaction(function(c) { return Math.max(0, (c || 0) - 1); });
        } else if (enrollment.sessionId) {
          await adjustSessionCount(enrollment.sessionId, 'waitlisted', -1);
        }
        await renumberWaitlist(enrollment.classId, enrollment.sessionId, isSeries);
      }
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };
  window._bookConfirmEnrollment = function(id) { updateEnrollmentStatus(id, 'confirmed'); };

  window._bookPromoteWaitlist = async function(enrollmentId) {
    try {
      var snap = await MastDB.enrollments.get(enrollmentId);
      var enrollment = snap.val();
      if (!enrollment || enrollment.status !== 'waitlisted') {
        MastAdmin.showToast('Enrollment not found or not waitlisted', true);
        return;
      }

      // Check capacity
      var sessionId = enrollment.sessionId;
      var classId = enrollment.classId;
      var isSeries = enrollment.enrollmentType === 'series';

      if (isSeries) {
        var clsSnap = await MastDB.classes.get(classId);
        var cls = clsSnap.val();
        if (cls && (cls.seriesEnrolled || 0) >= (cls.capacity || 0)) {
          MastAdmin.showToast('No series spots available. Increase capacity first.', true);
          return;
        }
        // Increment series enrolled, decrement series waitlisted
        await MastDB.classes.ref(classId + '/seriesEnrolled').transaction(function(c) { return (c || 0) + 1; });
        await MastDB.classes.ref(classId + '/seriesWaitlisted').transaction(function(c) { return Math.max(0, (c || 0) - 1); });
      } else {
        if (sessionId) {
          var sessSnap = await MastDB.classSessions.get(sessionId);
          var sess = sessSnap.val();
          if (sess && (sess.enrolled || 0) >= (sess.capacity || 0)) {
            MastAdmin.showToast('No spots available in this session. Increase capacity first.', true);
            return;
          }
          await adjustSessionCount(sessionId, 'enrolled', 1);
          await adjustSessionCount(sessionId, 'waitlisted', -1);
        }
      }

      // Update enrollment to confirmed
      await MastDB.enrollments.update(enrollmentId, {
        status: 'confirmed',
        waitlistPosition: null,
        promotedAt: new Date().toISOString()
      });

      // Renumber remaining waitlisted enrollments
      await renumberWaitlist(classId, sessionId, isSeries);

      MastAdmin.showToast('Promoted to confirmed');
      var classFilter = (document.getElementById('enrollFilterClass') || {}).value;
      loadEnrollments(null, classFilter);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  async function renumberWaitlist(classId, sessionId, isSeries) {
    try {
      var snap;
      if (isSeries) {
        snap = await MastDB.enrollments.byClass(classId);
      } else if (sessionId) {
        snap = await MastDB.enrollments.bySession(sessionId);
      } else {
        return;
      }
      var data = snap.val() || {};
      var waitlisted = Object.keys(data).map(function(id) {
        var e = data[id]; e._id = id; return e;
      }).filter(function(e) {
        if (e.status !== 'waitlisted') return false;
        if (isSeries) return e.enrollmentType === 'series' && e.classId === classId;
        return true;
      }).sort(function(a, b) {
        return (a.waitlistPosition || 999) - (b.waitlistPosition || 999);
      });

      var updates = {};
      waitlisted.forEach(function(e, i) {
        if (e.waitlistPosition !== i + 1) {
          updates[e._id + '/waitlistPosition'] = i + 1;
        }
      });
      if (Object.keys(updates).length > 0) {
        await MastDB.enrollments.ref().update(updates);
      }
    } catch (err) {
      console.warn('[Book] Waitlist renumbering failed:', err);
    }
  }

  window._enrollFilterStatus = function() { renderEnrollmentList(); };
  window._enrollFilterClass = function() {
    var classFilter = document.getElementById('enrollFilterClass').value;
    loadEnrollments(null, classFilter);
  };

  window._bookToggleSeriesFields = function() {
    var type = (document.getElementById('bcfType') || {}).value;
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

  window._bookToggleMaterialsCost = function() {
    var included = (document.getElementById('bcfMaterials') || {}).value === 'true';
    var wrap = document.getElementById('bcfMaterialsCostWrap');
    if (wrap) wrap.style.display = included ? 'none' : '';
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
  // Auto-Cancellation Logic
  // ============================================================

  async function checkAutoCancellation() {
    MastAdmin.showToast('Checking for under-enrolled classes...');
    var today = new Date();
    var flagged = [];

    // Filter classes with minEnrollment set
    var eligibleClasses = classesData.filter(function(c) {
      return c.status === 'active' && c.minEnrollment && c.minEnrollment > 0;
    });

    if (eligibleClasses.length === 0) {
      MastAdmin.showToast('No classes with minimum enrollment requirements found.');
      return;
    }

    for (var i = 0; i < eligibleClasses.length; i++) {
      var cls = eligibleClasses[i];
      var leadDays = cls.cancellationLeadDays || 2;

      try {
        var sessSnap = await MastDB.classSessions.byClass(cls.id);
        var sessData = sessSnap.val() || {};
        var sessionIds = Object.keys(sessData);

        for (var j = 0; j < sessionIds.length; j++) {
          var sid = sessionIds[j];
          var session = sessData[sid];
          if (session.status !== 'scheduled') continue;

          // Parse session date
          var parts = session.date.split('-');
          var sessionDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
          var diffMs = sessionDate.getTime() - today.getTime();
          var daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

          // Check if within cancellation lead window
          if (daysUntil >= 0 && daysUntil <= leadDays) {
            var totalEnrolled = (cls.seriesEnrolled || 0) + (session.enrolled || 0);
            if (totalEnrolled < cls.minEnrollment) {
              flagged.push({
                classId: cls.id,
                className: cls.name,
                sessionId: sid,
                sessionDate: session.date,
                sessionTime: session.startTime,
                enrolled: totalEnrolled,
                minRequired: cls.minEnrollment,
                daysUntil: daysUntil
              });
            }
          }
        }
      } catch (err) {
        console.error('[book] Error checking class ' + cls.id + ':', err);
      }
    }

    if (flagged.length === 0) {
      MastAdmin.showToast('All classes meet minimum enrollment requirements.');
      return;
    }

    // Show confirmation dialog
    var msg = 'The following sessions are under-enrolled and within the cancellation window:\n\n';
    flagged.forEach(function(f) {
      msg += '- ' + f.className + ' (' + f.sessionDate + '): ' + f.enrolled + '/' + f.minRequired + ' enrolled, ' + f.daysUntil + ' day(s) away\n';
    });
    msg += '\nCancel these sessions and notify enrolled students?';

    if (!confirm(msg)) return;

    // Execute cancellation for each flagged session
    var totalAffected = 0;
    for (var k = 0; k < flagged.length; k++) {
      var f = flagged[k];
      try {
        var affected = await executeCancellation(f.sessionId, f.classId);
        totalAffected += affected.length;
      } catch (err) {
        console.error('[book] Failed to cancel session ' + f.sessionId + ':', err);
        MastAdmin.showToast('Failed to cancel ' + f.className + ' session: ' + err.message, true);
      }
    }

    MastAdmin.showToast('Cancelled ' + flagged.length + ' session(s), ' + totalAffected + ' enrollment(s) affected.');
    // Refresh class list
    loadClasses();
  }

  async function executeCancellation(sessionId, classId) {
    var cls = classesData.find(function(c) { return c.id === classId; }) || {};
    var affected = [];

    // 1. Cancel the session
    await MastDB.classSessions.update(sessionId, {
      status: 'cancelled',
      cancelReason: 'Insufficient enrollment (auto-check)',
      cancelledAt: new Date().toISOString()
    });

    // 2. Fetch all enrollments for this session from public/enrollments
    var db = firebase.app().database();
    var enrollSnap = await db.ref(TENANT_ID + '/public/enrollments')
      .orderByChild('sessionId').equalTo(sessionId).once('value');
    var enrollData = enrollSnap.val() || {};
    var enrollIds = Object.keys(enrollData);

    // 3. Bulk-cancel confirmed/waitlisted enrollments
    var updates = {};
    var now = new Date().toISOString();
    enrollIds.forEach(function(eid) {
      var e = enrollData[eid];
      if (e.status === 'confirmed' || e.status === 'waitlisted') {
        updates[TENANT_ID + '/public/enrollments/' + eid + '/status'] = 'cancelled_insufficient_enrollment';
        updates[TENANT_ID + '/public/enrollments/' + eid + '/cancelledAt'] = now;
        updates[TENANT_ID + '/public/enrollments/' + eid + '/cancelReason'] = 'Class cancelled: minimum enrollment not met';
        affected.push({
          enrollmentId: eid,
          studentUid: e.studentUid,
          studentEmail: e.studentEmail,
          studentName: e.studentName,
          pricePaid: e.pricePaid || 0,
          enrollmentType: e.enrollmentType,
          orderId: e.orderId || null
        });
      }
    });

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
    }

    // 4. Create wallet credits for affected students
    for (var i = 0; i < affected.length; i++) {
      var student = affected[i];
      if (!student.studentUid) continue;

      var creditAmount = 0;
      if (student.enrollmentType === 'series' && cls.seriesInfo && cls.seriesInfo.seriesPriceCents && cls.seriesInfo.totalSessions) {
        creditAmount = Math.round(cls.seriesInfo.seriesPriceCents / cls.seriesInfo.totalSessions);
      } else {
        creditAmount = student.pricePaid || 0;
      }

      if (creditAmount > 0) {
        var creditRef = db.ref(TENANT_ID + '/public/accounts/' + student.studentUid + '/wallet/credits').push();
        await creditRef.set({
          amountCents: creditAmount,
          source: 'cancellation',
          sourceId: student.enrollmentId,
          sourceDetail: 'Class cancelled: ' + (cls.name || 'Unknown') + ' (' + sessionId + ')',
          status: 'active',
          createdAt: now,
          usedAt: null,
          usedOrderId: null,
          expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString() // 6 months
        });
      }
    }

    return affected;
  }

  window._bookCheckCancellations = function() { checkAutoCancellation(); };

  // ============================================================
  // Session Operations — Startup Checklist & Completion Report
  // ============================================================

  var INCIDENT_TYPES = ['equipment_damage', 'safety', 'conduct', 'medical'];
  var INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'];
  var INCIDENT_TYPE_LABELS = { equipment_damage: 'Equipment Damage', safety: 'Safety', conduct: 'Conduct', medical: 'Medical' };
  var SEVERITY_COLORS = { low: '#4DB6AC', medium: '#FFD54F', high: '#FF8A65', critical: '#EF9A9A' };
  var opsSessionId = null;
  var opsClassId = null;

  window._bookBackFromOps = function() {
    if (opsClassId) loadClassDetail(opsClassId);
    else { loadClasses(); switchSubTab('classes'); }
  };

  // --- Startup Checklist ---

  window._bookSessionChecklist = async function(sessionId, classId) {
    opsSessionId = sessionId;
    opsClassId = classId;
    hideAllViews();
    document.getElementById('bookSessionOpsView').style.display = '';

    var content = document.getElementById('sessionOpsContent');
    content.innerHTML = LOADING_HTML;

    try {
      var [sessSnap, clsSnap, enrollSnap, logSnap] = await Promise.all([
        MastDB.classSessions.get(sessionId),
        MastDB.classes.get(classId),
        MastDB.enrollments.bySession(sessionId),
        MastDB.sessionLogs.startup(sessionId).once('value')
      ]);

      var session = sessSnap.val() || {};
      var cls = clsSnap.val() || {};
      var enrollments = enrollSnap.val() || {};
      var saved = logSnap.val() || {};

      document.getElementById('sessionOpsTitle').textContent =
        'Startup Checklist — ' + (cls.name || 'Class') + ' (' + formatDate(session.date) + ')';

      // Get confirmed enrollments
      var students = Object.keys(enrollments).map(function(id) {
        var e = enrollments[id]; e._id = id; return e;
      }).filter(function(e) { return e.status === 'confirmed'; });

      // Get assigned resources
      var resources = [];
      if (session.resourceId) {
        var resSnap = await MastDB.resources.get(session.resourceId);
        var res = resSnap.val();
        if (res) { res._id = session.resourceId; resources.push(res); }
      }

      var html = '<form id="startupChecklistForm">';

      // ── Student Roster ──
      html += '<div class="book-form-section">';
      html += '<div class="book-form-section-title">Student Roster <span style="font-weight:400;color:var(--warm-gray);text-transform:none;letter-spacing:0;">(' + students.length + ')</span></div>';
      if (students.length === 0) {
        html += '<p style="color:var(--warm-gray);text-align:center;">No confirmed enrollments.</p>';
      } else {
        html += '<table class="data-table"><thead><tr><th>Student</th><th>Check-in</th><th>Waiver</th></tr></thead><tbody>';
        students.forEach(function(s) {
          var savedStudent = (saved.students && saved.students[s._id]) || {};
          var checkedIn = savedStudent.checkedIn || false;
          var waiverStatus = savedStudent.waiverStatus || 'na';
          var waiverWarning = (waiverStatus === 'missing' || waiverStatus === 'expired')
            ? ' <span style="color:' + WARNING_COLOR + ';font-size:0.75rem;">&#9888; ' + waiverStatus + '</span>' : '';

          html += '<tr>' +
            '<td><strong>' + esc(s.studentName || s.customerName || '—') + '</strong></td>' +
            '<td><label class="book-check"><input type="checkbox" name="checkin_' + esc(s._id) + '" ' + (checkedIn ? 'checked' : '') + '> Checked in</label></td>' +
            '<td><select name="waiver_' + esc(s._id) + '" class="form-input" style="width:auto;padding:6px 10px;">' +
            '<option value="na"' + (waiverStatus === 'na' ? ' selected' : '') + '>N/A</option>' +
            '<option value="signed"' + (waiverStatus === 'signed' ? ' selected' : '') + '>Signed</option>' +
            '<option value="missing"' + (waiverStatus === 'missing' ? ' selected' : '') + '>Missing</option>' +
            '<option value="expired"' + (waiverStatus === 'expired' ? ' selected' : '') + '>Expired</option>' +
            '</select>' + waiverWarning + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      // ── Equipment ──
      html += '<div class="book-form-section">';
      html += '<div class="book-form-section-title">Equipment &amp; Resources</div>';
      if (resources.length === 0) {
        html += '<p style="color:var(--warm-gray);text-align:center;">No resources assigned.</p>';
      } else {
        resources.forEach(function(r) {
          var savedEquip = (saved.equipment && saved.equipment[r._id]) || {};
          html += '<div style="' + CARD_STYLE + 'margin-bottom:8px;">' +
            '<strong>' + esc(r.name) + '</strong> <span style="color:var(--warm-gray);font-size:0.8rem;">(' + esc(r.type) + ')</span>' +
            '<div style="display:flex;gap:12px;margin-top:8px;align-items:center;">' +
            '<select name="equip_' + esc(r._id) + '" class="form-input" style="width:auto;padding:6px 10px;">' +
            '<option value="good"' + (savedEquip.condition === 'good' ? ' selected' : '') + '>Good</option>' +
            '<option value="needs_attention"' + ((savedEquip.condition === 'needs_attention') ? ' selected' : '') + '>Needs Attention</option>' +
            '<option value="out_of_service"' + ((savedEquip.condition === 'out_of_service') ? ' selected' : '') + '>Out of Service</option>' +
            '</select>' +
            '<input type="text" name="equip_notes_' + esc(r._id) + '" class="form-input" placeholder="Notes..." value="' + esc(savedEquip.notes || '') + '" style="flex:1;">' +
            '</div></div>';
        });
      }
      html += '</div>';

      // ── Room / Space ──
      html += '<div class="book-form-section">';
      html += '<div class="book-form-section-title">Room / Space</div>';
      html += '<label class="book-check"><input type="checkbox" name="roomConfirmed" ' + (saved.roomConfirmed ? 'checked' : '') + '> Room / space confirmed ready</label>';
      html += '</div>';

      // ── Instructor Notes ──
      html += '<div class="book-form-section">';
      html += '<div class="book-form-section-title">Instructor Notes</div>';
      html += '<textarea name="instructorNotes" class="form-input" rows="3" placeholder="Any notes for this session...">' + esc(saved.instructorNotes || '') + '</textarea>';
      html += '</div>';

      // Buttons
      html += '<div class="book-form-actions">' +
        '<button type="button" class="btn btn-primary" onclick="window._bookSaveChecklist(\'' + esc(sessionId) + '\', false)">Save Draft</button>' +
        '<button type="button" class="btn btn-primary" style="background:' + SUCCESS_COLOR + ';" onclick="window._bookSaveChecklist(\'' + esc(sessionId) + '\', true)">Complete Checklist</button>' +
        '</div>';

      if (saved.completedAt) {
        html += '<p style="color:' + SUCCESS_COLOR + ';margin-top:12px;font-size:0.85rem;">&#10003; Checklist completed ' + new Date(saved.completedAt).toLocaleString() + '</p>';
      }

      html += '</form>';
      content.innerHTML = html;
    } catch (err) {
      console.error('[book] Failed to load checklist:', err);
      content.innerHTML = '<p style="color:' + DANGER_COLOR + ';">Failed to load checklist: ' + esc(err.message) + '</p>';
    }
  };

  window._bookSaveChecklist = async function(sessionId, markComplete) {
    var form = document.getElementById('startupChecklistForm');
    if (!form) return;

    var data = { students: {}, equipment: {} };

    // Collect student check-ins and waivers
    form.querySelectorAll('input[name^="checkin_"]').forEach(function(el) {
      var enrollId = el.name.replace('checkin_', '');
      if (!data.students[enrollId]) data.students[enrollId] = {};
      data.students[enrollId].checkedIn = el.checked;
    });
    form.querySelectorAll('select[name^="waiver_"]').forEach(function(el) {
      var enrollId = el.name.replace('waiver_', '');
      if (!data.students[enrollId]) data.students[enrollId] = {};
      data.students[enrollId].waiverStatus = el.value;
    });

    // Collect equipment
    form.querySelectorAll('select[name^="equip_"]').forEach(function(el) {
      if (el.name.indexOf('equip_notes_') === 0) return;
      var resId = el.name.replace('equip_', '');
      if (!data.equipment[resId]) data.equipment[resId] = {};
      data.equipment[resId].condition = el.value;
    });
    form.querySelectorAll('input[name^="equip_notes_"]').forEach(function(el) {
      var resId = el.name.replace('equip_notes_', '');
      if (!data.equipment[resId]) data.equipment[resId] = {};
      data.equipment[resId].notes = el.value;
    });

    data.roomConfirmed = form.querySelector('input[name="roomConfirmed"]').checked;
    data.instructorNotes = form.querySelector('textarea[name="instructorNotes"]').value;

    if (markComplete) {
      data.completedAt = new Date().toISOString();
      data.completedBy = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
    }

    try {
      await MastDB.sessionLogs.startup(sessionId).set(data);
      MastAdmin.showToast(markComplete ? 'Checklist completed' : 'Checklist saved');
      if (markComplete) window._bookSessionChecklist(sessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed to save: ' + err.message, true);
    }
  };

  // --- Completion Report ---

  window._bookSessionReport = async function(sessionId, classId) {
    opsSessionId = sessionId;
    opsClassId = classId;
    hideAllViews();
    document.getElementById('bookSessionOpsView').style.display = '';

    var content = document.getElementById('sessionOpsContent');
    content.innerHTML = LOADING_HTML;

    try {
      var [sessSnap, clsSnap, enrollSnap, logSnap, startupSnap] = await Promise.all([
        MastDB.classSessions.get(sessionId),
        MastDB.classes.get(classId),
        MastDB.enrollments.bySession(sessionId),
        MastDB.sessionLogs.completion(sessionId).once('value'),
        MastDB.sessionLogs.startup(sessionId).once('value')
      ]);

      var session = sessSnap.val() || {};
      var cls = clsSnap.val() || {};
      var enrollments = enrollSnap.val() || {};
      var saved = logSnap.val() || {};
      var startup = startupSnap.val() || {};

      document.getElementById('sessionOpsTitle').textContent =
        'Completion Report — ' + (cls.name || 'Class') + ' (' + formatDate(session.date) + ')';

      var students = Object.keys(enrollments).map(function(id) {
        var e = enrollments[id]; e._id = id; return e;
      }).filter(function(e) { return e.status === 'confirmed' || e.status === 'completed' || e.status === 'no-show'; });

      // Get resources
      var resources = [];
      if (session.resourceId) {
        var resSnap = await MastDB.resources.get(session.resourceId);
        var res = resSnap.val();
        if (res) { res._id = session.resourceId; resources.push(res); }
      }

      // Load existing incidents
      var incSnap = await MastDB.sessionLogs.incidents(sessionId).once('value');
      var existingIncidents = [];
      var incData = incSnap.val() || {};
      Object.keys(incData).forEach(function(incId) {
        var inc = incData[incId]; inc._id = incId;
        existingIncidents.push(inc);
      });

      var html = '<form id="completionReportForm">';

      // ── Attendance ──
      html += '<div class="book-form-section">';
      html += '<div class="book-form-section-title">Attendance</div>';
      if (students.length === 0) {
        html += '<p style="color:var(--warm-gray);text-align:center;">No enrollments to finalize.</p>';
      } else {
        html += '<table class="data-table"><thead><tr><th>Student</th><th>Check-in</th><th>Attendance</th></tr></thead><tbody>';
        students.forEach(function(s) {
          var savedAtt = (saved.attendance && saved.attendance[s._id]) || {};
          var attStatus = savedAtt.status || (s.status === 'no-show' ? 'no-show' : 'completed');
          var checkedIn = startup.students && startup.students[s._id] && startup.students[s._id].checkedIn;
          var checkInLabel = checkedIn ? '<span style="color:' + SUCCESS_COLOR + ';">&#10003; Checked in</span>' : '<span style="color:var(--warm-gray);">—</span>';

          html += '<tr><td><strong>' + esc(s.studentName || s.customerName || '—') + '</strong></td>' +
            '<td>' + checkInLabel + '</td>' +
            '<td><select name="att_' + esc(s._id) + '" class="form-input" style="width:auto;padding:6px 10px;">' +
            '<option value="completed"' + (attStatus === 'completed' ? ' selected' : '') + '>Completed</option>' +
            '<option value="absent"' + (attStatus === 'absent' ? ' selected' : '') + '>Absent</option>' +
            '<option value="no-show"' + (attStatus === 'no-show' ? ' selected' : '') + '>No-Show</option>' +
            '</select></td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      // ── Equipment Post-Check ──
      html += '<div class="book-form-section">';
      html += '<div class="book-form-section-title">Equipment Post-Check</div>';
      if (resources.length === 0) {
        html += '<p style="color:var(--warm-gray);text-align:center;">No resources assigned.</p>';
      } else {
        resources.forEach(function(r) {
          var savedEquip = (saved.equipment && saved.equipment[r._id]) || {};
          html += '<div style="' + CARD_STYLE + 'margin-bottom:8px;">' +
            '<strong>' + esc(r.name) + '</strong>' +
            '<div style="display:flex;gap:12px;margin-top:8px;align-items:center;">' +
            '<select name="postequip_' + esc(r._id) + '" class="form-input" style="width:auto;padding:6px 10px;">' +
            '<option value="good"' + (savedEquip.postCondition === 'good' ? ' selected' : '') + '>Good</option>' +
            '<option value="needs_attention"' + ((savedEquip.postCondition === 'needs_attention') ? ' selected' : '') + '>Needs Attention</option>' +
            '<option value="out_of_service"' + ((savedEquip.postCondition === 'out_of_service') ? ' selected' : '') + '>Out of Service</option>' +
            '</select>' +
            '<input type="text" name="postequip_notes_' + esc(r._id) + '" class="form-input" placeholder="Notes..." value="' + esc(savedEquip.notes || '') + '" style="flex:1;">' +
            '</div></div>';
        });
      }
      html += '</div>';

      // ── Incidents ──
      html += '<div class="book-form-section">';
      html += '<div class="book-form-section-title">Incidents</div>';
      html += '<div id="incidentsList">';
      if (existingIncidents.length > 0) {
        existingIncidents.forEach(function(inc) {
          var sevColor = SEVERITY_COLORS[inc.severity] || '#BDBDBD';
          html += '<div style="' + CARD_STYLE + 'margin-bottom:8px;border-left:3px solid ' + sevColor + ';">' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
            '<span style="' + badgeStyle(SEVERITY_BADGE_COLORS, inc.severity) + '">' + esc(inc.severity) + '</span>' +
            '<span style="font-weight:500;font-size:0.9rem;">' + esc(INCIDENT_TYPE_LABELS[inc.type] || inc.type) + '</span>' +
            '<span style="color:var(--warm-gray);font-size:0.8rem;margin-left:auto;">' + esc(inc.followUpStatus || 'open') + '</span>' +
            '</div>' +
            '<p style="margin:6px 0 0;color:var(--warm-gray);font-size:0.85rem;">' + esc(inc.description) + '</p>' +
            '</div>';
        });
      } else {
        html += '<p style="color:var(--warm-gray);font-size:0.85rem;">No incidents reported.</p>';
      }
      html += '</div>';

      html += '<div id="newIncidentForm" class="book-form-section" style="display:none;margin-top:8px;">' +
        '<div class="book-form-section-title">New Incident</div>' +
        '<div class="book-responsive-grid" style="margin-bottom:0.75rem;">' +
        '<div class="book-field"><label class="form-label">Type</label><select id="incType" class="form-input">' +
        INCIDENT_TYPES.map(function(t) { return '<option value="' + t + '">' + esc(INCIDENT_TYPE_LABELS[t] || t) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="book-field"><label class="form-label">Severity</label><select id="incSeverity" class="form-input">' +
        INCIDENT_SEVERITIES.map(function(s) { return '<option value="' + s + '">' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>'; }).join('') +
        '</select></div>' +
        '</div>' +
        '<div class="book-field"><label class="form-label">Description</label>' +
        '<textarea id="incDescription" class="form-input" rows="2" placeholder="Describe what happened..."></textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:0.75rem;">' +
        '<button type="button" class="btn btn-primary btn-sm" onclick="window._bookSaveIncident(\'' + esc(sessionId) + '\')">Save Incident</button>' +
        '<button type="button" class="btn btn-sm" onclick="document.getElementById(\'newIncidentForm\').style.display=\'none\'">Cancel</button>' +
        '</div></div>';
      html += '<button type="button" class="btn btn-sm" onclick="document.getElementById(\'newIncidentForm\').style.display=\'\'" style="margin-top:8px;">+ Add Incident</button>';
      html += '</div>';

      // ── Session Notes ──
      html += '<div class="book-form-section">';
      html += '<div class="book-form-section-title">Session Notes</div>';
      html += '<textarea name="completionNotes" class="form-input" rows="3" placeholder="Overall session notes...">' + esc(saved.notes || '') + '</textarea>';
      html += '</div>';

      // Submit
      html += '<div class="book-form-actions">' +
        '<button type="button" class="btn btn-primary" onclick="window._bookSaveReport(\'' + esc(sessionId) + '\', false)">Save Draft</button>' +
        '<button type="button" class="btn btn-primary" style="background:' + SUCCESS_COLOR + ';" onclick="window._bookSaveReport(\'' + esc(sessionId) + '\', true)">Submit Report</button>' +
        '</div>';

      if (saved.completedAt) {
        html += '<p style="color:' + SUCCESS_COLOR + ';margin-top:12px;font-size:0.85rem;">&#10003; Report submitted ' + new Date(saved.completedAt).toLocaleString() + '</p>';
      }

      html += '</form>';
      content.innerHTML = html;
    } catch (err) {
      console.error('[book] Failed to load report:', err);
      content.innerHTML = '<p style="color:' + DANGER_COLOR + ';">Failed to load report: ' + esc(err.message) + '</p>';
    }
  };

  window._bookSaveIncident = async function(sessionId) {
    var type = document.getElementById('incType').value;
    var severity = document.getElementById('incSeverity').value;
    var description = document.getElementById('incDescription').value.trim();
    if (!description) { MastAdmin.showToast('Incident description required', true); return; }

    try {
      var incId = MastDB.sessionLogs.newIncidentKey(sessionId);
      await MastDB.sessionLogs.incidents(sessionId, incId).set({
        type: type,
        severity: severity,
        description: description,
        studentUid: null,
        followUpStatus: 'open',
        createdAt: new Date().toISOString()
      });
      MastAdmin.showToast('Incident saved');
      // Reload the report to show new incident
      window._bookSessionReport(sessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  window._bookSaveReport = async function(sessionId, submit) {
    var form = document.getElementById('completionReportForm');
    if (!form) return;

    var data = { attendance: {}, equipment: {} };

    // Collect attendance
    form.querySelectorAll('select[name^="att_"]').forEach(function(el) {
      var enrollId = el.name.replace('att_', '');
      data.attendance[enrollId] = { status: el.value };
    });

    // Check all attendance filled (RULE: session can't complete without attendance)
    if (submit) {
      var hasAllAttendance = Object.keys(data.attendance).length > 0;
      if (!hasAllAttendance) {
        MastAdmin.showToast('No enrollments to finalize attendance', true);
        return;
      }
    }

    // Collect equipment post-check
    form.querySelectorAll('select[name^="postequip_"]').forEach(function(el) {
      if (el.name.indexOf('postequip_notes_') === 0) return;
      var resId = el.name.replace('postequip_', '');
      if (!data.equipment[resId]) data.equipment[resId] = {};
      data.equipment[resId].postCondition = el.value;
    });
    form.querySelectorAll('input[name^="postequip_notes_"]').forEach(function(el) {
      var resId = el.name.replace('postequip_notes_', '');
      if (!data.equipment[resId]) data.equipment[resId] = {};
      data.equipment[resId].notes = el.value;
    });

    data.notes = form.querySelector('textarea[name="completionNotes"]').value;

    if (submit) {
      data.completedAt = new Date().toISOString();
      data.completedBy = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
    }

    try {
      await MastDB.sessionLogs.completion(sessionId).set(data);

      if (submit) {
        // Update enrollment statuses based on attendance
        for (var enrollId in data.attendance) {
          var attStatus = data.attendance[enrollId].status;
          if (attStatus === 'completed' || attStatus === 'no-show' || attStatus === 'absent') {
            await MastDB.enrollments.update(enrollId, { status: attStatus });
          }
        }
        // Mark session as completed
        await MastDB.classSessions.update(sessionId, {
          status: 'completed',
          completedAt: new Date().toISOString()
        });
        MastAdmin.showToast('Session completed — attendance finalized');
      } else {
        MastAdmin.showToast('Report saved');
      }

      window._bookSessionReport(sessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed to save: ' + err.message, true);
    }
  };

  // ============================================================
  // Calendar View
  // ============================================================

  var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOW_HEADERS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  async function loadCalendar() {
    var grid = document.getElementById('bookCalendarGrid');
    if (!grid) return;
    if (!calendarLoaded) {
      grid.innerHTML = LOADING_HTML;
      try {
        var [sessSnap, clsSnap] = await Promise.all([
          MastDB.classSessions.list(2000),
          MastDB.classes.list(200)
        ]);
        var sessData = sessSnap.val() || {};
        calendarSessions = Object.keys(sessData).map(function(id) { var s = sessData[id]; s.id = id; return s; });
        var clsData = clsSnap.val() || {};
        calendarClassesMap = {};
        Object.keys(clsData).forEach(function(id) { calendarClassesMap[id] = clsData[id]; });
        calendarLoaded = true;
      } catch (err) {
        grid.innerHTML = '<p style="color:' + DANGER_COLOR + ';padding:2rem;">Failed to load calendar data.</p>';
        return;
      }
    }
    renderCalendar();
  }

  function renderCalendar() {
    var grid = document.getElementById('bookCalendarGrid');
    var title = document.getElementById('calendarTitle');
    if (!grid) return;
    title.textContent = MONTH_NAMES[calendarMonth] + ' ' + calendarYear;

    var firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
    var daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    var today = todayStr();

    // Group sessions by date
    var sessionsByDate = {};
    calendarSessions.forEach(function(s) {
      if (!s.date) return;
      var parts = s.date.split('-');
      if (parseInt(parts[0]) === calendarYear && parseInt(parts[1]) - 1 === calendarMonth) {
        if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
        sessionsByDate[s.date].push(s);
      }
    });

    var STATUS_DOT = { scheduled: '#64B5F6', completed: SUCCESS_COLOR, cancelled: DANGER_COLOR };

    var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border-radius:8px;overflow:hidden;">';

    // Day-of-week headers
    DOW_HEADERS.forEach(function(d) {
      html += '<div style="background:var(--surface-dark);padding:8px 4px;text-align:center;font-size:0.75rem;font-weight:600;color:var(--warm-gray);text-transform:uppercase;">' + d + '</div>';
    });

    // Leading blank cells
    for (var b = 0; b < firstDay; b++) {
      html += '<div style="background:var(--surface-card);min-height:80px;padding:6px;"></div>';
    }

    // Day cells
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = calendarYear + '-' + String(calendarMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var isToday = dateStr === today;
      var isSelected = dateStr === selectedCalendarDay;
      var daySessions = sessionsByDate[dateStr] || [];

      var cellBg = isSelected ? 'rgba(196,133,60,0.15)' : 'var(--surface-card)';
      var borderStyle = isToday ? 'box-shadow:inset 0 0 0 2px var(--primary);' : '';

      html += '<div style="background:' + cellBg + ';min-height:80px;padding:6px;cursor:pointer;' + borderStyle + '" ' +
        'onclick="window._calSelectDay(\'' + dateStr + '\')" role="button" tabindex="0" ' +
        'onkeydown="if(event.key===\'Enter\')window._calSelectDay(\'' + dateStr + '\')">';

      html += '<div style="font-size:0.8rem;font-weight:' + (isToday ? '700' : '400') + ';color:' + (isToday ? 'var(--primary)' : 'var(--text)') + ';margin-bottom:4px;">' + d + '</div>';

      // Session dots (max 3 + overflow)
      var maxShow = 3;
      daySessions.sort(function(a, b) { return (a.startTime || '').localeCompare(b.startTime || ''); });
      for (var si = 0; si < Math.min(daySessions.length, maxShow); si++) {
        var sess = daySessions[si];
        var clsName = calendarClassesMap[sess.classId] ? calendarClassesMap[sess.classId].name : '';
        var abbr = clsName.length > 10 ? clsName.substring(0, 10) + '…' : clsName;
        var dotColor = STATUS_DOT[sess.status] || '#BDBDBD';
        html += '<div style="font-size:0.65rem;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:1px;">' +
          '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + dotColor + ';margin-right:3px;vertical-align:middle;"></span>' +
          '<span style="color:var(--warm-gray);">' + formatTime(sess.startTime) + '</span> ' +
          '<span style="color:var(--text);">' + esc(abbr) + '</span></div>';
      }
      if (daySessions.length > maxShow) {
        html += '<div style="font-size:0.65rem;color:var(--primary);">+' + (daySessions.length - maxShow) + ' more</div>';
      }

      html += '</div>';
    }

    // Trailing blank cells to fill last row
    var totalCells = firstDay + daysInMonth;
    var remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (var t = 0; t < remaining; t++) {
      html += '<div style="background:var(--surface-card);min-height:80px;padding:6px;"></div>';
    }

    html += '</div>';
    grid.innerHTML = html;

    // Render day detail if selected
    if (selectedCalendarDay) {
      renderCalendarDayDetail(selectedCalendarDay);
    } else {
      document.getElementById('bookCalendarDayDetail').style.display = 'none';
    }
  }

  function renderCalendarDayDetail(dateStr) {
    var panel = document.getElementById('bookCalendarDayDetail');
    if (!panel) return;

    var daySessions = calendarSessions.filter(function(s) { return s.date === dateStr; })
      .sort(function(a, b) { return (a.startTime || '').localeCompare(b.startTime || ''); });

    if (daySessions.length === 0) {
      panel.innerHTML = '<p style="' + EMPTY_STATE_STYLE + '">No sessions on ' + formatDate(dateStr) + '.</p>';
      panel.style.display = '';
      return;
    }

    var html = '<h3 style="margin:0 0 0.75rem;">Sessions — ' + formatDate(dateStr) + ' (' + daySessions.length + ')</h3>';
    html += '<table class="data-table"><thead><tr><th>Time</th><th>Class</th><th class="book-hide-narrow">Instructor</th><th>Status</th><th>Enrolled</th></tr></thead><tbody>';

    daySessions.forEach(function(s) {
      var clsName = calendarClassesMap[s.classId] ? calendarClassesMap[s.classId].name : s.classId;
      var cls = calendarClassesMap[s.classId] || {};
      html += '<tr style="cursor:pointer;" onclick="window._bookViewClass(\'' + esc(s.classId) + '\')">' +
        '<td>' + formatTime(s.startTime) + ' - ' + formatTime(s.endTime) + '</td>' +
        '<td><strong>' + esc(clsName) + '</strong></td>' +
        '<td class="book-hide-narrow">' + esc(s.instructorName || '—') + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, s.status) + '">' + esc(s.status) + '</span></td>' +
        '<td>' + (s.enrolled || 0) + ' / ' + (s.capacity || cls.capacity || '—') + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    panel.innerHTML = html;
    panel.style.display = '';
  }

  window._calPrev = function() { calendarMonth--; if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; } selectedCalendarDay = null; renderCalendar(); };
  window._calNext = function() { calendarMonth++; if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; } selectedCalendarDay = null; renderCalendar(); };
  window._calToday = function() { var d = new Date(); calendarYear = d.getFullYear(); calendarMonth = d.getMonth(); selectedCalendarDay = todayStr(); renderCalendar(); };
  window._calSelectDay = function(dateStr) { selectedCalendarDay = dateStr; renderCalendar(); };

  // ============================================================
  // Reports Dashboard
  // ============================================================

  async function loadReports() {
    var content = document.getElementById('bookReportsContent');
    if (!content) return;
    content.innerHTML = LOADING_HTML;

    try {
      var [sessSnap, clsSnap, enrollSnap, ordersSnap] = await Promise.all([
        MastDB.classSessions.list(2000),
        MastDB.classes.list(200),
        MastDB.enrollments.list(2000),
        MastDB.orders.list(500)
      ]);

      var sessions = [];
      var sessData = sessSnap.val() || {};
      Object.keys(sessData).forEach(function(id) { var s = sessData[id]; s.id = id; sessions.push(s); });

      var classes = {};
      var clsData = clsSnap.val() || {};
      Object.keys(clsData).forEach(function(id) { classes[id] = clsData[id]; classes[id].id = id; });

      var enrollments = [];
      var enrollData = enrollSnap.val() || {};
      Object.keys(enrollData).forEach(function(id) { var e = enrollData[id]; e.id = id; enrollments.push(e); });

      var orders = [];
      var ordData = ordersSnap.val() || {};
      Object.keys(ordData).forEach(function(id) { var o = ordData[id]; o.id = id; orders.push(o); });

      // Load session logs for completed sessions (attendance data)
      var completedSessionIds = sessions.filter(function(s) { return s.status === 'completed'; }).map(function(s) { return s.id; });
      var sessionLogs = {};
      // Load up to 50 most recent logs to avoid huge reads
      var logIds = completedSessionIds.slice(0, 50);
      for (var li = 0; li < logIds.length; li++) {
        try {
          var logSnap = await MastDB.sessionLogs.completion(logIds[li]).once('value');
          if (logSnap.val()) sessionLogs[logIds[li]] = logSnap.val();
        } catch (e) { /* skip */ }
      }

      // Load incidents
      var allIncidents = [];
      for (var ii = 0; ii < logIds.length; ii++) {
        try {
          var incSnap = await MastDB.sessionLogs.incidents(logIds[ii]).once('value');
          var incData = incSnap.val() || {};
          Object.keys(incData).forEach(function(incId) {
            var inc = incData[incId];
            inc._sessionId = logIds[ii];
            allIncidents.push(inc);
          });
        } catch (e) { /* skip */ }
      }

      renderReports(sessions, classes, enrollments, orders, sessionLogs, allIncidents);
      reportsLoaded = true;
    } catch (err) {
      console.error('[Book] Failed to load reports:', err);
      content.innerHTML = '<p style="color:' + DANGER_COLOR + ';padding:2rem;">Failed to load report data.</p>';
    }
  }

  function renderReports(sessions, classes, enrollments, orders, sessionLogs, allIncidents) {
    var content = document.getElementById('bookReportsContent');
    if (!content) return;

    // Date range filter
    var rangeVal = (document.getElementById('reportDateRange') || {}).value || '30';
    var cutoffDate = null;
    if (rangeVal !== 'all') {
      var d = new Date();
      d.setDate(d.getDate() - parseInt(rangeVal, 10));
      cutoffDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    var filteredSessions = cutoffDate ? sessions.filter(function(s) { return s.date >= cutoffDate; }) : sessions;
    var completedSessions = filteredSessions.filter(function(s) { return s.status === 'completed'; });
    var scheduledSessions = filteredSessions.filter(function(s) { return s.status === 'scheduled'; });

    // Attendance stats from session logs
    var attCompleted = 0, attAbsent = 0, attNoShow = 0;
    Object.keys(sessionLogs).forEach(function(sid) {
      var log = sessionLogs[sid];
      if (!log.attendance) return;
      // Check if session is in filtered range
      var sess = sessions.find(function(s) { return s.id === sid; });
      if (cutoffDate && sess && sess.date < cutoffDate) return;
      Object.keys(log.attendance).forEach(function(eid) {
        var st = log.attendance[eid].status;
        if (st === 'completed') attCompleted++;
        else if (st === 'absent') attAbsent++;
        else if (st === 'no-show') attNoShow++;
      });
    });
    var attTotal = attCompleted + attAbsent + attNoShow;
    var attRate = attTotal > 0 ? Math.round((attCompleted / attTotal) * 100) : 0;

    // Active enrollments
    var activeEnrollments = enrollments.filter(function(e) { return e.status === 'confirmed'; }).length;

    // Revenue from orders with class/pass items
    var revenue = 0;
    var filteredOrders = orders.filter(function(o) {
      if (!o.completedAt && !o.createdAt) return false;
      if (cutoffDate) {
        var orderDate = (o.completedAt || o.createdAt || '').substring(0, 10);
        return orderDate >= cutoffDate;
      }
      return true;
    });
    filteredOrders.forEach(function(o) {
      if (!o.items) return;
      (Array.isArray(o.items) ? o.items : Object.values(o.items)).forEach(function(item) {
        if (item.bookingType === 'class' || item.bookingType === 'pass') {
          revenue += (item.total || item.price || 0);
        }
      });
    });

    var html = '';

    // Summary cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:2rem;">';
    html += _reportCard('Sessions Completed', completedSessions.length, SUCCESS_COLOR);
    html += _reportCard('Attendance Rate', attRate + '%', attRate >= 80 ? SUCCESS_COLOR : attRate >= 60 ? WARNING_COLOR : DANGER_COLOR);
    html += _reportCard('Active Enrollments', activeEnrollments, '#64B5F6');
    html += _reportCard('Class Revenue', formatPrice(revenue), 'var(--primary)');
    html += '</div>';

    // Attendance breakdown bar
    if (attTotal > 0) {
      html += '<h3 style="' + SECTION_H3 + '">Attendance Breakdown</h3>';
      var pctCompleted = Math.round((attCompleted / attTotal) * 100);
      var pctAbsent = Math.round((attAbsent / attTotal) * 100);
      var pctNoShow = 100 - pctCompleted - pctAbsent;
      html += '<div style="display:flex;height:24px;border-radius:6px;overflow:hidden;margin-bottom:8px;">';
      if (pctCompleted > 0) html += '<div style="width:' + pctCompleted + '%;background:' + SUCCESS_COLOR + ';"></div>';
      if (pctAbsent > 0) html += '<div style="width:' + pctAbsent + '%;background:' + WARNING_COLOR + ';"></div>';
      if (pctNoShow > 0) html += '<div style="width:' + pctNoShow + '%;background:' + DANGER_COLOR + ';"></div>';
      html += '</div>';
      html += '<div style="display:flex;gap:1.5rem;font-size:0.8rem;color:var(--warm-gray);margin-bottom:2rem;">';
      html += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + SUCCESS_COLOR + ';margin-right:4px;vertical-align:middle;"></span>Completed (' + attCompleted + ')</span>';
      html += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + WARNING_COLOR + ';margin-right:4px;vertical-align:middle;"></span>Absent (' + attAbsent + ')</span>';
      html += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + DANGER_COLOR + ';margin-right:4px;vertical-align:middle;"></span>No-Show (' + attNoShow + ')</span>';
      html += '</div>';
    }

    // Incident summary
    var filteredIncidents = allIncidents;
    if (cutoffDate) {
      filteredIncidents = allIncidents.filter(function(inc) {
        return (inc.createdAt || '').substring(0, 10) >= cutoffDate;
      });
    }
    if (filteredIncidents.length > 0) {
      html += '<h3 style="' + SECTION_H3 + '">Incidents (' + filteredIncidents.length + ')</h3>';
      // Severity counts
      var sevCounts = { low: 0, medium: 0, high: 0, critical: 0 };
      filteredIncidents.forEach(function(inc) { sevCounts[inc.severity] = (sevCounts[inc.severity] || 0) + 1; });
      html += '<div style="display:flex;gap:8px;margin-bottom:12px;">';
      ['critical', 'high', 'medium', 'low'].forEach(function(sev) {
        if (sevCounts[sev] > 0) {
          html += '<span style="' + badgeStyle(SEVERITY_BADGE_COLORS, sev) + '">' + sev + ': ' + sevCounts[sev] + '</span>';
        }
      });
      html += '</div>';

      // Recent incidents list (max 5)
      var recentInc = filteredIncidents.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); }).slice(0, 5);
      recentInc.forEach(function(inc) {
        var sevColor = SEVERITY_COLORS[inc.severity] || '#BDBDBD';
        html += '<div style="' + CARD_STYLE + 'margin-bottom:8px;border-left:3px solid ' + sevColor + ';">' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
          '<span style="' + badgeStyle(SEVERITY_BADGE_COLORS, inc.severity) + '">' + esc(inc.severity) + '</span>' +
          '<span style="font-weight:500;font-size:0.9rem;">' + esc(INCIDENT_TYPE_LABELS[inc.type] || inc.type) + '</span>' +
          '<span style="color:var(--warm-gray);font-size:0.75rem;margin-left:auto;">' + esc(inc.followUpStatus || 'open') + '</span>' +
          '</div>' +
          '<p style="margin:6px 0 0;color:var(--warm-gray);font-size:0.85rem;">' + esc(inc.description) + '</p>' +
          '</div>';
      });
    }

    // Class performance table
    var classIds = Object.keys(classes);
    if (classIds.length > 0) {
      html += '<h3 style="' + SECTION_H3 + '">Class Performance</h3>';
      html += '<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Class</th><th>Sessions</th><th>Attendance</th><th>Avg Enrolled</th><th>Revenue</th></tr></thead><tbody>';

      var classPerf = classIds.map(function(cid) {
        var cls = classes[cid];
        var clsSessions = filteredSessions.filter(function(s) { return s.classId === cid; });
        var clsCompleted = clsSessions.filter(function(s) { return s.status === 'completed'; });

        // Attendance for this class
        var clsAttTotal = 0, clsAttPresent = 0;
        clsCompleted.forEach(function(s) {
          var log = sessionLogs[s.id];
          if (!log || !log.attendance) return;
          Object.keys(log.attendance).forEach(function(eid) {
            clsAttTotal++;
            if (log.attendance[eid].status === 'completed') clsAttPresent++;
          });
        });
        var clsAttRate = clsAttTotal > 0 ? Math.round((clsAttPresent / clsAttTotal) * 100) : 0;

        // Avg enrollment
        var totalEnrolled = 0;
        clsSessions.forEach(function(s) { totalEnrolled += (s.enrolled || 0); });
        var avgEnrolled = clsSessions.length > 0 ? (totalEnrolled / clsSessions.length).toFixed(1) : '0';

        // Revenue for this class
        var clsRevenue = 0;
        filteredOrders.forEach(function(o) {
          if (!o.items) return;
          (Array.isArray(o.items) ? o.items : Object.values(o.items)).forEach(function(item) {
            if (item.bookingType === 'class' && item.classId === cid) {
              clsRevenue += (item.total || item.price || 0);
            }
          });
        });

        return {
          name: cls.name || cid,
          sessions: clsCompleted.length + ' / ' + clsSessions.length,
          attRate: clsAttRate,
          avgEnrolled: avgEnrolled,
          revenue: clsRevenue,
          totalSessions: clsSessions.length
        };
      }).filter(function(p) { return p.totalSessions > 0; })
        .sort(function(a, b) { return b.totalSessions - a.totalSessions; });

      classPerf.forEach(function(p) {
        html += '<tr>' +
          '<td><strong>' + esc(p.name) + '</strong></td>' +
          '<td>' + p.sessions + '</td>' +
          '<td>' + p.attRate + '%</td>' +
          '<td>' + p.avgEnrolled + '</td>' +
          '<td>' + formatPrice(p.revenue) + '</td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';
    }

    // Empty state
    if (filteredSessions.length === 0) {
      html = '<p style="' + EMPTY_STATE_STYLE + '">No session data for the selected time period.</p>';
    }

    content.innerHTML = html;
  }

  function _reportCard(label, value, color) {
    return '<div style="' + CARD_STYLE + 'text-align:center;">' +
      '<div style="font-size:2rem;font-weight:700;color:' + color + ';line-height:1.2;">' + value + '</div>' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;margin-top:4px;">' + esc(label) + '</div>' +
      '</div>';
  }

  window._reportRangeChange = function() { loadReports(); };

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
      'pass-detail': { tab: 'bookTab', setup: function(id) { if (id) { showPassDefForm(id); } else { switchSubTab('passes'); } } },
      'calendar': { tab: 'bookTab', setup: function() { switchSubTab('calendar'); } },
      'book-reports': { tab: 'bookTab', setup: function() { switchSubTab('book-reports'); } }
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
      calendarYear = new Date().getFullYear();
      calendarMonth = new Date().getMonth();
      calendarSessions = [];
      calendarClassesMap = {};
      calendarLoaded = false;
      selectedCalendarDay = null;
      reportsLoaded = false;
      currentSubTab = 'classes';
    }
  });

})();
