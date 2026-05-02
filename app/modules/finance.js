// ============================================================
// FINANCE MODULE (lazy-loaded)
// Session 4: Revenue, Expenses, P&L, Cash Flow, AR, AP tabs.
// Tax and Reports tabs remain stubs (Session 5).
// Old financials / expenses routes stay alive until Session 5.
// ============================================================
(function() {
'use strict';

// ── Module-private state ──────────────────────────────────────────────────────

var _arData = null;
var _apData = null;
var _arFilter = 'all';
var _apFilter = 'all';
var _apGroupByVendor = false;
var _apExpandedVendors = {};
var _cfLoaded = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function e(s) { return typeof window.esc === 'function' ? window.esc(s) : String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function fmt$(cents) {
  if (cents == null || isNaN(cents)) return '$0.00';
  var n = Math.abs(cents) / 100;
  return (cents < 0 ? '-' : '') + '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pct(num, denom) {
  if (!denom) return '—';
  return (num / denom * 100).toFixed(1) + '%';
}

function toDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch(x) { return iso; }
}

function toDateShort(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch(x) { return iso; }
}

function todayStr() { return new Date().toISOString().split('T')[0]; }
function isoStart(d) { return d + 'T00:00:00.000Z'; }
function isoEnd(d)   { return d + 'T23:59:59.999Z'; }

function monthStart() {
  var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01';
}
function monthEnd() {
  var d = new Date(); var l = new Date(d.getFullYear(), d.getMonth()+1, 0);
  return l.getFullYear() + '-' + String(l.getMonth()+1).padStart(2,'0') + '-' + String(l.getDate()).padStart(2,'0');
}
function lastMonthStart() {
  var d = new Date(); var s = new Date(d.getFullYear(), d.getMonth()-1, 1);
  return s.getFullYear() + '-' + String(s.getMonth()+1).padStart(2,'0') + '-01';
}
function lastMonthEnd() {
  var d = new Date(); var l = new Date(d.getFullYear(), d.getMonth(), 0);
  return l.getFullYear() + '-' + String(l.getMonth()+1).padStart(2,'0') + '-' + String(l.getDate()).padStart(2,'0');
}
function quarterStart() {
  var d = new Date(); var q = Math.floor(d.getMonth()/3);
  var s = new Date(d.getFullYear(), q*3, 1);
  return s.getFullYear() + '-' + String(s.getMonth()+1).padStart(2,'0') + '-01';
}
function ytdStart() { return new Date().getFullYear() + '-01-01'; }

// Prior period of equal length (for P&L comparison)
function priorPeriod(startDate, endDate) {
  var s = new Date(startDate + 'T00:00:00Z');
  var en = new Date(endDate + 'T00:00:00Z');
  var days = Math.round((en - s) / 86400000) + 1;
  var ps = new Date(s.getTime() - days * 86400000);
  var pe = new Date(s.getTime() - 86400000);
  function fmt(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  return { start: fmt(ps), end: fmt(pe) };
}

function skeletonCards(n) {
  n = n || 4;
  var h = '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
  for (var i=0;i<n;i++) {
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:14px;flex:1;min-width:120px;">';
    h += '<div style="height:20px;border-radius:4px;background:var(--hover-bg,#333);margin-bottom:8px;width:60%;animation:finPulse 1.2s ease-in-out infinite;"></div>';
    h += '<div style="height:12px;border-radius:4px;background:var(--hover-bg,#333);width:40%;animation:finPulse 1.2s ease-in-out infinite;"></div></div>';
  }
  return h + '</div>';
}

function skeletonTable(rows, cols) {
  var h = '<div style="display:flex;flex-direction:column;gap:6px;">';
  for (var r=0;r<(rows||5);r++) {
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:10px 14px;display:flex;gap:12px;">';
    for (var c=0;c<(cols||4);c++) {
      h += '<div style="height:14px;border-radius:4px;background:var(--hover-bg,#333);flex:1;animation:finPulse 1.2s ease-in-out infinite;"></div>';
    }
    h += '</div>';
  }
  return h + '</div>';
}

function statCard(label, value, color, sub) {
  return '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:14px;flex:1;min-width:120px;">' +
    '<div style="font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">' + label + '</div>' +
    '<div style="font-size:1.2rem;font-weight:700;color:' + (color||'var(--text,#fff)') + ';">' + value + '</div>' +
    (sub ? '<div style="font-size:0.72rem;color:var(--warm-gray-light,#666);margin-top:2px;">' + sub + '</div>' : '') +
    '</div>';
}

function periodPicker(pfx, start, end) {
  return '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">' +
    '<button class="btn btn-secondary btn-small" onclick="finPeriod(\'' + pfx + '\',\'month\')">This Month</button>' +
    '<button class="btn btn-secondary btn-small" onclick="finPeriod(\'' + pfx + '\',\'last\')">Last Month</button>' +
    '<button class="btn btn-secondary btn-small" onclick="finPeriod(\'' + pfx + '\',\'qtr\')">This Quarter</button>' +
    '<button class="btn btn-secondary btn-small" onclick="finPeriod(\'' + pfx + '\',\'ytd\')">YTD</button>' +
    '<input type="date" id="' + pfx + 'S" value="' + start + '" style="background:var(--bg-secondary,#232323);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 8px;font-size:0.85rem;">' +
    '<span style="color:var(--warm-gray,#888);font-size:0.85rem;">to</span>' +
    '<input type="date" id="' + pfx + 'E" value="' + end + '" style="background:var(--bg-secondary,#232323);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 8px;font-size:0.85rem;">' +
    '<button class="btn btn-primary btn-small" onclick="finLoad(\'' + pfx + '\')">Load</button>' +
    '</div>';
}

function agingBadge(days) {
  if (days <= 0) return '<span style="background:rgba(42,124,111,0.2);color:var(--teal,#2a9d8f);padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Current</span>';
  if (days <= 30) return '<span style="background:rgba(234,179,8,0.15);color:#eab308;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">1–30d</span>';
  if (days <= 60) return '<span style="background:rgba(234,150,8,0.2);color:#f97316;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">31–60d</span>';
  if (days <= 90) return '<span style="background:rgba(220,38,38,0.15);color:#ef4444;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">61–90d</span>';
  return '<span style="background:rgba(185,28,28,0.25);color:#fca5a5;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">90d+</span>';
}

function bucketColor(bucket) {
  var m = { current:'var(--teal,#2a9d8f)', '1_to_30':'#eab308', '31_to_60':'#f97316', '61_to_90':'#ef4444', '90_plus':'#fca5a5' };
  return m[bucket] || 'var(--text,#fff)';
}

function injectFinancePulseCSS() {
  if (document.getElementById('finPulseStyle')) return;
  var s = document.createElement('style');
  s.id = 'finPulseStyle';
  s.textContent = '@keyframes finPulse{0%,100%{opacity:1}50%{opacity:0.5}}';
  document.head.appendChild(s);
}

// ── Revenue Tab ───────────────────────────────────────────────────────────────

function setupRevenueTab() {
  injectFinancePulseCSS();
  var el = document.getElementById('financeRevenueTab');
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    '<h2 style="margin:0 0 16px 0;font-size:1.2rem;font-weight:700;">Revenue</h2>' +
    periodPicker('fRev', monthStart(), monthEnd()) +
    '<div id="fRevContent">' + skeletonCards(4) + '</div>' +
    '</div>';
  loadRevenue();
}

async function loadRevenue() {
  var startEl = document.getElementById('fRevS');
  var endEl   = document.getElementById('fRevE');
  var start   = startEl ? startEl.value : monthStart();
  var end     = endEl   ? endEl.value   : monthEnd();
  if (!start || !end) { showToast('Select a date range', true); return; }

  var el = document.getElementById('fRevContent');
  if (!el) return;
  el.innerHTML = skeletonCards(4) + '<div style="margin-top:16px;">' + skeletonTable(6,5) + '</div>';

  try {
    var [ordersRaw, salesRaw] = await Promise.all([
      MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(start)).endAt(isoEnd(end)).limitToLast(1000).once(),
      MastDB.query('admin/sales').orderByChild('createdAt').startAt(isoStart(start)).endAt(isoEnd(end)).limitToLast(500).once()
    ]);

    var orders = Object.entries(ordersRaw || {}).map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); });
    var sales  = Object.entries(salesRaw  || {}).map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); });

    var totalCents = 0;
    var byChannel  = {};
    var txns = [];

    orders.forEach(function(o) {
      if (o.status === 'cancelled') return;
      var cents = Math.round((o.total || 0) * 100);
      if (cents <= 0) return;
      var ch = o.source || 'direct';
      byChannel[ch] = (byChannel[ch] || 0) + cents;
      totalCents += cents;
      txns.push({ date: o.placedAt, channel: ch, ref: o.orderNumber || o._id, desc: o.customerName || 'Order', cents: cents, type: 'order' });
    });

    sales.forEach(function(s) {
      if (s.status === 'voided') return;
      var cents = Math.round((s.amount || 0) * 100);
      if (cents <= 0) return;
      var ch = s.source || 'pos';
      byChannel[ch] = (byChannel[ch] || 0) + cents;
      totalCents += cents;
      txns.push({ date: s.createdAt, channel: ch, ref: s.receiptNumber || s._id, desc: s.note || 'POS Sale', cents: cents, type: 'sale' });
    });

    txns.sort(function(a,b) { return (b.date || '').localeCompare(a.date || ''); });

    el.innerHTML = renderRevenue(totalCents, byChannel, txns, start, end);
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Revenue load failed: ' + err.message, true);
  }
}

function renderRevenue(totalCents, byChannel, txns, start, end) {
  var channelColors = { direct:'#3b82f6', pos:'#8b5cf6', square:'#7c3aed', etsy:'#f1641e', shopify:'#96bf48', manual:'#6b7280', stripe:'#635bff' };
  var channels = Object.keys(byChannel).sort(function(a,b) { return byChannel[b]-byChannel[a]; });

  var h = '';

  // Summary cards
  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  h += statCard('Total Revenue', fmt$(totalCents), '#16a34a');
  h += statCard('Transactions', String(txns.length), 'var(--text,#fff)');
  if (channels.length > 0) {
    var topCh = channels[0];
    h += statCard('Top Channel', e(topCh), channelColors[topCh] || '#888', fmt$(byChannel[topCh]) + ' · ' + Math.round(byChannel[topCh]/totalCents*100) + '%');
  }
  h += statCard('Period', toDateShort(start) + ' – ' + toDateShort(end), 'var(--warm-gray,#888)');
  h += '</div>';

  if (totalCents === 0) {
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
      '<div style="font-size:2rem;margin-bottom:8px;">💰</div>' +
      '<div style="font-size:0.95rem;font-weight:500;">No revenue in this period</div>' +
      '<div style="font-size:0.85rem;margin-top:4px;">Try selecting a different date range.</div></div>';
  }

  // Channel breakdown
  if (channels.length > 1) {
    h += '<div style="margin-bottom:20px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">By Channel</div>';
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;">';
    channels.forEach(function(ch) {
      var color = channelColors[ch] || '#888';
      h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:10px 14px;min-width:130px;border-left:3px solid ' + color + ';">';
      h += '<div style="font-size:0.85rem;font-weight:600;text-transform:capitalize;">' + e(ch) + '</div>';
      h += '<div style="font-size:1.05rem;font-weight:700;">' + fmt$(byChannel[ch]) + '</div>';
      h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);">' + Math.round(byChannel[ch]/totalCents*100) + '% of total</div>';
      h += '</div>';
    });
    h += '</div></div>';
  }

  // Transaction log
  h += '<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">';
  h += '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">Transactions (' + txns.length + ')</div>';
  h += '</div>';

  if (txns.length === 0) {
    h += '<div style="color:var(--warm-gray,#888);font-size:0.85rem;padding:12px 0;">No transactions found.</div>';
  } else {
    var shown = txns.slice(0, 100);
    h += '<div style="display:flex;flex-direction:column;gap:6px;">';
    shown.forEach(function(t) {
      var color = channelColors[t.channel] || '#888';
      h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px;">';
      h += '<div style="flex:1;min-width:0;">';
      h += '<div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + e(t.desc) + '</div>';
      h += '<div style="font-size:0.75rem;color:var(--warm-gray,#888);margin-top:2px;">';
      h += toDateShort(t.date);
      h += ' · <span style="background:' + color + ';color:#fff;padding:1px 5px;border-radius:3px;font-size:0.7rem;text-transform:capitalize;">' + e(t.channel) + '</span>';
      if (t.ref) h += ' · <span style="opacity:0.7;">' + e(t.ref) + '</span>';
      h += '</div></div>';
      h += '<div style="font-weight:700;font-size:0.95rem;flex-shrink:0;">' + fmt$(t.cents) + '</div>';
      h += '</div>';
    });
    if (txns.length > 100) h += '<div style="color:var(--warm-gray,#888);font-size:0.8rem;padding:8px 0;">Showing 100 of ' + txns.length + ' transactions.</div>';
    h += '</div>';
  }

  return h;
}

// ── Expenses Tab ──────────────────────────────────────────────────────────────

function setupExpensesTab() {
  injectFinancePulseCSS();
  var el = document.getElementById('financeExpensesTab');
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    '<h2 style="margin:0 0 16px 0;font-size:1.2rem;font-weight:700;">Expenses</h2>' +
    '<div id="fExpBanks" style="margin-bottom:16px;">' + skeletonCards(2) + '</div>' +
    periodPicker('fExp', monthStart(), monthEnd()) +
    '<div id="fExpContent">' + skeletonTable(6,4) + '</div>' +
    '</div>';
  loadFinExpBanks();
  loadFinExpenses();
}

