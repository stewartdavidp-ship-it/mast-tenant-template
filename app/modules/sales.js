/**
 * Sales Module — POS, Square Payments, Sales Events, Packing Mode
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

var showingSquarePayments = false;

var EVENT_STATUS_COLORS = {
  planning: '#2563eb',
  packed: '#f59e0b',
  active: '#16a34a',
  closed: '#9ca3af'
};

function eventStatusBadgeStyle(status) {
  var bg = EVENT_STATUS_COLORS[status] || '#9ca3af';
  return 'background:' + bg + ';color:white;';
}

// ============================================================
// SALES (PoS) MANAGEMENT
// ============================================================

function loadSales() {
  if (salesLoaded) renderSales();
}

function getSalesArray() {
  var arr = [];
  Object.keys(sales).forEach(function(key) {
    var s = sales[key];
    s._key = key;
    arr.push(s);
  });
  arr.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
  return arr;
}

function formatSaleTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  var hours = d.getHours();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  var mins = d.getMinutes().toString().padStart(2, '0');
  return hours + ':' + mins + ' ' + ampm;
}

function formatSaleDate(ts) {
  if (!ts) return '';
  // Handle YYYY-MM-DD date strings (avoid UTC parsing off-by-one)
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return formatDate(ts);
  var d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function formatCents(cents) {
  if (typeof cents !== 'number') return '$0.00';
  return '$' + (cents / 100).toFixed(2);
}

function getSaleItemsLabel(sale) {
  if (!sale.items || !sale.items.length) return '0 items';
  var total = 0;
  sale.items.forEach(function(item) { total += (item.quantity || 1); });
  return total + (total === 1 ? ' item' : ' items');
}

function filterSalesByDate() {
  renderSales();
}

function renderSales() {
  var loadingEl = document.getElementById('salesLoading');
  var emptyEl = document.getElementById('salesEmpty');
  var tableWrap = document.getElementById('salesTableWrap');
  var tbody = document.getElementById('salesTableBody');
  var cardsEl = document.getElementById('salesCards');
  var countEl = document.getElementById('salesCount');
  var summaryEl = document.getElementById('salesSummary');
  var detailEl = document.getElementById('saleDetailView');

  if (loadingEl) loadingEl.style.display = 'none';
  if (detailEl) detailEl.style.display = 'none';

  var all = getSalesArray();

  // Date filter
  var dateInput = document.getElementById('salesDateFilter');
  var filterDate = dateInput ? dateInput.value : '';
  if (filterDate) {
    all = all.filter(function(s) {
      var d = new Date(s.timestamp);
      var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return ds === filterDate;
    });
  }

  // Status filter
  var statusSel = document.getElementById('salesStatusFilter');
  var statusFilter = statusSel ? statusSel.value : 'all';
  if (statusFilter !== 'all') {
    all = all.filter(function(s) { return s.status === statusFilter; });
  }

  // Summary
  var totalCash = 0, totalSquare = 0, totalAmount = 0, totalVoided = 0;
  all.forEach(function(s) {
    if (s.status === 'voided') { totalVoided++; return; }
    var amt = s.amount || 0;
    totalAmount += amt;
    if (s.paymentType === 'cash') totalCash += amt;
    else totalSquare += amt;
  });

  if (summaryEl) {
    summaryEl.innerHTML =
      '<div style="flex:1;min-width:140px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;">' +
        '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Total</div>' +
        '<div style="font-size:1.4rem;font-weight:600;font-family:Cormorant Garamond,serif;">' + formatCents(totalAmount) + '</div>' +
        '<div style="font-size:0.75rem;color:var(--warm-gray);">' + all.filter(function(s){return s.status !== 'voided';}).length + ' sales</div>' +
      '</div>' +
      '<div style="flex:1;min-width:140px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;">' +
        '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Cash</div>' +
        '<div style="font-size:1.4rem;font-weight:600;font-family:Cormorant Garamond,serif;color:var(--teal);">' + formatCents(totalCash) + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:140px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;">' +
        '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Square</div>' +
        '<div style="font-size:1.4rem;font-weight:600;font-family:Cormorant Garamond,serif;color:var(--amber);">' + formatCents(totalSquare) + '</div>' +
      '</div>' +
      (totalVoided > 0 ? '<div style="flex:1;min-width:140px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;">' +
        '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Voided</div>' +
        '<div style="font-size:1.4rem;font-weight:600;font-family:Cormorant Garamond,serif;color:var(--danger);">' + totalVoided + '</div>' +
      '</div>' : '');
  }

  if (countEl) countEl.textContent = all.length + ' sale' + (all.length !== 1 ? 's' : '');

  if (all.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    if (tableWrap) tableWrap.style.display = 'none';
    if (cardsEl) cardsEl.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (tableWrap) tableWrap.style.display = '';

  // Table rows
  var rows = '';
  all.forEach(function(s) {
    var statusClass = s.status === 'voided' ? 'color:var(--danger)' : s.status === 'reconciled' ? 'color:var(--teal)' : 'color:var(--warm-gray)';
    var itemNames = (s.items || []).map(function(i) {
      return (i.quantity > 1 ? i.quantity + 'x ' : '') + esc(i.productName || 'Unknown');
    }).join(', ');
    rows += '<tr style="cursor:pointer;" onclick="viewSaleDetail(\'' + esc(s._key) + '\')">' +
      '<td>' + formatSaleDate(s.timestamp) + ' ' + formatSaleTime(s.timestamp) + '</td>' +
      '<td title="' + esc(itemNames) + '">' + getSaleItemsLabel(s) + '</td>' +
      '<td style="text-transform:capitalize;">' + esc(s.paymentType || '-') + '</td>' +
      '<td style="font-weight:500;">' + formatCents(s.amount) + '</td>' +
      '<td><span style="' + statusClass + ';font-size:0.8rem;text-transform:capitalize;">' + esc(s.status || 'captured') + '</span></td>' +
      '<td>' +
        (s.status === 'captured' ? '<button class="btn btn-small" onclick="event.stopPropagation();reconcileSale(\'' + esc(s._key) + '\')" style="font-size:0.7rem;padding:3px 8px;">Reconcile</button> ' : '') +
        (s.status !== 'voided' ? '<button class="btn btn-small btn-danger" onclick="event.stopPropagation();voidSale(\'' + esc(s._key) + '\')" style="font-size:0.7rem;padding:3px 8px;">Void</button>' : '') +
      '</td>' +
    '</tr>';
  });
  if (tbody) tbody.innerHTML = rows;

  // Mobile cards
  var cards = '';
  all.forEach(function(s) {
    var statusColor = s.status === 'voided' ? 'var(--danger)' : s.status === 'reconciled' ? 'var(--teal)' : 'var(--warm-gray)';
    var itemNames = (s.items || []).map(function(i) {
      return (i.quantity > 1 ? i.quantity + 'x ' : '') + esc(i.productName || 'Unknown');
    }).join(', ');
    cards += '<div class="order-card" onclick="viewSaleDetail(\'' + esc(s._key) + '\')" style="cursor:pointer;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span style="font-weight:500;">' + formatCents(s.amount) + '</span>' +
        '<span style="font-size:0.75rem;color:' + statusColor + ';text-transform:capitalize;">' + esc(s.status || 'captured') + '</span>' +
      '</div>' +
      '<div style="font-size:0.8rem;color:var(--warm-gray);margin-top:4px;">' + formatSaleDate(s.timestamp) + ' ' + formatSaleTime(s.timestamp) + '</div>' +
      '<div style="font-size:0.8rem;margin-top:4px;">' + esc(itemNames || 'No items') + '</div>' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);margin-top:4px;text-transform:capitalize;">' + esc(s.paymentType || '-') + '</div>' +
    '</div>';
  });
  if (cardsEl) cardsEl.innerHTML = cards;
}

function viewSaleDetail(saleId) {
  var s = sales[saleId];
  if (!s) return;
  selectedSaleId = saleId;

  var detailEl = document.getElementById('saleDetailView');
  var tableWrap = document.getElementById('salesTableWrap');
  var cardsEl = document.getElementById('salesCards');
  var summaryEl = document.getElementById('salesSummary');

  if (tableWrap) tableWrap.style.display = 'none';
  if (cardsEl) cardsEl.style.display = 'none';
  if (summaryEl) summaryEl.style.display = 'none';

  var itemsHtml = '';
  (s.items || []).forEach(function(item) {
    itemsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--cream-dark);">' +
      '<div>' +
        '<div style="font-weight:500;">' + esc(item.productName || 'Unknown') + '</div>' +
        '<div style="font-size:0.8rem;color:var(--warm-gray);">Qty: ' + (item.quantity || 1) +
          (item.confidence ? ' &middot; Confidence: ' + Math.round(item.confidence * 100) + '%' : '') +
        '</div>' +
      '</div>' +
      '<div style="font-weight:500;">' + (item.priceCents ? formatCents(item.priceCents * (item.quantity || 1)) : '-') + '</div>' +
    '</div>';
  });

  var statusColor = s.status === 'voided' ? 'var(--danger)' : s.status === 'reconciled' ? 'var(--teal)' : 'var(--warm-gray)';

  detailEl.innerHTML =
    '<button class="detail-back" onclick="closeSaleDetail()">&larr; Back to Sales</button>' +
    '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:20px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<h3 style="margin:0;">Sale Detail</h3>' +
        '<span style="font-size:0.85rem;color:' + statusColor + ';text-transform:capitalize;font-weight:500;">' + esc(s.status || 'captured') + '</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px;">' +
        '<div><div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Date/Time</div><div>' + formatSaleDate(s.timestamp) + ' ' + formatSaleTime(s.timestamp) + '</div></div>' +
        '<div><div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Payment</div><div style="text-transform:capitalize;">' + esc(s.paymentType || '-') + '</div></div>' +
        '<div><div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Amount</div><div style="font-weight:600;font-size:1.2rem;">' + formatCents(s.amount) + '</div></div>' +
        (s.notes ? '<div><div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Notes</div><div>' + esc(s.notes) + '</div></div>' : '') +
      '</div>' +
      '<h4 style="margin:12px 0 8px;">Items</h4>' +
      (itemsHtml || '<div style="color:var(--warm-gray);">No items recorded</div>') +
      '<div style="display:flex;gap:8px;margin-top:20px;">' +
        (s.status === 'captured' ? '<button class="btn" onclick="reconcileSale(\'' + esc(saleId) + '\')" style="font-size:0.85rem;">Mark Reconciled</button>' : '') +
        (s.status !== 'voided' ? '<button class="btn btn-danger" onclick="voidSale(\'' + esc(saleId) + '\')" style="font-size:0.85rem;">Void Sale</button>' : '') +
      '</div>' +
    '</div>';

  detailEl.style.display = '';
}

function closeSaleDetail() {
  selectedSaleId = null;
  var detailEl = document.getElementById('saleDetailView');
  var tableWrap = document.getElementById('salesTableWrap');
  var cardsEl = document.getElementById('salesCards');
  var summaryEl = document.getElementById('salesSummary');
  if (detailEl) detailEl.style.display = 'none';
  if (summaryEl) summaryEl.style.display = '';
  renderSales();
  if (tableWrap) tableWrap.style.display = '';
  if (cardsEl) cardsEl.style.display = '';
}

async function reconcileSale(saleId) {
  if (!confirm('Mark this sale as reconciled?')) return;
  try {
    await MastDB.sales.ref(saleId).child('status').set('reconciled');
    await writeAudit('update', 'pos', saleId);
    showToast('Sale reconciled.');
    if (selectedSaleId === saleId) viewSaleDetail(saleId);
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

async function voidSale(saleId) {
  if (!confirm('Void this sale? Inventory will NOT be restored automatically.')) return;
  try {
    await MastDB.sales.ref(saleId).child('status').set('voided');
    await writeAudit('update', 'pos', saleId);
    showToast('Sale voided.');
    if (selectedSaleId === saleId) viewSaleDetail(saleId);
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

// ============================================================
// SQUARE PAYMENTS VIEW
// ============================================================

function toggleSquarePayments() {
  showingSquarePayments = !showingSquarePayments;
  var listView = document.getElementById('salesListView');
  var sqView = document.getElementById('squarePaymentsView');
  var toggleBtn = document.getElementById('squarePaymentsToggle');
  var filterControls = document.getElementById('salesFilterControls');
  var titleEl = document.getElementById('salesViewTitle');
  var countEl = document.getElementById('salesCount');

  if (showingSquarePayments) {
    listView.style.display = 'none';
    sqView.style.display = '';
    toggleBtn.textContent = '\u2190 Back to Sales';
    toggleBtn.style.background = 'var(--warm-gray)';
    filterControls.style.display = 'none';
    titleEl.textContent = 'Square Payments';
    countEl.textContent = '';
    renderSquarePayments();
  } else {
    listView.style.display = '';
    sqView.style.display = 'none';
    toggleBtn.textContent = '\uD83D\uDCB3 Square Payments';
    toggleBtn.style.background = 'var(--teal)';
    filterControls.style.display = 'flex';
    titleEl.textContent = 'Sales';
    renderSales();
  }
}

function getSquarePaymentsArray() {
  var arr = [];
  Object.keys(squarePayments).forEach(function(key) {
    var p = squarePayments[key];
    p._key = key;
    arr.push(p);
  });
  arr.sort(function(a, b) {
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  return arr;
}

function renderSquarePayments() {
  var emptyEl = document.getElementById('squarePaymentsEmpty');
  var tableWrap = document.getElementById('squarePaymentsTableWrap');
  var tbody = document.getElementById('squarePaymentsTableBody');
  var cardsEl = document.getElementById('squarePaymentsCards');
  var summaryEl = document.getElementById('squarePaymentsSummary');
  var filter = document.getElementById('squarePaymentsFilter').value;

  var all = getSquarePaymentsArray();
  var filtered;
  if (filter === 'unmatched') {
    filtered = all.filter(function(p) { return !p.matchedSaleId; });
  } else if (filter === 'matched') {
    filtered = all.filter(function(p) { return !!p.matchedSaleId; });
  } else {
    filtered = all;
  }

  // Summary stats
  var totalCount = all.length;
  var unmatchedCount = all.filter(function(p) { return !p.matchedSaleId; }).length;
  var matchedCount = totalCount - unmatchedCount;
  var unmatchedAmount = all.filter(function(p) { return !p.matchedSaleId; }).reduce(function(sum, p) { return sum + (p.amount || 0); }, 0);

  summaryEl.innerHTML =
    '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;min-width:120px;">' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Total</div>' +
      '<div style="font-size:1.3rem;font-weight:600;">' + totalCount + '</div>' +
    '</div>' +
    '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;min-width:120px;">' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Matched</div>' +
      '<div style="font-size:1.3rem;font-weight:600;color:var(--teal);">' + matchedCount + '</div>' +
    '</div>' +
    '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;min-width:120px;">' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Unmatched</div>' +
      '<div style="font-size:1.3rem;font-weight:600;color:' + (unmatchedCount > 0 ? '#FF9800' : 'var(--teal)') + ';">' + unmatchedCount + '</div>' +
    '</div>' +
    (unmatchedAmount > 0 ? '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;min-width:120px;">' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Unmatched $</div>' +
      '<div style="font-size:1.3rem;font-weight:600;color:#FF9800;">' + formatCents(unmatchedAmount) + '</div>' +
    '</div>' : '');

  if (filtered.length === 0) {
    emptyEl.style.display = '';
    emptyEl.querySelector('p').textContent = filter === 'unmatched' ? 'All Square payments have been matched to sales.' : 'No Square payments found.';
    tableWrap.style.display = 'none';
    cardsEl.innerHTML = '';
    return;
  }

  emptyEl.style.display = 'none';

  // Desktop table
  var rows = '';
  filtered.forEach(function(p) {
    var isMatched = !!p.matchedSaleId;
    var statusColor = isMatched ? 'var(--teal)' : '#FF9800';
    var statusText = isMatched ? 'Matched' : 'Unmatched';
    var timeStr = p.createdAt ? new Date(p.createdAt).toLocaleString() : '-';
    var sourceLabel = (p.sourceType || 'unknown').replace(/_/g, ' ');

    rows += '<tr>' +
      '<td>' + timeStr + '</td>' +
      '<td style="font-weight:600;">' + formatCents(p.amount || 0) + '</td>' +
      '<td style="text-transform:capitalize;font-size:0.85rem;">' + esc(sourceLabel) + '</td>' +
      '<td><span style="color:' + statusColor + ';font-weight:500;">' + statusText + '</span></td>' +
      '<td>' + (isMatched ? '<span style="font-family:monospace;font-size:0.78rem;">' + esc((p.matchedSaleId || '').slice(-8)) + '</span>' : '-') + '</td>' +
      '<td>' +
        (!isMatched ? '<button class="btn btn-small" onclick="openManualMatchModal(\'' + esc(p._key) + '\')" style="font-size:0.7rem;padding:3px 8px;">Match</button>' : '') +
        (p.receiptUrl ? ' <a href="' + esc(p.receiptUrl) + '" target="_blank" style="font-size:0.7rem;color:var(--teal);">Receipt</a>' : '') +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = rows;
  tableWrap.style.display = '';

  // Mobile cards
  var cards = '';
  filtered.forEach(function(p) {
    var isMatched = !!p.matchedSaleId;
    var statusColor = isMatched ? 'var(--teal)' : '#FF9800';
    var statusText = isMatched ? 'Matched' : 'Unmatched';
    var timeStr = p.createdAt ? new Date(p.createdAt).toLocaleString() : '-';
    var sourceLabel = (p.sourceType || 'unknown').replace(/_/g, ' ');

    cards += '<div class="order-card" style="border-left:3px solid ' + statusColor + ';">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span style="font-weight:600;font-size:1.1rem;">' + formatCents(p.amount || 0) + '</span>' +
        '<span style="color:' + statusColor + ';font-weight:500;font-size:0.85rem;">' + statusText + '</span>' +
      '</div>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">' + timeStr + '</div>' +
      '<div style="font-size:0.82rem;color:var(--warm-gray-light);margin-top:2px;text-transform:capitalize;">' + esc(sourceLabel) + '</div>' +
      (isMatched ? '<div style="font-size:0.8rem;margin-top:4px;">Matched: <span style="font-family:monospace;">' + esc((p.matchedSaleId || '').slice(-8)) + '</span></div>' : '') +
      '<div style="margin-top:8px;display:flex;gap:8px;">' +
        (!isMatched ? '<button class="btn btn-small" onclick="openManualMatchModal(\'' + esc(p._key) + '\')" style="font-size:0.8rem;padding:4px 12px;">Match to Sale</button>' : '') +
        (p.receiptUrl ? '<a href="' + esc(p.receiptUrl) + '" target="_blank" class="btn btn-small" style="font-size:0.8rem;padding:4px 12px;text-decoration:none;">Receipt</a>' : '') +
      '</div>' +
    '</div>';
  });
  cardsEl.innerHTML = cards;
}

function openManualMatchModal(paymentKey) {
  var payment = squarePayments[paymentKey];
  if (!payment) return;

  // Find unreconciled sales within a reasonable time window
  var paymentTime = new Date(payment.createdAt).getTime();
  var candidates = [];
  Object.keys(sales).forEach(function(saleId) {
    var s = sales[saleId];
    if (s.squarePaymentId) return; // already matched
    if (s.status === 'voided') return;
    if (s.paymentType && s.paymentType !== 'square') return;
    var saleTime = new Date(s.timestamp || s.createdAt).getTime();
    var deltaMin = Math.abs(saleTime - paymentTime) / 60000;
    candidates.push({
      saleId: saleId,
      sale: s,
      deltaMin: deltaMin,
      amount: s.amount || 0
    });
  });

  // Sort by time proximity
  candidates.sort(function(a, b) { return a.deltaMin - b.deltaMin; });

  // Limit to top 20
  candidates = candidates.slice(0, 20);

  var optionsHtml = '';
  if (candidates.length === 0) {
    optionsHtml = '<p style="color:var(--warm-gray);">No candidate sales found. Try creating a sale first.</p>';
  } else {
    candidates.forEach(function(c) {
      var s = c.sale;
      var items = (s.items || []).map(function(i) { return i.productName; }).join(', ');
      var amountMatch = c.amount === (payment.amount || 0);
      var timeStr = s.timestamp ? new Date(s.timestamp).toLocaleString() : '-';
      var deltaStr = c.deltaMin < 1 ? '<1 min' : Math.round(c.deltaMin) + ' min';

      optionsHtml += '<div onclick="executeManualMatch(\'' + esc(paymentKey) + '\', \'' + esc(c.saleId) + '\')" ' +
        'style="padding:12px;border:1px solid ' + (amountMatch ? 'var(--teal)' : 'var(--cream-dark)') + ';border-radius:8px;cursor:pointer;margin-bottom:8px;' +
        (amountMatch ? 'background:rgba(0,150,136,0.05);' : '') + '" ' +
        'onmouseover="this.style.background=\'var(--cream)\'" onmouseout="this.style.background=\'' + (amountMatch ? 'rgba(0,150,136,0.05)' : 'white') + '\'">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="font-weight:600;">' + formatCents(c.amount) + '</span>' +
          '<span style="font-size:0.8rem;color:var(--warm-gray);">' + deltaStr + ' apart</span>' +
        '</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:2px;">' + timeStr + '</div>' +
        '<div style="font-size:0.85rem;margin-top:2px;">' + esc(items || 'No items recorded') + '</div>' +
        (amountMatch ? '<div style="font-size:0.75rem;color:var(--teal);margin-top:4px;">\u2713 Amount matches</div>' : '<div style="font-size:0.75rem;color:#FF9800;margin-top:4px;">\u26A0 Amount mismatch (sale: ' + formatCents(c.amount) + ', payment: ' + formatCents(payment.amount || 0) + ')</div>') +
      '</div>';
    });
  }

  var modal = document.createElement('div');
  modal.id = 'manualMatchModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
  modal.innerHTML =
    '<div style="background:var(--cream);border-radius:12px;padding:24px;max-width:500px;width:100%;max-height:80vh;overflow-y:auto;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<h3 style="margin:0;">Match Square Payment</h3>' +
        '<button onclick="document.getElementById(\'manualMatchModal\').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;">\u2715</button>' +
      '</div>' +
      '<div style="background:var(--cream);border-radius:8px;padding:12px;margin-bottom:16px;">' +
        '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Square Payment</div>' +
        '<div style="font-weight:600;font-size:1.1rem;">' + formatCents(payment.amount || 0) + '</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);">' + (payment.createdAt ? new Date(payment.createdAt).toLocaleString() : '-') + '</div>' +
      '</div>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:8px;">Select a sale to match:</div>' +
      optionsHtml +
    '</div>';
  document.body.appendChild(modal);
}

async function executeManualMatch(paymentKey, saleId) {
  var payment = squarePayments[paymentKey];
  if (!payment || !saleId) return;

  try {
    var updates = {};
    // Update sale with Square payment info — Square amount is authoritative
    updates['admin/sales/' + saleId + '/squarePaymentId'] = payment.paymentId || paymentKey;
    updates['admin/sales/' + saleId + '/amount'] = payment.amount || 0;
    updates['admin/sales/' + saleId + '/status'] = 'reconciled';
    // Update payment with matched sale
    updates['admin/square-payments/' + paymentKey + '/matchedSaleId'] = saleId;

    await MastDB._multiUpdate(updates);
    showToast('Payment matched to sale.');
    var modal = document.getElementById('manualMatchModal');
    if (modal) modal.remove();
    renderSquarePayments();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

// ============================================================
// SALES EVENTS SYSTEM
// ============================================================

function loadSalesEvents() {
  if (salesEventsLoaded) renderSalesEvents();
}

function getSalesEventsArray() {
  var arr = [];
  Object.keys(salesEventsData).forEach(function(key) {
    var ev = salesEventsData[key];
    ev._key = key;
    arr.push(ev);
  });
  arr.sort(function(a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });
  return arr;
}

function getEventAllocationsStats(ev) {
  var totalPacked = 0, totalSold = 0, productCount = 0;
  if (ev.allocations) {
    Object.keys(ev.allocations).forEach(function(pid) {
      var alloc = ev.allocations[pid];
      totalPacked += (alloc.quantity || 0);
      totalSold += (alloc.sold || 0);
      productCount++;
    });
  }
  return { totalPacked: totalPacked, totalSold: totalSold, productCount: productCount };
}

function renderSalesEvents() {
  var loadingEl = document.getElementById('salesEventsLoading');
  var emptyEl = document.getElementById('salesEventsEmpty');
  var tableWrap = document.getElementById('salesEventsTableWrap');
  var tbody = document.getElementById('salesEventsTableBody');
  var cardsEl = document.getElementById('salesEventsCards');
  var countEl = document.getElementById('salesEventsCount');
  var detailEl = document.getElementById('salesEventDetailView');
  if (!loadingEl) return;

  loadingEl.style.display = 'none';
  if (detailEl && detailEl.style.display !== 'none') return;

  var arr = getSalesEventsArray();
  var statusFilter = document.getElementById('salesEventsStatusFilter').value;
  if (statusFilter !== 'all') {
    arr = arr.filter(function(ev) { return ev.status === statusFilter; });
  }

  countEl.textContent = arr.length + ' event' + (arr.length !== 1 ? 's' : '');

  if (arr.length === 0) {
    emptyEl.style.display = '';
    tableWrap.style.display = 'none';
    cardsEl.innerHTML = '';
    return;
  }

  emptyEl.style.display = 'none';
  tableWrap.style.display = '';

  var rows = '';
  var cards = '';
  arr.forEach(function(ev) {
    var stats = getEventAllocationsStats(ev);
    var statusColor = EVENT_STATUS_COLORS[ev.status] || '#9E9E9E';
    var sellThrough = stats.totalPacked > 0 ? Math.round(stats.totalSold / stats.totalPacked * 100) + '%' : '\u2014';

    rows += '<tr style="cursor:pointer;" onclick="viewSalesEventDetail(\'' + ev._key + '\')">' +
      '<td style="font-weight:600;">' + (ev.name || 'Unnamed') + '</td>' +
      '<td>' + formatSaleDate(ev.date || ev.createdAt) + '</td>' +
      '<td>' + (ev.location || '\u2014') + '</td>' +
      '<td>' + stats.totalPacked + ' (' + stats.productCount + ' products)</td>' +
      '<td>' + stats.totalSold + (stats.totalPacked > 0 ? ' (' + sellThrough + ')' : '') + '</td>' +
      '<td><span class="status-badge" style="' + eventStatusBadgeStyle(ev.status) + '">' + ev.status + '</span></td>' +
      '</tr>';

    cards += '<div class="order-card" onclick="viewSalesEventDetail(\'' + ev._key + '\')">' +
      '<div class="order-card-header">' +
        '<span class="order-card-id" style="font-weight:600;">' + (ev.name || 'Unnamed') + '</span>' +
        '<span class="status-badge" style="' + eventStatusBadgeStyle(ev.status) + '">' + ev.status + '</span>' +
      '</div>' +
      '<div class="order-card-details">' +
        '<span>\uD83D\uDCC5 ' + formatSaleDate(ev.date || ev.createdAt) + '</span>' +
        (ev.location ? '<span>\uD83D\uDCCD ' + ev.location + '</span>' : '') +
        '<span>\uD83D\uDCE6 ' + stats.totalPacked + ' packed \u00B7 ' + stats.totalSold + ' sold</span>' +
      '</div>' +
    '</div>';
  });

  tbody.innerHTML = rows;
  cardsEl.innerHTML = cards;
}

// === Create / Edit Event ===

function openCreateEventModal(eventId) {
  editingEventId = eventId || null;
  document.getElementById('eventModalTitle').textContent = eventId ? 'Edit Event' : 'Create Event';
  document.getElementById('saveEventBtn').textContent = eventId ? 'Save' : 'Create Event';

  if (eventId && salesEventsData[eventId]) {
    var ev = salesEventsData[eventId];
    document.getElementById('eventNameInput').value = ev.name || '';
    document.getElementById('eventDateInput').value = ev.date || '';
    document.getElementById('eventLocationInput').value = ev.location || '';
    document.getElementById('eventNotesInput').value = ev.notes || '';
  } else {
    document.getElementById('eventNameInput').value = '';
    document.getElementById('eventDateInput').value = '';
    document.getElementById('eventLocationInput').value = '';
    document.getElementById('eventNotesInput').value = '';
  }

  document.getElementById('createEventModal').style.display = 'flex';
}

function closeCreateEventModal() {
  document.getElementById('createEventModal').style.display = 'none';
  editingEventId = null;
}

async function saveEvent() {
  var name = document.getElementById('eventNameInput').value.trim();
  var date = document.getElementById('eventDateInput').value;
  var location = document.getElementById('eventLocationInput').value.trim();
  var notes = document.getElementById('eventNotesInput').value.trim();

  if (!name) { showToast('Event name is required', true); return; }
  if (!date) { showToast('Event date is required', true); return; }

  var btn = document.getElementById('saveEventBtn');
  btn.disabled = true;

  try {
    var now = new Date().toISOString();
    if (editingEventId) {
      await MastDB.salesEvents.ref(editingEventId).update({
        name: name, date: date, location: location || null, notes: notes || null, updatedAt: now
      });
      await writeAudit('update', 'salesEvents', editingEventId);
      showToast('Event updated.');
    } else {
      var newRef = MastDB.salesEvents.ref().push();
      await newRef.set({
        eventId: newRef.key, name: name, date: date, location: location || null,
        status: 'planning', allocations: null,
        createdAt: now, updatedAt: now, closedAt: null, notes: notes || null
      });
      await writeAudit('create', 'salesEvents', newRef.key);
      // Auto-create an inventory location for this event
      createEventLocation(newRef.key, name);
      showToast('Event created!');
    }
    closeCreateEventModal();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  } finally {
    btn.disabled = false;
  }
}

// === Event Detail View ===

function viewSalesEventDetail(eventId) {
  selectedSalesEventId = eventId;
  var ev = salesEventsData[eventId];
  if (!ev) return;

  var tableWrap = document.getElementById('salesEventsTableWrap');
  var cardsEl = document.getElementById('salesEventsCards');
  var emptyEl = document.getElementById('salesEventsEmpty');
  var detailEl = document.getElementById('salesEventDetailView');
  tableWrap.style.display = 'none';
  cardsEl.style.display = 'none';
  emptyEl.style.display = 'none';
  detailEl.style.display = '';

  renderSalesEventDetail(eventId);
}

function renderSalesEventDetail(eventId) {
  var ev = salesEventsData[eventId];
  if (!ev) return;
  var detailEl = document.getElementById('salesEventDetailView');
  var stats = getEventAllocationsStats(ev);
  var statusColor = EVENT_STATUS_COLORS[ev.status] || '#9E9E9E';
  var sellThrough = stats.totalPacked > 0 ? Math.round(stats.totalSold / stats.totalPacked * 100) : 0;

  // Get event-linked sales
  var eventSales = [];
  var eventRevenue = 0;
  Object.keys(sales).forEach(function(k) {
    if (sales[k].eventId === eventId && sales[k].status !== 'voided') {
      eventSales.push(sales[k]);
      eventRevenue += (sales[k].amount || 0);
    }
  });

  var html = '<button class="detail-back" onclick="closeSalesEventDetail()">&larr; Back to Events</button>';

  // Header
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px;">' +
    '<div>' +
      '<h2 style="margin:0 0 4px;">' + (ev.name || 'Unnamed Event') + '</h2>' +
      '<div style="color:var(--warm-gray);font-size:0.9rem;">' +
        '\uD83D\uDCC5 ' + formatSaleDate(ev.date || ev.createdAt) +
        (ev.location ? ' \u00B7 \uD83D\uDCCD ' + ev.location : '') +
      '</div>' +
    '</div>' +
    '<span class="status-badge" style="' + eventStatusBadgeStyle(ev.status) + 'padding:4px 12px;">' + ev.status + '</span>' +
  '</div>';

  // Summary cards
  html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">' +
    '<div style="background:var(--cream);border-radius:8px;padding:12px 16px;flex:1;min-width:120px;">' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Packed</div>' +
      '<div style="font-size:1.5rem;font-weight:700;">' + stats.totalPacked + '</div>' +
      '<div style="font-size:0.8rem;color:var(--warm-gray);">' + stats.productCount + ' products</div>' +
    '</div>' +
    '<div style="background:var(--cream);border-radius:8px;padding:12px 16px;flex:1;min-width:120px;">' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Sold</div>' +
      '<div style="font-size:1.5rem;font-weight:700;">' + stats.totalSold + '</div>' +
      '<div style="font-size:0.8rem;color:var(--warm-gray);">' + sellThrough + '% sell-through</div>' +
    '</div>' +
    '<div style="background:var(--cream);border-radius:8px;padding:12px 16px;flex:1;min-width:120px;">' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Revenue</div>' +
      '<div style="font-size:1.5rem;font-weight:700;">' + formatCents(eventRevenue) + '</div>' +
      '<div style="font-size:0.8rem;color:var(--warm-gray);">' + eventSales.length + ' sale' + (eventSales.length !== 1 ? 's' : '') + '</div>' +
    '</div>' +
    '<div style="background:var(--cream);border-radius:8px;padding:12px 16px;flex:1;min-width:120px;">' +
      '<div style="font-size:0.75rem;color:var(--warm-gray);text-transform:uppercase;">Remaining</div>' +
      '<div style="font-size:1.5rem;font-weight:700;">' + (stats.totalPacked - stats.totalSold) + '</div>' +
      '<div style="font-size:0.8rem;color:var(--warm-gray);">unsold items</div>' +
    '</div>' +
  '</div>';

  // Action buttons based on status
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">';
  if (ev.status === 'planning') {
    html += '<button class="btn btn-primary" onclick="startPackingMode(\'' + eventId + '\')">\uD83D\uDCE6 Start Packing</button>';
    html += '<button class="btn btn-secondary" onclick="openCreateEventModal(\'' + eventId + '\')">\u270F\uFE0F Edit</button>';
    html += '<button class="btn btn-danger btn-small" onclick="deleteEvent(\'' + eventId + '\')">\uD83D\uDDD1\uFE0F Delete</button>';
  } else if (ev.status === 'packed') {
    html += '<button class="btn btn-primary" onclick="startPackingMode(\'' + eventId + '\')">\uD83D\uDCE6 Add More Items</button>';
    html += '<button class="btn btn-success" onclick="startFairMode(\'' + eventId + '\')">\uD83C\uDFEA Start Fair</button>';
    html += '<button class="btn btn-secondary" onclick="revertToPlanningStatus(\'' + eventId + '\')">\u21A9\uFE0F Back to Planning</button>';
  } else if (ev.status === 'active') {
    html += '<button class="btn btn-primary" onclick="window.open(\'../pos/?eventId=' + eventId + '\', \'_blank\')">\uD83D\uDCB0 Open PoS</button>';
    html += '<button class="btn btn-primary" onclick="startPackingMode(\'' + eventId + '\')">\uD83D\uDCE6 Add More Items</button>';
    html += '<button class="btn btn-secondary" onclick="showManualSaleModal(\'' + eventId + '\')" title="Record a cash or offline sale that wasn\'t captured through the PoS">+ Manual Sale</button>';
    html += '<button class="btn btn-danger" onclick="closeEvent(\'' + eventId + '\')">\uD83C\uDFC1 Close Event</button>';
  } else if (ev.status === 'closed') {
    html += '<button class="btn btn-secondary" onclick="showManualSaleModal(\'' + eventId + '\')" title="Record a missed sale (e.g. cash sale not captured during the event)">+ Manual Sale</button>';
    html += '<button class="btn btn-secondary" onclick="openCreateEventModal(\'' + eventId + '\')">\u270F\uFE0F Edit Details</button>';
  }
  html += '</div>';

  // Allocations table
  html += '<h3 style="margin:0 0 12px;">Packed Items</h3>';
  if (!ev.allocations || Object.keys(ev.allocations).length === 0) {
    html += '<div style="text-align:center;padding:24px;color:var(--warm-gray);background:var(--cream);border-radius:8px;">' +
      '<p>No items packed yet.</p>' +
      (ev.status === 'planning' ? '<button class="btn btn-primary" onclick="startPackingMode(\'' + eventId + '\')">Start Packing</button>' : '') +
    '</div>';
  } else {
    html += '<div class="orders-table data-table"><table><thead><tr>' +
      '<th>Product</th><th>Packed</th><th>Sold</th><th>Remaining</th>' +
      (ev.status !== 'closed' ? '<th>Actions</th>' : '<th>Sell-Through</th>') +
    '</tr></thead><tbody>';

    Object.keys(ev.allocations).forEach(function(pid) {
      var alloc = ev.allocations[pid];
      var remaining = (alloc.quantity || 0) - (alloc.sold || 0);
      var prodName = alloc.productName || pid;
      var st = alloc.quantity > 0 ? Math.round((alloc.sold || 0) / alloc.quantity * 100) + '%' : '\u2014';

      html += '<tr>' +
        '<td style="font-weight:600;">' + prodName + '</td>' +
        '<td>' + (alloc.quantity || 0) + '</td>' +
        '<td>' + (alloc.sold || 0) + '</td>' +
        '<td>' + remaining + '</td>';

      if (ev.status !== 'closed') {
        html += '<td>' +
          '<button class="btn btn-secondary" style="font-size:0.75rem;padding:2px 8px;" onclick="adjustAllocation(\'' + eventId + '\',\'' + pid + '\', 1)">+1</button> ' +
          '<button class="btn btn-secondary" style="font-size:0.75rem;padding:2px 8px;" onclick="adjustAllocation(\'' + eventId + '\',\'' + pid + '\', -1)">-1</button> ' +
          '<button class="btn btn-secondary" style="font-size:0.75rem;padding:2px 8px;color:#E53935;" onclick="removeAllocation(\'' + eventId + '\',\'' + pid + '\')">\u2715</button>' +
        '</td>';
      } else {
        html += '<td>' + st + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  // Event sales list
  if (eventSales.length > 0) {
    html += '<h3 style="margin:20px 0 12px;">Event Sales</h3>';
    html += '<div class="orders-table data-table"><table><thead><tr>' +
      '<th>Time</th><th>Items</th><th>Payment</th><th>Amount</th>' +
    '</tr></thead><tbody>';
    eventSales.sort(function(a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });
    eventSales.forEach(function(sale) {
      html += '<tr onclick="switchTab(\'sales\'); viewSaleDetail(\'' + (sale.saleId || sale._key) + '\')" style="cursor:pointer;">' +
        '<td>' + formatSaleTime(sale.timestamp) + '</td>' +
        '<td>' + getSaleItemsLabel(sale) + '</td>' +
        '<td style="text-transform:capitalize;">' + (sale.paymentType || '\u2014') + '</td>' +
        '<td style="font-weight:600;">' + formatCents(sale.amount) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }

  // Notes
  if (ev.notes) {
    html += '<div style="margin-top:20px;padding:12px 16px;background:var(--cream);border-radius:8px;">' +
      '<strong>Notes:</strong> ' + ev.notes +
    '</div>';
  }

  detailEl.innerHTML = html;
}

function closeSalesEventDetail() {
  selectedSalesEventId = null;
  var detailEl = document.getElementById('salesEventDetailView');
  detailEl.style.display = 'none';
  var cardsEl = document.getElementById('salesEventsCards');
  cardsEl.style.display = '';
  renderSalesEvents();
}

// === Event Status Transitions ===

async function startFairMode(eventId) {
  if (!confirm('Start fair mode? The PoS will link sales to this event.')) return;
  try {
    await MastDB.salesEvents.ref(eventId).update({
      status: 'active', updatedAt: new Date().toISOString()
    });
    await writeAudit('update', 'salesEvents', eventId);
    activeEventId = eventId;
    showToast('Fair mode activated! Sales will be linked to this event.');
    emitTestingEvent('startFairMode', {});
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

async function revertToPlanningStatus(eventId) {
  try {
    await MastDB.salesEvents.ref(eventId).update({
      status: 'planning', updatedAt: new Date().toISOString()
    });
    await writeAudit('update', 'salesEvents', eventId);
    showToast('Event reverted to planning.');
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

async function closeEvent(eventId) {
  var ev = salesEventsData[eventId];
  if (!ev) return;
  var stats = getEventAllocationsStats(ev);
  var unsoldCount = stats.totalPacked - stats.totalSold;
  if (!confirm('Close this event?\n\n' + stats.totalSold + ' of ' + stats.totalPacked + ' items sold.' + (unsoldCount > 0 ? '\n' + unsoldCount + ' unsold items will be returned to their source location.' : ''))) return;
  try {
    await MastDB.salesEvents.ref(eventId).update({
      status: 'closed', closedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    await writeAudit('update', 'salesEvents', eventId);
    if (activeEventId === eventId) activeEventId = null;

    // Move unsold items back to source locations
    var eventLocId = getEventLocation(eventId);
    if (eventLocId && ev.allocations) {
      var returnHomeId = getHomeLocationId();
      Object.keys(ev.allocations).forEach(function(pid) {
        var alloc = ev.allocations[pid];
        var unsold = (alloc.quantity || 0) - (alloc.sold || 0);
        if (unsold > 0) {
          var returnTo = alloc.sourceLocationId || returnHomeId;
          if (returnTo && eventLocId) {
            moveInventory(pid, '_default', eventLocId, returnTo, unsold).catch(function() { /* best-effort */ });
          }
        }
      });
    }

    // Archive the event location
    if (eventLocId) {
      MastDB.locations.ref(eventLocId).update({ status: 'archived', updatedAt: new Date().toISOString() }).then(function() {
        writeAudit('update', 'locations', eventLocId);
      }).catch(function() {});
    }

    showToast('Event closed.' + (unsoldCount > 0 ? ' ' + unsoldCount + ' items returned.' : ''));
    emitTestingEvent('closeEvent', {});
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

