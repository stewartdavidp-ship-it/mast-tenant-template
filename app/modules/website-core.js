/**
 * website-core.js — shared website write/bridge layer (T6 rip-and-replace, PR1 keystone).
 *
 * Background (docs/ux-audit/website-rip-replace-plan.md §PR1): retiring
 * app/modules/website.js (the 3,480-line V1 website UI) is blocked because
 * surviving V2 surfaces consume its cross-module WRITE layer as window globals.
 * This is the keystone slice of that core — the genuinely cross-module-shared,
 * non-tab-UI website WRITE surface, lifted VERBATIM out of website.js's IIFE:
 *   - window.WebsiteBridge (setThemeField/setCustomColors/getThemeConfig,
 *     getTemplates/previewSwitch/captureThemeState/switchTemplate/
 *     restoreThemeState, getCategories/saveCategories/slugForCategory) —
 *     consumed by the website-v2 twin (Look & Feel + Your-shop cards).
 *   - the DESTRUCTIVE template-switch cascade window.wpConfirmSwitch +
 *     computeGalleryMigration / executeGalleryMigration (rewrites
 *     public/config/theme/* and public/gallery/{id}/templateHidden*), which the
 *     bridge's switchTemplate / restoreThemeState (Undo) delegate to.
 *   - the category manager window.openManageCategoriesDialog / closeCatMgrDialog
 *     + wpCat* + renderCategoriesTab + saveCategories — consumed by index.html
 *     (product-detail / image-library category change) and gallery-metadata-modal.
 *   - window.markUnpublished (draft-on-edit signal) — consumed by homepage.js
 *     (which keeps its own local fallback) and the bridge writes.
 *   - the theme/manifest/registry loaders (loadThemeConfig/loadTemplateManifest/
 *     loadTemplateRegistry) the cascade + bridge read, which also publish
 *     MastAdmin.setData('themeConfig'/'templateManifest') for homepage.js getData.
 *
 * LAZY (loadModule('website-core')) on purpose: the V2 consumers load this
 * instead of the 3,480-line V1 UI module, so website.js can be deleted in a
 * later cut-plan PR. website.js's V1 UI keeps its own byte-identical copies of
 * the IIFE-local helpers it still renders with (the loaders, loadCategories,
 * renderCategoriesTab, esc + the shared cascade/category state) and loads this
 * core in its route setup for the moved window globals — it is doomed but must
 * not break in legacy mode mid-sequence.
 *
 * Pure verbatim move — NO logic change. The ONE deliberate deviation (the
 * customers-core / orders-core PR1 pattern): every call to the V1-UI render fn
 * that stays in website.js — renderWebsite() — is wrapped in the shell's own
 * `typeof renderWebsite === 'function'` guard. In default V2 mode website.js is
 * not loaded here, so those calls were already no-ops (the V1 renderWebsite
 * early-returns on a missing #websiteModuleRoot when website.js *is* loaded);
 * the guard makes a dormant call skip instead of throwing a ReferenceError
 * after a successful write. Nothing else changed from the originals.
 *
 * The AI import wizard (renderImportTab + wp* analyze/crawl/enrich/publish +
 * draft templates) is NOT here — it is a feature relocation to a dedicated lazy
 * module (cut-plan PR2), not part of the cross-module write layer. Vanilla
 * ES5-ish (var/IIFE).
 */
