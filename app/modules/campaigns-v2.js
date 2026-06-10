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
 * NATIVE write (doc 17 conversion playbook): create + field-edit + reference
 * add/remove are all hosted here via the engine edit form + in-detail actions.
 * The actual writes DELEGATE to window.CampaignsBridge (exposed in campaigns.js)
 * so the campaign write, slug derivation, and reference array shape stay
 * single-sourced -- the twin never reimplements that logic. No classic view is
 * maintained. Flag-gated (?ui=1) at #campaigns-v2.
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

  // Reference drill target (marketing-v2 Wave 3): every artifact type now has
  // a V2 record entity, so references drill in-panel via MastEntity.drill
  // (each target's fetch() has a MastDB cache-miss fallback for cold drills).
  var REF_ENTITY = { blog: 'blog-v2', newsletter: 'newsletter-issues-v2', social: 'social-v2', story: 'stories-v2' };

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

        // References -- list with deep-links to the source artifact + native
        // remove (delegates to CampaignsBridge.removeReference). The refs array is
        // sorted for display, so each row carries its index in the ORIGINAL
        // (unsorted) array so removal targets the right element.
        var orig = Array.isArray(c.references) ? c.references : [];
        var cid = c._key || c.id;
        var addRefBtn = '<div style="margin-bottom:10px;"><button class="btn btn-secondary btn-small" onclick="CampaignsV2.addRef(\'' + esc(cid) + '\')">+ Add reference</button></div>';
        var refsBody = addRefBtn + (refs.length ? UI.relatedTable([
          { label: 'Type', render: function (r) { return esc(REF_TYPE_LABEL[r.type] || r.type || '—'); } },
          { label: 'Reference', render: function (r) {
              var ek = REF_ENTITY[r.type];
              return ek && r.refId
                ? '<button type="button" class="mu-link" onclick="event.stopPropagation();MastEntity.drill(\'' + ek + '\',\'' + esc(String(r.refId)) + '\')" style="color:var(--teal);background:none;border:none;cursor:pointer;padding:0;font-size:inherit;">' + esc(r.refId) + '</button>'
                : esc(r.refId || '—');
            } },
          { label: 'Scheduled for', render: function (r) { return r.scheduledFor ? esc(r.scheduledFor) : '<span class="mu-sub">—</span>'; } },
          { label: 'Added', render: function (r) { return r.addedAt ? '<span class="mu-sub">' + esc(String(r.addedAt).slice(0, 10)) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: '', render: function (r) {
              var i = orig.indexOf(r);
              return '<button class="btn-link" onclick="CampaignsV2.removeRef(\'' + esc(cid) + '\',' + i + ')" style="color:var(--text-danger);background:none;border:none;cursor:pointer;font-size:0.78rem;">remove</button>';
            } }
        ], refs) : '<span class="mu-sub">No references yet. Add blog, newsletter, social or story posts above.</span>');

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

        // Delete (Wave 3) — confirm + audit; references are pointers, the
        // linked artifacts survive.
        var danger = (typeof window.can !== 'function' || window.can('campaigns', 'delete'))
          ? '<div style="margin-top:14px;"><button class="btn btn-secondary btn-small" style="color:var(--text-danger);" onclick="CampaignsV2.remove(\'' + esc(cid) + '\')">Delete campaign</button></div>'
          : '';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Campaign', overview) + UI.card('Goal', goalBody) + danger + '</div>' +
          '<div class="mu-pane" data-pane="refs" hidden>' + UI.cardTable('References (' + refs.length + ')', refsBody) + '</div>' +
          '<div class="mu-pane" data-pane="attr" hidden>' + UI.card('Attribution', attrBody) + '</div>';
      },
      // Edit form for the campaign's OWN fields. UTM is derived from the name by
      // the bridge (slugifyCampaign), so it is shown read-only, not editable.
      editRender: function (c, mode) {
        c = c || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        var statusSel = ['active', 'paused', 'done', 'draft'].map(function (k) {
          return '<option value="' + k + '"' + (statusKey(c) === k ? ' selected' : '') + '>' + (STATUS_LABEL[k] || k) + '</option>';
        }).join('');
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New campaign' : 'Edit this campaign') + '</div>' +
          fg('Name *', '<input class="form-input" id="cmpV2Name" value="' + esc(c.name || '') + '" style="width:100%;" placeholder="e.g. Spring 2026 Glass Show">') +
          (mode === 'create' ? '' :
            fg('Goal', '<textarea class="form-input" id="cmpV2Goal" rows="3" style="width:100%;resize:vertical;" placeholder="What this campaign is for">' + esc(c.goal || '') + '</textarea>') +
            row2(
              fg('Start date', '<input class="form-input" type="date" id="cmpV2Start" value="' + esc(c.startDate || '') + '" style="width:100%;">', true),
              fg('End date', '<input class="form-input" type="date" id="cmpV2End" value="' + esc(c.endDate || '') + '" style="width:100%;">', true)
            ) +
            fg('Status', '<select class="form-input" id="cmpV2Status" style="width:100%;">' + statusSel + '</select>') +
            fg('UTM campaign', '<div style="font-family:monospace;font-size:0.85rem;padding:6px 0;color:var(--warm-gray);">' + esc(c.utmCampaign || '(derived from name on save)') + '</div>'));
      }
    },
    onSave: function (rec, mode) {
      if (!window.CampaignsBridge) { if (window.showToast) showToast('Campaigns engine still loading — try again', true); return false; }
      function val(id) { return ((document.getElementById(id) || {}).value || ''); }
      var name = val('cmpV2Name');
      if (!name.trim()) { if (window.showToast) showToast('Campaign name is required.', true); return false; }

      if (mode === 'create') {
        // Mirrors legacy create: only the name is collected up front; goal/dates/
        // status default. The operator then edits the rest on the detail.
        return Promise.resolve(window.CampaignsBridge.create({ name: name })).then(function (id) {
          if (window.showToast) showToast('Campaign created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[campaigns-v2] create', e); if (window.showToast) showToast('Error saving campaign.', true); return false; });
      }
      var data = {
        name: name,
        goal: val('cmpV2Goal'),
        startDate: val('cmpV2Start'),
        endDate: val('cmpV2End'),
        status: val('cmpV2Status') || 'active'
      };
      var id = rec._key || rec.id;
      return Promise.resolve(window.CampaignsBridge.update(id, data)).then(function (patch) {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        Object.assign(V2.byId[id] || rec, patch || data);
        if (window.showToast) showToast('Campaign updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[campaigns-v2] update', e); if (window.showToast) showToast('Error updating campaign.', true); return false; });
    }
  });

  // -- module state + data ---------------------------------------------
  var V2 = { rows: [], byId: {}, sortKey: 'createdAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  // Mirror the legacy read path (admin/campaigns) returning a keyed object, but
  // carry an explicit { limit } so the read is bounded (lint-unbounded-read
  // gate; CLAUDE.md no-unbounded-read rule). 500 comfortably covers a tenant's
  // campaign set; we sort client-side (created desc default).
  function load() {
    // Ensure the legacy campaigns module is loaded so window.CampaignsBridge
    // (the delegated write path) exists — mirrors contacts-v2 / students-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('campaigns'); } catch (e) {} }
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
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

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
          '<button class="btn btn-primary" onclick="CampaignsV2.create()">+ New campaign</button>' +
          '<button class="btn btn-secondary" onclick="CampaignsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, goal or UTM…" value="' + esc(V2.q) +
        '" oninput="CampaignsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('campaigns-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CampaignsV2.sort', onRowClickFnName: 'CampaignsV2.open',
        empty: { title: 'No campaigns', message: V2.loaded ? 'Create your first campaign to get started.' : 'Loading…' }
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
    create: function () {
      // Ensure the legacy module (and thus window.CampaignsBridge) is loaded
      // before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('campaigns'); } catch (e) {} }
      MastEntity.openRecord('campaigns-v2', {}, 'create');
    },
    // Re-open the record in read mode after a reference write so the slide-out
    // shows the fresh references list; reloadSoon refreshes the list cache.
    _reopen: function (id) {
      var rec = V2.byId[id];
      if (rec) MastEntity.openRecord('campaigns-v2', rec, 'read');
    },
    // Add reference — small in-page modal (type / refId / scheduledFor),
    // delegates the write to CampaignsBridge.addReference. The legacy
    // detail add-reference is the same simple form (a typed refId, not a
    // cross-type search), so it is made native rather than kept on classic.
    addRef: function (id) {
      if (!window.CampaignsBridge) { if (window.showToast) showToast('Campaigns engine still loading — try again', true); return; }
      var html =
        '<div class="modal-header"><h3>Add reference</h3>' +
          '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body">' +
          '<div class="form-group"><label>Type</label>' +
            '<select id="cmpV2RefType"><option value="blog">Blog post</option>' +
              '<option value="newsletter">Newsletter issue</option>' +
              '<option value="social">Social post</option>' +
              '<option value="story">Story</option></select></div>' +
          '<div class="form-group"><label>Reference ID</label>' +
            '<input type="text" id="cmpV2RefId" placeholder="e.g. -ObAbc123..."></div>' +
          '<div class="form-group"><label>Scheduled for</label>' +
            '<input type="date" id="cmpV2RefSched"></div>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button class="btn btn-primary" data-cmp-id="' + esc(id) + '" onclick="CampaignsV2.addRefConfirm(this.dataset.cmpId)">Add</button>' +
        '</div>';
      if (typeof openModal === 'function') openModal(html);
    },
    addRefConfirm: function (id) {
      var type = (document.getElementById('cmpV2RefType') || {}).value || 'blog';
      var refId = ((document.getElementById('cmpV2RefId') || {}).value || '').trim();
      var sched = (document.getElementById('cmpV2RefSched') || {}).value || '';
      if (!refId) { if (window.showToast) showToast('Reference ID required', true); return; }
      Promise.resolve(window.CampaignsBridge.addReference(id, { type: type, refId: refId, scheduledFor: sched })).then(function (refs) {
        if (V2.byId[id]) V2.byId[id].references = refs;
        if (typeof closeModal === 'function') closeModal();
        if (window.showToast) showToast('Reference added.');
        CampaignsV2._reopen(id); reloadSoon();
      }).catch(function (e) { console.error('[campaigns-v2] addRef', e); if (window.showToast) showToast('Failed to add reference.', true); });
    },
    // Remove reference — delegates to CampaignsBridge.removeReference (a simple
    // array splice + write, mirroring legacy campaignsRemoveReference).
    removeRef: function (id, idx) {
      if (!window.CampaignsBridge) { if (window.showToast) showToast('Campaigns engine still loading — try again', true); return; }
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Remove this reference? (The linked artifact is not deleted.)', { title: 'Remove reference?', confirmLabel: 'Remove', dangerous: true })
        : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(window.CampaignsBridge.removeReference(id, idx)).then(function (refs) {
          if (V2.byId[id]) V2.byId[id].references = refs;
          if (window.showToast) showToast('Reference removed.');
          CampaignsV2._reopen(id); reloadSoon();
        });
      }).catch(function (e) { console.error('[campaigns-v2] removeRef', e); if (window.showToast) showToast('Failed to remove reference.', true); });
    },
    // Delete (Wave 3) — confirm + writeAudit; delegates to CampaignsBridge.
    remove: function (id) {
      if (typeof window.can === 'function' && !window.can('campaigns', 'delete')) {
        if (window.showToast) showToast('You don\'t have permission to delete campaigns.', true); return;
      }
      if (!window.CampaignsBridge) { if (window.showToast) showToast('Campaigns engine still loading — try again', true); return; }
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Delete this campaign? The linked artifacts (posts, issues, stories) are NOT deleted.', { title: 'Delete campaign?', confirmLabel: 'Delete', dangerous: true })
        : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(window.CampaignsBridge.remove(id)).then(function () {
          if (window.writeAudit) writeAudit('delete', 'campaign', id);
          if (window.showToast) showToast('Campaign deleted.');
          try { U.slideOut.requestCloseForce(); } catch (e) {}
          load();
        });
      }).catch(function (e) { console.error('[campaigns-v2] remove', e); if (window.showToast) showToast('Delete failed.', true); });
    },
    exportCsv: function () { return MastEntity.exportRows('campaigns-v2', visibleRows(), V2.statusFilter); }
  };

  MastAdmin.registerModule('campaigns-v2', {
    routes: { 'campaigns-v2': { tab: 'campaignsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
