/**
 * stories-v2.js — read-focused Faceted Record twin of the legacy Stories surface
 * (doc 17 conversion playbook; engine-first redesign).
 *
 * Legacy production.js (#stories, owned by the Production module) hosts the
 * studio-story list as a stack of cards and swaps the pane in-place to a story
 * detail (renderStoryDetail: status + job link + entries gallery + artists + QR
 * codes) with its own Preview / Add-photos-Edit / Publish controls. This twin
 * re-hosts that list to read-detail VIEW on the Entity Engine: a schema-driven
 * list plus a read-focused Faceted Record slide-out (single Overview facet).
 *
 * Variant (doc 17): a story is a content record (title, status, cover image,
 * dates) with no governed lifecycle — its status (published / draft) is an
 * assigned attribute, so it is a Faceted Record, NOT Process / MastFlow.
 *
 * Authoring is FULLY NATIVE here — there is no classic escape hatch. Create +
 * rename use detail.editRender + onSave; the rich photo-curation canvas (the
 * 3 photo sources — build media / content-composer images / freeform upload —
 * the entries assembler with milestone+caption+reorder, and Publish/Unpublish
 * with operator-credit aggregation + QR-code generation + product back-fill) is
 * a route:null DRILLED slide-out (story-curation-v2), opened via MastEntity.drill
 * from the read detail (the products-v2 image-drill pattern). EVERY write delegates
 * to window.StoriesBridge (exposed in production.js) — the twin never writes
 * MastDB directly for stories, so the legacy write logic + storefront contract
 * stay single-sourced and lint-rbac CHECK C stays green. Genuine backend bits
 * (Firebase Storage upload, QR lib, LabelKeeper print) stay server/CDN calls
 * triggered from the native UI. Flag-gated (?ui=1) at #stories-v2.
 *
 * Data: stories live at public/stories (MastDB.stories = _makeEntity('public/
 * stories', 200)); read one-shot via MastDB.get('public/stories') -> keyed object.
 * Real fields (from production.js renderStoriesList / renderStoryDetail):
 * title, status ('published' | 'draft'), jobId, entries (keyed map of
 * { order, milestone, mediaUrl, caption, ... }), publishedAt, createdAt,
 * updatedAt. There is no author / excerpt / coverImage field on the doc itself —
 * the cover image is the first entry's mediaUrl and the excerpt is derived from
 * the first entry's milestone / caption (mirrors the legacy thumbnail logic).
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

  var STATUS_LABEL = { published: 'Published', draft: 'Draft' };
  var STATUS_TONE = { published: 'success', draft: 'amber' };

  function storyTitle(s) { return (s && s.title) || 'Untitled story'; }
  function statusOf(s) { return (s && s.status) || 'draft'; }

  // Entries sorted by their authored order (mirrors production.js).
  function entriesOf(s) {
    if (!s || !s.entries) return [];
    return Object.keys(s.entries).map(function (k) {
      var e = s.entries[k] || {}; return { _key: k, order: e.order || 0, milestone: e.milestone || '', caption: e.caption || '', mediaUrl: e.mediaUrl || '' };
    }).sort(function (a, b) { return a.order - b.order; });
  }
  function entryCount(s) { return s && s.entries ? Object.keys(s.entries).length : 0; }

  // Cover image = first entry that carries a mediaUrl (legacy thumbnail logic).
  function coverUrl(s) {
    var es = entriesOf(s);
    for (var i = 0; i < es.length; i++) { if (es[i].mediaUrl) return es[i].mediaUrl; }
    return '';
  }
  // Excerpt = first non-empty milestone / caption across entries (the doc has no
  // body/excerpt field; this is the closest authored summary).
  function excerptOf(s) {
    var es = entriesOf(s);
    for (var i = 0; i < es.length; i++) { if (es[i].milestone) return es[i].milestone; }
    for (var j = 0; j < es.length; j++) { if (es[j].caption) return es[j].caption; }
    return '';
  }
  // Display label for the linked production job (resolved from the one-shot
  // admin/jobs read loaded alongside the stories).
  function jobLabel(s) {
    var id = s && s.jobId; if (!id) return '';
    var j = V2.jobs[id]; return j ? (j.name || 'Untitled job') : '';
  }
  function publishedAt(s) { return (statusOf(s) === 'published' && s && s.publishedAt) ? s.publishedAt : null; }
  function updatedAt(s) { return (s && (s.updatedAt || s.createdAt)) || null; }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('stories-v2', {
    label: 'Story', labelPlural: 'Stories', size: 'md',
    route: 'stories-v2',
    recordId: function (s) { return s._key || s.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real title string.
      { name: 'title', label: 'Title', type: 'text', list: true, readOnly: true, group: 'Story', get: storyTitle },
      { name: 'job', label: 'From job', type: 'text', list: true, readOnly: true, sortable: false, get: function (s) { return jobLabel(s) || '—'; } },
      { name: 'entryCount', label: 'Entries', type: 'number', list: true, readOnly: true, align: 'right', get: entryCount },
      { name: 'publishedAt', label: 'Published', type: 'date', list: true, readOnly: true, get: publishedAt },
      { name: 'updatedAt', label: 'Updated', type: 'date', list: true, readOnly: true, get: updatedAt },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['published', 'draft'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    // Cache-miss fallback keeps cross-record drills (campaign references,
    // calendar) working cold (Wave 3).
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return Promise.resolve(MastDB.get('public/stories/' + id)).then(function (s) {
        return s ? Object.assign({ _key: id }, s) : null;
      });
    },
    detail: {
      render: function (UI, s) {
        var cover = coverUrl(s);
        var sid = s._key || s.id;
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(s)] || 'Draft', STATUS_TONE[statusOf(s)] || 'neutral'), hero: true },
          { k: 'Entries', v: N.count(entryCount(s)) },
          { k: 'Published', v: publishedAt(s) ? N.date(publishedAt(s)) : '—' },
          { k: 'Cover', v: cover ? UI.imageThumb(storyTitle(s), cover) : '<span class="mu-sub">None</span>' }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }], 'ov');

        // Overview — cover image, the story vitals, and a derived excerpt.
        // The cover <img> is composed by hand inside a card (the sanctioned
        // read-on-page image pattern, mirroring brand-v2 logoCard) — imageThumb
        // is the lightbox affordance, this is the full-bleed read view.
        var coverBlock = cover
          ? '<div style="background:var(--surface-dark);border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;min-height:120px;">' +
              '<img src="' + esc(cover) + '" alt="' + esc(storyTitle(s)) + ' cover" style="max-width:100%;max-height:280px;object-fit:contain;display:block;"></div>'
          : '<div style="background:var(--surface-dark);border-radius:8px;padding:24px;text-align:center;color:var(--warm-gray);font-size:0.9rem;">No cover image yet.</div>';

        var vitals = UI.kv([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(s)] || 'Draft', STATUS_TONE[statusOf(s)] || 'neutral') },
          { k: 'From job', v: jobLabel(s) ? esc(jobLabel(s)) : '—' },
          { k: 'Entries', v: N.count(entryCount(s)) },
          { k: 'Published', v: publishedAt(s) ? N.date(publishedAt(s)) : '—' },
          { k: 'Created', v: s.createdAt ? N.date(s.createdAt) : '—' },
          { k: 'Updated', v: updatedAt(s) ? N.date(updatedAt(s)) : '—' }
        ]);

        var ex = excerptOf(s);
        var excerptBody = ex
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(ex) + '</div>'
          : '<span class="mu-sub">No caption or milestone text yet.</span>';

        // Native action bar — Curate opens the drilled photo-curation canvas;
        // Publish/Unpublish + Delete are gated. No classic escape hatch.
        var canEdit = (typeof window.can !== 'function' || window.can('stories', 'edit'));
        var canDel = (typeof window.can !== 'function' || window.can('stories', 'delete'));
        var ec = entryCount(s);
        var bar = '';
        if (canEdit) bar += '<button class="btn btn-primary" onclick="StoriesV2.curate(\'' + esc(sid) + '\')">📸 Curate photos &amp; entries</button>';
        bar += '<button class="btn btn-secondary" onclick="StoriesV2.preview(\'' + esc(sid) + '\')">👁 Preview</button>';
        if (canEdit && statusOf(s) === 'published') bar += '<button class="btn btn-secondary" onclick="StoriesV2.unpublish(\'' + esc(sid) + '\')">Unpublish</button>';
        else if (canEdit && statusOf(s) === 'draft' && ec > 0) bar += '<button class="btn btn-primary" onclick="StoriesV2.publishFromDetail(\'' + esc(sid) + '\')">🚀 Publish</button>';
        if (statusOf(s) === 'draft' && canDel) bar += '<button class="btn btn-secondary" style="color:var(--text-danger);" onclick="StoriesV2.removeDraft(\'' + esc(sid) + '\')">Delete draft</button>';
        var manage = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' + bar + '</div><div id="storyCampChip_' + esc(sid) + '"></div>';
        // Part-of-campaign chip — single-sourced renderer in campaigns-v2.js (Wave 3).
        setTimeout(function () {
          if (window.MastAdmin && MastAdmin.loadModule) {
            MastAdmin.loadModule('campaigns-v2').then(function () {
              if (window.CampaignsBridge && CampaignsBridge.renderChipInto) CampaignsBridge.renderChipInto('storyCampChip_' + sid, sid);
            }).catch(function () {});
          }
        }, 0);

        // Artists (operator credits) — name resolved best-effort, falls back to id.
        var ops = (s.operators && s.operators.length) ? s.operators : [];
        var artistsCard = ops.length
          ? UI.card('Artists', '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + ops.map(function (op) {
              var nm = (window.operators && window.operators[op] && window.operators[op].name) || op;
              return '<span style="background:var(--cream);padding:4px 10px;border-radius:12px;font-size:0.85rem;">' + esc(nm) + '</span>';
            }).join('') + '</div>')
          : '';

        // QR codes (present once published with linked products) — reuse the
        // global print/copy/print-card helpers from production.js.
        var qrs = (s.qrCodes && s.qrCodes.length) ? s.qrCodes : [];
        var qrCard = qrs.length
          ? UI.card('QR codes', '<p class="mu-sub" style="margin:0 0 12px;">Scan to view the product page with this story.</p>' +
              '<div style="display:flex;gap:16px;flex-wrap:wrap;">' + qrs.map(function (qr) {
                return '<div style="text-align:center;background:white;padding:12px;border-radius:8px;border:1px solid var(--cream-dark);">' +
                  '<img src="' + esc(qr.dataUrl) + '" style="width:140px;height:140px;" alt="QR code">' +
                  '<div style="font-size:0.85rem;font-weight:600;margin-top:6px;">' + esc(qr.productName || '') + '</div>' +
                  '<div style="display:flex;gap:6px;margin-top:8px;justify-content:center;flex-wrap:wrap;">' +
                    '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="StoriesV2.qrPrint(\'' + esc(qr.dataUrl) + '\',\'' + esc(qr.productName || '') + '\')">🖨 Print</button>' +
                    '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="StoriesV2.qrCopy(\'' + esc(qr.url || '') + '\')">📋 Copy URL</button>' +
                    '<button class="btn btn-primary" style="font-size:0.72rem;padding:3px 8px;" onclick="StoriesV2.qrCard(\'' + esc(qr.productId || '') + '\',\'' + esc(qr.productName || '') + '\',\'' + esc(qr.url || '') + '\')">🃏 Print Card</button>' +
                  '</div>' +
                '</div>';
              }).join('') + '</div>')
          : '';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Cover', coverBlock) +
            UI.card('Story', vitals) +
            UI.card('Excerpt', excerptBody + manage) +
            artistsCard +
            qrCard +
          '</div>';
      },
      // CREATE (title → draft skeleton) + light EDIT (rename). After creating,
      // open the native curation canvas (Curate button on the read detail) to add
      // photos, captions, and publish — all native, no classic view.
      editRender: function (s, mode) {
        s = s || {};
        function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        var lead = mode === 'create'
          ? 'New story — add photos, captions &amp; publish in the curation canvas after creating'
          : 'Rename this story (photos &amp; publishing live in the curation canvas)';
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + lead + '</div>' +
          fg('Title *', '<input class="form-input" id="storyV2Title" value="' + esc(mode === 'create' ? '' : (storyTitle(s) === 'Untitled story' ? '' : storyTitle(s))) + '" style="width:100%;" placeholder="Story title">');
      }
    },
    onSave: function (rec, mode) {
      if (typeof window.can === 'function' && !window.can('stories', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to edit stories.', true); return false;
      }
      if (!window.StoriesBridge) { if (window.showToast) showToast('Stories engine still loading — try again', true); return false; }
      var title = ((document.getElementById('storyV2Title') || {}).value || '').trim();
      if (!title) { if (window.showToast) showToast('Title is required.', true); return false; }
      if (mode === 'create') {
        if (!window.StoriesBridge.create) { if (window.showToast) showToast('Stories engine still loading — try again', true); return false; }
        return Promise.resolve(window.StoriesBridge.create({ title: title })).then(function (id) {
          if (window.writeAudit) writeAudit('create', 'story', id);
          if (window.showToast) showToast('Draft story created.');
          reloadSoon(); return true;
        }).catch(function (e) { console.error('[stories-v2] create', e); if (window.showToast) showToast('Error creating story.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.StoriesBridge.update(id, { title: title })).then(function (updates) {
        Object.assign(V2.byId[id] || rec, updates || { title: title });
        if (window.showToast) showToast('Story updated.');
        render(); return true;
      }).catch(function (e) { console.error('[stories-v2] update', e); if (window.showToast) showToast('Error updating story.', true); return false; });
    }
  });

  // ── curation canvas (route:null drilled heavy-edit SO) ──────────────
  // The native photo-curation surface, modeled on products-v2's image drill.
  // Opened via MastEntity.drill('story-curation-v2', storyId) from the read
  // detail. Reads the story + its job's build media + content-composer images;
  // every write delegates to StoriesBridge. CUR holds the working draft (the
  // module-global the handlers mutate, mirroring legacy storyDraft).
  var CUR = null;

  // Async loader: resolve story + (job → builds → build media) + content images,
  // seed CUR.draft from existing entries, return the drill record.
  function loadCuration(id) {
    return Promise.resolve(MastDB.stories.get(id)).then(function (story) {
      if (!story) return null;
      story = Object.assign({}, story);
      var jobId = story.jobId || null;
      var jobP = jobId ? Promise.resolve(MastDB.productionJobs.get(jobId)).catch(function () { return null; }) : Promise.resolve(null);
      return jobP.then(function (job) {
        var builds = (job && job.builds) || {};
        var buildKeys = Object.keys(builds).sort(function (a, b) { return (builds[a].buildNumber || 0) - (builds[b].buildNumber || 0); });
        var mediaP = Promise.all(buildKeys.map(function (bk) {
          return Promise.resolve(MastDB.buildMedia.get(bk)).then(function (m) { return { bk: bk, m: m || {} }; }).catch(function () { return { bk: bk, m: {} }; });
        }));
        var ciP = story.sourceContentId
          ? Promise.resolve(MastDB.get('admin/content/' + story.sourceContentId)).then(function (c) {
              var cv = (c && typeof c.val === 'function') ? c.val() : c;
              var imgs = (cv && Array.isArray(cv.images)) ? cv.images : [];
              return imgs.filter(Boolean).map(function (im) { return typeof im === 'string' ? { url: im } : im; }).filter(function (im) { return im && im.url; });
            }).catch(function () { return []; })
          : Promise.resolve([]);
        return Promise.all([mediaP, ciP]).then(function (res) {
          var allMedia = {}; res[0].forEach(function (x) { allMedia[x.bk] = x.m; });
          var contentImages = res[1] || [];
          if (Array.isArray(story.images)) {
            story.images.forEach(function (im) {
              if (!im) return; var url = typeof im === 'string' ? im : im.url; if (!url) return;
              if (!contentImages.some(function (c) { return c.url === url; })) contentImages.push({ url: url });
            });
          }
          var draft = story.entries ? Object.keys(story.entries).map(function (ek) {
            var e = story.entries[ek] || {};
            return { id: ek, mediaUrl: e.mediaUrl || '', milestone: e.milestone || '', caption: e.caption || '', buildId: e.buildId || '', source: e.source || 'build', order: e.order || 0 };
          }).sort(function (a, b) { return a.order - b.order; }) : [];
          CUR = { storyId: id, story: story, job: job, jobId: jobId, builds: builds, buildKeys: buildKeys, allMedia: allMedia, contentImages: contentImages, draft: draft };
          return { _key: id, _title: ((story.title || 'Untitled story') + ' · Curate') };
        });
      });
    });
  }

  function curEntriesMap() {
    var entries = {};
    CUR.draft.forEach(function (e) {
      entries[e.id] = { order: e.order, milestone: e.milestone, mediaUrl: e.mediaUrl, mediaType: e.mediaUrl ? 'photo' : 'text', caption: e.caption, buildId: e.buildId, source: e.source || 'build' };
    });
    return entries;
  }

  // Surgical re-render of just the entries list node (mirrors legacy
  // renderStoryEntries) — keeps focus/scroll on milestone/caption edits.
  function renderCurEntries() {
    var el = document.getElementById('storyV2EntriesList');
    if (!el || !CUR) return;
    if (!CUR.draft.length) {
      el.innerHTML = '<p style="font-size:0.85rem;color:var(--warm-gray);font-style:italic;">Select photos above to add them, or add a text-only entry.</p>';
      return;
    }
    el.innerHTML = CUR.draft.map(function (entry, idx) {
      var thumb = entry.mediaUrl
        ? '<img class="story-entry-thumb" src="' + esc(entry.mediaUrl) + '" alt="">'
        : '<div class="story-entry-thumb" style="background:var(--cream-dark);display:flex;align-items:center;justify-content:center;font-size:0.78rem;color:var(--warm-gray);">Text</div>';
      return '<div class="story-entry-card" data-idx="' + idx + '">' + thumb +
        '<div class="story-entry-fields">' +
          '<input type="text" placeholder="Milestone (e.g. body formed…)" value="' + esc(entry.milestone) + '" onchange="StoriesV2.curUpdate(' + idx + ',\'milestone\',this.value)">' +
          '<textarea rows="2" placeholder="Caption…" onchange="StoriesV2.curUpdate(' + idx + ',\'caption\',this.value)">' + esc(entry.caption) + '</textarea>' +
        '</div>' +
        '<div class="story-entry-actions">' +
          '<button class="btn btn-small btn-secondary" onclick="StoriesV2.curMove(' + idx + ',-1)"' + (idx === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="btn btn-small btn-secondary" onclick="StoriesV2.curMove(' + idx + ',1)"' + (idx === CUR.draft.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="btn btn-small btn-danger" onclick="StoriesV2.curRemove(' + idx + ')">×</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Re-sync the .selected highlight on EVERY source thumb from the draft, so a
  // photo that appears in two sources (build + content) stays consistent after
  // an add/remove from either grid.
  function syncCurThumbs() {
    document.querySelectorAll('.media-select-thumb').forEach(function (thumb) {
      var url = thumb.getAttribute('data-url');
      var inDraft = CUR && CUR.draft.some(function (e) { return e.mediaUrl === url; });
      if (inDraft) thumb.classList.add('selected'); else thumb.classList.remove('selected');
    });
  }

  function curationHtml(UI, r) {
    var id = r && r._key;
    if (!CUR || CUR.storyId !== id) return '<p class="mu-sub">Loading…</p>';
    var totalBuildPhotos = 0;
    CUR.buildKeys.forEach(function (bk) { totalBuildPhotos += Object.keys(CUR.allMedia[bk] || {}).length; });
    var selectedMediaIds = {};
    CUR.draft.forEach(function (e) { if (e.mediaUrl) selectedMediaIds[e.mediaUrl] = true; });

    var provenance = CUR.job ? ('From job: <strong>' + esc(CUR.job.name || 'Untitled') + '</strong>')
      : (CUR.story && CUR.story.sourceContentId ? 'From content composer' : 'Freeform story');
    var html = '<div class="mu-sub" style="margin-bottom:14px;">' + provenance + '</div>';

    html += '<div class="form-group" style="margin-bottom:16px;"><label class="form-label">Story title</label>' +
      '<input class="form-input" id="storyV2CurTitle" value="' + esc((CUR.story && CUR.story.title) || '') + '" placeholder="Give your story a title…" style="width:100%;"></div>';

    // Source 1 — build media
    if (CUR.job && totalBuildPhotos > 0) {
      var s1 = '<p class="mu-sub" style="margin:0 0 12px;">Tap photos to add or remove them.</p>';
      CUR.buildKeys.forEach(function (bk) {
        var b = CUR.builds[bk] || {}; var media = CUR.allMedia[bk] || {};
        var mKeys = Object.keys(media).sort(function (a, c) { return (media[a].uploadedAt || '').localeCompare(media[c].uploadedAt || ''); });
        if (!mKeys.length) return;
        s1 += '<div style="margin-bottom:12px;"><div style="font-size:0.85rem;font-weight:600;margin-bottom:6px;">Build #' + (b.buildNumber || '?') + (b.sessionDate ? ' — ' + esc(b.sessionDate) : '') + ' (' + mKeys.length + ')</div><div class="media-select-grid">';
        mKeys.forEach(function (mk) {
          var m = media[mk]; var sel = selectedMediaIds[m.url] ? ' selected' : '';
          s1 += '<div class="media-select-thumb' + sel + '" data-url="' + esc(m.url) + '" data-buildid="' + esc(bk) + '" data-source="build" onclick="StoriesV2.curToggle(this)"><img src="' + esc(m.url) + '" alt=""><div class="check-overlay">✓</div></div>';
        });
        s1 += '</div></div>';
      });
      html += UI.card('From build media (' + totalBuildPhotos + ')', s1);
    }

    // Source 2 — content-composer images
    if (CUR.contentImages.length) {
      var s2 = '<div class="media-select-grid">' + CUR.contentImages.map(function (im) {
        var sel = selectedMediaIds[im.url] ? ' selected' : '';
        return '<div class="media-select-thumb' + sel + '" data-url="' + esc(im.url) + '" data-source="content" onclick="StoriesV2.curToggle(this)"><img src="' + esc(im.url) + '" alt=""><div class="check-overlay">✓</div></div>';
      }).join('') + '</div>';
      html += UI.card('From content composer (' + CUR.contentImages.length + ')', s2);
    }

    // Source 3 — freeform upload (always available; story already has an id)
    var s3 = '<label class="btn btn-secondary btn-small" style="cursor:pointer;margin:0;"><input type="file" accept="image/*" multiple style="display:none;" onchange="StoriesV2.curUpload(this)">+ Add photos</label>' +
      '<p class="mu-sub" style="margin:8px 0 0;">Photos you upload here are tied to this story.</p><div id="storyV2UploadProgress" style="margin-top:8px;"></div>';
    html += UI.card('Upload new', s3);

    // Entries assembler
    html += UI.card('Story entries', '<div style="display:flex;justify-content:flex-end;margin-bottom:8px;"><button class="btn btn-secondary btn-small" onclick="StoriesV2.curAddText()">+ Text entry</button></div><div id="storyV2EntriesList"></div>');

    html += '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding-top:14px;">' +
      '<button class="btn btn-secondary" onclick="StoriesV2.curPreview()">👁 Preview</button>' +
      '<button class="btn btn-secondary" onclick="StoriesV2.curSave()">💾 Save draft</button>' +
      '<button class="btn btn-primary" onclick="StoriesV2.curPublish()">🚀 Publish</button>' +
    '</div>';

    setTimeout(renderCurEntries, 0);
    return html;
  }

  MastEntity.define('story-curation-v2', {
    label: 'Curate', labelPlural: 'Curate', size: 'lg', route: null,
    recordId: function (r) { return r._key; },
    fields: [{ name: '_title', label: 'Story', type: 'text', list: true, group: 'Story', readOnly: true }],
    fetch: function (id) { return loadCuration(id); },
    detail: { render: function (UI, r) { return curationHtml(UI, r); } }
  });

  // Persist the curation draft (Save = draft, Publish = published) via the
  // bridge, mutate the cached record, then re-open the read detail fresh.
  function curPersist(publish) {
    if (typeof window.can === 'function' && !window.can('stories', 'edit')) { if (window.showToast) showToast('You don\'t have permission to edit stories.', true); return; }
    if (!window.StoriesBridge || !(publish ? StoriesBridge.publish : StoriesBridge.saveEntries)) { if (window.showToast) showToast('Stories engine still loading — try again', true); return; }
    if (!CUR) return;
    var sid = CUR.storyId;
    var title = ((document.getElementById('storyV2CurTitle') || {}).value || '').trim();
    CUR.draft.forEach(function (e, i) { e.order = i; });
    var data = { title: title, entries: curEntriesMap(), jobId: CUR.jobId || null };
    var op = publish ? StoriesBridge.publish(sid, data) : StoriesBridge.saveEntries(sid, data);
    Promise.resolve(op).then(function (payload) {
      if (CUR && CUR.story) Object.assign(CUR.story, payload || {});
      var live = V2.byId[sid]; if (live && payload) Object.assign(live, payload);
      if (window.showToast) showToast(publish ? 'Story published!' : 'Story draft saved.');
      reloadSoon();
      MastEntity.get('stories-v2').fetch(sid).then(function (rec) { if (rec) MastEntity.openRecord('stories-v2', rec, 'read'); });
    }).catch(function (e) { console.error('[stories-v2] curPersist', e); if (window.showToast) showToast('Error saving story.', true); });
  }

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, jobs: {}, sortKey: 'updatedAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Ensure legacy production.js is loaded so window.StoriesBridge (the
    // delegated create/edit write path) exists — mirrors blog-v2 / contacts-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('production'); } catch (e) {} }
    // Stories + production jobs (for the "from job" label) load together; both
    // one-shot keyed-object reads. Jobs live at admin/jobs (no public/jobs entity),
    // read bounded via productionJobs.list(200).
    Promise.all([
      Promise.resolve(MastDB.get('public/stories')).catch(function () { return null; }),
      Promise.resolve(MastDB.productionJobs.list(200)).catch(function () { return null; })
    ]).then(function (res) {
      var sv = res[0] || {}, jv = res[1] || {};
      var out = [];
      Object.keys(sv).forEach(function (k) {
        var s = sv[k];
        if (s && typeof s === 'object') { s = Object.assign({ _key: k }, s); s.status = s.status || 'draft'; out.push(s); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.jobs = jv || {};
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[stories-v2] load', e); render(); });
  }
  function reloadSoon() { setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (s) { return statusOf(s) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (s) {
        return storyTitle(s).toLowerCase().indexOf(q) >= 0 ||
               jobLabel(s).toLowerCase().indexOf(q) >= 0 ||
               excerptOf(s).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('stories-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('storiesV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'storiesV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['published', 'Published'], ['draft', 'Draft']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="StoriesV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Stories',
        count: N.count(V2.rows.length) + (V2.rows.length === 1 ? ' story' : ' stories'),
        actionsHtml: '<button class="btn btn-primary" onclick="StoriesV2.newStory()">+ New Story</button> ' +
          '<button class="btn btn-secondary" onclick="StoriesV2.exportCsv()">&darr; Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search title, job or caption..." value="' + esc(V2.q) +
        '" oninput="StoriesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('stories-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'StoriesV2.sort', onRowClickFnName: 'StoriesV2.open',
        empty: { title: 'No stories', message: V2.loaded ? 'Click “+ New Story” to create your first story.' : 'Loading...' }
      });
  }

  window.StoriesV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'entryCount' || key === 'publishedAt' || key === 'updatedAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('stories-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('stories-v2', rec, 'read');
      });
    },
    // ── native curation canvas (drilled SO) ──
    curate: function (id) {
      if (typeof window.can === 'function' && !window.can('stories', 'edit')) { if (window.showToast) showToast('You don\'t have permission to edit stories.', true); return; }
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('production'); } catch (e) {} }
      MastEntity.drill('story-curation-v2', id);
    },
    curToggle: function (el) {
      el.classList.toggle('selected');
      var url = el.getAttribute('data-url'), buildId = el.getAttribute('data-buildid') || '', source = el.getAttribute('data-source') || 'build';
      if (el.classList.contains('selected')) {
        CUR.draft.push({ id: MastDB.newKey('_ids'), mediaUrl: url, milestone: '', caption: '', buildId: buildId, source: source, order: CUR.draft.length });
      } else {
        CUR.draft = CUR.draft.filter(function (e) { return e.mediaUrl !== url; });
        CUR.draft.forEach(function (e, i) { e.order = i; });
      }
      renderCurEntries();
      syncCurThumbs();
    },
    curAddText: function () { CUR.draft.push({ id: MastDB.newKey('_ids'), mediaUrl: '', milestone: '', caption: '', buildId: '', source: 'text', order: CUR.draft.length }); renderCurEntries(); },
    curUpdate: function (idx, field, value) { if (CUR.draft[idx]) CUR.draft[idx][field] = value; },
    curMove: function (idx, dir) {
      var n = idx + dir; if (n < 0 || n >= CUR.draft.length) return;
      var t = CUR.draft[idx]; CUR.draft[idx] = CUR.draft[n]; CUR.draft[n] = t;
      CUR.draft.forEach(function (e, i) { e.order = i; }); renderCurEntries();
    },
    curRemove: function (idx) {
      CUR.draft.splice(idx, 1); CUR.draft.forEach(function (e, i) { e.order = i; }); renderCurEntries();
      syncCurThumbs();
    },
    curUpload: function (input) {
      if (typeof window.can === 'function' && !window.can('stories', 'edit')) { if (window.showToast) showToast('You don\'t have permission to edit stories.', true); return; }
      var files = Array.prototype.slice.call(input.files || []); input.value = '';
      if (!files.length) return;
      if (!window.StoriesBridge || !StoriesBridge.uploadMedia || !CUR) { if (window.showToast) showToast('Stories engine still loading — try again', true); return; }
      var prog = document.getElementById('storyV2UploadProgress'), did = 0;
      (function next(i) {
        if (i >= files.length) { if (did && window.showToast) showToast(MastFormat.countNoun(did, 'photo') + ' uploaded — save the draft to keep changes.'); return; }
        var f = files[i];
        if (!/^image\//.test(f.type)) { return next(i + 1); }
        var node = null;
        if (prog) { node = document.createElement('div'); node.style.cssText = 'font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;'; node.textContent = 'Uploading ' + f.name + '…'; prog.appendChild(node); }
        Promise.resolve(StoriesBridge.uploadMedia(CUR.storyId, f)).then(function (url) {
          CUR.draft.push({ id: MastDB.newKey('_ids'), mediaUrl: url, milestone: '', caption: '', buildId: '', source: 'upload', order: CUR.draft.length });
          renderCurEntries(); if (node) node.textContent = '✓ ' + f.name; did++;
        }).catch(function (e) { if (node) node.textContent = '✗ ' + f.name + ' — ' + (e && e.message); }).then(function () { next(i + 1); });
      })(0);
    },
    curPreview: function () {
      if (!CUR) return;
      var title = ((document.getElementById('storyV2CurTitle') || {}).value || '');
      var entries = CUR.draft.slice().sort(function (a, b) { return a.order - b.order; });
      if (typeof window.showStoryPreview === 'function') window.showStoryPreview(title, entries);
    },
    curSave: function () { curPersist(false); },
    curPublish: function () { curPersist(true); },
    // ── detail-level publish / preview / QR (no curation needed) ──
    preview: function (id) {
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('production'); } catch (e) {} }
      if (typeof window.previewStory === 'function') { window.previewStory(id); return; }
      var s = V2.byId[id]; if (s && typeof window.showStoryPreview === 'function') window.showStoryPreview(s.title || '', entriesOf(s));
    },
    publishFromDetail: function (id) {
      if (typeof window.can === 'function' && !window.can('stories', 'edit')) { if (window.showToast) showToast('You don\'t have permission to edit stories.', true); return; }
      if (!window.StoriesBridge || !StoriesBridge.publish) { if (window.showToast) showToast('Stories engine still loading — try again', true); return; }
      var s = V2.byId[id]; if (!s) return;
      Promise.resolve(StoriesBridge.publish(id, { title: s.title, entries: s.entries || {}, jobId: s.jobId || null })).then(function (payload) {
        Object.assign(s, payload || {});
        if (window.showToast) showToast('Story published!');
        reloadSoon();
        MastEntity.get('stories-v2').fetch(id).then(function (rec) { if (rec) MastEntity.openRecord('stories-v2', rec, 'read'); });
      }).catch(function (e) { console.error('[stories-v2] publish', e); if (window.showToast) showToast('Error publishing.', true); });
    },
    unpublish: function (id) {
      if (typeof window.can === 'function' && !window.can('stories', 'edit')) { if (window.showToast) showToast('You don\'t have permission to edit stories.', true); return; }
      if (!window.StoriesBridge || !StoriesBridge.unpublish) { if (window.showToast) showToast('Stories engine still loading — try again', true); return; }
      Promise.resolve(window.mastConfirm ? mastConfirm('Unpublish this story? It will be removed from linked product pages.', { title: 'Unpublish story?', confirmLabel: 'Unpublish' }) : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(StoriesBridge.unpublish(id)).then(function () {
          var s = V2.byId[id]; if (s) { s.status = 'draft'; s.updatedAt = new Date().toISOString(); }
          if (window.showToast) showToast('Story unpublished.');
          reloadSoon();
          MastEntity.get('stories-v2').fetch(id).then(function (rec) { if (rec) MastEntity.openRecord('stories-v2', rec, 'read'); });
        });
      }).catch(function (e) { console.error('[stories-v2] unpublish', e); if (window.showToast) showToast('Error.', true); });
    },
    qrPrint: function (dataUrl, name) { if (typeof window.printStoryQR === 'function') window.printStoryQR(dataUrl, name); },
    qrCopy: function (url) { if (typeof window.copyStoryQRUrl === 'function') window.copyStoryQRUrl(url); else window.MastUI.copy(url, { okMsg: 'URL copied' }); },
    qrCard: function (pid, name, url) { if (typeof window.printProductCard === 'function') window.printProductCard(pid, name, url); else if (window.showToast) showToast('Print Card unavailable', true); },
    // Create a story NATIVELY (title → draft skeleton); the write delegates to
    // StoriesBridge.create. Photos / captions / publishing are then added in the
    // native curation canvas (the Curate button on the story detail).
    newStory: function () {
      if (typeof window.can === 'function' && !window.can('stories', 'edit')) {
        if (window.showToast) showToast('You don\'t have permission to create stories.', true); return;
      }
      // Ensure legacy production.js is loaded so window.StoriesBridge exists at save.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('production'); } catch (e) {} }
      MastEntity.openRecord('stories-v2', {}, 'create');
    },
    // Draft deletion (Wave 3): published stories are live on the storefront —
    // they never delete from the twin (unpublish lives with Production).
    removeDraft: function (id) {
      if (typeof window.can === 'function' && !window.can('stories', 'delete')) {
        if (window.showToast) showToast('You don\'t have permission to delete stories.', true); return;
      }
      var s = V2.byId[id];
      if (s && statusOf(s) !== 'draft') { if (window.showToast) showToast('Only draft stories can be deleted here.', true); return; }
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Delete this draft story? Its entries go with it.', { title: 'Delete draft story?', confirmLabel: 'Delete', dangerous: true })
        : true).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(MastDB.remove('public/stories/' + id)).then(function () {
          if (window.writeAudit) writeAudit('delete', 'story-draft', id);
          if (window.showToast) showToast('Draft story deleted.');
          try { U.slideOut.requestCloseForce(); } catch (e) {}
          load();
        });
      }).catch(function (e) { console.error('[stories-v2] removeDraft', e); if (window.showToast) showToast('Delete failed.', true); });
    },
    exportCsv: function () { return MastEntity.exportRows('stories-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('stories-v2', {
    routes: { 'stories-v2': { tab: 'storiesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
