/**
 * Coupon dialogs — the admin "Add/Edit Coupon", "Share Coupon" (QR/claim link),
 * and "Delete Coupon" confirm dialogs.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager openCouponModal /
 * openCouponShareModal / confirmDeleteCoupon shims in index.html (the "+ Add
 * Coupon" button is static markup; the list Share/Edit/Delete actions are
 * generated onclick). coupons-v2.js re-implements these natively and only
 * references them in comments — no live cross-module call.
 *
 * Reads eager shell globals: coupons, window.MastCouponCard, esc, openModal,
 * closeModal, showToast, writeAudit, MastDB. All defined before the coupons
 * surface can render. Logic moved VERBATIM (behavior-preserving).
 */
(function () {
  'use strict';

function openCouponShareModal(code) {
  var c = coupons[code];
  if (!c) { showToast('Coupon not found', true); return; }
  var couponObj = Object.assign({}, c, { code: code, _code: code });
  var claimUrl = window.MastCouponCard.getClaimUrl(code, 'share');

  var html = '' +
    '<div class="modal-header">' +
      '<h3>Share Coupon: ' + esc(code) + '</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
      // Preview card
      '<div style="margin-bottom:20px;">' +
        window.MastCouponCard.renderHtml(couponObj, { showCta: false }) +
      '</div>' +
      // Export options
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<button class="btn btn-primary" id="csm-copy-link" style="display:flex;align-items:center;gap:8px;justify-content:center;">' +
          '\uD83D\uDD17 Copy Claim Link' +
        '</button>' +
        '<button class="btn btn-outline" id="csm-copy-html" style="display:flex;align-items:center;gap:8px;justify-content:center;">' +
          '\uD83D\uDCCB Copy HTML Embed' +
        '</button>' +
        '<button class="btn btn-secondary" id="csm-download-img" style="display:flex;align-items:center;gap:8px;justify-content:center;">' +
          '\uD83D\uDDBC\uFE0F Download Coupon Image (with QR)' +
        '</button>' +
        '<button class="btn btn-secondary" id="csm-download-qr" style="display:flex;align-items:center;gap:8px;justify-content:center;">' +
          '\uD83D\uDCF1 Download QR Code' +
        '</button>' +
      '</div>' +
      '<div id="csm-status" style="margin-top:12px;text-align:center;font-size:0.85rem;color:var(--teal);display:none;"></div>' +
    '</div>';

  openModal(html);

  function showCsmStatus(msg) {
    var el = document.getElementById('csm-status');
    if (el) { el.textContent = msg; el.style.display = ''; setTimeout(function() { el.style.display = 'none'; }, 3000); }
  }

  // Copy Claim Link
  document.getElementById('csm-copy-link').addEventListener('click', function() {
    window.MastUI.copy(claimUrl, { okMsg: false, errMsg: false }).then(function() {
      showCsmStatus('Link copied to clipboard!');
    });
  });

  // Copy HTML Embed
  document.getElementById('csm-copy-html').addEventListener('click', function() {
    var embedHtml = window.MastCouponCard.renderHtml(couponObj, { emailSafe: true, showCta: true, source: 'share' });
    window.MastUI.copy(embedHtml, { okMsg: false, errMsg: false }).then(function() {
      showCsmStatus('HTML embed copied! Paste into any email builder or CMS.');
    });
  });

  // Download Coupon Image (with QR)
  document.getElementById('csm-download-img').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Generating...';
    window.MastCouponCard.renderToCanvas(couponObj, { showQr: true, source: 'share' }).then(function(canvas) {
      canvas.toBlob(function(blob) {
        MastExport.downloadBlob('coupon-' + code + '.png', blob);
        btn.disabled = false; btn.textContent = '\uD83D\uDDBC\uFE0F Download Coupon Image (with QR)';
        showCsmStatus('Image downloaded!');
      }, 'image/png');
    });
  });

  // Download QR Code
  document.getElementById('csm-download-qr').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Downloading...';
    var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(claimUrl);
    fetch(qrUrl).then(function(r) { return r.blob(); }).then(function(blob) {
      MastExport.downloadBlob('coupon-qr-' + code + '.png', blob);
      btn.disabled = false; btn.textContent = '\uD83D\uDCF1 Download QR Code';
      showCsmStatus('QR code downloaded!');
    }).catch(function() {
      btn.disabled = false; btn.textContent = '\uD83D\uDCF1 Download QR Code';
      showToast('Failed to download QR code', true);
    });
  });
}

