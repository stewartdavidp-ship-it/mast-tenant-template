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
var _includeTestData = false;
// W1.6 (-OtMNIz-iS6EE2q-H0V6): Cash Flow horizon toggle (30/60/90 days).
// Default 30 for back-compat with prior "Next 30 Days" panel.
var _cashHorizonDays = 30;
// W1.2 + W1.6: snapshot of last cash-flow load so the horizon toggle can
// re-render against the current data set without re-fetching. NB:
// re-fetch on Refresh; this snapshot is for instant horizon flips.
var _cfLastSnapshot = null;
// W1.5: bank-sync per-item retry/reconnect in-flight tracking.
var _bankSyncInFlight = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTestSource(src) {
  var s = String(src || '').toLowerCase();
  return s === 'test' || s.indexOf('test-') === 0 || s.indexOf('test_') === 0 || s === 'synthetic';
}

function isTestOrder(o) {
  return isTestSource(o && o.source) || (o && (o.synthetic === true || o.isTest === true));
}

// W1.5 carry-forward — COMPLETE 2026-05-22: isTestOrder()/isTestSource()
// thread through Revenue + computePnlLocal + loadArData + loadCashFlow's AR
// rollup so test-channel orders are honored across every customer-money view.
// AP (purchaseReceipts → vendor invoices) has no test-channel concept and is
// intentionally unfiltered. Test-exclusion chip rendered consistently across
// Revenue, P&L, and AR aging tabs.

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
    '<div style="font-size:1.15rem;font-weight:700;color:' + (color||'var(--text,#fff)') + ';">' + value + '</div>' +
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

// W1.7 (-OtMNJ9Ds56g3iAOWBhT): canonical wholesale discriminator.
// Prefer the FK introduced by Sales W1.9 (`order.wholesaleAccountId`); fall
// back to the legacy boolean / orderType / type heuristic. Single source of
// truth — apply in tier mix, AR aging, and Cash Flow inflow classification.
function isWholesaleOrder(o) {
  if (!o) return false;
  if (o.wholesaleAccountId) return true;
  if (o.isWholesale === true) return true;
  if (o.orderType === 'wholesale') return true;
  if (o.type === 'wholesale') return true;
  return false;
}

// W1.9: |Δ%| > 50 sanity badge — wraps an existing delta-badge string with a
// tooltip nudging the user to check test-data filter / data freshness /
// period boundary. Returns the original badge unchanged if the delta is sane
// (|Δ%| ≤ 50) or unmeasurable.
function _sanityWrap(badgeHtml, curr, prev) {
  if (!badgeHtml) return badgeHtml || '';
  if (!prev || prev === 0) return badgeHtml;
  var pct = Math.abs((curr - prev) / Math.abs(prev) * 100);
  if (pct <= 50) return badgeHtml;
  var tip = 'Δ ' + Math.round(pct) + '% — large swing. Check test-data filter? Data freshness? Period boundary?';
  return '<span title="' + e(tip) + '" style="cursor:help;">' + badgeHtml +
    ' <span style="background:rgba(245,158,11,0.18);color:#f59e0b;font-size:0.72rem;padding:1px 5px;border-radius:3px;font-weight:600;vertical-align:middle;">?</span></span>';
}

// W1.3 (-OtMNIWi6YV9zTy0YaJJ): universal CSV download helper. Uses the
// shell-global _csvCell (defined in app/index.html ~43813) to defend against
// formula injection. Filename pattern: {TENANT_ID}_{view}_{YYYY-MM-DD}.csv.
function _finDownloadCsv(viewName, rows, periodLine) {
  if (typeof window._csvCell !== 'function') {
    showToast('CSV export unavailable: _csvCell helper missing', true);
    return;
  }
  var cellFn = window._csvCell;
  var lines = [];
  if (periodLine) lines.push('# ' + periodLine);
  rows.forEach(function(r) {
    lines.push(r.map(function(c) { return cellFn(c); }).join(','));
  });
  var csv = lines.join('\n') + '\n';
  var tenantId = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID || 'tenant';
  var fname = tenantId + '_' + viewName + '_' + todayStr() + '.csv';
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
window._finDownloadCsv = _finDownloadCsv;

// W1.3 + R-FIN-1: render the Period · Basis footer + Export CSV button.
// Every render fn that surfaces money numbers must include this footer so the
// user always knows what period and source field is being shown.
function _finFooter(viewName, periodLabel, basisLabel) {
  var periodLine = 'Period: ' + (periodLabel || '—') + ' · Basis: ' + (basisLabel || '—');
  var h = '<div style="margin-top:18px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">';
  h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);">' + e(periodLine) + '</div>';
  h += '<button class="btn btn-secondary btn-small" onclick="window._finExportView(\'' + (window._jsAttr ? window._jsAttr(viewName) : viewName) + '\')" title="Download CSV">⬇ Export CSV</button>';
  h += '</div>';
  return h;
}

// W1.3: export dispatch. Each view registers its export builder so the footer
// button can render at HTML-generation time without holding a closure.
var _finExporters = {};
window._finExportView = function(viewName) {
  var fn = _finExporters[viewName];
  if (typeof fn !== 'function') { showToast('Export not available for this view', true); return; }
  try { fn(); }
  catch (err) { showToast('Export failed: ' + err.message, true); }
};

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
    '<h2 style="margin:0 0 16px 0;font-size:1.15rem;font-weight:700;">Revenue</h2>' +
    periodPicker('fRev', monthStart(), monthEnd()) +
    '<div id="fRevContent">' + skeletonCards(4) + '</div>' +
    '</div>';
  loadRevenue();
}

// W2.6: prior-equivalent window — same length, immediately before [start, end].
// Period selector controls both windows. Returns ISO date strings (YYYY-MM-DD).
// Resolves OPEN -OtEOdthKP8z-75j82ic.
function _priorRevenueWindow(start, end) {
  var DAY_MS = 86400000;
  var s = new Date(start + 'T00:00:00').getTime();
  var e = new Date(end + 'T00:00:00').getTime();
  if (isNaN(s) || isNaN(e) || e < s) return null;
  var lengthMs = e - s; // inclusive day-difference; we treat [start,end] as a window
  var priorEnd = new Date(s - DAY_MS);            // day before current start
  var priorStart = new Date(priorEnd.getTime() - lengthMs);
  function fmt(d) {
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }
  return { start: fmt(priorStart), end: fmt(priorEnd) };
}

// W2.6: aggregate orders+sales for a given window using the same channel +
// test-data rules as loadRevenue's main path. Returns { totalCents, byChannel,
// txnCount }. Test data is excluded when _includeTestData is false (matches
// the visible total user sees). Used for prior-period comparison.
async function _loadRevenueAggregate(start, end) {
  var [ordersRaw, salesRaw] = await Promise.all([
    MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(start)).endAt(isoEnd(end)).limitToLast(1000).once(),
    MastDB.query('admin/sales').orderByChild('createdAt').startAt(isoStart(start)).endAt(isoEnd(end)).limitToLast(500).once()
  ]);
  var orders = Object.entries(ordersRaw || {}).map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); });
  var sales  = Object.entries(salesRaw  || {}).map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); });
  var totalCents = 0;
  var byChannel = {};
  var txnCount = 0;
  orders.forEach(function(o) {
    if (o.status === 'cancelled') return;
    var cents = Math.round((o.total || 0) * 100);
    if (cents <= 0) return;
    if (isTestOrder(o) && !_includeTestData) return;
    var ch = o.source || 'direct';
    byChannel[ch] = (byChannel[ch] || 0) + cents;
    totalCents += cents;
    txnCount += 1;
  });
  sales.forEach(function(s) {
    if (s.status === 'voided') return;
    var cents = Math.round((s.amount || 0) * 100);
    if (cents <= 0) return;
    if (isTestOrder(s) && !_includeTestData) return;
    var ch = s.source || 'pos';
    byChannel[ch] = (byChannel[ch] || 0) + cents;
    totalCents += cents;
    txnCount += 1;
  });
  return { totalCents: totalCents, byChannel: byChannel, txnCount: txnCount };
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
    var testTotalCents = 0;
    var testTxnCount = 0;

    // W2.5: pricing-tier mix tracking — Wholesale / Direct / POS. Retail
    // (in-person markets/shows) is currently subsumed under POS in the
    // data model; when a tier field lands on line items / order, this
    // split becomes 4-way. Resolves OPEN -OtEOd0bj9ZhP2Vd_itj (portfolio
    // card); per-product mix on Demand Overview is a follow-up gated on
    // forecastOrders extension to include admin/sales — see task notes.
    var byTier = { Wholesale: 0, Direct: 0, POS: 0 };
    // W1.7 (-OtMNJ9Ds56g3iAOWBhT): delegate to the canonical helper so the
    // wholesaleAccountId FK introduced by Sales W1.9 is honored first; legacy
    // boolean/orderType heuristics remain a fallback inside isWholesaleOrder.
    function _resolveOrderTier(o) {
      if (isWholesaleOrder(o)) return 'Wholesale';
      return 'Direct';
    }
    orders.forEach(function(o) {
      if (o.status === 'cancelled') return;
      var cents = Math.round((o.total || 0) * 100);
      if (cents <= 0) return;
      var ch = o.source || 'direct';
      var isTest = isTestOrder(o);
      if (isTest && !_includeTestData) {
        testTotalCents += cents;
        testTxnCount += 1;
        return;
      }
      byChannel[ch] = (byChannel[ch] || 0) + cents;
      var tier = _resolveOrderTier(o);
      byTier[tier] = (byTier[tier] || 0) + cents;
      totalCents += cents;
      txns.push({ date: o.placedAt, channel: ch, ref: o.orderNumber || o._id, desc: o.customerName || 'Order', cents: cents, type: 'order', isTest: isTest });
    });

    sales.forEach(function(s) {
      if (s.status === 'voided') return;
      var cents = Math.round((s.amount || 0) * 100);
      if (cents <= 0) return;
      var ch = s.source || 'pos';
      var isTest = isTestOrder(s);
      if (isTest && !_includeTestData) {
        testTotalCents += cents;
        testTxnCount += 1;
        return;
      }
      byChannel[ch] = (byChannel[ch] || 0) + cents;
      byTier.POS += cents;
      totalCents += cents;
      txns.push({ date: s.createdAt, channel: ch, ref: s.receiptNumber || s._id, desc: s.note || 'POS Sale', cents: cents, type: 'sale', isTest: isTest });
    });

    txns.sort(function(a,b) { return (b.date || '').localeCompare(a.date || ''); });

    // W2.6: fetch prior equivalent window in parallel for Δ comparison. Render
    // an initial pass with prior=null so the user sees the current numbers
    // immediately (network latency on the prior fetch shouldn't gate first
    // paint), then re-render with prior data when it arrives.
    el.innerHTML = renderRevenue(totalCents, byChannel, txns, start, end, testTotalCents, testTxnCount, null, null, byTier);
    var priorWin = _priorRevenueWindow(start, end);
    if (priorWin) {
      _loadRevenueAggregate(priorWin.start, priorWin.end).then(function(prior) {
        // Guard against the user changing the period before prior arrives:
        // only update if the dom node still contains the placeholder we just
        // rendered (heuristic: same start/end inputs).
        var curS = document.getElementById('fRevS');
        var curE = document.getElementById('fRevE');
        if (curS && curE && curS.value === start && curE.value === end) {
          el.innerHTML = renderRevenue(totalCents, byChannel, txns, start, end, testTotalCents, testTxnCount, prior, priorWin, byTier);
        }
      }).catch(function() {
        // Prior fetch failed — leave first-paint as-is. Δ chips will read "—".
      });
    }
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Revenue load failed: ' + err.message, true);
  }
}

// W2.6: render a Δ chip showing both Δ$ and Δ% vs prior equivalent window.
// Returns empty string if prior is null/0 (no comparison available).
// Threshold: |Δ%| < 1 renders neutral gray rather than green/red to avoid
// visual noise on tiny shifts (e.g. $5 swing on a $50k month).
function _renderRevenueDelta(curCents, priorCents) {
  if (priorCents == null) return '';
  if (priorCents === 0) {
    if (curCents === 0) return '';
    return '<div style="font-size:0.72rem;color:var(--warm-gray,#888);margin-top:2px;">vs $0 prior</div>';
  }
  var deltaCents = curCents - priorCents;
  var deltaPct = (deltaCents / priorCents) * 100;
  var sign = deltaCents >= 0 ? '+' : '−';
  var absD = Math.abs(deltaCents);
  var pctSign = deltaPct >= 0 ? '+' : '';
  var color;
  if (Math.abs(deltaPct) < 1) {
    color = 'var(--warm-gray,#888)';
  } else if (deltaCents >= 0) {
    color = '#4caf50';
  } else {
    color = '#ef5350';
  }
  return '<div style="font-size:0.72rem;color:' + color + ';margin-top:2px;font-weight:600;">' +
    sign + fmt$(absD).replace('-', '') + ' &middot; ' + pctSign + Math.round(deltaPct) + '%</div>';
}