async function loadFinExpBanks() {
  var el = document.getElementById('fExpBanks');
  if (!el) return;
  try {
    var items = (await MastDB.plaidItems.list()) || {};
    var keys = Object.keys(items);
    if (keys.length === 0) {
      el.innerHTML = '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:14px 18px;margin-bottom:4px;display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:1.3rem;">🏦</span>' +
        '<div><div style="font-size:0.9rem;font-weight:600;">No banks connected</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray,#888);">Connect a bank in the Expenses view to import transactions automatically.</div></div>' +
        '</div>';
      return;
    }
    var h = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px;">';
    keys.forEach(function(itemId) {
      var item = items[itemId];
      var statusColor = item.status === 'active' ? '#16a34a' : item.status === 'error' ? '#dc2626' : '#9ca3af';
      var acctCount = (item.accounts && item.accounts.length) || 0;
      h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:12px 16px;flex:1;min-width:200px;display:flex;justify-content:space-between;align-items:center;gap:10px;">';
      h += '<div>';
      h += '<div style="font-weight:600;font-size:0.9rem;">' + e(item.institutionName || 'Bank') + '</div>';
      h += '<div style="font-size:0.75rem;color:var(--warm-gray,#888);">' + acctCount + ' account' + (acctCount !== 1 ? 's' : '');
      if (item.lastSyncAt) h += ' · Synced ' + toDateShort(item.lastSyncAt);
      h += '</div></div>';
      h += '<div style="display:flex;gap:6px;align-items:center;">';
      h += '<span style="background:' + statusColor + ';color:#fff;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + e(item.status || 'unknown') + '</span>';
      if (item.status === 'active') h += '<button class="btn btn-secondary btn-small" data-item-id="' + e(itemId) + '" onclick="finExpSyncBank(this.dataset.itemId)">Sync</button>';
      h += '</div></div>';
    });
    h += '</div>';
    el.innerHTML = h;
  } catch (err) {
    el.innerHTML = '';
  }
}

async function loadFinExpenses() {
  var startEl = document.getElementById('fExpS');
  var endEl   = document.getElementById('fExpE');
  var start   = startEl ? startEl.value : monthStart();
  var end     = endEl   ? endEl.value   : monthEnd();

  var el = document.getElementById('fExpContent');
  if (!el) return;
  el.innerHTML = skeletonTable(6,4);

  try {
    var raw = await MastDB.query('admin/expenses').orderByChild('date').startAt(start).endAt(end).limitToLast(500).once();
    var expenses = Object.entries(raw || {}).map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); });
    expenses = expenses.filter(function(ex) { return ex.category !== 'personal'; });
    expenses.sort(function(a,b) { return (b.date || '').localeCompare(a.date || ''); });

    el.innerHTML = renderFinExpenses(expenses, start, end);
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
  }
}

function renderFinExpenses(expenses, start, end) {
  var total = 0;
  var byCategory = {};
  expenses.forEach(function(ex) {
    total += ex.amount || 0;
    var cat = ex.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + (ex.amount || 0);
  });

  var catColors = { materials:'#8b5cf6', booth_fee:'#f59e0b', shipping_supplies:'#3b82f6', travel:'#10b981', marketing:'#ec4899', equipment:'#6366f1', software:'#0ea5e9', payroll:'#f97316', taxes:'#dc2626', other:'#6b7280' };

  var h = '';

  // Summary cards
  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  h += statCard('Total Expenses', fmt$(total), '#dc2626');
  h += statCard('Transactions', String(expenses.length), 'var(--text,#fff)');
  var unreviewedCount = expenses.filter(function(ex) { return !ex.reviewed; }).length;
  if (unreviewedCount > 0) h += statCard('Needs Review', String(unreviewedCount), '#eab308');
  h += statCard('Period', toDateShort(start) + ' – ' + toDateShort(end), 'var(--warm-gray,#888)');
  h += '</div>';

  if (expenses.length === 0) {
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
      '<div style="font-size:2rem;margin-bottom:8px;">💸</div>' +
      '<div style="font-size:0.95rem;font-weight:500;">No expenses in this period</div>' +
      '<div style="font-size:0.85rem;margin-top:4px;">Connect a bank or add expenses in the Expenses view.</div></div>';
  }

  // Category breakdown
  var cats = Object.keys(byCategory).sort(function(a,b) { return byCategory[b]-byCategory[a]; });
  if (cats.length > 1) {
    h += '<div style="margin-bottom:20px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">By Category</div>';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    cats.forEach(function(cat) {
      var color = catColors[cat] || '#6b7280';
      h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:8px 12px;border-left:3px solid ' + color + ';">';
      h += '<div style="font-size:0.8rem;font-weight:600;text-transform:capitalize;">' + e(cat.replace(/_/g,' ')) + '</div>';
      h += '<div style="font-size:0.95rem;font-weight:700;">' + fmt$(byCategory[cat]) + '</div>';
      h += '</div>';
    });
    h += '</div></div>';
  }

  // Expense list
  h += '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Transactions (' + expenses.length + ')</div>';
  h += '<div style="display:flex;flex-direction:column;gap:6px;">';
  expenses.slice(0, 100).forEach(function(ex) {
    var cat = ex.category || 'other';
    var color = catColors[cat] || '#6b7280';
    var needsReview = !ex.reviewed;
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:10px 14px;border-left:3px solid ' + (needsReview ? '#eab308' : 'transparent') + ';display:flex;justify-content:space-between;align-items:center;gap:12px;">';
    h += '<div style="flex:1;min-width:0;">';
    h += '<div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + e(ex.merchantName || ex.description || 'Expense') + '</div>';
    h += '<div style="font-size:0.75rem;color:var(--warm-gray,#888);margin-top:2px;">';
    h += e(ex.date || '');
    h += ' · <span style="background:' + color + '22;color:' + color + ';padding:1px 6px;border-radius:3px;font-size:0.7rem;">' + e(cat.replace(/_/g,' ')) + '</span>';
    if (needsReview) h += ' · <span style="color:#eab308;font-size:0.72rem;">⚠ Review needed</span>';
    h += '</div></div>';
    h += '<div style="font-weight:700;font-size:0.95rem;flex-shrink:0;">' + fmt$(ex.amount || 0) + '</div>';
    h += '</div>';
  });
  if (expenses.length > 100) h += '<div style="color:var(--warm-gray,#888);font-size:0.8rem;padding:8px 0;">Showing 100 of ' + expenses.length + ' expenses.</div>';
  h += '</div>';

  return h;
}

window.finExpSyncBank = async function(itemId) {
  showToast('Syncing transactions…');
  try {
    var syncFn = firebase.functions().httpsCallable('syncPlaidTransactions');
    var result = await syncFn({ tenantId: MastDB.tenantId(), itemId: itemId });
    var d = result.data;
    showToast('Synced: ' + d.imported + ' new, ' + d.updated + ' updated');
    loadFinExpenses();
    loadFinExpBanks();
  } catch (err) {
    showToast('Sync failed: ' + e(err.message), true);
  }
};

// ── P&L Tab ───────────────────────────────────────────────────────────────────

function setupPlTab() {
  injectFinancePulseCSS();
  // RBAC check is enforced in navigateTo() — setup only runs for admins
  var el = document.getElementById('financePlTab');
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
    '<h2 style="margin:0;font-size:1.2rem;font-weight:700;">Profit & Loss</h2>' +
    '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:600;">Admin Only</span>' +
    '</div>' +
    periodPicker('fPl', monthStart(), monthEnd()) +
    '<div id="fPlContent">' + skeletonCards(4) + '</div>' +
    '</div>';
  loadPnl();
}

async function loadPnl() {
  var startEl = document.getElementById('fPlS');
  var endEl   = document.getElementById('fPlE');
  var start   = startEl ? startEl.value : monthStart();
  var end     = endEl   ? endEl.value   : monthEnd();
  if (!start || !end) { showToast('Select a date range', true); return; }

  var el = document.getElementById('fPlContent');
  if (!el) return;
  el.innerHTML = skeletonCards(4) + '<div style="margin-top:16px;">' + skeletonCards(3) + '</div>';

  try {
    var prior = priorPeriod(start, end);
    var [curr, prev] = await Promise.all([
      computePnlLocal(start, end),
      computePnlLocal(prior.start, prior.end)
    ]);
    el.innerHTML = renderPnl(curr, prev, start, end, prior);
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('P&L load failed: ' + err.message, true);
  }
}

async function computePnlLocal(startDate, endDate) {
  var [ordersRaw, salesRaw, expensesRaw, jeRaw] = await Promise.all([
    MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(startDate)).endAt(isoEnd(endDate)).limitToLast(1000).once(),
    MastDB.query('admin/sales').orderByChild('createdAt').startAt(isoStart(startDate)).endAt(isoEnd(endDate)).limitToLast(500).once(),
    MastDB.query('admin/expenses').orderByChild('date').startAt(startDate).endAt(endDate).limitToLast(500).once(),
    MastDB.query('admin/journalEntries').orderByChild('date').startAt(startDate).endAt(endDate).limitToLast(500).once()
  ]);

  var orders  = Object.values(ordersRaw  || {});
  var sales   = Object.values(salesRaw   || {});
  var expenses = Object.values(expensesRaw || {});
  var jes     = Object.values(jeRaw      || {});

  var revenue = 0;
  var revByChannel = {};
  orders.forEach(function(o) {
    if (o.status === 'cancelled') return;
    var c = Math.round((o.total || 0) * 100); if (c <= 0) return;
    var ch = o.source || 'direct';
    revByChannel[ch] = (revByChannel[ch] || 0) + c;
    revenue += c;
  });
  sales.forEach(function(s) {
    if (s.status === 'voided') return;
    var c = Math.round((s.amount || 0) * 100); if (c <= 0) return;
    var ch = s.source || 'pos';
    revByChannel[ch] = (revByChannel[ch] || 0) + c;
    revenue += c;
  });

  var cogs = 0;
  expenses.forEach(function(ex) {
    if (ex.category !== 'materials') return;
    if (!ex.reviewed) return;
    cogs += ex.amount || 0;
  });
  jes.forEach(function(j) {
    if (j.category === 'cogs-adjustment') cogs += j.amount || 0;
  });

  var opex = 0;
  var opexByCategory = {};
  expenses.forEach(function(ex) {
    if (ex.category === 'materials' || ex.category === 'personal') return;
    if (!ex.reviewed) return;
    var c = ex.amount || 0;
    var cat = ex.category || 'other';
    opexByCategory[cat] = (opexByCategory[cat] || 0) + c;
    opex += c;
  });
  jes.forEach(function(j) {
    if (j.category === 'cogs-adjustment' || j.category === 'owner-draw') return;
    var c = j.amount || 0;
    var cat = j.category || 'other';
    opexByCategory[cat] = (opexByCategory[cat] || 0) + c;
    opex += c;
  });

  var hasPayroll = !!(opexByCategory.payroll);
  var grossProfit = revenue - cogs;
  var netProfit   = grossProfit - opex;

  return { revenue, cogs, grossProfit, opex, netProfit, revByChannel, opexByCategory, hasPayroll };
}

function deltaBadge(curr, prev) {
  if (!prev) return '';
  var d = curr - prev;
  var pctVal = prev !== 0 ? (d / Math.abs(prev) * 100).toFixed(1) : null;
  if (pctVal === null) return '';
  var positive = d >= 0;
  var color = positive ? '#22c55e' : '#ef4444';
  var arrow = positive ? '▲' : '▼';
  return ' <span style="font-size:0.72rem;color:' + color + ';">' + arrow + ' ' + Math.abs(pctVal) + '% vs prior</span>';
}

