(function() {
  'use strict';

  var studentsData = [];
  var clearanceTypes = [];
  var tenantDocs = [];
  var studentsLoaded = false;
  var currentView = 'roster'; // roster | detail | docs
  var selectedStudentId = null;
  var editingStudentId = null;
  var editingDocId = null;
  var driveExplainerShown = false;

  // --- Constants ---
  var ONBOARDING_FIELDS = [
    { key: 'liabilityWaiver', label: 'Liability Waiver' },
    { key: 'safetyOrientation', label: 'Safety Orientation' },
    { key: 'photoRelease', label: 'Photo Release' },
    { key: 'guardianConsent', label: 'Guardian Consent' },
  ];
  var STORAGE_OPTIONS = [
    { value: 'physical', label: 'Physical' },
    { value: 'google-drive', label: 'Google Drive' },
    { value: 'dropbox', label: 'Dropbox' },
    { value: 'other', label: 'Other' },
  ];
  var DOC_TYPES = ['waiver', 'medical', 'guardian-consent', 'photo-release', 'certification', 'other'];
  var WAIVER_STATUSES = ['pending', 'signed', 'expired'];
  var PHOTO_WAIVER_STATUSES = ['pending', 'accepted', 'declined'];

  var INPUT_STYLE = 'width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;font-family:DM Sans,sans-serif;color:var(--charcoal,#1A1A1A);';

  // --- Helpers ---
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ') : ''; }
  function labelField(id, label, inputHtml) {
    return '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;" for="' + id + '">' + esc(label) + '</label>' + inputHtml + '</div>';
  }
  function textInput(id, value, placeholder) {
    return '<input id="' + id + '" type="text" value="' + esc(value || '') + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + ' style="' + INPUT_STYLE + '">';
  }
  function dateInput(id, value) {
    return '<input id="' + id + '" type="date" value="' + (value || '') + '" style="' + INPUT_STYLE + '">';
  }
  function selectInput(id, options, selectedValue) {
    var h = '<select id="' + id + '" style="' + INPUT_STYLE + '">';
    options.forEach(function(opt) {
      var val = typeof opt === 'string' ? opt : opt.value;
      var label = typeof opt === 'string' ? capitalize(opt) : opt.label;
      h += '<option value="' + esc(val) + '"' + (val === selectedValue ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    h += '</select>';
    return h;
  }
  function fullWidthDiv(content) { return '<div style="grid-column:1/-1;">' + content + '</div>'; }
  function textareaInput(id, value, placeholder, rows) {
    return '<textarea id="' + id + '" rows="' + (rows || 3) + '" placeholder="' + esc(placeholder || '') + '" style="' + INPUT_STYLE + 'resize:vertical;">' + esc(value || '') + '</textarea>';
  }

  function collapsibleSection(id, title, contentHtml, opts) {
    opts = opts || {};
    var open = opts.open !== false;
    var badge = opts.badge || '';
    var rightHtml = opts.rightHtml || '';
    var h = '<div style="margin-bottom:16px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:6px 0;" onclick="studentsToggleSection(\'' + id + '\')">';
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += '<span style="font-size:0.7rem;color:var(--warm-gray);transition:transform 0.15s;" id="' + id + 'Arrow">' + (open ? '\u25bc' : '\u25b6') + '</span>';
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

  function isDriveUrl(url) {
    return url && /drive\.google\.com|docs\.google\.com/.test(url);
  }

  function renderDriveUrlField(prefix, existingUrl, existingDrive) {
    var drive = existingDrive || {};
    var h = '';
    h += fullWidthDiv(labelField(prefix + 'Url', 'URL or Google Drive link', textInput(prefix + 'Url', existingUrl || '', 'https://drive.google.com/file/d/...')));
    h += '<div id="' + prefix + 'DrivePreview" style="grid-column:1/-1;display:' + (drive.driveFileName ? '' : 'none') + ';">';
    if (drive.driveFileName) h += renderDrivePreview(prefix, drive);
    h += '</div>';
    h += '<div id="' + prefix + 'DriveExplainer" style="grid-column:1/-1;display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px 14px;font-size:0.78rem;color:#166534;">';
    h += '\ud83d\udd17 Paste a Google Drive share link above to auto-link the file. Make sure linked files are set to <strong>restricted access</strong> in Drive (not "anyone with the link").';
    h += '</div>';
    return h;
  }

  function renderDrivePreview(prefix, drive) {
    var h = '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">';
    h += '<div style="font-size:0.82rem;">\ud83d\udcc4 <strong>' + esc(drive.driveFileName || '') + '</strong>';
    if (drive.driveLastModified) h += ' \u00b7 Modified ' + (drive.driveLastModified || '').split('T')[0];
    h += '</div>';
    h += '<button type="button" class="btn btn-secondary btn-small" onclick="studentsUnlinkDrive(\'' + esc(prefix) + '\')">Unlink</button>';
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
          if (storageEl && storageEl.value !== 'google-drive') storageEl.value = 'google-drive';
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
    }
  }

  async function fetchAndShowDrivePreview(prefix, url) {
    var preview = document.getElementById(prefix + 'DrivePreview');
    if (!preview) return;
    preview.innerHTML = '<div style="font-size:0.78rem;color:var(--warm-gray);">Fetching file info\u2026</div>';
    preview.style.display = '';
    var meta = await fetchDriveFileMetadata(url);
    if (!meta) {
      preview.innerHTML = '<div style="font-size:0.78rem;color:var(--danger);">Could not fetch file metadata.</div>';
      return;
    }
    preview.dataset.driveFileId = url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '';
    preview.dataset.driveFileName = meta.name || '';
    preview.dataset.driveLastModified = meta.modifiedTime || '';
    preview.innerHTML = renderDrivePreview(prefix, { driveFileName: meta.name, driveLastModified: meta.modifiedTime });
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

  // --- Load ---
  async function loadStudents() {
    var container = document.getElementById('studentsTab');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading students\u2026</div>';

    try {
      var results = await Promise.all([
        MastDB._ref('students').once('value'),
        MastDB._ref('settings/clearanceTypes').once('value'),
        MastDB._ref('admin/documents').once('value'),
      ]);

      var stuVal = results[0].val() || {};
      studentsData = Object.entries(stuVal).map(function(entry) {
        var stu = entry[1];
        stu._key = entry[0];
        return stu;
      });

      var ctVal = results[1].val() || {};
      clearanceTypes = Object.entries(ctVal).map(function(entry) {
        var ct = entry[1];
        ct._key = entry[0];
        return ct;
      });

      var docsVal = results[2].val() || {};
      tenantDocs = Object.entries(docsVal).map(function(entry) {
        var doc = entry[1];
        doc._key = entry[0];
        return doc;
      });

      studentsLoaded = true;
      renderStudents(container);
    } catch (err) {
      console.error('Error loading students:', err);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">Error loading student data.</div>';
    }
  }

  // --- Main Render ---
  function renderStudents(container) {
    var h = '';
    h += '<div class="view-tabs" style="margin-bottom:20px;">';
    h += '<button class="view-tab' + (currentView === 'roster' || currentView === 'detail' ? ' active' : '') + '" onclick="studentsSwitchView(\'roster\')">Students</button>';
    h += '<button class="view-tab' + (currentView === 'clearanceTypes' ? ' active' : '') + '" onclick="studentsSwitchView(\'clearanceTypes\')">Clearance Types</button>';
    h += '<button class="view-tab' + (currentView === 'docs' ? ' active' : '') + '" onclick="studentsSwitchView(\'docs\')">Documents</button>';
    h += '</div>';

    if (currentView === 'roster') {
      h += renderRoster();
    } else if (currentView === 'detail') {
      h += renderStudentDetail();
    } else if (currentView === 'clearanceTypes') {
      h += renderClearanceTypes();
    } else if (currentView === 'docs') {
      h += renderTenantDocs();
    }

    container.innerHTML = h;
  }

  // ========================================
  // Surface 1: Student Roster
  // ========================================
  function renderRoster() {
    var h = '';
    var active = studentsData.filter(function(s) { return (s.status || 'active') !== 'inactive'; });
    var minors = active.filter(function(s) { return s.isMinor; });
    var gapCount = 0;
    active.forEach(function(stu) {
      if (stu.waiverStatus !== 'signed') gapCount++;
      if (!stu.safetyOrientationCompleted) gapCount++;
    });

    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<div>';
    h += '<h2 style="margin:0;">Students</h2>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    h += active.length + ' active';
    if (minors.length > 0) h += ' \u00b7 ' + minors.length + ' minor' + (minors.length !== 1 ? 's' : '');
    if (gapCount > 0) h += ' \u00b7 <span style="color:#d97706;">\u26a0 ' + gapCount + ' onboarding gap' + (gapCount !== 1 ? 's' : '') + '</span>';
    h += '</div>';
    h += '</div>';
    h += '<button class="btn btn-primary" onclick="studentsAdd()">\u002b New Student</button>';
    h += '</div>';

    if (active.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:2rem;margin-bottom:12px;">\ud83c\udf93</div>';
      h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No students yet</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add your first student to start tracking onboarding and clearances.</p>';
      h += '</div>';
      return h;
    }

    h += '<div id="studentsRosterCards">';
    active.sort(function(a, b) { return (a.displayName || '').localeCompare(b.displayName || ''); });
    active.forEach(function(stu) {
      h += renderStudentCard(stu);
    });
    h += '</div>';

    return h;
  }

  function renderStudentCard(stu) {
    var id = stu._key;
    var waiverOk = stu.waiverStatus === 'signed';
    var safetyOk = stu.safetyOrientationCompleted === true;
    var clearances = Array.isArray(stu.clearances) ? stu.clearances : [];
    var today = new Date().toISOString().split('T')[0];
    var activeClearances = clearances.filter(function(c) { return !c.expiresAt || c.expiresAt >= today; });

    var h = '<div data-id="' + esc(id) + '" style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#ddd);border-radius:8px;padding:12px 16px;margin-bottom:8px;cursor:pointer;transition:border-color 0.15s;" onclick="studentsViewDetail(\'' + esc(id) + '\')" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,#ddd)\'">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div>';
    h += '<div style="font-weight:600;">\ud83c\udf93 ' + esc(stu.displayName || 'Unnamed');
    if (stu.isMinor) h += ' <span style="font-size:0.72rem;background:#6366f1;color:white;padding:1px 6px;border-radius:4px;margin-left:6px;">MINOR</span>';
    h += '</div>';
    h += '<div style="font-size:0.82rem;color:var(--warm-gray);margin-top:2px;">';
    if (waiverOk && safetyOk) {
      h += '<span style="color:#16a34a;">\u2713 Onboarded</span>';
    } else {
      var gaps = [];
      if (!waiverOk) gaps.push('waiver');
      if (!safetyOk) gaps.push('safety');
      h += '<span style="color:#d97706;">\u26a0 Missing: ' + gaps.join(', ') + '</span>';
    }
    if (activeClearances.length > 0) h += ' \u00b7 ' + activeClearances.length + ' clearance' + (activeClearances.length !== 1 ? 's' : '');
    h += '</div>';
    h += '</div>';
    h += '<button class="btn-icon" onclick="event.stopPropagation();studentsEdit(\'' + esc(id) + '\')" title="Edit">&#9998;</button>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  // ========================================
  // Surface 2: Student Detail
  // ========================================
  function renderStudentDetail() {
    var stu = studentsData.find(function(s) { return s._key === selectedStudentId; });
    if (!stu) return '<div style="text-align:center;padding:40px;color:var(--warm-gray);">Student not found.</div>';

    var h = '';
    h += '<button class="detail-back" onclick="studentsSwitchView(\'roster\')">\u2190 Back to Students</button>';

    // Header
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">';
    h += '<div>';
    h += '<h3 style="margin:0;">' + esc(stu.displayName || 'Unnamed');
    if (stu.isMinor) h += ' <span style="font-size:0.72rem;background:#6366f1;color:white;padding:1px 6px;border-radius:4px;margin-left:6px;">MINOR</span>';
    h += '</h3>';
    h += '<div style="font-size:0.8rem;color:var(--warm-gray);">';
    if (stu.contactId) h += 'Contact: ' + esc(stu.contactId);
    if (stu.createdAt) h += ' \u00b7 Added ' + stu.createdAt.split('T')[0];
    h += '</div>';
    h += '</div>';
    h += '<button class="btn-icon" onclick="studentsEdit(\'' + esc(stu._key) + '\')" title="Edit">&#9998;</button>';
    h += '</div>';

    // Onboarding Status Card
    var waiverOk = stu.waiverStatus === 'signed';
    var safetyOk = stu.safetyOrientationCompleted === true;
    h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#ddd);border-radius:8px;padding:16px;margin-bottom:16px;">';
    h += '<div style="display:flex;gap:24px;flex-wrap:wrap;">';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);">Waiver</span><div style="font-weight:600;color:' + (waiverOk ? '#16a34a' : '#d97706') + ';">' + (waiverOk ? '\u2713 Signed' : '\u26a0 ' + capitalize(stu.waiverStatus || 'pending')) + '</div></div>';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);">Safety Orientation</span><div style="font-weight:600;color:' + (safetyOk ? '#16a34a' : '#d97706') + ';">' + (safetyOk ? '\u2713 Completed' : '\u26a0 Not completed') + '</div></div>';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);">Photo Waiver</span><div style="font-weight:600;">' + capitalize(stu.photoWaiverStatus || 'pending') + '</div></div>';
    h += '</div>';
    h += '</div>';

    // Profile Section
    var profileHtml = '';
    profileHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    profileHtml += '<div><span style="font-size:0.78rem;color:var(--warm-gray);">Birth Date</span><div>' + esc(stu.birthDate || 'Not set') + '</div></div>';
    profileHtml += '<div><span style="font-size:0.78rem;color:var(--warm-gray);">Minor Status</span><div>' + (stu.isMinor ? 'Yes (under 18)' : 'No') + '</div></div>';
    if (stu.isMinor && stu.guardianContactId) {
      profileHtml += '<div><span style="font-size:0.78rem;color:var(--warm-gray);">Guardian Contact</span><div>' + esc(stu.guardianContactId) + '</div></div>';
    }
    var ec = stu.emergencyContact || {};
    if (ec.name) {
      profileHtml += '<div><span style="font-size:0.78rem;color:var(--warm-gray);">Emergency Contact</span><div>' + esc(ec.name) + (ec.phone ? ' \u00b7 ' + esc(ec.phone) : '') + (ec.relationship ? ' (' + esc(ec.relationship) + ')' : '') + '</div></div>';
    }
    if (stu.allergies) profileHtml += '<div style="grid-column:1/-1;"><span style="font-size:0.78rem;color:var(--warm-gray);">Allergies</span><div>' + esc(stu.allergies) + '</div></div>';
    if (stu.medicalNotes) profileHtml += '<div style="grid-column:1/-1;"><span style="font-size:0.78rem;color:var(--warm-gray);">Medical Notes</span><div>' + esc(stu.medicalNotes) + '</div></div>';
    if (stu.instructorNotes) profileHtml += '<div style="grid-column:1/-1;"><span style="font-size:0.78rem;color:var(--warm-gray);">Instructor Notes</span><div style="font-style:italic;">' + esc(stu.instructorNotes) + '</div></div>';
    profileHtml += '</div>';
    h += collapsibleSection('stuProfile', 'Profile', profileHtml);

    // Onboarding Checklist Section
    var checklistHtml = renderOnboardingChecklist(stu);
    var checklistCount = 0;
    var checklist = stu.onboardingChecklist || {};
    ONBOARDING_FIELDS.forEach(function(f) {
      if (checklist[f.key] && checklist[f.key].status === 'completed') checklistCount++;
    });
    var checklistBadge = '<span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;background:' + (checklistCount === ONBOARDING_FIELDS.length ? 'rgba(22,163,74,0.15);color:#16a34a' : 'rgba(217,119,6,0.15);color:#d97706') + ';">' + checklistCount + '/' + ONBOARDING_FIELDS.length + '</span>';
    h += collapsibleSection('stuChecklist', 'Onboarding Checklist', checklistHtml, { badge: checklistBadge });

    // Clearances Section
    var clearancesHtml = renderClearances(stu);
    var activeClearances = (Array.isArray(stu.clearances) ? stu.clearances : []).filter(function(c) {
      return !c.expiresAt || c.expiresAt >= new Date().toISOString().split('T')[0];
    });
    var clearanceBadge = activeClearances.length > 0 ? '<span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;background:rgba(22,163,74,0.15);color:#16a34a;">' + activeClearances.length + '</span>' : '';
    var addClearanceBtn = '<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();studentsAddClearance(\'' + esc(stu._key) + '\')">\u002b Add</button>';
    h += collapsibleSection('stuClearances', 'Clearances', clearancesHtml, { badge: clearanceBadge, rightHtml: addClearanceBtn });

    // Documents Section
    var docs = Array.isArray(stu.documents) ? stu.documents : [];
    var docsHtml = '';
    if (docs.length === 0) {
      docsHtml += '<div style="font-size:0.85rem;color:var(--warm-gray);padding:8px 0;">No documents on file.</div>';
    } else {
      docs.forEach(function(doc, idx) {
        docsHtml += renderDocCard(doc, stu._key, idx);
      });
    }
    var docsBadge = docs.length > 0 ? '<span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;background:rgba(196,133,60,0.15);color:var(--amber);">' + docs.length + '</span>' : '';
    var addDocBtn = '<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();studentsAddDoc(\'' + esc(stu._key) + '\')">\u002b New Document</button>';
    h += collapsibleSection('stuDocs', 'Documents', docsHtml, { badge: docsBadge, rightHtml: addDocBtn, open: false });

    return h;
  }

  function renderOnboardingChecklist(stu) {
    var checklist = stu.onboardingChecklist || {};
    var today = new Date().toISOString().split('T')[0];
    var ninetyDaysOut = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];
    var h = '';

    ONBOARDING_FIELDS.forEach(function(f) {
      var item = checklist[f.key] || {};
      var status = item.status || 'pending';

      // guardianConsent: skip display if not-applicable and not a minor
      if (f.key === 'guardianConsent' && status === 'not-applicable' && !stu.isMinor) return;

      var statusColor = status === 'completed' ? '#16a34a' : status === 'not-applicable' ? 'var(--warm-gray)' : '#d97706';
      var statusIcon = status === 'completed' ? '\u2713' : status === 'not-applicable' ? '\u2014' : '\u26a0';

      h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#ddd);border-radius:6px;padding:10px 14px;margin-bottom:6px;cursor:pointer;" onclick="studentsEditChecklist(\'' + esc(stu._key) + '\',\'' + f.key + '\')" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,#ddd)\'">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      h += '<div>';
      h += '<span style="color:' + statusColor + ';font-weight:600;font-size:0.82rem;">' + statusIcon + ' ' + esc(f.label) + '</span>';
      if (item.storageLocation) h += ' <span style="font-size:0.72rem;color:var(--warm-gray);margin-left:6px;">' + capitalize(item.storageLocation) + '</span>';
      h += '</div>';
      // Expiry warning
      if (item.expiryDate && item.expiryDate <= ninetyDaysOut && status === 'completed') {
        var isExpired = item.expiryDate < today;
        h += '<span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;background:' + (isExpired ? 'rgba(220,38,38,0.12);color:#dc2626' : 'rgba(217,119,6,0.12);color:#d97706') + ';">' + (isExpired ? 'Expired' : 'Expires ' + item.expiryDate) + '</span>';
      }
      h += '</div>';
      // Drive file info
      if (item.driveFileName) {
        h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">\ud83d\udcc4 ' + esc(item.driveFileName);
        if (item.driveLastModified) h += ' \u00b7 Modified ' + item.driveLastModified.split('T')[0];
        h += '</div>';
      }
      h += '</div>';
    });

    return h;
  }

  function renderClearances(stu) {
    var clearances = Array.isArray(stu.clearances) ? stu.clearances : [];
    if (clearances.length === 0) {
      return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:8px 0;">No clearances on file. Add clearance types first if needed.</div>';
    }

    var today = new Date().toISOString().split('T')[0];
    var h = '';
    clearances.forEach(function(c, idx) {
      var isExpired = c.expiresAt && c.expiresAt < today;
      var isActive = !c.expiresAt || c.expiresAt >= today;
      h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#ddd);border-radius:6px;padding:10px 14px;margin-bottom:6px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      h += '<div>';
      h += '<span style="font-weight:600;color:' + (isActive ? '#16a34a' : '#dc2626') + ';">' + (isActive ? '\u2713' : '\u2717') + ' ' + esc(c.label || c.clearanceId) + '</span>';
      h += '<span style="font-size:0.78rem;color:var(--warm-gray);margin-left:8px;">Cleared ' + (c.clearedAt || '') + ' by ' + esc(c.clearedBy || '') + '</span>';
      h += '</div>';
      if (isExpired) {
        h += '<span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;background:rgba(220,38,38,0.12);color:#dc2626;">Expired ' + c.expiresAt + '</span>';
      } else if (c.expiresAt) {
        h += '<span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;background:rgba(22,163,74,0.15);color:#16a34a;">Expires ' + c.expiresAt + '</span>';
      }
      h += '</div>';
      if (c.notes) h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' + esc(c.notes) + '</div>';
      h += '</div>';
    });

    return h;
  }

  function renderDocCard(doc, studentId, idx) {
    var h = '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#ddd);border-radius:6px;padding:10px 14px;margin-bottom:6px;cursor:pointer;" onclick="studentsEditDoc(\'' + esc(studentId) + '\',' + idx + ')" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,#ddd)\'">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div>';
    h += '<span style="font-weight:500;">' + esc(doc.title || 'Untitled') + '</span>';
    h += ' <span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;background:rgba(196,133,60,0.15);color:var(--amber);">' + capitalize(doc.type || 'other') + '</span>';
    h += '</div>';
    var statusColor = doc.status === 'current' ? '#16a34a' : doc.status === 'expired' ? '#dc2626' : '#d97706';
    h += '<span style="font-size:0.72rem;color:' + statusColor + ';font-weight:600;">' + capitalize(doc.status || 'pending') + '</span>';
    h += '</div>';
    if (doc.storageLocation) h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' + capitalize(doc.storageLocation) + (doc.expiryDate ? ' \u00b7 Expires ' + doc.expiryDate : '') + '</div>';
    if (doc.driveFileName) h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">\ud83d\udcc4 ' + esc(doc.driveFileName) + '</div>';
    h += '</div>';
    return h;
  }

  // ========================================
  // Surface 3: Clearance Types
  // ========================================
  function renderClearanceTypes() {
    var h = '';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<div><h2 style="margin:0;">Clearance Types</h2>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">Define clearances students need for specific classes (e.g., Torch Safety, Kiln Independent Use).</div></div>';
    h += '<button class="btn btn-primary" onclick="studentsAddClearanceType()">\u002b New Clearance Type</button>';
    h += '</div>';

    if (clearanceTypes.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:2rem;margin-bottom:12px;">\ud83d\udee1\ufe0f</div>';
      h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No clearance types defined</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Create clearance types to track student qualifications.</p>';
      h += '</div>';
      return h;
    }

    clearanceTypes.forEach(function(ct) {
      h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#ddd);border-radius:8px;padding:12px 16px;margin-bottom:8px;cursor:pointer;" onclick="studentsEditClearanceType(\'' + esc(ct._key) + '\')" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,#ddd)\'">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      h += '<div>';
      h += '<span style="font-weight:600;">\ud83d\udee1\ufe0f ' + esc(ct.label || 'Unnamed') + '</span>';
      if (ct.description) h += '<div style="font-size:0.82rem;color:var(--warm-gray);margin-top:2px;">' + esc(ct.description) + '</div>';
      h += '</div>';
      h += '<span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;background:rgba(196,133,60,0.15);color:var(--amber);">' + (ct.requiresExpiry ? 'Expires' : 'No expiry') + '</span>';
      h += '</div>';
      h += '</div>';
    });

    return h;
  }

  // ========================================
  // Surface 4: Tenant Documents (shared with employees)
  // ========================================
  function renderTenantDocs() {
    var h = '';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<div><h2 style="margin:0;">Business Documents</h2>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">Business-wide documents shared across employees and students.</div></div>';
    h += '<button class="btn btn-primary" onclick="studentsAddTenantDoc()">\u002b New Document</button>';
    h += '</div>';

    if (tenantDocs.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:2rem;margin-bottom:12px;">\ud83d\udcda</div>';
      h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No business documents</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Track business licenses, insurance certificates, and other shared documents.</p>';
      h += '</div>';
      return h;
    }

    tenantDocs.forEach(function(doc) {
      h += renderDocCard(doc, null, doc._key);
    });

    return h;
  }

  // ========================================
  // Forms: Student Add/Edit
  // ========================================
  function openStudentForm(studentId) {
    editingStudentId = studentId;
    var stu = studentId ? studentsData.find(function(s) { return s._key === studentId; }) : {};
    stu = stu || {};
    var ec = stu.emergencyContact || {};

    var container = document.getElementById('studentsTab');
    if (!container) return;

    var h = '';
    h += '<button class="detail-back" onclick="studentsCancelForm()">\u2190 Back</button>';
    h += '<h3>' + (studentId ? 'Edit Student' : 'New Student') + '</h3>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;max-width:720px;">';

    // Identity
    h += fullWidthDiv('<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:8px 0 4px;">Identity</div>');
    h += labelField('stuName', 'Display Name *', textInput('stuName', stu.displayName, 'Full name'));
    h += labelField('stuContactId', 'Contact ID *', textInput('stuContactId', stu.contactId, 'Contact ID'));

    // Profile
    h += fullWidthDiv('<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:12px 0 4px;">Profile</div>');
    h += labelField('stuBirthDate', 'Birth Date', dateInput('stuBirthDate', stu.birthDate));
    h += labelField('stuIsMinor', 'Minor (under 18)', selectInput('stuIsMinor', [{ value: 'auto', label: 'Auto from birth date' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], stu.isMinor === true ? 'true' : stu.isMinor === false ? 'false' : 'auto'));
    h += labelField('stuGuardianId', 'Guardian Contact ID', textInput('stuGuardianId', stu.guardianContactId, 'Contact ID of parent/guardian'));
    h += labelField('stuPhotoWaiver', 'Photo Waiver Status', selectInput('stuPhotoWaiver', PHOTO_WAIVER_STATUSES, stu.photoWaiverStatus || 'pending'));

    // Emergency Contact
    h += fullWidthDiv('<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:12px 0 4px;">Emergency Contact</div>');
    h += labelField('stuEcName', 'Name', textInput('stuEcName', ec.name, 'Emergency contact name'));
    h += labelField('stuEcPhone', 'Phone', textInput('stuEcPhone', ec.phone, 'Phone number'));
    h += labelField('stuEcRelationship', 'Relationship', textInput('stuEcRelationship', ec.relationship, 'e.g., Parent, Spouse'));

    // Medical
    h += fullWidthDiv('<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:12px 0 4px;">Medical</div>');
    h += fullWidthDiv(labelField('stuAllergies', 'Allergies', textInput('stuAllergies', stu.allergies, 'Known allergies')));
    h += fullWidthDiv(labelField('stuMedicalNotes', 'Medical Notes', textareaInput('stuMedicalNotes', stu.medicalNotes, 'Any relevant medical information', 2)));

    // Onboarding
    h += fullWidthDiv('<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:12px 0 4px;">Onboarding</div>');
    h += labelField('stuWaiverStatus', 'Waiver Status', selectInput('stuWaiverStatus', WAIVER_STATUSES, stu.waiverStatus || 'pending'));
    h += labelField('stuWaiverDate', 'Waiver Signed Date', dateInput('stuWaiverDate', stu.waiverSignedAt));
    h += labelField('stuSafetyCompleted', 'Safety Orientation', selectInput('stuSafetyCompleted', [{ value: 'false', label: 'Not completed' }, { value: 'true', label: 'Completed' }], stu.safetyOrientationCompleted ? 'true' : 'false'));
    h += labelField('stuSafetyDate', 'Safety Orientation Date', dateInput('stuSafetyDate', stu.safetyOrientationDate));

    // Internal
    h += fullWidthDiv('<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:12px 0 4px;">Internal</div>');
    h += fullWidthDiv(labelField('stuInstructorNotes', 'Instructor Notes', textareaInput('stuInstructorNotes', stu.instructorNotes, 'Internal notes (not shown to student)', 2)));

    if (studentId) {
      h += labelField('stuStatus', 'Status', selectInput('stuStatus', ['active', 'inactive'], stu.status || 'active'));
    }

    h += '</div>';

    // Buttons
    h += '<div style="display:flex;gap:8px;margin-top:20px;">';
    h += '<button class="btn btn-primary" onclick="studentsSave()">Save</button>';
    h += '<button class="btn btn-secondary" onclick="studentsCancelForm()">Cancel</button>';
    if (studentId) h += '<button class="btn btn-danger" style="margin-left:auto;" onclick="studentsDelete(\'' + esc(studentId) + '\')">Delete</button>';
    h += '</div>';

    container.innerHTML = h;
  }

  async function saveStudent() {
    var id = editingStudentId;
    var isNew = !id;
    var name = (document.getElementById('stuName') || {}).value || '';
    var contactId = (document.getElementById('stuContactId') || {}).value || '';

    if (!name.trim()) { showToast('Display name is required', true); return; }
    if (isNew && !contactId.trim()) { showToast('Contact ID is required for new students', true); return; }

    var isMinorSelect = (document.getElementById('stuIsMinor') || {}).value;
    var birthDate = (document.getElementById('stuBirthDate') || {}).value || null;

    var fields = {
      displayName: name.trim(),
      contactId: contactId.trim() || null,
      birthDate: birthDate || null,
      guardianContactId: (document.getElementById('stuGuardianId') || {}).value || null,
      photoWaiverStatus: (document.getElementById('stuPhotoWaiver') || {}).value || 'pending',
      emergencyContact: {
        name: (document.getElementById('stuEcName') || {}).value || null,
        phone: (document.getElementById('stuEcPhone') || {}).value || null,
        relationship: (document.getElementById('stuEcRelationship') || {}).value || null,
      },
      allergies: (document.getElementById('stuAllergies') || {}).value || null,
      medicalNotes: (document.getElementById('stuMedicalNotes') || {}).value || null,
      waiverStatus: (document.getElementById('stuWaiverStatus') || {}).value || 'pending',
      waiverSignedAt: (document.getElementById('stuWaiverDate') || {}).value || null,
      safetyOrientationCompleted: (document.getElementById('stuSafetyCompleted') || {}).value === 'true',
      safetyOrientationDate: (document.getElementById('stuSafetyDate') || {}).value || null,
      instructorNotes: (document.getElementById('stuInstructorNotes') || {}).value || null,
    };

    // isMinor: auto-compute from birthDate or manual override
    if (isMinorSelect === 'true') fields.isMinor = true;
    else if (isMinorSelect === 'false') fields.isMinor = false;
    else if (birthDate) {
      var birth = new Date(birthDate);
      var now = new Date();
      var age = now.getFullYear() - birth.getFullYear();
      var m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
      fields.isMinor = age < 18;
    }

    if (id) {
      fields.status = (document.getElementById('stuStatus') || {}).value || 'active';
    }

    try {
      var ref;
      if (isNew) {
        ref = MastDB._ref('students').push();
        id = ref.key;
        fields.createdAt = new Date().toISOString();
        fields.status = 'active';
        fields.clearances = [];
        fields.documents = [];
        fields.onboardingChecklist = {
          liabilityWaiver: { status: fields.waiverStatus === 'signed' ? 'completed' : 'pending' },
          safetyOrientation: { status: fields.safetyOrientationCompleted ? 'completed' : 'pending' },
          photoRelease: { status: fields.photoWaiverStatus === 'accepted' ? 'completed' : 'pending' },
          guardianConsent: { status: fields.isMinor ? 'pending' : 'not-applicable' },
        };
        await ref.set(fields);
      } else {
        fields.updatedAt = new Date().toISOString();
        await MastDB._ref('students/' + id).update(fields);
      }

      showToast(isNew ? 'Student created' : 'Student saved');
      editingStudentId = null;
      selectedStudentId = id;
      currentView = 'detail';
      await loadStudents();
    } catch (err) {
      console.error('Error saving student:', err);
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteStudent(studentId) {
    if (!confirm('Delete this student? This cannot be undone.')) return;
    try {
      await MastDB._ref('students/' + studentId).remove();
      showToast('Student deleted');
      selectedStudentId = null;
      currentView = 'roster';
      await loadStudents();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Forms: Onboarding Checklist Edit
  // ========================================
  function openChecklistEdit(studentId, fieldKey) {
    var stu = studentsData.find(function(s) { return s._key === studentId; });
    if (!stu) return;
    var checklist = stu.onboardingChecklist || {};
    var item = checklist[fieldKey] || {};
    var field = ONBOARDING_FIELDS.find(function(f) { return f.key === fieldKey; });
    if (!field) return;

    var container = document.getElementById('studentsTab');
    if (!container) return;

    var h = '';
    h += '<button class="detail-back" onclick="studentsViewDetail(\'' + esc(studentId) + '\')">\u2190 Back to Student</button>';
    h += '<h3>Edit: ' + esc(field.label) + '</h3>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;max-width:720px;">';
    h += labelField('clStatus', 'Status', selectInput('clStatus', ['pending', 'completed', 'not-applicable'], item.status || 'pending'));
    h += labelField('clStorage', 'Storage Location', selectInput('clStorage', STORAGE_OPTIONS, item.storageLocation || ''));
    h += labelField('clCompletedDate', 'Completed Date', dateInput('clCompletedDate', item.completedDate));
    h += labelField('clExpiryDate', 'Expiry Date', dateInput('clExpiryDate', item.expiryDate));
    h += renderDriveUrlField('cl', item.documentUrl, item);
    h += fullWidthDiv(labelField('clNotes', 'Notes', textareaInput('clNotes', item.notes, '', 2)));
    h += '</div>';

    h += '<div style="display:flex;gap:8px;margin-top:20px;">';
    h += '<button class="btn btn-primary" onclick="studentsSaveChecklist(\'' + esc(studentId) + '\',\'' + fieldKey + '\')">Save</button>';
    h += '<button class="btn btn-secondary" onclick="studentsViewDetail(\'' + esc(studentId) + '\')">Cancel</button>';
    h += '</div>';

    container.innerHTML = h;
    attachDriveUrlListener('cl', 'clStorage');
  }

  async function saveChecklist(studentId, fieldKey) {
    var fields = {
      status: (document.getElementById('clStatus') || {}).value || 'pending',
      storageLocation: (document.getElementById('clStorage') || {}).value || null,
      completedDate: (document.getElementById('clCompletedDate') || {}).value || null,
      expiryDate: (document.getElementById('clExpiryDate') || {}).value || null,
      documentUrl: (document.getElementById('clUrl') || {}).value || null,
      notes: (document.getElementById('clNotes') || {}).value || null,
    };
    Object.assign(fields, collectDriveFields('cl'));

    try {
      await MastDB._ref('students/' + studentId + '/onboardingChecklist/' + fieldKey).update(fields);
      showToast('Checklist updated');
      selectedStudentId = studentId;
      currentView = 'detail';
      await loadStudents();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Forms: Add Clearance
  // ========================================
  function openAddClearance(studentId) {
    if (clearanceTypes.length === 0) {
      showToast('No clearance types defined. Create one first in the Clearance Types tab.', true);
      return;
    }

    var container = document.getElementById('studentsTab');
    if (!container) return;

    var h = '';
    h += '<button class="detail-back" onclick="studentsViewDetail(\'' + esc(studentId) + '\')">\u2190 Back to Student</button>';
    h += '<h3>Add Clearance</h3>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;max-width:720px;">';
    var typeOpts = clearanceTypes.map(function(ct) { return { value: ct._key, label: ct.label || ct._key }; });
    h += labelField('addClType', 'Clearance Type *', selectInput('addClType', typeOpts, ''));
    h += labelField('addClBy', 'Cleared By *', textInput('addClBy', '', 'Staff member name'));
    h += labelField('addClExpires', 'Expires At', dateInput('addClExpires', ''));
    h += fullWidthDiv(labelField('addClNotes', 'Notes', textareaInput('addClNotes', '', '', 2)));
    h += '</div>';

    h += '<div style="display:flex;gap:8px;margin-top:20px;">';
    h += '<button class="btn btn-primary" onclick="studentsSaveClearance(\'' + esc(studentId) + '\')">Create Clearance</button>';
    h += '<button class="btn btn-secondary" onclick="studentsViewDetail(\'' + esc(studentId) + '\')">Cancel</button>';
    h += '</div>';

    container.innerHTML = h;
  }

  async function saveClearance(studentId) {
    var clearanceId = (document.getElementById('addClType') || {}).value;
    var clearedBy = (document.getElementById('addClBy') || {}).value;
    var expiresAt = (document.getElementById('addClExpires') || {}).value || null;
    var notes = (document.getElementById('addClNotes') || {}).value || null;

    if (!clearanceId) { showToast('Select a clearance type', true); return; }
    if (!clearedBy) { showToast('Cleared By is required', true); return; }

    var ct = clearanceTypes.find(function(t) { return t._key === clearanceId; });
    if (ct && ct.requiresExpiry && !expiresAt) {
      showToast('This clearance type requires an expiration date', true);
      return;
    }

    var entry = {
      clearanceId: clearanceId,
      label: ct ? ct.label : clearanceId,
      clearedAt: new Date().toISOString().split('T')[0],
      clearedBy: clearedBy,
      expiresAt: expiresAt,
      notes: notes,
    };

    try {
      var stu = studentsData.find(function(s) { return s._key === studentId; });
      var clearances = (stu && Array.isArray(stu.clearances)) ? stu.clearances.slice() : [];
      clearances.push(entry);
      await MastDB._ref('students/' + studentId + '/clearances').set(clearances);
      await MastDB._ref('students/' + studentId + '/updatedAt').set(new Date().toISOString());

      showToast('Clearance added');
      selectedStudentId = studentId;
      currentView = 'detail';
      await loadStudents();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Forms: Clearance Type Add/Edit
  // ========================================
  function openClearanceTypeForm(clearanceTypeId) {
    var ct = clearanceTypeId ? clearanceTypes.find(function(t) { return t._key === clearanceTypeId; }) : {};
    ct = ct || {};

    var container = document.getElementById('studentsTab');
    if (!container) return;

    var h = '';
    h += '<button class="detail-back" onclick="studentsSwitchView(\'clearanceTypes\')">\u2190 Back to Clearance Types</button>';
    h += '<h3>' + (clearanceTypeId ? 'Edit Clearance Type' : 'New Clearance Type') + '</h3>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;max-width:720px;">';
    h += labelField('ctLabel', 'Label *', textInput('ctLabel', ct.label, 'e.g., Torch Safety Orientation'));
    h += labelField('ctExpiry', 'Requires Expiry', selectInput('ctExpiry', [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }], ct.requiresExpiry ? 'true' : 'false'));
    h += fullWidthDiv(labelField('ctDesc', 'Description', textareaInput('ctDesc', ct.description, 'What this clearance covers', 2)));
    h += '</div>';

    h += '<div style="display:flex;gap:8px;margin-top:20px;">';
    h += '<button class="btn btn-primary" onclick="studentsSaveClearanceType(\'' + esc(clearanceTypeId || '') + '\')">' + (clearanceTypeId ? 'Save' : 'Create Clearance Type') + '</button>';
    h += '<button class="btn btn-secondary" onclick="studentsSwitchView(\'clearanceTypes\')">Cancel</button>';
    if (clearanceTypeId) h += '<button class="btn btn-danger" style="margin-left:auto;" onclick="studentsDeleteClearanceType(\'' + esc(clearanceTypeId) + '\')">Delete</button>';
    h += '</div>';

    container.innerHTML = h;
  }

  async function saveClearanceType(clearanceTypeId) {
    var label = (document.getElementById('ctLabel') || {}).value;
    if (!label || !label.trim()) { showToast('Label is required', true); return; }

    var fields = {
      label: label.trim(),
      description: (document.getElementById('ctDesc') || {}).value || null,
      requiresExpiry: (document.getElementById('ctExpiry') || {}).value === 'true',
    };

    try {
      var ref;
      if (clearanceTypeId) {
        await MastDB._ref('settings/clearanceTypes/' + clearanceTypeId).update(fields);
      } else {
        ref = MastDB._ref('settings/clearanceTypes').push();
        fields.createdAt = new Date().toISOString();
        await ref.set(fields);
      }
      showToast(clearanceTypeId ? 'Clearance type saved' : 'Clearance type created');
      currentView = 'clearanceTypes';
      await loadStudents();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteClearanceType(clearanceTypeId) {
    if (!confirm('Delete this clearance type? This cannot be undone.')) return;
    try {
      await MastDB._ref('settings/clearanceTypes/' + clearanceTypeId).remove();
      showToast('Clearance type deleted');
      currentView = 'clearanceTypes';
      await loadStudents();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Forms: Student Document Add/Edit
  // ========================================
  function openDocForm(studentId, docIdx) {
    var stu = studentId ? studentsData.find(function(s) { return s._key === studentId; }) : null;
    var docs = stu ? (Array.isArray(stu.documents) ? stu.documents : []) : [];
    var doc = docIdx != null ? docs[docIdx] || {} : {};
    var isNew = docIdx == null;
    editingDocId = isNew ? null : (doc.documentId || docIdx);

    var container = document.getElementById('studentsTab');
    if (!container) return;

    var backTarget = studentId ? 'studentsViewDetail(\'' + esc(studentId) + '\')' : 'studentsSwitchView(\'docs\')';

    var h = '';
    h += '<button class="detail-back" onclick="' + backTarget + '">\u2190 Back</button>';
    h += '<h3>' + (isNew ? 'New Document' : 'Edit Document') + '</h3>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;max-width:720px;">';
    h += labelField('docTitle', 'Title *', textInput('docTitle', doc.title, 'Document title'));
    h += labelField('docType', 'Type', selectInput('docType', DOC_TYPES, doc.type || 'other'));
    h += labelField('docStatus', 'Status', selectInput('docStatus', ['current', 'pending', 'expired', 'not-applicable'], doc.status || 'current'));
    h += labelField('docStorage', 'Storage Location', selectInput('docStorage', STORAGE_OPTIONS, doc.storageLocation || ''));
    h += labelField('docOnFile', 'On-File Date', dateInput('docOnFile', doc.onFileDate));
    h += labelField('docExpiry', 'Expiry Date', dateInput('docExpiry', doc.expiryDate));
    h += renderDriveUrlField('doc', doc.documentUrl, doc);
    h += fullWidthDiv(labelField('docDesc', 'Description', textareaInput('docDesc', doc.description, '', 2)));
    h += fullWidthDiv(labelField('docNotes', 'Notes', textareaInput('docNotes', doc.notes, '', 2)));
    h += '</div>';

    h += '<div style="display:flex;gap:8px;margin-top:20px;">';
    h += '<button class="btn btn-primary" onclick="studentsSaveDoc(\'' + esc(studentId || '') + '\',' + (docIdx != null ? docIdx : 'null') + ')">' + (isNew ? 'Create Document' : 'Save') + '</button>';
    h += '<button class="btn btn-secondary" onclick="' + backTarget + '">Cancel</button>';
    if (!isNew && studentId) h += '<button class="btn btn-danger" style="margin-left:auto;" onclick="studentsDeleteDoc(\'' + esc(studentId) + '\',' + docIdx + ')">Delete</button>';
    h += '</div>';

    container.innerHTML = h;
    attachDriveUrlListener('doc', 'docStorage');
  }

  async function saveDoc(studentId, docIdx) {
    var title = (document.getElementById('docTitle') || {}).value;
    if (!title || !title.trim()) { showToast('Title is required', true); return; }

    var now = new Date().toISOString();
    var record = {
      title: title.trim(),
      type: (document.getElementById('docType') || {}).value || 'other',
      description: (document.getElementById('docDesc') || {}).value || null,
      status: (document.getElementById('docStatus') || {}).value || 'current',
      storageLocation: (document.getElementById('docStorage') || {}).value || null,
      documentUrl: (document.getElementById('docUrl') || {}).value || null,
      onFileDate: (document.getElementById('docOnFile') || {}).value || null,
      expiryDate: (document.getElementById('docExpiry') || {}).value || null,
      notes: (document.getElementById('docNotes') || {}).value || null,
      updatedAt: now,
    };
    Object.assign(record, collectDriveFields('doc'));

    try {
      if (studentId) {
        var stu = studentsData.find(function(s) { return s._key === studentId; });
        var docs = (stu && Array.isArray(stu.documents)) ? stu.documents.slice() : [];
        if (docIdx != null && docs[docIdx]) {
          Object.assign(docs[docIdx], record);
        } else {
          record.documentId = 'doc_' + Date.now();
          record.createdAt = now;
          docs.push(record);
        }
        await MastDB._ref('students/' + studentId + '/documents').set(docs);
        await MastDB._ref('students/' + studentId + '/updatedAt').set(now);
        showToast(docIdx != null ? 'Document saved' : 'Document added');
        selectedStudentId = studentId;
        currentView = 'detail';
      } else {
        // Tenant-level doc
        if (editingDocId) {
          await MastDB._ref('admin/documents/' + editingDocId).update(record);
        } else {
          var ref = MastDB._ref('admin/documents').push();
          record.documentId = ref.key;
          record.createdAt = now;
          await ref.set(record);
        }
        showToast(editingDocId ? 'Document saved' : 'Document added');
        currentView = 'docs';
      }
      editingDocId = null;
      await loadStudents();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteDoc(studentId, docIdx) {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      if (studentId) {
        var stu = studentsData.find(function(s) { return s._key === studentId; });
        var docs = (stu && Array.isArray(stu.documents)) ? stu.documents.slice() : [];
        docs.splice(docIdx, 1);
        await MastDB._ref('students/' + studentId + '/documents').set(docs);
        showToast('Document deleted');
        selectedStudentId = studentId;
        currentView = 'detail';
      }
      await loadStudents();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Window Exports
  // ========================================
  window.loadStudents = loadStudents;
  window.studentsSwitchView = function(view) {
    currentView = view;
    selectedStudentId = null;
    editingStudentId = null;
    editingDocId = null;
    var container = document.getElementById('studentsTab');
    if (container) renderStudents(container);
  };
  window.studentsViewDetail = function(id) {
    selectedStudentId = id;
    currentView = 'detail';
    var container = document.getElementById('studentsTab');
    if (container) renderStudents(container);
  };
  window.studentsAdd = function() { openStudentForm(null); };
  window.studentsEdit = function(id) { openStudentForm(id); };
  window.studentsSave = saveStudent;
  window.studentsDelete = deleteStudent;
  window.studentsCancelForm = function() {
    editingStudentId = null;
    if (selectedStudentId) { currentView = 'detail'; }
    else { currentView = 'roster'; }
    var container = document.getElementById('studentsTab');
    if (container) renderStudents(container);
  };
  window.studentsToggleSection = function(id) {
    var el = document.getElementById(id);
    var arrow = document.getElementById(id + 'Arrow');
    if (el) {
      var hidden = el.style.display === 'none';
      el.style.display = hidden ? '' : 'none';
      if (arrow) arrow.textContent = hidden ? '\u25bc' : '\u25b6';
    }
  };
  window.studentsEditChecklist = openChecklistEdit;
  window.studentsSaveChecklist = saveChecklist;
  window.studentsAddClearance = openAddClearance;
  window.studentsSaveClearance = saveClearance;
  window.studentsAddClearanceType = function() { openClearanceTypeForm(null); };
  window.studentsEditClearanceType = openClearanceTypeForm;
  window.studentsSaveClearanceType = saveClearanceType;
  window.studentsDeleteClearanceType = deleteClearanceType;
  window.studentsAddDoc = function(studentId) { openDocForm(studentId, null); };
  window.studentsEditDoc = function(studentId, idx) { openDocForm(studentId, idx); };
  window.studentsAddTenantDoc = function() { openDocForm(null, null); };
  window.studentsSaveDoc = saveDoc;
  window.studentsDeleteDoc = deleteDoc;
  window.studentsUnlinkDrive = unlinkDrive;

  // --- Module Registration ---
  MastAdmin.registerModule('students', {
    routes: {
      'students': {
        tab: 'studentsTab',
        setup: function() { if (!studentsLoaded) loadStudents(); }
      }
    },
    detachListeners: function() {
      studentsData = [];
      clearanceTypes = [];
      tenantDocs = [];
      studentsLoaded = false;
      currentView = 'roster';
      selectedStudentId = null;
      editingStudentId = null;
      editingDocId = null;
    }
  });

})();
