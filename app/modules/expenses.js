// ============================================================
// EXPENSES MODULE (lazy-loaded)
// ============================================================
(function() {
'use strict';

var CATEGORIES = [
  { value: 'materials', label: 'Materials' },
  { value: 'booth_fee', label: 'Booth Fee' },
  { value: 'shipping_supplies', label: 'Shipping' },
  { value: 'travel', label: 'Travel' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'software', label: 'Software' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'taxes', label: 'Taxes' },
  { value: 'other', label: 'Other' },
  { value: 'personal', label: 'Personal' }
];

var BUSINESS_LINES = [
  { value: '', label: '\u2014' },
  { value: 'production', label: 'Production' },
  { value: 'sculpture', label: 'Sculpture' },
  { value: 'general', label: 'General' }
];

var currentView = 'transactions';
var expensesCache = [];
var accountLookup = {}; // plaidAccountId → { name, mask, institution }
var plaidLinkLoaded = false;

var PLAID_BANK_LIMITS = { 'free': 0, 'publish': 2, 'launch': 2, 'operate': 3, 'command': 5 };

// Custom confirm dialog (dark mode compliant, replaces native confirm())
function expConfirm(title, message, confirmLabel, onConfirm, cancelLabel) {
  var h = '<div style="max-width:420px;">';
  h += '<h3 style="margin:0 0 12px 0;font-size:1.1rem;">' + esc(title) + '</h3>';
  h += '<p style="font-size:0.9rem;color:var(--warm-gray, #6B6560);line-height:1.5;margin:0 0 20px 0;white-space:pre-line;">' + esc(message) + '</p>';
  h += '<div style="display:flex;justify-content:flex-end;gap:8px;">';
  h += '<button class="btn btn-secondary" onclick="closeModal()">' + esc(cancelLabel || 'Cancel') + '</button>';
  h += '<button class="btn btn-primary" id="expConfirmBtn">' + esc(confirmLabel || 'Continue') + '</button>';
  h += '</div></div>';
  openModal(h);
  document.getElementById('expConfirmBtn').onclick = function() {
    closeModal();
    onConfirm();
  };
}

function getPlaidBankLimit() {
  // Read plan from subscription (same source as server reads from platform registry)
  var sub = typeof getTenantSubscription === 'function' ? getTenantSubscription() : {};
  var plan = sub.plan || sub.tier || (window.TENANT_CONFIG && window.TENANT_CONFIG.plan) || 'publish';
  return PLAID_BANK_LIMITS[plan] !== undefined ? PLAID_BANK_LIMITS[plan] : 1;
}
var lastConnectAt = 0;

// ── View Switching (UX: .view-tab amber underline) ──

function showExpensesView(view) {
  currentView = view;
  var accountsView = document.getElementById('expAccountsView');
  var txnView = document.getElementById('expTransactionsView');
  var detailView = document.getElementById('expDetailView');

  // Update tab active states
  var tabs = document.querySelectorAll('#expViewTabs .view-tab');
  tabs.forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.expView === view);
  });

  accountsView.style.display = view === 'accounts' ? '' : 'none';
  txnView.style.display = view === 'transactions' ? '' : 'none';
  detailView.style.display = view === 'detail' ? '' : 'none';

  if (view === 'accounts') loadPlaidAccounts();
  if (view === 'transactions') loadExpenses();
}

// ── Plaid Accounts ──

