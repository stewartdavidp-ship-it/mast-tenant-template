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
 * Everything is NATIVE here — there is NO classic escape hatch (V1-editor-
 * elimination program). CREATE composes a basic post (custom detail.editRender +
 * onSave). The FULL Builder lives in the blog-editor-v2 drilled composer (opened
 * via BlogV2.editBody): rich body (contenteditable + execCommand toolbar) + inline
 * images + coupons, author + author photo, featured image, excerpt, tags (+ AI
 * suggest), SEO & schema, AI polish, status lifecycle, schedule, and publish-to-
 * website + unpublish. EVERY write DELEGATES to window.BlogBridge (exposed in
 * blog.js); the rich body is sanitized via the canonical MastUI.sanitizeHtml
 * before it lands (the storefront injects post.body RAW), and publish-to-website +
 * scheduled-publish stay single-sourced in blog.js (BlogBridge.publishToWebsite →
 * the shared _blogPublishPostToWebsite core, byte-identical to the Builder's
 * output). The read detail's body PREVIEW strips tags + esc()s everything (never
 * injects raw post HTML). Flag-gated (?ui=1) at #blog-v2.
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

        // The full Builder (rich body, inline images, AI polish, author/photo, SEO,
        // scheduling + website publish) is now NATIVE — BlogV2.editBody drills into
        // the native blog-editor-v2 composer. No classic escape hatch.
        var manage = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
          ((typeof window.can !== 'function' || window.can('blog', 'edit'))
            ? '<button class="btn btn-primary" onclick="BlogV2.editBody(\'' + esc(pid) + '\')">✏️ Edit post</button>' : '') +
          (statusOf(p) === 'draft' && (typeof window.can !== 'function' || window.can('blog', 'delete'))
            ? '<button class="btn btn-secondary" style="color:var(--text-danger);" onclick="BlogV2.removeDraft(\'' + esc(pid) + '\')">Delete draft</button>' : '') +
          '</div><div id="blogCampChip_' + esc(pid) + '"></div>';
        // Part-of-campaign chip — single-sourced renderer in campaigns.js (Wave 3).
        setTimeout(function () {
          if (window.MastAdmin && MastAdmin.loadModule) {
            MastAdmin.loadModule('campaigns-v2').then(function () {
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
          '<button class="btn btn-secondary" onclick="BlogV2.openIdeas()">💡 Ideas</button> ' +
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

  // ── native rich-body editor (blog-editor-v2 — route:null drilled SO) ──
  // The native Builder (V1-editor-elimination program). Opened via
  // MastEntity.drill('blog-editor-v2', postId) from the post read detail. This is
  // the FULL replacement for the legacy #blog Builder: title / author + author
  // photo / featured image / excerpt / tags (+ AI suggest) / SEO & schema / rich
  // body (contenteditable + execCommand toolbar) + inline images + coupons / AI
  // polish / status lifecycle / schedule / publish-to-website + unpublish — all
  // NATIVE, no classic escape hatch. EVERY write delegates to window.BlogBridge:
  // the body is sanitized via the canonical MastUI.sanitizeHtml before it lands
  // (the storefront injects post.body RAW). Formatting is emitted as TAGS
  // (<b>/<i>/<u>/<h2>…) via execCommand styleWithCSS=false, because the strict
  // sanitizer allowlist drops <font> + inline style/class. publish-to-website +
  // scheduled-publish stay single-sourced in blog.js (BlogBridge.publishToWebsite
  // → the shared _blogPublishPostToWebsite core, identical to the Builder).
  var BED = null, _bedTimer = null;
  var BED_EMOJI = ['😀','😊','🥰','😍','🎉','❤️','🔥','✨','⭐','💡','🙏','👏','👍','💪','🎨','📷','🌿','☀️','🌙','💎','🏷️','💌','🍀','🌸'];

  function loadEditor(id) {
    return Promise.resolve(MastDB.get('blog/posts/' + id)).then(function (p) {
      var pv = (p && typeof p.val === 'function') ? p.val() : p;
      if (!pv) return null;
      pv = Object.assign({ _key: id }, pv);
      // inlineImages can come back as a keyed object from RTDB — normalize to array.
      pv.inlineImages = Array.isArray(pv.inlineImages) ? pv.inlineImages
        : (pv.inlineImages ? Object.keys(pv.inlineImages).map(function (k) { return pv.inlineImages[k]; }) : []);
      BED = { id: id, post: pv };
      return { _key: id, _title: ((pv.title || 'Untitled post') + ' · Edit') };
    });
  }
  function bedToolbar() {
    function b(cmd, label, title) {
      return '<button type="button" class="btn btn-small btn-secondary" onmousedown="event.preventDefault();BlogV2.fmt(\'' + cmd + '\')" title="' + title + '" style="min-width:30px;">' + label + '</button>';
    }
    function blk(tag, label, title) {
      return '<button type="button" class="btn btn-small btn-secondary" onmousedown="event.preventDefault();BlogV2.fmtBlock(\'' + tag + '\')" title="' + title + '" style="min-width:30px;">' + label + '</button>';
    }
    var sep = '<span style="width:1px;height:18px;background:var(--border);margin:0 2px;"></span>';
    return '<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:8px;padding:6px;border:1px solid var(--border);border-radius:8px;">' +
      b('bold', '<b>B</b>', 'Bold') + b('italic', '<i>I</i>', 'Italic') + b('underline', '<u>U</u>', 'Underline') + sep +
      blk('h2', 'H2', 'Heading 2') + blk('h3', 'H3', 'Heading 3') + blk('blockquote', '“', 'Quote') +
      b('insertUnorderedList', '•', 'Bullet list') + b('insertOrderedList', '1.', 'Numbered list') +
      '<button type="button" class="btn btn-small btn-secondary" onmousedown="event.preventDefault();BlogV2.insertLink()" title="Insert link" style="min-width:30px;">🔗</button>' +
      b('insertHorizontalRule', '―', 'Divider') + sep +
      '<button type="button" class="btn btn-small btn-secondary" onmousedown="event.preventDefault();BlogV2.insertImage()" title="Insert image" style="min-width:30px;">📷</button>' +
      '<button type="button" class="btn btn-small btn-secondary" onmousedown="event.preventDefault();BlogV2.insertCoupon()" title="Insert coupon" style="min-width:30px;">🏷️</button>' +
      '<span style="position:relative;display:inline-block;">' +
        '<button type="button" class="btn btn-small btn-secondary" onmousedown="event.preventDefault();BlogV2.toggleEmoji()" title="Emoji" style="min-width:30px;">😊</button>' +
        '<div id="blogV2Emoji" style="display:none;position:absolute;z-index:5;top:100%;left:0;margin-top:4px;background:var(--card-bg,var(--surface-card,var(--cream)));border:1px solid var(--border);border-radius:8px;padding:6px;width:230px;box-shadow:0 4px 16px rgba(0,0,0,0.2);"></div>' +
      '</span>' +
      '</div>';
  }

  function editorBody() {
    var p = BED.post;
    var loaded = (window.BlogBridge && BlogBridge.loadBodyHtml) ? BlogBridge.loadBodyHtml(p.body || '', p.inlineImages || []) : esc(bodyPlainText(p));
    return bedToolbar() +
      '<div id="blogV2Body" contenteditable="true" data-placeholder="Write your post…" ' +
        'oninput="BlogV2.bodyInput()" onblur="BlogV2.bodyFlush()" onpaste="BlogV2.bodyPaste(event)" ' +
        'style="min-height:280px;border:1px solid var(--border);border-radius:8px;padding:14px;font-size:0.9rem;line-height:1.6;color:var(--text-primary);outline:none;overflow-wrap:break-word;">' + loaded + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:8px;">' +
        '<span class="mu-sub" id="blogV2WordCount"></span>' +
        '<span class="mu-sub" id="blogV2SaveStatus"></span>' +
      '</div>';
  }

  function editorImages() {
    var imgs = BED.post.inlineImages || [];
    if (!imgs.length) return '';
    var lib = window.imageLibrary || {};
    var cells = imgs.map(function (img, idx) {
      var d = lib[img.imageId];
      var thumb = d ? (d.thumbnailUrl || d.url) : '';
      var first = idx === 0, last = idx === imgs.length - 1;
      var move = imgs.length > 1
        ? '<div style="display:flex;justify-content:center;gap:4px;margin-top:2px;">' +
            '<button type="button" class="btn btn-small btn-secondary" style="padding:0 6px;"' + (first ? ' disabled' : '') + ' onclick="BlogV2.moveImage(' + idx + ',-1)" title="Move up/left">◀</button>' +
            '<button type="button" class="btn btn-small btn-secondary" style="padding:0 6px;"' + (last ? ' disabled' : '') + ' onclick="BlogV2.moveImage(' + idx + ',1)" title="Move down/right">▶</button>' +
          '</div>'
        : '';
      return '<div style="text-align:center;">' +
        '<div style="position:relative;display:inline-block;">' +
          (thumb
            ? '<img src="' + esc(thumb) + '" alt="" style="width:96px;height:68px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer;" onclick="BlogV2.editCaption(' + idx + ')" title="Edit caption">'
            : '<div style="width:96px;height:68px;border:1px dashed var(--border);border-radius:6px;"></div>') +
          '<button type="button" onclick="BlogV2.removeImage(' + idx + ')" title="Remove image" ' +
            'style="position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:1px solid var(--border);background:var(--cream,var(--card-bg));color:var(--text-danger);cursor:pointer;line-height:1;font-size:0.85rem;">×</button>' +
        '</div>' +
        '<div class="mu-sub" style="margin-top:2px;">Image ' + (idx + 1) + (img.caption ? ' 💬' : '') + '</div>' +
        move +
        '</div>';
    }).join('');
    return U.card('Inline images', '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + cells + '</div>');
  }

  function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }

  function editorDetails() {
    var p = BED.post;
    var authors = (window.BlogBridge && BlogBridge.authors) ? BlogBridge.authors() : {};
    var akey = p.author || '';
    if (akey && !authors[akey]) authors[akey] = { name: authorName(p), photoUrl: '', bio: '' };
    var aopts = Object.keys(authors).map(function (k) {
      return '<option value="' + esc(k) + '"' + (akey === k ? ' selected' : '') + '>' + esc(authors[k].name || k) + '</option>';
    }).join('') || ('<option value="' + esc(akey) + '" selected>' + esc(authorName(p)) + '</option>');
    var aphoto = (authors[akey] && authors[akey].photoUrl) || '';
    var feat = coverUrl(p);
    var ex = String(p.excerpt || '');

    var titleRow = fg('Title', '<input class="form-input" id="blogV2EdTitle" value="' + esc(p.title || '') + '" style="width:100%;" placeholder="Post title" onchange="BlogV2.setMeta(\'title\', this.value)">');

    var authorRow = '<div class="form-group"><label class="form-label">Author</label>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
        '<span style="position:relative;display:inline-block;cursor:pointer;" onclick="BlogV2.changeAuthorPhoto()" title="Change author photo">' +
          (aphoto
            ? '<img src="' + esc(aphoto) + '" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:1px solid var(--border);">'
            : '<span style="width:40px;height:40px;border-radius:50%;border:1px dashed var(--border);display:inline-flex;align-items:center;justify-content:center;color:var(--warm-gray);">👤</span>') +
          '<span style="position:absolute;bottom:-2px;right:-2px;background:var(--teal);color:var(--cream);border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;font-size:0.72rem;">✎</span>' +
        '</span>' +
        '<select class="form-input" style="flex:1;min-width:160px;" onchange="BlogV2.setAuthor(this.value)">' + aopts + '</select>' +
      '</div></div>';

    var featRow = '<div class="form-group"><label class="form-label">Featured image</label>' +
      (feat
        ? '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
            '<img src="' + esc(feat) + '" alt="" style="width:120px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border);">' +
            '<div style="display:flex;gap:6px;">' +
              '<button type="button" class="btn btn-small btn-secondary" onclick="BlogV2.setFeatured()">Change</button>' +
              '<button type="button" class="btn btn-small btn-secondary" style="color:var(--text-danger);" onclick="BlogV2.removeFeatured()">Remove</button>' +
            '</div></div>'
        : '<button type="button" class="btn btn-secondary" onclick="BlogV2.setFeatured()">🖼️ Set featured image</button>' +
          '<div class="mu-sub" style="margin-top:4px;">Used for social cards and blog listings.</div>') +
      '</div>';

    var excerptRow = '<div class="form-group"><label class="form-label">Excerpt</label>' +
      '<textarea class="form-input" id="blogV2EdExcerpt" rows="2" maxlength="300" style="width:100%;resize:vertical;" placeholder="Short summary for social sharing and listings" oninput="BlogV2._excerptCount(this.value)" onchange="BlogV2.setMeta(\'excerpt\', this.value)">' + esc(ex) + '</textarea>' +
      '<div class="mu-sub" style="text-align:right;" id="blogV2ExcerptCount">' + ex.length + '/300</div></div>';

    var tagsRow = '<div class="form-group"><label class="form-label">Tags (comma-separated)</label>' +
      '<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;">' +
        '<input class="form-input" id="blogV2EdTags" value="' + esc((p.tags || []).join(', ')) + '" style="flex:1;min-width:200px;" placeholder="news, behind-the-scenes" onchange="BlogV2.setMeta(\'tags\', this.value)">' +
        '<button type="button" class="btn btn-small btn-secondary" onclick="BlogV2.suggestTags()" title="AI-suggested tags from your content">💡 Suggest</button>' +
      '</div></div>';

    return U.card('Details', titleRow + authorRow + featRow + excerptRow + tagsRow);
  }

  function editorSeo() {
    var p = BED.post;
    var schemaType = p.schemaType || 'BlogPosting';
    var body =
      fg('URL slug', '<input class="form-input" style="width:100%;font-family:monospace;font-size:0.85rem;" value="' + esc(p.slug || '') + '" placeholder="post-url-slug" onchange="BlogV2.setSeo(\'slug\', this.value)">') +
      fg('Meta description', '<textarea class="form-input" rows="2" maxlength="200" style="width:100%;resize:vertical;" placeholder="Short summary for search engines (~160 chars)" onchange="BlogV2.setSeo(\'metaDescription\', this.value)">' + esc(p.metaDescription || '') + '</textarea>') +
      fg('Canonical URL (optional)', '<input class="form-input" style="width:100%;font-family:monospace;font-size:0.85rem;" value="' + esc(p.canonical || '') + '" placeholder="https://example.com/source" onchange="BlogV2.setSeo(\'canonical\', this.value)">') +
      fg('OG image URL (optional)', '<input class="form-input" style="width:100%;font-family:monospace;font-size:0.85rem;" value="' + esc(p.ogImage || '') + '" placeholder="Defaults to featured image" onchange="BlogV2.setSeo(\'ogImage\', this.value)">') +
      '<div class="form-group"><label class="form-label">Schema.org type</label><div style="display:flex;gap:16px;">' +
        '<label style="font-size:0.85rem;cursor:pointer;"><input type="radio" name="blogV2Schema" value="BlogPosting"' + (schemaType === 'BlogPosting' ? ' checked' : '') + ' onchange="BlogV2.setSeo(\'schemaType\', this.value)"> BlogPosting</label>' +
        '<label style="font-size:0.85rem;cursor:pointer;"><input type="radio" name="blogV2Schema" value="Article"' + (schemaType === 'Article' ? ' checked' : '') + ' onchange="BlogV2.setSeo(\'schemaType\', this.value)"> Article</label>' +
      '</div></div>';
    return U.card('SEO & schema', body);
  }

  function editorPublish() {
    var p = BED.post;
    var st = statusOf(p);
    var badge = U.badge(STATUS_LABEL[st] || 'Draft', STATUS_TONE[st] || 'neutral');
    var onWeb = p.publishedToWebsite;
    var btns = '';
    if (st === 'draft') {
      btns = '<button type="button" class="btn btn-secondary" onclick="BlogV2.polish()" title="Uses tokens">✨ Polish with AI</button>' +
        '<button type="button" class="btn btn-primary" onclick="BlogV2.finishPost()">✅ Finish post</button>';
    } else if (st === 'scheduled') {
      var schedStr = p.scheduledAt ? N.date(p.scheduledAt) : '';
      btns = '<span class="mu-sub">📅 Scheduled for ' + esc(schedStr) + '</span>' +
        '<button type="button" class="btn btn-secondary" onclick="BlogV2.cancelSchedulePost()">Cancel schedule</button>' +
        '<button type="button" class="btn btn-secondary" onclick="BlogV2.backToDraft()">✏️ Back to draft</button>';
    } else {
      // complete / posted / published
      btns = '<button type="button" class="btn btn-secondary" onclick="BlogV2.backToDraft()">✏️ Back to draft</button>';
      if (onWeb) {
        btns += '<span style="display:inline-flex;align-items:center;gap:6px;">' + U.badge('🌐 Published', 'success') + '</span>' +
          '<button type="button" class="btn btn-secondary" onclick="BlogV2.unpublish()">Unpublish</button>';
      } else {
        btns += '<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
            '<input type="datetime-local" id="blogV2SchedAt" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface-dark,transparent);color:var(--text-primary);font-size:0.85rem;">' +
            '<button type="button" class="btn btn-secondary" onclick="BlogV2.schedulePost()">📅 Schedule</button>' +
          '</span>' +
          '<button type="button" class="btn btn-primary" onclick="BlogV2.publish()">📤 Publish to website</button>';
      }
    }
    var body = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
        '<span style="font-size:0.85rem;color:var(--warm-gray);">Status</span>' + badge +
        '<span class="mu-sub">· On website: ' + (onWeb ? 'Yes' : 'No') + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' + btns + '</div>';
    return U.card('Status & publishing', body);
  }

  function editorHtml(UI, r) {
    if (!BED || BED.id !== (r && r._key)) return '<p class="mu-sub">Loading…</p>';
    var hint = '<div class="mu-editbar"><span class="mu-editpill">EDIT</span>' +
      'Everything about this post — title, author, images, SEO, body &amp; publishing. Changes save automatically.</div>';
    var actions = '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding-top:8px;">' +
      '<button class="btn btn-secondary" onclick="BlogV2.preview()">👁 Preview</button>' +
      '</div>';
    setTimeout(function () { if (window.BlogV2 && BlogV2._wordCount) BlogV2._wordCount(); }, 0);
    return hint +
      editorDetails() +
      editorSeo() +
      UI.card('Body', editorBody()) +
      '<div id="blogV2ImagesHost">' + editorImages() + '</div>' +
      editorPublish() +
      actions;
  }

  MastEntity.define('blog-editor-v2', {
    label: 'Edit post', labelPlural: 'Edit post', size: 'xl', route: null,
    recordId: function (r) { return r._key; },
    fields: [{ name: '_title', label: 'Post', type: 'text', list: true, group: 'Post', readOnly: true }],
    fetch: function (id) { return loadEditor(id); },
    detail: { render: function (UI, r) { return editorHtml(UI, r); } }
  });

  // ── Blog Ideas queue (marketing-v2 LOW closer) ─────────────────────
  // The legacy #blog list hosts an inline "Blog Ideas" capture queue
  // (blogAddIdea / blogDeleteIdea / blogStartFromIdea). This twin re-hosts it
  // as a focused slide-out: capture an idea, delete one, or turn one into a
  // draft post. EVERY write delegates to window.BlogBridge (listIdeas / addIdea
  // / removeIdea / ideaToDraft → single-sourced with blog.js, MastDB under
  // blog/ideas); gated on the blog edit permission. The idea text is plain text,
  // esc()'d at render time (never injected as HTML).
  var IDEAS = { rows: [], loaded: false };

  function ideasBody() {
    var input =
      '<div style="display:flex;gap:8px;margin-bottom:14px;">' +
      '<input id="blogV2IdeaInput" class="form-input" placeholder="Capture a blog idea…" ' +
        'style="flex:1;min-width:0;font-size:0.9rem;" ' +
        'onkeydown="if(event.key===\'Enter\'){event.preventDefault();BlogV2.addIdea()}">' +
      '<button class="btn btn-primary" onclick="BlogV2.addIdea()" style="white-space:nowrap;">+ Add</button>' +
      '</div>';
    var listHtml;
    if (!IDEAS.loaded) {
      listHtml = '<div style="padding:24px;text-align:center;color:var(--warm-gray);font-size:0.9rem;">Loading…</div>';
    } else if (!IDEAS.rows.length) {
      listHtml = '<div style="padding:30px 16px;text-align:center;color:var(--warm-gray);font-size:0.85rem;">' +
        'No ideas captured yet. Jot one down when inspiration strikes!</div>';
    } else {
      listHtml = IDEAS.rows.map(function (idea) {
        var when = idea.createdAt ? N.date(idea.createdAt) : '';
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border,rgba(127,127,127,.15));">' +
          '<span style="flex:1;min-width:0;font-size:0.9rem;color:var(--text-primary);">' + esc(idea.text) + '</span>' +
          '<span style="font-size:0.78rem;color:var(--warm-gray);white-space:nowrap;">' + esc(when) + '</span>' +
          '<button class="btn btn-secondary btn-small" onclick="BlogV2.ideaToDraft(\'' + esc(idea.id) + '\')" title="Turn into a draft post">✍️ Draft</button>' +
          '<button class="btn btn-secondary btn-small" onclick="BlogV2.removeIdea(\'' + esc(idea.id) + '\')" title="Remove idea" style="color:var(--text-danger);">🗑️</button>' +
          '</div>';
      }).join('');
    }
    return U.card('Blog Ideas', input + listHtml);
  }
  function renderIdeas() {
    // Only re-render if OUR ideas slide-out is the active one.
    if (!(U.slideOut && U.slideOut._opts && U.slideOut._opts.id === 'blog-ideas')) return;
    // Fast path: update the body in place (keeps the panel chrome). Fall back to
    // re-opening (render reads fresh IDEAS state each time, like setMode).
    var body = document.getElementById('mastSlideOutBody');
    if (body) body.innerHTML = ideasBody();
    else U.slideOut.open(U.slideOut._opts);
  }
  function loadIdeas() {
    if (!window.BlogBridge || !BlogBridge.listIdeas) { IDEAS.loaded = true; renderIdeas(); return; }
    Promise.resolve(BlogBridge.listIdeas()).then(function (rows) {
      IDEAS.rows = rows || []; IDEAS.loaded = true; renderIdeas();
    }).catch(function (e) { console.error('[blog-v2] loadIdeas', e); IDEAS.loaded = true; renderIdeas(); });
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
    // Create a post NATIVELY (title / status / tags / excerpt / body) — the
    // write is delegated to BlogBridge.create. Rich formatting, inline images
    // and publishing are done afterward in the Builder.
    newPost: function () {
      if (typeof window.can === 'function' && !window.can('blog', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to create posts.', true); return;
      }
      MastEntity.openRecord('blog-v2', {}, 'create');
    },
    // ── Blog Ideas queue ──
    // Open the Ideas slide-out and (re)load the queue. BlogBridge (the
    // single-sourced ideas write path) is now in-file (absorbed below).
    openIdeas: function () {
      IDEAS.loaded = false;
      U.slideOut.open({
        id: 'blog-ideas', size: 'md', mode: 'read',
        title: 'Blog Ideas',
        subtitle: 'Capture post ideas, then turn one into a draft.',
        render: function () { return ideasBody(); }
      });
      loadIdeas();
    },
    addIdea: function () {
      if (typeof window.can === 'function' && !window.can('blog', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to add ideas.', true); return;
      }
      var input = document.getElementById('blogV2IdeaInput');
      var text = input ? String(input.value || '').trim() : '';
      if (!text) return;
      if (!window.BlogBridge || !BlogBridge.addIdea) { if (window.showToast) showToast('Blog engine still loading — try again', true); return; }
      Promise.resolve(BlogBridge.addIdea(text)).then(function (idea) {
        IDEAS.rows.unshift(idea); IDEAS.loaded = true;
        if (window.writeAudit) writeAudit('create', 'blog-idea', idea.id);
        renderIdeas();
        if (window.showToast) showToast('Idea captured!');
      }).catch(function (e) { console.error('[blog-v2] addIdea', e); if (window.showToast) showToast('Could not save idea.', true); });
    },
    removeIdea: function (id) {
      if (typeof window.can === 'function' && !window.can('blog', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to remove ideas.', true); return;
      }
      if (!window.BlogBridge || !BlogBridge.removeIdea) { if (window.showToast) showToast('Blog engine still loading — try again', true); return; }
      Promise.resolve(BlogBridge.removeIdea(id)).then(function () {
        IDEAS.rows = IDEAS.rows.filter(function (i) { return i.id !== id; });
        if (window.writeAudit) writeAudit('delete', 'blog-idea', id);
        renderIdeas();
      }).catch(function (e) { console.error('[blog-v2] removeIdea', e); if (window.showToast) showToast('Could not remove idea.', true); });
    },
    // Turn an idea into a draft post (mirrors legacy blogStartFromIdea: the idea
    // text seeds the new post title). The idea is left in the queue. The new
    // draft opens in the native editor for fleshing out.
    ideaToDraft: function (id) {
      if (typeof window.can === 'function' && !window.can('blog', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to create posts.', true); return;
      }
      var idea = IDEAS.rows.filter(function (i) { return i.id === id; })[0];
      if (!idea) return;
      if (!window.BlogBridge || !BlogBridge.ideaToDraft) { if (window.showToast) showToast('Blog engine still loading — try again', true); return; }
      Promise.resolve(BlogBridge.ideaToDraft(idea.text)).then(function (postId) {
        if (window.writeAudit) writeAudit('create', 'blog-post-draft', postId);
        if (window.showToast) showToast('Draft post created from idea.');
        try { U.slideOut.requestCloseForce(); } catch (e) {}
        load();
        // Open the new draft's editor so the author can flesh it out.
        if (postId) BlogV2.editBody(postId);
      }).catch(function (e) { console.error('[blog-v2] ideaToDraft', e); if (window.showToast) showToast('Could not create draft.', true); });
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
    // ── native rich-body editor (PR-1): drilled body composer ──
    editBody: function (id) {
      if (typeof window.can === 'function' && !window.can('blog', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to edit posts.', true); return;
      }
      // BlogBridge (the sanitized write path + body helpers) is now in-file
      // (absorbed below), so the editor's inline handlers can fire immediately.
      MastEntity.drill('blog-editor-v2', id);
    },
    // Rich-text formatting via execCommand. styleWithCSS=false forces TAG output
    // (<b>/<i>/<u>) so it survives MastUI.sanitizeHtml (which strips inline style).
    fmt: function (cmd) {
      try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
      try { document.execCommand(cmd, false, null); } catch (e) {}
      BlogV2._bodyDirty();
    },
    fmtBlock: function (tag) {
      try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
      var cur = '';
      try { cur = (document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch (e) {}
      try { document.execCommand('formatBlock', false, cur === tag ? '<div>' : '<' + tag + '>'); } catch (e) {}
      BlogV2._bodyDirty();
    },
    insertLink: function () {
      BlogV2._saveBodyRange();
      var sel = window.getSelection();
      var selectedText = sel ? sel.toString() : '';
      var html = '<div class="modal-header"><h3>Insert link</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body">' +
        (selectedText ? '<div class="mu-sub" style="margin-bottom:8px;">Text: "' + esc(selectedText.substring(0, 60)) + '"</div>' : '') +
        '<input type="url" id="blogV2LinkUrl" class="form-input" placeholder="https://…" style="width:100%;"></div>' +
        '<div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="BlogV2.applyLink()">Apply</button></div>';
      openModal(html);
      setTimeout(function () { var i = document.getElementById('blogV2LinkUrl'); if (i) i.focus(); }, 80);
    },
    applyLink: function () {
      var url = ((document.getElementById('blogV2LinkUrl') || {}).value || '').trim();
      closeModal();
      if (!url) return;
      if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url)) url = 'https://' + url;
      BlogV2._restoreBodyRange();
      try { document.execCommand('createLink', false, url); } catch (e) {}
      BlogV2._bodyDirty();
    },
    bodyInput: function () { BlogV2._bodyDirty(); },
    bodyFlush: function () { clearTimeout(_bedTimer); return BlogV2._bodySave(); },
    // Defense-in-depth: sanitize clipboard HTML at paste time so a hostile
    // `<img onerror>` etc. can't fire in the admin session before the write-time
    // gate. Falls back to plain text. (Store + storefront also sanitize.)
    bodyPaste: function (ev) {
      try {
        var cd = ev.clipboardData || window.clipboardData; if (!cd) return;
        var html = cd.getData('text/html');
        var sanFn = (window.MastSanitize && MastSanitize.sanitizeHtml) ? MastSanitize.sanitizeHtml
          : ((window.MastUI && MastUI.sanitizeHtml) ? MastUI.sanitizeHtml : null);
        var clean = html
          ? (sanFn ? sanFn(html) : esc(cd.getData('text/plain') || ''))
          : esc(cd.getData('text/plain') || '').replace(/\n/g, '<br>');
        ev.preventDefault();
        document.execCommand('insertHTML', false, clean);
        BlogV2._bodyDirty();
      } catch (e) { /* let the browser handle paste if anything goes wrong */ }
    },
    _bodyDirty: function () {
      clearTimeout(_bedTimer);
      _bedTimer = setTimeout(function () { BlogV2._bodySave(); }, 600);
      BlogV2._wordCount();
    },
    _bodySave: function () {
      if (!BED || !window.BlogBridge || !BlogBridge.setBody) return Promise.resolve();
      if (typeof window.can === 'function' && !window.can('blog', 'edit')) return Promise.resolve();
      var ed = document.getElementById('blogV2Body'); if (!ed) return Promise.resolve();
      var html = ed.innerHTML || '';
      var st = document.getElementById('blogV2SaveStatus'); if (st) st.textContent = 'Saving…';
      return Promise.resolve(BlogBridge.setBody(BED.id, html)).then(function (res) {
        if (res && typeof res.body === 'string') {
          BED.post.body = res.body;
          if (V2.byId[BED.id]) V2.byId[BED.id].body = res.body;
        }
        if (st) { st.textContent = '✓ Saved'; setTimeout(function () { var s = document.getElementById('blogV2SaveStatus'); if (s) s.textContent = ''; }, 2000); }
      }).catch(function (e) { console.error('[blog-v2] bodySave', e); if (st) st.textContent = 'Save failed'; });
    },
    _wordCount: function () {
      var ed = document.getElementById('blogV2Body'); if (!ed) return;
      var el = document.getElementById('blogV2WordCount'); if (!el) return;
      var text = (ed.textContent || '').replace(/📷 Image \d+/g, '').replace(/🏷️ [^\s]+/g, '').trim();
      var words = text ? text.split(/\s+/).filter(function (w) { return w.length > 0; }).length : 0;
      el.textContent = words + ' word' + (words !== 1 ? 's' : '') + ' · ' + Math.max(1, Math.ceil(words / 225)) + ' min read';
    },
    // Save/restore the body caret across a modal/picker that steals focus.
    _saveBodyRange: function () {
      var ed = document.getElementById('blogV2Body');
      var sel = window.getSelection();
      if (ed && sel && sel.rangeCount && ed.contains(sel.anchorNode)) window._blogV2Range = sel.getRangeAt(0).cloneRange();
      else window._blogV2Range = null;
    },
    _restoreBodyRange: function () {
      var ed = document.getElementById('blogV2Body'); if (ed) ed.focus();
      if (window._blogV2Range) { var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(window._blogV2Range); window._blogV2Range = null; }
    },
    // ── inline images ──
    insertImage: function () {
      if (!BED) return;
      BlogV2._saveBodyRange();
      openModal('<div class="modal-header"><h3>Insert image</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body" style="text-align:center;padding:24px;"><p class="mu-sub" style="margin-bottom:16px;">Add an image to your post:</p>' +
        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
        '<button class="btn btn-primary" onclick="closeModal();BlogV2.imgFromLibrary()">📚 From library</button>' +
        '<button class="btn btn-primary" onclick="closeModal();BlogV2.imgUpload()">💻 From computer</button>' +
        '</div></div>');
    },
    imgFromLibrary: function () {
      if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image library unavailable', true); return; }
      openImagePicker(function (imageId) { if (imageId) BlogV2.imgCaption(imageId); });
    },
    imgUpload: function () {
      var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
      input.onchange = function () {
        if (!input.files || !input.files[0]) return;
        if (window.showToast) showToast('Uploading image…');
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var base64 = String(e.target.result).split(',')[1];
            auth.currentUser.getIdToken().then(function (token) {
              return callCF('/uploadImage', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ image: base64, tags: [], source: 'blog-upload' }) });
            }).then(function (resp) { return resp.json(); }).then(function (result) {
              if (!result.success) throw new Error(result.error || 'Upload failed');
              if (window.showToast) showToast('Image uploaded to library');
              BlogV2.imgCaption(result.imageId);
            }).catch(function (err) { if (window.showToast) showToast('Upload failed: ' + (err && err.message ? err.message : 'error'), true); });
          } catch (err) { if (window.showToast) showToast('Upload failed', true); }
        };
        reader.readAsDataURL(input.files[0]);
      };
      input.click();
    },
    imgCaption: function (imageId) {
      var lib = window.imageLibrary || {}; var d = lib[imageId];
      var thumb = d ? (d.thumbnailUrl || d.url) : '';
      var html = '<div class="modal-header"><h3>Add caption</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body" style="text-align:center;padding:18px;">' +
        (thumb ? '<img src="' + esc(thumb) + '" alt="" style="max-width:200px;max-height:200px;border-radius:8px;margin-bottom:14px;">' : '') +
        '<input type="text" id="blogV2Caption" class="form-input" placeholder="Caption (optional)…" style="width:100%;font-style:italic;"></div>' +
        '<div class="modal-footer"><button class="btn btn-secondary" onclick="BlogV2.imgFinish(\'' + esc(imageId) + '\',\'\')">Skip</button>' +
        '<button class="btn btn-primary" onclick="BlogV2.imgFinish(\'' + esc(imageId) + '\',(document.getElementById(\'blogV2Caption\')||{}).value||\'\')">Add image</button></div>';
      setTimeout(function () { openModal(html); }, 150);
    },
    imgFinish: function (imageId, caption) {
      closeModal();
      if (!BED) return;
      var imgs = BED.post.inlineImages || []; var num = imgs.length + 1;
      BlogV2._restoreBodyRange();
      var ed = document.getElementById('blogV2Body');
      if (ed) {
        ed.focus();
        var marker = '<br><span class="blog-img-marker" contenteditable="false" data-image="' + num + '">📷 Image ' + num + '</span><br>';
        try { document.execCommand('insertHTML', false, marker); } catch (e) {}
      }
      imgs.push({ markerId: 'image_' + num, imageId: imageId, caption: caption || '' });
      BED.post.inlineImages = imgs;
      BlogV2._persistImages();
    },
    editCaption: function (idx) {
      if (!BED) return;
      var imgs = BED.post.inlineImages || [];
      if (idx < 0 || idx >= imgs.length) return;
      var lib = window.imageLibrary || {}; var d = lib[imgs[idx].imageId];
      var thumb = d ? (d.thumbnailUrl || d.url) : '';
      var html = '<div class="modal-header"><h3>Edit caption — Image ' + (idx + 1) + '</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body" style="text-align:center;padding:18px;">' +
        (thumb ? '<img src="' + esc(thumb) + '" alt="" style="max-width:200px;max-height:200px;border-radius:8px;margin-bottom:14px;">' : '') +
        '<input type="text" id="blogV2Caption" class="form-input" value="' + esc(imgs[idx].caption || '') + '" placeholder="Caption…" style="width:100%;font-style:italic;"></div>' +
        '<div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="BlogV2.saveCaption(' + idx + ',(document.getElementById(\'blogV2Caption\')||{}).value||\'\')">Save</button></div>';
      openModal(html);
    },
    saveCaption: function (idx, caption) {
      closeModal();
      if (!BED) return;
      var imgs = BED.post.inlineImages || [];
      if (idx < 0 || idx >= imgs.length) return;
      imgs[idx].caption = caption || '';
      BlogV2._persistImages();
    },
    moveImage: function (idx, dir) {
      if (!BED) return;
      var imgs = BED.post.inlineImages || [];
      var j = idx + dir;
      if (idx < 0 || idx >= imgs.length || j < 0 || j >= imgs.length) return;
      var t = imgs[idx]; imgs[idx] = imgs[j]; imgs[j] = t;
      BlogV2._persistImages();
    },
    removeImage: function (idx) {
      if (!BED) return;
      var imgs = BED.post.inlineImages || [];
      if (idx < 0 || idx >= imgs.length) return;
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Remove this inline image from the post?', { title: 'Remove image?', confirmLabel: 'Remove', dangerous: true })
        : true).then(function (ok) {
        if (!ok) return;
        // Drop the marker whose NUMBER is idx+1 (order-independent, mirroring
        // legacy blogRemoveInlineImage) then renumber survivors by number, so the
        // body placeholders stay aligned with inlineImages even if the user moved
        // a marker span out of ascending document order.
        var ed = document.getElementById('blogV2Body');
        var html;
        if (ed) {
          var target = ed.querySelector('.blog-img-marker[data-image="' + (idx + 1) + '"]');
          if (target && target.parentNode) target.parentNode.removeChild(target);
          Array.prototype.slice.call(ed.querySelectorAll('.blog-img-marker')).forEach(function (m) {
            var n = parseInt(m.getAttribute('data-image'), 10);
            if (n > idx + 1) { m.setAttribute('data-image', n - 1); m.textContent = '📷 Image ' + (n - 1); }
          });
          html = ed.innerHTML || '';
        }
        imgs.splice(idx, 1);
        BED.post.inlineImages = imgs;
        BlogV2._persistImages(html);
      }).catch(function (e) { console.error('[blog-v2] removeImage', e); if (window.showToast) showToast('Error removing image', true); });
    },
    _persistImages: function (html) {
      if (!BED || !window.BlogBridge || !BlogBridge.setInlineImages) return;
      // The body marker DOM is already mutated in place (insert/remove/renumber)
      // and the array is updated, so we capture the LIVE editor and persist — then
      // refresh ONLY the inline-images strip. We deliberately do NOT re-seed the
      // contenteditable: a full re-render from the server-confirmed body would
      // discard any keystrokes typed during the in-flight write. The autosave
      // debounce owns the body, so cancel a now-redundant pending body save.
      clearTimeout(_bedTimer);
      if (typeof html !== 'string') { var ed = document.getElementById('blogV2Body'); html = ed ? (ed.innerHTML || '') : undefined; }
      Promise.resolve(BlogBridge.setInlineImages(BED.id, BED.post.inlineImages || [], html)).then(function (res) {
        if (res && typeof res.body === 'string') BED.post.body = res.body;
        if (V2.byId[BED.id]) { V2.byId[BED.id].inlineImages = BED.post.inlineImages; if (BED.post.body != null) V2.byId[BED.id].body = BED.post.body; }
        BlogV2._refreshImages();
      }).catch(function (e) { console.error('[blog-v2] persistImages', e); if (window.showToast) showToast('Error saving image', true); });
    },
    // Re-render only the inline-images management strip (not the body) so an image
    // op never destroys the live contenteditable / cursor / unsaved typing.
    _refreshImages: function () {
      var host = document.getElementById('blogV2ImagesHost');
      if (host) host.innerHTML = editorImages();
    },
    // ── coupon embed ──
    insertCoupon: function () {
      if (!BED) return;
      BlogV2._saveBodyRange();
      var all = window.coupons || {};
      var codes = Object.keys(all).filter(function (code) {
        return (typeof window.getCouponEffectiveStatus === 'function') ? getCouponEffectiveStatus(all[code]) === 'active' : true;
      });
      if (!codes.length) { if (window.showToast) showToast('No active coupons. Create one in Coupons first.', true); return; }
      var rows = codes.map(function (code) {
        var c = all[code]; var valStr = c.type === 'percent' ? (c.value + '% off') : ('$' + (c.value || 0).toFixed(2) + ' off');
        return '<div data-code="' + esc(code) + '" onclick="BlogV2.finishCoupon(this.dataset.code)" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;">' +
          '<span style="font-family:monospace;font-weight:600;">' + esc(code) + '</span><span style="color:var(--teal);font-weight:600;">' + esc(valStr) + '</span></div>';
      }).join('');
      openModal('<div class="modal-header"><h3>Insert coupon</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body"><p class="mu-sub" style="margin-bottom:12px;">Select a coupon to embed:</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow:auto;">' + rows + '</div></div>');
    },
    finishCoupon: function (code) {
      closeModal();
      if (!BED || !code) return;
      var all = window.coupons || {}; var c = all[code]; if (!c) return;
      var valStr = c.type === 'percent' ? (c.value + '% off') : ('$' + (c.value || 0).toFixed(2) + ' off');
      BlogV2._restoreBodyRange();
      var ed = document.getElementById('blogV2Body');
      if (ed) {
        ed.focus();
        var marker = '<br><div class="blog-coupon-marker" data-coupon-code="' + esc(code) + '" contenteditable="false" ' +
          'style="display:inline-block;padding:8px 14px;margin:4px 0;background:rgba(42,124,111,0.15);border:1px dashed var(--teal);border-radius:6px;font-size:0.9rem;color:inherit;cursor:default;">🏷️ ' + esc(code) + ' — ' + esc(valStr) + '</div><br>';
        try { document.execCommand('insertHTML', false, marker); } catch (e) {}
      }
      BlogV2.bodyFlush();
    },
    // ── emoji ──
    toggleEmoji: function () {
      var p = document.getElementById('blogV2Emoji'); if (!p) return;
      if (p.style.display === 'none') {
        BlogV2._saveBodyRange();
        p.innerHTML = BED_EMOJI.map(function (e) {
          return '<button type="button" onmousedown="event.preventDefault();BlogV2.insertEmoji(\'' + e + '\')" style="background:none;border:none;cursor:pointer;font-size:1.15rem;padding:2px;">' + e + '</button>';
        }).join('');
        p.style.display = 'block';
      } else { p.style.display = 'none'; }
    },
    insertEmoji: function (e) {
      BlogV2._restoreBodyRange();
      var ed = document.getElementById('blogV2Body'); if (ed) ed.focus();
      try { document.execCommand('insertText', false, e); } catch (err) {}
      var p = document.getElementById('blogV2Emoji'); if (p) p.style.display = 'none';
      BlogV2._bodyDirty();
    },
    // ── preview (composed storefront HTML — same renderer as publish) ──
    preview: function () {
      if (!BED) return;
      var w = window.open('', '_blank');
      Promise.resolve(BlogV2.bodyFlush()).then(function () {
        var composed = (window.BlogBridge && BlogBridge.previewBodyHtml) ? BlogBridge.previewBodyHtml(BED.post.body || '', BED.post.inlineImages || []) : '';
        var doc = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(BED.post.title || 'Preview') + '</title></head>' +
          '<body style="font-family:sans-serif;max-width:680px;margin:0 auto;padding:24px;line-height:1.7;color:rgb(34,34,34);">' +
          '<div style="font-size:1.6rem;font-weight:700;margin:0 0 14px;">' + esc(BED.post.title || 'Untitled post') + '</div>' + (composed || '<p>No body content yet.</p>') + '</body></html>';
        if (w) { w.document.write(doc); w.document.close(); } else if (window.showToast) showToast('Allow pop-ups to preview', true);
      });
    },
    // ── PR-2: full-editor handlers (details / SEO / status / publish) ──
    // Every mutating handler delegates to window.BlogBridge and re-renders the
    // editor via _reopen() — which re-seeds the body from BED.post.body. So they
    // FLUSH the body first (bodyFlush resolves after BED.post.body is current),
    // guaranteeing the re-seed never drops in-flight typing.
    _canEdit: function () {
      if (typeof window.can === 'function' && !window.can('blog', 'edit')) { if (window.showToast) showToast('You don\'t have permission to edit posts.', true); return false; }
      return true;
    },
    _reopen: function () {
      if (!BED) return;
      MastEntity.openRecord('blog-editor-v2', { _key: BED.id, _title: ((BED.post.title || 'Untitled post') + ' · Edit') }, 'read', true);
    },
    _excerptCount: function (v) { var el = document.getElementById('blogV2ExcerptCount'); if (el) el.textContent = String(v || '').length + '/300'; },
    setMeta: function (field, value) {
      if (!BED || !window.BlogBridge || !BlogV2._canEdit()) return;
      var patch = {};
      if (field === 'tags') patch.tags = String(value || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      else patch[field] = value;
      Promise.resolve(BlogBridge.updateMeta(BED.id, patch)).then(function (upd) {
        Object.assign(BED.post, upd || patch);
        if (V2.byId[BED.id]) Object.assign(V2.byId[BED.id], upd || patch);
      }).catch(function (e) { console.error('[blog-v2] setMeta', e); if (window.showToast) showToast('Error saving.', true); });
    },
    setSeo: function (field, value) {
      if (!BED || !window.BlogBridge || !BlogV2._canEdit()) return;
      var patch = {}; patch[field] = value;
      Promise.resolve(BlogBridge.updateMeta(BED.id, patch)).then(function (upd) {
        Object.assign(BED.post, upd || patch);
        if (V2.byId[BED.id]) Object.assign(V2.byId[BED.id], upd || patch);
      }).catch(function (e) { if (window.showToast) showToast((e && e.message) || 'Error saving.', true); });
    },
    setAuthor: function (key) {
      if (!BED || !window.BlogBridge || !BlogV2._canEdit()) return;
      Promise.resolve(BlogV2.bodyFlush()).then(function () { return BlogBridge.setAuthor(BED.id, key); }).then(function () {
        BED.post.author = key; if (V2.byId[BED.id]) V2.byId[BED.id].author = key; BlogV2._reopen();
      }).catch(function (e) { console.error('[blog-v2] setAuthor', e); if (window.showToast) showToast('Error.', true); });
    },
    changeAuthorPhoto: function () {
      if (!BED || !window.BlogBridge || !BlogV2._canEdit()) return;
      if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image library unavailable', true); return; }
      openImagePicker(function (imgId, url, thumb) {
        var photoUrl = url || thumb; if (!photoUrl) return;
        Promise.resolve(BlogV2.bodyFlush()).then(function () { return BlogBridge.setAuthorPhoto(BED.post.author, photoUrl); }).then(function () {
          if (window.showToast) showToast('Author photo updated.'); BlogV2._reopen();
        }).catch(function (e) { console.error('[blog-v2] authorPhoto', e); if (window.showToast) showToast('Error saving photo.', true); });
      });
    },
    setFeatured: function () {
      if (!BED || !window.BlogBridge || !BlogV2._canEdit()) return;
      if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image library unavailable', true); return; }
      openImagePicker(function (imgId) {
        if (!imgId) return;
        Promise.resolve(BlogV2.bodyFlush()).then(function () { return BlogBridge.setFeaturedImage(BED.id, imgId); }).then(function () {
          BED.post.featuredImageId = imgId; if (V2.byId[BED.id]) V2.byId[BED.id].featuredImageId = imgId; BlogV2._reopen();
        }).catch(function (e) { console.error('[blog-v2] setFeatured', e); if (window.showToast) showToast('Error.', true); });
      });
    },
    removeFeatured: function () {
      if (!BED || !window.BlogBridge || !BlogV2._canEdit()) return;
      Promise.resolve(BlogV2.bodyFlush()).then(function () { return BlogBridge.setFeaturedImage(BED.id, null); }).then(function () {
        BED.post.featuredImageId = null; if (V2.byId[BED.id]) V2.byId[BED.id].featuredImageId = null; BlogV2._reopen();
      }).catch(function (e) { console.error('[blog-v2] removeFeatured', e); if (window.showToast) showToast('Error.', true); });
    },
    suggestTags: function () {
      if (!BED || !window.BlogBridge || !BlogBridge.suggestTags || !BlogV2._canEdit()) return;
      if (window.showToast) showToast('Thinking…');
      Promise.resolve(BlogV2.bodyFlush()).then(function () { return BlogBridge.suggestTags(BED.id); }).then(function (res) {
        BED.post.tags = (res && res.tags) || BED.post.tags;
        if (V2.byId[BED.id]) V2.byId[BED.id].tags = BED.post.tags;
        if (window.showToast) showToast((res && res.suggested && res.suggested.length) ? ('Tags suggested: ' + res.suggested.join(', ')) : 'No new tags suggested');
        BlogV2._reopen();
      }).catch(function (e) { console.error('[blog-v2] suggestTags', e); if (window.showToast) showToast('Tag suggestion failed.', true); });
    },
    polish: function () {
      if (!BED || !window.BlogBridge || !BlogBridge.polishBody || !BlogV2._canEdit()) return;
      if (window.showToast) showToast('Polishing…');
      Promise.resolve(BlogV2.bodyFlush()).then(function () { return BlogBridge.polishBody(BED.id); }).then(function (aiHtml) {
        return Promise.resolve(window.mastConfirm ? mastConfirm('Replace the body with the AI-polished version?', { title: 'Use AI polish?', confirmLabel: 'Use polished' }) : true).then(function (ok) {
          if (!ok) return;
          return Promise.resolve(BlogBridge.setBody(BED.id, aiHtml, BED.post.inlineImages || [])).then(function (res) {
            if (res && typeof res.body === 'string') BED.post.body = res.body;
            if (V2.byId[BED.id]) V2.byId[BED.id].body = BED.post.body;
            if (window.showToast) showToast('Polished ✨'); BlogV2._reopen();
          });
        });
      }).catch(function (e) { console.error('[blog-v2] polish', e); if (window.showToast) showToast('AI polish unavailable — use content as-is', true); });
    },
    finishPost: function () { BlogV2._setStatus('complete', 'Post marked complete.'); },
    backToDraft: function () { BlogV2._setStatus('draft', 'Post returned to draft.'); },
    _setStatus: function (status, msg) {
      if (!BED || !window.BlogBridge || !BlogBridge.setStatus || !BlogV2._canEdit()) return;
      Promise.resolve(BlogV2.bodyFlush()).then(function () { return BlogBridge.setStatus(BED.id, status); }).then(function (s) {
        BED.post.status = s || status;
        if (V2.byId[BED.id]) V2.byId[BED.id].status = BED.post.status;
        if (window.showToast) showToast(msg); BlogV2._reopen();
      }).catch(function (e) { console.error('[blog-v2] setStatus', e); if (window.showToast) showToast('Error.', true); });
    },
    schedulePost: function () {
      if (!BED || !window.BlogBridge || !BlogBridge.schedule || !BlogV2._canEdit()) return;
      var inp = document.getElementById('blogV2SchedAt');
      var v = inp ? inp.value : '';
      if (!v) { if (window.showToast) showToast('Pick a date and time first', true); return; }
      var iso = new Date(v).toISOString();
      if (iso <= new Date().toISOString()) { if (window.showToast) showToast('Scheduled time must be in the future', true); return; }
      Promise.resolve(BlogV2.bodyFlush()).then(function () { return BlogBridge.schedule(BED.id, iso); }).then(function () {
        BED.post.status = 'scheduled'; BED.post.scheduledAt = iso;
        if (V2.byId[BED.id]) V2.byId[BED.id].status = 'scheduled';
        if (window.showToast) showToast('Post scheduled 📅'); BlogV2._reopen();
      }).catch(function (e) { console.error('[blog-v2] schedule', e); if (window.showToast) showToast('Schedule failed.', true); });
    },
    cancelSchedulePost: function () {
      if (!BED || !window.BlogBridge || !BlogBridge.cancelSchedule || !BlogV2._canEdit()) return;
      Promise.resolve(BlogV2.bodyFlush()).then(function () { return BlogBridge.cancelSchedule(BED.id); }).then(function () {
        BED.post.status = 'complete'; BED.post.scheduledAt = null;
        if (V2.byId[BED.id]) V2.byId[BED.id].status = 'complete';
        if (window.showToast) showToast('Schedule cancelled'); BlogV2._reopen();
      }).catch(function (e) { console.error('[blog-v2] cancelSchedule', e); if (window.showToast) showToast('Error.', true); });
    },
    publish: function () {
      if (!BED || !window.BlogBridge || !BlogBridge.publishToWebsite || !BlogV2._canEdit()) return;
      Promise.resolve(BlogV2.bodyFlush()).then(function () {
        return Promise.resolve(window.mastConfirm ? mastConfirm('Publish this post to your public website?', { title: 'Publish to website?', confirmLabel: 'Publish' }) : true);
      }).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(BlogBridge.publishToWebsite(BED.id)).then(function (res) {
          BED.post.publishedToWebsite = true; BED.post.publishedAt = (res && res.publishedAt) || new Date().toISOString();
          if (V2.byId[BED.id]) { V2.byId[BED.id].publishedToWebsite = true; V2.byId[BED.id].publishedAt = BED.post.publishedAt; }
          if (window.writeAudit) writeAudit('update', 'blog-post', BED.id);
          if (window.showToast) showToast('Published to website 🌐'); BlogV2._reopen();
        });
      }).catch(function (e) { console.error('[blog-v2] publish', e); if (window.showToast) showToast('Publish failed.', true); });
    },
    unpublish: function () {
      if (!BED || !window.BlogBridge || !BlogBridge.unpublish || !BlogV2._canEdit()) return;
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Remove this post from the public website?', { title: 'Unpublish?', confirmLabel: 'Unpublish', dangerous: true })
        : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(BlogV2.bodyFlush()).then(function () { return BlogBridge.unpublish(BED.id); }).then(function () {
          BED.post.publishedToWebsite = false; BED.post.publishedAt = null;
          if (V2.byId[BED.id]) V2.byId[BED.id].publishedToWebsite = false;
          if (window.showToast) showToast('Unpublished from website'); BlogV2._reopen();
        });
      }).catch(function (e) { console.error('[blog-v2] unpublish', e); if (window.showToast) showToast('Error.', true); });
    },
    exportCsv: function () { return MastEntity.exportRows('blog-v2', visibleRows(), 'all'); }
  };

  function routeSetup() { ensureTab(); render(); load(); }
  MastAdmin.registerModule('blog-v2', {
    routes: {
      'blog-v2': { tab: 'blogV2Tab', setup: routeSetup },
      // Legacy #blog route ABSORBED (T6): blog.js is deleted, so the twin owns
      // the bare route directly (no MAST_V2_ROUTE_MAP remap, no navigateToClassic
      // fallback). BlogBridge + blogOpenFromContent + the canonical body
      // sanitizer (blogCanonicalSanitize) live in the absorbed IIFE below.
      'blog': { tab: 'blogV2Tab', setup: routeSetup }
    }
  });
})();