function renderRevenue(totalCents, byChannel, txns, start, end, testTotalCents, testTxnCount, prior, priorWin, byTier) {
  var channelColors = { direct:'#3b82f6', pos:'#8b5cf6', square:'#7c3aed', etsy:'#f1641e', shopify:'#96bf48', manual:'#6b7280', stripe:'#635bff', test:'#f59e0b' };
  var channels = Object.keys(byChannel).sort(function(a,b) { return byChannel[b]-byChannel[a]; });

  var h = '';

  // Test-data inclusion chip
  if (_includeTestData || (testTxnCount && testTxnCount > 0)) {
    var chipBg = _includeTestData ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)';
    var chipFg = _includeTestData ? '#f59e0b' : '#9ca3af';
    var chipLabel = _includeTestData
      ? 'Including test data'
      : 'Excluding test data (' + testTxnCount + ' txn' + (testTxnCount === 1 ? '' : 's') + ', ' + fmt$(testTotalCents) + ')';
    var btnLabel = _includeTestData ? 'Exclude' : 'Include';
    h += '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">' +
         '<span style="background:' + chipBg + ';color:' + chipFg + ';padding:4px 10px;border-radius:999px;font-size:0.78rem;font-weight:600;">' + chipLabel + '</span>' +
         '<button type="button" onclick="window.toggleFinanceTestData()" style="background:transparent;border:1px solid var(--warm-gray,#666);color:var(--text,#fff);padding:3px 10px;border-radius:999px;font-size:0.78rem;cursor:pointer;">' + btnLabel + '</button>' +
         '</div>';
  }

  // W2.6: prior-period header note. Period selector controls both windows —
  // prior window is the equivalent length immediately before [start, end].
  if (prior && priorWin) {
    h += '<div style="margin-bottom:12px;font-size:0.72rem;color:var(--warm-gray,#888);">' +
      'Comparing to ' + toDateShort(priorWin.start) + ' &ndash; ' + toDateShort(priorWin.end) +
      ' (' + fmt$(prior.totalCents) + ' &middot; ' + prior.txnCount + ' txn' + (prior.txnCount === 1 ? '' : 's') + ')' +
      '</div>';
  }

  // Summary cards. W2.6: Total Revenue + Top Channel cards get Δ$ + Δ% chips
  // when prior data is available. statCard takes a 4th `sub` argument that
  // renders below the value — append the delta there.
  // W1.9 (-OtMNJUyp9Jyy1Pnn45n): wrap delta in sanity tooltip when |Δ%| > 50
  // — surfaces "Check test-data filter / data freshness / period boundary?"
  var totalDelta = prior ? _sanityWrap(_renderRevenueDelta(totalCents, prior.totalCents), totalCents, prior.totalCents) : '';
  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  h += statCard('Total Revenue', fmt$(totalCents), '#16a34a', totalDelta);
  var txnDelta = '';
  if (prior) {
    var pct = prior.txnCount > 0 ? Math.round((txns.length - prior.txnCount) / prior.txnCount * 100) : null;
    txnDelta = (pct == null) ? '' : '<div style="font-size:0.72rem;color:var(--warm-gray,#888);margin-top:2px;">' + (pct >= 0 ? '+' : '') + pct + '% vs prior</div>';
  }
  h += statCard('Transactions', String(txns.length), 'var(--text,#fff)', txnDelta);
  if (channels.length > 0) {
    var topCh = channels[0];
    var topChSub = fmt$(byChannel[topCh]) + ' · ' + Math.round(byChannel[topCh]/totalCents*100) + '%';
    if (prior) topChSub += _renderRevenueDelta(byChannel[topCh], (prior.byChannel || {})[topCh] || 0);
    h += statCard('Top Channel', e(topCh), channelColors[topCh] || '#888', topChSub);
  }
  h += statCard('Period', toDateShort(start) + ' – ' + toDateShort(end), 'var(--warm-gray,#888)');
  h += '</div>';

  if (totalCents === 0) {
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
      '<div style="font-size:1.6rem;margin-bottom:8px;">💰</div>' +
      '<div style="font-size:0.9rem;font-weight:500;">No revenue in this period</div>' +
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
      h += '<div style="font-size:1.15rem;font-weight:700;">' + fmt$(byChannel[ch]) + '</div>';
      h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);">' + Math.round(byChannel[ch]/totalCents*100) + '% of total</div>';
      // W2.6: per-channel Δ vs prior. Prior channels that disappeared still
      // surface here as a — chip via _renderRevenueDelta(0, priorCents).
      if (prior) h += _renderRevenueDelta(byChannel[ch], (prior.byChannel || {})[ch] || 0);
      h += '</div>';
    });
    h += '</div></div>';
  }

  // W2.5: Pricing-tier mix card. Stacked bar showing Wholesale / Direct / POS
  // split for the current period. "Retail" tier subsumed under POS in current
  // data model — when a tier field lands on line items / order, this becomes
  // 4-way. Resolves OPEN -OtEOd0bj9ZhP2Vd_itj on the portfolio side; the
  // per-product mix column on Demand Overview is gated on extending
  // forecastOrders to include admin/sales (filed as follow-up).
  if (byTier && totalCents > 0) {
    var tierColors = { Wholesale: '#8b5cf6', Direct: '#3b82f6', POS: '#16a34a' };
    var tierOrder = ['Wholesale', 'Direct', 'POS'];
    var tierTotal = tierOrder.reduce(function(s, t) { return s + (byTier[t] || 0); }, 0);
    if (tierTotal > 0) {
      h += '<div style="margin-bottom:20px;">';
      h += '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Pricing-tier mix</div>';
      // Stacked bar
      h += '<div style="display:flex;height:18px;border-radius:6px;overflow:hidden;background:var(--bg-secondary,#232323);margin-bottom:8px;">';
      tierOrder.forEach(function(t) {
        var cents = byTier[t] || 0;
        if (cents <= 0) return;
        var pct = (cents / tierTotal) * 100;
        h += '<div title="' + t + ': ' + fmt$(cents) + ' (' + pct.toFixed(1) + '%)" style="background:' + tierColors[t] + ';width:' + pct + '%;"></div>';
      });
      h += '</div>';
      // Legend rows
      h += '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:0.85rem;">';
      tierOrder.forEach(function(t) {
        var cents = byTier[t] || 0;
        var pct = tierTotal > 0 ? (cents / tierTotal) * 100 : 0;
        h += '<div style="display:flex;align-items:center;gap:6px;">';
        h += '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + tierColors[t] + ';"></span>';
        h += '<span style="font-weight:600;">' + t + '</span>';
        h += '<span style="color:var(--warm-gray,#888);">' + fmt$(cents) + ' &middot; ' + pct.toFixed(0) + '%</span>';
        h += '</div>';
      });
      h += '</div>';
      h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);margin-top:6px;">In-person retail currently subsumed under POS — extend when tier field lands on line items.</div>';
      h += '</div>';
    }
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
      h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-top:2px;">';
      h += toDateShort(t.date);
      h += ' · <span style="background:' + color + ';color:#fff;padding:1px 5px;border-radius:3px;font-size:0.72rem;text-transform:capitalize;">' + e(t.channel) + '</span>';
      if (t.ref) h += ' · <span style="opacity:0.7;">' + e(t.ref) + '</span>';
      h += '</div></div>';
      h += '<div style="font-weight:700;font-size:0.9rem;flex-shrink:0;">' + fmt$(t.cents) + '</div>';
      h += '</div>';
    });
    if (txns.length > 100) h += '<div style="color:var(--warm-gray,#888);font-size:0.78rem;padding:8px 0;">Showing 100 of ' + txns.length + ' transactions.</div>';
    h += '</div>';
  }

  // W1.3 + R-FIN-1: register CSV exporter + render Period · Basis footer.
  _finExporters.revenue = function() {
    var rows = [];
    rows.push(['Date', 'Channel', 'Reference', 'Description', 'Amount (USD)', 'Type']);
    txns.forEach(function(t) {
      rows.push([t.date || '', t.channel || '', t.ref || '', t.desc || '', (t.cents / 100).toFixed(2), t.type || '']);
    });
    _finDownloadCsv('revenue', rows, 'Period: ' + start + ' to ' + end + ' · Basis: orders.placedAt + admin/sales.createdAt');
  };
  h += _finFooter('revenue', start + ' to ' + end, 'orders.placedAt + admin/sales.createdAt');

  return h;
}

// ── Expenses Tab ──────────────────────────────────────────────────────────────

function setupExpensesTab() {
  injectFinancePulseCSS();
  // URL-driven filters from MCP admin links: status, category, account,
  // dateFrom, dateTo, expenseIds (#finance-expenses?...). When any URL
  // filter is present, seed in-memory filter state from URL (and the
  // period inputs from dateFrom/dateTo) so the load + render reflect
  // it. Banner + Clear surface in renderFinExpenses.
  var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var initStart = monthStart();
  var initEnd = monthEnd();
  var hasUrlDate = false;
  if (rp && typeof rp.dateFrom === 'string' && rp.dateFrom) { initStart = rp.dateFrom.slice(0, 10); hasUrlDate = true; }
  if (rp && typeof rp.dateTo === 'string' && rp.dateTo) { initEnd = rp.dateTo.slice(0, 10); hasUrlDate = true; }
  if (rp && typeof rp.status === 'string' && rp.status) finExpFilters.status = rp.status;
  else finExpFilters.status = 'all';
  if (rp && typeof rp.category === 'string') finExpFilters.category = rp.category;
  else finExpFilters.category = '';
  if (rp && typeof rp.account === 'string') finExpFilters.accountId = rp.account;
  else finExpFilters.accountId = '';

  var el = document.getElementById('financeExpensesTab');
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    '<h2 style="margin:0 0 16px 0;font-size:1.15rem;font-weight:700;">Expenses</h2>' +
    '<div id="fExpBanks" style="margin-bottom:16px;">' + skeletonCards(2) + '</div>' +
    periodPicker('fExp', initStart, initEnd) +
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
        '<span style="font-size:1.15rem;">🏦</span>' +
        '<div><div style="font-size:0.9rem;font-weight:600;">No banks connected</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray,#888);">Connect a bank in the Expenses view to import transactions automatically.</div></div>' +
        '</div>';
      return;
    }
    // W1.5 (-OtMNIpvOQT8_RitK1CX): bank-sync header redesign. The old
    // bare "error" chip with no recovery path made the user fly blind.
    // New: inline Reconnect (Plaid Link re-auth) + Retry (re-fire sync)
    // buttons plus a precise lastSync timestamp ("Last successful sync:
    // 2026-04-30 14:32"). Uses _jsAttr for onclick safety.
    function _jsAttrSafe(s) { return (window._jsAttr) ? window._jsAttr(s) : String(s || ''); }
    function _fmtSyncTs(iso) {
      if (!iso) return 'never';
      try {
        var d = new Date(iso);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }) +
          ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      } catch (x) { return iso; }
    }
    var h = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px;">';
    keys.forEach(function(itemId) {
      var item = items[itemId];
      var status = item.status || 'unknown';
      var isError = status === 'error' || status === 'login_required' || status === 'expired';
      var statusColor = status === 'active' ? '#16a34a' : isError ? '#dc2626' : '#9ca3af';
      var acctCount = (item.accounts && item.accounts.length) || 0;
      var idAttr = _jsAttrSafe(itemId);
      var inFlight = !!_bankSyncInFlight[itemId];
      h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:12px 16px;flex:1;min-width:240px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;">';
      h += '<div style="font-weight:600;font-size:0.9rem;">' + e(item.institutionName || 'Bank') + '</div>';
      h += '<span style="background:' + statusColor + ';color:#fff;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + e(status) + '</span>';
      h += '</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:8px;">' + acctCount + ' account' + (acctCount !== 1 ? 's' : '');
      h += ' · Last successful sync: ' + e(_fmtSyncTs(item.lastSuccessfulSyncAt || item.lastSyncAt));
      h += '</div>';
      if (isError && item.lastSyncError) {
        h += '<div style="font-size:0.72rem;color:#fca5a5;margin-bottom:8px;">' + e(String(item.lastSyncError).slice(0, 160)) + '</div>';
      }
      h += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
      if (isError) {
        h += '<button class="btn btn-primary btn-small" onclick="finExpReconnectBank(\'' + idAttr + '\')"' + (inFlight ? ' disabled' : '') + '>Reconnect</button>';
        h += '<button class="btn btn-secondary btn-small" onclick="finExpSyncBank(\'' + idAttr + '\')"' + (inFlight ? ' disabled' : '') + '>Retry</button>';
      } else {
        h += '<button class="btn btn-secondary btn-small" onclick="finExpSyncBank(\'' + idAttr + '\')"' + (inFlight ? ' disabled' : '') + '>' + (inFlight ? 'Syncing…' : 'Sync') + '</button>';
      }
      h += '</div></div>';
    });
    h += '</div>';
    el.innerHTML = h;
  } catch (err) {
    el.innerHTML = '';
  }
}

var finExpCache = { expenses: [], start: '', end: '' };
var finExpAllExpenses = [];          // pre-filter (date-period only, personal excluded)
var finExpAccountLookup = {};        // plaidAccountId → { institution, mask }
var finExpFilters = { status: 'all', category: '', accountId: '' };
var finExpSelected = {};             // _id → true
var FIN_EXP_CATEGORIES = [
  { v: 'materials',         l: 'Materials' },
  { v: 'booth_fee',         l: 'Booth Fee' },
  { v: 'shipping_supplies', l: 'Shipping' },
  { v: 'travel',            l: 'Travel' },
  { v: 'marketing',         l: 'Marketing' },
  { v: 'equipment',         l: 'Equipment' },
  { v: 'software',          l: 'Software' },
  { v: 'payroll',           l: 'Payroll' },
  { v: 'taxes',             l: 'Taxes' },
  { v: 'other',             l: 'Other' }
];

async function loadFinExpenses() {
  var startEl = document.getElementById('fExpS');
  var endEl   = document.getElementById('fExpE');
  var start   = startEl ? startEl.value : monthStart();
  var end     = endEl   ? endEl.value   : monthEnd();

  var el = document.getElementById('fExpContent');
  if (!el) return;
  el.innerHTML = skeletonTable(6,4);

  finExpSelected = {}; // reset selection on reload

  try {
    // Build account lookup once per load (used by Account filter + row display)
    try {
      var plaidItems = (await MastDB.plaidItems.list()) || {};
      finExpAccountLookup = {};
      Object.values(plaidItems).forEach(function(item) {
        if (item.accounts) {
          item.accounts.forEach(function(acct) {
            finExpAccountLookup[acct.accountId] = {
              institution: item.institutionName || 'Bank',
              mask: acct.mask || '????'
            };
          });
        }
      });
    } catch (e) { /* non-critical */ }

    var raw = await MastDB.query('admin/expenses').orderByChild('date').startAt(start).endAt(end).limitToLast(500).once();
    var expenses = Object.entries(raw || {}).map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); });
    expenses = expenses.filter(function(ex) { return ex.category !== 'personal'; });
    expenses.sort(function(a,b) { return (b.date || '').localeCompare(a.date || ''); });

    finExpAllExpenses = expenses;
    finExpCache.start = start;
    finExpCache.end = end;
    applyFinExpFilters();
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
  }
}

function applyFinExpFilters() {
  var f = finExpFilters;
  // expenseIds URL filter: applied on top of pill state.
  var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var idsParam = (rp && typeof rp.expenseIds === 'string') ? rp.expenseIds : '';
  var idLookup = null;
  if (idsParam) {
    idLookup = Object.create(null);
    idsParam.split(',').map(function(s){return s.trim();}).filter(Boolean).forEach(function(id){idLookup[id]=true;});
  }
  var filtered = finExpAllExpenses.filter(function(ex) {
    if (f.status === 'unreviewed' && ex.reviewed) return false;
    if (f.status === 'reviewed' && !ex.reviewed) return false;
    if (f.category && ex.category !== f.category) return false;
    if (f.accountId && ex.plaidAccountId !== f.accountId) return false;
    if (idLookup && !idLookup[ex._id]) return false;
    return true;
  });
  finExpCache.expenses = filtered;
  var el = document.getElementById('fExpContent');
  if (el) el.innerHTML = renderFinExpenses(filtered, finExpCache.start, finExpCache.end);
}

window.toggleFinanceTestData = function() {
  _includeTestData = !_includeTestData;
  // W1.5 carry-forward complete: re-fire whichever Finance loader is mounted
  // so the chip-flip applies to the user's active view. Revenue, P&L, AR
  // aging, and Cash Flow all honor the flag. AP (purchaseReceipts → vendor
  // invoices) has no test-channel concept and is intentionally unfiltered.
  if (document.getElementById('fRevContent')) loadRevenue();
  if (document.getElementById('fPlContent')) loadPnl();
  if (document.getElementById('fArContent')) loadArData();
  if (document.getElementById('fCfContent')) loadCashFlow();
};

window.setFinExpFilter = function(key, value) {
  finExpFilters[key] = value;
  finExpSelected = {};
  applyFinExpFilters();
};

// Drop URL-driven expense filters and re-navigate to the bare expenses view.
window.clearExpensesFilter = function() {
  var p = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var next = {};
  var DROP = { status: 1, category: 1, account: 1, dateFrom: 1, dateTo: 1, expenseIds: 1 };
  Object.keys(p).forEach(function(k) { if (!DROP[k]) next[k] = p[k]; });
  if (typeof navigateTo === 'function') navigateTo('finance-expenses', next);
};

