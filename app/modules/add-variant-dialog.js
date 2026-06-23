/**
 * Add-Variant dialog — the admin "Add Variant" modal on the product detail view
 * (pick an unused attribute combination to add as a new variant) plus its
 * addVariantToProduct submit handler.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager openAddVariantDialog shim in
 * index.html (the "+ Add Variant" button is module-generated onclick on the
 * product detail surface). No cross-module call — only index.html invokes it.
 *
 * Reads eager shell globals: can, showToast, window.productsData / productsData,
 * _comboSig, _allCombos (shared with maker.js — stay eager in the shell), esc,
 * editProduct, switchProductTab, openModal, closeModal, MastDB, renderProductDetail.
 * All defined before the product detail surface can render. Logic moved VERBATIM
 * (behavior-preserving).
 */
(function () {
  'use strict';

function openAddVariantDialog(pid) {
  if (!can('products', 'edit')) { showToast('You do not have permission to update products.', true); return; }
  var product = (window.productsData || []).find(function(p) { return p.pid === pid; });
  if (!product) { showToast('Product not found', true); return; }
  var options = Array.isArray(product.options) ? product.options : [];

  var html = '<div class="modal-header"><h3>Add Variant</h3>' +
    '<button class="modal-close" onclick="closeModal()">✖</button></div>' +
    '<div class="modal-body">';

  if (options.length === 0) {
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">' +
      'This product has no variant attributes defined yet. Add attributes ' +
      '(e.g. <em>metal</em>, <em>size</em>) before creating variants.' +
      '</p>' +
      '<button class="btn btn-primary btn-small" onclick="closeModal();editProduct(\'' + esc(pid) + '\');switchProductTab(\'variants\')">Define Attributes →</button>';
  } else {
    var existing = {};
    (product.variants || []).forEach(function(v) { existing[_comboSig(v.combo || {})] = true; });
    var combos = _allCombos(options);
    var available = combos.filter(function(c) { return !existing[_comboSig(c)]; });

    if (combos.length === 0) {
      html += '<p style="color:var(--warm-gray);">Variant attributes are incomplete — at least one option has no choices.</p>';
    } else if (available.length === 0) {
      html += '<p style="color:var(--warm-gray);">All possible variant combinations already exist (' + combos.length + ').</p>' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);">Add more choices to an existing attribute via Edit Info → Variants tab.</p>';
    } else {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">' +
        'Pick a combination to add. ' + available.length + ' of ' + combos.length + ' possible combinations are not yet variants.' +
        '</p>';
      html += '<div style="display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto;">';
      available.forEach(function(combo) {
        var sig = _comboSig(combo);
        var label = Object.keys(combo).map(function(k) { return combo[k]; }).join(' / ');
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border:1px solid var(--border-light,#eee);border-radius:6px;">' +
          '<span style="font-size:0.85rem;">' + esc(label) + '</span>' +
          '<button class="btn btn-primary btn-small" onclick="addVariantToProduct(\'' + esc(pid) + '\',\'' + esc(sig) + '\')">Add</button>' +
        '</div>';
      });
      html += '</div>';
    }
  }

  html += '</div><div class="modal-footer">' +
    '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
  '</div>';

  openModal(html);
}

async function addVariantToProduct(pid, comboSig) {
  if (!can('products', 'edit')) { showToast('You do not have permission to update products.', true); return; }
  var product = (window.productsData || []).find(function(p) { return p.pid === pid; });
  if (!product) { showToast('Product not found', true); return; }

  // Reconstruct the combo from the signature ("k:v|k:v")
  var combo = {};
  comboSig.split('|').forEach(function(pair) {
    var idx = pair.indexOf(':');
    if (idx < 0) return;
    combo[pair.substring(0, idx)] = pair.substring(idx + 1);
  });

  var newVariant = {
    id: MastUtil.genId('v_'),
    combo: combo,
    priceCents: product.priceCents != null ? product.priceCents : 0
  };
  var variants = (product.variants || []).slice();
  variants.push(newVariant);

  try {
    var now = new Date().toISOString();
    await MastDB.products.update(pid, { variants: variants, updatedAt: now });
    var local = productsData.find(function(p) { return p.pid === pid; });
    if (local) local.variants = variants;
    showToast('Variant added');
    closeModal();
    if (typeof renderProductDetail === 'function') renderProductDetail(pid);
  } catch (err) {
    showToast('Failed to add variant: ' + (err && err.message ? err.message : err), true);
  }
}

  // Impl for the eager shim + the dialog's generated-onclick submit target.
  window.openAddVariantDialogImpl = openAddVariantDialog;
  window.addVariantToProduct = addVariantToProduct;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('addVariantDialog', {});
  }
})();
