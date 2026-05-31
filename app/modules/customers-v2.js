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
    try {
      if (/[?&#]ui=1\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity) return;
  if (!flagOn()) return;

  var STATUS_TONE = { active: 'success', lapsed: 'danger', lead: 'info', vip: 'amber' };
  // Customer stats live under `stats.*` (nested), but some records also carry
  // flattened "stats.x" keys — read nested first, fall back to dotted (doc 17).
  function stat(c, k) { return (c && c.stats && c.stats[k] != null) ? c.stats[k] : (c ? c['stats.' + k] : undefined); }
  MastEntity.define('customers-v2', {
    label: 'Customer', labelPlural: 'Customers', size: 'md',
    recordId: function (c) { return c._key || c.id; },
    fields: [
      { name: 'displayName', label: 'Name', type: 'text', list: true, required: true, group: 'Identity' },
      { name: 'primaryEmail', label: 'Primary email', type: 'text', list: true, group: 'Identity' },
      { name: 'source', label: 'Source', type: 'text', list: true, group: 'Identity', readOnly: true,
        tone: function () { return 'teal'; } },
      { name: 'orderCount', label: 'Orders', type: 'number', list: true, group: 'Activity',
        get: function (c) { return stat(c, 'orderCount') || 0; } },
      { name: 'totalSpend', label: 'Spend', type: 'money', list: true, group: 'Activity',
        get: function (c) { return (stat(c, 'lifetimeSpendCents') || 0) / 100; } },
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Activity',
        options: ['active', 'lapsed', 'lead', 'vip'],
        tone: function (v) { return STATUS_TONE[String(v || '').toLowerCase()] || 'neutral'; } },
      { name: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
      { name: 'createdAt', label: 'Created', type: 'date', group: 'Identity', readOnly: true }
    ],
    // Drill target + restorer source; fetch loads the customer + linked-contact
    // location + recent orders so the Party detail has real data.
    route: 'customers-v2',
    fetch: function (id) {
      return MastDB.get('admin/customers/' + id).then(function (c) {
        if (!c) return null;
        c = Object.assign({ _key: id }, c);
        var jobs = [];
        if (MastDB.orders && MastDB.orders.list) {
          jobs.push(Promise.resolve(MastDB.orders.list()).then(function (m) {
            var arr = [];
            // Match on customerId ONLY — never email. Real customers can share
            // an email (the Duplicates tab merges them); an email match would
            // leak one customer's orders onto another's detail panel.
            Object.keys(m || {}).forEach(function (k) { var o = m[k]; if (o && o.customerId === id) arr.push(Object.assign({ _key: k }, o)); });
            arr.sort(function (a, b) { return String(b.placedAt || '').localeCompare(String(a.placedAt || '')); });
            c._recentOrders = arr.slice(0, 8);
          }).catch(function () {}));
        }
        var cid = c.linkedIds && c.linkedIds.contactIds && c.linkedIds.contactIds[0];
        if (cid && MastDB.contacts && MastDB.contacts.get) {
          c._contactId = cid;
          jobs.push(Promise.resolve(MastDB.contacts.get(cid)).then(function (ct) {
            if (ct) c._contactLocation = ct.city ? (ct.city + (ct.state ? ', ' + ct.state : '')) : (ct.location || ct.address || null);
          }).catch(function () {}));
        }
        return Promise.all(jobs).then(function () { return c; });
      });
    },
    detail: {
      template: 'party',
      orderEntity: 'orders-v2',
      contactEntity: 'contacts-v2',
      tiles: function (r) {
        var spend = (stat(r, 'lifetimeSpendCents') || 0) / 100, n = stat(r, 'orderCount') || 0;
        return [
          { k: 'Lifetime spend', v: window.MastUI.Num.money(spend), hero: true },
          { k: 'Orders', v: n },
          { k: 'Avg order', v: window.MastUI.Num.money(n ? spend / n : 0) },
          { k: 'Last order', v: stat(r, 'lastOrderAt') ? window.MastUI.Num.date(stat(r, 'lastOrderAt')) : '—' }
        ];
      },
      contact: function (r) { return { email: r.primaryEmail, location: r._contactLocation || null, contactId: r._contactId || null }; },
      relatedOrders: function (r) {
        var N = window.MastUI.Num;
        return (r._recentOrders || []).map(function (o) {
          return { id: o._key, number: o.orderNumber, date: N.date(o.placedAt), total: N.moneyVal(o, 'totalCents', 'total'), status: o.status, tone: STATUS_TONE[String(o.status || '').toLowerCase()] || 'neutral' };
        });
      },
      segments: function (r) {
        var out = [];
        if (r.marketing && r.marketing.newsletterOptIn) out.push('Newsletter');
        if (r.marketing && r.marketing.smsOptIn) out.push('SMS');
        if (r.stats && r.stats.portfolioQuadrant) out.push(r.stats.portfolioQuadrant);
        return out;
      },
      notes: function (r) { return r.notes || ''; }
    },
    onSave: function (rec) {
      var id = rec._key || rec.id;
      if (!id || !window.MastDB || !MastDB.update) return true;
      // Edit persists operator-editable identity/contact fields only.
      return MastDB.update('admin/customers/' + id, { displayName: rec.displayName, phone: rec.phone })
        .then(function () { return true; });
    }
  });

  // Minimal Contact schema (Party category) so a customer's Location drills to
  // its linked contact in the same template.
  if (!MastEntity.get('contacts-v2')) {
    MastEntity.define('contacts-v2', {
      label: 'Contact', size: 'md',
      recordId: function (c) { return c._key || c.id; },
      fields: [{ name: 'displayName', label: 'Name', type: 'text', list: true }, { name: 'email', label: 'Email', type: 'text' }],
      route: 'contacts-v2',
      fetch: function (id) { return MastDB.contacts.get(id).then(function (c) { return c ? Object.assign({ _key: id }, c) : null; }); },
      detail: {
        template: 'party',
        tiles: function (r) { return [{ k: 'Type', v: r.type || 'Contact' }, { k: 'Tags', v: (r.tags && r.tags.length) || 0 }]; },
        contact: function (r) { return { email: r.email || r.primaryEmail || '', location: r.city ? (r.city + (r.state ? ', ' + r.state : '')) : (r.location || '') }; },
        relatedOrders: function () { return []; },
        segments: function (r) { return r.tags || []; },
        notes: function (r) { return r.notes || ''; }
      }
    });
  }

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
    open: function (id) {
      // Go through the schema fetch so the linked-contact location + recent
      // orders are loaded before the Party detail renders.
      window.MastEntity.get('customers-v2').fetch(id).then(function (rec) {
        if (rec) window.MastEntity.openRecord('customers-v2', rec, 'read');
      });
    },
    exportCsv: function () { return window.MastEntity.exportRows('customers-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('customers-v2', {
    routes: { 'customers-v2': { tab: 'customersV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
