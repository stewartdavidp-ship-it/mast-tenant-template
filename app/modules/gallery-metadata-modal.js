/**
 * Gallery metadata dialog — the homepage/section image "Add to <section>" modal
 * (alt text, caption, category, video URL/playback/trim, shop product fields)
 * plus its Save handler and the category-select "Manage Categories…" handler.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager openGalleryMetadataModal shim in
 * index.html. The modal is opened cross-module from homepage.js (hpAddImage and
 * the V2 image slide-out addFromLibrary) as a global, and its own onclick
 * handlers (saveGalleryFromLibrary, handleGalCategoryChange) fire after the
 * module is loaded.
 *
 * Reads eager shell globals: SECTIONS, SHOP_SECTION_IDS, CATEGORIES, esc,
 * openModal, closeModal, showToast, getNextOrder, notifyGalleryChanged,
 * writeAudit, MastDB, and the lazy openManageCategoriesDialog (guarded /
 * website-module loaded on demand). All defined before the gallery surface can
 * open. Logic moved VERBATIM (behavior-preserving).
 */
(function () {
  'use strict';

function openGalleryMetadataModal(sectionId, imageUrl, libraryImageId, libImg) {
  libImg = libImg || {};
  var sec = SECTIONS.find(function(s) { return s.id === sectionId; }) || { label: sectionId };
  var isShopSection = SHOP_SECTION_IDS.indexOf(sectionId) !== -1;
  var showCategory = (sectionId === 'gallery' || sectionId === 'shop');
  var showVideoUrl = (sectionId === 'hero');
  var isVideo = libImg.type === 'video' || (libImg.contentType && libImg.contentType.indexOf('video') === 0) || /\.(mp4|mov|webm)/i.test(imageUrl);

  var categoryOptions = CATEGORIES.map(function(cat) {
    return '<option value="' + cat + '">' + cat.charAt(0).toUpperCase() + cat.slice(1) + '</option>';
  }).join('') + '<option value="__manage__" style="color:var(--teal,#2a7c6f);border-top:1px solid var(--charcoal-light,#333);">&#9881; Manage Categories…</option>';

  // Preview: use <video> for videos, <img> for images
  var previewHtml;
  if (isVideo) {
    previewHtml = '<video src="' + esc(imageUrl) + '" style="max-width:100%;max-height:150px;border-radius:8px;" controls muted></video>';
  } else {
    previewHtml = '<img src="' + esc(imageUrl) + '" style="max-width:100%;max-height:150px;border-radius:8px;">';
  }

  // Auto-populate video URL for hero section when library item is a video
  var videoUrlDefault = (showVideoUrl && isVideo) ? imageUrl : '';

  var html =
    '<div class="modal-header">' +
      '<h3>Add to ' + esc(sec.label) + '</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div style="text-align:center;margin-bottom:12px;">' +
        previewHtml +
      '</div>' +
      (!(isVideo && sectionId === 'hero') ? '<div class="form-group">' +
        '<label for="galAlt">Alt Text *</label>' +
        '<input type="text" id="galAlt" placeholder="Describe the image" value="' + esc(libImg.description || '') + '">' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="galCaption">Caption</label>' +
        '<input type="text" id="galCaption">' +
      '</div>' : '') +
      (showVideoUrl ? '<div class="form-group"><label for="galVideoUrl">Video URL' + (isVideo ? ' (auto-filled from library)' : '') + '</label><input type="text" id="galVideoUrl" value="' + esc(videoUrlDefault) + '" placeholder="https://...video.mp4"></div>' +
        '<div class="form-group"><label for="galPlaybackSpeed">Playback Speed</label><select id="galPlaybackSpeed"><option value="0.25">0.25x (very slow)</option><option value="0.5">0.5x (slow)</option><option value="0.75">0.75x</option><option value="1" selected>1x (normal)</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x (fast)</option></select></div>' +
        (isVideo && libImg.duration ? '<div style="background:var(--charcoal);border-radius:6px;padding:8px 12px;margin-bottom:12px;display:flex;align-items:center;gap:8px;"><span style="font-size:1.15rem;">&#9202;</span><span style="color:var(--warm-gray-light);font-size:0.85rem;">Video duration: <strong style="color:var(--amber-light);">' + libImg.duration.toFixed(1) + 's</strong></span></div>' : '') +
        '<div style="display:flex;gap:12px;"><div class="form-group" style="flex:1;"><label for="galVideoStart">Start Time (sec)</label><input type="number" id="galVideoStart" value="0" min="0" step="0.5" placeholder="0"' + (libImg.duration ? ' max="' + libImg.duration + '"' : '') + '></div><div class="form-group" style="flex:1;"><label for="galVideoEnd">End Time (sec)</label><input type="number" id="galVideoEnd" min="0" step="0.5" placeholder="End of video"' + (libImg.duration ? ' max="' + libImg.duration + '"' : '') + '></div></div>' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:-8px;margin-bottom:12px;">Leave end time empty to play to end of video</p>' : '') +
      (showCategory ? '<div class="form-group"><label for="galCategory">Category</label><select id="galCategory" onchange="handleGalCategoryChange(this)">' + categoryOptions + '</select></div>' : '') +
      (isShopSection ? '<div class="form-group"><label for="galProductName">Product Name</label><input type="text" id="galProductName"></div>' +
        '<div class="form-group"><label for="galProductLink">Product Link</label><input type="text" id="galProductLink"></div>' +
        '<div class="form-group"><label for="galPrice">Price</label><input type="text" id="galPrice"></div>' : '') +
      '<div class="form-group"><div class="form-check"><input type="checkbox" id="galVisible" checked><label for="galVisible">Visible on public site</label></div></div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveGalleryFromLibrary(\'' + esc(sectionId) + '\', \'' + esc(imageUrl) + '\', \'' + esc(libraryImageId) + '\')">Save</button>' +
    '</div>';

  openModal(html);
  setTimeout(function() { var el = document.getElementById('galAlt'); if (el) el.focus(); }, 100);
}

async function saveGalleryFromLibrary(sectionId, imageUrl, libraryImageId) {
  var alt = (document.getElementById('galAlt') || {}).value || '';
  if (!alt.trim() && sectionId !== 'hero') { showToast('Please fill in the alt text.', true); return; }

  var data = {
    url: imageUrl,
    alt: alt.trim(),
    caption: ((document.getElementById('galCaption') || {}).value || '').trim(),
    section: sectionId,
    visible: document.getElementById('galVisible') ? document.getElementById('galVisible').checked : true,
    order: getNextOrder(sectionId),
    libraryImageId: libraryImageId,
    createdAt: MastDB.serverTimestamp(),
    updatedAt: MastDB.serverTimestamp()
  };

  if (sectionId === 'gallery' || sectionId === 'shop') {
    data.category = (document.getElementById('galCategory') || {}).value || '';
  }
  if (sectionId === 'hero') {
    var videoUrl = ((document.getElementById('galVideoUrl') || {}).value || '').trim();
    if (videoUrl) data.videoUrl = videoUrl;
    var speed = parseFloat(((document.getElementById('galPlaybackSpeed') || {}).value || '1'));
    if (speed && speed !== 1) data.playbackSpeed = speed;
    var videoStart = parseFloat(((document.getElementById('galVideoStart') || {}).value || '0'));
    var videoEnd = parseFloat(((document.getElementById('galVideoEnd') || {}).value || ''));
    if (videoStart > 0) data.videoStart = videoStart;
    if (videoEnd > 0) data.videoEnd = videoEnd;
  }
  if (SHOP_SECTION_IDS.indexOf(sectionId) !== -1) {
    var pn = ((document.getElementById('galProductName') || {}).value || '').trim();
    var pl = ((document.getElementById('galProductLink') || {}).value || '').trim();
    var pp = ((document.getElementById('galPrice') || {}).value || '').trim();
    if (pn) data.productName = pn;
    if (pl) data.productLink = pl;
    if (pp) data.price = pp;
  }

  try {
    var galKey = MastDB.gallery.newKey();
    await MastDB.gallery.set(galKey, data);
    await writeAudit('create', 'gallery', galKey);
    showToast('Image added to ' + sectionId + '.');
    closeModal();
    // Re-render the page builder + refresh any open V2 image slide-out.
    notifyGalleryChanged();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

function handleGalCategoryChange(sel) {
  if (!sel) return;
  if (sel.value !== '__manage__') { sel.dataset.lastValue = sel.value; return; }
  var prev = sel.dataset.lastValue || '';
  sel.value = prev;
  var rebuildGalSelect = function() {
    if (typeof openManageCategoriesDialog === 'function') {
      openManageCategoriesDialog(function() {
        var s = document.getElementById('galCategory');
        if (!s) return;
        var prevVal = s.dataset.lastValue || '';
        var newOpts = CATEGORIES.map(function(cat) {
          return '<option value="' + cat + '">' + cat.charAt(0).toUpperCase() + cat.slice(1) + '</option>';
        }).join('') + '<option value="__manage__" style="color:var(--teal,#2a7c6f);border-top:1px solid var(--charcoal-light,#333);">&#9881; Manage Categories…</option>';
        s.innerHTML = newOpts;
        s.value = (prevVal && CATEGORIES.indexOf(prevVal) !== -1) ? prevVal : (CATEGORIES[0] || '');
        s.dataset.lastValue = s.value;
      });
    }
  };
  if (typeof openManageCategoriesDialog === 'function') {
    rebuildGalSelect();
  } else if (typeof MastAdmin !== 'undefined' && typeof MastAdmin.loadModule === 'function') {
    MastAdmin.loadModule('website-core').then(rebuildGalSelect);
  }
}

  // Impl for the eager shim (openGalleryMetadataModal is called cross-module
  // from homepage.js) + the modal's own onclick targets.
  window.openGalleryMetadataModalImpl = openGalleryMetadataModal;
  window.saveGalleryFromLibrary = saveGalleryFromLibrary;
  window.handleGalCategoryChange = handleGalCategoryChange;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('galleryMetadataModal', {});
  }
})();