async function loadPlaidAccounts() {
  var container = document.getElementById('plaidAccountsList');
  container.innerHTML = '<div class="loading">Loading connected banks\u2026</div>';

  try {
    var snap = await MastDB.plaidItems.list();
    var items = snap.val() || {};
    var keys = Object.keys(items);

    var includedLimit = getPlaidBankLimit();

    if (keys.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray, #6B6560);">' +
        '<div style="font-size:2rem;margin-bottom:12px;">\uD83C\uDFE6</div>' +
        '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No banks connected</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light, #9B958E);">Connect a bank or credit card to automatically import transactions.</p>' +
        '<p style="font-size:0.8rem;color:var(--warm-gray-light, #9B958E);margin-top:8px;">' + includedLimit + ' banks included in your plan. Additional banks cost 100 tokens/month.</p></div>';
      return;
    }

    var activeCount = keys.filter(function(k) { return items[k].status === 'active'; }).length;
    var h = '<div style="font-size:0.85rem;color:var(--warm-gray, #6B6560);margin-bottom:12px;">' +
      activeCount + ' of ' + includedLimit + ' included banks used' +
      (activeCount > includedLimit ? ' \u00B7 <span style="color:#f59e0b;">' + (activeCount - includedLimit) + ' extra (' + ((activeCount - includedLimit) * 100) + ' tokens/month)</span>' : '') +
      '</div>';

    keys.forEach(function(itemId) {
      var item = items[itemId];
      var statusBg = item.status === 'active' ? '#16a34a' : item.status === 'error' ? '#dc2626' : '#9ca3af';
      var acctCount = (item.accounts && item.accounts.length) || 0;

      h += '<div style="background:var(--cream, #FAF6F0);border:1px solid var(--cream-dark, #F0E8DB);border-radius:8px;padding:12px 16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';

      // Header row — always visible, clickable to expand
      h += '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="toggleBankCard(\'' + esc(itemId) + '\')">';
      h += '<div style="display:flex;align-items:center;gap:8px;">';
      h += '<span id="expBankArrow_' + esc(itemId) + '" style="font-size:0.7rem;transition:transform 0.2s;">\u25B6</span>';
      h += '<span style="font-weight:600;font-size:1rem;">' + esc(item.institutionName || 'Unknown Bank') + '</span>';
      h += '<span style="font-size:0.8rem;color:var(--warm-gray, #6B6560);">' + acctCount + ' account' + (acctCount !== 1 ? 's' : '') + '</span>';
      h += '<span class="status-badge" style="background:' + statusBg + ';color:white;">' + esc(item.status || 'unknown') + '</span>';
      if (item.lastSyncAt) h += '<span style="font-size:0.75rem;color:var(--warm-gray-light, #9B958E);">Synced ' + new Date(item.lastSyncAt).toLocaleDateString() + '</span>';
      h += '</div>';

      // Action buttons (always visible)
      h += '<div style="display:flex;gap:6px;" onclick="event.stopPropagation()">';
      if (item.status === 'active') {
        h += '<button class="btn btn-primary btn-small" data-item-id="' + esc(itemId) + '" onclick="syncPlaidItem(this.dataset.itemId)">Sync Now</button>';
      }
      h += '<button class="btn btn-danger btn-small" data-item-id="' + esc(itemId) + '" onclick="disconnectPlaidItem(this.dataset.itemId)">Disconnect</button>';
      h += '</div>';
      h += '</div>';

      // Collapsible detail section
      h += '<div id="expBankDetail_' + esc(itemId) + '" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--cream-dark, #F0E8DB);">';

      if (item.accounts && item.accounts.length) {
        item.accounts.forEach(function(acct) {
          h += '<div style="font-size:0.85rem;color:var(--warm-gray, #6B6560);margin-top:2px;">';
          h += esc(acct.name || acct.type) + ' \u2022\u2022' + esc(acct.mask || '????');
          h += ' <span style="text-transform:capitalize;font-size:0.75rem;">(' + esc(acct.subtype || acct.type) + ')</span>';
          h += '</div>';
        });
      }

      if (item.lastSyncAt) {
        h += '<div style="font-size:0.75rem;color:var(--warm-gray-light, #9B958E);margin-top:6px;">Last synced ' + new Date(item.lastSyncAt).toLocaleString() + '</div>';
      }

      if (item.lastError) {
        h += '<div style="font-size:0.75rem;color:var(--danger, #DC3545);margin-top:4px;">' + esc(item.lastError) + '</div>';
      }

      h += '</div>'; // close collapsible detail

      h += '</div>'; // close card
    });

    container.innerHTML = h;
  } catch (err) {
    container.innerHTML = '<div style="color:var(--danger, #DC3545);padding:12px;">' + esc(err.message) + '</div>';
  }
}

