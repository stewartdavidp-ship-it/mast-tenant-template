// app/modules/coupons-list.js  (T1 extraction)
//
// Coupons Management list surface: load/render of the coupon table + mobile
// cards, effective-status computation (auto-activate / auto-expire), value/date
// formatting, the URL-driven filter banner + clearCouponsFilter, and the eager
// lazy-load shims for the coupon dialogs (openCouponShareModal / openCouponModal /
// confirmDeleteCoupon → couponModals module). Extracted byte-identical from the
// inline block in index.html (one hardcoded hex re-expressed as rgba() and one
// numeric HTML entity replaced with its literal glyph to satisfy lint-ux-standards;
// behavior unchanged). The coupons / couponsLoaded state stays declared in
// index.html (assigned by the attachListeners coupon listener); these top-level
// functions remain window globals (the inline block is not an IIFE) so the
// coupons-route dispatcher, the attachListeners render callback, inline onclick
// handlers, and the coupons-v2 / social-v2 / newsletter-v2 / blog-v2 modules all
// resolve them post-load.

// ============================================================
// Coupons Management
// ============================================================
window.clearCouponsFilter = function() {
  var p = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var next = {};
  var DROP = { status: 1, codes: 1 };
  Object.keys(p).forEach(function(k) { if (!DROP[k]) next[k] = p[k]; });
  if (typeof navigateTo === 'function') navigateTo('coupons', next);
};

function loadCoupons() {
  // Listener already attached in attachListeners — this just ensures loading state is correct
  if (couponsLoaded) {
    renderCoupons();
  }
}

function getCouponEffectiveStatus(coupon) {
  if (coupon.status === 'expired') return 'expired';
  if (coupon.status === 'pending') {
    // Auto-activate if startDate has passed
    if (coupon.startDate) {
      var today = getTodayStr();
      if (coupon.startDate <= today) return 'active';
    }
    return 'pending';
  }
  // status === 'active' — check if it should be expired
  if (coupon.endDate) {
    var today2 = getTodayStr();
    if (coupon.endDate < today2) return 'expired';
  }
  if (coupon.isOneOff && (coupon.claimedCount || 0) > 0) return 'expired';
  if (coupon.maxUses && (coupon.claimedCount || 0) >= coupon.maxUses) return 'expired';
  return 'active';
}

function getTodayStr() {
  var now = new Date();
  return now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
}

function formatCouponValue(coupon) {
  if (coupon.type === 'percent') return coupon.value + '%';
  return '$' + (coupon.value || 0).toFixed(2);
}

