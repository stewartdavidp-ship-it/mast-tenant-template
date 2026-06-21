/**
 * customers-v2.js — the Customers screen as a MastEntity schema, exercising the
 * read→edit paradigm at the `md` tier (vs orders-v2's `lg`/expand). After the
 * T6 rip-and-replace (PR1 core-extract → PR2 certs → PR3 filters/sorts → PR4
 * activity → PR5 cutover), this is the SOLE Customers surface: customers.js (V1)
 * is deleted and this twin owns the bare #customers route directly for ALL users
 * (no flag gate, no MAST_V2_ROUTE_MAP remap). The cross-module write layer
 * (CustomersBridge / merge / wallet-adjust / open-detail) lives in the lazy
 * app/modules/customers-core.js. Verify on a dev pod (list, record-open, edit→dirty→save).
 */
(function () {
  'use strict';
  // customers.js (V1) RETIRED (T6 rip-and-replace PR5): customers-v2 is now the
  // SOLE Customers surface and owns the bare #customers route (manifest +
  // registerModule below), so it serves ALL users regardless of the Legacy-UI
  // flag — the flagOn() gate is removed (rma-admin precedent). The dependency
  // guard stays: MastAdmin/MastEntity are shared/eager, so it holds in any mode.
  if (!window.MastAdmin || !window.MastEntity) return;

  var STATUS_TONE = { active: 'success', lapsed: 'danger', lead: 'info', vip: 'amber' };
  // Revoke-reason vocabulary — the same option set + labels as V1 customers.js
  // (customersRevokeCert / _revokeReasonLabel), so a revoked cert's history reads
  // identically across the V1→V2 retirement.
  var REVOKE_REASONS = [
    { v: 'mistake', l: 'Granted in error' },
    { v: 'violation', l: 'Policy violation' },
    { v: 'expired-by-policy', l: 'Expired by policy' },
    { v: 'other', l: 'Other' }
  ];
  function revokeReasonLabel(reason) {
    var hit = REVOKE_REASONS.filter(function (o) { return o.v === reason; })[0];
    return hit ? hit.l : (reason || 'Revoked');
  }
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
      { name: 'createdAt', label: 'Created', type: 'date', group: 'Identity', readOnly: true },
      // ── Advanced sorts (Gap 3) — stat-derived, NON-list (list:false) sort
      // dimensions. They are real schema fields so the sort control + the engine's
      // mastSortRows resolve them via field.get (no bespoke comparators); list:false
      // keeps them out of the table columns. They DO surface in CSV export
      // (exportColumns includes every field) — a useful add. All three sort DESC =
      // V1 SORT_OPTIONS direction. Missing-value handling matches V1's tie-break,
      // verified row-for-row against live sgtest15 data:
      //   lastOrder  recent→old — raw ISO (undefined→absent rows sink last, like
      //              V1's (sb.lastOrderAt||'').localeCompare(sa…) where '' sorts last).
      //   lapseScore most-overdue→on-rhythm — raw number; absent rows sink last,
      //              which equals V1's missing→-1 sentinel because real scores are ≥0.
      //   grossMargin high→low — absent COALESCED to 0 (mirrors V1's
      //              (…||0)-(…||0)); the 0 sentinel is load-bearing here because real
      //              gross margin can be 0 or negative, so null-sink would diverge.
      { name: 'lastOrderAt', label: 'Last order', type: 'date', list: false, group: 'Activity',
        get: function (c) { return stat(c, 'lastOrderAt'); } },
      { name: 'lapseScore', label: 'Lapse score', type: 'number', list: false, group: 'Activity',
        get: function (c) { var v = stat(c, 'lapseScore'); return (typeof v === 'number') ? v : undefined; } },
      { name: 'grossMargin12m', label: 'Gross margin 12m', type: 'money', list: false, group: 'Activity',
        get: function (c) { var v = stat(c, 'trailing12mGrossMarginCents'); return window.MastUI.Num.moneyVal({ cents: (typeof v === 'number') ? v : 0 }, 'cents', null); } }
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
            c._activityOrders = arr;   // full set (cancelled filtered in the Activity facet) — already in memory, no extra read
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
        // Certifications facet — hydrate _certs / _certTypes LAZILY (on record
        // open, never the list load()). Read through the shared core helper
        // (CustomersBridge.loadCerts); ensure-load customers-core if it isn't yet.
        jobs.push(
          (window.CustomersBridge && CustomersBridge.loadCerts
            ? Promise.resolve(window.CustomersBridge)
            : MastAdmin.loadModule('customers-core').then(function () { return window.CustomersBridge; })
          ).then(function (b) {
            if (!b || !b.loadCerts) { c._certs = []; c._certTypes = {}; return; }
            return Promise.resolve(b.loadCerts(id)).then(function (res) {
              c._certs = (res && res.certs) || [];
              c._certTypes = (res && res.certTypes) || {};
            });
          }).catch(function () { c._certs = []; c._certTypes = {}; })
        );
        // Activity facet (PR4) — hydrate the richer touchpoint feed V1's activity
        // tab aggregated but V2 lacked: CS tickets / reviews / survey-responses
        // (matched by customerId with email/contact/uid fallback, mirroring V1's
        // getCustomerActivityTimeline so pre-FK-backfill records still surface) +
        // each linked contact's interactions. Orders + enrollments are already
        // loaded above and reused by activity(r) (no duplicate read). LAZY on
        // record-open (the _certs precedent), never the list load().
        if (window.MastDB && typeof MastDB.query === 'function') {
          var emailSet = {};
          var pe = String(c.primaryEmail || '').toLowerCase(); if (pe) emailSet[pe] = true;
          (c.emails || []).forEach(function (e) { if (e) emailSet[String(e).toLowerCase()] = true; });
          var linkedC = c.linkedIds || {};
          var contactSet = {}; (linkedC.contactIds || []).forEach(function (x) { contactSet[x] = true; });
          var uidSet = {}; (linkedC.uids || []).forEach(function (u) { uidSet[u] = true; });
          var csMatch = function (rec, uidField) {
            if (!rec) return false;
            if (rec.customerId === id) return true;
            var em = String(rec.contactEmail || rec.authorEmail || rec.email || '').toLowerCase();
            if (em && emailSet[em]) return true;
            if (rec.contactId && contactSet[rec.contactId]) return true;
            if (uidField && rec[uidField] && uidSet[rec[uidField]]) return true;
            return false;
          };
          var matchedArr = function (map, uidField) {
            var out = []; Object.keys(map || {}).forEach(function (k) { var v = map[k]; if (v && typeof v === 'object' && csMatch(v, uidField)) out.push(Object.assign({ _key: k }, v)); });
            return out;
          };
          var q500 = function (path) {
            return Promise.resolve(MastDB.query(path).limitToLast(500).once('value'))
              .then(function (s) { return (s && typeof s.val === 'function') ? (s.val() || {}) : (s || {}); })
              .catch(function () { return {}; });
          };
          jobs.push(Promise.all([q500('cs_tickets'), q500('cs_reviews'), q500('cs_survey_responses')]).then(function (res) {
            c._activityTickets = matchedArr(res[0]);
            c._activityReviews = matchedArr(res[1], 'authorUid');
            c._activitySurveys = matchedArr(res[2]);
          }).catch(function () { c._activityTickets = []; c._activityReviews = []; c._activitySurveys = []; }));
          var cids = (linkedC.contactIds || []);
          if (cids.length) {
            jobs.push(Promise.all(cids.map(function (cid) {
              return Promise.resolve(MastDB.get('admin/contacts/' + cid + '/interactions'))
                .then(function (s) { var v = (s && typeof s.val === 'function') ? s.val() : s; return { cid: cid, ix: v || {} }; })
                .catch(function () { return { cid: cid, ix: {} }; });
            })).then(function (pairs) {
              var out = [];
              pairs.forEach(function (p) { Object.keys(p.ix || {}).forEach(function (k) { var raw = p.ix[k]; if (raw && typeof raw === 'object') out.push(Object.assign({ _key: k, _contactId: p.cid }, raw)); }); });
              c._activityInteractions = out;
            }).catch(function () { c._activityInteractions = []; }));
          }
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
      // Certifications facet (PR2) — SHAPED data for the engine's cert pane (an
      // active-cert table + a collapsible revoked/expired group). RBAC lives HERE:
      // the Grant affordance + each row's Revoke button are emitted ONLY when the
      // viewer can('customers','edit') (the handlers re-check — defense-in-depth).
      // V1's grant/revoke had NO gate at all; this is the security win the rebuild
      // adds. Active/inactive split + attestor/expires labels mirror V1 verbatim.
      certifications: function (r) {
        var N = window.MastUI.Num, esc2 = window.MastUI._esc;
        var id = r._key || r.id;
        var types = r._certTypes || {};
        var canEdit = !(typeof window.can === 'function' && !window.can('customers', 'edit'));
        var now = new Date().toISOString();
        function isActive(cert) {
          if (!cert) return false;
          if (cert.revokedAt) return false;
          if (cert.expiresAt && cert.expiresAt < now) return false;
          return true;
        }
        function shape(cert) {
          var revoked = !!cert.revokedAt;
          var expired = !revoked && cert.expiresAt && cert.expiresAt < now;
          var typeName = (types[cert.typeId] && types[cert.typeId].name) || cert.typeId;
          var attestor = (cert.instructorOfRecord && cert.instructorOfRecord.displayName)
            ? cert.instructorOfRecord.displayName : (cert.grantedBy || '—');
          return {
            name: typeName,
            status: revoked ? 'Revoked' : (expired ? 'Expired' : 'Active'),
            tone: revoked ? 'danger' : (expired ? 'neutral' : 'teal'),
            attestor: 'Attested by ' + attestor,
            granted: cert.grantedAt ? N.date(cert.grantedAt) : '—',
            expires: cert.expiresAt ? N.date(cert.expiresAt) : 'Lifetime',
            reason: revoked ? revokeReasonLabel(cert.revokeReason) : '',
            note: cert.revokeNote || '',
            action: canEdit
              ? '<button class="btn btn-link" onclick="CustomersV2.revokeCert(\'' + esc2(id) + '\',\'' + esc2(cert.id) + '\')">Revoke</button>'
              : ''
          };
        }
        var certs = r._certs || [];
        return {
          active: certs.filter(isActive).map(shape),
          revoked: certs.filter(function (x) { return x && !isActive(x); }).map(shape),
          grant: canEdit
            ? '<button class="btn btn-link" onclick="CustomersV2.grantCert(\'' + esc2(id) + '\')">+ Grant cert</button>'
            : ''
        };
      },
      // Activity facet (PR4) — the rich, recency-sorted touchpoint feed V1's
      // activity tab showed (orders + enrollments + CS tickets/reviews/surveys +
      // linked-contact interactions + a notes entry), shaped for the engine's
      // renderActivityFacet (badge + relatedTable + type-filter pills). Each event
      // carries its OWN drill `click` (built here, ids escaped) routed through
      // CustomersV2.openActivity: orders/contacts drill IN-PANEL via MastEntity.drill
      // (no navigate-then-setTimeout race like V1); CS surfaces fall back to a route
      // nav + guarded deep-open. Order money via MastUI.Num.money/moneyVal (not
      // hand-rolled cents math), dates via MastUI.Num.date (not the locale date/time
      // formatter — the off-by-one ratchet). Reuses the orders + enrollments already
      // loaded in fetch + the CS/interaction arrays it hydrated.
      activity: function (r) {
        var N = window.MastUI.Num, esc2 = window.MastUI._esc, ev = [];
        function clk(type, id) { return id ? "CustomersV2.openActivity('" + type + "','" + esc2(String(id)) + "')" : ''; }
        function trunc(s) { s = String(s || ''); return s.length > 140 ? s.slice(0, 137) + '…' : s; }
        (r._activityOrders || []).forEach(function (o) {
          if (o.status === 'cancelled') return;
          var money = N.money(N.moneyVal(o, 'totalCents', 'total'));
          ev.push({ type: 'order', typeLabel: 'Orders', tone: 'teal', _t: o.placedAt || o.createdAt,
            summary: 'Order ' + (o.orderNumber || o._key) + (money ? ' (' + money + ')' : '') + ' · ' + (o.status || 'placed'),
            click: clk('order', o._key) });
        });
        (r._enrollments || []).forEach(function (e) {
          if (e.status === 'cancelled' || e.enrollmentStatus === 'cancelled') return;
          ev.push({ type: 'enrollment', typeLabel: 'Enrollments', tone: 'amber', _t: e.sessionDate || e.createdAt,
            summary: 'Enrolled · ' + (e.className || e.classTitle || '(class)'),
            click: clk('enrollment', e.classId) });
        });
        (r._activityTickets || []).forEach(function (t) {
          ev.push({ type: 'ticket', typeLabel: 'Tickets', tone: 'danger', _t: t.updatedAt || t.createdAt,
            summary: (t.ticketNumber || t._key) + (t.subject ? ' · ' + t.subject : '') + (t.status ? ' [' + t.status + ']' : ''),
            click: clk('ticket', t._key) });
        });
        (r._activityReviews || []).forEach(function (rv) {
          var stars = (typeof rv.rating === 'number' ? '★'.repeat(rv.rating) : '');
          ev.push({ type: 'review', typeLabel: 'Reviews', tone: 'amber', _t: rv.createdAt,
            summary: (stars ? stars + ' · ' : '') + (rv.productName || rv.productId || '') + (rv.title ? ' · ' + rv.title : ''),
            click: clk('review', rv._key) });
        });
        (r._activitySurveys || []).forEach(function (s) {
          var ans = (s.answers && s.answers.length) ? s.answers.length + ' answer(s)' : '';
          ev.push({ type: 'survey-response', typeLabel: 'Surveys', tone: 'info', _t: s.completedAt || s.createdAt,
            summary: 'Survey response · ' + (s.status || 'pending') + (ans ? ' · ' + ans : ''),
            click: clk('survey-response', s._key) });
        });
        (r._activityInteractions || []).forEach(function (ix) {
          var short = trunc(ix.notes || ix.body || ix.summary || '');
          ev.push({ type: 'contact-interaction', typeLabel: 'Contacts', tone: 'info', _t: ix.date || ix.createdAt,
            summary: (ix.type || 'note') + (short ? ' · ' + short : ''),
            click: clk('contact-interaction', ix._contactId) });
        });
        if (r.notes && r.notes.trim()) {
          ev.push({ type: 'note', typeLabel: 'Notes', tone: 'neutral', _t: r.updatedAt || r.createdAt, summary: trunc(r.notes), click: '' });
        }
        ev.sort(function (a, b) { return String(b._t || '').localeCompare(String(a._t || '')); });
        var events = ev.map(function (e) {
          return { type: e.type, typeLabel: e.typeLabel, tone: e.tone, summary: e.summary, at: e._t ? N.date(e._t) : '', click: e.click };
        });
        // Type-filter pills — counts over the FULL population (V1 order), only for
        // types actually present, with 'All' first. ≤1 type → renderActivityFacet
        // omits the pill row.
        var order = ['order', 'enrollment', 'ticket', 'review', 'survey-response', 'contact-interaction', 'note'];
        var labels = { order: 'Orders', enrollment: 'Enrollments', ticket: 'Tickets', review: 'Reviews', 'survey-response': 'Surveys', 'contact-interaction': 'Contacts', note: 'Notes' };
        var counts = {}; events.forEach(function (e) { counts[e.type] = (counts[e.type] || 0) + 1; });
        var filters = [{ key: 'all', label: 'All', n: events.length }];
        order.forEach(function (k) { if (counts[k]) filters.push({ key: k, label: labels[k], n: counts[k] }); });
        return { events: events, filters: filters };
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

  // Sort vocabulary (Gap 3) — mirrors V1 customers.js SORT_OPTIONS. Each entry
  // carries the schema field key + the V1 direction, so picking one sets BOTH
  // V2.sortKey and V2.sortDir (the engine sorts via field.get). updatedAt has no
  // schema field → the resolver falls back to r.updatedAt (string ISO); createdAt
  // is a field with no get → resolver returns r.createdAt. Both sort desc = newest.
  var SORT_OPTIONS = [
    { key: 'updatedAt', dir: 'desc', label: 'Recently updated' },
    { key: 'createdAt', dir: 'desc', label: 'Newest' },
    { key: 'displayName', dir: 'asc', label: 'Name (A–Z)' },
    { key: 'primaryEmail', dir: 'asc', label: 'Email (A–Z)' },
    { key: 'totalSpend', dir: 'desc', label: 'Lifetime spend (high → low)' },
    { key: 'orderCount', dir: 'desc', label: 'Orders (most → least)' },
    { key: 'lastOrderAt', dir: 'desc', label: 'Last order (recent → old)' },
    { key: 'lapseScore', dir: 'desc', label: 'Lapse score (most overdue → on rhythm)' },
    { key: 'grossMargin12m', dir: 'desc', label: 'Gross margin 12m (high → low)' }
  ];
  // Filter-bar source vocabulary — same set + labels as V1 SOURCE_OPTIONS.
  var SOURCE_OPTIONS = [
    { v: 'all', l: 'All sources' }, { v: 'order', l: 'Order' }, { v: 'enrollment', l: 'Enrollment' },
    { v: 'contact', l: 'Contact' }, { v: 'newsletter', l: 'Newsletter' }, { v: 'account', l: 'Account' },
    { v: 'manual', l: 'Manual' }, { v: 'import', l: 'Import' }
  ];
  var WHOLESALE_OPTIONS = [
    { v: 'all', l: 'All customers' }, { v: 'retail', l: 'Retail only' }, { v: 'wholesale', l: 'Wholesale only' }
  ];
  function defaultFilters() {
    return { source: 'all', wholesale: 'all', tag: '', lastOrderBefore: '', minSpend: '', newsletterOnly: false, leadsOnly: false };
  }

  var V2 = { rows: [], byId: {}, sortKey: 'displayName', sortDir: 'asc', off: null, q: '', segments: [], segmentId: null,
    filters: defaultFilters(), segmentExtras: null, wsResolver: null };

  // Bridge gate + post-write SO refresh (mirror contacts-v2 Wave A).
  function withBridge(fn) {
    if (window.CustomersBridge) return fn(window.CustomersBridge);
    MastAdmin.loadModule('customers-core').then(function () {
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
    // Wholesale resolver — built from admin/wholesaleAuthorized the SAME way the CS
    // bulk-survey-send builds it (customer-service.js), so a `wholesale`/`retail`
    // segment resolves identical membership in the V2 list and the CS send. Seed a
    // fail-safe empty resolver first so a wholesale filter never over-includes
    // before the map loads (matcher fails safe to exclude without a resolver).
    if (window.MastCustomerFilters && MastCustomerFilters.makeWholesaleResolver) {
      if (!V2.wsResolver) V2.wsResolver = MastCustomerFilters.makeWholesaleResolver({});
      if (window.MastDB && MastDB.get) {
        Promise.resolve(MastDB.get('admin/wholesaleAuthorized')).then(function (ws) {
          V2.wsResolver = MastCustomerFilters.makeWholesaleResolver(ws || {});
          render();
        }).catch(function () {});
      }
    }
  }

  // Author the filter-bar state as the SHARED persisted filter shape
  // (shared/customer-filters.js / V1 readFilterSnapshot): defaults omitted, spend
  // as `minSpendCents`, search trimmed+lowercased (the matcher compares f.search
  // case-sensitively against lowercased fields). The SAME object drives the live
  // list filter AND the saved segment — so a segment's membership is identical to
  // what the bar previews and to what the CS bulk-send resolves (cross-surface
  // integrity, the D4-005 bug class).
  function snapshotFilters() {
    var fl = V2.filters || defaultFilters();
    var snap = {};
    if (fl.source && fl.source !== 'all') snap.source = fl.source;
    if (fl.wholesale && fl.wholesale !== 'all') snap.wholesale = fl.wholesale;
    if (fl.tag) snap.tag = fl.tag;
    if (fl.lastOrderBefore) snap.lastOrderBefore = fl.lastOrderBefore;
    if (fl.minSpend !== '' && fl.minSpend != null) {
      var n = Math.round(parseFloat(fl.minSpend) * 100);
      if (!isNaN(n)) snap.minSpendCents = n;
    }
    var q = (V2.q || '').trim().toLowerCase();
    if (q) snap.search = q;
    if (fl.newsletterOnly) snap.newsletterOnly = true;
    if (fl.leadsOnly) snap.leadsOnly = true;
    return snap;
  }
  // Load a persisted segment snapshot back INTO the bar controls (round-trip), so
  // applying a segment shows its filters AND re-saving reproduces it. Any keys the
  // bar can't author (built-in flags like _newThisWeek) are stashed in
  // segmentExtras and carried back through the matcher unchanged.
  function restoreFilters(snap) {
    snap = snap || {};
    V2.filters = {
      source: snap.source || 'all',
      wholesale: snap.wholesale || 'all',
      tag: snap.tag || '',
      lastOrderBefore: snap.lastOrderBefore || '',
      minSpend: (typeof snap.minSpendCents === 'number') ? window.MastUI.Num.moneyRaw(snap.minSpendCents, { cents: true }) : '',
      newsletterOnly: !!snap.newsletterOnly,
      leadsOnly: !!snap.leadsOnly
    };
    V2.q = snap.search || '';
    var known = { source: 1, wholesale: 1, tag: 1, lastOrderBefore: 1, minSpendCents: 1, search: 1, newsletterOnly: 1, leadsOnly: 1 };
    var extras = {};
    Object.keys(snap).forEach(function (k) { if (!known[k]) extras[k] = snap[k]; });
    V2.segmentExtras = Object.keys(extras).length ? extras : null;
  }
  // Distinct tags across the loaded customers (V1 allKnownTags) for the tag select.
  function knownTags() {
    var seen = {};
    V2.rows.forEach(function (c) { (c && c.tags || []).forEach(function (t) { if (t) seen[t] = 1; }); });
    return Object.keys(seen).sort();
  }
  // The wholesale resolver for the matcher — ALWAYS a function (the matcher fails
  // safe and EXCLUDES when a wholesale filter is set but no resolver is supplied).
  // Built in load() from admin/wholesaleAuthorized exactly as the CS bulk-send does
  // (NOT CustomersBridge.isWholesale, whose backing map is unpopulated in V2 mode →
  // always false → would silently disagree with CS on every wholesale segment).
  function wsResolver() {
    if (V2.wsResolver) return V2.wsResolver;
    return (window.MastCustomerFilters && MastCustomerFilters.makeWholesaleResolver)
      ? MastCustomerFilters.makeWholesaleResolver({})
      : function () { return false; };
  }

  function visibleRows() {
    var rows = V2.rows;
    // Author the bar as the shared filter object (search folded in). The matcher
    // (shared/customer-filters.js) is the SAME predicate legacy list/export and the
    // CS survey bulk-send use, so the live list, a saved segment, and a survey all
    // resolve identical membership.
    var f = snapshotFilters();
    if (V2.segmentExtras) Object.keys(V2.segmentExtras).forEach(function (k) { if (!(k in f)) f[k] = V2.segmentExtras[k]; });
    // Run the matcher whenever any filter/search is set OR a segment is applied
    // (an applied segment always filters — and the matcher drops merged records,
    // matching V1). With nothing active, show all rows (preserves current behavior).
    if ((V2.segmentId || Object.keys(f).length) && window.MastCustomerFilters) {
      var isWs = wsResolver();
      rows = rows.filter(function (r) { return MastCustomerFilters.matches(r, f, { isWholesale: isWs }); });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var fld = MastEntity.get('customers-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (fld && fld.get) ? fld.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('customersV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'customersV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  // Interactive filter bar (Gap 2) — compact controls that AUTHOR the shared
  // filter object (snapshotFilters → MastCustomerFilters.matches). Selects/checks
  // use onchange (no per-keystroke re-render); editing any control diverges from an
  // applied segment, so it clears the segment selection (the bar is the single
  // live filter state, V1-style). The prominent search box above stays the
  // `search` term.
  function filterBar() {
    var esc = window.MastUI._esc, fl = V2.filters || defaultFilters();
    function opts(list, cur) {
      return list.map(function (o) {
        var v = (o.v != null) ? o.v : o, l = (o.l != null) ? o.l : o;
        return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('');
    }
    var inputCss = 'font-size:0.85rem;padding:7px 10px;';
    var sortMatch = SORT_OPTIONS.filter(function (o) { return o.key === V2.sortKey && o.dir === V2.sortDir; })[0];
    var sortSel = '<select class="form-input" title="Sort" style="' + inputCss + 'max-width:230px;" onchange="CustomersV2.setSort(this.value)">' +
      '<option value=""' + (sortMatch ? '' : ' selected') + ' disabled>Sort by…</option>' +
      SORT_OPTIONS.map(function (o) {
        return '<option value="' + esc(o.key) + '"' + (sortMatch && sortMatch.key === o.key ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('') + '</select>';
    var tagOpts = '<option value="">All tags</option>' + knownTags().map(function (t) {
      return '<option value="' + esc(t) + '"' + (fl.tag === t ? ' selected' : '') + '>' + esc(t) + '</option>';
    }).join('');
    var hasFilters = JSON.stringify(snapshotFilters()) !== '{}';
    return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">' +
      sortSel +
      '<select class="form-input" title="Source" style="' + inputCss + '" onchange="CustomersV2.setFilter(\'source\',this.value)">' + opts(SOURCE_OPTIONS, fl.source) + '</select>' +
      '<select class="form-input" title="Wholesale" style="' + inputCss + '" onchange="CustomersV2.setFilter(\'wholesale\',this.value)">' + opts(WHOLESALE_OPTIONS, fl.wholesale) + '</select>' +
      '<select class="form-input" title="Tag" style="' + inputCss + '" onchange="CustomersV2.setFilter(\'tag\',this.value)">' + tagOpts + '</select>' +
      '<input type="date" class="form-input" title="Last order before…" value="' + esc(fl.lastOrderBefore) + '" style="' + inputCss + '" onchange="CustomersV2.setFilter(\'lastOrderBefore\',this.value)">' +
      '<input type="number" min="0" step="1" class="form-input" placeholder="Min spend $" value="' + esc(fl.minSpend) + '" style="' + inputCss + 'width:120px;" onchange="CustomersV2.setFilter(\'minSpend\',this.value)">' +
      '<label style="display:inline-flex;align-items:center;gap:5px;font-size:0.78rem;color:var(--warm-gray);cursor:pointer;">' +
        '<input type="checkbox"' + (fl.newsletterOnly ? ' checked' : '') + ' onchange="CustomersV2.setFilterBool(\'newsletterOnly\',this.checked)"> Newsletter</label>' +
      '<label style="display:inline-flex;align-items:center;gap:5px;font-size:0.78rem;color:var(--warm-gray);cursor:pointer;">' +
        '<input type="checkbox"' + (fl.leadsOnly ? ' checked' : '') + ' onchange="CustomersV2.setFilterBool(\'leadsOnly\',this.checked)"> Leads</label>' +
      (hasFilters ? '<button class="btn btn-secondary btn-small" onclick="CustomersV2.clearFilters()">Clear filters</button>' : '') +
    '</div>';
  }

  function render() {
    var tab = ensureTab();
    var vis = visibleRows();
    var total = V2.rows.length;
    var countLabel = (vis.length === total)
      ? (window.MastUI.Num.count(total) + ' total')
      : (window.MastUI.Num.count(vis.length) + ' of ' + window.MastUI.Num.count(total));
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;flex-wrap:wrap;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Customers</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + countLabel + '</span>' +
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
      '<div style="margin:14px 0 10px;"><input class="form-input" placeholder="Search name or email…" value="' +
        (window.MastUI._esc(V2.q)) + '" oninput="CustomersV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      filterBar() +
      window.MastEntity.renderList('customers-v2', {
        rows: vis, sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CustomersV2.sort', onRowClickFnName: 'CustomersV2.open',
        empty: { title: 'No customers match', message: 'Try a different search or clear the filters.' }
      });
  }

  window.CustomersV2 = {
    // Column-header sort (toggles asc/desc). Sorting never changes membership, so
    // it does NOT clear an applied segment.
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    // Sort-control (Gap 3) — sets BOTH key + the V1 direction from SORT_OPTIONS.
    setSort: function (key) {
      var opt = SORT_OPTIONS.filter(function (o) { return o.key === key; })[0];
      if (!opt) return;
      V2.sortKey = opt.key; V2.sortDir = opt.dir;
      render();
    },
    // Search is part of the shared filter vocabulary (matcher's f.search), so
    // editing it diverges from any applied segment → clear the selection.
    search: function (v) { V2.q = v || ''; V2.segmentId = null; V2.segmentExtras = null; render(); },
    // ── Interactive filters (Gap 2) ─────────────────────────────────────────
    // Each control edit clears the applied segment (the bar is the single live
    // filter state; you've diverged from the saved preset — Save to persist anew).
    setFilter: function (k, v) {
      if (!V2.filters) V2.filters = defaultFilters();
      V2.filters[k] = (v == null ? '' : v);
      V2.segmentId = null; V2.segmentExtras = null;
      render();
    },
    setFilterBool: function (k, v) {
      if (!V2.filters) V2.filters = defaultFilters();
      V2.filters[k] = !!v;
      V2.segmentId = null; V2.segmentExtras = null;
      render();
    },
    clearFilters: function () {
      V2.filters = defaultFilters(); V2.q = '';
      V2.segmentId = null; V2.segmentExtras = null;
      render();
    },
    // ── Classic burn-down Wave E: segments / tags / notes / wallet / stats ──
    // Applying a segment LOADS its persisted filters into the bar (round-trip), so
    // the controls reflect what's applied and re-saving reproduces it exactly.
    applySegment: function (segId) {
      V2.segmentId = segId || null;
      var seg = V2.segments.filter(function (g) { return g.id === segId; })[0];
      restoreFilters(seg && seg.filters);
      render();
    },
    saveSegment: function () {
      withBridge(function (b) {
        Promise.resolve(window.mastPrompt ? mastPrompt('Name this segment:', { title: 'Save segment', confirmLabel: 'Save' }) : null).then(function (name) {
          if (!name || !name.trim()) return;
          // Capture the FULL filter vocabulary in the SHARED persisted shape
          // (shared/customer-filters.js / V1 readFilterSnapshot): source, wholesale,
          // tag, lastOrderBefore, minSpendCents, search, newsletterOnly, leadsOnly —
          // so a saved segment round-trips identically across V2, legacy, and the CS
          // bulk-survey send. snapshotFilters() is the SAME object the live list is
          // filtered by, so the segment's membership equals the previewed set.
          var filters = snapshotFilters();
          if (V2.segmentExtras) Object.keys(V2.segmentExtras).forEach(function (k) { if (!(k in filters)) filters[k] = V2.segmentExtras[k]; });
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
      MastAdmin.loadModule('customers-core').then(function () {
        if (window.customersOpenWalletAdjust) customersOpenWalletAdjust(kind, id, uid);
        else if (window.showToast) showToast('Wallet tools still loading — try again', true);
      });
    },
    // ── Certifications (PR2) ────────────────────────────────────────────────
    // Grant delegates to book.js _bookGrantCert (THE single source of grant
    // logic — idempotent re-grant, instructor snapshot, expiry calc — zero
    // reimplementation); revoke goes through CustomersBridge.revokeCert. BOTH
    // re-check can('customers','edit') at the handler: the affordances are already
    // hidden for non-editors, but a hidden control must not be console-drivable.
    // V1's grant/revoke had no can() gate at all — this is the security win.
    grantCert: function (id) {
      if (typeof window.can === 'function' && !window.can('customers', 'edit')) {
        if (window.showToast) showToast('You don’t have permission', true); return;
      }
      Promise.resolve(MastDB.get('admin/certTypes')).then(function (types) {
        types = types || {};
        var activeIds = Object.keys(types).filter(function (t) { return !types[t].archivedAt; });
        if (!activeIds.length) { if (window.showToast) showToast('No cert types defined. Add one in Book → Settings.', true); return; }
        var esc2 = window.MastUI._esc;
        var options = activeIds.map(function (tid) {
          return '<option value="' + esc2(tid) + '">' + esc2(types[tid].name || tid) + '</option>';
        }).join('');
        var html =
          '<div class="modal-header"><h3>Grant certification</h3></div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label class="form-label">Certification type</label>' +
              '<select id="custV2GrantType" class="form-input" style="width:100%;">' + options + '</select></div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
            '<button class="btn btn-primary" id="custV2GrantBtn" onclick="CustomersV2.grantCertConfirm(\'' + esc2(id) + '\')">Grant</button>' +
          '</div>';
        if (typeof openModal === 'function') openModal(html);
      }).catch(function (e) { if (window.showToast) showToast('Could not load cert types: ' + (e && e.message || e), true); });
    },
    grantCertConfirm: function (id) {
      if (typeof window.can === 'function' && !window.can('customers', 'edit')) {
        if (window.showToast) showToast('You don’t have permission', true); return;
      }
      var sel = document.getElementById('custV2GrantType');
      if (!sel || !sel.value) return;
      var typeId = sel.value;
      var btn = document.getElementById('custV2GrantBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Granting…'; }
      var ensure = window._bookGrantCert ? Promise.resolve() : MastAdmin.loadModule('book');
      ensure.then(function () {
        if (!window._bookGrantCert) throw new Error('Cert grant helper unavailable');
        return window._bookGrantCert({ typeId: typeId, customerId: id, sourceClassId: null, sourceEnrollmentId: null });
      }).then(function (result) {
        if (typeof closeModal === 'function') closeModal();
        // _bookGrantCert toasts its own success ("Certification granted"/"re-granted").
        if (result) refreshOpen(id);
      }).catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Grant'; }
        if (window.showToast) showToast('Grant failed: ' + (e && e.message || e), true);
      });
    },
    revokeCert: function (id, certId) {
      if (typeof window.can === 'function' && !window.can('customers', 'edit')) {
        if (window.showToast) showToast('You don’t have permission', true); return;
      }
      var esc2 = window.MastUI._esc;
      // Prefer the OPEN record (fetched, has _certs/_certTypes) for the type name;
      // fall back to the list row. Either way the modal works.
      var cur = (window.MastEntity && MastEntity.getCurrent && MastEntity.getCurrent()) || {};
      var rec = (cur.record && (cur.record._key || cur.record.id) === id) ? cur.record : (V2.byId[id] || {});
      var cert = (rec._certs || []).filter(function (x) { return x && x.id === certId; })[0];
      var types = rec._certTypes || {};
      var typeName = (cert && types[cert.typeId] && types[cert.typeId].name) || (cert && cert.typeId) || 'this certification';
      var optsHtml = REVOKE_REASONS.map(function (o) {
        return '<option value="' + esc2(o.v) + '">' + esc2(o.l) + '</option>';
      }).join('');
      var html =
        '<div class="modal-header"><h3>Revoke certification</h3></div>' +
        '<div class="modal-body">' +
          '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 12px;">' + esc2(typeName) + '</p>' +
          '<div class="form-group"><label class="form-label">Reason</label>' +
            '<select id="custV2RevokeReason" class="form-input" style="width:100%;">' + optsHtml + '</select></div>' +
          '<div class="form-group" style="margin-top:10px;"><label class="form-label">Note (optional)</label>' +
            '<textarea id="custV2RevokeNote" class="form-input" rows="2" style="width:100%;resize:vertical;" placeholder="Visible in the cert history"></textarea></div>' +
          '<p style="color:var(--warm-gray);font-size:0.78rem;margin-top:10px;">The certification stays on the record as <strong>revoked</strong> — it is not deleted, so the history is preserved.</p>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button class="btn btn-danger" id="custV2RevokeBtn" onclick="CustomersV2.revokeCertConfirm(\'' + esc2(id) + '\',\'' + esc2(certId) + '\')">Revoke</button>' +
        '</div>';
      if (typeof openModal === 'function') openModal(html);
    },
    revokeCertConfirm: function (id, certId) {
      if (typeof window.can === 'function' && !window.can('customers', 'edit')) {
        if (window.showToast) showToast('You don’t have permission', true); return;
      }
      var reason = (document.getElementById('custV2RevokeReason') || {}).value || 'other';
      var note = (document.getElementById('custV2RevokeNote') || {}).value || '';
      var btn = document.getElementById('custV2RevokeBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Revoking…'; }
      withBridge(function (b) {
        if (!b.revokeCert) { if (window.showToast) showToast('Revoke unavailable', true); if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; } return; }
        Promise.resolve(b.revokeCert(id, certId, { reason: reason, note: note })).then(function () {
          if (typeof closeModal === 'function') closeModal();
          if (window.showToast) showToast('Certification revoked');
          refreshOpen(id);
        }).catch(function (e) {
          if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
          if (window.showToast) showToast('Revoke failed: ' + (e && e.message || e), true);
        });
      });
    },
    open: function (id) {
      // Go through the schema fetch so the linked-contact location + recent
      // orders are loaded before the Party detail renders.
      window.MastEntity.get('customers-v2').fetch(id).then(function (rec) {
        if (rec) window.MastEntity.openRecord('customers-v2', rec, 'read');
      });
    },
    exportCsv: function () { return window.MastEntity.exportRows('customers-v2', visibleRows(), 'all'); },
    // Activity drill dispatcher (PR4) — the V2 successor to V1's
    // customersOpenActivityDrillIn. Orders + contact-interactions drill IN-PANEL via
    // MastEntity.drill (the engine re-renders the open slide-out with the target and
    // pushes a panel-local Back — no route swap, no navigate-then-setTimeout race).
    // Enrollments + CS surfaces have no entity twin yet, so they fall back to a route
    // nav + a guarded deep-open (csOpenThread exists; csOpenReview/csOpenSurveyResponse
    // don't yet — the typeof guard degrades to a plain route nav, exactly as V1).
    openActivity: function (type, id, extra) {
      if (!type) return;
      if (type === 'order') { window.MastEntity.drill('orders-v2', id); return; }
      if (type === 'contact-interaction') { if (id) window.MastEntity.drill('contacts-v2', id); return; }
      if (type === 'enrollment') { if (typeof window.navigateTo === 'function' && id) window.navigateTo('book-detail', { id: id }); return; }
      var route = type === 'ticket' ? 'cs-tickets' : type === 'review' ? 'cs-reviews' : type === 'survey-response' ? 'cs-surveys' : null;
      if (!route) return;
      if (typeof window.navigateTo === 'function') window.navigateTo(route);
      if (!id) return;
      var open = function () {
        if (type === 'ticket' && typeof window.csOpenThread === 'function') window.csOpenThread(id);
        else if (type === 'review' && typeof window.csOpenReview === 'function') window.csOpenReview(id);
        else if (type === 'survey-response' && typeof window.csOpenSurveyResponse === 'function') window.csOpenSurveyResponse(id);
      };
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        MastAdmin.loadModule('customer-service').then(function () { setTimeout(open, 100); }).catch(function () { setTimeout(open, 200); });
      } else { setTimeout(open, 200); }
    }
  };

  MastAdmin.registerModule('customers-v2', {
    routes: {
      'customers-v2': { tab: 'customersV2Tab', setup: function () { ensureTab(); render(); load(); } },
      // Bare #customers route ABSORBED (T6 PR5): customers.js (V1) is deleted, so
      // the twin owns the bare route directly for ALL users (no MAST_V2_ROUTE_MAP
      // remap). Same tab + setup keep it flag-independent (blog-v2/channels-v2/
      // rma-admin precedent).
      'customers': { tab: 'customersV2Tab', setup: function () { ensureTab(); render(); load(); } }
    }
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
