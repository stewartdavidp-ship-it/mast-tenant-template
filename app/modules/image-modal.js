/**
 * Image modal (Add / Edit) — the gallery image editor dialog: section/category
 * selectors, Upload-file vs Paste-URL mode toggle, drag-and-drop file select,
 * URL preview, and the save handler (uploads via the shared uploadImageToStorage,
 * writes admin/gallery, then notifyGalleryChanged).
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager openImageModal shim in
 * index.html. openImageModal has two cross-module callers (homepage.js calls
 * window.openImageModal; its generated gallery-tile "Edit" onclick also resolves
 * to the global), so it uses recipe B (eager shim → openImageModalImpl).
 *
 * Reads eager shell globals (all defined before the gallery surface can render):
 * gallery, GALLERY_SECTIONS / section helpers, esc, openModal, closeModal,
 * showToast, MastDB, writeAudit, getNextOrder, notifyGalleryChanged,
 * uploadImageToStorage. The list actions (toggleImageVisibility / moveImage /
 * confirmDeleteImage / deleteImage) and shared helpers (getNextOrder /
 * notifyGalleryChanged) stay EAGER in the shell. Logic moved VERBATIM.
 */
(function () {
  'use strict';

function openImageModal(imageId, defaultSection) {
  var isEdit = !!imageId;
  var img = isEdit ? gallery[imageId] : {};
  var title = isEdit ? 'Edit Image' : 'Add Image';
  var section = isEdit ? (img.section || 'gallery') : (defaultSection || 'gallery');
  // Default: upload mode for new, URL mode for edit
  var defaultUpload = !isEdit;

  // Reset pending state
  pendingFile = null;
  pendingBase64 = null;
  pendingFilename = null;

  var sectionOptions = SECTIONS.map(function(s) {
    var selected = (s.id === section) ? ' selected' : '';
    return '<option value="' + s.id + '"' + selected + '>' + s.label + ' \u2014 ' + s.description + '</option>';
  }).join('');

  var categoryOptions = CATEGORIES.map(function(cat) {
    var selected = (img.category === cat) ? ' selected' : '';
    return '<option value="' + cat + '"' + selected + '>' + cat.charAt(0).toUpperCase() + cat.slice(1) + '</option>';
  }).join('') + '<option value="__manage__" style="color:var(--teal,#2a7c6f);border-top:1px solid var(--charcoal-light,#333);">&#9881; Manage Categories…</option>';

  var isShopSection = SHOP_SECTION_IDS.indexOf(section) !== -1;
  var showCategory = (section === 'gallery' || section === 'shop');
  var showVideoUrl = (section === 'hero');
  var showProductFields = isShopSection;
  // Look up video duration from library
  var libItem = (img.libraryImageId && imageLibrary[img.libraryImageId]) ? imageLibrary[img.libraryImageId] : {};
  var videoDuration = libItem.duration || 0;

  var html = '' +
    '<div class="modal-header">' +
      '<h3>' + title + '</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
      // Section selector
      '<div class="form-group">' +
        '<label for="imgSection">Section</label>' +
        '<select id="imgSection" onchange="onSectionChange()">' + sectionOptions + '</select>' +
      '</div>' +
      // Image source toggle
      '<div class="form-group">' +
        '<label>Image Source</label>' +
        '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
          '<button class="btn ' + (defaultUpload ? 'btn-primary' : 'btn-secondary') + '" ' +
            'id="imgModeUpload" onclick="setImageMode(\'upload\')" type="button" style="flex:1;">Upload File</button>' +
          '<button class="btn ' + (!defaultUpload ? 'btn-primary' : 'btn-secondary') + '" ' +
            'id="imgModeUrl" onclick="setImageMode(\'url\')" type="button" style="flex:1;">Paste URL</button>' +
        '</div>' +
        // Upload mode
        '<div id="imgUploadSection"' + (!defaultUpload ? ' style="display:none;"' : '') + '>' +
          '<input type="file" id="imgFileInput" accept="image/*" onchange="handleFileSelect(this)" style="display:none;">' +
          '<div id="imgDropZone" onclick="document.getElementById(\'imgFileInput\').click()" ' +
            'style="border:2px dashed #ccc;border-radius:8px;padding:30px 20px;text-align:center;' +
            'cursor:pointer;background:var(--cream);transition:border-color 0.2s,background 0.2s;">' +
            '<div style="font-size:1.6rem;margin-bottom:8px;">&#128247;</div>' +
            '<div style="color:var(--warm-gray);font-size:0.9rem;">Click to select or drag an image here</div>' +
            '<div id="imgFileName" style="color:var(--amber);font-size:0.85rem;margin-top:8px;display:none;"></div>' +
          '</div>' +
        '</div>' +
        // URL mode
        '<div id="imgUrlSection"' + (defaultUpload ? ' style="display:none;"' : '') + '>' +
          '<input type="text" id="imgUrl" value="' + esc(img.url || '') + '" placeholder="https://..." oninput="previewImageUrl()">' +
        '</div>' +
        // Shared preview (use <video> with preload=metadata for video entries to avoid full download)
        '<div class="img-preview-container" id="imgPreviewContainer">' +
          (img.url
            ? (showVideoUrl && (img.videoUrl || /\.(mp4|mov|webm)/i.test(img.url))
              ? '<video src="' + esc(img.videoUrl || img.url) + '" style="max-width:100%;max-height:200px;" preload="metadata" controls muted></video>'
              : '<img src="' + esc(img.url) + '" onerror="this.parentNode.innerHTML=\'<span class=error-msg>Invalid image URL</span>\'">')
            : '<span class="placeholder-msg">Select an image or enter a URL to preview</span>') +
        '</div>' +
        // Upload progress (hidden by default)
        '<div id="imgUploadProgress" style="display:none;margin-top:8px;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="flex:1;height:6px;background:#eee;border-radius:3px;overflow:hidden;">' +
              '<div id="imgProgressBar" style="height:100%;background:var(--amber);width:0%;transition:width 0.3s;border-radius:3px;"></div>' +
            '</div>' +
            '<span id="imgProgressText" style="font-size:0.78rem;color:var(--warm-gray);white-space:nowrap;">0%</span>' +
          '</div>' +
          '<div id="imgProgressStatus" style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;"></div>' +
        '</div>' +
      '</div>' +
      // Hero: video URL + playback speed
      '<div class="form-group" id="imgVideoUrlGroup"' + (!showVideoUrl ? ' style="display:none;"' : '') + '>' +
        '<label for="imgVideoUrl">Video URL</label>' +
        '<input type="text" id="imgVideoUrl" value="' + esc(img.videoUrl || '') + '" placeholder="https://...video.mp4">' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Looping background video for the hero section</p>' +
      '</div>' +
      '<div class="form-group" id="imgPlaybackSpeedGroup"' + (!showVideoUrl ? ' style="display:none;"' : '') + '>' +
        '<label for="imgPlaybackSpeed">Playback Speed</label>' +
        '<select id="imgPlaybackSpeed">' +
          '<option value="0.25"' + (img.playbackSpeed == 0.25 ? ' selected' : '') + '>0.25x (very slow)</option>' +
          '<option value="0.5"' + (img.playbackSpeed == 0.5 ? ' selected' : '') + '>0.5x (slow)</option>' +
          '<option value="0.75"' + (img.playbackSpeed == 0.75 ? ' selected' : '') + '>0.75x</option>' +
          '<option value="1"' + (!img.playbackSpeed || img.playbackSpeed == 1 ? ' selected' : '') + '>1x (normal)</option>' +
          '<option value="1.25"' + (img.playbackSpeed == 1.25 ? ' selected' : '') + '>1.25x</option>' +
          '<option value="1.5"' + (img.playbackSpeed == 1.5 ? ' selected' : '') + '>1.5x</option>' +
          '<option value="2"' + (img.playbackSpeed == 2 ? ' selected' : '') + '>2x (fast)</option>' +
        '</select>' +
      '</div>' +
      '<div id="imgVideoTimingGroup"' + (!showVideoUrl ? ' style="display:none;"' : '') + '>' +
        (videoDuration ? '<div style="background:var(--charcoal);border-radius:6px;padding:8px 12px;margin-bottom:12px;display:flex;align-items:center;gap:8px;"><span style="font-size:1.15rem;">&#9202;</span><span style="color:var(--warm-gray-light);font-size:0.85rem;">Video duration: <strong style="color:var(--amber-light);">' + videoDuration.toFixed(1) + 's</strong></span></div>' : '') +
        '<div style="display:flex;gap:12px;">' +
          '<div class="form-group" style="flex:1;">' +
            '<label for="imgVideoStart">Start Time (seconds)</label>' +
            '<input type="number" id="imgVideoStart" value="' + (img.videoStart || 0) + '" min="0" step="0.5" placeholder="0"' + (videoDuration ? ' max="' + videoDuration + '"' : '') + '>' +
          '</div>' +
          '<div class="form-group" style="flex:1;">' +
            '<label for="imgVideoEnd">End Time (seconds)</label>' +
            '<input type="number" id="imgVideoEnd" value="' + (img.videoEnd || '') + '" min="0" step="0.5" placeholder="End of video"' + (videoDuration ? ' max="' + videoDuration + '"' : '') + '>' +
          '</div>' +
        '</div>' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:-8px;margin-bottom:12px;">Leave end time empty to play to end of video</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="imgAlt">Alt Text *</label>' +
        '<input type="text" id="imgAlt" value="' + esc(img.alt || '') + '" placeholder="Describe the image">' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="imgCaption">Caption</label>' +
        '<input type="text" id="imgCaption" value="' + esc(img.caption || '') + '">' +
      '</div>' +
      // Category (gallery + shop)
      '<div class="form-group" id="imgCategoryGroup"' + (!showCategory ? ' style="display:none;"' : '') + '>' +
        '<label for="imgCategory">Category</label>' +
        '<select id="imgCategory" onchange="handleImgCategoryChange(this)">' + categoryOptions + '</select>' +
      '</div>' +
      // Shop: product fields
      '<div id="imgProductFields"' + (!showProductFields ? ' style="display:none;"' : '') + '>' +
        '<div class="form-group">' +
          '<label for="imgProductName">Product Name</label>' +
          '<input type="text" id="imgProductName" value="' + esc(img.productName || '') + '" placeholder="e.g. Octopus Figurine">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="imgProductLink">Product Link</label>' +
          '<input type="text" id="imgProductLink" value="' + esc(img.productLink || '') + '" placeholder="https://www.etsy.com/...">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="imgPrice">Price</label>' +
          '<input type="text" id="imgPrice" value="' + esc(img.price || '') + '" placeholder="e.g. $45">' +
        '</div>' +
      '</div>' +
      // imageFit only affects gallery/shop sections — hero uses background-size:cover always
      (section !== 'hero' ?
      '<div class="form-group">' +
        '<label for="imgFit">Image Display</label>' +
        '<select id="imgFit">' +
          '<option value="contain"' + (img.imageFit !== 'cover' ? ' selected' : '') + '>Fit inside frame (no cropping)</option>' +
          '<option value="cover"' + (img.imageFit === 'cover' ? ' selected' : '') + '>Fill frame (may crop edges)</option>' +
        '</select>' +
      '</div>' : '') +
      '<div class="form-group">' +
        '<div class="form-check">' +
          '<input type="checkbox" id="imgVisible"' + (img.visible !== false ? ' checked' : '') + '>' +
          '<label for="imgVisible">Visible on public site</label>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" id="imgSaveBtn" onclick="saveImage(\'' + (imageId || '') + '\')">' + (isEdit ? 'Update' : 'Save') + '</button>' +
    '</div>';

  openModal(html);

  // Attach drag-and-drop after modal renders
  setTimeout(function() {
    var dropZone = document.getElementById('imgDropZone');
    if (dropZone) {
      dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--amber)';
        dropZone.style.background = 'var(--cream-dark)';
      });
      dropZone.addEventListener('dragleave', function(e) {
        e.preventDefault();
        dropZone.style.borderColor = '#ccc';
        dropZone.style.background = 'var(--cream)';
      });
      dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.style.borderColor = '#ccc';
        dropZone.style.background = 'var(--cream)';
        if (e.dataTransfer.files.length > 0) {
          document.getElementById('imgFileInput').files = e.dataTransfer.files;
          handleFileSelect(document.getElementById('imgFileInput'));
        }
      });
    }
    if (isEdit) {
      var el = document.getElementById('imgAlt');
      if (el) el.focus();
    }
  }, 100);
}

