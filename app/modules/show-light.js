/**
 * Show Light Module — Vendor Profile, Image Gallery, Show List, AI Application Builder
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var slLoaded = false;
  var slSubView = 'profile'; // profile | gallery | shows | apply
  var slGalleryFilter = 'all'; // all | app
  var slProfile = null;
  var slShows = {};
  var slApplications = {};

  // Apply builder state
  var slCurrentShowId = null;
  var slCurrentApplication = null;
  var slApplyStep = 0; // 0=select, 1=fetch, 2=images, 3=map, 4=gaps, 5=preview
  var slParsedRequirements = null;
  var slFieldMapping = null;
  var slGapAnalysis = null;
  var slImageAssignments = {};

  // Standard craft show categories
  var CRAFT_CATEGORIES = [
    'Ceramics / Pottery', 'Glass', 'Jewelry', 'Fiber / Textile', 'Wood',
    'Metal / Metalwork', 'Leather', 'Paper / Printmaking', 'Mixed Media',
    'Bath / Body', 'Food / Beverage', 'Photography', 'Painting / Drawing',
    'Sculpture', 'Digital Art', 'Candles / Home Fragrance', 'Other'
  ];

  // ============================================================
  // Data Loading
  // ============================================================

  async function loadShowLight() {
    try {
      var profileSnap = await MastDB.showLight.profile.get();
      slProfile = profileSnap.val() || {};

      var showsSnap = await MastDB.showLight.shows.get();
      slShows = showsSnap.val() || {};

      var appsSnap = await MastDB.showLight.applications.get();
      slApplications = appsSnap.val() || {};

      slLoaded = true;
      renderShowLight();
    } catch (err) {
      console.error('Show Light load error:', err);
      slLoaded = true;
      renderShowLight();
    }
  }

  // ============================================================
  // Token helpers — use window globals, not core-private vars
  // ============================================================

  function updateTokenFromResponse(data) {
    if (data.tokenBalance === undefined) return;
    // getTokenWallet() returns the core _tokenWallet or a default.
    // We need to update core state via the wallet listener, but the
    // response gives us the latest values. Force-update by writing
    // directly to the object getTokenWallet returns (same reference).
    var w = getTokenWallet();
    if (w && w.status !== 'unknown') {
      w.currentBalance = data.tokenBalance;
      w.status = data.tokenStatus || w.status;
      if (data.coinBalance !== undefined) w.coinBalance = data.coinBalance;
    }
    // Re-render indicators
    if (typeof renderTokenBalanceIndicator === 'function') renderTokenBalanceIndicator();
    // Update Show Light header badge
    var badge = document.querySelector('#showLightTab .sl-ai-cost');
    if (badge) {
      var total = (w.currentBalance || 0) + ((w.coinBalance || 0) * 100);
      badge.innerHTML = '⚡ ' + total + ' tokens';
    }
  }

  // ============================================================
  // View Router
  // ============================================================

  function renderShowLight() {
    var el = document.getElementById('showLightTab');
    if (!el) return;

    if (!slLoaded) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--warm-gray);">Loading Show Light...</div>';
      return;
    }

    var h = '';
    h += '<div class="section-header" style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<h2>Show Light</h2>';
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += renderTokenBadge();
    h += '</div>';
    h += '</div>';

    // Sub-nav
    h += '<div class="view-tabs">';
    ['profile', 'gallery', 'shows', 'apply'].forEach(function(v) {
      var label = v === 'apply' ? 'Apply' : v.charAt(0).toUpperCase() + v.slice(1);
      h += '<button class="view-tab' + (slSubView === v ? ' active' : '') + '" onclick="slSwitchView(\'' + v + '\')">' + label + '</button>';
    });
    h += '</div>';

    h += '<div id="slContent"></div>';
    el.innerHTML = h;

    renderSlSubView();
  }

  function renderSlSubView() {
    var el = document.getElementById('slContent');
    if (!el) return;

    switch (slSubView) {
      case 'profile': renderProfile(el); break;
      case 'gallery': renderGallery(el); break;
      case 'shows': renderShows(el); break;
      case 'apply': renderApply(el); break;
    }
  }

  function slSwitchView(view) {
    slSubView = view;
    document.querySelectorAll('#showLightTab .view-tabs .view-tab').forEach(function(btn) {
      btn.classList.remove('active');
      if (btn.textContent.toLowerCase() === view) btn.classList.add('active');
    });
    renderSlSubView();
  }

  function renderTokenBadge() {
    var w = getTokenWallet();
    if (!w || w.status === 'unknown') return '';
    var total = (w.currentBalance || 0) + ((w.coinBalance || 0) * 100);
    return '<span class="sl-ai-cost" onclick="openCoinPurchaseModal()" style="cursor:pointer;">⚡ ' + total + ' tokens</span>';
  }

  // ============================================================
  // Profile View — enriched with craft show application fields
  // ============================================================

  function renderProfile(el) {
    var p = slProfile || {};
    var h = '';

    // ── Identity & Contact ──
    h += '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Vendor Profile</span>';
    h += '<button class="btn btn-primary btn-sm" onclick="slSaveProfile()">Save Profile</button>';
    h += '</div>';

    h += '<div class="sl-form-group"><label>Business / Artist Name</label>';
    h += '<input type="text" id="slProfileName" value="' + esc(p.name || '') + '" placeholder="Your business or artist name"></div>';

    h += '<div class="sl-form-group"><label>Bio / Artist Statement</label>';
    h += '<textarea id="slProfileBio" rows="4" placeholder="Tell jurors about yourself and your work...">' + esc(p.bio || '') + '</textarea></div>';

    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += '<div class="sl-form-group"><label>Primary Category</label>';
    h += '<select id="slProfileCategory">';
    h += '<option value="">Select...</option>';
    CRAFT_CATEGORIES.forEach(function(cat) {
      h += '<option value="' + esc(cat) + '"' + (p.category === cat ? ' selected' : '') + '>' + esc(cat) + '</option>';
    });
    h += '</select></div>';
    h += '<div class="sl-form-group"><label>Secondary Category</label>';
    h += '<select id="slProfileCategory2">';
    h += '<option value="">None</option>';
    CRAFT_CATEGORIES.forEach(function(cat) {
      h += '<option value="' + esc(cat) + '"' + (p.category2 === cat ? ' selected' : '') + '>' + esc(cat) + '</option>';
    });
    h += '</select></div>';
    h += '</div>';

    h += '<div class="sl-form-group"><label>Materials Used</label>';
    h += '<input type="text" id="slProfileMaterials" value="' + esc(p.materials || '') + '" placeholder="e.g. Borosilicate glass, silver, enamel"></div>';

    h += '<div class="sl-form-group"><label>Process / Techniques Description</label>';
    h += '<textarea id="slProfileProcess" rows="3" placeholder="Describe your making process for jurors...">' + esc(p.processDescription || '') + '</textarea></div>';

    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += '<div class="sl-form-group"><label>Price Range</label>';
    h += '<input type="text" id="slProfilePriceRange" value="' + esc(p.priceRange || '') + '" placeholder="e.g. $15 - $200"></div>';
    h += '<div class="sl-form-group"><label>Keywords / Tags (comma-separated)</label>';
    h += '<input type="text" id="slProfileKeywords" value="' + esc((p.keywords || []).join(', ')) + '" placeholder="e.g. handmade, glass, functional art"></div>';
    h += '</div>';

    h += '</div>';

    // Product descriptions live on gallery images, not the profile.
    // Tip shown to guide users.

    // ── Booth Photo (default) ──
    h += '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Default Booth Photo</span></div>';
    h += '<p style="font-size:0.8rem;color:var(--warm-gray);margin:0 0 12px;">This photo auto-fills booth photo slots in every application.</p>';
    if (p.boothPhotoUrl) {
      h += '<div style="display:flex;gap:16px;align-items:flex-start;">';
      h += '<img src="' + esc(p.boothPhotoUrl) + '" style="max-width:200px;max-height:150px;border-radius:8px;object-fit:cover;">';
      h += '<div><button class="btn btn-sm" onclick="slChangeBoothPhoto()" style="background:var(--sage);color:white;border:none;border-radius:6px;padding:4px 12px;cursor:pointer;margin-bottom:8px;">Change</button>';
      h += '<br><button class="btn btn-sm" onclick="slRemoveBoothPhoto()" style="background:none;border:1px solid var(--danger);color:var(--danger);border-radius:6px;padding:4px 12px;cursor:pointer;">Remove</button></div>';
      h += '</div>';
    } else {
      h += '<div class="sl-slot" onclick="slChangeBoothPhoto()" style="max-width:300px;">';
      h += '<div style="font-size:1.5rem;">🎪</div>';
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">Click to set your default booth photo</div>';
      h += '</div>';
    }
    h += '</div>';

    // ── Business Details ──
    h += '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Business Details</span></div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += '<div class="sl-form-group"><label>Years in Business</label><input type="number" id="slProfileYears" value="' + esc(p.yearsInBusiness || '') + '" placeholder="e.g. 5" min="0"></div>';
    h += '<div class="sl-form-group"><label>Business Structure</label>';
    h += '<select id="slProfileStructure">';
    h += '<option value="">Select...</option>';
    ['Sole Proprietor', 'LLC', 'S-Corp', 'C-Corp', 'Partnership', 'Nonprofit'].forEach(function(s) {
      h += '<option value="' + esc(s) + '"' + (p.businessStructure === s ? ' selected' : '') + '>' + esc(s) + '</option>';
    });
    h += '</select></div>';
    h += '<div class="sl-form-group"><label>Tax ID / EIN</label><input type="text" id="slProfileTaxId" value="' + esc(p.taxId || '') + '" placeholder="XX-XXXXXXX"></div>';
    h += '<div class="sl-form-group"><label>Sales Tax Permit #</label><input type="text" id="slProfileSalesTax" value="' + esc(p.salesTaxPermit || '') + '" placeholder="If applicable"></div>';
    h += '<div class="sl-form-group"><label>Business License #</label><input type="text" id="slProfileLicense" value="' + esc(p.businessLicense || '') + '" placeholder="If applicable"></div>';
    h += '</div>';
    h += '<div class="sl-form-group" style="margin-top:8px;"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;">';
    h += '<input type="checkbox" id="slProfileHandmade"' + (p.handmadeAttestation ? ' checked' : '') + ' style="width:auto;">';
    h += '<span style="font-size:0.85rem;text-transform:none;letter-spacing:0;">I confirm all items are original and handmade by me (not imported, mass-produced, or resold)</span>';
    h += '</label></div>';
    h += '</div>';

    // ── Show Preferences ──
    h += '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Show Preferences</span></div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';
    h += '<div class="sl-form-group"><label>Default Booth Size</label>';
    h += '<select id="slProfileBoothSize">';
    ['', '10x10', '10x15', '10x20', '8x10', '6x6', 'Other'].forEach(function(s) {
      h += '<option value="' + esc(s) + '"' + (p.defaultBoothSize === s ? ' selected' : '') + '>' + (s || 'Select...') + '</option>';
    });
    h += '</select></div>';
    h += '<div class="sl-form-group"><label>Electricity Needed</label>';
    h += '<select id="slProfileElectricity">';
    h += '<option value=""' + (!p.electricityNeeded ? ' selected' : '') + '>No</option>';
    h += '<option value="yes"' + (p.electricityNeeded === 'yes' ? ' selected' : '') + '>Yes</option>';
    h += '</select></div>';
    h += '<div class="sl-form-group"><label>Own Tent/Canopy</label>';
    h += '<select id="slProfileTent">';
    h += '<option value=""' + (!p.ownTent ? ' selected' : '') + '>No</option>';
    h += '<option value="yes"' + (p.ownTent === 'yes' ? ' selected' : '') + '>Yes</option>';
    h += '</select></div>';
    h += '</div></div>';

    // ── Social & Contact ──
    h += '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Social & Contact</span></div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += '<div class="sl-form-group"><label>Website</label><input type="url" id="slProfileWebsite" value="' + esc(p.website || '') + '" placeholder="https://..."></div>';
    h += '<div class="sl-form-group"><label>Instagram</label><input type="text" id="slProfileInstagram" value="' + esc(p.instagram || '') + '" placeholder="@handle"></div>';
    h += '<div class="sl-form-group"><label>Etsy Shop</label><input type="url" id="slProfileEtsy" value="' + esc(p.etsy || '') + '" placeholder="https://..."></div>';
    h += '<div class="sl-form-group"><label>Email</label><input type="email" id="slProfileEmail" value="' + esc(p.email || '') + '" placeholder="contact@..."></div>';
    h += '<div class="sl-form-group"><label>Phone</label><input type="tel" id="slProfilePhone" value="' + esc(p.phone || '') + '" placeholder="(555) 123-4567"></div>';
    h += '<div class="sl-form-group"><label>Location</label><input type="text" id="slProfileLocation" value="' + esc(p.location || '') + '" placeholder="City, State"></div>';
    h += '</div>';
    h += '</div>';

    el.innerHTML = h;
  }

  async function slSaveProfile() {
    var data = {
      name: (document.getElementById('slProfileName') || {}).value || '',
      bio: (document.getElementById('slProfileBio') || {}).value || '',
      category: (document.getElementById('slProfileCategory') || {}).value || '',
      category2: (document.getElementById('slProfileCategory2') || {}).value || '',
      materials: (document.getElementById('slProfileMaterials') || {}).value || '',
      processDescription: (document.getElementById('slProfileProcess') || {}).value || '',
      priceRange: (document.getElementById('slProfilePriceRange') || {}).value || '',
      keywords: ((document.getElementById('slProfileKeywords') || {}).value || '').split(',').map(function(k) { return k.trim(); }).filter(Boolean),
      boothPhotoUrl: (slProfile || {}).boothPhotoUrl || '',
      yearsInBusiness: (document.getElementById('slProfileYears') || {}).value || '',
      businessStructure: (document.getElementById('slProfileStructure') || {}).value || '',
      taxId: (document.getElementById('slProfileTaxId') || {}).value || '',
      salesTaxPermit: (document.getElementById('slProfileSalesTax') || {}).value || '',
      businessLicense: (document.getElementById('slProfileLicense') || {}).value || '',
      handmadeAttestation: !!(document.getElementById('slProfileHandmade') || {}).checked,
      defaultBoothSize: (document.getElementById('slProfileBoothSize') || {}).value || '',
      electricityNeeded: (document.getElementById('slProfileElectricity') || {}).value || '',
      ownTent: (document.getElementById('slProfileTent') || {}).value || '',
      website: (document.getElementById('slProfileWebsite') || {}).value || '',
      instagram: (document.getElementById('slProfileInstagram') || {}).value || '',
      etsy: (document.getElementById('slProfileEtsy') || {}).value || '',
      email: (document.getElementById('slProfileEmail') || {}).value || '',
      phone: (document.getElementById('slProfilePhone') || {}).value || '',
      location: (document.getElementById('slProfileLocation') || {}).value || '',
      updatedAt: new Date().toISOString()
    };

    try {
      await MastDB.showLight.profile.set(data);
      slProfile = data;
      showToast('Profile saved.');
    } catch (err) {
      showToast('Failed to save profile: ' + err.message, true);
    }
  }


  function slChangeBoothPhoto() {
    // Use the image library picker
    openImagePicker(function(selected) {
      if (!selected || (Array.isArray(selected) && selected.length === 0)) return;
      var imgId = Array.isArray(selected) ? selected[0] : selected;
      var libImg = imageLibrary[imgId];
      if (!libImg || !libImg.url) { showToast('Image not found.', true); return; }
      slProfile.boothPhotoUrl = libImg.url;
      MastDB.showLight.profile.update({ boothPhotoUrl: libImg.url });
      renderProfile(document.getElementById('slContent'));
      showToast('Booth photo set.');
    });
  }

  function slRemoveBoothPhoto() {
    slProfile.boothPhotoUrl = '';
    MastDB.showLight.profile.update({ boothPhotoUrl: '' });
    renderProfile(document.getElementById('slContent'));
    showToast('Booth photo removed.');
  }

  // ============================================================
  // Gallery View — enriched image metadata
  // ============================================================

  // Gallery shows image library entries. applicationPhoto flag lives on image records.

  function renderGallery(el) {
    var allImages = (imageLibrary || {});
    var entries = Object.entries(allImages);
    entries.sort(function(a, b) { return (b[1].uploadedAt || '').localeCompare(a[1].uploadedAt || ''); });

    var appCount = entries.filter(function(e) { return e[1].applicationPhoto; }).length;

    var h = '';
    h += '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Images (' + entries.length + ')</span>';
    h += '<button class="btn btn-primary btn-sm" onclick="slUploadToLibrary()">+ Upload</button>';
    h += '</div>';

    // Filter toggle
    h += '<div class="view-tabs" style="margin-bottom:12px;">';
    h += '<button class="view-tab' + (slGalleryFilter === 'all' ? ' active' : '') + '" onclick="slSetGalleryFilter(\'all\')">All (' + entries.length + ')</button>';
    h += '<button class="view-tab' + (slGalleryFilter === 'app' ? ' active' : '') + '" onclick="slSetGalleryFilter(\'app\')">Application (' + appCount + ')</button>';
    h += '</div>';

    // Apply filter
    var filtered = slGalleryFilter === 'app' ? entries.filter(function(e) { return e[1].applicationPhoto; }) : entries;

    if (entries.length > 0 && appCount === 0) {
      h += '<div style="font-size:0.8rem;color:var(--warm-gray);margin-bottom:12px;">Click images to mark your best as application photos</div>';
    }

    if (filtered.length === 0) {
      h += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">';
      h += '<div style="font-size:2rem;margin-bottom:8px;">🖼</div>';
      h += '<div>' + (entries.length === 0 ? 'No images yet. Upload photos or go to the <a onclick="navigateTo(\'images\')" style="color:var(--amber);cursor:pointer;">Images</a> tab.' : 'No application photos selected. Switch to "All" and click images to mark them.') + '</div>';
      h += '</div>';
    } else {
      h += '<div class="sl-gallery-grid">';
      filtered.forEach(function(entry) {
        var id = entry[0];
        var img = entry[1];
        var isApp = img.applicationPhoto;
        h += '<div class="sl-gallery-item" onclick="slToggleAppPhoto(\'' + esc(id) + '\')" style="' + (isApp ? 'border-color:var(--amber);' : '') + '">';
        h += '<img src="' + esc(img.thumbnailUrl || img.url || '') + '" alt="' + esc((img.tags || [])[0] || '') + '" loading="lazy">';
        if (isApp) {
          h += '<div style="position:absolute;top:6px;left:6px;background:var(--amber);color:white;font-size:0.6rem;padding:2px 5px;border-radius:3px;font-weight:600;">⭐ APP</div>';
          h += '<div style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.6);color:white;font-size:0.6rem;padding:2px 5px;border-radius:3px;cursor:pointer;" onclick="event.stopPropagation(); slShowAppDescModal(\'' + esc(id) + '\', (imageLibrary || {})[\'' + esc(id) + '\'])">✏️</div>';
        }
        var caption = isApp ? (img.applicationDescription || img.productName || img.description || '') : (img.description || img.productName || '');
        if (caption) h += '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:white;font-size:0.65rem;padding:3px 6px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">' + esc(caption) + '</div>';
        h += '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    el.innerHTML = h;
  }

  function slSetGalleryFilter(f) {
    slGalleryFilter = f;
    renderGallery(document.getElementById('slContent'));
  }

  function slUploadToLibrary() {
    // Use the existing core image library upload modal — it uploads to {tenantId}/images/
    if (typeof openLibraryUploadModal === 'function') {
      openLibraryUploadModal();
    } else {
      showToast('Go to the Images tab to upload photos.', true);
    }
  }

  async function slToggleAppPhoto(id) {
    var img = (imageLibrary || {})[id];
    if (!img) return;
    var newVal = !img.applicationPhoto;
    if (newVal) {
      // Marking as app photo — show description modal
      slShowAppDescModal(id, img);
    } else {
      // Unmarking — clear the flag (keep description for if they re-mark later)
      try {
        await MastDB.images.ref(id + '/applicationPhoto').set(null);
        img.applicationPhoto = false;
        renderGallery(document.getElementById('slContent'));
        showToast('Unmarked.');
      } catch (err) {
        showToast('Update failed: ' + err.message, true);
      }
    }
  }

  function slShowAppDescModal(imgId, img) {
    var existing = img.applicationDescription || '';
    // Pre-fill from product description if image is linked to a product
    if (!existing && img.productId) {
      var p = (window.productsData || []).find(function(x) { return x.pid === img.productId; });
      if (p) existing = (p.shortDescription || p.description || '');
    }
    if (!existing && img.productName) {
      var p2 = (window.productsData || []).find(function(x) { return x.name === img.productName; });
      if (p2) existing = (p2.shortDescription || p2.description || '');
    }

    var html =
      '<div class="modal-header">' +
        '<h3>Application Photo Description</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div style="display:flex;gap:16px;align-items:flex-start;">' +
          '<img src="' + esc(img.thumbnailUrl || img.url || '') + '" style="width:120px;height:120px;object-fit:cover;border-radius:8px;flex-shrink:0;" />' +
          '<div style="flex:1;">' +
            '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 8px;">Describe this product for show applications. This text will auto-fill the product description field whenever this photo is used.</p>' +
            (img.productName ? '<div style="font-size:0.75rem;color:var(--amber);margin-bottom:8px;">Linked to: ' + esc(img.productName) + '</div>' : '') +
            '<textarea id="slAppDescInput" rows="4" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--warm-gray);background:var(--charcoal);color:var(--cream);font-size:0.85rem;resize:vertical;" placeholder="e.g. Hand-blown glass octopus figurine, 4-6 inches tall, made with borosilicate glass...">' + esc(existing) + '</textarea>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="slSaveAppDesc(\'' + esc(imgId) + '\')">Save</button>' +
      '</div>';

    openModal(html);
  }

  async function slSaveAppDesc(imgId) {
    var img = (imageLibrary || {})[imgId];
    if (!img) return;
    var desc = (document.getElementById('slAppDescInput') || {}).value || '';
    desc = desc.trim();
    try {
      var updates = { applicationPhoto: true };
      if (desc) updates.applicationDescription = desc;
      await MastDB.images.ref(imgId).update(updates);
      img.applicationPhoto = true;
      if (desc) img.applicationDescription = desc;
      closeModal();
      renderGallery(document.getElementById('slContent'));
      showToast('Marked as application photo.');
    } catch (err) {
      showToast('Save failed: ' + err.message, true);
    }
  }

  window.slShowAppDescModal = slShowAppDescModal;
  window.slSaveAppDesc = slSaveAppDesc;

  // ============================================================
  // Shows View
  // ============================================================

  function renderShows(el) {
    var entries = Object.entries(slShows);
    entries.sort(function(a, b) {
      var da = a[1].deadline || a[1].date || '';
      var db = b[1].deadline || b[1].date || '';
      return da.localeCompare(db);
    });

    var h = '';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<span style="color:var(--warm-gray);font-size:0.9rem;">' + entries.length + ' shows</span>';
    h += '<button class="btn btn-primary btn-sm" onclick="slOpenAddShowModal()">+ New Show</button>';
    h += '</div>';

    if (entries.length === 0) {
      h += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">';
      h += '<div style="font-size:2rem;margin-bottom:8px;">🎪</div>';
      h += '<div>No shows yet. Add shows you want to apply to.</div>';
      h += '</div>';
    } else {
      entries.forEach(function(entry) {
        var id = entry[0];
        var s = entry[1];
        h += '<div class="sl-show-card" onclick="slOpenEditShowModal(\'' + esc(id) + '\')">';
        h += '<div style="flex:1;">';
        h += '<div style="font-weight:600;font-size:1rem;margin-bottom:4px;">' + esc(s.name || 'Untitled') + '</div>';
        h += '<div style="font-size:0.8rem;color:var(--warm-gray);margin-bottom:4px;">';
        if (s.date) h += esc(s.date);
        if (s.location) h += ' • ' + esc(s.location);
        h += '</div>';
        if (s.deadline) h += '<div style="font-size:0.75rem;color:var(--amber);">Deadline: ' + esc(s.deadline) + '</div>';
        h += '</div>';
        h += '<span class="sl-show-status ' + esc(s.status || 'researching') + '">' + esc(s.status || 'researching') + '</span>';
        h += '</div>';
      });
    }

    el.innerHTML = h;
  }

  function slOpenAddShowModal() {
    var html =
      '<div class="modal-header">' +
        '<h3>Add Show</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="sl-form-group"><label>Show Name</label><input type="text" id="slShowName" placeholder="e.g. Portland Saturday Market"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          '<div class="sl-form-group"><label>Date(s)</label><input type="text" id="slShowDate" placeholder="e.g. June 14-15, 2026"></div>' +
          '<div class="sl-form-group"><label>Location</label><input type="text" id="slShowLocation" placeholder="City, State"></div>' +
        '</div>' +
        '<div class="sl-form-group"><label>Application URL</label><input type="url" id="slShowAppUrl" placeholder="https://..."></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          '<div class="sl-form-group"><label>Application Deadline</label><input type="date" id="slShowDeadline"></div>' +
          '<div class="sl-form-group"><label>Status</label>' +
            '<select id="slShowStatus">' +
              '<option value="researching">Researching</option>' +
              '<option value="ready-to-apply">Ready to Apply</option>' +
              '<option value="applied">Applied</option>' +
              '<option value="accepted">Accepted</option>' +
              '<option value="rejected">Rejected</option>' +
              '<option value="waitlisted">Waitlisted</option>' +
            '</select></div>' +
        '</div>' +
        '<div class="sl-form-group"><label>Notes</label><textarea id="slShowNotes" rows="2" placeholder="Booth fees, requirements, etc."></textarea></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="slSaveNewShow()">Save</button>' +
      '</div>';

    openModal(html);
  }

  async function slSaveNewShow() {
    var name = (document.getElementById('slShowName') || {}).value || '';
    if (!name) { showToast('Show name is required.', true); return; }

    var key = MastDB.showLight.shows.newKey();
    var data = {
      name: name,
      date: (document.getElementById('slShowDate') || {}).value || '',
      location: (document.getElementById('slShowLocation') || {}).value || '',
      applicationUrl: (document.getElementById('slShowAppUrl') || {}).value || '',
      deadline: (document.getElementById('slShowDeadline') || {}).value || '',
      status: (document.getElementById('slShowStatus') || {}).value || 'researching',
      notes: (document.getElementById('slShowNotes') || {}).value || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await MastDB.showLight.shows.ref(key).set(data);
      slShows[key] = data;
      showToast('Show added.');
      closeModal();
      renderShows(document.getElementById('slContent'));
    } catch (err) {
      showToast('Failed to save show: ' + err.message, true);
    }
  }

  function slOpenEditShowModal(id) {
    var s = slShows[id];
    if (!s) return;

    var html =
      '<div class="modal-header">' +
        '<h3>Edit Show</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="sl-form-group"><label>Show Name</label><input type="text" id="slEditShowName" value="' + esc(s.name || '') + '"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          '<div class="sl-form-group"><label>Date(s)</label><input type="text" id="slEditShowDate" value="' + esc(s.date || '') + '"></div>' +
          '<div class="sl-form-group"><label>Location</label><input type="text" id="slEditShowLocation" value="' + esc(s.location || '') + '"></div>' +
        '</div>' +
        '<div class="sl-form-group"><label>Application URL</label><input type="url" id="slEditShowAppUrl" value="' + esc(s.applicationUrl || '') + '"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          '<div class="sl-form-group"><label>Application Deadline</label><input type="date" id="slEditShowDeadline" value="' + esc(s.deadline || '') + '"></div>' +
          '<div class="sl-form-group"><label>Status</label>' +
            '<select id="slEditShowStatus">' +
              '<option value="researching"' + (s.status === 'researching' ? ' selected' : '') + '>Researching</option>' +
              '<option value="ready-to-apply"' + (s.status === 'ready-to-apply' ? ' selected' : '') + '>Ready to Apply</option>' +
              '<option value="applied"' + (s.status === 'applied' ? ' selected' : '') + '>Applied</option>' +
              '<option value="accepted"' + (s.status === 'accepted' ? ' selected' : '') + '>Accepted</option>' +
              '<option value="rejected"' + (s.status === 'rejected' ? ' selected' : '') + '>Rejected</option>' +
              '<option value="waitlisted"' + (s.status === 'waitlisted' ? ' selected' : '') + '>Waitlisted</option>' +
            '</select></div>' +
        '</div>' +
        '<div class="sl-form-group"><label>Notes</label><textarea id="slEditShowNotes" rows="2">' + esc(s.notes || '') + '</textarea></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn" onclick="slDeleteShow(\'' + esc(id) + '\')" style="background:var(--danger);color:white;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;">Delete</button>' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="slUpdateShow(\'' + esc(id) + '\')">Save</button>' +
      '</div>';

    openModal(html);
  }

  async function slUpdateShow(id) {
    var data = {
      name: (document.getElementById('slEditShowName') || {}).value || '',
      date: (document.getElementById('slEditShowDate') || {}).value || '',
      location: (document.getElementById('slEditShowLocation') || {}).value || '',
      applicationUrl: (document.getElementById('slEditShowAppUrl') || {}).value || '',
      deadline: (document.getElementById('slEditShowDeadline') || {}).value || '',
      status: (document.getElementById('slEditShowStatus') || {}).value || 'researching',
      notes: (document.getElementById('slEditShowNotes') || {}).value || '',
      updatedAt: new Date().toISOString()
    };
    try {
      await MastDB.showLight.shows.ref(id).update(data);
      Object.assign(slShows[id], data);
      showToast('Show updated.');
      closeModal();
      renderShows(document.getElementById('slContent'));
    } catch (err) {
      showToast('Update failed: ' + err.message, true);
    }
  }

  async function slDeleteShow(id) {
    if (!await mastConfirm('Delete this show?', { title: 'Delete Show', danger: true })) return;
    try {
      await MastDB.showLight.shows.ref(id).remove();
      delete slShows[id];
      showToast('Show deleted.');
      closeModal();
      renderShows(document.getElementById('slContent'));
    } catch (err) {
      showToast('Delete failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Apply View — AI Application Package Builder
  // ============================================================

  function renderApply(el) {
    if (slApplyStep === 0) {
      renderApplySelectShow(el);
    } else {
      renderApplyBuilder(el);
    }
  }

  function renderApplySelectShow(el) {
    var entries = Object.entries(slShows);
    var applyable = entries.filter(function(e) {
      return e[1].applicationUrl && (e[1].status === 'researching' || e[1].status === 'ready-to-apply');
    });

    var h = '';
    h += '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Build Application Package</span></div>';

    if (applyable.length === 0 && entries.length === 0) {
      h += '<div style="text-align:center;padding:30px;color:var(--warm-gray);">';
      h += '<p>Add shows with application URLs to get started.</p>';
      h += '<button class="btn btn-primary btn-sm" onclick="slSwitchView(\'shows\')">Go to Shows</button>';
      h += '</div>';
    } else if (applyable.length === 0) {
      h += '<div style="text-align:center;padding:30px;color:var(--warm-gray);">';
      h += '<p>No shows with application URLs are ready. Add an application URL to a show, or add a new show.</p>';
      h += '</div>';
    } else {
      h += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Select a show to build an application package for:</p>';
      applyable.forEach(function(entry) {
        var id = entry[0];
        var s = entry[1];
        h += '<div class="sl-show-card" onclick="slStartApply(\'' + esc(id) + '\')">';
        h += '<div style="flex:1;">';
        h += '<div style="font-weight:600;">' + esc(s.name) + '</div>';
        if (s.deadline) h += '<div style="font-size:0.75rem;color:var(--amber);">Deadline: ' + esc(s.deadline) + '</div>';
        h += '</div>';
        h += '<span style="color:var(--amber);font-size:0.9rem;">→</span>';
        h += '</div>';
      });
    }

    // Existing applications
    var appEntries = Object.entries(slApplications);
    if (appEntries.length > 0) {
      h += '<div style="margin-top:24px;">';
      h += '<div class="sl-card-title" style="margin-bottom:12px;">Saved Applications</div>';
      appEntries.forEach(function(entry) {
        var id = entry[0];
        var app = entry[1];
        var show = slShows[app.showId] || {};
        h += '<div class="sl-show-card" onclick="slResumeApplication(\'' + esc(id) + '\')">';
        h += '<div style="flex:1;">';
        h += '<div style="font-weight:600;">' + esc(show.name || app.showName || 'Unknown Show') + '</div>';
        h += '<div style="font-size:0.75rem;color:var(--warm-gray);">Created: ' + esc(app.createdAt ? new Date(app.createdAt).toLocaleDateString() : '') + '</div>';
        h += '</div>';
        h += '<span style="font-size:0.75rem;color:var(--sage);">' + esc(app.status || 'draft') + '</span>';
        h += '</div>';
      });
      h += '</div>';
    }

    h += '</div>';
    el.innerHTML = h;
  }

  function slStartApply(showId) {
    slCurrentShowId = showId;
    slApplyStep = 1;
    slParsedRequirements = null;
    slFieldMapping = null;
    slGapAnalysis = null;
    slImageAssignments = {};
    slCurrentApplication = null;
    renderApply(document.getElementById('slContent'));
  }

  function slResumeApplication(appId) {
    var app = slApplications[appId];
    if (!app) return;
    slCurrentShowId = app.showId;
    slCurrentApplication = Object.assign({ id: appId }, app);
    slParsedRequirements = app.parsedRequirements || null;
    slFieldMapping = app.fieldMapping || null;
    slGapAnalysis = app.gapAnalysis || null;
    slImageAssignments = app.imageAssignments || {};
    // New order: 1=fetch, 2=images, 3=map, 4=gaps, 5=preview
    slApplyStep = slParsedRequirements ? (Object.keys(slImageAssignments).length > 0 ? (slFieldMapping ? 4 : 3) : 2) : 1;
    renderApply(document.getElementById('slContent'));
  }

  function renderApplyBuilder(el) {
    var show = slShows[slCurrentShowId] || {};
    var steps = ['Fetch & Parse', 'Images', 'Auto-Map', 'Gap Analysis', 'Preview'];
    var h = '';

    h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">';
    h += '<button onclick="slBackToShowSelect();" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--warm-gray);">←</button>';
    h += '<div><span style="font-weight:600;font-size:1.1rem;">' + esc(show.name || 'Show') + '</span>';
    if (show.deadline) h += '<span style="font-size:0.8rem;color:var(--amber);margin-left:8px;">Deadline: ' + esc(show.deadline) + '</span>';
    h += '</div></div>';

    h += '<div class="sl-step-indicator">';
    steps.forEach(function(label, i) {
      var stepNum = i + 1;
      var cls = stepNum < slApplyStep ? 'done' : (stepNum === slApplyStep ? 'active' : '');
      h += '<div class="sl-step ' + cls + '" title="' + esc(label) + '"></div>';
    });
    h += '</div>';

    h += '<div id="slApplyContent"></div>';
    el.innerHTML = h;

    var contentEl = document.getElementById('slApplyContent');
    switch (slApplyStep) {
      case 1: renderApplyFetch(contentEl, show); break;
      case 2: renderApplyImages(contentEl, show); break;
      case 3: renderApplyMap(contentEl, show); break;
      case 4: renderApplyGaps(contentEl, show); break;
      case 5: renderApplyPreview(contentEl, show); break;
    }
  }

  // --- Step 1: Fetch & Parse ---

  function renderApplyFetch(el, show) {
    var h = '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Step 1: Fetch & Parse Application</span>';
    h += renderAiCostEstimate(15);
    h += '</div>';

    if (!show.applicationUrl) {
      h += '<div style="color:var(--warm-gray);padding:16px 0;">No application URL set. <a onclick="slSwitchView(\'shows\')" style="color:var(--amber);cursor:pointer;">Edit the show</a> to add one.</div>';
    } else {
      h += '<div class="sl-form-group"><label>Application URL</label>';
      h += '<input type="url" id="slFetchUrl" value="' + esc(show.applicationUrl) + '"></div>';

      if (slParsedRequirements) {
        var reqs = slParsedRequirements;

        h += '<div style="background:rgba(122,139,111,0.1);border-radius:8px;padding:16px;margin-bottom:16px;">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
        h += '<div style="font-weight:600;color:var(--sage);">Parsed Requirements</div>';
        h += '<div style="display:flex;gap:8px;">';
        h += '<a href="' + esc(show.applicationUrl) + '" target="_blank" style="color:var(--amber);font-size:0.8rem;cursor:pointer;text-decoration:underline;">View Source Page</a>';
        h += '<button onclick="slParsedRequirements=null; renderApplyFetch(document.getElementById(\'slApplyContent\'), slShows[slCurrentShowId]||{});" style="background:none;border:none;color:var(--warm-gray);font-size:0.75rem;cursor:pointer;text-decoration:underline;">Re-parse</button>';
        h += '</div></div>';

        // Fields
        h += '<div style="margin-bottom:12px;">';
        h += '<div style="font-size:0.8rem;font-weight:600;color:var(--cream);margin-bottom:6px;">Application Fields (' + (reqs.fields || []).length + ')</div>';
        (reqs.fields || []).forEach(function(f, idx) {
          h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:0.85rem;border-bottom:1px solid rgba(255,255,255,0.05);">';
          h += '<span>' + esc(f.name) + (f.required ? ' <span style="color:var(--danger);font-size:0.7rem;">required</span>' : '') + '</span>';
          h += '<button onclick="slRemoveParsedField(' + idx + ')" style="background:none;border:none;color:var(--warm-gray);cursor:pointer;font-size:0.75rem;">&times;</button>';
          h += '</div>';
        });
        h += '<button onclick="slAddParsedField()" style="background:none;border:none;color:var(--amber);cursor:pointer;font-size:0.8rem;margin-top:4px;">+ Add field</button>';
        h += '</div>';

        // Photos
        h += '<div style="margin-bottom:12px;">';
        h += '<div style="font-size:0.8rem;font-weight:600;color:var(--cream);margin-bottom:6px;">Photo Requirements (' + (reqs.photos || []).length + ')</div>';
        (reqs.photos || []).forEach(function(p, idx) {
          h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:0.85rem;border-bottom:1px solid rgba(255,255,255,0.05);">';
          h += '<span>' + esc(p.slot) + (p.dimensions ? ' <span style="color:var(--warm-gray);font-size:0.75rem;">' + esc(p.dimensions) + '</span>' : '') + '</span>';
          h += '<button onclick="slRemoveParsedPhoto(' + idx + ')" style="background:none;border:none;color:var(--warm-gray);cursor:pointer;font-size:0.75rem;">&times;</button>';
          h += '</div>';
        });
        h += '<button onclick="slAddParsedPhoto()" style="background:none;border:none;color:var(--amber);cursor:pointer;font-size:0.8rem;margin-top:4px;">+ Add photo slot</button>';
        h += '</div>';

        // Fees, deadline, special requirements
        if (reqs.fees) h += '<div style="font-size:0.85rem;margin-bottom:4px;"><strong>Fees:</strong> ' + esc(reqs.fees) + '</div>';
        if (reqs.deadline) h += '<div style="font-size:0.85rem;margin-bottom:4px;"><strong>Deadline:</strong> ' + esc(reqs.deadline) + '</div>';
        if (reqs.specialRequirements && reqs.specialRequirements.length > 0) {
          h += '<div style="font-size:0.85rem;margin-bottom:4px;"><strong>Special:</strong> ' + reqs.specialRequirements.map(function(r) { return esc(r); }).join('; ') + '</div>';
        }
        if (reqs.rawNotes) {
          h += '<details style="margin-top:8px;"><summary style="font-size:0.8rem;color:var(--warm-gray);cursor:pointer;">Raw AI notes</summary>';
          h += '<div style="font-size:0.8rem;color:var(--warm-gray);white-space:pre-wrap;margin-top:4px;max-height:200px;overflow-y:auto;">' + esc(reqs.rawNotes) + '</div></details>';
        }
        h += '</div>';

        h += '<div style="font-size:0.75rem;color:var(--warm-gray);font-style:italic;margin-bottom:12px;">Review the parsed requirements above. Remove or add items before continuing.</div>';
        h += '<button class="btn btn-primary" onclick="slGoToStep(2);">Continue to Images →</button>';
      } else {
        h += '<div style="display:flex;gap:8px;align-items:center;">';
        h += '<button class="btn btn-primary" id="slFetchBtn" onclick="slFetchAndParse()">Fetch & Parse with AI</button>';
        h += '<span id="slFetchStatus" style="font-size:0.85rem;color:var(--warm-gray);"></span>';
        h += '</div>';
      }
    }

    h += '</div>';
    el.innerHTML = h;
  }

  function renderAiCostEstimate(tokens) {
    var w = getTokenWallet();
    if (w.status === 'suspended') {
      return '<span class="sl-ai-cost" style="color:var(--danger);">⏸ AI suspended — <a onclick="openCoinPurchaseModal()" style="cursor:pointer;text-decoration:underline;">buy coins</a></span>';
    }
    return '<span class="sl-ai-cost">~' + tokens + ' tokens</span>';
  }

  async function slFetchAndParse() {
    var url = (document.getElementById('slFetchUrl') || {}).value;
    if (!url) { showToast('Enter an application URL.', true); return; }

    var w = getTokenWallet();
    if (w.status === 'suspended') {
      showToast('AI features suspended. Purchase coins to continue.', true);
      openCoinPurchaseModal();
      return;
    }

    var btn = document.getElementById('slFetchBtn');
    var status = document.getElementById('slFetchStatus');
    if (btn) { btn.disabled = true; btn.textContent = 'Fetching page...'; }
    if (status) status.textContent = 'Fetching application page...';

    try {
      var token = await auth.currentUser.getIdToken();

      var resp = await callCF('/studioAssistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          question: 'Parse the following show application URL and extract the jury/application requirements. URL: ' + url + '\n\nReturn a JSON object with these fields:\n- fields: array of {name, description, required: boolean} for each required field (business name, bio, product description, etc.)\n- photos: array of {slot, description, dimensions} for each required photo (e.g. "Booth photo", "Product close-up")\n- fees: string describing application/booth fees\n- deadline: string with application deadline\n- specialRequirements: array of strings for any special requirements\n- rawNotes: string with any other relevant info\n\nRespond ONLY with valid JSON, no markdown.',
          assistantContext: 'show-light-parse-application'
        })
      });

      if (resp.status === 402) {
        showToast('Token balance exhausted. Purchase coins to continue.', true);
        openCoinPurchaseModal();
        if (btn) { btn.disabled = false; btn.textContent = 'Fetch & Parse with AI'; }
        if (status) status.textContent = '';
        return;
      }

      var data = await resp.json();
      updateTokenFromResponse(data);

      var answer = data.answer || '';
      try {
        var jsonStr = answer.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
        slParsedRequirements = JSON.parse(jsonStr);
      } catch (parseErr) {
        slParsedRequirements = {
          fields: [{ name: 'Business Name', description: 'Your business or artist name', required: true },
                   { name: 'Artist Statement', description: 'Bio or artist statement', required: true },
                   { name: 'Product Description', description: 'Description of your products', required: true }],
          photos: [{ slot: 'Product Photo', description: 'Photo of your products' },
                   { slot: 'Booth Photo', description: 'Photo of your booth setup' }],
          fees: '',
          deadline: '',
          specialRequirements: [],
          rawNotes: answer
        };
      }

      renderApplyFetch(document.getElementById('slApplyContent'), slShows[slCurrentShowId] || {});
    } catch (err) {
      showToast('Fetch failed: ' + err.message, true);
      if (btn) { btn.disabled = false; btn.textContent = 'Fetch & Parse with AI'; }
      if (status) status.textContent = '';
    }
  }

  function slRemoveParsedField(idx) {
    if (slParsedRequirements && slParsedRequirements.fields) {
      slParsedRequirements.fields.splice(idx, 1);
    }
    renderApplyFetch(document.getElementById('slApplyContent'), slShows[slCurrentShowId] || {});
  }

  async function slAddParsedField() {
    var name = await mastPrompt('Field name (e.g. "Product Description"):', { title: 'Add Field' });
    if (!name) return;
    if (!slParsedRequirements) slParsedRequirements = { fields: [], photos: [] };
    if (!slParsedRequirements.fields) slParsedRequirements.fields = [];
    slParsedRequirements.fields.push({ name: name.trim(), description: '', required: true });
    renderApplyFetch(document.getElementById('slApplyContent'), slShows[slCurrentShowId] || {});
  }

  function slRemoveParsedPhoto(idx) {
    if (slParsedRequirements && slParsedRequirements.photos) {
      slParsedRequirements.photos.splice(idx, 1);
    }
    renderApplyFetch(document.getElementById('slApplyContent'), slShows[slCurrentShowId] || {});
  }

  async function slAddParsedPhoto() {
    var slot = await mastPrompt('Photo slot name (e.g. "Process Photo 1"):', { title: 'Add Photo Slot' });
    if (!slot) return;
    if (!slParsedRequirements) slParsedRequirements = { fields: [], photos: [] };
    if (!slParsedRequirements.photos) slParsedRequirements.photos = [];
    slParsedRequirements.photos.push({ slot: slot.trim(), description: '' });
    renderApplyFetch(document.getElementById('slApplyContent'), slShows[slCurrentShowId] || {});
  }

  window.slRemoveParsedField = slRemoveParsedField;
  window.slAddParsedField = slAddParsedField;
  window.slRemoveParsedPhoto = slRemoveParsedPhoto;
  window.slAddParsedPhoto = slAddParsedPhoto;

  // --- Step 2: Auto-Map (with enriched profile fields + product desc from images) ---

  function renderApplyMap(el, show) {
    var reqs = slParsedRequirements || {};
    var fields = reqs.fields || [];
    var profile = slProfile || {};

    if (!slFieldMapping) {
      slFieldMapping = {};

      // Build product description from assigned images' applicationDescription fields
      var productDesc = '';
      var lib = imageLibrary || {};
      Object.values(slImageAssignments).forEach(function(imgId) {
        if (imgId === '__profile_booth__') return;
        var img = lib[imgId];
        if (!img) return;
        // Use the application description written for this photo
        if (img.applicationDescription && productDesc.indexOf(img.applicationDescription) < 0) {
          productDesc += img.applicationDescription + '\n';
        }
      });
      // Fallback: if no application descriptions, try product catalog
      if (!productDesc) {
        var prodsArr = window.productsData || [];
        Object.values(slImageAssignments).forEach(function(imgId) {
          if (imgId === '__profile_booth__') return;
          var img = lib[imgId];
          if (!img) return;
          if (img.productId) {
            var p = prodsArr.find(function(x) { return x.pid === img.productId; });
            if (p && p.description && productDesc.indexOf(p.description) < 0) {
              productDesc += (p.name ? p.name + ': ' : '') + (p.shortDescription || p.description) + '\n';
            }
          }
        });
      }
      productDesc = productDesc.trim();


      fields.forEach(function(f) {
        var name = (f.name || '').toLowerCase();
        var mapped = null;

        if (name.indexOf('business') >= 0 || name.indexOf('artist name') >= 0 || name.indexOf('company') >= 0) {
          mapped = { source: 'profile.name', value: profile.name || '', confidence: profile.name ? 'high' : 'none' };
        } else if (name.indexOf('bio') >= 0 || name.indexOf('statement') >= 0 || name.indexOf('about') >= 0) {
          mapped = { source: 'profile.bio', value: profile.bio || '', confidence: profile.bio ? 'high' : 'none' };
        } else if (name.indexOf('product') >= 0 || name.indexOf('description') >= 0 || name.indexOf('what you') >= 0) {
          // Product descriptions come from gallery images, not the profile
          mapped = { source: 'gallery images', value: productDesc, confidence: productDesc ? 'medium' : 'none' };
        } else if (name.indexOf('material') >= 0) {
          mapped = { source: 'profile.materials', value: profile.materials || '', confidence: profile.materials ? 'high' : 'none' };
        } else if (name.indexOf('process') >= 0 || name.indexOf('technique') >= 0) {
          mapped = { source: 'profile.processDescription', value: profile.processDescription || '', confidence: profile.processDescription ? 'high' : 'none' };
        } else if (name.indexOf('categor') >= 0 || name.indexOf('medium') >= 0 || name.indexOf('craft') >= 0) {
          var catVal = profile.category || '';
          if (profile.category2) catVal += ', ' + profile.category2;
          mapped = { source: 'profile.category', value: catVal, confidence: catVal ? 'high' : 'none' };
        } else if (name.indexOf('price') >= 0 || name.indexOf('range') >= 0) {
          mapped = { source: 'profile.priceRange', value: profile.priceRange || '', confidence: profile.priceRange ? 'high' : 'none' };
        } else if (name.indexOf('website') >= 0 || name.indexOf('url') >= 0) {
          mapped = { source: 'profile.website', value: profile.website || '', confidence: profile.website ? 'high' : 'none' };
        } else if (name.indexOf('instagram') >= 0 || name.indexOf('social') >= 0) {
          mapped = { source: 'profile.instagram', value: profile.instagram || '', confidence: profile.instagram ? 'high' : 'none' };
        } else if (name.indexOf('email') >= 0) {
          mapped = { source: 'profile.email', value: profile.email || '', confidence: profile.email ? 'high' : 'none' };
        } else if (name.indexOf('phone') >= 0) {
          mapped = { source: 'profile.phone', value: profile.phone || '', confidence: profile.phone ? 'high' : 'none' };
        } else if (name.indexOf('location') >= 0 || name.indexOf('city') >= 0 || name.indexOf('address') >= 0) {
          mapped = { source: 'profile.location', value: profile.location || '', confidence: profile.location ? 'medium' : 'none' };
        } else if (name.indexOf('year') >= 0 || name.indexOf('experience') >= 0 || name.indexOf('long') >= 0) {
          mapped = { source: 'profile.yearsInBusiness', value: profile.yearsInBusiness ? profile.yearsInBusiness + ' years' : '', confidence: profile.yearsInBusiness ? 'high' : 'none' };
        } else if (name.indexOf('tax') >= 0 || name.indexOf('ein') >= 0) {
          mapped = { source: 'profile.taxId', value: profile.taxId || '', confidence: profile.taxId ? 'high' : 'none' };
        } else if (name.indexOf('booth') >= 0 && name.indexOf('size') >= 0) {
          mapped = { source: 'profile.defaultBoothSize', value: profile.defaultBoothSize || '', confidence: profile.defaultBoothSize ? 'high' : 'none' };
        } else if (name.indexOf('license') >= 0) {
          mapped = { source: 'profile.businessLicense', value: profile.businessLicense || '', confidence: profile.businessLicense ? 'high' : 'none' };
        } else {
          mapped = { source: 'manual', value: '', confidence: 'none' };
        }
        slFieldMapping[f.name] = mapped;
      });
    }

    var h = '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Step 2: Auto-Map Fields</span></div>';
    h += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Review how your profile maps to the application fields. Edit values as needed.</p>';

    fields.forEach(function(f) {
      var m = slFieldMapping[f.name] || { source: 'manual', value: '', confidence: 'none' };
      var confColor = m.confidence === 'high' ? 'var(--sage)' : m.confidence === 'medium' ? 'var(--amber)' : 'var(--danger, #dc2626)';
      var confLabel = m.confidence === 'high' ? '✓ Auto-matched' : m.confidence === 'medium' ? '~ Partial match' : '✗ Not matched';
      if (m.source === 'gallery images') confLabel = '~ From gallery images';

      h += '<div class="sl-form-group">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      h += '<label>' + esc(f.name) + (f.required ? ' <span style="color:var(--danger);">*</span>' : '') + '</label>';
      h += '<span style="font-size:0.7rem;color:' + confColor + ';">' + confLabel + '</span>';
      h += '</div>';
      if (f.description) h += '<div style="font-size:0.75rem;color:var(--warm-gray);margin-bottom:4px;">' + esc(f.description) + '</div>';
      h += '<textarea id="slMap_' + esc(f.name.replace(/\s+/g, '_')) + '" rows="2" placeholder="Enter value...">' + esc(m.value) + '</textarea>';
      h += '</div>';
    });

    h += '<div style="display:flex;gap:8px;margin-top:16px;">';
    h += '<button class="btn btn-secondary" onclick="slGoToStep(2);">← Back</button>';
    h += '<button class="btn btn-primary" onclick="slSaveMapping(); slGoToStep(4);">Continue to Gap Analysis →</button>';
    h += '</div>';
    h += '</div>';

    el.innerHTML = h;
  }

  function slSaveMapping() {
    var fields = (slParsedRequirements || {}).fields || [];
    fields.forEach(function(f) {
      var key = f.name.replace(/\s+/g, '_');
      var textarea = document.getElementById('slMap_' + key);
      if (textarea && slFieldMapping[f.name]) {
        slFieldMapping[f.name].value = textarea.value;
      }
    });
  }

  // --- Step 3: Gap Analysis ---

  function renderApplyGaps(el, show) {
    var reqs = slParsedRequirements || {};
    var fields = reqs.fields || [];
    var photos = reqs.photos || [];

    var gaps = [];
    fields.forEach(function(f) {
      var m = slFieldMapping[f.name] || {};
      if (f.required && !m.value) {
        gaps.push({ type: 'field', name: f.name, description: f.description || '', section: 'profile' });
      }
    });

    var galleryByCategory = {};
    Object.values((imageLibrary || {})).forEach(function(img) {
      if (img.category) galleryByCategory[img.category] = (galleryByCategory[img.category] || 0) + 1;
    });

    // Check booth photo from profile
    var hasBoothPhoto = !!(slProfile && slProfile.boothPhotoUrl) || !!galleryByCategory.booth;

    photos.forEach(function(p, idx) {
      // Check if this slot has an image assigned from Step 4
      if (slImageAssignments[idx]) return; // assigned — no gap
      // Fallback: check gallery categories
      var slotLower = (p.slot || '').toLowerCase();
      var matched = false;
      if (slotLower.indexOf('booth') >= 0 && hasBoothPhoto) matched = true;
      if (slotLower.indexOf('product') >= 0 && galleryByCategory.product) matched = true;
      if (slotLower.indexOf('process') >= 0 && galleryByCategory.process) matched = true;
      if (slotLower.indexOf('headshot') >= 0 && galleryByCategory.headshot) matched = true;
      if (slotLower.indexOf('detail') >= 0 && galleryByCategory.detail) matched = true;
      if (!matched) {
        gaps.push({ type: 'photo', name: p.slot, description: p.description || '', section: 'gallery' });
      }
    });

    slGapAnalysis = gaps;

    var h = '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Step 3: Gap Analysis</span></div>';

    if (gaps.length === 0) {
      h += '<div style="text-align:center;padding:20px;color:var(--sage);">';
      h += '<div style="font-size:1.5rem;margin-bottom:8px;">✓</div>';
      h += '<div style="font-weight:600;">All requirements met!</div>';
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">Your profile and gallery cover everything this show needs.</div>';
      h += '</div>';
    } else {
      h += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">These items are required but missing from your profile or gallery:</p>';
      gaps.forEach(function(g) {
        h += '<div class="sl-gap-item">';
        h += '<span class="sl-gap-icon">' + (g.type === 'photo' ? '📷' : '📝') + '</span>';
        h += '<div style="flex:1;">';
        h += '<div style="font-weight:500;">' + esc(g.name) + '</div>';
        if (g.description) h += '<div style="font-size:0.75rem;color:var(--warm-gray);">' + esc(g.description) + '</div>';
        h += '</div>';
        h += '<a onclick="slSwitchView(\'' + esc(g.section) + '\')" style="color:var(--amber);cursor:pointer;font-size:0.8rem;">Fix →</a>';
        h += '</div>';
      });
    }

    h += '<div style="display:flex;gap:8px;margin-top:16px;">';
    h += '<button class="btn btn-secondary" onclick="slGoToStep(3);">← Back</button>';
    h += '<button class="btn btn-primary" onclick="slGoToStep(5);">Preview Package →</button>';
    h += '</div>';
    h += '</div>';

    el.innerHTML = h;
  }

  // --- Step 4: Image Assignment (with booth photo auto-fill) ---

  function renderApplyImages(el, show) {
    var reqs = slParsedRequirements || {};
    var photos = reqs.photos || [];
    var profile = slProfile || {};

    // Auto-assign booth photo from profile if not already assigned
    photos.forEach(function(p, idx) {
      if (!slImageAssignments[idx]) {
        var slotLower = (p.slot || '').toLowerCase();
        if (slotLower.indexOf('booth') >= 0 && profile.boothPhotoUrl) {
          slImageAssignments[idx] = '__profile_booth__';
        }
      }
    });

    var h = '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Step 4: Assign Images</span></div>';
    h += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Click each slot to assign an image from your gallery.</p>';

    if (photos.length === 0) {
      h += '<div style="color:var(--warm-gray);padding:16px 0;">No specific image requirements detected. You can skip this step.</div>';
    } else {
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:16px;">';
      photos.forEach(function(p, idx) {
        var assigned = slImageAssignments[idx];
        var assignedImg = null;
        var isProfileBooth = false;

        if (assigned === '__profile_booth__') {
          assignedImg = { url: profile.boothPhotoUrl };
          isProfileBooth = true;
        } else if (assigned) {
          assignedImg = (imageLibrary || {})[assigned];
        }

        h += '<div class="sl-slot' + (assignedImg ? ' filled' : '') + '" onclick="slPickImageForSlot(' + idx + ')">';
        if (assignedImg) {
          h += '<img src="' + esc(assignedImg.url || assignedImg.thumbnailUrl || '') + '" alt="">';
          h += '<div style="font-size:0.75rem;color:var(--sage);margin-top:4px;">✓ ' + esc(p.slot || 'Photo ' + (idx + 1)) + '</div>';
          if (isProfileBooth) h += '<div style="font-size:0.65rem;color:var(--amber);">From profile default</div>';
        } else {
          h += '<div style="font-size:1.5rem;color:var(--warm-gray);">+</div>';
          h += '<div style="font-size:0.8rem;color:var(--warm-gray);">' + esc(p.slot || 'Photo ' + (idx + 1)) + '</div>';
          if (p.description) h += '<div style="font-size:0.7rem;color:var(--warm-gray);opacity:0.7;">' + esc(p.description) + '</div>';
          if (p.dimensions) h += '<div style="font-size:0.65rem;color:var(--amber);">' + esc(p.dimensions) + '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }

    // Full-width product description sections for each assigned product photo
    var hasProductDesc = false;
    photos.forEach(function(p, idx) {
      var assigned = slImageAssignments[idx];
      if (!assigned || assigned === '__profile_booth__') return;
      var img = (imageLibrary || {})[assigned];
      if (!img) return;
      hasProductDesc = true;

      var appDesc = img.applicationDescription || '';
      var currentPid = img.productId || '';

      // Build product options sorted by name
      var prodOptions = (window.productsData || [])
        .filter(function(p) { return p.name; })
        .slice() // don't mutate original
        .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

      h += '<div style="margin-top:16px;padding:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:10px;position:relative;">';
      h += '<button onclick="slAssignImage(' + idx + ', null)" style="position:absolute;top:8px;right:8px;background:none;border:none;color:var(--warm-gray);font-size:1.2rem;cursor:pointer;padding:4px 8px;line-height:1;" title="Remove image">&times;</button>';
      h += '<div style="display:flex;gap:16px;align-items:flex-start;">';
      h += '<img src="' + esc(img.thumbnailUrl || img.url || '') + '" style="width:100px;height:100px;object-fit:cover;border-radius:8px;flex-shrink:0;" />';
      h += '<div style="flex:1;">';
      h += '<div style="font-size:0.9rem;font-weight:600;color:var(--cream);margin-bottom:8px;">' + esc(p.slot || 'Product Photo') + '</div>';

      // Product dropdown
      h += '<label style="font-size:0.8rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Link to Product</label>';
      h += '<select id="slProdSelect_' + idx + '" onchange="slLinkProduct(' + idx + ', this.value)" ' +
        'style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:var(--charcoal);color:var(--cream);font-size:0.85rem;margin-bottom:12px;cursor:pointer;">';
      h += '<option value="">— Select a product —</option>';
      prodOptions.forEach(function(prod) {
        var sel = prod.pid === currentPid ? ' selected' : '';
        h += '<option value="' + esc(prod.pid) + '"' + sel + '>' + esc(prod.name) + (prod.price ? ' (' + esc(prod.price) + ')' : '') + '</option>';
      });
      h += '</select>';

      // Application description
      h += '<label style="font-size:0.8rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Application Description</label>';
      h += '<textarea id="slAppDesc_' + idx + '" rows="4" placeholder="Describe this product for show applications. Select a product above to pre-fill..." ' +
        'style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:var(--charcoal);color:var(--cream);font-size:0.9rem;line-height:1.4;resize:vertical;" ' +
        'onblur="slSaveSlotDesc(' + idx + ', this.value)">' + esc(appDesc) + '</textarea>';
      h += '</div>';
      h += '</div>';
      h += '</div>';
    });

    if (hasProductDesc) {
      h += '<div style="margin-top:8px;font-size:0.75rem;color:var(--warm-gray);font-style:italic;">These descriptions will auto-fill the product description field in Step 3.</div>';
    }

    h += '<div style="display:flex;gap:8px;margin-top:16px;">';
    h += '<button class="btn btn-secondary" onclick="slGoToStep(1);">← Back</button>';
    h += '<button class="btn btn-primary" onclick="slGoToStep(3);">Continue to Auto-Map →</button>';
    h += '</div>';
    h += '</div>';

    el.innerHTML = h;
  }

  function slPickImageForSlot(slotIdx) {
    var allEntries = Object.entries((imageLibrary || {}));
    if (allEntries.length === 0) {
      showToast('No images in gallery. Upload some first.', true);
      return;
    }

    // Show application photos first; fall back to all if none marked
    var appEntries = allEntries.filter(function(e) { return e[1].applicationPhoto; });
    var entries = appEntries.length > 0 ? appEntries : allEntries;
    var showingAll = appEntries.length === 0;

    var html =
      '<div class="modal-header">' +
        '<h3>Select Image</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        (showingAll
          ? '<div style="font-size:0.8rem;color:var(--warm-gray);margin-bottom:8px;">No application photos marked yet — showing all gallery images. Mark your best photos as "Application Photo" in the Gallery.</div>'
          : '<div style="font-size:0.8rem;color:var(--amber);margin-bottom:8px;">⭐ Showing ' + appEntries.length + ' application photo' + (appEntries.length !== 1 ? 's' : '') + '</div>') +
        '<div class="sl-gallery-grid">';

    entries.forEach(function(entry) {
      var id = entry[0];
      var img = entry[1];
      html += '<div class="sl-gallery-item" onclick="slAssignImage(' + slotIdx + ', \'' + esc(id) + '\'); closeModal();" style="cursor:pointer;">';
      html += '<img src="' + esc(img.url || img.thumbnailUrl || '') + '" alt="" loading="lazy">';
      if (img.category) html += '<span class="status-badge" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.6);color:white;font-size:0.65rem;">' + esc(img.category) + '</span>';
      if (img.productName) html += '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:white;font-size:0.6rem;padding:2px 4px;">' + esc(img.productName) + '</div>';
      html += '</div>';
    });

    html += '</div></div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        (slImageAssignments[slotIdx] ? '<button class="btn" onclick="slAssignImage(' + slotIdx + ', null); closeModal();" style="background:var(--danger);color:white;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;">Remove</button>' : '') +
      '</div>';

    openModal(html);
  }

  function slAssignImage(slotIdx, imageId) {
    if (imageId) {
      slImageAssignments[slotIdx] = imageId;
      // Pre-fill applicationDescription from product if not already set
      var img = (imageLibrary || {})[imageId];
      if (img && !img.applicationDescription) {
        var prodsArr = window.productsData || [];
        var desc = '';
        // 1. Match by productId
        if (img.productId) {
          var p = prodsArr.find(function(x) { return x.pid === img.productId; });
          if (p) desc = p.shortDescription || p.description || '';
        }
        // 2. Match by productName
        if (!desc && img.productName) {
          var p2 = prodsArr.find(function(x) { return x.name === img.productName; });
          if (p2) desc = p2.shortDescription || p2.description || '';
        }
        // 3. Match by tags to product names
        if (!desc && img.tags && img.tags.length) {
          img.tags.forEach(function(tag) {
            if (desc) return;
            var p3 = prodsArr.find(function(x) { return x.name === tag; });
            if (p3) desc = p3.shortDescription || p3.description || '';
          });
        }
        // 4. Match by image URL to product image URL
        if (!desc && img.url) {
          var p4 = prodsArr.find(function(x) { return x.image === img.url; });
          if (p4) desc = p4.shortDescription || p4.description || '';
        }
        if (desc) {
          img.applicationDescription = desc;
          MastDB.images.ref(imageId + '/applicationDescription').set(desc).catch(function() {});
        }
      }
    } else {
      delete slImageAssignments[slotIdx];
    }
    renderApplyImages(document.getElementById('slApplyContent'), slShows[slCurrentShowId] || {});
  }

  async function slSaveSlotDesc(slotIdx, value) {
    var imgId = slImageAssignments[slotIdx];
    if (!imgId || imgId === '__profile_booth__') return;
    var img = (imageLibrary || {})[imgId];
    if (!img) return;
    value = (value || '').trim();
    try {
      await MastDB.images.ref(imgId + '/applicationDescription').set(value || null);
      img.applicationDescription = value || '';
      // Also mark as application photo if not already
      if (value && !img.applicationPhoto) {
        await MastDB.images.ref(imgId + '/applicationPhoto').set(true);
        img.applicationPhoto = true;
      }
    } catch (err) {
      showToast('Failed to save description: ' + err.message, true);
    }
  }

  async function slLinkProduct(slotIdx, pid) {
    var imgId = slImageAssignments[slotIdx];
    if (!imgId || imgId === '__profile_booth__') return;
    var img = (imageLibrary || {})[imgId];
    if (!img) return;

    var product = pid ? (window.productsData || []).find(function(x) { return x.pid === pid; }) : null;

    try {
      if (pid && product) {
        // Link image to product
        await MastDB.images.ref(imgId).update({
          productId: pid,
          productName: product.name || ''
        });
        img.productId = pid;
        img.productName = product.name || '';

        // Pre-fill description from product if textarea is empty
        var textarea = document.getElementById('slAppDesc_' + slotIdx);
        var currentDesc = textarea ? textarea.value.trim() : '';
        if (!currentDesc) {
          var desc = product.shortDescription || product.description || '';
          if (desc) {
            if (textarea) textarea.value = desc;
            img.applicationDescription = desc;
            await MastDB.images.ref(imgId + '/applicationDescription').set(desc);
            if (!img.applicationPhoto) {
              await MastDB.images.ref(imgId + '/applicationPhoto').set(true);
              img.applicationPhoto = true;
            }
          }
        }
        showToast('Linked to ' + product.name);
      } else {
        // Unlink
        await MastDB.images.ref(imgId + '/productId').set(null);
        await MastDB.images.ref(imgId + '/productName').set(null);
        delete img.productId;
        delete img.productName;
      }
    } catch (err) {
      showToast('Failed to link product: ' + err.message, true);
    }
  }

  window.slSaveSlotDesc = slSaveSlotDesc;
  window.slLinkProduct = slLinkProduct;

  // --- Step 5: Application Assistant ---

  var slCopyIdx = -1; // tracks which field was last copied

  function renderApplyPreview(el, show) {
    var reqs = slParsedRequirements || {};
    var fields = reqs.fields || [];
    var photos = reqs.photos || [];
    var profile = slProfile || {};
    var appUrl = show.applicationUrl || '';

    var h = '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Step 5: Application Assistant</span></div>';

    // Show header
    h += '<div style="background:var(--charcoal, #2A2A2A);color:white;padding:16px;border-radius:8px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">';
    h += '<div>';
    h += '<div style="font-family:\'Cormorant Garamond\', serif;font-size:1.3rem;font-weight:600;">' + esc(show.name || 'Show') + '</div>';
    if (show.date) h += '<div style="font-size:0.85rem;opacity:0.8;">' + esc(show.date) + '</div>';
    h += '</div>';
    if (appUrl) {
      h += '<button class="btn btn-primary" onclick="slLaunchApplication()" style="white-space:nowrap;">Launch Application</button>';
    }
    h += '</div>';

    if (appUrl) {
      h += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Copy each field value below and paste it into the application form. Fields are in application order.</p>';
    }

    // Sequential field list with copy buttons
    h += '<div style="margin-bottom:20px;">';
    h += '<div style="font-weight:600;margin-bottom:12px;font-size:0.9rem;">Application Fields</div>';
    fields.forEach(function(f, idx) {
      var m = slFieldMapping[f.name] || {};
      var val = m.value || '';
      var isCurrent = idx === slCopyIdx;
      var isCopied = idx < slCopyIdx;
      var borderColor = isCurrent ? 'var(--amber)' : (isCopied ? 'var(--sage)' : 'rgba(255,255,255,0.1)');
      var bgColor = isCurrent ? 'rgba(196,164,105,0.08)' : 'rgba(255,255,255,0.02)';

      h += '<div id="slField_' + idx + '" style="padding:12px 16px;border:1px solid ' + borderColor + ';border-radius:8px;margin-bottom:8px;background:' + bgColor + ';transition:all 0.2s;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
      h += '<div style="display:flex;align-items:center;gap:8px;">';
      if (isCopied) {
        h += '<span style="color:var(--sage);font-size:0.8rem;">&#10003;</span>';
      } else {
        h += '<span style="color:var(--warm-gray);font-size:0.75rem;font-weight:600;">' + (idx + 1) + '</span>';
      }
      h += '<span style="font-size:0.8rem;color:var(--warm-gray);text-transform:uppercase;font-weight:500;">' + esc(f.name) + '</span>';
      if (f.required) h += '<span style="color:var(--danger);font-size:0.65rem;">required</span>';
      h += '</div>';
      if (val) {
        h += '<button onclick="slCopyField(' + idx + ')" style="background:' + (isCurrent ? 'var(--amber)' : 'rgba(255,255,255,0.1)') + ';color:' + (isCurrent ? 'white' : 'var(--cream)') + ';border:none;border-radius:6px;padding:4px 12px;font-size:0.75rem;cursor:pointer;font-weight:600;">' + (isCopied ? 'Copied' : 'Copy') + '</button>';
      }
      h += '</div>';
      if (val) {
        h += '<div style="font-size:0.9rem;color:var(--cream);white-space:pre-wrap;line-height:1.4;">' + esc(val) + '</div>';
      } else {
        h += '<div style="font-size:0.85rem;color:var(--danger);font-style:italic;">No value — fill in manually</div>';
      }
      h += '</div>';
    });
    h += '</div>';

    // Photo downloads
    if (photos.length > 0) {
      h += '<div style="margin-bottom:20px;">';
      h += '<div style="font-weight:600;margin-bottom:12px;font-size:0.9rem;">Photos to Upload</div>';
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(160px, 1fr));gap:12px;">';
      photos.forEach(function(p, idx) {
        var assigned = slImageAssignments[idx];
        var img = null;
        if (assigned === '__profile_booth__') {
          img = { url: profile.boothPhotoUrl };
        } else if (assigned) {
          img = (imageLibrary || {})[assigned];
        }
        h += '<div style="text-align:center;padding:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.1);border-radius:8px;">';
        if (img && img.url) {
          h += '<img src="' + esc(img.url) + '" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;margin-bottom:8px;">';
          h += '<div style="font-size:0.75rem;color:var(--warm-gray);margin-bottom:6px;">' + esc(p.slot || 'Photo ' + (idx + 1)) + '</div>';
          h += '<button onclick="slDownloadPhoto(\'' + esc(img.url) + '\', \'' + esc(p.slot || 'photo') + '\')" style="background:rgba(255,255,255,0.1);color:var(--cream);border:none;border-radius:6px;padding:4px 12px;font-size:0.75rem;cursor:pointer;">Download</button>';
        } else {
          h += '<div style="width:100%;aspect-ratio:1;background:var(--cream-dark);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--warm-gray);margin-bottom:8px;">—</div>';
          h += '<div style="font-size:0.75rem;color:var(--danger);">' + esc(p.slot || 'Photo') + ' — not assigned</div>';
        }
        h += '</div>';
      });
      h += '</div></div>';
    }

    // Special requirements reminder
    if (reqs.specialRequirements && reqs.specialRequirements.length > 0) {
      h += '<div style="margin-bottom:16px;padding:12px;background:rgba(196,164,105,0.08);border:1px solid rgba(196,164,105,0.2);border-radius:8px;">';
      h += '<div style="font-weight:600;margin-bottom:8px;font-size:0.9rem;color:var(--amber);">Special Requirements</div>';
      reqs.specialRequirements.forEach(function(r) {
        h += '<div style="font-size:0.85rem;padding:4px 0;">• ' + esc(r) + '</div>';
      });
      h += '</div>';
    }

    // Fees & deadline reminder
    if (reqs.fees || reqs.deadline) {
      h += '<div style="display:flex;gap:16px;margin-bottom:16px;font-size:0.85rem;">';
      if (reqs.fees) h += '<div><span style="color:var(--warm-gray);">Fees:</span> ' + esc(reqs.fees) + '</div>';
      if (reqs.deadline) h += '<div><span style="color:var(--warm-gray);">Deadline:</span> ' + esc(reqs.deadline) + '</div>';
      h += '</div>';
    }

    h += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">';
    h += '<button class="btn btn-secondary" onclick="slGoToStep(4);">← Back</button>';
    h += '<button class="btn btn-primary" onclick="slSaveApplication()">Save Package</button>';
    if (appUrl) {
      h += '<button class="btn" onclick="slLaunchApplication()" style="background:var(--sage);color:white;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;">Launch Application</button>';
    }
    h += '</div>';
    h += '</div>';

    el.innerHTML = h;

    // Auto-highlight first field
    if (slCopyIdx < 0) slCopyIdx = 0;
  }

  function slCopyField(idx) {
    var reqs = slParsedRequirements || {};
    var fields = reqs.fields || [];
    var f = fields[idx];
    if (!f) return;
    var m = slFieldMapping[f.name] || {};
    var val = m.value || '';
    if (!val) return;

    navigator.clipboard.writeText(val).then(function() {
      slCopyIdx = idx + 1; // advance to next
      showToast('Copied: ' + f.name);
      // Re-render to update visual state
      var show = slShows[slCurrentShowId] || {};
      renderApplyPreview(document.getElementById('slApplyContent'), show);
      // Scroll next field into view
      var nextEl = document.getElementById('slField_' + (idx + 1));
      if (nextEl) nextEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }).catch(function() {
      showToast('Copy failed — use manual selection', true);
    });
  }

  function slLaunchApplication() {
    var show = slShows[slCurrentShowId] || {};
    var url = show.applicationUrl || '';
    if (!url) { showToast('No application URL set for this show.', true); return; }

    // Copy first uncompleted field before launching
    var reqs = slParsedRequirements || {};
    var fields = reqs.fields || [];
    var firstIdx = Math.max(0, slCopyIdx);
    var f = fields[firstIdx];
    if (f) {
      var m = slFieldMapping[f.name] || {};
      if (m.value) {
        navigator.clipboard.writeText(m.value).then(function() {
          slCopyIdx = firstIdx + 1;
          showToast('Copied "' + f.name + '" — paste it in the application');
          var show2 = slShows[slCurrentShowId] || {};
          renderApplyPreview(document.getElementById('slApplyContent'), show2);
        }).catch(function() {});
      }
    }
    window.open(url, '_blank');
  }

  async function slDownloadPhoto(url, slotName) {
    try {
      showToast('Downloading...');
      var resp = await fetch(url);
      var blob = await resp.blob();
      var ext = blob.type.indexOf('png') >= 0 ? '.png' : '.jpg';
      var filename = slotName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + ext;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      showToast('Downloaded: ' + filename);
    } catch (err) {
      // Fallback: open in new tab for manual save
      window.open(url, '_blank');
      showToast('Opened in new tab — right-click to save');
    }
  }

  window.slCopyField = slCopyField;
  window.slLaunchApplication = slLaunchApplication;
  window.slDownloadPhoto = slDownloadPhoto;

  async function slSaveApplication() {
    var show = slShows[slCurrentShowId] || {};
    var appData = {
      showId: slCurrentShowId,
      showName: show.name || '',
      parsedRequirements: slParsedRequirements,
      fieldMapping: slFieldMapping,
      gapAnalysis: slGapAnalysis,
      imageAssignments: slImageAssignments,
      status: 'draft',
      createdAt: slCurrentApplication ? slCurrentApplication.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      var key;
      if (slCurrentApplication && slCurrentApplication.id) {
        key = slCurrentApplication.id;
        await MastDB.showLight.applications.ref(key).update(appData);
      } else {
        key = MastDB.showLight.applications.newKey();
        await MastDB.showLight.applications.ref(key).set(appData);
      }
      slApplications[key] = appData;
      slCurrentApplication = Object.assign({ id: key }, appData);
      showToast('Application package saved.');

      slApplyStep = 0;
      slCurrentShowId = null;
      renderApply(document.getElementById('slContent'));
    } catch (err) {
      showToast('Save failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Window exports for onclick handlers
  // ============================================================

  window.slSwitchView = slSwitchView;
  window.slSaveProfile = slSaveProfile;
  window.slChangeBoothPhoto = slChangeBoothPhoto;
  window.slRemoveBoothPhoto = slRemoveBoothPhoto;
  window.slToggleAppPhoto = slToggleAppPhoto;
  window.slSetGalleryFilter = slSetGalleryFilter;
  window.slUploadToLibrary = slUploadToLibrary;
  window.slOpenAddShowModal = slOpenAddShowModal;
  window.slSaveNewShow = slSaveNewShow;
  window.slOpenEditShowModal = slOpenEditShowModal;
  window.slUpdateShow = slUpdateShow;
  window.slDeleteShow = slDeleteShow;
  window.slStartApply = slStartApply;
  window.slResumeApplication = slResumeApplication;
  window.slFetchAndParse = slFetchAndParse;
  window.slSaveMapping = slSaveMapping;
  window.slPickImageForSlot = slPickImageForSlot;
  window.slAssignImage = slAssignImage;
  window.slSaveApplication = slSaveApplication;
  window.slGoToStep = function(step) { slApplyStep = step; renderApplyBuilder(document.getElementById('slContent')); };
  window.slBackToShowSelect = function() { slApplyStep = 0; slCurrentShowId = null; renderApply(document.getElementById('slContent')); };

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('showLight', {
    routes: {
      'show-light-profile': { tab: 'showLightTab', setup: function() { slSubView = 'profile'; if (!slLoaded) loadShowLight(); else renderShowLight(); } },
      'show-light-gallery': { tab: 'showLightTab', setup: function() { slSubView = 'gallery'; if (!slLoaded) loadShowLight(); else renderShowLight(); } },
      'show-light-shows':   { tab: 'showLightTab', setup: function() { slSubView = 'shows'; if (!slLoaded) loadShowLight(); else renderShowLight(); } },
      'show-light-apply':   { tab: 'showLightTab', setup: function() { slSubView = 'apply'; if (!slLoaded) loadShowLight(); else renderShowLight(); } }
    }
  });

})();
