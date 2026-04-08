/**
 * Events Organizer Module — Shows, Booths, Vendors, Submissions, Announcements, Hunt, Ads
 * Lazy-loaded via MastAdmin module registry.
 * Converted from standalone events/events.js into admin module.
 */
(function() {
  'use strict';

  // Local alias for core price formatter (formatPriceCents is a global in app/index.html)
  var formatCurrency = typeof formatPriceCents === 'function' ? formatPriceCents : function(c) { return '$' + ((c || 0) / 100).toFixed(2); };

  // ============================================================
  // Module-private DB helpers (uses core MastDB._ref)
  // ============================================================

  var DB = {
    ref: function(path) { return MastDB._ref(path); },
    newKey: function(path) { return MastDB._ref(path).push().key; },
    storagePath: function(sub) { return MastDB.tenantId() + '/' + sub; },

    shows: {
      ref: function(id) { return DB.ref('events/shows' + (id ? '/' + id : '')); },
      list: function(limit) { return this.ref().limitToLast(limit || 200).once('value'); },
      get: function(id) { return this.ref(id).once('value'); },
      set: function(id, data) { return this.ref(id).set(data); },
      update: function(id, data) { return this.ref(id).update(data); },
      remove: function(id) { return this.ref(id).remove(); },
      newKey: function() { return this.ref().push().key; },
      listen: function(limit, cb, errCb) { return this.ref().limitToLast(limit || 200).on('value', cb, errCb); },
      unlisten: function(h) { this.ref().off('value', h); }
    },
    booths: {
      ref: function(showId, boothId) { return DB.ref('events/booths/' + showId + (boothId ? '/' + boothId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 500).once('value'); },
      set: function(showId, boothId, data) { return this.ref(showId, boothId).set(data); },
      update: function(showId, boothId, data) { return this.ref(showId, boothId).update(data); },
      remove: function(showId, boothId) { return this.ref(showId, boothId).remove(); },
      newKey: function(showId) { return this.ref(showId).push().key; },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 500).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    boothPins: {
      ref: function(showId, boothId) { return DB.ref('events/boothPins/' + showId + (boothId ? '/' + boothId : '')); },
      get: function(showId) { return this.ref(showId).once('value'); },
      set: function(showId, boothId, data) { return this.ref(showId, boothId).set(data); },
      remove: function(showId, boothId) { if (boothId) return this.ref(showId, boothId).remove(); return this.ref(showId).remove(); },
      listen: function(showId, cb, errCb) { return this.ref(showId).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    showsBySlug: {
      ref: function(slug) { return DB.ref('events/showsBySlug' + (slug ? '/' + slug : '')); },
      set: function(slug, showId) { return this.ref(slug).set(showId); },
      remove: function(slug) { return this.ref(slug).remove(); }
    },
    vendors: {
      ref: function(showId, vendorId) { return DB.ref('events/vendors/' + showId + (vendorId ? '/' + vendorId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 500).once('value'); },
      set: function(showId, vendorId, data) { return this.ref(showId, vendorId).set(data); },
      update: function(showId, vendorId, data) { return this.ref(showId, vendorId).update(data); },
      remove: function(showId, vendorId) { return this.ref(showId, vendorId).remove(); },
      newKey: function(showId) { return this.ref(showId).push().key; },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 500).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    submissions: {
      ref: function(showId, subId) { return DB.ref('events/submissions/' + showId + (subId ? '/' + subId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 200).once('value'); },
      update: function(showId, subId, data) { return this.ref(showId, subId).update(data); },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 200).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    announcements: {
      ref: function(showId, annId) { return DB.ref('events/announcements/' + showId + (annId ? '/' + annId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 100).once('value'); },
      set: function(showId, annId, data) { return this.ref(showId, annId).set(data); },
      newKey: function(showId) { return this.ref(showId).push().key; },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 100).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    huntConfig: {
      ref: function(showId) { return DB.ref('events/huntConfig/' + showId); },
      get: function(showId) { return this.ref(showId).once('value'); },
      set: function(showId, data) { return this.ref(showId).set(data); }
    },
    huntStats: {
      ref: function(showId) { return DB.ref('events/huntStats/' + showId); },
      get: function(showId) { return this.ref(showId).once('value'); },
      listen: function(showId, cb, errCb) { return this.ref(showId).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    huntParticipants: {
      ref: function(showId) { return DB.ref('events/huntParticipants/' + showId); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 200).once('value'); }
    },
    showAdConfig: {
      ref: function(showId) { return DB.ref('events/showAdConfig/' + showId); },
      get: function(showId) { return this.ref(showId).once('value'); },
      set: function(showId, data) { return this.ref(showId).set(data); }
    },
    vendorWallets: {
      ref: function(showId, vendorId) { return DB.ref('events/vendorWallets/' + showId + (vendorId ? '/' + vendorId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 200).once('value'); },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 200).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    vendorTransactions: {
      ref: function(showId, vendorId, txId) {
        var p = 'events/vendorTransactions/' + showId;
        if (vendorId) p += '/' + vendorId;
        if (txId) p += '/' + txId;
        return DB.ref(p);
      },
      list: function(showId, vendorId, limit) { return this.ref(showId, vendorId).limitToLast(limit || 50).once('value'); }
    },
    ads: {
      ref: function(showId, adId) { return DB.ref('events/ads/' + showId + (adId ? '/' + adId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 200).once('value'); },
      set: function(showId, adId, data) { return this.ref(showId, adId).set(data); },
      update: function(showId, adId, data) { return this.ref(showId, adId).update(data); },
      remove: function(showId, adId) { return this.ref(showId, adId).remove(); },
      newKey: function(showId) { return this.ref(showId).push().key; },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 200).on('value', cb, errCb); },
      unlisten: function(showId, h) { return this.ref(showId).off('value', h); }
    }
  };

  // ============================================================
  // Cloud Function helper (uses core callCF)
  // ============================================================

  function callEventsFunction(fnName, body) {
    return window.currentUser.getIdToken().then(function(token) {
      return window.callCF('/' + fnName, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(body)
      });
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Function call failed');
        return data;
      });
    });
  }

  // ============================================================
  // Constants
  // ============================================================

  var SHOW_STATUSES = ['draft', 'published', 'active', 'completed', 'cancelled'];
  var BOOTH_TYPES = [
    { value: 'standard', label: 'Standard' },
    { value: 'corner', label: 'Corner' },
    { value: 'premium', label: 'Premium' },
    { value: 'food', label: 'Food' },
    { value: 'nonprofit', label: 'Nonprofit' }
  ];
  var VENDOR_CATEGORIES = [
    'Jewelry & Accessories', 'Pottery & Ceramics', 'Woodworking',
    'Textiles & Fiber Arts', 'Candles & Soap', 'Art & Photography',
    'Food & Beverage', 'Plants & Flowers', 'Clothing', 'Other'
  ];
  var VENDOR_STATUSES = ['pending', 'confirmed', 'cancelled', 'no-show'];
  var PAYMENT_STATUSES = ['pending', 'paid', 'waived'];
  var HUNT_MODES = [
    { value: 'any', label: 'Any X Vendors' },
    { value: 'selected', label: 'Selected Vendors' },
    { value: 'random', label: 'Random Assignment' }
  ];

  // ============================================================
  // Module-private state
  // ============================================================

  var showsData = {};
  var showsLoaded = false;
  var showsListener = null;
  var selectedShowId = null;
  var boothsData = {};
  var boothPinsData = {};
  var boothsListener = null;
  var pinsListener = null;
  var vendorsData = {};
  var vendorsListener = null;
  var submissionsData = {};
  var submissionsListener = null;
  var announcementsData = {};
  var announcementsListener = null;
  var huntStatsData = null;
  var huntStatsListener = null;
  var walletsData = {};
  var walletsListener = null;
  var adsData = {};
  var adsListener = null;
  var currentView = 'shows-list'; // shows-list | show-detail | settings
  var activeDetailTab = 'overview';
  var floorPlanState = { placingBoothId: null, imgLoaded: false };

  // ============================================================
  // Utility (module-private, use core esc/showToast)
  // ============================================================

  function nowISO() { return new Date().toISOString(); }

  function generateSlug(name) {
    var base = name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return base + '-' + Date.now().toString(36).slice(-4);
  }

  function evStatusColor(status) {
    var map = { draft: '#888', published: '#3b82f6', active: '#10b981', completed: '#8b5cf6', cancelled: '#ef4444', open: '#10b981', reserved: '#f59e0b', confirmed: '#10b981', pending: '#f59e0b', paid: '#10b981', waived: '#8b5cf6', 'no-show': '#ef4444', invited: '#3b82f6', free: '#10b981', declined: '#ef4444', accepted: '#10b981', reviewed: '#3b82f6' };
    return map[status] || '#888';
  }

  function evStatusBg(status) {
    var c = evStatusColor(status);
    var r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    return 'rgba(' + r + ',' + g + ',' + b + ',0.15)';
  }

  function evBadgeHtml(status) {
    return '<span class="status-badge" style="background:' + evStatusBg(status) + ';color:' + evStatusColor(status) + ';">' + esc(status) + '</span>';
  }

  function evCloseModal(id) {
    var m = document.getElementById(id);
    if (m) m.remove();
  }

  function objToList(obj) {
    var list = [];
    for (var id in obj) list.push(Object.assign({ id: id }, obj[id]));
    return list;
  }

  // ============================================================
  // Data Loading
  // ============================================================

  function loadShows() {
    if (showsListener) DB.shows.unlisten(showsListener);
    showsListener = DB.shows.listen(200, function(snap) {
      showsData = snap.val() || {};
      showsLoaded = true;
      if (currentView === 'shows-list') renderShowsDashboard();
      else if (currentView === 'show-detail' && selectedShowId) renderShowDetail(selectedShowId);
    }, function(err) { showToast('Error loading shows: ' + err.message, true); });
  }

  function loadBooths(showId) {
    if (boothsListener) DB.booths.unlisten(showId, boothsListener);
    boothsListener = DB.booths.listen(showId, 500, function(snap) {
      boothsData = snap.val() || {};
      if (currentView === 'show-detail' && selectedShowId === showId) refreshActiveTab(showId);
    }, function(err) { showToast('Error loading booths: ' + err.message, true); });
  }

  function loadBoothPins(showId) {
    if (pinsListener) DB.boothPins.unlisten(showId, pinsListener);
    pinsListener = DB.boothPins.listen(showId, function(snap) {
      boothPinsData = snap.val() || {};
      if (currentView === 'show-detail' && selectedShowId === showId && activeDetailTab === 'floorplan') renderFloorPlanTab(showId);
    }, function(err) { showToast('Error loading pins: ' + err.message, true); });
  }

  function loadVendors(showId) {
    if (vendorsListener) DB.vendors.unlisten(showId, vendorsListener);
    vendorsListener = DB.vendors.listen(showId, 500, function(snap) {
      vendorsData = snap.val() || {};
      if (currentView === 'show-detail' && selectedShowId === showId && activeDetailTab === 'vendors') renderVendorsTab(showId);
    }, function(err) { showToast('Error loading vendors: ' + err.message, true); });
  }

  function loadSubmissions(showId) {
    if (submissionsListener) DB.submissions.unlisten(showId, submissionsListener);
    submissionsListener = DB.submissions.listen(showId, 200, function(snap) {
      submissionsData = snap.val() || {};
      if (currentView === 'show-detail' && selectedShowId === showId && activeDetailTab === 'submissions') renderSubmissionsTab(showId);
    }, function(err) { showToast('Error loading submissions: ' + err.message, true); });
  }

  function loadAnnouncements(showId) {
    if (announcementsListener) DB.announcements.unlisten(showId, announcementsListener);
    announcementsListener = DB.announcements.listen(showId, 100, function(snap) {
      announcementsData = snap.val() || {};
      if (currentView === 'show-detail' && selectedShowId === showId && activeDetailTab === 'announcements') renderAnnouncementsTab(showId);
    }, function(err) { showToast('Error loading announcements: ' + err.message, true); });
  }

  function loadHuntStats(showId) {
    if (huntStatsListener) DB.huntStats.unlisten(showId, huntStatsListener);
    huntStatsListener = DB.huntStats.listen(showId, function(snap) {
      huntStatsData = snap.val() || {};
      if (currentView === 'show-detail' && selectedShowId === showId && activeDetailTab === 'hunt') renderHuntTab(showId);
    }, function(err) { /* silent */ });
  }

  function loadWallets(showId) {
    if (walletsListener) DB.vendorWallets.unlisten(showId, walletsListener);
    walletsListener = DB.vendorWallets.listen(showId, 200, function(snap) {
      walletsData = snap.val() || {};
      if (currentView === 'show-detail' && selectedShowId === showId && activeDetailTab === 'ads') renderAdsTab(showId);
    }, function(err) { /* silent */ });
  }

  function loadAds(showId) {
    if (adsListener) DB.ads.unlisten(showId, adsListener);
    adsListener = DB.ads.listen(showId, 200, function(snap) {
      adsData = snap.val() || {};
      if (currentView === 'show-detail' && selectedShowId === showId && activeDetailTab === 'ads') renderAdsTab(showId);
    }, function(err) { /* silent */ });
  }

  function refreshActiveTab(showId) {
    switch(activeDetailTab) {
      case 'overview': renderOverviewTab(showId); break;
      case 'booths': renderBoothsTab(showId); break;
      case 'floorplan': renderFloorPlanTab(showId); break;
      case 'vendors': renderVendorsTab(showId); break;
    }
  }

  // ============================================================
  // Navigation (module-internal)
  // ============================================================

  function evNavigateTo(view, showId) {
    var container = document.getElementById('eventsAdminTab');
    if (!container) return;
    if (view === 'shows-list') {
      currentView = 'shows-list';
      selectedShowId = null;
      detachDetailListeners();
      renderShowsDashboard();
    } else if (view === 'show-detail' && showId) {
      currentView = 'show-detail';
      selectedShowId = showId;
      activeDetailTab = 'overview';
      loadBooths(showId);
      loadBoothPins(showId);
      loadVendors(showId);
      loadSubmissions(showId);
      loadAnnouncements(showId);
      renderShowDetail(showId);
    } else if (view === 'settings') {
      currentView = 'settings';
      selectedShowId = null;
      detachDetailListeners();
      renderSettings();
    }
  }

  function evSwitchDetailTab(showId, tab) {
    activeDetailTab = tab;
    document.querySelectorAll('#eventsAdminTab .view-tab').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    if (tab === 'hunt') loadHuntStats(showId);
    if (tab === 'ads') { loadWallets(showId); loadAds(showId); }
    renderTabContent(showId, tab);
  }

  function renderTabContent(showId, tab) {
    switch(tab) {
      case 'overview': renderOverviewTab(showId); break;
      case 'booths': renderBoothsTab(showId); break;
      case 'floorplan': renderFloorPlanTab(showId); break;
      case 'vendors': renderVendorsTab(showId); break;
      case 'submissions': renderSubmissionsTab(showId); break;
      case 'checkin': renderCheckInTab(showId); break;
      case 'announcements': renderAnnouncementsTab(showId); break;
      case 'hunt': renderHuntTab(showId); break;
      case 'ads': renderAdsTab(showId); break;
    }
  }

  function detachDetailListeners() {
    if (boothsListener && selectedShowId) { DB.booths.unlisten(selectedShowId, boothsListener); boothsListener = null; }
    if (pinsListener && selectedShowId) { DB.boothPins.unlisten(selectedShowId, pinsListener); pinsListener = null; }
    if (vendorsListener && selectedShowId) { DB.vendors.unlisten(selectedShowId, vendorsListener); vendorsListener = null; }
    if (submissionsListener && selectedShowId) { DB.submissions.unlisten(selectedShowId, submissionsListener); submissionsListener = null; }
    if (announcementsListener && selectedShowId) { DB.announcements.unlisten(selectedShowId, announcementsListener); announcementsListener = null; }
    if (huntStatsListener && selectedShowId) { DB.huntStats.unlisten(selectedShowId, huntStatsListener); huntStatsListener = null; }
    if (walletsListener && selectedShowId) { DB.vendorWallets.unlisten(selectedShowId, walletsListener); walletsListener = null; }
    if (adsListener && selectedShowId) { DB.ads.unlisten(selectedShowId, adsListener); adsListener = null; }
    boothsData = {};
    boothPinsData = {};
    vendorsData = {};
    submissionsData = {};
    announcementsData = {};
    huntStatsData = null;
    walletsData = {};
    adsData = {};
  }

  // ============================================================
  // Main render entry point
  // ============================================================

  function renderEventsAdmin() {
    if (!showsLoaded) loadShows();
    else renderShowsDashboard();
  }

  // ============================================================
  // Shows Dashboard
  // ============================================================

  function renderShowsDashboard() {
    var container = document.getElementById('eventsAdminTab');
    if (!container) return;

    var shows = [];
    for (var id in showsData) shows.push(Object.assign({ id: id }, showsData[id]));
    shows.sort(function(a, b) { return (b.startDate || '').localeCompare(a.startDate || ''); });

    var html = '<div class="ev-page-header"><h2 style="margin:0;font-size:1.15rem;">Shows</h2><div>';
    html += '<button class="btn btn-small btn-secondary" onclick="evNavigateTo(\'settings\')" style="margin-right:8px;">&#9881; Settings</button>';
    html += '<button class="btn btn-small btn-primary" onclick="evOpenCreateShowModal()">+ New Show</button>';
    html += '</div></div>';

    if (shows.length === 0) {
      html += '<div style="text-align:center;padding:60px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#127914;</div>' +
        '<p style="font-size:1.15rem;font-weight:600;margin-bottom:4px;">No shows yet</p>' +
        '<p style="font-size:0.85rem;">Create your first show to get started.</p>' +
        '<button class="btn btn-primary" onclick="evOpenCreateShowModal()" style="margin-top:16px;">Create Show</button>' +
      '</div>';
      container.innerHTML = html;
      return;
    }

    var upcoming = shows.filter(function(s) { return s.status !== 'completed' && s.status !== 'cancelled'; });
    var past = shows.filter(function(s) { return s.status === 'completed' || s.status === 'cancelled'; });

    if (upcoming.length > 0) {
      html += '<h3 class="ev-section-title">Upcoming &amp; Active</h3>';
      html += '<div class="ev-show-grid" style="margin-bottom:24px;">';
      for (var i = 0; i < upcoming.length; i++) html += showCardHtml(upcoming[i]);
      html += '</div>';
    }
    if (past.length > 0) {
      html += '<h3 class="ev-section-title">Past</h3>';
      html += '<div class="ev-show-grid">';
      for (var j = 0; j < past.length; j++) html += showCardHtml(past[j]);
      html += '</div>';
    }
    container.innerHTML = html;
  }

  function showCardHtml(show) {
    var dateStr = '';
    if (show.startDate) {
      dateStr = formatDate(show.startDate);
      if (show.endDate && show.endDate !== show.startDate) dateStr += ' — ' + formatDate(show.endDate);
    }
    return '<div class="ev-show-card" onclick="evNavigateTo(\'show-detail\', \'' + esc(show.id) + '\')">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">' +
        '<h3 style="font-size:1rem;font-weight:600;margin:0;">' + esc(show.name) + '</h3>' +
        evBadgeHtml(show.status) +
      '</div>' +
      (show.venue ? '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 4px;">&#128205; ' + esc(show.venue) + '</p>' : '') +
      (dateStr ? '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0;">&#128197; ' + dateStr + '</p>' : '') +
    '</div>';
  }

  // ============================================================
  // Create Show Modal
  // ============================================================

  function openCreateShowModal() {
    var overlay = document.createElement('div');
    overlay.id = 'evShowModal';
    overlay.className = 'ev-modal-overlay';
    overlay.innerHTML =
      '<div class="ev-modal-box">' +
        '<h3>Create New Show</h3>' +
        '<form id="evShowForm" onsubmit="evSubmitCreateShow(event)">' +
          '<div class="ev-form-group"><label class="ev-form-label">Show Name *</label><input class="ev-form-input" type="text" id="evsf_name" required placeholder="e.g. Spring Artisan Market 2026"></div>' +
          '<div class="ev-form-group"><label class="ev-form-label">Description</label><textarea class="ev-form-textarea" id="evsf_desc" rows="3" placeholder="Brief description..."></textarea></div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Venue</label><input class="ev-form-input" type="text" id="evsf_venue" placeholder="Convention Center"></div>' +
            '<div><label class="ev-form-label">Address</label><input class="ev-form-input" type="text" id="evsf_address" placeholder="123 Main St"></div>' +
          '</div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">City</label><input class="ev-form-input" type="text" id="evsf_city"></div>' +
            '<div><label class="ev-form-label">State</label><input class="ev-form-input" type="text" id="evsf_state"></div>' +
          '</div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-3">' +
            '<div><label class="ev-form-label">Start Date *</label><input class="ev-form-input" type="date" id="evsf_startDate" required></div>' +
            '<div><label class="ev-form-label">End Date</label><input class="ev-form-input" type="date" id="evsf_endDate"></div>' +
            '<div><label class="ev-form-label">Setup Time</label><input class="ev-form-input" type="text" id="evsf_setupTime" placeholder="7:00 AM"></div>' +
          '</div>' +
          '<div class="ev-form-actions"><button type="button" class="btn btn-secondary" onclick="evCloseModal(\'evShowModal\')">Cancel</button><button type="submit" class="btn btn-primary">Create Show</button></div>' +
        '</form>' +
      '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) evCloseModal('evShowModal'); });
    document.body.appendChild(overlay);
  }

  function submitCreateShow(e) {
    e.preventDefault();
    var name = document.getElementById('evsf_name').value.trim();
    if (!name) return;
    var showId = DB.shows.newKey();
    var slug = generateSlug(name);
    var now = nowISO();
    var data = {
      createdBy: window.currentUser.uid, name: name,
      description: document.getElementById('evsf_desc').value.trim(),
      venue: document.getElementById('evsf_venue').value.trim(),
      address: document.getElementById('evsf_address').value.trim(),
      city: document.getElementById('evsf_city').value.trim(),
      state: document.getElementById('evsf_state').value.trim(),
      startDate: document.getElementById('evsf_startDate').value,
      endDate: document.getElementById('evsf_endDate').value,
      setupTime: document.getElementById('evsf_setupTime').value.trim(),
      status: 'draft', slug: slug, createdAt: now, updatedAt: now
    };
    DB.shows.set(showId, data).then(function() {
      return DB.showsBySlug.set(slug, showId);
    }).then(function() {
      showToast('Show created!');
      evCloseModal('evShowModal');
      evNavigateTo('show-detail', showId);
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  // ============================================================
  // Show Detail View
  // ============================================================

  function renderShowDetail(showId) {
    var show = showsData[showId];
    var container = document.getElementById('eventsAdminTab');
    if (!container) return;
    if (!show) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--warm-gray);">Show not found.</div>';
      return;
    }

    var boothCount = Object.keys(boothsData).length;
    var vendorCount = Object.keys(vendorsData).length;
    var subCount = Object.keys(submissionsData).length;

    var tabs = [
      { key: 'overview', label: 'Overview' },
      { key: 'booths', label: 'Booths (' + boothCount + ')' },
      { key: 'vendors', label: 'Vendors (' + vendorCount + ')' },
      { key: 'floorplan', label: 'Floor Plan' },
      { key: 'submissions', label: 'Submissions (' + subCount + ')' },
      { key: 'checkin', label: 'Check-in' },
      { key: 'announcements', label: 'Announcements' },
      { key: 'hunt', label: 'Hunt' },
      { key: 'ads', label: 'Ads' }
    ];

    var html = '<button class="detail-back" onclick="evNavigateTo(\'shows-list\')">← Back to Shows</button>';
    html += '<div class="ev-page-header">';
    html += '<h2 style="margin:0;font-size:1.15rem;">' + esc(show.name) + ' ' + evBadgeHtml(show.status) + '</h2>';
    html += '</div>';
    html += '<div class="view-tabs">';
    for (var t = 0; t < tabs.length; t++) {
      html += '<button class="view-tab' + (tabs[t].key === activeDetailTab ? ' active' : '') + '" data-tab="' + tabs[t].key + '" onclick="evSwitchDetailTab(\'' + esc(showId) + '\', \'' + tabs[t].key + '\')">' + tabs[t].label + '</button>';
    }
    html += '</div><div id="evTabContent"></div>';
    container.innerHTML = html;
    renderTabContent(showId, activeDetailTab);
  }

  // ============================================================
  // Overview Tab
  // ============================================================

  function evShowQRSrc(url) {
    return 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(url);
  }

  function copyShowUrl(showId) {
    var show = showsData[showId];
    if (!show || !show.slug) return;
    var domain = window.location.hostname;
    var url = 'https://' + domain + '/show/' + show.slug;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() { showToast('URL copied!'); });
    } else {
      mastCopyFallback('Copy this URL', url);
    }
  }

  function downloadShowQR(showId) {
    var show = showsData[showId];
    if (!show || !show.slug) return;
    var domain = window.location.hostname;
    var url = 'https://' + domain + '/show/' + show.slug;
    var link = document.createElement('a');
    link.download = 'qr-' + show.slug + '.png';
    link.href = evShowQRSrc(url);
    link.target = '_blank';
    link.click();
  }

  function renderOverviewTab(showId) {
    var show = showsData[showId];
    if (!show) return;
    var boothsList = objToList(boothsData);
    var filledBooths = boothsList.filter(function(b) { return b.vendorId; });
    var container = document.getElementById('evTabContent');
    if (!container) return;

    var html = '<div class="ev-detail-grid"><div>';
    html += '<div class="ev-stats-grid">';
    html += '<div class="ev-stat-card"><div class="ev-stat-label">Booths</div><div class="ev-stat-value">' + filledBooths.length + '/' + boothsList.length + '</div><div class="ev-stat-sub">filled</div></div>';
    html += '<div class="ev-stat-card"><div class="ev-stat-label">Vendors</div><div class="ev-stat-value">' + Object.keys(vendorsData).length + '</div></div>';
    html += '<div class="ev-stat-card"><div class="ev-stat-label">Status</div><div class="ev-stat-value" style="text-transform:capitalize;">' + esc(show.status) + '</div></div>';
    html += '<div class="ev-stat-card"><div class="ev-stat-label">Slug</div><div class="ev-stat-value" style="font-size:0.85rem;word-break:break-all;">' + esc(show.slug || '—') + '</div></div>';
    html += '</div>';

    html += '<div class="ev-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;"><h3 style="margin:0;">Show Details</h3><button style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';" onclick="evOpenEditShowModal(\'' + esc(showId) + '\')">Edit</button></div>';
    if (show.description) html += '<p style="font-size:0.9rem;margin:0 0 8px;">' + esc(show.description) + '</p>';
    if (show.venue) html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 4px;">&#128205; ' + esc(show.venue) + (show.address ? ', ' + esc(show.address) : '') + (show.city ? ', ' + esc(show.city) : '') + (show.state ? ' ' + esc(show.state) : '') + '</p>';
    if (show.startDate) {
      var dt = formatDate(show.startDate);
      if (show.endDate && show.endDate !== show.startDate) dt += ' — ' + formatDate(show.endDate);
      html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 4px;">&#128197; ' + dt + '</p>';
    }
    if (show.setupTime) html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0;">&#128336; Setup: ' + esc(show.setupTime) + '</p>';
    html += '</div></div>';

    html += '<div>';
    html += '<div class="ev-card"><h3>Status</h3><select class="ev-form-select" onchange="evUpdateShowStatus(\'' + esc(showId) + '\', this.value)">';
    for (var si = 0; si < SHOW_STATUSES.length; si++) {
      var st = SHOW_STATUSES[si];
      html += '<option value="' + st + '"' + (st === show.status ? ' selected' : '') + '>' + st.charAt(0).toUpperCase() + st.slice(1) + '</option>';
    }
    html += '</select></div>';

    html += '<div class="ev-card"><h3>Vendor Applications</h3>';
    html += '<button class="btn btn-small btn-primary" style="width:100%;margin-top:8px;" onclick="evOpenSubmissionConfig(\'' + esc(showId) + '\')">' +
      (show.submissionConfig && show.submissionConfig.enabled ? '&#9881; Submission Settings' : 'Create Submission Page') + '</button>';
    if (show.submissionConfig && show.submissionConfig.enabled && show.slug) {
      html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:8px;">Public URL: /apply/' + esc(show.slug) + '</p>';
    }
    html += '</div>';

    if (show.slug) {
      var showDomain = window.location.hostname;
      var attendeeUrl = 'https://' + showDomain + '/show/' + show.slug;
      html += '<div class="ev-card"><h3>Show QR Code</h3>';
      html += '<div style="display:flex;justify-content:center;margin-bottom:10px;">';
      html += '<img src="' + evShowQRSrc(attendeeUrl) + '" alt="QR Code" style="width:180px;height:180px;border-radius:8px;" />';
      html += '</div>';
      html += '<p style="font-size:0.72rem;color:var(--warm-gray);text-align:center;word-break:break-all;margin:0 0 10px;">' + esc(attendeeUrl) + '</p>';
      html += '<div style="display:flex;gap:8px;">';
      html += '<button class="btn btn-small" style="flex:1;" onclick="evDownloadShowQR(\'' + esc(showId) + '\')">&#11015; Download</button>';
      html += '<button class="btn btn-small" style="flex:1;" onclick="evCopyShowUrl(\'' + esc(showId) + '\')">&#128203; Copy URL</button>';
      html += '</div>';
      html += '<p style="font-size:0.72rem;color:var(--warm-gray);margin-top:8px;">Add this QR code to your show program or entrance signage so attendees can browse vendors on their phones.</p>';
      html += '</div>';
    }
    html += '<button class="btn btn-danger" style="width:100%;" onclick="evDeleteShow(\'' + esc(showId) + '\')">Delete Show</button>';
    html += '</div></div>';
    container.innerHTML = html;
  }

  function updateShowStatus(showId, status) {
    DB.shows.update(showId, { status: status, updatedAt: nowISO() }).then(function() {
      showToast('Status updated to ' + status);
      if (status === 'published' || status === 'active') {
        return callEventsFunction('eventsSyncShowSlug', { showId: showId }).then(function() {
          showToast('Slug synced to platform');
        }).catch(function(err) {
          showToast('Status updated but slug sync failed: ' + err.message, true);
        });
      }
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  async function deleteShow(showId) {
    if (!await mastConfirm('Delete this show and all its data? This cannot be undone.', { title: 'Delete Show', danger: true })) return;
    var show = showsData[showId];
    DB.shows.remove(showId).then(function() {
      var promises = [];
      if (show && show.slug) promises.push(DB.showsBySlug.remove(show.slug));
      promises.push(DB.booths.ref(showId).remove());
      promises.push(DB.boothPins.remove(showId));
      promises.push(DB.vendors.ref(showId).remove());
      promises.push(DB.submissions.ref(showId).remove());
      promises.push(DB.announcements.ref(showId).remove());
      return Promise.all(promises);
    }).then(function() {
      showToast('Show deleted');
      evNavigateTo('shows-list');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  // ============================================================
  // Edit Show Modal
  // ============================================================

  function openEditShowModal(showId) {
    var show = showsData[showId];
    if (!show) return;
    var overlay = document.createElement('div');
    overlay.id = 'evShowModal';
    overlay.className = 'ev-modal-overlay';
    overlay.innerHTML =
      '<div class="ev-modal-box">' +
        '<h3>Edit Show</h3>' +
        '<form onsubmit="evSubmitEditShow(event, \'' + esc(showId) + '\')">' +
          '<div class="ev-form-group"><label class="ev-form-label">Show Name *</label><input class="ev-form-input" type="text" id="evsf_name" required value="' + esc(show.name || '') + '"></div>' +
          '<div class="ev-form-group"><label class="ev-form-label">Description</label><textarea class="ev-form-textarea" id="evsf_desc" rows="3">' + esc(show.description || '') + '</textarea></div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Venue</label><input class="ev-form-input" type="text" id="evsf_venue" value="' + esc(show.venue || '') + '"></div>' +
            '<div><label class="ev-form-label">Address</label><input class="ev-form-input" type="text" id="evsf_address" value="' + esc(show.address || '') + '"></div>' +
          '</div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">City</label><input class="ev-form-input" type="text" id="evsf_city" value="' + esc(show.city || '') + '"></div>' +
            '<div><label class="ev-form-label">State</label><input class="ev-form-input" type="text" id="evsf_state" value="' + esc(show.state || '') + '"></div>' +
          '</div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-3">' +
            '<div><label class="ev-form-label">Start Date *</label><input class="ev-form-input" type="date" id="evsf_startDate" required value="' + esc(show.startDate || '') + '"></div>' +
            '<div><label class="ev-form-label">End Date</label><input class="ev-form-input" type="date" id="evsf_endDate" value="' + esc(show.endDate || '') + '"></div>' +
            '<div><label class="ev-form-label">Setup Time</label><input class="ev-form-input" type="text" id="evsf_setupTime" value="' + esc(show.setupTime || '') + '"></div>' +
          '</div>' +
          '<div class="ev-form-actions"><button type="button" class="btn btn-secondary" onclick="evCloseModal(\'evShowModal\')">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>' +
        '</form>' +
      '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) evCloseModal('evShowModal'); });
    document.body.appendChild(overlay);
  }

  function submitEditShow(e, showId) {
    e.preventDefault();
    var name = document.getElementById('evsf_name').value.trim();
    if (!name) return;
    var show = showsData[showId];
    var updates = {
      name: name,
      description: document.getElementById('evsf_desc').value.trim(),
      venue: document.getElementById('evsf_venue').value.trim(),
      address: document.getElementById('evsf_address').value.trim(),
      city: document.getElementById('evsf_city').value.trim(),
      state: document.getElementById('evsf_state').value.trim(),
      startDate: document.getElementById('evsf_startDate').value,
      endDate: document.getElementById('evsf_endDate').value,
      setupTime: document.getElementById('evsf_setupTime').value.trim(),
      updatedAt: nowISO()
    };
    var p = Promise.resolve();
    if (show && name !== show.name) {
      var newSlug = generateSlug(name);
      updates.slug = newSlug;
      p = (show.slug ? DB.showsBySlug.remove(show.slug) : Promise.resolve()).then(function() {
        return DB.showsBySlug.set(newSlug, showId);
      });
    }
    p.then(function() {
      return DB.shows.update(showId, updates);
    }).then(function() {
      showToast('Show updated!');
      evCloseModal('evShowModal');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  // ============================================================
  // Booths Tab
  // ============================================================

  function renderBoothsTab(showId) {
    var container = document.getElementById('evTabContent');
    if (!container) return;
    var boothsList = objToList(boothsData);
    boothsList.sort(function(a, b) { return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }); });

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h3 style="margin:0;font-size:1rem;">Booths</h3>';
    html += '<div style="display:flex;gap:8px;"><button class="btn btn-small btn-secondary" onclick="evOpenBulkAddBoothsModal(\'' + esc(showId) + '\')">Bulk Add</button><button class="btn btn-small btn-primary" onclick="evOpenAddBoothModal(\'' + esc(showId) + '\')">+ Add Booth</button></div></div>';

    if (boothsList.length === 0) {
      html += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">No booths yet. Add booths to start managing your show layout.</div>';
    } else {
      html += '<div class="events-table"><table><thead><tr><th>Name</th><th>Size</th><th>Type</th><th>Price</th><th>Location</th><th>Status</th><th></th></tr></thead><tbody>';
      for (var i = 0; i < boothsList.length; i++) {
        var b = boothsList[i];
        html += '<tr><td style="font-weight:600;">' + esc(b.name || '') + '</td><td>' + esc(b.size || '') + '</td><td>' + evBadgeHtml(b.type || 'standard') + '</td><td>' + formatCurrency(b.price || 0) + '</td><td style="color:var(--warm-gray);">' + esc(b.location || '—') + '</td><td>' + evBadgeHtml(b.status || 'open') + '</td>' +
          '<td style="text-align:right;"><button style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';" onclick="evOpenEditBoothModal(\'' + esc(showId) + '\', \'' + esc(b.id) + '\')">Edit</button> <button style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';" onclick="evDeleteBooth(\'' + esc(showId) + '\', \'' + esc(b.id) + '\')">Del</button></td></tr>';
      }
      html += '</tbody></table></div>';
    }
    container.innerHTML = html;
  }

  function openAddBoothModal(showId) { renderBoothFormModal(showId, null, 'Add Booth'); }
  function openEditBoothModal(showId, boothId) {
    var booth = boothsData[boothId];
    if (!booth) return;
    renderBoothFormModal(showId, Object.assign({ id: boothId }, booth), 'Edit Booth');
  }

  function renderBoothFormModal(showId, booth, title) {
    var isEdit = !!booth;
    var priceDisplay = isEdit && booth.price > 0 ? (booth.price / 100).toFixed(2) : '';
    var overlay = document.createElement('div');
    overlay.id = 'evBoothModal';
    overlay.className = 'ev-modal-overlay';
    overlay.innerHTML =
      '<div class="ev-modal-box">' +
        '<h3>' + esc(title) + '</h3>' +
        '<form onsubmit="evSubmitBoothForm(event, \'' + esc(showId) + '\', ' + (isEdit ? '\'' + esc(booth.id) + '\'' : 'null') + ')">' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Booth Name *</label><input class="ev-form-input" type="text" id="evbf_name" required value="' + esc(isEdit ? booth.name || '' : '') + '" placeholder="e.g. A1"></div>' +
            '<div><label class="ev-form-label">Size</label><input class="ev-form-input" type="text" id="evbf_size" value="' + esc(isEdit ? booth.size || '' : '10x10') + '"></div>' +
          '</div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Type</label><select class="ev-form-select" id="evbf_type">' + BOOTH_TYPES.map(function(t) { return '<option value="' + t.value + '"' + (isEdit && booth.type === t.value ? ' selected' : '') + '>' + t.label + '</option>'; }).join('') + '</select></div>' +
            '<div><label class="ev-form-label">Price ($)</label><input class="ev-form-input" type="number" step="0.01" id="evbf_price" value="' + priceDisplay + '" placeholder="0.00"></div>' +
          '</div>' +
          '<div class="ev-form-group"><label class="ev-form-label">Location</label><input class="ev-form-input" type="text" id="evbf_location" value="' + esc(isEdit ? booth.location || '' : '') + '" placeholder="e.g. Main Hall, north wall"></div>' +
          '<div class="ev-form-group"><label class="ev-form-label">Provided (comma-separated)</label><input class="ev-form-input" type="text" id="evbf_provided" value="' + esc(isEdit && booth.provided ? booth.provided.join(', ') : '') + '" placeholder="table, 2 chairs, electricity"></div>' +
          '<div class="ev-form-group"><label class="ev-form-label">Required (comma-separated)</label><input class="ev-form-input" type="text" id="evbf_required" value="' + esc(isEdit && booth.required ? booth.required.join(', ') : '') + '" placeholder="tent, insurance certificate"></div>' +
          '<div class="ev-form-group"><label class="ev-form-label">Notes</label><textarea class="ev-form-textarea" id="evbf_notes" rows="2">' + esc(isEdit ? booth.notes || '' : '') + '</textarea></div>' +
          '<div class="ev-form-actions"><button type="button" class="btn btn-secondary" onclick="evCloseModal(\'evBoothModal\')">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>' +
        '</form>' +
      '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) evCloseModal('evBoothModal'); });
    document.body.appendChild(overlay);
  }

  function submitBoothForm(e, showId, boothId) {
    e.preventDefault();
    var data = {
      name: document.getElementById('evbf_name').value.trim(),
      size: document.getElementById('evbf_size').value.trim(),
      type: document.getElementById('evbf_type').value,
      price: Math.round(parseFloat(document.getElementById('evbf_price').value) * 100) || 0,
      location: document.getElementById('evbf_location').value.trim(),
      provided: document.getElementById('evbf_provided').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
      required: document.getElementById('evbf_required').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
      notes: document.getElementById('evbf_notes').value.trim()
    };
    if (!data.name) return;
    var p;
    if (boothId) {
      p = DB.booths.update(showId, boothId, data).then(function() { showToast('Booth updated!'); });
    } else {
      var newId = DB.booths.newKey(showId);
      data.showId = showId; data.status = 'open'; data.vendorId = null; data.assignedAt = null; data.createdAt = nowISO();
      p = DB.booths.set(showId, newId, data).then(function() { showToast('Booth added!'); });
    }
    p.then(function() { evCloseModal('evBoothModal'); }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  async function deleteBooth(showId, boothId) {
    if (!await mastConfirm('Delete this booth?', { title: 'Delete Booth', danger: true })) return;
    DB.booths.remove(showId, boothId).then(function() {
      return DB.boothPins.remove(showId, boothId);
    }).then(function() { showToast('Booth deleted'); }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  function openBulkAddBoothsModal(showId) {
    var overlay = document.createElement('div');
    overlay.id = 'evBoothModal';
    overlay.className = 'ev-modal-overlay';
    overlay.innerHTML =
      '<div class="ev-modal-box">' +
        '<h3>Bulk Add Booths</h3>' +
        '<form onsubmit="evSubmitBulkAddBooths(event, \'' + esc(showId) + '\')">' +
          '<div class="ev-form-group"><label class="ev-form-label">Number of Booths *</label><input class="ev-form-input" type="number" id="evbbf_count" min="1" max="200" value="10" required></div>' +
          '<div class="ev-form-group"><label class="ev-form-label">Name Prefix</label><input class="ev-form-input" type="text" id="evbbf_prefix" value="Booth "></div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-3">' +
            '<div><label class="ev-form-label">Size</label><input class="ev-form-input" type="text" id="evbbf_size" value="10x10"></div>' +
            '<div><label class="ev-form-label">Type</label><select class="ev-form-select" id="evbbf_type">' + BOOTH_TYPES.map(function(t) { return '<option value="' + t.value + '">' + t.label + '</option>'; }).join('') + '</select></div>' +
            '<div><label class="ev-form-label">Price ($)</label><input class="ev-form-input" type="number" step="0.01" id="evbbf_price" value="0"></div>' +
          '</div>' +
          '<div class="ev-form-actions"><button type="button" class="btn btn-secondary" onclick="evCloseModal(\'evBoothModal\')">Cancel</button><button type="submit" class="btn btn-primary">Add Booths</button></div>' +
        '</form>' +
      '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) evCloseModal('evBoothModal'); });
    document.body.appendChild(overlay);
  }

  function submitBulkAddBooths(e, showId) {
    e.preventDefault();
    var count = parseInt(document.getElementById('evbbf_count').value) || 1;
    var prefix = document.getElementById('evbbf_prefix').value || 'Booth ';
    var size = document.getElementById('evbbf_size').value || '10x10';
    var type = document.getElementById('evbbf_type').value || 'standard';
    var price = Math.round(parseFloat(document.getElementById('evbbf_price').value) * 100) || 0;
    var now = nowISO();
    var updates = {};
    for (var i = 0; i < count; i++) {
      var bid = DB.booths.newKey(showId);
      updates[bid] = { showId: showId, name: prefix + (i + 1), size: size, type: type, location: '', price: price, provided: [], required: [], notes: '', status: 'open', vendorId: null, assignedAt: null, createdAt: now };
    }
    DB.booths.ref(showId).update(updates).then(function() {
      showToast(count + ' booths added!');
      evCloseModal('evBoothModal');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  // ============================================================
  // Floor Plan Tab
  // ============================================================

  function renderFloorPlanTab(showId) {
    var show = showsData[showId];
    if (!show) return;
    var container = document.getElementById('evTabContent');
    if (!container) return;
    var pins = boothPinsData;
    var boothsList = objToList(boothsData);

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h3 style="margin:0;font-size:1rem;">Floor Plan</h3>';
    if (show.floorPlanUrl) {
      html += '<div style="display:flex;gap:8px;">';
      html += '<label class="btn btn-small btn-secondary" style="cursor:pointer;">Replace<input type="file" accept="image/*" onchange="evUploadFloorPlan(event, \'' + esc(showId) + '\')" style="display:none;"></label>';
      html += '<button class="btn btn-small" style="background:rgba(139,92,246,0.1);color:#8b5cf6;border:1px solid rgba(139,92,246,0.3);" onclick="evDetectBooths(\'' + esc(showId) + '\')">AI Detect</button>';
      if (Object.keys(pins).length > 0) html += '<button class="btn btn-small" style="background:rgba(245,158,11,0.1);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);" onclick="evClearAllPins(\'' + esc(showId) + '\')">Clear Pins</button>';
      html += '<button class="btn btn-small btn-danger" onclick="evRemoveFloorPlan(\'' + esc(showId) + '\')">Remove</button></div>';
    }
    html += '</div>';

    if (!show.floorPlanUrl) {
      html += '<div style="background:var(--cream);border:2px dashed var(--cream-dark);border-radius:10px;padding:60px 20px;text-align:center;">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#128506;</div><p style="color:var(--warm-gray);margin-bottom:16px;">Upload a floor plan image to place booth markers.</p>' +
        '<label class="btn btn-primary" style="cursor:pointer;">Upload Floor Plan<input type="file" accept="image/*" onchange="evUploadFloorPlan(event, \'' + esc(showId) + '\')" style="display:none;"></label>' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:12px;">PNG, JPG, or SVG up to 10MB</p></div>';
    } else {
      html += '<div id="evFpPlaceBanner" style="display:none;background:rgba(42,124,111,0.15);border:1px solid rgba(42,124,111,0.3);border-radius:8px;padding:10px 16px;margin-bottom:12px;font-size:0.85rem;align-items:center;justify-content:space-between;">' +
        '<span>Click on the floor plan to place <strong id="evFpPlacingName"></strong></span>' +
        '<button onclick="evCancelPinPlacement()" style="color:var(--warm-gray);background:none;border:none;cursor:pointer;">Cancel</button></div>';

      html += '<div class="ev-floorplan-layout"><div id="evFpContainer" class="ev-card" style="overflow:hidden;">';
      html += '<img id="evFpImg" src="' + esc(show.floorPlanUrl) + '" style="display:none;" onload="evOnFloorPlanImgLoad(\'' + esc(showId) + '\')">';
      html += '<canvas id="evFpCanvas" style="width:100%;border-radius:8px;cursor:default;display:none;" onclick="evOnFloorPlanClick(event, \'' + esc(showId) + '\')"></canvas>';
      html += '<div id="evFpLoading" style="text-align:center;padding:40px;"><div class="loading">Loading floor plan...</div></div>';
      html += '</div><div>';

      var unpinned = boothsList.filter(function(b) { return !pins[b.id]; });
      var pinned = boothsList.filter(function(b) { return pins[b.id]; });
      if (unpinned.length > 0) {
        html += '<div class="ev-card"><h4 style="font-size:0.78rem;text-transform:uppercase;color:var(--warm-gray);margin:0 0 10px;">Unplaced</h4>';
        for (var u = 0; u < unpinned.length; u++) html += '<button onclick="evStartPinPlacement(\'' + esc(showId) + '\', \'' + esc(unpinned[u].id) + '\', \'' + esc(unpinned[u].name) + '\')" style="display:block;width:100%;text-align:left;padding:6px 10px;font-size:0.85rem;background:none;border:none;border-radius:4px;cursor:pointer;color:var(--charcoal);">' + esc(unpinned[u].name) + '</button>';
        html += '</div>';
      }
      if (pinned.length > 0) {
        html += '<div class="ev-card"><h4 style="font-size:0.78rem;text-transform:uppercase;color:var(--warm-gray);margin:0 0 10px;">Placed</h4>';
        for (var p2 = 0; p2 < pinned.length; p2++) html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 10px;font-size:0.85rem;"><button onclick="evStartPinPlacement(\'' + esc(showId) + '\', \'' + esc(pinned[p2].id) + '\', \'' + esc(pinned[p2].name) + '\')" style="background:none;border:none;cursor:pointer;color:var(--charcoal);font-size:0.85rem;">' + esc(pinned[p2].name) + '</button><button onclick="evRemovePin(\'' + esc(showId) + '\', \'' + esc(pinned[p2].id) + '\')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.78rem;font-family:\'DM Sans\';">Remove</button></div>';
        html += '</div>';
      }
      html += '</div></div>';
    }
    container.innerHTML = html;
    floorPlanState.placingBoothId = null;
    floorPlanState.imgLoaded = false;
  }

  function uploadFloorPlan(e, showId) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please upload an image', true); return; }
    if (file.size > 10 * 1024 * 1024) { showToast('Image must be under 10MB', true); return; }
    var ext = file.name.split('.').pop();
    var path = DB.storagePath('events/floorplans/' + showId + '.' + ext);
    var ref = window.storage.ref(path);
    ref.put(file).then(function() {
      return ref.getDownloadURL();
    }).then(function(url) {
      return DB.shows.update(showId, { floorPlanUrl: url, updatedAt: nowISO() });
    }).then(function() {
      showToast('Floor plan uploaded!');
    }).catch(function(err) { showToast('Upload failed: ' + err.message, true); });
  }

  async function removeFloorPlan(showId) {
    if (!await mastConfirm('Remove floor plan and clear all pin placements?', { title: 'Remove Floor Plan', danger: true })) return;
    DB.shows.update(showId, { floorPlanUrl: null, updatedAt: nowISO() }).then(function() {
      return DB.boothPins.remove(showId);
    }).then(function() { showToast('Floor plan removed'); }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  async function clearAllPins(showId) {
    if (!await mastConfirm('Clear all pin placements?', { title: 'Clear Pins', danger: true })) return;
    DB.boothPins.remove(showId).then(function() { showToast('All pins cleared'); }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  async function detectBooths(showId) {
    if (!await mastConfirm('Use AI to auto-detect booth positions from the floor plan? This will add new booths.', { title: 'Detect Booths' })) return;
    showToast('Detecting booths...');
    callEventsFunction('eventsDetectBooths', { showId: showId }).then(function(result) {
      showToast('Detected ' + (result.boothsCreated || 0) + ' booths');
    }).catch(function(err) { showToast('Detection failed: ' + err.message, true); });
  }

  function startPinPlacement(showId, boothId, boothName) {
    floorPlanState.placingBoothId = boothId;
    var banner = document.getElementById('evFpPlaceBanner');
    var nameEl = document.getElementById('evFpPlacingName');
    if (banner) banner.style.display = 'flex';
    if (nameEl) nameEl.textContent = boothName;
    var canvas = document.getElementById('evFpCanvas');
    if (canvas) canvas.style.cursor = 'crosshair';
  }

  function cancelPinPlacement() {
    floorPlanState.placingBoothId = null;
    var banner = document.getElementById('evFpPlaceBanner');
    if (banner) banner.style.display = 'none';
    var canvas = document.getElementById('evFpCanvas');
    if (canvas) canvas.style.cursor = 'default';
  }

  function onFloorPlanClick(e, showId) {
    if (!floorPlanState.placingBoothId) return;
    var canvas = document.getElementById('evFpCanvas');
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width;
    var y = (e.clientY - rect.top) / rect.height;
    var boothId = floorPlanState.placingBoothId;
    var booth = boothsData[boothId];
    DB.boothPins.set(showId, boothId, { x: x, y: y }).then(function() {
      showToast('Pin placed for ' + (booth ? booth.name : 'booth'));
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
    cancelPinPlacement();
  }

  function removePin(showId, boothId) {
    DB.boothPins.remove(showId, boothId).then(function() { showToast('Pin removed'); }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  function onFloorPlanImgLoad(showId) {
    floorPlanState.imgLoaded = true;
    drawFloorPlanCanvas(showId);
  }

  function drawFloorPlanCanvas(showId) {
    var img = document.getElementById('evFpImg');
    var canvas = document.getElementById('evFpCanvas');
    var loading = document.getElementById('evFpLoading');
    var fpContainer = document.getElementById('evFpContainer');
    if (!img || !canvas || !floorPlanState.imgLoaded) return;
    var maxW = fpContainer ? fpContainer.clientWidth - 24 : 800;
    var scale = Math.min(maxW / img.naturalWidth, 1);
    var w = img.naturalWidth * scale;
    var h = img.naturalHeight * scale;
    canvas.width = w; canvas.height = h;
    canvas.style.display = 'block';
    if (loading) loading.style.display = 'none';
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    var pinData = boothPinsData;
    for (var bid in pinData) {
      var pin = pinData[bid];
      var bth = boothsData[bid];
      if (!pin || !bth) continue;
      var px = pin.x * w, py = pin.y * h;
      var isPlacing = floorPlanState.placingBoothId === bid;
      ctx.beginPath();
      ctx.arc(px, py, isPlacing ? 14 : 10, 0, Math.PI * 2);
      ctx.fillStyle = isPlacing ? '#818cf8' : 'var(--teal)';
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(bth.name || '', px, py);
    }
  }

  // ============================================================
  // Vendors Tab
  // ============================================================

  function renderVendorsTab(showId) {
    var container = document.getElementById('evTabContent');
    if (!container) return;
    var list = objToList(vendorsData);
    list.sort(function(a, b) { return (a.businessName || '').localeCompare(b.businessName || ''); });

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h3 style="margin:0;font-size:1rem;">Vendors (' + list.length + ')</h3>';
    html += '<button class="btn btn-small btn-primary" onclick="evOpenVendorModal(\'' + esc(showId) + '\')">+ Add Vendor</button></div>';

    if (list.length === 0) {
      html += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">No vendors yet. Add vendors to your show.</div>';
    } else {
      html += '<div class="events-table"><table><thead><tr><th>Business</th><th>Category</th><th>Booth</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>';
      for (var i = 0; i < list.length; i++) {
        var v = list[i];
        var boothName = '—';
        if (v.boothId && boothsData[v.boothId]) boothName = boothsData[v.boothId].name || v.boothId;
        html += '<tr>' +
          '<td><div style="font-weight:600;">' + esc(v.businessName || '') + '</div><div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(v.ownerName || '') + (v.email ? ' · ' + esc(v.email) : '') + '</div></td>' +
          '<td style="font-size:0.78rem;">' + esc(v.category || '—') + '</td>' +
          '<td>' + esc(boothName) + '</td>' +
          '<td>' + evBadgeHtml(v.paymentStatus || 'pending') + '</td>' +
          '<td><select style="font-size:0.78rem;padding:2px 6px;border-radius:4px;border:1px solid var(--cream-dark);background:var(--cream);color:var(--charcoal);" onchange="evUpdateVendorStatus(\'' + esc(showId) + '\', \'' + esc(v.id) + '\', this.value)">';
        for (var si = 0; si < VENDOR_STATUSES.length; si++) {
          html += '<option value="' + VENDOR_STATUSES[si] + '"' + (VENDOR_STATUSES[si] === (v.status || 'pending') ? ' selected' : '') + '>' + VENDOR_STATUSES[si] + '</option>';
        }
        html += '</select></td>' +
          '<td style="text-align:right;white-space:nowrap;">' +
            (v.email && !v.inviteSentAt ? '<button style="background:none;border:none;color:#3b82f6;cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';" onclick="evSendVendorInvite(\'' + esc(showId) + '\', \'' + esc(v.id) + '\')">Invite</button> ' : '') +
            (v.inviteSentAt ? '<span style="font-size:0.72rem;color:var(--warm-gray);">Invited </span>' : '') +
            '<button style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';" onclick="evOpenVendorModal(\'' + esc(showId) + '\', \'' + esc(v.id) + '\')">Edit</button> ' +
            '<button style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';" onclick="evDeleteVendor(\'' + esc(showId) + '\', \'' + esc(v.id) + '\')">Del</button>' +
          '</td></tr>';
      }
      html += '</tbody></table></div>';
    }
    container.innerHTML = html;
  }

  function openVendorModal(showId, vendorId) {
    var v = vendorId ? vendorsData[vendorId] : null;
    var isEdit = !!v;
    if (isEdit) v = Object.assign({ id: vendorId }, v);
    var overlay = document.createElement('div');
    overlay.id = 'evVendorModal';
    overlay.className = 'ev-modal-overlay';

    var boothOpts = '<option value="">— None —</option>';
    var boothsList = objToList(boothsData);
    boothsList.sort(function(a, b) { return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }); });
    for (var bi = 0; bi < boothsList.length; bi++) {
      var bb = boothsList[bi];
      var taken = bb.vendorId && bb.vendorId !== vendorId;
      if (!taken) boothOpts += '<option value="' + esc(bb.id) + '"' + (isEdit && v.boothId === bb.id ? ' selected' : '') + '>' + esc(bb.name) + '</option>';
    }

    var catOpts = '<option value="">— Select —</option>';
    for (var ci = 0; ci < VENDOR_CATEGORIES.length; ci++) {
      catOpts += '<option value="' + esc(VENDOR_CATEGORIES[ci]) + '"' + (isEdit && v.category === VENDOR_CATEGORIES[ci] ? ' selected' : '') + '>' + esc(VENDOR_CATEGORIES[ci]) + '</option>';
    }

    var payOpts = '';
    for (var pi = 0; pi < PAYMENT_STATUSES.length; pi++) {
      payOpts += '<option value="' + PAYMENT_STATUSES[pi] + '"' + (isEdit && v.paymentStatus === PAYMENT_STATUSES[pi] ? ' selected' : '') + '>' + PAYMENT_STATUSES[pi] + '</option>';
    }

    overlay.innerHTML =
      '<div class="ev-modal-box">' +
        '<h3>' + (isEdit ? 'Edit Vendor' : 'Add Vendor') + '</h3>' +
        '<form onsubmit="evSubmitVendorForm(event, \'' + esc(showId) + '\', ' + (isEdit ? '\'' + esc(vendorId) + '\'' : 'null') + ')">' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Business Name *</label><input class="ev-form-input" type="text" id="evvf_biz" required value="' + esc(isEdit ? v.businessName || '' : '') + '"></div>' +
            '<div><label class="ev-form-label">Owner Name</label><input class="ev-form-input" type="text" id="evvf_owner" value="' + esc(isEdit ? v.ownerName || '' : '') + '"></div>' +
          '</div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Email *</label><input class="ev-form-input" type="email" id="evvf_email" required value="' + esc(isEdit ? v.email || '' : '') + '"></div>' +
            '<div><label class="ev-form-label">Phone</label><input class="ev-form-input" type="text" id="evvf_phone" value="' + esc(isEdit ? v.phone || '' : '') + '"></div>' +
          '</div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Category</label><select class="ev-form-select" id="evvf_category">' + catOpts + '</select></div>' +
            '<div><label class="ev-form-label">Payment Status</label><select class="ev-form-select" id="evvf_payment">' + payOpts + '</select></div>' +
          '</div>' +
          '<div class="ev-form-group"><label class="ev-form-label">Business Description</label><textarea class="ev-form-textarea" id="evvf_desc" rows="2">' + esc(isEdit ? v.businessDescription || '' : '') + '</textarea></div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Website</label><input class="ev-form-input" type="text" id="evvf_web" value="' + esc(isEdit ? v.websiteUrl || '' : '') + '"></div>' +
            '<div><label class="ev-form-label">Instagram</label><input class="ev-form-input" type="text" id="evvf_insta" value="' + esc(isEdit ? v.instagramHandle || '' : '') + '"></div>' +
          '</div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Assign Booth</label><select class="ev-form-select" id="evvf_booth">' + boothOpts + '</select></div>' +
            '<div><label class="ev-form-label">Mast Tenant ID</label><input class="ev-form-input" type="text" id="evvf_tenant" value="' + esc(isEdit ? v.mastTenantId || '' : '') + '" placeholder="Optional"></div>' +
          '</div>' +
          '<div class="ev-form-group"><label class="ev-form-label">Notes (organizer only)</label><textarea class="ev-form-textarea" id="evvf_notes" rows="2">' + esc(isEdit ? v.notes || '' : '') + '</textarea></div>' +
          '<div class="ev-form-actions"><button type="button" class="btn btn-secondary" onclick="evCloseModal(\'evVendorModal\')">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>' +
        '</form>' +
      '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) evCloseModal('evVendorModal'); });
    document.body.appendChild(overlay);
  }

  function submitVendorForm(e, showId, vendorId) {
    e.preventDefault();
    var biz = document.getElementById('evvf_biz').value.trim();
    var email = document.getElementById('evvf_email').value.trim();
    if (!biz || !email) return;
    var boothId = document.getElementById('evvf_booth').value || null;
    var tenantId = document.getElementById('evvf_tenant').value.trim() || null;
    var data = {
      businessName: biz,
      ownerName: document.getElementById('evvf_owner').value.trim(),
      email: email,
      phone: document.getElementById('evvf_phone').value.trim(),
      category: document.getElementById('evvf_category').value,
      businessDescription: document.getElementById('evvf_desc').value.trim(),
      websiteUrl: document.getElementById('evvf_web').value.trim(),
      instagramHandle: document.getElementById('evvf_insta').value.trim(),
      boothId: boothId,
      mastTenantId: tenantId,
      mastStatus: tenantId ? 'free' : 'invited',
      paymentStatus: document.getElementById('evvf_payment').value || 'pending',
      notes: document.getElementById('evvf_notes').value.trim(),
      updatedAt: nowISO()
    };
    var p;
    if (vendorId) {
      var oldVendor = vendorsData[vendorId];
      p = Promise.resolve();
      if (oldVendor && oldVendor.boothId && oldVendor.boothId !== boothId) {
        p = p.then(function() { return DB.booths.update(showId, oldVendor.boothId, { vendorId: null, status: 'open', assignedAt: null }); });
      }
      if (boothId && (!oldVendor || oldVendor.boothId !== boothId)) {
        p = p.then(function() { return DB.booths.update(showId, boothId, { vendorId: vendorId, status: 'reserved', assignedAt: nowISO() }); });
      }
      p = p.then(function() { return DB.vendors.update(showId, vendorId, data); });
      p.then(function() { showToast('Vendor updated!'); evCloseModal('evVendorModal'); }).catch(function(err) { showToast('Error: ' + err.message, true); });
    } else {
      var newId = DB.vendors.newKey(showId);
      data.showId = showId;
      data.status = 'pending';
      data.logoUrl = '';
      data.inviteSentAt = null;
      data.inviteClaimedAt = null;
      data.inviteToken = null;
      data.stripePaymentIntentId = null;
      data.paidAt = null;
      data.paidAmount = 0;
      data.createdAt = nowISO();
      p = Promise.resolve();
      if (boothId) {
        p = DB.booths.update(showId, boothId, { vendorId: newId, status: 'reserved', assignedAt: nowISO() });
      }
      p.then(function() { return DB.vendors.set(showId, newId, data); }).then(function() {
        showToast('Vendor added!');
        evCloseModal('evVendorModal');
      }).catch(function(err) { showToast('Error: ' + err.message, true); });
    }
  }

  function updateVendorStatus(showId, vendorId, status) {
    DB.vendors.update(showId, vendorId, { status: status, updatedAt: nowISO() }).then(function() {
      showToast('Vendor status updated');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  async function deleteVendor(showId, vendorId) {
    if (!await mastConfirm('Delete this vendor?', { title: 'Delete Vendor', danger: true })) return;
    var v = vendorsData[vendorId];
    var p = Promise.resolve();
    if (v && v.boothId) {
      p = DB.booths.update(showId, v.boothId, { vendorId: null, status: 'open', assignedAt: null });
    }
    p.then(function() { return DB.vendors.remove(showId, vendorId); }).then(function() {
      showToast('Vendor deleted');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  async function sendVendorInvite(showId, vendorId) {
    if (!await mastConfirm('Send invite email to this vendor?', { title: 'Send Invite' })) return;
    callEventsFunction('eventsSendVendorInvite', { showId: showId, vendorId: vendorId }).then(function() {
      showToast('Invite sent!');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  // ============================================================
  // Submissions Tab
  // ============================================================

  function renderSubmissionsTab(showId) {
    var container = document.getElementById('evTabContent');
    if (!container) return;
    var list = objToList(submissionsData);
    list.sort(function(a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });

    var pending = list.filter(function(s) { return s.status === 'pending'; });
    var accepted = list.filter(function(s) { return s.reviewDecision === 'accepted'; });
    var declined = list.filter(function(s) { return s.reviewDecision === 'declined'; });

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h3 style="margin:0;font-size:1rem;">Submissions</h3>';
    html += '<div style="display:flex;gap:12px;align-items:center;font-size:0.78rem;color:var(--warm-gray);">' +
      '<span style="color:#f59e0b;">' + pending.length + ' pending</span>' +
      '<span style="color:#10b981;">' + accepted.length + ' accepted</span>' +
      '<span style="color:var(--danger);">' + declined.length + ' declined</span>' +
      ((accepted.length + declined.length) > 0 ? ' <button class="btn btn-small btn-primary" onclick="evSendSubmissionNotifications(\'' + esc(showId) + '\')">Email Results</button>' : '') +
    '</div></div>';

    if (list.length === 0) {
      html += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">No submissions yet. Share your apply page (/apply/{slug}) with vendors to receive applications.</div>';
    } else {
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        html += '<div class="ev-card" style="margin-bottom:12px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">';
        html += '<div><strong>' + esc(s.businessName || '') + '</strong> ' + evBadgeHtml(s.reviewDecision || s.status || 'pending');
        if (s.notified) html += ' <span style="font-size:0.72rem;color:var(--warm-gray);">notified</span>';
        html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' + esc(s.ownerName || '') + (s.email ? ' · ' + esc(s.email) : '') + (s.phone ? ' · ' + esc(s.phone) : '') + '</div>';
        html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + esc(s.category || '') + ' · Submitted ' + (s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : '') + '</div>';
        html += '</div></div>';

        if (s.businessDescription) html += '<p style="font-size:0.85rem;margin:10px 0 0;">' + esc(s.businessDescription) + '</p>';
        if (s.websiteUrl) html += '<p style="font-size:0.78rem;margin:4px 0 0;"><a href="' + esc(s.websiteUrl) + '" target="_blank" style="color:var(--teal);">' + esc(s.websiteUrl) + '</a></p>';
        if (s.instagramHandle) html += '<p style="font-size:0.78rem;margin:4px 0 0;color:var(--warm-gray);">IG: ' + esc(s.instagramHandle) + '</p>';
        if (s.additionalInfo) html += '<p style="font-size:0.78rem;margin:8px 0 0;padding:8px;background:var(--cream-dark);border-radius:6px;">' + esc(s.additionalInfo) + '</p>';

        if (s.imageUrls && s.imageUrls.length > 0) {
          html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">';
          for (var img = 0; img < s.imageUrls.length; img++) {
            html += '<img src="' + esc(s.imageUrls[img]) + '" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--cream-dark);cursor:pointer;" onclick="evOpenImageViewer(' + JSON.stringify(s.imageUrls).replace(/"/g, '&quot;') + ', ' + img + ')" alt="Image ' + (img + 1) + '">';
          }
          html += '</div>';
        }

        if (s.status === 'pending') {
          html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--cream-dark);display:flex;gap:8px;align-items:center;">';
          html += '<input type="text" id="evReviewNote_' + esc(s.id) + '" class="ev-form-input" style="flex:1;padding:6px 10px;font-size:0.78rem;" placeholder="Review notes (optional)">';
          html += '<button class="btn btn-small" style="background:#10b981;color:#fff;" onclick="evReviewSubmission(\'' + esc(showId) + '\', \'' + esc(s.id) + '\', \'accepted\')">Accept</button>';
          html += '<button class="btn btn-small btn-danger" onclick="evReviewSubmission(\'' + esc(showId) + '\', \'' + esc(s.id) + '\', \'declined\')">Decline</button>';
          html += '</div>';
        } else if (s.reviewNotes) {
          html += '<p style="font-size:0.78rem;margin-top:8px;color:var(--warm-gray);">Review notes: ' + esc(s.reviewNotes) + '</p>';
        }
        html += '</div>';
      }
    }
    container.innerHTML = html;
  }

  function reviewSubmission(showId, subId, decision) {
    var notesEl = document.getElementById('evReviewNote_' + subId);
    var notes = notesEl ? notesEl.value.trim() : '';
    DB.submissions.update(showId, subId, {
      status: 'reviewed',
      reviewDecision: decision,
      reviewedAt: nowISO(),
      reviewedBy: window.currentUser.uid,
      reviewNotes: notes,
      updatedAt: nowISO()
    }).then(function() {
      if (decision === 'accepted') {
        var sub = submissionsData[subId];
        if (sub) {
          var vid = DB.vendors.newKey(showId);
          return DB.vendors.set(showId, vid, {
            showId: showId,
            businessName: sub.businessName || '',
            ownerName: sub.ownerName || '',
            email: sub.email || '',
            phone: sub.phone || '',
            category: sub.category || '',
            businessDescription: sub.businessDescription || '',
            websiteUrl: sub.websiteUrl || '',
            instagramHandle: sub.instagramHandle || '',
            boothId: null, mastTenantId: null, mastStatus: 'invited',
            status: 'pending', paymentStatus: 'pending', logoUrl: '',
            notes: 'Created from submission',
            inviteSentAt: null, inviteClaimedAt: null, inviteToken: null,
            stripePaymentIntentId: null, paidAt: null, paidAmount: 0,
            createdAt: nowISO(), updatedAt: nowISO()
          }).then(function() {
            showToast('Submission ' + decision + ' — vendor record created');
          });
        }
      }
      showToast('Submission ' + decision);
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  async function sendSubmissionNotifications(showId) {
    if (!await mastConfirm('Send email notifications to all reviewed vendors (accepted & declined)?', { title: 'Send Notifications' })) return;
    callEventsFunction('eventsSendNotifications', { showId: showId }).then(function(result) {
      showToast('Notifications sent to ' + (result.sentCount || 0) + ' vendors');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  // ============================================================
  // Check-in Tab
  // ============================================================

  function renderCheckInTab(showId) {
    var container = document.getElementById('evTabContent');
    if (!container) return;
    var all = objToList(vendorsData);
    var confirmed = all.filter(function(v) { return v.status === 'confirmed' || v.status === 'no-show' || v.checkedIn; });
    var arrivedCount = confirmed.filter(function(v) { return v.checkedIn; }).length;

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h3 style="margin:0;font-size:1rem;">Check-in</h3>';
    html += '<div class="ev-card" style="display:inline-block;padding:8px 16px;margin:0;">' +
      '<span style="font-weight:700;color:#10b981;">' + arrivedCount + '</span>' +
      '<span style="color:var(--warm-gray);"> / ' + confirmed.length + ' checked in</span></div>';
    html += '</div>';

    // Filters
    html += '<div style="display:flex;gap:8px;margin-bottom:16px;" id="evCheckinFilters">';
    var filters = [{ key: 'all', label: 'All' }, { key: 'arrived', label: 'Arrived' }, { key: 'not-arrived', label: 'Not Arrived' }, { key: 'no-show', label: 'No-Show' }];
    for (var fi = 0; fi < filters.length; fi++) {
      var f = filters[fi];
      var active = (checkinFilter || 'all') === f.key;
      html += '<button class="btn btn-small' + (active ? ' btn-primary' : ' btn-secondary') + '" onclick="evSetCheckinFilter(\'' + f.key + '\', \'' + esc(showId) + '\')">' + f.label + '</button>';
    }
    html += '</div>';

    if (confirmed.length === 0) {
      html += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:8px;">&#128203;</div>' +
        '<p>No confirmed vendors. Confirm vendors first to use check-in.</p></div>';
    } else {
      var filtered = confirmed;
      if (checkinFilter === 'arrived') filtered = confirmed.filter(function(v) { return v.checkedIn === true; });
      else if (checkinFilter === 'not-arrived') filtered = confirmed.filter(function(v) { return !v.checkedIn && v.status !== 'no-show'; });
      else if (checkinFilter === 'no-show') filtered = confirmed.filter(function(v) { return v.status === 'no-show'; });

      for (var ci = 0; ci < filtered.length; ci++) {
        var v = filtered[ci];
        var booth = v.boothId && boothsData[v.boothId] ? boothsData[v.boothId] : null;
        html += '<div class="ev-card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px;">';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="font-weight:600;font-size:0.9rem;">' + esc(v.businessName || '') + '</div>';
        if (booth) html += '<div style="font-size:0.78rem;color:var(--warm-gray);">Booth: ' + esc(booth.name || '') + (booth.location ? ' — ' + esc(booth.location) : '') + '</div>';
        html += '</div>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button class="btn btn-small" style="' + (v.checkedIn ? 'background:#10b981;color:#fff;' : 'background:var(--cream-dark);color:var(--warm-gray);') + '" onclick="evToggleCheckin(\'' + esc(showId) + '\', \'' + esc(v.id) + '\', ' + (v.checkedIn ? 'false' : 'true') + ')">' + (v.checkedIn ? '&#10003; Arrived' : 'Not Arrived') + '</button>';
        html += '<button class="btn btn-small" style="' + (v.status === 'no-show' ? 'background:var(--danger);color:#fff;' : 'background:var(--cream-dark);color:var(--warm-gray);') + '" onclick="evMarkNoShow(\'' + esc(showId) + '\', \'' + esc(v.id) + '\')">No-Show</button>';
        html += '</div></div>';
      }
    }
    container.innerHTML = html;
  }

  var checkinFilter = 'all';

  function setCheckinFilter(filter, showId) {
    checkinFilter = filter;
    renderCheckInTab(showId);
  }

  function toggleCheckin(showId, vendorId, arrived) {
    DB.vendors.update(showId, vendorId, { checkedIn: arrived, status: 'confirmed', updatedAt: nowISO() }).then(function() {
      showToast(arrived ? 'Checked in!' : 'Unmarked');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  function markNoShow(showId, vendorId) {
    DB.vendors.update(showId, vendorId, { checkedIn: false, status: 'no-show', updatedAt: nowISO() }).then(function() {
      showToast('Marked as no-show');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  // ============================================================
  // Submission Config Modal
  // ============================================================

  function openSubmissionConfigModal(showId) {
    var show = showsData[showId];
    if (!show) return;
    var existing = show.submissionConfig || {};
    var overlay = document.createElement('div');
    overlay.id = 'evSubConfigModal';
    overlay.className = 'ev-modal-overlay';
    overlay.innerHTML =
      '<div class="ev-modal-box">' +
        '<h3>Vendor Submission Page</h3>' +
        '<form onsubmit="evSubmitSubConfig(event, \'' + esc(showId) + '\')">' +
          '<div class="ev-form-group"><label class="ev-form-label">Vendor Requirements / Criteria</label>' +
            '<textarea class="ev-form-textarea" id="evsc_criteria" rows="4" placeholder="Describe what you\'re looking for in vendors...">' + esc(existing.criteria || '') + '</textarea></div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Max Images</label>' +
              '<select class="ev-form-select" id="evsc_maxImages">';
    [1,2,3,4,5,8,10].forEach(function(n) {
      overlay.innerHTML; // force var allocation above
    });
    var maxOpts = '';
    [1,2,3,4,5,8,10].forEach(function(n) {
      maxOpts += '<option value="' + n + '"' + (n === (existing.maxImages || 5) ? ' selected' : '') + '>' + n + '</option>';
    });
    overlay.innerHTML =
      '<div class="ev-modal-box">' +
        '<h3>Vendor Submission Page</h3>' +
        '<form onsubmit="evSubmitSubConfig(event, \'' + esc(showId) + '\')">' +
          '<div class="ev-form-group"><label class="ev-form-label">Vendor Requirements / Criteria</label>' +
            '<textarea class="ev-form-textarea" id="evsc_criteria" rows="4" placeholder="Describe what you\'re looking for in vendors...">' + esc(existing.criteria || '') + '</textarea></div>' +
          '<div class="ev-form-group ev-form-row ev-form-row-2">' +
            '<div><label class="ev-form-label">Max Images</label>' +
              '<select class="ev-form-select" id="evsc_maxImages">' + maxOpts + '</select></div>' +
            '<div style="display:flex;align-items:flex-end;"><label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;padding-bottom:8px;">' +
              '<input type="checkbox" id="evsc_requireImages"' + (existing.requireImages ? ' checked' : '') + '> Require images</label></div>' +
          '</div>' +
          '<div class="ev-form-group"><label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;">' +
            '<input type="checkbox" id="evsc_enabled"' + (existing.enabled ? ' checked' : '') + '> Enable public submission page</label></div>' +
          (existing.enabled && show.slug ? '<div style="background:var(--cream-dark);border-radius:8px;padding:10px;font-size:0.78rem;color:var(--warm-gray);margin-bottom:12px;">Public URL: <strong>/apply/' + esc(show.slug) + '</strong></div>' : '') +
          '<div class="ev-form-actions">' +
            (existing.enabled ? '<button type="button" class="btn btn-small btn-danger" onclick="evCloseSubmissions(\'' + esc(showId) + '\')">Close Submissions</button>' : '<span></span>') +
            '<div style="display:flex;gap:8px;"><button type="button" class="btn btn-secondary" onclick="evCloseModal(\'evSubConfigModal\')">Cancel</button>' +
            '<button type="submit" class="btn btn-primary">Save</button></div>' +
          '</div>' +
        '</form>' +
      '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) evCloseModal('evSubConfigModal'); });
    document.body.appendChild(overlay);
  }

  function submitSubConfig(e, showId) {
    e.preventDefault();
    var enabled = document.getElementById('evsc_enabled').checked;
    var existing = (showsData[showId] || {}).submissionConfig || {};
    DB.shows.update(showId, {
      submissionConfig: {
        enabled: enabled,
        criteria: document.getElementById('evsc_criteria').value.trim(),
        maxImages: parseInt(document.getElementById('evsc_maxImages').value) || 5,
        requireImages: document.getElementById('evsc_requireImages').checked,
        closedAt: null,
        createdAt: existing.createdAt || nowISO(),
        updatedAt: nowISO()
      }
    }).then(function() {
      showToast(enabled ? 'Submission page enabled!' : 'Submission config saved');
      evCloseModal('evSubConfigModal');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  function closeSubmissions(showId) {
    DB.shows.update(showId, { 'submissionConfig/enabled': false, 'submissionConfig/closedAt': nowISO(), 'submissionConfig/updatedAt': nowISO() }).then(function() {
      showToast('Submissions closed');
      evCloseModal('evSubConfigModal');
    }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  // ============================================================
  // Image Viewer Modal
  // ============================================================

  function openImageViewer(images, startIdx) {
    var idx = startIdx || 0;
    var overlay = document.createElement('div');
    overlay.id = 'evImageViewer';
    overlay.className = 'ev-modal-overlay';
    overlay.style.cssText = 'background:rgba(0,0,0,0.85);';

    function renderViewer() {
      overlay.innerHTML =
        '<div style="position:relative;max-width:800px;width:100%;margin:0 16px;" onclick="event.stopPropagation()">' +
          '<button aria-label="Close image viewer" style="position:absolute;top:-40px;right:0;background:none;border:none;color:#fff;font-size:1.6rem;cursor:pointer;" onclick="evCloseModal(\'evImageViewer\')">&times;</button>' +
          '<img src="' + esc(images[idx]) + '" style="width:100%;max-height:80vh;object-fit:contain;border-radius:8px;" alt="Image ' + (idx + 1) + '">' +
          (images.length > 1 ?
            '<div style="display:flex;justify-content:center;gap:16px;margin-top:12px;">' +
              '<button class="btn btn-small btn-secondary"' + (idx === 0 ? ' disabled style="opacity:0.3;"' : '') + ' onclick="evImageViewerNav(-1)">&larr; Prev</button>' +
              '<span style="color:#fff;padding:6px 0;font-size:0.85rem;">' + (idx + 1) + ' / ' + images.length + '</span>' +
              '<button class="btn btn-small btn-secondary"' + (idx === images.length - 1 ? ' disabled style="opacity:0.3;"' : '') + ' onclick="evImageViewerNav(1)">Next &rarr;</button>' +
            '</div>' : '') +
        '</div>';
    }

    renderViewer();
    overlay.addEventListener('click', function(e) { if (e.target === overlay) evCloseModal('evImageViewer'); });
    document.body.appendChild(overlay);

    window._evImageViewerState = { images: images, idx: idx, render: renderViewer, overlay: overlay };
  }

  function imageViewerNav(delta) {
    var st = window._evImageViewerState;
    if (!st) return;
    st.idx = Math.max(0, Math.min(st.images.length - 1, st.idx + delta));
    var overlay = document.getElementById('evImageViewer');
    if (!overlay) return;
    var idx = st.idx;
    var images = st.images;
    overlay.innerHTML =
      '<div style="position:relative;max-width:800px;width:100%;margin:0 16px;" onclick="event.stopPropagation()">' +
        '<button aria-label="Close image viewer" style="position:absolute;top:-40px;right:0;background:none;border:none;color:#fff;font-size:1.6rem;cursor:pointer;" onclick="evCloseModal(\'evImageViewer\')">&times;</button>' +
        '<img src="' + esc(images[idx]) + '" style="width:100%;max-height:80vh;object-fit:contain;border-radius:8px;" alt="Image ' + (idx + 1) + '">' +
        (images.length > 1 ?
          '<div style="display:flex;justify-content:center;gap:16px;margin-top:12px;">' +
            '<button class="btn btn-small btn-secondary"' + (idx === 0 ? ' disabled style="opacity:0.3;"' : '') + ' onclick="evImageViewerNav(-1)">&larr; Prev</button>' +
            '<span style="color:#fff;padding:6px 0;font-size:0.85rem;">' + (idx + 1) + ' / ' + images.length + '</span>' +
            '<button class="btn btn-small btn-secondary"' + (idx === images.length - 1 ? ' disabled style="opacity:0.3;"' : '') + ' onclick="evImageViewerNav(1)">Next &rarr;</button>' +
          '</div>' : '') +
      '</div>';
  }

  // ============================================================
  // Announcements Tab
  // ============================================================

  function renderAnnouncementsTab(showId) {
    var container = document.getElementById('evTabContent');
    if (!container) return;
    var list = objToList(announcementsData);
    list.sort(function(a, b) { return (b.sentAt || '').localeCompare(a.sentAt || ''); });

    var html = '<h3 style="margin:0 0 16px;font-size:1rem;">Announcements</h3>';

    html += '<div class="ev-card" style="margin-bottom:20px;">';
    html += '<h4 style="font-size:0.9rem;margin:0 0 12px;">Send Announcement</h4>';
    html += '<div class="ev-form-group"><label class="ev-form-label">Subject *</label><input class="ev-form-input" type="text" id="evAnn_subject" placeholder="Announcement subject"></div>';
    html += '<div class="ev-form-group"><label class="ev-form-label">Message *</label><textarea class="ev-form-textarea" id="evAnn_body" rows="4" placeholder="Write your announcement..."></textarea></div>';
    html += '<div style="text-align:right;"><button class="btn btn-primary" onclick="evSendAnnouncement(\'' + esc(showId) + '\')">Send to Vendors</button></div>';
    html += '</div>';

    if (list.length === 0) {
      html += '<div style="text-align:center;padding:30px;color:var(--warm-gray);">No announcements sent yet.</div>';
    } else {
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        html += '<div class="ev-card" style="margin-bottom:8px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">';
        html += '<strong style="font-size:0.9rem;">' + esc(a.subject || '') + '</strong>';
        html += '<span style="font-size:0.78rem;color:var(--warm-gray);">' + (a.sentAt ? new Date(a.sentAt).toLocaleString() : '') + '</span>';
        html += '</div>';
        html += '<p style="font-size:0.85rem;margin:8px 0 0;white-space:pre-wrap;">' + esc(a.body || '') + '</p>';
        if (a.recipientCount) html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Sent to ' + a.recipientCount + ' vendors</p>';
        html += '</div>';
      }
    }
    container.innerHTML = html;
  }

  function sendAnnouncement(showId) {
    var subject = document.getElementById('evAnn_subject').value.trim();
    var body = document.getElementById('evAnn_body').value.trim();
    if (!subject || !body) { showToast('Subject and message are required', true); return; }

    callEventsFunction('eventsSendAnnouncement', { showId: showId, subject: subject, body: body }).then(function(result) {
      showToast('Announcement sent to ' + (result.recipientCount || 0) + ' vendors!');
      document.getElementById('evAnn_subject').value = '';
      document.getElementById('evAnn_body').value = '';
    }).catch(function(err) {
      var annId = DB.announcements.newKey(showId);
      var vendorCount = Object.keys(vendorsData).length;
      DB.announcements.set(showId, annId, {
        showId: showId, subject: subject, body: body,
        sentAt: nowISO(), sentBy: window.currentUser.uid, recipientCount: vendorCount,
        note: 'Saved locally — email delivery failed: ' + err.message
      }).then(function() {
        showToast('Saved locally (email failed: ' + err.message + ')', true);
        document.getElementById('evAnn_subject').value = '';
        document.getElementById('evAnn_body').value = '';
      }).catch(function(saveErr) { showToast('Error: ' + saveErr.message, true); });
    });
  }

  // ============================================================
  // Hunt Tab
  // ============================================================

  function renderHuntTab(showId) {
    var container = document.getElementById('evTabContent');
    if (!container) return;
    var confirmedVendors = objToList(vendorsData).filter(function(v) { return v.status === 'confirmed'; });

    var html = '<h3 style="margin:0 0 16px;font-size:1rem;">Scavenger Hunt</h3>';

    html += '<div class="ev-card">';
    html += '<h4 style="font-size:0.9rem;margin:0 0 12px;">Hunt Configuration</h4>';
    html += '<div class="ev-form-group"><label class="ev-form-label"><input type="checkbox" id="evHunt_enabled" onchange="evSaveHuntConfig(\'' + esc(showId) + '\')" style="margin-right:6px;">Enable Scavenger Hunt</label></div>';
    html += '<div id="evHuntConfigFields" style="display:none;">';
    html += '<div class="ev-form-group"><label class="ev-form-label">Mode</label><select class="ev-form-select" id="evHunt_mode" onchange="evOnHuntModeChange(\'' + esc(showId) + '\')">';
    for (var mi = 0; mi < HUNT_MODES.length; mi++) html += '<option value="' + HUNT_MODES[mi].value + '">' + HUNT_MODES[mi].label + '</option>';
    html += '</select></div>';
    html += '<div class="ev-form-group ev-form-row ev-form-row-2">';
    html += '<div><label class="ev-form-label">Vendors to Visit</label><input class="ev-form-input" type="number" id="evHunt_target" min="1" max="' + Math.max(confirmedVendors.length, 1) + '" value="5"></div>';
    html += '<div><label class="ev-form-label">Prize</label><input class="ev-form-input" type="text" id="evHunt_prize" placeholder="Free item, gift card, etc."></div>';
    html += '</div>';
    html += '<div class="ev-form-group"><label class="ev-form-label">Claim Instructions</label><textarea class="ev-form-textarea" id="evHunt_instructions" rows="2" placeholder="How to claim the prize"></textarea></div>';
    html += '<div id="evHuntVendorSelect" style="display:none;">';
    html += '<div class="ev-form-group"><label class="ev-form-label">Select Eligible Vendors</label>';
    for (var vi = 0; vi < confirmedVendors.length; vi++) {
      html += '<label style="display:block;padding:4px 0;font-size:0.85rem;"><input type="checkbox" class="evHuntVendorCb" value="' + esc(confirmedVendors[vi].id) + '" style="margin-right:6px;">' + esc(confirmedVendors[vi].businessName || confirmedVendors[vi].id) + '</label>';
    }
    html += '</div></div>';
    html += '<div style="margin-top:12px;"><button class="btn btn-primary" onclick="evSaveHuntConfig(\'' + esc(showId) + '\')">Save</button></div>';
    html += '</div></div>';

    var stats = huntStatsData || {};
    if (stats.totalParticipants || stats.totalCompletions) {
      html += '<div class="ev-card"><h4 style="font-size:0.9rem;margin:0 0 12px;">Hunt Statistics</h4>';
      html += '<div class="ev-stats-grid">';
      html += '<div class="ev-stat-card"><div class="ev-stat-label">Participants</div><div class="ev-stat-value">' + (stats.totalParticipants || 0) + '</div></div>';
      html += '<div class="ev-stat-card"><div class="ev-stat-label">Completions</div><div class="ev-stat-value" style="color:#10b981;">' + (stats.totalCompletions || 0) + '</div></div>';
      var rate = stats.totalParticipants ? Math.round((stats.totalCompletions || 0) / stats.totalParticipants * 100) : 0;
      html += '<div class="ev-stat-card"><div class="ev-stat-label">Rate</div><div class="ev-stat-value">' + rate + '%</div></div>';
      html += '</div>';

      if (stats.vendorScans) {
        html += '<h5 style="font-size:0.78rem;color:var(--warm-gray);margin:12px 0 8px;">Vendor Scans</h5>';
        var scanList = [];
        for (var vid in stats.vendorScans) scanList.push({ id: vid, count: stats.vendorScans[vid] });
        scanList.sort(function(a, b) { return b.count - a.count; });
        for (var sci = 0; sci < scanList.length; sci++) {
          var vname = vendorsData[scanList[sci].id] ? vendorsData[scanList[sci].id].businessName : scanList[sci].id;
          html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem;"><span>' + esc(vname) + '</span><span style="color:var(--warm-gray);">' + scanList[sci].count + '</span></div>';
        }
      }
      html += '</div>';
    }

    container.innerHTML = html;

    DB.huntConfig.get(showId).then(function(snap) {
      var config = snap.val();
      if (config) {
        var el = document.getElementById('evHunt_enabled');
        if (el) el.checked = !!config.enabled;
        if (config.enabled) { var f = document.getElementById('evHuntConfigFields'); if (f) f.style.display = 'block'; }
        if (config.mode) { var m = document.getElementById('evHunt_mode'); if (m) m.value = config.mode; }
        if (config.target) { var t = document.getElementById('evHunt_target'); if (t) t.value = config.target; }
        if (config.prize) { var p = document.getElementById('evHunt_prize'); if (p) p.value = config.prize; }
        if (config.claimInstructions) { var ci = document.getElementById('evHunt_instructions'); if (ci) ci.value = config.claimInstructions; }
        if (config.mode === 'selected' && config.selectedVendorIds) {
          var vs = document.getElementById('evHuntVendorSelect');
          if (vs) vs.style.display = 'block';
          document.querySelectorAll('.evHuntVendorCb').forEach(function(cb) {
            if (config.selectedVendorIds[cb.value]) cb.checked = true;
          });
        }
      }
    });
  }

  function onHuntModeChange(showId) {
    var mode = document.getElementById('evHunt_mode').value;
    var vs = document.getElementById('evHuntVendorSelect');
    if (vs) vs.style.display = mode === 'selected' ? 'block' : 'none';
  }

  function saveHuntConfig(showId) {
    var enabled = document.getElementById('evHunt_enabled').checked;
    var fields = document.getElementById('evHuntConfigFields');
    if (enabled && fields) fields.style.display = 'block';
    else if (fields) fields.style.display = 'none';

    var mode = document.getElementById('evHunt_mode').value;
    var selectedVendorIds = null;
    if (mode === 'selected') {
      selectedVendorIds = {};
      document.querySelectorAll('.evHuntVendorCb:checked').forEach(function(cb) { selectedVendorIds[cb.value] = true; });
    }

    DB.huntConfig.set(showId, {
      enabled: enabled,
      mode: mode,
      target: parseInt(document.getElementById('evHunt_target').value) || 5,
      prize: document.getElementById('evHunt_prize').value.trim(),
      claimInstructions: document.getElementById('evHunt_instructions').value.trim(),
      selectedVendorIds: selectedVendorIds,
      updatedAt: nowISO()
    }).then(function() { showToast('Hunt config saved!'); }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  // ============================================================
  // Ads Tab
  // ============================================================

  function renderAdsTab(showId) {
    var container = document.getElementById('evTabContent');
    if (!container) return;

    var html = '<h3 style="margin:0 0 16px;font-size:1rem;">Ad Economy</h3>';

    html += '<div class="ev-card">';
    html += '<h4 style="font-size:0.9rem;margin:0 0 12px;">Ad Configuration</h4>';
    html += '<div class="ev-form-group ev-form-row ev-form-row-3">';
    html += '<div><label class="ev-form-label">Tokens per Coin</label><input class="ev-form-input" type="number" id="evAd_rate" value="100" min="1"></div>';
    html += '<div><label class="ev-form-label">Min Coin Purchase</label><input class="ev-form-input" type="number" id="evAd_min" value="10" min="1"></div>';
    html += '<div><label class="ev-form-label">Max Coin Purchase</label><input class="ev-form-input" type="number" id="evAd_max" value="100" min="1"></div>';
    html += '</div>';
    html += '<div style="margin-top:8px;"><button class="btn btn-small btn-primary" onclick="evSaveAdConfig(\'' + esc(showId) + '\')">Save</button></div>';
    html += '</div>';

    var walletList = [];
    for (var wid in walletsData) {
      var w = walletsData[wid];
      var wname = vendorsData[wid] ? vendorsData[wid].businessName : wid;
      walletList.push({ id: wid, name: wname, coins: w.coins || 0, tokens: w.tokens || 0 });
    }

    if (walletList.length > 0) {
      html += '<div class="ev-card"><h4 style="font-size:0.9rem;margin:0 0 12px;">Vendor Wallets</h4>';
      html += '<div class="events-table"><table><thead><tr><th>Vendor</th><th>Coins</th><th>Tokens</th></tr></thead><tbody>';
      for (var wi = 0; wi < walletList.length; wi++) {
        html += '<tr><td>' + esc(walletList[wi].name) + '</td><td style="color:var(--gold);">' + walletList[wi].coins + '</td><td style="color:#8b5cf6;">' + walletList[wi].tokens + '</td></tr>';
      }
      html += '</tbody></table></div></div>';
    }

    var adList = objToList(adsData);
    if (adList.length > 0) {
      html += '<div class="ev-card"><h4 style="font-size:0.9rem;margin:0 0 12px;">Active Ads (' + adList.length + ')</h4>';
      html += '<div class="events-table"><table><thead><tr><th>Vendor</th><th>Headline</th><th>Type</th><th>Tokens</th><th>Status</th></tr></thead><tbody>';
      for (var ai = 0; ai < adList.length; ai++) {
        var ad = adList[ai];
        var adVendor = vendorsData[ad.vendorId] ? vendorsData[ad.vendorId].businessName : ad.vendorId;
        html += '<tr><td>' + esc(adVendor) + '</td><td>' + esc(ad.headline || '') + '</td><td>' + evBadgeHtml(ad.type || 'general') + '</td>';
        html += '<td>' + (ad.tokensRemaining || 0) + '/' + (ad.tokensCommitted || 0) + '</td>';
        html += '<td>' + evBadgeHtml(ad.active ? 'active' : 'draft') + '</td></tr>';
      }
      html += '</tbody></table></div></div>';
    } else {
      html += '<div class="ev-card"><p style="color:var(--warm-gray);font-size:0.85rem;">No ads yet. Vendors manage ads through their vendor portal.</p></div>';
    }

    container.innerHTML = html;

    DB.showAdConfig.get(showId).then(function(snap) {
      var config = snap.val();
      if (config) {
        if (config.coinToTokenRate) { var r = document.getElementById('evAd_rate'); if (r) r.value = config.coinToTokenRate; }
        if (config.minCoinPurchase) { var mn = document.getElementById('evAd_min'); if (mn) mn.value = config.minCoinPurchase; }
        if (config.maxCoinPurchase) { var mx = document.getElementById('evAd_max'); if (mx) mx.value = config.maxCoinPurchase; }
      }
    });
  }

  function saveAdConfig(showId) {
    DB.showAdConfig.set(showId, {
      coinToTokenRate: parseInt(document.getElementById('evAd_rate').value) || 100,
      minCoinPurchase: parseInt(document.getElementById('evAd_min').value) || 10,
      maxCoinPurchase: parseInt(document.getElementById('evAd_max').value) || 100,
      updatedAt: nowISO()
    }).then(function() { showToast('Ad config saved!'); }).catch(function(err) { showToast('Error: ' + err.message, true); });
  }

  // ============================================================
  // Settings View
  // ============================================================

  function renderSettings() {
    var container = document.getElementById('eventsAdminTab');
    if (!container) return;

    var html = '<button class="detail-back" onclick="evNavigateTo(\'shows-list\')">← Back to Shows</button>';
    html += '<div class="ev-page-header"><h2 style="margin:0;font-size:1.15rem;">Events Settings</h2>';
    html += '</div>';

    html += '<div class="ev-card">';
    html += '<h3 style="display:flex;align-items:center;gap:8px;"><span style="font-size:1.15rem;">&#128179;</span> Payment Processing</h3>';
    html += '<div id="evPaymentProcessorStatus" style="margin-bottom:12px;"><span style="color:var(--warm-gray);font-size:0.85rem;">Detecting payment processor...</span></div>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Booth fees and vendor coin purchases route through your configured payment processor. Configure it in your main admin settings.</p>';
    html += '<button class="btn btn-small btn-secondary" onclick="navigateTo(\'settings\')">Open Admin Settings</button>';
    html += '</div>';

    html += '<div class="ev-card">';
    html += '<h3 style="display:flex;align-items:center;gap:8px;"><span style="font-size:1.15rem;">&#9881;</span> Events Defaults</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);">Default settings for new shows. These can be overridden per show.</p>';
    html += '<div style="margin-top:16px;color:var(--warm-gray);font-size:0.85rem;font-style:italic;">Coming soon — default booth types, pricing, vendor categories, and email templates.</div>';
    html += '</div>';

    container.innerHTML = html;
    detectPaymentProcessor();
  }

  function detectPaymentProcessor() {
    var el = document.getElementById('evPaymentProcessorStatus');
    if (!el) return;
    DB.ref('config/paymentProcessor').once('value').then(function(snap) {
      var processor = snap.val();
      if (processor) { renderProcessorBadge(el, processor); return; }
      return DB.ref('config/square/environment').once('value');
    }).then(function(sqSnap) {
      if (!sqSnap) return;
      renderProcessorBadge(el, sqSnap.val() ? 'square' : null);
    }).catch(function() { renderProcessorBadge(el, null); });
  }

  function renderProcessorBadge(el, processor) {
    if (processor === 'square') {
      el.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;background:rgba(0,157,224,0.12);border:1px solid rgba(0,157,224,0.3);font-size:0.85rem;font-weight:600;color:#009de0;">&#9679; Square</span>';
    } else if (processor === 'stripe') {
      el.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;background:rgba(99,91,255,0.12);border:1px solid rgba(99,91,255,0.3);font-size:0.85rem;font-weight:600;color:#635bff;">&#9679; Stripe</span>';
    } else {
      el.innerHTML = '<div style="padding:10px 14px;border-radius:6px;background:rgba(255,160,0,0.12);border:1px solid rgba(255,160,0,0.3);">' +
        '<div style="font-size:0.85rem;font-weight:600;color:#ffa000;">&#9888; No payment processor configured</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Set up Square or Stripe in admin settings.</div>' +
      '</div>';
    }
  }

  // ============================================================
  // Export public functions to window (for onclick handlers)
  // ============================================================

  window.evNavigateTo = evNavigateTo;
  window.evSwitchDetailTab = evSwitchDetailTab;
  window.evOpenCreateShowModal = openCreateShowModal;
  window.evSubmitCreateShow = submitCreateShow;
  window.evOpenEditShowModal = openEditShowModal;
  window.evSubmitEditShow = submitEditShow;
  window.evUpdateShowStatus = updateShowStatus;
  window.evDeleteShow = deleteShow;
  window.evOpenAddBoothModal = openAddBoothModal;
  window.evOpenEditBoothModal = openEditBoothModal;
  window.evSubmitBoothForm = submitBoothForm;
  window.evDeleteBooth = deleteBooth;
  window.evOpenBulkAddBoothsModal = openBulkAddBoothsModal;
  window.evSubmitBulkAddBooths = submitBulkAddBooths;
  window.evUploadFloorPlan = uploadFloorPlan;
  window.evRemoveFloorPlan = removeFloorPlan;
  window.evClearAllPins = clearAllPins;
  window.evDetectBooths = detectBooths;
  window.evStartPinPlacement = startPinPlacement;
  window.evCancelPinPlacement = cancelPinPlacement;
  window.evOnFloorPlanClick = onFloorPlanClick;
  window.evRemovePin = removePin;
  window.evOnFloorPlanImgLoad = onFloorPlanImgLoad;
  window.evOpenVendorModal = openVendorModal;
  window.evSubmitVendorForm = submitVendorForm;
  window.evUpdateVendorStatus = updateVendorStatus;
  window.evDeleteVendor = deleteVendor;
  window.evSendVendorInvite = sendVendorInvite;
  window.evReviewSubmission = reviewSubmission;
  window.evSendSubmissionNotifications = sendSubmissionNotifications;
  window.evSendAnnouncement = sendAnnouncement;
  window.evSaveHuntConfig = saveHuntConfig;
  window.evOnHuntModeChange = onHuntModeChange;
  window.evSaveAdConfig = saveAdConfig;
  window.evCloseModal = evCloseModal;
  window.evSetCheckinFilter = setCheckinFilter;
  window.evToggleCheckin = toggleCheckin;
  window.evMarkNoShow = markNoShow;
  window.evOpenSubmissionConfig = openSubmissionConfigModal;
  window.evSubmitSubConfig = submitSubConfig;
  window.evCloseSubmissions = closeSubmissions;
  window.evOpenImageViewer = openImageViewer;
  window.evImageViewerNav = imageViewerNav;
  window.evCopyShowUrl = copyShowUrl;
  window.evDownloadShowQR = downloadShowQR;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('eventsAdmin', {
    routes: {
      'events-shows': { tab: 'eventsAdminTab', setup: function() { renderEventsAdmin(); } },
      'events-settings': { tab: 'eventsAdminTab', setup: function() { currentView = 'settings'; renderSettings(); } }
    },
    attachListeners: function() {
      loadShows();
    },
    detachListeners: function() {
      if (showsListener) { DB.shows.unlisten(showsListener); showsListener = null; }
      detachDetailListeners();
      showsData = {};
      showsLoaded = false;
      selectedShowId = null;
      currentView = 'shows-list';
      activeDetailTab = 'overview';
    }
  });

})();
