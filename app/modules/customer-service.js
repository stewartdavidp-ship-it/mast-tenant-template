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
    try { return new Date(iso).toLocaleDateString(); } catch (e) { return iso; }
  }

  // Status → badge inline style
  var STATUS_STYLES = {
    open:        { bg: 'rgba(30,64,175,0.2)',  color: '#64B5F6', border: 'rgba(30,64,175,0.35)' },
    in_progress: { bg: 'rgba(146,64,14,0.2)',  color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    waiting:     { bg: 'rgba(91,33,182,0.2)',  color: '#CE93D8', border: 'rgba(91,33,182,0.35)' },
    resolved:    { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    closed:      { bg: 'rgba(80,80,80,0.2)',   color: '#9E9E9E', border: 'rgba(80,80,80,0.3)' }
  };
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

  var SOURCE_ICONS = { email: '✉', web: '🌐', phone: '☎', chat: '💬', manual: '✏' };

  function statusBadge(status) {
    var s = STATUS_STYLES[status] || STATUS_STYLES.closed;
    return '<span class="status-badge" style="background:' + s.bg + ';color:' + s.color +
      ';border:1px solid ' + s.border + ';">' + _esc(STATUS_LABELS[status] || status || '—') + '</span>';
  }

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
    html += '<span style="font-size:0.83rem;color:var(--warm-gray);">' +
      filtered.length + ' ticket' + (filtered.length !== 1 ? 's' : '') + '</span>';
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
    var selStyle = 'font-size:0.83rem;padding:4px 8px;background:var(--surface-card);border:1px solid var(--border);border-radius:4px;color:var(--text);';

    var html = '<div style="display:flex;gap:10px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">';

    html += '<label style="font-size:0.83rem;color:var(--warm-gray);">Status</label>';
    html += '<select onchange="csSetStatusFilter(this.value)" style="' + selStyle + '">';
    statuses.forEach(function(s) {
      html += '<option value="' + s + '"' + (statusFilter === s ? ' selected' : '') + '>' +
        _esc(s === 'all' ? 'All Statuses' : (STATUS_LABELS[s] || s)) + '</option>';
    });
    html += '</select>';

    html += '<label style="font-size:0.83rem;color:var(--warm-gray);">Priority</label>';
    html += '<select onchange="csSetPriorityFilter(this.value)" style="' + selStyle + '">';
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
        statusBadge(t.status) +
        priorityBadge(t.priority) +
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

    var selStyle = 'font-size:0.83rem;padding:4px 8px;background:var(--surface-card);border:1px solid var(--border);border-radius:4px;color:var(--text);';

    var html = '<div style="display:flex;flex-direction:column;height:100%;">';

    // Header
    html += '<div style="padding:16px 24px 12px;border-bottom:1px solid var(--border);">';
    html += '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
    html += '<button class="btn btn-secondary btn-small" onclick="csBackToList()" style="white-space:nowrap;">← Back</button>';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="font-weight:600;font-size:1rem;">' +
      _esc(num) + ' — ' + _esc(ticket.subject || 'No subject') + '</div>';
    html += '<div style="font-size:0.8rem;color:var(--warm-gray);margin-top:2px;">from ' +
      _esc(ticket.contactName || ticket.contactEmail || 'Unknown') +
      (ticket.contactEmail && ticket.contactName ? ' (' + _esc(ticket.contactEmail) + ')' : '') +
      ' · ' + fmtDate(ticket.createdAt) + '</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">';
    html += '<select onchange="csUpdateStatus(this.value)" style="' + selStyle + '">' + statusOpts + '</select>';
    html += '<select onchange="csUpdatePriority(this.value)" style="' + selStyle + '">' + priorityOpts + '</select>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // Message thread
    html += '<div id="csThreadMessages" style="flex:1;overflow-y:auto;padding:16px 24px;display:flex;flex-direction:column;gap:10px;">';
    if (threadMessages.length === 0) {
      html += '<div style="color:var(--warm-gray);font-size:0.87rem;text-align:center;padding:32px 0;">No messages yet.</div>';
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
      'font-size:0.87rem;resize:vertical;outline:none;box-sizing:border-box;' +
      (isInternalNote ? 'border-left:3px solid rgba(91,33,182,0.5);' : '') + '"></textarea>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-top:1px solid var(--border);">';
    html += '<label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;color:var(--warm-gray);cursor:pointer;">' +
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
    html += '<div style="white-space:pre-wrap;font-size:0.87rem;word-break:break-word;">' +
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
    var selStyle = 'width:100%;padding:8px 10px;background:var(--surface-card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.87rem;';
    var sourceOpts = ['email', 'web', 'phone', 'chat', 'manual'].map(function(s) {
      return '<option value="' + s + '">' + _esc(s.charAt(0).toUpperCase() + s.slice(1)) + '</option>';
    }).join('');
    var priorityOpts = Object.keys(PRIORITY_LABELS).map(function(p) {
      return '<option value="' + p + '"' + (p === 'normal' ? ' selected' : '') + '>' + PRIORITY_LABELS[p] + '</option>';
    }).join('');

    var html = '<div style="padding:20px 24px;">';
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">';
    html += '<button class="btn btn-secondary btn-small" onclick="csBackToList()">← Back</button>';
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

  var surveysSubTab = 'questions';
  var questionsData = {};
  var groupsData = {};
  var surveysDefData = {};
  var triggersData = {};
  var surveysLoaded = false;
  var questionEditId = null;
  var showAddQuestion = false;
  var groupEditId = null;
  var showAddGroup = false;
  var surveyEditId = null;
  var showAddSurvey = false;
  var sendLinkSurveyId = null;
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
    return '<span style="background:' + bg + ';color:' + color + ';padding:2px 10px;border-radius:12px;font-size:0.75rem;font-weight:600;">' + _esc(s || 'pending') + '</span>';
  }

  function surveyBadge(s) {
    var bg = s === 'active' ? 'rgba(42,124,111,0.20)' : (s === 'inactive' ? 'rgba(220,38,38,0.15)' : 'rgba(0,0,0,0.10)');
    var color = s === 'active' ? 'var(--teal)' : (s === 'inactive' ? 'var(--danger)' : 'var(--text)');
    return '<span style="background:' + bg + ';color:' + color + ';padding:2px 10px;border-radius:12px;font-size:0.75rem;font-weight:600;">' + _esc(s || 'draft') + '</span>';
  }

  function kpiCard(label, val, sub) {
    return '<div style="flex:1;min-width:120px;padding:12px 16px;border:1px solid var(--cream-dark);border-radius:10px;background:var(--surface-card);">' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:4px;">' + label + '</div>' +
      '<div style="font-size:1.5rem;font-weight:700;font-family:monospace;color:var(--text);">' + val + '</div>' +
      (sub ? '<div style="font-size:0.8rem;color:var(--warm-gray);margin-top:2px;">' + sub + '</div>' : '') +
    '</div>';
  }

  function loadReviews() {
    return MastDB.query('cs_reviews').limitToLast(100).once()
      .then(function (d) { reviewsData = d || {}; reviewsLoaded = true; })
      .catch(function (err) { console.warn('[cs-reviews]', err && err.message); if (typeof showToast === 'function') showToast('Failed to load reviews', true); });
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
    html += '<div class="section-header" style="margin-bottom:14px;"><h2 style="margin:0;">Reviews</h2><button class="btn btn-secondary btn-small" onclick="csReviewsRefresh()">Refresh</button></div>';
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
        html += '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card);">';
        html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">';
        html += '<span style="font-weight:600;">' + _esc(r.reviewerName || 'Anonymous') + '</span>';
        html += '<span style="color:var(--amber-light);letter-spacing:0.04em;">' + starsHtml(r.rating) + '</span>';
        if (r.reviewerEmail) html += '<span style="font-size:0.8rem;color:var(--warm-gray);">' + _esc(r.reviewerEmail) + '</span>';
        html += '<span style="font-size:0.78rem;color:var(--warm-gray);margin-left:auto;">' + relativeTime(r.createdAt) + '</span>';
        html += reviewBadge(r.status) + '</div>';
        if (r.headline || r.productId) {
          html += '<div style="font-size:0.85rem;margin-bottom:6px;">';
          if (r.headline) html += '<strong>' + _esc(r.headline) + '</strong> ';
          if (r.productId) html += '<span style="color:var(--warm-gray);">Product: ' + _esc(r.productId) + '</span>';
          html += '</div>';
        }
        if (r.body) html += '<div style="font-size:0.9rem;margin-bottom:10px;">' + _esc(r.body) + '</div>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
        if (r.status === 'pending') {
          html += '<button class="btn btn-primary btn-small" onclick="csApproveReview(\'' + _esc(r.id) + '\')">Approve</button>';
          html += '<button class="btn btn-secondary btn-small" onclick="csRejectReview(\'' + _esc(r.id) + '\')">Reject</button>';
        } else if (r.status === 'rejected') {
          html += '<button class="btn btn-secondary btn-small" onclick="csApproveReview(\'' + _esc(r.id) + '\')">Approve</button>';
        } else if (r.status === 'approved') {
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
    try { await MastDB.remove('cs_reviews/' + id); delete reviewsData[id]; showToast('Review deleted'); renderReviews(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }

  function renderSurveys() {
    var tab = document.getElementById('csSurveysTab');
    if (!tab) return;
    if (!surveysLoaded) { tab.innerHTML = '<div style="padding:40px;text-align:center;color:var(--warm-gray);">Loading surveys…</div>'; return; }
    var html = '<div style="padding:24px;">';
    html += '<div class="section-header" style="margin-bottom:14px;"><h2 style="margin:0;">Surveys</h2><button class="btn btn-secondary btn-small" onclick="csSurveysRefresh()">Refresh</button></div>';

    // Automated Surveys opt-in toggle
    var toggleColor = automatedSurveysEnabled ? 'var(--teal)' : 'var(--cream-dark)';
    var toggleLabel = automatedSurveysEnabled ? 'ON' : 'OFF';
    var toggleDisabled = automatedSurveysToggling ? ' disabled' : '';
    html += '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:14px 18px;background:var(--surface-card);margin-bottom:18px;display:flex;align-items:center;gap:14px;">';
    html += '<button onclick="csToggleAutomatedSurveys()"' + toggleDisabled + ' style="flex-shrink:0;width:48px;height:26px;border-radius:13px;border:none;cursor:' + (automatedSurveysToggling ? 'not-allowed' : 'pointer') + ';background:' + toggleColor + ';position:relative;transition:background 0.2s;padding:0;">';
    html += '<span style="position:absolute;top:3px;' + (automatedSurveysEnabled ? 'right:3px' : 'left:3px') + ';width:20px;height:20px;border-radius:50%;background:#fff;display:block;transition:all 0.2s;"></span>';
    html += '</button>';
    html += '<div style="flex:1;">';
    html += '<div style="font-weight:600;font-size:0.95rem;">Automated Surveys <span style="margin-left:6px;font-size:0.78rem;font-weight:700;color:' + (automatedSurveysEnabled ? 'var(--teal)' : 'var(--warm-gray)') + ';">' + toggleLabel + '</span></div>';
    html += '<div style="font-size:0.82rem;color:var(--warm-gray);margin-top:2px;">When enabled, surveys are sent automatically based on your active trigger rules below.</div>';
    html += '</div></div>';

    html += '<div class="view-tabs" style="margin-bottom:18px;">';
    [['questions','Questions'],['groups','Groups'],['surveys','Surveys'],['triggers','Triggers']].forEach(function (p) {
      html += '<button class="view-tab' + (surveysSubTab === p[0] ? ' active' : '') + '" onclick="csSurveysSwitchTab(\'' + p[0] + '\')">' + p[1] + '</button>';
    });
    html += '</div>';
    if (surveysSubTab === 'questions')       html += renderQuestionsTab();
    else if (surveysSubTab === 'groups')     html += renderGroupsTab();
    else if (surveysSubTab === 'surveys')    html += renderSurveysDefTab();
    else if (surveysSubTab === 'triggers')   html += renderTriggersTab();
    if (sendLinkSurveyId) {
      var sv = surveysDefData[sendLinkSurveyId];
      html += '<div style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;display:flex;align-items:center;justify-content:center;">';
      html += '<div style="background:var(--bg);border-radius:12px;padding:24px;width:min(440px,90vw);box-shadow:0 8px 32px rgba(0,0,0,0.3);">';
      html += '<h3 style="margin:0 0 4px;">Send Survey</h3><div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">' + _esc(sv ? sv.name : sendLinkSurveyId) + '</div>';
      html += '<div style="margin-bottom:12px;"><label style="display:block;font-weight:600;font-size:0.9rem;margin-bottom:4px;">Contact Email *</label><input id="csSendEmail" type="email" class="form-input" style="width:100%;box-sizing:border-box;" placeholder="customer@example.com"></div>';
      html += '<div style="margin-bottom:18px;"><label style="display:block;font-weight:600;font-size:0.9rem;margin-bottom:4px;">Contact Name</label><input id="csSendName" type="text" class="form-input" style="width:100%;box-sizing:border-box;" placeholder="Optional"></div>';
      html += '<div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-secondary" onclick="csSendLinkCancel()">Cancel</button><button class="btn btn-primary" onclick="csSendLinkSubmit()">Send Invite</button></div>';
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
      if (q.isStock) html += '<span style="margin-left:8px;background:rgba(42,124,111,0.15);color:var(--teal);padding:1px 8px;border-radius:10px;font-size:0.75rem;">stock</span>';
      if (q.type === 'multiple_choice' && q.options && q.options.length) html += '<div style="font-size:0.8rem;color:var(--warm-gray);margin-top:3px;">Options: ' + q.options.map(function (o) { return _esc(o); }).join(', ') + '</div>';
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
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Question Text *</label>';
    html += '<input id="csQText" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(q.text || '') : '') + '" placeholder="Enter question text"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Type</label>';
    html += '<select id="csQType" class="form-select" style="width:100%;" onchange="csQTypeChange(this.value)">';
    ['rating','NPS','yes_no','multiple_choice','open_text'].forEach(function (t) { html += '<option value="' + t + '"' + (typeVal === t ? ' selected' : '') + '>' + t + '</option>'; });
    html += '</select></div>';
    html += '<div id="csQOptionsRow" style="margin-bottom:10px;' + (typeVal === 'multiple_choice' ? '' : 'display:none;') + '">';
    html += '<label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Options (comma-separated)</label>';
    html += '<input id="csQOptions" class="form-input" style="width:100%;box-sizing:border-box;" value="' + _esc(optVal) + '" placeholder="Option A, Option B"></div>';
    var reqChecked = isEdit ? (q.required !== false) : true;
    html += '<div style="margin-bottom:12px;"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.88rem;">';
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
    var options = type === 'multiple_choice' ? optRaw.split(',').map(function (o) { return o.trim(); }).filter(Boolean) : [];
    try {
      if (id) { await MastDB.update('cs_survey_questions/' + id, { text: text, type: type, options: options, required: required, updatedAt: nowIso() }); if (questionsData[id]) Object.assign(questionsData[id], { text: text, type: type, options: options, required: required }); questionEditId = null; showToast('Question updated'); }
      else { var nk = MastDB.newKey('cs_survey_questions'); var doc = { id: nk, text: text, type: type, options: options, required: required, isStock: false, createdAt: nowIso(), updatedAt: nowIso() }; await MastDB.set('cs_survey_questions/' + nk, doc); questionsData[nk] = doc; showAddQuestion = false; showToast('Question added'); }
      renderSurveys();
    } catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function deleteQuestion(id) {
    if (!confirm('Delete this question?')) return;
    try { await MastDB.remove('cs_survey_questions/' + id); delete questionsData[id]; showToast('Question deleted'); renderSurveys(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }

  function renderGroupsTab() {
    var items = Object.values(groupsData).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1; });
    var html = showAddGroup ? renderGroupForm(null) : '<button class="btn btn-primary btn-small" onclick="csShowAddGroup()" style="margin-bottom:14px;">+ Add Group</button>';
    if (!items.length && !showAddGroup) return html + '<div style="padding:24px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No groups yet.</div>';
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    items.forEach(function (g) {
      if (groupEditId === g.id) { html += renderGroupForm(g); return; }
      var qc = (g.questionIds || []).length;
      html += '<div style="border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;background:var(--surface-card);display:flex;align-items:center;gap:10px;">';
      html += '<div style="flex:1;"><span style="font-weight:600;">' + _esc(g.name) + '</span>';
      if (g.eventType) html += '<span style="margin-left:8px;font-size:0.78rem;color:var(--warm-gray);">' + _esc(g.eventType) + '</span>';
      html += '<span style="margin-left:8px;font-size:0.78rem;color:var(--warm-gray);">' + qc + ' question' + (qc !== 1 ? 's' : '') + '</span>';
      if (g.isActive === false) html += '<span style="margin-left:8px;background:rgba(220,38,38,0.15);color:var(--danger);padding:1px 8px;border-radius:10px;font-size:0.75rem;">inactive</span>';
      html += '</div><button class="btn btn-secondary btn-small" onclick="csEditGroup(\'' + _esc(g.id) + '\')">Edit</button>';
      html += '<button class="btn btn-danger btn-small" onclick="csDeleteGroup(\'' + _esc(g.id) + '\')">Delete</button></div>';
    });
    return html + '</div>';
  }

  function renderGroupForm(g) {
    var isEdit = !!g, id = isEdit ? _esc(g.id) : '', selectedIds = isEdit && g.questionIds ? g.questionIds : [];
    var qItems = Object.values(questionsData);
    var html = '<div style="border:2px solid var(--amber-light);border-radius:10px;padding:16px;background:var(--surface-card);margin-bottom:12px;">';
    html += '<h4 style="margin:0 0 12px;">' + (isEdit ? 'Edit Group' : 'New Group') + '</h4>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Name *</label>';
    html += '<input id="csGName" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(g.name || '') : '') + '" placeholder="e.g. Post-Purchase Survey"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Event Type</label>';
    html += '<input id="csGEventType" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(g.eventType || '') : '') + '" placeholder="e.g. order_complete"></div>';
    html += '<div style="margin-bottom:12px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:6px;">Questions</label>';
    html += '<div style="max-height:160px;overflow-y:auto;border:1px solid var(--cream-dark);border-radius:6px;padding:8px;background:var(--bg);">';
    if (!qItems.length) { html += '<div style="font-size:0.85rem;color:var(--warm-gray);">No questions — add some first.</div>'; }
    else { qItems.forEach(function (q) { html += '<label style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:0.88rem;cursor:pointer;"><input type="checkbox" name="csGQIds" value="' + _esc(q.id) + '"' + (selectedIds.indexOf(q.id) >= 0 ? ' checked' : '') + '>' + _esc(q.text) + ' <span style="color:var(--warm-gray);font-size:0.75rem;">[' + _esc(q.type) + ']</span></label>'; }); }
    html += '</div></div>';
    html += '<div style="display:flex;gap:8px;"><button class="btn btn-primary btn-small" onclick="csSaveGroup(\'' + id + '\')">' + (isEdit ? 'Save' : 'Add') + '</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="csCancelGroup()">Cancel</button></div></div>';
    return html;
  }

  async function saveGroup(id) {
    var name = ((document.getElementById('csGName') || {}).value || '').trim();
    var et = ((document.getElementById('csGEventType') || {}).value || '').trim();
    if (!name) { showToast('Group name is required', true); return; }
    var qIds = []; document.querySelectorAll('input[name="csGQIds"]:checked').forEach(function (cb) { qIds.push(cb.value); });
    try {
      if (id) { await MastDB.update('cs_survey_groups/' + id, { name: name, eventType: et, questionIds: qIds, updatedAt: nowIso() }); if (groupsData[id]) Object.assign(groupsData[id], { name: name, eventType: et, questionIds: qIds }); groupEditId = null; showToast('Group updated'); }
      else { var nk = MastDB.newKey('cs_survey_groups'); var doc = { id: nk, name: name, eventType: et, questionIds: qIds, isActive: true, createdAt: nowIso(), updatedAt: nowIso() }; await MastDB.set('cs_survey_groups/' + nk, doc); groupsData[nk] = doc; showAddGroup = false; showToast('Group added'); }
      renderSurveys();
    } catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function deleteGroup(id) {
    if (!confirm('Delete this group?')) return;
    try { await MastDB.remove('cs_survey_groups/' + id); delete groupsData[id]; showToast('Group deleted'); renderSurveys(); }
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
      html += '<div style="font-size:0.83rem;color:var(--warm-gray);margin-bottom:' + (sv.closesAt ? '4px' : '10px') + ';">Group: ' + _esc(grp ? grp.name : (sv.groupId || 'none')) + '</div>';
      if (sv.closesAt) { html += '<div style="font-size:0.83rem;color:' + (isClosed ? 'var(--danger)' : 'var(--warm-gray)') + ';margin-bottom:10px;">' + (isClosed ? 'Closed ' : 'Closes ') + relativeTime(sv.closesAt) + '</div>'; }
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
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Name *</label>';
    html += '<input id="csSvName" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(sv.name || '') : '') + '" placeholder="Survey name"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Group *</label>';
    html += '<select id="csSvGroup" class="form-select" style="width:100%;"><option value="">— select group —</option>';
    Object.values(groupsData).forEach(function (g) { html += '<option value="' + _esc(g.id) + '"' + (isEdit && sv.groupId === g.id ? ' selected' : '') + '>' + _esc(g.name) + '</option>'; });
    html += '</select></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Status</label>';
    html += '<select id="csSvStatus" class="form-select" style="width:100%;">';
    ['draft','active','inactive'].forEach(function (s) { html += '<option value="' + s + '"' + (statusVal === s ? ' selected' : '') + '>' + s + '</option>'; });
    html += '</select></div>';
    var closesAtVal = isEdit && sv.closesAt ? sv.closesAt.substring(0, 16) : '';
    html += '<div style="margin-bottom:12px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Closes at <span style="font-weight:400;color:var(--warm-gray);">(optional)</span></label>';
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
    if (!name) { showToast('Survey name is required', true); return; }
    if (!groupId) { showToast('Please select a group', true); return; }
    try {
      if (id) { await MastDB.update('cs_surveys/' + id, { name: name, groupId: groupId, status: status, closesAt: closesAt, updatedAt: nowIso() }); if (surveysDefData[id]) Object.assign(surveysDefData[id], { name: name, groupId: groupId, status: status, closesAt: closesAt }); surveyEditId = null; showToast('Survey updated'); }
      else { var nk = MastDB.newKey('cs_surveys'); var ts = genTokenSecret(); var doc = { id: nk, name: name, groupId: groupId, status: status, closesAt: closesAt, tokenSecret: ts, createdAt: nowIso(), updatedAt: nowIso() }; await MastDB.set('cs_surveys/' + nk, doc); var cached = Object.assign({}, doc); delete cached.tokenSecret; surveysDefData[nk] = cached; showAddSurvey = false; showToast('Survey created'); }
      renderSurveys();
    } catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function deleteSurvey(id) {
    if (!confirm('Delete this survey? Existing responses will remain.')) return;
    try { await MastDB.remove('cs_surveys/' + id); delete surveysDefData[id]; showToast('Survey deleted'); renderSurveys(); }
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
      html += '<span style="margin-left:8px;font-size:0.83rem;color:var(--warm-gray);">→ ' + _esc(sv ? sv.name : (t.surveyId || '—')) + '</span>';
      if (t.delayHours) html += '<span style="margin-left:8px;font-size:0.78rem;color:var(--warm-gray);">' + _esc(String(t.delayHours)) + 'h delay</span>';
      html += '</div>';
      html += '<span style="background:' + (isActive ? 'rgba(42,124,111,0.15)' : 'rgba(0,0,0,0.10)') + ';color:' + (isActive ? 'var(--teal)' : 'var(--warm-gray)') + ';padding:2px 10px;border-radius:12px;font-size:0.75rem;">' + (isActive ? 'active' : 'inactive') + '</span>';
      html += '<button class="btn btn-secondary btn-small" onclick="csEditTrigger(\'' + _esc(t.id) + '\')">Edit</button>';
      html += '<button class="btn btn-danger btn-small" onclick="csDeleteTrigger(\'' + _esc(t.id) + '\')">Delete</button></div>';
    });
    return html + '</div>';
  }

  function renderTriggerForm(t) {
    var isEdit = !!t, id = isEdit ? _esc(t.id) : '', isActive = isEdit ? (t.isActive !== false) : true;
    var html = '<div style="border:2px solid var(--amber-light);border-radius:10px;padding:16px;background:var(--surface-card);margin-bottom:12px;">';
    html += '<h4 style="margin:0 0 12px;">' + (isEdit ? 'Edit Trigger' : 'New Trigger') + '</h4>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Event Type *</label>';
    html += '<input id="csTEventType" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(t.eventType || '') : '') + '" placeholder="e.g. order_complete"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Survey *</label>';
    html += '<select id="csTSurveyId" class="form-select" style="width:100%;"><option value="">— select survey —</option>';
    Object.values(surveysDefData).forEach(function (sv) { html += '<option value="' + _esc(sv.id) + '"' + (isEdit && t.surveyId === sv.id ? ' selected' : '') + '>' + _esc(sv.name) + '</option>'; });
    html += '</select></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Delay (hours)</label>';
    html += '<input id="csTDelay" type="number" min="0" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(String(t.delayHours || 0)) : '0') + '"></div>';
    html += '<div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;"><input type="checkbox" id="csTActive"' + (isActive ? ' checked' : '') + '><label for="csTActive" style="font-size:0.88rem;">Active</label></div>';
    html += '<div style="display:flex;gap:8px;"><button class="btn btn-primary btn-small" onclick="csSaveTrigger(\'' + id + '\')">' + (isEdit ? 'Save' : 'Add') + '</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="csCancelTrigger()">Cancel</button></div></div>';
    return html;
  }

  async function saveTrigger(id) {
    var et = ((document.getElementById('csTEventType') || {}).value || '').trim();
    var svId = (document.getElementById('csTSurveyId') || {}).value || '';
    var delay = Number((document.getElementById('csTDelay') || {}).value) || 0;
    var active = !!((document.getElementById('csTActive') || {}).checked);
    if (!et) { showToast('Event type is required', true); return; }
    if (!svId) { showToast('Please select a survey', true); return; }
    try {
      if (id) { await MastDB.update('cs_survey_triggers/' + id, { eventType: et, surveyId: svId, delayHours: delay, isActive: active, updatedAt: nowIso() }); if (triggersData[id]) Object.assign(triggersData[id], { eventType: et, surveyId: svId, delayHours: delay, isActive: active }); triggerEditId = null; showToast('Trigger updated'); }
      else { var nk = MastDB.newKey('cs_survey_triggers'); var doc = { id: nk, eventType: et, surveyId: svId, delayHours: delay, isActive: active, createdAt: nowIso(), updatedAt: nowIso() }; await MastDB.set('cs_survey_triggers/' + nk, doc); triggersData[nk] = doc; showAddTrigger = false; showToast('Trigger added'); }
      renderSurveys();
    } catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }
  async function deleteTrigger(id) {
    if (!confirm('Delete this trigger?')) return;
    try { await MastDB.remove('cs_survey_triggers/' + id); delete triggersData[id]; showToast('Trigger deleted'); renderSurveys(); }
    catch (err) { showToast('Failed: ' + (err && err.message), true); }
  }

  function renderFaqs() {
    var tab = document.getElementById('csFaqsTab');
    if (!tab) return;
    if (!policiesLoaded) { tab.innerHTML = '<div style="padding:40px;text-align:center;color:var(--warm-gray);">Loading policies…</div>'; return; }
    var items = Object.values(policiesData).sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; });
    var html = '<div style="padding:24px;">';
    html += '<div class="section-header" style="margin-bottom:14px;"><h2 style="margin:0;">FAQs &amp; Policies</h2><button class="btn btn-secondary btn-small" onclick="csFaqsRefresh()">Refresh</button></div>';
    html += showAddPolicy ? renderPolicyForm(null) : '<button class="btn btn-primary btn-small" onclick="csShowAddPolicy()" style="margin-bottom:14px;">+ New Policy</button>';
    if (!items.length && !showAddPolicy) {
      html += '<div style="padding:24px;text-align:center;color:var(--warm-gray);border:1px dashed var(--cream-dark);border-radius:10px;">No policies yet. Create one to show on your storefront.</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:10px;">';
      items.forEach(function (p) {
        if (policyEditId === p.id) { html += renderPolicyForm(p); return; }
        html += '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:14px 16px;background:var(--surface-card);">';
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">';
        html += '<span style="font-weight:600;">' + _esc(p.name) + '</span>';
        html += '<span style="font-size:0.8rem;color:var(--warm-gray);font-family:monospace;">/' + _esc(p.slug || '') + '</span>';
        html += '<span style="margin-left:auto;background:' + (p.storefrontEnabled ? 'rgba(42,124,111,0.15)' : 'rgba(0,0,0,0.10)') + ';color:' + (p.storefrontEnabled ? 'var(--teal)' : 'var(--warm-gray)') + ';padding:2px 10px;border-radius:12px;font-size:0.75rem;">' + (p.storefrontEnabled ? 'live' : 'hidden') + '</span></div>';
        if (p.contentHtml) { var preview = p.contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); html += '<div style="font-size:0.82rem;color:var(--warm-gray);margin-bottom:10px;">' + _esc(preview) + (preview.length === 100 ? '…' : '') + '</div>'; }
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
    var html = '<div style="border:2px solid var(--amber-light);border-radius:10px;padding:16px;background:var(--surface-card);margin-bottom:12px;">';
    html += '<h4 style="margin:0 0 12px;">' + (isEdit ? 'Edit Policy' : 'New Policy') + '</h4>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Name *</label>';
    html += '<input id="csPName" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(p.name || '') : '') + '" placeholder="e.g. Return Policy" oninput="csAutofillPolicySlug(this.value,' + (isEdit ? 'false' : 'true') + ')"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Slug</label>';
    html += '<input id="csPSlug" class="form-input" style="width:100%;box-sizing:border-box;" value="' + (isEdit ? _esc(p.slug || '') : '') + '" placeholder="return-policy"></div>';
    html += '<div style="margin-bottom:10px;"><label style="font-weight:600;font-size:0.88rem;display:block;margin-bottom:4px;">Content (HTML)</label>';
    html += '<textarea id="csPContent" class="form-input" rows="10" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:0.82rem;">' + (isEdit ? _esc(p.contentHtml || '') : '') + '</textarea></div>';
    html += '<div style="margin-bottom:14px;display:flex;align-items:center;gap:8px;"><input type="checkbox" id="csPStorefront"' + (isEdit && p.storefrontEnabled ? ' checked' : '') + '><label for="csPStorefront" style="font-size:0.88rem;cursor:pointer;">Show on storefront</label></div>';
    html += '<div style="display:flex;gap:8px;"><button class="btn btn-primary btn-small" onclick="csSavePolicy(\'' + id + '\')">' + (isEdit ? 'Save' : 'Create') + '</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="csCancelPolicy()">Cancel</button></div></div>';
    return html;
  }

  async function savePolicy(id) {
    var name = ((document.getElementById('csPName') || {}).value || '').trim();
    var slug = ((document.getElementById('csPSlug') || {}).value || '').trim();
    var content = (document.getElementById('csPContent') || {}).value || '';
    var sf = !!((document.getElementById('csPStorefront') || {}).checked);
    if (!name) { showToast('Policy name is required', true); return; }
    var slugVal = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try {
      if (id) { await MastDB.update('cs_policies/' + id, { name: name, slug: slugVal, contentHtml: content, storefrontEnabled: sf, updatedAt: nowIso() }); if (policiesData[id]) Object.assign(policiesData[id], { name: name, slug: slugVal, contentHtml: content, storefrontEnabled: sf }); policyEditId = null; showToast('Policy updated'); }
      else { var nk = MastDB.newKey('cs_policies'); var doc = { id: nk, name: name, slug: slugVal, contentHtml: content, storefrontEnabled: sf, createdAt: nowIso(), updatedAt: nowIso() }; await MastDB.set('cs_policies/' + nk, doc); policiesData[nk] = doc; showAddPolicy = false; showToast('Policy created'); }
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
    var tdStyle = 'padding:9px 12px;font-size:0.87rem;border-bottom:1px solid var(--cream-dark);';

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
    var tdStyle = 'padding:9px 12px;font-size:0.87rem;border-bottom:1px solid var(--cream-dark);';

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

  window.csReviewsRefresh = function () { reviewsLoaded = false; renderReviews(); loadReviews().then(renderReviews); };
  window.csReviewsSetFilter = function (f) { reviewsFilter = f; renderReviews(); };
  window.csApproveReview = approveReview;
  window.csRejectReview = rejectReview;
  window.csDeleteReview = deleteReview;
  window.csSurveysRefresh = function () { surveysLoaded = false; renderSurveys(); loadSurveysAll().then(renderSurveys); };
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
  window.csSendLink = function (id) { sendLinkSurveyId = id; renderSurveys(); };
  window.csSendLinkCancel = function () { sendLinkSurveyId = null; renderSurveys(); };
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
  window.csTogglePolicyStorefront = togglePolicyStorefront;
  window.csAutofillPolicySlug = function (name, doIt) { if (!doIt) return; var el = document.getElementById('csPSlug'); if (el) el.value = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

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
      var msgId = 'msg_' + Date.now().toString(36);
      var now = new Date().toISOString();
      var msgData = {
        id: msgId,
        body: body,
        direction: 'outbound',
        isInternal: wasInternal,
        authorName: (window.currentUser && currentUser.displayName) || null,
        authorEmail: (window.currentUser && currentUser.email) || null,
        createdAt: now
      };

      await MastDB.set('cs_tickets/' + selectedTicketId + '/messages/' + msgId, msgData);
      await MastDB.update('cs_tickets/' + selectedTicketId, { updatedAt: now });

      // Update in-memory caches
      threadMessages.push(msgData);
      var idx = ticketsData.findIndex(function(t) { return t.id === selectedTicketId; });
      if (idx !== -1) ticketsData[idx].updatedAt = now;

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
      var now = new Date().toISOString();
      await MastDB.update('cs_tickets/' + selectedTicketId, { status: status, updatedAt: now });
      var idx = ticketsData.findIndex(function(t) { return t.id === selectedTicketId; });
      if (idx !== -1) { ticketsData[idx].status = status; ticketsData[idx].updatedAt = now; }
      showToast('Status updated to ' + (STATUS_LABELS[status] || status) + '.');
    } catch (err) {
      showToast('Failed to update status.', true);
    }
  }

  async function csUpdatePriority(priority) {
    if (!selectedTicketId) return;
    try {
      var now = new Date().toISOString();
      await MastDB.update('cs_tickets/' + selectedTicketId, { priority: priority, updatedAt: now });
      var idx = ticketsData.findIndex(function(t) { return t.id === selectedTicketId; });
      if (idx !== -1) { ticketsData[idx].priority = priority; ticketsData[idx].updatedAt = now; }
      showToast('Priority updated to ' + (PRIORITY_LABELS[priority] || priority) + '.');
    } catch (err) {
      showToast('Failed to update priority.', true);
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
      // Read ticket numbering config
      var config = await MastDB.get('cs_config/ticketing');
      var prefix = (config && config.prefix) || 'T';
      var nextNum = (config && typeof config.nextNumber === 'number') ? config.nextNumber : 1;
      var ticketNumber = prefix + '-' + String(nextNum).padStart(4, '0');

      var ticketId = 'ticket_' + Date.now().toString(36);
      var now = new Date().toISOString();
      var ticketData = {
        id: ticketId,
        ticketNumber: ticketNumber,
        subject: subject,
        status: 'open',
        priority: priority,
        source: source,
        contactEmail: contactEmail,
        contactName: contactName || null,
        createdAt: now,
        updatedAt: now,
        createdBy: (window.currentUser && currentUser.uid) || null
      };

      await MastDB.set('cs_tickets/' + ticketId, ticketData);

      if (firstMessage) {
        var msgId = 'msg_' + Date.now().toString(36);
        await MastDB.set('cs_tickets/' + ticketId + '/messages/' + msgId, {
          id: msgId,
          body: firstMessage,
          direction: 'inbound',
          isInternal: false,
          authorName: contactName || null,
          authorEmail: contactEmail,
          createdAt: now
        });
      }

      // Increment ticket counter
      if (!config) {
        await MastDB.set('cs_config/ticketing', { prefix: prefix, nextNumber: nextNum + 1 });
      } else {
        await MastDB.update('cs_config/ticketing', { nextNumber: nextNum + 1 });
      }

      // Prepend to in-memory list
      ticketsData.unshift(ticketData);
      showToast('Ticket ' + ticketNumber + ' created.');

      // Open the new thread
      await csOpenThread(ticketId);
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
  window.csSubmitCreate = csSubmitCreate;
  window.csSetInboxTab = csSetInboxTab;
  window.csSetStatusFilter = csSetStatusFilter;
  window.csSetPriorityFilter = csSetPriorityFilter;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

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
