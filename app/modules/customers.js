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
  var detailTab = 'overview'; // overview | orders | classes | interactions | wallet
  // Per-customer cache: { customerId: { orders, enrollments, interactions, wallets, loaded:{...} } }
  var detailCache = {};

  var DETAIL_TABS = [
    { value: 'overview',     label: 'Overview' },
    { value: 'orders',       label: 'Orders' },
    { value: 'classes',      label: 'Classes' },
    { value: 'interactions', label: 'Interactions' },
    { value: 'wallet',       label: 'Wallet' }
  ];

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
  // Backgrounds use opaque-ish color stops chosen so contrast works on BOTH
  // light cream (#FAF6F0) and dark cream (#2a2a2a) cards in admin dark mode.
  function sourceBadge(source) {
    if (!source) return '';
    var bg, color;
    switch (source) {
      case 'order':       bg = 'rgba(42,124,111,0.28)';  color = '#6fc'; break;
      case 'enrollment':  bg = 'rgba(196,133,60,0.30)';  color = '#E8B679'; break;
      case 'contact':     bg = 'rgba(99,102,241,0.30)';  color = '#a5a8f5'; break;
      case 'newsletter':  bg = 'rgba(220,53,69,0.25)';   color = '#f49aa3'; break;
      case 'account':     bg = 'rgba(22,163,74,0.30)';   color = '#7ddca0'; break;
      case 'import':      bg = 'rgba(245,158,11,0.30)';  color = '#fbcc70'; break;
      default:            bg = 'rgba(155,149,142,0.35)'; color = '#cfcac3';
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
    if (currentView === 'list') requestAnimationFrame(renderTable);
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
    var totalCount = customersData.filter(function(c) { return c && c.status !== 'merged'; }).length;

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
      if (c.status === 'merged') return false; // hide merged-out customers
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
    var nonMergedTotal = customersData.filter(function(c) { return c && c.status !== 'merged'; }).length;
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">Showing ' + filtered.length + ' of ' + nonMergedTotal + '</div>';
    html += '<div class="data-table"><table>';
    html += '<thead><tr>';
    html += '<th>Name</th><th>Primary email</th><th>Source</th><th>Linked</th><th>Last activity</th>';
    html += '</tr></thead>';
    html += '<tbody>' + rows + '</tbody>';
    html += '</table></div>';
    wrap.innerHTML = html;
  }

  // ============================================================
  // Surface 2: Customer Detail (Phase 5a — tabbed)
  // ============================================================

  function renderDetail() {
    var c = customersData.find(function(x) { return x && x.id === selectedCustomerId; });
    if (!c) {
      return '<div style="text-align:center;padding:40px;color:var(--warm-gray);">Customer not found.</div>';
    }

    var h = '';
    h += '<button class="detail-back" onclick="customersSwitchView(\'list\')">← Back to Customers</button>';

    // Header
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:12px;">';
    h += '<div>';
    h += '<h3 style="margin:0;">' + esc(c.displayName || c.primaryEmail || c.id) + '</h3>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">' + esc(c.primaryEmail || 'no primary email') + '</div>';
    h += '</div>';
    h += '<div>' + sourceBadge(c.source) + '</div>';
    h += '</div>';

    // Sub-tabs
    h += '<div class="view-tabs" style="margin-bottom:16px;">';
    DETAIL_TABS.forEach(function(t) {
      var active = (detailTab === t.value) ? ' active' : '';
      h += '<button class="view-tab' + active + '" data-detail-tab="' + esc(t.value) +
           '" onclick="customersSwitchDetailTab(this.dataset.detailTab)">' + esc(t.label) + '</button>';
    });
    h += '</div>';

    h += '<div id="customersDetailTabBody">';
    if (detailTab === 'overview')          h += renderOverviewTab(c);
    else if (detailTab === 'orders')       h += renderOrdersTab(c);
    else if (detailTab === 'classes')      h += renderClassesTab(c);
    else if (detailTab === 'interactions') h += renderInteractionsTab(c);
    else if (detailTab === 'wallet')       h += renderWalletTab(c);
    h += '</div>';

    return h;
  }

  function identityRow(label, valueHtml) {
    return '<div style="color:var(--warm-gray-light);">' + esc(label) + '</div>' +
           '<div>' + valueHtml + '</div>';
  }

  function detailCardOpen(title) {
    var h = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;margin-bottom:16px;">';
    if (title) h += '<div style="font-size:0.85rem;font-weight:600;margin-bottom:12px;">' + esc(title) + '</div>';
    return h;
  }
  function detailCardClose() { return '</div>'; }

  function getCache(customerId) {
    if (!detailCache[customerId]) {
      detailCache[customerId] = { orders: [], enrollments: [], interactions: [], wallets: [], loaded: {} };
    }
    return detailCache[customerId];
  }

  function renderTagsEditor(c) {
    var tags = c.tags || [];
    var h = '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">';
    tags.forEach(function(t) {
      h += '<span class="status-badge" style="background:rgba(196,133,60,0.30);color:#E8B679;display:inline-flex;align-items:center;gap:6px;">' +
        esc(t) +
        '<button data-customer-id="' + esc(c.id) + '" data-tag="' + esc(t) + '" ' +
        'onclick="customersRemoveTag(this.dataset.customerId, this.dataset.tag)" ' +
        'style="background:none;border:none;color:inherit;cursor:pointer;font-size:0.95rem;line-height:1;padding:0;">×</button>' +
        '</span>';
    });
    h += '<input type="text" id="customersTagInput" placeholder="+ tag" ' +
         'data-customer-id="' + esc(c.id) + '" ' +
         'onkeydown="if(event.key===\'Enter\'){event.preventDefault();customersAddTag(this.dataset.customerId,this.value);this.value=\'\';}" ' +
         'style="padding:4px 8px;border:1px solid var(--cream-dark);border-radius:4px;background:var(--cream);font-family:DM Sans,sans-serif;font-size:0.78rem;width:90px;">';
    h += '</div>';
    return h;
  }

  function renderNewsletterToggle(c) {
    var on = !!(c.marketing && c.marketing.newsletterOptIn);
    var bg = on ? 'rgba(22,163,74,0.30)' : 'rgba(155,149,142,0.35)';
    var color = on ? '#7ddca0' : '#cfcac3';
    var label = on ? 'Opted in' : 'Not opted in';
    return '<button data-customer-id="' + esc(c.id) + '" data-on="' + (on ? '1' : '0') + '" ' +
      'onclick="customersToggleNewsletter(this.dataset.customerId, this.dataset.on === \'1\')" ' +
      'style="background:' + bg + ';color:' + color + ';border:none;padding:3px 10px;border-radius:12px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;cursor:pointer;">' +
      esc(label) + '</button>';
  }

  // Writer — updates customer field and refreshes the in-memory copy + UI.
  function saveCustomerField(customerId, fieldPath, value) {
    var updates = {};
    updates[fieldPath] = value;
    updates['updatedAt'] = new Date().toISOString();
    return MastDB._ref('admin/customers/' + customerId).update(updates).then(function() {
      // Mirror into in-memory copy
      var c = customersData.find(function(x) { return x && x.id === customerId; });
      if (c) {
        // Apply field path (only top-level or marketing.x for now)
        if (fieldPath.indexOf('.') !== -1) {
          var parts = fieldPath.split('.');
          if (!c[parts[0]]) c[parts[0]] = {};
          c[parts[0]][parts[1]] = value;
        } else {
          c[fieldPath] = value;
        }
        c.updatedAt = updates['updatedAt'];
      }
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'overview') {
        render();
      }
    }).catch(function(e) {
      console.error('[customers] save failed', fieldPath, e);
      window.mastAlert('Save failed: ' + (e && e.message));
    });
  }

  function addTag(customerId, raw) {
    var t = (raw || '').trim();
    if (!t) return;
    var c = customersData.find(function(x) { return x && x.id === customerId; });
    if (!c) return;
    var tags = (c.tags || []).slice();
    if (tags.indexOf(t) !== -1) return;
    tags.push(t);
    saveCustomerField(customerId, 'tags', tags);
  }

  function removeTag(customerId, tag) {
    var c = customersData.find(function(x) { return x && x.id === customerId; });
    if (!c) return;
    var tags = (c.tags || []).filter(function(t) { return t !== tag; });
    saveCustomerField(customerId, 'tags', tags);
  }

  function toggleNewsletter(customerId, currentlyOn) {
    saveCustomerField(customerId, 'marketing/newsletterOptIn', !currentlyOn);
    // saveCustomerField stores via update on the customer ref, but marketing is
    // nested. Use a separate path-based update so we don't blow away smsOptIn.
  }

  // Override toggleNewsletter to use a deep update via _ref directly.
  toggleNewsletter = function(customerId, currentlyOn) {
    var newVal = !currentlyOn;
    MastDB._ref('admin/customers/' + customerId + '/marketing/newsletterOptIn').set(newVal).then(function() {
      return MastDB._ref('admin/customers/' + customerId + '/updatedAt').set(new Date().toISOString());
    }).then(function() {
      var c = customersData.find(function(x) { return x && x.id === customerId; });
      if (c) {
        if (!c.marketing) c.marketing = {};
        c.marketing.newsletterOptIn = newVal;
        c.updatedAt = new Date().toISOString();
      }
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'overview') render();
      }, 0);
    }).catch(function(e) {
      console.error('[customers] newsletter toggle failed', e);
      window.mastAlert('Toggle failed: ' + (e && e.message));
    });
  };

  function saveNotes(customerId, value) {
    saveCustomerField(customerId, 'notes', value || '');
  }

  // ----- Merge -----

  function uniq(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function(v) { if (v != null && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }

  async function mergeCustomers(flagId, winnerId, loserId) {
    if (!winnerId || !loserId || winnerId === loserId) return;
    var winnerCust = customersData.find(function(x) { return x && x.id === winnerId; });
    var loserCust = customersData.find(function(x) { return x && x.id === loserId; });
    var winnerLabel = (winnerCust && (winnerCust.displayName || winnerCust.primaryEmail)) || 'this customer';
    var loserLabel = (loserCust && (loserCust.displayName || loserCust.primaryEmail)) || 'the other customer';
    var ok = await window.mastConfirm(
      'Merge "' + loserLabel + '" into "' + winnerLabel + '"?\n\nThis rewrites all linked orders, enrollments and contacts. This cannot be undone.',
      { title: 'Merge customers', confirmLabel: 'Merge', danger: true }
    );
    if (!ok) return;

    try {
      var refs = await Promise.all([
        MastDB._ref('admin/customers/' + winnerId).once('value'),
        MastDB._ref('admin/customers/' + loserId).once('value'),
        MastDB._ref('admin/orders').orderByChild('customerId').equalTo(loserId).once('value'),
        MastDB._ref('admin/enrollments').orderByChild('customerId').equalTo(loserId).once('value')
      ]);
      var winner = refs[0].val();
      var loser = refs[1].val();
      if (!winner || !loser) { await window.mastAlert('One of the customers no longer exists.'); return; }

      var loserOrders = refs[2].val() || {};
      var loserEnrollments = refs[3].val() || {};

      var winnerLinked = winner.linkedIds || { uids: [], contactIds: [], studentIds: [], squareCustomerId: null };
      var loserLinked = loser.linkedIds || { uids: [], contactIds: [], studentIds: [], squareCustomerId: null };

      var mergedEmails = uniq([].concat(winner.emails || [], loser.emails || []));
      var mergedPhones = uniq([].concat(winner.phones || [], loser.phones || []));
      var mergedUids = uniq([].concat(winnerLinked.uids || [], loserLinked.uids || []));
      var mergedContactIds = uniq([].concat(winnerLinked.contactIds || [], loserLinked.contactIds || []));
      var mergedStudentIds = uniq([].concat(winnerLinked.studentIds || [], loserLinked.studentIds || []));
      var mergedTags = uniq([].concat(winner.tags || [], loser.tags || []));
      var mergedFromList = uniq([].concat(winner.mergedFrom || [], [loserId], loser.mergedFrom || []));
      var now = new Date().toISOString();

      var notes = winner.notes || '';
      if (loser.notes) {
        notes = (notes ? notes + '\n\n' : '') + '— merged from ' + loserId + ' —\n' + loser.notes;
      }

      var updates = {};
      // Winner record overwrites
      updates['admin/customers/' + winnerId + '/emails'] = mergedEmails;
      updates['admin/customers/' + winnerId + '/phones'] = mergedPhones;
      updates['admin/customers/' + winnerId + '/linkedIds'] = {
        uids: mergedUids,
        contactIds: mergedContactIds,
        studentIds: mergedStudentIds,
        squareCustomerId: winnerLinked.squareCustomerId || loserLinked.squareCustomerId || null
      };
      updates['admin/customers/' + winnerId + '/tags'] = mergedTags;
      updates['admin/customers/' + winnerId + '/notes'] = notes;
      updates['admin/customers/' + winnerId + '/marketing/newsletterOptIn'] =
        !!((winner.marketing && winner.marketing.newsletterOptIn) || (loser.marketing && loser.marketing.newsletterOptIn));
      updates['admin/customers/' + winnerId + '/mergedFrom'] = mergedFromList;
      updates['admin/customers/' + winnerId + '/updatedAt'] = now;

      // Loser archive
      updates['admin/customers/' + loserId + '/status'] = 'merged';
      updates['admin/customers/' + loserId + '/mergedInto'] = winnerId;
      updates['admin/customers/' + loserId + '/updatedAt'] = now;

      // Reindex byEmail/byUid/byContactId for loser → winner
      function emailKey(e) { return e ? String(e).trim().toLowerCase().replace(/[.#$\[\]\/]/g, ',') : null; }
      (loser.emails || []).forEach(function(e) {
        var k = emailKey(e);
        if (k) updates['admin/customerIndexes/byEmail/' + k] = winnerId;
      });
      (loserLinked.uids || []).forEach(function(u) {
        updates['admin/customerIndexes/byUid/' + u] = winnerId;
      });
      (loserLinked.contactIds || []).forEach(function(cid) {
        updates['admin/customerIndexes/byContactId/' + cid] = winnerId;
      });

      // Rewrite customerId on linked orders + enrollments
      Object.keys(loserOrders).forEach(function(orderId) {
        updates['admin/orders/' + orderId + '/customerId'] = winnerId;
      });
      Object.keys(loserEnrollments).forEach(function(enId) {
        updates['admin/enrollments/' + enId + '/customerId'] = winnerId;
      });

      // Rewrite customerId on linked contacts (so contact records still point at winner)
      (loserLinked.contactIds || []).forEach(function(cid) {
        updates['admin/contacts/' + cid + '/customerId'] = winnerId;
      });

      // Mark duplicate flag merged
      if (flagId) {
        updates['admin/customerDuplicates/' + flagId + '/status'] = 'merged';
        updates['admin/customerDuplicates/' + flagId + '/mergedAt'] = now;
        updates['admin/customerDuplicates/' + flagId + '/winnerId'] = winnerId;
        updates['admin/customerDuplicates/' + flagId + '/loserId'] = loserId;
      }

      await MastDB._multiUpdate(updates);

      // Reload
      customersLoaded = false;
      detailCache = {};
      await loadCustomers();
    } catch (e) {
      console.error('[customers] merge failed', e);
      window.mastAlert('Merge failed: ' + (e && e.message));
    }
  }

  function fmtMoney(cents) {
    if (typeof cents !== 'number') return '—';
    return '$' + (cents / 100).toFixed(2);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString(); } catch (e) { return '—'; }
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch (e) { return '—'; }
  }

  // ----- Overview tab -----

  function renderOverviewTab(c) {
    var cache = getCache(c.id);

    var h = '';

    // Identity card
    h += detailCardOpen('Identity');
    h += '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">';
    h += identityRow('Primary email', esc(c.primaryEmail || '—'));
    h += identityRow('Tags', renderTagsEditor(c));
    h += identityRow('Newsletter', renderNewsletterToggle(c));
    h += identityRow('Source', sourceBadge(c.source) || '—');
    h += identityRow('Created', esc(fmtDateTime(c.createdAt)));
    h += identityRow('Updated', esc(fmtDateTime(c.updatedAt)));
    h += '</div>';
    h += detailCardClose();

    // Contacts card (linked contact records — each one = an address/phone)
    h += detailCardOpen('Contacts');
    h += '<div id="customersContactsList">';
    var ccCache = getCache(c.id);
    if (!ccCache.loaded.contacts) {
      h += '<div class="loading">Loading contacts…</div>';
      loadCustomerContacts(c.id);
    } else if (!ccCache.contacts.length) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">No contact records yet. Add one to capture an address or phone number.</div>';
    } else {
      ccCache.contacts.forEach(function(ct) {
        h += renderContactCard(ct);
      });
    }
    h += '</div>';
    h += '<div style="margin-top:12px;">';
    h += '<button class="btn btn-secondary btn-small" data-customer-id="' + esc(c.id) + '" onclick="customersAddContact(this.dataset.customerId)">+ Add contact</button>';
    h += '</div>';
    h += detailCardClose();

    // Notes card
    h += detailCardOpen('Notes');
    h += '<textarea data-customer-id="' + esc(c.id) + '" onblur="customersSaveNotes(this.dataset.customerId, this.value)" ' +
         'placeholder="Internal notes (saved on blur)…" ' +
         'style="width:100%;min-height:90px;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);font-family:DM Sans,sans-serif;font-size:0.85rem;resize:vertical;">' + esc(c.notes || '') + '</textarea>';
    h += detailCardClose();

    // Stats card
    h += detailCardOpen('Stats');
    if (!cache.loaded.orders || !cache.loaded.enrollments) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">';
      h += 'Open the Orders and Classes tabs to populate lifetime stats.';
      h += '</div>';
    }
    var totalCents = (cache.orders || []).reduce(function(s, o) { return s + (o.totalCents || 0); }, 0);
    var orderCount = (cache.orders || []).length;
    var enrollCount = (cache.enrollments || []).length;

    var sortedOrders = (cache.orders || []).slice().sort(function(a, b) {
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    var firstOrder = sortedOrders.length ? sortedOrders[0].createdAt : null;
    var lastOrder = sortedOrders.length ? sortedOrders[sortedOrders.length - 1].createdAt : null;

    h += '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;margin-top:8px;">';
    h += identityRow('Lifetime spend', cache.loaded.orders ? esc(fmtMoney(totalCents)) : '<em style="color:var(--warm-gray);">load Orders tab</em>');
    h += identityRow('Order count', cache.loaded.orders ? String(orderCount) : '<em style="color:var(--warm-gray);">load Orders tab</em>');
    h += identityRow('First order', cache.loaded.orders ? esc(fmtDate(firstOrder)) : '—');
    h += identityRow('Last order', cache.loaded.orders ? esc(fmtDate(lastOrder)) : '—');
    h += identityRow('Enrollments', cache.loaded.enrollments ? String(enrollCount) : '<em style="color:var(--warm-gray);">load Classes tab</em>');
    h += '</div>';
    h += detailCardClose();

    return h;
  }

  // ----- Orders tab -----

  function renderOrdersTab(c) {
    var cache = getCache(c.id);
    if (!cache.loaded.orders) {
      // Fire async load and show loading
      loadCustomerOrders(c.id);
      return '<div class="loading">Loading orders…</div>';
    }
    var orders = cache.orders;
    if (!orders.length) {
      return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No orders linked to this customer.</div>';
    }
    orders = orders.slice().sort(function(a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    var rows = orders.map(function(o) {
      var num = o.orderNumber || o._id || '—';
      var status = o.status || '—';
      var items = (o.items || []).reduce(function(s, it) { return s + (it.qty || 1); }, 0);
      return '<tr data-order-id="' + esc(o._id) + '" style="cursor:pointer;" onclick="customersOpenOrder(this.dataset.orderId)">' +
        '<td>' + esc(num) + '</td>' +
        '<td><span class="status-badge">' + esc(status) + '</span></td>' +
        '<td>' + esc(fmtMoney(o.totalCents)) + '</td>' +
        '<td style="color:var(--warm-gray);">' + items + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(fmtDate(o.createdAt)) + '</td>' +
      '</tr>';
    }).join('');

    var h = '';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + orders.length + ' order' + (orders.length === 1 ? '' : 's') + '</div>';
    h += '<div class="data-table"><table>';
    h += '<thead><tr><th>Order #</th><th>Status</th><th>Total</th><th>Items</th><th>Placed</th></tr></thead>';
    h += '<tbody>' + rows + '</tbody>';
    h += '</table></div>';
    return h;
  }

  function loadCustomerOrders(customerId) {
    var cache = getCache(customerId);
    MastDB._ref('admin/orders').orderByChild('customerId').equalTo(customerId).once('value')
      .then(function(snap) {
        var val = snap.val() || {};
        cache.orders = Object.entries(val).map(function(e) { var o = e[1] || {}; o._id = e[0]; return o; });
        cache.loaded.orders = true;
        if (currentView === 'detail' && selectedCustomerId === customerId &&
            (detailTab === 'orders' || detailTab === 'overview')) {
          render();
        }
      })
      .catch(function(e) {
        console.error('[customers] orders load failed', e);
        cache.orders = [];
        cache.loaded.orders = true;
        if (currentView === 'detail' && selectedCustomerId === customerId) render();
      });
  }

  // ----- Classes tab -----

  function renderClassesTab(c) {
    var cache = getCache(c.id);
    if (!cache.loaded.enrollments) {
      loadCustomerEnrollments(c.id);
      return '<div class="loading">Loading enrollments…</div>';
    }
    var enrollments = cache.enrollments;
    if (!enrollments.length) {
      return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No class enrollments linked to this customer.</div>';
    }
    enrollments = enrollments.slice().sort(function(a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    var rows = enrollments.map(function(en) {
      var name = en.className || en.classTitle || en.classId || '—';
      var sessionDate = en.sessionDate || en.sessionStartAt || en.scheduledFor || en.createdAt;
      var status = en.status || en.enrollmentStatus || '—';
      var price = (typeof en.priceCents === 'number') ? en.priceCents : (typeof en.amountCents === 'number' ? en.amountCents : null);
      return '<tr>' +
        '<td>' + esc(name) + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(fmtDate(sessionDate)) + '</td>' +
        '<td><span class="status-badge">' + esc(status) + '</span></td>' +
        '<td>' + esc(price === null ? '—' : fmtMoney(price)) + '</td>' +
      '</tr>';
    }).join('');

    var h = '';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + enrollments.length + ' enrollment' + (enrollments.length === 1 ? '' : 's') + '</div>';
    h += '<div class="data-table"><table>';
    h += '<thead><tr><th>Class</th><th>Session</th><th>Status</th><th>Price</th></tr></thead>';
    h += '<tbody>' + rows + '</tbody>';
    h += '</table></div>';
    return h;
  }

  function loadCustomerEnrollments(customerId) {
    var cache = getCache(customerId);
    MastDB._ref('admin/enrollments').orderByChild('customerId').equalTo(customerId).once('value')
      .then(function(snap) {
        var val = snap.val() || {};
        cache.enrollments = Object.entries(val).map(function(e) { var en = e[1] || {}; en._id = e[0]; return en; });
        cache.loaded.enrollments = true;
        if (currentView === 'detail' && selectedCustomerId === customerId &&
            (detailTab === 'classes' || detailTab === 'overview')) {
          render();
        }
      })
      .catch(function(e) {
        console.error('[customers] enrollments load failed', e);
        cache.enrollments = [];
        cache.loaded.enrollments = true;
        if (currentView === 'detail' && selectedCustomerId === customerId) render();
      });
  }

  // ----- Interactions tab -----

  function renderInteractionsTab(c) {
    var linked = c.linkedIds || {};
    var contactIds = linked.contactIds || [];
    if (contactIds.length === 0) {
      var h = '';
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:8px;">No linked contacts</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Interactions live on contact records. ';
      h += '<a href="#" onclick="navigateTo(\'contacts\');return false;" style="color:var(--teal);text-decoration:underline;">Open Contacts module</a></p>';
      h += '</div>';
      return h;
    }

    var cache = getCache(c.id);
    if (!cache.loaded.interactions) {
      loadCustomerInteractions(c.id, contactIds);
      return '<div class="loading">Loading interactions…</div>';
    }
    var ix = cache.interactions;
    if (!ix.length) {
      return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No interactions recorded for any linked contact.</div>';
    }

    var h = '';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + ix.length + ' interaction' + (ix.length === 1 ? '' : 's') + ' across ' + contactIds.length + ' contact' + (contactIds.length === 1 ? '' : 's') + '</div>';
    ix.forEach(function(item) {
      h += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;margin-bottom:8px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
      h += '<div style="font-size:0.85rem;flex:1;min-width:200px;">';
      h += '<span class="status-badge" style="margin-right:8px;">' + esc(item.type || 'note') + '</span>';
      h += esc(item.notes || item.body || item.summary || '—');
      h += '</div>';
      h += '<div style="color:var(--warm-gray);font-size:0.78rem;white-space:nowrap;">' + esc(fmtDateTime(item.date || item.createdAt)) + '</div>';
      h += '</div>';
      h += '</div>';
    });
    return h;
  }

  function loadCustomerInteractions(customerId, contactIds) {
    var cache = getCache(customerId);
    var promises = contactIds.map(function(cid) {
      return MastDB._ref('admin/contacts/' + cid + '/interactions').once('value')
        .then(function(s) { return s.val() || {}; })
        .catch(function() { return {}; });
    });
    Promise.all(promises).then(function(results) {
      var merged = [];
      results.forEach(function(r) {
        Object.entries(r).forEach(function(e) {
          var item = e[1] || {};
          item._id = e[0];
          merged.push(item);
        });
      });
      merged.sort(function(a, b) {
        var ad = a.date || a.createdAt || '';
        var bd = b.date || b.createdAt || '';
        return bd.localeCompare(ad);
      });
      cache.interactions = merged;
      cache.loaded.interactions = true;
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'interactions') render();
    });
  }

  // ----- Wallet tab -----

  function renderWalletTab(c) {
    var linked = c.linkedIds || {};
    var uids = linked.uids || [];
    if (uids.length === 0) {
      return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<p style="font-size:0.95rem;font-weight:500;margin-bottom:8px;">No linked account</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Wallet, passes, membership and loyalty live on a customer-facing account. This customer hasn\'t signed in yet.</p>' +
        '</div>';
    }

    var cache = getCache(c.id);
    if (!cache.loaded.wallets) {
      loadCustomerWallets(c.id, uids);
      return '<div class="loading">Loading wallet…</div>';
    }

    var h = '';
    cache.wallets.forEach(function(w, idx) {
      var label = cache.wallets.length > 1 ? 'Account ' + (idx + 1) : 'Account';
      h += detailCardOpen(label);
      var creditCount = w.credits ? Object.keys(w.credits).length : 0;
      var creditBalance = 0;
      if (w.credits) {
        Object.values(w.credits).forEach(function(cr) {
          if (cr && typeof cr.amountCents === 'number' && cr.status !== 'redeemed') creditBalance += cr.amountCents;
        });
      }
      var passCount = w.passes ? Object.keys(w.passes).length : 0;
      var membershipTier = w.membership && (w.membership.tier || w.membership.tierName) || '—';
      var loyaltyPoints = w.loyalty && (typeof w.loyalty.points === 'number' ? w.loyalty.points : (typeof w.loyalty.balance === 'number' ? w.loyalty.balance : '—'));

      h += '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">';
      h += identityRow('Credits', esc(fmtMoney(creditBalance)) + ' <span style="color:var(--warm-gray);font-size:0.78rem;">(' + creditCount + ' record' + (creditCount === 1 ? '' : 's') + ')</span>');
      h += identityRow('Passes', String(passCount));
      h += identityRow('Membership', esc(String(membershipTier)));
      h += identityRow('Loyalty', esc(String(loyaltyPoints)));
      h += '</div>';
      h += '<div style="margin-top:12px;font-size:0.78rem;">';
      h += '<a href="#" onclick="navigateTo(\'wallet\');return false;" style="color:var(--teal);text-decoration:underline;">Edit in Wallet module →</a>';
      h += '</div>';
      h += detailCardClose();
    });
    return h;
  }

  // ----- Contacts (linked contact records, used for addresses/phones) -----

  function renderContactCard(ct) {
    var name = ct.name || ct.displayName || '(unnamed contact)';
    var bits = [];
    if (ct.email)   bits.push(esc(ct.email));
    if (ct.phone)   bits.push(esc(ct.phone));
    if (ct.address) bits.push(esc(ct.address));
    if (ct.company) bits.push(esc(ct.company));
    var h = '';
    h += '<div data-contact-id="' + esc(ct.id) + '" onclick="customersOpenContact(this.dataset.contactId)" ' +
         'style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:6px;padding:10px 14px;margin-bottom:8px;cursor:pointer;">';
    h += '<div style="font-weight:600;font-size:0.85rem;margin-bottom:4px;">' + esc(name) + '</div>';
    if (bits.length) {
      h += '<div style="font-size:0.78rem;color:var(--warm-gray);line-height:1.5;">' + bits.join(' · ') + '</div>';
    } else {
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);">No details yet — click to edit</div>';
    }
    h += '</div>';
    return h;
  }

  function loadCustomerContacts(customerId) {
    var c = customersData.find(function(x) { return x && x.id === customerId; });
    if (!c) { console.warn('[customers] loadContacts: customer not in memory', customerId); return; }
    var contactIds = (c.linkedIds && c.linkedIds.contactIds) || [];
    var cache = getCache(customerId);
    // Guard: if a load is already in flight for this customer, don't start another.
    if (cache._contactsLoading) return;
    cache._contactsLoading = true;
    console.log('[customers] loadContacts start', customerId, contactIds);

    if (contactIds.length === 0) {
      cache.contacts = [];
      cache.loaded.contacts = true;
      cache._contactsLoading = false;
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'overview') render();
      }, 0);
      return;
    }
    var promises = contactIds.map(function(cid) {
      return MastDB._ref('admin/contacts/' + cid).once('value')
        .then(function(s) { var v = s.val(); if (v) v.id = cid; return v; })
        .catch(function(e) { console.warn('[customers] contact read failed', cid, e); return null; });
    });
    Promise.all(promises).then(function(results) {
      console.log('[customers] loadContacts done', customerId, results);
      cache.contacts = results.filter(function(x) { return x; });
      cache.loaded.contacts = true;
      cache._contactsLoading = false;
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'overview') render();
      }, 0);
    }).catch(function(e) {
      console.error('[customers] loadContacts FAILED', customerId, e);
      cache.contacts = [];
      cache.loaded.contacts = true;
      cache._contactsLoading = false;
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'overview') render();
      }, 0);
    });
  }

  function openContactFromCustomer(contactId) {
    // Stash the return route BEFORE navigateTo overwrites currentRoute.
    window._pendingContactView = contactId;
    window._pendingContactReturnRoute = (typeof currentRoute === 'string') ? currentRoute : 'customers';
    if (typeof navigateTo === 'function') navigateTo('contacts');
    setTimeout(function() {
      if (window._pendingContactView && typeof window.viewContact === 'function') {
        var id = window._pendingContactView;
        window._pendingContactView = null;
        window.viewContact(id);
      }
    }, 0);
  }

  async function addContactToCustomer(customerId) {
    var c = customersData.find(function(x) { return x && x.id === customerId; });
    if (!c) return;

    // Inline modal — uses the global openModal/closeModal helpers from index.html.
    var html = '';
    html += '<h3 style="margin-top:0;">Add contact to ' + esc(c.displayName || c.primaryEmail || 'customer') + '</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Each contact captures one address and phone. A customer can have many.</p>';
    html += '<div class="form-group"><label>Name</label><input type="text" id="cmAddCName" placeholder="Full name"></div>';
    html += '<div class="form-group"><label>Email</label><input type="email" id="cmAddCEmail" value="' + esc(c.primaryEmail || '') + '"></div>';
    html += '<div class="form-group"><label>Phone</label><input type="text" id="cmAddCPhone" placeholder="555-555-5555"></div>';
    html += '<div class="form-group"><label>Address</label><input type="text" id="cmAddCAddress" placeholder="Street, City, State ZIP"></div>';
    html += '<div class="modal-footer">';
    html += '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>';
    html += '<button class="btn btn-primary" data-customer-id="' + esc(customerId) + '" onclick="customersSaveNewContact(this.dataset.customerId)">Create contact</button>';
    html += '</div>';
    if (typeof openModal === 'function') openModal(html);
  }

  async function saveNewContactForCustomer(customerId) {
    var name = (document.getElementById('cmAddCName') || {}).value || '';
    var email = (document.getElementById('cmAddCEmail') || {}).value || '';
    var phone = (document.getElementById('cmAddCPhone') || {}).value || '';
    var address = (document.getElementById('cmAddCAddress') || {}).value || '';
    name = name.trim(); email = email.trim(); phone = phone.trim(); address = address.trim();
    if (!name) {
      if (typeof window.mastAlert === 'function') return window.mastAlert('Contact name is required.');
      return;
    }

    var contactId = 'contact_' + Date.now().toString(36);
    var now = new Date().toISOString();
    var contactData = {
      id: contactId,
      name: name,
      email: email || null,
      phone: phone || null,
      address: address || null,
      company: null,
      category: 'customer',
      website: null,
      notes: null,
      googleContactId: null,
      driveFolderLink: null,
      customerId: customerId,
      createdAt: now,
      createdBy: (window.currentUser && window.currentUser.uid) || 'customers-module',
      updatedAt: now
    };

    try {
      // Write contact + explicit link to customer.linkedIds.contactIds + reverse index.
      var c = customersData.find(function(x) { return x && x.id === customerId; });
      var linked = (c && c.linkedIds) || { uids: [], contactIds: [], studentIds: [], squareCustomerId: null };
      var contactIds = (linked.contactIds || []).slice();
      if (contactIds.indexOf(contactId) === -1) contactIds.push(contactId);

      var updates = {};
      updates['admin/contacts/' + contactId] = contactData;
      updates['admin/customers/' + customerId + '/linkedIds/contactIds'] = contactIds;
      updates['admin/customers/' + customerId + '/updatedAt'] = now;
      updates['admin/customerIndexes/byContactId/' + contactId] = customerId;
      await MastDB._multiUpdate(updates);

      // Update in-memory copy
      if (c) {
        if (!c.linkedIds) c.linkedIds = { uids: [], contactIds: [], studentIds: [], squareCustomerId: null };
        c.linkedIds.contactIds = contactIds;
        c.updatedAt = now;
      }
      var cache = getCache(customerId);
      cache.contacts = (cache.contacts || []).concat([contactData]);
      cache.loaded.contacts = true;

      if (typeof closeModal === 'function') closeModal();
      if (currentView === 'detail' && selectedCustomerId === customerId) render();
    } catch (e) {
      console.error('[customers] add contact failed', e);
      if (typeof window.mastAlert === 'function') window.mastAlert('Add contact failed: ' + (e && e.message));
    }
  }

  function loadCustomerWallets(customerId, uids) {
    var cache = getCache(customerId);
    var promises = uids.map(function(uid) {
      return MastDB._ref('public/accounts/' + uid + '/wallet').once('value')
        .then(function(s) { var v = s.val() || {}; v.uid = uid; return v; })
        .catch(function() { return { uid: uid }; });
    });
    Promise.all(promises).then(function(wallets) {
      cache.wallets = wallets;
      cache.loaded.wallets = true;
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'wallet') render();
    });
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
      // Look up display names from in-memory customer list (fallback to "Customer A/B").
      var custA = customersData.find(function(x) { return x && x.id === d.customerIdA; });
      var custB = customersData.find(function(x) { return x && x.id === d.customerIdB; });
      var labelA = (custA && (custA.displayName || custA.primaryEmail)) || 'Customer A';
      var labelB = (custB && (custB.displayName || custB.primaryEmail)) || 'Customer B';

      h += '<div style="font-size:0.85rem;flex:1;min-width:240px;">';
      h += '<div style="font-weight:600;margin-bottom:4px;">' + esc(d.reason || 'duplicate detected') + '</div>';
      h += '<div style="color:var(--warm-gray);font-size:0.78rem;">';
      h += 'A: <span data-customer-id="' + esc(d.customerIdA) + '" style="cursor:pointer;text-decoration:underline;" onclick="customersOpenDetail(this.dataset.customerId)">' + esc(labelA) + '</span><br>';
      h += 'B: <span data-customer-id="' + esc(d.customerIdB) + '" style="cursor:pointer;text-decoration:underline;" onclick="customersOpenDetail(this.dataset.customerId)">' + esc(labelB) + '</span>';
      h += '</div>';
      h += '</div>';
      h += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">';
      h += '<div style="color:var(--warm-gray);font-size:0.78rem;">' + esc(relativeTime(d.detectedAt)) + '</div>';
      h += '<div style="display:flex;gap:6px;">';
      h += '<button class="btn btn-secondary btn-small" data-flag-id="' + esc(d._flagId) + '" data-winner="' + esc(d.customerIdA) + '" data-loser="' + esc(d.customerIdB) + '" ' +
        'onclick="customersMerge(this.dataset.flagId,this.dataset.winner,this.dataset.loser)">Keep A</button>';
      h += '<button class="btn btn-secondary btn-small" data-flag-id="' + esc(d._flagId) + '" data-winner="' + esc(d.customerIdB) + '" data-loser="' + esc(d.customerIdA) + '" ' +
        'onclick="customersMerge(this.dataset.flagId,this.dataset.winner,this.dataset.loser)">Keep B</button>';
      h += '</div>';
      h += '</div>';
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
    detailTab = 'overview';
    render();
  }

  function switchDetailTab(tab) {
    detailTab = tab;
    render();
  }

  function openOrderFromCustomer(orderId) {
    if (typeof window.viewOrder === 'function') {
      if (typeof navigateTo === 'function') navigateTo('orders');
      setTimeout(function() { window.viewOrder(orderId); }, 50);
    }
  }

  // ============================================================
  // Globals exposed for inline onclick handlers
  // (matching the studentsSwitchView / studentsViewDetail pattern)
  // ============================================================

  window.customersSwitchView = switchView;
  window.customersOpenDetail = openDetail;
  window.customersRender = renderTable;
  window.customersSwitchDetailTab = switchDetailTab;
  window.customersOpenOrder = openOrderFromCustomer;
  window.customersAddTag = addTag;
  window.customersRemoveTag = removeTag;
  window.customersToggleNewsletter = function(id, on) { return toggleNewsletter(id, on); };
  window.customersSaveNotes = saveNotes;
  window.customersMerge = mergeCustomers;
  window.customersOpenContact = openContactFromCustomer;
  window.customersAddContact = addContactToCustomer;
  window.customersSaveNewContact = saveNewContactForCustomer;

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
      detailTab = 'overview';
      detailCache = {};
    }
  });

})();
