(function() {
  'use strict';

  var equipmentData = [];
  var foundersData = [];
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
  var INPUT_STYLE = 'width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;background:var(--cream,var(--cream));color:var(--charcoal,var(--charcoal));box-sizing:border-box;';

  // --- Load ---
  async function loadStudio() {
    var container = document.getElementById('studioTab');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading studio costs\u2026</div>';

    try {
      var [equipSnap, foundersSnap, employeesSnap, overheadItemsSnap, expSnap] = await Promise.all([
        MastDB.lpe.equipment.list(),
        MastDB.get('admin/lpe/founders'),
        MastDB.get('admin/employees'),
        MastDB.get('admin/lpe/overheadItems'),
        MastDB.query('admin/expenses').orderByChild('isStudioOverhead').equalTo(true).limitToLast(200).once('value'),
      ]);

      var eqVal = equipSnap || {};
      equipmentData = Object.entries(eqVal).map(function(entry) {
        var item = entry[1];
        item._key = entry[0];
        return item;
      });

      var fVal = foundersSnap || {};
      foundersData = Object.entries(fVal).map(function(entry) {
        var f = entry[1];
        f._key = entry[0];
        return f;
      });

      var empVal = employeesSnap || {};
      employeesData = Object.entries(empVal).map(function(entry) {
        var emp = entry[1];
        emp._key = entry[0];
        return emp;
      });

      var ohItemsVal = overheadItemsSnap || {};
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
    h += renderFoundersSection();
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
    var hasFounders = foundersData.length > 0;
    var hasTeam = employeesData.length > 0;
    var isEmpty = !hasEquip && !hasOverhead && !hasFounders;

    var h = '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:20px 24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="font-size:1.15rem;font-weight:500;font-family:\'DM Sans\',sans-serif;margin-bottom:12px;">Your studio costs to run</div>';

    if (isEmpty) {
      h += '<div style="font-size:0.9rem;color:var(--warm-gray,var(--warm-gray));">';
      h += 'Add your equipment and expenses below to see what your studio costs per month before you make anything.';
      h += '</div>';
    } else {
      h += '<div style="display:flex;flex-direction:column;gap:6px;font-size:0.9rem;">';

      h += '<div style="display:flex;justify-content:space-between;">';
      h += '<span>Equipment (monthly)</span>';
      if (hasEquip) {
        h += '<span style="font-weight:600;">' + fmtDollarsWhole(totalEquipMonthly) + (equipPartial ? ' *' : '') + '</span>';
      } else {
        h += '<span style="color:var(--warm-gray-light,var(--warm-gray-light));">not set</span>';
      }
      h += '</div>';

      h += '<div style="display:flex;justify-content:space-between;">';
      h += '<span>Fixed overhead</span>';
      if (hasOverhead) {
        h += '<span style="font-weight:600;">' + fmtDollars(combinedOverhead) + '</span>';
      } else {
        h += '<span style="color:var(--warm-gray-light,var(--warm-gray-light));">not set</span>';
      }
      h += '</div>';

      // Team labor (if employees exist)
      if (hasTeam) {
        var teamMonthlyCents = employeesData.reduce(function(s, e) {
          if (e.payType === 'salary') return s + (e.payRate || 0);
          return s + Math.round((e.payRate || 0) * (e.scheduledHoursPerWeek || 0) * 4.33);
        }, 0);
        h += '<div style="display:flex;justify-content:space-between;">';
        h += '<span>Team labor</span>';
        h += '<span style="font-weight:600;">' + fmtDollars(Math.round(teamMonthlyCents)) + '/mo</span>';
        h += '</div>';
      }

      h += '<hr style="border:none;border-top:1px solid var(--cream-dark,var(--cream-dark));margin:4px 0;">';

      var floorCost = totalEquipMonthly + (combinedOverhead / 100);
      var isComplete = hasEquip && !equipPartial && hasOverhead;
      h += '<div style="display:flex;justify-content:space-between;font-weight:700;">';
      h += '<span>Studio floor cost</span>';
      h += '<span>' + (isComplete ? fmtDollarsWhole(floorCost) : 'partial') + '</span>';
      h += '</div>';

      h += '</div>';

      if (equipPartial) {
        h += '<div style="font-size:0.78rem;color:var(--warm-gray,var(--warm-gray));margin-top:8px;">* Some equipment details missing \u2014 see below</div>';
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
    h += '<button class="btn btn-primary" style="font-size:0.85rem;padding:6px 16px;" onclick="studioAddEquipment()">+ New Equipment</button>';
    h += '</div>';

    h += '<div id="studioEquipForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="studioEquipFormInner"></div>';
    h += '</div>';

    if (equipmentData.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray,var(--warm-gray));">';
      h += '<div style="font-size:1.6rem;margin-bottom:12px;">\uD83D\uDD27</div>';
      h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No equipment yet</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light,var(--warm-gray-light));">Add your kiln, torch, or other major tools.</p>';
      h += '</div>';
    } else {
      equipmentData.forEach(function(item) {
        var costs = computeEquipmentCosts(item);
        var gaps = item.gaps || {};
        var hasGaps = Object.keys(gaps).length > 0;
        var hasHighGap = Object.values(gaps).some(function(g) { return g.priority === 'high'; });

        h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        h += '<div style="font-weight:600;font-size:0.9rem;">' + esc(item.name || 'Untitled');
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

        h += '<div style="font-size:0.85rem;color:var(--warm-gray,var(--warm-gray));margin-top:4px;">' + parts.join(' \u00B7 ') + '</div>';

        if (hasGaps) {
          h += '<div style="margin-top:6px;">';
          Object.entries(gaps).forEach(function(entry) {
            var gap = entry[1];
            h += '<div style="font-size:0.78rem;color:#d97706;padding:1px 0;">\u26A0 ' + esc(gap.hint || entry[0]) + '</div>';
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

    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (isNew ? 'New Equipment' : 'Edit Equipment') + '</div>';

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
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,var(--warm-gray));margin-bottom:2px;">Electricity, gas, maintenance</div>';
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
    if (!await mastConfirm('Delete this equipment? This cannot be undone.', { title: 'Delete Equipment', danger: true })) return;
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

  // --- Surface 3: Founders ---
  function renderFoundersSection() {
    var h = '<div style="margin-bottom:28px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    h += '<h3 style="margin:0;font-size:1.15rem;font-weight:500;">Founder time & pay</h3>';
    h += '<button class="btn btn-primary btn-small" onclick="studioAddFounder()">+ New Founder</button>';
    h += '</div>';

    h += '<div id="studioFounderForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="studioFounderFormInner"></div>';
    h += '</div>';

    if (foundersData.length === 0) {
      h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,0.08);color:var(--warm-gray,var(--warm-gray));font-size:0.9rem;">';
      h += 'No founders added yet. Add yourself (and any co-owners) to track time and target pay.';
      h += '</div>';
    } else {
      foundersData.forEach(function(f) {
        var rate = f.hourlyRate || f.ownerHourlyRate;
        var prod = f.productionHoursPerWeek;
        var admin = f.adminHoursPerWeek;
        var total = (prod != null && admin != null) ? prod + admin : (prod || admin || null);
        var monthlyCost = ((rate || 0) * (total || 0) * 4.33);

        h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        h += '<span style="font-weight:600;">' + esc(f.name || 'Founder') + '</span>';
        h += '<button class="btn btn-secondary btn-small" data-id="' + esc(f._key) + '" onclick="studioEditFounder(this.dataset.id)">Edit</button>';
        h += '</div>';
        h += '<div style="font-size:0.85rem;color:var(--warm-gray,var(--warm-gray));margin-top:4px;">';
        h += (rate != null ? '$' + rate + '/hr' : 'rate not set');
        h += ' \u00B7 ' + (prod != null ? prod + ' hrs making' : 'making hrs not set');
        h += ' \u00B7 ' + (admin != null ? admin + ' hrs business' : 'business hrs not set');
        if (total != null) h += ' \u00B7 ' + total + ' hrs/week total';
        h += ' \u00B7 ~' + fmtDollarsWhole(monthlyCost) + '/mo';
        h += '</div>';
        h += '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  // --- Founder Add/Edit Form ---
  var editingFounderId = null;
  function openFounderForm(founderId) {
    editingFounderId = founderId;
    var f = founderId ? foundersData.find(function(x) { return x._key === founderId; }) : {};
    if (!f) f = {};
    var isNew = !founderId;
    var formEl = document.getElementById('studioFounderForm');
    var innerEl = document.getElementById('studioFounderFormInner');
    if (!formEl || !innerEl) return;

    var rate = f.hourlyRate || f.ownerHourlyRate;
    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (isNew ? 'New Founder' : 'Edit Founder') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += '<div style="grid-column:1/-1;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Name</label>';
    h += '<input id="founderName" type="text" value="' + esc(f.name || '') + '" placeholder="e.g. Madeline" style="' + INPUT_STYLE + '"></div>';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Target hourly pay</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,var(--warm-gray));margin-bottom:2px;">What you\'d pay a skilled person to do this job</div>';
    h += '<input id="founderRate" type="number" step="0.01" value="' + (rate != null ? rate : '') + '" placeholder="$/hr" style="' + INPUT_STYLE + '"></div>';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Making hours/week</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,var(--warm-gray));margin-bottom:2px;">At the bench, kiln, or torch</div>';
    h += '<input id="founderProd" type="number" value="' + (f.productionHoursPerWeek != null ? f.productionHoursPerWeek : '') + '" placeholder="hrs" style="' + INPUT_STYLE + '"></div>';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Business tasks/week</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,var(--warm-gray));margin-bottom:2px;">Packing, photos, emails, markets</div>';
    h += '<input id="founderAdmin" type="number" value="' + (f.adminHoursPerWeek != null ? f.adminHoursPerWeek : '') + '" placeholder="hrs" style="' + INPUT_STYLE + '"></div>';
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';
    h += '<button class="btn btn-primary" onclick="studioSaveFounder()">' + (isNew ? 'Create Founder' : 'Save') + '</button>';
    h += '<button class="btn btn-secondary" onclick="studioCancelFounderForm()">Cancel</button>';
    if (!isNew) {
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" data-id="' + esc(founderId) + '" onclick="studioDeleteFounder(this.dataset.id)">Delete</button></span>';
    }
    h += '</div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
    document.getElementById('founderName').focus();
  }

  async function saveFounder() {
    var name = document.getElementById('founderName').value.trim();
    if (!name) { showToast('Name is required', true); return; }
    var fields = {
      name: name,
      hourlyRate: parseFloat(document.getElementById('founderRate').value) || null,
      productionHoursPerWeek: parseInt(document.getElementById('founderProd').value) || null,
      adminHoursPerWeek: parseInt(document.getElementById('founderAdmin').value) || null,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editingFounderId) {
        await MastDB.update('admin/lpe/founders/' + editingFounderId, fields);
        showToast('Founder saved');
      } else {
        fields.createdAt = new Date().toISOString();
        var newId = 'founder_' + Date.now();
        await MastDB.set('admin/lpe/founders/' + newId, fields);
        showToast('Founder added');
      }
      editingFounderId = null;
      studioLoaded = false;
      loadStudio();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteFounder(founderId) {
    if (!await mastConfirm('Delete this founder? This cannot be undone.', { title: 'Delete Founder', danger: true })) return;
    try {
      await MastDB.remove('admin/lpe/founders/' + founderId);
      showToast('Founder deleted');
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

    h += '<div id="studioEmpForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="studioEmpFormInner"></div>';
    h += '</div>';

    if (employeesData.length === 0) {
      h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,0.08);color:var(--warm-gray,var(--warm-gray));font-size:0.9rem;">';
      h += 'No team members added. If you have studio help, add them here so the advisor can factor in total labor cost.';
      h += '</div>';
    } else {
      employeesData.forEach(function(emp) {
        // Employee module: payRate in cents, scheduledHoursPerWeek
        var rate = emp.payRate || 0; // cents
        var hours = emp.scheduledHoursPerWeek || 0;
        var monthlyCost = emp.payType === 'salary' ? rate : Math.round(rate * hours * 4.33); // cents/month
        h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        h += '<div><span style="font-weight:600;">' + esc(emp.fullName || emp.name || '') + '</span>';
        if (emp.jobTitle || emp.role) h += ' <span style="font-size:0.85rem;color:var(--warm-gray);">\u2014 ' + esc(emp.jobTitle || emp.role) + '</span>';
        h += '</div>';
        h += '<button class="btn btn-secondary btn-small" data-id="' + esc(emp._key) + '" onclick="studioEditEmployee(this.dataset.id)">Edit</button>';
        h += '</div>';
        h += '<div style="font-size:0.85rem;color:var(--warm-gray,var(--warm-gray));margin-top:4px;">';
        var rateLabel = emp.payType === 'salary' ? '/mo' : '/hr';
        h += (rate > 0 ? fmtDollars(rate) + rateLabel : 'rate not set');
        h += ' \u00B7 ' + (hours > 0 ? hours + ' hrs/week' : 'hours not set');
        h += ' \u00B7 ~' + fmtDollars(Math.round(monthlyCost)) + '/mo';
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

    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (isNew ? 'New Team Member' : 'Edit Team Member') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Name</label>';
    h += '<input id="empName" type="text" value="' + esc(emp.fullName || emp.name || '') + '" placeholder="e.g. Sarah Chen" style="' + INPUT_STYLE + '"></div>';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Job title</label>';
    h += '<input id="empRole" type="text" value="' + esc(emp.jobTitle || emp.role || '') + '" placeholder="e.g. Studio assistant" style="' + INPUT_STYLE + '"></div>';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Hourly rate</label>';
    h += '<input id="empRate" type="number" step="0.01" value="' + (emp.payRate != null ? (emp.payRate / 100).toFixed(2) : '') + '" placeholder="$/hr" style="' + INPUT_STYLE + '"></div>';
    h += '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Hours per week</label>';
    h += '<input id="empHours" type="number" value="' + (emp.scheduledHoursPerWeek != null ? emp.scheduledHoursPerWeek : '') + '" placeholder="hrs/week" style="' + INPUT_STYLE + '"></div>';
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
    var rateDollars = parseFloat(document.getElementById('empRate').value);
    var fields = {
      fullName: name,
      jobTitle: document.getElementById('empRole').value.trim() || null,
      payRate: rateDollars ? Math.round(rateDollars * 100) : null, // store in cents
      scheduledHoursPerWeek: parseInt(document.getElementById('empHours').value) || null,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editingEmployeeId) {
        // Don't overwrite payType on edit — Team module manages it
        await MastDB.update('admin/employees/' + editingEmployeeId, fields);
        showToast('Team member saved');
      } else {
        fields.createdAt = new Date().toISOString();
        fields.payType = 'hourly'; // default for new employees created from studio
        fields.status = 'active';
        var newId = 'emp_' + Date.now();
        await MastDB.set('admin/employees/' + newId, fields);
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
    if (!await mastConfirm('Delete this team member? This cannot be undone.', { title: 'Delete Team Member', danger: true })) return;
    try {
      await MastDB.remove('admin/employees/' + empId);
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

    h += '<div id="studioOhForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="studioOhFormInner"></div>';
    h += '</div>';

    // Direct overhead items
    if (overheadItemsData.length > 0) {
      overheadItemsData.forEach(function(item) {
        h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
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
      h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      h += '<span style="font-weight:600;">From expenses</span>';
      h += '<span style="font-weight:600;">' + fmtDollars(overheadExpenseTotal) + '</span>';
      h += '</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray,var(--warm-gray));margin-top:4px;">' + overheadExpenseCount + ' expense' + (overheadExpenseCount !== 1 ? 's' : '') + ' tagged as studio overhead in <a href="#expenses" onclick="navigateTo(\'expenses\')" style="color:var(--teal,var(--teal));">Expenses</a></div>';
      h += '</div>';
    }

    if (overheadItemsData.length === 0 && overheadExpenseCount === 0) {
      h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,0.08);color:var(--warm-gray,var(--warm-gray));font-size:0.9rem;">';
      h += 'No overhead costs yet. Add recurring costs like rent, mortgage, insurance, or tag expenses in the <a href="#expenses" onclick="navigateTo(\'expenses\')" style="color:var(--teal,var(--teal));">Expenses</a> section.';
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

    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (isNew ? 'New Overhead Cost' : 'Edit Overhead Cost') + '</div>';
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
        await MastDB.update('admin/lpe/overheadItems/' + editingOhItemId, fields);
        showToast('Overhead cost saved');
      } else {
        fields.createdAt = new Date().toISOString();
        var newId = 'oh_' + Date.now();
        await MastDB.set('admin/lpe/overheadItems/' + newId, fields);
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
    if (!await mastConfirm('Delete this overhead cost? This cannot be undone.', { title: 'Delete Overhead Cost', danger: true })) return;
    try {
      await MastDB.remove('admin/lpe/overheadItems/' + itemId);
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
  window.studioAddFounder = function() { openFounderForm(null); };
  window.studioEditFounder = function(id) { openFounderForm(id); };
  window.studioSaveFounder = saveFounder;
  window.studioDeleteFounder = deleteFounder;
  window.studioCancelFounderForm = function() {
    var el = document.getElementById('studioFounderForm');
    if (el) el.style.display = 'none';
    editingFounderId = null;
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
      foundersData = [];
      employeesData = [];
      overheadExpenseTotal = 0;
      overheadExpenseCount = 0;
      overheadItemsData = [];
      studioLoaded = false;
      editingEquipmentId = null;
    }
  });
})();
