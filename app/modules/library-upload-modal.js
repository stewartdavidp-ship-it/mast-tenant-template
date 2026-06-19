/**
 * Image Library upload dialog — the admin "Upload to Image Library" modal
 * (drag-drop / file-picker → client-side compress → /uploadImage CF).
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager openLibraryUploadModal shim in
 * index.html (the "Upload Image" button on the Images page is static markup).
 * handleLibUploadFile / uploadToLibrary are only invoked from this modal's own
 * generated onclick/onchange markup, so they are plain window.* exports.
 *
 * Reads eager shell globals: pendingFile / pendingBase64 / pendingFilename
 * (top-level lets at index.html ~15696, shared with the other image-upload
 * surface — reset on open here), openModal, closeModal, showToast,
 * compressImage, formatFileSize, auth, callCF. All defined before the Images
 * surface can render. Logic moved VERBATIM (behavior-preserving).
 */
(function () {
  'use strict';

function openLibraryUploadModal() {
  pendingFile = null;
  pendingBase64 = null;
  pendingFilename = null;

  var html =
    '<div class="modal-header">' +
      '<h3>Upload to Image Library</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<input type="file" id="libUploadFileInput" accept="image/*" onchange="handleLibUploadFile(this)" style="display:none;">' +
      '<div id="libDropZone" onclick="document.getElementById(\'libUploadFileInput\').click()" ' +
        'style="border:2px dashed #ccc;border-radius:8px;padding:30px 20px;text-align:center;cursor:pointer;background:var(--cream);transition:border-color 0.2s,background 0.2s;">' +
        '<div style="font-size:1.6rem;margin-bottom:8px;">&#128247;</div>' +
        '<div style="color:var(--warm-gray);font-size:0.9rem;">Click to select or drag an image here</div>' +
        '<div id="libFileName" style="color:var(--amber);font-size:0.85rem;margin-top:8px;display:none;"></div>' +
      '</div>' +
      '<div class="img-preview-container" id="libPreviewContainer">' +
        '<span class="placeholder-msg">Select an image to preview</span>' +
      '</div>' +
      '<div class="form-group" style="margin-top:12px;">' +
        '<label for="libTags">Tags (comma-separated)</label>' +
        '<input type="text" id="libTags" placeholder="e.g. figurine, blue, pendant">' +
      '</div>' +
      '<div id="libUploadProgress" style="display:none;margin-top:8px;">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<div style="flex:1;height:6px;background:#eee;border-radius:3px;overflow:hidden;">' +
            '<div id="libProgressBar" style="height:100%;background:var(--amber);width:0%;transition:width 0.3s;border-radius:3px;"></div>' +
          '</div>' +
          '<span id="libProgressText" style="font-size:0.78rem;color:var(--warm-gray);white-space:nowrap;">0%</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" id="libUploadBtn" onclick="uploadToLibrary()">Upload</button>' +
    '</div>';

  openModal(html);

  setTimeout(function() {
    var dropZone = document.getElementById('libDropZone');
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
          document.getElementById('libUploadFileInput').files = e.dataTransfer.files;
          handleLibUploadFile(document.getElementById('libUploadFileInput'));
        }
      });
    }
  }, 100);
}

async function handleLibUploadFile(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file.', true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('File is too large (max 10MB).', true);
    return;
  }
  try {
    var compressed = await compressImage(file, 1200, 0.85);
    pendingBase64 = compressed.base64;
    var preview = document.getElementById('libPreviewContainer');
    if (preview) preview.innerHTML = '<img src="data:' + compressed.mimeType + ';base64,' + compressed.base64 + '" style="max-width:100%;max-height:200px;border-radius:8px;">';
    var nameEl = document.getElementById('libFileName');
    if (nameEl) { nameEl.textContent = file.name + ' (' + formatFileSize(compressed.sizeEstimate) + ')'; nameEl.style.display = ''; }
  } catch (err) {
    showToast('Error processing image: ' + err.message, true);
  }
}

async function uploadToLibrary() {
  if (!pendingBase64) {
    showToast('Please select an image first.', true);
    return;
  }
  var tagsInput = document.getElementById('libTags');
  var tags = tagsInput ? tagsInput.value.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
  var btn = document.getElementById('libUploadBtn');
  var progress = document.getElementById('libUploadProgress');
  var bar = document.getElementById('libProgressBar');
  var text = document.getElementById('libProgressText');

  if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }
  if (progress) progress.style.display = '';
  if (bar) bar.style.width = '30%';
  if (text) text.textContent = '30%';

  try {
    var token = await auth.currentUser.getIdToken();
    var resp = await callCF('/uploadImage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ image: pendingBase64, tags: tags, source: 'admin-upload' })
    });

    if (bar) bar.style.width = '90%';
    if (text) text.textContent = '90%';

    var result = await resp.json();
    if (!result.success) throw new Error(result.error || 'Upload failed');

    if (bar) bar.style.width = '100%';
    if (text) text.textContent = '100%';

    showToast('Image uploaded to library.');
    pendingBase64 = null;
    closeModal();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Upload'; }
    if (progress) progress.style.display = 'none';
    showToast('Upload failed: ' + err.message, true);
  }
}

  // Impl for the eager shim (the only externally-invoked entry) + the dialog's
  // own onclick/onchange targets.
  window.openLibraryUploadModalImpl = openLibraryUploadModal;
  window.handleLibUploadFile = handleLibUploadFile;
  window.uploadToLibrary = uploadToLibrary;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('libraryUploadModal', {});
  }
})();
