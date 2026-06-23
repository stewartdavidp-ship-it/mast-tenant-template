// app/modules/website-media.js  (T1 extraction)
//
// Website CMS media surfaces: Event Add/Edit modal, the Image/Gallery modal and
// gallery reindex/move/delete, the Image Library tab, the reusable Image Picker,
// hero-rotation speed, and the add-from-library / gallery-metadata shims.
// Extracted byte-identical from the inline block in index.html. Top-level
// functions and vars stay window globals (the inline block is not an IIFE), so
// the markup onclick/oninput/onchange handlers and the callers that invoke
// openImagePicker / openEventModal et al. still resolve them post-load.

// ============================================================
// Event Modal (Add / Edit)
// ============================================================
function openEventModal(eventId) {
  var isEdit = !!eventId;
  var ev = isEdit ? events[eventId] : {};
  var title = isEdit ? 'Edit Event' : 'Add Event';

  var html = '' +
    '<div class="modal-header">' +
      '<h3>' + title + '</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div class="form-group">' +
        '<label for="evDate" class="field-required">Date</label>' +
        '<input type="date" id="evDate" value="' + (ev.date || '') + '" required>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="evDateEnd">End Date <span style="color:var(--warm-gray-light);font-weight:300;">(optional, for multi-day events)</span></label>' +
        '<input type="date" id="evDateEnd" value="' + (ev.dateEnd || '') + '">' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="evName" class="field-required">Event Name</label>' +
        '<input type="text" id="evName" value="' + esc(ev.name || '') + '" required>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="evDesc">Description</label>' +
        '<textarea id="evDesc">' + esc(ev.description || '') + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="evLocation" class="field-required">Location</label>' +
        '<input type="text" id="evLocation" value="' + esc(ev.location || '') + '" required>' +
      '</div>' +
      '<div class="form-group">' +
        '<div class="form-check">' +
          '<input type="checkbox" id="evVisible"' + (ev.visible !== false ? ' checked' : '') + '>' +
          '<label for="evVisible">Visible on public site</label>' +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<div class="form-check">' +
          '<input type="checkbox" id="evMembersOnly"' + (ev.membersOnly ? ' checked' : '') + '>' +
          '<label for="evMembersOnly">Members only <span style="color:var(--warm-gray-light);font-weight:300;">(hide from non-members)</span></label>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveEvent(\'' + (eventId || '') + '\')">' + (isEdit ? 'Update' : 'Save') + '</button>' +
    '</div>';

  openModal(html);
  // Focus first field
  setTimeout(function() {
    var el = document.getElementById('evDate');
    if (el) el.focus();
  }, 100);
}

async function saveEvent(eventId) {
  var date = document.getElementById('evDate').value.trim();
  var dateEnd = document.getElementById('evDateEnd').value.trim() || null;
  var name = document.getElementById('evName').value.trim();
  var description = document.getElementById('evDesc').value.trim();
  var location = document.getElementById('evLocation').value.trim();
  var visible = document.getElementById('evVisible').checked;
  var membersOnly = !!(document.getElementById('evMembersOnly') && document.getElementById('evMembersOnly').checked);

  if (!validateRequired([
    { el: 'evName', msg: 'Event name is required' },
    { el: 'evDate', msg: 'Date is required' },
    { el: 'evLocation', msg: 'Location is required' }
  ])) {
    showToast('Please fill in all required fields.', true);
    return;
  }

  var data = {
    date: date,
    dateEnd: dateEnd,
    name: name,
    description: description,
    location: location,
    visible: visible,
    membersOnly: membersOnly,
    updatedAt: MastDB.serverTimestamp()
  };

  try {
    if (eventId) {
      await MastDB.events.update(eventId, data);
      await writeAudit('update', 'schedule', eventId);
      showToast('Event updated.');
    } else {
      data.createdAt = MastDB.serverTimestamp();
      var newEvKey = MastDB.events.newKey();
      await MastDB.events.set(newEvKey, data);
      await writeAudit('create', 'schedule', newEvKey);
      showToast('Event created.');
    }
    closeModal();
  } catch (err) {
    showToast('Error saving event: ' + err.message, true);
  }
}

async function toggleEventVisibility(eventId) {
  var ev = events[eventId];
  if (!ev) return;
  try {
    await MastDB.events.update(eventId, {
      visible: ev.visible === false ? true : false,
      updatedAt: MastDB.serverTimestamp()
    });
    await writeAudit('update', 'schedule', eventId);
  } catch (err) {
    showToast('Error toggling visibility: ' + err.message, true);
  }
}

