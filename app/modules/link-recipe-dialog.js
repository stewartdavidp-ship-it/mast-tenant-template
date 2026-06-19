/**
 * Link-Recipe dialog — the product detail "Link existing recipe…" picker that
 * lists unlinked / orphan recipes and two-way-binds the chosen one to a product
 * (product.recipeId = recipeId and recipe.productId = pid).
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager openLinkRecipeDialog shim in
 * index.html (the opener is a renderProductDetail-generated onclick). No live
 * cross-module caller.
 *
 * Reads eager shell globals: can, showToast, window.productsData,
 * window.makerListRecipes, esc, openModal, closeModal, MastDB,
 * window.makerUpdateRecipe, renderProductDetail, window.selectedProductPid. All
 * defined before the product detail surface can render. Logic moved VERBATIM
 * (behavior-preserving).
 */
(function () {
  'use strict';

// Open a picker that lists unlinked / orphan recipes and links the chosen one to this product.
// Two-way bind: product.recipeId = recipeId and recipe.productId = pid.
function openLinkRecipeDialog(pid) {
  if (!can('products', 'edit')) { showToast('You do not have permission to update products.', true); return; }
  var product = (window.productsData || []).find(function(p) { return p.pid === pid; });
  if (!product) { showToast('Product not found', true); return; }
  if (product.recipeId) { showToast('Product already has a linked recipe', true); return; }

  var recipes = (typeof window.makerListRecipes === 'function' ? window.makerListRecipes() : null) || {};
  var productPids = {};
  (window.productsData || []).forEach(function(p) { productPids[p.pid] = true; });

  // Unlinked = not archived AND (no productId OR productId points to nothing OR target product's recipeId doesn't match this recipe)
  var candidates = [];
  Object.keys(recipes).forEach(function(rid) {
    var r = recipes[rid];
    if (!r || r.status === 'archived') return;
    if (!r.productId || !productPids[r.productId]) {
      candidates.push(r);
      return;
    }
    var owner = (window.productsData || []).find(function(p) { return p.pid === r.productId; });
    if (!owner || owner.recipeId !== rid) candidates.push(r);
  });

  candidates.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

  var html = '<div class="modal-header"><h3>Link Existing Recipe</h3>' +
    '<button class="modal-close" onclick="closeModal()">✖</button></div>' +
    '<div class="modal-body">' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);">Pick a recipe to link to <strong>' + esc(product.name || pid) + '</strong>.</p>';

  if (candidates.length === 0) {
    html += '<p style="color:var(--warm-gray);">No unlinked recipes available. Use "+ Create Recipe" to start a new one.</p>';
  } else {
    html += '<div style="max-height:300px;overflow-y:auto;border:1px solid var(--border-light,#eee);border-radius:6px;">';
    candidates.forEach(function(r) {
      var cost = (r.totalCost || 0).toFixed(2);
      html += '<label style="display:flex;align-items:center;gap:10px;padding:10px;cursor:pointer;border-bottom:1px solid var(--border-light,#eee);">' +
        '<input type="radio" name="linkRecipeId" value="' + esc(r.recipeId) + '">' +
        '<span style="flex:1;">' +
          '<strong>' + esc(r.name || r.recipeId) + '</strong>' +
          ' <span style="color:var(--warm-gray);font-size:0.85em;">($' + esc(cost) + ' cost)</span>' +
        '</span>' +
      '</label>';
    });
    html += '</div>';
  }

  html += '</div><div class="modal-footer">' +
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    (candidates.length > 0 ? '<button class="btn btn-primary" onclick="executeLinkRecipe(\'' + esc(pid) + '\')">Link Recipe</button>' : '') +
  '</div>';

  openModal(html);
}

async function executeLinkRecipe(pid) {
  var selected = document.querySelector('input[name="linkRecipeId"]:checked');
  if (!selected) { showToast('Select a recipe', true); return; }
  var rid = selected.value;
  try {
    var now = new Date().toISOString();
    await MastDB.products.update(pid, { recipeId: rid, updatedAt: now });
    if (typeof window.makerUpdateRecipe === 'function') {
      await window.makerUpdateRecipe(rid, { productId: pid, updatedAt: now });
    } else if (MastDB.recipes && typeof MastDB.recipes.update === 'function') {
      await MastDB.recipes.update(rid, { productId: pid, updatedAt: now });
    }
    showToast('Recipe linked');
    closeModal();
    if (typeof renderProductDetail === 'function' && window.selectedProductPid === pid) {
      renderProductDetail(pid);
    }
  } catch (err) {
    showToast('Failed to link recipe: ' + (err.message || err), true);
  }
}

  // Impl for the eager shim + the dialog's own onclick target.
  window.openLinkRecipeDialogImpl = openLinkRecipeDialog;
  window.executeLinkRecipe = executeLinkRecipe;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('linkRecipeDialog', {});
  }
})();

