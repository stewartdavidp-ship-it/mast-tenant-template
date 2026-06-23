/**
 * Image Library route view — the `#images` library surface: grid render +
 * filters/sort, the image-detail modal (tags/collections/backrefs/locality +
 * "Move to Local Storage"), the All/Collections sub-tabs, the tag-filter chip
 * strip, and full Collections CRUD.
 *
 * Extracted VERBATIM from app/index.html's inline block (decomposition master
 * plan §14, Track 1 — recipe B, an eager-shim-fronted route view). NOTE: the
 * lightbox `app/modules/image-modal.js` is a DIFFERENT cluster; this is the
 * library route renderers.
 *
 * Reads eager shell globals only (all defined before a user can reach the
 * #images route): imageLibrary / imageLibraryLoaded (eager listener-backed),
 * gallery, productsData, MastDB, esc, openModal, closeModal, showToast,
 * mastConfirm/confirm, auth, callCF. computeImageUsage + _imageStorageLocality
 * are cluster-only helpers and move with the cluster.
 *
 * Lazy-loaded on #images route entry (lazyLoadForRoute) + via the eager
 * renderImageLibrary / renderImagesTagChipStrip / setImagesSubTab shims in
 * index.html (static onclick filters + the imageLibrary listener re-render).
 * The detail-modal / collection-editor onclick targets are exported on window
 * directly (the module's own generated markup calls them after it has loaded).
 */
