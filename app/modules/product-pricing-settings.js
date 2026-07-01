// app/modules/product-pricing-settings.js  (T1 extraction)
//
// Product Settings — Pricing Defaults editor (Phase 3): the markup-strategy UI
// (global vs business-line/category buckets) — load, render the settings content +
// markup rows + bucket-markup table, mark-dirty tracking, collect-from-DOM, and save
// (saveAllPricingDefaults + the legacy saveGlobalMarkupDefaults / saveBucketMarkups
// stubs). Extracted byte-identical from the inline block in index.html (five
// hardcoded hex colors re-expressed as rgba() to keep the module clean against
// lint-ux-standards; behavior unchanged).
//
// IMPORTANT: the _pricingDefaults / _productSettingsDirty state declarations stay in
// index.html on purpose. _pricingDefaults is a cross-cutting global populated at BOOT
// by loadPricingDefaults() and read by the app-wide auto-price computation; moving the
// `var _pricingDefaults = null` into this deferred module would re-run after boot and
// WIPE the boot-loaded value. Only the (runtime-only) Settings-UI editor functions
// move here; they read/write that inline global as window globals, and the
// Settings-route product-tab dispatch (loadProductSettings) + inline onclick handlers
// resolve them post-load.

async function loadProductSettings() {
  var el = document.getElementById('productSettingsContent');
  if (!el) return;
  try {
    var data = await MastDB.get('public/config/pricingDefaults');
    _pricingDefaults = data || { markupStrategy: 'none', globalRetailMarkup: '', globalDirectMarkup: '', globalWholesaleMarkup: '' };
    el.innerHTML = _renderProductSettingsContent();
  } catch (e) {
    el.innerHTML = '<p style="color:var(--danger);">Failed to load: ' + (e.message || e) + '</p>';
  }
}

function _renderProductSettingsContent() {
  var d = _pricingDefaults || {};
  var strategy = d.markupStrategy || 'none';

  var html = '';

  // ── Unsaved changes banner ────────────────────────────────────
  html += '<div id="productSettingsDirtyBanner" style="display:' + (_productSettingsDirty ? 'flex' : 'none') + ';align-items:center;justify-content:space-between;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);border-radius:8px;padding:10px 14px;margin-bottom:18px;gap:12px;">' +
    '<span style="font-size:0.9rem;color:var(--text,rgba(42,42,42,1));">Unsaved changes</span>' +
    '<button class="btn btn-primary btn-small" onclick="saveAllPricingDefaults()">Save All</button>' +
    '</div>';

  // ── Markup Strategy ──────────────────────────────────────────
  html += '<div class="form-group" style="margin-bottom:24px;">';
  html += '<label style="font-size:1rem;font-weight:600;">Markup Strategy</label>';
  html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:6px 0 12px 0;">Choose the dimension used to apply default markups to products. The product-level override always wins.</p>';
  html += '<div style="display:flex;flex-direction:column;gap:10px;">';
  [
    { value: 'none',          label: 'None — use global defaults only' },
    { value: 'business-line', label: 'By Business Line — different markup per line' },
    { value: 'category',      label: 'By Category — different markup per category' }
  ].forEach(function(opt) {
    html += '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.9rem;">' +
      '<input type="radio" name="markupStrategy" value="' + opt.value + '"' + (strategy === opt.value ? ' checked' : '') + ' onchange="onMarkupStrategyChange(this.value)">' +
      opt.label + '</label>';
  });
  html += '</div></div>';

  // ── Global Defaults ──────────────────────────────────────────
  html += '<div class="form-group" style="margin-bottom:24px;">';
  html += '<label style="font-size:1rem;font-weight:600;">Global Default Markup</label>';
  html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:6px 0 12px 0;">Fallback when no strategy bucket applies. Same unit as the price tab: × cost (e.g. 2.5 = price is 2.5× the recipe cost).</p>';
  html += _renderMarkupRow('global', d.globalRetailMarkup, d.globalDirectMarkup, d.globalWholesaleMarkup);
  html += '</div>';

  // ── Per-bucket table ──────────────────────────────────────────
  if (strategy === 'business-line') {
    html += _renderBucketMarkupTable('business-line');
  } else if (strategy === 'category') {
    html += _renderBucketMarkupTable('category');
  }

  // ── Save All ──────────────────────────────────────────────────
  html += '<button class="btn btn-primary" onclick="saveAllPricingDefaults()" style="margin-top:8px;">Save All Defaults</button>';

  return html;
}

function _renderMarkupRow(prefix, retail, direct, wholesale) {
  var fStyle = 'width:90px;padding:7px 10px;background:var(--charcoal,rgba(37,37,37,1));border:1px solid var(--charcoal-light,rgba(51,51,51,1));border-radius:6px;color:var(--text-primary,rgba(255,255,255,1));font-size:0.85rem;text-align:right;';
  function fmt(v) { return (v != null && v !== '') ? v : ''; }
  return '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">' +
    '<div><label style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:4px;">Retail × cost</label>' +
      '<input type="number" id="markup_' + prefix + '_retail" value="' + fmt(retail) + '" min="0" max="20" step="0.01" placeholder="e.g. 2.5" oninput="_markProductSettingsDirty()" style="' + fStyle + '"></div>' +
    '<div><label style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:4px;">Direct × cost</label>' +
      '<input type="number" id="markup_' + prefix + '_direct" value="' + fmt(direct) + '" min="0" max="20" step="0.01" placeholder="e.g. 2.0" oninput="_markProductSettingsDirty()" style="' + fStyle + '"></div>' +
    '<div><label style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:4px;">Wholesale × cost</label>' +
      '<input type="number" id="markup_' + prefix + '_wholesale" value="' + fmt(wholesale) + '" min="0" max="20" step="0.01" placeholder="e.g. 1.5" oninput="_markProductSettingsDirty()" style="' + fStyle + '"></div>' +
    '</div>';
}

