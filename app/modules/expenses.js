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
  { value: 'other', label: 'Other' }
];

var BUSINESS_LINES = [
  { value: '', label: '—' },
  { value: 'production', label: 'Production' },
  { value: 'sculpture', label: 'Sculpture' },
  { value: 'general', label: 'General' }
];

var currentView = 'transactions';
var expensesCache = [];
var plaidLinkLoaded = false;

// ── View Switching ──

function showExpensesView(view) {
  currentView = view;
  var accountsView = document.getElementById('expAccountsView');
  var txnView = document.getElementById('expTransactionsView');
  var accountsBtn = document.getElementById('expViewAccountsBtn');
  var txnBtn = document.getElementById('expViewTxnBtn');

  if (view === 'accounts') {
    accountsView.style.display = '';
    txnView.style.display = 'none';
    accountsBtn.style.background = 'var(--primary, #2a7c6f)';
    accountsBtn.style.color = 'white';
    txnBtn.style.background = 'transparent';
    txnBtn.style.color = 'var(--primary, #2a7c6f)';
    loadPlaidAccounts();
  } else {
    accountsView.style.display = 'none';
    txnView.style.display = '';
    txnBtn.style.background = 'var(--primary, #2a7c6f)';
    txnBtn.style.color = 'white';
    accountsBtn.style.background = 'transparent';
    accountsBtn.style.color = 'var(--primary, #2a7c6f)';
    loadExpenses();
  }
}

// ── Plaid Accounts ──

async function loadPlaidAccounts() {
  var container = document.getElementById('plaidAccountsList');
  container.innerHTML = '<p style="color:var(--text-secondary, #888);">Loading connected accounts...</p>';

  try {
    var snap = await MastDB.plaidItems.list();
    var items = snap.val() || {};
    var keys = Object.keys(items);

    // Read account limit config
    var limitSnap = await MastDB._ref('admin/config/expenseSettings/plaidAccountLimit').once('value');
    var includedLimit = limitSnap.val() || 2;

    if (keys.length === 0) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary, #888);">' +
        '<p style="font-size:1.1rem;margin-bottom:8px;">No bank accounts connected</p>' +
        '<p style="font-size:0.85rem;">Connect a bank or credit card account to automatically import transactions.</p>' +
        '<p style="font-size:0.8rem;margin-top:8px;">' + includedLimit + ' accounts included in your plan. Additional accounts cost 200 tokens/month.</p></div>';
      return;
    }

    var activeCount = keys.filter(function(k) { return items[k].status === 'active'; }).length;
    var h = '<div style="font-size:0.8rem;color:var(--text-secondary, #888);margin-bottom:12px;">' +
      activeCount + ' of ' + includedLimit + ' included accounts used' +
      (activeCount > includedLimit ? ' · <span style="color:#f59e0b;">' + (activeCount - includedLimit) + ' extra (' + ((activeCount - includedLimit) * 200) + ' tokens/month)</span>' : '') +
      '</div>';
    keys.forEach(function(itemId) {
      var item = items[itemId];
      var statusColor = item.status === 'active' ? '#16a34a' : item.status === 'error' ? '#dc2626' : '#6b7280';
      var statusLabel = item.status || 'unknown';

      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:14px 16px;margin-bottom:10px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">';
      h += '<div>';
      h += '<div style="font-weight:600;font-size:1rem;">' + esc(item.institutionName || 'Unknown Bank') + '</div>';

      // Accounts list
      if (item.accounts && item.accounts.length) {
        item.accounts.forEach(function(acct) {
          h += '<div style="font-size:0.85rem;color:var(--text-secondary, #888);margin-top:2px;">';
          h += esc(acct.name || acct.type) + ' ••' + esc(acct.mask || '????');
          h += ' <span style="text-transform:capitalize;font-size:0.75rem;">(' + esc(acct.subtype || acct.type) + ')</span>';
          h += '</div>';
        });
      }

      h += '<div style="font-size:0.75rem;color:var(--text-secondary, #888);margin-top:4px;">';
      h += '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + statusColor + ';margin-right:4px;vertical-align:middle;"></span>';
      h += statusLabel;
      if (item.lastSyncAt) h += ' · Last synced ' + new Date(item.lastSyncAt).toLocaleString();
      h += '</div>';

      if (item.lastError) {
        h += '<div style="font-size:0.75rem;color:#dc2626;margin-top:2px;">' + esc(item.lastError) + '</div>';
      }

      h += '</div>';

      // Action buttons
      h += '<div style="display:flex;gap:6px;">';
      if (item.status === 'active') {
        h += '<button onclick="syncPlaidItem(\'' + esc(itemId) + '\')" style="background:var(--primary, #2a7c6f);color:white;border:none;padding:6px 12px;border-radius:6px;font-size:0.8rem;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Sync Now</button>';
      }
      h += '<button onclick="disconnectPlaidItem(\'' + esc(itemId) + '\')" style="background:transparent;border:1px solid #dc2626;color:#dc2626;padding:6px 12px;border-radius:6px;font-size:0.8rem;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Disconnect</button>';
      h += '</div>';

      h += '</div></div>';
    });

    container.innerHTML = h;
  } catch (err) {
    container.innerHTML = '<p style="color:#dc2626;">' + esc(err.message) + '</p>';
  }
}