(function () {
  'use strict';

function computeImageUsage() {
  var usage = {};
  function ensure(iid) {
    if (!usage[iid]) usage[iid] = { onWebsite: false, products: [], galleryCount: 0 };
    return usage[iid];
  }
  // Scan gallery for URL matches to library images
  Object.values(gallery).forEach(function(g) {
    Object.keys(imageLibrary).forEach(function(imgId) {
      var img = imageLibrary[imgId];
      if (g.url === img.url || g.url === img.thumbnailUrl) {
        ensure(imgId).onWebsite = true;
        usage[imgId].galleryCount++;
      }
    });
  });
  // W2 round 2 FIX 2: index productsData by pid + id for direct
  // `image.productId` foreign-key lookup. Many images on this tenant carry
  // a direct productId — the previous logic only matched via product-side
  // imageIds[] / images[] / imageUrl, which misses those entirely (header
  // showed "1 linked" against a library where most images have productId).
  var productsById = {};
  (productsData || []).forEach(function(p) {
    if (!p) return;
    if (p.pid) productsById[p.pid] = p;
    if (p.id && !productsById[p.id]) productsById[p.id] = p;
  });
  // Direct image.productId foreign-key resolution
  Object.keys(imageLibrary).forEach(function(imgId) {
    var img = imageLibrary[imgId];
    if (img && img.productId && productsById[img.productId]) {
      var p = productsById[img.productId];
      var label = p.name || p.pid || img.productId;
      var slot = ensure(imgId);
      if (slot.products.indexOf(label) === -1) slot.products.push(label);
    }
  });
  // Scan products for imageId matches (product-side links)
  productsData.forEach(function(p) {
    var label = p.name || p.pid;
    (p.imageIds || []).forEach(function(iid) {
      var slot = ensure(iid);
      if (slot.products.indexOf(label) === -1) slot.products.push(label);
    });
    // Also check image URL matches for products that only have urls but no imageIds
    (p.images || []).forEach(function(pUrl) {
      var url = (pUrl && typeof pUrl === 'object') ? pUrl.url : pUrl;
      if (!url) return;
      Object.keys(imageLibrary).forEach(function(imgId) {
        if (imageLibrary[imgId].url === url) {
          var slot = ensure(imgId);
          if (slot.products.indexOf(label) === -1) slot.products.push(label);
        }
      });
    });
    if (p.imageUrl) {
      Object.keys(imageLibrary).forEach(function(imgId) {
        if (imageLibrary[imgId].url === p.imageUrl) {
          var slot = ensure(imgId);
          if (slot.products.indexOf(label) === -1) slot.products.push(label);
        }
      });
    }
  });
  return usage;
}

// GiexZyM — Detect whether an image asset is stored in this tenant's Firebase
// Storage (local) or hot-linked from an external origin (remote). Returns
// 'local' | 'remote' | 'unknown' so render code can branch cleanly.
function _imageStorageLocality(img) {
  if (!img) return 'unknown';
  var url = img.url || img.thumbnailUrl || '';
  if (!url || typeof url !== 'string') return 'unknown';
  if (/^gs:\/\//.test(url)) return 'local';
  // Extract host from "scheme://host/path". The original anchored regex
  // /(^|\.)firebasestorage.../ misclassified normal https URLs because the
  // `://` separator sits between the protocol and the host.
  var hostMatch = url.match(/^[a-z]+:\/\/([^\/?#]+)/i);
  var host = hostMatch ? hostMatch[1].toLowerCase() : '';
  if (host === 'firebasestorage.googleapis.com' || host.endsWith('.firebasestorage.googleapis.com')) return 'local';
  if (host === 'storage.googleapis.com' || host.endsWith('.storage.googleapis.com')) return 'local';
  return 'remote';
}

function renderImageLibrary() {
  var grid = document.getElementById('imageLibraryGrid');
  var statsEl = document.getElementById('imageLibraryStats');
  if (!grid) return;

  if (!imageLibraryLoaded) {
    grid.innerHTML = '<div class="loading">Loading image library...</div>';
    return;
  }

  var entries = Object.entries(imageLibrary);
  var search = (document.getElementById('imageLibrarySearch') || {}).value || '';
  search = search.toLowerCase().trim();

  // Filter by tags/source/id search (legacy)
  if (search) {
    entries = entries.filter(function(e) {
      var img = e[1];
      var tagStr = (img.tags || []).join(' ').toLowerCase();
      var src = (img.source || '').toLowerCase();
      return tagStr.indexOf(search) !== -1 || src.indexOf(search) !== -1 || (img.id || '').toLowerCase().indexOf(search) !== -1;
    });
  }

  // W2.4 — single-tag chip filter (exact tag match)
  if (imagesTagFilter) {
    entries = entries.filter(function(e) {
      var img = e[1];
      return (img.tags || []).some(function(t) { return String(t || '').trim().toLowerCase() === imagesTagFilter; });
    });
  }

  // W1.10 — filename substring filter (case-insensitive)
  var fnameQ = ((document.getElementById('imageLibraryFilename') || {}).value || '').toLowerCase().trim();
  if (fnameQ) {
    entries = entries.filter(function(e) {
      var img = e[1];
      return String(img.filename || '').toLowerCase().indexOf(fnameQ) !== -1;
    });
  }

  // W1.10 — date range filter (uses image.createdAt, falls back to uploadedAt)
  var fromVal = (document.getElementById('imageLibraryDateFrom') || {}).value || '';
  var toVal = (document.getElementById('imageLibraryDateTo') || {}).value || '';
  var fromMs = fromVal ? new Date(fromVal + 'T00:00:00').getTime() : NaN;
  var toMs = toVal ? new Date(toVal + 'T23:59:59').getTime() : NaN;
  if (!isNaN(fromMs) || !isNaN(toMs)) {
    entries = entries.filter(function(e) {
      var img = e[1];
      var raw = img.createdAt || img.uploadedAt || null;
      if (!raw) return false;
      var t = new Date(raw).getTime();
      if (isNaN(t)) return false;
      if (!isNaN(fromMs) && t < fromMs) return false;
      if (!isNaN(toMs) && t > toMs) return false;
      return true;
    });
  }

  // W1.10 — sort: newest / oldest / most-used
  var sortMode = (document.getElementById('imageLibrarySort') || {}).value || 'newest';
  var usageForSort = (sortMode === 'mostUsed') ? computeImageUsage() : null;
  if (sortMode === 'oldest') {
    entries.sort(function(a, b) {
      return (a[1].uploadedAt || '').localeCompare(b[1].uploadedAt || '');
    });
  } else if (sortMode === 'mostUsed') {
    entries.sort(function(a, b) {
      var ua = usageForSort && usageForSort[a[0]];
      var ub = usageForSort && usageForSort[b[0]];
      var ca = ua ? ((ua.products ? ua.products.length : 0) + (ua.galleryCount || 0) + (ua.onWebsite ? 1 : 0)) : 0;
      var cb = ub ? ((ub.products ? ub.products.length : 0) + (ub.galleryCount || 0) + (ub.onWebsite ? 1 : 0)) : 0;
      if (cb !== ca) return cb - ca;
      // tiebreak: newest first
      return (b[1].uploadedAt || '').localeCompare(a[1].uploadedAt || '');
    });
  } else {
    // newest (default)
    entries.sort(function(a, b) {
      return (b[1].uploadedAt || '').localeCompare(a[1].uploadedAt || '');
    });
  }

  var usage = computeImageUsage();
  var totalOnWebsite = 0;
  var totalLinked = 0;
  Object.keys(imageLibrary).forEach(function(imgId) {
    var u = usage[imgId];
    if (u && u.onWebsite) totalOnWebsite++;
    if (u && u.products.length > 0) totalLinked++;
  });

  // Stats
  statsEl.innerHTML =
    '<span><span class="img-lib-stat-num">' + Object.keys(imageLibrary).length + '</span> total images</span>' +
    '<span><span class="img-lib-stat-num">' + totalOnWebsite + '</span> on website</span>' +
    '<span><span class="img-lib-stat-num">' + totalLinked + '</span> linked to products</span>';

  if (entries.length === 0) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--warm-gray);">' +
      (search ? 'No images match "' + esc(search) + '".' : 'No images in library yet. Upload one to get started.') + '</div>';
    return;
  }

  var html = '<div class="img-lib-grid">';
  entries.forEach(function(entry) {
    var id = entry[0];
    var img = entry[1];
    var u = usage[id] || { onWebsite: false, products: [], galleryCount: 0 };
    var isVideo = img.type === 'video' || (img.contentType && img.contentType.indexOf('video') === 0);
    var thumb = img.thumbnailUrl || (isVideo ? '' : img.url) || '';
    var tags = (img.tags || []).join(', ') || (img.description ? img.description.substring(0, 60) : '');
    var date = img.uploadedAt ? MastFormat.date(img.uploadedAt) : (img.uploadDate || '');

    html += '<div class="img-lib-card" onclick="viewLibraryImage(\'' + esc(id) + '\')">' +
      (thumb
        ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
        : '<div style="height:120px;display:flex;align-items:center;justify-content:center;background:var(--charcoal);color:var(--warm-gray-light);font-size:1.6rem;">' +
          (isVideo ? '\u25B6' : '\u{1F5BC}') + '</div>') +
      '<div class="img-lib-card-body">' +
        (tags ? '<div class="img-lib-card-tags">' + esc(tags) + '</div>' : '') +
        '<div class="img-lib-card-badges">';
    if (u.onWebsite) html += '<span class="img-lib-badge website">Website</span>';
    if (u.products.length > 0) html += '<span class="img-lib-badge product">Product</span>';
    if (img.source && img.source !== 'admin-upload') html += '<span class="img-lib-badge source">' + esc(img.source) + '</span>';
    // GiexZyM — Local vs Remote storage indicator. Firebase Storage URLs
    // come from firebasestorage.googleapis.com or storage.googleapis.com;
    // anything else is hot-linked from a remote origin. Showing this on the
    // card makes it obvious which assets the tenant owns vs depends on.
    var _locality = _imageStorageLocality(img);
    if (_locality === 'local') {
      html += '<span class="img-lib-badge" style="background:rgba(42,124,111,0.15);color:var(--teal,#2a7c6f);" title="Stored in this tenant\'s Firebase Storage">Local</span>';
    } else if (_locality === 'remote') {
      html += '<span class="img-lib-badge" style="background:rgba(180,83,9,0.18);color:#9a3412;" title="Hot-linked from an external origin — consider moving to local storage">Remote</span>';
    }
    html += '</div>' +
        (date ? '<div style="font-size:0.72rem;color:var(--warm-gray-light);margin-top:2px;">' + date + '</div>' : '') +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  grid.innerHTML = html;
}

function viewLibraryImage(imageId) {
  var img = imageLibrary[imageId];
  if (!img) return;
  var usage = computeImageUsage();
  var u = usage[imageId] || { onWebsite: false, products: [], galleryCount: 0 };
  var tags = (img.tags || []).join(', ') || 'none';
  var dims = img.dimensions ? (img.dimensions.width + ' x ' + img.dimensions.height) : 'unknown';

  var isVideo = img.type === 'video' || (img.contentType && img.contentType.indexOf('video') === 0);
  var mediaPreview = isVideo
    ? '<video src="' + esc(img.url) + '" controls style="max-width:100%;max-height:300px;border-radius:8px;" preload="metadata"></video>'
    : '<img src="' + esc(img.url || img.thumbnailUrl) + '" style="max-width:100%;max-height:300px;border-radius:8px;" loading="lazy">';

  var _detailLocality = _imageStorageLocality(img);

  var html =
    '<div class="modal-header">' +
      '<h3>' + (isVideo ? 'Video' : 'Image') + ' Details</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div style="text-align:center;margin-bottom:16px;">' +
        mediaPreview +
      '</div>' +
      (img.description ? '<div style="font-size:0.9rem;margin-bottom:12px;color:var(--warm-white);">' + esc(img.description) + '</div>' : '') +
      '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:0.9rem;">' +
        '<span style="color:var(--warm-gray);">Type</span><span>' + (isVideo ? 'Video' + (img.duration ? ' (' + img.duration + 's)' : '') : 'Image') + '</span>' +
        '<span style="color:var(--warm-gray);">Source</span><span>' + esc(img.source || 'unknown') + (img.instagramUrl ? ' <a href="' + esc(img.instagramUrl) + '" target="_blank" style="color:var(--amber);">View on IG</a>' : '') + '</span>' +
        // GiexZyM — Storage locality row. Helps the operator see at a glance
        // whether the asset is hot-linked from an external origin (risk:
        // origin can break / change without notice / count against another
        // service's bandwidth) vs hosted in this tenant's Firebase Storage.
        '<span style="color:var(--warm-gray);">Storage</span><span>' + (function() {
          var loc = _imageStorageLocality(img);
          if (loc === 'local') return '<span style="color:var(--teal,#2a7c6f);font-weight:600;">Local</span> <span style="color:var(--warm-gray);font-size:0.78rem;">— in your Firebase Storage</span>';
          if (loc === 'remote') return '<span style="color:#9a3412;font-weight:600;">Remote</span> <span style="color:var(--warm-gray);font-size:0.78rem;">— hot-linked from external origin; use “Move to Local Storage” below to copy it into your Firebase Storage</span>';
          return '<span style="color:var(--warm-gray);">unknown</span>';
        })() + '</span>' +
        '<span style="color:var(--warm-gray);">Dimensions</span><span>' + (img.resolution || dims) + '</span>' +
        '<span style="color:var(--warm-gray);">Tags</span><span>' + esc(tags) + '</span>' +
        '<span style="color:var(--warm-gray);">Uploaded</span><span>' + (img.uploadedAt ? MastFormat.dateTime(img.uploadedAt) : (img.uploadDate || 'unknown')) + '</span>' +
        '<span style="color:var(--warm-gray);">On Website</span><span>' + (u.onWebsite ? 'Yes (' + MastFormat.countNoun(u.galleryCount, 'placement') + ')' : 'No') + '</span>' +
        '<span style="color:var(--warm-gray);">Products</span><span>' + (u.products.length > 0 ? esc(u.products.join(', ')) : 'None') + '</span>' +
      '</div>' +
      // W2.4 — editable tags
      '<div style="margin-top:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);">Tags (comma-separated)</label>' +
        '<div style="display:flex;gap:6px;">' +
          '<input type="text" id="imgDetailTagsInput" value="' + esc((img.tags || []).join(', ')) + '" placeholder="figurine, blue, summer" style="flex:1;font-size:0.85rem;padding:6px 8px;">' +
          '<button class="btn btn-secondary btn-small" onclick="saveImageTags(\'' + esc(imageId) + '\')">Save</button>' +
        '</div>' +
      '</div>' +
      // W2.4 — collections
      '<div style="margin-top:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);">Collections</label>' +
        '<div id="imgDetailCollections" style="font-size:0.85rem;">Loading...</div>' +
        '<button class="btn btn-secondary btn-small" style="margin-top:4px;" onclick="openAddImageToCollectionPicker(\'' + esc(imageId) + '\')">+ Add to collection</button>' +
      '</div>' +
      // W2.4 — backref scanner (lazy)
      '<div style="margin-top:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);">Used in</label>' +
        '<div id="imgDetailBackrefs" style="font-size:0.85rem;">Scanning...</div>' +
      '</div>' +
      '<div style="margin-top:12px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);">' + (isVideo ? 'Video' : 'Image') + ' URL</label>' +
        '<input type="text" value="' + esc(img.url || '') + '" readonly onclick="this.select()" style="width:100%;font-size:0.78rem;">' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      (_detailLocality === 'remote' && !isVideo
        ? '<button class="btn btn-secondary" id="moveToLocalBtn" onclick="moveImageToLocal(\'' + esc(imageId) + '\')" title="Copy this image into your Firebase Storage so it no longer depends on the external origin">Move to Local Storage</button>'
        : '') +
      '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
    '</div>';
  openModal(html);
  // W2.4 — populate collections + backrefs lazily after modal renders
  setTimeout(function() {
    renderImageDetailCollections(imageId);
    renderImageDetailBackrefs(imageId);
  }, 0);
}

// GiexZyM — Move a Remote (hot-linked) image into this tenant's Firebase
// Storage. The actual fetch+upload runs server-side in the
// moveImageToLocalStorage CF (browsers can't reliably copy a cross-origin
// image due to CORS/canvas-taint). Only the image record's url is rewritten;
// URL-based references elsewhere (product images[], gallery) are a tracked
// follow-up. The imageLibrary listener refreshes the grid on success.
async function moveImageToLocal(imageId) {
  var btn = document.getElementById('moveToLocalBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Moving…'; }
  try {
    var token = await auth.currentUser.getIdToken();
    var resp = await callCF('/moveImageToLocalStorage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ imageId: imageId })
    });
    var result = await resp.json();
    if (!resp.ok || !result.success) {
      showToast((result && result.error) || 'Move failed.', true);
      if (btn) { btn.disabled = false; btn.textContent = 'Move to Local Storage'; }
      return;
    }
    // Reflect the new URL locally so a re-open shows Local immediately even
    // before the listener fires.
    if (imageLibrary[imageId]) {
      imageLibrary[imageId].url = result.url;
      imageLibrary[imageId].thumbnailUrl = result.thumbnailUrl;
      imageLibrary[imageId].source = 'migrated-local';
    }
    showToast('Image moved to your Firebase Storage.');
    viewLibraryImage(imageId);
  } catch (err) {
    console.error('moveImageToLocal failed:', err);
    showToast('Move failed: ' + (err && err.message ? err.message : 'unknown error'), true);
    if (btn) { btn.disabled = false; btn.textContent = 'Move to Local Storage'; }
  }
}

// ============================================================
// W2.4 — Image Library v2: tags / collections / backrefs
// ============================================================
//
// Tags: stored as `img.tags[]` on each image doc (already supported).
// Tag autocomplete sources are the union of tags across the library
// (no separate `imageTags` collection needed — index built in memory).
// Tag-filter chip strip sits above the grid.
//
// Collections: `imageCollections/{collectionId}` =
//   { id, name, description, imageIds[], coverImageId, createdAt, updatedAt }.
// Admin-only writes (covered by the existing admin-only catch-all rule).
//
// Backrefs: lazy scan on detail-modal open. NOT a Firebase collection —
// computed live by scanning products / blog / social / stories / homepage.
// Cached in `imageBackrefsCache[imageId]` for the session.

var imagesSubTab = 'all';
var imagesTagFilter = ''; // current tag filter (single)
var imageCollections = {}; // loaded lazily
var imageCollectionsLoaded = false;
var imageBackrefsCache = {};

function setImagesSubTab(tab) {
  imagesSubTab = tab;
  var allBtn = document.getElementById('imagesSubTabAll');
  var colBtn = document.getElementById('imagesSubTabCollections');
  var grid   = document.getElementById('imageLibraryGrid');
  var cols   = document.getElementById('imageCollectionsView');
  var chipStrip = document.getElementById('imagesTagChipStrip');
  var stats  = document.getElementById('imageLibraryStats');
  if (!allBtn || !colBtn) return;
  if (tab === 'collections') {
    allBtn.style.borderBottomColor = 'transparent';
    allBtn.style.color = 'var(--warm-gray)';
    colBtn.style.borderBottomColor = 'var(--amber)';
    colBtn.style.color = 'var(--text-primary)';
    colBtn.style.fontWeight = '600';
    allBtn.style.fontWeight = '400';
    if (grid) grid.style.display = 'none';
    if (cols) cols.style.display = 'block';
    if (chipStrip) chipStrip.style.display = 'none';
    if (stats) stats.style.display = 'none';
    loadAndRenderImageCollections();
  } else {
    allBtn.style.borderBottomColor = 'var(--amber)';
    allBtn.style.color = 'var(--text-primary)';
    allBtn.style.fontWeight = '600';
    colBtn.style.borderBottomColor = 'transparent';
    colBtn.style.color = 'var(--warm-gray)';
    colBtn.style.fontWeight = '400';
    if (grid) grid.style.display = '';
    if (cols) cols.style.display = 'none';
    if (chipStrip) chipStrip.style.display = '';
    if (stats) stats.style.display = '';
    renderImagesTagChipStrip();
    renderImageLibrary();
  }
}

function renderImagesTagChipStrip() {
  var el = document.getElementById('imagesTagChipStrip');
  if (!el) return;
  var counts = {};
  Object.keys(imageLibrary || {}).forEach(function(id) {
    var img = imageLibrary[id];
    (img.tags || []).forEach(function(t) {
      t = String(t || '').trim().toLowerCase();
      if (!t) return;
      counts[t] = (counts[t] || 0) + 1;
    });
  });
  var tags = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; }).slice(0, 24);
  if (!tags.length) { el.innerHTML = ''; return; }
  var html = '<span style="color:var(--warm-gray);margin-right:4px;">Tag:</span>';
  html += '<span class="img-tag-chip" data-tag="" onclick="setImageTagFilter(\'\')" style="padding:3px 10px;border-radius:999px;border:1px solid ' + (imagesTagFilter === '' ? 'var(--amber)' : 'var(--cream-dark)') + ';background:' + (imagesTagFilter === '' ? 'var(--amber)' : 'transparent') + ';color:' + (imagesTagFilter === '' ? '#fff' : 'var(--text-primary)') + ';cursor:pointer;">All</span>';
  tags.forEach(function(t) {
    var active = imagesTagFilter === t;
    // W2-SEC: read tag from data-tag (HTML-attribute-escaped) rather than inlining
    // into the JS string literal. esc() encodes ' as &#39; which the HTML parser
    // decodes inside the attribute value, allowing JS-context escape from user-typed
    // tag content. dataset.tag is the parsed attribute value — no JS-context concat.
    html += '<span class="img-tag-chip" data-tag="' + esc(t) + '" onclick="setImageTagFilter(this.dataset.tag)" style="padding:3px 10px;border-radius:999px;border:1px solid ' + (active ? 'var(--amber)' : 'var(--cream-dark)') + ';background:' + (active ? 'var(--amber)' : 'transparent') + ';color:' + (active ? '#fff' : 'var(--text-primary)') + ';cursor:pointer;">' + esc(t) + ' <span style="opacity:.7;">' + counts[t] + '</span></span>';
  });
  el.innerHTML = html;
}

function setImageTagFilter(t) {
  imagesTagFilter = String(t || '').trim().toLowerCase();
  renderImagesTagChipStrip();
  renderImageLibrary();
}

async function saveImageTags(imageId) {
  var inp = document.getElementById('imgDetailTagsInput');
  if (!inp) return;
  var raw = inp.value || '';
  var tags = raw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  try {
    await MastDB.update('images/' + imageId, { tags: tags, updatedAt: new Date().toISOString() });
    if (imageLibrary[imageId]) imageLibrary[imageId].tags = tags;
    if (typeof showToast === 'function') showToast('Tags saved');
    renderImagesTagChipStrip();
  } catch (e) {
    console.warn('[W2.4] saveImageTags', e);
    if (typeof showToast === 'function') showToast('Failed to save tags', true);
  }
}

async function loadAndRenderImageCollections() {
  var host = document.getElementById('imageCollectionsView');
  if (!host) return;
  host.innerHTML = '<div class="loading">Loading collections...</div>';
  try {
    var snap = await MastDB.list('imageCollections');
    imageCollections = snap || {};
    imageCollectionsLoaded = true;
  } catch (e) {
    imageCollections = {};
    console.warn('[W2.4] loadCollections', e);
  }
  var ids = Object.keys(imageCollections);
  var html = '<div style="display:flex;gap:8px;margin:8px 0;">' +
    '<button class="btn btn-primary" onclick="openCollectionEditor(null)">+ New Collection</button>' +
    '</div>';
  if (!ids.length) {
    html += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">No collections yet. Create one to group images for campaigns, lookbooks, or batch publishing.</div>';
    host.innerHTML = html;
    return;
  }
  html += '<div class="img-lib-grid">';
  ids.sort(function(a, b) { return (imageCollections[b].createdAt || '').localeCompare(imageCollections[a].createdAt || ''); });
  ids.forEach(function(cid) {
    var c = imageCollections[cid];
    var count = (c.imageIds || []).length;
    var cover = c.coverImageId && imageLibrary[c.coverImageId];
    var thumb = cover ? (cover.thumbnailUrl || cover.url) : '';
    html += '<div class="img-lib-card" onclick="openCollectionEditor(\'' + esc(cid) + '\')" style="cursor:pointer;">' +
      (thumb ? '<img src="' + esc(thumb) + '" loading="lazy" onerror="this.style.display=\'none\'">' :
        '<div style="height:120px;display:flex;align-items:center;justify-content:center;background:var(--charcoal);color:var(--warm-gray-light);font-size:1.6rem;">&#128194;</div>') +
      '<div class="img-lib-card-body">' +
        '<div style="font-weight:600;font-size:0.9rem;">' + esc(c.name || '(untitled)') + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">' + MastFormat.countNoun(count, 'image') + '</div>' +
      '</div></div>';
  });
  html += '</div>';
  host.innerHTML = html;
}

function openCollectionEditor(cid) {
  var existing = cid ? imageCollections[cid] : null;
  var name = existing ? (existing.name || '') : '';
  var desc = existing ? (existing.description || '') : '';
  var imageIds = existing ? (existing.imageIds || []).slice() : [];
  var coverId = existing ? (existing.coverImageId || '') : '';
  var html =
    '<div class="modal-header"><h3>' + (cid ? 'Edit Collection' : 'New Collection') + '</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
    '<div class="modal-body">' +
      '<div class="form-group"><label>Name</label><input type="text" id="collName" value="' + esc(name) + '"></div>' +
      '<div class="form-group"><label>Description</label><textarea id="collDesc" rows="2">' + esc(desc) + '</textarea></div>' +
      '<div class="form-group"><label>Images (' + imageIds.length + ' selected)</label>' +
        '<div id="collImageGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;max-height:220px;overflow:auto;border:1px solid var(--cream-dark);padding:6px;border-radius:4px;">' +
          Object.keys(imageLibrary).map(function(id) {
            var im = imageLibrary[id];
            var th = im.thumbnailUrl || im.url || '';
            var sel = imageIds.indexOf(id) !== -1;
            return '<label style="position:relative;cursor:pointer;">' +
              '<input type="checkbox" class="coll-img-cb" data-img-id="' + esc(id) + '"' + (sel ? ' checked' : '') + ' style="position:absolute;top:2px;left:2px;z-index:1;">' +
              (th ? '<img src="' + esc(th) + '" style="width:100%;height:60px;object-fit:cover;border-radius:3px;' + (sel ? 'outline:2px solid var(--amber);' : '') + '">' : '<div style="height:60px;background:var(--charcoal);"></div>') +
              '</label>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="form-group"><label>Cover image ID (optional)</label><input type="text" id="collCover" value="' + esc(coverId) + '" placeholder="Leave blank for first image"></div>' +
    '</div>' +
    '<div class="modal-footer">' +
      (cid ? '<button class="btn btn-danger" onclick="deleteImageCollection(\'' + esc(cid) + '\')">Delete</button>' : '') +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveImageCollection(' + (cid ? '\'' + esc(cid) + '\'' : 'null') + ')">Save</button>' +
    '</div>';
  openModal(html);
}

async function saveImageCollection(cid) {
  var name = (document.getElementById('collName') || {}).value || '';
  var desc = (document.getElementById('collDesc') || {}).value || '';
  var cover = (document.getElementById('collCover') || {}).value || '';
  var ids = [];
  var cbs = document.querySelectorAll('.coll-img-cb');
  for (var i = 0; i < cbs.length; i++) {
    if (cbs[i].checked) ids.push(cbs[i].getAttribute('data-img-id'));
  }
  if (!name.trim()) { if (typeof showToast === 'function') showToast('Collection name required', true); return; }
  var nowIso = new Date().toISOString();
  try {
    if (cid) {
      await MastDB.update('imageCollections/' + cid, {
        name: name.trim(), description: desc.trim(), imageIds: ids,
        coverImageId: cover || ids[0] || null, updatedAt: nowIso
      });
    } else {
      var newId = MastDB.newKey('imageCollections');
      await MastDB.set('imageCollections/' + newId, {
        id: newId, name: name.trim(), description: desc.trim(), imageIds: ids,
        coverImageId: cover || ids[0] || null, createdAt: nowIso, updatedAt: nowIso
      });
    }
    if (typeof closeModal === 'function') closeModal();
    if (typeof showToast === 'function') showToast('Collection saved');
    loadAndRenderImageCollections();
  } catch (e) {
    console.warn('[W2.4] saveCollection', e);
    if (typeof showToast === 'function') showToast('Failed to save collection', true);
  }
}

async function deleteImageCollection(cid) {
  if (!confirm('Delete this collection? (Images themselves are not deleted.)')) return;
  try {
    await MastDB.remove('imageCollections/' + cid);
    delete imageCollections[cid];
    if (typeof closeModal === 'function') closeModal();
    if (typeof showToast === 'function') showToast('Collection deleted');
    loadAndRenderImageCollections();
  } catch (e) {
    if (typeof showToast === 'function') showToast('Failed to delete', true);
  }
}

async function renderImageDetailCollections(imageId) {
  var el = document.getElementById('imgDetailCollections');
  if (!el) return;
  if (!imageCollectionsLoaded) {
    try { imageCollections = (await MastDB.list('imageCollections')) || {}; imageCollectionsLoaded = true; }
    catch (_e) { imageCollections = {}; }
  }
  var inColls = [];
  Object.keys(imageCollections).forEach(function(cid) {
    var c = imageCollections[cid];
    if ((c.imageIds || []).indexOf(imageId) !== -1) inColls.push(c);
  });
  if (!inColls.length) { el.innerHTML = '<span style="color:var(--warm-gray);">Not in any collection.</span>'; return; }
  el.innerHTML = inColls.map(function(c) {
    return '<span style="display:inline-block;background:var(--cream);padding:2px 10px;border-radius:999px;margin:2px 4px 2px 0;font-size:0.78rem;">' + esc(c.name || '(untitled)') + '</span>';
  }).join('');
}

async function openAddImageToCollectionPicker(imageId) {
  if (!imageCollectionsLoaded) {
    try { imageCollections = (await MastDB.list('imageCollections')) || {}; imageCollectionsLoaded = true; }
    catch (_e) { imageCollections = {}; }
  }
  var ids = Object.keys(imageCollections);
  var html = '<div class="modal-header"><h3>Add to Collection</h3>' +
    '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
    '<div class="modal-body">';
  if (!ids.length) {
    html += '<p style="color:var(--warm-gray);">No collections yet. Create one from the Collections sub-tab.</p>';
  } else {
    html += '<div style="display:flex;flex-direction:column;gap:6px;">';
    ids.forEach(function(cid) {
      var c = imageCollections[cid];
      var inIt = (c.imageIds || []).indexOf(imageId) !== -1;
      html += '<button class="btn btn-secondary" style="text-align:left;" onclick="toggleImageInCollection(\'' + esc(imageId) + '\', \'' + esc(cid) + '\', ' + (!inIt) + ')">' +
        (inIt ? '✓ ' : '+ ') + esc(c.name || '(untitled)') + ' <span style="opacity:.6;font-size:0.78rem;">(' + (c.imageIds || []).length + ')</span></button>';
    });
    html += '</div>';
  }
  html += '</div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>';
  openModal(html);
}

async function toggleImageInCollection(imageId, collectionId, add) {
  var c = imageCollections[collectionId];
  if (!c) return;
  var ids = (c.imageIds || []).slice();
  var idx = ids.indexOf(imageId);
  if (add && idx === -1) ids.push(imageId);
  else if (!add && idx !== -1) ids.splice(idx, 1);
  try {
    await MastDB.update('imageCollections/' + collectionId, { imageIds: ids, updatedAt: new Date().toISOString() });
    c.imageIds = ids;
    if (typeof closeModal === 'function') closeModal();
    if (typeof showToast === 'function') showToast(add ? 'Added to collection' : 'Removed');
  } catch (e) {
    if (typeof showToast === 'function') showToast('Failed', true);
  }
}

// W2.4 — lazy backref scanner. Scans products/blog/social/stories/homepage
// for references to a given image (by id OR by url). Cached per session.
async function renderImageDetailBackrefs(imageId) {
  var el = document.getElementById('imgDetailBackrefs');
  if (!el) return;
  if (imageBackrefsCache[imageId]) {
    el.innerHTML = _formatBackrefList(imageBackrefsCache[imageId]);
    return;
  }
  el.innerHTML = '<span style="color:var(--warm-gray);">Scanning...</span>';
  var img = imageLibrary[imageId] || {};
  var url = img.url || '';
  var result = { products: [], blogPosts: [], socialPosts: [], stories: [], homepageSections: 0 };
  try {
    // Products — FIX 5 (W2 round 1): mirror computeImageUsage's data source
    // (productsData global, already loaded on app init). The previous code
    // read from `window.products` (which doesn't exist — the global is named
    // `productsData`) and fell back to `MastDB.list('public/products')`
    // which is a public-mirror path whose docs don't always carry the same
    // `imageIds[]` array the admin-side products do. The header stat at
    // top of the grid ("N linked to products") uses computeImageUsage —
    // so make this match.
    try {
      var pArr = (typeof productsData !== 'undefined' && Array.isArray(productsData))
        ? productsData
        : (window.productsData && Array.isArray(window.productsData) ? window.productsData : []);
      if (!pArr.length) {
        // Fallback: read public/products if productsData isn't loaded yet
        try {
          var prods = (await MastDB.list('public/products')) || {};
          pArr = Object.keys(prods).map(function(k) { return prods[k]; });
        } catch (_e) {}
      }
      // W2 round 2 FIX 2: direct image.productId foreign-key lookup first
      // (cheap, primary truth on this tenant). Then fall back to product-side
      // links so we still surface products that reference this image without
      // the image carrying productId.
      var seenProductIds = {};
      var imgProductId = img && img.productId;
      if (imgProductId) {
        for (var dpi = 0; dpi < pArr.length; dpi++) {
          var dp = pArr[dpi];
          if (dp && (dp.pid === imgProductId || dp.id === imgProductId)) {
            result.products.push({ id: dp.pid || dp.id, name: dp.name || dp.title || '(unnamed)' });
            seenProductIds[dp.pid || dp.id] = true;
            break;
          }
        }
      }
      pArr.forEach(function(p) {
        if (!p) return;
        var pid = p.pid || p.id;
        if (pid && seenProductIds[pid]) return;
        var hit = false;
        // imageIds[] — admin-side schema, primary match
        if (Array.isArray(p.imageIds) && p.imageIds.indexOf(imageId) !== -1) hit = true;
        // images[] of URLs (legacy / public mirror)
        if (!hit && url && Array.isArray(p.images) && p.images.indexOf(url) !== -1) hit = true;
        // Single productImageUrl (legacy)
        if (!hit && url && p.productImageUrl === url) hit = true;
        // images[] of objects with .url
        if (!hit && url && Array.isArray(p.images)) {
          for (var ii = 0; ii < p.images.length; ii++) {
            var imEntry = p.images[ii];
            if (imEntry && typeof imEntry === 'object' && imEntry.url === url) { hit = true; break; }
          }
        }
        // primary imageUrl field
        if (!hit && url && p.imageUrl === url) hit = true;
        if (hit) {
          result.products.push({ id: pid, name: p.name || p.title || '(unnamed)' });
          if (pid) seenProductIds[pid] = true;
        }
      });
    } catch (_e) {}
    // Blog
    try {
      var blog = (await MastDB.list('blog/posts')) || {};
      Object.keys(blog).forEach(function(k) {
        var post = blog[k];
        if (!post) return;
        if (url && (post.featuredImage === url || post.ogImage === url || post.coverImage === url)) {
          result.blogPosts.push({ id: post.id || k, title: post.title || '(untitled)' });
        }
      });
    } catch (_e) {}
    // Social
    try {
      var market = (await MastDB.list('market/posts')) || {};
      Object.keys(market).forEach(function(uid) {
        var posts = market[uid] || {};
        Object.keys(posts).forEach(function(pid) {
          var sp = posts[pid];
          if (sp && url && (sp.image === url || sp.mediaUrl === url || (Array.isArray(sp.images) && sp.images.indexOf(url) !== -1))) {
            result.socialPosts.push({ id: pid, caption: (sp.caption || '').slice(0, 40) });
          }
        });
      });
    } catch (_e) {}
    // Stories
    try {
      var stories = (await MastDB.list('public/stories')) || {};
      Object.keys(stories).forEach(function(k) {
        var st = stories[k];
        if (st && url && (st.image === url || st.imageUrl === url || (Array.isArray(st.images) && st.images.indexOf(url) !== -1))) {
          result.stories.push({ id: st.id || k, title: st.title || '(untitled)' });
        }
      });
    } catch (_e) {}
    // Homepage sections
    try {
      var sections = (await MastDB.list('public/homepage/sections')) || {};
      Object.keys(sections).forEach(function(k) {
        var s = sections[k];
        if (!s) return;
        var raw = JSON.stringify(s);
        if (url && raw.indexOf(url) !== -1) result.homepageSections++;
      });
    } catch (_e) {}
  } catch (_e) { /* silent */ }
  imageBackrefsCache[imageId] = result;
  el.innerHTML = _formatBackrefList(result);
}

function _formatBackrefList(r) {
  var pieces = [];
  if (r.products.length) {
    pieces.push('<div><strong>' + MastFormat.countNoun(r.products.length, 'product') + ':</strong> ' +
      r.products.slice(0, 8).map(function(p) { return '<a href="#products?pid=' + esc(p.id) + '" onclick="closeModal()">' + esc(p.name) + '</a>'; }).join(', ') +
      (r.products.length > 8 ? ' …' : '') + '</div>');
  }
  if (r.blogPosts.length) {
    pieces.push('<div><strong>' + MastFormat.countNoun(r.blogPosts.length, 'blog post') + ':</strong> ' +
      r.blogPosts.map(function(p) { return '<a href="#blog?postId=' + esc(p.id) + '" onclick="closeModal()">' + esc(p.title) + '</a>'; }).join(', ') + '</div>');
  }
  if (r.socialPosts.length) {
    pieces.push('<div><strong>' + MastFormat.countNoun(r.socialPosts.length, 'social post') + '</strong></div>');
  }
  if (r.stories.length) {
    pieces.push('<div><strong>' + r.stories.length + ' stor' + (r.stories.length !== 1 ? 'ies' : 'y') + ':</strong> ' +
      r.stories.map(function(s) { return esc(s.title); }).join(', ') + '</div>');
  }
  if (r.homepageSections) {
    pieces.push('<div><strong>' + MastFormat.countNoun(r.homepageSections, 'homepage section') + '</strong></div>');
  }
  if (!pieces.length) return '<span style="color:var(--warm-gray);">Not used anywhere yet.</span>';
  return pieces.join('');
}

  // --- Eager-shim impls (called by eager shell code / static onclick filters) ---
  window.renderImageLibraryImpl = renderImageLibrary;
  window.renderImagesTagChipStripImpl = renderImagesTagChipStrip;
  window.setImagesSubTabImpl = setImagesSubTab;

  // --- onclick targets in this module's own generated markup + shell callers ---
  window.renderImageLibrary = renderImageLibrary;
  window.renderImagesTagChipStrip = renderImagesTagChipStrip;
  window.setImagesSubTab = setImagesSubTab;
  window.viewLibraryImage = viewLibraryImage;
  window.moveImageToLocal = moveImageToLocal;
  window.setImageTagFilter = setImageTagFilter;
  window.saveImageTags = saveImageTags;
  window.loadAndRenderImageCollections = loadAndRenderImageCollections;
  window.openCollectionEditor = openCollectionEditor;
  window.saveImageCollection = saveImageCollection;
  window.deleteImageCollection = deleteImageCollection;
  window.openAddImageToCollectionPicker = openAddImageToCollectionPicker;
  window.toggleImageInCollection = toggleImageInCollection;
  window.renderImageDetailCollections = renderImageDetailCollections;
  window.renderImageDetailBackrefs = renderImageDetailBackrefs;
  // Cluster-internal helpers (referenced cross-function within this module).
  window.computeImageUsage = computeImageUsage;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('imageLibrary', {});
  }
})();