(function() {
  'use strict';

  // ── Shared cascade + category state (dormant copies; each IIFE owns its own —
  //    website.js keeps byte-identical copies for its V1 UI; in default V2 mode
  //    only this core is loaded and these caches are filled by the loaders /
  //    bridge on demand). ──
  var websiteConfig = null;
  var themeConfig = null; // public/config/theme — templateId, colorSchemeId, fontPair, colors
  var templateManifest = null; // loaded from templates/{templateId}/manifest.json
  var tenantCategories = null; // array of { id, label, wholesaleGroup? }
  var currentSubTab = 'overview';
  var editingCategoryIdx = null; // index of category being edited inline
  var catDialogRender = null;   // set when category editor is open as a modal; overrides renderWebsite
  var showCustomColors = false; // toggled when user picks "Custom" in color scheme
  var allTemplateManifests = null; // array of loaded manifests from registry
  var pendingSwitchTemplateId = null; // template ID pending confirmation

  // ── HTML escape (local copy of website.js's esc) ──
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Loaders (theme/manifest/registry/categories) ──
  async function loadThemeConfig() {
    try {
      themeConfig = (await MastDB.get('public/config/theme')) || {};
    } catch (err) {
      console.warn('[Website] Failed to load theme config:', err.message);
      themeConfig = {};
    }
    // Also load nav section enabled states for section toggles
    try {
      themeConfig._navSections = (await MastDB.get('public/config/nav/sections')) || {};
    } catch (err) {
      themeConfig._navSections = {};
    }
    // Share with other modules (e.g., homepage)
    MastAdmin.setData('themeConfig', themeConfig);
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

    // Share manifest with other modules (e.g., homepage)
    MastAdmin.setData('templateManifest', templateManifest);
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

  async function loadCategories() {
    try {
      var raw = await MastDB.get('public/config/categories');
      // The registry may arrive as a numeric-keyed map (the import writes indexed
      // entries via set('.../categories/{idx}')) rather than an array — normalize
      // before the array check, else this tab loads nothing AND a later save would
      // overwrite the map and destroy those categories. Mirrors loadTenantCategories.
      if (raw && !Array.isArray(raw) && typeof raw === 'object') raw = Object.values(raw).filter(Boolean);
      tenantCategories = (raw && Array.isArray(raw)) ? raw.filter(function(c) { return c && c.id && c.label; }) : [];
    } catch (err) {
      console.warn('[Website] Failed to load categories:', err.message);
      tenantCategories = [];
    }
  }

  // ── Category write helpers ──
  async function saveCategories() {
    try {
      await MastDB.set('public/config/categories', tenantCategories);
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

  function onCatChanged() {
    if (typeof catDialogRender === 'function') catDialogRender();
    else if (typeof renderWebsite === 'function') renderWebsite();
  }

  function renderCategoriesTab() {
    var cats = tenantCategories || [];
    var html = '';

    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Product categories used for shop filter pills, wholesale grouping, and gallery sections. Drag order is display order.</p>';

    if (cats.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      html += '<div style="font-size:1.6rem;margin-bottom:12px;">&#128193;</div>';
      html += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No categories yet</p>';
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
          html += '<label style="font-size:0.78rem;">Label</label>';
          html += '<input type="text" id="wpCatEditLabel" value="' + esc(cat.label) + '" style="padding:6px 8px;">';
          html += '</div>';
          html += '<div class="wp-field-group" style="flex:1;min-width:100px;margin:0;">';
          html += '<label style="font-size:0.78rem;">ID (slug)</label>';
          html += '<input type="text" id="wpCatEditId" value="' + esc(cat.id) + '" style="padding:6px 8px;color:var(--warm-gray);" readonly>';
          html += '</div>';
          html += '<div class="wp-field-group" style="flex:1;min-width:140px;margin:0;">';
          html += '<label style="font-size:0.78rem;">Wholesale Group (optional)</label>';
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
          html += '<span style="font-size:0.78rem;color:var(--warm-gray);font-family:monospace;">' + esc(cat.id) + '</span>';
          if (cat.wholesaleGroup) {
            html += '<span style="font-size:0.72rem;background:var(--charcoal-light, #333);padding:2px 8px;border-radius:4px;color:var(--warm-gray);">wholesale: ' + esc(cat.wholesaleGroup) + '</span>';
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
    html += '<label style="font-size:0.78rem;">Label</label>';
    html += '<input type="text" id="wpCatNewLabel" placeholder="e.g. Drinkware" style="padding:6px 8px;">';
    html += '</div>';
    html += '<div class="wp-field-group" style="flex:1;min-width:140px;margin:0;">';
    html += '<label style="font-size:0.78rem;">Wholesale Group (optional)</label>';
    html += '<input type="text" id="wpCatNewWholesale" placeholder="e.g. Decorative" style="padding:6px 8px;">';
    html += '</div>';
    html += '<button class="btn btn-primary btn-small" onclick="wpCatAdd()" style="height:34px;">Add</button>';
    html += '</div>';
    html += '<p id="wpCatAddError" style="font-size:0.78rem;color:var(--danger);margin-top:4px;display:none;"></p>';
    html += '</div>';

    return html;
  }

  // ── Gallery image migration for template switching (cascade internals) ──
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
      await MastDB.multiUpdate(updates);
    }

    return { hidden: migration.hide.length, restored: migration.restore.length };
  }

  // ── Destructive template-switch commit — the cascade entry the bridge delegates to ──
  window.wpConfirmSwitch = async function() {
    if (!pendingSwitchTemplateId) return;

    var newManifest = null;
    if (allTemplateManifests) {
      newManifest = allTemplateManifests.find(function(m) { return m.id === pendingSwitchTemplateId; });
    }
    if (!newManifest) {
      showToast('Template not found.', true);
      pendingSwitchTemplateId = null;
      if (typeof renderWebsite === 'function') renderWebsite();
      return;
    }

    try {
      // Execute gallery image migration
      var currentTemplateId = (themeConfig && themeConfig.templateId) || null;
      var galleryMigration = computeGalleryMigration(window._wpGalleryCache || {}, newManifest, currentTemplateId);
      var migrationResult = await executeGalleryMigration(galleryMigration, currentTemplateId);

      // Write templateId
      await MastDB.set('public/config/theme/templateId', pendingSwitchTemplateId);

      // Set default color scheme from new manifest
      var defaultScheme = (newManifest.colorSchemes || []).find(function(s) { return s.default; });
      var defaultSchemeId = defaultScheme ? defaultScheme.id : (newManifest.colorSchemes && newManifest.colorSchemes[0] ? newManifest.colorSchemes[0].id : null);
      if (defaultSchemeId) {
        await MastDB.set('public/config/theme/colorSchemeId', defaultSchemeId);
        // Clear custom color overrides
        await MastDB.remove('public/config/theme/primaryColor');
        await MastDB.remove('public/config/theme/accentColor');
      }

      // Set default font pair from new manifest (route through MastBrandSync).
      var defaultFont = (newManifest.fontPairs || []).find(function(f) { return f.default; });
      var defaultFontId = defaultFont ? defaultFont.id : (newManifest.fontPairs && newManifest.fontPairs[0] ? newManifest.fontPairs[0].id : null);
      if (defaultFontId) {
        if (window.MastBrandSync) {
          await window.MastBrandSync.setFontPair(defaultFontId);
        } else {
          await MastDB.set('public/config/theme/fontPair', defaultFontId);
        }
      }

      // Clear layout/variant overrides so new template defaults apply
      await MastDB.remove('public/config/theme/designScale');
      await MastDB.remove('public/config/theme/navStyle');
      await MastDB.remove('public/config/theme/responsivePriority');
      await MastDB.remove('public/config/theme/heroVariant');
      await MastDB.remove('public/config/theme/galleryVariant');
      await MastDB.remove('public/config/theme/productGridVariant');

      // Invalidate gallery cache so it reloads with updated data
      window._wpGalleryCache = null;

      markUnpublished();
      var migrationMsg = '';
      if (migrationResult.hidden > 0) migrationMsg += ' ' + MastFormat.countNoun(migrationResult.hidden, 'image') + ' hidden.';
      if (migrationResult.restored > 0) migrationMsg += ' ' + MastFormat.countNoun(migrationResult.restored, 'image') + ' restored.';
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
    if (typeof renderWebsite === 'function') renderWebsite();
  };

  // ── Category manager handlers (window.wpCat*) ──
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
    onCatChanged();
  };

  window.wpCatEdit = function(idx) {
    editingCategoryIdx = idx;
    onCatChanged();
  };

  window.wpCatCancelEdit = function() {
    editingCategoryIdx = null;
    onCatChanged();
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
    onCatChanged();
  };

  window.wpCatDelete = function(idx) {
    if (!tenantCategories[idx]) return;
    var label = tenantCategories[idx].label;
    showConfirmDialog('Delete Category', 'Delete category "' + label + '"? Products in this category will need to be recategorized.', async function() {
      tenantCategories.splice(idx, 1);
      await saveCategories();
      showToast('Category "' + label + '" deleted.');
      onCatChanged();
    }, { confirmLabel: 'Delete', cancelLabel: 'Cancel' });
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
    onCatChanged();
  };

  // Opens the category editor as a modal dialog from anywhere in the app.
  // After the user closes, refreshes global CATEGORIES and calls onDone().
  window.openManageCategoriesDialog = async function(onDone) {
    if (!tenantCategories) await loadCategories();

    function renderModalContent() {
      var body = document.getElementById('catMgrBody');
      if (!body) return;
      body.innerHTML = renderCategoriesTab();
    }

    // Remove any existing dialog
    var existing = document.getElementById('catMgrOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'catMgrOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';

    var dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--surface-dark,#1a1a1a);border:1px solid var(--charcoal-light,#333);border-radius:12px;width:min(560px,95vw);max-height:80vh;display:flex;flex-direction:column;overflow:hidden;';

    var header = '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--charcoal-light,#333);">' +
      '<h3 style="margin:0;font-size:1rem;font-weight:600;">Manage Categories</h3>' +
      '<button onclick="closeCatMgrDialog()" style="background:none;border:none;color:var(--warm-gray);font-size:1.15rem;cursor:pointer;padding:4px;">✕</button>' +
      '</div>';
    var body = '<div id="catMgrBody" style="flex:1;overflow-y:auto;padding:20px;">' + renderCategoriesTab() + '</div>';
    var footer = '<div style="padding:12px 20px;border-top:1px solid var(--charcoal-light,#333);display:flex;justify-content:flex-end;">' +
      '<button class="btn btn-primary" onclick="closeCatMgrDialog()">Done</button>' +
      '</div>';

    dialog.innerHTML = header + body + footer;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    catDialogRender = renderModalContent;

    window.closeCatMgrDialog = function() {
      catDialogRender = null;
      overlay.remove();
      // Refresh global CATEGORIES so every dropdown picks up changes
      if (typeof loadTenantCategories === 'function') {
        loadTenantCategories().then(function() {
          if (typeof onDone === 'function') onDone();
        });
      } else if (typeof onDone === 'function') {
        onDone();
      }
    };
  };

  window.markUnpublished = function markUnpublished() {
    // websiteConfig is null until loadWebsiteData() runs. The v2 builder calls
    // WebsiteBridge writes (→ markUnpublished) without ever rendering the legacy
    // website tab, so guard the cache deref: only flip status when the cache is
    // populated AND published; always stamp updatedAt (the draft signal readers use).
    if (websiteConfig && websiteConfig.status === 'published') {
      websiteConfig.status = 'draft';
      MastDB.set('webPresence/config/status', 'draft');
    }
    MastDB.set('webPresence/config/updatedAt', new Date().toISOString());
  }

  // --- WebsiteBridge (additive) ---
  // Thin shim for the v2 "Your Website" builder (website-v2.js Card 1). Every
  // method DELEGATES to the existing legacy write logic above — the twin never
  // reimplements a storefront/theme write, so the canonical public/config/theme
  // path + markUnpublished (draft-on-edit) semantics are preserved. Unlike the
  // window.wp* handlers, these do NOT call renderWebsite() (that repaints the
  // LEGACY website tab, which the v2 builder is not on), and they keep the
  // module's themeConfig cache in sync so a subsequent legacy render is correct.
  window.WebsiteBridge = {
    // Arbitrary theme field (designScale / navStyle / responsivePriority — the
    // Layout & Scale controls). Mirrors wpUpdateThemeField's write half WITHOUT
    // the legacy re-render. Returns the value on success.
    setThemeField: async function (field, value) {
      if (!themeConfig) themeConfig = {};
      themeConfig[field] = value;
      await MastDB.set('public/config/theme/' + field, value);
      markUnpublished();
      return value;
    },
    // Custom primary/accent colors. Routes the VALUE write through the single
    // writer MastBrandSync.setColors (canonical public/config/theme + platform
    // publicConfig mirror) AND clears colorSchemeId so a custom color and a
    // manifest scheme are mutually exclusive — mirrors wpSelectSchemeCustom's
    // override clear (the legacy custom pickers assumed "Custom" was selected
    // first; the v2 builder has no Custom tile, so the bridge owns the clear).
    // colors: { primaryColor?, accentColor? }. Returns the written update.
    setCustomColors: async function (colors) {
      colors = colors || {};
      var update = {};
      if (colors.primaryColor) update.primaryColor = colors.primaryColor;
      if (colors.accentColor) update.accentColor = colors.accentColor;
      if (!Object.keys(update).length) return null;
      if (!themeConfig) themeConfig = {};
      themeConfig.primaryColor = update.primaryColor || themeConfig.primaryColor;
      themeConfig.accentColor = update.accentColor || themeConfig.accentColor;
      themeConfig.colorSchemeId = null;
      if (window.MastBrandSync && typeof window.MastBrandSync.setColors === 'function') {
        await window.MastBrandSync.setColors(update);
      } else {
        await MastDB.update('public/config/theme', update);
      }
      // Exclusivity: a manifest scheme and custom colors can't both win.
      await MastDB.remove('public/config/theme/colorSchemeId');
      markUnpublished();
      return update;
    },
    // Read-through so the builder can refresh after a write without touching the
    // module's private caches. Single-sources the theme read.
    getThemeConfig: async function () {
      return (await MastDB.get('public/config/theme').catch(function () { return null; })) || {};
    },

    // ── Looks / template switching (v2 "Look & feel" Card 1) ──────────────
    // The v2 Looks gallery shows every template as a tile; tapping a DIFFERENT
    // one runs the SAME template-switch cascade the legacy Template tab does
    // (theme reset + gallery-image migration). These methods are THIN
    // delegators — the dangerous part (which gallery images survive the new
    // template's slot layout, the theme-field reset, markUnpublished) is owned
    // by the legacy computeGalleryMigration / executeGalleryMigration /
    // wpConfirmSwitch functions above. The bridge never re-derives the
    // migration math or the reset list; it only loads the caches those legacy
    // functions read, runs them, and snapshots/restores for Undo.

    // The Looks list — every template in the registry, summarized for the
    // gallery tiles. Reuses the legacy registry/manifest fetch
    // (loadTemplateRegistry → allTemplateManifests) so the source of truth is
    // identical to the legacy Template tab. Each entry: id, name, description,
    // thumbnail (manifest thumbnail/preview if present), and the template's
    // DEFAULT scheme/font ids (so a tile can show its bundled palette + a
    // cheap same-template re-apply can use them). `current` flags the active
    // template. Cold-safe: warms the registry if it hasn't loaded yet.
    getTemplates: async function () {
      if (!allTemplateManifests || !allTemplateManifests.length) {
        try { await loadTemplateRegistry(); } catch (e) {}
      }
      if (!themeConfig) { try { await loadThemeConfig(); } catch (e) {} }
      var currentId = (themeConfig && themeConfig.templateId) || null;
      return (allTemplateManifests || []).map(function (m) {
        var schemes = m.colorSchemes || [];
        var fonts = m.fontPairs || [];
        var defScheme = schemes.filter(function (s) { return s.default; })[0] || schemes[0] || null;
        var defFont = fonts.filter(function (f) { return f.default; })[0] || fonts[0] || null;
        return {
          id: m.id,
          name: m.name || m.id,
          description: m.description || '',
          thumbnail: m.thumbnail || m.previewImage || m.preview || null,
          defaultSchemeId: defScheme ? defScheme.id : null,
          defaultFontId: defFont ? defFont.id : null,
          // a couple of scheme swatches for the tile (DATA, the tile paints them)
          schemeColors: defScheme && defScheme.colors ? {
            primaryColor: defScheme.colors.primaryColor || null,
            accentColor: defScheme.colors.accentColor || null,
            bgColor: defScheme.colors.bgColor || null
          } : null,
          current: m.id === currentId
        };
      });
    },

    // Compute (DO NOT mutate) what switching to templateId would do to the
    // gallery images — for the friendly confirm. Delegates verbatim to the
    // legacy computeGalleryMigration: { migrate, hide, restore } arrays. The
    // bridge loads the SAME inputs the legacy Template tab feeds it (the live
    // gallery + the new manifest) and returns friendly counts plus the raw
    // arrays. No write happens here.
    previewSwitch: async function (templateId) {
      if (!allTemplateManifests || !allTemplateManifests.length) {
        try { await loadTemplateRegistry(); } catch (e) {}
      }
      if (!themeConfig) { try { await loadThemeConfig(); } catch (e) {} }
      var newManifest = (allTemplateManifests || []).filter(function (m) { return m.id === templateId; })[0];
      if (!newManifest) return null;
      var currentTemplateId = (themeConfig && themeConfig.templateId) || null;
      // Load the live gallery the same way renderTemplateTab does (snapshot →
      // .val()), and cache it on the same window key the legacy cascade reads
      // so the subsequent switchTemplate operates on identical data.
      var gallery = {};
      try {
        var snap = await MastDB.gallery.list(500);
        gallery = (snap && typeof snap.val === 'function' ? snap.val() : snap) || {};
      } catch (e) { gallery = {}; }
      window._wpGalleryCache = gallery;
      var migration = computeGalleryMigration(gallery, newManifest, currentTemplateId);
      var totalImages = Object.keys(gallery).length;
      // images that simply stay put (already-compatible, not touched)
      return {
        templateId: templateId,
        name: newManifest.name || templateId,
        description: newManifest.description || '',
        totalImages: totalImages,
        keepCount: migration.migrate.length,   // images that carry to the new layout
        hideCount: migration.hide.length,       // images the new layout can't show (hidden, not deleted)
        restoreCount: migration.restore.length, // previously-hidden images this template brings back
        // raw arrays kept so a caller could cross-check; the UI uses the counts
        migration: migration
      };
    },

    // Snapshot the pre-switch theme + the gallery-visibility state the switch
    // will change — so a faithful Undo can put it ALL back. The theme doc is
    // captured whole (set restores it field-for-field, removing fields the
    // switch added). For the gallery, we capture which image ids are CURRENTLY
    // hidden-by-a-template-switch (templateHidden) so restore can recompute the
    // delta and reverse exactly the flips this switch performs. Returns the
    // snapshot object the caller hands back to restoreThemeState.
    captureThemeState: async function () {
      var theme = (await MastDB.get('public/config/theme').catch(function () { return null; })) || {};
      var hiddenIds = [];
      var hiddenMeta = {};
      try {
        var snap = await MastDB.gallery.list(500);
        var gallery = (snap && typeof snap.val === 'function' ? snap.val() : snap) || {};
        Object.keys(gallery).forEach(function (id) {
          var img = gallery[id] || {};
          if (img.templateHidden) {
            hiddenIds.push(id);
            hiddenMeta[id] = {
              templateHiddenSection: img.templateHiddenSection != null ? img.templateHiddenSection : null,
              templateHiddenFrom: img.templateHiddenFrom != null ? img.templateHiddenFrom : null
            };
          }
        });
      } catch (e) {}
      // Deep-ish copy of the theme doc (flat scalar fields — JSON-safe).
      var themeCopy = {};
      try { themeCopy = JSON.parse(JSON.stringify(theme)); } catch (e) { themeCopy = theme || {}; }
      return {
        capturedAt: new Date().toISOString(),
        theme: themeCopy,
        hiddenIds: hiddenIds,      // image ids that were ALREADY hidden before the switch
        hiddenMeta: hiddenMeta     // their hidden-section/from so restore is faithful
      };
    },

    // Run the FULL template-switch cascade for templateId by delegating to the
    // legacy wpConfirmSwitch — the single source of truth for the reset
    // (templateId/colorSchemeId/fontPair write + designScale/navStyle/
    // responsivePriority/heroVariant/galleryVariant/productGridVariant removal)
    // AND executeGalleryMigration (the gallery-visibility rewrite) AND
    // markUnpublished. The bridge ONLY primes the module state wpConfirmSwitch
    // reads (pendingSwitchTemplateId + the manifest/theme/gallery caches) and
    // suppresses the legacy renderWebsite repaint (the v2 builder isn't on the
    // legacy tab). NO cascade logic is duplicated here. Returns true on success.
    switchTemplate: async function (templateId) {
      if (!allTemplateManifests || !allTemplateManifests.length) {
        try { await loadTemplateRegistry(); } catch (e) {}
      }
      if (!themeConfig) { try { await loadThemeConfig(); } catch (e) {} }
      var newManifest = (allTemplateManifests || []).filter(function (m) { return m.id === templateId; })[0];
      if (!newManifest) throw new Error('Look not found');
      // Ensure the gallery cache wpConfirmSwitch reads is fresh (previewSwitch
      // already populates it, but switchTemplate must be safe called alone).
      if (!window._wpGalleryCache) {
        try {
          var snap = await MastDB.gallery.list(500);
          window._wpGalleryCache = (snap && typeof snap.val === 'function' ? snap.val() : snap) || {};
        } catch (e) { window._wpGalleryCache = {}; }
      }
      // Prime the legacy state the cascade reads, then delegate. wpConfirmSwitch
      // ends by calling the module-local renderWebsite(), which no-ops when the
      // legacy tab isn't mounted (it early-returns on a missing #websiteModuleRoot)
      // — so the v2 builder isn't repainted underneath. NO repaint suppression
      // needed; the v2 page owns its own re-render via reloadSoon.
      pendingSwitchTemplateId = templateId;
      await window.wpConfirmSwitch();   // ← the entire legacy cascade, verbatim
      return true;
    },

    // Restore a snapshot from captureThemeState (stage-before-commit Undo).
    // Two parts: (1) the theme doc is restored field-for-field — set the
    // captured value for every captured field, and REMOVE any field present
    // now but absent in the snapshot (the switch may have added defaults). (2)
    // the gallery visibility is reversed: any image hidden NOW that was NOT
    // hidden in the snapshot is un-hidden (the switch hid it); any image that
    // WAS hidden in the snapshot but isn't now is re-hidden with its captured
    // section/from (the switch restored it). This makes Undo faithful for both
    // the theme and the gallery. Returns { theme, galleryReverted }.
    restoreThemeState: async function (snapshot) {
      if (!snapshot || !snapshot.theme) throw new Error('Nothing to undo');
      var snapTheme = snapshot.theme || {};
      // current theme → diff so we can remove fields the switch added.
      var nowTheme = (await MastDB.get('public/config/theme').catch(function () { return null; })) || {};
      // 1) write the whole captured theme doc (overwrite). MastDB.set on the doc
      //    path replaces it, which both restores captured fields AND drops any
      //    field the switch added that isn't in the snapshot.
      await MastDB.set('public/config/theme', snapTheme);
      // keep the module cache coherent for any later legacy render
      try { themeConfig = JSON.parse(JSON.stringify(snapTheme)); } catch (e) { themeConfig = snapTheme; }
      showCustomColors = !themeConfig.colorSchemeId && !!themeConfig.primaryColor;

      // 2) reverse the gallery visibility flips.
      var galleryReverted = 0;
      try {
        var snap = await MastDB.gallery.list(500);
        var gallery = (snap && typeof snap.val === 'function' ? snap.val() : snap) || {};
        var wasHidden = {};
        (snapshot.hiddenIds || []).forEach(function (id) { wasHidden[id] = true; });
        var meta = snapshot.hiddenMeta || {};
        var updates = {};
        Object.keys(gallery).forEach(function (id) {
          var img = gallery[id] || {};
          var hiddenNow = !!img.templateHidden;
          if (hiddenNow && !wasHidden[id]) {
            // switch hid it → un-hide
            updates['public/gallery/' + id + '/templateHidden'] = null;
            updates['public/gallery/' + id + '/templateHiddenSection'] = null;
            updates['public/gallery/' + id + '/templateHiddenFrom'] = null;
            galleryReverted++;
          } else if (!hiddenNow && wasHidden[id]) {
            // switch restored it → re-hide with the captured metadata
            var m = meta[id] || {};
            updates['public/gallery/' + id + '/templateHidden'] = true;
            updates['public/gallery/' + id + '/templateHiddenSection'] = m.templateHiddenSection != null ? m.templateHiddenSection : (img.section || 'gallery');
            updates['public/gallery/' + id + '/templateHiddenFrom'] = m.templateHiddenFrom != null ? m.templateHiddenFrom : null;
            galleryReverted++;
          }
        });
        if (Object.keys(updates).length) await MastDB.multiUpdate(updates);
      } catch (e) {
        // If the gallery reversal fails, the theme is still restored — the
        // caller surfaces an honest caveat (gallery visibility may need a manual
        // recheck). We do NOT silently claim a clean undo.
        window._wpGalleryCache = null;
        markUnpublished();
        throw new Error('theme-restored-gallery-partial');
      }
      window._wpGalleryCache = null;   // force a fresh reload next time
      markUnpublished();
      return { theme: snapTheme, galleryReverted: galleryReverted };
    },

    // ── Categories (v2 "Your shop" Card 3) ───────────────────────────────
    // The v2 builder edits public/config/categories WITHOUT ever rendering the
    // legacy Categories tab, so the writes must single-source through this
    // module's saveCategories(): it sets the WHOLE array (last-write-wins),
    // refreshes the global CATEGORIES via loadTenantCategories() (so every shop
    // pill / dropdown picks up the change), and stamps the draft signal via
    // markUnpublished(). NEVER raw MastDB.set('public/config/categories') from the
    // twin — that would skip the global refresh + draft stamp.

    // Read-through: the live categories array (filtered to valid {id,label} rows,
    // RTDB object→array normalized). Cold-safe; the twin owns the read-modify-write
    // but seeds from here so it operates on the canonical persisted order.
    getCategories: async function () {
      var raw = await MastDB.get('public/config/categories').catch(function () { return null; });
      if (raw && !Array.isArray(raw) && typeof raw === 'object') raw = Object.values(raw).filter(Boolean);
      return (raw && Array.isArray(raw)) ? raw.filter(function (c) { return c && c.id && c.label; }) : [];
    },
    // Write the WHOLE categories array (the twin does read-modify-write in ONE
    // place, so this is the single committed writer). Mutates the module's
    // tenantCategories cache then delegates to the legacy saveCategories() so the
    // MastDB.set + loadTenantCategories() global refresh + markUnpublished() all
    // fire exactly as the legacy Categories tab does. Returns the saved array.
    saveCategories: async function (arr) {
      tenantCategories = (Array.isArray(arr) ? arr : []).filter(function (c) { return c && c.id && c.label; });
      await saveCategories();
      // keep the legacy inline-edit cursor coherent if the legacy tab renders later
      editingCategoryIdx = null;
      // if the legacy Categories tab is currently mounted, repaint it too
      if (currentSubTab === 'categories' && typeof onCatChanged === 'function') { try { onCatChanged(); } catch (e) {} }
      return tenantCategories.slice();
    },
    // Slug helper shared with the twin (so the v2 add/rename derives ids the same
    // way the legacy tab does — slugify + numeric de-dupe). label → unique slug.
    slugForCategory: function (label, currentList, excludeIdx) {
      var list = Array.isArray(currentList) ? currentList : (tenantCategories || []);
      var base = slugify(label);
      if (!base) return '';
      var slug = base, n = 2;
      while (list.some(function (c, i) { return i !== excludeIdx && c && c.id === slug; })) { slug = base + '-' + n; n++; }
      return slug;
    }
  };

  MastAdmin.registerModule('website-core', {});
})();
