/**
 * customers-v2.js — PROOF module #2 (Phase 1). The Customers screen as a
 * MastEntity schema, exercising the read→edit paradigm at the `md` tier
 * (vs orders-v2's `lg`/expand). Flag-gated (`uiRedesign`), self-mounting on the
 * side-by-side route `#customers-v2`. Same engine, different record — proves the
 * schema model generalizes. Verify on a dev pod (both modes, edit→dirty→save).
 */
(function () {
  'use strict';
  function flagOn() {
    try { if (localStorage.getItem('mastUiRedesign') === '1') return true; } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity) return;
  if (!flagOn()) return;

  var STATUS_TONE = { active: 'success', lapsed: 'danger', lead: 'info', vip: 'amber' };
  MastEntity.define('customers-v2', {
    label: 'Customer', labelPlural: 'Customers', size: 'md',
    recordId: function (c) { return c._key || c.id; },
    fields: [
      { name: 'displayName', label: 'Name', type: 'text', list: true, required: true, group: 'Identity' },
      { name: 'primaryEmail', label: 'Primary email', type: 'text', list: true, group: 'Identity' },
      { name: 'source', label: 'Source', type: 'text', list: true, group: 'Identity', readOnly: true,
        tone: function () { return 'teal'; } },
      { name: 'orderCount', label: 'Orders', type: 'number', list: true, group: 'Activity',
        get: function (c) { return c.orderCount != null ? c.orderCount : (Array.isArray(c.orders) ? c.orders.length : 0); } },
      { name: 'totalSpend', label: 'Spend', type: 'money', list: true, group: 'Activity',
        get: function (c) { return c.totalSpend != null ? c.totalSpend : (c.spend != null ? c.spend : c.lifetimeValue); } },
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Activity',
        tone: function (v) { return STATUS_TONE[String(v || '').toLowerCase()] || 'neutral'; } },
      { name: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
      { name: 'createdAt', label: 'Created', type: 'date', group: 'Identity', readOnly: true }
    ],
    onSave: function (rec) {
      var id = rec._key || rec.id;
      if (!id || !window.MastDB || !MastDB.update) return true;
      // Edit persists operator-editable identity/contact fields only.
      return MastDB.update('admin/customers/' + id, { displayName: rec.displayName, phone: rec.phone })
        .then(function () { return true; });
    }
  });

  var V2 = { rows: [], byId: {}, sortKey: 'displayName', sortDir: 'asc', off: null, q: '' };

  function toRows(tree) {
    var out = []; tree = tree || {};
    Object.keys(tree).forEach(function (k) { var c = tree[k]; if (c && typeof c === 'object') out.push(Object.assign({ _key: k }, c)); });
    return out;
  }
  function load() {
    var c = window.MastDB && MastDB.customers;
    var apply = function (tree) {
      V2.rows = toRows(tree); V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; }); render();
    };
    // Prefer the customers entity accessor; fall back to the raw path.
    if (c && typeof c.list === 'function') {
      Promise.resolve(c.list()).then(apply).catch(function (e) { console.error('[customers-v2] list', e); });
      if (typeof c.listen === 'function') { try { V2.off = c.listen(apply); } catch (e) {} }
    } else if (window.MastDB && MastDB.list) {
      MastDB.list('admin/customers').then(apply).catch(function (e) { console.error('[customers-v2] list', e); });
    }
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (r) {
        return String(r.displayName || '').toLowerCase().indexOf(q) >= 0 ||
               String(r.primaryEmail || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('customers-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('customersV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'customersV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Customers</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + window.MastUI.Num.count(V2.rows.length) + ' total</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="CustomersV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name or email…" value="' +
        (window.MastUI._esc(V2.q)) + '" oninput="CustomersV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      window.MastEntity.renderList('customers-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CustomersV2.sort', onRowClickFnName: 'CustomersV2.open',
        empty: { title: 'No customers match', message: 'Try a different search.' }
      });
  }

  window.CustomersV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) { var rec = V2.byId[id]; if (rec) window.MastEntity.openRecord('customers-v2', rec, 'read'); },
    exportCsv: function () { return window.MastEntity.exportRows('customers-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('customers-v2', {
    routes: { 'customers-v2': { tab: 'customersV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