async function connectPlaidAccount() {
  var btn = document.getElementById('connectPlaidBtn');

  // Rate limit (security: 10s cooldown)
  if (Date.now() - lastConnectAt < 10000) {
    showToast('Please wait before connecting another bank', true);
    return;
  }

  // Check extra account limit + token balance
  try {
    var itemsSnap = await MastDB.plaidItems.list();
    var allItems = itemsSnap.val() || {};
    var activeCount = Object.values(allItems).filter(function(i) { return i.status === 'active'; }).length;
    var includedLimit = getPlaidBankLimit();

    if (includedLimit === 0) {
      showToast('Bank connections are not available on the free plan. Upgrade to connect a bank.', true);
      return;
    }

    if (activeCount >= includedLimit) {
      var EXTRA_COST = 100;
      var w = getTokenWallet();
      var availableTokens = (w.currentBalance || 0) + (w.coinTokenSurplus || 0) + ((w.coinBalance || 0) * 100);

      if (availableTokens < EXTRA_COST) {
        var shortfall = EXTRA_COST - availableTokens;
        expConfirm(
          'Not enough tokens',
          'You\'ve used your ' + includedLimit + ' included banks.\n\nAdding another costs ' + EXTRA_COST + ' tokens/month but you only have ' + availableTokens + ' tokens available (need ' + shortfall + ' more).',
          'Purchase Tokens',
          function() { if (typeof openCoinPurchaseModal === 'function') openCoinPurchaseModal('expenses', 'connectBank'); }
        );
        return;
      }

      expConfirm(
        'Extra bank connection',
        'You\'ve used your ' + includedLimit + ' included banks.\n\nAdding another will cost ' + EXTRA_COST + ' tokens/month (' + availableTokens + ' tokens available). If you don\'t have enough tokens next month, this bank will be automatically disconnected.',
        'Continue',
        function() { startPlaidLink(); }
      );
      return;
    }
  } catch (e) { /* proceed, server enforces */ }

  startPlaidLink();
}

async function startPlaidLink() {
  var btn = document.getElementById('connectPlaidBtn');
  lastConnectAt = Date.now();
  btn.disabled = true;
  btn.textContent = 'Connecting\u2026';

  try {
    if (!plaidLinkLoaded) {
      await new Promise(function(resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        script.onload = function() { plaidLinkLoaded = true; resolve(); };
        script.onerror = function() { reject(new Error('Failed to load Plaid Link SDK')); };
        document.head.appendChild(script);
      });
    }

    var createLinkToken = firebase.functions().httpsCallable('createPlaidLinkToken');
    var result = await createLinkToken({ tenantId: MastDB.tenantId() });
    var linkToken = result.data.link_token;

    var handler = Plaid.create({
      token: linkToken,
      onSuccess: async function(publicToken) {
        btn.textContent = 'Exchanging token\u2026';
        try {
          var exchangeToken = firebase.functions().httpsCallable('exchangePlaidToken');
          var exchangeResult = await exchangeToken({
            tenantId: MastDB.tenantId(),
            public_token: publicToken
          });
          showToast('Connected ' + esc(exchangeResult.data.institutionName || 'bank account') + ' (' + exchangeResult.data.accountCount + ' accounts)');
          loadPlaidAccounts();
        } catch (err) {
          showToast('Failed to connect: ' + esc(err.message), true);
        }
        btn.disabled = false;
        btn.textContent = '+ Connect Bank';
      },
      onExit: function(err) {
        if (err) showToast('Plaid connection cancelled', true);
        btn.disabled = false;
        btn.textContent = '+ Connect Bank';
      }
    });
    handler.open();
  } catch (err) {
    showToast('Failed to start Plaid connection: ' + esc(err.message), true);
    btn.disabled = false;
    btn.textContent = '+ Connect Bank';
  }
}

async function syncPlaidItem(itemId) {
  showToast('Syncing transactions\u2026');
  try {
    var syncFn = firebase.functions().httpsCallable('syncPlaidTransactions');
    var result = await syncFn({ tenantId: MastDB.tenantId(), itemId: itemId });
    var d = result.data;
    showToast('Synced: ' + d.imported + ' new, ' + d.updated + ' updated, ' + d.removed + ' removed');
    showExpensesView('transactions');
  } catch (err) {
    showToast('Sync failed: ' + esc(err.message), true);
    loadPlaidAccounts();
  }
}

async function disconnectPlaidItem(itemId) {
  expConfirm('Disconnect bank', 'Disconnect this bank? Existing imported transactions will remain.', 'Disconnect', function() { doDisconnectPlaidItem(itemId); });
}

async function doDisconnectPlaidItem(itemId) {
  try {
    var disconnectFn = firebase.functions().httpsCallable('disconnectPlaidItem');
    await disconnectFn({ tenantId: MastDB.tenantId(), itemId: itemId });
    showToast('Bank disconnected');
    loadPlaidAccounts();
  } catch (err) {
    showToast('Disconnect failed: ' + esc(err.message), true);
  }
}

// ── Expenses List ──

