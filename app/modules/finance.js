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

  // Filter
  h += '<div style="display:flex;gap:6px;margin-bottom:14px;">';
  [['all','All'], ['current','Current'], ['overdue','Overdue']].forEach(function(kl) {
    var active = _apFilter === kl[0];
    h += '<button class="btn btn-' + (active ? 'primary' : 'secondary') + ' btn-small" onclick="finApFilter(\'' + kl[0] + '\')">' + kl[1] + '</button>';
  });
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

  // Table
  h += '<div style="overflow-x:auto;">';
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
    h += '</td></tr>';
  });

  h += '</tbody></table></div>';
  return h;
}

window.finApFilter = function(bucket) {
  _apFilter = bucket;
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
    'finance-tax':       { tab: 'financeTaxTab',       setup: function() {} },
    'finance-reports':   { tab: 'financeReportsTab',   setup: function() {} }
  }
});

})();