function confirmDeleteEvent(eventId) {
  var ev = events[eventId];
  if (!ev) return;
  var html = '' +
    '<div class="confirm-body">' +
      '<h3>Delete Event</h3>' +
      '<p>Delete "' + esc(ev.name) + '"? This cannot be undone.</p>' +
      '<div class="confirm-actions">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-danger" onclick="deleteEvent(\'' + eventId + '\')">Delete</button>' +
      '</div>' +
    '</div>';
  openModal(html);
}

async function deleteEvent(eventId) {
  try {
    await writeAudit('delete', 'schedule', eventId);
    await MastDB.events.remove(eventId);
    showToast('Event deleted.');
    closeModal();
  } catch (err) {
    showToast('Error deleting event: ' + err.message, true);
  }
}

// ============================================================
// Image Modal (Add / Edit)
// ============================================================
// Image modal (openImageModal + onSectionChange / setImageMode / handleFileSelect /
// previewImageUrl / saveImage) extracted to app/modules/image-modal.js — lazy-loaded
// via this eager shim. openImageModal has cross-module callers (homepage.js) and a
// generated gallery-tile Edit onclick; the rest are modal-internal (set as window.*
// by the module). The list actions + shared getNextOrder / notifyGalleryChanged /
// uploadImageToStorage stay eager in the shell. (Track 1.)
function openImageModal(imageId, defaultSection) {
  MastAdmin.loadModule('imageModal').then(function() {
    if (typeof window.openImageModalImpl === 'function') window.openImageModalImpl(imageId, defaultSection);
  }).catch(function() {});
}
window.openImageModal = openImageModal;

function getNextOrder(section) {
  var maxOrder = 0;
  Object.values(gallery).forEach(function(img) {
    if ((img.section || 'gallery') === section && (img.order || 0) > maxOrder) maxOrder = img.order;
  });
  return maxOrder + 1;
}

// After any gallery-image write, refresh whatever surface is showing images:
// the legacy page builder (when on its route) AND any registered listener
// (the website-v2 Card 2 image slide-out registers window.onGalleryMutated
// while open). Single-sources the post-write refresh so V1 + V2 stay in sync.
window.notifyGalleryChanged = function notifyGalleryChanged() {
  if (window.currentRoute === 'homepage' && typeof window.renderHomepage === 'function') {
    setTimeout(function() { window.renderHomepage(); }, 100);
  }
  if (typeof window.onGalleryMutated === 'function') {
    try { window.onGalleryMutated(); } catch (e) { console.error('onGalleryMutated', e); }
  }
};

async function toggleImageVisibility(imageId) {
  var img = gallery[imageId];
  if (!img) return;
  try {
    await MastDB.gallery.update(imageId, {
      visible: img.visible === false ? true : false,
      updatedAt: MastDB.serverTimestamp()
    });
    await writeAudit('update', 'gallery', imageId);
    notifyGalleryChanged();
  } catch (err) {
    showToast('Error toggling visibility: ' + err.message, true);
  }
}

var reindexDone = false;
function autoReindexIfNeeded() {
  if (reindexDone) return;
  reindexDone = true;
  // Check each section for duplicate orders and fix them
  SECTIONS.forEach(function(sec) {
    var entries = Object.entries(gallery).filter(function(e) {
      return (e[1].section || 'gallery') === sec.id;
    });
    entries.sort(function(a, b) { return (a[1].order || 0) - (b[1].order || 0); });
    var hasDups = false;
    for (var i = 1; i < entries.length; i++) {
      if ((entries[i][1].order || 0) === (entries[i - 1][1].order || 0)) {
        hasDups = true;
        break;
      }
    }
    if (hasDups) {
      reindexSection(sec.id).catch(function(err) {
        console.error('Reindex error for ' + sec.id + ':', err);
      });
    }
  });
}

async function reindexSection(section) {
  // Assign clean sequential order values (0, 1, 2, ...) to all items in a section
  var entries = Object.entries(gallery).filter(function(e) {
    return (e[1].section || 'gallery') === section;
  });
  entries.sort(function(a, b) {
    return (a[1].order || 0) - (b[1].order || 0);
  });

  var updates = {};
  var needsUpdate = false;
  entries.forEach(function(entry, i) {
    if ((entry[1].order || 0) !== i) {
      updates['public/gallery/' + entry[0] + '/order'] = i;
      needsUpdate = true;
    }
  });

  if (needsUpdate) {
    await MastDB.multiUpdate(updates);
  }
}