function onSectionChange() {
  var sec = document.getElementById('imgSection').value;
  var videoGroup = document.getElementById('imgVideoUrlGroup');
  var categoryGroup = document.getElementById('imgCategoryGroup');
  var productFields = document.getElementById('imgProductFields');
  var isShopSec = SHOP_SECTION_IDS.indexOf(sec) !== -1;
  var speedGroup = document.getElementById('imgPlaybackSpeedGroup');
  var timingGroup = document.getElementById('imgVideoTimingGroup');
  videoGroup.style.display = sec === 'hero' ? '' : 'none';
  if (speedGroup) speedGroup.style.display = sec === 'hero' ? '' : 'none';
  if (timingGroup) timingGroup.style.display = sec === 'hero' ? '' : 'none';
  categoryGroup.style.display = (sec === 'gallery' || sec === 'shop') ? '' : 'none';
  productFields.style.display = isShopSec ? '' : 'none';
}

function setImageMode(mode) {
  var uploadBtn = document.getElementById('imgModeUpload');
  var urlBtn = document.getElementById('imgModeUrl');
  var uploadSection = document.getElementById('imgUploadSection');
  var urlSection = document.getElementById('imgUrlSection');

  if (mode === 'upload') {
    uploadBtn.className = 'btn btn-primary';
    urlBtn.className = 'btn btn-secondary';
    uploadSection.style.display = '';
    urlSection.style.display = 'none';
  } else {
    uploadBtn.className = 'btn btn-secondary';
    urlBtn.className = 'btn btn-primary';
    uploadSection.style.display = 'none';
    urlSection.style.display = '';
  }
}

