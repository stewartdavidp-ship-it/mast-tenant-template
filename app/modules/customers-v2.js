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
    label: 'Customer', labelPlural: 'Customers', size: 'xl',
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
        // Enrollments → Classes + Activity facets (match on customerId).
        if (window.MastDB && typeof MastDB.query === 'function') {
          jobs.push(Promise.resolve(MastDB.query('admin/enrollments').orderByChild('customerId').equalTo(id).once('value'))
            .then(function (snap) {
              var v = (snap && typeof snap.val === 'function') ? snap.val() : snap; var arr = [];
              Object.keys(v || {}).forEach(function (k) { var e = v[k]; if (e && typeof e === 'object') arr.push(Object.assign({ _key: k }, e)); });
              c._enrollments = arr;
            }).catch(function () {}));
        }
        // Wallet facet — only when a customer-facing account (uid) is linked.
        var uid = c.linkedIds && c.linkedIds.uids && c.linkedIds.uids[0];
        if (uid && window.MastDB && MastDB.get) {
          c._walletUid = uid;
          jobs.push(Promise.resolve(MastDB.get('public/accounts/' + uid + '/wallet'))
            .then(function (w) { c._wallet = w || null; }).catch(function () {}));
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
      notes: function (r) { return r.notes || ''; },
      // Classic burn-down Wave E — write affordances over CustomersBridge.
      overviewActions: function (r) {
        if (typeof window.can === 'function' && !window.can('customers', 'edit')) return '';
        var id = r._key || r.id;
        var esc2 = window.MastUI._esc;
        var nlOn = !!(r.marketing && r.marketing.newsletterOptIn);
        var smsOn = !!(r.marketing && r.marketing.smsOptIn);
        function optRow(label, channel, on) {
          return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;">' +
            '<span style="font-size:0.85rem;">' + label +
              ' <span style="font-size:0.72rem;color:var(--warm-gray);">' + (on ? '· opted in' : '· not opted in') + '</span></span>' +
            '<button class="btn btn-secondary btn-small" onclick="CustomersV2.toggleOptIn(\'' + channel + '\',\'' + esc2(id) + '\',' + (on ? 'true' : 'false') + ')">' +
              (on ? 'Opt out' : 'Opt in') + '</button>' +
          '</div>';
        }
        var marketingCard = window.MastUI.card('Marketing & contacts',
          optRow('Newsletter', 'newsletter', nlOn) +
          optRow('SMS', 'sms', smsOn) +
          '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">' +
            '<button class="btn btn-secondary btn-small" onclick="CustomersV2.addContact(\'' + esc2(id) + '\')">+ Add / link a contact</button>' +
          '</div>');
        var tags = (r.tags || []).map(function (t) {
          return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 8px;border-radius:999px;border:1px solid var(--border);color:var(--warm-gray);margin:2px 4px 2px 0;">' + esc2(t) +
            '<button style="background:none;border:none;color:var(--warm-gray);cursor:pointer;padding:0;font-size:0.78rem;" onclick="CustomersV2.removeTag(\'' + esc2(id) + '\',\'' + esc2(t) + '\')">&times;</button></span>';
        }).join('');
        return marketingCard + window.MastUI.card('Tags & notes',
          '<div style="margin-bottom:8px;">' + (tags || '<span class="mu-sub">No tags.</span>') + '</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
            '<input class="form-input" id="custV2NewTag" placeholder="Add a tag…" style="max-width:200px;font-size:0.85rem;">' +
            '<button class="btn btn-secondary btn-small" onclick="CustomersV2.addTag(\'' + esc2(id) + '\')">Add</button>' +
          '</div>' +
          '<textarea class="form-input" id="custV2Notes" rows="3" style="width:100%;resize:vertical;" placeholder="Notes…">' + esc2(r.notes || '') + '</textarea>' +
          '<div style="margin-top:8px;"><button class="btn btn-secondary btn-small" onclick="CustomersV2.saveNotes(\'' + esc2(id) + '\')">Save notes</button></div>');
      },
      walletActions: function (r) {
        if (typeof window.can === 'function' && !window.can('customers', 'edit')) return '';
        var id = r._key || r.id;
        var esc2 = window.MastUI._esc;
        return '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
          [['credit', '+ Adjust credits'], ['pass', '+ Grant pass'], ['membership', 'Change tier'], ['loyalty', 'Adjust loyalty']].map(function (k) {
            return '<button class="btn btn-secondary btn-small" onclick="CustomersV2.adjustWallet(\'' + k[0] + '\',\'' + esc2(id) + '\')">' + k[1] + '</button>';
          }).join('') + '</div>';
      },
      classes: function (r) {
        var N = window.MastUI.Num;
        return (r._enrollments || []).map(function (e) {
          var st = String(e.status || 'enrolled').toLowerCase();
          var tone = (st === 'attended' || st === 'completed') ? 'success'
            : (st === 'cancelled' || st === 'no_show' || st === 'no-show') ? 'danger' : 'info';
          var when = e.sessionDate || e.sessionStartAt || e.scheduledFor || e.createdAt;
          return { name: e.className || e.classTitle || e.classId || '—', session: when ? N.date(when) : '', status: st, tone: tone };
        });
      },
      activity: function (r) {
        var N = window.MastUI.Num, ev = [];
        (r._recentOrders || []).forEach(function (o) {
          ev.push({ label: 'Order ' + (o.orderNumber || o._key) + ' · ' + (N.money(N.moneyVal(o, 'totalCents', 'total')) || ''), at: N.date(o.placedAt), _t: o.placedAt });
        });
        (r._enrollments || []).forEach(function (e) {
          var when = e.sessionDate || e.createdAt;
          ev.push({ label: 'Enrolled — ' + (e.className || e.classTitle || 'class'), at: when ? N.date(when) : '', _t: when });
        });
        if (r.notes) ev.push({ label: 'Note on file', at: r.updatedAt ? N.date(r.updatedAt) : '', _t: r.updatedAt });
        ev.sort(function (a, b) { return String(b._t || '').localeCompare(String(a._t || '')); });
        return ev.map(function (x) { return { label: x.label, at: x.at, done: true }; });
      },
      wallet: function (r) {
        if (!r._walletUid) return { linked: false };
        var N = window.MastUI.Num, w = r._wallet || {};
        var creditCents = 0;
        if (w.credits) Object.keys(w.credits).forEach(function (k) { var cr = w.credits[k]; creditCents += (cr && (cr.balanceCents || cr.amountCents)) || 0; });
        var passes = w.passes ? Object.keys(w.passes).filter(function (k) { var p = w.passes[k]; return p && p.status !== 'revoked'; }).length : 0;
        var membership = (w.membership && (w.membership.tier || w.membership.tierName)) || '—';
        var loyalty = (w.loyalty && (w.loyalty.totalPoints != null ? w.loyalty.totalPoints
          : (w.loyalty.points != null ? w.loyalty.points : (w.loyalty.balance != null ? w.loyalty.balance : 0)))) || 0;
        return { linked: true, credit: N.money(creditCents / 100), passes: passes, membership: membership, loyalty: loyalty };
      }
    },
    onSave: function (rec) {
      var id = rec._key || rec.id;
      if (!id || !window.MastDB || !MastDB.update) return true;
      // Edit persists operator-editable identity/contact fields. primaryEmail is
      // an editable Identity field (and the legacy customer edit covers name +
      // email + phone) — dropping it here silently ignored email changes.
      // Normalize empty → null to match legacy (`newEmail || null`). This is an
      // UPDATE of an existing record (not a create), so it does not touch the
      // byEmail identity index / customer-resolver path.
      var email = (rec.primaryEmail == null ? '' : String(rec.primaryEmail)).trim();
      return MastDB.update('admin/customers/' + id, {
        displayName: rec.displayName,
        primaryEmail: email || null,
        phone: rec.phone,
        updatedAt: new Date().toISOString()
      }).then(function () { return true; });
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

  var V2 = { rows: [], byId: {}, sortKey: 'displayName', sortDir: 'asc', off: null, q: '', segments: [], segmentId: null };

  // Bridge gate + post-write SO refresh (mirror contacts-v2 Wave A).
  function withBridge(fn) {
    if (window.CustomersBridge) return fn(window.CustomersBridge);
    MastAdmin.loadModule('customers').then(function () {
      if (window.CustomersBridge) fn(window.CustomersBridge);
      else if (window.showToast) showToast('Customers engine still loading — try again', true);
    }).catch(function () { if (window.showToast) showToast('Customers engine unavailable', true); });
  }
  function refreshOpen(id) {
    MastEntity.get('customers-v2').fetch(id).then(function (rec) {
      if (!rec) return;
      V2.byId[id] = rec;
      var i = V2.rows.findIndex(function (r) { return (r._key || r.id) === id; });
      if (i >= 0) V2.rows[i] = rec;
      MastEntity.openRecord('customers-v2', rec, 'read', true);
      render();
    }).catch(function () {});
  }

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
    // Saved segments for the header picker (shared schema with legacy + CS).
    withBridge(function (b) {
      Promise.resolve(b.listSegments()).then(function (segs) { V2.segments = segs || []; render(); }).catch(function () {});
    });
  }

  function visibleRows() {
    var rows = V2.rows;
    // Active saved segment — the SHARED matcher (customer-filters.js), the
    // same one legacy list/export and the CS survey bulk-send use.
    if (V2.segmentId && window.MastCustomerFilters) {
      var seg = V2.segments.filter(function (g) { return g.id === V2.segmentId; })[0];
      if (seg && seg.filters) {
        var isWs = (window.CustomersBridge && CustomersBridge.isWholesale) || function () { return false; };
        rows = rows.filter(function (r) { return MastCustomerFilters.matches(r, seg.filters, { isWholesale: isWs }); });
      }
    }
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
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;flex-wrap:wrap;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Customers</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + window.MastUI.Num.count(V2.rows.length) + ' total</span>' +
        '<span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
          '<select class="form-input" style="font-size:0.85rem;max-width:200px;" onchange="CustomersV2.applySegment(this.value)">' +
            '<option value="">All customers</option>' +
            V2.segments.map(function (g) {
              return '<option value="' + window.MastUI._esc(g.id) + '"' + (V2.segmentId === g.id ? ' selected' : '') + '>' + window.MastUI._esc(g.name) + '</option>';
            }).join('') +
          '</select>' +
          '<button class="btn btn-secondary" onclick="CustomersV2.saveSegment()">Save segment</button>' +
          (V2.segmentId ? '<button class="btn btn-secondary" onclick="CustomersV2.renameSegment()">Rename</button>' +
            '<button class="btn btn-secondary" onclick="CustomersV2.deleteSegment()" style="color:var(--danger);">Delete</button>' : '') +
          '<button class="btn btn-secondary" onclick="navigateTo(\'duplicates-v2\')">Duplicates →</button>' +
          '<button class="btn btn-secondary" onclick="CustomersV2.recompute()">Recompute stats</button>' +
          '<button class="btn btn-secondary" onclick="CustomersV2.exportCsv()">↓ Export</button>' +
        '</span>' +
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
    // ── Classic burn-down Wave E: segments / tags / notes / wallet / stats ──
    applySegment: function (segId) { V2.segmentId = segId || null; render(); },
    saveSegment: function () {
      withBridge(function (b) {
        Promise.resolve(window.mastPrompt ? mastPrompt('Name this segment:', { title: 'Save segment', confirmLabel: 'Save' }) : null).then(function (name) {
          if (!name || !name.trim()) return;
          // V2's list filter vocabulary today is the search box; segments saved
          // here capture it in the SHARED filter schema (customer-filters.js),
          // so legacy + CS bulk-send read them identically.
          var filters = {};
          if (V2.q) filters.search = V2.q;
          return Promise.resolve(b.saveSegment(name, filters)).then(function (rec) {
            V2.segments.push(rec); V2.segmentId = rec.id;
            if (window.showToast) showToast('Segment saved');
            render();
          });
        }).catch(function (e) { if (window.showToast) showToast(e && e.message || 'Could not save segment', true); });
      });
    },
    // Rename the active saved segment (CustomersBridge.renameSegment \u2014 plain
    // client write, same as legacy manage-segments). Single-sourced.
    renameSegment: function () {
      var segId = V2.segmentId;
      if (!segId) { if (window.showToast) showToast('Pick a segment to rename', true); return; }
      if (typeof window.can === 'function' && !window.can('customers', 'edit')) { if (window.showToast) showToast('You don\u2019t have permission', true); return; }
      var seg = V2.segments.filter(function (g) { return g.id === segId; })[0];
      withBridge(function (b) {
        if (!b.renameSegment) { if (window.showToast) showToast('Rename unavailable', true); return; }
        Promise.resolve(window.mastPrompt ? mastPrompt('Rename segment:', { title: 'Rename segment', confirmLabel: 'Rename', defaultValue: (seg && seg.name) || '' }) : null).then(function (name) {
          if (name == null) return;
          name = String(name).trim();
          if (!name || (seg && name === seg.name)) return;
          return Promise.resolve(b.renameSegment(segId, name)).then(function () {
            if (seg) seg.name = name;
            if (window.showToast) showToast('Segment renamed');
            render();
          });
        }).catch(function (e) { if (window.showToast) showToast(e && e.message || 'Rename failed', true); });
      });
    },
    // Delete the active saved segment (CustomersBridge.deleteSegment \u2014 already
    // on the bridge; the twin previously only saved/applied).
    deleteSegment: function () {
      var segId = V2.segmentId;
      if (!segId) { if (window.showToast) showToast('Pick a segment to delete', true); return; }
      if (typeof window.can === 'function' && !window.can('customers', 'edit')) { if (window.showToast) showToast('You don\u2019t have permission', true); return; }
      var seg = V2.segments.filter(function (g) { return g.id === segId; })[0];
      withBridge(function (b) {
        if (!b.deleteSegment) { if (window.showToast) showToast('Delete unavailable', true); return; }
        Promise.resolve(window.mastConfirm ? mastConfirm('Delete segment "' + ((seg && seg.name) || '') + '"?', { title: 'Delete segment', confirmLabel: 'Delete', danger: true }) : true).then(function (ok) {
          if (!ok) return;
          return Promise.resolve(b.deleteSegment(segId)).then(function () {
            V2.segments = V2.segments.filter(function (g) { return g.id !== segId; });
            V2.segmentId = null;
            if (window.showToast) showToast('Segment deleted');
            render();
          });
        }).catch(function (e) { if (window.showToast) showToast(e && e.message || 'Delete failed', true); });
      });
    },
    recompute: function () {
      if (typeof window.can === 'function' && !window.can('customers', 'edit')) { if (window.showToast) showToast('You don\u2019t have permission', true); return; }
      withBridge(function (b) {
        if (window.showToast) showToast('Recomputing customer stats\u2026');
        Promise.resolve(b.recomputeStats()).then(function () {
          if (window.showToast) showToast('Customer stats recomputed');
          load();
        }).catch(function (e) { if (window.showToast) showToast('Recompute failed: ' + (e && e.message || e), true); });
      });
    },
    addTag: function (id) {
      var inp = document.getElementById('custV2NewTag');
      var t = ((inp && inp.value) || '').trim();
      if (!t) return;
      withBridge(function (b) {
        var rec = V2.byId[id] || {};
        var tags = (rec.tags || []).slice();
        if (tags.indexOf(t) === -1) tags.push(t);
        Promise.resolve(b.setTags(id, tags)).then(function () { refreshOpen(id); });
      });
    },
    removeTag: function (id, tag) {
      withBridge(function (b) {
        var rec = V2.byId[id] || {};
        var tags = (rec.tags || []).filter(function (x) { return x !== tag; });
        Promise.resolve(b.setTags(id, tags)).then(function () { refreshOpen(id); });
      });
    },
    saveNotes: function (id) {
      var v = ((document.getElementById('custV2Notes') || {}).value || '');
      withBridge(function (b) {
        Promise.resolve(b.saveNotes(id, v)).then(function () {
          if (window.showToast) showToast('Notes saved');
          refreshOpen(id);
        });
      });
    },
    // Marketing opt-in (newsletter / SMS) — single-sourced through
    // CustomersBridge.setMarketingOptIn (deep set, never clobbers the sibling
    // channel). `currentlyOn` is the value at render; we flip it.
    toggleOptIn: function (channel, id, currentlyOn) {
      if (typeof window.can === 'function' && !window.can('customers', 'edit')) { if (window.showToast) showToast('You don’t have permission', true); return; }
      var on = (currentlyOn === true || currentlyOn === 'true');
      withBridge(function (b) {
        if (!b.setMarketingOptIn) { if (window.showToast) showToast('Opt-in unavailable', true); return; }
        Promise.resolve(b.setMarketingOptIn(id, channel, !on)).then(function (val) {
          var label = channel === 'sms' ? 'SMS' : 'Newsletter';
          if (window.showToast) showToast(val ? ('Opted in to ' + label) : ('Opted out of ' + label));
          refreshOpen(id);
        }).catch(function (e) { if (window.showToast) showToast('Toggle failed: ' + (e && e.message || e), true); });
      });
    },
    // Add / link a contact — opens the contacts add-contact flow with this
    // customer pre-linked (CustomersBridge.addContact → legacy addContactToCustomer).
    addContact: function (id) {
      if (typeof window.can === 'function' && !window.can('customers', 'edit')) { if (window.showToast) showToast('You don’t have permission', true); return; }
      withBridge(function (b) {
        if (!b.addContact) { if (window.showToast) showToast('Add-contact unavailable', true); return; }
        b.addContact(id);
      });
    },
    adjustWallet: function (kind, id) {
      // The wallet adjust modal is a body-level legacy modal over the
      // adjustCustomerWallet CF — same implementation, V2 entry point.
      var rec = V2.byId[id] || {};
      var uid = rec._walletUid || (rec.linkedIds && rec.linkedIds.uids && rec.linkedIds.uids[0]) || '';
      MastAdmin.loadModule('customers').then(function () {
        if (window.customersOpenWalletAdjust) customersOpenWalletAdjust(kind, id, uid);
        else if (window.showToast) showToast('Wallet tools still loading — try again', true);
      });
    },
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

  // ── Ask AI: hydrate the open customer record ─────────────────────────────────
  // Send the structured customer (lifetime stats, recent orders, segments) with a
  // scope block. Recent orders are matched on customerId only (never email), so we
  // never leak another customer's orders. Spend/stats may be empty for a fresh
  // lead — scope makes "no orders yet" distinguishable from "orders not captured".
  if (window.MastAskAi && window.MastAskAi.registerEntity) {
    window.MastAskAi.registerEntity('customers-v2', {
      title: 'Ask AI about this customer',
      placeholder: 'e.g. How much have they spent? When did they last order? Are they a repeat buyer? What is their average order?',
      notes: ['Money is in dollars. Stats (orders, spend, last order) are lifetime for this customer only.'],
      buildContext: function (c) {
        if (!c) return {};
        var N = window.MastUI.Num;
        var id = c._key || c.id;
        var spend = (stat(c, 'lifetimeSpendCents') || 0) / 100;
        var n = stat(c, 'orderCount') || 0;
        var recent = (c._recentOrders || []).map(function (o) {
          return { id: o._key, orderNumber: o.orderNumber || null, placedAt: o.placedAt ? String(o.placedAt).slice(0, 10) : null,
            totalUSD: N.moneyVal(o, 'totalCents', 'total'), status: String(o.status || '').toLowerCase() || null };
        });
        var segments = [];
        if (c.marketing && c.marketing.newsletterOptIn) segments.push('Newsletter');
        if (c.marketing && c.marketing.smsOptIn) segments.push('SMS');
        if (c.stats && c.stats.portfolioQuadrant) segments.push(c.stats.portfolioQuadrant);
        var sections = ['customer', 'segments'];
        var ctx = {
          page: { title: c.displayName || 'Customer', route: 'customers-v2', viewing: 'customer-detail' },
          customer: {
            id: id, name: c.displayName || null, email: c.primaryEmail || null,
            phone: c.phone || null, status: String(c.status || '').toLowerCase() || null,
            source: c.source || null, location: c._contactLocation || null,
            createdAt: c.createdAt || null,
            lifetime: {
              orderCount: n, totalSpendUSD: +spend.toFixed(2),
              avgOrderUSD: +(n ? spend / n : 0).toFixed(2),
              lastOrderAt: stat(c, 'lastOrderAt') ? String(stat(c, 'lastOrderAt')).slice(0, 10) : null
            }
          },
          segments: segments
        };
        if (c._recentOrders) { ctx.recentOrders = recent; sections.push('recentOrders'); }
        ctx.scope = {
          describes: 'a single customer record (lifetime stats + recent orders) for this tenant',
          sectionsIncluded: sections,
          notInThisPayload: ['external / enriched demographic data', 'industry benchmarks (e.g. typical repeat-rate)', 'orders beyond the recent list shown here'],
          neverInfer: ['other tenants’ customers', 'other customers’ private records']
        };
        return ctx;
      }
    });
  }
})();