// ============================================================================
// ABSORBED FROM blog.js (V1) — T6 retirement (absorb-first cut).
//
// blog-v2 is the sole blog authoring surface; the V1 blog editor UI is deleted.
// This self-contained, NON-flag-gated IIFE re-hosts — VERBATIM (byte-identical) —
// the write path blog-v2 single-sources through window.BlogBridge, the
// blogOpenFromContent composer hook, and their full transitive helper closure
// (incl. the canonical body sanitizer blogCanonicalSanitize wired by T7 #712,
// which MUST stay wired on the blog body). It references only shell globals
// (MastDB / auth / escapeHtml / esc / showToast / navigateTo / imageLibrary /
// TENANT_CONFIG / firebase / window.MastSanitize / MastUI / MastCouponCard /
// getUserProfile / coupons / adminUsers / invalidateUserProfileCache) plus its
// own members. The legacy in-memory caches (blogPosts / blogIdeas) are NOT
// carried over: every access to them is `typeof`-guarded and safely no-ops —
// the bridge reads/writes MastDB (the source of truth) and blog-v2 keeps its
// own V2.byId list. Not flag-gated: the bridge + composer hook must exist for
// all users regardless of the UI-redesign flag.
// ============================================================================
(function () {
  'use strict';

  var BLOG_AUTHORS = {};

  function loadBlogAuthors() {
    if (TENANT_CONFIG && TENANT_CONFIG.brand && TENANT_CONFIG.brand.authors) {
      // Brand-level fictional authors stay as-is (legacy fallback for posts
      // whose author key doesn't match a real user).
      BLOG_AUTHORS = TENANT_CONFIG.brand.authors;
    }
    // Always seed an entry for the logged-in user, keyed by uid (the
    // canonical identifier going forward). The resolveBlogAuthor() flow and
    // the post-load enrichment below pull from admin/users/{uid}/profile
    // first, so this seed is a startup-time placeholder until that data
    // arrives. Profile photo edits write to admin/users/{uid}/profile.
    try {
      if (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) {
        var u = auth.currentUser;
        if (!BLOG_AUTHORS[u.uid]) {
          BLOG_AUTHORS[u.uid] = {
            name: u.displayName || (u.email ? u.email.split('@')[0] : 'Me'),
            photoUrl: u.photoURL || '',
            bio: ''
          };
        }
      }
    } catch (e) { /* auth not ready — fall through */ }
  }

  function blogIsHtmlBody(body) {
    return body && /<[a-z][\s\S]*>/i.test(body);
  }

  function blogPlainToHtml(text) {
    if (!text) return '';
    var escaped = escapeHtml(text);
    return escaped.split(/\n\n+/).map(function(p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  // Structure-aware text extraction for AI polish (preserves headings, lists, quotes)
  function blogExtractStructuredText(html) {
    if (!html) return '';
    var div = document.createElement('div');
    div.innerHTML = html;
    var lines = [];
    function walk(node) {
      if (node.nodeType === 3) { // text node
        var t = node.textContent.trim();
        if (t) lines.push(t);
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName.toLowerCase();
      // Skip markers
      if (node.classList && (node.classList.contains('blog-img-marker') || node.classList.contains('blog-coupon-marker'))) {
        if (node.dataset.couponCode) lines.push('[Coupon:' + node.dataset.couponCode + ']');
        else if (node.dataset.image) lines.push('[Image ' + node.dataset.image + ']');
        return;
      }
      if (tag === 'h2') { lines.push('## ' + (node.textContent || '').trim()); return; }
      if (tag === 'h3') { lines.push('### ' + (node.textContent || '').trim()); return; }
      if (tag === 'blockquote') { lines.push('> ' + (node.textContent || '').trim()); return; }
      if (tag === 'ul') {
        Array.from(node.children).forEach(function(li) {
          if (li.tagName === 'LI') lines.push('- ' + (li.textContent || '').trim());
        });
        return;
      }
      if (tag === 'ol') {
        Array.from(node.children).forEach(function(li, i) {
          if (li.tagName === 'LI') lines.push((i + 1) + '. ' + (li.textContent || '').trim());
        });
        return;
      }
      if (tag === 'hr') { lines.push('---'); return; }
      if (tag === 'br') { return; }
      // Block elements get their own line
      if (/^(p|div)$/.test(tag)) {
        var childText = [];
        Array.from(node.childNodes).forEach(function(c) {
          if (c.nodeType === 3) childText.push(c.textContent);
          else if (c.nodeType === 1) {
            if (c.classList && (c.classList.contains('blog-img-marker') || c.classList.contains('blog-coupon-marker'))) {
              if (c.dataset.couponCode) childText.push('[Coupon:' + c.dataset.couponCode + ']');
              else if (c.dataset.image) childText.push('[Image ' + c.dataset.image + ']');
            } else {
              childText.push(c.textContent || '');
            }
          }
        });
        var joined = childText.join('').trim();
        if (joined) lines.push(joined);
        return;
      }
      // Recurse for other elements
      Array.from(node.childNodes).forEach(walk);
    }
    Array.from(div.childNodes).forEach(walk);
    return lines.join('\n\n');
  }

  // Convert structured text (from AI) back to HTML
  function blogStructuredTextToHtml(text) {
    if (!text) return '';
    var lines = text.split('\n');
    var html = '';
    var inUL = false, inOL = false;
    function closeLists() {
      if (inUL) { html += '</ul>'; inUL = false; }
      if (inOL) { html += '</ol>'; inOL = false; }
    }
    lines.forEach(function(line) {
      var trimmed = line.trim();
      if (!trimmed) { closeLists(); return; }
      // Headings
      if (/^### (.+)/.test(trimmed)) { closeLists(); html += '<h3>' + escapeHtml(trimmed.replace(/^### /, '')) + '</h3>'; return; }
      if (/^## (.+)/.test(trimmed)) { closeLists(); html += '<h2>' + escapeHtml(trimmed.replace(/^## /, '')) + '</h2>'; return; }
      // Blockquote
      if (/^> (.+)/.test(trimmed)) { closeLists(); html += '<blockquote><p>' + escapeHtml(trimmed.replace(/^> /, '')) + '</p></blockquote>'; return; }
      // Horizontal rule
      if (trimmed === '---') { closeLists(); html += '<hr>'; return; }
      // Unordered list
      if (/^[-*] (.+)/.test(trimmed)) {
        if (inOL) { html += '</ol>'; inOL = false; }
        if (!inUL) { html += '<ul>'; inUL = true; }
        html += '<li>' + escapeHtml(trimmed.replace(/^[-*] /, '')) + '</li>';
        return;
      }
      // Ordered list
      if (/^\d+\. (.+)/.test(trimmed)) {
        if (inUL) { html += '</ul>'; inUL = false; }
        if (!inOL) { html += '<ol>'; inOL = true; }
        html += '<li>' + escapeHtml(trimmed.replace(/^\d+\. /, '')) + '</li>';
        return;
      }
      // Markers
      if (/^\[Image \d+\]$/.test(trimmed) || /^\[Coupon:[^\]]+\]$/.test(trimmed)) { closeLists(); html += '<p>' + trimmed + '</p>'; return; }
      // Regular paragraph
      closeLists();
      html += '<p>' + escapeHtml(trimmed) + '</p>';
    });
    closeLists();
    return html;
  }

  // Canonical body sanitizer (PR 509) \u2014 the strict allowlist walker shared across
  // every V2 surface. The native V2 blog editor (BlogBridge.setBody / loadBodyHtml)
  // routes the rich body through THIS, not the weak regex blogSanitizeHtml above,
  // because the storefront injects post.body RAW. Fail-closed: with no MastUI it
  // escapes angle brackets (never emits raw markup). The allowlist drops <font>
  // and inline style/class, so the native editor emits formatting as TAGS
  // (<b>/<i>/<u>/<h2>\u2026) via execCommand styleWithCSS=false.
  function blogCanonicalSanitize(html) {
    // Prefer the standalone MastSanitize core (Track 7): same allow-list + URL
    // policy as MastUI.sanitizeHtml, plus safe-src <img> (raster/webp data URIs +
    // safe URLs) — blog bodies carry inline images. MastUI is the fallback for any
    // surface that loads before the sanitizer core; bare-escape is the last resort.
    if (window.MastSanitize && typeof MastSanitize.sanitizeHtml === 'function') return MastSanitize.sanitizeHtml(html);
    if (window.MastUI && typeof MastUI.sanitizeHtml === 'function') return MastUI.sanitizeHtml(html);
    return String(html == null ? '' : html).replace(/[<>]/g, function (c) { return c === '<' ? '&lt;' : '&gt;'; });
  }

  // Pure: stored body (placeholder form) \u2192 editor innerHTML, with image marker
  // spans + coupon marker divs injected. The supplied `sanitize` runs BEFORE the
  // markers are added (a strict sanitizer would otherwise strip their class /
  // data-* attrs). Shared by the legacy editor (weak regex sanitizer, unchanged)
  // and the native V2 editor (canonical sanitizer).
  function blogStoredBodyToEditorHtml(body, inlineImages, sanitize) {
    if (!body) return '';
    var html = body;
    if (!blogIsHtmlBody(html)) {
      html = blogPlainToHtml(html);
    }
    html = (typeof sanitize === 'function') ? sanitize(html) : html;
    (inlineImages || []).forEach(function(img, idx) {
      var marker = '[Image ' + (idx + 1) + ']';
      var span = '<span class="blog-img-marker" contenteditable="false" data-image="' + (idx + 1) + '">\ud83d\udcf7 Image ' + (idx + 1) + '</span>';
      html = html.replace(marker, span);
    });
    (inlineImages || []).forEach(function(img, idx) {
      var marker = '[IMG:' + img.markerId + ']';
      var span = '<span class="blog-img-marker" contenteditable="false" data-image="' + (idx + 1) + '">\ud83d\udcf7 Image ' + (idx + 1) + '</span>';
      html = html.replace(marker, span);
    });
    // Restore coupon markers
    html = html.replace(/\[Coupon:([^\]]+)\]/g, function(match, code) {
      var allCoupons = window.coupons || {};
      var c = allCoupons[code];
      var valStr = c ? (c.type === 'percent' ? c.value + '% off' : '$' + (c.value || 0).toFixed(2) + ' off') : 'coupon';
      return '<div class="blog-coupon-marker" data-coupon-code="' + esc(code) + '" contenteditable="false" ' +
        'style="display:inline-block;padding:8px 14px;margin:4px 0;background:rgba(42,124,111,0.15);border:1px dashed var(--teal,var(--teal));border-radius:6px;font-size:0.9rem;color:inherit;cursor:default;">' +
        '\uD83C\uDFF7\uFE0F ' + esc(code) + ' \u2014 ' + esc(valStr) + '</div>';
    });
    return html;
  }

  // Pure: editor innerHTML (marker spans / coupon divs) \u2192 stored body (placeholder
  // form). No DOM access. Shared by the legacy editor (blogSaveBodyFromEditor) and
  // the native V2 editor (BlogBridge.setBody), which sanitizes the result.
  function blogBodyHtmlToStored(html) {
    html = html || '';
    html = html.replace(/<span[^>]*class="blog-img-marker"[^>]*data-image="(\d+)"[^>]*>[^<]*<\/span>/gi, function(match, num) {
      return '[Image ' + num + ']';
    });
    // Convert coupon markers to placeholder
    html = html.replace(/<div[^>]*class="blog-coupon-marker"[^>]*data-coupon-code="([^"]+)"[^>]*>[^<]*<\/div>/gi, function(match, code) {
      return '[Coupon:' + code + ']';
    });
    html = html.replace(/<(div|p)><br\s*\/?><\/(div|p)>/gi, '<p><br></p>');
    if (html === '<br>' || html === '<div><br></div>') html = '';
    return html;
  }

  function blogRenderBodyToHtml(body, inlineImages) {
    var html = body || '';
    var isHtml = blogIsHtmlBody(html);

    if (!isHtml) {
      html = blogPlainToHtml(html);
    }

    html = html.replace(/<span[^>]*class="blog-img-marker"[^>]*data-image="(\d+)"[^>]*>[^<]*<\/span>/gi, function(match, num) {
      return '[Image ' + num + ']';
    });

    var fontSizeMap = { '1': '0.625rem', '2': '0.8125rem', '3': '1rem', '4': '1.125rem', '5': '1.5rem', '6': '2rem', '7': '3rem' };
    html = html.replace(/<font([^>]*)>([\s\S]*?)<\/font>/gi, function(match, attrs, inner) {
      var styles = [];
      var faceMatch = attrs.match(/face="([^"]*)"/i);
      var sizeMatch = attrs.match(/size="([^"]*)"/i);
      var colorMatch = attrs.match(/color="([^"]*)"/i);
      if (faceMatch) styles.push('font-family:' + faceMatch[1]);
      if (sizeMatch) styles.push('font-size:' + (fontSizeMap[sizeMatch[1]] || '1rem'));
      if (colorMatch) styles.push('color:' + colorMatch[1]);
      if (styles.length > 0) return '<span style="' + styles.join(';') + '">' + inner + '</span>';
      return inner;
    });

    (inlineImages || []).forEach(function(img, idx) {
      var imgData = imageLibrary[img.imageId];
      if (imgData) {
        var captionHtml = img.caption ? '<div class="blog-img-caption">' + escapeHtml(img.caption) + '</div>' : '';
        var imgTag = '<img src="' + (imgData.url || imgData.thumbnailUrl) + '" alt="' + escapeHtml(img.caption || '') + '" style="max-width:100%;border-radius:6px;margin:12px 0;" />' + captionHtml;
        html = html.replace('[Image ' + (idx + 1) + ']', imgTag);
      }
    });
    (inlineImages || []).forEach(function(img) {
      var imgData = imageLibrary[img.imageId];
      if (imgData) {
        var captionHtml = img.caption ? '<div class="blog-img-caption">' + escapeHtml(img.caption) + '</div>' : '';
        var imgTag = '<img src="' + (imgData.url || imgData.thumbnailUrl) + '" alt="' + escapeHtml(img.caption || '') + '" style="max-width:100%;border-radius:6px;margin:12px 0;" />' + captionHtml;
        html = html.replace('[IMG:' + img.markerId + ']', imgTag);
      }
    });

    // Render coupon embeds using shared renderer
    if (window.MastCouponCard) {
      html = html.replace(/\[Coupon:([^\]]+)\]/g, function(match, code) {
        var allCoupons = window.coupons || {};
        var c = allCoupons[code];
        if (c) {
          return window.MastCouponCard.renderHtml(
            Object.assign({}, c, { code: code, _code: code }),
            { showCta: true, source: 'blog' }
          );
        }
        return match; // leave placeholder if coupon not found
      });
    }
    return html;
  }

  function blogSlugify(str) {
    return String(str || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
  }

  // Core publish \u2014 composes the storefront HTML (blogRenderBodyToHtml), denormalizes
  // the author NAME + slug + featured image, writes blog/published, and stamps the
  // post doc. Single source for BOTH the legacy Builder (blogPublishToWebsite) and
  // the native V2 editor (BlogBridge.publishToWebsite) so the published output can
  // never drift. Operates on a post OBJECT (id-addressable) \u2014 no global state.
  async function _blogPublishPostToWebsite(post) {
    if (!post || !post.id) throw new Error('Post not found');
    var id = post.id;
    var imgs = Array.isArray(post.inlineImages) ? post.inlineImages
      : (post.inlineImages ? Object.keys(post.inlineImages).map(function (k) { return post.inlineImages[k]; }) : []);
    var bodyHtml = blogRenderBodyToHtml(post.body || '', imgs);
    // Resolve the author DISPLAY NAME — never leak a raw uid into the public doc.
    // Seed the roster (idempotent) so the current-user + brand authors resolve even
    // when publishing outside the #blog route (the V2 editor entry); for an unseeded
    // admin uid, look up the shared profile. The legacy Builder got the name only
    // because loadBlog had populated BLOG_AUTHORS — this makes it self-sufficient.
    try { loadBlogAuthors(); } catch (e) {}
    var uidish = post.author && /^[A-Za-z0-9]{20,}$/.test(post.author);
    var author = BLOG_AUTHORS[post.author];
    if (!author && uidish && typeof window.getUserProfile === 'function') {
      try {
        var prof = await window.getUserProfile(post.author);
        // A profile with no displayName must NOT fall back to the raw uid.
        if (prof) author = { name: prof.displayName || prof.email || 'Author', photoUrl: prof.photoUrl || '', bio: prof.bio || '' };
      } catch (e) {}
    }
    // Never leak a raw uid as the public author name: a uid-shaped key that didn't
    // resolve to a profile/roster entry falls back to the neutral 'Author'.
    author = author || BLOG_AUTHORS[Object.keys(BLOG_AUTHORS)[0]] || { name: (uidish ? 'Author' : (post.author || 'Author')), photoUrl: '', bio: '' };
    var slug = (post.title || 'untitled').toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);
    var publishedAt = new Date().toISOString();
    var featImgPub = post.featuredImageId && imageLibrary ? imageLibrary[post.featuredImageId] : null;
    var publishedData = {
      title: post.title || 'Untitled',
      postNumber: post.postNumber || 0,
      slug: slug,
      publishedAt: publishedAt,
      author: author.name,
      bodyHtml: bodyHtml,
      tags: post.tags || [],
      excerpt: post.excerpt || '',
      image: featImgPub ? (featImgPub.url || '') : ''
    };
    await MastDB.blog.published.ref(id).set(publishedData);
    await MastDB.blog.posts.ref(id).update({ publishedToWebsite: true, publishedAt: publishedAt, updatedAt: publishedAt });
    // Keep the legacy in-memory list coherent (the bridge path may hit a post that
    // is the same object as a blogPosts entry, or a fresh MastDB read).
    var local = (typeof blogPosts !== 'undefined' && blogPosts) ? blogPosts.find(function (p) { return p.id === id; }) : null;
    if (local) { local.publishedToWebsite = true; local.publishedAt = publishedAt; local.updatedAt = publishedAt; }
    return { publishedAt: publishedAt, slug: slug };
  }

  async function _blogUnpublishPost(id) {
    await MastDB.blog.published.ref(id).remove();
    var updatedAt = new Date().toISOString();
    await MastDB.blog.posts.ref(id).update({ publishedToWebsite: false, publishedAt: null, updatedAt: updatedAt });
    var local = (typeof blogPosts !== 'undefined' && blogPosts) ? blogPosts.find(function (p) { return p.id === id; }) : null;
    if (local) { local.publishedToWebsite = false; local.publishedAt = null; local.updatedAt = updatedAt; }
    return { updatedAt: updatedAt };
  }

  async function blogOpenFromContent(contentId) {
    try {
      var c = await MastDB.get('admin/content/' + contentId);
      if (!c) { if (typeof showToast === 'function') showToast('Content not found', true); return; }
      // Create a fresh draft seeded from this Content doc.
      var id = MastDB.newKey('blog/posts');
      var post = {
        id: id,
        title: c.title || '(untitled)',
        bodyHtml: c.body || '',
        author: '',
        excerpt: '',
        tags: [],
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceContentId: contentId
      };
      await MastDB.blog.posts.ref(id).set(post);
      if (typeof navigateTo === 'function') navigateTo('blog', { postId: id });
      else location.hash = 'blog?postId=' + id;
    } catch (e) {
      console.warn('[blog] openFromContent', e);
      if (typeof showToast === 'function') showToast('Failed to open from content', true);
    }
  }
  window.blogOpenFromContent = blogOpenFromContent;

  // BlogBridge — delegated write path for blog-v2's LIGHT edits (marketing-v2
  // Wave 3). Meta fields only (title / excerpt / tags) — the body, scheduling,
  // and publish side effects stay on the Builder, which is the single canvas
  // for everything that can desync (slug/SEO/website publish). Draft deletion
  // mirrors the Builder's delete; published posts never delete from the twin.
  window.BlogBridge = {
    updateMeta: async function (id, patch) {
      patch = patch || {};
      var updates = { updatedAt: new Date().toISOString() };
      if (typeof patch.title === 'string') updates.title = patch.title.trim();
      if (typeof patch.excerpt === 'string') updates.excerpt = patch.excerpt.trim();
      if (Array.isArray(patch.tags)) updates.tags = patch.tags;
      // SEO fields (widened for the native full editor — PR-2). Mirrors the legacy
      // blogUpdateSlug / MetaDescription / Canonical / OgImage / SchemaType
      // validation: slug normalized, metaDescription capped at 200, canonical/ogImage
      // must be http(s) or empty (→ null), schemaType pinned to the two valid values.
      if (typeof patch.slug === 'string') updates.slug = blogSlugify(patch.slug);
      if (typeof patch.metaDescription === 'string') updates.metaDescription = String(patch.metaDescription).slice(0, 200);
      if ('canonical' in patch) {
        var canon = String(patch.canonical || '').trim();
        if (canon && !/^https?:\/\//i.test(canon)) throw new Error('Canonical URL must start with http:// or https://');
        updates.canonical = canon || null;
      }
      if ('ogImage' in patch) {
        var og = String(patch.ogImage || '').trim();
        if (og && !/^https?:\/\//i.test(og)) throw new Error('OG image URL must start with http:// or https://');
        updates.ogImage = og || null;
      }
      if (typeof patch.schemaType === 'string') updates.schemaType = (patch.schemaType === 'Article') ? 'Article' : 'BlogPosting';
      await MastDB.blog.posts.ref(id).update(updates);
      var local = (typeof blogPosts !== 'undefined' && blogPosts) ? blogPosts.find(function (p) { return p.id === id; }) : null;
      if (local) Object.assign(local, updates);
      return updates;
    },
    // Native create for blog-v2 (free/trial tenants reach the twin without the
    // Builder as their only authoring path). Mirrors blogCreatePost's record
    // shape exactly (postNumber counter, author default, full field set) but is
    // parameterized. Body arrives as PLAIN TEXT and is run through
    // blogPlainToHtml (escapeHtml → <p>) so a body that merely *looks* like HTML
    // can never render raw on the storefront (blogIsHtmlBody treats any <tag> as
    // HTML); rich formatting / inline images stay on the Builder. Status is
    // capped to the pre-publish states — publishing has website/Substack side
    // effects that live with the Builder.
    create: async function (data) {
      data = data || {};
      var counterRef = MastDB.blog.meta.postCounter();
      var result = await counterRef.transaction(function (current) { return (current || 0) + 1; });
      var postNumber = result.snapshot.val();
      var id = 'post_' + Date.now();
      var status = (data.status === 'complete') ? 'complete' : 'draft';
      var post = {
        id: id,
        postNumber: postNumber,
        title: (data.title || '').trim(),
        slug: '',
        author: (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid)
          || Object.keys(BLOG_AUTHORS)[0] || 'author',
        body: blogPlainToHtml(data.body || ''),
        aiVersion: '',
        usedAI: false,
        status: status,
        inlineImages: [],
        tags: Array.isArray(data.tags) ? data.tags : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedAt: null,
        scheduledAt: null,
        featuredImageId: null,
        excerpt: (data.excerpt || '').trim(),
        substackDraftUrl: null
      };
      await MastDB.blog.posts.ref(id).set(post);
      if (typeof blogPosts !== 'undefined' && Array.isArray(blogPosts)) blogPosts.unshift(post);
      return id;
    },
    removeDraft: async function (id) {
      await MastDB.blog.posts.ref(id).remove();
      if (typeof blogPosts !== 'undefined' && Array.isArray(blogPosts)) {
        var i = blogPosts.findIndex(function (p) { return p.id === id; });
        if (i !== -1) blogPosts.splice(i, 1);
      }
      return true;
    },

    // ── Native rich-body write layer (V1-editor-elimination program) ──
    // Single-sources every rich-body / inline-image write so the native V2 blog
    // editor (blog-v2's blog-editor-v2 drill) never writes MastDB directly. The
    // body is ALWAYS sanitized here via the canonical MastUI.sanitizeHtml before
    // it lands — the storefront injects post.body RAW (blogIsHtmlBody treats any
    // <tag> as HTML), so this is the load-bearing XSS gate. Callers gate on the
    // blog edit permission.
    _san: function (h) { return blogCanonicalSanitize(h); },
    // Stored body → editor innerHTML for the native editor, sanitized with the
    // CANONICAL sanitizer (defense vs legacy unsanitized data on load). Markers
    // are injected AFTER sanitize (the strict allowlist would strip class/data-*).
    loadBodyHtml: function (body, inlineImages) {
      return blogStoredBodyToEditorHtml(body, inlineImages, blogCanonicalSanitize);
    },
    // Stored body + inline images → the EXACT composed storefront HTML
    // (blogRenderBodyToHtml) for the native preview — single-sourced with
    // publishToWebsite so preview == published output.
    previewBodyHtml: function (body, inlineImages) {
      return blogRenderBodyToHtml(body || '', inlineImages || []);
    },
    // Persist the rich body from the native editor. `html` is the contenteditable
    // innerHTML (marker spans / coupon divs); it is converted to the stored
    // placeholder form, then sanitized via MastUI.sanitizeHtml before it lands.
    // inlineImages, when an array, is written alongside. Returns the stored shape.
    setBody: async function (id, html, inlineImages) {
      var stored = blogCanonicalSanitize(blogBodyHtmlToStored(html || ''));
      var updates = { body: stored, updatedAt: new Date().toISOString() };
      if (Array.isArray(inlineImages)) updates.inlineImages = inlineImages;
      await MastDB.blog.posts.ref(id).update(updates);
      var local = (typeof blogPosts !== 'undefined' && blogPosts) ? blogPosts.find(function (p) { return p.id === id; }) : null;
      if (local) Object.assign(local, updates);
      return { body: stored, inlineImages: updates.inlineImages };
    },
    // Persist the inline-images array (and, when marker positions shifted, the
    // body too — same sanitize path as setBody).
    setInlineImages: async function (id, inlineImages, html) {
      var updates = { inlineImages: Array.isArray(inlineImages) ? inlineImages : [], updatedAt: new Date().toISOString() };
      if (typeof html === 'string') updates.body = blogCanonicalSanitize(blogBodyHtmlToStored(html));
      await MastDB.blog.posts.ref(id).update(updates);
      var local = (typeof blogPosts !== 'undefined' && blogPosts) ? blogPosts.find(function (p) { return p.id === id; }) : null;
      if (local) Object.assign(local, updates);
      return updates;
    },

    // ── PR-2: full-editor write layer (author / featured image / SEO / status /
    // schedule / publish). Each mirrors the legacy Builder handler so the native
    // editor and the Builder write identically; the native editor never touches
    // MastDB directly. Callers gate on the blog edit permission. ──
    _stamp: async function (id, fields) {
      var updates = Object.assign({ updatedAt: new Date().toISOString() }, fields);
      await MastDB.blog.posts.ref(id).update(updates);
      var local = (typeof blogPosts !== 'undefined' && blogPosts) ? blogPosts.find(function (p) { return p.id === id; }) : null;
      if (local) Object.assign(local, updates);
      return updates;
    },
    setFeaturedImage: function (id, imageId) { return this._stamp(id, { featuredImageId: imageId || null }); },
    setAuthor: function (id, key) { return this._stamp(id, { author: key }); },
    // Author photo — a cross-cutting write to admin/users/{uid}/profile (real admin
    // user) or public/config/brand/authors/{key} (brand fictional author), mirroring
    // blogChangeAuthorPhoto's persistence + shared-profile-cache invalidation +
    // TENANT_CONFIG mirror. Returns the saved url.
    setAuthorPhoto: async function (authorKey, photoUrl) {
      var key = authorKey;
      if (!key) throw new Error('No author selected');
      var isRealUser = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid === key)
        || (window.adminUsers && window.adminUsers[key]);
      if (isRealUser) await MastDB.set('admin/users/' + key + '/profile/photoUrl', photoUrl);
      else await MastDB.set('public/config/brand/authors/' + key + '/photoUrl', photoUrl);
      if (!BLOG_AUTHORS[key]) BLOG_AUTHORS[key] = { name: key, photoUrl: '', bio: '' };
      BLOG_AUTHORS[key].photoUrl = photoUrl;
      if (isRealUser) {
        if (typeof window.invalidateUserProfileCache === 'function') window.invalidateUserProfileCache(key);
        if (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid === key) {
          var av = document.getElementById('userAvatar'); if (av) av.src = photoUrl;
        }
      } else {
        try {
          if (window.TENANT_CONFIG && TENANT_CONFIG.brand) {
            TENANT_CONFIG.brand.authors = TENANT_CONFIG.brand.authors || {};
            TENANT_CONFIG.brand.authors[key] = TENANT_CONFIG.brand.authors[key] || {};
            TENANT_CONFIG.brand.authors[key].photoUrl = photoUrl;
          }
        } catch (e) {}
      }
      return photoUrl;
    },
    // The author roster the picker offers (brand authors + the enriched uid authors),
    // resolved by name. Read-only convenience for the native editor. Seeds the
    // roster first (loadBlogAuthors is idempotent) so the picker works even when the
    // classic #blog route was never visited.
    authors: function () {
      try { loadBlogAuthors(); } catch (e) {}
      var m = {};
      Object.keys(BLOG_AUTHORS || {}).forEach(function (k) { m[k] = { name: (BLOG_AUTHORS[k] && BLOG_AUTHORS[k].name) || k, photoUrl: (BLOG_AUTHORS[k] && BLOG_AUTHORS[k].photoUrl) || '', bio: (BLOG_AUTHORS[k] && BLOG_AUTHORS[k].bio) || '' }; });
      return m;
    },
    // Status lifecycle (draft ↔ complete), mirroring blogMarkComplete/blogBackToDraft.
    setStatus: function (id, status) {
      var s = (status === 'complete') ? 'complete' : 'draft';
      return this._stamp(id, { status: s }).then(function () { return s; });
    },
    // Schedule / cancel (mirrors blogPublishSelected's schedule branch + blogCancelSchedule).
    schedule: function (id, iso) { return this._stamp(id, { status: 'scheduled', scheduledAt: iso }); },
    cancelSchedule: function (id) { return this._stamp(id, { status: 'complete', scheduledAt: null }); },
    // Publish / unpublish — id-based, single-sourced with the legacy Builder via the
    // shared _blogPublishPostToWebsite / _blogUnpublishPost cores. Reads the post
    // FRESH so any just-autosaved body/meta is reflected.
    publishToWebsite: async function (id) {
      var raw = await MastDB.get('blog/posts/' + id);
      var post = (raw && typeof raw.val === 'function') ? raw.val() : raw;
      if (post && !post.id) post.id = id;
      return _blogPublishPostToWebsite(post);
    },
    unpublish: function (id) { return _blogUnpublishPost(id); },
    // AI suggest-tags — calls the socialAI CF, merges new tags, persists via the
    // bridge. Returns { tags, suggested }. (Mirrors blogSuggestTags.)
    suggestTags: async function (id) {
      var raw = await MastDB.get('blog/posts/' + id);
      var post = (raw && typeof raw.val === 'function') ? raw.val() : (raw || {});
      var tmp = document.createElement('div'); tmp.innerHTML = post.body || '';
      var cleanBody = (tmp.textContent || tmp.innerText || '').replace(/\[Image \d+\]/g, '').replace(/\[IMG:[^\]]+\]/g, '').replace(/\[Coupon:[^\]]+\]/g, '').trim();
      var result = await firebase.functions().httpsCallable('socialAI')({ action: 'suggestBlogTags', tenantId: MastDB.tenantId(), body: cleanBody, title: post.title || '' });
      var suggested = (result && result.data && result.data.tags) || [];
      var merged = Array.isArray(post.tags) ? post.tags.slice() : [];
      suggested.forEach(function (t) { if (merged.indexOf(t) === -1) merged.push(t); });
      await this._stamp(id, { tags: merged });
      return { tags: merged, suggested: suggested };
    },
    // AI polish — calls the socialAI CF and RETURNS the polished body as editor HTML
    // (image-marker placeholders re-appended); the caller confirms + persists via
    // setBody. (Mirrors blogPolishWithAI + blogPickVersion('ai').)
    polishBody: async function (id) {
      var raw = await MastDB.get('blog/posts/' + id);
      var post = (raw && typeof raw.val === 'function') ? raw.val() : (raw || {});
      var structured = blogExtractStructuredText(post.body || '');
      var cleanBody = structured.replace(/\[Image \d+\]/g, '').replace(/\[Coupon:[^\]]+\]/g, '').trim();
      var author = BLOG_AUTHORS[post.author] || BLOG_AUTHORS[Object.keys(BLOG_AUTHORS)[0]] || { name: post.author || 'Author' };
      var result = await firebase.functions().httpsCallable('socialAI')({ action: 'blogPolish', tenantId: MastDB.tenantId(), body: cleanBody, authorName: author.name, title: post.title || '' });
      var polished = (result && result.data && result.data.polished) || cleanBody;
      var aiHtml = blogStructuredTextToHtml(polished);
      var imgs = Array.isArray(post.inlineImages) ? post.inlineImages : (post.inlineImages ? Object.keys(post.inlineImages).map(function (k) { return post.inlineImages[k]; }) : []);
      imgs.forEach(function (img, idx) { var marker = '[Image ' + (idx + 1) + ']'; if (aiHtml.indexOf(marker) === -1) aiHtml += '<p>' + marker + '</p>'; });
      return aiHtml;
    },

    // ── Blog Ideas queue — single-sourced write path for blog-v2's native
    // Ideas surface (marketing-v2 LOW closer). Mirrors the legacy #blog
    // Ideas section exactly (blogAddIdea / blogDeleteIdea / blogStartFromIdea):
    // ideas live at blog/ideas as { id, text, createdAt }; capture appends one,
    // delete removes one, and "turn into a draft post" mints a draft via the
    // same create() path (the idea text becomes the post title). Conversion does
    // NOT delete the idea (matches the legacy blogStartFromIdea, which only
    // seeds the new post). Reads are bounded (orderByChild + limitToLast 50,
    // mirroring loadBlog). The V2 twin gates these on the blog edit permission.
    listIdeas: async function () {
      var snap = await MastDB.blog.ideas.ref().orderByChild('createdAt').limitToLast(50).once('value');
      var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var out = val ? Object.keys(val).map(function (k) {
        var i = val[k] || {}; if (!i.id) i.id = k; return i;
      }) : [];
      out.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
      if (typeof blogIdeas !== 'undefined' && Array.isArray(blogIdeas)) blogIdeas = out;
      return out;
    },
    addIdea: async function (text) {
      var t = String(text == null ? '' : text).trim();
      if (!t) throw new Error('Idea text is required');
      var id = 'idea_' + Date.now();
      var idea = { id: id, text: t, createdAt: new Date().toISOString() };
      await MastDB.blog.ideas.ref(id).set(idea);
      if (typeof blogIdeas !== 'undefined' && Array.isArray(blogIdeas)) blogIdeas.unshift(idea);
      return idea;
    },
    removeIdea: async function (id) {
      await MastDB.blog.ideas.ref(id).remove();
      if (typeof blogIdeas !== 'undefined' && Array.isArray(blogIdeas)) {
        blogIdeas = blogIdeas.filter(function (i) { return i.id !== id; });
      }
      return true;
    },
    // Turn an idea into a draft post — mints a draft whose title is the idea
    // text (single-sourced with create()). Returns the new post id. The idea is
    // left in place (matches the legacy blogStartFromIdea seed behavior).
    ideaToDraft: async function (text) {
      var t = String(text == null ? '' : text).trim();
      return this.create({ title: t, status: 'draft' });
    }
  };
})();