async function handleFileSelect(input) {
  var file = input.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file.', true);
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showToast('Image too large. Maximum 10MB.', true);
    return;
  }

  pendingFile = file;
  pendingFilename = sanitizeFilename(file.name);

  var nameEl = document.getElementById('imgFileName');
  nameEl.textContent = file.name + ' (' + formatFileSize(file.size) + ')';
  nameEl.style.display = '';

  try {
    var result = await compressImage(file, 1200, 0.85);
    pendingBase64 = result.base64;

    var container = document.getElementById('imgPreviewContainer');
    container.innerHTML = '<img src="data:' + result.mimeType + ';base64,' + result.base64 + '">';

    if (result.originalWidth > 1200) {
      nameEl.textContent = file.name + ' (' + formatFileSize(file.size) +
        ' \u2192 ~' + formatFileSize(result.sizeEstimate) + ', resized to ' + result.width + 'x' + result.height + ')';
    }
  } catch (err) {
    showToast('Error processing image: ' + err.message, true);
  }
}

function previewImageUrl() {
  var url = document.getElementById('imgUrl').value.trim();
  var container = document.getElementById('imgPreviewContainer');
  if (!url) {
    container.innerHTML = '<span class="placeholder-msg">Enter a URL to preview</span>';
    return;
  }
  container.innerHTML = '<img src="' + esc(url) + '" onerror="this.parentNode.innerHTML=\'<span class=error-msg>Invalid image URL</span>\'">';
}

