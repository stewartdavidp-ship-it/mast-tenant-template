/**
 * Campaigns Module — W2.6
 *
 * Lightweight aggregator for cross-channel marketing campaigns. A campaign is
 * a named, dated container that references existing artifacts (blog posts,
 * newsletter issues, social posts, stories) and groups them under a single
 * utm_campaign value for attribution roll-up.
 *
 * Firebase: tenants/{tid}/admin/campaigns/{campaignId}
 *   { id, name, goal, startDate, endDate, utmCampaign,
 *     references: [{ type, refId, scheduledFor, addedAt }],
 *     status, createdAt, updatedAt }
 *
 * Admin-only writes — covered by the existing admin-only catch-all rule.
 *
 * Lazy-loaded via MastAdmin.registerModule('campaigns', ...).
 */
(function() {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────
  // Module-private state
  // ─────────────────────────────────────────────────────────────────────

  var campaignsLoaded = false;
  var campaigns = {};
  var currentCampaignId = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function nowIso() { return new Date().toISOString(); }

  // Slugify a campaign name into a deterministic utm_campaign token.
  function slugifyCampaign(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'campaign';
  }

  // ─────────────────────────────────────────────────────────────────────
  // Data loading
  // ─────────────────────────────────────────────────────────────────────

  async function loadCampaigns() {
    try {
      campaigns = (await MastDB.list('admin/campaigns')) || {};
    } catch (e) {
      console.warn('[W2.6 campaigns] load failed', e);
      campaigns = {};
    }
    campaignsLoaded = true;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Render — list view
  // ─────────────────────────────────────────────────────────────────────

  async function renderCampaigns() {
    var host = document.getElementById('campaignsTab');
    if (!host) return;
    if (!campaignsLoaded) {
      host.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading campaigns...</div>';
      await loadCampaigns();
    }
    var params = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    if (params.id && campaigns[params.id]) {
      currentCampaignId = params.id;
      renderCampaignDetail(params.id);
      return;
    }
    currentCampaignId = null;

    var ids = Object.keys(campaigns);
    ids.sort(function(a, b) { return (campaigns[b].createdAt || '').localeCompare(campaigns[a].createdAt || ''); });

    var html =
      '<div class="section-header">' +
        '<h2>Campaigns</h2>' +
        '<button class="btn btn-primary" onclick="campaignsCreateNew()" style="font-size:0.85rem;">+ New Campaign</button>' +
      '</div>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">' +
        'Group blog, newsletter, social, and story posts under a single utm_campaign tag for attribution roll-up.' +
      '</div>';

    if (!ids.length) {
      html += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">' +
        'No campaigns yet. Click "+ New Campaign" to create your first one.' +
      '</div>';
      host.innerHTML = html;
      return;
    }

    html += '<div class="data-table"><table style="width:100%;border-collapse:collapse;">' +
      '<thead><tr style="border-bottom:1px solid var(--cream-dark);text-align:left;font-size:0.85rem;">' +
        '<th style="padding:8px;">Name</th>' +
        '<th style="padding:8px;">Goal</th>' +
        '<th style="padding:8px;">Date range</th>' +
        '<th style="padding:8px;">References</th>' +
        '<th style="padding:8px;">UTM</th>' +
        '<th style="padding:8px;">Status</th>' +
        '<th style="padding:8px;">Created</th>' +
      '</tr></thead><tbody>';
    ids.forEach(function(cid) {
      var c = campaigns[cid];
      var refs = (c.references || []).length;
      var date = (c.startDate || '') + (c.endDate ? ' → ' + c.endDate : '');
      var created = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '';
      html += '<tr onclick="navigateTo(\'campaigns\', { id: \'' + esc(cid) + '\' })" style="cursor:pointer;border-bottom:1px solid var(--cream);font-size:0.9rem;">' +
        '<td style="padding:8px;font-weight:600;">' + esc(c.name || '(untitled)') + '</td>' +
        '<td style="padding:8px;">' + esc((c.goal || '').slice(0, 60)) + '</td>' +
        '<td style="padding:8px;font-size:0.85rem;">' + esc(date) + '</td>' +
        '<td style="padding:8px;">' + refs + '</td>' +
        '<td style="padding:8px;font-family:monospace;font-size:0.78rem;">' + esc(c.utmCampaign || '') + '</td>' +
        '<td style="padding:8px;font-size:0.85rem;">' + esc(c.status || 'active') + '</td>' +
        '<td style="padding:8px;font-size:0.78rem;color:var(--warm-gray);">' + created + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
    host.innerHTML = html;
  }
  window.renderCampaigns = renderCampaigns;

  // ─────────────────────────────────────────────────────────────────────
  // Render — detail view
  // ─────────────────────────────────────────────────────────────────────

  function renderCampaignDetail(cid) {
    var c = campaigns[cid];
    var host = document.getElementById('campaignsTab');
    if (!host || !c) return;
    var refs = (c.references || []).slice().sort(function(a, b) {
      return (a.scheduledFor || '').localeCompare(b.scheduledFor || '');
    });

    var html =
      '<div class="section-header">' +
        '<button class="btn btn-secondary btn-small" onclick="navigateTo(\'campaigns\')" style="margin-right:8px;">&larr; Back</button>' +
        '<h2 style="display:inline-block;">' + esc(c.name || '(untitled)') + '</h2>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:12px 0;">' +
        _editField('Name', 'name', c.name) +
        _editField('Goal', 'goal', c.goal) +
        _editField('Start date', 'startDate', c.startDate, 'date') +
        _editField('End date', 'endDate', c.endDate, 'date') +
        _editField('Status', 'status', c.status || 'active') +
        '<div><label style="font-size:0.78rem;color:var(--warm-gray);">UTM campaign</label>' +
          '<div style="font-family:monospace;font-size:0.85rem;padding:6px 0;">' + esc(c.utmCampaign || '') + '</div></div>' +
      '</div>' +
      '<div style="margin:8px 0;"><button class="btn btn-primary btn-small" onclick="campaignsSaveCurrent()">Save</button>' +
        ' <button class="btn btn-danger btn-small" onclick="campaignsDelete(\'' + esc(cid) + '\')" style="margin-left:8px;">Delete</button></div>' +
      '<h3 style="margin-top:24px;font-size:1.15rem;">References (' + refs.length + ')</h3>' +
      '<div style="margin:6px 0;"><button class="btn btn-secondary btn-small" onclick="campaignsAddReference()">+ Add reference</button></div>';

    if (!refs.length) {
      html += '<div style="color:var(--warm-gray);padding:12px 0;font-size:0.85rem;">No references yet.</div>';
    } else {
      html += '<div class="data-table"><table style="width:100%;border-collapse:collapse;">' +
        '<thead><tr style="border-bottom:1px solid var(--cream-dark);text-align:left;font-size:0.85rem;">' +
          '<th style="padding:6px;">Type</th><th style="padding:6px;">Ref</th>' +
          '<th style="padding:6px;">Scheduled for</th><th style="padding:6px;">Added</th><th style="padding:6px;"></th>' +
        '</tr></thead><tbody>';
      refs.forEach(function(r, idx) {
        var hash = _refToHash(r);
        html += '<tr style="border-bottom:1px solid var(--cream);font-size:0.85rem;">' +
          '<td style="padding:6px;">' + esc(r.type) + '</td>' +
          '<td style="padding:6px;">' + (hash ? '<a href="#' + esc(hash) + '">' + esc(r.refId) + '</a>' : esc(r.refId)) + '</td>' +
          '<td style="padding:6px;">' + esc(r.scheduledFor || '') + '</td>' +
          '<td style="padding:6px;color:var(--warm-gray);">' + esc((r.addedAt || '').slice(0, 10)) + '</td>' +
          '<td style="padding:6px;"><button class="btn-link" onclick="campaignsRemoveReference(' + idx + ')" style="color:var(--text-danger,#c00);background:none;border:none;cursor:pointer;font-size:0.78rem;">remove</button></td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }

    html += '<h3 style="margin-top:24px;font-size:1.15rem;">Attribution</h3>' +
      '<div id="campaignAttribution" style="font-size:0.9rem;color:var(--warm-gray);">Computing...</div>';
    host.innerHTML = html;
    setTimeout(function() { renderCampaignAttribution(cid); }, 0);
  }

  function _editField(label, key, value, type) {
    type = type || 'text';
    return '<div><label style="font-size:0.78rem;color:var(--warm-gray);">' + esc(label) + '</label>' +
      '<input id="camp_' + esc(key) + '" type="' + esc(type) + '" value="' + esc(value || '') + '" style="width:100%;padding:6px 8px;font-size:0.9rem;"></div>';
  }

  function _refToHash(r) {
    switch (r.type) {
      case 'blog':       return 'blog?postId=' + r.refId;
      case 'newsletter': return 'newsletter?issueId=' + r.refId;
      case 'social':     return 'social?postId=' + r.refId;
      case 'story':      return 'stories?storyId=' + r.refId;
      default: return '';
    }
  }

  async function renderCampaignAttribution(cid) {
    var c = campaigns[cid];
    var el = document.getElementById('campaignAttribution');
    if (!el || !c || !c.utmCampaign) {
      if (el) el.innerHTML = 'No utm_campaign assigned yet.';
      return;
    }
    // Reuse the global traffic-by-source helper if W2.5 is loaded.
    if (typeof window.computeAttributionForCampaign === 'function') {
      var data = await window.computeAttributionForCampaign(c.utmCampaign);
      el.innerHTML = _formatAttribution(data);
    } else {
      el.innerHTML = '<em>Open the Analytics → Traffic & Revenue by Source panel to see attribution.</em>';
    }
  }

  function _formatAttribution(d) {
    if (!d) return 'No data.';
    if (!d.totalHits && !d.totalRevenue) return 'No traffic captured for this campaign yet.';
    return '<div>Hits: <strong>' + (d.totalHits || 0) + '</strong> · ' +
           'Orders attributed: <strong>' + (d.orderCount || 0) + '</strong> · ' +
           'Revenue: <strong>$' + ((d.totalRevenue || 0) / 100).toFixed(2) + '</strong></div>';
  }

  // ─────────────────────────────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────────────────────────────

  // FIX 2 (W2 round 1): replaced window.prompt() with an in-page modal.
  // window.prompt() blocks the renderer thread synchronously and, in some
  // Chromium contexts (Chrome MCP automation, certain extension flows),
  // can hang for tens of seconds before resolving — which the persona
  // test surfaced as a >45s freeze on click. Modals are also consistent
  // with the rest of the admin UI's "Add reference" / "Add to campaign"
  // flows in this same file.
  function campaignsCreateNew() {
    var html =
      '<div class="modal-header"><h3>New Campaign</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body">' +
        '<div class="form-group"><label>Campaign name</label>' +
          '<input type="text" id="newCampaignName" placeholder="e.g. Spring 2026 Glass Show" style="width:100%;padding:6px 8px;font-size:0.9rem;" autofocus></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="campaignsCreateNewConfirm()">Create</button>' +
      '</div>';
    openModal(html);
    setTimeout(function() {
      var el = document.getElementById('newCampaignName');
      if (el) {
        el.focus();
        el.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); campaignsCreateNewConfirm(); }
        });
      }
    }, 0);
  }
  window.campaignsCreateNew = campaignsCreateNew;

  async function campaignsCreateNewConfirm() {
    var el = document.getElementById('newCampaignName');
    var name = el ? (el.value || '').trim() : '';
    if (!name) {
      if (typeof showToast === 'function') showToast('Campaign name required', true);
      return;
    }
    if (typeof closeModal === 'function') closeModal();
    var id = MastDB.newKey('admin/campaigns');
    var doc = {
      id: id, name: name, goal: '', startDate: '', endDate: '',
      utmCampaign: slugifyCampaign(name), references: [],
      status: 'active', createdAt: nowIso(), updatedAt: nowIso()
    };
    try {
      await MastDB.set('admin/campaigns/' + id, doc);
      campaigns[id] = doc;
      if (typeof showToast === 'function') showToast('Campaign created');
      navigateTo('campaigns', { id: id });
    } catch (e) {
      console.warn('[W2.6] create', e);
      if (typeof showToast === 'function') showToast('Failed to create campaign', true);
    }
  }
  window.campaignsCreateNewConfirm = campaignsCreateNewConfirm;

  async function campaignsSaveCurrent() {
    if (!currentCampaignId) return;
    var c = campaigns[currentCampaignId];
    if (!c) return;
    var name = (document.getElementById('camp_name') || {}).value || c.name;
    var goal = (document.getElementById('camp_goal') || {}).value || '';
    var sd = (document.getElementById('camp_startDate') || {}).value || '';
    var ed = (document.getElementById('camp_endDate') || {}).value || '';
    var status = (document.getElementById('camp_status') || {}).value || 'active';
    var patch = {
      name: name.trim(), goal: goal.trim(), startDate: sd, endDate: ed,
      status: status, utmCampaign: slugifyCampaign(name), updatedAt: nowIso()
    };
    try {
      await MastDB.update('admin/campaigns/' + currentCampaignId, patch);
      Object.assign(c, patch);
      if (typeof showToast === 'function') showToast('Saved');
      renderCampaignDetail(currentCampaignId);
    } catch (e) {
      if (typeof showToast === 'function') showToast('Save failed', true);
    }
  }
  window.campaignsSaveCurrent = campaignsSaveCurrent;

  async function campaignsDelete(cid) {
    if (!confirm('Delete this campaign? (Linked artifacts are not deleted.)')) return;
    try {
      await MastDB.remove('admin/campaigns/' + cid);
      delete campaigns[cid];
      if (typeof showToast === 'function') showToast('Deleted');
      navigateTo('campaigns');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Delete failed', true);
    }
  }
  window.campaignsDelete = campaignsDelete;

  function campaignsAddReference() {
    if (!currentCampaignId) return;
    var html =
      '<div class="modal-header"><h3>Add reference</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body">' +
        '<div class="form-group"><label>Type</label>' +
          '<select id="refType"><option value="blog">Blog post</option>' +
            '<option value="newsletter">Newsletter issue</option>' +
            '<option value="social">Social post</option>' +
            '<option value="story">Story</option></select></div>' +
        '<div class="form-group"><label>Reference ID</label>' +
          '<input type="text" id="refId" placeholder="e.g. -ObAbc123..."></div>' +
        '<div class="form-group"><label>Scheduled for</label>' +
          '<input type="date" id="refScheduledFor"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="campaignsSaveReference()">Add</button>' +
      '</div>';
    openModal(html);
  }
  window.campaignsAddReference = campaignsAddReference;

  async function campaignsSaveReference() {
    if (!currentCampaignId) return;
    var type = (document.getElementById('refType') || {}).value;
    var refId = ((document.getElementById('refId') || {}).value || '').trim();
    var sched = (document.getElementById('refScheduledFor') || {}).value || '';
    if (!refId) { if (typeof showToast === 'function') showToast('Reference ID required', true); return; }
    var c = campaigns[currentCampaignId];
    var refs = (c.references || []).slice();
    refs.push({ type: type, refId: refId, scheduledFor: sched, addedAt: nowIso() });
    try {
      await MastDB.update('admin/campaigns/' + currentCampaignId, { references: refs, updatedAt: nowIso() });
      c.references = refs;
      if (typeof closeModal === 'function') closeModal();
      renderCampaignDetail(currentCampaignId);
    } catch (e) {
      if (typeof showToast === 'function') showToast('Failed', true);
    }
  }
  window.campaignsSaveReference = campaignsSaveReference;

  async function campaignsRemoveReference(idx) {
    if (!currentCampaignId) return;
    var c = campaigns[currentCampaignId];
    var refs = (c.references || []).slice();
    refs.splice(idx, 1);
    try {
      await MastDB.update('admin/campaigns/' + currentCampaignId, { references: refs, updatedAt: nowIso() });
      c.references = refs;
      renderCampaignDetail(currentCampaignId);
    } catch (e) { /* silent */ }
  }
  window.campaignsRemoveReference = campaignsRemoveReference;

  // ─────────────────────────────────────────────────────────────────────
  // Public hook — used by blog/social/newsletter/stories detail pages to
  // attach the current artifact to a campaign without leaving the editor.
  // ─────────────────────────────────────────────────────────────────────

  async function openAddToCampaignPicker(type, refId) {
    if (!campaignsLoaded) await loadCampaigns();
    var ids = Object.keys(campaigns);
    var html =
      '<div class="modal-header"><h3>Add to Campaign</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body">';
    if (!ids.length) {
      html += '<p style="color:var(--warm-gray);">No campaigns yet. Create one from Marketing → Campaigns.</p>';
    } else {
      html += '<div class="form-group"><label>Campaign</label>' +
        '<select id="addToCampPick">' +
          ids.map(function(cid) {
            return '<option value="' + esc(cid) + '">' + esc(campaigns[cid].name || '(untitled)') + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="form-group"><label>Scheduled for</label>' +
          '<input type="date" id="addToCampSched"></div>';
    }
    html += '</div><div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      (ids.length ? '<button class="btn btn-primary" onclick="campaignsAttachArtifact(\'' + esc(type) + '\', \'' + esc(refId) + '\')">Attach</button>' : '') +
    '</div>';
    openModal(html);
  }
  window.openAddToCampaignPicker = openAddToCampaignPicker;

  async function campaignsAttachArtifact(type, refId) {
    var cid = (document.getElementById('addToCampPick') || {}).value;
    var sched = (document.getElementById('addToCampSched') || {}).value || '';
    if (!cid) return;
    var c = campaigns[cid];
    if (!c) return;
    var refs = (c.references || []).slice();
    // dedupe by type+refId
    if (refs.some(function(r) { return r.type === type && r.refId === refId; })) {
      if (typeof showToast === 'function') showToast('Already in this campaign');
      if (typeof closeModal === 'function') closeModal();
      return;
    }
    refs.push({ type: type, refId: refId, scheduledFor: sched, addedAt: nowIso() });
    try {
      await MastDB.update('admin/campaigns/' + cid, { references: refs, updatedAt: nowIso() });
      c.references = refs;
      if (typeof closeModal === 'function') closeModal();
      if (typeof showToast === 'function') showToast('Added to campaign');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Failed', true);
    }
  }
  window.campaignsAttachArtifact = campaignsAttachArtifact;

  // ─────────────────────────────────────────────────────────────────────
  // Register
  // ─────────────────────────────────────────────────────────────────────

  MastAdmin.registerModule('campaigns', {
    routes: {
      'campaigns': {
        tab: 'campaignsTab',
        setup: function() { renderCampaigns(); }
      }
    }
  });
})();