function renderFinExpenses(expenses, start, end) {
  var total = 0;
  var byCategory = {};
  expenses.forEach(function(ex) {
    total += ex.amount || 0;
    var cat = ex.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + (ex.amount || 0);
  });

  var catColors = { materials:'#8b5cf6', booth_fee:'#f59e0b', shipping_supplies:'#3b82f6', travel:'#10b981', marketing:'#ec4899', equipment:'#6366f1', software:'#0ea5e9', payroll:'#f97316', taxes:'#dc2626', other:'#6b7280' };

  // URL-filter banner — surfaces active MCP-link filters with Clear button.
  var rpExp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var urlExpStatus = (rpExp && typeof rpExp.status === 'string') ? rpExp.status : '';
  var urlExpCategory = (rpExp && typeof rpExp.category === 'string') ? rpExp.category : '';
  var urlExpAccount = (rpExp && typeof rpExp.account === 'string') ? rpExp.account : '';
  var urlExpDateFrom = (rpExp && typeof rpExp.dateFrom === 'string') ? rpExp.dateFrom.slice(0, 10) : '';
  var urlExpDateTo = (rpExp && typeof rpExp.dateTo === 'string') ? rpExp.dateTo.slice(0, 10) : '';
  var urlExpIdsParam = (rpExp && typeof rpExp.expenseIds === 'string') ? rpExp.expenseIds : '';
  var urlExpIds = urlExpIdsParam ? urlExpIdsParam.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
  var hasUrlExpFilter = !!(urlExpStatus || urlExpCategory || urlExpAccount || urlExpDateFrom || urlExpDateTo || urlExpIds.length);

  var h = '';
  if (hasUrlExpFilter) {
    var bParts = [];
    if (urlExpIds.length) bParts.push(urlExpIds.length + ' selected expense' + (urlExpIds.length === 1 ? '' : 's'));
    if (urlExpStatus) bParts.push('status: ' + urlExpStatus);
    if (urlExpCategory) bParts.push('category: ' + urlExpCategory);
    if (urlExpAccount) {
      var acctLabel = urlExpAccount;
      if (typeof finExpAccountLookup !== 'undefined' && finExpAccountLookup[urlExpAccount]) {
        acctLabel = finExpAccountLookup[urlExpAccount].institution + ' ••' + finExpAccountLookup[urlExpAccount].mask;
      }
      bParts.push('account: ' + acctLabel);
    }
    if (urlExpDateFrom && urlExpDateTo) bParts.push('from ' + urlExpDateFrom + ' to ' + urlExpDateTo);
    else if (urlExpDateFrom) bParts.push('from ' + urlExpDateFrom + ' onward');
    else if (urlExpDateTo) bParts.push('through ' + urlExpDateTo);
    h += '<div id="fExpUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
      '<span>💸 Showing ' + bParts.join(', ') + '</span>' +
      '<button type="button" onclick="clearExpensesFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
    '</div>';
  }

  // Summary cards
  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;align-items:flex-start;">';
  h += statCard('Total Expenses', fmt$(total), '#dc2626');
  h += statCard('Transactions', String(expenses.length), 'var(--text,#fff)');
  var unreviewedCount = expenses.filter(function(ex) { return !ex.reviewed; }).length;
  if (unreviewedCount > 0) h += statCard('Needs Review', String(unreviewedCount), '#eab308');
  h += statCard('Period', toDateShort(start) + ' – ' + toDateShort(end), 'var(--warm-gray,#888)');
  h += '</div>';

  // Filter row + Ask AI
  var filterSelStyle = 'padding:7px 10px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;font-family:inherit;font-size:0.85rem;background:var(--bg,#1a1a1a);color:var(--text,#fff);';
  h += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">';
  h += '<select onchange="setFinExpFilter(\'status\', this.value)" style="' + filterSelStyle + '">';
  h += '<option value="all"' + (finExpFilters.status === 'all' ? ' selected' : '') + '>All</option>';
  h += '<option value="unreviewed"' + (finExpFilters.status === 'unreviewed' ? ' selected' : '') + '>Unreviewed</option>';
  h += '<option value="reviewed"' + (finExpFilters.status === 'reviewed' ? ' selected' : '') + '>Reviewed</option>';
  h += '</select>';
  h += '<select onchange="setFinExpFilter(\'category\', this.value)" style="' + filterSelStyle + '">';
  h += '<option value=""' + (finExpFilters.category === '' ? ' selected' : '') + '>All Categories</option>';
  FIN_EXP_CATEGORIES.forEach(function(c) {
    h += '<option value="' + c.v + '"' + (finExpFilters.category === c.v ? ' selected' : '') + '>' + e(c.l) + '</option>';
  });
  h += '</select>';
  if (Object.keys(finExpAccountLookup).length > 0) {
    h += '<select onchange="setFinExpFilter(\'accountId\', this.value)" style="' + filterSelStyle + '">';
    h += '<option value=""' + (finExpFilters.accountId === '' ? ' selected' : '') + '>All Accounts</option>';
    Object.keys(finExpAccountLookup).forEach(function(acctId) {
      var a = finExpAccountLookup[acctId];
      h += '<option value="' + e(acctId) + '"' + (finExpFilters.accountId === acctId ? ' selected' : '') + '>' + e(a.institution) + ' ••' + e(a.mask) + '</option>';
    });
    h += '</select>';
  }
  h += '<div style="flex:1;"></div>';
  if (window.MastAskAi && window.MastAskAi.isEnabled()) {
    h += '<button class="btn btn-secondary btn-small" onclick="MastAskAi.open(\'finance-expenses\')" title="Ask Claude about what you are seeing">✨ Ask AI</button>';
  }
  h += '</div>';

  // Bulk action bar
  var visibleIds = expenses.slice(0, 100).map(function(ex) { return ex._id; });
  var selectedCount = visibleIds.filter(function(id) { return finExpSelected[id]; }).length;
  var allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;
  h += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;font-size:0.85rem;">';
  h += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--warm-gray,#888);">';
  h += '<input type="checkbox" id="finExpSelectAll" onclick="finExpToggleAll(this.checked)"' + (allSelected ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer;accent-color:var(--amber,#c4853c);">';
  h += 'Select all visible';
  h += '</label>';
  h += '<button class="btn btn-secondary btn-small" id="finExpBulkApproveBtn" onclick="finExpBulkApprove()"' + (selectedCount === 0 ? ' disabled' : '') + '>Approve' + (selectedCount > 0 ? ' (' + selectedCount + ')' : '') + '</button>';
  h += '<button class="btn btn-secondary btn-small" id="finExpBulkPersonalBtn" onclick="finExpBulkPersonal()"' + (selectedCount === 0 ? ' disabled' : '') + '>Mark Personal</button>';
  h += '</div>';

  if (expenses.length === 0) {
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
      '<div style="font-size:1.6rem;margin-bottom:8px;">💸</div>' +
      '<div style="font-size:0.9rem;font-weight:500;">No expenses match these filters</div>' +
      '<div style="font-size:0.85rem;margin-top:4px;">Try clearing a filter, or expand the date range.</div></div>';
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
      h += '<div style="font-size:0.78rem;font-weight:600;text-transform:capitalize;">' + e(cat.replace(/_/g,' ')) + '</div>';
      h += '<div style="font-size:0.9rem;font-weight:700;">' + fmt$(byCategory[cat]) + '</div>';
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
    var isChecked = !!finExpSelected[ex._id];
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:10px 14px;border-left:3px solid ' + (needsReview ? '#eab308' : 'transparent') + ';display:flex;align-items:center;gap:10px;">';
    h += '<input type="checkbox" class="fin-exp-row-cb" data-id="' + e(ex._id) + '" onclick="finExpToggleRow(this.dataset.id, this.checked)"' + (isChecked ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer;flex-shrink:0;accent-color:var(--amber,#c4853c);">';
    h += '<div onclick="finExpOpenDetail(\'' + e(ex._id) + '\')" style="flex:1;min-width:0;display:flex;align-items:center;gap:12px;cursor:pointer;">';
    h += '<div style="flex:1;min-width:0;">';
    h += '<div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + e(ex.merchantName || ex.description || 'Expense') + '</div>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-top:2px;">';
    h += e(ex.date || '');
    h += ' · <span style="background:' + color + '22;color:' + color + ';padding:1px 6px;border-radius:3px;font-size:0.72rem;">' + e(cat.replace(/_/g,' ')) + '</span>';
    if (ex.plaidAccountId && finExpAccountLookup[ex.plaidAccountId]) {
      var a = finExpAccountLookup[ex.plaidAccountId];
      h += ' · <span style="font-size:0.72rem;">' + e(a.institution) + ' ••' + e(a.mask) + '</span>';
    }
    if (needsReview) h += ' · <span style="color:#eab308;font-size:0.72rem;">⚠ Review needed</span>';
    h += '</div></div>';
    h += '<div style="font-weight:700;font-size:0.9rem;flex-shrink:0;">' + fmt$(ex.amount || 0) + '</div>';
    h += '</div></div>';
  });
  if (expenses.length > 100) h += '<div style="color:var(--warm-gray,#888);font-size:0.78rem;padding:8px 0;">Showing 100 of ' + expenses.length + ' expenses. Use filters to narrow.</div>';
  h += '</div>';

  // W1.3 + R-FIN-1: CSV exporter + Period · Basis footer.
  _finExporters.expenses = function() {
    var rows = [];
    rows.push(['Date', 'Merchant', 'Description', 'Category', 'Account', 'Reviewed', 'Amount (USD)']);
    expenses.forEach(function(ex) {
      var acct = (ex.plaidAccountId && finExpAccountLookup[ex.plaidAccountId])
        ? (finExpAccountLookup[ex.plaidAccountId].institution + ' ••' + finExpAccountLookup[ex.plaidAccountId].mask)
        : '';
      rows.push([
        ex.date || '', ex.merchantName || '', ex.description || '',
        ex.category || '', acct, ex.reviewed ? 'yes' : 'no',
        ((ex.amount || 0) / 100).toFixed(2)
      ]);
    });
    _finDownloadCsv('expenses', rows, 'Period: ' + start + ' to ' + end + ' · Basis: admin/expenses.date');
  };
  h += _finFooter('expenses', start + ' to ' + end, 'admin/expenses.date');

  return h;
}

// ── Bulk select / actions ────────────────────────────────────────────────────

window.finExpToggleRow = function(id, checked) {
  if (checked) finExpSelected[id] = true;
  else delete finExpSelected[id];
  finExpUpdateBulkUI();
};

window.finExpToggleAll = function(checked) {
  var visible = finExpCache.expenses.slice(0, 100);
  if (checked) {
    visible.forEach(function(ex) { finExpSelected[ex._id] = true; });
  } else {
    visible.forEach(function(ex) { delete finExpSelected[ex._id]; });
  }
  document.querySelectorAll('.fin-exp-row-cb').forEach(function(cb) { cb.checked = checked; });
  finExpUpdateBulkUI();
};

function finExpUpdateBulkUI() {
  var visible = finExpCache.expenses.slice(0, 100);
  var selectedCount = visible.filter(function(ex) { return finExpSelected[ex._id]; }).length;
  var approveBtn = document.getElementById('finExpBulkApproveBtn');
  var personalBtn = document.getElementById('finExpBulkPersonalBtn');
  var selectAll = document.getElementById('finExpSelectAll');
  if (approveBtn) {
    approveBtn.disabled = selectedCount === 0;
    approveBtn.textContent = selectedCount > 0 ? 'Approve (' + selectedCount + ')' : 'Approve';
  }
  if (personalBtn) personalBtn.disabled = selectedCount === 0;
  if (selectAll) {
    selectAll.checked = visible.length > 0 && selectedCount === visible.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < visible.length;
  }
}

function finExpSelectedIds() {
  return finExpCache.expenses.slice(0, 100)
    .filter(function(ex) { return finExpSelected[ex._id]; })
    .map(function(ex) { return ex._id; });
}

window.finExpBulkApprove = function() {
  var ids = finExpSelectedIds();
  if (ids.length === 0) return;
  mastConfirm('Approve ' + ids.length + ' expense' + (ids.length !== 1 ? 's' : '') + '?', { title: 'Approve expenses', confirmLabel: 'Approve' }).then(async function(ok) {
    if (!ok) return;
    var btn = document.getElementById('finExpBulkApproveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }
    try {
      var updates = {};
      var now = new Date().toISOString();
      ids.forEach(function(id) {
        updates['admin/expenses/' + id + '/reviewed'] = true;
        updates['admin/expenses/' + id + '/updatedAt'] = now;
      });
      await MastDB.update('', updates);
      showToast('Approved ' + ids.length + ' expense' + (ids.length !== 1 ? 's' : ''));
      finExpSelected = {};
      loadFinExpenses();
    } catch (err) {
      showToast('Approve failed: ' + e(err.message), true);
      if (btn) { btn.disabled = false; btn.textContent = 'Approve (' + ids.length + ')'; }
    }
  });
};

window.finExpBulkPersonal = function() {
  var ids = finExpSelectedIds();
  if (ids.length === 0) return;
  mastConfirm('Mark ' + ids.length + ' expense' + (ids.length !== 1 ? 's' : '') + ' as personal? They will be excluded from business reports.', { title: 'Mark as personal', confirmLabel: 'Mark Personal' }).then(async function(ok) {
    if (!ok) return;
    var btn = document.getElementById('finExpBulkPersonalBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Marking…'; }
    try {
      var updates = {};
      var now = new Date().toISOString();
      ids.forEach(function(id) {
        updates['admin/expenses/' + id + '/category'] = 'personal';
        updates['admin/expenses/' + id + '/categorySource'] = 'user';
        updates['admin/expenses/' + id + '/reviewed'] = true;
        updates['admin/expenses/' + id + '/updatedAt'] = now;
      });
      await MastDB.update('', updates);
      showToast(ids.length + ' marked personal');
      finExpSelected = {};
      loadFinExpenses();
    } catch (err) {
      showToast('Failed: ' + e(err.message), true);
      if (btn) { btn.disabled = false; btn.textContent = 'Mark Personal'; }
    }
  });
};

// ── Detail slide-over (edit category, business line, notes, etc) ─────────────

var FIN_EXP_BUSINESS_LINES = [
  { v: '',           l: '—' },
  { v: 'production', l: 'Production' },
  { v: 'sculpture',  l: 'Sculpture' },
  { v: 'general',    l: 'General' }
];

window.finExpOpenDetail = function(id) {
  var ex = finExpAllExpenses.find(function(x) { return x._id === id; });
  if (!ex) return;
  renderFinExpDetailPanel(ex);
};

window.finExpCloseDetail = function() {
  var p = document.getElementById('finExpDetailPanel');
  if (p) p.remove();
};

function renderFinExpDetailPanel(ex) {
  var existing = document.getElementById('finExpDetailPanel');
  if (existing) existing.remove();

  var amountStr = (ex.amount >= 0 ? '' : '-') + '$' + (Math.abs(ex.amount) / 100).toFixed(2);
  var amountColor = ex.amount >= 0 ? 'inherit' : '#16a34a';
  var sourceLabel = ex.source === 'plaid' ? 'Plaid' : ex.source === 'csv_import' ? 'CSV Import' : 'Manual';
  var sourceIcon = ex.source === 'plaid' ? '🏦' : ex.source === 'csv_import' ? '📄' : '✍️';
  var inputStyle = 'width:100%;padding:9px 12px;border:1px solid rgba(255,255,255,0.12);border-radius:6px;background:var(--bg,#1a1a1a);color:var(--text,#fff);font-family:inherit;font-size:0.9rem;box-sizing:border-box;';
  var labelStyle = 'font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;font-weight:600;';
  var idEsc = e(ex._id);

  var allCats = FIN_EXP_CATEGORIES.concat([{ v: 'personal', l: 'Personal' }]);

  var h = '';
  h += '<div onclick="finExpCloseDetail()" style="flex:1;background:rgba(0,0,0,0.5);"></div>';
  h += '<div style="width:480px;max-width:100%;background:var(--bg-secondary,#232323);overflow:auto;box-shadow:-8px 0 24px rgba(0,0,0,0.4);" onclick="event.stopPropagation()">';

  // Header
  h += '<div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">';
  h += '<div style="flex:1;min-width:0;">';
  h += '<div style="font-size:1rem;font-weight:700;">' + sourceIcon + ' ' + e(ex.merchantName || ex.description || 'Expense') + '</div>';
  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-top:2px;">' + e(ex.date || '') + ' · ' + sourceLabel + (ex.pending ? ' · pending' : '') + '</div>';
  h += '</div>';
  h += '<div style="font-size:1.6rem;font-weight:700;color:' + amountColor + ';flex-shrink:0;">' + amountStr + '</div>';
  h += '<button onclick="finExpCloseDetail()" style="background:none;border:none;font-size:1.6rem;cursor:pointer;color:var(--warm-gray,#888);padding:0 4px;line-height:1;flex-shrink:0;">×</button>';
  h += '</div>';

  // Body
  h += '<div style="padding:20px;">';

  if (ex.description && ex.description !== ex.merchantName) {
    h += '<div style="margin-bottom:14px;"><label style="' + labelStyle + '">Description</label><div style="font-size:0.9rem;">' + e(ex.description) + '</div></div>';
  }

  // Category
  h += '<div style="margin-bottom:14px;"><label style="' + labelStyle + '">Category</label>';
  h += '<select onchange="finExpUpdateField(\'' + idEsc + '\',\'category\',this.value)" style="' + inputStyle + '">';
  allCats.forEach(function(c) {
    h += '<option value="' + c.v + '"' + (ex.category === c.v ? ' selected' : '') + '>' + e(c.l) + '</option>';
  });
  h += '</select></div>';

  // Business Line
  h += '<div style="margin-bottom:14px;"><label style="' + labelStyle + '">Business Line</label>';
  h += '<select onchange="finExpUpdateField(\'' + idEsc + '\',\'businessLine\',this.value)" style="' + inputStyle + '">';
  FIN_EXP_BUSINESS_LINES.forEach(function(b) {
    h += '<option value="' + b.v + '"' + ((ex.businessLine || '') === b.v ? ' selected' : '') + '>' + e(b.l) + '</option>';
  });
  h += '</select></div>';

  // Studio overhead
  h += '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin-bottom:14px;padding:10px 12px;background:var(--bg,#1a1a1a);border-radius:6px;border:1px solid rgba(255,255,255,0.06);">';
  h += '<input type="checkbox"' + (ex.isStudioOverhead ? ' checked' : '') + ' onchange="finExpUpdateField(\'' + idEsc + '\',\'isStudioOverhead\',this.checked)" style="width:18px;height:18px;margin-top:1px;accent-color:var(--amber,#c4853c);">';
  h += '<div><div style="font-size:0.85rem;font-weight:600;">Fixed studio overhead</div>';
  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-top:2px;">Recurring costs to keep your studio running (rent, insurance, subscriptions).</div></div></label>';

  // Notes
  h += '<div style="margin-bottom:14px;"><label style="' + labelStyle + '">Notes</label>';
  h += '<textarea rows="3" onblur="finExpUpdateField(\'' + idEsc + '\',\'notes\',this.value)" style="' + inputStyle + 'resize:vertical;">' + e(ex.notes || '') + '</textarea></div>';

  // Source details (collapsible)
  h += '<details style="margin-top:8px;font-size:0.78rem;color:var(--warm-gray,#888);">';
  h += '<summary style="cursor:pointer;padding:6px 0;">Source details</summary>';
  h += '<div style="margin-top:8px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:0.78rem;line-height:1.4;">';
  h += '<div>Source:</div><div>' + sourceLabel + '</div>';
  if (ex.plaidCategory) h += '<div>Plaid Category:</div><div>' + e(ex.plaidCategory) + '</div>';
  if (ex.plaidCategoryDetailed) h += '<div>Plaid Detail:</div><div>' + e(ex.plaidCategoryDetailed) + '</div>';
  if (ex.categoryConfidence != null) h += '<div>Confidence:</div><div>' + Math.round(ex.categoryConfidence * 100) + '%</div>';
  if (ex.sourceTransactionId) h += '<div>Txn ID:</div><div style="word-break:break-all;font-family:monospace;font-size:0.72rem;">' + e(ex.sourceTransactionId) + '</div>';
  if (ex.plaidAccountId && finExpAccountLookup[ex.plaidAccountId]) {
    var a = finExpAccountLookup[ex.plaidAccountId];
    h += '<div>Account:</div><div>' + e(a.institution) + ' ••' + e(a.mask) + '</div>';
  }
  if (ex.createdAt) h += '<div>Created:</div><div>' + new Date(ex.createdAt).toLocaleString() + '</div>';
  if (ex.updatedAt) h += '<div>Updated:</div><div>' + new Date(ex.updatedAt).toLocaleString() + '</div>';
  h += '</div></details>';

  // Action row
  h += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
  if (!ex.reviewed) {
    h += '<button class="btn btn-primary btn-small" onclick="finExpDetailApprove(\'' + idEsc + '\')">Approve</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="finExpDetailPersonal(\'' + idEsc + '\')">Personal</button>';
  } else {
    h += '<span style="background:#16a34a;color:#fff;padding:6px 12px;border-radius:4px;font-size:0.78rem;font-weight:600;">✓ Approved</span>';
  }
  h += '<div style="flex:1;"></div>';
  h += '<button class="btn btn-danger btn-small" onclick="finExpDetailDelete(\'' + idEsc + '\')">Delete</button>';
  h += '</div>';

  h += '</div>'; // body
  h += '</div>'; // panel

  var overlay = document.createElement('div');
  overlay.id = 'finExpDetailPanel';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;justify-content:flex-end;';
  overlay.innerHTML = h;
  document.body.appendChild(overlay);
}

window.finExpUpdateField = async function(id, field, value) {
  try {
    var updates = {};
    updates[field] = (value === '' && field !== 'notes') ? null : value;
    updates.updatedAt = new Date().toISOString();
    if (field === 'category') updates.categorySource = 'user';
    await MastDB.expenses.update(id, updates);
    var ex = finExpAllExpenses.find(function(x) { return x._id === id; });
    if (ex) Object.assign(ex, updates);
    applyFinExpFilters();
  } catch (err) {
    showToast('Update failed: ' + e(err.message), true);
  }
};

window.finExpDetailApprove = async function(id) {
  try {
    await MastDB.expenses.update(id, { reviewed: true, updatedAt: new Date().toISOString() });
    showToast('Expense approved');
    finExpCloseDetail();
    loadFinExpenses();
  } catch (err) {
    showToast('Approve failed: ' + e(err.message), true);
  }
};

window.finExpDetailPersonal = async function(id) {
  try {
    await MastDB.expenses.update(id, {
      category: 'personal',
      categorySource: 'user',
      reviewed: true,
      updatedAt: new Date().toISOString()
    });
    showToast('Marked as personal');
    finExpCloseDetail();
    loadFinExpenses();
  } catch (err) {
    showToast('Failed: ' + e(err.message), true);
  }
};

window.finExpDetailDelete = function(id) {
  mastConfirm('Delete this expense? This cannot be undone.', { title: 'Delete expense', confirmLabel: 'Delete', danger: true }).then(async function(ok) {
    if (!ok) return;
    try {
      await MastDB.expenses.remove(id);
      showToast('Expense deleted');
      finExpCloseDetail();
      loadFinExpenses();
    } catch (err) {
      showToast('Delete failed: ' + e(err.message), true);
    }
  });
};

// ── Ask AI registration (UI → Claude handoff) ────────────────────────────────
// See CC Idea -Os1Lrm8ShTKZMafXV4k. Modal, launch strategy, and prompt envelope
// live in window.MastAskAi (index.html). This page only contributes its
// snapshot via buildContext() and domain hints via notes.

// Re-render the Expenses page when MastAskAi config changes so the button
// appears/disappears immediately after the user saves in Settings → AI.
window.addEventListener('mastaskai:configchanged', function() {
  var tab = document.getElementById('financeExpensesTab');
  if (tab && tab.style.display !== 'none' && typeof loadFinExpenses === 'function') {
    loadFinExpenses();
  }
});

if (window.MastAskAi) {
  window.MastAskAi.register('finance-expenses', {
    title: 'Ask AI about these expenses',
    placeholder: 'e.g. How does my Materials spend this month compare to the prior two months? What categories are growing fastest?',
    notes: [
      'byMonth keys are YYYY-MM. byCategory keys are the page category slugs.',
      'topTransactions is sorted by absolute amount (largest charges and largest credits first).',
      'Amounts are in cents; positive = expense outflow, negative = refund/credit/reimbursement.',
      'Personal-category expenses are filtered out before aggregation.',
      'If a refund is large enough it can make a category total negative — that is a real signal, not a bug.'
    ],
    buildContext: function() {
      var byCategory = {};
      var byMonth = {};
      var byMerchant = {};
      var totalCents = 0;
      var unreviewedCount = 0;
      finExpCache.expenses.forEach(function(ex) {
        var amt = ex.amount || 0;
        totalCents += amt;
        if (!ex.reviewed) unreviewedCount++;
        var cat = ex.category || 'other';
        if (!byCategory[cat]) byCategory[cat] = { count: 0, totalCents: 0 };
        byCategory[cat].count++; byCategory[cat].totalCents += amt;
        var month = (ex.date || '').substring(0, 7) || 'unknown';
        if (!byMonth[month]) byMonth[month] = { count: 0, totalCents: 0 };
        byMonth[month].count++; byMonth[month].totalCents += amt;
        var merchant = ex.merchantName || ex.description || '(unknown)';
        if (!byMerchant[merchant]) byMerchant[merchant] = { count: 0, totalCents: 0, category: cat };
        byMerchant[merchant].count++;
        byMerchant[merchant].totalCents += amt;
      });

      var topTransactions = finExpCache.expenses.slice()
        .sort(function(a, b) { return Math.abs(b.amount || 0) - Math.abs(a.amount || 0); })
        .slice(0, 15)
        .map(function(ex) {
          return {
            date: ex.date || null,
            merchant: ex.merchantName || ex.description || '(unknown)',
            amountCents: ex.amount || 0,
            category: ex.category || 'other',
            reviewed: !!ex.reviewed
          };
        });

      var topMerchants = Object.keys(byMerchant)
        .map(function(name) {
          return { merchant: name, count: byMerchant[name].count, totalCents: byMerchant[name].totalCents, category: byMerchant[name].category };
        })
        .sort(function(a, b) { return Math.abs(b.totalCents) - Math.abs(a.totalCents); })
        .slice(0, 10);

      return {
        route: '/app#finance-expenses',
        pageTitle: 'Finance → Expenses',
        period: { start: finExpCache.start, end: finExpCache.end },
        filters: {
          status: finExpFilters.status,
          category: finExpFilters.category || null,
          accountId: finExpFilters.accountId || null,
          accountLabel: (finExpFilters.accountId && finExpAccountLookup[finExpFilters.accountId])
            ? (finExpAccountLookup[finExpFilters.accountId].institution + ' ••' + finExpAccountLookup[finExpFilters.accountId].mask)
            : null
        },
        aggregates: {
          rowCount: finExpCache.expenses.length,
          totalCents: totalCents,
          totalUSD: (totalCents / 100).toFixed(2),
          unreviewedCount: unreviewedCount,
          byCategory: byCategory,
          byMonth: byMonth
        },
        topTransactions: topTransactions,
        topMerchants: topMerchants
      };
    }
  });
}

window.finExpSyncBank = async function(itemId) {
  // W1.5: track in-flight so the redesigned header can disable buttons.
  if (_bankSyncInFlight[itemId]) return;
  _bankSyncInFlight[itemId] = true;
  loadFinExpBanks(); // re-render for disabled state
  showToast('Syncing transactions…');
  try {
    var syncFn = firebase.functions().httpsCallable('syncPlaidTransactions');
    var result = await syncFn({ tenantId: MastDB.tenantId(), itemId: itemId });
    var d = result.data || {};
    showToast('Synced: ' + (d.imported || 0) + ' new, ' + (d.updated || 0) + ' updated');
    loadFinExpenses();
  } catch (err) {
    showToast('Sync failed: ' + e(err.message), true);
  } finally {
    delete _bankSyncInFlight[itemId];
    loadFinExpBanks();
  }
};

// W1.5: Reconnect kicks off a fresh Plaid Link flow for the existing item.
// Mirrors the new-connection callable but with itemId so the backend can
// re-auth the SAME item (preserves transaction history). Plaid's link_token
// create supports update mode via access_token-bound item lookup.
window.finExpReconnectBank = async function(itemId) {
  if (_bankSyncInFlight[itemId]) return;
  _bankSyncInFlight[itemId] = true;
  loadFinExpBanks();
  try {
    // Try common reconnect callable names — backend may expose either.
    var fnName = 'createPlaidLinkToken';
    var createFn = firebase.functions().httpsCallable(fnName);
    var res = await createFn({ tenantId: MastDB.tenantId(), itemId: itemId, mode: 'update' });
    var linkToken = res && res.data && (res.data.link_token || res.data.linkToken);
    if (!linkToken) { showToast('Could not start reconnect (no link token returned)', true); return; }
    if (typeof window.Plaid !== 'object' || typeof window.Plaid.create !== 'function') {
      showToast('Plaid Link SDK not loaded — refresh the page and try again', true);
      return;
    }
    var handler = window.Plaid.create({
      token: linkToken,
      onSuccess: async function() {
        showToast('Bank reconnected — syncing…');
        delete _bankSyncInFlight[itemId];
        await window.finExpSyncBank(itemId);
      },
      onExit: function(err) {
        delete _bankSyncInFlight[itemId];
        loadFinExpBanks();
        if (err) showToast('Reconnect cancelled', true);
      }
    });
    handler.open();
  } catch (err) {
    showToast('Reconnect failed: ' + e(err.message), true);
    delete _bankSyncInFlight[itemId];
    loadFinExpBanks();
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
    '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Profit & Loss</h2>' +
    '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:3px 10px;border-radius:6px;font-size:0.78rem;font-weight:600;">Admin Only</span>' +
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
  // W1.1 (-OtMNIDfXZW4FdWJ2Ty3): fetch products map for COGS fallback chain.
  // Per R-FIN-2 — never render a structurally-meaningless number. Old behavior
  // defaulted missing COGS to $0 (→ 100% gross margin lie). New behavior:
  //   1. order.items[].cogsCents (snapshot — preferred)
  //   2. products/{pid}.costCents × qty (current cost from Maker)
  //   3. neither available → flag cogsMissing=true so renderPnl shows '—' +
  //      diagnostic instead of computing fake-clean GP/NP.
  var [ordersRaw, salesRaw, expensesRaw, jeRaw, productsRaw] = await Promise.all([
    MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(startDate)).endAt(isoEnd(endDate)).limitToLast(1000).once(),
    MastDB.query('admin/sales').orderByChild('createdAt').startAt(isoStart(startDate)).endAt(isoEnd(endDate)).limitToLast(500).once(),
    MastDB.query('admin/expenses').orderByChild('date').startAt(startDate).endAt(endDate).limitToLast(500).once(),
    MastDB.query('admin/journalEntries').orderByChild('date').startAt(startDate).endAt(endDate).limitToLast(500).once(),
    ((MastDB.products && MastDB.products.get)
      ? MastDB.products.get().then(function(s) { return (s && s.val && s.val()) || (s || {}); }).catch(function() { return {}; })
      : Promise.resolve({}))
  ]);

  var orders  = Object.values(ordersRaw  || {});
  var sales   = Object.values(salesRaw   || {});
  var expenses = Object.values(expensesRaw || {});
  var jes     = Object.values(jeRaw      || {});
  var productsMap = productsRaw || {};

  var revenue = 0;
  var revByChannel = {};
  // W1.5 carry-forward: honor _includeTestData so P&L matches what Revenue
  // shows. Test-exclusion totals tracked for the surface chip so the user
  // can see the gap rather than wondering why P&L < raw orders.
  var testRevenue = 0;
  var testTxnCount = 0;
  orders.forEach(function(o) {
    if (o.status === 'cancelled') return;
    var c = Math.round((o.total || 0) * 100); if (c <= 0) return;
    var ch = o.source || 'direct';
    if (isTestOrder(o) && !_includeTestData) {
      testRevenue += c;
      testTxnCount += 1;
      return;
    }
    revByChannel[ch] = (revByChannel[ch] || 0) + c;
    revenue += c;
  });
  sales.forEach(function(s) {
    if (s.status === 'voided') return;
    var c = Math.round((s.amount || 0) * 100); if (c <= 0) return;
    var ch = s.source || 'pos';
    if (isTestOrder(s) && !_includeTestData) {
      testRevenue += c;
      testTxnCount += 1;
      return;
    }
    revByChannel[ch] = (revByChannel[ch] || 0) + c;
    revenue += c;
  });

  // COGS: traditional inputs (materials expenses + cogs-adjustment JEs)
  // + per-line-item COGS attribution (snapshot OR product cost fallback).
  // Track whether any orders had line items without an attributable cost so the
  // UI can render a diagnostic (R-FIN-2) instead of a misleading 100% margin.
  var cogs = 0;
  var cogsLineMissingCount = 0;   // line items with no cogsCents and no product costCents
  var cogsLineCoveredCount = 0;   // line items that contributed real COGS via snapshot or product fallback
  var cogsFromLineItems = 0;
  expenses.forEach(function(ex) {
    if (ex.category !== 'materials') return;
    if (!ex.reviewed) return;
    cogs += ex.amount || 0;
  });
  jes.forEach(function(j) {
    if (j.category === 'cogs-adjustment') cogs += j.amount || 0;
  });

  // Per-order line-item COGS attribution. Only count orders that contributed
  // to `revenue` above (cancelled / test-excluded already filtered).
  orders.forEach(function(o) {
    if (o.status === 'cancelled') return;
    var c = Math.round((o.total || 0) * 100); if (c <= 0) return;
    if (isTestOrder(o) && !_includeTestData) return;
    var items = o.items || o.lineItems || [];
    if (!items.length) return;
    items.forEach(function(li) {
      var qty = (li && (li.qty || li.quantity)) || 1;
      // 1. Prefer snapshot cogsCents on the line item
      if (li && typeof li.cogsCents === 'number' && li.cogsCents > 0) {
        cogsFromLineItems += li.cogsCents * qty;
        cogsLineCoveredCount += 1;
        return;
      }
      // 2. Fall back to current product cost from Maker
      var pid = li && (li.pid || li.productId);
      var prod = pid ? productsMap[pid] : null;
      var prodCostCents = prod && (typeof prod.costCents === 'number' ? prod.costCents
        : (typeof prod.cost === 'number' ? Math.round(prod.cost * 100) : null));
      if (prodCostCents != null && prodCostCents > 0) {
        cogsFromLineItems += prodCostCents * qty;
        cogsLineCoveredCount += 1;
        return;
      }
      // 3. No COGS available for this line item — flag it.
      cogsLineMissingCount += 1;
    });
  });
  cogs += cogsFromLineItems;
  // cogsMissing = true when we have order revenue but ZERO COGS signal
  // (no materials expense, no JE, and every line item lacks cost data).
  // This is the case where the old code rendered 100% margin.
  var hasRevenue = revenue > 0;
  var cogsMissing = hasRevenue && cogs === 0 && cogsLineMissingCount > 0 && cogsLineCoveredCount === 0;

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

  return {
    revenue, cogs, grossProfit, opex, netProfit, revByChannel, opexByCategory, hasPayroll,
    testRevenue: testRevenue, testTxnCount: testTxnCount,
    cogsMissing: cogsMissing,
    cogsLineMissingCount: cogsLineMissingCount,
    cogsLineCoveredCount: cogsLineCoveredCount
  };
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

  // W1.5 carry-forward: test-data inclusion chip — same UX as Revenue tab so
  // the user sees consistent toggle state across Finance surfaces. Toggle
  // flips _includeTestData via window.toggleFinanceTestData(); P&L re-loads
  // with the new flag respected in computePnlLocal.
  var testTxnCount = (curr && curr.testTxnCount) || 0;
  var testRevenue = (curr && curr.testRevenue) || 0;
  if (_includeTestData || testTxnCount > 0) {
    var chipBg = _includeTestData ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)';
    var chipFg = _includeTestData ? '#f59e0b' : '#9ca3af';
    var chipLabel = _includeTestData
      ? 'Including test data'
      : 'Excluding test data (' + testTxnCount + ' txn' + (testTxnCount === 1 ? '' : 's') + ', ' + fmt$(testRevenue) + ')';
    var btnLabel = _includeTestData ? 'Exclude' : 'Include';
    h += '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">' +
         '<span style="background:' + chipBg + ';color:' + chipFg + ';padding:4px 10px;border-radius:999px;font-size:0.78rem;font-weight:600;">' + chipLabel + '</span>' +
         '<button type="button" onclick="window.toggleFinanceTestData()" style="background:transparent;border:1px solid var(--warm-gray,#666);color:var(--text,#fff);padding:3px 10px;border-radius:999px;font-size:0.78rem;cursor:pointer;">' + btnLabel + '</button>' +
         '</div>';
  }

  // W1.1: per R-FIN-2 (never render meaningless number) — when COGS is missing,
  // render '—' for COGS/GP/NP and a diagnostic that points to the fix.
  // W1.9: |Δ%| > 50 sanity badge — wraps delta with tooltip nudging the user
  // to check test-data filter / data freshness / period boundary.
  var cogsMissing = !!curr.cogsMissing;
  var grossMarginPct = (!cogsMissing && curr.revenue > 0) ? (curr.grossProfit / curr.revenue * 100).toFixed(1) : null;
  var netMarginPct   = (!cogsMissing && curr.revenue > 0) ? (curr.netProfit  / curr.revenue * 100).toFixed(1) : null;

  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  h += statCard('Revenue', fmt$(curr.revenue), '#16a34a', _sanityWrap(deltaBadge(curr.revenue, prev.revenue), curr.revenue, prev.revenue));
  if (cogsMissing) {
    h += statCard('COGS', '—', 'var(--warm-gray,#888)', 'COGS not available');
    h += statCard('Gross Profit', '—', 'var(--warm-gray,#888)', 'Set product cost in Maker module');
    h += statCard('Net Profit', '—', 'var(--warm-gray,#888)', null);
  } else {
    h += statCard('COGS',    fmt$(curr.cogs),    '#f59e0b', _sanityWrap(deltaBadge(-curr.cogs, -prev.cogs), -curr.cogs, -prev.cogs));
    h += statCard('Gross Profit', fmt$(curr.grossProfit), curr.grossProfit >= 0 ? '#22c55e' : '#ef4444', grossMarginPct !== null ? grossMarginPct + '% margin' : null);
    h += statCard('Net Profit', fmt$(curr.netProfit), curr.netProfit >= 0 ? '#22c55e' : '#ef4444', netMarginPct !== null ? netMarginPct + '% net margin' : null);
  }
  h += '</div>';

  if (cogsMissing) {
    h += '<div style="background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.35);color:#f59e0b;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:0.85rem;">' +
      '⚠ <strong>COGS not available.</strong> ' + curr.cogsLineMissingCount + ' line item' + (curr.cogsLineMissingCount === 1 ? '' : 's') + ' in this period have neither a snapshot <code>cogsCents</code> nor a product cost on file. Set product cost in the <strong>Maker</strong> module so P&amp;L can compute Gross Profit instead of treating COGS as $0 (which would falsely show 100% margin).' +
      '</div>';
  }

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

  if (cogsMissing) {
    h += '<div style="display:flex;justify-content:space-between;padding:5px 0;border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:9px;">' +
      '<span style="font-size:0.9rem;font-weight:600;">COGS</span>' +
      '<span style="font-size:0.9rem;font-weight:700;color:var(--warm-gray,#888);">—</span>' +
      '</div>';
  } else {
    h += plRow('COGS', curr.cogs, false, true, '-');
  }

  h += '<div style="display:flex;justify-content:space-between;padding:9px 0;border-top:1px solid rgba(255,255,255,0.15);margin-top:4px;">';
  h += '<span style="font-size:1rem;font-weight:700;">Gross Profit</span>';
  if (cogsMissing) {
    h += '<span style="font-size:1rem;font-weight:700;color:var(--warm-gray,#888);">—</span>';
  } else {
    h += '<span style="font-size:1rem;font-weight:700;color:' + (curr.grossProfit >= 0 ? '#22c55e' : '#ef4444') + ';">' + fmt$(curr.grossProfit) + '</span>';
    if (grossMarginPct) h += '<span style="font-size:0.78rem;color:var(--warm-gray,#888);align-self:center;margin-left:8px;">' + grossMarginPct + '% margin</span>';
  }
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
  h += '<span style="font-size:1.15rem;font-weight:700;">Net Profit</span>';
  if (cogsMissing) {
    h += '<span style="font-size:1.15rem;font-weight:700;color:var(--warm-gray,#888);">—</span>';
  } else {
    h += '<span style="font-size:1.15rem;font-weight:700;color:' + (curr.netProfit >= 0 ? '#22c55e' : '#ef4444') + ';">' + fmt$(curr.netProfit) + '</span>';
    if (netMarginPct) h += '<span style="font-size:0.78rem;color:var(--warm-gray,#888);align-self:center;margin-left:8px;">' + netMarginPct + '% net</span>';
  }
  h += '</div>';

  h += '</div>';

  // Prior period comparison
  if (prev && prev.revenue !== undefined) {
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:14px 18px;">';
    h += '<div style="font-size:0.78rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Prior Period (' + toDateShort(prior.start) + ' – ' + toDateShort(prior.end) + ')</div>';
    h += '<div style="display:flex;gap:20px;flex-wrap:wrap;">';
    function cmpItem(label, curr, prev) {
      var d = curr - prev;
      var pctVal = prev !== 0 ? (d / Math.abs(prev) * 100).toFixed(1) : null;
      var color = d >= 0 ? '#22c55e' : '#ef4444';
      var arrow = d >= 0 ? '▲' : '▼';
      return '<div><div style="font-size:0.78rem;color:var(--warm-gray,#888);">' + label + '</div>' +
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

  // W1.3 + R-FIN-1: register CSV exporter + render Period · Basis footer.
  _finExporters.pnl = function() {
    var rows = [];
    rows.push(['Line', 'Amount (USD)']);
    rows.push(['Revenue', (curr.revenue / 100).toFixed(2)]);
    revChs.forEach(function(ch) {
      rows.push(['  ' + ch, (curr.revByChannel[ch] / 100).toFixed(2)]);
    });
    rows.push(['COGS', cogsMissing ? 'N/A (no product cost)' : (curr.cogs / 100).toFixed(2)]);
    rows.push(['Gross Profit', cogsMissing ? 'N/A' : (curr.grossProfit / 100).toFixed(2)]);
    rows.push(['Operating Expenses', (curr.opex / 100).toFixed(2)]);
    opexCats.forEach(function(cat) {
      rows.push(['  ' + cat, (curr.opexByCategory[cat] / 100).toFixed(2)]);
    });
    rows.push(['Net Profit', cogsMissing ? 'N/A' : (curr.netProfit / 100).toFixed(2)]);
    _finDownloadCsv('pnl', rows, 'Period: ' + start + ' to ' + end + ' · Basis: orders.placedAt + admin/expenses.date');
  };
  h += _finFooter('pnl', start + ' to ' + end, 'orders.placedAt + admin/expenses.date');

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
    '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Cash Flow</h2>' +
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
    // W1.5 carry-forward: filter test-channel orders out of the AR rollup
    // (same shape as the standalone AR loader). AP rollup below is NOT
    // filtered — purchaseReceipts are vendor invoices and have no test-
    // channel concept.
    // W1.2 (-OtMNINSFRiKurYCGY1b): "Money In/Out ≤30d" filter previously
    // required daysLeft >= 0 && <= 30 — i.e. excluded already-overdue
    // receipts/invoices. That made the header card ("AR Outstanding $X / N")
    // disagree with the projection cell on the same panel: overdue invoices
    // counted toward the header but were dropped from the projection. Fix
    // is symmetric on both AR and AP — anything due in (∞,30d] from today
    // (i.e. daysLeft <= 30, including negative = overdue) is "money expected
    // within the next 30d horizon." This is also the only semantics that
    // matches the user's mental model: an invoice 5 days overdue is more
    // certain to land in the 30-day cash window, not less.
    // W1.6 horizon now drives the upper bound via cashHorizonDays.
    // W1.7: wholesale FK preferred (isWholesaleOrder) when classifying
    // inflow tier — surfaced separately in renderCashFlow.
    var horizonDays = (typeof _cashHorizonDays === 'number') ? _cashHorizonDays : 30;
    var allOrders = Object.assign({}, sentRaw || {}, overdueRaw || {});
    var arTotal = 0, arDueHorizon = 0, arCount = 0;
    var arWholesaleHorizon = 0, arDirectHorizon = 0;
    Object.values(allOrders).forEach(function(o) {
      var cents = Math.round((o.total || 0) * 100);
      var paid  = o.invoicePaidAmount || 0;
      var due   = cents - paid;
      if (due <= 0) return;
      if (isTestOrder(o) && !_includeTestData) return;
      arTotal += due; arCount++;
      if (!o.invoiceDueDate) return;
      var daysLeft = Math.floor((new Date(o.invoiceDueDate).getTime() - Date.now()) / 86400000);
      if (daysLeft <= horizonDays) {
        arDueHorizon += due;
        if (isWholesaleOrder(o)) arWholesaleHorizon += due;
        else arDirectHorizon += due;
      }
    });

    // AP due — vendor purchase receipts, no test-channel filter applies.
    var allReceipts = Object.assign({}, unpaidRaw || {}, partialRaw || {});
    var apTotal = 0, apDueHorizon = 0, apCount = 0;
    Object.values(allReceipts).forEach(function(r) {
      var amtCents = r.amountCents || 0;
      var paid = r.paidAmount || 0;
      var due  = amtCents - paid;
      if (due <= 0) return;
      apTotal += due; apCount++;
      if (!r.dueDate) return;
      var daysLeft = Math.floor((new Date(r.dueDate).getTime() - Date.now()) / 86400000);
      if (daysLeft <= horizonDays) apDueHorizon += due;
    });

    // bankTotal is in dollars from Plaid; AR/AP are in cents
    // Normalize: show bank in dollars, AR/AP in dollars too
    var netProjected = bankTotal + (arDueHorizon / 100) - (apDueHorizon / 100);

    _cfLastSnapshot = {
      bankTotal: bankTotal, bankAccounts: bankAccounts, staleItems: staleItems,
      arTotal: arTotal, arDueHorizon: arDueHorizon, arCount: arCount,
      arWholesaleHorizon: arWholesaleHorizon, arDirectHorizon: arDirectHorizon,
      apTotal: apTotal, apDueHorizon: apDueHorizon, apCount: apCount,
      netProjected: netProjected, asOf: asOf, horizonDays: horizonDays
    };
    el.innerHTML = renderCashFlow(bankTotal, bankAccounts, staleItems, arTotal, arDueHorizon, arCount, apTotal, apDueHorizon, apCount, netProjected, asOf);
    _cfLoaded = true;
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Cash flow load failed: ' + err.message, true);
  }
}

function renderCashFlow(bankTotal, bankAccounts, staleItems, arTotal, arDueHorizon, arCount, apTotal, apDueHorizon, apCount, netProjected, asOf) {
  var h = '';
  var horizonDays = (typeof _cashHorizonDays === 'number') ? _cashHorizonDays : 30;
  var snap = _cfLastSnapshot || {};

  // W1.6: horizon toggle (30/60/90d). Re-renders against _cfLastSnapshot —
  // no re-fetch needed since the underlying receipts/invoices haven't moved.
  h += '<div style="display:flex;gap:6px;margin-bottom:14px;align-items:center;">';
  h += '<span style="font-size:0.78rem;color:var(--warm-gray,#888);margin-right:4px;">Horizon:</span>';
  [30, 60, 90].forEach(function(d) {
    var active = horizonDays === d;
    h += '<button class="btn btn-' + (active ? 'primary' : 'secondary') + ' btn-small" onclick="finCashSetHorizon(' + d + ')">' + d + 'd</button>';
  });
  h += '</div>';

  // Summary cards
  var hasBank = bankAccounts.length > 0;
  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  if (hasBank) {
    h += statCard('Cash on Hand', '$' + bankTotal.toFixed(2), '#22c55e', bankAccounts.length + ' account' + (bankAccounts.length !== 1 ? 's' : ''));
  } else {
    h += statCard('Cash on Hand', '—', 'var(--warm-gray,#888)', 'Connect a bank to track');
  }
  // W1.2: card sub-label now shows the projected portion explicitly so the
  // header and the projection cell reconcile visibly on the same panel.
  h += statCard('AR Outstanding', fmt$(arTotal), '#3b82f6',
    arCount + ' invoice' + (arCount !== 1 ? 's' : '') + ' · ' + fmt$(arDueHorizon) + ' in ≤' + horizonDays + 'd');
  h += statCard('AP Due', fmt$(apTotal), '#f97316',
    apCount + ' receipt' + (apCount !== 1 ? 's' : '') + ' · ' + fmt$(apDueHorizon) + ' in ≤' + horizonDays + 'd');
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

  // Horizon forecast (30/60/90d)
  h += '<div style="background:var(--bg-secondary,#232323);border-radius:12px;padding:18px;">';
  h += '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:14px;">Next ' + horizonDays + ' Days</div>';
  h += '<div style="display:flex;gap:16px;flex-wrap:wrap;">';

  h += '<div style="flex:1;min-width:200px;">';
  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:4px;">Money In (AR due ≤' + horizonDays + 'd)</div>';
  h += '<div style="font-size:1.15rem;font-weight:700;color:#22c55e;">' + fmt$(arDueHorizon) + '</div>';
  // W1.7: wholesale/direct split when available.
  if (snap.arWholesaleHorizon || snap.arDirectHorizon) {
    h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);">Wholesale ' + fmt$(snap.arWholesaleHorizon || 0) + ' · Direct ' + fmt$(snap.arDirectHorizon || 0) + '</div>';
  } else {
    h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);">from open invoices</div>';
  }
  h += '</div>';

  h += '<div style="flex:1;min-width:200px;">';
  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:4px;">Money Out (AP due ≤' + horizonDays + 'd)</div>';
  h += '<div style="font-size:1.15rem;font-weight:700;color:#ef4444;">' + fmt$(apDueHorizon) + '</div>';
  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);">from unpaid receipts</div>';
  h += '</div>';

  h += '<div style="flex:1;min-width:200px;">';
  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:4px;">Projected Net Position</div>';
  var projColor = netProjected >= 0 ? '#22c55e' : '#ef4444';
  h += '<div style="font-size:1.15rem;font-weight:700;color:' + projColor + ';">$' + Math.abs(netProjected).toFixed(2) + (netProjected < 0 ? ' deficit' : '') + '</div>';
  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);">cash + AR in − AP out</div>';
  h += '</div>';

  h += '</div></div>';

  // W1.3 + R-FIN-1: CSV exporter + Period · Basis footer.
  _finExporters['cash-flow'] = function() {
    var rows = [];
    rows.push(['Section', 'Label', 'Amount (USD)']);
    rows.push(['Bank', 'Cash on Hand', bankTotal.toFixed(2)]);
    bankAccounts.forEach(function(a) {
      rows.push(['Bank', (a.institution || '') + ' ' + (a.name || '') + (a.mask ? ' ••' + a.mask : ''), a.balance.toFixed(2)]);
    });
    rows.push(['AR', 'Total Outstanding', (arTotal / 100).toFixed(2)]);
    rows.push(['AR', 'Due ≤' + horizonDays + 'd', (arDueHorizon / 100).toFixed(2)]);
    rows.push(['AP', 'Total Due', (apTotal / 100).toFixed(2)]);
    rows.push(['AP', 'Due ≤' + horizonDays + 'd', (apDueHorizon / 100).toFixed(2)]);
    rows.push(['Net', 'Projected ' + horizonDays + 'd', netProjected.toFixed(2)]);
    _finDownloadCsv('cash-flow', rows, 'As of ' + asOf + ' · Horizon: ' + horizonDays + 'd · Basis: plaidItems + orders.invoiceDueDate + purchaseReceipts.dueDate');
  };
  h += _finFooter('cash-flow', 'As of ' + asOf + ' · Horizon ' + horizonDays + 'd', 'plaidItems + orders.invoiceDueDate + purchaseReceipts.dueDate');

  return h;
}