async function saveImage(imageId) {
  var section = document.getElementById('imgSection').value;
  var alt = document.getElementById('imgAlt').value.trim();
  var caption = document.getElementById('imgCaption').value.trim();
  var category = document.getElementById('imgCategory').value;
  var visible = document.getElementById('imgVisible').checked;

  if (!alt) {
    showToast('Please fill in the alt text.', true);
    return;
  }

  var url;

  // Determine image source mode
  var uploadSectionEl = document.getElementById('imgUploadSection');
  var isUploadMode = uploadSectionEl && uploadSectionEl.style.display !== 'none';

  if (isUploadMode && pendingBase64) {
    // Upload mode — use Firebase Storage or GitHub depending on tenant config
    var imageBackend = getImageStorageBackend();
    if (imageBackend === 'github' && !githubToken) {
      showToast('GitHub token not configured. Go to Settings to add one.', true);
      return;
    }

    var progressEl = document.getElementById('imgUploadProgress');
    var progressBar = document.getElementById('imgProgressBar');
    var progressText = document.getElementById('imgProgressText');
    var progressStatus = document.getElementById('imgProgressStatus');
    var saveBtn = document.getElementById('imgSaveBtn');

    progressEl.style.display = '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Uploading...';
    }

    try {
      progressBar.style.width = '20%';
      progressText.textContent = '20%';

      if (imageBackend === 'github') {
        progressStatus.textContent = 'Uploading to GitHub...';
        await uploadImageToGitHub(
          pendingFilename,
          pendingBase64,
          'Add ' + section + ' image: ' + (caption || alt)
        );
        url = GITHUB_PAGES_BASE + '/' + GITHUB_IMAGES_PATH + '/' + pendingFilename;
      } else {
        progressStatus.textContent = 'Uploading image...';
        url = await uploadImageToStorage(pendingFilename, pendingBase64);
      }

      progressBar.style.width = '80%';
      progressText.textContent = '80%';
      progressStatus.textContent = 'Saving to database...';

    } catch (err) {
      progressEl.style.display = 'none';
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = imageId ? 'Update' : 'Save';
      }
      showToast('Upload failed: ' + err.message, true);
      return;
    }
  } else {
    // URL mode
    var urlInput = document.getElementById('imgUrl');
    url = urlInput ? urlInput.value.trim() : '';
    if (!url && !isUploadMode) {
      showToast('Please provide an image URL.', true);
      return;
    }
    if (!url) {
      showToast('Please select a file to upload or switch to URL mode.', true);
      return;
    }
  }

  var imageFit = (document.getElementById('imgFit') || {}).value || 'contain';

  var data = {
    url: url,
    alt: alt,
    caption: caption,
    section: section,
    category: (section === 'gallery' || section === 'shop') ? category : '',
    visible: visible,
    imageFit: imageFit,
    updatedAt: MastDB.serverTimestamp()
  };

  // Hero: video URL + playback speed + timing
  if (section === 'hero') {
    var videoUrl = document.getElementById('imgVideoUrl').value.trim();
    if (videoUrl) data.videoUrl = videoUrl;
    var speed = parseFloat(((document.getElementById('imgPlaybackSpeed') || {}).value || '1'));
    if (speed && speed !== 1) data.playbackSpeed = speed;
    else data.playbackSpeed = null;
    var videoStart = parseFloat(((document.getElementById('imgVideoStart') || {}).value || '0'));
    var videoEnd = parseFloat(((document.getElementById('imgVideoEnd') || {}).value || ''));
    data.videoStart = videoStart > 0 ? videoStart : null;
    data.videoEnd = videoEnd > 0 ? videoEnd : null;
  }

  // Shop sections: product fields
  if (SHOP_SECTION_IDS.indexOf(section) !== -1) {
    var productName = document.getElementById('imgProductName').value.trim();
    var productLink = document.getElementById('imgProductLink').value.trim();
    var price = document.getElementById('imgPrice').value.trim();
    if (productName) data.productName = productName;
    if (productLink) data.productLink = productLink;
    if (price) data.price = price;
  }

  try {
    if (imageId) {
      await MastDB.gallery.update(imageId, data);
      await writeAudit('update', 'gallery', imageId);
      showToast('Image updated.');
    } else {
      data.order = getNextOrder(section);
      data.createdAt = MastDB.serverTimestamp();
      var newImgKey = MastDB.gallery.newKey();
      await MastDB.gallery.set(newImgKey, data);
      await writeAudit('create', 'gallery', newImgKey);
      showToast('Image added.');
    }

    // Update progress to 100% if upload mode
    var pb = document.getElementById('imgProgressBar');
    var pt = document.getElementById('imgProgressText');
    if (pb) { pb.style.width = '100%'; }
    if (pt) { pt.textContent = '100%'; }

    pendingFile = null;
    pendingBase64 = null;
    pendingFilename = null;

    closeModal();
    // Re-render the page builder + refresh any open V2 image slide-out.
    notifyGalleryChanged();
  } catch (err) {
    showToast('Error saving image: ' + err.message, true);
  }
}

  // Impl for the eager shim (openImageModal has cross-module callers) + the
  // modal's own onclick targets (its HTML references these as globals).
  window.openImageModalImpl = openImageModal;
  window.onSectionChange = onSectionChange;
  window.setImageMode = setImageMode;
  window.handleFileSelect = handleFileSelect;
  window.previewImageUrl = previewImageUrl;
  window.saveImage = saveImage;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('imageModal', {});
  }
})();
