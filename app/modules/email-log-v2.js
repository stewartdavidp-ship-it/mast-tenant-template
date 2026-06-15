/**
 * email-log-v2.js — §1a Flat Record conversion of the legacy `email-log.js`.
 *
 * Legacy `email-log.js` renders the tenant's sent/failed email history as a
 * hand-written sortable table with an inline slide-out detail. This re-hosts
 * that VIEW on the Entity Engine: a MastEntity schema drives the standard list
 * (MastEntity.renderList) and a row click opens a READ-ONLY Faceted Record
 * slide-out (detail.render composing MastUI primitives).
 *
 * Variant (doc 17 §1a): an email log is a send LOG — no governed record lifecycle
 * and no record mutations. It STAYS a read-focused Faceted Record (NO onSave, NO
 * Edit affordance). Two legacy capabilities the first cut dropped are restored
 * here because their absence was a silent V1-only parity gap:
 *
 *   • Resend — a SIDE action (not a record write): it asks the existing
 *     `sendTestEmail` callable to send a fresh test email to the same recipient
 *     (identical to legacy email-log.js resendEmail). RBAC-gated via
 *     can('email-log-v2','edit'), confirm-dialogued (it sends a real email), and
 *     audited via writeAudit. Surfaced on the detail Overview pane.
 *   • Adjustable date range — the first cut HARD-CODED the last 30 days, so older
 *     emails were unviewable in V2. Restored the legacy From/To date pickers plus
 *     the "← Load older 30d" pager (shifts From back 30d). Pure client query.
 *
 * Flag-gated (?ui=1), side-by-side with legacy #email-log; never touches it.
 *
 * Read path mirrors legacy EXACTLY: MastDB.query('emails') ordered by createdAt
 * over the operator-chosen [From, To] window (default last 30 days), bounded by
 * limitToLast (the explicit limit). Sort is client-side (createdAt desc default).
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

  // Status tone for the toned list badge + the slide-out header badge.
  var STATUS_TONE = { sent: 'success', failed: 'danger' };

  var PROVIDER_LABELS = {
    gmail: 'Gmail', sendgrid: 'SendGrid', resend: 'Resend',
    custom: 'Custom', 'mast-managed': 'Mast'
  };
  function providerLabel(p) { return PROVIDER_LABELS[p] || p || '—'; }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : N.date(iso);
  }

  // ── schema (read-only Flat Record) ──────────────────────────────────
  // fields[0] = subject (a real string), so the slide-out title materializes
  // straight off the record (the engine reads record[name], no get()).
  MastEntity.define('email-log-v2', {
    label: 'Email', labelPlural: 'Emails', size: 'lg',
    route: 'email-log-v2',
    recordId: function (e) { return e._key || e.id; },
    fields: [
      { name: 'subject', label: 'Subject', type: 'text', list: true, readOnly: true, group: 'Email',
        get: function (e) { return e.subject || e.to || '(no subject)'; } },
      { name: 'createdAt', label: 'Date', type: 'date', list: true, readOnly: true, group: 'Email' },
      { name: 'to', label: 'Recipient', type: 'text', list: true, readOnly: true, group: 'Email' },
      { name: 'emailType', label: 'Type', type: 'text', list: true, readOnly: true, group: 'Email' },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true, group: 'Email',
        tone: function (v) { return STATUS_TONE[String(v || '').toLowerCase()] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      // Read-focused Faceted Record — tiles + Overview/Content facets. NO edit
      // (a send-log row is immutable). Composes MastUI primitives only. The
      // Overview pane carries a Resend SIDE action (RBAC-gated, confirm + audit
      // in EmailLogV2.resend) — that's a CF call, not a record mutation, so the
      // read-only model holds (no onSave, no Edit button).
      render: function (UI, e) {
        var status = e.status || 'unknown';
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(status, STATUS_TONE[String(status).toLowerCase()] || 'neutral'), hero: true },
          { k: 'Type', v: esc(e.emailType || '—') },
          { k: 'Provider', v: esc(providerLabel(e.provider)) },
          { k: 'Sent', v: e.createdAt ? fmtDate(e.createdAt) : '—' }
        ]);
        var hasContent = !!(e.htmlSnapshot || e.error);
        var facets = [{ key: 'ov', label: 'Overview' }];
        if (hasContent) facets.push({ key: 'content', label: e.error ? 'Error' : 'Body' });
        var tabsBar = UI.paneTabsBar(facets, 'ov');

        var overview = UI.kv([
          { k: 'To', v: esc(e.to || '—') },
          { k: 'From', v: esc(e.from || '—') },
          { k: 'Subject', v: esc(e.subject || '(no subject)') },
          { k: 'Status', v: UI.badge(status, STATUS_TONE[String(status).toLowerCase()] || 'neutral') },
          { k: 'Type', v: esc(e.emailType || '—') },
          { k: 'Provider', v: esc(providerLabel(e.provider)) },
          { k: 'Sent', v: e.createdAt ? fmtDate(e.createdAt) : '—' }
        ]);
        var meta = [];
        if (e.orderId) meta.push({ k: 'Order ID', v: esc(e.orderId) });
        if (e.tokenCost != null) meta.push({ k: 'Token Cost', v: N.count(e.tokenCost) || '0' });
        var metaCard = meta.length ? UI.card('Metadata', UI.kv(meta)) : '';

        // Resend — a side action (not a record write). Mirrors legacy
        // email-log.js resendEmail: re-sends a test email to the same recipient
        // via the existing `sendTestEmail` callable. Shown only when there is a
        // recipient AND the operator can edit this surface (RBAC). The actual
        // send is confirm-gated + audited in EmailLogV2.resend().
        var canResend = (typeof window.can !== 'function') || window.can('email-log-v2', 'edit');
        var resendCard = '';
        if (e.to && canResend) {
          var rk = e._key || e.id || '';
          resendCard = UI.card('Actions',
            '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 10px;">' +
              'Send a fresh test email to ' + esc(e.to) + ' to confirm delivery is working.</p>' +
            '<button class="btn btn-secondary" onclick="EmailLogV2.resend(\'' + esc(rk) + '\')">↻ Resend test email</button>');
        }

        var ovPane = '<div class="mu-pane" data-pane="ov">' +
          UI.card('Overview', overview) + metaCard + resendCard + '</div>';

        var contentPane = '';
        if (hasContent) {
          var inner;
          if (e.error) {
            inner = UI.kv([{ k: 'Error', v: esc(e.error) }]);
          } else {
            // Sandboxed preview of the captured HTML snapshot (light theme — the
            // email was designed for an email client, not the admin shell).
            inner = '<div style="background:var(--surface-card,rgba(255,255,255,0.9));border-radius:8px;overflow:hidden;max-height:480px;">' +
              '<iframe sandbox="" srcdoc="' + escAttr(e.htmlSnapshot) + '" ' +
              'style="width:100%;min-height:300px;max-height:480px;border:none;display:block;" ' +
              'onload="try{if(this.contentDocument&amp;&amp;this.contentDocument.body)this.style.height=Math.min(this.contentDocument.body.scrollHeight+20,480)+\'px\';}catch(err){}"></iframe>' +
              '</div>';
          }
          contentPane = '<div class="mu-pane" data-pane="content" hidden>' +
            UI.card(e.error ? 'Error' : 'Body', inner) + '</div>';
        }

        return tiles + tabsBar + ovPane + contentPane;
      }
    }
    // No onSave → no Edit button (a send log is read-only).
  });

  // escAttr — srcdoc attribute escaping for the sandboxed HTML preview.
  function escAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── module state + data ─────────────────────────────────────────────
  // Date window mirrors legacy: operator picks From/To; we fetch every email in
  // that window up to EMAIL_LIMIT. Default is last 30 days. `dateFrom`/`dateTo`
  // are the live bounds (re-fetch on change); `hitCap` flags a window that
  // matched more than EMAIL_LIMIT (narrow the dates to see all).
  var EMAIL_LIMIT = 500;

  function _todayDate() { return new Date().toISOString().slice(0, 10); }
  function _defaultFromDate() { var d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); }

  var V2 = {
    rows: [], byId: {}, sortKey: 'createdAt', sortDir: 'desc', filter: 'all', q: '',
    loaded: false, loading: false, hitCap: false,
    dateFrom: _defaultFromDate(), dateTo: _todayDate()
  };

  function _fmtRange(from, to) {
    function f(s) {
      try {
        var d = new Date(s + 'T00:00:00Z');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      } catch (e) { return s; }
    }
    return f(from) + ' → ' + f(to);
  }

  function load() {
    // Date-range query, mirrored EXACTLY from legacy email-log.js loadEmails():
    // MastDB.query('emails') ordered by createdAt over [dateFrom 00:00Z,
    // dateTo 23:59:59.999Z], bounded by limitToLast (the explicit { limit } below).
    // We over-fetch by 1 to detect the cap. One-shot .once('value') read (no live
    // listener); we sort client-side (createdAt desc default).
    V2.loading = true; render();
    var startIso = V2.dateFrom + 'T00:00:00.000Z';
    var endIso = V2.dateTo + 'T23:59:59.999Z';
    var limit = EMAIL_LIMIT + 1; // { limit: EMAIL_LIMIT + 1 } — bounded read (lint-unbounded-read); +1 detects the cap
    var query = MastDB.query('emails').orderByChild('createdAt')
      .startAt(startIso).endAt(endIso).limitToLast(limit);
    Promise.resolve(query.once('value')).then(function (snap) {
      var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      val = val || {};
      var out = [];
      Object.keys(val).forEach(function (k) {
        var e = val[k];
        if (!e || typeof e !== 'object') return;
        var r = Object.assign({ _key: k }, e);
        out.push(r);
      });
      V2.hitCap = out.length > EMAIL_LIMIT;
      if (V2.hitCap) {
        // Drop the oldest overflow row — keep the newest EMAIL_LIMIT.
        out.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
        out = out.slice(0, EMAIL_LIMIT);
      }
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; V2.loading = false; render();
    }).catch(function (err) {
      console.error('[email-log-v2] load', err);
      V2.loaded = true; V2.loading = false; render();
      if (window.showToast) showToast('Failed to load email log: ' + (err && err.message || err), true);
    });
  }

  function statusCounts() {
    var c = { all: V2.rows.length, sent: 0, failed: 0 };
    V2.rows.forEach(function (e) {
      var s = String(e.status || '').toLowerCase();
      if (s === 'sent') c.sent++; else if (s === 'failed') c.failed++;
    });
    return c;
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.filter && V2.filter !== 'all') {
      rows = rows.filter(function (e) { return String(e.status || '').toLowerCase() === V2.filter; });
    }
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (e) {
        return String(e.subject || '').toLowerCase().indexOf(q) >= 0 ||
               String(e.to || '').toLowerCase().indexOf(q) >= 0 ||
               String(e.emailType || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('email-log-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('emailLogV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'emailLogV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var counts = statusCounts();
    var pills = ['all', 'sent', 'failed'].map(function (s) {
      var on = V2.filter === s;
      return '<button onclick="EmailLogV2.setFilter(\'' + s + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        s.charAt(0).toUpperCase() + s.slice(1) + ' <span style="color:var(--warm-gray);">' + (counts[s] || 0) + '</span></button>';
    }).join('');

    // Date-range controls — the primary fetch window. Changing either bound
    // re-fetches; "← Load older 30d" shifts From back 30 days. Inputs are
    // disabled mid-fetch to avoid back-pressure on Firebase. A cap chip warns
    // when the window matched more than EMAIL_LIMIT (narrow the dates to see all).
    var dis = V2.loading ? ' disabled' : '';
    var dInp = 'padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;font-family:inherit;background:transparent;color:var(--text-primary);';
    var capChip = V2.hitCap
      ? '<span title="This window matched more than ' + EMAIL_LIMIT + ' emails — narrow the dates to see them all." style="font-size:0.78rem;color:var(--amber);border:1px solid var(--border);border-radius:10px;padding:2px 8px;">capped at ' + EMAIL_LIMIT + '</span>'
      : '';
    var loadOlderLabel = V2.loading ? 'Loading…' : '← Load older 30d';
    var dateBar =
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:14px 0;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);">From</label>' +
        '<input type="date" value="' + esc(V2.dateFrom) + '" max="' + esc(V2.dateTo) + '" onchange="EmailLogV2.setDateFrom(this.value)"' + dis + ' style="' + dInp + '">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);">To</label>' +
        '<input type="date" value="' + esc(V2.dateTo) + '" min="' + esc(V2.dateFrom) + '" max="' + esc(_todayDate()) + '" onchange="EmailLogV2.setDateTo(this.value)"' + dis + ' style="' + dInp + '">' +
        '<button class="btn btn-secondary" onclick="EmailLogV2.loadOlder()"' + dis + ' style="font-size:0.85rem;padding:6px 12px;">' + esc(loadOlderLabel) + '</button>' +
        '<button class="btn btn-secondary" onclick="EmailLogV2.refresh()"' + dis + ' style="font-size:0.85rem;padding:6px 12px;">↻ Refresh</button>' +
        '<span style="font-size:0.85rem;color:var(--warm-gray);">' + esc(_fmtRange(V2.dateFrom, V2.dateTo)) + '</span>' +
        capChip +
      '</div>';

    var emptyMsg = V2.loading
      ? 'Loading…'
      : (V2.filter !== 'all' || V2.q)
        ? 'No emails match these filters in this date range.'
        : 'No emails in this date range. Widen the dates or click "← Load older 30d".';

    tab.innerHTML =
      U.pageHeader({
        title: 'Email history',
        count: N.count(V2.rows.length) + ' emails',
        actionsHtml: '<button class="btn btn-secondary" onclick="EmailLogV2.exportCsv()">↓ Export</button>'
      }) +
      dateBar +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search subject, recipient, type…" value="' + esc(V2.q) +
        '" oninput="EmailLogV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('email-log-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'EmailLogV2.sort', onRowClickFnName: 'EmailLogV2.open',
        empty: { title: 'No emails', message: emptyMsg }
      });
  }

  // ── public handlers (referenced by engine-rendered HTML) ────────────
  window.EmailLogV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'createdAt' ? 'desc' : 'asc'); }
      render();
    },
    setFilter: function (s) { V2.filter = s; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('email-log-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('email-log-v2', rec, 'read');
      });
    },
    exportCsv: function () { return MastEntity.exportRows('email-log-v2', visibleRows(), V2.filter); },

    // ── date-range / pager (pure client query; mirrors legacy) ─────────
    setDateFrom: function (v) { if (V2.loading) return; V2.dateFrom = v || _defaultFromDate(); load(); },
    setDateTo: function (v) { if (V2.loading) return; V2.dateTo = v || _todayDate(); load(); },
    loadOlder: function () {
      // "← Load older 30d" — shift the From bound back 30 days and re-fetch,
      // so the operator can widen backwards without picking a new date.
      if (V2.loading) return;
      var d = new Date(V2.dateFrom + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - 30);
      V2.dateFrom = d.toISOString().slice(0, 10);
      load();
    },
    refresh: function () { if (V2.loading) return; load(); },

    // ── Resend (side action — re-sends a test email via sendTestEmail) ──
    // Mirrors legacy email-log.js resendEmail EXACTLY: confirm → existing
    // `sendTestEmail` callable with { toEmail } → toast → refresh. RBAC-gated
    // (can('email-log-v2','edit')) and audited (writeAudit). NOT a record write
    // (the log row is immutable); the CF writes its own new 'sent' log entry.
    resend: function (key) {
      var email = V2.byId[key];
      if (!email) return;
      if (typeof window.can === 'function' && !window.can('email-log-v2', 'edit')) {
        if (window.showToast) showToast('You do not have permission to resend emails.', true);
        return;
      }
      if (!email.to) {
        if (window.showToast) showToast('No recipient address on this email.', true);
        return;
      }
      if (!window.firebase || !firebase.functions) {
        if (window.showToast) showToast('Email sending is unavailable right now.', true);
        return;
      }
      var ask = (typeof window.mastConfirm === 'function')
        ? window.mastConfirm('Send a test email to ' + email.to + '? This sends a real email.', { title: 'Resend Email', confirmLabel: 'Send' })
        : Promise.resolve(true);
      Promise.resolve(ask).then(function (ok) {
        if (!ok) return;
        return firebase.functions().httpsCallable('sendTestEmail')({ toEmail: email.to }).then(function (result) {
          var sentTo = (result && result.data && result.data.sentTo) || email.to;
          if (window.writeAudit) writeAudit('resend', 'email', key, { to: email.to, emailType: email.emailType || null, via: 'sendTestEmail' });
          if (window.showToast) showToast('Email resent to ' + sentTo);
          // Reload after a beat so the new 'sent' log entry appears in range.
          setTimeout(function () { if (!V2.loading) load(); }, 1000);
        });
      }).catch(function (err) {
        if (window.showToast) showToast('Resend failed: ' + (err && err.message || err), true);
      });
    }
  };

  // ── register the side-by-side route ─────────────────────────────────
  MastAdmin.registerModule('email-log-v2', {
    routes: { 'email-log-v2': { tab: 'emailLogV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
