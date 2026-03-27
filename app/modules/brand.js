/**
 * Brand & Logo Module
 * Lazy-loaded via MastAdmin module registry.
 *
 * Manages brand logo across all placements: nav, hero, footer, email, favicon.
 * Reads from: {tenantId}/config/brand/logo/
 * Writes to:  {tenantId}/config/brand/logo/placements/ (placement assignments only)
 *             {tenantId}/public/config/brand/logo/ (resolved public URLs)
 *             {tenantId}/public/config/nav/logoUrl (legacy compat)
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var brandLoaded = false;
  var logoConfig = null; // { primary, variants, placements }
  var legacyLogoUrl = null;

  var VARIANT_TYPES = [
    { key: 'transparent', label: 'Transparent', desc: 'White background removed', bg: 'var(--surface-dark)', autoGen: true },
    { key: 'light', label: 'Light', desc: 'For dark backgrounds (nav, dark hero)', bg: '#1a1a2e', autoGen: false },
    { key: 'dark', label: 'Dark', desc: 'For light backgrounds (email, receipts)', bg: '#f5f5f5', autoGen: false },
    { key: 'icon', label: 'Icon', desc: 'Square crop for favicon & social (180x180)', bg: 'var(--surface-card)', autoGen: true },
    { key: 'email', label: 'Email', desc: 'Sized for email headers (max 600px wide)', bg: '#ffffff', autoGen: true }
  ];

  var PLACEMENTS = [
    { key: 'navBar', label: 'Navigation Bar', defaultHeight: 48, defaultVariant: 'primary' },
    { key: 'hero', label: 'Hero Banner', defaultHeight: 120, defaultVariant: 'primary' },
    { key: 'footer', label: 'Footer', defaultHeight: 60, defaultVariant: 'primary' },
    { key: 'email', label: 'Email Header', defaultHeight: 60, defaultVariant: 'email' },
    { key: 'favicon', label: 'Favicon', defaultHeight: 32, defaultVariant: 'icon' }
  ];

  // ============================================================
  // Data Loading
  // ============================================================

  async function loadBrandData() {
    try {
      var logoSnap = await MastDB._ref('config/brand/logo').once('value');
      logoConfig = logoSnap.val() || null;

      var legacySnap = await MastDB._ref('public/config/nav/logoUrl').once('value');
      legacyLogoUrl = legacySnap.val() || null;
    } catch (err) {
      console.warn('[Brand] Failed to load logo config:', err.message);
      logoConfig = null;
      legacyLogoUrl = null;
    }
    brandLoaded = true;
    renderBrand();
  }

  // ============================================================
  // Helpers
  // ============================================================

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '--';
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return iso; }
  }

  function getVariantUrl(variantKey) {
    if (!logoConfig) return null;
    if (variantKey === 'primary') return logoConfig.primary ? logoConfig.primary.url : null;
    return logoConfig.variants && logoConfig.variants[variantKey] ? logoConfig.variants[variantKey].url : null;
  }

  function getAvailableVariantKeys() {
    var keys = [];
    if (logoConfig && logoConfig.primary) keys.push('primary');
    if (logoConfig && logoConfig.variants) {
      Object.keys(logoConfig.variants).forEach(function(k) { keys.push(k); });
    }
    return keys;
  }

  // ============================================================
  // Rendering
  // ============================================================

  function renderBrand() {
    var el = document.getElementById('brandContent');
    if (!el) return;

    if (!brandLoaded) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--warm-gray);">Loading brand configuration...</div>';
      return;
    }

    var html = '<div style="max-width:900px;margin:0 auto;padding:16px 0;">';

    // Header
    html += '<div class="section-header" style="margin-bottom:24px;">' +
      '<h2>Brand & Logo</h2>' +
    '</div>';

    // Section 1: Primary Logo
    html += renderPrimarySection();

    // Section 2: Variant Grid
    html += renderVariantGrid();

    // Section 3: Placement Assignments
    html += renderPlacementTable();

    // Section 4: Legacy Status
    html += renderLegacyStatus();

    html += '</div>';
    el.innerHTML = html;
  }

  // ─── Primary Logo Section ───

  function renderPrimarySection() {
    var primary = logoConfig && logoConfig.primary;

    var html = '<div style="background:var(--surface-card);border-radius:8px;padding:20px;margin-bottom:20px;">' +
      '<h3 style="margin:0 0 16px;font-size:1.1rem;color:var(--text-primary);">Primary Logo</h3>';

    if (!primary) {
      html += '<div style="text-align:center;padding:40px 20px;border:2px dashed var(--warm-gray);border-radius:8px;color:var(--warm-gray);">' +
        '<div style="font-size:2rem;margin-bottom:8px;">&#128247;</div>' +
        '<div style="font-size:0.95rem;margin-bottom:4px;">No logo configured</div>' +
        '<div style="font-size:0.8rem;">Use your AI assistant to upload a logo: <code>upload_logo</code></div>' +
      '</div>';
    } else {
      html += '<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;">' +
        // Logo preview
        '<div style="background:var(--surface-dark);border-radius:8px;padding:16px;display:flex;align-items:center;justify-content:center;min-width:200px;min-height:120px;">' +
          '<img src="' + esc(primary.url) + '" alt="Primary logo" style="max-width:300px;max-height:150px;object-fit:contain;" onerror="this.style.display=\'none\'">' +
        '</div>' +
        // Metadata
        '<div style="flex:1;min-width:200px;">' +
          '<div style="display:grid;gap:8px;font-size:0.85rem;">' +
            '<div><span style="color:var(--warm-gray);">Format:</span> ' + esc(primary.format || 'unknown') + (primary.hasTransparency ? ' <span style="color:var(--teal);">(transparent)</span>' : '') + '</div>' +
            (primary.dimensions ? '<div><span style="color:var(--warm-gray);">Dimensions:</span> ' + primary.dimensions.width + ' x ' + primary.dimensions.height + 'px</div>' : '') +
            '<div><span style="color:var(--warm-gray);">Uploaded:</span> ' + formatDate(primary.uploadedAt) + '</div>' +
          '</div>' +
          '<div style="margin-top:12px;font-size:0.8rem;color:var(--warm-gray);">To replace, use your AI assistant: <code>upload_logo</code></div>' +
        '</div>' +
      '</div>';
    }

    html += '</div>';
    return html;
  }

  // ─── Variant Grid ───

  function renderVariantGrid() {
    var variants = (logoConfig && logoConfig.variants) || {};

    var html = '<div style="background:var(--surface-card);border-radius:8px;padding:20px;margin-bottom:20px;">' +
      '<h3 style="margin:0 0 16px;font-size:1.1rem;color:var(--text-primary);">Variants</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(160px, 1fr));gap:12px;">';

    VARIANT_TYPES.forEach(function(vt) {
      var variant = variants[vt.key];
      var hasVariant = !!variant;

      html += '<div style="border:1px solid var(--warm-gray-dark);border-radius:8px;overflow:hidden;">' +
        // Preview area with contextual background
        '<div style="background:' + vt.bg + ';height:100px;display:flex;align-items:center;justify-content:center;padding:8px;">';

      if (hasVariant) {
        html += '<img src="' + esc(variant.url) + '" alt="' + esc(vt.label) + ' variant" style="max-width:100%;max-height:84px;object-fit:contain;" onerror="this.parentElement.innerHTML=\'&#10060;\'">';
      } else {
        html += '<span style="font-size:0.75rem;color:var(--warm-gray);text-align:center;">Not configured</span>';
      }

      html += '</div>' +
        // Info area
        '<div style="padding:8px 10px;">' +
          '<div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">' + esc(vt.label) + '</div>' +
          '<div style="font-size:0.7rem;color:var(--warm-gray);margin-top:2px;">' + esc(vt.desc) + '</div>';

      if (hasVariant) {
        var source = variant.generatedFrom === 'primary' ? 'Auto-generated' : 'Manual upload';
        html += '<div style="font-size:0.7rem;color:var(--teal);margin-top:4px;">' + source + '</div>';
        if (variant.dimensions) {
          html += '<div style="font-size:0.7rem;color:var(--warm-gray);">' + variant.dimensions.width + 'x' + variant.dimensions.height + '</div>';
        }
      } else {
        var hint = vt.autoGen ? 'generate_logo_variant' : 'upload_logo_variant';
        html += '<div style="font-size:0.65rem;color:var(--warm-gray);margin-top:4px;">Use AI: <code>' + hint + '</code></div>';
      }

      html += '</div></div>';
    });

    html += '</div></div>';
    return html;
  }

  // ─── Placement Table ───

  function renderPlacementTable() {
    var placements = (logoConfig && logoConfig.placements) || {};
    var availableKeys = getAvailableVariantKeys();

    var html = '<div style="background:var(--surface-card);border-radius:8px;padding:20px;margin-bottom:20px;">' +
      '<h3 style="margin:0 0 16px;font-size:1.1rem;color:var(--text-primary);">Placement Assignments</h3>';

    if (!logoConfig || !logoConfig.primary) {
      html += '<div style="color:var(--warm-gray);font-size:0.85rem;">Upload a primary logo first to configure placements.</div></div>';
      return html;
    }

    html += '<div style="display:grid;gap:12px;">';

    PLACEMENTS.forEach(function(p) {
      var config = placements[p.key] || {};
      var currentKey = config.variantKey || '';
      var currentHeight = config.maxHeight || p.defaultHeight;
      var resolvedUrl = getVariantUrl(currentKey || 'primary');

      html += '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface-dark);border-radius:6px;flex-wrap:wrap;">' +
        // Logo thumbnail
        '<div style="width:60px;height:40px;background:var(--surface-card);border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
      if (resolvedUrl) {
        html += '<img src="' + esc(resolvedUrl) + '" alt="" style="max-width:56px;max-height:36px;object-fit:contain;" onerror="this.style.display=\'none\'">';
      } else {
        html += '<span style="font-size:0.6rem;color:var(--warm-gray);">--</span>';
      }
      html += '</div>' +
        // Label
        '<div style="min-width:120px;flex-shrink:0;">' +
          '<div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">' + esc(p.label) + '</div>' +
        '</div>' +
        // Variant dropdown
        '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:200px;">' +
          '<label style="font-size:0.75rem;color:var(--warm-gray);white-space:nowrap;">Variant:</label>' +
          '<select id="brandPlacement_' + p.key + '_variant" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-card);color:var(--text-primary);font-size:0.8rem;">';

      // Populate dropdown
      availableKeys.forEach(function(k) {
        var selected = (k === currentKey) ? ' selected' : '';
        var label = k === 'primary' ? 'Primary' : k.charAt(0).toUpperCase() + k.slice(1);
        html += '<option value="' + esc(k) + '"' + selected + '>' + label + '</option>';
      });

      html += '</select>' +
          '<label style="font-size:0.75rem;color:var(--warm-gray);white-space:nowrap;">Height:</label>' +
          '<input type="number" id="brandPlacement_' + p.key + '_height" value="' + currentHeight + '" min="16" max="200" style="width:60px;padding:4px 8px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-card);color:var(--text-primary);font-size:0.8rem;">' +
          '<span style="font-size:0.7rem;color:var(--warm-gray);">px</span>' +
          '<button class="btn btn-primary" onclick="brandSavePlacement(\'' + p.key + '\')" style="font-size:0.75rem;padding:4px 12px;">Save</button>' +
        '</div>' +
      '</div>';
    });

    html += '</div></div>';
    return html;
  }

  // ─── Legacy Status ───

  function renderLegacyStatus() {
    var hasBrandSystem = logoConfig && logoConfig.primary;

    var html = '<div style="background:var(--surface-card);border-radius:8px;padding:16px;">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span style="font-size:0.85rem;color:var(--warm-gray);">System Status:</span>';

    if (hasBrandSystem) {
      html += '<span style="color:var(--teal);font-size:0.85rem;">&#10003; Brand system active</span>';
    } else if (legacyLogoUrl) {
      html += '<span style="color:var(--amber);font-size:0.85rem;">&#9888; Legacy only</span>' +
        '<span style="font-size:0.75rem;color:var(--warm-gray);margin-left:8px;">Logo URL: ' + esc(legacyLogoUrl) + '</span>';
    } else {
      html += '<span style="color:var(--warm-gray);font-size:0.85rem;">No logo configured</span>';
    }

    html += '</div></div>';
    return html;
  }

  // ============================================================
  // Actions
  // ============================================================

  /**
   * Save a placement assignment from the admin UI.
   * Writes to config/brand/logo/placements/{placement} and resolves public URLs.
   */
  window.brandSavePlacement = async function(placementKey) {
    var variantEl = document.getElementById('brandPlacement_' + placementKey + '_variant');
    var heightEl = document.getElementById('brandPlacement_' + placementKey + '_height');
    if (!variantEl) return;

    var variantKey = variantEl.value;
    var maxHeight = parseInt(heightEl ? heightEl.value : '48', 10) || 48;

    try {
      // Write placement config
      await MastDB._ref('config/brand/logo/placements/' + placementKey).set({
        variantKey: variantKey,
        maxHeight: maxHeight
      });

      // Resolve and write public URLs
      await resolvePublicPlacements();

      showToast('Placement saved: ' + placementKey);

      // Reload data to refresh UI
      await loadBrandData();
    } catch (err) {
      showToast('Failed to save placement: ' + err.message, true);
    }
  };

  /**
   * Resolve all placements to public URLs (mirrors the MCP server's resolveAndWritePublicPlacements).
   * Called from admin UI when placements are saved directly.
   */
  async function resolvePublicPlacements() {
    if (!logoConfig) return;

    var primary = logoConfig.primary || {};
    var variants = logoConfig.variants || {};

    // Re-read placements (may have just been updated)
    var placementsSnap = await MastDB._ref('config/brand/logo/placements').once('value');
    var placements = placementsSnap.val() || {};

    var updates = {};

    Object.keys(placements).forEach(function(placement) {
      var config = placements[placement];
      var variantKey = config && config.variantKey;
      if (!variantKey) return;

      var resolvedUrl = null;
      if (variantKey === 'primary') {
        resolvedUrl = primary.url || null;
      } else if (variants[variantKey]) {
        resolvedUrl = variants[variantKey].url || null;
      }

      if (resolvedUrl) {
        updates['public/config/brand/logo/' + placement + '/url'] = resolvedUrl;
        updates['public/config/brand/logo/' + placement + '/maxHeight'] = config.maxHeight || null;
      }
    });

    // Legacy compat: navBar → public/config/nav/logoUrl
    if (placements.navBar && placements.navBar.variantKey) {
      var navKey = placements.navBar.variantKey;
      var navUrl = navKey === 'primary' ? primary.url : (variants[navKey] ? variants[navKey].url : null);
      if (navUrl) {
        updates['public/config/nav/logoUrl'] = navUrl;
      }
    }

    if (Object.keys(updates).length > 0) {
      await MastDB._ref().update(updates);
    }
  }

  // ============================================================
  // Module Registration
  // ============================================================

  MastAdmin.registerModule('brand', {
    routes: {
      'brand': {
        tab: 'brandTab',
        setup: function() {
          if (!brandLoaded) {
            loadBrandData();
          } else {
            renderBrand();
          }
        }
      }
    }
  });

})();
