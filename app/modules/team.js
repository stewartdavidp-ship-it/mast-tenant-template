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

  var INPUT_STYLE = 'width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;font-family:DM Sans,sans-serif;color:var(--charcoal,#1A1A1A);';

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

  // --- Load ---
  async function loadTeam() {
    var container = document.getElementById('teamTab');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading team\u2026</div>';

    try {
      var results = await Promise.all([
        MastDB._ref('admin/employees').once('value'),
        MastDB._ref('admin/documents').once('value'),
      ]);

      var empVal = results[0].val() || {};
      employeesData = Object.entries(empVal).map(function(entry) {
        var emp = entry[1];
        emp._key = entry[0];
        return emp;
      });

      var docsVal = results[1].val() || {};
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

  // --- Main Render ---
  function renderTeam(container) {
    var h = '';
    h += '<div class="view-tabs" style="margin-bottom:20px;">';
    h += '<button class="view-tab' + (currentView === 'roster' || currentView === 'detail' ? ' active' : '') + '" onclick="teamSwitchView(\'roster\')">People</button>';
    h += '<button class="view-tab' + (currentView === 'docs' ? ' active' : '') + '" onclick="teamSwitchView(\'docs\')">Documents</button>';
    h += '</div>';

    if (currentView === 'roster') {
      h += renderRoster();
    } else if (currentView === 'detail') {
      h += renderEmployeeDetail();
    } else if (currentView === 'docs') {
      h += renderTenantDocs();
    }

    container.innerHTML = h;
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

    h += '<div id="teamAddForm" style="display:none;background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamAddFormInner"></div>';
    h += '</div>';

    h += '<div id="teamRosterCards">';
    if (active.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:2rem;margin-bottom:12px;">\ud83d\udc65</div>';
      h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No employees yet</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add your team members to track pay, hours, and compliance.</p>';
      h += '</div>';
    } else {
      active.forEach(function(emp) { h += renderEmployeeCard(emp); });
    }
    h += '</div>';
    return h;
  }

  function renderEmployeeCard(emp) {
    var h = '<div data-id="' + esc(emp._key) + '" onclick="teamViewEmployee(this.dataset.id)" style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,#F0E8DB)\'">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div>';
    h += '<span style="font-weight:600;font-size:0.95rem;">\ud83d\udc64 ' + esc(emp.fullName || '') + '</span>';
    if (emp.preferredName) h += ' <span style="font-size:0.82rem;color:var(--warm-gray);">(' + esc(emp.preferredName) + ')</span>';
    if (emp.jobTitle) h += ' <span style="font-size:0.82rem;color:var(--warm-gray);">\u2014 ' + esc(emp.jobTitle) + '</span>';
    h += '<div style="font-size:0.82rem;color:var(--warm-gray,#6B6560);margin-top:2px;">';
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
        badges.push('<span style="color:#16a34a;font-size:0.75rem;">\u2713 ' + esc(f.label) + '</span>');
      } else {
        hasGaps = true;
        if (f.key === 'workersComp') {
          badges.push('<span style="color:#d97706;font-size:0.75rem;">\u26a0 Workers comp missing</span>');
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
      h += '<div style="font-size:0.75rem;color:#16a34a;margin-top:4px;">\u2713 All documents on file' + expiryNote + '</div>';
    } else {
      h += '<div style="font-size:0.75rem;margin-top:4px;">' + badges.join(' \u00b7 ') + '</div>';
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
    h += '<div style="font-size:0.82rem;color:var(--warm-gray);margin-top:4px;">';
    if (emp.jobTitle) h += esc(emp.jobTitle) + ' \u00b7 ';
    h += capitalize((emp.employmentType || '').replace('-', ' '));
    if (emp.startDate) h += ' \u00b7 Started ' + emp.startDate;
    if (emp.status === 'terminated') h += ' \u00b7 <span style="color:var(--danger);">Terminated' + (emp.terminationDate ? ' ' + emp.terminationDate : '') + '</span>';
    h += '</div>';
    h += '</div>';
    h += '<button class="btn btn-secondary btn-small" data-id="' + esc(emp._key) + '" onclick="teamEditEmployee(this.dataset.id)">Edit</button>';
    h += '</div>';

    // Edit form container (form renders here when Edit is clicked)
    h += '<div id="teamAddForm" style="display:none;background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamAddFormInner"></div>';
    h += '</div>';

    // Detail body — hidden when edit form is open
    h += '<div id="teamDetailBody">';

    // --- Pay & Employment (always visible, no collapse) ---
    h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
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

      compHtml += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:10px 14px;margin-bottom:6px;">';
      compHtml += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      compHtml += '<div>';
      compHtml += '<span style="font-weight:500;font-size:0.9rem;">' + esc(f.label) + '</span>';
      if (item.storageLocation) compHtml += ' <span style="font-size:0.75rem;color:var(--warm-gray);">\u00b7 ' + esc(capitalize(item.storageLocation.replace('-', ' '))) + '</span>';
      if (item.expiryDate) {
        var daysToExpiry = Math.floor((new Date(item.expiryDate).getTime() - Date.now()) / 86400000);
        if (daysToExpiry <= 90 && daysToExpiry > 0) compHtml += ' <span style="font-size:0.75rem;color:#d97706;">\u26a0 expires in ' + daysToExpiry + 'd</span>';
        else if (daysToExpiry <= 0) compHtml += ' <span style="font-size:0.75rem;color:var(--danger);">Expired</span>';
      }
      compHtml += '</div>';
      compHtml += '<div style="display:flex;align-items:center;gap:8px;">';
      compHtml += '<span style="color:' + statusColor + ';font-weight:600;font-size:0.82rem;">' + statusIcon + ' ' + statusLabel + '</span>';
      compHtml += '<button class="btn btn-secondary btn-small" data-emp="' + esc(emp._key) + '" data-key="' + esc(f.key) + '" onclick="teamEditCompliance(this.dataset.emp, this.dataset.key)">Edit</button>';
      compHtml += '</div>';
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
    var docsRight = '<button class="btn btn-primary btn-small" data-emp="' + esc(emp._key) + '" onclick="event.stopPropagation();teamAddEmpDoc(this.dataset.emp)">+ New Document</button>';
    h += collapsibleSection('secDocs', 'Documents', docsHtml, { open: docs.length > 0, badge: '<span style="font-size:0.78rem;color:var(--warm-gray);">' + docs.length + '</span>', rightHtml: docsRight });

    // --- Hours Log (collapsible, closed by default) ---
    var hoursLog = emp.hoursLog || {};
    var hoursCount = typeof hoursLog === 'object' ? Object.keys(hoursLog).length : 0;
    h += collapsibleSection('secHours', 'Hours Log', renderHoursSection(emp), { open: false, badge: hoursCount > 0 ? '<span style="font-size:0.78rem;color:var(--warm-gray);">' + hoursCount + ' entries</span>' : '' });

    // --- References (collapsible, closed by default) ---
    var refsData = emp.references || {};
    var refsCount = Array.isArray(refsData) ? refsData.length : Object.keys(refsData).length;
    h += collapsibleSection('secRefs', 'References', renderReferencesSection(emp), { open: false, badge: refsCount > 0 ? '<span style="font-size:0.78rem;color:var(--warm-gray);">' + refsCount + '</span>' : '' });

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

    var h = '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="font-weight:600;font-size:0.95rem;margin-bottom:12px;">Edit: ' + esc(fieldLabel ? fieldLabel.label : fieldKey) + '</div>';
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
      await MastDB._ref('admin/employees/' + empId + '/complianceChecklist/' + fieldKey).update(fields);
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
    var h = '<div style="margin-bottom:16px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
    h += '<div style="font-size:1rem;font-weight:600;">Hours Log</div>';
    h += '<button class="btn btn-primary btn-small" data-id="' + esc(emp._key) + '" onclick="teamLogHours(this.dataset.id)">+ Log Hours</button>';
    h += '</div>';

    h += '<div id="teamHoursForm" style="display:none;background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamHoursFormInner"></div>';
    h += '</div>';
    h += '<div id="teamHoursTable" style="font-size:0.85rem;color:var(--warm-gray);">Loading hours\u2026</div>';
    h += '</div>';

    setTimeout(function() { loadHoursForEmployee(emp._key); }, 0);
    return h;
  }

  async function loadHoursForEmployee(empId) {
    var container = document.getElementById('teamHoursTable');
    if (!container) return;
    try {
      var eightWeeksAgo = new Date();
      eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
      var snap = await MastDB._ref('admin/employees/' + empId + '/hoursLog')
        .orderByChild('date')
        .startAt(eightWeeksAgo.toISOString().split('T')[0])
        .once('value');
      var data = snap.val() || {};
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
        h += '<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:0.82rem;color:#92400e;">\u26a0 This employee has logged ' + currentWeekTotal.toFixed(1) + ' hours this week \u2014 approaching overtime.</div>';
      }

      h += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
      h += '<tr style="border-bottom:1px solid var(--cream-dark,#F0E8DB);"><th style="text-align:left;padding:6px 8px;font-weight:600;">Date</th><th style="text-align:right;padding:6px 8px;font-weight:600;">Hours</th><th style="text-align:right;padding:6px 8px;font-weight:600;">OT</th><th style="text-align:left;padding:6px 8px;font-weight:600;">Notes</th></tr>';
      entries.slice(0, 20).forEach(function(entry) {
        h += '<tr style="border-bottom:1px solid var(--cream-dark,#F0E8DB);">';
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
      var ref = MastDB._ref('admin/employees/' + empId + '/hoursLog').push();
      record.logId = ref.key;
      await ref.set(record);
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

    var h = '<div style="margin-bottom:16px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
    h += '<div style="font-size:1rem;font-weight:600;">References</div>';
    h += '<button class="btn btn-primary btn-small" data-emp="' + esc(emp._key) + '" onclick="teamAddReference(this.dataset.emp)">+ New Reference</button>';
    h += '</div>';
    h += '<div id="teamRefForm" style="display:none;"></div>';

    if (refList.length === 0) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">No references on file.</div>';
    } else {
      refList.forEach(function(ref) {
        var outcomeColor = ref.outcome === 'concerning' ? '#d97706' : ref.outcome === 'positive' ? '#16a34a' : 'var(--warm-gray)';
        h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:10px 14px;margin-bottom:6px;">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        h += '<div>';
        h += '<span style="font-weight:500;">' + esc(ref.name || '') + '</span>';
        if (ref.phone) h += ' <span style="font-size:0.82rem;color:var(--warm-gray);">' + esc(ref.phone) + '</span>';
        if (ref.relationship) h += ' <span style="font-size:0.82rem;color:var(--warm-gray);">(' + esc(ref.relationship) + ')</span>';
        h += ' <span class="status-badge" style="background:' + outcomeColor + '22;color:' + outcomeColor + ';">' + esc(capitalize((ref.outcome || 'not-checked').replace('-', ' '))) + '</span>';
        if (ref.checkedDate) h += ' <span style="font-size:0.75rem;color:var(--warm-gray-light);">' + esc(ref.checkedDate) + '</span>';
        h += '</div>';
        h += '<button class="btn btn-secondary btn-small" data-emp="' + esc(emp._key) + '" data-ref="' + esc(ref._key) + '" onclick="teamEditReference(this.dataset.emp, this.dataset.ref)">Edit</button>';
        h += '</div>';
        if (ref.notes) h += '<div style="font-size:0.82rem;color:var(--warm-gray);margin-top:4px;">' + esc(ref.notes) + '</div>';
        h += '</div>';
      });
    }
    h += '</div>';
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

    var h = '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="font-weight:600;font-size:0.95rem;margin-bottom:12px;">' + (refId ? 'Edit Reference' : 'New Reference') + '</div>';
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
        await MastDB._ref('admin/employees/' + empId + '/references/' + editingRefId).update(fields);
        showToast('Reference saved');
      } else {
        fields.createdAt = new Date().toISOString();
        var ref = MastDB._ref('admin/employees/' + empId + '/references').push();
        fields.referenceId = ref.key;
        await ref.set(fields);
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
    if (!confirm('Delete this reference? This cannot be undone.')) return;
    try {
      await MastDB._ref('admin/employees/' + empId + '/references/' + refId).remove();
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

    h += '<div id="teamDocForm" style="display:none;background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamDocFormInner"></div>';
    h += '</div>';

    if (tenantDocs.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:2rem;margin-bottom:12px;">\ud83d\udcc4</div>';
      h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No business documents</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Track business licenses, insurance certificates, leases, and permits.</p>';
      h += '</div>';
    } else {
      tenantDocs.forEach(function(doc) { h += renderDocCard(doc, true, null); });
    }
    return h;
  }

  function renderDocCard(doc, isTenantLevel, empId) {
    var h = '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:12px 16px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div style="font-weight:600;font-size:0.9rem;">' + esc(doc.title || 'Untitled') + '</div>';
    if (isTenantLevel) {
      h += '<button class="btn btn-secondary btn-small" data-id="' + esc(doc._key || doc.documentId || '') + '" onclick="teamEditTenantDoc(this.dataset.id)">Edit</button>';
    } else if (empId) {
      h += '<button class="btn btn-secondary btn-small" data-emp="' + esc(empId) + '" data-id="' + esc(doc._key || doc.documentId || '') + '" onclick="teamEditEmpDoc(this.dataset.emp, this.dataset.id)">Edit</button>';
    }
    h += '</div>';
    h += '<div style="font-size:0.82rem;color:var(--warm-gray);margin-top:4px;">';
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
      h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    }
    h += '<div style="font-weight:600;font-size:0.95rem;margin-bottom:12px;">' + (isNew ? 'New Document' : 'Edit Document') + '</div>';
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
        await MastDB._ref('admin/documents/' + editingDocId).update(fields);
        showToast('Document saved');
      } else {
        fields.createdAt = new Date().toISOString();
        fields.documentId = MastDB._ref('admin/documents').push().key;
        await MastDB._ref('admin/documents/' + fields.documentId).set(fields);
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
        await MastDB._ref('admin/employees/' + empId + '/documents/' + editingDocId).update(fields);
        showToast('Document saved');
      } else {
        fields.createdAt = new Date().toISOString();
        var ref = MastDB._ref('admin/employees/' + empId + '/documents').push();
        fields.documentId = ref.key;
        await ref.set(fields);
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
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      await MastDB._ref('admin/documents/' + docId).remove();
      showToast('Document deleted');
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteEmpDoc(empId, docId) {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      await MastDB._ref('admin/employees/' + empId + '/documents/' + docId).remove();
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

    var h = '<div style="font-weight:600;font-size:0.95rem;margin-bottom:12px;">' + (isNew ? 'New Employee' : 'Edit Employee') + '</div>';

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
        await MastDB._ref('admin/employees/' + editingEmployeeId).update(fields);
        showToast('Employee saved');
      } else {
        fields.createdAt = new Date().toISOString();
        var newId = 'emp_' + Date.now();
        await MastDB._ref('admin/employees/' + newId).set(fields);
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
    if (!confirm('Delete this employee and all their data? This cannot be undone.')) return;
    try {
      await MastDB._ref('admin/employees/' + empId).remove();
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
    currentView = view;
    selectedEmployeeId = null;
    var container = document.getElementById('teamTab');
    if (container) renderTeam(container);
  };
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
  window.teamAddTenantDoc = function() { openDocForm(null, true, null); };
  window.teamEditTenantDoc = function(id) { openDocForm(id, true, null); };
  window.teamSaveDoc = saveDoc;
  window.teamDeleteDoc = deleteDoc;
  window.teamCancelDocForm = function() {
    var el = document.getElementById('teamDocForm');
    if (el) el.style.display = 'none';
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
    }
  });
})();
