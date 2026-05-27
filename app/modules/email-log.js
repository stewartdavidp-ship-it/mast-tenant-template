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
  var emailCategoryFilter = 'all'; // 'Orders' | 'Returns' | … | 'Other' | 'Unknown' | 'all'
  var emailPageSize = 50;
  var emailLastCreatedAt = null;
  var hasMoreEmails = false;
  var emailSortKey = 'createdAt';
  var emailSortDir = 'desc';

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
    var ref = MastDB.query('emails');
    var query = ref.orderByChild('createdAt').limitToLast(emailPageSize + 1);
    if (append && emailLastCreatedAt) {
      query = ref.orderByChild('createdAt').endAt(emailLastCreatedAt).limitToLast(emailPageSize + 1);
    }

    query.once('value').then(function(snap) {
      var val = snap.val() || {};
      // Firestore auto IDs aren't time-ordered, so sort docs by createdAt DESC for newest-first display.
      var keys = Object.keys(val).sort(function(a, b) {
        var ca = (val[a] && val[a].createdAt) || '';
        var cb = (val[b] && val[b].createdAt) || '';
        if (cb < ca) return -1;
        if (cb > ca) return 1;
        return 0;
      });

      // Check if there are more pages
      if (keys.length > emailPageSize) {
        hasMoreEmails = true;
        keys = keys.slice(0, emailPageSize);
      } else {
        hasMoreEmails = false;
      }

      if (keys.length > 0) {
        var oldest = val[keys[keys.length - 1]];
        emailLastCreatedAt = (oldest && oldest.createdAt) || null;
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

    // Apply category + type filters first to define the "scoped" set, then
    // derive Sent/Failed counts from that scope so the pill counts reflect
    // what's currently being shown (e.g. Classes 26 → Sent 24 / Failed 2).
    var scoped = emailsData;
    if (emailTypeFilter !== 'all') {
      scoped = scoped.filter(function(e) { return e.emailType === emailTypeFilter; });
    }
    if (emailCategoryFilter !== 'all') {
      var _registry = (typeof window.EMAIL_TRIGGER_REGISTRY !== 'undefined') ? window.EMAIL_TRIGGER_REGISTRY : [];
      var _t2m = {};
      _registry.forEach(function(t) { if (t.emailType && t.module) _t2m[t.emailType] = t.module; });
      scoped = scoped.filter(function(e) {
        var cat = (e.emailType && _t2m[e.emailType]) || (e.emailType ? 'Other' : 'Unknown');
        return cat === emailCategoryFilter;
      });
    }
    var statusCounts = { all: scoped.length, sent: 0, failed: 0 };
    scoped.forEach(function(e) {
      if (e.status === 'sent') statusCounts.sent++;
      else if (e.status === 'failed') statusCounts.failed++;
    });

    // Apply status filter on top of the scoped set.
    var filtered = (emailFilter === 'all') ? scoped : scoped.filter(function(e) { return e.status === emailFilter; });

    // Date range covered by the loaded set — emails are ordered desc by
    // createdAt; the OLDEST loaded record's date is the back edge of the
    // window. Surfaces "what does 50 emails actually cover?" without
    // forcing the user to scroll to the bottom.
    var sinceLabel = '';
    if (emailsLoaded && emailsData.length > 0) {
      var oldest = emailsData[emailsData.length - 1];
      if (oldest && oldest.createdAt) {
        try {
          var od = new Date(oldest.createdAt);
          sinceLabel = ' · since ' + od.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) {}
      }
    }

    var h = '';
    h += '<div class="section-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">';
    h += '<h2>Email Log</h2>';
    h += '<div style="display:flex;align-items:center;gap:12px;">';
    h += '<span style="font-size:0.85rem;color:var(--warm-gray);">' + emailsData.length + ' loaded' + esc(sinceLabel) + '</span>';
    if (hasMoreEmails) {
      h += '<button class="btn btn-secondary" style="font-size:0.85rem;padding:6px 14px;" onclick="window._emailLogLoadMore()">Load More</button>';
    }
    h += '</div>';
    h += '</div>';

    // Category summary tiles — count emails per module (feedback 5TI5LpdU4QpbQlm6RkB4).
    // emailType → module mapping comes from EMAIL_TRIGGER_REGISTRY (global on
    // window). Unknown types bucket into "Other" so nothing is hidden.
    if (emailsLoaded && emailsData.length > 0) {
      var typeToModule = {};
      var registry = (typeof window.EMAIL_TRIGGER_REGISTRY !== 'undefined') ? window.EMAIL_TRIGGER_REGISTRY : [];
      registry.forEach(function(t) { if (t.emailType && t.module) typeToModule[t.emailType] = t.module; });

      var counts = {};
      emailsData.forEach(function(e) {
        var cat = (e.emailType && typeToModule[e.emailType]) || (e.emailType ? 'Other' : 'Unknown');
        counts[cat] = (counts[cat] || 0) + 1;
      });

      // Stable display order: known modules first (alpha), then Other/Unknown.
      var knownCats = Object.keys(counts).filter(function(c) { return c !== 'Other' && c !== 'Unknown'; }).sort();
      var tailCats = ['Other', 'Unknown'].filter(function(c) { return counts[c] != null; });
      var orderedCats = knownCats.concat(tailCats);

      // Tile colors keyed by category for instant scanability.
      var TILE_COLORS = {
        Orders:      { bg: 'rgba(42,124,111,0.12)',  fg: 'var(--teal,#2a7c6f)' },
        Returns:     { bg: 'rgba(220,53,69,0.12)',   fg: '#f49aa3' },
        Classes:     { bg: 'rgba(196,133,60,0.18)',  fg: 'var(--amber-light,#fbcc70)' },
        Commissions: { bg: 'rgba(168,85,247,0.15)',  fg: '#c8a8f5' },
        Reviews:     { bg: 'rgba(234,179,8,0.15)',   fg: '#eab308' },
        Surveys:     { bg: 'rgba(20,184,166,0.15)',  fg: '#5eead4' },
        Contacts:    { bg: 'rgba(99,102,241,0.15)',  fg: '#a5a8f5' },
        POS:         { bg: 'rgba(245,158,11,0.12)',  fg: '#f59e0b' },
        Team:        { bg: 'rgba(59,130,246,0.15)',  fg: '#3b82f6' },
        Waivers:     { bg: 'rgba(120,120,120,0.18)', fg: 'var(--text-secondary,#a09890)' },
        Other:       { bg: 'rgba(120,120,120,0.12)', fg: 'var(--warm-gray,#888)' },
        Unknown:     { bg: 'rgba(120,120,120,0.10)', fg: 'var(--warm-gray,#888)' }
      };

      // Tiles are click-to-filter. Total resets, category tiles narrow to
      // that module's emails. Active tile gets a bright outline + scale.
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">';
      var totalActive = emailCategoryFilter === 'all';
      h += '<div onclick="window._emailLogFilterCategory(\'all\')" title="Show all categories" ' +
             'style="background:rgba(255,255,255,0.04);border:1px solid ' + (totalActive ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.06)') + ';' +
             'border-radius:10px;padding:10px 14px;min-width:90px;cursor:pointer;transition:transform 0.1s,border-color 0.1s;' + (totalActive ? 'transform:scale(1.03);' : '') + '" ' +
             'onmouseover="this.style.borderColor=\'rgba(255,255,255,0.4)\'" onmouseout="this.style.borderColor=\'' + (totalActive ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.06)') + '\'">' +
             '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Total</div>' +
             '<div style="font-size:1.15rem;font-weight:600;color:var(--text,#e0e0e0);">' + emailsData.length.toLocaleString() + '</div>' +
           '</div>';
      orderedCats.forEach(function(cat) {
        var c = TILE_COLORS[cat] || TILE_COLORS.Other;
        var isActive = emailCategoryFilter === cat;
        var activeBorder = isActive ? c.fg : c.bg;
        var activeScale = isActive ? 'transform:scale(1.03);' : '';
        h += '<div onclick="window._emailLogFilterCategory(\'' + esc(cat) + '\')" title="Filter to ' + esc(cat) + ' only" ' +
               'style="background:' + c.bg + ';border:1px solid ' + activeBorder + ';border-radius:10px;padding:10px 14px;min-width:90px;' +
               'cursor:pointer;transition:transform 0.1s,border-color 0.1s;' + activeScale + '" ' +
               'onmouseover="this.style.borderColor=\'' + c.fg + '\'" onmouseout="this.style.borderColor=\'' + activeBorder + '\'">' +
               '<div style="font-size:0.72rem;color:' + c.fg + ';text-transform:uppercase;letter-spacing:0.5px;">' + esc(cat) + '</div>' +
               '<div style="font-size:1.15rem;font-weight:600;color:' + c.fg + ';">' + counts[cat].toLocaleString() + '</div>' +
             '</div>';
      });
      h += '</div>';
    }

    // Filter bar
    h += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">';
    // Q6 sweep: status as pills (3 bounded options). Email Type stays as
    // dropdown below — unbounded option set (one per distinct emailType).
    h += '<div class="order-filter-pills" data-filter-for="emailStatusFilter" style="margin:0;"></div>';
    h += '<select id="emailStatusFilter" onchange="window._emailLogFilterStatus()" style="display:none;">';
    h += '<option value="all"' + (emailFilter === 'all' ? ' selected' : '') + '>All Status (' + statusCounts.all + ')</option>';
    h += '<option value="sent"' + (emailFilter === 'sent' ? ' selected' : '') + '>Sent (' + statusCounts.sent + ')</option>';
    h += '<option value="failed"' + (emailFilter === 'failed' ? ' selected' : '') + '>Failed (' + statusCounts.failed + ')</option>';
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
    // Active-filter chip — surfaces the category tile filter inside the pill
    // row so the active narrowing is visible from a single eye-line. Click
    // the × to clear the category filter (returns to Total).
    if (emailCategoryFilter !== 'all') {
      var chipColors = (typeof TILE_COLORS !== 'undefined' ? TILE_COLORS : null);
      var chipC = chipColors && chipColors[emailCategoryFilter] ? chipColors[emailCategoryFilter] : { bg: 'rgba(120,120,120,0.18)', fg: 'var(--warm-gray,#888)' };
      h += '<span style="display:inline-flex;align-items:center;gap:6px;background:' + chipC.bg + ';color:' + chipC.fg + ';border:1px solid ' + chipC.fg + ';border-radius:14px;padding:4px 10px;font-size:0.78rem;font-weight:500;">' +
             'Filtering: ' + esc(emailCategoryFilter) +
             '<button type="button" onclick="window._emailLogFilterCategory(\'all\')" title="Clear category filter" style="background:transparent;border:0;color:inherit;cursor:pointer;font-size:0.9rem;line-height:1;padding:0 0 0 2px;">×</button>' +
           '</span>';
    }
    h += '<button class="btn btn-secondary" style="font-size:0.85rem;padding:6px 12px;" onclick="window._emailLogRefresh()">&#x21bb; Refresh</button>';
    h += '</div>';

    if (!emailsLoaded) {
      h += '<p style="color:var(--warm-gray);font-size:0.9rem;">Loading...</p>';
      container.innerHTML = h;
      if (window.mastInitFilterPills) window.mastInitFilterPills(container);
      return;
    }

    if (filtered.length === 0) {
      h += '<p style="color:var(--warm-gray);font-size:0.9rem;">No emails found' + (emailFilter !== 'all' || emailTypeFilter !== 'all' ? ' matching filters' : '') + '.</p>';
      container.innerHTML = h;
      if (window.mastInitFilterPills) window.mastInitFilterPills(container);
      return;
    }

    // Table
    h += '<div style="overflow-x:auto;">';
    // Sort filtered rows per current header state.
    var sorted = (typeof window.mastSortRows === 'function')
      ? window.mastSortRows(filtered, emailSortKey, emailSortDir, function(row, key) {
          if (key === 'provider') return PROVIDER_LABELS[row.provider] || row.provider || '';
          return row && row[key];
        })
      : filtered;

    h += '<table class="data-table" style="width:100%;border-collapse:collapse;">';
    h += '<thead><tr>';
    if (typeof window.mastSortableTh === 'function') {
      h += window.mastSortableTh('Date',      'createdAt', emailSortKey, emailSortDir, 'window._emailLogSort');
      h += window.mastSortableTh('Recipient', 'to',        emailSortKey, emailSortDir, 'window._emailLogSort');
      h += window.mastSortableTh('Subject',   'subject',   emailSortKey, emailSortDir, 'window._emailLogSort');
      h += window.mastSortableTh('Type',      'emailType', emailSortKey, emailSortDir, 'window._emailLogSort');
      h += window.mastSortableTh('Status',    'status',    emailSortKey, emailSortDir, 'window._emailLogSort');
      h += window.mastSortableTh('Provider',  'provider',  emailSortKey, emailSortDir, 'window._emailLogSort');
    } else {
      // Helper not loaded — degrade to non-sortable headers.
      ['Date','Recipient','Subject','Type','Status','Provider'].forEach(function(l) {
        h += '<th style="text-align:left;padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);border-bottom:1px solid rgba(255,255,255,0.06);">' + l + '</th>';
      });
    }
    h += '</tr></thead>';
    h += '<tbody>';

    sorted.forEach(function(email) {
      var dateStr = email.createdAt ? formatEmailDate(email.createdAt) : '—';
      var recipient = email.to || '—';
      var subject = email.subject || '(no subject)';
      var emailType = email.emailType || '—';
      var status = email.status || 'unknown';
      var provider = PROVIDER_LABELS[email.provider] || email.provider || '—';

      h += '<tr onclick="window._emailLogSelect(\'' + esc(email._key) + '\')" style="cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseout="this.style.background=\'transparent\'">';
      h += '<td style="padding:8px 12px;font-size:0.85rem;white-space:nowrap;">' + esc(dateStr) + '</td>';
      h += '<td style="padding:8px 12px;font-size:0.85rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;">' + esc(recipient) + '</td>';
      h += '<td style="padding:8px 12px;font-size:0.85rem;max-width:250px;overflow:hidden;text-overflow:ellipsis;">' + esc(subject) + '</td>';
      h += '<td style="padding:8px 12px;"><span style="' + emailTypeBadgeStyle(emailType) + 'padding:2px 8px;border-radius:12px;font-size:0.78rem;font-weight:600;">' + esc(emailType) + '</span></td>';
      h += '<td style="padding:8px 12px;"><span style="' + emailStatusBadgeStyle(status) + 'padding:2px 8px;border-radius:12px;font-size:0.78rem;font-weight:600;">' + esc(status) + '</span></td>';
      h += '<td style="padding:8px 12px;font-size:0.85rem;">' + esc(provider) + '</td>';
      h += '</tr>';
    });

    h += '</tbody></table>';
    h += '</div>';
    // Load More moved to the section header top-right (next to the
    // loaded-count label) — see renderEmailLog header block above.

    container.innerHTML = h;
    if (window.mastInitFilterPills) window.mastInitFilterPills(container);
  }

  function renderEmailDetailBody(email) {
    // Body content for the mastSlideOut panel. Header (subject/recipient),
    // close button, and Resend action live on the slide-out chrome — this
    // function returns only the inner detail content.
    var h = '';

    // Meta info
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));gap:12px;margin-bottom:16px;">';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">From</span><span style="font-size:0.85rem;">' + esc(email.from || '—') + '</span></div>';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">To</span><span style="font-size:0.85rem;">' + esc(email.to || '—') + '</span></div>';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">Provider</span><span style="font-size:0.85rem;">' + esc(PROVIDER_LABELS[email.provider] || email.provider || '—') + '</span></div>';
    h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">Token Cost</span><span style="font-size:0.85rem;">' + (email.tokenCost || 0) + '</span></div>';
    if (email.emailType) {
      h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">Type</span><span style="' + emailTypeBadgeStyle(email.emailType) + 'padding:2px 8px;border-radius:12px;font-size:0.78rem;font-weight:600;">' + esc(email.emailType) + '</span></div>';
    }
    if (email.orderId) {
      h += '<div><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">Order ID</span><a href="#orders" style="font-size:0.85rem;color:var(--teal);text-decoration:underline;">' + esc(email.orderId) + '</a></div>';
    }
    if (email.error) {
      h += '<div style="grid-column:1/-1;"><span style="font-size:0.78rem;color:var(--warm-gray);display:block;">Error</span><span style="font-size:0.85rem;color:#EF5350;">' + esc(email.error) + '</span></div>';
    }
    h += '</div>';

    // HTML preview (sandboxed iframe)
    if (email.htmlSnapshot) {
      h += '<div style="margin-bottom:12px;">';
      h += '<span style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:6px;">Email Preview <span style="font-weight:400;opacity:0.6;">(light theme — emails are designed for email client display)</span></span>';
      h += '<div style="background:white;border-radius:6px;overflow:hidden;max-height:480px;">';
      h += '<iframe sandbox="" srcdoc="' + escAttr(email.htmlSnapshot) + '" style="width:100%;min-height:300px;max-height:480px;border:none;display:block;" onload="try{if(this.contentDocument&&this.contentDocument.body)this.style.height=Math.min(this.contentDocument.body.scrollHeight+20,480)+\'px\';}catch(e){}"></iframe>';
      h += '</div>';
      h += '</div>';
    }
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
    var email = emailsData.find(function(e) { return e._key === key; });
    if (!email) return;
    selectedEmailId = key;
    if (window.mastSlideOut && typeof window.mastSlideOut.open === 'function') {
      var status = email.status || 'unknown';
      var dateStr = email.createdAt ? formatEmailDate(email.createdAt) : '—';
      var subtitle = (email.to || '—') + ' · ' + dateStr;
      window.mastSlideOut.open({
        title: email.subject || '(no subject)',
        subtitle: subtitle,
        bodyHtml: renderEmailDetailBody(email),
        footerHtml: '<span style="' + emailStatusBadgeStyle(status) + 'padding:2px 8px;border-radius:12px;font-size:0.78rem;font-weight:600;margin-right:auto;">' + esc(status) + '</span>' +
                    '<button class="btn btn-secondary" style="font-size:0.85rem;padding:6px 12px;" onclick="window._emailLogResend(\'' + esc(key) + '\')">Resend</button>',
        onClose: function() { selectedEmailId = null; }
      });
    } else {
      // Fallback (helper not loaded) — keep legacy inline-expand behavior.
      selectedEmailId = (selectedEmailId === key) ? null : key;
      renderEmailLog();
    }
  }

  function sortBy(key) {
    if (emailSortKey === key) {
      emailSortDir = (emailSortDir === 'asc') ? 'desc' : 'asc';
    } else {
      emailSortKey = key;
      // Default direction: dates start desc (newest first), text fields asc.
      emailSortDir = (key === 'createdAt') ? 'desc' : 'asc';
    }
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
    // Selecting a specific type from the dropdown clears the category tile
    // filter — mutually exclusive narrowing controls (see renderEmailLog).
    if (emailTypeFilter !== 'all') emailCategoryFilter = 'all';
    renderEmailLog();
  }

  function filterCategory(cat) {
    emailCategoryFilter = cat || 'all';
    // Clear type dropdown to keep the active narrowing source obvious.
    if (emailCategoryFilter !== 'all') emailTypeFilter = 'all';
    renderEmailLog();
  }

  function refreshEmails() {
    emailsData = [];
    emailLastCreatedAt = null;
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
  window._emailLogSort = sortBy;
  window._emailLogFilterStatus = filterStatus;
  window._emailLogFilterType = filterType;
  window._emailLogFilterCategory = filterCategory;
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
      emailLastCreatedAt = null;
      hasMoreEmails = false;
    }
  });

})();