async function connectPlaidAccount() {
  var btn = document.getElementById('connectPlaidBtn');

  // Check if this will be an extra account (over included limit)
  try {
    var itemsSnap = await MastDB.plaidItems.list();
    var allItems = itemsSnap.val() || {};
    var activeCount = Object.values(allItems).filter(function(i) { return i.status === 'active'; }).length;
    var limitSnap = await MastDB._ref('admin/config/expenseSettings/plaidAccountLimit').once('value');
    var includedLimit = limitSnap.val() || 2;
    if (activeCount >= includedLimit) {
      if (!confirm('You\'ve used your ' + includedLimit + ' included accounts.\n\nAdding another will cost 200 tokens/month. If you don\'t have enough tokens next month, this account will be automatically disconnected.\n\nContinue?')) {
        return;
      }
    }
  } catch (e) { /* proceed anyway, server will enforce */ }

  btn.disabled = true;
  btn.textContent = 'Connecting...';

  try {
    // Load Plaid Link SDK if not already loaded
    if (!plaidLinkLoaded) {
      await new Promise(function(resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        script.onload = function() { plaidLinkLoaded = true; resolve(); };
        script.onerror = function() { reject(new Error('Failed to load Plaid Link SDK')); };
        document.head.appendChild(script);
      });
    }

    // Get link token from Cloud Function
    var createLinkToken = firebase.functions().httpsCallable('createPlaidLinkToken');
    var result = await createLinkToken({ tenantId: MastDB.tenantId() });
    var linkToken = result.data.link_token;

    // Open Plaid Link
    var handler = Plaid.create({
      token: linkToken,
      onSuccess: async function(publicToken, metadata) {
        btn.textContent = 'Exchanging token...';
        try {
          var exchangeToken = firebase.functions().httpsCallable('exchangePlaidToken');
          var exchangeResult = await exchangeToken({
            tenantId: MastDB.tenantId(),
            public_token: publicToken
          });
          showToast('Connected ' + (exchangeResult.data.institutionName || 'bank account') + ' (' + exchangeResult.data.accountCount + ' accounts)');
          loadPlaidAccounts();
        } catch (err) {
          showToast('Failed to connect: ' + err.message, true);
        }
        btn.disabled = false;
        btn.textContent = 'Connect Bank Account';
      },
      onExit: function(err) {
        if (err) showToast('Plaid connection cancelled', true);
        btn.disabled = false;
        btn.textContent = 'Connect Bank Account';
      }
    });
    handler.open();
  } catch (err) {
    showToast('Failed to start Plaid connection: ' + err.message, true);
    btn.disabled = false;
    btn.textContent = 'Connect Bank Account';
  }
}

async function syncPlaidItem(itemId) {
  showToast('Syncing transactions...');
  try {
    var syncFn = firebase.functions().httpsCallable('syncPlaidTransactions');
    var result = await syncFn({ tenantId: MastDB.tenantId(), itemId: itemId });
    var d = result.data;
    showToast('Synced: ' + d.imported + ' new, ' + d.updated + ' updated, ' + d.removed + ' removed');
    // Auto-switch to transactions view to show imported expenses
    showExpensesView('transactions');
  } catch (err) {
    showToast('Sync failed: ' + err.message, true);
    loadPlaidAccounts();
  }
}

