(function() {
  'use strict';

  var equipmentData = [];
  var laborData = null;
  var overheadTotal = 0;
  var overheadCount = 0;
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

  // --- Load ---
  async function loadStudio() {
    var container = document.getElementById('studioTab');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--warm-gray);">Loading studio costs\u2026</div>';

    try {
      var [equipSnap, laborSnap, expSnap] = await Promise.all([
        MastDB.lpe.equipment.list(),
        MastDB.lpe.laborProfile.get(),
        MastDB._ref('admin/expenses').orderByChild('isStudioOverhead').equalTo(true).limitToLast(200).once('value'),
      ]);

      var eqVal = equipSnap.val() || {};
      equipmentData = Object.entries(eqVal).map(function(entry) {
        var item = entry[1];
        item._key = entry[0];
        return item;
      });

      laborData = laborSnap.val() || {};
      var ohVal = expSnap.val() || {};
      var ohList = Object.values(ohVal);
      overheadTotal = ohList.reduce(function(sum, e) { return sum + (e.amount || 0); }, 0);
      overheadCount = ohList.length;

      studioLoaded = true;
      renderStudio(container);
    } catch (err) {
      console.error('Error loading studio:', err);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger,#ef4444);">Error loading studio data.</div>';
    }
  }

  // --- Main Render ---
  function renderStudio(container) {
    var h = '';
    h += '<div class="section-header"><h2>Studio Cost Setup</h2></div>';
    h += renderSummaryCard();
    h += renderEquipmentSection();
    h += renderLaborSection();
    h += renderOverheadInfo();
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
    var hasOverhead = overheadCount > 0;
    var hasLabor = laborData && laborData.ownerHourlyRate != null;
    var isEmpty = !hasEquip && !hasOverhead && !hasLabor;

    var h = '<div style="background:var(--bg-secondary,var(--cream,#FAF6F0));border:1px solid var(--cream-dark,#F0E8DB);border-radius:10px;padding:20px 24px;margin-bottom:24px;">';
    h += '<div style="font-size:1rem;font-weight:700;margin-bottom:12px;">Your studio costs to run</div>';

    if (isEmpty) {
      h += '<div style="font-size:0.9rem;color:var(--warm-gray,#6B6560);">';
      h += 'Add your equipment and expenses below to see what your studio costs per month before you make anything.';
      h += '</div>';
    } else {
      h += '<div style="display:flex;flex-direction:column;gap:6px;font-size:0.9rem;">';

      // Equipment monthly
      h += '<div style="display:flex;justify-content:space-between;">';
      h += '<span>Equipment (monthly)</span>';
      if (hasEquip) {
        h += '<span style="font-weight:600;">' + fmtDollarsWhole(totalEquipMonthly) + (equipPartial ? ' *' : '') + '</span>';
      } else {
        h += '<span style="color:var(--warm-gray-light,#9B958E);">not set</span>';
      }
      h += '</div>';

      // Fixed overhead
      h += '<div style="display:flex;justify-content:space-between;">';
      h += '<span>Fixed overhead</span>';
      if (hasOverhead) {
        h += '<span style="font-weight:600;">' + fmtDollars(overheadTotal) + '</span>';
      } else {
        h += '<span style="color:var(--warm-gray-light,#9B958E);">not set</span>';
      }
      h += '</div>';

      h += '<hr style="border:none;border-top:1px solid var(--cream-dark,#ddd);margin:4px 0;">';

      // Studio floor cost
      var floorCost = totalEquipMonthly + (overheadTotal / 100);
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
    h += '<h3 style="margin:0;font-size:1rem;">Your Equipment</h3>';
    h += '<button class="btn btn-primary" style="font-size:0.82rem;padding:6px 16px;" onclick="studioAddEquipment()">+ Add equipment</button>';
    h += '</div>';

    // Add/edit form (hidden by default)
    h += '<div id="studioEquipForm" style="display:none;background:var(--bg-secondary,var(--cream,#FAF6F0));border:1px solid var(--cream-dark,#F0E8DB);border-radius:10px;padding:16px 20px;margin-bottom:12px;">';
    h += '<div id="studioEquipFormInner"></div>';
    h += '</div>';

    if (equipmentData.length === 0) {
      h += '<div style="text-align:center;padding:24px;color:var(--warm-gray,#6B6560);font-size:0.9rem;">No equipment added yet. Add your kiln, torch, or other major tools.</div>';
    } else {
      equipmentData.forEach(function(item) {
        var costs = computeEquipmentCosts(item);
        var gaps = item.gaps || {};
        var hasGaps = Object.keys(gaps).length > 0;
        var hasHighGap = Object.values(gaps).some(function(g) { return g.priority === 'high'; });

        h += '<div style="background:var(--bg-secondary,var(--cream,#FAF6F0));border:1px solid var(--cream-dark,#F0E8DB);border-radius:10px;padding:14px 18px;margin-bottom:8px;">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        h += '<div style="font-weight:600;font-size:0.95rem;">' + esc(item.name || 'Untitled');
        if (hasHighGap) h += ' <span title="Some details missing" style="color:#d97706;cursor:help;">\u26A0</span>';
        h += '</div>';
        h += '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="studioEditEquipment(\'' + esc(item._key) + '\')">Edit</button>';
        h += '</div>';

        // Cost summary line
        var parts = [];
        if (costs.monthlyCostToOwn != null) parts.push(fmtDollarsWhole(costs.monthlyCostToOwn) + '/mo to own');
        else if (item.purchasePrice != null) parts.push('purchase price on file');
        if (item.monthlyRunningCost != null) parts.push(fmtDollarsWhole(item.monthlyRunningCost) + '/mo to run');
        else parts.push('running cost not on file');
        if (costs.costPerUnit != null) parts.push(fmtDollarsWhole(costs.costPerUnit) + '/' + esc(item.outputUnit || 'unit'));

        h += '<div style="font-size:0.82rem;color:var(--warm-gray,#6B6560);margin-top:4px;">' + parts.join(' \u00B7 ') + '</div>';

        // Gap hints (if any)
        if (hasGaps) {
          h += '<div style="margin-top:6px;">';
          Object.entries(gaps).forEach(function(entry) {
            var field = entry[0];
            var gap = entry[1];
            h += '<div style="font-size:0.75rem;color:#d97706;padding:1px 0;">\u26A0 ' + esc(gap.hint || field) + '</div>';
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

    var h = '<div style="font-weight:600;font-size:0.95rem;margin-bottom:12px;">' + (isNew ? 'Add Equipment' : 'Edit Equipment') + '</div>';

    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    h += '<div style="grid-column:1/-1;">';
    h += '<label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">What do you call this?</label>';
    h += '<input id="eqName" type="text" value="' + esc(item.name || '') + '" placeholder="e.g. Large kiln, Torch setup" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">What did it cost?</label>';
    h += '<input id="eqPrice" type="number" step="0.01" value="' + (item.purchasePrice != null ? item.purchasePrice : '') + '" placeholder="$" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">How many years will it last?</label>';
    h += '<input id="eqLife" type="number" value="' + (item.usefulLifeYears != null ? item.usefulLifeYears : '') + '" placeholder="years" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">Monthly running cost?</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,#6B6560);margin-bottom:2px;">Electricity, gas, maintenance</div>';
    h += '<input id="eqRunCost" type="number" step="0.01" value="' + (item.monthlyRunningCost != null ? item.monthlyRunningCost : '') + '" placeholder="$/month" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">Monthly output?</label>';
    h += '<input id="eqOutput" type="number" value="' + (item.typicalOutputPerMonth != null ? item.typicalOutputPerMonth : '') + '" placeholder="quantity" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">Output unit</label>';
    h += '<select id="eqUnit" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;">';
    ['pieces', 'firings', 'hours'].forEach(function(u) {
      h += '<option value="' + u + '"' + ((item.outputUnit || 'pieces') === u ? ' selected' : '') + '>' + u + '</option>';
    });
    h += '</select>';
    h += '</div>';

    h += '</div>'; // end grid

    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';
    h += '<button class="btn btn-primary" style="font-size:0.85rem;padding:8px 20px;" onclick="studioSaveEquipment()">Save equipment</button>';
    h += '<button class="btn btn-secondary" style="font-size:0.85rem;padding:8px 16px;" onclick="studioCancelEquipForm()">Cancel</button>';
    if (!isNew) {
      h += '<span style="margin-left:auto;"><a href="#" onclick="event.preventDefault();studioDeleteEquipment(\'' + esc(equipId) + '\')" style="font-size:0.8rem;color:var(--danger,#DC3545);">Remove this item</a></span>';
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
        // Update gaps
        var gaps = computeLocalGaps(fields);
        await MastDB.lpe.equipment.ref(editingEquipmentId).child('gaps').set(gaps);
        showToast('Equipment updated');
      } else {
        var newId = 'equip_' + Date.now();
        fields.createdAt = new Date().toISOString();
        await MastDB.lpe.equipment.set(newId, fields);
        var gaps = computeLocalGaps(fields);
        await MastDB.lpe.equipment.ref(newId).child('gaps').set(gaps);
        showToast('Equipment added');
      }
      editingEquipmentId = null;
      studioLoaded = false;
      loadStudio();
    } catch (err) {
      showToast('Error saving: ' + err.message, true);
    }
  }

  async function deleteEquipment(equipId) {
    if (!confirm('Remove this equipment?')) return;
    try {
      await MastDB.lpe.equipment.remove(equipId);
      showToast('Equipment removed');
      studioLoaded = false;
      loadStudio();
    } catch (err) {
      showToast('Error: ' + err.message, true);
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
    h += '<h3 style="margin:0;font-size:1rem;">Your time & pay</h3>';
    h += '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="studioEditLabor()">Edit</button>';
    h += '</div>';

    // Edit form (hidden)
    h += '<div id="studioLaborForm" style="display:none;background:var(--bg-secondary,var(--cream,#FAF6F0));border:1px solid var(--cream-dark,#F0E8DB);border-radius:10px;padding:16px 20px;margin-bottom:12px;">';
    h += '<div id="studioLaborFormInner"></div>';
    h += '</div>';

    // Display
    h += '<div id="studioLaborDisplay" style="background:var(--bg-secondary,var(--cream,#FAF6F0));border:1px solid var(--cream-dark,#F0E8DB);border-radius:10px;padding:14px 18px;">';
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
        h += '<hr style="border:none;border-top:1px solid var(--cream-dark,#ddd);margin:2px 0;">';
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
    h += '<label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">Target hourly pay</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,#6B6560);margin-bottom:2px;">What you\'d pay a skilled person to do your job</div>';
    h += '<input id="laborRate" type="number" step="0.01" value="' + (d.ownerHourlyRate != null ? d.ownerHourlyRate : '') + '" placeholder="$/hr" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">Making hours/week</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,#6B6560);margin-bottom:2px;">At the bench, kiln, or torch</div>';
    h += '<input id="laborProd" type="number" value="' + (d.productionHoursPerWeek != null ? d.productionHoursPerWeek : '') + '" placeholder="hrs" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;">';
    h += '</div>';

    h += '<div>';
    h += '<label style="font-size:0.82rem;font-weight:600;display:block;margin-bottom:4px;">Business tasks/week</label>';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,#6B6560);margin-bottom:2px;">Packing, photos, emails, markets</div>';
    h += '<input id="laborAdmin" type="number" value="' + (d.adminHoursPerWeek != null ? d.adminHoursPerWeek : '') + '" placeholder="hrs" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;">';
    h += '</div>';

    h += '</div>';

    h += '<div style="display:flex;gap:8px;margin-top:14px;">';
    h += '<button class="btn btn-primary" style="font-size:0.85rem;padding:8px 20px;" onclick="studioSaveLabor()">Save</button>';
    h += '<button class="btn btn-secondary" style="font-size:0.85rem;padding:8px 16px;" onclick="studioCancelLaborForm()">Cancel</button>';
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
      // Persist gaps
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
      showToast('Error: ' + err.message, true);
    }
  }

  // --- Surface 4: Overhead Info ---
  function renderOverheadInfo() {
    var h = '<div style="margin-bottom:28px;">';
    h += '<h3 style="font-size:1rem;margin-bottom:8px;">Fixed overhead</h3>';
    h += '<div style="background:var(--bg-secondary,var(--cream,#FAF6F0));border:1px solid var(--cream-dark,#F0E8DB);border-radius:10px;padding:14px 18px;font-size:0.9rem;">';
    if (overheadCount > 0) {
      h += '<div style="display:flex;justify-content:space-between;font-weight:600;">';
      h += '<span>' + overheadCount + ' expense' + (overheadCount !== 1 ? 's' : '') + ' tagged as studio overhead</span>';
      h += '<span>' + fmtDollars(overheadTotal) + '</span>';
      h += '</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray,#6B6560);margin-top:4px;">Tag recurring expenses (rent, insurance, subscriptions) in the <a href="#expenses" onclick="navigateTo(\'expenses\')" style="color:var(--teal,#2A7C6F);">Expenses</a> section.</div>';
    } else {
      h += '<div style="color:var(--warm-gray,#6B6560);">';
      h += 'No expenses tagged as studio overhead yet. Go to <a href="#expenses" onclick="navigateTo(\'expenses\')" style="color:var(--teal,#2A7C6F);">Expenses</a> and toggle "Fixed studio overhead" on recurring costs like rent, insurance, and subscriptions.';
      h += '</div>';
    }
    h += '</div></div>';
    return h;
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

  // Register module
  MastDB && MastAdmin.registerModule('studio', {
    routes: {
      'studio': {
        tab: 'studioTab',
        setup: function() { if (!studioLoaded) loadStudio(); }
      }
    },
    detachListeners: function() {
      equipmentData = [];
      laborData = null;
      overheadTotal = 0;
      overheadCount = 0;
      studioLoaded = false;
      editingEquipmentId = null;
    }
  });
})();