function openCouponModal(code) {
  var isEdit = !!code;
  var c = isEdit ? (coupons[code] || {}) : {};
  var title = isEdit ? 'Edit Coupon' : 'Add Coupon';

  var html = '' +
    '<div class="modal-header">' +
      '<h3>' + title + '</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div class="form-group">' +
        '<label for="cpCode">Code *</label>' +
        '<input type="text" id="cpCode" value="' + esc(code || '') + '" placeholder="e.g. SUMMER20" style="text-transform:uppercase;"' +
          (isEdit ? ' disabled' : '') + '>' +
      '</div>' +
      '<div class="checkout-form-row">' +
        '<div class="form-group">' +
          '<label for="cpType">Type *</label>' +
          '<select id="cpType" onchange="couponTypeChanged()">' +
            '<option value="percent"' + (c.type === 'percent' || !c.type ? ' selected' : '') + '>Percent Off</option>' +
            '<option value="fixed"' + (c.type === 'fixed' ? ' selected' : '') + '>Fixed Amount</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="cpValue">Value *</label>' +
          '<input type="number" id="cpValue" min="0" step="any" value="' + (c.value || '') + '" placeholder="e.g. 15">' +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="cpMinOrder">Minimum Order ($)</label>' +
        '<input type="number" id="cpMinOrder" min="0" step="0.01" value="' + (c.minOrder || '') + '" placeholder="Optional">' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="cpStatus">Status *</label>' +
        '<select id="cpStatus">' +
          '<option value="pending"' + (c.status === 'pending' ? ' selected' : '') + '>Pending</option>' +
          '<option value="active"' + (c.status === 'active' || !c.status ? ' selected' : '') + '>Active</option>' +
          '<option value="expired"' + (c.status === 'expired' ? ' selected' : '') + '>Expired</option>' +
        '</select>' +
      '</div>' +
      '<div class="checkout-form-row">' +
        '<div class="form-group">' +
          '<label for="cpStartDate">Start Date</label>' +
          '<input type="date" id="cpStartDate" value="' + (c.startDate || '') + '">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="cpEndDate">End Date</label>' +
          '<input type="date" id="cpEndDate" value="' + (c.endDate || '') + '">' +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<div class="form-check">' +
          '<input type="checkbox" id="cpOneOff"' + (c.isOneOff ? ' checked' : '') + ' onchange="couponOneOffChanged()">' +
          '<label for="cpOneOff">One-off code (single use, auto-expires after claim)</label>' +
        '</div>' +
      '</div>' +
      '<div class="form-group" id="cpMaxUsesGroup"' + (c.isOneOff ? ' style="display:none;"' : '') + '>' +
        '<label for="cpMaxUses">Max Uses</label>' +
        '<input type="number" id="cpMaxUses" min="1" value="' + (c.maxUses || '') + '" placeholder="Unlimited">' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="cpDesc">Description <span style="color:var(--warm-gray-light);font-weight:300;">(admin note)</span></label>' +
        '<input type="text" id="cpDesc" value="' + esc(c.description || '') + '" placeholder="e.g. Summer promo for returning customers">' +
      '</div>' +
      '<div class="form-group">' +
        '<div class="form-check">' +
          '<input type="checkbox" id="cpExcludeSaleItems"' + (c.excludeSaleItems ? ' checked' : '') + '>' +
          '<label for="cpExcludeSaleItems">Exclude sale items (coupon won\'t apply to products already on sale)</label>' +
        '</div>' +
      '</div>' +
      (isEdit ? '<div class="coupon-meta" style="margin-top:8px;">Claimed: ' + (c.claimedCount || 0) + ' time' + ((c.claimedCount || 0) !== 1 ? 's' : '') + '</div>' : '') +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveCoupon(\'' + esc(code || '') + '\')">' + (isEdit ? 'Update' : 'Create') + '</button>' +
    '</div>';

  openModal(html);
  setTimeout(function() {
    var el = document.getElementById(isEdit ? 'cpValue' : 'cpCode');
    if (el) el.focus();
  }, 100);
}

function couponTypeChanged() {
  var typeEl = document.getElementById('cpType');
  var valueEl = document.getElementById('cpValue');
  if (!typeEl || !valueEl) return;
  valueEl.placeholder = typeEl.value === 'percent' ? 'e.g. 15' : 'e.g. 5.00';
}

function couponOneOffChanged() {
  var cb = document.getElementById('cpOneOff');
  var maxGroup = document.getElementById('cpMaxUsesGroup');
  if (!cb || !maxGroup) return;
  maxGroup.style.display = cb.checked ? 'none' : '';
  if (cb.checked) {
    var maxEl = document.getElementById('cpMaxUses');
    if (maxEl) maxEl.value = '';
  }
}

async function saveCoupon(existingCode) {
  var isEdit = !!existingCode;
  var codeEl = document.getElementById('cpCode');
  var code = codeEl ? codeEl.value.trim().toUpperCase() : '';

  if (!isEdit && !validateRequired([{ el: 'cpCode', msg: 'Coupon code is required' }])) {
    showToast('Coupon code is required.', true);
    return;
  }
  if (!isEdit && code.length > 30) {
    showToast('Code must be 30 characters or less.', true);
    return;
  }
  if (!isEdit && coupons[code]) {
    showToast('A coupon with code "' + code + '" already exists.', true);
    return;
  }

  var type = document.getElementById('cpType').value;
  var value = parseFloat(document.getElementById('cpValue').value);
  if (isNaN(value) || value <= 0) {
    showToast('Value must be greater than 0.', true);
    return;
  }
  if (type === 'percent' && value > 100) {
    showToast('Percent value cannot exceed 100.', true);
    return;
  }

  var minOrderVal = document.getElementById('cpMinOrder').value.trim();
  var minOrder = minOrderVal ? parseFloat(minOrderVal) : null;
  var status = document.getElementById('cpStatus').value;
  var startDate = document.getElementById('cpStartDate').value || null;
  var endDate = document.getElementById('cpEndDate').value || null;
  var isOneOff = document.getElementById('cpOneOff').checked;
  var maxUsesVal = document.getElementById('cpMaxUses').value.trim();
  var maxUses = isOneOff ? 1 : (maxUsesVal ? parseInt(maxUsesVal) : null);
  var description = document.getElementById('cpDesc').value.trim();
  var excludeSaleItems = document.getElementById('cpExcludeSaleItems').checked;

  if (startDate && endDate && endDate < startDate) {
    showToast('End date must be after start date.', true);
    return;
  }

  var key = isEdit ? existingCode : code;
  var data = {
    type: type,
    value: value,
    status: status,
    startDate: startDate,
    endDate: endDate,
    isOneOff: isOneOff,
    maxUses: maxUses,
    description: description || null,
    minOrder: minOrder,
    excludeSaleItems: excludeSaleItems,
    updatedAt: new Date().toISOString()
  };

  if (!isEdit) {
    data.claimedCount = 0;
    data.createdAt = new Date().toISOString();
  }

  try {
    if (isEdit) {
      await MastDB.coupons.update(key, data);
      await writeAudit('update', 'coupons', key);
      showToast('Coupon updated.');
    } else {
      await MastDB.coupons.set(key, data);
      await writeAudit('create', 'coupons', key);
      showToast('Coupon created.');
    }
    closeModal();
  } catch (err) {
    showToast('Error saving coupon: ' + err.message, true);
  }
}

function confirmDeleteCoupon(code) {
  var html = '' +
    '<div class="confirm-body">' +
      '<h3>Delete Coupon</h3>' +
      '<p>Delete coupon "<strong>' + esc(code) + '</strong>"? This cannot be undone.</p>' +
      '<div class="confirm-actions">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-danger" onclick="deleteCoupon(\'' + esc(code) + '\')">Delete</button>' +
      '</div>' +
    '</div>';
  openModal(html);
}

async function deleteCoupon(code) {
  try {
    await writeAudit('delete', 'coupons', code);
    await MastDB.coupons.remove(code);
    showToast('Coupon deleted.');
    closeModal();
  } catch (err) {
    showToast('Error deleting coupon: ' + err.message, true);
  }
}

  // Impls for the eager shims (3 externally-called) + the dialogs' onclick targets.
  window.openCouponShareModalImpl = openCouponShareModal;
  window.openCouponModalImpl = openCouponModal;
  window.confirmDeleteCouponImpl = confirmDeleteCoupon;
  window.saveCoupon = saveCoupon;
  window.deleteCoupon = deleteCoupon;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('couponModals', {});
  }
})();
