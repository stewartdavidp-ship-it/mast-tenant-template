/**
 * Brand & Logo Module — Master-Detail Layout
 * Lazy-loaded via MastAdmin module registry.
 *
 * Layout: Detail panel (top) + Logo type grid (middle) + Placements (bottom)
 * Click a logo type in the grid to focus it in the detail panel.
 */
(function() {
  'use strict';

  var brandLoaded = false;
  var logoConfig = null;
  var legacyLogoUrl = null;
  var selectedType = 'primary'; // which logo type is focused in detail panel
  var activeTab = 'logos'; // 'logos' or 'placements'

  // All logo types — primary + variants, treated equally in the grid
  var LOGO_TYPES = [
    { key: 'primary', label: 'Primary', desc: 'Original uploaded logo', bg: 'var(--surface-dark)', autoGen: false, isUpload: true },
    { key: 'transparent', label: 'Transparent', desc: 'White background removed', bg: 'var(--surface-dark)', autoGen: true, isUpload: false },
    { key: 'light', label: 'Light', desc: 'For dark backgrounds', bg: '#1a1a2e', autoGen: false, isUpload: true },
    { key: 'dark', label: 'Dark', desc: 'For light backgrounds', bg: '#f5f5f5', autoGen: false, isUpload: true },
    { key: 'icon', label: 'Icon', desc: 'Square 180x180 (favicon, social)', bg: 'var(--surface-card)', autoGen: true, isUpload: false },
    { key: 'email', label: 'Email', desc: 'Max 600px wide (email headers)', bg: '#ffffff', autoGen: true, isUpload: false }
  ];

  var PLACEMENTS = [
    { key: 'navBar', label: 'Navigation Bar', defaultHeight: 48 },
    { key: 'hero', label: 'Hero Banner', defaultHeight: 120 },
    { key: 'footer', label: 'Footer', defaultHeight: 60 },
    { key: 'email', label: 'Email Header', defaultHeight: 60 },
    { key: 'favicon', label: 'Favicon', defaultHeight: 32 }
  ];

  // ─── Data Loading ───

  async function loadBrandData() {
    try {
      logoConfig = (await MastDB.get('config/brand/logo')) || null;
      legacyLogoUrl = (await MastDB.get('public/config/nav/logoUrl')) || null;
    } catch (err) {
      console.warn('[Brand] Failed to load:', err.message);
      logoConfig = null;
      legacyLogoUrl = null;
    }
    brandLoaded = true;
    renderBrand();
  }

  // ─── Helpers ───

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '--';
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (_) { return iso; }
  }

  function getTypeData(key) {
    if (key === 'primary') return (logoConfig && logoConfig.primary) || null;
    return (logoConfig && logoConfig.variants && logoConfig.variants[key]) || null;
  }

  function getTypeUrl(key) {
    var data = getTypeData(key);
    return data ? data.url : null;
  }

  function getAvailableVariantKeys() {
    var keys = [];
    if (logoConfig && logoConfig.primary) keys.push('primary');
    if (logoConfig && logoConfig.variants) {
      Object.keys(logoConfig.variants).forEach(function(k) { keys.push(k); });
    }
    return keys;
  }

  // ─── Main Render ───

  function renderBrand() {
    var el = document.getElementById('brandContent');
    if (!el) return;

    if (!brandLoaded) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--warm-gray);">Loading brand configuration...</div>';
      return;
    }

    var html = '<div style="max-width:900px;margin:0 auto;padding:16px 0;">';
    html += '<div class="section-header" style="margin-bottom:16px;"><h2>Brand</h2></div>';

    // Sub-tabs
    var logosActive = activeTab === 'logos';
    var placementsActive = activeTab === 'placements';
    var tabStyle = 'padding:8px 20px;border:none;border-bottom:2px solid transparent;background:none;cursor:pointer;font-size:0.9rem;';
    var activeStyle = tabStyle + 'color:var(--teal);border-bottom-color:var(--teal);font-weight:600;';
    var inactiveStyle = tabStyle + 'color:var(--warm-gray);';

    html += '<div style="display:flex;gap:4px;border-bottom:1px solid var(--warm-gray-dark);margin-bottom:20px;">' +
      '<button onclick="brandSwitchTab(\'logos\')" style="' + (logosActive ? activeStyle : inactiveStyle) + '">Logos</button>' +
      '<button onclick="brandSwitchTab(\'placements\')" style="' + (placementsActive ? activeStyle : inactiveStyle) + '">Placements</button>' +
    '</div>';

    if (logosActive) {
      html += renderDetailPanel();
      html += renderTypeGrid();
    } else {
      html += renderPlacementTable();
    }

    html += '</div>';
    el.innerHTML = html;
  }

  // ─── Detail Panel (top — shows selected type) ───

  function renderDetailPanel() {
    var typeDef = LOGO_TYPES.find(function(t) { return t.key === selectedType; }) || LOGO_TYPES[0];
    var data = getTypeData(selectedType);
    var hasData = !!data;

    var html = '<div style="background:var(--surface-card);border-radius:8px;padding:20px;margin-bottom:20px;">';

    // Header row with type name + badge
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">' +
      '<h3 style="margin:0;font-size:1.15rem;color:var(--text-primary);">' + esc(typeDef.label) + '</h3>' +
      '<span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(typeDef.desc) + '</span>';
    if (hasData) {
      var source = selectedType === 'primary' ? 'Uploaded' : (data.generatedFrom === 'primary' ? 'Auto-generated' : 'Manual');
      html += '<span class="status-badge pill" style="background:rgba(42,124,111,0.15);color:var(--teal);font-size:0.72rem;">' + source + '</span>';
    } else {
      html += '<span class="status-badge pill" style="background:rgba(196,133,60,0.15);color:var(--amber);font-size:0.72rem;">Not configured</span>';
    }
    html += '</div>';

    if (!hasData) {
      // Empty state with actions
      html += '<div style="display:flex;gap:16px;align-items:center;padding:32px 0;flex-wrap:wrap;">' +
        '<div style="background:' + typeDef.bg + ';border-radius:8px;width:200px;height:120px;display:flex;align-items:center;justify-content:center;">' +
          '<span style="font-size:0.78rem;color:var(--warm-gray);">No image</span>' +
        '</div>' +
        '<div>';

      if (selectedType === 'primary') {
        html += '<button class="btn btn-primary" onclick="brandUploadLogoPrompt(\'primary\')">Upload Logo</button>';
      } else if (typeDef.autoGen) {
        var hasPrimary = !!(logoConfig && logoConfig.primary);
        if (hasPrimary) {
          html += '<button class="btn btn-primary" onclick="brandGenerateVariant(\'' + selectedType + '\')">Generate from Primary</button>';
          html += '<div style="margin-top:8px;"><button class="btn btn-secondary" onclick="brandUploadLogoPrompt(\'' + selectedType + '\')" style="font-size:0.78rem;">Or upload manually</button></div>';
        } else {
          html += '<div style="color:var(--warm-gray);font-size:0.85rem;">Upload a primary logo first</div>';
        }
      } else {
        html += '<button class="btn btn-primary" onclick="brandUploadLogoPrompt(\'' + selectedType + '\')">Upload ' + esc(typeDef.label) + ' Variant</button>';
      }

      html += '</div></div>';
    } else {
      // Show image + metadata + actions
      html += '<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;">' +
        '<div style="background:' + typeDef.bg + ';border-radius:8px;padding:16px;display:flex;align-items:center;justify-content:center;min-width:200px;min-height:120px;">' +
          '<img src="' + esc(data.url) + '" alt="' + esc(typeDef.label) + '" style="max-width:300px;max-height:150px;object-fit:contain;" onerror="this.style.display=\'none\'">' +
        '</div>' +
        '<div style="flex:1;min-width:200px;">' +
          '<div style="display:grid;gap:6px;font-size:0.85rem;">';

      if (data.format) html += '<div><span style="color:var(--warm-gray);">Format:</span> ' + esc(data.format) + (data.hasTransparency ? ' <span style="color:var(--teal);">(transparent)</span>' : '') + '</div>';
      if (data.dimensions) html += '<div><span style="color:var(--warm-gray);">Dimensions:</span> ' + data.dimensions.width + ' x ' + data.dimensions.height + 'px</div>';
      if (data.uploadedAt || data.createdAt) html += '<div><span style="color:var(--warm-gray);">Created:</span> ' + formatDate(data.uploadedAt || data.createdAt) + '</div>';

      html += '</div>' +
        '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary" onclick="brandUploadLogoPrompt(\'' + selectedType + '\')" style="font-size:0.78rem;padding:4px 12px;">Replace</button>';

      // Generate button for auto-gen types
      if (selectedType !== 'primary' && typeDef.autoGen && logoConfig && logoConfig.primary) {
        html += '<button class="btn btn-secondary" onclick="brandGenerateVariant(\'' + selectedType + '\')" style="font-size:0.78rem;padding:4px 12px;">Regenerate</button>';
      }

      // Delete button for variants (not primary)
      if (selectedType !== 'primary') {
        html += '<button class="btn btn-secondary" onclick="brandDeleteVariant(\'' + selectedType + '\')" style="font-size:0.78rem;padding:4px 12px;color:var(--red,#ef4444);">Delete</button>';
      }

      html += '</div></div></div>';
    }

    html += '</div>';
    return html;
  }

  // ─── Logo Type Grid (all 6 types as clickable cards) ───

  function renderTypeGrid() {
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));gap:10px;margin-bottom:20px;">';

    LOGO_TYPES.forEach(function(lt) {
      var data = getTypeData(lt.key);
      var isSelected = lt.key === selectedType;
      var borderColor = isSelected ? 'var(--teal)' : 'var(--warm-gray-dark)';
      var borderWidth = isSelected ? '2px' : '1px';

      html += '<div onclick="brandSelectType(\'' + lt.key + '\')" style="cursor:pointer;border:' + borderWidth + ' solid ' + borderColor + ';border-radius:8px;overflow:hidden;transition:border-color 0.15s;">' +
        '<div style="background:' + lt.bg + ';height:70px;display:flex;align-items:center;justify-content:center;padding:6px;">';

      if (data) {
        html += '<img src="' + esc(data.url) + '" alt="" style="max-width:100%;max-height:58px;object-fit:contain;" onerror="this.parentElement.innerHTML=\'&#10060;\'">';
      } else {
        html += '<span style="font-size:0.72rem;color:var(--warm-gray);">Empty</span>';
      }

      html += '</div>' +
        '<div style="padding:6px 8px;text-align:center;">' +
          '<div style="font-size:0.78rem;font-weight:600;color:' + (isSelected ? 'var(--teal)' : 'var(--text-primary)') + ';">' + esc(lt.label) + '</div>' +
        '</div></div>';
    });

    html += '</div>';
    return html;
  }

  // ─── Placement Table ───

  function renderPlacementTable() {
    var placements = (logoConfig && logoConfig.placements) || {};
    var availableKeys = getAvailableVariantKeys();

    var html = '<div style="background:var(--surface-card);border-radius:8px;padding:20px;">' +
      '<h3 style="margin:0 0 16px;font-size:1.15rem;color:var(--text-primary);">Placement Assignments</h3>';

    if (!logoConfig || !logoConfig.primary) {
      html += '<div style="color:var(--warm-gray);font-size:0.85rem;">Upload a primary logo first to configure placements.</div></div>';
      return html;
    }

    html += '<div style="display:grid;gap:10px;">';

    PLACEMENTS.forEach(function(p) {
      var config = placements[p.key] || {};
      var currentKey = config.variantKey || '';
      var currentHeight = config.maxHeight || p.defaultHeight;
      var resolvedUrl = currentKey ? getTypeUrl(currentKey) : getTypeUrl('primary');

      html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface-dark);border-radius:6px;flex-wrap:wrap;">' +
        '<div style="width:50px;height:34px;background:var(--surface-card);border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
      if (resolvedUrl) {
        html += '<img src="' + esc(resolvedUrl) + '" alt="" style="max-width:46px;max-height:30px;object-fit:contain;" onerror="this.style.display=\'none\'">';
      } else {
        html += '<span style="font-size:0.72rem;color:var(--warm-gray);">--</span>';
      }
      html += '</div>' +
        '<div style="min-width:110px;flex-shrink:0;font-size:0.85rem;font-weight:600;color:var(--text-primary);">' + esc(p.label) + '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex:1;min-width:200px;">' +
          '<select id="brandPlacement_' + p.key + '_variant" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-card);color:var(--text-primary);font-size:0.78rem;">';

      availableKeys.forEach(function(k) {
        var selected = (k === currentKey) ? ' selected' : '';
        var label = k === 'primary' ? 'Primary' : k.charAt(0).toUpperCase() + k.slice(1);
        html += '<option value="' + esc(k) + '"' + selected + '>' + label + '</option>';
      });

      html += '</select>' +
          '<input type="number" id="brandPlacement_' + p.key + '_height" value="' + currentHeight + '" min="16" max="200" style="width:55px;padding:4px 6px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-card);color:var(--text-primary);font-size:0.78rem;" title="Max height (px)">' +
          '<span style="font-size:0.72rem;color:var(--warm-gray);">px</span>' +
          '<button class="btn btn-primary" onclick="brandSavePlacement(\'' + p.key + '\')" style="font-size:0.78rem;padding:4px 10px;">Save</button>' +
        '</div></div>';
    });

    html += '</div></div>';
    return html;
  }

  // ─── Actions ───

  window.brandSwitchTab = function(tab) {
    activeTab = tab;
    renderBrand();
  };

  window.brandSelectType = function(typeKey) {
    selectedType = typeKey;
    renderBrand();
  };

  window.brandSavePlacement = async function(placementKey) {
    var variantEl = document.getElementById('brandPlacement_' + placementKey + '_variant');
    var heightEl = document.getElementById('brandPlacement_' + placementKey + '_height');
    if (!variantEl) return;
    try {
      await MastDB.set('config/brand/logo/placements/' + placementKey, {
        variantKey: variantEl.value,
        maxHeight: parseInt(heightEl ? heightEl.value : '48', 10) || 48
      });
      await resolvePublicPlacements();
      showToast('Placement saved: ' + placementKey);
      await loadBrandData();
    } catch (err) {
      showToast('Failed to save placement: ' + err.message, true);
    }
  };

  window.brandGenerateVariant = async function(type) {
    showToast('Generating ' + type + ' variant...');
    // This is a placeholder — the actual generation goes through the MCP tool
    // which calls the Cloud Function. From the admin UI we just show guidance.
    showToast('Use your AI assistant to generate variants: generate_logo_variant type="' + type + '"', false);
  };

  window.brandDeleteVariant = async function(type) {
    if (!await mastConfirm('Delete the ' + type + ' variant?', { title: 'Delete Variant', danger: true })) return;
    try {
      // Delete from Storage if we have a path
      var data = getTypeData(type);
      // Remove config
      await MastDB.remove('config/brand/logo/variants/' + type);
      // Clear placements referencing this variant
      var placements = (await MastDB.get('config/brand/logo/placements')) || {};
      for (var key in placements) {
        if (placements[key] && placements[key].variantKey === type) {
          await MastDB.set('config/brand/logo/placements/' + key + '/variantKey', 'primary');
        }
      }
      await resolvePublicPlacements();
      showToast(type + ' variant deleted');
      selectedType = 'primary';
      brandLoaded = false;
      await loadBrandData();
    } catch (err) {
      showToast('Delete failed: ' + err.message, true);
    }
  };

  // ─── Upload Actions ───

  window.brandUploadLogoPrompt = function(targetType) {
    targetType = targetType || 'primary';
    var typeDef = LOGO_TYPES.find(function(t) { return t.key === targetType; }) || LOGO_TYPES[0];
    var title = targetType === 'primary' ? 'Upload Logo' : 'Upload ' + typeDef.label + ' Variant';

    var html = '<div class="modal-header"><h3 style="margin:0;">' + esc(title) + '</h3></div>' +
      '<div class="modal-body" style="display:grid;gap:16px;">' +
        '<div>' +
          '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Image URL</label>' +
          '<input type="text" id="brandLogoUrlInput" placeholder="https://example.com/logo.png" style="width:100%;padding:8px 12px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-card);color:var(--text-primary);font-size:0.9rem;">' +
          '<input type="hidden" id="brandLogoTargetType" value="' + esc(targetType) + '">' +
        '</div>' +
        '<div style="text-align:center;color:var(--warm-gray);font-size:0.78rem;">— or —</div>' +
        '<div style="text-align:center;">' +
          '<button class="btn btn-secondary" onclick="brandPickFromLibrary(\'' + esc(targetType) + '\')" style="font-size:0.85rem;">Choose from Image Library</button>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="brandUploadLogoFromUrl()">Upload</button>' +
      '</div>';
    openModal(html);
    setTimeout(function() { var el = document.getElementById('brandLogoUrlInput'); if (el) el.focus(); }, 100);
  };

  window.brandUploadLogoFromUrl = async function() {
    var input = document.getElementById('brandLogoUrlInput');
    var targetInput = document.getElementById('brandLogoTargetType');
    var url = input ? input.value.trim() : '';
    var targetType = targetInput ? targetInput.value : 'primary';
    if (!url) { showToast('Please enter an image URL', true); return; }

    closeModal();
    showToast('Uploading...');

    try {
      var uploadResult = await uploadImageToStorage(url);
      if (!uploadResult || !uploadResult.url) throw new Error('Upload failed');

      var config = {
        url: uploadResult.url,
        storagePath: uploadResult.storagePath || '',
        format: uploadResult.format || 'png',
        hasTransparency: false,
        dimensions: uploadResult.dimensions || null
      };

      if (targetType === 'primary') {
        config.uploadedAt = new Date().toISOString();
        await MastDB.set('config/brand/logo/primary', config);
        await MastDB.set('public/config/nav/logoUrl', uploadResult.url);
      } else {
        config.generatedFrom = 'manual';
        config.createdAt = new Date().toISOString();
        await MastDB.set('config/brand/logo/variants/' + targetType, config);
      }

      await resolvePublicPlacements();
      showToast('Uploaded successfully');
      selectedType = targetType;
      brandLoaded = false;
      await loadBrandData();
    } catch (err) {
      showToast('Upload failed: ' + err.message, true);
    }
  };

  window.brandPickFromLibrary = function(targetType) {
    closeModal();
    if (typeof openImagePicker === 'function') {
      openImagePicker(async function(imgId, url) {
        showToast('Setting from library...');
        try {
          var config = {
            url: url,
            storagePath: '',
            format: url.match(/\.(\w+)(?:\?|$)/i) ? RegExp.$1 : 'png',
            hasTransparency: false,
            dimensions: null
          };

          if (targetType === 'primary') {
            config.uploadedAt = new Date().toISOString();
            await MastDB.set('config/brand/logo/primary', config);
            await MastDB.set('public/config/nav/logoUrl', url);
          } else {
            config.generatedFrom = 'manual';
            config.createdAt = new Date().toISOString();
            await MastDB.set('config/brand/logo/variants/' + targetType, config);
          }

          await resolvePublicPlacements();
          showToast('Set from library');
          selectedType = targetType;
          brandLoaded = false;
          await loadBrandData();
        } catch (err) {
          showToast('Failed: ' + err.message, true);
        }
      });
    } else {
      showToast('Image library not available', true);
      brandUploadLogoPrompt(targetType);
    }
  };

  // ─── Storage Upload Helper ───

  async function uploadImageToStorage(url) {
    var user = firebase.auth().currentUser;
    if (!user) throw new Error('Not authenticated');
    var idToken = await user.getIdToken();
    var cfBase = 'https://us-central1-' + (TENANT_CONFIG && TENANT_CONFIG.gcpProject || 'mast-platform-prod') + '.cloudfunctions.net';
    var resp = await fetch(cfBase + '/uploadImage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
      body: JSON.stringify({ image: await fetchImageAsBase64(url), tags: ['logo'], source: 'brand-upload' })
    });
    if (!resp.ok) throw new Error('Upload returned ' + resp.status);
    var result = await resp.json();
    return { url: result.url, storagePath: result.storagePath || '', format: 'jpg', dimensions: result.dimensions || null };
  }

  async function fetchImageAsBase64(url) {
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch image');
    var blob = await resp.blob();
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result.split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ─── Placement Resolution ───

  async function resolvePublicPlacements() {
    if (!logoConfig) return;
    var primary = logoConfig.primary || {};
    var variants = logoConfig.variants || {};
    var placements = (await MastDB.get('config/brand/logo/placements')) || {};
    var updates = {};

    Object.keys(placements).forEach(function(placement) {
      var config = placements[placement];
      var vk = config && config.variantKey;
      if (!vk) return;
      var resolvedUrl = vk === 'primary' ? primary.url : (variants[vk] ? variants[vk].url : null);
      if (resolvedUrl) {
        updates['public/config/brand/logo/' + placement + '/url'] = resolvedUrl;
        updates['public/config/brand/logo/' + placement + '/maxHeight'] = config.maxHeight || null;
      }
    });

    if (placements.navBar && placements.navBar.variantKey) {
      var navKey = placements.navBar.variantKey;
      var navUrl = navKey === 'primary' ? primary.url : (variants[navKey] ? variants[navKey].url : null);
      if (navUrl) updates['public/config/nav/logoUrl'] = navUrl;
    }

    if (Object.keys(updates).length > 0) await MastDB.multiUpdate(updates);
  }

  // ─── Module Registration ───

  MastAdmin.registerModule('brand', {
    routes: {
      'brand': {
        tab: 'brandTab',
        setup: function() {
          if (!brandLoaded) loadBrandData();
          else renderBrand();
        }
      }
    }
  });

})();