// === Offline Sale Reconciliation ===

function showManualSaleModal(eventId) {
  var ev = salesEventsData[eventId];
  if (!ev || !ev.allocations) {
    showToast('No allocations on this event \u2014 pack items first.', true);
    return;
  }
  var productOpts = '';
  Object.keys(ev.allocations).forEach(function(pid) {
    var alloc = ev.allocations[pid];
    var name = alloc.productName || pid;
    var remaining = (alloc.quantity || 0) - (alloc.sold || 0);
    productOpts += '<option value="' + esc(pid) + '">' + esc(name) + ' (' + remaining + ' remaining)</option>';
  });
  if (!productOpts) {
    showToast('No products allocated to this event.', true);
    return;
  }

  var today = new Date().toISOString().split('T')[0];
  var html = '<div class="modal-header">' +
    '<h3>Add Manual Sale</h3>' +
    '<button class="modal-close" onclick="closeModal()">&times;</button>' +
  '</div>' +
  '<div class="modal-body">' +
    '<div class="form-group">' +
      '<label for="manualSaleProduct">Product <span class="field-required">*</span></label>' +
      '<select id="manualSaleProduct" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' + productOpts + '</select>' +
    '</div>' +
    '<div style="display:flex;gap:12px;">' +
      '<div class="form-group" style="flex:1;">' +
        '<label for="manualSaleQty">Quantity</label>' +
        '<input type="number" id="manualSaleQty" value="1" min="1" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
      '</div>' +
      '<div class="form-group" style="flex:1;">' +
        '<label for="manualSaleAmount">Amount ($)</label>' +
        '<input type="number" id="manualSaleAmount" step="0.01" min="0" placeholder="0.00" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:12px;">' +
      '<div class="form-group" style="flex:1;">' +
        '<label for="manualSalePayment">Payment Type</label>' +
        '<select id="manualSalePayment" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
          '<option value="cash">Cash</option>' +
          '<option value="card">Square (Card)</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group" style="flex:1;">' +
        '<label for="manualSaleDate">Date</label>' +
        '<input type="date" id="manualSaleDate" value="' + today + '" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
      '</div>' +
    '</div>' +
    '<div class="form-group">' +
      '<label for="manualSaleNotes">Notes (optional)</label>' +
      '<input type="text" id="manualSaleNotes" placeholder="e.g. Cash sale while reader was offline" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
    '</div>' +
  '</div>' +
  '<div class="modal-footer">' +
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveManualSale(\'' + eventId + '\')">Save Sale</button>' +
  '</div>';
  openModal(html);
}

async function saveManualSale(eventId) {
  if (!hasPermission('sales', 'create')) {
    showToast('You do not have permission to record sales.', true);
    return;
  }
  var ev = salesEventsData[eventId];
  if (!ev) return;
  var pid = document.getElementById('manualSaleProduct').value;
  var qty = parseInt(document.getElementById('manualSaleQty').value) || 1;
  var amountDollars = parseFloat(document.getElementById('manualSaleAmount').value) || 0;
  if (amountDollars < 0 || amountDollars > 100000) {
    showToast('Amount must be between $0 and $100,000.', true);
    return;
  }
  var paymentType = document.getElementById('manualSalePayment').value;
  var saleDate = document.getElementById('manualSaleDate').value;
  var notes = (document.getElementById('manualSaleNotes').value || '').trim();

  if (!pid) { showToast('Select a product.', true); return; }
  var alloc = ev.allocations[pid];
  if (!alloc) { showToast('Product not found in allocations.', true); return; }
  var remaining = (alloc.quantity || 0) - (alloc.sold || 0);
  if (qty > remaining) {
    showToast('Only ' + remaining + ' remaining \u2014 cannot sell ' + qty + '.', true);
    return;
  }

  var amountCents = Math.round(amountDollars * 100);
  var now = new Date().toISOString();
  var saleId = 'manual_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  try {
    // 1. Write sale record
    var saleRecord = {
      saleId: saleId,
      eventId: eventId,
      status: 'captured',
      source: 'manual-reconciliation',
      paymentType: paymentType,
      amount: amountCents,
      timestamp: saleDate ? saleDate + 'T12:00:00.000Z' : now,
      createdAt: now,
      createdBy: currentUser ? currentUser.uid : 'admin',
      items: [{ productId: pid, productName: alloc.productName || pid, quantity: qty, price: amountCents }]
    };
    if (notes) saleRecord.notes = notes;
    await MastDB.sales.ref(saleId).set(saleRecord);

    // 2. Update event allocation sold count
    var newSold = (alloc.sold || 0) + qty;
    await MastDB.salesEvents.allocationField(eventId, pid, 'sold').set(newSold);

    // 3. Decrement main inventory
    var stockRef = MastDB.inventory.stockAvailable(pid);
    await stockRef.transaction(function(current) { return Math.max(0, (current || 0) - qty); });

    // 4. Audit
    await writeAudit('create', 'sales', saleId);

    closeModal();
    showToast('Manual sale recorded \u2014 ' + qty + ' \u00D7 ' + (alloc.productName || pid));

    // 5. Refresh — local data update + re-render
    if (salesEventsData[eventId] && salesEventsData[eventId].allocations && salesEventsData[eventId].allocations[pid]) {
      salesEventsData[eventId].allocations[pid].sold = newSold;
    }
    sales[saleId] = saleRecord;
    renderSalesEventDetail(eventId);
  } catch (err) {
    console.error('Manual sale error:', err);
    showToast('Failed to save sale: ' + err.message, true);
  }
}

