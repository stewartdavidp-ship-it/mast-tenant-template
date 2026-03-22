(function() {
  'use strict';

  var websiteLoaded = false;
  var websiteConfig = null;
  var themeConfig = null; // public/config/theme — templateId, colorSchemeId, fontPair, colors
  var templateManifest = null; // loaded from templates/{templateId}/manifest.json
  var importJobs = null;
  var importedProducts = null;
  var tenantCategories = null; // array of { id, label, wholesaleGroup? }
  var currentSubTab = 'overview';
  var importReviewTab = 'products';
  var importJobsListener = null;
  var cherryPickSelections = {}; // jobId -> { products: {url: bool}, images: {url: bool}, ... }
  var expandedJobId = null; // for import history detail view
  var editingCategoryIdx = null; // index of category being edited inline
  var showCustomColors = false; // toggled when user picks "Custom" in color scheme
  var allTemplateManifests = null; // array of loaded manifests from registry
  var pendingSwitchTemplateId = null; // template ID pending confirmation
  var previewTemplateId = null; // template ID currently being previewed in iframe
  var previewViewport = 'desktop'; // desktop, tablet, mobile

  // ── Fallback style/font/section defs (used when no manifest loaded) ──
  var STYLE_DEFS = [
    { id: 'artisan-warm', name: 'Artisan Warm', icon: '&#127798;', desc: 'Earthy tones, handcrafted feel', font: 'playfair-lato' },
    { id: 'studio-dark', name: 'Studio Dark', icon: '&#127769;', desc: 'Bold contrast, modern gallery', font: 'inter-inter' },
    { id: 'market-fresh', name: 'Market Fresh', icon: '&#127793;', desc: 'Bright, colorful, energetic', font: 'poppins-roboto' },
    { id: 'clean-commerce', name: 'Clean Commerce', icon: '&#128722;', desc: 'Minimal, product-focused', font: 'raleway-opensans' },
    { id: 'story-first', name: 'Story First', icon: '&#128214;', desc: 'Editorial, narrative flow', font: 'merriweather-sourcesans' },
    { id: 'minimal-pro', name: 'Minimal Pro', icon: '&#9679;', desc: 'Ultra-clean, monochrome', font: 'cormorant-montserrat' }
  ];

  var FONT_PAIR_OPTIONS = [
    { value: 'playfair-lato', label: 'Playfair Display + Lato' },
    { value: 'inter-inter', label: 'Inter' },
    { value: 'cormorant-montserrat', label: 'Cormorant Garamond + Montserrat' },
    { value: 'raleway-opensans', label: 'Raleway + Open Sans' },
    { value: 'merriweather-sourcesans', label: 'Merriweather + Source Sans' },
    { value: 'poppins-roboto', label: 'Poppins + Roboto' }
  ];

  var SECTION_DEFS = [
    { key: 'hero', name: 'Hero', locked: true, fields: [
      { id: 'headline', label: 'Headline', type: 'text' },
      { id: 'subheadline', label: 'Subheadline', type: 'text' },
      { id: 'ctaText', label: 'Button Text', type: 'text' },
      { id: 'ctaUrl', label: 'Button URL', type: 'text' },
      { id: 'backgroundType', label: 'Background', type: 'select', options: [{ v: 'color', l: 'Color' }, { v: 'image', l: 'Image' }] },
      { id: 'backgroundAsset', label: 'Background Image URL', type: 'image' },
      { id: 'overlayOpacity', label: 'Overlay Opacity (%)', type: 'number' }
    ]},
    { key: 'gallery', name: 'Products / Gallery', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'layout', label: 'Layout', type: 'select', options: [{ v: 'grid', l: 'Grid' }, { v: 'masonry', l: 'Masonry' }] },
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

  // ── Debounce helper ──
  var debounceTimers = {};
  function debounce(key, fn, delay) {
    clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(fn, delay || 600);
  }

  // ── Load config from RTDB ──
  async function loadWebsiteConfig() {
    try {
      var snap = await MastDB._ref('webPresence/config').once('value');
      websiteConfig = snap.val() || {};
    } catch (err) {
      console.warn('[Website] Failed to load config:', err.message);
      websiteConfig = {};
    }
  }

  async function loadImportJobs() {
    try {
      var snap = await MastDB._ref('webPresence/importJobs').orderByChild('createdAt').limitToLast(10).once('value');
      var raw = snap.val() || {};
      importJobs = Object.values(raw).sort(function(a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
    } catch (err) {
      console.warn('[Website] Failed to load import jobs:', err.message);
      importJobs = [];
    }
  }

  async function loadImportedProducts() {
    try {
      var snap = await MastDB._ref('public/products').once('value');
      var raw = snap.val() || {};
      importedProducts = Object.keys(raw).map(function(k) {
        var p = raw[k]; p.id = k; return p;
      }).filter(function(p) { return p.importedFrom; });
    } catch (err) {
      console.warn('[Website] Failed to load products:', err.message);
      importedProducts = [];
    }
  }

  async function loadCategories() {
    try {
      var snap = await MastDB._ref('public/config/categories').once('value');
      var raw = snap.val();
      tenantCategories = (raw && Array.isArray(raw)) ? raw.filter(function(c) { return c && c.id && c.label; }) : [];
    } catch (err) {
      console.warn('[Website] Failed to load categories:', err.message);
      tenantCategories = [];
    }
  }

  async function loadThemeConfig() {
    try {
      var snap = await MastDB._ref('public/config/theme').once('value');
      themeConfig = snap.val() || {};
    } catch (err) {
      console.warn('[Website] Failed to load theme config:', err.message);
      themeConfig = {};
    }
    // Also load nav section enabled states for section toggles
    try {
      var navSnap = await MastDB._ref('public/config/nav/sections').once('value');
      themeConfig._navSections = navSnap.val() || {};
    } catch (err) {
      themeConfig._navSections = {};
    }
  }

  async function loadTemplateManifest() {
    templateManifest = null;
    var templateId = themeConfig && themeConfig.templateId;
    if (!templateId) return;

    try {
      // Fetch manifest from deployed template files via the public site
      var tenantId = MastDB.tenantId();
      var siteUrl = 'https://mast-' + tenantId + '.web.app';
      var resp = await fetch(siteUrl + '/templates/' + templateId + '/manifest.json');
      if (resp.ok) {
        templateManifest = await resp.json();
      }
    } catch (err) {
      console.warn('[Website] Failed to load template manifest:', err.message);
    }

    // Fallback: try relative path (works in dev/local)
    if (!templateManifest) {
      try {
        var resp2 = await fetch('/templates/' + (themeConfig.templateId) + '/manifest.json');
        if (resp2.ok) {
          templateManifest = await resp2.json();
        }
      } catch (err2) {
        console.warn('[Website] Manifest fallback also failed:', err2.message);
      }
    }

    // Determine if custom colors are active (no colorSchemeId or colorSchemeId not in manifest)
    if (templateManifest && themeConfig) {
      if (!themeConfig.colorSchemeId) {
        showCustomColors = true;
      } else {
        var found = templateManifest.colorSchemes.some(function(s) { return s.id === themeConfig.colorSchemeId; });
        showCustomColors = !found;
      }
    }
  }

  async function loadTemplateRegistry() {
    allTemplateManifests = [];
    var tenantId = MastDB.tenantId();
    var siteUrl = 'https://mast-' + tenantId + '.web.app';

    // Load registry.json
    var registryIds = [];
    try {
      var resp = await fetch(siteUrl + '/templates/registry.json');
      if (resp.ok) registryIds = await resp.json();
    } catch (e) {}

    // Fallback to relative path
    if (!registryIds.length) {
      try {
        var resp2 = await fetch('/templates/registry.json');
        if (resp2.ok) registryIds = await resp2.json();
      } catch (e2) {}
    }

    if (!registryIds.length) return;

    // Load each manifest
    var promises = registryIds.map(function(tid) {
      return fetch(siteUrl + '/templates/' + tid + '/manifest.json')
        .then(function(r) { return r.ok ? r.json() : null; })
        .catch(function() {
          // Fallback to relative path
          return fetch('/templates/' + tid + '/manifest.json')
            .then(function(r2) { return r2.ok ? r2.json() : null; })
            .catch(function() { return null; });
        });
    });

    var results = await Promise.all(promises);
    allTemplateManifests = results.filter(function(m) { return m !== null; });
  }

  async function saveCategories() {
    try {
      await MastDB._ref('public/config/categories').set(tenantCategories);
      // Refresh admin CATEGORIES/SECTIONS/SHOP_SECTION_IDS if loadTenantCategories exists
      if (typeof loadTenantCategories === 'function') await loadTenantCategories();
      markUnpublished();
    } catch (err) {
      console.warn('[Website] Failed to save categories:', err.message);
      showToast('Failed to save categories: ' + err.message, true);
    }
  }

  function slugify(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function isSlugUnique(slug, excludeIdx) {
    return !tenantCategories.some(function(c, i) { return i !== excludeIdx && c.id === slug; });
  }

  function startImportJobsListener() {
    if (importJobsListener) return;
    try {
      var ref = MastDB._ref('webPresence/importJobs');
      importJobsListener = ref.on('value', function(snap) {
        var raw = snap.val() || {};
        importJobs = Object.values(raw).sort(function(a, b) {
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        });
        // Check if any active jobs → auto-refresh the UI
        var hasActive = importJobs.some(function(j) {
          return j.status === 'pending' || j.status === 'processing' || j.status === 'crawled' || j.status === 'importing';
        });
        if (currentSubTab === 'import') {
          renderWebsite();
        }
      });
    } catch (err) {
      console.warn('[Website] Failed to start import listener:', err.message);
    }
  }

  function stopImportJobsListener() {
    if (importJobsListener) {
      try { MastDB._ref('webPresence/importJobs').off('value', importJobsListener); } catch (e) {}
      importJobsListener = null;
    }
  }

  // ── Render the full module ──
  async function renderWebsite() {
    var root = document.getElementById('websiteModuleRoot');
    if (!root) return;

    if (!websiteLoaded) {
      root.innerHTML = '<div class="loading">Loading website settings...</div>';
      await loadWebsiteConfig();
      await loadThemeConfig();
      await loadTemplateManifest();
      await loadTemplateRegistry();
      await loadImportJobs();
      await loadImportedProducts();
      await loadCategories();
      startImportJobsListener();
      websiteLoaded = true;
    }

    var html = '<div class="section-header"><h2>Website</h2></div>';

    // Sub-tabs
    html += '<div class="view-tabs">';
    html += '<button class="view-tab' + (currentSubTab === 'overview' ? ' active' : '') + '" onclick="wpSwitchTab(\'overview\')">Overview</button>';
    html += '<button class="view-tab' + (currentSubTab === 'template' ? ' active' : '') + '" onclick="wpSwitchTab(\'template\')">Template</button>';
    html += '<button class="view-tab' + (currentSubTab === 'style' ? ' active' : '') + '" onclick="wpSwitchTab(\'style\')">Style</button>';
    html += '<button class="view-tab' + (currentSubTab === 'sections' ? ' active' : '') + '" onclick="wpSwitchTab(\'sections\')">Sections</button>';
    html += '<button class="view-tab' + (currentSubTab === 'categories' ? ' active' : '') + '" onclick="wpSwitchTab(\'categories\')">Categories</button>';
    html += '<button class="view-tab' + (currentSubTab === 'import' ? ' active' : '') + '" onclick="wpSwitchTab(\'import\')">Import</button>';
    html += '</div>';

    // Tab content
    html += '<div id="wpTabContent">';
    if (currentSubTab === 'overview') html += renderOverviewTab();
    else if (currentSubTab === 'template') html += renderTemplateTab();
    else if (currentSubTab === 'style') html += renderStyleTab();
    else if (currentSubTab === 'sections') html += renderSectionsTab();
    else if (currentSubTab === 'categories') html += renderCategoriesTab();
    else if (currentSubTab === 'import') html += renderImportTab();
    html += '</div>';

    root.innerHTML = html;
  }

  // ── Overview Tab ──
  function renderOverviewTab() {
    var tenantId = MastDB.tenantId();
    var siteUrl = 'https://mast-' + tenantId + '.web.app';
    var status = websiteConfig.status || 'draft';
    var publishedAt = websiteConfig.publishedAt;
    var styleName = 'Not configured';
    if (templateManifest) {
      styleName = templateManifest.name || 'Template';
      var tc = themeConfig || {};
      if (tc.colorSchemeId && templateManifest.colorSchemes) {
        var scheme = templateManifest.colorSchemes.find(function(s) { return s.id === tc.colorSchemeId; });
        if (scheme) styleName += ' — ' + scheme.name;
      }
    } else {
      STYLE_DEFS.forEach(function(s) {
        if (s.id === websiteConfig.style) styleName = s.name;
      });
    }

    var statusBadge = status === 'published'
      ? '<span style="color:var(--teal);font-weight:600;">Published</span>'
      : '<span style="color:var(--amber);font-weight:600;">Unpublished changes</span>';

    var html = '';
    html += '<div class="wp-overview-stat"><strong style="min-width:120px;">Status:</strong> ' + statusBadge + '</div>';
    html += '<div class="wp-overview-stat"><strong style="min-width:120px;">Site URL:</strong> <a href="' + esc(siteUrl) + '" target="_blank" rel="noopener" style="color:var(--teal);">' + esc(siteUrl) + '</a></div>';
    if (publishedAt) {
      html += '<div class="wp-overview-stat"><strong style="min-width:120px;">Last Published:</strong> ' + new Date(publishedAt).toLocaleString() + '</div>';
    }
    html += '<div class="wp-overview-stat"><strong style="min-width:120px;">Style:</strong> ' + esc(styleName) + '</div>';
    html += '<div style="margin-top:24px;">';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);">Theme and content changes are saved automatically and appear on your live site immediately.</p>';
    html += '</div>';

    return html;
  }

  // ── Template Tab ──
  function renderTemplateTab() {
    var html = '';
    var currentTemplateId = (themeConfig && themeConfig.templateId) || null;

    // Load gallery data for migration preview (async, cached)
    if (!window._wpGalleryCache && !window._wpGalleryLoading) {
      window._wpGalleryLoading = true;
      MastDB.gallery.list(500).then(function(snap) {
        window._wpGalleryCache = snap.val() || {};
        window._wpGalleryLoading = false;
        // Re-render if we're showing the switch dialog
        if (pendingSwitchTemplateId) renderWebsite();
      }).catch(function() {
        window._wpGalleryCache = {};
        window._wpGalleryLoading = false;
      });
    }

    if (!allTemplateManifests || !allTemplateManifests.length) {
      html += '<p style="color:var(--warm-gray);">No templates available. Deploy template manifests first.</p>';
      return html;
    }

    // If we're showing a switch confirmation dialog
    if (pendingSwitchTemplateId) {
      html += renderTemplateSwitchDialog();
      return html;
    }

    // If we're showing a preview iframe
    if (previewTemplateId) {
      html += renderTemplatePreview();
      return html;
    }

    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Choose a template to define your site\'s layout and homepage flow.</p>';

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">';

    allTemplateManifests.forEach(function(manifest) {
      var isActive = manifest.id === currentTemplateId;
      html += '<div class="wp-template-card' + (isActive ? ' active' : '') + '">';

      if (isActive) {
        html += '<span class="wp-tpl-badge">Active</span>';
      }

      // Feature badge
      var featureLabel = '';
      if (manifest.homepageFlow) {
        var firstFlow = manifest.homepageFlow[0] || '';
        if (firstFlow === 'hero' && manifest.homepageFlow[1] === 'about') featureLabel = 'Story-first';
        else if (firstFlow === 'hero' && (manifest.homepageFlow[1] === 'category-grid' || manifest.homepageFlow[1] === 'featured-products')) featureLabel = 'Product-first';
        else if (firstFlow === 'hero' && manifest.homepageFlow[1] === 'events') featureLabel = 'Experience-first';
      }
      if (featureLabel) {
        html += '<span class="wp-tpl-feature">' + esc(featureLabel) + '</span>';
      }

      html += '<div class="wp-tpl-name">' + esc(manifest.name) + '</div>';
      html += '<div class="wp-tpl-desc">' + esc(manifest.description) + '</div>';

      // Color scheme preview dots
      if (manifest.colorSchemes && manifest.colorSchemes.length) {
        html += '<div class="wp-tpl-colors">';
        manifest.colorSchemes.forEach(function(scheme) {
          var primary = (scheme.colors && scheme.colors.primaryColor) || '#C4853C';
          var accent = (scheme.colors && scheme.colors.accentColor) || '#2A7C6F';
          html += '<span class="wp-tpl-color-dot" title="' + esc(scheme.name) + '" style="background:linear-gradient(135deg, ' + esc(primary) + ' 50%, ' + esc(accent) + ' 50%);"></span>';
        });
        html += '</div>';
      }

      // Homepage flow preview
      if (manifest.homepageFlow && manifest.homepageFlow.length) {
        html += '<div class="wp-tpl-flow-preview">';
        manifest.homepageFlow.forEach(function(slot) {
          html += '<span class="wp-tpl-flow-chip">' + esc(slot) + '</span>';
        });
        html += '</div>';
      }

      // Action buttons
      html += '<div class="wp-tpl-actions">';
      html += '<button class="btn btn-outline btn-small" onclick="event.stopPropagation();wpPreviewTemplate(\'' + esc(manifest.id) + '\')">Preview</button>';
      if (!isActive) {
        html += '<button class="btn btn-primary btn-small" onclick="event.stopPropagation();wpSelectTemplate(\'' + esc(manifest.id) + '\')">Switch</button>';
      }
      html += '</div>';

      html += '</div>';
    });

    html += '</div>';

    return html;
  }

  function renderTemplatePreview() {
    var manifest = null;
    if (allTemplateManifests) {
      manifest = allTemplateManifests.find(function(m) { return m.id === previewTemplateId; });
    }
    var name = manifest ? manifest.name : previewTemplateId;

    // Build the preview URL
    var siteUrl = window.location.origin + '/?preview_template=' + encodeURIComponent(previewTemplateId);

    var viewportWidths = { desktop: '100%', tablet: '768px', mobile: '375px' };
    var viewportHeight = previewViewport === 'mobile' ? '812px' : '600px';
    var iframeWidth = viewportWidths[previewViewport];

    var html = '';
    html += '<div style="margin-bottom:12px;">';
    html += '<button class="detail-back" onclick="wpClosePreview()">← Back to Templates</button>';
    html += '</div>';

    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<h3 style="font-size:1.1rem;margin:0;">Preview: ' + esc(name) + '</h3>';
    html += '<div style="display:flex;gap:6px;">';
    ['desktop', 'tablet', 'mobile'].forEach(function(vp) {
      var icon = vp === 'desktop' ? '&#128187;' : vp === 'tablet' ? '&#128241;' : '&#128241;';
      var label = vp.charAt(0).toUpperCase() + vp.slice(1);
      html += '<button class="btn btn-small' + (previewViewport === vp ? ' btn-primary' : ' btn-secondary') + '" onclick="wpSetPreviewViewport(\'' + vp + '\')" title="' + label + '">' + label + '</button>';
    });
    html += '</div></div>';

    html += '<div style="background:var(--charcoal-light, #333);border-radius:8px;padding:12px;display:flex;justify-content:center;overflow:hidden;">';
    html += '<iframe src="' + esc(siteUrl) + '" style="width:' + iframeWidth + ';max-width:100%;height:' + viewportHeight + ';border:none;border-radius:6px;background:#fff;" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>';
    html += '</div>';

    return html;
  }

  function renderTemplateSwitchDialog() {
    var html = '';
    var currentTemplateId = (themeConfig && themeConfig.templateId) || null;
    var currentManifest = templateManifest;
    var newManifest = null;

    if (allTemplateManifests) {
      newManifest = allTemplateManifests.find(function(m) { return m.id === pendingSwitchTemplateId; });
    }

    if (!newManifest) {
      html += '<p style="color:var(--danger);">Template not found.</p>';
      html += '<button class="btn" onclick="wpCancelSwitch()">Back</button>';
      return html;
    }

    // Compute section compatibility using slotMapping
    var keepSections = [];
    var loseSections = [];
    var newSections = [];

    // Get all slot IDs from current manifest
    var currentSlotIds = [];
    if (currentManifest && currentManifest.slots) {
      ['universal', 'common', 'differentiators'].forEach(function(cat) {
        (currentManifest.slots[cat] || []).forEach(function(s) { currentSlotIds.push(s.id); });
      });
    }

    // Get all slot IDs from new manifest
    var newSlotIds = [];
    var newSlotLabels = {};
    if (newManifest.slots) {
      ['universal', 'common', 'differentiators'].forEach(function(cat) {
        (newManifest.slots[cat] || []).forEach(function(s) {
          newSlotIds.push(s.id);
          newSlotLabels[s.id] = s.label;
        });
      });
    }

    // Use slotMapping from NEW manifest to see what maps from current
    var newMapping = newManifest.slotMapping || {};
    var currentSlotLabels = {};
    if (currentManifest && currentManifest.slots) {
      ['universal', 'common', 'differentiators'].forEach(function(cat) {
        (currentManifest.slots[cat] || []).forEach(function(s) { currentSlotLabels[s.id] = s.label; });
      });
    }

    // Sections that map from current to new
    currentSlotIds.forEach(function(cid) {
      // Check if the new manifest's slotMapping maps this current ID to something
      var mappedTo = newMapping[cid];
      if (mappedTo !== undefined && mappedTo !== null) {
        keepSections.push({ from: currentSlotLabels[cid] || cid, to: newSlotLabels[mappedTo] || mappedTo });
      } else if (newSlotIds.indexOf(cid) >= 0) {
        // Same ID exists in new template
        keepSections.push({ from: currentSlotLabels[cid] || cid, to: newSlotLabels[cid] || cid });
      } else {
        loseSections.push(currentSlotLabels[cid] || cid);
      }
    });

    // Sections in new template that aren't mapped from current
    var mappedTargets = {};
    currentSlotIds.forEach(function(cid) {
      var target = newMapping[cid];
      if (target) mappedTargets[target] = true;
      if (newSlotIds.indexOf(cid) >= 0 && !target) mappedTargets[cid] = true;
    });
    newSlotIds.forEach(function(nid) {
      if (!mappedTargets[nid]) {
        newSections.push(newSlotLabels[nid] || nid);
      }
    });

    html += '<div class="wp-switch-dialog">';
    html += '<h3 style="font-size:1.1rem;margin-bottom:4px;">Switch to ' + esc(newManifest.name) + '?</h3>';
    html += '<p style="font-size:0.8rem;color:var(--warm-gray);margin-bottom:16px;">' + esc(newManifest.description) + '</p>';

    if (keepSections.length) {
      html += '<div class="wp-switch-section wp-switch-keep">';
      html += '<h4 style="color:var(--teal, #2A7C6F);">Sections you\'ll keep</h4>';
      html += '<ul>';
      keepSections.forEach(function(s) {
        var label = s.from === s.to ? s.from : s.from + ' &rarr; ' + s.to;
        html += '<li>' + label + '</li>';
      });
      html += '</ul></div>';
    }

    if (loseSections.length) {
      html += '<div class="wp-switch-section wp-switch-lose">';
      html += '<h4 style="color:var(--danger, #e74c3c);">Sections you\'ll lose</h4>';
      html += '<ul>';
      loseSections.forEach(function(s) { html += '<li>' + esc(s) + '</li>'; });
      html += '</ul></div>';
    }

    if (newSections.length) {
      html += '<div class="wp-switch-section wp-switch-new">';
      html += '<h4 style="color:var(--accent, var(--teal));">New sections</h4>';
      html += '<ul>';
      newSections.forEach(function(s) { html += '<li>' + esc(s) + '</li>'; });
      html += '</ul></div>';
    }

    // Gallery image migration preview
    var galleryMigration = computeGalleryMigration(window._wpGalleryCache || {}, newManifest, currentTemplateId);
    var totalImages = Object.keys(window._wpGalleryCache || {}).length;
    var activeImages = totalImages - (galleryMigration.hide.length + galleryMigration.restore.length);

    if (totalImages > 0 && (galleryMigration.hide.length > 0 || galleryMigration.restore.length > 0)) {
      html += '<div class="wp-switch-section" style="margin-top:12px;padding:10px 14px;background:color-mix(in srgb, var(--accent, #2A7C6F) 8%, transparent);border-radius:8px;">';
      html += '<h4 style="color:var(--accent, #2A7C6F);font-size:0.85rem;margin-bottom:6px;">Gallery Images</h4>';

      if (galleryMigration.migrate.length > 0) {
        html += '<div style="font-size:0.8rem;color:var(--warm-gray);margin-bottom:4px;">';
        html += '<span style="color:var(--teal, #2A7C6F);">' + galleryMigration.migrate.length + '</span> image' + (galleryMigration.migrate.length !== 1 ? 's' : '') + ' will carry over';
        html += '</div>';
      }

      if (galleryMigration.hide.length > 0) {
        // Group hidden images by section for a cleaner display
        var hiddenBySec = {};
        galleryMigration.hide.forEach(function(h) {
          var secLabel = h.section;
          SECTIONS.forEach(function(s) { if (s.id === h.section) secLabel = s.label; });
          hiddenBySec[secLabel] = (hiddenBySec[secLabel] || 0) + 1;
        });
        html += '<div style="font-size:0.8rem;color:var(--danger, #e74c3c);margin-bottom:4px;">';
        html += '<span style="font-weight:600;">' + galleryMigration.hide.length + '</span> image' + (galleryMigration.hide.length !== 1 ? 's' : '') + ' will be hidden (not deleted)';
        html += '<ul style="margin:4px 0 0 16px;list-style:disc;">';
        Object.keys(hiddenBySec).forEach(function(label) {
          html += '<li>' + esc(label) + ': ' + hiddenBySec[label] + '</li>';
        });
        html += '</ul></div>';
      }

      if (galleryMigration.restore.length > 0) {
        html += '<div style="font-size:0.8rem;color:var(--teal, #2A7C6F);margin-bottom:4px;">';
        html += '<span style="font-weight:600;">' + galleryMigration.restore.length + '</span> previously hidden image' + (galleryMigration.restore.length !== 1 ? 's' : '') + ' will be restored';
        html += '</div>';
      }

      html += '</div>';
    }

    html += '<div style="display:flex;gap:10px;margin-top:20px;">';
    html += '<button class="btn btn-primary" onclick="wpConfirmSwitch()">Switch Template</button>';
    html += '<button class="btn btn-secondary" onclick="wpCancelSwitch()">Cancel</button>';
    html += '</div>';

    html += '</div>';

    return html;
  }

  // ── Style Tab ──
  function renderStyleTab() {
    var html = '';

    // If we have a template manifest, use manifest-driven UI
    if (templateManifest) {
      html += renderManifestStyleTab();
    } else {
      html += renderFallbackStyleTab();
    }

    return html;
  }

  // ── Manifest-driven Style Tab (color schemes, font pairs from manifest) ──
  function renderManifestStyleTab() {
    var html = '';
    var tc = themeConfig || {};
    var currentSchemeId = tc.colorSchemeId || null;

    // Template name
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">';
    html += '<span style="font-size:0.85rem;color:var(--warm-gray);">Template:</span>';
    html += '<strong style="font-size:0.95rem;">' + esc(templateManifest.name || 'Unknown') + '</strong>';
    html += '</div>';

    // ── Color Schemes ──
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Color Scheme</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:8px;">';

    templateManifest.colorSchemes.forEach(function(scheme) {
      var isActive = !showCustomColors && currentSchemeId === scheme.id;
      var c = scheme.colors;
      html += '<div class="wp-scheme-card' + (isActive ? ' selected' : '') + '" onclick="wpSelectScheme(\'' + esc(scheme.id) + '\')" style="cursor:pointer;padding:12px;border-radius:10px;border:2px solid ' + (isActive ? 'var(--accent)' : 'var(--charcoal-light, #333)') + ';background:var(--charcoal, #1a1a1a);transition:border-color 0.2s;">';
      // Color circles row
      html += '<div style="display:flex;gap:6px;margin-bottom:8px;">';
      html += '<div style="width:28px;height:28px;border-radius:50%;background:' + esc(c.primaryColor) + ';border:2px solid rgba(255,255,255,0.15);" title="Primary"></div>';
      html += '<div style="width:28px;height:28px;border-radius:50%;background:' + esc(c.accentColor) + ';border:2px solid rgba(255,255,255,0.15);" title="Accent"></div>';
      html += '<div style="width:28px;height:28px;border-radius:50%;background:' + esc(c.bgColor) + ';border:2px solid rgba(255,255,255,0.15);" title="Background"></div>';
      html += '</div>';
      // Name
      html += '<strong style="font-size:0.85rem;">' + esc(scheme.name) + '</strong>';
      if (scheme.default) {
        html += '<span style="font-size:0.7rem;color:var(--warm-gray);margin-left:6px;">(default)</span>';
      }
      html += '</div>';
    });

    // Custom option card
    html += '<div class="wp-scheme-card' + (showCustomColors ? ' selected' : '') + '" onclick="wpSelectSchemeCustom()" style="cursor:pointer;padding:12px;border-radius:10px;border:2px solid ' + (showCustomColors ? 'var(--accent)' : 'var(--charcoal-light, #333)') + ';background:var(--charcoal, #1a1a1a);transition:border-color 0.2s;">';
    html += '<div style="display:flex;gap:6px;margin-bottom:8px;">';
    html += '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg, #ff6b6b, #4ecdc4, #45b7d1);border:2px solid rgba(255,255,255,0.15);"></div>';
    html += '</div>';
    html += '<strong style="font-size:0.85rem;">Custom</strong>';
    html += '<span style="font-size:0.7rem;color:var(--warm-gray);margin-left:6px;">Pick your own</span>';
    html += '</div>';

    html += '</div>';

    // Custom color pickers (shown only when Custom is selected)
    if (showCustomColors) {
      html += renderCustomColorPickers();
    }

    // ── Font Pairs ──
    var currentFontPair = tc.fontPair || 'classic';
    html += '<h3 style="font-size:1rem;margin:24px 0 12px;">Font Pair</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">';

    templateManifest.fontPairs.forEach(function(fp) {
      var isActive = currentFontPair === fp.id;
      html += '<div class="wp-font-card' + (isActive ? ' selected' : '') + '" onclick="wpSelectFontPair(\'' + esc(fp.id) + '\')" style="cursor:pointer;padding:14px;border-radius:10px;border:2px solid ' + (isActive ? 'var(--accent)' : 'var(--charcoal-light, #333)') + ';background:var(--charcoal, #1a1a1a);transition:border-color 0.2s;">';
      html += '<div style="font-family:\'' + esc(fp.heading) + '\', serif;font-size:1.1rem;font-weight:600;margin-bottom:4px;line-height:1.2;">' + esc(fp.name) + '</div>';
      html += '<div style="font-family:\'' + esc(fp.body) + '\', sans-serif;font-size:0.8rem;color:var(--warm-gray);line-height:1.4;">' + esc(fp.heading) + ' + ' + esc(fp.body) + '</div>';
      if (fp.default) {
        html += '<span style="font-size:0.7rem;color:var(--warm-gray);margin-top:4px;display:inline-block;">(default)</span>';
      }
      html += '</div>';
    });

    html += '</div>';

    return html;
  }

  function renderCustomColorPickers() {
    var tc = themeConfig || {};
    var primaryColor = tc.primaryColor || '#8B7355';
    var accentColor = tc.accentColor || '#2D5F5D';
    var html = '';
    html += '<div style="margin-top:12px;padding:16px;background:var(--charcoal, #1a1a1a);border-radius:10px;border:1px solid var(--charcoal-light, #333);">';
    html += '<div class="wp-color-row" style="margin-bottom:0;">';
    html += '<div class="wp-field-group" style="flex:1;">';
    html += '<label>Primary Color</label>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    html += '<input type="color" value="' + esc(primaryColor) + '" onchange="wpUpdateThemeColor(\'primaryColor\', this.value)" style="width:40px;height:40px;border:none;cursor:pointer;padding:0;">';
    html += '<input type="text" value="' + esc(primaryColor) + '" onchange="wpUpdateThemeColor(\'primaryColor\', this.value)" style="flex:1;" maxlength="7">';
    html += '</div></div>';
    html += '<div class="wp-field-group" style="flex:1;">';
    html += '<label>Accent Color</label>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    html += '<input type="color" value="' + esc(accentColor) + '" onchange="wpUpdateThemeColor(\'accentColor\', this.value)" style="width:40px;height:40px;border:none;cursor:pointer;padding:0;">';
    html += '<input type="text" value="' + esc(accentColor) + '" onchange="wpUpdateThemeColor(\'accentColor\', this.value)" style="flex:1;" maxlength="7">';
    html += '</div></div>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  // ── Fallback Style Tab (no manifest — original free-form UI) ──
  function renderFallbackStyleTab() {
    var currentStyle = websiteConfig.style || 'artisan-warm';
    var html = '';

    // Style cards
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Template</h3>';
    html += '<div class="wp-style-grid">';
    STYLE_DEFS.forEach(function(s) {
      html += '<div class="wp-style-card' + (s.id === currentStyle ? ' selected' : '') + '" onclick="wpSelectStyle(\'' + s.id + '\')">';
      html += '<div style="font-size:1.5rem;margin-bottom:6px;">' + s.icon + '</div>';
      html += '<strong style="font-size:0.9rem;">' + esc(s.name) + '</strong>';
      html += '<p style="font-size:0.75rem;color:var(--warm-gray);margin-top:4px;">' + esc(s.desc) + '</p>';
      html += '</div>';
    });
    html += '</div>';

    // Color pickers
    var primaryColor = websiteConfig.primaryColor || '#8B7355';
    var accentColor = websiteConfig.accentColor || '#2D5F5D';
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Colors</h3>';
    html += '<div class="wp-color-row" style="margin-bottom:24px;">';
    html += '<div class="wp-field-group" style="flex:1;">';
    html += '<label>Primary Color</label>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    html += '<input type="color" value="' + esc(primaryColor) + '" onchange="wpUpdateColor(\'primaryColor\', this.value)" style="width:40px;height:40px;border:none;cursor:pointer;padding:0;">';
    html += '<input type="text" value="' + esc(primaryColor) + '" onchange="wpUpdateColor(\'primaryColor\', this.value)" style="flex:1;" maxlength="7">';
    html += '</div></div>';
    html += '<div class="wp-field-group" style="flex:1;">';
    html += '<label>Accent Color</label>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    html += '<input type="color" value="' + esc(accentColor) + '" onchange="wpUpdateColor(\'accentColor\', this.value)" style="width:40px;height:40px;border:none;cursor:pointer;padding:0;">';
    html += '<input type="text" value="' + esc(accentColor) + '" onchange="wpUpdateColor(\'accentColor\', this.value)" style="flex:1;" maxlength="7">';
    html += '</div></div>';
    html += '</div>';

    // Font pair
    var fontPair = websiteConfig.fontPair || 'playfair-lato';
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Fonts</h3>';
    html += '<div class="wp-field-group">';
    html += '<label>Font Pair</label>';
    html += '<select onchange="wpUpdateFont(this.value)">';
    FONT_PAIR_OPTIONS.forEach(function(fp) {
      html += '<option value="' + fp.value + '"' + (fp.value === fontPair ? ' selected' : '') + '>' + esc(fp.label) + '</option>';
    });
    html += '</select></div>';

    return html;
  }

  // ── Sections Tab ──
  function renderSectionsTab() {
    if (templateManifest) {
      return renderManifestSectionsTab();
    }
    return renderFallbackSectionsTab();
  }

  // ── Manifest-driven Sections Tab ──
  function renderManifestSectionsTab() {
    var html = '';
    var navConfig = {};

    // Load current nav section enabled states from public/config/nav
    try {
      var navSections = themeConfig && themeConfig._navSections;
      if (navSections) navConfig = navSections;
    } catch (e) {}

    // Render each slot category
    var categories = [
      { key: 'universal', label: 'Core Sections', desc: 'Required sections that define the template.' },
      { key: 'common', label: 'Common Sections', desc: 'Widely used sections that enhance your site.' },
      { key: 'differentiators', label: 'Differentiator Sections', desc: 'Unique sections that set your brand apart.' }
    ];

    categories.forEach(function(cat) {
      var slots = templateManifest.slots[cat.key];
      if (!slots || slots.length === 0) return;

      html += '<div style="margin-bottom:20px;">';
      html += '<h3 style="font-size:0.95rem;margin-bottom:4px;">' + esc(cat.label) + '</h3>';
      html += '<p style="font-size:0.8rem;color:var(--warm-gray);margin-bottom:12px;">' + esc(cat.desc) + '</p>';

      slots.forEach(function(slot) {
        var sectionData = (websiteConfig.sections && websiteConfig.sections[slot.id]) || {};
        var navData = navConfig[slot.id] || {};
        var isRequired = slot.required;
        var enabled = isRequired ? true : (navData.enabled !== false && sectionData.enabled !== false);
        var expanded = sectionData._expanded;

        html += '<div class="wp-section-toggle" onclick="wpToggleSectionExpand(\'' + esc(slot.id) + '\')">';
        html += '<div style="display:flex;align-items:center;gap:12px;">';
        if (isRequired) {
          html += '<span style="font-size:0.7rem;color:var(--warm-gray);padding:0 4px;min-width:60px;text-align:center;">Required</span>';
        } else {
          html += '<label class="toggle-switch" style="margin:0;" onclick="event.stopPropagation();">';
          html += '<input type="checkbox"' + (enabled ? ' checked' : '') + ' onchange="wpToggleManifestSection(\'' + esc(slot.id) + '\', this.checked)">';
          html += '<span class="toggle-slider"></span>';
          html += '</label>';
        }
        html += '<div>';
        html += '<strong>' + esc(slot.label) + '</strong>';
        if (slot.prominent) {
          html += '<span style="font-size:0.7rem;color:var(--accent);margin-left:6px;">Prominent</span>';
        }
        html += '<div style="font-size:0.75rem;color:var(--warm-gray);margin-top:2px;">' + esc(slot.description || '') + '</div>';
        html += '</div>';
        html += '</div>';
        html += '<span style="font-size:0.8rem;color:var(--warm-gray);">' + (expanded ? '&#9650;' : '&#9660;') + '</span>';
        html += '</div>';

        // Expanded section fields (reuse existing SECTION_DEFS fields if they match)
        if (expanded) {
          html += '<div class="wp-section-fields">';
          var matchingDef = SECTION_DEFS.find(function(d) { return d.key === slot.id; });
          if (matchingDef && matchingDef.fields) {
            matchingDef.fields.forEach(function(field) {
              html += renderSectionField(slot.id, field, sectionData);
            });
          }
          if (slot.id === 'contact') {
            html += renderSocialLinks(sectionData.socialLinks || {});
          }
          html += '</div>';
        }
      });

      html += '</div>';
    });

    html += '<div style="margin-top:8px;font-size:0.85rem;color:var(--warm-gray);">Section order follows the "' + esc(templateManifest.name) + '" template layout.</div>';

    return html;
  }

  // ── Fallback Sections Tab (no manifest) ──
  function renderFallbackSectionsTab() {
    var sections = websiteConfig.sections || {};
    var html = '';

    SECTION_DEFS.forEach(function(def) {
      var sectionData = sections[def.key] || {};
      var enabled = def.locked ? true : (sectionData.enabled !== false);
      var expanded = sectionData._expanded;

      html += '<div class="wp-section-toggle" onclick="wpToggleSectionExpand(\'' + def.key + '\')">';
      html += '<div style="display:flex;align-items:center;gap:12px;">';
      if (!def.locked) {
        html += '<label class="toggle-switch" style="margin:0;" onclick="event.stopPropagation();">';
        html += '<input type="checkbox"' + (enabled ? ' checked' : '') + ' onchange="wpToggleSection(\'' + def.key + '\', this.checked)">';
        html += '<span class="toggle-slider"></span>';
        html += '</label>';
      } else {
        html += '<span style="font-size:0.75rem;color:var(--warm-gray);padding:0 8px;">Always on</span>';
      }
      html += '<strong>' + esc(def.name) + '</strong>';
      html += '</div>';
      html += '<span style="font-size:0.8rem;color:var(--warm-gray);">' + (expanded ? '&#9650;' : '&#9660;') + '</span>';
      html += '</div>';

      if (expanded) {
        html += '<div class="wp-section-fields">';
        def.fields.forEach(function(field) {
          html += renderSectionField(def.key, field, sectionData);
        });
        if (def.key === 'contact') {
          html += renderSocialLinks(sectionData.socialLinks || {});
        }
        html += '</div>';
      }
    });

    html += '<div style="margin-top:16px;font-size:0.85rem;color:var(--warm-gray);">Section order follows the template layout.</div>';

    return html;
  }

  function renderSectionField(sectionKey, field, data) {
    var val = data[field.id] !== undefined ? data[field.id] : '';
    var inputId = 'wp-' + sectionKey + '-' + field.id;
    var html = '<div class="wp-field-group">';
    html += '<label for="' + inputId + '">' + esc(field.label) + '</label>';

    if (field.type === 'text') {
      html += '<input type="text" id="' + inputId + '" value="' + esc(String(val)) + '" oninput="wpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)">';
    } else if (field.type === 'textarea') {
      html += '<textarea id="' + inputId + '" oninput="wpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)">' + esc(String(val)) + '</textarea>';
    } else if (field.type === 'number') {
      html += '<input type="number" id="' + inputId + '" value="' + esc(String(val)) + '" oninput="wpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', parseInt(this.value) || 0)">';
    } else if (field.type === 'select') {
      html += '<select id="' + inputId + '" onchange="wpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)">';
      (field.options || []).forEach(function(opt) {
        html += '<option value="' + opt.v + '"' + (String(val) === opt.v ? ' selected' : '') + '>' + esc(opt.l) + '</option>';
      });
      html += '</select>';
    } else if (field.type === 'toggle') {
      html += '<label class="toggle-switch"><input type="checkbox"' + (val ? ' checked' : '') + ' onchange="wpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.checked)"><span class="toggle-slider"></span></label>';
    } else if (field.type === 'image') {
      html += '<div style="display:flex;gap:8px;align-items:center;">';
      html += '<input type="text" id="' + inputId + '" value="' + esc(String(val)) + '" oninput="wpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)" style="flex:1;">';
      html += '<button class="btn btn-secondary" onclick="wpPickImage(\'' + sectionKey + '\', \'' + field.id + '\')">Browse</button>';
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
      html += '<input type="url" value="' + esc(links[p] || '') + '" oninput="wpUpdateSocial(\'' + p + '\', this.value)" placeholder="https://">';
      html += '</div>';
    });
    return html;
  }

  // ── Categories Tab ──
  function renderCategoriesTab() {
    var cats = tenantCategories || [];
    var html = '';

    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Product categories used for shop filter pills, wholesale grouping, and gallery sections. Drag order is display order.</p>';

    if (cats.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      html += '<div style="font-size:2rem;margin-bottom:12px;">&#128193;</div>';
      html += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No categories yet</p>';
      html += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add your first product category below.</p>';
      html += '</div>';
    } else {
      html += '<div id="wpCatList">';
      cats.forEach(function(cat, idx) {
        var isEditing = editingCategoryIdx === idx;
        html += '<div class="wp-cat-row" data-idx="' + idx + '">';

        // Reorder buttons
        html += '<div class="wp-cat-reorder">';
        html += '<button class="btn-icon" onclick="wpCatMove(' + idx + ', -1)" title="Move up"' + (idx === 0 ? ' disabled' : '') + '>&#9650;</button>';
        html += '<button class="btn-icon" onclick="wpCatMove(' + idx + ', 1)" title="Move down"' + (idx === cats.length - 1 ? ' disabled' : '') + '>&#9660;</button>';
        html += '</div>';

        if (isEditing) {
          // Edit mode
          html += '<div class="wp-cat-fields" style="flex:1;">';
          html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">';
          html += '<div class="wp-field-group" style="flex:2;min-width:140px;margin:0;">';
          html += '<label style="font-size:0.75rem;">Label</label>';
          html += '<input type="text" id="wpCatEditLabel" value="' + esc(cat.label) + '" style="padding:6px 8px;">';
          html += '</div>';
          html += '<div class="wp-field-group" style="flex:1;min-width:100px;margin:0;">';
          html += '<label style="font-size:0.75rem;">ID (slug)</label>';
          html += '<input type="text" id="wpCatEditId" value="' + esc(cat.id) + '" style="padding:6px 8px;color:var(--warm-gray);" readonly>';
          html += '</div>';
          html += '<div class="wp-field-group" style="flex:1;min-width:140px;margin:0;">';
          html += '<label style="font-size:0.75rem;">Wholesale Group (optional)</label>';
          html += '<input type="text" id="wpCatEditWholesale" value="' + esc(cat.wholesaleGroup || '') + '" placeholder="e.g. Decorative" style="padding:6px 8px;">';
          html += '</div>';
          html += '</div>';
          html += '<div style="display:flex;gap:8px;margin-top:8px;">';
          html += '<button class="btn btn-primary btn-small" onclick="wpCatSaveEdit(' + idx + ')">Save</button>';
          html += '<button class="btn btn-secondary btn-small" onclick="wpCatCancelEdit()">Cancel</button>';
          html += '</div>';
          html += '</div>';
        } else {
          // Display mode
          html += '<div style="flex:1;display:flex;align-items:center;gap:12px;min-width:0;">';
          html += '<strong style="font-size:0.9rem;">' + esc(cat.label) + '</strong>';
          html += '<span style="font-size:0.75rem;color:var(--warm-gray);font-family:monospace;">' + esc(cat.id) + '</span>';
          if (cat.wholesaleGroup) {
            html += '<span style="font-size:0.7rem;background:var(--charcoal-light, #333);padding:2px 8px;border-radius:4px;color:var(--warm-gray);">wholesale: ' + esc(cat.wholesaleGroup) + '</span>';
          }
          html += '</div>';
          html += '<div style="display:flex;gap:4px;">';
          html += '<button class="btn-icon" onclick="wpCatEdit(' + idx + ')" title="Edit">&#9998;</button>';
          html += '<button class="btn-icon" onclick="wpCatDelete(' + idx + ')" title="Delete" style="color:var(--danger);">&#10005;</button>';
          html += '</div>';
        }

        html += '</div>';
      });
      html += '</div>';
    }

    // Add new category form
    html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--charcoal-light, #333);">';
    html += '<h4 style="font-size:0.9rem;margin-bottom:8px;">Add Category</h4>';
    html += '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">';
    html += '<div class="wp-field-group" style="flex:2;min-width:140px;margin:0;">';
    html += '<label style="font-size:0.75rem;">Label</label>';
    html += '<input type="text" id="wpCatNewLabel" placeholder="e.g. Drinkware" style="padding:6px 8px;">';
    html += '</div>';
    html += '<div class="wp-field-group" style="flex:1;min-width:140px;margin:0;">';
    html += '<label style="font-size:0.75rem;">Wholesale Group (optional)</label>';
    html += '<input type="text" id="wpCatNewWholesale" placeholder="e.g. Decorative" style="padding:6px 8px;">';
    html += '</div>';
    html += '<button class="btn btn-primary btn-small" onclick="wpCatAdd()" style="height:34px;">Add</button>';
    html += '</div>';
    html += '<p id="wpCatAddError" style="font-size:0.8rem;color:var(--danger);margin-top:4px;display:none;"></p>';
    html += '</div>';

    return html;
  }

  // ── Import Tab ──
  function renderImportTab() {
    var html = '';

    // Re-scan / New Import section
    html += renderRescanSection();

    // Active import jobs (pending, processing, crawled, importing)
    html += renderActiveImportJobs();

    // Cherry-pick section (for crawled jobs awaiting import)
    html += renderCherryPickSection();

    // Review imported content (if any complete jobs exist)
    var hasComplete = importJobs && importJobs.some(function(j) { return j.status === 'complete'; });
    if (hasComplete) {
      html += renderReviewSection();
    }

    // Import History
    html += renderImportHistory();

    // Analyze section (style/branding import — separate from product import)
    html += '<div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--cream-dark);">';
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Analyze a Website</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Extract branding, colors, and content from any website.</p>';
    html += '<div class="wp-field-group">';
    html += '<label>Website URL</label>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<input type="url" id="wpImportUrl" placeholder="https://www.yourbusiness.com" style="flex:1;">';
    html += '<button class="btn btn-primary" onclick="wpAnalyze()" id="wpAnalyzeBtn">Analyze</button>';
    html += '</div></div>';
    html += '<div id="wpAnalyzeStatus" style="font-size:0.85rem;margin-bottom:16px;"></div>';
    html += '<div id="wpAnalyzeResults"></div>';
    html += '</div>';

    return html;
  }

  // ── Re-scan / New Import ──
  function renderRescanSection() {
    var html = '<div style="margin-bottom:24px;">';
    html += '<h3 style="font-size:1rem;margin-bottom:4px;">Import Products &amp; Content</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Scan a website to import products, images, blog posts, and events.</p>';

    // Check for recent imports to warn about duplicates
    var recentDupWarning = '';
    if (importJobs && importJobs.length > 0) {
      var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      var recentUrls = {};
      importJobs.forEach(function(j) {
        if (j.createdAt > sevenDaysAgo && j.url) {
          recentUrls[j.url] = (recentUrls[j.url] || 0) + 1;
        }
      });
      // Store for duplicate check
      window._wpRecentImportUrls = recentUrls;
    }

    // Active jobs check
    var hasActiveJob = importJobs && importJobs.some(function(j) {
      return j.status === 'pending' || j.status === 'processing' || j.status === 'crawled' || j.status === 'importing';
    });

    html += '<div class="wp-field-group">';
    html += '<label>Website URL</label>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<input type="url" id="wpRescanUrl" placeholder="https://www.yourbusiness.com" style="flex:1;">';
    html += '<button class="btn btn-primary" onclick="wpStartImport()" id="wpRescanBtn"' + (hasActiveJob ? ' disabled' : '') + '>';
    html += hasActiveJob ? 'Import Running...' : 'Scan &amp; Import';
    html += '</button>';
    html += '</div>';
    html += '</div>';
    html += '<div id="wpRescanStatus" style="font-size:0.85rem;margin-top:-8px;margin-bottom:8px;"></div>';

    if (hasActiveJob) {
      html += '<div style="font-size:0.8rem;color:var(--amber);margin-bottom:8px;">An import is already in progress. Wait for it to complete before starting a new one.</div>';
    }

    html += '</div>';
    return html;
  }

  // ── Active Import Jobs (non-historical) ──
  function renderActiveImportJobs() {
    if (!importJobs || importJobs.length === 0) return '';

    var activeJobs = importJobs.filter(function(j) {
      return j.status === 'pending' || j.status === 'processing' || j.status === 'importing';
    });
    if (activeJobs.length === 0) return '';

    var html = '<div style="margin-bottom:24px;">';
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Active Imports</h3>';

    activeJobs.forEach(function(job) {
      html += renderJobCard(job, false);
    });

    html += '</div>';
    return html;
  }

  // ── Cherry-Pick Section (for crawled jobs) ──
  function renderCherryPickSection() {
    if (!importJobs) return '';

    var crawledJobs = importJobs.filter(function(j) { return j.status === 'crawled'; });
    if (crawledJobs.length === 0) return '';

    var html = '<div style="margin-bottom:24px;padding:16px;background:var(--cream);border-radius:12px;border:2px solid var(--teal);">';
    html += '<h3 style="font-size:1rem;margin-bottom:4px;">Content Found — Ready to Import</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Review what was found on your website. Toggle items on/off before importing.</p>';

    crawledJobs.forEach(function(job) {
      var disc = job.discovered || {};

      // Products
      if (disc.products && disc.products.count > 0) {
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        html += '<strong style="font-size:0.9rem;">Products (' + disc.products.count + ')</strong>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button class="btn btn-secondary" onclick="wpCherryPickAll(\'' + esc(job.id) + '\', \'products\', true)" style="font-size:0.75rem;padding:3px 8px;">Select All</button>';
        html += '<button class="btn btn-secondary" onclick="wpCherryPickAll(\'' + esc(job.id) + '\', \'products\', false)" style="font-size:0.75rem;padding:3px 8px;">Deselect All</button>';
        html += '</div></div>';

        if (disc.products.pages && disc.products.pages.length > 0) {
          disc.products.pages.forEach(function(p, idx) {
            var sel = getCherryPick(job.id, 'products', p.url || idx);
            html += '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--cream-dark);border-radius:6px;margin-bottom:4px;cursor:pointer;font-size:0.85rem;">';
            html += '<input type="checkbox"' + (sel ? ' checked' : '') + ' onchange="wpToggleCherryPick(\'' + esc(job.id) + '\', \'products\', \'' + esc(p.url || String(idx)) + '\', this.checked)">';
            html += '<span style="flex:1;">' + esc(p.title || 'Unknown Product');
            if (p.price) html += ' &mdash; ' + esc(p.price);
            html += '</span>';
            html += '</label>';
          });
        }
        html += '</div>';
      }

      // Summary counts for other types
      var otherTypes = [];
      if (disc.images && disc.images.count > 0) otherTypes.push(disc.images.count + ' images');
      if (disc.blogs && disc.blogs.count > 0) otherTypes.push(disc.blogs.count + ' blog posts');
      if (disc.events && disc.events.count > 0) otherTypes.push(disc.events.count + ' events');
      if (otherTypes.length > 0) {
        html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Also found: ' + otherTypes.join(', ') + '</div>';
      }

      // JS-rendered warning
      if (job.crawlFeedback && job.crawlFeedback.jsRendered) {
        html += '<div style="font-size:0.85rem;color:var(--amber);background:rgba(255,152,0,0.15);padding:8px 12px;border-radius:6px;margin-bottom:12px;">';
        html += '&#9888; This site uses JavaScript rendering. Some content may not have been captured. ';
        html += 'For best results, consider importing from Square, Etsy, or Shopify directly.';
        html += '</div>';
      }

      // Import button
      html += '<div style="display:flex;gap:8px;margin-top:12px;">';
      html += '<button class="btn btn-primary" onclick="wpImportCherryPicked(\'' + esc(job.id) + '\')">Import Selected</button>';
      html += '<button class="btn btn-secondary" onclick="wpImportAll(\'' + esc(job.id) + '\')">Import All</button>';
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  // ── Import History ──
  function renderImportHistory() {
    if (!importJobs || importJobs.length === 0) return '';

    var historyJobs = importJobs.filter(function(j) {
      return j.status === 'complete' || j.status === 'failed';
    });
    if (historyJobs.length === 0) return '';

    var html = '<div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--cream-dark);">';
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Import History</h3>';

    historyJobs.forEach(function(job) {
      var statusInfo = getJobStatusInfo(job.status);
      var isExpanded = expandedJobId === job.id;
      var dateStr = job.createdAt ? new Date(job.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

      html += '<div style="background:var(--cream);border-radius:8px;padding:12px 16px;margin-bottom:8px;border-left:4px solid ' + statusInfo.color + ';cursor:pointer;" onclick="wpToggleHistoryDetail(\'' + esc(job.id) + '\')">';

      // Summary row
      html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      html += '<div style="display:flex;align-items:center;gap:12px;">';
      html += '<span style="font-size:0.85rem;color:var(--warm-gray);">' + dateStr + '</span>';
      html += '<span style="font-size:0.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px;">' + esc(job.url || 'Unknown URL') + '</span>';
      html += '</div>';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += renderImportedCountsBadges(job.imported);
      html += '<span style="font-size:0.8rem;padding:3px 10px;border-radius:12px;background:' + statusInfo.bg + ';color:' + statusInfo.color + ';font-weight:600;">' + statusInfo.label + '</span>';
      html += '<span style="color:var(--warm-gray);font-size:0.8rem;">' + (isExpanded ? '&#9650;' : '&#9660;') + '</span>';
      html += '</div></div>';

      // Expanded detail
      if (isExpanded) {
        html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--cream-dark);font-size:0.85rem;">';

        if (job.status === 'complete' && job.imported) {
          html += renderDetailedImportResults(job.imported);
        }
        if (job.status === 'failed') {
          html += '<div style="color:var(--danger);margin-bottom:8px;">' + esc(job.error || 'Unknown error') + '</div>';
          html += '<button class="btn btn-secondary" onclick="event.stopPropagation(); wpRetryImport(\'' + esc(job.id) + '\')" style="font-size:0.8rem;">Retry Import</button>';
        }

        // Timing
        if (job.createdAt && job.completedAt) {
          var dur = Math.round((new Date(job.completedAt) - new Date(job.createdAt)) / 60000);
          html += '<div style="color:var(--warm-gray);margin-top:8px;">Duration: ' + dur + ' min</div>';
        }

        // JS warning note
        if (job.crawlFeedback && job.crawlFeedback.jsRendered) {
          html += '<div style="color:var(--amber);margin-top:4px;">&#9888; JS-rendered site — some content may have been missed.</div>';
        }

        html += '</div>';
      }

      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  function renderImportedCountsBadges(imported) {
    if (!imported) return '';
    var html = '';
    if (imported.products && imported.products.done) {
      html += '<span style="font-size:0.75rem;background:var(--teal);color:white;padding:2px 6px;border-radius:4px;">' + imported.products.done + 'P</span>';
    }
    if (imported.images && imported.images.done) {
      html += '<span style="font-size:0.75rem;background:var(--teal);color:white;padding:2px 6px;border-radius:4px;">' + imported.images.done + 'I</span>';
    }
    return html;
  }

  function renderDetailedImportResults(imported) {
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:8px;">';
    ['products', 'images', 'blogs', 'events'].forEach(function(type) {
      var d = imported[type];
      if (!d) return;
      var label = type.charAt(0).toUpperCase() + type.slice(1);
      html += '<div style="background:var(--cream-dark);padding:8px;border-radius:6px;">';
      html += '<div style="font-weight:600;">' + label + '</div>';
      html += '<div style="color:var(--teal);">' + (d.done || 0) + ' imported</div>';
      if (d.failed) html += '<div style="color:var(--danger);">' + d.failed + ' failed</div>';
      if (d.skipped) html += '<div style="color:var(--warm-gray);">' + d.skipped + ' skipped (duplicates)</div>';
      html += '</div>';
    });
    html += '</div>';

    // Show failed items if any
    if (imported.products && imported.products.failedItems && imported.products.failedItems.length > 0) {
      html += '<details style="margin-top:4px;"><summary style="cursor:pointer;color:var(--danger);font-size:0.8rem;">Failed items</summary>';
      html += '<div style="font-size:0.8rem;color:var(--warm-gray);padding:4px 0;">';
      imported.products.failedItems.forEach(function(item) {
        html += '<div>' + esc(item) + '</div>';
      });
      html += '</div></details>';
    }

    return html;
  }

  // ── Job Card (reusable for active and history) ──
  function renderJobCard(job, compact) {
    var statusInfo = getJobStatusInfo(job.status);
    var timeAgo = formatTimeAgo(job.createdAt);

    var html = '<div style="background:var(--cream);border-radius:8px;padding:' + (compact ? '12px' : '16px') + ';margin-bottom:' + (compact ? '8px' : '12px') + ';border-left:4px solid ' + statusInfo.color + ';">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">';
    html += '<div>';
    html += '<div style="font-weight:600;font-size:0.9rem;">' + esc(job.url) + '</div>';
    html += '<div style="font-size:0.8rem;color:var(--warm-gray);margin-top:2px;">' + timeAgo + '</div>';
    html += '</div>';
    html += '<span style="font-size:0.8rem;padding:3px 10px;border-radius:12px;background:' + statusInfo.bg + ';color:' + statusInfo.color + ';font-weight:600;white-space:nowrap;">';
    html += statusInfo.icon + ' ' + statusInfo.label;
    html += '</span>';
    html += '</div>';

    // Status-specific details
    if (job.status === 'pending') {
      // Timeout detection: if pending for > 2 hours, show warning
      var pendingMs = Date.now() - new Date(job.createdAt).getTime();
      if (pendingMs > 2 * 60 * 60 * 1000) {
        html += '<div style="font-size:0.85rem;color:var(--danger);margin-bottom:4px;">&#9888; This job has been queued for over 2 hours. It may be stuck.</div>';
        html += '<button class="btn btn-secondary" onclick="wpRetryImport(\'' + esc(job.id) + '\')" style="font-size:0.8rem;">Retry</button>';
      } else {
        html += '<div style="font-size:0.85rem;color:var(--warm-gray);">Queued for processing. The import runs every 30 minutes.</div>';
      }
    } else if (job.status === 'processing') {
      // Timeout detection: if processing for > 2 hours, show warning
      var processMs = Date.now() - new Date(job.claimedAt || job.createdAt).getTime();
      if (processMs > 2 * 60 * 60 * 1000) {
        html += '<div style="font-size:0.85rem;color:var(--danger);margin-bottom:4px;">&#9888; Scan has been running for over 2 hours. It may be stuck.</div>';
        html += '<button class="btn btn-secondary" onclick="wpRetryImport(\'' + esc(job.id) + '\')" style="font-size:0.8rem;">Reset &amp; Retry</button>';
      } else {
        html += '<div style="font-size:0.85rem;color:var(--warm-gray);">Scanning your website for products, images, and content...</div>';
        html += renderProgressBar(30);
      }
    } else if (job.status === 'importing') {
      html += renderDiscoveredCounts(job.discovered);
      html += renderImportProgress(job.imported);
      // Timeout detection
      var importMs = Date.now() - new Date(job.claimedAt || job.createdAt).getTime();
      if (importMs > 2 * 60 * 60 * 1000) {
        html += '<div style="font-size:0.85rem;color:var(--danger);margin-top:4px;">&#9888; Import has been running for over 2 hours.</div>';
      }
    } else if (job.status === 'failed') {
      html += '<div style="font-size:0.85rem;color:var(--danger);margin-top:4px;">' + esc(job.error || 'Import encountered an error.') + '</div>';
      html += '<button class="btn btn-secondary" onclick="wpRetryImport(\'' + esc(job.id) + '\')" style="margin-top:8px;font-size:0.8rem;">Retry Import</button>';
    }

    html += '</div>';
    return html;
  }

  function getJobStatusInfo(status) {
    var map = {
      pending: { label: 'Queued', icon: '&#9203;', color: 'var(--warm-gray)', bg: 'var(--cream-dark)' },
      processing: { label: 'Scanning', icon: '&#128269;', color: 'var(--amber)', bg: 'rgba(255,152,0,0.15)' },
      crawled: { label: 'Found Content', icon: '&#10003;', color: 'var(--teal)', bg: 'rgba(0,150,136,0.15)' },
      importing: { label: 'Importing', icon: '&#8635;', color: 'var(--amber)', bg: 'rgba(255,152,0,0.15)' },
      complete: { label: 'Complete', icon: '&#10003;', color: 'var(--teal)', bg: 'rgba(0,150,136,0.15)' },
      failed: { label: 'Failed', icon: '&#10007;', color: 'var(--danger)', bg: 'rgba(244,67,54,0.15)' }
    };
    return map[status] || map.pending;
  }

  function renderProgressBar(pct) {
    return '<div style="margin-top:8px;background:var(--cream-dark);border-radius:4px;height:6px;overflow:hidden;">' +
      '<div style="height:100%;width:' + pct + '%;background:var(--amber);border-radius:4px;transition:width 0.5s;"></div></div>';
  }

  function renderDiscoveredCounts(discovered) {
    if (!discovered) return '';
    var items = [];
    if (discovered.products && discovered.products.count) items.push(discovered.products.count + ' products');
    if (discovered.images && discovered.images.count) items.push(discovered.images.count + ' images');
    if (discovered.blogs && discovered.blogs.count) items.push(discovered.blogs.count + ' blog posts');
    if (discovered.events && discovered.events.count) items.push(discovered.events.count + ' events');
    if (items.length === 0) return '';
    return '<div style="font-size:0.85rem;color:var(--charcoal);margin-top:4px;">Found: ' + items.join(', ') + '</div>';
  }

  function renderImportProgress(imported) {
    if (!imported) return renderProgressBar(50);
    var total = 0, done = 0;
    ['products', 'images', 'blogs', 'events'].forEach(function(t) {
      if (imported[t]) { total += (imported[t].total || 0); done += (imported[t].done || 0); }
    });
    var pct = total > 0 ? Math.round((done / total) * 100) : 50;
    var html = '<div style="font-size:0.85rem;color:var(--charcoal);margin-top:4px;">Importing: ' + done + ' of ' + total + ' items</div>';
    html += renderProgressBar(pct);
    return html;
  }

  function renderImportedCounts(imported) {
    if (!imported) return '';
    var html = '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px;">';
    if (imported.products && imported.products.done) {
      html += '<span style="font-size:0.85rem;color:var(--teal);">&#10003; ' + imported.products.done + ' products</span>';
    }
    if (imported.images && imported.images.done) {
      html += '<span style="font-size:0.85rem;color:var(--teal);">&#10003; ' + imported.images.done + ' images</span>';
    }
    if (imported.blogs && imported.blogs.done) {
      html += '<span style="font-size:0.85rem;color:var(--teal);">&#10003; ' + imported.blogs.done + ' blog posts</span>';
    }
    if (imported.events && imported.events.done) {
      html += '<span style="font-size:0.85rem;color:var(--teal);">&#10003; ' + imported.events.done + ' events</span>';
    }
    html += '</div>';
    return html;
  }

  // ── Review Imports Section ──
  function renderReviewSection() {
    var html = '<div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--cream-dark);">';
    html += '<h3 style="font-size:1rem;margin-bottom:4px;">Review Imported Content</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Imported items are live on your site. Review and customize them below.</p>';

    // Review sub-tabs
    html += '<div class="view-tabs">';
    ['products', 'images', 'blog', 'events'].forEach(function(t) {
      var active = importReviewTab === t;
      var label = t.charAt(0).toUpperCase() + t.slice(1);
      html += '<button class="view-tab' + (active ? ' active' : '') + '" onclick="wpReviewTab(\'' + t + '\')">' + label + '</button>';
    });
    html += '</div>';

    html += '<div id="wpReviewContent">';
    if (importReviewTab === 'products') html += renderReviewProducts();
    else if (importReviewTab === 'images') html += renderReviewImages();
    else if (importReviewTab === 'blog') html += renderReviewBlog();
    else if (importReviewTab === 'events') html += renderReviewEvents();
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderReviewProducts() {
    if (!importedProducts || importedProducts.length === 0) {
      return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:16px 0;">No imported products found.</div>';
    }

    var draftProducts = importedProducts.filter(function(p) { return p.status === 'draft' && p.importedFrom; });
    var publishedProducts = importedProducts.filter(function(p) { return p.status === 'active' && p.importedFrom; });

    var html = '';

    if (draftProducts.length > 0) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
      html += '<span style="font-size:0.85rem;color:var(--warm-gray);">' + draftProducts.length + ' draft product' + (draftProducts.length !== 1 ? 's' : '') + '</span>';
      html += '<button class="btn btn-primary" onclick="wpPublishAllProducts()" style="font-size:0.8rem;">Publish All Drafts</button>';
      html += '</div>';
    }

    var allProducts = draftProducts.concat(publishedProducts);
    allProducts.forEach(function(p) {
      var isDraft = p.status === 'draft';
      html += '<div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--cream);border-radius:8px;margin-bottom:8px;' + (isDraft ? 'border-left:3px solid var(--amber);' : 'border-left:3px solid var(--teal);') + '">';

      // Thumbnail
      var img = (p.images && p.images.length > 0) ? p.images[0].url || p.images[0] : '';
      if (img) {
        html += '<img src="' + esc(typeof img === 'string' ? img : img.url || '') + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;" alt="">';
      } else {
        html += '<div style="width:48px;height:48px;background:var(--cream-dark);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:var(--warm-gray);">&#128247;</div>';
      }

      // Info
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.name || 'Untitled') + '</div>';
      html += '<div style="font-size:0.8rem;color:var(--warm-gray);">';
      if (p.priceCents) html += '$' + (p.priceCents / 100).toFixed(2);
      else if (p.price) html += esc(String(p.price));
      if (isDraft) html += ' &middot; <span style="color:var(--amber);">Draft</span>';
      else html += ' &middot; <span style="color:var(--teal);">Published</span>';
      html += '</div>';
      html += '</div>';

      // Actions
      html += '<div style="display:flex;gap:6px;">';
      if (isDraft) {
        html += '<button class="btn btn-primary" onclick="wpPublishProduct(\'' + esc(p.id) + '\')" style="font-size:0.75rem;padding:4px 10px;">Publish</button>';
      }
      html += '<button class="btn btn-secondary" onclick="wpDeleteProduct(\'' + esc(p.id) + '\')" style="font-size:0.75rem;padding:4px 10px;color:var(--danger);">Delete</button>';
      html += '</div>';

      html += '</div>';
    });

    return html;
  }

  function renderReviewImages() {
    // Images are part of products — show product images from imported products
    if (!importedProducts || importedProducts.length === 0) {
      return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:16px 0;">No imported images found.</div>';
    }

    var images = [];
    importedProducts.forEach(function(p) {
      if (p.importedFrom && p.images) {
        (Array.isArray(p.images) ? p.images : Object.values(p.images)).forEach(function(img) {
          var url = typeof img === 'string' ? img : (img.url || '');
          if (url) images.push({ url: url, productName: p.name, productId: p.id });
        });
      }
    });

    if (images.length === 0) {
      return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:16px 0;">No imported images found.</div>';
    }

    var html = '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">' + images.length + ' image' + (images.length !== 1 ? 's' : '') + ' from imported products</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;">';
    images.forEach(function(img) {
      html += '<div style="position:relative;border-radius:8px;overflow:hidden;aspect-ratio:1;">';
      html += '<img src="' + esc(img.url) + '" style="width:100%;height:100%;object-fit:cover;" alt="' + esc(img.productName || '') + '">';
      html += '</div>';
    });
    html += '</div>';

    return html;
  }

  function renderReviewBlog() {
    return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:16px 0;">Blog post import coming soon.</div>';
  }

  function renderReviewEvents() {
    return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:16px 0;">Event import coming soon.</div>';
  }

  // ── Event handlers (exposed to window) ──

  window.wpSwitchTab = function(tab) {
    currentSubTab = tab;
    pendingSwitchTemplateId = null;
    renderWebsite();
  };

  // ── Gallery image migration for template switching ──

  // Sections that are always compatible regardless of template (product-related)
  var ALWAYS_COMPATIBLE_SECTIONS = ['shop', 'hero'];

  function isProductCategorySection(sectionId) {
    // Category IDs are dynamic — anything not in CORE_SECTIONS is a product category
    var coreIds = ['hero', 'about', 'our-story', 'gallery', 'schedule', 'shop'];
    return coreIds.indexOf(sectionId) === -1;
  }

  function computeGalleryMigration(galleryData, newManifest, currentTemplateId) {
    var migrate = []; // { id, section, mappedTo }
    var hide = []; // { id, section }
    var restore = []; // { id, section } — previously hidden images that can be restored

    if (!galleryData || !newManifest) return { migrate: migrate, hide: hide, restore: restore };

    var slotMapping = newManifest.slotMapping || {};
    // Build list of all slot IDs in the new template
    var newSlotIds = [];
    if (newManifest.slots) {
      ['universal', 'common', 'differentiators'].forEach(function(cat) {
        (newManifest.slots[cat] || []).forEach(function(s) { newSlotIds.push(s.id); });
      });
    }

    Object.keys(galleryData).forEach(function(imageId) {
      var img = galleryData[imageId];
      var section = img.section || 'gallery';

      // Check if this image was previously hidden by a template switch
      if (img.templateHidden) {
        // Can the new template support this image's section?
        var originalSection = img.templateHiddenSection || section;
        if (isSectionCompatible(originalSection, slotMapping, newSlotIds)) {
          restore.push({ id: imageId, section: originalSection });
        }
        // If still incompatible, stays hidden — don't add to hide (already hidden)
        return;
      }

      // Always compatible sections
      if (ALWAYS_COMPATIBLE_SECTIONS.indexOf(section) !== -1 || isProductCategorySection(section)) {
        migrate.push({ id: imageId, section: section, mappedTo: section });
        return;
      }

      // Check slotMapping
      if (isSectionCompatible(section, slotMapping, newSlotIds)) {
        var mappedTo = slotMapping[section] !== undefined ? slotMapping[section] : section;
        migrate.push({ id: imageId, section: section, mappedTo: mappedTo || section });
      } else {
        hide.push({ id: imageId, section: section });
      }
    });

    return { migrate: migrate, hide: hide, restore: restore };
  }

  function isSectionCompatible(section, slotMapping, newSlotIds) {
    if (ALWAYS_COMPATIBLE_SECTIONS.indexOf(section) !== -1) return true;
    if (isProductCategorySection(section)) return true;
    // Explicitly mapped to non-null
    if (slotMapping.hasOwnProperty(section) && slotMapping[section] !== null) return true;
    // Same ID exists in new template
    if (newSlotIds.indexOf(section) >= 0) return true;
    // Explicitly mapped to null
    if (slotMapping.hasOwnProperty(section) && slotMapping[section] === null) return false;
    // Not in mapping and not in new template
    return false;
  }

  async function executeGalleryMigration(migration, currentTemplateId) {
    var updates = {};

    // Hide incompatible images
    migration.hide.forEach(function(item) {
      updates['public/gallery/' + item.id + '/templateHidden'] = true;
      updates['public/gallery/' + item.id + '/templateHiddenSection'] = item.section;
      updates['public/gallery/' + item.id + '/templateHiddenFrom'] = currentTemplateId;
    });

    // Restore previously hidden images
    migration.restore.forEach(function(item) {
      updates['public/gallery/' + item.id + '/templateHidden'] = null;
      updates['public/gallery/' + item.id + '/templateHiddenSection'] = null;
      updates['public/gallery/' + item.id + '/templateHiddenFrom'] = null;
    });

    if (Object.keys(updates).length > 0) {
      await MastDB._ref().update(updates);
    }

    return { hidden: migration.hide.length, restored: migration.restore.length };
  }

  // ── Template switching handlers ──

  window.wpSelectTemplate = function(templateId) {
    pendingSwitchTemplateId = templateId;
    previewTemplateId = null;
    renderWebsite();
  };

  window.wpCancelSwitch = function() {
    pendingSwitchTemplateId = null;
    renderWebsite();
  };

  window.wpPreviewTemplate = function(templateId) {
    previewTemplateId = templateId;
    previewViewport = 'desktop';
    renderWebsite();
  };

  window.wpClosePreview = function() {
    previewTemplateId = null;
    renderWebsite();
  };

  window.wpSetPreviewViewport = function(viewport) {
    previewViewport = viewport;
    renderWebsite();
  };

  window.wpConfirmSwitch = async function() {
    if (!pendingSwitchTemplateId) return;

    var newManifest = null;
    if (allTemplateManifests) {
      newManifest = allTemplateManifests.find(function(m) { return m.id === pendingSwitchTemplateId; });
    }
    if (!newManifest) {
      showToast('Template not found.', true);
      pendingSwitchTemplateId = null;
      renderWebsite();
      return;
    }

    try {
      // Execute gallery image migration
      var currentTemplateId = (themeConfig && themeConfig.templateId) || null;
      var galleryMigration = computeGalleryMigration(window._wpGalleryCache || {}, newManifest, currentTemplateId);
      var migrationResult = await executeGalleryMigration(galleryMigration, currentTemplateId);

      // Write templateId
      await MastDB._ref('public/config/theme/templateId').set(pendingSwitchTemplateId);

      // Set default color scheme from new manifest
      var defaultScheme = (newManifest.colorSchemes || []).find(function(s) { return s.default; });
      var defaultSchemeId = defaultScheme ? defaultScheme.id : (newManifest.colorSchemes && newManifest.colorSchemes[0] ? newManifest.colorSchemes[0].id : null);
      if (defaultSchemeId) {
        await MastDB._ref('public/config/theme/colorSchemeId').set(defaultSchemeId);
        // Clear custom color overrides
        await MastDB._ref('public/config/theme/primaryColor').set(null);
        await MastDB._ref('public/config/theme/accentColor').set(null);
      }

      // Set default font pair from new manifest
      var defaultFont = (newManifest.fontPairs || []).find(function(f) { return f.default; });
      var defaultFontId = defaultFont ? defaultFont.id : (newManifest.fontPairs && newManifest.fontPairs[0] ? newManifest.fontPairs[0].id : null);
      if (defaultFontId) {
        await MastDB._ref('public/config/theme/fontPair').set(defaultFontId);
      }

      // Invalidate gallery cache so it reloads with updated data
      window._wpGalleryCache = null;

      markUnpublished();
      var migrationMsg = '';
      if (migrationResult.hidden > 0) migrationMsg += ' ' + migrationResult.hidden + ' image' + (migrationResult.hidden !== 1 ? 's' : '') + ' hidden.';
      if (migrationResult.restored > 0) migrationMsg += ' ' + migrationResult.restored + ' image' + (migrationResult.restored !== 1 ? 's' : '') + ' restored.';
      showToast('Switched to ' + newManifest.name + '.' + migrationMsg);

      // Reload theme config and manifest so Style tab reflects new template
      if (!themeConfig) themeConfig = {};
      themeConfig.templateId = pendingSwitchTemplateId;
      themeConfig.colorSchemeId = defaultSchemeId;
      themeConfig.fontPair = defaultFontId;
      delete themeConfig.primaryColor;
      delete themeConfig.accentColor;
      showCustomColors = false;

      await loadTemplateManifest();
    } catch (err) {
      showToast('Error switching template: ' + err.message, true);
    }

    pendingSwitchTemplateId = null;
    renderWebsite();
  };

  window.wpPublish = async function() {
    var btn = document.getElementById('wpPublishBtn');
    var status = document.getElementById('wpPublishStatus');
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }
    if (status) status.innerHTML = '<span style="color:var(--warm-gray);">Deploying your site...</span>';

    try {
      var result = await firebase.functions().httpsCallable('publishWebPresence')({ tenantId: MastDB.tenantId() });
      var url = result.data && result.data.url;
      if (status) status.innerHTML = '<span style="color:var(--teal);">&#10003; Published!' + (url ? ' <a href="' + esc(url) + '" target="_blank">View site</a>' : '') + '</span>';
      websiteConfig.status = 'published';
      websiteConfig.publishedAt = new Date().toISOString();
      showToast('Website published successfully.');
    } catch (err) {
      if (status) status.innerHTML = '<span style="color:var(--danger);">Error: ' + esc(err.message) + '</span>';
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Publish Changes'; }
  };

  // ── Manifest-driven handlers (write to public/config/theme) ──

  window.wpSelectScheme = async function(schemeId) {
    if (!themeConfig) themeConfig = {};
    themeConfig.colorSchemeId = schemeId;
    // Clear custom color overrides when selecting a predefined scheme
    delete themeConfig.primaryColor;
    delete themeConfig.accentColor;
    showCustomColors = false;
    try {
      await MastDB._ref('public/config/theme/colorSchemeId').set(schemeId);
      // Remove custom color overrides from Firebase
      await MastDB._ref('public/config/theme/primaryColor').set(null);
      await MastDB._ref('public/config/theme/accentColor').set(null);
      markUnpublished();
      showToast('Color scheme updated.');
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
    renderWebsite();
  };

  window.wpSelectSchemeCustom = function() {
    showCustomColors = true;
    if (!themeConfig) themeConfig = {};
    themeConfig.colorSchemeId = null;
    MastDB._ref('public/config/theme/colorSchemeId').set(null);
    markUnpublished();
    renderWebsite();
  };

  window.wpUpdateThemeColor = function(field, value) {
    if (!themeConfig) themeConfig = {};
    themeConfig[field] = value;
    debounce('theme-color-' + field, function() {
      MastDB._ref('public/config/theme/' + field).set(value);
      markUnpublished();
    }, 400);
  };

  window.wpSelectFontPair = async function(fontPairId) {
    if (!themeConfig) themeConfig = {};
    themeConfig.fontPair = fontPairId;
    try {
      await MastDB._ref('public/config/theme/fontPair').set(fontPairId);
      markUnpublished();
      showToast('Font pair updated.');
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
    renderWebsite();
  };

  window.wpToggleManifestSection = async function(sectionId, enabled) {
    // Write to both nav config and webPresence sections config
    try {
      await MastDB._ref('public/config/nav/sections/' + sectionId + '/enabled').set(enabled);
      // Also keep webPresence sections in sync
      if (!websiteConfig.sections) websiteConfig.sections = {};
      if (!websiteConfig.sections[sectionId]) websiteConfig.sections[sectionId] = {};
      websiteConfig.sections[sectionId].enabled = enabled;
      await MastDB._ref('webPresence/config/sections/' + sectionId + '/enabled').set(enabled);
      markUnpublished();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  // ── Fallback handlers (write to webPresence/config — original paths) ──

  window.wpSelectStyle = async function(styleId) {
    websiteConfig.style = styleId;
    STYLE_DEFS.forEach(function(s) {
      if (s.id === styleId) websiteConfig.fontPair = s.font;
    });
    await MastDB._ref('webPresence/config/style').set(styleId);
    await MastDB._ref('webPresence/config/fontPair').set(websiteConfig.fontPair);
    markUnpublished();
    renderWebsite();
  };

  window.wpUpdateColor = function(field, value) {
    websiteConfig[field] = value;
    debounce('color-' + field, function() {
      MastDB._ref('webPresence/config/' + field).set(value);
      markUnpublished();
    }, 400);
  };

  window.wpUpdateFont = function(value) {
    websiteConfig.fontPair = value;
    MastDB._ref('webPresence/config/fontPair').set(value);
    markUnpublished();
  };

  window.wpToggleSection = function(key, enabled) {
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections[key]) websiteConfig.sections[key] = {};
    websiteConfig.sections[key].enabled = enabled;
    MastDB._ref('webPresence/config/sections/' + key + '/enabled').set(enabled);
    markUnpublished();
  };

  window.wpToggleSectionExpand = function(key) {
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections[key]) websiteConfig.sections[key] = {};
    websiteConfig.sections[key]._expanded = !websiteConfig.sections[key]._expanded;
    renderWebsite();
  };

  window.wpUpdateField = function(sectionKey, fieldId, value) {
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections[sectionKey]) websiteConfig.sections[sectionKey] = {};
    websiteConfig.sections[sectionKey][fieldId] = value;
    debounce('field-' + sectionKey + '-' + fieldId, function() {
      MastDB._ref('webPresence/config/sections/' + sectionKey + '/' + fieldId).set(value);
      markUnpublished();
    });
  };

  window.wpUpdateSocial = function(platform, value) {
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.contact) websiteConfig.sections.contact = {};
    if (!websiteConfig.sections.contact.socialLinks) websiteConfig.sections.contact.socialLinks = {};
    websiteConfig.sections.contact.socialLinks[platform] = value;
    debounce('social-' + platform, function() {
      MastDB._ref('webPresence/config/sections/contact/socialLinks/' + platform).set(value);
      markUnpublished();
    });
  };

  window.wpPickImage = function(sectionKey, fieldId) {
    if (typeof openImagePicker === 'function') {
      openImagePicker(function(imgId, url) {
        if (!websiteConfig.sections) websiteConfig.sections = {};
        if (!websiteConfig.sections[sectionKey]) websiteConfig.sections[sectionKey] = {};
        websiteConfig.sections[sectionKey][fieldId] = url;
        MastDB._ref('webPresence/config/sections/' + sectionKey + '/' + fieldId).set(url);
        markUnpublished();
        renderWebsite();
      });
    } else {
      showToast('Image picker not available.', true);
    }
  };

  window.wpAnalyze = async function() {
    var url = document.getElementById('wpImportUrl').value.trim();
    if (!url) { showToast('Please enter a URL.', true); return; }

    var btn = document.getElementById('wpAnalyzeBtn');
    var statusEl = document.getElementById('wpAnalyzeStatus');
    var resultsEl = document.getElementById('wpAnalyzeResults');

    if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--warm-gray);">Analyzing site... This may take 30-60 seconds.</span>';
    if (resultsEl) resultsEl.innerHTML = '';

    try {
      var result = await firebase.functions().httpsCallable('analyzeExistingSite')({
        url: url, tenantId: MastDB.tenantId()
      });
      var data = result.data;
      var analysis = data.analysis || {};

      if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">&#10003; Analysis complete!</span>';

      // Show results with apply buttons
      var rhtml = '';
      if (analysis.businessName) {
        rhtml += '<div class="wp-import-result"><strong>Business:</strong> ' + esc(analysis.businessName);
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplyImport(\'meta.siteTitle\', \'' + esc(analysis.businessName).replace(/'/g, "\\'") + '\')">Apply</button></div>';
      }
      if (analysis.styleRecommendation) {
        rhtml += '<div class="wp-import-result"><strong>Recommended Style:</strong> ' + esc(analysis.styleRecommendation);
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpSelectStyle(\'' + esc(analysis.styleRecommendation) + '\')">Apply</button></div>';
      }
      if (analysis.colors) {
        rhtml += '<div class="wp-import-result"><strong>Colors:</strong> ';
        if (analysis.colors.primary) rhtml += '<span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:' + esc(analysis.colors.primary) + ';vertical-align:middle;margin-right:4px;"></span>' + esc(analysis.colors.primary) + ' ';
        if (analysis.colors.accent) rhtml += '<span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:' + esc(analysis.colors.accent) + ';vertical-align:middle;margin-right:4px;"></span>' + esc(analysis.colors.accent);
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplyColors(\'' + esc(analysis.colors.primary || '') + '\', \'' + esc(analysis.colors.accent || '') + '\')">Apply</button></div>';
      }
      if (analysis.hero && analysis.hero.headline) {
        rhtml += '<div class="wp-import-result"><strong>Hero:</strong> ' + esc(analysis.hero.headline);
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplyHero()">Apply</button></div>';
        // Store for apply
        window._wpImportHero = analysis.hero;
      }
      if (analysis.aboutText) {
        rhtml += '<div class="wp-import-result"><strong>About:</strong> ' + esc(analysis.aboutText.substring(0, 150)) + '...';
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplyAbout()">Apply</button></div>';
        window._wpImportAbout = analysis.aboutText;
      }
      if (analysis.contactInfo && (analysis.contactInfo.email || analysis.contactInfo.phone)) {
        rhtml += '<div class="wp-import-result"><strong>Contact:</strong> ';
        if (analysis.contactInfo.email) rhtml += esc(analysis.contactInfo.email) + ' ';
        if (analysis.contactInfo.phone) rhtml += esc(analysis.contactInfo.phone);
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplyContact()">Apply</button></div>';
        window._wpImportContact = analysis.contactInfo;
      }
      if (analysis.socialLinks) {
        var socialCount = Object.values(analysis.socialLinks).filter(function(v) { return v; }).length;
        if (socialCount > 0) {
          rhtml += '<div class="wp-import-result"><strong>Social Links:</strong> ' + socialCount + ' found';
          rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplySocial()">Apply</button></div>';
          window._wpImportSocial = analysis.socialLinks;
        }
      }

      if (resultsEl) resultsEl.innerHTML = rhtml;
      // Reload config since analysis also seeds it
      await loadWebsiteConfig();
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);">Error: ' + esc(err.message) + '</span>';
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Analyze'; }
  };

  // ── Import apply handlers ──

  window.wpApplyImport = function(path, value) {
    var parts = path.split('.');
    if (parts.length === 2) {
      if (!websiteConfig[parts[0]]) websiteConfig[parts[0]] = {};
      websiteConfig[parts[0]][parts[1]] = value;
      MastDB._ref('webPresence/config/' + parts[0] + '/' + parts[1]).set(value);
    } else {
      websiteConfig[path] = value;
      MastDB._ref('webPresence/config/' + path).set(value);
    }
    markUnpublished();
    showToast('Applied!');
  };

  window.wpApplyColors = function(primary, accent) {
    if (primary) { websiteConfig.primaryColor = primary; MastDB._ref('webPresence/config/primaryColor').set(primary); }
    if (accent) { websiteConfig.accentColor = accent; MastDB._ref('webPresence/config/accentColor').set(accent); }
    markUnpublished();
    showToast('Colors applied!');
  };

  window.wpApplyHero = function() {
    var hero = window._wpImportHero;
    if (!hero) return;
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.hero) websiteConfig.sections.hero = {};
    if (hero.headline) { websiteConfig.sections.hero.headline = hero.headline; MastDB._ref('webPresence/config/sections/hero/headline').set(hero.headline); }
    if (hero.subheadline) { websiteConfig.sections.hero.subheadline = hero.subheadline; MastDB._ref('webPresence/config/sections/hero/subheadline').set(hero.subheadline); }
    if (hero.ctaText) { websiteConfig.sections.hero.ctaText = hero.ctaText; MastDB._ref('webPresence/config/sections/hero/ctaText').set(hero.ctaText); }
    markUnpublished();
    showToast('Hero content applied!');
  };

  window.wpApplyAbout = function() {
    var text = window._wpImportAbout;
    if (!text) return;
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.about) websiteConfig.sections.about = {};
    websiteConfig.sections.about.body = text;
    MastDB._ref('webPresence/config/sections/about/body').set(text);
    markUnpublished();
    showToast('About content applied!');
  };

  window.wpApplyContact = function() {
    var contact = window._wpImportContact;
    if (!contact) return;
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.contact) websiteConfig.sections.contact = {};
    ['email', 'phone', 'address'].forEach(function(f) {
      if (contact[f]) {
        websiteConfig.sections.contact[f] = contact[f];
        MastDB._ref('webPresence/config/sections/contact/' + f).set(contact[f]);
      }
    });
    markUnpublished();
    showToast('Contact info applied!');
  };

  window.wpApplySocial = function() {
    var social = window._wpImportSocial;
    if (!social) return;
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.contact) websiteConfig.sections.contact = {};
    if (!websiteConfig.sections.contact.socialLinks) websiteConfig.sections.contact.socialLinks = {};
    Object.keys(social).forEach(function(p) {
      if (social[p]) {
        websiteConfig.sections.contact.socialLinks[p] = social[p];
        MastDB._ref('webPresence/config/sections/contact/socialLinks/' + p).set(social[p]);
      }
    });
    markUnpublished();
    showToast('Social links applied!');
  };

  // ── Import review handlers ──

  window.wpReviewTab = function(tab) {
    importReviewTab = tab;
    renderWebsite();
  };

  window.wpPublishProduct = async function(pid) {
    try {
      await MastDB._ref('public/products/' + pid + '/status').set('active');
      showToast('Product published!');
      await loadImportedProducts();
      renderWebsite();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  window.wpPublishAllProducts = async function() {
    if (!importedProducts) return;
    var drafts = importedProducts.filter(function(p) { return p.status === 'draft' && p.importedFrom; });
    if (drafts.length === 0) return;
    try {
      var updates = {};
      drafts.forEach(function(p) { updates['public/products/' + p.id + '/status'] = 'active'; });
      await MastDB._ref().update(updates);
      showToast(drafts.length + ' product' + (drafts.length !== 1 ? 's' : '') + ' published!');
      await loadImportedProducts();
      renderWebsite();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  window.wpDeleteProduct = async function(pid) {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    try {
      await MastDB._ref('public/products/' + pid).remove();
      showToast('Product deleted.');
      await loadImportedProducts();
      renderWebsite();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  window.wpRetryImport = async function(jobId) {
    try {
      await MastDB._ref('webPresence/importJobs/' + jobId + '/status').set('pending');
      await MastDB._ref('webPresence/importJobs/' + jobId + '/error').set(null);
      await MastDB._ref('webPresence/importJobs/' + jobId + '/claimedAt').set(null);
      showToast('Import job re-queued.');
      await loadImportJobs();
      renderWebsite();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  // ── New Import (Re-scan) ──
  window.wpStartImport = async function() {
    var url = document.getElementById('wpRescanUrl').value.trim();
    if (!url) { showToast('Please enter a URL.', true); return; }

    // Ensure URL has protocol
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    // Check for duplicate within 7 days
    var recentUrls = window._wpRecentImportUrls || {};
    if (recentUrls[url]) {
      if (!confirm('This URL was imported in the last 7 days. Import again?')) return;
    }

    var btn = document.getElementById('wpRescanBtn');
    var statusEl = document.getElementById('wpRescanStatus');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating import...'; }

    try {
      // First, run analyzeExistingSite to get the crawl manifest
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--warm-gray);">Analyzing site to build crawl plan...</span>';
      var result = await firebase.functions().httpsCallable('analyzeExistingSite')({
        url: url, tenantId: MastDB.tenantId()
      });

      // Get the crawl manifest from site analysis
      var snap = await MastDB._ref('webPresence/siteAnalysis/crawlManifest').once('value');
      var manifest = snap.val();

      // Create the import job in Firebase directly
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--warm-gray);">Queuing import job...</span>';
      var jobRef = MastDB._ref('webPresence/importJobs').push();
      var jobId = jobRef.key;
      var now = new Date().toISOString();
      await jobRef.set({
        id: jobId,
        url: url,
        tenantId: MastDB.tenantId(),
        status: 'pending',
        createdAt: now,
        claimedAt: null,
        completedAt: null,
        error: null,
        notifyPhone: null,
        crawlManifest: manifest || null,
        discovered: null,
        imported: null
      });

      if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">&#10003; Import queued! It will be processed within 30 minutes.</span>';
      showToast('Import job created successfully.');
      await loadImportJobs();
      renderWebsite();
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);">Error: ' + esc(err.message) + '</span>';
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Scan & Import'; }
  };

  // ── Cherry-pick helpers ──
  function getCherryPick(jobId, type, key) {
    if (!cherryPickSelections[jobId]) return true; // default: all selected
    if (!cherryPickSelections[jobId][type]) return true;
    return cherryPickSelections[jobId][type][key] !== false;
  }

  window.wpToggleCherryPick = function(jobId, type, key, checked) {
    if (!cherryPickSelections[jobId]) cherryPickSelections[jobId] = {};
    if (!cherryPickSelections[jobId][type]) cherryPickSelections[jobId][type] = {};
    cherryPickSelections[jobId][type][key] = checked;
  };

  window.wpCherryPickAll = function(jobId, type, selectAll) {
    if (!cherryPickSelections[jobId]) cherryPickSelections[jobId] = {};
    cherryPickSelections[jobId][type] = {};
    // Find all items and set them
    var job = importJobs && importJobs.find(function(j) { return j.id === jobId; });
    if (job && job.discovered && job.discovered[type] && job.discovered[type].pages) {
      job.discovered[type].pages.forEach(function(p, idx) {
        cherryPickSelections[jobId][type][p.url || String(idx)] = selectAll;
      });
    }
    renderWebsite();
  };

  window.wpImportAll = async function(jobId) {
    // Set status to importing — the scheduled task will pick it up
    try {
      await MastDB._ref('webPresence/importJobs/' + jobId + '/status').set('importing');
      showToast('Import started for all items.');
      await loadImportJobs();
      renderWebsite();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  window.wpImportCherryPicked = async function(jobId) {
    // Save cherry-pick selections to the job, then set status to importing
    var selections = cherryPickSelections[jobId] || {};
    try {
      // Write the selection filter to the job
      var excludeUrls = [];
      if (selections.products) {
        Object.keys(selections.products).forEach(function(key) {
          if (selections.products[key] === false) excludeUrls.push(key);
        });
      }
      if (excludeUrls.length > 0) {
        await MastDB._ref('webPresence/importJobs/' + jobId + '/cherryPickExclude').set(excludeUrls);
      }
      await MastDB._ref('webPresence/importJobs/' + jobId + '/status').set('importing');
      showToast('Importing selected items.');
      await loadImportJobs();
      renderWebsite();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  // ── History detail toggle ──
  window.wpToggleHistoryDetail = function(jobId) {
    expandedJobId = expandedJobId === jobId ? null : jobId;
    renderWebsite();
  };

  // ── Helpers ──

  function formatTimeAgo(isoStr) {
    if (!isoStr) return '';
    var diff = Date.now() - new Date(isoStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  // ── Category management handlers ──

  window.wpCatAdd = async function() {
    var labelEl = document.getElementById('wpCatNewLabel');
    var wholesaleEl = document.getElementById('wpCatNewWholesale');
    var errorEl = document.getElementById('wpCatAddError');
    if (!labelEl) return;

    var label = labelEl.value.trim();
    if (!label) {
      if (errorEl) { errorEl.textContent = 'Label is required.'; errorEl.style.display = 'block'; }
      return;
    }

    var slug = slugify(label);
    if (!slug) {
      if (errorEl) { errorEl.textContent = 'Could not generate a valid ID from that label.'; errorEl.style.display = 'block'; }
      return;
    }

    // Ensure uniqueness
    var baseSlug = slug;
    var suffix = 2;
    while (!isSlugUnique(slug, -1)) {
      slug = baseSlug + '-' + suffix;
      suffix++;
    }

    var newCat = { id: slug, label: label };
    var wholesale = wholesaleEl ? wholesaleEl.value.trim() : '';
    if (wholesale) newCat.wholesaleGroup = wholesale;

    tenantCategories.push(newCat);
    await saveCategories();
    showToast('Category "' + label + '" added.');
    renderWebsite();
  };

  window.wpCatEdit = function(idx) {
    editingCategoryIdx = idx;
    renderWebsite();
  };

  window.wpCatCancelEdit = function() {
    editingCategoryIdx = null;
    renderWebsite();
  };

  window.wpCatSaveEdit = async function(idx) {
    var labelEl = document.getElementById('wpCatEditLabel');
    var wholesaleEl = document.getElementById('wpCatEditWholesale');
    if (!labelEl || !tenantCategories[idx]) return;

    var label = labelEl.value.trim();
    if (!label) { showToast('Label is required.', true); return; }

    tenantCategories[idx].label = label;
    tenantCategories[idx].wholesaleGroup = wholesaleEl ? wholesaleEl.value.trim() || null : null;
    // Clean up null wholesaleGroup
    if (!tenantCategories[idx].wholesaleGroup) delete tenantCategories[idx].wholesaleGroup;

    editingCategoryIdx = null;
    await saveCategories();
    showToast('Category updated.');
    renderWebsite();
  };

  window.wpCatDelete = async function(idx) {
    if (!tenantCategories[idx]) return;
    var label = tenantCategories[idx].label;
    if (!confirm('Delete category "' + label + '"? Products in this category will need to be recategorized.')) return;
    tenantCategories.splice(idx, 1);
    await saveCategories();
    showToast('Category "' + label + '" deleted.');
    renderWebsite();
  };

  window.wpCatMove = async function(idx, direction) {
    var newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= tenantCategories.length) return;
    var temp = tenantCategories[idx];
    tenantCategories[idx] = tenantCategories[newIdx];
    tenantCategories[newIdx] = temp;
    // Update editing index if needed
    if (editingCategoryIdx === idx) editingCategoryIdx = newIdx;
    else if (editingCategoryIdx === newIdx) editingCategoryIdx = idx;
    await saveCategories();
    renderWebsite();
  };

  function markUnpublished() {
    if (websiteConfig.status === 'published') {
      websiteConfig.status = 'draft';
      MastDB._ref('webPresence/config/status').set('draft');
    }
    MastDB._ref('webPresence/config/updatedAt').set(new Date().toISOString());
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Register Module ──
  MastAdmin.registerModule('website', {
    routes: {
      'website': { tab: 'websiteTab', setup: function() { renderWebsite(); } }
    }
  });
})();
