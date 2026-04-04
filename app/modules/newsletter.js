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
    return '<span class="status-badge pill" style="' + (colors[s] || colors.draft) + '">' + s + '</span>';
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
    var html = '<div class="nl-sub-nav">' +
      '<button class="active" onclick="nlSwitchView(\'issues\')">Issues</button>' +
      '<button onclick="nlSwitchView(\'subscribers\')">Subscribers</button>' +
      '</div>' +
      '<div class="nl-header"><h2>Newsletter Issues</h2>' +
      '<button class="btn btn-primary" onclick="nlCreateIssue()">+ New Issue</button></div>';

    if (nlIssues.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:2rem;margin-bottom:12px;">📰</div>' +
        '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No newsletter issues yet</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Create your first issue to start composing.</p></div>';
    } else {
      nlIssues.forEach(function(issue) {
        var dateStr = issue.createdAt ? new Date(issue.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        html += '<div class="nl-issue-row" onclick="nlOpenIssue(\'' + issue.id + '\')">' +
          '<span class="nl-issue-num">#' + (issue.issueNumber || '?') + '</span>' +
          '<span class="nl-issue-title">' + esc(issue.title || 'Untitled Issue') + '</span>' +
          nlBadgeHtml(issue.status) +
          '<span class="nl-issue-date">' + dateStr + '</span>' +
          '</div>';
      });
    }
    document.getElementById('newsletterContent').innerHTML = html;
  }

  function nlSwitchView(view) {
    nlCurrentView = view;
    renderNewsletter();
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
      var issueData = {
        id: issueId,
        issueNumber: issueNumber,
        title: '',
        slug: '',
        status: 'draft',
        sentAt: null,
        publishedAt: null,
        sentSubscriberCount: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      var sections = {};
      var gridCol = 0, gridRow = 0;
      NL_DEFAULT_SECTIONS.forEach(function(def, idx) {
        var secId = MastDB._newRootKey();
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

      issueData.sections = sections;
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
        MastDB._multiUpdate(fbUpdates).catch(function(err) { console.error('Grid migration error:', err); });
      }
    }
    renderNLCompose();
  }

  // ===== COMPOSE SCREEN =====
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
      '</div>';

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
            html += '<div style="margin-top:8px;"><button class="btn btn-outline" style="font-size:0.8rem;" onclick="nlPickCouponForSection(\'' + sec.id + '\')">' +
              (sec.couponCode ? 'Change Coupon' : 'Select Coupon') + '</button></div>';
            html += '</div></div>';
            return; // skip rest of section rendering in forEach
          }
          if (sec.guidedPrompt) html += '<div class="nl-section-prompt">' + sec.guidedPrompt + '</div>';
          if (aiResult && !sec.finalContent) {
            html += '<div class="nl-ai-compare">' +
              '<div class="nl-ai-panel original"><div class="nl-ai-panel-label">Your Original</div>' + nlEscHtml(sec.rawInput) + '</div>' +
              '<div class="nl-ai-panel polished"><div class="nl-ai-panel-label">AI Polished</div>' + nlEscHtml(aiResult) + '</div></div>' +
              '<div class="nl-ai-actions"><button class="btn btn-outline" onclick="nlPickVersion(\'' + sec.id + '\', \'original\')">Use Original</button>' +
              '<button class="btn btn-primary" onclick="nlPickVersion(\'' + sec.id + '\', \'ai\')">Use AI Version</button></div>';
          } else if (sec.finalContent) {
            html += '<textarea class="nl-section-textarea" id="nlFinal_' + sec.id + '" onchange="nlUpdateFinalContent(\'' + sec.id + '\', this.value)">' + nlEscHtml(sec.finalContent) + '</textarea>';
            html += '<div style="margin-top:8px;"><button class="btn btn-outline" style="font-size:0.8rem;" onclick="nlResetSection(\'' + sec.id + '\')">Reset to Draft</button></div>';
          } else {
            html += '<textarea class="nl-section-textarea" id="nlRaw_' + sec.id + '" placeholder="Write your content here..." onchange="nlUpdateRawInput(\'' + sec.id + '\', this.value)">' + nlEscHtml(sec.rawInput || '') + '</textarea>';
            var hasContent = !!(sec.rawInput && sec.rawInput.trim());
            html += '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;">' +
              '<button class="btn btn-outline" style="font-size:0.8rem;" ' + (hasContent ? '' : 'disabled') + ' onclick="nlPolishSection(\'' + sec.id + '\')">✨ Polish with AI</button>';
            if (hasContent) html += '<button class="btn btn-outline" style="font-size:0.8rem;" onclick="nlUseAsIs(\'' + sec.id + '\')">Use as-is</button>';
            html += '</div>';
          }
          var images = sec.images || [];
          html += '<div class="nl-section-images">';
          images.forEach(function(imgId, idx) {
            var img = imageLibrary ? imageLibrary[imgId] : null;
            if (img) html += '<div style="position:relative;"><img class="nl-section-img-thumb" src="' + esc(img.url) + '" alt="" /><span style="position:absolute;top:-4px;right:-4px;cursor:pointer;background:var(--danger);color:#fff;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;" onclick="nlRemoveImage(\'' + sec.id + '\',' + idx + ')">×</span></div>';
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
          var charCount = content.length;
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
            '<span class="nl-grid-overlay-badge ' + charClass + '">' + charCount + '/' + charLimit + '</span></div>';

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
            (gridBodyContent ? gridBodyContent.replace(/\n/g, '<br>') : '<span class="placeholder">Click to add content...</span>') + '</div>';

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

    // Actions bar
    html += '<div class="nl-compose-actions">' +
      '<button class="btn btn-primary" onclick="nlExportHTML()">📥 Export HTML</button>' +
      '<button class="btn btn-outline" onclick="nlPublishToWebsite()">🌐 Publish to Website</button>' +
      '<button class="btn btn-outline" onclick="nlMarkAsSent()">✉️ Mark as Sent</button>' +
      '</div>';

    document.getElementById('newsletterContent').innerHTML = html;
  }

  function nlEscHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');
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
      await MastDB._multiUpdate(fbUpdates);
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
    var charCount = content.length;
    var aiResult = nlAiResults[secId];

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--border);">' +
      '<div style="display:flex;align-items:center;gap:8px;flex:1;">' +
      '<span style="font-size:1.2rem;">' + nlGetTypeIcon(sec.type) + '</span>' +
      '<input type="text" value="' + (sec.title || '').replace(/"/g, '&quot;') + '"' +
      ' style="border:none;background:transparent;font-size:1.1rem;font-weight:600;color:var(--text);flex:1;padding:4px 0;"' +
      ' onchange="nlUpdateSectionTitle(\'' + secId + '\', this.value)" />' +
      '</div>' +
      '<button style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-secondary);padding:4px 8px;" onclick="nlCloseCardEditor(\'' + secId + '\')">×</button></div>';

    html += '<div style="padding:16px 24px;">';

    // Card size selector
    html += '<div style="display:flex;gap:6px;margin-bottom:16px;align-items:center;flex-wrap:wrap;">' +
      '<span style="font-size:0.8rem;color:var(--text-secondary);margin-right:4px;">Size:</span>';
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
      html += '<div style="margin-top:8px;"><button class="btn btn-outline" style="font-size:0.8rem;" onclick="nlPickCouponForSection(\'' + secId + '\')">' +
        (sec.couponCode ? 'Change Coupon' : 'Select Coupon') + '</button></div>';
    } else if (aiResult && !sec.finalContent) {
      html += '<div class="nl-ai-compare">' +
        '<div class="nl-ai-panel original"><div class="nl-ai-panel-label">Your Original</div>' + nlEscHtml(sec.rawInput) + '</div>' +
        '<div class="nl-ai-panel polished"><div class="nl-ai-panel-label">AI Polished</div>' + nlEscHtml(aiResult) + '</div></div>' +
        '<div class="nl-ai-actions" style="margin-top:8px;">' +
        '<button class="btn btn-outline" onclick="nlPickVersion(\'' + secId + '\',\'original\'); setTimeout(function(){nlOpenCardEditor(\'' + secId + '\')},100);">Use Original</button>' +
        '<button class="btn btn-primary" onclick="nlPickVersion(\'' + secId + '\',\'ai\'); setTimeout(function(){nlOpenCardEditor(\'' + secId + '\')},100);">Use AI Version</button></div>';
    } else if (sec.finalContent) {
      html += '<textarea class="nl-section-textarea" id="nlModalFinal_' + secId + '"' +
        ' maxlength="' + charLimit + '" style="min-height:120px;"' +
        ' oninput="nlEditorCharCount(\'' + secId + '\', this.value, ' + charLimit + ')"' +
        ' onchange="nlUpdateFinalContent(\'' + secId + '\', this.value)">' +
        nlEscHtml(sec.finalContent) + '</textarea>' +
        '<div class="nl-editor-char-counter" id="nlCharCounter_' + secId + '">' + charCount + '/' + charLimit + '</div>' +
        '<div style="margin-top:8px;"><button class="btn btn-outline" style="font-size:0.8rem;" onclick="nlResetSection(\'' + secId + '\'); setTimeout(function(){nlOpenCardEditor(\'' + secId + '\')},100);">Reset to Draft</button></div>';
    } else {
      html += '<textarea class="nl-section-textarea" id="nlModalRaw_' + secId + '"' +
        ' placeholder="Write your content here..." maxlength="' + charLimit + '" style="min-height:120px;"' +
        ' oninput="nlEditorCharCount(\'' + secId + '\', this.value, ' + charLimit + ')"' +
        ' onchange="nlUpdateRawInput(\'' + secId + '\', this.value)">' +
        nlEscHtml(sec.rawInput || '') + '</textarea>' +
        '<div class="nl-editor-char-counter" id="nlCharCounter_' + secId + '">' + charCount + '/' + charLimit + '</div>';
      var hasContent = !!(sec.rawInput && sec.rawInput.trim());
      html += '<div style="margin-top:8px;display:flex;gap:8px;">' +
        '<button class="btn btn-outline" style="font-size:0.8rem;" ' + (hasContent ? '' : 'disabled') +
        ' onclick="nlPolishSection(\'' + secId + '\')">✨ Polish with AI</button>';
      if (hasContent) html += '<button class="btn btn-outline" style="font-size:0.8rem;" onclick="nlUseAsIs(\'' + secId + '\'); setTimeout(function(){nlOpenCardEditor(\'' + secId + '\')},100);">Use as-is</button>';
      html += '</div>';
    }

    // Images
    var images = sec.images || [];
    html += '<div style="margin-top:16px;"><div style="font-size:0.8rem;font-weight:600;margin-bottom:8px;">Images (max 3)</div>';
    html += '<div class="nl-section-images">';
    images.forEach(function(imgId, idx) {
      var img = imageLibrary ? imageLibrary[imgId] : null;
      if (img) html += '<div style="position:relative;"><img class="nl-section-img-thumb" src="' + img.url + '" alt="" />' +
        '<span style="position:absolute;top:-4px;right:-4px;cursor:pointer;background:var(--danger);color:#fff;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;" onclick="nlRemoveImage(\'' + secId + '\',' + idx + '); setTimeout(function(){nlOpenCardEditor(\'' + secId + '\')},100);">×</span></div>';
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
    counter.style.color = count >= limit ? '#dc3545' : count >= limit * 0.8 ? 'var(--amber)' : 'var(--text-secondary)';
  }

  function nlCloseCardEditor(secId) {
    if (secId && nlCurrentIssue && nlCurrentIssue.sections && nlCurrentIssue.sections[secId]) {
      var rawEl = document.getElementById('nlModalRaw_' + secId);
      var finalEl = document.getElementById('nlModalFinal_' + secId);
      if (rawEl && rawEl.value !== (nlCurrentIssue.sections[secId].rawInput || '')) {
        nlUpdateRawInput(secId, rawEl.value);
      } else if (finalEl && finalEl.value !== (nlCurrentIssue.sections[secId].finalContent || '')) {
        nlUpdateFinalContent(secId, finalEl.value);
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
      await MastDB._multiUpdate(fbUpdates);
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
    if (val.length > charLimit) {
      val = val.substring(0, charLimit);
      showToast('Content trimmed to ' + charLimit + ' char limit');
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
    if (val.length > charLimit) {
      val = val.substring(0, charLimit);
      showToast('Content trimmed to ' + charLimit + ' char limit');
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
    if (!sec.rawInput || !sec.rawInput.trim()) { showToast('Write some content first', true); return; }

    var btn = event.target;
    var origText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="nl-ai-loading">Polishing...</span>';

    try {
      var polishFn = firebase.functions().httpsCallable('socialAI');
      var result = await polishFn({ action: 'newsletterPolish', rawInput: sec.rawInput, sectionType: sec.type });
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
    var secId = MastDB._newRootKey();
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
      '<button class="btn btn-outline" onclick="nlCloseImagePicker()" style="font-size:0.8rem;">Close</button></div>' +
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
    return '<p style="font-size:15px;line-height:1.7;color:#444;margin:0;">' + content.replace(/\n/g, '<br>') + '</p>';
  }

  function nlExportHTML() {
    if (!nlCurrentIssue) return;
    if (!nlCurrentIssue.title || !nlCurrentIssue.title.trim()) { showToast('Add an issue title before exporting', true); return; }

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
      '<title>' + esc(_ec.brand.name) + ' — Issue #' + nlCurrentIssue.issueNumber + '</title></head>' +
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

    var blob = new Blob([emailHtml], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = ((TENANT_CONFIG && TENANT_CONFIG.brand.newsletterDownloadPrefix) || 'newsletter') + '-' + nlCurrentIssue.issueNumber + '-' + (nlCurrentIssue.slug || 'newsletter') + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('HTML email exported! 📥');
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

  // ===== MARK AS SENT =====
  async function nlMarkAsSent() {
    if (!nlCurrentIssue) return;
    var sentAt = new Date().toISOString();
    var activeSubs = nlSubscribers.filter(function(s) { return s.status === 'active'; }).length;

    try {
      nlCurrentIssue.status = 'sent';
      nlCurrentIssue.sentAt = sentAt;
      nlCurrentIssue.sentSubscriberCount = activeSubs;
      nlCurrentIssue.updatedAt = new Date().toISOString();
      await MastDB.newsletter.issues.ref(nlCurrentIssueId).update({
        status: 'sent', sentAt: sentAt, sentSubscriberCount: activeSubs, updatedAt: nlCurrentIssue.updatedAt
      });
      showToast('Marked as sent to ' + activeSubs + ' subscribers ✉️');
      renderNLCompose();
    } catch (err) { showToast('Error: ' + err.message, true); }
  }

  // ===== SUBSCRIBERS SCREEN =====
  function renderNLSubscribers() {
    nlCurrentView = 'subscribers';
    var showAll = window.nlShowAllSubs || false;
    var filtered = showAll ? nlSubscribers : nlSubscribers.filter(function(s) { return s.status === 'active'; });
    var activeCount = nlSubscribers.filter(function(s) { return s.status === 'active'; }).length;

    var html = '<div class="nl-sub-nav">' +
      '<button onclick="nlSwitchView(\'issues\')">Issues</button>' +
      '<button class="active" onclick="nlSwitchView(\'subscribers\')">Subscribers</button>' +
      '</div>' +
      '<div class="nl-header"><h2>Subscribers <span style="font-weight:400;font-size:0.9rem;color:var(--text-secondary);">(' + activeCount + ' active)</span></h2>' +
      '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-outline" onclick="nlExportSubscribersCSV()">📤 Export CSV</button>' +
      '<button class="btn btn-primary" onclick="nlAddSubscriber()">+ Add Subscriber</button>' +
      '</div></div>' +
      '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">' +
      '<label style="font-size:0.85rem;color:var(--text-secondary);display:flex;align-items:center;gap:6px;">' +
      '<input type="checkbox" ' + (showAll ? 'checked' : '') + ' onchange="window.nlShowAllSubs=this.checked; renderNLSubscribers();" /> Show unsubscribed</label></div>';

    if (filtered.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:2rem;margin-bottom:12px;">📬</div>' +
        '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No subscribers yet</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add subscribers manually or share the sign-up form on your website.</p></div>';
    } else {
      html += '<table class="nl-sub-table"><thead><tr>' +
        '<th>Name</th><th>Email</th><th>Source</th><th>Subscribed</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>';
      filtered.forEach(function(sub) {
        var dateStr = sub.subscribedAt ? new Date(sub.subscribedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        var sourceClass = sub.source === 'website-form' ? 'website' : 'manual';
        var sourceLabel = sub.source === 'website-form' ? 'Website' : 'Manual';
        html += '<tr>' +
          '<td>' + nlEscHtml(sub.name) + '</td>' +
          '<td>' + nlEscHtml(sub.email) + '</td>' +
          '<td><span class="nl-source-badge ' + sourceClass + '">' + sourceLabel + '</span></td>' +
          '<td>' + dateStr + '</td>' +
          '<td>' + (sub.status === 'active' ? '<span style="color:#5A7A5A;">Active</span>' : '<span style="color:var(--text-secondary);">Unsubscribed</span>') + '</td>' +
          '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + nlEscHtml(sub.notes || '') + '</td>' +
          '<td>';
        if (sub.status === 'active') {
          html += '<button class="btn btn-outline" style="font-size:0.7rem;padding:2px 6px;" onclick="nlUnsubscribe(\'' + sub.id + '\')">Remove</button>';
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
  window.nlUpdateSectionTitle = nlUpdateSectionTitle;
  window.nlToggleInclude = nlToggleInclude;
  window.nlUpdateRawInput = nlUpdateRawInput;
  window.nlUpdateFinalContent = nlUpdateFinalContent;
  window.nlUseAsIs = nlUseAsIs;
  window.nlPolishSection = nlPolishSection;
  window.nlPickVersion = nlPickVersion;
  window.nlResetSection = nlResetSection;
  window.nlAddSection = nlAddSection;
  window.nlOpenImagePicker = nlOpenImagePicker;
  window.nlCloseImagePicker = nlCloseImagePicker;
  window.nlSelectImage = nlSelectImage;
  window.nlRemoveImage = nlRemoveImage;
  window.nlExportHTML = nlExportHTML;
  window.nlPublishToWebsite = nlPublishToWebsite;
  window.nlMarkAsSent = nlMarkAsSent;
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
