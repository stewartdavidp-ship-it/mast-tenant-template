/**
 * Hold / Release Stock modals — the maker inventory "Hold Stock" and
 * "Release Hold" dialogs (held stock is removed from available but stays on
 * hand: safety stock, personal use, quality holds, photography).
 *
 * Extracted from app/index.html's inline block (decomposition master plan,
 * Track 1 — first coupled-cluster extraction). Lazy-loaded on demand via the
 * eager openHoldStockModal / openReleaseHoldModal shims in index.html (both
 * called from generated inventory-detail HTML onclick).
 *
 * Reads/mutates eager shell globals (productsData, inventory, getInventoryTotals,
 * syncStockInfoToPublic, renderProductDetail, MastDB, esc, openModal, closeModal,
 * showToast) — all defined before a user can open a product's inventory detail.
 * The inventory write logic is moved verbatim (behavior-preserving).
 */
(function () {
  'use strict';

  function openHoldStockModal(pid) {
    var product = productsData.find(function(p) { return p.pid === pid; });
    var inv = inventory[pid] || {};
    var totals = getInventoryTotals(inv);
    var html = '<div style="max-width:400px;padding:24px;">' +
      '<h3>Hold Stock: ' + esc(product ? product.name : pid) + '</h3>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;margin:8px 0 16px;">Held stock is removed from available inventory but stays on hand. Use for safety stock, personal use, or quality holds.</p>' +
      '<div style="margin-bottom:8px;font-size:0.85rem;">Available to hold: <strong>' + totals.available + '</strong></div>' +
      '<div class="form-group"><label>Quantity</label>' +
        '<input type="number" id="holdQty" min="1" max="' + totals.available + '" value="1" style="width:100px;"></div>' +
      '<div class="form-group"><label>Reason</label>' +
        '<select id="holdReason">' +
          '<option value="safety_stock">Safety Stock</option>' +
          '<option value="personal_use">Personal Use</option>' +
          '<option value="quality_hold">Quality Hold</option>' +
          '<option value="photography">Photography</option>' +
          '<option value="other">Other</option>' +
        '</select></div>' +
      '<div class="form-group"><label>Note (optional)</label>' +
        '<input type="text" id="holdNote" placeholder="e.g., Set aside for holiday market"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="applyHoldStock(\'' + esc(pid) + '\')">Hold Stock</button>' +
      '</div>' +
    '</div>';
    openModal(html);
  }

  async function applyHoldStock(pid) {
    var qty = parseInt(document.getElementById('holdQty').value) || 0;
    var reason = document.getElementById('holdReason').value;
    var note = document.getElementById('holdNote').value.trim();
    if (qty <= 0) { showToast('Enter a quantity to hold.', true); return; }

    var inv = inventory[pid] || {};
    var totals = getInventoryTotals(inv);
    if (qty > totals.available) { showToast('Cannot hold more than available (' + totals.available + ').', true); return; }

    try {
      var now = new Date().toISOString();
      var heldPath = 'admin/inventory/' + pid + '/stock/_default/held';
      var curHeld = (await MastDB.get(heldPath)) || 0;
      await MastDB.set(heldPath, curHeld + qty);

      await MastDB.push('admin/inventory/' + pid + '/history', {
        action: 'held', reason: reason, qty: qty, note: note || null,
        actor: 'maker', actorType: 'maker', timestamp: now
      });
      await MastDB.inventory.set(pid + '/updatedAt', now);

      // Update local cache
      if (inventory[pid] && inventory[pid].stock && inventory[pid].stock._default) {
        inventory[pid].stock._default.held = (inventory[pid].stock._default.held || 0) + qty;
      }
      await syncStockInfoToPublic(pid);
      closeModal();
      showToast(qty + ' unit' + (qty !== 1 ? 's' : '') + ' held (' + reason.replace(/_/g, ' ') + ')');
      renderProductDetail(pid);
    } catch (err) {
      showToast('Error holding stock: ' + err.message, true);
    }
  }

  function openReleaseHoldModal(pid) {
    var product = productsData.find(function(p) { return p.pid === pid; });
    var inv = inventory[pid] || {};
    var totals = getInventoryTotals(inv);
    var html = '<div style="max-width:400px;padding:24px;">' +
      '<h3>Release Hold: ' + esc(product ? product.name : pid) + '</h3>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;margin:8px 0 16px;">Release held stock back to available inventory.</p>' +
      '<div style="margin-bottom:8px;font-size:0.85rem;">Currently held: <strong>' + totals.held + '</strong></div>' +
      '<div class="form-group"><label>Quantity to release</label>' +
        '<input type="number" id="releaseQty" min="1" max="' + totals.held + '" value="' + totals.held + '" style="width:100px;"></div>' +
      '<div class="form-group"><label>Note (optional)</label>' +
        '<input type="text" id="releaseNote" placeholder="e.g., Photography complete"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="applyReleaseHold(\'' + esc(pid) + '\')">Release</button>' +
      '</div>' +
    '</div>';
    openModal(html);
  }

  async function applyReleaseHold(pid) {
    var qty = parseInt(document.getElementById('releaseQty').value) || 0;
    var note = document.getElementById('releaseNote').value.trim();
    if (qty <= 0) { showToast('Enter a quantity to release.', true); return; }

    var inv = inventory[pid] || {};
    var totals = getInventoryTotals(inv);
    if (qty > totals.held) { showToast('Cannot release more than held (' + totals.held + ').', true); return; }

    try {
      var now = new Date().toISOString();
      var heldPath = 'admin/inventory/' + pid + '/stock/_default/held';
      var curHeld = (await MastDB.get(heldPath)) || 0;
      await MastDB.set(heldPath, Math.max(0, curHeld - qty));

      await MastDB.push('admin/inventory/' + pid + '/history', {
        action: 'released_hold', reason: 'hold_released', qty: -qty, note: note || null,
        actor: 'maker', actorType: 'maker', timestamp: now
      });
      await MastDB.inventory.set(pid + '/updatedAt', now);

      // Update local cache
      if (inventory[pid] && inventory[pid].stock && inventory[pid].stock._default) {
        inventory[pid].stock._default.held = Math.max(0, (inventory[pid].stock._default.held || 0) - qty);
      }
      await syncStockInfoToPublic(pid);
      closeModal();
      showToast(qty + ' unit' + (qty !== 1 ? 's' : '') + ' released from hold');
      renderProductDetail(pid);
    } catch (err) {
      showToast('Error releasing hold: ' + err.message, true);
    }
  }

  // Impls for the eager shims + the modals' onclick submit targets.
  window.openHoldStockModalImpl = openHoldStockModal;
  window.openReleaseHoldModalImpl = openReleaseHoldModal;
  window.applyHoldStock = applyHoldStock;
  window.applyReleaseHold = applyReleaseHold;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('holdReleaseStockModal', {});
  }
})();
