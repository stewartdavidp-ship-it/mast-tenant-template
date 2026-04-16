/**
 * Social Media Module — Content Pipeline MVP
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var socialMediaLoaded = false;
  var smPendingClips = [];
  var smPosts = [];
  var smCurrentView = 'home'; // home | newPost | enhance | shootCard | staging | posted
  var smCurrentClipId = null;
  var smEnhanceData = {};

  var SM_TREATMENTS = [
    { id: 'hot-glass',       name: 'Hot Glass',       icon: '🔥', color: '#C84B31', desc: 'Kiln-lit process, close-in, material-first' },
    { id: 'finished-piece',  name: 'Finished Piece',  icon: '✦',  color: '#4A90A4', desc: 'Clean background, product-forward' },
    { id: 'studio-life',     name: 'Studio Life',     icon: '◉',  color: '#2C2C2C', desc: 'Candid, behind the scenes' },
    { id: 'fair-day',        name: 'Fair Day',        icon: '◈',  color: '#8B6F5E', desc: 'Event context, crowd energy' },
    { id: 'process-story',   name: 'Process Story',   icon: '◇',  color: '#5A7A5A', desc: 'Start-to-finish transformation' }
  ];

  var SM_TECH_TIPS = {
    'hot-glass':      'Portrait (9:16) · 15–30 sec · Capture the glow',
    'finished-piece': 'Portrait or Square · Slow pan or static · Clean background',
    'studio-life':    'Portrait (9:16) · 15–60 sec · Handheld is fine',
    'fair-day':       'Portrait (9:16) · 15–45 sec · Show the crowd and location',
    'process-story':  'Portrait (9:16) · 30–90 sec · Start-to-finish arc'
  };

  // ============================================================
  // Helpers — access globals from core
  // ============================================================

  function smGetUid() {
    return currentUser ? currentUser.uid : null;
  }

  // ============================================================
  // Data Loading
  // ============================================================

  async function loadSocialMedia() {
    var uid = smGetUid();
    if (!uid) {
      // Render empty home view even without auth
      socialMediaLoaded = true;
      smCurrentView = 'home';
      renderSocialMedia();
      return;
    }
    try {
      var clipVal = await MastDB.market.pendingClips.list(uid);
      smPendingClips = clipVal ? Object.values(clipVal) : [];
      smPendingClips.sort(function(a, b) { return (b.uploadedAt || 0) - (a.uploadedAt || 0); });

      var postVal = await MastDB.market.posts.list(uid);
      smPosts = postVal ? Object.values(postVal) : [];
      smPosts.sort(function(a, b) { return (b.postedAt || 0) - (a.postedAt || 0); });

      socialMediaLoaded = true;
      smCurrentView = 'home';
      renderSocialMedia();
    } catch (err) {
      console.error('Error loading social media:', err);
      document.getElementById('socialMediaContent').innerHTML =
        '<p style="color:var(--danger);padding:20px;">Error loading social media data.</p>';
    }
  }

  // ============================================================
  // Rendering — Main Router
  // ============================================================

  function renderSocialMedia() {
    var container = document.getElementById('socialMediaContent');
    if (smCurrentView === 'home') renderSMHome(container);
    else if (smCurrentView === 'newPost') renderSMNewPost(container);
    else if (smCurrentView === 'enhance') renderSMEnhance(container);
    else if (smCurrentView === 'shootCard') renderSMShootCard(container);
    else if (smCurrentView === 'staging') renderSMStaging(container);
  }

  // ---- Screen 1: Social Media Home ----
  function renderSMHome(container) {
    var pendingActive = smPendingClips.filter(function(c) { return c.status !== 'processed'; });
    var now = new Date();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    var postsThisMonth = smPosts.filter(function(p) { return p.postedAt >= monthStart; }).length;
    var signalsLogged = smPosts.filter(function(p) { return p.signalScore; }).length;

    var html = '<div class="sm-header">' +
      '<h2>Social Media</h2>' +
      '<button class="btn btn-primary" onclick="smStartNewPost()">+ New Post</button>' +
    '</div>';

    // Quick Stats
    html += '<div class="sm-stats-bar">' +
      '<div class="sm-stat-card"><div class="sm-stat-value">' + postsThisMonth + '</div><div class="sm-stat-label">Posts this month</div></div>' +
      '<div class="sm-stat-card"><div class="sm-stat-value">' + signalsLogged + '</div><div class="sm-stat-label">"This worked" signals</div></div>' +
    '</div>';

    // Pending Clips
    html += '<div class="sm-section">';
    html += '<div class="sm-section-label">Pending <span class="status-badge pill" style="background:var(--amber);color:#fff;">' + pendingActive.length + '</span></div>';
    if (pendingActive.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);"><div style="font-size:1.6rem;margin-bottom:12px;">📱</div><p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No pending clips yet</p><button class="btn btn-primary" style="margin-top:16px;" onclick="smStartNewPost()">+ New Post</button></div>';
    } else {
      pendingActive.forEach(function(clip) {
        var dateStr = clip.uploadedAt ? new Date(clip.uploadedAt).toLocaleDateString() : '';
        var thumbHtml = clip.thumbnailUrl
          ? '<img class="sm-clip-thumb" src="' + esc(clip.thumbnailUrl) + '" alt="">'
          : '<div class="sm-clip-thumb-placeholder">' + (clip.fileType === 'video' ? '🎬' : '📷') + '</div>';
        html += '<div class="sm-clip-card" onclick="smEnhanceClip(\'' + esc(clip.clipId) + '\')">' +
          thumbHtml +
          '<div class="sm-clip-info">' +
            '<div class="sm-clip-name">' + esc(clip.fileName || 'Untitled clip') + '</div>' +
            '<div class="sm-clip-meta">' + esc(dateStr) + ' · ' + esc(clip.fileType || 'file') + '</div>' +
          '</div>' +
          '<button class="btn btn-primary" style="flex-shrink:0;" onclick="event.stopPropagation(); smEnhanceClip(\'' + esc(clip.clipId) + '\')">Enhance →</button>' +
        '</div>';
      });
    }
    html += '</div>';

    // Posted History
    html += '<div class="sm-section">';
    html += '<div class="sm-section-label">Posted <span class="status-badge pill" style="background:var(--amber);color:#fff;">' + smPosts.length + '</span></div>';
    if (smPosts.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);"><div style="font-size:1.6rem;margin-bottom:12px;">📝</div><p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No posts yet</p><p style="font-size:0.85rem;color:var(--warm-gray-light);">Complete the pipeline to see your history here.</p></div>';
    } else {
      smPosts.forEach(function(post) {
        var dateStr = post.postedAt ? new Date(post.postedAt).toLocaleDateString() : '';
        var treatment = SM_TREATMENTS.find(function(t) { return t.id === post.treatment; });
        var treatmentColor = treatment ? treatment.color : '#999';
        var treatmentName = treatment ? treatment.name : post.treatment;

        var platformBadges = '';
        if (post.platforms) {
          post.platforms.forEach(function(p) {
            if (p === 'instagram-reels') platformBadges += '<span class="status-badge" style="background:#E1306C;color:#fff;">Reels</span>';
            else if (p === 'instagram-feed') platformBadges += '<span class="status-badge" style="background:#833AB4;color:#fff;">Feed</span>';
            else if (p === 'facebook') platformBadges += '<span class="status-badge" style="background:#1877F2;color:#fff;">FB</span>';
          });
        }

        var signalHtml = '<div style="display:flex;gap:4px;">' +
          '<button class="btn-icon"' + (post.signalScore === 1 ? ' style="background:var(--amber-light);border-color:var(--amber);"' : '') + ' onclick="event.stopPropagation(); smSetSignal(\'' + esc(post.postId) + '\', 1)">👍</button>' +
          '<button class="btn-icon"' + (post.signalScore === 2 ? ' style="background:#C84B31;border-color:#C84B31;color:#fff;"' : '') + ' onclick="event.stopPropagation(); smSetSignal(\'' + esc(post.postId) + '\', 2)">🔥</button>' +
        '</div>';

        var thumbHtml = post.thumbnailUrl
          ? '<img class="sm-post-thumb" src="' + esc(post.thumbnailUrl) + '" alt="">'
          : '<div class="sm-post-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.15rem;">📱</div>';

        html += '<div class="sm-post-card" onclick="smTogglePostCaption(\'' + esc(post.postId) + '\')">' +
          '<div class="sm-post-card-top">' +
            thumbHtml +
            '<div class="sm-post-info">' +
              '<div class="sm-post-title">' + esc(post.description || post.productName || treatmentName) + '</div>' +
              '<div class="sm-post-date">' + esc(dateStr) + '</div>' +
            '</div>' +
            '<div class="sm-post-badges">' +
              '<span class="status-badge" style="background:' + treatmentColor + ';color:#fff;">' + esc(treatmentName) + '</span>' +
              platformBadges +
              signalHtml +
            '</div>' +
          '</div>' +
          '<div class="sm-post-caption-expand" id="smPostCaption_' + esc(post.postId) + '" style="display:none;">' +
            esc(post.caption || 'No caption saved') +
          '</div>' +
        '</div>';
      });
    }
    html += '</div>';

    container.innerHTML = html;
  }

  function smTogglePostCaption(postId) {
    var el = document.getElementById('smPostCaption_' + postId);
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
  }

  async function smSetSignal(postId, score) {
    var uid = smGetUid();
    if (!uid) return;
    try {
      var post = smPosts.find(function(p) { return p.postId === postId; });
      var newScore = post && post.signalScore === score ? null : score;
      await MastDB.market.posts.update(uid, postId, {
        signalScore: newScore,
        scoredAt: newScore ? MastDB.serverTimestamp() : null
      });
      if (post) {
        post.signalScore = newScore;
        post.scoredAt = newScore ? Date.now() : null;
      }
      showToast(newScore ? 'Signal logged' : 'Signal removed');
      renderSocialMedia();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  // ---- Screen 2: New Post — Intent ----
  function smStartNewPost() {
    smCurrentView = 'newPost';
    smEnhanceData = {
      treatment: null,
      subjectType: 'none', // product | event | none
      productId: null,
      eventId: null,
      description: '',
      destinations: ['instagram-reels'],
      dateCaptured: new Date().toISOString().slice(0, 10),
      location: '',
      clipId: null,
      fileType: null,
      thumbnailBase64: null,
      thumbnailUrl: null,
      fileName: null,
      isPreShoot: false,
      captions: null,
      hashtags: null,
      selectedCaptionIdx: 0,
      readinessChecks: null,
      readinessScore: null
    };
    window.smEnhanceData = smEnhanceData;
    renderSocialMedia();
    emitTestingEvent('startPost', {});
  }

  function renderSMNewPost(container) {
    var html = '<div class="sm-intent-screen">';
    html += '<div style="text-align:left;margin-bottom:16px;"><button class="detail-back" onclick="smGoHome()">← Back to Social Media</button></div>';
    html += '<div class="sm-intent-title">What would you like to do?</div>';

    html += '<div class="sm-intent-option" onclick="smPreShoot()">' +
      '<div class="sm-intent-icon">📸</div>' +
      '<div><div class="sm-intent-label">I\'m about to shoot</div>' +
      '<div class="sm-intent-desc">Get a Shoot Card with specific instructions before you film</div></div>' +
    '</div>';

    html += '<div class="sm-intent-option" onclick="smPickFile()">' +
      '<div class="sm-intent-icon">🎬</div>' +
      '<div><div class="sm-intent-label">I already have a clip</div>' +
      '<div class="sm-intent-desc">Upload a video or photo from your camera roll</div></div>' +
    '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  function smGoHome() {
    smCurrentView = 'home';
    smCurrentClipId = null;
    renderSocialMedia();
  }

  function smPreShoot() {
    smEnhanceData.isPreShoot = true;
    smCurrentView = 'enhance';
    renderSocialMedia();
  }

  function smPickFile() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,image/*,.mp4,.mov,.jpeg,.jpg,.heic,.png';
    input.onchange = function(e) {
      var file = e.target.files[0];
      if (!file) return;
      smHandleFileSelected(file);
    };
    input.click();
  }

  async function smHandleFileSelected(file) {
    var uid = smGetUid();
    if (!uid) return;

    var isVideo = file.type.startsWith('video/');
    var clipId = 'clip_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

    smEnhanceData.clipId = clipId;
    smEnhanceData.fileName = file.name;
    smEnhanceData.fileType = isVideo ? 'video' : 'image';
    smEnhanceData.isPreShoot = false;

    // Show uploading state
    smCurrentView = 'enhance';
    var container = document.getElementById('socialMediaContent');
    container.innerHTML = '<div class="loading">Uploading ' + esc(file.name) + '…</div>' +
      '<div class="sm-upload-progress"><div class="sm-progress-bar"><div class="sm-progress-fill" id="smUploadProgress" style="width:0%"></div></div>' +
      '<div class="sm-progress-text" id="smUploadText">0%</div></div>';

    try {
      // Generate thumbnail
      var thumbnailBase64 = null;
      if (isVideo) {
        thumbnailBase64 = await smExtractVideoThumbnail(file);
      } else {
        thumbnailBase64 = await smImageToBase64(file);
      }
      smEnhanceData.thumbnailBase64 = thumbnailBase64;

      // Upload to Firebase Storage
      var storageRef = storage.ref('market/clips/' + uid + '/' + clipId + '/original');
      var uploadTask = storageRef.put(file);

      uploadTask.on('state_changed', function(snapshot) {
        var pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        var progressEl = document.getElementById('smUploadProgress');
        var textEl = document.getElementById('smUploadText');
        if (progressEl) progressEl.style.width = pct + '%';
        if (textEl) textEl.textContent = pct + '%';
      });

      await uploadTask;
      var fileUrl = await storageRef.getDownloadURL();

      // Upload thumbnail
      var thumbUrl = null;
      if (thumbnailBase64) {
        var thumbRef = storage.ref('market/clips/' + uid + '/' + clipId + '/thumbnail.jpg');
        var thumbBlob = smBase64ToBlob(thumbnailBase64, 'image/jpeg');
        await thumbRef.put(thumbBlob);
        thumbUrl = await thumbRef.getDownloadURL();
      }
      smEnhanceData.thumbnailUrl = thumbUrl;

      // Get video duration if applicable
      var duration = null;
      if (isVideo) {
        duration = await smGetVideoDuration(file);
      }

      // Save pending clip to Firebase
      var clipData = {
        clipId: clipId,
        fileName: file.name,
        thumbnailUrl: thumbUrl || null,
        fileUrl: fileUrl,
        uploadedAt: MastDB.serverTimestamp(),
        status: 'pending',
        fileType: isVideo ? 'video' : 'image',
        duration: duration,
        fileSize: file.size
      };
      await MastDB.market.pendingClips.set(uid, clipId, clipData);

      // Add to local array
      clipData.uploadedAt = Date.now();
      smPendingClips.unshift(clipData);

      smCurrentClipId = clipId;
      renderSocialMedia();
    } catch (err) {
      console.error('Upload error:', err);
      showToast('Upload failed: ' + err.message, true);
      smCurrentView = 'newPost';
      renderSocialMedia();
    }
  }

  function smExtractVideoThumbnail(file) {
    return new Promise(function(resolve) {
      var video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      var url = URL.createObjectURL(file);
      video.src = url;
      video.onloadeddata = function() {
        video.currentTime = 0.5;
      };
      video.onseeked = function() {
        var canvas = document.createElement('canvas');
        canvas.width = Math.min(video.videoWidth, 480);
        canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));
        var ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        URL.revokeObjectURL(url);
        resolve(dataUrl.split(',')[1]);
      };
      video.onerror = function() {
        URL.revokeObjectURL(url);
        resolve(null);
      };
    });
  }

  function smImageToBase64(file) {
    return new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onload = function() {
        var img = new Image();
        img.onload = function() {
          var canvas = document.createElement('canvas');
          canvas.width = Math.min(img.width, 480);
          canvas.height = Math.round(canvas.width * (img.height / img.width));
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          resolve(dataUrl.split(',')[1]);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function smGetVideoDuration(file) {
    return new Promise(function(resolve) {
      var video = document.createElement('video');
      video.preload = 'metadata';
      var url = URL.createObjectURL(file);
      video.src = url;
      video.onloadedmetadata = function() {
        URL.revokeObjectURL(url);
        resolve(Math.round(video.duration));
      };
      video.onerror = function() {
        URL.revokeObjectURL(url);
        resolve(null);
      };
    });
  }

  function smBase64ToBlob(base64, contentType) {
    var byteChars = atob(base64);
    var byteArrays = [];
    for (var offset = 0; offset < byteChars.length; offset += 512) {
      var slice = byteChars.slice(offset, offset + 512);
      var byteNumbers = new Array(slice.length);
      for (var i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
      byteArrays.push(new Uint8Array(byteNumbers));
    }
    return new Blob(byteArrays, { type: contentType });
  }

  function smEnhanceClip(clipId) {
    var clip = smPendingClips.find(function(c) { return c.clipId === clipId; });
    if (!clip) { showToast('Clip not found', true); return; }

    smCurrentClipId = clipId;
    smEnhanceData = {
      treatment: null,
      subjectType: 'none',
      productId: null,
      eventId: null,
      description: '',
      destinations: ['instagram-reels'],
      dateCaptured: clip.uploadedAt ? new Date(clip.uploadedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      location: '',
      clipId: clipId,
      fileType: clip.fileType,
      thumbnailBase64: null,
      thumbnailUrl: clip.thumbnailUrl || null,
      fileName: clip.fileName,
      fileSize: clip.fileSize || null,
      duration: clip.duration || null,
      isPreShoot: false,
      captions: null,
      hashtags: null,
      selectedCaptionIdx: 0,
      readinessChecks: null,
      readinessScore: null
    };
    window.smEnhanceData = smEnhanceData;

    smCurrentView = 'enhance';
    renderSocialMedia();
  }

  // ---- Screen 3: Enhancement Dialog ----
  function renderSMEnhance(container) {
    var d = smEnhanceData;
    var isPreShoot = d.isPreShoot;

    var html = '<button class="detail-back" onclick="' + (isPreShoot ? 'smStartNewPost()' : 'smGoHome()') + '">← Back to ' + (isPreShoot ? 'New Post' : 'Social Media') + '</button>';
    html += '<div class="sm-header"><h2>' + (isPreShoot ? 'Pre-Shoot Setup' : 'Enhance Clip') + '</h2></div>';

    // File info (post-capture only)
    if (!isPreShoot && d.fileName) {
      var thumbHtml = d.thumbnailUrl
        ? '<img class="sm-clip-thumb" src="' + esc(d.thumbnailUrl) + '" alt="" style="width:80px;height:80px;">'
        : '<div class="sm-clip-thumb-placeholder" style="width:80px;height:80px;">' + (d.fileType === 'video' ? '🎬' : '📷') + '</div>';
      html += '<div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;padding:14px;background:var(--cream);border:1px solid #e8e2d8;border-radius:8px;">' +
        thumbHtml +
        '<div><div style="font-weight:500;">' + esc(d.fileName) + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray-light);">' + esc(d.fileType || '') +
        (d.duration ? ' · ' + d.duration + 's' : '') +
        (d.fileSize ? ' · ' + (d.fileSize / 1048576).toFixed(1) + ' MB' : '') +
        '</div></div></div>';
    }

    // Section 1: Product Association
    html += '<div class="sm-enhance-section">';
    html += '<div class="sm-enhance-section-label">Is this clip about a specific product?</div>';
    html += '<div style="display:flex;gap:0;border:1px solid #ddd;border-radius:6px;overflow:hidden;">' +
      '<button class="btn btn-small" style="flex:1;border-radius:0;border:none;border-right:1px solid #ddd;' + (d.subjectType === 'product' ? 'background:var(--amber);color:#fff;' : 'background:var(--cream);color:var(--warm-gray);') + '" onclick="smSetSubjectType(\'product\')">Product</button>' +
      '<button class="btn btn-small" style="flex:1;border-radius:0;border:none;border-right:1px solid #ddd;' + (d.subjectType === 'event' ? 'background:var(--amber);color:#fff;' : 'background:var(--cream);color:var(--warm-gray);') + '" onclick="smSetSubjectType(\'event\')">Event</button>' +
      '<button class="btn btn-small" style="flex:1;border-radius:0;border:none;' + (d.subjectType === 'none' ? 'background:var(--amber);color:#fff;' : 'background:var(--cream);color:var(--warm-gray);') + '" onclick="smSetSubjectType(\'none\')">No specific product</button>' +
    '</div>';

    if (d.subjectType === 'product') {
      html += '<div class="form-group" style="margin-top:12px;">' +
        '<label>Select Product</label>' +
        '<select id="smProductPicker" onchange="smEnhanceData.productId=this.value">' +
        '<option value="">— Choose a product —</option>';
      // Access productsData from core (global)
      var products = window.productsData || [];
      products.forEach(function(p) {
        var pPriceStr = (typeof p.priceCents === 'number' && p.priceCents > 0 && window.formatCents) ? (' — ' + window.formatCents(p.priceCents)) : '';
        html += '<option value="' + esc(p.pid) + '"' + (d.productId === p.pid ? ' selected' : '') + '>' + esc(p.name) + pPriceStr + '</option>';
      });
      html += '</select></div>';
    } else if (d.subjectType === 'event') {
      html += '<div class="form-group" style="margin-top:12px;">' +
        '<label>Select Event</label>' +
        '<input type="text" id="smEventInput" placeholder="Event name" value="' + esc(d.eventName || '') + '" onchange="smEnhanceData.eventName=this.value">' +
      '</div>';
    } else {
      html += '<div class="form-group" style="margin-top:12px;">' +
        '<label>Describe what this video is about</label>' +
        '<textarea id="smDescInput" rows="2" placeholder="What should the caption call out?" onchange="smEnhanceData.description=this.value">' + esc(d.description) + '</textarea>' +
      '</div>';
    }
    html += '</div>';

    // Section 2: Metadata
    if (!isPreShoot) {
      html += '<div class="sm-enhance-section">';
      html += '<div class="sm-enhance-section-label">Metadata</div>';
      html += '<div style="display:flex;gap:12px;">' +
        '<div class="form-group" style="flex:1;"><label>Date Captured</label>' +
        '<input type="date" id="smDateInput" value="' + esc(d.dateCaptured) + '" onchange="smEnhanceData.dateCaptured=this.value"></div>' +
        '<div class="form-group" style="flex:1;"><label>Location</label>' +
        '<input type="text" id="smLocationInput" placeholder="e.g. Studio, Conway MA" value="' + esc(d.location) + '" onchange="smEnhanceData.location=this.value"></div>' +
      '</div>';
      html += '</div>';
    }

    // Section 3: Treatment
    html += '<div class="sm-enhance-section">';
    html += '<div class="sm-enhance-section-label">Content Style</div>';
    html += '<div class="sm-treatment-grid">';
    SM_TREATMENTS.forEach(function(t) {
      html += '<div class="sm-treatment-card ' + t.id + (d.treatment === t.id ? ' selected' : '') + '" onclick="smSelectTreatment(\'' + t.id + '\')">' +
        '<div class="sm-t-icon">' + t.icon + '</div>' +
        '<div class="sm-t-name">' + esc(t.name) + '</div>' +
        '<div class="sm-t-desc">' + esc(t.desc) + '</div>' +
      '</div>';
    });
    html += '</div></div>';

    // Section 4: Destinations
    html += '<div class="sm-enhance-section">';
    html += '<div class="sm-enhance-section-label">Destinations</div>';
    html += '<div class="sm-dest-chips">';
    html += '<div class="sm-dest-chip' + (d.destinations.indexOf('instagram-reels') !== -1 ? ' selected' : '') + '" onclick="smToggleDest(\'instagram-reels\')">📱 Instagram Reels</div>';
    html += '<div class="sm-dest-chip' + (d.destinations.indexOf('instagram-feed') !== -1 ? ' selected' : '') + '" onclick="smToggleDest(\'instagram-feed\')">📸 Instagram Feed</div>';
    html += '<div class="sm-dest-chip disabled" onclick="showToast(\'Facebook posting coming soon!\')">📘 Facebook Post <small>(Coming soon)</small></div>';
    html += '</div></div>';

    // Section 5: Attach Coupon (optional)
    html += '<div class="sm-enhance-section">';
    html += '<div class="sm-enhance-section-label">Attach Coupon <span style="font-weight:400;color:var(--warm-gray);">(optional)</span></div>';
    if (d.attachedCoupon) {
      var smCoupons = window.coupons || {};
      var smC = smCoupons[d.attachedCoupon];
      var smValStr = smC ? (smC.type === 'percent' ? smC.value + '% off' : '$' + (smC.value || 0).toFixed(2) + ' off') : '';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(42,124,111,0.06);border:1px dashed rgba(42,124,111,0.3);border-radius:6px;">' +
        '<span>\uD83C\uDFF7\uFE0F <span style="font-family:monospace;font-weight:600;">' + esc(d.attachedCoupon) + '</span> \u2014 ' + esc(smValStr) + '</span>' +
        '<button class="btn btn-small" style="font-size:0.78rem;" onclick="smEnhanceData.attachedCoupon=null;renderSocialMedia()">Remove</button>' +
      '</div>';
      html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:6px;">Claim URL will be added to caption</div>';
    } else {
      html += '<button class="btn btn-outline" onclick="smPickCoupon()" style="font-size:0.85rem;">\uD83C\uDFF7\uFE0F Attach Coupon</button>';
    }
    html += '</div>';

    // CTA
    var ctaLabel = isPreShoot ? 'Generate Shoot Card' : 'Generate';
    var ctaDisabled = !d.treatment ? ' disabled' : '';
    html += '<div style="margin-top:24px;text-align:center;">' +
      '<button class="btn btn-primary" style="padding:12px 40px;font-size:1rem;"' + ctaDisabled + ' onclick="smGenerate()">' + ctaLabel + '</button>' +
      (!d.treatment ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:8px;">Select a content style to continue</div>' : '') +
    '</div>';

    container.innerHTML = html;
  }

  function smSetSubjectType(type) {
    smEnhanceData.subjectType = type;
    renderSocialMedia();
  }

  function smSelectTreatment(id) {
    smEnhanceData.treatment = id;
    renderSocialMedia();
  }

  function smToggleDest(dest) {
    var idx = smEnhanceData.destinations.indexOf(dest);
    if (idx === -1) {
      smEnhanceData.destinations.push(dest);
    } else {
      smEnhanceData.destinations.splice(idx, 1);
    }
    renderSocialMedia();
  }

  async function smGenerate() {
    var d = smEnhanceData;
    if (!d.treatment) { showToast('Please select a content style', true); return; }

    // Capture form values before re-render
    var descEl = document.getElementById('smDescInput');
    if (descEl) d.description = descEl.value;
    var prodEl = document.getElementById('smProductPicker');
    if (prodEl) d.productId = prodEl.value;
    var eventEl = document.getElementById('smEventInput');
    if (eventEl) d.eventName = eventEl.value;
    var dateEl = document.getElementById('smDateInput');
    if (dateEl) d.dateCaptured = dateEl.value;
    var locEl = document.getElementById('smLocationInput');
    if (locEl) d.location = locEl.value;

    // Resolve product details
    if (d.subjectType === 'product' && d.productId) {
      var products = window.productsData || [];
      var product = products.find(function(p) { return p.pid === d.productId; });
      if (product) {
        d.productName = product.name;
        d.productPriceCents = product.priceCents || 0;
        d.productMaterials = product.materials;
        d.productCategory = product.categories ? product.categories.join(', ') : '';
      }
    }

    if (d.isPreShoot) {
      // Pre-shoot flow → Shoot Card
      smCurrentView = 'shootCard';
      renderSocialMedia();
      smGenerateShootCard();
    } else {
      // Post-capture flow → Readiness check, then captions
      smRunReadinessAndCaptions();
    }
  }

  // ---- Shoot Card (pre-shoot flow) ----
  function renderSMShootCard(container) {
    var d = smEnhanceData;
    var treatment = SM_TREATMENTS.find(function(t) { return t.id === d.treatment; });
    var treatmentName = treatment ? treatment.name : d.treatment;
    var treatmentIcon = treatment ? treatment.icon : '';
    var treatmentColor = treatment ? treatment.color : '#999';

    var html = '<button class="detail-back" onclick="smSetView(\'enhance\')">← Back to Enhance</button>';
    html += '<div class="sm-shoot-card">';
    html += '<div class="sm-shoot-card-inner" id="smShootCardContent">';

    if (d.shootCardBullets) {
      html += '<div class="sm-shoot-card-treatment" style="color:' + treatmentColor + '">' + treatmentIcon + ' ' + esc(treatmentName) + '</div>';
      html += '<ul class="sm-shoot-card-bullets">';
      d.shootCardBullets.forEach(function(b) {
        html += '<li>' + esc(b) + '</li>';
      });
      html += '</ul>';
      html += '<div class="sm-shoot-card-tip">' + esc(SM_TECH_TIPS[d.treatment] || '') + '</div>';
    } else {
      html += '<div class="loading">Generating your Shoot Card…</div>';
    }

    html += '</div>';

    if (d.shootCardBullets) {
      html += '<div style="margin-top:20px;display:flex;gap:10px;justify-content:center;">' +
        '<button class="btn btn-primary" onclick="smFinishPreShoot()">Ready to Shoot ✓</button>' +
        '<button class="btn btn-secondary" onclick="smGoHome()">Skip Card</button>' +
      '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  async function smGenerateShootCard() {
    var d = smEnhanceData;
    var treatment = SM_TREATMENTS.find(function(t) { return t.id === d.treatment; });
    var treatmentName = treatment ? treatment.name : d.treatment;
    var subject = d.productName || d.eventName || d.description || 'glass art piece';

    try {
      var result = await firebase.functions().httpsCallable('socialAI')({
        action: 'shootCard',
        tenantId: MastDB.tenantId(),
        treatment: treatmentName,
        subject: subject,
        productDetails: d.productName ? [d.productName, d.productPrice, d.productMaterials, d.productCategory].filter(Boolean).join(', ') : '',
        destinations: d.destinations
      });

      d.shootCardBullets = result.data.bullets || ['Point camera at your piece', 'Capture the details and colors', 'Film for 15-30 seconds', 'Try different angles'];
      renderSocialMedia();
    } catch (err) {
      console.error('Shoot card generation error:', err);
      // Fallback bullets
      d.shootCardBullets = [
        'Focus on the ' + (d.productName || 'piece') + ' from multiple angles',
        'Capture natural light reflecting off the glass',
        'Film in portrait (9:16) for Reels',
        'Keep it under 60 seconds',
        'Start wide, then move in close'
      ];
      showToast('AI unavailable — using default Shoot Card', true);
      renderSocialMedia();
    }
  }

  async function smFinishPreShoot() {
    var uid = smGetUid();
    if (!uid) return;

    // Save a pending post record (status: pending-clip)
    var clipId = 'preshoot_' + Date.now().toString(36);
    var clipData = {
      clipId: clipId,
      fileName: 'Pre-shoot: ' + (smEnhanceData.productName || smEnhanceData.description || 'Untitled'),
      thumbnailUrl: null,
      fileUrl: null,
      uploadedAt: MastDB.serverTimestamp(),
      status: 'pending-clip',
      fileType: 'video',
      treatment: smEnhanceData.treatment,
      subjectType: smEnhanceData.subjectType,
      productId: smEnhanceData.productId || null,
      eventName: smEnhanceData.eventName || null,
      description: smEnhanceData.description || null
    };

    try {
      await MastDB.market.pendingClips.set(uid, clipId, clipData);
      clipData.uploadedAt = Date.now();
      smPendingClips.unshift(clipData);
      showToast('Shoot Card saved — ready to film!');
      smGoHome();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  // ---- Clip Readiness & Caption Generation ----
  async function smRunReadinessAndCaptions() {
    var d = smEnhanceData;
    var container = document.getElementById('socialMediaContent');

    // Show loading state
    container.innerHTML = '<button class="detail-back" onclick="smSetView(\'enhance\')">← Back to Enhance</button>' +
      '<div class="loading">Analyzing your clip…</div>';

    // Run client-side readiness checks
    var checks = [];
    var clip = smPendingClips.find(function(c) { return c.clipId === d.clipId; });

    if (d.fileType === 'video') {
      // Orientation check (if thumbnail available)
      if (d.thumbnailBase64) {
        var img = new Image();
        var orientResult = await new Promise(function(resolve) {
          img.onload = function() {
            if (img.width > img.height) {
              resolve({ label: 'Orientation', status: 'warn', msg: 'Landscape detected — Reels performs best in portrait (9:16)' });
            } else {
              resolve({ label: 'Orientation', status: 'ok', msg: 'Portrait — great for Reels' });
            }
          };
          img.onerror = function() { resolve(null); };
          img.src = 'data:image/jpeg;base64,' + d.thumbnailBase64;
        });
        if (orientResult) checks.push(orientResult);
      }

      // Duration check
      var dur = d.duration || (clip && clip.duration);
      if (dur) {
        if (dur < 5) checks.push({ label: 'Duration', status: 'warn', msg: dur + 's — may be too short for engagement' });
        else if (dur > 90) checks.push({ label: 'Duration', status: 'warn', msg: dur + 's — consider trimming to under 60s' });
        else checks.push({ label: 'Duration', status: 'ok', msg: dur + 's — good length' });
      }
    }

    // File size check
    var fsize = d.fileSize || (clip && clip.fileSize);
    if (fsize && fsize > 500 * 1024 * 1024) {
      checks.push({ label: 'File Size', status: 'warn', msg: (fsize / 1048576).toFixed(0) + ' MB — large file, upload may be slow' });
    }

    d.readinessChecks = checks;

    // Try treatment alignment via Claude Vision
    if (d.thumbnailBase64) {
      try {
        var visionResult = await firebase.functions().httpsCallable('socialAI')({
          action: 'readiness',
          tenantId: MastDB.tenantId(),
          treatment: d.treatment,
          thumbnailBase64: d.thumbnailBase64
        });
        if (visionResult.data && visionResult.data.score) {
          d.readinessScore = visionResult.data;
          var scoreStatus = visionResult.data.score >= 7 ? 'ok' : visionResult.data.score >= 4 ? 'warn' : 'warn';
          checks.push({ label: 'Treatment Fit', status: scoreStatus, msg: visionResult.data.feedback || ('Score: ' + visionResult.data.score + '/10') });
        }
      } catch (err) {
        console.warn('Vision readiness check skipped:', err.message);
      }
    }

    // Now generate captions
    container.innerHTML = '<button class="detail-back" onclick="smSetView(\'enhance\')">← Back to Enhance</button>' +
      '<div class="loading">Crafting your captions…</div>';

    try {
      var treatment = SM_TREATMENTS.find(function(t) { return t.id === d.treatment; });
      var captionResult = await firebase.functions().httpsCallable('socialAI')({
        action: 'captions',
        tenantId: MastDB.tenantId(),
        treatment: treatment ? treatment.name : d.treatment,
        platform: d.destinations.join(', '),
        productName: d.productName || null,
        productPrice: d.productPrice || null,
        productMaterials: d.productMaterials || null,
        productCategory: d.productCategory || null,
        eventName: d.eventName || null,
        description: d.description || null
      });

      if (captionResult.data) {
        d.captions = captionResult.data.captions || [];
        d.hashtags = captionResult.data.hashtags || {};
      }
    } catch (err) {
      console.warn('Caption generation error:', err.message);
      // Fallback captions
      var subjectText = d.productName || d.eventName || d.description || 'handmade art';
      d.captions = [
        { style: 'Story', text: 'Every piece tells a story. This ' + subjectText + ' came to life in our studio — shaped by hand, with care and intention. ✨' },
        { style: 'Product', text: 'Meet our latest creation: ' + subjectText + '. Handmade, with intention. Link in bio to bring one home. 🔗' },
        { style: 'Urgency', text: 'This ' + subjectText + ' won\'t last long — each piece is one-of-a-kind. DM us before it\'s gone! 💨' }
      ];
      d.hashtags = {
        niche: ['#handmade', '#artisan', '#madebyhand', '#makersgonnamake'],
        mid: ['#shopsmall', '#supportlocal', '#handcrafted', '#smallbusiness'],
        broad: ['#oneofakind', '#shoplocal', '#makersmovement', '#homedecor']
      };
      showToast('AI unavailable — using template captions', true);
    }

    d.selectedCaptionIdx = 0;

    // Append coupon claim URL to captions if a coupon is attached
    if (d.attachedCoupon && window.MastCouponCard) {
      var couponUrl = window.MastCouponCard.getClaimUrl(d.attachedCoupon, 'social');
      (d.captions || []).forEach(function(cap) {
        if (cap.text && cap.text.indexOf(couponUrl) === -1) {
          cap.text += '\n\n\uD83C\uDFF7\uFE0F Claim your coupon: ' + couponUrl;
        }
      });
    }

    smCurrentView = 'staging';
    renderSocialMedia();
  }

  // ---- Screen 4: Platform Staging ----
  function renderSMStaging(container) {
    var d = smEnhanceData;
    var treatment = SM_TREATMENTS.find(function(t) { return t.id === d.treatment; });

    var html = '<button class="detail-back" onclick="smSetView(\'enhance\')">← Back to Enhance</button>';
    html += '<div class="sm-header"><h2>Platform Staging</h2></div>';

    // Readiness checks
    if (d.readinessChecks && d.readinessChecks.length > 0) {
      html += '<div style="margin-bottom:20px;">';
      d.readinessChecks.forEach(function(check) {
        var cls = check.status === 'ok' ? 'green' : 'amber';
        var icon = check.status === 'ok' ? '✅' : '⚠️';
        html += '<div class="sm-readiness ' + cls + '">' + icon + ' <strong>' + esc(check.label) + ':</strong> ' + esc(check.msg) + '</div>';
      });
      html += '</div>';
    }

    // Caption selection
    if (d.captions && d.captions.length > 0) {
      html += '<div class="sm-section">';
      html += '<div class="sm-section-label">Choose your caption</div>';
      d.captions.forEach(function(cap, idx) {
        var isSelected = idx === d.selectedCaptionIdx;
        html += '<div class="sm-caption-card' + (isSelected ? ' selected' : '') + '" onclick="smSelectCaption(' + idx + ')">' +
          '<div class="sm-caption-style">' + esc(cap.style) + '</div>' +
          '<div class="sm-caption-text">' + esc(cap.text) + '</div>';
        if (isSelected) {
          html += '<textarea class="sm-caption-edit" id="smCaptionEdit" oninput="smEnhanceData.captions[' + idx + '].text = this.value">' + esc(cap.text) + '</textarea>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    // Hashtags
    if (d.hashtags) {
      html += '<div class="sm-section">';
      html += '<details><summary style="cursor:pointer;font-weight:600;font-size:0.9rem;margin-bottom:8px;">Show hashtags ↓</summary>';
      if (d.hashtags.niche) {
        html += '<div class="sm-hashtag-tier"><div class="sm-hashtag-tier-label">Niche</div><div class="sm-hashtag-list">' + d.hashtags.niche.join(' ') + '</div></div>';
      }
      if (d.hashtags.mid) {
        html += '<div class="sm-hashtag-tier"><div class="sm-hashtag-tier-label">Mid-Range</div><div class="sm-hashtag-list">' + d.hashtags.mid.join(' ') + '</div></div>';
      }
      if (d.hashtags.broad) {
        html += '<div class="sm-hashtag-tier"><div class="sm-hashtag-tier-label">Broad</div><div class="sm-hashtag-list">' + d.hashtags.broad.join(' ') + '</div></div>';
      }
      html += '<div style="margin-top:8px;">' +
        '<button class="btn btn-secondary" onclick="smCopyHashtags()">Copy All Hashtags</button>' +
      '</div>';
      html += '</details></div>';
    }

    // Instagram Reels Posting Guide
    if (d.destinations.indexOf('instagram-reels') !== -1 || d.destinations.indexOf('instagram-feed') !== -1) {
      html += '<div class="sm-section">';
      html += '<div class="sm-section-label">Instagram Posting Guide</div>';

      var steps = [
        { letter: 'A', title: 'Open Instagram', note: 'Opens the Instagram app — your caption is copied automatically.', action: 'smOpenInstagramWithCaption()' },
        { letter: 'B', title: 'Select Your Video', note: 'Pick your edited video from your camera roll.\nPlatform spec: 9:16 portrait · 15–90 seconds · MP4 or MOV', action: null },
        { letter: 'C', title: 'Paste Caption', note: null, action: 'smCopyCaption()' },
        { letter: 'D', title: 'Add Hashtags', note: null, action: 'smCopyHashtags()' },
        { letter: 'E', title: 'Set Cover Frame', note: 'Scrub to your best frame in the Instagram cover selector.\nTip: A still moment with the piece fully visible works best.', action: null }
      ];

      steps.forEach(function(step) {
        html += '<div class="sm-guide-step">' +
          '<div class="sm-guide-step-letter">' + step.letter + '</div>' +
          '<div class="sm-guide-step-content">' +
            '<div class="sm-guide-step-title">' + esc(step.title) + '</div>';
        if (step.note) {
          html += '<div class="sm-guide-step-note">' + esc(step.note) + '</div>';
        }
        if (step.action) {
          var btnLabel = step.letter === 'A' ? 'Open Instagram Reels →' : step.letter === 'C' ? 'Copy Caption' : 'Copy Hashtags';
          html += '<button class="btn btn-secondary" onclick="' + step.action + '">' + btnLabel + '</button>';
        }
        if (step.letter === 'C' && d.captions && d.captions[d.selectedCaptionIdx]) {
          var preview = d.captions[d.selectedCaptionIdx].text;
          if (preview.length > 80) preview = preview.substring(0, 80) + '…';
          html += '<div class="sm-guide-step-note" style="margin-top:6px;font-style:italic;">' + esc(preview) + '</div>';
        }
        if (step.letter === 'D' && d.hashtags) {
          var allTags = [].concat(d.hashtags.niche || [], d.hashtags.mid || [], d.hashtags.broad || []);
          var preview2 = allTags.slice(0, 5).join(' ');
          if (allTags.length > 5) preview2 += ' …';
          html += '<div class="sm-guide-step-note" style="margin-top:6px;font-style:italic;">' + esc(preview2) + '</div>';
        }
        html += '</div></div>';
      });

      html += '</div>';
    }

    // Mark as Posted CTA
    html += '<div style="margin-top:24px;">' +
      '<button class="btn btn-primary" style="width:100%;padding:14px;font-size:1rem;" onclick="smMarkPosted()">Mark as Posted ✓</button>' +
    '</div>';

    container.innerHTML = html;
  }

  function smSelectCaption(idx) {
    smEnhanceData.selectedCaptionIdx = idx;
    renderSocialMedia();
  }

  function smCopyCaption() {
    var d = smEnhanceData;
    if (d.captions && d.captions[d.selectedCaptionIdx]) {
      navigator.clipboard.writeText(d.captions[d.selectedCaptionIdx].text).then(function() {
        showToast('Caption copied!');
      }).catch(function() {
        showToast('Copy failed — try manually', true);
      });
    }
  }

  function smCopyHashtags() {
    var d = smEnhanceData;
    if (d.hashtags) {
      var all = [].concat(d.hashtags.niche || [], d.hashtags.mid || [], d.hashtags.broad || []);
      navigator.clipboard.writeText(all.join(' ')).then(function() {
        showToast('Hashtags copied!');
      }).catch(function() {
        showToast('Copy failed — try manually', true);
      });
    }
  }

  function smOpenInstagramWithCaption() {
    smCopyCaption();
    // Try to open Instagram
    window.open('https://www.instagram.com/reels/', '_blank');
  }

  // ---- Screen 5: Mark as Posted ----
  async function smMarkPosted() {
    var d = smEnhanceData;
    var uid = smGetUid();
    if (!uid) return;

    // Confirmation — which platforms
    var platforms = d.destinations.filter(function(dest) { return dest !== 'facebook'; });
    if (platforms.length === 0) platforms = ['instagram-reels'];

    var postId = 'post_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    var selectedCaption = d.captions && d.captions[d.selectedCaptionIdx] ? d.captions[d.selectedCaptionIdx].text : '';

    var postData = {
      postId: postId,
      clipId: d.clipId || null,
      productId: d.productId || null,
      productName: d.productName || null,
      eventName: d.eventName || null,
      treatment: d.treatment,
      platforms: platforms,
      caption: selectedCaption,
      hashtags: d.hashtags || null,
      postedAt: MastDB.serverTimestamp(),
      signalScore: null,
      scoredAt: null,
      contentType: d.fileType || 'video',
      thumbnailUrl: d.thumbnailUrl || null,
      description: d.description || d.productName || d.eventName || null
    };

    try {
      await MastDB.market.posts.set(uid, postId, postData);

      // Move clip from pending
      if (d.clipId) {
        await MastDB.market.pendingClips.statusRef(uid, d.clipId).set('processed');
        var clipIdx = smPendingClips.findIndex(function(c) { return c.clipId === d.clipId; });
        if (clipIdx !== -1) smPendingClips[clipIdx].status = 'processed';
      }

      // Add to local posts
      postData.postedAt = Date.now();
      smPosts.unshift(postData);

      showToast('Post recorded! 🎉');
      emitTestingEvent('markPosted', {});
      smGoHome();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  // ============================================================
  // Window exports — for onclick handlers in HTML templates
  // ============================================================

  window.smStartNewPost = smStartNewPost;
  window.smEnhanceClip = smEnhanceClip;
  window.smTogglePostCaption = smTogglePostCaption;
  window.smSetSignal = smSetSignal;
  window.smPreShoot = smPreShoot;
  window.smPickFile = smPickFile;
  window.smGoHome = smGoHome;
  window.smSetSubjectType = smSetSubjectType;
  window.smSelectTreatment = smSelectTreatment;
  window.smToggleDest = smToggleDest;
  window.smGenerate = smGenerate;
  window.smSelectCaption = smSelectCaption;
  window.smCopyCaption = smCopyCaption;
  window.smCopyHashtags = smCopyHashtags;
  window.smOpenInstagramWithCaption = smOpenInstagramWithCaption;
  window.smMarkPosted = smMarkPosted;
  window.smFinishPreShoot = smFinishPreShoot;

  function smPickCoupon() {
    var allCoupons = window.coupons || {};
    var codes = Object.keys(allCoupons).filter(function(code) {
      return getCouponEffectiveStatus(allCoupons[code]) === 'active';
    });
    if (codes.length === 0) { showToast('No active coupons. Create coupons in the Coupons tab first.', true); return; }
    var listHtml = '';
    codes.forEach(function(code) {
      var c = allCoupons[code];
      var valStr = c.type === 'percent' ? c.value + '% off' : '$' + (c.value || 0).toFixed(2) + ' off';
      listHtml += '<div data-coupon-code="' + esc(code) + '" ' +
        'style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--cream-dark);border-radius:6px;cursor:pointer;transition:background 0.15s;" ' +
        'onmouseover="this.style.background=\'rgba(42,124,111,0.06)\'" onmouseout="this.style.background=\'transparent\'" ' +
        'onclick="smEnhanceData.attachedCoupon=this.dataset.couponCode;closeModal();renderSocialMedia()">' +
        '<span style="font-family:monospace;font-weight:600;">' + esc(code) + '</span>' +
        '<span style="color:var(--teal);font-weight:600;">' + esc(valStr) + '</span></div>';
    });
    var html = '<div class="modal-header"><h3>Attach Coupon</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body"><p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">The coupon claim link will be added to your caption:</p>' +
      '<div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;">' + listHtml + '</div></div>';
    openModal(html);
  }
  window.smPickCoupon = smPickCoupon;
  // smSetView — setter for smCurrentView (primitives can't be shared by reference)
  function smSetView(view) {
    smCurrentView = view;
    renderSocialMedia();
  }
  window.smSetView = smSetView;
  window.renderSocialMedia = renderSocialMedia;
  // smEnhanceData is accessed by inline onchange/oninput handlers (object — shared by reference)
  window.smEnhanceData = smEnhanceData;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('social', {
    routes: {
      'social': {
        tab: 'socialMediaTab',
        setup: function() {
          if (!socialMediaLoaded) loadSocialMedia();
          if (!window.productsLoaded) loadProducts();
        }
      }
    }
  });

})();
