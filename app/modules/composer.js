/**
 * Composer Module — W2.2
 *
 * Write-once / publish-many. Operator authors a single Content doc with
 * title + body + images + voice-rule sidebar, picks channels (Blog /
 * Social / Newsletter / Story), and on publish each module's existing
 * "open from content" hook creates the channel-specific artifact.
 *
 * Firebase: tenants/{tid}/admin/content/{contentId}
 *   { id, title, body, images[], targetChannels[], status,
 *     scheduledAt, createdAt, updatedAt, linkedArtifacts: {...} }
 *
 * Admin-only writes — existing catch-all rule covers admin/content.
 * Lazy-loaded module.
 *
 * Per-module editors STAY: composer is additive — operators can still
 * create a one-channel artifact directly in the source module.
 */
(function() {
  'use strict';

  var loaded = false;
  var listLoaded = false;
  var contents = {};
  var current = null;
  var voiceRules = '';
  var brandTagline = '';
  var brandPositioning = '';
  var brandLoaded = false;
  var imagesLoadedLocal = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nowIso() { return new Date().toISOString(); }

  // W3a-cleanup (OPEN -OtI-3TBmtdikQVADTSZ): defense-in-depth scheme validation
  // for image URLs. The composer image picker only selects from the curated
  // library, but library URLs originate from user input and Firestore can be
  // edited externally. Reject anything that isn't http(s) or a data: image MIME.
  // Returns '' for rejected URLs — callers should fall back to a placeholder.
  function safeImageUrl(u) {
    if (!u) return '';
    var s = String(u).trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);/i.test(s)) return s;
    return '';
  }

  async function loadList() {
    try { contents = (await MastDB.list('admin/content')) || {}; }
    catch (_e) { contents = {}; }
    listLoaded = true;
  }
  async function loadBrandVoice() {
    // FIX 1 (W2 round 2): brand.js writes ALL three voice fields to
    // `config/brand/voice` (admin-only) — tagline, positioningOneLiner,
    // voiceRules. The mirror to `public/config/brand` is for the storefront
    // head only. Single source-of-truth read here covers all three.
    if (brandLoaded) return;
    try {
      var v = await MastDB.get('config/brand/voice');
      voiceRules = (v && v.voiceRules) || '';
      brandTagline = (v && v.tagline) || '';
      brandPositioning = (v && v.positioningOneLiner) || '';
    } catch (_e) {
      voiceRules = ''; brandTagline = ''; brandPositioning = '';
    }
    brandLoaded = true;
  }

  async function render() {
    var host = document.getElementById('composerTab');
    if (!host) return;
    if (!listLoaded) {
      host.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading composer...</div>';
      await Promise.all([loadList(), loadBrandVoice()]);
    }
    var params = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    if (params.id) {
      current = contents[params.id] || null;
      if (!current) {
        host.innerHTML = '<div style="padding:24px;color:var(--warm-gray);">Content not found.</div>';
        return;
      }
      renderEditor();
      return;
    }
    if (params.newDraft === '1') {
      newDraft();
      return;
    }
    current = null;
    renderList();
  }
  window.renderComposer = render;

  function renderList() {
    var host = document.getElementById('composerTab');
    if (!host) return;
    var ids = Object.keys(contents);
    ids.sort(function(a, b) { return (contents[b].updatedAt || '').localeCompare(contents[a].updatedAt || ''); });
    var html =
      '<div class="section-header">' +
        '<h2>Composer</h2>' +
        '<button class="btn btn-primary" onclick="composerNewDraft()">+ New Draft</button>' +
      '</div>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">' +
        'Write once, publish to Blog / Social / Newsletter / Story. Each per-channel editor stays available for one-off posts.' +
      '</div>';
    if (!ids.length) {
      html += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">' +
        'No drafts yet. Click "+ New Draft" to write your first multi-channel piece.</div>';
      host.innerHTML = html;
      return;
    }
    html += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
      '<thead><tr style="border-bottom:1px solid var(--cream-dark);text-align:left;">' +
        '<th style="padding:6px;">Title</th>' +
        '<th style="padding:6px;">Channels</th>' +
        '<th style="padding:6px;">Status</th>' +
        '<th style="padding:6px;">Updated</th>' +
      '</tr></thead><tbody>';
    ids.forEach(function(cid) {
      var c = contents[cid];
      html += '<tr onclick="navigateTo(\'composer\', { id: \'' + esc(cid) + '\' })" style="cursor:pointer;border-bottom:1px solid var(--cream);">' +
        '<td style="padding:6px;font-weight:600;">' + esc(c.title || '(untitled)') + '</td>' +
        '<td style="padding:6px;">' + esc((c.targetChannels || []).join(', ')) + '</td>' +
        '<td style="padding:6px;">' + esc(c.status || 'draft') + '</td>' +
        '<td style="padding:6px;color:var(--warm-gray);">' + ((c.updatedAt || '').slice(0, 10)) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
  }

  async function newDraft() {
    var id = MastDB.newKey('admin/content');
    var doc = {
      id: id, title: '', body: '', images: [],
      targetChannels: [], status: 'draft',
      scheduledAt: null, createdAt: nowIso(), updatedAt: nowIso(),
      linkedArtifacts: {}
    };
    try {
      await MastDB.set('admin/content/' + id, doc);
      contents[id] = doc;
      navigateTo('composer', { id: id });
    } catch (e) {
      if (typeof showToast === 'function') showToast('Failed to create draft', true);
    }
  }
  window.composerNewDraft = newDraft;

  function renderEditor() {
    var host = document.getElementById('composerTab');
    if (!host || !current) return;
    var c = current;
    var channels = c.targetChannels || [];
    var images = c.images || [];

    var html =
      '<div class="section-header">' +
        '<button class="detail-back" onclick="navigateTo(\'composer\')" style="margin-right:8px;">&larr; Back to Composer</button>' +
        '<h2 style="display:inline-block;">Composer</h2>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 280px;gap:16px;">' +
        // Main editor column
        '<div>' +
          '<div class="form-group"><label>Title</label>' +
            '<input id="composerTitle" type="text" value="' + esc(c.title || '') + '" style="width:100%;font-size:1.0rem;padding:8px;"></div>' +
          '<div class="form-group"><label>Body</label>' +
            '<textarea id="composerBody" rows="14" style="width:100%;font-size:0.9rem;padding:8px;font-family:inherit;">' + esc(c.body || '') + '</textarea>' +
          '</div>' +
          '<div class="form-group"><label>Images</label>' +
            '<div id="composerImageList" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">' +
              images.map(function(url) {
                var safe = safeImageUrl(url);
                if (!safe) return '';
                return '<div style="position:relative;"><img src="' + esc(safe) + '" style="width:60px;height:60px;object-fit:cover;border-radius:3px;"></div>';
              }).join('') +
              (!images.length ? '<span style="color:var(--warm-gray);font-size:0.78rem;">No images attached.</span>' : '') +
            '</div>' +
            '<button class="btn btn-secondary btn-small" onclick="composerPickImages()">+ Pick from library</button>' +
          '</div>' +
          '<div class="form-group"><label>Target channels</label>' +
            '<div style="display:flex;flex-direction:column;gap:6px;font-size:0.9rem;">' +
              _channelCheckbox('blog', channels) +
              _channelCheckbox('social', channels) +
              _channelCheckbox('newsletter', channels) +
              _channelCheckbox('story', channels) +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:12px;">' +
            '<button class="btn btn-secondary" onclick="composerSaveDraft()">Save Draft</button>' +
            '<button class="btn btn-primary" onclick="composerPublish()">Publish to selected channels</button>' +
            '<button class="btn btn-danger" onclick="composerDelete()" style="margin-left:auto;">Delete</button>' +
          '</div>' +
          // Linked artifacts (preview)
          (c.linkedArtifacts && Object.keys(c.linkedArtifacts).length
            ? '<div style="margin-top:14px;font-size:0.85rem;color:var(--warm-gray);">' +
                '<strong>Linked artifacts:</strong> ' + _formatLinked(c.linkedArtifacts) +
              '</div>'
            : '') +
        '</div>' +
        // Sidebar — voice rules
        '<aside style="border-left:1px solid var(--cream-dark);padding-left:14px;">' +
          '<h4 style="font-size:0.9rem;margin:0 0 6px 0;">Brand Voice</h4>' +
          (brandTagline
            ? '<div style="font-size:0.85rem;font-style:italic;color:var(--text-primary);margin-bottom:6px;">' +
                esc(brandTagline) +
              '</div>'
            : '') +
          (brandPositioning
            ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' +
                esc(brandPositioning) +
              '</div>'
            : '') +
          (voiceRules
            ? '<div style="font-size:0.78rem;color:var(--warm-gray);white-space:pre-wrap;">' +
                esc(voiceRules) +
              '</div>'
            : (!brandTagline && !brandPositioning
                ? '<div style="font-size:0.78rem;color:var(--warm-gray);">No voice set — open Brand &rarr; Voice to add some.</div>'
                : '')) +
        '</aside>' +
      '</div>' +
      // W3b — per-content attribution panel host.
      '<div id="composerAttrPanel"></div>';

    host.innerHTML = html;

    // W3b — populate attribution panel for this Content. Tracking URL points
    // to whichever channel artifact is linked (blog post by default; falls
    // back to storefront root).
    if (c && c.id && typeof window.renderContentAttributionPanel === 'function') {
      var attrHost = document.getElementById('composerAttrPanel');
      if (attrHost) {
        var la = c.linkedArtifacts || {};
        var path = '/';
        if (la.blogPostId) path = '/blog/post.html?id=' + encodeURIComponent(la.blogPostId);
        window.renderContentAttributionPanel({
          hostEl: attrHost,
          contentId: c.id,
          utmSource: 'content',
          utmMedium: 'organic',
          path: path,
        });
      }
    }
  }

  function _channelCheckbox(ch, current) {
    var checked = current.indexOf(ch) !== -1;
    var label = ({
      blog: '📝 Blog post',
      social: '📱 Social post',
      newsletter: '✉️ Newsletter section',
      story: '📖 Story'
    })[ch] || ch;
    return '<label style="display:inline-flex;align-items:center;gap:6px;">' +
      '<input type="checkbox" class="composer-ch" value="' + esc(ch) + '"' + (checked ? ' checked' : '') + '> ' + esc(label) +
    '</label>';
  }

  function _formatLinked(la) {
    var parts = [];
    if (la.blogPostId)              parts.push('<a href="#blog?postId=' + esc(la.blogPostId) + '">blog post</a>');
    if (la.socialPostId)            parts.push('social post');
    if (la.newsletterSectionId)     parts.push('newsletter section');
    if (la.storyId)                 parts.push('<a href="#stories">story</a>');
    return parts.join(', ') || '(none)';
  }

  function _collectChannels() {
    var out = [];
    var cbs = document.querySelectorAll('.composer-ch');
    for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) out.push(cbs[i].value);
    return out;
  }

  async function saveDraft() {
    if (!current) return;
    var title = (document.getElementById('composerTitle') || {}).value || '';
    var body  = (document.getElementById('composerBody')  || {}).value || '';
    var ch    = _collectChannels();
    var patch = {
      title: title.trim(),
      body: body,
      targetChannels: ch,
      updatedAt: nowIso()
    };
    try {
      await MastDB.update('admin/content/' + current.id, patch);
      Object.assign(current, patch);
      if (typeof showToast === 'function') showToast('Draft saved');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Save failed', true);
    }
  }
  window.composerSaveDraft = saveDraft;

  async function publish() {
    if (!current) return;
    await saveDraft();
    var ch = current.targetChannels || [];
    if (!ch.length) {
      if (typeof showToast === 'function') showToast('Pick at least one channel first', true);
      return;
    }
    // Sequentially load each module and call its open-from-content hook.
    var linked = Object.assign({}, current.linkedArtifacts || {});
    var done = [];
    for (var i = 0; i < ch.length; i++) {
      var channel = ch[i];
      try {
        if (channel === 'blog') {
          await _ensureModule('blog');
          if (typeof window.blogOpenFromContent === 'function') await window.blogOpenFromContent(current.id);
          done.push('blog');
        } else if (channel === 'social') {
          await _ensureModule('social');
          if (typeof window.socialOpenFromContent === 'function') await window.socialOpenFromContent(current.id);
          done.push('social');
        } else if (channel === 'newsletter') {
          await _ensureModule('newsletter');
          if (typeof window.newsletterOpenFromContent === 'function') await window.newsletterOpenFromContent(current.id);
          done.push('newsletter');
        } else if (channel === 'story') {
          await _ensureModule('production');
          if (typeof window.storyOpenFromContent === 'function') await window.storyOpenFromContent(current.id);
          done.push('story');
        }
      } catch (e) {
        console.warn('[composer] publish to ' + channel + ' failed', e);
      }
    }
    try {
      await MastDB.update('admin/content/' + current.id, {
        status: 'published',
        linkedArtifacts: linked,
        updatedAt: nowIso()
      });
      current.status = 'published';
    } catch (_e) {}
    if (typeof showToast === 'function') showToast('Published to: ' + done.join(', '));
  }
  window.composerPublish = publish;

  function _ensureModule(id) {
    if (typeof MastAdmin === 'undefined' || !MastAdmin.loadModule) return Promise.resolve();
    if (MastAdmin.isModuleLoaded && MastAdmin.isModuleLoaded(id)) return Promise.resolve();
    return MastAdmin.loadModule(id);
  }

  async function deleteCurrent() {
    if (!current) return;
    if (!confirm('Delete this content draft? Linked artifacts remain.')) return;
    try {
      await MastDB.remove('admin/content/' + current.id);
      delete contents[current.id];
      navigateTo('composer');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Delete failed', true);
    }
  }
  window.composerDelete = deleteCurrent;

  // ── Image picker ──
  async function pickImages() {
    var lib = (typeof imageLibrary === 'object' && imageLibrary) ? imageLibrary : {};
    if (!Object.keys(lib).length) {
      // If the core image library hasn't been listened-on yet, grab a snapshot.
      try { lib = (await MastDB.list('images')) || {}; } catch (_e) { lib = {}; }
    }
    var ids = Object.keys(lib);
    var selected = (current.images || []).slice();
    var html =
      '<div class="modal-header"><h3>Attach images</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body" style="max-height:60vh;overflow:auto;">';
    if (!ids.length) {
      html += '<p style="color:var(--warm-gray);">No images in library yet.</p>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px;">';
      ids.forEach(function(id) {
        var im = lib[id];
        var th = safeImageUrl(im.thumbnailUrl || im.url || '');
        var url = safeImageUrl(im.url || im.thumbnailUrl || '');
        if (!url) return; // skip library entries with rejected schemes
        var sel = selected.indexOf(url) !== -1;
        html += '<label style="position:relative;cursor:pointer;">' +
          '<input type="checkbox" class="composer-img-cb" data-url="' + esc(url) + '"' + (sel ? ' checked' : '') + ' style="position:absolute;top:2px;left:2px;z-index:1;">' +
          (th ? '<img src="' + esc(th) + '" style="width:100%;height:70px;object-fit:cover;border-radius:3px;' + (sel ? 'outline:2px solid var(--amber);' : '') + '">' : '<div style="height:70px;background:var(--charcoal);"></div>') +
        '</label>';
      });
      html += '</div>';
    }
    html += '</div><div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="composerAttachPicked()">Attach</button>' +
    '</div>';
    openModal(html);
  }
  window.composerPickImages = pickImages;

  async function attachPicked() {
    var cbs = document.querySelectorAll('.composer-img-cb');
    var urls = [];
    for (var i = 0; i < cbs.length; i++) {
      if (cbs[i].checked) urls.push(cbs[i].getAttribute('data-url'));
    }
    try {
      await MastDB.update('admin/content/' + current.id, { images: urls, updatedAt: nowIso() });
      current.images = urls;
      if (typeof closeModal === 'function') closeModal();
      renderEditor();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Attach failed', true);
    }
  }
  window.composerAttachPicked = attachPicked;

  MastAdmin.registerModule('composer', {
    routes: {
      'composer': {
        tab: 'composerTab',
        setup: function() { render(); }
      }
    }
  });
})();
