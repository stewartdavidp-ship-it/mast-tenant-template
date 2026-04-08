// ============================================================
// FINANCIALS MODULE (lazy-loaded)
// ============================================================
(function() {
'use strict';

var financialsData = null;

function loadFinancials() {
  var startEl = document.getElementById('financialsStartDate');
  var endEl = document.getElementById('financialsEndDate');
  if (startEl && !startEl.value) {
    var today = new Date().toISOString().split('T')[0];
    startEl.value = today;
    endEl.value = today;
  }
}

// Load sales from Firebase cache (all processors)
async function fetchSquareSales() {
  var startDate = document.getElementById('financialsStartDate').value;
  var endDate = document.getElementById('financialsEndDate').value;
  if (!startDate) { showToast('Please select a start date.', true); return; }

  var summaryEl = document.getElementById('financialsSummary');
  var txnEl = document.getElementById('financialsTransactions');
  var emptyEl = document.getElementById('financialsEmpty');

  txnEl.innerHTML = '<p style="color:var(--text-secondary, #888);">Loading sales...</p>';
  summaryEl.style.display = 'none';
  emptyEl.style.display = 'none';

  try {
    var token = await auth.currentUser.getIdToken();
    var resp = await callCF('/salesSync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: 'read', startDate: startDate, endDate: endDate || startDate })
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Failed to load sales');

    financialsData = data;
    renderFinancials(data);

    // Show sync status per processor
    var statusEl = document.getElementById('financialsSyncStatus');
    if (statusEl && data.syncMeta) {
      var parts = [];
      Object.keys(data.syncMeta).forEach(function(proc) {
        var m = data.syncMeta[proc];
        if (m.lastSyncAt) parts.push(proc + ': ' + new Date(m.lastSyncAt).toLocaleString());
      });
      if (parts.length) {
        statusEl.style.display = '';
        statusEl.textContent = 'Last synced — ' + parts.join(' | ');
      }
    }
  } catch (err) {
    txnEl.innerHTML = '<p style="color:#dc2626;">' + esc(err.message) + '</p>';
    showToast('Failed to load sales: ' + err.message, true);
  }
}

// Pull new data from processor API → store in Firebase
async function syncSquareSales(processor) {
  processor = processor || 'square';
  var btn = document.getElementById('syncSquareBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }

  try {
    var token = await auth.currentUser.getIdToken();
    var startDate = document.getElementById('financialsStartDate').value;
    var body = { action: 'sync', processor: processor };
    if (startDate) body.startDate = startDate;
    var endDate = document.getElementById('financialsEndDate').value;
    if (endDate) body.endDate = endDate;

    var resp = await callCF('/salesSync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Sync failed');

    showToast('Synced ' + data.synced + ' transactions from ' + data.processor + '.');

    var statusEl = document.getElementById('financialsSyncStatus');
    if (statusEl) {
      statusEl.style.display = '';
      statusEl.textContent = 'Last synced ' + data.processor + ': ' + new Date(data.lastSync).toLocaleString() + ' — ' + data.synced + ' transactions';
    }

    // Reload from cache to show updated data
    if (document.getElementById('financialsStartDate').value) {
      fetchSquareSales();
    }
  } catch (err) {
    showToast('Sync failed: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync from Square'; }
  }
}

function renderFinancials(data) {
  var summaryEl = document.getElementById('financialsSummary');
  var txnEl = document.getElementById('financialsTransactions');
  var emptyEl = document.getElementById('financialsEmpty');

  if (!data.payments || data.payments.length === 0) {
    summaryEl.style.display = 'none';
    txnEl.innerHTML = '';
    emptyEl.style.display = '';
    emptyEl.textContent = 'No completed transactions found for this date range.';
    return;
  }

  emptyEl.style.display = 'none';
  summaryEl.style.display = '';

  // --- Summary cards ---
  var netRevenue = data.totalRevenue - data.totalFees;
  var h = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;">';
  h += financialCard('Revenue', '$' + (data.totalRevenue / 100).toFixed(2), '#16a34a');
  h += financialCard('Processing Fees', '-$' + (data.totalFees / 100).toFixed(2), '#dc2626');
  h += financialCard('Net', '$' + (netRevenue / 100).toFixed(2), 'var(--primary, var(--teal))');
  h += financialCard('Tips', '$' + (data.totalTips / 100).toFixed(2), '#f59e0b');
  h += financialCard('Transactions', String(data.totalPayments), 'var(--text-primary, #333)');
  h += '</div>';

  // --- Source breakdown ---
  var bySource = {};
  data.payments.forEach(function(p) {
    var src = p.orderSource || p.sourceType || 'Unknown';
    if (!bySource[src]) bySource[src] = { count: 0, total: 0 };
    bySource[src].count++;
    bySource[src].total += p.totalAmount;
  });
  var sourceKeys = Object.keys(bySource).sort(function(a, b) { return bySource[b].total - bySource[a].total; });
  if (sourceKeys.length > 1) {
    h += '<div style="margin-bottom:24px;">';
    h += '<h3 style="margin:0 0 12px 0;">By Source</h3>';
    h += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
    sourceKeys.forEach(function(src) {
      var s = bySource[src];
      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;min-width:140px;">';
      h += '<div style="font-weight:600;font-size:0.9rem;">' + esc(src) + '</div>';
      h += '<div style="font-size:1.15rem;font-weight:700;">$' + (s.total / 100).toFixed(2) + '</div>';
      h += '<div style="font-size:0.78rem;color:var(--text-secondary, #888);">' + s.count + ' txn' + (s.count !== 1 ? 's' : '') + '</div>';
      h += '</div>';
    });
    h += '</div></div>';
  }

  // --- By Processor ---
  var byProc = {};
  data.payments.forEach(function(p) {
    var proc = p.processor || 'unknown';
    if (!byProc[proc]) byProc[proc] = { count: 0, total: 0, fees: 0 };
    byProc[proc].count++;
    byProc[proc].total += p.totalAmount || 0;
    byProc[proc].fees += p.processingFee || 0;
  });
  var procKeys = Object.keys(byProc).sort(function(a, b) { return byProc[b].total - byProc[a].total; });
  if (procKeys.length > 0) {
    var procColors = { square: '#7c3aed', stripe: '#635bff', etsy: '#f1641e', manual: '#6b7280' };
    h += '<div style="margin-bottom:24px;">';
    h += '<h3 style="margin:0 0 12px 0;">By Processor</h3>';
    h += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
    procKeys.forEach(function(proc) {
      var d = byProc[proc];
      var color = procColors[proc] || '#888';
      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;min-width:140px;border-left:3px solid ' + color + ';">';
      h += '<div style="font-weight:600;font-size:0.9rem;text-transform:capitalize;">' + esc(proc) + '</div>';
      h += '<div style="font-size:1.15rem;font-weight:700;">$' + (d.total / 100).toFixed(2) + '</div>';
      h += '<div style="font-size:0.78rem;color:var(--text-secondary, #888);">' + d.count + ' txn' + (d.count !== 1 ? 's' : '') + ' · fees $' + (d.fees / 100).toFixed(2) + '</div>';
      h += '</div>';
    });
    h += '</div></div>';
  }

  // --- Payment method breakdown ---
  var byMethod = {};
  data.payments.forEach(function(p) {
    var method = p.cardBrand || p.sourceType || 'Other';
    if (!byMethod[method]) byMethod[method] = { count: 0, total: 0 };
    byMethod[method].count++;
    byMethod[method].total += p.totalAmount;
  });
  var methodKeys = Object.keys(byMethod).sort(function(a, b) { return byMethod[b].total - byMethod[a].total; });
  if (methodKeys.length > 0) {
    h += '<div style="margin-bottom:24px;">';
    h += '<h3 style="margin:0 0 12px 0;">By Payment Method</h3>';
    h += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
    methodKeys.forEach(function(m) {
      var d = byMethod[m];
      h += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:10px 16px;min-width:120px;">';
      h += '<div style="font-weight:600;font-size:0.85rem;">' + esc(m) + '</div>';
      h += '<div style="font-size:1rem;font-weight:700;">$' + (d.total / 100).toFixed(2) + '</div>';
      h += '<div style="font-size:0.78rem;color:var(--text-secondary, #888);">' + d.count + '</div>';
      h += '</div>';
    });
    h += '</div></div>';
  }

  summaryEl.innerHTML = h;

  // --- Transaction list ---
  var txnH = '<h3 style="margin:0 0 12px 0;">Transactions</h3>';
  txnH += '<div style="display:flex;flex-direction:column;gap:8px;">';
  data.payments.forEach(function(p) {
    var time = p.createdAt ? new Date(p.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    var date = p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

    txnH += '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:12px 14px;">';
    txnH += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">';
    txnH += '<div>';

    // Line items or note
    if (p.lineItems && p.lineItems.length > 0) {
      p.lineItems.forEach(function(li) {
        txnH += '<div style="font-weight:600;font-size:0.9rem;">' + esc(li.name) + (li.variationName ? ' <span style="font-weight:400;color:var(--text-secondary, #888);">(' + esc(li.variationName) + ')</span>' : '') + ' <span style="font-weight:400;color:var(--text-secondary, #888);">&times;' + esc(li.quantity) + '</span></div>';
      });
    } else if (p.note) {
      txnH += '<div style="font-weight:600;font-size:0.9rem;">' + esc(p.note) + '</div>';
    } else {
      txnH += '<div style="font-weight:600;font-size:0.9rem;">Payment</div>';
    }

    var procColors = { square: '#7c3aed', stripe: '#635bff', etsy: '#f1641e', manual: '#6b7280' };
    var procColor = procColors[p.processor] || '#888';
    txnH += '<div style="font-size:0.78rem;color:var(--text-secondary, #888);">' + date + ' ' + time;
    if (p.processor) txnH += ' <span style="font-size:0.72rem;background:' + procColor + ';color:white;padding:1px 5px;border-radius:3px;text-transform:capitalize;">' + esc(p.processor) + '</span>';
    if (p.cardBrand) txnH += ' · ' + esc(p.cardBrand);
    if (p.cardLast4) txnH += ' ••' + esc(p.cardLast4);
    if (p.orderSource) txnH += ' · ' + esc(p.orderSource);
    txnH += '</div>';
    txnH += '</div>';

    txnH += '<div style="text-align:right;">';
    txnH += '<div style="font-weight:700;font-size:1rem;">$' + (p.totalAmount / 100).toFixed(2) + '</div>';
    if (p.tipAmount > 0) txnH += '<div style="font-size:0.78rem;color:#f59e0b;">tip $' + (p.tipAmount / 100).toFixed(2) + '</div>';
    if (p.processingFee > 0) txnH += '<div style="font-size:0.78rem;color:var(--text-secondary, #888);">fee -$' + (p.processingFee / 100).toFixed(2) + '</div>';
    txnH += '</div>';

    txnH += '</div></div>';
  });
  txnH += '</div>';
  txnEl.innerHTML = txnH;
}

function financialCard(label, value, color) {
  return '<div style="background:var(--bg-secondary, #f5f5f5);border-radius:8px;padding:12px 18px;text-align:center;min-width:120px;">' +
    '<div style="font-size:1.15rem;font-weight:700;color:' + color + ';">' + value + '</div>' +
    '<div style="font-size:0.78rem;color:var(--text-secondary, #888);text-transform:uppercase;letter-spacing:0.5px;">' + label + '</div></div>';
}

// ── Window exports for onclick handlers ──
window.loadFinancials = loadFinancials;
window.fetchSquareSales = fetchSquareSales;
window.syncSquareSales = syncSquareSales;

// ── Module registration ──
MastAdmin.registerModule('financials', {
  routes: {
    'financials': { tab: 'financialsTab', setup: function() { loadFinancials(); } }
  }
});

})();
