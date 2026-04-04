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
    var colors = { draft: 'background:rgba(196,133,60,0.15);color:var(--amber)', complete: 'background:rgba(42,124,111,0.15);color:var(--teal)', posted: 'background:#16a34a;color:#fff', published: 'background:#16a34a;color:#fff' };
    return '<span class="status-badge pill" style="' + (colors[s] || colors.draft) + '">' + s + '</span>';
  }

  function loadBlogAuthors() {
    if (TENANT_CONFIG && TENANT_CONFIG.brand && TENANT_CONFIG.brand.authors) {
      BLOG_AUTHORS = TENANT_CONFIG.brand.authors;
    }
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

      var ideaSnap = await MastDB.blog.ideas.ref().orderByChild('createdAt').limitToLast(50).once('value');
      var ideaVal = ideaSnap.val();
      blogIdeas = ideaVal ? Object.values(ideaVal).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); }) : [];

      blogLoaded = true;
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
    var html = '<div class="blog-header"><h2>Blog Posts</h2>' +
      '<button class="btn btn-primary" onclick="blogCreatePost()">+ New Post</button></div>';

    if (blogPosts.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:2rem;margin-bottom:12px;">\u270d\ufe0f</div>' +
        '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No blog posts yet</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Write your first post to share your voice as an artist.</p></div>';
    } else {
      blogPosts.forEach(function(post) {
        var author = BLOG_AUTHORS[post.author] || BLOG_AUTHORS[Object.keys(BLOG_AUTHORS)[0]] || { name: post.author || 'Author', photoUrl: '', bio: '' };
        var dateStr = post.createdAt ? new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        html += '<div class="blog-post-row" onclick="blogOpenPost(\'' + post.id + '\')">' +
          '<img class="blog-avatar" src="' + esc(author.photoUrl) + '" alt="' + esc(author.name) + '" />' +
          '<span class="blog-post-title">' + esc(post.title || 'Untitled Post') + '</span>' +
          '<span class="blog-post-author">' + esc(author.name) + '</span>' +
          blogBadgeHtml(post.status) +
          (post.publishedToWebsite ? '<span style="font-size:0.75rem;" title="Published to website">\ud83c\udf10</span>' : '') +
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
        author: Object.keys(BLOG_AUTHORS)[0] || 'author',
        body: '',
        aiVersion: '',
        usedAI: false,
        status: 'draft',
        inlineImages: [],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedAt: null,
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
      // Actions bar even in preview
      html += '<div class="blog-actions" style="max-width:680px;margin:16px auto 0;">';
      if (status === 'draft') {
        html += '<button class="btn" onclick="blogPolishWithAI()" id="blogPolishBtn">\u2728 Polish with AI</button>';
        html += '<button class="btn btn-primary" onclick="blogMarkComplete()">\u2705 Finish Post</button>';
      } else if (status === 'complete') {
        html += '<button class="btn" onclick="blogBackToDraft()">\u270f\ufe0f Back to Draft</button>';
        if (post.publishedToWebsite) {
          html += '<span class="status-badge pill" style="background:#16a34a;color:#fff;">\ud83c\udf10 Published</span>';
          html += '<button class="btn" onclick="blogUnpublishFromWebsite()" style="font-size:0.8rem;">Unpublish</button>';
        } else {
          html += '<button class="btn btn-primary" onclick="blogOpenPublishDialog()">\ud83d\udce4 Publish</button>';
        }
      }
      html += '</div>';
      document.getElementById('blogContent').innerHTML = html;
      return;
    }

    // Author header card
    html += '<div class="blog-author-card">' +
      '<img class="blog-author-photo" id="blogAuthorPhoto" src="' + esc(author.photoUrl) + '" alt="' + esc(author.name) + '" />' +
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
      '<button class="btn" id="blogSuggestTagsBtn" onclick="blogSuggestTags()" style="white-space:nowrap;font-size:0.8rem;padding:6px 10px;" title="AI-suggested tags based on your content">\ud83d\udca1 Suggest</button>' +
      '</div>';

    // AI compare mode or rich text editor
    if (blogAiResult) {
      html += '<div class="nl-ai-compare">' +
        '<div class="nl-ai-panel original"><div class="nl-ai-panel-label">Your Original</div>' +
        '<div style="font-size:0.9rem;line-height:1.7;">' + (blogIsHtmlBody(post.body) ? (post.body || '') : escapeHtml(post.body || '').replace(/\n/g, '<br>')) + '</div></div>' +
        '<div class="nl-ai-panel polished"><div class="nl-ai-panel-label">AI Polished</div>' +
        '<div style="white-space:pre-wrap;font-size:0.9rem;line-height:1.7;">' + escapeHtml(blogAiResult) + '</div></div>' +
        '</div>' +
        '<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;font-style:italic;">Note: AI works with text content. Formatting won\'t carry over to the polished version.</div>' +
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
        '<button class="blog-format-btn" id="blogBtnQuote" onmousedown="event.preventDefault();blogFormatBlock(\'blockquote\')" title="Blockquote" style="font-size:1.1rem;">\u201c</button>' +
        '<button class="blog-format-btn" id="blogBtnUL" onmousedown="event.preventDefault();blogFormatCmd(\'insertUnorderedList\')" title="Bullet List" style="font-size:0.9rem;">\u2022\u2261</button>' +
        '<button class="blog-format-btn" id="blogBtnOL" onmousedown="event.preventDefault();blogFormatCmd(\'insertOrderedList\')" title="Numbered List" style="font-size:0.75rem;">1.</button>' +
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
          (caption ? '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:#fff;font-size:0.6rem;padding:2px 4px;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">\ud83d\udcac</div>' : '') +
          '</div>' +
          '<div class="blog-inline-img-label">Image ' + (idx + 1) + '</div>' +
          (inlineImages.length > 1 ? '<div style="display:flex;justify-content:center;gap:2px;margin-top:2px;">' +
            '<button onclick="event.stopPropagation();blogMoveImage(' + idx + ',-1)" style="background:none;border:none;cursor:pointer;font-size:0.7rem;color:' + (isFirst ? 'var(--border)' : 'var(--text-secondary)') + ';padding:1px 4px;"' + (isFirst ? ' disabled' : '') + ' title="Move left">\u25c0</button>' +
            '<button onclick="event.stopPropagation();blogMoveImage(' + idx + ',1)" style="background:none;border:none;cursor:pointer;font-size:0.7rem;color:' + (isLast ? 'var(--border)' : 'var(--text-secondary)') + ';padding:1px 4px;"' + (isLast ? ' disabled' : '') + ' title="Move right">\u25b6</button>' +
            '</div>' : '') +
          '</div>';
      });
      html += '</div>';
    }

    // Actions bar
    html += '<div class="blog-actions">';
    if (status === 'draft') {
      html += '<button class="btn" onclick="blogPolishWithAI()" id="blogPolishBtn">\u2728 Polish with AI</button>';
      html += '<button class="btn btn-primary" onclick="blogMarkComplete()">\u2705 Finish Post</button>';
    } else if (status === 'complete') {
      html += '<button class="btn" onclick="blogBackToDraft()">\u270f\ufe0f Back to Draft</button>';
      if (post.publishedToWebsite) {
        html += '<span class="status-badge pill" style="background:#16a34a;color:#fff;">\ud83c\udf10 Published</span>';
        html += '<button class="btn" onclick="blogUnpublishFromWebsite()" style="font-size:0.8rem;">Unpublish</button>';
      } else {
        html += '<button class="btn btn-primary" onclick="blogOpenPublishDialog()">\ud83d\udce4 Publish</button>';
      }
    }
    html += '</div>';

    document.getElementById('blogContent').innerHTML = html;

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

  function blogSanitizeHtml(html) {
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    html = html.replace(/<object[\s\S]*?<\/object>/gi, '');
    html = html.replace(/<embed[\s\S]*?>/gi, '');
    html = html.replace(/\son\w+\s*=\s*(['"]?)[\s\S]*?\1/gi, '');
    html = html.replace(/javascript\s*:/gi, '');
    return html;
  }

  function blogLoadBodyToEditor(body, inlineImages) {
    if (!body) return '';
    var html = body;
    if (!blogIsHtmlBody(html)) {
      html = blogPlainToHtml(html);
    }
    html = blogSanitizeHtml(html);
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
        'style="display:inline-block;padding:8px 14px;margin:4px 0;background:rgba(42,124,111,0.15);border:1px dashed var(--teal,#2A7C6F);border-radius:6px;font-size:0.9rem;color:inherit;cursor:default;">' +
        '\uD83C\uDFF7\uFE0F ' + esc(code) + ' \u2014 ' + esc(valStr) + '</div>';
    });
    return html;
  }

  function blogSaveBodyFromEditor() {
    var editable = document.getElementById('blogBodyEditable');
    if (!editable) return blogCurrentPost ? (blogCurrentPost.body || '') : '';
    var html = editable.innerHTML || '';
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
    blogCurrentPost.title = val;
    blogCurrentPost.slug = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
      '<button class="btn btn-primary" onclick="closeModal();blogInsertFromLibrary()" style="padding:16px 24px;font-size:0.95rem;">\ud83d\udcda From Library</button>' +
      '<button class="btn btn-primary" onclick="closeModal();blogUploadFromComputer()" style="padding:16px 24px;font-size:0.95rem;">\ud83d\udcbb From Computer</button>' +
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
      listHtml += '<div data-coupon-code="' + esc(code) + '" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--cream-dark,#F0E8DB);border-radius:6px;cursor:pointer;transition:background 0.15s;" ' +
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
        'style="display:inline-block;padding:8px 14px;margin:4px 0;background:rgba(42,124,111,0.15);border:1px dashed var(--teal,#2A7C6F);border-radius:6px;font-size:0.9rem;color:inherit;cursor:default;">' +
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
      var tempDiv = document.createElement('div');
      tempDiv.innerHTML = blogCurrentPost.body || '';
      var plainText = tempDiv.textContent || tempDiv.innerText || '';
      var cleanBody = plainText.replace(/\[Image \d+\]/g, '').replace(/\[IMG:[^\]]+\]/g, '').trim();
      var author = BLOG_AUTHORS[blogCurrentPost.author] || BLOG_AUTHORS[Object.keys(BLOG_AUTHORS)[0]] || { name: blogCurrentPost.author || 'Author', photoUrl: '', bio: '' };
      var result = await firebase.functions().httpsCallable('socialAI')({
        action: 'blogPolish',
        body: cleanBody,
        authorName: author.name,
        title: blogCurrentPost.title || ''
      });
      blogAiResult = result.data.polished || cleanBody;
      renderBlogEditor();
    } catch (err) {
      showToast('AI polish failed: ' + err.message, true);
      if (btn) { btn.disabled = false; btn.innerHTML = '\u2728 Polish with AI'; }
    }
  }

  async function blogPickVersion(version) {
    if (!blogCurrentPost) return;
    if (version === 'ai' && blogAiResult) {
      var aiHtml = blogPlainToHtml(blogAiResult);
      var images = blogCurrentPost.inlineImages || [];
      images.forEach(function(img, idx) {
        aiHtml += '<p>[Image ' + (idx + 1) + ']</p>';
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
      '<div class="modal-footer">' +
      '<button class="btn" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="blogPublishSelected()">\ud83d\udce4 Publish</button>' +
      '</div>';
    openModal(html);
  }

  async function blogPublishSelected() {
    var websiteChecked = document.getElementById('publishWebsite');
    if (websiteChecked && websiteChecked.checked) {
      await blogPublishToWebsite();
    } else {
      showToast('Select at least one platform', true);
    }
  }

  async function blogPublishToWebsite() {
    if (!blogCurrentPost) return;
    closeModal();

    var editable = document.getElementById('blogBodyEditable');
    if (editable) blogCurrentPost.body = blogSaveBodyFromEditor();

    try {
      var bodyHtml = blogRenderBodyToHtml(blogCurrentPost.body || '', blogCurrentPost.inlineImages || []);
      var author = BLOG_AUTHORS[blogCurrentPost.author] || BLOG_AUTHORS[Object.keys(BLOG_AUTHORS)[0]] || { name: blogCurrentPost.author || 'Author', photoUrl: '', bio: '' };

      var slug = (blogCurrentPost.title || 'untitled').toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);

      var publishedAt = new Date().toISOString();
      var publishedData = {
        title: blogCurrentPost.title || 'Untitled',
        postNumber: blogCurrentPost.postNumber || 0,
        slug: slug,
        publishedAt: publishedAt,
        author: author.name,
        bodyHtml: bodyHtml,
        tags: blogCurrentPost.tags || []
      };

      await MastDB.blog.published.ref(blogCurrentPostId).set(publishedData);

      blogCurrentPost.publishedToWebsite = true;
      blogCurrentPost.publishedAt = publishedAt;
      blogCurrentPost.updatedAt = publishedAt;
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        publishedToWebsite: true,
        publishedAt: publishedAt,
        updatedAt: publishedAt
      });

      renderBlogEditor();
      showToast('Published to website! \ud83c\udf10');
    } catch (err) {
      showToast('Publish failed: ' + err.message, true);
    }
  }

  async function blogUnpublishFromWebsite() {
    if (!blogCurrentPost) return;
    try {
      await MastDB.blog.published.ref(blogCurrentPostId).remove();

      blogCurrentPost.publishedToWebsite = false;
      blogCurrentPost.publishedAt = null;
      blogCurrentPost.updatedAt = new Date().toISOString();
      await MastDB.blog.posts.ref(blogCurrentPostId).update({
        publishedToWebsite: false,
        publishedAt: null,
        updatedAt: blogCurrentPost.updatedAt
      });

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
  window.blogPickVersion = blogPickVersion;
  window.blogMarkComplete = blogMarkComplete;
  window.blogBackToDraft = blogBackToDraft;
  window.blogOpenPublishDialog = blogOpenPublishDialog;
  window.blogPublishSelected = blogPublishSelected;
  window.blogBodyChanged = blogBodyChanged;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('blog', {
    routes: {
      'blog': { tab: 'blogTab', setup: function() { if (!blogLoaded) loadBlog(); } }
    }
  });

})();