async function deleteEvent(eventId) {
  if (!confirm('Delete this event? This cannot be undone.')) return;
  try {
    await writeAudit('delete', 'salesEvents', eventId);
    await MastDB.salesEvents.ref(eventId).remove();
    showToast('Event deleted.');
    closeSalesEventDetail();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

// === Allocation Adjustments ===

async function adjustAllocation(eventId, productId, delta) {
  var ev = salesEventsData[eventId];
  if (!ev || !ev.allocations || !ev.allocations[productId]) return;
  var current = ev.allocations[productId].quantity || 0;
  var newQty = Math.max(0, current + delta);
  try {
    await MastDB.salesEvents.allocationField(eventId, productId, 'quantity').set(newQty);
    await writeAudit('update', 'salesEvents', eventId);
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

async function removeAllocation(eventId, productId) {
  if (!confirm('Remove this product from the packing list?')) return;
  try {
    await writeAudit('update', 'salesEvents', eventId);
    await MastDB.salesEvents.allocations(eventId, productId).remove();
    showToast('Product removed from packing list.');
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

// ============================================================
// PACKING MODE
// ============================================================

function startPackingMode(eventId) {
  packingEventId = eventId;
  var ev = salesEventsData[eventId];
  if (!ev) return;

  document.getElementById('packingModeTitle').textContent = 'Packing: ' + (ev.name || 'Event');
  document.getElementById('packingModeOverlay').style.display = '';
  document.getElementById('packingCameraPlaceholder').style.display = '';
  document.getElementById('packingVideo').style.display = 'none';
  document.getElementById('packingCaptureBtn').style.display = 'none';
  document.getElementById('packingRecognitionResult').style.display = 'none';
  document.getElementById('manualPackPicker').style.display = 'none';
  updatePackingTally();
  renderPackingAllocations();
}

function updatePackingTally() {
  if (!packingEventId) return;
  var ev = salesEventsData[packingEventId];
  var stats = ev ? getEventAllocationsStats(ev) : { totalPacked: 0, productCount: 0 };
  document.getElementById('packingTally').textContent = stats.totalPacked + ' items packed (' + stats.productCount + ' products)';
}

function renderPackingAllocations() {
  var el = document.getElementById('packingAllocations');
  if (!packingEventId || !salesEventsData[packingEventId]) { el.innerHTML = ''; return; }
  var ev = salesEventsData[packingEventId];
  if (!ev.allocations || Object.keys(ev.allocations).length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--cream);padding:16px;">No items packed yet. Use the camera or add manually.</div>';
    return;
  }
  var html = '<div style="color:white;font-weight:600;margin-bottom:8px;">Current Packing List</div>';
  Object.keys(ev.allocations).forEach(function(pid) {
    var alloc = ev.allocations[pid];
    html += '<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.1);border-radius:6px;padding:8px 12px;margin-bottom:4px;">' +
      '<span style="color:white;">' + (alloc.productName || pid) + '</span>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<button onclick="adjustAllocation(\'' + packingEventId + '\',\'' + pid + '\', -1)" style="background:rgba(255,255,255,0.2);border:none;color:white;width:28px;height:28px;border-radius:4px;cursor:pointer;font-size:1rem;">\u2212</button>' +
        '<span style="color:white;font-weight:700;min-width:24px;text-align:center;">' + (alloc.quantity || 0) + '</span>' +
        '<button onclick="adjustAllocation(\'' + packingEventId + '\',\'' + pid + '\', 1)" style="background:rgba(255,255,255,0.2);border:none;color:white;width:28px;height:28px;border-radius:4px;cursor:pointer;font-size:1rem;">+</button>' +
      '</div>' +
    '</div>';
  });
  el.innerHTML = html;
}

async function startPackingCamera() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    var video = document.getElementById('packingVideo');
    video.srcObject = stream;
    video.style.display = '';
    packingCamera = stream;
    document.getElementById('packingCameraPlaceholder').style.display = 'none';
    document.getElementById('packingCaptureBtn').style.display = '';
  } catch (err) {
    showToast('Camera error: ' + err.message, true);
  }
}

function stopPackingCamera() {
  if (packingCamera) {
    packingCamera.getTracks().forEach(function(t) { t.stop(); });
    packingCamera = null;
  }
  document.getElementById('packingVideo').style.display = 'none';
  document.getElementById('packingCaptureBtn').style.display = 'none';
  document.getElementById('packingCameraPlaceholder').style.display = '';
}

async function capturePackingPhoto() {
  var video = document.getElementById('packingVideo');
  var canvas = document.getElementById('packingCanvas');
  canvas.width = Math.min(video.videoWidth, 1600);
  canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));
  var ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  var base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  stopPackingCamera();

  // Show recognition in progress
  var resultEl = document.getElementById('packingRecognitionResult');
  resultEl.style.display = '';
  resultEl.innerHTML = '<div style="text-align:center;color:white;padding:12px;">\uD83D\uDD0D Identifying products...</div>';

  try {
    var token = await auth.currentUser.getIdToken();
    var catalogForApi = buildProductCatalogForVision();
    var resp = await callCF('/classifyImage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ image: base64, catalog: catalogForApi, context: 'inventory' })
    });
    var data = await resp.json();

    if (data.productId) {
      var prodName = getProductName(data.productId);
      var confidence = data.confidence || 0;
      var confColor = confidence >= 90 ? '#4CAF50' : confidence >= 70 ? '#FF9800' : '#E53935';
      var confLabel = confidence >= 90 ? '\u2705 High' : confidence >= 70 ? '\u26A0\uFE0F Medium' : '\u274C Low';

      resultEl.innerHTML = '<div style="color:white;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<span style="font-weight:700;font-size:1.1rem;">' + esc(prodName) + '</span>' +
          '<span style="color:' + confColor + ';font-size:0.85rem;">' + confLabel + ' (' + confidence + '%)</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<label style="color:var(--cream);font-size:0.85rem;">Quantity:</label>' +
          '<input type="number" id="packQtyInput" value="1" min="1" style="width:60px;padding:6px;border-radius:4px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:white;text-align:center;">' +
          '<button class="btn btn-primary" data-pid="' + esc(data.productId) + '" data-pname="' + esc(prodName) + '" onclick="confirmPackItem(this.dataset.pid, this.dataset.pname)">Add to Pack</button>' +
          '<button class="btn btn-secondary" onclick="openManualPackPicker()">Wrong? Pick Manually</button>' +
        '</div>' +
      '</div>';
    } else {
      resultEl.innerHTML = '<div style="color:white;text-align:center;">' +
        '<p>Could not identify product. Please pick manually.</p>' +
        '<button class="btn btn-primary" onclick="openManualPackPicker()">Pick from Catalog</button>' +
      '</div>';
    }
  } catch (err) {
    resultEl.innerHTML = '<div style="color:#E53935;text-align:center;">' +
      '<p>Recognition error: ' + esc(err.message) + '</p>' +
      '<button class="btn btn-primary" onclick="openManualPackPicker()">Pick Manually</button>' +
    '</div>';
  }
}

