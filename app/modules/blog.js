/**
 * Blog Module — Artist Voice Posts
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var blogLoaded = false;
  var blogPosts = [];
  var blogIdeas = [];
  var blogCurrentView = 'list'; // list | editor
  var blogCurrentPostId = null;
  var blogCurrentPost = null;
  var blogAiResult = null;
  var blogShowPreview = false;

  // Blog authors — loaded from TENANT_CONFIG.brand.authors
  var BLOG_AUTHORS = {};

  function blogBadgeHtml(status) {
    var s = status || 'draft';
    var colors = { draft: 'background:rgba(196,133,60,0.15);color:var(--amber)', complete: 'background:rgba(42,124,111,0.15);color:var(--teal)', scheduled: 'background:rgba(59,130,246,0.15);color:#3b82f6', posted: 'background:#16a34a;color:#fff', published: 'background:#16a34a;color:#fff' };
    return '<span class="status-badge pill" style="' + (colors[s] || colors.draft) + '">' + s + '</span>';
  }

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

  // After post data loads, look up admin/users/{uid}/profile for every
  // unique uid-looking author key and merge into BLOG_AUTHORS. Lets the
  // existing synchronous render fallback (BLOG_AUTHORS[post.author]) show
  // real names + photos for posts authored by other admins on the tenant.
  function enrichBlogAuthorsFromPosts() {
    if (typeof window.getUserProfile !== 'function') return;
    var seen = {};
    (blogPosts || []).forEach(function(p) {
      if (!p || !p.author) return;
      var key = String(p.author);
      // Heuristic: uid-like keys are 20+ alphanumeric chars. Skip 'author',
      // email addresses, and brand author handles.
      if (BLOG_AUTHORS[key]) return;
      if (!/^[A-Za-z0-9]{20,}$/.test(key)) return;
      if (seen[key]) return;
      seen[key] = true;
      window.getUserProfile(key).then(function(profile) {
        if (!profile) return;
        BLOG_AUTHORS[key] = {
          name: profile.displayName || key,
          photoUrl: profile.photoUrl || '',
          bio: profile.bio || ''
        };
        // Re-render if the editor is currently looking at a post by this author.
        if (blogCurrentPost && blogCurrentPost.author === key && blogCurrentView === 'editor') {
          renderBlogEditor();
        }
      });
    });
  }

  function blogGetUid() { return currentUser ? currentUser.uid : null; }

  // ===== DATA LOADING =====

  async function loadBlog() {
    loadBlogAuthors();
    var uid = blogGetUid();
    if (!uid) { blogLoaded = true; renderBlog(); return; }
    try {
      var postSnap = await MastDB.blog.posts.ref().orderByChild('createdAt').limitToLast(100).once('value');
      var postVal = postSnap.val();
      blogPosts = postVal ? Object.values(postVal).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); }) : [];
      enrichBlogAuthorsFromPosts();

      var ideaSnap = await MastDB.blog.ideas.ref().orderByChild('createdAt').limitToLast(50).once('value');
      var ideaVal = ideaSnap.val();
      blogIdeas = ideaVal ? Object.values(ideaVal).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); }) : [];

      blogLoaded = true;
      blogCheckScheduledPosts();
      renderBlog();
    } catch (err) {
      console.error('Error loading blog:', err);
      blogLoaded = true;
      renderBlog();
    }
  }

  // ===== VIEW ROUTER =====

  function renderBlog() {
    if (blogCurrentView === 'editor' && blogCurrentPostId) { renderBlogEditor(); return; }
    renderBlogList();
  }

  // ===== BLOG LIST VIEW =====

  function renderBlogList() {
    blogCurrentView = 'list';

    // URL-driven filters from MCP admin links: status, dateFrom, dateTo, postIds.
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlDateFrom = (rp && typeof rp.dateFrom === 'string') ? rp.dateFrom.slice(0, 10) : '';
    var urlDateTo = (rp && typeof rp.dateTo === 'string') ? rp.dateTo.slice(0, 10) : '';
    var urlIdsParam = (rp && typeof rp.postIds === 'string') ? rp.postIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id){urlIdLookup[id]=true;});
    var hasUrlFilter = !!(urlStatus || urlDateFrom || urlDateTo || urlIds.length);

    var filteredPosts = hasUrlFilter
      ? blogPosts.filter(function(post) {
          if (urlStatus && (post.status || 'draft') !== urlStatus) return false;
          if (urlIdLookup && !urlIdLookup[post.id]) return false;
          if (urlDateFrom || urlDateTo) {
            var iso = post.publishedAt || post.createdAt || '';
            if (!iso) return false;
            var d = iso.slice(0, 10);
            if (urlDateFrom && d < urlDateFrom) return false;
            if (urlDateTo && d > urlDateTo) return false;
          }
          return true;
        })
      : blogPosts;

    var html = '<div class="blog-header"><h2>Blog Posts</h2>' +
      '<button class="btn btn-primary" onclick="blogCreatePost()">+ New Post</button></div>';

    if (hasUrlFilter) {
      var bParts = [];
      if (urlIds.length) bParts.push(urlIds.length + ' selected post' + (urlIds.length === 1 ? '' : 's'));
      if (urlStatus) bParts.push('status: ' + urlStatus);
      if (urlDateFrom && urlDateTo) bParts.push('from ' + urlDateFrom + ' to ' + urlDateTo);
      else if (urlDateFrom) bParts.push('from ' + urlDateFrom + ' onward');
      else if (urlDateTo) bParts.push('through ' + urlDateTo);
      html += '<div id="blogUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>\ud83d\udcdd Showing ' + bParts.join(', ') + '</span>' +
        '<button type="button" onclick="clearBlogFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    if (filteredPosts.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">\u270d\ufe0f</div>' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No blog posts yet</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Write your first post to share your voice as an artist.</p></div>';
    } else {
      filteredPosts.forEach(function(post) {
        var author = BLOG_AUTHORS[post.author] || BLOG_AUTHORS[Object.keys(BLOG_AUTHORS)[0]] || { name: post.author || 'Author', photoUrl: '', bio: '' };
        var dateStr = post.createdAt ? new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        html += '<div class="blog-post-row" onclick="blogOpenPost(\'' + post.id + '\')">' +
          '<img class="blog-avatar" src="' + esc(author.photoUrl) + '" alt="' + esc(author.name) + '" />' +
          '<span class="blog-post-title">' + esc(post.title || 'Untitled Post') + '</span>' +
          '<span class="blog-post-author">' + esc(author.name) + '</span>' +
          blogBadgeHtml(post.status) +
          (post.publishedToWebsite ? '<span style="font-size:0.78rem;" title="Published to website">\ud83c\udf10</span>' : '') +
          '<span class="blog-post-date">' + dateStr + '</span>' +
          '</div>';
      });
    }

    // Blog Ideas section — always visible
    html += '<div class="blog-ideas-section">' +
      '<h3>\ud83d\udca1 Blog Ideas</h3>' +
      '<div class="blog-idea-input">' +
      '<input type="text" id="blogIdeaInput" placeholder="Capture a blog idea..." onkeydown="if(event.key===\'Enter\')blogAddIdea()" />' +
      '<button class="btn btn-primary" onclick="blogAddIdea()" style="white-space:nowrap;">+ New Idea</button>' +
      '</div>';

    if (blogIdeas.length === 0) {
      html += '<p style="font-size:0.85rem;color:var(--text-secondary);text-align:center;padding:12px;">No ideas captured yet. Jot one down when inspiration strikes!</p>';
    } else {
      blogIdeas.forEach(function(idea) {
        var dateStr = idea.createdAt ? new Date(idea.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        html += '<div class="blog-idea-row">' +
          '<span class="blog-idea-text">' + escapeHtml(idea.text) + '</span>' +
          '<span class="blog-idea-date">' + dateStr + '</span>' +
          '<div class="blog-idea-actions">' +
          '<button onclick="blogStartFromIdea(\'' + idea.id + '\')" title="Write this post">\u270d\ufe0f</button>' +
          '<button onclick="blogDeleteIdea(\'' + idea.id + '\')" title="Remove idea">\ud83d\uddd1\ufe0f</button>' +
          '</div></div>';
      });
    }
    html += '</div>';

    document.getElementById('blogContent').innerHTML = html;
  }

  // ===== BLOG IDEAS CRUD =====

  async function blogAddIdea() {
    var input = document.getElementById('blogIdeaInput');
    var text = input ? input.value.trim() : '';
    if (!text) return;
    var id = 'idea_' + Date.now();
    var idea = { id: id, text: text, createdAt: new Date().toISOString() };
    try {
      await MastDB.blog.ideas.ref(id).set(idea);
      blogIdeas.unshift(idea);
      input.value = '';
      renderBlogList();
      showToast('Idea captured!');
    } catch (err) { showToast('Error saving idea: ' + err.message, true); }
  }

  async function blogDeleteIdea(id) {
    try {
      await MastDB.blog.ideas.ref(id).remove();
      blogIdeas = blogIdeas.filter(function(i) { return i.id !== id; });
      renderBlogList();
    } catch (err) { showToast('Error deleting idea: ' + err.message, true); }
  }

  function blogStartFromIdea(ideaId) {
    var idea = blogIdeas.find(function(i) { return i.id === ideaId; });
    blogCreatePost(idea ? idea.text : '');
  }

  // ===== CREATE POST =====

  async function blogCreatePost(initialTitle) {
    try {
      // Atomic counter
      var counterRef = MastDB.blog.meta.postCounter();
      var result = await counterRef.transaction(function(current) { return (current || 0) + 1; });
      var postNumber = result.snapshot.val();
      var id = 'post_' + Date.now();
      var post = {
        id: id,
        postNumber: postNumber,
        title: initialTitle || '',
        slug: '',
        // Default to the logged-in user's uid (canonical going forward).
        // Falls back to first BLOG_AUTHORS key (brand fictional author) or
        // the legacy literal 'author' if neither exists.
        author: (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid)
          || Object.keys(BLOG_AUTHORS)[0]
          || 'author',
        body: '',
        aiVersion: '',
        usedAI: false,
        status: 'draft',
        inlineImages: [],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedAt: null,
        scheduledAt: null,
        featuredImageId: null,
        excerpt: '',
        substackDraftUrl: null
      };
      await MastDB.blog.posts.ref(id).set(post);
      blogPosts.unshift(post);
      blogCurrentPostId = id;
      blogCurrentPost = post;
      blogCurrentView = 'editor';
      blogAiResult = null;
      renderBlog();
      showToast('New blog post created');
    } catch (err) { showToast('Error creating post: ' + err.message, true); }
  }

  // ===== OPEN POST =====

  function blogOpenPost(postId) {
    var post = blogPosts.find(function(p) { return p.id === postId; });
    if (!post) { showToast('Post not found', true); return; }
    blogCurrentPostId = postId;
    blogCurrentPost = post;
    blogCurrentView = 'editor';
    blogAiResult = null;
    blogShowPreview = false;
    renderBlog();
  }

  // ===== BLOG EDITOR VIEW =====

  function renderBlogEditor() {
    var post = blogCurrentPost;
    if (!post) { renderBlogList(); return; }
    var author = BLOG_AUTHORS[post.author] || BLOG_AUTHORS[Object.keys(BLOG_AUTHORS)[0]] || { name: post.author || 'Author', photoUrl: '', bio: '' };
    var status = post.status || 'draft';

    var html = '';
    // Top bar
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">' +
      '<button class="detail-back" onclick="blogBackToList()">\u2190 Back to Posts</button>' +
      '<button class="btn" onclick="blogTogglePreview()" style="' + (blogShowPreview ? 'background:var(--amber);color:#fff;border-color:var(--amber);' : '') + '">' + (blogShowPreview ? '\u270f\ufe0f Edit' : '\ud83d\udc41 Preview') + '</button>' +
      '<div style="margin-left:auto;display:flex;align-items:center;gap:8px;">' +
      '<span id="blogSaveStatus" class="blog-save-status"></span>' +
      blogBadgeHtml(status) + '</div>' +
      '<button class="btn" style="color:#c44;border-color:#c44;" onclick="blogDeletePost()">Delete</button>' +
      '</div>';

    // Preview mode
    if (blogShowPreview) {
      var bodyHtml = blogRenderBodyToHtml(post.body || '', post.inlineImages || []);
      var tags = post.tags || [];
      var dateStr = post.updatedAt ? new Date(post.updatedAt).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : '';
      html += '<div class="blog-preview">' +
        '<article class="blog-preview-article">' +
        '<div class="blog-preview-byline">' +
        '<img src="' + esc(author.photoUrl) + '" alt="' + esc(author.name) + '" class="blog-preview-byline-photo" />' +
        '<div>' +
        '<div class="blog-preview-byline-name">' + esc(author.name) + '</div>' +
        '<div class="blog-preview-byline-date">' + dateStr + '</div>' +
        '</div></div>' +
        '<h1 class="blog-preview-title">' + escapeHtml(post.title || 'Untitled Post') + '</h1>' +
        (tags.length > 0 ? '<div class="blog-preview-tags">' + tags.map(function(t) { return '<span class="blog-preview-tag">' + escapeHtml(t) + '</span>'; }).join('') + '</div>' : '') +
        '<div class="blog-preview-body">' + bodyHtml + '</div>' +
        '</article></div>';

      // Social card preview
      var scDomain = (window.TENANT_CONFIG && TENANT_CONFIG.domain) || window.location.hostname;
      var scTitle = (post.title || 'Untitled Post').substring(0, 70);
      var scDesc = post.excerpt || '';
      if (!scDesc && bodyHtml) { var _t = document.createElement('div'); _t.innerHTML = bodyHtml; scDesc = (_t.textContent || '').trim().substring(0, 200); }
      var scFeatImg = post.featuredImageId && imageLibrary ? imageLibrary[post.featuredImageId] : null;
      html += '<div class="blog-social-preview" style="max-width:680px;margin:24px auto 0;">' +
        '<h4 style="font-size:0.85rem;font-weight:500;color:var(--text-secondary);margin-bottom:8px;">Social Card Preview</h4>' +
        '<div class="blog-social-card">' +
        (scFeatImg ? '<div class="blog-social-card-image"><img src="' + esc(scFeatImg.url || scFeatImg.thumbnailUrl) + '" alt="" /></div>' :
          '<div class="blog-social-card-image blog-social-card-noimg"><span>\ud83d\uddbc\ufe0f</span><div>No featured image set</div></div>') +
        '<div class="blog-social-card-content">' +
        '<div class="blog-social-card-domain">' + esc(scDomain) + '</div>' +
        '<div class="blog-social-card-title">' + escapeHtml(scTitle) + (post.title && post.title.length > 70 ? '...' : '') + '</div>' +
        '<div class="blog-social-card-desc">' + escapeHtml(scDesc.substring(0, 200)) + (scDesc.length > 200 ? '...' : '') + '</div>' +
        '</div></div>';
      if (!scFeatImg) html += '<div style="font-size:0.78rem;color:var(--amber);margin-top:6px;">\u26a0 Add a featured image for better social sharing</div>';
      if (!post.excerpt) html += '<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:2px;">\u2139\ufe0f Using auto-generated excerpt \u2014 add a custom one for better control</div>';
      html += '</div>';

      // Actions bar even in preview
      html += '<div class="blog-actions" style="max-width:680px;margin:16px auto 0;">';
      if (status === 'draft') {
        html += '<button class="btn" onclick="blogPolishWithAI()" id="blogPolishBtn" title="Uses tokens">Polish with AI</button>';
        if (window.MastAskAi && window.MastAskAi.isEnabled()) {
          html += '<button class="btn btn-outline" onclick="blogDraftInClaude()" title="Opens Claude Desktop">\u2728 Draft in Claude</button>';
        }
        html += '<button class="btn btn-primary" onclick="blogMarkComplete()">\u2705 Finish Post</button>';
      } else if (status === 'scheduled') {
        var schedDate = post.scheduledAt ? new Date(post.scheduledAt).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) : '';
        html += '<span style="font-size:0.85rem;color:#3b82f6;">\ud83d\udcc5 Scheduled for ' + schedDate + '</span>';
        html += '<button class="btn" onclick="blogCancelSchedule()" style="font-size:0.78rem;">Cancel Schedule</button>';
        html += '<button class="btn" onclick="blogBackToDraft()">\u270f\ufe0f Back to Draft</button>';
      } else if (status === 'complete') {
        html += '<button class="btn" onclick="blogBackToDraft()">\u270f\ufe0f Back to Draft</button>';
        if (post.publishedToWebsite) {
          html += '<span class="status-badge pill" style="background:#16a34a;color:#fff;">\ud83c\udf10 Published</span>';
          html += '<button class="btn" onclick="blogUnpublishFromWebsite()" style="font-size:0.78rem;">Unpublish</button>';
        } else {
          html += '<button class="btn btn-primary" onclick="blogOpenPublishDialog()">\ud83d\udce4 Publish</button>';
        }
      }
      html += '</div>';
      document.getElementById('blogContent').innerHTML = html;
      return;
    }

    // Author header card. The photo is click-to-change: opens the image
    // library, writes the chosen URL to public/config/brand/authors/{key}/photoUrl
    // (shared across every post by this author).
    html += '<div class="blog-author-card">' +
      '<div style="position:relative;cursor:pointer;display:inline-block;" onclick="blogChangeAuthorPhoto()" title="Click to change author photo">' +
        '<img class="blog-author-photo" id="blogAuthorPhoto" src="' + esc(author.photoUrl || '') + '" alt="' + esc(author.name) + '" ' +
          'onerror="this.style.background=\'var(--cream-dark,#e8e0d4)\';this.removeAttribute(\'src\');" />' +
        '<span style="position:absolute;bottom:0;right:0;background:var(--teal,#2a7c6f);color:#fff;border-radius:999px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:0.72rem;border:2px solid var(--cream);" aria-hidden="true">✎</span>' +
      '</div>' +
      '<div class="blog-author-info">' +
      '<select onchange="blogChangeAuthor(this.value)">' +
      Object.keys(BLOG_AUTHORS).map(function(k) { return '<option value="' + k + '"' + (post.author === k ? ' selected' : '') + '>' + esc(BLOG_AUTHORS[k].name || k) + '</option>'; }).join('') +
      '</select>' +
      '<div class="blog-author-bio" id="blogAuthorBio">' + esc(author.bio) + '</div>' +
      '</div></div>';

    // Title
    html += '<input class="blog-title-input" type="text" value="' + escapeHtml(post.title || '') + '" placeholder="Post title..." onchange="blogUpdateTitle(this.value)" />';

    // Tags
    html += '<div style="display:flex;align-items:center;gap:8px;">' +
      '<input class="blog-tags-input" style="margin-bottom:0;" type="text" value="' + (post.tags || []).join(', ') + '" placeholder="Tags (comma-separated)..." onchange="blogUpdateTags(this.value)" />' +
      '<button class="btn" id="blogSuggestTagsBtn" onclick="blogSuggestTags()" style="white-space:nowrap;font-size:0.78rem;padding:6px 10px;" title="AI-suggested tags based on your content">\ud83d\udca1 Suggest</button>' +
      '</div>';

    // Featured image
    var featImg = post.featuredImageId && imageLibrary ? imageLibrary[post.featuredImageId] : null;
    html += '<div class="blog-featured-image">';
    if (featImg) {
      html += '<div style="display:flex;align-items:center;gap:12px;">' +
        '<img src="' + esc(featImg.thumbnailUrl || featImg.url) + '" alt="" style="width:120px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" />' +
        '<div>' +
        '<div style="font-size:0.78rem;font-weight:500;margin-bottom:6px;">Featured Image</div>' +
        '<div style="display:flex;gap:6px;">' +
        '<button class="btn btn-outline" style="font-size:0.78rem;padding:4px 10px;" onclick="blogSetFeaturedImage()">Change</button>' +
        '<button class="btn btn-outline" style="font-size:0.78rem;padding:4px 10px;color:var(--danger);border-color:var(--danger);" onclick="blogRemoveFeaturedImage()">Remove</button>' +
        '</div></div></div>';
    } else {
      html += '<div class="blog-featured-placeholder" onclick="blogSetFeaturedImage()">' +
        '<span style="font-size:1.15rem;">\ud83d\uddbc\ufe0f</span> Set Featured Image' +
        '<div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">Used for social cards and blog listings</div>' +
        '</div>';
    }
    html += '</div>';

    // Excerpt
    html += '<div style="margin-bottom:12px;">' +
      '<textarea class="blog-excerpt-input" maxlength="300" placeholder="Write a short excerpt for social sharing and blog listings..." onchange="blogUpdateExcerpt(this.value)" oninput="blogUpdateExcerptCount(this.value)">' +
      escapeHtml(post.excerpt || '') + '</textarea>' +
      '<div style="font-size:0.72rem;color:var(--text-secondary);text-align:right;" id="blogExcerptCount">' + (post.excerpt || '').length + '/300</div>' +
      '</div>';

    // ── W1.4 SEO fields (collapsed by default) ──
    // Backfill defaults on first render of an existing post that's missing them.
    blogBackfillSeoDefaults(post);
    var schemaType = post.schemaType || 'BlogPosting';
    html += '<details class="blog-seo-details" style="margin-bottom:12px;border:1px solid var(--border);border-radius:6px;padding:8px 12px;background:var(--surface-card,transparent);">' +
      '<summary style="cursor:pointer;font-size:0.85rem;font-weight:600;color:var(--text-primary);">SEO &amp; Schema</summary>' +
      '<div style="display:grid;gap:10px;margin-top:10px;">' +

      '<div>' +
        '<label style="display:block;font-size:0.78rem;color:var(--text-secondary);margin-bottom:2px;">URL slug</label>' +
        '<input type="text" value="' + escapeHtml(post.slug || '') + '" onchange="blogUpdateSlug(this.value)" placeholder="post-url-slug" ' +
          'style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface-dark,transparent);color:var(--text-primary);font-size:0.85rem;font-family:monospace;">' +
        '<div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">Auto-generated from the title. Edit to lock a custom URL.</div>' +
      '</div>' +

      '<div>' +
        '<label style="display:block;font-size:0.78rem;color:var(--text-secondary);margin-bottom:2px;">Meta description</label>' +
        '<textarea maxlength="200" rows="2" onchange="blogUpdateMetaDescription(this.value)" placeholder="Short summary for search engines (max ~160 chars)" ' +
          'style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface-dark,transparent);color:var(--text-primary);font-size:0.85rem;font-family:inherit;resize:vertical;">' +
          escapeHtml(post.metaDescription || '') + '</textarea>' +
        '<div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">Defaults to the excerpt if blank.</div>' +
      '</div>' +

      '<div>' +
        '<label style="display:block;font-size:0.78rem;color:var(--text-secondary);margin-bottom:2px;">Canonical URL (optional)</label>' +
        '<input type="text" value="' + escapeHtml(post.canonical || '') + '" onchange="blogUpdateCanonical(this.value)" placeholder="https://example.com/canonical-source" ' +
          'style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface-dark,transparent);color:var(--text-primary);font-size:0.85rem;font-family:monospace;">' +
        '<div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">Use if this post was first published elsewhere.</div>' +
      '</div>' +

      '<div>' +
        '<label style="display:block;font-size:0.78rem;color:var(--text-secondary);margin-bottom:2px;">OG image URL (optional)</label>' +
        '<input type="text" value="' + escapeHtml(post.ogImage || '') + '" onchange="blogUpdateOgImage(this.value)" placeholder="Defaults to featured image" ' +
          'style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface-dark,transparent);color:var(--text-primary);font-size:0.85rem;font-family:monospace;">' +
      '</div>' +

      '<div>' +
        '<label style="display:block;font-size:0.78rem;color:var(--text-secondary);margin-bottom:4px;">Schema.org type</label>' +
        '<label style="font-size:0.85rem;margin-right:16px;cursor:pointer;">' +
          '<input type="radio" name="blogSchemaType" value="BlogPosting" ' + (schemaType === 'BlogPosting' ? 'checked' : '') + ' onchange="blogUpdateSchemaType(this.value)"> BlogPosting' +
        '</label>' +
        '<label style="font-size:0.85rem;cursor:pointer;">' +
          '<input type="radio" name="blogSchemaType" value="Article" ' + (schemaType === 'Article' ? 'checked' : '') + ' onchange="blogUpdateSchemaType(this.value)"> Article' +
        '</label>' +
      '</div>' +

      '</div></details>';

    // AI compare mode or rich text editor
    if (blogAiResult) {
      html += '<div class="nl-ai-compare">' +
        '<div class="nl-ai-panel original"><div class="nl-ai-panel-label">Your Original</div>' +
        '<div style="font-size:0.9rem;line-height:1.7;">' + (blogIsHtmlBody(post.body) ? (post.body || '') : escapeHtml(post.body || '').replace(/\n/g, '<br>')) + '</div></div>' +
        '<div class="nl-ai-panel polished"><div class="nl-ai-panel-label">AI Polished</div>' +
        '<div class="blog-preview-body" style="font-size:0.9rem;line-height:1.7;">' + blogStructuredTextToHtml(blogAiResult) + '</div></div>' +
        '</div>' +
        '<div class="nl-ai-actions">' +
        '<button class="btn" onclick="blogPickVersion(\'original\')">Keep Original</button>' +
        '<button class="btn btn-primary" onclick="blogPickVersion(\'ai\')">Use Polished</button>' +
        '</div>';
    } else {
      // Formatting toolbar
      html += '<div class="blog-format-toolbar">' +
        '<button class="blog-format-btn" id="blogBtnBold" onmousedown="event.preventDefault();blogFormatCmd(\'bold\')" title="Bold"><b>B</b></button>' +
        '<button class="blog-format-btn" id="blogBtnItalic" onmousedown="event.preventDefault();blogFormatCmd(\'italic\')" title="Italic"><i>I</i></button>' +
        '<button class="blog-format-btn" id="blogBtnUnderline" onmousedown="event.preventDefault();blogFormatCmd(\'underline\')" title="Underline"><u>U</u></button>' +
        '<div class="blog-format-sep"></div>' +
        '<button class="blog-format-btn blog-format-btn-wide" id="blogBtnH2" onmousedown="event.preventDefault();blogFormatBlock(\'h2\')" title="Heading 2">H2</button>' +
        '<button class="blog-format-btn blog-format-btn-wide" id="blogBtnH3" onmousedown="event.preventDefault();blogFormatBlock(\'h3\')" title="Heading 3">H3</button>' +
        '<div class="blog-format-sep"></div>' +
        '<button class="blog-format-btn" id="blogBtnQuote" onmousedown="event.preventDefault();blogFormatBlock(\'blockquote\')" title="Blockquote" style="font-size:1.15rem;">\u201c</button>' +
        '<button class="blog-format-btn" id="blogBtnUL" onmousedown="event.preventDefault();blogFormatCmd(\'insertUnorderedList\')" title="Bullet List" style="font-size:0.9rem;">\u2022\u2261</button>' +
        '<button class="blog-format-btn" id="blogBtnOL" onmousedown="event.preventDefault();blogFormatCmd(\'insertOrderedList\')" title="Numbered List" style="font-size:0.78rem;">1.</button>' +
        '<button class="blog-format-btn" id="blogBtnLink" onmousedown="event.preventDefault();blogInsertLink()" title="Insert Link" style="font-size:0.85rem;">\ud83d\udd17</button>' +
        '<button class="blog-format-btn" onmousedown="event.preventDefault();document.execCommand(\'insertHorizontalRule\');blogBodyChanged()" title="Divider">\u2015</button>' +
        '<div class="blog-format-sep"></div>' +
        '<select class="blog-format-select" onchange="blogFormatFont(this.value);this.value=\'\'" title="Font">' +
        '<option value="" disabled selected>Font</option>' +
        '<option value="DM Sans, Arial, sans-serif" style="font-family:DM Sans,Arial,sans-serif">Sans Serif</option>' +
        '<option value="Cormorant Garamond, Georgia, serif" style="font-family:Cormorant Garamond,Georgia,serif">Serif</option>' +
        '<option value="Georgia, Times New Roman, serif" style="font-family:Georgia,serif">Classic</option>' +
        '<option value="Courier New, monospace" style="font-family:Courier New,monospace">Monospace</option>' +
        '</select>' +
        '<select class="blog-format-select" onchange="blogFormatSize(this.value);this.value=\'\'" title="Size">' +
        '<option value="" disabled selected>Size</option>' +
        '<option value="2">Small</option>' +
        '<option value="3">Normal</option>' +
        '<option value="5">Large</option>' +
        '<option value="6">X-Large</option>' +
        '</select>' +
        '<div class="blog-format-sep"></div>' +
        '<div style="position:relative;display:inline-block;">' +
        '<button class="blog-format-btn" onmousedown="event.preventDefault();blogToggleEmojiPicker()" title="Insert Emoji" style="font-size:1rem;width:auto;padding:0 8px;">\ud83d\ude0a</button>' +
        '<div id="blogEmojiPicker" class="blog-emoji-picker" style="display:none;"></div>' +
        '</div>' +
        '<button class="blog-format-btn" onmousedown="event.preventDefault();blogInsertImage()" title="Insert Image" style="font-size:1rem;width:auto;padding:0 8px;">\ud83d\udcf7</button>' +
        '<button class="blog-format-btn" onmousedown="event.preventDefault();blogInsertCoupon()" title="Insert Coupon" style="font-size:1rem;width:auto;padding:0 8px;">\uD83C\uDFF7\uFE0F</button>' +
        '</div>';

      // Word count bar
      html += '<div class="blog-word-count" id="blogWordCount"></div>';

      // ContentEditable body
      html += '<div class="blog-body-editable" id="blogBodyEditable" contenteditable="true" data-placeholder="Write your post here..." oninput="blogBodyChanged()"></div>';
    }

    // Inline image thumbnails with labels, captions, and reorder controls
    var inlineImages = post.inlineImages || [];
    if (inlineImages.length > 0) {
      html += '<div class="blog-inline-images">';
      inlineImages.forEach(function(img, idx) {
        var imgData = imageLibrary[img.imageId];
        var thumbUrl = imgData ? (imgData.thumbnailUrl || imgData.url) : '';
        var caption = img.caption || '';
        var isFirst = idx === 0;
        var isLast = idx === inlineImages.length - 1;
        html += '<div style="text-align:center;">' +
          '<div class="blog-inline-img" onclick="blogEditCaption(' + idx + ')" style="cursor:pointer;" title="Click to edit caption">' +
          '<img src="' + thumbUrl + '" alt="inline image" />' +
          '<button class="remove-btn" onclick="event.stopPropagation();blogRemoveInlineImage(' + idx + ')">×</button>' +
          (caption ? '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:#fff;font-size:0.72rem;padding:2px 4px;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">\ud83d\udcac</div>' : '') +
          '</div>' +
          '<div class="blog-inline-img-label">Image ' + (idx + 1) + '</div>' +
          (inlineImages.length > 1 ? '<div style="display:flex;justify-content:center;gap:2px;margin-top:2px;">' +
            '<button onclick="event.stopPropagation();blogMoveImage(' + idx + ',-1)" style="background:none;border:none;cursor:pointer;font-size:0.72rem;color:' + (isFirst ? 'var(--border)' : 'var(--text-secondary)') + ';padding:1px 4px;"' + (isFirst ? ' disabled' : '') + ' title="Move left">\u25c0</button>' +
            '<button onclick="event.stopPropagation();blogMoveImage(' + idx + ',1)" style="background:none;border:none;cursor:pointer;font-size:0.72rem;color:' + (isLast ? 'var(--border)' : 'var(--text-secondary)') + ';padding:1px 4px;"' + (isLast ? ' disabled' : '') + ' title="Move right">\u25b6</button>' +
            '</div>' : '') +
          '</div>';
      });
      html += '</div>';
    }

    // Actions bar
    html += '<div class="blog-actions">';
    if (status === 'draft') {
      html += '<button class="btn" onclick="blogPolishWithAI()" id="blogPolishBtn" title="Uses tokens">Polish with AI</button>';
      if (window.MastAskAi && window.MastAskAi.isEnabled()) {
        html += '<button class="btn btn-outline" onclick="blogDraftInClaude()" title="Opens Claude Desktop">\u2728 Draft in Claude</button>';
      }
      html += '<button class="btn btn-primary" onclick="blogMarkComplete()">\u2705 Finish Post</button>';
    } else if (status === 'scheduled') {
      var schedDate2 = post.scheduledAt ? new Date(post.scheduledAt).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) : '';
      html += '<span style="font-size:0.85rem;color:#3b82f6;">\ud83d\udcc5 Scheduled for ' + schedDate2 + '</span>';
      html += '<button class="btn" onclick="blogCancelSchedule()" style="font-size:0.78rem;">Cancel Schedule</button>';
      html += '<button class="btn" onclick="blogBackToDraft()">\u270f\ufe0f Back to Draft</button>';
    } else if (status === 'complete') {
      html += '<button class="btn" onclick="blogBackToDraft()">\u270f\ufe0f Back to Draft</button>';
      if (post.publishedToWebsite) {
        html += '<span class="status-badge pill" style="background:#16a34a;color:#fff;">\ud83c\udf10 Published</span>';
        html += '<button class="btn" onclick="blogUnpublishFromWebsite()" style="font-size:0.78rem;">Unpublish</button>';
      } else {
        html += '<button class="btn btn-primary" onclick="blogOpenPublishDialog()">\ud83d\udce4 Publish</button>';
      }
    }
    html += '</div>';

    // W3b — per-content attribution panel host.
    html += '<div id="blogContentAttrPanel" style="max-width:680px;margin:0 auto;"></div>';

    document.getElementById('blogContent').innerHTML = html;

    // W3b — populate attribution panel for this post.
    if (post && post.id && typeof window.renderContentAttributionPanel === 'function') {
      var attrHost = document.getElementById('blogContentAttrPanel');
      if (attrHost) {
        window.renderContentAttributionPanel({
          hostEl: attrHost,
          contentId: post.id,
          utmSource: 'blog',
          utmMedium: 'organic',
          utmCampaign: post.campaignUtm || null,
          path: '/blog/post.html?id=' + encodeURIComponent(post.id),
        });
      }
    }

    // Load body content into contentEditable div (must be done after innerHTML is set)
    if (!blogAiResult && !blogShowPreview) {
      var editable = document.getElementById('blogBodyEditable');
      if (editable) {
        editable.innerHTML = blogLoadBodyToEditor(post.body || '', post.inlineImages || []);
        blogUpdateWordCount();
      }
    }
  }

  function blogBackToList() {
    if (window.MastNavStack && MastNavStack.size() > 0) {
      blogCurrentView = 'list';
      blogCurrentPostId = null;
      blogCurrentPost = null;
      blogAiResult = null;
      blogShowPreview = false;
      MastNavStack.popAndReturn();
      return;
    }
    blogCurrentView = 'list';
    blogCurrentPostId = null;
    blogCurrentPost = null;
    blogAiResult = null;
    blogShowPreview = false;
    renderBlog();
  }

  // ===== RICH TEXT EDITOR FUNCTIONS =====

  var blogBodySaveTimer = null;

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

  function blogSanitizeHtml(html) {
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    html = html.replace(/<object[\s\S]*?<\/object>/gi, '');
    html = html.replace(/<embed[\s\S]*?>/gi, '');
    html = html.replace(/\son\w+\s*=\s*(['"]?)[\s\S]*?\1/gi, '');
    html = html.replace(/javascript\s*:/gi, '');
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

  function blogLoadBodyToEditor(body, inlineImages) {
    return blogStoredBodyToEditorHtml(body, inlineImages, blogSanitizeHtml);
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

  function blogSaveBodyFromEditor() {
    var editable = document.getElementById('blogBodyEditable');
    if (!editable) return blogCurrentPost ? (blogCurrentPost.body || '') : '';
    return blogBodyHtmlToStored(editable.innerHTML || '');
  }

  function blogBodyChanged() {
    if (!blogCurrentPost) return;
    blogUpdateWordCount();
    clearTimeout(blogBodySaveTimer);
    blogBodySaveTimer = setTimeout(function() {
      var body = blogSaveBodyFromEditor();
      blogCurrentPost.body = body;
      blogCurrentPost.updatedAt = new Date().toISOString();
      blogSetSaveStatus('Saving...', 'saving');
      MastDB.blog.posts.ref(blogCurrentPostId).update({
        body: body,
        updatedAt: blogCurrentPost.updatedAt
      }).then(function() {
        blogSetSaveStatus('\u2713 Saved', 'saved');
      }).catch(function(err) {
        blogSetSaveStatus('Save failed', 'error');
        showToast('Auto-save failed: ' + err.message, true);
      });
    }, 500);
  }

  function blogFormatCmd(cmd) {
    document.execCommand(cmd, false, null);
    blogUpdateToolbarState();
  }

  function blogFormatFont(fontName) {
    if (!fontName) return;
    document.execCommand('fontName', false, fontName);
    var editable = document.getElementById('blogBodyEditable');
    if (editable) editable.focus();
  }

  function blogFormatSize(size) {
    if (!size) return;
    document.execCommand('fontSize', false, size);
    var editable = document.getElementById('blogBodyEditable');
    if (editable) editable.focus();
  }

  function blogFormatBlock(tag) {
    var current = document.queryCommandValue('formatBlock').toLowerCase();
    if (current === tag) {
      document.execCommand('formatBlock', false, '<div>');
    } else {
      document.execCommand('formatBlock', false, '<' + tag + '>');
    }
    blogUpdateToolbarState();
    blogBodyChanged();
  }

  function blogInsertLink() {
    var sel = window.getSelection();
    if (sel.rangeCount > 0) window._blogSavedRange = sel.getRangeAt(0).cloneRange();
    var selectedText = sel.toString();
    var existingUrl = '';
    // Check if selection is inside an existing link
    if (sel.anchorNode) {
      var linkEl = sel.anchorNode.nodeType === 1 ? sel.anchorNode.closest('a') : (sel.anchorNode.parentElement ? sel.anchorNode.parentElement.closest('a') : null);
      if (linkEl) existingUrl = linkEl.href || '';
    }
    var html = '<div class="modal-header"><h3>' + (existingUrl ? 'Edit Link' : 'Insert Link') + '</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body">' +
      (selectedText ? '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:8px;">Text: "' + esc(selectedText.substring(0, 60)) + '"</div>' : '') +
      '<input type="url" id="blogLinkUrl" placeholder="https://..." value="' + esc(existingUrl) + '" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);font-size:0.9rem;box-sizing:border-box;" />' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button class="btn btn-primary" onclick="blogApplyLink()">Apply</button>' +
      (existingUrl ? '<button class="btn btn-outline" onclick="blogRemoveLink()">Remove Link</button>' : '') +
      '</div></div>';
    openModal(html);
    setTimeout(function() { var inp = document.getElementById('blogLinkUrl'); if (inp) inp.focus(); }, 100);
  }

  function blogApplyLink() {
    var url = (document.getElementById('blogLinkUrl') || {}).value;
    if (!url) { closeModal(); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    closeModal();
    var editable = document.getElementById('blogBodyEditable');
    if (editable) editable.focus();
    if (window._blogSavedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(window._blogSavedRange);
      window._blogSavedRange = null;
    }
    document.execCommand('createLink', false, url);
    // Set links to open in new tab
    var links = editable ? editable.querySelectorAll('a[href="' + url + '"]') : [];
    links.forEach(function(a) { a.target = '_blank'; a.rel = 'noopener'; });
    blogBodyChanged();
  }

  function blogRemoveLink() {
    closeModal();
    var editable = document.getElementById('blogBodyEditable');
    if (editable) editable.focus();
    if (window._blogSavedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(window._blogSavedRange);
      window._blogSavedRange = null;
    }
    document.execCommand('unlink', false, null);
    blogBodyChanged();
  }

  // ===== AUTOSAVE INDICATOR =====

  var blogSaveStatusTimer = null;

  function blogSetSaveStatus(text, type) {
    var el = document.getElementById('blogSaveStatus');
    if (!el) return;
    clearTimeout(blogSaveStatusTimer);
    el.textContent = text;
    el.className = 'blog-save-status' + (type === 'error' ? ' save-error' : type === 'saving' ? ' saving' : ' saved');
    if (type === 'saved') {
      blogSaveStatusTimer = setTimeout(function() { el.textContent = ''; el.className = 'blog-save-status'; }, 2500);
    }
  }

  // ===== WORD COUNT =====

  function blogUpdateWordCount() {
    var el = document.getElementById('blogWordCount');
    if (!el) return;
    var editable = document.getElementById('blogBodyEditable');
    if (!editable) return;
    var text = (editable.textContent || '').replace(/\u00a0/g, ' ');
    // Strip marker text
    text = text.replace(/📷 Image \d+/g, '').replace(/🏷️ [^\s]+/g, '').trim();
    var words = text ? text.split(/\s+/).filter(function(w) { return w.length > 0; }).length : 0;
    var readMin = Math.max(1, Math.ceil(words / 225));
    el.textContent = words + ' word' + (words !== 1 ? 's' : '') + ' \u00b7 ' + readMin + ' min read';
  }

  // ===== SLASH COMMAND MENU =====

  var blogSlashActive = false;
  var blogSlashQuery = '';
  var blogSlashIndex = 0;

  var SLASH_COMMANDS = [
    { label: 'Heading 2', icon: 'H2', cmd: function() { blogFormatBlock('h2'); } },
    { label: 'Heading 3', icon: 'H3', cmd: function() { blogFormatBlock('h3'); } },
    { label: 'Bullet List', icon: '\u2022', cmd: function() { blogFormatCmd('insertUnorderedList'); } },
    { label: 'Numbered List', icon: '1.', cmd: function() { blogFormatCmd('insertOrderedList'); } },
    { label: 'Blockquote', icon: '\u201c', cmd: function() { blogFormatBlock('blockquote'); } },
    { label: 'Divider', icon: '\u2015', cmd: function() { document.execCommand('insertHorizontalRule'); blogBodyChanged(); } },
    { label: 'Image', icon: '\ud83d\udcf7', cmd: function() { blogInsertImage(); } },
    { label: 'Coupon', icon: '\uD83C\uDFF7\uFE0F', cmd: function() { blogInsertCoupon(); } }
  ];

  function blogFilterSlashCommands() {
    if (!blogSlashQuery) return SLASH_COMMANDS;
    var q = blogSlashQuery.toLowerCase();
    return SLASH_COMMANDS.filter(function(c) { return c.label.toLowerCase().indexOf(q) !== -1; });
  }

  function blogShowSlashMenu() {
    var existing = document.getElementById('blogSlashMenu');
    if (existing) existing.remove();

    var filtered = blogFilterSlashCommands();
    if (filtered.length === 0) { blogSlashActive = false; return; }
    if (blogSlashIndex >= filtered.length) blogSlashIndex = filtered.length - 1;

    var menu = document.createElement('div');
    menu.id = 'blogSlashMenu';
    menu.className = 'blog-slash-menu';

    var html = '';
    filtered.forEach(function(c, i) {
      html += '<div class="blog-slash-item' + (i === blogSlashIndex ? ' active' : '') + '" onmousedown="event.preventDefault();blogExecuteSlashCommand(' + i + ')">' +
        '<span class="blog-slash-icon">' + c.icon + '</span>' +
        '<span>' + c.label + '</span></div>';
    });
    menu.innerHTML = html;

    // Position below cursor
    var sel = window.getSelection();
    if (sel.rangeCount > 0) {
      var rect = sel.getRangeAt(0).getBoundingClientRect();
      var editable = document.getElementById('blogBodyEditable');
      var edRect = editable ? editable.getBoundingClientRect() : { left: 0, top: 0 };
      menu.style.left = Math.max(0, rect.left - edRect.left) + 'px';
      menu.style.top = (rect.bottom - edRect.top + 4) + 'px';
    }

    var editable = document.getElementById('blogBodyEditable');
    if (editable) editable.parentNode.style.position = 'relative';
    if (editable) editable.parentNode.appendChild(menu);
  }

  function blogHideSlashMenu() {
    blogSlashActive = false;
    blogSlashQuery = '';
    blogSlashIndex = 0;
    var menu = document.getElementById('blogSlashMenu');
    if (menu) menu.remove();
  }

  function blogDeleteSlashText() {
    // Delete the /query text
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    var node = range.startContainer;
    if (node.nodeType === 3) {
      var text = node.textContent;
      var pos = range.startOffset;
      // Find the / before cursor
      var slashPos = text.lastIndexOf('/', pos);
      if (slashPos >= 0) {
        node.textContent = text.substring(0, slashPos) + text.substring(pos);
        range.setStart(node, slashPos);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  function blogExecuteSlashCommand(idx) {
    var filtered = blogFilterSlashCommands();
    var cmd = filtered[idx];
    if (!cmd) return;
    blogDeleteSlashText();
    blogHideSlashMenu();
    cmd.cmd();
  }

  // Keydown handler for slash commands
  function blogHandleKeydown(e) {
    if (blogSlashActive) {
      var filtered = blogFilterSlashCommands();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        blogSlashIndex = Math.min(blogSlashIndex + 1, filtered.length - 1);
        blogShowSlashMenu();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        blogSlashIndex = Math.max(blogSlashIndex - 1, 0);
        blogShowSlashMenu();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        blogExecuteSlashCommand(blogSlashIndex);
        return;
      }
      if (e.key === 'Escape' || e.key === ' ') {
        blogHideSlashMenu();
        return;
      }
      if (e.key === 'Backspace') {
        if (blogSlashQuery.length === 0) {
          blogHideSlashMenu();
        } else {
          blogSlashQuery = blogSlashQuery.slice(0, -1);
          blogSlashIndex = 0;
          setTimeout(blogShowSlashMenu, 0);
        }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        blogSlashQuery += e.key;
        blogSlashIndex = 0;
        setTimeout(blogShowSlashMenu, 0);
        return;
      }
    }

    // Detect / at start of empty block
    if (e.key === '/') {
      var sel = window.getSelection();
      if (sel.rangeCount > 0) {
        var node = sel.anchorNode;
        var text = node ? (node.textContent || '') : '';
        var offset = sel.anchorOffset;
        // Check if line is empty or cursor is at start
        if (text.trim() === '' || offset === 0) {
          blogSlashActive = true;
          blogSlashQuery = '';
          blogSlashIndex = 0;
          setTimeout(blogShowSlashMenu, 10);
        }
      }
    }
  }

  // Attach keydown listener when editor exists
  document.addEventListener('keydown', function(e) {
    var editable = document.getElementById('blogBodyEditable');
    if (!editable) return;
    if (!editable.contains(document.activeElement) && document.activeElement !== editable) return;
    blogHandleKeydown(e);
  });

  // Close slash menu on click outside
  document.addEventListener('mousedown', function(e) {
    if (blogSlashActive && !e.target.closest('.blog-slash-menu')) {
      blogHideSlashMenu();
    }
  });

  var blogEmojiCategories = {
    'Smileys': ['\ud83d\ude0a','\ud83d\ude02','\ud83e\udd70','\ud83d\ude0d','\ud83d\ude0e','\ud83e\udd29','\ud83d\ude22','\ud83d\ude2d','\ud83e\udd7a','\ud83d\ude2e','\ud83e\udd14','\ud83d\ude4f','\ud83d\udc4f','\ud83c\udf89','\u2764\ufe0f','\ud83d\udd25','\u2728','\ud83d\udcab','\u2b50','\ud83c\udf1f','\ud83d\udcaa','\ud83d\udc4d','\ud83d\udc4b','\ud83e\udd17','\ud83d\ude07','\ud83e\udd73','\ud83d\udc80','\ud83d\ude31','\ud83e\udd2f','\ud83d\udcaf'],
    'Nature': ['\ud83c\udf38','\ud83c\udf3a','\ud83c\udf3b','\ud83c\udf39','\ud83c\udf37','\ud83c\udf3f','\ud83c\udf43','\ud83c\udf42','\ud83c\udf0a','\u2600\ufe0f','\ud83c\udf19','\u26c5','\ud83e\udd8b','\ud83d\udc1d','\ud83d\udc1a','\ud83c\udf08','\ud83d\udc90','\ud83e\udebb','\ud83c\udf3e','\ud83c\udf41','\ud83e\udeb8','\ud83d\udc19','\ud83d\udc1f','\ud83d\udc2c','\ud83e\uddad','\ud83d\udc22','\ud83e\udebc','\ud83c\udf05','\ud83c\udfd4\ufe0f','\ud83c\udf32'],
    'Art': ['\ud83c\udfa8','\ud83d\uddbc\ufe0f','\u270f\ufe0f','\ud83d\udd8c\ufe0f','\ud83d\udc8e','\ud83e\udea9','\ud83c\udff3','\ud83e\udee7','\ud83e\uddec','\ud83e\uddf3','\ud83d\udd2e','\ud83e\udead','\ud83c\udfad','\ud83c\udfaa','\ud83d\uddff','\u26b1\ufe0f','\ud83c\udfdb\ufe0f','\ud83c\udf80','\ud83e\ude86','\ud83d\udc9d','\ud83c\udf81','\ud83d\udd6f\ufe0f','\ud83e\ude94','\ud83e\uded6','\ud83c\udf76','\ud83e\udd42','\ud83c\udf77','\ud83e\ude97','\ud83e\uddc3','\ud83d\udc8d'],
    'Symbols': ['\u2192','\u2190','\u2191','\u2193','\u2022','\u25aa','\u2605','\u2665','\u2666','\u2663','\u2660','\u2713','\u2715','\u221e','\u00a9','\u00ae','\u2122','\u00a7','\u00b6','\u2020','\u2021','\u00b0','\u2030','\u2116','\u2042','\u261e','\u261b','\u2767','\u273f','\u2740']
  };
  var blogEmojiActiveTab = 'Smileys';

  function blogToggleEmojiPicker() {
    var picker = document.getElementById('blogEmojiPicker');
    if (!picker) return;
    if (picker.style.display === 'none') {
      var sel = window.getSelection();
      if (sel.rangeCount > 0) window._blogSavedRange = sel.getRangeAt(0).cloneRange();
      blogRenderEmojiPicker();
      picker.style.display = 'block';
    } else {
      picker.style.display = 'none';
    }
  }

  function blogRenderEmojiPicker() {
    var picker = document.getElementById('blogEmojiPicker');
    if (!picker) return;
    var html = '<div class="emoji-tabs">';
    var catKeys = Object.keys(blogEmojiCategories);
    var tabEmojis = { 'Smileys': '\ud83d\ude0a', 'Nature': '\ud83c\udf3f', 'Art': '\ud83c\udfa8', 'Symbols': '\u2605' };
    catKeys.forEach(function(cat) {
      html += '<button class="emoji-tab' + (cat === blogEmojiActiveTab ? ' active' : '') + '" onmousedown="event.preventDefault();blogEmojiSwitchTab(\'' + cat + '\')" title="' + cat + '">' + (tabEmojis[cat] || cat[0]) + '</button>';
    });
    html += '</div><div class="emoji-grid">';
    var emojis = blogEmojiCategories[blogEmojiActiveTab] || [];
    emojis.forEach(function(e) {
      html += '<button onmousedown="event.preventDefault();blogInsertEmoji(\'' + e + '\')">' + e + '</button>';
    });
    html += '</div>';
    picker.innerHTML = html;
  }

  function blogEmojiSwitchTab(cat) {
    blogEmojiActiveTab = cat;
    blogRenderEmojiPicker();
  }

  function blogInsertEmoji(emoji) {
    var editable = document.getElementById('blogBodyEditable');
    if (!editable) return;
    editable.focus();
    if (window._blogSavedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(window._blogSavedRange);
      window._blogSavedRange = null;
    }
    document.execCommand('insertText', false, emoji);
    var picker = document.getElementById('blogEmojiPicker');
    if (picker) picker.style.display = 'none';
    blogBodyChanged();
  }

  // Close emoji picker when clicking outside
  document.addEventListener('mousedown', function(e) {
    var picker = document.getElementById('blogEmojiPicker');
    if (picker && picker.style.display !== 'none') {
      if (!e.target.closest('.blog-emoji-picker') && !e.target.closest('[title="Insert Emoji"]')) {
        picker.style.display = 'none';
      }
    }
  });

  function blogUpdateToolbarState() {
    var btnBold = document.getElementById('blogBtnBold');
    var btnItalic = document.getElementById('blogBtnItalic');
    var btnUnderline = document.getElementById('blogBtnUnderline');
    if (btnBold) btnBold.classList.toggle('active', document.queryCommandState('bold'));
    if (btnItalic) btnItalic.classList.toggle('active', document.queryCommandState('italic'));
    if (btnUnderline) btnUnderline.classList.toggle('active', document.queryCommandState('underline'));
    // Block-level formatting state
    var block = (document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, '');
    var btnH2 = document.getElementById('blogBtnH2');
    var btnH3 = document.getElementById('blogBtnH3');
    var btnQuote = document.getElementById('blogBtnQuote');
    if (btnH2) btnH2.classList.toggle('active', block === 'h2');
    if (btnH3) btnH3.classList.toggle('active', block === 'h3');
    if (btnQuote) btnQuote.classList.toggle('active', block === 'blockquote');
    // List state
    var btnUL = document.getElementById('blogBtnUL');
    var btnOL = document.getElementById('blogBtnOL');
    if (btnUL) btnUL.classList.toggle('active', document.queryCommandState('insertUnorderedList'));
    if (btnOL) btnOL.classList.toggle('active', document.queryCommandState('insertOrderedList'));
    // Link state
    var btnLink = document.getElementById('blogBtnLink');
    if (btnLink) {
      var sel = window.getSelection();
      var inLink = false;
      if (sel && sel.anchorNode) {
        var node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
        inLink = node ? !!node.closest('a') : false;
      }
      btnLink.classList.toggle('active', inLink);
    }
  }

  // Listen for selection changes to update toolbar state
  document.addEventListener('selectionchange', function() {
    var editable = document.getElementById('blogBodyEditable');
    if (!editable) return;
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editable.contains(sel.anchorNode)) {
      blogUpdateToolbarState();
    }
  });

  // ===== CRUD FUNCTIONS =====

  async function blogChangeAuthor(key) {
    if (!blogCurrentPost) return;
    blogCurrentPost.author = key;
    blogCurrentPost.updatedAt = new Date().toISOString();
    try {
      await MastDB.blog.posts.fieldRef(blogCurrentPostId, 'author').set(key);
      await MastDB.blog.posts.fieldRef(blogCurrentPostId, 'updatedAt').set(blogCurrentPost.updatedAt);
      var author = BLOG_AUTHORS[key];
      var photo = document.getElementById('blogAuthorPhoto');
      var bio = document.getElementById('blogAuthorBio');
      if (photo && author) photo.src = author.photoUrl;
      if (bio && author) bio.textContent = author.bio;
    } catch (err) { showToast('Error updating author: ' + err.message, true); }
  }

  async function blogUpdateTitle(val) {
    if (!blogCurrentPost) return;
    // W1.4: only auto-update slug if it's empty or still matches the
    // auto-generated form of the *previous* title (i.e. user hasn't customized it).
    var prevTitle = blogCurrentPost.title || '';
    var prevAutoSlug = blogSlugify(prevTitle);
    var currentSlug = blogCurrentPost.slug || '';
    var shouldAutoSlug = !currentSlug || currentSlug === prevAutoSlug;
    blogCurrentPost.title = val;
    if (shouldAutoSlug) {
      blogCurrentPost.slug = blogSlugify(val);
    }
    blogCurrentPost.updatedAt = new Date().toISOString();
    try {
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        title: val,
        slug: blogCurrentPost.slug,
        updatedAt: blogCurrentPost.updatedAt
      });
    } catch (err) { showToast('Error updating title: ' + err.message, true); }
  }

  async function blogUpdateBody(val) {
    if (!blogCurrentPost) return;
    blogCurrentPost.body = val;
    blogCurrentPost.updatedAt = new Date().toISOString();
    try {
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        body: val,
        updatedAt: blogCurrentPost.updatedAt
      });
    } catch (err) { showToast('Error updating body: ' + err.message, true); }
  }

  async function blogUpdateTags(val) {
    if (!blogCurrentPost) return;
    var tags = val.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    blogCurrentPost.tags = tags;
    blogCurrentPost.updatedAt = new Date().toISOString();
    try {
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        tags: tags,
        updatedAt: blogCurrentPost.updatedAt
      });
    } catch (err) { showToast('Error updating tags: ' + err.message, true); }
  }

  async function blogDeletePost() {
    if (!blogCurrentPost) return;
    if (!await mastConfirm('Delete this blog post? This cannot be undone.', { title: 'Delete Post', danger: true })) return;
    try {
      await MastDB.blog.posts.ref(blogCurrentPostId).remove();
      blogPosts = blogPosts.filter(function(p) { return p.id !== blogCurrentPostId; });
      showToast('Post deleted');
      blogBackToList();
    } catch (err) { showToast('Error deleting post: ' + err.message, true); }
  }

  // ===== INLINE IMAGE INSERTION =====

  function blogInsertImage() {
    var html = '<div class="modal-header">' +
      '<h3>Insert Image</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body" style="text-align:center;padding:30px;">' +
      '<p style="margin-bottom:20px;color:var(--text-secondary);">Choose how to add an image to your post:</p>' +
      '<div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">' +
      '<button class="btn btn-primary" onclick="closeModal();blogInsertFromLibrary()" style="padding:16px 24px;font-size:0.9rem;">\ud83d\udcda From Library</button>' +
      '<button class="btn btn-primary" onclick="closeModal();blogUploadFromComputer()" style="padding:16px 24px;font-size:0.9rem;">\ud83d\udcbb From Computer</button>' +
      '</div></div>';
    openModal(html);
  }

  function blogInsertFromLibrary() {
    openImagePicker(function(imageId) {
      if (!imageId || !blogCurrentPost) return;
      blogPromptCaption(imageId);
    });
  }

  function blogUploadFromComputer() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async function() {
      if (!input.files || !input.files[0]) return;
      var file = input.files[0];
      showToast('Uploading image...');
      var reader = new FileReader();
      reader.onload = async function(e) {
        try {
          var base64 = e.target.result.split(',')[1];
          var token = await auth.currentUser.getIdToken();
          var resp = await callCF('/uploadImage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ image: base64, tags: [], source: 'blog-upload' })
          });
          var result = await resp.json();
          if (!result.success) throw new Error(result.error || 'Upload failed');
          showToast('Image uploaded to library');
          blogPromptCaption(result.imageId);
        } catch (err) {
          showToast('Upload failed: ' + err.message, true);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function blogPromptCaption(imageId) {
    var imgData = imageLibrary[imageId];
    var thumbUrl = imgData ? (imgData.thumbnailUrl || imgData.url) : '';
    var html = '<div class="modal-header">' +
      '<h3>Add Caption</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body" style="text-align:center;padding:20px;">' +
      (thumbUrl ? '<img src="' + thumbUrl + '" style="max-width:200px;max-height:200px;border-radius:8px;margin-bottom:16px;" />' : '') +
      '<input type="text" id="blogCaptionInput" placeholder="Caption (optional)..." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);font-size:0.9rem;font-style:italic;" />' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="blogFinishInsertImage(\'' + imageId + '\', \'\')">Skip</button>' +
      '<button class="btn btn-primary" onclick="blogFinishInsertImage(\'' + imageId + '\', document.getElementById(\'blogCaptionInput\').value)">Add Image</button>' +
      '</div>';
    setTimeout(function() { openModal(html); }, 200);
  }

  function blogFinishInsertImage(imageId, caption) {
    closeModal();
    if (!blogCurrentPost) return;
    var inlineImages = blogCurrentPost.inlineImages || [];
    var imageNum = inlineImages.length + 1;
    var editable = document.getElementById('blogBodyEditable');

    if (editable) {
      editable.focus();
      var markerHtml = '<br><span class="blog-img-marker" contenteditable="false" data-image="' + imageNum + '">\ud83d\udcf7 Image ' + imageNum + '</span><br>';
      document.execCommand('insertHTML', false, markerHtml);
    }

    inlineImages.push({ markerId: 'image_' + imageNum, imageId: imageId, caption: caption || '' });
    blogCurrentPost.inlineImages = inlineImages;

    var body = blogSaveBodyFromEditor();
    blogCurrentPost.body = body;
    blogCurrentPost.updatedAt = new Date().toISOString();

    MastDB.blog.posts.ref(blogCurrentPostId).update({
      body: body,
      inlineImages: inlineImages,
      updatedAt: blogCurrentPost.updatedAt
    }).then(function() {
      renderBlogEditor();
    }).catch(function(err) { showToast('Error inserting image: ' + err.message, true); });
  }

  // ===== COUPON INSERT =====

  function blogInsertCoupon() {
    var allCoupons = window.coupons || {};
    var codes = Object.keys(allCoupons);
    if (codes.length === 0) {
      showToast('No coupons found. Create coupons in the Coupons tab first.', true);
      return;
    }
    // Filter to active coupons only
    var activeCodes = codes.filter(function(code) {
      return getCouponEffectiveStatus(allCoupons[code]) === 'active';
    });
    if (activeCodes.length === 0) {
      showToast('No active coupons available.', true);
      return;
    }
    var listHtml = '';
    for (var i = 0; i < activeCodes.length; i++) {
      var code = activeCodes[i];
      var c = allCoupons[code];
      var valStr = c.type === 'percent' ? c.value + '% off' : '$' + (c.value || 0).toFixed(2) + ' off';
      listHtml += '<div data-coupon-code="' + esc(code) + '" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--cream-dark,var(--cream-dark));border-radius:6px;cursor:pointer;transition:background 0.15s;" ' +
        'onmouseover="this.style.background=\'rgba(42,124,111,0.06)\'" onmouseout="this.style.background=\'transparent\'" ' +
        'onclick="blogFinishInsertCoupon(this.dataset.couponCode)">' +
        '<div><span style="font-family:monospace;font-weight:600;">' + esc(code) + '</span>' +
        (c.description ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(c.description) + '</div>' : '') +
        '</div>' +
        '<span style="color:var(--teal);font-weight:600;">' + esc(valStr) + '</span>' +
        '</div>';
    }
    var html = '<div class="modal-header"><h3>Insert Coupon</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body"><p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Select a coupon to embed in your blog post:</p>' +
      '<div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;">' + listHtml + '</div></div>';
    openModal(html);
  }

  function blogFinishInsertCoupon(code) {
    closeModal();
    if (!blogCurrentPost || !code) return;
    var allCoupons = window.coupons || {};
    var c = allCoupons[code];
    if (!c) return;
    var valStr = c.type === 'percent' ? c.value + '% off' : '$' + (c.value || 0).toFixed(2) + ' off';
    var editable = document.getElementById('blogBodyEditable');
    if (editable) {
      editable.focus();
      var markerHtml = '<br><div class="blog-coupon-marker" data-coupon-code="' + esc(code) + '" contenteditable="false" ' +
        'style="display:inline-block;padding:8px 14px;margin:4px 0;background:rgba(42,124,111,0.15);border:1px dashed var(--teal,var(--teal));border-radius:6px;font-size:0.9rem;color:inherit;cursor:default;">' +
        '\uD83C\uDFF7\uFE0F ' + esc(code) + ' \u2014 ' + esc(valStr) +
        '</div><br>';
      document.execCommand('insertHTML', false, markerHtml);
    }
    // Save
    var body = blogSaveBodyFromEditor();
    blogCurrentPost.body = body;
    blogCurrentPost.updatedAt = new Date().toISOString();
    MastDB.blog.posts.ref(blogCurrentPostId).update({
      body: body,
      updatedAt: blogCurrentPost.updatedAt
    }).catch(function(err) { showToast('Error inserting coupon: ' + err.message, true); });
  }

  // Make functions accessible from modal onclick
  window.blogInsertCoupon = blogInsertCoupon;
  window.blogFinishInsertCoupon = blogFinishInsertCoupon;

  function blogEditCaption(idx) {
    if (!blogCurrentPost) return;
    var inlineImages = blogCurrentPost.inlineImages || [];
    if (idx < 0 || idx >= inlineImages.length) return;
    var img = inlineImages[idx];
    var imgData = imageLibrary[img.imageId];
    var thumbUrl = imgData ? (imgData.thumbnailUrl || imgData.url) : '';
    var html = '<div class="modal-header">' +
      '<h3>Edit Caption \u2014 Image ' + (idx + 1) + '</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body" style="text-align:center;padding:20px;">' +
      (thumbUrl ? '<img src="' + thumbUrl + '" style="max-width:200px;max-height:200px;border-radius:8px;margin-bottom:16px;" />' : '') +
      '<input type="text" id="blogCaptionEditInput" value="' + escapeHtml(img.caption || '') + '" placeholder="Caption..." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);font-size:0.9rem;font-style:italic;" />' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="blogSaveCaption(' + idx + ', document.getElementById(\'blogCaptionEditInput\').value)">Save</button>' +
      '</div>';
    openModal(html);
  }

  async function blogSaveCaption(idx, caption) {
    closeModal();
    if (!blogCurrentPost) return;
    var inlineImages = blogCurrentPost.inlineImages || [];
    if (idx < 0 || idx >= inlineImages.length) return;
    inlineImages[idx].caption = caption || '';
    blogCurrentPost.inlineImages = inlineImages;
    blogCurrentPost.updatedAt = new Date().toISOString();
    try {
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        inlineImages: inlineImages,
        updatedAt: blogCurrentPost.updatedAt
      });
      renderBlogEditor();
      showToast('Caption updated');
    } catch (err) { showToast('Error saving caption: ' + err.message, true); }
  }

  async function blogMoveImage(idx, direction) {
    if (!blogCurrentPost) return;
    var inlineImages = blogCurrentPost.inlineImages || [];
    var newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= inlineImages.length) return;

    var temp = inlineImages[idx];
    inlineImages[idx] = inlineImages[newIdx];
    inlineImages[newIdx] = temp;

    blogCurrentPost.inlineImages = inlineImages;
    blogCurrentPost.updatedAt = new Date().toISOString();
    try {
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        inlineImages: inlineImages,
        updatedAt: blogCurrentPost.updatedAt
      });
      renderBlogEditor();
    } catch (err) { showToast('Error reordering images: ' + err.message, true); }
  }

  async function blogRemoveInlineImage(idx) {
    if (!blogCurrentPost) return;
    var inlineImages = blogCurrentPost.inlineImages || [];
    if (idx < 0 || idx >= inlineImages.length) return;
    var totalBefore = inlineImages.length;

    var editable = document.getElementById('blogBodyEditable');
    if (editable) {
      blogCurrentPost.body = blogSaveBodyFromEditor();
    }
    var body = blogCurrentPost.body || '';

    body = body.replace(new RegExp('<span[^>]*data-image="' + (idx + 1) + '"[^>]*>[^<]*</span>', 'gi'), '');
    body = body.replace(new RegExp('\\[Image ' + (idx + 1) + '\\]', 'g'), '');
    var marker = inlineImages[idx].markerId;
    body = body.replace(new RegExp('\\[IMG:' + marker + '\\]', 'g'), '');

    inlineImages.splice(idx, 1);

    for (var n = idx + 2; n <= totalBefore; n++) {
      body = body.replace('[Image ' + n + ']', '[Image ' + (n - 1) + ']');
      body = body.replace(new RegExp('data-image="' + n + '"', 'g'), 'data-image="' + (n - 1) + '"');
    }

    blogCurrentPost.body = body;
    blogCurrentPost.inlineImages = inlineImages;
    blogCurrentPost.updatedAt = new Date().toISOString();
    try {
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        body: body,
        inlineImages: inlineImages,
        updatedAt: blogCurrentPost.updatedAt
      });
      renderBlogEditor();
    } catch (err) { showToast('Error removing image: ' + err.message, true); }
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

  // ===== PREVIEW + TAG SUGGESTIONS =====

  function blogTogglePreview() {
    blogShowPreview = !blogShowPreview;
    renderBlogEditor();
  }

  async function blogSuggestTags() {
    var editable = document.getElementById('blogBodyEditable');
    if (editable) blogCurrentPost.body = blogSaveBodyFromEditor();
    if (!blogCurrentPost || !blogCurrentPost.body) { showToast('Write some content first', true); return; }
    var btn = document.getElementById('blogSuggestTagsBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Thinking...'; }
    try {
      var tempDiv = document.createElement('div');
      tempDiv.innerHTML = blogCurrentPost.body || '';
      var cleanBody = (tempDiv.textContent || tempDiv.innerText || '').replace(/\[Image \d+\]/g, '').replace(/\[IMG:[^\]]+\]/g, '').trim();
      var result = await firebase.functions().httpsCallable('socialAI')({
        action: 'suggestBlogTags',
        tenantId: MastDB.tenantId(),
        body: cleanBody,
        title: blogCurrentPost.title || ''
      });
      var suggestedTags = result.data.tags || [];
      if (suggestedTags.length > 0) {
        var existing = blogCurrentPost.tags || [];
        var merged = existing.slice();
        suggestedTags.forEach(function(t) {
          if (merged.indexOf(t) === -1) merged.push(t);
        });
        blogCurrentPost.tags = merged;
        blogCurrentPost.updatedAt = new Date().toISOString();
        await MastDB.blog.posts.ref(blogCurrentPostId).update({
          tags: merged,
          updatedAt: blogCurrentPost.updatedAt
        });
        renderBlogEditor();
        showToast('Tags suggested: ' + suggestedTags.join(', '));
      } else {
        showToast('No tag suggestions generated');
      }
    } catch (err) {
      showToast('Tag suggestion failed: ' + err.message, true);
    }
    if (btn) { btn.disabled = false; btn.textContent = '\ud83d\udca1 Suggest'; }
  }

  // ===== AI POLISH =====

  async function blogPolishWithAI() {
    if (!blogCurrentPost || !blogCurrentPost.body) { showToast('Write some content first before polishing', true); return; }
    var editable = document.getElementById('blogBodyEditable');
    if (editable) {
      blogCurrentPost.body = blogSaveBodyFromEditor();
    }
    var btn = document.getElementById('blogPolishBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="nl-ai-loading">Polishing...</span>'; }
    try {
      var structuredBody = blogExtractStructuredText(blogCurrentPost.body || '');
      var cleanBody = structuredBody.replace(/\[Image \d+\]/g, '').replace(/\[Coupon:[^\]]+\]/g, '').trim();
      var author = BLOG_AUTHORS[blogCurrentPost.author] || BLOG_AUTHORS[Object.keys(BLOG_AUTHORS)[0]] || { name: blogCurrentPost.author || 'Author', photoUrl: '', bio: '' };
      var result = await firebase.functions().httpsCallable('socialAI')({
        action: 'blogPolish',
        tenantId: MastDB.tenantId(),
        body: cleanBody,
        authorName: author.name,
        title: blogCurrentPost.title || ''
      });
      blogAiResult = result.data.polished || cleanBody;
      renderBlogEditor();
    } catch (err) {
      showToast('AI polish failed: ' + err.message, true);
      if (btn) { btn.disabled = false; btn.innerHTML = 'Polish with AI'; }
    }
  }

  function blogDraftInClaude() {
    if (!blogCurrentPost) return;
    if (!window.MastAskAi || !window.MastAskAi.isEnabled()) {
      showToast('Configure Ask AI in Settings → AI to enable Claude drafting', true);
      return;
    }
    // Sync editable body before reading
    var editable = document.getElementById('blogBodyEditable');
    if (editable) blogCurrentPost.body = blogSaveBodyFromEditor();

    var title = (blogCurrentPost.title || '').trim();
    var existingBody = blogExtractStructuredText(blogCurrentPost.body || '')
      .replace(/\[Image \d+\]/g, '').replace(/\[Coupon:[^\]]+\]/g, '').trim();
    var tags = (blogCurrentPost.tags || []).join(', ');
    var brandName = '';
    try { brandName = (window.TENANT_CONFIG && (window.TENANT_CONFIG.brandName || window.TENANT_CONFIG.tenantName)) || ''; } catch (_e) {}

    var prompt = 'Draft a blog post' + (brandName ? ' for ' + brandName : '') + '. ' +
      'Title (working): ' + (title || '(none yet)') + '.\n' +
      (tags ? 'Tags: ' + tags + '.\n' : '') +
      (existingBody ? '\nStarting material from the author:\n' + existingBody + '\n' : '') +
      '\nRequirements:\n' +
      '- Match a warm, concrete, craft-forward voice\n' +
      '- Suggest a strong opening hook\n' +
      '- Aim for 600–900 words\n' +
      '- Use short paragraphs and clear section breaks';

    window.MastAskAi.openWithReturn({
      title: 'Blog post: ' + (title || 'Untitled'),
      prompt: prompt,
      onReturn: async function(text) {
        try {
          await blogUpdateBody(text);
          renderBlogEditor();
          showToast('Draft applied — review and edit.');
        } catch (err) {
          console.error('Blog draft apply error:', err);
          showToast('Draft saved locally — sync error: ' + (err && err.message ? err.message : 'unknown'), true);
        }
      }
    });
  }

  async function blogPickVersion(version) {
    if (!blogCurrentPost) return;
    if (version === 'ai' && blogAiResult) {
      var aiHtml = blogStructuredTextToHtml(blogAiResult);
      // Re-append image placeholders if not already in the polished text
      var images = blogCurrentPost.inlineImages || [];
      images.forEach(function(img, idx) {
        var marker = '[Image ' + (idx + 1) + ']';
        if (aiHtml.indexOf(marker) === -1) aiHtml += '<p>' + marker + '</p>';
      });
      blogCurrentPost.body = aiHtml;
      blogCurrentPost.aiVersion = blogAiResult;
      blogCurrentPost.usedAI = true;
    }
    blogCurrentPost.updatedAt = new Date().toISOString();
    blogAiResult = null;
    try {
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        body: blogCurrentPost.body,
        aiVersion: blogCurrentPost.aiVersion || '',
        usedAI: blogCurrentPost.usedAI || false,
        updatedAt: blogCurrentPost.updatedAt
      });
      renderBlogEditor();
      showToast(version === 'ai' ? 'Polished version applied' : 'Original kept');
    } catch (err) { showToast('Error saving version: ' + err.message, true); }
  }

  // ===== STATUS TRANSITIONS =====

  async function blogMarkComplete() {
    if (!blogCurrentPost) return;
    var editable = document.getElementById('blogBodyEditable');
    if (editable) blogCurrentPost.body = blogSaveBodyFromEditor();
    blogCurrentPost.status = 'complete';
    blogCurrentPost.updatedAt = new Date().toISOString();
    try {
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        status: 'complete',
        body: blogCurrentPost.body,
        updatedAt: blogCurrentPost.updatedAt
      });
      renderBlogEditor();
      showToast('Post marked as complete');
    } catch (err) { showToast('Error: ' + err.message, true); }
  }

  async function blogBackToDraft() {
    if (!blogCurrentPost) return;
    blogCurrentPost.status = 'draft';
    blogCurrentPost.updatedAt = new Date().toISOString();
    try {
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        status: 'draft',
        updatedAt: blogCurrentPost.updatedAt
      });
      renderBlogEditor();
      showToast('Post returned to draft');
    } catch (err) { showToast('Error: ' + err.message, true); }
  }

  // ===== PUBLISH DIALOG =====

  // ===== FEATURED IMAGE =====

  function blogSetFeaturedImage() {
    openImagePicker(function(imageId) {
      if (!blogCurrentPost || !imageId) return;
      blogCurrentPost.featuredImageId = imageId;
      blogCurrentPost.updatedAt = new Date().toISOString();
      MastDB.blog.posts.ref(blogCurrentPostId).update({
        featuredImageId: imageId,
        updatedAt: blogCurrentPost.updatedAt
      }).then(function() { renderBlogEditor(); })
        .catch(function(err) { showToast('Error setting featured image: ' + err.message, true); });
    });
  }

  // Change the photo for the post's current author. If the author key is
  // a real admin user (uid in adminUsers OR the current auth user), the
  // photo persists to admin/users/{uid}/profile/photoUrl — the canonical
  // store. Otherwise (brand fictional authors), falls back to the legacy
  // public/config/brand/authors/{key}/photoUrl path for backward compat.
  function blogChangeAuthorPhoto() {
    if (!blogCurrentPost) return;
    var key = blogCurrentPost.author || Object.keys(BLOG_AUTHORS)[0];
    if (!key) { showToast('No author selected for this post.', true); return; }
    var isRealUser = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid === key)
      || (window.adminUsers && window.adminUsers[key]);
    openImagePicker(function(imgId, url, thumbnailUrl) {
      if (!url && !thumbnailUrl) return;
      var photoUrl = url || thumbnailUrl;
      var savePromise = isRealUser
        ? MastDB.set('admin/users/' + key + '/profile/photoUrl', photoUrl)
        : MastDB.set('public/config/brand/authors/' + key + '/photoUrl', photoUrl);
      savePromise.then(function() {
        if (!BLOG_AUTHORS[key]) BLOG_AUTHORS[key] = { name: key, photoUrl: '', bio: '' };
        BLOG_AUTHORS[key].photoUrl = photoUrl;
        if (isRealUser) {
          // Invalidate the shared profile cache so other surfaces (header
          // avatar, future operator-attribution displays) pick up the new
          // photo on next read.
          if (typeof window.invalidateUserProfileCache === 'function') {
            window.invalidateUserProfileCache(key);
          }
          // If editing self, refresh the header avatar immediately.
          if (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid === key) {
            var av = document.getElementById('userAvatar');
            if (av) av.src = photoUrl;
          }
        } else {
          // Legacy brand-author path: mirror onto TENANT_CONFIG so any later
          // reads from that path pick it up without reload.
          try {
            if (window.TENANT_CONFIG && TENANT_CONFIG.brand) {
              TENANT_CONFIG.brand.authors = TENANT_CONFIG.brand.authors || {};
              TENANT_CONFIG.brand.authors[key] = TENANT_CONFIG.brand.authors[key] || {};
              TENANT_CONFIG.brand.authors[key].photoUrl = photoUrl;
            }
          } catch (e) {}
        }
        showToast('Author photo updated.');
        renderBlogEditor();
      }).catch(function(err) { showToast('Error saving author photo: ' + err.message, true); });
    });
  }

  function blogRemoveFeaturedImage() {
    if (!blogCurrentPost) return;
    blogCurrentPost.featuredImageId = null;
    blogCurrentPost.updatedAt = new Date().toISOString();
    MastDB.blog.posts.ref(blogCurrentPostId).update({
      featuredImageId: null,
      updatedAt: blogCurrentPost.updatedAt
    }).then(function() { renderBlogEditor(); })
      .catch(function(err) { showToast('Error removing featured image: ' + err.message, true); });
  }

  // ===== EXCERPT =====

  function blogUpdateExcerpt(val) {
    if (!blogCurrentPost) return;
    blogCurrentPost.excerpt = val;
    blogCurrentPost.updatedAt = new Date().toISOString();
    MastDB.blog.posts.ref(blogCurrentPostId).update({
      excerpt: val,
      updatedAt: blogCurrentPost.updatedAt
    }).catch(function(err) { showToast('Error saving excerpt: ' + err.message, true); });
  }

  function blogUpdateExcerptCount(val) {
    var el = document.getElementById('blogExcerptCount');
    if (el) el.textContent = val.length + '/300';
  }

  // ===== W1.4 SEO FIELDS =====

  function blogSlugify(str) {
    return String(str || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
  }

  // Backfill slug + metaDescription on first edit of an existing post that
  // doesn't have them yet. Pure client-side, fire-and-forget.
  function blogBackfillSeoDefaults(post) {
    if (!post || post._seoBackfilled) return;
    var updates = {};
    if (!post.slug && post.title) {
      updates.slug = blogSlugify(post.title);
      post.slug = updates.slug;
    }
    if (!post.metaDescription && post.excerpt) {
      updates.metaDescription = String(post.excerpt).slice(0, 200);
      post.metaDescription = updates.metaDescription;
    }
    post._seoBackfilled = true;
    if (Object.keys(updates).length === 0) return;
    updates.updatedAt = new Date().toISOString();
    post.updatedAt = updates.updatedAt;
    try {
      MastDB.blog.posts.ref(post.id).update(updates).catch(function() {});
    } catch (_e) {}
  }

  function blogUpdateSlug(val) {
    if (!blogCurrentPost) return;
    var clean = blogSlugify(val);
    blogCurrentPost.slug = clean;
    blogCurrentPost.updatedAt = new Date().toISOString();
    MastDB.blog.posts.ref(blogCurrentPostId).update({
      slug: clean,
      updatedAt: blogCurrentPost.updatedAt
    }).catch(function(err) { showToast('Error saving slug: ' + err.message, true); });
  }

  function blogUpdateMetaDescription(val) {
    if (!blogCurrentPost) return;
    var clean = String(val || '').slice(0, 200);
    blogCurrentPost.metaDescription = clean;
    blogCurrentPost.updatedAt = new Date().toISOString();
    MastDB.blog.posts.ref(blogCurrentPostId).update({
      metaDescription: clean,
      updatedAt: blogCurrentPost.updatedAt
    }).catch(function(err) { showToast('Error saving meta description: ' + err.message, true); });
  }

  function blogUpdateCanonical(val) {
    if (!blogCurrentPost) return;
    var clean = String(val || '').trim();
    // Light validation — only persist plausible URLs or empty.
    if (clean && !/^https?:\/\//i.test(clean)) {
      showToast('Canonical URL must start with http:// or https://', true);
      return;
    }
    blogCurrentPost.canonical = clean;
    blogCurrentPost.updatedAt = new Date().toISOString();
    MastDB.blog.posts.ref(blogCurrentPostId).update({
      canonical: clean || null,
      updatedAt: blogCurrentPost.updatedAt
    }).catch(function(err) { showToast('Error saving canonical: ' + err.message, true); });
  }

  function blogUpdateOgImage(val) {
    if (!blogCurrentPost) return;
    var clean = String(val || '').trim();
    if (clean && !/^https?:\/\//i.test(clean)) {
      showToast('OG image URL must start with http:// or https://', true);
      return;
    }
    blogCurrentPost.ogImage = clean;
    blogCurrentPost.updatedAt = new Date().toISOString();
    MastDB.blog.posts.ref(blogCurrentPostId).update({
      ogImage: clean || null,
      updatedAt: blogCurrentPost.updatedAt
    }).catch(function(err) { showToast('Error saving OG image: ' + err.message, true); });
  }

  function blogUpdateSchemaType(val) {
    if (!blogCurrentPost) return;
    var clean = (val === 'Article') ? 'Article' : 'BlogPosting';
    blogCurrentPost.schemaType = clean;
    blogCurrentPost.updatedAt = new Date().toISOString();
    MastDB.blog.posts.ref(blogCurrentPostId).update({
      schemaType: clean,
      updatedAt: blogCurrentPost.updatedAt
    }).catch(function(err) { showToast('Error saving schema type: ' + err.message, true); });
  }

  // ===== SCHEDULED PUBLISHING =====

  function blogCheckScheduledPosts() {
    var now = new Date().toISOString();
    blogPosts.forEach(function(post) {
      if (post.status === 'scheduled' && post.scheduledAt && post.scheduledAt <= now) {
        blogCurrentPostId = post.id;
        blogCurrentPost = post;
        blogPublishToWebsite().then(function() {
          showToast('Scheduled post "' + (post.title || 'Untitled') + '" published automatically');
        });
      }
    });
  }

  function blogCancelSchedule() {
    if (!blogCurrentPost) return;
    blogCurrentPost.status = 'complete';
    blogCurrentPost.scheduledAt = null;
    blogCurrentPost.updatedAt = new Date().toISOString();
    MastDB.blog.posts.ref(blogCurrentPostId).update({
      status: 'complete',
      scheduledAt: null,
      updatedAt: blogCurrentPost.updatedAt
    }).then(function() {
      renderBlogEditor();
      showToast('Schedule cancelled');
    }).catch(function(err) { showToast('Error cancelling schedule: ' + err.message, true); });
  }

  function blogOpenPublishDialog() {
    if (!blogCurrentPost) return;
    var html = '<div class="modal-header"><h3>Publish Post</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body">' +
      '<p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:16px;">Publishing: <strong>' + escapeHtml(blogCurrentPost.title || 'Untitled Post') + '</strong></p>' +
      '<div class="blog-publish-platform enabled" onclick="document.getElementById(\'publishWebsite\').checked=!document.getElementById(\'publishWebsite\').checked">' +
      '<span class="platform-icon">\ud83c\udf10</span>' +
      '<div class="platform-info"><div class="platform-name">Website</div>' +
      '<div class="platform-status">Publish to your public blog page</div></div>' +
      '<span class="status-badge pill" style="background:#16a34a;color:#fff;">Ready</span>' +
      '<input type="checkbox" id="publishWebsite" class="platform-check" checked onclick="event.stopPropagation()" />' +
      '</div>' +
      '<div class="blog-publish-platform disabled">' +
      '<span class="platform-icon">\ud83d\udce7</span>' +
      '<div class="platform-info"><div class="platform-name">Substack</div>' +
      '<div class="platform-status">Send as Substack newsletter draft</div></div>' +
      '<span class="status-badge pill" style="background:#9ca3af;color:#fff;">Coming Soon</span>' +
      '<input type="checkbox" class="platform-check" disabled />' +
      '</div>' +
      '</div>' +
      '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">' +
      '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9rem;">' +
      '<input type="radio" name="blogPublishTiming" value="now" checked onchange="document.getElementById(\'blogScheduleRow\').style.display=\'none\';document.getElementById(\'blogPublishBtn2\').textContent=\'\ud83d\udce4 Publish\'" /> Publish now' +
      '</label>' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9rem;">' +
      '<input type="radio" name="blogPublishTiming" value="schedule" onchange="document.getElementById(\'blogScheduleRow\').style.display=\'flex\';document.getElementById(\'blogPublishBtn2\').textContent=\'\ud83d\udcc5 Schedule\'" /> Schedule for later' +
      '</label>' +
      '</div>' +
      '<div id="blogScheduleRow" style="display:none;margin-top:10px;align-items:center;gap:8px;">' +
      '<input type="datetime-local" id="blogScheduleDate" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);font-size:0.85rem;" />' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" id="blogPublishBtn2" onclick="blogPublishSelected()">\ud83d\udce4 Publish</button>' +
      '</div>';
    openModal(html);
    // Set min date to now
    var dateInput = document.getElementById('blogScheduleDate');
    if (dateInput) {
      var now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      dateInput.min = now.toISOString().slice(0, 16);
    }
  }

  async function blogPublishSelected() {
    var websiteChecked = document.getElementById('publishWebsite');
    if (!websiteChecked || !websiteChecked.checked) {
      showToast('Select at least one platform', true);
      return;
    }
    // Check if scheduling
    var timing = document.querySelector('input[name="blogPublishTiming"]:checked');
    if (timing && timing.value === 'schedule') {
      var dateInput = document.getElementById('blogScheduleDate');
      if (!dateInput || !dateInput.value) {
        showToast('Please select a date and time', true);
        return;
      }
      var scheduledAt = new Date(dateInput.value).toISOString();
      if (scheduledAt <= new Date().toISOString()) {
        showToast('Scheduled time must be in the future', true);
        return;
      }
      closeModal();
      // Save body from editor if open
      var editable = document.getElementById('blogBodyEditable');
      if (editable) blogCurrentPost.body = blogSaveBodyFromEditor();
      blogCurrentPost.status = 'scheduled';
      blogCurrentPost.scheduledAt = scheduledAt;
      blogCurrentPost.updatedAt = new Date().toISOString();
      try {
        await MastDB.blog.posts.ref(blogCurrentPostId).update({
          status: 'scheduled',
          scheduledAt: scheduledAt,
          updatedAt: blogCurrentPost.updatedAt
        });
        renderBlogEditor();
        var schedStr = new Date(scheduledAt).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
        showToast('Post scheduled for ' + schedStr + ' \ud83d\udcc5');
      } catch (err) { showToast('Schedule failed: ' + err.message, true); }
      return;
    }
    // Publish now
    await blogPublishToWebsite();
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
    var author = BLOG_AUTHORS[post.author] || BLOG_AUTHORS[Object.keys(BLOG_AUTHORS)[0]] || { name: post.author || 'Author', photoUrl: '', bio: '' };
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

  async function blogPublishToWebsite() {
    if (!blogCurrentPost) return;
    closeModal();
    var editable = document.getElementById('blogBodyEditable');
    if (editable) blogCurrentPost.body = blogSaveBodyFromEditor();
    try {
      await _blogPublishPostToWebsite(blogCurrentPost);
      renderBlogEditor();
      showToast('Published to website! \ud83c\udf10');
    } catch (err) {
      showToast('Publish failed: ' + err.message, true);
    }
  }

  async function blogUnpublishFromWebsite() {
    if (!blogCurrentPost) return;
    try {
      await _blogUnpublishPost(blogCurrentPostId);
      renderBlogEditor();
      showToast('Unpublished from website');
    } catch (err) {
      showToast('Unpublish failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Expose functions to window for onclick handlers in HTML
  // ============================================================

  window.blogCreatePost = blogCreatePost;
  window.clearBlogFilter = function() {
    var p = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var next = {};
    var DROP = { status: 1, dateFrom: 1, dateTo: 1, postIds: 1 };
    Object.keys(p).forEach(function(k) { if (!DROP[k]) next[k] = p[k]; });
    if (typeof navigateTo === 'function') navigateTo('blog', next);
  };
  window.blogOpenPost = blogOpenPost;
  window.blogDeletePost = blogDeletePost;
  window.blogBackToList = blogBackToList;
  window.blogAddIdea = blogAddIdea;
  window.blogDeleteIdea = blogDeleteIdea;
  window.blogStartFromIdea = blogStartFromIdea;
  window.blogChangeAuthor = blogChangeAuthor;
  window.blogUpdateTitle = blogUpdateTitle;
  window.blogUpdateBody = blogUpdateBody;
  window.blogUpdateTags = blogUpdateTags;
  window.blogSuggestTags = blogSuggestTags;
  window.blogFormatCmd = blogFormatCmd;
  window.blogFormatFont = blogFormatFont;
  window.blogFormatSize = blogFormatSize;
  window.blogFormatBlock = blogFormatBlock;
  window.blogInsertLink = blogInsertLink;
  window.blogApplyLink = blogApplyLink;
  window.blogRemoveLink = blogRemoveLink;
  window.blogSetFeaturedImage = blogSetFeaturedImage;
  window.blogChangeAuthorPhoto = blogChangeAuthorPhoto;
  window.blogRemoveFeaturedImage = blogRemoveFeaturedImage;
  window.blogUpdateExcerpt = blogUpdateExcerpt;
  window.blogUpdateExcerptCount = blogUpdateExcerptCount;
  window.blogUpdateSlug = blogUpdateSlug;
  window.blogUpdateMetaDescription = blogUpdateMetaDescription;
  window.blogUpdateCanonical = blogUpdateCanonical;
  window.blogUpdateOgImage = blogUpdateOgImage;
  window.blogUpdateSchemaType = blogUpdateSchemaType;
  window.blogCancelSchedule = blogCancelSchedule;
  window.blogExecuteSlashCommand = blogExecuteSlashCommand;
  window.blogToggleEmojiPicker = blogToggleEmojiPicker;
  window.blogEmojiSwitchTab = blogEmojiSwitchTab;
  window.blogInsertEmoji = blogInsertEmoji;
  window.blogInsertImage = blogInsertImage;
  window.blogInsertFromLibrary = blogInsertFromLibrary;
  window.blogUploadFromComputer = blogUploadFromComputer;
  window.blogPromptCaption = blogPromptCaption;
  window.blogFinishInsertImage = blogFinishInsertImage;
  window.blogEditCaption = blogEditCaption;
  window.blogSaveCaption = blogSaveCaption;
  window.blogMoveImage = blogMoveImage;
  window.blogRemoveInlineImage = blogRemoveInlineImage;
  window.blogTogglePreview = blogTogglePreview;
  window.blogPolishWithAI = blogPolishWithAI;
  window.blogDraftInClaude = blogDraftInClaude;
  window.blogPickVersion = blogPickVersion;
  window.blogMarkComplete = blogMarkComplete;
  window.blogBackToDraft = blogBackToDraft;
  window.blogOpenPublishDialog = blogOpenPublishDialog;
  window.blogPublishSelected = blogPublishSelected;
  window.blogBodyChanged = blogBodyChanged;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  // MastNavStack restorer for blog route — re-opens a post on pop.
  if (window.MastNavStack) {
    window.MastNavStack.registerRestorer('blog', function(view, state) {
      if (view !== 'detail' || !state || !state.postId) return;
      var openIt = function() {
        if (typeof blogEditPost === 'function') blogEditPost(state.postId);
      };
      setTimeout(openIt, 100);
    });
  }

  // ============================================================
  // W2.2 / W2.6 — Composer + Campaigns hooks
  // ============================================================
  //
  // blogOpenFromContent(contentId) — fetches a Content doc from
  // tenants/{tid}/admin/content/{contentId} and prefills the blog editor
  // with its title/body. Called by the Composer when "Blog post" channel is
  // selected at publish time.
  //
  // blogAddCurrentToCampaign() — opens the global campaign picker (lazy-
  // loads the campaigns module if needed) for the currently-open blog post.
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
    }
  };

  function blogAddCurrentToCampaign() {
    if (!blogCurrentPostId) return;
    if (typeof window.openAddToCampaignPicker === 'function') {
      window.openAddToCampaignPicker('blog', blogCurrentPostId);
    } else if (typeof MastAdmin !== 'undefined' && MastAdmin.loadModule) {
      MastAdmin.loadModule('campaigns').then(function() {
        if (typeof window.openAddToCampaignPicker === 'function') {
          window.openAddToCampaignPicker('blog', blogCurrentPostId);
        }
      });
    }
  }
  window.blogAddCurrentToCampaign = blogAddCurrentToCampaign;

  MastAdmin.registerModule('blog', {
    routes: {
      'blog': { tab: 'blogTab', setup: function() { if (!blogLoaded) loadBlog(); else renderBlog(); } }
    }
  });

})();
