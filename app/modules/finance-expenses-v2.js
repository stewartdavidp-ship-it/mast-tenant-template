/**
 * finance-expenses-v2.js — conversion #3 of the slide-out backlog (doc 17 §11/§12).
 *
 * Legacy expenses (in finance.js) lists transactions and opens a bespoke
 * fixed-position right-side overlay (`renderFinExpDetailPanel`) for the detail.
 * This re-hosts that surface on the Entity Engine: a MastEntity schema drives
 * the list + the slide-out shell, with custom read/edit interiors (the PR-114
 * detail.render / detail.editRender hooks).
 *
 * Variant (doc 17 §1a test): the doc guessed "likely Process," but the actual
 * model is a `reviewed` BOOLEAN (an Approve action flips it) — an assigned
 * attribute, not a governed multi-phase lifecycle. So → Faceted Record with
 * Approve / Personal / Delete actions (like promotions' End-sale), NOT Process /
 * MastFlow. Flag-gated (`?ui=1`) at #finance-expenses-v2, side-by-side with the
 * legacy #finance-expenses; never touches finance.js.
 *
 * Scope: the per-expense detail surface + per-expense review actions. The
 * list-level bulk-approve / multi-select and the date-period picker stay on the
 * legacy view (the engine list has no row-checkbox control yet). Writes go
 * directly through MastDB.expenses (the same accessor the legacy actions use),
 * plus the best-effort triggerQboPush on approve, mirroring finance.js.
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

  // Option lists mirror finance.js (FIN_EXP_CATEGORIES/BUSINESS_LINES).
  var CATEGORIES = [
    { v: 'materials', l: 'Materials' }, { v: 'booth_fee', l: 'Booth Fee' }, { v: 'shipping_supplies', l: 'Shipping' },
    { v: 'travel', l: 'Travel' }, { v: 'marketing', l: 'Marketing' }, { v: 'equipment', l: 'Equipment' },
    { v: 'software', l: 'Software' }, { v: 'payroll', l: 'Payroll' }, { v: 'taxes', l: 'Taxes' },
    { v: 'other', l: 'Other' }, { v: 'personal', l: 'Personal' }
  ];
  var BUSINESS_LINES = [{ v: '', l: '—' }, { v: 'production', l: 'Production' }, { v: 'sculpture', l: 'Sculpture' }, { v: 'general', l: 'General' }];
  var CAT_LABEL = {}; CATEGORIES.forEach(function (c) { CAT_LABEL[c.v] = c.l; });
  var BL_LABEL = {}; BUSINESS_LINES.forEach(function (b) { BL_LABEL[b.v] = b.l; });

  function catLabel(v) { return CAT_LABEL[v] || (v ? String(v).replace(/_/g, ' ') : 'Other'); }
  function dollars(cents) { return (Number(cents) || 0) / 100; }
  function sourceLabel(ex) { return ex.source === 'plaid' ? 'Plaid' : ex.source === 'csv_import' ? 'CSV Import' : 'Manual'; }
  function merchantOf(ex) { return ex.merchantName || ex.description || 'Expense'; }

  // ── schema (Faceted Record) ─────────────────────────────────────────
  MastEntity.define('finance-expenses-v2', {
    label: 'Expense', labelPlural: 'Expenses', size: 'lg',
    route: 'finance-expenses-v2',
    recordId: function (e) { return e._id || e.id; },
    // fields[0] (merchant) + status are read DIRECTLY by the engine (title +
    // header badge, no get()), so both are materialized onto each row in load().
    fields: [
      { name: 'merchant', label: 'Merchant', type: 'text', list: true, readOnly: true, group: 'Expense' },
      { name: 'date', label: 'Date', type: 'date', list: true, readOnly: true, get: function (e) { return e.date || null; } },
      { name: 'category', label: 'Category', type: 'text', list: true, readOnly: true, get: function (e) { return catLabel(e.category); } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['approved', 'review'],
        tone: function (v) { return v === 'approved' ? 'success' : 'amber'; } },
      { name: 'amount', label: 'Amount', type: 'money', list: true, readOnly: true, get: function (e) { return dollars(e.amount); } }
    ],
    fetch: function (id) {
      var ex = V2.byId[id];
      return Promise.resolve(ex || (MastDB.expenses.get(id).then(function (e) { return e ? decorate(Object.assign({ _id: id }, e)) : null; })));
    },
    detail: {
      render: function (UI, ex) {
        var amt = dollars(ex.amount);
        var tiles = UI.tiles([
          { k: 'Amount', v: N.money(amt) || '$0.00', hero: true },
          { k: 'Date', v: ex.date ? N.date(ex.date) : '—' },
          { k: 'Category', v: esc(catLabel(ex.category)) },
          { k: 'Source', v: esc(sourceLabel(ex)) }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }, { key: 'source', label: 'Source' }], 'ov');

        var details = UI.kv([
          { k: 'Merchant', v: esc(merchantOf(ex)) },
          { k: 'Description', v: ex.description ? esc(ex.description) : '—' },
          { k: 'Category', v: esc(catLabel(ex.category)) },
          { k: 'Business line', v: esc(BL_LABEL[ex.businessLine || ''] || '—') },
          { k: 'Studio overhead', v: ex.isStudioOverhead ? 'Yes' : 'No' },
          { k: 'Notes', v: ex.notes ? esc(ex.notes) : '—' }
        ]);
        var id = ex._id || ex.id;
        var actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">' +
          (!ex.reviewed
            ? '<button class="btn btn-primary" onclick="FinExpV2.approve(\'' + esc(id) + '\')">Approve</button>' +
              '<button class="btn btn-secondary" onclick="FinExpV2.personal(\'' + esc(id) + '\')">Personal</button>'
            : '<span class="mu-sub" style="align-self:center;">✓ Approved</span>') +
          '<span style="flex:1;"></span>' +
          '<button class="btn btn-danger" onclick="FinExpV2.del(\'' + esc(id) + '\')">Delete</button>' +
          '</div>';

        var src = UI.kv([
          { k: 'Source', v: esc(sourceLabel(ex)) },
          { k: 'Plaid category', v: ex.plaidCategory ? esc(ex.plaidCategory) : '—' },
          { k: 'Confidence', v: (ex.categoryConfidence != null) ? (Math.round(ex.categoryConfidence * 100) + '%') : '—' },
          { k: 'Txn ID', v: ex.sourceTransactionId ? esc(ex.sourceTransactionId) : '—' },
          { k: 'Created', v: ex.createdAt ? N.date(ex.createdAt) : '—' },
          { k: 'Updated', v: ex.updatedAt ? N.date(ex.updatedAt) : '—' }
        ]);

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Details', details + actions) + '</div>' +
          '<div class="mu-pane" data-pane="source" hidden>' + UI.card('Source details', src) + '</div>';
      },
      editRender: function (ex, mode) {
        var catOpts = CATEGORIES.map(function (c) { return '<option value="' + esc(c.v) + '"' + (ex && ex.category === c.v ? ' selected' : '') + '>' + esc(c.l) + '</option>'; }).join('');
        var blOpts = BUSINESS_LINES.map(function (b) { return '<option value="' + esc(b.v) + '"' + (ex && (ex.businessLine || '') === b.v ? ' selected' : '') + '>' + esc(b.l) + '</option>'; }).join('');
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Categorize this expense</div>' +
          '<div style="font-size:0.85rem;color:var(--warm-gray);margin:-4px 0 14px;">' + esc(merchantOf(ex)) + ' · ' + (N.money(dollars(ex.amount)) || '$0.00') + ' · ' + esc(ex.date || '') + '</div>' +
          '<div class="form-group"><label class="form-label">Category</label>' +
            '<select class="form-input" id="fexpV2Category" style="width:100%;">' + catOpts + '</select></div>' +
          '<div class="form-group"><label class="form-label">Business line</label>' +
            '<select class="form-input" id="fexpV2BusinessLine" style="width:100%;">' + blOpts + '</select></div>' +
          '<div class="form-group"><label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:0.9rem;">' +
            '<input type="checkbox" id="fexpV2Overhead"' + (ex && ex.isStudioOverhead ? ' checked' : '') + ' style="margin-top:2px;">' +
            '<span>Fixed studio overhead<br><span style="color:var(--warm-gray);font-size:0.78rem;">Recurring costs to keep your studio running (rent, insurance, subscriptions).</span></span></label></div>' +
          '<div class="form-group"><label class="form-label">Notes</label>' +
            '<textarea class="form-input" id="fexpV2Notes" rows="3" style="width:100%;resize:vertical;">' + esc(ex && ex.notes || '') + '</textarea></div>';
      }
    },
    onSave: function (rec) {
      var id = rec._id || rec.id;
      if (!id) return false;
      var category = (document.getElementById('fexpV2Category') || {}).value;
      var businessLine = (document.getElementById('fexpV2BusinessLine') || {}).value;
      var overhead = !!(document.getElementById('fexpV2Overhead') || {}).checked;
      var notes = (document.getElementById('fexpV2Notes') || {}).value || '';
      var updates = {
        category: category,
        businessLine: businessLine || null,
        isStudioOverhead: overhead,
        notes: notes,
        updatedAt: new Date().toISOString()
      };
      // Mirror finance.js: a user category edit stamps categorySource='user'.
      if (rec.category !== category) updates.categorySource = 'user';
      return Promise.resolve(MastDB.expenses.update(id, updates)).then(function () {
        if (window.writeAudit) writeAudit('update', 'expense', id);
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave.
        Object.assign(V2.byId[id] || rec, updates);
        if (window.showToast) showToast('Expense updated');
        return true;
      }).catch(function (e) { console.error('[finance-expenses-v2] save', e); if (window.showToast) showToast('Update failed', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'date', sortDir: 'desc', q: '' };

  // Materialize the direct-read fields (title + status badge) + keep raw.
  function decorate(ex) {
    ex.merchant = merchantOf(ex);
    ex.status = ex.reviewed ? 'approved' : 'review';
    return ex;
  }

  function load() {
    // Simplest proven read on admin/expenses (verified on sgtest15): limit only,
    // sort client-side. Excludes category 'personal' to match the legacy view.
    Promise.resolve(MastDB.expenses.list({ limit: 500 })).then(function (snap) {
      var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var ex = val[k]; if (ex && typeof ex === 'object' && ex.category !== 'personal') out.push(decorate(Object.assign({ _id: k }, ex)));
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._id] = r; });
      render();
    }).catch(function (e) { console.error('[finance-expenses-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.range) {
      rows = rows.filter(function (r) {
        var d = String(r.date || '').slice(0, 10);
        return d >= V2.range.start && d <= V2.range.end;
      });
    }
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (r) {
        return merchantOf(r).toLowerCase().indexOf(q) >= 0 ||
               catLabel(r.category).toLowerCase().indexOf(q) >= 0 ||
               String(r.description || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('finance-expenses-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('financeExpensesV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'financeExpensesV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function summary(rows) {
    var total = 0, unreviewed = 0;
    rows.forEach(function (ex) { total += dollars(ex.amount); if (!ex.reviewed) unreviewed++; });
    return { total: total, count: rows.length, unreviewed: unreviewed };
  }

  function tile(value, label) {
    return '<div style="background:var(--cream);border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">' +
      '<div style="font-size:1.6rem;font-weight:700;color:var(--text-primary);">' + value + '</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(label) + '</div></div>';
  }

  function render() {
    var tab = ensureTab();
    var rows = visibleRows();
    var s = summary(V2.range ? rows : V2.rows);
    var periodPills = [['all', 'All'], ['mtd', 'MTD'], ['qtd', 'QTD'], ['fy', 'FYTD']].map(function (md) {
      var on = (V2.period || 'all') === md[0];
      return '<button onclick="FinExpV2.setPeriod(\'' + md[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 16%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:4px 11px;font-size:0.78rem;cursor:pointer;margin-right:6px;">' + md[1] + '</button>';
    }).join('');
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Expenses</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(V2.rows.length) + ' transactions</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="FinExpV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="display:flex;gap:12px;margin:12px 0;flex-wrap:wrap;">' +
        tile(N.money(s.total) || '$0.00', 'Total') + tile(N.count(s.count), 'Transactions') + tile(N.count(s.unreviewed), 'Need review') +
      '</div>' +
      '<div style="margin:0 0 10px;">' + periodPills + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search merchant, category, description…" value="' + esc(V2.q) +
        '" oninput="FinExpV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('finance-expenses-v2', {
        rows: rows, sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'FinExpV2.sort', onRowClickFnName: 'FinExpV2.open',
        empty: { title: 'No expenses', message: 'Expenses (excluding personal) will appear here.' }
      });
  }

  // Best-effort QBO push on approve (mirrors finance.js _firTriggerQboPush;
  // gated on source ∈ {plaid, manual}). Downstream-of-record — never blocks.
  function qboPush(ex) {
    try {
      if (!ex || (ex.source !== 'plaid' && ex.source !== 'manual')) return;
      if (window.firebase && firebase.functions && MastDB.tenantId) {
        firebase.functions().httpsCallable('triggerQboPush')({ tid: MastDB.tenantId(), entityType: 'expense', mastId: ex._id || ex.id })
          .catch(function (e) { console.warn('[finance-expenses-v2] qbo push (best-effort)', e && e.message); });
      }
    } catch (e) {}
  }

  function afterWrite() { U.slideOut.requestCloseForce(); load(); }

  window.FinExpV2 = {
    // Wave 4: period window via the shared finance period resolver (no local
    // date math — FinanceBridge owns period semantics).
    setPeriod: function (mode) {
      if (mode === 'all') { V2.period = 'all'; V2.range = null; render(); return; }
      MastAdmin.loadModule('finance').then(function () {
        V2.period = mode;
        V2.range = window.FinanceBridge.resolvePeriod({ mode: mode });
        render();
      }).catch(function (e) { console.error('[finance-expenses-v2] period', e); });
    },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'date' || key === 'amount' ? 'desc' : 'asc'); }
      render();
    },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('finance-expenses-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('finance-expenses-v2', rec, 'read');
      });
    },
    approve: function (id) {
      var ex = V2.byId[id];
      Promise.resolve(MastDB.expenses.update(id, { reviewed: true, updatedAt: new Date().toISOString() })).then(function () {
        if (window.writeAudit) writeAudit('update', 'expense', id);
        qboPush(ex);
        if (window.showToast) showToast('Expense approved');
        afterWrite();
      }).catch(function (e) { console.error('[finance-expenses-v2] approve', e); if (window.showToast) showToast('Approve failed', true); });
    },
    personal: function (id) {
      Promise.resolve(MastDB.expenses.update(id, { category: 'personal', categorySource: 'user', reviewed: true, updatedAt: new Date().toISOString() })).then(function () {
        if (window.writeAudit) writeAudit('update', 'expense', id);
        if (window.showToast) showToast('Marked as personal');
        afterWrite();
      }).catch(function (e) { console.error('[finance-expenses-v2] personal', e); if (window.showToast) showToast('Failed', true); });
    },
    del: function (id) {
      var ex = V2.byId[id];
      var msg = 'Delete this expense (' + merchantOf(ex || {}) + ')? This cannot be undone.';
      (typeof mastConfirm === 'function' ? mastConfirm(msg, { title: 'Delete expense', confirmLabel: 'Delete', danger: true }) : Promise.resolve(true))
        .then(function (ok) {
          if (!ok) return;
          Promise.resolve(MastDB.expenses.remove(id)).then(function () {
            if (window.writeAudit) writeAudit('delete', 'expense', id);
            if (window.showToast) showToast('Expense deleted');
            afterWrite();
          }).catch(function (e) { console.error('[finance-expenses-v2] delete', e); if (window.showToast) showToast('Delete failed', true); });
        });
    },
    exportCsv: function () { return MastEntity.exportRows('finance-expenses-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('finance-expenses-v2', {
    routes: { 'finance-expenses-v2': { tab: 'financeExpensesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
