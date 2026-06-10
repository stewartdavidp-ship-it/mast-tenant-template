/**
 * cs-support-v2.js — ONE support-conversation hub (CS Wave 1,
 * docs/ux-audit/customer-service-v2-build-plan.md — the Inbox+Tickets merge).
 *
 * Legacy customer-service.js already serves cs-inbox and cs-tickets from the
 * SAME ticketsData and renderer — Inbox is just a "not resolved/closed" filter.
 * This module makes that real at the V2 layer: one queue page serves BOTH
 * routes (#cs-inbox-v2, #cs-tickets-v2); the route picks the entry lens
 * (Needs reply / All conversations — fulfillment-v2 / finance-openitems-v2
 * precedent). Supersedes the pre-standard cs-tickets-v2.js twin.
 *
 * Plain-language naming (operator directive): page is "Customer Messages",
 * a record is a Conversation (the ticket # stays as the reference number),
 * status labels read as owner vocabulary — stored status VALUES are unchanged
 * (open/in_progress/waiting/resolved/closed): finance cost-to-serve and the
 * engagement inbox read them raw.
 *
 * Writes ALL delegate to the state-free CsTicketsBridge cores on
 * customer-service.js (create w/ ticket-number mint, reply append, setField) —
 * nothing re-implemented here. Replies do NOT email the customer (V1 parity).
 * Flag-gated (?ui=1); legacy #cs-inbox / #cs-tickets untouched.
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
  function can(route, axis) { return (typeof window.can === 'function') ? window.can(route, axis) : true; }
  function bridge() { return window.CsTicketsBridge; }

  // Stored status VALUES are load-bearing (finance cost-to-serve reads them
  // raw); only the LABELS are owner vocabulary.
  var STATUS_LABELS = { open: 'Open', in_progress: 'Working on it', waiting: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed' };
  var STATUS_TONE = { open: 'info', in_progress: 'amber', waiting: 'neutral', resolved: 'success', closed: 'neutral' };
  var PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
  var CATEGORIES = [
    { value: '', label: '— Uncategorized —' }, { value: 'shipping', label: 'Shipping' }, { value: 'product-defect', label: 'Product defect' },
    { value: 'billing', label: 'Billing' }, { value: 'general-question', label: 'General question' }, { value: 'custom-order', label: 'Custom order' },
    { value: 'returns', label: 'Returns' }, { value: 'feedback', label: 'Feedback' }, { value: 'other', label: 'Other' }
  ];
  var SOURCES = [
    { value: 'manual', label: 'In person / phone' }, { value: 'email', label: 'Email' }, { value: 'inquiry', label: 'Website inquiry' }
  ];
  function isDone(t) { var s = t.status || 'open'; return s === 'resolved' || s === 'closed'; }
  function ticketNum(t) { return t.ticketNumber || ('#' + String(t.id || '').slice(-6)); }

  var V2 = { lens: 'inbox', rows: [], byId: {}, sortKey: 'updated', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false, _openId: null };

  // ── Entities ──────────────────────────────────────────────────────────────
  function defineEntities() {
    if (MastEntity.get('cs-support-v2')) return;

    // The conversation record: interactive read interior (thread + composer +
    // inline controls) — no onSave, so no Edit button (intake is separate).
    MastEntity.define('cs-support-v2', {
      label: 'Conversation', labelPlural: 'Conversations', size: 'xl',
      route: 'cs-support-v2',
      recordId: function (t) { return t.id; },
      fields: [
        { name: 'subject', label: 'Subject', type: 'text', list: true, readOnly: true, group: 'Conversation', get: function (t) { return t.subject || 'No subject'; } },
        { name: 'ticketNumber', label: 'Ref #', type: 'text', list: true, readOnly: true, get: function (t) { return ticketNum(t); } },
        { name: 'from', label: 'From', type: 'text', list: true, readOnly: true, get: function (t) { return t.contactName || t.contactEmail || 'Unknown'; } },
        { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
          options: Object.keys(STATUS_LABELS), get: function (t) { return t.status || 'open'; },
          format: function (v) { return STATUS_LABELS[v] || v; },
          tone: function (v) { return STATUS_TONE[v] || 'neutral'; } },
        { name: 'priority', label: 'Priority', type: 'text', list: true, readOnly: true, get: function (t) { return PRIORITY_LABELS[t.priority] || t.priority || '—'; } },
        { name: 'updated', label: 'Updated', type: 'date', list: true, readOnly: true, get: function (t) { return t.updatedAt || t.createdAt || null; } }
      ],
      fetch: function (id) {
        // Cold-drill safe: re-read the ticket (incl. nested messages map).
        return ensureLoaded().then(function () {
          return Promise.resolve(MastDB.get('cs_tickets/' + id)).then(function (t) {
            if (!t) return V2.byId[id] || null;
            t = prepThread(Object.assign({ id: id }, t));
            V2.byId[id] = t;
            return t;
          });
        }).catch(function () { return V2.byId[id] || null; });
      },
      detail: {
        // Engine convention: custom read interior is render(MastUI, record).
        render: function (_U, t) {
          var canEdit = can('cs-tickets', 'edit');
          var sel = 'font-size:0.85rem;padding:4px 8px;background:var(--surface-card);border:1px solid var(--border,rgba(127,127,127,.2));border-radius:4px;color:var(--text,var(--charcoal));';
          function opts(map, cur) { return Object.keys(map).map(function (k) { return '<option value="' + esc(k) + '"' + (cur === k ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); }
          var controls = canEdit
            ? '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<select onchange="CsSupportV2.setField(\'status\',this.value)" style="' + sel + '">' + opts(STATUS_LABELS, t.status || 'open') + '</select>' +
              '<select onchange="CsSupportV2.setField(\'priority\',this.value)" style="' + sel + '">' + opts(PRIORITY_LABELS, t.priority || 'normal') + '</select>' +
              '<select onchange="CsSupportV2.setField(\'category\',this.value)" style="' + sel + '" title="Root-cause category">' +
                CATEGORIES.map(function (c) { return '<option value="' + esc(c.value) + '"' + ((t.category || '') === c.value ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select>' +
              '</div>'
            : U.badge(STATUS_LABELS[t.status || 'open'] || t.status, STATUS_TONE[t.status || 'open'] || 'neutral');

          var who = esc(t.contactName || t.contactEmail || 'Unknown') + (t.contactEmail && t.contactName ? ' (' + esc(t.contactEmail) + ')' : '');
          if (t.customerId) {
            who = '<a href="javascript:void(0)" onclick="CsSupportV2.openCustomer(\'' + esc(t.customerId) + '\')" style="color:var(--teal);">' + who + '</a>';
          }
          var headline = U.kv([
            { k: 'From', v: who },
            { k: 'Started', v: t.createdAt ? N.date(t.createdAt) : '—' },
            { k: 'Came in via', v: esc((SOURCES.filter(function (s) { return s.value === t.source; })[0] || {}).label || t.source || '—') },
            { k: 'Controls', v: controls }
          ]);

          var msgs = t._messages || [];
          var bubbles = msgs.length ? msgs.map(bubble).join('') : '<div class="mu-sub" style="text-align:center;padding:24px 0;">No messages yet.</div>';
          var thread = '<div id="csV2Thread" style="display:flex;flex-direction:column;gap:10px;max-height:46vh;overflow-y:auto;padding:4px;">' + bubbles + '</div>';

          var composer = canEdit
            ? '<div style="border:1px solid var(--border,rgba(127,127,127,.2));border-radius:8px;background:var(--surface-card);overflow:hidden;margin-top:12px;">' +
                '<textarea id="csV2Reply" rows="3" placeholder="Write a reply…" style="width:100%;padding:10px 14px;background:transparent;border:none;color:var(--text,var(--charcoal));font-size:0.85rem;resize:vertical;outline:none;box-sizing:border-box;"></textarea>' +
                '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-top:1px solid var(--border,rgba(127,127,127,.2));">' +
                  '<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--warm-gray);cursor:pointer;"><input type="checkbox" id="csV2Internal"> Internal note</label>' +
                  '<button class="btn btn-primary btn-small" onclick="CsSupportV2.sendReply(\'' + esc(t.id) + '\')">Send Reply</button>' +
                '</div>' +
              '</div>'
            : '';

          return U.card('Conversation ' + esc(ticketNum(t)), headline) + U.cardTable('Messages (' + msgs.length + ')', thread + composer);
        }
      }
    });

    // Create-only intake (commission-intake pattern): keeps the thread SO free
    // of an Edit button while giving CREATE a standard engine form.
    MastEntity.define('cs-support-new-v2', {
      label: 'Conversation', size: 'md',
      recordId: function (r) { return r.id || '_new'; },
      fields: [
        { name: 'subject', label: 'Subject', required: true, group: 'Conversation' },
        { name: 'contactName', label: 'Customer name', group: 'Customer' },
        { name: 'contactEmail', label: 'Customer email', required: true, group: 'Customer' },
        { name: 'source', label: 'Came in via', type: 'select', options: SOURCES, group: 'Conversation' },
        { name: 'priority', label: 'Priority', type: 'select', options: Object.keys(PRIORITY_LABELS).map(function (k) { return { value: k, label: PRIORITY_LABELS[k] }; }), group: 'Conversation' },
        { name: 'firstMessage', label: 'First message (what the customer said)', type: 'textarea', group: 'Conversation' }
      ],
      onSave: function (rec) {
        if (!can('cs-tickets', 'edit')) { showToast('Support write access required.', true); return false; }
        if (!rec.subject || !rec.subject.trim()) { showToast('Subject is required', true); return false; }
        var email = (rec.contactEmail || '').trim();
        if (!email || email.indexOf('@') < 1) { showToast('A valid customer email is required', true); return false; }
        return bridge().createTicket({
          subject: rec.subject.trim(),
          contactEmail: email,
          contactName: (rec.contactName || '').trim() || null,
          source: rec.source || 'manual',
          priority: rec.priority || 'normal',
          firstMessage: (rec.firstMessage || '').trim() || null
        }).then(function (t) {
          showToast('Conversation ' + t.ticketNumber + ' started');
          return load().then(function () { openThread(t.id); return true; });
        }).catch(function (err) { showToast('Create failed: ' + (err.message || err), true); return false; });
      }
    });
  }

  function prepThread(t) {
    t._messages = t.messages ? Object.values(t.messages).sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); }) : [];
    return t;
  }

  function bubble(msg) {
    var isOut = msg.direction === 'outbound', isInt = !!msg.isInternal;
    var wrap, box;
    if (isInt) { wrap = 'align-self:center;width:88%;'; box = 'background:rgba(91,33,182,0.12);border:1px solid rgba(91,33,182,0.3);border-radius:8px;padding:10px 14px;'; }
    else if (isOut) { wrap = 'align-self:flex-end;max-width:74%;'; box = 'background:rgba(30,64,175,0.18);border:1px solid rgba(30,64,175,0.3);border-radius:8px 0 8px 8px;padding:10px 14px;'; }
    else { wrap = 'align-self:flex-start;max-width:74%;'; box = 'background:var(--surface-card);border:1px solid var(--border,rgba(127,127,127,.2));border-radius:0 8px 8px 8px;padding:10px 14px;'; }
    return '<div style="' + wrap + '">' +
      (isInt ? '<div style="font-size:0.72rem;color:var(--warm-gray);text-align:center;margin-bottom:4px;font-style:italic;">— Internal Note —</div>' : '') +
      '<div style="' + box + '">' +
        '<div style="white-space:pre-wrap;font-size:0.85rem;word-break:break-word;">' + esc(msg.body || '') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">' +
          '<span style="font-size:0.72rem;color:var(--warm-gray);">' + esc(msg.authorName || msg.fromName || msg.authorEmail || msg.fromEmail || (isOut ? 'You' : 'Customer')) + '</span>' +
          '<span style="font-size:0.72rem;color:var(--warm-gray);">' + (msg.createdAt ? esc(N.date(msg.createdAt)) : '') + '</span>' +
        '</div>' +
      '</div></div>';
  }

  // ── Load (run-once gate so cold drills get module state) ─────────────────
  var _loaded = null;
  function ensureLoaded() {
    if (_loaded) return _loaded;
    // The bridge lives on the legacy module — load it first (sequentially).
    _loaded = MastAdmin.loadModule('customer-service').then(function () {
      return Promise.resolve(MastDB.get('cs_tickets'));
    }).then(function (val) {
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var t = val[k];
        if (t && typeof t === 'object') out.push(prepThread(Object.assign({ id: k }, t)));
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.id] = r; });
      V2.loaded = true;
      return true;
    });
    return _loaded;
  }
  function load() {
    _loaded = null;
    return ensureLoaded().then(render).catch(function (e) { console.error('[cs-support-v2] load', e); render(); });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function ensureTab() {
    var el = document.getElementById('csSupportV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'csSupportV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.lens === 'inbox') rows = rows.filter(function (t) { return !isDone(t); });
    else if (V2.statusFilter !== 'all') rows = rows.filter(function (t) { return (t.status || 'open') === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (t) {
        return String(t.subject || '').toLowerCase().indexOf(q) >= 0 ||
               String(t.contactName || '').toLowerCase().indexOf(q) >= 0 ||
               String(t.contactEmail || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('cs-support-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function pills(items, activeKey, fnName) {
    return items.map(function (p) {
      var on = activeKey === p[0];
      return '<button onclick="' + fnName + '(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + (p[2] != null ? ' <span style="color:var(--warm-gray);">' + p[2] + '</span>' : '') + '</button>';
    }).join('');
  }

  function render() {
    var tab = ensureTab();
    var needsReply = V2.rows.filter(function (t) { return !isDone(t); }).length;

    var lensPills = pills([
      ['inbox', 'Needs reply', needsReply],
      ['all', 'All conversations', V2.rows.length]
    ], V2.lens, 'CsSupportV2.setLens');

    var statusPills = V2.lens === 'all'
      ? pills([['all', 'All']].concat(Object.keys(STATUS_LABELS).map(function (k) {
          return [k, STATUS_LABELS[k], V2.rows.filter(function (t) { return (t.status || 'open') === k; }).length];
        })), V2.statusFilter, 'CsSupportV2.filter')
      : '';

    var actions = '<button class="btn btn-secondary" onclick="CsSupportV2.exportCsv()">↓ Export</button>';
    if (can('cs-tickets', 'edit')) {
      actions = '<button class="btn btn-primary" onclick="CsSupportV2.newConversation()">+ New conversation</button>' + actions;
    }

    tab.innerHTML =
      U.pageHeader({
        title: 'Customer Messages',
        count: N.count(needsReply) + ' need' + (needsReply === 1 ? 's' : '') + ' a reply · ' + N.count(V2.rows.length) + ' total',
        actionsHtml: actions
      }) +
      '<div style="margin:14px 0 6px;">' + lensPills + '</div>' +
      (statusPills ? '<div style="margin:0 0 10px;">' + statusPills + '</div>' : '') +
      '<div style="margin:10px 0 14px;"><input class="form-input" placeholder="Search subject or customer…" value="' + esc(V2.q) +
        '" oninput="CsSupportV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('cs-support-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CsSupportV2.sort', onRowClickFnName: 'CsSupportV2.open',
        empty: V2.lens === 'inbox'
          ? { title: 'Inbox zero', message: V2.loaded ? 'No conversations waiting on you.' : 'Loading…' }
          : { title: 'No conversations', message: V2.loaded ? 'No conversations match this filter.' : 'Loading…' }
      });
  }

  function openThread(id) {
    V2._openId = id;
    return MastEntity.get('cs-support-v2').fetch(id).then(function (rec) {
      if (rec) {
        MastEntity.openRecord('cs-support-v2', rec, 'read');
        setTimeout(function () { var el = document.getElementById('csV2Thread'); if (el) el.scrollTop = el.scrollHeight; }, 60);
      }
      return rec;
    });
  }
  function reopen(id) { return openThread(id).then(function () { return ensureLoadedRefresh(); }); }
  function ensureLoadedRefresh() { _loaded = null; return ensureLoaded().then(render); }

  // ── Handlers ──────────────────────────────────────────────────────────────
  window.CsSupportV2 = {
    setLens: function (l) { V2.lens = l; V2.statusFilter = 'all'; render(); },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'updated' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) { openThread(id); },
    openCustomer: function (cid) {
      if (!cid) return;
      MastAdmin.loadModule('customers-v2').then(function () {
        MastEntity.drill('customers-v2', cid);
      }).catch(function (e) { console.error('[cs-support-v2] openCustomer', e); });
    },
    newConversation: function () {
      if (!can('cs-tickets', 'edit')) { showToast('Support write access required.', true); return; }
      MastEntity.openRecord('cs-support-new-v2', { source: 'manual', priority: 'normal' }, 'create');
    },
    setField: function (field, value) {
      if (!can('cs-tickets', 'edit')) { showToast('Support write access required.', true); return; }
      var id = V2._openId;
      if (!id) return;
      bridge().setField(id, field, value).then(function () {
        if (window.showToast) showToast(field === 'status' ? 'Status updated' : field === 'priority' ? 'Priority updated' : 'Category updated');
        reopen(id);
      }).catch(function (e) { console.error('[cs-support-v2] setField', e); if (window.showToast) showToast('Update failed', true); });
    },
    sendReply: function (id) {
      if (!can('cs-tickets', 'edit')) { showToast('Support write access required.', true); return; }
      if (V2._busy) return;
      var ta = document.getElementById('csV2Reply'); var body = ta ? ta.value.trim() : '';
      if (!body) { if (window.showToast) showToast('Reply cannot be empty', true); return; }
      var internal = !!(document.getElementById('csV2Internal') || {}).checked;
      V2._busy = true;
      bridge().reply(id, body, { isInternal: internal }).then(function () {
        if (window.showToast) showToast(internal ? 'Note added' : 'Reply sent');
        V2._busy = false; reopen(id);
      }).catch(function (e) { V2._busy = false; console.error('[cs-support-v2] sendReply', e); if (window.showToast) showToast('Failed to send', true); });
    },
    exportCsv: function () { return MastEntity.exportRows('cs-support-v2', visibleRows(), 'all'); }
  };

  // Both routes land in the SAME hub; the route picks the entry lens.
  function setupFor(lens) {
    return function () {
      ensureTab();
      V2.lens = lens; V2.statusFilter = 'all';
      defineEntities();
      load();
    };
  }
  MastAdmin.registerModule('cs-support-v2', {
    routes: {
      'cs-inbox-v2': { tab: 'csSupportV2Tab', setup: setupFor('inbox') },
      'cs-tickets-v2': { tab: 'csSupportV2Tab', setup: setupFor('all') }
    }
  });
})();
