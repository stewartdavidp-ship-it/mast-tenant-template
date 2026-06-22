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
 * Reply (native): the Overview's Respond card hosts an inline email composer
 * (To / Subject / Message + validation). Send DELEGATES to the canonical core
 * ContactsBridge.respondToInquiry (respondToInquiryCore in contacts.js) — the
 * same path contacts-v2 uses — which calls the sendInquiryResponse Cloud Function
 * (emails the customer) and ONLY on a resolved send flips `inquiries/{id}.status`
 * → 'responded' + stamps respondedAt, mirrors the reply onto the contact timeline,
 * audits, and invalidates the contacts cache. On success this twin re-opens the
 * slide-out fresh and refreshes the dashboard new-inquiries card. A thrown CF
 * error (email failed) leaves status untouched and re-enables the button so the
 * operator can retry — the status never gets ahead of an email that didn't go out.
 * This replaces the old read-only "manage in classic view" escape hatch
 * (navigateToClassic) — the twin is now self-sufficient. Status stays a read-only
 * classifier field (no Edit form); the composer is the only mutation. Flag-gated
 * (?ui=1) at #inquiries-v2, side-by-side with the legacy #inquiries; never touches
 * renderInquiriesAdmin / contacts.js.
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
  function emailOf(q) { return (q && q.email) || ''; }

  // RBAC: replying emails a customer + mutates the record, so it's gated. An
  // inquiry is a contact-form lead (carries contactId; the reply also logs a
  // contact interaction) → gate on the `contacts` route (operations section:
  // admin + manager edit) rather than the unmapped `inquiries` route, which
  // would wrongly deny managers. Mirrors the can('<route>','edit') convention.
  function canRespond() { return typeof window.can === 'function' ? window.can('contacts', 'edit') : true; }

  // ── reply composer prefill (mirrors the legacy openInquiryResponseModal
  // template so the operator gets the same head-start; all editable before send).
  function brandName() {
    try {
      var c = window.TENANT_CONFIG || {};
      return (c.brand && c.brand.name) || c.brandName || c.tenantName || c.name || 'our shop';
    } catch (e) { return 'our shop'; }
  }
  function defaultSubject(q) {
    return 'Re: ' + ((q && q.type) || 'your inquiry') + ' — ' + brandName();
  }
  function defaultBody(q) {
    var nm = inquiryName(q), first = (nm && nm !== 'Unknown') ? (nm.split(' ')[0] || 'there') : 'there';
    var brand = brandName();
    var body = 'Hi ' + first + ',\n\n' +
      'Thank you for reaching out to ' + brand + '!\n\n\n\n' +
      'Best regards,\n' + brand;
    if (q && q.message) {
      body += '\n\n---\nOriginal message' + (q.createdAt ? ' (' + String(q.createdAt).slice(0, 10) + ')' : '') + ':\n' + q.message;
    }
    return body;
  }

  // ── schema (Faceted Record; status read-only, reply via composer) ───
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
          ? '<div style="font-size:0.9rem;color:var(--text-primary);line-height:1.55;white-space:pre-wrap;word-break:break-word;">' + esc(q.message) + '</div>'
          : '<span class="mu-sub">No message.</span>';

        // ── Respond — native inline email composer (sendInquiryResponse CF) ──
        var id = q._key || q.id, eid = esc(String(id)), email = emailOf(q);
        var respondInner;
        if (!canRespond()) {
          respondInner = '<div class="mu-sub">' +
            (q.respondedAt ? '✓ Responded on ' + esc(N.date(q.respondedAt)) + '. ' : '') +
            'You don\'t have permission to respond to inquiries.</div>';
        } else if (!email) {
          respondInner = '<div class="mu-sub">No email address on file for this inquiry — a reply can\'t be sent.</div>';
        } else {
          var respondedNote = q.respondedAt
            ? '<div class="mu-sub" style="margin-bottom:10px;">✓ Responded on ' + esc(N.date(q.respondedAt)) + '. You can send another reply.</div>'
            : '<div class="mu-sub" style="margin-bottom:10px;">Reply to ' + esc(email) + ' — emails the customer and marks this inquiry responded.</div>';
          var taStyle = 'font-family:inherit;font-size:0.85rem;line-height:1.5;white-space:pre-wrap;resize:vertical;';
          respondInner =
            respondedNote +
            '<button class="btn btn-primary" id="inqV2ReplyBtn" onclick="InquiriesV2.showComposer()">✉ ' + (q.respondedAt ? 'Reply again' : 'Reply') + '</button>' +
            '<div id="inqV2Composer" style="display:none;margin-top:6px;">' +
              '<div class="form-group"><label>To</label><input class="form-input" value="' + esc(email) + '" readonly style="opacity:0.7;cursor:default;"></div>' +
              '<div class="form-group"><label>Subject</label><input class="form-input" id="inqV2Subject" value="' + esc(defaultSubject(q)) + '"></div>' +
              '<div class="form-group"><label>Message</label><textarea class="form-input" id="inqV2Body" rows="12" style="' + taStyle + '">' + esc(defaultBody(q)) + '</textarea></div>' +
              '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">' +
                '<button class="btn btn-secondary" onclick="InquiriesV2.hideComposer()">Cancel</button>' +
                '<button class="btn btn-primary" id="inqV2SendBtn" onclick="InquiriesV2.send(\'' + eid + '\')">Send response</button>' +
              '</div>' +
            '</div>';
        }

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Inquiry', details) +
            UI.card('Message', messageBody) +
            UI.card('Respond', respondInner) +
          '</div>';
      }
    }
    // No onSave → no Edit form. The only mutation is the reply composer
    // (InquiriesV2.send), which flips status → 'responded' then re-opens fresh.
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'createdAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false, busy: false };

  // The inquiry-reply flow (CF email → status flip → interaction log → cache
  // invalidation → audit) is the canonical core respondToInquiryCore, exposed as
  // window.ContactsBridge.respondToInquiry. We delegate to it (same as contacts-v2)
  // instead of re-implementing the flow inline, so the contacts-cache invalidation
  // and the shared payload/status logic stay in one place. T6: contacts.js retired
  // — the bridge now lives in the non-flag-gated IIFE at the end of contacts-v2.js.
  function withBridge(fn) {
    if (window.ContactsBridge && window.ContactsBridge.respondToInquiry) return fn(window.ContactsBridge);
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
      MastAdmin.loadModule('contacts-v2').then(function () {
        if (window.ContactsBridge && window.ContactsBridge.respondToInquiry) fn(window.ContactsBridge);
        else if (window.showToast) showToast('Contacts engine still loading — try again', true);
      }).catch(function () { if (window.showToast) showToast('Contacts engine unavailable', true); });
    } else if (window.showToast) {
      showToast('Contacts engine unavailable', true);
    }
  }

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
    // Reveal the inline composer; drop the cursor on the blank line between the
    // greeting and the sign-off (matches the legacy modal's caret placement).
    showComposer: function () {
      var c = document.getElementById('inqV2Composer'); if (c) c.style.display = 'block';
      var b = document.getElementById('inqV2ReplyBtn'); if (b) b.style.display = 'none';
      var ta = document.getElementById('inqV2Body');
      if (ta) {
        var pos = ta.value.indexOf('\n\n\n\n');
        ta.focus();
        if (pos > -1) { ta.selectionStart = ta.selectionEnd = pos + 2; }
      }
    },
    hideComposer: function () {
      var c = document.getElementById('inqV2Composer'); if (c) c.style.display = 'none';
      var b = document.getElementById('inqV2ReplyBtn'); if (b) b.style.display = '';
    },
    // Native reply: delegate to the canonical ContactsBridge.respondToInquiry
    // core (CF email → status flip → interaction log → contacts-cache
    // invalidation → audit). Status is flipped only AFTER the CF resolves, so a
    // send failure leaves status untouched. We keep the composer UI, RBAC gate,
    // double-send guard, and pre-send validation here; the flow logic lives once
    // in contacts.js.
    send: function (id) {
      if (V2.busy) return;
      if (!canRespond()) { if (window.showToast) showToast('You do not have permission to respond to inquiries.', true); return; }
      var rec = V2.byId[id]; if (!rec) return;
      var subjEl = document.getElementById('inqV2Subject');
      var bodyEl = document.getElementById('inqV2Body');
      var subject = subjEl ? subjEl.value.trim() : '';
      var body = bodyEl ? bodyEl.value.trim() : '';
      var toEmail = rec.email || '';
      if (!toEmail) { if (window.showToast) showToast('No email address on file for this inquiry.', true); return; }
      if (!subject) { if (window.showToast) showToast('Subject is required.', true); return; }
      if (!body) { if (window.showToast) showToast('Message is required.', true); return; }

      var sendBtn = document.getElementById('inqV2SendBtn');
      function setBtn(disabled, label) { if (sendBtn) { sendBtn.disabled = disabled; sendBtn.textContent = label; } }
      V2.busy = true; setBtn(true, 'Sending…');

      withBridge(function (b) {
        // The core sends the email FIRST and only flips inquiries/{id}.status →
        // 'responded' (+ respondedAt), logs the contact interaction, audits, and
        // invalidates the contacts cache once the CF resolves. It throws on send
        // failure WITHOUT touching status, so we inherit the "never get ahead of
        // an email that didn't go out" guarantee.
        Promise.resolve(b.respondToInquiry(rec.contactId || '', {
          subject: subject,
          body: body,
          toEmail: toEmail,
          inquiryId: id
        })).then(function (data) {
          data = data || {};
          if (window.showToast) showToast(data.skipped === 'email_trigger_disabled'
            ? 'Inquiry-response emails are off in settings — marked responded (no email sent).'
            : 'Response sent to ' + toEmail);
          // reflect locally + re-open fresh + refresh the list badge/sort
          rec.status = 'responded'; rec.respondedAt = new Date().toISOString(); V2.byId[id] = rec;
          V2.busy = false;
          MastEntity.openRecord('inquiries-v2', rec, 'read');
          load();
          // Keep the dashboard "new inquiries" card in sync (the core invalidates
          // the contacts cache for the timeline; the dash card is a caller concern).
          if (typeof renderDashCardNewInquiries === 'function') { try { renderDashCardNewInquiries(); } catch (e) {} }
        }).catch(function (e) {
          // Send failed (or post-send bookkeeping) → status untouched by the core.
          // Re-enable for a retry.
          V2.busy = false; setBtn(false, 'Send response');
          console.error('[inquiries-v2] send', e);
          if (window.showToast) showToast('Failed to send: ' + ((e && e.message) || e), true);
        });
      });
      // If the bridge can't load, withBridge toasts but the button stays disabled;
      // a watchdog re-enables so the operator isn't stranded.
      setTimeout(function () {
        if (V2.busy && !(window.ContactsBridge && window.ContactsBridge.respondToInquiry)) {
          V2.busy = false; setBtn(false, 'Send response');
        }
      }, 8000);
    },
    exportCsv: function () { return MastEntity.exportRows('inquiries-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('inquiries-v2', {
    routes: { 'inquiries-v2': { tab: 'inquiriesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