async function disconnectPlaidItem(itemId) {
  if (!confirm('Disconnect this bank account? Existing imported transactions will remain.')) return;
  try {
    var disconnectFn = firebase.functions().httpsCallable('disconnectPlaidItem');
    await disconnectFn({ tenantId: MastDB.tenantId(), itemId: itemId });
    showToast('Account disconnected');
    loadPlaidAccounts();
  } catch (err) {
    showToast('Disconnect failed: ' + err.message, true);
  }
}

// ── Expenses List ──

async function loadExpenses() {
  var listEl = document.getElementById('expTransactionsList');
  var emptyEl = document.getElementById('expEmpty');
  var summaryEl = document.getElementById('expSummaryBar');
  listEl.innerHTML = '<p style="color:var(--text-secondary, #888);">Loading expenses...</p>';
  emptyEl.style.display = 'none';

  try {
    var statusFilter = document.getElementById('expFilterStatus').value;
    var categoryFilter = document.getElementById('expFilterCategory').value;

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

    expenses.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    expensesCache = expenses;

    // Summary bar
    var total = 0;
    var unreviewedCount = 0;
    expenses.forEach(function(e) {
      total += e.amount || 0;
      if (!e.reviewed) unreviewedCount++;
    });
    summaryEl.innerHTML = '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.85rem;color:var(--text-secondary, #888);">' +
      '<span><strong>' + expenses.length + '</strong> expenses</span>' +
      '<span>Total: <strong>$' + (total / 100).toFixed(2) + '</strong></span>' +
      (unreviewedCount > 0 ? '<span style="color:#f59e0b;">' + unreviewedCount + ' unreviewed</span>' : '') +
      '</div>';

    if (expenses.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }

    renderExpensesList(expenses);
  } catch (err) {
    listEl.innerHTML = '<p style="color:#dc2626;">' + esc(err.message) + '</p>';
  }
}

function renderExpensesList(expenses) {
  var listEl = document.getElementById('expTransactionsList');
  var h = '<div style="display:flex;flex-direction:column;gap:6px;">';

  expenses.forEach(function(exp) {
    var amountStr = (exp.amount >= 0 ? '' : '-') + '$' + (Math.abs(exp.amount) / 100).toFixed(2);
    var amountColor = exp.amount >= 0 ? 'var(--text-primary, #333)' : '#16a34a';
    var reviewedBg = exp.reviewed ? 'transparent' : 'rgba(245, 158, 11, 0.08)';
    var borderLeft = exp.reviewed ? '3px solid transparent' : '3px solid #f59e0b';
    var sourceIcon = exp.source === 'plaid' ? '\uD83C\uDFE6' : exp.source === 'csv_import' ? '\uD83D\uDCC4' : '\u270D\uFE0F';
    var pendingBadge = exp.pending ? ' <span style="font-size:0.7rem;background:#f59e0b;color:white;padding:1px 5px;border-radius:3px;">pending</span>' : '';

    h += '<div style="background:' + reviewedBg + ';border-left:' + borderLeft + ';border-radius:8px;padding:10px 14px;" data-expense-id="' + esc(exp._key) + '">';
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">';

    // Left: info
    h += '<div style="flex:1;min-width:0;">';
    h += '<div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">';
    h += sourceIcon + ' ' + esc(exp.merchantName || exp.description);
    h += pendingBadge;
    h += '</div>';
    h += '<div style="font-size:0.8rem;color:var(--text-secondary, #888);margin-top:2px;">' + esc(exp.date || '');
    if (exp.description && exp.merchantName && exp.description !== exp.merchantName) {
      h += ' · ' + esc(exp.description.substring(0, 60));
    }
    h += '</div>';

    // Category + business line dropdowns (inline edit)
    h += '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">';
    h += '<select onchange="updateExpenseField(\'' + esc(exp._key) + '\', \'category\', this.value)" style="padding:3px 6px;border:1px solid var(--border-color, #ddd);border-radius:4px;font-size:0.75rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);">';
    CATEGORIES.forEach(function(cat) {
      h += '<option value="' + cat.value + '"' + (exp.category === cat.value ? ' selected' : '') + '>' + cat.label + '</option>';
    });
    h += '</select>';

    h += '<select onchange="updateExpenseField(\'' + esc(exp._key) + '\', \'businessLine\', this.value)" style="padding:3px 6px;border:1px solid var(--border-color, #ddd);border-radius:4px;font-size:0.75rem;background:var(--bg-primary, #fff);color:var(--text-primary, #333);">';
    BUSINESS_LINES.forEach(function(bl) {
      h += '<option value="' + bl.value + '"' + ((exp.businessLine || '') === bl.value ? ' selected' : '') + '>' + bl.label + '</option>';
    });
    h += '</select>';

    if (!exp.reviewed) {
      h += '<button onclick="approveExpense(\'' + esc(exp._key) + '\', this)" style="background:#16a34a;color:white;border:none;padding:3px 10px;border-radius:4px;font-size:0.75rem;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Approve</button>';
    } else {
      h += '<span style="font-size:0.7rem;color:#16a34a;padding:3px 6px;">&#10003; Reviewed</span>';
    }
    h += '</div>';

    h += '</div>';

    // Right: amount
    h += '<div style="text-align:right;flex-shrink:0;">';
    h += '<div style="font-weight:700;font-size:1rem;color:' + amountColor + ';">' + amountStr + '</div>';
    if (exp.plaidCategory) {
      h += '<div style="font-size:0.7rem;color:var(--text-secondary, #888);">' + esc(exp.plaidCategory) + '</div>';
    }
    h += '</div>';

    h += '</div></div>';
  });

  h += '</div>';
  listEl.innerHTML = h;
}

