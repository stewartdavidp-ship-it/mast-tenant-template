/**
 * studio-v2.js — Studio, V2 (record archetype ×3 lenses, standard-record-ui §10).
 *
 * Twin of legacy studio.js (#studio) — the LPE cost-setup surface: what the
 * studio costs per month before anything is made. One page, three lenses
 * (Equipment / Founders / Overhead) + floor-cost summary tiles. The legacy
 * "Team" section is NOT re-hosted: the employee roster's V2 home is team-v2
 * — the summary keeps a Team-labor tile that links there ("one model, two
 * surfaces"; no second write surface for employees).
 *
 * Native CRUD on all three lenses via window.StudioBridge (state-free cores
 * extracted in studio.js — playbook §4, the twin never re-implements a
 * write): writeEquipment/removeEquipment (incl. the gaps recompute),
 * writeFounder/removeFounder, writeOverhead/removeOverhead.
 *
 * UNIT SEMANTICS (mirror studio.js exactly — they differ per collection):
 *   equipment purchasePrice / monthlyRunningCost → DOLLARS
 *   founder hourlyRate → DOLLARS
 *   overhead monthlyAmount → CENTS
 *
 * Data: admin/lpe/equipment + admin/lpe/founders + admin/lpe/overheadItems
 * (+ read-only roll-ups: admin/employees for the Team-labor tile, expenses
 * tagged isStudioOverhead for the "From expenses" overhead line).
 * Flag-gated (?ui=1) at #studio-v2, side-by-side with legacy #studio.
 */