function renderPnl(curr, prev, start, end, prior) {
  var h = '';

  // Top metrics row
  var grossMarginPct = curr.revenue > 0 ? (curr.grossProfit / curr.revenue * 100).toFixed(1) : null;
  var netMarginPct   = curr.revenue > 0 ? (curr.netProfit  / curr.revenue * 100).toFixed(1) : null;

  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  h += statCard('Revenue', fmt$(curr.revenue), '#16a34a', deltaBadge(curr.revenue, prev.revenue));
  h += statCard('COGS',    fmt$(curr.cogs),    '#f59e0b', deltaBadge(-curr.cogs, -prev.cogs));
  h += statCard('Gross Profit', fmt$(curr.grossProfit), curr.grossProfit >= 0 ? '#22c55e' : '#ef4444', grossMarginPct !== null ? grossMarginPct + '% margin' : null);
  h += statCard('Net Profit', fmt$(curr.netProfit), curr.netProfit >= 0 ? '#22c55e' : '#ef4444', netMarginPct !== null ? netMarginPct + '% net margin' : null);
  h += '</div>';

  // P&L Statement
  h += '<div style="background:var(--bg-secondary,#232323);border-radius:12px;padding:20px;margin-bottom:20px;">';

  function plRow(label, cents, indent, bold, sign) {
    var color = 'var(--text,#fff)';
    if (sign === '+') color = cents >= 0 ? '#22c55e' : '#ef4444';
    if (sign === '-') color = cents <= 0 ? '#22c55e' : '#ef4444';
    return '<div style="display:flex;justify-content:space-between;padding:5px 0;' +
      (indent ? 'padding-left:16px;' : '') +
      (bold ? 'border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:9px;' : '') + '">' +
      '<span style="font-size:0.9rem;' + (bold ? 'font-weight:600;' : 'color:var(--warm-gray,#888);') + '">' + label + '</span>' +
      '<span style="font-size:0.9rem;font-weight:' + (bold ? '700' : '400') + ';color:' + color + ';">' + fmt$(cents) + '</span>' +
      '</div>';
  }

  h += plRow('Revenue', curr.revenue, false, true, '+');
  var revChs = Object.keys(curr.revByChannel || {}).sort(function(a,b) { return (curr.revByChannel[b]||0)-(curr.revByChannel[a]||0); });
  revChs.forEach(function(ch) { h += plRow(ch.charAt(0).toUpperCase() + ch.slice(1), curr.revByChannel[ch], true, false, '+'); });

  h += plRow('COGS', curr.cogs, false, true, '-');

  h += '<div style="display:flex;justify-content:space-between;padding:9px 0;border-top:1px solid rgba(255,255,255,0.15);margin-top:4px;">';
  h += '<span style="font-size:1rem;font-weight:700;">Gross Profit</span>';
  h += '<span style="font-size:1rem;font-weight:700;color:' + (curr.grossProfit >= 0 ? '#22c55e' : '#ef4444') + ';">' + fmt$(curr.grossProfit) + '</span>';
  if (grossMarginPct) h += '<span style="font-size:0.78rem;color:var(--warm-gray,#888);align-self:center;margin-left:8px;">' + grossMarginPct + '% margin</span>';
  h += '</div>';

  h += plRow('Operating Expenses', curr.opex, false, true, '-');
  var opexCats = Object.keys(curr.opexByCategory || {}).sort(function(a,b) { return (curr.opexByCategory[b]||0)-(curr.opexByCategory[a]||0); });
  opexCats.forEach(function(cat) {
    var label = cat.replace(/_/g,' ');
    label = label.charAt(0).toUpperCase() + label.slice(1);
    h += plRow(label, curr.opexByCategory[cat], true, false, '-');
  });
  if (curr.hasPayroll) {
    h += '<div style="padding-left:16px;padding:4px 16px;font-size:0.72rem;color:var(--warm-gray,#888);">Payroll & Adjustments included above</div>';
  }

  h += '<div style="display:flex;justify-content:space-between;padding:9px 0;border-top:2px solid rgba(255,255,255,0.2);margin-top:8px;">';
  h += '<span style="font-size:1.1rem;font-weight:700;">Net Profit</span>';
  h += '<span style="font-size:1.1rem;font-weight:700;color:' + (curr.netProfit >= 0 ? '#22c55e' : '#ef4444') + ';">' + fmt$(curr.netProfit) + '</span>';
  if (netMarginPct) h += '<span style="font-size:0.78rem;color:var(--warm-gray,#888);align-self:center;margin-left:8px;">' + netMarginPct + '% net</span>';
  h += '</div>';

  h += '</div>';

  // Prior period comparison
  if (prev && prev.revenue !== undefined) {
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:14px 18px;">';
    h += '<div style="font-size:0.75rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Prior Period (' + toDateShort(prior.start) + ' – ' + toDateShort(prior.end) + ')</div>';
    h += '<div style="display:flex;gap:20px;flex-wrap:wrap;">';
    function cmpItem(label, curr, prev) {
      var d = curr - prev;
      var pctVal = prev !== 0 ? (d / Math.abs(prev) * 100).toFixed(1) : null;
      var color = d >= 0 ? '#22c55e' : '#ef4444';
      var arrow = d >= 0 ? '▲' : '▼';
      return '<div><div style="font-size:0.75rem;color:var(--warm-gray,#888);">' + label + '</div>' +
        '<div style="font-size:0.9rem;font-weight:600;">' + fmt$(prev) + '</div>' +
        (pctVal !== null ? '<div style="font-size:0.72rem;color:' + color + ';">' + arrow + ' ' + Math.abs(pctVal) + '%</div>' : '') +
        '</div>';
    }
    h += cmpItem('Revenue', curr.revenue, prev.revenue);
    h += cmpItem('COGS', curr.cogs, prev.cogs);
    h += cmpItem('Gross Profit', curr.grossProfit, prev.grossProfit);
    h += cmpItem('OpEx', curr.opex, prev.opex);
    h += cmpItem('Net Profit', curr.netProfit, prev.netProfit);
    h += '</div></div>';
  }

  return h;
}

// ── Cash Flow Tab ─────────────────────────────────────────────────────────────

function setupCashFlowTab() {
  injectFinancePulseCSS();
  _cfLoaded = false;
  var el = document.getElementById('financeCashFlowTab');
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
    '<h2 style="margin:0;font-size:1.2rem;font-weight:700;">Cash Flow</h2>' +
    '<button class="btn btn-secondary btn-small" onclick="loadCashFlow()">Refresh</button>' +
    '</div>' +
    '<div id="fCfContent">' + skeletonCards(3) + '</div>' +
    '</div>';
  loadCashFlow();
}

async function loadCashFlow() {
  var el = document.getElementById('fCfContent');
  if (!el) return;
  el.innerHTML = skeletonCards(3) + '<div style="margin-top:16px;">' + skeletonCards(2) + '</div>';

  try {
    var asOf = todayStr();

    var [plaidRaw, sentRaw, overdueRaw, unpaidRaw, partialRaw] = await Promise.all([
      MastDB.plaidItems.list(),
      MastDB.query('orders').orderByChild('invoiceStatus').equalTo('sent').limitToLast(500).once(),
      MastDB.query('orders').orderByChild('invoiceStatus').equalTo('overdue').limitToLast(500).once(),
      MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('unpaid').limitToLast(500).once(),
      MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('partial').limitToLast(500).once()
    ]);

    // Bank balances
    var plaidItems = plaidRaw || {};
    var bankTotal = 0;
    var bankAccounts = [];
    var staleItems = [];

    Object.entries(plaidItems).forEach(function(kv) {
      var itemId = kv[0], item = kv[1];
      if (item.status !== 'active') { staleItems.push(item.institutionName || itemId); return; }
      (item.accounts || []).forEach(function(acct) {
        var bal = acct.currentBalance || 0;
        bankAccounts.push({ name: acct.name || 'Account', mask: acct.mask, institution: item.institutionName, balance: bal, lastSync: item.lastSyncAt });
        bankTotal += bal;
      });
    });

    // AR outstanding
    var allOrders = Object.assign({}, sentRaw || {}, overdueRaw || {});
    var arTotal = 0, arDue30 = 0, arCount = 0;
    Object.values(allOrders).forEach(function(o) {
      var cents = Math.round((o.total || 0) * 100);
      var paid  = o.invoicePaidAmount || 0;
      var due   = cents - paid;
      if (due <= 0) return;
      arTotal += due; arCount++;
      if (!o.invoiceDueDate) return;
      var daysLeft = Math.floor((new Date(o.invoiceDueDate).getTime() - Date.now()) / 86400000);
      if (daysLeft >= 0 && daysLeft <= 30) arDue30 += due;
    });

    // AP due
    var allReceipts = Object.assign({}, unpaidRaw || {}, partialRaw || {});
    var apTotal = 0, apDue30 = 0, apCount = 0;
    Object.values(allReceipts).forEach(function(r) {
      var amtCents = r.amountCents || 0;
      var paid = r.paidAmount || 0;
      var due  = amtCents - paid;
      if (due <= 0) return;
      apTotal += due; apCount++;
      if (!r.dueDate) return;
      var daysLeft = Math.floor((new Date(r.dueDate).getTime() - Date.now()) / 86400000);
      if (daysLeft >= 0 && daysLeft <= 30) apDue30 += due;
    });

    // bankTotal is in dollars from Plaid; AR/AP are in cents
    // Normalize: show bank in dollars, AR/AP in dollars too
    var netProjected = bankTotal + (arDue30 / 100) - (apDue30 / 100);

    el.innerHTML = renderCashFlow(bankTotal, bankAccounts, staleItems, arTotal, arDue30, arCount, apTotal, apDue30, apCount, netProjected, asOf);
    _cfLoaded = true;
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Cash flow load failed: ' + err.message, true);
  }
}

function renderCashFlow(bankTotal, bankAccounts, staleItems, arTotal, arDue30, arCount, apTotal, apDue30, apCount, netProjected, asOf) {
  var h = '';

  // Summary cards
  var hasBank = bankAccounts.length > 0;
  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  if (hasBank) {
    h += statCard('Cash on Hand', '$' + bankTotal.toFixed(2), '#22c55e', bankAccounts.length + ' account' + (bankAccounts.length !== 1 ? 's' : ''));
  } else {
    h += statCard('Cash on Hand', '—', 'var(--warm-gray,#888)', 'Connect a bank to track');
  }
  h += statCard('AR Outstanding', fmt$(arTotal), '#3b82f6', arCount + ' invoice' + (arCount !== 1 ? 's' : ''));
  h += statCard('AP Due', fmt$(apTotal), '#f97316', apCount + ' receipt' + (apCount !== 1 ? 's' : ''));
  h += '</div>';

  // Bank accounts
  if (hasBank) {
    h += '<div style="margin-bottom:20px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Bank Accounts · as of ' + e(asOf) + '</div>';
    h += '<div style="display:flex;flex-direction:column;gap:6px;">';
    bankAccounts.forEach(function(acct) {
      h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">';
      h += '<div>';
      h += '<div style="font-size:0.85rem;font-weight:600;">' + e(acct.institution || '') + ' ' + e(acct.name) + (acct.mask ? ' ••' + e(acct.mask) : '') + '</div>';
      if (acct.lastSync) h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);">Last synced ' + toDate(acct.lastSync) + '</div>';
      h += '</div>';
      h += '<div style="font-weight:700;font-size:1rem;color:#22c55e;">$' + acct.balance.toFixed(2) + '</div>';
      h += '</div>';
    });
    h += '</div>';
    if (staleItems.length > 0) {
      h += '<div style="margin-top:8px;font-size:0.78rem;color:#eab308;">⚠ Disconnected banks (no balance): ' + e(staleItems.join(', ')) + '. Re-connect in Expenses.</div>';
    }
    h += '</div>';
  } else if (staleItems.length > 0) {
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:14px;margin-bottom:20px;">';
    h += '<div style="font-size:0.85rem;font-weight:600;margin-bottom:4px;">No active bank connections</div>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);">Banks previously connected but now disconnected: ' + e(staleItems.join(', ')) + '. Connect or re-connect in the Expenses view.</div>';
    h += '</div>';
  }

  // Next 30 days forecast
  h += '<div style="background:var(--bg-secondary,#232323);border-radius:12px;padding:18px;">';
  h += '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:14px;">Next 30 Days</div>';
  h += '<div style="display:flex;gap:16px;flex-wrap:wrap;">';

  h += '<div style="flex:1;min-width:200px;">';
  h += '<div style="font-size:0.8rem;color:var(--warm-gray,#888);margin-bottom:4px;">Money In (AR due ≤30d)</div>';
  h += '<div style="font-size:1.3rem;font-weight:700;color:#22c55e;">' + fmt$(arDue30) + '</div>';
  h += '<div style="font-size:0.75rem;color:var(--warm-gray,#888);">from open invoices</div>';
  h += '</div>';

  h += '<div style="flex:1;min-width:200px;">';
  h += '<div style="font-size:0.8rem;color:var(--warm-gray,#888);margin-bottom:4px;">Money Out (AP due ≤30d)</div>';
  h += '<div style="font-size:1.3rem;font-weight:700;color:#ef4444;">' + fmt$(apDue30) + '</div>';
  h += '<div style="font-size:0.75rem;color:var(--warm-gray,#888);">from unpaid receipts</div>';
  h += '</div>';

  h += '<div style="flex:1;min-width:200px;">';
  h += '<div style="font-size:0.8rem;color:var(--warm-gray,#888);margin-bottom:4px;">Projected Net Position</div>';
  var projColor = netProjected >= 0 ? '#22c55e' : '#ef4444';
  h += '<div style="font-size:1.3rem;font-weight:700;color:' + projColor + ';">$' + Math.abs(netProjected).toFixed(2) + (netProjected < 0 ? ' deficit' : '') + '</div>';
  h += '<div style="font-size:0.75rem;color:var(--warm-gray,#888);">cash + AR in − AP out</div>';
  h += '</div>';

  h += '</div></div>';

  return h;
}

// ── AR Tab ────────────────────────────────────────────────────────────────────

function setupArTab() {
  injectFinancePulseCSS();
  _arFilter = 'all';
  var el = document.getElementById('financeArTab');
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
    '<h2 style="margin:0;font-size:1.2rem;font-weight:700;">Accounts Receivable</h2>' +
    '<button class="btn btn-secondary btn-small" onclick="loadArData()">Refresh</button>' +
    '</div>' +
    '<div id="fArContent">' + skeletonCards(5) + '<div style="margin-top:16px;">' + skeletonTable(5,6) + '</div></div>' +
    '</div>';
  loadArData();
}

async function loadArData() {
  var el = document.getElementById('fArContent');
  if (!el) return;
  el.innerHTML = skeletonCards(5) + '<div style="margin-top:16px;">' + skeletonTable(5,6) + '</div>';

  try {
    var asOf = todayStr();
    var [sentRaw, overdueRaw] = await Promise.all([
      MastDB.query('orders').orderByChild('invoiceStatus').equalTo('sent').limitToLast(500).once(),
      MastDB.query('orders').orderByChild('invoiceStatus').equalTo('overdue').limitToLast(500).once()
    ]);

    var allOrders = Object.assign({}, sentRaw || {}, overdueRaw || {});
    var rows = [];

    Object.entries(allOrders).forEach(function(kv) {
      var orderId = kv[0], o = kv[1];
      var totalCents = Math.round((o.total || 0) * 100);
      var paidCents  = o.invoicePaidAmount || 0;
      var amtDue     = totalCents - paidCents;
      if (amtDue <= 0) return;

      var daysOver = 0;
      var bucket = 'current';
      if (o.invoiceDueDate) {
        var dueMs = new Date(o.invoiceDueDate + 'T00:00:00Z').getTime();
        var asOfMs = new Date(asOf + 'T00:00:00Z').getTime();
        daysOver = Math.max(0, Math.floor((asOfMs - dueMs) / 86400000));
        if (daysOver <= 0) bucket = 'current';
        else if (daysOver <= 30) bucket = '1_to_30';
        else if (daysOver <= 60) bucket = '31_to_60';
        else if (daysOver <= 90) bucket = '61_to_90';
        else bucket = '90_plus';
      }

      rows.push({ orderId, invoiceNumber: o.invoiceNumber || '', customerName: o.customerName || 'Unknown', amtDue, totalCents, dueDate: o.invoiceDueDate || '', daysOverdue: daysOver, bucket, invoiceStatus: o.invoiceStatus });
    });

    rows.sort(function(a,b) { return b.daysOverdue - a.daysOverdue; });
    _arData = { rows: rows, asOf: asOf };

    el.innerHTML = renderArContent();
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('AR load failed: ' + err.message, true);
  }
}

