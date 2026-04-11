/**
 * Channels Module — Multi-channel sales management.
 * Lazy-loaded via MastAdmin module registry.
 *
 * Data model: admin/channels/{channelId}
 * Route: channels (in Manage section)
 *
 * Loaded skills before writing: admin-design-system.md (19 rules),
 * cc-lens-security (XSS via esc()), reference implementations
 * (customers.js Paradigm A, consignment.js list→detail).
 *
 * All user data escaped with esc(). CSS vars only. Font scale: 7 rem sizes.
 * Paradigm A edit mode. MastNavStack + MastDirty.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var channelsData = {};       // channelId → channel object
  var channelsLoaded = false;
  var productsData = {};       // pid → product (for product counts + products tab)
  var productsLoaded = false;
  var currentView = 'list';    // 'list' | 'detail' | 'new' | 'dashboard'
  var selectedChannelId = null;
  var detailTab = 'overview';  // 'overview' | 'products' | 'activity' | 'settings'
  var channelEditMode = false; // Paradigm A — read-only until user clicks Edit
  var editBaseline = null;     // snapshot for dirty check
  var ordersData = {};         // for activity tab
  var salesData = {};          // for dashboard P&L
  var consignmentsData = {};   // for dashboard P&L
  var salesEventsData = {};    // for craft fair comparison
  var salesEventsLoaded = false;
  var liveSessionsData = {};   // for social_live session history
  var liveSessionsLoaded = false;
  var dashboardPeriod = '30d'; // '7d' | '30d' | '90d' | 'ytd' | 'all'
  var dashboardSort = { col: 'netRevenue', asc: false };
  var eventCompSort = { col: 'roi', asc: false };

  var formatCurrency = typeof formatPriceCents === 'function'
    ? function(cents) { return formatPriceCents(cents); }
    : function(c) { return '$' + ((c || 0) / 100).toFixed(2); };

  // ============================================================
  // Channel type metadata
  // ============================================================

  var CHANNEL_TYPES = {
    dtc_online:       { label: 'Online Store',    color: '#3b82f6', ownership: 'owned',   pricing: 'full_retail',  inventory: 'retained' },
    own_storefront:   { label: 'Own Storefront',  color: '#14b8a6', ownership: 'owned',   pricing: 'full_retail',  inventory: 'retained' },
    mobile_events:    { label: 'Craft Fairs',     color: '#f97316', ownership: 'owned',   pricing: 'full_retail',  inventory: 'retained' },
    marketplace:      { label: 'Marketplace',     color: '#8b5cf6', ownership: 'partner', pricing: 'full_retail',  inventory: 'synced' },
    wholesale_prebuy: { label: 'Wholesale',       color: '#22c55e', ownership: 'partner', pricing: 'wholesale',    inventory: 'transferred' },
    consignment:      { label: 'Consignment',     color: '#f59e0b', ownership: 'partner', pricing: 'negotiated',   inventory: 'consigned' },
    retail_prebuy:    { label: 'Retail Prebuy',   color: '#10b981', ownership: 'partner', pricing: 'wholesale',    inventory: 'transferred' },
    social_live:      { label: 'Social / Live',   color: '#ec4899', ownership: 'partner', pricing: 'full_retail',  inventory: 'retained' }
  };

  var DETAIL_TABS = [
    { value: 'overview',  label: 'Overview' },
    { value: 'products',  label: 'Products' },
    { value: 'activity',  label: 'Activity' },
    { value: 'settings',  label: 'Settings' }
  ];

  // ============================================================
  // Helpers
  // ============================================================

  function typeBadge(type) {
    var t = CHANNEL_TYPES[type] || { label: type || 'Unknown', color: '#6b7280' };
    return '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;' +
      'background:' + t.color + '22;color:' + t.color + ';">' + esc(t.label) + '</span>';
  }

  function statusDot(isActive) {
    var color = isActive !== false ? '#22c55e' : '#9ca3af';
    var label = isActive !== false ? 'Active' : 'Paused';
    return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;color:' + color + ';">' +
      '<span style="width:8px;height:8px;border-radius:50%;background:' + color + ';display:inline-block;" aria-hidden="true"></span>' +
      label + '</span>';
  }

  function feeSummary(ch) {
    var parts = [];
    if (ch.percentFee) parts.push(parseFloat(ch.percentFee).toFixed(1) + '%');
    if (ch.fixedFeePerOrderCents) parts.push(formatCurrency(ch.fixedFeePerOrderCents) + '/order');
    if (ch.monthlyFixedCents) parts.push(formatCurrency(ch.monthlyFixedCents) + '/mo');
    return parts.length ? parts.join(' + ') : 'No fees';
  }

  function productCountForChannel(channelId) {
    if (!productsLoaded) return 0;
    var count = 0;
    Object.values(productsData).forEach(function(p) {
      if (p.channelIds && Array.isArray(p.channelIds) && p.channelIds.indexOf(channelId) !== -1) count++;
    });
    return count;
  }

  function getProductsForChannel(channelId) {
    if (!productsLoaded) return [];
    return Object.values(productsData).filter(function(p) {
      return p.channelIds && Array.isArray(p.channelIds) && p.channelIds.indexOf(channelId) !== -1;
    });
  }

  function relativeTime(isoStr) {
    if (!isoStr) return '—';
    var d = new Date(isoStr);
    var now = new Date();
    var diffMs = now - d;
    var diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return diffMin + 'm ago';
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    var diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return diffDay + 'd ago';
    return d.toLocaleDateString();
  }

  // ============================================================
  // Data Layer
  // ============================================================

  function loadChannels() {
    if (channelsLoaded) { renderCurrentView(); return; }
    var tab = document.getElementById('channelsTab');
    if (tab) tab.innerHTML = '<div style="text-align:center;padding:40px;color:#999;font-size:0.9rem;">Loading channels...</div>';

    MastDB._ref('admin/channels').once('value').then(function(snap) {
      channelsData = snap.val() || {};
      channelsLoaded = true;
      loadProducts().then(function() {
        renderCurrentView();
      });
    }).catch(function(err) {
      console.error('Error loading channels:', err);
      if (tab) tab.innerHTML = '<div style="text-align:center;padding:40px;color:#dc3545;font-size:0.9rem;">Error loading channels.</div>';
    });
  }

  function loadProducts() {
    if (productsLoaded) return Promise.resolve();
    return MastDB._ref('public/products').once('value').then(function(snap) {
      productsData = snap.val() || {};
      productsLoaded = true;
    }).catch(function(err) {
      console.error('Error loading products:', err);
      productsLoaded = true; // continue without products
    });
  }

  function loadOrders() {
    return MastDB._ref('public/orders').orderByChild('createdAt').limitToLast(200).once('value').then(function(snap) {
      ordersData = snap.val() || {};
    }).catch(function(err) {
      console.error('Error loading orders:', err);
      ordersData = {};
    });
  }

  function loadSalesEvents() {
    if (salesEventsLoaded) return Promise.resolve();
    return Promise.all([
      MastDB._ref('admin/salesEvents').once('value').then(function(snap) {
        salesEventsData = snap.val() || {};
      }).catch(function(err) {
        console.error('Error loading sales events:', err);
        salesEventsData = {};
      }),
      MastDB._ref('admin/sales').orderByChild('timestamp').limitToLast(500).once('value').then(function(snap) {
        salesData = snap.val() || {};
      }).catch(function() { salesData = {}; })
    ]).then(function() {
      salesEventsLoaded = true;
    });
  }

  function unloadChannels() {
    channelsData = {};
    channelsLoaded = false;
    productsData = {};
    productsLoaded = false;
    ordersData = {};
    salesData = {};
    consignmentsData = {};
    salesEventsData = {};
    salesEventsLoaded = false;
    liveSessionsData = {};
    liveSessionsLoaded = false;
    currentView = 'list';
    selectedChannelId = null;
    detailTab = 'overview';
    channelEditMode = false;
    editBaseline = null;
    dashboardPeriod = '30d';
    dashboardSort = { col: 'netRevenue', asc: false };
    if (window.MastDirty) { try { MastDirty.unregister('channelEdit'); } catch (e) {} }
  }

  // ============================================================
  // View Router
  // ============================================================

  function renderCurrentView() {
    if (currentView === 'dashboard') {
      renderDashboard();
    } else if (currentView === 'detail' && selectedChannelId) {
      renderDetail();
    } else if (currentView === 'new') {
      renderNewForm();
    } else {
      renderList();
    }
  }

  // ============================================================
  // List View
  // ============================================================

  function renderList() {
    var tab = document.getElementById('channelsTab');
    if (!tab) return;

    var channels = Object.values(channelsData).sort(function(a, b) {
      if ((a.isActive !== false) && (b.isActive === false)) return -1;
      if ((a.isActive === false) && (b.isActive !== false)) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    // Apply filters
    var searchEl = document.getElementById('chSearchInput');
    var typeEl = document.getElementById('chTypeFilter');
    var searchVal = searchEl ? searchEl.value.toLowerCase() : '';
    var typeVal = typeEl ? typeEl.value : '';

    var filtered = channels.filter(function(ch) {
      if (searchVal && (ch.name || '').toLowerCase().indexOf(searchVal) === -1) return false;
      if (typeVal && ch.type !== typeVal) return false;
      return true;
    });

    if (!channels.length) {
      tab.innerHTML =
        '<div style="text-align:center;padding:40px 20px;color:#999;">' +
          '<div style="font-size:1.6rem;margin-bottom:12px;">📡</div>' +
          '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No sales channels yet</p>' +
          '<p style="font-size:0.85rem;color:#666;">Add your first channel to start tracking multi-channel sales.</p>' +
          '<button class="btn btn-primary" style="margin-top:16px;" onclick="channelShowNew()">+ New Channel</button>' +
        '</div>';
      return;
    }

    var h = '';

    // Header
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">Channels</h3>';
    h += '<div style="display:flex;gap:8px;">';
    h += '<button class="btn btn-secondary" onclick="channelShowDashboard()">Dashboard</button>';
    h += '<button class="btn btn-primary" onclick="channelShowNew()">+ New Channel</button>';
    h += '</div>';
    h += '</div>';

    // Filter bar
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">';
    h += '<input type="text" id="chSearchInput" placeholder="Search channels\u2026" oninput="channelRerender()"' +
      ' value="' + esc(searchVal) + '"' +
      ' style="flex:1;min-width:200px;padding:9px 12px;border:1px solid #444;border-radius:6px;background:#333;color:#e0e0e0;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    h += '<select id="chTypeFilter" onchange="channelRerender()"' +
      ' style="padding:9px 12px;border:1px solid #444;border-radius:6px;background:#333;color:#e0e0e0;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    h += '<option value="">All types</option>';
    Object.keys(CHANNEL_TYPES).forEach(function(key) {
      var sel = typeVal === key ? ' selected' : '';
      h += '<option value="' + key + '"' + sel + '>' + esc(CHANNEL_TYPES[key].label) + '</option>';
    });
    h += '</select>';
    h += '</div>';

    // Channel cards
    if (!filtered.length) {
      h += '<div style="text-align:center;padding:30px;color:#999;font-size:0.85rem;">No channels match your filters.</div>';
    } else {
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;">';
      filtered.forEach(function(ch) {
        var pCount = productCountForChannel(ch.channelId);
        h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;cursor:pointer;transition:border-color 0.15s;"' +
          ' onmouseenter="this.style.borderColor=\'#C4853C\'" onmouseleave="this.style.borderColor=\'var(--warm-gray-light)\'"' +
          ' onclick="channelOpenDetail(\'' + esc(ch.channelId) + '\')" role="button" tabindex="0"' +
          ' onkeydown="if(event.key===\'Enter\')channelOpenDetail(\'' + esc(ch.channelId) + '\')">';

        // Row 1: name + status
        h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">';
        h += '<div style="font-weight:500;font-size:0.9rem;color:#e0e0e0;">' + esc(ch.name) + '</div>';
        h += statusDot(ch.isActive);
        h += '</div>';

        // Row 2: type badge + external platform
        h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">';
        h += typeBadge(ch.type);
        if (ch.externalPlatform) {
          h += '<span style="font-size:0.72rem;color:#999;">' + esc(ch.externalPlatform) + '</span>';
        }
        h += '</div>';

        // Row 3: stats
        h += '<div style="display:flex;gap:16px;font-size:0.78rem;color:#999;">';
        h += '<span>' + feeSummary(ch) + '</span>';
        h += '<span>' + pCount + ' product' + (pCount !== 1 ? 's' : '') + '</span>';
        h += '</div>';

        // Row 4: last updated
        if (ch.updatedAt) {
          h += '<div style="font-size:0.72rem;color:#666;margin-top:8px;">Updated ' + relativeTime(ch.updatedAt) + '</div>';
        }

        h += '</div>';
      });
      h += '</div>';
    }

    tab.innerHTML = h;
  }

  // ============================================================
  // Detail View
  // ============================================================

  function renderDetail() {
    var tab = document.getElementById('channelsTab');
    if (!tab) return;
    var ch = channelsData[selectedChannelId];
    if (!ch) { currentView = 'list'; renderList(); return; }

    var h = '';

    // Back button (MastNavStack-aware)
    var backLabel = 'Channels';
    if (window.MastNavStack && MastNavStack.size() > 0) {
      var peek = MastNavStack.peek();
      if (peek && peek.label) backLabel = peek.label;
    }
    h += '<button class="detail-back" onclick="channelBackToList()" aria-label="Back to ' + esc(backLabel) + '">' +
      '\u2190 Back to ' + esc(backLabel) + '</button>';

    // Header
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">';
    h += '<div>';
    h += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">' + esc(ch.name) + '</h3>';
    h += '<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">';
    h += typeBadge(ch.type);
    h += statusDot(ch.isActive);
    if (ch.externalPlatform) h += '<span style="font-size:0.78rem;color:#999;">' + esc(ch.externalPlatform) + '</span>';
    h += '</div>';
    h += '</div>';

    // Edit button / Editing indicator (Paradigm A)
    h += '<div>';
    if (!channelEditMode) {
      h += '<button class="btn btn-secondary btn-small" onclick="channelEnterEdit()">Edit</button>';
    } else {
      h += '<span style="font-size:0.72rem;color:#C4853C;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Editing</span>';
    }
    h += '</div>';
    h += '</div>';

    // Tabs
    h += '<div style="display:flex;gap:0;border-bottom:1px solid var(--warm-gray-light);margin-bottom:16px;">';
    DETAIL_TABS.forEach(function(t) {
      var isActive = detailTab === t.value;
      var tabLabel = t.label;
      if (t.value === 'products') {
        var cnt = productCountForChannel(ch.channelId);
        if (cnt > 0) tabLabel += ' (' + cnt + ')';
      }
      h += '<button onclick="channelSetTab(\'' + t.value + '\')" ' +
        'style="padding:8px 16px;font-size:0.85rem;font-family:\'DM Sans\',sans-serif;border:none;background:none;cursor:pointer;' +
        'color:' + (isActive ? '#C4853C' : 'var(--warm-gray)') + ';' +
        'border-bottom:2px solid ' + (isActive ? '#C4853C' : 'transparent') + ';' +
        'font-weight:' + (isActive ? '600' : '400') + ';"' +
        ' aria-pressed="' + isActive + '">' + esc(tabLabel) + '</button>';
    });
    h += '</div>';

    // Tab content
    if (detailTab === 'overview') {
      h += renderOverviewTab(ch);
    } else if (detailTab === 'products') {
      h += renderProductsTab(ch);
    } else if (detailTab === 'activity') {
      h += renderActivityTab(ch);
    } else if (detailTab === 'settings') {
      h += renderSettingsTab(ch);
    }

    tab.innerHTML = h;
  }

  // ============================================================
  // Overview Tab
  // ============================================================

  function renderOverviewTab(ch) {
    var h = '';

    // Fee profile card
    h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;margin-bottom:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:12px;">Fee Profile</div>';
    h += '<div style="font-size:1.15rem;font-weight:500;color:#C4853C;">' + esc(feeSummary(ch)) + '</div>';
    h += '<div style="display:flex;gap:24px;margin-top:12px;font-size:0.78rem;color:#999;">';
    h += '<div><span style="color:#666;">Ownership:</span> ' + esc(ch.ownershipModel || '—') + '</div>';
    h += '<div><span style="color:#666;">Pricing:</span> ' + esc(ch.pricingModel || '—') + '</div>';
    h += '<div><span style="color:#666;">Inventory:</span> ' + esc(ch.inventoryModel || '—') + '</div>';
    h += '</div>';
    if (ch.defaultPricingTier) {
      h += '<div style="margin-top:8px;font-size:0.78rem;color:#999;"><span style="color:#666;">Pricing tier:</span> ' + esc(ch.defaultPricingTier) + '</div>';
    }
    h += '</div>';

    // Contact info
    if (ch.contactName || ch.contactEmail || ch.contactPhone) {
      h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:8px;">Contact</div>';
      if (ch.contactName) h += '<div style="font-size:0.9rem;color:#e0e0e0;">' + esc(ch.contactName) + '</div>';
      if (ch.contactEmail) h += '<div style="font-size:0.78rem;color:#999;margin-top:2px;">' + esc(ch.contactEmail) + '</div>';
      if (ch.contactPhone) h += '<div style="font-size:0.78rem;color:#999;margin-top:2px;">' + esc(ch.contactPhone) + '</div>';
      h += '</div>';
    }

    // Relationship notes
    if (ch.relationshipNotes) {
      h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:8px;">Notes</div>';
      h += '<div style="font-size:0.85rem;color:#999;white-space:pre-wrap;">' + esc(ch.relationshipNotes) + '</div>';
      h += '</div>';
    }

    // Contract terms
    if (ch.contractTerms) {
      h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:8px;">Contract Terms</div>';
      h += '<div style="font-size:0.85rem;color:#999;white-space:pre-wrap;">' + esc(ch.contractTerms) + '</div>';
      h += '</div>';
    }

    // Type-specific section
    h += renderTypeSpecificOverview(ch);

    // Edit mode: save/cancel
    if (channelEditMode) {
      h += renderSaveCancelButtons();
    }

    return h;
  }

  function renderTypeSpecificOverview(ch) {
    var h = '';
    if (ch.type === 'consignment') {
      h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:8px;">Consignment Details</div>';
      h += '<div style="font-size:0.85rem;color:#999;">Settlement tracking available in Galleries &amp; Consignment module.</div>';
      h += '</div>';
    } else if (ch.type === 'marketplace') {
      h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:8px;">Marketplace</div>';
      h += '<div style="font-size:0.85rem;color:#999;">Platform: ' + esc(ch.externalPlatform || 'Not set') + '</div>';
      h += '<div style="font-size:0.78rem;color:#666;margin-top:4px;">PIM sync managed via publish tools.</div>';
      h += '</div>';
    } else if (ch.type === 'mobile_events') {
      h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;">Craft Fairs &amp; Events</div>';
      if (!salesEventsLoaded) {
        h += '<button class="btn btn-secondary btn-small" onclick="channelLoadEventComparison()">Show Comparison</button>';
      }
      h += '</div>';
      h += '<div id="channelEventComparison">';
      if (salesEventsLoaded) {
        h += renderEventComparisonTable(ch);
      } else {
        h += '<div style="font-size:0.85rem;color:#999;">Click &ldquo;Show Comparison&rdquo; to see per-show P&amp;L rankings.</div>';
      }
      h += '</div>';
      h += '</div>';
    } else if (ch.type === 'wholesale_prebuy' || ch.type === 'retail_prebuy') {
      h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:8px;">Wholesale</div>';
      if (ch.defaultPricingTier) {
        h += '<div style="font-size:0.85rem;color:#999;">Default pricing tier: ' + esc(ch.defaultPricingTier) + '</div>';
      }
      h += '<div style="font-size:0.78rem;color:#666;margin-top:4px;">Wholesale orders managed via the Wholesale module.</div>';
      h += '</div>';
    } else if (ch.type === 'social_live') {
      h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;">Live Sale Sessions</div>';
      if (!liveSessionsLoaded) {
        h += '<button class="btn btn-secondary btn-small" onclick="channelLoadLiveSessions()">Show History</button>';
      }
      h += '</div>';
      h += '<div id="channelLiveSessions">';
      if (liveSessionsLoaded) {
        h += renderLiveSessionHistory(ch);
      } else {
        h += '<div style="font-size:0.85rem;color:#999;">Click &ldquo;Show History&rdquo; to see past live sale sessions.</div>';
      }
      h += '</div>';
      h += '</div>';
    }
    return h;
  }

  // ============================================================
  // Event Comparison (mobile_events channel type)
  // ============================================================

  function loadEventComparison() {
    var el = document.getElementById('channelEventComparison');
    if (el) el.innerHTML = '<div style="font-size:0.85rem;color:#999;text-align:center;padding:12px;">Loading event data\u2026</div>';
    loadSalesEvents().then(function() {
      renderPreservingEdits();
    });
  }

  function computeEventPnl(ev, evId, channelsRef) {
    var boothCost = ev.boothCost || 0;
    var travelCost = ev.travelCost || 0;
    var lodgingCost = ev.lodgingCost || 0;
    var applicationFee = ev.applicationFee || 0;
    var otherCosts = ev.otherCosts || 0;
    var totalCosts = boothCost + travelCost + lodgingCost + applicationFee + otherCosts;

    // Revenue from POS sales linked to this event
    var grossRevenue = 0;
    var saleCount = 0;
    Object.values(salesData).forEach(function(sale) {
      if (sale.eventId !== evId) return;
      if (sale.status === 'voided') return;
      grossRevenue += sale.amount || 0;
      saleCount++;
    });

    // Channel fees
    var channelFees = 0;
    if (ev.channelId && channelsRef[ev.channelId]) {
      var ch = channelsRef[ev.channelId];
      channelFees = Math.round((grossRevenue * (ch.percentFee || 0)) / 100) + ((ch.fixedFeePerOrderCents || 0) * saleCount);
    }

    // Sell-through
    var allocations = ev.allocations || {};
    var totalPacked = 0, totalSold = 0;
    Object.values(allocations).forEach(function(alloc) {
      totalPacked += alloc.quantity || 0;
      totalSold += alloc.sold || 0;
    });

    var netProfit = grossRevenue - totalCosts - channelFees;
    var roi = totalCosts > 0 ? Math.round((netProfit / totalCosts) * 10000) / 100 : 0;

    return {
      eventId: evId,
      name: ev.name || evId,
      date: ev.date || null,
      location: ev.location || null,
      status: ev.status || 'planning',
      grossRevenue: grossRevenue,
      totalCosts: totalCosts,
      channelFees: channelFees,
      netProfit: netProfit,
      roi: roi,
      sellThrough: totalPacked > 0 ? Math.round((totalSold / totalPacked) * 100) : 0,
      saleCount: saleCount,
      totalPacked: totalPacked,
      totalSold: totalSold
    };
  }

  function renderEventComparisonTable(ch) {
    var events = Object.entries(salesEventsData).map(function(entry) {
      return computeEventPnl(entry[1], entry[0], channelsData);
    });

    // Filter to events linked to this channel (or all if none linked)
    var linked = events.filter(function(e) {
      var ev = salesEventsData[e.eventId];
      return ev && ev.channelId === ch.channelId;
    });
    // If no events are explicitly linked, show all events (craft fairs typically share one channel)
    var showing = linked.length > 0 ? linked : events;

    if (!showing.length) {
      return '<div style="font-size:0.85rem;color:#999;">No events recorded yet. Create events in the Shows module.</div>';
    }

    // Sort
    var sortCol = eventCompSort.col;
    var sortAsc = eventCompSort.asc;
    showing.sort(function(a, b) {
      var va = a[sortCol], vb = b[sortCol];
      if (typeof va === 'string') return sortAsc ? (va || '').localeCompare(vb || '') : (vb || '').localeCompare(va || '');
      return sortAsc ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
    });

    // Summary stats
    var totRev = 0, totCosts = 0, totProfit = 0, roiSum = 0, roiCount = 0;
    showing.forEach(function(e) {
      totRev += e.grossRevenue;
      totCosts += e.totalCosts;
      totProfit += e.netProfit;
      if (e.totalCosts > 0) { roiSum += e.roi; roiCount++; }
    });
    var avgRoi = roiCount > 0 ? Math.round(roiSum / roiCount * 100) / 100 : 0;

    // Best / worst
    var withRevenue = showing.filter(function(e) { return e.saleCount > 0; });
    var bestEv = withRevenue.length ? withRevenue.reduce(function(b, e) { return e.roi > b.roi ? e : b; }) : null;
    var worstEv = withRevenue.length > 1 ? withRevenue.reduce(function(w, e) { return e.roi < w.roi ? e : w; }) : null;
    if (worstEv && bestEv && worstEv.eventId === bestEv.eventId) worstEv = null;

    var h = '';

    // Stat cards
    h += '<div class="analytics-summary" style="margin-bottom:12px;">';
    h += '<div class="stat-card"><div class="stat-card-value">' + esc(formatCurrency(totRev)) + '</div><div class="stat-card-label">Total Revenue</div></div>';
    h += '<div class="stat-card"><div class="stat-card-value">' + esc(formatCurrency(totProfit)) + '</div><div class="stat-card-label">Total Profit</div></div>';
    h += '<div class="stat-card"><div class="stat-card-value">' + avgRoi + '%</div><div class="stat-card-label">Avg ROI</div></div>';
    h += '<div class="stat-card"><div class="stat-card-value">' + showing.length + '</div><div class="stat-card-label">Events</div></div>';
    if (bestEv) {
      h += '<div class="stat-card"><div class="stat-card-value">' + esc(bestEv.name) + '</div><div class="stat-card-label">Best ROI</div>' +
        '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:2px;">' + bestEv.roi + '%</div></div>';
    }
    h += '</div>';

    // Comparison table
    var cols = [
      { key: 'name', label: 'Show', align: 'left' },
      { key: 'date', label: 'Date', align: 'left' },
      { key: 'grossRevenue', label: 'Revenue', align: 'right' },
      { key: 'totalCosts', label: 'Costs', align: 'right' },
      { key: 'netProfit', label: 'Net', align: 'right' },
      { key: 'roi', label: 'ROI %', align: 'right' },
      { key: 'sellThrough', label: 'Sell-Thru', align: 'right' }
    ];

    h += '<div class="data-table" style="overflow-x:auto;">';
    h += '<table role="grid">';
    h += '<thead><tr>';
    cols.forEach(function(col) {
      var arrow = '';
      if (eventCompSort.col === col.key) arrow = eventCompSort.asc ? ' &#9650;' : ' &#9660;';
      h += '<th style="text-align:' + col.align + ';cursor:pointer;user-select:none;white-space:nowrap;"' +
        ' onclick="channelSortEventComp(\'' + col.key + '\')" role="columnheader" tabindex="0"' +
        ' onkeydown="if(event.key===\'Enter\')channelSortEventComp(\'' + col.key + '\')"' +
        ' aria-sort="' + (eventCompSort.col === col.key ? (eventCompSort.asc ? 'ascending' : 'descending') : 'none') + '">' +
        esc(col.label) + arrow + '</th>';
    });
    h += '</tr></thead>';
    h += '<tbody>';

    showing.forEach(function(e) {
      var isBest = bestEv && e.eventId === bestEv.eventId;
      var isWorst = worstEv && e.eventId === worstEv.eventId;
      var rowBg = isWorst ? 'rgba(239,68,68,0.06)' : (isBest ? 'rgba(34,197,94,0.06)' : '');

      h += '<tr style="' + (rowBg ? 'background:' + rowBg + ';' : '') + '">';
      h += '<td style="font-weight:500;">' + esc(e.name) + '</td>';
      h += '<td style="color:var(--warm-gray,#999);">' + esc(e.date || '\u2014') + '</td>';
      h += '<td style="text-align:right;">' + formatCurrency(e.grossRevenue) + '</td>';
      h += '<td style="text-align:right;color:#f87171;">' + (e.totalCosts > 0 ? formatCurrency(e.totalCosts) : '$0.00') + '</td>';

      var netColor = e.netProfit >= 0 ? '#22c55e' : '#ef4444';
      h += '<td style="text-align:right;font-weight:600;color:' + netColor + ';">' + formatCurrency(e.netProfit) + '</td>';

      var roiColor = e.roi >= 100 ? '#22c55e' : (e.roi >= 0 ? '#f59e0b' : '#ef4444');
      if (e.saleCount === 0) roiColor = 'var(--warm-gray-light,#666)';
      h += '<td style="text-align:right;color:' + roiColor + ';">' + (e.saleCount > 0 ? e.roi + '%' : '\u2014') + '</td>';

      h += '<td style="text-align:right;color:var(--warm-gray,#999);">' + (e.totalPacked > 0 ? e.sellThrough + '%' : '\u2014') + '</td>';
      h += '</tr>';
    });

    // Totals row
    h += '<tr style="font-weight:600;border-top:2px solid var(--cream-dark,#555);">';
    h += '<td>Total</td>';
    h += '<td></td>';
    h += '<td style="text-align:right;">' + formatCurrency(totRev) + '</td>';
    h += '<td style="text-align:right;color:#f87171;">' + formatCurrency(totCosts) + '</td>';
    var totNetColor = totProfit >= 0 ? '#22c55e' : '#ef4444';
    h += '<td style="text-align:right;color:' + totNetColor + ';">' + formatCurrency(totProfit) + '</td>';
    h += '<td style="text-align:right;">' + avgRoi + '%</td>';
    h += '<td></td>';
    h += '</tr>';

    h += '</tbody></table>';
    h += '</div>';

    return h;
  }

  function setEventCompSort(col) {
    if (eventCompSort.col === col) {
      eventCompSort.asc = !eventCompSort.asc;
    } else {
      eventCompSort.col = col;
      eventCompSort.asc = false;
    }
    renderPreservingEdits();
  }

  // ============================================================
  // Live Session History (social_live channel type)
  // ============================================================

  function loadLiveSessions() {
    var el = document.getElementById('channelLiveSessions');
    if (el) el.innerHTML = '<div style="font-size:0.85rem;color:#999;text-align:center;padding:12px;">Loading session data\u2026</div>';
    MastDB._ref('admin/liveSessions').once('value').then(function(snap) {
      liveSessionsData = snap.val() || {};
      liveSessionsLoaded = true;
      renderPreservingEdits();
    }).catch(function(err) {
      console.error('Error loading live sessions:', err);
      liveSessionsData = {};
      liveSessionsLoaded = true;
      renderPreservingEdits();
    });
  }

  function renderLiveSessionHistory(ch) {
    var sessions = [];
    Object.keys(liveSessionsData).forEach(function(id) {
      var s = liveSessionsData[id];
      if (s.channelId === ch.channelId) {
        sessions.push({
          sessionId: id,
          startTime: s.startTime || '',
          endTime: s.endTime || null,
          status: s.status || 'active',
          platform: s.platform || null,
          summary: s.summary || null
        });
      }
    });

    if (!sessions.length) {
      return '<div style="font-size:0.85rem;color:#999;">No live sessions recorded yet. Use &ldquo;Go Live&rdquo; in the Sales tab to start one.</div>';
    }

    // Sort by startTime descending
    sessions.sort(function(a, b) { return (b.startTime || '').localeCompare(a.startTime || ''); });

    // Summary stats
    var totalRev = 0, totalSales = 0, totalSessions = sessions.length;
    sessions.forEach(function(s) {
      if (s.summary) {
        totalRev += s.summary.revenue || 0;
        totalSales += s.summary.saleCount || 0;
      }
    });

    var h = '';
    h += '<div class="analytics-summary" style="margin-bottom:12px;">';
    h += '<div class="stat-card"><div class="stat-card-value">' + totalSessions + '</div><div class="stat-card-label">Sessions</div></div>';
    h += '<div class="stat-card"><div class="stat-card-value">' + esc(formatCurrency(totalRev)) + '</div><div class="stat-card-label">Total Revenue</div></div>';
    h += '<div class="stat-card"><div class="stat-card-value">' + totalSales + '</div><div class="stat-card-label">Total Sales</div></div>';
    h += '</div>';

    // Session table
    h += '<div class="data-table" style="overflow-x:auto;">';
    h += '<table role="grid"><thead><tr>';
    h += '<th style="text-align:left;">Date</th>';
    h += '<th style="text-align:right;">Duration</th>';
    h += '<th style="text-align:right;">Sales</th>';
    h += '<th style="text-align:right;">Revenue</th>';
    h += '<th style="text-align:right;">Avg Sale</th>';
    h += '<th style="text-align:center;">Status</th>';
    h += '</tr></thead><tbody>';

    sessions.forEach(function(s) {
      var dateStr = s.startTime ? new Date(s.startTime).toLocaleDateString() : '\u2014';
      var dur = s.summary && s.summary.durationMinutes ? s.summary.durationMinutes + ' min' : '\u2014';
      var sales = s.summary ? String(s.summary.saleCount || 0) : '\u2014';
      var rev = s.summary ? formatCurrency(s.summary.revenue || 0) : '\u2014';
      var avg = s.summary ? formatCurrency(s.summary.avgSale || 0) : '\u2014';
      var statusColor = s.status === 'active' ? '#dc2626' : '#9ca3af';
      var statusLabel = s.status === 'active' ? '🔴 LIVE' : 'Ended';

      h += '<tr>';
      h += '<td>' + esc(dateStr) + '</td>';
      h += '<td style="text-align:right;color:var(--warm-gray,#999);">' + esc(dur) + '</td>';
      h += '<td style="text-align:right;">' + esc(sales) + '</td>';
      h += '<td style="text-align:right;font-weight:500;">' + esc(rev) + '</td>';
      h += '<td style="text-align:right;color:var(--warm-gray,#999);">' + esc(avg) + '</td>';
      h += '<td style="text-align:center;"><span style="font-size:0.72rem;padding:2px 8px;border-radius:4px;background:' + statusColor + ';color:#fff;">' + statusLabel + '</span></td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';

    return h;
  }

  // ============================================================
  // Products Tab
  // ============================================================

  function renderProductsTab(ch) {
    var onChannel = getProductsForChannel(ch.channelId);
    var h = '';

    // Header with count + actions
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray,#999);">' + onChannel.length + ' product' + (onChannel.length !== 1 ? 's' : '') + ' on this channel</div>';
    h += '<button class="btn btn-secondary btn-small" onclick="channelShowAddProducts()">+ Add Products</button>';
    h += '</div>';

    if (!onChannel.length) {
      h += '<div style="text-align:center;padding:30px;color:var(--warm-gray,#999);">';
      h += '<div style="font-size:0.9rem;margin-bottom:4px;">No products on this channel</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light,#666);">Click "+ Add Products" to assign products to this channel.</div>';
      h += '</div>';
      return h;
    }

    h += '<div class="data-table"><table>';
    h += '<thead><tr>';
    h += '<th>Product</th>';
    h += '<th>Price</th>';
    h += '<th>Status</th>';
    h += '<th style="text-align:right;">Actions</th>';
    h += '</tr></thead><tbody>';

    onChannel.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    onChannel.forEach(function(p) {
      var pid = p.pid || p.id || '';
      h += '<tr>';
      h += '<td>' + esc(p.name || pid) + '</td>';
      h += '<td>' + (p.priceCents ? formatCurrency(p.priceCents) : '\u2014') + '</td>';
      h += '<td>';
      var st = p.status || 'active';
      var stColor = st === 'active' ? '#22c55e' : st === 'draft' ? '#f59e0b' : '#9ca3af';
      h += '<span style="color:' + stColor + ';">' + esc(st) + '</span>';
      h += '</td>';
      h += '<td style="text-align:right;">';
      h += '<button class="btn btn-secondary btn-small" style="font-size:0.72rem;padding:2px 8px;" onclick="channelRemoveProduct(\'' + esc(pid) + '\')">Remove</button>';
      h += '</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
  }

  // Add Products modal overlay
  function showAddProducts() {
    var ch = channelsData[selectedChannelId];
    if (!ch) return;

    var onChannel = getProductsForChannel(ch.channelId);
    var onChannelIds = {};
    onChannel.forEach(function(p) { onChannelIds[p.pid || p.id] = true; });

    var available = Object.values(productsData).filter(function(p) {
      var pid = p.pid || p.id;
      return pid && !onChannelIds[pid] && (p.status || 'active') !== 'archived';
    }).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    if (!available.length) {
      showToast('All products are already on this channel');
      return;
    }

    // Build modal
    var overlay = document.createElement('div');
    overlay.id = 'channelAddProductsOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:#1e1e1e;border:1px solid #444;border-radius:10px;padding:24px;max-width:500px;width:90%;max-height:70vh;display:flex;flex-direction:column;';

    var h = '';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<h4 style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:500;margin:0;color:#e0e0e0;">Add Products to ' + esc(ch.name) + '</h4>';
    h += '<button onclick="channelCloseAddProducts()" style="background:none;border:none;color:#999;font-size:1.15rem;cursor:pointer;padding:4px;">&times;</button>';
    h += '</div>';
    h += '<div style="margin-bottom:12px;">';
    h += '<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:#e0e0e0;cursor:pointer;">';
    h += '<input type="checkbox" id="chAddSelectAll" onchange="channelToggleSelectAll(this.checked)"> Select all (' + available.length + ')';
    h += '</label>';
    h += '</div>';
    h += '<div style="overflow-y:auto;flex:1;border:1px solid #333;border-radius:6px;">';
    available.forEach(function(p) {
      var pid = p.pid || p.id || '';
      h += '<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #333;cursor:pointer;font-size:0.85rem;color:#e0e0e0;"' +
        ' onmouseenter="this.style.background=\'rgba(196,133,60,0.04)\'" onmouseleave="this.style.background=\'none\'">';
      h += '<input type="checkbox" class="chAddProductCb" value="' + esc(pid) + '">';
      h += '<span>' + esc(p.name || pid) + '</span>';
      if (p.priceCents) h += '<span style="margin-left:auto;color:var(--warm-gray,#999);font-size:0.78rem;">' + formatCurrency(p.priceCents) + '</span>';
      h += '</label>';
    });
    h += '</div>';
    h += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">';
    h += '<button class="btn btn-secondary" onclick="channelCloseAddProducts()">Cancel</button>';
    h += '<button class="btn btn-primary" onclick="channelConfirmAddProducts()">Add Selected</button>';
    h += '</div>';

    modal.innerHTML = h;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) channelCloseAddProducts();
    });
  }

  function closeAddProducts() {
    var overlay = document.getElementById('channelAddProductsOverlay');
    if (overlay) overlay.remove();
  }

  function toggleSelectAll(checked) {
    var cbs = document.querySelectorAll('.chAddProductCb');
    cbs.forEach(function(cb) { cb.checked = checked; });
  }

  function confirmAddProducts() {
    var cbs = document.querySelectorAll('.chAddProductCb:checked');
    var pids = [];
    cbs.forEach(function(cb) { pids.push(cb.value); });

    if (!pids.length) {
      showToast('No products selected');
      return;
    }

    var ch = channelsData[selectedChannelId];
    if (!ch) return;

    // Update each product's channelIds locally + in Firebase
    var updates = {};
    pids.forEach(function(pid) {
      var p = productsData[pid];
      if (!p) return;
      var ids = Array.isArray(p.channelIds) ? p.channelIds.slice() : [];
      if (ids.indexOf(ch.channelId) === -1) {
        ids.push(ch.channelId);
        p.channelIds = ids;
        updates[pid + '/channelIds'] = ids;
      }
    });

    var count = Object.keys(updates).length;
    if (!count) {
      showToast('Products already on this channel');
      closeAddProducts();
      return;
    }

    // Batch write to Firebase
    var batch = {};
    Object.keys(updates).forEach(function(path) {
      batch[path] = updates[path];
    });
    MastDB._ref('public/products').update(batch).then(function() {
      showToast(count + ' product' + (count !== 1 ? 's' : '') + ' added to ' + ch.name);
      closeAddProducts();
      renderPreservingEdits();
    }).catch(function(err) {
      showToast('Error adding products: ' + err.message, true);
    });
  }

  function removeProduct(pid) {
    var ch = channelsData[selectedChannelId];
    if (!ch || !pid) return;

    var p = productsData[pid];
    if (!p) return;

    var ids = Array.isArray(p.channelIds) ? p.channelIds.filter(function(id) { return id !== ch.channelId; }) : [];
    p.channelIds = ids;

    MastDB._ref('public/products/' + pid + '/channelIds').set(ids).then(function() {
      showToast(esc(p.name || pid) + ' removed from ' + esc(ch.name));
      renderPreservingEdits();
    }).catch(function(err) {
      showToast('Error removing product: ' + err.message, true);
    });
  }

  // ============================================================
  // Activity Tab
  // ============================================================

  function renderActivityTab(ch) {
    var h = '';

    // Filter orders by channel's autoMatchSources
    var sources = ch.autoMatchSources || [];
    var channelOrders = [];

    Object.values(ordersData).forEach(function(o) {
      // Match by channelId field on order, or by source matching autoMatchSources
      if (o.channelId === ch.channelId) {
        channelOrders.push(o);
      } else if (o.source && sources.indexOf(o.source) !== -1) {
        channelOrders.push(o);
      }
    });

    channelOrders.sort(function(a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    if (!channelOrders.length) {
      // Try loading orders if not loaded yet
      if (!Object.keys(ordersData).length) {
        h += '<div style="text-align:center;padding:30px;color:#999;">';
        h += '<div style="font-size:0.9rem;margin-bottom:8px;">Loading activity...</div>';
        h += '<button class="btn btn-secondary btn-small" onclick="channelLoadActivity()">Load Orders</button>';
        h += '</div>';
        return h;
      }
      h += '<div style="text-align:center;padding:30px;color:#999;">';
      h += '<div style="font-size:0.9rem;">No orders attributed to this channel yet.</div>';
      h += '<div style="font-size:0.78rem;color:#666;margin-top:4px;">Orders are attributed via autoMatchSources or channelId.</div>';
      h += '</div>';
      return h;
    }

    h += '<div class="data-table"><table>';
    h += '<thead><tr>';
    h += '<th style="font-size:0.78rem;">Date</th>';
    h += '<th style="font-size:0.78rem;">Order</th>';
    h += '<th style="font-size:0.78rem;">Total</th>';
    h += '<th style="font-size:0.78rem;">Status</th>';
    h += '</tr></thead><tbody>';

    channelOrders.slice(0, 50).forEach(function(o) {
      h += '<tr>';
      h += '<td style="font-size:0.85rem;">' + relativeTime(o.createdAt) + '</td>';
      h += '<td style="font-size:0.85rem;">' + esc(o.orderId || o.id || '—') + '</td>';
      h += '<td style="font-size:0.85rem;">' + (o.totalCents ? formatCurrency(o.totalCents) : '—') + '</td>';
      h += '<td style="font-size:0.85rem;">' + esc(o.status || '—') + '</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
  }

  // ============================================================
  // Settings Tab
  // ============================================================

  function renderSettingsTab(ch) {
    var h = '';
    var ro = !channelEditMode; // read-only?

    h += '<div style="display:grid;gap:16px;">';

    // Fee profile
    h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:12px;">Fee Profile</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';
    h += fieldGroup('Percent Fee (%)', 'chFeePercent', ch.percentFee || '', ro, 'number', '0', '0.1');
    h += fieldGroup('Fixed Fee / Order (cents)', 'chFeeFixed', ch.fixedFeePerOrderCents || '', ro, 'number', '0');
    h += fieldGroup('Monthly Fixed (cents)', 'chFeeMonthly', ch.monthlyFixedCents || '', ro, 'number', '0');
    h += '</div>';
    h += '</div>';

    // Auto-match sources
    h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:8px;">Auto-Match Sources</div>';
    var srcs = ch.autoMatchSources || [];
    if (srcs.length) {
      h += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
      srcs.forEach(function(s) {
        h += '<span style="background:var(--warm-gray-light);color:#e0e0e0;padding:2px 8px;border-radius:4px;font-size:0.78rem;">' + esc(s) + '</span>';
      });
      h += '</div>';
    } else {
      h += '<div style="font-size:0.78rem;color:#666;">No auto-match sources configured.</div>';
    }
    h += '</div>';

    // Default eligibility toggle (atomic widget — saves on action)
    h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div>';
    h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;">Default Eligibility</div>';
    h += '<div style="font-size:0.78rem;color:#999;margin-top:2px;">' +
      (ch.defaultEligibility === 'opt-in' ? 'Opt-in: products must be explicitly added to this channel.' : 'Opt-out: new products are automatically eligible for this channel.') +
      '</div>';
    h += '</div>';
    h += '<label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;" aria-label="Toggle default eligibility">';
    h += '<input type="checkbox" ' + (ch.defaultEligibility !== 'opt-in' ? 'checked' : '') +
      ' onchange="channelToggleEligibility(\'' + esc(ch.channelId) + '\', this.checked)"' +
      ' style="opacity:0;width:0;height:0;">';
    h += '<span style="position:absolute;inset:0;background:' + (ch.defaultEligibility !== 'opt-in' ? '#2A7C6F' : 'var(--warm-gray-light)') +
      ';border-radius:12px;transition:background 0.2s;"></span>';
    h += '<span style="position:absolute;top:2px;left:' + (ch.defaultEligibility !== 'opt-in' ? '22px' : '2px') +
      ';width:20px;height:20px;background:white;border-radius:50%;transition:left 0.2s;"></span>';
    h += '</label>';
    h += '</div>';
    h += '</div>';

    // Contact fields
    h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:12px;">Contact</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';
    h += fieldGroup('Name', 'chContactName', ch.contactName || '', ro);
    h += fieldGroup('Email', 'chContactEmail', ch.contactEmail || '', ro, 'email');
    h += fieldGroup('Phone', 'chContactPhone', ch.contactPhone || '', ro, 'tel');
    h += '</div>';
    h += '</div>';

    // Revenue target
    h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;">';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += fieldGroup('Revenue Target (cents)', 'chRevenueTarget', ch.revenueTarget || '', ro, 'number', '0');
    h += fieldGroup('External Platform', 'chExtPlatform', ch.externalPlatform || '', ro);
    h += '</div>';
    h += '</div>';

    // Notes
    h += '<div style="background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:#e0e0e0;margin-bottom:8px;">Notes</div>';
    if (ro) {
      h += '<div style="font-size:0.85rem;color:#999;white-space:pre-wrap;">' + esc(ch.notes || 'No notes.') + '</div>';
    } else {
      h += '<textarea id="chNotes" rows="3" style="width:100%;padding:9px 12px;border:1px solid #444;border-radius:6px;background:#333;color:#e0e0e0;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;resize:vertical;">' +
        esc(ch.notes || '') + '</textarea>';
    }
    h += '</div>';

    h += '</div>'; // end grid

    // Edit mode: save/cancel
    if (channelEditMode) {
      h += renderSaveCancelButtons();
    }

    return h;
  }

  function fieldGroup(label, id, value, readOnly, type, min, step) {
    var h = '<div>';
    h += '<label style="font-size:0.78rem;color:#999;display:block;margin-bottom:4px;" for="' + id + '">' + esc(label) + '</label>';
    if (readOnly) {
      h += '<div style="font-size:0.9rem;color:#e0e0e0;padding:9px 0;">' + esc(value || '—') + '</div>';
    } else {
      h += '<input type="' + (type || 'text') + '" id="' + id + '" value="' + esc(String(value)) + '"' +
        (min !== undefined ? ' min="' + min + '"' : '') +
        (step ? ' step="' + step + '"' : '') +
        ' style="width:100%;padding:9px 12px;border:1px solid #444;border-radius:6px;background:#333;color:#e0e0e0;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    }
    h += '</div>';
    return h;
  }

  // ============================================================
  // Create Channel Form
  // ============================================================

  function renderNewForm() {
    var tab = document.getElementById('channelsTab');
    if (!tab) return;

    var h = '';
    h += '<button class="detail-back" onclick="channelShowList()">\u2190 Back to Channels</button>';

    h += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0 0 20px 0;">New Channel</h3>';

    h += '<div style="display:grid;gap:16px;max-width:640px;">';

    // Name
    h += '<div>';
    h += '<label style="font-size:0.78rem;color:#999;display:block;margin-bottom:4px;" for="newChName">Channel Name *</label>';
    h += '<input type="text" id="newChName" placeholder="e.g. Etsy, Gallery Blue, TikTok Shop" style="width:100%;padding:9px 12px;border:1px solid #444;border-radius:6px;background:#333;color:#e0e0e0;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    h += '</div>';

    // Type selector
    h += '<div>';
    h += '<label style="font-size:0.78rem;color:#999;display:block;margin-bottom:4px;" for="newChType">Channel Type *</label>';
    h += '<select id="newChType" onchange="channelTypeChanged()"' +
      ' style="width:100%;padding:9px 12px;border:1px solid #444;border-radius:6px;background:#333;color:#e0e0e0;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    h += '<option value="">Select a type...</option>';
    Object.keys(CHANNEL_TYPES).forEach(function(key) {
      var t = CHANNEL_TYPES[key];
      h += '<option value="' + key + '">' + esc(t.label) + ' (' + t.ownership + ', ' + t.pricing + ')</option>';
    });
    h += '</select>';
    h += '</div>';

    // Auto-filled classification (shown after type selected)
    h += '<div id="newChClassification" style="display:none;font-size:0.78rem;color:#999;padding:8px 12px;background:#2a2a2a;border:1px solid #444;border-radius:6px;"></div>';

    // Fee fields
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';
    h += fieldGroup('Percent Fee (%)', 'newChFeePercent', '', false, 'number', '0', '0.1');
    h += fieldGroup('Fixed Fee / Order (cents)', 'newChFeeFixed', '', false, 'number', '0');
    h += fieldGroup('Monthly Fixed (cents)', 'newChFeeMonthly', '', false, 'number', '0');
    h += '</div>';

    // External platform
    h += '<div id="newChExtPlatformWrap">';
    h += '<label style="font-size:0.78rem;color:#999;display:block;margin-bottom:4px;" for="newChExtPlatform">External Platform</label>';
    h += '<input type="text" id="newChExtPlatform" placeholder="e.g. Etsy, Shopify, TikTok" style="width:100%;padding:9px 12px;border:1px solid #444;border-radius:6px;background:#333;color:#e0e0e0;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    h += '</div>';

    // Default eligibility
    h += '<div style="display:flex;align-items:center;gap:12px;">';
    h += '<label style="font-size:0.85rem;color:#e0e0e0;" for="newChOptOut">New products auto-eligible</label>';
    h += '<input type="checkbox" id="newChOptOut" checked style="accent-color:#2A7C6F;">';
    h += '<span style="font-size:0.72rem;color:#999;">(opt-out = checked, opt-in = unchecked)</span>';
    h += '</div>';

    // Contact
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';
    h += fieldGroup('Contact Name', 'newChContactName', '', false);
    h += fieldGroup('Contact Email', 'newChContactEmail', '', false, 'email');
    h += fieldGroup('Contact Phone', 'newChContactPhone', '', false, 'tel');
    h += '</div>';

    // Notes
    h += '<div>';
    h += '<label style="font-size:0.78rem;color:#999;display:block;margin-bottom:4px;" for="newChNotes">Notes</label>';
    h += '<textarea id="newChNotes" rows="3" placeholder="Optional notes about this channel..." style="width:100%;padding:9px 12px;border:1px solid #444;border-radius:6px;background:#333;color:#e0e0e0;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;resize:vertical;"></textarea>';
    h += '</div>';

    // Buttons
    h += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">';
    h += '<button class="btn btn-secondary" onclick="channelShowList()">Cancel</button>';
    h += '<button class="btn btn-primary" onclick="channelSaveNew()">Create Channel</button>';
    h += '</div>';

    h += '</div>'; // end grid

    tab.innerHTML = h;
  }

  function typeChanged() {
    var typeEl = document.getElementById('newChType');
    var classEl = document.getElementById('newChClassification');
    if (!typeEl || !classEl) return;
    var type = typeEl.value;
    if (!type || !CHANNEL_TYPES[type]) {
      classEl.style.display = 'none';
      return;
    }
    var t = CHANNEL_TYPES[type];
    classEl.style.display = '';
    classEl.innerHTML = 'Ownership: <strong>' + esc(t.ownership) + '</strong> &middot; ' +
      'Pricing: <strong>' + esc(t.pricing) + '</strong> &middot; ' +
      'Inventory: <strong>' + esc(t.inventory) + '</strong>';
  }

  function saveNew() {
    var name = (document.getElementById('newChName') || {}).value || '';
    var type = (document.getElementById('newChType') || {}).value || '';

    if (!name.trim()) { showToast('Channel name is required.', true); return; }
    if (!type) { showToast('Please select a channel type.', true); return; }

    var t = CHANNEL_TYPES[type] || {};
    var id = 'ch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    var now = new Date().toISOString();

    var channel = {
      channelId: id,
      name: name.trim(),
      type: type,
      ownershipModel: t.ownership || 'owned',
      pricingModel: t.pricing || 'full_retail',
      inventoryModel: t.inventory || 'retained',
      percentFee: parseFloat((document.getElementById('newChFeePercent') || {}).value) || 0,
      fixedFeePerOrderCents: parseInt((document.getElementById('newChFeeFixed') || {}).value) || 0,
      monthlyFixedCents: parseInt((document.getElementById('newChFeeMonthly') || {}).value) || 0,
      externalPlatform: ((document.getElementById('newChExtPlatform') || {}).value || '').trim() || null,
      defaultEligibility: (document.getElementById('newChOptOut') || {}).checked ? 'opt-out' : 'opt-in',
      contactName: ((document.getElementById('newChContactName') || {}).value || '').trim() || null,
      contactEmail: ((document.getElementById('newChContactEmail') || {}).value || '').trim() || null,
      contactPhone: ((document.getElementById('newChContactPhone') || {}).value || '').trim() || null,
      notes: ((document.getElementById('newChNotes') || {}).value || '').trim() || null,
      autoMatchSources: [],
      isActive: true,
      createdAt: now,
      updatedAt: now
    };

    MastDB._ref('admin/channels/' + id).set(channel).then(function() {
      channelsData[id] = channel;
      showToast('Channel created');
      selectedChannelId = id;
      currentView = 'detail';
      detailTab = 'overview';
      renderCurrentView();
    }).catch(function(err) {
      showToast('Error creating channel: ' + err.message, true);
    });
  }

  // ============================================================
  // Paradigm A — Edit Mode
  // ============================================================

  function enterEdit() {
    channelEditMode = true;
    editBaseline = snapshotFormState();

    if (window.MastDirty) {
      MastDirty.register('channelEdit', function() {
        var current = snapshotFormState();
        return !shallowEqual(current, editBaseline);
      }, { label: 'Channel settings' });
    }

    renderPreservingEdits();
  }

  function cancelEdit() {
    channelEditMode = false;
    editBaseline = null;
    if (window.MastDirty) { try { MastDirty.unregister('channelEdit'); } catch (e) {} }
    renderCurrentView();
  }

  function saveEdit() {
    var ch = channelsData[selectedChannelId];
    if (!ch) return;

    var updates = { updatedAt: new Date().toISOString() };

    // Overview tab fields (if on overview, these won't exist — check existence)
    // Settings tab fields
    var feePercent = document.getElementById('chFeePercent');
    if (feePercent) updates.percentFee = parseFloat(feePercent.value) || 0;

    var feeFixed = document.getElementById('chFeeFixed');
    if (feeFixed) updates.fixedFeePerOrderCents = parseInt(feeFixed.value) || 0;

    var feeMonthly = document.getElementById('chFeeMonthly');
    if (feeMonthly) updates.monthlyFixedCents = parseInt(feeMonthly.value) || 0;

    var contactName = document.getElementById('chContactName');
    if (contactName) updates.contactName = contactName.value.trim() || null;

    var contactEmail = document.getElementById('chContactEmail');
    if (contactEmail) updates.contactEmail = contactEmail.value.trim() || null;

    var contactPhone = document.getElementById('chContactPhone');
    if (contactPhone) updates.contactPhone = contactPhone.value.trim() || null;

    var revenueTarget = document.getElementById('chRevenueTarget');
    if (revenueTarget) updates.revenueTarget = parseInt(revenueTarget.value) || 0;

    var extPlatform = document.getElementById('chExtPlatform');
    if (extPlatform) updates.externalPlatform = extPlatform.value.trim() || null;

    var notes = document.getElementById('chNotes');
    if (notes) updates.notes = notes.value.trim() || null;

    MastDB._ref('admin/channels/' + selectedChannelId).update(updates).then(function() {
      // Update local cache
      Object.assign(ch, updates);
      showToast('Saved');
      // Save stays in edit mode (Paradigm A rule)
      editBaseline = snapshotFormState();
      renderPreservingEdits();
    }).catch(function(err) {
      showToast('Error: ' + err.message, true);
    });
  }

  function renderSaveCancelButtons() {
    return '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
      '<button class="btn btn-secondary" onclick="channelCancelEdit()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="channelSaveEdit()">Save</button>' +
      '</div>';
  }

  // ============================================================
  // State Preservation (for edit mode re-renders)
  // ============================================================

  function snapshotFormState() {
    var tab = document.getElementById('channelsTab');
    if (!tab) return {};
    var snap = {};
    tab.querySelectorAll('input, textarea, select').forEach(function(el) {
      if (!el.id) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        snap[el.id] = { type: 'check', checked: el.checked };
      } else {
        snap[el.id] = { type: 'val', value: el.value };
      }
    });
    return snap;
  }

  function restoreFormState(snap) {
    if (!snap) return;
    var tab = document.getElementById('channelsTab');
    if (!tab) return;
    Object.keys(snap).forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var s = snap[id];
      if (s.type === 'check') el.checked = s.checked;
      else el.value = s.value;
    });
  }

  function renderPreservingEdits() {
    var snap = snapshotFormState();
    var focusId = document.activeElement ? document.activeElement.id : null;
    var selStart = null, selEnd = null;
    if (focusId && document.activeElement && typeof document.activeElement.selectionStart === 'number') {
      selStart = document.activeElement.selectionStart;
      selEnd = document.activeElement.selectionEnd;
    }

    renderCurrentView();
    restoreFormState(snap);

    if (focusId) {
      var el = document.getElementById(focusId);
      if (el) {
        try {
          el.focus();
          if (selStart !== null && typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(selStart, selEnd);
          }
        } catch (e) {}
      }
    }
  }

  function shallowEqual(a, b) {
    var keysA = Object.keys(a || {});
    var keysB = Object.keys(b || {});
    if (keysA.length !== keysB.length) return false;
    for (var i = 0; i < keysA.length; i++) {
      var k = keysA[i];
      var va = a[k], vb = b[k];
      if (!vb) return false;
      if (va.type !== vb.type) return false;
      if (va.type === 'check' && va.checked !== vb.checked) return false;
      if (va.type === 'val' && va.value !== vb.value) return false;
    }
    return true;
  }

  // ============================================================
  // Atomic Widgets (save on action, no edit mode needed)
  // ============================================================

  function toggleEligibility(channelId, isOptOut) {
    var val = isOptOut ? 'opt-out' : 'opt-in';
    MastDB._ref('admin/channels/' + channelId).update({
      defaultEligibility: val,
      updatedAt: new Date().toISOString()
    }).then(function() {
      if (channelsData[channelId]) channelsData[channelId].defaultEligibility = val;
      showToast('Default eligibility: ' + val);
    }).catch(function(err) {
      showToast('Error: ' + err.message, true);
    });
  }

  function toggleActive(channelId) {
    var ch = channelsData[channelId];
    if (!ch) return;
    var newVal = ch.isActive === false ? true : false;
    MastDB._ref('admin/channels/' + channelId).update({
      isActive: newVal,
      updatedAt: new Date().toISOString()
    }).then(function() {
      ch.isActive = newVal;
      showToast(newVal ? 'Channel activated' : 'Channel paused');
      renderPreservingEdits();
    }).catch(function(err) {
      showToast('Error: ' + err.message, true);
    });
  }

  // ============================================================
  // Delete
  // ============================================================

  function deleteChannel() {
    var ch = channelsData[selectedChannelId];
    if (!ch) return;

    if (typeof mastConfirm === 'function') {
      mastConfirm('Delete "' + ch.name + '"? This cannot be undone.', {
        title: 'Delete Channel',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep',
        danger: true
      }).then(function(ok) {
        if (!ok) return;
        doDelete(selectedChannelId);
      });
    } else {
      doDelete(selectedChannelId);
    }
  }

  function doDelete(channelId) {
    MastDB._ref('admin/channels/' + channelId).remove().then(function() {
      delete channelsData[channelId];
      showToast('Channel deleted');
      currentView = 'list';
      selectedChannelId = null;
      channelEditMode = false;
      if (window.MastDirty) { try { MastDirty.unregister('channelEdit'); } catch (e) {} }
      renderCurrentView();
    }).catch(function(err) {
      showToast('Error: ' + err.message, true);
    });
  }

  // ============================================================
  // Navigation
  // ============================================================

  function showList() {
    if (channelEditMode && window.MastDirty && typeof MastDirty.checkAndExit === 'function') {
      MastDirty.checkAndExit(function() {
        channelEditMode = false;
        if (window.MastDirty) { try { MastDirty.unregister('channelEdit'); } catch (e) {} }
        currentView = 'list';
        selectedChannelId = null;
        detailTab = 'overview';
        renderCurrentView();
      });
      return;
    }
    channelEditMode = false;
    currentView = 'list';
    selectedChannelId = null;
    detailTab = 'overview';
    renderCurrentView();
  }

  function openDetail(channelId) {
    selectedChannelId = channelId;
    currentView = 'detail';
    detailTab = 'overview';
    channelEditMode = false;
    renderCurrentView();
  }

  function showNew() {
    currentView = 'new';
    channelEditMode = false;
    renderCurrentView();
  }

  function setTab(tab) {
    detailTab = tab;
    if (tab === 'activity' && !Object.keys(ordersData).length) {
      loadOrders().then(function() { renderPreservingEdits(); });
    }
    renderPreservingEdits();
  }

  function backToList() {
    if (window.MastNavStack && MastNavStack.size() > 0) {
      channelEditMode = false;
      selectedChannelId = null;
      currentView = 'list';
      if (window.MastDirty) { try { MastDirty.unregister('channelEdit'); } catch (e) {} }
      MastNavStack.popAndReturn();
      return;
    }
    showList();
  }

  function loadActivity() {
    loadOrders().then(function() {
      renderPreservingEdits();
    });
  }

  // ============================================================
  // Dashboard — Cross-channel P&L comparison
  // ============================================================

  function loadDashboardData() {
    // Load orders + sales + consignments for client-side P&L computation
    return Promise.all([
      MastDB._ref('public/orders').orderByChild('createdAt').limitToLast(500).once('value').then(function(snap) {
        ordersData = snap.val() || {};
      }).catch(function() { ordersData = {}; }),
      MastDB._ref('admin/sales').orderByChild('timestamp').limitToLast(500).once('value').then(function(snap) {
        salesData = snap.val() || {};
      }).catch(function() { salesData = {}; }),
      MastDB._ref('admin/consignments').once('value').then(function(snap) {
        consignmentsData = snap.val() || {};
      }).catch(function() { consignmentsData = {}; })
    ]);
  }

  function computeDateRange(period) {
    var now = new Date();
    var todayStr = now.toISOString().split('T')[0];
    if (period === 'all') return { from: null, to: null, label: 'All time' };
    if (period === 'ytd') return { from: now.getFullYear() + '-01-01', to: todayStr, label: 'Year to date' };
    var days = parseInt(period, 10) || 30;
    var from = new Date(now);
    from.setDate(from.getDate() - days);
    return { from: from.toISOString().split('T')[0], to: todayStr, label: 'Last ' + days + ' days' };
  }

  function computeChannelPnl(ch, dateFrom, dateTo) {
    var sourceSet = {};
    (ch.autoMatchSources || []).forEach(function(s) { sourceSet[s.toLowerCase().trim()] = true; });

    var matchesChannel = function(source, fallback) {
      var s = (source || fallback || '').toLowerCase().trim();
      if (sourceSet[s]) return true;
      var keys = Object.keys(sourceSet);
      for (var i = 0; i < keys.length; i++) {
        if (s.indexOf(keys[i]) !== -1 || keys[i].indexOf(s) !== -1) return true;
      }
      return false;
    };

    var gross = 0, txns = 0;

    // Orders
    Object.values(ordersData).forEach(function(order) {
      var d = (order.createdAt || '').split('T')[0];
      if (dateFrom && d < dateFrom) return;
      if (dateTo && d > dateTo) return;
      if (order.status === 'cancelled' || order.status === 'refunded') return;
      if (matchesChannel(order.source, 'online')) {
        gross += order.total || 0;
        txns++;
      }
    });

    // POS sales
    Object.values(salesData).forEach(function(sale) {
      var d = (sale.timestamp || sale.createdAt || '').split('T')[0];
      if (dateFrom && d < dateFrom) return;
      if (dateTo && d > dateTo) return;
      if (sale.status === 'voided') return;
      var hint = sale.eventId ? 'craft-fair' : (sale.source || 'direct-pos');
      if (matchesChannel(hint)) {
        gross += sale.amount || 0;
        txns++;
      }
    });

    // Consignment
    if (sourceSet['consignment']) {
      Object.values(consignmentsData).forEach(function(p) {
        gross += p.makerEarnings || 0;
        txns++;
      });
    }

    var pctFee = ch.percentFee || 0;
    var fixedFee = ch.fixedFeePerOrderCents || 0;
    var fees = Math.round((gross * pctFee) / 100) + (fixedFee * txns);
    var net = gross - fees;

    var target = ch.revenueTarget || null;
    var targetPct = target && net > 0 ? Math.round((net / target) * 10000) / 100 : null;

    return {
      channelId: ch.channelId,
      channelName: ch.name || '',
      channelType: ch.type || null,
      grossRevenue: gross,
      fees: fees,
      netRevenue: net,
      transactionCount: txns,
      marginPct: net > 0 ? Math.round(((net) / (gross || 1)) * 10000) / 100 : 0,
      revenueTarget: target,
      targetPct: targetPct
    };
  }

  function showDashboard() {
    if (window.MastDirty && MastDirty.isDirty && MastDirty.isDirty()) {
      if (!confirm('You have unsaved changes. Leave anyway?')) return;
      MastDirty.unregister('channelEdit');
    }
    currentView = 'dashboard';
    channelEditMode = false;
    var tab = document.getElementById('channelsTab');
    if (tab) tab.innerHTML = '<div style="text-align:center;padding:40px;color:#999;font-size:0.9rem;">Loading dashboard\u2026</div>';
    loadDashboardData().then(function() { renderDashboard(); });
  }

  function setDashboardPeriod(period) {
    dashboardPeriod = period;
    renderDashboard();
  }

  function setDashboardSort(col) {
    if (dashboardSort.col === col) {
      dashboardSort.asc = !dashboardSort.asc;
    } else {
      dashboardSort.col = col;
      dashboardSort.asc = false;
    }
    renderDashboard();
  }

  function renderDashboard() {
    var tab = document.getElementById('channelsTab');
    if (!tab) return;

    var channels = Object.values(channelsData).filter(function(ch) { return ch.isActive !== false; });

    if (!channels.length) {
      tab.innerHTML =
        '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
          '<p style="font-size:0.9rem;">No active channels to compare.</p>' +
          '<button class="detail-back" style="margin-top:12px;" onclick="channelShowList()">\u2190 Back to Channels</button>' +
        '</div>';
      return;
    }

    var range = computeDateRange(dashboardPeriod);
    var results = channels.map(function(ch) { return computeChannelPnl(ch, range.from, range.to); });

    // Sort
    var sortCol = dashboardSort.col;
    var sortAsc = dashboardSort.asc;
    results.sort(function(a, b) {
      var va = a[sortCol], vb = b[sortCol];
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
    });

    // Totals
    var totals = { grossRevenue: 0, fees: 0, netRevenue: 0, transactionCount: 0 };
    results.forEach(function(r) {
      totals.grossRevenue += r.grossRevenue;
      totals.fees += r.fees;
      totals.netRevenue += r.netRevenue;
      totals.transactionCount += r.transactionCount;
    });
    var totalMargin = totals.grossRevenue > 0 ? Math.round(((totals.netRevenue) / totals.grossRevenue) * 10000) / 100 : 0;

    // Best / worst
    var withTxns = results.filter(function(r) { return r.transactionCount > 0; });
    var best = withTxns.length ? withTxns.reduce(function(b, r) { return r.marginPct > b.marginPct ? r : b; }) : null;
    var worst = withTxns.length > 1 ? withTxns.reduce(function(w, r) { return r.marginPct < w.marginPct ? r : w; }) : null;
    if (worst && best && worst.channelId === best.channelId) worst = null;

    var h = '';

    // Back link (detail-back pattern)
    h += '<button class="detail-back" onclick="channelShowList()">\u2190 Back to Channels</button>';

    // Header
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">Channel Dashboard</h3>';
    h += '</div>';

    // Period selector (button tab pattern — matches advisor.js)
    h += '<div style="display:flex;gap:4px;margin-bottom:16px;">';
    var periods = { '7d': '7 days', '30d': '30 days', '90d': '90 days', 'ytd': 'YTD', 'all': 'All time' };
    Object.keys(periods).forEach(function(p) {
      var isActive = dashboardPeriod === p;
      h += '<button onclick="channelSetPeriod(\'' + p + '\')"' +
        ' style="padding:6px 16px;border-radius:6px;font-size:0.85rem;cursor:pointer;border:none;transition:all 0.15s;' +
        'font-family:\'DM Sans\',sans-serif;' +
        (isActive ? 'background:var(--teal,#14b8a6);color:#fff;' : 'background:var(--bg-secondary,#232323);color:var(--warm-gray,#888);') + '">' +
        periods[p] + '</button>';
    });
    h += '</div>';

    // Summary cards (stat-card pattern — matches analytics)
    h += '<div class="analytics-summary">';

    function summaryCard(label, value, sub) {
      return '<div class="stat-card">' +
        '<div class="stat-card-value">' + esc(value) + '</div>' +
        '<div class="stat-card-label">' + esc(label) + '</div>' +
        (sub ? '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:2px;">' + sub + '</div>' : '') +
        '</div>';
    }

    h += summaryCard('Net Revenue', formatCurrency(totals.netRevenue));
    h += summaryCard('Gross Revenue', formatCurrency(totals.grossRevenue));
    h += summaryCard('Total Fees', formatCurrency(totals.fees));
    h += summaryCard('Avg Margin', totalMargin + '%');
    h += summaryCard('Active Channels', String(results.length));
    if (best) h += summaryCard('Best Margin', esc(best.channelName), best.marginPct + '%');
    h += '</div>';

    // Comparison table (data-table pattern)
    var cols = [
      { key: 'channelName', label: 'Channel', align: 'left' },
      { key: 'channelType', label: 'Type', align: 'left' },
      { key: 'grossRevenue', label: 'Gross', align: 'right' },
      { key: 'fees', label: 'Fees', align: 'right' },
      { key: 'netRevenue', label: 'Net', align: 'right' },
      { key: 'marginPct', label: 'Margin', align: 'right' },
      { key: 'transactionCount', label: 'Txns', align: 'right' },
      { key: 'targetPct', label: 'Target', align: 'right' }
    ];

    h += '<div class="data-table" style="overflow-x:auto;">';
    h += '<table role="grid">';
    h += '<thead><tr>';
    cols.forEach(function(col) {
      var arrow = '';
      if (dashboardSort.col === col.key) arrow = dashboardSort.asc ? ' &#9650;' : ' &#9660;';
      h += '<th style="text-align:' + col.align + ';cursor:pointer;user-select:none;white-space:nowrap;"' +
        ' onclick="channelSortDashboard(\'' + col.key + '\')" role="columnheader" tabindex="0"' +
        ' onkeydown="if(event.key===\'Enter\')channelSortDashboard(\'' + col.key + '\')"' +
        ' aria-sort="' + (dashboardSort.col === col.key ? (dashboardSort.asc ? 'ascending' : 'descending') : 'none') + '">' +
        esc(col.label) + arrow + '</th>';
    });
    h += '</tr></thead>';
    h += '<tbody>';

    results.forEach(function(r) {
      var isWorst = worst && r.channelId === worst.channelId;
      var isBest = best && r.channelId === best.channelId;
      var rowBg = isWorst ? 'rgba(239,68,68,0.06)' : (isBest ? 'rgba(34,197,94,0.06)' : '');

      h += '<tr style="' + (rowBg ? 'background:' + rowBg + ';' : '') + 'cursor:pointer;" onclick="channelOpenDetail(\'' + esc(r.channelId) + '\')"' +
        ' role="row" tabindex="0" onkeydown="if(event.key===\'Enter\')channelOpenDetail(\'' + esc(r.channelId) + '\')">';
      h += '<td style="font-weight:500;">' + esc(r.channelName) + '</td>';
      h += '<td>' + typeBadge(r.channelType) + '</td>';
      h += '<td style="text-align:right;">' + formatCurrency(r.grossRevenue) + '</td>';
      h += '<td style="text-align:right;color:#f87171;">' + (r.fees > 0 ? '-' + formatCurrency(r.fees) : '$0.00') + '</td>';
      h += '<td style="text-align:right;font-weight:600;">' + formatCurrency(r.netRevenue) + '</td>';

      var marginColor = r.marginPct >= 60 ? '#22c55e' : (r.marginPct >= 30 ? '#f59e0b' : '#ef4444');
      if (r.transactionCount === 0) marginColor = 'var(--warm-gray-light,#666)';
      h += '<td style="text-align:right;color:' + marginColor + ';">' +
        (r.transactionCount > 0 ? r.marginPct + '%' : '\u2014') + '</td>';

      h += '<td style="text-align:right;color:var(--warm-gray);">' + r.transactionCount + '</td>';

      // Target column
      if (r.targetPct !== null) {
        var tColor = r.targetPct >= 100 ? '#22c55e' : (r.targetPct >= 50 ? '#f59e0b' : '#ef4444');
        h += '<td style="text-align:right;color:' + tColor + ';">' + r.targetPct + '%</td>';
      } else {
        h += '<td style="text-align:right;color:var(--warm-gray-light,#666);">\u2014</td>';
      }

      h += '</tr>';
    });

    // Totals row
    h += '<tr style="font-weight:600;border-top:2px solid var(--cream-dark,#555);">';
    h += '<td>Total</td>';
    h += '<td></td>';
    h += '<td style="text-align:right;">' + formatCurrency(totals.grossRevenue) + '</td>';
    h += '<td style="text-align:right;color:#f87171;">' + (totals.fees > 0 ? '-' + formatCurrency(totals.fees) : '$0.00') + '</td>';
    h += '<td style="text-align:right;">' + formatCurrency(totals.netRevenue) + '</td>';
    h += '<td style="text-align:right;">' + totalMargin + '%</td>';
    h += '<td style="text-align:right;color:var(--warm-gray);">' + totals.transactionCount + '</td>';
    h += '<td></td>';
    h += '</tr>';

    h += '</tbody></table>';
    h += '</div>';

    tab.innerHTML = h;
  }

  // ============================================================
  // MastNavStack — Register Restorer
  // ============================================================

  if (window.MastNavStack) {
    window.MastNavStack.registerRestorer('channels', function(view, state) {
      if (view === 'detail' && state && state.channelId) {
        selectedChannelId = state.channelId;
        detailTab = state.tab || 'overview';
        currentView = 'detail';
        channelEditMode = false;
        if (channelsLoaded) {
          renderCurrentView();
        } else {
          loadChannels();
        }
      }
    });
  }

  // ============================================================
  // Window-exposed functions (for onclick handlers in HTML)
  // ============================================================

  window.channelShowList = showList;
  window.channelShowDashboard = showDashboard;
  window.channelSetPeriod = setDashboardPeriod;
  window.channelSortDashboard = setDashboardSort;
  window.channelOpenDetail = openDetail;
  window.channelShowNew = showNew;
  window.channelEnterEdit = enterEdit;
  window.channelSaveEdit = saveEdit;
  window.channelCancelEdit = cancelEdit;
  window.channelSetTab = setTab;
  window.channelBackToList = backToList;
  window.channelDelete = deleteChannel;
  window.channelRerender = function() { renderList(); };
  window.channelTypeChanged = typeChanged;
  window.channelSaveNew = saveNew;
  window.channelToggleEligibility = toggleEligibility;
  window.channelToggleActive = toggleActive;
  window.channelLoadActivity = loadActivity;
  window.channelShowAddProducts = showAddProducts;
  window.channelCloseAddProducts = closeAddProducts;
  window.channelToggleSelectAll = toggleSelectAll;
  window.channelConfirmAddProducts = confirmAddProducts;
  window.channelRemoveProduct = removeProduct;
  window.channelLoadEventComparison = loadEventComparison;
  window.channelSortEventComp = setEventCompSort;
  window.channelLoadLiveSessions = loadLiveSessions;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('channels', {
    routes: {
      'channels': {
        tab: 'channelsTab',
        setup: function() {
          currentView = 'list';
          selectedChannelId = null;
          detailTab = 'overview';
          channelEditMode = false;
          loadChannels();
        }
      }
    },
    detachListeners: function() {
      unloadChannels();
    }
  });

})();
