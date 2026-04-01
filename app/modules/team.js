(function() {
  'use strict';

  var employeesData = [];
  var tenantDocs = [];
  var teamLoaded = false;
  var currentView = 'roster'; // roster | detail | docs
  var selectedEmployeeId = null;

  // --- Helpers ---
  function fmtDollars(cents) {
    if (cents == null || cents === 0) return 'not set';
    return '$' + (cents / 100).toFixed(2);
  }
  function fmtRate(cents) {
    if (cents == null) return 'not set';
    return '$' + (cents / 100).toFixed(2) + '/hr';
  }
  var COMPLIANCE_FIELDS = [
    { key: 'i9', label: 'I-9' },
    { key: 'w4', label: 'W-4' },
    { key: 'stateWithholding', label: 'State Withholding' },
    { key: 'offerLetter', label: 'Offer Letter' },
    { key: 'workersCom', label: "Workers' Comp Certificate" },
  ];
  var STORAGE_OPTIONS = ['physical', 'google-drive', 'dropbox', 'gusto', 'other'];
  var DOC_TYPES = ['employment', 'tax', 'certification', 'insurance', 'license', 'legal', 'compliance', 'financial', 'other'];

  // --- Load ---
  async function loadTeam() {
    var container = document.getElementById('teamTab');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading team\u2026</div>';

    try {
      var [empSnap, docsSnap] = await Promise.all([
        MastDB._ref('admin/employees').once('value'),
        MastDB._ref('admin/documents').once('value'),
      ]);

      var empVal = empSnap.val() || {};
      employeesData = Object.entries(empVal).map(function(entry) {
        var emp = entry[1];
        emp._key = entry[0];
        return emp;
      }).filter(function(e) { return e.status !== 'terminated'; });

      var docsVal = docsSnap.val() || {};
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
    // Sub-nav tabs
    h += '<div class="view-tabs" style="margin-bottom:20px;">';
    h += '<button class="view-tab' + (currentView === 'roster' ? ' active' : '') + '" onclick="teamSwitchView(\'roster\')">People</button>';
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

  // --- Surface 1: Employee Roster ---
  function renderRoster() {
    var h = '';

    // Summary card
    var active = employeesData.filter(function(e) { return e.status === 'active'; });
    var partTime = active.filter(function(e) { return e.employmentType === 'part-time'; });
    var gapCount = 0;
    active.forEach(function(emp) {
      var cl = emp.complianceChecklist || {};
      COMPLIANCE_FIELDS.forEach(function(f) {
        if (!cl[f.key] || cl[f.key].status !== 'completed') gapCount++;
      });
    });
    var totalMonthlyCost = active.reduce(function(s, e) {
      if (e.payType === 'hourly') return s + ((e.payRate || 0) * (e.scheduledHoursPerWeek || 0) * 4.33);
      return s + (e.payRate || 0); // salary = monthly
    }, 0);

    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<div>';
    h += '<h2 style="margin:0;">Your team</h2>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    h += active.length + ' active';
    if (partTime.length > 0) h += ' \u00B7 ' + partTime.length + ' part-time';
    if (gapCount > 0) h += ' \u00B7 <span style="color:#d97706;">\u26A0 ' + gapCount + ' compliance gap' + (gapCount !== 1 ? 's' : '') + '</span>';
    h += '</div>';
    if (active.length > 0) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:2px;">Monthly labor cost: <strong>' + fmtDollars(Math.round(totalMonthlyCost)) + '</strong></div>';
    }
    h += '</div>';
    h += '<button class="btn btn-primary" onclick="teamAddEmployee()">+ New Employee</button>';
    h += '</div>';

    // Add form
    h += '<div id="teamAddForm" style="display:none;background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamAddFormInner"></div>';
    h += '</div>';

    if (active.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:2rem;margin-bottom:12px;">\uD83D\uDC65</div>';
      h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No employees yet</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add your team members to track pay, hours, and compliance.</p>';
      h += '</div>';
    } else {
      active.forEach(function(emp) {
        h += renderEmployeeCard(emp);
      });
    }
    return h;
  }

  function renderEmployeeCard(emp) {
    var h = '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div>';
    h += '<span style="font-weight:600;font-size:0.95rem;">' + esc(emp.fullName || '') + '</span>';
    if (emp.jobTitle) h += ' <span style="font-size:0.82rem;color:var(--warm-gray);">\u2014 ' + esc(emp.jobTitle) + '</span>';
    h += '<div style="font-size:0.82rem;color:var(--warm-gray,#6B6560);margin-top:2px;">';
    if (emp.employmentType) h += esc(emp.employmentType.charAt(0).toUpperCase() + emp.employmentType.slice(1));
    h += ' \u00B7 ' + fmtRate(emp.payRate);
    if (emp.scheduledHoursPerWeek) h += ' \u00B7 ' + emp.scheduledHoursPerWeek + ' hrs/week';
    h += '</div>';
    h += '</div>';
    h += '<div style="display:flex;gap:6px;">';
    h += '<button class="btn btn-secondary btn-small" data-id="' + esc(emp._key) + '" onclick="teamViewEmployee(this.dataset.id)">View</button>';
    h += '</div>';
    h += '</div>';

    // Compliance summary
    var cl = emp.complianceChecklist || {};
    var badges = [];
    var hasGaps = false;
    COMPLIANCE_FIELDS.forEach(function(f) {
      var item = cl[f.key];
      if (item && item.status === 'completed') {
        badges.push('<span style="color:#16a34a;font-size:0.75rem;">\u2713 ' + f.label + '</span>');
      } else {
        hasGaps = true;
        if (f.key === 'workersCom') {
          badges.push('<span style="color:#d97706;font-size:0.75rem;">\u26A0 Workers comp missing</span>');
        }
      }
    });
    if (!hasGaps) {
      h += '<div style="font-size:0.75rem;color:#16a34a;margin-top:4px;">\u2713 All documents on file</div>';
    } else {
      h += '<div style="font-size:0.75rem;margin-top:4px;">' + badges.join(' \u00B7 ') + '</div>';
    }

    h += '</div>';
    return h;
  }

  // --- Surface 2: Employee Detail ---
  function renderEmployeeDetail() {
    var emp = employeesData.find(function(e) { return e._key === selectedEmployeeId; });
    if (!emp) return '<div style="color:var(--danger);">Employee not found.</div>';

    var h = '';
    h += '<button class="detail-back" onclick="teamSwitchView(\'roster\')">\u2190 Back to People</button>';

    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">';
    h += '<div>';
    h += '<h3 style="margin:0;">' + esc(emp.fullName || '') + '</h3>';
    h += '<div style="font-size:0.82rem;color:var(--warm-gray);margin-top:4px;">';
    if (emp.jobTitle) h += esc(emp.jobTitle) + ' \u00B7 ';
    h += esc((emp.employmentType || '').charAt(0).toUpperCase() + (emp.employmentType || '').slice(1));
    if (emp.startDate) h += ' \u00B7 Started ' + emp.startDate;
    h += '</div>';
    h += '</div>';
    h += '<button class="btn btn-secondary btn-small" data-id="' + esc(emp._key) + '" onclick="teamEditEmployee(this.dataset.id)">Edit</button>';
    h += '</div>';

    // Pay summary
    h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:0.9rem;">';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">Pay</span><br><strong>' + fmtRate(emp.payRate) + '</strong></div>';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">Schedule</span><br><strong>' + (emp.scheduledHoursPerWeek ? emp.scheduledHoursPerWeek + ' hrs/week' : 'not set') + '</strong></div>';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">Frequency</span><br><strong>' + esc(emp.payFrequency || 'not set') + '</strong></div>';
    h += '</div></div>';

    // Contact info
    if (emp.phone || (emp.address && emp.address.street) || (emp.emergencyContact && emp.emergencyContact.name)) {
      h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
      h += '<div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;">Contact</div>';
      if (emp.phone) h += '<div style="font-size:0.85rem;margin-bottom:4px;">\uD83D\uDCDE ' + esc(emp.phone) + '</div>';
      if (emp.address && emp.address.street) {
        h += '<div style="font-size:0.85rem;margin-bottom:4px;">' + esc(emp.address.street);
        if (emp.address.city) h += ', ' + esc(emp.address.city);
        if (emp.address.state) h += ', ' + esc(emp.address.state);
        if (emp.address.zip) h += ' ' + esc(emp.address.zip);
        h += '</div>';
      }
      if (emp.emergencyContact && emp.emergencyContact.name) {
        h += '<div style="font-size:0.85rem;margin-top:8px;"><strong>Emergency:</strong> ' + esc(emp.emergencyContact.name);
        if (emp.emergencyContact.phone) h += ' \u00B7 ' + esc(emp.emergencyContact.phone);
        if (emp.emergencyContact.relationship) h += ' (' + esc(emp.emergencyContact.relationship) + ')';
        h += '</div>';
      }
      h += '</div>';
    }

    // Compliance checklist
    h += '<div style="margin-bottom:16px;">';
    h += '<div style="font-size:1rem;font-weight:600;margin-bottom:10px;">Compliance Checklist</div>';
    var cl = emp.complianceChecklist || {};
    COMPLIANCE_FIELDS.forEach(function(f) {
      var item = cl[f.key] || {};
      var status = item.status || 'missing';
      var statusColor = status === 'completed' ? '#16a34a' : status === 'not-applicable' ? 'var(--warm-gray-light)' : '#d97706';
      var statusIcon = status === 'completed' ? '\u2713' : status === 'not-applicable' ? '\u2014' : '\u26A0';
      var statusLabel = status === 'completed' ? 'Complete' : status === 'not-applicable' ? 'N/A' : 'Missing';

      h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:10px 14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">';
      h += '<div>';
      h += '<span style="font-weight:500;font-size:0.9rem;">' + esc(f.label) + '</span>';
      if (item.storageLocation) h += ' <span style="font-size:0.75rem;color:var(--warm-gray);">\u00B7 ' + esc(item.storageLocation) + '</span>';
      if (item.expiryDate) {
        var daysToExpiry = Math.floor((new Date(item.expiryDate).getTime() - Date.now()) / 86400000);
        if (daysToExpiry <= 90 && daysToExpiry > 0) h += ' <span style="font-size:0.75rem;color:#d97706;">\u26A0 expires in ' + daysToExpiry + 'd</span>';
        else if (daysToExpiry <= 0) h += ' <span style="font-size:0.75rem;color:var(--danger);">Expired</span>';
      }
      if (f.key === 'workersCom' && status !== 'completed') {
        h += '<div style="font-size:0.72rem;color:#d97706;margin-top:2px;">Required in most states from your first employee.</div>';
      }
      h += '</div>';
      h += '<span style="color:' + statusColor + ';font-weight:600;font-size:0.82rem;">' + statusIcon + ' ' + statusLabel + '</span>';
      h += '</div>';
    });
    h += '</div>';

    // Employee documents
    var docs = emp.documents || [];
    h += '<div style="margin-bottom:16px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
    h += '<div style="font-size:1rem;font-weight:600;">Employee Documents</div>';
    h += '</div>';
    if (docs.length === 0) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">No documents on file. Use the AI advisor to add documents.</div>';
    } else {
      docs.forEach(function(doc) {
        h += renderDocCard(doc);
      });
    }
    h += '</div>';

    // Hours log (read-only display of recent entries)
    h += renderHoursSection(emp);

    // References
    var refs = emp.references || [];
    if (refs.length > 0) {
      h += '<div style="margin-bottom:16px;">';
      h += '<div style="font-size:1rem;font-weight:600;margin-bottom:10px;">References</div>';
      refs.forEach(function(ref) {
        var outcomeColor = ref.outcome === 'concerning' ? '#d97706' : ref.outcome === 'positive' ? '#16a34a' : 'var(--warm-gray)';
        h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:10px 14px;margin-bottom:6px;">';
        h += '<span style="font-weight:500;">' + esc(ref.name || '') + '</span>';
        if (ref.relationship) h += ' <span style="font-size:0.82rem;color:var(--warm-gray);">(' + esc(ref.relationship) + ')</span>';
        h += ' <span class="status-badge" style="background:' + outcomeColor + '22;color:' + outcomeColor + ';">' + esc(ref.outcome || 'not-checked') + '</span>';
        if (ref.checkedDate) h += ' <span style="font-size:0.75rem;color:var(--warm-gray-light);">' + esc(ref.checkedDate) + '</span>';
        h += '</div>';
      });
      h += '</div>';
    }

    return h;
  }

  // --- Hours Section ---
  function renderHoursSection(emp) {
    var h = '<div style="margin-bottom:16px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
    h += '<div style="font-size:1rem;font-weight:600;">Hours Log</div>';
    h += '<button class="btn btn-primary btn-small" data-id="' + esc(emp._key) + '" onclick="teamLogHours(this.dataset.id)">+ Log Hours</button>';
    h += '</div>';

    h += '<div id="teamHoursForm" style="display:none;background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamHoursFormInner"></div>';
    h += '</div>';

    // Load hours from subcollection (already loaded async if we have them)
    // For now show placeholder — hours load async on detail view
    h += '<div id="teamHoursTable" style="font-size:0.85rem;color:var(--warm-gray);">Loading hours\u2026</div>';
    h += '</div>';

    // Async load hours
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

      var h = '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
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

  // Hours log form
  function openLogHoursForm(empId) {
    var formEl = document.getElementById('teamHoursForm');
    var innerEl = document.getElementById('teamHoursFormInner');
    if (!formEl || !innerEl) return;

    var today = new Date().toISOString().split('T')[0];
    var h = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:10px;align-items:end;">';
    h += '<div><label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">Date</label>';
    h += '<input id="hoursDate" type="date" value="' + today + '" style="width:100%;padding:8px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.85rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';
    h += '<div><label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">Hours</label>';
    h += '<input id="hoursWorked" type="number" step="0.5" placeholder="8" style="width:100%;padding:8px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.85rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';
    h += '<div><label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">Overtime</label>';
    h += '<input id="hoursOT" type="number" step="0.5" value="0" style="width:100%;padding:8px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.85rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';
    h += '<div><label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">Notes</label>';
    h += '<input id="hoursNotes" type="text" placeholder="Optional" style="width:100%;padding:8px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.85rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';
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

  // --- Surface 3: Tenant Documents ---
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
      h += '<div style="font-size:2rem;margin-bottom:12px;">\uD83D\uDCC4</div>';
      h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No business documents</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Track business licenses, insurance certificates, leases, and permits.</p>';
      h += '</div>';
    } else {
      tenantDocs.forEach(function(doc) {
        h += renderDocCard(doc, true);
      });
    }
    return h;
  }

  function renderDocCard(doc, isTenantLevel) {
    var h = '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:12px 16px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div style="font-weight:600;font-size:0.9rem;">' + esc(doc.title || 'Untitled') + '</div>';
    if (isTenantLevel) {
      h += '<button class="btn btn-secondary btn-small" data-id="' + esc(doc._key || doc.documentId || '') + '" onclick="teamEditTenantDoc(this.dataset.id)">Edit</button>';
    }
    h += '</div>';
    h += '<div style="font-size:0.82rem;color:var(--warm-gray);margin-top:4px;">';
    var parts = [];
    if (doc.type) parts.push(doc.type.charAt(0).toUpperCase() + doc.type.slice(1));
    if (doc.storageLocation) parts.push(doc.storageLocation);
    h += parts.join(' \u00B7 ');

    if (doc.driveFileName) {
      h += '<div style="margin-top:2px;">\uD83D\uDCC4 ' + esc(doc.driveFileName);
      if (doc.driveLastModified) h += ' \u00B7 Modified ' + doc.driveLastModified.split('T')[0];
      h += '</div>';
    }

    if (doc.expiryDate) {
      var daysToExpiry = Math.floor((new Date(doc.expiryDate).getTime() - Date.now()) / 86400000);
      if (daysToExpiry <= 0) {
        h += '<div style="color:var(--danger);margin-top:2px;">Expired ' + doc.expiryDate + '</div>';
      } else if (daysToExpiry <= 90) {
        h += '<div style="color:#d97706;margin-top:2px;">\u26A0 Expires in ' + daysToExpiry + ' days (' + doc.expiryDate + ')</div>';
      } else {
        h += '<div style="margin-top:2px;">Expires ' + doc.expiryDate + '</div>';
      }
    }
    h += '</div></div>';
    return h;
  }

  // --- Add Employee Form ---
  var editingEmployeeId = null;
  function openAddEmployeeForm(empId) {
    editingEmployeeId = empId;
    var emp = empId ? employeesData.find(function(e) { return e._key === empId; }) : {};
    if (!emp) emp = {};
    var isNew = !empId;

    var formEl = document.getElementById('teamAddForm');
    var innerEl = document.getElementById('teamAddFormInner');
    if (!formEl || !innerEl) return;

    var h = '<div style="font-weight:600;font-size:0.95rem;margin-bottom:12px;">' + (isNew ? 'New Employee' : 'Edit Employee') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Full name</label>';
    h += '<input id="teamEmpName" type="text" value="' + esc(emp.fullName || '') + '" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';

    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Job title</label>';
    h += '<input id="teamEmpTitle" type="text" value="' + esc(emp.jobTitle || '') + '" placeholder="e.g. Studio assistant" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';

    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Employment type</label>';
    h += '<select id="teamEmpType" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;">';
    ['full-time', 'part-time', 'temp', 'contractor'].forEach(function(t) {
      h += '<option value="' + t + '"' + ((emp.employmentType || 'part-time') === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    });
    h += '</select></div>';

    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Pay rate ($/hr)</label>';
    h += '<input id="teamEmpRate" type="number" step="0.01" value="' + (emp.payRate ? (emp.payRate / 100).toFixed(2) : '') + '" placeholder="$/hr" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';

    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Hours per week</label>';
    h += '<input id="teamEmpHours" type="number" value="' + (emp.scheduledHoursPerWeek || '') + '" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';

    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Start date</label>';
    h += '<input id="teamEmpStart" type="date" value="' + (emp.startDate || '') + '" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';

    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;">';
    h += '<button class="btn btn-primary" onclick="teamSaveEmployee()">' + (isNew ? 'Create Employee' : 'Save') + '</button>';
    h += '<button class="btn btn-secondary" onclick="teamCancelAddForm()">Cancel</button>';
    h += '</div>';

    innerEl.innerHTML = h;
    formEl.style.display = '';
    document.getElementById('teamEmpName').focus();
  }

  async function saveEmployee() {
    var name = document.getElementById('teamEmpName').value.trim();
    if (!name) { showToast('Name is required', true); return; }
    var rateDollars = parseFloat(document.getElementById('teamEmpRate').value);
    var fields = {
      fullName: name,
      jobTitle: document.getElementById('teamEmpTitle').value.trim() || null,
      employmentType: document.getElementById('teamEmpType').value,
      payRate: rateDollars ? Math.round(rateDollars * 100) : null,
      payType: 'hourly',
      scheduledHoursPerWeek: parseInt(document.getElementById('teamEmpHours').value) || null,
      startDate: document.getElementById('teamEmpStart').value || null,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editingEmployeeId) {
        await MastDB._ref('admin/employees/' + editingEmployeeId).update(fields);
        showToast('Employee saved');
      } else {
        fields.createdAt = new Date().toISOString();
        fields.status = 'active';
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

  // --- Tenant Document Add/Edit ---
  var editingDocId = null;
  function openDocForm(docId) {
    editingDocId = docId;
    var doc = docId ? tenantDocs.find(function(d) { return d._key === docId || d.documentId === docId; }) : {};
    if (!doc) doc = {};
    var isNew = !docId;

    var formEl = document.getElementById('teamDocForm');
    var innerEl = document.getElementById('teamDocFormInner');
    if (!formEl || !innerEl) return;

    var h = '<div style="font-weight:600;font-size:0.95rem;margin-bottom:12px;">' + (isNew ? 'New Document' : 'Edit Document') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Title</label>';
    h += '<input id="docTitle" type="text" value="' + esc(doc.title || '') + '" placeholder="e.g. Business License" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';

    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Type</label>';
    h += '<select id="docType" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;">';
    DOC_TYPES.forEach(function(t) {
      h += '<option value="' + t + '"' + ((doc.type || 'other') === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    });
    h += '</select></div>';

    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Storage</label>';
    h += '<select id="docStorage" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;">';
    h += '<option value="">Not specified</option>';
    STORAGE_OPTIONS.forEach(function(s) {
      h += '<option value="' + s + '"' + ((doc.storageLocation || '') === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' ') + '</option>';
    });
    h += '</select></div>';

    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Expiry date</label>';
    h += '<input id="docExpiry" type="date" value="' + (doc.expiryDate || '') + '" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';

    h += '<div style="grid-column:1/-1;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Notes</label>';
    h += '<input id="docNotes" type="text" value="' + esc(doc.notes || '') + '" placeholder="Optional" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,#FAF6F0);box-sizing:border-box;"></div>';

    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';
    h += '<button class="btn btn-primary" onclick="teamSaveDoc()">' + (isNew ? 'Create Document' : 'Save') + '</button>';
    h += '<button class="btn btn-secondary" onclick="teamCancelDocForm()">Cancel</button>';
    if (!isNew) {
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" data-id="' + esc(docId) + '" onclick="teamDeleteDoc(this.dataset.id)">Delete</button></span>';
    }
    h += '</div>';

    innerEl.innerHTML = h;
    formEl.style.display = '';
    document.getElementById('docTitle').focus();
  }

  async function saveDoc() {
    var title = document.getElementById('docTitle').value.trim();
    if (!title) { showToast('Title is required', true); return; }
    var fields = {
      title: title,
      type: document.getElementById('docType').value,
      storageLocation: document.getElementById('docStorage').value || null,
      expiryDate: document.getElementById('docExpiry').value || null,
      notes: document.getElementById('docNotes').value.trim() || null,
      status: 'current',
      updatedAt: new Date().toISOString(),
    };
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

  // --- Window Exports ---
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
  window.teamCancelAddForm = function() {
    var el = document.getElementById('teamAddForm');
    if (el) el.style.display = 'none';
    editingEmployeeId = null;
  };
  window.teamLogHours = function(empId) { openLogHoursForm(empId); };
  window.teamSaveHours = saveHours;
  window.teamAddTenantDoc = function() { openDocForm(null); };
  window.teamEditTenantDoc = function(id) { openDocForm(id); };
  window.teamSaveDoc = saveDoc;
  window.teamDeleteDoc = deleteDoc;
  window.teamCancelDocForm = function() {
    var el = document.getElementById('teamDocForm');
    if (el) el.style.display = 'none';
    editingDocId = null;
  };

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
    }
  });
})();