function buildProductCatalogForVision() {
  var catalog = [];
  if (!productsData || !productsData.length) return catalog;
  productsData.forEach(function(p) {
    if (p.availability === 'discontinued') return;
    catalog.push({
      id: p.pid,
      name: p.name || p.pid,
      category: p.category || '',
      description: p.shortDescription || p.description || ''
    });
  });
  return catalog;
}

function getProductName(productId) {
  if (productsData) {
    var found = productsData.find(function(p) { return p.pid === productId; });
    if (found) return found.name || productId;
  }
  return productId;
}

async function confirmPackItem(productId, productName) {
  var qty = parseInt(document.getElementById('packQtyInput').value) || 1;
  if (!packingEventId) return;

  try {
    var currentAlloc = salesEventsData[packingEventId] && salesEventsData[packingEventId].allocations && salesEventsData[packingEventId].allocations[productId];
    var currentQty = currentAlloc ? (currentAlloc.quantity || 0) : 0;

    // Find source location (Home by default) for location tracking
    var sourceLocId = getHomeLocationId();
    var eventLocId = getEventLocation(packingEventId);

    // Store sourceLocation on the allocation for return tracking
    var allocUpdate = {
      quantity: currentQty + qty,
      sold: currentAlloc ? (currentAlloc.sold || 0) : 0,
      productName: productName
    };
    if (sourceLocId) allocUpdate.sourceLocationId = currentAlloc ? (currentAlloc.sourceLocationId || sourceLocId) : sourceLocId;

    await MastDB.salesEvents.allocations(packingEventId, productId).update(allocUpdate);
    await writeAudit('update', 'salesEvents', packingEventId);

    // Move items from source to event location if locations are configured
    if (sourceLocId && eventLocId) {
      moveInventory(productId, '_default', sourceLocId, eventLocId, qty).catch(function() {
        // Non-blocking — location tracking is best-effort during packing
      });
    }

    document.getElementById('packingRecognitionResult').style.display = 'none';
    showToast(qty + 'x ' + productName + ' added to pack!');
    updatePackingTally();
    renderPackingAllocations();
  } catch (err) {
    showToast('Error: ' + err.message, true);
  }
}

