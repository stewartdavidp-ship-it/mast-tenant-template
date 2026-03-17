(function() {
  'use strict';

  var FUNCTIONS_BASE = 'https://us-central1-mast-platform-prod.cloudfunctions.net';
  var app = document.getElementById('app');
  var slug = '';
  var data = null;
  var activeTab = 'vendors';
  var searchQuery = '';
  var selectedCategories = [];
  var pinnedVendors = [];
  var savedCoupons = [];
  var selectedVendor = null;
  var huntParticipantId = null;
  var huntStatus = null;

  function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function init() {
    // Parse slug from URL path: /show/{slug} or /show/index.html → extract slug
    var path = window.location.pathname;
    var parts = path.split('/').filter(Boolean);
    var showIdx = parts.indexOf('show');
    if (showIdx >= 0 && parts[showIdx + 1] && parts[showIdx + 1] !== 'index.html') {
      slug = decodeURIComponent(parts[showIdx + 1]);
    } else {
      // Try query param fallback
      slug = new URLSearchParams(window.location.search).get('slug') || '';
    }

    if (!slug) {
      renderError('No show specified', 'Please check the URL and try again.');
      return;
    }

    // Load localStorage data
    pinnedVendors = JSON.parse(localStorage.getItem('mast-pins-' + slug) || '[]');
    savedCoupons = JSON.parse(localStorage.getItem('mast-coupons-' + slug) || '[]');
    huntParticipantId = localStorage.getItem('mast-hunt-' + slug) || null;

    loadShowData();
  }

  function loadShowData() {
    fetch(FUNCTIONS_BASE + '/eventsGetPublicShowData?slug=' + encodeURIComponent(slug))
      .then(function(r) {
        if (!r.ok) throw new Error('Show not found');
        return r.json();
      })
      .then(function(d) {
        data = d;
        document.title = esc(data.show.name);
        render();
        if (data.huntEnabled && huntParticipantId) loadHuntStatus();
      })
      .catch(function(err) {
        renderError('Show not found', 'This show may have been removed or the link is incorrect.');
      });
  }

  function loadHuntStatus() {
    if (!data || !huntParticipantId) return;
    fetch(FUNCTIONS_BASE + '/eventsGetHuntStatus?tenantId=' + encodeURIComponent(data.tenantId) +
      '&showId=' + encodeURIComponent(data.show.id) + '&participantId=' + encodeURIComponent(huntParticipantId))
      .then(function(r) { return r.json(); })
      .then(function(d) { huntStatus = d; render(); })
      .catch(function() {});
  }

  function renderError(title, msg) {
    app.innerHTML = '<div class="error-page"><h2>' + esc(title) + '</h2><p>' + esc(msg) + '</p></div>';
  }

  function render() {
    if (!data) return;
    var show = data.show;
    var vendors = data.vendors || [];
    var promotions = data.promotions || [];

    // Build categories
    var categories = [];
    var catMap = {};
    vendors.forEach(function(v) {
      if (v.category && !catMap[v.category]) {
        catMap[v.category] = true;
        categories.push(v.category);
      }
    });
    categories.sort();

    // Filter vendors
    var filtered = vendors.filter(function(v) {
      if (searchQuery) {
        var q = searchQuery.toLowerCase();
        if ((v.businessName || '').toLowerCase().indexOf(q) < 0 &&
            (v.category || '').toLowerCase().indexOf(q) < 0 &&
            (v.businessDescription || '').toLowerCase().indexOf(q) < 0) return false;
      }
      if (selectedCategories.length > 0 && selectedCategories.indexOf(v.category) < 0) return false;
      return true;
    });

    var pinned = vendors.filter(function(v) { return pinnedVendors.indexOf(v.id) >= 0; });

    // Count promotions
    var promoCount = promotions.length;

    // Tabs
    var tabs = [
      { id: 'vendors', label: 'Vendors', count: vendors.length },
      { id: 'pinned', label: 'Pinned', count: pinned.length }
    ];
    if (promoCount > 0) tabs.push({ id: 'coupons', label: 'Coupons', count: promoCount });
    if (data.huntEnabled) tabs.push({ id: 'hunt', label: 'Hunt', count: null });
    if (show.floorPlanUrl) tabs.push({ id: 'map', label: 'Map', count: null });

    var html = '';

    // Header
    html += '<div class="show-header"><div class="show-header-inner">';
    html += '<h1 class="show-name">' + esc(show.name) + '</h1>';
    html += '<div class="show-meta">';
    if (show.startDate) {
      var dateStr = show.startDate;
      if (show.endDate && show.endDate !== show.startDate) dateStr += ' — ' + show.endDate;
      html += '<span>📅 ' + esc(dateStr) + '</span>';
    }
    if (show.venue) html += '<span>📍 ' + esc(show.venue) + '</span>';
    if (show.city && show.state) html += '<span>' + esc(show.city) + ', ' + esc(show.state) + '</span>';
    html += '</div>';
    if (show.description) html += '<p class="show-desc">' + esc(show.description) + '</p>';
    if (show.attendeeNotes) html += '<div class="show-notes">' + esc(show.attendeeNotes) + '</div>';
    if (show.externalLinks && show.externalLinks.length > 0) {
      html += '<div class="show-links">';
      show.externalLinks.forEach(function(link) {
        html += '<a href="' + esc(link.url) + '" target="_blank" rel="noopener">' + esc(link.label || link.url) + ' ↗</a>';
      });
      html += '</div>';
    }
    html += '</div></div>';

    // Tabs
    html += '<div class="tabs"><div class="tabs-inner">';
    tabs.forEach(function(t) {
      html += '<button class="tab-btn' + (activeTab === t.id ? ' active' : '') + '" onclick="setTab(\'' + t.id + '\')">' + esc(t.label);
      if (t.count !== null) html += '<span class="tab-count">' + t.count + '</span>';
      html += '</button>';
    });
    html += '</div></div>';

    // Content
    html += '<div class="content">';

    if (activeTab === 'vendors') {
      // Search
      html += '<input class="search-input" type="text" placeholder="Search vendors..." value="' + esc(searchQuery) + '" oninput="setSearch(this.value)">';
      // Category filters
      if (categories.length > 1) {
        html += '<div class="filters">';
        categories.forEach(function(c) {
          var isActive = selectedCategories.indexOf(c) >= 0;
          html += '<button class="filter-chip' + (isActive ? ' active' : '') + '" onclick="toggleCategory(\'' + esc(c).replace(/'/g, "\\'") + '\')">' + esc(c) + '</button>';
        });
        html += '</div>';
      }
      // Vendor grid
      if (filtered.length === 0) {
        html += '<div class="empty-state"><h3>No vendors found</h3><p>Try adjusting your search or filters.</p></div>';
      } else {
        html += '<div class="vendor-grid">';
        filtered.forEach(function(v) { html += renderVendorCard(v, promotions); });
        html += '</div>';
      }
    } else if (activeTab === 'pinned') {
      if (pinned.length === 0) {
        html += '<div class="empty-state"><h3>No pinned vendors</h3><p>Tap the pin icon on a vendor card to save them here.</p></div>';
      } else {
        html += '<div class="vendor-grid">';
        pinned.forEach(function(v) { html += renderVendorCard(v, promotions); });
        html += '</div>';
      }
    } else if (activeTab === 'coupons') {
      html += renderCouponsTab(promotions, vendors);
    } else if (activeTab === 'hunt') {
      html += renderHuntTab();
    } else if (activeTab === 'map') {
      html += renderMapTab();
    }

    html += '</div>';

    // Vendor detail modal
    if (selectedVendor) {
      html += renderVendorModal(selectedVendor, promotions);
    }

    app.innerHTML = html;
  }

  function renderVendorCard(v, promotions) {
    var isPinned = pinnedVendors.indexOf(v.id) >= 0;
    var hasPromo = promotions.some(function(p) { return p.vendorId === v.id; });
    var booth = v.boothId && data.booths[v.boothId] ? data.booths[v.boothId] : null;

    var h = '<div class="vendor-card" onclick="openVendor(\'' + esc(v.id) + '\')">';
    h += '<div class="vendor-card-header">';
    if (v.logoUrl) {
      h += '<img class="vendor-logo" src="' + esc(v.logoUrl) + '" alt="' + esc(v.businessName) + '" onerror="this.style.display=\'none\'">';
    } else {
      h += '<div class="vendor-logo-placeholder">' + esc((v.businessName || '?')[0].toUpperCase()) + '</div>';
    }
    h += '<div><div class="vendor-name">' + esc(v.businessName) + '</div>';
    if (v.category) h += '<div class="vendor-category">' + esc(v.category) + '</div>';
    h += '</div></div>';
    if (v.businessDescription || v.bio) {
      h += '<div class="vendor-bio">' + esc(v.businessDescription || v.bio) + '</div>';
    }
    h += '<div class="vendor-tags">';
    if (booth) h += '<span class="vendor-booth-badge">Booth ' + esc(booth.name) + '</span>';
    if (hasPromo) h += '<span class="vendor-promo-badge">🎟 Deal</span>';
    (v.tags || []).forEach(function(t) { h += '<span class="vendor-tag">' + esc(t) + '</span>'; });
    h += '</div>';
    h += '<div style="display:flex;justify-content:flex-end;margin-top:8px;" onclick="event.stopPropagation()">';
    h += '<button class="pin-btn' + (isPinned ? ' pinned' : '') + '" onclick="togglePin(\'' + esc(v.id) + '\')">' + (isPinned ? '📌 Pinned' : '📌 Pin') + '</button>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  function renderVendorModal(v, promotions) {
    var vendorPromos = promotions.filter(function(p) { return p.vendorId === v.id; });
    var booth = v.boothId && data.booths[v.boothId] ? data.booths[v.boothId] : null;

    var h = '<div class="modal-overlay" onclick="closeVendor()">';
    h += '<div class="modal-box" onclick="event.stopPropagation()" style="position:relative;">';
    h += '<button class="modal-close" onclick="closeVendor()">✕</button>';

    h += '<div class="modal-vendor-header">';
    if (v.logoUrl) {
      h += '<img class="modal-vendor-logo" src="' + esc(v.logoUrl) + '" alt="" onerror="this.style.display=\'none\'">';
    } else {
      h += '<div class="vendor-logo-placeholder" style="width:64px;height:64px;font-size:24px;">' + esc((v.businessName || '?')[0].toUpperCase()) + '</div>';
    }
    h += '<div><div class="modal-vendor-name">' + esc(v.businessName) + '</div>';
    if (v.category) h += '<div class="modal-vendor-category">' + esc(v.category) + '</div>';
    h += '</div></div>';

    if (v.businessDescription || v.bio) {
      h += '<p style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:12px;">' + esc(v.businessDescription || v.bio) + '</p>';
    }

    if (booth) {
      h += '<div class="modal-section"><h4>Booth</h4>';
      h += '<p style="font-size:14px;">' + esc(booth.name);
      if (booth.location) h += ' — ' + esc(booth.location);
      h += '</p></div>';
    }

    // Links
    if (v.websiteUrl || v.instagramHandle) {
      h += '<div class="modal-section"><h4>Links</h4>';
      if (v.websiteUrl) h += '<a class="modal-link" href="' + esc(v.websiteUrl) + '" target="_blank" rel="noopener">🌐 Website</a>';
      if (v.instagramHandle) h += '<a class="modal-link" href="https://instagram.com/' + esc(v.instagramHandle.replace('@', '')) + '" target="_blank" rel="noopener">📷 Instagram</a>';
      if (v.mastTenantId) h += '<a class="modal-link" href="#" onclick="event.preventDefault()">🛍 Shop</a>';
      h += '</div>';
    }

    // Deals
    if (vendorPromos.length > 0) {
      h += '<div class="modal-section"><h4>Deals</h4>';
      vendorPromos.forEach(function(p) {
        var val = p.couponType === 'percentage' ? (p.couponValue + '% off') : ('$' + (p.couponValue / 100).toFixed(2) + ' off');
        h += '<div class="coupon-card">';
        h += '<div class="coupon-code">' + esc(p.mastCouponCode) + '</div>';
        h += '<div class="coupon-desc">' + esc(val);
        if (p.attendeeMessage) h += ' — ' + esc(p.attendeeMessage);
        h += '</div></div>';
      });
      h += '</div>';
    }

    h += '</div></div>';
    return h;
  }

  function renderCouponsTab(promotions, vendors) {
    if (promotions.length === 0) return '<div class="empty-state"><h3>No active deals</h3><p>Check back later for vendor promotions.</p></div>';

    var vendorMap = {};
    vendors.forEach(function(v) { vendorMap[v.id] = v; });

    var h = '<div class="coupon-list">';
    promotions.forEach(function(p) {
      var v = vendorMap[p.vendorId] || {};
      var val = p.couponType === 'percentage' ? (p.couponValue + '% off') : ('$' + (p.couponValue / 100).toFixed(2) + ' off');
      var isSaved = savedCoupons.indexOf(p.id) >= 0;
      h += '<div class="coupon-item">';
      h += '<div class="coupon-vendor">' + esc(v.businessName || 'Vendor') + '</div>';
      h += '<div class="coupon-code">' + esc(p.mastCouponCode) + '</div>';
      h += '<div class="coupon-value">' + esc(val) + '</div>';
      if (p.attendeeMessage) h += '<p style="font-size:13px;color:var(--text-secondary);margin-top:4px;">' + esc(p.attendeeMessage) + '</p>';
      h += '<button class="coupon-save-btn' + (isSaved ? ' saved' : '') + '" onclick="toggleCoupon(\'' + esc(p.id) + '\')">' + (isSaved ? 'Saved ✓' : 'Save') + '</button>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function renderHuntTab() {
    if (!data.huntConfig) return '<div class="empty-state"><h3>Scavenger hunt not available</h3></div>';
    var hc = data.huntConfig;
    var h = '<div class="hunt-banner">';
    h += '<h3>🔍 Scavenger Hunt</h3>';
    h += '<p>Visit ' + hc.target + ' vendor booths to win!</p>';
    if (hc.prize) h += '<p style="margin-top:8px;font-weight:600;">' + esc(hc.prize) + '</p>';

    if (huntStatus) {
      var pct = Math.min(100, Math.round((huntStatus.visitCount / hc.target) * 100));
      h += '<div class="hunt-progress">';
      h += '<p style="font-size:20px;font-weight:700;">' + huntStatus.visitCount + ' / ' + hc.target + '</p>';
      h += '<div class="hunt-bar"><div class="hunt-bar-fill" style="width:' + pct + '%"></div></div>';
      if (huntStatus.completed) {
        h += '<p style="margin-top:12px;font-size:15px;font-weight:600;">🎉 Hunt complete!</p>';
        if (huntStatus.completionCode) h += '<p style="margin-top:4px;">Code: <strong>' + esc(huntStatus.completionCode) + '</strong></p>';
        if (hc.claimInstructions) h += '<p style="margin-top:8px;font-size:13px;opacity:0.9;">' + esc(hc.claimInstructions) + '</p>';
      }
      h += '</div>';
    } else if (huntParticipantId) {
      h += '<p style="margin-top:12px;font-size:13px;opacity:0.8;">Loading your progress...</p>';
    } else {
      h += '<p style="margin-top:12px;font-size:13px;opacity:0.8;">Scan QR codes at vendor booths to participate!</p>';
    }

    h += '</div>';
    return h;
  }

  function renderMapTab() {
    if (!data.show.floorPlanUrl) return '<div class="empty-state"><h3>No floor plan available</h3></div>';

    var pins = data.boothPins || {};
    var booths = data.booths || {};
    var h = '<div class="floor-plan-container" id="floorPlanContainer">';
    h += '<img class="floor-plan-img" src="' + esc(data.show.floorPlanUrl) + '" alt="Floor Plan" onload="renderFloorPins()">';
    // Pins rendered after image loads
    h += '</div>';
    return h;
  }

  // Global functions
  window.setTab = function(tab) { activeTab = tab; render(); };

  window.setSearch = function(val) { searchQuery = val; render(); };

  window.toggleCategory = function(cat) {
    var idx = selectedCategories.indexOf(cat);
    if (idx >= 0) selectedCategories.splice(idx, 1);
    else selectedCategories.push(cat);
    render();
  };

  window.togglePin = function(vendorId) {
    var idx = pinnedVendors.indexOf(vendorId);
    if (idx >= 0) pinnedVendors.splice(idx, 1);
    else pinnedVendors.push(vendorId);
    localStorage.setItem('mast-pins-' + slug, JSON.stringify(pinnedVendors));
    render();
  };

  window.toggleCoupon = function(couponId) {
    var idx = savedCoupons.indexOf(couponId);
    if (idx >= 0) savedCoupons.splice(idx, 1);
    else savedCoupons.push(couponId);
    localStorage.setItem('mast-coupons-' + slug, JSON.stringify(savedCoupons));
    render();
  };

  window.openVendor = function(vendorId) {
    selectedVendor = (data.vendors || []).find(function(v) { return v.id === vendorId; }) || null;
    render();
  };

  window.closeVendor = function() { selectedVendor = null; render(); };

  window.renderFloorPins = function() {
    var container = document.getElementById('floorPlanContainer');
    if (!container) return;
    var img = container.querySelector('img');
    if (!img) return;
    // Remove old pins
    container.querySelectorAll('.floor-pin').forEach(function(p) { p.remove(); });
    var pins = data.boothPins || {};
    var booths = data.booths || {};
    Object.keys(pins).forEach(function(boothId) {
      var pin = pins[boothId];
      var booth = booths[boothId];
      if (!pin || !booth) return;
      var el = document.createElement('div');
      el.className = 'floor-pin';
      el.style.left = (pin.x * 100) + '%';
      el.style.top = (pin.y * 100) + '%';
      el.textContent = booth.name || boothId;
      container.appendChild(el);
    });
  };

  // Initialize
  window.TENANT_READY ? window.TENANT_READY.then(init) : init();
})();