function renderArContent() {
  if (!_arData) return '';
  var rows = _arData.rows;

  var summary = { current: 0, '1_to_30': 0, '31_to_60': 0, '61_to_90': 0, '90_plus': 0 };
  var counts  = { current: 0, '1_to_30': 0, '31_to_60': 0, '61_to_90': 0, '90_plus': 0 };
  var total = 0;
  rows.forEach(function(r) { summary[r.bucket] += r.amtDue; counts[r.bucket]++; total += r.amtDue; });

  var h = '';

  // Summary cards
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">';
  h += statCard('Total AR', fmt$(total), '#3b82f6', rows.length + ' invoice' + (rows.length !== 1 ? 's' : ''));
  [['current','Current'],['1_to_30','30+'],['31_to_60','60+'],['61_to_90','90+']].forEach(function(kl) {
    var color = bucketColor(kl[0]);
    h += statCard(kl[1], fmt$(summary[kl[0]]), color, counts[kl[0]] + (counts[kl[0]] !== 1 ? ' invoices' : ' invoice'));
  });
  h += '</div>';

  // Filter
  h += '<div style="display:flex;gap:6px;margin-bottom:14px;">';
  [['all','All'], ['current','Current'], ['overdue','Overdue']].forEach(function(kl) {
    var active = _arFilter === kl[0];
    h += '<button class="btn btn-' + (active ? 'primary' : 'secondary') + ' btn-small" onclick="finArFilter(\'' + kl[0] + '\')">' + kl[1] + '</button>';
  });
  h += '</div>';

  // Filter rows
  var filtered = rows.filter(function(r) {
    if (_arFilter === 'all') return true;
    if (_arFilter === 'current') return r.bucket === 'current';
    if (_arFilter === 'overdue') return r.bucket !== 'current';
    return true;
  });

  if (filtered.length === 0) {
    if (rows.length === 0) {
      h += '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
        '<div style="font-size:2rem;margin-bottom:8px;">✅</div>' +
        '<div style="font-size:0.95rem;font-weight:500;">No outstanding invoices</div>' +
        '<div style="font-size:0.85rem;margin-top:4px;">Create invoices from the <button class="btn btn-secondary btn-small" onclick="navigateTo(\'orders\')">Orders</button> view.</div></div>';
    } else {
      h += '<div style="color:var(--warm-gray,#888);font-size:0.85rem;padding:12px 0;">No invoices match this filter.</div>';
    }
    return h;
  }

  // Table
  h += '<div style="overflow-x:auto;">';
  h += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
  ['Customer','Invoice #','Order','Amount Due','Due Date','Age','Status',''].forEach(function(col) {
    h += '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">' + col + '</th>';
  });
  h += '</tr></thead><tbody>';

  filtered.forEach(function(r) {
    h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">';
    h += '<td style="padding:10px;">' + e(r.customerName) + '</td>';
    h += '<td style="padding:10px;font-size:0.8rem;color:var(--warm-gray,#888);">' + e(r.invoiceNumber || '—') + '</td>';
    h += '<td style="padding:10px;font-size:0.8rem;"><a href="#" style="color:var(--teal,#2a9d8f);" onclick="event.preventDefault();navigateTo(\'orders\')">' + e(r.orderId.slice(-8)) + '</a></td>';
    h += '<td style="padding:10px;font-weight:700;color:' + bucketColor(r.bucket) + ';">' + fmt$(r.amtDue) + '</td>';
    h += '<td style="padding:10px;font-size:0.8rem;">' + e(r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—') + '</td>';
    h += '<td style="padding:10px;">' + agingBadge(r.daysOverdue) + '</td>';
    h += '<td style="padding:10px;"><span style="background:rgba(241,164,0,0.15);color:#f59e0b;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + e(r.invoiceStatus) + '</span></td>';
    h += '<td style="padding:10px;white-space:nowrap;">';
    h += '<button class="btn btn-primary btn-small" data-order-id="' + e(r.orderId) + '" data-amt="' + r.totalCents + '" onclick="finArMarkPaid(this.dataset.orderId, parseInt(this.dataset.amt))">Mark Paid</button>';
    h += '</td></tr>';
  });

  h += '</tbody></table></div>';
  return h;
}

window.finArFilter = function(bucket) {
  _arFilter = bucket;
  var el = document.getElementById('fArContent');
  if (el) el.innerHTML = renderArContent();
};

window.finArMarkPaid = async function(orderId, totalCents) {
  try {
    var now = new Date().toISOString();
    await MastDB.update('orders/' + orderId, {
      invoiceStatus: 'paid',
      invoicePaidAt: now,
      invoicePaidAmount: totalCents,
      updatedAt: now
    });
    showToast('Invoice marked as paid');
    loadArData();
  } catch (err) {
    showToast('Error: ' + e(err.message), true);
  }
};

// ── AP Tab ────────────────────────────────────────────────────────────────────

function setupApTab() {
  injectFinancePulseCSS();
  _apFilter = 'all';
  var el = document.getElementById('financeApTab');
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
    '<h2 style="margin:0;font-size:1.2rem;font-weight:700;">Accounts Payable</h2>' +
    '<button class="btn btn-secondary btn-small" onclick="loadApData()">Refresh</button>' +
    '</div>' +
    '<div id="fApContent">' + skeletonCards(5) + '<div style="margin-top:16px;">' + skeletonTable(5,7) + '</div></div>' +
    '</div>';
  loadApData();
}

async function loadApData() {
  var el = document.getElementById('fApContent');
  if (!el) return;
  el.innerHTML = skeletonCards(5) + '<div style="margin-top:16px;">' + skeletonTable(5,7) + '</div>';

  try {
    var asOf = todayStr();
    var [unpaidRaw, partialRaw, vendorsRaw] = await Promise.all([
      MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('unpaid').limitToLast(500).once(),
      MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('partial').limitToLast(500).once(),
      MastDB.get('admin/vendors')
    ]);

    var vendors = vendorsRaw || {};
    var allReceipts = Object.assign({}, unpaidRaw || {}, partialRaw || {});
    var rows = [];

    Object.entries(allReceipts).forEach(function(kv) {
      var receiptId = kv[0], r = kv[1];
      var totalCents = r.amountCents || 0;
      var paidCents  = r.paidAmount  || 0;
      var amtDue     = totalCents - paidCents;
      if (amtDue <= 0) return;

      var daysOver = 0;
      var bucket = 'current';
      if (r.dueDate) {
        var dueMs  = new Date(r.dueDate + 'T00:00:00Z').getTime();
        var asOfMs = new Date(asOf + 'T00:00:00Z').getTime();
        daysOver   = Math.max(0, Math.floor((asOfMs - dueMs) / 86400000));
        if (daysOver <= 0) bucket = 'current';
        else if (daysOver <= 30) bucket = '1_to_30';
        else if (daysOver <= 60) bucket = '31_to_60';
        else if (daysOver <= 90) bucket = '61_to_90';
        else bucket = '90_plus';
      }

      var vendorName = (vendors[r.vendorId] && vendors[r.vendorId].name) || 'Unknown Vendor';

      rows.push({ receiptId, vendorName, vendorInvoiceRef: r.vendorInvoiceRef || '', totalCents, paidCents, amtDue, dueDate: r.dueDate || '', daysOverdue: daysOver, bucket, paymentStatus: r.paymentStatus });
    });

    rows.sort(function(a,b) { return b.daysOverdue - a.daysOverdue; });
    _apData = { rows: rows, asOf: asOf };

    el.innerHTML = renderApContent();
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('AP load failed: ' + err.message, true);
  }
}

function renderApContent() {
  if (!_apData) return '';
  var rows = _apData.rows;

  var summary = { current: 0, '1_to_30': 0, '31_to_60': 0, '61_to_90': 0, '90_plus': 0 };
  var counts  = { current: 0, '1_to_30': 0, '31_to_60': 0, '61_to_90': 0, '90_plus': 0 };
  var total = 0;
  rows.forEach(function(r) { summary[r.bucket] += r.amtDue; counts[r.bucket]++; total += r.amtDue; });

  var h = '';

  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">';
  h += statCard('Total AP', fmt$(total), '#f97316', rows.length + ' receipt' + (rows.length !== 1 ? 's' : ''));
  [['current','Current'],['1_to_30','30+'],['31_to_60','60+'],['61_to_90','90+']].forEach(function(kl) {
    var color = bucketColor(kl[0]);
    h += statCard(kl[1], fmt$(summary[kl[0]]), color, counts[kl[0]] + (counts[kl[0]] !== 1 ? ' receipts' : ' receipt'));
  });
  h += '</div>';

  // Filter + group toggle
  h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">';
  h += '<div style="display:flex;gap:6px;">';
  [['all','All'], ['current','Current'], ['overdue','Overdue']].forEach(function(kl) {
    var active = _apFilter === kl[0];
    h += '<button class="btn btn-' + (active ? 'primary' : 'secondary') + ' btn-small" onclick="finApFilter(\'' + kl[0] + '\')">' + kl[1] + '</button>';
  });
  h += '</div>';
  h += '<button class="btn btn-' + (_apGroupByVendor ? 'primary' : 'secondary') + ' btn-small" onclick="finApToggleGroupByVendor()">' + (_apGroupByVendor ? 'Group: Vendor ✓' : 'Group by Vendor') + '</button>';
  h += '</div>';

  var filtered = rows.filter(function(r) {
    if (_apFilter === 'all') return true;
    if (_apFilter === 'current') return r.bucket === 'current';
    if (_apFilter === 'overdue') return r.bucket !== 'current';
    return true;
  });

  if (filtered.length === 0) {
    if (rows.length === 0) {
      h += '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
        '<div style="font-size:2rem;margin-bottom:8px;">✅</div>' +
        '<div style="font-size:0.95rem;font-weight:500;">No outstanding payables</div>' +
        '<div style="font-size:0.85rem;margin-top:4px;">Unpaid receipts appear here. Create receipts in <button class="btn btn-secondary btn-small" onclick="navigateTo(\'procurement\')">Procurement</button>.</div></div>';
    } else {
      h += '<div style="color:var(--warm-gray,#888);font-size:0.85rem;padding:12px 0;">No receipts match this filter.</div>';
    }
    return h;
  }

  // Partial payment modal placeholder (shown inline below a row when triggered)
  h += '<div id="fApPartialModal" style="display:none;background:var(--bg-secondary,#232323);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px;margin-bottom:12px;"></div>';

  if (_apGroupByVendor) {
    h += renderApGrouped(filtered);
  } else {
    h += renderApFlat(filtered);
  }
  return h;
}

function renderApFlat(filtered) {
  var h = '<div style="overflow-x:auto;">';
  h += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
  ['Vendor','Ref','Total','Paid','Remaining','Due Date','Age','Status',''].forEach(function(col) {
    h += '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">' + col + '</th>';
  });
  h += '</tr></thead><tbody>';

  filtered.forEach(function(r) {
    h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">';
    h += '<td style="padding:10px;font-weight:600;">' + e(r.vendorName) + '</td>';
    h += '<td style="padding:10px;font-size:0.8rem;color:var(--warm-gray,#888);">' + e(r.vendorInvoiceRef || r.receiptId.slice(-8)) + '</td>';
    h += '<td style="padding:10px;">' + fmt$(r.totalCents) + '</td>';
    h += '<td style="padding:10px;color:#22c55e;">' + fmt$(r.paidCents) + '</td>';
    h += '<td style="padding:10px;font-weight:700;color:' + bucketColor(r.bucket) + ';">' + fmt$(r.amtDue) + '</td>';
    h += '<td style="padding:10px;font-size:0.8rem;">' + e(r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—') + '</td>';
    h += '<td style="padding:10px;">' + agingBadge(r.daysOverdue) + '</td>';
    h += '<td style="padding:10px;"><span style="background:' + (r.paymentStatus === 'partial' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.12)') + ';color:' + (r.paymentStatus === 'partial' ? '#eab308' : '#ef4444') + ';padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + e(r.paymentStatus) + '</span></td>';
    h += '<td style="padding:10px;white-space:nowrap;display:flex;gap:4px;">';
    h += '<button class="btn btn-primary btn-small" data-rid="' + e(r.receiptId) + '" data-total="' + r.totalCents + '" onclick="finApMarkPaid(this.dataset.rid, parseInt(this.dataset.total))">Paid</button>';
    h += '<button class="btn btn-secondary btn-small" data-rid="' + e(r.receiptId) + '" data-paid="' + r.paidCents + '" data-total="' + r.totalCents + '" onclick="finApShowPartial(this.dataset.rid, parseInt(this.dataset.paid), parseInt(this.dataset.total))">Partial</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="navigateTo(\'procurement\')" title="View in Procurement">→</button>';
    h += '</td></tr>';
  });

  h += '</tbody></table></div>';
  return h;
}

var _bucketOrder = { current: 0, '1_to_30': 1, '31_to_60': 2, '61_to_90': 3, '90_plus': 4 };

function renderApGrouped(filtered) {
  // Build per-vendor groups
  var groups = {};
  filtered.forEach(function(r) {
    var k = r.vendorName;
    if (!groups[k]) groups[k] = { vendorName: k, rows: [], totalDue: 0, worstBucket: 'current', oldestDueDate: null };
    var g = groups[k];
    g.rows.push(r);
    g.totalDue += r.amtDue;
    if ((_bucketOrder[r.bucket] || 0) > (_bucketOrder[g.worstBucket] || 0)) g.worstBucket = r.bucket;
    if (r.dueDate && (!g.oldestDueDate || r.dueDate < g.oldestDueDate)) g.oldestDueDate = r.dueDate;
  });

  var vendorKeys = Object.keys(groups).sort(function(a, b) {
    return (_bucketOrder[groups[b].worstBucket] || 0) - (_bucketOrder[groups[a].worstBucket] || 0);
  });

  var h = '<div style="display:flex;flex-direction:column;gap:8px;">';

  vendorKeys.forEach(function(k) {
    var g = groups[k];
    var isExpanded = !!_apExpandedVendors[k];
    var worstColor = bucketColor(g.worstBucket);
    var dueDateStr = g.oldestDueDate ? new Date(g.oldestDueDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';

    h += '<div style="border:1px solid rgba(255,255,255,0.1);border-radius:8px;overflow:hidden;">';

    // Vendor summary row (clickable)
    h += '<button type="button" onclick="finApToggleVendorExpand(' + JSON.stringify(k) + ')" ' +
      'style="all:unset;display:block;width:100%;box-sizing:border-box;cursor:pointer;' +
      'background:var(--bg-secondary,#232323);padding:12px 14px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;font-size:0.85rem;">';
    h += '<div style="display:flex;align-items:center;gap:10px;">';
    h += '<span style="font-weight:700;">' + e(g.vendorName) + '</span>';
    h += agingBadge(g.worstBucket === 'current' ? 0 : g.worstBucket === '1_to_30' ? 15 : g.worstBucket === '31_to_60' ? 45 : g.worstBucket === '61_to_90' ? 75 : 100);
    h += '<span style="color:var(--warm-gray,#888);font-size:0.78rem;">' + g.rows.length + ' receipt' + (g.rows.length !== 1 ? 's' : '') + '</span>';
    h += '</div>';
    h += '<div style="display:flex;align-items:center;gap:16px;">';
    h += '<span><span style="color:var(--warm-gray,#888);font-size:0.78rem;">Due</span> <span style="font-size:0.8rem;">' + e(dueDateStr) + '</span></span>';
    h += '<span style="font-weight:700;color:' + worstColor + ';">' + fmt$(g.totalDue) + '</span>';
    h += '<span style="color:var(--warm-gray,#888);font-size:0.85rem;">' + (isExpanded ? '▾' : '▸') + '</span>';
    h += '</div></div></button>';

    // Expanded receipt rows
    if (isExpanded) {
      h += '<div style="border-top:1px solid rgba(255,255,255,0.08);">';
      h += '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">';
      h += '<thead><tr style="background:rgba(255,255,255,0.03);">';
      ['Ref','Total','Paid','Remaining','Due Date','Age','Status',''].forEach(function(col) {
        h += '<th style="text-align:left;padding:7px 10px;font-size:0.7rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">' + col + '</th>';
      });
      h += '</tr></thead><tbody>';
      g.rows.forEach(function(r) {
        h += '<tr style="border-top:1px solid rgba(255,255,255,0.06);">';
        h += '<td style="padding:8px 10px;color:var(--warm-gray,#888);">' + e(r.vendorInvoiceRef || r.receiptId.slice(-8)) + '</td>';
        h += '<td style="padding:8px 10px;">' + fmt$(r.totalCents) + '</td>';
        h += '<td style="padding:8px 10px;color:#22c55e;">' + fmt$(r.paidCents) + '</td>';
        h += '<td style="padding:8px 10px;font-weight:700;color:' + bucketColor(r.bucket) + ';">' + fmt$(r.amtDue) + '</td>';
        h += '<td style="padding:8px 10px;">' + e(r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—') + '</td>';
        h += '<td style="padding:8px 10px;">' + agingBadge(r.daysOverdue) + '</td>';
        h += '<td style="padding:8px 10px;"><span style="background:' + (r.paymentStatus === 'partial' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.12)') + ';color:' + (r.paymentStatus === 'partial' ? '#eab308' : '#ef4444') + ';padding:2px 6px;border-radius:4px;font-size:0.7rem;font-weight:600;">' + e(r.paymentStatus) + '</span></td>';
        h += '<td style="padding:8px 10px;white-space:nowrap;display:flex;gap:4px;">';
        h += '<button class="btn btn-primary btn-small" data-rid="' + e(r.receiptId) + '" data-total="' + r.totalCents + '" onclick="finApMarkPaid(this.dataset.rid, parseInt(this.dataset.total))">Paid</button>';
        h += '<button class="btn btn-secondary btn-small" data-rid="' + e(r.receiptId) + '" data-paid="' + r.paidCents + '" data-total="' + r.totalCents + '" onclick="finApShowPartial(this.dataset.rid, parseInt(this.dataset.paid), parseInt(this.dataset.total))">Partial</button>';
        h += '<button class="btn btn-secondary btn-small" onclick="navigateTo(\'procurement\')" title="View in Procurement">→</button>';
        h += '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
  });

  h += '</div>';
  return h;
}

window.finApFilter = function(bucket) {
  _apFilter = bucket;
  var el = document.getElementById('fApContent');
  if (el) el.innerHTML = renderApContent();
};

window.finApToggleGroupByVendor = function() {
  _apGroupByVendor = !_apGroupByVendor;
  _apExpandedVendors = {};
  var el = document.getElementById('fApContent');
  if (el) el.innerHTML = renderApContent();
};

window.finApToggleVendorExpand = function(vendorName) {
  _apExpandedVendors[vendorName] = !_apExpandedVendors[vendorName];
  var el = document.getElementById('fApContent');
  if (el) el.innerHTML = renderApContent();
};

window.finApMarkPaid = async function(receiptId, totalCents) {
  try {
    var now = new Date().toISOString();
    await MastDB.update('admin/purchaseReceipts/' + receiptId, {
      paymentStatus: 'paid',
      paidAmount: totalCents,
      updatedAt: now
    });
    showToast('Receipt marked as paid');
    loadApData();
  } catch (err) {
    showToast('Error: ' + e(err.message), true);
  }
};

window.finApShowPartial = function(receiptId, currentPaid, totalCents) {
  var modal = document.getElementById('fApPartialModal');
  if (!modal) return;
  var remaining = totalCents - currentPaid;
  modal.style.display = '';
  modal.innerHTML =
    '<div style="font-size:0.9rem;font-weight:600;margin-bottom:10px;">Partial Payment — ' + e(receiptId.slice(-8)) + '</div>' +
    '<div style="font-size:0.85rem;color:var(--warm-gray,#888);margin-bottom:8px;">Outstanding: ' + fmt$(remaining) + ' · Currently paid: ' + fmt$(currentPaid) + '</div>' +
    '<div style="display:flex;gap:8px;align-items:center;">' +
    '<span style="font-size:0.85rem;">$</span>' +
    '<input type="number" id="fApPartialAmt" min="0.01" step="0.01" max="' + (remaining/100).toFixed(2) + '" placeholder="Amount paid" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:var(--text,#fff);padding:6px 10px;font-size:0.85rem;width:120px;">' +
    '<button class="btn btn-primary btn-small" data-rid="' + e(receiptId) + '" data-paid="' + currentPaid + '" data-total="' + totalCents + '" onclick="finApSubmitPartial(this.dataset.rid, parseInt(this.dataset.paid), parseInt(this.dataset.total))">Apply</button>' +
    '<button class="btn btn-secondary btn-small" onclick="document.getElementById(\'fApPartialModal\').style.display=\'none\'">Cancel</button>' +
    '</div>';
  var inp = document.getElementById('fApPartialAmt');
  if (inp) inp.focus();
};

window.finApSubmitPartial = async function(receiptId, currentPaid, totalCents) {
  var inp = document.getElementById('fApPartialAmt');
  if (!inp) return;
  var amount = parseFloat(inp.value);
  if (isNaN(amount) || amount <= 0) { showToast('Enter a valid payment amount', true); return; }
  var addedCents = Math.round(amount * 100);
  var newPaid = currentPaid + addedCents;
  if (newPaid > totalCents) { showToast('Payment exceeds balance due', true); return; }
  var newStatus = newPaid >= totalCents ? 'paid' : 'partial';
  try {
    var now = new Date().toISOString();
    await MastDB.update('admin/purchaseReceipts/' + receiptId, {
      paymentStatus: newStatus,
      paidAmount: newPaid,
      updatedAt: now
    });
    showToast(newStatus === 'paid' ? 'Receipt fully paid' : 'Partial payment recorded');
    loadApData();
  } catch (err) {
    showToast('Error: ' + e(err.message), true);
  }
};

// ── Tax Tab ───────────────────────────────────────────────────────────────────

var _taxSection = 'sales-tax';
var _1099Year = new Date().getFullYear();
var _1099ContractorData = null;
var _reportYear = new Date().getFullYear();
var _loanReportMetrics = '';

function renderTaxHeader() {
  var tabs = [['sales-tax','Sales Tax by State'], ['nexus','Nexus Tracker'], ['1099','1099 Prep']];
  var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
  h += '<h2 style="margin:0;font-size:1.2rem;font-weight:700;">Tax</h2>';
  h += '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:600;">Admin Only</span>';
  h += '</div>';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">';
  tabs.forEach(function(t) {
    var active = _taxSection === t[0];
    h += '<button class="btn btn-' + (active?'primary':'secondary') + ' btn-small" onclick="taxSection(\'' + t[0] + '\')">' + e(t[1]) + '</button>';
  });
  h += '</div>';
  return h;
}

function setupTaxTab() {
  injectFinancePulseCSS();
  var el = document.getElementById('financeTaxTab');
  if (!el) return;
  _taxSection = 'sales-tax';
  _1099Year = new Date().getFullYear();
  el.innerHTML = '<div style="padding:20px;max-width:1100px;">' + renderTaxHeader() +
    '<div id="fTaxContent">' + skeletonTable(5,4) + '</div></div>';
  loadTaxSalesTax();
}

window.taxSection = function(section) {
  _taxSection = section;
  var el = document.getElementById('financeTaxTab');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;max-width:1100px;">' + renderTaxHeader() +
    '<div id="fTaxContent">' + skeletonTable(5,4) + '</div></div>';
  if (section === 'sales-tax') loadTaxSalesTax();
  else if (section === 'nexus') loadTaxNexus();
  else if (section === '1099') loadTax1099();
};

function renderFilingDeadlineBanner() {
  var now = new Date();
  var year = now.getFullYear();
  var deadlines = [
    { q: 'Q1', d: new Date(year, 3, 15) },
    { q: 'Q2', d: new Date(year, 6, 15) },
    { q: 'Q3', d: new Date(year, 9, 15) },
    { q: 'Q4', d: new Date(year + 1, 0, 15) }
  ];
  var upcoming = null;
  for (var i = 0; i < deadlines.length; i++) {
    if (deadlines[i].d >= now) { upcoming = deadlines[i]; break; }
  }
  if (!upcoming) upcoming = { q: 'Q4', d: new Date(year + 1, 0, 15) };
  var daysUntil = Math.ceil((upcoming.d.getTime() - now.getTime()) / 86400000);
  var urgencyColor = daysUntil <= 14 ? '#ef4444' : daysUntil <= 30 ? '#eab308' : '#3b82f6';
  var label = upcoming.d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return '<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">' +
    '<span>📅</span>' +
    '<div><span style="font-size:0.85rem;font-weight:600;color:' + urgencyColor + ';">' + e(upcoming.q) + ' filing due ' + e(label) + '</span>' +
    '<span style="font-size:0.8rem;color:var(--warm-gray,#888);margin-left:8px;">' + daysUntil + ' days away</span></div>' +
    '</div>';
}

function loadTaxSalesTax() {
  var el = document.getElementById('fTaxContent');
  if (!el) return;
  var start = quarterStart();
  var end = todayStr();
  el.innerHTML = periodPicker('fTax', start, end) +
    '<div id="fTaxSalesContent">' + skeletonTable(5,4) + '</div>';
  loadTaxSalesTaxData();
}

async function loadTaxSalesTaxData() {
  var startEl = document.getElementById('fTaxS');
  var endEl = document.getElementById('fTaxE');
  var start = startEl ? startEl.value : quarterStart();
  var end = endEl ? endEl.value : todayStr();
  var el = document.getElementById('fTaxSalesContent');
  if (!el) return;
  el.innerHTML = skeletonTable(5,4);
  try {
    var [ordersRaw, nexusRaw] = await Promise.all([
      MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(start)).endAt(isoEnd(end)).limitToLast(2000).once(),
      MastDB.get('admin/nexusRegistrations')
    ]);
    var orders = Object.values(ordersRaw || {});
    var nexus = nexusRaw || {};
    var byState = {};
    orders.forEach(function(o) {
      if (o.status === 'cancelled') return;
      var state = o.taxState || o.shippingState; if (!state) return;
      if (!byState[state]) byState[state] = { taxCollected: 0, orderCount: 0 };
      byState[state].taxCollected += (o.taxCents || Math.round((o.tax || 0) * 100));
      byState[state].orderCount++;
    });
    el.innerHTML = renderTaxSalesTax(byState, nexus, start, end);
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Tax load failed: ' + err.message, true);
  }
}
window.loadTaxSalesTaxData = loadTaxSalesTaxData;

function renderTaxSalesTax(byState, nexus, start, end) {
  var states = Object.keys(byState).sort(function(a,b) { return byState[b].taxCollected - byState[a].taxCollected; });
  var totalTax = states.reduce(function(sum,s) { return sum + byState[s].taxCollected; }, 0);
  var h = renderFilingDeadlineBanner();

  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  h += statCard('Total Tax Collected', fmt$(totalTax), '#16a34a');
  h += statCard('States with Sales', String(states.length), 'var(--text,#fff)');
  var regCount = states.filter(function(s) { return nexus[s] && nexus[s].registered; }).length;
  h += statCard('Registered States', String(regCount), regCount > 0 && regCount === states.length ? '#22c55e' : '#eab308');
  h += statCard('Period', toDateShort(start) + ' – ' + toDateShort(end), 'var(--warm-gray,#888)');
  h += '</div>';

  if (states.length === 0) {
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
      '<div style="font-size:2rem;margin-bottom:8px;">🧾</div>' +
      '<div style="font-size:0.95rem;font-weight:500;">No taxable orders in this period</div></div>';
  }

  h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
  ['State', 'Nexus Status', 'Tax Collected', 'Orders'].forEach(function(col) {
    h += '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">' + col + '</th>';
  });
  h += '</tr></thead><tbody>';
  states.forEach(function(state) {
    var d = byState[state];
    var reg = nexus[state] && nexus[state].registered;
    var badge;
    if (reg) {
      badge = '<span style="background:rgba(34,197,94,0.15);color:#22c55e;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Registered</span>';
    } else {
      badge = '<span style="background:rgba(156,163,175,0.12);color:#9ca3af;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Not Registered</span>';
    }
    h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">';
    h += '<td style="padding:10px;font-weight:600;">' + e(state) + '</td>';
    h += '<td style="padding:10px;">' + badge + '</td>';
    h += '<td style="padding:10px;font-weight:700;color:#16a34a;">' + fmt$(d.taxCollected) + '</td>';
    h += '<td style="padding:10px;">' + d.orderCount + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

async function loadTaxNexus() {
  var el = document.getElementById('fTaxContent');
  if (!el) return;
  el.innerHTML = skeletonCards(3) + '<div style="margin-top:16px;">' + skeletonTable(5,5) + '</div>';
  try {
    var endDate = todayStr();
    var d12 = new Date(); d12.setFullYear(d12.getFullYear() - 1);
    var startDate = d12.getFullYear() + '-' + String(d12.getMonth()+1).padStart(2,'0') + '-01';

    var [ordersRaw, nexusRaw] = await Promise.all([
      MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(startDate)).endAt(isoEnd(endDate)).limitToLast(5000).once(),
      MastDB.get('admin/nexusRegistrations')
    ]);
    var orders = Object.values(ordersRaw || {});
    var nexus = nexusRaw || {};
    var THRESHOLD = 10000000; // $100K in cents (exclusive: > 10000000)
    var TXN_THRESHOLD = 200;
    var APPROACHING = 0.75;

    var byState = {};
    orders.forEach(function(o) {
      if (o.status === 'cancelled') return;
      var state = o.taxState || o.shippingState; if (!state) return;
      var cents = o.totalCents || Math.round((o.total || 0) * 100);
      if (!byState[state]) byState[state] = { revenue: 0, count: 0 };
      byState[state].revenue += cents;
      byState[state].count++;
    });
    Object.keys(nexus).forEach(function(s) { if (!byState[s]) byState[s] = { revenue: 0, count: 0 }; });
    var states = Object.keys(byState).sort(function(a,b) { return byState[b].revenue - byState[a].revenue; });
    el.innerHTML = renderTaxNexus(states, byState, nexus, THRESHOLD, TXN_THRESHOLD, APPROACHING, startDate, endDate);
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Nexus load failed: ' + err.message, true);
  }
}

function renderTaxNexus(states, byState, nexus, threshold, txnThreshold, approachingPct, startDate, endDate) {
  var actionRequired = [], approaching = [], registered = [], below = [];
  states.forEach(function(state) {
    var d = byState[state];
    var reg = nexus[state] && nexus[state].registered;
    var above = d.revenue > threshold || d.count > txnThreshold;
    var near = !above && (d.revenue > threshold * approachingPct || d.count > txnThreshold * approachingPct);
    if (above && !reg) actionRequired.push(state);
    else if (reg) registered.push(state);
    else if (near) approaching.push(state);
    else below.push(state);
  });

  var h = '';
  if (actionRequired.length > 0) {
    h += '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;padding:10px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">';
    h += '<span>⚠️</span><span style="font-size:0.85rem;font-weight:600;color:#ef4444;">Action required — you have nexus in ';
    h += actionRequired.length + ' state' + (actionRequired.length > 1 ? 's' : '') + ' where you are not registered: ' + e(actionRequired.join(', ')) + '</span></div>';
  }

  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  h += statCard('Registered', String(registered.length), '#22c55e');
  if (actionRequired.length > 0) h += statCard('Action Required', String(actionRequired.length), '#ef4444', 'above threshold, unregistered');
  if (approaching.length > 0) h += statCard('Approaching', String(approaching.length), '#eab308', '>75% of $100K');
  h += statCard('Trailing 12mo', toDateShort(startDate) + ' – ' + toDateShort(endDate), 'var(--warm-gray,#888)');
  h += '</div>';

  if (states.length === 0) {
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);"><div style="font-size:0.95rem;font-weight:500;">No sales data found for trailing 12 months</div></div>';
  }

  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:10px;">$100K revenue threshold · 200 transaction threshold · Exclusive boundaries (>$100K triggers nexus)</div>';
  h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
  ['State', 'Revenue (12mo)', 'Transactions', '% of $100K', 'Status'].forEach(function(col) {
    h += '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">' + col + '</th>';
  });
  h += '</tr></thead><tbody>';
  states.forEach(function(state) {
    var d = byState[state];
    var reg = nexus[state] && nexus[state].registered;
    var above = d.revenue > threshold || d.count > txnThreshold;
    var near = !above && (d.revenue > threshold * approachingPct || d.count > txnThreshold * approachingPct);
    var revPct = Math.min(Math.round(d.revenue / threshold * 100), 999);
    var barColor = reg ? '#22c55e' : above ? '#ef4444' : near ? '#eab308' : '#9ca3af';
    var badge;
    if (reg) badge = '<span style="background:rgba(34,197,94,0.15);color:#22c55e;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Registered</span>';
    else if (above) badge = '<span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Above threshold — register now</span>';
    else if (near) badge = '<span style="background:rgba(234,179,8,0.15);color:#eab308;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Approaching</span>';
    else badge = '<span style="background:rgba(156,163,175,0.08);color:#9ca3af;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Below</span>';

    h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">';
    h += '<td style="padding:10px;font-weight:600;">' + e(state) + '</td>';
    h += '<td style="padding:10px;font-weight:700;">' + fmt$(d.revenue) + '</td>';
    h += '<td style="padding:10px;">' + d.count + '</td>';
    h += '<td style="padding:10px;min-width:130px;"><div style="display:flex;align-items:center;gap:8px;">' +
      '<div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">' +
      '<div style="height:100%;width:' + Math.min(revPct,100) + '%;background:' + barColor + ';border-radius:3px;"></div></div>' +
      '<span style="font-size:0.75rem;color:var(--warm-gray,#888);white-space:nowrap;">' + revPct + '%</span></div></td>';
    h += '<td style="padding:10px;">' + badge + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function loadTax1099() {
  var el = document.getElementById('fTaxContent');
  if (!el) return;
  var year = _1099Year;
  var nowYear = new Date().getFullYear();
  var yearOpts = '';
  for (var y = nowYear; y >= nowYear - 3; y--) {
    yearOpts += '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + y + '</option>';
  }
  var h = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">';
  h += '<span style="font-size:0.85rem;color:var(--warm-gray,#888);">Tax Year:</span>';
  h += '<select id="f1099Year" onchange="fin1099ChangeYear(this.value)" style="background:var(--bg-secondary,#232323);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 10px;font-size:0.85rem;">' + yearOpts + '</select>';
  h += '<button class="btn btn-secondary btn-small" onclick="loadTax1099Data()">Load</button>';
  h += '</div>';
  h += '<div id="f1099Content">' + skeletonTable(5,4) + '</div>';
  el.innerHTML = h;
  loadTax1099Data();
}

window.fin1099ChangeYear = function(year) { _1099Year = parseInt(year); loadTax1099Data(); };

window.loadTax1099Data = async function() {
  var el = document.getElementById('f1099Content');
  if (!el) return;
  el.innerHTML = skeletonTable(5,4);
  var year = _1099Year;
  var startISO = year + '-01-01T00:00:00Z';
  var endISO   = year + '-12-31T23:59:59Z';
  try {
    var [vendorsRaw, receiptsRaw] = await Promise.all([
      MastDB.get('admin/vendors'),
      MastDB.query('admin/purchaseReceipts').orderByChild('receivedAt').startAt(startISO).endAt(endISO).limitToLast(2000).once()
    ]);
    var vendors = vendorsRaw || {};
    var receipts = Object.values(receiptsRaw || {});
    var totals = {};
    receipts.forEach(function(r) {
      var v = vendors[r.vendorId];
      if (!v) return;
      var vType = v.vendorType || v.payeeType;
      if (vType !== 'contractor') return;
      if (r.paymentStatus !== 'paid') return;
      if (!totals[r.vendorId]) totals[r.vendorId] = 0;
      totals[r.vendorId] += r.amountCents || 0;
    });
    var contractors = [];
    Object.keys(totals).forEach(function(vid) {
      var total = totals[vid];
      if (total <= 60000) return; // > $600 threshold (exclusive)
      var v = vendors[vid];
      var taxId = v.taxId;
      var hasTaxId = !!(taxId && String(taxId).trim().length > 0);
      contractors.push({
        name: v.name || 'Unknown', taxId: taxId,
        maskedTaxId: hasTaxId ? 'XXX-XX-' + String(taxId).replace(/[^0-9]/g,'').slice(-4) : null,
        hasTaxId: hasTaxId, totalPaid: total
      });
    });
    contractors.sort(function(a,b) { return b.totalPaid - a.totalPaid; });
    _1099ContractorData = contractors;
    el.innerHTML = render1099(contractors, year);
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('1099 load failed: ' + err.message, true);
  }
};

function render1099(contractors, year) {
  var missingCount = contractors.filter(function(c) { return !c.hasTaxId; }).length;
  var h = '';
  h += '<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:10px;">';
  h += '<span>📋</span><span style="font-size:0.85rem;">1099-NEC forms must be sent to contractors by <strong>January 31, ' + (year+1) + '</strong></span></div>';
  if (missingCount > 0) {
    h += '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:10px;">';
    h += '<span>⚠️</span><span style="font-size:0.85rem;font-weight:600;color:#ef4444;">' + missingCount + ' contractor' + (missingCount>1?'s':'') + ' missing Tax ID — request W-9 before filing</span></div>';
  }
  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  var totalPaid = contractors.reduce(function(s,c) { return s+c.totalPaid; }, 0);
  h += statCard('Contractors > $600', String(contractors.length), 'var(--text,#fff)');
  h += statCard('Total Paid', fmt$(totalPaid), '#16a34a');
  if (missingCount > 0) h += statCard('Missing Tax ID', String(missingCount), '#ef4444', 'action required');
  h += '</div>';

  if (contractors.length === 0) {
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
      '<div style="font-size:2rem;margin-bottom:8px;">✅</div>' +
      '<div style="font-size:0.95rem;font-weight:500;">No contractors paid over $600 in ' + year + '</div>' +
      '<div style="font-size:0.85rem;margin-top:4px;">1099-NEC threshold is $600.01 or more.</div></div>';
  }

  h += '<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">';
  h += '<button class="btn btn-secondary btn-small" onclick="fin1099Export()">Export CSV</button></div>';

  h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
  ['Contractor', 'Tax ID', 'Total Paid', '1099 Required'].forEach(function(col) {
    h += '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">' + col + '</th>';
  });
  h += '</tr></thead><tbody>';
  contractors.forEach(function(c) {
    var tidCell = c.hasTaxId
      ? '<span style="font-family:monospace;font-size:0.8rem;">' + e(c.maskedTaxId) + '</span>'
      : '<span style="color:#ef4444;font-size:0.8rem;font-weight:600;">Missing — action required</span>';
    var border = c.hasTaxId ? '' : 'border-left:3px solid #ef4444;';
    h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);' + border + '">';
    h += '<td style="padding:10px;font-weight:600;">' + e(c.name) + '</td>';
    h += '<td style="padding:10px;">' + tidCell + '</td>';
    h += '<td style="padding:10px;font-weight:700;">' + fmt$(c.totalPaid) + '</td>';
    h += '<td style="padding:10px;"><span style="background:rgba(34,197,94,0.15);color:#22c55e;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Yes</span></td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

window.fin1099Export = function() {
  if (!_1099ContractorData || _1099ContractorData.length === 0) {
    showToast('No 1099 data to export', true); return;
  }
  var rows = [['Name','Tax ID','Total Paid','1099 Required']];
  _1099ContractorData.forEach(function(c) {
    rows.push([c.name, c.hasTaxId ? c.taxId : 'MISSING', (c.totalPaid/100).toFixed(2), 'Yes']);
  });
  downloadCsv(rows, '1099s_' + _1099Year + '.csv');
  showToast('1099s.csv downloaded');
};

// ── Reports Tab ───────────────────────────────────────────────────────────────

function setupReportsTab() {
  injectFinancePulseCSS();
  var el = document.getElementById('financeReportsTab');
  if (!el) return;
  _reportYear = new Date().getFullYear();
  var nowYear = new Date().getFullYear();
  var yearOpts = '';
  for (var y = nowYear; y >= nowYear - 3; y--) {
    yearOpts += '<option value="' + y + '"' + (y === nowYear ? ' selected' : '') + '>' + y + '</option>';
  }
  var h = '<div style="padding:20px;max-width:1100px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">';
  h += '<h2 style="margin:0;font-size:1.2rem;font-weight:700;">Reports</h2>';
  h += '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:600;">Admin Only</span>';
  h += '</div>';

  // Report A card
  h += '<div style="background:var(--bg-secondary,#232323);border-radius:12px;padding:20px;margin-bottom:16px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">';
  h += '<div><div style="font-size:1rem;font-weight:700;margin-bottom:4px;">Loan / Investor Report</div>';
  h += '<div style="font-size:0.82rem;color:var(--warm-gray,#888);">12-month financial summary formatted for a bank or investor. Print or save as PDF.</div></div>';
  h += '<button class="btn btn-secondary btn-small" onclick="loadLoanReport()">Generate</button></div>';
  h += '<div id="fLoanContent"></div></div>';

  // Report B card
  h += '<div style="background:var(--bg-secondary,#232323);border-radius:12px;padding:20px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">';
  h += '<div><div style="font-size:1rem;font-weight:700;margin-bottom:4px;">Year-End Tax Package</div>';
  h += '<div style="font-size:0.82rem;color:var(--warm-gray,#888);">Everything your CPA needs for Schedule C and state filings. Export CSVs or print the full package.</div></div>';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
  h += '<select id="fReportYear" onchange="finSetReportYear(this.value)" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:4px 8px;font-size:0.82rem;">' + yearOpts + '</select>';
  h += '<button class="btn btn-secondary btn-small" onclick="loadYearEndReport()">Generate</button></div></div>';
  h += '<div id="fYearEndContent"></div></div>';

  h += '</div>';
  el.innerHTML = h;
}

async function computeMonthlyBreakdown(startDate, endDate) {
  var [ordersRaw, salesRaw, expensesRaw, jeRaw] = await Promise.all([
    MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(startDate)).endAt(isoEnd(endDate)).limitToLast(5000).once(),
    MastDB.query('admin/sales').orderByChild('createdAt').startAt(isoStart(startDate)).endAt(isoEnd(endDate)).limitToLast(2000).once(),
    MastDB.query('admin/expenses').orderByChild('date').startAt(startDate).endAt(endDate).limitToLast(2000).once(),
    MastDB.query('admin/journalEntries').orderByChild('date').startAt(startDate).endAt(endDate).limitToLast(2000).once()
  ]);
  var monthData = {};
  function gm(iso) { return iso ? iso.slice(0,7) : null; }
  function em(ym) { if (!monthData[ym]) monthData[ym] = { revenue:0, cogs:0, opex:0 }; }
  Object.values(ordersRaw||{}).forEach(function(o) {
    if (o.status==='cancelled') return;
    var c = Math.round((o.total||0)*100); if (c<=0) return;
    var ym = gm(o.placedAt); if (!ym) return; em(ym);
    monthData[ym].revenue += c;
  });
  Object.values(salesRaw||{}).forEach(function(s) {
    if (s.status==='voided') return;
    var c = Math.round((s.amount||0)*100); if (c<=0) return;
    var ym = gm(s.createdAt); if (!ym) return; em(ym);
    monthData[ym].revenue += c;
  });
  Object.values(expensesRaw||{}).forEach(function(ex) {
    if (!ex.reviewed) return;
    var ym = gm(ex.date); if (!ym) return; em(ym);
    if (ex.category==='materials') monthData[ym].cogs += ex.amount||0;
    else if (ex.category!=='personal') monthData[ym].opex += ex.amount||0;
  });
  Object.values(jeRaw||{}).forEach(function(j) {
    var ym = gm(j.date); if (!ym) return; em(ym);
    if (j.category==='cogs-adjustment') monthData[ym].cogs += j.amount||0;
    else if (j.category!=='owner-draw') monthData[ym].opex += j.amount||0;
  });
  var result = [];
  var cur = new Date(startDate.slice(0,7)+'-01');
  var last = new Date(endDate.slice(0,7)+'-01');
  while (cur <= last) {
    var ym = cur.getFullYear()+'-'+String(cur.getMonth()+1).padStart(2,'0');
    var m = monthData[ym] || { revenue:0, cogs:0, opex:0 };
    var gp = m.revenue - m.cogs;
    result.push({ month:ym, label:cur.toLocaleDateString('en-US',{month:'short',year:'numeric'}), revenue:m.revenue, cogs:m.cogs, opex:m.opex, grossProfit:gp, netProfit:gp-m.opex });
    cur.setMonth(cur.getMonth()+1);
  }
  return result;
}

window.loadLoanReport = async function() {
  var el = document.getElementById('fLoanContent');
  if (!el) return;
  el.innerHTML = skeletonCards(4) + '<div style="margin-top:16px;">' + skeletonTable(12,3) + '</div>';
  try {
    var endDate = todayStr();
    var d12 = new Date(); d12.setFullYear(d12.getFullYear()-1); d12.setDate(1);
    var startDate = d12.getFullYear()+'-'+String(d12.getMonth()+1).padStart(2,'0')+'-01';
    var [monthly, plaidRaw] = await Promise.all([
      computeMonthlyBreakdown(startDate, endDate),
      MastDB.plaidItems.list().catch(function() { return {}; })
    ]);
    var bankTotal = 0;
    Object.values(plaidRaw||{}).forEach(function(item) {
      if (item.status!=='active') return;
      (item.accounts||[]).forEach(function(a) { bankTotal += a.currentBalance||0; });
    });
    el.innerHTML = renderLoanReport(monthly, bankTotal, startDate, endDate);
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Loan report failed: ' + err.message, true);
  }
};

function renderLoanReport(monthly, bankTotal, startDate, endDate) {
  var tenantName = (window.TENANT_CONFIG && (TENANT_CONFIG.businessName || TENANT_CONFIG.tenantName || TENANT_CONFIG.name)) || 'Your Business';
  var reportDate = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  var totalRevenue = monthly.reduce(function(s,m){return s+m.revenue;},0);
  var totalCogs    = monthly.reduce(function(s,m){return s+m.cogs;},0);
  var totalOpex    = monthly.reduce(function(s,m){return s+m.opex;},0);
  var totalGP      = totalRevenue - totalCogs;
  var totalNP      = totalGP - totalOpex;
  var grossMarginPct = totalRevenue>0 ? (totalGP/totalRevenue*100).toFixed(1) : null;
  var netMarginPct   = totalRevenue>0 ? (totalNP/totalRevenue*100).toFixed(1) : null;
  var avgMonthlyRev  = monthly.length>0 ? Math.round(totalRevenue/monthly.length) : 0;

  // H2 vs H1 growth
  var half = Math.floor(monthly.length/2);
  var h1 = monthly.slice(0,half).reduce(function(s,m){return s+m.revenue;},0);
  var h2 = monthly.slice(half).reduce(function(s,m){return s+m.revenue;},0);
  var yoyPct = h1>0 ? ((h2-h1)/h1*100).toFixed(1) : null;

  _loanReportMetrics = [
    'Business: ' + tenantName,
    'Period: ' + toDateShort(startDate) + ' – ' + toDateShort(endDate),
    'Total Revenue: ' + fmt$(totalRevenue),
    'Gross Margin: ' + (grossMarginPct!==null ? grossMarginPct+'%' : '—'),
    'Net Margin: ' + (netMarginPct!==null ? netMarginPct+'%' : '—'),
    'Avg Monthly Revenue: ' + fmt$(avgMonthlyRev),
    'Net Profit: ' + fmt$(totalNP),
    bankTotal>0 ? 'Cash on Hand: $'+bankTotal.toFixed(2) : null
  ].filter(Boolean).join('\n');

  var h = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">';
  h += '<button class="btn btn-primary btn-small" onclick="finPrintLoanReport()">🖨 Print / Save as PDF</button>';
  h += '<button class="btn btn-secondary btn-small" onclick="finCopyMetrics()">Copy Key Metrics</button>';
  h += '</div>';

  h += '<div id="fLoanReportPrintable" style="background:var(--bg-primary,#1a1a1a);border-radius:10px;padding:24px;">';

  // Header
  h += '<div style="margin-bottom:20px;">';
  h += '<div style="font-size:1.3rem;font-weight:700;">' + e(tenantName) + '</div>';
  h += '<div style="font-size:0.85rem;color:var(--warm-gray,#888);margin-top:4px;">Financial Summary · ' + toDateShort(startDate) + ' – ' + toDateShort(endDate) + '</div>';
  h += '<div style="font-size:0.75rem;color:var(--warm-gray,#888);margin-top:2px;">Generated ' + reportDate + '</div>';
  h += '</div>';

  // Key metrics
  h += '<div style="margin-bottom:22px;">';
  h += '<div style="font-size:0.8rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Key Metrics</div>';
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;">';
  h += statCard('Total Revenue', fmt$(totalRevenue), '#16a34a');
  h += statCard('Gross Margin', grossMarginPct!==null?grossMarginPct+'%':'—', '#22c55e');
  h += statCard('Net Margin', netMarginPct!==null?netMarginPct+'%':'—', totalNP>=0?'#22c55e':'#ef4444');
  if (yoyPct!==null) h += statCard('H2 vs H1', (parseFloat(yoyPct)>=0?'+':'')+yoyPct+'%', parseFloat(yoyPct)>=0?'#22c55e':'#ef4444');
  h += statCard('Avg Monthly Rev', fmt$(avgMonthlyRev), '#3b82f6');
  if (bankTotal>0) h += statCard('Cash on Hand', '$'+bankTotal.toFixed(2), '#8b5cf6');
  h += '</div></div>';

  // 12-month revenue trend (bar table)
  h += '<div style="margin-bottom:22px;">';
  h += '<div style="font-size:0.8rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">12-Month Revenue Trend</div>';
  var maxRev = Math.max.apply(null, monthly.map(function(m){return m.revenue;}))||1;
  h += '<div style="display:flex;flex-direction:column;gap:4px;">';
  monthly.forEach(function(m) {
    var w = maxRev>0?Math.round(m.revenue/maxRev*100):0;
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += '<div style="width:68px;font-size:0.73rem;color:var(--warm-gray,#888);text-align:right;flex-shrink:0;">' + e(m.label) + '</div>';
    h += '<div style="flex:1;height:16px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">';
    if (w>0) h += '<div style="height:100%;width:'+w+'%;background:#16a34a;border-radius:3px;"></div>';
    h += '</div>';
    h += '<div style="width:76px;font-size:0.73rem;font-weight:600;text-align:right;flex-shrink:0;">' + fmt$(m.revenue) + '</div>';
    h += '</div>';
  });
  h += '</div></div>';

  // P&L Summary
  h += '<div style="margin-bottom:22px;">';
  h += '<div style="font-size:0.8rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">P&L Summary</div>';
  h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:16px;">';
  function lrRow(label, cents, bold, color) {
    return '<div style="display:flex;justify-content:space-between;padding:4px 0' + (bold?';border-top:1px solid rgba(255,255,255,0.1);margin-top:4px;padding-top:8px;':'') + '">' +
      '<span style="font-size:0.88rem;' + (bold?'font-weight:600;':'color:var(--warm-gray,#888);') + '">' + label + '</span>' +
      '<span style="font-size:0.88rem;font-weight:' + (bold?'700':'400') + ';color:' + (color||'var(--text,#fff)') + ';">' + fmt$(cents) + '</span></div>';
  }
  h += lrRow('Total Revenue', totalRevenue, true, '#16a34a');
  h += lrRow('Cost of Goods Sold', totalCogs, false, null);
  h += lrRow('Gross Profit', totalGP, true, totalGP>=0?'#22c55e':'#ef4444');
  h += lrRow('Operating Expenses', totalOpex, false, null);
  h += lrRow('Net Profit', totalNP, true, totalNP>=0?'#22c55e':'#ef4444');
  h += '</div></div>';

  // Cash position
  if (bankTotal > 0) {
    h += '<div style="margin-bottom:22px;">';
    h += '<div style="font-size:0.8rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Cash Position</div>';
    h += '<div style="font-size:1.4rem;font-weight:700;color:#22c55e;">$' + bankTotal.toFixed(2) + '</div>';
    h += '<div style="font-size:0.75rem;color:var(--warm-gray,#888);margin-top:2px;">Current cash on hand · via connected bank accounts</div>';
    h += '</div>';
  }

  h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;margin-top:8px;">Generated by Mast · ' + reportDate + '</div>';
  h += '</div>'; // end printable
  return h;
}

window.finPrintLoanReport = function() {
  injectFinPrintCss('fLoanReportPrintable');
  window.print();
};

window.finCopyMetrics = function() {
  if (!_loanReportMetrics) { showToast('Generate the report first', true); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(_loanReportMetrics).then(function() {
      showToast('Key metrics copied to clipboard');
    }).catch(function() { showToast('Copy failed — select text manually', true); });
  } else {
    showToast('Clipboard not available in this browser', true);
  }
};

window.finSetReportYear = function(year) { _reportYear = parseInt(year); };

window.loadYearEndReport = async function() {
  var el = document.getElementById('fYearEndContent');
  if (!el) return;
  var year = _reportYear;
  el.innerHTML = skeletonCards(3) + '<div style="margin-top:16px;">' + skeletonTable(5,3) + '</div>';
  var startDate = year+'-01-01';
  var endDate   = year+'-12-31';
  try {
    var [pnlData, taxData, contractors, mileage] = await Promise.all([
      computePnlLocal(startDate, endDate),
      computeTaxSummaryForReport(startDate, endDate),
      compute1099DataForYear(year),
      computeMileageForYear(year)
    ]);
    window._yearEndData = { pnlData:pnlData, taxData:taxData, contractors:contractors, mileage:mileage, year:year };
    el.innerHTML = renderYearEndReport(pnlData, taxData, contractors, mileage, year);
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Year-end report failed: ' + err.message, true);
  }
};

async function computeTaxSummaryForReport(startDate, endDate) {
  var [ordersRaw, nexusRaw] = await Promise.all([
    MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(startDate)).endAt(isoEnd(endDate)).limitToLast(5000).once(),
    MastDB.get('admin/nexusRegistrations')
  ]);
  var orders = Object.values(ordersRaw||{});
  var nexus  = nexusRaw||{};
  var byState = {};
  orders.forEach(function(o) {
    if (o.status==='cancelled') return;
    var state = o.taxState||o.shippingState; if (!state) return;
    if (!byState[state]) byState[state] = { taxCollected:0, orderCount:0 };
    byState[state].taxCollected += (o.taxCents||Math.round((o.tax||0)*100));
    byState[state].orderCount++;
  });
  return { byState:byState, nexus:nexus };
}

async function compute1099DataForYear(year) {
  var startISO = year+'-01-01T00:00:00Z';
  var endISO   = year+'-12-31T23:59:59Z';
  var [vendorsRaw, receiptsRaw] = await Promise.all([
    MastDB.get('admin/vendors'),
    MastDB.query('admin/purchaseReceipts').orderByChild('receivedAt').startAt(startISO).endAt(endISO).limitToLast(2000).once()
  ]);
  var vendors  = vendorsRaw||{};
  var receipts = Object.values(receiptsRaw||{});
  var totals = {};
  receipts.forEach(function(r) {
    var v = vendors[r.vendorId]; if (!v) return;
    if ((v.vendorType||v.payeeType)!=='contractor') return;
    if (r.paymentStatus!=='paid') return;
    if (!totals[r.vendorId]) totals[r.vendorId] = { total:0, vendor:v };
    totals[r.vendorId].total += r.amountCents||0;
  });
  var result = [];
  Object.keys(totals).forEach(function(vid) {
    var d = totals[vid]; if (d.total<=60000) return;
    var taxId = d.vendor.taxId;
    result.push({ name:d.vendor.name||'Unknown', taxId:taxId, hasTaxId:!!(taxId&&String(taxId).trim().length>0), totalPaid:d.total });
  });
  return result.sort(function(a,b){return b.totalPaid-a.totalPaid;});
}

async function computeMileageForYear(year) {
  try {
    var tripsRaw = await MastDB.get('admin/trips');
    var trips = Object.values(tripsRaw||{});
    var yearStr = String(year);
    var yTrips = trips.filter(function(t) {
      var d = t.date||t.tripDate||t.startDate||'';
      return String(d).startsWith(yearStr);
    });
    var totalMiles = yTrips.reduce(function(s,t){return s+(t.miles||t.distanceMiles||t.totalMiles||0);},0);
    return { totalMiles:totalMiles, tripCount:yTrips.length, hasData:yTrips.length>0 };
  } catch(err) {
    return { totalMiles:0, tripCount:0, hasData:false };
  }
}

function renderYearEndReport(pnlData, taxData, contractors, mileage, year) {
  var IRS_RATE = 0.70; // 2025/2026 standard mileage rate $/mile — verify at irs.gov
  var h = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">';
  h += '<button class="btn btn-secondary btn-small" onclick="finExportPnlCsv()">P&L.csv</button>';
  h += '<button class="btn btn-secondary btn-small" onclick="finExportTaxCsv()">SalesTax.csv</button>';
  if (contractors.length>0) h += '<button class="btn btn-secondary btn-small" onclick="finExport1099Csv()">1099s.csv</button>';
  h += '<button class="btn btn-primary btn-small" onclick="finPrintYearEnd()">🖨 Print Package</button>';
  h += '</div>';

  h += '<div id="fYearEndPrintable">';

  // P&L Schedule C
  h += '<div style="background:var(--bg-primary,#1a1a1a);border-radius:8px;padding:16px;margin-bottom:16px;">';
  h += '<div style="font-size:0.9rem;font-weight:700;margin-bottom:10px;">P&L Summary — Schedule C · ' + year + '</div>';
  function yeRow(label, cents, bold) {
    return '<div style="display:flex;justify-content:space-between;padding:4px 0' + (bold?';border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:8px;':'') + '">' +
      '<span style="font-size:0.85rem;' + (bold?'font-weight:600;':'color:var(--warm-gray,#888);') + '">' + label + '</span>' +
      '<span style="font-size:0.85rem;font-weight:' + (bold?'600':'400') + ';">' + fmt$(cents) + '</span></div>';
  }
  h += yeRow('Gross Income (Revenue)', pnlData.revenue, true);
  h += yeRow('Cost of Goods Sold', pnlData.cogs, false);
  h += yeRow('Gross Profit', pnlData.grossProfit, true);
  var cats = Object.keys(pnlData.opexByCategory||{}).sort(function(a,b){return (pnlData.opexByCategory[b]||0)-(pnlData.opexByCategory[a]||0);});
  cats.forEach(function(cat) {
    h += yeRow(cat.replace(/_/g,' ').replace(/\b\w/g,function(l){return l.toUpperCase();}), pnlData.opexByCategory[cat], false);
  });
  h += yeRow('Total Expenses', pnlData.opex, true);
  h += yeRow('Net Profit', pnlData.netProfit, true);
  h += '</div>';

  // Mileage
  if (mileage.hasData) {
    var deductible = mileage.totalMiles * IRS_RATE;
    h += '<div style="background:var(--bg-primary,#1a1a1a);border-radius:8px;padding:16px;margin-bottom:16px;">';
    h += '<div style="font-size:0.9rem;font-weight:700;margin-bottom:10px;">Mileage Summary · ' + year + '</div>';
    h += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
    h += statCard('Total Miles', mileage.totalMiles.toFixed(1), 'var(--text,#fff)', mileage.tripCount + ' trip' + (mileage.tripCount!==1?'s':''));
    h += statCard('IRS Rate', '$'+IRS_RATE.toFixed(2)+'/mi', 'var(--warm-gray,#888)', 'verify at irs.gov');
    h += statCard('Deductible Amount', '$'+deductible.toFixed(2), '#16a34a');
    h += '</div></div>';
  }

  // Sales Tax
  var stateKeys = Object.keys(taxData.byState||{}).sort();
  if (stateKeys.length>0) {
    h += '<div style="background:var(--bg-primary,#1a1a1a);border-radius:8px;padding:16px;margin-bottom:16px;">';
    h += '<div style="font-size:0.9rem;font-weight:700;margin-bottom:10px;">Sales Tax by State · ' + year + '</div>';
    h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.82rem;">';
    h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
    ['State','Tax Collected','Orders','Registered'].forEach(function(c) {
      h += '<th style="text-align:left;padding:6px 10px;font-size:0.7rem;color:var(--warm-gray,#888);text-transform:uppercase;">' + c + '</th>';
    });
    h += '</tr></thead><tbody>';
    stateKeys.forEach(function(state) {
      var d = taxData.byState[state];
      var reg = taxData.nexus[state]&&taxData.nexus[state].registered;
      h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">';
      h += '<td style="padding:7px 10px;font-weight:600;">' + e(state) + '</td>';
      h += '<td style="padding:7px 10px;">' + fmt$(d.taxCollected) + '</td>';
      h += '<td style="padding:7px 10px;">' + d.orderCount + '</td>';
      h += '<td style="padding:7px 10px;color:' + (reg?'#22c55e':'#9ca3af') + ';">' + (reg?'Yes':'No') + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div></div>';
  }

  // 1099 Summary
  if (contractors.length>0) {
    h += '<div style="background:var(--bg-primary,#1a1a1a);border-radius:8px;padding:16px;margin-bottom:16px;">';
    h += '<div style="font-size:0.9rem;font-weight:700;margin-bottom:10px;">1099 Summary · ' + year + '</div>';
    h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.82rem;">';
    h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
    ['Contractor','Tax ID','Total Paid','1099 Required'].forEach(function(c) {
      h += '<th style="text-align:left;padding:6px 10px;font-size:0.7rem;color:var(--warm-gray,#888);text-transform:uppercase;">' + c + '</th>';
    });
    h += '</tr></thead><tbody>';
    contractors.forEach(function(c) {
      h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">';
      h += '<td style="padding:7px 10px;font-weight:600;">' + e(c.name) + '</td>';
      h += '<td style="padding:7px 10px;font-size:0.8rem;">' + (c.hasTaxId?'<span style="font-family:monospace;">XXX-XX-'+String(c.taxId||'').replace(/[^0-9]/g,'').slice(-4)+'</span>':'<span style="color:#ef4444;">Missing</span>') + '</td>';
      h += '<td style="padding:7px 10px;font-weight:700;">' + fmt$(c.totalPaid) + '</td>';
      h += '<td style="padding:7px 10px;color:#22c55e;">Yes</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div></div>';
  }

  // Compliance Checklist
  h += '<div style="background:var(--bg-primary,#1a1a1a);border-radius:8px;padding:16px;margin-bottom:16px;">';
  h += '<div style="font-size:0.9rem;font-weight:700;margin-bottom:10px;">Compliance Checklist — Items Your CPA Needs</div>';
  [
    'W-2s filed for all employees',
    '1099-NEC sent to contractors by January 31',
    'Sales tax filed by state (see table above)',
    'Business bank statements for full year',
    'Receipts for all deductible expenses',
    'Mileage log if claiming vehicle deduction',
    'Home office documentation if claiming home office deduction',
    'Health insurance premiums paid (deductible for self-employed)'
  ].forEach(function(item) {
    h += '<label style="display:flex;align-items:flex-start;gap:10px;padding:5px 0;cursor:pointer;">';
    h += '<input type="checkbox" style="margin-top:2px;flex-shrink:0;">';
    h += '<span style="font-size:0.85rem;">' + e(item) + '</span></label>';
  });
  h += '</div>';

  h += '</div>'; // end printable
  return h;
}

function downloadCsv(rows, filename) {
  var csv = rows.map(function(row) {
    return row.map(function(cell) {
      var s = String(cell==null?'':cell);
      if (s.indexOf(',')>=0||s.indexOf('"')>=0||s.indexOf('\n')>=0) s = '"'+s.replace(/"/g,'""')+'"';
      return s;
    }).join(',');
  }).join('\n');
  var blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function injectFinPrintCss(elementId) {
  var prev = document.getElementById('finReportPrintStyle');
  if (prev) prev.remove();
  var s = document.createElement('style'); s.id = 'finReportPrintStyle';
  s.textContent = '@media print{' +
    'body *{visibility:hidden!important;}' +
    '#'+elementId+',#'+elementId+' *{visibility:visible!important;}' +
    '#'+elementId+'{position:absolute!important;top:0!important;left:0!important;width:100%!important;' +
    'background:white!important;color:black!important;padding:20px!important;}' +
    '}';
  document.head.appendChild(s);
}

window.finPrintYearEnd = function() {
  injectFinPrintCss('fYearEndPrintable');
  window.print();
};

window.finExportPnlCsv = function() {
  var d = window._yearEndData; if (!d) { showToast('Generate the report first', true); return; }
  var pnl = d.pnlData; var year = d.year;
  var rows = [['Category','Amount']];
  rows.push(['Gross Income (Revenue)', (pnl.revenue/100).toFixed(2)]);
  rows.push(['Cost of Goods Sold', (pnl.cogs/100).toFixed(2)]);
  rows.push(['Gross Profit', (pnl.grossProfit/100).toFixed(2)]);
  var cats = Object.keys(pnl.opexByCategory||{}).sort(function(a,b){return (pnl.opexByCategory[b]||0)-(pnl.opexByCategory[a]||0);});
  cats.forEach(function(cat) { rows.push([cat.replace(/_/g,' '),(pnl.opexByCategory[cat]/100).toFixed(2)]); });
  rows.push(['Total Expenses', (pnl.opex/100).toFixed(2)]);
  rows.push(['Net Profit', (pnl.netProfit/100).toFixed(2)]);
  downloadCsv(rows, 'PnL_'+year+'.csv');
  showToast('P&L.csv downloaded');
};

window.finExportTaxCsv = function() {
  var d = window._yearEndData; if (!d) { showToast('Generate the report first', true); return; }
  var tax = d.taxData; var year = d.year;
  var rows = [['State','Tax Collected','Order Count','Registered']];
  Object.keys(tax.byState||{}).sort().forEach(function(state) {
    var s = tax.byState[state]; var reg = tax.nexus[state]&&tax.nexus[state].registered;
    rows.push([state,(s.taxCollected/100).toFixed(2),s.orderCount,reg?'Yes':'No']);
  });
  downloadCsv(rows, 'SalesTax_'+year+'.csv');
  showToast('SalesTax.csv downloaded');
};

window.finExport1099Csv = function() {
  var d = window._yearEndData; if (!d) { showToast('Generate the report first', true); return; }
  var rows = [['Name','Tax ID','Total Paid','1099 Required']];
  d.contractors.forEach(function(c) {
    rows.push([c.name, c.hasTaxId?c.taxId:'MISSING', (c.totalPaid/100).toFixed(2), 'Yes']);
  });
  downloadCsv(rows, '1099s_'+d.year+'.csv');
  showToast('1099s.csv downloaded');
};

// ── Period picker global handlers ─────────────────────────────────────────────

window.finPeriod = function(pfx, preset) {
  var sEl = document.getElementById(pfx + 'S');
  var eEl = document.getElementById(pfx + 'E');
  if (!sEl || !eEl) return;
  var t = todayStr();
  if (preset === 'month')   { sEl.value = monthStart();     eEl.value = monthEnd(); }
  else if (preset === 'last') { sEl.value = lastMonthStart(); eEl.value = lastMonthEnd(); }
  else if (preset === 'qtr')  { sEl.value = quarterStart();   eEl.value = t; }
  else if (preset === 'ytd')  { sEl.value = ytdStart();       eEl.value = t; }
  window.finLoad(pfx);
};

window.finLoad = function(pfx) {
  if (pfx === 'fRev') loadRevenue();
  else if (pfx === 'fExp') loadFinExpenses();
  else if (pfx === 'fPl')  loadPnl();
  else if (pfx === 'fTax') loadTaxSalesTaxData();
};

// ── Window exports for onclick handlers ───────────────────────────────────────

window.loadRevenue    = loadRevenue;
window.loadFinExpenses = loadFinExpenses;
window.loadFinExpBanks = loadFinExpBanks;
window.loadPnl        = loadPnl;
window.loadCashFlow   = loadCashFlow;
window.loadArData     = loadArData;
window.loadApData     = loadApData;

// ── Module registration ───────────────────────────────────────────────────────

MastAdmin.registerModule('finance', {
  routes: {
    'finance-revenue':   { tab: 'financeRevenueTab',   setup: function() { setupRevenueTab(); } },
    'finance-expenses':  { tab: 'financeExpensesTab',  setup: function() { setupExpensesTab(); } },
    'finance-pl':        { tab: 'financePlTab',        setup: function() { setupPlTab(); } },
    'finance-cash-flow': { tab: 'financeCashFlowTab',  setup: function() { setupCashFlowTab(); } },
    'finance-ar':        { tab: 'financeArTab',        setup: function() { setupArTab(); } },
    'finance-ap':        { tab: 'financeApTab',        setup: function() { setupApTab(); } },
    'finance-tax':       { tab: 'financeTaxTab',       setup: function() { setupTaxTab(); } },
    'finance-reports':   { tab: 'financeReportsTab',   setup: function() { setupReportsTab(); } }
  }
});

})();
