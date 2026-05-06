/**
 * MastBrandSync — single writer for brand/web design data.
 *
 * Phase 4 (drop legacy mirrors): readers have migrated to canonical paths
 * (config/brand/logo/primary, config/brand.{name,tagline}). Only the platform
 * publicConfig pre-paint mirrors for brandName/brandTagline are retained,
 * because storefront-tenant.js setGlobals() reads them synchronously to seed
 * document.title and TENANT_BRAND before STOREFRONT_DATA resolves.
 *
 * Canonical paths (sources of truth):
 *   - Logo:       config/brand/logo/primary
 *   - Brand name: config/brand.name
 *   - Tagline:    config/brand.tagline
 *   - Colors:     public/config/theme.{primaryColor,accentColor}
 *   - Font pair:  public/config/theme.fontPair
 *
 * Retained mirrors (read by storefront-tenant.js setGlobals pre-paint, plus the
 * platform tenant-registry name which is an independent canonical surface):
 *   - mast-platform/tenants/{tid}/publicConfig.brandName
 *   - mast-platform/tenants/{tid}/publicConfig.brandTagline
 *   - mast-platform/tenants/{tid}/name              (platform registry, not storefront)
 *
 * Removed in this phase (no remaining readers — all readers migrated to canonical):
 *   - public/config/nav/logoUrl                     (storefront-nav fallback dropped)
 *   - config/brand.logoUrl                          (in-doc legacy field)
 *   - businessEntity/identity.logoUrl               (BE dashboard reads canonical)
 *   - businessEntity/identity.businessName          (BE dashboard reads canonical name)
 *   - mast-platform/tenants/{tid}/publicConfig.brandLogoUrl
 *     (storefront-tenant.js setGlobals deliberately does NOT read this; logo is
 *      delivered via STOREFRONT_DATA.brandLogo from canonical config/brand/logo/primary)
 *
 * Usage (from admin app or wizard):
 *   await MastBrandSync.setLogo({ url, storagePath, format, dimensions });
 *   await MastBrandSync.setName('Shir Glassworks');
 *   await MastBrandSync.setTagline('Handmade glass from Vermont');
 *   await MastBrandSync.setColors({ primaryColor: '#abc', accentColor: '#def' });
 *
 * Each call writes the canonical path AND fires-and-forgets retained mirror writes.
 * Mirror failures are logged but never block the canonical write.
 */
(function() {
  'use strict';

  function _tid() {
    try { return window.MastDB.tenantId(); } catch (e) { return null; }
  }

  function _mirror(label, promise) {
    return promise.catch(function(err) {
      // Mirror writes are best-effort; log and continue.
      console.warn('[BrandSync mirror failed: ' + label + ']', err && err.message);
    });
  }

  /**
   * Set the primary logo. Writes the canonical Brand-module structure only —
   * all readers (storefront-nav, tenant-brand footer/gate, hero placement)
   * consume config/brand/logo/primary.url.
   *
   * @param {Object} info
   * @param {string} info.url           — public download URL (required)
   * @param {string} [info.storagePath] — Storage path (e.g. tenants/X/brand/logo)
   * @param {string} [info.format]      — 'png' | 'jpg' | 'svg'
   * @param {boolean} [info.hasTransparency]
   * @param {Object} [info.dimensions]  — { width, height }
   */
  async function setLogo(info) {
    if (!info || !info.url) throw new Error('MastBrandSync.setLogo: url required');
    var primary = {
      url: info.url,
      storagePath: info.storagePath || '',
      format: info.format || 'png',
      hasTransparency: !!info.hasTransparency,
      dimensions: info.dimensions || null,
      uploadedAt: new Date().toISOString()
    };
    // Canonical (only)
    await window.MastDB.set('config/brand/logo/primary', primary);
    return primary;
  }

  /**
   * Set the brand name. Writes canonical config/brand.name plus retained mirrors:
   *   - platform tenant registry name (independent canonical surface)
   *   - publicConfig.brandName (storefront pre-paint fallback for document.title)
   */
  async function setName(name) {
    if (typeof name !== 'string') throw new Error('MastBrandSync.setName: name must be string');
    var clean = name.trim();
    // Canonical
    await window.MastDB.update('config/brand', { name: clean, updatedAt: new Date().toISOString() });
    // Retained mirrors
    var tid = _tid();
    if (tid) {
      _mirror('platform.tenant.name', window.MastDB.platform.update('mast-platform/tenants/' + tid, { name: clean }));
      _mirror('platform.publicConfig.brandName', window.MastDB.platform.update('mast-platform/tenants/' + tid + '/publicConfig', { brandName: clean }));
    }
    return clean;
  }

  /**
   * Set the brand tagline. Writes canonical config/brand.tagline plus the
   * retained publicConfig.brandTagline pre-paint mirror.
   */
  async function setTagline(tagline) {
    var clean = (tagline || '').trim() || null;
    await window.MastDB.update('config/brand', { tagline: clean, updatedAt: new Date().toISOString() });
    var tid = _tid();
    if (tid) {
      _mirror('platform.publicConfig.brandTagline', window.MastDB.platform.update('mast-platform/tenants/' + tid + '/publicConfig', { brandTagline: clean || '' }));
    }
    return clean;
  }

  /**
   * Set primary + accent colors. Writes public/config/theme directly (already
   * the canonical storefront path) and mirrors to platform publicConfig so
   * the storefront's pre-paint logic can read them before the theme doc loads.
   */
  async function setColors(colors) {
    var update = { updatedAt: new Date().toISOString() };
    if (colors && colors.primaryColor) update.primaryColor = colors.primaryColor;
    if (colors && colors.accentColor)  update.accentColor  = colors.accentColor;
    if (Object.keys(update).length === 1) return null; // nothing to set
    await window.MastDB.update('public/config/theme', update);
    var tid = _tid();
    if (tid) {
      var pcUpdate = {};
      if (update.primaryColor) pcUpdate.primaryColor = update.primaryColor;
      if (update.accentColor)  pcUpdate.accentColor  = update.accentColor;
      _mirror('platform.publicConfig.colors', window.MastDB.platform.update('mast-platform/tenants/' + tid + '/publicConfig', pcUpdate));
    }
    return update;
  }

  /**
   * Set the font pair. Single canonical path with no current mirrors; here for
   * symmetry so callers route ALL brand writes through this module.
   */
  async function setFontPair(fontPair) {
    if (!fontPair) return null;
    await window.MastDB.update('public/config/theme', { fontPair: fontPair, updatedAt: new Date().toISOString() });
    return fontPair;
  }

  window.MastBrandSync = {
    setLogo: setLogo,
    setName: setName,
    setTagline: setTagline,
    setColors: setColors,
    setFontPair: setFontPair
  };
})();