function openManualPackPicker() {
  document.getElementById('manualPackPicker').style.display = '';
  document.getElementById('packingRecognitionResult').style.display = 'none';
  document.getElementById('packProductSearch').value = '';
  filterPackProducts();
}

function filterPackProducts() {
  var query = (document.getElementById('packProductSearch').value || '').toLowerCase();
  var listEl = document.getElementById('packProductList');
  if (!productsData || !productsData.length) { listEl.innerHTML = '<div style="color:var(--cream);padding:8px;">No products loaded.</div>'; return; }

  var html = '';
  productsData.forEach(function(p) {
    if (p.availability === 'discontinued') return;
    var pid = p.pid;
    var name = p.name || pid;
    if (query && name.toLowerCase().indexOf(query) === -1 && (p.category || '').toLowerCase().indexOf(query) === -1) return;

    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid rgba(255,255,255,0.1);cursor:pointer;" data-pid="' + esc(pid) + '" data-pname="' + esc(name) + '" onclick="selectManualPackProduct(this.dataset.pid, this.dataset.pname)">' +
      '<span style="color:white;">' + esc(name) + '</span>' +
      '<span style="color:var(--cream);font-size:0.8rem;">' + esc(p.category || '') + '</span>' +
    '</div>';
  });

  listEl.innerHTML = html || '<div style="color:var(--cream);padding:8px;">No matching products.</div>';
}

