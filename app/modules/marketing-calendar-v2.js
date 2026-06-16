/**
 * marketing-calendar-v2.js — the MARKETING CALENDAR rebuilt as a CALENDAR
 * index control (doc 17 §10), mirroring calendar-v2.js. A marketing calendar is
 * an alternate INDEX lens over content that already lives elsewhere: it
 * aggregates blog posts, newsletter issues, social posts, and stories by date
 * and plots each occurrence on a month grid. A click OUTPUTS the entry you
 * clicked in a focused slide-out, whose drill navigates to the SOURCE artifact
 * (blog/newsletter/social/stories). Read-only navigation proxy — no records are
 * created or edited here; the source module owns the record.
 *
 * Flag-gated (uiRedesign); self-mounts on route marketing-calendar-v2
 * side-by-side with the legacy marketing-calendar aggregator.
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
  if (!window.MastAdmin || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;
  var now = new Date();
  // view: 'month' (the calendar-control index) | 'list' (a flat date-sorted
  // table of the SAME aggregated events) — mirrors the legacy marketing-calendar
  // Month/List toggle. Pure client-side view state; no new reads or writes.
  var CAL = { year: now.getFullYear(), month: now.getMonth(), view: 'month', events: [], byId: {}, loaded: false };

  // Read budget per source — bound every collection read (lint-unbounded-read).
  var READ_LIMIT = 500;

  // Source type → presentation. Color is carried as a badge tone (no hex /
  // no stylesheet — engine-first). Each type also knows its drill target.
  var TYPE_META = {
    blog:       { label: 'Blog',       tone: 'teal' },
    newsletter: { label: 'Newsletter', tone: 'success' },
    social:     { label: 'Social',     tone: 'warning' },
    story:      { label: 'Story',      tone: 'amber' }
  };
  function typeLabel(t) { return (TYPE_META[t] || {}).label || 'Item'; }
  function typeTone(t) { return (TYPE_META[t] || {}).tone || 'neutral'; }

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
  function dateKey(d) {
    var m = String(d.getMonth() + 1); if (m.length < 2) m = '0' + m;
    var day = String(d.getDate()); if (day.length < 2) day = '0' + day;
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // ── Data: aggregate the same sources the legacy marketing-calendar reads ──
  function load() {
    if (!window.MastDB || typeof MastDB.list !== 'function') { render(); return; }
    var blogP = Promise.resolve(MastDB.list('blog/posts', { limit: READ_LIMIT })).catch(function () { return {}; });
    var nlP = Promise.resolve(MastDB.list('newsletter/issues', { limit: READ_LIMIT })).catch(function () { return {}; });
    var socialP = (typeof MastDB.get === 'function')
      ? Promise.resolve(MastDB.get('market/posts')).catch(function () { return {}; })
      : Promise.resolve({});
    var storyP = Promise.resolve(MastDB.list('public/stories', { limit: READ_LIMIT })).catch(function () { return {}; });

    Promise.all([blogP, nlP, socialP, storyP]).then(function (res) {
      var collected = [];

      // Blog posts → source route blog-v2 (drill carries the post id).
      var blog = res[0] || {};
      Object.keys(blog).forEach(function (k) {
        var p = blog[k] || {};
        var d = safeDate(p.publishedAt || p.scheduledAt || p.updatedAt || p.createdAt);
        if (!d) return;
        collected.push({
          id: 'blog:' + (p.id || k), type: 'blog', title: p.title || '(untitled blog post)',
          date: d, status: p.status || '', srcId: p.id || k
        });
      });

      // Newsletter issues → source route newsletter-v2.
      var nl = res[1] || {};
      Object.keys(nl).forEach(function (k) {
        var n = nl[k] || {};
        var d = safeDate(n.scheduledFor || n.sentAt || n.publishedAt || n.updatedAt || n.createdAt);
        if (!d) return;
        collected.push({
          id: 'newsletter:' + (n.id || k), type: 'newsletter',
          title: n.subject || n.title || ('Issue ' + (n.issueNumber || k)),
          date: d, status: n.status || '', srcId: n.id || k
        });
      });

      // Social posts (nested under uid) → classic social view (no v2 twin).
      var market = res[2] || {};
      Object.keys(market).forEach(function (uid) {
        var posts = market[uid] || {};
        Object.keys(posts).forEach(function (pid) {
          var sp = posts[pid] || {};
          var d = safeDate(sp.scheduledFor || sp.postedAt || sp.scoredAt || sp.createdAt);
          if (!d) return;
          collected.push({
            id: 'social:' + pid, type: 'social',
            title: String(sp.caption || sp.title || '(social post)').slice(0, 80),
            date: d, status: sp.status || '', srcId: pid, channel: sp.channel || ''
          });
        });
      });

      // Stories → source route stories-v2.
      var stories = res[3] || {};
      Object.keys(stories).forEach(function (k) {
        var st = stories[k] || {};
        var d = safeDate(st.publishedAt || st.scheduledFor || st.updatedAt || st.createdAt);
        if (!d) return;
        collected.push({
          id: 'story:' + (st.id || k), type: 'story', title: st.title || '(story)',
          date: d, status: st.status || '', srcId: st.id || k
        });
      });

      CAL.events = collected;
      CAL.byId = {}; CAL.events.forEach(function (e) { CAL.byId[e.id] = e; });
      CAL.loaded = true;
      render();
    }).catch(function (e) { console.error('[marketing-calendar-v2] load', e); render(); });
  }

  function entriesByDate() {
    var by = {};
    CAL.events.forEach(function (e) {
      if (e.date.getFullYear() !== CAL.year || e.date.getMonth() !== CAL.month) return;
      var ds = dateKey(e.date);
      (by[ds] = by[ds] || []).push({ id: e.id, label: typeLabel(e.type) + ': ' + e.title, tone: typeTone(e.type) });
    });
    Object.keys(by).forEach(function (d) { by[d].sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); }); });
    return by;
  }

  // ── Render (the calendar control is the index) ──────────────────────
  function ensureTab() {
    var el = document.getElementById('marketingCalendarV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'marketingCalendarV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }
  // Month/List toggle (mirrors the legacy marketing-calendar header control).
  // Engine-first: btn-primary marks the active lens, btn-secondary the other.
  function viewToggle() {
    function btn(v, label) {
      var on = CAL.view === v;
      return '<button class="btn ' + (on ? 'btn-primary' : 'btn-secondary') + ' btn-small" ' +
        'onclick="MarketingCalendarV2.setView(\'' + v + '\')">' + label + '</button>';
    }
    return btn('month', 'Month') + ' ' + btn('list', 'List');
  }

  // List lens — the SAME aggregated events as the month grid, flattened and
  // sorted newest-first, on the engine list primitive. Clicking a row OUTPUTS
  // the entry in the same slide-out the month grid uses (openEntry).
  function listView() {
    var rows = CAL.events.slice().sort(function (a, b) { return b.date - a.date; });
    return U.list({
      columns: [
        { key: 'date', label: 'Date', render: function (r) { return r.date ? N.date(r.date) : '—'; } },
        { key: 'type', label: 'Type', render: function (r) { return U.badge(typeLabel(r.type), typeTone(r.type)); } },
        { key: 'title', label: 'Title', render: function (r) { return esc(r.title); } },
        { key: 'status', label: 'Status', render: function (r) { return r.status ? U.badge(r.status, 'neutral') : '—'; } }
      ],
      rows: rows,
      rowId: function (r) { return r.id; },
      onRowClickFnName: 'MarketingCalendarV2.openEntry',
      empty: { title: 'No marketing activity yet', message: CAL.loaded ? 'Blog posts, newsletter issues, social posts and stories will appear here.' : 'Loading…' }
    });
  }

  function render() {
    var tab = ensureTab();
    var body = (CAL.view === 'list')
      ? listView()
      : U.calendar({
          year: CAL.year, month: CAL.month, entriesByDate: entriesByDate(),
          onEntryFnName: 'MarketingCalendarV2.openEntry', onNavFnName: 'MarketingCalendarV2.nav'
        });
    tab.innerHTML =
      U.pageHeader({
        title: 'Marketing Calendar',
        count: N.count(CAL.events.length) + (CAL.events.length === 1 ? ' item' : ' items'),
        actionsHtml: viewToggle()
      }) +
      '<div style="color:var(--warm-gray);font-size:0.78rem;margin:-6px 0 12px;">Aggregated from Blog / Newsletter / Social / Stories</div>' +
      body;
  }

  // ── Detail: clicking an entry OUTPUTS it; drill goes to the SOURCE ──
  function openEntry(e) {
    var label = typeLabel(e.type);
    var body = U.card(label, U.kv([
      { k: 'Type', v: U.badge(label, typeTone(e.type)) },
      { k: 'Title', v: esc(e.title) },
      { k: 'Date', v: e.date ? N.date(e.date) : '—' },
      { k: 'Status', v: e.status ? U.badge(e.status, 'neutral') : '—' },
      (e.channel ? { k: 'Channel', v: esc(e.channel) } : null)
    ].filter(Boolean))) +
    '<div style="margin-top:8px;"><button class="btn btn-secondary" onclick="MarketingCalendarV2.drill(\'' + esc(e.id) + '\')">View in ' + esc(label) + ' &rarr;</button></div>';
    U.slideOut.open({
      id: 'mkt-' + e.id, size: 'md', mode: 'read',
      title: e.title,
      badges: [{ label: label, tone: typeTone(e.type) }],
      render: function () { return body; }
    });
  }

  // Map an entry → its source route. blog/newsletter/story have V2 twins, so
  // navigateTo (the V2 remap carries us to the twin); social-v2 landed in
  // marketing Wave 1, so every source now drills to its twin.
  function drillTo(e) {
    try { U.slideOut.requestClose(); } catch (err) {}
    var route = { blog: 'blog', newsletter: 'newsletter', story: 'stories', social: 'social' }[e.type];
    if (route && typeof navigateTo === 'function') navigateTo(route, { id: e.srcId });
  }

  window.MarketingCalendarV2 = {
    setView: function (v) { CAL.view = (v === 'list') ? 'list' : 'month'; render(); },
    nav: function (dir) {
      if (dir === 'today') { var d = new Date(); CAL.year = d.getFullYear(); CAL.month = d.getMonth(); }
      else if (dir === 'prev') { CAL.month--; if (CAL.month < 0) { CAL.month = 11; CAL.year--; } }
      else { CAL.month++; if (CAL.month > 11) { CAL.month = 0; CAL.year++; } }
      render();
    },
    openEntry: function (id) { var e = CAL.byId[id]; if (e) openEntry(e); },
    drill: function (id) { var e = CAL.byId[id]; if (e) drillTo(e); }
  };

  MastAdmin.registerModule('marketing-calendar-v2', {
    routes: { 'marketing-calendar-v2': { tab: 'marketingCalendarV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
