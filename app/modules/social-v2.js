/**
 * social-v2.js — record-archetype twin of the legacy Social Media surface
 * (standard-record-ui §10; marketing-v2-build-plan Wave 1).
 *
 * Legacy social.js (#social) is a content PIPELINE: clip upload → enhance
 * (treatment + AI captions / shoot cards) → staging → "mark posted", plus a
 * posted-feed list with a 👍/🔥 signal logger. This twin re-hosts the POSTS
 * list → read/edit detail on the Entity Engine. The enhance/AI-caption canvas
 * is a Composer-archetype authoring surface and stays single-sourced on legacy
 * #social via navigateToClassic (temp-link debt, tracked in the build plan).
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
 * Pending clips (market/pendingClips/{uid}) surface as a count chip linking to
 * the classic pipeline — clips are work-in-flight, not records.
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
  var PLATFORM_LABEL = { 'instagram-reels': 'Instagram', instagram: 'Instagram', facebook: 'Facebook', x: 'X', twitter: 'X', tiktok: 'TikTok' };
  var STATUS_TONE = { posted: 'success', draft: 'info' };

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

        // Actions — signal toggle + mark-posted for drafts + classic pipeline link.
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
  var V2 = { rows: [], byId: {}, sortKey: 'date', sortDir: 'desc', q: '', statusFilter: 'all', pendingClips: 0, loaded: false };

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
      V2.pendingClips = Object.keys(clips).filter(function (k) { return clips[k] && clips[k].status !== 'processed'; }).length;
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[social-v2] load', e); V2.loaded = true; render(); });
  }
  function reloadSoon() { setTimeout(load, 250); }

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
      tab.innerHTML = U.pageHeader({ title: 'Social Media' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>';
      return;
    }
    var filters = [['all', 'All'], ['posted', 'Posted'], ['draft', 'Drafts']].map(function (f) {
      var on = V2.statusFilter === f[0];
      return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="SocialV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
    }).join(' ');
    var clipsNote = V2.pendingClips
      ? '<div style="margin:12px 0;padding:10px 14px;border:1px solid var(--cream-dark);border-radius:8px;font-size:0.9rem;">' +
          '📎 ' + N.count(V2.pendingClips) + ' clip' + (V2.pendingClips === 1 ? '' : 's') + ' waiting in the pipeline — ' +
          '<a href="javascript:void(0)" onclick="SocialV2.classic()" style="color:var(--teal);">process in classic view →</a></div>'
      : '';
    tab.innerHTML =
      U.pageHeader({
        title: 'Social Media',
        count: N.count(V2.rows.length) + ' post' + (V2.rows.length === 1 ? '' : 's'),
        subtitle: 'Captions, signals and the posting record. New posts are produced in the classic pipeline.',
        actionsHtml:
          '<button class="btn btn-primary" onclick="SocialV2.classic()">+ New post (classic)</button>' +
          '<button class="btn btn-secondary" onclick="SocialV2.exportCsv()">↓ Export</button>'
      }) +
      clipsNote +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search caption, description or product…" value="' + esc(V2.q) +
        '" oninput="SocialV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('social-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'SocialV2.sort', onRowClickFnName: 'SocialV2.open',
        empty: { title: 'No social posts', message: V2.loaded ? 'Produce your first post in the classic pipeline.' : 'Loading…' }
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
    classic: function () {
      if (typeof window.navigateToClassic === 'function') navigateToClassic('social');
      else if (typeof window.navigateTo === 'function') navigateTo('social');
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
