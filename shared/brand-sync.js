/**
 * MastBrandSync — single writer for brand/web design data.
 *
 * The codebase historically stored the same brand fields in 2-5 places.
 * This helper is the ONE place that writes brand data; it fans out to all
 * mirror paths the storefront / newsletter / schema-org / platform read from.
 *
 * Canonical paths (sources of truth — Brand module + wizard write here):
 *   - Logo:       config/brand/logo/primary
 *   - Brand name: config/brand.name
 *   - Tagline:    config/brand.tagline
 *   - Colors:     public/config/theme.{primaryColor,accentColor}
 *   - Font pair:  public/config/theme.fontPair
 *
 * Mirror targets (legacy reads that we keep populated until storefront migrates):
 *   - public/config/nav/logoUrl                    (storefront nav, footer, favicon)
 *   - config/brand.logoUrl                          (admin newsletter, legacy admin code)
 *   - businessEntity/identity.logoUrl               (business entity dashboard)
 *   - mast-platform/tenants/{tid}/publicConfig.brandLogoUrl
 *   - mast-platform/tenants/{tid}/name              (platform registry)
 *   - mast-platform/tenants/{tid}/publicConfig.brandName
 *   - mast-platform/tenants/{tid}/publicConfig.brandTagline
 *   - businessEntity/identity.businessName
 *
 * Usage (from admin app or wizard):
 *   await MastBrandSync.setLogo({ url, storagePath, format, dimensions });
 *   await MastBrandSync.setName('Shir Glassworks');
 *   await MastBrandSync.setTagline('Handmade glass from Vermont');
 *   await MastBrandSync.setColors({ primaryColor: '#abc', accentColor: '#def' });
 *
 * Each call writes the canonical path AND fires-and-forgets all mirror writes.
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
   * Set the primary logo. Writes the new Brand-module structure as canonical
   * and fans out to every legacy path the storefront/newsletter reads from.
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
    var url = info.url;
    var primary = {
      url: url,
      storagePath: info.storagePath || '',
      format: info.format || 'png',
      hasTransparency: !!info.hasTransparency,
      dimensions: info.dimensions || null,
      uploadedAt: new Date().toISOString()
    };
    // Canonical
    await window.MastDB.set('config/brand/logo/primary', primary);
    // Mirrors — best-effort
    var tid = _tid();
    _mirror('public/config/nav/logoUrl', window.MastDB.set('public/config/nav/logoUrl', url));
    _mirror('config/brand.logoUrl', window.MastDB.update('config/brand', { logoUrl: url, updatedAt: new Date().toISOString() }));
    _mirror('businessEntity/identity.logoUrl', window.MastDB.businessEntity.update('identity', { logoUrl: url }));
    if (tid) {
      _mirror('platform.publicConfig.brandLogoUrl', window.MastDB.platform.update('mast-platform/tenants/' + tid + '/publicConfig', { brandLogoUrl: url }));
    }
    return primary;
  }

  /**
   * Set the brand name. Writes config/brand.name and mirrors to every
   * legacy path that displays the business name.
   */
  async function setName(name) {
    if (typeof name !== 'string') throw new Error('MastBrandSync.setName: name must be string');
    var clean = name.trim();
    // Canonical
    await window.MastDB.update('config/brand', { name: clean, updatedAt: new Date().toISOString() });
    // Mirrors
    var tid = _tid();
    _mirror('businessEntity/identity.businessName', window.MastDB.businessEntity.update('identity', { businessName: clean }));
    if (tid) {
      _mirror('platform.tenant.name', window.MastDB.platform.update('mast-platform/tenants/' + tid, { name: clean }));
      _mirror('platform.publicConfig.brandName', window.MastDB.platform.update('mast-platform/tenants/' + tid + '/publicConfig', { brandName: clean }));
    }
    return clean;
  }

  /**
   * Set the brand tagline. Writes config/brand.tagline and mirrors.
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
