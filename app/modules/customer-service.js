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
  // Stub render for Session E routes
  // ============================================================

  function renderStub(title) {
    return '<div class="placeholder-view">' +
      '<div class="placeholder-title">' + _esc(title) + '</div>' +
      '<div class="placeholder-note">Admin UI coming in Session E.</div>' +
      '</div>';
  }

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
      var snap = await MastDB.query('cs_tickets/' + ticketId + '/messages').limitToLast(100).once();
      threadMessages = snap ? Object.values(snap) : [];
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
          var tab = document.getElementById('csSurveysTab');
          if (tab) tab.innerHTML = renderStub('Surveys');
        }
      },
      'cs-reviews': {
        tab: 'csReviewsTab',
        setup: function() {
          var tab = document.getElementById('csReviewsTab');
          if (tab) tab.innerHTML = renderStub('Reviews');
        }
      },
      'cs-faqs': {
        tab: 'csFaqsTab',
        setup: function() {
          var tab = document.getElementById('csFaqsTab');
          if (tab) tab.innerHTML = renderStub('FAQs');
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
    }
  });

})();
