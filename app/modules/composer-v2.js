/**
 * composer-v2.js — record-archetype twin of the legacy Composer surface
 * (standard-record-ui §10; marketing-v2-build-plan Wave 2).
 *
 * Legacy composer.js (#composer) is write-once / publish-many: the operator
 * authors ONE Content doc (title + body + images + target channels) and on
 * publish each channel module's "open from content" hook creates its own
 * artifact (blog post / social draft / newsletter section / story). This twin
 * re-hosts the content LIST → read/edit detail on the Entity Engine with
 * NATIVE create / edit / publish / delete — the editor is plain fields, small
 * enough for the engine edit form (unlike the blog Builder).
 *
 * Variant: a content doc has NO governed lifecycle — status is 'draft' |
 * 'published', flipped by the publish fan-out → Faceted Record, NOT
 * Process/MastFlow.
 *
 * Data (mirrors legacy exactly): admin/content keyed docs →
 *   { id, title, body, images[], targetChannels[], status, scheduledAt,
 *     createdAt, updatedAt, linkedArtifacts{}, source?, sourceUgcSubmissionId? }
 *
 * All writes DELEGATE to window.ComposerBridge (exposed in composer.js) so
 * the doc shape and the publish fan-out (sequential module loads + per-channel
 * hooks) stay single-sourced. Image attach reuses the legacy picker on the
 * classic editor (temp-link debt; the picker is modal + library-coupled).
 * RBAC: can('composer','edit'|'delete'). Flag-gated (?ui=1) at #composer-v2.
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

  var CHANNEL_LABEL = { blog: '📝 Blog', social: '📱 Social', newsletter: '✉️ Newsletter', story: '📖 Story' };
  var STATUS_TONE = { draft: 'info', published: 'success' };
  function statusKey(c) { return String(c.status || 'draft').toLowerCase(); }
  function channels(c) { return Array.isArray(c.targetChannels) ? c.targetChannels : []; }
  function channelNames(c) { return channels(c).map(function (ch) { return (CHANNEL_LABEL[ch] || ch).replace(/^\S+\s/, ''); }); }
  function canDo(perm) { return typeof window.can !== 'function' || window.can('composer', perm); }
  function bridge() {
    if (window.ComposerBridge) return window.ComposerBridge;
    if (window.showToast) showToast('Composer engine still loading — try again', true);
    return null;
  }

  // Linked-artifact deep links (mirrors legacy _formatLinked; social posts
  // gained a V2 home in Wave 1).
  function linkedLinks(la) {
    var parts = [];
    if (!la) return parts;
    if (la.blogPostId) parts.push('<a href="#blog?postId=' + esc(la.blogPostId) + '" style="color:var(--teal);">Blog post</a>');
    if (la.socialPostId || la.social) parts.push('<a href="#social-v2" style="color:var(--teal);">Social post</a>');
    if (la.newsletterSectionId) parts.push('Newsletter section');
    if (la.storyId) parts.push('<a href="#stories" style="color:var(--teal);">Story</a>');
    return parts;
  }

  MastEntity.define('composer-v2', {
    label: 'Content', labelPlural: 'Content', size: 'lg', route: 'composer-v2',
    recordId: function (r) { return r._key || r.id; },
    fields: [
      { name: 'title', label: 'Title', type: 'text', list: true, readOnly: true,
        get: function (c) { return c.title || '(untitled)'; } },
      { name: 'channels', label: 'Channels', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (c) { return channelNames(c).join(', ') || '—'; } },
      { name: 'updatedAt', label: 'Updated', type: 'date', list: true, readOnly: true,
        get: function (c) { return c.updatedAt || c.createdAt || null; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['draft', 'published'], get: statusKey,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return Promise.resolve(MastDB.get('admin/content/' + id)).then(function (r) {
        return r ? Object.assign({ _key: id }, r) : null;
      });
    },
    detail: {
      render: function (UI, c) {
        var id = c._key || c.id;
        var imgs = Array.isArray(c.images) ? c.images : [];
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(statusKey(c) === 'published' ? 'Published' : 'Draft', STATUS_TONE[statusKey(c)] || 'neutral'), hero: true },
          { k: 'Channels', v: esc(channelNames(c).join(', ') || '—') },
          { k: 'Images', v: N.count(imgs.length) },
          { k: 'Updated', v: (c.updatedAt || c.createdAt) ? N.date(c.updatedAt || c.createdAt) : '—' }
        ]);

        var actions = '';
        if (canDo('edit') && statusKey(c) === 'draft' && channels(c).length) {
          actions += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px;">' +
            '<button class="btn btn-primary btn-small" onclick="ComposerV2.publish(\'' + esc(id) + '\')">Publish to ' +
              esc(channelNames(c).join(' + ')) + ' →</button>' +
            (canDo('delete') ? '<button class="btn btn-secondary btn-small" onclick="ComposerV2.remove(\'' + esc(id) + '\')" style="color:var(--text-danger);">Delete draft</button>' : '') +
          '</div>';
        }

        var bodyCard = UI.card('Body', c.body
          ? '<div style="font-size:0.9rem;line-height:1.55;white-space:pre-wrap;">' + esc(c.body) + '</div>'
          : '<span class="mu-sub">Nothing written yet.</span>');

        var imgCard = imgs.length
          ? UI.card('Images', '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              imgs.map(function (url, i) { return UI.imageThumb('Image ' + (i + 1), url); }).join('') + '</div>')
          : '';

        var links = linkedLinks(c.linkedArtifacts);
        var linkedCard = UI.card('Published artifacts', links.length
          ? '<div style="font-size:0.9rem;">' + links.join(' · ') + '</div>'
          : '<span class="mu-sub">' + (statusKey(c) === 'published' ? 'No artifact links recorded.' : 'Publishing creates one artifact per selected channel.') + '</span>');

        var meta = UI.kv([
          { k: 'Source', v: c.source === 'ugc' ? 'Customer photo (UGC)' : 'Studio' },
          { k: 'Created', v: c.createdAt ? N.date(c.createdAt) : '—' },
          { k: 'Updated', v: c.updatedAt ? N.date(c.updatedAt) : '—' }
        ]);

        return tiles + actions + bodyCard + imgCard + linkedCard + UI.card('About', meta);
      },
      editRender: function (c, mode) {
        c = c || {};
        function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        var chs = channels(c);
        function cb(val) {
          return '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:0.9rem;">' +
            '<input type="checkbox" class="cmpsV2Ch" value="' + val + '"' + (chs.indexOf(val) >= 0 ? ' checked' : '') + '> ' + (CHANNEL_LABEL[val] || val) + '</label>';
        }
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New content draft' : 'Edit this draft') + '</div>' +
          fg('Title', '<input class="form-input" id="cmpsV2Title" value="' + esc(c.title || '') + '" style="width:100%;" placeholder="e.g. June studio update">') +
          fg('Body', '<textarea class="form-input" id="cmpsV2Body" rows="10" style="width:100%;resize:vertical;" placeholder="Write once — publish to every channel you pick.">' + esc(c.body || '') + '</textarea>') +
          fg('Target channels', '<div style="padding:4px 0;">' + cb('blog') + cb('social') + cb('newsletter') + cb('story') + '</div>') +
          (mode === 'create' ? '' :
            '<div class="mu-sub" style="font-size:0.78rem;">Images are attached in the classic editor (library picker) — <a href="javascript:void(0)" onclick="ComposerV2.classic(\'' + esc(c._key || c.id || '') + '\')" style="color:var(--teal);">open classic →</a></div>');
      }
    },
    onSave: function (rec, mode) {
      if (!canDo('edit')) { if (window.showToast) showToast('You don\'t have permission to edit content.', true); return false; }
      var b = bridge(); if (!b) return false;
      function val(id) { return ((document.getElementById(id) || {}).value || ''); }
      var patch = {
        title: val('cmpsV2Title').trim(),
        body: val('cmpsV2Body'),
        targetChannels: Array.prototype.slice.call(document.querySelectorAll('.cmpsV2Ch:checked')).map(function (el) { return el.value; })
      };
      if (mode === 'create') {
        return Promise.resolve(b.create(patch)).then(function () {
          if (window.showToast) showToast('Draft created.');
          reloadSoon(); return true;
        }).catch(function (e) { console.error('[composer-v2] create', e); if (window.showToast) showToast('Error creating draft.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(b.update(id, patch)).then(function () {
        Object.assign(V2.byId[id] || rec, patch);
        if (window.showToast) showToast('Draft saved.');
        reloadSoon(); return true;
      }).catch(function (e) { console.error('[composer-v2] save', e); if (window.showToast) showToast('Error saving draft.', true); return false; });
    }
  });

  // -- module state + data ---------------------------------------------
  var V2 = { rows: [], byId: {}, sortKey: 'updatedAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Ensure legacy composer.js is loaded so window.ComposerBridge (the
    // delegated write path + publish fan-out) exists.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('composer'); } catch (e) {} }
    Promise.resolve(MastDB.list('admin/content', { limit: 500 })).then(function (val) {
      val = (val && typeof val.val === 'function') ? val.val() : val;
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var c = val[k];
        if (c && typeof c === 'object') out.push(Object.assign({ _key: k }, c));
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[composer-v2] load', e); V2.loaded = true; render(); });
  }
  function reloadSoon() { setTimeout(load, 250); }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (c) { return statusKey(c) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (c) {
        return String(c.title || '').toLowerCase().indexOf(q) >= 0 ||
               String(c.body || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('composer-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('composerV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'composerV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Composer' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>';
      return;
    }
    var filters = [['all', 'All'], ['draft', 'Drafts'], ['published', 'Published']].map(function (f) {
      var on = V2.statusFilter === f[0];
      return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ComposerV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
    }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Composer',
        count: N.count(V2.rows.length) + ' piece' + (V2.rows.length === 1 ? '' : 's'),
        subtitle: 'Write once, publish to Blog / Social / Newsletter / Story. Per-channel editors stay available for one-offs.',
        actionsHtml:
          (canDo('edit') ? '<button class="btn btn-primary" onclick="ComposerV2.create()">+ New draft</button>' : '') +
          '<button class="btn btn-secondary" onclick="ComposerV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search title or body…" value="' + esc(V2.q) +
        '" oninput="ComposerV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('composer-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ComposerV2.sort', onRowClickFnName: 'ComposerV2.open',
        empty: { title: 'No content yet', message: 'Write your first multi-channel piece.' }
      });
  }

  window.ComposerV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'updatedAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('composer-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('composer-v2', rec, 'read');
      });
    },
    create: function () {
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('composer'); } catch (e) {} }
      MastEntity.openRecord('composer-v2', {}, 'create');
    },
    _reopen: function (id) { var rec = V2.byId[id]; if (rec) MastEntity.openRecord('composer-v2', rec, 'read'); },
    publish: function (id) {
      if (!canDo('edit')) { if (window.showToast) showToast('You don\'t have permission to publish.', true); return; }
      var b = bridge(); if (!b) return;
      var rec = V2.byId[id]; if (!rec) return;
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Publish to ' + (channelNames(rec).join(', ') || 'the selected channels') + '? Each channel gets its own draft artifact.', { title: 'Publish?', confirmLabel: 'Publish' })
        : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(b.publish(id)).then(function (done) {
          if (window.showToast) showToast('Published to: ' + ((done || []).join(', ') || 'no channels'));
          if (V2.byId[id]) V2.byId[id].status = 'published';
          ComposerV2._reopen(id); reloadSoon();
        });
      }).catch(function (e) { console.error('[composer-v2] publish', e); if (window.showToast) showToast('Publish failed.', true); });
    },
    remove: function (id) {
      if (!canDo('delete')) { if (window.showToast) showToast('You don\'t have permission to delete content.', true); return; }
      var b = bridge(); if (!b) return;
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Delete this content draft? Published artifacts (blog posts, social drafts…) are NOT deleted.', { title: 'Delete draft?', confirmLabel: 'Delete', dangerous: true })
        : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(b.remove(id)).then(function () {
          if (window.showToast) showToast('Draft deleted.');
          try { U.slideOut.requestCloseForce(); } catch (e) {}
          load();
        });
      }).catch(function (e) { console.error('[composer-v2] remove', e); if (window.showToast) showToast('Delete failed.', true); });
    },
    classic: function (id) {
      if (typeof window.navigateToClassic === 'function') navigateToClassic('composer', id ? { id: id } : undefined);
      else if (typeof window.navigateTo === 'function') navigateTo('composer', id ? { id: id } : undefined);
    },
    exportCsv: function () { return MastEntity.exportRows('composer-v2', visibleRows(), V2.statusFilter); }
  };

  MastAdmin.registerModule('composer-v2', {
    routes: { 'composer-v2': { tab: 'composerV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
