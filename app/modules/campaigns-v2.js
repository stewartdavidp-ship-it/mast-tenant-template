/**
 * campaigns-v2.js — read-focused Faceted Record twin of the legacy Campaigns
 * surface (doc 17 section 11/12; conversion playbook).
 *
 * Legacy campaigns.js (#campaigns) is a cross-channel marketing aggregator: a
 * named, dated container that groups existing artifacts (blog posts, newsletter
 * issues, social posts, stories) under a single utm_campaign value for
 * attribution roll-up. It hosts a list -> inline card detail with editable
 * fields, a references table (add/remove), and an attribution readout.
 *
 * Data path (mirrors legacy exactly): admin/campaigns, a keyed object of ->
 *   { id, name, goal, startDate, endDate, utmCampaign,
 *     references: [{ type, refId, scheduledFor, addedAt }],
 *     status, createdAt, updatedAt }
 * Admin-only writes, covered by the existing admin-only catch-all rule.
 *
 * Variant (doc 17 section 1a): a campaign has NO governed lifecycle. Its status
 * (active / paused / done, a free attribute the operator types in legacy) is a
 * tagged/derived attribute, NOT a gated transition -> Faceted Record, NO
 * MastFlow, NO process header.
 *
 * Read-focused: create / rename / edit fields / add+remove references are the
 * side-effecting flows and stay single-sourced on legacy #campaigns via
 * navigateToClassic('campaigns'). This twin re-hosts the VIEW only -- list ->
 * read slide-out (Overview / References / Attribution facets). No onSave, no
 * edit form, no reference mutation. Flag-gated (?ui=1) at #campaigns-v2,
 * side-by-side; never touches campaigns.js.
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

  // Status is a free attribute in legacy (defaults to 'active'); tone it for the
  // badge without implying a governed lifecycle.
  var STATUS_LABEL = { active: 'Active', paused: 'Paused', done: 'Done', draft: 'Draft' };
  var STATUS_TONE = { active: 'success', paused: 'amber', done: 'neutral', draft: 'info' };
  function statusKey(c) { return String(c.status || 'active').toLowerCase(); }
  function statusLabel(c) { var k = statusKey(c); return STATUS_LABEL[k] || (c.status || 'Active'); }
  function statusTone(c) { return STATUS_TONE[statusKey(c)] || 'neutral'; }

  // Reference type labels mirror the legacy add-reference picker.
  var REF_TYPE_LABEL = { blog: 'Blog post', newsletter: 'Newsletter issue', social: 'Social post', story: 'Story' };
  function campaignName(c) { return (c && c.name) || '(untitled)'; }
  function refCount(c) { return (c && Array.isArray(c.references)) ? c.references.length : 0; }
  function dateRange(c) {
    if (!c.startDate && !c.endDate) return '';
    return (c.startDate || '') + (c.endDate ? ' → ' + c.endDate : '');
  }

  // Reference deep-link (mirrors legacy _refToHash) -> classic artifact route.
  function refHash(r) {
    switch (r.type) {
      case 'blog':       return 'blog?postId=' + r.refId;
      case 'newsletter': return 'newsletter?issueId=' + r.refId;
      case 'social':     return 'social?postId=' + r.refId;
      case 'story':      return 'stories?storyId=' + r.refId;
      default: return '';
    }
  }

  // -- schema (read-only Faceted Record) -------------------------------
  MastEntity.define('campaigns-v2', {
    label: 'Campaign', labelPlural: 'Campaigns', size: 'lg',
    route: 'campaigns-v2',
    recordId: function (c) { return c._key || c.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string
      // in load(), so the engine titles the panel without a get().
      { name: 'name', label: 'Name', type: 'text', list: true, readOnly: true, group: 'Campaign', get: campaignName },
      { name: 'goal', label: 'Goal', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (c) { return (c.goal || '').slice(0, 60); } },
      { name: 'dateRange', label: 'Date range', type: 'text', list: true, readOnly: true, sortable: false, get: dateRange },
      { name: 'refs', label: 'References', type: 'number', list: true, readOnly: true, align: 'right', get: refCount },
      { name: 'createdAt', label: 'Created', type: 'date', list: true, readOnly: true, get: function (c) { return c.createdAt || null; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'paused', 'done', 'draft'],
        get: statusKey,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, c) {
        var refs = Array.isArray(c.references) ? c.references.slice() : [];
        refs.sort(function (a, b) { return (a.scheduledFor || '').localeCompare(b.scheduledFor || ''); });

        var tiles = UI.tiles([
          { k: 'References', v: N.count(refs.length), hero: true },
          { k: 'Status', v: UI.badge(statusLabel(c), statusTone(c)) },
          { k: 'Created', v: c.createdAt ? N.date(c.createdAt) : '—' },
          { k: 'UTM', v: c.utmCampaign ? '<span style="font-family:monospace;font-size:0.85rem;">' + esc(c.utmCampaign) + '</span>' : '—' }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' },
          { key: 'refs', label: 'References' },
          { key: 'attr', label: 'Attribution' }
        ], 'ov');

        // Overview -- campaign meta + goal.
        var overview = UI.kv([
          { k: 'Status', v: UI.badge(statusLabel(c), statusTone(c)) },
          { k: 'Start date', v: c.startDate ? esc(c.startDate) : '—' },
          { k: 'End date', v: c.endDate ? esc(c.endDate) : '—' },
          { k: 'UTM campaign', v: c.utmCampaign ? '<span style="font-family:monospace;font-size:0.85rem;">' + esc(c.utmCampaign) + '</span>' : '—' },
          { k: 'Created', v: c.createdAt ? N.date(c.createdAt) : '—' },
          { k: 'Updated', v: c.updatedAt ? N.date(c.updatedAt) : '—' }
        ]);
        var goalBody = c.goal
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(c.goal) + '</div>'
          : '<span class="mu-sub">No goal set.</span>';
        // Editing campaign fields + references is side-effecting and stays on
        // legacy. navigateToClassic so the V2 remap does not loop back here.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="CampaignsV2.classic()">Manage in classic view →</button></div>';

        // References -- read-only list with deep-links to the source artifact.
        var refsBody = refs.length ? UI.relatedTable([
          { label: 'Type', render: function (r) { return esc(REF_TYPE_LABEL[r.type] || r.type || '—'); } },
          { label: 'Reference', render: function (r) {
              var h = refHash(r);
              return h ? '<a href="#' + esc(h) + '" style="color:var(--teal);">' + esc(r.refId || '') + '</a>' : esc(r.refId || '—');
            } },
          { label: 'Scheduled for', render: function (r) { return r.scheduledFor ? esc(r.scheduledFor) : '<span class="mu-sub">—</span>'; } },
          { label: 'Added', render: function (r) { return r.addedAt ? '<span class="mu-sub">' + esc(String(r.addedAt).slice(0, 10)) + '</span>' : '<span class="mu-sub">—</span>'; } }
        ], refs) : '<span class="mu-sub">No references yet. Add blog, newsletter, social or story posts in the classic Campaigns view.</span>';

        // Attribution -- read-only roll-up reusing the global analytics helper
        // (W2.5). No write, no side effect; container filled async after render.
        var attrBody = '<div id="campaignsV2Attr" style="font-size:0.9rem;color:var(--warm-gray);">'
          + (c.utmCampaign ? 'Computing…' : 'No utm_campaign assigned yet.') + '</div>';

        if (c.utmCampaign && typeof window.computeAttributionForCampaign === 'function') {
          setTimeout(function () {
            Promise.resolve(window.computeAttributionForCampaign(c.utmCampaign)).then(function (d) {
              var el = document.getElementById('campaignsV2Attr');
              if (!el) return;
              if (!d || (!d.totalHits && !d.totalRevenue)) { el.innerHTML = 'No traffic captured for this campaign yet.'; return; }
              el.innerHTML = UI.kv([
                { k: 'Hits', v: N.count(d.totalHits || 0) },
                { k: 'Orders attributed', v: N.count(d.orderCount || 0) },
                { k: 'Revenue', v: N.money(d.totalRevenue || 0, { cents: true }) || N.money(0) }
              ]);
            }).catch(function () {
              var el = document.getElementById('campaignsV2Attr');
              if (el) el.innerHTML = 'Attribution unavailable.';
            });
          }, 0);
        } else if (c.utmCampaign) {
          attrBody = '<div id="campaignsV2Attr" style="font-size:0.9rem;color:var(--warm-gray);">'
            + 'Open Analytics → Traffic &amp; Revenue by Source to see attribution.</div>';
        }

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Campaign', overview) + UI.card('Goal', goalBody + manage) + '</div>' +
          '<div class="mu-pane" data-pane="refs" hidden>' + UI.cardTable('References (' + refs.length + ')', refsBody) + '</div>' +
          '<div class="mu-pane" data-pane="attr" hidden>' + UI.card('Attribution', attrBody) + '</div>';
      }
    }
    // No onSave -> no Edit button (campaign editing + references stay on legacy #campaigns).
  });

  // -- module state + data ---------------------------------------------
  var V2 = { rows: [], byId: {}, sortKey: 'createdAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  // Mirror the legacy read path (admin/campaigns) returning a keyed object, but
  // carry an explicit { limit } so the read is bounded (lint-unbounded-read
  // gate; CLAUDE.md no-unbounded-read rule). 500 comfortably covers a tenant's
  // campaign set; we sort client-side (created desc default).
  function load() {
    Promise.resolve(MastDB.list('admin/campaigns', { limit: 500 })).then(function (val) {
      val = (val && typeof val.val === 'function') ? val.val() : val;
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var c = val[k];
        if (c && typeof c === 'object') { c = Object.assign({ _key: k }, c); c.status = c.status || 'active'; out.push(c); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[campaigns-v2] load', e); V2.loaded = true; render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (c) { return statusKey(c) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (c) {
        return String(c.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(c.goal || '').toLowerCase().indexOf(q) >= 0 ||
               String(c.utmCampaign || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('campaigns-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('campaignsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'campaignsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['active', 'Active'], ['paused', 'Paused'], ['done', 'Done'], ['draft', 'Draft']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="CampaignsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Campaigns',
        count: N.count(V2.rows.length) + ' campaign' + (V2.rows.length === 1 ? '' : 's'),
        subtitle: 'Group blog, newsletter, social and story posts under one utm_campaign for attribution.',
        actionsHtml:
          '<button class="btn btn-secondary" onclick="CampaignsV2.classic()">+ New (classic)</button>' +
          '<button class="btn btn-secondary" onclick="CampaignsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, goal or UTM…" value="' + esc(V2.q) +
        '" oninput="CampaignsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('campaigns-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CampaignsV2.sort', onRowClickFnName: 'CampaignsV2.open',
        empty: { title: 'No campaigns', message: V2.loaded ? 'Create your first campaign in the classic Campaigns view.' : 'Loading…' }
      });
  }

  window.CampaignsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'createdAt' || key === 'refs' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('campaigns-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('campaigns-v2', rec, 'read');
      });
    },
    // Create / edit / reference management is side-effecting and stays on the
    // legacy Campaigns surface. navigateToClassic so the V2 route remap does not
    // loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('campaigns');
      else if (typeof navigateTo === 'function') navigateTo('campaigns');
    },
    exportCsv: function () { return MastEntity.exportRows('campaigns-v2', visibleRows(), V2.statusFilter); }
  };

  MastAdmin.registerModule('campaigns-v2', {
    routes: { 'campaigns-v2': { tab: 'campaignsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
