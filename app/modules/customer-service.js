/**
 * Customer Service Module — Session D
 *
 * Covers cs-inbox and cs-tickets admin routes.
 * Session E will handle cs-surveys, cs-reviews, cs-faqs.
 *
 * Renders entirely from JS into the empty CS tab containers
 * (csInboxTab, csTicketsTab). No HTML skeleton in index.html.
 *
 * Data via MastDB — all reads use limitToLast(N) or .once().
 * No unbounded listeners.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  // Members section state
  var membersSubTab = 'at-risk';   // 'at-risk' | 'all-active'
  var membersAtRiskData = null;    // null = not loaded, [] = loaded
  var membersActiveData = null;
  var membersLoading = false;

  var ticketsData = [];
  var ticketsLoaded = false;
  var loadInFlight = false;

  var activeRoute = null;      // 'cs-inbox' | 'cs-tickets'
  var viewMode = 'list';       // 'list' | 'thread' | 'create'
  var selectedTicketId = null;
  var threadMessages = [];
  var sendInFlight = false;

  // Inbox sub-tab filter
  var inboxSubTab = 'all';     // 'all' | 'open' | 'in_progress'

  // Tickets filter bar
  var statusFilter = 'all';
  var priorityFilter = 'all';

  // Reply compose state
  var isInternalNote = false;

  // ============================================================
  // Helpers
  // ============================================================

  function _esc(s) {
    return (window.esc
      ? window.esc(s)
      : String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  }

  function relativeTime(iso) {
    if (!iso) return '—';
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '—';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    if (d < 30) return d + 'd ago';
    var mo = Math.floor(d / 30);
    if (mo < 12) return mo + 'mo ago';
    return Math.floor(mo / 12) + 'y ago';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return MastFormat.date(iso) || '—';
  }

  // Ticket-status label map — feeds the status filter/select dropdowns and the
  // "Status updated" toast. The status BADGE colors now live in the canonical
  // MastUI.statusBadge(status, 'ticket') registry (Track 5; shared/mast-ui.js),
  // captured verbatim from the former STATUS_STYLES map.
  var STATUS_LABELS = {
    open: 'Open', in_progress: 'In Progress', waiting: 'Waiting',
    resolved: 'Resolved', closed: 'Closed'
  };

  var PRIORITY_STYLES = {
    low:    { bg: 'rgba(80,80,80,0.15)',  color: '#9E9E9E', border: 'rgba(80,80,80,0.25)' },
    normal: { bg: 'rgba(30,64,175,0.15)', color: '#90CAF9', border: 'rgba(30,64,175,0.25)' },
    high:   { bg: 'rgba(146,64,14,0.2)',  color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    urgent: { bg: 'rgba(185,28,28,0.2)',  color: '#F48FB1', border: 'rgba(185,28,28,0.35)' }
  };
  var PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
  // Build 8 — root-cause category list. Mirrors server-side
  // TICKET_CATEGORIES in mast-tenant-mcp-server. Display labels stay
  // here; the persisted value matches the server enum.
  var CS_TICKET_CATEGORIES = [
    { value: 'shipping',         label: 'Shipping' },
    { value: 'product-defect',   label: 'Product defect' },
    { value: 'billing',          label: 'Billing' },
    { value: 'general-question', label: 'General question' },
    { value: 'custom-order',     label: 'Custom order' },
    { value: 'returns',          label: 'Returns' },
    { value: 'feedback',         label: 'Feedback' },
    { value: 'other',            label: 'Other' }
  ];
  function csCategoryLabel(value) {
    var found = CS_TICKET_CATEGORIES.find(function(c) { return c.value === value; });
    return found ? found.label : value;
  }

  var SOURCE_ICONS = { email: '✉', web: '🌐', phone: '☎', chat: '💬', manual: '✏' };

  function priorityBadge(priority) {
    var s = PRIORITY_STYLES[priority] || PRIORITY_STYLES.normal;
    return '<span class="status-badge" style="background:' + s.bg + ';color:' + s.color +
      ';border:1px solid ' + s.border + ';">' + _esc(PRIORITY_LABELS[priority] || priority || '—') + '</span>';
  }

  function sourceIcon(source) {
    return SOURCE_ICONS[source] || '📋';
  }

  function tabEl() {
    var id = activeRoute === 'cs-inbox' ? 'csInboxTab' : 'csTicketsTab';
    return document.getElementById(id);
  }

  // ============================================================
  // Data loading
  // ============================================================

  async function loadTickets() {
    if (loadInFlight) return;
    loadInFlight = true;
    try {
      var snap = await MastDB.query('cs_tickets').limitToLast(50).once();
      ticketsData = snap ? Object.values(snap) : [];
      ticketsData.sort(function(a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      ticketsLoaded = true;
    } catch (err) {
      console.error('[cs] loadTickets:', err);
      if (typeof showToast === 'function') showToast('Failed to load tickets.', true);
    } finally {
      loadInFlight = false;
    }
  }

  // ============================================================
  // Render dispatch
  // ============================================================

  function renderCurrentView() {
    var tab = tabEl();
    if (!tab) return;

    if (viewMode === 'thread') {
      tab.innerHTML = renderThread();
      // Scroll message list to bottom
      requestAnimationFrame(function() {
        var el = document.getElementById('csThreadMessages');
        if (el) el.scrollTop = el.scrollHeight;
      });
    } else if (viewMode === 'create') {
      tab.innerHTML = renderCreate();
    } else {
      tab.innerHTML = renderList();
      // Q6: dynamic filter-pill bars need a re-init after innerHTML swap.
      if (window.mastInitFilterPills) window.mastInitFilterPills(tab);
    }
  }

  // ============================================================
  // List view
  // ============================================================

  function filterTickets() {
    var isInbox = activeRoute === 'cs-inbox';
    return ticketsData.filter(function(t) {
      if (isInbox) {
        if (t.status === 'closed' || t.status === 'resolved') return false;
        if (inboxSubTab === 'open' && t.status !== 'open') return false;
        if (inboxSubTab === 'in_progress' && t.status !== 'in_progress') return false;
      } else {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      }
      return true;
    });
  }

  function renderList() {
    var isInbox = activeRoute === 'cs-inbox';
    var filtered = filterTickets();

    var html = '<div style="padding:20px 24px 0;">';

    // Header
    html += '<div class="section-header" style="margin-bottom:12px;">';
    html += '<h2 style="margin:0;">' + (isInbox ? 'Inbox' : 'Tickets') + '</h2>';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span style="font-size:0.85rem;color:var(--warm-gray);">' +
      MastFormat.countNoun(filtered.length, 'ticket') + '</span>';
    html += '<button class="btn btn-secondary btn-small" onclick="csRefreshTickets()">Refresh</button>';
    html += '<button class="btn btn-primary btn-small" onclick="csOpenCreate()">New Ticket</button>';
    html += '</div>';
    html += '</div>';

    if (isInbox) {
      html += renderInboxSubTabs();
    } else {
      html += renderFilterBar();
    }

    html += '</div>';

    if (filtered.length === 0 && ticketsData.length === 0) {
      html += '<div style="padding:60px 24px;text-align:center;color:var(--warm-gray);font-size:0.9rem;">No tickets yet. Create one to get started.</div>';
    } else if (filtered.length === 0) {
      html += '<div style="padding:40px 24px;text-align:center;color:var(--warm-gray);font-size:0.9rem;">No tickets match the current filter.</div>';
    } else {
      html += '<div style="padding:0 24px 24px;">';
      html += '<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">';
      filtered.forEach(function(t) {
        html += renderTicketRow(t);
      });
      html += '</div>';
      html += '</div>';
    }

    return html;
  }

  function renderInboxSubTabs() {
    var tabs = [{ key: 'all', label: 'All' }, { key: 'open', label: 'Open' }, { key: 'in_progress', label: 'In Progress' }];
    var html = '<div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:4px;">';
    tabs.forEach(function(t) {
      var active = inboxSubTab === t.key;
      html += '<button onclick="csSetInboxTab(\'' + t.key + '\')" style="' +
        'padding:8px 16px;font-size:0.85rem;font-weight:' + (active ? '600' : '400') + ';' +
        'color:' + (active ? 'var(--primary)' : 'var(--warm-gray)') + ';' +
        'background:none;border:none;border-bottom:2px solid ' + (active ? 'var(--primary)' : 'transparent') + ';' +
        'cursor:pointer;outline:none;">' + t.label + '</button>';
    });
    html += '</div>';
    return html;
  }

  function renderFilterBar() {
    var statuses = ['all', 'open', 'in_progress', 'waiting', 'resolved', 'closed'];
    var priorities = ['all', 'low', 'normal', 'high', 'urgent'];
    var selStyle = 'font-size:0.85rem;padding:4px 8px;background:var(--surface-card);border:1px solid var(--border);border-radius:4px;color:var(--text);';

    var html = '<div style="display:flex;gap:10px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">';

    // Q6 sweep: pills via mastFilterPills helper. Hidden <select> retains
    // state so existing csSetStatusFilter(this.value) keeps working when
    // the pill click dispatches a change event.
    html += '<label style="font-size:0.85rem;color:var(--warm-gray);">Status</label>';
    html += '<div class="order-filter-pills" data-filter-for="csStatusFilter" style="margin:0;"></div>';
    html += '<select id="csStatusFilter" onchange="csSetStatusFilter(this.value)" style="display:none;">';
    statuses.forEach(function(s) {
      html += '<option value="' + s + '"' + (statusFilter === s ? ' selected' : '') + '>' +
        _esc(s === 'all' ? 'All Statuses' : (STATUS_LABELS[s] || s)) + '</option>';
    });
    html += '</select>';

    html += '<label style="font-size:0.85rem;color:var(--warm-gray);">Priority</label>';
    html += '<div class="order-filter-pills" data-filter-for="csPriorityFilter" style="margin:0;"></div>';
    html += '<select id="csPriorityFilter" onchange="csSetPriorityFilter(this.value)" style="display:none;">';
    priorities.forEach(function(p) {
      html += '<option value="' + p + '"' + (priorityFilter === p ? ' selected' : '') + '>' +
        _esc(p === 'all' ? 'All Priorities' : (PRIORITY_LABELS[p] || p)) + '</option>';
    });
    html += '</select>';

    html += '</div>';
    return html;
  }

  function renderTicketRow(t) {
    var num = t.ticketNumber ? _esc(t.ticketNumber) : ('#' + _esc(String(t.id).slice(-6)));
    var contactLine = '';
    if (t.contactName && t.contactEmail) {
      contactLine = _esc(t.contactName) + ' &lt;' + _esc(t.contactEmail) + '&gt;';
    } else {
      contactLine = _esc(t.contactName || t.contactEmail || '—');
    }

    return '<div onclick="csOpenThread(\'' + _esc(t.id) + '\')" style="' +
      'display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;' +
      'border:1px solid var(--border);border-radius:6px;background:var(--surface-card);' +
      'transition:opacity 0.1s;" ' +
      'onmouseover="this.style.opacity=\'0.85\'" onmouseout="this.style.opacity=\'1\'">' +

      // Ticket number
      '<span style="font-size:0.78rem;color:var(--warm-gray);min-width:58px;font-family:monospace;">' + num + '</span>' +

      // Source icon
      '<span style="font-size:0.9rem;min-width:18px;text-align:center;">' + sourceIcon(t.source) + '</span>' +

      // Subject + contact
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          _esc(t.subject || 'No subject') + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          contactLine + '</div>' +
      '</div>' +

      // Badges
      '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">' +
        MastUI.statusBadge(t.status, 'ticket') +
        priorityBadge(t.priority) +
        // Build 8 — category chip when present
        (t.category ? '<span style="font-size:0.72rem;padding:2px 8px;border-radius:10px;background:rgba(99,102,241,0.20);color:#a5a8f5;">' + _esc(csCategoryLabel(t.category)) + '</span>' : '') +
      '</div>' +

      // Time
      '<span style="font-size:0.78rem;color:var(--warm-gray);min-width:68px;text-align:right;flex-shrink:0;">' +
        relativeTime(t.updatedAt || t.createdAt) + '</span>' +

    '</div>';
  }

  // ============================================================
  // Thread view
  // ============================================================

  function renderThread() {
    var ticket = ticketsData.find(function(t) { return t.id === selectedTicketId; }) || {};
    var num = ticket.ticketNumber || ('#' + String(selectedTicketId || '').slice(-6));

    var statusOpts = Object.keys(STATUS_LABELS).map(function(s) {
      return '<option value="' + s + '"' + (ticket.status === s ? ' selected' : '') + '>' + STATUS_LABELS[s] + '</option>';
    }).join('');
    var priorityOpts = Object.keys(PRIORITY_LABELS).map(function(p) {
      return '<option value="' + p + '"' + (ticket.priority === p ? ' selected' : '') + '>' + PRIORITY_LABELS[p] + '</option>';
    }).join('');
    // Build 8 — root-cause category dropdown. Matches server-side
    // TICKET_CATEGORIES in mast-tenant-mcp-server/src/shared/tools/
    // customer-service.ts. Both must stay in sync.
    var categoryOpts = '<option value=""' + (!ticket.category ? ' selected' : '') + '>— Uncategorized —</option>';
    CS_TICKET_CATEGORIES.forEach(function(c) {
      categoryOpts += '<option value="' + c.value + '"' + (ticket.category === c.value ? ' selected' : '') + '>' + c.label + '</option>';
    });

    var selStyle = 'font-size:0.85rem;padding:4px 8px;background:var(--surface-card);border:1px solid var(--border);border-radius:4px;color:var(--text);';

    var html = '<div style="display:flex;flex-direction:column;height:100%;">';

    // Header
    html += '<div style="padding:16px 24px 12px;border-bottom:1px solid var(--border);">';
    html += '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
    html += '<button class="detail-back" onclick="csBackToList()" style="white-space:nowrap;">← Back to Tickets</button>';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="font-weight:600;font-size:1rem;">' +
      _esc(num) + ' — ' + _esc(ticket.subject || 'No subject') + '</div>';
    // Build 5b.2 — when the ticket carries customerId (post-backfill),
    // render the customer name/email as a drill-in to the customer detail.
    // Pre-backfill tickets still render plain text. Drill-in goes through
    // MastNavStack so back-nav returns to the ticket.
    var fromLabel = _esc(ticket.contactName || ticket.contactEmail || 'Unknown') +
      (ticket.contactEmail && ticket.contactName ? ' (' + _esc(ticket.contactEmail) + ')' : '');
    var fromCell = ticket.customerId
      ? '<a href="#" data-customer-id="' + _esc(ticket.customerId) +
        '" onclick="event.preventDefault();csOpenLinkedCustomer(this.dataset.customerId);" ' +
        'style="color:var(--teal);text-decoration:underline;">' + fromLabel + '</a>'
      : fromLabel;
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">from ' +
      fromCell +
      ' · ' + fmtDate(ticket.createdAt) + '</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0;flex-wrap:wrap;">';
    html += '<select onchange="csUpdateStatus(this.value)" style="' + selStyle + '">' + statusOpts + '</select>';
    html += '<select onchange="csUpdatePriority(this.value)" style="' + selStyle + '">' + priorityOpts + '</select>';
    html += '<select onchange="csUpdateCategory(this.value)" style="' + selStyle + '" title="Root-cause category">' + categoryOpts + '</select>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // Message thread
    html += '<div id="csThreadMessages" style="flex:1;overflow-y:auto;padding:16px 24px;display:flex;flex-direction:column;gap:10px;">';
    if (threadMessages.length === 0) {
      html += '<div style="color:var(--warm-gray);font-size:0.85rem;text-align:center;padding:32px 0;">No messages yet.</div>';
    } else {
      threadMessages.forEach(function(msg) {
        html += renderMessageBubble(msg);
      });
    }
    html += '</div>';

    // Reply form
    html += '<div style="padding:12px 24px 20px;border-top:1px solid var(--border);">';
    html += '<div style="border:1px solid var(--border);border-radius:8px;background:var(--surface-card);overflow:hidden;">';
    html += '<textarea id="csReplyBody" rows="3" placeholder="' +
      (isInternalNote ? 'Write an internal note…' : 'Write a reply…') +
      '" style="width:100%;padding:10px 14px;background:transparent;border:none;color:var(--text);' +
      'font-size:0.85rem;resize:vertical;outline:none;box-sizing:border-box;' +
      (isInternalNote ? 'border-left:3px solid rgba(91,33,182,0.5);' : '') + '"></textarea>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-top:1px solid var(--border);">';
    html += '<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--warm-gray);cursor:pointer;">' +
      '<input type="checkbox" id="csInternalToggle" onchange="csToggleInternal(this.checked)"' +
      (isInternalNote ? ' checked' : '') + '> Internal Note</label>';
    html += '<button class="btn btn-primary btn-small" id="csReplyBtn" onclick="csSendReply()">Send Reply</button>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderMessageBubble(msg) {
    var isOutbound = msg.direction === 'outbound';
    var isInternal = !!msg.isInternal;

    var wrapStyle, bubbleStyle;
    if (isInternal) {
      wrapStyle = 'align-self:center;width:88%;';
      bubbleStyle = 'background:rgba(91,33,182,0.12);border:1px solid rgba(91,33,182,0.3);' +
        'border-radius:8px;padding:10px 14px;';
    } else if (isOutbound) {
      wrapStyle = 'align-self:flex-end;max-width:74%;';
      bubbleStyle = 'background:rgba(30,64,175,0.18);border:1px solid rgba(30,64,175,0.3);' +
        'border-radius:8px 0 8px 8px;padding:10px 14px;';
    } else {
      wrapStyle = 'align-self:flex-start;max-width:74%;';
      bubbleStyle = 'background:var(--surface-card);border:1px solid var(--border);' +
        'border-radius:0 8px 8px 8px;padding:10px 14px;';
    }

    var html = '<div style="' + wrapStyle + '">';
    if (isInternal) {
      html += '<div style="font-size:0.72rem;color:var(--warm-gray);text-align:center;' +
        'margin-bottom:4px;font-style:italic;">— Internal Note —</div>';
    }
    html += '<div style="' + bubbleStyle + '">';
    html += '<div style="white-space:pre-wrap;font-size:0.85rem;word-break:break-word;">' +
      _esc(msg.body || '') + '</div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">';
    html += '<span style="font-size:0.72rem;color:var(--warm-gray);">' +
      _esc(msg.authorName || msg.authorEmail || (isOutbound ? 'You' : 'Customer')) + '</span>';
    html += '<span style="font-size:0.72rem;color:var(--warm-gray);">' + relativeTime(msg.createdAt) + '</span>';
    html += '</div>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  // ============================================================
  // Create form
  // ============================================================

  function renderCreate() {
    var selStyle = 'width:100%;padding:8px 10px;background:var(--surface-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;';
    var sourceOpts = ['email', 'web', 'phone', 'chat', 'manual'].map(function(s) {
      return '<option value="' + s + '">' + _esc(s.charAt(0).toUpperCase() + s.slice(1)) + '</option>';
    }).join('');
    var priorityOpts = Object.keys(PRIORITY_LABELS).map(function(p) {
      return '<option value="' + p + '"' + (p === 'normal' ? ' selected' : '') + '>' + PRIORITY_LABELS[p] + '</option>';
    }).join('');

    var html = '<div style="padding:20px 24px;">';
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">';
    html += '<button class="detail-back" onclick="csBackToList()">← Back to Tickets</button>';
    html += '<h2 style="margin:0;">New Ticket</h2>';
    html += '</div>';

    html += '<div style="max-width:580px;">';

    html += '<div class="form-group"><label class="field-required">Subject</label>' +
      '<input type="text" id="csCreateSubject" placeholder="Brief description of the issue" style="width:100%;box-sizing:border-box;"></div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    html += '<div class="form-group"><label class="field-required">Contact Email</label>' +
      '<input type="email" id="csCreateEmail" placeholder="customer@example.com" style="width:100%;box-sizing:border-box;"></div>';
    html += '<div class="form-group"><label>Contact Name</label>' +
      '<input type="text" id="csCreateName" placeholder="First Last" style="width:100%;box-sizing:border-box;"></div>';
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    html += '<div class="form-group"><label>Source</label>' +
      '<select id="csCreateSource" style="' + selStyle + '">' + sourceOpts + '</select></div>';
    html += '<div class="form-group"><label>Priority</label>' +
      '<select id="csCreatePriority" style="' + selStyle + '">' + priorityOpts + '</select></div>';
    html += '</div>';

    html += '<div class="form-group"><label>First Message <span style="color:var(--warm-gray);font-weight:400;">(optional)</span></label>' +
      '<textarea id="csCreateMessage" rows="4" placeholder="Describe the issue..." style="width:100%;box-sizing:border-box;"></textarea></div>';

    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">';
    html += '<button class="btn btn-secondary" onclick="csBackToList()">Cancel</button>';
    html += '<button class="btn btn-primary" id="csCreateBtn" onclick="csSubmitCreate()">Create Ticket</button>';
    html += '</div>';

    html += '</div>';
    html += '</div>';
    return html;
  }

  // ============================================================
  // Session E — Reviews, Surveys, FAQs
  // ============================================================

  var reviewsData = {};
  var reviewsLoaded = false;
  var reviewsFilter = 'pending';
  // D1 — reviews settings (anonymous policy). Defaults match the CF gate:
  // anonymous reviews are blocked unless the operator flips this on. requireApproval
  // is captured for future auto-publish support but stays true today (no toggle).
  var reviewsConfig = { anonymousAllowed: false, requireApproval: true };
  var reviewsConfigLoaded = false;
  // D1 — which review is in respond-edit mode + the draft text.
  var reviewsRespondingId = null;
  var reviewsRespondDraft = '';

  var surveysSubTab = 'questions';
  var questionsData = {};
  var groupsData = {};
  var surveysDefData = {};
  var triggersData = {};
  var surveysLoaded = false;
  // Build 7-Responses
  var responsesData = {};
  var responsesLoaded = false;
  var responsesFilter = { surveyId: 'all', status: 'all', theme: 'all' };
  var responsesEditingThemeId = null;
  var questionEditId = null;
  var showAddQuestion = false;
  var groupEditId = null;
  var showAddGroup = false;
  var surveyEditId = null;
  var showAddSurvey = false;
  var sendLinkSurveyId = null;
  // Build 7-BulkSend
  var sendMode = 'one';                    // 'one' | 'segment'
  var sendSegmentId = null;                // selected segment id
  var sendSegmentsLoaded = false;
  var sendSegmentsData = {};               // saved segments from admin/customerSegments
  var sendWholesaleResolver = null;        // (customer)=>bool for wholesale/retail segment keys (D4-005)
  var sendSegmentMembersCount = null;      // live preview count
  var sendInProgress = false;
  var sendProgress = null;                 // { total, sent, failed, currentEmail }
  var triggerEditId = null;
  var showAddTrigger = false;

  var automatedSurveysEnabled = false;
  var automatedSurveysToggling = false;

  var policiesData = {};
  var policiesLoaded = false;
  var policyEditId = null;
  var showAddPolicy = false;

  function nowIso() { return new Date().toISOString(); }

  function starsHtml(n) {
    var out = '';
    for (var i = 1; i <= 5; i++) out += (i <= (n || 0) ? '★' : '☆');
    return out;
  }

  function genTokenSecret() {
    var arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function reviewBadge(s) {
    var bg = s === 'approved' ? 'rgba(42,124,111,0.20)' : (s === 'rejected' ? 'rgba(220,38,38,0.20)' : 'rgba(196,133,60,0.25)');
    var color = s === 'approved' ? 'var(--teal)' : (s === 'rejected' ? 'var(--danger)' : 'var(--amber-light)');
    return '<span style="background:' + bg + ';color:' + color + ';padding:2px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;">' + _esc(s || 'pending') + '</span>';
  }

  function surveyBadge(s) {
    var bg = s === 'active' ? 'rgba(42,124,111,0.20)' : (s === 'inactive' ? 'rgba(220,38,38,0.15)' : 'rgba(0,0,0,0.10)');
    var color = s === 'active' ? 'var(--teal)' : (s === 'inactive' ? 'var(--danger)' : 'var(--text)');
    return '<span style="background:' + bg + ';color:' + color + ';padding:2px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;">' + _esc(s || 'draft') + '</span>';
  }

  function kpiCard(label, val, sub) {
    return '<div style="flex:1;min-width:120px;padding:12px 16px;border:1px solid var(--cream-dark);border-radius:10px;background:var(--surface-card);">' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:4px;">' + label + '</div>' +
      '<div style="font-size:1.6rem;font-weight:700;font-family:monospace;color:var(--text);">' + val + '</div>' +
      (sub ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + sub + '</div>' : '') +
    '</div>';
  }

  // W1.7 — caches for review→customer and review→product resolution.
  var csReviewProductIndex = {};   // productId -> { name, thumbnailUrl }
  var csReviewCustomerByEmail = {}; // emailLower -> { id, displayName, stats }

  // True for a Firebase push-id (e.g. "-Ooa73tvVja…"). Used so we never paint a
  // raw id where a human-readable product name belongs.
  function csIsRawId(s) { return typeof s === 'string' && /^-[A-Za-z0-9_-]{15,}$/.test(s); }

  // Best human label for a review's product: snapshotted productName → product
  // index name → "(product)" when only a raw push-id remains. Never leaks an id.
  function csReviewProductLabel(r) {
    var prodInfo = r && r.productId ? csReviewProductIndex[r.productId] : null;
    var label = (r && r.productName) || (prodInfo && prodInfo.name) || '';
    if (!label || csIsRawId(label)) return '(product)';
    return label;
  }

  // Response audit history grouped by reviewId. Populated alongside reviewsData.
  var reviewResponseHistoryByReview = {}; // reviewId → [{revId, action, body, prevBody, authorName, createdAt}, ...] (chronological)
  var reviewHistoryExpanded = {}; // reviewId → boolean (UI state for expanded audit-log view)

  function loadReviews() {
    var reviewsP = MastDB.query('cs_reviews').limitToLast(100).once()
      .then(function (d) { reviewsData = d || {}; reviewsLoaded = true; })
      .catch(function (err) { console.warn('[cs-reviews]', err && err.message); if (typeof showToast === 'function') showToast('Failed to load reviews', true); });
    // Append-only audit log for response edits/deletes. Always loaded — small
    // collection (one row per response transition, not per review).
    var historyP = MastDB.query('cs_review_responses').limitToLast(500).once()
      .then(function (d) {
        reviewResponseHistoryByReview = {};
        Object.keys(d || {}).forEach(function (revId) {
          var row = d[revId]; if (!row || !row.reviewId) return;
          (reviewResponseHistoryByReview[row.reviewId] = reviewResponseHistoryByReview[row.reviewId] || [])
            .push(Object.assign({ revId: revId }, row));
        });
        // Chronological order per review (oldest first).
        Object.keys(reviewResponseHistoryByReview).forEach(function (rid) {
          reviewResponseHistoryByReview[rid].sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1; });
        });
      })
      .catch(function () { reviewResponseHistoryByReview = {}; });
    // D1 — load the reviews policy doc. Absent doc → defaults (anon blocked).
    var cfgP = MastDB.get('cs_config/reviews').then(function (d) {
      reviewsConfig = {
        anonymousAllowed: !!(d && d.anonymousAllowed),
        requireApproval: d && typeof d.requireApproval === 'boolean' ? d.requireApproval : true
      };
      reviewsConfigLoaded = true;
    }).catch(function () { reviewsConfigLoaded = true; });
    // Best-effort prefetch of customer + product indexes for resolution. Failures are non-fatal.
    var custP = MastDB.get('admin/customers').then(function(cMap) {
      cMap = cMap || {};
      Object.keys(cMap).forEach(function(cid) {
        var c = cMap[cid]; if (!c) return;
        var emails = [];
        if (c.primaryEmail) emails.push(c.primaryEmail);
        (c.emails || []).forEach(function(e) {
          if (e && typeof e === 'string') emails.push(e);
          else if (e && e.address) emails.push(e.address);
        });
        emails.forEach(function(e) {
          var key = String(e).toLowerCase().trim();
          if (key) csReviewCustomerByEmail[key] = {
            id: c.id || cid,
            displayName: c.displayName || c.primaryEmail || key,
            stats: c.stats || {}
          };
        });
      });
    }).catch(function() {});
    var prodP = ((MastDB.products && MastDB.products.get) ?
      MastDB.products.get().then(function(s) { return (s && s.val && s.val()) || (s || {}); }) :
      Promise.resolve({})
    ).then(function(pMap) {
      pMap = pMap || {};
      Object.keys(pMap).forEach(function(pid) {
        var p = pMap[pid]; if (!p) return;
        csReviewProductIndex[pid] = {
          name: p.name || p.title || pid,
          thumbnailUrl: p.thumbnailUrl || p.imageUrl || (Array.isArray(p.images) && p.images[0] && (p.images[0].url || p.images[0])) || ''
        };
      });
    }).catch(function() {});
    return Promise.all([reviewsP, historyP, cfgP, custP, prodP]).then(function() {});
  }

  function loadSurveysAll() {
    return Promise.all([
      MastDB.query('cs_survey_questions').limitToLast(200).once().then(function (d) { questionsData = d || {}; }),
      MastDB.query('cs_survey_groups').limitToLast(100).once().then(function (d) { groupsData = d || {}; }),
      MastDB.query('cs_surveys').limitToLast(100).once().then(function (d) {
        var cleaned = {};
        Object.keys(d || {}).forEach(function (k) { var s = Object.assign({}, d[k]); delete s.tokenSecret; cleaned[k] = s; });
        surveysDefData = cleaned;
      }),
      MastDB.query('cs_survey_triggers').limitToLast(100).once().then(function (d) { triggersData = d || {}; }),
      MastDB.get('cs_config/automatedSurveys').then(function (d) { automatedSurveysEnabled = !!(d && d.enabled); }).catch(function () { automatedSurveysEnabled = false; })
    ])
    .then(function () { surveysLoaded = true; })
    .catch(function (err) { console.warn('[cs-surveys]', err && err.message); if (typeof showToast === 'function') showToast('Failed to load survey data', true); });
  }

  function loadPolicies() {
    return MastDB.query('cs_policies').limitToLast(50).once()
      .then(function (d) { policiesData = d || {}; policiesLoaded = true; })
      .catch(function (err) { console.warn('[cs-faqs]', err && err.message); if (typeof showToast === 'function') showToast('Failed to load policies', true); });
  }

  function renderReviews() {
    var tab = document.getElementById('csReviewsTab');
    if (!tab) return;
    if (!reviewsLoaded) { tab.innerHTML = '<div style="padding:40px;text-align:center;color:var(--warm-gray);">Loading reviews…</div>'; return; }
    var all = Object.values(reviewsData);
    var filtered = reviewsFilter === 'all' ? all.slice() : all.filter(function (r) { return r.status === reviewsFilter; });
    filtered.sort(function (a, b) { return (b.createdAt || '') > (a.createdAt || '') ? 1 : -1; });
    var pending = all.filter(function (r) { return r.status === 'pending'; }).length;
    var approved = all.filter(function (r) { return r.status === 'approved'; }).length;
    var ratedList = all.filter(function (r) { return r.rating; });
    var avgRating = ratedList.length ? (ratedList.reduce(function (s, r) { return s + (r.rating || 0); }, 0) / ratedList.length) : 0;
    var html = '<div style="padding:24px;">';
    var askAi = (window.MastAskAi && window.MastAskAi.isEnabled())
      ? '<button class="btn btn-secondary btn-small" onclick="MastAskAi.open(\'cs-reviews\')" title="Ask Claude about your reviews">✨ Ask AI</button>'
      : '';
    html += '<div class="section-header" style="margin-bottom:14px;"><h2 style="margin:0;">Reviews</h2><div style="display:flex;gap:8px;">' + askAi + '<button class="btn btn-secondary btn-small" onclick="csReviewsRefresh()">Refresh</button></div></div>';
    // D1 — settings card: anonymous-review policy toggle. Default off (sign-in required).
    var anonOn = !!reviewsConfig.anonymousAllowed;
    html += '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:14px 16px;background:var(--surface-card);margin-bottom:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">';
    html += '<div style="flex:1;min-width:220px;"><div style="font-weight:600;margin-bottom:2px;">Allow anonymous reviews</div>';
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);">When off, the storefront review form requires sign-in. Signed-in reviewers who have actually bought the product are marked <strong>Verified buyer</strong>.</div></div>';
    html += '<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="csReviewsAnonToggle"' + (anonOn ? ' checked' : '') + ' onchange="csReviewsSetAnonymousAllowed(this.checked)" /> <span style="font-size:0.85rem;">' + (anonOn ? 'Allowed' : 'Sign-in required') + '</span></label>';
    html += '</div>';
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;">';
    html += kpiCard('Pending', String(pending), 'awaiting review');
    html += kpiCard('Approved', String(approved), 'live on site');
    html += kpiCard('Avg Rating', ratedList.length ? avgRating.toFixed(1) + ' ★' : '—', ratedList.length + ' rated');
    html += kpiCard('Total', String(all.length), 'all statuses');
    html += '</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:16px;">';
    ['pending', 'approved', 'rejected', 'all'].forEach(function (f) {
      html += '<button class="view-tab' + (reviewsFilter === f ? ' active' : '') + '" onclick="csReviewsSetFilter(\'' + f + '\')">' + f + '</button>';
    });
    html += '</div>';
    if (!filtered.length) {
      html += '<div style="padding:32px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No ' + _esc(reviewsFilter) + ' reviews.</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:10px;">';
      filtered.forEach(function (r) {
        // W1.7 — resolve customer + product info (only if review has a real email; truly
        // anonymous reviews are NOT cross-referenced for privacy).
        // W1.7 fix-up #2 — review docs from submitReview CF use authorEmail/authorName;
        // legacy paths used reviewerEmail/reviewerName. Read both shapes.
        var reviewEmail = r.authorEmail || r.reviewerEmail || '';
        var emailKey = reviewEmail ? String(reviewEmail).toLowerCase().trim() : '';
        var matchedCustomer = emailKey ? csReviewCustomerByEmail[emailKey] : null;
        var prodInfo = r.productId ? csReviewProductIndex[r.productId] : null;
        var displayName = matchedCustomer ? matchedCustomer.displayName : (r.authorName || r.reviewerName || 'Anonymous');

        html += '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card);">';
        html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">';
        html += '<span style="font-weight:600;">' + _esc(displayName) + '</span>';
        // W1.7 fix-up — surface customer enrichment only when a real
        // customer match exists. Anonymous reviews stay anonymous (no badge).
        if (matchedCustomer && matchedCustomer.stats) {
          var st = matchedCustomer.stats;
          var oc = st.orderCount || 0;
          if (oc > 0) {
            html += '<span class="status-badge pill" title="Linked customer" style="background:rgba(42,124,111,0.15);color:var(--teal);font-size:0.72rem;">' +
              oc + (oc === 1 ? ' order' : ' orders') +
            '</span>';
          }
          if (st.lastOrderAt) {
            var lastAbs = MastFormat.date(st.lastOrderAt);
            var lastRel = relativeTime(st.lastOrderAt) || lastAbs;
            html += '<span class="status-badge pill" title="' + _esc(lastAbs) + '" style="background:rgba(42,124,111,0.08);color:var(--teal);font-size:0.72rem;">' +
              'Last bought ' + _esc(lastRel) +
            '</span>';
          }
        }
        html += '<span style="color:var(--amber-light);letter-spacing:0.04em;">' + starsHtml(r.rating) + '</span>';
        // D1 — verified-buyer chip. CF stamps `verifiedBuyer:true` when the
        // reviewer is signed-in AND has an order containing this productId.
        // Legacy `verified:true` (just-signed-in) shows as a weaker "Signed in" chip.
        if (r.verifiedBuyer === true) {
          html += '<span class="status-badge pill" title="Confirmed by an order in this tenant for this product" style="background:rgba(42,124,111,0.18);color:var(--teal);font-size:0.72rem;font-weight:600;">✓ Verified buyer</span>';
        } else if (r.verified === true) {
          html += '<span class="status-badge pill" title="Reviewer was signed in, but no matching order was found for this product" style="background:rgba(212,162,69,0.14);color:var(--amber);font-size:0.72rem;">Signed in</span>';
        }
        if (reviewEmail) html += '<span style="font-size:0.78rem;color:var(--warm-gray);">' + _esc(reviewEmail) + '</span>';
        html += '<span style="font-size:0.78rem;color:var(--warm-gray);margin-left:auto;">' + relativeTime(r.createdAt) + '</span>';
        html += reviewBadge(r.status) + '</div>';

        // W1.7 — product row with thumbnail + name (uses snapshotted productName,
        // falls back to product index, then to id).
        if (r.headline || r.productId) {
          html += '<div style="display:flex;align-items:center;gap:10px;font-size:0.85rem;margin-bottom:6px;">';
          if (r.productId && prodInfo && prodInfo.thumbnailUrl) {
            html += '<img src="' + _esc(prodInfo.thumbnailUrl) + '" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;border:1px solid var(--cream-dark);" />';
          }
          html += '<div>';
          if (r.headline) html += '<strong>' + _esc(r.headline) + '</strong> ';
          if (r.productId) {
            var prodLabel = csReviewProductLabel(r);
            html += '<span style="color:var(--warm-gray);">Product: ' + _esc(prodLabel) + '</span>';
          }
          html += '</div></div>';
        }

        if (r.body) html += '<div style="font-size:0.9rem;margin-bottom:10px;">' + _esc(r.body) + '</div>';

        // D1 — response section. Approved reviews can carry a single operator
        // response { body, authorName, createdAt, updatedAt }. Render mode toggles
        // between view (response exists) / edit (drafting or editing) / empty (no
        // response yet on an approved review).
        var resp = r.response || null;
        var isEditingResp = reviewsRespondingId === r.id;
        if (isEditingResp) {
          var draft = reviewsRespondDraft != null ? reviewsRespondDraft : (resp && resp.body) || '';
          html += '<div style="border-left:3px solid var(--teal);padding:10px 12px;margin-bottom:10px;background:rgba(42,124,111,0.05);border-radius:0 8px 8px 0;">';
          html += '<div style="font-weight:600;font-size:0.85rem;margin-bottom:6px;">Your response</div>';
          html += '<textarea id="csReviewRespDraft_' + _esc(r.id) + '" rows="3" style="width:100%;font-family:inherit;font-size:0.9rem;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--surface-card);color:var(--text);box-sizing:border-box;" placeholder="Reply on behalf of the shop. Shown publicly under the review.">' + _esc(draft) + '</textarea>';
          html += '<div style="display:flex;gap:8px;margin-top:8px;">';
          html += '<button class="btn btn-primary btn-small" onclick="csSaveReviewResponse(\'' + _esc(r.id) + '\')">Save</button>';
          html += '<button class="btn btn-secondary btn-small" onclick="csCancelReviewResponse()">Cancel</button>';
          if (resp) html += '<button class="btn btn-danger btn-small" style="margin-left:auto;" onclick="csDeleteReviewResponse(\'' + _esc(r.id) + '\')">Delete response</button>';
          html += '</div></div>';
        } else if (resp && resp.body) {
          var respWho = resp.authorName || 'Shop response';
          var respWhen = resp.updatedAt || resp.createdAt;
          var respRel = respWhen ? (relativeTime(respWhen) || '') : '';
          html += '<div style="border-left:3px solid var(--teal);padding:10px 12px;margin-bottom:10px;background:rgba(42,124,111,0.05);border-radius:0 8px 8px 0;">';
          html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
          html += '<span style="font-weight:600;font-size:0.85rem;color:var(--teal);">↳ ' + _esc(respWho) + '</span>';
          if (respRel) html += '<span style="font-size:0.78rem;color:var(--warm-gray);">' + _esc(respRel) + '</span>';
          html += '<button class="btn btn-secondary btn-small" style="margin-left:auto;" onclick="csEditReviewResponse(\'' + _esc(r.id) + '\')">Edit</button>';
          html += '</div>';
          html += '<div style="font-size:0.9rem;">' + _esc(resp.body) + '</div>';
          html += _renderResponseHistoryFooter(r.id);
          html += '</div>';
        } else {
          // Even when the response is currently null (delete), surface the
          // audit log so deleted responses don't vanish without trace.
          html += _renderResponseHistoryFooter(r.id, /*standalone*/ true);
        }

        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
        if (r.status === 'pending') {
          html += '<button class="btn btn-primary btn-small" onclick="csApproveReview(\'' + _esc(r.id) + '\')">Approve</button>';
          html += '<button class="btn btn-secondary btn-small" onclick="csRejectReview(\'' + _esc(r.id) + '\')">Reject</button>';
        } else if (r.status === 'rejected') {
          html += '<button class="btn btn-secondary btn-small" onclick="csApproveReview(\'' + _esc(r.id) + '\')">Approve</button>';
        } else if (r.status === 'approved') {
          // W1.8 — promote approved reviews into Testimonials + drafted social posts.
          // W1.8 round-3: reflect featuredOnSite state visibly on the row so
          // operators see the toggle took effect (was: button label never changed,
          // no "Featured" chip).
          // D1 — Respond button on approved reviews with no existing response.
          if (!r.response && reviewsRespondingId !== r.id) {
            html += '<button class="btn btn-secondary btn-small" onclick="csEditReviewResponse(\'' + _esc(r.id) + '\')" title="Reply to this review publicly">💬 Respond</button>';
          }
          if (r.featuredOnSite) {
            var featRel = r.featuredAt ? (relativeTime(r.featuredAt) || '') : '';
            var featTitle = r.featuredAt ? MastFormat.dateTime(r.featuredAt) : 'Featured on site';
            html += '<span class="status-badge pill" title="' + _esc(featTitle) + '" style="background:rgba(212,162,69,0.16);color:var(--amber);font-size:0.78rem;display:inline-flex;align-items:center;gap:4px;">' +
              '✓ Featured' + (featRel ? ' <span style="color:var(--warm-gray);font-weight:400;">· ' + _esc(featRel) + '</span>' : '') +
            '</span>';
            html += '<button class="btn btn-secondary btn-small" onclick="csUnfeatureReviewOnSite(\'' + _esc(r.id) + '\')" title="Remove this review from the homepage Testimonials section">Unfeature</button>';
          } else {
            html += '<button class="btn btn-primary btn-small" onclick="csFeatureReviewOnSite(\'' + _esc(r.id) + '\')" title="Add this review to the homepage Testimonials section">⭐ Feature on site</button>';
          }
          html += '<button class="btn btn-secondary btn-small" onclick="csDraftSocialFromReview(\'' + _esc(r.id) + '\')" title="Open the Social composer with this review pre-filled">✍ Draft Social Post</button>';
          // W3b — Ask reviewer for a photo via signed upload link. Only show
          // when we have a recipient email to send to.
          var askEmail = r.authorEmail || r.reviewerEmail || '';
          if (askEmail) {
            html += '<button class="btn btn-secondary btn-small" onclick="csAskForUgcPhoto(\'' + _esc(r.id) + '\')" title="Email this customer a one-time upload link for a photo of the product">📸 Ask for photo</button>';
          }
          html += '<button class="btn btn-secondary btn-small" onclick="csRejectReview(\'' + _esc(r.id) + '\')">Unpublish</button>';
        }
        html += '<button class="btn btn-danger btn-small" style="margin-left:auto;" onclick="csDeleteReview(\'' + _esc(r.id) + '\')">Delete</button>';
        html += '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    tab.innerHTML = html;
  }

  async function approveReview(id) {
    try { await MastDB.update('cs_reviews/' + id, { status: 'approved', updatedAt: nowIso() }); if (reviewsData[id]) reviewsData[id].status = 'approved'; showToast('Review approved'); renderReviews(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function rejectReview(id) {
    try { await MastDB.update('cs_reviews/' + id, { status: 'rejected', updatedAt: nowIso() }); if (reviewsData[id]) reviewsData[id].status = 'rejected'; showToast('Review rejected'); renderReviews(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function deleteReview(id) {
    if (!confirm('Delete this review? This cannot be undone.')) return;
    // Delegates to the shared core, which also cascades the
    // public/testimonials mirror (the old inline delete leaked it).
    try { await window.CsReviewsBridge.remove(id); showToast('Review deleted'); renderReviews(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }

  // ===== W1.8 — Promote approved review =====

  // "Feature on site" — write a testimonial under public/testimonials.
  // This is the path index.html reads on homepage load (MastDB.query
  // 'public/testimonials').orderByChild('order').limitToLast(10)).
  // Schema: { quote, author, rating, order, visible } — plus enrichment
  // fields we keep for our own admin views.
  // Idempotent: re-clicking on the same review updates the existing entry
  // (keyed by sourceReviewId so we don't fan out duplicates).
  async function featureReviewOnSite(id) {
    var r = reviewsData[id];
    if (!r) { showToast('Review not found', true); return; }
    if (r.status !== 'approved') { showToast('Only approved reviews can be featured.', true); return; }
    var reviewEmail = r.authorEmail || r.reviewerEmail || '';
    var emailKey = reviewEmail ? String(reviewEmail).toLowerCase().trim() : '';
    var matchedCustomer = emailKey ? csReviewCustomerByEmail[emailKey] : null;
    var prodInfo = r.productId ? csReviewProductIndex[r.productId] : null;
    // Prefer the review's own authorName over matchedCustomer.displayName for the
    // public storefront. Admin-controlled displayName can carry annotations like
    // "VIP whale" that we don't want leaking onto the homepage testimonial card.
    var customerName = (r.authorName || r.reviewerName) || (matchedCustomer && matchedCustomer.displayName) || 'Anonymous';
    var quote = r.body || r.headline || '';
    if (!quote) { showToast('This review has no body text to feature.', true); return; }
    // Use sourceReviewId as the key so re-featuring updates instead of duplicating.
    var key = 'review_' + r.id;
    var payload = {
      id: key,
      quote: quote,
      author: customerName,           // storefront renders "— {author}"
      customerName: customerName,     // back-compat / admin views
      rating: r.rating || null,
      order: Date.now(),              // orderByChild('order') — newest first by default
      visible: true,                  // storefront filters out visible:false
      productId: r.productId || null,
      productName: r.productName || (prodInfo && prodInfo.name) || null,
      productThumbnail: (prodInfo && prodInfo.thumbnailUrl) || null,
      sourceReviewId: r.id,
      featured: true,
      addedAt: nowIso()
    };
    try {
      await MastDB.set('public/testimonials/' + key, payload);
      // Mark the review itself so the admin UI can show "Featured" state.
      try {
        await MastDB.update('cs_reviews/' + r.id, {
          featuredOnSite: true,
          featuredAt: nowIso()
        });
        if (reviewsData[r.id]) {
          reviewsData[r.id].featuredOnSite = true;
          reviewsData[r.id].featuredAt = payload.addedAt;
        }
      } catch (_e) { /* non-fatal — testimonial already wrote */ if (typeof window !== 'undefined' && window.MastError) window.MastError.capture(_e, { where: 'customer-service.featureReviewOnSite:cs_reviews_flag' }); }
      showToast('Featured on homepage Testimonials section.');
      // W1.8 round-3 — re-render so the row visibly flips to "✓ Featured" + Unfeature.
      renderReviews();
    } catch (err) {
      showToast('Failed: ' + (err && err.message), true);
    }
  }

  // "Unfeature" — remove the testimonial entry + clear the review flag.
  // Idempotent: re-clicking on a non-featured review is a no-op.
  async function unfeatureReviewOnSite(id) {
    var r = reviewsData[id];
    if (!r) { showToast('Review not found', true); return; }
    var key = 'review_' + r.id;
    try {
      await MastDB.remove('public/testimonials/' + key);
      try {
        await MastDB.update('cs_reviews/' + r.id, {
          featuredOnSite: false,
          featuredAt: null
        });
        if (reviewsData[r.id]) {
          reviewsData[r.id].featuredOnSite = false;
          reviewsData[r.id].featuredAt = null;
        }
      } catch (_e) { /* non-fatal */ if (typeof window !== 'undefined' && window.MastError) window.MastError.capture(_e, { where: 'customer-service.unfeatureReviewOnSite:cs_reviews_flag' }); }
      showToast('Removed from homepage Testimonials section.');
      renderReviews();
    } catch (err) {
      showToast('Failed: ' + (err && err.message), true);
    }
  }

  // D1 — anonymous-review policy toggle. Persists the setting to cs_config/reviews
  // (admin source of truth) AND mirrors to public/config/reviews so storefront
  // product.html can read the policy without a rules widen on cs_config.
  async function setReviewsAnonymousAllowed(allowed) {
    var prev = !!reviewsConfig.anonymousAllowed;
    reviewsConfig.anonymousAllowed = !!allowed;
    try {
      await MastDB.set('cs_config/reviews', {
        anonymousAllowed: !!allowed,
        requireApproval: true,
        updatedAt: nowIso(),
        updatedBy: (window.currentUser && window.currentUser.uid) || null
      });
      try {
        await MastDB.set('public/config/reviews', { anonymousAllowed: !!allowed, updatedAt: nowIso() });
      } catch (_e) { /* non-fatal — storefront will fall back to CF enforcement */ if (typeof window !== 'undefined' && window.MastError) window.MastError.capture(_e, { where: 'customer-service.setReviewsAnonymousAllowed:public_mirror' }); }
      showToast(allowed ? 'Anonymous reviews allowed' : 'Reviews now require sign-in');
      renderReviews();
    } catch (err) {
      reviewsConfig.anonymousAllowed = prev;
      showToast('Failed: ' + (err && err.message), true);
      renderReviews();
    }
  }

  // D1 — Respond to a review. Toggles the row into edit mode; render uses
  // reviewsRespondingId / reviewsRespondDraft to swap the response card layout.
  function editReviewResponse(id) {
    reviewsRespondingId = id;
    reviewsRespondDraft = null;
    renderReviews();
    // Focus the textarea after render.
    setTimeout(function () {
      var ta = document.getElementById('csReviewRespDraft_' + id);
      if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
    }, 0);
  }
  function cancelReviewResponse() {
    reviewsRespondingId = null;
    reviewsRespondDraft = '';
    renderReviews();
  }
  // Audit-log footer rendered under a published response (or, when the most
  // recent action was a delete, standalone in place of the response). Shows
  // an "Edited N times" toggle link when there's >1 transition or a delete;
  // expanding lists every transition with body excerpt + who + when.
  function _renderResponseHistoryFooter(reviewId, standalone) {
    var hist = reviewResponseHistoryByReview[reviewId] || [];
    if (hist.length === 0) return '';
    var transitions = hist.length;
    var hasDelete = hist.some(function (h) { return h.action === 'deleted'; });
    // Don't surface anything for a single create transition — that's just the
    // initial post and adds noise. Show only when there's edit/delete activity.
    if (transitions === 1 && !hasDelete) return '';
    var expanded = !!reviewHistoryExpanded[reviewId];
    var label;
    if (hasDelete && standalone) label = 'Response was deleted · view history (' + transitions + ')';
    else if (hasDelete) label = 'Edited ' + (transitions - 1) + ' ' + MastFormat.plural(transitions - 1, 'time') + ' · includes deletion';
    else label = 'Edited ' + (transitions - 1) + ' ' + MastFormat.plural(transitions - 1, 'time');
    var wrapStyle = standalone
      ? 'border-left:3px solid var(--warm-gray);padding:10px 12px;margin-bottom:10px;background:rgba(0,0,0,0.03);border-radius:0 8px 8px 0;'
      : 'margin-top:8px;padding-top:6px;border-top:1px dashed var(--cream-dark);';
    var out = '<div style="' + wrapStyle + '">';
    out += '<button type="button" onclick="csToggleResponseHistory(\'' + _esc(reviewId) + '\')"' +
      ' style="background:transparent;border:0;color:var(--warm-gray);cursor:pointer;font-size:0.78rem;padding:0;">' +
      (expanded ? '▾ ' : '▸ ') + _esc(label) + '</button>';
    if (expanded) {
      out += '<div style="margin-top:8px;font-size:0.78rem;">';
      hist.forEach(function (h) {
        var when = h.createdAt ? (relativeTime(h.createdAt) || '') : '';
        var who = h.authorName || 'Shop';
        var actionLabel = h.action === 'created' ? 'Posted'
          : h.action === 'edited' ? 'Edited'
          : h.action === 'deleted' ? 'Deleted'
          : h.action;
        out += '<div style="margin-bottom:6px;padding-left:8px;border-left:2px solid var(--cream-dark);">';
        out += '<div style="color:var(--warm-gray);margin-bottom:2px;">' + _esc(actionLabel) + ' by ' + _esc(who) + (when ? ' · ' + _esc(when) : '') + '</div>';
        if (h.action === 'deleted') {
          out += '<div style="color:var(--text);font-style:italic;">Removed: "' + _esc((h.prevBody || '').slice(0, 280)) + (h.prevBody && h.prevBody.length > 280 ? '…' : '') + '"</div>';
        } else if (h.body) {
          out += '<div style="color:var(--text);">' + _esc(h.body.slice(0, 280)) + (h.body.length > 280 ? '…' : '') + '</div>';
          if (h.action === 'edited' && h.prevBody) {
            out += '<div style="color:var(--warm-gray);font-style:italic;margin-top:2px;">Was: "' + _esc(h.prevBody.slice(0, 200)) + (h.prevBody.length > 200 ? '…' : '') + '"</div>';
          }
        }
        out += '</div>';
      });
      out += '</div>';
    }
    out += '</div>';
    return out;
  }

  // Append-only audit log. Every response create/edit/delete writes one row
  // to cs_review_responses/{revId}. cs_reviews/{id}.response stays the
  // "latest visible" pointer so the storefront read path doesn't change.
  // Operator can edit/delete in the admin freely — the audit row preserves
  // what was actually published and for how long.
  async function _appendResponseHistory(reviewId, action, body, prevResponse) {
    var revId = MastDB.newKey('cs_review_responses');
    var now = nowIso();
    var entry = {
      reviewId: reviewId,
      action: action, // 'created' | 'edited' | 'deleted'
      body: body, // null for delete
      authorName: (window.currentUser && (window.currentUser.displayName || window.currentUser.email)) || 'Shop',
      authorUid: (window.currentUser && window.currentUser.uid) || null,
      prevBody: (prevResponse && prevResponse.body) || null,
      prevCreatedAt: (prevResponse && prevResponse.createdAt) || null,
      createdAt: now
    };
    try { await MastDB.set('cs_review_responses/' + revId, entry); }
    catch (err) { console.warn('[cs_review_responses] history write failed:', err && err.message); }
  }

  async function saveReviewResponse(id) {
    var r = reviewsData[id];
    if (!r) { showToast('Review not found', true); return; }
    var ta = document.getElementById('csReviewRespDraft_' + id);
    var body = ta ? ta.value.trim() : '';
    var existing = r.response || null;
    try {
      // Delegate to the shared state-free core (write + cs_review_responses
      // audit append + reviewsData sync stay single-sourced there).
      await window.CsReviewsBridge.respond(id, body);
      reviewsRespondingId = null;
      reviewsRespondDraft = '';
      showToast(existing ? 'Response updated' : 'Response posted');
      renderReviews();
    } catch (err) {
      showToast('Failed: ' + (err && err.message), true);
    }
  }
  async function deleteReviewResponse(id) {
    if (!confirm('Delete this response? The original review will remain.')) return;
    try {
      await window.CsReviewsBridge.deleteResponse(id);
      reviewsRespondingId = null;
      reviewsRespondDraft = '';
      showToast('Response deleted');
      renderReviews();
    } catch (err) {
      showToast('Failed: ' + (err && err.message), true);
    }
  }

  // "Draft Social Post" — open the Social composer pre-filled. Tries the global
  // window.__draftSocialPostFromReview hook first (social.js can register it);
  // otherwise navigates to #social and stashes a draft on sessionStorage that
  // social.js can pick up on its first render.
  function draftSocialFromReview(id) {
    var r = reviewsData[id];
    if (!r) { showToast('Review not found', true); return; }
    var reviewEmail = r.authorEmail || r.reviewerEmail || '';
    var emailKey = reviewEmail ? String(reviewEmail).toLowerCase().trim() : '';
    var matchedCustomer = emailKey ? csReviewCustomerByEmail[emailKey] : null;
    var prodInfo = r.productId ? csReviewProductIndex[r.productId] : null;
    var name = matchedCustomer ? (matchedCustomer.displayName || '').split(' ')[0] : (r.authorName || r.reviewerName || 'a customer');
    var productName = r.productName || (prodInfo && prodInfo.name) || '';
    var quote = (r.body || r.headline || '').trim().replace(/\s+/g, ' ');
    var body = productName
      ? '"' + quote + '" — ' + name + ', on ' + productName
      : '"' + quote + '" — ' + name;
    var image = (r.photos && r.photos[0]) || (prodInfo && prodInfo.thumbnailUrl) || '';
    var prefill = {
      body: body,
      imageUrl: image,
      sourceReviewId: r.id,
      sourceProductId: r.productId || null
    };

    // V1 social.js was retired (T6) → social-v2 owns __draftSocialPostFromReview
    // (it creates the draft, navigates to the social surface, and opens it in the
    // editor). Ensure social-v2 is loaded so the hook is registered, then call it.
    function _callDraftHook() {
      if (typeof window.__draftSocialPostFromReview === 'function') {
        try { window.__draftSocialPostFromReview(prefill); return true; } catch (e) { /* fall through */ }
      }
      return false;
    }
    if (window.MastAdmin && MastAdmin.loadModule) {
      showToast('Opening Social with this review pre-filled…');
      MastAdmin.loadModule('social-v2').then(function () {
        if (!_callDraftHook() && typeof navigateTo === 'function') navigateTo('social');
      }).catch(function () {
        if (typeof navigateTo === 'function') navigateTo('social');
      });
      return;
    }
    if (_callDraftHook()) return;
    // Last-resort fallback when the module loader is unavailable: just navigate.
    if (typeof navigateTo === 'function') navigateTo('social');
    else window.location.hash = '#social';
    showToast('Opening Social with this review pre-filled…');
  }

  // ===== W3b — Ask reviewer for a UGC photo =====

  // Pops a confirm modal that previews the permission-ask email subject and
  // body. On Send, calls mintUgcUploadToken (CF) which mints a single-use
  // JWT, writes admin/ugc_tokens/{jti}, and queues the email at
  // tenants/{tid}/emailQueue/{idempotencyKey} for processEmailQueue to send.
  // Idempotent: re-asking the same review for the same recipient collides
  // on idempotencyKey = sha1(tid|reviewId|recipientEmail).
  function askForUgcPhoto(id) {
    var r = reviewsData[id];
    if (!r) { showToast('Review not found', true); return; }
    var recipientEmail = r.authorEmail || r.reviewerEmail || '';
    if (!recipientEmail) { showToast('This review has no email on file to send to.', true); return; }
    var emailKey = String(recipientEmail).toLowerCase().trim();
    var matchedCustomer = csReviewCustomerByEmail[emailKey] || null;
    var customerFirstName =
      (matchedCustomer && (matchedCustomer.displayName || '').split(' ')[0]) ||
      (r.authorName || r.reviewerName || '').split(' ')[0] || '';
    var prodInfo = r.productId ? csReviewProductIndex[r.productId] : null;
    var productName = r.productName || (prodInfo && prodInfo.name) || '(product)';
    var quote = (r.body || r.headline || '').trim().replace(/\s+/g, ' ');
    var brandName = (window.TENANT_CONFIG && window.TENANT_CONFIG.brand && window.TENANT_CONFIG.brand.name)
      || (window.TENANT_BRAND && window.TENANT_BRAND.name)
      || (window.TENANT_CONFIG && (window.TENANT_CONFIG.brandName || window.TENANT_CONFIG.name))
      || 'the team';

    var defaultSubject = 'A small request from ' + brandName;
    var previewBody =
      'Hi ' + (customerFirstName || 'there') + ',\n\n' +
      'Thank you so much for your kind review of ' + productName + ':\n\n' +
      '"' + quote + '"\n\n' +
      "If you happen to have a photo of you wearing it (or just the piece itself), we'd love to share it on our site and social media with credit to you.\n\n" +
      '[Upload a photo] — link good for 7 days, single use\n\n' +
      "No pressure either way — we just love sharing our customers when they're up for it.\n\n" +
      '— ' + brandName;

    // Build the modal.
    var overlay = document.createElement('div');
    overlay.id = 'csUgcAskOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
    var card = document.createElement('div');
    card.style.cssText = 'background:var(--card-bg,#2a2a2a);color:var(--text,#e8e4df);border-radius:12px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:24px;';
    card.innerHTML =
      '<h3 style="margin:0 0 6px;font-size:1.15rem;">📸 Ask for a photo</h3>' +
      '<p style="margin:0 0 16px;font-size:0.9rem;color:var(--warm-gray,#888);">Sends a one-time, 7-day signed upload link to <strong>' + _esc(recipientEmail) + '</strong>.</p>' +
      '<label style="display:block;font-size:0.85rem;font-weight:500;margin-bottom:6px;">Subject</label>' +
      '<input id="csUgcAskSubject" type="text" value="' + _esc(defaultSubject) + '" style="width:100%;padding:8px 10px;border:1px solid var(--border,#3a3a3a);border-radius:6px;font-size:0.9rem;margin-bottom:14px;">' +
      '<label style="display:block;font-size:0.85rem;font-weight:500;margin-bottom:6px;">Preview</label>' +
      '<pre id="csUgcAskBody" style="white-space:pre-wrap;font-family:inherit;font-size:0.85rem;line-height:1.5;background:var(--surface-card,#2a2a2a);padding:12px 14px;border-radius:6px;max-height:280px;overflow:auto;margin:0 0 16px;"></pre>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button class="btn btn-secondary btn-small" id="csUgcAskCancel">Cancel</button>' +
      '<button class="btn btn-primary btn-small" id="csUgcAskSend">Send</button>' +
      '</div>';
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.getElementById('csUgcAskBody').textContent = previewBody;

    function close() { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    document.getElementById('csUgcAskCancel').onclick = close;
    overlay.onclick = function(e){ if (e.target === overlay) close(); };

    document.getElementById('csUgcAskSend').onclick = async function() {
      var sendBtn = this;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      try {
        var tenantId = window.TENANT_ID
          || (window.TENANT_CONFIG && window.TENANT_CONFIG.tenantId)
          || null;
        if (!tenantId) throw new Error('tenantId not resolved');
        var fn = firebase.functions().httpsCallable('mintUgcUploadToken');
        var resp = await fn({
          tenantId: tenantId,
          customerId: (matchedCustomer && matchedCustomer.customerId) || null,
          customerEmail: recipientEmail,
          customerFirstName: customerFirstName || null,
          productId: r.productId || null,
          productName: productName,
          reviewId: r.id,
          reviewQuote: quote,
        });
        var data = (resp && resp.data) || {};
        if (!data.ok) throw new Error('mint failed');
        close();
        showToast('Permission ask emailed to ' + recipientEmail);
      } catch (err) {
        var msg = (err && err.message) || 'unknown error';
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
        showToast('Failed to send: ' + msg, true);
      }
    };
  }

  function renderSurveys() {
    var tab = document.getElementById('csSurveysTab');
    if (!tab) return;
    if (!surveysLoaded) { tab.innerHTML = '<div style="padding:40px;text-align:center;color:var(--warm-gray);">Loading surveys…</div>'; return; }
    var html = '<div style="padding:24px;">';
    html += '<div class="section-header" style="margin-bottom:14px;"><h2 style="margin:0;">Surveys</h2><button class="btn btn-secondary btn-small" onclick="csSurveysRefresh()">Refresh</button></div>';

    // Contextual URL hint for features-only tenants with surveys enabled
    (function() {
      try {
        var BEC = window.BusinessEntityConstants || {};
        var pageOptions = BEC.FEATURE_PAGE_OPTIONS || [];
        // We need featureMode + enabledFeaturePages from the business entity.
        // These are loaded async, so we read from a cached window var if available,
        // otherwise we skip the banner (it will appear on next render after load).
        var presence = window._cachedPresenceForBanners || {};
        var featureMode = presence.featureMode || '';
        var enabledPages = Array.isArray(presence.enabledFeaturePages) ? presence.enabledFeaturePages : [];
        if (featureMode === 'features-only' && enabledPages.indexOf('surveys') !== -1) {
          var domain = (window.TENANT_CONFIG && window.TENANT_CONFIG.domain) || window.location.hostname;
          var surveyUrl = 'https://' + domain + '/survey';
          html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:rgba(42,124,111,0.09);border:1px solid rgba(42,124,111,0.2);border-radius:8px;margin-bottom:16px;font-size:0.85rem;">' +
            '<span style="color:var(--teal);flex-shrink:0;margin-top:1px;">&#9432;</span>' +
            '<span>Survey emails link to your Mast URL. Make sure this URL is accessible: ' +
            '<a href="' + _esc(surveyUrl) + '" target="_blank" rel="noopener" style="color:var(--teal);font-family:monospace;">' + _esc(surveyUrl) + '</a></span>' +
            '</div>';
        }
      } catch (e) { /* non-fatal */ }
    }());

    // Automated Surveys opt-in toggle
    var toggleColor = automatedSurveysEnabled ? 'var(--teal)' : 'var(--cream-dark)';
    var toggleLabel = automatedSurveysEnabled ? 'ON' : 'OFF';
    var toggleDisabled = automatedSurveysToggling ? ' disabled' : '';
    html += '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:14px 18px;background:var(--surface-card);margin-bottom:18px;display:flex;align-items:center;gap:14px;">';
    html += '<button onclick="csToggleAutomatedSurveys()"' + toggleDisabled + ' style="flex-shrink:0;width:48px;height:26px;border-radius:13px;border:none;cursor:' + (automatedSurveysToggling ? 'not-allowed' : 'pointer') + ';background:' + toggleColor + ';position:relative;transition:background 0.2s;padding:0;">';
    html += '<span style="position:absolute;top:3px;' + (automatedSurveysEnabled ? 'right:3px' : 'left:3px') + ';width:20px;height:20px;border-radius:50%;background:#fff;display:block;transition:all 0.2s;"></span>';
    html += '</button>';
    html += '<div style="flex:1;">';
    html += '<div style="font-weight:600;font-size:0.9rem;">Automated Surveys <span style="margin-left:6px;font-size:0.78rem;font-weight:700;color:' + (automatedSurveysEnabled ? 'var(--teal)' : 'var(--warm-gray)') + ';">' + toggleLabel + '</span></div>';
    html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:2px;">When enabled, surveys are sent automatically based on your active trigger rules below.</div>';
    html += '</div></div>';

    html += '<div class="view-tabs" style="margin-bottom:18px;">';
    // D3 (2026-05-28): renamed user-facing label "Groups" -> "Question Sets"
    // for industry alignment. Backend tab key + collection name stay 'groups'
    // / cs_survey_groups for no-migration compatibility.
    [['questions','Questions'],['groups','Question Sets'],['surveys','Surveys'],['triggers','Triggers'],['responses','Responses']].forEach(function (p) {
      html += '<button class="view-tab' + (surveysSubTab === p[0] ? ' active' : '') + '" onclick="csSurveysSwitchTab(\'' + p[0] + '\')">' + p[1] + '</button>';
    });
    html += '</div>';
    // D3: one-line subtitle per sub-tab explaining its role in the
    // Questions -> Question Sets -> Surveys -> Triggers flow.
    var _subTabSubtitle = {
      'questions':  'Reusable question items. Build your library here, then bundle into Question Sets.',
      'groups':     'Bundle questions into a reusable template. Surveys reference Question Sets.',
      'surveys':    'Pick a Question Set + add a trigger or token — this is what gets sent to customers.',
      'triggers':   'Auto-send a Survey when something happens (order placed, class attended, etc.).',
      'responses':  'Customer answers — click any row to see the full submission.'
    }[surveysSubTab];
    if (_subTabSubtitle) {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:-8px 0 14px;max-width:680px;">' + _esc(_subTabSubtitle) + '</p>';
    }
    if (surveysSubTab === 'questions')       html += renderQuestionsTab();
    else if (surveysSubTab === 'groups')     html += renderGroupsTab();
    else if (surveysSubTab === 'surveys')    html += renderSurveysDefTab();
    else if (surveysSubTab === 'triggers')   html += renderTriggersTab();
    else if (surveysSubTab === 'responses')  html += renderResponsesTab();
    if (sendLinkSurveyId) {
      var sv = surveysDefData[sendLinkSurveyId];
      html += '<div style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;display:flex;align-items:center;justify-content:center;">';
      html += '<div style="background:var(--bg);border-radius:12px;padding:24px;width:min(520px,92vw);box-shadow:0 8px 32px rgba(0,0,0,0.3);">';
      html += '<h3 style="margin:0 0 4px;">Send Survey</h3><div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:14px;">' + _esc(sv ? sv.name : sendLinkSurveyId) + '</div>';

      // Build 7-BulkSend — mode toggle
      html += '<div style="display:flex;gap:8px;margin-bottom:14px;">';
      html += '<button class="view-tab' + (sendMode === 'one' ? ' active' : '') + '" onclick="csSendSetMode(\'one\')" style="font-size:0.78rem;padding:5px 10px;">Send to one person</button>';
      html += '<button class="view-tab' + (sendMode === 'segment' ? ' active' : '') + '" onclick="csSendSetMode(\'segment\')" style="font-size:0.78rem;padding:5px 10px;">Send to a segment</button>';
      html += '</div>';

      if (sendInProgress && sendProgress) {
        // Live progress UI
        var pct = sendProgress.total > 0 ? Math.round(((sendProgress.sent + sendProgress.failed) / sendProgress.total) * 100) : 0;
        html += '<div style="margin-bottom:14px;">';
        html += '<div style="font-size:0.85rem;margin-bottom:6px;">Sending ' + esc(String(sendProgress.sent + sendProgress.failed)) + ' / ' + esc(String(sendProgress.total)) + '…</div>';
        html += '<div style="height:8px;background:var(--cream-dark);border-radius:4px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:var(--teal);transition:width 0.2s;"></div></div>';
        if (sendProgress.currentEmail) {
          html += '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:4px;">→ ' + _esc(sendProgress.currentEmail) + '</div>';
        }
        if (sendProgress.failed > 0) {
          html += '<div style="font-size:0.78rem;color:var(--danger);margin-top:4px;">' + esc(String(sendProgress.failed)) + ' failed</div>';
        }
        html += '</div>';
        html += '<div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-secondary" disabled>Sending…</button></div>';
      } else if (sendMode === 'one') {
        html += '<div style="margin-bottom:12px;"><label style="display:block;font-weight:600;font-size:0.9rem;margin-bottom:4px;">Contact Email *</label><input id="csSendEmail" type="email" class="form-input" style="width:100%;box-sizing:border-box;" placeholder="customer@example.com"></div>';
        html += '<div style="margin-bottom:18px;"><label style="display:block;font-weight:600;font-size:0.9rem;margin-bottom:4px;">Contact Name</label><input id="csSendName" type="text" class="form-input" style="width:100%;box-sizing:border-box;" placeholder="Optional"></div>';
        html += '<div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-secondary" onclick="csSendLinkCancel()">Cancel</button><button class="btn btn-primary" onclick="csSendLinkSubmit()">Send Invite</button></div>';
      } else {
        // Segment mode
        if (!sendSegmentsLoaded) {
          html += '<div style="padding:24px;text-align:center;color:var(--warm-gray);">Loading segments…</div>';
          setTimeout(function () { csLoadSendSegments(); }, 0);
        } else {
          var segList = Object.entries(sendSegmentsData).map(function (e) { return Object.assign({ id: e[0] }, e[1] || {}); });
          if (segList.length === 0) {
            html += '<div style="padding:16px;background:var(--cream);border-radius:8px;font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">No saved segments yet. Go to <a href="#customers" onclick="event.preventDefault();csSendLinkCancel();navigateTo(\'customers\');" style="color:var(--teal);">Customers</a> and use "Save as segment" to create one.</div>';
          } else {
            html += '<div style="margin-bottom:12px;"><label style="display:block;font-weight:600;font-size:0.9rem;margin-bottom:4px;">Segment *</label>';
            html += '<select id="csSendSegment" onchange="csSendSetSegment(this.value)" class="form-input" style="width:100%;box-sizing:border-box;">';
            html += '<option value="">— Pick a segment —</option>';
            segList.forEach(function (s) {
              html += '<option value="' + _esc(s.id) + '"' + (sendSegmentId === s.id ? ' selected' : '') + '>' + _esc(s.name || s.id) + '</option>';
            });
            html += '</select></div>';
            if (sendSegmentId) {
              var preview = sendSegmentMembersCount;
              html += '<div style="margin-bottom:12px;font-size:0.85rem;">';
              if (preview == null) {
                html += '<span style="color:var(--warm-gray);">Counting recipients…</span>';
              } else {
                var capped = preview > 25;
                html += '<strong>' + esc(String(preview)) + '</strong> ' + MastFormat.plural(preview, 'matching customer') +
                  (capped ? '<span style="color:var(--amber);"> — capped to 25 per send (re-run to continue)</span>' : '');
              }
              html += '</div>';
            }
          }
          html += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
          html += '<button class="btn btn-secondary" onclick="csSendLinkCancel()">Cancel</button>';
          var canSend = sendSegmentId && sendSegmentMembersCount > 0;
          html += '<button class="btn btn-primary"' + (canSend ? '' : ' disabled') + ' onclick="csSendLinkSegmentSubmit()">Send to segment</button>';
          html += '</div>';
        }
      }
      html += '</div></div>';
    }
    html += '</div>';
    tab.innerHTML = html;
  }

  function renderQuestionsTab() {
    var items = Object.values(questionsData).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1; });
    var html = showAddQuestion ? renderQuestionForm(null) : '<button class="btn btn-primary btn-small" onclick="csShowAddQuestion()" style="margin-bottom:14px;">+ Add Question</button>';
    if (!items.length && !showAddQuestion) return html + '<div style="padding:24px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No questions yet.</div>';
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    items.forEach(function (q) {
      if (questionEditId === q.id) { html += renderQuestionForm(q); return; }
      html += '<div style="border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;background:var(--surface-card);display:flex;align-items:center;gap:10px;">';
      html += '<div style="flex:1;"><span style="font-weight:600;">' + _esc(q.text) + '</span><span style="margin-left:8px;font-size:0.78rem;color:var(--warm-gray);">[' + _esc(q.type) + ']</span>';
      if (q.isStock) html += '<span style="margin-left:8px;background:rgba(42,124,111,0.15);color:var(--teal);padding:1px 8px;border-radius:10px;font-size:0.78rem;">stock</span>';
      if (q.type === 'multiple_choice' && q.options && q.options.length) html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:3px;">Options: ' + q.options.map(function (o) { return _esc(o); }).join(', ') + '</div>';
      html += '</div><button class="btn btn-secondary btn-small" onclick="csEditQuestion(\'' + _esc(q.id) + '\')">Edit</button>';
      html += '<button class="btn btn-danger btn-small" onclick="csDeleteQuestion(\'' + _esc(q.id) + '\')">Delete</button></div>';
    });
    return html + '</div>';
  }

  function renderQuestionForm(q) {
    var isEdit = !!q, id = isEdit ? _esc(q.id) : '', typeVal = isEdit ? (q.type || 'open_text') : 'open_text';
    var optVal = isEdit && q.options ? q.options.join(', ') : '';
    var html = '<div style="border:2px solid var(--amber-light);border-radius:10px;padding:16px;background:var(--surface-card);margin-bottom:12px;">';
    html += '<h4 style="margin:0 0 12px;">' + (isEdit ? 'Edit Question' : 'New Question') + '</h4>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Question Text *</label>';
    html += '<input id="csQText" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(q.text || '') : '') + '" placeholder="Enter question text"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Type</label>';
    html += '<select id="csQType" class="form-select" style="width:100%;" onchange="csQTypeChange(this.value)">';
    ['rating','NPS','yes_no','multiple_choice','open_text'].forEach(function (t) { html += '<option value="' + t + '"' + (typeVal === t ? ' selected' : '') + '>' + t + '</option>'; });
    html += '</select></div>';
    html += '<div id="csQOptionsRow" style="margin-bottom:10px;' + (typeVal === 'multiple_choice' ? '' : 'display:none;') + '">';
    html += '<label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Options (comma-separated)</label>';
    html += '<input id="csQOptions" class="form-input" style="width:100%;box-sizing:border-box;" value="' + _esc(optVal) + '" placeholder="Option A, Option B"></div>';
    var reqChecked = isEdit ? (q.required !== false) : true;
    html += '<div style="margin-bottom:12px;"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">';
    html += '<input type="checkbox" id="csQRequired"' + (reqChecked ? ' checked' : '') + ' style="width:15px;height:15px;accent-color:var(--amber-light);">';
    html += '<span><strong>Required</strong> — respondent must answer before continuing</span></label></div>';
    html += '<div style="display:flex;gap:8px;"><button class="btn btn-primary btn-small" onclick="csSaveQuestion(\'' + id + '\')">' + (isEdit ? 'Save' : 'Add') + '</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="csCancelQuestion()">Cancel</button></div></div>';
    return html;
  }

  async function saveQuestion(id) {
    var text = ((document.getElementById('csQText') || {}).value || '').trim();
    var type = (document.getElementById('csQType') || {}).value || 'open_text';
    var optRaw = (document.getElementById('csQOptions') || {}).value || '';
    var required = !!(document.getElementById('csQRequired') || {}).checked;
    if (!text) { showToast('Question text is required', true); return; }
    try {
      // Delegate to the shared state-free core (single-sourced write shape).
      await window.CsSurveysBridge.saveQuestion(id || null, { text: text, type: type, options: optRaw, required: required });
      if (id) { questionEditId = null; showToast('Question updated'); }
      else { showAddQuestion = false; showToast('Question added'); }
      renderSurveys();
    } catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function deleteQuestion(id) {
    if (!confirm('Delete this question?')) return;
    try { await window.CsSurveysBridge.deleteQuestion(id); showToast('Question deleted'); renderSurveys(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }

  function renderGroupsTab() {
    var items = Object.values(groupsData).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1; });
    var html = showAddGroup ? renderGroupForm(null) : '<button class="btn btn-primary btn-small" onclick="csShowAddGroup()" style="margin-bottom:14px;">+ Add Question Set</button>';
    if (!items.length && !showAddGroup) return html + '<div style="padding:24px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No Question Sets yet.</div>';
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    items.forEach(function (g) {
      if (groupEditId === g.id) { html += renderGroupForm(g); return; }
      var qc = (g.questionIds || []).length;
      html += '<div style="border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;background:var(--surface-card);display:flex;align-items:center;gap:10px;">';
      html += '<div style="flex:1;"><span style="font-weight:600;">' + _esc(g.name) + '</span>';
      if (g.eventType) html += '<span style="margin-left:8px;font-size:0.78rem;color:var(--warm-gray);">' + _esc(g.eventType) + '</span>';
      html += '<span style="margin-left:8px;font-size:0.78rem;color:var(--warm-gray);">' + MastFormat.countNoun(qc, 'question') + '</span>';
      if (g.isActive === false) html += '<span style="margin-left:8px;background:rgba(220,38,38,0.15);color:var(--danger);padding:1px 8px;border-radius:10px;font-size:0.78rem;">inactive</span>';
      html += '</div><button class="btn btn-secondary btn-small" onclick="csEditGroup(\'' + _esc(g.id) + '\')">Edit</button>';
      html += '<button class="btn btn-danger btn-small" onclick="csDeleteGroup(\'' + _esc(g.id) + '\')">Delete</button></div>';
    });
    return html + '</div>';
  }

  function renderGroupForm(g) {
    var isEdit = !!g, id = isEdit ? _esc(g.id) : '', selectedIds = isEdit && g.questionIds ? g.questionIds : [];
    var qItems = Object.values(questionsData);
    var html = '<div style="border:2px solid var(--amber-light);border-radius:10px;padding:16px;background:var(--surface-card);margin-bottom:12px;">';
    html += '<h4 style="margin:0 0 12px;">' + (isEdit ? 'Edit Question Set' : 'New Question Set') + '</h4>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Name *</label>';
    html += '<input id="csGName" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(g.name || '') : '') + '" placeholder="e.g. Post-Purchase Survey"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Event Type</label>';
    html += '<input id="csGEventType" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(g.eventType || '') : '') + '" placeholder="e.g. order_complete"></div>';
    html += '<div style="margin-bottom:12px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:6px;">Questions</label>';
    html += '<div style="max-height:160px;overflow-y:auto;border:1px solid var(--cream-dark);border-radius:6px;padding:8px;background:var(--bg);">';
    if (!qItems.length) { html += '<div style="font-size:0.85rem;color:var(--warm-gray);">No questions — add some first.</div>'; }
    else { qItems.forEach(function (q) { html += '<label style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:0.9rem;cursor:pointer;"><input type="checkbox" name="csGQIds" value="' + _esc(q.id) + '"' + (selectedIds.indexOf(q.id) >= 0 ? ' checked' : '') + '>' + _esc(q.text) + ' <span style="color:var(--warm-gray);font-size:0.78rem;">[' + _esc(q.type) + ']</span></label>'; }); }
    html += '</div></div>';
    html += '<div style="display:flex;gap:8px;"><button class="btn btn-primary btn-small" onclick="csSaveGroup(\'' + id + '\')">' + (isEdit ? 'Save' : 'Add') + '</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="csCancelGroup()">Cancel</button></div></div>';
    return html;
  }

  async function saveGroup(id) {
    var name = ((document.getElementById('csGName') || {}).value || '').trim();
    var et = ((document.getElementById('csGEventType') || {}).value || '').trim();
    if (!name) { showToast('Question Set name is required', true); return; }
    var qIds = []; document.querySelectorAll('input[name="csGQIds"]:checked').forEach(function (cb) { qIds.push(cb.value); });
    try {
      await window.CsSurveysBridge.saveGroup(id || null, { name: name, eventType: et, questionIds: qIds });
      if (id) { groupEditId = null; showToast('Question Set updated'); }
      else { showAddGroup = false; showToast('Question Set added'); }
      renderSurveys();
    } catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function deleteGroup(id) {
    if (!confirm('Delete this Question Set?')) return;
    try { await window.CsSurveysBridge.deleteGroup(id); showToast('Question Set deleted'); renderSurveys(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }

  function renderSurveysDefTab() {
    var items = Object.values(surveysDefData).sort(function (a, b) { return (b.createdAt || '') > (a.createdAt || '') ? 1 : -1; });
    var html = showAddSurvey ? renderSurveyForm(null) : '<button class="btn btn-primary btn-small" onclick="csShowAddSurvey()" style="margin-bottom:14px;">+ New Survey</button>';
    if (!items.length && !showAddSurvey) return html + '<div style="padding:24px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No surveys yet.</div>';
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    items.forEach(function (sv) {
      if (surveyEditId === sv.id) { html += renderSurveyForm(sv); return; }
      var grp = groupsData[sv.groupId];
      var isClosed = sv.closesAt && Date.now() > new Date(sv.closesAt).getTime();
      html += '<div style="border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;background:var(--surface-card);">';
      html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><span style="font-weight:600;">' + _esc(sv.name) + '</span>' + surveyBadge(isClosed ? 'closed' : sv.status);
      html += '<span style="font-size:0.78rem;color:var(--warm-gray);margin-left:auto;">' + relativeTime(sv.createdAt) + '</span></div>';
      html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:' + (sv.closesAt ? '4px' : '10px') + ';">Question Set: ' + _esc(grp ? grp.name : (sv.groupId || 'none')) + '</div>';
      if (sv.closesAt) { html += '<div style="font-size:0.85rem;color:' + (isClosed ? 'var(--danger)' : 'var(--warm-gray)') + ';margin-bottom:10px;">' + (isClosed ? 'Closed ' : 'Closes ') + relativeTime(sv.closesAt) + '</div>'; }
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
      html += '<button class="btn btn-primary btn-small" onclick="csSendLink(\'' + _esc(sv.id) + '\')">Send Survey</button>';
      html += '<button class="btn btn-secondary btn-small" onclick="csPreviewSurvey(\'' + _esc(sv.id) + '\')">Preview</button>';
      html += '<button class="btn btn-secondary btn-small" onclick="csEditSurvey(\'' + _esc(sv.id) + '\')">Edit</button>';
      html += '<button class="btn btn-danger btn-small" onclick="csDeleteSurvey(\'' + _esc(sv.id) + '\')">Delete</button></div></div>';
    });
    return html + '</div>';
  }

  function renderSurveyForm(sv) {
    var isEdit = !!sv, id = isEdit ? _esc(sv.id) : '', statusVal = isEdit ? (sv.status || 'draft') : 'draft';
    var html = '<div style="border:2px solid var(--amber-light);border-radius:10px;padding:16px;background:var(--surface-card);margin-bottom:12px;">';
    html += '<h4 style="margin:0 0 12px;">' + (isEdit ? 'Edit Survey' : 'New Survey') + '</h4>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Name *</label>';
    html += '<input id="csSvName" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(sv.name || '') : '') + '" placeholder="Survey name"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Question Set *</label>';
    html += '<select id="csSvGroup" class="form-select" style="width:100%;"><option value="">— select question set —</option>';
    Object.values(groupsData).forEach(function (g) { html += '<option value="' + _esc(g.id) + '"' + (isEdit && sv.groupId === g.id ? ' selected' : '') + '>' + _esc(g.name) + '</option>'; });
    html += '</select></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Status</label>';
    html += '<select id="csSvStatus" class="form-select" style="width:100%;">';
    ['draft','active','inactive'].forEach(function (s) { html += '<option value="' + s + '"' + (statusVal === s ? ' selected' : '') + '>' + s + '</option>'; });
    html += '</select></div>';
    var closesAtVal = isEdit && sv.closesAt ? sv.closesAt.substring(0, 16) : '';
    html += '<div style="margin-bottom:12px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Closes at <span style="font-weight:400;color:var(--warm-gray);">(optional)</span></label>';
    html += '<input id="csSvClosesAt" type="datetime-local" class="form-input" style="width:100%;box-sizing:border-box;" value="' + closesAtVal + '"></div>';
    html += '<div style="display:flex;gap:8px;"><button class="btn btn-primary btn-small" onclick="csSaveSurvey(\'' + id + '\')">' + (isEdit ? 'Save' : 'Create') + '</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="csCancelSurvey()">Cancel</button></div></div>';
    return html;
  }

  async function saveSurvey(id) {
    var name = ((document.getElementById('csSvName') || {}).value || '').trim();
    var groupId = (document.getElementById('csSvGroup') || {}).value || '';
    var status = (document.getElementById('csSvStatus') || {}).value || 'draft';
    var closesAtRaw = ((document.getElementById('csSvClosesAt') || {}).value || '').trim();
    var closesAt = closesAtRaw ? new Date(closesAtRaw).toISOString() : null;
    try {
      await window.CsSurveysBridge.saveSurvey(id || null, { name: name, groupId: groupId, status: status, closesAt: closesAt });
      if (id) { surveyEditId = null; showToast('Survey updated'); }
      else { showAddSurvey = false; showToast('Survey created'); }
      renderSurveys();
    } catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function deleteSurvey(id) {
    if (!confirm('Delete this survey? Existing responses will remain.')) return;
    try { await window.CsSurveysBridge.deleteSurvey(id); showToast('Survey deleted'); renderSurveys(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function sendSurveyLink() {
    var email = ((document.getElementById('csSendEmail') || {}).value || '').trim();
    var contactName = ((document.getElementById('csSendName') || {}).value || '').trim();
    if (!email) { showToast('Email is required', true); return; }
    try {
      var fn = firebase.functions().httpsCallable('generateSurveyLink');
      await fn({ tenantId: window.TENANT_ID, surveyId: sendLinkSurveyId, contactEmail: email, contactName: contactName || null });
      sendLinkSurveyId = null; showToast('Survey invite sent!'); renderSurveys();
    } catch (err) { showToast('Failed to send: ' + (err && err.message), true); }
  }

  // ── Build 7-BulkSend ─────────────────────────────────────────────────
  // Send a survey to all members of a saved segment. Client-side
  // orchestration: resolves segment members, then iterates calling the
  // existing generateSurveyLink CF per recipient with a small delay
  // between calls to protect email-send rate. Capped at 25 per send to
  // bound modal latency; larger segments can re-run after the initial
  // batch (the CF dedupes by responseId/token so re-sends to already-
  // invited customers are fine).
  //
  // Mirrors the segment-filter shape from customers.js so the count
  // matches what Maya saw when she saved the segment.

  var SEND_BATCH_CAP = 25;
  var SEND_DELAY_MS = 200;

  function csLoadSendSegments() {
    if (sendSegmentsLoaded) return Promise.resolve();
    // Load saved segments AND the wholesale-authorized map in parallel. The
    // map backs `wholesale`/`retail` segment keys; without it those keys can't
    // be evaluated and the shared predicate fails safe (excludes) rather than
    // over-including (D4-005). Mirrors customers.js' loadCustomers().
    return Promise.all([
      MastDB.query('admin/customerSegments').once(),
      MastDB.get('admin/wholesaleAuthorized').catch(function () { return null; })
    ])
      .then(function (results) {
        var s = results[0];
        sendSegmentsData = (s && s.val && s.val()) || (s || {});
        var ws = results[1];
        var wsVal = (ws && ws.val && ws.val()) || (ws || {});
        sendWholesaleResolver = window.MastCustomerFilters.makeWholesaleResolver(wsVal);
        sendSegmentsLoaded = true;
        renderSurveys();
      })
      .catch(function (err) {
        console.warn('[cs-send-segments]', err && err.message);
        sendSegmentsData = {};
        sendWholesaleResolver = window.MastCustomerFilters.makeWholesaleResolver({});
        sendSegmentsLoaded = true;
        renderSurveys();
      });
  }

  // Resolve a saved segment's members via the SINGLE canonical predicate
  // (shared/customer-filters.js). This replaced a hand-synced "minimal mirror"
  // that had drifted — it ignored the wholesale/search/newsletterOnly/leadsOnly
  // keys, so segments saved with those resolved a wider set and surveys went to
  // customers outside the segment (review D4-005). excludeArchived:true keeps the
  // survey flow from inviting archived customers (the original mirror's behavior).
  function csCustomerMatches(c, f) {
    return window.MastCustomerFilters.matches(c, f, {
      isWholesale: sendWholesaleResolver,
      excludeArchived: true
    });
  }

  function csResolveSegmentMembers(segmentId) {
    var seg = sendSegmentsData[segmentId];
    if (!seg) return Promise.resolve([]);
    return MastDB.query('admin/customers').once()
      .then(function (s) {
        var all = (s && s.val && s.val()) || (s || {});
        var matches = [];
        Object.keys(all).forEach(function (cid) {
          var c = all[cid];
          if (!c) return;
          if (csCustomerMatches(c, seg.filters || {})) {
            var email = c.primaryEmail || (c.emails || [])[0];
            if (email) matches.push({ customerId: cid, email: email, name: c.displayName || null });
          }
        });
        return matches;
      })
      .catch(function () { return []; });
  }

  function csSendSetMode(m) {
    sendMode = m;
    sendSegmentId = null;
    sendSegmentMembersCount = null;
    renderSurveys();
    if (m === 'segment' && !sendSegmentsLoaded) csLoadSendSegments();
  }

  function csSendSetSegment(segmentId) {
    sendSegmentId = segmentId || null;
    sendSegmentMembersCount = null;
    renderSurveys();
    if (sendSegmentId) {
      csResolveSegmentMembers(sendSegmentId).then(function (members) {
        if (sendSegmentId !== segmentId) return; // changed mid-flight
        sendSegmentMembersCount = members.length;
        renderSurveys();
      });
    }
  }

  async function csSendLinkSegmentSubmit() {
    if (!sendLinkSurveyId || !sendSegmentId) return;
    var members = await csResolveSegmentMembers(sendSegmentId);
    if (members.length === 0) {
      showToast('No recipients matched the segment.', true);
      return;
    }
    var batch = members.slice(0, SEND_BATCH_CAP);
    sendInProgress = true;
    sendProgress = { total: batch.length, sent: 0, failed: 0, currentEmail: null };
    renderSurveys();

    var fn = firebase.functions().httpsCallable('generateSurveyLink');
    for (var i = 0; i < batch.length; i++) {
      var m = batch[i];
      sendProgress.currentEmail = m.email;
      renderSurveys();
      try {
        await fn({ tenantId: window.TENANT_ID, surveyId: sendLinkSurveyId, contactEmail: m.email, contactName: m.name });
        sendProgress.sent++;
      } catch (e) {
        console.warn('[csBulkSend]', m.email, e && e.message);
        sendProgress.failed++;
      }
      renderSurveys();
      if (i < batch.length - 1) {
        await new Promise(function (r) { setTimeout(r, SEND_DELAY_MS); });
      }
    }

    sendInProgress = false;
    var summary = 'Sent ' + sendProgress.sent + ' of ' + MastFormat.countNoun(sendProgress.total, 'invite');
    if (sendProgress.failed > 0) summary += ' (' + sendProgress.failed + ' failed)';
    if (members.length > SEND_BATCH_CAP) {
      summary += ' · ' + (members.length - SEND_BATCH_CAP) + ' more left in segment — re-run to send next batch';
    }
    showToast(summary);
    sendLinkSurveyId = null;
    sendMode = 'one';
    sendSegmentId = null;
    sendSegmentMembersCount = null;
    sendProgress = null;
    renderSurveys();
  }

  async function previewSurvey(surveyId) {
    try {
      showToast('Generating preview…');
      var fn = firebase.functions().httpsCallable('generateSurveyLink');
      var result = await fn({ tenantId: window.TENANT_ID, surveyId: surveyId, preview: true });
      var url = result && result.data && result.data.surveyUrl;
      if (!url) { showToast('Preview failed: no URL returned', true); return; }
      window.open(url, '_blank');
    } catch (err) { showToast('Preview failed: ' + (err && err.message), true); }
  }

  function renderTriggersTab() {
    var items = Object.values(triggersData).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1; });
    var html = showAddTrigger ? renderTriggerForm(null) : '<button class="btn btn-primary btn-small" onclick="csShowAddTrigger()" style="margin-bottom:14px;">+ Add Trigger</button>';
    if (!items.length && !showAddTrigger) return html + '<div style="padding:24px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No triggers yet.</div>';
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    items.forEach(function (t) {
      if (triggerEditId === t.id) { html += renderTriggerForm(t); return; }
      var sv = surveysDefData[t.surveyId], isActive = t.isActive !== false;
      html += '<div style="border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;background:var(--surface-card);display:flex;align-items:center;gap:10px;">';
      html += '<div style="flex:1;"><span style="font-weight:600;">' + _esc(t.eventType) + '</span>';
      html += '<span style="margin-left:8px;font-size:0.85rem;color:var(--warm-gray);">→ ' + _esc(sv ? sv.name : (t.surveyId || '—')) + '</span>';
      if (t.delayHours) html += '<span style="margin-left:8px;font-size:0.78rem;color:var(--warm-gray);">' + _esc(String(t.delayHours)) + 'h delay</span>';
      html += '</div>';
      html += '<span style="background:' + (isActive ? 'rgba(42,124,111,0.15)' : 'rgba(0,0,0,0.10)') + ';color:' + (isActive ? 'var(--teal)' : 'var(--warm-gray)') + ';padding:2px 10px;border-radius:12px;font-size:0.78rem;">' + (isActive ? 'active' : 'inactive') + '</span>';
      html += '<button class="btn btn-secondary btn-small" onclick="csEditTrigger(\'' + _esc(t.id) + '\')">Edit</button>';
      html += '<button class="btn btn-danger btn-small" onclick="csDeleteTrigger(\'' + _esc(t.id) + '\')">Delete</button></div>';
    });
    return html + '</div>';
  }

  // ── Build 7-Responses ────────────────────────────────────────────────
  // Survey responses viewer. Surveys are created server-side (CF
  // generateSurveyLink + _fireSingleSurveyTrigger) and written to
  // cs_survey_responses/{id}. The admin module never had a UI to read
  // them — Maya's flow E was ❌ in the persona walk because of that.
  //
  // Renders responses with filters by survey / status / theme tag, plus
  // an inline theme-tag editor that writes via direct MastDB (mirroring
  // server-side cs_tag_response_theme normalization: lowercase, dedupe,
  // 16-tag cap).

  function loadResponses() {
    return MastDB.query('cs_survey_responses').orderByChild('createdAt').limitToLast(500).once()
      .then(function (d) { responsesData = (d && d.val && d.val()) || (d || {}); responsesLoaded = true; })
      .catch(function (err) {
        console.warn('[cs-responses]', err && err.message);
        if (typeof showToast === 'function') showToast('Failed to load survey responses', true);
        responsesData = {}; responsesLoaded = true;
      });
  }

  function csResponseAnswerSummary(resp) {
    if (!resp || !Array.isArray(resp.answers) || resp.answers.length === 0) return '<span style="color:var(--warm-gray-light);">No answers yet</span>';
    return resp.answers.map(function (a) {
      var label = a.questionText || a.questionId || '(question)';
      var val = a.value;
      if (val == null) return '<div style="font-size:0.85rem;color:var(--warm-gray);">' + _esc(label) + ': —</div>';
      var rendered = (typeof val === 'object') ? JSON.stringify(val) : String(val);
      if (rendered.length > 200) rendered = rendered.slice(0, 197) + '…';
      return '<div style="font-size:0.85rem;margin-bottom:4px;"><span style="color:var(--warm-gray);">' + _esc(label) + ':</span> ' + _esc(rendered) + '</div>';
    }).join('');
  }

  function csResponseThemeChips(resp) {
    var tags = Array.isArray(resp.themeTags) ? resp.themeTags : [];
    if (tags.length === 0) return '<span style="color:var(--warm-gray-light);font-size:0.78rem;">— no themes —</span>';
    return tags.map(function (t) {
      return '<span class="status-badge" style="background:rgba(168,85,247,0.20);color:#c8a8f5;margin-right:4px;">' + _esc(t) + '</span>';
    }).join('');
  }

  function renderResponsesTab() {
    if (!responsesLoaded) {
      loadResponses().then(function () { if (surveysSubTab === 'responses') renderSurveys(); });
      return '<div style="padding:32px;text-align:center;color:var(--warm-gray);">Loading responses…</div>';
    }
    var all = Object.values(responsesData);

    // Build filter inputs
    var surveyOpts = [{ id: 'all', name: 'All surveys' }].concat(
      Object.values(surveysDefData).map(function (s) { return { id: s.id, name: s.name || s.id }; })
    );
    var statusOpts = ['all', 'pending', 'completed', 'preview'];

    // Collect all theme tags currently in use
    var allTags = {};
    all.forEach(function (r) {
      (Array.isArray(r.themeTags) ? r.themeTags : []).forEach(function (t) { if (t) allTags[t] = (allTags[t] || 0) + 1; });
    });
    var themeOptsList = Object.keys(allTags).sort();

    // Filter
    var filtered = all.filter(function (r) {
      if (!r) return false;
      if (responsesFilter.surveyId !== 'all' && r.surveyId !== responsesFilter.surveyId) return false;
      if (responsesFilter.status !== 'all' && (r.status || 'pending') !== responsesFilter.status) return false;
      if (responsesFilter.theme !== 'all') {
        var tags = Array.isArray(r.themeTags) ? r.themeTags : [];
        if (tags.indexOf(responsesFilter.theme) === -1) return false;
      }
      return true;
    });
    filtered.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

    // Aggregates panel — top 5 themes + total response count + completion rate
    var totalCount = all.length;
    var completedCount = all.filter(function (r) { return (r.status || 'pending') === 'completed'; }).length;
    var topThemes = Object.keys(allTags)
      .map(function (t) { return { tag: t, count: allTags[t] }; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 5);

    var html = '';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px;">';
    html += '<div style="font-size:0.85rem;">' +
      _esc(String(filtered.length)) + ' of ' + _esc(String(totalCount)) + ' ' + MastFormat.plural(totalCount, 'response') + ' · ' +
      _esc(String(completedCount)) + ' completed' +
      // Build 9 — VoC digest button
      ' · <a href="#" onclick="event.preventDefault();csGenerateVocDigest();" style="color:var(--teal);text-decoration:underline;">✨ Generate VoC digest</a>' +
      '</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
    html += '<label style="font-size:0.78rem;color:var(--warm-gray);">Survey ';
    html += '<select onchange="csResponsesSetFilter(\'surveyId\', this.value)" style="font-size:0.78rem;padding:3px 8px;border-radius:4px;">';
    surveyOpts.forEach(function (s) {
      html += '<option value="' + _esc(s.id) + '"' + (responsesFilter.surveyId === s.id ? ' selected' : '') + '>' + _esc(s.name) + '</option>';
    });
    html += '</select></label>';
    html += '<label style="font-size:0.78rem;color:var(--warm-gray);">Status ';
    html += '<select onchange="csResponsesSetFilter(\'status\', this.value)" style="font-size:0.78rem;padding:3px 8px;border-radius:4px;">';
    statusOpts.forEach(function (s) {
      html += '<option value="' + _esc(s) + '"' + (responsesFilter.status === s ? ' selected' : '') + '>' + _esc(s === 'all' ? 'All' : s) + '</option>';
    });
    html += '</select></label>';
    if (themeOptsList.length > 0) {
      html += '<label style="font-size:0.78rem;color:var(--warm-gray);">Theme ';
      html += '<select onchange="csResponsesSetFilter(\'theme\', this.value)" style="font-size:0.78rem;padding:3px 8px;border-radius:4px;">';
      html += '<option value="all"' + (responsesFilter.theme === 'all' ? ' selected' : '') + '>All</option>';
      themeOptsList.forEach(function (t) {
        html += '<option value="' + _esc(t) + '"' + (responsesFilter.theme === t ? ' selected' : '') + '>' + _esc(t) + ' (' + allTags[t] + ')</option>';
      });
      html += '</select></label>';
    }
    html += '</div></div>';

    // Top themes aggregate
    if (topThemes.length > 0) {
      html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
      html += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;">Top themes</div>';
      topThemes.forEach(function (tt) {
        html += '<span class="status-badge" style="background:rgba(168,85,247,0.20);color:#c8a8f5;cursor:pointer;" onclick="csResponsesSetFilter(\'theme\',\'' + _esc(tt.tag) + '\')">' + _esc(tt.tag) + ' · ' + tt.count + '</span>';
      });
      html += '</div>';
    }

    if (filtered.length === 0) {
      html += '<div style="padding:40px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No responses match these filters.</div>';
      return html;
    }

    filtered.forEach(function (r) {
      var survey = surveysDefData[r.surveyId];
      var surveyName = (survey && survey.name) || r.surveyId || '(unknown survey)';
      var who = r.contactName ? (r.contactName + ' (' + (r.contactEmail || '—') + ')') : (r.contactEmail || '(anonymous)');
      var statusColor = r.status === 'completed' ? '#7ddca0' : (r.status === 'preview' ? '#a5a8f5' : '#fbcc70');
      html += '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:14px 16px;margin-bottom:10px;background:var(--surface-card);">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:8px;">';
      html += '<div style="flex:1;min-width:200px;"><div style="font-weight:600;">' + _esc(surveyName) + '</div>';
      html += '<div style="font-size:0.78rem;color:var(--warm-gray);">from ' + _esc(who) + ' · ' + _esc(fmtDate(r.createdAt)) + (r.completedAt ? ' · completed ' + _esc(fmtDate(r.completedAt)) : '') + '</div></div>';
      html += '<span class="status-badge" style="background:' + statusColor + '22;color:' + statusColor + ';border:1px solid ' + statusColor + '44;">' + _esc(r.status || 'pending') + '</span>';
      html += '</div>';
      html += '<div style="margin-bottom:8px;">' + csResponseAnswerSummary(r) + '</div>';

      html += '<div style="border-top:1px solid var(--cream-dark);padding-top:8px;margin-top:8px;display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;">';
      html += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;line-height:1.6;">Themes</div>';
      if (responsesEditingThemeId === r.id) {
        var tagStr = (Array.isArray(r.themeTags) ? r.themeTags : []).join(', ');
        html += '<input id="csRespThemeInput-' + _esc(r.id) + '" value="' + _esc(tagStr) + '" placeholder="comma-separated tags" ' +
          'style="flex:1;min-width:240px;font-size:0.85rem;padding:4px 8px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--bg);color:var(--text);">';
        html += '<button class="btn btn-primary btn-small" onclick="csSaveResponseTheme(\'' + _esc(r.id) + '\')" style="padding:4px 10px;font-size:0.78rem;">Save</button>';
        html += '<button class="btn btn-secondary btn-small" onclick="csCancelResponseTheme()" style="padding:4px 10px;font-size:0.78rem;">Cancel</button>';
      } else {
        html += '<div style="flex:1;min-width:200px;">' + csResponseThemeChips(r) + '</div>';
        html += '<button class="btn btn-secondary btn-small" onclick="csEditResponseTheme(\'' + _esc(r.id) + '\')" style="padding:4px 10px;font-size:0.78rem;">Edit themes</button>';
      }
      html += '</div>';

      if (r.followupTicketId) {
        html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:6px;">Linked ticket: <a href="#cs-tickets" onclick="event.preventDefault();csOpenTicket(\'' + _esc(r.followupTicketId) + '\')" style="color:var(--teal);text-decoration:underline;">' + _esc(r.followupTicketId) + '</a></div>';
      }
      html += '</div>';
    });

    return html;
  }

  function csResponsesSetFilter(key, value) {
    responsesFilter[key] = value;
    renderSurveys();
  }

  function csEditResponseTheme(id) {
    responsesEditingThemeId = id;
    renderSurveys();
    setTimeout(function () {
      var el = document.getElementById('csRespThemeInput-' + id);
      if (el) el.focus();
    }, 30);
  }

  function csCancelResponseTheme() {
    responsesEditingThemeId = null;
    renderSurveys();
  }

  async function csSaveResponseTheme(id) {
    var input = document.getElementById('csRespThemeInput-' + id);
    if (!input) return;
    try {
      // Delegate to the shared normalization core (lowercase/dedupe/16-cap).
      var cleaned = await window.CsSurveysBridge.setResponseThemes(id, input.value || '');
      responsesEditingThemeId = null;
      if (typeof showToast === 'function') showToast('Themes saved (' + cleaned.length + ').');
      renderSurveys();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to save themes: ' + (err && err.message), true);
    }
  }

  // Build 9 — Voice of Customer digest. Mirrors server-side
  // cs_generate_voc_digest: aggregates themes (with sample quotes) +
  // ticket categories + reviews summary + customer-health counts into
  // a copy-paste-ready markdown digest. Window: last 30 days.
  async function csGenerateVocDigest(windowDays) {
    var days = Number(windowDays) > 0 ? Number(windowDays) : 30;
    var windowLabel = days === 365 ? 'Last 12 months' : 'Last ' + days + ' days';
    var existing = document.getElementById('csVocDigestOverlay');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var overlay = document.createElement('div');
    overlay.id = 'csVocDigestOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = '<div style="background:var(--bg);border-radius:12px;padding:24px;color:var(--text);">Generating digest…</div>';
    document.body.appendChild(overlay);

    var cutoff = new Date(Date.now() - days * 86400000).toISOString();
    try {
      var results = await Promise.all([
        responsesLoaded ? Promise.resolve(responsesData) : loadResponses().then(function() { return responsesData; }),
        MastDB.query('cs_tickets').limitToLast(2000).once().then(function(s) { return (s && s.val && s.val()) || (s || {}); }).catch(function() { return {}; }),
        MastDB.query('cs_reviews').limitToLast(500).once().then(function(s) { return (s && s.val && s.val()) || (s || {}); }).catch(function() { return {}; }),
        MastDB.get('admin/customers').then(function(s) { return (s && s.val && s.val()) || (s || {}); }).catch(function() { return {}; }),
        (MastDB.products && MastDB.products.get) ? MastDB.products.get().then(function(s) { return (s && s.val && s.val()) || (s || {}); }).catch(function() { return {}; }) : Promise.resolve({})
      ]);
      var responses = results[0] || {};
      var tickets = results[1] || {};
      var reviews = results[2] || {};
      var customers = results[3] || {};
      var productsMap = results[4] || {};

      // Themes
      var themeAgg = {};
      var totalResp = 0, completedResp = 0;
      Object.values(responses).forEach(function(r) {
        if (!r || (r.createdAt || '') < cutoff) return;
        totalResp++;
        if (r.status === 'completed') completedResp++;
        var tags = Array.isArray(r.themeTags) ? r.themeTags : [];
        if (tags.length === 0) return;
        var openText = null;
        if (Array.isArray(r.answers)) {
          for (var i = 0; i < r.answers.length; i++) {
            var a = r.answers[i];
            if (a && typeof a.value === 'string' && a.value.trim().length > 0) {
              openText = a.value.length > 200 ? a.value.slice(0, 197) + '…' : a.value;
              break;
            }
          }
        }
        tags.forEach(function(t) {
          var key = String(t || '').trim().toLowerCase();
          if (!key) return;
          if (!themeAgg[key]) themeAgg[key] = { count: 0, quotes: [] };
          themeAgg[key].count++;
          if (openText && themeAgg[key].quotes.length < 2) themeAgg[key].quotes.push(openText);
        });
      });
      var topThemes = Object.entries(themeAgg)
        .map(function(e) { return { tag: e[0], count: e[1].count, sampleQuotes: e[1].quotes }; })
        .sort(function(a, b) { return b.count - a.count; })
        .slice(0, 10);

      // Tickets
      var catAgg = {};
      var ticketsInWindow = 0, openTickets = 0;
      Object.values(tickets).forEach(function(t) {
        if (!t) return;
        var at = t.updatedAt || t.createdAt;
        if ((at || '') < cutoff) return;
        ticketsInWindow++;
        if (t.status === 'open' || t.status === 'in_progress' || t.status === 'waiting') openTickets++;
        var cat = t.category || 'uncategorized';
        catAgg[cat] = (catAgg[cat] || 0) + 1;
      });
      var ticketCats = Object.entries(catAgg)
        .map(function(e) { return { category: e[0], count: e[1] }; })
        .sort(function(a, b) { return b.count - a.count; });

      // Reviews
      var revsInWindow = Object.values(reviews).filter(function(r) { return r && (r.createdAt || '') >= cutoff; });
      var ratings = revsInWindow.map(function(r) { return r.rating; }).filter(function(n) { return typeof n === 'number'; });
      var avgRating = ratings.length > 0 ? Math.round((ratings.reduce(function(s, n) { return s + n; }, 0) / ratings.length) * 100) / 100 : null;
      var prodMentions = {};
      revsInWindow.forEach(function(r) {
        if (!r.productId) return;
        if (!prodMentions[r.productId]) {
          var prodEntry = productsMap[r.productId];
          var resolvedName = r.productName
            || (prodEntry && prodEntry.name)
            || (r.productId.charAt(0) === '-' ? '(unnamed product)' : r.productId);
          prodMentions[r.productId] = { name: resolvedName, count: 0, ratings: [] };
        }
        prodMentions[r.productId].count++;
        if (typeof r.rating === 'number') prodMentions[r.productId].ratings.push(r.rating);
      });
      var topProds = Object.entries(prodMentions)
        .map(function(e) {
          var v = e[1];
          return { name: v.name, count: v.count, avg: v.ratings.length > 0 ? Math.round((v.ratings.reduce(function(s, n) { return s + n; }, 0) / v.ratings.length) * 100) / 100 : null };
        })
        .sort(function(a, b) { return b.count - a.count; })
        .slice(0, 5);

      // Customer health
      var atRisk = 0, lapsed = 0, active = 0, unknown = 0, totalCust = 0;
      Object.values(customers).forEach(function(c) {
        if (!c || c.status === 'merged' || c.status === 'archived') return;
        totalCust++;
        var s = (c.stats || {}).lapseStatus;
        if (s === 'at-risk') atRisk++;
        else if (s === 'lapsed') lapsed++;
        else if (s === 'active') active++;
        else unknown++;
      });

      // Build markdown
      var lines = [];
      lines.push('# Voice of Customer — ' + windowLabel);
      lines.push('*Generated ' + new Date().toISOString() + '*');
      lines.push('');
      lines.push('## Summary');
      lines.push('- **' + totalResp + '** survey responses (' + completedResp + ' completed)');
      lines.push('- **' + ticketsInWindow + '** support tickets (' + openTickets + ' still open)');
      lines.push('- **' + revsInWindow.length + '** reviews' + (avgRating != null ? ' · avg ' + avgRating.toFixed(2) + ' ★' : ''));
      lines.push('- **' + totalCust + '** active customers · ' + atRisk + ' at-risk · ' + lapsed + ' lapsed' + (unknown > 0 ? ' (' + unknown + ' with insufficient cadence signal)' : ''));
      lines.push('');
      if (topThemes.length > 0) {
        lines.push('## Top themes (from survey free-text)');
        topThemes.forEach(function(t, i) {
          lines.push((i + 1) + '. **' + t.tag + '** — ' + MastFormat.countNoun(t.count, 'response'));
          t.sampleQuotes.forEach(function(q) { lines.push('   > "' + q + '"'); });
        });
        lines.push('');
      }
      if (ticketCats.length > 0) {
        lines.push('## Ticket categories');
        ticketCats.forEach(function(c) { lines.push('- **' + c.category + '**: ' + c.count); });
        lines.push('');
      }
      if (topProds.length > 0) {
        lines.push('## Most-reviewed products');
        topProds.forEach(function(p) {
          lines.push('- **' + p.name + '** — ' + MastFormat.countNoun(p.count, 'review') + (p.avg != null ? ' · ' + p.avg.toFixed(2) + ' ★' : ''));
        });
        lines.push('');
      }
      if (atRisk + lapsed > 0) {
        lines.push('## Action items');
        if (atRisk > 0) lines.push('- **' + MastFormat.countNoun(atRisk, 'at-risk customer') + '** — reach out before cadence breaks fully');
        if (lapsed > 0) lines.push('- **' + MastFormat.countNoun(lapsed, 'lapsed customer') + '** — win-back outreach candidates');
      }
      var markdown = lines.join('\n');

      // Render modal
      var windowOptions = [
        { v: 7, label: 'Last 7 days' },
        { v: 30, label: 'Last 30 days' },
        { v: 60, label: 'Last 60 days' },
        { v: 90, label: 'Last 90 days' },
        { v: 180, label: 'Last 180 days' },
        { v: 365, label: 'Last 12 months' }
      ];
      var selectHtml = '<select id="csVocWindowSel" class="form-select" style="font-size:0.85rem;padding:4px 8px;" onchange="csGenerateVocDigest(this.value)">' +
        windowOptions.map(function(o) {
          return '<option value="' + o.v + '"' + (o.v === days ? ' selected' : '') + '>' + o.label + '</option>';
        }).join('') +
        '</select>';
      overlay.innerHTML =
        '<div style="background:var(--bg);border-radius:12px;padding:20px 22px;width:min(720px,94vw);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.4);">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;">' +
            '<h3 style="margin:0;font-size:1.15rem;">Voice of Customer · ' + windowLabel + '</h3>' +
            '<div style="display:flex;gap:8px;align-items:center;">' + selectHtml +
            '<button class="btn btn-secondary btn-small" onclick="csCloseVocDigest()" style="padding:4px 10px;">Close</button></div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
            '<button class="btn btn-primary btn-small" id="csVocCopyBtn" onclick="csCopyVocDigest()">📋 Copy markdown</button>' +
            '<button class="btn btn-secondary btn-small" onclick="csDownloadVocDigest()">⬇ Download .md</button>' +
          '</div>' +
          '<pre id="csVocDigestText" style="flex:1;overflow:auto;background:var(--surface-card);border:1px solid var(--cream-dark);border-radius:6px;padding:14px 16px;font-family:ui-monospace,Menlo,monospace;font-size:0.85rem;line-height:1.55;white-space:pre-wrap;color:var(--text);margin:0;"></pre>' +
        '</div>';
      var pre = document.getElementById('csVocDigestText');
      if (pre) pre.textContent = markdown;
      window.__csVocDigestMarkdown = markdown;
    } catch (err) {
      overlay.innerHTML = '<div style="background:var(--bg);border-radius:12px;padding:24px;color:var(--danger);">Failed to generate digest: ' + esc(err && err.message || String(err)) + '<br><br><button class="btn btn-secondary btn-small" onclick="csCloseVocDigest()">Close</button></div>';
    }
  }

  function csCloseVocDigest() {
    var ov = document.getElementById('csVocDigestOverlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    delete window.__csVocDigestMarkdown;
  }

  async function csCopyVocDigest() {
    var md = window.__csVocDigestMarkdown;
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      var btn = document.getElementById('csVocCopyBtn');
      if (btn) {
        var prev = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(function() { if (btn) btn.textContent = prev; }, 1500);
      }
    } catch (e) {
      showToast('Copy failed: ' + (e && e.message), true);
    }
  }

  function csDownloadVocDigest() {
    var md = window.__csVocDigestMarkdown;
    if (!md) return;
    MastExport.downloadBlob('voc-digest-' + new Date().toISOString().slice(0, 10) + '.md', md, 'text/markdown');
  }

  function csOpenTicket(ticketId) {
    if (!ticketId) return;
    selectedTicketId = ticketId;
    activeRoute = 'cs-tickets';
    if (typeof navigateTo === 'function') navigateTo('cs-tickets');
    setTimeout(function () { renderCurrentView(); }, 30);
  }

  function renderTriggerForm(t) {
    var isEdit = !!t, id = isEdit ? _esc(t.id) : '', isActive = isEdit ? (t.isActive !== false) : true;
    var html = '<div style="border:2px solid var(--amber-light);border-radius:10px;padding:16px;background:var(--surface-card);margin-bottom:12px;">';
    html += '<h4 style="margin:0 0 12px;">' + (isEdit ? 'Edit Trigger' : 'New Trigger') + '</h4>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Event Type *</label>';
    html += '<input id="csTEventType" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(t.eventType || '') : '') + '" placeholder="e.g. order_complete"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Survey *</label>';
    html += '<select id="csTSurveyId" class="form-select" style="width:100%;"><option value="">— select survey —</option>';
    Object.values(surveysDefData).forEach(function (sv) { html += '<option value="' + _esc(sv.id) + '"' + (isEdit && t.surveyId === sv.id ? ' selected' : '') + '>' + _esc(sv.name) + '</option>'; });
    html += '</select></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Delay (hours)</label>';
    html += '<input id="csTDelay" type="number" min="0" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(String(t.delayHours || 0)) : '0') + '"></div>';
    html += '<div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;"><input type="checkbox" id="csTActive"' + (isActive ? ' checked' : '') + '><label for="csTActive" style="font-size:0.9rem;">Active</label></div>';
    html += '<div style="display:flex;gap:8px;"><button class="btn btn-primary btn-small" onclick="csSaveTrigger(\'' + id + '\')">' + (isEdit ? 'Save' : 'Add') + '</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="csCancelTrigger()">Cancel</button></div></div>';
    return html;
  }

  async function saveTrigger(id) {
    var et = ((document.getElementById('csTEventType') || {}).value || '').trim();
    var svId = (document.getElementById('csTSurveyId') || {}).value || '';
    var delay = Number((document.getElementById('csTDelay') || {}).value) || 0;
    var active = !!((document.getElementById('csTActive') || {}).checked);
    try {
      // Delegate to the shared state-free core (single-sourced write shape).
      await window.CsSurveysBridge.saveTrigger(id || null, { eventType: et, surveyId: svId, delayHours: delay, isActive: active });
      if (id) { triggerEditId = null; showToast('Trigger updated'); }
      else { showAddTrigger = false; showToast('Trigger added'); }
      renderSurveys();
    } catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function deleteTrigger(id) {
    if (!confirm('Delete this trigger?')) return;
    try { await window.CsSurveysBridge.deleteTrigger(id); showToast('Trigger deleted'); renderSurveys(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }

  function renderFaqs() {
    var tab = document.getElementById('csFaqsTab');
    if (!tab) return;
    if (!policiesLoaded) { tab.innerHTML = '<div style="padding:40px;text-align:center;color:var(--warm-gray);">Loading FAQs…</div>'; return; }
    // D2 (2026-05-28): cs_policies is shared with the Sales → Policies route.
    // The CS surface owns kind='faq' rows (Q&A help content); rows tagged
    // kind='policy' are authored under Sales → Policies and hidden here.
    // For legacy rows missing `kind`, infer from slug (privacy/terms/cookie/
    // shipping-policy/return-policy etc. → policy; everything else → faq).
    // The Sales filter uses the same inference so each row shows exactly once.
    var _POLICY_SLUG_PATTERN = /(^|-)(privacy|terms|cookie|tos|t-c|shipping-policy|return-policy|security|ai-transparency|accessibility|gdpr|ccpa)(-|$)/;
    var items = Object.values(policiesData)
      .filter(function (p) {
        if (!p) return false;
        if (p.kind === 'faq') return true;
        if (p.kind === 'policy') return false;
        // No kind set — infer from slug.
        var s = (p.slug || '').toLowerCase();
        return !_POLICY_SLUG_PATTERN.test(s);
      })
      .sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; });
    var html = '<div style="padding:24px;">';
    html += '<div class="section-header" style="margin-bottom:14px;"><h2 style="margin:0;">FAQs</h2><button class="btn btn-secondary btn-small" onclick="csFaqsRefresh()">Refresh</button></div>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 14px;max-width:680px;">Common questions and your answers, shown on storefront and used by the AI helper. FAQs may reference your policies but don\'t create them — policies (Return / Privacy / T&amp;C / etc.) are authored under <a href="javascript:void(0)" onclick="navigateTo(\'terms\')" style="color:var(--teal);text-decoration:underline;">Sales → Policies</a>.</p>';
    html += showAddPolicy ? renderPolicyForm(null) : '<button class="btn btn-primary btn-small" onclick="csShowAddPolicy()" style="margin-bottom:14px;">+ New FAQ</button>';
    if (!items.length && !showAddPolicy) {
      html += '<div style="padding:24px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No FAQs yet. Create one to show on your storefront.</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:10px;">';
      items.forEach(function (p) {
        if (policyEditId === p.id) { html += renderPolicyForm(p); return; }
        html += '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:14px 16px;background:var(--surface-card);">';
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">';
        html += '<span style="font-weight:600;">' + _esc(p.name) + '</span>';
        html += '<span style="font-size:0.78rem;color:var(--warm-gray);font-family:monospace;">/' + _esc(p.slug || '') + '</span>';
        html += '<span style="margin-left:auto;background:' + (p.storefrontEnabled ? 'rgba(42,124,111,0.15)' : 'rgba(0,0,0,0.10)') + ';color:' + (p.storefrontEnabled ? 'var(--teal)' : 'var(--warm-gray)') + ';padding:2px 10px;border-radius:12px;font-size:0.78rem;">' + (p.storefrontEnabled ? 'live' : 'hidden') + '</span></div>';
        if (p.contentHtml) { var preview = p.contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:10px;">' + _esc(preview) + (preview.length === 100 ? '…' : '') + '</div>'; }
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
        html += '<button class="btn btn-secondary btn-small" onclick="csTogglePolicyStorefront(\'' + _esc(p.id) + '\',' + (p.storefrontEnabled ? 'false' : 'true') + ')">' + (p.storefrontEnabled ? 'Hide from Storefront' : 'Show on Storefront') + '</button>';
        html += '<button class="btn btn-secondary btn-small" onclick="csEditPolicy(\'' + _esc(p.id) + '\')">Edit</button>';
        html += '<button class="btn btn-danger btn-small" onclick="csDeletePolicy(\'' + _esc(p.id) + '\')">Delete</button></div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    tab.innerHTML = html;
  }

  function renderPolicyForm(p) {
    var isEdit = !!p, id = isEdit ? _esc(p.id) : '';
    // D2: form repurposed for FAQ Q&A. `name` carries the question; the
    // existing `contentHtml` field carries the answer. `question` and
    // `answer` are also persisted as canonical fields going forward; old
    // rows continue to read from name/contentHtml.
    var q = isEdit ? _esc(p.question || p.name || '') : '';
    var a = isEdit ? _esc(p.answer || p.contentHtml || '') : '';
    var html = '<div style="border:2px solid var(--amber-light);border-radius:10px;padding:16px;background:var(--surface-card);margin-bottom:12px;">';
    html += '<h4 style="margin:0 0 12px;">' + (isEdit ? 'Edit FAQ' : 'New FAQ') + '</h4>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Question *</label>';
    html += '<input id="csPName" class="form-input" style="width:100%;box-sizing:border-box;" value="' + q + '" placeholder="e.g. Do you accept returns on custom commissions?" oninput="csAutofillPolicySlug(this.value,' + (isEdit ? 'false' : 'true') + ')"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Slug</label>';
    html += '<input id="csPSlug" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(p.slug || '') : '') + '" placeholder="returns-on-commissions"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:4px;">Answer</label>';
    html += '<textarea id="csPContent" class="form-input" rows="6" style="width:100%;box-sizing:border-box;font-family:inherit;font-size:0.9rem;" placeholder="Your answer. May reference your policy — e.g. &quot;Custom commissions are final sale, per our Return Policy.&quot;">' + a + '</textarea></div>';
    html += '<div style="margin-bottom:14px;display:flex;align-items:center;gap:8px;"><input type="checkbox" id="csPStorefront"' + (isEdit && p.storefrontEnabled ? ' checked' : '') + '><label for="csPStorefront" style="font-size:0.9rem;cursor:pointer;">Show on storefront</label></div>';
    html += '<div style="display:flex;gap:8px;"><button class="btn btn-primary btn-small" onclick="csSavePolicy(\'' + id + '\')">' + (isEdit ? 'Save' : 'Create') + '</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="csCancelPolicy()">Cancel</button></div></div>';
    return html;
  }

  async function savePolicy(id) {
    var name = ((document.getElementById('csPName') || {}).value || '').trim();
    var slug = ((document.getElementById('csPSlug') || {}).value || '').trim();
    var content = (document.getElementById('csPContent') || {}).value || '';
    var sf = !!((document.getElementById('csPStorefront') || {}).checked);
    if (!name) { showToast('Question is required', true); return; }
    var slugVal = slug || MastUtil.slugify(name);
    // D2: persist canonical question/answer fields alongside name/contentHtml
    // for backward compat. New rows tagged kind='faq' so they stay on the CS
    // surface; Sales → Policies route filters to kind='policy'.
    var patch = {
      name: name, slug: slugVal, contentHtml: content,
      question: name, answer: content,
      kind: 'faq',
      storefrontEnabled: sf, updatedAt: nowIso()
    };
    try {
      if (id) {
        await MastDB.update('cs_policies/' + id, patch);
        if (policiesData[id]) Object.assign(policiesData[id], patch);
        policyEditId = null; showToast('FAQ updated');
      } else {
        var nk = MastDB.newKey('cs_policies');
        var doc = Object.assign({ id: nk, createdAt: nowIso() }, patch);
        await MastDB.set('cs_policies/' + nk, doc);
        policiesData[nk] = doc;
        showAddPolicy = false; showToast('FAQ created');
      }
      renderFaqs();
    } catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function togglePolicyStorefront(id, enabled) {
    try { await MastDB.update('cs_policies/' + id, { storefrontEnabled: enabled, updatedAt: nowIso() }); if (policiesData[id]) policiesData[id].storefrontEnabled = enabled; showToast(enabled ? 'Policy now live on storefront' : 'Policy hidden from storefront'); renderFaqs(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function deletePolicy(id) {
    if (!confirm('Delete this policy? This cannot be undone.')) return;
    try { await MastDB.remove('cs_policies/' + id); delete policiesData[id]; showToast('Policy deleted'); renderFaqs(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }

  // ============================================================
  // Session F — Members
  // ============================================================

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    return Math.round((target - now) / (1000 * 60 * 60 * 24));
  }

  function daysRemainingHtml(dateStr) {
    var d = daysUntil(dateStr);
    if (d === null) return '<span style="color:var(--warm-gray);">—</span>';
    var color = d <= 7 ? 'var(--danger)' : (d <= 30 ? 'var(--amber-light)' : 'var(--teal)');
    var label = d < 0 ? (Math.abs(d) + 'd ago') : (d + 'd');
    return '<span style="color:' + color + ';font-weight:600;">' + label + '</span>';
  }

  function memberPaymentBadge(paymentStatus) {
    if (paymentStatus === 'failed') {
      return '<span style="color:var(--danger);font-weight:600;">Failed ⚠️</span>';
    }
    return '<span style="color:var(--warm-gray);">Current</span>';
  }

  async function loadMembersData() {
    if (membersLoading) return;
    membersLoading = true;
    var base = 'tenants/' + MastDB.tenantId() + '/customers';
    try {
      var db = firebase.firestore();

      // At-risk: cancelled members
      var cancelledSnap = await db.collection(base)
        .where('membership.status', '==', 'cancelled')
        .orderBy('membership.expiryDate', 'asc')
        .limit(50)
        .get();

      // At-risk: failed payment members
      var failedSnap = await db.collection(base)
        .where('membership.paymentStatus', '==', 'failed')
        .limit(50)
        .get();

      // Merge and deduplicate by uid
      var merged = {};
      cancelledSnap.forEach(function(doc) {
        merged[doc.id] = Object.assign({ uid: doc.id }, doc.data());
      });
      failedSnap.forEach(function(doc) {
        if (!merged[doc.id]) merged[doc.id] = Object.assign({ uid: doc.id }, doc.data());
      });
      membersAtRiskData = Object.values(merged);
      membersAtRiskData.sort(function(a, b) {
        var da = (a.membership && a.membership.expiryDate) || '';
        var db2 = (b.membership && b.membership.expiryDate) || '';
        return da < db2 ? -1 : da > db2 ? 1 : 0;
      });

      // All active members
      var activeSnap = await db.collection(base)
        .where('membership.status', '==', 'active')
        .orderBy('membership.renewalDate', 'asc')
        .limit(100)
        .get();
      membersActiveData = [];
      activeSnap.forEach(function(doc) {
        membersActiveData.push(Object.assign({ uid: doc.id }, doc.data()));
      });
    } catch (err) {
      console.error('[cs-members] loadMembersData:', err);
      if (typeof showToast === 'function') showToast('Failed to load members.', true);
      if (!membersAtRiskData) membersAtRiskData = [];
      if (!membersActiveData) membersActiveData = [];
    } finally {
      membersLoading = false;
    }
  }

  function renderMembers() {
    var tab = document.getElementById('csMembersTab');
    if (!tab) return;

    var loaded = membersAtRiskData !== null && membersActiveData !== null;

    if (!loaded) {
      tab.innerHTML = '<div style="padding:40px;text-align:center;color:var(--warm-gray);">Loading members…</div>';
      return;
    }

    var html = '<div style="padding:24px;">';
    html += '<div class="section-header" style="margin-bottom:14px;">';
    html += '<h2 style="margin:0;">Members</h2>';
    html += '<button class="btn btn-secondary btn-small" onclick="csMembersRefresh()">Refresh</button>';
    html += '</div>';

    // Sub-tab bar (pill style matching cs-surveys pattern)
    html += '<div class="view-tabs" style="margin-bottom:18px;">';
    html += '<button class="view-tab' + (membersSubTab === 'at-risk' ? ' active' : '') + '" onclick="csMembersSetTab(\'at-risk\')">At Risk</button>';
    html += '<button class="view-tab' + (membersSubTab === 'all-active' ? ' active' : '') + '" onclick="csMembersSetTab(\'all-active\')">All Active</button>';
    html += '</div>';

    if (membersSubTab === 'at-risk') {
      html += renderMembersAtRisk();
    } else {
      html += renderMembersAllActive();
    }

    html += '</div>';
    tab.innerHTML = html;
  }

  function renderMembersAtRisk() {
    var rows = membersAtRiskData || [];
    if (!rows.length) {
      return '<div style="padding:32px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No members found.</div>';
    }

    var thStyle = 'padding:8px 12px;text-align:left;font-size:0.78rem;color:var(--warm-gray);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--cream-dark);white-space:nowrap;';
    var tdStyle = 'padding:9px 12px;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);';

    var html = '<div style="overflow-x:auto;">';
    html += '<table style="width:100%;border-collapse:collapse;background:var(--surface-card);border-radius:10px;overflow:hidden;border:1px solid var(--cream-dark);">';
    html += '<thead><tr>';
    html += '<th style="' + thStyle + '">Name / Email</th>';
    html += '<th style="' + thStyle + '">Plan</th>';
    html += '<th style="' + thStyle + '">Status</th>';
    html += '<th style="' + thStyle + '">Expiry Date</th>';
    html += '<th style="' + thStyle + '">Days Remaining</th>';
    html += '<th style="' + thStyle + '">Payment</th>';
    html += '<th style="' + thStyle + '"></th>';
    html += '</tr></thead>';
    html += '<tbody>';

    rows.forEach(function(r) {
      var m = r.membership || {};
      var name = _esc(r.displayName || r.name || '—');
      var email = _esc(r.email || '—');
      var plan = _esc(m.plan || '—');
      var status = _esc(m.status || '—');
      var expiryDate = _esc(m.expiryDate || '—');
      var emailRaw = r.email || '';

      html += '<tr>';
      html += '<td style="' + tdStyle + '">';
      html += '<div style="font-weight:500;">' + name + '</div>';
      html += '<div style="font-size:0.78rem;color:var(--warm-gray);">' + email + '</div>';
      html += '</td>';
      html += '<td style="' + tdStyle + '">' + plan + '</td>';
      html += '<td style="' + tdStyle + '">' + status + '</td>';
      html += '<td style="' + tdStyle + 'font-family:monospace;">' + expiryDate + '</td>';
      html += '<td style="' + tdStyle + '">' + daysRemainingHtml(m.expiryDate) + '</td>';
      html += '<td style="' + tdStyle + '">' + memberPaymentBadge(m.paymentStatus) + '</td>';
      html += '<td style="' + tdStyle + '">';
      if (emailRaw) {
        html += '<button class="btn btn-secondary btn-small" onclick="csMembersViewContact(' + JSON.stringify(_esc(emailRaw)) + ')">View Contact →</button>';
      }
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  function renderMembersAllActive() {
    var rows = membersActiveData || [];

    // KPI band
    var paymentIssues = rows.filter(function(r) { return r.membership && r.membership.paymentStatus === 'failed'; }).length;
    var today = new Date(); today.setHours(0,0,0,0);
    var in30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    var renewingSoon = rows.filter(function(r) {
      var rd = r.membership && r.membership.renewalDate ? new Date(r.membership.renewalDate) : null;
      return rd && rd >= today && rd <= in30;
    }).length;

    var html = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;">';
    html += kpiCard('Active Members', String(rows.length), 'current subscriptions');
    html += kpiCard('Payment Issues', String(paymentIssues), paymentIssues === 1 ? '1 failed' : paymentIssues + ' failed');
    html += kpiCard('Renewing in 30d', String(renewingSoon), 'upcoming renewals');
    html += '</div>';

    if (!rows.length) {
      html += '<div style="padding:32px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No members found.</div>';
      return html;
    }

    var thStyle = 'padding:8px 12px;text-align:left;font-size:0.78rem;color:var(--warm-gray);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--cream-dark);white-space:nowrap;';
    var tdStyle = 'padding:9px 12px;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);';

    html += '<div style="overflow-x:auto;">';
    html += '<table style="width:100%;border-collapse:collapse;background:var(--surface-card);border-radius:10px;overflow:hidden;border:1px solid var(--cream-dark);">';
    html += '<thead><tr>';
    html += '<th style="' + thStyle + '">Name / Email</th>';
    html += '<th style="' + thStyle + '">Plan</th>';
    html += '<th style="' + thStyle + '">Active Since</th>';
    html += '<th style="' + thStyle + '">Next Renewal</th>';
    html += '<th style="' + thStyle + '">Payment</th>';
    html += '<th style="' + thStyle + '"></th>';
    html += '</tr></thead>';
    html += '<tbody>';

    rows.forEach(function(r) {
      var m = r.membership || {};
      var name = _esc(r.displayName || r.name || '—');
      var email = _esc(r.email || '—');
      var plan = _esc(m.plan || '—');
      var activeSince = fmtDate(m.activeSince || r.createdAt || null);
      var renewalDate = _esc(m.renewalDate || '—');
      var emailRaw = r.email || '';

      html += '<tr>';
      html += '<td style="' + tdStyle + '">';
      html += '<div style="font-weight:500;">' + name + '</div>';
      html += '<div style="font-size:0.78rem;color:var(--warm-gray);">' + email + '</div>';
      html += '</td>';
      html += '<td style="' + tdStyle + '">' + plan + '</td>';
      html += '<td style="' + tdStyle + 'font-family:monospace;">' + _esc(activeSince) + '</td>';
      html += '<td style="' + tdStyle + 'font-family:monospace;">' + renewalDate + '</td>';
      html += '<td style="' + tdStyle + '">' + memberPaymentBadge(m.paymentStatus) + '</td>';
      html += '<td style="' + tdStyle + '">';
      if (emailRaw) {
        html += '<button class="btn btn-secondary btn-small" onclick="csMembersViewContact(' + JSON.stringify(_esc(emailRaw)) + ')">View Contact →</button>';
      }
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  window.csMembersRefresh = function() {
    membersAtRiskData = null;
    membersActiveData = null;
    renderMembers();
    loadMembersData().then(renderMembers);
  };
  window.csMembersSetTab = function(tab) {
    membersSubTab = tab;
    renderMembers();
  };
  window.csMembersViewContact = function(email) {
    if (typeof navigateTo === 'function') navigateTo('contacts', { email: email });
  };

  // Build 5b.2 — ticket → customer detail drill-in via MastNavStack.
  // Renders a link only when the ticket carries customerId (post-backfill).
  window.csOpenLinkedCustomer = function (customerId) {
    if (!customerId) return;
    if (window.MastNavStack && MastNavStack.push) {
      MastNavStack.push({
        route: 'cs-tickets',
        view: 'thread',
        state: { ticketId: selectedTicketId },
        label: 'ticket ' + (selectedTicketId || '')
      });
    }
    if (typeof navigateTo === 'function') navigateTo('customers');
    // PR1: customersOpenDetail moved to the lazy customers-core; ensure it's
    // loaded (in default V2 mode the V1 module isn't) before opening.
    if (window.MastAdmin && MastAdmin.loadModule) {
      MastAdmin.loadModule('customers-core').then(function () {
        setTimeout(function () { if (typeof window.customersOpenDetail === 'function') window.customersOpenDetail(customerId); }, 50);
      });
    }
  };
  window.csReviewsRefresh = function () { reviewsLoaded = false; renderReviews(); loadReviews().then(renderReviews); };
  window.csReviewsSetFilter = function (f) { reviewsFilter = f; renderReviews(); };
  window.csApproveReview = approveReview;
  window.csRejectReview = rejectReview;
  window.csDeleteReview = deleteReview;
  window.csFeatureReviewOnSite = featureReviewOnSite;
  window.csUnfeatureReviewOnSite = unfeatureReviewOnSite;
  window.csReviewsSetAnonymousAllowed = setReviewsAnonymousAllowed;
  window.csEditReviewResponse = editReviewResponse;
  window.csCancelReviewResponse = cancelReviewResponse;
  window.csSaveReviewResponse = saveReviewResponse;
  window.csDeleteReviewResponse = deleteReviewResponse;
  window.csToggleResponseHistory = function (reviewId) {
    reviewHistoryExpanded[reviewId] = !reviewHistoryExpanded[reviewId];
    renderReviews();
  };
  window.csDraftSocialFromReview = draftSocialFromReview;
  window.csAskForUgcPhoto = askForUgcPhoto;
  window.csSurveysRefresh = function () {
    surveysLoaded = false;
    responsesLoaded = false;
    renderSurveys();
    loadSurveysAll().then(renderSurveys);
    // Responses lazy-load on tab visit (see renderResponsesTab).
  };
  // Build 7-Responses handlers
  window.csResponsesSetFilter = csResponsesSetFilter;
  window.csEditResponseTheme = csEditResponseTheme;
  window.csCancelResponseTheme = csCancelResponseTheme;
  window.csSaveResponseTheme = csSaveResponseTheme;
  window.csOpenTicket = csOpenTicket;
  // Build 9 — VoC digest
  window.csGenerateVocDigest = csGenerateVocDigest;
  window.csCloseVocDigest = csCloseVocDigest;
  window.csCopyVocDigest = csCopyVocDigest;
  window.csDownloadVocDigest = csDownloadVocDigest;
  window.csSurveysSwitchTab = function (t) { surveysSubTab = t; renderSurveys(); };
  window.csToggleAutomatedSurveys = async function () {
    if (automatedSurveysToggling) return;
    automatedSurveysToggling = true;
    renderSurveys();
    var newEnabled = !automatedSurveysEnabled;
    try {
      var doc = newEnabled
        ? { enabled: true, enabledAt: new Date().toISOString() }
        : { enabled: false };
      await MastDB.set('cs_config/automatedSurveys', doc);
      automatedSurveysEnabled = newEnabled;
      if (typeof showToast === 'function') showToast('Automated surveys ' + (newEnabled ? 'enabled' : 'disabled'));
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to update setting: ' + (err && err.message), true);
    }
    automatedSurveysToggling = false;
    renderSurveys();
  };
  window.csShowAddQuestion = function () { showAddQuestion = true; questionEditId = null; renderSurveys(); };
  window.csEditQuestion = function (id) { questionEditId = id; showAddQuestion = false; renderSurveys(); };
  window.csSaveQuestion = saveQuestion;
  window.csDeleteQuestion = deleteQuestion;
  window.csCancelQuestion = function () { showAddQuestion = false; questionEditId = null; renderSurveys(); };
  window.csQTypeChange = function (v) { var r = document.getElementById('csQOptionsRow'); if (r) r.style.display = v === 'multiple_choice' ? '' : 'none'; };
  window.csShowAddGroup = function () { showAddGroup = true; groupEditId = null; renderSurveys(); };
  window.csEditGroup = function (id) { groupEditId = id; showAddGroup = false; renderSurveys(); };
  window.csSaveGroup = saveGroup;
  window.csDeleteGroup = deleteGroup;
  window.csCancelGroup = function () { showAddGroup = false; groupEditId = null; renderSurveys(); };
  window.csShowAddSurvey = function () { showAddSurvey = true; surveyEditId = null; renderSurveys(); };
  window.csEditSurvey = function (id) { surveyEditId = id; showAddSurvey = false; renderSurveys(); };
  window.csSaveSurvey = saveSurvey;
  window.csDeleteSurvey = deleteSurvey;
  window.csCancelSurvey = function () { showAddSurvey = false; surveyEditId = null; renderSurveys(); };
  window.csSendLink = function (id) {
    sendLinkSurveyId = id;
    sendMode = 'one';
    sendSegmentId = null;
    sendSegmentMembersCount = null;
    sendInProgress = false;
    sendProgress = null;
    renderSurveys();
  };
  window.csSendLinkCancel = function () {
    if (sendInProgress) return; // can't cancel mid-batch (would orphan tokens)
    sendLinkSurveyId = null;
    sendMode = 'one';
    sendSegmentId = null;
    sendSegmentMembersCount = null;
    renderSurveys();
  };
  // Build 7-BulkSend handlers
  window.csSendSetMode = csSendSetMode;
  window.csSendSetSegment = csSendSetSegment;
  window.csSendLinkSegmentSubmit = csSendLinkSegmentSubmit;
  window.csSendLinkSubmit = sendSurveyLink;
  window.csPreviewSurvey = previewSurvey;
  window.csShowAddTrigger = function () { showAddTrigger = true; triggerEditId = null; renderSurveys(); };
  window.csEditTrigger = function (id) { triggerEditId = id; showAddTrigger = false; renderSurveys(); };
  window.csSaveTrigger = saveTrigger;
  window.csDeleteTrigger = deleteTrigger;
  window.csCancelTrigger = function () { showAddTrigger = false; triggerEditId = null; renderSurveys(); };
  window.csFaqsRefresh = function () { policiesLoaded = false; renderFaqs(); loadPolicies().then(renderFaqs); };
  window.csShowAddPolicy = function () { showAddPolicy = true; policyEditId = null; renderFaqs(); };
  window.csEditPolicy = function (id) { policyEditId = id; showAddPolicy = false; renderFaqs(); };
  window.csSavePolicy = savePolicy;
  window.csDeletePolicy = deletePolicy;
  window.csCancelPolicy = function () { showAddPolicy = false; policyEditId = null; renderFaqs(); };

  // Bridge for the cs-faqs-v2 redesign twin (flag-gated #cs-faqs-v2). It
  // delegates FAQ create/update here so the cs_policies write + the kind='faq'
  // partition tag + slug autogen stay single-sourced — the twin never
  // reimplements that logic. These make the EXACT write savePolicy() makes
  // (the `patch` object), parameterized by data (savePolicy reads the form
  // DOM, so it can't be called with an object). Mirrors window.StudentsBridge /
  // window.ContactsBridge. Additive; no behavior change to the legacy surface.
  function buildFaqPatch(data) {
    var name = (data.question || '').trim();
    var slug = (data.slug || '').trim();
    var content = data.answer || '';
    var slugVal = slug || MastUtil.slugify(name);
    return {
      name: name, slug: slugVal, contentHtml: content,
      question: name, answer: content,
      kind: 'faq',
      storefrontEnabled: !!data.storefrontEnabled, updatedAt: nowIso()
    };
  }
  window.CsFaqsBridge = {
    create: async function (data) {
      var patch = buildFaqPatch(data);
      var nk = MastDB.newKey('cs_policies');
      var doc = Object.assign({ id: nk, createdAt: nowIso() }, patch);
      await MastDB.set('cs_policies/' + nk, doc);
      policiesData[nk] = doc;
      return nk;
    },
    update: async function (id, data) {
      var patch = buildFaqPatch(data);
      await MastDB.update('cs_policies/' + id, patch);
      if (policiesData[id]) Object.assign(policiesData[id], patch);
      return id;
    },
    // CS Wave 4 — one-click storefront toggle + delete cores (same writes as
    // togglePolicyStorefront / deletePolicy, parameterized; audited).
    setStorefront: async function (id, enabled) {
      await MastDB.update('cs_policies/' + id, { storefrontEnabled: !!enabled, updatedAt: nowIso() });
      if (policiesData[id]) policiesData[id].storefrontEnabled = !!enabled;
      if (window.writeAudit) writeAudit('update', 'cs-faq', id);
      return !!enabled;
    },
    remove: async function (id) {
      await MastDB.remove('cs_policies/' + id);
      delete policiesData[id];
      if (window.writeAudit) writeAudit('delete', 'cs-faq', id);
      return true;
    }
  };
  window.csTogglePolicyStorefront = togglePolicyStorefront;
  window.csAutofillPolicySlug = function (name, doIt) { if (!doIt) return; var el = document.getElementById('csPSlug'); if (el) el.value = MastUtil.slugify(name); };

  // Bridge for the cs-reviews-v2 redesign twin (flag-gated #cs-reviews-v2). It
  // delegates review MODERATION (approve / reject / feature / unfeature) here so
  // the cs_reviews status write + the W1.8 Testimonials-promotion logic stay
  // single-sourced — the twin never reimplements moderation or business rules.
  // Reviews are user-generated content: there is intentionally NO text-edit path
  // (the only operator write to a review's own content is the public reply, which
  // stays on legacy #cs-reviews). featureReviewOnSite/unfeatureReviewOnSite read
  // the private reviewsData + product/customer indexes, so we ensure-load the
  // legacy CS review data first (mirrors duplicates-v2 → MastAdmin.loadModule +
  // window.customersMerge). Each method resolves to the fresh review doc so the
  // twin can mutate its own live byId cache + re-open. Mirrors window.ContactsBridge
  // / window.CsFaqsBridge. Additive; no behavior change to the legacy surface.
  function ensureReviewsLoaded() {
    if (reviewsLoaded) return Promise.resolve();
    return Promise.resolve(loadReviews());
  }
  // Cache-miss heal (found by the CS Wave-5 walk): reviewsData is a load-once
  // bounded window, so a review created after load — or outside the window —
  // silently no-ops feature/respond/remove ("Review not found"). Fresh-read
  // the single doc into the cache before any per-review bridge action.
  function ensureReviewInCache(id) {
    return ensureReviewsLoaded().then(function () {
      if (reviewsData[id]) return reviewsData[id];
      return Promise.resolve(MastDB.get('cs_reviews/' + id)).then(function (doc) {
        if (doc) { reviewsData[id] = Object.assign({ id: id }, doc); }
        return reviewsData[id] || null;
      });
    });
  }
  window.CsReviewsBridge = {
    // Resolve the latest on-doc review state for the twin (post-action refresh).
    get: function (id) { return ensureReviewInCache(id); },
    approve: function (id) { return ensureReviewInCache(id).then(function () { return approveReview(id); }).then(function () { return reviewsData[id] || null; }); },
    reject: function (id) { return ensureReviewInCache(id).then(function () { return rejectReview(id); }).then(function () { return reviewsData[id] || null; }); },
    feature: function (id) { return ensureReviewInCache(id).then(function () { return featureReviewOnSite(id); }).then(function () { return reviewsData[id] || null; }); },
    unfeature: function (id) { return ensureReviewInCache(id).then(function () { return unfeatureReviewOnSite(id); }).then(function () { return reviewsData[id] || null; }); },

    // ── CS Wave 2 — state-free response + delete cores ──────────────────
    // Parameterized versions of saveReviewResponse / deleteReviewResponse /
    // deleteReview (which read the form DOM / use native confirm, so the V2
    // twin can't call them). Same writes, same cs_review_responses audit
    // appends. The legacy handlers keep their own DOM flow and the twin gets
    // a clean object API — the WRITE shape stays single-sourced here.
    respond: async function (id, body) {
      await ensureReviewInCache(id);
      var r = reviewsData[id];
      if (!r) throw new Error('Review not found');
      body = (body || '').trim();
      if (!body) throw new Error("Response can't be empty");
      if (body.length > 4000) throw new Error('Response too long (max 4000 chars)');
      var now = nowIso();
      var existing = r.response || null;
      var payload = {
        body: body,
        authorName: (window.currentUser && (window.currentUser.displayName || window.currentUser.email)) || 'Shop',
        authorUid: (window.currentUser && window.currentUser.uid) || null,
        createdAt: existing && existing.createdAt ? existing.createdAt : now,
        updatedAt: now
      };
      await MastDB.update('cs_reviews/' + id, { response: payload, updatedAt: now });
      await _appendResponseHistory(id, existing ? 'edited' : 'created', body, existing);
      if (reviewsData[id]) { reviewsData[id].response = payload; reviewsData[id].updatedAt = now; }
      if (window.writeAudit) writeAudit('update', 'cs-review', id);
      return reviewsData[id] || null;
    },
    deleteResponse: async function (id) {
      await ensureReviewInCache(id);
      var r = reviewsData[id];
      var prev = r && r.response ? r.response : null;
      await MastDB.update('cs_reviews/' + id, { response: null, updatedAt: nowIso() });
      await _appendResponseHistory(id, 'deleted', null, prev);
      if (reviewsData[id]) reviewsData[id].response = null;
      if (window.writeAudit) writeAudit('update', 'cs-review', id);
      return reviewsData[id] || null;
    },
    // ── Classic-dependency burn-down (operator directive): the remaining
    // "More actions" flows get first-class bridge entry points. Both legacy
    // helpers are already route-agnostic (document.body modals / #social
    // prefill); they only need the review + customer/product indexes loaded.
    draftSocial: function (id) {
      return ensureReviewInCache(id).then(function () { return draftSocialFromReview(id); });
    },
    askPhoto: function (id) {
      return ensureReviewInCache(id).then(function () { return askForUgcPhoto(id); });
    },
    // Anonymous-review policy (cs_config/reviews + public/config mirror).
    getPolicy: function () {
      return Promise.resolve(MastDB.get('cs_config/reviews')).then(function (d) {
        return { anonymousAllowed: !!(d && d.anonymousAllowed) };
      }).catch(function () { return { anonymousAllowed: false }; });
    },
    setAnonymousAllowed: function (allowed) {
      return setReviewsAnonymousAllowed(!!allowed);
    },
    // Hard-delete a review. CASCADES the public/testimonials mirror (the
    // legacy delete leaks it — a deleted review must not keep quoting itself
    // on the homepage). Caller owns the confirm dialog.
    remove: async function (id) {
      await ensureReviewInCache(id);
      var r = reviewsData[id];
      if (r && r.featuredOnSite) {
        try { await MastDB.remove('public/testimonials/review_' + id); }
        catch (e) { console.warn('[cs] testimonial mirror cascade failed', e); }
      }
      await MastDB.remove('cs_reviews/' + id);
      delete reviewsData[id];
      if (window.writeAudit) writeAudit('delete', 'cs-review', id);
      return true;
    }
  };

  // Bridge for the cs-surveys-v2 hub (flag-gated #cs-surveys-v2). State-free
  // CRUD cores for the three survey collections + trigger toggle + automation
  // config + the generateSurveyLink CF wrappers — parameterized versions of
  // saveQuestion/saveGroup/saveSurvey/saveTrigger (which read the form DOM).
  // The legacy handlers now DELEGATE here so the write shapes (incl. the
  // tokenSecret mint on survey create and the tokenSecret strip on the cached
  // copy) stay single-sourced. Mirrors window.CsTicketsBridge.
  window.CsSurveysBridge = {
    // One-shot loads for the V2 hub (fresh reads, independent of legacy state).
    loadAll: function () {
      return Promise.all([
        Promise.resolve(MastDB.query('cs_survey_questions').limitToLast(200).once()).catch(function () { return {}; }),
        Promise.resolve(MastDB.query('cs_survey_groups').limitToLast(100).once()).catch(function () { return {}; }),
        Promise.resolve(MastDB.query('cs_surveys').limitToLast(100).once()).catch(function () { return {}; }),
        Promise.resolve(MastDB.query('cs_survey_triggers').limitToLast(100).once()).catch(function () { return {}; }),
        Promise.resolve(MastDB.query('cs_survey_responses').orderByChild('createdAt').limitToLast(500).once()).catch(function () { return {}; }),
        Promise.resolve(MastDB.get('cs_config/automatedSurveys')).catch(function () { return null; })
      ]).then(function (r) {
        // Never hand tokenSecret to a UI layer.
        var sv = {};
        Object.keys(r[2] || {}).forEach(function (k) {
          var s = Object.assign({}, r[2][k]); delete s.tokenSecret; sv[k] = s;
        });
        return { questions: r[0] || {}, groups: r[1] || {}, surveys: sv, triggers: r[3] || {}, responses: r[4] || {}, automationEnabled: !!(r[5] && r[5].enabled) };
      });
    },
    saveQuestion: async function (id, data) {
      var text = (data.text || '').trim();
      if (!text) throw new Error('Question text is required');
      var type = data.type || 'open_text';
      var options = type === 'multiple_choice'
        ? (Array.isArray(data.options) ? data.options : String(data.options || '').split(',').map(function (o) { return o.trim(); }).filter(Boolean))
        : [];
      var required = data.required !== false;
      var patch = { text: text, type: type, options: options, required: required, updatedAt: nowIso() };
      if (id) {
        await MastDB.update('cs_survey_questions/' + id, patch);
        if (questionsData[id]) Object.assign(questionsData[id], patch);
      } else {
        id = MastDB.newKey('cs_survey_questions');
        var doc = Object.assign({ id: id, isStock: false, createdAt: nowIso() }, patch);
        await MastDB.set('cs_survey_questions/' + id, doc);
        questionsData[id] = doc;
      }
      if (window.writeAudit) writeAudit(data._mode === 'create' ? 'create' : 'update', 'cs-survey-question', id);
      return questionsData[id] || null;
    },
    deleteQuestion: async function (id) {
      await MastDB.remove('cs_survey_questions/' + id);
      delete questionsData[id];
      if (window.writeAudit) writeAudit('delete', 'cs-survey-question', id);
      return true;
    },
    saveGroup: async function (id, data) {
      var name = (data.name || '').trim();
      if (!name) throw new Error('Question Set name is required');
      var patch = { name: name, eventType: (data.eventType || '').trim() || null, questionIds: data.questionIds || [], updatedAt: nowIso() };
      if (id) {
        await MastDB.update('cs_survey_groups/' + id, patch);
        if (groupsData[id]) Object.assign(groupsData[id], patch);
      } else {
        id = MastDB.newKey('cs_survey_groups');
        var doc = Object.assign({ id: id, isActive: true, createdAt: nowIso() }, patch);
        await MastDB.set('cs_survey_groups/' + id, doc);
        groupsData[id] = doc;
      }
      if (window.writeAudit) writeAudit('update', 'cs-survey-group', id);
      return groupsData[id] || null;
    },
    deleteGroup: async function (id) {
      await MastDB.remove('cs_survey_groups/' + id);
      delete groupsData[id];
      if (window.writeAudit) writeAudit('delete', 'cs-survey-group', id);
      return true;
    },
    saveSurvey: async function (id, data) {
      var name = (data.name || '').trim();
      if (!name) throw new Error('Survey name is required');
      if (!data.groupId) throw new Error('Please select a Question Set');
      var patch = { name: name, groupId: data.groupId, status: data.status || 'draft', closesAt: data.closesAt || null, updatedAt: nowIso() };
      if (id) {
        await MastDB.update('cs_surveys/' + id, patch);
        if (surveysDefData[id]) Object.assign(surveysDefData[id], patch);
      } else {
        id = MastDB.newKey('cs_surveys');
        var doc = Object.assign({ id: id, tokenSecret: genTokenSecret(), createdAt: nowIso() }, patch);
        await MastDB.set('cs_surveys/' + id, doc);
        var cached = Object.assign({}, doc); delete cached.tokenSecret;
        surveysDefData[id] = cached;
      }
      if (window.writeAudit) writeAudit('update', 'cs-survey', id);
      var out = Object.assign({}, surveysDefData[id]); delete out.tokenSecret;
      return out;
    },
    deleteSurvey: async function (id) {
      await MastDB.remove('cs_surveys/' + id);
      delete surveysDefData[id];
      if (window.writeAudit) writeAudit('delete', 'cs-survey', id);
      return true;
    },
    setTriggerActive: async function (id, active) {
      await MastDB.update('cs_survey_triggers/' + id, { isActive: !!active, updatedAt: nowIso() });
      if (triggersData[id]) triggersData[id].isActive = !!active;
      if (window.writeAudit) writeAudit('update', 'cs-survey-trigger', id);
      return true;
    },
    setAutomationEnabled: async function (enabled) {
      var doc = { enabled: !!enabled, updatedAt: nowIso() };
      await MastDB.set('cs_config/automatedSurveys', doc);
      automatedSurveysEnabled = !!enabled;
      if (window.writeAudit) writeAudit('update', 'cs-survey-automation', 'automatedSurveys');
      return !!enabled;
    },
    // generateSurveyLink CF wrappers (the only CS survey Cloud Function).
    sendOne: function (surveyId, email, name) {
      var fn = firebase.functions().httpsCallable('generateSurveyLink');
      return fn({ tenantId: window.TENANT_ID, surveyId: surveyId, contactEmail: email, contactName: name || null });
    },
    previewUrl: function (surveyId) {
      var fn = firebase.functions().httpsCallable('generateSurveyLink');
      return fn({ tenantId: window.TENANT_ID, surveyId: surveyId, preview: true })
        .then(function (result) { return result && result.data && result.data.surveyUrl; });
    },

    // ── Classic-dependency burn-down (operator directive) — the four flows
    // that used to hide behind the "Classic view ↗" link.

    // VoC digest: the legacy generator is already route-agnostic (it renders
    // its own document.body overlay + copy/download controls) — expose it.
    vocDigest: function (windowDays) { return csGenerateVocDigest(windowDays || 30); },

    // Response theme tags — normalization core (lowercase, dedupe, 16-cap;
    // mirrors server-side cs_tag_response_theme). Legacy csSaveResponseTheme
    // now delegates here.
    setResponseThemes: async function (id, rawCsv) {
      var seen = {}, cleaned = [];
      String(rawCsv || '').split(',').forEach(function (t) {
        var v = String(t || '').trim().toLowerCase();
        if (!v || seen[v]) return;
        seen[v] = true; cleaned.push(v);
      });
      cleaned = cleaned.slice(0, 16);
      var now = nowIso();
      await MastDB.update('cs_survey_responses/' + id, {
        themeTags: cleaned, themedAt: now,
        themedBy: (window.currentUser && currentUser.uid) || null,
        updatedAt: now
      });
      if (responsesData[id]) { responsesData[id].themeTags = cleaned; responsesData[id].themedAt = now; }
      if (window.writeAudit) writeAudit('update', 'cs-survey-response', id);
      return cleaned;
    },

    // Saved segments + bulk send (port of csSendLinkSegmentSubmit, minus the
    // DOM: resolves members, loops the CF with the same cap/delay, reports
    // progress via the optional callback). Re-sends are CF-idempotent.
    listSegments: function () {
      return Promise.resolve(csLoadSendSegments()).then(function () {
        return Object.keys(sendSegmentsData).map(function (k) {
          var s = sendSegmentsData[k] || {};
          return { id: k, name: s.name || '(unnamed segment)' };
        }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      });
    },
    resolveSegmentMembers: function (segmentId) {
      return Promise.resolve(csLoadSendSegments()).then(function () {
        return csResolveSegmentMembers(segmentId);
      });
    },
    sendToSegment: async function (surveyId, segmentId, onProgress) {
      await csLoadSendSegments();
      var members = await csResolveSegmentMembers(segmentId);
      if (members.length === 0) return { total: 0, sent: 0, failed: 0, remaining: 0 };
      var batch = members.slice(0, SEND_BATCH_CAP);
      var fn = firebase.functions().httpsCallable('generateSurveyLink');
      var sent = 0, failed = 0;
      for (var i = 0; i < batch.length; i++) {
        var m = batch[i];
        if (typeof onProgress === 'function') { try { onProgress(i + 1, batch.length, m.email); } catch (_e) {} }
        try {
          await fn({ tenantId: window.TENANT_ID, surveyId: surveyId, contactEmail: m.email, contactName: m.name });
          sent++;
        } catch (e) {
          console.warn('[csBulkSend] recipient #' + (i + 1) + ' failed:', e && e.message);
          failed++;
        }
        if (i < batch.length - 1) await new Promise(function (r) { setTimeout(r, SEND_DELAY_MS); });
      }
      if (window.writeAudit) writeAudit('update', 'cs-survey', surveyId);
      return { total: batch.length, sent: sent, failed: failed, remaining: Math.max(0, members.length - SEND_BATCH_CAP) };
    },

    // Sending-rule (trigger) CRUD cores — parameterized saveTrigger/deleteTrigger
    // (legacy handlers now delegate). data: {eventType*, surveyId*, delayHours, isActive}.
    saveTrigger: async function (id, data) {
      var et = (data.eventType || '').trim();
      if (!et) throw new Error('Event type is required');
      if (!data.surveyId) throw new Error('Please select a survey');
      var patch = { eventType: et, surveyId: data.surveyId, delayHours: Number(data.delayHours) || 0, isActive: data.isActive !== false, updatedAt: nowIso() };
      if (id) {
        await MastDB.update('cs_survey_triggers/' + id, patch);
        if (triggersData[id]) Object.assign(triggersData[id], patch);
      } else {
        id = MastDB.newKey('cs_survey_triggers');
        var doc = Object.assign({ id: id, createdAt: nowIso() }, patch);
        await MastDB.set('cs_survey_triggers/' + id, doc);
        triggersData[id] = doc;
      }
      if (window.writeAudit) writeAudit('update', 'cs-survey-trigger', id);
      return triggersData[id] || null;
    },
    deleteTrigger: async function (id) {
      await MastDB.remove('cs_survey_triggers/' + id);
      delete triggersData[id];
      if (window.writeAudit) writeAudit('delete', 'cs-survey-trigger', id);
      return true;
    }
  };

  // Bridge for the cs-support-v2 hub (flag-gated #cs-inbox-v2 / #cs-tickets-v2).
  // State-free conversation-write cores extracted from csSubmitCreate /
  // csSendReply / csUpdateStatus|Priority|Category, parameterized by data (the
  // legacy handlers read the form DOM, so they can't be called with an object).
  // The legacy handlers now DELEGATE here, so the ticket-number mint, the
  // message append + updatedAt bump, and the field writes stay single-sourced.
  // Replies do NOT email the customer (verified V1 behavior — keep it that way
  // here; outbound email is a product decision, not a refactor side effect).
  // Mirrors window.FinanceBridge / window.CsFaqsBridge.
  window.CsTicketsBridge = {
    // data: { subject*, contactEmail*, contactName, source, priority, firstMessage }
    createTicket: async function (data) {
      // Allocate the human-facing ticket number ATOMICALLY. The old
      // get→compute→write-back raced under concurrent ticket creation: two
      // simultaneous createTicket calls both read the same nextNumber and
      // minted the same T-#### number, then both wrote nextNumber+1 (advancing
      // by one, not two). A Firestore transaction read-modify-writes the
      // counter in one atomic step (server read, retried on contention), so
      // each concurrent ticket gets a distinct number and the counter advances
      // once per ticket. The closure replaces the whole doc, so copy existing
      // fields forward; read the allocated number back from the committed value.
      var prefix = 'T';
      var nextNum = 1;
      var txRes = await MastDB.transaction('cs_config/ticketing', function(cur) {
        var doc = (cur && typeof cur === 'object') ? cur : {};
        var next = {};
        for (var f in doc) next[f] = doc[f];
        next.prefix = doc.prefix || 'T';
        next.nextNumber = (typeof doc.nextNumber === 'number' ? doc.nextNumber : 1) + 1;
        return next;
      });
      if (txRes && txRes.value && typeof txRes.value.nextNumber === 'number') {
        prefix = txRes.value.prefix || 'T';
        nextNum = txRes.value.nextNumber - 1;
      }
      var ticketNumber = prefix + '-' + String(nextNum).padStart(4, '0');
      var ticketId = MastUtil.genId('ticket_');
      var now = new Date().toISOString();
      var ticketData = {
        id: ticketId,
        ticketNumber: ticketNumber,
        subject: data.subject,
        status: 'open',
        priority: data.priority || 'normal',
        source: data.source || 'manual',
        contactEmail: data.contactEmail,
        contactName: data.contactName || null,
        createdAt: now,
        updatedAt: now,
        createdBy: (window.currentUser && currentUser.uid) || null
      };
      await MastDB.set('cs_tickets/' + ticketId, ticketData);
      if (data.firstMessage) {
        var msgId = MastUtil.genId('msg_');
        await MastDB.set('cs_tickets/' + ticketId + '/messages/' + msgId, {
          id: msgId,
          body: data.firstMessage,
          direction: 'inbound',
          isInternal: false,
          authorName: data.contactName || null,
          authorEmail: data.contactEmail,
          createdAt: now
        });
      }
      // Counter already advanced atomically above — no write-back needed here.
      if (window.writeAudit) writeAudit('create', 'cs-ticket', ticketId);
      ticketsData.unshift(ticketData);
      return ticketData;
    },
    // Append a message to the thread + bump updatedAt. opts: { isInternal,
    // authorName, authorEmail } (author defaults to the signed-in operator).
    reply: async function (ticketId, body, opts) {
      opts = opts || {};
      var msgId = MastUtil.genId('msg_');
      var now = new Date().toISOString();
      var msgData = {
        id: msgId,
        body: body,
        direction: 'outbound',
        isInternal: !!opts.isInternal,
        authorName: opts.authorName || (window.currentUser && currentUser.displayName) || null,
        authorEmail: opts.authorEmail || (window.currentUser && currentUser.email) || null,
        createdAt: now
      };
      await MastDB.set('cs_tickets/' + ticketId + '/messages/' + msgId, msgData);
      await MastDB.update('cs_tickets/' + ticketId, { updatedAt: now });
      if (window.writeAudit) writeAudit('update', 'cs-ticket', ticketId);
      var idx = ticketsData.findIndex(function (t) { return t.id === ticketId; });
      if (idx !== -1) ticketsData[idx].updatedAt = now;
      return msgData;
    },
    // field ∈ { status, priority, category } — assigned attributes (the ticket
    // status is a free select, NOT a gated workflow). Stored status VALUES are
    // load-bearing (finance cost-to-serve + engagement inbox read them raw).
    setField: async function (ticketId, field, value) {
      if (field !== 'status' && field !== 'priority' && field !== 'category') {
        throw new Error('CsTicketsBridge.setField: unsupported field ' + field);
      }
      var val = (field === 'category' && !value) ? null : value;
      var now = new Date().toISOString();
      var upd = { updatedAt: now };
      upd[field] = val;
      await MastDB.update('cs_tickets/' + ticketId, upd);
      if (window.writeAudit) writeAudit('update', 'cs-ticket', ticketId);
      var idx = ticketsData.findIndex(function (t) { return t.id === ticketId; });
      if (idx !== -1) { ticketsData[idx][field] = val; ticketsData[idx].updatedAt = now; }
      return val;
    }
  };

  // ============================================================
  // Actions — data entry points
  // ============================================================

  async function loadAndRenderRoute(route) {
    activeRoute = route;
    viewMode = 'list';
    selectedTicketId = null;

    var tab = tabEl();
    if (!tab) return;

    if (!ticketsLoaded) {
      tab.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading tickets…</div>';
      await loadTickets();
    }
    renderCurrentView();
  }

  async function csOpenThread(ticketId) {
    selectedTicketId = ticketId;
    viewMode = 'thread';
    threadMessages = [];

    var tab = tabEl();
    if (tab) tab.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading thread…</div>';

    try {
      // Messages are stored as nested fields in the ticket doc (MastDB path API
      // doesn't support subcollection queries; query() ignores docId/fieldPath).
      var ticket = await MastDB.get('cs_tickets/' + ticketId);
      var msgs = ticket && ticket.messages ? ticket.messages : {};
      threadMessages = Object.values(msgs);
      threadMessages.sort(function(a, b) {
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });
    } catch (err) {
      console.error('[cs] load messages:', err);
      threadMessages = [];
    }
    renderCurrentView();
  }

  function csBackToList() {
    // If we got here from another surface (e.g. customer detail → ticket,
    // or a custom-order detail → ticket), honor the MastNavStack and return
    // to that origin instead of falling through to the ticket list.
    if (window.MastNavStack && typeof MastNavStack.size === 'function' && MastNavStack.size() > 0) {
      selectedTicketId = null;
      threadMessages = [];
      isInternalNote = false;
      MastNavStack.popAndReturn();
      return;
    }
    viewMode = 'list';
    selectedTicketId = null;
    threadMessages = [];
    isInternalNote = false;
    renderCurrentView();
  }

  function csOpenCreate() {
    viewMode = 'create';
    renderCurrentView();
  }

  async function csRefreshTickets() {
    ticketsLoaded = false;
    var tab = tabEl();
    if (tab) tab.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Refreshing…</div>';
    await loadTickets();
    renderCurrentView();
  }

  async function csSendReply() {
    if (sendInFlight || !selectedTicketId) return;
    var bodyEl = document.getElementById('csReplyBody');
    var body = bodyEl ? bodyEl.value.trim() : '';
    if (!body) { showToast('Reply cannot be empty.', true); return; }

    sendInFlight = true;
    var btn = document.getElementById('csReplyBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    var wasInternal = isInternalNote;
    try {
      // Delegate to the shared state-free core (CsTicketsBridge syncs
      // ticketsData's updatedAt itself).
      var msgData = await window.CsTicketsBridge.reply(selectedTicketId, body, { isInternal: wasInternal });
      threadMessages.push(msgData);
      isInternalNote = false;
      showToast(wasInternal ? 'Note added.' : 'Reply sent.');
      renderCurrentView();
    } catch (err) {
      showToast('Failed to send: ' + (err && err.message), true);
      if (btn) { btn.disabled = false; btn.textContent = 'Send Reply'; }
    } finally {
      sendInFlight = false;
    }
  }

  function csToggleInternal(checked) {
    isInternalNote = !!checked;
    // Update textarea placeholder and left border without full re-render
    var ta = document.getElementById('csReplyBody');
    if (ta) {
      ta.placeholder = checked ? 'Write an internal note…' : 'Write a reply…';
      ta.style.borderLeft = checked ? '3px solid rgba(91,33,182,0.5)' : '';
    }
  }

  async function csUpdateStatus(status) {
    if (!selectedTicketId) return;
    try {
      await window.CsTicketsBridge.setField(selectedTicketId, 'status', status);
      showToast('Status updated to ' + (STATUS_LABELS[status] || status) + '.');
    } catch (err) {
      showToast('Failed to update status.', true);
    }
  }

  async function csUpdatePriority(priority) {
    if (!selectedTicketId) return;
    try {
      await window.CsTicketsBridge.setField(selectedTicketId, 'priority', priority);
      showToast('Priority updated to ' + (PRIORITY_LABELS[priority] || priority) + '.');
    } catch (err) {
      showToast('Failed to update priority.', true);
    }
  }

  // Build 8 — root-cause category. Empty string from dropdown = clear.
  async function csUpdateCategory(category) {
    if (!selectedTicketId) return;
    var value = category || null;
    try {
      await window.CsTicketsBridge.setField(selectedTicketId, 'category', value);
      showToast(value ? 'Category set to ' + csCategoryLabel(value) + '.' : 'Category cleared.');
    } catch (err) {
      showToast('Failed to update category.', true);
    }
  }

  async function csSubmitCreate() {
    var subject = (document.getElementById('csCreateSubject') || {}).value;
    subject = (subject || '').trim();
    if (!subject) { showToast('Subject is required.', true); return; }

    var contactEmail = (document.getElementById('csCreateEmail') || {}).value;
    contactEmail = (contactEmail || '').trim();
    if (!contactEmail) { showToast('Contact email is required.', true); return; }

    var contactName = ((document.getElementById('csCreateName') || {}).value || '').trim();
    var source = (document.getElementById('csCreateSource') || {}).value || 'manual';
    var priority = (document.getElementById('csCreatePriority') || {}).value || 'normal';
    var firstMessage = ((document.getElementById('csCreateMessage') || {}).value || '').trim();

    var btn = document.getElementById('csCreateBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

    try {
      // Delegate to the shared state-free core (mints the ticket number,
      // writes the doc + first message, bumps the counter, prepends to
      // ticketsData).
      var ticketData = await window.CsTicketsBridge.createTicket({
        subject: subject,
        contactEmail: contactEmail,
        contactName: contactName || null,
        source: source,
        priority: priority,
        firstMessage: firstMessage || null
      });
      showToast('Ticket ' + ticketData.ticketNumber + ' created.');

      // Open the new thread
      await csOpenThread(ticketData.id);
    } catch (err) {
      showToast('Failed to create ticket: ' + (err && err.message), true);
      if (btn) { btn.disabled = false; btn.textContent = 'Create Ticket'; }
    }
  }

  // ============================================================
  // Filter setters
  // ============================================================

  function csSetInboxTab(tab) {
    inboxSubTab = tab;
    renderCurrentView();
  }

  function csSetStatusFilter(val) {
    statusFilter = val;
    renderCurrentView();
  }

  function csSetPriorityFilter(val) {
    priorityFilter = val;
    renderCurrentView();
  }

  // ============================================================
  // Window exports (onclick handlers need window scope)
  // ============================================================

  window.csOpenThread = csOpenThread;
  window.csBackToList = csBackToList;
  window.csOpenCreate = csOpenCreate;
  window.csRefreshTickets = csRefreshTickets;
  window.csSendReply = csSendReply;
  window.csToggleInternal = csToggleInternal;
  window.csUpdateStatus = csUpdateStatus;
  window.csUpdatePriority = csUpdatePriority;
  window.csUpdateCategory = csUpdateCategory;
  window.csSubmitCreate = csSubmitCreate;
  window.csSetInboxTab = csSetInboxTab;
  window.csSetStatusFilter = csSetStatusFilter;
  window.csSetPriorityFilter = csSetPriorityFilter;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  // ============================================================
  // Ask AI registration (MastAskAi)
  // ============================================================

  if (window.MastAskAi) {
    window.MastAskAi.register('cs-reviews', {
      title: 'Ask AI about your reviews',
      placeholder: 'e.g. What\'s my average rating? Which products are getting low ratings? What themes show up in negative reviews?',
      notes: [
        'Statuses: pending (awaiting moderation), approved (live on site), rejected (hidden).',
        'rating is on a 1-5 scale; null/missing means an unrated review.',
        'avgRating in aggregates is computed only across rated reviews.',
        'byProduct buckets reviews by productId; missing productId means a generic shop review.',
        'topLowRatedProducts surfaces products with the lowest average rating (min 2 reviews to count) — investigate these first.',
        'recentReviews includes the most recent 15 reviews regardless of status, with full body text so themes can be compared.'
      ],
      buildContext: function() {
        var all = Object.values(reviewsData);
        var filtered = reviewsFilter === 'all' ? all.slice() : all.filter(function(r) { return r.status === reviewsFilter; });
        filtered.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

        var byStatus = {}, byRating = {1:0,2:0,3:0,4:0,5:0,unrated:0}, byProduct = {}, byMonth = {};
        var totalRated = 0, sumRating = 0;
        all.forEach(function(r) {
          var status = r.status || 'pending';
          if (!byStatus[status]) byStatus[status] = { count: 0 };
          byStatus[status].count++;
          if (r.rating) {
            byRating[r.rating] = (byRating[r.rating] || 0) + 1;
            totalRated++;
            sumRating += r.rating;
          } else {
            byRating.unrated++;
          }
          var pid = r.productId || '(general)';
          if (!byProduct[pid]) byProduct[pid] = { count: 0, sumRating: 0, ratedCount: 0 };
          byProduct[pid].count++;
          if (r.rating) { byProduct[pid].sumRating += r.rating; byProduct[pid].ratedCount++; }
          var month = (r.createdAt || '').substring(0, 7) || 'unknown';
          if (!byMonth[month]) byMonth[month] = { count: 0 };
          byMonth[month].count++;
        });

        var topLowRatedProducts = Object.keys(byProduct)
          .filter(function(pid) { return byProduct[pid].ratedCount >= 2; })
          .map(function(pid) {
            return {
              productId: pid,
              reviewCount: byProduct[pid].count,
              avgRating: +(byProduct[pid].sumRating / byProduct[pid].ratedCount).toFixed(2)
            };
          })
          .sort(function(a, b) { return a.avgRating - b.avgRating; })
          .slice(0, 10);

        var recentReviews = all.slice()
          .sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); })
          .slice(0, 15)
          .map(function(r) {
            return {
              createdAt: (r.createdAt || '').slice(0, 10),
              rating: r.rating || null,
              status: r.status || 'pending',
              productId: r.productId || null,
              headline: r.headline || null,
              body: (r.body || '').slice(0, 400),
              reviewerName: r.reviewerName || 'Anonymous'
            };
          });

        return {
          route: '/app#cs-reviews',
          pageTitle: 'Customer Service → Reviews',
          filters: { status: reviewsFilter },
          aggregates: {
            rowCount: filtered.length,
            totalAcrossStatuses: all.length,
            avgRating: totalRated > 0 ? +(sumRating / totalRated).toFixed(2) : null,
            ratedCount: totalRated,
            unratedCount: byRating.unrated,
            byStatus: byStatus,
            byRating: byRating,
            byMonth: byMonth
          },
          topLowRatedProducts: topLowRatedProducts,
          recentReviews: recentReviews
        };
      }
    });
  }

  MastAdmin.registerModule('customer-service', {
    routes: {
      'cs-inbox': {
        tab: 'csInboxTab',
        setup: function() { loadAndRenderRoute('cs-inbox'); }
      },
      'cs-tickets': {
        tab: 'csTicketsTab',
        setup: function() { loadAndRenderRoute('cs-tickets'); }
      },
      'cs-surveys': {
        tab: 'csSurveysTab',
        setup: function() {
          if (!surveysLoaded) { renderSurveys(); loadSurveysAll().then(renderSurveys); }
          else { renderSurveys(); }
        }
      },
      'cs-reviews': {
        tab: 'csReviewsTab',
        setup: function() {
          if (!reviewsLoaded) { renderReviews(); loadReviews().then(renderReviews); }
          else { renderReviews(); }
        }
      },
      'cs-faqs': {
        tab: 'csFaqsTab',
        setup: function() {
          if (!policiesLoaded) { renderFaqs(); loadPolicies().then(renderFaqs); }
          else { renderFaqs(); }
        }
      },
      'cs-members': {
        tab: 'csMembersTab',
        setup: function() {
          if (membersAtRiskData === null || membersActiveData === null) {
            renderMembers();
            loadMembersData().then(renderMembers);
          } else {
            renderMembers();
          }
        }
      }
    },
    detachListeners: function() {
      ticketsData = [];
      ticketsLoaded = false;
      loadInFlight = false;
      sendInFlight = false;
      activeRoute = null;
      viewMode = 'list';
      selectedTicketId = null;
      threadMessages = [];
      isInternalNote = false;
      inboxSubTab = 'all';
      statusFilter = 'all';
      priorityFilter = 'all';
      reviewsData = {};
      reviewsLoaded = false;
      reviewsFilter = 'pending';
      questionsData = {};
      groupsData = {};
      surveysDefData = {};
      triggersData = {};
      surveysLoaded = false;
      questionEditId = null;
      showAddQuestion = false;
      groupEditId = null;
      showAddGroup = false;
      surveyEditId = null;
      showAddSurvey = false;
      sendLinkSurveyId = null;
      triggerEditId = null;
      showAddTrigger = false;
      automatedSurveysEnabled = false;
      automatedSurveysToggling = false;
      policiesData = {};
      policiesLoaded = false;
      policyEditId = null;
      showAddPolicy = false;
      membersSubTab = 'at-risk';
      membersAtRiskData = null;
      membersActiveData = null;
      membersLoading = false;
    }
  });

})();
