/**
 * social-v2.js — record-archetype twin of the legacy Social Media surface
 * (standard-record-ui §10; marketing-v2-build-plan Wave 1).
 *
 * Legacy social.js (#social) is a content PIPELINE: clip upload → enhance
 * (treatment + AI captions / shoot cards) → staging → "mark posted", plus a
 * posted-feed list with a 👍/🔥 signal logger. This twin re-hosts the POSTS
 * list → read/edit detail on the Entity Engine PLUS a native create flow
 * (upload → details → AI captions → post, S2), native pending-clip RESUME
 * (S5) and the authoring EXTRAS that retire the last legacy pipeline (S6):
 * (A) "Plan a shoot" pre-shoot shoot-card flow (no clip yet → AI shot list →
 * saved as a pending clip, resumable once filmed), (B) advisory AI readiness
 * score + client orientation/duration/filesize warnings (never blocks),
 * (C) coupon attach (appends the claim URL to the caption), and (D) Caption-
 * in-Claude (draft via Ask AI's openWithReturn). Every CF call / write is
 * single-sourced through SocialBridge. The legacy #social escape hatch is GONE
 * (no navigateToClassic).
 *
 * Variant: a social post is a content record (caption, platforms, treatment,
 * media) with NO governed lifecycle — status is 'draft' | 'posted', an
 * assigned attribute flipped by the operator ("Mark posted"), so Faceted
 * Record, NOT Process/MastFlow.
 *
 * Data (mirrors legacy exactly): market/posts/{uid}/{postId} via
 * MastDB.market.posts — uid-nested, single-operator assumption (see plan debt
 * register). Fields: postId, caption, description, platforms[], status
 * ('draft'|'posted'; legacy pre-status docs are posted), postedAt,
 * scheduledFor, signalScore (1=👍 2=🔥, toggleable), treatment, contentType,
 * thumbnailUrl, hashtags, productId/Name, eventName, source, sourceContentId.
 * Pending clips (market/pendingClips/{uid}) — uploaded but not-yet-posted
 * clips — surface as RESUMABLE chips that re-open the native create wizard at
 * the details step with the clip already attached (S5). Clips are
 * work-in-flight, not records.
 *
 * NATIVE write: caption/description/hashtags/platforms/schedule edit + signal
 * + mark-posted, all DELEGATED to window.SocialBridge (exposed in social.js)
 * so the post write shape stays single-sourced. RBAC: can('social','edit').
 * Flag-gated (?ui=1) at #social-v2, side-by-side with legacy #social.
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

  // Treatment labels mirror SM_TREATMENTS in social.js (labels only — the
  // legacy hex accents stay there; badges here use tokens).
  var TREATMENT_LABEL = {
    'hot-glass': 'Hot Glass', 'finished-piece': 'Finished Piece',
    'studio-life': 'Studio Life', 'fair-day': 'Fair Day', 'process-story': 'Process Story'
  };
  var PLATFORM_LABEL = { 'instagram-reels': 'Instagram', 'instagram-feed': 'Instagram', instagram: 'Instagram', facebook: 'Facebook', x: 'X', twitter: 'X', tiktok: 'TikTok' };
  var STATUS_TONE = { posted: 'success', draft: 'info' };

  // Treatment + destination options for the native create flow — mirror
  // SM_TREATMENTS / the destination chips in legacy social.js (labels + the
  // one-line spec tip; legacy hex accents stay in social.js — chrome here uses
  // tokens). The create flow is the native port of the legacy "I have a clip"
  // pipeline (S2); SocialBridge single-sources every write.
  var CREATE_TREATMENTS = [
    { id: 'hot-glass', name: 'Hot Glass', desc: 'Kiln-lit process, close-in, material-first' },
    { id: 'finished-piece', name: 'Finished Piece', desc: 'Clean background, product-forward' },
    { id: 'studio-life', name: 'Studio Life', desc: 'Candid, behind the scenes' },
    { id: 'fair-day', name: 'Fair Day', desc: 'Event context, crowd energy' },
    { id: 'process-story', name: 'Process Story', desc: 'Start-to-finish transformation' }
  ];
  var CREATE_DESTS = [
    { id: 'instagram-reels', label: '📱 Instagram Reels' },
    { id: 'instagram-feed', label: '📸 Instagram Feed' }
  ];
  // Per-treatment one-line shoot tip (mirrors SM_TECH_TIPS in social.js) —
  // shown on the (A) pre-shoot shoot card under the AI shot list.
  var SHOOT_TIPS = {
    'hot-glass': 'Portrait (9:16) · 15–30 sec · Capture the glow',
    'finished-piece': 'Portrait or Square · Slow pan or static · Clean background',
    'studio-life': 'Portrait (9:16) · 15–60 sec · Handheld is fine',
    'fair-day': 'Portrait (9:16) · 15–45 sec · Show the crowd and location',
    'process-story': 'Portrait (9:16) · 30–90 sec · Start-to-finish arc'
  };

  // Scoped loading spinner — deliberately NOT the global `.loading` class. The
  // multi-collection load (posts + pendingClips) and AI caption generation can
  // legitimately run >8s on a cold cache / slow LLM round-trip; the global
  // stalled-spinner watchdog (index.html, polls visible `.loading` and auto-
  // files a "spinner-timeout" feedback report) would otherwise false-fire.
  // Reuses the global `spin` keyframe so it still reads as a spinner.
  function scopedSpinner(label, style) {
    return '<div style="padding:24px;color:var(--text-secondary);display:flex;align-items:center;gap:10px;' + (style || '') + '">' +
      '<span style="width:16px;height:16px;border:2px solid var(--cream-dark);border-top-color:var(--teal);border-radius:50%;display:inline-block;animation:spin 0.8s linear infinite;flex-shrink:0;"></span>' +
      esc(label || 'Loading…') + '</div>';
  }

  function statusKey(p) { return String(p.status || 'posted').toLowerCase(); } // legacy pre-status docs are posted
  function postTitle(p) { return p.description || p.productName || p.eventName || (p.caption || '').slice(0, 60) || '(untitled post)'; }
  function platformNames(p) {
    var list = Array.isArray(p.platforms) ? p.platforms : (p.platform ? [p.platform] : []);
    var seen = {}, out = [];
    list.forEach(function (v) { var l = PLATFORM_LABEL[String(v).toLowerCase()] || v; if (!seen[l]) { seen[l] = 1; out.push(l); } });
    return out;
  }
  function signalGlyph(p) { return p.signalScore === 2 ? '🔥' : (p.signalScore === 1 ? '👍' : ''); }
  // postedAt/scheduledFor arrive as Firestore Timestamps, ISO strings or millis.
  function toMs(v) {
    if (!v) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { var t = new Date(v).getTime(); return isNaN(t) ? null : t; }
    if (v && typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
    if (v && typeof v.toDate === 'function') return v.toDate().getTime();
    return null;
  }
  function postDateMs(p) { return toMs(p.postedAt) || toMs(p.scheduledFor) || toMs(p.scoredAt) || toMs(p.createdAt); }
  function canEdit() { return typeof window.can !== 'function' || window.can('social', 'edit'); }
  function bridge() {
    if (window.SocialBridge) return window.SocialBridge;
    if (window.showToast) showToast('Social engine still loading — try again', true);
    return null;
  }

  MastEntity.define('social-v2', {
    label: 'Social post', labelPlural: 'Social posts', size: 'lg', route: 'social-v2',
    recordId: function (r) { return r._key || r.postId; },
    fields: [
      { name: 'title', label: 'Post', type: 'text', list: true, readOnly: true, get: postTitle },
      { name: 'platforms', label: 'Platforms', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (p) { return platformNames(p).join(', ') || '—'; } },
      { name: 'treatment', label: 'Treatment', type: 'text', list: true, readOnly: true,
        get: function (p) { return p.treatment ? (TREATMENT_LABEL[p.treatment] || p.treatment) : '—'; } },
      { name: 'signal', label: 'Signal', type: 'text', list: true, readOnly: true, align: 'center',
        get: function (p) { return signalGlyph(p) || ''; } },
      { name: 'date', label: 'Date', type: 'date', list: true, readOnly: true,
        get: function (p) { var ms = postDateMs(p); return ms ? new Date(ms).toISOString() : null; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['posted', 'draft'], get: statusKey,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      // Cache-miss fallback keeps cross-record drills (calendar, campaigns) working cold.
      var uid = window.firebase && firebase.auth && firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
      if (!uid) return Promise.resolve(null);
      return Promise.resolve(MastDB.get('market/posts/' + uid + '/' + id)).then(function (r) {
        return r ? Object.assign({ _key: id }, r) : null;
      });
    },
    detail: {
      render: function (UI, p) {
        var id = p._key || p.postId;
        var ms = postDateMs(p);
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(statusKey(p) === 'posted' ? 'Posted' : 'Draft', STATUS_TONE[statusKey(p)] || 'neutral'), hero: true },
          { k: 'Signal', v: signalGlyph(p) || '—' },
          { k: 'Platforms', v: esc(platformNames(p).join(', ') || '—') },
          { k: statusKey(p) === 'posted' ? 'Posted' : 'Scheduled', v: ms ? N.date(new Date(ms).toISOString()) : '—' }
        ]);

        // Actions — signal toggle, mark-posted for drafts, copy caption, delete draft.
        var actions = '';
        if (canEdit()) {
          actions += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px;">' +
            '<button class="btn btn-secondary btn-small" onclick="SocialV2.signal(\'' + esc(id) + '\',1)">👍 Worked</button>' +
            '<button class="btn btn-secondary btn-small" onclick="SocialV2.signal(\'' + esc(id) + '\',2)">🔥 Really worked</button>' +
            (statusKey(p) === 'draft'
              ? '<button class="btn btn-primary btn-small" onclick="SocialV2.markPosted(\'' + esc(id) + '\')">Mark posted ✓</button>' : '') +
            '<button class="btn btn-secondary btn-small" onclick="SocialV2.copyCaption(\'' + esc(id) + '\')">⧉ Copy caption</button>' +
            (statusKey(p) === 'draft' && (typeof window.can !== 'function' || window.can('social', 'delete'))
              ? '<button class="btn btn-secondary btn-small" style="color:var(--text-danger);" onclick="SocialV2.removeDraft(\'' + esc(id) + '\')">Delete draft</button>' : '') +
          '</div>';
        }
        // Part-of-campaign chip — single-sourced renderer in campaigns.js (Wave 3).
        var campChip = '<div id="socialCampChip_' + esc(id) + '"></div>';
        setTimeout(function () {
          if (window.MastAdmin && MastAdmin.loadModule) {
            MastAdmin.loadModule('campaigns').then(function () {
              if (window.CampaignsBridge && CampaignsBridge.renderChipInto) CampaignsBridge.renderChipInto('socialCampChip_' + id, id);
            }).catch(function () {});
          }
        }, 0);

        var media = p.thumbnailUrl
          ? UI.card('Media', '<div>' + UI.imageThumb(postTitle(p), p.thumbnailUrl) + '</div>')
          : '';

        var captionBody = p.caption
          ? '<div style="font-size:0.9rem;line-height:1.55;white-space:pre-wrap;">' + esc(p.caption) + '</div>'
          : '<span class="mu-sub">No caption saved.</span>';
        if (p.hashtags) captionBody += '<div class="mu-sub" style="margin-top:8px;font-family:monospace;font-size:0.78rem;">' + esc(p.hashtags) + '</div>';

        var meta = UI.kv([
          { k: 'Treatment', v: p.treatment ? esc(TREATMENT_LABEL[p.treatment] || p.treatment) : '—' },
          { k: 'Content type', v: esc(p.contentType || '—') },
          { k: 'Product', v: p.productName ? esc(p.productName) : '—' },
          { k: 'Event', v: p.eventName ? esc(p.eventName) : '—' },
          { k: 'Source', v: p.sourceContentId
              ? 'Composer · <a href="#composer" style="color:var(--teal);">' + esc(String(p.sourceContentId).slice(0, 12)) + '…</a>'
              : esc(p.source || 'studio') },
          { k: 'Scheduled for', v: toMs(p.scheduledFor) ? N.date(new Date(toMs(p.scheduledFor)).toISOString()) : '—' },
          { k: 'Posted at', v: toMs(p.postedAt) ? N.date(new Date(toMs(p.postedAt)).toISOString()) : '—' }
        ]);

        return tiles + actions + media + UI.card('Caption', captionBody) + UI.card('Details', meta) + campChip;
      },
      editRender: function (p, mode) {
        p = p || {};
        function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        var plats = Array.isArray(p.platforms) ? p.platforms : [];
        function cb(val, label) {
          return '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:0.9rem;">' +
            '<input type="checkbox" class="smV2Plat" value="' + val + '"' + (plats.indexOf(val) >= 0 ? ' checked' : '') + '> ' + label + '</label>';
        }
        var schedMs = toMs(p.scheduledFor);
        var schedVal = schedMs ? new Date(schedMs).toISOString().slice(0, 10) : '';
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Edit this post</div>' +
          fg('Title / description', '<input class="form-input" id="smV2Desc" value="' + esc(p.description || '') + '" style="width:100%;" placeholder="What this post is about">') +
          fg('Caption', '<textarea class="form-input" id="smV2Caption" rows="5" style="width:100%;resize:vertical;">' + esc(p.caption || '') + '</textarea>') +
          fg('Hashtags', '<input class="form-input" id="smV2Hashtags" value="' + esc(p.hashtags || '') + '" style="width:100%;" placeholder="#glassart #handmade">') +
          fg('Platforms', '<div style="padding:4px 0;">' + cb('instagram-reels', 'Instagram') + cb('facebook', 'Facebook') + cb('x', 'X') + '</div>') +
          (statusKey(p) === 'draft'
            ? fg('Scheduled for', '<input class="form-input" type="date" id="smV2Sched" value="' + schedVal + '" style="width:100%;">')
            : '');
      }
    },
    onSave: function (rec) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to edit social posts.', true); return false; }
      var b = bridge(); if (!b) return false;
      function val(id) { return ((document.getElementById(id) || {}).value || ''); }
      var patch = {
        description: val('smV2Desc') || null,
        caption: val('smV2Caption'),
        hashtags: val('smV2Hashtags') || null,
        platforms: Array.prototype.slice.call(document.querySelectorAll('.smV2Plat:checked')).map(function (el) { return el.value; })
      };
      if (statusKey(rec) === 'draft') {
        var s = val('smV2Sched');
        patch.scheduledFor = s ? new Date(s + 'T12:00:00') : null;
      }
      var id = rec._key || rec.postId;
      return Promise.resolve(b.update(id, patch)).then(function () {
        Object.assign(V2.byId[id] || rec, patch);
        if (window.showToast) showToast('Post updated.');
        render();
        return true;
      }).catch(function (e) { console.error('[social-v2] save', e); if (window.showToast) showToast('Error saving post.', true); return false; });
    }
  });

  // -- module state + data ---------------------------------------------
  // pendingClipDocs: the raw not-yet-processed clip docs (clipId, thumbnailUrl,
  // fileUrl, fileType, duration, fileSize, fileName) — kept (not just counted)
  // so a pending clip can be RESUMED natively into the create wizard (S5).
  var V2 = { rows: [], byId: {}, sortKey: 'date', sortDir: 'desc', q: '', statusFilter: 'all', pendingClips: 0, pendingClipDocs: [], loaded: false };

  function load() {
    // Ensure legacy social.js is loaded so window.SocialBridge (the delegated
    // write path) exists — mirrors campaigns-v2 / CampaignsBridge.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('social'); } catch (e) {} }
    var uid = window.firebase && firebase.auth && firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
    if (!uid) { V2.loaded = true; render(); return; }
    Promise.all([
      Promise.resolve(MastDB.market.posts.list(uid)).catch(function () { return {}; }),
      Promise.resolve(MastDB.market.pendingClips.list(uid)).catch(function () { return {}; })
    ]).then(function (res) {
      var posts = res[0] || {}, clips = res[1] || {};
      var out = [];
      Object.keys(posts).forEach(function (k) {
        var p = posts[k];
        if (p && typeof p === 'object') out.push(Object.assign({ _key: k }, p));
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      var pending = [];
      Object.keys(clips).forEach(function (k) {
        var c = clips[k];
        if (c && typeof c === 'object' && c.status !== 'processed') {
          pending.push(Object.assign({ clipId: c.clipId || k }, c));
        }
      });
      V2.pendingClipDocs = pending;
      V2.pendingClips = pending.length;
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[social-v2] load', e); V2.loaded = true; render(); });
  }
  function reloadSoon() { setTimeout(load, 250); }

  // ====================================================================
  // Native "I have a clip" create flow (marketing-v2 S2). Replaced the old
  // classic-view punt: upload → details → AI captions → post, all
  // single-sourced through SocialBridge.uploadClip / generateCaptions /
  // createPost. Pending clips resume into this same flow at the details step
  // (S5). Pre-shoot (no-clip) shoot cards, AI readiness score, coupon attach
  // and caption-in-Claude are the S6 extras layered on below.
  //
  // The slide-out renders once; each step re-renders the inner container
  // (#smCreateBody) in place via innerHTML, holding wizard state in CREATE.
  // ====================================================================
  var CREATE = null;
  function freshCreate() {
    return {
      mode: 'clip',          // 'clip' (upload→post) | 'shoot' (pre-shoot plan)
      step: 'upload',        // clip: upload → details → captions → post
      uploading: false,
      clipId: null, fileUrl: null, thumbnailUrl: null, fileType: null,
      duration: null, fileSize: null, fileName: null,
      thumbnailBase64: null, // for the advisory readiness vision check (B)
      subjectType: 'none',   // product | event | none
      productId: null, productName: null, productPriceCents: 0,
      productMaterials: null, productCategory: null,
      eventName: '', description: '',
      treatment: null, destinations: [],
      captions: [], selectedCaptionIdx: 0, hashtags: null, generating: false,
      // (B) advisory readiness — score+feedback chip + client warn-only checks.
      readiness: null, readinessChecks: [], readinessRan: false, readinessRunning: false,
      // (C) coupon attach — claim URL appended to the selected caption.
      attachedCoupon: null,
      // (A) pre-shoot shoot-card — AI shot list + saved as a pending clip.
      shootGenerating: false, shootBullets: null, shootSaving: false,
      // (A) when resuming a pre-shoot plan, the planning doc key to retire on post.
      preShootClipId: null
    };
  }
  function createBodyEl() { return document.getElementById('smCreateBody'); }
  function createStepHtml() {
    if (!CREATE) return '';
    // (A) Pre-shoot plan mode is a separate two-step flow: details → shootCard.
    if (CREATE.mode === 'shoot') {
      return CREATE.step === 'shootCard' ? createShootCardStep() : createShootDetailsStep();
    }
    if (CREATE.step === 'details') return createDetailsStep();
    if (CREATE.step === 'captions') return createCaptionsStep();
    if (CREATE.step === 'post') return createPostStep();
    return createUploadStep();
  }
  function renderCreate() {
    var el = createBodyEl();
    if (!el || !CREATE) return;
    el.innerHTML = createStepHtml();
  }
  // Open the create slide-out, seeding the inner body from CREATE.step so a
  // fresh create starts at upload and a clip RESUME starts at details (S5).
  function openCreatePane() {
    var isShoot = CREATE && CREATE.mode === 'shoot';
    U.slideOut.open({
      id: 'social-create',
      title: isShoot ? 'Plan a shoot' : 'New social post',
      subtitle: isShoot ? 'Details → shoot card' : 'Upload → captions → post',
      size: 'lg', mode: 'read', deepLink: false,
      render: function () { return '<div id="smCreateBody">' + createStepHtml() + '</div>'; }
    });
  }
  function stepDots() {
    // (A) Pre-shoot plan mode shows its own two-dot rail.
    if (CREATE.mode === 'shoot') {
      var shootSteps = [['details', 'Details'], ['shootCard', 'Shoot card']];
      var shootCur = CREATE.step === 'shootCard' ? 1 : 0;
      return '<div style="display:flex;gap:6px;align-items:center;margin:0 0 16px;flex-wrap:wrap;">' +
        shootSteps.map(function (s, i) {
          var on = i === shootCur, past = i < shootCur;
          var color = on ? 'var(--teal)' : (past ? 'var(--text-secondary)' : 'var(--text-tertiary)');
          return '<span style="font-size:0.78rem;color:' + color + ';font-weight:' + (on ? '600' : '400') + ';">' +
            (past ? '✓ ' : (i + 1) + '. ') + s[1] + '</span>' +
            (i < shootSteps.length - 1 ? '<span style="color:var(--text-tertiary);font-size:0.78rem;">›</span>' : '');
        }).join('') + '</div>';
    }
    var steps = [['upload', 'Upload'], ['details', 'Details'], ['captions', 'Captions'], ['post', 'Post']];
    var doneAt = { upload: 0, details: 1, captions: 2, post: 3 };
    var cur = doneAt[CREATE.step];
    return '<div style="display:flex;gap:6px;align-items:center;margin:0 0 16px;flex-wrap:wrap;">' +
      steps.map(function (s, i) {
        var on = i === cur, past = i < cur;
        var color = on ? 'var(--teal)' : (past ? 'var(--text-secondary)' : 'var(--text-tertiary)');
        return '<span style="font-size:0.78rem;color:' + color + ';font-weight:' + (on ? '600' : '400') + ';">' +
          (past ? '✓ ' : (i + 1) + '. ') + s[1] + '</span>' +
          (i < steps.length - 1 ? '<span style="color:var(--text-tertiary);font-size:0.78rem;">›</span>' : '');
      }).join('') + '</div>';
  }

  // ---- Step 1: upload ----
  function createUploadStep() {
    var c = CREATE;
    var inner;
    if (c.clipId) {
      var thumb = c.thumbnailUrl
        ? '<img src="' + esc(c.thumbnailUrl) + '" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid var(--cream-dark);">'
        : '<div style="width:96px;height:96px;border-radius:8px;border:1px solid var(--cream-dark);display:flex;align-items:center;justify-content:center;font-size:1.6rem;">' + (c.fileType === 'video' ? '🎬' : '📷') + '</div>';
      inner = '<div style="display:flex;gap:14px;align-items:center;">' + thumb +
        '<div><div style="font-weight:600;font-size:0.9rem;">' + esc(c.fileName || 'Clip uploaded') + '</div>' +
        '<div class="mu-sub" style="font-size:0.78rem;">' + esc(c.fileType || '') +
          (c.duration ? ' · ' + Math.round(c.duration) + 's' : '') +
          (c.fileSize ? ' · ' + (c.fileSize / 1048576).toFixed(1) + ' MB' : '') + '</div>' +
        '<button class="btn btn-secondary btn-small" style="margin-top:8px;" onclick="SocialV2.createPickFile()">Replace clip</button></div></div>';
    } else if (c.uploading) {
      inner = '<div class="mu-sub" style="margin-bottom:8px;">Uploading…</div>' +
        '<div style="height:8px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:6px;overflow:hidden;">' +
          '<div id="smCreateProg" style="height:100%;width:0%;background:var(--teal);transition:width 0.15s;"></div></div>' +
        '<div class="mu-sub" id="smCreateProgTxt" style="margin-top:6px;font-size:0.78rem;">0%</div>';
    } else {
      inner = '<button class="btn btn-primary" onclick="SocialV2.createPickFile()">🎬 Choose a video or photo</button>' +
        '<div class="mu-sub" style="margin-top:8px;font-size:0.78rem;">Upload a clip from your camera roll. Video or image.</div>';
    }
    return stepDots() + U.card('Upload your clip', inner) + createNav();
  }

  // Product <select> for the subject picker — broken out so it can be
  // re-rendered in place when an async products load resolves (ensureProducts).
  function productPickerHtml() {
    var c = CREATE;
    var products = window.productsData || [];
    var opts = '<option value="">— Choose a product —</option>';
    products.forEach(function (p) {
      var priceStr = (typeof p.priceCents === 'number' && p.priceCents > 0 && window.formatCents) ? (' — ' + window.formatCents(p.priceCents)) : '';
      opts += '<option value="' + esc(p.pid) + '"' + (c.productId === p.pid ? ' selected' : '') + '>' + esc(p.name) + priceStr + '</option>';
    });
    return '<div class="form-group" style="margin-top:12px;"><label class="form-label">Select product</label>' +
      '<select class="form-input" id="smCreateProduct" onchange="SocialV2.createSetProduct(this.value)" style="width:100%;">' + opts + '</select>' +
      (products.length ? '' : '<div class="mu-sub" style="margin-top:4px;font-size:0.78rem;">Loading products…</div>') + '</div>';
  }
  // Kick off the global product load (if not already loaded) and, when it
  // resolves, re-render JUST the product picker sub-region so the list appears
  // without a manual reload. Non-blocking: the rest of the wizard (incl. the
  // "No specific product" path) stays usable immediately.
  function ensureProducts() {
    if ((window.productsData && window.productsData.length) || typeof window.loadProducts !== 'function') return;
    var p;
    try { p = window.loadProducts(); } catch (e) { return; }
    if (!p || typeof p.then !== 'function') return;
    p.then(function () {
      var host = document.getElementById('smCreateProductPicker');
      if (host && CREATE && CREATE.subjectType === 'product') host.innerHTML = productPickerHtml();
    }).catch(function () {});
  }

  // ---- shared details building blocks (clip + shoot modes) ----
  function subjectSection(captionLabel) {
    var c = CREATE;
    function seg(val, label) {
      var on = c.subjectType === val;
      return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="SocialV2.createSubject(\'' + val + '\')">' + label + '</button>';
    }
    var subjectRow = '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + seg('product', 'Product') + seg('event', 'Event') + seg('none', 'No specific product') + '</div>';
    var subjectDetail = '';
    if (c.subjectType === 'product') {
      // Stable container so the product <select> can be re-rendered in place
      // once an async loadProducts() resolves (the list is empty on the very
      // first #social-v2 open before products finish loading — see ensureProducts).
      subjectDetail = '<div id="smCreateProductPicker">' + productPickerHtml() + '</div>';
    } else if (c.subjectType === 'event') {
      subjectDetail = '<div class="form-group" style="margin-top:12px;"><label class="form-label">Event name</label>' +
        '<input class="form-input" id="smCreateEvent" value="' + esc(c.eventName || '') + '" placeholder="e.g. Spring Craft Fair" oninput="SocialV2.createField(\'eventName\', this.value)" style="width:100%;"></div>';
    }
    var captionDraft = '<div class="form-group" style="margin-top:12px;"><label class="form-label">' + esc(captionLabel || 'Caption focus') + ' <span class="mu-sub" style="font-weight:400;">(optional)</span></label>' +
      '<textarea class="form-input" id="smCreateDesc" rows="2" placeholder="What should this call out?" oninput="SocialV2.createField(\'description\', this.value)" style="width:100%;resize:vertical;">' + esc(c.description || '') + '</textarea></div>';
    return subjectRow + subjectDetail + captionDraft;
  }
  function treatmentSection() {
    var c = CREATE;
    return '<div style="display:flex;flex-direction:column;gap:8px;">' +
      CREATE_TREATMENTS.map(function (t) {
        var on = c.treatment === t.id;
        return '<div onclick="SocialV2.createTreatment(\'' + t.id + '\')" style="cursor:pointer;padding:10px 12px;border:1px solid ' + (on ? 'var(--teal)' : 'var(--cream-dark)') + ';border-radius:8px;background:' + (on ? 'var(--teal-bg, var(--cream))' : 'transparent') + ';">' +
          '<div style="font-weight:600;font-size:0.85rem;">' + esc(t.name) + (on ? ' ✓' : '') + '</div>' +
          '<div class="mu-sub" style="font-size:0.78rem;">' + esc(t.desc) + '</div></div>';
      }).join('') + '</div>';
  }
  function destSection() {
    var c = CREATE;
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      CREATE_DESTS.map(function (d) {
        var on = c.destinations.indexOf(d.id) >= 0;
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="SocialV2.createDest(\'' + d.id + '\')">' + (on ? '✓ ' : '') + d.label + '</button>';
      }).join('') + '</div>';
  }

  // ---- Step 2: details ----
  function createDetailsStep() {
    return stepDots() +
      U.card('What\'s this about?', subjectSection('Caption focus')) +
      U.card('Content style', treatmentSection()) +
      U.card('Destinations', destSection()) +
      createNav();
  }

  // ====================================================================
  // (A) Pre-shoot "Plan a shoot" flow — details → shoot card. No clip yet:
  // the AI drafts a shot list for a post you haven't filmed, then "Save shoot
  // plan" persists it as a PENDING CLIP (status pending-clip via
  // SocialBridge.saveShootCard) so it shows in the pending-clips list and
  // resumes into the normal upload→post wizard once filmed (existing
  // resumeClip). Ports legacy smPreShoot / smGenerateShootCard / smFinishPreShoot.
  // ====================================================================
  function shootSubject() {
    var c = CREATE;
    return (c.subjectType === 'product' ? c.productName : (c.subjectType === 'event' ? c.eventName : c.description)) || 'glass art piece';
  }
  function createShootDetailsStep() {
    return stepDots() +
      U.card('What are you about to shoot?', subjectSection('Shoot notes')) +
      U.card('Content style', treatmentSection()) +
      U.card('Destinations', destSection()) +
      createNav();
  }
  function createShootCardStep() {
    var c = CREATE;
    var t = CREATE_TREATMENTS.filter(function (x) { return x.id === c.treatment; })[0];
    var inner;
    if (c.shootGenerating) {
      inner = scopedSpinner('Generating your shoot card…');
    } else if (!c.shootBullets) {
      inner = '<button class="btn btn-primary" onclick="SocialV2.shootGenerate()">✨ Generate shoot card</button>' +
        '<div class="mu-sub" style="margin-top:8px;font-size:0.78rem;">A shot list tailored to your subject and content style — read it before you film.</div>';
    } else {
      inner = (t ? '<div style="font-weight:600;font-size:0.9rem;margin-bottom:8px;">' + esc(t.name) + '</div>' : '') +
        '<ul style="margin:0;padding-left:18px;font-size:0.85rem;line-height:1.7;">' +
        c.shootBullets.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') +
        '</ul>' +
        (t && SHOOT_TIPS[t.id] ? '<div class="mu-sub" style="margin-top:10px;font-size:0.78rem;">' + esc(SHOOT_TIPS[t.id]) + '</div>' : '') +
        '<div style="margin-top:12px;"><button class="btn btn-secondary btn-small" onclick="SocialV2.shootGenerate()">↻ Regenerate</button></div>';
    }
    return stepDots() + U.card('Your shoot card', inner) + createNav();
  }

  // ====================================================================
  // (B) Readiness — ADVISORY only, never blocks posting. Client-side
  // orientation/duration/filesize warnings (warn-only, mirror legacy
  // smRunReadinessAndCaptions ~997-1038) + an AI treatment-fit score via
  // SocialBridge.checkReadiness (socialAI readiness vision action). Degrades
  // silently if the CF returns null. Rendered as a chip on the captions step.
  // ====================================================================
  function buildClientReadinessChecks() {
    var c = CREATE, checks = [];
    if (c.fileType === 'video') {
      if (c.duration) {
        var dur = Math.round(c.duration);
        if (dur < 5) checks.push({ status: 'warn', label: 'Duration', msg: dur + 's — may be too short for engagement' });
        else if (dur > 90) checks.push({ status: 'warn', label: 'Duration', msg: dur + 's — consider trimming to under 60s' });
        else checks.push({ status: 'ok', label: 'Duration', msg: dur + 's — good length' });
      }
    }
    if (c.fileSize && c.fileSize > 500 * 1048576) {
      checks.push({ status: 'warn', label: 'File size', msg: (c.fileSize / 1048576).toFixed(0) + ' MB — large file, upload may be slow' });
    }
    return checks;
  }
  // Run once per clip: client checks immediately, then the AI vision fit (async,
  // advisory). Re-renders in place. No-ops without a clip.
  function runReadiness() {
    var c = CREATE;
    if (!c || !c.clipId || c.readinessRan || c.readinessRunning) return;
    c.readinessRunning = true;
    c.readinessChecks = buildClientReadinessChecks();
    var b = bridge();
    var p = (b && c.thumbnailBase64)
      ? Promise.resolve(b.checkReadiness({ treatment: c.treatment, thumbnailBase64: c.thumbnailBase64 })).catch(function () { return null; })
      : Promise.resolve(null);
    p.then(function (res) {
      if (!CREATE) return;
      CREATE.readiness = res || null;
      CREATE.readinessRan = true;
      CREATE.readinessRunning = false;
      if (CREATE.step === 'captions') renderCreate();
    });
  }
  // Advisory chip — AI treatment-fit score (if any) + client warn-only checks.
  // Never gates the flow; absent entirely when there's nothing to show.
  function readinessChip() {
    var c = CREATE;
    if (!c || !c.clipId) return '';
    if (c.readinessRunning && !c.readinessRan) {
      return U.card('Clip readiness', scopedSpinner('Checking your clip…'));
    }
    var rows = '';
    if (c.readiness && c.readiness.score) {
      var score = c.readiness.score;
      var tone = score >= 7 ? 'success' : (score >= 4 ? 'warning' : 'danger');
      rows += '<div style="margin-bottom:8px;">' + U.badge('Treatment fit ' + score + '/10', tone) +
        (c.readiness.feedback ? '<span class="mu-sub" style="margin-left:8px;font-size:0.78rem;">' + esc(c.readiness.feedback) + '</span>' : '') + '</div>';
    }
    (c.readinessChecks || []).forEach(function (chk) {
      var icon = chk.status === 'ok' ? '✅' : '⚠️';
      rows += '<div style="font-size:0.85rem;line-height:1.6;">' + icon + ' <strong>' + esc(chk.label) + ':</strong> ' + esc(chk.msg) + '</div>';
    });
    if (!rows) return '';
    return U.card('Clip readiness <span class="mu-sub" style="font-weight:400;font-size:0.78rem;">(advisory)</span>', rows);
  }

  // (D) Caption-in-Claude available only when Ask AI is configured (mirrors the
  // legacy showClaudeBtn gate in social.js renderSMEnhance).
  function claudeEnabled() {
    return !!(window.MastAskAi && typeof MastAskAi.isEnabled === 'function' && MastAskAi.isEnabled());
  }
  function claudeBtn(small) {
    if (!claudeEnabled()) return '';
    return '<button class="btn btn-secondary ' + (small ? 'btn-small' : '') + '" onclick="SocialV2.createDraftInClaude()" title="Opens Ask AI to draft a caption">✨ Draft in Claude</button>';
  }

  // ---- Step 3: captions ----
  function createCaptionsStep() {
    var c = CREATE;
    // (B) advisory readiness runs once when the captions step opens.
    runReadiness();
    var inner;
    if (c.generating) {
      inner = scopedSpinner('Generating captions…');
    } else if (!c.captions.length) {
      inner = '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-primary" onclick="SocialV2.createGenerate()">✨ Generate captions</button>' +
        claudeBtn(false) + '</div>' +
        '<div class="mu-sub" style="margin-top:8px;font-size:0.78rem;">Uses your subject + content style to draft caption options and hashtags' + (claudeEnabled() ? ', or draft one in Claude' : '') + '.</div>';
    } else {
      inner = c.captions.map(function (cap, idx) {
        var on = idx === c.selectedCaptionIdx;
        var card = '<div onclick="SocialV2.createSelectCaption(' + idx + ')" style="cursor:pointer;padding:10px 12px;border:1px solid ' + (on ? 'var(--teal)' : 'var(--cream-dark)') + ';border-radius:8px;margin-bottom:8px;">' +
          '<div style="font-weight:600;font-size:0.78rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;">' + esc(cap.style || ('Option ' + (idx + 1))) + (on ? ' ✓' : '') + '</div>';
        if (on) {
          card += '<textarea class="form-input" id="smCreateCaptionEdit" rows="4" oninput="SocialV2.createEditCaption(this.value)" style="width:100%;margin-top:8px;resize:vertical;font-size:0.85rem;">' + esc(cap.text || '') + '</textarea>';
        } else {
          card += '<div style="margin-top:6px;font-size:0.85rem;line-height:1.5;">' + esc(cap.text || '') + '</div>';
        }
        return card + '</div>';
      }).join('') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary btn-small" onclick="SocialV2.createGenerate()">↻ Regenerate</button>' +
        claudeBtn(true) + '</div>';
    }
    var captionCard = U.card('Choose a caption', inner);

    var hashCard = '';
    if (c.hashtags) {
      function tier(label, arr) {
        if (!arr || !arr.length) return '';
        return '<div style="margin-bottom:8px;"><div class="mu-sub" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.04em;">' + label + '</div>' +
          '<div style="font-family:monospace;font-size:0.78rem;line-height:1.5;">' + esc(arr.join(' ')) + '</div></div>';
      }
      hashCard = U.card('Hashtags',
        tier('Niche', c.hashtags.niche) + tier('Mid-range', c.hashtags.mid) + tier('Broad', c.hashtags.broad) +
        '<button class="btn btn-secondary btn-small" onclick="SocialV2.createCopyHashtags()">⧉ Copy all hashtags</button>');
    }

    var guideCard = (c.destinations.indexOf('instagram-reels') >= 0 || c.destinations.indexOf('instagram-feed') >= 0)
      ? U.card('Instagram posting guide',
          '<ol style="margin:0;padding-left:18px;font-size:0.85rem;line-height:1.7;">' +
            '<li>Open Instagram and start a new Reel or post.</li>' +
            '<li>Pick your clip from the camera roll. Spec: 9:16 portrait · 15–90s · MP4/MOV.</li>' +
            '<li>Paste your caption (copy below) and add the hashtags.</li>' +
            '<li>Set a strong cover frame, then share.</li>' +
            '<li>Come back here and hit Post to log it to your record.</li>' +
          '</ol>' +
          '<button class="btn btn-secondary btn-small" style="margin-top:8px;" onclick="SocialV2.createCopyCaption()">⧉ Copy caption</button>')
      : '';

    return stepDots() + readinessChip() + captionCard + couponCard() + hashCard + guideCard + createNav();
  }

  // ====================================================================
  // (C) Coupon attach — pick an active coupon (window.coupons) and append its
  // claim URL (MastCouponCard.getClaimUrl) to the SELECTED caption. Reattachable
  // / removable. Ports legacy smPickCoupon + the caption-append in
  // smRunReadinessAndCaptions (~1106). Only shown once a caption exists.
  // ====================================================================
  function couponClaimUrl(code) {
    return (window.MastCouponCard && MastCouponCard.getClaimUrl) ? MastCouponCard.getClaimUrl(code, 'social') : null;
  }
  // Remove a previously-appended coupon claim line from the SELECTED caption so
  // re-attaching / removing / editing the caption doesn't double-stack links.
  function stripCouponFromCaption() {
    var c = CREATE;
    if (!c || !c.attachedCoupon) return;
    var cap = c.captions[c.selectedCaptionIdx];
    if (!cap || !cap.text) return;
    cap.text = cap.text.replace(/\n*\s*🏷️ Claim your coupon: \S+\s*$/, '').replace(/\s+$/, '');
  }
  function couponLine(code) {
    var all = window.coupons || {};
    var cpn = all[code];
    if (!cpn) return esc(code);
    var val = cpn.type === 'percent' ? (cpn.value + '% off') : ('$' + Number(cpn.value || 0).toFixed(2) + ' off');
    return '<span style="font-family:monospace;font-weight:600;">' + esc(code) + '</span> — ' + esc(val);
  }
  function couponCard() {
    var c = CREATE;
    if (!c.captions.length) return '';
    var body;
    if (c.attachedCoupon) {
      body = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
        '<span>🏷️ ' + couponLine(c.attachedCoupon) + '</span>' +
        '<button class="btn btn-secondary btn-small" onclick="SocialV2.createRemoveCoupon()">Remove</button></div>' +
        '<div class="mu-sub" style="margin-top:6px;font-size:0.78rem;">Claim link appended to the selected caption.</div>';
    } else {
      body = '<button class="btn btn-secondary btn-small" onclick="SocialV2.createPickCoupon()">🏷️ Attach coupon</button>' +
        '<div class="mu-sub" style="margin-top:6px;font-size:0.78rem;">Adds a coupon claim link to your caption.</div>';
    }
    return U.card('Attach coupon <span class="mu-sub" style="font-weight:400;font-size:0.78rem;">(optional)</span>', body);
  }

  // ---- Step 4: post (review + write) ----
  function createPostStep() {
    var c = CREATE;
    var cap = c.captions[c.selectedCaptionIdx];
    var plats = createPlatforms();
    var rows = U.kv([
      { k: 'Caption', v: cap && cap.text ? esc(cap.text) : '<span class="mu-sub">No caption selected</span>' },
      { k: 'Subject', v: c.subjectType === 'product' ? esc(c.productName || '(product)') : (c.subjectType === 'event' ? esc(c.eventName || '(event)') : 'General') },
      { k: 'Treatment', v: c.treatment ? esc(TREATMENT_LABEL[c.treatment] || c.treatment) : '—' },
      { k: 'Platforms', v: esc(plats.map(function (p) { return PLATFORM_LABEL[p] || p; }).join(', ') || 'Instagram') },
      { k: 'Hashtags', v: c.hashtags ? esc([].concat(c.hashtags.niche || [], c.hashtags.mid || [], c.hashtags.broad || []).slice(0, 6).join(' ')) + (([].concat(c.hashtags.niche || [], c.hashtags.mid || [], c.hashtags.broad || []).length > 6) ? ' …' : '') : '—' }
    ]);
    var media = c.thumbnailUrl
      ? '<div style="margin-bottom:12px;"><img src="' + esc(c.thumbnailUrl) + '" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid var(--cream-dark);"></div>'
      : '';
    return stepDots() +
      U.card('Review & post', media + rows +
        '<div class="mu-sub" style="margin-top:10px;font-size:0.78rem;">This records the post to your posting history with today\'s date.</div>') +
      createNav();
  }

  // ---- nav buttons per step ----
  function createNav() {
    var c = CREATE;
    var back = '', next = '';
    // (A) Pre-shoot plan mode nav.
    if (c.mode === 'shoot') {
      if (c.step === 'details') {
        next = '<button class="btn btn-primary" ' + (c.treatment ? '' : 'disabled') + ' onclick="SocialV2.shootGoto(\'shootCard\')">Next: Shoot card →</button>';
        var dhint = c.treatment ? '' : 'Pick a content style to continue';
        return '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;">' +
          '<div></div><div style="display:flex;gap:8px;align-items:center;">' +
          (dhint ? '<span class="mu-sub" style="font-size:0.78rem;">' + dhint + '</span>' : '') + next + '</div></div>';
      }
      // shootCard step: back + (when bullets exist) Save shoot plan.
      back = '<button class="btn btn-secondary" onclick="SocialV2.shootGoto(\'details\')">← Back</button>';
      next = c.shootBullets
        ? '<button class="btn btn-primary" ' + (c.shootSaving ? 'disabled' : '') + ' onclick="SocialV2.shootSave()">Save shoot plan ✓</button>'
        : '';
      var shint = c.shootBullets ? '' : 'Generate a shoot card to save your plan';
      return '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;">' +
        '<div>' + back + '</div><div style="display:flex;gap:8px;align-items:center;">' +
        (shint ? '<span class="mu-sub" style="font-size:0.78rem;">' + shint + '</span>' : '') + next + '</div></div>';
    }
    if (c.step === 'upload') {
      next = '<button class="btn btn-primary" ' + (c.clipId ? '' : 'disabled') + ' onclick="SocialV2.createGoto(\'details\')">Next: Details →</button>';
    } else if (c.step === 'details') {
      back = '<button class="btn btn-secondary" onclick="SocialV2.createGoto(\'upload\')">← Back</button>';
      next = '<button class="btn btn-primary" ' + (c.treatment ? '' : 'disabled') + ' onclick="SocialV2.createGoto(\'captions\')">Next: Captions →</button>';
    } else if (c.step === 'captions') {
      back = '<button class="btn btn-secondary" onclick="SocialV2.createGoto(\'details\')">← Back</button>';
      next = '<button class="btn btn-primary" ' + (c.captions.length ? '' : 'disabled') + ' onclick="SocialV2.createGoto(\'post\')">Next: Review →</button>';
    } else if (c.step === 'post') {
      back = '<button class="btn btn-secondary" onclick="SocialV2.createGoto(\'captions\')">← Back</button>';
      next = '<button class="btn btn-primary" onclick="SocialV2.createSubmit()">Post ✓</button>';
    }
    var hint = '';
    if (c.step === 'upload' && !c.clipId) hint = 'Upload a clip to continue';
    else if (c.step === 'details' && !c.treatment) hint = 'Pick a content style to continue';
    else if (c.step === 'captions' && !c.captions.length) hint = 'Generate captions to continue';
    return '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;">' +
      '<div>' + back + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        (hint ? '<span class="mu-sub" style="font-size:0.78rem;">' + hint + '</span>' : '') + next +
      '</div></div>';
  }

  function createPlatforms() {
    // Map the chosen destinations to platform tokens the post record stores.
    var plats = CREATE.destinations.slice();
    return plats.length ? plats : ['instagram-reels'];
  }

  function buildCaptionCtx() {
    var c = CREATE;
    var platform = c.destinations[0] || 'instagram-reels';
    return {
      treatment: c.treatment || null,
      platform: platform,
      productName: c.subjectType === 'product' ? (c.productName || null) : null,
      productPrice: (c.subjectType === 'product' && c.productPriceCents && window.formatCents) ? window.formatCents(c.productPriceCents) : null,
      productMaterials: c.subjectType === 'product' ? (c.productMaterials || null) : null,
      productCategory: c.subjectType === 'product' ? (c.productCategory || null) : null,
      eventName: c.subjectType === 'event' ? (c.eventName || null) : null,
      description: c.description || null
    };
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (p) { return statusKey(p) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (p) {
        return String(p.caption || '').toLowerCase().indexOf(q) >= 0 ||
               String(p.description || '').toLowerCase().indexOf(q) >= 0 ||
               String(p.productName || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('social-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('socialV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'socialV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Social Media' }) + scopedSpinner('Loading…', 'margin-top:14px;');
      return;
    }
    var filters = [['all', 'All'], ['posted', 'Posted'], ['draft', 'Drafts']].map(function (f) {
      var on = V2.statusFilter === f[0];
      return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="SocialV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
    }).join(' ');
    var clipsNote = (V2.pendingClips && canEdit())
      ? '<div style="margin:12px 0;padding:12px 14px;border:1px solid var(--cream-dark);border-radius:8px;">' +
          '<div style="font-size:0.9rem;margin-bottom:8px;">📎 ' + N.count(V2.pendingClips) + ' clip' + (V2.pendingClips === 1 ? '' : 's') +
            ' uploaded but not yet posted — finish one into a post.</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
            V2.pendingClipDocs.map(function (c) {
              var thumb = c.thumbnailUrl
                ? '<img src="' + esc(c.thumbnailUrl) + '" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--cream-dark);flex-shrink:0;">'
                : '<div style="width:48px;height:48px;border-radius:6px;border:1px solid var(--cream-dark);display:flex;align-items:center;justify-content:center;font-size:1.15rem;flex-shrink:0;">' + (c.fileType === 'video' ? '🎬' : '📷') + '</div>';
              var label = esc(c.fileName || (c.fileType === 'video' ? 'Video clip' : 'Photo'));
              return '<div onclick="SocialV2.resumeClip(\'' + esc(c.clipId) + '\')" title="Finish this clip into a post" ' +
                'style="cursor:pointer;display:flex;gap:8px;align-items:center;padding:6px 10px 6px 6px;border:1px solid var(--cream-dark);border-radius:8px;">' +
                thumb +
                '<div style="min-width:0;"><div style="font-size:0.85rem;font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + label + '</div>' +
                '<div class="mu-sub" style="font-size:0.72rem;">Finish into a post →</div></div></div>';
            }).join('') +
          '</div></div>'
      : '';
    tab.innerHTML =
      U.pageHeader({
        title: 'Social Media',
        count: N.count(V2.rows.length) + ' post' + (V2.rows.length === 1 ? '' : 's'),
        subtitle: 'Captions, signals and the posting record.',
        actionsHtml:
          (canEdit() ? '<button class="btn btn-primary" onclick="SocialV2.create()">+ New post</button>' : '') +
          (canEdit() ? '<button class="btn btn-secondary" onclick="SocialV2.planShoot()">📸 Plan a shoot</button>' : '') +
          '<button class="btn btn-secondary" onclick="SocialV2.exportCsv()">↓ Export</button>'
      }) +
      clipsNote +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search caption, description or product…" value="' + esc(V2.q) +
        '" oninput="SocialV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('social-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'SocialV2.sort', onRowClickFnName: 'SocialV2.open',
        empty: { title: 'No social posts', message: V2.loaded ? 'Hit “+ New post” to upload a clip and draft your first post.' : 'Loading…' }
      });
  }

  window.SocialV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'date' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('social-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('social-v2', rec, 'read');
      });
    },
    // ── Native create flow (S2) ──────────────────────────────────────
    create: function () {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to create social posts.', true); return; }
      if (!bridge()) return;
      // Make sure products are available for the subject picker — loads async
      // and re-renders the picker in place when ready (ensureProducts).
      ensureProducts();
      CREATE = freshCreate();
      openCreatePane();
    },
    // (A) S6 — "Plan a shoot": pre-shoot, no clip yet. Opens the two-step
    // shoot-plan flow (details → AI shoot card → save as pending clip). Ports
    // legacy smPreShoot's branch of the "what would you like to do?" screen.
    planShoot: function () {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to create social posts.', true); return; }
      if (!bridge()) return;
      ensureProducts();
      CREATE = freshCreate();
      CREATE.mode = 'shoot';
      CREATE.step = 'details';
      openCreatePane();
    },
    shootGoto: function (step) {
      if (!CREATE) return;
      CREATE.step = step;
      renderCreate();
      if (step === 'shootCard' && !CREATE.shootBullets && !CREATE.shootGenerating) SocialV2.shootGenerate();
    },
    shootGenerate: function () {
      var b = bridge(); if (!b || !CREATE) return;
      CREATE.shootGenerating = true; renderCreate();
      var t = CREATE_TREATMENTS.filter(function (x) { return x.id === CREATE.treatment; })[0];
      var ctx = {
        treatment: CREATE.treatment || null,
        treatmentName: t ? t.name : (CREATE.treatment || null),
        subject: shootSubject(),
        productDetails: CREATE.subjectType === 'product'
          ? [CREATE.productName, (CREATE.productPriceCents && window.formatCents ? window.formatCents(CREATE.productPriceCents) : null), CREATE.productMaterials, CREATE.productCategory].filter(Boolean).join(', ')
          : '',
        destinations: CREATE.destinations
      };
      Promise.resolve(b.generateShootCard(ctx)).then(function (res) {
        if (!CREATE) return;
        CREATE.shootGenerating = false;
        CREATE.shootBullets = (res && res.bullets) || null;
        renderCreate();
      }).catch(function (err) {
        console.error('[social-v2] generateShootCard', err);
        if (CREATE) CREATE.shootGenerating = false;
        if (window.showToast) showToast('Could not generate the shoot card.', true);
        renderCreate();
      });
    },
    shootSave: function () {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to create social posts.', true); return; }
      var b = bridge(); if (!b || !CREATE || !CREATE.shootBullets || CREATE.shootSaving) return;
      CREATE.shootSaving = true; renderCreate();
      var c = CREATE;
      Promise.resolve(b.saveShootCard({
        treatment: c.treatment || null,
        subjectType: c.subjectType || null,
        productId: c.subjectType === 'product' ? (c.productId || null) : null,
        productName: c.subjectType === 'product' ? (c.productName || null) : null,
        eventName: c.subjectType === 'event' ? (c.eventName || null) : null,
        description: c.description || null,
        subject: shootSubject(),
        bullets: c.shootBullets
      })).then(function () {
        CREATE = null;
        try { U.slideOut.requestCloseForce(); } catch (e) {}
        if (window.showToast) showToast('Shoot plan saved — finish it once you\'ve filmed.');
        load();
      }).catch(function (err) {
        console.error('[social-v2] saveShootCard', err);
        if (CREATE) CREATE.shootSaving = false;
        if (window.showToast) showToast('Could not save the shoot plan: ' + (err && err.message || err), true);
        renderCreate();
      });
    },
    // S5 — resume a previously-uploaded but not-yet-posted PENDING clip into the
    // native wizard, opening directly at DETAILS with the clip already attached
    // (upload step skipped). The existing captions→post path flips the clip to
    // 'processed' via SocialBridge.createPost. Replaces the classic "process
    // clips in classic view →" hatch — no navigateToClassic.
    resumeClip: function (clipId) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to create social posts.', true); return; }
      if (!bridge()) return;
      var clip = V2.pendingClipDocs.filter(function (c) { return c.clipId === clipId; })[0];
      if (!clip) { if (window.showToast) showToast('That clip is no longer available.', true); return; }
      ensureProducts();
      CREATE = freshCreate();
      // (A) A pre-shoot plan (status 'pending-clip', no file yet) resumes at the
      // UPLOAD step — the operator attaches the filmed clip, then continues — but
      // its planned details (treatment / subject) are pre-filled. A real uploaded
      // clip resumes directly at DETAILS (the original S5 behavior).
      var isPreShoot = clip.status === 'pending-clip' || !clip.fileUrl;
      if (isPreShoot) {
        CREATE.step = 'upload';
        // Carry the original pending-clip key so the upload that follows resolves
        // this plan: createPost flips it to 'processed' via the new clipId, and
        // we drop the planning doc so it doesn't linger as a duplicate.
        CREATE.preShootClipId = clip.clipId;
        if (clip.treatment) CREATE.treatment = clip.treatment;
        if (clip.subjectType) CREATE.subjectType = clip.subjectType;
        if (clip.productId) { CREATE.productId = clip.productId; CREATE.productName = clip.productName || null; }
        if (clip.eventName) CREATE.eventName = clip.eventName;
        if (clip.description) CREATE.description = clip.description;
      } else {
        CREATE.step = 'details';
        CREATE.clipId = clip.clipId;
        CREATE.fileUrl = clip.fileUrl || null;
        CREATE.thumbnailUrl = clip.thumbnailUrl || null;
        CREATE.fileType = clip.fileType || null;
        CREATE.duration = clip.duration != null ? clip.duration : null;
        CREATE.fileSize = clip.fileSize != null ? clip.fileSize : null;
        CREATE.fileName = clip.fileName || null;
      }
      openCreatePane();
    },
    createPickFile: function () {
      if (!CREATE) return;
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*,image/*,.mp4,.mov,.jpeg,.jpg,.heic,.png';
      input.onchange = function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) SocialV2._createUpload(file);
      };
      input.click();
    },
    _createUpload: function (file) {
      var b = bridge(); if (!b || !CREATE) return;
      CREATE.uploading = true; CREATE.clipId = null; CREATE.fileName = file.name;
      renderCreate();
      b.uploadClip(file, {
        onProgress: function (pct) {
          var bar = document.getElementById('smCreateProg'), txt = document.getElementById('smCreateProgTxt');
          if (bar) bar.style.width = pct + '%';
          if (txt) txt.textContent = pct + '%';
        }
      }).then(function (clip) {
        if (!CREATE) return;
        CREATE.uploading = false;
        CREATE.clipId = clip.clipId; CREATE.fileUrl = clip.fileUrl;
        CREATE.thumbnailUrl = clip.thumbnailUrl; CREATE.fileType = clip.fileType;
        CREATE.duration = clip.duration; CREATE.fileSize = clip.fileSize;
        CREATE.thumbnailBase64 = clip.thumbnailBase64 || null;
        // (B) advisory readiness is re-derived for this fresh clip — clear any prior run.
        CREATE.readiness = null; CREATE.readinessChecks = []; CREATE.readinessRan = false;
        renderCreate();
      }).catch(function (err) {
        console.error('[social-v2] upload', err);
        if (CREATE) CREATE.uploading = false;
        if (window.showToast) showToast('Upload failed: ' + (err && err.message || err), true);
        renderCreate();
      });
    },
    createGoto: function (step) { if (CREATE) { CREATE.step = step; renderCreate(); } },
    createSubject: function (type) {
      if (!CREATE) return;
      CREATE.subjectType = type;
      if (type !== 'product') { CREATE.productId = null; CREATE.productName = null; CREATE.productPriceCents = 0; CREATE.productMaterials = null; CREATE.productCategory = null; }
      renderCreate();
      // Re-render the picker in place once products resolve (no-op if already loaded).
      if (type === 'product') ensureProducts();
    },
    createSetProduct: function (pid) {
      if (!CREATE) return;
      var products = window.productsData || [];
      var p = products.filter(function (x) { return x.pid === pid; })[0];
      CREATE.productId = pid || null;
      if (p) {
        CREATE.productName = p.name || null;
        CREATE.productPriceCents = p.priceCents || 0;
        CREATE.productMaterials = p.materials || null;
        CREATE.productCategory = p.categories ? p.categories.join(', ') : null;
      } else {
        CREATE.productName = null; CREATE.productPriceCents = 0; CREATE.productMaterials = null; CREATE.productCategory = null;
      }
      // No re-render needed — the select already reflects the choice.
    },
    createField: function (key, val) { if (CREATE) CREATE[key] = val; },
    createTreatment: function (id) { if (CREATE) { CREATE.treatment = id; renderCreate(); } },
    createDest: function (id) {
      if (!CREATE) return;
      var i = CREATE.destinations.indexOf(id);
      if (i >= 0) CREATE.destinations.splice(i, 1); else CREATE.destinations.push(id);
      renderCreate();
    },
    createGenerate: function () {
      var b = bridge(); if (!b || !CREATE) return;
      CREATE.generating = true; renderCreate();
      // Fresh captions won't carry a previously-attached coupon link.
      CREATE.attachedCoupon = null;
      b.generateCaptions(buildCaptionCtx()).then(function (res) {
        if (!CREATE) return;
        CREATE.generating = false;
        CREATE.captions = (res && res.captions) || [];
        CREATE.hashtags = (res && res.hashtags) || null;
        CREATE.selectedCaptionIdx = 0;
        renderCreate();
      }).catch(function (err) {
        console.error('[social-v2] generateCaptions', err);
        if (CREATE) CREATE.generating = false;
        if (window.showToast) showToast('Could not generate captions.', true);
        renderCreate();
      });
    },
    createSelectCaption: function (idx) {
      if (!CREATE) return;
      CREATE.selectedCaptionIdx = idx;
      // (C) keep the attached coupon link on whichever caption is now selected.
      if (CREATE.attachedCoupon) {
        var url = couponClaimUrl(CREATE.attachedCoupon);
        var cap = CREATE.captions[idx];
        if (url && cap && (cap.text || '').indexOf(url) === -1) cap.text = (cap.text || '') + '\n\n🏷️ Claim your coupon: ' + url;
      }
      renderCreate();
    },
    createEditCaption: function (val) {
      if (CREATE && CREATE.captions[CREATE.selectedCaptionIdx]) CREATE.captions[CREATE.selectedCaptionIdx].text = val;
    },
    createCopyCaption: function () {
      if (!CREATE) return;
      var cap = CREATE.captions[CREATE.selectedCaptionIdx];
      if (cap && cap.text && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cap.text).then(function () { if (window.showToast) showToast('Caption copied.'); });
      }
    },
    createCopyHashtags: function () {
      if (!CREATE || !CREATE.hashtags) return;
      var all = [].concat(CREATE.hashtags.niche || [], CREATE.hashtags.mid || [], CREATE.hashtags.broad || []);
      if (all.length && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(all.join(' ')).then(function () { if (window.showToast) showToast('Hashtags copied.'); });
      }
    },
    // (C) S6 — coupon attach. Pick from active window.coupons, append the claim
    // URL to the SELECTED caption (reattachable/removable). Mirrors legacy
    // smPickCoupon + the caption-append in smRunReadinessAndCaptions.
    createPickCoupon: function () {
      if (!CREATE) return;
      var all = window.coupons || {};
      var statusFn = (typeof window.getCouponEffectiveStatus === 'function') ? window.getCouponEffectiveStatus : function () { return 'active'; };
      var codes = Object.keys(all).filter(function (code) { return statusFn(all[code]) === 'active'; });
      if (!codes.length) { if (window.showToast) showToast('No active coupons. Create one in the Coupons tab first.', true); return; }
      var listHtml = codes.map(function (code) {
        var cpn = all[code];
        var val = cpn.type === 'percent' ? (cpn.value + '% off') : ('$' + Number(cpn.value || 0).toFixed(2) + ' off');
        // data-attribute + dataset read (legacy smPickCoupon pattern) so an
        // arbitrary coupon code can't break out of the inline handler.
        return '<div data-sm-coupon="' + esc(code) + '" onclick="SocialV2.createAttachCoupon(this.dataset.smCoupon)" ' +
          'style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--cream-dark);border-radius:8px;cursor:pointer;">' +
          '<span style="font-family:monospace;font-weight:600;">' + esc(code) + '</span>' +
          '<span style="color:var(--teal);font-weight:600;">' + esc(val) + '</span></div>';
      }).join('');
      var html = '<div class="modal-header"><h3>Attach coupon</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body"><p class="mu-sub" style="font-size:0.85rem;margin-bottom:12px;">The claim link will be appended to your selected caption.</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;">' + listHtml + '</div></div>';
      if (window.openModal) openModal(html);
    },
    createAttachCoupon: function (code) {
      if (!CREATE) return;
      if (window.closeModal) closeModal();
      var url = couponClaimUrl(code);
      if (!url) { if (window.showToast) showToast('Could not build the coupon link.', true); return; }
      // Strip any previously-attached coupon line before appending the new one.
      stripCouponFromCaption();
      CREATE.attachedCoupon = code;
      var cap = CREATE.captions[CREATE.selectedCaptionIdx];
      if (cap) {
        if ((cap.text || '').indexOf(url) === -1) cap.text = (cap.text || '') + '\n\n🏷️ Claim your coupon: ' + url;
      }
      renderCreate();
      if (window.showToast) showToast('Coupon link added to caption.');
    },
    createRemoveCoupon: function () {
      if (!CREATE) return;
      stripCouponFromCaption();
      CREATE.attachedCoupon = null;
      renderCreate();
      if (window.showToast) showToast('Coupon removed.');
    },
    // (D) S6 — Caption-in-Claude. Opens Ask AI's openWithReturn to draft a single
    // caption, returning it as a new "Claude" option into the editable caption
    // field. Mirrors legacy smCaptionInClaude wiring.
    createDraftInClaude: function () {
      if (!CREATE) return;
      if (!claudeEnabled()) { if (window.showToast) showToast('Configure Ask AI in Settings → AI to draft in Claude.', true); return; }
      var c = CREATE;
      var t = CREATE_TREATMENTS.filter(function (x) { return x.id === c.treatment; })[0];
      var treatmentName = t ? t.name : (c.treatment || 'finished piece');
      var subject = c.productName || c.eventName || c.description || 'handmade piece';
      var destinations = (c.destinations || []).map(function (d) { return PLATFORM_LABEL[d] || d; }).join(', ') || 'Instagram';
      var details = [];
      if (c.productName) details.push('Product: ' + c.productName);
      if (c.productCategory) details.push('Category: ' + c.productCategory);
      if (c.productMaterials) details.push('Materials: ' + c.productMaterials);
      if (c.eventName) details.push('Event: ' + c.eventName);
      if (c.description) details.push('Notes: ' + c.description);
      window.MastAskAi.openWithReturn({
        title: 'Social caption: ' + subject,
        prompt: 'Write a single social media caption for ' + destinations + '. ' +
                'Treatment style: ' + treatmentName + '. Subject: ' + subject + '.\n\n' +
                (details.length ? 'Details:\n' + details.join('\n') + '\n\n' : '') +
                'Keep the voice warm and concrete. One short caption, no hashtag block (we handle hashtags separately).',
        onReturn: function (text) {
          if (!CREATE) return;
          CREATE.captions = [{ style: 'Claude', text: text }];
          CREATE.selectedCaptionIdx = 0;
          CREATE.attachedCoupon = null;
          renderCreate();
          if (window.showToast) showToast('Caption drafted — review and post.');
        }
      });
    },
    createSubmit: function () {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to create social posts.', true); return; }
      var b = bridge(); if (!b || !CREATE) return;
      var c = CREATE;
      var cap = c.captions[c.selectedCaptionIdx];
      var caption = cap && cap.text ? cap.text : '';
      var hashtags = c.hashtags
        ? [].concat(c.hashtags.niche || [], c.hashtags.mid || [], c.hashtags.broad || []).join(' ')
        : null;
      var postData = {
        clipId: c.clipId || null,
        productId: c.subjectType === 'product' ? (c.productId || null) : null,
        productName: c.subjectType === 'product' ? (c.productName || null) : null,
        eventName: c.subjectType === 'event' ? (c.eventName || null) : null,
        treatment: c.treatment || null,
        platforms: createPlatforms(),
        caption: caption,
        hashtags: hashtags,
        postedAt: Date.now(),
        contentType: c.fileType || 'video',
        thumbnailUrl: c.thumbnailUrl || null,
        description: c.description || c.productName || c.eventName || null
      };
      // (A) If this post resolves a resumed pre-shoot PLAN (the operator filmed
      // it and uploaded a fresh clip), retire the original planning doc so it
      // leaves the pending-clips list. Single-sourced via SocialBridge.
      var preShootKey = c.preShootClipId;
      Promise.resolve(b.createPost(postData)).then(function (postId) {
        if (preShootKey && b.retirePendingClip) {
          return Promise.resolve(b.retirePendingClip(preShootKey)).catch(function () {}).then(function () { return postId; });
        }
        return postId;
      }).then(function (postId) {
        CREATE = null;
        try { U.slideOut.requestCloseForce(); } catch (e) {}
        if (window.showToast) showToast('Post recorded! 🎉');
        load();
      }).catch(function (err) {
        console.error('[social-v2] createPost', err);
        if (window.showToast) showToast('Could not record post: ' + (err && err.message || err), true);
      });
    },
    _reopen: function (id) { var rec = V2.byId[id]; if (rec) MastEntity.openRecord('social-v2', rec, 'read'); },
    signal: function (id, score) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to edit social posts.', true); return; }
      var b = bridge(); if (!b) return;
      var rec = V2.byId[id]; if (!rec) return;
      Promise.resolve(b.setSignal(id, score, rec.signalScore)).then(function (newScore) {
        rec.signalScore = newScore;
        if (window.showToast) showToast(newScore ? 'Signal logged' : 'Signal removed');
        SocialV2._reopen(id); render();
      }).catch(function (e) { console.error('[social-v2] signal', e); if (window.showToast) showToast('Error logging signal.', true); });
    },
    markPosted: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission to edit social posts.', true); return; }
      var b = bridge(); if (!b) return;
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Mark this draft as posted? It moves to the posted feed with today\'s date.', { title: 'Mark posted?', confirmLabel: 'Mark posted' })
        : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(b.markPosted(id)).then(function () {
          var rec = V2.byId[id];
          if (rec) { rec.status = 'posted'; rec.postedAt = Date.now(); }
          if (window.showToast) showToast('Post recorded! 🎉');
          SocialV2._reopen(id); reloadSoon();
        });
      }).catch(function (e) { console.error('[social-v2] markPosted', e); if (window.showToast) showToast('Error marking posted.', true); });
    },
    // Draft deletion (Wave 3): posted records are the posting history — they
    // never delete from the twin.
    removeDraft: function (id) {
      if (typeof window.can === 'function' && !window.can('social', 'delete')) {
        if (window.showToast) showToast('You don\'t have permission to delete posts.', true); return;
      }
      var rec = V2.byId[id];
      if (rec && statusKey(rec) !== 'draft') { if (window.showToast) showToast('Posted records are history — only drafts delete.', true); return; }
      var b = bridge(); if (!b || !b.remove) return;
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Delete this draft post?', { title: 'Delete draft?', confirmLabel: 'Delete', dangerous: true })
        : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(b.remove(id)).then(function () {
          if (window.writeAudit) writeAudit('delete', 'social-post-draft', id);
          if (window.showToast) showToast('Draft deleted.');
          try { U.slideOut.requestCloseForce(); } catch (e) {}
          load();
        });
      }).catch(function (e) { console.error('[social-v2] removeDraft', e); if (window.showToast) showToast('Delete failed.', true); });
    },
    copyCaption: function (id) {
      var rec = V2.byId[id]; if (!rec) return;
      var text = (rec.caption || '') + (rec.hashtags ? '\n\n' + rec.hashtags : '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { if (window.showToast) showToast('Caption copied.'); });
      }
    },
    exportCsv: function () { return MastEntity.exportRows('social-v2', visibleRows(), V2.statusFilter); }
  };

  MastAdmin.registerModule('social-v2', {
    routes: { 'social-v2': { tab: 'socialV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
