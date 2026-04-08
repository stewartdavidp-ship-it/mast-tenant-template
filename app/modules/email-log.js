/**
 * Email Log Module — View sent/failed email history for tenant
 * Lazy-loaded via MastAdmin module registry.
 * Reads from {tenantId}/emails/ in Firebase RTDB.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var emailsData = [];
  var emailsLoaded = false;
  var selectedEmailId = null;
  var emailFilter = 'all'; // all, sent, failed
  var emailTypeFilter = 'all';
  var emailPageSize = 50;
  var emailLastKey = null;
  var hasMoreEmails = false;

  // ============================================================
  // Badge Style Helpers
  // ============================================================

  var EMAIL_STATUS_BADGE_COLORS = {
    sent:   { bg: 'rgba(46,125,50,0.25)', color: '#66BB6A', border: 'rgba(46,125,50,0.4)' },
    failed: { bg: 'rgba(198,40,40,0.2)', color: '#EF5350', border: 'rgba(198,40,40,0.35)' }
  };

  function emailStatusBadgeStyle(status) {
    var c = EMAIL_STATUS_BADGE_COLORS[status] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

  var EMAIL_TYPE_BADGE_COLORS = {
    'order-confirmed':  { bg: 'rgba(21,101,192,0.2)', color: '#64B5F6', border: 'rgba(21,101,192,0.35)' },
    'order-shipped':    { bg: 'rgba(69,39,160,0.2)', color: '#B39DDB', border: 'rgba(69,39,160,0.35)' },
    'order-delivered':  { bg: 'rgba(46,125,50,0.25)', color: '#66BB6A', border: 'rgba(46,125,50,0.4)' },
    'order-cancelled':  { bg: 'rgba(198,40,40,0.2)', color: '#EF5350', border: 'rgba(198,40,40,0.35)' },
    'commission':       { bg: 'rgba(123,31,162,0.2)', color: '#CE93D8', border: 'rgba(123,31,162,0.35)' },
    'receipt':          { bg: 'rgba(6,95,70,0.25)', color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    'test':             { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' },
    'newsletter':       { bg: 'rgba(30,64,175,0.2)', color: '#64B5F6', border: 'rgba(30,64,175,0.35)' }
  };

  function emailTypeBadgeStyle(type) {
    var c = EMAIL_TYPE_BADGE_COLORS[type] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

  var PROVIDER_LABELS = {
    'gmail': 'Gmail',
    'sendgrid': 'SendGrid',
    'resend': 'Resend',
    'custom': 'Custom',
    'mast-managed': 'Mast'
  };

  // ============================================================
  // Data Loading
  // ============================================================

  function loadEmails(append) {
    var ref = MastDB._ref('emails');
    var query = ref.orderByKey().limitToLast(emailPageSize + 1);
    if (append && emailLastKey) {
      query = ref.orderByKey().endAt(emailLastKey).limitToLast(emailPageSize + 1);
    }

    query.once('value').then(function(snap) {
      var val = snap.val() || {};
      var keys = Object.keys(val).sort().reverse();

      // Check if there are more pages
      if (keys.length > emailPageSize) {
        hasMoreEmails = true;
        keys = keys.slice(0, emailPageSize);
      } else {
        hasMoreEmails = false;
      }

      if (keys.length > 0) {
        emailLastKey = keys[keys.length - 1];
        // On the next page request, we need to go before this key
        // Adjust: endAt returns inclusive, so subtract to avoid dupe
        var nextEndKey = keys[keys.length - 1];
        // We'll store the raw key and handle dupe in next fetch
      }

      var newItems = keys.map(function(k) {
        var item = val[k];
        item._key = k;
        return item;
      });

      if (append) {
        // Remove any duplicate of the first item from previous page
        if (emailsData.length > 0 && newItems.length > 0 && newItems[0]._key === emailsData[emailsData.length - 1]._key) {
          newItems.shift();
        }
        emailsData = emailsData.concat(newItems);
      } else {
        emailsData = newItems;
      }

      emailsLoaded = true;
      renderEmailLog();
    }).catch(function(err) {
      console.error('Failed to load emails:', err);
      showToast('Failed to load email log: ' + err.message, true);
    });
  }

  // ============================================================
  // Rendering
  // ============================================================

  function renderEmailLog() {
    var container = document.getElementById('emailLogContent');
    if (!container) return;
    var filtered = emailsData;

    // Apply status filter
    if (emailFilter !== 'all') {
      filtered = filtered.filter(function(e) { return e.status === emailFilter; });
    }

    // Apply type filter
    if (emailTypeFilter !== 'all') {
      filtered = filtered.filter(function(e) { return e.emailType === emailTypeFilter; });
    }

    var h = '';
    h += '<div class="section-header" style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<h2>Email Log</h2>';
    h += '<span style="font-size:0.85rem;color:var(--warm-gray);">' + emailsData.length + ' emails loaded</span>';
    h += '</div>';

    // Filter bar
    h += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">';
    h += '<select id="emailStatusFilter" onchange="window._emailLogFilterStatus()" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">';
    h += '<option value="all"' + (emailFilter === 'all' ? ' selected' : '') + '>All Status</option>';
    h += '<option value="sent"' + (emailFilter === 'sent' ? ' selected' : '') + '>Sent</option>';
    h += '<option value="failed"' + (emailFilter === 'failed' ? ' selected' : '') + '>Failed</option>';
    h += '</select>';
    h += '<select id="emailTypeFilterSelect" onchange="window._emailLogFilterType()" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">';
    h += '<option value="all"' + (emailTypeFilter === 'all' ? ' selected' : '') + '>All Types</option>';
    // Collect unique types
    var types = {};
    emailsData.forEach(function(e) { if (e.emailType) types[e.emailType] = true; });
    Object.keys(types).sort().forEach(function(t) {
      h += '<option value="' + esc(t) + '"' + (emailTypeFilter === t ? ' selected' : '') + '>' + esc(t) + '</option>';
    });
    h += '</select>';
    h += '<button class="btn btn-secondary" style="font-size:0.85rem;padding:6px 12px;" onclick="window._emailLogRefresh()">&#x21bb; Refresh</button>';
    h += '</div>';

    if (!emailsLoaded) {
      h += '<p style="color:var(--warm-gray);font-size:0.9rem;">Loading...</p>';
      container.innerHTML = h;
      return;
    }

    if (filtered.length === 0) {
      h += '<p style="color:var(--warm-gray);font-size:0.9rem;">No emails found' + (emailFilter !== 'all' || emailTypeFilter !== 'all' ? ' matching filters' : '') + '.</p>';
      container.innerHTML = h;
      return;
    }

    // Table
    h += '<div style="overflow-x:auto;">';
    h += '<table class="data-table" style="width:100%;border-collapse:collapse;">';
    h += '<thead><tr>';
    h += '<th style="text-align:left;padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);border-bottom:1px solid rgba(255,255,255,0.06);">Date</th>';
    h += '<th style="text-align:left;padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);border-bottom:1px solid rgba(255,255,255,0.06);">Recipient</th>';
    h += '<th style="text-align:left;padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);border-bottom:1px solid rgba(255,255,255,0.06);">Subject</th>';
    h += '<th style="text-align:left;padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);border-bottom:1px solid rgba(255,255,255,0.06);">Type</th>';
    h += '<th style="text-align:left;padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);border-bottom:1px solid rgba(255,255,255,0.06);">Status</th>';
    h += '<th style="text-align:left;padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);border-bottom:1px solid rgba(255,255,255,0.06);">Provider</th>';
    h += '</tr></thead>';
    h += '<tbody>';

    filtered.forEach(function(email) {
      var isExpanded = selectedEmailId === email._key;
      var dateStr = email.createdAt ? formatEmailDate(email.createdAt) : '—';
      var recipient = email.to || '—';
      var subject = email.subject || '(no subject)';
      var emailType = email.emailType || '—';
      var status = email.status || 'unknown';
      var provider = PROVIDER_LABELS[email.provider] || email.provider || '—';

      h += '<tr onclick="window._emailLogSelect(\'' + esc(email._key) + '\')" style="cursor:pointer;transition:background 0.15s;' + (isExpanded ? 'background:rgba(255,255,255,0.04);' : '') + '" onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'' + (isExpanded ? 'rgba(255,255,255,0.04)' : 'transparent') + '\'">';
      h += '<td style="padding:8px 12px;font-size:0.85rem;white-space:nowrap;">' + esc(dateStr) + '</td>';
      h += '<td style="padding:8px 12px;font-size:0.85rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;">' + esc(recipient) + '</td>';
      h += '<td style="padding:8px 12px;font-size:0.85rem;max-width:250px;overflow:hidden;text-overflow:ellipsis;">' + esc(subject) + '</td>';
      h += '<td style="padding:8px 12px;"><span style="' + emailTypeBadgeStyle(emailType) + 'padding:2px 8px;border-radius:12px;font-size:0.78rem;font-weight:600;">' + esc(emailType) + '</span></td>';
      h += '<td style="padding:8px 12px;"><span style="' + emailStatusBadgeStyle(status) + 'padding:2px 8px;border-radius:12px;font-size:0.78rem;font-weight:600;">' + esc(status) + '</span></td>';
      h += '<td style="padding:8px 12px;font-size:0.85rem;">' + esc(provider) + '</td>';
      h += '</tr>';

      // Expanded detail row
      if (isExpanded) {
        h += '<tr><td colspan="6" style="padding:0;border-bottom:1px solid rgba(255,255,255,0.06);">';
        h += renderEmailDetail(email);
        h += '</td></tr>';
      }
    });

    h += '</tbody></table>';
    h += '</div>';

    // Load more button
    if (hasMoreEmails) {
      h += '<div style="text-align:center;margin-top:16px;">';
      h += '<button class="btn btn-secondary" onclick="window._emailLogLoadMore()" style="font-size:0.85rem;padding:8px 20px;">Load More</button>';
      h += '</div>';
    }

    container.innerHTML = h;
  }

  function renderEmailDetail(email) {
    var h = '';
    h += '<div style="padding:16px 24px;background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.04);">';

    // Meta info
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:12px;margin-bottom:16px;">';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">From</span><span style="font-size:0.85rem;">' + esc(email.from || '—') + '</span></div>';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">To</span><span style="font-size:0.85rem;">' + esc(email.to || '—') + '</span></div>';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">Provider</span><span style="font-size:0.85rem;">' + esc(PROVIDER_LABELS[email.provider] || email.provider || '—') + '</span></div>';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">Token Cost</span><span style="font-size:0.85rem;">' + (email.tokenCost || 0) + '</span></div>';
    if (email.orderId) {
      h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">Order ID</span><span style="font-size:0.85rem;cursor:pointer;color:var(--teal);text-decoration:underline;" onclick="event.stopPropagation(); MastAdmin.navigateTo(\'orders\');">' + esc(email.orderId) + '</span></div>';
    }
    if (email.error) {
      h += '<div style="grid-column:1/-1;"><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">Error</span><span style="font-size:0.85rem;color:#EF5350;">' + esc(email.error) + '</span></div>';
    }
    h += '</div>';

    // HTML preview (sandboxed iframe)
    if (email.htmlSnapshot) {
      h += '<div style="margin-bottom:12px;">';
      h += '<span style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:6px;">Email Preview</span>';
      h += '<div style="background:white;border-radius:6px;overflow:hidden;max-height:400px;">';
      // Use srcdoc for sandboxed preview — no scripts, no navigation
      h += '<iframe sandbox="" srcdoc="' + escAttr(email.htmlSnapshot) + '" style="width:100%;min-height:250px;max-height:400px;border:none;display:block;" onload="this.style.height=Math.min(this.contentDocument.body.scrollHeight+20,400)+\'px\'"></iframe>';
      h += '</div>';
      h += '</div>';
    }

    // Resend button
    h += '<div style="display:flex;gap:8px;">';
    h += '<button class="btn btn-secondary" style="font-size:0.85rem;padding:6px 12px;" onclick="event.stopPropagation(); window._emailLogResend(\'' + esc(email._key) + '\')">Resend</button>';
    h += '</div>';

    h += '</div>';
    return h;
  }

  // ============================================================
  // Helpers
  // ============================================================

  function formatEmailDate(isoStr) {
    try {
      var d = new Date(isoStr);
      var now = new Date();
      var diffMs = now - d;
      var diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return diffMins + 'm ago';
      var diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return diffHours + 'h ago';
      // Format as date
      var month = d.toLocaleString('en-US', { month: 'short' });
      var day = d.getDate();
      var year = d.getFullYear();
      var time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      if (year === now.getFullYear()) return month + ' ' + day + ', ' + time;
      return month + ' ' + day + ', ' + year;
    } catch (e) {
      return isoStr || '—';
    }
  }

  function escAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================
  // Actions
  // ============================================================

  function selectEmail(key) {
    selectedEmailId = (selectedEmailId === key) ? null : key;
    renderEmailLog();
  }

  function filterStatus() {
    var el = document.getElementById('emailStatusFilter');
    emailFilter = el ? el.value : 'all';
    renderEmailLog();
  }

  function filterType() {
    var el = document.getElementById('emailTypeFilterSelect');
    emailTypeFilter = el ? el.value : 'all';
    renderEmailLog();
  }

  function refreshEmails() {
    emailsData = [];
    emailLastKey = null;
    hasMoreEmails = false;
    selectedEmailId = null;
    loadEmails(false);
  }

  function loadMoreEmails() {
    loadEmails(true);
  }

  async function resendEmail(key) {
    var email = emailsData.find(function(e) { return e._key === key; });
    if (!email) return;
    if (!email.to) {
      showToast('No recipient address on this email.', true);
      return;
    }
    if (!await mastConfirm('Resend this email to ' + email.to + '?', { title: 'Resend Email' })) return;

    try {
      var result = await firebase.functions().httpsCallable('sendTestEmail')({ toEmail: email.to });
      showToast('Email resent to ' + result.data.sentTo);
      // Reload to show the new log entry
      setTimeout(function() { refreshEmails(); }, 1000);
    } catch (err) {
      showToast('Resend failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Window-scoped callbacks (for onclick handlers in rendered HTML)
  // ============================================================

  window._emailLogSelect = selectEmail;
  window._emailLogFilterStatus = filterStatus;
  window._emailLogFilterType = filterType;
  window._emailLogRefresh = refreshEmails;
  window._emailLogLoadMore = loadMoreEmails;
  window._emailLogResend = resendEmail;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('emailLog', {
    routes: {
      'email-log': { tab: 'emailLogTab', setup: function() { if (!emailsLoaded) loadEmails(false); } }
    },
    detachListeners: function() {
      emailsData = [];
      emailsLoaded = false;
      selectedEmailId = null;
      emailLastKey = null;
      hasMoreEmails = false;
    }
  });

})();
