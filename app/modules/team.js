(function() {
  'use strict';

  var employeesData = [];
  var tenantDocs = [];
  var teamLoaded = false;
  var currentView = 'roster'; // roster | detail | docs
  var selectedEmployeeId = null;
  var editingEmployeeId = null;
  var editingDocId = null;
  var driveExplainerShown = false;

  // Time Clock state
  var tcSelectedEmployeeId = null;
  var tcWeekOffset = 0;
  var tcTimerInterval = null;

  // PTO state
  var ptoSelectedEmployeeId = null;
  var ptoPolicies = {};

  // Documents filter state
  var docFilterEmployee = '';
  var docFilterStatus = '';

  // Onboarding filter state
  var onboardingFilter = 'all';

  // --- Constants ---
  var COMPLIANCE_FIELDS = [
    { key: 'i9', label: 'I-9' },
    { key: 'w4', label: 'W-4' },
    { key: 'stateWithholding', label: 'State Withholding' },
    { key: 'offerLetter', label: 'Offer Letter' },
    { key: 'workersComp', label: "Workers' Comp Certificate" },
  ];
  var STORAGE_OPTIONS = [
    { value: 'physical', label: 'Physical' },
    { value: 'google-drive', label: 'Google Drive' },
    { value: 'dropbox', label: 'Dropbox' },
    { value: 'gusto', label: 'Gusto' },
    { value: 'other', label: 'Other' },
  ];
  var DOC_TYPES = ['employment', 'tax', 'certification', 'insurance', 'license', 'legal', 'compliance', 'financial', 'other'];
  var EMPLOYMENT_TYPES = ['full-time', 'part-time', 'temp', 'contractor'];
  var PAY_TYPES = ['hourly', 'salary', 'piece-rate'];
  var PAY_FREQUENCIES = ['weekly', 'bi-weekly', 'monthly'];
  var REFERENCE_OUTCOMES = ['positive', 'neutral', 'concerning', 'not-checked'];

  var INPUT_STYLE = 'width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,var(--cream));box-sizing:border-box;font-family:DM Sans,sans-serif;color:var(--charcoal,var(--charcoal));';

  // --- Helpers ---
  function fmtDollars(cents) {
    if (cents == null || cents === 0) return 'not set';
    return '$' + (cents / 100).toFixed(2);
  }
  function fmtRate(cents, payType) {
    if (cents == null) return 'not set';
    var label = payType === 'salary' ? '/mo' : '/hr';
    return '$' + (cents / 100).toFixed(2) + label;
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function labelField(id, label, inputHtml) {
    return '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;" for="' + id + '">' + esc(label) + '</label>' + inputHtml + '</div>';
  }
  function textInput(id, value, placeholder) {
    return '<input id="' + id + '" type="text" value="' + esc(value || '') + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + ' style="' + INPUT_STYLE + '">';
  }
  function numberInput(id, value, step, placeholder) {
    return '<input id="' + id + '" type="number"' + (step ? ' step="' + step + '"' : '') + ' value="' + (value != null ? value : '') + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + ' style="' + INPUT_STYLE + '">';
  }
  function dateInput(id, value) {
    return '<input id="' + id + '" type="date" value="' + (value || '') + '" style="' + INPUT_STYLE + '">';
  }
  function selectInput(id, options, selectedValue) {
    var h = '<select id="' + id + '" style="' + INPUT_STYLE + '">';
    options.forEach(function(opt) {
      var val = typeof opt === 'string' ? opt : opt.value;
      var label = typeof opt === 'string' ? capitalize(opt.replace('-', ' ')) : opt.label;
      h += '<option value="' + esc(val) + '"' + (val === selectedValue ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    h += '</select>';
    return h;
  }
  function fullWidthDiv(content) { return '<div style="grid-column:1/-1;">' + content + '</div>'; }

  // Collapsible section: header with toggle, content hidden by default (or open)
  function collapsibleSection(id, title, contentHtml, opts) {
    opts = opts || {};
    var open = opts.open !== false; // open by default unless opts.open === false
    var badge = opts.badge || '';
    var rightHtml = opts.rightHtml || '';
    var h = '<div style="margin-bottom:16px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:6px 0;" onclick="teamToggleSection(\'' + id + '\')">';
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += '<span style="font-size:0.72rem;color:var(--warm-gray);transition:transform 0.15s;" id="' + id + 'Arrow">' + (open ? '\u25bc' : '\u25b6') + '</span>';
    h += '<span style="font-size:1rem;font-weight:600;">' + esc(title) + '</span>';
    if (badge) h += ' ' + badge;
    h += '</div>';
    h += rightHtml;
    h += '</div>';
    h += '<div id="' + id + '" style="' + (open ? '' : 'display:none;') + '">';
    h += contentHtml;
    h += '</div>';
    h += '</div>';
    return h;
  }

  function calcMonthlyCost(emp) {
    if (!emp.payRate) return 0;
    if (emp.payType === 'salary') return emp.payRate;
    return Math.round((emp.payRate || 0) * (emp.scheduledHoursPerWeek || 0) * 4.33);
  }

  function isDriveUrl(url) {
    return url && /drive\.google\.com|docs\.google\.com/.test(url);
  }

  // Renders the Drive URL + preview section used in compliance and document forms
  function renderDriveUrlField(prefix, existingUrl, existingDrive) {
    var drive = existingDrive || {};
    var h = '';
    h += fullWidthDiv(labelField(prefix + 'Url', 'URL or Google Drive link', textInput(prefix + 'Url', existingUrl || '', 'https://drive.google.com/file/d/...')));

    // Drive metadata preview (hidden until populated)
    h += '<div id="' + prefix + 'DrivePreview" style="grid-column:1/-1;display:' + (drive.driveFileName ? '' : 'none') + ';">';
    if (drive.driveFileName) {
      h += renderDrivePreview(prefix, drive);
    }
    h += '</div>';

    // Drive explainer (shown once per session when google-drive storage selected)
    h += '<div id="' + prefix + 'DriveExplainer" style="grid-column:1/-1;display:none;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:6px;padding:10px 14px;font-size:0.78rem;color:#86efac;">';
    h += '\ud83d\udd17 Paste a Google Drive share link above to auto-link the file. Make sure linked files are set to <strong>restricted access</strong> in Drive (not "anyone with the link").';
    h += '</div>';

    return h;
  }

  function renderDrivePreview(prefix, drive) {
    var h = '<div style="background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">';
    h += '<div style="font-size:0.85rem;">\ud83d\udcc4 <strong>' + esc(drive.driveFileName || '') + '</strong>';
    if (drive.driveLastModified) h += ' \u00b7 Modified ' + (drive.driveLastModified || '').split('T')[0];
    h += '</div>';
    h += '<button type="button" class="btn btn-secondary btn-small" onclick="teamUnlinkDrive(\'' + esc(prefix) + '\')">Unlink</button>';
    h += '</div>';
    return h;
  }

  function attachDriveUrlListener(prefix, storageSelectId) {
    var urlEl = document.getElementById(prefix + 'Url');
    var storageEl = storageSelectId ? document.getElementById(storageSelectId) : null;

    if (urlEl) {
      urlEl.addEventListener('blur', function() {
        var url = this.value.trim();
        if (isDriveUrl(url)) {
          // Auto-switch storage to google-drive if not already
          if (storageEl && storageEl.value !== 'google-drive') {
            storageEl.value = 'google-drive';
          }
          fetchAndShowDrivePreview(prefix, url);
        }
      });
    }

    if (storageEl) {
      storageEl.addEventListener('change', function() {
        var explainer = document.getElementById(prefix + 'DriveExplainer');
        if (this.value === 'google-drive' && explainer && !driveExplainerShown) {
          explainer.style.display = '';
          driveExplainerShown = true;
        } else if (explainer && this.value !== 'google-drive') {
          explainer.style.display = 'none';
        }
      });
      // Trigger on load if already google-drive
      if (storageEl.value === 'google-drive' && !driveExplainerShown) {
        var explainer = document.getElementById(prefix + 'DriveExplainer');
        if (explainer) { explainer.style.display = ''; driveExplainerShown = true; }
      }
    }
  }

  async function fetchAndShowDrivePreview(prefix, url) {
    var preview = document.getElementById(prefix + 'DrivePreview');
    if (!preview) return;
    preview.innerHTML = '<div style="font-size:0.78rem;color:var(--warm-gray);">Fetching file info\u2026</div>';
    preview.style.display = '';

    var meta = await fetchDriveFileMetadata(url);
    if (!meta) {
      preview.innerHTML = '<div style="font-size:0.78rem;color:var(--danger);">Could not fetch file metadata. Check the URL and try again.</div>';
      return;
    }

    // Store metadata in hidden fields
    preview.dataset.driveFileId = url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '';
    preview.dataset.driveFileName = meta.name || '';
    preview.dataset.driveLastModified = meta.modifiedTime || '';

    preview.innerHTML = renderDrivePreview(prefix, {
      driveFileName: meta.name,
      driveLastModified: meta.modifiedTime,
    });

    // Hide explainer once linked
    var explainer = document.getElementById(prefix + 'DriveExplainer');
    if (explainer) explainer.style.display = 'none';
  }

  function unlinkDrive(prefix) {
    var preview = document.getElementById(prefix + 'DrivePreview');
    if (preview) {
      preview.innerHTML = '';
      preview.style.display = 'none';
      delete preview.dataset.driveFileId;
      delete preview.dataset.driveFileName;
      delete preview.dataset.driveLastModified;
    }
    var urlEl = document.getElementById(prefix + 'Url');
    if (urlEl) urlEl.value = '';
  }

  function collectDriveFields(prefix) {
    var preview = document.getElementById(prefix + 'DrivePreview');
    if (preview && preview.dataset.driveFileName) {
      return {
        driveFileId: preview.dataset.driveFileId || null,
        driveFileName: preview.dataset.driveFileName || null,
        driveLastModified: preview.dataset.driveLastModified || null,
      };
    }
    return { driveFileId: null, driveFileName: null, driveLastModified: null };
  }

  // --- Time/PTO Helpers ---
  function getWeekRange(offset) {
    var now = new Date();
    var startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + (offset * 7));
    startOfWeek.setHours(0, 0, 0, 0);
    var endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    return { start: startOfWeek, end: endOfWeek };
  }
  function formatTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var h = d.getHours(), m = d.getMinutes(), ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }
  function fmtDateShort(d) {
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // --- Load ---
  async function loadTeam() {
    var container = document.getElementById('teamTab');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading team\u2026</div>';

    try {
      var results = await Promise.all([
        MastDB.get('admin/employees'),
        MastDB.get('admin/documents'),
      ]);

      var empVal = results[0] || {};
      employeesData = Object.entries(empVal).map(function(entry) {
        var emp = entry[1];
        emp._key = entry[0];
        return emp;
      });

      var docsVal = results[1] || {};
      tenantDocs = Object.entries(docsVal).map(function(entry) {
        var doc = entry[1];
        doc._key = entry[0];
        return doc;
      });

      teamLoaded = true;
      renderTeam(container);
    } catch (err) {
      console.error('Error loading team:', err);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">Error loading team data.</div>';
    }
  }

  // Returns true if the current user has operational management access (Admin or Manager).
  // Used to gate Team tabs that are not self-service (Time Clock, PTO, Documents, Onboarding).
  function canManageTeam() {
    return typeof hasPermission === 'function' ? hasPermission('jobs', 'read') : true;
  }

  // --- Main Render ---
  function renderTeam(container) {
    var mgr = canManageTeam();
    // Restrict manager-only tabs
    if (!mgr && (currentView === 'docs' || currentView === 'onboarding')) {
      currentView = 'roster';
    }
    var h = '';
    h += '<div class="view-tabs" style="margin-bottom:20px;">';
    h += '<button class="view-tab' + (currentView === 'roster' || currentView === 'detail' ? ' active' : '') + '" onclick="teamSwitchView(\'roster\')">Roster</button>';
    h += '<button class="view-tab' + (currentView === 'timeclock' ? ' active' : '') + '" onclick="teamSwitchView(\'timeclock\')">Time Clock</button>';
    h += '<button class="view-tab' + (currentView === 'pto' ? ' active' : '') + '" onclick="teamSwitchView(\'pto\')">PTO</button>';
    if (mgr) {
      h += '<button class="view-tab' + (currentView === 'docs' ? ' active' : '') + '" onclick="teamSwitchView(\'docs\')">Documents</button>';
      h += '<button class="view-tab' + (currentView === 'onboarding' ? ' active' : '') + '" onclick="teamSwitchView(\'onboarding\')">Onboarding</button>';
    }
    h += '</div>';

    if (currentView === 'roster') {
      h += renderRoster();
    } else if (currentView === 'detail') {
      h += renderEmployeeDetail();
    } else if (currentView === 'timeclock') {
      h += renderTimeClock();
    } else if (currentView === 'pto') {
      h += renderPto();
    } else if (currentView === 'docs') {
      h += renderComplianceDocs();
    } else if (currentView === 'onboarding') {
      h += renderOnboarding();
    }

    container.innerHTML = h;
  }

  // ========================================
  // Tab: Time Clock
  // ========================================
  function renderTimeClock() {
    return canManageTeam() ? renderTimeClockManager() : renderTimeClockSelf();
  }

  function renderTimeClockManager() {
    var h = '';
    h += '<div id="tcActiveBanner" style="display:none;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);border-radius:6px;padding:8px 14px;margin-bottom:12px;font-size:0.85rem;color:#fbbf24;"></div>';
    h += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">';
    h += '<select id="tcEmpFilter" onchange="teamTcSetEmployee(this.value)" style="' + INPUT_STYLE + 'width:auto;min-width:180px;">';
    h += '<option value="">All employees</option>';
    employeesData.filter(function(e) { return (e.status || 'active') === 'active'; }).forEach(function(emp) {
      h += '<option value="' + esc(emp._key) + '"' + (tcSelectedEmployeeId === emp._key ? ' selected' : '') + '>' + esc(emp.fullName || '') + '</option>';
    });
    h += '</select>';
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += '<button class="btn btn-secondary btn-small" onclick="teamTcPrevWeek()">&larr;</button>';
    h += '<span id="tcWeekLabel" style="font-size:0.85rem;font-weight:600;min-width:140px;text-align:center;"></span>';
    h += '<button class="btn btn-secondary btn-small" id="tcNextBtn" onclick="teamTcNextWeek()">&rarr;</button>';
    h += '</div>';
    h += '<button class="btn btn-primary btn-small" onclick="teamTcAddEntry()">+ Add Entry</button>';
    h += '</div>';
    h += '<div id="tcAddForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div id="tcAddFormInner"></div></div>';
    h += '<div id="tcTableWrap"><div class="loading">Loading time entries&hellip;</div></div>';
    setTimeout(loadTcManager, 0);
    return h;
  }

  async function loadTcManager() {
    var wrap = document.getElementById('tcTableWrap');
    var banner = document.getElementById('tcActiveBanner');
    if (!wrap) return;
    try {
      var raw = await MastDB.get('admin/timeEntries') || {};
      var all = Object.entries(raw).map(function(e) { var v = e[1]; v._key = e[0]; return v; });

      var active = all.filter(function(e) { return !e.clockOut; });
      if (banner) {
        if (active.length > 0) {
          banner.style.display = '';
          banner.innerHTML = '&#9889; <strong>' + active.length + ' employee' + (active.length !== 1 ? 's' : '') + ' currently clocked in</strong>';
        } else {
          banner.style.display = 'none';
        }
      }

      var range = getWeekRange(tcWeekOffset);
      var lbl = document.getElementById('tcWeekLabel');
      var nxtBtn = document.getElementById('tcNextBtn');
      if (lbl) lbl.textContent = fmtDateShort(range.start) + ' – ' + fmtDateShort(range.end);
      if (nxtBtn) nxtBtn.disabled = tcWeekOffset >= 0;

      var entries = all.filter(function(e) {
        if (!e.clockIn) return false;
        var d = new Date(e.clockIn);
        return d >= range.start && d <= range.end;
      });
      if (tcSelectedEmployeeId) entries = entries.filter(function(e) { return e.employeeId === tcSelectedEmployeeId; });
      entries.sort(function(a, b) { return (b.clockIn || '').localeCompare(a.clockIn || ''); });

      var totalHrs = 0;
      entries.forEach(function(e) { if (e.hoursWorked) totalHrs += e.hoursWorked; });

      var h = '';
      if (entries.length === 0) {
        h = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);"><div style="font-size:1.4rem;margin-bottom:8px;">&#9201;</div><p style="font-size:0.9rem;font-weight:500;">No time entries this week</p></div>';
      } else {
        h += '<div style="overflow-x:auto;"><table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
        h += '<thead><tr style="border-bottom:2px solid var(--cream-dark,var(--cream-dark));text-align:left;">';
        if (!tcSelectedEmployeeId) h += '<th style="padding:8px 10px;font-weight:600;">Employee</th>';
        h += '<th style="padding:8px 10px;font-weight:600;">Date</th><th style="padding:8px 10px;font-weight:600;">Clock In</th><th style="padding:8px 10px;font-weight:600;">Clock Out</th><th style="padding:8px 10px;font-weight:600;text-align:right;">Hours</th><th style="padding:8px 10px;font-weight:600;">Notes</th></tr></thead><tbody>';
        entries.forEach(function(entry) {
          var empObj = employeesData.find(function(e) { return e._key === entry.employeeId; });
          var isOpen = !entry.clockOut;
          h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
          if (!tcSelectedEmployeeId) h += '<td style="padding:8px 10px;">' + esc(empObj ? empObj.fullName : entry.employeeId || '—') + '</td>';
          h += '<td style="padding:8px 10px;">' + esc(entry.date || '') + '</td>';
          h += '<td style="padding:8px 10px;">' + formatTime(entry.clockIn) + '</td>';
          h += '<td style="padding:8px 10px;">' + (isOpen ? '<span style="color:#22c55e;font-size:0.78rem;font-weight:600;">&#9679; Active</span>' : formatTime(entry.clockOut)) + '</td>';
          h += '<td style="padding:8px 10px;text-align:right;">' + (isOpen ? '—' : (entry.hoursWorked != null ? entry.hoursWorked.toFixed(2) : '—')) + '</td>';
          h += '<td style="padding:8px 10px;color:var(--warm-gray);">' + esc(entry.notes || '') + '</td></tr>';
        });
        h += '</tbody></table></div>';
        var selEmp = tcSelectedEmployeeId ? employeesData.find(function(e) { return e._key === tcSelectedEmployeeId; }) : null;
        h += '<div style="display:flex;justify-content:flex-end;gap:24px;padding:10px;border-top:2px solid var(--cream-dark,var(--cream-dark));font-size:0.85rem;">';
        h += '<div>Total hours: <strong>' + totalHrs.toFixed(2) + '</strong></div>';
        if (selEmp && selEmp.payRate) {
          h += '<div>Labor cost: <strong>$' + (totalHrs * selEmp.payRate / 100).toFixed(2) + '</strong></div>';
        }
        h += '</div>';
      }
      wrap.innerHTML = h;
    } catch (err) {
      if (wrap) wrap.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading time entries.</div>';
    }
  }

  function renderTimeClockSelf() {
    var h = '<div id="tcSelfStatus" style="margin-bottom:16px;"><div class="loading">Loading&hellip;</div></div>';
    h += '<div id="tcSelfTable"><div class="loading">Loading your entries&hellip;</div></div>';
    var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
    setTimeout(function() { loadTcSelf(uid); }, 0);
    return h;
  }

  async function loadTcSelf(uid) {
    var statusEl = document.getElementById('tcSelfStatus');
    var tableEl = document.getElementById('tcSelfTable');
    if (!statusEl) return;
    try {
      var raw = await MastDB.get('admin/timeEntries') || {};
      var mine = Object.entries(raw).map(function(e) { var v = e[1]; v._key = e[0]; return v; })
        .filter(function(e) { return e.employeeId === uid || e.createdBy === uid; })
        .sort(function(a, b) { return (b.clockIn || '').localeCompare(a.clockIn || ''); });
      var openEntry = mine.find(function(e) { return !e.clockOut; });

      var sh = '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
      if (openEntry) {
        sh += '<div style="background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:8px;padding:10px 16px;">';
        sh += '<div style="font-size:0.85rem;color:#22c55e;font-weight:600;">&#9679; Clocked in since ' + formatTime(openEntry.clockIn) + '</div>';
        sh += '<div id="tcTimer" style="font-size:1.4rem;font-weight:700;font-family:monospace;color:#22c55e;"></div></div>';
        sh += '<button class="btn btn-primary" data-key="' + esc(openEntry._key) + '" onclick="teamTcClockOut(this.dataset.key)">Clock Out</button>';
        startTcTimer(openEntry.clockIn);
      } else {
        sh += '<button class="btn btn-primary" onclick="teamTcClockIn()">Clock In</button>';
        if (tcTimerInterval) { clearInterval(tcTimerInterval); tcTimerInterval = null; }
      }
      sh += '</div>';
      statusEl.innerHTML = sh;

      var th = '';
      if (mine.length === 0) {
        th = '<div style="text-align:center;padding:30px;color:var(--warm-gray);"><p style="font-size:0.9rem;font-weight:500;">No time entries yet</p></div>';
      } else {
        th += '<h4 style="font-size:0.9rem;font-weight:600;margin:16px 0 8px;">Recent Entries</h4>';
        th += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
        th += '<thead><tr style="border-bottom:2px solid var(--cream-dark,var(--cream-dark));"><th style="padding:8px 10px;text-align:left;font-weight:600;">Date</th><th style="padding:8px 10px;text-align:left;font-weight:600;">In</th><th style="padding:8px 10px;text-align:left;font-weight:600;">Out</th><th style="padding:8px 10px;text-align:right;font-weight:600;">Hours</th></tr></thead><tbody>';
        mine.slice(0, 20).forEach(function(e) {
          var open = !e.clockOut;
          th += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
          th += '<td style="padding:8px 10px;">' + esc(e.date || '') + '</td>';
          th += '<td style="padding:8px 10px;">' + formatTime(e.clockIn) + '</td>';
          th += '<td style="padding:8px 10px;">' + (open ? '<span style="color:#22c55e;font-size:0.78rem;">Active</span>' : formatTime(e.clockOut)) + '</td>';
          th += '<td style="padding:8px 10px;text-align:right;">' + (open ? '—' : (e.hoursWorked != null ? e.hoursWorked.toFixed(2) : '—')) + '</td></tr>';
        });
        th += '</tbody></table>';
      }
      if (tableEl) tableEl.innerHTML = th;
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<div style="color:var(--danger);">Error loading time data.</div>';
    }
  }

  function startTcTimer(clockInIso) {
    if (tcTimerInterval) clearInterval(tcTimerInterval);
    function tick() {
      var el = document.getElementById('tcTimer');
      if (!el) { clearInterval(tcTimerInterval); tcTimerInterval = null; return; }
      var ms = Date.now() - new Date(clockInIso).getTime();
      var h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
      el.textContent = h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    tick();
    tcTimerInterval = setInterval(tick, 1000);
  }

  async function tcClockIn() {
    var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
    var now = new Date();
    var key = MastDB.newKey('admin/timeEntries');
    var entry = { id: key, employeeId: uid, clockIn: now.toISOString(), clockOut: null, hoursWorked: null, date: now.toISOString().split('T')[0], status: 'active', createdBy: uid, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    try {
      await MastDB.set('admin/timeEntries/' + key, entry);
      showToast('Clocked in');
      loadTcSelf(uid);
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  async function tcClockOut(entryKey) {
    var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
    try {
      var raw = await MastDB.get('admin/timeEntries/' + entryKey);
      if (!raw || !raw.clockIn) { showToast('Entry not found', true); return; }
      var now = new Date();
      var hrs = Math.round((now.getTime() - new Date(raw.clockIn).getTime()) / 36000) / 100;
      await MastDB.update('admin/timeEntries/' + entryKey, { clockOut: now.toISOString(), hoursWorked: hrs, status: 'complete', updatedAt: now.toISOString() });
      showToast('Clocked out — ' + hrs.toFixed(2) + ' hrs');
      loadTcSelf(uid);
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  function openTcAddForm() {
    var formEl = document.getElementById('tcAddForm'), innerEl = document.getElementById('tcAddFormInner');
    if (!formEl || !innerEl) return;
    var today = new Date().toISOString().split('T')[0];
    var empOpts = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; }).map(function(emp) {
      return '<option value="' + esc(emp._key) + '"' + (tcSelectedEmployeeId === emp._key ? ' selected' : '') + '>' + esc(emp.fullName || '') + '</option>';
    }).join('');
    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">New Time Entry</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;align-items:end;">';
    h += labelField('tcAEmp', 'Employee', '<select id="tcAEmp" style="' + INPUT_STYLE + '">' + empOpts + '</select>');
    h += labelField('tcADate', 'Date', dateInput('tcADate', today));
    h += labelField('tcAIn', 'Clock In', '<input id="tcAIn" type="time" style="' + INPUT_STYLE + '">');
    h += labelField('tcAOut', 'Clock Out', '<input id="tcAOut" type="time" style="' + INPUT_STYLE + '">');
    h += labelField('tcANotes', 'Notes', textInput('tcANotes', '', 'Optional'));
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:10px;"><button class="btn btn-primary btn-small" onclick="teamTcSaveEntry()">Save</button><button class="btn btn-secondary btn-small" onclick="document.getElementById(\'tcAddForm\').style.display=\'none\'">Cancel</button></div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function saveTcEntry() {
    var empId = document.getElementById('tcAEmp').value;
    var date = document.getElementById('tcADate').value;
    var inTime = document.getElementById('tcAIn').value;
    var outTime = document.getElementById('tcAOut').value;
    if (!empId || !date || !inTime) { showToast('Employee, date, and clock-in time required', true); return; }
    var clockIn = date + 'T' + inTime + ':00', clockOut = outTime ? date + 'T' + outTime + ':00' : null;
    var hrs = clockOut ? Math.round((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 36000) / 100 : null;
    var key = MastDB.newKey('admin/timeEntries');
    try {
      await MastDB.set('admin/timeEntries/' + key, { id: key, employeeId: empId, clockIn: clockIn, clockOut: clockOut, hoursWorked: hrs, date: date, notes: document.getElementById('tcANotes').value.trim() || null, status: clockOut ? 'complete' : 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      showToast('Entry saved');
      document.getElementById('tcAddForm').style.display = 'none';
      loadTcManager();
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  // ========================================
  // Tab: PTO
  // ========================================
  function renderPto() {
    return canManageTeam() ? renderPtoManager() : renderPtoSelf();
  }

  function renderPtoManager() {
    var h = '';
    h += '<div id="ptoPolicyForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div id="ptoPolicyFormInner"></div></div>';
    h += '<div id="ptoUsageForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div id="ptoUsageFormInner"></div></div>';
    if (ptoSelectedEmployeeId) {
      h += '<button class="detail-back" onclick="teamPtoBack()">&larr; All Employees</button>';
      h += '<div id="ptoDetailWrap"><div class="loading">Loading PTO&hellip;</div></div>';
      setTimeout(function() { loadPtoDetail(ptoSelectedEmployeeId); }, 0);
    } else {
      h += '<div id="ptoBoardWrap"><div class="loading">Loading PTO data&hellip;</div></div>';
      setTimeout(loadPtoBoard, 0);
    }
    return h;
  }

  async function loadPtoBoard() {
    var wrap = document.getElementById('ptoBoardWrap');
    if (!wrap) return;
    try {
      var rawEntries = await MastDB.get('admin/ptoEntries') || {};
      var entries = Object.values(rawEntries);
      var rawPolicies = await MastDB.get('admin/ptoPolicy') || {};
      ptoPolicies = {};
      Object.entries(rawPolicies).forEach(function(e) { var p = e[1]; p._key = e[0]; ptoPolicies[p.employeeId || e[0]] = p; });

      var balMap = {}, usedYtd = {}, yr = new Date().getFullYear().toString();
      entries.forEach(function(e) {
        if (!e.employeeId) return;
        if (!balMap[e.employeeId] || (e.date || '') > (balMap[e.employeeId].date || '')) balMap[e.employeeId] = e;
        if (e.type === 'used' && (e.date || '').startsWith(yr)) usedYtd[e.employeeId] = (usedYtd[e.employeeId] || 0) + Math.abs(e.hours || 0);
      });

      var active = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; });
      var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h2 style="margin:0;">PTO Overview</h2></div>';
      if (active.length === 0) {
        h += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">No active employees.</div>';
      } else {
        h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">';
        active.forEach(function(emp) {
          var bal = balMap[emp._key], policy = ptoPolicies[emp._key] || ptoPolicies['default'];
          var balance = bal ? (bal.balance || 0) : 0;
          var ytdUsed = usedYtd[emp._key] || 0;
          var aLabel = policy ? (policy.accrualType === 'annual-grant' ? 'Annual grant' : policy.accrualType === 'hourly' ? 'Hourly accrual' : 'Manual') : 'No policy';
          h += '<div onclick="teamPtoSelectEmp(\'' + esc(emp._key) + '\')" style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,0.08);cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,var(--cream-dark))\'">';
          h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:6px;">👤 ' + esc(emp.fullName || '') + '</div>';
          h += '<div style="font-size:1.6rem;font-weight:700;">' + balance.toFixed(1) + ' <span style="font-size:0.85rem;font-weight:400;color:var(--warm-gray);">hrs</span></div>';
          h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' + esc(aLabel) + (ytdUsed > 0 ? ' · ' + ytdUsed.toFixed(1) + ' used YTD' : '') + '</div>';
          h += '</div>';
        });
        h += '</div>';
      }
      wrap.innerHTML = h;
    } catch (err) { if (wrap) wrap.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading PTO data.</div>'; }
  }

  async function loadPtoDetail(empId) {
    var wrap = document.getElementById('ptoDetailWrap');
    if (!wrap) return;
    try {
      var emp = employeesData.find(function(e) { return e._key === empId; });
      var rawEntries = await MastDB.get('admin/ptoEntries') || {};
      var entries = Object.entries(rawEntries).map(function(e) { var v = e[1]; v._key = e[0]; return v; })
        .filter(function(e) { return e.employeeId === empId; })
        .sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
      var rawPolicies = await MastDB.get('admin/ptoPolicy') || {};
      ptoPolicies = {};
      Object.entries(rawPolicies).forEach(function(e) { var p = e[1]; p._key = e[0]; ptoPolicies[p.employeeId || e[0]] = p; });
      var policy = ptoPolicies[empId] || ptoPolicies['default'];
      var balance = entries[0] ? (entries[0].balance || 0) : 0;

      var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">';
      h += '<div><h3 style="margin:0;">' + esc(emp ? emp.fullName : empId) + '</h3></div>';
      h += '<div style="display:flex;gap:8px;"><button class="btn btn-secondary btn-small" data-emp="' + esc(empId) + '" onclick="teamPtoEditPolicy(this.dataset.emp)">Edit Policy</button><button class="btn btn-primary btn-small" data-emp="' + esc(empId) + '" onclick="teamPtoRecordUsage(this.dataset.emp)">Record Usage</button></div></div>';
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px;">';
      h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Balance</div><div style="font-size:1.6rem;font-weight:700;">' + balance.toFixed(1) + '</div><div style="font-size:0.75rem;color:var(--warm-gray);">hours</div></div>';
      if (policy) {
        var aType = policy.accrualType === 'annual-grant' ? 'Annual Grant' : policy.accrualType === 'hourly' ? 'Hourly' : 'Manual';
        var aDetail = policy.accrualType === 'annual-grant' && policy.accrualRate ? policy.accrualRate + ' hrs/year' : policy.accrualType === 'hourly' && policy.accrualRate ? policy.accrualRate + ' hrs/hr' : '';
        h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Accrual</div><div style="font-size:0.95rem;font-weight:600;">' + esc(aType) + '</div>' + (aDetail ? '<div style="font-size:0.75rem;color:var(--warm-gray);">' + esc(aDetail) + '</div>' : '') + '</div>';
      }
      h += '</div>';
      h += '<h4 style="font-size:0.9rem;font-weight:600;margin-bottom:8px;">PTO History</h4>';
      if (entries.length === 0) {
        h += '<div style="color:var(--warm-gray);font-size:0.85rem;">No PTO history yet.</div>';
      } else {
        h += renderPtoTable(entries);
      }
      wrap.innerHTML = h;
    } catch (err) { if (wrap) wrap.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading PTO details.</div>'; }
  }

  function renderPtoTable(entries) {
    var h = '<div style="overflow-x:auto;"><table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
    h += '<thead><tr style="border-bottom:2px solid var(--cream-dark,var(--cream-dark));"><th style="padding:8px 10px;text-align:left;font-weight:600;">Date</th><th style="padding:8px 10px;text-align:left;font-weight:600;">Type</th><th style="padding:8px 10px;text-align:right;font-weight:600;">Hours</th><th style="padding:8px 10px;text-align:right;font-weight:600;">Balance</th><th style="padding:8px 10px;text-align:left;font-weight:600;">Notes</th></tr></thead><tbody>';
    entries.forEach(function(e) {
      var c = e.type === 'used' ? 'var(--danger)' : e.type === 'accrual' ? '#16a34a' : 'var(--warm-gray)';
      h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
      h += '<td style="padding:8px 10px;">' + esc(e.date || '') + '</td>';
      h += '<td style="padding:8px 10px;color:' + c + ';">' + esc(capitalize(e.type || '')) + '</td>';
      h += '<td style="padding:8px 10px;text-align:right;color:' + c + ';">' + ((e.hours || 0) > 0 ? '+' : '') + (e.hours || 0).toFixed(1) + '</td>';
      h += '<td style="padding:8px 10px;text-align:right;font-weight:600;">' + (e.balance || 0).toFixed(1) + '</td>';
      h += '<td style="padding:8px 10px;color:var(--warm-gray);">' + esc(e.notes || '') + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function renderPtoSelf() {
    var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
    var h = '<div id="ptoSelfWrap"><div class="loading">Loading your PTO&hellip;</div></div>';
    setTimeout(function() { loadPtoSelf(uid); }, 0);
    return h;
  }

  async function loadPtoSelf(uid) {
    var wrap = document.getElementById('ptoSelfWrap');
    if (!wrap) return;
    try {
      var rawEntries = await MastDB.get('admin/ptoEntries') || {};
      var mine = Object.entries(rawEntries).map(function(e) { var v = e[1]; v._key = e[0]; return v; })
        .filter(function(e) { return e.employeeId === uid || e.createdBy === uid; })
        .sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
      var rawPolicies = await MastDB.get('admin/ptoPolicy') || {};
      var myPolicy = null;
      Object.values(rawPolicies).forEach(function(p) { if (p.employeeId === uid) myPolicy = p; });
      if (!myPolicy) Object.values(rawPolicies).forEach(function(p) { if (p.employeeId === 'default') myPolicy = p; });
      var balance = mine[0] ? (mine[0].balance || 0) : 0;

      var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px;">';
      h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Balance</div><div style="font-size:1.6rem;font-weight:700;">' + balance.toFixed(1) + '</div><div style="font-size:0.75rem;color:var(--warm-gray);">hours</div></div>';
      if (myPolicy) {
        var aLabel = myPolicy.accrualType === 'annual-grant' ? 'Annual grant — ' + (myPolicy.accrualRate || 0) + ' hrs/year' : myPolicy.accrualType === 'hourly' ? 'Hourly — ' + (myPolicy.accrualRate || 0) + ' hrs/hr' : 'Manual';
        h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Accrual</div><div style="font-size:0.85rem;font-weight:600;">' + esc(aLabel) + '</div></div>';
      }
      h += '</div>';
      h += '<div style="margin-bottom:12px;"><button class="btn btn-primary btn-small" onclick="teamPtoRequestSelf()">+ Request Time Off</button></div>';
      h += '<div id="ptoSelfUsageForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div id="ptoSelfUsageFormInner"></div></div>';
      if (mine.length > 0) {
        h += '<h4 style="font-size:0.9rem;font-weight:600;margin-bottom:8px;">Your PTO History</h4>';
        h += renderPtoTable(mine);
      } else {
        h += '<div style="text-align:center;padding:30px;color:var(--warm-gray);"><p style="font-size:0.9rem;font-weight:500;">No PTO history yet</p></div>';
      }
      wrap.innerHTML = h;
    } catch (err) { if (wrap) wrap.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading PTO data.</div>'; }
  }

  function openPtoPolicyForm(empId) {
    var formEl = document.getElementById('ptoPolicyForm'), innerEl = document.getElementById('ptoPolicyFormInner');
    if (!formEl || !innerEl) return;
    var emp = employeesData.find(function(e) { return e._key === empId; });
    var policy = ptoPolicies[empId] || ptoPolicies['default'] || {};
    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">PTO Policy — ' + esc(emp ? emp.fullName : empId) + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += labelField('ptoPType', 'Accrual type', selectInput('ptoPType', [{ value: 'annual-grant', label: 'Annual Grant' }, { value: 'hourly', label: 'Hourly Accrual' }, { value: 'manual', label: 'Manual' }, { value: 'none', label: 'No PTO' }], policy.accrualType || 'annual-grant'));
    h += labelField('ptoPRate', 'Accrual rate (hrs)', numberInput('ptoPRate', policy.accrualRate || '', '0.5', 'e.g. 40'));
    h += labelField('ptoPMax', 'Max balance (hrs)', numberInput('ptoPMax', policy.maxBalance || '', '1', 'e.g. 80'));
    h += labelField('ptoPCarry', 'Carryover limit', numberInput('ptoPCarry', policy.carryoverLimit || '', '1', 'blank = unlimited'));
    h += labelField('ptoPDate', 'Effective date', dateInput('ptoPDate', policy.effectiveDate || new Date().toISOString().split('T')[0]));
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:12px;"><button class="btn btn-primary btn-small" data-emp="' + esc(empId) + '" onclick="teamPtoSavePolicy(this.dataset.emp)">Save Policy</button><button class="btn btn-secondary btn-small" onclick="document.getElementById(\'ptoPolicyForm\').style.display=\'none\'">Cancel</button></div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function savePtoPolicy(empId) {
    var pol = { employeeId: empId, accrualType: document.getElementById('ptoPType').value, accrualRate: parseFloat(document.getElementById('ptoPRate').value) || 0, maxBalance: parseFloat(document.getElementById('ptoPMax').value) || 0, carryoverLimit: parseFloat(document.getElementById('ptoPCarry').value) || null, effectiveDate: document.getElementById('ptoPDate').value || null, updatedAt: new Date().toISOString() };
    try {
      var existing = ptoPolicies[empId];
      if (existing && existing._key) { await MastDB.update('admin/ptoPolicy/' + existing._key, pol); }
      else { var key = MastDB.newKey('admin/ptoPolicy'); pol.id = key; pol.createdAt = new Date().toISOString(); await MastDB.set('admin/ptoPolicy/' + key, pol); }
      showToast('Policy saved');
      document.getElementById('ptoPolicyForm').style.display = 'none';
      ptoSelectedEmployeeId = empId;
      var wrap = document.getElementById('ptoDetailWrap');
      if (wrap) { wrap.innerHTML = '<div class="loading">Loading&hellip;</div>'; loadPtoDetail(empId); }
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  function openPtoUsageForm(empId, isSelf) {
    var cid = isSelf ? 'ptoSelfUsageForm' : 'ptoUsageForm', iid = isSelf ? 'ptoSelfUsageFormInner' : 'ptoUsageFormInner';
    var formEl = document.getElementById(cid), innerEl = document.getElementById(iid);
    if (!formEl || !innerEl) return;
    var emp = employeesData.find(function(e) { return e._key === empId; });
    var today = new Date().toISOString().split('T')[0];
    var typeOpts = isSelf ? [{ value: 'used', label: 'Time Off Used' }] : [{ value: 'used', label: 'Time Off Used' }, { value: 'accrual', label: 'Accrual' }, { value: 'adjustment', label: 'Adjustment' }];
    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (isSelf ? 'Request Time Off' : 'Record PTO — ' + esc(emp ? emp.fullName : '')) + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:10px;align-items:end;">';
    h += labelField('ptoEType', 'Type', selectInput('ptoEType', typeOpts, 'used'));
    h += labelField('ptoEDate', 'Date', dateInput('ptoEDate', today));
    h += labelField('ptoEHours', 'Hours', numberInput('ptoEHours', '', '0.5', '8'));
    h += labelField('ptoENotes', 'Notes', textInput('ptoENotes', '', 'Optional'));
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:12px;"><button class="btn btn-primary btn-small" data-emp="' + esc(empId) + '" data-self="' + (isSelf ? '1' : '0') + '" onclick="teamPtoSaveEntry(this.dataset.emp, this.dataset.self)">Save</button><button class="btn btn-secondary btn-small" onclick="document.getElementById(\'' + cid + '\').style.display=\'none\'">Cancel</button></div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function savePtoEntry(empId, isSelf) {
    var type = document.getElementById('ptoEType').value;
    var hours = parseFloat(document.getElementById('ptoEHours').value);
    var date = document.getElementById('ptoEDate').value;
    if (!hours || hours <= 0) { showToast('Hours required', true); return; }
    if (!date) { showToast('Date required', true); return; }
    try {
      var rawEntries = await MastDB.get('admin/ptoEntries') || {};
      var empEntries = Object.values(rawEntries).filter(function(e) { return e.employeeId === empId; }).sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
      var currentBalance = empEntries.length > 0 ? (empEntries[empEntries.length - 1].balance || 0) : 0;
      var hoursVal = type === 'used' ? -Math.abs(hours) : Math.abs(hours);
      var key = MastDB.newKey('admin/ptoEntries');
      await MastDB.set('admin/ptoEntries/' + key, { id: key, employeeId: empId, type: type, hours: hoursVal, date: date, notes: document.getElementById('ptoENotes').value.trim() || null, balance: currentBalance + hoursVal, createdAt: new Date().toISOString() });
      showToast('PTO entry saved');
      if (isSelf === '1') {
        document.getElementById('ptoSelfUsageForm').style.display = 'none';
        var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
        var wrap = document.getElementById('ptoSelfWrap');
        if (wrap) { wrap.innerHTML = '<div class="loading">Loading&hellip;</div>'; loadPtoSelf(uid); }
      } else {
        document.getElementById('ptoUsageForm').style.display = 'none';
        var wrap = document.getElementById('ptoDetailWrap');
        if (wrap) { wrap.innerHTML = '<div class="loading">Loading&hellip;</div>'; loadPtoDetail(empId); }
      }
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  // ========================================
  // Tab: Documents (Compliance Tracking)
  // ========================================
  function renderComplianceDocs() {
    var active = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; });
    var missingCount = 0;
    active.forEach(function(emp) {
      var cl = emp.complianceChecklist || {};
      COMPLIANCE_FIELDS.forEach(function(f) { if (!cl[f.key] || cl[f.key].status !== 'completed') missingCount++; });
    });

    var h = '';
    if (missingCount > 0) {
      h += '<div style="background:rgba(217,119,6,0.15);border:1px solid rgba(217,119,6,0.4);border-radius:6px;padding:10px 16px;margin-bottom:16px;font-size:0.85rem;color:#fbbf24;">⚠ <strong>' + missingCount + ' compliance gap' + (missingCount !== 1 ? 's' : '') + '</strong> across your team.</div>';
    } else if (active.length > 0) {
      h += '<div style="background:rgba(22,163,74,0.15);border:1px solid rgba(22,163,74,0.4);border-radius:6px;padding:10px 16px;margin-bottom:16px;font-size:0.85rem;color:#86efac;">✓ All employees have complete compliance documents on file.</div>';
    }

    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center;">';
    h += '<select id="docFiltEmp" onchange="teamDocFilter()" style="' + INPUT_STYLE + 'width:auto;min-width:160px;"><option value="">All employees</option>';
    active.forEach(function(emp) { h += '<option value="' + esc(emp._key) + '"' + (docFilterEmployee === emp._key ? ' selected' : '') + '>' + esc(emp.fullName || '') + '</option>'; });
    h += '</select>';
    h += '<select id="docFiltStatus" onchange="teamDocFilter()" style="' + INPUT_STYLE + 'width:auto;min-width:140px;"><option value="">All statuses</option><option value="completed"' + (docFilterStatus === 'completed' ? ' selected' : '') + '>On File</option><option value="missing"' + (docFilterStatus === 'missing' ? ' selected' : '') + '>Missing</option><option value="expired"' + (docFilterStatus === 'expired' ? ' selected' : '') + '>Expired</option></select>';
    h += '</div>';
    h += '<div id="docTableContainer">' + buildComplianceTable(active) + '</div>';
    h += '<div id="teamComplianceForm" style="display:none;margin-top:16px;"></div>';
    return h;
  }

  function buildComplianceTable(activeEmps) {
    var rows = [];
    activeEmps.forEach(function(emp) {
      if (docFilterEmployee && emp._key !== docFilterEmployee) return;
      var cl = emp.complianceChecklist || {};
      COMPLIANCE_FIELDS.forEach(function(f) {
        var item = cl[f.key] || {}, status = item.status || 'missing';
        if (status === 'completed' && item.expiryDate && Math.floor((new Date(item.expiryDate).getTime() - Date.now()) / 86400000) <= 0) status = 'expired';
        if (docFilterStatus && docFilterStatus !== status) return;
        rows.push({ emp: emp, field: f, item: item, status: status });
      });
    });
    if (rows.length === 0) return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No documents match the current filter.</div>';
    var h = '<div style="overflow-x:auto;"><table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
    h += '<thead><tr style="border-bottom:2px solid var(--cream-dark,var(--cream-dark));text-align:left;"><th style="padding:8px 10px;font-weight:600;">Employee</th><th style="padding:8px 10px;font-weight:600;">Document</th><th style="padding:8px 10px;font-weight:600;">Status</th><th style="padding:8px 10px;font-weight:600;">Storage</th><th style="padding:8px 10px;font-weight:600;">Last Updated</th><th style="padding:8px 10px;font-weight:600;"></th></tr></thead><tbody>';
    rows.forEach(function(row) {
      var sc = row.status === 'completed' ? '#16a34a' : row.status === 'expired' ? 'var(--danger)' : '#d97706';
      var sl = row.status === 'completed' ? '✓ On File' : row.status === 'expired' ? '⚠ Expired' : '⚠ Missing';
      h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
      h += '<td style="padding:8px 10px;font-weight:500;">' + esc(row.emp.fullName || '') + '</td>';
      h += '<td style="padding:8px 10px;">' + esc(row.field.label) + '</td>';
      h += '<td style="padding:8px 10px;"><span style="color:' + sc + ';font-weight:600;">' + sl + '</span>' + (row.item.expiryDate && row.status !== 'missing' ? '<div style="font-size:0.75rem;color:var(--warm-gray-light);">Expires ' + esc(row.item.expiryDate) + '</div>' : '') + '</td>';
      h += '<td style="padding:8px 10px;color:var(--warm-gray);">' + (row.item.storageLocation ? esc(capitalize(row.item.storageLocation.replace('-', ' '))) : '—') + '</td>';
      h += '<td style="padding:8px 10px;color:var(--warm-gray);">' + (row.item.updatedAt ? esc(row.item.updatedAt.split('T')[0]) : '—') + '</td>';
      h += '<td style="padding:8px 10px;"><button class="btn btn-secondary btn-small" data-emp="' + esc(row.emp._key) + '" data-key="' + esc(row.field.key) + '" onclick="teamEditCompliance(this.dataset.emp, this.dataset.key)">' + (row.status === 'completed' ? 'Update' : 'Mark On File') + '</button></td>';
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  // ========================================
  // Tab: Onboarding
  // ========================================
  var ONBOARDING_ITEMS = [
    { key: 'i9',               label: 'I-9 collected',            source: 'compliance' },
    { key: 'w4',               label: 'W-4 collected',            source: 'compliance' },
    { key: 'stateWithholding', label: 'State withholding form',   source: 'compliance' },
    { key: 'offerLetter',      label: 'Offer letter signed',      source: 'compliance' },
    { key: 'workersComp',      label: "Workers' comp certificate", source: 'compliance' },
    { key: 'addedToPayroll',   label: 'Added to payroll system',  source: 'onboarding' },
    { key: 'emergencyContact', label: 'Emergency contact on file', source: 'onboarding' },
  ];

  function isObItemDone(emp, key, source) {
    if (source === 'compliance') { var cl = emp.complianceChecklist || {}; return !!(cl[key] && cl[key].status === 'completed'); }
    if (key === 'emergencyContact') return !!(emp.emergencyContact && emp.emergencyContact.name);
    return !!((emp.onboardingChecklist || {})[key]);
  }

  function renderOnboarding() {
    var active = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; });
    var incomplete = active.filter(function(emp) { return ONBOARDING_ITEMS.some(function(item) { return !isObItemDone(emp, item.key, item.source); }); });

    var h = '';
    if (incomplete.length > 0) {
      h += '<div style="background:rgba(217,119,6,0.15);border:1px solid rgba(217,119,6,0.4);border-radius:6px;padding:10px 16px;margin-bottom:16px;font-size:0.85rem;color:#fbbf24;">⚠ <strong>' + incomplete.length + ' employee' + (incomplete.length !== 1 ? 's have' : ' has') + ' incomplete onboarding</strong></div>';
    } else if (active.length > 0) {
      h += '<div style="background:rgba(22,163,74,0.15);border:1px solid rgba(22,163,74,0.4);border-radius:6px;padding:10px 16px;margin-bottom:16px;font-size:0.85rem;color:#86efac;">✓ All employees have completed onboarding.</div>';
    }

    h += '<div style="display:flex;gap:8px;margin-bottom:16px;">';
    h += '<button class="btn btn-secondary btn-small' + (onboardingFilter === 'all' ? ' active' : '') + '" onclick="teamObFilter(\'all\')">All</button>';
    h += '<button class="btn btn-secondary btn-small' + (onboardingFilter === 'incomplete' ? ' active' : '') + '" onclick="teamObFilter(\'incomplete\')">Incomplete only</button>';
    h += '</div>';

    var toShow = onboardingFilter === 'incomplete' ? incomplete : active;
    if (toShow.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">All employees have completed onboarding.</div>';
    } else {
      toShow.forEach(function(emp) {
        var done = ONBOARDING_ITEMS.filter(function(item) { return isObItemDone(emp, item.key, item.source); }).length;
        var total = ONBOARDING_ITEMS.length, pct = Math.round(done / total * 100), allDone = done === total;
        h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        h += '<div><span style="font-weight:600;">' + esc(emp.fullName || '') + '</span>' + (emp.jobTitle ? ' <span style="color:var(--warm-gray);font-size:0.85rem;">— ' + esc(emp.jobTitle) + '</span>' : '') + (emp.startDate ? '<div style="font-size:0.78rem;color:var(--warm-gray-light);">Started ' + esc(emp.startDate) + '</div>' : '') + '</div>';
        h += '<div style="font-size:0.85rem;font-weight:600;color:' + (allDone ? '#16a34a' : '#d97706') + ';">' + done + ' / ' + total + ' complete</div>';
        h += '</div>';
        h += '<div style="height:4px;background:var(--cream-dark,#ddd);border-radius:2px;margin-bottom:10px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:' + (allDone ? '#16a34a' : '#d97706') + ';border-radius:2px;"></div></div>';
        h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;">';
        ONBOARDING_ITEMS.forEach(function(item) {
          var isDone = isObItemDone(emp, item.key, item.source);
          var isClickable = item.source === 'onboarding' && item.key !== 'emergencyContact';
          h += '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;padding:4px 6px;border-radius:4px;cursor:' + (isClickable ? 'pointer' : item.source === 'compliance' ? 'pointer' : 'default') + ';"';
          if (isClickable) h += ' data-emp="' + esc(emp._key) + '" data-key="' + esc(item.key) + '" onclick="teamObToggle(this.dataset.emp, this.dataset.key)"';
          else if (item.source === 'compliance') h += ' data-emp="' + esc(emp._key) + '" data-key="' + esc(item.key) + '" onclick="teamEditCompliance(this.dataset.emp, this.dataset.key)"';
          h += '>';
          h += '<span style="color:' + (isDone ? '#16a34a' : 'var(--warm-gray)') + ';font-size:1rem;">' + (isDone ? '☑' : '☐') + '</span>';
          h += '<span style="color:' + (isDone ? '' : 'var(--warm-gray)') + ';">' + esc(item.label) + '</span>';
          h += '</label>';
        });
        h += '</div></div>';
      });
    }
    return h;
  }

  async function toggleObItem(empId, key) {
    var emp = employeesData.find(function(e) { return e._key === empId; });
    if (!emp) return;
    var ob = emp.onboardingChecklist || {};
    var newVal = !ob[key];
    try {
      var patch = {}; patch[key] = newVal;
      await MastDB.update('admin/employees/' + empId + '/onboardingChecklist', patch);
      emp.onboardingChecklist = emp.onboardingChecklist || {};
      emp.onboardingChecklist[key] = newVal;
      var container = document.getElementById('teamTab');
      if (container) renderTeam(container);
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  // ========================================
  // Surface 1: Employee Roster
  // ========================================
  function renderRoster() {
    var h = '';
    var active = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; });
    var partTime = active.filter(function(e) { return e.employmentType === 'part-time'; });
    var gapCount = 0;
    active.forEach(function(emp) {
      var cl = emp.complianceChecklist || {};
      COMPLIANCE_FIELDS.forEach(function(f) {
        if (!cl[f.key] || cl[f.key].status !== 'completed') gapCount++;
      });
    });
    var totalMonthlyCost = active.reduce(function(s, e) { return s + calcMonthlyCost(e); }, 0);

    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<div>';
    h += '<h2 style="margin:0;">Your team</h2>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    h += active.length + ' active';
    if (partTime.length > 0) h += ' \u00b7 ' + partTime.length + ' part-time';
    if (gapCount > 0) h += ' \u00b7 <span style="color:#d97706;">\u26a0 ' + gapCount + ' compliance gap' + (gapCount !== 1 ? 's' : '') + '</span>';
    h += '</div>';
    if (active.length > 0) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:2px;">Monthly labor cost: <strong>' + fmtDollars(Math.round(totalMonthlyCost)) + '</strong></div>';
    }
    h += '</div>';
    h += '<button class="btn btn-primary" onclick="teamAddEmployee()">+ New Employee</button>';
    h += '</div>';

    h += '<div id="teamAddForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamAddFormInner"></div>';
    h += '</div>';

    h += '<div id="teamRosterCards">';
    if (active.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:1.6rem;margin-bottom:12px;">\ud83d\udc65</div>';
      h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No employees yet</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add your team members to track pay, hours, and compliance.</p>';
      h += '</div>';
    } else {
      active.forEach(function(emp) { h += renderEmployeeCard(emp); });
    }
    h += '</div>';
    return h;
  }

  function renderEmployeeCard(emp) {
    var h = '<div data-id="' + esc(emp._key) + '" onclick="teamViewEmployee(this.dataset.id)" style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,var(--cream-dark))\'">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div>';
    h += '<span style="font-weight:600;font-size:0.9rem;">\ud83d\udc64 ' + esc(emp.fullName || '') + '</span>';
    if (emp.preferredName) h += ' <span style="font-size:0.85rem;color:var(--warm-gray);">(' + esc(emp.preferredName) + ')</span>';
    if (emp.jobTitle) h += ' <span style="font-size:0.85rem;color:var(--warm-gray);">\u2014 ' + esc(emp.jobTitle) + '</span>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray,var(--warm-gray));margin-top:2px;">';
    if (emp.employmentType) h += capitalize(emp.employmentType.replace('-', ' '));
    h += ' \u00b7 ' + fmtRate(emp.payRate, emp.payType);
    if (emp.scheduledHoursPerWeek) h += ' \u00b7 ' + emp.scheduledHoursPerWeek + ' hrs/week';
    h += '</div>';
    h += '</div>';
    h += '<button class="btn btn-secondary btn-small" data-id="' + esc(emp._key) + '" onclick="event.stopPropagation();teamEditEmployee(this.dataset.id)">Edit</button>';
    h += '</div>';

    // Compliance summary
    var cl = emp.complianceChecklist || {};
    var badges = [];
    var hasGaps = false;
    COMPLIANCE_FIELDS.forEach(function(f) {
      var item = cl[f.key];
      if (item && item.status === 'completed') {
        badges.push('<span style="color:#16a34a;font-size:0.78rem;">\u2713 ' + esc(f.label) + '</span>');
      } else {
        hasGaps = true;
        if (f.key === 'workersComp') {
          badges.push('<span style="color:#d97706;font-size:0.78rem;">\u26a0 Workers comp missing</span>');
        }
      }
    });

    // Check for upcoming expiry
    var soonestExpiry = null;
    COMPLIANCE_FIELDS.forEach(function(f) {
      var item = cl[f.key];
      if (item && item.expiryDate) {
        var days = Math.floor((new Date(item.expiryDate).getTime() - Date.now()) / 86400000);
        if (days > 0 && days <= 90 && (soonestExpiry === null || days < soonestExpiry.days)) {
          soonestExpiry = { days: days, date: item.expiryDate };
        }
      }
    });

    if (!hasGaps) {
      var expiryNote = soonestExpiry ? ' \u00b7 Expires ' + soonestExpiry.date : '';
      h += '<div style="font-size:0.78rem;color:#16a34a;margin-top:4px;">\u2713 All documents on file' + expiryNote + '</div>';
    } else {
      h += '<div style="font-size:0.78rem;margin-top:4px;">' + badges.join(' \u00b7 ') + '</div>';
    }

    h += '</div>';
    return h;
  }

  // ========================================
  // Surface 2: Employee Detail
  // ========================================
  function renderEmployeeDetail() {
    var emp = employeesData.find(function(e) { return e._key === selectedEmployeeId; });
    if (!emp) return '<div style="color:var(--danger);">Employee not found.</div>';

    var h = '';
    h += '<button class="detail-back" onclick="teamSwitchView(\'roster\')">\u2190 Back to People</button>';

    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">';
    h += '<div>';
    h += '<h3 style="margin:0;">' + esc(emp.fullName || '') + '</h3>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    if (emp.jobTitle) h += esc(emp.jobTitle) + ' \u00b7 ';
    h += capitalize((emp.employmentType || '').replace('-', ' '));
    if (emp.startDate) h += ' \u00b7 Started ' + emp.startDate;
    if (emp.status === 'terminated') h += ' \u00b7 <span style="color:var(--danger);">Terminated' + (emp.terminationDate ? ' ' + emp.terminationDate : '') + '</span>';
    h += '</div>';
    h += '</div>';
    h += '<button class="btn btn-secondary btn-small" data-id="' + esc(emp._key) + '" onclick="teamEditEmployee(this.dataset.id)">Edit</button>';
    h += '</div>';

    // Edit form container (form renders here when Edit is clicked)
    h += '<div id="teamAddForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamAddFormInner"></div>';
    h += '</div>';

    // Detail body — hidden when edit form is open
    h += '<div id="teamDetailBody">';

    // --- Pay & Employment (always visible, no collapse) ---
    h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:0.9rem;">';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">\ud83d\udcb0 Pay</span><br><strong>' + fmtRate(emp.payRate, emp.payType) + '</strong></div>';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">Type</span><br><strong>' + esc(capitalize((emp.payType || 'not set').replace('-', ' '))) + '</strong></div>';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">\ud83d\udcc5 Schedule</span><br><strong>' + (emp.scheduledHoursPerWeek ? emp.scheduledHoursPerWeek + ' hrs/week' : 'not set') + '</strong></div>';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">Frequency</span><br><strong>' + esc(capitalize((emp.payFrequency || 'not set').replace('-', ' '))) + '</strong></div>';
    var monthly = calcMonthlyCost(emp);
    if (monthly > 0) h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">Monthly</span><br><strong>' + fmtDollars(monthly) + '</strong></div>';
    h += '</div></div>';

    // --- Contact & Personal (collapsible, open by default) ---
    var contactHtml = '';
    if (emp.phone) contactHtml += '<div style="font-size:0.85rem;margin-bottom:4px;">\ud83d\udcde ' + esc(emp.phone) + '</div>';
    if (emp.address && emp.address.street) {
      contactHtml += '<div style="font-size:0.85rem;margin-bottom:4px;">\ud83c\udfe0 ' + esc(emp.address.street);
      if (emp.address.city) contactHtml += ', ' + esc(emp.address.city);
      if (emp.address.state) contactHtml += ', ' + esc(emp.address.state);
      if (emp.address.zip) contactHtml += ' ' + esc(emp.address.zip);
      contactHtml += '</div>';
    }
    if (emp.ssnLast4) {
      contactHtml += '<div style="font-size:0.85rem;margin-bottom:4px;">\ud83d\udd12 SSN: \u2022\u2022\u2022-\u2022\u2022-' + esc(emp.ssnLast4) + '</div>';
    }
    if (emp.emergencyContact && emp.emergencyContact.name) {
      contactHtml += '<div style="font-size:0.85rem;margin-top:8px;">\ud83d\udea8 <strong>Emergency:</strong> ' + esc(emp.emergencyContact.name);
      if (emp.emergencyContact.phone) contactHtml += ' \u00b7 ' + esc(emp.emergencyContact.phone);
      if (emp.emergencyContact.relationship) contactHtml += ' (' + esc(emp.emergencyContact.relationship) + ')';
      contactHtml += '</div>';
    }
    if (!contactHtml) {
      contactHtml = '<div style="font-size:0.85rem;color:var(--warm-gray-light);">No contact info on file. Edit to add.</div>';
    }
    h += collapsibleSection('secContact', 'Contact & Personal', contactHtml);

    // --- Compliance Checklist (collapsible, open by default) ---
    var cl = emp.complianceChecklist || {};
    var compGaps = 0;
    var compHtml = '';
    COMPLIANCE_FIELDS.forEach(function(f) {
      var item = cl[f.key] || {};
      var status = item.status || 'missing';
      var statusColor = status === 'completed' ? '#16a34a' : status === 'not-applicable' ? 'var(--warm-gray-light)' : '#d97706';
      var statusIcon = status === 'completed' ? '\u2713' : status === 'not-applicable' ? '\u2014' : '\u26a0';
      var statusLabel = status === 'completed' ? 'Complete' : status === 'not-applicable' ? 'N/A' : 'Missing';
      if (status !== 'completed' && status !== 'not-applicable') compGaps++;

      compHtml += '<div data-emp="' + esc(emp._key) + '" data-key="' + esc(f.key) + '" onclick="teamEditCompliance(this.dataset.emp, this.dataset.key)" style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:10px 14px;margin-bottom:6px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,var(--cream-dark))\'">';
      compHtml += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      compHtml += '<div>';
      compHtml += '<span style="font-weight:500;font-size:0.9rem;">' + esc(f.label) + '</span>';
      if (item.storageLocation) compHtml += ' <span style="font-size:0.78rem;color:var(--warm-gray);">\u00b7 ' + esc(capitalize(item.storageLocation.replace('-', ' '))) + '</span>';
      if (item.expiryDate) {
        var daysToExpiry = Math.floor((new Date(item.expiryDate).getTime() - Date.now()) / 86400000);
        if (daysToExpiry <= 90 && daysToExpiry > 0) compHtml += ' <span style="font-size:0.78rem;color:#d97706;">\u26a0 expires in ' + daysToExpiry + 'd</span>';
        else if (daysToExpiry <= 0) compHtml += ' <span style="font-size:0.78rem;color:var(--danger);">Expired</span>';
      }
      compHtml += '</div>';
      compHtml += '<span style="color:' + statusColor + ';font-weight:600;font-size:0.85rem;">' + statusIcon + ' ' + statusLabel + '</span>';
      compHtml += '</div>';
      if (f.key === 'workersComp' && status !== 'completed') {
        compHtml += '<div style="font-size:0.72rem;color:#d97706;margin-top:4px;">Required in most states from your first employee. Check with your insurance agent if unsure.</div>';
      }
      if (item.driveFileName) {
        compHtml += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">\ud83d\udcc4 ' + esc(item.driveFileName);
        if (item.driveLastModified) compHtml += ' \u00b7 Modified ' + item.driveLastModified.split('T')[0];
        compHtml += '</div>';
      }
      compHtml += '</div>';
    });
    compHtml += '<div id="teamComplianceForm" style="display:none;"></div>';
    var compBadge = compGaps > 0 ? '<span style="color:#d97706;font-size:0.78rem;">\u26a0 ' + compGaps + ' gap' + (compGaps !== 1 ? 's' : '') + '</span>' : '<span style="color:#16a34a;font-size:0.78rem;">\u2713 Complete</span>';
    h += collapsibleSection('secCompliance', 'Compliance Checklist', compHtml, { badge: compBadge });

    // --- Employee Documents (collapsible, closed by default) ---
    var docs = [];
    var empDocs = emp.documents || {};
    if (Array.isArray(empDocs)) {
      docs = empDocs.map(function(d, i) { d._key = d.documentId || String(i); return d; });
    } else {
      docs = Object.entries(empDocs).map(function(e) { var d = e[1]; d._key = e[0]; return d; });
    }
    var docsHtml = '<div id="teamEmpDocForm" style="display:none;"></div>';
    if (docs.length === 0) {
      docsHtml += '<div style="font-size:0.85rem;color:var(--warm-gray);">No documents on file.</div>';
    } else {
      docs.forEach(function(doc) { docsHtml += renderDocCard(doc, false, emp._key); });
    }
    var docsRight = '<button class="btn btn-primary btn-small" data-emp="' + esc(emp._key) + '" onclick="event.stopPropagation();teamExpandAndAdd(\'secDocs\');teamAddEmpDoc(this.dataset.emp)">+ New Document</button>';
    h += collapsibleSection('secDocs', 'Documents', docsHtml, { open: docs.length > 0, badge: '<span style="font-size:0.78rem;color:var(--warm-gray);">' + docs.length + '</span>', rightHtml: docsRight });

    // --- Hours Log (collapsible, closed by default) ---
    var hoursLog = emp.hoursLog || {};
    var hoursCount = typeof hoursLog === 'object' ? Object.keys(hoursLog).length : 0;
    var hoursRight = '<button class="btn btn-primary btn-small" data-id="' + esc(emp._key) + '" onclick="event.stopPropagation();teamExpandAndAdd(\'secHours\');teamLogHours(this.dataset.id)">+ Log Hours</button>';
    h += collapsibleSection('secHours', 'Hours Log', renderHoursSection(emp), { open: false, badge: hoursCount > 0 ? '<span style="font-size:0.78rem;color:var(--warm-gray);">' + hoursCount + ' entries</span>' : '', rightHtml: hoursRight });

    // --- References (collapsible, closed by default) ---
    var refsData = emp.references || {};
    var refsCount = Array.isArray(refsData) ? refsData.length : Object.keys(refsData).length;
    var refsRight = '<button class="btn btn-primary btn-small" data-emp="' + esc(emp._key) + '" onclick="event.stopPropagation();teamExpandAndAdd(\'secRefs\');teamAddReference(this.dataset.emp)">+ New Reference</button>';
    h += collapsibleSection('secRefs', 'References', renderReferencesSection(emp), { open: false, badge: refsCount > 0 ? '<span style="font-size:0.78rem;color:var(--warm-gray);">' + refsCount + '</span>' : '', rightHtml: refsRight });

    h += '</div>'; // close teamDetailBody
    return h;
  }

  // ========================================
  // Compliance Checklist Edit
  // ========================================
  function openComplianceForm(empId, fieldKey) {
    var emp = employeesData.find(function(e) { return e._key === empId; });
    if (!emp) return;
    var cl = emp.complianceChecklist || {};
    var item = cl[fieldKey] || {};
    var fieldLabel = COMPLIANCE_FIELDS.find(function(f) { return f.key === fieldKey; });

    var formEl = document.getElementById('teamComplianceForm');
    if (!formEl) return;

    var h = '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">Edit: ' + esc(fieldLabel ? fieldLabel.label : fieldKey) + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    h += labelField('compStatus', 'Status', selectInput('compStatus', [
      { value: 'missing', label: 'Missing' },
      { value: 'completed', label: 'Completed' },
      { value: 'not-applicable', label: 'Not Applicable' },
    ], item.status || 'missing'));

    h += labelField('compStorage', 'Storage location', selectInput('compStorage', [{ value: '', label: 'Not specified' }].concat(STORAGE_OPTIONS), item.storageLocation || ''));

    h += labelField('compDate', 'Completed date', dateInput('compDate', item.completedDate || ''));
    h += labelField('compExpiry', 'Expiry date', dateInput('compExpiry', item.expiryDate || ''));

    h += renderDriveUrlField('comp', item.url || '', item);
    h += fullWidthDiv(labelField('compNotes', 'Notes', textInput('compNotes', item.notes || '', 'Optional')));

    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;">';
    h += '<button class="btn btn-primary" data-emp="' + esc(empId) + '" data-key="' + esc(fieldKey) + '" onclick="teamSaveCompliance(this.dataset.emp, this.dataset.key)">Save</button>';
    h += '<button class="btn btn-secondary" onclick="document.getElementById(\'teamComplianceForm\').style.display=\'none\'">Cancel</button>';
    h += '</div>';
    h += '</div>';

    formEl.innerHTML = h;
    formEl.style.display = '';
    attachDriveUrlListener('comp', 'compStorage');
  }

  async function saveCompliance(empId, fieldKey) {
    var driveFields = collectDriveFields('comp');
    var fields = {
      status: document.getElementById('compStatus').value,
      storageLocation: document.getElementById('compStorage').value || null,
      completedDate: document.getElementById('compDate').value || null,
      expiryDate: document.getElementById('compExpiry').value || null,
      url: document.getElementById('compUrl').value.trim() || null,
      notes: document.getElementById('compNotes').value.trim() || null,
      driveFileId: driveFields.driveFileId,
      driveFileName: driveFields.driveFileName,
      driveLastModified: driveFields.driveLastModified,
      updatedAt: new Date().toISOString(),
    };
    try {
      await MastDB.update('admin/employees/' + empId + '/complianceChecklist/' + fieldKey, fields);
      showToast('Compliance item saved');
      document.getElementById('teamComplianceForm').style.display = 'none';
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Hours Section
  // ========================================
  function renderHoursSection(emp) {
    var h = '';

    h += '<div id="teamHoursForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamHoursFormInner"></div>';
    h += '</div>';
    h += '<div id="teamHoursTable" style="font-size:0.85rem;color:var(--warm-gray);">Loading hours\u2026</div>';

    setTimeout(function() { loadHoursForEmployee(emp._key); }, 0);
    return h;
  }

  async function loadHoursForEmployee(empId) {
    var container = document.getElementById('teamHoursTable');
    if (!container) return;
    try {
      var eightWeeksAgo = new Date();
      eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
      var data = await MastDB.query('admin/employees/' + empId + '/hoursLog')
        .orderByChild('date')
        .startAt(eightWeeksAgo.toISOString().split('T')[0])
        .once() || {};
      var entries = Object.values(data).sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });

      if (entries.length === 0) {
        container.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;">No hours logged recently.</div>';
        return;
      }

      // Check week total for overtime warning
      var weekTotals = {};
      entries.forEach(function(e) {
        var d = new Date(e.date);
        var weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        var wk = weekStart.toISOString().split('T')[0];
        weekTotals[wk] = (weekTotals[wk] || 0) + (e.hoursWorked || 0) + (e.overtimeHours || 0);
      });

      // Current week warning
      var now = new Date();
      var currentWeekStart = new Date(now);
      currentWeekStart.setDate(now.getDate() - now.getDay());
      var currentWeekKey = currentWeekStart.toISOString().split('T')[0];
      var currentWeekTotal = weekTotals[currentWeekKey] || 0;

      var h = '';
      if (currentWeekTotal >= 38) {
        h += '<div style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:0.85rem;color:#fbbf24;">\u26a0 This employee has logged ' + currentWeekTotal.toFixed(1) + ' hours this week \u2014 approaching overtime.</div>';
      }

      h += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
      h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));"><th style="text-align:left;padding:6px 8px;font-weight:600;">Date</th><th style="text-align:right;padding:6px 8px;font-weight:600;">Hours</th><th style="text-align:right;padding:6px 8px;font-weight:600;">OT</th><th style="text-align:left;padding:6px 8px;font-weight:600;">Notes</th></tr>';
      entries.slice(0, 20).forEach(function(entry) {
        h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
        h += '<td style="padding:6px 8px;">' + esc(entry.date || '') + '</td>';
        h += '<td style="padding:6px 8px;text-align:right;">' + (entry.hoursWorked || 0) + '</td>';
        h += '<td style="padding:6px 8px;text-align:right;">' + (entry.overtimeHours > 0 ? entry.overtimeHours : '\u2014') + '</td>';
        h += '<td style="padding:6px 8px;color:var(--warm-gray);">' + esc(entry.notes || '') + '</td>';
        h += '</tr>';
      });
      h += '</table>';
      container.innerHTML = h;
    } catch (err) {
      container.innerHTML = '<div style="color:var(--danger);">Error loading hours.</div>';
    }
  }

  function openLogHoursForm(empId) {
    var formEl = document.getElementById('teamHoursForm');
    var innerEl = document.getElementById('teamHoursFormInner');
    if (!formEl || !innerEl) return;

    var today = new Date().toISOString().split('T')[0];
    var h = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:10px;align-items:end;">';
    h += labelField('hoursDate', 'Date', dateInput('hoursDate', today));
    h += labelField('hoursWorked', 'Hours', numberInput('hoursWorked', '', '0.5', '8'));
    h += labelField('hoursOT', 'Overtime', numberInput('hoursOT', '0', '0.5', '0'));
    h += labelField('hoursNotes', 'Notes', textInput('hoursNotes', '', 'Optional'));
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:10px;">';
    h += '<button class="btn btn-primary btn-small" data-id="' + esc(empId) + '" onclick="teamSaveHours(this.dataset.id)">Save</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="document.getElementById(\'teamHoursForm\').style.display=\'none\'">Cancel</button>';
    h += '</div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function saveHours(empId) {
    var hours = parseFloat(document.getElementById('hoursWorked').value);
    if (!hours || hours <= 0) { showToast('Hours required', true); return; }
    var record = {
      date: document.getElementById('hoursDate').value,
      hoursWorked: hours,
      overtimeHours: parseFloat(document.getElementById('hoursOT').value) || 0,
      notes: document.getElementById('hoursNotes').value.trim() || null,
      loggedBy: auth.currentUser ? auth.currentUser.uid : 'admin',
      createdAt: new Date().toISOString(),
    };
    try {
      var logKey = MastDB.newKey('admin/employees/' + empId + '/hoursLog');
      record.logId = logKey;
      await MastDB.set('admin/employees/' + empId + '/hoursLog/' + logKey, record);
      showToast('Hours logged');
      document.getElementById('teamHoursForm').style.display = 'none';
      loadHoursForEmployee(empId);
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // References Section
  // ========================================
  function renderReferencesSection(emp) {
    var refs = emp.references || {};
    var refList = [];
    if (Array.isArray(refs)) {
      refList = refs.map(function(r, i) { r._key = r.referenceId || String(i); return r; });
    } else {
      refList = Object.entries(refs).map(function(e) { var r = e[1]; r._key = e[0]; return r; });
    }

    var h = '';
    h += '<div id="teamRefForm" style="display:none;"></div>';

    if (refList.length === 0) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">No references on file.</div>';
    } else {
      refList.forEach(function(ref) {
        var outcomeColor = ref.outcome === 'concerning' ? '#d97706' : ref.outcome === 'positive' ? '#16a34a' : 'var(--warm-gray)';
        h += '<div data-emp="' + esc(emp._key) + '" data-ref="' + esc(ref._key) + '" onclick="teamEditReference(this.dataset.emp, this.dataset.ref)" style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:10px 14px;margin-bottom:6px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,var(--cream-dark))\'">';
        h += '<div>';
        h += '<span style="font-weight:500;">' + esc(ref.name || '') + '</span>';
        if (ref.phone) h += ' <span style="font-size:0.85rem;color:var(--warm-gray);">' + esc(ref.phone) + '</span>';
        if (ref.relationship) h += ' <span style="font-size:0.85rem;color:var(--warm-gray);">(' + esc(ref.relationship) + ')</span>';
        h += ' <span class="status-badge" style="background:' + outcomeColor + '22;color:' + outcomeColor + ';">' + esc(capitalize((ref.outcome || 'not-checked').replace('-', ' '))) + '</span>';
        if (ref.checkedDate) h += ' <span style="font-size:0.78rem;color:var(--warm-gray-light);">' + esc(ref.checkedDate) + '</span>';
        h += '</div>';
        if (ref.notes) h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">' + esc(ref.notes) + '</div>';
        h += '</div>';
      });
    }
    return h;
  }

  var editingRefId = null;
  function openReferenceForm(empId, refId) {
    editingRefId = refId;
    var emp = employeesData.find(function(e) { return e._key === empId; });
    if (!emp) return;
    var refs = emp.references || {};
    var ref = {};
    if (refId) {
      if (Array.isArray(refs)) {
        ref = refs.find(function(r) { return (r.referenceId || '') === refId; }) || {};
      } else {
        ref = refs[refId] || {};
      }
    }

    var formEl = document.getElementById('teamRefForm');
    if (!formEl) return;

    var h = '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (refId ? 'Edit Reference' : 'New Reference') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    h += labelField('refName', 'Name', textInput('refName', ref.name || '', 'Reference name'));
    h += labelField('refPhone', 'Phone', textInput('refPhone', ref.phone || '', '555-555-5555'));
    h += labelField('refRelationship', 'Relationship', textInput('refRelationship', ref.relationship || '', 'e.g. Former employer'));
    h += labelField('refOutcome', 'Outcome', selectInput('refOutcome', REFERENCE_OUTCOMES.map(function(o) { return { value: o, label: capitalize(o.replace('-', ' ')) }; }), ref.outcome || 'not-checked'));
    h += labelField('refCheckedDate', 'Checked date', dateInput('refCheckedDate', ref.checkedDate || ''));
    h += labelField('refNotes', 'Notes', textInput('refNotes', ref.notes || '', 'Optional'));

    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';
    h += '<button class="btn btn-primary" data-emp="' + esc(empId) + '" onclick="teamSaveReference(this.dataset.emp)">' + (refId ? 'Save' : 'Create Reference') + '</button>';
    h += '<button class="btn btn-secondary" onclick="document.getElementById(\'teamRefForm\').style.display=\'none\'">Cancel</button>';
    if (refId) {
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" data-emp="' + esc(empId) + '" data-ref="' + esc(refId) + '" onclick="teamDeleteReference(this.dataset.emp, this.dataset.ref)">Delete</button></span>';
    }
    h += '</div>';
    h += '</div>';

    formEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function saveReference(empId) {
    var name = document.getElementById('refName').value.trim();
    if (!name) { showToast('Name is required', true); return; }
    var fields = {
      name: name,
      phone: document.getElementById('refPhone').value.trim() || null,
      relationship: document.getElementById('refRelationship').value.trim() || null,
      outcome: document.getElementById('refOutcome').value,
      checkedDate: document.getElementById('refCheckedDate').value || null,
      notes: document.getElementById('refNotes').value.trim() || null,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editingRefId) {
        await MastDB.update('admin/employees/' + empId + '/references/' + editingRefId, fields);
        showToast('Reference saved');
      } else {
        fields.createdAt = new Date().toISOString();
        var refKey = MastDB.newKey('admin/employees/' + empId + '/references');
        fields.referenceId = refKey;
        await MastDB.set('admin/employees/' + empId + '/references/' + refKey, fields);
        showToast('Reference created');
      }
      editingRefId = null;
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteReference(empId, refId) {
    if (!await mastConfirm('Delete this reference? This cannot be undone.', { title: 'Delete Reference', danger: true })) return;
    try {
      await MastDB.remove('admin/employees/' + empId + '/references/' + refId);
      showToast('Reference deleted');
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Surface 3: Tenant Documents
  // ========================================
  function renderTenantDocs() {
    var h = '';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<h2 style="margin:0;">Business Documents</h2>';
    h += '<button class="btn btn-primary" onclick="teamAddTenantDoc()">+ New Document</button>';
    h += '</div>';

    h += '<div id="teamDocForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamDocFormInner"></div>';
    h += '</div>';

    h += '<div id="teamDocCards">';
    if (tenantDocs.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:1.6rem;margin-bottom:12px;">\ud83d\udcc4</div>';
      h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No business documents</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Track business licenses, insurance certificates, leases, and permits.</p>';
      h += '</div>';
    } else {
      tenantDocs.forEach(function(doc) { h += renderDocCard(doc, true, null); });
    }
    h += '</div>';
    return h;
  }

  function renderDocCard(doc, isTenantLevel, empId) {
    var docKey = esc(doc._key || doc.documentId || '');
    var clickAction = '';
    if (isTenantLevel) {
      clickAction = 'teamEditTenantDoc(\'' + docKey + '\')';
    } else if (empId) {
      clickAction = 'teamEditEmpDoc(\'' + esc(empId) + '\', \'' + docKey + '\')';
    }
    var h = '<div' + (clickAction ? ' onclick="' + clickAction + '"' : '') + ' style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:12px 16px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);' + (clickAction ? 'cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,var(--cream-dark))\'"' : '"') + '>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div style="font-weight:600;font-size:0.9rem;">\ud83d\udcc4 ' + esc(doc.title || 'Untitled') + '</div>';
    h += '</div>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    var parts = [];
    if (doc.type) parts.push(capitalize(doc.type));
    if (doc.storageLocation) parts.push(capitalize(doc.storageLocation.replace('-', ' ')));
    h += parts.join(' \u00b7 ');

    if (doc.driveFileName) {
      h += '<div style="margin-top:2px;">\ud83d\udcc4 ' + esc(doc.driveFileName);
      if (doc.driveLastModified) h += ' \u00b7 Modified ' + doc.driveLastModified.split('T')[0];
      h += '</div>';
    }

    if (doc.url) {
      h += '<div style="margin-top:2px;"><a href="' + esc(doc.url) + '" target="_blank" rel="noopener" style="color:var(--teal);font-size:0.78rem;">\ud83d\udd17 View document</a></div>';
    }

    if (doc.expiryDate) {
      var daysToExpiry = Math.floor((new Date(doc.expiryDate).getTime() - Date.now()) / 86400000);
      if (daysToExpiry <= 0) {
        h += '<div style="color:var(--danger);opacity:0.8;margin-top:2px;">Expired ' + doc.expiryDate + '</div>';
      } else if (daysToExpiry <= 90) {
        h += '<div style="color:#d97706;margin-top:2px;">\u26a0 Expires in ' + daysToExpiry + ' days (' + doc.expiryDate + ')</div>';
      } else {
        h += '<div style="margin-top:2px;">Expires ' + doc.expiryDate + '</div>';
      }
    }
    h += '</div></div>';
    return h;
  }

  // ========================================
  // Document Forms (shared for tenant + employee)
  // ========================================
  function openDocForm(docId, isTenantLevel, empId) {
    editingDocId = docId;
    var doc = {};
    if (docId && isTenantLevel) {
      doc = tenantDocs.find(function(d) { return d._key === docId || d.documentId === docId; }) || {};
    } else if (docId && empId) {
      var emp = employeesData.find(function(e) { return e._key === empId; });
      if (emp) {
        var empDocs = emp.documents || {};
        if (Array.isArray(empDocs)) {
          doc = empDocs.find(function(d) { return (d.documentId || d._key) === docId; }) || {};
        } else {
          doc = empDocs[docId] || {};
        }
      }
    }
    var isNew = !docId;

    var containerId = isTenantLevel ? 'teamDocForm' : 'teamEmpDocForm';
    var innerId = isTenantLevel ? 'teamDocFormInner' : null;
    var formEl = document.getElementById(containerId);
    if (!formEl) return;

    var h = '';
    if (!isTenantLevel) {
      h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    }
    h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (isNew ? 'New Document' : 'Edit Document') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    h += labelField('docTitle', 'Title', textInput('docTitle', doc.title || '', 'e.g. Business License'));
    h += labelField('docType', 'Type', selectInput('docType', DOC_TYPES.map(function(t) { return { value: t, label: capitalize(t) }; }), doc.type || 'other'));
    h += labelField('docStorage', 'Storage', selectInput('docStorage', [{ value: '', label: 'Not specified' }].concat(STORAGE_OPTIONS), doc.storageLocation || ''));
    h += labelField('docExpiry', 'Expiry date', dateInput('docExpiry', doc.expiryDate || ''));
    h += labelField('docStatus', 'Status', selectInput('docStatus', [
      { value: 'current', label: 'Current' },
      { value: 'pending', label: 'Pending' },
      { value: 'expired', label: 'Expired' },
      { value: 'not-applicable', label: 'Not Applicable' },
    ], doc.status || 'current'));
    h += labelField('docOnFile', 'On file date', dateInput('docOnFile', doc.onFileDate || ''));
    h += renderDriveUrlField('doc', doc.url || '', doc);
    h += fullWidthDiv(labelField('docDesc', 'Description', textInput('docDesc', doc.description || '', 'Optional')));
    h += fullWidthDiv(labelField('docNotes', 'Notes', textInput('docNotes', doc.notes || '', 'Optional')));

    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';

    var saveAttr = isTenantLevel ? 'onclick="teamSaveDoc()"' : 'data-emp="' + esc(empId || '') + '" onclick="teamSaveEmpDoc(this.dataset.emp)"';
    h += '<button class="btn btn-primary" ' + saveAttr + '>' + (isNew ? 'Create Document' : 'Save') + '</button>';
    var cancelFn = isTenantLevel ? 'teamCancelDocForm()' : 'document.getElementById(\'teamEmpDocForm\').style.display=\'none\'';
    h += '<button class="btn btn-secondary" onclick="' + cancelFn + '">Cancel</button>';
    if (!isNew) {
      var deleteAttr = isTenantLevel
        ? 'data-id="' + esc(docId) + '" onclick="teamDeleteDoc(this.dataset.id)"'
        : 'data-emp="' + esc(empId || '') + '" data-id="' + esc(docId) + '" onclick="teamDeleteEmpDoc(this.dataset.emp, this.dataset.id)"';
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" ' + deleteAttr + '>Delete</button></span>';
    }
    h += '</div>';
    if (!isTenantLevel) h += '</div>';

    if (innerId) {
      document.getElementById(innerId).innerHTML = h;
    } else {
      formEl.innerHTML = h;
    }
    formEl.style.display = '';
    // Hide doc cards while form is open
    var docCards = document.getElementById('teamDocCards');
    if (docCards) docCards.style.display = 'none';
    setTimeout(function() {
      var el = document.getElementById('docTitle');
      if (el) el.focus();
      attachDriveUrlListener('doc', 'docStorage');
    }, 0);
  }

  function collectDocFields() {
    var driveFields = collectDriveFields('doc');
    return {
      title: document.getElementById('docTitle').value.trim(),
      type: document.getElementById('docType').value,
      storageLocation: document.getElementById('docStorage').value || null,
      expiryDate: document.getElementById('docExpiry').value || null,
      status: document.getElementById('docStatus').value || 'current',
      onFileDate: document.getElementById('docOnFile').value || null,
      url: document.getElementById('docUrl').value.trim() || null,
      description: document.getElementById('docDesc').value.trim() || null,
      notes: document.getElementById('docNotes').value.trim() || null,
      driveFileId: driveFields.driveFileId,
      driveFileName: driveFields.driveFileName,
      driveLastModified: driveFields.driveLastModified,
      updatedAt: new Date().toISOString(),
    };
  }

  async function saveDoc() {
    var fields = collectDocFields();
    if (!fields.title) { showToast('Title is required', true); return; }
    try {
      if (editingDocId) {
        await MastDB.update('admin/documents/' + editingDocId, fields);
        showToast('Document saved');
      } else {
        fields.createdAt = new Date().toISOString();
        fields.documentId = MastDB.newKey('admin/documents');
        await MastDB.set('admin/documents/' + fields.documentId, fields);
        showToast('Document created');
      }
      editingDocId = null;
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function saveEmpDoc(empId) {
    var fields = collectDocFields();
    if (!fields.title) { showToast('Title is required', true); return; }
    try {
      if (editingDocId) {
        await MastDB.update('admin/employees/' + empId + '/documents/' + editingDocId, fields);
        showToast('Document saved');
      } else {
        fields.createdAt = new Date().toISOString();
        var docKey = MastDB.newKey('admin/employees/' + empId + '/documents');
        fields.documentId = docKey;
        await MastDB.set('admin/employees/' + empId + '/documents/' + docKey, fields);
        showToast('Document created');
      }
      editingDocId = null;
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteDoc(docId) {
    if (!await mastConfirm('Delete this document? This cannot be undone.', { title: 'Delete Document', danger: true })) return;
    try {
      await MastDB.remove('admin/documents/' + docId);
      showToast('Document deleted');
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteEmpDoc(empId, docId) {
    if (!await mastConfirm('Delete this document? This cannot be undone.', { title: 'Delete Document', danger: true })) return;
    try {
      await MastDB.remove('admin/employees/' + empId + '/documents/' + docId);
      showToast('Document deleted');
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Employee Add/Edit Form (Full)
  // ========================================
  function openAddEmployeeForm(empId) {
    editingEmployeeId = empId;
    var emp = empId ? employeesData.find(function(e) { return e._key === empId; }) : {};
    if (!emp) emp = {};
    var isNew = !empId;
    var addr = emp.address || {};
    var ec = emp.emergencyContact || {};

    var formEl = document.getElementById('teamAddForm');
    var innerEl = document.getElementById('teamAddFormInner');
    if (!formEl || !innerEl) return;

    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (isNew ? 'New Employee' : 'Edit Employee') + '</div>';

    // Identity & Contact
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--teal);margin-bottom:8px;">Identity & Contact</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">';
    h += labelField('teamEmpName', 'Full name', textInput('teamEmpName', emp.fullName || '', ''));
    h += labelField('teamEmpPreferred', 'Preferred name', textInput('teamEmpPreferred', emp.preferredName || '', 'Optional'));
    h += labelField('teamEmpPhone', 'Phone', textInput('teamEmpPhone', emp.phone || '', '555-555-5555'));
    h += labelField('teamEmpSsn', 'Last 4 of SSN (reference only)', textInput('teamEmpSsn', emp.ssnLast4 || '', '1234'));
    h += '<div style="grid-column:1/-1;font-size:0.72rem;color:var(--warm-gray);margin-top:-8px;">We only store the last 4 digits as a reference \u2014 full SSN should be in Gusto or your payroll system.</div>';
    h += fullWidthDiv(labelField('teamEmpStreet', 'Street address', textInput('teamEmpStreet', addr.street || '', '')));
    h += labelField('teamEmpCity', 'City', textInput('teamEmpCity', addr.city || '', ''));
    h += labelField('teamEmpState', 'State', textInput('teamEmpState', addr.state || '', ''));
    h += labelField('teamEmpZip', 'ZIP', textInput('teamEmpZip', addr.zip || '', ''));
    h += '</div>';

    // Emergency Contact
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--teal);margin-bottom:8px;">Emergency Contact</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">';
    h += labelField('teamEcName', 'Name', textInput('teamEcName', ec.name || '', ''));
    h += labelField('teamEcPhone', 'Phone', textInput('teamEcPhone', ec.phone || '', ''));
    h += labelField('teamEcRelation', 'Relationship', textInput('teamEcRelation', ec.relationship || '', 'e.g. Spouse'));
    h += '</div>';

    // Employment
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--teal);margin-bottom:8px;">Employment</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">';
    h += labelField('teamEmpTitle', 'Job title', textInput('teamEmpTitle', emp.jobTitle || '', 'e.g. Studio assistant'));
    h += labelField('teamEmpType', 'Employment type', selectInput('teamEmpType', EMPLOYMENT_TYPES.map(function(t) { return { value: t, label: capitalize(t.replace('-', ' ')) }; }), emp.employmentType || 'part-time'));
    h += labelField('teamEmpStart', 'Start date', dateInput('teamEmpStart', emp.startDate || ''));
    h += labelField('teamEmpStatus', 'Status', selectInput('teamEmpStatus', [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'terminated', label: 'Terminated' },
    ], emp.status || 'active'));
    h += '<div id="teamTermDateWrap" style="' + (emp.status === 'terminated' ? '' : 'display:none;') + '">';
    h += labelField('teamEmpTermDate', 'Termination date', dateInput('teamEmpTermDate', emp.terminationDate || ''));
    h += '</div>';
    h += '</div>';

    // Pay
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--teal);margin-bottom:8px;">Pay</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">';
    h += labelField('teamEmpPayType', 'Pay type', selectInput('teamEmpPayType', PAY_TYPES.map(function(t) { return { value: t, label: capitalize(t.replace('-', ' ')) }; }), emp.payType || 'hourly'));
    h += labelField('teamEmpRate', 'Pay rate ($)', numberInput('teamEmpRate', emp.payRate ? (emp.payRate / 100).toFixed(2) : '', '0.01', emp.payType === 'salary' ? '$/month' : '$/hr'));
    h += labelField('teamEmpFreq', 'Pay frequency', selectInput('teamEmpFreq', PAY_FREQUENCIES.map(function(t) { return { value: t, label: capitalize(t.replace('-', ' ')) }; }), emp.payFrequency || 'bi-weekly'));
    h += labelField('teamEmpHours', 'Scheduled hours/week', numberInput('teamEmpHours', emp.scheduledHoursPerWeek || '', '1', ''));
    h += '</div>';

    // Buttons
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';
    h += '<button class="btn btn-primary" onclick="teamSaveEmployee()">' + (isNew ? 'Create Employee' : 'Save') + '</button>';
    h += '<button class="btn btn-secondary" onclick="teamCancelAddForm()">Cancel</button>';
    if (!isNew) {
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" data-id="' + esc(empId) + '" onclick="teamDeleteEmployee(this.dataset.id)">Delete</button></span>';
    }
    h += '</div>';

    innerEl.innerHTML = h;
    formEl.style.display = '';

    // Hide roster cards and detail body while form is open
    var cards = document.getElementById('teamRosterCards');
    if (cards) cards.style.display = 'none';
    var detailBody = document.getElementById('teamDetailBody');
    if (detailBody) detailBody.style.display = 'none';

    // Toggle termination date visibility
    var statusSel = document.getElementById('teamEmpStatus');
    if (statusSel) {
      statusSel.addEventListener('change', function() {
        var wrap = document.getElementById('teamTermDateWrap');
        if (wrap) wrap.style.display = this.value === 'terminated' ? '' : 'none';
      });
    }

    setTimeout(function() { var el = document.getElementById('teamEmpName'); if (el) el.focus(); }, 0);
  }

  async function saveEmployee() {
    var name = document.getElementById('teamEmpName').value.trim();
    if (!name) { showToast('Name is required', true); return; }

    var ssnVal = document.getElementById('teamEmpSsn').value.trim();
    if (ssnVal && !/^\d{4}$/.test(ssnVal)) {
      showToast('SSN must be exactly 4 digits', true);
      return;
    }

    var rateDollars = parseFloat(document.getElementById('teamEmpRate').value);
    var fields = {
      fullName: name,
      preferredName: document.getElementById('teamEmpPreferred').value.trim() || null,
      phone: document.getElementById('teamEmpPhone').value.trim() || null,
      ssnLast4: ssnVal || null,
      address: {
        street: document.getElementById('teamEmpStreet').value.trim() || null,
        city: document.getElementById('teamEmpCity').value.trim() || null,
        state: document.getElementById('teamEmpState').value.trim() || null,
        zip: document.getElementById('teamEmpZip').value.trim() || null,
      },
      emergencyContact: {
        name: document.getElementById('teamEcName').value.trim() || null,
        phone: document.getElementById('teamEcPhone').value.trim() || null,
        relationship: document.getElementById('teamEcRelation').value.trim() || null,
      },
      jobTitle: document.getElementById('teamEmpTitle').value.trim() || null,
      employmentType: document.getElementById('teamEmpType').value,
      startDate: document.getElementById('teamEmpStart').value || null,
      status: document.getElementById('teamEmpStatus').value,
      terminationDate: document.getElementById('teamEmpStatus').value === 'terminated' ? (document.getElementById('teamEmpTermDate').value || null) : null,
      payType: document.getElementById('teamEmpPayType').value,
      payRate: rateDollars ? Math.round(rateDollars * 100) : null,
      payFrequency: document.getElementById('teamEmpFreq').value,
      scheduledHoursPerWeek: parseInt(document.getElementById('teamEmpHours').value) || null,
      updatedAt: new Date().toISOString(),
    };

    try {
      if (editingEmployeeId) {
        await MastDB.update('admin/employees/' + editingEmployeeId, fields);
        showToast('Employee saved');
      } else {
        fields.createdAt = new Date().toISOString();
        var newId = 'emp_' + Date.now();
        await MastDB.set('admin/employees/' + newId, fields);
        showToast('Employee created');
      }
      editingEmployeeId = null;
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteEmployee(empId) {
    if (!await mastConfirm('Delete this employee and all their data? This cannot be undone.', { title: 'Delete Employee', danger: true })) return;
    try {
      await MastDB.remove('admin/employees/' + empId);
      showToast('Employee deleted');
      editingEmployeeId = null;
      selectedEmployeeId = null;
      currentView = 'roster';
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Window Exports
  // ========================================
  window.loadTeam = loadTeam;
  window.teamSwitchView = function(view) {
    // docs and onboarding are manager-only; timeclock and pto show role-appropriate view
    if ((view === 'docs' || view === 'onboarding') && !canManageTeam()) {
      if (typeof showToast === 'function') showToast('This tab requires Manager or Admin access.', true);
      view = 'roster';
    }
    currentView = view;
    selectedEmployeeId = null;
    // Reset tab-specific state on switch
    if (view === 'timeclock') { tcWeekOffset = 0; tcSelectedEmployeeId = null; }
    if (view === 'pto') { ptoSelectedEmployeeId = null; }
    if (view === 'docs') { docFilterEmployee = ''; docFilterStatus = ''; }
    if (view === 'onboarding') { onboardingFilter = 'all'; }
    var container = document.getElementById('teamTab');
    if (container) renderTeam(container);
  };

  // Time Clock exports
  window.teamTcSetEmployee = function(id) { tcSelectedEmployeeId = id || null; loadTcManager(); };
  window.teamTcPrevWeek = function() { tcWeekOffset--; loadTcManager(); };
  window.teamTcNextWeek = function() { if (tcWeekOffset < 0) { tcWeekOffset++; loadTcManager(); } };
  window.teamTcAddEntry = function() { openTcAddForm(); };
  window.teamTcSaveEntry = saveTcEntry;
  window.teamTcClockIn = tcClockIn;
  window.teamTcClockOut = tcClockOut;

  // PTO exports
  window.teamPtoSelectEmp = function(id) { ptoSelectedEmployeeId = id; var wrap = document.getElementById('ptoBoardWrap'); if (wrap) { wrap.innerHTML = '<div class="loading">Loading&hellip;</div>'; } var container = document.getElementById('teamTab'); if (container) renderTeam(container); };
  window.teamPtoBack = function() { ptoSelectedEmployeeId = null; var container = document.getElementById('teamTab'); if (container) renderTeam(container); };
  window.teamPtoEditPolicy = function(empId) { openPtoPolicyForm(empId); };
  window.teamPtoSavePolicy = savePtoPolicy;
  window.teamPtoRecordUsage = function(empId) { openPtoUsageForm(empId, false); };
  window.teamPtoSaveEntry = savePtoEntry;
  window.teamPtoRequestSelf = function() { var uid = auth && auth.currentUser ? auth.currentUser.uid : null; openPtoUsageForm(uid, true); };

  // Documents exports
  window.teamDocFilter = function() {
    docFilterEmployee = document.getElementById('docFiltEmp').value;
    docFilterStatus = document.getElementById('docFiltStatus').value;
    var active = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; });
    var tbl = document.getElementById('docTableContainer');
    if (tbl) tbl.innerHTML = buildComplianceTable(active);
  };

  // Onboarding exports
  window.teamObFilter = function(f) { onboardingFilter = f; var container = document.getElementById('teamTab'); if (container) renderTeam(container); };
  window.teamObToggle = toggleObItem;
  window.teamViewEmployee = function(id) {
    selectedEmployeeId = id;
    currentView = 'detail';
    var container = document.getElementById('teamTab');
    if (container) renderTeam(container);
  };
  window.teamAddEmployee = function() { openAddEmployeeForm(null); };
  window.teamEditEmployee = function(id) { openAddEmployeeForm(id); };
  window.teamSaveEmployee = saveEmployee;
  window.teamDeleteEmployee = deleteEmployee;
  window.teamCancelAddForm = function() {
    var el = document.getElementById('teamAddForm');
    if (el) el.style.display = 'none';
    var cards = document.getElementById('teamRosterCards');
    if (cards) cards.style.display = '';
    var detailBody = document.getElementById('teamDetailBody');
    if (detailBody) detailBody.style.display = '';
    editingEmployeeId = null;
  };
  window.teamLogHours = function(empId) { openLogHoursForm(empId); };
  window.teamSaveHours = saveHours;
  window.teamEditCompliance = function(empId, fieldKey) { openComplianceForm(empId, fieldKey); };
  window.teamSaveCompliance = saveCompliance;
  window.teamUnlinkDrive = unlinkDrive;
  window.teamToggleSection = function(id) {
    var el = document.getElementById(id);
    var arrow = document.getElementById(id + 'Arrow');
    if (el) {
      var show = el.style.display === 'none';
      el.style.display = show ? '' : 'none';
      if (arrow) arrow.textContent = show ? '\u25bc' : '\u25b6';
    }
  };
  window.teamExpandAndAdd = function(id) {
    var el = document.getElementById(id);
    var arrow = document.getElementById(id + 'Arrow');
    if (el && el.style.display === 'none') {
      el.style.display = '';
      if (arrow) arrow.textContent = '\u25bc';
    }
  };
  window.teamAddTenantDoc = function() { openDocForm(null, true, null); };
  window.teamEditTenantDoc = function(id) { openDocForm(id, true, null); };
  window.teamSaveDoc = saveDoc;
  window.teamDeleteDoc = deleteDoc;
  window.teamCancelDocForm = function() {
    var el = document.getElementById('teamDocForm');
    if (el) el.style.display = 'none';
    var docCards = document.getElementById('teamDocCards');
    if (docCards) docCards.style.display = '';
    editingDocId = null;
  };
  window.teamAddEmpDoc = function(empId) { openDocForm(null, false, empId); };
  window.teamEditEmpDoc = function(empId, docId) { openDocForm(docId, false, empId); };
  window.teamSaveEmpDoc = saveEmpDoc;
  window.teamDeleteEmpDoc = deleteEmpDoc;
  window.teamAddReference = function(empId) { openReferenceForm(empId, null); };
  window.teamEditReference = function(empId, refId) { openReferenceForm(empId, refId); };
  window.teamSaveReference = saveReference;
  window.teamDeleteReference = deleteReference;

  // Register module
  MastAdmin.registerModule('team', {
    routes: {
      'team': {
        tab: 'teamTab',
        setup: function() { if (!teamLoaded) loadTeam(); }
      }
    },
    detachListeners: function() {
      employeesData = [];
      tenantDocs = [];
      teamLoaded = false;
      currentView = 'roster';
      selectedEmployeeId = null;
      editingEmployeeId = null;
      editingDocId = null;
      editingRefId = null;
      tcSelectedEmployeeId = null;
      tcWeekOffset = 0;
      if (tcTimerInterval) { clearInterval(tcTimerInterval); tcTimerInterval = null; }
      ptoSelectedEmployeeId = null;
      ptoPolicies = {};
      docFilterEmployee = '';
      docFilterStatus = '';
      onboardingFilter = 'all';
    }
  });
})();
