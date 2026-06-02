/**
 * inquiries-v2.js — read-focused Faceted Record twin of the legacy Inquiries
 * surface (contact-form submissions / leads) — doc 17 §11/§12 conversion playbook.
 *
 * Legacy: renderInquiriesAdmin() in app/index.html (#inquiries route → inquiriesTab)
 * lists web inquiries as a flat table (Name / Type / Message / Status / Received /
 * Respond) and the only detail action is a Respond button that hands off to
 * contacts.js openInquiryResponseModal (an email-composer modal that calls the
 * sendInquiryResponse Cloud Function + flips status to 'responded'). This twin
 * re-hosts that VIEW on the Entity Engine: a schema-driven list + a read-focused
 * Faceted Record slide-out (one Overview facet — identity + the full message).
 *
 * Variant (doc 17 §1a): an inquiry is a message/lead record (who reached out,
 * what they said, and where it stands) with a simple lifecycle attribute, NOT a
 * governed MastFlow lifecycle (no exit checklist, no guarded advance). Its STATUS
 * (new / responded / closed / archived) is the classifier → modelled as the
 * engine's single status-typed field, so it becomes the header badge + a list
 * badge. So → Faceted Record, NOT Process/MastFlow.
 *
 * Read-focused: replying to an inquiry (the email composer) and the status flip
 * are bespoke + side-effect-bearing (a Cloud Function that emails the customer),
 * single-sourced on the legacy Inquiries surface. They stay there via a "manage
 * in classic view" link (navigateToClassic so the V2 route remap doesn't loop
 * back here). This twin re-hosts the VIEW only — no onSave, no edit form, no
 * Respond button. Flag-gated (?ui=1) at #inquiries-v2, side-by-side with the
 * legacy #inquiries; never touches renderInquiriesAdmin / contacts.js.
 *
 * Data: inquiries live at the top-level public collection `inquiries`
 * (MastDB.get('inquiries') → keyed object, one one-shot read, no listener — same
 * path the storefront contact form writes to and renderInquiriesAdmin reads).
 * Verified shape (storefront index.html contact handler):
 *   { id, name, email, phone|null, type, message, status:'new', contactId,
 *     source:'website-contact-form', createdAt } (+ respondedAt once replied).
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

  // Inquiry lifecycle (the classifier). 'new' + 'responded' are the verified live
  // states (storefront writes 'new'; sendInquiryResponse flips to 'responded');
  // closed/archived are terminal states a tenant may set. Tone reads at a glance.
  var STATUS_LABELS = { new: 'New', responded: 'Responded', closed: 'Closed', archived: 'Archived' };
  var STATUS_TONE = { new: 'amber', responded: 'success', closed: 'neutral', archived: 'neutral' };
  function statusOf(q) { return (q && q.status) || 'new'; }
  function statusLabel(v) { return STATUS_LABELS[v] || v || 'New'; }
  function inquiryName(q) { return (q && q.name) || 'Unknown'; }
  // A short single-line preview for the list (legacy truncates the message at 80).
  function messagePreview(q) {
    var m = (q && q.message) || '';
    m = String(m).replace(/\s+/g, ' ').trim();
    if (!m) return '—';
    return m.length > 80 ? m.slice(0, 80) + '…' : m;
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('inquiries-v2', {
    label: 'Inquiry', labelPlural: 'Inquiries', size: 'md',
    route: 'inquiries-v2',
    recordId: function (q) { return q._key || q.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'name', label: 'Name', type: 'text', list: true, readOnly: true, group: 'Inquiry', get: inquiryName },
      { name: 'email', label: 'Email', type: 'text', list: true, readOnly: true, get: function (q) { return q.email || '—'; } },
      { name: 'type', label: 'Type', type: 'text', list: true, readOnly: true, get: function (q) { return q.type || '—'; } },
      // The message preview is the at-a-glance "subject" line for an inquiry
      // (there is no separate subject field — `type` + the message body are it).
      { name: 'message', label: 'Message', type: 'text', list: true, readOnly: true, sortable: false, get: messagePreview },
      { name: 'createdAt', label: 'Received', type: 'date', list: true, readOnly: true, get: function (q) { return q.createdAt || null; } },
      // Status is the inquiry's classifier → the engine's single status field
      // (header badge in detail, badge in the list).
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: Object.keys(STATUS_LABELS), get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, q) {
        var st = statusOf(q);

        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(statusLabel(st), STATUS_TONE[st] || 'neutral'), hero: true },
          { k: 'Type', v: q.type ? esc(q.type) : '—' },
          { k: 'Source', v: q.source ? esc(q.source) : '—' },
          { k: 'Received', v: q.createdAt ? N.date(q.createdAt) : '—' }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }], 'ov');

        // ── Overview — who reached out, where it stands, and the message ──
        var emailV = q.email
          ? '<a href="mailto:' + esc(q.email) + '" style="color:var(--teal,teal);">' + esc(q.email) + '</a>' : '—';
        var phoneV = q.phone
          ? '<a href="tel:' + esc(q.phone) + '" style="color:var(--teal,teal);">' + esc(q.phone) + '</a>' : '—';
        var details = UI.kv([
          { k: 'Name', v: esc(inquiryName(q)) },
          { k: 'Email', v: emailV },
          { k: 'Phone', v: phoneV },
          { k: 'Type', v: q.type ? esc(q.type) : '—' },
          { k: 'Source', v: q.source ? esc(q.source) : '—' },
          { k: 'Status', v: UI.badge(statusLabel(st), STATUS_TONE[st] || 'neutral') },
          { k: 'Received', v: q.createdAt ? N.date(q.createdAt) : '—' },
          { k: 'Responded', v: q.respondedAt ? N.date(q.respondedAt) : '<span class="mu-sub">Not yet</span>' }
        ]);

        var messageBody = q.message
          ? '<div style="font-size:0.9rem;color:var(--charcoal,var(--text));line-height:1.55;white-space:pre-wrap;word-break:break-word;">' + esc(q.message) + '</div>'
          : '<span class="mu-sub">No message.</span>';

        // Replying / status changes stay on the legacy Inquiries surface (the email
        // composer + sendInquiryResponse CF). Point to it read-only.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="InquiriesV2.classic()">Manage in classic view →</button></div>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Inquiry', details) +
            UI.card('Message', messageBody) +
            UI.card('Respond', '<div class="mu-sub">Reply to this inquiry (email the customer) in the classic Inquiries view.</div>' + manage) +
          '</div>';
      }
    }
    // No onSave → no Edit button (replying + status changes stay on legacy #inquiries).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'createdAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // One-shot keyed-object read of the public `inquiries` collection (no listener).
    Promise.resolve(MastDB.get('inquiries')).then(function (val) {
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var q = val[k];
        if (q && typeof q === 'object') { out.push(Object.assign({ _key: (q.id || k) }, q)); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[inquiries-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (q) { return statusOf(q) === V2.statusFilter; });
    if (V2.q) {
      var query = V2.q.toLowerCase();
      rows = rows.filter(function (q) {
        return String(q.name || '').toLowerCase().indexOf(query) >= 0 ||
               String(q.email || '').toLowerCase().indexOf(query) >= 0 ||
               String(q.message || '').toLowerCase().indexOf(query) >= 0 ||
               String(q.type || '').toLowerCase().indexOf(query) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('inquiries-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('inquiriesV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'inquiriesV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var newCount = V2.rows.filter(function (q) { return statusOf(q) === 'new'; }).length;
    var filters = [['all', 'All'], ['new', 'New'], ['responded', 'Responded'], ['closed', 'Closed'], ['archived', 'Archived']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="InquiriesV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Inquiries',
        count: N.count(V2.rows.length) + ' inquir' + (V2.rows.length === 1 ? 'y' : 'ies'),
        subtitle: newCount ? (N.count(newCount) + ' new') : '',
        actionsHtml: '<button class="btn btn-secondary" onclick="InquiriesV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, email or message…" value="' + esc(V2.q) +
        '" oninput="InquiriesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('inquiries-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'InquiriesV2.sort', onRowClickFnName: 'InquiriesV2.open',
        empty: { title: 'No inquiries', message: V2.loaded ? 'No inquiries match this filter.' : 'Loading…' }
      });
  }

  window.InquiriesV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'createdAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('inquiries-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('inquiries-v2', rec, 'read');
      });
    },
    // Replying + status changes → classic Inquiries surface. navigateToClassic so
    // the V2 route remap doesn't loop straight back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('inquiries');
      else if (typeof navigateTo === 'function') navigateTo('inquiries');
    },
    exportCsv: function () { return MastEntity.exportRows('inquiries-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('inquiries-v2', {
    routes: { 'inquiries-v2': { tab: 'inquiriesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