async function moveImage(imageId, direction) {
  var img = gallery[imageId];
  if (!img) return;
  var section = img.section || 'gallery';

  // Filter to same section, then sort by order
  var entries = Object.entries(gallery).filter(function(e) {
    return (e[1].section || 'gallery') === section;
  });
  entries.sort(function(a, b) {
    return (a[1].order || 0) - (b[1].order || 0);
  });

  // Check for duplicate orders — reindex first if needed
  var hasDuplicates = false;
  for (var i = 1; i < entries.length; i++) {
    if ((entries[i][1].order || 0) === (entries[i - 1][1].order || 0)) {
      hasDuplicates = true;
      break;
    }
  }
  if (hasDuplicates) {
    await reindexSection(section);
    // Re-fetch after reindex
    entries = Object.entries(gallery).filter(function(e) {
      return (e[1].section || 'gallery') === section;
    });
    entries.sort(function(a, b) {
      return (a[1].order || 0) - (b[1].order || 0);
    });
  }

  var idx = entries.findIndex(function(e) { return e[0] === imageId; });
  if (idx === -1) return;

  var swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= entries.length) return;

  var currentId = entries[idx][0];
  var swapId = entries[swapIdx][0];
  var currentOrder = entries[idx][1].order;
  var swapOrder = entries[swapIdx][1].order;

  // Swap order values
  var updates = {};
  updates['public/gallery/' + currentId + '/order'] = swapOrder;
  updates['public/gallery/' + currentId + '/updatedAt'] = MastDB.serverTimestamp();
  updates['public/gallery/' + swapId + '/order'] = currentOrder;
  updates['public/gallery/' + swapId + '/updatedAt'] = MastDB.serverTimestamp();

  try {
    await MastDB.multiUpdate(updates);
    notifyGalleryChanged();
  } catch (err) {
    showToast('Error reordering: ' + err.message, true);
  }
}

function confirmDeleteImage(imageId) {
  var img = gallery[imageId];
  if (!img) return;
  var label = img.caption || img.alt || 'this image';
  var html = '' +
    '<div class="confirm-body">' +
      '<h3>Delete Image</h3>' +
      '<p>Delete "' + esc(label) + '"? This cannot be undone.</p>' +
      '<div class="confirm-actions">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-danger" onclick="deleteImage(\'' + imageId + '\')">Delete</button>' +
      '</div>' +
    '</div>';
  openModal(html);
}

async function deleteImage(imageId) {
  try {
    await writeAudit('delete', 'gallery', imageId);
    await MastDB.gallery.remove(imageId);
    showToast('Image deleted.');
    closeModal();
    notifyGalleryChanged();
  } catch (err) {
    showToast('Error deleting image: ' + err.message, true);
  }
}

// ============================================================
// Image Library
// ============================================================
// Image Library route view (grid + filters, detail modal, sub-tabs, tag chip
// strip, Collections CRUD, backref scanner, computeImageUsage / locality
// helpers) extracted to app/modules/image-library.js — lazy-loaded on #images
// route entry + via these eager shims. The detail-modal / collection-editor
// onclick targets are window-exported by the module itself (its generated
// markup calls them after it has loaded). (Track 1, §14.)
// NOTE: the lightbox image-modal.js is a DIFFERENT cluster — untouched.
function renderImageLibrary() {
  MastAdmin.loadModule('imageLibrary').then(function () {
    if (typeof window.renderImageLibraryImpl === 'function') window.renderImageLibraryImpl();
  }).catch(function () {});
}
function renderImagesTagChipStrip() {
  MastAdmin.loadModule('imageLibrary').then(function () {
    if (typeof window.renderImagesTagChipStripImpl === 'function') window.renderImagesTagChipStripImpl();
  }).catch(function () {});
}
function setImagesSubTab(tab) {
  MastAdmin.loadModule('imageLibrary').then(function () {
    if (typeof window.setImagesSubTabImpl === 'function') window.setImagesSubTabImpl(tab);
  }).catch(function () {});
}
window.renderImageLibrary = renderImageLibrary;
window.renderImagesTagChipStrip = renderImagesTagChipStrip;
window.setImagesSubTab = setImagesSubTab;

// Image Library upload dialog (openLibraryUploadModal / handleLibUploadFile /
// uploadToLibrary) extracted to app/modules/library-upload-modal.js — lazy-loaded
// via this eager shim. The only external opener is the static "Upload Image"
// button (onclick="openLibraryUploadModal()"); the file-input onchange and the
// Upload button are in the modal's own generated markup and call the module's
// window.handleLibUploadFile / window.uploadToLibrary directly. (Track 1, §14.)
function openLibraryUploadModal() {
  MastAdmin.loadModule('libraryUploadModal').then(function() {
    if (typeof window.openLibraryUploadModalImpl === 'function') window.openLibraryUploadModalImpl();
  }).catch(function() {});
}

// ============================================================
// Image Picker (shared component for Gallery + Products)
// ============================================================
var imagePickerCallback = null;

