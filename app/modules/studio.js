(function() {
  'use strict';

  var equipmentData = [];
  var laborData = null;
  var employeesData = [];
  var overheadExpenseTotal = 0;
  var overheadExpenseCount = 0;
  var overheadItemsData = [];
  var studioLoaded = false;
  var editingEquipmentId = null;

  // --- Helpers ---
  function fmtDollars(cents) {
    if (cents == null) return 'not set';
    return '$' + (cents / 100).toFixed(2);
  }
  function fmtDollarsWhole(val) {
    if (val == null) return 'not set';
    return '$' + val.toFixed(2);
  }
  function computeEquipmentCosts(item) {
    var monthlyCostToOwn = (item.purchasePrice != null && item.usefulLifeYears != null && item.usefulLifeYears > 0)
      ? item.purchasePrice / item.usefulLifeYears / 12
      : null;
    var runCost = item.monthlyRunningCost != null ? item.monthlyRunningCost : null;
    var totalMonthlyCost = (monthlyCostToOwn != null && runCost != null)
      ? monthlyCostToOwn + runCost
      : null;
    var costPerUnit = (totalMonthlyCost != null && item.typicalOutputPerMonth != null && item.typicalOutputPerMonth > 0)
      ? totalMonthlyCost / item.typicalOutputPerMonth
      : null;
    return { monthlyCostToOwn: monthlyCostToOwn, totalMonthlyCost: totalMonthlyCost, costPerUnit: costPerUnit };
  }
  // Standard input style (dark mode aware)
  var INPUT_STYLE = 'width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;background:var(--cream,#FAF6F0);color:var(--charcoal,#1a1a1a);box-sizing:border-box;';

  // --- Load ---
  async function loadStudio() {
    var container = document.getElementById('studioTab');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading studio costs\u2026</div>';

    try {
      var [equipSnap, laborSnap, employeesSnap, overheadItemsSnap, expSnap] = await Promise.all([
        MastDB.lpe.equipment.list(),
        MastDB.lpe.laborProfile.get(),
        MastDB._ref('admin/lpe/employees').once('value'),
        MastDB._ref('admin/lpe/overheadItems').once('value'),
        MastDB._ref('admin/expenses').orderByChild('isStudioOverhead').equalTo(true).limitToLast(200).once('value'),
      ]);

      var eqVal = equipSnap.val() || {};
      equipmentData = Object.entries(eqVal).map(function(entry) {
        var item = entry[1];
        item._key = entry[0];
        return item;
      });

      laborData = laborSnap.val() || {};

      var empVal = employeesSnap.val() || {};
      employeesData = Object.entries(empVal).map(function(entry) {
        var emp = entry[1];
        emp._key = entry[0];
        return emp;
      });

      var ohItemsVal = overheadItemsSnap.val() || {};
      overheadItemsData = Object.entries(ohItemsVal).map(function(entry) {
        var item = entry[1];
        item._key = entry[0];
        return item;
      });

      var ohVal = expSnap.val() || {};
      var ohList = Object.values(ohVal);
      overheadExpenseTotal = ohList.reduce(function(sum, e) { return sum + (e.amount || 0); }, 0);
      overheadExpenseCount = ohList.length;

      studioLoaded = true;
      renderStudio(container);
    } catch (err) {
      console.error('Error loading studio:', err);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">Error loading studio data.</div>';
    }
  }

  // --- Main Render ---
  function renderStudio(container) {
    var h = '';
    h += '<div class="section-header"><h2>Studio Cost Setup</h2></div>';
    h += renderSummaryCard();
    h += renderEquipmentSection();
    h += renderLaborSection();
    h += renderTeamSection();
    h += renderOverheadSection();
    container.innerHTML = h;
  }

  // --- Surface 1: Summary Card ---
  function renderSummaryCard() {
    var totalEquipMonthly = 0;
    var equipPartial = false;
    equipmentData.forEach(function(item) {
      var costs = computeEquipmentCosts(item);
      if (costs.totalMonthlyCost != null) {
        totalEquipMonthly += costs.totalMonthlyCost;
      } else {
        equipPartial = true;
      }
    });

    var hasEquip = equipmentData.length > 0;
    var directOverheadTotal = overheadItemsData.reduce(function(s, i) { return s + (i.monthlyAmount || 0); }, 0);
    var combinedOverhead = overheadExpenseTotal + directOverheadTotal;
    var hasOverhead = overheadExpenseCount > 0 || overheadItemsData.length > 0;
    var hasLabor = laborData && laborData.ownerHourlyRate != null;
    var hasTeam = employeesData.length > 0;
    var isEmpty = !hasEquip && !hasOverhead && !hasLabor;

    var h = '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:20px 24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="font-size:1.15rem;font-weight:500;font-family:\'DM Sans\',sans-serif;margin-bottom:12px;">Your studio costs to run</div>';

    if (isEmpty) {
      h += '<div style="font-size:0.9rem;color:var(--warm-gray,#6B6560);">';
      h += 'Add your equipment and expenses below to see what your studio costs per month before you make anything.';
      h += '</div>';
    } else {
      h += '<div style="display:flex;flex-direction:column;gap:6px;font-size:0.9rem;">';

      h += '<div style="display:flex;justify-content:space-between;">';
      h += '<span>Equipment (monthly)</span>';
      if (hasEquip) {
        h += '<span style="font-weight:600;">' + fmtDollarsWhole(totalEquipMonthly) + (equipPartial ? ' *' : '') + '</span>';
      } else {
        h += '<span style="color:var(--warm-gray-light,#9B958E);">not set</span>';
      }
      h += '</div>';

      h += '<div style="display:flex;justify-content:space-between;">';
      h += '<span>Fixed overhead</span>';
      if (hasOverhead) {
        h += '<span style="font-weight:600;">' + fmtDollars(combinedOverhead) + '</span>';
      } else {
        h += '<span style="color:var(--warm-gray-light,#9B958E);">not set</span>';
      }
      h += '</div>';

      // Team labor (if employees exist)
      if (hasTeam) {
        var teamMonthly = employeesData.reduce(function(s, e) { return s + ((e.hourlyRate || 0) * (e.hoursPerWeek || 0) * 4.33); }, 0);
        h += '<div style="display:flex;justify-content:space-between;">';
        h += '<span>Team labor</span>';
        h += '<span style="font-weight:600;">' + fmtDollarsWhole(teamMonthly) + '/mo</span>';
        h += '</div>';
      }

      h += '<hr style="border:none;border-top:1px solid var(--cream-dark,#F0E8DB);margin:4px 0;">';

      var floorCost = totalEquipMonthly + (combinedOverhead / 100);
      var isComplete = hasEquip && !equipPartial && hasOverhead;
      h += '<div style="display:flex;justify-content:space-between;font-weight:700;">';
      h += '<span>Studio floor cost</span>';
      h += '<span>' + (isComplete ? fmtDollarsWhole(floorCost) : 'partial') + '</span>';
      h += '</div>';

      h += '</div>';

      if (equipPartial) {
        h += '<div style="font-size:0.78rem;color:var(--warm-gray,#6B6560);margin-top:8px;">* Some equipment details missing \u2014 see below</div>';
      }
    }

    h += '</div>';
    return h;
  }

  // --- Surface 2: Equipment Register ---
  function renderEquipmentSection() {
    var h = '<div style="margin-bottom:28px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    h += '<h3 style="margin:0;font-size:1.15rem;font-weight:500;">Your Equipment</h3>';
    h += '<button class="btn btn-primary" style="font-size:0.82rem;padding:6px 16px;" onclick="studioAddEquipment()">+ New Equipment</button>';
    h += '</div>';

    h += '<div id="studioEquipForm" style="display:none;background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="studioEquipFormInner"></div>';
    h += '</div>';

    if (equipmentData.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray,#6B6560);">';
      h += '<div style="font-size:2rem;margin-bottom:12px;">\uD83D\uDD27</div>';
      h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No equipment yet</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light,#9B958E);">Add your kiln, torch, or other major tools.</p>';
      h += '</div>';
    } else {
      equipmentData.forEach(function(item) {
        var costs = computeEquipmentCosts(item);
        var gaps = item.gaps || {};
        var hasGaps = Object.keys(gaps).length > 0;
        var hasHighGap = Object.values(gaps).some(function(g) { return g.priority === 'high'; });

        h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        h += '<div style="font-weight:600;font-size:0.95rem;">' + esc(item.name || 'Untitled');
        if (hasHighGap) h += ' <span title="Some details missing" style="color:#d97706;cursor:help;">\u26A0</span>';
        h += '</div>';
        h += '<button class="btn btn-secondary btn-small" data-id="' + esc(item._key) + '" onclick="studioEditEquipment(this.dataset.id)">Edit</button>';
        h += '</div>';

        var parts = [];
        if (costs.monthlyCostToOwn != null) parts.push(fmtDollarsWhole(costs.monthlyCostToOwn) + '/mo to own');
        else if (item.purchasePrice != null) parts.push('purchase price on file');
        if (item.monthlyRunningCost != null) parts.push(fmtDollarsWhole(item.monthlyRunningCost) + '/mo to run');
        else parts.push('running cost not on file');
        if (costs.costPerUnit != null) parts.push(fmtDollarsWhole(costs.costPerUnit) + '/' + esc(item.outputUnit || 'unit'));

        h += '<div style="font-size:0.82rem;color:var(--warm-gray,#6B6560);margin-top:4px;">' + parts.join(' \u00B7 ') + '</div>';

        if (hasGaps) {
          h += '<div style="margin-top:6px;">';
          Object.entries(gaps).forEach(function(entry) {
            var gap = entry[1];
            h += '<div style="font-size:0.75rem;color:#d97706;padding:1px 0;">\u26A0 ' + esc(gap.hint || entry[0]) + '</div>';
          });
          h += '</div>';
        }

        h += '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  // --- Equipment Add/Edit Form ---
  function openEquipmentForm(equipId) {
    editingEquipmentId = equipId;
    var item = equipId ? equipmentData.find(function(e) { return e._key === equipId; }) : {};
    if (!item) item = {};
    var isNew = !equipId;

    var formEl = document.getElementById('studioEquipForm');
    var innerEl = document.getElementById('studioEquipFormInner');
    if (!formEl || !innerEl) return;

    var h = '<div style="font-weight:600;font-size:0.95rem;margin-bottom:12px;">' + (isNew ? 'New Equipment' : 'Edit Equipment') + '</div>';

    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    h += '<div style="grid-column:1/-1;">';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">What do you call this?</label>';
    h += '<input id="eqName" type="text" value="' + esc(item.name || '') + '" placeholder="e.g. Large kiln, Torch setup" style="' + INPUT_STYLE + '">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">What did it cost?</label>';
    h += '<input id="eqPrice" type="number" step="0.01" value="' + (item.purchasePrice != null ? item.purchasePrice : '') + '" placeholder="$" style="' + INPUT_STYLE + '">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">How many years will it last?</label>';
    h += '<input id="eqLife" type="number" value="' + (item.usefulLifeYears != null ? item.usefulLifeYears : '') + '" placeholder="years" style="' + INPUT_STYLE + '">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Monthly running cost?</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,#6B6560);margin-bottom:2px;">Electricity, gas, maintenance</div>';
    h += '<input id="eqRunCost" type="number" step="0.01" value="' + (item.monthlyRunningCost != null ? item.monthlyRunningCost : '') + '" placeholder="$/month" style="' + INPUT_STYLE + '">';
    h += '</div>';

    h += '<div style="grid-column:1/-1;">';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Monthly output?</label>';
    h += '<div style="display:flex;gap:8px;">';
    h += '<input id="eqOutput" type="number" value="' + (item.typicalOutputPerMonth != null ? item.typicalOutputPerMonth : '') + '" placeholder="quantity" style="' + INPUT_STYLE + 'flex:1;">';
    h += '<select id="eqUnit" style="' + INPUT_STYLE + 'width:auto;min-width:100px;flex:0 0 auto;">';
    ['pieces', 'firings', 'hours'].forEach(function(u) {
      h += '<option value="' + u + '"' + ((item.outputUnit || 'pieces') === u ? ' selected' : '') + '>' + u + '/month</option>';
    });
    h += '</select>';
    h += '</div>';
    h += '</div>';

    h += '</div>';

    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';
    h += '<button class="btn btn-primary" onclick="studioSaveEquipment()">' + (isNew ? 'Create Equipment' : 'Save') + '</button>';
    h += '<button class="btn btn-secondary" onclick="studioCancelEquipForm()">Cancel</button>';
    if (!isNew) {
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" data-id="' + esc(equipId) + '" onclick="studioDeleteEquipment(this.dataset.id)">Delete</button></span>';
    }
    h += '</div>';

    innerEl.innerHTML = h;
    formEl.style.display = '';
    document.getElementById('eqName').focus();
  }

  async function saveEquipment() {
    var name = document.getElementById('eqName').value.trim();
    if (!name) { showToast('Equipment name is required', true); return; }

    var fields = {
      name: name,
      purchasePrice: parseFloat(document.getElementById('eqPrice').value) || null,
      usefulLifeYears: parseInt(document.getElementById('eqLife').value) || null,
      monthlyRunningCost: parseFloat(document.getElementById('eqRunCost').value) || null,
      typicalOutputPerMonth: parseInt(document.getElementById('eqOutput').value) || null,
      outputUnit: document.getElementById('eqUnit').value || 'pieces',
      updatedAt: new Date().toISOString(),
    };

    try {
      if (editingEquipmentId) {
        await MastDB.lpe.equipment.update(editingEquipmentId, fields);
        var gaps = computeLocalGaps(fields);
        await MastDB.lpe.equipment.ref(editingEquipmentId).child('gaps').set(gaps);
        showToast('Equipment saved');
      } else {
        var newId = 'equip_' + Date.now();
        fields.createdAt = new Date().toISOString();
        await MastDB.lpe.equipment.set(newId, fields);
        var gaps = computeLocalGaps(fields);
        await MastDB.lpe.equipment.ref(newId).child('gaps').set(gaps);
        showToast('Equipment created');
      }
      editingEquipmentId = null;
      studioLoaded = false;
      loadStudio();
    } catch (err) {
      showToast('Error saving: ' + esc(err.message), true);
    }
  }

  async function deleteEquipment(equipId) {
    if (!confirm('Delete this equipment? This cannot be undone.')) return;
    try {
      await MastDB.lpe.equipment.remove(equipId);
      showToast('Equipment deleted');
      studioLoaded = false;
      loadStudio();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  function computeLocalGaps(item) {
    var GAP_HINTS = {
      purchasePrice: { priority: 'medium', hint: 'Needed to calculate what this equipment costs you per month' },
      usefulLifeYears: { priority: 'medium', hint: 'Needed to calculate what this equipment costs you per month' },
      monthlyRunningCost: { priority: 'high', hint: 'Needed to calculate true cost per piece \u2014 utilities can be the biggest hidden cost' },
      typicalOutputPerMonth: { priority: 'high', hint: 'Needed to spread the equipment cost across what you make' },
    };
    var gaps = {};
    for (var field in GAP_HINTS) {
      if (item[field] == null) gaps[field] = GAP_HINTS[field];
    }
    return Object.keys(gaps).length > 0 ? gaps : null;
  }

  // --- Surface 3: Labor Profile ---
  function renderLaborSection() {
    var h = '<div style="margin-bottom:28px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    h += '<h3 style="margin:0;font-size:1.15rem;font-weight:500;">Your time & pay</h3>';
    h += '<button class="btn btn-secondary btn-small" onclick="studioEditLabor()">Edit</button>';
    h += '</div>';

    h += '<div id="studioLaborForm" style="display:none;background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="studioLaborFormInner"></div>';
    h += '</div>';

    h += '<div id="studioLaborDisplay" style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    var hasData = laborData && (laborData.ownerHourlyRate != null || laborData.productionHoursPerWeek != null);
    if (!hasData) {
      h += '<div style="color:var(--warm-gray,#6B6560);font-size:0.9rem;">Not set yet. Click Edit to add your time and target pay.</div>';
    } else {
      var rate = laborData.ownerHourlyRate;
      var prod = laborData.productionHoursPerWeek;
      var admin = laborData.adminHoursPerWeek;
      var total = (prod != null && admin != null) ? prod + admin : (prod || admin || null);

      h += '<div style="display:flex;flex-direction:column;gap:4px;font-size:0.9rem;">';
      h += '<div style="display:flex;justify-content:space-between;"><span>Target pay</span><span style="font-weight:600;">' + (rate != null ? '$' + rate + '/hr' : '<span style="color:var(--warm-gray-light);">not set</span>') + '</span></div>';
      h += '<div style="display:flex;justify-content:space-between;"><span>Making (weekly)</span><span style="font-weight:600;">' + (prod != null ? prod + ' hrs' : '<span style="color:var(--warm-gray-light);">not set</span>') + '</span></div>';
      h += '<div style="display:flex;justify-content:space-between;"><span>Business tasks</span><span style="font-weight:600;">' + (admin != null ? admin + ' hrs' : '<span style="color:var(--warm-gray-light);">not set</span>') + '</span></div>';
      if (total != null) {
        h += '<hr style="border:none;border-top:1px solid var(--cream-dark,#F0E8DB);margin:2px 0;">';
        h += '<div style="display:flex;justify-content:space-between;font-weight:700;"><span>Total weekly</span><span>' + total + ' hrs</span></div>';
      }
      h += '</div>';

      if (laborData.lastReviewedAt) {
        h += '<div style="font-size:0.75rem;color:var(--warm-gray-light,#9B958E);margin-top:6px;">Last updated ' + laborData.lastReviewedAt.split('T')[0] + '</div>';
      }
    }
    h += '</div>';
    h += '</div>';
    return h;
  }

  function openLaborForm() {
    var formEl = document.getElementById('studioLaborForm');
    var innerEl = document.getElementById('studioLaborFormInner');
    var displayEl = document.getElementById('studioLaborDisplay');
    if (!formEl || !innerEl) return;
    if (displayEl) displayEl.style.display = 'none';

    var d = laborData || {};
    var h = '';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';

    h += '<div>';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Target hourly pay</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,#6B6560);margin-bottom:2px;">What you\'d pay a skilled person to do your job</div>';
    h += '<input id="laborRate" type="number" step="0.01" value="' + (d.ownerHourlyRate != null ? d.ownerHourlyRate : '') + '" placeholder="$/hr" style="' + INPUT_STYLE + '">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Making hours/week</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,#6B6560);margin-bottom:2px;">At the bench, kiln, or torch</div>';
    h += '<input id="laborProd" type="number" value="' + (d.productionHoursPerWeek != null ? d.productionHoursPerWeek : '') + '" placeholder="hrs" style="' + INPUT_STYLE + '">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Business tasks/week</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,#6B6560);margin-bottom:2px;">Packing, photos, emails, markets</div>';
    h += '<input id="laborAdmin" type="number" value="' + (d.adminHoursPerWeek != null ? d.adminHoursPerWeek : '') + '" placeholder="hrs" style="' + INPUT_STYLE + '">';
    h += '</div>';

    h += '</div>';

    h += '<div style="display:flex;gap:8px;margin-top:14px;">';
    h += '<button class="btn btn-primary" onclick="studioSaveLabor()">Save</button>';
    h += '<button class="btn btn-secondary" onclick="studioCancelLaborForm()">Cancel</button>';
    h += '</div>';

    innerEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function saveLabor() {
    var fields = {
      ownerHourlyRate: parseFloat(document.getElementById('laborRate').value) || null,
      productionHoursPerWeek: parseInt(document.getElementById('laborProd').value) || null,
      adminHoursPerWeek: parseInt(document.getElementById('laborAdmin').value) || null,
      lastReviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await MastDB.lpe.laborProfile.update(fields);
      var LABOR_GAPS = {
        ownerHourlyRate: { priority: 'high', hint: 'Used to check whether your recipe prices are paying you fairly' },
        productionHoursPerWeek: { priority: 'high', hint: 'Needed to calculate your effective hourly rate from actual revenue' },
        adminHoursPerWeek: { priority: 'medium', hint: 'Most artists only count bench time \u2014 admin hours are the hidden labor cost' },
      };
      var gaps = {};
      for (var f in LABOR_GAPS) {
        if (fields[f] == null) gaps[f] = LABOR_GAPS[f];
      }
      await MastDB.lpe.laborProfile.ref().child('gaps').set(Object.keys(gaps).length > 0 ? gaps : null);
      showToast('Labor profile saved');
      studioLoaded = false;
      loadStudio();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // --- Surface 4: Team Section ---
  function renderTeamSection() {
    var h = '<div style="margin-bottom:28px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    h += '<h3 style="margin:0;font-size:1.15rem;font-weight:500;">Team</h3>';
    h += '<button class="btn btn-primary btn-small" onclick="studioAddEmployee()">+ New Team Member</button>';
    h += '</div>';

    h += '<div id="studioEmpForm" style="display:none;background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="studioEmpFormInner"></div>';
    h += '</div>';

    if (employeesData.length === 0) {
      h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,0.08);color:var(--warm-gray,#6B6560);font-size:0.9rem;">';
      h += 'No team members added. If you have studio help, add them here so the advisor can factor in total labor cost.';
      h += '</div>';
    } else {
      employeesData.forEach(function(emp) {
        var monthlyCost = ((emp.hourlyRate || 0) * (emp.hoursPerWeek || 0) * 4.33);
        h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        h += '<div><span style="font-weight:600;">' + esc(emp.name) + '</span>';
        if (emp.role) h += ' <span style="font-size:0.82rem;color:var(--warm-gray);">\u2014 ' + esc(emp.role) + '</span>';
        h += '</div>';
        h += '<button class="btn btn-secondary btn-small" data-id="' + esc(emp._key) + '" onclick="studioEditEmployee(this.dataset.id)">Edit</button>';
        h += '</div>';
        h += '<div style="font-size:0.82rem;color:var(--warm-gray,#6B6560);margin-top:4px;">';
        h += (emp.hourlyRate != null ? '$' + emp.hourlyRate + '/hr' : 'rate not set');
        h += ' \u00B7 ' + (emp.hoursPerWeek != null ? emp.hoursPerWeek + ' hrs/week' : 'hours not set');
        h += ' \u00B7 ~' + fmtDollarsWhole(monthlyCost) + '/mo';
        h += '</div>';
        h += '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  // --- Employee Add/Edit Form ---
  var editingEmployeeId = null;
  function openEmployeeForm(empId) {
    editingEmployeeId = empId;
    var emp = empId ? employeesData.find(function(e) { return e._key === empId; }) : {};
    if (!emp) emp = {};
    var isNew = !empId;
    var formEl = document.getElementById('studioEmpForm');
    var innerEl = document.getElementById('studioEmpFormInner');
    if (!formEl || !innerEl) return;

    var h = '<div style="font-weight:600;font-size:0.95rem;margin-bottom:12px;">' + (isNew ? 'New Team Member' : 'Edit Team Member') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Name</label>';
    h += '<input id="empName" type="text" value="' + esc(emp.name || '') + '" placeholder="e.g. Ori" style="' + INPUT_STYLE + '"></div>';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Role</label>';
    h += '<input id="empRole" type="text" value="' + esc(emp.role || '') + '" placeholder="e.g. Studio assistant" style="' + INPUT_STYLE + '"></div>';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Hourly rate</label>';
    h += '<input id="empRate" type="number" step="0.01" value="' + (emp.hourlyRate != null ? emp.hourlyRate : '') + '" placeholder="$/hr" style="' + INPUT_STYLE + '"></div>';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Hours per week</label>';
    h += '<input id="empHours" type="number" value="' + (emp.hoursPerWeek != null ? emp.hoursPerWeek : '') + '" placeholder="hrs/week" style="' + INPUT_STYLE + '"></div>';
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';
    h += '<button class="btn btn-primary" onclick="studioSaveEmployee()">' + (isNew ? 'Create Team Member' : 'Save') + '</button>';
    h += '<button class="btn btn-secondary" onclick="studioCancelEmpForm()">Cancel</button>';
    if (!isNew) {
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" data-id="' + esc(empId) + '" onclick="studioDeleteEmployee(this.dataset.id)">Delete</button></span>';
    }
    h += '</div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
    document.getElementById('empName').focus();
  }

  async function saveEmployee() {
    var name = document.getElementById('empName').value.trim();
    if (!name) { showToast('Name is required', true); return; }
    var fields = {
      name: name,
      role: document.getElementById('empRole').value.trim() || null,
      hourlyRate: parseFloat(document.getElementById('empRate').value) || null,
      hoursPerWeek: parseInt(document.getElementById('empHours').value) || null,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editingEmployeeId) {
        await MastDB._ref('admin/lpe/employees/' + editingEmployeeId).update(fields);
        showToast('Team member saved');
      } else {
        fields.createdAt = new Date().toISOString();
        var newId = 'emp_' + Date.now();
        await MastDB._ref('admin/lpe/employees/' + newId).set(fields);
        showToast('Team member added');
      }
      editingEmployeeId = null;
      studioLoaded = false;
      loadStudio();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteEmployee(empId) {
    if (!confirm('Delete this team member? This cannot be undone.')) return;
    try {
      await MastDB._ref('admin/lpe/employees/' + empId).remove();
      showToast('Team member deleted');
      studioLoaded = false;
      loadStudio();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // --- Surface 5: Overhead Section ---
  function renderOverheadSection() {
    var h = '<div style="margin-bottom:28px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    h += '<h3 style="margin:0;font-size:1.15rem;font-weight:500;">Fixed overhead</h3>';
    h += '<button class="btn btn-primary btn-small" onclick="studioAddOverheadItem()">+ New Cost</button>';
    h += '</div>';

    h += '<div id="studioOhForm" style="display:none;background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="studioOhFormInner"></div>';
    h += '</div>';

    // Direct overhead items
    if (overheadItemsData.length > 0) {
      overheadItemsData.forEach(function(item) {
        h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        h += '<span style="font-weight:600;">' + esc(item.name) + '</span>';
        h += '<div style="display:flex;align-items:center;gap:8px;">';
        h += '<span style="font-weight:600;">' + fmtDollars(item.monthlyAmount) + '/mo</span>';
        h += '<button class="btn btn-secondary btn-small" data-id="' + esc(item._key) + '" onclick="studioEditOverheadItem(this.dataset.id)">Edit</button>';
        h += '</div></div>';
        if (item.notes) h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' + esc(item.notes) + '</div>';
        h += '</div>';
      });
    }

    // Expense-tagged overhead
    if (overheadExpenseCount > 0) {
      h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      h += '<span style="font-weight:600;">From expenses</span>';
      h += '<span style="font-weight:600;">' + fmtDollars(overheadExpenseTotal) + '</span>';
      h += '</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray,#6B6560);margin-top:4px;">' + overheadExpenseCount + ' expense' + (overheadExpenseCount !== 1 ? 's' : '') + ' tagged as studio overhead in <a href="#expenses" onclick="navigateTo(\'expenses\')" style="color:var(--teal,#2A7C6F);">Expenses</a></div>';
      h += '</div>';
    }

    if (overheadItemsData.length === 0 && overheadExpenseCount === 0) {
      h += '<div style="background:var(--cream,#FAF6F0);border:1px solid var(--cream-dark,#F0E8DB);border-radius:8px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,0.08);color:var(--warm-gray,#6B6560);font-size:0.9rem;">';
      h += 'No overhead costs yet. Add recurring costs like rent, mortgage, insurance, or tag expenses in the <a href="#expenses" onclick="navigateTo(\'expenses\')" style="color:var(--teal,#2A7C6F);">Expenses</a> section.';
      h += '</div>';
    }

    h += '</div>';
    return h;
  }

  // --- Overhead Item Add/Edit Form ---
  var editingOhItemId = null;
  function openOverheadItemForm(itemId) {
    editingOhItemId = itemId;
    var item = itemId ? overheadItemsData.find(function(i) { return i._key === itemId; }) : {};
    if (!item) item = {};
    var isNew = !itemId;
    var formEl = document.getElementById('studioOhForm');
    var innerEl = document.getElementById('studioOhFormInner');
    if (!formEl || !innerEl) return;

    var h = '<div style="font-weight:600;font-size:0.95rem;margin-bottom:12px;">' + (isNew ? 'New Overhead Cost' : 'Edit Overhead Cost') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">What is this cost?</label>';
    h += '<input id="ohName" type="text" value="' + esc(item.name || '') + '" placeholder="e.g. Studio rent, Insurance" style="' + INPUT_STYLE + '"></div>';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Monthly amount</label>';
    h += '<input id="ohAmount" type="number" step="0.01" value="' + (item.monthlyAmount != null ? (item.monthlyAmount / 100).toFixed(2) : '') + '" placeholder="$/month" style="' + INPUT_STYLE + '"></div>';
    h += '<div style="grid-column:1/-1;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Notes</label>';
    h += '<input id="ohNotes" type="text" value="' + esc(item.notes || '') + '" placeholder="Optional notes" style="' + INPUT_STYLE + '"></div>';
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';
    h += '<button class="btn btn-primary" onclick="studioSaveOverheadItem()">' + (isNew ? 'Create Cost' : 'Save') + '</button>';
    h += '<button class="btn btn-secondary" onclick="studioCancelOhForm()">Cancel</button>';
    if (!isNew) {
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" data-id="' + esc(itemId) + '" onclick="studioDeleteOverheadItem(this.dataset.id)">Delete</button></span>';
    }
    h += '</div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
    document.getElementById('ohName').focus();
  }

  async function saveOverheadItem() {
    var name = document.getElementById('ohName').value.trim();
    if (!name) { showToast('Name is required', true); return; }
    var amountDollars = parseFloat(document.getElementById('ohAmount').value);
    var fields = {
      name: name,
      monthlyAmount: amountDollars ? Math.round(amountDollars * 100) : null,
      notes: document.getElementById('ohNotes').value.trim() || null,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editingOhItemId) {
        await MastDB._ref('admin/lpe/overheadItems/' + editingOhItemId).update(fields);
        showToast('Overhead cost saved');
      } else {
        fields.createdAt = new Date().toISOString();
        var newId = 'oh_' + Date.now();
        await MastDB._ref('admin/lpe/overheadItems/' + newId).set(fields);
        showToast('Overhead cost added');
      }
      editingOhItemId = null;
      studioLoaded = false;
      loadStudio();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteOverheadItem(itemId) {
    if (!confirm('Delete this overhead cost? This cannot be undone.')) return;
    try {
      await MastDB._ref('admin/lpe/overheadItems/' + itemId).remove();
      showToast('Overhead cost deleted');
      studioLoaded = false;
      loadStudio();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // --- Window Exports ---
  window.loadStudio = loadStudio;
  window.studioAddEquipment = function() { openEquipmentForm(null); };
  window.studioEditEquipment = function(id) { openEquipmentForm(id); };
  window.studioSaveEquipment = saveEquipment;
  window.studioDeleteEquipment = deleteEquipment;
  window.studioCancelEquipForm = function() {
    var formEl = document.getElementById('studioEquipForm');
    if (formEl) formEl.style.display = 'none';
    editingEquipmentId = null;
  };
  window.studioEditLabor = openLaborForm;
  window.studioSaveLabor = saveLabor;
  window.studioCancelLaborForm = function() {
    var formEl = document.getElementById('studioLaborForm');
    var displayEl = document.getElementById('studioLaborDisplay');
    if (formEl) formEl.style.display = 'none';
    if (displayEl) displayEl.style.display = '';
  };
  window.studioAddEmployee = function() { openEmployeeForm(null); };
  window.studioEditEmployee = function(id) { openEmployeeForm(id); };
  window.studioSaveEmployee = saveEmployee;
  window.studioDeleteEmployee = deleteEmployee;
  window.studioCancelEmpForm = function() {
    var el = document.getElementById('studioEmpForm');
    if (el) el.style.display = 'none';
    editingEmployeeId = null;
  };
  window.studioAddOverheadItem = function() { openOverheadItemForm(null); };
  window.studioEditOverheadItem = function(id) { openOverheadItemForm(id); };
  window.studioSaveOverheadItem = saveOverheadItem;
  window.studioDeleteOverheadItem = deleteOverheadItem;
  window.studioCancelOhForm = function() {
    var el = document.getElementById('studioOhForm');
    if (el) el.style.display = 'none';
    editingOhItemId = null;
  };

  MastAdmin.registerModule('studio', {
    routes: {
      'studio': {
        tab: 'studioTab',
        setup: function() { if (!studioLoaded) loadStudio(); }
      }
    },
    detachListeners: function() {
      equipmentData = [];
      laborData = null;
      employeesData = [];
      overheadExpenseTotal = 0;
      overheadExpenseCount = 0;
      overheadItemsData = [];
      studioLoaded = false;
      editingEquipmentId = null;
    }
  });
})();
