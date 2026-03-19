(function() {
  'use strict';

  var FUNCTIONS_BASE = 'https://us-central1-mast-platform-prod.cloudfunctions.net';
  var app = document.getElementById('app');

  // ── Core state ──
  var token = '';
  var portalData = null;
  var activeTab = 'overview';
  var msg = null; // { type: 'success'|'error', text: '' }

  // ── Profile state ──
  var editingProfile = false;
  var savingProfile = false;
  var showProfilePreview = false;

  // ── Promotions state ──
  var showPromoForm = false;
  var promoForm = { mastCouponCode: '', couponType: 'Percentage', couponValue: '', attendeeMessage: '' };

  // ── Ads state ──
  var showAdForm = false;
  var editingAdId = null;
  var adForm = { type: 'general', promotionId: '', headline: '', imageUrl: '', tokensCommitted: 50 };
  var uploadingAdImage = false;
  var savingAd = false;
  var topUpAdId = null;
  var topUpAmount = '';

  // ── Wallet state ──
  var coinAmount = 10;
  var purchasing = false;
  var convertAmount = '';
  var converting = false;

  // ── Helpers ──
  function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function formatDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return d; }
  }

  function showMsg(type, text) { msg = { type: type, text: text }; render(); }

  function clearMsg() { msg = null; }

  function apiCall(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r) {
      return r.json().then(function(d) {
        if (!r.ok) throw new Error(d.error || d.error?.message || 'Request failed');
        return d;
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════

  function init() {
    var params = new URLSearchParams(window.location.search);
    token = params.get('token') || '';

    if (!token) {
      renderError('No access token', 'Please use the link from your vendor invite email.');
      return;
    }

    // Check for Stripe purchase callback (extract before cleaning URL)
    var purchaseStatus = params.get('purchase');
    if (purchaseStatus === 'success') {
      msg = { type: 'success', text: 'Coin purchase successful! Your balance will update shortly.' };
      activeTab = 'ads';
      setTimeout(function() { reloadWalletData(); }, 3000);
    } else if (purchaseStatus === 'cancelled') {
      msg = { type: 'error', text: 'Coin purchase was cancelled.' };
      activeTab = 'ads';
    }

    // Clean all params from URL — removes token from browser history/address bar
    window.history.replaceState({}, '', window.location.pathname);

    loadPortalData();
  }

  function loadPortalData() {
    fetch(FUNCTIONS_BASE + '/eventsGetVendorPortalData', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) {
        if (r.status === 401) throw new Error('Invalid or expired invite link. Please contact the organizer for a new link.');
        if (!r.ok) throw new Error('Failed to load vendor data.');
        return r.json();
      })
      .then(function(d) {
        portalData = d;
        document.title = (d.vendor.businessName || 'Vendor') + ' — ' + (d.show.name || 'Portal');
        render();
      })
      .catch(function(err) {
        renderError('Access Denied', err.message);
      });
  }

  function reloadWalletData() {
    fetch(FUNCTIONS_BASE + '/eventsGetVendorPortalData', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.wallet) portalData.wallet = d.wallet;
        if (d.transactions) portalData.transactions = d.transactions;
        if (d.vendorAds) portalData.vendorAds = d.vendorAds;
        render();
      })
      .catch(function() {});
  }

  // ══════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════

  function renderError(title, message) {
    app.innerHTML = '<div class="error-page"><div class="error-icon">🔗</div><h2>' + esc(title) + '</h2><p>' + esc(message) + '</p></div>';
  }

  function render() {
    if (!portalData) return;
    var show = portalData.show;
    var vendor = portalData.vendor;
    var announcements = portalData.announcements || [];
    var promoCount = (portalData.promotions || []).length;

    var h = '';

    // Header
    h += '<nav class="portal-nav"><div class="portal-nav-inner">';
    h += '<div class="nav-brand"><svg width="24" height="24" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="2.5"/><path d="M10 16h12M16 10v12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    h += '<span>Vendor Portal</span></div>';
    h += '<span class="nav-vendor-name">' + esc(vendor.businessName) + '</span>';
    h += '</div></nav>';

    // Show banner
    h += '<div class="show-banner"><div class="show-banner-inner">';
    h += '<div><div class="show-banner-name">' + esc(show.name) + '</div>';
    if (show.startDate) {
      h += '<div class="show-banner-date">' + formatDate(show.startDate);
      if (show.endDate && show.endDate !== show.startDate) h += ' — ' + formatDate(show.endDate);
      h += '</div>';
    }
    h += '</div>';
    var statusClass = vendor.status === 'confirmed' ? 'badge-green' : vendor.status === 'cancelled' ? 'badge-red' : 'badge-amber';
    h += '<span class="badge ' + statusClass + '">' + esc(vendor.status || 'pending') + '</span>';
    h += '</div></div>';

    // Tabs
    var tabs = [
      { key: 'overview', label: 'Overview' },
      { key: 'profile', label: 'My Profile' },
      { key: 'promotions', label: 'Promotions (' + promoCount + ')' },
      { key: 'ads', label: 'Ads' }
    ];
    if (announcements.length > 0) {
      tabs.push({ key: 'announcements', label: 'News (' + announcements.length + ')' });
    }

    h += '<div class="tabs"><div class="tabs-inner">';
    tabs.forEach(function(t) {
      h += '<button class="tab-btn' + (activeTab === t.key ? ' active' : '') + '" onclick="vpSetTab(\'' + t.key + '\')">' + esc(t.label) + '</button>';
    });
    h += '</div></div>';

    h += '<div class="content">';

    if (msg) {
      h += '<div class="msg msg-' + msg.type + '">' + esc(msg.text) + '<button class="msg-close" onclick="vpClearMsg()">&times;</button></div>';
    }

    if (activeTab === 'overview') h += renderOverviewTab();
    else if (activeTab === 'profile') h += renderProfileTab();
    else if (activeTab === 'promotions') h += renderPromotionsTab();
    else if (activeTab === 'ads') h += renderAdsTab();
    else if (activeTab === 'announcements') h += renderAnnouncementsTab();

    h += '</div>';

    // Footer
    h += '<div class="portal-footer">Powered by <strong>Mast</strong></div>';

    app.innerHTML = h;
  }

  // ══════════════════════════════════════════════════════════════════
  // OVERVIEW TAB
  // ══════════════════════════════════════════════════════════════════

  function renderOverviewTab() {
    var show = portalData.show;
    var booth = portalData.booth;
    var vendor = portalData.vendor;
    var wallet = portalData.wallet || {};
    var ads = portalData.vendorAds || [];

    var h = '';

    // Show details
    h += '<div class="section"><h3>Show Details</h3>';
    h += '<div class="info-grid">';
    h += infoItem('Show', show.name);
    if (show.venue) h += infoItem('Venue', show.venue + (show.address ? ', ' + show.address : '') + (show.city ? ', ' + show.city : '') + (show.state ? ' ' + show.state : ''));
    h += infoItem('Dates', formatDate(show.startDate) + (show.endDate && show.endDate !== show.startDate ? ' — ' + formatDate(show.endDate) : ''));
    if (show.setupTime) h += infoItem('Setup Time', show.setupTime);
    h += '</div>';
    if (show.setupNotes) {
      h += '<div class="setup-notes">' + esc(show.setupNotes) + '</div>';
    }
    if (show.attendeeNotes) {
      h += '<p class="attendee-notes">' + esc(show.attendeeNotes) + '</p>';
    }
    h += '</div>';

    // Booth
    h += '<div class="section"><h3>Your Booth</h3>';
    if (booth) {
      h += '<div class="info-grid">';
      h += infoItem('Booth', booth.name);
      if (booth.location) h += infoItem('Location', booth.location);
      if (booth.size) h += infoItem('Size', booth.size);
      h += '</div>';
    } else {
      h += '<p class="empty-text">No booth assigned yet. The organizer will assign your booth.</p>';
    }
    h += '</div>';

    // Status
    h += '<div class="section"><h3>Your Status</h3>';
    h += '<div class="status-row">';
    var vstClass = vendor.status === 'confirmed' ? 'badge-green' : vendor.status === 'cancelled' ? 'badge-red' : 'badge-amber';
    h += '<div>Vendor: <span class="badge ' + vstClass + '">' + esc(vendor.status || 'pending') + '</span></div>';
    var payClass = vendor.paymentStatus === 'paid' ? 'badge-green' : 'badge-amber';
    h += '<div>Payment: <span class="badge ' + payClass + '">' + esc(vendor.paymentStatus || 'unpaid') + '</span></div>';
    h += '</div></div>';

    // Quick stats
    h += '<div class="section"><h3>Quick Stats</h3>';
    h += '<div class="stats-grid">';
    h += '<div class="stat-card"><div class="stat-value">' + (wallet.coins || 0) + '</div><div class="stat-label">Coins</div></div>';
    h += '<div class="stat-card"><div class="stat-value">' + (wallet.tokens || 0) + '</div><div class="stat-label">Tokens</div></div>';
    h += '<div class="stat-card"><div class="stat-value">' + ads.filter(function(a) { return a.active; }).length + '</div><div class="stat-label">Active Ads</div></div>';
    h += '<div class="stat-card"><div class="stat-value">' + (portalData.promotions || []).filter(function(p) { return p.active; }).length + '</div><div class="stat-label">Active Promos</div></div>';
    h += '</div></div>';

    // Show page link
    if (show.slug) {
      h += '<div class="section">';
      h += '<p class="section-subtitle">Your listing is visible to attendees on the show page.</p>';
      h += '<a href="../show/' + esc(show.slug) + '" target="_blank" class="btn btn-primary btn-sm">View Show Page ↗</a>';
      h += '</div>';
    }

    return h;
  }

  // ══════════════════════════════════════════════════════════════════
  // PROFILE TAB
  // ══════════════════════════════════════════════════════════════════

  function renderProfileTab() {
    var vendor = portalData.vendor;

    var h = '<div class="section">';
    h += '<div class="section-header"><h3>Vendor Profile</h3>';
    if (!editingProfile) {
      h += '<button class="btn-link" onclick="vpStartEdit()">Edit</button>';
    } else {
      h += '<div style="display:flex;gap:8px;">';
      h += '<button class="btn-link muted" onclick="vpCancelEdit()">Cancel</button>';
      h += '<button class="btn-link" onclick="vpSaveProfile()">' + (savingProfile ? 'Saving...' : 'Save') + '</button>';
      h += '</div>';
    }
    h += '</div>';
    h += '<p class="section-subtitle">This info is visible to attendees on the show page.</p>';

    if (editingProfile) {
      // Logo upload
      h += '<div class="logo-area">';
      if (vendor.logoUrl) {
        h += '<img class="logo-img" src="' + esc(vendor.logoUrl) + '" alt="Logo" onerror="this.style.display=\'none\'">';
      } else {
        h += '<div class="logo-placeholder">' + esc((vendor.businessName || '?')[0].toUpperCase()) + '</div>';
      }
      h += '<div><input type="file" id="logoInput" accept="image/*" style="display:none" onchange="vpUploadLogo(this)">';
      h += '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'logoInput\').click()">Change Logo</button></div>';
      h += '</div>';

      // Edit form
      h += '<div class="form-group"><label class="form-label">Bio / Description</label>';
      h += '<textarea class="form-textarea" id="ep_bio">' + esc(vendor.bio || vendor.businessDescription || '') + '</textarea>';
      h += '</div>';
      h += '<div class="form-row">';
      h += formField('Website', 'ep_websiteUrl', vendor.websiteUrl);
      h += formField('Instagram', 'ep_instagramHandle', vendor.instagramHandle);
      h += '</div>';
      h += '<div class="form-group"><label class="form-label">Tags (comma-separated)</label>';
      h += '<input class="form-input" type="text" id="ep_tags" value="' + esc((vendor.tags || []).join(', ')) + '">';
      h += '<div class="form-hint">Help attendees find you — add keywords that describe what you sell</div></div>';
    } else {
      // View mode
      h += '<div class="profile-view">';
      h += '<div class="profile-header">';
      if (vendor.logoUrl) {
        h += '<img class="logo-img" src="' + esc(vendor.logoUrl) + '" alt="" onerror="this.style.display=\'none\'">';
      } else {
        h += '<div class="logo-placeholder">' + esc((vendor.businessName || '?')[0].toUpperCase()) + '</div>';
      }
      h += '<div><div class="profile-name">' + esc(vendor.businessName) + '</div>';
      h += '<div class="profile-category">' + esc(vendor.category || 'No category') + '</div></div>';
      h += '</div>';

      if (vendor.bio || vendor.businessDescription) {
        h += '<p class="profile-bio">' + esc(vendor.bio || vendor.businessDescription) + '</p>';
      }
      if (vendor.websiteUrl) h += '<p class="profile-link">🌐 ' + esc(vendor.websiteUrl.replace(/^https?:\/\//, '')) + '</p>';
      if (vendor.instagramHandle) h += '<p class="profile-link">📷 ' + esc(vendor.instagramHandle) + '</p>';

      if (vendor.tags && vendor.tags.length > 0) {
        h += '<div class="tag-list">';
        vendor.tags.forEach(function(t) { h += '<span class="tag">' + esc(t) + '</span>'; });
        h += '</div>';
      }

      if (!vendor.bio && !vendor.businessDescription && !vendor.websiteUrl && !(vendor.tags || []).length) {
        h += '<p class="empty-text italic">No profile details yet. Click Edit to add your info so attendees can learn about you!</p>';
      }

      h += '<button class="btn btn-preview" onclick="vpShowPreview()">👁️ Preview as Attendee</button>';
      h += '</div>';
    }

    h += '</div>';

    // Profile preview modal
    if (showProfilePreview) {
      h += renderProfilePreviewModal();
    }

    return h;
  }

  function renderProfilePreviewModal() {
    var vendor = portalData.vendor;
    var booth = portalData.booth;
    var promotions = (portalData.promotions || []).filter(function(p) { return p.active; });

    var h = '<div class="modal-overlay" onclick="vpClosePreview()">';
    h += '<div class="modal-content" onclick="event.stopPropagation()">';
    h += '<div class="modal-header">';
    h += '<div><h2 class="modal-title">' + esc(vendor.businessName) + '</h2>';
    h += '<div class="modal-subtitle">Attendee Preview</div></div>';
    h += '<button class="modal-close" onclick="vpClosePreview()">&times;</button>';
    h += '</div>';

    h += '<div class="modal-body">';
    if (vendor.logoUrl) {
      h += '<img src="' + esc(vendor.logoUrl) + '" alt="" class="preview-hero">';
    }
    h += '<div class="preview-meta">';
    if (vendor.category) h += '<span class="badge badge-blue">' + esc(vendor.category) + '</span>';
    if (booth) h += '<span class="preview-location">📍 ' + esc(booth.name) + (booth.location ? ' — ' + esc(booth.location) : '') + '</span>';
    h += '</div>';

    if (vendor.tags && vendor.tags.length > 0) {
      h += '<div class="tag-list">';
      vendor.tags.forEach(function(t) { h += '<span class="tag">' + esc(t) + '</span>'; });
      h += '</div>';
    } else {
      h += '<p class="empty-text italic small">No tags — add tags in Edit to help attendees find you!</p>';
    }

    if (vendor.bio || vendor.businessDescription) {
      h += '<p class="preview-bio">' + esc(vendor.bio || vendor.businessDescription) + '</p>';
    } else {
      h += '<p class="empty-text italic small">No bio — add one in Edit to tell attendees about your business!</p>';
    }

    if (vendor.websiteUrl) h += '<div class="profile-link">🌐 ' + esc(vendor.websiteUrl.replace(/^https?:\/\//, '')) + '</div>';
    if (vendor.instagramHandle) h += '<div class="profile-link">📷 ' + esc(vendor.instagramHandle) + '</div>';
    if (!vendor.websiteUrl && !vendor.instagramHandle) {
      h += '<p class="empty-text italic small">No links — add website or Instagram in Edit</p>';
    }

    if (promotions.length > 0) {
      h += '<div class="preview-promos"><h4>Active Deals</h4>';
      promotions.forEach(function(p) {
        h += '<div class="preview-promo-card">';
        h += '<div class="promo-value">' + (p.couponType === 'Fixed Amount' ? 'Save $' + (p.couponValue / 100).toFixed(2) : 'Save ' + p.couponValue + '%') + '</div>';
        h += '<code class="promo-code">' + esc(p.mastCouponCode) + '</code>';
        h += '</div>';
      });
      h += '</div>';
    }

    h += '</div></div></div>';
    return h;
  }

  // ══════════════════════════════════════════════════════════════════
  // PROMOTIONS TAB
  // ══════════════════════════════════════════════════════════════════

  function renderPromotionsTab() {
    var promotions = portalData.promotions || [];

    var h = '';
    h += '<div class="section-header-bar"><div>';
    h += '<p class="section-subtitle" style="margin:0;">Add coupon codes for attendees at this show.</p>';
    h += '</div>';
    h += '<button class="btn btn-primary btn-sm" onclick="vpShowPromoForm()">+ Add Promotion</button>';
    h += '</div>';

    // Add promo form
    if (showPromoForm) {
      h += '<div class="section highlight-border">';
      h += '<h3>New Promotion</h3>';
      h += '<div class="form-row">';
      h += '<div class="form-group"><label class="form-label">Coupon Code *</label>';
      h += '<input class="form-input" id="pf_code" value="' + esc(promoForm.mastCouponCode) + '" placeholder="e.g. SPRING20"></div>';
      h += '<div class="form-group"><label class="form-label">Type</label>';
      h += '<select class="form-input" id="pf_type">';
      h += '<option value="Percentage"' + (promoForm.couponType === 'Percentage' ? ' selected' : '') + '>Percentage Off</option>';
      h += '<option value="Fixed Amount"' + (promoForm.couponType === 'Fixed Amount' ? ' selected' : '') + '>Fixed Amount Off</option>';
      h += '</select></div>';
      h += '</div>';
      h += '<div class="form-group"><label class="form-label">Value *</label>';
      h += '<input class="form-input" type="number" id="pf_value" value="' + esc(promoForm.couponValue) + '" placeholder="e.g. 20" min="0" step="any"></div>';
      h += '<div class="form-group"><label class="form-label">Message for Attendees</label>';
      h += '<input class="form-input" id="pf_message" value="' + esc(promoForm.attendeeMessage) + '" placeholder="e.g. Show this code at checkout for your discount!"></div>';
      h += '<div class="form-actions">';
      h += '<button class="btn btn-secondary" onclick="vpCancelPromo()">Cancel</button>';
      h += '<button class="btn btn-primary" onclick="vpAddPromotion()">Add Promotion</button>';
      h += '</div></div>';
    }

    // Promo list
    if (promotions.length === 0 && !showPromoForm) {
      h += '<div class="empty-state"><div class="empty-icon">🏷️</div><div class="empty-title">No promotions yet</div>';
      h += '<div class="empty-subtitle">Add coupon codes to attract attendees to your booth.</div></div>';
    } else {
      promotions.forEach(function(p) {
        h += '<div class="section promo-card">';
        h += '<div class="promo-card-header">';
        h += '<div><div class="promo-card-code">';
        h += '<code>' + esc(p.mastCouponCode) + '</code>';
        h += '<span class="badge ' + (p.active ? 'badge-green' : 'badge-gray') + '">' + (p.active ? 'Active' : 'Inactive') + '</span>';
        h += '</div>';
        h += '<div class="promo-card-value">' + (p.couponType === 'Fixed Amount' ? '$' + (p.couponValue / 100).toFixed(2) + ' off' : p.couponValue + '% off') + '</div>';
        if (p.attendeeMessage) h += '<div class="promo-card-msg">' + esc(p.attendeeMessage) + '</div>';
        h += '</div>';
        h += '<div class="promo-card-actions">';
        h += '<button class="btn-link small" onclick="vpTogglePromo(\'' + esc(p.id) + '\')">' + (p.active ? 'Deactivate' : 'Activate') + '</button>';
        h += '<button class="btn-link small danger" onclick="vpDeletePromo(\'' + esc(p.id) + '\')">Delete</button>';
        h += '</div></div></div>';
      });
    }

    return h;
  }

  // ══════════════════════════════════════════════════════════════════
  // ADS TAB
  // ══════════════════════════════════════════════════════════════════

  function renderAdsTab() {
    var wallet = portalData.wallet || {};
    var ads = portalData.vendorAds || [];
    var transactions = portalData.transactions || [];
    var config = portalData.adConfig || {};
    var promotions = portalData.promotions || [];

    var h = '';

    // ── Your Ads ──
    h += '<div class="section">';
    h += '<div class="section-header">';
    h += '<h3>Your Ads</h3>';
    if ((wallet.tokens || 0) > 0) {
      h += '<button class="btn btn-primary btn-sm" onclick="vpShowAdForm()">+ Create Ad</button>';
    }
    h += '</div>';

    // Ad form
    if (showAdForm) {
      h += renderAdForm(promotions);
    }

    // Ads list
    if (ads.length > 0) {
      ads.forEach(function(ad) {
        h += '<div class="ad-card">';
        h += '<div class="ad-card-header">';
        h += '<div>';
        h += '<div class="ad-card-title">';
        h += '<span class="ad-headline">' + esc(ad.headline) + '</span>';
        h += '<span class="badge ' + (ad.active ? 'badge-green' : 'badge-gray') + '">' + (ad.active ? 'Active' : 'Paused') + '</span>';
        h += '<span class="badge badge-muted">' + (ad.type === 'promo' ? 'Promo' : 'General') + '</span>';
        h += '</div>';
        h += '<div class="ad-card-meta">' + (ad.tokensRemaining || 0) + '/' + (ad.tokensCommitted || 0) + ' impressions remaining';
        if (ad.imageUrl) h += ' <span class="text-muted">📷</span>';
        h += '</div></div>';
        h += '<div class="ad-card-actions">';
        h += '<button class="btn-link small" onclick="vpToggleAd(\'' + esc(ad.id) + '\')">' + (ad.active ? 'Pause' : 'Activate') + '</button>';
        h += '<button class="btn-link small" onclick="vpEditAd(\'' + esc(ad.id) + '\')">Edit</button>';
        h += '<button class="btn-link small amber" onclick="vpToggleTopUp(\'' + esc(ad.id) + '\')">Top Up</button>';
        h += '<button class="btn-link small danger" onclick="vpDeleteAd(\'' + esc(ad.id) + '\')">Delete</button>';
        h += '</div></div>';

        // Progress bar
        var pct = ad.tokensCommitted > 0 ? (ad.tokensRemaining / ad.tokensCommitted * 100) : 0;
        h += '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>';

        // Top-up form
        if (topUpAdId === ad.id) {
          h += '<div class="topup-form">';
          h += '<div class="form-group" style="flex:1;margin:0;"><label class="form-label">Tokens to add (' + (wallet.tokens || 0) + ' available)</label>';
          h += '<input type="number" class="form-input" id="topup_amount" value="' + esc(topUpAmount) + '" min="1" max="' + (wallet.tokens || 0) + '" placeholder="e.g. 50"></div>';
          h += '<button class="btn btn-primary" onclick="vpTopUpAd(\'' + esc(ad.id) + '\')">Add Tokens</button>';
          h += '</div>';
        }

        h += '</div>';
      });
    } else if (!showAdForm) {
      h += '<p class="empty-text centered">' + ((wallet.tokens || 0) > 0 ? 'No ads yet. Create your first ad to reach attendees!' : 'Convert coins to tokens first, then create ads.') + '</p>';
    }
    h += '</div>';

    // ── Wallet Card ──
    h += '<div class="section">';
    h += '<h3>Ad Wallet</h3>';
    h += '<div class="wallet-grid">';
    h += '<div class="wallet-card amber"><div class="wallet-amount">' + (wallet.coins || 0) + '</div>';
    h += '<div class="wallet-label">Coins</div><div class="wallet-sub">$1 each</div></div>';
    h += '<div class="wallet-card indigo"><div class="wallet-amount">' + (wallet.tokens || 0) + '</div>';
    h += '<div class="wallet-label">Ad Tokens</div><div class="wallet-sub">1 token = 1 impression</div></div>';
    h += '</div>';
    if ((wallet.totalTokensSpent || 0) > 0 || (wallet.totalCoinsPurchased || 0) > 0) {
      h += '<div class="wallet-stats">Spent: ' + (wallet.totalTokensSpent || 0) + ' tokens · Purchased: ' + (wallet.totalCoinsPurchased || 0) + ' coins</div>';
    }
    h += '</div>';

    // ── Buy Coins ──
    h += '<div class="section">';
    h += '<h3>Buy Coins</h3>';
    h += '<p class="section-subtitle">1 coin = $1 USD. Min ' + (config.minCoinPurchase || 10) + ', max ' + (config.maxCoinPurchase || 100) + '.</p>';
    h += '<div class="inline-form">';
    h += '<div class="form-group" style="flex:1;margin:0;"><label class="form-label">Quantity</label>';
    h += '<input type="number" class="form-input" id="buy_coins" value="' + coinAmount + '" min="' + (config.minCoinPurchase || 10) + '" max="' + (config.maxCoinPurchase || 100) + '"></div>';
    h += '<div class="coin-price">$' + coinAmount + '</div>';
    h += '<button class="btn btn-primary" onclick="vpBuyCoins()"' + (purchasing ? ' disabled' : '') + '>' + (purchasing ? 'Redirecting...' : 'Purchase') + '</button>';
    h += '</div></div>';

    // ── Convert Coins ──
    if ((wallet.coins || 0) > 0) {
      var rate = config.coinToTokenRate || config.tokenRate || 100;
      h += '<div class="section">';
      h += '<h3>Convert Coins to Tokens</h3>';
      h += '<p class="section-subtitle">Rate: 1 coin = ' + rate + ' tokens. You have ' + (wallet.coins || 0) + ' coins available.</p>';
      h += '<div class="inline-form">';
      h += '<div class="form-group" style="flex:1;margin:0;"><label class="form-label">Coins to convert</label>';
      h += '<input type="number" class="form-input" id="convert_coins" value="' + esc(convertAmount) + '" min="1" max="' + (wallet.coins || 0) + '" placeholder="e.g. 10"></div>';
      if (convertAmount && parseInt(convertAmount, 10) > 0) {
        h += '<div class="convert-preview">= ' + (parseInt(convertAmount, 10) * rate) + ' tokens</div>';
      }
      h += '<button class="btn btn-primary" onclick="vpConvertCoins()"' + (converting ? ' disabled' : '') + '>' + (converting ? 'Converting...' : 'Convert') + '</button>';
      h += '</div></div>';
    }

    // ── Transaction History ──
    if (transactions.length > 0) {
      h += '<div class="section">';
      h += '<h3>Transaction History</h3>';
      h += '<div class="tx-list">';
      transactions.forEach(function(tx) {
        h += '<div class="tx-item">';
        h += '<div><div class="tx-desc-text">' + esc(tx.description || tx.type) + '</div>';
        h += '<div class="tx-date">' + (tx.timestamp ? new Date(tx.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '') + '</div></div>';
        var isPositive = tx.amount > 0 || tx.type === 'purchase' || tx.type === 'earn';
        h += '<div class="tx-amount ' + (isPositive ? 'positive' : 'negative') + '">' + (isPositive ? '+' : '') + tx.amount + ' ' + esc(tx.currency || '') + '</div>';
        h += '</div>';
      });
      h += '</div></div>';
    }

    // Empty state
    if ((wallet.totalCoinsPurchased || 0) === 0 && ads.length === 0 && !showAdForm) {
      h += '<div class="empty-state"><div class="empty-icon">📢</div><div class="empty-title">Advertise to attendees</div>';
      h += '<div class="empty-subtitle">Buy coins, convert to ad tokens, and create ads that appear when attendees browse the show.</div></div>';
    }

    return h;
  }

  function renderAdForm(promotions) {
    var vendor = portalData.vendor;
    var booth = portalData.booth;
    var wallet = portalData.wallet || {};
    var activePromos = promotions.filter(function(p) { return p.active; });

    var h = '<div class="ad-form-container">';
    h += '<h4>' + (editingAdId ? 'Edit Ad' : 'New Ad') + '</h4>';

    // Type
    h += '<div class="form-group"><label class="form-label">Ad Type</label>';
    h += '<select class="form-input" id="af_type" onchange="vpAdTypeChange(this.value)">';
    h += '<option value="general"' + (adForm.type === 'general' ? ' selected' : '') + '>General</option>';
    h += '<option value="promo"' + (adForm.type === 'promo' ? ' selected' : '') + '>Promotion</option>';
    h += '</select></div>';

    // Linked promotion
    if (adForm.type === 'promo') {
      h += '<div class="form-group"><label class="form-label">Linked Promotion *</label>';
      h += '<select class="form-input" id="af_promoId">';
      h += '<option value="">Select a promotion...</option>';
      activePromos.forEach(function(p) {
        var label = p.mastCouponCode + ' — ' + (p.couponType === 'Fixed Amount' ? '$' + (p.couponValue / 100).toFixed(2) + ' off' : p.couponValue + '% off');
        h += '<option value="' + esc(p.id) + '"' + (adForm.promotionId === p.id ? ' selected' : '') + '>' + esc(label) + '</option>';
      });
      h += '</select></div>';
    }

    // Headline
    h += '<div class="form-group"><label class="form-label">Headline (max 80 chars) *</label>';
    h += '<input class="form-input" id="af_headline" value="' + esc(adForm.headline) + '" maxlength="80" placeholder="e.g. 20% off all handmade jewelry today!" oninput="vpAdHeadlineChange(this.value)">';
    h += '<div class="form-hint text-right" id="af_charcount">' + (adForm.headline || '').length + '/80</div></div>';

    // Image
    h += '<div class="form-group"><label class="form-label">Ad Image (optional, max 2MB)</label>';
    if (adForm.imageUrl) {
      h += '<div class="ad-image-preview"><img src="' + esc(adForm.imageUrl) + '" alt="Ad preview">';
      h += '<button class="ad-image-remove" onclick="vpRemoveAdImage()">&times;</button></div>';
    } else {
      h += '<label class="btn btn-secondary btn-sm" style="cursor:pointer;">';
      h += (uploadingAdImage ? 'Uploading...' : 'Upload Image');
      h += '<input type="file" accept="image/*" style="display:none" onchange="vpUploadAdImage(this)"' + (uploadingAdImage ? ' disabled' : '') + '>';
      h += '</label>';
      h += '<div class="form-hint">Displayed at full width in the ad card</div>';
    }
    h += '</div>';

    // Token commitment (new ads only)
    if (!editingAdId) {
      h += '<div class="form-group"><label class="form-label">Token Commitment (' + (wallet.tokens || 0) + ' available) *</label>';
      h += '<input type="number" class="form-input" id="af_tokens" value="' + adForm.tokensCommitted + '" min="1" max="' + (wallet.tokens || 0) + '" placeholder="How many impressions to fund">';
      h += '<div class="form-hint">Each token = 1 ad impression shown to an attendee</div></div>';
    }

    // Live preview
    h += '<div class="ad-preview-section"><div class="ad-preview-label">PREVIEW — what attendees will see</div>';
    h += '<div class="ad-preview-card">';
    h += '<div class="ad-preview-sponsored">Sponsored</div>';
    h += '<div class="ad-preview-body">';
    h += '<div class="ad-preview-vendor">';
    if (vendor.logoUrl) {
      h += '<img src="' + esc(vendor.logoUrl) + '" alt="" class="ad-preview-logo">';
    } else {
      h += '<div class="ad-preview-logo-placeholder">🏪</div>';
    }
    h += '<div><div class="ad-preview-name">' + esc(vendor.businessName) + '</div>';
    h += '<div class="ad-preview-meta">' + esc(vendor.category || '');
    if (booth) h += ' · 📍 ' + esc(booth.name) + (booth.location ? ' — ' + esc(booth.location) : '');
    h += '</div></div></div>';
    if (adForm.imageUrl) {
      h += '<img src="' + esc(adForm.imageUrl) + '" alt="" class="ad-preview-image">';
    }
    h += '<h3 class="ad-preview-headline">' + (adForm.headline ? esc(adForm.headline) : '<span class="text-muted italic">Your headline here...</span>') + '</h3>';

    // Linked promo in preview
    if (adForm.type === 'promo' && adForm.promotionId) {
      var linkedP = promotions.find(function(p) { return p.id === adForm.promotionId; });
      if (linkedP) {
        h += '<div class="ad-preview-promo">';
        h += '<div class="promo-value">' + (linkedP.couponType === 'Fixed Amount' ? 'Save $' + (linkedP.couponValue / 100).toFixed(2) : 'Save ' + linkedP.couponValue + '%') + '</div>';
        h += '<code class="promo-code">' + esc(linkedP.mastCouponCode) + '</code>';
        h += '</div>';
      }
    }
    h += '</div></div></div>';

    // Buttons
    h += '<div class="form-actions">';
    h += '<button class="btn btn-secondary" onclick="vpCancelAdForm()">Cancel</button>';
    h += '<button class="btn btn-primary" onclick="vpSaveAd()"' + (savingAd ? ' disabled' : '') + '>' + (savingAd ? 'Saving...' : editingAdId ? 'Update Ad' : 'Create Ad') + '</button>';
    h += '</div></div>';

    return h;
  }

  // ══════════════════════════════════════════════════════════════════
  // ANNOUNCEMENTS TAB
  // ══════════════════════════════════════════════════════════════════

  function renderAnnouncementsTab() {
    var announcements = portalData.announcements || [];
    var h = '';

    if (announcements.length === 0) {
      h += '<div class="empty-state"><div class="empty-icon">📢</div><div class="empty-title">No announcements</div>';
      h += '<div class="empty-subtitle">Organizer announcements will appear here.</div></div>';
      return h;
    }

    announcements.forEach(function(a) {
      h += '<div class="section announcement-card' + (a.priority === 'high' ? ' high-priority' : '') + '">';
      if (a.title) h += '<h3>' + esc(a.title) + '</h3>';
      h += '<p class="announcement-body">' + esc(a.body) + '</p>';
      if (a.createdAt) h += '<div class="announcement-date">' + formatDate(a.createdAt) + '</div>';
      h += '</div>';
    });

    return h;
  }

  // ══════════════════════════════════════════════════════════════════
  // FORM HELPERS
  // ══════════════════════════════════════════════════════════════════

  function infoItem(label, value) {
    return '<div class="info-item"><div class="info-label">' + esc(label) + '</div><div class="info-value">' + esc(value || '—') + '</div></div>';
  }

  function formField(label, id, value) {
    return '<div class="form-group"><label class="form-label">' + esc(label) + '</label><input class="form-input" type="text" id="' + id + '" value="' + esc(value || '') + '"></div>';
  }

  // ══════════════════════════════════════════════════════════════════
  // ACTIONS — Tab Navigation
  // ══════════════════════════════════════════════════════════════════

  window.vpSetTab = function(t) { activeTab = t; clearMsg(); render(); };
  window.vpClearMsg = function() { clearMsg(); render(); };

  // ══════════════════════════════════════════════════════════════════
  // ACTIONS — Profile
  // ══════════════════════════════════════════════════════════════════

  window.vpStartEdit = function() { editingProfile = true; render(); };
  window.vpCancelEdit = function() { editingProfile = false; render(); };
  window.vpShowPreview = function() { showProfilePreview = true; render(); };
  window.vpClosePreview = function() { showProfilePreview = false; render(); };

  window.vpSaveProfile = function() {
    savingProfile = true;
    render();

    var profile = {
      bio: document.getElementById('ep_bio').value.trim(),
      websiteUrl: document.getElementById('ep_websiteUrl').value.trim(),
      instagramHandle: document.getElementById('ep_instagramHandle').value.trim(),
      tags: document.getElementById('ep_tags').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
    };

    apiCall(FUNCTIONS_BASE + '/eventsVendorUpdate', { token: token, action: 'updateProfile', profile: profile })
      .then(function() {
        Object.assign(portalData.vendor, profile);
        editingProfile = false;
        savingProfile = false;
        showMsg('success', 'Profile updated!');
      })
      .catch(function(err) {
        savingProfile = false;
        showMsg('error', 'Failed to save: ' + err.message);
      });
  };

  window.vpUploadLogo = function(input) {
    if (!input.files || !input.files[0]) return;
    showMsg('success', 'Uploading logo...');

    window.TENANT_READY.then(function() {
      var fbApp;
      try { fbApp = firebase.app('vendor-upload'); } catch (e) {
        fbApp = firebase.initializeApp(window.TENANT_FIREBASE_CONFIG, 'vendor-upload');
      }
      var storage = fbApp.storage();
      var file = input.files[0];
      var ext = file.name.split('.').pop() || 'jpg';
      var path = window.TENANT_ID + '/events/vendors/' + portalData.show.id + '/' + portalData.vendor.id + '/logo.' + ext;
      storage.ref(path).put(file).then(function(snap) {
        return snap.ref.getDownloadURL();
      }).then(function(url) {
        portalData.vendor.logoUrl = url;
        // Also save to server
        apiCall(FUNCTIONS_BASE + '/eventsVendorUpdate', { token: token, action: 'updateProfile', profile: { logoUrl: url } })
          .catch(function() {}); // Best-effort server sync
        showMsg('success', 'Logo uploaded!');
      }).catch(function(err) {
        showMsg('error', 'Logo upload failed: ' + err.message);
      });
    });
  };

  // ══════════════════════════════════════════════════════════════════
  // ACTIONS — Promotions
  // ══════════════════════════════════════════════════════════════════

  window.vpShowPromoForm = function() { showPromoForm = true; promoForm = { mastCouponCode: '', couponType: 'Percentage', couponValue: '', attendeeMessage: '' }; render(); };
  window.vpCancelPromo = function() { showPromoForm = false; render(); };

  window.vpAddPromotion = function() {
    var code = document.getElementById('pf_code').value.trim();
    var type = document.getElementById('pf_type').value;
    var value = document.getElementById('pf_value').value;
    var message = document.getElementById('pf_message').value.trim();

    if (!code) { showMsg('error', 'Enter a coupon code'); return; }
    if (!value || parseFloat(value) <= 0) { showMsg('error', 'Enter a valid value'); return; }

    apiCall(FUNCTIONS_BASE + '/eventsVendorUpdate', {
      token: token, action: 'addPromotion',
      promotion: { mastCouponCode: code, couponType: type, couponValue: value, attendeeMessage: message }
    })
    .then(function(d) {
      portalData.promotions.push(d.promotion);
      showPromoForm = false;
      showMsg('success', 'Promotion added!');
    })
    .catch(function(err) { showMsg('error', 'Failed: ' + err.message); });
  };

  window.vpTogglePromo = function(promoId) {
    apiCall(FUNCTIONS_BASE + '/eventsVendorUpdate', { token: token, action: 'togglePromotion', promoId: promoId })
    .then(function(d) {
      portalData.promotions = portalData.promotions.map(function(p) {
        return p.id === promoId ? Object.assign({}, p, { active: d.active }) : p;
      });
      showMsg('success', d.active ? 'Promotion activated' : 'Promotion deactivated');
    })
    .catch(function(err) { showMsg('error', 'Failed: ' + err.message); });
  };

  window.vpDeletePromo = function(promoId) {
    if (!confirm('Delete this promotion?')) return;
    apiCall(FUNCTIONS_BASE + '/eventsVendorUpdate', { token: token, action: 'deletePromotion', promoId: promoId })
    .then(function() {
      portalData.promotions = portalData.promotions.filter(function(p) { return p.id !== promoId; });
      showMsg('success', 'Promotion removed');
    })
    .catch(function(err) { showMsg('error', 'Failed: ' + err.message); });
  };

  // ══════════════════════════════════════════════════════════════════
  // ACTIONS — Ads
  // ══════════════════════════════════════════════════════════════════

  window.vpShowAdForm = function() {
    showAdForm = true;
    editingAdId = null;
    adForm = { type: 'general', promotionId: '', headline: '', imageUrl: '', tokensCommitted: 50 };
    render();
  };
  window.vpCancelAdForm = function() { showAdForm = false; editingAdId = null; render(); };

  window.vpAdTypeChange = function(val) { adForm.type = val; adForm.promotionId = ''; render(); };
  window.vpAdHeadlineChange = function(val) {
    adForm.headline = val;
    var el = document.getElementById('af_charcount');
    if (el) el.textContent = val.length + '/80';
  };
  window.vpRemoveAdImage = function() { adForm.imageUrl = ''; render(); };

  window.vpEditAd = function(adId) {
    var ad = portalData.vendorAds.find(function(a) { return a.id === adId; });
    if (!ad) return;
    showAdForm = true;
    editingAdId = adId;
    adForm = { type: ad.type || 'general', promotionId: ad.promotionId || ad.linkedCouponId || '', headline: ad.headline || '', imageUrl: ad.imageUrl || '', tokensCommitted: ad.tokensCommitted || 0 };
    render();
  };

  window.vpSaveAd = function() {
    var headline = document.getElementById('af_headline').value.trim();
    if (!headline) { showMsg('error', 'Enter a headline'); return; }
    if (headline.length > 80) { showMsg('error', 'Headline must be 80 characters or less'); return; }

    var type = document.getElementById('af_type').value;
    var promotionId = '';
    if (type === 'promo') {
      var promoEl = document.getElementById('af_promoId');
      promotionId = promoEl ? promoEl.value : '';
      if (!promotionId) { showMsg('error', 'Select a promotion'); return; }
    }

    var tokensCommitted = 0;
    if (!editingAdId) {
      tokensCommitted = parseInt(document.getElementById('af_tokens').value, 10) || 0;
      if (tokensCommitted <= 0) { showMsg('error', 'Enter token commitment'); return; }
      if (tokensCommitted > (portalData.wallet || {}).tokens) { showMsg('error', 'Not enough tokens'); return; }
    }

    savingAd = true;
    render();

    var body = {
      token: token,
      action: editingAdId ? 'update' : 'create',
      ad: { type: type, promotionId: promotionId, headline: headline, imageUrl: adForm.imageUrl, tokensCommitted: tokensCommitted }
    };
    if (editingAdId) body.adId = editingAdId;

    apiCall(FUNCTIONS_BASE + '/eventsManageAd', body)
    .then(function() {
      savingAd = false;
      showAdForm = false;
      editingAdId = null;
      adForm = { type: 'general', promotionId: '', headline: '', imageUrl: '', tokensCommitted: 50 };
      showMsg('success', editingAdId ? 'Ad updated!' : 'Ad created!');
      reloadWalletData();
    })
    .catch(function(err) {
      savingAd = false;
      showMsg('error', 'Failed: ' + err.message);
    });
  };

  window.vpDeleteAd = function(adId) {
    if (!confirm('Delete this ad? Remaining tokens will be refunded.')) return;
    apiCall(FUNCTIONS_BASE + '/eventsManageAd', { token: token, action: 'delete', adId: adId })
    .then(function(d) {
      portalData.vendorAds = portalData.vendorAds.filter(function(a) { return a.id !== adId; });
      showMsg('success', 'Ad deleted. ' + (d.tokensRefunded || 0) + ' tokens refunded.');
      reloadWalletData();
    })
    .catch(function(err) { showMsg('error', 'Failed: ' + err.message); });
  };

  window.vpToggleAd = function(adId) {
    var ad = portalData.vendorAds.find(function(a) { return a.id === adId; });
    if (!ad) return;
    apiCall(FUNCTIONS_BASE + '/eventsManageAd', { token: token, action: 'update', adId: adId, ad: { active: !ad.active } })
    .then(function() {
      portalData.vendorAds = portalData.vendorAds.map(function(a) {
        return a.id === adId ? Object.assign({}, a, { active: !a.active }) : a;
      });
      showMsg('success', ad.active ? 'Ad paused' : 'Ad activated');
    })
    .catch(function(err) { showMsg('error', 'Failed: ' + err.message); });
  };

  window.vpToggleTopUp = function(adId) {
    topUpAdId = topUpAdId === adId ? null : adId;
    topUpAmount = '';
    render();
  };

  window.vpTopUpAd = function(adId) {
    var amt = parseInt(document.getElementById('topup_amount').value, 10);
    if (!amt || amt <= 0) { showMsg('error', 'Enter a valid amount'); return; }
    if (amt > (portalData.wallet || {}).tokens) { showMsg('error', 'Not enough tokens'); return; }

    apiCall(FUNCTIONS_BASE + '/eventsManageAd', { token: token, action: 'update', adId: adId, ad: { addTokens: amt } })
    .then(function() {
      topUpAdId = null;
      topUpAmount = '';
      showMsg('success', 'Added ' + amt + ' tokens to ad!');
      reloadWalletData();
    })
    .catch(function(err) { showMsg('error', 'Failed: ' + err.message); });
  };

  window.vpUploadAdImage = function(input) {
    var file = input.files && input.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 2 * 1024 * 1024) { showMsg('error', 'Image must be under 2MB'); return; }

    uploadingAdImage = true;
    render();

    window.TENANT_READY.then(function() {
      var fbApp;
      try { fbApp = firebase.app('vendor-upload'); } catch (e) {
        fbApp = firebase.initializeApp(window.TENANT_FIREBASE_CONFIG, 'vendor-upload');
      }
      var storage = fbApp.storage();
      var ext = file.name.split('.').pop() || 'jpg';
      var adImageId = editingAdId || Date.now();
      var path = window.TENANT_ID + '/events/ads/' + portalData.show.id + '/' + portalData.vendor.id + '/' + adImageId + '.' + ext;
      storage.ref(path).put(file).then(function(snap) {
        return snap.ref.getDownloadURL();
      }).then(function(url) {
        adForm.imageUrl = url;
        uploadingAdImage = false;
        showMsg('success', 'Image uploaded!');
      }).catch(function(err) {
        uploadingAdImage = false;
        showMsg('error', 'Image upload failed: ' + err.message);
      });
    });
  };

  // ══════════════════════════════════════════════════════════════════
  // ACTIONS — Wallet
  // ══════════════════════════════════════════════════════════════════

  window.vpBuyCoins = function() {
    var config = portalData.adConfig || {};
    var amount = parseInt(document.getElementById('buy_coins').value, 10);
    if (!amount || amount < (config.minCoinPurchase || 10)) { showMsg('error', 'Minimum purchase is ' + (config.minCoinPurchase || 10) + ' coins'); return; }
    if (amount > (config.maxCoinPurchase || 100)) { showMsg('error', 'Maximum purchase is ' + (config.maxCoinPurchase || 100) + ' coins'); return; }

    purchasing = true;
    coinAmount = amount;
    render();

    apiCall(FUNCTIONS_BASE + '/eventsPurchaseCoins', { token: token, coinAmount: amount })
    .then(function(d) {
      if (d.checkoutUrl) {
        window.location.href = d.checkoutUrl;
      } else {
        purchasing = false;
        showMsg('error', 'Failed to start checkout');
      }
    })
    .catch(function(err) {
      purchasing = false;
      showMsg('error', 'Failed: ' + err.message);
    });
  };

  window.vpConvertCoins = function() {
    var amt = parseInt(document.getElementById('convert_coins').value, 10);
    if (!amt || amt <= 0) { showMsg('error', 'Enter a valid amount'); return; }
    if (amt > (portalData.wallet || {}).coins) { showMsg('error', 'Not enough coins'); return; }

    converting = true;
    convertAmount = '' + amt;
    render();

    apiCall(FUNCTIONS_BASE + '/eventsConvertCoins', { token: token, coinAmount: amt })
    .then(function(d) {
      converting = false;
      convertAmount = '';
      if (d.error) {
        showMsg('error', d.error);
      } else {
        portalData.wallet.coins = d.coins !== undefined ? d.coins : d.newCoinBalance;
        portalData.wallet.tokens = d.tokens !== undefined ? d.tokens : d.newTokenBalance;
        showMsg('success', 'Converted! ' + portalData.wallet.coins + ' coins, ' + portalData.wallet.tokens + ' tokens.');
        reloadWalletData();
      }
    })
    .catch(function(err) {
      converting = false;
      showMsg('error', 'Failed: ' + err.message);
    });
  };

  // ══════════════════════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════════════════════

  window.TENANT_READY ? window.TENANT_READY.then(init) : init();
})();