async function loadExpenses() {
  var listEl = document.getElementById('expTransactionsList');
  var emptyEl = document.getElementById('expEmpty');
  var summaryEl = document.getElementById('expSummaryBar');
  listEl.innerHTML = '<div class="loading">Loading expenses\u2026</div>';
  emptyEl.style.display = 'none';

  try {
    // Build account lookup for display names
    try {
      var itemsSnap = await MastDB.plaidItems.list();
      var plaidItems = itemsSnap.val() || {};
      accountLookup = {};
      Object.values(plaidItems).forEach(function(item) {
        if (item.accounts) {
          item.accounts.forEach(function(acct) {
            accountLookup[acct.accountId] = {
              name: acct.name || acct.type,
              mask: acct.mask || '????',
              institution: item.institutionName || 'Unknown'
            };
          });
        }
      });
      // Populate account filter dropdown
      var acctFilter = document.getElementById('expFilterAccount');
      if (acctFilter) {
        var currentVal = acctFilter.value;
        var opts = '<option value="">All Accounts</option>';
        Object.keys(accountLookup).forEach(function(acctId) {
          var a = accountLookup[acctId];
          opts += '<option value="' + esc(acctId) + '"' + (currentVal === acctId ? ' selected' : '') + '>' + esc(a.institution) + ' \u2022\u2022' + esc(a.mask) + '</option>';
        });
        acctFilter.innerHTML = opts;
      }
    } catch (e) { /* non-critical */ }

    var statusFilter = document.getElementById('expFilterStatus').value;
    var categoryFilter = document.getElementById('expFilterCategory').value;
    var accountFilter = document.getElementById('expFilterAccount') ? document.getElementById('expFilterAccount').value : '';

    var ref = MastDB.expenses.ref();
    var snap;
    if (statusFilter === 'unreviewed') {
      snap = await ref.orderByChild('reviewed').equalTo(false).limitToLast(100).once('value');
    } else if (statusFilter === 'reviewed') {
      snap = await ref.orderByChild('reviewed').equalTo(true).limitToLast(100).once('value');
    } else {
      snap = await ref.orderByChild('date').limitToLast(100).once('value');
    }

    var data = snap.val() || {};
    var expenses = Object.entries(data).map(function(entry) {
      return Object.assign({ _key: entry[0] }, entry[1]);
    });

    if (categoryFilter) {
      expenses = expenses.filter(function(e) { return e.category === categoryFilter; });
    }
    if (accountFilter) {
      expenses = expenses.filter(function(e) { return e.plaidAccountId === accountFilter; });
    }

    expenses.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    expensesCache = expenses;

    // Summary bar
    var total = 0;
    var unreviewedCount = 0;
    expenses.forEach(function(e) {
      total += e.amount || 0;
      if (!e.reviewed) unreviewedCount++;
    });
    summaryEl.innerHTML = '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.85rem;color:var(--warm-gray, #6B6560);">' +
      '<span><strong>' + expenses.length + '</strong> expenses</span>' +
      '<span>Total: <strong>$' + (total / 100).toFixed(2) + '</strong></span>' +
      (unreviewedCount > 0 ? '<span style="color:#f59e0b;">' + unreviewedCount + ' unreviewed</span>' : '') +
      '</div>';

    if (expenses.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      emptyEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray, #6B6560);">' +
        '<div style="font-size:2rem;margin-bottom:12px;">\uD83D\uDCB8</div>' +
        '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No expenses found</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light, #9B958E);">Connect a bank account or add expenses manually.</p></div>';
      return;
    }

    renderExpensesList(expenses);
  } catch (err) {
    listEl.innerHTML = '<div style="color:var(--danger, #DC3545);padding:12px;">' + esc(err.message) + '</div>';
  }
}