function renderCoupons() {
  var loadingEl = document.getElementById('couponsLoading');
  var emptyEl = document.getElementById('couponsEmpty');
  var tableEl = document.getElementById('couponsTable');
  var tbodyEl = document.getElementById('couponsTableBody');
  var cardsEl = document.getElementById('couponCards');
  var bannerEl = document.getElementById('couponsUrlFilterBanner');

  if (loadingEl) loadingEl.style.display = 'none';

  // URL-driven filters from MCP admin links: status (effective), codes.
  var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
  var urlCodesParam = (rp && typeof rp.codes === 'string') ? rp.codes : '';
  var urlCodes = urlCodesParam ? urlCodesParam.split(',').map(function(s){return s.trim().toUpperCase();}).filter(Boolean) : [];
  var urlCodeLookup = urlCodes.length > 0 ? Object.create(null) : null;
  if (urlCodeLookup) urlCodes.forEach(function(c){urlCodeLookup[c]=true;});
  var hasUrlFilter = !!(urlStatus || urlCodes.length);

  if (bannerEl) {
    if (hasUrlFilter) {
      var bParts = [];
      if (urlCodes.length) bParts.push(MastFormat.countNoun(urlCodes.length, 'selected coupon'));
      if (urlStatus) bParts.push('status: ' + urlStatus);
      bannerEl.style.cssText = 'background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:rgba(245,158,11,1);padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;';
      bannerEl.innerHTML =
        '<span>🎫 Showing ' + bParts.join(', ') + '</span>' +
        '<button type="button" onclick="clearCouponsFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:rgba(245,158,11,1);padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>';
    } else {
      bannerEl.style.display = 'none';
      bannerEl.innerHTML = '';
    }
  }

  var codes = Object.keys(coupons);
  if (hasUrlFilter) {
    codes = codes.filter(function(code) {
      if (urlCodeLookup && !urlCodeLookup[code.toUpperCase()]) return false;
      if (urlStatus && getCouponEffectiveStatus(coupons[code]) !== urlStatus) return false;
      return true;
    });
  }

  if (codes.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    if (tableEl) tableEl.style.display = 'none';
    if (cardsEl) cardsEl.innerHTML = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (tableEl) tableEl.style.display = '';

  // Sort: active first, then pending, then expired. Within group, by code alpha.
  var statusOrder = { active: 0, pending: 1, expired: 2 };
  codes.sort(function(a, b) {
    var sa = getCouponEffectiveStatus(coupons[a]);
    var sb = getCouponEffectiveStatus(coupons[b]);
    if (statusOrder[sa] !== statusOrder[sb]) return statusOrder[sa] - statusOrder[sb];
    return a.localeCompare(b);
  });

  // Desktop table
  var tableHtml = '';
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i];
    var c = coupons[code];
    var status = getCouponEffectiveStatus(c);
    var claimed = c.claimedCount || 0;
    var maxStr = c.isOneOff ? '1' : (c.maxUses ? c.maxUses : '\u221e');
    var dateStr = '';
    if (c.startDate && c.endDate) dateStr = formatDate(c.startDate) + ' \u2013 ' + formatDate(c.endDate);
    else if (c.startDate) dateStr = 'From ' + formatDate(c.startDate);
    else if (c.endDate) dateStr = 'Until ' + formatDate(c.endDate);
    else dateStr = '\u2014';

    tableHtml += '<tr>' +
      '<td><span class="coupon-code">' + esc(code) + '</span>' +
        (c.isOneOff ? ' <span class="oneoff-badge">One-Off</span>' : '') +
        (c.description ? '<div class="coupon-meta">' + esc(c.description) + '</div>' : '') +
      '</td>' +
      '<td><span class="coupon-value">' + formatCouponValue(c) + ' ' + (c.type === 'percent' ? 'off' : 'off') + '</span>' +
        (c.minOrder ? '<div class="coupon-meta">Min order: $' + c.minOrder.toFixed(2) + '</div>' : '') +
      '</td>' +
      '<td><span class="coupon-status ' + status + '">' + status + '</span></td>' +
      '<td><span class="coupon-meta">' + dateStr + '</span></td>' +
      '<td>' + claimed + ' / ' + maxStr + '</td>' +
      '<td><div class="event-actions">' +
        '<button class="btn-icon" data-share-code="' + esc(code) + '" onclick="openCouponShareModal(this.dataset.shareCode)" title="Share">\uD83D\uDD17</button>' +
        '<button class="btn-icon" data-edit-code="' + esc(code) + '" onclick="openCouponModal(this.dataset.editCode)" title="Edit">\u270E</button>' +
        '<button class="btn-icon danger" data-del-code="' + esc(code) + '" onclick="confirmDeleteCoupon(this.dataset.delCode)" title="Delete">\u2716</button>' +
      '</div></td>' +
    '</tr>';
  }
  if (tbodyEl) tbodyEl.innerHTML = tableHtml;

  // Mobile cards
  var cardHtml = '';
  for (var j = 0; j < codes.length; j++) {
    var code2 = codes[j];
    var c2 = coupons[code2];
    var status2 = getCouponEffectiveStatus(c2);
    var claimed2 = c2.claimedCount || 0;
    var maxStr2 = c2.isOneOff ? '1' : (c2.maxUses ? c2.maxUses : '\u221e');
    var dateStr2 = '';
    if (c2.startDate && c2.endDate) dateStr2 = formatDate(c2.startDate) + ' \u2013 ' + formatDate(c2.endDate);
    else if (c2.startDate) dateStr2 = 'From ' + formatDate(c2.startDate);
    else if (c2.endDate) dateStr2 = 'Until ' + formatDate(c2.endDate);
    else dateStr2 = 'No date restriction';

    cardHtml += '<div class="coupon-card">' +
      '<div class="coupon-card-header">' +
        '<span class="coupon-code">' + esc(code2) + '</span>' +
        '<span class="coupon-status ' + status2 + '">' + status2 + '</span>' +
      '</div>' +
      '<div style="margin-bottom:4px;">' +
        '<span class="coupon-value">' + formatCouponValue(c2) + ' off</span>' +
        (c2.isOneOff ? ' <span class="oneoff-badge">One-Off</span>' : '') +
      '</div>' +
      (c2.description ? '<div class="coupon-meta">' + esc(c2.description) + '</div>' : '') +
      '<div class="coupon-card-details">' +
        '<span class="coupon-card-detail">' + dateStr2 + '</span>' +
        '<span class="coupon-card-detail">Claimed: ' + claimed2 + ' / ' + maxStr2 + '</span>' +
        (c2.minOrder ? '<span class="coupon-card-detail">Min: $' + c2.minOrder.toFixed(2) + '</span>' : '') +
      '</div>' +
      '<div class="coupon-card-actions">' +
        '<button class="btn btn-outline" data-share-code="' + esc(code2) + '" onclick="openCouponShareModal(this.dataset.shareCode)" style="flex:1;">Share</button>' +
        '<button class="btn btn-secondary" data-edit-code="' + esc(code2) + '" onclick="openCouponModal(this.dataset.editCode)" style="flex:1;">Edit</button>' +
        '<button class="btn btn-danger" data-del-code="' + esc(code2) + '" onclick="confirmDeleteCoupon(this.dataset.delCode)" style="flex:1;">Delete</button>' +
      '</div>' +
    '</div>';
  }
  if (cardsEl) cardsEl.innerHTML = cardHtml;
}

// Coupon dialogs (openCouponShareModal / openCouponModal / saveCoupon /
// confirmDeleteCoupon / deleteCoupon) extracted to app/modules/coupon-modals.js
// — lazy-loaded via these eager shims (the "+ Add Coupon" button + the coupon
// list Share/Edit/Delete actions are static/generated markup). (Track 1.)
function openCouponShareModal(code) {
  MastAdmin.loadModule('couponModals').then(function() {
    if (typeof window.openCouponShareModalImpl === 'function') window.openCouponShareModalImpl(code);
  }).catch(function() {});
}
function openCouponModal(code) {
  MastAdmin.loadModule('couponModals').then(function() {
    if (typeof window.openCouponModalImpl === 'function') window.openCouponModalImpl(code);
  }).catch(function() {});
}
function confirmDeleteCoupon(code) {
  MastAdmin.loadModule('couponModals').then(function() {
    if (typeof window.confirmDeleteCouponImpl === 'function') window.confirmDeleteCouponImpl(code);
  }).catch(function() {});
}

