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
        var actions = '';
        if (st === 'draft' && (typeof window.can !== 'function' || window.can('newsletter', 'delete'))) {
          actions = '<div style="margin:0 0 12px;"><button class="btn btn-secondary btn-small" style="color:var(--text-danger);" onclick="NewsletterV2.removeIssue(\'' + esc(id) + '\')">Delete draft</button></div>';
        }
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
        // Part-of-campaign chip — single-sourced renderer in campaigns.js.
        setTimeout(function () {
          if (window.MastAdmin && MastAdmin.loadModule) {
            MastAdmin.loadModule('campaigns').then(function () {
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
    return '<div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px;">' + header + editor + '</div>';
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
    // Ensure the legacy newsletter module is loaded so window.NewsletterBridge
    // (the delegated write path) + its in-memory nlSubscribers (dedup source)
    // exist — mirrors contacts-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('newsletter'); } catch (e) {} }
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
          count: N.count(V2.issues.length) + ' issue' + (V2.issues.length === 1 ? '' : 's'),
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
      // Ensure the legacy module (and thus window.NewsletterBridge + nlSubscribers)
      // is loaded before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('newsletter'); } catch (e) {} }
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
      // Ensure legacy newsletter.js is loaded so window.NewsletterBridge.createIssue exists at save.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('newsletter'); } catch (e) {} }
      MastEntity.openRecord('newsletter-issues-v2', {}, 'create');
    },
    // ── native composer (PR-2): drilled section/grid editor ──
    compose: function (id) {
      if (typeof window.can === 'function' && !window.can('newsletter', 'edit')) { if (window.showToast) showToast('You don\'t have permission to edit issues.', true); return; }
      // AWAIT the legacy module so window.NewsletterBridge + the reused rich-text
      // globals (nlFormatCmd / nlInsertLink / nlUpdateToolbarState) exist before the
      // composer's inline toolbar handlers can fire.
      function go() { MastEntity.drill('newsletter-compose-v2', id); }
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        Promise.resolve(MastAdmin.loadModule('newsletter')).then(go).catch(go);
      } else go();
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
        var n = (recips || []).length; el.textContent = n + ' recipient' + (n === 1 ? '' : 's');
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
    exportIssuesCsv: function () { return MastEntity.exportRows('newsletter-issues-v2', visibleIssues(), 'all'); },
    exportCsv: function () { return MastEntity.exportRows('newsletter-v2', visibleRows(), V2.statusFilter); }
  };

  MastAdmin.registerModule('newsletter-v2', {
    routes: { 'newsletter-v2': { tab: 'newsletterV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
