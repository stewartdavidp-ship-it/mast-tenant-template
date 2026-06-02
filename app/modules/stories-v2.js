/**
 * stories-v2.js — read-focused Faceted Record twin of the legacy Stories surface
 * (doc 17 conversion playbook; engine-first redesign).
 *
 * Legacy production.js (#stories, owned by the Production module) hosts the
 * studio-story list as a stack of cards and swaps the pane in-place to a story
 * detail (renderStoryDetail: status + job link + entries gallery + artists + QR
 * codes) with its own Preview / Add-photos-Edit / Publish controls. This twin
 * re-hosts that list to read-detail VIEW on the Entity Engine: a schema-driven
 * list plus a read-focused Faceted Record slide-out (single Overview facet).
 *
 * Variant (doc 17): a story is a content record (title, status, cover image,
 * dates) with no governed lifecycle — its status (published / draft) is an
 * assigned attribute, so it is a Faceted Record, NOT Process / MastFlow.
 *
 * Read-focused: a story is AUTHORED on a rich photo-curation canvas (the entries
 * gallery, milestone captions, QR-code generation, publish side effects) that is
 * deeply coupled to the Production module and the storefront. Per the read-on-page
 * model we only convert the LIST to a read-detail (title / status / cover /
 * excerpt / dates) and keep every authoring path single-sourced on legacy
 * #stories via a "manage in classic view" link. This twin re-hosts the VIEW only
 * — no onSave, no edit form, no entry editor / publish controls. Flag-gated
 * (?ui=1) at #stories-v2, side-by-side; never touches production.js.
 *
 * Data: stories live at public/stories (MastDB.stories = _makeEntity('public/
 * stories', 200)); read one-shot via MastDB.get('public/stories') -> keyed object.
 * Real fields (from production.js renderStoriesList / renderStoryDetail):
 * title, status ('published' | 'draft'), jobId, entries (keyed map of
 * { order, milestone, mediaUrl, caption, ... }), publishedAt, createdAt,
 * updatedAt. There is no author / excerpt / coverImage field on the doc itself —
 * the cover image is the first entry's mediaUrl and the excerpt is derived from
 * the first entry's milestone / caption (mirrors the legacy thumbnail logic).
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
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;

  var STATUS_LABEL = { published: 'Published', draft: 'Draft' };
  var STATUS_TONE = { published: 'success', draft: 'amber' };

  function storyTitle(s) { return (s && s.title) || 'Untitled story'; }
  function statusOf(s) { return (s && s.status) || 'draft'; }

  // Entries sorted by their authored order (mirrors production.js).
  function entriesOf(s) {
    if (!s || !s.entries) return [];
    return Object.keys(s.entries).map(function (k) {
      var e = s.entries[k] || {}; return { _key: k, order: e.order || 0, milestone: e.milestone || '', caption: e.caption || '', mediaUrl: e.mediaUrl || '' };
    }).sort(function (a, b) { return a.order - b.order; });
  }
  function entryCount(s) { return s && s.entries ? Object.keys(s.entries).length : 0; }

  // Cover image = first entry that carries a mediaUrl (legacy thumbnail logic).
  function coverUrl(s) {
    var es = entriesOf(s);
    for (var i = 0; i < es.length; i++) { if (es[i].mediaUrl) return es[i].mediaUrl; }
    return '';
  }
  // Excerpt = first non-empty milestone / caption across entries (the doc has no
  // body/excerpt field; this is the closest authored summary).
  function excerptOf(s) {
    var es = entriesOf(s);
    for (var i = 0; i < es.length; i++) { if (es[i].milestone) return es[i].milestone; }
    for (var j = 0; j < es.length; j++) { if (es[j].caption) return es[j].caption; }
    return '';
  }
  // Display label for the linked production job (resolved from the one-shot
  // public/jobs read loaded alongside the stories).
  function jobLabel(s) {
    var id = s && s.jobId; if (!id) return '';
    var j = V2.jobs[id]; return j ? (j.name || 'Untitled job') : '';
  }
  function publishedAt(s) { return (statusOf(s) === 'published' && s && s.publishedAt) ? s.publishedAt : null; }
  function updatedAt(s) { return (s && (s.updatedAt || s.createdAt)) || null; }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('stories-v2', {
    label: 'Story', labelPlural: 'Stories', size: 'md',
    route: 'stories-v2',
    recordId: function (s) { return s._key || s.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real title string.
      { name: 'title', label: 'Title', type: 'text', list: true, readOnly: true, group: 'Story', get: storyTitle },
      { name: 'job', label: 'From job', type: 'text', list: true, readOnly: true, sortable: false, get: function (s) { return jobLabel(s) || '—'; } },
      { name: 'entryCount', label: 'Entries', type: 'number', list: true, readOnly: true, align: 'right', get: entryCount },
      { name: 'publishedAt', label: 'Published', type: 'date', list: true, readOnly: true, get: publishedAt },
      { name: 'updatedAt', label: 'Updated', type: 'date', list: true, readOnly: true, get: updatedAt },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['published', 'draft'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, s) {
        var cover = coverUrl(s);
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(s)] || 'Draft', STATUS_TONE[statusOf(s)] || 'neutral'), hero: true },
          { k: 'Entries', v: N.count(entryCount(s)) },
          { k: 'Published', v: publishedAt(s) ? N.date(publishedAt(s)) : '—' },
          { k: 'Cover', v: cover ? UI.imageThumb(storyTitle(s), cover) : '<span class="mu-sub">None</span>' }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }], 'ov');

        // Overview — cover image, the story vitals, and a derived excerpt.
        // The cover <img> is composed by hand inside a card (the sanctioned
        // read-on-page image pattern, mirroring brand-v2 logoCard) — imageThumb
        // is the lightbox affordance, this is the full-bleed read view.
        var coverBlock = cover
          ? '<div style="background:var(--surface-dark);border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;min-height:120px;">' +
              '<img src="' + esc(cover) + '" alt="' + esc(storyTitle(s)) + ' cover" style="max-width:100%;max-height:280px;object-fit:contain;display:block;"></div>'
          : '<div style="background:var(--surface-dark);border-radius:8px;padding:24px;text-align:center;color:var(--warm-gray);font-size:0.9rem;">No cover image yet.</div>';

        var vitals = UI.kv([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(s)] || 'Draft', STATUS_TONE[statusOf(s)] || 'neutral') },
          { k: 'From job', v: jobLabel(s) ? esc(jobLabel(s)) : '—' },
          { k: 'Entries', v: N.count(entryCount(s)) },
          { k: 'Published', v: publishedAt(s) ? N.date(publishedAt(s)) : '—' },
          { k: 'Created', v: s.createdAt ? N.date(s.createdAt) : '—' },
          { k: 'Updated', v: updatedAt(s) ? N.date(updatedAt(s)) : '—' }
        ]);

        var ex = excerptOf(s);
        var excerptBody = ex
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(ex) + '</div>'
          : '<span class="mu-sub">No caption or milestone text yet.</span>';

        // Photo-curation authoring (entries, captions, QR codes, publish) stays
        // on legacy #stories. Use navigateToClassic so the V2 route remap doesn't
        // loop us back to this twin.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="StoriesV2.classic()">Manage in classic view &rarr;</button></div>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Cover', coverBlock) +
            UI.card('Story', vitals) +
            UI.card('Excerpt', excerptBody + manage) +
          '</div>';
      }
    }
    // No onSave → no Edit button (story authoring stays on legacy #stories).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, jobs: {}, sortKey: 'updatedAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Stories + production jobs (for the "from job" label) load together; both
    // one-shot keyed-object reads (bounded — MastDB.get on a _makeEntity path).
    Promise.all([
      Promise.resolve(MastDB.get('public/stories')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/jobs')).catch(function () { return null; })
    ]).then(function (res) {
      var sv = res[0] || {}, jv = res[1] || {};
      var out = [];
      Object.keys(sv).forEach(function (k) {
        var s = sv[k];
        if (s && typeof s === 'object') { s = Object.assign({ _key: k }, s); s.status = s.status || 'draft'; out.push(s); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.jobs = jv || {};
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[stories-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (s) { return statusOf(s) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (s) {
        return storyTitle(s).toLowerCase().indexOf(q) >= 0 ||
               jobLabel(s).toLowerCase().indexOf(q) >= 0 ||
               excerptOf(s).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('stories-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('storiesV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'storiesV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['published', 'Published'], ['draft', 'Draft']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="StoriesV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Stories',
        count: N.count(V2.rows.length) + (V2.rows.length === 1 ? ' story' : ' stories'),
        actionsHtml: '<button class="btn btn-secondary" onclick="StoriesV2.exportCsv()">&darr; Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search title, job or caption..." value="' + esc(V2.q) +
        '" oninput="StoriesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('stories-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'StoriesV2.sort', onRowClickFnName: 'StoriesV2.open',
        empty: { title: 'No stories', message: V2.loaded ? 'Create studio stories in the classic Stories view.' : 'Loading...' }
      });
  }

  window.StoriesV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'entryCount' || key === 'publishedAt' || key === 'updatedAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('stories-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('stories-v2', rec, 'read');
      });
    },
    // Photo-curation authoring → classic Stories view. Use navigateToClassic so
    // the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('stories');
      else if (typeof navigateTo === 'function') navigateTo('stories');
    },
    exportCsv: function () { return MastEntity.exportRows('stories-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('stories-v2', {
    routes: { 'stories-v2': { tab: 'storiesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
