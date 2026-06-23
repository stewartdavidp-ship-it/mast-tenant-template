/**
 * analytics-v2.js — Site traffic, V2 (read-only report over analytics/hits).
 *
 * Conversion of legacy #analytics. A traffic report, not a record surface:
 * summary tiles (today / views / clicks / visitors / all-time) + four lenses
 * — Pages, Clicks, Visitors, Recent — over the same bounded read the legacy
 * page does (analytics/hits by ts, limitToLast 2000). Range select mirrors
 * legacy (7/30/90 days). No writes, no slide-out records.
 *
 * Reuses the legacy vocabulary helpers when present (PAGE_LABELS,
 * analyticsActionLabel) so click/page names can't drift. The Sources lens
 * (Traffic & Revenue by Source) renders natively over the shared
 * window.AnalyticsSources compute core (state-free roll-up in index.html,
 * same data path the legacy W2.5 panel uses) — NO classic escape hatch.
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

  var V2 = { hits: [], lens: 'pages', rangeDays: 30, loaded: false, campFilter: '', sourcesLoaded: false };

  function pageLabel(p) { return (window.PAGE_LABELS && PAGE_LABELS[p]) || p || '(unknown)'; }
  function actionLabel(a) {
    return (typeof window.analyticsActionLabel === 'function') ? analyticsActionLabel(a) : (a || 'Click');
  }
  function dstr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function rangeHits() {
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - V2.rangeDays);
    var c = dstr(cutoff);
    return V2.hits.filter(function (h) { return h.d >= c; });
  }

  function bars(counts, labelFn, cap) {
    var sorted = Object.keys(counts).map(function (k) { return [k, counts[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    if (cap) sorted = sorted.slice(0, cap);
    if (!sorted.length) return '<div style="color:var(--warm-gray);font-size:0.85rem;">Nothing recorded in this range yet.</div>';
    var max = sorted[0][1] || 1;
    return sorted.map(function (e) {
      var pct = Math.round((e[1] / max) * 100);
      return '<div style="display:flex;align-items:center;gap:10px;padding:4px 0;">' +
        '<div style="flex:0 0 220px;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(labelFn(e[0])) + '</div>' +
        '<div style="flex:1;background:var(--cream-dark);border-radius:6px;height:10px;overflow:hidden;"><div style="background:var(--amber);height:100%;width:' + pct + '%;"></div></div>' +
        '<div style="flex:0 0 48px;text-align:right;font-size:0.85rem;font-weight:600;">' + N.count(e[1]) + '</div></div>';
    }).join('');
  }

  function pagesPane(hits) {
    var counts = {};
    hits.filter(function (h) { return h.t === 'pv'; }).forEach(function (h) { counts[h.p] = (counts[h.p] || 0) + 1; });
    return U.card('Page views', bars(counts, pageLabel));
  }
  function clicksPane(hits) {
    var counts = {};
    hits.filter(function (h) { return h.t === 'ev'; }).forEach(function (h) { counts[h.a] = (counts[h.a] || 0) + 1; });
    return U.card('What visitors clicked', bars(counts, actionLabel, 15));
  }
  function visitorsPane(hits) {
    var visitors = {};
    hits.forEach(function (h) {
      if (!h.ip) return;
      if (!visitors[h.ip]) visitors[h.ip] = { views: 0, clicks: 0, pages: {}, lastSeen: 0 };
      var v = visitors[h.ip];
      if (h.t === 'pv') v.views++;
      if (h.t === 'ev') v.clicks++;
      if (h.p) v.pages[h.p] = true;
      if (h.ts > v.lastSeen) v.lastSeen = h.ts;
    });
    var sorted = Object.keys(visitors).map(function (ip) { return [ip, visitors[ip]]; })
      .sort(function (a, b) { return b[1].lastSeen - a[1].lastSeen; }).slice(0, 50);
    if (!sorted.length) return U.card('Visitors', '<div style="color:var(--warm-gray);font-size:0.85rem;">No visitor IPs recorded in this range.</div>');
    var rows = sorted.map(function (e) {
      var ip = e[0], v = e[1];
      var pages = Object.keys(v.pages).map(pageLabel).join(', ');
      return '<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--cream-dark);font-size:0.85rem;align-items:baseline;">' +
        '<span style="flex:0 0 130px;font-family:monospace;font-size:0.78rem;">' + esc(ip) + '</span>' +
        '<span style="flex:0 0 70px;">' + v.views + ' views</span>' +
        '<span style="flex:0 0 70px;">' + v.clicks + ' clicks</span>' +
        '<span style="flex:1;color:var(--warm-gray);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(pages) + '</span>' +
        '<span style="flex:0 0 150px;text-align:right;color:var(--warm-gray);">' + (v.lastSeen ? MastFormat.dateTime(v.lastSeen) : '—') + '</span></div>';
    }).join('');
    return U.card('Visitors (most recent first)', rows);
  }
  function recentPane() {
    var rows = V2.hits.slice(0, 30).map(function (h) {
      var what = h.t === 'pv' ? ('Viewed ' + pageLabel(h.p)) : actionLabel(h.a);
      return '<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--cream-dark);font-size:0.85rem;align-items:baseline;">' +
        '<span style="flex:0 0 150px;color:var(--warm-gray);">' + (h.ts ? MastFormat.dateTime(h.ts) : '—') + '</span>' +
        '<span style="flex:1;">' + esc(what) + '</span>' +
        '<span style="flex:0 0 130px;text-align:right;font-family:monospace;font-size:0.78rem;color:var(--warm-gray);">' + esc(h.ip || '') + '</span></div>';
    }).join('');
    return U.card('Last 30 hits', rows || '<div style="color:var(--warm-gray);font-size:0.85rem;">No traffic recorded yet.</div>');
  }

  function sourcesPane() {
    var core = window.AnalyticsSources;
    if (!core) return U.card('Sources & revenue', '<div style="color:var(--warm-gray);font-size:0.85rem;">Source data engine unavailable.</div>');
    if (!V2.sourcesLoaded) {
      core.load().then(function () { V2.sourcesLoaded = true; render(); });
      return U.card('Sources & revenue', '<div style="color:var(--warm-gray);font-size:0.85rem;">Loading source data…</div>');
    }
    var entries = core.rollup(V2.rangeDays, V2.campFilter);
    var campOpts = core.campaignOptions().map(function (c) {
      return '<option value="' + esc(c.value) + '"' + (V2.campFilter === c.value ? ' selected' : '') + '>' + esc(c.label) + '</option>';
    }).join('');
    var campSel = '<select class="form-input" style="font-size:0.85rem;padding:6px 10px;max-width:240px;margin-bottom:10px;" onchange="AnalyticsV2.setCampaign(this.value)">' +
      '<option value="">All campaigns</option>' + campOpts + '</select>';
    if (!entries.length) {
      return U.card('Sources & revenue', campSel +
        '<div style="color:var(--warm-gray);font-size:0.85rem;">No traffic sources captured in this range yet — UTMs appear here once visitors land with utm_source params.</div>');
    }
    var chips = entries.slice(0, 3).map(function (e) {
      return '<span style="background:var(--cream);padding:4px 10px;border-radius:4px;font-size:0.85rem;margin-right:8px;"><strong>' + esc(e[0]) + '</strong> $' + (e[1].revenueCents / 100).toFixed(2) + ' (' + e[1].orderCount + ' ' + MastFormat.plural(e[1].orderCount, 'order') + ')</span>';
    }).join('');
    var rows = entries.map(function (e) {
      return '<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--cream-dark);font-size:0.85rem;align-items:baseline;">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(e[0]) + '</span>' +
        '<span style="flex:0 0 80px;text-align:right;">' + N.count(e[1].hits) + ' hits</span>' +
        '<span style="flex:0 0 80px;text-align:right;">' + N.count(e[1].orderCount) + ' orders</span>' +
        '<span style="flex:0 0 100px;text-align:right;font-weight:600;">$' + (e[1].revenueCents / 100).toFixed(2) + '</span></div>';
    }).join('');
    return U.card('Sources & revenue',
      campSel +
      '<div style="margin-bottom:10px;">' + chips + '</div>' + rows +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:8px;">Source = utm_source, else the referrer site, else direct. Revenue joins orders on their attribution.</div>');
  }

  function ensureTab() {
    var el = document.getElementById('analyticsV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'analyticsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function lensPill(key, label) {
    var on = V2.lens === key;
    return '<button onclick="AnalyticsV2.setLens(\'' + key + '\')" style="border:1px solid var(--border);' +
      'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
      'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
      'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' + label + '</button>';
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Site traffic' }) + '<div style="margin-top:14px;color:var(--warm-gray);">Loading…</div>';
      return;
    }
    var inRange = rangeHits();
    var today = dstr(new Date());
    var todayPV = V2.hits.filter(function (h) { return h.d === today && h.t === 'pv'; }).length;
    var pv = inRange.filter(function (h) { return h.t === 'pv'; }).length;
    var ev = inRange.filter(function (h) { return h.t === 'ev'; }).length;
    var ips = {};
    inRange.forEach(function (h) { if (h.ip) ips[h.ip] = true; });

    var tiles = U.tiles([
      { k: 'Today', v: N.count(todayPV), hero: true },
      { k: 'Views (' + V2.rangeDays + 'd)', v: N.count(pv) },
      { k: 'Clicks (' + V2.rangeDays + 'd)', v: N.count(ev) },
      { k: 'Visitors (' + V2.rangeDays + 'd)', v: N.count(Object.keys(ips).length) },
      { k: 'All time', v: N.count(V2.hits.length) }
    ]);

    var rangeSel = '<select class="form-input" style="font-size:0.85rem;padding:6px 10px;max-width:150px;" onchange="AnalyticsV2.setRange(this.value)">' +
      [7, 30, 90].map(function (d) {
        return '<option value="' + d + '"' + (V2.rangeDays === d ? ' selected' : '') + '>Last ' + d + ' days</option>';
      }).join('') + '</select>';

    var pane = V2.lens === 'clicks' ? clicksPane(inRange)
      : V2.lens === 'visitors' ? visitorsPane(inRange)
      : V2.lens === 'recent' ? recentPane()
      : V2.lens === 'sources' ? sourcesPane()
      : pagesPane(inRange);

    tab.innerHTML =
      U.pageHeader({
        title: 'Site traffic',
        subtitle: 'Who\'s visiting your storefront and what they do there'
      }) +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0;">' +
        lensPill('pages', 'Pages') + lensPill('clicks', 'Clicks') + lensPill('visitors', 'Visitors') + lensPill('recent', 'Recent') + lensPill('sources', 'Sources & revenue') +
        rangeSel +
      '</div>' +
      tiles + pane;
  }

  function load() {
    Promise.resolve(MastDB.query('analytics/hits').orderByChild('ts').limitToLast(2000).once()).then(function (snap) {
      var data = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var hits = Object.keys(data || {}).map(function (k) { return data[k]; }).filter(Boolean);
      hits.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      V2.hits = hits;
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[analytics-v2] load', e); V2.loaded = true; render(); });
  }

  window.AnalyticsV2 = {
    setLens: function (l) { V2.lens = l; render(); },
    setRange: function (v) { V2.rangeDays = parseInt(v, 10) || 30; render(); },
    setCampaign: function (v) { V2.campFilter = v || ''; render(); }
  };

  MastAdmin.registerModule('analytics-v2', {
    routes: { 'analytics-v2': { tab: 'analyticsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
