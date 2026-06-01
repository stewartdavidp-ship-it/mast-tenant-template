/**
 * cs-tickets-v2.js — conversion #7 of the slide-out backlog (doc 17 §11/§12).
 *
 * Legacy customer-service.js shows tickets in a list and swaps the full pane to a
 * thread view (viewMode='thread'). This re-hosts the list + thread on the Entity
 * Engine: a schema-driven list + a slide-out whose interior is a live conversation
 * thread (message bubbles + reply composer + inline status/priority/category
 * controls) — interactive in read mode, like the Resolve micro-surface, no
 * separate edit mode.
 *
 * Variant (doc 17 §1a test): the doc tagged this "Process w/ status lifecycle",
 * but the status is a FREE <select> (csUpdateStatus(value), any status) — not a
 * gated workflow (no exit-checklist, no guarded advance). So → Faceted Record
 * whose primary facet is a thread; status/priority/category are assigned
 * attributes. (5th doc "Process" tag that turned out to be Faceted.)
 *
 * All writes are simple, side-effect-free Firestore writes (verified: a reply
 * appends a message to cs_tickets/{id}/messages and bumps updatedAt — it does NOT
 * email the customer), so the twin replicates them directly. Flag-gated (?ui=1)
 * at #cs-tickets-v2, side-by-side with legacy #cs-tickets; never touches it.
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
  var STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', waiting: 'Waiting', resolved: 'Resolved', closed: 'Closed' };
  var STATUS_TONE = { open: 'info', in_progress: 'amber', waiting: 'neutral', resolved: 'success', closed: 'neutral' };
  var PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
  var PRIORITY_TONE = { low: 'neutral', normal: 'info', high: 'amber', urgent: 'danger' };
  var CATEGORIES = [
    { value: '', label: '— Uncategorized —' }, { value: 'shipping', label: 'Shipping' }, { value: 'product-defect', label: 'Product defect' },
    { value: 'billing', label: 'Billing' }, { value: 'general-question', label: 'General question' }, { value: 'custom-order', label: 'Custom order' },
    { value: 'returns', label: 'Returns' }, { value: 'feedback', label: 'Feedback' }, { value: 'other', label: 'Other' }
  ];
  var CAT_LABEL = {}; CATEGORIES.forEach(function (c) { CAT_LABEL[c.value] = c.label; });

  function relTime(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    return N.date(iso);
  }
  function ticketNum(t) { return t.ticketNumber || ('#' + String(t.id || '').slice(-6)); }

  // ── schema (Faceted Record; thread interior) ────────────────────────
  MastEntity.define('cs-tickets-v2', {
    label: 'Ticket', labelPlural: 'Tickets', size: 'xl',
    route: 'cs-tickets-v2',
    recordId: function (t) { return t.id; },
    fields: [
      { name: 'subject', label: 'Subject', type: 'text', list: true, readOnly: true, group: 'Ticket', get: function (t) { return t.subject || 'No subject'; } },
      { name: 'ticketNumber', label: 'Ticket #', type: 'text', list: true, readOnly: true, get: function (t) { return ticketNum(t); } },
      { name: 'from', label: 'From', type: 'text', list: true, readOnly: true, get: function (t) { return t.contactName || t.contactEmail || 'Unknown'; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: Object.keys(STATUS_LABELS), get: function (t) { return t.status || 'open'; },
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } },
      { name: 'priority', label: 'Priority', type: 'text', list: true, readOnly: true, get: function (t) { return PRIORITY_LABELS[t.priority] || t.priority || '—'; }, tone: function () { return 'neutral'; } },
      { name: 'updated', label: 'Updated', type: 'date', list: true, readOnly: true, get: function (t) { return t.updatedAt || t.createdAt || null; } }
    ],
    fetch: function (id) {
      // Re-read the ticket (incl. its nested messages) so the thread is fresh.
      return Promise.resolve(MastDB.get('cs_tickets/' + id)).then(function (t) {
        if (!t) return V2.byId[id] || null;
        t = Object.assign({ id: id }, t);
        t._messages = t.messages ? Object.values(t.messages).sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); }) : [];
        V2.byId[id] = t;
        return t;
      }).catch(function () { return V2.byId[id] || null; });
    },
    detail: {
      render: function (UI, t) {
        var sel = 'font-size:0.85rem;padding:4px 8px;background:var(--surface-card);border:1px solid var(--border,rgba(127,127,127,.2));border-radius:4px;color:var(--text,var(--charcoal));';
        function opts(map, cur) { return Object.keys(map).map(function (k) { return '<option value="' + esc(k) + '"' + (cur === k ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); }
        var statusSel = '<select onchange="CsTicketsV2.setField(\'status\',this.value)" style="' + sel + '">' + opts(STATUS_LABELS, t.status || 'open') + '</select>';
        var prioSel = '<select onchange="CsTicketsV2.setField(\'priority\',this.value)" style="' + sel + '">' + opts(PRIORITY_LABELS, t.priority || 'normal') + '</select>';
        var catSel = '<select onchange="CsTicketsV2.setField(\'category\',this.value)" style="' + sel + '" title="Root-cause category">' +
          CATEGORIES.map(function (c) { return '<option value="' + esc(c.value) + '"' + ((t.category || '') === c.value ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select>';

        var headline = UI.kv([
          { k: 'From', v: esc((t.contactName || t.contactEmail || 'Unknown')) + (t.contactEmail && t.contactName ? ' (' + esc(t.contactEmail) + ')' : '') },
          { k: 'Created', v: t.createdAt ? N.date(t.createdAt) : '—' },
          { k: 'Source', v: esc(t.source || '—') },
          { k: 'Controls', v: '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + statusSel + prioSel + catSel + '</div>' }
        ]);

        var msgs = t._messages || [];
        var bubbles = msgs.length ? msgs.map(bubble).join('') : '<div class="mu-sub" style="text-align:center;padding:24px 0;">No messages yet.</div>';
        var thread = '<div id="csV2Thread" style="display:flex;flex-direction:column;gap:10px;max-height:46vh;overflow-y:auto;padding:4px;">' + bubbles + '</div>';

        var composer =
          '<div style="border:1px solid var(--border,rgba(127,127,127,.2));border-radius:8px;background:var(--surface-card);overflow:hidden;margin-top:12px;">' +
            '<textarea id="csV2Reply" rows="3" placeholder="Write a reply…" style="width:100%;padding:10px 14px;background:transparent;border:none;color:var(--text,var(--charcoal));font-size:0.85rem;resize:vertical;outline:none;box-sizing:border-box;"></textarea>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-top:1px solid var(--border,rgba(127,127,127,.2));">' +
              '<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--warm-gray);cursor:pointer;"><input type="checkbox" id="csV2Internal"> Internal note</label>' +
              '<button class="btn btn-primary btn-small" onclick="CsTicketsV2.sendReply(\'' + esc(t.id) + '\')">Send Reply</button>' +
            '</div>' +
          '</div>';

        return U.card('Ticket', headline) + U.cardTable('Conversation (' + msgs.length + ')', thread + composer);
      }
    }
    // No onSave: the thread interior mutates inline (status/priority/category +
    // reply) via CsTicketsV2 handlers, then re-opens fresh — no read/edit toggle.
  });

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
          '<span style="font-size:0.72rem;color:var(--warm-gray);">' + esc(msg.authorName || msg.authorEmail || (isOut ? 'You' : 'Customer')) + '</span>' +
          '<span style="font-size:0.72rem;color:var(--warm-gray);">' + esc(relTime(msg.createdAt)) + '</span>' +
        '</div>' +
      '</div></div>';
  }

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'updated', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false, busy: false };

  function load() {
    Promise.resolve(MastDB.get('cs_tickets')).then(function (val) {
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var t = val[k]; if (t && typeof t === 'object') {
          t = Object.assign({ id: k }, t);
          t._messages = t.messages ? Object.values(t.messages).sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); }) : [];
          out.push(t);
        }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.id] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[cs-tickets-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (t) { return (t.status || 'open') === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (t) {
        return String(t.subject || '').toLowerCase().indexOf(q) >= 0 ||
               String(t.contactName || '').toLowerCase().indexOf(q) >= 0 ||
               String(t.contactEmail || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('cs-tickets-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('csTicketsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'csTicketsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var openCount = V2.rows.filter(function (t) { return (t.status || 'open') !== 'closed' && t.status !== 'resolved'; }).length;
    var filters = [['all', 'All'], ['open', 'Open'], ['in_progress', 'In Progress'], ['waiting', 'Waiting'], ['resolved', 'Resolved'], ['closed', 'Closed']]
      .map(function (f) { var on = V2.statusFilter === f[0]; return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="CsTicketsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>'; }).join(' ');
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Tickets</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(openCount) + ' open · ' + N.count(V2.rows.length) + ' total</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="CsTicketsV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search subject or contact…" value="' + esc(V2.q) +
        '" oninput="CsTicketsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('cs-tickets-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CsTicketsV2.sort', onRowClickFnName: 'CsTicketsV2.open',
        empty: { title: 'No tickets', message: V2.loaded ? 'No tickets match this filter.' : 'Loading…' }
      });
  }

  function openTicket(id) {
    V2._openId = id;
    return MastEntity.get('cs-tickets-v2').fetch(id).then(function (rec) {
      if (rec) {
        MastEntity.openRecord('cs-tickets-v2', rec, 'read');
        setTimeout(function () { var el = document.getElementById('csV2Thread'); if (el) el.scrollTop = el.scrollHeight; }, 60);
      }
      return rec;
    });
  }
  function reopen(id) { return openTicket(id).then(function () { load(); }); }   // also refresh the list (status/updated changed)

  window.CsTicketsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'updated' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) { openTicket(id); },
    setField: function (field, value) {
      var id = V2._openId;
      if (!id) return;
      var upd = {}; upd[field] = (field === 'category' && value === '') ? null : value; upd.updatedAt = new Date().toISOString();
      Promise.resolve(MastDB.update('cs_tickets/' + id, upd)).then(function () {
        if (window.writeAudit) writeAudit('update', 'cs-ticket', id);
        if (window.showToast) showToast(field === 'status' ? 'Status updated' : field === 'priority' ? 'Priority updated' : 'Category updated');
        reopen(id);
      }).catch(function (e) { console.error('[cs-tickets-v2] setField', e); if (window.showToast) showToast('Update failed', true); });
    },
    sendReply: function (id) {
      if (V2.busy) return;
      var ta = document.getElementById('csV2Reply'); var body = ta ? ta.value.trim() : '';
      if (!body) { if (window.showToast) showToast('Reply cannot be empty', true); return; }
      var internal = !!(document.getElementById('csV2Internal') || {}).checked;
      V2.busy = true;
      var msgId = 'msg_' + Date.now().toString(36);
      var now = new Date().toISOString();
      var msg = {
        id: msgId, body: body, direction: 'outbound', isInternal: internal,
        authorName: (window.currentUser && currentUser.displayName) || null,
        authorEmail: (window.currentUser && currentUser.email) || null,
        createdAt: now
      };
      Promise.resolve(MastDB.set('cs_tickets/' + id + '/messages/' + msgId, msg))
        .then(function () { return MastDB.update('cs_tickets/' + id, { updatedAt: now }); })
        .then(function () {
          if (window.writeAudit) writeAudit('update', 'cs-ticket', id);
          if (window.showToast) showToast(internal ? 'Note added' : 'Reply sent');
          V2.busy = false; reopen(id);
        }).catch(function (e) { V2.busy = false; console.error('[cs-tickets-v2] sendReply', e); if (window.showToast) showToast('Failed to send', true); });
    },
    exportCsv: function () { return MastEntity.exportRows('cs-tickets-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('cs-tickets-v2', {
    routes: { 'cs-tickets-v2': { tab: 'csTicketsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
