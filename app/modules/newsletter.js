/**
 * Newsletter Module — Issue Compose, Grid Builder, HTML Export, Subscribers
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var newsletterLoaded = false;
  var nlIssues = [];
  var nlSubscribers = [];
  var nlCurrentView = 'issues'; // issues | compose | subscribers
  var nlCurrentIssueId = null;
  var nlCurrentIssue = null;
  var nlExpandedSections = {};
  var nlAiResults = {};
  var nlImagePickerSection = null;
  var nlViewMode = 'grid';
  var nlDragSourceId = null;
  var nlEditingCardId = null;

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

  var NL_CHAR_LIMITS = {
    'small':  150,
    'medium': 300,
    'large':  600,
    'full':   800
  };

  function nlBadgeHtml(status) {
    var s = status || 'draft';
    var colors = { draft: 'background:rgba(196,133,60,0.15);color:var(--amber)', ready: 'background:rgba(42,124,111,0.15);color:var(--teal)', sent: 'background:rgba(139,111,94,0.15);color:#8B6F5E', published: 'background:#16a34a;color:#fff', complete: 'background:rgba(42,124,111,0.15);color:var(--teal)', posted: 'background:#16a34a;color:#fff' };
    // W1.3 — accessible tooltip on each status chip.
    var tips = {
      draft:     'Draft — still editing. Not yet sent or published.',
      ready:     'Ready to send. Click "Mark as Sent" or "Publish to Website" to ship.',
      sent:      'Email sent to subscribers. The web version may or may not be published.',
      published: 'Web version is live on the storefront /news page.',
      complete:  'Both sent and published.',
      posted:    'Published to the storefront.'
    };
    var tip = tips[s] || ('Status: ' + s);
    return '<span class="status-badge pill" style="' + (colors[s] || colors.draft) + '" title="' + esc(tip) + '">' + s + '</span>';
  }

  var NL_DEFAULT_SECTIONS = [
    { type: 'studio-update', title: 'What We\'ve Been Making', guidedPrompt: 'What has the studio been working on lately? Any new techniques, materials, or directions?' },
    { type: 'new-products', title: 'New Products', guidedPrompt: 'What new pieces have been added to the shop? What\'s special about them?' },
    { type: 'event-recap', title: 'Event Recap', guidedPrompt: 'What happened at the most recent show or fair? How did it go, what sold well, any memorable moments?' },
    { type: 'upcoming-events', title: 'Upcoming Events', guidedPrompt: 'What fairs, shows, or events are coming up? Where can people find you?' },
    { type: 'behind-process', title: 'Behind the Process', guidedPrompt: 'Walk us through how a specific piece or technique is made. What makes it interesting?' },
    { type: 'featured-piece', title: 'Featured Piece', guidedPrompt: 'Spotlight one piece from the current collection. What\'s the story behind it?' },
    { type: 'from-studio', title: 'From the Studio', guidedPrompt: 'A personal note from the studio. What\'s on your mind this month?' }
  ];

  function nlGetUid() { return currentUser ? currentUser.uid : null; }

  // ===== DATA LOADING =====

  async function loadNewsletter() {
    var uid = nlGetUid();
    if (!uid) {
      newsletterLoaded = true;
      renderNewsletter();
      return;
    }
    try {
      var issueSnap = await MastDB.newsletter.issues.ref().orderByChild('issueNumber').limitToLast(50).once('value');
      var issueVal = issueSnap.val();
      nlIssues = issueVal ? Object.values(issueVal).sort(function(a, b) { return (b.issueNumber || 0) - (a.issueNumber || 0); }) : [];

      var subSnap = await MastDB.newsletter.subscribers.ref().orderByChild('subscribedAt').limitToLast(200).once('value');
      var subVal = subSnap.val();
      nlSubscribers = subVal ? Object.values(subVal).sort(function(a, b) { return (b.subscribedAt || 0) - (a.subscribedAt || 0); }) : [];

      newsletterLoaded = true;
      renderNewsletter();
    } catch (err) {
      console.error('Error loading newsletter:', err);
      document.getElementById('newsletterContent').innerHTML = '<p style="color:var(--danger);padding:20px;">Error loading newsletter data: ' + esc(err.message) + '</p>';
    }
  }

  function renderNewsletter() {
    if (nlCurrentView === 'compose' && nlCurrentIssueId) { renderNLCompose(); return; }
    if (nlCurrentView === 'subscribers') { renderNLSubscribers(); return; }
    renderNLIssueList();
  }

  // ===== ISSUE LIST SCREEN =====
  function renderNLIssueList() {
    nlCurrentView = 'issues';

    // URL-driven filters from MCP admin links: status, issueIds.
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlIdsParam = (rp && typeof rp.issueIds === 'string') ? rp.issueIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id){urlIdLookup[id]=true;});
    var hasUrlFilter = !!(urlStatus || urlIds.length);

    var filteredIssues = hasUrlFilter
      ? nlIssues.filter(function(issue) {
          if (urlStatus && (issue.status || 'draft') !== urlStatus) return false;
          if (urlIdLookup && !urlIdLookup[issue.id]) return false;
          return true;
        })
      : nlIssues;

    var html = '<div class="nl-sub-nav">' +
      '<button class="active" onclick="nlSwitchView(\'issues\')">Issues</button>' +
      '<button onclick="nlSwitchView(\'subscribers\')">Subscribers</button>' +
      '</div>' +
      '<div class="nl-header"><h2>Newsletter Issues</h2>' +
      '<button class="btn btn-primary" onclick="nlCreateIssue()">+ New Issue</button></div>';

    if (hasUrlFilter) {
      var bParts = [];
      if (urlIds.length) bParts.push(urlIds.length + ' selected issue' + (urlIds.length === 1 ? '' : 's'));
      if (urlStatus) bParts.push('status: ' + urlStatus);
      html += '<div id="newsletterUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>📰 Showing ' + bParts.join(', ') + '</span>' +
        '<button type="button" onclick="clearNewsletterFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    if (filteredIssues.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">📰</div>' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No newsletter issues yet</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Create your first issue to start composing.</p></div>';
    } else {
      filteredIssues.forEach(function(issue) {
        var dateStr = issue.createdAt ? new Date(issue.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        html += '<div class="nl-issue-row" onclick="nlOpenIssue(\'' + issue.id + '\')">' +
          '<span class="nl-issue-num">#' + (issue.issueNumber || '?') + '</span>' +
          '<span class="nl-issue-title">' + esc(issue.title || ('Draft — Issue #' + (issue.issueNumber || '?'))) + '</span>' +
          nlBadgeHtml(issue.status) +
          '<span class="nl-issue-date">' + dateStr + '</span>' +
          '<button class="nl-issue-action" onclick="event.stopPropagation();nlDuplicateIssue(\'' + issue.id + '\')" title="Duplicate as template">📋</button>' +
          '<button class="nl-issue-action nl-issue-delete" onclick="event.stopPropagation();nlDeleteIssue(\'' + issue.id + '\')" title="Delete issue">🗑</button>' +
          '</div>';
      });
    }
    document.getElementById('newsletterContent').innerHTML = html;
  }

  function nlSwitchView(view) {
    nlCurrentView = view;
    renderNewsletter();
  }

  // Default-section seeding for a fresh issue. Extracted so BOTH the legacy
  // Composer (nlCreateIssue) and the native twin write path
  // (NewsletterBridge.createIssue) seed an identical grid — single source.
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

  // ===== CREATE NEW ISSUE =====
  async function nlCreateIssue() {
    try {
      var counterRef = MastDB.newsletter.meta.issueCounter();
      var result = await counterRef.transaction(function(current) {
        return (current || 0) + 1;
      });
      var issueNumber = result.snapshot.val();

      var issueId = MastDB.newsletter.issues.newKey();
      // W1.3 — auto-name new drafts "Draft — MMM D" instead of empty/Untitled.
      var draftLabel = 'Draft — ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var issueData = {
        id: issueId,
        issueNumber: issueNumber,
        title: draftLabel,
        slug: '',
        status: 'draft',
        sentAt: null,
        publishedAt: null,
        sentSubscriberCount: null,
        subjectLine: '',
        audienceSegmentId: null, // W1.1 — defaults to "all subscribers"
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      issueData.sections = nlBuildDefaultSections();
      await MastDB.newsletter.issues.ref(issueId).set(issueData);

      nlIssues.unshift(issueData);
      showToast('Issue #' + issueNumber + ' created');
      emitTestingEvent('createNewsletter', {});
      nlOpenIssue(issueId);
    } catch (err) {
      showToast('Error creating issue: ' + err.message, true);
    }
  }

  // ===== OPEN ISSUE FOR EDITING =====
  function nlOpenIssue(issueId) {
    nlCurrentIssueId = issueId;
    nlCurrentIssue = nlIssues.find(function(i) { return i.id === issueId; });
    if (!nlCurrentIssue) { showToast('Issue not found', true); return; }
    nlCurrentView = 'compose';
    nlExpandedSections = {};
    nlAiResults = {};
    if (nlCurrentIssue.sections) {
      var needsMigration = false;
      var sections = Object.values(nlCurrentIssue.sections);
      sections.forEach(function(sec) {
        var sizeInfo = NL_CARD_SIZE_MAP[sec.type] || NL_CARD_SIZE_MAP['custom'];
        if (sec.cardSize === undefined) {
          needsMigration = true;
          sec.cardSize = sizeInfo.cardSize;
          sec.gridWidth = sizeInfo.gridWidth;
        } else if (sec.type === 'upcoming-events' && sec.cardSize === 'medium' && sizeInfo.cardSize === 'large') {
          needsMigration = true;
          sec.cardSize = sizeInfo.cardSize;
          sec.gridWidth = sizeInfo.gridWidth;
        }
      });
      if (needsMigration) {
        sections.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
        nlRepackGrid(sections);
        var fbUpdates = {};
        sections.forEach(function(sec) {
          var prefix = 'newsletter/issues/' + issueId + '/sections/' + sec.id + '/';
          fbUpdates[prefix + 'cardSize'] = sec.cardSize;
          fbUpdates[prefix + 'gridWidth'] = sec.gridWidth;
          fbUpdates[prefix + 'gridCol'] = sec.gridCol;
          fbUpdates[prefix + 'gridRow'] = sec.gridRow;
        });
        MastDB.multiUpdate(fbUpdates).catch(function(err) { console.error('Grid migration error:', err); });
      }
    }
    renderNLCompose();
  }

  // ===== COMPOSE SCREEN =====
  // ===== W1.1: AUDIENCE SEGMENTS =====
  // Loaded lazily from admin/customerSegments + admin/customers. Built-in
  // segments stay in code (mirrors customers.js semantics).
  var nlSegmentsLoaded = false;
  var nlSavedSegments = [];          // [{id,name,filters,...}]
  var nlCustomerStatsByEmail = {};   // emailLower -> {orderCount, lifetimeSpendCents, lastOrderAt}

  var NL_BUILTIN_SEGMENTS = [
    { id: '__all',         name: 'All active subscribers' },
    { id: '__has_orders',  name: 'Customers (1+ orders)' },
    { id: '__no_orders',   name: 'No orders yet' },
    { id: '__repeat_2',    name: 'Repeat buyers (2+ orders)' },
    { id: '__lapsed_90',   name: 'Lapsed (no order in 90d)' }
  ];

  function nlLoadSegmentsLazy() {
    if (nlSegmentsLoaded) return Promise.resolve();
    var segP = MastDB.get('admin/customerSegments').catch(function() { return null; });
    var custP = MastDB.get('admin/customers').catch(function() { return null; });
    return Promise.all([segP, custP]).then(function(vals) {
      var sVal = vals[0] || {};
      nlSavedSegments = Object.keys(sVal).map(function(k) {
        var v = sVal[k] || {}; v.id = k; return v;
      });
      var cVal = vals[1] || {};
      Object.keys(cVal).forEach(function(cid) {
        var c = cVal[cid]; if (!c) return;
        var emails = [];
        if (c.primaryEmail) emails.push(c.primaryEmail);
        (c.emails || []).forEach(function(e) {
          if (e && typeof e === 'string') emails.push(e);
          else if (e && e.address) emails.push(e.address);
        });
        var stats = (c.stats) || {};
        emails.forEach(function(e) {
          var key = String(e).toLowerCase().trim();
          if (key) nlCustomerStatsByEmail[key] = {
            orderCount: stats.orderCount || 0,
            lifetimeSpendCents: stats.lifetimeSpendCents || 0,
            lastOrderAt: stats.lastOrderAt || null,
            firstOrderAt: stats.firstOrderAt || null
          };
        });
      });
      nlSegmentsLoaded = true;
    });
  }

  // Returns array of {sub, stats} for active subs that match the segment.
  function nlMatchSubscribersForSegment(segmentId) {
    var active = nlSubscribers.filter(function(s) { return s.status === 'active'; });
    var ninetyDaysAgo = Date.now() - 90 * 86400 * 1000;
    return active.filter(function(sub) {
      var key = String(sub.email || '').toLowerCase().trim();
      var stats = nlCustomerStatsByEmail[key] || null;
      switch (segmentId) {
        case '__all': case '': case null: case undefined:
          return true;
        case '__has_orders':
          return !!(stats && stats.orderCount > 0);
        case '__no_orders':
          return !stats || !stats.orderCount;
        case '__repeat_2':
          return !!(stats && stats.orderCount >= 2);
        case '__lapsed_90':
          if (!stats || !stats.lastOrderAt) return false;
          return new Date(stats.lastOrderAt).getTime() < ninetyDaysAgo;
        default:
          // Saved segment — for W1, treat as "all" (no filter eval engine here).
          return true;
      }
    });
  }

  function nlAudienceSelectorHtml(issue) {
    var current = issue.audienceSegmentId || '__all';
    var allSegs = NL_BUILTIN_SEGMENTS.concat(nlSavedSegments.map(function(s) {
      return { id: s.id, name: s.name || 'Saved segment', _saved: true };
    }));
    var options = allSegs.map(function(seg) {
      var sel = (seg.id === current) ? ' selected' : '';
      return '<option value="' + esc(seg.id) + '"' + sel + '>' + esc(seg.name) + (seg._saved ? ' (saved)' : '') + '</option>';
    }).join('');
    var countHtml = '<span id="nlAudienceCount" style="font-size:0.78rem;color:var(--text-secondary);">' +
      (nlSegmentsLoaded ? esc(String(nlMatchSubscribersForSegment(current).length)) + ' recipients' : 'counting…') +
    '</span>';
    var html = '<div class="nl-compose-header" style="margin-top:6px;">' +
      '<span style="font-weight:600;color:var(--text-secondary);white-space:nowrap;font-size:0.85rem;" title="Audience for this issue. Used by Send + future bulk-send.">Audience</span>' +
      '<select onchange="nlUpdateAudienceSegment(this.value)" style="padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--card-bg,transparent);color:var(--text);font-size:0.85rem;flex:1;max-width:320px;">' +
        options +
      '</select>' +
      countHtml +
      '</div>';
    // Kick off lazy load on first render — re-render compose when ready.
    if (!nlSegmentsLoaded) {
      nlLoadSegmentsLazy().then(function() { renderNLCompose(); }).catch(function() { nlSegmentsLoaded = true; });
    }
    return html;
  }

  window.nlUpdateAudienceSegment = function(segId) {
    if (!nlCurrentIssue) return;
    nlCurrentIssue.audienceSegmentId = segId || null;
    nlCurrentIssue.updatedAt = new Date().toISOString();
    MastDB.newsletter.issues.ref(nlCurrentIssueId).update({
      audienceSegmentId: nlCurrentIssue.audienceSegmentId,
      updatedAt: nlCurrentIssue.updatedAt
    }).catch(function(err) { showToast('Error saving audience: ' + err.message, true); });
    var countEl = document.getElementById('nlAudienceCount');
    if (countEl) countEl.textContent = nlMatchSubscribersForSegment(segId).length + ' recipients';
  };

  function renderNLCompose() {
    var issue = nlCurrentIssue;
    if (!issue) { renderNLIssueList(); return; }

    var sections = issue.sections ? Object.keys(issue.sections).map(function(k) { var s = issue.sections[k]; s.id = s.id || k; return s; }).sort(function(a, b) { return (a.order || 0) - (b.order || 0); }) : [];

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">' +
      '<div style="display:flex;align-items:center;gap:12px;">' +
      '<button class="detail-back" onclick="nlBackToList()">← Back to Issues</button>' +
      nlBadgeHtml(issue.status) +
      '</div>' +
      '<div class="nl-view-toggle">' +
      '<button class="' + (nlViewMode !== 'list' ? 'active' : '') + '" onclick="nlSetViewMode(\'grid\')">Grid</button>' +
      '<button class="' + (nlViewMode === 'list' ? 'active' : '') + '" onclick="nlSetViewMode(\'list\')">List</button>' +
      '</div></div>' +
      '<div class="nl-compose-header">' +
      '<span style="font-weight:600;color:var(--text-secondary);white-space:nowrap;">#' + (issue.issueNumber || '?') + '</span>' +
      '<input type="text" value="' + (issue.title || '').replace(/"/g, '&quot;') + '" placeholder="Issue title..." onchange="nlUpdateTitle(this.value)" />' +
      '</div>' +
      '<div class="nl-compose-header" style="margin-top:6px;">' +
      '<span style="font-weight:600;color:var(--text-secondary);white-space:nowrap;font-size:0.85rem;">Subject</span>' +
      '<input type="text" value="' + (issue.subjectLine || '').replace(/"/g, '&quot;') + '" placeholder="Email subject line (defaults to title if empty)" style="font-size:0.9rem;" onchange="nlUpdateSubjectLine(this.value)" />' +
      '</div>' +
      // W1.1 — audience segment selector + estimated recipient count
      nlAudienceSelectorHtml(issue);

    if (nlViewMode === 'list') {
      // ===== LIST VIEW (original) =====
      sections.forEach(function(sec) {
        var isExpanded = nlExpandedSections[sec.id];
        var contentStatus = sec.finalContent ? 'ready' : (sec.rawInput ? 'has-draft' : 'empty');
        var statusLabel = sec.finalContent ? 'Ready' : (sec.rawInput ? 'Draft' : 'Empty');
        var aiResult = nlAiResults[sec.id];
        html += '<div class="nl-section-card">' +
          '<div class="nl-section-header" onclick="nlToggleSection(\'' + sec.id + '\')">' +
          '<span class="nl-section-drag">⠿</span>' +
          '<input type="checkbox" class="nl-section-include" ' + (sec.included ? 'checked' : '') +
          ' onclick="event.stopPropagation(); nlToggleInclude(\'' + sec.id + '\', this.checked)" title="Include in issue" />' +
          '<input type="text" class="nl-section-title-input" value="' + (sec.title || '').replace(/"/g, '&quot;') + '"' +
          ' onclick="event.stopPropagation()" onchange="nlUpdateSectionTitle(\'' + sec.id + '\', this.value)" />' +
          '<span class="nl-section-status ' + contentStatus + '">' + statusLabel + '</span>' +
          '<button class="nl-section-delete" onclick="event.stopPropagation();nlDeleteSection(\'' + sec.id + '\')" title="Delete section">🗑</button>' +
          '<span class="nl-section-toggle ' + (isExpanded ? 'open' : '') + '">▶</span>' +
          '</div>';
        if (isExpanded) {
          html += '<div class="nl-section-body">';
          // Coupon section — show picker/preview instead of textarea
          if (sec.type === 'coupon') {
            if (sec.couponCode && window.MastCouponCard) {
              var allCouponsNl = window.coupons || {};
              var couponDataNl = allCouponsNl[sec.couponCode];
              if (couponDataNl) {
                html += window.MastCouponCard.renderHtml(Object.assign({}, couponDataNl, { code: sec.couponCode, _code: sec.couponCode }), { showCta: false });
              } else {
                html += '<div style="padding:16px;text-align:center;color:var(--warm-gray);">Coupon "' + esc(sec.couponCode) + '" not found</div>';
              }
            } else {
              html += '<div style="padding:16px;text-align:center;color:var(--warm-gray);">No coupon selected</div>';
            }
            html += '<div style="margin-top:8px;"><button class="btn btn-outline" style="font-size:0.78rem;" onclick="nlPickCouponForSection(\'' + sec.id + '\')">' +
              (sec.couponCode ? 'Change Coupon' : 'Select Coupon') + '</button></div>';
            html += '</div></div>';
            return; // skip rest of section rendering in forEach
          }
          if (sec.guidedPrompt) html += '<div class="nl-section-prompt">' + sec.guidedPrompt + '</div>';
          if (aiResult && !sec.finalContent) {
            html += '<div class="nl-ai-compare">' +
              '<div class="nl-ai-panel original"><div class="nl-ai-panel-label">Your Original</div>' + (sec.rawInput || '') + '</div>' +
              '<div class="nl-ai-panel polished"><div class="nl-ai-panel-label">AI Polished</div>' + nlEscHtml(aiResult) + '</div></div>' +
              '<div class="nl-ai-actions"><button class="btn btn-outline" onclick="nlPickVersion(\'' + sec.id + '\', \'original\')">Use Original</button>' +
              '<button class="btn btn-primary" onclick="nlPickVersion(\'' + sec.id + '\', \'ai\')">Use AI Version</button></div>';
          } else if (sec.finalContent) {
            var charLimitList = NL_CHAR_LIMITS[sec.cardSize || 'medium'];
            html += nlContentEditableHtml('nlListFinal', sec.id, 'finalContent', sec.finalContent, charLimitList);
            html += '<div style="margin-top:8px;"><button class="btn btn-outline" style="font-size:0.78rem;" onclick="nlResetSection(\'' + sec.id + '\')">Reset to Draft</button></div>';
          } else {
            var charLimitList = NL_CHAR_LIMITS[sec.cardSize || 'medium'];
            html += nlContentEditableHtml('nlListRaw', sec.id, 'rawInput', sec.rawInput || '', charLimitList);
            var hasContent = !!(sec.rawInput && nlStripTags(sec.rawInput).trim());
            html += '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
              '<button class="btn btn-outline" style="font-size:0.78rem;" ' + (hasContent ? '' : 'disabled') + ' onclick="nlPolishSection(\'' + sec.id + '\')" title="Uses tokens">Polish with AI</button>';
            if (window.MastAskAi && window.MastAskAi.isEnabled() && hasContent) {
              html += '<button class="btn btn-outline" style="font-size:0.78rem;" onclick="nlDraftInClaude(\'' + sec.id + '\')" title="Opens Claude Desktop">✨ or draft in Claude</button>';
            }
            if (hasContent) html += '<button class="btn btn-outline" style="font-size:0.78rem;" onclick="nlUseAsIs(\'' + sec.id + '\')">Use as-is</button>';
            html += '</div>';
          }
          var images = sec.images || [];
          html += '<div class="nl-section-images">';
          images.forEach(function(imgId, idx) {
            var img = imageLibrary ? imageLibrary[imgId] : null;
            if (img) html += '<div style="position:relative;"><img class="nl-section-img-thumb" src="' + esc(img.url) + '" alt="" /><span style="position:absolute;top:-4px;right:-4px;cursor:pointer;background:var(--danger);color:#fff;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;font-size:0.72rem;" onclick="nlRemoveImage(\'' + sec.id + '\',' + idx + ')">×</span></div>';
          });
          if (images.length < 3) html += '<div class="nl-section-img-add" onclick="nlOpenImagePicker(\'' + sec.id + '\')">+</div>';
          html += '</div></div>';
        }
        html += '</div>';
      });
    } else {
      // ===== GRID VIEW — Newsletter Preview =====
      html += '<div class="nl-grid-canvas" id="nlGridCanvas">';

      // Newsletter header — branded masthead
      var issueDate = nlCurrentIssue.createdAt ? new Date(nlCurrentIssue.createdAt).toLocaleDateString('en-US', { year:'numeric', month:'long' }) : new Date().toLocaleDateString('en-US', { year:'numeric', month:'long' });
      html += '<div class="nl-grid-header"><div class="nl-grid-header-top">' +
        '<div class="nl-grid-header-logo"><img src="' + esc(TENANT_CONFIG ? TENANT_CONFIG.brand.logoUrl : '') + '" alt="' + esc(TENANT_CONFIG ? TENANT_CONFIG.brand.name : '') + '" /></div>' +
        '<div class="nl-grid-header-text"><h1>' + esc(TENANT_CONFIG ? TENANT_CONFIG.brand.name : 'Newsletter') + '</h1>' +
        '<div class="nl-grid-header-tagline">' + esc(TENANT_CONFIG ? TENANT_CONFIG.brand.tagline : '') + ' &bull; ' + esc(TENANT_CONFIG ? TENANT_CONFIG.brand.location : '') + '</div></div>' +
        '<div class="nl-grid-header-meta">' +
        '<span>Issue #' + (nlCurrentIssue.issueNumber || '') + '</span>' +
        '<span>' + issueDate + '</span>' +
        '</div></div></div>';

      // Issue title (only show if set)
      if (nlCurrentIssue.title && nlCurrentIssue.title.trim()) {
        html += '<div class="nl-grid-title">' + nlEscHtml(nlCurrentIssue.title) + '</div>';
      }

      // Group sections into rows
      var rows = [], currentRow = [], currentRowCols = 0;
      sections.forEach(function(sec) {
        var width = sec.gridWidth || 1;
        if (currentRowCols + width > 2) {
          if (currentRow.length > 0) rows.push(currentRow);
          currentRow = [sec]; currentRowCols = width;
        } else {
          currentRow.push(sec); currentRowCols += width;
        }
      });
      if (currentRow.length > 0) rows.push(currentRow);

      rows.forEach(function(row, rowIdx) {
        html += '<div class="nl-grid-row">';
        row.forEach(function(sec, colIdx) {
          if (sec.type === 'upcoming-events' && !sec.rawInput && !sec.finalContent) {
            nlAutoLoadUpcomingEvents(sec.id);
          }
          var sizeClass = 'size-' + (sec.cardSize || 'medium');
          var content = sec.finalContent || sec.rawInput || '';
          var charLimit = NL_CHAR_LIMITS[sec.cardSize || 'medium'];
          var charCount = nlStripTags(content).length;
          var charClass = charCount >= charLimit ? 'at-limit' : charCount >= charLimit * 0.8 ? 'near-limit' : '';

          if (colIdx > 0) html += '<div class="nl-grid-col-gap"></div>';

          html += '<div class="nl-grid-section ' + sizeClass + (!sec.included ? ' excluded' : '') + '"' +
            ' draggable="true" data-section-id="' + sec.id + '"' +
            ' ondragstart="nlDragStart(event,\'' + sec.id + '\')"' +
            ' ondragend="nlDragEnd(event)"' +
            ' ondragover="nlDragOver(event)"' +
            ' ondrop="nlDrop(event,\'' + sec.id + '\')"' +
            ' onclick="nlOpenCardEditor(\'' + sec.id + '\')">';

          html += '<div class="nl-grid-overlay" onclick="event.stopPropagation()">' +
            '<input type="checkbox" class="nl-grid-include" ' + (sec.included ? 'checked' : '') +
            ' onclick="event.stopPropagation(); nlToggleInclude(\'' + sec.id + '\', this.checked)" title="Include in newsletter" />' +
            '<span class="nl-grid-overlay-badge ' + charClass + '">' + charCount + '/' + charLimit + '</span>' +
            '<button class="nl-grid-delete" onclick="event.stopPropagation();nlDeleteSection(\'' + sec.id + '\')" title="Delete section">×</button></div>';

          html += '<h2 class="nl-grid-section-title">' + nlEscHtml(sec.title) + '</h2>';

          var gridBodyContent = content;
          if (sec.type === 'coupon' && sec.couponCode && window.MastCouponCard) {
            var allCouponsGrid = window.coupons || {};
            var couponDataGrid = allCouponsGrid[sec.couponCode];
            if (couponDataGrid) {
              gridBodyContent = window.MastCouponCard.renderHtml(Object.assign({}, couponDataGrid, { code: sec.couponCode, _code: sec.couponCode }), { showCta: false, compact: true });
            }
          }
          html += '<div class="nl-grid-section-body">' +
            (gridBodyContent ? gridBodyContent : '<span class="placeholder">Click to add content...</span>') + '</div>';

          var imgs = sec.images || [];
          imgs.forEach(function(imgId) {
            var img = imageLibrary ? imageLibrary[imgId] : null;
            if (img) html += '<img class="nl-grid-section-img" src="' + img.url + '" alt="' + (img.alt || '') + '" />';
          });

          html += '</div>'; // end section
        });
        html += '</div>'; // end row

        if (rowIdx < rows.length - 1) html += '<hr class="nl-grid-divider" />';
      });

      // Newsletter footer
      var _tc = TENANT_CONFIG || { brand: { name: 'Newsletter' }, domain: 'localhost', site: { siteUrl: '#' } };
      html += '<div class="nl-grid-footer">' +
        '<p class="footer-brand">' + esc(_tc.brand.name) + '</p>' +
        '<p>' + esc(_tc.brand.tagline || '') + ' from ' + esc(_tc.brand.location || '') + '</p>' +
        '<div class="footer-links">' +
        '<a href="https://' + esc(_tc.domain) + '">Website</a>' +
        '<a href="https://' + esc(_tc.domain) + '/shop">Shop</a>' +
        '<a href="https://' + esc(_tc.domain) + '/schedule">Events</a>' +
        '</div>' +
        '<div class="footer-divider"></div>' +
        '<p class="footer-unsub">You received this because you subscribed to ' + esc(_tc.brand.name) + ' updates.</p>' +
        '<p class="footer-unsub" style="margin-top:4px;"><a href="#" style="color:rgba(245,240,235,0.35);">Unsubscribe</a> &bull; <a href="#" style="color:rgba(245,240,235,0.35);">Manage Preferences</a></p>' +
        '</div>';
      html += '</div>';
    }

    // Add section button
    html += '<div style="text-align:center;margin:16px 0;">' +
      '<button class="btn btn-outline" onclick="nlShowAddSectionMenu()">+ Add Section</button></div>';

    // W3a-send — A/B test + send controls
    var abTest = issue.abTest || {};
    var abEnabled = !!abTest.enabled;
    var winnerPicked = !!abTest.winnerPickedAt;
    var canPickWinnerNow = abEnabled && !winnerPicked && abTest.sendStartedAt;
    var sendStatus = issue.sendStatus || (issue.status === 'sent' ? 'completed-legacy' : null);

    html += '<details class="nl-ab-panel" style="margin:16px 0;padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);" ' + (abEnabled ? 'open' : '') + '>' +
      '<summary style="cursor:pointer;font-weight:600;font-size:0.9rem;">A/B test &amp; audience split</summary>' +
      '<div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;">' +
        '<input type="checkbox" ' + (abEnabled ? 'checked' : '') + ' onchange="nlToggleAbTest(this.checked)" />' +
        ' Enable A/B test (variant B subject + holdout)' +
      '</label>';
    if (abEnabled) {
      var variantB = abTest.variantB || {};
      var holdoutPct = typeof abTest.holdoutPct === 'number' ? abTest.holdoutPct : 50;
      var testHours = typeof abTest.testWindowHours === 'number' ? abTest.testWindowHours : 4;
      html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:0.85rem;">' +
        '<span style="white-space:nowrap;color:var(--text-secondary);">Variant B subject</span>' +
        '<input type="text" value="' + (variantB.subject || '').replace(/"/g, '&quot;') + '" placeholder="Variant B subject..." style="flex:1;min-width:240px;font-size:0.85rem;" onchange="nlUpdateAbField(\'variantB.subject\', this.value)" />' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:0.85rem;">' +
        '<label>Holdout %: <input type="number" min="10" max="90" value="' + holdoutPct + '" style="width:64px;" onchange="nlUpdateAbField(\'holdoutPct\', Number(this.value))" /></label>' +
        '<label>Test window (hours): <input type="number" min="1" max="72" value="' + testHours + '" style="width:64px;" onchange="nlUpdateAbField(\'testWindowHours\', Number(this.value))" /></label>' +
        '</div>';
      if (canPickWinnerNow) {
        var stats = abTest.stats || {};
        html += '<div style="font-size:0.78rem;color:var(--text-secondary);">A opens=' + ((stats.A && stats.A.opens) || 0) + ' / sends=' + ((stats.A && stats.A.sends) || 0) + ' &nbsp;|&nbsp; B opens=' + ((stats.B && stats.B.opens) || 0) + ' / sends=' + ((stats.B && stats.B.sends) || 0) + '</div>' +
          '<button class="btn btn-outline" style="font-size:0.85rem;" onclick="nlPickWinnerNow()">⏱ Pick Winner Now</button>';
      } else if (winnerPicked) {
        html += '<div style="font-size:0.85rem;color:var(--teal);">Winner: variant ' + esc(abTest.winner || '?') + ' (picked at ' + esc(abTest.winnerPickedAt) + ')</div>';
      }
    }
    html += '</div></details>';

    // Actions bar
    html += '<div class="nl-compose-actions">' +
      '<button class="btn btn-outline" onclick="nlPreview()">👁️ Preview</button>' +
      '<button class="btn btn-primary" onclick="nlExportHTML()">📥 Export HTML</button>' +
      '<button class="btn btn-outline" onclick="nlPublishToWebsite()">🌐 Publish to Website</button>' +
      '<button class="btn btn-primary" onclick="nlSendTest()">📨 Send Test</button>' +
      '<button class="btn btn-primary" onclick="nlSendIssue()"' + (sendStatus === 'sending' || sendStatus === 'completed' ? ' disabled title="Already sent"' : '') + '>🚀 Send</button>' +
      '<button class="btn btn-outline" onclick="nlMarkAsSent()" title="Fallback — only use if Send failed">✉️ Mark as sent (fallback)</button>' +
      '<button class="btn btn-outline" style="color:var(--danger);border-color:var(--danger);margin-left:auto;" onclick="nlDeleteIssue(\'' + nlCurrentIssueId + '\')">Delete Issue</button>' +
      '</div>';
    if (sendStatus) {
      var statusColor = sendStatus === 'completed' ? 'var(--teal)' : (sendStatus === 'failed' ? 'var(--danger)' : 'var(--text-secondary)');
      html += '<div style="margin-top:6px;font-size:0.78rem;color:' + statusColor + ';">Send status: ' + esc(sendStatus) +
        (issue.sendQueuedCount ? ' &middot; queued ' + issue.sendQueuedCount : '') +
        (issue.sendSkippedCount ? ' &middot; skipped ' + issue.sendSkippedCount : '') +
        (issue.sendStartedAt ? ' &middot; started ' + esc(issue.sendStartedAt) : '') +
        '</div>';
    }

    // W3b — per-content attribution panel host.
    html += '<div id="nlIssueAttrPanel"></div>';

    document.getElementById('newsletterContent').innerHTML = html;

    // W3b — populate attribution panel for this issue.
    if (issue && issue.id && typeof window.renderContentAttributionPanel === 'function') {
      var attrHost = document.getElementById('nlIssueAttrPanel');
      if (attrHost) {
        window.renderContentAttributionPanel({
          hostEl: attrHost,
          contentId: issue.id,
          utmSource: 'newsletter',
          utmMedium: 'email',
          utmCampaign: issue.campaignUtm || null,
          path: '/news/?issueId=' + encodeURIComponent(issue.id),
        });
      }
    }
  }

  function nlEscHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');
  }

  // ===== RICH TEXT HELPERS =====
  var _nlSaveTimer = null;

  function nlStripTags(html) {
    if (!html) return '';
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  function nlFormatToolbarHtml(idPrefix) {
    return '<div class="nl-format-toolbar">' +
      '<button class="nl-format-btn" id="' + idPrefix + 'Bold" onmousedown="event.preventDefault();nlFormatCmd(\'' + idPrefix + '\',\'bold\')" title="Bold"><b>B</b></button>' +
      '<button class="nl-format-btn" id="' + idPrefix + 'Italic" onmousedown="event.preventDefault();nlFormatCmd(\'' + idPrefix + '\',\'italic\')" title="Italic"><i>I</i></button>' +
      '<span class="nl-format-sep"></span>' +
      '<button class="nl-format-btn nl-format-btn-wide" id="' + idPrefix + 'Link" onmousedown="event.preventDefault();nlInsertLink(\'' + idPrefix + '\')" title="Insert Link">🔗</button>' +
      '</div>';
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

  function nlContentEditableHtml(idPrefix, secId, fieldName, content, charLimit) {
    var textLen = nlStripTags(content).length;
    var charClass = textLen >= charLimit ? 'at-limit' : textLen >= charLimit * 0.8 ? 'near-limit' : '';
    return nlFormatToolbarHtml(idPrefix + '_' + secId) +
      '<div class="nl-section-editable" id="' + idPrefix + '_' + secId + '" contenteditable="true"' +
      ' data-sec-id="' + secId + '" data-field="' + fieldName + '" data-char-limit="' + charLimit + '"' +
      ' oninput="nlEditableChanged(\'' + idPrefix + '_' + secId + '\',\'' + secId + '\',\'' + fieldName + '\',' + charLimit + ')"' +
      ' onkeyup="nlUpdateToolbarState(\'' + idPrefix + '_' + secId + '\')"' +
      ' onmouseup="nlUpdateToolbarState(\'' + idPrefix + '_' + secId + '\')"' +
      ' onblur="nlFlushEditableSave(\'' + secId + '\',\'' + fieldName + '\',\'' + idPrefix + '_' + secId + '\')"' +
      '>' + (content || '') + '</div>' +
      '<div class="nl-editor-char-counter ' + charClass + '" id="nlCharCounter_' + idPrefix + '_' + secId + '">' + textLen + '/' + charLimit + '</div>';
  }

  function nlEditableChanged(elId, secId, fieldName, charLimit) {
    var el = document.getElementById(elId);
    if (!el) return;
    var textLen = nlStripTags(el.innerHTML).length;
    var counter = document.getElementById('nlCharCounter_' + elId);
    if (counter) {
      counter.textContent = textLen + '/' + charLimit;
      counter.style.color = textLen >= charLimit ? 'var(--danger)' : textLen >= charLimit * 0.8 ? 'var(--amber)' : 'var(--text-secondary)';
    }
    nlUpdateToolbarState(elId);
    clearTimeout(_nlSaveTimer);
    _nlSaveTimer = setTimeout(function() {
      var val = el.innerHTML || '';
      if (fieldName === 'rawInput') nlUpdateRawInput(secId, val);
      else nlUpdateFinalContent(secId, val);
    }, 500);
  }

  function nlFlushEditableSave(secId, fieldName, elId) {
    clearTimeout(_nlSaveTimer);
    var el = document.getElementById(elId);
    if (!el) return;
    var val = el.innerHTML || '';
    if (fieldName === 'rawInput') nlUpdateRawInput(secId, val);
    else nlUpdateFinalContent(secId, val);
  }

  // ===== GRID VIEW HELPERS =====
  function nlSetViewMode(mode) { nlViewMode = mode; renderNLCompose(); }

  function nlGetTypeIcon(type) {
    var icons = { 'studio-update':'🔥', 'new-products':'✨', 'event-recap':'🎪', 'upcoming-events':'📅', 'behind-process':'🔧', 'featured-piece':'💎', 'from-studio':'💌', 'custom':'📝' };
    return icons[type] || '📝';
  }

  function nlTruncatePreview(content, cardSize) {
    if (!content) return '';
    var maxPreview = { small:60, medium:120, large:200, full:300 };
    var limit = maxPreview[cardSize] || 120;
    var text = content.replace(/\n/g, ' ');
    return text.length > limit ? text.substring(0, limit) + '...' : text;
  }

  function nlRepackGrid(sections) {
    var currentRow = 0, currentCol = 0;
    sections.forEach(function(sec, idx) {
      sec.order = idx;
      var width = sec.gridWidth || (NL_CARD_SIZE_MAP[sec.type] || NL_CARD_SIZE_MAP['custom']).gridWidth;
      if (width >= 2 && currentCol !== 0) { currentRow++; currentCol = 0; }
      sec.gridCol = currentCol;
      sec.gridRow = currentRow;
      currentCol += width;
      if (currentCol >= 2) { currentCol = 0; currentRow++; }
    });
  }

  // ===== DRAG AND DROP =====
  function nlDragStart(e, secId) {
    nlDragSourceId = secId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', secId);
    setTimeout(function() {
      var el = document.querySelector('[data-section-id="' + secId + '"]');
      if (el) el.classList.add('dragging');
    }, 0);
  }

  function nlDragEnd(e) {
    nlDragSourceId = null;
    document.querySelectorAll('.nl-grid-section').forEach(function(card) {
      card.classList.remove('dragging', 'drag-over');
    });
  }

  function nlDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var card = e.target.closest('.nl-grid-section');
    if (card && !card.classList.contains('dragging')) {
      document.querySelectorAll('.nl-grid-section.drag-over').forEach(function(c) { c.classList.remove('drag-over'); });
      card.classList.add('drag-over');
    }
  }

  async function nlDrop(e, targetSecId) {
    e.preventDefault();
    var sourceSecId = nlDragSourceId;
    if (!sourceSecId || sourceSecId === targetSecId) return;
    if (!nlCurrentIssue || !nlCurrentIssue.sections) return;

    var sections = Object.values(nlCurrentIssue.sections).sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
    var sourceIdx = sections.findIndex(function(s) { return s.id === sourceSecId; });
    var targetIdx = sections.findIndex(function(s) { return s.id === targetSecId; });
    if (sourceIdx === -1 || targetIdx === -1) return;

    var moved = sections.splice(sourceIdx, 1)[0];
    sections.splice(targetIdx, 0, moved);
    nlRepackGrid(sections);

    var fbUpdates = {};
    sections.forEach(function(sec) {
      var prefix = 'newsletter/issues/' + nlCurrentIssueId + '/sections/' + sec.id + '/';
      fbUpdates[prefix + 'order'] = sec.order;
      fbUpdates[prefix + 'gridCol'] = sec.gridCol;
      fbUpdates[prefix + 'gridRow'] = sec.gridRow;
    });

    try {
      await MastDB.multiUpdate(fbUpdates);
      renderNLCompose();
    } catch (err) { showToast('Error reordering: ' + err.message, true); }
  }

  // ===== AUTO-LOAD UPCOMING EVENTS =====
  function nlGetUpcomingEvents(maxCount) {
    maxCount = maxCount || 5;
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var upcoming = [];
    // Access events data from core global
    var eventsData = window.events || {};
    Object.keys(eventsData).forEach(function(k) {
      var ev = eventsData[k];
      if (ev.visible === false) return;
      var endDate = ev.dateEnd || ev.date;
      if (!endDate) return;
      var parts = endDate.split('-');
      var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      if (d >= now) {
        upcoming.push(ev);
      }
    });
    upcoming.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
    return upcoming.slice(0, maxCount);
  }

  function nlFormatUpcomingEvents(evList) {
    if (!evList || evList.length === 0) return 'No upcoming events scheduled.';
    var lines = [];
    evList.forEach(function(ev) {
      var dateStr = formatDateRange(ev.date, ev.dateEnd);
      var line = '📅 ' + dateStr + ' — ' + (ev.name || 'Unnamed Event');
      if (ev.location) line += ' @ ' + ev.location;
      if (ev.description) {
        var desc = ev.description.length > 80 ? ev.description.substring(0, 80) + '...' : ev.description;
        line += '\n   ' + desc;
      }
      lines.push(line);
    });
    return lines.join('\n\n');
  }

  function nlAutoLoadUpcomingEvents(secId) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return false;
    var sec = nlCurrentIssue.sections[secId];
    if (sec.type !== 'upcoming-events') return false;
    if (sec.rawInput || sec.finalContent) return false;
    var upcoming = nlGetUpcomingEvents(5);
    if (upcoming.length === 0) return false;
    var formatted = nlFormatUpcomingEvents(upcoming);
    sec.rawInput = formatted;
    nlUpdateRawInput(secId, formatted);
    return true;
  }

  // ===== CARD EDITOR MODAL =====
  function nlOpenCardEditor(secId) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];

    if (sec.type === 'upcoming-events' && !sec.rawInput && !sec.finalContent) {
      nlAutoLoadUpcomingEvents(secId);
    }

    var charLimit = NL_CHAR_LIMITS[sec.cardSize || 'medium'];
    var content = sec.finalContent || sec.rawInput || '';
    var charCount = nlStripTags(content).length;
    var aiResult = nlAiResults[secId];

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--border);">' +
      '<div style="display:flex;align-items:center;gap:8px;flex:1;">' +
      '<span style="font-size:1.15rem;">' + nlGetTypeIcon(sec.type) + '</span>' +
      '<input type="text" value="' + (sec.title || '').replace(/"/g, '&quot;') + '"' +
      ' style="border:none;background:transparent;font-size:1.15rem;font-weight:600;color:var(--text);flex:1;padding:4px 0;"' +
      ' onchange="nlUpdateSectionTitle(\'' + secId + '\', this.value)" />' +
      '</div>' +
      '<button style="background:none;border:none;font-size:0.85rem;cursor:pointer;color:var(--danger);padding:4px 8px;opacity:0.6;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" onclick="nlDeleteSection(\'' + secId + '\');nlEditingCardId=null;document.getElementById(\'modalOverlay\').classList.remove(\'open\');document.getElementById(\'modalContent\').innerHTML=\'\'" title="Delete section">🗑</button>' +
      '<button style="background:none;border:none;font-size:1.15rem;cursor:pointer;color:var(--text-secondary);padding:4px 8px;" onclick="nlCloseCardEditor(\'' + secId + '\')">×</button></div>';

    html += '<div style="padding:16px 24px;">';

    // Card size selector
    html += '<div style="display:flex;gap:6px;margin-bottom:16px;align-items:center;flex-wrap:wrap;">' +
      '<span style="font-size:0.78rem;color:var(--text-secondary);margin-right:4px;">Size:</span>';
    ['small', 'medium', 'large', 'full'].forEach(function(size) {
      var isActive = (sec.cardSize || 'medium') === size;
      html += '<button class="nl-editor-size-btn ' + (isActive ? 'active' : '') + '"' +
        ' onclick="nlChangeCardSize(\'' + secId + '\',\'' + size + '\')">' +
        size.charAt(0).toUpperCase() + size.slice(1) + ' (' + NL_CHAR_LIMITS[size] + ')</button>';
    });
    html += '</div>';

    if (sec.guidedPrompt) {
      html += '<div class="nl-section-prompt" style="margin-bottom:12px;">' + sec.guidedPrompt + '</div>';
    }

    // Coupon section — show picker/preview instead of textarea
    if (sec.type === 'coupon') {
      if (sec.couponCode && window.MastCouponCard) {
        var allCouponsEditor = window.coupons || {};
        var couponDataEditor = allCouponsEditor[sec.couponCode];
        if (couponDataEditor) {
          html += window.MastCouponCard.renderHtml(Object.assign({}, couponDataEditor, { code: sec.couponCode, _code: sec.couponCode }), { showCta: false });
        } else {
          html += '<div style="padding:16px;text-align:center;color:var(--warm-gray);">Coupon "' + esc(sec.couponCode) + '" not found</div>';
        }
      } else {
        html += '<div style="padding:16px;text-align:center;color:var(--warm-gray);">No coupon selected</div>';
      }
      html += '<div style="margin-top:8px;"><button class="btn btn-outline" style="font-size:0.78rem;" onclick="nlPickCouponForSection(\'' + secId + '\')">' +
        (sec.couponCode ? 'Change Coupon' : 'Select Coupon') + '</button></div>';
    } else if (aiResult && !sec.finalContent) {
      html += '<div class="nl-ai-compare">' +
        '<div class="nl-ai-panel original"><div class="nl-ai-panel-label">Your Original</div>' + (sec.rawInput || '') + '</div>' +
        '<div class="nl-ai-panel polished"><div class="nl-ai-panel-label">AI Polished</div>' + nlEscHtml(aiResult) + '</div></div>' +
        '<div class="nl-ai-actions" style="margin-top:8px;">' +
        '<button class="btn btn-outline" onclick="nlPickVersion(\'' + secId + '\',\'original\'); setTimeout(function(){nlOpenCardEditor(\'' + secId + '\')},100);">Use Original</button>' +
        '<button class="btn btn-primary" onclick="nlPickVersion(\'' + secId + '\',\'ai\'); setTimeout(function(){nlOpenCardEditor(\'' + secId + '\')},100);">Use AI Version</button></div>';
    } else if (sec.finalContent) {
      html += nlContentEditableHtml('nlModalFinal', secId, 'finalContent', sec.finalContent, charLimit);
      html += '<div style="margin-top:8px;"><button class="btn btn-outline" style="font-size:0.78rem;" onclick="nlResetSection(\'' + secId + '\'); setTimeout(function(){nlOpenCardEditor(\'' + secId + '\')},100);">Reset to Draft</button></div>';
    } else {
      html += nlContentEditableHtml('nlModalRaw', secId, 'rawInput', sec.rawInput || '', charLimit);
      var hasContent = !!(sec.rawInput && nlStripTags(sec.rawInput).trim());
      html += '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn btn-outline" style="font-size:0.78rem;" ' + (hasContent ? '' : 'disabled') +
        ' onclick="nlPolishSection(\'' + secId + '\')" title="Uses tokens">Polish with AI</button>';
      if (window.MastAskAi && window.MastAskAi.isEnabled() && hasContent) {
        html += '<button class="btn btn-outline" style="font-size:0.78rem;" onclick="nlDraftInClaude(\'' + secId + '\')" title="Opens Claude Desktop">✨ or draft in Claude</button>';
      }
      if (hasContent) html += '<button class="btn btn-outline" style="font-size:0.78rem;" onclick="nlUseAsIs(\'' + secId + '\'); setTimeout(function(){nlOpenCardEditor(\'' + secId + '\')},100);">Use as-is</button>';
      html += '</div>';
    }

    // Images
    var images = sec.images || [];
    html += '<div style="margin-top:16px;"><div style="font-size:0.78rem;font-weight:600;margin-bottom:8px;">Images (max 3)</div>';
    html += '<div class="nl-section-images">';
    images.forEach(function(imgId, idx) {
      var img = imageLibrary ? imageLibrary[imgId] : null;
      if (img) html += '<div style="position:relative;"><img class="nl-section-img-thumb" src="' + img.url + '" alt="" />' +
        '<span style="position:absolute;top:-4px;right:-4px;cursor:pointer;background:var(--danger);color:#fff;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;font-size:0.72rem;" onclick="nlRemoveImage(\'' + secId + '\',' + idx + '); setTimeout(function(){nlOpenCardEditor(\'' + secId + '\')},100);">×</span></div>';
    });
    if (images.length < 3) html += '<div class="nl-section-img-add" onclick="closeModal(); nlOpenImagePicker(\'' + secId + '\')">+</div>';
    html += '</div></div>';

    html += '</div>'; // end body

    nlEditingCardId = secId;
    openModal(html);
    var modal = document.getElementById('modalContent');
    if (modal) modal.style.maxWidth = '640px';
  }

  function nlEditorCharCount(secId, val, limit) {
    var counter = document.getElementById('nlCharCounter_' + secId);
    if (!counter) return;
    var count = val.length;
    counter.textContent = count + '/' + limit;
    counter.style.color = count >= limit ? 'var(--danger)' : count >= limit * 0.8 ? 'var(--amber)' : 'var(--text-secondary)';
  }

  function nlCloseCardEditor(secId) {
    if (secId && nlCurrentIssue && nlCurrentIssue.sections && nlCurrentIssue.sections[secId]) {
      var rawEl = document.getElementById('nlModalRaw_' + secId);
      var finalEl = document.getElementById('nlModalFinal_' + secId);
      if (rawEl && rawEl.innerHTML !== (nlCurrentIssue.sections[secId].rawInput || '')) {
        nlUpdateRawInput(secId, rawEl.innerHTML);
      } else if (finalEl && finalEl.innerHTML !== (nlCurrentIssue.sections[secId].finalContent || '')) {
        nlUpdateFinalContent(secId, finalEl.innerHTML);
      }
    }
    nlEditingCardId = null;
    closeModal();
    renderNLCompose();
  }

  async function nlChangeCardSize(secId, newSize) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    sec.cardSize = newSize;
    sec.gridWidth = (newSize === 'full' || newSize === 'large') ? 2 : 1;
    sec.gridHeight = 1;

    var content = sec.finalContent || sec.rawInput || '';
    var charLimit = NL_CHAR_LIMITS[newSize];
    if (content.length > charLimit) {
      showToast('Content (' + content.length + ' chars) exceeds ' + newSize + ' limit (' + charLimit + '). Trim before saving.', true);
    }

    var sections = Object.values(nlCurrentIssue.sections).sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
    nlRepackGrid(sections);

    var fbUpdates = {};
    sections.forEach(function(s) {
      var prefix = 'newsletter/issues/' + nlCurrentIssueId + '/sections/' + s.id + '/';
      fbUpdates[prefix + 'cardSize'] = s.cardSize;
      fbUpdates[prefix + 'gridWidth'] = s.gridWidth;
      fbUpdates[prefix + 'gridCol'] = s.gridCol;
      fbUpdates[prefix + 'gridRow'] = s.gridRow;
    });

    try {
      await MastDB.multiUpdate(fbUpdates);
      closeModal();
      renderNLCompose();
    } catch (err) { showToast('Error saving: ' + err.message, true); }
  }

  function nlBackToList() {
    nlCurrentIssueId = null;
    nlCurrentIssue = null;
    nlCurrentView = 'issues';
    renderNLIssueList();
  }

  function nlToggleSection(secId) {
    nlExpandedSections[secId] = !nlExpandedSections[secId];
    renderNLCompose();
  }

  async function nlUpdateTitle(val) {
    if (!nlCurrentIssue) return;
    nlCurrentIssue.title = val;
    nlCurrentIssue.slug = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 60);
    nlCurrentIssue.updatedAt = new Date().toISOString();
    try {
      await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({
        title: val, slug: nlCurrentIssue.slug, updatedAt: nlCurrentIssue.updatedAt
      });
    } catch (err) { showToast('Error saving title: ' + err.message, true); }
  }

  async function nlUpdateSubjectLine(val) {
    if (!nlCurrentIssue) return;
    nlCurrentIssue.subjectLine = val;
    nlCurrentIssue.updatedAt = new Date().toISOString();
    try {
      await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({
        subjectLine: val, updatedAt: nlCurrentIssue.updatedAt
      });
    } catch (err) { showToast('Error saving subject: ' + err.message, true); }
  }

  async function nlUpdateSectionTitle(secId, val) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    nlCurrentIssue.sections[secId].title = val;
    try {
      await MastDB.newsletter.issues.sectionField(nlCurrentIssueId, secId, 'title').set(val);
    } catch (err) { showToast('Error saving: ' + err.message, true); }
  }

  async function nlToggleInclude(secId, checked) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    nlCurrentIssue.sections[secId].included = checked;
    try {
      await MastDB.newsletter.issues.sectionField(nlCurrentIssueId, secId, 'included').set(checked);
    } catch (err) { showToast('Error saving: ' + err.message, true); }
  }

  async function nlUpdateRawInput(secId, val) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    var charLimit = NL_CHAR_LIMITS[sec.cardSize || 'medium'];
    var textLen = nlStripTags(val).length;
    if (textLen > charLimit) {
      showToast('Content exceeds ' + charLimit + ' char limit');
    }
    sec.rawInput = val;
    try {
      await MastDB.newsletter.issues.sectionField(nlCurrentIssueId, secId, 'rawInput').set(val);
    } catch (err) { showToast('Error saving: ' + err.message, true); }
  }

  async function nlUpdateFinalContent(secId, val) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    var charLimit = NL_CHAR_LIMITS[sec.cardSize || 'medium'];
    var textLen = nlStripTags(val).length;
    if (textLen > charLimit) {
      showToast('Content exceeds ' + charLimit + ' char limit');
    }
    sec.finalContent = val;
    try {
      await MastDB.newsletter.issues.sectionField(nlCurrentIssueId, secId, 'finalContent').set(val);
    } catch (err) { showToast('Error saving: ' + err.message, true); }
  }

  async function nlUseAsIs(secId) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    sec.finalContent = sec.rawInput;
    sec.usedAI = false;
    try {
      await MastDB.newsletter.issues.section(nlCurrentIssueId, secId).update({
        finalContent: sec.rawInput, usedAI: false
      });
      renderNLCompose();
    } catch (err) { showToast('Error saving: ' + err.message, true); }
  }

  // AI Polish
  async function nlPolishSection(secId) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    if (!sec.rawInput || !nlStripTags(sec.rawInput).trim()) { showToast('Write some content first', true); return; }

    var btn = event.target;
    var origText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="nl-ai-loading">Polishing...</span>';

    try {
      var polishFn = firebase.functions().httpsCallable('socialAI');
      var result = await polishFn({ action: 'newsletterPolish', tenantId: MastDB.tenantId(), rawInput: nlStripTags(sec.rawInput), sectionType: sec.type });
      var polished = result.data && result.data.polished ? result.data.polished : sec.rawInput;

      nlAiResults[secId] = polished;
      sec.aiVersion = polished;
      await MastDB.newsletter.issues.sectionField(nlCurrentIssueId, secId, 'aiVersion').set(polished);
      renderNLCompose();
    } catch (err) {
      console.error('AI polish error:', err);
      showToast('AI polish unavailable — use content as-is', true);
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  function nlDraftInClaude(secId) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    if (!sec.rawInput || !nlStripTags(sec.rawInput).trim()) { showToast('Write some content first', true); return; }
    if (!window.MastAskAi || !window.MastAskAi.isEnabled()) {
      showToast('Configure Ask AI in Settings → AI to enable Claude drafting', true);
      return;
    }
    var sectionLabel = sec.label || sec.title || sec.type || secId;
    window.MastAskAi.openWithReturn({
      title: 'Newsletter section: ' + sectionLabel,
      prompt: 'Polish this newsletter section into clean, friendly customer-facing copy. ' +
              'Keep the voice warm and concrete. Cut filler. Aim for one short paragraph ' +
              'unless the source clearly needs more.\n\nSource:\n' + nlStripTags(sec.rawInput),
      onReturn: async function(text) {
        nlAiResults[secId] = text;
        sec.aiVersion = text;
        try {
          await MastDB.newsletter.issues.sectionField(nlCurrentIssueId, secId, 'aiVersion').set(text);
        } catch (err) {
          console.error('Save Claude draft error:', err);
          showToast('Saved locally — sync error: ' + (err && err.message ? err.message : 'unknown'), true);
        }
        renderNLCompose();
        showToast('Draft applied. Click Use AI Version to keep it.');
      }
    });
  }

  async function nlPickVersion(secId, version) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    var content = version === 'ai' ? (nlAiResults[secId] || sec.rawInput) : sec.rawInput;
    sec.finalContent = content;
    sec.usedAI = version === 'ai';
    delete nlAiResults[secId];
    try {
      await MastDB.newsletter.issues.section(nlCurrentIssueId, secId).update({
        finalContent: content, usedAI: sec.usedAI
      });
      renderNLCompose();
    } catch (err) { showToast('Error saving: ' + err.message, true); }
  }

  async function nlResetSection(secId) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    sec.finalContent = '';
    sec.usedAI = false;
    sec.aiVersion = null;
    delete nlAiResults[secId];
    try {
      await MastDB.newsletter.issues.section(nlCurrentIssueId, secId).update({
        finalContent: '', usedAI: false, aiVersion: null
      });
      renderNLCompose();
    } catch (err) { showToast('Error saving: ' + err.message, true); }
  }

  // Add custom section
  async function nlAddSection(sectionType) {
    if (!nlCurrentIssue) return;
    var type = sectionType || 'custom';
    var secId = MastDB.newKey('_ids');
    var sections = nlCurrentIssue.sections ? Object.values(nlCurrentIssue.sections) : [];
    var maxOrder = sections.reduce(function(m, s) { return Math.max(m, s.order || 0); }, -1);
    var sizeInfo = NL_CARD_SIZE_MAP[type] || NL_CARD_SIZE_MAP['custom'];
    var newSec = {
      id: secId, type: type, title: type === 'coupon' ? 'Special Offer' : 'New Section', guidedPrompt: '',
      rawInput: '', aiVersion: null, finalContent: '', usedAI: false,
      images: [], order: maxOrder + 1, included: true,
      cardSize: sizeInfo.cardSize, gridWidth: sizeInfo.gridWidth, gridCol: 0, gridRow: 0,
      couponCode: null
    };
    if (!nlCurrentIssue.sections) nlCurrentIssue.sections = {};
    nlCurrentIssue.sections[secId] = newSec;
    var allSections = Object.values(nlCurrentIssue.sections).sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
    nlRepackGrid(allSections);
    nlExpandedSections[secId] = true;
    try {
      await MastDB.newsletter.issues.section(nlCurrentIssueId, secId).set(newSec);
      renderNLCompose();
    } catch (err) { showToast('Error adding section: ' + err.message, true); }
  }

  async function nlDeleteSection(secId) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    if (!await mastConfirm('Delete the "' + (sec.title || 'Untitled') + '" section? This cannot be undone.', { title: 'Delete Section', danger: true })) return;
    delete nlCurrentIssue.sections[secId];
    var remaining = Object.values(nlCurrentIssue.sections).sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
    nlRepackGrid(remaining);
    try {
      var fbUpdates = {};
      fbUpdates['newsletter/issues/' + nlCurrentIssueId + '/sections/' + secId] = null;
      remaining.forEach(function(s) {
        var prefix = 'newsletter/issues/' + nlCurrentIssueId + '/sections/' + s.id + '/';
        fbUpdates[prefix + 'order'] = s.order;
        fbUpdates[prefix + 'gridCol'] = s.gridCol;
        fbUpdates[prefix + 'gridRow'] = s.gridRow;
      });
      await MastDB.multiUpdate(fbUpdates);
      showToast('Section deleted');
      renderNLCompose();
    } catch (err) { showToast('Error deleting section: ' + err.message, true); }
  }

  async function nlDeleteIssue(issueId) {
    var issue = nlIssues.find(function(i) { return i.id === issueId; });
    if (!issue) return;
    if (!await mastConfirm('Delete Issue #' + (issue.issueNumber || '?') + ' "' + (issue.title || 'Untitled') + '"? This cannot be undone.', { title: 'Delete Issue', danger: true })) return;
    try {
      await MastDB.newsletter.issues.ref(issueId).remove();
      if (issue.status === 'published' || issue.publishedAt) {
        try { await MastDB.newsletter.published.ref(issueId).remove(); } catch (e) { /* ignore if not published */ }
      }
      nlIssues = nlIssues.filter(function(i) { return i.id !== issueId; });
      if (nlCurrentIssueId === issueId) {
        nlCurrentIssueId = null;
        nlCurrentIssue = null;
      }
      showToast('Issue deleted');
      renderNLIssueList();
    } catch (err) { showToast('Error deleting issue: ' + err.message, true); }
  }

  async function nlDuplicateIssue(issueId) {
    var source = nlIssues.find(function(i) { return i.id === issueId; });
    if (!source || !source.sections) { showToast('Nothing to duplicate', true); return; }
    try {
      var counterRef = MastDB.newsletter.meta.issueCounter();
      var result = await counterRef.transaction(function(current) { return (current || 0) + 1; });
      var issueNumber = result.snapshot.val();
      var newId = MastDB.newsletter.issues.newKey();
      var newIssue = {
        id: newId, issueNumber: issueNumber, title: '', subjectLine: '', slug: '',
        status: 'draft', sentAt: null, publishedAt: null, sentSubscriberCount: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      var sections = {};
      Object.values(source.sections).sort(function(a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function(s) {
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
      nlIssues.unshift(newIssue);
      showToast('Duplicated as Issue #' + issueNumber);
      nlOpenIssue(newId);
    } catch (err) { showToast('Error duplicating issue: ' + err.message, true); }
  }

  function nlShowAddSectionMenu() {
    var html = '<div class="modal-header"><h3>Add Section</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body"><div style="display:flex;flex-direction:column;gap:8px;">' +
      '<button class="btn btn-secondary" onclick="closeModal();nlAddSection(\'custom\')" style="text-align:left;padding:12px 16px;">\u270D\uFE0F Custom Section</button>' +
      '<button class="btn btn-secondary" onclick="closeModal();nlAddSection(\'coupon\')" style="text-align:left;padding:12px 16px;">\uD83C\uDFF7\uFE0F Coupon Embed</button>' +
      '</div></div>';
    openModal(html);
  }

  async function nlPickCouponForSection(secId) {
    var allCoupons = window.coupons || {};
    var codes = Object.keys(allCoupons).filter(function(code) {
      return getCouponEffectiveStatus(allCoupons[code]) === 'active';
    });
    if (codes.length === 0) { showToast('No active coupons. Create coupons in the Coupons tab first.', true); return; }
    var listHtml = '';
    codes.forEach(function(code) {
      var c = allCoupons[code];
      var valStr = c.type === 'percent' ? c.value + '% off' : '$' + (c.value || 0).toFixed(2) + ' off';
      listHtml += '<div data-coupon-code="' + esc(code) + '" data-sec-id="' + esc(secId) + '" ' +
        'style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--cream-dark);border-radius:6px;cursor:pointer;transition:background 0.15s;" ' +
        'onmouseover="this.style.background=\'rgba(42,124,111,0.06)\'" onmouseout="this.style.background=\'transparent\'" ' +
        'onclick="nlSetSectionCoupon(this.dataset.secId,this.dataset.couponCode)">' +
        '<span style="font-family:monospace;font-weight:600;">' + esc(code) + '</span>' +
        '<span style="color:var(--teal);font-weight:600;">' + esc(valStr) + '</span></div>';
    });
    var html = '<div class="modal-header"><h3>Select Coupon</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body"><div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;">' + listHtml + '</div></div>';
    openModal(html);
  }

  async function nlSetSectionCoupon(secId, code) {
    closeModal();
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    sec.couponCode = code;
    sec.finalContent = '[Coupon:' + code + ']';
    sec.updatedAt = new Date().toISOString();
    try {
      await MastDB.newsletter.issues.section(nlCurrentIssueId, secId).update({
        couponCode: code,
        finalContent: '[Coupon:' + code + ']',
        updatedAt: sec.updatedAt
      });
      renderNLCompose();
    } catch (err) { showToast('Error setting coupon: ' + err.message, true); }
  }

  window.nlShowAddSectionMenu = nlShowAddSectionMenu;
  window.nlPickCouponForSection = nlPickCouponForSection;
  window.nlSetSectionCoupon = nlSetSectionCoupon;
  window.clearNewsletterFilter = function() {
    var p = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var next = {};
    var DROP = { status: 1, issueIds: 1 };
    Object.keys(p).forEach(function(k) { if (!DROP[k]) next[k] = p[k]; });
    if (typeof navigateTo === 'function') navigateTo('newsletter', next);
  };

  // Image picker
  function nlOpenImagePicker(secId) {
    nlImagePickerSection = secId;
    var images = imageLibrary ? Object.values(imageLibrary) : [];
    var sec = nlCurrentIssue && nlCurrentIssue.sections ? nlCurrentIssue.sections[secId] : null;
    var currentImages = sec ? (sec.images || []) : [];

    var html = '<div class="nl-img-picker-overlay" onclick="nlCloseImagePicker()">' +
      '<div class="nl-img-picker" onclick="event.stopPropagation()">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<h3 style="margin:0;">Select Image</h3>' +
      '<button class="btn btn-outline" onclick="nlCloseImagePicker()" style="font-size:0.78rem;">Close</button></div>' +
      '<div class="nl-img-picker-grid">';
    images.forEach(function(img) {
      var isSelected = currentImages.indexOf(img.id || img.imageId) !== -1;
      html += '<div class="nl-img-picker-item ' + (isSelected ? 'selected' : '') + '" onclick="nlSelectImage(\'' + (img.id || img.imageId) + '\')">' +
        '<img src="' + img.url + '" alt="' + (img.alt || '') + '" /></div>';
    });
    if (images.length === 0) {
      html += '<p style="grid-column:1/-1;text-align:center;color:var(--text-secondary);">No images in library. Upload images in Manage → Images first.</p>';
    }
    html += '</div></div></div>';

    var picker = document.createElement('div');
    picker.id = 'nlImagePickerModal';
    picker.innerHTML = html;
    document.body.appendChild(picker);
  }

  function nlCloseImagePicker() {
    var el = document.getElementById('nlImagePickerModal');
    if (el) el.remove();
    nlImagePickerSection = null;
  }

  async function nlSelectImage(imgId) {
    var secId = nlImagePickerSection;
    if (!secId || !nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    if (!sec.images) sec.images = [];
    if (sec.images.indexOf(imgId) !== -1) return;
    if (sec.images.length >= 3) { showToast('Max 3 images per section', true); return; }
    sec.images.push(imgId);
    try {
      await MastDB.newsletter.issues.sectionField(nlCurrentIssueId, secId, 'images').set(sec.images);
      nlCloseImagePicker();
      renderNLCompose();
    } catch (err) { showToast('Error adding image: ' + err.message, true); }
  }

  async function nlRemoveImage(secId, idx) {
    if (!nlCurrentIssue || !nlCurrentIssue.sections || !nlCurrentIssue.sections[secId]) return;
    var sec = nlCurrentIssue.sections[secId];
    if (!sec.images) return;
    sec.images.splice(idx, 1);
    try {
      await MastDB.newsletter.issues.sectionField(nlCurrentIssueId, secId, 'images').set(sec.images.length > 0 ? sec.images : []);
      renderNLCompose();
    } catch (err) { showToast('Error removing image: ' + err.message, true); }
  }

  // ===== HTML EXPORT =====
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

  function nlPreview() { nlExportHTML('preview'); }

  function nlExportHTML(mode) {
    if (!nlCurrentIssue) return;
    var isPreview = mode === 'preview';
    if (!nlCurrentIssue.title || !nlCurrentIssue.title.trim()) {
      showToast(isPreview ? 'Add an issue title before previewing' : 'Add an issue title before exporting', true);
      return;
    }

    var sections = nlCurrentIssue.sections ? Object.values(nlCurrentIssue.sections)
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
      '<title>' + esc(nlCurrentIssue.subjectLine || nlCurrentIssue.title || (_ec.brand.name + ' — Issue #' + nlCurrentIssue.issueNumber)) + '</title></head>' +
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
      '<td style="text-align:right;white-space:nowrap;"><span style="color:rgba(245,240,235,0.5);font-size:10px;">Issue #' + nlCurrentIssue.issueNumber + '</span></td>' +
      '</tr></table>' +
      '</td></tr>' +
      '<!-- Title -->' +
      '<tr><td style="padding:30px 30px 10px;"><h1 style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:26px;color:#2C2C2C;margin:0;font-weight:400;">' + nlEscHtml(nlCurrentIssue.title) + '</h1></td></tr>' +
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

    var filename = ((TENANT_CONFIG && TENANT_CONFIG.brand.newsletterDownloadPrefix) || 'newsletter') + '-' + nlCurrentIssue.issueNumber + '-' + (nlCurrentIssue.slug || 'newsletter') + '.html';

    var modalHtml =
      '<div style="padding:24px;">' +
      '<h3 style="margin:0 0 4px;font-size:1.15rem;font-weight:500;">Export HTML Email</h3>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 14px;">Copy the HTML below to paste into your email platform, or download the file.</p>' +
      '<textarea id="nlExportTextarea" readonly style="width:100%;height:200px;font-family:monospace;font-size:0.72rem;padding:10px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--text-primary);resize:vertical;box-sizing:border-box;"></textarea>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
        '<button class="btn btn-secondary" onclick="(function(){var b=new Blob([document.getElementById(\'nlExportTextarea\').value],{type:\'text/html\'});var u=URL.createObjectURL(b);var a=document.createElement(\'a\');a.href=u;a.download=\'' + filename.replace(/'/g, "\\'") + '\';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u);showToast(\'Downloaded!\');})()" >&#x2193; Download</button>' +
        '<button class="btn btn-primary" onclick="(function(){var ta=document.getElementById(\'nlExportTextarea\');ta.select();try{navigator.clipboard.writeText(ta.value).then(function(){showToast(\'Copied to clipboard! \u{1F4CB}\');});}catch(e){document.execCommand(\'copy\');showToast(\'Copied! \u{1F4CB}\');}})()">Copy to Clipboard</button>' +
      '</div>' +
      '</div>';
    if (isPreview) {
      // Open in a new tab as rendered HTML — closest thing to seeing the
      // issue as a subscriber would, without actually sending the email.
      var win = window.open('', '_blank');
      if (!win) { showToast('Pop-up blocked — allow pop-ups to preview.', true); return; }
      win.document.open();
      win.document.write(emailHtml);
      win.document.close();
      try { win.document.title = 'Preview · ' + (nlCurrentIssue.title || 'Newsletter'); } catch (e) {}
      return;
    }
    openModal(modalHtml);
    var ta = document.getElementById('nlExportTextarea');
    if (ta) ta.value = emailHtml;
  }

  // ===== PUBLISH TO WEBSITE =====
  async function nlPublishToWebsite() {
    if (!nlCurrentIssue) return;
    if (!nlCurrentIssue.title || !nlCurrentIssue.title.trim()) { showToast('Add an issue title before publishing', true); return; }

    var sections = nlCurrentIssue.sections ? Object.values(nlCurrentIssue.sections)
      .filter(function(s) { return s.included && (s.finalContent || s.rawInput); })
      .sort(function(a, b) { return (a.order || 0) - (b.order || 0); })
      .map(function(s) {
        return { title: s.title, content: s.finalContent || s.rawInput, images: s.images || [], cardSize: s.cardSize || 'medium', gridWidth: s.gridWidth || 1 };
      }) : [];

    if (sections.length === 0) { showToast('Add content to at least one section before publishing', true); return; }

    var publishedAt = new Date().toISOString();
    var postData = {
      issueNumber: nlCurrentIssue.issueNumber,
      title: nlCurrentIssue.title,
      subjectLine: nlCurrentIssue.subjectLine || '',
      slug: nlCurrentIssue.slug,
      publishedAt: publishedAt,
      sections: sections
    };

    try {
      await MastDB.newsletter.published.ref(nlCurrentIssueId).set(postData);
      nlCurrentIssue.status = 'published';
      nlCurrentIssue.publishedAt = publishedAt;
      nlCurrentIssue.updatedAt = new Date().toISOString();
      await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({
        status: 'published', publishedAt: publishedAt, updatedAt: nlCurrentIssue.updatedAt
      });
      showToast('Published to website! 🌐');
      emitTestingEvent('publishNewsletter', {});
      renderNLCompose();
    } catch (err) { showToast('Error publishing: ' + err.message, true); }
  }

  // ===== MARK AS SENT (fallback only — use Send button for real sends) =====
  async function nlMarkAsSent() {
    if (!nlCurrentIssue) return;
    if (!await mastConfirm('Mark as sent without actually sending? Use this only if Send failed or you sent the issue manually.', { title: 'Mark as Sent (fallback)' })) return;
    var sentAt = new Date().toISOString();
    var activeSubs = nlSubscribers.filter(function(s) { return s.status === 'active'; }).length;

    try {
      nlCurrentIssue.status = 'sent';
      nlCurrentIssue.sentAt = sentAt;
      nlCurrentIssue.sentSubscriberCount = activeSubs;
      nlCurrentIssue.updatedAt = new Date().toISOString();
      await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({
        status: 'sent', sentAt: sentAt, sentSubscriberCount: activeSubs, sendStatus: 'manual-mark', updatedAt: nlCurrentIssue.updatedAt
      });
      showToast('Marked as sent to ' + activeSubs + ' subscribers ✉️');
      renderNLCompose();
    } catch (err) { showToast('Error: ' + err.message, true); }
  }

  // ===== W3a-send — A/B test field toggles =====
  async function nlToggleAbTest(enabled) {
    if (!nlCurrentIssue) return;
    var ab = nlCurrentIssue.abTest || {};
    ab.enabled = !!enabled;
    if (enabled) {
      if (typeof ab.holdoutPct !== 'number') ab.holdoutPct = 50;
      if (typeof ab.testWindowHours !== 'number') ab.testWindowHours = 4;
      if (!ab.variantA) ab.variantA = {};
      if (!ab.variantB) ab.variantB = {};
    }
    nlCurrentIssue.abTest = ab;
    try {
      await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({ abTest: ab, updatedAt: new Date().toISOString() });
      renderNLCompose();
    } catch (err) { showToast('Error: ' + err.message, true); }
  }

  async function nlUpdateAbField(path, value) {
    if (!nlCurrentIssue) return;
    var ab = nlCurrentIssue.abTest || {};
    var parts = String(path).split('.');
    var cur = ab;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    nlCurrentIssue.abTest = ab;
    try {
      await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({ abTest: ab, updatedAt: new Date().toISOString() });
    } catch (err) { showToast('Error: ' + err.message, true); }
  }

  // ===== W3a-send — compose rendered HTML body for the issue =====
  function nlComposeIssueHtml(issueOverride) {
    var issue = issueOverride || nlCurrentIssue;
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

  // ===== W3a-send — Send Test =====
  async function nlSendTest() {
    if (!nlCurrentIssue) return;
    var defaultEmail = (currentUser && currentUser.email) || '';
    var toEmail = window.prompt('Send a test of this newsletter to which email?', defaultEmail);
    if (!toEmail) return;
    toEmail = toEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) { showToast('Invalid email address', true); return; }
    var subject = (nlCurrentIssue.subjectLine || nlCurrentIssue.title || '(test)') + ' [TEST]';
    var htmlBody = nlComposeIssueHtml(nlCurrentIssue);
    var idempotencyKey = 'test-' + nlCurrentIssueId + '-' + Date.now();
    try {
      await MastDB.set('emailQueue/' + idempotencyKey, {
        id: idempotencyKey,
        type: 'test',
        issueId: nlCurrentIssueId,
        subject: subject,
        htmlBody: htmlBody,
        to: toEmail,
        idempotencyKey: idempotencyKey,
        queuedAt: new Date().toISOString(),
        queuedBy: (currentUser && currentUser.uid) || null,
        status: 'queued',
      });
      showToast('Test queued to ' + toEmail + ' — delivery in ~10s 📨');
    } catch (err) { showToast('Send test failed: ' + err.message, true); }
  }

  // ===== W3a-send — Send (real send to audience segment) =====
  async function nlSendIssue() {
    if (!nlCurrentIssue) return;
    var seg = nlCurrentIssue.segmentId || '__all_active';
    var recipients = nlMatchSubscribersForSegment(seg);
    if (!recipients.length) {
      showToast('No recipients matched for this audience', true);
      return;
    }
    var ab = nlCurrentIssue.abTest || {};
    var holdoutPct = typeof ab.holdoutPct === 'number' ? ab.holdoutPct : 50;
    var testHours = typeof ab.testWindowHours === 'number' ? ab.testWindowHours : 4;
    var totalCount = recipients.length;
    var msg = ab.enabled
      ? 'Send this issue to ' + totalCount + ' subscribers? An A/B test will go to ' + (100 - holdoutPct) + '% of the list now (split A/B), then the winner will go to the remaining ' + holdoutPct + '% after ' + testHours + ' hours.'
      : 'Send this issue to ' + totalCount + ' subscribers now?';
    if (!await mastConfirm(msg, { title: ab.enabled ? 'Send (with A/B test)' : 'Send' })) return;

    var subjectA = nlCurrentIssue.subjectLine || nlCurrentIssue.title || '(no subject)';
    var htmlBody = nlComposeIssueHtml(nlCurrentIssue);

    // Determine variant assignment.
    var nowIso = new Date().toISOString();
    var queuedTotal = 0;
    var skippedTotal = 0;
    var sendStartedAt = nowIso;

    if (ab.enabled) {
      // Shuffle deterministically by email hash for stable A/B/holdout split.
      var hashed = recipients.map(function(r) {
        var s = String(r.email || '').toLowerCase();
        var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
        return { r: r, h: h };
      }).sort(function(a, b) { return a.h - b.h; });
      var testCount = Math.floor(hashed.length * (100 - holdoutPct) / 100);
      var halfTest = Math.floor(testCount / 2);
      var assignVariantA = hashed.slice(0, halfTest).map(function(x) { return x.r; });
      var assignVariantB = hashed.slice(halfTest, testCount).map(function(x) { return x.r; });
      var holdoutRecipients = hashed.slice(testCount).map(function(x) { return x.r; });

      var subjectB = (ab.variantB && ab.variantB.subject) || subjectA;

      // Stash the audience split on the issue so the winner cron can find the holdout.
      var abPersist = Object.assign({}, ab, {
        sendStartedAt: sendStartedAt,
        testWindowExpiresAt: new Date(Date.now() + testHours * 3600 * 1000).toISOString(),
        winner: null,
        winnerPickedAt: null,
        holdoutSendStartedAt: null,
        variantA: Object.assign({}, ab.variantA || {}, { subject: subjectA, recipientCount: assignVariantA.length }),
        variantB: Object.assign({}, ab.variantB || {}, { subject: subjectB, recipientCount: assignVariantB.length, htmlBody: htmlBody }),
        holdoutRecipients: holdoutRecipients,
      });
      // Also stash subject + htmlBody at issue level for cron reuse.
      try {
        await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({
          abTest: abPersist,
          subject: subjectA,
          htmlBody: htmlBody,
          sendStatus: 'sending',
          sendStartedAt: sendStartedAt,
          updatedAt: nowIso,
        });
      } catch (err) { showToast('Error initializing send: ' + err.message, true); return; }

      var qaSkip = await _nlQueueRecipients(assignVariantA, subjectA, htmlBody, 'A', seg);
      var qbSkip = await _nlQueueRecipients(assignVariantB, subjectB, htmlBody, 'B', seg);
      queuedTotal = qaSkip.queued + qbSkip.queued;
      skippedTotal = qaSkip.skipped + qbSkip.skipped;
    } else {
      try {
        await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({
          subject: subjectA,
          htmlBody: htmlBody,
          sendStatus: 'sending',
          sendStartedAt: sendStartedAt,
          updatedAt: nowIso,
        });
      } catch (err) { showToast('Error initializing send: ' + err.message, true); return; }
      var qres = await _nlQueueRecipients(recipients, subjectA, htmlBody, null, seg);
      queuedTotal = qres.queued;
      skippedTotal = qres.skipped;
    }

    try {
      await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({
        sendQueuedCount: queuedTotal,
        sendSkippedCount: skippedTotal,
        sendStatus: 'sending',
      });
    } catch (_e) { /* tolerate */ }

    showToast('Send queued: ' + queuedTotal + ' email(s), ' + skippedTotal + ' skipped 🚀');
    nlCurrentIssue.sendStatus = 'sending';
    nlCurrentIssue.sendQueuedCount = queuedTotal;
    nlCurrentIssue.sendSkippedCount = skippedTotal;
    renderNLCompose();
  }

  // Browser-side sha1 of (issueId|segmentId|email|variant). Uses the
  // subtle-crypto API. Returns a Promise<hexstring>.
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

  async function _nlQueueRecipients(recipients, subject, htmlBody, variantTag, segmentId) {
    var queued = 0, skipped = 0;
    var nowIso = new Date().toISOString();
    for (var i = 0; i < recipients.length; i++) {
      var r = recipients[i];
      if (!r || !r.email) continue;
      var lower = String(r.email).toLowerCase();
      var keyInput = nlCurrentIssueId + '|' + (segmentId || '') + '|' + lower + '|' + (variantTag || 'main');
      var idempotencyKey;
      try { idempotencyKey = await _nlSha1Hex(keyInput); }
      catch (_e) { idempotencyKey = nlCurrentIssueId + '_' + lower.replace(/[^a-z0-9]/g, '_') + '_' + (variantTag || 'main'); }
      // Skip-if-exists.
      try {
        var prior = await MastDB.get('emailQueue/' + idempotencyKey);
        if (prior) { skipped++; continue; }
      } catch (_e) { /* fall through to write */ }
      try {
        await MastDB.set('emailQueue/' + idempotencyKey, {
          id: idempotencyKey,
          type: 'newsletter',
          issueId: nlCurrentIssueId,
          segmentId: segmentId || null,
          variant: variantTag || null,
          subject: subject,
          htmlBody: htmlBody,
          to: r.email,
          toName: r.name || null,
          idempotencyKey: idempotencyKey,
          queuedAt: nowIso,
          queuedBy: (currentUser && currentUser.uid) || null,
          status: 'queued',
        });
        await MastDB.set('admin/emailSends/' + idempotencyKey, {
          idempotencyKey: idempotencyKey,
          type: 'newsletter',
          issueId: nlCurrentIssueId,
          segmentId: segmentId || null,
          variant: variantTag || null,
          to: r.email,
          queuedAt: nowIso,
          status: 'queued',
        });
        queued++;
      } catch (err) {
        console.warn('queue write failed for ' + lower, err);
      }
    }
    return { queued: queued, skipped: skipped };
  }

  // ===== W3a-send — Pick Winner Now (manual override) =====
  async function nlPickWinnerNow() {
    if (!nlCurrentIssue) return;
    var ab = nlCurrentIssue.abTest || {};
    if (!ab.enabled || !ab.sendStartedAt) { showToast('No A/B test in progress', true); return; }
    if (ab.winnerPickedAt) { showToast('Winner already picked', true); return; }
    if (!await mastConfirm('Force-pick the A/B winner now and send to holdout audience? (Normally the cron picks at the end of the test window.)', { title: 'Pick Winner Now' })) return;

    // Shortcut: nudge testWindowExpiresAt into the past so the cron picks
    // it up on the next 15-minute tick. Faster path is to do it client-side
    // for immediate feedback.
    var nowIso = new Date().toISOString();
    try {
      await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({
        'abTest/testWindowExpiresAt': nowIso,
      });
      showToast('Winner pick triggered — the cron will queue the holdout send on its next tick (≤15 min).');
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  // ===== SUBSCRIBERS SCREEN =====
  // W1.2 — saved filter preset for subscribers (in-memory; persists per session)
  var nlSubPreset = window.nlSubPreset || '__all';

  function nlSubPresetMatches(sub, preset) {
    var key = String(sub.email || '').toLowerCase().trim();
    var stats = nlCustomerStatsByEmail[key];
    var ninetyDaysAgo = Date.now() - 90 * 86400 * 1000;
    switch (preset) {
      case '__repeat_2': return !!(stats && stats.orderCount >= 2);
      case '__lapsed_90':
        if (!stats || !stats.lastOrderAt) return false;
        return new Date(stats.lastOrderAt).getTime() < ninetyDaysAgo;
      case '__no_orders': return !stats || !stats.orderCount;
      default: return true;
    }
  }

  function nlFmtRelativeDate(iso) {
    if (!iso) return '—';
    var t;
    try { t = new Date(iso).getTime(); } catch (_e) { return '—'; }
    if (isNaN(t)) return '—';
    var diff = Date.now() - t;
    var d = Math.floor(diff / 86400000);
    var label;
    if (d < 1) label = 'today';
    else if (d < 7) label = d + 'd ago';
    else if (d < 30) label = Math.floor(d / 7) + 'w ago';
    else if (d < 365) label = Math.floor(d / 30) + 'mo ago';
    else label = Math.floor(d / 365) + 'y ago';
    return label;
  }

  function nlFmtMoney(cents) {
    if (!cents) return '$0';
    return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
  }

  function renderNLSubscribers() {
    nlCurrentView = 'subscribers';
    // Ensure stats are loaded — fire-and-forget; re-render when ready.
    if (!nlSegmentsLoaded) {
      nlLoadSegmentsLazy().then(function() { renderNLSubscribers(); }).catch(function() { nlSegmentsLoaded = true; });
    }

    var showAll = window.nlShowAllSubs || false;
    var preset = window.nlSubPreset || nlSubPreset || '__all';
    var base = showAll ? nlSubscribers : nlSubscribers.filter(function(s) { return s.status === 'active'; });
    var filtered = (preset === '__all') ? base : base.filter(function(s) { return nlSubPresetMatches(s, preset); });
    var activeCount = nlSubscribers.filter(function(s) { return s.status === 'active'; }).length;

    var presetBtn = function(id, label, tip) {
      var active = preset === id;
      var bg = active ? 'background:var(--teal,#2a7c6f);color:#fff;border-color:var(--teal,#2a7c6f);' : '';
      return '<button class="btn btn-outline" style="font-size:0.78rem;padding:4px 10px;' + bg + '" title="' + esc(tip) + '" onclick="window.nlSubPreset=\'' + id + '\'; renderNLSubscribers();">' + esc(label) + '</button>';
    };

    var html = '<div class="nl-sub-nav">' +
      '<button onclick="nlSwitchView(\'issues\')">Issues</button>' +
      '<button class="active" onclick="nlSwitchView(\'subscribers\')">Subscribers</button>' +
      '</div>' +
      '<div class="nl-header"><h2>Subscribers <span style="font-weight:400;font-size:0.9rem;color:var(--text-secondary);">(' + activeCount + ' active)</span></h2>' +
      '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-outline" onclick="nlExportSubscribersCSV()">📤 Export CSV</button>' +
      '<button class="btn btn-primary" onclick="nlAddSubscriber()">+ Add Subscriber</button>' +
      '</div></div>' +
      // W1.2 — saved-filter presets + show-unsubscribed toggle on one row
      '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
      presetBtn('__all',       'All',                 'No filter') +
      presetBtn('__repeat_2',  'Repeat buyer 2+',     'Subscribers with 2 or more orders') +
      presetBtn('__lapsed_90', 'Lapsed 90d',          'No order in the last 90 days') +
      presetBtn('__no_orders', 'No orders yet',       'Subscribed but never purchased') +
      '<label style="margin-left:auto;font-size:0.85rem;color:var(--text-secondary);display:flex;align-items:center;gap:6px;">' +
      '<input type="checkbox" ' + (showAll ? 'checked' : '') + ' onchange="window.nlShowAllSubs=this.checked; renderNLSubscribers();" /> Show unsubscribed</label></div>';

    if (filtered.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">📬</div>' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No subscribers match this filter</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Switch to "All" or add subscribers manually.</p></div>';
    } else {
      // W1.2 — added Orders, Last purchased, Lifetime value columns
      html += '<table class="nl-sub-table"><thead><tr>' +
        '<th>Name</th><th>Email</th><th>Source</th><th>Subscribed</th>' +
        '<th style="text-align:right;">Orders</th>' +
        '<th>Last purchased</th>' +
        '<th style="text-align:right;">Lifetime value</th>' +
        '<th>Status</th><th title="Bounce or complaint flag from Resend webhook">Health</th><th>Notes</th><th></th></tr></thead><tbody>';
      filtered.forEach(function(sub) {
        var dateStr = sub.subscribedAt ? new Date(sub.subscribedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        var sourceClass = sub.source === 'website-form' ? 'website' : 'manual';
        var sourceLabel = sub.source === 'website-form' ? 'Website' : 'Manual';
        var key = String(sub.email || '').toLowerCase().trim();
        var stats = nlCustomerStatsByEmail[key];
        var ordersHtml = stats ? String(stats.orderCount || 0) : '<span style="color:var(--text-secondary);">—</span>';
        var lastHtml;
        if (stats && stats.lastOrderAt) {
          var abs = new Date(stats.lastOrderAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          lastHtml = '<span title="' + esc(abs) + '">' + esc(nlFmtRelativeDate(stats.lastOrderAt)) + '</span>';
        } else {
          lastHtml = '<span style="color:var(--text-secondary);">—</span>';
        }
        var ltvHtml = stats ? nlFmtMoney(stats.lifetimeSpendCents || 0) : '<span style="color:var(--text-secondary);">—</span>';
        html += '<tr>' +
          '<td>' + nlEscHtml(sub.name) + '</td>' +
          '<td>' + nlEscHtml(sub.email) + '</td>' +
          '<td><span class="nl-source-badge ' + sourceClass + '">' + sourceLabel + '</span></td>' +
          '<td>' + dateStr + '</td>' +
          '<td style="text-align:right;">' + ordersHtml + '</td>' +
          '<td>' + lastHtml + '</td>' +
          '<td style="text-align:right;">' + ltvHtml + '</td>' +
          '<td>' + (sub.status === 'active' ? '<span style="color:#5A7A5A;">Active</span>' : '<span style="color:var(--text-secondary);">Unsubscribed</span>') + '</td>' +
          '<td>' + (sub.bounceFlag ? '<span title="Bounced — ' + esc(sub.bounceFlagAt || '') + '" style="color:#EF5350;">⚠ Bounce</span>' : (sub.complaintFlag ? '<span title="Complained — ' + esc(sub.complaintFlagAt || '') + '" style="color:#EF5350;">⚠ Complaint</span>' : '<span style="color:var(--text-secondary);">—</span>')) + '</td>' +
          '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + nlEscHtml(sub.notes || '') + '</td>' +
          '<td>';
        if (sub.status === 'active') {
          html += '<button class="btn btn-outline" style="font-size:0.72rem;padding:2px 6px;" onclick="nlUnsubscribe(\'' + sub.id + '\')">Remove</button>';
        }
        html += '</td></tr>';
      });
      html += '</tbody></table>';
    }
    document.getElementById('newsletterContent').innerHTML = html;
  }

  // Add subscriber modal
  function nlAddSubscriber() {
    var modal = document.createElement('div');
    modal.id = 'nlAddSubModal';
    modal.innerHTML = '<div class="nl-img-picker-overlay" onclick="nlCloseSubModal()">' +
      '<div class="nl-img-picker" style="max-width:420px;" onclick="event.stopPropagation()">' +
      '<h3 style="margin:0 0 16px;">Add Subscriber</h3>' +
      '<div style="margin-bottom:12px;"><label style="font-size:0.85rem;display:block;margin-bottom:4px;">Name *</label>' +
      '<input type="text" id="nlSubName" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);" /></div>' +
      '<div style="margin-bottom:12px;"><label style="font-size:0.85rem;display:block;margin-bottom:4px;">Email *</label>' +
      '<input type="email" id="nlSubEmail" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);" /></div>' +
      '<div style="margin-bottom:16px;"><label style="font-size:0.85rem;display:block;margin-bottom:4px;">Notes</label>' +
      '<input type="text" id="nlSubNotes" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);" /></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button class="btn btn-outline" onclick="nlCloseSubModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="nlSaveSubscriber()">Add</button></div></div></div>';
    document.body.appendChild(modal);
  }

  function nlCloseSubModal() {
    var el = document.getElementById('nlAddSubModal');
    if (el) el.remove();
  }

  async function nlSaveSubscriber() {
    var name = document.getElementById('nlSubName').value.trim();
    var email = document.getElementById('nlSubEmail').value.trim();
    var notes = document.getElementById('nlSubNotes').value.trim();

    if (!name || !email) { showToast('Name and email are required', true); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Invalid email address', true); return; }
    var exists = nlSubscribers.some(function(s) { return s.email.toLowerCase() === email.toLowerCase() && s.status === 'active'; });
    if (exists) { showToast('This email is already subscribed', true); return; }

    var subId = MastDB.newsletter.subscribers.newKey();
    var token = subId + '-' + Date.now().toString(36);
    var subData = {
      id: subId, name: name, email: email, notes: notes || null,
      subscribedAt: new Date().toISOString(), source: 'manual',
      status: 'active', unsubscribeToken: token, unsubscribedAt: null
    };

    try {
      await MastDB.newsletter.subscribers.ref(subId).set(subData);
      nlSubscribers.unshift(subData);
      nlCloseSubModal();
      showToast('Subscriber added');
      renderNLSubscribers();
    } catch (err) { showToast('Error adding subscriber: ' + err.message, true); }
  }

  async function nlUnsubscribe(subId) {
    var sub = nlSubscribers.find(function(s) { return s.id === subId; });
    if (!sub) return;
    if (!await mastConfirm('Remove ' + sub.name + ' (' + sub.email + ') from the mailing list?', { title: 'Remove Subscriber', danger: true })) return;
    try {
      sub.status = 'unsubscribed';
      sub.unsubscribedAt = new Date().toISOString();
      await MastDB.newsletter.subscribers.ref(subId).update({
        status: 'unsubscribed', unsubscribedAt: sub.unsubscribedAt
      });
      showToast('Subscriber removed');
      renderNLSubscribers();
    } catch (err) { showToast('Error: ' + err.message, true); }
  }

  function nlExportSubscribersCSV() {
    var active = nlSubscribers.filter(function(s) { return s.status === 'active'; });
    if (active.length === 0) { showToast('No active subscribers to export', true); return; }
    var csv = 'Name,Email,Subscribed At\n';
    active.forEach(function(s) {
      csv += '"' + (s.name || '').replace(/"/g, '""') + '","' + (s.email || '').replace(/"/g, '""') + '","' + (s.subscribedAt || '') + '"\n';
    });
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = MastDB.tenantId() + '-subscribers-' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('CSV exported with ' + active.length + ' subscribers 📤');
  }

  // ============================================================
  // Window exports for onclick handlers
  // ============================================================

  window.nlSwitchView = nlSwitchView;
  window.nlCreateIssue = nlCreateIssue;
  window.nlOpenIssue = nlOpenIssue;
  window.nlBackToList = nlBackToList;
  window.nlToggleSection = nlToggleSection;
  window.nlSetViewMode = nlSetViewMode;
  window.nlUpdateTitle = nlUpdateTitle;
  window.nlUpdateSubjectLine = nlUpdateSubjectLine;
  window.nlUpdateSectionTitle = nlUpdateSectionTitle;
  window.nlToggleInclude = nlToggleInclude;
  window.nlUpdateRawInput = nlUpdateRawInput;
  window.nlUpdateFinalContent = nlUpdateFinalContent;
  window.nlUseAsIs = nlUseAsIs;
  window.nlPolishSection = nlPolishSection;
  window.nlDraftInClaude = nlDraftInClaude;
  window.nlPickVersion = nlPickVersion;
  window.nlResetSection = nlResetSection;
  window.nlAddSection = nlAddSection;
  window.nlDeleteSection = nlDeleteSection;
  window.nlDeleteIssue = nlDeleteIssue;
  window.nlDuplicateIssue = nlDuplicateIssue;
  window.nlFormatCmd = nlFormatCmd;
  window.nlUpdateToolbarState = nlUpdateToolbarState;
  window.nlInsertLink = nlInsertLink;
  window.nlApplyLink = nlApplyLink;
  window.nlRemoveLink = nlRemoveLink;
  window.nlEditableChanged = nlEditableChanged;
  window.nlFlushEditableSave = nlFlushEditableSave;
  window.nlOpenImagePicker = nlOpenImagePicker;
  window.nlCloseImagePicker = nlCloseImagePicker;
  window.nlSelectImage = nlSelectImage;
  window.nlRemoveImage = nlRemoveImage;
  window.nlExportHTML = nlExportHTML;
  window.nlPreview = nlPreview;
  window.nlPublishToWebsite = nlPublishToWebsite;
  window.nlMarkAsSent = nlMarkAsSent;
  window.nlSendTest = nlSendTest;
  window.nlSendIssue = nlSendIssue;
  window.nlPickWinnerNow = nlPickWinnerNow;
  window.nlToggleAbTest = nlToggleAbTest;
  window.nlUpdateAbField = nlUpdateAbField;
  window.nlAddSubscriber = nlAddSubscriber;
  window.nlCloseSubModal = nlCloseSubModal;
  window.nlSaveSubscriber = nlSaveSubscriber;
  window.nlUnsubscribe = nlUnsubscribe;
  window.nlExportSubscribersCSV = nlExportSubscribersCSV;
  window.nlDragStart = nlDragStart;
  window.nlDragEnd = nlDragEnd;
  window.nlDragOver = nlDragOver;
  window.nlDrop = nlDrop;
  window.nlOpenCardEditor = nlOpenCardEditor;
  window.nlEditorCharCount = nlEditorCharCount;
  window.nlCloseCardEditor = nlCloseCardEditor;
  window.nlChangeCardSize = nlChangeCardSize;
  window.renderNLSubscribers = renderNLSubscribers;

  // Bridge for the newsletter-v2 redesign twin (flag-gated #newsletter-v2). It
  // delegates subscriber create/update here so the record write + dedup +
  // validation + the unsubscribe status flip stay single-sourced — the twin never
  // reimplements that logic. Additive; no behavior change to the legacy surface.
  // These mirror the EXACT client writes nlSaveSubscriber()/nlUnsubscribe() make,
  // parameterized by data (the legacy handlers read the modal DOM, so they can't
  // be called with an object). Mirrors window.ContactsBridge. NOTE: legacy "add
  // subscriber" is a pure record write — it does NOT send a welcome/confirmation
  // email — so create stays a plain write here too (no send to route).
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
    }
  };

  // ============================================================
  // W2.2 / W2.6 — Composer + Campaigns hooks
  // ============================================================
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
  window.newsletterOpenFromContent = newsletterOpenFromContent;

  // ============================================================
  // Module registration
  // ============================================================

  MastAdmin.registerModule('newsletter', {
    routes: {
      'newsletter': {
        tab: 'newsletterTab',
        setup: function() { if (!newsletterLoaded) loadNewsletter(); }
      }
    }
  });

})();
