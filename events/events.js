// ============================================================
// Globals
// ============================================================
var firebaseApp, db, auth, storage, currentUser;
var TENANT_ID_LOCAL = null;
var FUNCTIONS_BASE = 'https://us-central1-mast-platform-prod.cloudfunctions.net';

// Helper: authenticated Cloud Function call
async function callFunction(fnName, body) {
  if (!currentUser) throw new Error('Not authenticated');
  var token = await currentUser.getIdToken();
  var res = await fetch(FUNCTIONS_BASE + '/' + fnName, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'X-Tenant-ID': TENANT_ID_LOCAL
    },
    body: JSON.stringify(body)
  });
  var data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Function call failed');
  return data;
}

// ============================================================
// Utility Functions
// ============================================================

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function showToast(msg, isError) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(function() { el.className = ''; }, 4000);
}

function nowISO() { return new Date().toISOString(); }

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(cents) {
  if (!cents && cents !== 0) return '$0.00';
  return '$' + (cents / 100).toFixed(2);
}

function generateSlug(name) {
  var base = name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return base + '-' + Date.now().toString(36).slice(-4);
}

function statusColor(status) {
  var map = { draft: '#888', published: '#3b82f6', active: '#10b981', completed: '#8b5cf6', cancelled: '#ef4444', open: '#10b981', reserved: '#f59e0b', confirmed: '#10b981', pending: '#f59e0b', paid: '#10b981', waived: '#8b5cf6', 'no-show': '#ef4444', invited: '#3b82f6', free: '#10b981', declined: '#ef4444', accepted: '#10b981', reviewed: '#3b82f6' };
  return map[status] || '#888';
}

function statusBg(status) {
  var c = statusColor(status);
  // Convert hex to rgba
  var r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
  return 'rgba(' + r + ',' + g + ',' + b + ',0.15)';
}

function badgeHtml(status) {
  return '<span class="badge" style="background:' + statusBg(status) + ';color:' + statusColor(status) + ';">' + esc(status) + '</span>';
}

function closeModal(id) {
  var m = document.getElementById(id);
  if (m) m.remove();
}

// ============================================================
// Data Layer (MastDB equivalent for standalone module)
// ============================================================

var DB = {
  _tenantId: null,
  _db: null,
  init: function(tenantId, database) { this._tenantId = tenantId; this._db = database; },
  ref: function(path) { return this._db.ref(this._tenantId + '/' + path); },
  rootRef: function() { return this._db.ref(); },
  newKey: function(path) { return this.ref(path).push().key; },
  storagePath: function(sub) { return this._tenantId + '/' + sub; },

  // Entity helpers
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
    unlisten: function(showId, h) { this.ref(showId).off('value', h); }
  }
};

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
// State
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
var currentView = 'shows-list'; // shows-list | show-detail
var activeDetailTab = 'overview';
var floorPlanState = { placingBoothId: null, imgLoaded: false };

// ============================================================
// Firebase Init & Auth
// ============================================================

window.TENANT_READY.then(function() {
  TENANT_ID_LOCAL = TENANT_ID;
  firebaseApp = firebase.initializeApp(TENANT_FIREBASE_CONFIG, 'events-app');
  db = firebaseApp.database();
  auth = firebaseApp.auth();
  try { storage = firebaseApp.storage(); } catch(e) { storage = null; }

  DB.init(TENANT_ID_LOCAL, db);

  auth.onAuthStateChanged(function(user) {
    document.getElementById('loadingScreen').style.display = 'none';
    if (user) {
      currentUser = user;
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('appContent').style.display = 'block';
      document.getElementById('userEmail').textContent = user.email || '';
      loadShows();
    } else {
      currentUser = null;
      document.getElementById('authScreen').style.display = 'flex';
      document.getElementById('appContent').style.display = 'none';
    }
  });
}).catch(function(err) {
  document.getElementById('loadingScreen').innerHTML =
    '<div style="text-align:center;"><h2>Unable to load</h2><p style="color:var(--text-secondary);">' + esc(err.message) + '</p></div>';
});

function signIn() {
  var provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(function(err) {
    showToast('Sign in failed: ' + err.message, true);
  });
}

function signOut() {
  auth.signOut();
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
// Navigation
// ============================================================

function navigateTo(view, showId) {
  if (view === 'shows-list') {
    currentView = 'shows-list';
    selectedShowId = null;
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
    renderSettings();
  }
}

function switchDetailTab(showId, tab) {
  activeDetailTab = tab;
  document.querySelectorAll('.tab-btn').forEach(function(el) {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  // Lazy-load data for tabs that need it
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
    case 'announcements': renderAnnouncementsTab(showId); break;
    case 'hunt': renderHuntTab(showId); break;
    case 'ads': renderAdsTab(showId); break;
  }
}

// ============================================================
// Shows Dashboard
// ============================================================

function renderShowsDashboard() {
  var title = document.getElementById('pageTitle');
  var actions = document.getElementById('pageActions');
  var content = document.getElementById('pageContent');
  title.textContent = 'Shows';
  actions.innerHTML = '<button class="btn btn-secondary btn-sm" onclick="navigateTo(\'settings\')" style="margin-right:8px;">&#9881; Settings</button>' +
    '<button class="btn btn-primary btn-sm" onclick="openCreateShowModal()">+ New Show</button>';

  var shows = [];
  for (var id in showsData) shows.push(Object.assign({ id: id }, showsData[id]));
  shows.sort(function(a, b) { return (b.startDate || '').localeCompare(a.startDate || ''); });

  if (shows.length === 0) {
    content.innerHTML =
      '<div style="text-align:center;padding:60px 20px;color:var(--text-secondary);">' +
        '<div style="font-size:2.5rem;margin-bottom:12px;">&#127914;</div>' +
        '<p style="font-size:1.1rem;font-weight:600;margin-bottom:4px;">No shows yet</p>' +
        '<p style="font-size:0.85rem;">Create your first show to get started.</p>' +
        '<button class="btn btn-primary" onclick="openCreateShowModal()" style="margin-top:16px;">Create Show</button>' +
      '</div>';
    return;
  }

  var upcoming = shows.filter(function(s) { return s.status !== 'completed' && s.status !== 'cancelled'; });
  var past = shows.filter(function(s) { return s.status === 'completed' || s.status === 'cancelled'; });

  var html = '';
  if (upcoming.length > 0) {
    html += '<h3 style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);margin-bottom:12px;">Upcoming &amp; Active</h3>';
    html += '<div class="show-grid" style="margin-bottom:24px;">';
    for (var i = 0; i < upcoming.length; i++) html += showCardHtml(upcoming[i]);
    html += '</div>';
  }
  if (past.length > 0) {
    html += '<h3 style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);margin-bottom:12px;">Past</h3>';
    html += '<div class="show-grid">';
    for (var j = 0; j < past.length; j++) html += showCardHtml(past[j]);
    html += '</div>';
  }
  content.innerHTML = html;
}

function showCardHtml(show) {
  var dateStr = '';
  if (show.startDate) {
    dateStr = formatDate(show.startDate);
    if (show.endDate && show.endDate !== show.startDate) dateStr += ' — ' + formatDate(show.endDate);
  }
  return '<div class="show-card" onclick="navigateTo(\'show-detail\', \'' + esc(show.id) + '\')">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">' +
      '<h3 style="font-size:1rem;font-weight:600;margin:0;">' + esc(show.name) + '</h3>' +
      badgeHtml(show.status) +
    '</div>' +
    (show.venue ? '<p style="font-size:0.85rem;color:var(--text-secondary);margin:0 0 4px;">&#128205; ' + esc(show.venue) + '</p>' : '') +
    (dateStr ? '<p style="font-size:0.8rem;color:var(--text-secondary);margin:0;">&#128197; ' + dateStr + '</p>' : '') +
  '</div>';
}

// ============================================================
// Create Show Modal
// ============================================================

function openCreateShowModal() {
  var overlay = document.createElement('div');
  overlay.id = 'showModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box">' +
      '<h3>Create New Show</h3>' +
      '<form id="showForm" onsubmit="submitCreateShow(event)">' +
        '<div class="form-group"><label class="form-label">Show Name *</label><input class="form-input" type="text" id="sf_name" required placeholder="e.g. Spring Artisan Market 2026"></div>' +
        '<div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="sf_desc" rows="3" placeholder="Brief description..."></textarea></div>' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">Venue</label><input class="form-input" type="text" id="sf_venue" placeholder="Convention Center"></div>' +
          '<div><label class="form-label">Address</label><input class="form-input" type="text" id="sf_address" placeholder="123 Main St"></div>' +
        '</div>' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">City</label><input class="form-input" type="text" id="sf_city"></div>' +
          '<div><label class="form-label">State</label><input class="form-input" type="text" id="sf_state"></div>' +
        '</div>' +
        '<div class="form-group form-row form-row-3">' +
          '<div><label class="form-label">Start Date *</label><input class="form-input" type="date" id="sf_startDate" required></div>' +
          '<div><label class="form-label">End Date</label><input class="form-input" type="date" id="sf_endDate"></div>' +
          '<div><label class="form-label">Setup Time</label><input class="form-input" type="text" id="sf_setupTime" placeholder="7:00 AM"></div>' +
        '</div>' +
        '<div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal(\'showModal\')">Cancel</button><button type="submit" class="btn btn-primary">Create Show</button></div>' +
      '</form>' +
    '</div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal('showModal'); });
  document.body.appendChild(overlay);
}

async function submitCreateShow(e) {
  e.preventDefault();
  var name = document.getElementById('sf_name').value.trim();
  if (!name) return;
  var showId = DB.shows.newKey();
  var slug = generateSlug(name);
  var now = nowISO();
  var data = {
    createdBy: currentUser.uid, name: name,
    description: document.getElementById('sf_desc').value.trim(),
    venue: document.getElementById('sf_venue').value.trim(),
    address: document.getElementById('sf_address').value.trim(),
    city: document.getElementById('sf_city').value.trim(),
    state: document.getElementById('sf_state').value.trim(),
    startDate: document.getElementById('sf_startDate').value,
    endDate: document.getElementById('sf_endDate').value,
    setupTime: document.getElementById('sf_setupTime').value.trim(),
    status: 'draft', slug: slug, createdAt: now, updatedAt: now
  };
  try {
    await DB.shows.set(showId, data);
    await DB.showsBySlug.set(slug, showId);
    showToast('Show created!');
    closeModal('showModal');
    navigateTo('show-detail', showId);
  } catch (err) { showToast('Error: ' + err.message, true); }
}

// ============================================================
// Show Detail View
// ============================================================

function renderShowDetail(showId) {
  var show = showsData[showId];
  if (!show) {
    document.getElementById('pageContent').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">Show not found.</div>';
    return;
  }

  var title = document.getElementById('pageTitle');
  var actions = document.getElementById('pageActions');
  title.innerHTML = '<span onclick="navigateTo(\'shows-list\')" style="cursor:pointer;color:var(--text-secondary);margin-right:8px;">&larr;</span> ' + esc(show.name);
  actions.innerHTML = badgeHtml(show.status);

  var boothCount = Object.keys(boothsData).length;
  var vendorCount = Object.keys(vendorsData).length;
  var subCount = Object.keys(submissionsData).length;

  var tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'booths', label: 'Booths (' + boothCount + ')' },
    { key: 'vendors', label: 'Vendors (' + vendorCount + ')' },
    { key: 'floorplan', label: 'Floor Plan' },
    { key: 'submissions', label: 'Submissions (' + subCount + ')' },
    { key: 'announcements', label: 'Announcements' },
    { key: 'hunt', label: 'Hunt' },
    { key: 'ads', label: 'Ads' }
  ];

  var content = document.getElementById('pageContent');
  var html = '<div class="tab-bar">';
  for (var t = 0; t < tabs.length; t++) {
    html += '<button class="tab-btn' + (tabs[t].key === activeDetailTab ? ' active' : '') + '" data-tab="' + tabs[t].key + '" onclick="switchDetailTab(\'' + esc(showId) + '\', \'' + tabs[t].key + '\')">' + tabs[t].label + '</button>';
  }
  html += '</div><div id="tabContent"></div>';
  content.innerHTML = html;
  renderTabContent(showId, activeDetailTab);
}

