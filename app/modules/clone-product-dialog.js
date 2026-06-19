/**
 * Clone Product dialog — the admin "Duplicate" product flow: the Clone Product
 * modal (openCloneDialog), its "Mark as Second" name toggle (cloneSecondToggle),
 * and the clone write-path (executeClone).
 *
 * Extracted from app/index.html's inline block (decomposition master plan,
 * Track 1). Lazy-loaded on demand via the eager openCloneDialog shim in
 * index.html (the products-list "Duplicate" button is generated onclick). No
 * cross-module callers; products-v2 does not reference these. Logic moved
 * VERBATIM (behavior-preserving).
 *
 * Reads eager shell globals: products, esc, openModal, closeModal, showToast,
 * writeAudit, MastDB, loadProducts. All defined before the products surface can
 * render.
 */
(function () {
  'use strict';

function openCloneDialog(sourcePid) {
  var product = products[sourcePid];
  if (!product) { showToast('Product not found', true); return; }
  var defaultName = (product.name || '') + ' (copy)';

  var html = '<div class="modal-header"><h3>Clone Product</h3>' +
    '<button class="modal-close" onclick="closeModal()">\u2716</button></div>' +
    '<div class="modal-body">' +
      '<div class="form-group"><label>New Product Name</label>' +
        '<input type="text" id="cloneName" value="' + esc(defaultName) + '" class="form-input" /></div>' +
      '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
        '<input type="checkbox" id="cloneMarkAsSecond" onchange="cloneSecondToggle(\'' + esc(sourcePid) + '\')" /> Mark as Second</label>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Sets name to "— Second", assigns Seconds category</div></div>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);">New PID: <code>' + esc(sourcePid) + '-copy</code><br>Inventory starts at 0. Images are shared with original.</p>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="executeClone(\'' + esc(sourcePid) + '\')">Clone</button>' +
    '</div>';
  openModal(html);
}

function cloneSecondToggle(sourcePid) {
  var cb = document.getElementById('cloneMarkAsSecond');
  var nameInput = document.getElementById('cloneName');
  var product = products[sourcePid];
  if (!product) return;
  if (cb && cb.checked) {
    nameInput.value = (product.name || '') + ' \u2014 Second';
  } else {
    nameInput.value = (product.name || '') + ' (copy)';
  }
}

async function executeClone(sourcePid) {
  var product = products[sourcePid];
  if (!product) return;
  var name = (document.getElementById('cloneName').value || '').trim();
  var isSecond = document.getElementById('cloneMarkAsSecond').checked;
  if (!name) { showToast('Name is required', true); return; }

  var newPid = sourcePid + '-copy';

  // Check if target already exists
  var existSnap = await MastDB.products.get(newPid);
  if ((existSnap != null)) {
    showToast('Product ' + newPid + ' already exists', true);
    return;
  }

  // Clone all fields
  var now = new Date().toISOString();
  var cloned = Object.assign({}, product);
  cloned.pid = newPid;
  cloned.name = name;
  cloned.createdAt = now;
  cloned.updatedAt = now;
  delete cloned.originalBasePriceCents;

  if (isSecond) {
    cloned.categories = ['seconds'];
  }

  try {
    await MastDB.products.set(newPid, cloned);
    // Initialize inventory at 0
    await MastDB.set('admin/inventory/' + newPid, {
      stockType: 'stock-to-build',
      stock: { _default: { onHand: 0, committed: 0, held: 0, damaged: 0, incoming: 0 } },
      lowStockThreshold: 5,
      updatedAt: now
    });
    writeAudit('create', 'products', newPid);
    showToast('Product cloned as ' + newPid);
    closeModal();
    // Reload products view
    if (typeof loadProducts === 'function') loadProducts();
  } catch (err) {
    console.error('Clone error:', err);
    showToast('Failed to clone product', true);
  }
}

  // Impl for the eager shim (externally called via the products-list Duplicate
  // button) + the dialog's internal onchange/onclick targets.
  window.openCloneDialogImpl = openCloneDialog;
  window.cloneSecondToggle = cloneSecondToggle;
  window.executeClone = executeClone;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('cloneProductDialog', {});
  }
})();
