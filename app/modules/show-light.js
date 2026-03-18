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
  var slProfile = null;
  var slGalleryItems = {};
  var slShows = {};
  var slApplications = {};

  // Apply builder state
  var slCurrentShowId = null;
  var slCurrentApplication = null;
  var slApplyStep = 0; // 0=select, 1=fetch, 2=map, 3=gaps, 4=images, 5=preview
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

      var gallerySnap = await MastDB.showLight.gallery.get();
      slGalleryItems = gallerySnap.val() || {};

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
    h += '<div class="sl-sub-nav">';
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
    document.querySelectorAll('#showLightTab .sl-sub-nav .view-tab').forEach(function(btn) {
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

  function renderGallery(el) {
    var entries = Object.entries(slGalleryItems);
    entries.sort(function(a, b) { return (b[1].uploadedAt || '').localeCompare(a[1].uploadedAt || ''); });

    var h = '';
    h += '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Image Gallery (' + entries.length + ')</span>';
    h += '<div style="display:flex;gap:8px;">';
    h += '<button class="btn btn-sm" onclick="slUploadFromLibrary()" style="background:var(--sage);color:white;border:none;border-radius:6px;padding:4px 12px;cursor:pointer;">From Library</button>';
    h += '<button class="btn btn-primary btn-sm" onclick="slOpenUploadModal()">+ Upload</button>';
    h += '</div></div>';

    if (entries.length === 0) {
      h += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">';
      h += '<div style="font-size:2rem;margin-bottom:8px;">🖼</div>';
      h += '<div>No images yet. Upload photos of your work, booth setup, and process.</div>';
      h += '</div>';
    } else {
      h += '<div class="sl-gallery-grid">';
      entries.forEach(function(entry) {
        var id = entry[0];
        var img = entry[1];
        h += '<div class="sl-gallery-item" onclick="slViewGalleryImage(\'' + esc(id) + '\')">';
        h += '<img src="' + esc(img.url || img.thumbnailUrl || '') + '" alt="' + esc(img.productName || (img.tags ? img.tags[0] : '')) + '" loading="lazy">';
        if (img.category) h += '<span class="sl-gallery-badge">' + esc(img.category) + '</span>';
        if (img.productName) h += '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:white;font-size:0.65rem;padding:3px 6px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">' + esc(img.productName) + '</div>';
        h += '<button class="sl-gallery-delete" onclick="event.stopPropagation(); slDeleteGalleryImage(\'' + esc(id) + '\')">&times;</button>';
        h += '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    el.innerHTML = h;
  }

  function slOpenUploadModal() {
    var html =
      '<div class="modal-header">' +
        '<h3>Upload to Show Light Gallery</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<input type="file" id="slUploadFileInput" accept="image/*" onchange="slHandleUploadFile(this)" style="display:none;" multiple>' +
        '<div id="slDropZone" onclick="document.getElementById(\'slUploadFileInput\').click()" ' +
          'style="border:2px dashed #ccc;border-radius:8px;padding:30px 20px;text-align:center;cursor:pointer;background:var(--cream);transition:border-color 0.2s;">' +
          '<div style="font-size:2rem;margin-bottom:8px;">📸</div>' +
          '<div style="color:var(--warm-gray);font-size:0.9rem;">Click to select images</div>' +
          '<div id="slUploadNames" style="color:var(--amber);font-size:0.85rem;margin-top:8px;display:none;"></div>' +
        '</div>' +
        '<div id="slUploadPreview" style="margin-top:12px;"></div>' +
        '<div class="sl-form-group" style="margin-top:12px;">' +
          '<label>Category</label>' +
          '<select id="slUploadCategory">' +
            '<option value="">None</option>' +
            '<option value="product">Product</option>' +
            '<option value="booth">Booth Setup</option>' +
            '<option value="process">Process / At Work</option>' +
            '<option value="detail">Close-up / Detail</option>' +
            '<option value="lifestyle">Lifestyle</option>' +
            '<option value="headshot">Headshot / Portrait</option>' +
          '</select>' +
        '</div>' +
        '<div class="sl-form-group"><label>Product Name</label>' +
          '<input type="text" id="slUploadProductName" placeholder="e.g. Spiral Drinking Glass"></div>' +
        '<div class="sl-form-group"><label>Product Description</label>' +
          '<textarea id="slUploadProductDesc" rows="2" placeholder="Brief description of the item shown..."></textarea></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          '<div class="sl-form-group"><label>Price</label>' +
            '<input type="text" id="slUploadPrice" placeholder="e.g. $45"></div>' +
          '<div class="sl-form-group"><label>Materials</label>' +
            '<input type="text" id="slUploadMaterials" placeholder="e.g. borosilicate glass"></div>' +
        '</div>' +
        '<div class="sl-form-group">' +
          '<label>Tags (comma-separated)</label>' +
          '<input type="text" id="slUploadTags" placeholder="e.g. cups, blue, functional">' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" id="slUploadBtn" onclick="slDoUpload()" disabled>Upload</button>' +
      '</div>';

    openModal(html);
  }

  var _slPendingFiles = [];

  function slHandleUploadFile(input) {
    _slPendingFiles = Array.from(input.files || []);
    var nameEl = document.getElementById('slUploadNames');
    if (nameEl && _slPendingFiles.length > 0) {
      nameEl.textContent = _slPendingFiles.map(function(f) { return f.name; }).join(', ');
      nameEl.style.display = '';
    }
    var btn = document.getElementById('slUploadBtn');
    if (btn) btn.disabled = _slPendingFiles.length === 0;

    if (_slPendingFiles.length > 0) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var prev = document.getElementById('slUploadPreview');
        if (prev) prev.innerHTML = '<img src="' + e.target.result + '" style="max-width:100%;max-height:200px;border-radius:8px;">';
      };
      reader.readAsDataURL(_slPendingFiles[0]);
    }
  }

  async function slDoUpload() {
    if (_slPendingFiles.length === 0) return;
    var btn = document.getElementById('slUploadBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }

    var category = (document.getElementById('slUploadCategory') || {}).value || '';
    var tags = ((document.getElementById('slUploadTags') || {}).value || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    var productName = (document.getElementById('slUploadProductName') || {}).value || '';
    var productDescription = (document.getElementById('slUploadProductDesc') || {}).value || '';
    var price = (document.getElementById('slUploadPrice') || {}).value || '';
    var materials = (document.getElementById('slUploadMaterials') || {}).value || '';

    try {
      var token = await auth.currentUser.getIdToken();
      for (var i = 0; i < _slPendingFiles.length; i++) {
        var file = _slPendingFiles[i];
        if (file.size > 10 * 1024 * 1024) { showToast(file.name + ' too large (max 10MB).', true); continue; }

        var compressed = await compressImage(file, 1600, 0.85);

        var resp = await callCF('/uploadImage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ image: compressed.base64, tags: tags, source: 'show-light-gallery' })
        });
        var result = await resp.json();
        if (!result.success) { showToast('Upload failed: ' + (result.error || 'unknown'), true); continue; }

        var key = MastDB.showLight.gallery.newKey();
        await MastDB.showLight.gallery.ref(key).set({
          url: result.url || '',
          thumbnailUrl: result.thumbnailUrl || result.url || '',
          category: category,
          tags: tags,
          productName: productName,
          productDescription: productDescription,
          price: price,
          materials: materials,
          width: compressed.width,
          height: compressed.height,
          aiSuggestions: null,
          uploadedAt: new Date().toISOString()
        });
        slGalleryItems[key] = { url: result.url, thumbnailUrl: result.thumbnailUrl || result.url, category: category, tags: tags, productName: productName, productDescription: productDescription, price: price, materials: materials, width: compressed.width, height: compressed.height, uploadedAt: new Date().toISOString() };
      }

      showToast(_slPendingFiles.length + ' image(s) uploaded.');
      _slPendingFiles = [];
      closeModal();
      renderGallery(document.getElementById('slContent'));
    } catch (err) {
      showToast('Upload error: ' + err.message, true);
      if (btn) { btn.disabled = false; btn.textContent = 'Upload'; }
    }
  }

  function slUploadFromLibrary() {
    openImagePicker(function(selected) {
      if (!selected || selected.length === 0) return;
      var items = Array.isArray(selected) ? selected : [selected];
      items.forEach(function(imgId) {
        var libImg = imageLibrary[imgId];
        if (!libImg) return;
        var key = MastDB.showLight.gallery.newKey();
        var entry = {
          url: libImg.url || '',
          thumbnailUrl: libImg.thumbnailUrl || libImg.url || '',
          category: '',
          tags: libImg.tags || [],
          productName: '',
          productDescription: '',
          price: '',
          materials: '',
          width: libImg.width || null,
          height: libImg.height || null,
          aiSuggestions: null,
          sourceImageId: imgId,
          uploadedAt: new Date().toISOString()
        };
        MastDB.showLight.gallery.ref(key).set(entry);
        slGalleryItems[key] = entry;
      });
      showToast(items.length + ' image(s) added from library.');
      renderGallery(document.getElementById('slContent'));
    }, { multi: true });
  }

  function slViewGalleryImage(id) {
    var img = slGalleryItems[id];
    if (!img) return;

    var html =
      '<div class="modal-header">' +
        '<h3>Gallery Image</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div style="text-align:center;margin-bottom:16px;"><img src="' + esc(img.url || '') + '" style="max-width:100%;max-height:300px;border-radius:8px;"></div>' +
        '<div class="sl-form-group"><label>Category</label>' +
          '<select id="slEditCat">' +
            '<option value=""' + (!img.category ? ' selected' : '') + '>None</option>' +
            '<option value="product"' + (img.category === 'product' ? ' selected' : '') + '>Product</option>' +
            '<option value="booth"' + (img.category === 'booth' ? ' selected' : '') + '>Booth Setup</option>' +
            '<option value="process"' + (img.category === 'process' ? ' selected' : '') + '>Process / At Work</option>' +
            '<option value="detail"' + (img.category === 'detail' ? ' selected' : '') + '>Close-up / Detail</option>' +
            '<option value="lifestyle"' + (img.category === 'lifestyle' ? ' selected' : '') + '>Lifestyle</option>' +
            '<option value="headshot"' + (img.category === 'headshot' ? ' selected' : '') + '>Headshot / Portrait</option>' +
          '</select></div>' +
        '<div class="sl-form-group"><label>Product Name</label>' +
          '<input type="text" id="slEditProductName" value="' + esc(img.productName || '') + '" placeholder="Name of the product shown"></div>' +
        '<div class="sl-form-group"><label>Product Description</label>' +
          '<textarea id="slEditProductDesc" rows="2" placeholder="Brief description...">' + esc(img.productDescription || '') + '</textarea></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          '<div class="sl-form-group"><label>Price</label><input type="text" id="slEditPrice" value="' + esc(img.price || '') + '" placeholder="e.g. $45"></div>' +
          '<div class="sl-form-group"><label>Materials</label><input type="text" id="slEditMaterials" value="' + esc(img.materials || '') + '" placeholder="e.g. glass"></div>' +
        '</div>' +
        '<div class="sl-form-group"><label>Tags</label>' +
          '<input type="text" id="slEditTags" value="' + esc((img.tags || []).join(', ')) + '" placeholder="comma-separated"></div>' +
        (img.width ? '<div style="font-size:0.8rem;color:var(--warm-gray);">' + img.width + ' x ' + img.height + '</div>' : '') +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn" onclick="slDeleteGalleryImage(\'' + esc(id) + '\'); closeModal();" style="background:var(--danger);color:white;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;">Delete</button>' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="slUpdateGalleryImage(\'' + esc(id) + '\'); closeModal();">Save</button>' +
      '</div>';

    openModal(html);
  }

  async function slUpdateGalleryImage(id) {
    var updates = {
      category: (document.getElementById('slEditCat') || {}).value || '',
      productName: (document.getElementById('slEditProductName') || {}).value || '',
      productDescription: (document.getElementById('slEditProductDesc') || {}).value || '',
      price: (document.getElementById('slEditPrice') || {}).value || '',
      materials: (document.getElementById('slEditMaterials') || {}).value || '',
      tags: ((document.getElementById('slEditTags') || {}).value || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean)
    };
    try {
      await MastDB.showLight.gallery.ref(id).update(updates);
      if (slGalleryItems[id]) Object.assign(slGalleryItems[id], updates);
      showToast('Image updated.');
    } catch (err) {
      showToast('Update failed: ' + err.message, true);
    }
  }

  async function slDeleteGalleryImage(id) {
    if (!confirm('Delete this image from your Show Light gallery?')) return;
    try {
      await MastDB.showLight.gallery.ref(id).remove();
      delete slGalleryItems[id];
      showToast('Image removed.');
      renderGallery(document.getElementById('slContent'));
    } catch (err) {
      showToast('Delete failed: ' + err.message, true);
    }
  }

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
    h += '<button class="btn btn-primary btn-sm" onclick="slOpenAddShowModal()">+ Add Show</button>';
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
    if (!confirm('Delete this show?')) return;
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
    slApplyStep = slParsedRequirements ? (slFieldMapping ? (slImageAssignments && Object.keys(slImageAssignments).length > 0 ? 4 : 3) : 2) : 1;
    renderApply(document.getElementById('slContent'));
  }

  function renderApplyBuilder(el) {
    var show = slShows[slCurrentShowId] || {};
    var steps = ['Fetch & Parse', 'Auto-Map', 'Gap Analysis', 'Images', 'Preview'];
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
      case 2: renderApplyMap(contentEl, show); break;
      case 3: renderApplyGaps(contentEl, show); break;
      case 4: renderApplyImages(contentEl, show); break;
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
        h += '<div style="background:rgba(122,139,111,0.1);border-radius:8px;padding:16px;margin-bottom:16px;">';
        h += '<div style="font-weight:600;margin-bottom:8px;color:var(--sage);">✓ Requirements Parsed</div>';
        h += '<div style="font-size:0.85rem;">';
        h += '<div><strong>Fields:</strong> ' + (slParsedRequirements.fields || []).length + ' required fields</div>';
        h += '<div><strong>Photos:</strong> ' + (slParsedRequirements.photos || []).length + ' image requirements</div>';
        if (slParsedRequirements.fees) h += '<div><strong>Fees:</strong> ' + esc(slParsedRequirements.fees) + '</div>';
        if (slParsedRequirements.deadline) h += '<div><strong>Deadline:</strong> ' + esc(slParsedRequirements.deadline) + '</div>';
        h += '</div></div>';
        h += '<button class="btn btn-primary" onclick="slGoToStep(2);">Continue to Auto-Map →</button>';
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

  // --- Step 2: Auto-Map (with enriched profile fields + product desc from images) ---

  function renderApplyMap(el, show) {
    var reqs = slParsedRequirements || {};
    var fields = reqs.fields || [];
    var profile = slProfile || {};

    if (!slFieldMapping) {
      slFieldMapping = {};

      // Build product description from gallery images
      var productDescFromGallery = '';
      Object.values(slGalleryItems).forEach(function(img) {
        if (img.category === 'product' && img.productDescription) {
          productDescFromGallery += (img.productName ? img.productName + ': ' : '') + img.productDescription + '\n';
        }
      });
      productDescFromGallery = productDescFromGallery.trim();


      fields.forEach(function(f) {
        var name = (f.name || '').toLowerCase();
        var mapped = null;

        if (name.indexOf('business') >= 0 || name.indexOf('artist name') >= 0 || name.indexOf('company') >= 0) {
          mapped = { source: 'profile.name', value: profile.name || '', confidence: profile.name ? 'high' : 'none' };
        } else if (name.indexOf('bio') >= 0 || name.indexOf('statement') >= 0 || name.indexOf('about') >= 0) {
          mapped = { source: 'profile.bio', value: profile.bio || '', confidence: profile.bio ? 'high' : 'none' };
        } else if (name.indexOf('product') >= 0 || name.indexOf('description') >= 0 || name.indexOf('what you') >= 0) {
          // Product descriptions come from gallery images, not the profile
          mapped = { source: 'gallery images', value: productDescFromGallery, confidence: productDescFromGallery ? 'medium' : 'none' };
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
    h += '<button class="btn btn-secondary" onclick="slGoToStep(1);">← Back</button>';
    h += '<button class="btn btn-primary" onclick="slSaveMapping(); slGoToStep(3);">Continue to Gap Analysis →</button>';
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
    Object.values(slGalleryItems).forEach(function(img) {
      if (img.category) galleryByCategory[img.category] = (galleryByCategory[img.category] || 0) + 1;
    });

    // Check booth photo from profile
    var hasBoothPhoto = !!(slProfile && slProfile.boothPhotoUrl) || !!galleryByCategory.booth;

    photos.forEach(function(p) {
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
    h += '<button class="btn btn-secondary" onclick="slGoToStep(2);">← Back</button>';
    h += '<button class="btn btn-primary" onclick="slGoToStep(4);">Continue to Images →</button>';
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
          assignedImg = slGalleryItems[assigned];
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

    h += '<div style="display:flex;gap:8px;margin-top:16px;">';
    h += '<button class="btn btn-secondary" onclick="slGoToStep(3);">← Back</button>';
    h += '<button class="btn btn-primary" onclick="slGoToStep(5);">Preview Package →</button>';
    h += '</div>';
    h += '</div>';

    el.innerHTML = h;
  }

  function slPickImageForSlot(slotIdx) {
    var entries = Object.entries(slGalleryItems);
    if (entries.length === 0) {
      showToast('No images in gallery. Upload some first.', true);
      return;
    }

    var html =
      '<div class="modal-header">' +
        '<h3>Select Image</h3>' +
        '<button class="modal-close" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="sl-gallery-grid">';

    entries.forEach(function(entry) {
      var id = entry[0];
      var img = entry[1];
      html += '<div class="sl-gallery-item" onclick="slAssignImage(' + slotIdx + ', \'' + esc(id) + '\'); closeModal();" style="cursor:pointer;">';
      html += '<img src="' + esc(img.url || img.thumbnailUrl || '') + '" alt="" loading="lazy">';
      if (img.category) html += '<span class="sl-gallery-badge">' + esc(img.category) + '</span>';
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
    } else {
      delete slImageAssignments[slotIdx];
    }
    renderApplyImages(document.getElementById('slApplyContent'), slShows[slCurrentShowId] || {});
  }

  // --- Step 5: Preview & Save ---

  function renderApplyPreview(el, show) {
    var reqs = slParsedRequirements || {};
    var fields = reqs.fields || [];
    var photos = reqs.photos || [];
    var profile = slProfile || {};

    var h = '<div class="sl-card">';
    h += '<div class="sl-card-header"><span class="sl-card-title">Step 5: Application Package Preview</span></div>';

    h += '<div style="background:var(--charcoal, #2A2A2A);color:white;padding:16px;border-radius:8px;margin-bottom:16px;">';
    h += '<div style="font-family:\'Cormorant Garamond\', serif;font-size:1.3rem;font-weight:600;">' + esc(show.name || 'Show') + '</div>';
    if (show.date) h += '<div style="font-size:0.85rem;opacity:0.8;">' + esc(show.date) + '</div>';
    h += '</div>';

    h += '<div style="margin-bottom:20px;">';
    h += '<div style="font-weight:600;margin-bottom:8px;font-size:0.9rem;">Application Fields</div>';
    fields.forEach(function(f) {
      var m = slFieldMapping[f.name] || {};
      h += '<div style="margin-bottom:8px;">';
      h += '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">' + esc(f.name) + '</div>';
      h += '<div style="font-size:0.9rem;">' + (m.value ? esc(m.value) : '<span style="color:var(--danger);">Missing</span>') + '</div>';
      h += '</div>';
    });
    h += '</div>';

    if (photos.length > 0) {
      h += '<div style="margin-bottom:20px;">';
      h += '<div style="font-weight:600;margin-bottom:8px;font-size:0.9rem;">Images</div>';
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(120px, 1fr));gap:8px;">';
      photos.forEach(function(p, idx) {
        var assigned = slImageAssignments[idx];
        var img = null;
        if (assigned === '__profile_booth__') {
          img = { url: profile.boothPhotoUrl };
        } else if (assigned) {
          img = slGalleryItems[assigned];
        }
        h += '<div style="text-align:center;">';
        if (img) {
          h += '<img src="' + esc(img.url || '') + '" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;">';
        } else {
          h += '<div style="width:100%;aspect-ratio:1;background:var(--cream-dark);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--warm-gray);">—</div>';
        }
        h += '<div style="font-size:0.7rem;color:var(--warm-gray);margin-top:4px;">' + esc(p.slot || 'Photo ' + (idx + 1)) + '</div>';
        h += '</div>';
      });
      h += '</div></div>';
    }

    if (reqs.specialRequirements && reqs.specialRequirements.length > 0) {
      h += '<div style="margin-bottom:16px;">';
      h += '<div style="font-weight:600;margin-bottom:8px;font-size:0.9rem;">Special Requirements</div>';
      reqs.specialRequirements.forEach(function(r) {
        h += '<div style="font-size:0.85rem;padding:4px 0;">• ' + esc(r) + '</div>';
      });
      h += '</div>';
    }

    h += '<div style="display:flex;gap:8px;margin-top:16px;">';
    h += '<button class="btn btn-secondary" onclick="slGoToStep(4);">← Back</button>';
    h += '<button class="btn btn-primary" onclick="slSaveApplication()">Save Application Package</button>';
    h += '</div>';
    h += '</div>';

    el.innerHTML = h;
  }

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
  window.slOpenUploadModal = slOpenUploadModal;
  window.slHandleUploadFile = slHandleUploadFile;
  window.slDoUpload = slDoUpload;
  window.slUploadFromLibrary = slUploadFromLibrary;
  window.slViewGalleryImage = slViewGalleryImage;
  window.slUpdateGalleryImage = slUpdateGalleryImage;
  window.slDeleteGalleryImage = slDeleteGalleryImage;
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