function renderExpensesList(expenses) {
  var listEl = document.getElementById('expTransactionsList');
  var h = '<div style="display:flex;flex-direction:column;gap:6px;">';

  expenses.forEach(function(exp) {
    var amountStr = (exp.amount >= 0 ? '' : '-') + '$' + (Math.abs(exp.amount) / 100).toFixed(2);
    var amountColor = exp.amount >= 0 ? 'inherit' : '#16a34a';
    var reviewedBorder = exp.reviewed ? '3px solid transparent' : '3px solid #f59e0b';
    var sourceIcon = exp.source === 'plaid' ? '\uD83C\uDFE6' : exp.source === 'csv_import' ? '\uD83D\uDCC4' : '\u270D\uFE0F';

    h += '<div style="background:var(--cream, #FAF6F0);border:1px solid var(--cream-dark, #F0E8DB);border-left:' + reviewedBorder + ';border-radius:8px;padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,0.08);transition:background 0.15s;display:flex;align-items:center;gap:10px;" ';
    h += 'data-expense-id="' + esc(exp._key) + '">';

    // Checkbox (only for unapproved)
    if (!exp.reviewed) {
      h += '<input type="checkbox" class="exp-checkbox" data-key="' + esc(exp._key) + '" onclick="event.stopPropagation();updateApproveButton()" style="width:18px;height:18px;flex-shrink:0;cursor:pointer;accent-color:var(--amber, #C4853C);">';
    } else {
      h += '<div style="width:18px;height:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#16a34a;font-size:0.9rem;">\u2713</div>';
    }

    // Clickable content area
    h += '<div style="flex:1;min-width:0;cursor:pointer;" onclick="showExpenseDetail(\'' + esc(exp._key) + '\')">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">';

    // Left: info
    h += '<div style="flex:1;min-width:0;">';
    h += '<div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">';
    h += sourceIcon + ' ' + esc(exp.merchantName || exp.description);
    if (exp.pending) h += ' <span class="status-badge" style="background:#f59e0b;color:white;">pending</span>';
    h += '</div>';
    h += '<div style="font-size:0.8rem;color:var(--warm-gray, #6B6560);margin-top:2px;">' + esc(exp.date || '');
    if (exp.plaidAccountId && accountLookup[exp.plaidAccountId]) {
      var acctInfo = accountLookup[exp.plaidAccountId];
      h += ' \u00B7 ' + esc(acctInfo.institution) + ' \u2022\u2022' + esc(acctInfo.mask);
    }
    if (exp.description && exp.merchantName && exp.description !== exp.merchantName) {
      h += ' \u00B7 ' + esc(exp.description.substring(0, 40));
    }
    h += '</div>';

    // Category badge
    var catLabel = CATEGORIES.find(function(c) { return c.value === exp.category; });
    h += '<div style="margin-top:4px;">';
    h += '<span class="status-badge" style="background:rgba(196,133,60,0.15);color:var(--amber, #C4853C);">' + esc(catLabel ? catLabel.label : exp.category) + '</span>';
    if (!exp.reviewed) {
      h += ' <span style="font-size:0.75rem;color:#f59e0b;">Needs review</span>';
    } else {
      h += ' <span style="font-size:0.75rem;color:#16a34a;">\u2713 Approved</span>';
    }
    h += '</div>';
    h += '</div>';

    // Right: amount
    h += '<div style="text-align:right;flex-shrink:0;">';
    h += '<div style="font-weight:700;font-size:1.05rem;color:' + amountColor + ';">' + amountStr + '</div>';
    if (exp.plaidCategory) {
      h += '<div style="font-size:0.7rem;color:var(--warm-gray-light, #9B958E);">' + esc(exp.plaidCategory) + '</div>';
    }
    h += '</div>';

    h += '</div></div>';

    h += '</div>';
  });

  h += '</div>';
  listEl.innerHTML = h;
  updateApproveButton();
}

function updateApproveButton() {
  var btn = document.getElementById('bulkApproveBtn');
  var personalBtn = document.getElementById('markPersonalBtn');
  if (!btn) return;
  var checked = document.querySelectorAll('.exp-checkbox:checked');
  var allBoxes = document.querySelectorAll('.exp-checkbox');
  if (checked.length > 0) {
    btn.textContent = 'Approve (' + checked.length + ')';
    btn.disabled = false;
    if (personalBtn) personalBtn.disabled = false;
  } else {
    btn.textContent = 'Approve';
    btn.disabled = true;
    if (personalBtn) personalBtn.disabled = true;
  }
  // Keep Select All in sync
  var selectAll = document.getElementById('expSelectAll');
  if (selectAll && allBoxes.length > 0) {
    selectAll.checked = checked.length === allBoxes.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < allBoxes.length;
  }
}

function toggleSelectAll(checked) {
  var boxes = document.querySelectorAll('.exp-checkbox');
  boxes.forEach(function(cb) { cb.checked = checked; });
  updateApproveButton();
}

// ── Transaction Detail View ──

