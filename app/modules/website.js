(function() {
  'use strict';

  var websiteLoaded = false;
  var websiteConfig = null;
  var importJobs = null;
  var importedProducts = null;
  var currentSubTab = 'overview';
  var importReviewTab = 'products';
  var importJobsListener = null;
  var cherryPickSelections = {}; // jobId -> { products: {url: bool}, images: {url: bool}, ... }
  var expandedJobId = null; // for import history detail view

  // ── Style definitions ──
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
      await loadImportJobs();
      await loadImportedProducts();
      startImportJobsListener();
      websiteLoaded = true;
    }

    var html = '<div class="section-header"><h2>Website</h2></div>';

    // Sub-tabs
    html += '<div class="wp-sub-tabs">';
    html += '<button class="wp-sub-tab' + (currentSubTab === 'overview' ? ' active' : '') + '" onclick="wpSwitchTab(\'overview\')">Overview</button>';
    html += '<button class="wp-sub-tab' + (currentSubTab === 'style' ? ' active' : '') + '" onclick="wpSwitchTab(\'style\')">Style</button>';
    html += '<button class="wp-sub-tab' + (currentSubTab === 'sections' ? ' active' : '') + '" onclick="wpSwitchTab(\'sections\')">Sections</button>';
    html += '<button class="wp-sub-tab' + (currentSubTab === 'import' ? ' active' : '') + '" onclick="wpSwitchTab(\'import\')">Import</button>';
    html += '</div>';

    // Tab content
    html += '<div id="wpTabContent">';
    if (currentSubTab === 'overview') html += renderOverviewTab();
    else if (currentSubTab === 'style') html += renderStyleTab();
    else if (currentSubTab === 'sections') html += renderSectionsTab();
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
    STYLE_DEFS.forEach(function(s) {
      if (s.id === websiteConfig.style) styleName = s.name;
    });

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
    html += '<button class="btn btn-primary" onclick="wpPublish()" id="wpPublishBtn">Publish Changes</button>';
    html += '<span id="wpPublishStatus" style="margin-left:12px;font-size:0.85rem;"></span>';
    html += '</div>';

    return html;
  }

  // ── Style Tab ──
  function renderStyleTab() {
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
        // Social links special case for contact section
        if (def.key === 'contact') {
          html += renderSocialLinks(sectionData.socialLinks || {});
        }
        html += '</div>';
      }
    });

    // Reorder controls
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
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Items imported as drafts. Publish them to make them live on your site.</p>';

    // Review sub-tabs
    html += '<div style="display:flex;gap:8px;margin-bottom:16px;">';
    ['products', 'images', 'blog', 'events'].forEach(function(t) {
      var active = importReviewTab === t;
      var label = t.charAt(0).toUpperCase() + t.slice(1);
      html += '<button class="btn ' + (active ? 'btn-primary' : 'btn-secondary') + '" onclick="wpReviewTab(\'' + t + '\')" style="font-size:0.8rem;padding:6px 14px;">' + label + '</button>';
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

  window.wpSelectStyle = async function(styleId) {
    websiteConfig.style = styleId;
    // Find recommended font pair for this style
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
    if (!confirm('Delete this imported product?')) return;
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
