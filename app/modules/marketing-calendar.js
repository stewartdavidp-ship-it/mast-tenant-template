/**
 * Marketing Calendar Module — W2.1
 *
 * Read-only aggregator across blog/newsletter/social/stories. Renders a
 * month-grid or list view of upcoming + recent marketing activity. Each
 * tile click navigates to the source module's detail.
 *
 * No new content model. Pure aggregator. Lazy-loaded module.
 */
(function() {
  'use strict';

  var view = 'month'; // 'month' | 'list'
  var monthCursor = new Date(); // first of current month
  monthCursor.setDate(1);
  monthCursor.setHours(0, 0, 0, 0);

  var events = []; // normalized [{ id, type, title, date(Date), status, sourceUrl, raw }]
  var loaded = false;
  var loading = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeDate(v) {
    if (!v) return null;
    var t;
    if (typeof v === 'number') t = v;
    else if (typeof v === 'string') t = new Date(v).getTime();
    else if (v && v.seconds) t = v.seconds * 1000;
    else t = NaN;
    if (!t || isNaN(t)) return null;
    return new Date(t);
  }

  async function loadAll() {
    if (loading) return;
    loading = true;
    var collected = [];

    // Blog posts
    try {
      var blog = (await MastDB.list('blog/posts')) || {};
      Object.keys(blog).forEach(function(k) {
        var p = blog[k] || {};
        var d = safeDate(p.publishedAt || p.scheduledAt || p.updatedAt || p.createdAt);
        if (!d) return;
        collected.push({
          id: p.id || k,
          type: 'blog',
          title: p.title || '(untitled blog post)',
          date: d,
          status: p.status || '',
          sourceUrl: 'blog?postId=' + (p.id || k)
        });
      });
    } catch (e) { console.warn('[W2.1 calendar] blog', e); }

    // Newsletter issues
    try {
      var nl = (await MastDB.list('newsletter/issues')) || {};
      Object.keys(nl).forEach(function(k) {
        var n = nl[k] || {};
        var d = safeDate(n.scheduledFor || n.sentAt || n.publishedAt || n.updatedAt || n.createdAt);
        if (!d) return;
        collected.push({
          id: n.id || k,
          type: 'newsletter',
          title: n.subject || n.title || ('Issue #' + (n.issueNumber || k)),
          date: d,
          status: n.status || '',
          sourceUrl: 'newsletter'
        });
      });
    } catch (e) { console.warn('[W2.1 calendar] newsletter', e); }

    // Social posts (nested under uid)
    try {
      var market = (await MastDB.get('market/posts')) || {};
      Object.keys(market).forEach(function(uid) {
        var posts = market[uid] || {};
        Object.keys(posts).forEach(function(pid) {
          var sp = posts[pid] || {};
          var d = safeDate(sp.scheduledFor || sp.postedAt || sp.scoredAt || sp.createdAt);
          if (!d) return;
          collected.push({
            id: pid,
            type: 'social',
            title: (sp.caption || sp.title || '(social post)').slice(0, 60),
            date: d,
            status: sp.status || '',
            sourceUrl: 'social',
            channel: sp.channel || ''
          });
        });
      });
    } catch (e) { console.warn('[W2.1 calendar] social', e); }

    // Stories
    try {
      var stories = (await MastDB.list('public/stories')) || {};
      Object.keys(stories).forEach(function(k) {
        var st = stories[k] || {};
        var d = safeDate(st.publishedAt || st.scheduledFor || st.updatedAt || st.createdAt);
        if (!d) return;
        collected.push({
          id: st.id || k,
          type: 'story',
          title: st.title || '(story)',
          date: d,
          status: st.status || '',
          sourceUrl: 'stories'
        });
      });
    } catch (e) { console.warn('[W2.1 calendar] stories', e); }

    events = collected;
    loaded = true;
    loading = false;
  }

  function typeIcon(t) {
    switch (t) {
      case 'blog':       return '\u{1F4DD}'; // 📝
      case 'newsletter': return '\u{2709}️'; // ✉️
      case 'social':     return '\u{1F4F1}'; // 📱
      case 'story':      return '\u{1F4D6}'; // 📖
      default:           return '\u{1F4CB}';
    }
  }

  function typeColor(t) {
    switch (t) {
      case 'blog':       return '#3b82f6';
      case 'newsletter': return '#16a34a';
      case 'social':     return '#a855f7';
      case 'story':      return '#f59e0b';
      default:           return '#888';
    }
  }

  async function render() {
    var host = document.getElementById('marketingCalendarTab');
    if (!host) return;
    if (!loaded) {
      host.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading marketing calendar...</div>';
      await loadAll();
    }
    if (view === 'list') renderList(host);
    else renderMonth(host);
  }
  window.renderMarketingCalendar = render;

  function renderHeader() {
    var monthName = monthCursor.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    return '<div class="section-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<h2 style="margin:0;">Marketing Calendar</h2>' +
        '<span style="font-size:0.78rem;color:var(--warm-gray);">Aggregated from Blog / Newsletter / Social / Stories</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        (view === 'month'
          ? '<button class="btn btn-secondary btn-small" onclick="mktCalPrev()">&larr;</button>' +
            '<span style="font-weight:600;font-size:0.9rem;min-width:140px;text-align:center;">' + esc(monthName) + '</span>' +
            '<button class="btn btn-secondary btn-small" onclick="mktCalNext()">&rarr;</button>' +
            '<button class="btn btn-secondary btn-small" onclick="mktCalToday()" style="margin-left:8px;">Today</button>'
          : '') +
        '<button class="btn ' + (view === 'month' ? 'btn-primary' : 'btn-secondary') + ' btn-small" onclick="mktCalSetView(\'month\')">Month</button>' +
        '<button class="btn ' + (view === 'list' ? 'btn-primary' : 'btn-secondary') + ' btn-small" onclick="mktCalSetView(\'list\')">List</button>' +
      '</div>' +
    '</div>';
  }

  function renderMonth(host) {
    var year = monthCursor.getFullYear();
    var month = monthCursor.getMonth();
    var first = new Date(year, month, 1);
    var last = new Date(year, month + 1, 0);
    var startDow = first.getDay(); // 0=Sun
    var daysInMonth = last.getDate();

    // Bucket events by yyyy-mm-dd within this month
    var bucket = {};
    events.forEach(function(e) {
      if (e.date.getFullYear() !== year || e.date.getMonth() !== month) return;
      var key = e.date.getDate();
      if (!bucket[key]) bucket[key] = [];
      bucket[key].push(e);
    });

    var html = renderHeader();
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;background:var(--cream-dark);border:1px solid var(--cream-dark);font-size:0.78rem;">';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function(d) {
      html += '<div style="background:var(--cream);padding:6px 4px;text-align:center;font-weight:600;color:var(--warm-gray);">' + d + '</div>';
    });
    // Empty cells before day 1
    for (var i = 0; i < startDow; i++) {
      html += '<div style="background:var(--surface-dark,#f5f5f5);min-height:80px;"></div>';
    }
    var today = new Date();
    var isToday = function(d) {
      return d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    };
    for (var d = 1; d <= daysInMonth; d++) {
      var evs = bucket[d] || [];
      html += '<div style="background:var(--surface-card,#fff);min-height:80px;padding:4px;border:' + (isToday(d) ? '2px solid var(--amber)' : '1px solid transparent') + ';">' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:2px;">' + d + '</div>';
      evs.slice(0, 4).forEach(function(e) {
        html += '<div onclick="mktCalGoto(\'' + esc(e.sourceUrl) + '\')" title="' + esc(e.title) + '" style="cursor:pointer;background:' + typeColor(e.type) + ';color:#fff;border-radius:3px;padding:2px 4px;margin-bottom:2px;font-size:0.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          typeIcon(e.type) + ' ' + esc(e.title.slice(0, 26)) + '</div>';
      });
      if (evs.length > 4) {
        html += '<div style="font-size:0.72rem;color:var(--warm-gray);">+' + (evs.length - 4) + ' more</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    host.innerHTML = html;
  }

  function renderList(host) {
    var html = renderHeader();
    var sorted = events.slice().sort(function(a, b) { return b.date - a.date; });
    if (!sorted.length) {
      html += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">No marketing activity yet.</div>';
      host.innerHTML = html;
      return;
    }
    html += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-top:8px;">' +
      '<thead><tr style="border-bottom:1px solid var(--cream-dark);text-align:left;">' +
        '<th style="padding:6px;">Date</th><th style="padding:6px;">Type</th>' +
        '<th style="padding:6px;">Title</th><th style="padding:6px;">Status</th>' +
      '</tr></thead><tbody>';
    sorted.forEach(function(e) {
      html += '<tr onclick="mktCalGoto(\'' + esc(e.sourceUrl) + '\')" style="cursor:pointer;border-bottom:1px solid var(--cream);">' +
        '<td style="padding:6px;">' + esc(e.date.toLocaleDateString()) + '</td>' +
        '<td style="padding:6px;color:' + typeColor(e.type) + ';font-weight:600;">' + typeIcon(e.type) + ' ' + esc(e.type) + '</td>' +
        '<td style="padding:6px;">' + esc(e.title) + '</td>' +
        '<td style="padding:6px;color:var(--warm-gray);">' + esc(e.status) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
  }

  // ─── Public nav handlers ───

  function mktCalPrev() { monthCursor.setMonth(monthCursor.getMonth() - 1); render(); }
  function mktCalNext() { monthCursor.setMonth(monthCursor.getMonth() + 1); render(); }
  function mktCalToday() { monthCursor = new Date(); monthCursor.setDate(1); monthCursor.setHours(0,0,0,0); render(); }
  function mktCalSetView(v) { view = v; render(); }
  function mktCalGoto(hash) { if (hash) location.hash = hash; }
  window.mktCalPrev = mktCalPrev;
  window.mktCalNext = mktCalNext;
  window.mktCalToday = mktCalToday;
  window.mktCalSetView = mktCalSetView;
  window.mktCalGoto = mktCalGoto;

  MastAdmin.registerModule('marketingCalendar', {
    routes: {
      'marketing-calendar': {
        tab: 'marketingCalendarTab',
        setup: function() { render(); }
      }
    }
  });
})();
