/**
 * blog-v2.js — read-focused Faceted Record twin of the legacy Blog POSTS list
 * (doc 17 §11/§12; engine-first redesign / conversion playbook).
 *
 * Legacy blog.js (#blog, owned by the Blog module) hosts the posts list as a
 * stack of rows and swaps the pane in-place to a rich Builder/canvas editor
 * (renderBlogEditor: contenteditable body, formatting toolbar, slash menu,
 * inline-image curation, AI polish, schedule/publish controls). This twin
 * re-hosts ONLY the posts LIST → read-detail on the Entity Engine: a
 * schema-driven list + a read-focused Faceted Record slide-out (single
 * Overview facet) showing title / author / status / cover / excerpt / tags /
 * dates + a plain-text body PREVIEW.
 *
 * Variant (doc 17 §1a): a blog post is a content record (title, author, status,
 * cover image, excerpt, tags, body) with no governed lifecycle — its status
 * (published / complete / scheduled / draft) is an assigned attribute, so it is
 * a Faceted Record, NOT Process / MastFlow.
 *
 * Create + light edit are NATIVE here: a custom detail.editRender + onSave that
 * DELEGATE to window.BlogBridge (exposed in blog.js). CREATE composes a basic
 * post (title / status / tags / excerpt / body) — the plain-text body is escaped
 * + wrapped by BlogBridge.create (blogPlainToHtml) so it can never render raw on
 * the storefront. EDIT is LIGHT (meta only — title / excerpt / tags). The rich
 * Builder/canvas (rich-text body editor, formatting toolbar, inline-image
 * curation, AI polish, SEO/schema, scheduling + website/Substack publish side
 * effects) stays single-sourced on legacy #blog via a "Write / publish in
 * classic view" link — that is the rich-authoring bridge, NOT a create punt. The
 * body is HTML on the doc; we
 * strip its tags to a plain-text preview (we never inject raw post HTML into the
 * slide-out) and esc() everything. Flag-gated (?ui=1) at #blog-v2, side-by-side;
 * never touches blog.js.
 *
 * Data: posts live at blog/posts (MastDB.blog.posts = _makeEntity('blog/posts',
 * 100)); read one-shot via the entity ref (orderByChild('createdAt')
 * .limitToLast(100)) -> keyed object. Real fields (from blog.js loadBlog /
 * blogCreatePost / renderBlogEditor): id, postNumber, title, slug, author (a uid
 * or a brand-author handle), body (HTML), status ('draft' | 'complete' |
 * 'scheduled' | 'posted' | 'published'), tags[], excerpt, featuredImageId
 * (resolves through the shared window.imageLibrary), publishedToWebsite (bool),
 * createdAt, updatedAt, publishedAt, scheduledAt. There is no cover-URL field on
 * the doc — the cover is featuredImageId resolved through imageLibrary
 * (.url / .thumbnailUrl), mirroring the legacy featured-image logic. Author
 * names + photos resolve from TENANT_CONFIG.brand.authors and, for uid-keyed
 * authors, window.getUserProfile (mirrors blog.js BLOG_AUTHORS enrichment).
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

  // Status vocabulary mirrors blog.js (draft → complete → scheduled →
  // posted/published). Read-only display lookups; kept local.
  var STATUS_LABEL = {
    draft: 'Draft', complete: 'Complete', scheduled: 'Scheduled',
    posted: 'Posted', published: 'Published'
  };
  var STATUS_TONE = {
    draft: 'amber', complete: 'teal', scheduled: 'info',
    posted: 'success', published: 'success'
  };

  function postTitle(p) { return (p && p.title) || 'Untitled post'; }
  function statusOf(p) { return (p && p.status) || 'draft'; }
  function tagsOf(p) { return (p && Array.isArray(p.tags)) ? p.tags : []; }
  function updatedAt(p) { return (p && (p.updatedAt || p.createdAt)) || null; }
  function publishedAt(p) {
    var s = statusOf(p);
    return ((s === 'published' || s === 'posted') && p && p.publishedAt) ? p.publishedAt : null;
  }

  // Author display name. Brand authors live in TENANT_CONFIG.brand.authors keyed
  // by handle; uid-keyed authors are enriched from admin/users/{uid}/profile into
  // V2.authors (see enrichAuthors). Falls back to the raw key (or 'Author').
  function authorMap() {
    var m = {};
    try {
      var ta = window.TENANT_CONFIG && TENANT_CONFIG.brand && TENANT_CONFIG.brand.authors;
      if (ta && typeof ta === 'object') Object.keys(ta).forEach(function (k) { m[k] = ta[k]; });
    } catch (e) {}
    Object.keys(V2.authors).forEach(function (k) { m[k] = V2.authors[k]; });
    return m;
  }
  function authorOf(p) {
    var key = (p && p.author) || '';
    var a = authorMap()[key];
    return a || { name: key || 'Author', photoUrl: '', bio: '' };
  }
  function authorName(p) {
    var a = authorOf(p);
    return a.name || (p && p.author) || 'Author';
  }

  // Cover image URL resolved from featuredImageId through the shared image
  // library (mirrors blog.js renderBlogEditor featured-image logic). No cover-URL
  // field lives on the doc itself.
  function coverUrl(p) {
    if (!p || !p.featuredImageId) return '';
    var lib = window.imageLibrary || {};
    var img = lib[p.featuredImageId];
    if (!img) return '';
    return img.url || img.thumbnailUrl || '';
  }

  // Plain-text body preview: the body is HTML, so strip tags + decode a few
  // entities + collapse whitespace, then truncate. We NEVER inject raw post HTML
  // into the slide-out — esc() handles the final escaping at render time.
  function bodyPlainText(p) {
    var body = (p && p.body) || '';
    if (!body) return '';
    var txt = String(body)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<\/(p|div|h[1-6]|li|br|blockquote|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return txt;
  }
  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? (s.slice(0, n).replace(/\s+\S*$/, '') + '…') : s;
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('blog-v2', {
    label: 'Post', labelPlural: 'Blog Posts', size: 'md',
    route: 'blog-v2',
    recordId: function (p) { return p._key || p.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real title string.
      { name: 'title', label: 'Title', type: 'text', list: true, readOnly: true, group: 'Post', get: postTitle },
      { name: 'author', label: 'Author', type: 'text', list: true, readOnly: true, sortable: false, get: function (p) { return authorName(p); } },
      { name: 'tags', label: 'Tags', type: 'tags', list: true, readOnly: true, sortable: false, get: tagsOf },
      { name: 'updatedAt', label: 'Updated', type: 'date', list: true, readOnly: true, get: updatedAt },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['draft', 'complete', 'scheduled', 'posted', 'published'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    // Cache-miss fallback keeps cross-record drills (campaign references,
    // calendar) working cold (Wave 3).
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return Promise.resolve(MastDB.get('blog/posts/' + id)).then(function (p) {
        return p ? Object.assign({ _key: id }, p) : null;
      });
    },
    detail: {
      render: function (UI, p) {
        var cover = coverUrl(p);
        var tags = tagsOf(p);
        var pid = p._key || p.id;

        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(p)] || 'Draft', STATUS_TONE[statusOf(p)] || 'neutral'), hero: true },
          { k: 'Published', v: publishedAt(p) ? N.date(publishedAt(p)) : '—' },
          { k: 'Author', v: esc(authorName(p)) },
          { k: 'Tags', v: tags.length ? N.count(tags.length) : '—' }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }], 'ov');

        // Cover image — the full-bleed read view, composed by hand inside a card
        // (the sanctioned read-on-page image pattern, mirroring stories-v2). The
        // tile's imageThumb above is the lightbox affordance.
        var coverBlock = cover
          ? '<div style="background:var(--surface-dark,rgba(127,127,127,.12));border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;min-height:120px;">' +
              '<img src="' + esc(cover) + '" alt="' + esc(postTitle(p)) + ' cover" style="max-width:100%;max-height:280px;object-fit:contain;display:block;"></div>'
          : '<div style="background:var(--surface-dark,rgba(127,127,127,.12));border-radius:8px;padding:24px;text-align:center;color:var(--warm-gray);font-size:0.9rem;">No featured image set.</div>';

        var vitals = UI.kv([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(p)] || 'Draft', STATUS_TONE[statusOf(p)] || 'neutral') },
          { k: 'Author', v: esc(authorName(p)) },
          { k: 'On website', v: p.publishedToWebsite ? 'Yes' : 'No' },
          { k: 'Tags', v: tags.length ? tags.map(function (t) { return esc(t); }).join(', ') : '—' },
          { k: 'Published', v: publishedAt(p) ? N.date(publishedAt(p)) : '—' },
          { k: 'Created', v: p.createdAt ? N.date(p.createdAt) : '—' },
          { k: 'Updated', v: updatedAt(p) ? N.date(updatedAt(p)) : '—' }
        ]);

        var ex = (p && p.excerpt) ? String(p.excerpt) : '';
        var excerptBody = ex
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(ex) + '</div>'
          : '<span class="mu-sub">No excerpt set.</span>';

        // Plain-text body preview (tags stripped, truncated). Never raw HTML.
        var preview = truncate(bodyPlainText(p), 600);
        var bodyBody = preview
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.6;white-space:pre-wrap;">' + esc(preview) + '</div>'
          : '<span class="mu-sub">No body content yet.</span>';

        // Rich-text authoring (the Builder/canvas editor, AI polish, scheduling,
        // website/Substack publish) stays on legacy #blog. Use navigateToClassic
        // so the V2 route remap doesn't loop us back to this twin.
        var manage = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary" onclick="BlogV2.classic()">Write / publish in classic view &rarr;</button>' +
          (statusOf(p) === 'draft' && (typeof window.can !== 'function' || window.can('blog', 'delete'))
            ? '<button class="btn btn-secondary" style="color:var(--text-danger);" onclick="BlogV2.removeDraft(\'' + esc(pid) + '\')">Delete draft</button>' : '') +
          '</div><div id="blogCampChip_' + esc(pid) + '"></div>';
        // Part-of-campaign chip — single-sourced renderer in campaigns.js (Wave 3).
        setTimeout(function () {
          if (window.MastAdmin && MastAdmin.loadModule) {
            MastAdmin.loadModule('campaigns').then(function () {
              if (window.CampaignsBridge && CampaignsBridge.renderChipInto) CampaignsBridge.renderChipInto('blogCampChip_' + pid, pid);
            }).catch(function () {});
          }
        }, 0);

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Cover', coverBlock) +
            UI.card('Post', vitals) +
            UI.card('Excerpt', excerptBody) +
            UI.card('Body preview', bodyBody + manage) +
          '</div>';
      },
      // CREATE: a native composer (title / status / tags / excerpt / body) so the
      // twin no longer punts new posts to the classic Builder. EDIT stays LIGHT
      // (meta only — title / excerpt / tags); the body, slug/SEO, scheduling and
      // publish side effects stay on the Builder (single canvas for everything
      // that can desync). The body field is plain text — BlogBridge.create
      // escapes + wraps it (blogPlainToHtml) so it renders safely; rich
      // formatting + inline images are added later in the Builder.
      editRender: function (p, mode) {
        p = p || {};
        function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        if (mode === 'create') {
          var statusOpts = [['draft', 'Draft'], ['complete', 'Complete']].map(function (o) {
            return '<option value="' + o[0] + '">' + o[1] + '</option>';
          }).join('');
          return '<div class="mu-editbar"><span class="mu-editpill">NEW</span>New post — rich formatting, images &amp; publishing live in the Builder</div>' +
            fg('Title *', '<input class="form-input" id="blogV2Title" value="" style="width:100%;" placeholder="Post title">') +
            fg('Status', '<select class="form-input" id="blogV2Status" style="width:100%;">' + statusOpts + '</select>') +
            fg('Tags (comma-separated)', '<input class="form-input" id="blogV2Tags" value="" style="width:100%;" placeholder="news, behind-the-scenes">') +
            fg('Excerpt', '<textarea class="form-input" id="blogV2Excerpt" rows="2" style="width:100%;resize:vertical;" placeholder="Short summary for listings"></textarea>') +
            fg('Body', '<textarea class="form-input" id="blogV2Body" rows="8" style="width:100%;resize:vertical;" placeholder="Write your post… rich formatting and images are added in the Builder."></textarea>');
        }
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Edit post details (body lives in the Builder)</div>' +
          fg('Title *', '<input class="form-input" id="blogV2Title" value="' + esc(postTitle(p) === '(untitled)' ? '' : postTitle(p)) + '" style="width:100%;">') +
          fg('Excerpt', '<textarea class="form-input" id="blogV2Excerpt" rows="3" style="width:100%;resize:vertical;">' + esc(p.excerpt || '') + '</textarea>') +
          fg('Tags (comma-separated)', '<input class="form-input" id="blogV2Tags" value="' + esc(tagsOf(p).join(', ')) + '" style="width:100%;">');
      }
    },
    onSave: function (rec, mode) {
      if (typeof window.can === 'function' && !window.can('blog', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to edit posts.', true); return false;
      }
      if (!window.BlogBridge) { if (window.showToast) showToast('Blog engine still loading — try again', true); return false; }
      function val(id) { return ((document.getElementById(id) || {}).value || ''); }
      var title = val('blogV2Title').trim();
      if (!title) { if (window.showToast) showToast('Title is required.', true); return false; }
      var tags = val('blogV2Tags').split(',').map(function (t) { return t.trim(); }).filter(Boolean);

      if (mode === 'create') {
        if (!window.BlogBridge.create) { if (window.showToast) showToast('Blog engine still loading — try again', true); return false; }
        var data = {
          title: title,
          status: val('blogV2Status') === 'complete' ? 'complete' : 'draft',
          tags: tags,
          excerpt: val('blogV2Excerpt'),
          body: val('blogV2Body')
        };
        return Promise.resolve(window.BlogBridge.create(data)).then(function (id) {
          if (window.writeAudit) writeAudit('create', 'blog-post', id);
          if (window.showToast) showToast('Post created.');
          reloadSoon(); return true;
        }).catch(function (e) { console.error('[blog-v2] create', e); if (window.showToast) showToast('Error creating post.', true); return false; });
      }

      var patch = {
        title: title,
        excerpt: val('blogV2Excerpt'),
        tags: tags
      };
      var id = rec._key || rec.id;
      return Promise.resolve(window.BlogBridge.updateMeta(id, patch)).then(function (updates) {
        Object.assign(V2.byId[id] || rec, updates || patch);
        if (window.showToast) showToast('Post details saved.');
        render(); return true;
      }).catch(function (e) { console.error('[blog-v2] save', e); if (window.showToast) showToast('Error saving post.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, authors: {}, sortKey: 'updatedAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Ensure legacy blog.js is loaded so window.BlogBridge (the delegated
    // light-edit/delete path) exists — mirrors campaigns-v2 (Wave 3).
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('blog'); } catch (e) {} }
    // One-shot bounded read (orderByChild + limitToLast, mirroring blog.js).
    var ref = MastDB.blog.posts.ref();
    Promise.resolve(ref.orderByChild('createdAt').limitToLast(100).once('value'))
      .then(function (snap) {
        var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
        var out = [];
        Object.keys(val || {}).forEach(function (k) {
          var p = val[k];
          if (p && typeof p === 'object') { p = Object.assign({ _key: k }, p); p.status = p.status || 'draft'; out.push(p); }
        });
        V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
        V2.loaded = true; render();
        enrichAuthors();
      })
      .catch(function (e) { console.error('[blog-v2] load', e); V2.loaded = true; render(); });
  }
  function reloadSoon() { setTimeout(load, 250); }   // let the legacy write settle, then refresh

  // Resolve uid-keyed authors to real names/photos from admin/users/{uid}/profile
  // (mirrors blog.js enrichBlogAuthorsFromPosts). Brand-handle authors already
  // resolve via TENANT_CONFIG.brand.authors. Re-render once when any arrive.
  function enrichAuthors() {
    if (typeof window.getUserProfile !== 'function') return;
    var brand = {};
    try { brand = (window.TENANT_CONFIG && TENANT_CONFIG.brand && TENANT_CONFIG.brand.authors) || {}; } catch (e) {}
    var seen = {}, pending = [];
    V2.rows.forEach(function (p) {
      var key = p && p.author ? String(p.author) : '';
      if (!key || seen[key] || brand[key] || V2.authors[key]) return;
      if (!/^[A-Za-z0-9]{20,}$/.test(key)) return;   // uid-like keys only
      seen[key] = true;
      pending.push(window.getUserProfile(key).then(function (profile) {
        if (profile) V2.authors[key] = { name: profile.displayName || key, photoUrl: profile.photoUrl || '', bio: profile.bio || '' };
      }).catch(function () {}));
    });
    if (pending.length) Promise.all(pending).then(function () { render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (p) { return statusOf(p) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (p) {
        return postTitle(p).toLowerCase().indexOf(q) >= 0 ||
               authorName(p).toLowerCase().indexOf(q) >= 0 ||
               tagsOf(p).join(' ').toLowerCase().indexOf(q) >= 0 ||
               String(p.excerpt || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('blog-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('blogV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'blogV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['draft', 'Draft'], ['complete', 'Complete'], ['scheduled', 'Scheduled'], ['published', 'Published']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="BlogV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Blog Posts',
        count: N.count(V2.rows.length) + (V2.rows.length === 1 ? ' post' : ' posts'),
        actionsHtml: '<button class="btn btn-primary" onclick="BlogV2.newPost()">+ New Post</button> ' +
          '<button class="btn btn-secondary" onclick="BlogV2.exportCsv()">&darr; Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search title, author, tags or excerpt…" value="' + esc(V2.q) +
        '" oninput="BlogV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('blog-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'BlogV2.sort', onRowClickFnName: 'BlogV2.open',
        empty: { title: 'No blog posts', message: V2.loaded ? 'Click “+ New Post” to write your first post.' : 'Loading…' }
      });
  }

  window.BlogV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'updatedAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('blog-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('blog-v2', rec, 'read');
      });
    },
    // Rich-text authoring → classic Blog view. Use navigateToClassic so the V2
    // route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('blog');
      else if (typeof navigateTo === 'function') navigateTo('blog');
    },
    // Create a post NATIVELY (title / status / tags / excerpt / body) — the
    // write is delegated to BlogBridge.create. Rich formatting, inline images
    // and publishing are done afterward in the Builder.
    newPost: function () {
      if (typeof window.can === 'function' && !window.can('blog', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to create posts.', true); return;
      }
      // Ensure legacy blog.js is loaded so window.BlogBridge.create exists at save.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('blog'); } catch (e) {} }
      MastEntity.openRecord('blog-v2', {}, 'create');
    },
    // Draft deletion (Wave 3): published/complete posts never delete from the
    // twin — unpublish lives with the Builder's side effects.
    removeDraft: function (id) {
      if (typeof window.can === 'function' && !window.can('blog', 'delete')) {
        if (window.showToast) showToast('You don\'t have permission to delete posts.', true); return;
      }
      var p = V2.byId[id];
      if (p && statusOf(p) !== 'draft') { if (window.showToast) showToast('Only drafts can be deleted here.', true); return; }
      if (!window.BlogBridge) { if (window.showToast) showToast('Blog engine still loading — try again', true); return; }
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Delete this draft post?', { title: 'Delete draft?', confirmLabel: 'Delete', dangerous: true })
        : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(window.BlogBridge.removeDraft(id)).then(function () {
          if (window.writeAudit) writeAudit('delete', 'blog-post-draft', id);
          if (window.showToast) showToast('Draft deleted.');
          try { U.slideOut.requestCloseForce(); } catch (e) {}
          load();
        });
      }).catch(function (e) { console.error('[blog-v2] removeDraft', e); if (window.showToast) showToast('Delete failed.', true); });
    },
    exportCsv: function () { return MastEntity.exportRows('blog-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('blog-v2', {
    routes: { 'blog-v2': { tab: 'blogV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