function openImagePicker(callback, options) {
  imagePickerCallback = callback;
  options = options || {};
  var multi = options.multi || false;

  var entries = Object.entries(imageLibrary);
  entries.sort(function(a, b) {
    return (b[1].uploadedAt || '').localeCompare(a[1].uploadedAt || '');
  });

  var html =
    '<div class="modal-header">' +
      '<h3>Select from Image Library</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<input type="text" id="pickerSearch" placeholder="Search tags..." oninput="filterImagePicker()" style="width:100%;padding:8px 10px;border-radius:4px;border:1px solid var(--cream-dark);font-size:0.85rem;margin-bottom:10px;">';

  if (entries.length === 0) {
    html += '<div style="text-align:center;padding:30px;color:var(--warm-gray);">No images in library. Upload images first from the Images page.</div>';
  } else {
    html += '<div class="img-picker-grid" id="pickerGrid">';
    entries.forEach(function(entry) {
      var id = entry[0];
      var img = entry[1];
      var isVid = img.type === 'video' || (img.contentType && img.contentType.indexOf('video') === 0);
      var thumb = img.thumbnailUrl || (isVid ? '' : img.url) || '';
      var tagStr = (img.tags || []).join(',') || (img.description || '');
      html += '<div class="img-picker-item" data-imgid="' + esc(id) + '" data-tags="' + esc(tagStr) + '" onclick="togglePickerItem(this)">' +
        (thumb
          ? '<img src="' + esc(thumb) + '" alt="" loading="lazy">'
          : '<div style="height:100%;display:flex;align-items:center;justify-content:center;background:var(--charcoal);color:var(--warm-gray-light);font-size:1.6rem;min-height:80px;">' +
            (isVid ? '\u25B6' : '\u{1F5BC}') + '</div>') +
        '<div class="picker-check">&#10003;</div>' +
      '</div>';
    });
    html += '</div>';
  }

  html += '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="confirmPickerSelection()">Select</button>' +
    '</div>';

  openModal(html);
}

function filterImagePicker() {
  var search = (document.getElementById('pickerSearch') || {}).value.toLowerCase().trim();
  var items = document.querySelectorAll('.img-picker-item');
  items.forEach(function(item) {
    var tags = (item.getAttribute('data-tags') || '').toLowerCase();
    item.style.display = (!search || tags.indexOf(search) !== -1) ? '' : 'none';
  });
}

function togglePickerItem(el) {
  // Single select: clear others first
  document.querySelectorAll('.img-picker-item.selected').forEach(function(item) {
    if (item !== el) item.classList.remove('selected');
  });
  el.classList.toggle('selected');
}

function confirmPickerSelection() {
  var selected = document.querySelector('.img-picker-item.selected');
  if (!selected) {
    showToast('Please select an image.', true);
    return;
  }
  var imgId = selected.getAttribute('data-imgid');
  var img = imageLibrary[imgId];
  if (img && imagePickerCallback) {
    imagePickerCallback(imgId, img.url, img.thumbnailUrl);
  }
  imagePickerCallback = null;
  closeModal();
}

// ---- Hero rotation speed ----
async function saveHeroRotationSpeed(seconds) {
  try {
    await MastDB.set('public/config/hero/rotationSeconds', parseInt(seconds, 10));
    showToast('Hero rotation set to ' + seconds + 's');
  } catch (err) {
    showToast('Error saving: ' + err.message, true);
  }
}

function loadHeroRotationSpeed() {
  MastDB.get('public/config/hero/rotationSeconds').then(function(val) {
    var sel = document.getElementById('heroRotationSpeed');
    if (sel && val) sel.value = String(val);
  });
}

// ---- Gallery: Add from Library flow ----
function addGalleryImageFromLibrary(sectionId) {
  openImagePicker(function(imgId, url, thumbUrl) {
    // After picking, open metadata modal for gallery entry
    var libImg = imageLibrary[imgId] || {};
    setTimeout(function() { openGalleryMetadataModal(sectionId, url, imgId, libImg); }, 200);
  });
}

// Gallery metadata dialog (openGalleryMetadataModal / saveGalleryFromLibrary /
// handleGalCategoryChange) extracted to app/modules/gallery-metadata-modal.js
// — lazy-loaded via this eager shim. The "Add to <section>" modal is opened
// cross-module from homepage.js (hpAddImage + the V2 image slide-out) as a
// global; its Save/category-select onclick handlers run after the module loads.
// (Track 1.)
function openGalleryMetadataModal(sectionId, imageUrl, libraryImageId, libImg) {
  MastAdmin.loadModule('galleryMetadataModal').then(function() {
    if (typeof window.openGalleryMetadataModalImpl === 'function') window.openGalleryMetadataModalImpl(sectionId, imageUrl, libraryImageId, libImg);
  }).catch(function() {});
}