// W1.6 horizon toggle handler — re-render against last-loaded snapshot
// instantly; if no snapshot (first paint failed), trigger a fresh load.
window.finCashSetHorizon = function(days) {
  if (days !== 30 && days !== 60 && days !== 90) return;
  _cashHorizonDays = days;
  // Snapshot's stored horizon may differ → recompute the per-horizon totals
  // from the raw load. Cheap option: re-fire loadCashFlow which already
  // honors _cashHorizonDays. This is also a good guard against drift between
  // the snapshot's bucketing and the current toggle state.
  if (typeof loadCashFlow === 'function') loadCashFlow();
};

// ── AR Tab ────────────────────────────────────────────────────────────────────

function setupArTab() {
  injectFinancePulseCSS();
  _arFilter = 'all';
  var el = document.getElementById('financeArTab');
  var askAi = (window.MastAskAi && window.MastAskAi.isEnabled())
    ? '<button class="btn btn-secondary btn-small" onclick="MastAskAi.open(\'finance-ar\')" title="Ask Claude about your AR">✨ Ask AI</button>'
    : '';
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
    '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Accounts Receivable</h2>' +
    '<div style="display:flex;gap:8px;">' + askAi +
    '<button class="btn btn-secondary btn-small" onclick="loadArData()">Refresh</button>' +
    '</div>' +
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
    // W1.5 carry-forward: honor _includeTestData on AR. Test-channel orders
    // that happened to issue invoices would inflate AR aging numbers without
    // this filter. Tracked separately so the chip can show the excluded total.
    var testRows = 0;
    var testAmtDue = 0;

    Object.entries(allOrders).forEach(function(kv) {
      var orderId = kv[0], o = kv[1];
      var totalCents = Math.round((o.total || 0) * 100);
      var paidCents  = o.invoicePaidAmount || 0;
      var amtDue     = totalCents - paidCents;
      if (amtDue <= 0) return;
      if (isTestOrder(o) && !_includeTestData) {
        testRows += 1;
        testAmtDue += amtDue;
        return;
      }

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
    _arData = { rows: rows, asOf: asOf, testRows: testRows, testAmtDue: testAmtDue };

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

  // W1.5 carry-forward: test-data inclusion chip on AR aging. Same UX as
  // Revenue + P&L for consistency. Test-channel invoices that issued would
  // otherwise inflate aging numbers.
  var testRows = (_arData && _arData.testRows) || 0;
  var testAmtDue = (_arData && _arData.testAmtDue) || 0;
  if (_includeTestData || testRows > 0) {
    var chipBg = _includeTestData ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)';
    var chipFg = _includeTestData ? '#f59e0b' : '#9ca3af';
    var chipLabel = _includeTestData
      ? 'Including test data'
      : 'Excluding test data (' + testRows + ' invoice' + (testRows === 1 ? '' : 's') + ', ' + fmt$(testAmtDue) + ')';
    var btnLabel = _includeTestData ? 'Exclude' : 'Include';
    h += '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">' +
         '<span style="background:' + chipBg + ';color:' + chipFg + ';padding:4px 10px;border-radius:999px;font-size:0.78rem;font-weight:600;">' + chipLabel + '</span>' +
         '<button type="button" onclick="window.toggleFinanceTestData()" style="background:transparent;border:1px solid var(--warm-gray,#666);color:var(--text,#fff);padding:3px 10px;border-radius:999px;font-size:0.78rem;cursor:pointer;">' + btnLabel + '</button>' +
         '</div>';
  }

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
        '<div style="font-size:1.6rem;margin-bottom:8px;">✅</div>' +
        '<div style="font-size:0.9rem;font-weight:500;">No outstanding invoices</div>' +
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
    h += '<td style="padding:10px;font-size:0.78rem;color:var(--warm-gray,#888);">' + e(r.invoiceNumber || '—') + '</td>';
    h += '<td style="padding:10px;font-size:0.78rem;"><a href="#" style="color:var(--teal,#2a9d8f);" onclick="event.preventDefault();navigateTo(\'orders\')">' + e(r.orderId.slice(-8)) + '</a></td>';
    h += '<td style="padding:10px;font-weight:700;color:' + bucketColor(r.bucket) + ';">' + fmt$(r.amtDue) + '</td>';
    h += '<td style="padding:10px;font-size:0.78rem;">' + e(r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—') + '</td>';
    h += '<td style="padding:10px;">' + agingBadge(r.daysOverdue) + '</td>';
    h += '<td style="padding:10px;"><span style="background:rgba(241,164,0,0.15);color:#f59e0b;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + e(r.invoiceStatus) + '</span></td>';
    h += '<td style="padding:10px;white-space:nowrap;">';
    h += '<button class="btn btn-primary btn-small" data-order-id="' + e(r.orderId) + '" data-amt="' + r.totalCents + '" onclick="finArMarkPaid(this.dataset.orderId, parseInt(this.dataset.amt))">Mark Paid</button>';
    h += '</td></tr>';
  });

  h += '</tbody></table></div>';
  return h;
}