(function () {
  'use strict';
  function flagOn() {
    try {
      if (/[?&#]ui=1\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;

  var LENSES = [['equipment', 'Equipment'], ['founders', 'Founders'], ['overhead', 'Overhead']];
  var V2 = {
    equipment: [], founders: [], overhead: [], employees: [],
    byId: {}, expenseOverheadCents: 0, expenseOverheadCount: 0,
    lens: 'equipment', sortKey: 'name', sortDir: 'asc', loaded: false
  };

  function canEdit() { return typeof window.can !== 'function' || window.can('studio', 'edit'); }
  function canDelete() { return typeof window.can !== 'function' || window.can('studio', 'delete'); }
  function bridge() { return window.StudioBridge || null; }
  function costs(item) {
    var b = bridge();
    if (b) return b.computeEquipmentCosts(item);
    var own = (item.purchasePrice != null && item.usefulLifeYears > 0) ? item.purchasePrice / item.usefulLifeYears / 12 : null;
    var total = (own != null && item.monthlyRunningCost != null) ? own + item.monthlyRunningCost : null;
    return { monthlyCostToOwn: own, totalMonthlyCost: total,
      costPerUnit: (total != null && item.typicalOutputPerMonth > 0) ? total / item.typicalOutputPerMonth : null };
  }
  function founderMonthly(f) {
    var rate = f.hourlyRate || f.ownerHourlyRate || 0;
    var hrs = (f.productionHoursPerWeek || 0) + (f.adminHoursPerWeek || 0);
    return rate * hrs * 4.33; // dollars/mo
  }
  function teamMonthlyCents() {
    return V2.employees.reduce(function (s, e) {
      if (String(e.status || 'active') !== 'active') return s;
      if (e.payType === 'salary') return s + (e.payRate || 0);
      return s + Math.round((e.payRate || 0) * (e.scheduledHoursPerWeek || 0) * 4.33);
    }, 0);
  }
  function fg(label, inner, hint) {
    return '<div class="form-group"><label class="form-label">' + label + '</label>' +
      (hint ? '<div class="mu-sub" style="margin-bottom:2px;">' + hint + '</div>' : '') + inner + '</div>';
  }
  function num(id) { var v = parseFloat(((document.getElementById(id) || {}).value)); return isFinite(v) ? v : null; }
  function intval(id) { var v = parseInt(((document.getElementById(id) || {}).value), 10); return isFinite(v) ? v : null; }
  function txt(id) { return (((document.getElementById(id) || {}).value) || '').trim(); }
  function dangerBtn(fnName, id) {
    return canDelete()
      ? '<div style="margin-top:14px;"><button class="btn btn-secondary btn-small" style="color:var(--text-danger);" onclick="' + fnName + '(\'' + esc(id) + '\')">Delete</button></div>'
      : '';
  }

  // ── Equipment entity ─────────────────────────────────────────────────
  MastEntity.define('studio-equipment-v2', {
    label: 'Equipment', labelPlural: 'Equipment', size: 'md', route: 'studio-v2',
    recordId: function (r) { return r._key; },
    fields: [
      { name: 'name', label: 'Equipment', type: 'text', list: true, required: true, get: function (r) { return r.name || 'Untitled'; } },
      { name: 'own', label: 'To own', type: 'text', list: true, readOnly: true, align: 'right',
        get: function (r) { var c = costs(r); return c.monthlyCostToOwn == null ? '—' : N.money(c.monthlyCostToOwn) + '/mo'; } },
      { name: 'run', label: 'To run', type: 'text', list: true, readOnly: true, align: 'right',
        get: function (r) { return r.monthlyRunningCost == null ? '—' : N.money(r.monthlyRunningCost) + '/mo'; } },
      { name: 'perUnit', label: 'Per unit', type: 'text', list: true, readOnly: true, align: 'right',
        get: function (r) { var c = costs(r); return c.costPerUnit == null ? '—' : N.money(c.costPerUnit) + '/' + (r.outputUnit || 'unit'); } },
      { name: 'gaps', label: 'Details', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (r) { var g = r.gaps || {}; var n = Object.keys(g).length; return n ? '⚠ ' + n + ' missing' : '✓ complete'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, r) {
        var c = costs(r);
        var tiles = UI.tiles([
          { k: 'Monthly cost', v: c.totalMonthlyCost == null ? 'partial' : N.money(c.totalMonthlyCost), hero: true },
          { k: 'To own', v: c.monthlyCostToOwn == null ? '—' : N.money(c.monthlyCostToOwn) + '/mo' },
          { k: 'To run', v: r.monthlyRunningCost == null ? '—' : N.money(r.monthlyRunningCost) + '/mo' },
          { k: 'Per unit', v: c.costPerUnit == null ? '—' : N.money(c.costPerUnit) + '/' + esc(r.outputUnit || 'unit') }
        ]);
        var kv = UI.card('Equipment', UI.kv([
          { k: 'Purchase price', v: r.purchasePrice == null ? '—' : N.money(r.purchasePrice) },
          { k: 'Useful life', v: r.usefulLifeYears == null ? '—' : r.usefulLifeYears + ' years' },
          { k: 'Monthly output', v: r.typicalOutputPerMonth == null ? '—' : N.count(r.typicalOutputPerMonth) + ' ' + esc(r.outputUnit || 'pieces') + '/mo' }
        ]));
        var gaps = r.gaps && Object.keys(r.gaps).length
          ? UI.card('Missing details', Object.keys(r.gaps).map(function (k) {
              return '<div style="font-size:0.78rem;color:var(--warning);padding:2px 0;">⚠ ' + esc(r.gaps[k].hint || k) + '</div>';
            }).join(''))
          : '';
        return tiles + kv + gaps + dangerBtn('StudioV2.removeEquipment', r._key);
      },
      editRender: function (r, mode) {
        r = r || {};
        var units = ['pieces', 'firings', 'hours'].map(function (u) {
          return '<option value="' + u + '"' + ((r.outputUnit || 'pieces') === u ? ' selected' : '') + '>' + u + '/month</option>';
        }).join('');
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New equipment' : 'Edit equipment') + '</div>' +
          fg('Name *', '<input class="form-input" id="stv2EqName" value="' + esc(r.name || '') + '" style="width:100%;" placeholder="e.g. Large kiln, Torch setup">') +
          fg('Purchase price ($)', '<input class="form-input" type="number" step="0.01" id="stv2EqPrice" value="' + (r.purchasePrice != null ? r.purchasePrice : '') + '" style="width:100%;">') +
          fg('Useful life (years)', '<input class="form-input" type="number" id="stv2EqLife" value="' + (r.usefulLifeYears != null ? r.usefulLifeYears : '') + '" style="width:100%;">') +
          fg('Monthly running cost ($)', '<input class="form-input" type="number" step="0.01" id="stv2EqRun" value="' + (r.monthlyRunningCost != null ? r.monthlyRunningCost : '') + '" style="width:100%;">', 'Electricity, gas, maintenance') +
          fg('Monthly output', '<div style="display:flex;gap:8px;"><input class="form-input" type="number" id="stv2EqOut" value="' + (r.typicalOutputPerMonth != null ? r.typicalOutputPerMonth : '') + '" style="flex:1;">' +
            '<select class="form-input" id="stv2EqUnit" style="width:auto;">' + units + '</select></div>');
      }
    },
    onSave: function (rec, mode) {
      if (!canEdit()) { if (window.showToast) showToast('You don’t have permission to edit studio costs', true); return false; }
      var b = bridge();
      if (!b) { if (window.showToast) showToast('Studio engine still loading — try again', true); return false; }
      var name = txt('stv2EqName');
      if (!name) { if (window.showToast) showToast('Equipment name is required', true); return false; }
      var fields = {
        name: name,
        purchasePrice: num('stv2EqPrice'),
        usefulLifeYears: intval('stv2EqLife'),
        monthlyRunningCost: num('stv2EqRun'),
        typicalOutputPerMonth: intval('stv2EqOut'),
        outputUnit: txt('stv2EqUnit') || 'pieces'
      };
      return Promise.resolve(b.writeEquipment(mode === 'create' ? null : rec._key, fields)).then(function () {
        if (window.writeAudit) writeAudit(mode === 'create' ? 'create' : 'update', 'studio-equipment', rec._key || name);
        if (window.showToast) showToast(mode === 'create' ? 'Equipment created' : 'Equipment saved');
        load(); return true;
      }).catch(function (e) {
        console.error('[studio-v2] equipment save', e);
        if (window.showToast) showToast('Error saving: ' + (e && e.message || e), true);
        return false;
      });
    }
  });

  // ── Founders entity ──────────────────────────────────────────────────
  MastEntity.define('studio-founders-v2', {
    label: 'Founder', labelPlural: 'Founders', size: 'md', route: 'studio-v2',
    recordId: function (r) { return r._key; },
    fields: [
      { name: 'name', label: 'Founder', type: 'text', list: true, required: true, get: function (r) { return r.name || 'Founder'; } },
      { name: 'rate', label: 'Target pay', type: 'text', list: true, readOnly: true, align: 'right',
        get: function (r) { var rate = r.hourlyRate || r.ownerHourlyRate; return rate == null ? '—' : N.money(rate) + '/hr'; } },
      { name: 'making', label: 'Making', type: 'text', list: true, readOnly: true, align: 'right',
        get: function (r) { return r.productionHoursPerWeek == null ? '—' : r.productionHoursPerWeek + ' hrs/wk'; } },
      { name: 'business', label: 'Business', type: 'text', list: true, readOnly: true, align: 'right',
        get: function (r) { return r.adminHoursPerWeek == null ? '—' : r.adminHoursPerWeek + ' hrs/wk'; } },
      { name: 'monthly', label: 'Monthly', type: 'text', list: true, readOnly: true, align: 'right',
        get: function (r) { return '~' + N.money(founderMonthly(r)) + '/mo'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, r) {
        var rate = r.hourlyRate || r.ownerHourlyRate;
        var tiles = UI.tiles([
          { k: 'Monthly value', v: '~' + N.money(founderMonthly(r)), hero: true },
          { k: 'Target pay', v: rate == null ? '—' : N.money(rate) + '/hr' },
          { k: 'Making', v: (r.productionHoursPerWeek || 0) + ' hrs/wk' },
          { k: 'Business', v: (r.adminHoursPerWeek || 0) + ' hrs/wk' }
        ]);
        return tiles + UI.card('About founder pay', '<div class="mu-sub" style="line-height:1.5;">Target pay is what you’d pay a skilled person to do this job — the advisor uses it to price your time into every piece, even if you don’t draw it yet.</div>') +
          dangerBtn('StudioV2.removeFounder', r._key);
      },
      editRender: function (r, mode) {
        r = r || {};
        var rate = r.hourlyRate || r.ownerHourlyRate;
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New founder' : 'Edit founder') + '</div>' +
          fg('Name *', '<input class="form-input" id="stv2FoName" value="' + esc(r.name || '') + '" style="width:100%;">') +
          fg('Target hourly pay ($)', '<input class="form-input" type="number" step="0.01" id="stv2FoRate" value="' + (rate != null ? rate : '') + '" style="width:100%;">', 'What you’d pay a skilled person to do this job') +
          fg('Making hours/week', '<input class="form-input" type="number" id="stv2FoProd" value="' + (r.productionHoursPerWeek != null ? r.productionHoursPerWeek : '') + '" style="width:100%;">', 'At the bench, kiln, or torch') +
          fg('Business hours/week', '<input class="form-input" type="number" id="stv2FoAdmin" value="' + (r.adminHoursPerWeek != null ? r.adminHoursPerWeek : '') + '" style="width:100%;">', 'Packing, photos, emails, markets');
      }
    },
    onSave: function (rec, mode) {
      if (!canEdit()) { if (window.showToast) showToast('You don’t have permission to edit studio costs', true); return false; }
      var b = bridge();
      if (!b) { if (window.showToast) showToast('Studio engine still loading — try again', true); return false; }
      var name = txt('stv2FoName');
      if (!name) { if (window.showToast) showToast('Name is required', true); return false; }
      var fields = {
        name: name,
        hourlyRate: num('stv2FoRate'),
        productionHoursPerWeek: intval('stv2FoProd'),
        adminHoursPerWeek: intval('stv2FoAdmin')
      };
      return Promise.resolve(b.writeFounder(mode === 'create' ? null : rec._key, fields)).then(function () {
        if (window.writeAudit) writeAudit(mode === 'create' ? 'create' : 'update', 'studio-founder', rec._key || name);
        if (window.showToast) showToast(mode === 'create' ? 'Founder added' : 'Founder saved');
        load(); return true;
      }).catch(function (e) {
        console.error('[studio-v2] founder save', e);
        if (window.showToast) showToast('Error saving: ' + (e && e.message || e), true);
        return false;
      });
    }
  });

  // ── Overhead entity (monthlyAmount in CENTS) ─────────────────────────
  MastEntity.define('studio-overhead-v2', {
    label: 'Overhead cost', labelPlural: 'Fixed overhead', size: 'md', route: 'studio-v2',
    recordId: function (r) { return r._key; },
    fields: [
      { name: 'name', label: 'Cost', type: 'text', list: true, required: true, get: function (r) { return r.name || 'Untitled'; } },
      { name: 'amount', label: 'Monthly', type: 'text', list: true, readOnly: true, align: 'right',
        get: function (r) { return r.monthlyAmount == null ? '—' : N.money(r.monthlyAmount, { cents: true }) + '/mo'; } },
      { name: 'notes', label: 'Notes', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (r) { return (r.notes || '').slice(0, 60) || '—'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, r) {
        var tiles = UI.tiles([
          { k: 'Monthly', v: r.monthlyAmount == null ? '—' : N.money(r.monthlyAmount, { cents: true }), hero: true },
          { k: 'Yearly', v: r.monthlyAmount == null ? '—' : N.money(r.monthlyAmount * 12, { cents: true }) },
          { k: 'Added', v: r.createdAt ? String(r.createdAt).slice(0, 10) : '—' },
          { k: 'Updated', v: r.updatedAt ? String(r.updatedAt).slice(0, 10) : '—' }
        ]);
        var notes = r.notes ? UI.card('Notes', '<div style="font-size:0.85rem;color:var(--warm-gray);">' + esc(r.notes) + '</div>') : '';
        return tiles + notes + dangerBtn('StudioV2.removeOverhead', r._key);
      },
      editRender: function (r, mode) {
        r = r || {};
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New overhead cost' : 'Edit overhead cost') + '</div>' +
          fg('Name *', '<input class="form-input" id="stv2OhName" value="' + esc(r.name || '') + '" style="width:100%;" placeholder="e.g. Studio rent, Insurance">') +
          fg('Monthly amount ($)', '<input class="form-input" type="number" step="0.01" id="stv2OhAmount" value="' + (r.monthlyAmount != null ? (r.monthlyAmount / 100).toFixed(2) : '') + '" style="width:100%;">') +
          fg('Notes', '<input class="form-input" id="stv2OhNotes" value="' + esc(r.notes || '') + '" style="width:100%;" placeholder="Optional">');
      }
    },
    onSave: function (rec, mode) {
      if (!canEdit()) { if (window.showToast) showToast('You don’t have permission to edit studio costs', true); return false; }
      var b = bridge();
      if (!b) { if (window.showToast) showToast('Studio engine still loading — try again', true); return false; }
      var name = txt('stv2OhName');
      if (!name) { if (window.showToast) showToast('Name is required', true); return false; }
      var dollars = num('stv2OhAmount');
      var fields = {
        name: name,
        monthlyAmount: dollars != null ? Math.round(dollars * 100) : null,
        notes: txt('stv2OhNotes') || null
      };
      return Promise.resolve(b.writeOverhead(mode === 'create' ? null : rec._key, fields)).then(function () {
        if (window.writeAudit) writeAudit(mode === 'create' ? 'create' : 'update', 'studio-overhead', rec._key || name);
        if (window.showToast) showToast(mode === 'create' ? 'Overhead cost added' : 'Overhead cost saved');
        load(); return true;
      }).catch(function (e) {
        console.error('[studio-v2] overhead save', e);
        if (window.showToast) showToast('Error saving: ' + (e && e.message || e), true);
        return false;
      });
    }
  });

  // ── data ─────────────────────────────────────────────────────────────
  function toRows(tree) {
    var out = [];
    Object.keys(tree || {}).forEach(function (k) {
      var r = tree[k]; if (!r || typeof r !== 'object') return;
      out.push(Object.assign({ _key: k }, r));
    });
    return out;
  }
  function load() {
    Promise.all([
      Promise.resolve(MastDB.lpe && MastDB.lpe.equipment ? MastDB.lpe.equipment.list() : MastDB.get('admin/lpe/equipment')),
      Promise.resolve(MastDB.get('admin/lpe/founders')),
      Promise.resolve(MastDB.get('admin/lpe/overheadItems')),
      Promise.resolve(MastDB.get('admin/employees')),
      MastDB.query('admin/expenses').orderByChild('isStudioOverhead').equalTo(true).limitToLast(200).once('value')
        .catch(function () { return { val: function () { return {}; } }; })
    ]).then(function (res) {
      V2.equipment = toRows(res[0]);
      V2.founders = toRows(res[1]);
      V2.overhead = toRows(res[2]);
      V2.employees = toRows(res[3]);
      V2.byId = {};
      V2.equipment.concat(V2.founders, V2.overhead).forEach(function (r) { V2.byId[r._key] = r; });
      var oh = (res[4] && typeof res[4].val === 'function') ? (res[4].val() || {}) : {};
      var ohList = Object.keys(oh).map(function (k) { return oh[k]; });
      V2.expenseOverheadCents = ohList.reduce(function (s, e) { return s + ((e && e.amount) || 0); }, 0);
      V2.expenseOverheadCount = ohList.length;
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[studio-v2] load', e); V2.loaded = true; render(); });
  }

  function entityFor(lens) {
    return lens === 'founders' ? 'studio-founders-v2' : lens === 'overhead' ? 'studio-overhead-v2' : 'studio-equipment-v2';
  }
  function rowsFor(lens) {
    var rows = lens === 'founders' ? V2.founders : lens === 'overhead' ? V2.overhead : V2.equipment;
    return window.mastSortRows(rows.slice(), V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get(entityFor(lens)).fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function summaryTiles() {
    var equipMonthly = 0, equipPartial = false;
    V2.equipment.forEach(function (r) {
      var c = costs(r);
      if (c.totalMonthlyCost != null) equipMonthly += c.totalMonthlyCost; else equipPartial = true;
    });
    var overheadCents = V2.overhead.reduce(function (s, i) { return s + (i.monthlyAmount || 0); }, 0) + V2.expenseOverheadCents;
    var founderMo = V2.founders.reduce(function (s, f) { return s + founderMonthly(f); }, 0);
    var floor = equipMonthly + overheadCents / 100;
    var complete = V2.equipment.length && !equipPartial && overheadCents > 0;
    var teamCents = teamMonthlyCents();
    return U.tiles([
      { k: 'Studio floor cost', v: complete ? N.money(floor) + '/mo' : (floor > 0 ? '~' + N.money(floor) + '/mo' : '—'), hero: true },
      { k: 'Equipment', v: V2.equipment.length ? N.money(equipMonthly) + (equipPartial ? ' *' : '') + '/mo' : '—' },
      { k: 'Fixed overhead', v: overheadCents > 0 ? N.money(overheadCents, { cents: true }) + '/mo' : '—' },
      { k: 'Founder time', v: founderMo > 0 ? '~' + N.money(founderMo) + '/mo' : '—' },
      { k: 'Team labor', v: teamCents > 0 ? N.money(teamCents, { cents: true }) + '/mo' : '—' }
    ]);
  }

  function ensureTab() {
    var el = document.getElementById('studioV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'studioV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Studio' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>';
      return;
    }
    var lensCounts = { equipment: V2.equipment.length, founders: V2.founders.length, overhead: V2.overhead.length };
    var pills = LENSES.map(function (p) {
      var on = V2.lens === p[0];
      return '<button onclick="StudioV2.setLens(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + ' <span style="color:var(--warm-gray);">' + (lensCounts[p[0]] || 0) + '</span></button>';
    }).join('');

    var addLabel = V2.lens === 'founders' ? '+ New founder' : V2.lens === 'overhead' ? '+ New cost' : '+ New equipment';
    var expensesNote = (V2.lens === 'overhead' && V2.expenseOverheadCount > 0)
      ? '<div class="mu-sub" style="margin:10px 0;">+ ' + N.money(V2.expenseOverheadCents, { cents: true }) + '/mo from ' +
        N.count(V2.expenseOverheadCount) + ' expense' + (V2.expenseOverheadCount === 1 ? '' : 's') + ' tagged as studio overhead in ' +
        '<button type="button" class="mu-link" onclick="navigateTo(\'finance-expenses\')">Expenses</button>.</div>'
      : '';

    tab.innerHTML =
      U.pageHeader({
        title: 'Studio',
        count: 'what your studio costs to run',
        actionsHtml:
          (canEdit() ? '<button class="btn btn-primary" onclick="StudioV2.create()">' + addLabel + '</button>' : '') +
          '<button class="btn btn-secondary" onclick="navigateTo(\'team\')">Manage team ↗</button>'
      }) +
      '<div style="margin:14px 0 10px;">' + summaryTiles() + '</div>' +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      expensesNote +
      MastEntity.renderList(entityFor(V2.lens), {
        rows: rowsFor(V2.lens), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'StudioV2.sort', onRowClickFnName: 'StudioV2.open',
        empty: V2.lens === 'equipment'
          ? { title: 'No equipment yet', message: 'Add your kiln, torch, or other major tools to see what they cost per month.' }
          : V2.lens === 'founders'
            ? { title: 'No founders yet', message: 'Add yourself (and any co-owners) to price your time into your work.' }
            : { title: 'No overhead costs yet', message: 'Add recurring costs like rent, utilities, or insurance.' }
      });
  }

  function removeVia(method, auditEntity, label) {
    return function (id) {
      if (!canDelete()) { if (window.showToast) showToast('You don’t have permission to delete', true); return; }
      var b = bridge();
      if (!b) { if (window.showToast) showToast('Studio engine still loading — try again', true); return; }
      mastConfirm('Delete this ' + label + '? This cannot be undone.', { title: 'Delete ' + label, confirmLabel: 'Delete', danger: true })
        .then(function (ok) {
          if (!ok) return;
          return Promise.resolve(b[method](id)).then(function () {
            if (window.writeAudit) writeAudit('delete', auditEntity, id);
            if (window.showToast) showToast(label.charAt(0).toUpperCase() + label.slice(1) + ' deleted');
            try { U.slideOut.requestCloseForce(); } catch (e) {}
            load();
          });
        })
        .catch(function (e) {
          console.error('[studio-v2] delete', e);
          if (window.showToast) showToast('Delete failed: ' + (e && e.message || e), true);
        });
    };
  }

  window.StudioV2 = {
    setLens: function (l) { V2.lens = l; V2.sortKey = 'name'; V2.sortDir = 'asc'; render(); },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    open: function (id) {
      var rec = V2.byId[id];
      if (rec) MastEntity.openRecord(entityFor(V2.lens), rec, 'read');
    },
    create: function () {
      if (!canEdit()) { if (window.showToast) showToast('You don’t have permission to edit studio costs', true); return; }
      // Legacy module first so StudioBridge exists when onSave fires.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('studio'); } catch (e) {} }
      MastEntity.openRecord(entityFor(V2.lens), {}, 'create');
    },
    removeEquipment: removeVia('removeEquipment', 'studio-equipment', 'equipment'),
    removeFounder: removeVia('removeFounder', 'studio-founder', 'founder'),
    removeOverhead: removeVia('removeOverhead', 'studio-overhead', 'overhead cost')
  };

  MastAdmin.registerModule('studio-v2', {
    routes: { 'studio-v2': { tab: 'studioV2Tab', setup: function () {
      ensureTab();
      // Bridge module first so writes are ready; render doesn't wait on it.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('studio'); } catch (e) {} }
      render(); load();
    } } }
  });
})();