async function showExpenseDetail(expenseId) {
  var detailView = document.getElementById('expDetailView');
  var detailContent = document.getElementById('expDetailContent');

  // Hide other views, show detail
  document.getElementById('expAccountsView').style.display = 'none';
  document.getElementById('expTransactionsView').style.display = 'none';
  detailView.style.display = '';

  // Remove tab active states
  var tabs = document.querySelectorAll('#expViewTabs .view-tab');
  tabs.forEach(function(tab) { tab.classList.remove('active'); });

  detailContent.innerHTML = '<div class="loading">Loading expense\u2026</div>';

  try {
    var snap = await MastDB.expenses.get(expenseId);
    if (!snap.exists()) {
      detailContent.innerHTML = '<div style="color:var(--danger, #DC3545);">Expense not found.</div>';
      return;
    }

    var exp = snap.val();
    var amountStr = (exp.amount >= 0 ? '' : '-') + '$' + (Math.abs(exp.amount) / 100).toFixed(2);
    var amountColor = exp.amount >= 0 ? 'inherit' : '#16a34a';
    var sourceLabel = exp.source === 'plaid' ? 'Plaid' : exp.source === 'csv_import' ? 'CSV Import' : 'Manual';
    var sourceIcon = exp.source === 'plaid' ? '\uD83C\uDFE6' : exp.source === 'csv_import' ? '\uD83D\uDCC4' : '\u270D\uFE0F';

    var h = '';
    h += '<button class="detail-back" onclick="showExpensesView(\'transactions\')">\u2190 Back to Expenses</button>';

    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">';
    h += '<div>';
    h += '<h3 style="margin:0;">' + sourceIcon + ' ' + esc(exp.merchantName || exp.description) + '</h3>';
    h += '<div style="font-size:0.8rem;color:var(--warm-gray, #6B6560);margin-top:4px;">' + esc(exp.date || '') + ' \u00B7 ' + sourceLabel;
    if (exp.pending) h += ' \u00B7 <span class="status-badge" style="background:#f59e0b;color:white;">pending</span>';
    h += '</div>';
    h += '</div>';
    h += '<div style="font-size:1.5rem;font-weight:700;color:' + amountColor + ';">' + amountStr + '</div>';
    h += '</div>';

    // Details card
    h += '<div style="background:var(--cream, #FAF6F0);border:1px solid var(--cream-dark, #F0E8DB);border-radius:8px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:16px;">';

    // Description
    if (exp.description) {
      h += '<div style="margin-bottom:16px;">';
      h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Description</label>';
      h += '<div style="font-size:0.9rem;color:inherit;">' + esc(exp.description) + '</div>';
      h += '</div>';
    }

    // Category
    h += '<div style="margin-bottom:16px;">';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Category</label>';
    h += '<select data-expense-id="' + esc(expenseId) + '" onchange="updateExpenseField(this.dataset.expenseId, \'category\', this.value)" style="padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;background:var(--cream, #FAF6F0);color:inherit;">';
    CATEGORIES.forEach(function(cat) {
      h += '<option value="' + cat.value + '"' + (exp.category === cat.value ? ' selected' : '') + '>' + cat.label + '</option>';
    });
    h += '</select>';
    h += '</div>';

    // Business Line
    h += '<div style="margin-bottom:16px;">';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Business Line</label>';
    h += '<select data-expense-id="' + esc(expenseId) + '" onchange="updateExpenseField(this.dataset.expenseId, \'businessLine\', this.value)" style="padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;background:var(--cream, #FAF6F0);color:inherit;">';
    BUSINESS_LINES.forEach(function(bl) {
      h += '<option value="' + bl.value + '"' + ((exp.businessLine || '') === bl.value ? ' selected' : '') + '>' + bl.label + '</option>';
    });
    h += '</select>';
    h += '</div>';

    // Notes
    h += '<div style="margin-bottom:16px;">';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Notes</label>';
    h += '<textarea data-expense-id="' + esc(expenseId) + '" onblur="updateExpenseField(this.dataset.expenseId, \'notes\', this.value)" rows="3" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;background:var(--cream, #FAF6F0);color:inherit;resize:vertical;box-sizing:border-box;">' + esc(exp.notes || '') + '</textarea>';
    h += '</div>';

    h += '</div>'; // end details card

    // Source info card (read-only)
    h += '<div style="background:var(--cream, #FAF6F0);border:1px solid var(--cream-dark, #F0E8DB);border-radius:8px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:16px;">';
    h += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:8px;">Source Details</label>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;">';
    h += '<div><span style="color:var(--warm-gray, #6B6560);">Source:</span> ' + sourceLabel + '</div>';
    if (exp.plaidCategory) h += '<div><span style="color:var(--warm-gray, #6B6560);">Plaid Category:</span> ' + esc(exp.plaidCategory) + '</div>';
    if (exp.plaidCategoryDetailed) h += '<div><span style="color:var(--warm-gray, #6B6560);">Plaid Detail:</span> ' + esc(exp.plaidCategoryDetailed) + '</div>';
    if (exp.categoryConfidence != null) h += '<div><span style="color:var(--warm-gray, #6B6560);">Confidence:</span> ' + Math.round(exp.categoryConfidence * 100) + '%</div>';
    if (exp.sourceTransactionId) h += '<div><span style="color:var(--warm-gray, #6B6560);">Transaction ID:</span> <span style="font-size:0.75rem;">' + esc(exp.sourceTransactionId) + '</span></div>';
    if (exp.plaidAccountId) h += '<div><span style="color:var(--warm-gray, #6B6560);">Account ID:</span> <span style="font-size:0.75rem;">' + esc(exp.plaidAccountId) + '</span></div>';
    h += '<div><span style="color:var(--warm-gray, #6B6560);">Created:</span> ' + (exp.createdAt ? new Date(exp.createdAt).toLocaleString() : '\u2014') + '</div>';
    h += '<div><span style="color:var(--warm-gray, #6B6560);">Updated:</span> ' + (exp.updatedAt ? new Date(exp.updatedAt).toLocaleString() : '\u2014') + '</div>';
    h += '</div></div>';

    // Action buttons
    h += '<div style="display:flex;gap:8px;margin-top:16px;">';
    if (!exp.reviewed) {
      h += '<button class="btn btn-primary" data-expense-id="' + esc(expenseId) + '" onclick="approveAndBack(this.dataset.expenseId)">Approve</button>';
      h += '<button class="btn btn-secondary" data-expense-id="' + esc(expenseId) + '" onclick="markPersonalAndBack(this.dataset.expenseId)">Personal</button>';
    } else {
      h += '<span class="status-badge" style="background:#16a34a;color:white;padding:6px 12px;font-size:0.85rem;">\u2713 Approved</span>';
    }
    h += '<button class="btn btn-danger btn-small" data-expense-id="' + esc(expenseId) + '" onclick="deleteExpense(this.dataset.expenseId)">Delete</button>';
    h += '</div>';

    detailContent.innerHTML = h;
  } catch (err) {
    detailContent.innerHTML = '<div style="color:var(--danger, #DC3545);padding:12px;">' + esc(err.message) + '</div>';
  }
}