async function updateExpenseField(expenseId, field, value) {
  try {
    var updates = {};
    updates[field] = value || null;
    updates.updatedAt = new Date().toISOString();
    if (field === 'category') updates.categorySource = 'user';
    await MastDB.expenses.update(expenseId, updates);
  } catch (err) {
    showToast('Update failed: ' + err.message, true);
  }
}

async function approveExpense(expenseId, btnEl) {
  try {
    await MastDB.expenses.update(expenseId, { reviewed: true, updatedAt: new Date().toISOString() });
    if (btnEl) {
      btnEl.outerHTML = '<span style="font-size:0.7rem;color:#16a34a;padding:3px 6px;">&#10003; Reviewed</span>';
    }
    // Update border
    var row = document.querySelector('[data-expense-id="' + expenseId + '"]');
    if (row) {
      row.style.borderLeft = '3px solid transparent';
      row.style.background = 'transparent';
    }
  } catch (err) {
    showToast('Approve failed: ' + err.message, true);
  }
}

async function bulkApproveExpenses() {
  var unreviewed = expensesCache.filter(function(e) { return !e.reviewed; });
  if (unreviewed.length === 0) {
    showToast('No unreviewed expenses to approve');
    return;
  }
  if (!confirm('Approve all ' + unreviewed.length + ' visible unreviewed expenses?')) return;

  var btn = document.getElementById('bulkApproveBtn');
  btn.disabled = true;
  btn.textContent = 'Approving...';

  try {
    var updates = {};
    unreviewed.forEach(function(e) {
      updates['admin/expenses/' + e._key + '/reviewed'] = true;
      updates['admin/expenses/' + e._key + '/updatedAt'] = new Date().toISOString();
    });
    await MastDB._ref('').update(updates);
    showToast('Approved ' + unreviewed.length + ' expenses');
    loadExpenses();
  } catch (err) {
    showToast('Bulk approve failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Approve All Visible';
  }
}

function initExpenses() {
  showExpensesView('transactions');
}

// ── Window exports for onclick handlers ──
window.showExpensesView = showExpensesView;
window.connectPlaidAccount = connectPlaidAccount;
window.syncPlaidItem = syncPlaidItem;
window.disconnectPlaidItem = disconnectPlaidItem;
window.loadExpenses = loadExpenses;
window.updateExpenseField = updateExpenseField;
window.approveExpense = approveExpense;
window.bulkApproveExpenses = bulkApproveExpenses;

// ── Module registration ──
MastAdmin.registerModule('expenses', {
  routes: {
    'expenses': { tab: 'expensesTab', setup: function() { initExpenses(); } }
  }
});

})();
