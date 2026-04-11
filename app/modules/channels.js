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
  var currentView = 'list';    // 'list' | 'detail' | 'new'
  var selectedChannelId = null;
  var detailTab = 'overview';  // 'overview' | 'products' | 'activity' | 'settings'
  var channelEditMode = false; // Paradigm A — read-only until user clicks Edit
  var editBaseline = null;     // snapshot for dirty check
  var ordersData = {};         // for activity tab

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
    if (tab) tab.innerHTML = '<div style="text-align:center;padding:40px;color:var(--warm-gray);font-size:0.9rem;">Loading channels...</div>';

    MastDB._ref('admin/channels').once('value').then(function(snap) {
      channelsData = snap.val() || {};
      channelsLoaded = true;
      loadProducts().then(function() {
        renderCurrentView();
      });
    }).catch(function(err) {
      console.error('Error loading channels:', err);
      if (tab) tab.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);font-size:0.9rem;">Error loading channels.</div>';
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

  function unloadChannels() {
    channelsData = {};
    channelsLoaded = false;
    productsData = {};
    productsLoaded = false;
    ordersData = {};
    currentView = 'list';
    selectedChannelId = null;
    detailTab = 'overview';
    channelEditMode = false;
    editBaseline = null;
    if (window.MastDirty) { try { MastDirty.unregister('channelEdit'); } catch (e) {} }
  }

  // ============================================================
  // View Router
  // ============================================================

  function renderCurrentView() {
    if (currentView === 'detail' && selectedChannelId) {
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
        '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
          '<div style="font-size:1.6rem;margin-bottom:12px;">📡</div>' +
          '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No sales channels yet</p>' +
          '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add your first channel to start tracking multi-channel sales.</p>' +
          '<button class="btn btn-primary" style="margin-top:16px;" onclick="channelShowNew()">+ New Channel</button>' +
        '</div>';
      return;
    }

    var h = '';

    // Header
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">Channels</h3>';
    h += '<button class="btn btn-primary" onclick="channelShowNew()">+ New Channel</button>';
    h += '</div>';

    // Filter bar
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">';
    h += '<input type="text" id="chSearchInput" placeholder="Search channels\u2026" oninput="channelRerender()"' +
      ' value="' + esc(searchVal) + '"' +
      ' style="flex:1;min-width:200px;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    h += '<select id="chTypeFilter" onchange="channelRerender()"' +
      ' style="padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    h += '<option value="">All types</option>';
    Object.keys(CHANNEL_TYPES).forEach(function(key) {
      var sel = typeVal === key ? ' selected' : '';
      h += '<option value="' + key + '"' + sel + '>' + esc(CHANNEL_TYPES[key].label) + '</option>';
    });
    h += '</select>';
    h += '</div>';

    // Channel cards
    if (!filtered.length) {
      h += '<div style="text-align:center;padding:30px;color:var(--warm-gray);font-size:0.85rem;">No channels match your filters.</div>';
    } else {
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;">';
      filtered.forEach(function(ch) {
        var pCount = productCountForChannel(ch.channelId);
        h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;cursor:pointer;transition:border-color 0.15s;"' +
          ' onmouseenter="this.style.borderColor=\'var(--amber)\'" onmouseleave="this.style.borderColor=\'var(--warm-gray-light)\'"' +
          ' onclick="channelOpenDetail(\'' + esc(ch.channelId) + '\')" role="button" tabindex="0"' +
          ' onkeydown="if(event.key===\'Enter\')channelOpenDetail(\'' + esc(ch.channelId) + '\')">';

        // Row 1: name + status
        h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">';
        h += '<div style="font-weight:500;font-size:0.9rem;color:var(--cream);">' + esc(ch.name) + '</div>';
        h += statusDot(ch.isActive);
        h += '</div>';

        // Row 2: type badge + external platform
        h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">';
        h += typeBadge(ch.type);
        if (ch.externalPlatform) {
          h += '<span style="font-size:0.72rem;color:var(--warm-gray);">' + esc(ch.externalPlatform) + '</span>';
        }
        h += '</div>';

        // Row 3: stats
        h += '<div style="display:flex;gap:16px;font-size:0.78rem;color:var(--warm-gray);">';
        h += '<span>' + feeSummary(ch) + '</span>';
        h += '<span>' + pCount + ' product' + (pCount !== 1 ? 's' : '') + '</span>';
        h += '</div>';

        // Row 4: last updated
        if (ch.updatedAt) {
          h += '<div style="font-size:0.72rem;color:var(--warm-gray-light);margin-top:8px;">Updated ' + relativeTime(ch.updatedAt) + '</div>';
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
    if (ch.externalPlatform) h += '<span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(ch.externalPlatform) + '</span>';
    h += '</div>';
    h += '</div>';

    // Edit button / Editing indicator (Paradigm A)
    h += '<div>';
    if (!channelEditMode) {
      h += '<button class="btn btn-secondary btn-small" onclick="channelEnterEdit()">Edit</button>';
    } else {
      h += '<span style="font-size:0.72rem;color:var(--amber);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Editing</span>';
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
        'color:' + (isActive ? 'var(--amber)' : 'var(--warm-gray)') + ';' +
        'border-bottom:2px solid ' + (isActive ? 'var(--amber)' : 'transparent') + ';' +
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
    h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;margin-bottom:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:12px;">Fee Profile</div>';
    h += '<div style="font-size:1.15rem;font-weight:500;color:var(--amber);">' + esc(feeSummary(ch)) + '</div>';
    h += '<div style="display:flex;gap:24px;margin-top:12px;font-size:0.78rem;color:var(--warm-gray);">';
    h += '<div><span style="color:var(--warm-gray-light);">Ownership:</span> ' + esc(ch.ownershipModel || '—') + '</div>';
    h += '<div><span style="color:var(--warm-gray-light);">Pricing:</span> ' + esc(ch.pricingModel || '—') + '</div>';
    h += '<div><span style="color:var(--warm-gray-light);">Inventory:</span> ' + esc(ch.inventoryModel || '—') + '</div>';
    h += '</div>';
    if (ch.defaultPricingTier) {
      h += '<div style="margin-top:8px;font-size:0.78rem;color:var(--warm-gray);"><span style="color:var(--warm-gray-light);">Pricing tier:</span> ' + esc(ch.defaultPricingTier) + '</div>';
    }
    h += '</div>';

    // Contact info
    if (ch.contactName || ch.contactEmail || ch.contactPhone) {
      h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:8px;">Contact</div>';
      if (ch.contactName) h += '<div style="font-size:0.9rem;color:var(--cream);">' + esc(ch.contactName) + '</div>';
      if (ch.contactEmail) h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + esc(ch.contactEmail) + '</div>';
      if (ch.contactPhone) h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + esc(ch.contactPhone) + '</div>';
      h += '</div>';
    }

    // Relationship notes
    if (ch.relationshipNotes) {
      h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:8px;">Notes</div>';
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);white-space:pre-wrap;">' + esc(ch.relationshipNotes) + '</div>';
      h += '</div>';
    }

    // Contract terms
    if (ch.contractTerms) {
      h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:8px;">Contract Terms</div>';
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);white-space:pre-wrap;">' + esc(ch.contractTerms) + '</div>';
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
      h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:8px;">Consignment Details</div>';
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">Settlement tracking available in Galleries &amp; Consignment module.</div>';
      h += '</div>';
    } else if (ch.type === 'marketplace') {
      h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:8px;">Marketplace</div>';
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">Platform: ' + esc(ch.externalPlatform || 'Not set') + '</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:4px;">PIM sync managed via publish tools.</div>';
      h += '</div>';
    } else if (ch.type === 'mobile_events') {
      h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:8px;">Craft Fairs &amp; Events</div>';
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">Per-show P&amp;L available in the Shows module.</div>';
      h += '</div>';
    } else if (ch.type === 'wholesale_prebuy' || ch.type === 'retail_prebuy') {
      h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;margin-bottom:16px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:8px;">Wholesale</div>';
      if (ch.defaultPricingTier) {
        h += '<div style="font-size:0.85rem;color:var(--warm-gray);">Default pricing tier: ' + esc(ch.defaultPricingTier) + '</div>';
      }
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:4px;">Wholesale orders managed via the Wholesale module.</div>';
      h += '</div>';
    }
    return h;
  }

  // ============================================================
  // Products Tab
  // ============================================================

  function renderProductsTab(ch) {
    var products = getProductsForChannel(ch.channelId);
    var h = '';

    if (!products.length) {
      h += '<div style="text-align:center;padding:30px;color:var(--warm-gray);">';
      h += '<div style="font-size:0.9rem;margin-bottom:4px;">No products on this channel</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);">Products are assigned to channels via the product detail page or channel eligibility defaults.</div>';
      h += '</div>';
      return h;
    }

    h += '<div class="data-table"><table>';
    h += '<thead><tr>';
    h += '<th style="font-size:0.78rem;">Product</th>';
    h += '<th style="font-size:0.78rem;">Price</th>';
    h += '<th style="font-size:0.78rem;">Status</th>';
    h += '</tr></thead><tbody>';

    products.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    products.forEach(function(p) {
      h += '<tr>';
      h += '<td style="font-size:0.85rem;">' + esc(p.name || p.pid) + '</td>';
      h += '<td style="font-size:0.85rem;">' + (p.priceCents ? formatCurrency(p.priceCents) : '—') + '</td>';
      h += '<td style="font-size:0.85rem;">';
      var st = p.status || 'active';
      var stColor = st === 'active' ? '#22c55e' : st === 'draft' ? '#f59e0b' : '#9ca3af';
      h += '<span style="color:' + stColor + ';">' + esc(st) + '</span>';
      h += '</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
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
        h += '<div style="text-align:center;padding:30px;color:var(--warm-gray);">';
        h += '<div style="font-size:0.9rem;margin-bottom:8px;">Loading activity...</div>';
        h += '<button class="btn btn-secondary btn-small" onclick="channelLoadActivity()">Load Orders</button>';
        h += '</div>';
        return h;
      }
      h += '<div style="text-align:center;padding:30px;color:var(--warm-gray);">';
      h += '<div style="font-size:0.9rem;">No orders attributed to this channel yet.</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:4px;">Orders are attributed via autoMatchSources or channelId.</div>';
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
    h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:12px;">Fee Profile</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';
    h += fieldGroup('Percent Fee (%)', 'chFeePercent', ch.percentFee || '', ro, 'number', '0', '0.1');
    h += fieldGroup('Fixed Fee / Order (cents)', 'chFeeFixed', ch.fixedFeePerOrderCents || '', ro, 'number', '0');
    h += fieldGroup('Monthly Fixed (cents)', 'chFeeMonthly', ch.monthlyFixedCents || '', ro, 'number', '0');
    h += '</div>';
    h += '</div>';

    // Auto-match sources
    h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:8px;">Auto-Match Sources</div>';
    var srcs = ch.autoMatchSources || [];
    if (srcs.length) {
      h += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
      srcs.forEach(function(s) {
        h += '<span style="background:var(--warm-gray-light);color:var(--cream);padding:2px 8px;border-radius:4px;font-size:0.78rem;">' + esc(s) + '</span>';
      });
      h += '</div>';
    } else {
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);">No auto-match sources configured.</div>';
    }
    h += '</div>';

    // Default eligibility toggle (atomic widget — saves on action)
    h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div>';
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);">Default Eligibility</div>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' +
      (ch.defaultEligibility === 'opt-in' ? 'Opt-in: products must be explicitly added to this channel.' : 'Opt-out: new products are automatically eligible for this channel.') +
      '</div>';
    h += '</div>';
    h += '<label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;" aria-label="Toggle default eligibility">';
    h += '<input type="checkbox" ' + (ch.defaultEligibility !== 'opt-in' ? 'checked' : '') +
      ' onchange="channelToggleEligibility(\'' + esc(ch.channelId) + '\', this.checked)"' +
      ' style="opacity:0;width:0;height:0;">';
    h += '<span style="position:absolute;inset:0;background:' + (ch.defaultEligibility !== 'opt-in' ? 'var(--teal)' : 'var(--warm-gray-light)') +
      ';border-radius:12px;transition:background 0.2s;"></span>';
    h += '<span style="position:absolute;top:2px;left:' + (ch.defaultEligibility !== 'opt-in' ? '22px' : '2px') +
      ';width:20px;height:20px;background:white;border-radius:50%;transition:left 0.2s;"></span>';
    h += '</label>';
    h += '</div>';
    h += '</div>';

    // Contact fields
    h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:12px;">Contact</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';
    h += fieldGroup('Name', 'chContactName', ch.contactName || '', ro);
    h += fieldGroup('Email', 'chContactEmail', ch.contactEmail || '', ro, 'email');
    h += fieldGroup('Phone', 'chContactPhone', ch.contactPhone || '', ro, 'tel');
    h += '</div>';
    h += '</div>';

    // Revenue target
    h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;">';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += fieldGroup('Revenue Target (cents)', 'chRevenueTarget', ch.revenueTarget || '', ro, 'number', '0');
    h += fieldGroup('External Platform', 'chExtPlatform', ch.externalPlatform || '', ro);
    h += '</div>';
    h += '</div>';

    // Notes
    h += '<div style="background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:8px;padding:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--cream);margin-bottom:8px;">Notes</div>';
    if (ro) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);white-space:pre-wrap;">' + esc(ch.notes || 'No notes.') + '</div>';
    } else {
      h += '<textarea id="chNotes" rows="3" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\',sans-serif;font-size:0.85rem;resize:vertical;">' +
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
    h += '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:4px;" for="' + id + '">' + esc(label) + '</label>';
    if (readOnly) {
      h += '<div style="font-size:0.9rem;color:var(--cream);padding:9px 0;">' + esc(value || '—') + '</div>';
    } else {
      h += '<input type="' + (type || 'text') + '" id="' + id + '" value="' + esc(String(value)) + '"' +
        (min !== undefined ? ' min="' + min + '"' : '') +
        (step ? ' step="' + step + '"' : '') +
        ' style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
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
    h += '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:4px;" for="newChName">Channel Name *</label>';
    h += '<input type="text" id="newChName" placeholder="e.g. Etsy, Gallery Blue, TikTok Shop" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    h += '</div>';

    // Type selector
    h += '<div>';
    h += '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:4px;" for="newChType">Channel Type *</label>';
    h += '<select id="newChType" onchange="channelTypeChanged()"' +
      ' style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    h += '<option value="">Select a type...</option>';
    Object.keys(CHANNEL_TYPES).forEach(function(key) {
      var t = CHANNEL_TYPES[key];
      h += '<option value="' + key + '">' + esc(t.label) + ' (' + t.ownership + ', ' + t.pricing + ')</option>';
    });
    h += '</select>';
    h += '</div>';

    // Auto-filled classification (shown after type selected)
    h += '<div id="newChClassification" style="display:none;font-size:0.78rem;color:var(--warm-gray);padding:8px 12px;background:var(--charcoal);border:1px solid var(--warm-gray-light);border-radius:6px;"></div>';

    // Fee fields
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';
    h += fieldGroup('Percent Fee (%)', 'newChFeePercent', '', false, 'number', '0', '0.1');
    h += fieldGroup('Fixed Fee / Order (cents)', 'newChFeeFixed', '', false, 'number', '0');
    h += fieldGroup('Monthly Fixed (cents)', 'newChFeeMonthly', '', false, 'number', '0');
    h += '</div>';

    // External platform
    h += '<div id="newChExtPlatformWrap">';
    h += '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:4px;" for="newChExtPlatform">External Platform</label>';
    h += '<input type="text" id="newChExtPlatform" placeholder="e.g. Etsy, Shopify, TikTok" style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    h += '</div>';

    // Default eligibility
    h += '<div style="display:flex;align-items:center;gap:12px;">';
    h += '<label style="font-size:0.85rem;color:var(--cream);" for="newChOptOut">New products auto-eligible</label>';
    h += '<input type="checkbox" id="newChOptOut" checked style="accent-color:var(--teal);">';
    h += '<span style="font-size:0.72rem;color:var(--warm-gray);">(opt-out = checked, opt-in = unchecked)</span>';
    h += '</div>';

    // Contact
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">';
    h += fieldGroup('Contact Name', 'newChContactName', '', false);
    h += fieldGroup('Contact Email', 'newChContactEmail', '', false, 'email');
    h += fieldGroup('Contact Phone', 'newChContactPhone', '', false, 'tel');
    h += '</div>';

    // Notes
    h += '<div>';
    h += '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:4px;" for="newChNotes">Notes</label>';
    h += '<textarea id="newChNotes" rows="3" placeholder="Optional notes about this channel..." style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\',sans-serif;font-size:0.85rem;resize:vertical;"></textarea>';
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