async function approveAndBack(expenseId) {
  try {
    await MastDB.expenses.update(expenseId, { reviewed: true, updatedAt: new Date().toISOString() });
    showToast('Expense approved');
    showExpensesView('transactions');
  } catch (err) {
    showToast('Approve failed: ' + esc(err.message), true);
  }
}

async function markPersonalAndBack(expenseId) {
  try {
    await MastDB.expenses.update(expenseId, {
      category: 'personal',
      categorySource: 'user',
      reviewed: true,
      updatedAt: new Date().toISOString()
    });
    showToast('Marked as personal');
    showExpensesView('transactions');
  } catch (err) {
    showToast('Failed: ' + esc(err.message), true);
  }
}

function deleteExpense(expenseId) {
  expConfirm('Delete expense', 'Delete this expense? This cannot be undone.', 'Delete', async function() {
    try {
      await MastDB.expenses.remove(expenseId);
      showToast('Expense deleted');
      showExpensesView('transactions');
    } catch (err) {
      showToast('Delete failed: ' + esc(err.message), true);
    }
  });
}

// ── Inline Updates ──

async function updateExpenseField(expenseId, field, value) {
  try {
    var updates = {};
    updates[field] = value || null;
    updates.updatedAt = new Date().toISOString();
    if (field === 'category') updates.categorySource = 'user';
    await MastDB.expenses.update(expenseId, updates);
  } catch (err) {
    showToast('Update failed: ' + esc(err.message), true);
  }
}