if (window.MastAskAi) {
  window.MastAskAi.register('finance-ar', {
    title: 'Ask AI about your AR',
    placeholder: 'e.g. Who owes me the most? Which invoices are 60+ days overdue? What\'s my expected cash this month?',
    notes: [
      'Amounts are in CENTS (amtDue, totalCents, paidCents).',
      'Aging buckets: current (not yet due), 1_to_30, 31_to_60, 61_to_90, 90_plus (days past due date).',
      'topDebtors aggregates by customerName across all open invoices in the current view.',
      'oldestOverdue lists the 15 highest-aged invoices — top of the collection priority list.',
      'totalARCents is sum of amtDue across all rows; bucketTotalsUSD breaks that down by aging bucket.',
      'Only invoiceStatus = sent or overdue invoices are loaded; paid invoices are excluded by the query.'
    ],
    buildContext: function() {
      if (!_arData) return { route: '/app#finance-ar', pageTitle: 'Finance → AR', aggregates: { rowCount: 0 }, note: 'AR data not loaded yet.' };
      var rows = _arData.rows;
      var filtered = rows.filter(function(r) {
        if (_arFilter === 'all') return true;
        if (_arFilter === 'current') return r.bucket === 'current';
        if (_arFilter === 'overdue') return r.bucket !== 'current';
        return true;
      });

      var bucketTotalsCents = { current: 0, '1_to_30': 0, '31_to_60': 0, '61_to_90': 0, '90_plus': 0 };
      var bucketCounts = { current: 0, '1_to_30': 0, '31_to_60': 0, '61_to_90': 0, '90_plus': 0 };
      var totalARCents = 0;
      var byCustomer = {};
      filtered.forEach(function(r) {
        bucketTotalsCents[r.bucket] += r.amtDue;
        bucketCounts[r.bucket]++;
        totalARCents += r.amtDue;
        var c = r.customerName || '(unknown)';
        if (!byCustomer[c]) byCustomer[c] = { invoiceCount: 0, totalDueCents: 0, oldestDays: 0 };
        byCustomer[c].invoiceCount++;
        byCustomer[c].totalDueCents += r.amtDue;
        if (r.daysOverdue > byCustomer[c].oldestDays) byCustomer[c].oldestDays = r.daysOverdue;
      });

      var bucketTotalsUSD = {};
      Object.keys(bucketTotalsCents).forEach(function(k) {
        bucketTotalsUSD[k] = { count: bucketCounts[k], totalUSD: +(bucketTotalsCents[k] / 100).toFixed(2) };
      });

      var topDebtors = Object.keys(byCustomer)
        .map(function(c) {
          return {
            customer: c,
            invoiceCount: byCustomer[c].invoiceCount,
            totalDueUSD: +(byCustomer[c].totalDueCents / 100).toFixed(2),
            oldestDaysOverdue: byCustomer[c].oldestDays
          };
        })
        .sort(function(a, b) { return b.totalDueUSD - a.totalDueUSD; })
        .slice(0, 10);

      var oldestOverdue = filtered.slice()
        .sort(function(a, b) { return b.daysOverdue - a.daysOverdue; })
        .slice(0, 15)
        .map(function(r) {
          return {
            customer: r.customerName,
            invoiceNumber: r.invoiceNumber || null,
            amtDueUSD: +(r.amtDue / 100).toFixed(2),
            dueDate: r.dueDate || null,
            daysOverdue: r.daysOverdue,
            bucket: r.bucket
          };
        });

      return {
        route: '/app#finance-ar',
        pageTitle: 'Finance → AR',
        filters: { bucket: _arFilter },
        asOf: _arData.asOf,
        aggregates: {
          rowCount: filtered.length,
          totalARCents: totalARCents,
          totalARUSD: +(totalARCents / 100).toFixed(2),
          bucketTotalsUSD: bucketTotalsUSD
        },
        topDebtors: topDebtors,
        oldestOverdue: oldestOverdue
      };
    }
  });
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
    '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Accounts Payable</h2>' +
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
        '<div style="font-size:1.6rem;margin-bottom:8px;">✅</div>' +
        '<div style="font-size:0.9rem;font-weight:500;">No outstanding payables</div>' +
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
    h += '<td style="padding:10px;font-size:0.78rem;color:var(--warm-gray,#888);">' + e(r.vendorInvoiceRef || r.receiptId.slice(-8)) + '</td>';
    h += '<td style="padding:10px;">' + fmt$(r.totalCents) + '</td>';
    h += '<td style="padding:10px;color:#22c55e;">' + fmt$(r.paidCents) + '</td>';
    h += '<td style="padding:10px;font-weight:700;color:' + bucketColor(r.bucket) + ';">' + fmt$(r.amtDue) + '</td>';
    h += '<td style="padding:10px;font-size:0.78rem;">' + e(r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—') + '</td>';
    h += '<td style="padding:10px;">' + agingBadge(r.daysOverdue) + '</td>';
    h += '<td style="padding:10px;"><span style="background:' + (r.paymentStatus === 'partial' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.12)') + ';color:' + (r.paymentStatus === 'partial' ? '#eab308' : '#ef4444') + ';padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + e(r.paymentStatus) + '</span></td>';
    h += '<td style="padding:10px;white-space:nowrap;display:flex;gap:4px;">';
    h += '<button class="btn btn-primary btn-small" data-rid="' + e(r.receiptId) + '" data-total="' + r.totalCents + '" onclick="finApMarkPaid(this.dataset.rid, parseInt(this.dataset.total))">Paid</button>';
    h += '<button class="btn btn-secondary btn-small" data-rid="' + e(r.receiptId) + '" data-paid="' + r.paidCents + '" data-total="' + r.totalCents + '" onclick="finApShowPartial(this.dataset.rid, parseInt(this.dataset.paid), parseInt(this.dataset.total))">Partial</button>';
    h += '<button class="btn btn-secondary btn-small" data-rid="' + e(r.receiptId) + '" onclick="finApOpenInProcurement(this.dataset.rid)" title="View in Procurement">→</button>';
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
    h += '<span><span style="color:var(--warm-gray,#888);font-size:0.78rem;">Due</span> <span style="font-size:0.78rem;">' + e(dueDateStr) + '</span></span>';
    h += '<span style="font-weight:700;color:' + worstColor + ';">' + fmt$(g.totalDue) + '</span>';
    h += '<span style="color:var(--warm-gray,#888);font-size:0.85rem;">' + (isExpanded ? '▾' : '▸') + '</span>';
    h += '</div></div></button>';

    // Expanded receipt rows
    if (isExpanded) {
      h += '<div style="border-top:1px solid rgba(255,255,255,0.08);">';
      h += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
      h += '<thead><tr style="background:rgba(255,255,255,0.03);">';
      ['Ref','Total','Paid','Remaining','Due Date','Age','Status',''].forEach(function(col) {
        h += '<th style="text-align:left;padding:7px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">' + col + '</th>';
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
        h += '<td style="padding:8px 10px;"><span style="background:' + (r.paymentStatus === 'partial' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.12)') + ';color:' + (r.paymentStatus === 'partial' ? '#eab308' : '#ef4444') + ';padding:2px 6px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + e(r.paymentStatus) + '</span></td>';
        h += '<td style="padding:8px 10px;white-space:nowrap;display:flex;gap:4px;">';
        h += '<button class="btn btn-primary btn-small" data-rid="' + e(r.receiptId) + '" data-total="' + r.totalCents + '" onclick="finApMarkPaid(this.dataset.rid, parseInt(this.dataset.total))">Paid</button>';
        h += '<button class="btn btn-secondary btn-small" data-rid="' + e(r.receiptId) + '" data-paid="' + r.paidCents + '" data-total="' + r.totalCents + '" onclick="finApShowPartial(this.dataset.rid, parseInt(this.dataset.paid), parseInt(this.dataset.total))">Partial</button>';
        h += '<button class="btn btn-secondary btn-small" data-rid="' + e(r.receiptId) + '" onclick="finApOpenInProcurement(this.dataset.rid)" title="View in Procurement">→</button>';
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

window.finApOpenInProcurement = function(receiptId) {
  try { sessionStorage.setItem('procurementDeepLink', JSON.stringify({ receiptId: receiptId })); } catch (e) {}
  navigateTo('procurement');
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
  h += '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Tax</h2>';
  h += '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:3px 10px;border-radius:6px;font-size:0.78rem;font-weight:600;">Admin Only</span>';
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
    '<span style="font-size:0.78rem;color:var(--warm-gray,#888);margin-left:8px;">' + daysUntil + ' days away</span></div>' +
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
      '<div style="font-size:1.6rem;margin-bottom:8px;">🧾</div>' +
      '<div style="font-size:0.9rem;font-weight:500;">No taxable orders in this period</div></div>';
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
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);"><div style="font-size:0.9rem;font-weight:500;">No sales data found for trailing 12 months</div></div>';
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
      '<span style="font-size:0.78rem;color:var(--warm-gray,#888);white-space:nowrap;">' + revPct + '%</span></div></td>';
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
      '<div style="font-size:1.6rem;margin-bottom:8px;">✅</div>' +
      '<div style="font-size:0.9rem;font-weight:500;">No contractors paid over $600 in ' + year + '</div>' +
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
      ? '<span style="font-family:monospace;font-size:0.78rem;">' + e(c.maskedTaxId) + '</span>'
      : '<span style="color:#ef4444;font-size:0.78rem;font-weight:600;">Missing — action required</span>';
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
  h += '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Reports</h2>';
  h += '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:3px 10px;border-radius:6px;font-size:0.78rem;font-weight:600;">Admin Only</span>';
  h += '</div>';

  // Report A card
  h += '<div style="background:var(--bg-secondary,#232323);border-radius:12px;padding:20px;margin-bottom:16px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">';
  h += '<div><div style="font-size:1rem;font-weight:700;margin-bottom:4px;">Loan / Investor Report</div>';
  h += '<div style="font-size:0.85rem;color:var(--warm-gray,#888);">12-month financial summary formatted for a bank or investor. Print or save as PDF.</div></div>';
  h += '<button class="btn btn-secondary btn-small" onclick="loadLoanReport()">Generate</button></div>';
  h += '<div id="fLoanContent"></div></div>';

  // Report B card
  h += '<div style="background:var(--bg-secondary,#232323);border-radius:12px;padding:20px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">';
  h += '<div><div style="font-size:1rem;font-weight:700;margin-bottom:4px;">Year-End Tax Package</div>';
  h += '<div style="font-size:0.85rem;color:var(--warm-gray,#888);">Everything your CPA needs for Schedule C and state filings. Export CSVs or print the full package.</div></div>';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
  h += '<select id="fReportYear" onchange="finSetReportYear(this.value)" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:4px 8px;font-size:0.85rem;">' + yearOpts + '</select>';
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
  h += '<div style="font-size:1.15rem;font-weight:700;">' + e(tenantName) + '</div>';
  h += '<div style="font-size:0.85rem;color:var(--warm-gray,#888);margin-top:4px;">Financial Summary · ' + toDateShort(startDate) + ' – ' + toDateShort(endDate) + '</div>';
  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-top:2px;">Generated ' + reportDate + '</div>';
  h += '</div>';

  // Key metrics
  h += '<div style="margin-bottom:22px;">';
  h += '<div style="font-size:0.78rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Key Metrics</div>';
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
  h += '<div style="font-size:0.78rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">12-Month Revenue Trend</div>';
  var maxRev = Math.max.apply(null, monthly.map(function(m){return m.revenue;}))||1;
  h += '<div style="display:flex;flex-direction:column;gap:4px;">';
  monthly.forEach(function(m) {
    var w = maxRev>0?Math.round(m.revenue/maxRev*100):0;
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += '<div style="width:68px;font-size:0.72rem;color:var(--warm-gray,#888);text-align:right;flex-shrink:0;">' + e(m.label) + '</div>';
    h += '<div style="flex:1;height:16px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">';
    if (w>0) h += '<div style="height:100%;width:'+w+'%;background:#16a34a;border-radius:3px;"></div>';
    h += '</div>';
    h += '<div style="width:76px;font-size:0.72rem;font-weight:600;text-align:right;flex-shrink:0;">' + fmt$(m.revenue) + '</div>';
    h += '</div>';
  });
  h += '</div></div>';

  // P&L Summary
  h += '<div style="margin-bottom:22px;">';
  h += '<div style="font-size:0.78rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">P&L Summary</div>';
  h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:16px;">';
  function lrRow(label, cents, bold, color) {
    return '<div style="display:flex;justify-content:space-between;padding:4px 0' + (bold?';border-top:1px solid rgba(255,255,255,0.1);margin-top:4px;padding-top:8px;':'') + '">' +
      '<span style="font-size:0.9rem;' + (bold?'font-weight:600;':'color:var(--warm-gray,#888);') + '">' + label + '</span>' +
      '<span style="font-size:0.9rem;font-weight:' + (bold?'700':'400') + ';color:' + (color||'var(--text,#fff)') + ';">' + fmt$(cents) + '</span></div>';
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
    h += '<div style="font-size:0.78rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Cash Position</div>';
    h += '<div style="font-size:1.6rem;font-weight:700;color:#22c55e;">$' + bankTotal.toFixed(2) + '</div>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-top:2px;">Current cash on hand · via connected bank accounts</div>';
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
    h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
    h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
    ['State','Tax Collected','Orders','Registered'].forEach(function(c) {
      h += '<th style="text-align:left;padding:6px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;">' + c + '</th>';
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
    h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
    h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
    ['Contractor','Tax ID','Total Paid','1099 Required'].forEach(function(c) {
      h += '<th style="text-align:left;padding:6px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;">' + c + '</th>';
    });
    h += '</tr></thead><tbody>';
    contractors.forEach(function(c) {
      h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">';
      h += '<td style="padding:7px 10px;font-weight:600;">' + e(c.name) + '</td>';
      h += '<td style="padding:7px 10px;font-size:0.78rem;">' + (c.hasTaxId?'<span style="font-family:monospace;">XXX-XX-'+String(c.taxId||'').replace(/[^0-9]/g,'').slice(-4)+'</span>':'<span style="color:#ef4444;">Missing</span>') + '</td>';
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

// ── Customer Portfolio (Build 6b UI-2) ────────────────────────────────────────
//
// Top-level surface for Sam's portfolio thinking. Computed client-side
// mirroring the server-side analytics.get_customer_portfolio +
// analytics.get_concentration. Reads:
//   admin/customers                                   (lifetime + trailing-12m stats)
//   cs_tickets                                        (cost-to-serve input)
//   admin/rma                                         (cost-to-serve input)
//   admin/config/customerSuccess/costToServeDefaults  (per-tenant defaults)
//
// Renders: concentration card (top-5/10/25 + HHI band) + quadrant chips
// with counts + customer rows sortable by Net Contribution / GM / Revenue.
// Row click → MastNavStack push → customer detail.

var portfolioState = {
  sortBy: 'netContribution',
  quadrantFilter: null,
  rows: null,
  thresholds: null,
  concentration: null,
};

var CTS_DEFAULTS = { perTicketCents: 1500, perReturnCents: 2500 };

function portfolioClassify(netMarginPct, lapseStatus) {
  if (typeof netMarginPct !== 'number' || !lapseStatus || lapseStatus === 'unknown') return 'unclassified';
  var highMargin = netMarginPct >= 0.5;
  var onCadence = lapseStatus === 'active';
  if (highMargin && onCadence) return 'grow';
  if (highMargin && !onCadence) return 'maintain';
  if (!highMargin && onCadence) return 'reprice';
  return 'deprioritize';
}

function portfolioQuadrantStyle(q) {
  if (q === 'grow')         return { label: 'Grow',         bg: 'rgba(34,197,94,0.25)',  color: '#7ddca0' };
  if (q === 'maintain')     return { label: 'Maintain',     bg: 'rgba(99,102,241,0.30)', color: '#a5a8f5' };
  if (q === 'reprice')      return { label: 'Reprice',      bg: 'rgba(245,158,11,0.30)', color: '#fbcc70' };
  if (q === 'deprioritize') return { label: 'Deprioritize', bg: 'rgba(220,53,69,0.30)',  color: '#f49aa3' };
  return                          { label: 'Unclassified', bg: 'rgba(155,149,142,0.35)', color: '#cfcac3' };
}

function portfolioFmtMoney(cents) {
  if (typeof cents !== 'number') return '—';
  var sign = cents < 0 ? '-' : '';
  return sign + '$' + (Math.abs(cents) / 100).toFixed(2);
}

// Sam G — compute trailing N-month portfolio trend (client-side mirror of
// the analytics_get_portfolio_trend MCP tool). Returns
// { months: [{monthLabel, monthlyRevenueCents, top5SharePct, hhi, netContributionCents, activeCustomerCount}] }.
function portfolioComputeTrend(ordersRaw, customersRaw, ticketsRaw, rmaRaw, c2s, monthsBack) {
  var n = Math.max(1, Math.min(monthsBack || 12, 36));
  var now = new Date();
  var labels = [];
  for (var i = n - 1; i >= 0; i--) {
    var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    labels.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
  }
  var labelIdx = {};
  labels.forEach(function(l, i) { labelIdx[l] = i; });

  var revByCust = labels.map(function() { return {}; });
  var activeSet = labels.map(function() { return {}; });

  Object.keys(ordersRaw || {}).forEach(function(oid) {
    var o = ordersRaw[oid];
    if (!o || !o.createdAt) return;
    if (o.status === 'cancelled' || o.status === 'refunded') return;
    var mk = String(o.createdAt).slice(0, 7);
    var idx = labelIdx[mk];
    if (idx === undefined) return;
    var cid = o.customerId || o.linkedCustomerId || null;
    if (!cid) return;
    var amt = typeof o.totalCents === 'number' ? o.totalCents : (typeof o.total === 'number' ? o.total : 0);
    revByCust[idx][cid] = (revByCust[idx][cid] || 0) + amt;
    activeSet[idx][cid] = true;
  });

  var ticketC = {}, returnC = {};
  Object.values(ticketsRaw || {}).forEach(function(t) {
    if (!t || !t.customerId) return;
    ticketC[t.customerId] = (ticketC[t.customerId] || 0) + 1;
  });
  Object.values(rmaRaw || {}).forEach(function(r) {
    if (!r || !r.customerId) return;
    returnC[r.customerId] = (returnC[r.customerId] || 0) + 1;
  });

  var activeMonthsByCust = {};
  for (var ii = 0; ii < n; ii++) {
    Object.keys(activeSet[ii]).forEach(function(cid) {
      activeMonthsByCust[cid] = (activeMonthsByCust[cid] || 0) + 1;
    });
  }

  var marginPctByCust = {};
  Object.keys(customersRaw || {}).forEach(function(cid) {
    var cust = customersRaw[cid];
    if (!cust) return;
    var s = cust.stats || {};
    var r = typeof s.trailing12mRevenueCents === 'number' ? s.trailing12mRevenueCents : 0;
    var g = typeof s.trailing12mGrossMarginCents === 'number' ? s.trailing12mGrossMarginCents
      : (typeof s.trailing12mCogsCents === 'number' ? r - s.trailing12mCogsCents : 0);
    marginPctByCust[cid] = r > 0 ? g / r : null;
  });

  var months = labels.map(function(label, idx) {
    var map = revByCust[idx];
    var ranked = Object.keys(map).map(function(cid) { return { cid: cid, rev: map[cid] }; })
      .sort(function(a, b) { return b.rev - a.rev; });
    var total = ranked.reduce(function(s, r) { return s + r.rev; }, 0);
    var top5 = ranked.slice(0, 5).reduce(function(s, r) { return s + r.rev; }, 0);
    var top10 = ranked.slice(0, 10).reduce(function(s, r) { return s + r.rev; }, 0);
    var hhi = 0;
    if (total > 0) {
      ranked.forEach(function(r) { var sh = r.rev / total; hhi += sh * sh; });
      hhi = Math.round(hhi * 10000);
    }
    var netC = 0;
    ranked.forEach(function(row) {
      var mPct = marginPctByCust[row.cid];
      var gm = mPct != null ? Math.round(row.rev * mPct) : 0;
      var am = activeMonthsByCust[row.cid] || 1;
      var totalC2s = (ticketC[row.cid] || 0) * c2s.perTicketCents
        + (returnC[row.cid] || 0) * c2s.perReturnCents;
      var monthlyC2s = Math.round(totalC2s / am);
      netC += (gm - monthlyC2s);
    });
    return {
      monthLabel: label,
      monthlyRevenueCents: total,
      top5SharePct: total > 0 ? Math.round((top5 / total) * 1000) / 1000 : 0,
      top10SharePct: total > 0 ? Math.round((top10 / total) * 1000) / 1000 : 0,
      hhi: hhi,
      netContributionCents: netC,
      activeCustomerCount: ranked.length
    };
  });

  return { months: months, monthsWithRevenue: months.filter(function(m) { return m.monthlyRevenueCents > 0; }).length };
}

// Render an inline SVG sparkline. values are numbers; opts: {width, height, stroke, format, lo, hi}.
function portfolioRenderSparkSvg(values, opts) {
  var w = (opts && opts.width) || 200;
  var h = (opts && opts.height) || 40;
  var stroke = (opts && opts.stroke) || 'var(--teal)';
  if (!values || values.length < 2) {
    return '<svg width="' + w + '" height="' + h + '" role="img" aria-label="not enough data"></svg>';
  }
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  if (min === max) { min -= 1; max += 1; }
  var pad = 4;
  var ih = h - pad * 2;
  var iw = w - pad * 2;
  var step = values.length > 1 ? iw / (values.length - 1) : 0;
  var pts = values.map(function(v, i) {
    var x = pad + i * step;
    var y = pad + ih - ((v - min) / (max - min)) * ih;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  var lastX = pad + (values.length - 1) * step;
  var lastY = pad + ih - ((values[values.length - 1] - min) / (max - min)) * ih;
  var titleAttr = (opts && opts.title) ? '<title>' + opts.title + '</title>' : '';
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img">' +
    titleAttr +
    '<polyline fill="none" stroke="' + stroke + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(' ') + '"/>' +
    '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="2.5" fill="' + stroke + '"/>' +
    '</svg>';
}

function portfolioFmtPct(v) { return (v * 100).toFixed(1) + '%'; }

function portfolioRenderSparklines(trend) {
  var months = trend.months || [];
  if (trend.monthsWithRevenue < 3) {
    return '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--cream-dark);font-size:0.78rem;color:var(--warm-gray);">Need 3+ months of orders to show trend.</div>';
  }

  function buildCard(title, values, latest, prev, formatter, stroke) {
    var sv = portfolioRenderSparkSvg(values, {
      width: 200, height: 40, stroke: stroke,
      title: months.map(function(m, i) { return m.monthLabel + ': ' + formatter(values[i]); }).join(' | ')
    });
    var dir = '→', dirColor = 'var(--warm-gray)';
    if (prev != null && prev !== 0) {
      var delta = ((latest - prev) / Math.abs(prev)) * 100;
      if (delta > 1) { dir = '↑'; dirColor = '#7ddca0'; }
      else if (delta < -1) { dir = '↓'; dirColor = '#f49aa3'; }
      var deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(0) + '%';
      dir = dir + ' ' + deltaStr;
    }
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    return '<div style="min-width:200px;flex:1;">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">' +
        '<span>' + esc(title) + '</span>' +
        '<span style="color:' + dirColor + ';text-transform:none;letter-spacing:0;">' + esc(dir) + '</span>' +
      '</div>' +
      '<div style="font-size:0.9rem;font-weight:600;color:var(--charcoal);margin-bottom:2px;">' + esc(formatter(latest)) + '</div>' +
      sv +
      '<div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--warm-gray);margin-top:2px;">' +
        '<span>' + esc(formatter(min)) + '</span>' +
        '<span>' + esc(months[0].monthLabel) + ' → ' + esc(months[months.length - 1].monthLabel) + '</span>' +
        '<span>' + esc(formatter(max)) + '</span>' +
      '</div>' +
    '</div>';
  }

  var top5Vals = months.map(function(m) { return m.top5SharePct; });
  var hhiVals = months.map(function(m) { return m.hhi; });
  var netVals = months.map(function(m) { return m.netContributionCents; });
  var last = months.length - 1;
  var prevIdx = last - 1;

  var html = '';
  html += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--cream-dark);">';
  html += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">12-month trend</div>';
  html += '<div style="display:flex;gap:20px;flex-wrap:wrap;">';
  html += buildCard('Top-5 share', top5Vals, top5Vals[last], top5Vals[prevIdx], portfolioFmtPct, 'var(--teal)');
  html += buildCard('HHI', hhiVals, hhiVals[last], hhiVals[prevIdx], function(v) { return String(Math.round(v)); }, 'var(--warm-gray)');
  html += buildCard('Net contribution', netVals, netVals[last], netVals[prevIdx], portfolioFmtMoney, 'var(--charcoal)');
  html += '</div>';
  html += '</div>';
  return html;
}

function renderCustomerPortfolio() {
  var el = document.getElementById('customerPortfolioContent');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading portfolio…</div>';

  Promise.all([
    MastDB.query('admin/customers').once()
      .then(function(s) { return (s && s.val()) || {}; }).catch(function() { return {}; }),
    MastDB.query('cs_tickets').limitToLast(2000).once()
      .then(function(s) { return (s && s.val()) || {}; }).catch(function() { return {}; }),
    MastDB.query('admin/rma').limitToLast(2000).once()
      .then(function(s) { return (s && s.val()) || {}; }).catch(function() { return {}; }),
    MastDB.get('admin/config/customerSuccess/costToServeDefaults').catch(function() { return null; }),
    MastDB.query('orders').orderByChild('createdAt').limitToLast(5000).once()
      .then(function(s) { return (s && s.val()) || {}; }).catch(function() { return {}; })
  ]).then(function(results) {
    var customersRaw = results[0] || {};
    var ticketsRaw = results[1] || {};
    var rmaRaw = results[2] || {};
    var c2s = Object.assign({}, CTS_DEFAULTS, results[3] || {});
    var ordersRaw = results[4] || {};

    // Per-customer ticket / return counts
    var ticketCount = {}, returnCount = {};
    Object.values(ticketsRaw).forEach(function(t) {
      if (!t || !t.customerId) return;
      ticketCount[t.customerId] = (ticketCount[t.customerId] || 0) + 1;
    });
    Object.values(rmaRaw).forEach(function(r) {
      if (!r || !r.customerId) return;
      returnCount[r.customerId] = (returnCount[r.customerId] || 0) + 1;
    });

    var rows = [];
    Object.keys(customersRaw).forEach(function(cid) {
      var cust = customersRaw[cid];
      if (!cust || cust.status === 'merged') return;
      var stats = cust.stats || {};
      var rev = typeof stats.trailing12mRevenueCents === 'number' ? stats.trailing12mRevenueCents : 0;
      var cogs = typeof stats.trailing12mCogsCents === 'number' ? stats.trailing12mCogsCents : 0;
      var gm = typeof stats.trailing12mGrossMarginCents === 'number' ? stats.trailing12mGrossMarginCents : (rev - cogs);
      var netMarginPct = typeof stats.trailing12mNetMarginPct === 'number' ? stats.trailing12mNetMarginPct : (rev > 0 ? gm / rev : null);
      var tc = ticketCount[cid] || 0;
      var rc = returnCount[cid] || 0;
      var c2sCents = tc * c2s.perTicketCents + rc * c2s.perReturnCents;
      var net = gm - c2sCents;
      var q = portfolioClassify(netMarginPct, stats.lapseStatus || null);
      rows.push({
        customerId: cid,
        displayName: cust.displayName || cust.primaryEmail || cid,
        primaryEmail: cust.primaryEmail || null,
        revenueCents: rev,
        cogsCents: cogs,
        grossMarginCents: gm,
        netMarginPct: netMarginPct,
        ticketCount: tc,
        returnCount: rc,
        costToServeCents: c2sCents,
        netContributionCents: net,
        lapseStatus: stats.lapseStatus || null,
        quadrant: q,
        tags: Array.isArray(cust.tags) ? cust.tags : []
      });
    });

    // Concentration: top-N share + HHI on revenue
    var ranked = rows.filter(function(r) { return r.revenueCents > 0; })
      .map(function(r) { return { customerId: r.customerId, displayName: r.displayName, revenue: r.revenueCents }; })
      .sort(function(a, b) { return b.revenue - a.revenue; });
    var totalRev = ranked.reduce(function(s, r) { return s + r.revenue; }, 0);
    var topShare = function(n) {
      var top = ranked.slice(0, n);
      var rev = top.reduce(function(s, r) { return s + r.revenue; }, 0);
      return { n: top.length, revenueCents: rev, sharePct: totalRev > 0 ? Math.round((rev / totalRev) * 1000) / 1000 : 0 };
    };
    var top5 = topShare(5), top10 = topShare(10);
    var hhi = 0;
    if (totalRev > 0) {
      ranked.forEach(function(r) { var s = r.revenue / totalRev; hhi += s * s; });
      hhi = Math.round(hhi * 10000);
    }
    var hhiBand = hhi < 1500 ? 'unconcentrated' : (hhi < 2500 ? 'moderate' : 'high');
    var hhiBandColor = hhi < 1500 ? '#7ddca0' : (hhi < 2500 ? '#fbcc70' : '#f49aa3');

    // Quadrant counts
    var qCounts = { grow: 0, maintain: 0, reprice: 0, deprioritize: 0, unclassified: 0 };
    rows.forEach(function(r) { qCounts[r.quadrant]++; });

    portfolioState.rows = rows;
    portfolioState.thresholds = c2s;
    portfolioState.concentration = { top5: top5, top10: top10, hhi: hhi, hhiBand: hhiBand, totalRevenueCents: totalRev };

    // Render
    var html = '';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px;">';
    html += '<h2 style="font-size:1.6rem;font-weight:700;color:var(--charcoal);margin:0;">Customer Portfolio</h2>';
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);">' +
      esc(String(rows.length)) + ' customers · trailing-12m · cost-to-serve $' + (c2s.perTicketCents/100).toFixed(0) +
      '/ticket, $' + (c2s.perReturnCents/100).toFixed(0) + '/return</div>';
    html += '</div>';

    // Concentration card
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;margin-bottom:16px;">';
    html += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:10px;">Concentration risk</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;">';
    html += '<div><div style="font-size:0.78rem;color:var(--warm-gray);">Top 5 share</div>' +
      '<div style="font-size:1.6rem;font-weight:600;color:' + (top5.sharePct > 0.4 ? '#f49aa3' : 'var(--charcoal)') + ';">' +
      (top5.sharePct * 100).toFixed(1) + '%</div></div>';
    html += '<div><div style="font-size:0.78rem;color:var(--warm-gray);">Top 10 share</div>' +
      '<div style="font-size:1.6rem;font-weight:600;">' + (top10.sharePct * 100).toFixed(1) + '%</div></div>';
    html += '<div><div style="font-size:0.78rem;color:var(--warm-gray);">HHI</div>' +
      '<div style="font-size:1.6rem;font-weight:600;color:' + hhiBandColor + ';">' + esc(String(hhi)) +
      ' <span style="font-size:0.78rem;font-weight:400;color:var(--warm-gray);">' + esc(hhiBand) + '</span></div></div>';
    html += '<div><div style="font-size:0.78rem;color:var(--warm-gray);">Total revenue (12m)</div>' +
      '<div style="font-size:1.6rem;font-weight:600;">' + esc(portfolioFmtMoney(totalRev)) + '</div></div>';
    html += '</div>';
    if (top5.sharePct > 0.4) {
      html += '<div style="font-size:0.78rem;color:#f49aa3;margin-top:10px;">⚠ Top-5 customers exceed 40% of revenue. Concentration risk.</div>';
    }

    // Sam G — 12-month portfolio trend sparklines (top-5 share / HHI / net contribution).
    // Computed client-side from orders + customers + tickets + rma already loaded above.
    var trend = portfolioComputeTrend(ordersRaw, customersRaw, ticketsRaw, rmaRaw, c2s, 12);
    html += portfolioRenderSparklines(trend);

    html += '</div>';

    // Quadrant chips
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">';
    [{q:null,label:'All'},{q:'grow'},{q:'maintain'},{q:'reprice'},{q:'deprioritize'},{q:'unclassified'}].forEach(function(opt) {
      var qq = opt.q;
      var lbl = opt.label || portfolioQuadrantStyle(qq).label;
      var n = qq === null ? rows.length : qCounts[qq];
      var active = (portfolioState.quadrantFilter === qq);
      html += '<button class="view-tab' + (active ? ' active' : '') +
        '" onclick="portfolioSetQuadrant(' + (qq === null ? 'null' : '\'' + qq + '\'') + ')"' +
        ' style="font-size:0.78rem;padding:6px 12px;">' + esc(lbl) +
        ' <span style="opacity:0.6;">(' + n + ')</span></button>';
    });
    html += '</div>';

    // Sort + bulk action toolbar
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px;">';
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);">Sort by ';
    ['netContribution','grossMargin','revenue'].forEach(function(s) {
      var sLabel = s === 'netContribution' ? 'Net contribution' : (s === 'grossMargin' ? 'Gross margin' : 'Revenue');
      var active = portfolioState.sortBy === s;
      html += '<a href="#" onclick="event.preventDefault();portfolioSetSort(\'' + s + '\')" ' +
        'style="margin-left:6px;color:' + (active ? 'var(--teal)' : 'var(--warm-gray)') + ';' +
        (active ? 'font-weight:600;' : '') + 'text-decoration:' + (active ? 'underline' : 'none') + ';">' +
        esc(sLabel) + '</a>';
    });
    html += '</div>';
    html += '<div id="pfBulkBar" style="font-size:0.78rem;color:var(--warm-gray);"></div>';
    html += '</div>';

    // Table
    var displayRows = rows.slice();
    if (portfolioState.quadrantFilter) {
      displayRows = displayRows.filter(function(r) { return r.quadrant === portfolioState.quadrantFilter; });
    }
    if (portfolioState.sortBy === 'grossMargin') {
      displayRows.sort(function(a, b) { return b.grossMarginCents - a.grossMarginCents; });
    } else if (portfolioState.sortBy === 'revenue') {
      displayRows.sort(function(a, b) { return b.revenueCents - a.revenueCents; });
    } else {
      displayRows.sort(function(a, b) { return b.netContributionCents - a.netContributionCents; });
    }
    displayRows = displayRows.slice(0, 200);

    html += '<div class="data-table"><table>';
    html += '<thead><tr>' +
      '<th style="width:30px;"><input type="checkbox" id="pfSelectAll" onchange="portfolioToggleSelectAll(this.checked)"></th>' +
      '<th>Customer</th>' +
      '<th>Quadrant</th>' +
      '<th style="text-align:right;">Revenue 12m</th>' +
      '<th style="text-align:right;">GM</th>' +
      '<th style="text-align:right;">Margin %</th>' +
      '<th style="text-align:right;">Cost to serve</th>' +
      '<th style="text-align:right;">Net contribution</th>' +
      '<th>Lapse</th>' +
      '</tr></thead><tbody>';
    displayRows.forEach(function(r) {
      var qStyle = portfolioQuadrantStyle(r.quadrant);
      var lapseLabel = r.lapseStatus || '—';
      var lapseColor = r.lapseStatus === 'lapsed' ? '#f49aa3' :
                      r.lapseStatus === 'at-risk' ? '#fbcc70' :
                      r.lapseStatus === 'active' ? '#7ddca0' : 'var(--warm-gray-light)';
      var marginPctStr = typeof r.netMarginPct === 'number' ? (r.netMarginPct * 100).toFixed(1) + '%' : '—';
      html += '<tr data-customer-id="' + esc(r.customerId) + '">' +
        '<td><input type="checkbox" class="pf-row-check" data-customer-id="' + esc(r.customerId) + '" onchange="portfolioUpdateBulkBar()" onclick="event.stopPropagation();"></td>' +
        '<td style="cursor:pointer;" onclick="portfolioOpenCustomer(this.parentNode.dataset.customerId)">' + esc(r.displayName) + '</td>' +
        '<td><span class="status-badge" style="background:' + qStyle.bg + ';color:' + qStyle.color + ';">' + esc(qStyle.label) + '</span></td>' +
        '<td style="text-align:right;">' + esc(portfolioFmtMoney(r.revenueCents)) + '</td>' +
        '<td style="text-align:right;">' + esc(portfolioFmtMoney(r.grossMarginCents)) + '</td>' +
        '<td style="text-align:right;">' + esc(marginPctStr) + '</td>' +
        '<td style="text-align:right;color:var(--warm-gray);">' + esc(portfolioFmtMoney(r.costToServeCents)) + '</td>' +
        '<td style="text-align:right;font-weight:600;color:' + (r.netContributionCents < 0 ? '#f49aa3' : 'var(--charcoal)') + ';">' +
          esc(portfolioFmtMoney(r.netContributionCents)) + '</td>' +
        '<td style="font-size:0.78rem;color:' + lapseColor + ';">' + esc(lapseLabel) + '</td>' +
        '</tr>';
    });
    if (displayRows.length === 0) {
      html += '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--warm-gray);">No customers in this quadrant.</td></tr>';
    }
    html += '</tbody></table></div>';

    el.innerHTML = html;
    portfolioUpdateBulkBar();
  }).catch(function(err) {
    el.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading portfolio: ' + esc(err && err.message || String(err)) + '</div>';
  });
}

function portfolioSetSort(s) {
  portfolioState.sortBy = s;
  renderCustomerPortfolio();
}

function portfolioSetQuadrant(q) {
  portfolioState.quadrantFilter = q;
  renderCustomerPortfolio();
}

function portfolioOpenCustomer(cid) {
  if (!cid) return;
  if (window.MastNavStack && MastNavStack.push) {
    MastNavStack.push({
      route: 'customer-portfolio',
      view: 'list',
      state: { sortBy: portfolioState.sortBy, quadrantFilter: portfolioState.quadrantFilter, scrollTop: window.scrollY || 0 },
      label: 'Customer Portfolio'
    });
  }
  if (typeof navigateTo === 'function') navigateTo('customers');
  if (typeof window.customersOpenDetail === 'function') {
    setTimeout(function() { window.customersOpenDetail(cid); }, 50);
  }
}

function portfolioToggleSelectAll(checked) {
  document.querySelectorAll('.pf-row-check').forEach(function(cb) { cb.checked = checked; });
  portfolioUpdateBulkBar();
}

function portfolioUpdateBulkBar() {
  var bar = document.getElementById('pfBulkBar');
  if (!bar) return;
  var checked = Array.from(document.querySelectorAll('.pf-row-check:checked'));
  if (checked.length === 0) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = esc(String(checked.length)) + ' selected · ' +
    '<a href="#" onclick="event.preventDefault();portfolioBulkTag(\'white-glove\')" style="color:var(--teal);text-decoration:underline;">Tag: white-glove</a> · ' +
    '<a href="#" onclick="event.preventDefault();portfolioBulkTag(\'renegotiate\')" style="color:var(--teal);text-decoration:underline;">renegotiate</a> · ' +
    '<a href="#" onclick="event.preventDefault();portfolioBulkTag(\'deprioritize\')" style="color:var(--teal);text-decoration:underline;">deprioritize</a>';
}

async function portfolioBulkTag(tag) {
  var checked = Array.from(document.querySelectorAll('.pf-row-check:checked'));
  if (checked.length === 0) return;
  var ids = checked.map(function(cb) { return cb.dataset.customerId; });
  var confirmed = await (typeof mastConfirm === 'function'
    ? mastConfirm('Apply tag "' + tag + '" to ' + ids.length + ' customer' + (ids.length === 1 ? '' : 's') + '?', { title: 'Bulk tag' })
    : Promise.resolve(window.confirm('Apply tag "' + tag + '" to ' + ids.length + ' customers?')));
  if (!confirmed) return;
  var now = new Date().toISOString();
  var errCount = 0;
  for (var i = 0; i < ids.length; i++) {
    try {
      var cust = portfolioState.rows.find(function(r) { return r.customerId === ids[i]; });
      var existingTags = (cust && cust.tags) || [];
      if (existingTags.indexOf(tag) === -1) {
        var newTags = existingTags.concat([tag]);
        await MastDB.update('admin/customers/' + ids[i], { tags: newTags, updatedAt: now });
      }
    } catch (e) { errCount++; }
  }
  if (typeof showToast === 'function') {
    showToast('Tagged ' + (ids.length - errCount) + (errCount > 0 ? ' (' + errCount + ' errored)' : '') + ' customer(s) as "' + tag + '".');
  }
  renderCustomerPortfolio();
}

window.renderCustomerPortfolio = renderCustomerPortfolio;
window.portfolioSetSort = portfolioSetSort;
window.portfolioSetQuadrant = portfolioSetQuadrant;
window.portfolioOpenCustomer = portfolioOpenCustomer;
window.portfolioToggleSelectAll = portfolioToggleSelectAll;
window.portfolioUpdateBulkBar = portfolioUpdateBulkBar;
window.portfolioBulkTag = portfolioBulkTag;

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
    'finance-revenue':    { tab: 'financeRevenueTab',    setup: function() { setupRevenueTab(); } },
    'finance-expenses':   { tab: 'financeExpensesTab',   setup: function() { setupExpensesTab(); } },
    'finance-pl':         { tab: 'financePlTab',         setup: function() { setupPlTab(); } },
    'finance-cash-flow':  { tab: 'financeCashFlowTab',   setup: function() { setupCashFlowTab(); } },
    'finance-ar':         { tab: 'financeArTab',         setup: function() { setupArTab(); } },
    'finance-ap':         { tab: 'financeApTab',         setup: function() { setupApTab(); } },
    'finance-tax':        { tab: 'financeTaxTab',        setup: function() { setupTaxTab(); } },
    'finance-reports':    { tab: 'financeReportsTab',    setup: function() { setupReportsTab(); } },
    'customer-portfolio': { tab: 'customerPortfolioTab', setup: function() { renderCustomerPortfolio(); } }
  }
});

})();
