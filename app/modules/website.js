(function() {
  'use strict';

  var websiteLoaded = false;
  var websiteConfig = null;
  var currentSubTab = 'overview';

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

  // ── Render the full module ──
  async function renderWebsite() {
    var root = document.getElementById('websiteModuleRoot');
    if (!root) return;

    if (!websiteLoaded) {
      root.innerHTML = '<div class="loading">Loading website settings...</div>';
      await loadWebsiteConfig();
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
    html += '<div class="wp-overview-stat"><strong style="min-width:120px;">Site URL:</strong> <a href="' + esc(siteUrl) + '" target="_blank" rel="noopener">' + esc(siteUrl) + '</a></div>';
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
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Analyze a Website</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Enter a URL to analyze and import content into your site configuration.</p>';
    html += '<div class="wp-field-group">';
    html += '<label>Website URL</label>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<input type="url" id="wpImportUrl" placeholder="https://www.yourbusiness.com" style="flex:1;">';
    html += '<button class="btn btn-primary" onclick="wpAnalyze()" id="wpAnalyzeBtn">Analyze</button>';
    html += '</div></div>';
    html += '<div id="wpAnalyzeStatus" style="font-size:0.85rem;margin-bottom:16px;"></div>';
    html += '<div id="wpAnalyzeResults"></div>';

    return html;
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

  // ── Helpers ──

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
