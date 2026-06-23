/**
 * newsletter-v2.js — read-focused Flat/Faceted Record twin of the legacy
 * Newsletter SUBSCRIBERS surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy newsletter.js (#newsletter, owned by the Newsletter module) hosts two
 * things: a campaign Composer/Grid Builder (out of scope) and a subscribers
 * list rendered as a wide table (renderNLSubscribers). This twin re-hosts ONLY
 * the subscribers list -> subscriber read detail on the Entity Engine: a
 * schema-driven list + a read-focused Faceted Record slide-out.
 *
 * Variant (doc 17 §1a): a subscriber is a simple person record (email, name,
 * status, source, subscribed date) with NO governed lifecycle — its status
 * (active / unsubscribed) is an assigned attribute, not a workflow phase ->
 * Flat/Faceted Record, NOT Process/MastFlow. The record is genuinely flat, so a
 * single Overview facet carries it (no invented facets, no pane tabs).
 *
 * Create + edit are NATIVE here: a custom detail.editRender (the legacy add-modal
 * field set — name, email, notes — plus the subscribed/unsubscribed status the
 * legacy unsubscribe path toggles) + an onSave that DELEGATES to
 * window.NewsletterBridge (exposed in newsletter.js) so the subscriber record
 * write, the active-email dedup + email validation, and the unsubscribe status
 * stamp stay single-sourced — this twin never reimplements that logic (mirrors
 * the contacts-v2 / ContactsBridge precedent). Legacy "add subscriber" is a pure
 * record write (it does NOT send a welcome/confirmation email), so create stays a
 * plain write through the bridge — there is no send to route.
 *
 * Issues are a second FULLY-NATIVE surface (the Issues lens) — there is no classic
 * escape hatch. A draft issue is created + lightly edited (title/subject) inline,
 * and "Compose & send" drills into a native composer (newsletter-compose-v2):
 * ordered-list sections with per-section rich-text + AI polish, audience segment
 * picker, A/B test config, Preview, Publish-to-website, Send test + Send. EVERY
 * write delegates to window.NewsletterBridge; section content is sanitized via
 * MastUI.sanitizeHtml. The email SEND is an enqueue to tenants/{tid}/emailQueue
 * (drained by the processEmailQueue backend worker) + the A/B winner cron —
 * genuine backend, triggered from the native UI. Flag-gated (?ui=1) at
 * #newsletter-v2, side-by-side.
 *
 * Data: subscribers live at newsletter/subscribers (MastDB.newsletter.subscribers
 * -> that path; legacy reads it via .ref().once('value')). One-shot keyed-object
 * read — fields per record: email, name, status ('active'|'unsubscribed'),
 * source ('manual'|'website-form'), subscribedAt (ISO), unsubscribedAt, notes,
 * unsubscribeToken, and Resend webhook health flags (bounceFlag / complaintFlag).
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

  var STATUS_LABEL = { active: 'Subscribed', unsubscribed: 'Unsubscribed' };
  var STATUS_TONE = { active: 'success', unsubscribed: 'neutral' };
  var SOURCE_LABEL = { 'website-form': 'Website', manual: 'Manual' };

  function subName(s) { return (s && s.name) || '(no name)'; }
  function subEmail(s) { return (s && s.email) || '—'; }
  function statusOf(s) { return (s && s.status) || 'active'; }
  function sourceOf(s) { return (s && s.source) || 'manual'; }
  function sourceLabel(s) { var v = sourceOf(s); return SOURCE_LABEL[v] || (v ? String(v) : 'Manual'); }
  // Health flag from the Resend webhook — bounce wins, then complaint.
  function healthLabel(s) {
    if (s && s.bounceFlag) return 'Bounced';
    if (s && s.complaintFlag) return 'Complaint';
    return null;
  }

  // ── schema (read-only Flat/Faceted Record) ──────────────────────────
  MastEntity.define('newsletter-v2', {
    label: 'Subscriber', labelPlural: 'Subscribers', size: 'md',
    route: 'newsletter-v2',
    recordId: function (s) { return s._key || s.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real email string.
      { name: 'email', label: 'Email', type: 'text', list: true, readOnly: true, group: 'Subscriber', get: subEmail },
      { name: 'name', label: 'Name', type: 'text', list: true, readOnly: true, get: function (s) { return s.name || '—'; } },
      { name: 'source', label: 'Source', type: 'text', list: true, readOnly: true, get: sourceLabel,
        tone: function () { return 'teal'; } },
      { name: 'subscribedAt', label: 'Subscribed', type: 'date', list: true, readOnly: true },
      { name: 'status', label: 'Status', type: 'status', list: true,
        options: ['active', 'unsubscribed'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, s) {
        var health = healthLabel(s);
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(s)] || 'Subscribed', STATUS_TONE[statusOf(s)] || 'neutral'), hero: true },
          { k: 'Subscribed', v: s.subscribedAt ? esc(N.date(s.subscribedAt)) : '—' },
          { k: 'Source', v: esc(sourceLabel(s)) },
          { k: 'Health', v: health ? UI.badge(health, 'danger') : '<span class="mu-sub">OK</span>' }
        ]);

        // Single Overview facet — the record is genuinely flat (no cheap related
        // collection to warrant a second facet or pane tabs).
        var details = UI.kv([
          { k: 'Email', v: s.email ? esc(s.email) : '—' },
          { k: 'Name', v: s.name ? esc(s.name) : '—' },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(s)] || 'Subscribed', STATUS_TONE[statusOf(s)] || 'neutral') },
          { k: 'Source', v: esc(sourceLabel(s)) },
          { k: 'Subscribed', v: s.subscribedAt ? esc(N.date(s.subscribedAt)) : '—' },
          { k: 'Unsubscribed', v: s.unsubscribedAt ? esc(N.date(s.unsubscribedAt)) : '—' }
        ]);

        var healthBody = health
          ? UI.kv([
              { k: 'Flag', v: UI.badge(health, 'danger') },
              { k: 'Flagged', v: esc((s.bounceFlagAt || s.complaintFlagAt) ? N.date(s.bounceFlagAt || s.complaintFlagAt) : '—') }
            ])
          : '<span class="mu-sub">No delivery issues reported.</span>';

        var notesBody = s.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(s.notes) + '</div>'
          : '<span class="mu-sub">No notes.</span>';

        // Subscriber create/edit is NATIVE (the Edit button on this slide-out).
        // Newsletter ISSUES are now their own surface (the Issues lens) with a
        // native create flow, so this subscriber pane no longer carries a
        // "compose issues in classic" punt.
        return tiles +
          UI.card('Subscriber', details) +
          UI.card('Delivery health', healthBody) +
          UI.card('Notes', notesBody);
      },
      // Native edit form — the legacy add-modal field set (name *, email *, notes)
      // plus the subscribed/unsubscribed status the legacy unsubscribe path
      // toggles. source / subscribedAt / unsubscribeToken / health flags are
      // system-owned (not editable; a partial update preserves them).
      editRender: function (s, mode) {
        s = s || {};
        var st = statusOf(s);
        var statusOpts = [['active', 'Subscribed'], ['unsubscribed', 'Unsubscribed']].map(function (o) {
          return '<option value="' + o[0] + '"' + (st === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('');
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New subscriber' : 'Edit this subscriber') + '</div>' +
          fg('Name *', '<input class="form-input" id="nlV2Name" value="' + esc(s.name || '') + '" style="width:100%;" placeholder="Subscriber name">') +
          fg('Email *', '<input class="form-input" type="email" id="nlV2Email" value="' + esc(s.email || '') + '" style="width:100%;" placeholder="email@example.com">') +
          row2(
            fg('Status', '<select class="form-input" id="nlV2Status" style="width:100%;">' + statusOpts + '</select>', true),
            fg('Notes', '<input class="form-input" id="nlV2Notes" value="' + esc(s.notes || '') + '" style="width:100%;">', true)
          );
      }
    },
    onSave: function (rec, mode) {
      if (!window.NewsletterBridge) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return false; }
      var data = {
        name: ((document.getElementById('nlV2Name') || {}).value || '').trim(),
        email: ((document.getElementById('nlV2Email') || {}).value || '').trim(),
        notes: ((document.getElementById('nlV2Notes') || {}).value || '').trim(),
        status: (document.getElementById('nlV2Status') || {}).value || 'active'
      };
      // Mirror legacy nlSaveSubscriber validation exactly.
      if (!data.name || !data.email) { if (window.showToast) showToast('Name and email are required', true); return false; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { if (window.showToast) showToast('Invalid email address', true); return false; }

      if (mode === 'create') {
        if (window.NewsletterBridge.isDuplicate(data.email)) { if (window.showToast) showToast('This email is already subscribed', true); return false; }
        return Promise.resolve(window.NewsletterBridge.create(data)).then(function () {
          if (window.showToast) showToast('Subscriber added'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[newsletter-v2] create', e); if (window.showToast) showToast('Error adding subscriber.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.NewsletterBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        var live = V2.byId[id] || rec;
        live.name = data.name; live.email = data.email; live.notes = data.notes || null;
        if (data.status !== live.status) {
          live.status = data.status;
          live.unsubscribedAt = data.status === 'unsubscribed' ? new Date().toISOString() : null;
        }
        if (window.showToast) showToast('Subscriber updated'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[newsletter-v2] update', e); if (window.showToast) showToast('Error updating subscriber.', true); return false; });
    }
  });

  // ── Issues lens (marketing-v2 Wave 3) ───────────────────────────────
  // Read detail for newsletter ISSUES (newsletter/issues): title + sections
  // (the grid-builder card ids) + status ('draft' | 'published' | 'sent').
  // Status is assigned by the legacy send/publish path — no governed
  // lifecycle → Faceted Record, read-only here. Composing/sending stays on
  // legacy #newsletter; draft issues can be DELETED here (sent/published
  // issues are the send history — immutable).
  var ISSUE_STATUS_TONE = { draft: 'info', published: 'success', sent: 'success' };
  function issueStatus(n) { return String(n.status || 'draft').toLowerCase(); }
  function issueTitle(n) { return n.title || '(untitled issue)'; }
  function sectionCount(n) {
    if (Array.isArray(n.sections)) return n.sections.length;
    return Object.keys(n.sections || {}).length;
  }
  MastEntity.define('newsletter-issues-v2', {
    label: 'Issue', labelPlural: 'Issues', size: 'md', route: 'newsletter-v2',
    recordId: function (n) { return n._key || n.id; },
    fields: [
      { name: 'title', label: 'Issue', type: 'text', list: true, readOnly: true, get: issueTitle },
      { name: 'issueNumber', label: '#', type: 'number', list: true, readOnly: true, align: 'right',
        get: function (n) { return n.issueNumber || null; } },
      { name: 'sections', label: 'Sections', type: 'number', list: true, readOnly: true, align: 'right', get: sectionCount },
      { name: 'date', label: 'Date', type: 'date', list: true, readOnly: true,
        get: function (n) { return n.sentAt || n.publishedAt || n.scheduledFor || n.createdAt || null; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['draft', 'published', 'sent'], get: issueStatus,
        tone: function (v) { return ISSUE_STATUS_TONE[v] || 'neutral'; } }
    ],
    // Cache-miss fallback keeps cross-record drills (campaign references,
    // calendar) working cold.
    fetch: function (id) {
      if (V2.issuesById[id]) return Promise.resolve(V2.issuesById[id]);
      return Promise.resolve(MastDB.get('newsletter/issues/' + id)).then(function (n) {
        return n ? Object.assign({ _key: id }, n) : null;
      });
    },
    detail: {
      render: function (UI, n) {
        var id = n._key || n.id;
        var st = issueStatus(n);
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(st, ISSUE_STATUS_TONE[st] || 'neutral'), hero: true },
          { k: 'Issue #', v: n.issueNumber != null ? String(n.issueNumber) : '—' },
          { k: 'Sections', v: N.count(sectionCount(n)) },
          { k: st === 'draft' ? 'Created' : 'Sent / published', v: (n.sentAt || n.publishedAt || n.createdAt) ? N.date(n.sentAt || n.publishedAt || n.createdAt) : '—' }
        ]);
        // Issue actions: Duplicate-as-template (any issue → fresh draft, gated on
        // edit) + Export HTML (any issue → client-side download, read-only) +
        // Delete (drafts only, gated on delete). Mirrors the legacy per-issue
        // Duplicate/Export controls.
        var canEdit = (typeof window.can !== 'function' || window.can('newsletter', 'edit'));
        var canDelete = (typeof window.can !== 'function' || window.can('newsletter', 'delete'));
        var actBtns = [];
        if (canEdit && sectionCount(n) > 0) {
          actBtns.push('<button class="btn btn-secondary btn-small" onclick="NewsletterV2.duplicateIssue(\'' + esc(id) + '\')" title="Duplicate this issue as a fresh draft template">📋 Duplicate as template</button>');
        }
        actBtns.push('<button class="btn btn-secondary btn-small" onclick="NewsletterV2.exportHtml(\'' + esc(id) + '\')" title="Download this issue\'s email HTML">↓ Export HTML</button>');
        if (st === 'draft' && canDelete) {
          actBtns.push('<button class="btn btn-secondary btn-small" style="color:var(--text-danger);" onclick="NewsletterV2.removeIssue(\'' + esc(id) + '\')">Delete draft</button>');
        }
        var actions = '<div style="margin:0 0 12px;display:flex;gap:8px;flex-wrap:wrap;">' + actBtns.join('') + '</div>';
        var meta = UI.kv([
          { k: 'Title', v: esc(issueTitle(n)) },
          { k: 'Slug', v: n.slug ? '<span style="font-family:monospace;font-size:0.78rem;">' + esc(n.slug) + '</span>' : '—' },
          { k: 'Created', v: n.createdAt ? N.date(n.createdAt) : '—' },
          { k: 'Updated', v: n.updatedAt ? N.date(n.updatedAt) : '—' },
          { k: 'Published', v: n.publishedAt ? N.date(n.publishedAt) : '—' }
        ]);
        var canEd = (typeof window.can !== 'function' || window.can('newsletter', 'edit'));
        // Drafts open the native composer (sections + audience + send, all native —
        // no classic escape hatch). Sent/published issues are send history.
        var cbtns = (st === 'draft' && canEd)
          ? '<button class="btn btn-primary" onclick="NewsletterV2.compose(\'' + esc(id) + '\')">📝 Compose &amp; send</button>'
          : '<span class="mu-sub">Sent / published issues are send history.</span>';
        var compose = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' + cbtns + '</div>' +
          '<div id="nlIssueCampChip_' + esc(id) + '"></div>';
        // Part-of-campaign chip — single-sourced renderer in campaigns-v2.js.
        setTimeout(function () {
          if (window.MastAdmin && MastAdmin.loadModule) {
            MastAdmin.loadModule('campaigns-v2').then(function () {
              if (window.CampaignsBridge && CampaignsBridge.renderChipInto) CampaignsBridge.renderChipInto('nlIssueCampChip_' + id, id);
            }).catch(function () {});
          }
        }, 0);
        return tiles + actions + UI.card('Issue', meta) + UI.card('Compose', '<span class="mu-sub">Compose sections, pick the audience, and send — all native.</span>' + compose);
      },
      // CREATE (a draft issue) + light EDIT (title / subject line) are NATIVE, so
      // the twin no longer punts new issues to the classic Composer. The grid
      // builder (sections, A/B tests, send) stays single-sourced there. Sent /
      // published issues are the send history — their fields are read-only here.
      editRender: function (n, mode) {
        n = n || {};
        function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        var sent = mode !== 'create' && issueStatus(n) !== 'draft';
        var lead = mode === 'create'
          ? 'New issue — compose the grid (sections, A/B tests, send) in the classic view after creating'
          : (sent ? 'This issue has been sent — its record is read-only' : 'Edit issue details (the grid builder lives in the classic view)');
        var dis = sent ? ' disabled' : '';
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + lead + '</div>' +
          fg('Title', '<input class="form-input" id="nlIssTitle" value="' + esc(mode === 'create' ? '' : (issueTitle(n) === '(untitled issue)' ? '' : issueTitle(n))) + '" style="width:100%;"' + dis + ' placeholder="Issue title (auto-named if blank)">') +
          fg('Subject line', '<input class="form-input" id="nlIssSubject" value="' + esc(mode === 'create' ? '' : (n.subjectLine || '')) + '" style="width:100%;"' + dis + ' placeholder="Email subject line">');
      }
    },
    onSave: function (rec, mode) {
      if (typeof window.can === 'function' && !window.can('newsletter', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to edit issues.', true); return false;
      }
      if (!window.NewsletterBridge) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return false; }
      function val(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
      var data = { title: val('nlIssTitle'), subjectLine: val('nlIssSubject') };
      if (mode === 'create') {
        if (!NewsletterBridge.createIssue) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return false; }
        return Promise.resolve(NewsletterBridge.createIssue(data)).then(function (id) {
          if (window.writeAudit) writeAudit('create', 'newsletter-issue', id);
          if (window.showToast) showToast('Draft issue created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[newsletter-v2] createIssue', e); if (window.showToast) showToast('Error creating issue.', true); return false; });
      }
      var id = rec._key || rec.id;
      // Gate on the record actually being edited (rec carries the true status on
      // cold/drill opens too) — NOT V2.issuesById, which is empty when an issue
      // is opened cold (campaign drill / fetch cache-miss). Sent/published issues
      // are the send history — immutable.
      if (issueStatus(rec) !== 'draft') { if (window.showToast) showToast('Sent issues are the send history — they can\'t be edited.', true); return false; }
      if (!NewsletterBridge.updateIssue) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return false; }
      return Promise.resolve(NewsletterBridge.updateIssue(id, data)).then(function (updates) {
        Object.assign(V2.issuesById[id] || rec, updates || data);
        if (window.showToast) showToast('Issue updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[newsletter-v2] updateIssue', e); if (window.showToast) showToast('Error updating issue.', true); return false; });
    }
  });

  // ── native composer (newsletter-compose-v2 — route:null drilled SO) ──
  // The native grid/section editor (V1-editor-elimination program, composer PR-2).
  // Opened via MastEntity.drill('newsletter-compose-v2', issueId) from the issue
  // detail. Sections render as an ORDERED LIST — the email output stacks sections
  // single-column by order (nlComposeIssueHtml), so a list is functionally
  // identical to the legacy 2-col canvas (which is editor-only decoration). EVERY
  // write delegates to NewsletterBridge (content sanitized via MastUI.sanitizeHtml).
  // Rich text reuses the legacy window.nlFormatCmd / nlInsertLink helpers
  // (execCommand + a custom link modal — no native dialogs). Audience + A/B + SEND
  // remain on the classic view until composer PR-3.
  var CMP = null, _cmpTimer = null;
  var CMP_TYPES = [
    ['studio-update', '🔥', 'What We\'ve Been Making'], ['new-products', '✨', 'New Products'],
    ['event-recap', '🎪', 'Event Recap'], ['upcoming-events', '📅', 'Upcoming Events'],
    ['behind-process', '🔧', 'Behind the Process'], ['featured-piece', '💎', 'Featured Piece'],
    ['from-studio', '💌', 'From the Studio'], ['coupon', '🎟️', 'Coupon / Offer'], ['custom', '📝', 'Custom Section']
  ];
  var CMP_ICON = {}; CMP_TYPES.forEach(function (t) { CMP_ICON[t[0]] = t[1]; });
  var CMP_CHAR = { small: 150, medium: 300, large: 600, full: 800 };
  function cmpIcon(t) { return CMP_ICON[t] || '📝'; }
  function cmpLimit(sz) { return CMP_CHAR[sz] || 300; }
  function cmpStrip(html) { var d = document.createElement('div'); d.innerHTML = html || ''; return (d.textContent || d.innerText || ''); }
  function cmpSan(html) { return (U && U.sanitizeHtml) ? U.sanitizeHtml(html) : esc(html); }

  function loadCompose(id) {
    return Promise.resolve(MastDB.get('newsletter/issues/' + id)).then(function (n) {
      var iv = (n && typeof n.val === 'function') ? n.val() : n;
      if (!iv) return null;
      iv = Object.assign({ _key: id }, iv);
      var secs = iv.sections ? Object.keys(iv.sections).map(function (k) { var s = Object.assign({}, iv.sections[k]); s.id = s.id || k; return s; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); }) : [];
      CMP = { issueId: id, issue: iv, sections: secs };
      return { _key: id, _title: ((iv.title || 'Issue') + ' · Compose') };
    });
  }
  function reopenCompose() {
    if (!CMP) return;
    MastEntity.openRecord('newsletter-compose-v2', { _key: CMP.issueId, _title: ((CMP.issue.title || 'Issue') + ' · Compose') }, 'read', true);
  }
  // Capture any unsaved DOM edits into CMP + persist, BEFORE a structural
  // re-render (add/delete/move/size) re-injects content from CMP.
  function cmpFlushAll() {
    if (!CMP) return;
    CMP.sections.forEach(function (s) {
      var el = document.getElementById('cmpEd_' + s.id);
      if (el && (el.innerHTML || '') !== s.finalContent) {
        var html = el.innerHTML || ''; s.finalContent = cmpSan(html);
        if (window.NewsletterBridge) Promise.resolve(NewsletterBridge.updateSection(CMP.issueId, s.id, { finalContent: html })).catch(function () {});
      }
      var ti = document.getElementById('cmpTitle_' + s.id);
      if (ti && ti.value !== s.title) { s.title = ti.value; if (window.NewsletterBridge) Promise.resolve(NewsletterBridge.updateSection(CMP.issueId, s.id, { title: ti.value })).catch(function () {}); }
    });
    var it = document.getElementById('cmpIssTitle'), isub = document.getElementById('cmpIssSubject');
    if (it || isub) {
      var t = it ? it.value.trim() : CMP.issue.title, sub = isub ? isub.value.trim() : CMP.issue.subjectLine;
      if (t !== CMP.issue.title || sub !== CMP.issue.subjectLine) {
        CMP.issue.title = t; CMP.issue.subjectLine = sub;
        if (window.NewsletterBridge) Promise.resolve(NewsletterBridge.updateIssue(CMP.issueId, { title: t, subjectLine: sub })).catch(function () {});
      }
    }
  }

  // Build the issue object the bridge composes/sends from, with sections rebuilt
  // from the LIVE CMP.sections (CMP.issue.sections is a stale load-time snapshot —
  // in-pane edits live in CMP.sections). Mirrors what cmpPublishWeb does.
  function cmpIssueSnapshot() {
    var map = {}; CMP.sections.forEach(function (s) { map[s.id] = s; });
    return Object.assign({}, CMP.issue, { id: CMP.issueId, sections: map });
  }
  // Issue is mid/post-send → block re-sends (mirrors legacy's disabled Send button).
  function cmpAlreadySent() { return CMP && ['sending', 'completed', 'manual-mark'].indexOf(CMP.issue.sendStatus) >= 0; }

  function cmpToolbar(idp) {
    return '<div class="nl-format-toolbar">' +
      '<button class="nl-format-btn" id="' + idp + 'Bold" onmousedown="event.preventDefault();nlFormatCmd(\'' + idp + '\',\'bold\')" title="Bold"><b>B</b></button>' +
      '<button class="nl-format-btn" id="' + idp + 'Italic" onmousedown="event.preventDefault();nlFormatCmd(\'' + idp + '\',\'italic\')" title="Italic"><i>I</i></button>' +
      '<span class="nl-format-sep"></span>' +
      '<button class="nl-format-btn nl-format-btn-wide" id="' + idp + 'Link" onmousedown="event.preventDefault();nlInsertLink(\'' + idp + '\')" title="Insert link">🔗</button>' +
      '</div>';
  }
  // Per-section image strip (max 3) — mirrors the legacy card-editor Images block.
  // Thumbnails resolve through the shell's imageLibrary (the same map the email/web
  // output builders read), each with a remove control. Writes delegate to
  // NewsletterBridge.updateSection({ images }).
  function composeImageStrip(s) {
    var sid = s.id, IL = window.imageLibrary || {}, imgs = s.images || [];
    var thumbs = imgs.map(function (imgId, idx) {
      var img = IL[imgId];
      if (!img) return '';
      return '<div style="position:relative;display:inline-block;">' +
        '<img src="' + esc(img.url || '') + '" alt="' + esc(img.alt || '') + '" style="width:54px;height:54px;object-fit:cover;border-radius:6px;border:1px solid var(--border);display:block;">' +
        '<button class="btn btn-small btn-secondary" style="color:var(--text-danger);position:absolute;top:-8px;right:-8px;padding:0 6px;line-height:1.5;" title="Remove image" onclick="NewsletterV2.cmpRemoveImage(\'' + esc(sid) + '\',' + idx + ')">×</button>' +
        '</div>';
    }).join('');
    var addBtn = imgs.length < 3
      ? '<button class="btn btn-small btn-secondary" onclick="NewsletterV2.cmpAddImage(\'' + esc(sid) + '\')">+ Image</button>'
      : '';
    return '<div style="margin-top:10px;">' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:6px;">Images (max 3)</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' + thumbs + addBtn + '</div>' +
      '</div>';
  }

  // Coupon-section body — mirrors the legacy card-editor coupon picker/preview.
  // A coupon section renders a MastCouponCard preview (single-sourced with the
  // email/web output) instead of the rich-text editor; the code write delegates
  // to NewsletterBridge.updateSection({ couponCode, finalContent }).
  function couponValStr(c) {
    if (!c) return '';
    if (c.type === 'percent') return (c.value || 0) + '% off';
    var cents = Math.round(Number(c.value || 0) * 100);
    return (window.MastFormat ? MastFormat.money(cents, { cents: true }) : ('$' + Number(c.value || 0))) + ' off';
  }
  function composeCouponBlock(s) {
    var sid = s.id, allC = window.coupons || {}, c = s.couponCode ? allC[s.couponCode] : null, preview;
    if (s.couponCode && c && window.MastCouponCard) {
      preview = window.MastCouponCard.renderHtml(Object.assign({}, c, { code: s.couponCode, _code: s.couponCode }), { showCta: false });
    } else if (s.couponCode && !c) {
      preview = '<div style="padding:12px;text-align:center;color:var(--warm-gray);">Coupon “' + esc(s.couponCode) + '” not found</div>';
    } else {
      preview = '<div style="padding:12px;text-align:center;color:var(--warm-gray);">No coupon selected</div>';
    }
    return preview +
      '<div style="margin-top:8px;"><button class="btn btn-small btn-secondary" onclick="NewsletterV2.cmpPickCoupon(\'' + esc(sid) + '\')">' +
      (s.couponCode ? 'Change coupon' : 'Select coupon') + '</button></div>';
  }

  function composeSectionCard(s) {
    var sid = s.id, sz = s.cardSize || 'medium', limit = cmpLimit(sz), idp = 'cmp_' + sid;
    var content = cmpSan(s.finalContent || '');
    var textLen = cmpStrip(content).length;
    var sizeOpts = ['small', 'medium', 'large', 'full'].map(function (o) { return '<option value="' + o + '"' + (sz === o ? ' selected' : '') + '>' + o + '</option>'; }).join('');
    var header = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">' +
      '<span style="font-size:1.0rem;">' + cmpIcon(s.type) + '</span>' +
      '<input class="form-input" id="cmpTitle_' + esc(sid) + '" value="' + esc(s.title || '') + '" onchange="NewsletterV2.cmpSetField(\'' + esc(sid) + '\',\'title\',this.value)" style="flex:1;min-width:140px;" placeholder="Section title">' +
      '<select class="form-input" onchange="NewsletterV2.cmpSetSize(\'' + esc(sid) + '\',this.value)" style="width:auto;" title="Card size (sets the char limit)">' + sizeOpts + '</select>' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);display:flex;align-items:center;gap:4px;"><input type="checkbox"' + (s.included !== false ? ' checked' : '') + ' onchange="NewsletterV2.cmpSetField(\'' + esc(sid) + '\',\'included\',this.checked)"> Include</label>' +
      '<button class="btn btn-small btn-secondary" onclick="NewsletterV2.cmpMove(\'' + esc(sid) + '\',-1)" title="Move up">↑</button>' +
      '<button class="btn btn-small btn-secondary" onclick="NewsletterV2.cmpMove(\'' + esc(sid) + '\',1)" title="Move down">↓</button>' +
      '<button class="btn btn-small btn-secondary" style="color:var(--text-danger);" onclick="NewsletterV2.cmpDelete(\'' + esc(sid) + '\')" title="Delete section">×</button>' +
      '</div>';
    var editor = cmpToolbar(idp) +
      '<div class="nl-section-editable" id="cmpEd_' + esc(sid) + '" contenteditable="true" data-char-limit="' + limit + '"' +
      ' oninput="NewsletterV2.cmpInput(\'' + esc(sid) + '\',' + limit + ')" onkeyup="nlUpdateToolbarState(\'' + idp + '\')" onmouseup="nlUpdateToolbarState(\'' + idp + '\')"' +
      ' onblur="NewsletterV2.cmpFlush(\'' + esc(sid) + '\')">' + content + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;gap:8px;">' +
        '<button class="btn btn-small btn-secondary" onclick="NewsletterV2.cmpPolish(\'' + esc(sid) + '\')">✨ Polish with AI</button>' +
        '<span class="nl-editor-char-counter" id="cmpCnt_' + esc(sid) + '">' + textLen + '/' + limit + '</span>' +
      '</div>';
    // Coupon sections swap the rich-text editor for the coupon picker/preview
    // (their content is the coupon card, not free text). All sections carry the
    // image strip.
    var body = (s.type === 'coupon') ? composeCouponBlock(s) : editor;
    return '<div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px;">' + header + body + composeImageStrip(s) + '</div>';
  }
  function composeHtml(UI, r) {
    if (!CMP || CMP.issueId !== (r && r._key)) return '<p class="mu-sub">Loading…</p>';
    var iss = CMP.issue;
    var head = '<div class="form-group"><label class="form-label">Issue title</label><input class="form-input" id="cmpIssTitle" value="' + esc(iss.title || '') + '" onchange="NewsletterV2.cmpSaveMeta()" style="width:100%;"></div>' +
      '<div class="form-group"><label class="form-label">Subject line</label><input class="form-input" id="cmpIssSubject" value="' + esc(iss.subjectLine || '') + '" onchange="NewsletterV2.cmpSaveMeta()" style="width:100%;" placeholder="Email subject line"></div>';
    var sections = CMP.sections.length ? CMP.sections.map(composeSectionCard).join('') : '<p class="mu-sub" style="padding:8px 0;">No sections yet — add one below.</p>';
    var addBtns = CMP_TYPES.map(function (t) { return '<button class="btn btn-small btn-secondary" onclick="NewsletterV2.cmpAdd(\'' + t[0] + '\')">' + t[1] + ' ' + esc(t[2]) + '</button>'; }).join(' ');
    setTimeout(function () { if (window.NewsletterV2 && NewsletterV2.cmpRefreshCount) NewsletterV2.cmpRefreshCount(); }, 0);
    return UI.card('Issue', head) +
      UI.card('Sections', sections) +
      UI.card('Add a section', '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + addBtns + '</div>') +
      UI.card('Audience & send', composeSendBody(iss)) +
      '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding-top:14px;">' +
        '<button class="btn btn-secondary" onclick="NewsletterV2.cmpPreview()">👁 Preview</button>' +
        '<button class="btn btn-primary" onclick="NewsletterV2.cmpPublishWeb()">🌐 Publish to website</button>' +
      '</div>';
  }
  // Audience picker + A/B config + test/send (composer PR-3). Recipient count is
  // filled async after render (matchRecipients loads subscribers fresh).
  function composeSendBody(iss) {
    var seg = iss.audienceSegmentId || '__all';
    var segOpts = [['__all', 'All active subscribers'], ['__has_orders', 'Customers (1+ orders)'], ['__no_orders', 'No orders yet'], ['__repeat_2', 'Repeat buyers (2+)'], ['__lapsed_90', 'Lapsed (90d+)']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (seg === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
    var ab = iss.abTest || {}, abOn = !!ab.enabled, sending = iss.sendStatus === 'sending';
    var alreadySent = ['sending', 'completed', 'manual-mark'].indexOf(iss.sendStatus) >= 0;
    var holdout = typeof ab.holdoutPct === 'number' ? ab.holdoutPct : 50, hours = typeof ab.testWindowHours === 'number' ? ab.testWindowHours : 4;
    var abFields = abOn ? (
      '<div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
        '<input class="form-input" value="' + esc((ab.variantB && ab.variantB.subject) || '') + '" placeholder="Variant B subject" onchange="NewsletterV2.cmpAbField(\'variantB.subject\',this.value)" style="flex:1;min-width:200px;">' +
        '<label style="font-size:0.78rem;color:var(--warm-gray);">Holdout %: <input class="form-input" type="number" min="10" max="90" value="' + holdout + '" onchange="NewsletterV2.cmpAbField(\'holdoutPct\',Number(this.value))" style="width:64px;"></label>' +
        '<label style="font-size:0.78rem;color:var(--warm-gray);">Test window (h): <input class="form-input" type="number" min="1" max="72" value="' + hours + '" onchange="NewsletterV2.cmpAbField(\'testWindowHours\',Number(this.value))" style="width:64px;"></label>' +
      '</div>' +
      (sending && ab.sendStartedAt && !ab.winnerPickedAt ? '<div style="margin-top:8px;"><button class="btn btn-small btn-secondary" onclick="NewsletterV2.cmpPickWinner()">⏱ Pick winner now</button></div>' : '') +
      (ab.winnerPickedAt ? '<div class="mu-sub" style="margin-top:8px;">Winner: variant ' + esc(ab.winner || '?') + '</div>' : '')
    ) : '';
    return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<label class="form-label" style="margin:0;">Audience</label>' +
        '<select class="form-input" onchange="NewsletterV2.cmpSetAudience(this.value)" style="width:auto;flex:1;min-width:180px;max-width:320px;">' + segOpts + '</select>' +
        '<span class="mu-sub" id="cmpRecipCount">counting…</span>' +
      '</div>' +
      '<label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:0.85rem;"><input type="checkbox"' + (abOn ? ' checked' : '') + ' onchange="NewsletterV2.cmpAbToggle(this.checked)"> A/B test (variant B subject + holdout)</label>' +
      abFields +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center;">' +
        '<input class="form-input" id="cmpTestEmail" type="email" placeholder="you@example.com" style="flex:1;min-width:180px;">' +
        '<button class="btn btn-secondary" onclick="NewsletterV2.cmpSendTest()">📨 Send test</button>' +
        (alreadySent
          ? '<button class="btn btn-primary" disabled title="This issue has already been sent">✓ Sent</button>'
          : '<button class="btn btn-primary" onclick="NewsletterV2.cmpSend()">🚀 Send to audience</button>') +
      '</div>' +
      (sending ? '<div class="mu-sub" style="margin-top:8px;">Last send: queued ' + ((iss.sendQueuedCount) || 0) + ', skipped ' + ((iss.sendSkippedCount) || 0) + '.</div>' : '');
  }
  MastEntity.define('newsletter-compose-v2', {
    label: 'Compose', labelPlural: 'Compose', size: 'lg', route: null,
    recordId: function (r) { return r._key; },
    fields: [{ name: '_title', label: 'Issue', type: 'text', list: true, group: 'Issue', readOnly: true }],
    fetch: function (id) { return loadCompose(id); },
    detail: { render: function (UI, r) { return composeHtml(UI, r); } }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'subscribedAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false,
    view: 'issues', issues: [], issuesById: {}, issueSortKey: 'date', issueSortDir: 'desc' };

  function load() {
    // NewsletterBridge + its dedup cache are now in-module (absorbed 2nd IIFE),
    // so there is no legacy module to load.
    // Subscribers + issues — one-shot keyed-object reads at the same paths
    // legacy reads.
    Promise.all([
      Promise.resolve(MastDB.get('newsletter/subscribers')).catch(function () { return null; }),
      Promise.resolve(MastDB.list('newsletter/issues', { limit: 200 })).catch(function () { return null; })
    ]).then(function (res) {
        var tree = res[0] || {};
        var out = [];
        Object.keys(tree).forEach(function (k) {
          var s = tree[k];
          if (s && typeof s === 'object') { s = Object.assign({ _key: k }, s); s.status = s.status || 'active'; out.push(s); }
        });
        V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
        var itree = res[1] || {};
        itree = (itree && typeof itree.val === 'function') ? itree.val() : itree;
        var issues = [];
        Object.keys(itree || {}).forEach(function (k) {
          var n = itree[k];
          if (n && typeof n === 'object') issues.push(Object.assign({ _key: k }, n));
        });
        V2.issues = issues; V2.issuesById = {}; issues.forEach(function (n) { V2.issuesById[n._key] = n; });
        V2.loaded = true; render();
      }).catch(function (e) { console.error('[newsletter-v2] load', e); render(); });
  }
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function activeCount() { return V2.rows.filter(function (s) { return statusOf(s) === 'active'; }).length; }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (s) { return statusOf(s) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (s) {
        return String(s.email || '').toLowerCase().indexOf(q) >= 0 ||
               String(s.name || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('newsletter-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('newsletterV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'newsletterV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function visibleIssues() {
    return window.mastSortRows(V2.issues.slice(), V2.issueSortKey, V2.issueSortDir, function (r, k) {
      var f = MastEntity.get('newsletter-issues-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function render() {
    var tab = ensureTab();
    // Lens pills (Wave 3): the Newsletter route hosts TWO record sets — issues
    // (the newsletters themselves; default lens) and subscribers. Issues lead
    // because "Newsletter" is fundamentally the issues you send; subscribers are
    // the audience behind them.
    var lens = [['issues', 'Issues', V2.issues.length], ['subs', 'Subscribers', V2.rows.length]].map(function (l) {
      var on = V2.view === l[0];
      return '<button onclick="NewsletterV2.view(\'' + l[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        l[1] + ' <span style="color:var(--warm-gray);">' + l[2] + '</span></button>';
    }).join('');

    if (V2.view === 'issues') {
      tab.innerHTML =
        U.pageHeader({
          title: 'Newsletter',
          count: N.count(V2.issues.length) + ' ' + MastFormat.plural(V2.issues.length, 'issue'),
          subtitle: 'Create a draft here, then compose & send it in the classic grid builder.',
          actionsHtml: '<button class="btn btn-primary" onclick="NewsletterV2.newIssue()">+ New issue</button>' +
            '<button class="btn btn-secondary" onclick="NewsletterV2.exportIssuesCsv()">↓ Export</button>'
        }) +
        '<div style="margin:14px 0;">' + lens + '</div>' +
        MastEntity.renderList('newsletter-issues-v2', {
          rows: visibleIssues(), sortKey: V2.issueSortKey, sortDir: V2.issueSortDir,
          onSortFnName: 'NewsletterV2.sortIssues', onRowClickFnName: 'NewsletterV2.openIssue',
          empty: { title: 'No issues yet', message: V2.loaded ? 'Click “+ New issue” to create your first draft.' : 'Loading…' }
        });
      return;
    }

    var filters = [['all', 'All'], ['active', 'Subscribed'], ['unsubscribed', 'Unsubscribed']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="NewsletterV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Newsletter',
        count: N.count(activeCount()) + ' subscribed · ' + N.count(V2.rows.length) + ' total',
        actionsHtml: '<button class="btn btn-primary" onclick="NewsletterV2.create()">+ New subscriber</button>' +
          '<button class="btn btn-secondary" onclick="NewsletterV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="margin:14px 0;">' + lens + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search email or name…" value="' + esc(V2.q) +
        '" oninput="NewsletterV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('newsletter-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'NewsletterV2.sort', onRowClickFnName: 'NewsletterV2.open',
        empty: { title: 'No subscribers', message: V2.loaded ? 'Add a subscriber to get started.' : 'Loading…' }
      });
  }

  window.NewsletterV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'subscribedAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('newsletter-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('newsletter-v2', rec, 'read');
      });
    },
    create: function () {
      MastEntity.openRecord('newsletter-v2', {}, 'create');
    },
    // ── Issues lens (Wave 3) ──
    view: function (v) { V2.view = v === 'issues' ? 'issues' : 'subs'; render(); },
    // Create a draft issue NATIVELY (title / subject line); the write delegates
    // to NewsletterBridge.createIssue, which seeds the default grid sections.
    // Composing + sending happen afterward in the classic grid Composer.
    newIssue: function () {
      if (typeof window.can === 'function' && !window.can('newsletter', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to create issues.', true); return;
      }
      MastEntity.openRecord('newsletter-issues-v2', {}, 'create');
    },
    // ── native composer (PR-2): drilled section/grid editor ──
    compose: function (id) {
      if (typeof window.can === 'function' && !window.can('newsletter', 'edit')) { if (window.showToast) showToast('You don\'t have permission to edit issues.', true); return; }
      // NewsletterBridge + the rich-text editor globals (nlFormatCmd / nlInsertLink
      // / nlUpdateToolbarState) are in-module now (absorbed 2nd IIFE).
      MastEntity.drill('newsletter-compose-v2', id);
    },
    cmpSaveMeta: function () {
      if (!CMP || !window.NewsletterBridge) return;
      var title = ((document.getElementById('cmpIssTitle') || {}).value || '').trim();
      var subjectLine = ((document.getElementById('cmpIssSubject') || {}).value || '').trim();
      CMP.issue.title = title; CMP.issue.subjectLine = subjectLine;
      Promise.resolve(NewsletterBridge.updateIssue(CMP.issueId, { title: title, subjectLine: subjectLine })).catch(function (e) { console.error('[newsletter-v2] cmpSaveMeta', e); });
    },
    cmpInput: function (sid, limit) {
      var el = document.getElementById('cmpEd_' + sid); if (!el) return;
      var len = cmpStrip(el.innerHTML).length;
      var cnt = document.getElementById('cmpCnt_' + sid);
      if (cnt) { cnt.textContent = len + '/' + limit; cnt.style.color = len >= limit ? 'var(--text-danger)' : (len >= limit * 0.8 ? 'var(--amber)' : 'var(--warm-gray)'); }
      if (typeof nlUpdateToolbarState === 'function') nlUpdateToolbarState('cmp_' + sid);
      clearTimeout(_cmpTimer); _cmpTimer = setTimeout(function () { NewsletterV2._cmpSave(sid); }, 500);
    },
    cmpFlush: function (sid) { clearTimeout(_cmpTimer); NewsletterV2._cmpSave(sid); },
    _cmpSave: function (sid) {
      if (!CMP || !window.NewsletterBridge) return;
      var el = document.getElementById('cmpEd_' + sid); if (!el) return;
      var html = el.innerHTML || '';
      var sec = CMP.sections.filter(function (s) { return s.id === sid; })[0];
      if (sec) sec.finalContent = cmpSan(html);
      Promise.resolve(NewsletterBridge.updateSection(CMP.issueId, sid, { finalContent: html })).catch(function (e) { console.error('[newsletter-v2] cmpSave', e); });
    },
    cmpSetField: function (sid, field, value) {
      if (!CMP || !window.NewsletterBridge) return;
      var patch = {}; patch[field] = value;
      var sec = CMP.sections.filter(function (s) { return s.id === sid; })[0];
      if (sec) sec[field] = value;
      Promise.resolve(NewsletterBridge.updateSection(CMP.issueId, sid, patch)).catch(function (e) { console.error('[newsletter-v2] cmpSetField', e); });
    },
    cmpSetSize: function (sid, value) {
      if (!CMP || !window.NewsletterBridge) return;
      cmpFlushAll();
      var sec = CMP.sections.filter(function (s) { return s.id === sid; })[0];
      if (sec) sec.cardSize = value;
      Promise.resolve(NewsletterBridge.updateSection(CMP.issueId, sid, { cardSize: value })).then(function () { reopenCompose(); }).catch(function (e) { console.error('[newsletter-v2] cmpSetSize', e); });
    },
    cmpAdd: function (type) {
      if (!CMP || !window.NewsletterBridge || !NewsletterBridge.addSection) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return; }
      cmpFlushAll();
      var nextOrder = CMP.sections.reduce(function (m, s) { return Math.max(m, s.order || 0); }, -1) + 1;
      Promise.resolve(NewsletterBridge.addSection(CMP.issueId, type, nextOrder)).then(function (sec) {
        CMP.sections.push(sec); reopenCompose();
      }).catch(function (e) { console.error('[newsletter-v2] cmpAdd', e); if (window.showToast) showToast('Error adding section.', true); });
    },
    cmpDelete: function (sid) {
      if (!CMP || !window.NewsletterBridge) return;
      Promise.resolve(window.mastConfirm ? mastConfirm('Delete this section?', { title: 'Delete section?', confirmLabel: 'Delete', dangerous: true }) : true).then(function (ok) {
        if (!ok) return;
        cmpFlushAll();
        CMP.sections = CMP.sections.filter(function (s) { return s.id !== sid; });
        CMP.sections.forEach(function (s, i) { s.order = i; });
        var remaining = CMP.sections.map(function (s) { return { id: s.id, order: s.order, gridCol: s.gridCol || 0, gridRow: s.gridRow || 0 }; });
        return Promise.resolve(NewsletterBridge.deleteSection(CMP.issueId, sid, remaining)).then(function () { reopenCompose(); });
      }).catch(function (e) { console.error('[newsletter-v2] cmpDelete', e); if (window.showToast) showToast('Error deleting section.', true); });
    },
    cmpMove: function (sid, dir) {
      if (!CMP || !window.NewsletterBridge) return;
      cmpFlushAll();
      var i = CMP.sections.findIndex(function (s) { return s.id === sid; });
      var j = i + dir; if (i < 0 || j < 0 || j >= CMP.sections.length) return;
      var t = CMP.sections[i]; CMP.sections[i] = CMP.sections[j]; CMP.sections[j] = t;
      CMP.sections.forEach(function (s, k) { s.order = k; });
      var updates = CMP.sections.map(function (s) { return { id: s.id, order: s.order, gridCol: s.gridCol || 0, gridRow: s.gridRow || 0 }; });
      Promise.resolve(NewsletterBridge.reorderSections(CMP.issueId, updates)).then(function () { reopenCompose(); }).catch(function (e) { console.error('[newsletter-v2] cmpMove', e); });
    },
    // ── per-section images (parity with the legacy card-editor Images block) ──
    cmpAddImage: function (sid) {
      if (!CMP) return;
      var sec = CMP.sections.filter(function (x) { return x.id === sid; })[0];
      if (sec && (sec.images || []).length >= 3) { if (window.showToast) showToast('Max 3 images per section', true); return; }
      var IL = window.imageLibrary || {}, ids = Object.keys(IL), cur = (sec && sec.images) || [];
      var grid = ids.map(function (imgId) {
        var img = IL[imgId]; if (!img) return '';
        var on = cur.indexOf(imgId) !== -1;
        return '<div onclick="NewsletterV2.cmpSelectImage(\'' + esc(sid) + '\',\'' + esc(imgId) + '\')" ' +
          'style="cursor:pointer;border:2px solid ' + (on ? 'var(--amber)' : 'transparent') + ';border-radius:6px;overflow:hidden;">' +
          '<img src="' + esc(img.url || '') + '" alt="' + esc(img.alt || '') + '" style="width:100%;height:90px;object-fit:cover;display:block;"></div>';
      }).join('');
      var inner = ids.length
        ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;max-height:60vh;overflow-y:auto;">' + grid + '</div>'
        : '<p style="text-align:center;color:var(--warm-gray);">No images in library. Upload images in Manage → Images first.</p>';
      var html = '<div class="modal-header"><h3>Select image</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body">' + inner + '</div>';
      if (window.openModal) openModal(html);
    },
    cmpSelectImage: function (sid, imgId) {
      if (!CMP || !window.NewsletterBridge) return;
      var sec = CMP.sections.filter(function (x) { return x.id === sid; })[0]; if (!sec) return;
      if (!sec.images) sec.images = [];
      if (sec.images.indexOf(imgId) !== -1) { if (window.closeModal) closeModal(); return; }
      if (sec.images.length >= 3) { if (window.showToast) showToast('Max 3 images per section', true); return; }
      var next = sec.images.concat([imgId]);
      Promise.resolve(NewsletterBridge.updateSection(CMP.issueId, sid, { images: next })).then(function () {
        sec.images = next; if (window.closeModal) closeModal(); reopenCompose();
      }).catch(function (e) { console.error('[newsletter-v2] cmpSelectImage', e); if (window.showToast) showToast('Error adding image.', true); });
    },
    cmpRemoveImage: function (sid, idx) {
      if (!CMP || !window.NewsletterBridge) return;
      var sec = CMP.sections.filter(function (x) { return x.id === sid; })[0]; if (!sec || !sec.images) return;
      var next = sec.images.slice(); next.splice(idx, 1);
      Promise.resolve(NewsletterBridge.updateSection(CMP.issueId, sid, { images: next })).then(function () {
        sec.images = next; reopenCompose();
      }).catch(function (e) { console.error('[newsletter-v2] cmpRemoveImage', e); if (window.showToast) showToast('Error removing image.', true); });
    },
    // ── per-section coupon (parity with the legacy coupon picker) ──
    cmpPickCoupon: function (sid) {
      if (!CMP) return;
      var allC = window.coupons || {};
      var codes = Object.keys(allC).filter(function (code) {
        return (typeof window.getCouponEffectiveStatus !== 'function') || window.getCouponEffectiveStatus(allC[code]) === 'active';
      });
      if (!codes.length) { if (window.showToast) showToast('No active coupons. Create coupons in the Coupons tab first.', true); return; }
      var rows = codes.map(function (code) {
        return '<div onclick="NewsletterV2.cmpSetCoupon(\'' + esc(sid) + '\',\'' + esc(code) + '\')" ' +
          'style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;">' +
          '<span style="font-family:monospace;font-weight:600;">' + esc(code) + '</span>' +
          '<span style="color:var(--teal);font-weight:600;">' + esc(couponValStr(allC[code])) + '</span></div>';
      }).join('');
      var html = '<div class="modal-header"><h3>Select coupon</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body"><div style="display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;">' + rows + '</div></div>';
      if (window.openModal) openModal(html);
    },
    cmpSetCoupon: function (sid, code) {
      if (!CMP || !window.NewsletterBridge) return;
      if (window.closeModal) closeModal();
      var sec = CMP.sections.filter(function (x) { return x.id === sid; })[0];
      var marker = '[Coupon:' + code + ']';
      Promise.resolve(NewsletterBridge.updateSection(CMP.issueId, sid, { couponCode: code, finalContent: marker })).then(function () {
        if (sec) { sec.couponCode = code; sec.finalContent = marker; }
        reopenCompose();
      }).catch(function (e) { console.error('[newsletter-v2] cmpSetCoupon', e); if (window.showToast) showToast('Error setting coupon.', true); });
    },
    cmpPolish: function (sid) {
      if (!CMP) return;
      var el = document.getElementById('cmpEd_' + sid); if (!el) return;
      var text = cmpStrip(el.innerHTML).trim();
      if (!text) { if (window.showToast) showToast('Write some content first', true); return; }
      var sec = CMP.sections.filter(function (s) { return s.id === sid; })[0];
      var btn = (typeof event !== 'undefined' && event && event.target) ? event.target : null;
      if (btn) { btn.disabled = true; btn.textContent = 'Polishing…'; }
      function done() { if (btn) { btn.disabled = false; btn.textContent = '✨ Polish with AI'; } }
      try {
        var fn = firebase.functions().httpsCallable('socialAI');
        Promise.resolve(fn({ action: 'newsletterPolish', tenantId: MastDB.tenantId(), rawInput: text, sectionType: sec ? sec.type : 'custom' })).then(function (res) {
          var polished = (res && res.data && res.data.polished) ? res.data.polished : text;
          el.innerHTML = cmpSan(polished);
          var lim = cmpLimit((sec && sec.cardSize) || 'medium'), len = cmpStrip(el.innerHTML).length;
          var cnt = document.getElementById('cmpCnt_' + sid);
          if (cnt) { cnt.textContent = len + '/' + lim; cnt.style.color = len >= lim ? 'var(--text-danger)' : (len >= lim * 0.8 ? 'var(--amber)' : 'var(--warm-gray)'); }
          NewsletterV2._cmpSave(sid);
          done(); if (window.showToast) showToast('Polished ✨');
        }).catch(function (e) { console.error('[newsletter-v2] cmpPolish', e); done(); if (window.showToast) showToast('AI polish unavailable — use content as-is', true); });
      } catch (e) { console.error('[newsletter-v2] cmpPolish', e); done(); }
    },
    cmpPreview: function () {
      if (!CMP) return;
      var secs = CMP.sections.filter(function (s) { return s.included !== false && (s.finalContent || '').trim(); });
      var body = secs.map(function (s) {
        return '<div style="padding:16px 0;border-bottom:1px solid rgba(0,0,0,0.08);">' + (s.title ? '<div style="font-size:18px;font-weight:700;margin:0 0 8px;">' + esc(s.title) + '</div>' : '') + cmpSan(s.finalContent || '') + '</div>';
      }).join('');
      var doc = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(CMP.issue.title || 'Preview') + '</title></head>' +
        '<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:rgb(34,34,34);">' +
        '<div style="font-size:22px;font-weight:700;margin:0 0 12px;">' + esc(CMP.issue.title || '') + '</div>' + (body || '<p>No included sections with content yet.</p>') + '</body></html>';
      var w = window.open('', '_blank');
      if (w) { w.document.write(doc); w.document.close(); } else if (window.showToast) showToast('Allow pop-ups to preview', true);
    },
    cmpPublishWeb: function () {
      if (!CMP || !window.NewsletterBridge || !NewsletterBridge.publishToWebsite) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return; }
      if (typeof window.can === 'function' && !window.can('newsletter', 'edit')) { if (window.showToast) showToast('You don\'t have permission.', true); return; }
      cmpFlushAll();
      if (!CMP.issue.title || !CMP.issue.title.trim()) { if (window.showToast) showToast('Add an issue title before publishing', true); return; }
      var pub = CMP.sections.filter(function (s) { return s.included !== false && (s.finalContent || '').trim(); });
      if (!pub.length) { if (window.showToast) showToast('Add content to at least one section before publishing', true); return; }
      var sectionsMap = {}; CMP.sections.forEach(function (s) { sectionsMap[s.id] = s; });
      var issueForPublish = Object.assign({}, CMP.issue, { id: CMP.issueId, sections: sectionsMap });
      Promise.resolve(window.mastConfirm ? mastConfirm('Publish this issue to the public website (/news)?', { title: 'Publish to website?', confirmLabel: 'Publish' }) : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(NewsletterBridge.publishToWebsite(issueForPublish)).then(function (res) {
          if (window.writeAudit) writeAudit('update', 'newsletter-issue', CMP.issueId);
          if (window.showToast) showToast('Published to website 🌐 (' + ((res && res.sectionCount) || 0) + ' section' + (((res && res.sectionCount) || 0) === 1 ? '' : 's') + ')');
          var sid = CMP.issueId;
          // Refresh the cached record so the cache-first issue fetch re-opens the
          // PUBLISHED state (not the stale draft) — reloadSoon's reload is deferred.
          var cached = V2.issuesById[sid];
          if (cached) { cached.status = 'published'; cached.publishedAt = (res && res.publishedAt) || new Date().toISOString(); cached.updatedAt = cached.publishedAt; }
          reloadSoon();
          MastEntity.get('newsletter-issues-v2').fetch(sid).then(function (rec) { if (rec) MastEntity.openRecord('newsletter-issues-v2', rec, 'read'); });
        });
      }).catch(function (e) { console.error('[newsletter-v2] cmpPublishWeb', e); if (window.showToast) showToast('Error publishing.', true); });
    },
    // ── audience + A/B + send (composer PR-3) ──
    cmpSetAudience: function (seg) {
      if (!CMP || !window.NewsletterBridge) return;
      CMP.issue.audienceSegmentId = seg || null;
      Promise.resolve(NewsletterBridge.setAudienceSegment(CMP.issueId, seg)).catch(function (e) { console.error('[newsletter-v2] cmpSetAudience', e); });
      NewsletterV2.cmpRefreshCount();
    },
    cmpRefreshCount: function () {
      if (!CMP || !window.NewsletterBridge || !NewsletterBridge.matchRecipients) return;
      var el = document.getElementById('cmpRecipCount'); if (!el) return;
      Promise.resolve(NewsletterBridge.matchRecipients(CMP.issue.audienceSegmentId || '__all')).then(function (recips) {
        var n = (recips || []).length; el.textContent = MastFormat.countNoun(n, 'recipient');
      }).catch(function () { if (el) el.textContent = '—'; });
    },
    cmpAbToggle: function (on) {
      if (!CMP || !window.NewsletterBridge) return;
      var ab = CMP.issue.abTest || {};
      ab.enabled = !!on;
      if (on) { if (typeof ab.holdoutPct !== 'number') ab.holdoutPct = 50; if (typeof ab.testWindowHours !== 'number') ab.testWindowHours = 4; if (!ab.variantA) ab.variantA = {}; if (!ab.variantB) ab.variantB = {}; }
      CMP.issue.abTest = ab;
      Promise.resolve(NewsletterBridge.setAbTest(CMP.issueId, ab)).then(function () { reopenCompose(); }).catch(function (e) { console.error('[newsletter-v2] cmpAbToggle', e); });
    },
    cmpAbField: function (path, value) {
      if (!CMP || !window.NewsletterBridge) return;
      var ab = CMP.issue.abTest || {}; var parts = String(path).split('.'); var cur = ab;
      for (var i = 0; i < parts.length - 1; i++) { if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}; cur = cur[parts[i]]; }
      cur[parts[parts.length - 1]] = value;
      CMP.issue.abTest = ab;
      Promise.resolve(NewsletterBridge.setAbTest(CMP.issueId, ab)).catch(function (e) { console.error('[newsletter-v2] cmpAbField', e); });
    },
    cmpSendTest: function () {
      if (!CMP || !window.NewsletterBridge || !NewsletterBridge.queueTest) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return; }
      if (typeof window.can === 'function' && !window.can('newsletter', 'edit')) { if (window.showToast) showToast('You don\'t have permission to send.', true); return; }
      cmpFlushAll();
      var email = ((document.getElementById('cmpTestEmail') || {}).value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (window.showToast) showToast('Enter a valid test email address', true); return; }
      Promise.resolve(NewsletterBridge.queueTest(cmpIssueSnapshot(), email)).then(function () {
        if (window.showToast) showToast('Test queued to ' + email + ' — delivery in ~10s 📨');
      }).catch(function (e) { console.error('[newsletter-v2] cmpSendTest', e); if (window.showToast) showToast('Send test failed.', true); });
    },
    cmpSend: function () {
      if (!CMP || !window.NewsletterBridge || !NewsletterBridge.queueSend) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return; }
      if (typeof window.can === 'function' && !window.can('newsletter', 'edit')) { if (window.showToast) showToast('You don\'t have permission to send.', true); return; }
      if (cmpAlreadySent()) { if (window.showToast) showToast('This issue has already been sent.', true); return; }
      cmpFlushAll();
      var hasContent = CMP.sections.some(function (s) { return s.included !== false && (s.finalContent || '').trim(); });
      if (!hasContent) { if (window.showToast) showToast('Add content to at least one section before sending', true); return; }
      var ab = CMP.issue.abTest || {};
      Promise.resolve(NewsletterBridge.matchRecipients(CMP.issue.audienceSegmentId || '__all')).then(function (recips) {
        var n = (recips || []).length;
        if (!n) { if (window.showToast) showToast('No recipients matched for this audience', true); return; }
        var holdout = typeof ab.holdoutPct === 'number' ? ab.holdoutPct : 50, hours = typeof ab.testWindowHours === 'number' ? ab.testWindowHours : 4;
        var msg = ab.enabled
          ? 'Send to ' + n + ' subscribers? An A/B test goes to ' + (100 - holdout) + '% now (split A/B), then the winner goes to the remaining ' + holdout + '% after ' + hours + 'h.'
          : 'Send this issue to ' + n + ' subscribers now?';
        return Promise.resolve(window.mastConfirm ? mastConfirm(msg, { title: ab.enabled ? 'Send (with A/B test)' : 'Send' }) : true).then(function (ok) {
          if (!ok) return;
          return Promise.resolve(NewsletterBridge.queueSend(cmpIssueSnapshot(), recips)).then(function (res) {
            if (window.writeAudit) writeAudit('update', 'newsletter-issue', CMP.issueId);
            CMP.issue.sendStatus = 'sending'; CMP.issue.sendQueuedCount = res.queued; CMP.issue.sendSkippedCount = res.skipped;
            if (window.showToast) showToast('Send queued: ' + res.queued + ' email(s), ' + res.skipped + ' skipped 🚀');
            reopenCompose();
          });
        });
      }).catch(function (e) { console.error('[newsletter-v2] cmpSend', e); if (window.showToast) showToast('Error sending.', true); });
    },
    cmpPickWinner: function () {
      if (!CMP || !window.NewsletterBridge || !NewsletterBridge.pickWinnerNow) return;
      Promise.resolve(window.mastConfirm ? mastConfirm('Force-pick the A/B winner now and send to the holdout? (Normally the cron picks at the end of the test window.)', { title: 'Pick winner now' }) : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(NewsletterBridge.pickWinnerNow(CMP.issueId)).then(function () {
          if (window.showToast) showToast('Winner pick triggered — the cron queues the holdout send on its next tick (≤15 min).');
        });
      }).catch(function (e) { console.error('[newsletter-v2] cmpPickWinner', e); if (window.showToast) showToast('Error.', true); });
    },
    sortIssues: function (key) {
      if (V2.issueSortKey === key) V2.issueSortDir = (V2.issueSortDir === 'asc' ? 'desc' : 'asc');
      else { V2.issueSortKey = key; V2.issueSortDir = (key === 'date' || key === 'issueNumber' ? 'desc' : 'asc'); }
      render();
    },
    openIssue: function (id) {
      MastEntity.get('newsletter-issues-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('newsletter-issues-v2', rec, 'read');
      });
    },
    removeIssue: function (id) {
      if (typeof window.can === 'function' && !window.can('newsletter', 'delete')) {
        if (window.showToast) showToast('You don\'t have permission to delete issues.', true); return;
      }
      var n = V2.issuesById[id];
      if (n && issueStatus(n) !== 'draft') { if (window.showToast) showToast('Sent issues are the send history — they can\'t be deleted.', true); return; }
      if (!window.NewsletterBridge || !NewsletterBridge.removeIssue) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return; }
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Delete this draft issue? Its grid-builder sections go with it.', { title: 'Delete draft issue?', confirmLabel: 'Delete', dangerous: true })
        : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(NewsletterBridge.removeIssue(id)).then(function () {
          if (window.writeAudit) writeAudit('delete', 'newsletter-issue', id);
          if (window.showToast) showToast('Draft issue deleted.');
          try { U.slideOut.requestCloseForce(); } catch (e) {}
          reloadSoon();
        });
      }).catch(function (e) { console.error('[newsletter-v2] removeIssue', e); if (window.showToast) showToast('Delete failed.', true); });
    },
    // ── Duplicate-as-template (marketing-v2 LOW closer) ──
    // Clone an issue's section structure into a fresh draft template via
    // NewsletterBridge.duplicateIssue (single-sourced with the legacy
    // nlDuplicateIssue write). Opens the new draft in the native composer.
    duplicateIssue: function (id) {
      if (typeof window.can === 'function' && !window.can('newsletter', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to create issues.', true); return;
      }
      function go() {
        if (!window.NewsletterBridge || !NewsletterBridge.duplicateIssue) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return; }
        Promise.resolve(NewsletterBridge.duplicateIssue(id)).then(function (newId) {
          if (window.writeAudit) writeAudit('create', 'newsletter-issue', newId);
          if (window.showToast) showToast('Duplicated as a draft template.');
          try { U.slideOut.requestCloseForce(); } catch (e) {}
          reloadSoon();
          if (newId) NewsletterV2.compose(newId);
        }).catch(function (e) { console.error('[newsletter-v2] duplicateIssue', e); if (window.showToast) showToast('Could not duplicate: ' + (e && e.message || e), true); });
      }
      go();
    },
    // ── Export HTML (marketing-v2 LOW closer) ──
    // Build the issue's email HTML via NewsletterBridge.exportIssueHtml
    // (single-sourced with the legacy Export-HTML modal) and trigger a
    // client-side blob download. Read-only — NOT an outward send.
    exportHtml: function (id) {
      function go() {
        if (!window.NewsletterBridge || !NewsletterBridge.exportIssueHtml) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return; }
        Promise.resolve(NewsletterBridge.exportIssueHtml(id)).then(function (built) {
          built = built || {};
          if (!built.html) { if (window.showToast) showToast('Nothing to export yet.', true); return; }
          try {
            var blob = new Blob([built.html], { type: 'text/html' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = built.filename || 'newsletter.html';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (window.showToast) showToast('Exported HTML downloaded.');
          } catch (e) { console.error('[newsletter-v2] exportHtml download', e); if (window.showToast) showToast('Download failed.', true); }
        }).catch(function (e) { console.error('[newsletter-v2] exportHtml', e); if (window.showToast) showToast('Could not export: ' + (e && e.message || e), true); });
      }
      go();
    },
    exportIssuesCsv: function () { return MastEntity.exportRows('newsletter-issues-v2', visibleIssues(), 'all'); },
    exportCsv: function () { return MastEntity.exportRows('newsletter-v2', visibleRows(), V2.statusFilter); }
  };

  // newsletter-v2 now OWNS the legacy 'newsletter' route directly (T6 cut): same
  // shared tab + setup, so it renders flag-independent for all users.
  MastAdmin.registerModule('newsletter-v2', {
    routes: {
      'newsletter-v2': { tab: 'newsletterV2Tab', setup: function () { ensureTab(); render(); load(); } },
      'newsletter': { tab: 'newsletterV2Tab', setup: function () { ensureTab(); render(); load(); } }
    }
  });
})();

// ============================================================
// Absorbed from the retired newsletter.js (T6 V1 retirement).
// NewsletterBridge — the single-sourced write/compose/send layer the
// newsletter-v2 UI delegates EVERY write to (subscribers, issues, the
// native composer) — plus the rich-text editor helpers its inline
// handlers call (nlFormatCmd/nlInsertLink/nlUpdateToolbarState/nlApplyLink/
// nlRemoveLink), plus the cross-module composer hook newsletterOpenFromContent
// (consumed by composer.js). Lifted VERBATIM from newsletter.js; the only
// edits are: (a) the nlSubscribers dedup cache is self-loaded here (was
// loadNewsletter state), and (b) the never-reached `|| nlCurrentIssue`
// export-builder fallbacks are defanged to `|| null` (callers always pass an
// explicit issue). References only globals (MastDB / currentUser / MastUI /
// TENANT_CONFIG / imageLibrary / coupons / MastCouponCard / openModal /
// closeModal / navigateTo / showToast) + its own members. CampaignsBridge
// (campaigns.js) is untouched.
// ============================================================
(function () {
  'use strict';
  if (!window.MastDB) return;
  var MastDB = window.MastDB;
  var esc = (window.MastUI && MastUI._esc) ? MastUI._esc : function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // Subscriber dedup cache (was newsletter.js loadNewsletter state). Self-load
  // once; NewsletterBridge.create/update keep it coherent thereafter.
  var nlSubscribers = [];
  (function _seedNlSubs() {
    try {
      Promise.resolve(MastDB.get('newsletter/subscribers')).then(function (raw) {
        var v = (raw && typeof raw.val === 'function') ? raw.val() : (raw || {});
        nlSubscribers = Object.keys(v || {}).map(function (k) { return v[k]; }).filter(function (s) { return s && typeof s === 'object'; });
      }).catch(function () {});
    } catch (e) {}
  })();

  var NL_CARD_SIZE_MAP = {
    'studio-update':   { cardSize: 'medium', gridWidth: 1 },
    'new-products':    { cardSize: 'medium', gridWidth: 1 },
    'event-recap':     { cardSize: 'medium', gridWidth: 1 },
    'upcoming-events': { cardSize: 'large',  gridWidth: 2 },
    'behind-process':  { cardSize: 'large',  gridWidth: 2 },
    'featured-piece':  { cardSize: 'large',  gridWidth: 2 },
    'from-studio':     { cardSize: 'large',  gridWidth: 2 },
    'custom':          { cardSize: 'medium', gridWidth: 1 },
    'coupon':          { cardSize: 'medium', gridWidth: 1 }
  };

  var NL_DEFAULT_SECTIONS = [
    { type: 'studio-update', title: 'What We\'ve Been Making', guidedPrompt: 'What has the studio been working on lately? Any new techniques, materials, or directions?' },
    { type: 'new-products', title: 'New Products', guidedPrompt: 'What new pieces have been added to the shop? What\'s special about them?' },
    { type: 'event-recap', title: 'Event Recap', guidedPrompt: 'What happened at the most recent show or fair? How did it go, what sold well, any memorable moments?' },
    { type: 'upcoming-events', title: 'Upcoming Events', guidedPrompt: 'What fairs, shows, or events are coming up? Where can people find you?' },
    { type: 'behind-process', title: 'Behind the Process', guidedPrompt: 'Walk us through how a specific piece or technique is made. What makes it interesting?' },
    { type: 'featured-piece', title: 'Featured Piece', guidedPrompt: 'Spotlight one piece from the current collection. What\'s the story behind it?' },
    { type: 'from-studio', title: 'From the Studio', guidedPrompt: 'A personal note from the studio. What\'s on your mind this month?' }
  ];

  function nlBuildDefaultSections() {
    var sections = {};
    var gridCol = 0, gridRow = 0;
    NL_DEFAULT_SECTIONS.forEach(function(def, idx) {
      var secId = MastDB.newKey('_ids');
      var sizeInfo = NL_CARD_SIZE_MAP[def.type] || NL_CARD_SIZE_MAP['custom'];
      if (sizeInfo.gridWidth === 2 && gridCol !== 0) { gridRow++; gridCol = 0; }
      sections[secId] = {
        id: secId,
        type: def.type,
        title: def.title,
        guidedPrompt: def.guidedPrompt,
        rawInput: '',
        aiVersion: null,
        finalContent: '',
        usedAI: false,
        images: [],
        order: idx,
        included: true,
        cardSize: sizeInfo.cardSize,
        gridWidth: sizeInfo.gridWidth,
        gridCol: gridCol,
        gridRow: gridRow
      };
      gridCol += sizeInfo.gridWidth;
      if (gridCol >= 2) { gridCol = 0; gridRow++; }
    });
    return sections;
  }

  function nlEscHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');
  }

  function nlFormatCmd(idPrefix, cmd) {
    document.execCommand(cmd, false, null);
    nlUpdateToolbarState(idPrefix);
  }

  function nlUpdateToolbarState(idPrefix) {
    var btnBold = document.getElementById(idPrefix + 'Bold');
    var btnItalic = document.getElementById(idPrefix + 'Italic');
    if (btnBold) btnBold.classList.toggle('active', document.queryCommandState('bold'));
    if (btnItalic) btnItalic.classList.toggle('active', document.queryCommandState('italic'));
  }

  function nlInsertLink(idPrefix) {
    var sel = window.getSelection();
    if (sel.rangeCount > 0) window._nlSavedRange = sel.getRangeAt(0).cloneRange();
    var selectedText = sel.toString();
    var existingUrl = '';
    if (sel.anchorNode) {
      var linkEl = sel.anchorNode.nodeType === 1 ? sel.anchorNode.closest('a') : (sel.anchorNode.parentElement ? sel.anchorNode.parentElement.closest('a') : null);
      if (linkEl) existingUrl = linkEl.href || '';
    }
    var html = '<div class="modal-header"><h3>Insert Link</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body">' +
      (selectedText ? '<p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:8px;">Text: "' + esc(selectedText) + '"</p>' : '') +
      '<input type="url" id="nlLinkUrl" class="form-control" value="' + (existingUrl || '').replace(/"/g, '&quot;') + '" placeholder="https://..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);font-size:0.9rem;" />' +
      '</div><div class="modal-footer">' +
      (existingUrl ? '<button class="btn btn-outline" style="color:var(--danger);border-color:var(--danger);" onclick="nlRemoveLink()">Remove Link</button>' : '') +
      '<button class="btn btn-primary" onclick="nlApplyLink()">Apply</button>' +
      '</div>';
    openModal(html);
    setTimeout(function() { var inp = document.getElementById('nlLinkUrl'); if (inp) inp.focus(); }, 100);
  }

  function nlApplyLink() {
    var url = (document.getElementById('nlLinkUrl') || {}).value;
    if (!url) { closeModal(); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    closeModal();
    if (window._nlSavedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(window._nlSavedRange);
    }
    document.execCommand('createLink', false, url);
    // Force target=_blank on newly created links
    var editables = document.querySelectorAll('.nl-section-editable');
    editables.forEach(function(ed) {
      var links = ed.querySelectorAll('a[href="' + url + '"]');
      links.forEach(function(a) { a.target = '_blank'; a.rel = 'noopener'; });
    });
  }

  function nlRemoveLink() {
    closeModal();
    if (window._nlSavedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(window._nlSavedRange);
    }
    document.execCommand('unlink', false, null);
  }

  function nlRenderSectionContentForExport(sec) {
    // For coupon sections, render the email-safe coupon card
    if (sec.type === 'coupon' && sec.couponCode && window.MastCouponCard) {
      var allCoupons = window.coupons || {};
      var c = allCoupons[sec.couponCode];
      if (c) {
        return window.MastCouponCard.renderHtml(
          Object.assign({}, c, { code: sec.couponCode, _code: sec.couponCode }),
          { emailSafe: true, showCta: true, source: 'newsletter' }
        );
      }
    }
    var content = sec.finalContent || sec.rawInput || '';
    return '<div style="font-size:15px;line-height:1.7;color:#444;margin:0;">' + content + '</div>';
  }

  function nlBuildExportHtml(issueArg) {
    var issue = issueArg || null;
    if (!issue) return { html: '', filename: 'newsletter.html' };

    var sections = issue.sections ? Object.values(issue.sections)
      .filter(function(s) { return s.included; })
      .sort(function(a, b) { return (a.order || 0) - (b.order || 0); }) : [];

    var sectionsHtml = '';
    var rows = [], currentRow = [], currentRowCols = 0;
    sections.forEach(function(sec) {
      var content = sec.finalContent || sec.rawInput || '';
      if (sec.type !== 'coupon' && !content.trim()) return;
      if (sec.type === 'coupon' && !sec.couponCode) return;
      var width = sec.gridWidth || 1;
      if (currentRowCols + width > 2) {
        if (currentRow.length > 0) rows.push(currentRow);
        currentRow = [sec]; currentRowCols = width;
      } else {
        currentRow.push(sec); currentRowCols += width;
      }
    });
    if (currentRow.length > 0) rows.push(currentRow);

    rows.forEach(function(row) {
      if (row.length === 1 && (row[0].gridWidth || 1) >= 2) {
        var sec = row[0];
        var content = sec.finalContent || sec.rawInput || '';
        sectionsHtml += '<tr><td style="padding:0 30px 30px;">' +
          '<h2 style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:22px;color:#2C2C2C;margin:0 0 12px;font-weight:600;">' + nlEscHtml(sec.title) + '</h2>' +
          nlRenderSectionContentForExport(sec);
        (sec.images || []).forEach(function(imgId) {
          var img = imageLibrary ? imageLibrary[imgId] : null;
          if (img) sectionsHtml += '<img src="' + img.url + '" alt="' + (img.alt || '') + '" style="max-width:100%;height:auto;border-radius:4px;margin-top:16px;" />';
        });
        sectionsHtml += '</td></tr>';
      } else if (row.length === 1) {
        var sec = row[0];
        var content = sec.finalContent || sec.rawInput || '';
        sectionsHtml += '<tr><td style="padding:0 30px 30px;">' +
          '<h2 style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:22px;color:#2C2C2C;margin:0 0 12px;font-weight:600;">' + nlEscHtml(sec.title) + '</h2>' +
          nlRenderSectionContentForExport(sec);
        (sec.images || []).forEach(function(imgId) {
          var img = imageLibrary ? imageLibrary[imgId] : null;
          if (img) sectionsHtml += '<img src="' + img.url + '" alt="' + (img.alt || '') + '" style="max-width:100%;height:auto;border-radius:4px;margin-top:16px;" />';
        });
        sectionsHtml += '</td></tr>';
      } else {
        sectionsHtml += '<tr><td style="padding:0 30px 30px;"><table width="100%" cellpadding="0" cellspacing="0"><tr>';
        row.forEach(function(sec, idx) {
          var content = sec.finalContent || sec.rawInput || '';
          sectionsHtml += '<td style="width:50%;vertical-align:top;' + (idx > 0 ? 'padding-left:15px;' : 'padding-right:15px;') + '">' +
            '<h2 style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:18px;color:#2C2C2C;margin:0 0 8px;font-weight:600;">' + nlEscHtml(sec.title) + '</h2>' +
            nlRenderSectionContentForExport(sec);
          (sec.images || []).forEach(function(imgId) {
            var img = imageLibrary ? imageLibrary[imgId] : null;
            if (img) sectionsHtml += '<img src="' + img.url + '" alt="' + (img.alt || '') + '" style="max-width:100%;height:auto;border-radius:4px;margin-top:12px;" />';
          });
          sectionsHtml += '</td>';
        });
        sectionsHtml += '</tr></table></td></tr>';
      }
      sectionsHtml += '<tr><td style="padding:0 30px;"><hr style="border:none;border-top:1px solid #E8DDD0;margin:10px 0 20px;" /></td></tr>';
    });

    var _ec = TENANT_CONFIG || { brand: { name: 'Newsletter', tagline: '', location: '', logoUrl: '' }, domain: 'localhost' };
    var emailHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
      '<title>' + esc(issue.subjectLine || issue.title || (_ec.brand.name + ' — Issue #' + issue.issueNumber)) + '</title></head>' +
      '<body style="margin:0;padding:0;background:#F5F0EB;font-family:\'DM Sans\',Arial,sans-serif;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0EB;"><tr><td align="center" style="padding:30px 10px;">' +
      '<table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:8px;overflow:hidden;max-width:600px;">' +
      '<!-- Header -->' +
      '<tr><td style="background:#2C2C2C;padding:16px 30px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="width:48px;"><img src="' + esc(_ec.brand.logoUrl) + '" alt="' + esc(_ec.brand.name) + '" width="48" style="display:block;" /></td>' +
      '<td style="padding-left:14px;">' +
      '<h1 style="font-family:\'Cormorant Garamond\',Georgia,serif;color:#F5F0EB;font-size:20px;margin:0;font-weight:300;letter-spacing:0.02em;">' + esc(_ec.brand.name) + '</h1>' +
      '<p style="color:rgba(245,240,235,0.4);font-size:9px;letter-spacing:0.12em;text-transform:uppercase;margin:0;">' + esc(_ec.brand.tagline) + ' &bull; ' + esc(_ec.brand.location) + '</p></td>' +
      '<td style="text-align:right;white-space:nowrap;"><span style="color:rgba(245,240,235,0.5);font-size:10px;">Issue #' + issue.issueNumber + '</span></td>' +
      '</tr></table>' +
      '</td></tr>' +
      '<!-- Title -->' +
      '<tr><td style="padding:30px 30px 10px;"><h1 style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:26px;color:#2C2C2C;margin:0;font-weight:400;">' + nlEscHtml(issue.title) + '</h1></td></tr>' +
      '<!-- Sections -->' +
      sectionsHtml +
      '<!-- Footer -->' +
      '<tr><td style="background:#2C2C2C;padding:24px 30px;text-align:center;">' +
      '<p style="font-family:\'Cormorant Garamond\',Georgia,serif;color:rgba(245,240,235,0.7);font-size:14px;margin:0;">' + esc(_ec.brand.name) + '</p>' +
      '<p style="color:rgba(245,240,235,0.5);font-size:11px;margin:4px 0 0;">' + esc(_ec.brand.tagline) + ' from ' + esc(_ec.brand.location) + '</p>' +
      '<p style="margin:10px 0 8px;">' +
      '<a href="https://' + esc(_ec.domain) + '" style="color:rgba(245,240,235,0.5);font-size:11px;text-decoration:underline;margin:0 8px;">Website</a>' +
      '<a href="https://' + esc(_ec.domain) + '/shop" style="color:rgba(245,240,235,0.5);font-size:11px;text-decoration:underline;margin:0 8px;">Shop</a>' +
      '<a href="https://' + esc(_ec.domain) + '/schedule" style="color:rgba(245,240,235,0.5);font-size:11px;text-decoration:underline;margin:0 8px;">Events</a></p>' +
      '<hr style="border:none;border-top:1px solid rgba(245,240,235,0.15);width:40px;margin:10px auto;" />' +
      '<p style="color:rgba(245,240,235,0.3);font-size:10px;margin:0;">You received this because you subscribed to ' + esc(_ec.brand.name) + ' updates.</p>' +
      '<p style="margin:4px 0 0;"><a href="https://' + esc(_ec.domain) + '/newsletter/unsubscribe?token={SUBSCRIBER_TOKEN}" style="color:rgba(245,240,235,0.35);font-size:10px;text-decoration:underline;">Unsubscribe</a>' +
      ' &bull; <a href="https://' + esc(_ec.domain) + '/newsletter/preferences" style="color:rgba(245,240,235,0.35);font-size:10px;text-decoration:underline;">Manage Preferences</a></p>' +
      '</td></tr></table></td></tr></table></body></html>';

    var filename = ((TENANT_CONFIG && TENANT_CONFIG.brand.newsletterDownloadPrefix) || 'newsletter') + '-' + issue.issueNumber + '-' + (issue.slug || 'newsletter') + '.html';

    return { html: emailHtml, filename: filename };
  }

  function nlComposeIssueHtml(issueOverride) {
    var issue = issueOverride || null;
    if (!issue) return '';
    var brand = (window.TENANT_CONFIG && window.TENANT_CONFIG.brand) || {};
    var sections = issue.sections ? Object.keys(issue.sections).map(function(k) {
      var s = issue.sections[k]; s.id = s.id || k; return s;
    }).filter(function(s) { return s.included !== false; }).sort(function(a, b) {
      return (a.order || 0) - (b.order || 0);
    }) : [];
    var headerHtml = '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#0f1014;padding:20px 24px;color:#f5f0eb;font-family:sans-serif;">' +
      '<div style="font-size:20px;font-weight:700;">' + nlEscHtml(brand.name || 'Newsletter') + '</div>' +
      (brand.tagline ? '<div style="font-size:12px;color:#aaa;margin-top:4px;">' + nlEscHtml(brand.tagline) + '</div>' : '') +
      '</td></tr></table>';
    var body = sections.map(function(sec) {
      var content = sec.finalContent || sec.rawInput || '';
      return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr><td style="padding:16px 24px;background:#fff;font-family:sans-serif;color:#222;font-size:15px;line-height:1.5;">' +
        (sec.title ? '<h2 style="font-size:18px;margin:0 0 8px;">' + nlEscHtml(sec.title) + '</h2>' : '') +
        content +
        '</td></tr></table>';
    }).join('');
    var footer = '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#f5f0eb;padding:16px 24px;color:#777;font-family:sans-serif;font-size:12px;text-align:center;">' +
      'You received this because you subscribed to ' + nlEscHtml(brand.name || 'our') + ' updates.' +
      '</td></tr></table>';
    return '<!doctype html><html><body style="margin:0;padding:0;background:#f0eee9;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">' +
      '<tr><td>' + headerHtml + '</td></tr>' +
      '<tr><td>' + body + '</td></tr>' +
      '<tr><td>' + footer + '</td></tr>' +
      '</table></td></tr></table></body></html>';
  }

  function _nlSha1Hex(s) {
    var enc = new TextEncoder().encode(s);
    return crypto.subtle.digest('SHA-1', enc).then(function(buf) {
      var bytes = new Uint8Array(buf);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        var h = bytes[i].toString(16);
        if (h.length < 2) h = '0' + h;
        hex += h;
      }
      return hex;
    });
  }

  window.NewsletterBridge = {
    // Returns the dedup result so the twin can surface the same error legacy does.
    isDuplicate: function (email) {
      var e = String(email || '').toLowerCase();
      return nlSubscribers.some(function (s) { return s.email && s.email.toLowerCase() === e && s.status === 'active'; });
    },
    create: async function (data) {
      var name = (data.name || '').trim();
      var email = (data.email || '').trim();
      var notes = (data.notes || '').trim();
      var subId = MastDB.newsletter.subscribers.newKey();
      var token = subId + '-' + Date.now().toString(36);
      var subData = {
        id: subId, name: name, email: email, notes: notes || null,
        subscribedAt: new Date().toISOString(), source: 'manual',
        status: 'active', unsubscribeToken: token, unsubscribedAt: null
      };
      await MastDB.newsletter.subscribers.ref(subId).set(subData);
      nlSubscribers.unshift(subData);
      return subId;
    },
    // Mirrors nlUnsubscribe's targeted .update() — the only legacy mutation on an
    // existing subscriber. Accepts name/email/notes/status; on a transition to
    // 'unsubscribed' it stamps unsubscribedAt exactly as the legacy path does, and
    // clears it on re-subscribe. Keeps the in-memory legacy list coherent.
    update: async function (id, data) {
      var updates = {};
      if (typeof data.name === 'string') updates.name = data.name.trim();
      if (typeof data.email === 'string') updates.email = data.email.trim();
      if ('notes' in data) updates.notes = (data.notes || '').trim() || null;
      var sub = nlSubscribers.find(function (s) { return s.id === id; });
      if (data.status && data.status !== (sub && sub.status)) {
        updates.status = data.status;
        updates.unsubscribedAt = data.status === 'unsubscribed' ? new Date().toISOString() : null;
      }
      await MastDB.newsletter.subscribers.ref(id).update(updates);
      if (sub) Object.assign(sub, updates);
      return id;
    },
    // Native issue create for newsletter-v2. Mirrors nlCreateIssue's record
    // shape + default-section seeding (shared via nlBuildDefaultSections) so the
    // legacy grid Composer opens a fully-formed draft. Composing + sending stay
    // on the Composer; this only mints the draft record (number + title +
    // subject + default sections). Title falls back to the legacy "Draft — MMM D"
    // auto-name when blank.
    createIssue: async function (data) {
      data = data || {};
      var counterRef = MastDB.newsletter.meta.issueCounter();
      var result = await counterRef.transaction(function (current) { return (current || 0) + 1; });
      var issueNumber = result.snapshot.val();
      var issueId = MastDB.newsletter.issues.newKey();
      var draftLabel = 'Draft — ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var issueData = {
        id: issueId,
        issueNumber: issueNumber,
        title: (data.title || '').trim() || draftLabel,
        slug: '',
        status: 'draft',
        sentAt: null,
        publishedAt: null,
        sentSubscriberCount: null,
        subjectLine: (data.subjectLine || '').trim(),
        audienceSegmentId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sections: nlBuildDefaultSections()
      };
      await MastDB.newsletter.issues.ref(issueId).set(issueData);
      if (typeof nlIssues !== 'undefined' && Array.isArray(nlIssues)) nlIssues.unshift(issueData);
      return issueId;
    },
    // Light edit for a DRAFT issue (title / subject line). The grid Composer
    // owns sections + send; callers gate on status==='draft'.
    updateIssue: async function (id, data) {
      data = data || {};
      var updates = { updatedAt: new Date().toISOString() };
      if (typeof data.title === 'string') updates.title = data.title.trim();
      if (typeof data.subjectLine === 'string') updates.subjectLine = data.subjectLine.trim();
      await MastDB.newsletter.issues.ref(id).update(updates);
      if (typeof nlIssues !== 'undefined' && Array.isArray(nlIssues)) {
        var iss = nlIssues.find(function (x) { return x.id === id; });
        if (iss) Object.assign(iss, updates);
      }
      return updates;
    },
    // Draft-issue deletion (marketing-v2 Wave 3). Sent/published issues are
    // the send HISTORY — they never delete; callers gate on status==='draft'.
    removeIssue: async function (id) {
      await MastDB.remove('newsletter/issues/' + id);
      return true;
    },

    // ── Native composer write layer (V1-editor-elimination program) ──
    // Single-sources every section/grid/publish write so the native V2 composer
    // (newsletter-v2) never writes MastDB directly. Section rich-text (finalContent)
    // is ALWAYS sanitized here via MastUI.sanitizeHtml before it lands — because
    // both the email builder (nlComposeIssueHtml) and the public web copy
    // (nlPublishToWebsite) inject section content RAW. The V2 twin gates these on
    // the newsletter edit permission before calling.
    _san: function (h) {
      if (window.MastUI && typeof MastUI.sanitizeHtml === 'function') return MastUI.sanitizeHtml(h);
      return String(h == null ? '' : h).replace(/[<>]/g, function (c) { return c === '<' ? '&lt;' : '&gt;'; });
    },
    // Add a section (mirrors nlAddSection's record shape). Caller supplies the
    // next order; grid coordinates start at 0,0 and the caller re-packs + persists
    // layout via reorderSections. Returns the new section object.
    addSection: async function (issueId, type, order) {
      type = type || 'custom';
      var secId = MastDB.newKey('_ids');
      var sizeInfo = (typeof NL_CARD_SIZE_MAP !== 'undefined' && (NL_CARD_SIZE_MAP[type] || NL_CARD_SIZE_MAP.custom)) || { cardSize: 'medium', gridWidth: 1 };
      var sec = {
        id: secId, type: type, title: type === 'coupon' ? 'Special Offer' : 'New Section', guidedPrompt: '',
        rawInput: '', aiVersion: null, finalContent: '', usedAI: false,
        images: [], order: (typeof order === 'number' ? order : 0), included: true,
        cardSize: sizeInfo.cardSize, gridWidth: sizeInfo.gridWidth, gridCol: 0, gridRow: 0, couponCode: null
      };
      await MastDB.newsletter.issues.section(issueId, secId).set(sec);
      return sec;
    },
    // Update section fields. finalContent is sanitized; title stays raw (escaped
    // at render via nlEscHtml). Only provided keys are written.
    updateSection: async function (issueId, secId, patch) {
      patch = patch || {};
      var updates = {};
      if (typeof patch.title === 'string') updates.title = patch.title;
      if (typeof patch.finalContent === 'string') updates.finalContent = this._san(patch.finalContent);
      if (typeof patch.rawInput === 'string') updates.rawInput = patch.rawInput;
      if (typeof patch.included === 'boolean') updates.included = patch.included;
      if (typeof patch.cardSize === 'string') updates.cardSize = patch.cardSize;
      if (typeof patch.gridWidth === 'number') updates.gridWidth = patch.gridWidth;
      if (Array.isArray(patch.images)) updates.images = patch.images;
      if ('couponCode' in patch) updates.couponCode = patch.couponCode || null;
      if (typeof patch.usedAI === 'boolean') updates.usedAI = patch.usedAI;
      await MastDB.newsletter.issues.section(issueId, secId).update(updates);
      return updates;
    },
    // Delete a section + persist the re-packed layout for the survivors.
    // remaining = [{ id, order, gridCol, gridRow }, ...] (caller re-packs).
    deleteSection: async function (issueId, secId, remaining) {
      var fb = {};
      fb['newsletter/issues/' + issueId + '/sections/' + secId] = null;
      (remaining || []).forEach(function (s) {
        var p = 'newsletter/issues/' + issueId + '/sections/' + s.id + '/';
        fb[p + 'order'] = s.order; fb[p + 'gridCol'] = s.gridCol; fb[p + 'gridRow'] = s.gridRow;
      });
      await MastDB.multiUpdate(fb);
      return true;
    },
    // Persist a re-packed grid order. updates = [{ id, order, gridCol, gridRow }].
    reorderSections: async function (issueId, updates) {
      var fb = {};
      (updates || []).forEach(function (s) {
        var p = 'newsletter/issues/' + issueId + '/sections/' + s.id + '/';
        fb[p + 'order'] = s.order; fb[p + 'gridCol'] = s.gridCol; fb[p + 'gridRow'] = s.gridRow;
      });
      if (Object.keys(fb).length) await MastDB.multiUpdate(fb);
      return true;
    },
    setAudienceSegment: async function (issueId, segmentId) {
      // Write audienceSegmentId (the field the picker + queueSend agree on; the
      // legacy nlSendIssue read the never-set `segmentId` → always "all", a bug we
      // don't reproduce in the native path).
      await MastDB.newsletter.issues.ref(issueId).update({ audienceSegmentId: segmentId || null, updatedAt: new Date().toISOString() });
      return true;
    },
    setAbTest: async function (issueId, ab) {
      await MastDB.newsletter.issues.ref(issueId).update({ abTest: ab || null, updatedAt: new Date().toISOString() });
      return true;
    },
    // Publish to the public web (mirrors nlPublishToWebsite). Section content is
    // re-sanitized on the way out (defense-in-depth alongside updateSection).
    publishToWebsite: async function (issue) {
      issue = issue || {};
      var self = this;
      var sections = issue.sections ? Object.values(issue.sections)
        .filter(function (s) { return s.included && (s.finalContent || s.rawInput); })
        .sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
        .map(function (s) { return { title: s.title, content: self._san(s.finalContent || s.rawInput), images: s.images || [], cardSize: s.cardSize || 'medium', gridWidth: s.gridWidth || 1 }; }) : [];
      var publishedAt = new Date().toISOString();
      await MastDB.newsletter.published.ref(issue.id).set({
        issueNumber: issue.issueNumber, title: issue.title, subjectLine: issue.subjectLine || '',
        slug: issue.slug, publishedAt: publishedAt, sections: sections
      });
      await MastDB.newsletter.issues.ref(issue.id).update({ status: 'published', publishedAt: publishedAt, updatedAt: publishedAt });
      return { publishedAt: publishedAt, sectionCount: sections.length };
    },

    // ── send pipeline (composer PR-3) ──
    // Self-contained recipient resolution — loads subscribers (+ customer stats
    // for the order-based segments) FRESH, since the legacy in-memory nlSubscribers
    // / nlCustomerStatsByEmail aren't populated in the V2 context. Mirrors
    // nlMatchSubscribersForSegment's filter semantics.
    matchRecipients: async function (segmentId) {
      var subsRaw = await MastDB.get('newsletter/subscribers');
      var sv = (subsRaw && typeof subsRaw.val === 'function') ? subsRaw.val() : (subsRaw || {});
      var active = Object.keys(sv || {}).map(function (k) { return sv[k]; }).filter(function (s) { return s && s.status === 'active' && s.email; });
      var statsSegs = { __has_orders: 1, __no_orders: 1, __repeat_2: 1, __lapsed_90: 1 };
      if (!statsSegs[segmentId]) return active; // __all / saved / null → all active
      var statsBy = {};
      try {
        var custRaw = await MastDB.get('admin/customers');
        var cv = (custRaw && typeof custRaw.val === 'function') ? custRaw.val() : (custRaw || {});
        Object.keys(cv || {}).forEach(function (cid) {
          var c = cv[cid]; if (!c) return;
          var emails = [];
          if (c.primaryEmail) emails.push(c.primaryEmail);
          (c.emails || []).forEach(function (e) { if (typeof e === 'string') emails.push(e); else if (e && e.address) emails.push(e.address); });
          var st = c.stats || {};
          emails.forEach(function (e) { var key = String(e).toLowerCase().trim(); if (key) statsBy[key] = { orderCount: st.orderCount || 0, lastOrderAt: st.lastOrderAt || null }; });
        });
      } catch (e) {}
      var ninety = Date.now() - 90 * 86400 * 1000;
      return active.filter(function (sub) {
        var key = String(sub.email || '').toLowerCase().trim();
        var st = statsBy[key] || null;
        switch (segmentId) {
          case '__has_orders': return !!(st && st.orderCount > 0);
          case '__no_orders': return !st || !st.orderCount;
          case '__repeat_2': return !!(st && st.orderCount >= 2);
          case '__lapsed_90': if (!st || !st.lastOrderAt) return false; return new Date(st.lastOrderAt).getTime() < ninety;
          default: return true;
        }
      });
    },
    // Queue a single test email (mirrors nlSendTest; the V2 UI supplies the address
    // so there is no window.prompt). Body composed via the in-module builder.
    queueTest: async function (issue, toEmail) {
      var subject = (issue.subjectLine || issue.title || '(test)') + ' [TEST]';
      var htmlBody = nlComposeIssueHtml(issue);
      var key = 'test-' + issue.id + '-' + Date.now();
      await MastDB.set('emailQueue/' + key, {
        id: key, type: 'test', issueId: issue.id, subject: subject, htmlBody: htmlBody, to: toEmail,
        idempotencyKey: key, queuedAt: new Date().toISOString(),
        queuedBy: (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || null, status: 'queued'
      });
      return key;
    },
    // Per-recipient queue write with sha1 idempotency (issueId|segment|email|variant)
    // — keeps the EXACT key formula + emailQueue/admin/emailSends shape as legacy
    // _nlQueueRecipients so the queue processor + re-send skip behave identically.
    _queueRecipients: async function (issueId, recipients, subject, htmlBody, variantTag, segmentId) {
      var queued = 0, skipped = 0, nowIso = new Date().toISOString();
      for (var i = 0; i < recipients.length; i++) {
        var r = recipients[i]; if (!r || !r.email) continue;
        var lower = String(r.email).toLowerCase();
        var keyInput = issueId + '|' + (segmentId || '') + '|' + lower + '|' + (variantTag || 'main');
        var idk;
        try { idk = await _nlSha1Hex(keyInput); } catch (_e) { idk = issueId + '_' + lower.replace(/[^a-z0-9]/g, '_') + '_' + (variantTag || 'main'); }
        try { var prior = await MastDB.get('emailQueue/' + idk); if (prior) { skipped++; continue; } } catch (_e) {}
        try {
          await MastDB.set('emailQueue/' + idk, {
            id: idk, type: 'newsletter', issueId: issueId, segmentId: segmentId || null, variant: variantTag || null,
            subject: subject, htmlBody: htmlBody, to: r.email, toName: r.name || null, idempotencyKey: idk,
            queuedAt: nowIso, queuedBy: (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || null, status: 'queued'
          });
          await MastDB.set('admin/emailSends/' + idk, {
            idempotencyKey: idk, type: 'newsletter', issueId: issueId, segmentId: segmentId || null,
            variant: variantTag || null, to: r.email, queuedAt: nowIso, status: 'queued'
          });
          queued++;
        } catch (err) { console.warn('queue write failed for ' + lower, err); }
      }
      return { queued: queued, skipped: skipped };
    },
    // Real send to the issue's audience. Mirrors nlSendIssue: optional A/B split
    // (deterministic email-hash A/B/holdout) with the holdout + variantB.htmlBody
    // stashed on the issue for the winner cron. Returns counts. Caller confirms +
    // gates; recipients are pre-resolved via matchRecipients.
    queueSend: async function (issue, recipients) {
      var self = this;
      var seg = issue.audienceSegmentId || '__all';
      if (!recipients) recipients = await this.matchRecipients(seg);
      if (!recipients.length) return { queued: 0, skipped: 0, recipients: 0 };
      var ab = issue.abTest || {};
      var subjectA = issue.subjectLine || issue.title || '(no subject)';
      var htmlBody = nlComposeIssueHtml(issue);
      var nowIso = new Date().toISOString();
      var queued = 0, skipped = 0;
      if (ab.enabled) {
        var holdoutPct = typeof ab.holdoutPct === 'number' ? ab.holdoutPct : 50;
        var testHours = typeof ab.testWindowHours === 'number' ? ab.testWindowHours : 4;
        var hashed = recipients.map(function (r) {
          var s = String(r.email || '').toLowerCase(), h = 0;
          for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
          return { r: r, h: h };
        }).sort(function (a, b) { return a.h - b.h; });
        var testCount = Math.floor(hashed.length * (100 - holdoutPct) / 100);
        var halfTest = Math.floor(testCount / 2);
        var aRec = hashed.slice(0, halfTest).map(function (x) { return x.r; });
        var bRec = hashed.slice(halfTest, testCount).map(function (x) { return x.r; });
        var holdout = hashed.slice(testCount).map(function (x) { return x.r; });
        var subjectB = (ab.variantB && ab.variantB.subject) || subjectA;
        var abPersist = Object.assign({}, ab, {
          sendStartedAt: nowIso,
          testWindowExpiresAt: new Date(Date.now() + testHours * 3600 * 1000).toISOString(),
          winner: null, winnerPickedAt: null, holdoutSendStartedAt: null,
          variantA: Object.assign({}, ab.variantA || {}, { subject: subjectA, recipientCount: aRec.length }),
          variantB: Object.assign({}, ab.variantB || {}, { subject: subjectB, recipientCount: bRec.length, htmlBody: htmlBody }),
          holdoutRecipients: holdout
        });
        await MastDB.newsletter.issues.ref(issue.id).update({ abTest: abPersist, subject: subjectA, htmlBody: htmlBody, sendStatus: 'sending', sendStartedAt: nowIso, updatedAt: nowIso });
        var qa = await self._queueRecipients(issue.id, aRec, subjectA, htmlBody, 'A', seg);
        var qb = await self._queueRecipients(issue.id, bRec, subjectB, htmlBody, 'B', seg);
        queued = qa.queued + qb.queued; skipped = qa.skipped + qb.skipped;
      } else {
        await MastDB.newsletter.issues.ref(issue.id).update({ subject: subjectA, htmlBody: htmlBody, sendStatus: 'sending', sendStartedAt: nowIso, updatedAt: nowIso });
        var qr = await self._queueRecipients(issue.id, recipients, subjectA, htmlBody, null, seg);
        queued = qr.queued; skipped = qr.skipped;
      }
      try { await MastDB.newsletter.issues.ref(issue.id).update({ sendQueuedCount: queued, sendSkippedCount: skipped, sendStatus: 'sending' }); } catch (_e) {}
      return { queued: queued, skipped: skipped, recipients: recipients.length };
    },
    // Manual A/B winner override (mirrors nlPickWinnerNow): nudge the cron to pick
    // on its next tick by expiring the test window.
    pickWinnerNow: async function (issueId) {
      await MastDB.newsletter.issues.ref(issueId).update({ 'abTest/testWindowExpiresAt': new Date().toISOString() });
      return true;
    },

    // ── marketing-v2 LOW closer: duplicate-as-template + export-HTML ──
    // Duplicate an issue as a fresh draft TEMPLATE — single-sourced with the
    // legacy nlDuplicateIssue: a new draft (next issue number) that clones the
    // source's section STRUCTURE (type / title / prompt / layout) but clears the
    // authored content (rawInput / aiVersion / finalContent / images / coupon),
    // so it's a reusable starting template. Returns the new issue id (the V2
    // twin opens it in the native composer). The source is untouched.
    duplicateIssue: async function (issueId) {
      var source = await MastDB.get('newsletter/issues/' + issueId);
      source = (source && typeof source.val === 'function') ? source.val() : source;
      if (!source || !source.sections) throw new Error('Nothing to duplicate');
      var counterRef = MastDB.newsletter.meta.issueCounter();
      var result = await counterRef.transaction(function (current) { return (current || 0) + 1; });
      var issueNumber = result.snapshot.val();
      var newId = MastDB.newsletter.issues.newKey();
      var newIssue = {
        id: newId, issueNumber: issueNumber, title: '', subjectLine: '', slug: '',
        status: 'draft', sentAt: null, publishedAt: null, sentSubscriberCount: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      var sections = {};
      Object.values(source.sections).sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (s) {
        var secId = MastDB.newKey('_ids');
        sections[secId] = {
          id: secId, type: s.type, title: s.title, guidedPrompt: s.guidedPrompt || '',
          rawInput: '', aiVersion: null, finalContent: '', usedAI: false,
          images: [], order: s.order, included: s.included,
          cardSize: s.cardSize || 'medium', gridWidth: s.gridWidth || 1,
          gridCol: s.gridCol || 0, gridRow: s.gridRow || 0, couponCode: null
        };
      });
      newIssue.sections = sections;
      await MastDB.newsletter.issues.ref(newId).set(newIssue);
      if (typeof nlIssues !== 'undefined' && Array.isArray(nlIssues)) nlIssues.unshift(newIssue);
      return newId;
    },
    // Export an issue's rendered email HTML — single-sourced with the legacy
    // Export-HTML modal via nlBuildExportHtml. Reads the issue FRESH so any
    // just-saved sections are reflected. Returns { html, filename }; the V2 twin
    // triggers a client-side blob download (not an outward send).
    exportIssueHtml: async function (issueId) {
      var issue = await MastDB.get('newsletter/issues/' + issueId);
      issue = (issue && typeof issue.val === 'function') ? issue.val() : issue;
      if (!issue) throw new Error('Issue not found');
      if (!issue.id) issue.id = issueId;
      return nlBuildExportHtml(issue);
    }
  };

  async function newsletterOpenFromContent(contentId) {
    try {
      var c = await MastDB.get('admin/content/' + contentId);
      if (!c) { if (typeof showToast === 'function') showToast('Content not found', true); return; }
      // Composer-driven newsletter sections aren't tied to a specific issue
      // editor in v1 — we simply persist a "loose" section under the
      // newsletter sections collection so the operator can attach it to an
      // issue manually from the Newsletter UI.
      var sectionId = MastDB.newKey('admin/newsletterSections');
      await MastDB.set('admin/newsletterSections/' + sectionId, {
        id: sectionId,
        title: c.title || '',
        body: c.body || '',
        source: 'composer',
        sourceContentId: contentId,
        createdAt: new Date().toISOString()
      });
      if (typeof navigateTo === 'function') navigateTo('newsletter');
      if (typeof showToast === 'function') showToast('Newsletter section drafted from content');
    } catch (e) { console.warn('[newsletter] openFromContent', e); }
  }

  // Cross-boundary exports the newsletter-v2 inline editor handlers + the
  // composer.js content hook resolve against window.
  window.nlFormatCmd = nlFormatCmd;
  window.nlUpdateToolbarState = nlUpdateToolbarState;
  window.nlInsertLink = nlInsertLink;
  window.nlApplyLink = nlApplyLink;
  window.nlRemoveLink = nlRemoveLink;
  window.newsletterOpenFromContent = newsletterOpenFromContent;
})();
