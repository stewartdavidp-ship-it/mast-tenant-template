/**
 * Customers Module — Canonical person hub.
 *
 * v1 scope (Phase 4): list page, source filter, search, sort, duplicates queue,
 * minimal detail-view stub. Renders entirely from JS into the empty
 * #customersTab container, mirroring the students module pattern.
 *
 * Loaded skills before writing: mast-ux-style-guide, mast-security-checklist.
 * Uses global esc() for all data interpolation. CSS vars only — no hardcoded
 * hex. Standard .btn / .detail-back / .data-table / .loading patterns.
 *
 * Phase 5 will add: linked orders + enrollments lists, embedded interactions
 * tab (absorbs the existing contacts module), wallet/membership/loyalty
 * mirror, tag + notes editing, manual merge UI.
 *
 * Plan: snoopy-gathering-sun.md
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var customersData = [];
  var duplicatesData = [];
  var customersLoaded = false;
  var currentView = 'list'; // list | detail | duplicates
  var selectedCustomerId = null;

  var SOURCE_OPTIONS = [
    { value: 'all',         label: 'All sources' },
    { value: 'order',       label: 'Order' },
    { value: 'enrollment',  label: 'Enrollment' },
    { value: 'contact',     label: 'Contact' },
    { value: 'newsletter',  label: 'Newsletter' },
    { value: 'account',     label: 'Account' },
    { value: 'manual',      label: 'Manual' },
    { value: 'import',      label: 'Import' }
  ];

  var SORT_OPTIONS = [
    { value: 'updatedAt', label: 'Recently updated' },
    { value: 'createdAt', label: 'Newest' },
    { value: 'name',      label: 'Name (A–Z)' },
    { value: 'email',     label: 'Email (A–Z)' }
  ];

  // ============================================================
  // Helpers
  // ============================================================

  function relativeTime(iso) {
    if (!iso) return '—';
    try {
      var diff = Date.now() - new Date(iso).getTime();
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      var days = Math.floor(hrs / 24);
      if (days < 7) return days + 'd ago';
      return new Date(iso).toLocaleDateString();
    } catch (e) {
      return '—';
    }
  }

  // Source uses .status-badge with semantic palette colors per ux skill.
  // No new badge system invented — small text label inside the unified badge.
  function sourceBadge(source) {
    if (!source) return '';
    var bg, color;
    switch (source) {
      case 'order':       bg = 'rgba(42,124,111,0.18)';  color = 'var(--teal-deep)'; break;
      case 'enrollment':  bg = 'rgba(196,133,60,0.15)';  color = 'var(--amber)'; break;
      case 'contact':     bg = 'rgba(99,102,241,0.15)';  color = '#6366f1'; break;
      case 'newsletter':  bg = 'rgba(220,53,69,0.12)';   color = 'var(--danger)'; break;
      case 'account':     bg = 'rgba(22,163,74,0.15)';   color = '#16a34a'; break;
      case 'import':      bg = 'rgba(245,158,11,0.15)';  color = '#f59e0b'; break;
      default:            bg = 'rgba(155,149,142,0.18)'; color = 'var(--warm-gray)';
    }
    return '<span class="status-badge" style="background:' + bg + ';color:' + color + ';">' + esc(source) + '</span>';
  }

  // ============================================================
  // Data loading
  // ============================================================

  async function loadCustomers() {
    var container = document.getElementById('customersTab');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading customers…</div>';

    try {
      var results = await Promise.all([
        MastDB._ref('admin/customers').orderByChild('updatedAt').limitToLast(500).once('value'),
        MastDB._ref('admin/customerDuplicates').orderByChild('detectedAt').limitToLast(50).once('value')
      ]);
      var cVal = results[0].val() || {};
      customersData = Object.values(cVal);

      var dVal = results[1].val() || {};
      duplicatesData = Object.entries(dVal)
        .map(function(entry) { var v = entry[1]; v._flagId = entry[0]; return v; })
        .filter(function(d) { return d.status !== 'merged'; });

      customersLoaded = true;
    } catch (e) {
      console.error('[customers] load failed', e);
      customersData = [];
      duplicatesData = [];
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">Failed to load customers: ' + esc(e && e.message) + '</div>';
      return;
    }

    render();
  }

  // ============================================================
  // Top-level render
  // ============================================================

  function render() {
    var container = document.getElementById('customersTab');
    if (!container) return;

    var h = '';
    h += '<div class="view-tabs" style="margin-bottom:20px;">';
    h += '<button class="view-tab' + (currentView === 'list' || currentView === 'detail' ? ' active' : '') + '" onclick="customersSwitchView(\'list\')">Customers</button>';
    h += '<button class="view-tab' + (currentView === 'duplicates' ? ' active' : '') + '" onclick="customersSwitchView(\'duplicates\')">Duplicates';
    if (duplicatesData.length > 0) {
      h += ' <span class="status-badge" style="background:var(--danger);color:white;margin-left:6px;">' + duplicatesData.length + '</span>';
    }
    h += '</button>';
    h += '</div>';

    if (currentView === 'list') {
      h += renderList();
    } else if (currentView === 'detail') {
      h += renderDetail();
    } else if (currentView === 'duplicates') {
      h += renderDuplicates();
    }

    container.innerHTML = h;
  }

  // ============================================================
  // Surface 1: Customers List
  // ============================================================

  function renderList() {
    var totalCount = customersData.length;

    var h = '';
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:12px;">';
    h += '<div>';
    h += '<h2 style="margin:0;">Customers</h2>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    h += totalCount + ' total · auto-created from orders, enrollments, contacts, newsletter signups';
    h += '</div>';
    h += '</div>';
    h += '</div>';

    if (totalCount === 0) {
      h += renderEmptyState();
      return h;
    }

    // Filter bar
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">';
    h += '<input type="text" id="customersSearch" placeholder="Search by name or email…" oninput="customersRender()" ' +
         'style="flex:1;min-width:220px;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:DM Sans,sans-serif;font-size:0.9rem;">';

    h += '<select id="customersSourceFilter" onchange="customersRender()" ' +
         'style="padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:DM Sans,sans-serif;font-size:0.9rem;">';
    SOURCE_OPTIONS.forEach(function(opt) {
      h += '<option value="' + esc(opt.value) + '">' + esc(opt.label) + '</option>';
    });
    h += '</select>';

    h += '<select id="customersSortBy" onchange="customersRender()" ' +
         'style="padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:DM Sans,sans-serif;font-size:0.9rem;">';
    SORT_OPTIONS.forEach(function(opt) {
      h += '<option value="' + esc(opt.value) + '">' + esc(opt.label) + '</option>';
    });
    h += '</select>';
    h += '</div>';

    h += '<div id="customersTableWrap"></div>';

    return h;
  }

  function renderEmptyState() {
    var h = '';
    h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
    h += '<div style="font-size:2rem;margin-bottom:12px;">👥</div>';
    h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No customers yet</p>';
    h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">They\'ll appear here automatically as orders, enrollments, contacts, and newsletter signups come in.</p>';
    h += '</div>';
    return h;
  }

  // Re-rendered on every search/filter/sort change without re-fetching.
  function renderTable() {
    var wrap = document.getElementById('customersTableWrap');
    if (!wrap) return;

    var search = (document.getElementById('customersSearch') || {}).value || '';
    var sourceFilter = (document.getElementById('customersSourceFilter') || {}).value || 'all';
    var sortBy = (document.getElementById('customersSortBy') || {}).value || 'updatedAt';
    var q = search.trim().toLowerCase();

    var filtered = customersData.filter(function(c) {
      if (!c) return false;
      if (sourceFilter !== 'all' && c.source !== sourceFilter) return false;
      if (!q) return true;
      var name = (c.displayName || '').toLowerCase();
      var email = (c.primaryEmail || '').toLowerCase();
      var emails = (c.emails || []).join(' ').toLowerCase();
      return name.indexOf(q) !== -1 || email.indexOf(q) !== -1 || emails.indexOf(q) !== -1;
    });

    filtered.sort(function(a, b) {
      if (sortBy === 'name')  return (a.displayName || '').localeCompare(b.displayName || '');
      if (sortBy === 'email') return (a.primaryEmail || '').localeCompare(b.primaryEmail || '');
      // createdAt / updatedAt — newest first
      var av = a[sortBy] || '';
      var bv = b[sortBy] || '';
      return bv.localeCompare(av);
    });

    if (filtered.length === 0) {
      wrap.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No customers match your filters.</div>';
      return;
    }

    var rows = filtered.map(function(c) {
      var linked = c.linkedIds || {};
      var bits = [];
      var emailCount = (c.emails || []).length;
      var uidCount = (linked.uids || []).length;
      var contactCount = (linked.contactIds || []).length;
      if (emailCount > 1) bits.push(emailCount + ' emails');
      if (uidCount > 0) bits.push(uidCount + ' uid' + (uidCount > 1 ? 's' : ''));
      if (contactCount > 0) bits.push(contactCount + ' contact' + (contactCount > 1 ? 's' : ''));
      var linkedText = bits.length ? bits.join(' · ') : '—';

      var nameDisplay = esc(c.displayName || c.primaryEmail || c.id);
      var emailDisplay = esc(c.primaryEmail || '—');

      return '<tr data-customer-id="' + esc(c.id) + '" style="cursor:pointer;" onclick="customersOpenDetail(this.dataset.customerId)">' +
        '<td>' + nameDisplay + '</td>' +
        '<td style="color:var(--warm-gray);">' + emailDisplay + '</td>' +
        '<td>' + sourceBadge(c.source) + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(linkedText) + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(relativeTime(c.updatedAt || c.createdAt)) + '</td>' +
      '</tr>';
    }).join('');

    var html = '';
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">Showing ' + filtered.length + ' of ' + customersData.length + '</div>';
    html += '<div class="data-table"><table>';
    html += '<thead><tr>';
    html += '<th>Name</th><th>Primary email</th><th>Source</th><th>Linked</th><th>Last activity</th>';
    html += '</tr></thead>';
    html += '<tbody>' + rows + '</tbody>';
    html += '</table></div>';
    wrap.innerHTML = html;
  }

  // ============================================================
  // Surface 2: Customer Detail (Phase 5 stub)
  // ============================================================

  function renderDetail() {
    var c = customersData.find(function(x) { return x && x.id === selectedCustomerId; });
    if (!c) {
      return '<div style="text-align:center;padding:40px;color:var(--warm-gray);">Customer not found.</div>';
    }
    var linked = c.linkedIds || {};

    var h = '';
    h += '<button class="detail-back" onclick="customersSwitchView(\'list\')">← Back to Customers</button>';

    // Header — matches detail-view layout from style guide
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:12px;">';
    h += '<div>';
    h += '<h3 style="margin:0;">' + esc(c.displayName || c.primaryEmail || c.id) + '</h3>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">' + esc(c.primaryEmail || 'no primary email') + '</div>';
    h += '</div>';
    h += '<div>' + sourceBadge(c.source) + '</div>';
    h += '</div>';

    // Identity card
    h += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;margin-bottom:16px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;margin-bottom:12px;">Identity</div>';
    h += '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">';
    h += identityRow('Customer ID', '<span style="font-family:monospace;font-size:0.78rem;">' + esc(c.id) + '</span>');
    h += identityRow('Emails', (c.emails || []).map(esc).join('<br>') || '—');
    h += identityRow('Phones', (c.phones || []).map(esc).join('<br>') || '—');
    h += identityRow('Linked uids', (linked.uids || []).map(function(u) {
      return '<span style="font-family:monospace;font-size:0.78rem;">' + esc(u) + '</span>';
    }).join('<br>') || '—');
    h += identityRow('Contact IDs', (linked.contactIds || []).map(function(id) {
      return '<span style="font-family:monospace;font-size:0.78rem;">' + esc(id) + '</span>';
    }).join('<br>') || '—');
    h += identityRow('Tags', (c.tags || []).map(esc).join(', ') || '—');
    h += identityRow('Newsletter', c.marketing && c.marketing.newsletterOptIn ? 'Opted in' : '—');
    h += identityRow('Created', esc(c.createdAt || '—'));
    h += identityRow('Updated', esc(c.updatedAt || '—'));
    h += '</div>';
    h += '</div>';

    // Phase 5 placeholder
    h += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;color:var(--warm-gray);font-size:0.85rem;">';
    h += '<strong style="color:var(--charcoal);">Phase 5 will add:</strong> ';
    h += 'linked orders, linked enrollments, interactions tab (absorbs the contacts module), ';
    h += 'wallet · membership · loyalty mirror, inline tag editing, notes, manual merge.';
    h += '</div>';

    return h;
  }

  function identityRow(label, valueHtml) {
    return '<div style="color:var(--warm-gray-light);">' + esc(label) + '</div>' +
           '<div>' + valueHtml + '</div>';
  }

  // ============================================================
  // Surface 3: Duplicates Queue (read-only v1)
  // ============================================================

  function renderDuplicates() {
    var h = '';
    h += '<div style="margin-bottom:16px;">';
    h += '<h2 style="margin:0;">Duplicate customer flags</h2>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    h += 'Conflicts where a uid and email resolved to different existing customers. ';
    h += 'Flag-only in v1 — manual merge UI lands in Phase 5.';
    h += '</div>';
    h += '</div>';

    if (duplicatesData.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:2rem;margin-bottom:12px;">✓</div>';
      h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No pending duplicates</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">When the resolver detects a conflict, it shows up here.</p>';
      h += '</div>';
      return h;
    }

    duplicatesData.forEach(function(d) {
      h += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:14px 18px;margin-bottom:10px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
      h += '<div style="font-size:0.85rem;">';
      h += '<div style="font-weight:600;margin-bottom:4px;">' + esc(d.reason || 'duplicate detected') + '</div>';
      h += '<div style="color:var(--warm-gray);font-size:0.78rem;">';
      h += 'A: <span data-customer-id="' + esc(d.customerIdA) + '" style="font-family:monospace;cursor:pointer;text-decoration:underline;" onclick="customersOpenDetail(this.dataset.customerId)">' + esc(d.customerIdA) + '</span><br>';
      h += 'B: <span data-customer-id="' + esc(d.customerIdB) + '" style="font-family:monospace;cursor:pointer;text-decoration:underline;" onclick="customersOpenDetail(this.dataset.customerId)">' + esc(d.customerIdB) + '</span>';
      h += '</div>';
      if (d.sourceRecord) {
        h += '<div style="color:var(--warm-gray-light);font-size:0.78rem;margin-top:4px;">trigger: ' + esc(JSON.stringify(d.sourceRecord)) + '</div>';
      }
      h += '</div>';
      h += '<div style="color:var(--warm-gray);font-size:0.78rem;">' + esc(relativeTime(d.detectedAt)) + '</div>';
      h += '</div>';
      h += '</div>';
    });

    return h;
  }

  // ============================================================
  // Navigation
  // ============================================================

  function switchView(view) {
    currentView = view;
    if (view !== 'detail') selectedCustomerId = null;
    render();
    if (view === 'list') {
      // Render the inner table after the outer markup is in the DOM
      requestAnimationFrame(renderTable);
    }
  }

  function openDetail(customerId) {
    selectedCustomerId = customerId;
    currentView = 'detail';
    render();
  }

  // ============================================================
  // Globals exposed for inline onclick handlers
  // (matching the studentsSwitchView / studentsViewDetail pattern)
  // ============================================================

  window.customersSwitchView = switchView;
  window.customersOpenDetail = openDetail;
  window.customersRender = renderTable;

  // ============================================================
  // Module registration
  // ============================================================

  MastAdmin.registerModule('customers', {
    routes: {
      'customers': {
        tab: 'customersTab',
        setup: function() {
          if (!customersLoaded) {
            currentView = 'list';
            selectedCustomerId = null;
            loadCustomers();
          } else {
            currentView = 'list';
            selectedCustomerId = null;
            render();
            requestAnimationFrame(renderTable);
          }
        }
      }
    },
    detachListeners: function() {
      customersData = [];
      duplicatesData = [];
      customersLoaded = false;
      currentView = 'list';
      selectedCustomerId = null;
    }
  });

})();