// ============================================================
// Overview Tab
// ============================================================

function renderOverviewTab(showId) {
  var show = showsData[showId];
  if (!show) return;
  var boothsList = objToList(boothsData);
  var filledBooths = boothsList.filter(function(b) { return b.vendorId; });
  var container = document.getElementById('tabContent');

  var html = '<div class="detail-grid"><div>';
  // Stats
  html += '<div class="stats-grid">';
  html += '<div class="stat-card"><div class="stat-label">Booths</div><div class="stat-value">' + filledBooths.length + '/' + boothsList.length + '</div><div class="stat-sub">filled</div></div>';
  html += '<div class="stat-card"><div class="stat-label">Vendors</div><div class="stat-value">' + Object.keys(vendorsData).length + '</div></div>';
  html += '<div class="stat-card"><div class="stat-label">Status</div><div class="stat-value" style="text-transform:capitalize;">' + esc(show.status) + '</div></div>';
  html += '<div class="stat-card"><div class="stat-label">Slug</div><div class="stat-value" style="font-size:0.85rem;word-break:break-all;">' + esc(show.slug || '—') + '</div></div>';
  html += '</div>';

  // Details card
  html += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;"><h3 style="margin:0;">Show Details</h3><button class="btn-link" onclick="openEditShowModal(\'' + esc(showId) + '\')">Edit</button></div>';
  if (show.description) html += '<p style="font-size:0.9rem;margin:0 0 8px;">' + esc(show.description) + '</p>';
  if (show.venue) html += '<p style="font-size:0.85rem;color:var(--text-secondary);margin:0 0 4px;">&#128205; ' + esc(show.venue) + (show.address ? ', ' + esc(show.address) : '') + (show.city ? ', ' + esc(show.city) : '') + (show.state ? ' ' + esc(show.state) : '') + '</p>';
  if (show.startDate) {
    var dt = formatDate(show.startDate);
    if (show.endDate && show.endDate !== show.startDate) dt += ' — ' + formatDate(show.endDate);
    html += '<p style="font-size:0.85rem;color:var(--text-secondary);margin:0 0 4px;">&#128197; ' + dt + '</p>';
  }
  if (show.setupTime) html += '<p style="font-size:0.85rem;color:var(--text-secondary);margin:0;">&#128336; Setup: ' + esc(show.setupTime) + '</p>';
  html += '</div></div>';

  // Right column
  html += '<div>';
  // Status
  html += '<div class="card"><h3>Status</h3><select class="form-select" onchange="updateShowStatus(\'' + esc(showId) + '\', this.value)">';
  for (var si = 0; si < SHOW_STATUSES.length; si++) {
    var st = SHOW_STATUSES[si];
    html += '<option value="' + st + '"' + (st === show.status ? ' selected' : '') + '>' + st.charAt(0).toUpperCase() + st.slice(1) + '</option>';
  }
  html += '</select></div>';

  if (show.slug) {
    html += '<div class="card"><h3>Show URL</h3><p style="font-size:0.8rem;color:var(--text-secondary);word-break:break-all;">Slug: <strong>' + esc(show.slug) + '</strong></p><p style="font-size:0.75rem;color:var(--text-secondary);margin-top:8px;">Attendee page: /show/' + esc(show.slug) + '</p></div>';
  }
  html += '<button class="btn btn-danger" style="width:100%;" onclick="deleteShow(\'' + esc(showId) + '\')">Delete Show</button>';
  html += '</div></div>';
  container.innerHTML = html;
}

async function updateShowStatus(showId, status) {
  try {
    await DB.shows.update(showId, { status: status, updatedAt: nowISO() });
    showToast('Status updated to ' + status);

    // Sync slug to platform index when publishing
    if (status === 'published' || status === 'active') {
      try {
        await callFunction('eventsSyncShowSlug', { showId: showId });
        showToast('Slug synced to platform');
      } catch (err) {
        showToast('Status updated but slug sync failed: ' + err.message, true);
      }
    }
  } catch (err) { showToast('Error: ' + err.message, true); }
}

async function deleteShow(showId) {
  if (!confirm('Delete this show and all its data? This cannot be undone.')) return;
  var show = showsData[showId];
  try {
    await DB.shows.remove(showId);
    if (show && show.slug) await DB.showsBySlug.remove(show.slug);
    await DB.booths.ref(showId).remove();
    await DB.boothPins.remove(showId);
    await DB.vendors.ref(showId).remove();
    await DB.submissions.ref(showId).remove();
    await DB.announcements.ref(showId).remove();
    showToast('Show deleted');
    navigateTo('shows-list');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

// ============================================================
// Edit Show Modal
// ============================================================

function openEditShowModal(showId) {
  var show = showsData[showId];
  if (!show) return;
  var overlay = document.createElement('div');
  overlay.id = 'showModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box">' +
      '<h3>Edit Show</h3>' +
      '<form onsubmit="submitEditShow(event, \'' + esc(showId) + '\')">' +
        '<div class="form-group"><label class="form-label">Show Name *</label><input class="form-input" type="text" id="sf_name" required value="' + esc(show.name || '') + '"></div>' +
        '<div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="sf_desc" rows="3">' + esc(show.description || '') + '</textarea></div>' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">Venue</label><input class="form-input" type="text" id="sf_venue" value="' + esc(show.venue || '') + '"></div>' +
          '<div><label class="form-label">Address</label><input class="form-input" type="text" id="sf_address" value="' + esc(show.address || '') + '"></div>' +
        '</div>' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">City</label><input class="form-input" type="text" id="sf_city" value="' + esc(show.city || '') + '"></div>' +
          '<div><label class="form-label">State</label><input class="form-input" type="text" id="sf_state" value="' + esc(show.state || '') + '"></div>' +
        '</div>' +
        '<div class="form-group form-row form-row-3">' +
          '<div><label class="form-label">Start Date *</label><input class="form-input" type="date" id="sf_startDate" required value="' + esc(show.startDate || '') + '"></div>' +
          '<div><label class="form-label">End Date</label><input class="form-input" type="date" id="sf_endDate" value="' + esc(show.endDate || '') + '"></div>' +
          '<div><label class="form-label">Setup Time</label><input class="form-input" type="text" id="sf_setupTime" value="' + esc(show.setupTime || '') + '"></div>' +
        '</div>' +
        '<div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal(\'showModal\')">Cancel</button><button type="submit" class="btn btn-primary">Save Changes</button></div>' +
      '</form>' +
    '</div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal('showModal'); });
  document.body.appendChild(overlay);
}

async function submitEditShow(e, showId) {
  e.preventDefault();
  var name = document.getElementById('sf_name').value.trim();
  if (!name) return;
  var show = showsData[showId];
  var updates = {
    name: name,
    description: document.getElementById('sf_desc').value.trim(),
    venue: document.getElementById('sf_venue').value.trim(),
    address: document.getElementById('sf_address').value.trim(),
    city: document.getElementById('sf_city').value.trim(),
    state: document.getElementById('sf_state').value.trim(),
    startDate: document.getElementById('sf_startDate').value,
    endDate: document.getElementById('sf_endDate').value,
    setupTime: document.getElementById('sf_setupTime').value.trim(),
    updatedAt: nowISO()
  };
  try {
    if (show && name !== show.name) {
      var newSlug = generateSlug(name);
      if (show.slug) await DB.showsBySlug.remove(show.slug);
      await DB.showsBySlug.set(newSlug, showId);
      updates.slug = newSlug;
    }
    await DB.shows.update(showId, updates);
    showToast('Show updated!');
    closeModal('showModal');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

// ============================================================
// Booths Tab
// ============================================================

function renderBoothsTab(showId) {
  var container = document.getElementById('tabContent');
  var boothsList = objToList(boothsData);
  boothsList.sort(function(a, b) { return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }); });

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
  html += '<h3 style="margin:0;font-size:1rem;">Booths</h3>';
  html += '<div style="display:flex;gap:8px;"><button class="btn btn-secondary btn-sm" onclick="openBulkAddBoothsModal(\'' + esc(showId) + '\')">Bulk Add</button><button class="btn btn-primary btn-sm" onclick="openAddBoothModal(\'' + esc(showId) + '\')">+ Add Booth</button></div></div>';

  if (boothsList.length === 0) {
    html += '<div style="text-align:center;padding:40px;color:var(--text-secondary);">No booths yet. Add booths to start managing your show layout.</div>';
  } else {
    html += '<div class="events-table"><table><thead><tr><th>Name</th><th>Size</th><th>Type</th><th>Price</th><th>Location</th><th>Status</th><th></th></tr></thead><tbody>';
    for (var i = 0; i < boothsList.length; i++) {
      var b = boothsList[i];
      html += '<tr><td style="font-weight:600;">' + esc(b.name || '') + '</td><td>' + esc(b.size || '') + '</td><td>' + badgeHtml(b.type || 'standard') + '</td><td>' + formatCurrency(b.price || 0) + '</td><td style="color:var(--text-secondary);">' + esc(b.location || '—') + '</td><td>' + badgeHtml(b.status || 'open') + '</td>' +
        '<td style="text-align:right;"><button class="btn-link" onclick="openEditBoothModal(\'' + esc(showId) + '\', \'' + esc(b.id) + '\')">Edit</button> <button class="btn-link" style="color:var(--red);" onclick="deleteBooth(\'' + esc(showId) + '\', \'' + esc(b.id) + '\')">Del</button></td></tr>';
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
  overlay.id = 'boothModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box">' +
      '<h3>' + esc(title) + '</h3>' +
      '<form onsubmit="submitBoothForm(event, \'' + esc(showId) + '\', ' + (isEdit ? '\'' + esc(booth.id) + '\'' : 'null') + ')">' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">Booth Name *</label><input class="form-input" type="text" id="bf_name" required value="' + esc(isEdit ? booth.name || '' : '') + '" placeholder="e.g. A1"></div>' +
          '<div><label class="form-label">Size</label><input class="form-input" type="text" id="bf_size" value="' + esc(isEdit ? booth.size || '' : '10x10') + '"></div>' +
        '</div>' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">Type</label><select class="form-select" id="bf_type">' + BOOTH_TYPES.map(function(t) { return '<option value="' + t.value + '"' + (isEdit && booth.type === t.value ? ' selected' : '') + '>' + t.label + '</option>'; }).join('') + '</select></div>' +
          '<div><label class="form-label">Price ($)</label><input class="form-input" type="number" step="0.01" id="bf_price" value="' + priceDisplay + '" placeholder="0.00"></div>' +
        '</div>' +
        '<div class="form-group"><label class="form-label">Location</label><input class="form-input" type="text" id="bf_location" value="' + esc(isEdit ? booth.location || '' : '') + '" placeholder="e.g. Main Hall, north wall"></div>' +
        '<div class="form-group"><label class="form-label">Provided (comma-separated)</label><input class="form-input" type="text" id="bf_provided" value="' + esc(isEdit && booth.provided ? booth.provided.join(', ') : '') + '" placeholder="table, 2 chairs, electricity"></div>' +
        '<div class="form-group"><label class="form-label">Required (comma-separated)</label><input class="form-input" type="text" id="bf_required" value="' + esc(isEdit && booth.required ? booth.required.join(', ') : '') + '" placeholder="tent, insurance certificate"></div>' +
        '<div class="form-group"><label class="form-label">Notes</label><textarea class="form-textarea" id="bf_notes" rows="2">' + esc(isEdit ? booth.notes || '' : '') + '</textarea></div>' +
        '<div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal(\'boothModal\')">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>' +
      '</form>' +
    '</div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal('boothModal'); });
  document.body.appendChild(overlay);
}

async function submitBoothForm(e, showId, boothId) {
  e.preventDefault();
  var data = {
    name: document.getElementById('bf_name').value.trim(),
    size: document.getElementById('bf_size').value.trim(),
    type: document.getElementById('bf_type').value,
    price: Math.round(parseFloat(document.getElementById('bf_price').value) * 100) || 0,
    location: document.getElementById('bf_location').value.trim(),
    provided: document.getElementById('bf_provided').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    required: document.getElementById('bf_required').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    notes: document.getElementById('bf_notes').value.trim()
  };
  if (!data.name) return;
  try {
    if (boothId) {
      await DB.booths.update(showId, boothId, data);
      showToast('Booth updated!');
    } else {
      var newId = DB.booths.newKey(showId);
      data.showId = showId; data.status = 'open'; data.vendorId = null; data.assignedAt = null; data.createdAt = nowISO();
      await DB.booths.set(showId, newId, data);
      showToast('Booth added!');
    }
    closeModal('boothModal');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

async function deleteBooth(showId, boothId) {
  if (!confirm('Delete this booth?')) return;
  try {
    await DB.booths.remove(showId, boothId);
    await DB.boothPins.remove(showId, boothId);
    showToast('Booth deleted');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

function openBulkAddBoothsModal(showId) {
  var overlay = document.createElement('div');
  overlay.id = 'boothModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box">' +
      '<h3>Bulk Add Booths</h3>' +
      '<form onsubmit="submitBulkAddBooths(event, \'' + esc(showId) + '\')">' +
        '<div class="form-group"><label class="form-label">Number of Booths *</label><input class="form-input" type="number" id="bbf_count" min="1" max="200" value="10" required></div>' +
        '<div class="form-group"><label class="form-label">Name Prefix</label><input class="form-input" type="text" id="bbf_prefix" value="Booth "></div>' +
        '<div class="form-group form-row form-row-3">' +
          '<div><label class="form-label">Size</label><input class="form-input" type="text" id="bbf_size" value="10x10"></div>' +
          '<div><label class="form-label">Type</label><select class="form-select" id="bbf_type">' + BOOTH_TYPES.map(function(t) { return '<option value="' + t.value + '">' + t.label + '</option>'; }).join('') + '</select></div>' +
          '<div><label class="form-label">Price ($)</label><input class="form-input" type="number" step="0.01" id="bbf_price" value="0"></div>' +
        '</div>' +
        '<div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal(\'boothModal\')">Cancel</button><button type="submit" class="btn btn-primary">Add Booths</button></div>' +
      '</form>' +
    '</div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal('boothModal'); });
  document.body.appendChild(overlay);
}

async function submitBulkAddBooths(e, showId) {
  e.preventDefault();
  var count = parseInt(document.getElementById('bbf_count').value) || 1;
  var prefix = document.getElementById('bbf_prefix').value || 'Booth ';
  var size = document.getElementById('bbf_size').value || '10x10';
  var type = document.getElementById('bbf_type').value || 'standard';
  var price = Math.round(parseFloat(document.getElementById('bbf_price').value) * 100) || 0;
  var now = nowISO();
  try {
    var updates = {};
    for (var i = 0; i < count; i++) {
      var bid = DB.booths.newKey(showId);
      updates[bid] = { showId: showId, name: prefix + (i + 1), size: size, type: type, location: '', price: price, provided: [], required: [], notes: '', status: 'open', vendorId: null, assignedAt: null, createdAt: now };
    }
    await DB.booths.ref(showId).update(updates);
    showToast(count + ' booths added!');
    closeModal('boothModal');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

// ============================================================
// Floor Plan Tab
// ============================================================

function renderFloorPlanTab(showId) {
  var show = showsData[showId];
  if (!show) return;
  var container = document.getElementById('tabContent');
  var pins = boothPinsData;
  var boothsList = objToList(boothsData);

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h3 style="margin:0;font-size:1rem;">Floor Plan</h3>';
  if (show.floorPlanUrl) {
    html += '<div style="display:flex;gap:8px;">';
    html += '<label class="btn btn-secondary btn-sm" style="cursor:pointer;">Replace<input type="file" accept="image/*" onchange="uploadFloorPlan(event, \'' + esc(showId) + '\')" style="display:none;"></label>';
    html += '<button class="btn btn-sm" style="background:rgba(139,92,246,0.1);color:#8b5cf6;border:1px solid rgba(139,92,246,0.3);" onclick="detectBooths(\'' + esc(showId) + '\')">AI Detect</button>';
    if (Object.keys(pins).length > 0) html += '<button class="btn btn-sm" style="background:rgba(245,158,11,0.1);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);" onclick="clearAllPins(\'' + esc(showId) + '\')">Clear Pins</button>';
    html += '<button class="btn btn-danger btn-sm" onclick="removeFloorPlan(\'' + esc(showId) + '\')">Remove</button></div>';
  }
  html += '</div>';

  if (!show.floorPlanUrl) {
    html += '<div style="background:var(--card);border:2px dashed var(--border);border-radius:10px;padding:60px 20px;text-align:center;">' +
      '<div style="font-size:2.5rem;margin-bottom:12px;">&#128506;</div><p style="color:var(--text-secondary);margin-bottom:16px;">Upload a floor plan image to place booth markers.</p>' +
      '<label class="btn btn-primary" style="cursor:pointer;">Upload Floor Plan<input type="file" accept="image/*" onchange="uploadFloorPlan(event, \'' + esc(showId) + '\')" style="display:none;"></label>' +
      '<p style="font-size:0.75rem;color:var(--text-secondary);margin-top:12px;">PNG, JPG, or SVG up to 10MB</p></div>';
  } else {
    html += '<div id="fpPlaceBanner" style="display:none;background:var(--primary-bg);border:1px solid rgba(42,124,111,0.3);border-radius:8px;padding:10px 16px;margin-bottom:12px;font-size:0.85rem;align-items:center;justify-content:space-between;">' +
      '<span>Click on the floor plan to place <strong id="fpPlacingName"></strong></span>' +
      '<button onclick="cancelPinPlacement()" style="color:var(--text-secondary);background:none;border:none;cursor:pointer;">Cancel</button></div>';

    html += '<div class="floorplan-layout"><div id="fpContainer" class="card" style="overflow:hidden;">';
    html += '<img id="fpImg" src="' + esc(show.floorPlanUrl) + '" style="display:none;" onload="onFloorPlanImgLoad(\'' + esc(showId) + '\')">';
    html += '<canvas id="fpCanvas" style="width:100%;border-radius:8px;cursor:default;display:none;" onclick="onFloorPlanClick(event, \'' + esc(showId) + '\')"></canvas>';
    html += '<div id="fpLoading" style="text-align:center;padding:40px;"><div class="spinner"></div></div>';
    html += '</div><div>';

    var unpinned = boothsList.filter(function(b) { return !pins[b.id]; });
    var pinned = boothsList.filter(function(b) { return pins[b.id]; });
    if (unpinned.length > 0) {
      html += '<div class="card"><h4 style="font-size:0.8rem;text-transform:uppercase;color:var(--text-secondary);margin:0 0 10px;">Unplaced</h4>';
      for (var u = 0; u < unpinned.length; u++) html += '<button onclick="startPinPlacement(\'' + esc(showId) + '\', \'' + esc(unpinned[u].id) + '\', \'' + esc(unpinned[u].name) + '\')" style="display:block;width:100%;text-align:left;padding:6px 10px;font-size:0.85rem;background:none;border:none;border-radius:4px;cursor:pointer;color:var(--text);">' + esc(unpinned[u].name) + '</button>';
      html += '</div>';
    }
    if (pinned.length > 0) {
      html += '<div class="card"><h4 style="font-size:0.8rem;text-transform:uppercase;color:var(--text-secondary);margin:0 0 10px;">Placed</h4>';
      for (var p = 0; p < pinned.length; p++) html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 10px;font-size:0.85rem;"><button onclick="startPinPlacement(\'' + esc(showId) + '\', \'' + esc(pinned[p].id) + '\', \'' + esc(pinned[p].name) + '\')" style="background:none;border:none;cursor:pointer;color:var(--text);font-size:0.85rem;">' + esc(pinned[p].name) + '</button><button onclick="removePin(\'' + esc(showId) + '\', \'' + esc(pinned[p].id) + '\')" class="btn-link" style="color:var(--red);font-size:0.75rem;">Remove</button></div>';
      html += '</div>';
    }
    html += '</div></div>';
  }
  container.innerHTML = html;
  floorPlanState.placingBoothId = null;
  floorPlanState.imgLoaded = false;
}

async function uploadFloorPlan(e, showId) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please upload an image', true); return; }
  if (file.size > 10 * 1024 * 1024) { showToast('Image must be under 10MB', true); return; }
  try {
    var ext = file.name.split('.').pop();
    var path = DB.storagePath('events/floorplans/' + showId + '.' + ext);
    var ref = storage.ref(path);
    await ref.put(file);
    var url = await ref.getDownloadURL();
    await DB.shows.update(showId, { floorPlanUrl: url, updatedAt: nowISO() });
    showToast('Floor plan uploaded!');
  } catch (err) { showToast('Upload failed: ' + err.message, true); }
}

async function removeFloorPlan(showId) {
  if (!confirm('Remove floor plan and clear all pin placements?')) return;
  try {
    await DB.shows.update(showId, { floorPlanUrl: null, updatedAt: nowISO() });
    await DB.boothPins.remove(showId);
    showToast('Floor plan removed');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

async function clearAllPins(showId) {
  if (!confirm('Clear all pin placements?')) return;
  try { await DB.boothPins.remove(showId); showToast('All pins cleared'); }
  catch (err) { showToast('Error: ' + err.message, true); }
}

async function detectBooths(showId) {
  if (!confirm('Use AI to auto-detect booth positions from the floor plan? This will add new booths.')) return;
  showToast('Detecting booths...');
  try {
    var result = await callFunction('eventsDetectBooths', { showId: showId });
    showToast('Detected ' + (result.boothsCreated || 0) + ' booths');
  } catch (err) { showToast('Detection failed: ' + err.message, true); }
}

function startPinPlacement(showId, boothId, boothName) {
  floorPlanState.placingBoothId = boothId;
  var banner = document.getElementById('fpPlaceBanner');
  var nameEl = document.getElementById('fpPlacingName');
  if (banner) banner.style.display = 'flex';
  if (nameEl) nameEl.textContent = boothName;
  var canvas = document.getElementById('fpCanvas');
  if (canvas) canvas.style.cursor = 'crosshair';
}

function cancelPinPlacement() {
  floorPlanState.placingBoothId = null;
  var banner = document.getElementById('fpPlaceBanner');
  if (banner) banner.style.display = 'none';
  var canvas = document.getElementById('fpCanvas');
  if (canvas) canvas.style.cursor = 'default';
}

async function onFloorPlanClick(e, showId) {
  if (!floorPlanState.placingBoothId) return;
  var canvas = document.getElementById('fpCanvas');
  if (!canvas) return;
  var rect = canvas.getBoundingClientRect();
  var x = (e.clientX - rect.left) / rect.width;
  var y = (e.clientY - rect.top) / rect.height;
  var boothId = floorPlanState.placingBoothId;
  var booth = boothsData[boothId];
  try {
    await DB.boothPins.set(showId, boothId, { x: x, y: y });
    showToast('Pin placed for ' + (booth ? booth.name : 'booth'));
  } catch (err) { showToast('Error: ' + err.message, true); }
  cancelPinPlacement();
}

async function removePin(showId, boothId) {
  try { await DB.boothPins.remove(showId, boothId); showToast('Pin removed'); }
  catch (err) { showToast('Error: ' + err.message, true); }
}

function onFloorPlanImgLoad(showId) {
  floorPlanState.imgLoaded = true;
  drawFloorPlanCanvas(showId);
}

function drawFloorPlanCanvas(showId) {
  var img = document.getElementById('fpImg');
  var canvas = document.getElementById('fpCanvas');
  var loading = document.getElementById('fpLoading');
  var container = document.getElementById('fpContainer');
  if (!img || !canvas || !floorPlanState.imgLoaded) return;
  var maxW = container ? container.clientWidth - 24 : 800;
  var scale = Math.min(maxW / img.naturalWidth, 1);
  var w = img.naturalWidth * scale;
  var h = img.naturalHeight * scale;
  canvas.width = w; canvas.height = h;
  canvas.style.display = 'block';
  if (loading) loading.style.display = 'none';
  var ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  var pins = boothPinsData;
  for (var boothId in pins) {
    var pin = pins[boothId];
    var booth = boothsData[boothId];
    if (!pin || !booth) continue;
    var px = pin.x * w, py = pin.y * h;
    var isPlacing = floorPlanState.placingBoothId === boothId;
    ctx.beginPath();
    ctx.arc(px, py, isPlacing ? 14 : 10, 0, Math.PI * 2);
    ctx.fillStyle = isPlacing ? '#818cf8' : '#2a7c6f';
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(booth.name || '', px, py);
  }
}

// ============================================================
// Vendors Tab
// ============================================================

function renderVendorsTab(showId) {
  var container = document.getElementById('tabContent');
  var list = objToList(vendorsData);
  list.sort(function(a, b) { return (a.businessName || '').localeCompare(b.businessName || ''); });

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
  html += '<h3 style="margin:0;font-size:1rem;">Vendors (' + list.length + ')</h3>';
  html += '<button class="btn btn-primary btn-sm" onclick="openVendorModal(\'' + esc(showId) + '\')">+ Add Vendor</button></div>';

  if (list.length === 0) {
    html += '<div style="text-align:center;padding:40px;color:var(--text-secondary);">No vendors yet. Add vendors to your show.</div>';
  } else {
    html += '<div class="events-table"><table><thead><tr><th>Business</th><th>Category</th><th>Booth</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>';
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      var boothName = '—';
      if (v.boothId && boothsData[v.boothId]) boothName = boothsData[v.boothId].name || v.boothId;
      html += '<tr>' +
        '<td><div style="font-weight:600;">' + esc(v.businessName || '') + '</div><div style="font-size:0.75rem;color:var(--text-secondary);">' + esc(v.ownerName || '') + (v.email ? ' · ' + esc(v.email) : '') + '</div></td>' +
        '<td style="font-size:0.8rem;">' + esc(v.category || '—') + '</td>' +
        '<td>' + esc(boothName) + '</td>' +
        '<td>' + badgeHtml(v.paymentStatus || 'pending') + '</td>' +
        '<td><select style="font-size:0.8rem;padding:2px 6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);" onchange="updateVendorStatus(\'' + esc(showId) + '\', \'' + esc(v.id) + '\', this.value)">';
      for (var si = 0; si < VENDOR_STATUSES.length; si++) {
        html += '<option value="' + VENDOR_STATUSES[si] + '"' + (VENDOR_STATUSES[si] === (v.status || 'pending') ? ' selected' : '') + '>' + VENDOR_STATUSES[si] + '</option>';
      }
      html += '</select></td>' +
        '<td style="text-align:right;white-space:nowrap;">' +
          (v.email && !v.inviteSentAt ? '<button class="btn-link" style="color:var(--blue);" onclick="sendVendorInvite(\'' + esc(showId) + '\', \'' + esc(v.id) + '\')">Invite</button> ' : '') +
          (v.inviteSentAt ? '<span style="font-size:0.7rem;color:var(--text-secondary);">Invited </span>' : '') +
          '<button class="btn-link" onclick="openVendorModal(\'' + esc(showId) + '\', \'' + esc(v.id) + '\')">Edit</button> ' +
          '<button class="btn-link" style="color:var(--red);" onclick="deleteVendor(\'' + esc(showId) + '\', \'' + esc(v.id) + '\')">Del</button>' +
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
  overlay.id = 'vendorModal';
  overlay.className = 'modal-overlay';

  // Build available booths dropdown
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
    '<div class="modal-box">' +
      '<h3>' + (isEdit ? 'Edit Vendor' : 'Add Vendor') + '</h3>' +
      '<form onsubmit="submitVendorForm(event, \'' + esc(showId) + '\', ' + (isEdit ? '\'' + esc(vendorId) + '\'' : 'null') + ')">' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">Business Name *</label><input class="form-input" type="text" id="vf_biz" required value="' + esc(isEdit ? v.businessName || '' : '') + '"></div>' +
          '<div><label class="form-label">Owner Name</label><input class="form-input" type="text" id="vf_owner" value="' + esc(isEdit ? v.ownerName || '' : '') + '"></div>' +
        '</div>' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">Email *</label><input class="form-input" type="email" id="vf_email" required value="' + esc(isEdit ? v.email || '' : '') + '"></div>' +
          '<div><label class="form-label">Phone</label><input class="form-input" type="text" id="vf_phone" value="' + esc(isEdit ? v.phone || '' : '') + '"></div>' +
        '</div>' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">Category</label><select class="form-select" id="vf_category">' + catOpts + '</select></div>' +
          '<div><label class="form-label">Payment Status</label><select class="form-select" id="vf_payment">' + payOpts + '</select></div>' +
        '</div>' +
        '<div class="form-group"><label class="form-label">Business Description</label><textarea class="form-textarea" id="vf_desc" rows="2">' + esc(isEdit ? v.businessDescription || '' : '') + '</textarea></div>' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">Website</label><input class="form-input" type="text" id="vf_web" value="' + esc(isEdit ? v.websiteUrl || '' : '') + '"></div>' +
          '<div><label class="form-label">Instagram</label><input class="form-input" type="text" id="vf_insta" value="' + esc(isEdit ? v.instagramHandle || '' : '') + '"></div>' +
        '</div>' +
        '<div class="form-group form-row form-row-2">' +
          '<div><label class="form-label">Assign Booth</label><select class="form-select" id="vf_booth">' + boothOpts + '</select></div>' +
          '<div><label class="form-label">Mast Tenant ID</label><input class="form-input" type="text" id="vf_tenant" value="' + esc(isEdit ? v.mastTenantId || '' : '') + '" placeholder="Optional"></div>' +
        '</div>' +
        '<div class="form-group"><label class="form-label">Notes (organizer only)</label><textarea class="form-textarea" id="vf_notes" rows="2">' + esc(isEdit ? v.notes || '' : '') + '</textarea></div>' +
        '<div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal(\'vendorModal\')">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>' +
      '</form>' +
    '</div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal('vendorModal'); });
  document.body.appendChild(overlay);
}

async function submitVendorForm(e, showId, vendorId) {
  e.preventDefault();
  var biz = document.getElementById('vf_biz').value.trim();
  var email = document.getElementById('vf_email').value.trim();
  if (!biz || !email) return;

  var boothId = document.getElementById('vf_booth').value || null;
  var tenantId = document.getElementById('vf_tenant').value.trim() || null;

  var data = {
    businessName: biz,
    ownerName: document.getElementById('vf_owner').value.trim(),
    email: email,
    phone: document.getElementById('vf_phone').value.trim(),
    category: document.getElementById('vf_category').value,
    businessDescription: document.getElementById('vf_desc').value.trim(),
    websiteUrl: document.getElementById('vf_web').value.trim(),
    instagramHandle: document.getElementById('vf_insta').value.trim(),
    boothId: boothId,
    mastTenantId: tenantId,
    mastStatus: tenantId ? 'free' : 'invited',
    paymentStatus: document.getElementById('vf_payment').value || 'pending',
    notes: document.getElementById('vf_notes').value.trim(),
    updatedAt: nowISO()
  };

  try {
    if (vendorId) {
      // Handle booth reassignment
      var oldVendor = vendorsData[vendorId];
      if (oldVendor && oldVendor.boothId && oldVendor.boothId !== boothId) {
        await DB.booths.update(showId, oldVendor.boothId, { vendorId: null, status: 'open', assignedAt: null });
      }
      if (boothId && (!oldVendor || oldVendor.boothId !== boothId)) {
        await DB.booths.update(showId, boothId, { vendorId: vendorId, status: 'reserved', assignedAt: nowISO() });
      }
      await DB.vendors.update(showId, vendorId, data);
      showToast('Vendor updated!');
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
      if (boothId) {
        await DB.booths.update(showId, boothId, { vendorId: newId, status: 'reserved', assignedAt: nowISO() });
      }
      await DB.vendors.set(showId, newId, data);
      showToast('Vendor added!');
    }
    closeModal('vendorModal');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

async function updateVendorStatus(showId, vendorId, status) {
  try {
    await DB.vendors.update(showId, vendorId, { status: status, updatedAt: nowISO() });
    showToast('Vendor status updated');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

async function deleteVendor(showId, vendorId) {
  if (!confirm('Delete this vendor?')) return;
  var v = vendorsData[vendorId];
  try {
    if (v && v.boothId) {
      await DB.booths.update(showId, v.boothId, { vendorId: null, status: 'open', assignedAt: null });
    }
    await DB.vendors.remove(showId, vendorId);
    showToast('Vendor deleted');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

async function sendVendorInvite(showId, vendorId) {
  if (!confirm('Send invite email to this vendor?')) return;
  try {
    await callFunction('eventsSendVendorInvite', { showId: showId, vendorId: vendorId });
    showToast('Invite sent!');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

// ============================================================
// Submissions Tab
// ============================================================

function renderSubmissionsTab(showId) {
  var container = document.getElementById('tabContent');
  var list = objToList(submissionsData);
  list.sort(function(a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });

  var pending = list.filter(function(s) { return s.status === 'pending'; });
  var accepted = list.filter(function(s) { return s.reviewDecision === 'accepted'; });
  var declined = list.filter(function(s) { return s.reviewDecision === 'declined'; });

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
  html += '<h3 style="margin:0;font-size:1rem;">Submissions</h3>';
  html += '<div style="display:flex;gap:12px;align-items:center;font-size:0.8rem;color:var(--text-secondary);">' +
    '<span style="color:var(--yellow);">' + pending.length + ' pending</span>' +
    '<span style="color:var(--green);">' + accepted.length + ' accepted</span>' +
    '<span style="color:var(--red);">' + declined.length + ' declined</span>' +
    ((accepted.length + declined.length) > 0 ? ' <button class="btn btn-sm btn-primary" onclick="sendSubmissionNotifications(\'' + esc(showId) + '\')">Email Results</button>' : '') +
  '</div></div>';

  if (list.length === 0) {
    html += '<div style="text-align:center;padding:40px;color:var(--text-secondary);">No submissions yet. Share your apply page (/apply/{slug}) with vendors to receive applications.</div>';
  } else {
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      html += '<div class="card" style="margin-bottom:12px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">';
      html += '<div><strong>' + esc(s.businessName || '') + '</strong> ' + badgeHtml(s.reviewDecision || s.status || 'pending');
      if (s.notified) html += ' <span style="font-size:0.7rem;color:var(--text-secondary);">notified</span>';
      html += '<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px;">' + esc(s.ownerName || '') + (s.email ? ' · ' + esc(s.email) : '') + (s.phone ? ' · ' + esc(s.phone) : '') + '</div>';
      html += '<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:2px;">' + esc(s.category || '') + ' · Submitted ' + (s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : '') + '</div>';
      html += '</div></div>';

      if (s.businessDescription) html += '<p style="font-size:0.85rem;margin:10px 0 0;color:var(--text);">' + esc(s.businessDescription) + '</p>';
      if (s.websiteUrl) html += '<p style="font-size:0.8rem;margin:4px 0 0;"><a href="' + esc(s.websiteUrl) + '" target="_blank">' + esc(s.websiteUrl) + '</a></p>';
      if (s.instagramHandle) html += '<p style="font-size:0.8rem;margin:4px 0 0;color:var(--text-secondary);">IG: ' + esc(s.instagramHandle) + '</p>';
      if (s.additionalInfo) html += '<p style="font-size:0.8rem;margin:8px 0 0;padding:8px;background:var(--bg-secondary);border-radius:6px;">' + esc(s.additionalInfo) + '</p>';

      // Review controls for pending
      if (s.status === 'pending') {
        html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;">';
        html += '<input type="text" id="reviewNote_' + esc(s.id) + '" class="form-input" style="flex:1;padding:6px 10px;font-size:0.8rem;" placeholder="Review notes (optional)">';
        html += '<button class="btn btn-sm" style="background:var(--green);color:#fff;" onclick="reviewSubmission(\'' + esc(showId) + '\', \'' + esc(s.id) + '\', \'accepted\')">Accept</button>';
        html += '<button class="btn btn-sm btn-danger" onclick="reviewSubmission(\'' + esc(showId) + '\', \'' + esc(s.id) + '\', \'declined\')">Decline</button>';
        html += '</div>';
      } else if (s.reviewNotes) {
        html += '<p style="font-size:0.8rem;margin-top:8px;color:var(--text-secondary);">Review notes: ' + esc(s.reviewNotes) + '</p>';
      }
      html += '</div>';
    }
  }
  container.innerHTML = html;
}

async function reviewSubmission(showId, subId, decision) {
  var notesEl = document.getElementById('reviewNote_' + subId);
  var notes = notesEl ? notesEl.value.trim() : '';
  try {
    await DB.submissions.update(showId, subId, {
      status: 'reviewed',
      reviewDecision: decision,
      reviewedAt: nowISO(),
      reviewedBy: currentUser.uid,
      reviewNotes: notes,
      updatedAt: nowISO()
    });

    // If accepted, auto-create vendor record
    if (decision === 'accepted') {
      var sub = submissionsData[subId];
      if (sub) {
        var vendorId = DB.vendors.newKey(showId);
        await DB.vendors.set(showId, vendorId, {
          showId: showId,
          businessName: sub.businessName || '',
          ownerName: sub.ownerName || '',
          email: sub.email || '',
          phone: sub.phone || '',
          category: sub.category || '',
          businessDescription: sub.businessDescription || '',
          websiteUrl: sub.websiteUrl || '',
          instagramHandle: sub.instagramHandle || '',
          boothId: null,
          mastTenantId: null,
          mastStatus: 'invited',
          status: 'pending',
          paymentStatus: 'pending',
          logoUrl: '',
          notes: 'Created from submission',
          inviteSentAt: null,
          inviteClaimedAt: null,
          inviteToken: null,
          stripePaymentIntentId: null,
          paidAt: null,
          paidAmount: 0,
          createdAt: nowISO(),
          updatedAt: nowISO()
        });
        showToast('Submission ' + decision + ' — vendor record created');
        return;
      }
    }
    showToast('Submission ' + decision);
  } catch (err) { showToast('Error: ' + err.message, true); }
}

async function sendSubmissionNotifications(showId) {
  if (!confirm('Send email notifications to all reviewed vendors (accepted & declined)?')) return;
  try {
    var result = await callFunction('eventsSendNotifications', { showId: showId });
    showToast('Notifications sent to ' + (result.sentCount || 0) + ' vendors');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

// ============================================================
// Announcements Tab
// ============================================================

function renderAnnouncementsTab(showId) {
  var container = document.getElementById('tabContent');
  var list = objToList(announcementsData);
  list.sort(function(a, b) { return (b.sentAt || '').localeCompare(a.sentAt || ''); });

  var html = '<h3 style="margin:0 0 16px;font-size:1rem;">Announcements</h3>';

  // Compose form
  html += '<div class="card" style="margin-bottom:20px;">';
  html += '<h4 style="font-size:0.9rem;margin:0 0 12px;">Send Announcement</h4>';
  html += '<div class="form-group"><label class="form-label">Subject *</label><input class="form-input" type="text" id="ann_subject" placeholder="Announcement subject"></div>';
  html += '<div class="form-group"><label class="form-label">Message *</label><textarea class="form-textarea" id="ann_body" rows="4" placeholder="Write your announcement..."></textarea></div>';
  html += '<div style="text-align:right;"><button class="btn btn-primary" onclick="sendAnnouncement(\'' + esc(showId) + '\')">Send to Vendors</button></div>';
  html += '</div>';

  // Sent list
  if (list.length === 0) {
    html += '<div style="text-align:center;padding:30px;color:var(--text-secondary);">No announcements sent yet.</div>';
  } else {
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      html += '<div class="card" style="margin-bottom:8px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">';
      html += '<strong style="font-size:0.9rem;">' + esc(a.subject || '') + '</strong>';
      html += '<span style="font-size:0.75rem;color:var(--text-secondary);">' + (a.sentAt ? new Date(a.sentAt).toLocaleString() : '') + '</span>';
      html += '</div>';
      html += '<p style="font-size:0.85rem;margin:8px 0 0;white-space:pre-wrap;color:var(--text);">' + esc(a.body || '') + '</p>';
      if (a.recipientCount) html += '<p style="font-size:0.75rem;color:var(--text-secondary);margin-top:4px;">Sent to ' + a.recipientCount + ' vendors</p>';
      html += '</div>';
    }
  }
  container.innerHTML = html;
}

async function sendAnnouncement(showId) {
  var subject = document.getElementById('ann_subject').value.trim();
  var body = document.getElementById('ann_body').value.trim();
  if (!subject || !body) { showToast('Subject and message are required', true); return; }

  try {
    var result = await callFunction('eventsSendAnnouncement', { showId: showId, subject: subject, body: body });
    showToast('Announcement sent to ' + (result.recipientCount || 0) + ' vendors!');
    document.getElementById('ann_subject').value = '';
    document.getElementById('ann_body').value = '';
  } catch (err) {
    // Fallback: save locally if Cloud Function fails
    var annId = DB.announcements.newKey(showId);
    var vendorCount = Object.keys(vendorsData).length;
    try {
      await DB.announcements.set(showId, annId, {
        showId: showId, subject: subject, body: body,
        sentAt: nowISO(), sentBy: currentUser.uid, recipientCount: vendorCount,
        note: 'Saved locally — email delivery failed: ' + err.message
      });
      showToast('Saved locally (email failed: ' + err.message + ')', true);
      document.getElementById('ann_subject').value = '';
      document.getElementById('ann_body').value = '';
    } catch (saveErr) { showToast('Error: ' + saveErr.message, true); }
  }
}

// ============================================================
// Hunt Tab
// ============================================================

function renderHuntTab(showId) {
  var container = document.getElementById('tabContent');
  var confirmedVendors = objToList(vendorsData).filter(function(v) { return v.status === 'confirmed'; });

  var html = '<h3 style="margin:0 0 16px;font-size:1rem;">Scavenger Hunt</h3>';

  // Config card
  html += '<div class="card">';
  html += '<h4 style="font-size:0.9rem;margin:0 0 12px;">Hunt Configuration</h4>';
  html += '<div class="form-group"><label class="form-label"><input type="checkbox" id="hunt_enabled" onchange="saveHuntConfig(\'' + esc(showId) + '\')" style="margin-right:6px;">Enable Scavenger Hunt</label></div>';
  html += '<div id="huntConfigFields" style="display:none;">';
  html += '<div class="form-group"><label class="form-label">Mode</label><select class="form-select" id="hunt_mode" onchange="onHuntModeChange(\'' + esc(showId) + '\')">';
  for (var mi = 0; mi < HUNT_MODES.length; mi++) html += '<option value="' + HUNT_MODES[mi].value + '">' + HUNT_MODES[mi].label + '</option>';
  html += '</select></div>';
  html += '<div class="form-group form-row form-row-2">';
  html += '<div><label class="form-label">Vendors to Visit</label><input class="form-input" type="number" id="hunt_target" min="1" max="' + Math.max(confirmedVendors.length, 1) + '" value="5"></div>';
  html += '<div><label class="form-label">Prize</label><input class="form-input" type="text" id="hunt_prize" placeholder="Free item, gift card, etc."></div>';
  html += '</div>';
  html += '<div class="form-group"><label class="form-label">Claim Instructions</label><textarea class="form-textarea" id="hunt_instructions" rows="2" placeholder="How to claim the prize"></textarea></div>';
  html += '<div id="huntVendorSelect" style="display:none;">';
  html += '<div class="form-group"><label class="form-label">Select Eligible Vendors</label>';
  for (var vi = 0; vi < confirmedVendors.length; vi++) {
    html += '<label style="display:block;padding:4px 0;font-size:0.85rem;"><input type="checkbox" class="huntVendorCb" value="' + esc(confirmedVendors[vi].id) + '" style="margin-right:6px;">' + esc(confirmedVendors[vi].businessName || confirmedVendors[vi].id) + '</label>';
  }
  html += '</div></div>';
  html += '<div style="margin-top:12px;"><button class="btn btn-primary" onclick="saveHuntConfig(\'' + esc(showId) + '\')">Save Hunt Configuration</button></div>';
  html += '</div></div>';

  // Stats card
  var stats = huntStatsData || {};
  if (stats.totalParticipants || stats.totalCompletions) {
    html += '<div class="card"><h4 style="font-size:0.9rem;margin:0 0 12px;">Hunt Statistics</h4>';
    html += '<div class="stats-grid">';
    html += '<div class="stat-card"><div class="stat-label">Participants</div><div class="stat-value">' + (stats.totalParticipants || 0) + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Completions</div><div class="stat-value" style="color:var(--green);">' + (stats.totalCompletions || 0) + '</div></div>';
    var rate = stats.totalParticipants ? Math.round((stats.totalCompletions || 0) / stats.totalParticipants * 100) : 0;
    html += '<div class="stat-card"><div class="stat-label">Rate</div><div class="stat-value">' + rate + '%</div></div>';
    html += '</div>';

    if (stats.vendorScans) {
      html += '<h5 style="font-size:0.8rem;color:var(--text-secondary);margin:12px 0 8px;">Vendor Scans</h5>';
      var scanList = [];
      for (var vid in stats.vendorScans) scanList.push({ id: vid, count: stats.vendorScans[vid] });
      scanList.sort(function(a, b) { return b.count - a.count; });
      for (var si = 0; si < scanList.length; si++) {
        var vname = vendorsData[scanList[si].id] ? vendorsData[scanList[si].id].businessName : scanList[si].id;
        html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem;"><span>' + esc(vname) + '</span><span style="color:var(--text-secondary);">' + scanList[si].count + '</span></div>';
      }
    }
    html += '</div>';
  }

  container.innerHTML = html;

  // Load existing config
  DB.huntConfig.get(showId).then(function(snap) {
    var config = snap.val();
    if (config) {
      document.getElementById('hunt_enabled').checked = !!config.enabled;
      if (config.enabled) document.getElementById('huntConfigFields').style.display = 'block';
      if (config.mode) document.getElementById('hunt_mode').value = config.mode;
      if (config.target) document.getElementById('hunt_target').value = config.target;
      if (config.prize) document.getElementById('hunt_prize').value = config.prize;
      if (config.claimInstructions) document.getElementById('hunt_instructions').value = config.claimInstructions;
      if (config.mode === 'selected' && config.selectedVendorIds) {
        document.getElementById('huntVendorSelect').style.display = 'block';
        document.querySelectorAll('.huntVendorCb').forEach(function(cb) {
          if (config.selectedVendorIds[cb.value]) cb.checked = true;
        });
      }
    }
  });
}

function onHuntModeChange(showId) {
  var mode = document.getElementById('hunt_mode').value;
  document.getElementById('huntVendorSelect').style.display = mode === 'selected' ? 'block' : 'none';
}

async function saveHuntConfig(showId) {
  var enabled = document.getElementById('hunt_enabled').checked;
  var fields = document.getElementById('huntConfigFields');
  if (enabled) fields.style.display = 'block';
  else fields.style.display = 'none';

  var mode = document.getElementById('hunt_mode').value;
  var selectedVendorIds = null;
  if (mode === 'selected') {
    selectedVendorIds = {};
    document.querySelectorAll('.huntVendorCb:checked').forEach(function(cb) { selectedVendorIds[cb.value] = true; });
  }

  try {
    await DB.huntConfig.set(showId, {
      enabled: enabled,
      mode: mode,
      target: parseInt(document.getElementById('hunt_target').value) || 5,
      prize: document.getElementById('hunt_prize').value.trim(),
      claimInstructions: document.getElementById('hunt_instructions').value.trim(),
      selectedVendorIds: selectedVendorIds,
      updatedAt: nowISO()
    });
    showToast('Hunt config saved!');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

// ============================================================
// Ads Tab
// ============================================================

function renderAdsTab(showId) {
  var container = document.getElementById('tabContent');

  var html = '<h3 style="margin:0 0 16px;font-size:1rem;">Ad Economy</h3>';

  // Ad Config card
  html += '<div class="card">';
  html += '<h4 style="font-size:0.9rem;margin:0 0 12px;">Ad Configuration</h4>';
  html += '<div class="form-group form-row form-row-3">';
  html += '<div><label class="form-label">Tokens per Coin</label><input class="form-input" type="number" id="ad_rate" value="100" min="1"></div>';
  html += '<div><label class="form-label">Min Coin Purchase</label><input class="form-input" type="number" id="ad_min" value="10" min="1"></div>';
  html += '<div><label class="form-label">Max Coin Purchase</label><input class="form-input" type="number" id="ad_max" value="100" min="1"></div>';
  html += '</div>';
  html += '<div style="margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="saveAdConfig(\'' + esc(showId) + '\')">Save Ad Config</button></div>';
  html += '</div>';

  // Vendor Wallets overview
  var walletList = [];
  for (var vid in walletsData) {
    var w = walletsData[vid];
    var vname = vendorsData[vid] ? vendorsData[vid].businessName : vid;
    walletList.push({ id: vid, name: vname, coins: w.coins || 0, tokens: w.tokens || 0 });
  }

  if (walletList.length > 0) {
    html += '<div class="card"><h4 style="font-size:0.9rem;margin:0 0 12px;">Vendor Wallets</h4>';
    html += '<div class="events-table"><table><thead><tr><th>Vendor</th><th>Coins</th><th>Tokens</th></tr></thead><tbody>';
    for (var wi = 0; wi < walletList.length; wi++) {
      html += '<tr><td>' + esc(walletList[wi].name) + '</td><td style="color:var(--gold);">' + walletList[wi].coins + '</td><td style="color:var(--purple);">' + walletList[wi].tokens + '</td></tr>';
    }
    html += '</tbody></table></div></div>';
  }

  // Ads overview
  var adList = objToList(adsData);
  if (adList.length > 0) {
    html += '<div class="card"><h4 style="font-size:0.9rem;margin:0 0 12px;">Active Ads (' + adList.length + ')</h4>';
    html += '<div class="events-table"><table><thead><tr><th>Vendor</th><th>Headline</th><th>Type</th><th>Tokens</th><th>Status</th></tr></thead><tbody>';
    for (var ai = 0; ai < adList.length; ai++) {
      var ad = adList[ai];
      var adVendor = vendorsData[ad.vendorId] ? vendorsData[ad.vendorId].businessName : ad.vendorId;
      html += '<tr><td>' + esc(adVendor) + '</td><td>' + esc(ad.headline || '') + '</td><td>' + badgeHtml(ad.type || 'general') + '</td>';
      html += '<td>' + (ad.tokensRemaining || 0) + '/' + (ad.tokensCommitted || 0) + '</td>';
      html += '<td>' + badgeHtml(ad.active ? 'active' : 'draft') + '</td></tr>';
    }
    html += '</tbody></table></div></div>';
  } else {
    html += '<div class="card"><p style="color:var(--text-secondary);font-size:0.85rem;">No ads yet. Vendors manage ads through their vendor portal. Ad coin purchases require Stripe integration.</p></div>';
  }

  container.innerHTML = html;

  // Load existing config
  DB.showAdConfig.get(showId).then(function(snap) {
    var config = snap.val();
    if (config) {
      if (config.coinToTokenRate) document.getElementById('ad_rate').value = config.coinToTokenRate;
      if (config.minCoinPurchase) document.getElementById('ad_min').value = config.minCoinPurchase;
      if (config.maxCoinPurchase) document.getElementById('ad_max').value = config.maxCoinPurchase;
    }
  });
}

async function saveAdConfig(showId) {
  try {
    await DB.showAdConfig.set(showId, {
      coinToTokenRate: parseInt(document.getElementById('ad_rate').value) || 100,
      minCoinPurchase: parseInt(document.getElementById('ad_min').value) || 10,
      maxCoinPurchase: parseInt(document.getElementById('ad_max').value) || 100,
      updatedAt: nowISO()
    });
    showToast('Ad config saved!');
  } catch (err) { showToast('Error: ' + err.message, true); }
}

// ============================================================
// Helper: Object to Array
// ============================================================

function objToList(obj) {
  var list = [];
  for (var id in obj) list.push(Object.assign({ id: id }, obj[id]));
  return list;
}

// ============================================================
// Payment Processor Detection
// ============================================================

function detectPaymentProcessor() {
  var el = document.getElementById('paymentProcessorStatus');
  if (!el) return;

  // Check explicit config first, then auto-detect
  DB.ref('config/paymentProcessor').once('value').then(function(snap) {
    var processor = snap.val();
    if (processor) {
      renderProcessorBadge(el, processor);
      return;
    }
    // Auto-detect Square
    return DB.ref('config/square/environment').once('value');
  }).then(function(sqSnap) {
    if (!sqSnap) return; // already rendered
    if (sqSnap.val()) {
      renderProcessorBadge(el, 'square');
    } else {
      renderProcessorBadge(el, null);
    }
  }).catch(function() {
    renderProcessorBadge(el, null);
  });
}

function renderProcessorBadge(el, processor) {
  if (processor === 'square') {
    el.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;background:rgba(0,157,224,0.12);border:1px solid rgba(0,157,224,0.3);font-size:0.85rem;font-weight:600;color:#009de0;">&#9679; Square</span>';
  } else if (processor === 'stripe') {
    el.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;background:rgba(99,91,255,0.12);border:1px solid rgba(99,91,255,0.3);font-size:0.85rem;font-weight:600;color:#635bff;">&#9679; Stripe</span>';
  } else {
    el.innerHTML = '<div style="padding:10px 14px;border-radius:6px;background:rgba(255,160,0,0.12);border:1px solid rgba(255,160,0,0.3);">' +
      '<div style="font-size:0.85rem;font-weight:600;color:#ffa000;">&#9888; No payment processor configured</div>' +
      '<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px;">Booth fee collection and vendor coin purchases require a payment processor. Set up Square or Stripe in your admin settings.</div>' +
    '</div>';
  }
}

// ============================================================
// Settings View — Events Configuration
// ============================================================

function renderSettings() {
  var title = document.getElementById('pageTitle');
  var actions = document.getElementById('pageActions');
  var content = document.getElementById('pageContent');
  title.textContent = 'Settings';
  actions.innerHTML = '<button class="btn btn-secondary btn-sm" onclick="navigateTo(\'shows-list\')">&larr; Back to Shows</button>';

  var html = '';

  // Payment Processing — shows detected processor + points to admin settings
  html += '<div class="card">';
  html += '<h3 style="display:flex;align-items:center;gap:8px;"><span style="font-size:1.2rem;">&#128179;</span> Payment Processing</h3>';
  html += '<div id="paymentProcessorStatus" style="margin-bottom:12px;"><span style="color:var(--text-secondary);font-size:0.85rem;">Detecting payment processor...</span></div>';
  html += '<p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px;">Booth fees and vendor coin purchases route through your configured payment processor. Configure it in your main Mast admin settings.</p>';
  html += '<a href="../app/" class="btn btn-secondary btn-sm" target="_blank">Open Admin Settings</a>';
  html += '</div>';

  // Events Defaults
  html += '<div class="card">';
  html += '<h3 style="display:flex;align-items:center;gap:8px;"><span style="font-size:1.2rem;">&#9881;</span> Events Defaults</h3>';
  html += '<p style="font-size:0.85rem;color:var(--text-secondary);">Default settings for new shows. These can be overridden per show.</p>';
  html += '<div style="margin-top:16px;color:var(--text-secondary);font-size:0.85rem;font-style:italic;">Coming soon — default booth types, pricing, vendor categories, and email templates.</div>';
  html += '</div>';

  content.innerHTML = html;

  // Detect payment processor after DOM is populated
  detectPaymentProcessor();
}

