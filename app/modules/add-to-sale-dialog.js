/**
 * Add-to-Sale dialog — the admin "Add to Sale" modal on a product card
 * (pick an active sale promotion to add the product to, or remove it from its
 * current sale).
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager openAddToSaleDialog shim in
 * index.html (the "Add to Sale" button is generated onclick markup on each
 * active product card). executeAddToSale / removeFromSale are the dialog's own
 * onclick targets.
 *
 * Reads eager shell globals: productsData, MastDB, esc, openModal, closeModal,
 * showToast, writeAudit. All defined before the products surface can render.
 * Logic moved VERBATIM (behavior-preserving).
 */
(function () {
  'use strict';

function openAddToSaleDialog(pid) {
  var product = productsData.find(function(p) { return p.pid === pid; });
  if (!product) { showToast('Product not found', true); return; }

  // Read active promotions
  MastDB.promotions.list(100).then(function(data) {
    data = data || {};
    var now = new Date().toISOString();
    var activeSales = [];
    var currentSaleId = null;
    var currentSaleName = null;

    Object.keys(data).forEach(function(saleId) {
      var s = data[saleId];
      if (s.archived) return;
      if (s.startDate && s.startDate > now) return; // scheduled — include for adding
      if (s.endDate && s.endDate < now) return;

      var pids = (s.products || []).map(function(p) { return typeof p === 'string' ? p : p.pid; });
      if (pids.indexOf(pid) !== -1) {
        currentSaleId = saleId;
        currentSaleName = s.name;
      }
      activeSales.push({ id: saleId, name: s.name, discountType: s.discountType, discountValue: s.discountValue, productCount: pids.length });
    });

    var html = '<div class="modal-header"><h3>Add to Sale</h3>' +
      '<button class="modal-close" onclick="closeModal()">\u2716</button></div>' +
      '<div class="modal-body">' +
        '<p><strong>' + esc(product.name) + '</strong></p>';

    if (currentSaleId) {
      html += '<div style="background:rgba(22,163,106,0.1);border-radius:8px;padding:12px;margin-bottom:12px;">' +
        '<span style="color:#16a34a;font-weight:600;">Currently in:</span> ' + esc(currentSaleName) +
        ' <button class="btn btn-sm" style="margin-left:8px;" onclick="removeFromSale(\'' + esc(currentSaleId) + '\',\'' + esc(pid) + '\')">Remove</button>' +
      '</div>';
    }

    if (activeSales.length === 0) {
      html += '<p style="color:var(--warm-gray);">No active sales. Create one from the Sale Promotions tab.</p>';
    } else {
      html += '<div style="max-height:200px;overflow-y:auto;">';
      activeSales.forEach(function(sale) {
        var isCurrent = sale.id === currentSaleId;
        html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 4px;cursor:pointer;border-bottom:1px solid var(--border-light,#eee);">' +
          '<input type="radio" name="addToSaleId" value="' + esc(sale.id) + '"' + (isCurrent ? ' checked disabled' : '') + ' />' +
          '<span style="flex:1;">' + esc(sale.name) + ' <span style="color:var(--warm-gray);font-size:0.85em;">(' +
            (sale.discountType === 'percent' ? sale.discountValue + '% off' : '$' + (sale.discountValue/100).toFixed(2) + ' off') +
            ', ' + sale.productCount + ' products)</span></span>' +
        '</label>';
      });
      html += '</div>';
    }

    html += '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn" onclick="closeModal()">Cancel</button>' +
        (activeSales.length > 0 ? '<button class="btn btn-primary" onclick="executeAddToSale(\'' + esc(pid) + '\')">Add to Sale</button>' : '') +
      '</div>';

    openModal(html);
  });
}

async function executeAddToSale(pid) {
  var selected = document.querySelector('input[name="addToSaleId"]:checked');
  if (!selected) { showToast('Select a sale', true); return; }
  var saleId = selected.value;

  try {
    var sale = await MastDB.promotions.get(saleId);
    if (!sale) { showToast('Sale not found', true); return; }

    var prods = sale.products || [];
    var existingPids = prods.map(function(p) { return typeof p === 'string' ? p : p.pid; });
    if (existingPids.indexOf(pid) !== -1) {
      showToast('Product is already in this sale', true);
      return;
    }

    prods.push(pid);
    await MastDB.promotions.update(saleId, { products: prods, updatedAt: new Date().toISOString() });
    writeAudit('update', 'sale-promotion', saleId);
    showToast('Added to ' + sale.name);
    closeModal();
  } catch (err) {
    showToast('Failed to add to sale', true);
  }
}

async function removeFromSale(saleId, pid) {
  try {
    var sale = await MastDB.promotions.get(saleId);
    if (!sale) return;
    var prods = (sale.products || []).filter(function(p) {
      return (typeof p === 'string' ? p : p.pid) !== pid;
    });
    await MastDB.promotions.update(saleId, { products: prods, updatedAt: new Date().toISOString() });
    writeAudit('update', 'sale-promotion', saleId);
    showToast('Removed from sale');
    closeModal();
  } catch (err) {
    showToast('Failed to remove from sale', true);
  }
}

  // Impl for the eager shim (1 externally-called) + the dialog's onclick targets.
  window.openAddToSaleDialogImpl = openAddToSaleDialog;
  window.executeAddToSale = executeAddToSale;
  window.removeFromSale = removeFromSale;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('addToSaleDialog', {});
  }
})();
