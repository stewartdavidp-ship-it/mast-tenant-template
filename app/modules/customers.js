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
  var segmentsData = [];           // Phase 6.3 — saved segments from admin/customerSegments
  var currentSegmentId = null;     // active segment id (built-in or saved)
  var customersLoaded = false;
  var customersBackfillRunning = false; // Phase 6.1 — guards the backfill button
  var currentView = 'list'; // list | detail | duplicates
  var selectedCustomerId = null;
  var detailTab = 'overview'; // overview | orders | contacts | classes | interactions | wallet
  var customerEditMode = false;    // Paradigm A — read-only until user clicks Edit
  // Per-customer cache: { customerId: { orders, enrollments, interactions, wallets, loaded:{...} } }
  var detailCache = {};

  // Phase 6.3 — built-in segments (not stored). Filter object matches the
  // shape of saved segments. `_builtin` flag prevents save-over.
  var BUILTIN_SEGMENTS = [
    { id: '__all',          name: 'All customers',  filters: {}, _builtin: true },
    { id: '__new_week',     name: 'New this week',  filters: { _newThisWeek: true }, _builtin: true },
    { id: '__no_orders',    name: 'No orders yet',  filters: { _noOrders: true }, _builtin: true }
  ];

  var DETAIL_TABS = [
    { value: 'overview',     label: 'Overview' },
    { value: 'orders',       label: 'Orders' },
    { value: 'contacts',     label: 'Contacts' },
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
    { value: 'updatedAt',  label: 'Recently updated' },
    { value: 'createdAt',  label: 'Newest' },
    { value: 'name',       label: 'Name (A–Z)' },
    { value: 'email',      label: 'Email (A–Z)' },
    { value: 'spend',      label: 'Lifetime spend (high → low)' },
    { value: 'lastOrder',  label: 'Last order (recent → old)' }
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
  // light cream (var(--cream)) and dark cream (#2a2a2a) cards in admin dark mode.
  function sourceBadge(source) {
    if (!source) return '';
    var bg, color;
    switch (source) {
      case 'order':       bg = 'rgba(42,124,111,0.28)';  color = '#6fc'; break;
      case 'enrollment':  bg = 'rgba(196,133,60,0.30)';  color = 'var(--amber-light)'; break;
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
        MastDB.query('admin/customers').orderByChild('updatedAt').limitToLast(500).once('value'),
        MastDB.query('admin/customerDuplicates').orderByChild('detectedAt').limitToLast(50).once('value'),
        MastDB.get('admin/customerSegments').catch(function() { return { val: function() { return null; } }; })
      ]);
      var cVal = results[0].val() || {};
      customersData = Object.values(cVal);

      var dVal = results[1].val() || {};
      duplicatesData = Object.entries(dVal)
        .map(function(entry) { var v = entry[1]; v._flagId = entry[0]; return v; })
        .filter(function(d) { return d.status !== 'merged'; });

      var sVal = (results[2] && results[2].val && results[2].val()) || {};
      segmentsData = Object.entries(sVal).map(function(e) {
        var v = e[1] || {}; v.id = e[0]; return v;
      });

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

  // ------------------------------------------------------------
  // State-preserving render
  // ------------------------------------------------------------
  // Every field save in the customer module triggers a re-render of the
  // overview tab, which blows away unsaved input in siblings (notes,
  // tag input, identity fields, contact editor fields). snapshotFormState
  // captures in-flight values + focus + selection range so restore can put
  // them back after the innerHTML replace.

  function snapshotFormState() {
    var tab = document.getElementById('customersTab');
    if (!tab) return null;
    var active = document.activeElement;
    var snap = {
      fields: {},
      focusId: (active && tab.contains(active)) ? active.id : null,
      focusSelStart: null,
      focusSelEnd: null
    };
    if (snap.focusId && active && typeof active.selectionStart === 'number') {
      snap.focusSelStart = active.selectionStart;
      snap.focusSelEnd = active.selectionEnd;
    }
    // Capture any element with id starting "cust" or known editable markers
    tab.querySelectorAll('input, textarea, select').forEach(function(el) {
      if (!el.id) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        snap.fields[el.id] = { type: 'check', checked: el.checked };
      } else {
        snap.fields[el.id] = { type: 'val', value: el.value };
      }
    });
    return snap;
  }

  function restoreFormState(snap) {
    if (!snap) return;
    var tab = document.getElementById('customersTab');
    if (!tab) return;
    Object.keys(snap.fields).forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var s = snap.fields[id];
      if (s.type === 'check') el.checked = s.checked;
      else el.value = s.value;
    });
    if (snap.focusId) {
      var el = document.getElementById(snap.focusId);
      if (el) {
        try {
          el.focus();
          if (snap.focusSelStart !== null && typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(snap.focusSelStart, snap.focusSelEnd);
          }
        } catch (e) { /* focus may fail on detached elements */ }
      }
    }
  }

  // Public helper: any caller that would have called render() should call
  // this instead so in-flight edits survive.
  function renderPreservingEdits() {
    var snap = snapshotFormState();
    render();
    restoreFormState(snap);
  }

  // Non-blocking feedback — reuse the global showToast helper from index.html.
  function toast(msg, isErr) {
    if (typeof window.showToast === 'function') window.showToast(msg, !!isErr);
  }

  // ============================================================
  // Surface 1: Customers List
  // ============================================================

  // Phase 6.3 — gather every distinct tag in current customer set for the
  // tag filter dropdown.
  function allKnownTags() {
    var seen = {};
    customersData.forEach(function(c) {
      if (!c || !c.tags) return;
      c.tags.forEach(function(t) { if (t) seen[t] = 1; });
    });
    return Object.keys(seen).sort();
  }

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
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    h += '<button class="btn btn-secondary btn-small" onclick="customersExportCsv()" title="Download current view as CSV">⤓ Export CSV</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="customersBackfillStats()" title="Recompute cached stats for all customers">↻ Recompute stats</button>';
    h += '</div>';
    h += '</div>';

    if (totalCount === 0) {
      h += renderEmptyState();
      return h;
    }

    // ----- Segments dropdown row -----
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">';
    h += '<label style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;">Segment:</label>';
    h += '<select id="customersSegmentSelect" onchange="customersApplySegment(this.value)" ' +
         'style="padding:7px 10px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:DM Sans,sans-serif;font-size:0.85rem;min-width:180px;">';
    BUILTIN_SEGMENTS.forEach(function(s) {
      var sel = (currentSegmentId === s.id || (!currentSegmentId && s.id === '__all')) ? ' selected' : '';
      h += '<option value="' + esc(s.id) + '"' + sel + '>' + esc(s.name) + '</option>';
    });
    if (segmentsData.length > 0) {
      h += '<option disabled>──────────</option>';
      segmentsData.forEach(function(s) {
        var sel = (currentSegmentId === s.id) ? ' selected' : '';
        h += '<option value="' + esc(s.id) + '"' + sel + '>' + esc(s.name) + '</option>';
      });
    }
    h += '</select>';
    h += '<button class="btn btn-secondary btn-small" onclick="customersSaveSegment()" title="Save current filters as a segment">+ Save as segment</button>';
    if (segmentsData.length > 0) {
      h += '<button class="btn btn-secondary btn-small" onclick="customersManageSegments()">Manage</button>';
    }
    h += '</div>';

    // ----- Filter bar -----
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">';
    h += '<input type="text" id="customersSearch" placeholder="Search by name or email…" oninput="customersRender()" ' +
         'style="flex:1;min-width:220px;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:DM Sans,sans-serif;font-size:0.9rem;">';

    h += '<select id="customersSourceFilter" onchange="customersRender()" ' +
         'style="padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:DM Sans,sans-serif;font-size:0.9rem;">';
    SOURCE_OPTIONS.forEach(function(opt) {
      h += '<option value="' + esc(opt.value) + '">' + esc(opt.label) + '</option>';
    });
    h += '</select>';

    var tags = allKnownTags();
    h += '<select id="customersTagFilter" onchange="customersRender()" ' +
         'style="padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:DM Sans,sans-serif;font-size:0.9rem;">';
    h += '<option value="">All tags</option>';
    tags.forEach(function(t) {
      h += '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    });
    h += '</select>';

    h += '<input type="date" id="customersLastOrderBefore" onchange="customersRender()" title="Last order before…" ' +
         'style="padding:8px 10px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:DM Sans,sans-serif;font-size:0.85rem;">';

    h += '<input type="number" id="customersMinSpend" min="0" step="1" placeholder="Min spend $" onchange="customersRender()" oninput="customersRender()" ' +
         'style="width:120px;padding:8px 10px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:DM Sans,sans-serif;font-size:0.85rem;">';

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

  // Phase 6.1/6.2/6.3 — collect the active filter object from DOM controls.
  // Returns { search, source, tag, lastOrderBefore, minSpendCents, sortBy, builtinFlags }.
  function readActiveFilters() {
    return {
      search:           ((document.getElementById('customersSearch')           || {}).value || '').trim().toLowerCase(),
      source:           (document.getElementById('customersSourceFilter')      || {}).value || 'all',
      tag:              (document.getElementById('customersTagFilter')         || {}).value || '',
      lastOrderBefore:  (document.getElementById('customersLastOrderBefore')   || {}).value || '',
      minSpendDollars:  (document.getElementById('customersMinSpend')          || {}).value || '',
      sortBy:           (document.getElementById('customersSortBy')            || {}).value || 'updatedAt'
    };
  }

  // Phase 6.1 — apply filter object to a customer record. Centralised so the
  // list table, CSV export and segments all share the same logic.
  function customerMatchesFilters(c, f) {
    if (!c) return false;
    if (c.status === 'merged') return false;

    if (f.source && f.source !== 'all' && c.source !== f.source) return false;

    if (f.tag) {
      var tags = c.tags || [];
      if (tags.indexOf(f.tag) === -1) return false;
    }

    if (f.search) {
      var name = (c.displayName || '').toLowerCase();
      var email = (c.primaryEmail || '').toLowerCase();
      var emails = (c.emails || []).join(' ').toLowerCase();
      if (name.indexOf(f.search) === -1 && email.indexOf(f.search) === -1 && emails.indexOf(f.search) === -1) {
        return false;
      }
    }

    var stats = c.stats || {};

    if (f.lastOrderBefore) {
      // Inclusive of the chosen date — anything strictly after is excluded.
      var cutoff = f.lastOrderBefore + 'T23:59:59';
      if (!stats.lastOrderAt || stats.lastOrderAt > cutoff) return false;
    }

    if (f.minSpendDollars !== '' && f.minSpendDollars != null) {
      var minCents = Math.round(parseFloat(f.minSpendDollars) * 100);
      if (!isNaN(minCents) && (stats.lifetimeSpendCents || 0) < minCents) return false;
    }

    // Built-in segment flags
    if (f._newThisWeek) {
      var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      if (!c.createdAt || c.createdAt < weekAgo) return false;
    }
    if (f._noOrders) {
      if ((stats.orderCount || 0) > 0) return false;
    }

    return true;
  }

  function renderEmptyState() {
    var h = '';
    h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
    h += '<div style="font-size:1.6rem;margin-bottom:12px;">👥</div>';
    h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No customers yet</p>';
    h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">They\'ll appear here automatically as orders, enrollments, contacts, and newsletter signups come in.</p>';
    h += '</div>';
    return h;
  }

  // Phase 6.1 — apply current segment + filters to the customer set.
  // Returns the filtered, sorted array. Shared by renderTable and CSV export.
  function getFilteredCustomers() {
    var f = readActiveFilters();

    // Mix in built-in segment flags from the active segment.
    var seg = findSegmentById(currentSegmentId);
    if (seg && seg.filters) {
      if (seg.filters._newThisWeek) f._newThisWeek = true;
      if (seg.filters._noOrders)    f._noOrders = true;
    }

    var filtered = customersData.filter(function(c) {
      return customerMatchesFilters(c, f);
    });

    var sortBy = f.sortBy;
    filtered.sort(function(a, b) {
      var sa = a.stats || {};
      var sb = b.stats || {};
      if (sortBy === 'name')      return (a.displayName || '').localeCompare(b.displayName || '');
      if (sortBy === 'email')     return (a.primaryEmail || '').localeCompare(b.primaryEmail || '');
      if (sortBy === 'spend')     return (sb.lifetimeSpendCents || 0) - (sa.lifetimeSpendCents || 0);
      if (sortBy === 'lastOrder') return (sb.lastOrderAt || '').localeCompare(sa.lastOrderAt || '');
      // createdAt / updatedAt — newest first
      var av = a[sortBy] || '';
      var bv = b[sortBy] || '';
      return bv.localeCompare(av);
    });

    return filtered;
  }

  // Re-rendered on every search/filter/sort change without re-fetching.
  function renderTable() {
    var wrap = document.getElementById('customersTableWrap');
    if (!wrap) return;

    var filtered = getFilteredCustomers();

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

      var stats = c.stats || {};
      var spendCell = (typeof stats.lifetimeSpendCents === 'number')
        ? esc(fmtMoney(stats.lifetimeSpendCents))
        : '<span style="color:var(--warm-gray-light);">—</span>';
      var lastOrderCell = stats.lastOrderAt
        ? esc(relativeTime(stats.lastOrderAt))
        : '<span style="color:var(--warm-gray-light);">—</span>';

      return '<tr data-customer-id="' + esc(c.id) + '" style="cursor:pointer;" onclick="customersOpenDetail(this.dataset.customerId)">' +
        '<td>' + nameDisplay + '</td>' +
        '<td style="color:var(--warm-gray);">' + emailDisplay + '</td>' +
        '<td>' + sourceBadge(c.source) + '</td>' +
        '<td>' + spendCell + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + lastOrderCell + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(linkedText) + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(relativeTime(c.updatedAt || c.createdAt)) + '</td>' +
      '</tr>';
    }).join('');

    var html = '';
    var nonMergedTotal = customersData.filter(function(c) { return c && c.status !== 'merged'; }).length;
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">Showing ' + filtered.length + ' of ' + nonMergedTotal + '</div>';
    html += '<div class="data-table"><table>';
    html += '<thead><tr>';
    html += '<th>Name</th><th>Primary email</th><th>Source</th><th>Spend</th><th>Last order</th><th>Linked</th><th>Last activity</th>';
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
    var backLabel = (window.MastNavStack && MastNavStack.label()) ? ('← Back to ' + MastNavStack.label()) : '← Back to Customers';
    h += '<button class="detail-back" onclick="customersBackFromDetail()">' + esc(backLabel) + '</button>';

    // Header — Paradigm A: Edit button right side (read mode only); Source badge inline
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:12px;">';
    h += '<div>';
    h += '<h3 style="margin:0;">' + esc(c.displayName || c.primaryEmail || c.id) + '</h3>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">' + esc(c.primaryEmail || 'no primary email') + '</div>';
    h += '</div>';
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += sourceBadge(c.source) || '';
    if (!customerEditMode) {
      h += '<button class="btn btn-secondary btn-small" onclick="customersEnterEdit()">Edit</button>';
    } else {
      h += '<span style="font-size:0.72rem;color:var(--amber);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Editing</span>';
    }
    h += '</div>';
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
    else if (detailTab === 'contacts')     h += renderContactsTab(c);
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
      h += '<span class="status-badge" style="background:rgba(196,133,60,0.30);color:var(--amber-light);display:inline-flex;align-items:center;gap:6px;">' +
        esc(t) +
        '<button data-customer-id="' + esc(c.id) + '" data-tag="' + esc(t) + '" ' +
        'onclick="customersRemoveTag(this.dataset.customerId, this.dataset.tag)" ' +
        'style="background:none;border:none;color:inherit;cursor:pointer;font-size:0.9rem;line-height:1;padding:0;">×</button>' +
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
    return MastDB.update('admin/customers/' + customerId, updates).then(function() {
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
        renderPreservingEdits();
      }
      toast('Saved');
    }).catch(function(e) {
      console.error('[customers] save failed', fieldPath, e);
      toast('Save failed: ' + (e && e.message), true);
    });
  }

  // ------------------------------------------------------------
  // Paradigm A — customer edit mode lifecycle
  // ------------------------------------------------------------

  // MastDirty integration — baseline of identity inputs only.
  // Notes/tags/newsletter/archive are atomic widgets, excluded by design.
  var _custEditBaseline = null;
  function _custEditCaptureBaseline() {
    setTimeout(function() {
      var nameInput = document.getElementById('custIdentityDisplayName');
      var emailInput = document.getElementById('custIdentityPrimaryEmail');
      _custEditBaseline = {
        name: nameInput ? nameInput.value : '',
        email: emailInput ? emailInput.value : ''
      };
      _custEditUpdateDirtyIndicator();
    }, 0);
  }
  function _custEditIsDirty() {
    if (!customerEditMode) return false;
    var nameInput = document.getElementById('custIdentityDisplayName');
    var emailInput = document.getElementById('custIdentityPrimaryEmail');
    if (!nameInput || !emailInput || !_custEditBaseline) return false;
    return nameInput.value !== _custEditBaseline.name || emailInput.value !== _custEditBaseline.email;
  }
  function _custEditUpdateDirtyIndicator() {
    var btn = document.querySelector('#customersTab button.btn-primary[onclick*="customersSaveEdit"]');
    if (!btn) return;
    if (_custEditIsDirty()) btn.classList.add('dirty');
    else btn.classList.remove('dirty');
  }

  function enterCustomerEditMode() {
    customerEditMode = true;
    renderPreservingEdits();
    if (window.MastDirty) {
      MastDirty.register('customerEdit', _custEditIsDirty, { label: 'Customer detail' });
    }
    _custEditCaptureBaseline();
  }

  function cancelCustomerEditMode() {
    var doCancel = function() {
      customerEditMode = false;
      _custEditBaseline = null;
      if (window.MastDirty) MastDirty.unregister('customerEdit');
      // Discard any in-flight changes by NOT preserving — straight render
      // pulls fresh values from in-memory customersData.
      render();
    };
    if (window.MastDirty && MastDirty.getDirtyKeys().indexOf('customerEdit') !== -1) {
      MastDirty.checkAndExit(doCancel);
    } else {
      doCancel();
    }
  }

  // Save commits any changed identity fields, stays in edit mode (matches
  // the product flow Paradigm A pattern), and shows a toast.
  function saveCustomerEditMode() {
    if (!selectedCustomerId) return;
    var c = customersData.find(function(x) { return x && x.id === selectedCustomerId; });
    if (!c) return;

    var nameInput = document.getElementById('custIdentityDisplayName');
    var emailInput = document.getElementById('custIdentityPrimaryEmail');
    if (!nameInput && !emailInput) {
      // Nothing to save (probably not on overview tab)
      toast('Saved');
      return;
    }

    var newName = nameInput ? (nameInput.value || '').trim() : (c.displayName || '');
    var newEmail = emailInput ? (emailInput.value || '').trim() : (c.primaryEmail || '');
    var oldName = c.displayName || '';
    var oldEmail = c.primaryEmail || '';

    var updates = {};
    if (newName !== oldName) updates.displayName = newName || null;
    if (newEmail !== oldEmail) updates.primaryEmail = newEmail || null;

    if (Object.keys(updates).length === 0) {
      // No changes — just confirm and stay in edit mode
      toast('No changes to save');
      return;
    }

    updates.updatedAt = new Date().toISOString();
    MastDB.update('admin/customers/' + selectedCustomerId, updates).then(function() {
      // Mirror into in-memory copy
      Object.keys(updates).forEach(function(k) {
        c[k] = updates[k];
      });
      // Live-update the header h3 since the name may have changed
      var h3 = document.querySelector('#customersTab h3');
      if (h3) h3.innerText = c.displayName || c.primaryEmail || c.id;
      toast('Saved');
      // Stay in edit mode — Paradigm A. Retake baseline so dirty clears.
      renderPreservingEdits();
      _custEditCaptureBaseline();
    }).catch(function(e) {
      console.error('[customers] save edit failed', e);
      toast('Save failed: ' + (e && e.message), true);
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
    MastDB.set('admin/customers/' + customerId + '/marketing/newsletterOptIn', newVal).then(function() {
      return MastDB.set('admin/customers/' + customerId + '/updatedAt', new Date().toISOString());
    }).then(function() {
      var c = customersData.find(function(x) { return x && x.id === customerId; });
      if (c) {
        if (!c.marketing) c.marketing = {};
        c.marketing.newsletterOptIn = newVal;
        c.updatedAt = new Date().toISOString();
      }
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'overview') renderPreservingEdits();
      }, 0);
      toast(newVal ? 'Opted in to newsletter' : 'Opted out of newsletter');
    }).catch(function(e) {
      console.error('[customers] newsletter toggle failed', e);
      toast('Toggle failed: ' + (e && e.message), true);
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
        MastDB.get('admin/customers/' + winnerId),
        MastDB.get('admin/customers/' + loserId),
        MastDB.query('orders').orderByChild('customerId').equalTo(loserId).once('value'),
        MastDB.query('admin/enrollments').orderByChild('customerId').equalTo(loserId).once('value')
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
        updates['orders/' + orderId + '/customerId'] = winnerId;
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

      await MastDB.multiUpdate(updates);

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

    // Identity card — Paradigm A: plain text in read mode, inputs in edit mode.
    // Tags and Newsletter are atomic widgets and stay live regardless of edit mode.
    var inlineInputStyle = 'width:100%;padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;background:var(--cream);font-family:DM Sans,sans-serif;font-size:0.85rem;';
    var nameField, emailField;
    if (customerEditMode) {
      nameField = '<input type="text" id="custIdentityDisplayName" data-customer-id="' + esc(c.id) + '" ' +
        'value="' + esc(c.displayName || '') + '" placeholder="(no name)" ' +
        'oninput="customersLiveUpdateHeader(this.value)" ' +
        'style="' + inlineInputStyle + '">';
      emailField = '<input type="text" id="custIdentityPrimaryEmail" data-customer-id="' + esc(c.id) + '" ' +
        'value="' + esc(c.primaryEmail || '') + '" placeholder="no primary email" ' +
        'autocomplete="off" ' +
        'style="' + inlineInputStyle + '">';
    } else {
      nameField = esc(c.displayName || '—');
      emailField = esc(c.primaryEmail || '—');
    }
    h += detailCardOpen('Identity');
    h += '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">';
    h += identityRow('Name', nameField);
    h += identityRow('Primary email', emailField);
    h += identityRow('Tags', renderTagsEditor(c));
    h += identityRow('Newsletter', renderNewsletterToggle(c));
    h += identityRow('Source', sourceBadge(c.source) || '—');
    h += identityRow('Created', esc(fmtDateTime(c.createdAt)));
    h += identityRow('Updated', esc(fmtDateTime(c.updatedAt)));
    h += '</div>';
    h += detailCardClose();

    // Notes card
    h += detailCardOpen('Notes');
    h += '<textarea id="custNotesTextarea" data-customer-id="' + esc(c.id) + '" onblur="customersSaveNotes(this.dataset.customerId, this.value)" ' +
         'placeholder="Internal notes (saved on blur)…" ' +
         'style="width:100%;min-height:90px;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);font-family:DM Sans,sans-serif;font-size:0.85rem;resize:vertical;">' + esc(c.notes || '') + '</textarea>';
    h += detailCardClose();

    // Stats card — Phase 6.1 reads from c.stats (maintained by Cloud Function
    // triggers). Falls back to per-tab cache when stats haven't been computed
    // yet, which is "—" for an empty customer. The "load Orders tab" copy is
    // gone — stats are always available without opening tabs.
    h += detailCardOpen('Stats');
    var stats = c.stats || null;
    var hasStats = !!(stats && (typeof stats.lifetimeSpendCents === 'number' || stats.statsUpdatedAt));
    var spendStr   = hasStats ? fmtMoney(stats.lifetimeSpendCents || 0) : '—';
    var ordCntStr  = hasStats ? String(stats.orderCount || 0) : '—';
    var firstStr   = hasStats ? fmtDate(stats.firstOrderAt) : '—';
    var lastStr    = hasStats ? fmtDate(stats.lastOrderAt) : '—';
    var enrCntStr  = hasStats ? String(stats.enrollmentCount || 0) : '—';
    var lastEnrStr = hasStats ? fmtDate(stats.lastEnrollmentAt) : '—';

    h += '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;margin-top:4px;">';
    h += identityRow('Lifetime spend',  esc(spendStr));
    h += identityRow('Order count',     esc(ordCntStr));
    h += identityRow('First order',     esc(firstStr));
    h += identityRow('Last order',      esc(lastStr));
    h += identityRow('Enrollments',     esc(enrCntStr));
    h += identityRow('Last enrollment', esc(lastEnrStr));
    h += '</div>';
    if (!hasStats) {
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:10px;">';
      h += 'Cached stats not yet computed. They populate automatically on the next order or enrollment write — or run "Recompute stats" from the customers list.';
      h += '</div>';
    } else if (stats.statsUpdatedAt) {
      h += '<div style="font-size:0.72rem;color:var(--warm-gray-light);margin-top:10px;">';
      h += 'Updated ' + esc(relativeTime(stats.statsUpdatedAt));
      h += '</div>';
    }
    h += detailCardClose();

    // Save / Cancel buttons — Paradigm A, only when editing
    if (customerEditMode) {
      h += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--cream-dark);">';
      h += '<button class="btn btn-secondary" onclick="customersCancelEdit()">Cancel</button>';
      h += '<button class="btn btn-primary" onclick="customersSaveEdit()">Save</button>';
      h += '</div>';
    }

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

    var contactsById = cache.orderContacts || {};

    var rows = orders.map(function(o) {
      var num = o.orderNumber || o._id || '—';
      var status = o.status || '—';
      var items = (o.items || []).reduce(function(s, it) { return s + (it.qty || 1); }, 0);

      // Ship to cell — drill-through to contact module if contactId present.
      var shipCell;
      if (o.contactId && contactsById[o.contactId]) {
        var ct = contactsById[o.contactId];
        var shipName = ct.name || '';
        var shipAddr = ct.address || '';
        var displayName = (shipName && shipName !== c.displayName) ? shipName : '';
        var shipText = displayName ? (displayName + ' · ' + shipAddr) : shipAddr;
        shipCell = '<td style="color:var(--warm-gray);font-size:0.78rem;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;" ' +
          'data-contact-id="' + esc(o.contactId) + '" ' +
          'onclick="event.stopPropagation();customersOpenContact(this.dataset.contactId);">' +
          esc(shipText || '—') + '</td>';
      } else {
        shipCell = '<td style="color:var(--warm-gray);">—</td>';
      }

      return '<tr data-order-id="' + esc(o._id) + '" style="cursor:pointer;" onclick="customersOpenOrder(this.dataset.orderId)">' +
        '<td>' + esc(num) + '</td>' +
        '<td><span class="status-badge">' + esc(status) + '</span></td>' +
        '<td>' + esc(fmtMoney(o.totalCents)) + '</td>' +
        '<td style="color:var(--warm-gray);">' + items + '</td>' +
        shipCell +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(fmtDate(o.createdAt)) + '</td>' +
      '</tr>';
    }).join('');

    var h = '';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + orders.length + ' order' + (orders.length === 1 ? '' : 's') + '</div>';
    h += '<div class="data-table"><table>';
    h += '<thead><tr><th>Order #</th><th>Status</th><th>Total</th><th>Items</th><th>Ship to</th><th>Placed</th></tr></thead>';
    h += '<tbody>' + rows + '</tbody>';
    h += '</table></div>';
    return h;
  }

  function loadCustomerOrders(customerId) {
    var cache = getCache(customerId);
    MastDB.query('orders').orderByChild('customerId').equalTo(customerId).once('value')
      .then(function(snap) {
        var val = snap.val() || {};
        cache.orders = Object.entries(val).map(function(e) { var o = e[1] || {}; o._id = e[0]; return o; });
        cache.loaded.orders = true;

        // Load any linked shipping contacts in parallel.
        var contactIds = cache.orders
          .map(function(o) { return o.contactId; })
          .filter(function(id, i, arr) { return id && arr.indexOf(id) === i; });
        if (contactIds.length === 0) {
          cache.orderContacts = {};
          if (currentView === 'detail' && selectedCustomerId === customerId &&
              (detailTab === 'orders' || detailTab === 'overview')) {
            renderPreservingEdits();
          }
          return;
        }
        Promise.all(contactIds.map(function(cid) {
          return MastDB.get('admin/contacts/' + cid)
            .then(function(s) { return { id: cid, val: s.val() }; })
            .catch(function() { return { id: cid, val: null }; });
        })).then(function(results) {
          var byId = {};
          results.forEach(function(r) { if (r.val) byId[r.id] = r.val; });
          cache.orderContacts = byId;
          if (currentView === 'detail' && selectedCustomerId === customerId &&
              (detailTab === 'orders' || detailTab === 'overview')) {
            renderPreservingEdits();
          }
        });
      })
      .catch(function(e) {
        console.error('[customers] orders load failed', e);
        cache.orders = [];
        cache.orderContacts = {};
        cache.loaded.orders = true;
        if (currentView === 'detail' && selectedCustomerId === customerId) renderPreservingEdits();
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
    var c = customersData.find(function(x) { return x.id === customerId; }) || {};
    var email = (c.primaryEmail || '').toLowerCase().trim();

    // Enrollments may be keyed by customerId OR by studentEmail/customerEmail —
    // query both and merge to handle older records created before customerId was stored.
    var queries = [
      MastDB.query('admin/enrollments').orderByChild('customerId').equalTo(customerId).once('value')
    ];
    if (email) {
      queries.push(
        MastDB.query('admin/enrollments').orderByChild('customerEmail').equalTo(email).once('value')
      );
    }

    Promise.all(queries)
      .then(function(snaps) {
        var seen = {};
        var enrollments = [];
        snaps.forEach(function(snap) {
          var val = (snap && typeof snap.val === 'function') ? (snap.val() || {}) : (snap || {});
          Object.entries(val).forEach(function(e) {
            if (!seen[e[0]]) {
              seen[e[0]] = true;
              var en = e[1] || {};
              en._id = e[0];
              enrollments.push(en);
            }
          });
        });
        cache.enrollments = enrollments;
        cache.loaded.enrollments = true;
        if (currentView === 'detail' && selectedCustomerId === customerId &&
            (detailTab === 'classes' || detailTab === 'overview')) {
          renderPreservingEdits();
        }
      })
      .catch(function(e) {
        console.error('[customers] enrollments load failed', e);
        cache.enrollments = [];
        cache.loaded.enrollments = true;
        if (currentView === 'detail' && selectedCustomerId === customerId) renderPreservingEdits();
      });
  }

  // ----- Interactions tab -----

  function renderInteractionsTab(c) {
    var linked = c.linkedIds || {};
    var contactIds = linked.contactIds || [];
    if (contactIds.length === 0) {
      var h = '';
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:8px;">No linked contacts</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Interactions are manually logged touchpoints (calls, emails, meetings, notes) tracked per contact. ';
      h += 'This customer has no linked contact records yet. ';
      h += '<a href="#" onclick="navigateTo(\'contacts\');return false;" style="color:var(--teal);text-decoration:underline;">Open Contacts</a> to log interactions.</p>';
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
      return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:8px;">No interactions recorded</p>' +
        '<p style="font-size:0.85rem;">Interactions are manually logged touchpoints (calls, emails, notes). ' +
        'Log them from the <a href="#" onclick="navigateTo(\'contacts\');return false;" style="color:var(--teal);text-decoration:underline;">Contacts module</a>.</p>' +
        '</div>';
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
      return MastDB.get('admin/contacts/' + cid + '/interactions')
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
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'interactions') renderPreservingEdits();
    });
  }

  // ----- Wallet tab -----

  function renderWalletTab(c) {
    var linked = c.linkedIds || {};
    var uids = linked.uids || [];
    if (uids.length === 0) {
      return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:8px;">No linked account</p>' +
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

  // ----- Contacts tab (linked contact records — addresses/phones) -----
  //
  // Paradigm A drill-through: list-only on the customer. All edits happen
  // in the contacts module (via customersOpenContact → openContactFromCustomer
  // → MastNavStack push → contacts.viewContact). Creation also routes through
  // the contacts module via customersAddContact (see addContactToCustomer).

  function renderContactsTab(c) {
    var cache = getCache(c.id);
    if (!cache.loaded.contacts) {
      loadCustomerContacts(c.id);
      return '<div class="loading">Loading contacts…</div>';
    }
    // Orders cache is used to compute # Orders + Last Order per contact.
    // Trigger the load in the background if not yet present — the columns
    // will show "—" until it resolves, then a re-render fills them in.
    if (!cache.loaded.orders) loadCustomerOrders(c.id);

    var contacts = cache.contacts || [];
    var h = '';

    if (!contacts.length) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No contacts linked to this customer yet.</div>';
    } else {
      // Pre-compute per-contact order aggregates from cache.orders (if loaded).
      var ordersByContact = {};
      if (cache.loaded.orders && Array.isArray(cache.orders)) {
        cache.orders.forEach(function(o) {
          if (!o.contactId) return;
          var bucket = ordersByContact[o.contactId] || (ordersByContact[o.contactId] = { count: 0, last: null });
          bucket.count += 1;
          if (!bucket.last || (o.createdAt || '') > bucket.last) bucket.last = o.createdAt || null;
        });
      }

      var rows = contacts.map(function(ct) {
        var name = ct.name || ct.displayName || '(unnamed contact)';
        var email = ct.email || '—';
        var phone = ct.phone || '—';
        var address = ct.address || '—';
        var agg = ordersByContact[ct.id];
        var ordCountCell, lastOrderCell;
        if (cache.loaded.orders) {
          ordCountCell = agg ? String(agg.count) : '0';
          lastOrderCell = (agg && agg.last) ? fmtDate(agg.last) : '—';
        } else {
          ordCountCell = '—';
          lastOrderCell = '—';
        }
        return '<tr data-contact-id="' + esc(ct.id) + '" style="cursor:pointer;" onclick="customersOpenContact(this.dataset.contactId)">' +
          '<td style="font-weight:500;">' + esc(name) + '</td>' +
          '<td style="color:var(--warm-gray);">' + esc(email) + '</td>' +
          '<td style="color:var(--warm-gray);">' + esc(phone) + '</td>' +
          '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(address) + '</td>' +
          '<td style="text-align:right;color:var(--warm-gray);">' + esc(ordCountCell) + '</td>' +
          '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(lastOrderCell) + '</td>' +
        '</tr>';
      }).join('');

      h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + contacts.length + ' contact' + (contacts.length === 1 ? '' : 's') + '</div>';
      h += '<div class="data-table"><table>';
      h += '<thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th style="text-align:right;"># Orders</th><th>Last Order</th></tr></thead>';
      h += '<tbody>' + rows + '</tbody>';
      h += '</table></div>';
    }

    h += '<div style="margin-top:16px;">';
    h += '<button class="btn btn-secondary btn-small" data-customer-id="' + esc(c.id) + '" onclick="customersAddContact(this.dataset.customerId)">+ Add contact</button>';
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
        if (currentView === 'detail' && selectedCustomerId === customerId && (detailTab === 'contacts' || detailTab === 'overview')) renderPreservingEdits();
      }, 0);
      return;
    }
    var promises = contactIds.map(function(cid) {
      return MastDB.get('admin/contacts/' + cid)
        .then(function(s) { var v = s.val(); if (v) v.id = cid; return v; })
        .catch(function(e) { console.warn('[customers] contact read failed', cid, e); return null; });
    });
    Promise.all(promises).then(function(results) {
      console.log('[customers] loadContacts done', customerId, results);
      cache.contacts = results.filter(function(x) { return x; });
      cache.loaded.contacts = true;
      cache._contactsLoading = false;
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && (detailTab === 'contacts' || detailTab === 'overview')) renderPreservingEdits();
      }, 0);
    }).catch(function(e) {
      console.error('[customers] loadContacts FAILED', customerId, e);
      cache.contacts = [];
      cache.loaded.contacts = true;
      cache._contactsLoading = false;
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && (detailTab === 'contacts' || detailTab === 'overview')) renderPreservingEdits();
      }, 0);
    });
  }

  function openContactFromCustomer(contactId) {
    var c = selectedCustomerId
      ? customersData.find(function(x) { return x && x.id === selectedCustomerId; })
      : null;
    var label = c ? (c.displayName || c.primaryEmail || 'customer') : 'Customers';
    if (window.MastNavStack && selectedCustomerId) {
      MastNavStack.push({
        route: 'customers',
        view: 'detail',
        state: { customerId: selectedCustomerId, detailTab: detailTab, scrollTop: window.scrollY || 0 },
        label: label
      });
    }
    var doNav = function() {
      window._mastNavInternal = true;
      try {
        if (typeof navigateTo === 'function') navigateTo('contacts');
      } finally {
        window._mastNavInternal = false;
      }
      setTimeout(function() {
        if (typeof window.viewContact === 'function') window.viewContact(contactId);
      }, 0);
    };
    if (window.MastDirty) MastDirty.checkAndExit(doNav); else doNav();
  }

  // Back button from a customer detail. If MastNavStack has an entry,
  // pop and return to the original context. Otherwise fall back to list.
  function backFromDetail() {
    if (window.MastNavStack && MastNavStack.size() > 0) {
      MastNavStack.popAndReturn();
      return;
    }
    var doBack = function() {
      if (customerEditMode) {
        customerEditMode = false;
        if (window.MastDirty) MastDirty.unregister('customerEdit');
      }
      switchView('list');
    };
    if (window.MastDirty) MastDirty.checkAndExit(doBack); else doBack();
  }

  // Route "+ Add contact" through the contacts module, mirroring the
  // openOrderFromCustomer / openContactFromCustomer drill-through pattern.
  // Pushes a MastNavStack breadcrumb, stashes a pending-link hint so the
  // contacts module can atomically link the new contact to this customer,
  // then navigates to contacts and opens its Add Contact modal. On save,
  // contacts.saveNewContact reads the hint, writes the link + byContactId
  // index, and popAndReturns here — restoring the Contacts tab with the
  // new record visible.
  function addContactToCustomer(customerId) {
    if (!customerId) customerId = selectedCustomerId;
    var c = customersData.find(function(x) { return x && x.id === customerId; });
    if (!c) return;
    var label = c.displayName || c.primaryEmail || 'customer';

    if (window.MastNavStack && customerId) {
      MastNavStack.push({
        route: 'customers',
        view: 'detail',
        state: { customerId: customerId, detailTab: 'contacts', scrollTop: window.scrollY || 0 },
        label: label
      });
    }

    window._pendingContactCustomerLink = {
      customerId: customerId,
      prefillName: c.displayName || '',
      prefillEmail: c.primaryEmail || ''
    };

    var doNav = function() {
      window._mastNavInternal = true;
      try {
        if (typeof navigateTo === 'function') navigateTo('contacts');
      } finally {
        window._mastNavInternal = false;
      }
      var openIt = function() {
        if (typeof window.openAddContactModal === 'function') {
          window.openAddContactModal();
        } else {
          console.error('[customers] openAddContactModal not available after contacts load');
          toast('Failed to open add-contact form', true);
        }
      };
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        MastAdmin.loadModule('contacts').then(openIt).catch(function(err) {
          console.error('[customers] contacts module load failed', err);
          toast('Failed to load contacts module: ' + (err && err.message || err), true);
        });
      } else {
        setTimeout(openIt, 50);
      }
    };
    if (window.MastDirty) MastDirty.checkAndExit(doNav); else doNav();
  }

  function loadCustomerWallets(customerId, uids) {
    var cache = getCache(customerId);
    var promises = uids.map(function(uid) {
      return MastDB.get('public/accounts/' + uid + '/wallet')
        .then(function(s) { var v = s.val() || {}; v.uid = uid; return v; })
        .catch(function() { return { uid: uid }; });
    });
    Promise.all(promises).then(function(wallets) {
      cache.wallets = wallets;
      cache.loaded.wallets = true;
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'wallet') renderPreservingEdits();
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
      h += '<div style="font-size:1.6rem;margin-bottom:12px;">✓</div>';
      h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No pending duplicates</p>';
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
    // Push a MastNavStack entry so Back from the order detail returns to
    // THIS customer's Orders tab (Paradigm A popAndReturn). Must happen
    // BEFORE navigateTo('orders') so navigateTo doesn't clear the stack.
    var c = selectedCustomerId
      ? customersData.find(function(x) { return x && x.id === selectedCustomerId; })
      : null;
    var label = c ? (c.displayName || c.primaryEmail || 'customer') : 'Customers';
    if (window.MastNavStack && selectedCustomerId) {
      MastNavStack.push({
        route: 'customers',
        view: 'detail',
        state: { customerId: selectedCustomerId, detailTab: 'orders', scrollTop: window.scrollY || 0 },
        label: label
      });
    }
    var doNav = function() {
      window._mastNavInternal = true;
      try {
        if (typeof navigateTo === 'function') navigateTo('orders');
      } finally {
        window._mastNavInternal = false;
      }
      var callView = function() {
        if (typeof window.viewOrder === 'function') {
          window.viewOrder(orderId);
        } else {
          showToast && showToast('Could not open order — orders module failed to load.', true);
        }
      };
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        MastAdmin.loadModule('orders').then(callView).catch(function(err) {
          console.error('[customers] failed to load orders module', err);
          showToast && showToast('Failed to load orders module: ' + (err && err.message || err), true);
        });
      } else {
        setTimeout(callView, 50);
      }
    };
    if (window.MastDirty) MastDirty.checkAndExit(doNav); else doNav();
  }

  // ============================================================
  // Phase 6.1 — Stats backfill (admin button → callable)
  // ============================================================

  async function backfillStats() {
    if (customersBackfillRunning) return;
    var ok = await window.mastConfirm(
      'Recompute cached stats for every customer in this tenant? Runs once and may take a few seconds.',
      { title: 'Recompute customer stats', confirmLabel: 'Recompute' }
    );
    if (!ok) return;
    customersBackfillRunning = true;
    try {
      var fn = firebase.functions().httpsCallable('recomputeAllCustomerStats');
      var result = await fn({ tenantId: MastDB.tenantId() });
      var d = (result && result.data) || {};
      window.mastAlert('Stats recomputed. ' + (d.processed || 0) + ' customers processed (' + (d.skipped || 0) + ' skipped).');
      // Reload to pick up the new stats fields.
      customersLoaded = false;
      await loadCustomers();
    } catch (e) {
      console.error('[customers] backfill failed', e);
      window.mastAlert('Backfill failed: ' + (e && e.message));
    } finally {
      customersBackfillRunning = false;
    }
  }

  // ============================================================
  // Phase 6.2 — CSV export
  // ============================================================

  function csvField(v) {
    if (v == null) return '';
    var s = String(v);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportCsv() {
    var rows = getFilteredCustomers();
    if (rows.length === 0) {
      window.mastAlert('No customers in the current view to export.');
      return;
    }
    var header = ['displayName', 'primaryEmail', 'phones', 'tags', 'lifetimeSpend', 'orderCount', 'lastOrderAt', 'source', 'createdAt', 'customerId'];
    var lines = [header.join(',')];
    rows.forEach(function(c) {
      var stats = c.stats || {};
      var phones = (c.phones || []).join('; ');
      var tags = (c.tags || []).join('; ');
      var spend = (typeof stats.lifetimeSpendCents === 'number') ? (stats.lifetimeSpendCents / 100).toFixed(2) : '';
      var orderCount = (typeof stats.orderCount === 'number') ? String(stats.orderCount) : '';
      var lastOrder = stats.lastOrderAt || '';
      var line = [
        csvField(c.displayName || ''),
        csvField(c.primaryEmail || ''),
        csvField(phones),
        csvField(tags),
        csvField(spend),
        csvField(orderCount),
        csvField(lastOrder),
        csvField(c.source || ''),
        csvField(c.createdAt || ''),
        csvField(c.id || '')
      ].join(',');
      lines.push(line);
    });
    var csvText = lines.join('\n');

    var tenantId = (typeof MastDB !== 'undefined' && MastDB.tenantId) ? MastDB.tenantId() : 'tenant';
    var ymd = new Date().toISOString().slice(0, 10);
    var filename = 'mast-customers-' + tenantId + '-' + ymd + '.csv';

    try {
      var blob = new Blob([csvText], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[customers] csv export failed', e);
      window.mastAlert('CSV export failed: ' + (e && e.message));
    }
  }

  // ============================================================
  // Phase 6.3 — Segments
  // ============================================================

  function findSegmentById(id) {
    if (!id) return null;
    var b = BUILTIN_SEGMENTS.find(function(s) { return s.id === id; });
    if (b) return b;
    return segmentsData.find(function(s) { return s.id === id; }) || null;
  }

  // Apply a segment by writing its filters into the DOM controls and re-rendering.
  function applySegment(segId) {
    currentSegmentId = segId;
    var seg = findSegmentById(segId);
    var f = (seg && seg.filters) || {};

    var src = document.getElementById('customersSourceFilter'); if (src) src.value = f.source || 'all';
    var tag = document.getElementById('customersTagFilter');    if (tag) tag.value = f.tag || '';
    var lob = document.getElementById('customersLastOrderBefore'); if (lob) lob.value = f.lastOrderBefore || '';
    var min = document.getElementById('customersMinSpend');     if (min) min.value = (typeof f.minSpendCents === 'number') ? (f.minSpendCents / 100) : '';
    var srch = document.getElementById('customersSearch');      if (srch && typeof f.search === 'string') srch.value = f.search;

    renderTable();
  }

  // Snapshot current filter DOM into a serialisable filter object.
  function readFilterSnapshot() {
    var f = readActiveFilters();
    var snap = {};
    if (f.source && f.source !== 'all') snap.source = f.source;
    if (f.tag) snap.tag = f.tag;
    if (f.lastOrderBefore) snap.lastOrderBefore = f.lastOrderBefore;
    if (f.minSpendDollars !== '' && f.minSpendDollars != null) {
      var n = Math.round(parseFloat(f.minSpendDollars) * 100);
      if (!isNaN(n)) snap.minSpendCents = n;
    }
    if (f.search) snap.search = f.search;
    return snap;
  }

  async function saveSegment() {
    var name = await window.mastPrompt('Name this segment:', { title: 'Save segment', confirmLabel: 'Save' });
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    var filters = readFilterSnapshot();
    var id = 'seg_' + Date.now().toString(36);
    var now = new Date().toISOString();
    var record = {
      id: id,
      name: name,
      filters: filters,
      createdBy: (window.currentUser && window.currentUser.uid) || null,
      createdAt: now,
      updatedAt: now
    };
    try {
      await MastDB.set('admin/customerSegments/' + id, record);
      segmentsData.push(record);
      currentSegmentId = id;
      render();
      requestAnimationFrame(renderTable);
    } catch (e) {
      console.error('[customers] save segment failed', e);
      window.mastAlert('Save segment failed: ' + (e && e.message));
    }
  }

  async function deleteSegment(segId) {
    var seg = segmentsData.find(function(s) { return s.id === segId; });
    if (!seg) return;
    var ok = await window.mastConfirm('Delete segment "' + seg.name + '"?', { title: 'Delete segment', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await MastDB.remove('admin/customerSegments/' + segId);
      segmentsData = segmentsData.filter(function(s) { return s.id !== segId; });
      if (currentSegmentId === segId) currentSegmentId = '__all';
      render();
      requestAnimationFrame(renderTable);
      // Re-render manage modal if open
      if (document.getElementById('cmSegmentsModalBody')) manageSegments();
    } catch (e) {
      console.error('[customers] delete segment failed', e);
      window.mastAlert('Delete segment failed: ' + (e && e.message));
    }
  }

  async function renameSegment(segId) {
    var seg = segmentsData.find(function(s) { return s.id === segId; });
    if (!seg) return;
    var name = await window.mastPrompt('Rename segment:', { title: 'Rename segment', confirmLabel: 'Rename', defaultValue: seg.name });
    if (name === null) return;
    name = name.trim();
    if (!name || name === seg.name) return;
    var now = new Date().toISOString();
    try {
      await MastDB.update('admin/customerSegments/' + segId, { name: name, updatedAt: now });
      seg.name = name;
      seg.updatedAt = now;
      render();
      requestAnimationFrame(renderTable);
      if (document.getElementById('cmSegmentsModalBody')) manageSegments();
    } catch (e) {
      console.error('[customers] rename segment failed', e);
      window.mastAlert('Rename failed: ' + (e && e.message));
    }
  }

  function manageSegments() {
    var html = '';
    html += '<div class="modal-header"><h3>Manage segments</h3></div>';
    html += '<div class="modal-body" id="cmSegmentsModalBody">';
    if (segmentsData.length === 0) {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray);">No saved segments yet. Build a filter combination on the customers list and click "Save as segment".</p>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px;">';
      segmentsData.forEach(function(s) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--cream);border:1px solid var(--cream-dark);border-radius:6px;padding:10px 14px;gap:12px;">';
        html += '<div style="font-size:0.85rem;flex:1;min-width:0;">';
        html += '<div style="font-weight:600;">' + esc(s.name) + '</div>';
        html += '<div style="font-size:0.72rem;color:var(--warm-gray-light);">' + esc(describeFilters(s.filters || {})) + '</div>';
        html += '</div>';
        html += '<div style="display:flex;gap:6px;">';
        html += '<button class="btn btn-secondary btn-small" data-seg-id="' + esc(s.id) + '" onclick="customersRenameSegment(this.dataset.segId)">Rename</button>';
        html += '<button class="btn btn-secondary btn-small" data-seg-id="' + esc(s.id) + '" onclick="customersDeleteSegment(this.dataset.segId)" style="color:var(--danger);">Delete</button>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="modal-footer"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>';
    if (typeof openModal === 'function') openModal(html);
  }

  function describeFilters(f) {
    var bits = [];
    if (f.source) bits.push('source=' + f.source);
    if (f.tag) bits.push('tag=' + f.tag);
    if (f.lastOrderBefore) bits.push('last order before ' + f.lastOrderBefore);
    if (typeof f.minSpendCents === 'number') bits.push('min spend $' + (f.minSpendCents / 100).toFixed(2));
    if (f.search) bits.push('search "' + f.search + '"');
    if (f._newThisWeek) bits.push('new this week');
    if (f._noOrders) bits.push('no orders yet');
    return bits.length ? bits.join(' · ') : 'no filters';
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
  window.customersBackFromDetail = backFromDetail;

  // Delegated input listener for dirty indicator on customer edit.
  document.addEventListener('input', function(e) {
    var tab = document.getElementById('customersTab');
    if (tab && tab.contains(e.target)) _custEditUpdateDirtyIndicator();
  }, true);

  // Register MastNavStack restorer for the customers route.
  if (window.MastNavStack) {
    window.MastNavStack.registerRestorer('customers', function(view, state) {
      if (view !== 'detail' || !state || !state.customerId) return;
      var openIt = function() {
        if (customersData.find(function(x) { return x && x.id === state.customerId; })) {
          selectedCustomerId = state.customerId;
          currentView = 'detail';
          detailTab = state.detailTab || 'overview';
          render();
          if (state.scrollTop != null) {
            setTimeout(function() { window.scrollTo(0, state.scrollTop); }, 50);
          }
        }
      };
      if (!customersLoaded) loadCustomers().then(openIt);
      else openIt();
    });
  }
  window.customersAddContact = addContactToCustomer;
  // Called by contacts.js after atomically creating a contact that's linked
  // to a customer. Keeps the customers module's in-memory copy in sync so
  // MastNavStack.popAndReturn → restorer → render shows the new entry.
  window.customersAppendLinkedContact = function(customerId, contactId) {
    var cust = customersData.find(function(x) { return x && x.id === customerId; });
    if (!cust) return;
    if (!cust.linkedIds) cust.linkedIds = {};
    var ids = (cust.linkedIds.contactIds || []).slice();
    if (ids.indexOf(contactId) === -1) ids.push(contactId);
    cust.linkedIds.contactIds = ids;
    cust.updatedAt = new Date().toISOString();
    // Invalidate the per-customer contacts cache so loadCustomerContacts
    // refetches fresh and picks up the new contact record.
    var cache = detailCache[customerId];
    if (cache) {
      cache.loaded.contacts = false;
      cache._contactsLoading = false;
    }
  };
  window.customersEnterEdit = enterCustomerEditMode;
  window.customersCancelEdit = cancelCustomerEditMode;
  window.customersSaveEdit = saveCustomerEditMode;
  window.customersLiveUpdateHeader = function(v) {
    var h3 = document.querySelector('#customersTab h3');
    if (h3) h3.innerText = (v || '').trim() || '(no name)';
  };
  window.customersBackfillStats = backfillStats;
  window.customersExportCsv = exportCsv;
  window.customersApplySegment = applySegment;
  window.customersSaveSegment = saveSegment;
  window.customersManageSegments = manageSegments;
  window.customersDeleteSegment = deleteSegment;
  window.customersRenameSegment = renameSegment;

  // ============================================================
  // Module registration
  // ============================================================

  MastAdmin.registerModule('customers', {
    routes: {
      'customers': {
        tab: 'customersTab',
        setup: function() {
          // Detail-view restoration is now handled by MastNavStack restorer.
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
      segmentsData = [];
      currentSegmentId = null;
      customersLoaded = false;
      currentView = 'list';
      selectedCustomerId = null;
      detailTab = 'overview';
      detailCache = {};
    }
  });

})();
