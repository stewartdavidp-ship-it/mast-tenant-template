/**
 * Homepage Module — Unified section editing + gallery image management
 * Replaces the core Gallery tab and Website > Sections tab
 */
(function() {
  'use strict';

  // --- State ---
  var loaded = false;
  var selectedSection = null;
  var galleryData = {};
  var galleryListener = null;
  var websiteConfig = null;
  var themeConfig = null;
  var templateManifest = null;
  var navSections = null;

  // --- Sync gallery data into the core shell's object without replacing the reference ---
  function syncToGlobal(data) {
    var g = window.gallery;
    // Clear existing keys
    Object.keys(g).forEach(function(k) { delete g[k]; });
    // Copy new data in
    Object.keys(data).forEach(function(k) { g[k] = data[k]; });
  }

  // --- Mark unpublished (shared with website module) ---
  function markUnpublished() {
    if (window.markUnpublished) return window.markUnpublished();
    // Fallback if website module not loaded yet
    MastDB.set('webPresence/config/updatedAt', new Date().toISOString());
  }

  // --- Debounce helper ---
  var debounceTimers = {};
  function debounce(key, fn, delay) {
    clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(fn, delay || 600);
  }

  // --- Section definitions (from website.js SECTION_DEFS) ---
  var SECTION_DEFS = [
    { key: 'hero', name: 'Hero', locked: true, fields: [
      { id: 'headline', label: 'Headline', type: 'text' },
      { id: 'subheadline', label: 'Subheadline', type: 'text' },
      { id: 'ctaText', label: 'Button Text', type: 'text' },
      { id: 'ctaUrl', label: 'Button URL', type: 'text' },
      { id: 'headlineSize', label: 'Headline Size', type: 'select', options: [{ v: 'small', l: 'Small' }, { v: 'medium', l: 'Medium (Default)' }, { v: 'large', l: 'Large' }, { v: 'xl', l: 'Extra Large' }] },
      { id: 'textAlign', label: 'Text Position', type: 'select', options: [{ v: 'left', l: 'Left' }, { v: 'center', l: 'Center (Default)' }, { v: 'right', l: 'Right' }] }
    ]},
    { key: 'gallery', name: 'Products / Gallery', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'columns', label: 'Columns', type: 'number' }
    ]},
    { key: 'about', name: 'About', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'body', label: 'Body Text', type: 'textarea' },
      { id: 'imageUrl', label: 'Image', type: 'image' }
    ]},
    { key: 'contact', name: 'Contact', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'email', label: 'Email', type: 'text' },
      { id: 'phone', label: 'Phone', type: 'text' },
      { id: 'address', label: 'Address', type: 'text' },
      { id: 'showForm', label: 'Show Contact Form', type: 'toggle' }
    ]},
    { key: 'newsletter', name: 'Newsletter', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'subheadline', label: 'Subheadline', type: 'text' },
      { id: 'buttonLabel', label: 'Button Label', type: 'text' }
    ]},
    { key: 'members', name: 'Members', fields: [
      { id: 'accessModel', label: 'Access Model', type: 'select', options: [{ v: 'passcode', l: 'Passcode' }, { v: 'email', l: 'Email List' }] },
      { id: 'passcode', label: 'Passcode', type: 'text' }
    ]}
  ];

  // --- Variant options ---
  var VARIANT_OPTIONS = {
    hero: [
      { id: 'full-bleed', label: 'Full Bleed', desc: 'Full-width background' },
      { id: 'split-image', label: 'Split Image', desc: 'Image + text side by side' },
      { id: 'minimal-text', label: 'Minimal Text', desc: 'Large text, subtle background' }
    ],
    gallery: [
      { id: 'grid', label: 'Grid', desc: 'Even columns' },
      { id: 'masonry', label: 'Masonry', desc: 'Pinterest-style' },
      { id: 'carousel', label: 'Carousel', desc: 'Swipeable row' }
    ],
    'product-grid': [
      { id: 'card', label: 'Card', desc: 'Standard product cards' },
      { id: 'compact', label: 'Compact', desc: 'Dense, small images' }
    ]
  };

  // --- Data loading ---
  async function loadData() {
    if (loaded) return;

    // Load gallery images
    galleryData = (await MastDB.gallery.list(500)) || {};

    // Load webPresence/config (section content fields)
    websiteConfig = (await MastDB.get('webPresence/config')) || {};

    // Load theme config — try shared data first, then load independently
    themeConfig = MastAdmin.getData('themeConfig');
    if (!themeConfig) {
      themeConfig = (await MastDB.get('public/config/theme')) || {};
    }

    // Load nav sections (enabled states)
    navSections = (await MastDB.get('public/config/nav/sections')) || {};

    // Load template manifest — try shared data first, then load independently
    templateManifest = MastAdmin.getData('templateManifest');
    if (!templateManifest) {
      var templateId = themeConfig.templateId || 'artisan';
      try {
        var tenantId = MastDB.tenantId();
        var siteUrl = 'https://mast-' + tenantId + '.web.app';
        var resp = await fetch(siteUrl + '/templates/' + templateId + '/manifest.json');
        if (resp.ok) templateManifest = await resp.json();
      } catch (e) {}
      if (!templateManifest) {
        try {
          var resp2 = await fetch('/templates/' + (themeConfig.templateId || 'artisan') + '/manifest.json');
          if (resp2.ok) templateManifest = await resp2.json();
        } catch (e2) {}
      }
    }

    // Sync gallery data into the core shell's gallery object (not replace it).
    // Core shell declares `var gallery = {}` which is also window.gallery.
    // Replacing window.gallery would break the local var reference.
    syncToGlobal(galleryData);

    loaded = true;
  }

  // --- Firebase listeners ---
  function startListeners() {
    if (!galleryListener) {
      galleryListener = MastDB.gallery.listen(500, function(snap) {
        galleryData = snap.val() || {};
        syncToGlobal(galleryData);
        autoReindexIfNeeded();
        if (window.currentRoute === 'homepage') renderHomepage();
      }, function(err) {
        showToast('Error loading gallery: ' + err.message, true);
      });
    }
  }

  function stopListeners() {
    if (galleryListener) {
      MastDB.gallery.unlisten(galleryListener);
      galleryListener = null;
    }
  }

  // --- Section list helpers ---
  function getSectionList() {
    var sections = [];

    if (templateManifest && templateManifest.slots) {
      var categories = ['universal', 'common', 'differentiators'];
      categories.forEach(function(cat) {
        var slots = templateManifest.slots[cat];
        if (!slots) return;
        slots.forEach(function(slot) {
          sections.push({
            id: slot.id,
            label: slot.label || slot.id,
            description: slot.description || '',
            required: slot.required || false,
            prominent: slot.prominent || false,
            category: cat
          });
        });
      });
    }

    // Fallback: use SECTION_DEFS if no manifest
    if (sections.length === 0) {
      SECTION_DEFS.forEach(function(def) {
        sections.push({
          id: def.key,
          label: def.name,
          description: '',
          required: def.locked || false,
          prominent: false,
          category: 'common'
        });
      });
    }

    return sections;
  }

  function getSectionById(sectionId) {
    var list = getSectionList();
    return list.find(function(s) { return s.id === sectionId; }) || null;
  }

  function countGalleryImages(sectionId) {
    return Object.values(galleryData).filter(function(g) {
      return g.section === sectionId && !g.templateHidden;
    }).length;
  }

  function getImagesForSection(sectionId) {
    return Object.entries(galleryData)
      .filter(function(entry) { return entry[1].section === sectionId && !entry[1].templateHidden; })
      .sort(function(a, b) { return (a[1].order || 0) - (b[1].order || 0); });
  }

  // Sections whose gallery images are rendered on the storefront
  var IMAGE_CAPABLE_SECTIONS = ['hero', 'gallery', 'about', 'our-story', 'shop', 'schedule'];

  function hasImageCapability(sectionId) {
    // Only show image controls for sections the storefront actually renders gallery images for
    if (IMAGE_CAPABLE_SECTIONS.indexOf(sectionId) !== -1) return true;
    // Also include any product category sections (dynamic)
    if (typeof SHOP_SECTION_IDS !== 'undefined' && SHOP_SECTION_IDS.indexOf(sectionId) !== -1) return true;
    return false;
  }

  // --- Main render ---
  window.renderHomepage = async function renderHomepage() {
    var root = document.getElementById('homepageModuleRoot');
    if (!root) return;

    if (!loaded) {
      root.innerHTML = '<div class="loading">Loading page builder...</div>';
      await loadData();
    }

    var html = '<div class="section-header"><h2>Page Builder</h2></div>';

    // Top: Section Cards
    html += renderSectionCards();

    // Bottom: Edit View (selected section details)
    html += '<div class="hp-edit-view" style="margin-top:12px;">';
    html += renderEditView();
    html += '</div>';

    root.innerHTML = html;

    // Post-render: load hero rotation speed if hero is selected
    if (selectedSection === 'hero' && typeof loadHeroRotationSpeed === 'function') {
      loadHeroRotationSpeed();
    }
  }

  // --- Section cards (bottom panel) ---
  function renderSectionCards() {
    var sections = getSectionList();
    var html = '<div class="hp-cards-row">';

    sections.forEach(function(sec) {
      var isSelected = selectedSection === sec.id;
      var navData = (navSections && navSections[sec.id]) || {};
      var wpData = (websiteConfig && websiteConfig.sections && websiteConfig.sections[sec.id]) || {};
      var enabled = sec.required ? true : (navData.enabled !== false && wpData.enabled !== false);
      var imageCount = countGalleryImages(sec.id);

      html += '<div class="hp-card' + (isSelected ? ' selected' : '') + (!enabled ? ' disabled' : '') + '" onclick="hpSelectSection(\'' + sec.id + '\')">';
      html += '<div class="hp-card-header">';
      html += '<span class="hp-card-name">' + esc(sec.label) + '</span>';
      if (imageCount > 0) {
        html += '<span class="hp-card-badge">' + imageCount + '</span>';
      }
      html += '</div>';
      // Toggle
      if (!sec.required) {
        html += '<label class="toggle-switch hp-card-toggle" onclick="event.stopPropagation();">';
        html += '<input type="checkbox"' + (enabled ? ' checked' : '') + ' onchange="hpToggleSection(\'' + sec.id + '\', this.checked)">';
        html += '<span class="toggle-slider"></span>';
        html += '</label>';
      }
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  // --- Edit view (top panel) ---
  function renderEditView() {
    if (!selectedSection) {
      return '<div class="hp-edit-empty"><p>Select a section below to edit its content and images.</p></div>';
    }

    var sec = getSectionById(selectedSection);
    if (!sec) return '';

    var html = '';

    // Header with section name + variant picker
    html += '<div class="hp-edit-header">';
    html += '<h3>' + esc(sec.label) + '</h3>';
    var variantHtml = renderVariantPicker(sec.id);
    if (variantHtml) html += '<div style="display:flex;align-items:center;gap:4px;">' + variantHtml + '</div>';
    html += '</div>';

    // Section content fields
    html += '<div class="hp-edit-fields">';
    html += renderSectionFields(sec.id);
    html += '</div>';

    // Gallery images for this section
    var sectionImages = getImagesForSection(sec.id);
    if (sectionImages.length > 0 || hasImageCapability(sec.id)) {
      html += '<div class="hp-edit-gallery">';
      html += '<div class="hp-gallery-header">';
      html += '<h4>Images (' + sectionImages.length + ')</h4>';
      html += '<div style="display:flex;gap:8px;align-items:center;">';
      if (sec.id === 'hero') {
        html += '<select id="heroRotationSpeed" onchange="saveHeroRotationSpeed(this.value)" style="font-size:0.78rem;padding:3px 8px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-card);color:var(--text-primary);cursor:pointer;" title="Image rotation speed">' +
          '<option value="3">3s</option><option value="4">4s</option><option value="5">5s</option><option value="6" selected>6s</option><option value="8">8s</option><option value="10">10s</option><option value="15">15s</option><option value="20">20s</option>' +
          '</select>';
      }
      html += '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 12px;" onclick="hpAddImage(\'' + sec.id + '\')">+ Add from Library</button>';
      html += '</div>';
      html += '</div>';
      html += renderSectionImageGrid(sec.id, sectionImages);
      html += '</div>';
    }

    return html;
  }

  // --- Variant picker ---
  function renderVariantPicker(sectionId) {
    var options = VARIANT_OPTIONS[sectionId];
    if (!options) return '';

    var tc = themeConfig || {};
    var m = templateManifest || {};
    var variantKey = sectionId === 'product-grid' ? 'productGridVariant' : sectionId + 'Variant';
    var currentVariant = tc[variantKey] || m[variantKey] || options[0].id;
    var defaultVariant = m[variantKey] || options[0].id;

    var html = '<select onclick="event.stopPropagation();" onchange="hpUpdateThemeField(\'' + variantKey + '\', this.value)" style="font-size:0.78rem;padding:3px 6px;border-radius:6px;background:var(--charcoal-light, #333);color:var(--text-primary, #e0e0e0);border:1px solid var(--charcoal-light, #444);cursor:pointer;min-width:100px;">';
    options.forEach(function(opt) {
      var selected = currentVariant === opt.id ? ' selected' : '';
      html += '<option value="' + opt.id + '"' + selected + ' title="' + esc(opt.desc) + '">' + esc(opt.label) + '</option>';
    });
    html += '</select>';

    if (currentVariant !== defaultVariant) {
      html += '<span style="font-size:0.72rem;color:var(--warm-gray);margin-left:4px;" title="Template default: ' + esc(defaultVariant) + '">&#8226; customized</span>';
    }

    return html;
  }

  // --- Section fields ---
  function renderSectionFields(sectionId) {
    var matchingDef = SECTION_DEFS.find(function(d) { return d.key === sectionId; });
    if (!matchingDef || !matchingDef.fields) return '';

    var sectionData = (websiteConfig && websiteConfig.sections && websiteConfig.sections[sectionId]) || {};
    var html = '';

    matchingDef.fields.forEach(function(field) {
      html += renderFieldInput(sectionId, field, sectionData);
    });

    if (sectionId === 'contact') {
      html += renderSocialLinks(sectionData.socialLinks || {});
    }

    return html;
  }

  function renderFieldInput(sectionKey, field, data) {
    var val = data[field.id] !== undefined ? data[field.id] : '';
    var inputId = 'hp-' + sectionKey + '-' + field.id;
    var html = '<div class="wp-field-group">';
    html += '<label for="' + inputId + '">' + esc(field.label) + '</label>';

    if (field.type === 'text') {
      html += '<input type="text" id="' + inputId + '" value="' + esc(String(val)) + '" oninput="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)">';
    } else if (field.type === 'textarea') {
      html += '<textarea id="' + inputId + '" oninput="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)">' + esc(String(val)) + '</textarea>';
    } else if (field.type === 'number') {
      html += '<input type="number" id="' + inputId + '" value="' + esc(String(val)) + '" oninput="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', parseInt(this.value) || 0)">';
    } else if (field.type === 'select') {
      html += '<select id="' + inputId + '" onchange="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)">';
      (field.options || []).forEach(function(opt) {
        html += '<option value="' + opt.v + '"' + (String(val) === opt.v ? ' selected' : '') + '>' + esc(opt.l) + '</option>';
      });
      html += '</select>';
    } else if (field.type === 'toggle') {
      html += '<label class="toggle-switch"><input type="checkbox"' + (val ? ' checked' : '') + ' onchange="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.checked)"><span class="toggle-slider"></span></label>';
    } else if (field.type === 'image') {
      html += '<div style="display:flex;gap:8px;align-items:center;">';
      html += '<input type="text" id="' + inputId + '" value="' + esc(String(val)) + '" oninput="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)" style="flex:1;">';
      html += '<button class="btn btn-secondary" onclick="hpPickImage(\'' + sectionKey + '\', \'' + field.id + '\')">Browse</button>';
      html += '</div>';
      if (val) {
        html += '<img src="' + esc(String(val)) + '" style="max-width:200px;max-height:120px;border-radius:6px;margin-top:8px;" alt="">';
      }
    }
    html += '</div>';
    return html;
  }

  function renderSocialLinks(links) {
    var platforms = ['instagram', 'facebook', 'etsy', 'pinterest', 'tiktok', 'twitter', 'youtube'];
    var html = '<h4 style="font-size:0.9rem;margin:16px 0 8px;">Social Links</h4>';
    platforms.forEach(function(p) {
      html += '<div class="wp-field-group">';
      html += '<label>' + p.charAt(0).toUpperCase() + p.slice(1) + '</label>';
      html += '<input type="url" value="' + esc(links[p] || '') + '" oninput="hpUpdateSocial(\'' + p + '\', this.value)" placeholder="https://">';
      html += '</div>';
    });
    return html;
  }

  // --- Image grid for a section ---
  function renderSectionImageGrid(sectionId, items) {
    if (items.length === 0) {
      return '<div class="empty-state" style="padding:20px;"><p>No images yet. Click "+ Add from Library" to add one.</p></div>';
    }

    var html = '<div class="gallery-grid">';
    items.forEach(function(entry, idx) {
      var id = entry[0];
      var img = entry[1];
      var isFirst = idx === 0;
      var isLast = idx === items.length - 1;
      var isVidEntry = img.videoUrl || /\.(mp4|mov|webm)/i.test(img.url || '');

      html += '<div class="gallery-card">';
      if (isVidEntry) {
        html += '<div class="gallery-card-img" style="display:flex;align-items:center;justify-content:center;background:var(--charcoal);color:var(--amber);font-size:1.6rem;min-height:120px;">&#9654;</div>';
      } else if (img.url) {
        var fitStyle = img.imageFit ? ' style="object-fit:' + img.imageFit + ';"' : '';
        html += '<img class="gallery-card-img" src="' + esc(img.url) + '" alt="' + esc(img.alt || '') + '"' + fitStyle + ' onerror="this.classList.add(\'broken\')">';
      }
      html += '<div class="gallery-card-body">';
      html += '<div class="gallery-card-caption">' + esc(img.caption || img.alt || img.productName || '') + '</div>';
      html += '<div class="gallery-card-meta">';

      // Show relevant metadata per section
      if (typeof SHOP_SECTION_IDS !== 'undefined' && SHOP_SECTION_IDS.indexOf(sectionId) !== -1 && img.productName) {
        html += '<span class="category-badge">' + esc(img.productName) + '</span>';
        if (img.price) html += '<span class="category-badge" style="background:var(--teal);color:white;">' + esc(img.price) + '</span>';
      } else if (sectionId === 'gallery') {
        html += '<span class="category-badge">' + esc(img.category || 'other') + '</span>';
      } else if (sectionId === 'hero' && img.videoUrl) {
        html += '<span class="category-badge" style="font-size:0.72rem;">video + poster</span>';
      }

      html += '<span class="order-num">#' + (img.order || 0) + '</span>';
      html += '</div>';
      html += '<div class="gallery-card-actions">';

      if (items.length > 1) {
        html += '<button class="btn-icon" onclick="moveImage(\'' + id + '\', \'up\')" title="Move up"' + (isFirst ? ' disabled' : '') + '>\u2191</button>';
        html += '<button class="btn-icon" onclick="moveImage(\'' + id + '\', \'down\')" title="Move down"' + (isLast ? ' disabled' : '') + '>\u2193</button>';
      }

      html += '<button class="visibility-toggle' + (img.visible !== false ? '' : ' hidden') + '" onclick="toggleImageVisibility(\'' + id + '\')" title="Toggle visibility">' +
        (img.visible !== false ? '\u{1F441}' : '\u{1F6AB}') + '</button>';
      html += '<button class="btn-icon" onclick="openImageModal(\'' + id + '\')" title="Edit">\u270E</button>';
      html += '<button class="btn-icon danger" onclick="confirmDeleteImage(\'' + id + '\')" title="Delete">\u2716</button>';
      html += '</div></div></div>';
    });
    html += '</div>';

    // Template-hidden images notice for this section
    var hiddenCount = Object.values(galleryData).filter(function(g) {
      return g.section === sectionId && g.templateHidden;
    }).length;
    if (hiddenCount > 0) {
      html += '<div style="margin-top:8px;padding:8px 12px;background:color-mix(in srgb, var(--amber, var(--amber)) 10%, transparent);border:1px solid color-mix(in srgb, var(--amber, var(--amber)) 25%, transparent);border-radius:6px;font-size:0.78rem;color:var(--warm-gray);">';
      html += hiddenCount + ' image' + (hiddenCount !== 1 ? 's' : '') + ' hidden by template switch';
      html += '</div>';
    }

    return html;
  }

  // --- Window handlers ---
  window.hpSelectSection = function(sectionId) {
    selectedSection = sectionId;
    renderHomepage();
  };

  window.hpToggleSection = async function(sectionId, enabled) {
    try {
      await MastDB.set('public/config/nav/sections/' + sectionId + '/enabled', enabled);
      if (!navSections) navSections = {};
      if (!navSections[sectionId]) navSections[sectionId] = {};
      navSections[sectionId].enabled = enabled;

      if (!websiteConfig.sections) websiteConfig.sections = {};
      if (!websiteConfig.sections[sectionId]) websiteConfig.sections[sectionId] = {};
      websiteConfig.sections[sectionId].enabled = enabled;
      await MastDB.set('webPresence/config/sections/' + sectionId + '/enabled', enabled);
      markUnpublished();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
    renderHomepage();
  };

  window.hpUpdateField = function(sectionKey, fieldId, value) {
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections[sectionKey]) websiteConfig.sections[sectionKey] = {};
    websiteConfig.sections[sectionKey][fieldId] = value;
    debounce('hp-field-' + sectionKey + '-' + fieldId, function() {
      MastDB.set('webPresence/config/sections/' + sectionKey + '/' + fieldId, value);
      markUnpublished();
    });
  };

  window.hpUpdateThemeField = async function(field, value) {
    if (!themeConfig) themeConfig = {};
    themeConfig[field] = value;
    try {
      await MastDB.set('public/config/theme/' + field, value);
      markUnpublished();
      var labels = {
        heroVariant: 'Hero layout',
        galleryVariant: 'Gallery layout',
        productGridVariant: 'Product grid layout'
      };
      showToast((labels[field] || field) + ' updated.');
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
    renderHomepage();
  };

  window.hpUpdateSocial = function(platform, value) {
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.contact) websiteConfig.sections.contact = {};
    if (!websiteConfig.sections.contact.socialLinks) websiteConfig.sections.contact.socialLinks = {};
    websiteConfig.sections.contact.socialLinks[platform] = value;
    debounce('hp-social-' + platform, function() {
      MastDB.set('webPresence/config/sections/contact/socialLinks/' + platform, value);
      markUnpublished();
    });
  };

  window.hpAddImage = function(sectionId) {
    if (typeof openImagePicker === 'function') {
      openImagePicker(function(imgId, url, thumbUrl) {
        var libImg = (window.imageLibrary || {})[imgId] || {};
        setTimeout(function() { openGalleryMetadataModal(sectionId, url, imgId, libImg); }, 200);
      });
    } else {
      showToast('Image picker not available.', true);
    }
  };

  window.hpPickImage = function(sectionKey, fieldId) {
    if (typeof openImagePicker === 'function') {
      openImagePicker(function(imgId, url) {
        if (!websiteConfig.sections) websiteConfig.sections = {};
        if (!websiteConfig.sections[sectionKey]) websiteConfig.sections[sectionKey] = {};
        websiteConfig.sections[sectionKey][fieldId] = url;
        MastDB.set('webPresence/config/sections/' + sectionKey + '/' + fieldId, url);
        markUnpublished();
        renderHomepage();
      });
    } else {
      showToast('Image picker not available.', true);
    }
  };

  // --- Module Registration ---
  MastAdmin.registerModule('homepage', {
    routes: {
      'homepage': { tab: 'homepageTab', setup: function() { renderHomepage(); } }
    },
    attachListeners: function() { startListeners(); },
    detachListeners: function() { stopListeners(); }
  });

})();
