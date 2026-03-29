(function() {
  'use strict';

  var FUNCTIONS_BASE = 'https://us-central1-mast-platform-prod.cloudfunctions.net';
  var app = document.getElementById('app');

  // ── State ──────────────────────────────────────────────────────────
  var slug = '';
  var data = null;
  var activeTab = 'vendors';
  var searchQuery = '';
  var sortBy = 'name';
  var selectedCategories = [];
  var selectedTags = [];
  var pinnedVendors = [];
  var savedCoupons = [];
  var selectedVendor = null;
  var expandedVendorId = null;
  var vendorModalTab = 'about';
  var tagsExpanded = false;
  var headerExpanded = false;
  var findBoothId = null;
  var mapShowPinned = false;
  var huntParticipantId = null;
  var huntStatus = null;
  var huntLoading = false;

  // Map state
  var mapZoom = 1;
  var mapImgLoaded = false;
  var mapImgError = false;
  var mapAnimFrame = null;
  var mapPinchState = { active: false, startDist: 0, startZoom: 1 };
  var MAP_MIN_ZOOM = 1;
  var MAP_MAX_ZOOM = 4;
  var boothSearchQuery = '';
  var boothDropOpen = false;
  var mapTouchHandlers = null;

  // Ad system state
  var sessionAds = [];
  var currentAdIndex = 0;
  var showAdCard = false;
  var showSeeMore = false;
  var seeMoreCooldown = false;
  var servedAdIds = [];
  var adTimer = null;

  // ── Helpers ────────────────────────────────────────────────────────
  function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      var d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return dateStr; }
  }

  // ── Init ───────────────────────────────────────────────────────────
  function init() {
    var path = window.location.pathname;
    var parts = path.split('/').filter(Boolean);
    var showIdx = parts.indexOf('show');
    if (showIdx >= 0 && parts[showIdx + 1] && parts[showIdx + 1] !== 'index.html') {
      slug = decodeURIComponent(parts[showIdx + 1]);
    } else {
      slug = new URLSearchParams(window.location.search).get('slug') || '';
    }

    if (!slug) {
      renderError('No show specified', 'Please check the URL and try again.');
      return;
    }

    try { pinnedVendors = JSON.parse(localStorage.getItem('mast-pins-' + slug) || '[]'); } catch (e) { pinnedVendors = []; }
    try { savedCoupons = JSON.parse(localStorage.getItem('mast-coupons-' + slug) || '[]'); } catch (e) { savedCoupons = []; }
    try { selectedCategories = JSON.parse(localStorage.getItem('mast-filters-' + slug) || '[]'); } catch (e) { selectedCategories = []; }
    huntParticipantId = localStorage.getItem('mast-hunt-' + slug) || null;

    loadShowData();
  }

  // ── Data Loading ───────────────────────────────────────────────────
  function loadShowData() {
    fetch(FUNCTIONS_BASE + '/eventsGetPublicShowData?slug=' + encodeURIComponent(slug))
      .then(function(r) {
        if (!r.ok) throw new Error('Show not found');
        return r.json();
      })
      .then(function(d) {
        data = d;
        document.title = (data.show.name || 'Show') + ' — Event';
        render();
        if (data.huntEnabled && huntParticipantId) loadHuntStatus();
        // Start ad timer after 30s
        if (data.adsEnabled) initAdSystem();
      })
      .catch(function() {
        renderError('Show not found', 'This show may have been removed or the link is incorrect.');
      });
  }

  function loadHuntStatus() {
    if (!data || !data.show) return;
    huntLoading = true;
    var showId = data.show.id;
    var pid = huntParticipantId;
    if (!pid) { huntLoading = false; return; }
    fetch(FUNCTIONS_BASE + '/eventsGetHuntStatus?showId=' + encodeURIComponent(showId) + '&participantId=' + encodeURIComponent(pid))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) { if (d) huntStatus = d; })
      .catch(function() {})
      .finally(function() { huntLoading = false; render(); });
  }

  // ── Ad System ──────────────────────────────────────────────────────
  var AD_EXPIRY_MS = 8 * 60 * 60 * 1000; // 8 hours

  function initAdSystem() {
    var storageKey = 'mast-ads-' + data.show.id;

    // ?resetAds in URL clears state and reloads clean
    if (window.location.search.indexOf('resetAds') >= 0) {
      localStorage.removeItem(storageKey);
      var cleanUrl = window.location.href.replace(/[?&]resetAds=?[^&]*/g, '').replace(/[?&]$/, '');
      window.history.replaceState(null, '', cleanUrl || window.location.pathname);
      console.log('[Ads] State cleared via ?resetAds');
    }

    // Auto-expire after 8 hours so returning attendees get a fresh cycle
    var stored = localStorage.getItem(storageKey);
    if (stored) {
      var age = Date.now() - parseInt(stored, 10);
      if (age > AD_EXPIRY_MS) {
        localStorage.removeItem(storageKey);
        console.log('[Ads] Stored key expired (' + Math.round(age / 3600000) + 'h old), re-running ad cycle');
        stored = null;
      }
    }

    if (stored) {
      console.log('[Ads] Recent session found, showing see-more button directly');
      showSeeMore = true;
      render();
      return;
    }

    adTimer = setTimeout(function() {
      console.log('[Ads] Fetching session ads for show:', data.show.id);
      fetch(FUNCTIONS_BASE + '/eventsServeAds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId: data.show.id, context: 'session' })
      })
        .then(function(r) { return r.json(); })
        .then(function(result) {
          console.log('[Ads] Session fetch result:', result);
          if (result.ads && result.ads.length > 0) {
            sessionAds = result.ads;
            servedAdIds = result.ads.map(function(a) { return a.adId; });
            currentAdIndex = 0;
            showAdCard = true;
            localStorage.setItem(storageKey, Date.now().toString());
          } else {
            console.log('[Ads] No ads returned, showing see-more button');
            showSeeMore = true;
          }
          render();
        })
        .catch(function(err) {
          console.error('[Ads] Session fetch error:', err);
          showSeeMore = true;
          render();
        });
    }, 30000);
  }

  // ── Persistence ────────────────────────────────────────────────────
  function savePins() { localStorage.setItem('mast-pins-' + slug, JSON.stringify(pinnedVendors)); }
  function saveCouponsLS() { localStorage.setItem('mast-coupons-' + slug, JSON.stringify(savedCoupons)); }
  function saveFilters() { localStorage.setItem('mast-filters-' + slug, JSON.stringify(selectedCategories)); }

  // ── Error Page ─────────────────────────────────────────────────────
  function renderError(title, msg) {
    app.innerHTML = '<div class="error-page"><h2>' + esc(title) + '</h2><p>' + esc(msg) + '</p></div>';
  }

  // ── Main Render ────────────────────────────────────────────────────
  function render() {
    if (!data) return;
    cleanupMap();

    var show = data.show;
    var vendors = data.vendors || [];
    var promotions = data.promotions || [];
    var booths = data.booths || {};
    var boothPins = data.boothPins || {};
    var hasFloorPlan = show.floorPlanUrl && Object.keys(boothPins).length > 0;

    // Guard: if active tab requires a feature that isn't available, fall back to vendors
    if (activeTab === 'hunt' && !data.huntEnabled) activeTab = 'vendors';
    if (activeTab === 'map' && !hasFloorPlan) activeTab = 'vendors';

    // Build categories and tags
    var catMap = {};
    var tagMap = {};
    vendors.forEach(function(v) {
      if (v.category && !catMap[v.category]) catMap[v.category] = true;
      (v.tags || []).forEach(function(t) { tagMap[t] = true; });
    });
    var categories = Object.keys(catMap).sort();
    var allTags = Object.keys(tagMap).sort();

    // Filter vendors
    var filtered = vendors.filter(function(v) {
      if (searchQuery) {
        var q = searchQuery.toLowerCase();
        if ((v.businessName || '').toLowerCase().indexOf(q) < 0) return false;
      }
      if (selectedCategories.length > 0 && selectedCategories.indexOf(v.category) < 0) return false;
      if (selectedTags.length > 0) {
        var vTagsLower = (v.tags || []).map(function(t) { return t.toLowerCase(); });
        if (!selectedTags.some(function(t) { return vTagsLower.indexOf(t) >= 0; })) return false;
      }
      return true;
    });

    // Sort vendors
    var sorted = filtered.slice().sort(function(a, b) {
      if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '');
      if (sortBy === 'booth') {
        var ba = a.boothId && booths[a.boothId] ? booths[a.boothId].name || '' : '';
        var bb = b.boothId && booths[b.boothId] ? booths[b.boothId].name || '' : '';
        return ba.localeCompare(bb, undefined, { numeric: true });
      }
      return (a.businessName || '').localeCompare(b.businessName || '');
    });

    var pinned = vendors.filter(function(v) { return pinnedVendors.indexOf(v.id) >= 0; });

    // Bottom nav items — order: Vendors, Map, Pinned, Hunt, Coupons
    var navItems = [
      { id: 'vendors', icon: '🏪', label: 'Vendors', badge: 0, badgeClass: '', dimmed: false },
      { id: 'map',     icon: '🗺️', label: 'Map',     badge: 0, badgeClass: '', dimmed: !hasFloorPlan },
      { id: 'pinned',  icon: '📌', label: 'Pinned',  badge: pinnedVendors.length, badgeClass: 'amber', dimmed: false },
      { id: 'hunt',    icon: '🔍', label: 'Hunt',    badge: 0, badgeClass: '', dimmed: !data.huntEnabled },
      { id: 'coupons', icon: '🎟️', label: 'Coupons', badge: savedCoupons.length, badgeClass: 'amber', dimmed: false }
    ];

    var html = '';

    // ── Header ───────────────────────────────────────────────────
    var hasHeaderDetails = show.description || show.attendeeNotes || (show.externalLinks || []).length > 0;
    html += '<div class="show-header"><div class="show-header-inner">';
    // See more deals button
    if (showSeeMore && data.adsEnabled && !showAdCard) {
      html += '<button class="see-more-deals-btn" onclick="handleSeeMoreDeals()" ' + (seeMoreCooldown ? 'disabled' : '') + ' title="' + (seeMoreCooldown ? 'More deals soon...' : 'See more deals') + '">\ud83c\udfab\ufe0f</button>';
    }
    html += '<h1 class="show-name">' + esc(show.name) + '</h1>';
    html += '<div class="show-meta">';
    if (show.venue) html += '<span>\ud83d\udccd ' + esc(show.venue) + (show.city ? ', ' + esc(show.city) : '') + '</span>';
    if (show.startDate) {
      var dateStr = formatDate(show.startDate);
      if (show.endDate && show.endDate !== show.startDate) dateStr += ' \u2014 ' + formatDate(show.endDate);
      html += '<span>\ud83d\udcc5 ' + esc(dateStr) + '</span>';
    }
    html += '</div>';
    if (hasHeaderDetails) {
      html += '<button class="header-toggle" onclick="toggleHeader()">';
      html += headerExpanded ? 'Hide details' : 'Event info & details';
      html += ' <span class="header-chevron' + (headerExpanded ? ' expanded' : '') + '">\u25be</span>';
      html += '</button>';
    }
    if (headerExpanded) {
      html += '<div class="header-details">';
      if (show.description) html += '<p class="show-desc">' + esc(show.description) + '</p>';
      if (show.attendeeNotes) html += '<div class="show-notes">' + esc(show.attendeeNotes) + '</div>';
      if (show.externalLinks && show.externalLinks.length > 0) {
        html += '<div class="show-links">';
        show.externalLinks.forEach(function(link) {
          if (link.url && /^https?:\/\//i.test(link.url)) {
            html += '<a href="' + esc(link.url) + '" target="_blank" rel="noopener">' + esc(link.label || link.url) + ' \u2197</a>';
          }
        });
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div></div>';

    // ── Bottom Nav ───────────────────────────────────────────────
    html += '<nav class="bottom-nav">';
    navItems.forEach(function(item) {
      var cls = 'bnav-item' + (activeTab === item.id ? ' active' : '') + (item.dimmed ? ' dimmed' : '');
      var clickAttr = item.dimmed ? '' : ' onclick="setTab(\'' + item.id + '\')"';
      html += '<button class="' + cls + '"' + clickAttr + '>';
      html += '<span class="bnav-icon">' + item.icon + '</span>';
      if (item.badge > 0) {
        html += '<span class="bnav-badge' + (item.badgeClass ? ' ' + item.badgeClass : '') + '">' + item.badge + '</span>';
      }
      html += '<span class="bnav-label">' + esc(item.label) + '</span>';
      html += '</button>';
    });
    html += '</nav>';

    // ── Content ──────────────────────────────────────────────────
    html += '<div class="content">';

    if (activeTab === 'vendors') {
      html += renderVendorsTab(sorted, categories, allTags, promotions, booths, hasFloorPlan);
    } else if (activeTab === 'pinned') {
      html += renderPinnedTab(pinned, promotions, booths, hasFloorPlan);
    } else if (activeTab === 'coupons') {
      html += renderSavedCouponsTab(promotions, vendors, booths, hasFloorPlan);
    } else if (activeTab === 'hunt') {
      html += renderHuntTab();
    } else if (activeTab === 'map') {
      html += renderMapTab(show, booths, boothPins, vendors);
    }

    html += '</div>';

    // ── Ad Card Overlay ──────────────────────────────────────────
    if (showAdCard && sessionAds.length > 0 && sessionAds[currentAdIndex]) {
      html += renderAdOverlay(sessionAds[currentAdIndex], vendors, booths, promotions, hasFloorPlan);
    }

    // ── Footer ───────────────────────────────────────────────────
    html += '<div class="show-footer">Powered by Mast &middot; <a href="https://runmast.com/privacy" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">Privacy</a></div>';

    app.innerHTML = html;

    // Post-render setup
    if (activeTab === 'map') {
      setupMap();
    }
    setupClickOutside();
  }

  // ── Vendors Tab ────────────────────────────────────────────────────
  function renderVendorsTab(sorted, categories, allTags, promotions, booths, hasFloorPlan) {
    var h = '';

    // Tags — collapsed by default, expand on tap
    if (allTags.length > 0) {
      var activeTagCount = selectedTags.length;
      h += '<button class="tags-toggle" onclick="toggleTagsExpanded()">';
      h += '<span>Tags (' + allTags.length + ')' + (activeTagCount > 0 ? ' \u2022 ' + activeTagCount + ' active' : '') + '</span>';
      h += '<span class="tags-toggle-chevron' + (tagsExpanded ? ' open' : '') + '">\u203a</span>';
      h += '</button>';
      if (tagsExpanded) {
        h += '<div class="tag-filters">';
        allTags.forEach(function(t) {
          var isActive = selectedTags.indexOf(t) >= 0;
          h += '<button class="tag-chip' + (isActive ? ' active' : '') + '" onclick="toggleTag(\'' + esc(t).replace(/'/g, "\\'") + '\')">' + esc(t) + '</button>';
        });
        h += '</div>';
      }
      if (selectedTags.length > 0) {
        h += '<button class="clear-filters-btn" onclick="clearAllFilters()">Clear tag filters</button>';
      }
    }

    // Search + Sort
    h += '<div class="search-sort-row">';
    h += '<div class="search-wrapper"><span class="search-icon">\ud83d\udd0d</span>';
    h += '<input class="search-input with-icon" type="text" placeholder="Search by vendor name..." value="' + esc(searchQuery) + '" oninput="setSearch(this.value)"></div>';
    h += '<select class="sort-select" value="' + sortBy + '" onchange="setSort(this.value)">';
    h += '<option value="name"' + (sortBy === 'name' ? ' selected' : '') + '>Name</option>';
    h += '<option value="category"' + (sortBy === 'category' ? ' selected' : '') + '>Category</option>';
    h += '<option value="booth"' + (sortBy === 'booth' ? ' selected' : '') + '>Booth</option>';
    h += '</select>';
    h += '</div>';
    h += '<p class="vendor-count">' + sorted.length + ' vendor' + (sorted.length !== 1 ? 's' : '') + '</p>';

    // Vendor list
    if (sorted.length === 0) {
      h += '<div class="empty-state"><h3>No vendors found</h3><p>' + (searchQuery || selectedTags.length > 0 ? 'Try different filters.' : 'Vendors will appear here once confirmed.') + '</p></div>';
    } else {
      h += '<div class="vendor-list">';
      sorted.forEach(function(v) { h += renderVendorRow(v, promotions, booths, hasFloorPlan); });
      h += '</div>';
    }
    return h;
  }

  // ── Pinned Tab ─────────────────────────────────────────────────────
  function renderPinnedTab(pinned, promotions, booths, hasFloorPlan) {
    if (pinned.length === 0) {
      return '<div class="empty-state"><h3>No pinned vendors</h3><p>Tap the 📍 on any vendor to save them here.</p></div>';
    }
    var h = '';
    if (hasFloorPlan) {
      h += '<button class="view-pinned-map-btn" onclick="viewPinnedOnMap()">\ud83d\uddfa\ufe0f View Pinned on Map</button>';
    }
    h += '<div class="vendor-list">';
    pinned.forEach(function(v) { h += renderVendorRow(v, promotions, booths, hasFloorPlan); });
    h += '</div>';
    return h;
  }

  // ── Saved Coupons Tab ──────────────────────────────────────────────
  function renderSavedCouponsTab(promotions, vendors, booths, hasFloorPlan) {
    if (savedCoupons.length === 0) {
      return '<div class="empty-state"><h3>No saved coupons</h3><p>Save coupons from vendor deals to see them here.</p></div>';
    }
    var vendorMap = {};
    vendors.forEach(function(v) { vendorMap[v.id] = v; });

    var h = '<p class="coupons-hint">Show these coupons to vendors at their booth to redeem</p>';
    h += '<div class="saved-coupons-list">';
    savedCoupons.forEach(function(promoId) {
      var promo = promotions.filter(function(p) { return p.id === promoId; })[0];
      if (!promo) return;
      var vendor = vendorMap[promo.vendorId];
      if (!vendor) return;
      var booth = vendor.boothId && booths[vendor.boothId] ? booths[vendor.boothId] : null;
      var dealText = promo.couponType === 'percentage' || promo.couponType === 'Percentage'
        ? promo.couponValue + '% OFF'
        : '$' + (promo.couponValue / 100).toFixed(0) + ' OFF';

      h += '<div class="saved-coupon-card">';
      // Vendor header
      h += '<div class="saved-coupon-header">';
      if (vendor.logoUrl) {
        h += '<img class="saved-coupon-logo" src="' + esc(vendor.logoUrl) + '" alt="" onerror="this.style.display=\'none\'">';
      } else {
        h += '<div class="saved-coupon-logo-placeholder">\ud83c\udfea</div>';
      }
      h += '<div class="saved-coupon-vendor-info">';
      h += '<div class="saved-coupon-vendor-name">' + esc(vendor.businessName) + '</div>';
      if (booth) h += '<div class="saved-coupon-booth">\ud83d\udccd ' + esc(booth.name) + (booth.location ? ' \u2014 ' + esc(booth.location) : '') + '</div>';
      h += '</div></div>';
      // Big coupon display
      h += '<div class="saved-coupon-deal">';
      h += '<div class="saved-coupon-deal-text">' + esc(dealText) + '</div>';
      if (promo.attendeeMessage) h += '<p class="saved-coupon-message">' + esc(promo.attendeeMessage) + '</p>';
      h += '<div class="saved-coupon-code-box">';
      h += '<div class="saved-coupon-code-label">Coupon Code</div>';
      h += '<code class="saved-coupon-code">' + esc(promo.mastCouponCode) + '</code>';
      h += '</div></div>';
      // Actions
      h += '<div class="saved-coupon-actions">';
      if (vendor.boothId && hasFloorPlan) {
        h += '<button class="coupon-find-btn" onclick="findBoothOnMap(\'' + esc(vendor.boothId) + '\')">\ud83d\uddfa\ufe0f Find on Map</button>';
      }
      h += '<button class="coupon-remove-btn" onclick="removeSavedCoupon(\'' + esc(promoId) + '\')">Remove</button>';
      h += '</div></div>';
    });
    h += '</div>';
    return h;
  }

  // ── Hunt Tab ───────────────────────────────────────────────────────
  function renderHuntTab() {
    if (!data.huntConfig && !data.huntEnabled) return '<div class="empty-state"><h3>Scavenger hunt not available</h3></div>';
    var hc = data.huntConfig;

    if (huntLoading) {
      return '<div class="empty-state"><p>Loading hunt progress...</p></div>';
    }

    // Not yet participating
    if (!huntParticipantId || !huntStatus) {
      var h = '<div class="hunt-intro">';
      h += '<div class="hunt-intro-icon">\ud83d\udd0d</div>';
      h += '<h3 class="hunt-intro-title">Scavenger Hunt</h3>';
      if (hc) {
        h += '<p class="hunt-intro-desc">Visit at least <strong>' + hc.target + ' booths</strong>, scan the QR code, and collect a <strong class="hunt-prize-text">' + esc(hc.prize || 'prize') + '</strong>!</p>';
        h += '<div class="hunt-how-it-works">';
        h += '<h4>How it works:</h4>';
        h += '<div class="hunt-step"><span class="hunt-step-num">1</span><span>Visit any ' + hc.target + ' vendor booths at the show</span></div>';
        h += '<div class="hunt-step"><span class="hunt-step-num">2</span><span>Scan the QR code at each booth</span></div>';
        h += '<div class="hunt-step"><span class="hunt-step-num hunt-step-trophy">\ud83c\udfc6</span><span>' + esc(hc.claimInstructions || 'Collect your prize at the ticket booth!') + '</span></div>';
        h += '</div>';
      } else {
        h += '<p class="hunt-intro-desc">Visit vendor booths and scan their QR codes to collect visits!</p>';
        h += '<p class="hunt-intro-sub">Scan a QR code at any vendor booth to get started.</p>';
      }
      h += '</div>';
      return h;
    }

    // Participating
    var hp = huntStatus.participant;
    var target = huntStatus.hunt ? huntStatus.hunt.target : (hc ? hc.target : 0);
    var pct = Math.min(100, Math.round((hp.visitCount / target) * 100));

    // Completed
    if (hp.completed) {
      var h = '<div class="hunt-complete">';
      h += '<div class="hunt-complete-icon">\ud83c\udf89</div>';
      h += '<h3 class="hunt-complete-title">Hunt Complete!</h3>';
      if (hp.completionCode) {
        h += '<div class="hunt-completion-code-box">';
        h += '<div class="hunt-code-label">Your Code</div>';
        h += '<div class="hunt-code">' + esc(hp.completionCode) + '</div>';
        h += '</div>';
      }
      if (huntStatus.hunt && huntStatus.hunt.claimInstructions) {
        h += '<p class="hunt-claim">' + esc(huntStatus.hunt.claimInstructions) + '</p>';
      }
      h += '</div>';
      return h;
    }

    // In progress
    var h = '<div class="hunt-progress-section">';
    h += '<div class="hunt-progress-bar-container">';
    h += '<div class="hunt-progress-bar"><div class="hunt-progress-fill" style="width:' + pct + '%"></div></div>';
    h += '<div class="hunt-progress-text">' + hp.visitCount + ' of ' + target + ' vendors visited</div>';
    if (huntStatus.hunt && huntStatus.hunt.prize) {
      h += '<div class="hunt-prize-badge">\ud83c\udfc6 Prize: ' + esc(huntStatus.hunt.prize) + '</div>';
    }
    h += '</div>';

    // Vendor checklist
    if (huntStatus.vendors && huntStatus.vendors.length > 0) {
      h += '<div class="hunt-vendor-list">';
      h += '<div class="hunt-vendor-list-title">Your Vendor List</div>';
      huntStatus.vendors.forEach(function(v) {
        h += '<div class="hunt-vendor-item' + (v.visited ? ' visited' : '') + '">';
        h += '<div class="hunt-vendor-check">' + (v.visited ? '\u2713' : '\u25cb') + '</div>';
        h += '<div class="hunt-vendor-info">';
        h += '<div class="hunt-vendor-name">' + esc(v.businessName) + '</div>';
        if (v.boothName) h += '<div class="hunt-vendor-booth">Booth ' + esc(v.boothName) + '</div>';
        h += '</div></div>';
      });
      h += '</div>';
    } else {
      h += '<div class="hunt-any-mode-hint">';
      h += 'Visit ' + (target - hp.visitCount) + ' more vendor' + (target - hp.visitCount !== 1 ? 's' : '') + ' to complete the hunt!<br>Scan QR codes at vendor booths to register visits.';
      h += '</div>';
    }

    h += '<div class="hunt-scan-hint">Scan QR codes at vendor booths to register visits!</div>';
    h += '</div>';
    return h;
  }

  // ── Map Tab ────────────────────────────────────────────────────────
  function renderMapTab(show, booths, boothPins, vendors) {
    if (!show.floorPlanUrl) return '<div class="empty-state"><h3>No floor plan available</h3></div>';

    var h = '';

    // Booth search dropdown
    h += '<div class="map-controls">';
    h += '<div class="booth-search-wrapper" id="boothSearchWrapper">';
    var selectedLabel = '';
    if (findBoothId) {
      var booth = booths[findBoothId];
      if (booth) {
        var v = vendors.filter(function(v) { return v.boothId === findBoothId; })[0];
        selectedLabel = booth.name + (v ? ' \u2014 ' + v.businessName : '');
      }
    }
    h += '<div class="booth-search-input-wrapper">';
    h += '<span class="search-icon">\ud83d\udd0d</span>';
    h += '<input type="text" class="booth-search-input" id="boothSearchInput" placeholder="' + (findBoothId ? esc(selectedLabel) : 'Search booth or vendor...') + '" value="' + esc(boothSearchQuery) + '" autocomplete="off" onfocus="openBoothDrop()" oninput="setBoothSearch(this.value)">';
    h += '</div>';
    if (boothDropOpen) {
      var options = getBoothOptions(booths, boothPins, vendors);
      var filteredOpts = options;
      if (boothSearchQuery.trim()) {
        var q = boothSearchQuery.toLowerCase();
        filteredOpts = options.filter(function(o) { return o.label.toLowerCase().indexOf(q) >= 0; });
      }
      if (filteredOpts.length > 0) {
        h += '<div class="booth-dropdown" id="boothDropdown">';
        filteredOpts.forEach(function(o) {
          h += '<button class="booth-dropdown-item' + (o.id === findBoothId ? ' active' : '') + '" onclick="selectBooth(\'' + esc(o.id) + '\')">' + esc(o.label) + '</button>';
        });
        h += '</div>';
      } else if (boothSearchQuery) {
        h += '<div class="booth-dropdown" id="boothDropdown"><div class="booth-dropdown-empty">No matches</div></div>';
      }
    }
    h += '</div>';
    if (findBoothId) {
      h += '<button class="map-clear-btn" onclick="clearBoothFind()">Clear</button>';
    }
    h += '</div>';

    // Pinned mode banner
    if (mapShowPinned && pinnedVendors.length > 0 && !findBoothId) {
      h += '<div class="map-pinned-banner">';
      h += '<span>\ud83d\udccc Showing ' + pinnedVendors.length + ' pinned vendor' + (pinnedVendors.length !== 1 ? 's' : '') + '</span>';
      h += '<button onclick="clearMapPinned()">Show All</button>';
      h += '</div>';
    }

    // Zoom controls
    h += '<div class="map-zoom-controls">';
    h += '<div class="zoom-buttons">';
    h += '<button onclick="mapZoomChange(-0.5)"' + (mapZoom <= MAP_MIN_ZOOM ? ' disabled' : '') + '>\u2212</button>';
    h += '<span class="zoom-level">' + Math.round(mapZoom * 100) + '%</span>';
    h += '<button onclick="mapZoomChange(0.5)"' + (mapZoom >= MAP_MAX_ZOOM ? ' disabled' : '') + '>+</button>';
    h += '</div>';
    if (mapZoom > 1) h += '<button class="zoom-reset-btn" onclick="mapZoomReset()">Reset</button>';
    h += '<span class="zoom-hint">Pinch to zoom</span>';
    h += '</div>';

    // Canvas container
    h += '<div class="map-canvas-container" id="mapContainer">';
    h += '<img id="mapImg" src="' + esc(show.floorPlanUrl) + '" alt="Floor plan" style="display:none">';
    h += '<div class="map-scroll" id="mapScroll">';
    h += '<canvas id="mapCanvas"></canvas>';
    h += '</div>';
    if (!mapImgLoaded && !mapImgError) h += '<div class="map-loading"><div class="spinner"></div></div>';
    if (mapImgError) h += '<div class="map-error">Unable to load floor plan</div>';
    h += '</div>';

    return h;
  }

  // ── Vendor Row (compact list) ──────────────────────────────────────
  function renderVendorRow(v, promotions, booths, hasFloorPlan) {
    var isPinned = pinnedVendors.indexOf(v.id) >= 0;
    var vendorPromos = promotions.filter(function(p) { return p.vendorId === v.id; });
    var booth = v.boothId && booths[v.boothId] ? booths[v.boothId] : null;
    var isExpanded = expandedVendorId === v.id;

    var h = '<div class="vrow-wrap' + (isExpanded ? ' expanded' : '') + '">';
    h += '<button class="vrow" onclick="setExpandedVendor(\'' + esc(v.id) + '\')">';
    // Logo / initial
    if (v.logoUrl) {
      h += '<img class="vrow-logo" src="' + esc(v.logoUrl) + '" alt="" onerror="this.style.display=\'none\'">';
    } else {
      h += '<div class="vrow-logo-placeholder">' + esc((v.businessName || '?').charAt(0).toUpperCase()) + '</div>';
    }
    // Info
    h += '<div class="vrow-info">';
    h += '<div class="vrow-name">' + esc(v.businessName) + '</div>';
    h += '<div class="vrow-meta">';
    if (v.category) h += '<span class="vendor-category-badge">' + esc(v.category) + '</span>';
    if (booth) h += '<span class="vrow-booth">\ud83d\udccd ' + esc(booth.name) + '</span>';
    if (vendorPromos.length > 0) h += '<span class="vrow-deal-tag">\ud83c\udff7\ufe0f Deal</span>';
    h += '</div></div>';
    // Right: pin + chevron
    h += '<div class="vrow-right">';
    h += '<button class="vrow-pin' + (isPinned ? ' pinned' : '') + '" onclick="event.stopPropagation();togglePin(\'' + esc(v.id) + '\')" title="' + (isPinned ? 'Unpin' : 'Pin') + '">' + (isPinned ? '\ud83d\udccc' : '\ud83d\udccd') + '</button>';
    h += '<span class="vrow-chevron' + (isExpanded ? ' open' : '') + '">\u203a</span>';
    h += '</div>';
    h += '</button>';
    // Inline expanded panel
    if (isExpanded) h += renderVendorExpand(v, vendorPromos, booth, hasFloorPlan);
    h += '</div>';
    return h;
  }

  // ── Vendor Expand Panel (inline accordion) ─────────────────────────
  function renderVendorExpand(v, vendorPromos, booth, hasFloorPlan) {
    var h = '<div class="vrow-expand">';
    if (v.logoUrl) h += '<img class="vexpand-img" src="' + esc(v.logoUrl) + '" alt="" onerror="this.style.display=\'none\'">';
    // Bio
    var bio = v.bio || v.businessDescription;
    if (bio) h += '<p class="vexpand-bio">' + esc(bio) + '</p>';
    // Tags
    if ((v.tags || []).length > 0) {
      h += '<div class="vexpand-tags">';
      v.tags.forEach(function(t) { h += '<span class="vendor-tag">' + esc(t) + '</span>'; });
      h += '</div>';
    }
    // Links
    if (v.websiteUrl) h += '<a class="modal-link" href="' + esc(v.websiteUrl) + '" target="_blank" rel="noopener"><span>\ud83c\udf10</span><span>' + esc(v.websiteUrl.replace(/^https?:\/\//, '')) + '</span></a>';
    if (v.instagramHandle) h += '<a class="modal-link" href="https://instagram.com/' + esc(v.instagramHandle.replace('@', '')) + '" target="_blank" rel="noopener"><span>\ud83d\udcf7</span><span>' + esc(v.instagramHandle) + '</span></a>';
    if (v.mastStatus === 'paid' && v.mastTenantId) h += '<a class="modal-shop-btn" href="https://mast-' + esc(v.mastTenantId) + '.web.app" target="_blank" rel="noopener">Visit Shop \u2192</a>';
    // Deals
    if (vendorPromos.length > 0) {
      h += '<div class="vexpand-deals">';
      vendorPromos.forEach(function(p) {
        var isSaved = savedCoupons.indexOf(p.id) >= 0;
        var dealText = (p.couponType === 'Fixed Amount' || p.couponType === 'fixed')
          ? 'Save $' + (p.couponValue / 100).toFixed(2) + ' with code'
          : 'Save ' + p.couponValue + '% with code';
        h += '<div class="modal-deal-card">';
        h += '<p class="modal-deal-text">' + esc(dealText) + '</p>';
        h += '<div class="modal-deal-code-row">';
        h += '<code class="modal-deal-code">' + esc(p.mastCouponCode) + '</code>';
        h += '<button class="modal-copy-btn" onclick="copyText(\'' + esc(p.mastCouponCode) + '\')">Copy</button>';
        h += '</div>';
        if (p.attendeeMessage) h += '<p class="modal-deal-message">' + esc(p.attendeeMessage) + '</p>';
        h += '<button class="coupon-save-btn' + (isSaved ? ' saved' : '') + '" onclick="' + (isSaved ? 'removeSavedCoupon' : 'saveCoupon') + '(\'' + esc(p.id) + '\')">' + (isSaved ? '\u2713 Saved \u2014 View in Coupons' : 'Save Coupon') + '</button>';
        h += '</div>';
      });
      h += '</div>';
    }
    // Find on map
    if (hasFloorPlan && v.boothId) h += '<button class="modal-find-map-btn" onclick="findBoothFromModal(\'' + esc(v.boothId) + '\')">\ud83d\uddfa\ufe0f Find Booth on Map</button>';
    h += '</div>';
    return h;
  }

  // ── Vendor Detail Modal ────────────────────────────────────────────
  function renderVendorModal(v, promotions, booths, hasFloorPlan) {
    var vendorPromos = promotions.filter(function(p) { return p.vendorId === v.id; });
    var booth = v.boothId && booths[v.boothId] ? booths[v.boothId] : null;
    var isPinned = pinnedVendors.indexOf(v.id) >= 0;
    var shopUrl = v.mastTenantId ? 'https://mast-' + v.mastTenantId + '.web.app' : null;
    var showShop = v.mastStatus === 'paid' && shopUrl;

    // Determine available tabs
    var modalTabs = [{ key: 'about', label: 'About' }];
    if (vendorPromos.length > 0) modalTabs.push({ key: 'deals', label: 'Deals' });
    if (showShop) modalTabs.push({ key: 'shop', label: 'Shop' });

    // Ensure current tab is valid
    if (vendorModalTab !== 'about' && !modalTabs.some(function(t) { return t.key === vendorModalTab; })) {
      vendorModalTab = 'about';
    }

    var h = '<div class="modal-overlay" onclick="closeVendor()">';
    h += '<div class="modal-box" onclick="event.stopPropagation()">';

    // Drag handle (mobile)
    h += '<div class="modal-drag-handle"><div class="modal-drag-bar"></div></div>';

    // Sticky header
    h += '<div class="modal-sticky-header">';
    h += '<h2 class="modal-vendor-name">' + esc(v.businessName) + '</h2>';
    h += '<div class="modal-header-actions">';
    h += '<button class="modal-pin-btn' + (isPinned ? ' pinned' : '') + '" onclick="togglePin(\'' + esc(v.id) + '\')">' + (isPinned ? '\ud83d\udccc' : '\ud83d\udccd') + '</button>';
    h += '<button class="modal-close" onclick="closeVendor()">\u00d7</button>';
    h += '</div></div>';

    // Tabs (if more than 1)
    if (modalTabs.length > 1) {
      h += '<div class="modal-tabs">';
      modalTabs.forEach(function(t) {
        h += '<button class="modal-tab-btn' + (vendorModalTab === t.key ? ' active' : '') + '" onclick="setVendorModalTab(\'' + t.key + '\')">' + esc(t.label) + '</button>';
      });
      h += '</div>';
    }

    h += '<div class="modal-content">';

    if (vendorModalTab === 'about') {
      // Logo/image
      if (v.logoUrl) h += '<img class="modal-vendor-image" src="' + esc(v.logoUrl) + '" alt="" onerror="this.style.display=\'none\'">';
      // Medium
      if (v.medium) h += '<p class="modal-vendor-medium">' + esc(v.medium) + '</p>';
      // Category + booth
      h += '<div class="modal-vendor-meta">';
      if (v.category) h += '<span class="vendor-category-badge">' + esc(v.category) + '</span>';
      if (v.location) h += '<span class="modal-vendor-location">\ud83d\udccd ' + esc(v.location) + '</span>';
      if (booth) h += '<span class="modal-vendor-booth">\ud83c\udff7\ufe0f ' + esc(booth.name) + (booth.location ? ' \u2014 ' + esc(booth.location) : '') + '</span>';
      h += '</div>';
      // Bio
      if (v.bio) h += '<p class="modal-vendor-bio">' + esc(v.bio) + '</p>';
      else if (v.businessDescription) h += '<p class="modal-vendor-bio">' + esc(v.businessDescription) + '</p>';
      // Tags
      if ((v.tags || []).length > 0) {
        h += '<div class="modal-vendor-tags">';
        v.tags.forEach(function(t) { h += '<span class="vendor-tag">' + esc(t) + '</span>'; });
        h += '</div>';
      }
      // Links
      if (v.websiteUrl) {
        h += '<a class="modal-link" href="' + esc(v.websiteUrl) + '" target="_blank" rel="noopener"><span>\ud83c\udf10</span> <span>' + esc(v.websiteUrl.replace(/^https?:\/\//, '')) + '</span></a>';
      }
      if (v.instagramHandle) {
        h += '<a class="modal-link" href="https://instagram.com/' + esc(v.instagramHandle.replace('@', '')) + '" target="_blank" rel="noopener"><span>\ud83d\udcf7</span> <span>' + esc(v.instagramHandle) + '</span></a>';
      }
      // Find on map
      if (hasFloorPlan && v.boothId) {
        h += '<button class="modal-find-map-btn" onclick="findBoothFromModal(\'' + esc(v.boothId) + '\')">\ud83d\uddfa\ufe0f Find Booth on Map</button>';
      }
    }

    if (vendorModalTab === 'deals' && vendorPromos.length > 0) {
      h += '<div class="modal-deals-list">';
      vendorPromos.forEach(function(p) {
        var dealText = p.couponType === 'Fixed Amount' || p.couponType === 'fixed'
          ? 'Save $' + (p.couponValue / 100).toFixed(2) + ' with code'
          : 'Save ' + p.couponValue + '% with code';
        h += '<div class="modal-deal-card">';
        h += '<p class="modal-deal-text">' + esc(dealText) + '</p>';
        h += '<div class="modal-deal-code-row">';
        h += '<code class="modal-deal-code">' + esc(p.mastCouponCode) + '</code>';
        h += '<button class="modal-copy-btn" onclick="copyText(\'' + esc(p.mastCouponCode) + '\')">Copy</button>';
        h += '</div>';
        if (p.attendeeMessage) h += '<p class="modal-deal-message">' + esc(p.attendeeMessage) + '</p>';
        h += '</div>';
      });
      h += '</div>';
    }

    if (vendorModalTab === 'shop' && showShop) {
      h += '<p class="modal-shop-text">Visit this vendor\'s online shop:</p>';
      h += '<a class="modal-shop-btn" href="' + esc(shopUrl) + '" target="_blank" rel="noopener">Visit Shop \u2192</a>';
    }

    h += '</div></div></div>';
    return h;
  }

  // ── Ad Overlay ─────────────────────────────────────────────────────
  function renderAdOverlay(ad, vendors, booths, promotions, hasFloorPlan) {
    var adVendor = vendors.filter(function(v) { return v.id === ad.vendorId; })[0];
    var adBooth = ad.boothId && booths[ad.boothId] ? booths[ad.boothId] : null;

    var h = '<div class="ad-overlay" onclick="dismissAd()">';
    h += '<div class="ad-backdrop"></div>';
    h += '<div class="ad-card" onclick="event.stopPropagation()">';
    h += '<button class="ad-close-btn" onclick="dismissAd()">\u00d7</button>';
    h += '<div class="ad-sponsored">Sponsored</div>';
    h += '<div class="ad-body">';

    // Vendor info
    h += '<div class="ad-vendor-info">';
    if (adVendor && adVendor.logoUrl) {
      h += '<img class="ad-vendor-logo" src="' + esc(adVendor.logoUrl) + '" alt="">';
    } else {
      h += '<div class="ad-vendor-logo-placeholder">\ud83c\udfea</div>';
    }
    h += '<div>';
    h += '<div class="ad-vendor-name">' + esc(ad.vendorName || (adVendor ? adVendor.businessName : 'Vendor')) + '</div>';
    h += '<div class="ad-vendor-detail">';
    if (adVendor && adVendor.category) h += esc(adVendor.category);
    if (adBooth) h += (adVendor && adVendor.category ? ' \u00b7 ' : '') + '\ud83d\udccd ' + esc(adBooth.name) + (adBooth.location ? ' \u2014 ' + esc(adBooth.location) : '');
    h += '</div></div></div>';

    // Ad image
    if (ad.imageUrl) {
      h += '<img class="ad-image" src="' + esc(ad.imageUrl) + '" alt="">';
    }

    // Headline
    if (ad.headline) h += '<h3 class="ad-headline">' + esc(ad.headline) + '</h3>';

    // Promotion
    if (ad.promotion) {
      h += '<div class="ad-promo-box">';
      var saveText = ad.promotion.couponType === 'Fixed Amount'
        ? 'Save $' + (ad.promotion.couponValue / 100).toFixed(2)
        : 'Save ' + ad.promotion.couponValue + '%';
      h += '<p class="ad-promo-save">' + esc(saveText) + '</p>';
      h += '<div class="ad-promo-code-row">';
      h += '<code class="ad-promo-code">' + esc(ad.promotion.mastCouponCode) + '</code>';
      h += '<button class="ad-copy-btn" onclick="copyText(\'' + esc(ad.promotion.mastCouponCode) + '\')">Copy</button>';
      h += '</div>';
      if (ad.promotion.attendeeMessage) h += '<p class="ad-promo-message">' + esc(ad.promotion.attendeeMessage) + '</p>';
      h += '</div>';

      // Save coupon button
      var matchedPromo = promotions.filter(function(p) { return p.vendorId === ad.vendorId && p.mastCouponCode === ad.promotion.mastCouponCode; })[0];
      if (matchedPromo) {
        if (savedCoupons.indexOf(matchedPromo.id) >= 0) {
          h += '<button class="ad-saved-coupon-btn" onclick="showAdCard=false;showSeeMore=true;setTab(\'coupons\')">\u2713 Saved \u2014 View in My Coupons</button>';
        } else {
          h += '<button class="ad-save-coupon-btn" onclick="saveCouponFromAd(\'' + esc(matchedPromo.id) + '\')">\ud83c\udfab\ufe0f Save Coupon</button>';
        }
      }
    }

    // Actions
    h += '<div class="ad-actions">';
    if (ad.boothId && hasFloorPlan) {
      h += '<button class="ad-pin-btn" onclick="pinBoothFromAd(\'' + esc(ad.boothId) + '\')">\ud83d\udccc Pin Booth</button>';
    }
    h += '<button class="ad-next-btn" onclick="dismissAd()">' + (currentAdIndex < sessionAds.length - 1 ? 'Next \u2192' : 'Close') + '</button>';
    h += '</div>';

    // Dot indicators
    if (sessionAds.length > 1) {
      h += '<div class="ad-dots">';
      for (var i = 0; i < sessionAds.length; i++) {
        h += '<div class="ad-dot' + (i === currentAdIndex ? ' active' : '') + '"></div>';
      }
      h += '</div>';
    }

    h += '</div></div></div>';
    return h;
  }

  // ── Canvas Map Drawing ─────────────────────────────────────────────
  function getBoothOptions(booths, boothPins, vendors) {
    var options = [];
    Object.keys(booths).forEach(function(id) {
      if (!boothPins[id]) return;
      var b = booths[id];
      var vendor = vendors.filter(function(v) { return v.boothId === id; })[0];
      options.push({
        id: id,
        label: b.name + (vendor ? ' \u2014 ' + vendor.businessName : ''),
        boothName: b.name,
        vendorName: vendor ? vendor.businessName : ''
      });
    });
    options.sort(function(a, b) {
      var numA = parseInt(a.boothName) || 0;
      var numB = parseInt(b.boothName) || 0;
      return numA - numB || a.boothName.localeCompare(b.boothName);
    });
    return options;
  }

  function drawCanvas(pulsePhase, zoomLevel) {
    var canvas = document.getElementById('mapCanvas');
    var img = document.getElementById('mapImg');
    var container = document.getElementById('mapContainer');
    if (!canvas || !img || !mapImgLoaded) return;

    var z = zoomLevel || mapZoom;
    var containerW = container ? container.clientWidth - 16 : 800; // subtract padding
    var baseScale = Math.min(containerW / img.naturalWidth, 1);
    var w = Math.round(img.naturalWidth * baseScale * z);
    var h = Math.round(img.naturalHeight * baseScale * z);

    canvas.width = w;
    canvas.height = h;
    canvas.style.display = 'block';

    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    if (!data) return;
    var boothPins = data.boothPins || {};
    var booths = data.booths || {};
    var vendors = data.vendors || [];

    var showLabels = z >= 1.8;
    var pinR = z >= 2.5 ? 14 : z >= 1.8 ? 10 : z >= 1.3 ? 8 : 6;

    // Determine which pinned booth IDs to highlight
    var pinnedBoothIds = [];
    if (mapShowPinned) {
      pinnedVendors.forEach(function(vid) {
        var v = vendors.filter(function(x) { return x.id === vid; })[0];
        if (v && v.boothId) pinnedBoothIds.push(v.boothId);
      });
    }

    Object.keys(boothPins).forEach(function(boothId) {
      var pin = boothPins[boothId];
      var booth = booths[boothId];
      if (!pin || !booth) return;

      var x = pin.x * w;
      var y = pin.y * h;
      var isTarget = boothId === findBoothId;
      var isPinnedBooth = pinnedBoothIds.indexOf(boothId) >= 0;

      // Visibility rules: only show relevant pins
      if (findBoothId && !isTarget) return;
      if (!findBoothId && pinnedBoothIds.length > 0 && !isPinnedBooth) return;
      if (!findBoothId && pinnedBoothIds.length === 0) return;

      if (isTarget) {
        // Large prominent pin with pulse
        var tR = Math.max(16, pinR * 2);
        ctx.beginPath();
        ctx.arc(x, y, tR, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Animated pulsing rings
        var p1 = (pulsePhase || 0) % 1;
        var ring1R = tR + 6 + p1 * 35;
        var ring1A = 1 - p1;
        ctx.beginPath();
        ctx.arc(x, y, ring1R, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245, 158, 11, ' + (ring1A * 0.8) + ')';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, ring1R, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245, 158, 11, ' + (ring1A * 0.15) + ')';
        ctx.fill();

        var p2 = ((pulsePhase || 0) + 0.5) % 1;
        var ring2R = tR + 6 + p2 * 35;
        var ring2A = 1 - p2;
        ctx.beginPath();
        ctx.arc(x, y, ring2R, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245, 158, 11, ' + (ring2A * 0.6) + ')';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Label
        var vendor = vendors.filter(function(vv) { return vv.boothId === boothId; })[0];
        var label = vendor ? booth.name + ' \u2014 ' + vendor.businessName : booth.name;
        ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var labelW = ctx.measureText(label).width + 16;
        var labelH = 22;
        var labelY = y - tR - 20;
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - labelW / 2, labelY - labelH / 2, labelW, labelH, 4);
        else { ctx.rect(x - labelW / 2, labelY - labelH / 2, labelW, labelH); }
        ctx.fill();
        ctx.fillStyle = '#f59e0b';
        ctx.fillText(label, x, labelY);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px system-ui';
        ctx.fillText(booth.name, x, y);
      } else if (isPinnedBooth) {
        // Pinned vendor pin
        var pR = Math.max(12, pinR * 1.4);
        ctx.beginPath();
        ctx.arc(x, y, pR, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        var vendor = vendors.filter(function(vv) { return vv.boothId === boothId; })[0];
        var label = vendor ? vendor.businessName : booth.name;
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var labelW = ctx.measureText(label).width + 12;
        var labelH = 20;
        var labelY = y - pR - 14;
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - labelW / 2, labelY - labelH / 2, labelW, labelH, 4);
        else { ctx.rect(x - labelW / 2, labelY - labelH / 2, labelW, labelH); }
        ctx.fill();
        ctx.fillStyle = '#f59e0b';
        ctx.fillText(label, x, labelY);

        var num = booth.name.replace('Booth ', '');
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px system-ui';
        ctx.fillText(num, x, y);
      } else {
        // Regular pin
        ctx.beginPath();
        ctx.arc(x, y, pinR, 0, Math.PI * 2);
        ctx.fillStyle = z >= 1.3 ? '#6366f1' : 'rgba(99, 102, 241, 0.5)';
        ctx.fill();
        if (z >= 1.3) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }

        if (showLabels) {
          var num = booth.name.replace('Booth ', '');
          ctx.fillStyle = '#fff';
          ctx.font = 'bold ' + (z >= 2.5 ? '9' : '7') + 'px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(num, x, y);
        }
      }
    });
  }

  function scrollToBooth(boothId, zoomLevel) {
    if (!data) return;
    var pin = (data.boothPins || {})[boothId];
    var scroll = document.getElementById('mapScroll');
    var img = document.getElementById('mapImg');
    var container = document.getElementById('mapContainer');
    if (!pin || !scroll || !img || !container) return;

    var containerW = container.clientWidth - 16;
    var baseScale = Math.min(containerW / img.naturalWidth, 1);
    var z = zoomLevel || mapZoom;
    var w = img.naturalWidth * baseScale * z;
    var h = img.naturalHeight * baseScale * z;
    var x = pin.x * w;
    var y = pin.y * h;
    scroll.scrollTo({ left: x - scroll.clientWidth / 2, top: y - scroll.clientHeight / 2, behavior: 'smooth' });
  }

  function startPulseAnimation() {
    stopPulseAnimation();
    var start = null;
    var targetZoom = 2.5;
    function animate(ts) {
      if (!start) start = ts;
      var elapsed = (ts - start) / 1000;
      drawCanvas((elapsed * 1.2) % 1, targetZoom);
      mapAnimFrame = requestAnimationFrame(animate);
    }
    mapAnimFrame = requestAnimationFrame(animate);
  }

  function stopPulseAnimation() {
    if (mapAnimFrame) {
      cancelAnimationFrame(mapAnimFrame);
      mapAnimFrame = null;
    }
  }

  function setupMap() {
    var img = document.getElementById('mapImg');
    if (!img) return;

    // Reset state for fresh render
    var wasLoaded = mapImgLoaded;

    img.onload = function() {
      mapImgLoaded = true;
      var loadingEl = document.querySelector('.map-loading');
      if (loadingEl) loadingEl.remove();
      if (findBoothId) {
        mapZoom = 2.5;
        drawCanvas(0, 2.5);
        setTimeout(function() { scrollToBooth(findBoothId, 2.5); }, 50);
        startPulseAnimation();
      } else {
        drawCanvas(0);
      }
    };
    img.onerror = function() {
      mapImgError = true;
      var loadingEl = document.querySelector('.map-loading');
      if (loadingEl) loadingEl.innerHTML = '<div class="map-error">Unable to load floor plan</div>';
    };

    // If image was already loaded (cached), draw immediately
    if (img.complete && img.naturalWidth > 0) {
      mapImgLoaded = true;
      var loadingEl = document.querySelector('.map-loading');
      if (loadingEl) loadingEl.remove();
      if (findBoothId) {
        mapZoom = 2.5;
        drawCanvas(0, 2.5);
        setTimeout(function() { scrollToBooth(findBoothId, 2.5); }, 50);
        startPulseAnimation();
      } else {
        drawCanvas(0);
      }
    }

    // Pinch-to-zoom
    setupPinchZoom();
  }

  function setupPinchZoom() {
    var el = document.getElementById('mapScroll');
    if (!el) return;

    function getTouchDist(touches) {
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e) {
      if (e.touches.length === 2) {
        mapPinchState = { active: true, startDist: getTouchDist(e.touches), startZoom: mapZoom };
      }
    }
    function onTouchMove(e) {
      if (mapPinchState.active && e.touches.length === 2) {
        e.preventDefault();
        var dist = getTouchDist(e.touches);
        var scale = dist / mapPinchState.startDist;
        var newZoom = Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, mapPinchState.startZoom * scale));
        mapZoom = newZoom;
        drawCanvas(0, newZoom);
      }
    }
    function onTouchEnd() { mapPinchState.active = false; }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    mapTouchHandlers = { el: el, start: onTouchStart, move: onTouchMove, end: onTouchEnd };
  }

  function cleanupMap() {
    stopPulseAnimation();
    if (mapTouchHandlers) {
      var h = mapTouchHandlers;
      h.el.removeEventListener('touchstart', h.start);
      h.el.removeEventListener('touchmove', h.move);
      h.el.removeEventListener('touchend', h.end);
      mapTouchHandlers = null;
    }
  }

  // ── Click Outside (booth dropdown) ─────────────────────────────────
  var clickOutsideHandler = null;
  function setupClickOutside() {
    if (clickOutsideHandler) document.removeEventListener('mousedown', clickOutsideHandler);
    clickOutsideHandler = function(e) {
      var wrapper = document.getElementById('boothSearchWrapper');
      if (wrapper && !wrapper.contains(e.target) && boothDropOpen) {
        boothDropOpen = false;
        render();
      }
    };
    document.addEventListener('mousedown', clickOutsideHandler);
  }

  // ── Global Event Handlers ──────────────────────────────────────────
  window.setTab = function(tab) {
    if (tab !== 'map') mapShowPinned = false;
    activeTab = tab;
    expandedVendorId = null;
    vendorModalTab = 'about';
    boothSearchQuery = '';
    boothDropOpen = false;
    if (tab !== 'map') {
      findBoothId = null;
      mapZoom = 1;
    }
    render();
  };

  window.setSearch = function(val) {
    searchQuery = val;
    render();
    var inp = document.querySelector('.search-input');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  };

  window.setSort = function(val) { sortBy = val; render(); };

  window.toggleCategory = function(cat) {
    var idx = selectedCategories.indexOf(cat);
    if (idx >= 0) selectedCategories.splice(idx, 1);
    else selectedCategories.push(cat);
    saveFilters();
    render();
  };

  window.toggleTag = function(tag) {
    var idx = selectedTags.indexOf(tag);
    if (idx >= 0) selectedTags.splice(idx, 1);
    else selectedTags.push(tag);
    render();
  };

  window.clearAllFilters = function() {
    selectedCategories = [];
    selectedTags = [];
    saveFilters();
    render();
  };

  window.togglePin = function(vendorId) {
    var idx = pinnedVendors.indexOf(vendorId);
    if (idx >= 0) pinnedVendors.splice(idx, 1);
    else pinnedVendors.push(vendorId);
    savePins();
    render();
  };

  window.toggleCoupon = function(couponId) {
    var idx = savedCoupons.indexOf(couponId);
    if (idx >= 0) savedCoupons.splice(idx, 1);
    else savedCoupons.push(couponId);
    saveCouponsLS();
    render();
  };

  window.removeSavedCoupon = function(promoId) {
    var idx = savedCoupons.indexOf(promoId);
    if (idx >= 0) savedCoupons.splice(idx, 1);
    saveCouponsLS();
    render();
  };

  window.saveCoupon = function(promoId) {
    if (savedCoupons.indexOf(promoId) < 0) {
      savedCoupons.push(promoId);
      saveCouponsLS();
    }
    render();
  };

  window.saveCouponFromAd = function(promoId) {
    if (savedCoupons.indexOf(promoId) < 0) {
      savedCoupons.push(promoId);
      saveCouponsLS();
    }
    render();
  };

  window.openVendor = function(vendorId) {
    expandedVendorId = expandedVendorId === vendorId ? null : vendorId;
    render();
  };

  window.setExpandedVendor = function(vendorId) {
    expandedVendorId = expandedVendorId === vendorId ? null : vendorId;
    render();
  };

  window.closeVendor = function() {
    expandedVendorId = null;
    selectedVendor = null;
    render();
  };

  window.toggleTagsExpanded = function() {
    tagsExpanded = !tagsExpanded;
    render();
  };

  window.setVendorModalTab = function(tab) {
    vendorModalTab = tab;
    render();
  };

  window.toggleHeader = function() {
    headerExpanded = !headerExpanded;
    render();
  };

  window.copyText = function(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
  };

  // Map handlers
  window.openBoothDrop = function() {
    boothDropOpen = true;
    render();
    // Re-focus input after re-render
    setTimeout(function() {
      var input = document.getElementById('boothSearchInput');
      if (input) input.focus();
    }, 10);
  };

  window.setBoothSearch = function(val) {
    boothSearchQuery = val;
    boothDropOpen = true;
    render();
    setTimeout(function() {
      var input = document.getElementById('boothSearchInput');
      if (input) { input.focus(); input.setSelectionRange(val.length, val.length); }
    }, 10);
  };

  window.selectBooth = function(boothId) {
    findBoothId = boothId;
    boothSearchQuery = '';
    boothDropOpen = false;
    mapZoom = 2.5;
    mapShowPinned = false;
    render();
  };

  window.clearBoothFind = function() {
    findBoothId = null;
    boothSearchQuery = '';
    mapZoom = 1;
    render();
  };

  window.mapZoomChange = function(delta) {
    mapZoom = Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, mapZoom + delta));
    drawCanvas(0, mapZoom);
  };

  window.mapZoomReset = function() {
    mapZoom = 1;
    findBoothId = null;
    render();
  };

  window.clearMapPinned = function() {
    mapShowPinned = false;
    render();
  };

  window.viewPinnedOnMap = function() {
    findBoothId = null;
    mapShowPinned = true;
    activeTab = 'map';
    render();
  };

  window.findBoothOnMap = function(boothId) {
    findBoothId = boothId;
    mapShowPinned = false;
    activeTab = 'map';
    render();
  };

  window.findBoothFromModal = function(boothId) {
    selectedVendor = null;
    expandedVendorId = null;
    findBoothId = boothId;
    mapShowPinned = false;
    activeTab = 'map';
    render();
  };

  // Ad handlers
  window.dismissAd = function() {
    if (currentAdIndex < sessionAds.length - 1) {
      currentAdIndex++;
    } else {
      showAdCard = false;
      showSeeMore = true;
    }
    render();
  };

  window.pinBoothFromAd = function(boothId) {
    findBoothId = boothId;
    activeTab = 'map';
    showAdCard = false;
    showSeeMore = true;
    render();
  };

  window.handleSeeMoreDeals = function() {
    if (seeMoreCooldown || !data) return;
    seeMoreCooldown = true;
    render();
    console.log('[Ads] Fetching see-more ads, excluding:', servedAdIds);
    fetch(FUNCTIONS_BASE + '/eventsServeAds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        showId: data.show.id,
        context: 'see-more',
        excludeAdIds: servedAdIds
      })
    })
      .then(function(r) { return r.json(); })
      .then(function(result) {
        console.log('[Ads] See-more result:', result);
        if (result.ads && result.ads.length > 0) {
          sessionAds = result.ads;
          servedAdIds = servedAdIds.concat(result.ads.map(function(a) { return a.adId; }));
          currentAdIndex = 0;
          showAdCard = true;
          render();
        } else {
          console.log('[Ads] No ads returned from see-more fetch');
        }
      })
      .catch(function(err) { console.error('[Ads] See-more fetch error:', err); });
    // 2-minute cooldown
    setTimeout(function() { seeMoreCooldown = false; render(); }, 120000);
  };

  // Initialize
  window.TENANT_READY ? window.TENANT_READY.then(function() {
    if (window.TENANT_FIREBASE_CONFIG && window.TENANT_FIREBASE_CONFIG.cloudFunctionsBase) {
      FUNCTIONS_BASE = window.TENANT_FIREBASE_CONFIG.cloudFunctionsBase;
    }
    init();
  }) : init();
})();