async function bulkApproveExpenses() {
  var checked = document.querySelectorAll('.exp-checkbox:checked');
  if (checked.length === 0) {
    showToast('Select expenses to approve', true);
    return;
  }
  var checkedKeys = new Set();
  checked.forEach(function(cb) { checkedKeys.add(cb.dataset.key); });
  var toApprove = expensesCache.filter(function(e) { return checkedKeys.has(e._key); });

  if (toApprove.length === 0) {
    showToast('No expenses to approve');
    return;
  }
  var count = toApprove.length;
  expConfirm('Approve expenses', 'Approve ' + count + ' expense' + (count !== 1 ? 's' : '') + '?', 'Approve', async function() {
    var btn = document.getElementById('bulkApproveBtn');
    btn.disabled = true;
    btn.textContent = 'Approving\u2026';
    try {
      var updates = {};
      toApprove.forEach(function(e) {
        updates['admin/expenses/' + e._key + '/reviewed'] = true;
        updates['admin/expenses/' + e._key + '/updatedAt'] = new Date().toISOString();
      });
      await MastDB._ref('').update(updates);
      showToast('Approved ' + count + ' expense' + (count !== 1 ? 's' : ''));
      loadExpenses();
    } catch (err) {
      showToast('Approve failed: ' + esc(err.message), true);
    } finally {
      btn.disabled = false;
      updateApproveButton();
    }
  });
}

async function markPersonal() {
  var checked = document.querySelectorAll('.exp-checkbox:checked');
  if (checked.length === 0) {
    showToast('Select expenses to mark as personal', true);
    return;
  }

  var count = checked.length;
  expConfirm('Mark as personal', 'Mark ' + count + ' expense' + (count !== 1 ? 's' : '') + ' as personal? They will be excluded from business reports.', 'Mark Personal', async function() {
    var btn = document.getElementById('markPersonalBtn');
    btn.disabled = true;
    btn.textContent = 'Marking\u2026';
    try {
      var cbs = document.querySelectorAll('.exp-checkbox:checked');
      var updates = {};
      cbs.forEach(function(cb) {
        updates['admin/expenses/' + cb.dataset.key + '/category'] = 'personal';
        updates['admin/expenses/' + cb.dataset.key + '/categorySource'] = 'user';
        updates['admin/expenses/' + cb.dataset.key + '/reviewed'] = true;
        updates['admin/expenses/' + cb.dataset.key + '/updatedAt'] = new Date().toISOString();
      });
      await MastDB._ref('').update(updates);
      showToast(count + ' expense' + (count !== 1 ? 's' : '') + ' marked as personal');
      loadExpenses();
    } catch (err) {
      showToast('Failed: ' + esc(err.message), true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Personal';
    }
  });
}

function downloadExpensesCsv() {
  if (expensesCache.length === 0) {
    showToast('No expenses to download', true);
    return;
  }
  var headers = ['Date', 'Merchant', 'Description', 'Amount', 'Category', 'Business Line', 'Source', 'Approved', 'Account', 'Notes'];
  var rows = expensesCache.map(function(e) {
    var acct = e.plaidAccountId && accountLookup[e.plaidAccountId]
      ? accountLookup[e.plaidAccountId].institution + ' \u2022\u2022' + accountLookup[e.plaidAccountId].mask
      : '';
    return [
      e.date || '',
      csvEscape(e.merchantName || ''),
      csvEscape(e.description || ''),
      (e.amount / 100).toFixed(2),
      e.category || '',
      e.businessLine || '',
      e.source || '',
      e.reviewed ? 'Yes' : 'No',
      csvEscape(acct),
      csvEscape(e.notes || '')
    ].join(',');
  });
  var csv = headers.join(',') + '\n' + rows.join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'expenses-' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Downloaded ' + expensesCache.length + ' expenses');
}

function csvEscape(str) {
  if (!str) return '';
  if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function initExpenses() {
  showExpensesView('transactions');
}

// ── Window exports ──
window.showExpensesView = showExpensesView;
window.connectPlaidAccount = connectPlaidAccount;
window.toggleBankCard = function(itemId) {
  var detail = document.getElementById('expBankDetail_' + itemId);
  var arrow = document.getElementById('expBankArrow_' + itemId);
  if (!detail) return;
  var isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
};
window.syncPlaidItem = syncPlaidItem;
window.disconnectPlaidItem = disconnectPlaidItem;
window.loadExpenses = loadExpenses;
window.showExpenseDetail = showExpenseDetail;
window.approveAndBack = approveAndBack;
window.deleteExpense = deleteExpense;
window.updateExpenseField = updateExpenseField;
window.bulkApproveExpenses = bulkApproveExpenses;
window.markPersonal = markPersonal;
window.markPersonalAndBack = markPersonalAndBack;
window.downloadExpensesCsv = downloadExpensesCsv;
window.updateApproveButton = updateApproveButton;
window.toggleSelectAll = toggleSelectAll;

// ── Module registration ──
MastAdmin.registerModule('expenses', {
  routes: {
    'expenses': { tab: 'expensesTab', setup: function() { initExpenses(); } }
  }
});

})();