function selectManualPackProduct(productId, productName) {
  document.getElementById('manualPackPicker').style.display = 'none';
  var resultEl = document.getElementById('packingRecognitionResult');
  resultEl.style.display = '';
  resultEl.innerHTML = '<div style="color:white;">' +
    '<div style="font-weight:700;font-size:1.1rem;margin-bottom:8px;">' + esc(productName) + '</div>' +
    '<div style="display:flex;gap:8px;align-items:center;">' +
      '<label style="color:var(--cream);font-size:0.85rem;">Quantity:</label>' +
      '<input type="number" id="packQtyInput" value="1" min="1" style="width:60px;padding:6px;border-radius:4px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:white;text-align:center;">' +
      '<button class="btn btn-primary" data-pid="' + esc(productId) + '" data-pname="' + esc(productName) + '" onclick="confirmPackItem(this.dataset.pid, this.dataset.pname)">Add to Pack</button>' +
    '</div>' +
  '</div>';
}

async function exitPackingMode() {
  stopPackingCamera();
  document.getElementById('packingModeOverlay').style.display = 'none';
  document.getElementById('manualPackPicker').style.display = 'none';
  document.getElementById('packingRecognitionResult').style.display = 'none';

  if (packingEventId) {
    var ev = salesEventsData[packingEventId];
    if (ev && ev.status === 'planning') {
      var stats = getEventAllocationsStats(ev);
      if (stats.totalPacked > 0) {
        if (confirm('Mark event as packed? (' + stats.totalPacked + ' items, ' + stats.productCount + ' products)')) {
          await MastDB.salesEvents.ref(packingEventId).update({
            status: 'packed', updatedAt: new Date().toISOString()
          });
          await writeAudit('update', 'salesEvents', packingEventId);
          showToast('Event marked as packed!');
          emitTestingEvent('packEvent', {});
        }
      }
    }
    renderSalesEventDetail(packingEventId);
  }
  packingEventId = null;
}

  // ============================================================
  // Window exports
  // ============================================================

  window.loadSales = loadSales;
  window.getSalesArray = getSalesArray;
  window.formatSaleTime = formatSaleTime;
  window.formatSaleDate = formatSaleDate;
  window.formatCents = formatCents;
  window.getSaleItemsLabel = getSaleItemsLabel;
  window.filterSalesByDate = filterSalesByDate;
  window.renderSales = renderSales;
  window.viewSaleDetail = viewSaleDetail;
  window.closeSaleDetail = closeSaleDetail;
  window.reconcileSale = reconcileSale;
  window.voidSale = voidSale;
  window.toggleSquarePayments = toggleSquarePayments;
  window.getSquarePaymentsArray = getSquarePaymentsArray;
  window.renderSquarePayments = renderSquarePayments;
  window.openManualMatchModal = openManualMatchModal;
  window.executeManualMatch = executeManualMatch;
  window.loadSalesEvents = loadSalesEvents;
  window.getSalesEventsArray = getSalesEventsArray;
  window.getEventAllocationsStats = getEventAllocationsStats;
  window.renderSalesEvents = renderSalesEvents;
  window.openCreateEventModal = openCreateEventModal;
  window.closeCreateEventModal = closeCreateEventModal;
  window.saveEvent = saveEvent;
  window.viewSalesEventDetail = viewSalesEventDetail;
  window.renderSalesEventDetail = renderSalesEventDetail;
  window.closeSalesEventDetail = closeSalesEventDetail;
  window.startFairMode = startFairMode;
  window.revertToPlanningStatus = revertToPlanningStatus;
  window.closeEvent = closeEvent;
  window.showManualSaleModal = showManualSaleModal;
  window.saveManualSale = saveManualSale;
  window.createNewEvent = openCreateEventModal;
  window.recordSaleEvent = viewSalesEventDetail;
  window.recordManualSale = saveManualSale;
  window.deleteEvent = deleteEvent;
  window.adjustAllocation = adjustAllocation;
  window.removeAllocation = removeAllocation;
  window.startPackingMode = startPackingMode;
  window.updatePackingTally = updatePackingTally;
  window.renderPackingAllocations = renderPackingAllocations;
  window.startPackingCamera = startPackingCamera;
  window.stopPackingCamera = stopPackingCamera;
  window.capturePackingPhoto = capturePackingPhoto;
  window.buildProductCatalogForVision = buildProductCatalogForVision;
  window.getProductName = getProductName;
  window.confirmPackItem = confirmPackItem;
  window.openManualPackPicker = openManualPackPicker;
  window.filterPackProducts = filterPackProducts;
  window.selectManualPackProduct = selectManualPackProduct;
  window.exitPackingMode = exitPackingMode;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  function ensureSalesData() {
    if (!salesLoaded) loadSales();
  }

  MastAdmin.registerModule('sales', {
    routes: {
      'pos': { tab: 'salesTab', setup: function() { ensureSalesData(); if (showingSquarePayments) toggleSquarePayments(); } },
      'receipts': { tab: 'salesTab', setup: function() { ensureSalesData(); if (!showingSquarePayments) toggleSquarePayments(); } },
      'events': { tab: 'salesEventsTab', setup: function() {
        if (!salesEventsLoaded) loadSalesEvents();
        if (!productsLoaded) loadProducts();
        if (!salesLoaded) loadSales();
      } },
      'salesEvents': { tab: 'salesEventsTab', setup: function() {
        if (!salesEventsLoaded) loadSalesEvents();
        if (!productsLoaded) loadProducts();
        if (!salesLoaded) loadSales();
      } }
    },
    detachListeners: function() {
      showingSquarePayments = false;
      selectedSalesEventId = null;
      editingEventId = null;
      packingEventId = null;
      if (packingCamera) { stopPackingCamera(); }
    }
  });

})();