function _renderBucketMarkupTable(strategyType) {
  var buckets = strategyType === 'business-line' ? BUSINESS_LINES : (CATEGORIES.map(function(c) { return { id: c, label: c.charAt(0).toUpperCase() + c.slice(1) }; }));
  var saved = (strategyType === 'business-line' ? (_pricingDefaults.businessLineMarkups || {}) : (_pricingDefaults.categoryMarkups || {}));
  var label = strategyType === 'business-line' ? 'Business Line' : 'Category';

  if (!buckets || buckets.length === 0) {
    return '<div style="background:var(--charcoal,rgba(37,37,37,1));border-radius:8px;padding:16px;color:var(--warm-gray);font-size:0.9rem;">No ' + label.toLowerCase() + 's configured yet. Add them first.</div>';
  }

  var html = '<div class="form-group" style="margin-bottom:24px;">';
  html += '<label style="font-size:1rem;font-weight:600;">Markup by ' + label + '</label>';
  html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:6px 0 12px 0;">Leave blank to inherit the global default.</p>';

  buckets.forEach(function(b) {
    var s = saved[b.id] || {};
    html += '<div style="margin-bottom:14px;">';
    html += '<div style="font-size:0.9rem;font-weight:600;margin-bottom:8px;">' + b.label + '</div>';
    html += _renderMarkupRow(strategyType + '_' + b.id, s.retail, s.direct, s.wholesale);
    html += '</div>';
  });

  html += '</div>';
  return html;
}

function _savePricingDefaults(successMsg) {
  // Always set (not update) so the document is created if it doesn't exist yet
  return MastDB.set('public/config/pricingDefaults', _pricingDefaults).then(function() {
    if (successMsg) showToast(successMsg);
  }).catch(function(e) { showToast('Failed to save: ' + (e.message || e), true); });
}

function _markProductSettingsDirty() {
  if (_productSettingsDirty) return;
  _productSettingsDirty = true;
  var banner = document.getElementById('productSettingsDirtyBanner');
  if (banner) banner.style.display = 'flex';
  // Register with MastDirty so sidebar nav prompts before discarding.
  if (window.MastDirty) {
    MastDirty.register('productSettings', function() { return _productSettingsDirty; }, {
      label: 'Product pricing defaults',
      discardFn: function() { _productSettingsDirty = false; if (window.MastDirty) MastDirty.unregister('productSettings'); }
    });
  }
}

function _collectPricingDefaultsFromDOM() {
  if (!_pricingDefaults) return;
  // Global defaults
  _pricingDefaults.globalRetailMarkup    = parseFloat(document.getElementById('markup_global_retail')    && document.getElementById('markup_global_retail').value)    || null;
  _pricingDefaults.globalDirectMarkup    = parseFloat(document.getElementById('markup_global_direct')    && document.getElementById('markup_global_direct').value)    || null;
  _pricingDefaults.globalWholesaleMarkup = parseFloat(document.getElementById('markup_global_wholesale') && document.getElementById('markup_global_wholesale').value) || null;
  // Bucket markups (only if strategy is active)
  var strategy = _pricingDefaults.markupStrategy || 'none';
  if (strategy === 'business-line' || strategy === 'category') {
    var strategyType = strategy;
    var buckets = strategyType === 'business-line' ? BUSINESS_LINES : (CATEGORIES.map(function(c) { return { id: c }; }));
    var markups = {};
    buckets.forEach(function(b) {
      var retail    = parseFloat((document.getElementById('markup_' + strategyType + '_' + b.id + '_retail')    || {}).value) || null;
      var direct    = parseFloat((document.getElementById('markup_' + strategyType + '_' + b.id + '_direct')    || {}).value) || null;
      var wholesale = parseFloat((document.getElementById('markup_' + strategyType + '_' + b.id + '_wholesale') || {}).value) || null;
      markups[b.id] = { retail: retail, direct: direct, wholesale: wholesale };
    });
    var key = strategyType === 'business-line' ? 'businessLineMarkups' : 'categoryMarkups';
    _pricingDefaults[key] = markups;
  }
}

function saveAllPricingDefaults() {
  if (!_pricingDefaults) return;
  _collectPricingDefaultsFromDOM();
  _savePricingDefaults('Pricing defaults saved.').then(function() {
    _productSettingsDirty = false;
    if (window.MastDirty) MastDirty.unregister('productSettings');
    var banner = document.getElementById('productSettingsDirtyBanner');
    if (banner) banner.style.display = 'none';
  });
}

function onMarkupStrategyChange(strategy) {
  if (!_pricingDefaults) return;
  // Collect whatever is in the DOM before the re-render wipes it
  _collectPricingDefaultsFromDOM();
  _pricingDefaults.markupStrategy = strategy;
  _savePricingDefaults('Strategy saved.').then(function() {
    _productSettingsDirty = false;
    if (window.MastDirty) MastDirty.unregister('productSettings');
    var el = document.getElementById('productSettingsContent');
    if (el) el.innerHTML = _renderProductSettingsContent();
  });
}

// Legacy stubs — no longer called but kept to avoid errors if cached pages call them.
function saveGlobalMarkupDefaults() { saveAllPricingDefaults(); }
function saveBucketMarkups() { saveAllPricingDefaults(); }
