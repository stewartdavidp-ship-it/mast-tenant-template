// ============================================================
// FINANCE MODULE (lazy-loaded)
// Session 4: Revenue, Expenses, P&L, Cash Flow, AR, AP tabs.
// Tax and Reports tabs remain stubs (Session 5).
// Old financials / expenses routes stay alive until Session 5.
// ============================================================
(function() {
'use strict';

// ── Canonical channel normalization (shared, parity-locked) ───────────────────
// All revenue grouping + display goes through window.MastChannels
// (shared/channel-normalization.core.js, byte-identical to the MCP finance
// aggregators) so a record's free-form `source` string collapses onto ONE
// canonical channel key. Without it a single channel fragments across keys
// (pos + direct-pos, online + "Online Store") and per-channel reporting is
// unreliable even though the grand total is correct. Applied at READ time so it
// also repairs historical mixed-source data. Degrades to the raw source if the
// engine somehow isn't loaded yet.
function _chan(source) {
  var C = (typeof window !== 'undefined' && window.MastChannels) || null;
  return C ? C.normalize(source) : (source || 'other');
}
function _chanLabel(key) {
  var C = (typeof window !== 'undefined' && window.MastChannels) || null;
  return C ? C.label(key) : String(key == null ? '' : key);
}
function _chanColor(key, fallback) {
  var C = (typeof window !== 'undefined' && window.MastChannels) || null;
  return (C && C.color(key)) || fallback || '#888';
}

// ── Module-private state ──────────────────────────────────────────────────────

var _arData = null;
var _apData = null;
var _arFilter = 'all';
var _arSortKey = 'daysOver';
var _arSortDir = 'desc';
var _apFilter = 'all';
var _apSortKey = 'daysOver';
var _apSortDir = 'desc';
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
// W1.10 (-OtMNJdpUIMpbJcKQAY0): per-order AR reminder state. Values:
// 'sending' (in-flight write to emailQueue), 'sent' (queued successfully).
// Cleared on AR data reload.
var _arReminderState = {};
// W2 R2-F2: per-customer Send Statement state. Keyed by customerId since the
// statement is per-customer (not per-invoice). Values: 'sending' | 'sent'.
var _arStatementState = {};

// W2.8 (-OtMNKv4uK0PWXTcTfZY): cross-view period selector. Lives on
// window._finPeriod so every finance view (Revenue, Expenses, P&L, Cash Flow,
// AR, AP, Tax, Portfolio, Reports, Overview) reads from the same source of
// truth. `mode` drives the period bar's segmented control; start/end are
// resolved ISO dates (YYYY-MM-DD). Custom mode keeps whatever start/end the
// user typed; segmented modes recompute on click. Initial default: MTD.
window._finPeriod = window._finPeriod || { mode: 'mtd', start: null, end: null };

// ── Shared order-money normalization ──────────────────────────────────────────
// Mast orders arrive from two writers with different monetary conventions:
//   - MCP / newer storefront orders write the canonical `totalCents` (integer
//     CENTS). Some also carry a `total` that ALREADY holds cents (e.g. SGTE-0187
//     /0188: total:102000 AND totalCents:102000, both = $1,020.00).
//   - Legacy storefront orders stored `total` in DOLLARS and omitted `totalCents`
//     (e.g. SGTE-0079: total:119.53, no totalCents).
// Rule (mirrors mast-tenant-mcp-server src/shared/tools/order-money.ts
// orderRevenueCents — the SAME normalizer the channel P&L / compare_channels
// reader uses): prefer `totalCents` when present; otherwise `total` is dollars →
// ×100. Reading `total` as dollars unconditionally inflated MTD Revenue 100×
// for orders whose `total` already held cents (sgtest15 read $280,957.50 against
// a true gross of ~$10,522). Returns integer cents.
function _orderRevenueCents(o) {
  if (!o) return 0;
  if (typeof o.totalCents === 'number') return o.totalCents;
  if (typeof o.total === 'number') return Math.round(o.total * 100);
  return 0;
}

function _finResolvePeriod(p) {
  if (!p) p = window._finPeriod || { mode: 'mtd' };
  var s, e2;
  if (p.mode === 'qtd') { s = quarterStart(); e2 = todayStr(); }
  else if (p.mode === 'fy') { s = ytdStart(); e2 = todayStr(); }
  else if (p.mode === 'custom') { s = p.start || monthStart(); e2 = p.end || monthEnd(); }
  else { s = monthStart(); e2 = monthEnd(); p.mode = 'mtd'; }
  return { mode: p.mode, start: s, end: e2 };
}
function _finPeriodLabel(p) {
  var r = _finResolvePeriod(p);
  if (r.mode === 'mtd') return 'MTD (' + r.start + ' to ' + r.end + ')';
  if (r.mode === 'qtd') return 'QTD (' + r.start + ' to ' + r.end + ')';
  if (r.mode === 'fy')  return 'FYTD (' + r.start + ' to ' + r.end + ')';
  return r.start + ' to ' + r.end;
}
// Per-view ID-prefix hook: when a view's local periodPicker syncs to global,
// the picker re-fills these inputs from _finPeriod on render. Two-way sync:
// finPeriod(pfx, range) (existing) updates inputs only; global bar handlers
// (finGlobalPeriod / finGlobalCustom) update _finPeriod and trigger reload
// via _finReloadCurrent(). Each setup* fn calls _finSyncLocalPicker(pfx) so
// the local picker reflects whatever the global picker last set.
function _finSyncLocalPicker(pfx) {
  var r = _finResolvePeriod();
  var sEl = document.getElementById(pfx + 'S');
  var eEl = document.getElementById(pfx + 'E');
  if (sEl) sEl.value = r.start;
  if (eEl) eEl.value = r.end;
}

// W2.8: Period bar shown at the top of every finance view. Segmented control
// drives _finPeriod; Custom mode reveals two date inputs. The Active route's
// loader fn is re-invoked when the period changes (looked up by hash).
function renderFinancePeriodBar() {
  var p = _finResolvePeriod();
  var btn = function(mode, label) {
    var active = p.mode === mode;
    return '<button type="button" class="btn btn-' + (active ? 'primary' : 'secondary') +
      ' btn-small" onclick="finGlobalPeriod(\'' + mode + '\')">' + label + '</button>';
  };
  var h = '<div id="finPeriodBar" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 14px;background:var(--bg-secondary,#232323);border-radius:8px;margin-bottom:14px;border:1px solid rgba(255,255,255,0.06);">';
  h += '<span style="font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-right:4px;">Period</span>';
  h += btn('mtd', 'MTD');
  h += btn('qtd', 'QTD');
  h += btn('fy', 'FYTD');
  h += btn('custom', 'Custom');
  if (p.mode === 'custom') {
    h += '<input type="date" id="finGlobalStart" value="' + e(p.start) + '" onchange="finGlobalCustom()" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:4px 8px;font-size:0.85rem;">';
    h += '<span style="color:var(--warm-gray,#888);font-size:0.85rem;">to</span>';
    h += '<input type="date" id="finGlobalEnd" value="' + e(p.end) + '" onchange="finGlobalCustom()" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:4px 8px;font-size:0.85rem;">';
  }
  h += '<span style="margin-left:auto;font-size:0.72rem;color:var(--warm-gray,#888);">' + e(_finPeriodLabel(p)) + '</span>';
  h += '</div>';
  return h;
}

// Reload the currently visible finance view after _finPeriod changes. Each
// setup* fn re-fetches via its loader, so we just re-invoke setup based on
// the current route hash.
window._finReloadCurrent = function() {
  var route = (location.hash || '').replace(/^#/, '').split('?')[0];
  var map = {
    'finance-revenue':    function() { if (typeof setupRevenueTab === 'function') setupRevenueTab(); },
    'finance-expenses':   function() { if (typeof setupExpensesTab === 'function') setupExpensesTab(); },
    'finance-pl':         function() { if (typeof setupPlTab === 'function') setupPlTab(); },
    'finance-cash-flow':  function() { if (typeof setupCashFlowTab === 'function') setupCashFlowTab(); },
    'finance-ar':         function() { if (typeof setupArTab === 'function') setupArTab(); },
    'finance-ap':         function() { if (typeof setupApTab === 'function') setupApTab(); },
    'finance-tax':        function() { if (typeof setupTaxTab === 'function') setupTaxTab(); },
    'finance-reports':    function() { if (typeof setupReportsTab === 'function') setupReportsTab(); },
    'customer-portfolio': function() { if (typeof renderCustomerPortfolio === 'function') renderCustomerPortfolio(); },
    'financials':         function() { if (typeof renderFinanceOverview === 'function') renderFinanceOverview(); }
  };
  var fn = map[route];
  if (typeof fn === 'function') fn();
};

window.finGlobalPeriod = function(mode) {
  var allowed = { mtd:1, qtd:1, fy:1, custom:1 };
  if (!allowed[mode]) return;
  window._finPeriod = window._finPeriod || {};
  window._finPeriod.mode = mode;
  if (mode !== 'custom') {
    // Reset start/end so resolver recomputes fresh.
    window._finPeriod.start = null;
    window._finPeriod.end = null;
  } else {
    // Seed custom with current resolution so the inputs aren't blank.
    var cur = _finResolvePeriod({ mode: 'mtd' });
    window._finPeriod.start = window._finPeriod.start || cur.start;
    window._finPeriod.end = window._finPeriod.end || cur.end;
  }
  window._finReloadCurrent();
};

window.finGlobalCustom = function() {
  var sEl = document.getElementById('finGlobalStart');
  var eEl = document.getElementById('finGlobalEnd');
  if (!sEl || !eEl) return;
  var s = sEl.value, en = eEl.value;
  if (!s || !en) return;
  if (en < s) { showToast('End date must be on or after start date', true); return; }
  window._finPeriod = { mode: 'custom', start: s, end: en };
  window._finReloadCurrent();
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTestSource(src) {
  var s = String(src || '').toLowerCase();
  return s === 'test' || s.indexOf('test-') === 0 || s.indexOf('test_') === 0 || s === 'synthetic';
}

function isTestOrder(o) {
  return isTestSource(o && o.source) || (o && (o.synthetic === true || o.isTest === true));
}

// Canonical admin/sales money read: `amount` is INTEGER CENTS — the POS
// checkout writer and the Sales Ledger reader (sales.js formatCents(s.amount))
// both treat it as cents, and live data agrees ($85 pendant ⇒ amount 8500).
// The old `(s.amount || 0) * 100` reads here inflated POS rows 100× on the
// Revenue and P&L surfaces; every sales read now goes through this helper.
function _salesCents(s) { return Math.round(Number(s && s.amount) || 0); }

// Canonical "does this admin/sales row count toward revenue?" rule — single-
// sourced so the readers can't drift. A POS-square checkout creates a REAL
// `orders` row (channel 'pos', paid) AND an admin/sales MIRROR stamped with
// that order's id (pos/index.html _writeSaleToServer: `saleRecord.orderId =
// orderResult.orderId`). The `orders` row is the canonical money record, so the
// mirror MUST NOT be summed again — counting both double-counts the sale at
// full amount across Revenue / P&L / monthly-breakdown / dashboard. Fair-mode /
// offline sales (recordManualSale, legacy saveManualSale) write admin/sales with
// NO orderId — there is no orders row, so admin/sales is the SOLE money record
// and they MUST still count. Rule: count iff not voided AND no linked orderId.
function _salesRowCounts(s) { return s && s.status !== 'voided' && !s.orderId; }

// W1.5 carry-forward — COMPLETE 2026-05-22: isTestOrder()/isTestSource()
// thread through Revenue + computePnlLocal + loadArData + loadCashFlow's AR
// rollup so test-channel orders are honored across every customer-money view.
// AP (purchaseReceipts → vendor invoices) has no test-channel concept and is
// intentionally unfiltered. Test-exclusion chip rendered consistently across
// Revenue, P&L, and AR aging tabs.

function e(s) { return typeof window.esc === 'function' ? window.esc(s) : String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// Module-level JS-attribute escape — for inline onclick args. Falls back to a
// quoted, backslash-escaped string when window._jsAttr isn't loaded yet.
// Returns a JS literal expression (already includes its own quotes).
function _jsAttrSafe(s) {
  if (typeof window._jsAttr === 'function') return window._jsAttr(s);
  return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\x3c') + '"';
}
// Firebase-key charset validator (lowercase a-z, A-Z, 0-9, hyphen, underscore).
// Used to guard URL-param-supplied IDs that flow into Firebase paths or DOM.
function _isSafeFbKey(s) { return typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) && s.length <= 64; }

// Close v3 fix-up: async UID → displayName/email resolver with in-memory cache.
// Renders that show "operator" fields (Day Close header, version history,
// Period Close drill-down, Amendments queue) snapshot a `*ByName` field at
// write time — but older rows + retry paths may only have the raw UID. Resolve
// lazily and patch the DOM via data-uid markers; idempotent (cache).
var _finUidCache = {};   // uid → resolved label (or null while in-flight)
var _finUidInflight = {};
function _finUidPlaceholder(uid) {
  if (!uid || typeof uid !== 'string') return 'unknown';
  if (_finUidCache[uid]) return _finUidCache[uid];
  return uid;   // initial render shows uid; resolver patches DOM
}
async function _finResolveUid(uid) {
  if (!uid || typeof uid !== 'string') return 'unknown';
  if (_finUidCache[uid]) return _finUidCache[uid];
  if (_finUidInflight[uid]) return _finUidInflight[uid];
  _finUidInflight[uid] = (async function() {
    try {
      var u = await MastDB.adminUsers.get(uid);
      var label = (u && (u.displayName || u.email)) || uid;
      _finUidCache[uid] = label;
      return label;
    } catch (x) { if (typeof window !== 'undefined' && window.MastError) window.MastError.capture(x, { where: 'finance._finResolveUid' }); _finUidCache[uid] = uid; return uid; }
    finally { delete _finUidInflight[uid]; }
  })();
  return _finUidInflight[uid];
}
// Scan a container and replace any element with data-uid-label="<uid>" by the
// resolved label. Idempotent — safe to re-run after re-render.
function _finPatchUidLabels(root) {
  try {
    var rootEl = root || document;
    var nodes = rootEl.querySelectorAll('[data-uid-label]');
    nodes.forEach(function(n) {
      var uid = n.getAttribute('data-uid-label');
      if (!uid) return;
      if (_finUidCache[uid]) {
        n.textContent = _finUidCache[uid];
        n.removeAttribute('data-uid-label');
        return;
      }
      _finResolveUid(uid).then(function(label) {
        if (n && n.isConnected) {
          n.textContent = label;
          n.removeAttribute('data-uid-label');
        }
      });
    });
  } catch (x) { if (typeof window !== 'undefined' && window.MastError) window.MastError.capture(x, { where: 'finance._finPatchUidLabels' }); }
}
// Renders a span that initially shows `name || uid`, and (if the value looks
// like a raw UID — 20+ chars no spaces) schedules a resolver patch.
function _finRenderUserCell(uidOrName, snapshotName) {
  var label = snapshotName || uidOrName || 'unknown';
  // Heuristic: Firebase UIDs are 20-28 chars, no spaces, no @. If snapshotName
  // is present we trust it. Otherwise if the bare value looks like a UID, mark
  // for async resolution.
  var looksLikeUid = !snapshotName && typeof uidOrName === 'string' &&
                     uidOrName.length >= 20 && !/\s|@/.test(uidOrName);
  if (looksLikeUid) {
    var cached = _finUidCache[uidOrName];
    if (cached) return '<span>' + e(cached) + '</span>';
    return '<span data-uid-label="' + e(uidOrName) + '">' + e(uidOrName) + '</span>';
  }
  return '<span>' + e(label) + '</span>';
}

// Money display for integer-cents amounts. Delegates the cents→dollars math and
// grouped/2-decimal formatting to the canonical window.MastFormat core (Track 5)
// while preserving this module's exact output contract: '$0.00' for null/NaN and
// a leading '-' BEFORE the '$' for negatives (e.g. -$1,020.00, not $-1,020.00).
function fmt$(cents) {
  if (cents == null || isNaN(cents)) return '$0.00';
  return (cents < 0 ? '-' : '') + MastFormat.money(Math.abs(cents), { cents: true });
}

// Timestamp-safe date+time display. Routes through MastFormat.coerceDate so a
// Firestore Timestamp (raw {seconds,nanoseconds} or a .toDate() instance) renders
// instead of "Invalid Date"; preserves the locale date+time format (toLocaleString).
function fmtDateTime(v) {
  var c = MastFormat.coerceDate(v);
  if (c == null) return '';
  var d = (c instanceof Date) ? c : new Date(c);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function pct(num, denom) {
  if (!denom) return '—';
  return (num / denom * 100).toFixed(1) + '%';
}

// Calendar-date display (date-only invoice/sync dates). Routes through
// MastFormat.date so a bare 'YYYY-MM-DD' renders as LOCAL midnight (no behind-UTC
// off-by-one) and a Firestore Timestamp renders instead of "Invalid Date".
function toDate(iso) {
  if (!iso) return '—';
  return MastFormat.date(iso);
}

function toDateShort(iso) {
  if (!iso) return '—';
  // MastFormat.dateShort builds LOCAL midnight for a bare 'YYYY-MM-DD', so date-only
  // period bounds don't render a day early in behind-UTC timezones (the off-by-one).
  return MastFormat.dateShort(iso) || '—';
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
  // Sales W1.9 sentinel: 'direct_retail' is an EXPLICIT non-wholesale marker.
  // Treat it as a hard "false" before any fallback — otherwise the truthy
  // string would mis-classify all retail orders as wholesale (W1 R2-F2).
  if (o.wholesaleAccountId === 'direct_retail') return false;
  if (o.wholesaleAccountId) return true;
  // Fallback chain when FK absent (existing orders pre-backfill on sgtest15):
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
  // W2.8: when caller passes a non-empty periodLabel it wins (per-view date
  // range or as-of overrides the global selector — same precedence rule the
  // view already enforces on its data fetch). Empty → read from _finPeriod.
  var pl = periodLabel;
  if (!pl) {
    try { pl = _finPeriodLabel(window._finPeriod); } catch (x) { pl = '—'; }
  }
  var periodLine = 'Period: ' + (pl || '—') + ' · Basis: ' + (basisLabel || '—');
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
  // W2.8: global period selector drives both the per-view picker (kept for
  // back-compat + custom one-off date typing) and the data fetch.
  var gp = _finResolvePeriod();
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    renderFinancePeriodBar() +
    '<h2 style="margin:0 0 16px 0;font-size:1.15rem;font-weight:700;">Revenue</h2>' +
    periodPicker('fRev', gp.start, gp.end) +
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
    var cents = _orderRevenueCents(o);
    if (cents <= 0) return;
    if (isTestOrder(o) && !_includeTestData) return;
    var ch = _chan(o.source || 'direct');
    byChannel[ch] = (byChannel[ch] || 0) + cents;
    totalCents += cents;
    txnCount += 1;
  });
  sales.forEach(function(s) {
    if (!_salesRowCounts(s)) return; // skip voided + POS-square mirrors (orderId set → counted via its orders row)
    var cents = _salesCents(s);
    if (cents <= 0) return;
    if (isTestOrder(s) && !_includeTestData) return;
    var ch = _chan(s.source || 'pos');
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
      var cents = _orderRevenueCents(o);
      if (cents <= 0) return;
      var ch = _chan(o.source || 'direct');
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
      if (!_salesRowCounts(s)) return; // skip voided + POS-square mirrors (orderId set → counted via its orders row)
      var cents = _salesCents(s);
      if (cents <= 0) return;
      var ch = _chan(s.source || 'pos');
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
      : 'Excluding test data (' + MastFormat.countNoun(testTxnCount, 'txn') + ', ' + fmt$(testTotalCents) + ')';
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
      ' (' + fmt$(prior.totalCents) + ' &middot; ' + MastFormat.countNoun(prior.txnCount, 'txn') + ')' +
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
    if (prior) topChSub += _sanityWrap(_renderRevenueDelta(byChannel[topCh], (prior.byChannel || {})[topCh] || 0), byChannel[topCh], (prior.byChannel || {})[topCh] || 0);
    h += statCard('Top Channel', e(_chanLabel(topCh)), _chanColor(topCh, channelColors[topCh]), topChSub);
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
      var color = _chanColor(ch, channelColors[ch]);
      h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:10px 14px;min-width:130px;border-left:3px solid ' + color + ';">';
      h += '<div style="font-size:0.85rem;font-weight:600;text-transform:capitalize;">' + e(_chanLabel(ch)) + '</div>';
      h += '<div style="font-size:1.15rem;font-weight:700;">' + fmt$(byChannel[ch]) + '</div>';
      h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);">' + Math.round(byChannel[ch]/totalCents*100) + '% of total</div>';
      // W2.6: per-channel Δ vs prior. Prior channels that disappeared still
      // surface here as a — chip via _renderRevenueDelta(0, priorCents).
      if (prior) h += _sanityWrap(_renderRevenueDelta(byChannel[ch], (prior.byChannel || {})[ch] || 0), byChannel[ch], (prior.byChannel || {})[ch] || 0);
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
      var color = _chanColor(t.channel, channelColors[t.channel]);
      h += '<div style="background:var(--bg-secondary,#232323);border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px;">';
      h += '<div style="flex:1;min-width:0;">';
      h += '<div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + e(t.desc) + '</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-top:2px;">';
      h += toDateShort(t.date);
      h += ' · <span style="background:' + color + ';color:#fff;padding:1px 5px;border-radius:3px;font-size:0.72rem;text-transform:capitalize;">' + e(_chanLabel(t.channel)) + '</span>';
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
      rows.push([t.date || '', _chanLabel(t.channel), t.ref || '', t.desc || '', (t.cents / 100).toFixed(2), t.type || '']);
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
  // W2.8: when no URL date filter is present, prefer the global _finPeriod
  // so a top-bar MTD/QTD/FYTD pick propagates here too. URL filters still
  // win because MCP admin deep links carry intent for a one-off date window.
  if (!hasUrlDate) {
    var gp = _finResolvePeriod();
    initStart = gp.start;
    initEnd = gp.end;
  }
  // W2 R2-F3: legacy date-range picker removed — the global period selector
  // (W2.8 renderFinancePeriodBar above) is the single period control here.
  // Hidden inputs keep loadFinExpenses() — which reads #fExpS / #fExpE — wired
  // without re-rendering a duplicate UI control. URL-driven date filters from
  // MCP admin links still win (handled above via initStart/initEnd).
  // ("Last Month" quick-pick filed as W3 OPEN; QTD/Custom covers most use.)
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    renderFinancePeriodBar() +
    '<h2 style="margin:0 0 16px 0;font-size:1.15rem;font-weight:700;">Expenses</h2>' +
    '<div id="fExpBanks" style="margin-bottom:16px;">' + skeletonCards(2) + '</div>' +
    '<input type="hidden" id="fExpS" value="' + e(initStart) + '">' +
    '<input type="hidden" id="fExpE" value="' + e(initEnd) + '">' +
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
      h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:8px;">' + MastFormat.countNoun(acctCount, 'account');
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
    if (urlExpIds.length) bParts.push(MastFormat.countNoun(urlExpIds.length, 'selected expense'));
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
    h += '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
      '<div style="font-size:1.6rem;margin-bottom:8px;">💸</div>' +
      '<div style="font-size:0.9rem;font-weight:500;">No expenses match these filters</div>' +
      '<div style="font-size:0.85rem;margin-top:4px;">Try clearing a filter, or expand the date range.</div></div>';
    // W1 R2-F3: keep canonical Period · Basis footer visible even when empty.
    _finExporters.expenses = function() {
      _finDownloadCsv('expenses', [['Date','Merchant','Description','Category','Account','Reviewed','Amount (USD)']],
        'Period: ' + start + ' to ' + end + ' · Basis: admin/expenses.date + plaidTransactions.date');
    };
    h += _finFooter('expenses', start + ' to ' + end, 'admin/expenses.date + plaidTransactions.date');
    return h;
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
    _finDownloadCsv('expenses', rows, 'Period: ' + start + ' to ' + end + ' · Basis: admin/expenses.date + plaidTransactions.date');
  };
  h += _finFooter('expenses', start + ' to ' + end, 'admin/expenses.date + plaidTransactions.date');

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

// W1 final wire (Accounting Idea -OtKxQEhTDampnjEBjvS): after a successful
// Mast write to expense/apBill/wholesaleInvoice, best-effort invoke the
// triggerQboPush callable so the sync queue picks up the change. The Mast
// write has already succeeded — any failure here is logged and swallowed
// so the user-visible flow stays intact (QBO is downstream-of-record).
async function _firTriggerQboPush(entityType, mastId) {
  try {
    if (typeof firebase === 'undefined' || !firebase.functions) return;
    var trigger = firebase.functions().httpsCallable('triggerQboPush');
    await trigger({ tid: MastDB.tenantId(), entityType: entityType, mastId: mastId });
  } catch (e) {
    console.warn('[qbo-push] trigger failed (best-effort):', entityType, mastId, e && e.message);
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
  mastConfirm('Approve ' + MastFormat.countNoun(ids.length, 'expense') + '?', { title: 'Approve expenses', confirmLabel: 'Approve' }).then(async function(ok) {
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
      showToast('Approved ' + MastFormat.countNoun(ids.length, 'expense'));
      // W1 final wire: each approved expense becomes eligible for QBO push.
      // Filter by pusher gate (source ∈ {plaid, manual}).
      ids.forEach(function(id) {
        var ex = finExpAllExpenses.find(function(x) { return x._id === id; });
        if (ex && (ex.source === 'plaid' || ex.source === 'manual')) {
          _firTriggerQboPush('expense', id);
        }
      });
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
  mastConfirm('Mark ' + MastFormat.countNoun(ids.length, 'expense') + ' as personal? They will be excluded from business reports.', { title: 'Mark as personal', confirmLabel: 'Mark Personal' }).then(async function(ok) {
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
  if (ex.createdAt) h += '<div>Created:</div><div>' + fmtDateTime(ex.createdAt) + '</div>';
  if (ex.updatedAt) h += '<div>Updated:</div><div>' + fmtDateTime(ex.updatedAt) + '</div>';
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
    // W1 final wire: approved expense → QBO push (best-effort, gated on
    // source ∈ {plaid, manual} per pusher filter).
    var _ex = finExpAllExpenses.find(function(x) { return x._id === id; });
    if (_ex && (_ex.source === 'plaid' || _ex.source === 'manual')) {
      _firTriggerQboPush('expense', id);
    }
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
  var gp = _finResolvePeriod(); // W2.8
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    renderFinancePeriodBar() +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
    '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Profit & Loss</h2>' +
    '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:3px 10px;border-radius:6px;font-size:0.78rem;font-weight:600;">Admin Only</span>' +
    '</div>' +
    periodPicker('fPl', gp.start, gp.end) +
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
    // W3.5: enrich both periods with burdened-labor signal so renderPnl can
    // fold into COGS + show Fixed Overhead line + source-tag chip.
    await Promise.all([
      _w3EnrichPnlWithBurden(curr, start, end),
      _w3EnrichPnlWithBurden(prev, prior.start, prior.end)
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
    var c = _orderRevenueCents(o); if (c <= 0) return;
    var ch = _chan(o.source || 'direct');
    if (isTestOrder(o) && !_includeTestData) {
      testRevenue += c;
      testTxnCount += 1;
      return;
    }
    revByChannel[ch] = (revByChannel[ch] || 0) + c;
    revenue += c;
  });
  sales.forEach(function(s) {
    if (!_salesRowCounts(s)) return; // skip voided + POS-square mirrors (orderId set → counted via its orders row)
    var c = _salesCents(s); if (c <= 0) return;
    var ch = _chan(s.source || 'pos');
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
    var c = _orderRevenueCents(o); if (c <= 0) return;
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

  // W3.5: fold burdened labor into COGS (gated on operator acknowledgement
  // per D-FIN-W3-9). Done at render time so the W1 R3-BLOCKER cogsMissing
  // gate in computePnlLocal is preserved untouched. Mutates curr/prev so
  // every downstream section (cards, statement, footer CSV, prior-period
  // comparison) sees consistent numbers.
  function _applyBurdenToPnl(p) {
    if (!p || !p._burden) return;
    var addCogs = p._burden.effectiveLaborCogsCents || 0;
    var fixedOh = p._burden.fixedOverheadCents || 0;
    if (addCogs > 0) {
      p.cogs = (p.cogs || 0) + addCogs;
      p.grossProfit = p.revenue - p.cogs;
    }
    if (fixedOh > 0) {
      // Fixed Overhead lands in opex as its own bucket — D-FIN-W3-11 (always
      // separate, no per-tenant absorb-vs-separate setting).
      p.opex = (p.opex || 0) + fixedOh;
      p.opexByCategory = p.opexByCategory || {};
      p.opexByCategory['Fixed Overhead (burdened labor)'] =
        (p.opexByCategory['Fixed Overhead (burdened labor)'] || 0) + fixedOh;
      p.netProfit = p.grossProfit - p.opex;
    } else if (addCogs > 0) {
      p.netProfit = p.grossProfit - p.opex;
    }
  }
  _applyBurdenToPnl(curr);
  _applyBurdenToPnl(prev);

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
      : 'Excluding test data (' + MastFormat.countNoun(testTxnCount, 'txn') + ', ' + fmt$(testRevenue) + ')';
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
    // W3.5: COGS card carries the burden source-tag chip when burdened labor
    // is folded in (or when fallback message applies). R-FIN-W3-1.
    var cogsSub = _sanityWrap(deltaBadge(-curr.cogs, -prev.cogs), -curr.cogs, -prev.cogs);
    if (curr._burden && curr._burden.acknowledged) {
      cogsSub = (cogsSub || '') + ' ' + _w3BurdenChipFor(curr._burden);
    } else if (curr._burden && curr._burden.hasData) {
      // Has data but operator hasn't acknowledged yet — show a soft hint chip.
      cogsSub = (cogsSub || '') + ' <span title="Burdened labor is available but not yet ' +
        'folded into COGS — click \'Enable accurate margins\' in the banner above." ' +
        'style="background:rgba(20,184,166,0.15);color:#14b8a6;padding:2px 8px;border-radius:999px;' +
        'font-size:0.72rem;font-weight:600;">Burden ready</span>';
    }
    h += statCard('COGS',    fmt$(curr.cogs),    '#f59e0b', cogsSub);
    h += statCard('Gross Profit', fmt$(curr.grossProfit), curr.grossProfit >= 0 ? '#22c55e' : '#ef4444', grossMarginPct !== null ? grossMarginPct + '% margin' : null);
    h += statCard('Net Profit', fmt$(curr.netProfit), curr.netProfit >= 0 ? '#22c55e' : '#ef4444', netMarginPct !== null ? netMarginPct + '% net margin' : null);
  }
  h += '</div>';

  if (cogsMissing) {
    h += '<div style="background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.35);color:#f59e0b;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:0.85rem;">' +
      '⚠ <strong>COGS not available.</strong> ' + MastFormat.countNoun(curr.cogsLineMissingCount, 'line item') + ' in this period have neither a snapshot <code>cogsCents</code> nor a product cost on file. Set product cost in the <strong>Maker</strong> module so P&amp;L can compute Gross Profit instead of treating COGS as $0 (which would falsely show 100% margin).' +
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
  revChs.forEach(function(ch) { h += plRow(_chanLabel(ch), curr.revByChannel[ch], true, false, '+'); });

  if (cogsMissing) {
    h += '<div style="display:flex;justify-content:space-between;padding:5px 0;border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:9px;">' +
      '<span style="font-size:0.9rem;font-weight:600;">COGS</span>' +
      '<span style="font-size:0.9rem;font-weight:700;color:var(--warm-gray,#888);">—</span>' +
      '</div>';
  } else {
    h += plRow('COGS', curr.cogs, false, true, '-');
    // W3.5: COGS sub-breakdown — Materials vs Burdened Labor — when burdened
    // labor was folded in. Materials = COGS minus the labor add-in we applied.
    if (curr._burden && curr._burden.acknowledged && curr._burden.effectiveLaborCogsCents > 0) {
      var laborCents = curr._burden.effectiveLaborCogsCents;
      var materialsCents = curr.cogs - laborCents;
      h += plRow('Materials & cost-of-goods', materialsCents, true, false, '-');
      h += '<div style="display:flex;justify-content:space-between;padding:5px 0 5px 16px;">' +
        '<span style="font-size:0.9rem;color:var(--warm-gray,#888);">Burdened labor (allocated to jobs) ' +
          _w3BurdenChipFor(curr._burden) + '</span>' +
        '<span style="font-size:0.9rem;font-weight:400;color:' + (laborCents <= 0 ? '#22c55e' : '#ef4444') +
          ';">' + fmt$(laborCents) + '</span>' +
        '</div>';
    } else if (curr._burden && !curr._burden.acknowledged && curr._burden.hasData) {
      h += '<div style="display:flex;justify-content:space-between;padding:5px 0 5px 16px;font-size:0.78rem;color:var(--warm-gray,#888);">' +
        '<span>Burdened labor available but not yet folded into COGS — see banner above.</span>' +
        '<span></span>' +
        '</div>';
    } else if (curr._burden && curr._burden.acknowledged && !curr._burden.hasData) {
      h += '<div style="display:flex;justify-content:space-between;padding:5px 0 5px 16px;font-size:0.78rem;color:var(--warm-gray,#888);">' +
        '<span>No burden data for this period — using base pay × hours (fallback).</span>' +
        '<span></span>' +
        '</div>';
    }
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
      rows.push(['  ' + _chanLabel(ch), (curr.revByChannel[ch] / 100).toFixed(2)]);
    });
    rows.push(['COGS', cogsMissing ? 'N/A (no product cost)' : (curr.cogs / 100).toFixed(2)]);
    if (curr._burden && curr._burden.acknowledged && curr._burden.effectiveLaborCogsCents > 0) {
      rows.push(['  Burdened labor (allocated)', (curr._burden.effectiveLaborCogsCents / 100).toFixed(2)]);
      rows.push(['  Burdened labor source', (curr._burden.dominantSource || '') + ' (' + (curr._burden.confidence || '') + ')']);
    }
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
  // W2.8: global period bar. Cash Flow is point-in-time ("as of today") so
  // the bar drives horizon-relative views but doesn't change the asOf anchor.
  // W2.7: Day Close v2 sub-view at ?subView=dayclose.
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    renderFinancePeriodBar() +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
    '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Cash Flow</h2>' +
    '<div style="display:flex;gap:8px;">' +
    '<button class="btn btn-secondary btn-small" onclick="navigateTo(\'finance-cash-flow?subView=dayclose\')">Day Close</button>' +
    '<button class="btn btn-secondary btn-small" onclick="loadCashFlow()">Refresh</button>' +
    '</div>' +
    '</div>' +
    '<div id="fCfContent">' + skeletonCards(3) + '</div>' +
    '</div>';
  var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  if (rp && rp.subView === 'dayclose') { renderDayCloseV2(rp.date); return; }
  loadCashFlow();
}

// Close v3 (Idea -OtQH_uRXqz9jJBRsmrj): Day Close gains immutable versioning.
// Reads versions from `closes/day/{closeId}` collection (latest non-superseded
// is the active view). Legacy `dayClose/{date}` still read on first render so
// operators can "Migrate to v1" with their existing values pre-filled. Writes
// flow through CF `writeDayClose` which creates a new version, marks prior
// version superseded, and writes the audit row.
//
// IDs scheme: `{date}-v{n}`. Listing by date uses `orderByChild('date')`.
//
// W2.7 history (KEPT) — Day Close v2 cash-drawer UX (opening/closing cash,
// checks list, variance, notes) is preserved as-is. v3 layers version control
// on top: header version badge, history drawer, re-close diff modal.
async function renderDayCloseV2(dateParam) {
  var el = document.getElementById('fCfContent');
  if (!el) return;
  var date = dateParam || todayStr();
  el.innerHTML = '<div style="color:var(--warm-gray,#888);padding:20px;text-align:center;">Loading day close…</div>';
  // W2b.3 — preload QBO conflicts so the dayClose banner can render. No-throw.
  if (typeof window._qboPreloadConflicts === 'function') {
    try { await window._qboPreloadConflicts(); } catch (_) {}
  }
  try {
    // Load latest version + full version history + legacy v2 fallback in parallel.
    var versionsResult = await _dcLoadVersionsForDate(date);
    var versions = versionsResult.versions;        // sorted asc by version
    var latest = versionsResult.latest;            // latest (highest version) or null
    var legacy = versionsResult.legacy;            // legacy dayClose/{date} doc or null
    var viewVersionId = (typeof window._dcViewVersionId === 'string') ? window._dcViewVersionId : null;
    // Determine which version's data populates the form. Read-only if not latest.
    var source = null;
    var readOnly = false;
    if (viewVersionId && versions.some(function(v) { return v.id === viewVersionId; })) {
      source = versions.filter(function(v) { return v.id === viewVersionId; })[0];
      readOnly = (latest && source.id !== latest.id);
    } else if (latest) {
      source = latest;
    } else if (legacy && (legacy.openingCashCents != null || legacy.closingCashCents != null)) {
      source = legacy;
    } else {
      source = {};
    }
    var existing = source || {};
    el._dcSourceVersion = source && source.version ? source.version : null;
    el._dcLatestVersion = latest && latest.version ? latest.version : 0;
    el._dcLatest = latest || null;
    el._dcLegacy = legacy || null;
    el._dcVersions = versions;
    el._dcReadOnly = readOnly;
    var openingCash = existing.openingCashCents != null ? (existing.openingCashCents / 100).toFixed(2) : '';
    var closingCash = existing.closingCashCents != null ? (existing.closingCashCents / 100).toFixed(2) : '';
    var notes = existing.notes || '';
    // Close v3: stored checks use canonical {number, payerName, amountCents, memo, invoiceRef}.
    // Form inputs work in display units ($), so convert amountCents → amount.
    // Also tolerate legacy `payor` from drafts saved before the v3 cutover.
    var checks = (Array.isArray(existing.checks) ? existing.checks : []).map(function(c) {
      var amt = (c.amountCents != null)
        ? (Number(c.amountCents) / 100).toFixed(2)
        : (c.amount != null ? c.amount : '');
      return {
        number: c.number || '',
        payerName: (c.payerName != null) ? c.payerName : (c.payor || ''),
        amount: amt,
        memo: c.memo || '',
        invoiceRef: c.invoiceRef || ''
      };
    });
    // Cache the checks array on the element so add/remove handlers can mutate
    // and re-render without round-trips. State scope is per-render.
    el._dcChecks = checks;

    var h = '<div style="max-width:760px;">';
    // Header: title + version badge + last-closed line + date picker
    var verBadge = '';
    // Close v3 fix-up: amber pill for "Not yet closed" status.
    var lastLine = '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:rgba(234,179,8,0.18);color:#eab308;border:1px solid rgba(234,179,8,0.35);font-size:0.72rem;font-weight:600;">Not yet closed (v1)</span>';
    if (latest) {
      // Close v3 fix-up: v1/v2 tooltip on version badge.
      var verTip = (latest.version === 1)
        ? 'First close of this day'
        : ('Re-close #' + latest.version + '. See version history for prior close details.');
      verBadge = '<span title="' + e(verTip) + '" style="display:inline-block;background:rgba(34,197,94,0.18);color:#22c55e;font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:8px;vertical-align:middle;cursor:help;">v' + latest.version + '</span>';
      var ts = latest.savedAt ? String(latest.savedAt).replace('T', ' ').slice(0, 16) : '';
      lastLine = 'Last closed by ' + _finRenderUserCell(latest.savedBy, latest.savedByName) + (ts ? ' at ' + e(ts) : '');
    } else if (legacy && legacy.savedAt) {
      verBadge = '<span style="display:inline-block;background:rgba(234,179,8,0.18);color:#eab308;font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:8px;vertical-align:middle;">legacy v0</span>';
      lastLine = 'Legacy v2 doc — saved ' + e(String(legacy.savedAt).replace('T',' ').slice(0,16));
    }
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">';
    h += '<div><h3 style="margin:0;font-size:1rem;font-weight:700;">Day Close — ' + e(date) + verBadge + '</h3>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-top:3px;">' + lastLine + '</div></div>';
    h += '<div style="display:flex;gap:6px;align-items:center;">';
    h += '<label style="font-size:0.78rem;color:var(--warm-gray,#888);">Date:</label>';
    h += '<input type="date" id="dcDate" value="' + e(date) + '" onchange="finDayCloseChangeDate(this.value)" style="background:var(--bg-secondary,#232323);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 8px;font-size:0.85rem;">';
    h += '</div></div>';

    // Read-only banner when viewing a superseded version
    if (readOnly && source && latest) {
      var supTs = latest.savedAt ? String(latest.savedAt).replace('T',' ').slice(0,16) : '';
      h += '<div style="background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.35);border-radius:8px;padding:10px 12px;margin-bottom:12px;color:#eab308;font-size:0.85rem;">';
      h += 'Showing v' + source.version + ' (superseded by v' + latest.version + (supTs ? ' at ' + e(supTs) : '') + '). ';
      h += '<a href="javascript:void(0)" onclick="finDayCloseViewVersion(null)" style="color:#eab308;text-decoration:underline;">Return to latest</a>';
      h += '</div>';
    }

    // W2b.3 — QBO conflict banner. Any pending conflict (entityType='dayClose')
    // whose mastId starts with this date (covers `{date}` or `{date}-v{n}`)
    // raises a red banner with a deep-link to the Conflicts tab. Per W2a
    // deep-link pattern, nested setTimeout to switch sub-view then inner tab.
    var conflictsArr = Array.isArray(window.__qboConflicts) ? window.__qboConflicts : [];
    var dcConflicts = conflictsArr.filter(function(c) {
      if (!c || c.resolution) return false;
      if (String(c.entityType) !== 'dayClose') return false;
      var mid = String(c.mastId || '');
      return mid === date || mid.indexOf(date) === 0;
    });
    if (dcConflicts.length > 0) {
      h += '<div style="background:rgba(239,68,68,0.10);border:1px solid rgba(239,68,68,0.45);border-radius:8px;padding:10px 14px;margin-bottom:12px;color:#ef4444;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">';
      h += '<div>⚠ This close has <strong>' + dcConflicts.length + '</strong> disputed receipt' + (dcConflicts.length === 1 ? '' : 's') + ' — QBO values diverge from Mast.</div>';
      h += '<button class="btn btn-secondary btn-small" onclick="navigateTo(\'settings\'); setTimeout(function(){ try { switchSettingsSubView(\'integrations\'); setTimeout(function(){ try { switchQboInnerTab(\'conflicts\'); } catch(_) {} }, 50); } catch(_) {} }, 50);">Review in Conflicts tab</button>';
      h += '</div>';
    }

    // Version history drawer (collapsible)
    if (versions.length > 0) {
      h += '<details style="margin-bottom:14px;background:var(--bg-secondary,#232323);border-radius:10px;padding:0;">';
      h += '<summary style="cursor:pointer;padding:10px 14px;font-size:0.85rem;font-weight:700;list-style:none;">Version history (' + versions.length + ')</summary>';
      h += '<div style="padding:6px 14px 12px;">';
      // newest first in the list
      var sortedDesc = versions.slice().sort(function(a, b) { return (b.version || 0) - (a.version || 0); });
      sortedDesc.forEach(function(v) {
        var vopCell = _finRenderUserCell(v.savedBy, v.savedByName);
        var vts = v.savedAt ? String(v.savedAt).replace('T',' ').slice(0,16) : '';
        var vvar = v.varianceCents != null ? fmt$(v.varianceCents) : '—';
        var isLatest = latest && v.id === latest.id;
        h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.78rem;">';
        h += '<div><span style="color:var(--warm-gray,#888);font-weight:700;">v' + v.version + '</span>';
        if (isLatest) h += ' <span style="color:#22c55e;font-weight:700;">(latest)</span>';
        h += ' &middot; ' + vopCell + (vts ? ' &middot; ' + e(vts) : '') + ' &middot; variance ' + e(vvar) + '</div>';
        h += '<button class="btn btn-secondary btn-small" onclick="finDayCloseViewVersion(\'' + _jsAttrSafe(v.id) + '\')">View</button>';
        h += '</div>';
      });
      h += '</div></details>';
    }

    // Cash drawer panel
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:16px;margin-bottom:14px;">';
    h += '<div style="font-size:0.85rem;font-weight:700;margin-bottom:10px;">Cash Drawer</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += _fInput('dcOpen', 'Opening Cash (USD)', openingCash, 'number');
    h += _fInput('dcClose', 'Closing Cash (USD)', closingCash, 'number');
    h += '</div>';
    // W2 R2-F5: render the variance formula in the empty state so operators
    // see what's being computed BEFORE entering values. _dcUpdateVariance()
    // replaces this with the live number once both inputs are populated.
    h += '<div id="dcVariance" style="margin-top:10px;font-size:0.85rem;color:var(--warm-gray,#888);">Variance: $0.00 (closing − opening − checks)</div>';
    h += '</div>';

    // Check entry panel
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:16px;margin-bottom:14px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
    h += '<div style="font-size:0.85rem;font-weight:700;">Checks Received</div>';
    h += '<button class="btn btn-primary btn-small" onclick="finDayCloseAddCheck()">+ Add Check</button>';
    h += '</div>';
    h += '<div id="dcCheckRows"></div>';
    h += '<div id="dcCheckTotal" style="margin-top:8px;font-size:0.85rem;color:var(--warm-gray,#888);"></div>';
    h += '</div>';

    // Notes
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:16px;margin-bottom:14px;">';
    h += '<div style="font-size:0.85rem;font-weight:700;margin-bottom:10px;">Notes</div>';
    h += '<textarea id="dcNotes" rows="3" style="width:100%;background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:8px 10px;font-size:0.85rem;font-family:inherit;box-sizing:border-box;" placeholder="Anything unusual? Shortages, overages, deposits, etc.">' + e(notes) + '</textarea>';
    h += '</div>';

    // Action buttons — Close v3 CTA state machine:
    //   no v1 + legacy doc exists  → "Migrate to v1" (pre-fills cash drawer)
    //   no version + no legacy     → "Close as v1"
    //   any version exists         → "Re-close (creates v{n+1})" — opens diff modal
    // Disabled entirely when viewing a superseded version (must "Return to latest" first).
    h += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;align-items:center;">';
    h += '<button class="btn btn-secondary btn-small" onclick="finDayCloseExportCsv()">Export CSV</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="window.print()">Print</button>';
    if (readOnly) {
      h += '<span style="font-size:0.78rem;color:var(--warm-gray,#888);">Editing disabled while viewing v' + (source && source.version) + '</span>';
    } else {
      var ctaLabel, ctaHandler;
      if (!latest && legacy && (legacy.openingCashCents != null || legacy.closingCashCents != null)) {
        ctaLabel = 'Migrate to v1';
        ctaHandler = 'finDayCloseSave(\'migrate\')';
      } else if (!latest) {
        ctaLabel = 'Close as v1';
        ctaHandler = 'finDayCloseSave(\'first\')';
      } else {
        ctaLabel = 'Re-close (creates v' + (latest.version + 1) + ')';
        ctaHandler = 'finDayCloseSave(\'reclose\')';
      }
      h += '<button class="btn btn-primary btn-small" onclick="' + ctaHandler + '">' + e(ctaLabel) + '</button>';
    }
    h += '</div>';
    h += '</div>';

    el.innerHTML = h;
    // Close v3 fix-up: async-resolve any raw UIDs into displayName/email.
    _finPatchUidLabels(el);
    // Initial check rows render + variance compute
    _dcRenderCheckRows();
    _dcUpdateVariance();
    // Hook variance recompute on input change
    var dcOpen = document.getElementById('dcOpen');
    var dcClose = document.getElementById('dcClose');
    if (dcOpen) dcOpen.addEventListener('input', _dcUpdateVariance);
    if (dcClose) dcClose.addEventListener('input', _dcUpdateVariance);
    // Close v3: lock down all inputs + the +Add Check button when viewing a
    // superseded version. The cash-drawer values, checks list, and notes are
    // immutable per the v3 rule (re-close creates a new version, not edits in place).
    if (readOnly) {
      try {
        var formEls = el.querySelectorAll('input, textarea');
        for (var i = 0; i < formEls.length; i++) {
          if (formEls[i].id === 'dcDate') continue; // date picker still works for navigation
          formEls[i].setAttribute('disabled', 'disabled');
          formEls[i].style.opacity = '0.6';
        }
        var addCheckBtn = el.querySelector('button[onclick="finDayCloseAddCheck()"]');
        if (addCheckBtn) addCheckBtn.style.display = 'none';
      } catch (xerr) { /* non-fatal */ }
    }
  } catch (err) {
    el.innerHTML = '<div style="padding:20px;color:var(--danger,#dc2626);">Failed to load day close: ' + e(err.message || err) + '</div>';
  }
}
function _dcChecks() {
  var el = document.getElementById('fCfContent');
  if (!el) return [];
  if (!Array.isArray(el._dcChecks)) el._dcChecks = [];
  return el._dcChecks;
}
function _dcSetChecks(arr) {
  var el = document.getElementById('fCfContent');
  if (el) el._dcChecks = arr;
}
function _dcRenderCheckRows() {
  var rowsEl = document.getElementById('dcCheckRows');
  if (!rowsEl) return;
  var checks = _dcChecks();
  if (checks.length === 0) {
    rowsEl.innerHTML = '<div style="color:var(--warm-gray,#888);font-size:0.78rem;padding:10px 0;">No checks added yet.</div>';
  } else {
    var h = '';
    checks.forEach(function(c, i) {
      // Close v3 reconciliation: canonical check fields are
      // {number, payerName, amountCents, memo?, invoiceRef?}. Render
      // accepts legacy `payor` as fallback for in-flight drafts.
      var payerVal = (c.payerName != null) ? c.payerName : (c.payor || '');
      h += '<div style="display:grid;grid-template-columns:90px 110px 1fr 1fr 90px 32px;gap:8px;align-items:center;margin-bottom:6px;">';
      h += '<input type="text" placeholder="Check #" value="' + e(c.number || '') + '" onchange="finDayCloseUpdateCheck(' + i + ',\'number\',this.value)" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 8px;font-size:0.85rem;">';
      h += '<input type="number" step="0.01" placeholder="Amount" value="' + e(c.amount != null ? c.amount : '') + '" onchange="finDayCloseUpdateCheck(' + i + ',\'amount\',this.value)" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 8px;font-size:0.85rem;">';
      h += '<input type="text" placeholder="Payer name" value="' + e(payerVal) + '" onchange="finDayCloseUpdateCheck(' + i + ',\'payerName\',this.value)" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 8px;font-size:0.85rem;">';
      h += '<input type="text" placeholder="Memo / applied invoice" value="' + e(c.memo || '') + '" onchange="finDayCloseUpdateCheck(' + i + ',\'memo\',this.value)" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 8px;font-size:0.85rem;">';
      h += '<input type="text" placeholder="Invoice #" value="' + e(c.invoiceRef || '') + '" onchange="finDayCloseUpdateCheck(' + i + ',\'invoiceRef\',this.value)" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 8px;font-size:0.85rem;">';
      h += '<button class="btn btn-secondary btn-small" onclick="finDayCloseRemoveCheck(' + i + ')" title="Remove">✕</button>';
      h += '</div>';
    });
    rowsEl.innerHTML = h;
  }
  var totEl = document.getElementById('dcCheckTotal');
  if (totEl) {
    var tot = checks.reduce(function(s, c) { return s + (parseFloat(c.amount) || 0); }, 0);
    totEl.textContent = 'Total checks: $' + MastFormat.moneyRaw(tot);
  }
}
function _dcUpdateVariance() {
  var open = parseFloat((document.getElementById('dcOpen') || {}).value);
  var close = parseFloat((document.getElementById('dcClose') || {}).value);
  var vEl = document.getElementById('dcVariance');
  if (!vEl) return;
  // W2 R2-F5: when inputs are empty, keep the formula placeholder visible
  // so the variance equation is always discoverable.
  if (isNaN(open) || isNaN(close)) {
    vEl.textContent = 'Variance: $0.00 (closing − opening − checks)';
    return;
  }
  // Close v3 R2-F2: variance = closing − opening − checkTotal (CPA convention).
  // Matches _dcGatherPayload computation so live preview equals saved value.
  var checks = _dcChecks();
  var checkTotal = checks.reduce(function(s, c) { return s + (parseFloat(c.amount) || 0); }, 0);
  var diff = close - open - checkTotal;
  var sign = diff >= 0 ? '+' : '−';
  var color = diff === 0 ? 'var(--warm-gray,#888)' : (Math.abs(diff) < 5 ? '#22c55e' : '#eab308');
  vEl.innerHTML = '<span style="color:' + color + ';font-weight:600;">Variance: ' + sign + '$' + MastFormat.moneyRaw(Math.abs(diff)) + ' (closing − opening − checks)</span>';
}
window.finDayCloseAddCheck = function() {
  var arr = _dcChecks();
  // Close v3 canonical check shape: {number, payerName, amount, memo, invoiceRef}
  arr.push({ number: '', amount: '', payerName: '', memo: '', invoiceRef: '' });
  _dcSetChecks(arr);
  _dcRenderCheckRows();
};
window.finDayCloseRemoveCheck = function(idx) {
  var arr = _dcChecks();
  arr.splice(idx, 1);
  _dcSetChecks(arr);
  _dcRenderCheckRows();
};
window.finDayCloseUpdateCheck = function(idx, field, value) {
  var arr = _dcChecks();
  if (!arr[idx]) return;
  arr[idx][field] = value;
  _dcSetChecks(arr);
  // Re-render total only (don't blow away inputs the user is typing in).
  var checks = arr;
  var totEl = document.getElementById('dcCheckTotal');
  if (totEl) {
    var tot = checks.reduce(function(s, c) { return s + (parseFloat(c.amount) || 0); }, 0);
    totEl.textContent = 'Total checks: $' + MastFormat.moneyRaw(tot);
  }
};
window.finDayCloseChangeDate = function(date) {
  if (!date) return;
  location.hash = '#finance-cash-flow?subView=dayclose&date=' + encodeURIComponent(date);
};
// Close v3: gather form values, build payload. Single source for save + diff modal.
function _dcGatherPayload() {
  var date = (document.getElementById('dcDate') || {}).value || todayStr();
  var openVal = parseFloat((document.getElementById('dcOpen') || {}).value);
  var closeVal = parseFloat((document.getElementById('dcClose') || {}).value);
  var notes = ((document.getElementById('dcNotes') || {}).value || '').trim();
  var checks = _dcChecks().filter(function(c) { return c.amount && !isNaN(parseFloat(c.amount)); }).map(function(c) {
    // Close v3 canonical check shape: {number, payerName, amountCents, memo, invoiceRef}
    return {
      number: (c.number || '').trim(),
      payerName: (c.payerName != null ? c.payerName : (c.payor || '')).trim(),
      amountCents: Math.round(parseFloat(c.amount) * 100),
      memo: (c.memo || '').trim(),
      invoiceRef: (c.invoiceRef || '').trim()
    };
  });
  var checkTotalCents = checks.reduce(function(s, c) { return s + c.amountCents; }, 0);
  // Close v3 R2-F2: variance = closing − opening − checks (CPA convention).
  // Checks have been logged as accounted-for cash; variance is what's UNaccounted.
  // Pre-Round-2 closes used `closing − opening` only; their hashes are not
  // comparable to post-Round-2 closes for the same inputs. Don't backfill —
  // legacy v1 docs retain their original computation; new closes use this formula.
  var variance = (isNaN(openVal) || isNaN(closeVal)) ? null : Math.round((closeVal - openVal) * 100) - checkTotalCents;
  return {
    date: date,
    openingCashCents: isNaN(openVal) ? null : Math.round(openVal * 100),
    closingCashCents: isNaN(closeVal) ? null : Math.round(closeVal * 100),
    varianceCents: variance,
    checks: checks,
    checkTotalCents: checkTotalCents,
    notes: notes || null
  };
}

// Close v3: load all versions of a date from `closes/day/{date}/v{n}` plus the
// legacy `dayClose/{date}` doc (fallback for the Migrate-to-v1 path).
//
// Agent A writes versions to the subcollection `closes/day/{date}/v{n}` (one
// subcollection per date), NOT a flat `closes/day/{closeId}` collection.
// MastDB can't traverse subcollections so we use raw firebase.firestore()
// (same pattern as customer-service.js:2097 for membership queries).
//
// Field-name reconciliation (Agent A writes vs UI reads, both supported):
//   savedBy        ← operatorUid
//   savedAt        ← serverTs (Firestore Timestamp; .toDate() for display)
//   superseded     ← supersededBy != null
async function _dcLoadVersionsForDate(date) {
  var versions = [];
  try {
    var db = firebase.firestore();
    var base = 'tenants/' + MastDB.tenantId() + '/closes/day/' + date;
    var snap = await db.collection(base).get();
    snap.forEach(function(doc) {
      var d = doc.data() || {};
      // Adapt A's field names to UI's expected field names.
      var savedAtIso = null;
      if (d.serverTs && typeof d.serverTs.toDate === 'function') {
        try { savedAtIso = d.serverTs.toDate().toISOString(); } catch (xerr) {}
      } else if (typeof d.savedAt === 'string') {
        savedAtIso = d.savedAt;
      }
      versions.push(Object.assign({}, d, {
        id: doc.id,
        savedBy: d.savedBy || d.operatorUid || null,
        savedAt: savedAtIso,
        superseded: d.supersededBy != null
      }));
    });
    versions.sort(function(a, b) { return (a.version || 0) - (b.version || 0); });
  } catch (xerr) { /* collection may not yet exist */ }
  var latest = null;
  for (var i = versions.length - 1; i >= 0; i--) {
    if (!versions[i].superseded) { latest = versions[i]; break; }
  }
  if (!latest && versions.length > 0) latest = versions[versions.length - 1];
  var legacy = null;
  try { legacy = await MastDB.get('dayClose/' + date); } catch (xerr) {}
  return { versions: versions, latest: latest, legacy: legacy };
}

// Close v3: enumerate the latest non-superseded day close for every date in a
// month, reading from the per-date subcollections under closes/day/. Used by
// renderPeriodClose. Returns a {date: latestVersionDoc} map.
async function _dcLoadLatestDayClosesForMonth(monthStr) {
  // monthStr = 'YYYY-MM'. Build the date range, fan out per-date reads in
  // parallel. For 31 days this is 31 small subcollection reads — cheap.
  var parts = monthStr.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  var dates = [];
  for (var d = 1; d <= lastDay; d++) {
    dates.push(monthStr + '-' + (d < 10 ? '0' + d : '' + d));
  }
  var db = firebase.firestore();
  var base = 'tenants/' + MastDB.tenantId() + '/closes/day';
  var pairs = await Promise.all(dates.map(async function(date) {
    try {
      var snap = await db.collection(base + '/' + date).get();
      var latest = null;
      snap.forEach(function(doc) {
        var dat = doc.data() || {};
        if (dat.supersededBy != null) return;
        if (!latest || (dat.version || 0) > (latest.version || 0)) {
          latest = Object.assign({}, dat, { id: doc.id, savedBy: dat.savedBy || dat.operatorUid, superseded: false });
        }
      });
      // If everything is superseded (shouldn't normally happen), take the
      // highest version anyway.
      if (!latest && !snap.empty) {
        snap.forEach(function(doc) {
          var dat = doc.data() || {};
          if (!latest || (dat.version || 0) > (latest.version || 0)) {
            latest = Object.assign({}, dat, { id: doc.id, savedBy: dat.savedBy || dat.operatorUid, superseded: dat.supersededBy != null });
          }
        });
      }
      return [date, latest];
    } catch (xerr) {
      return [date, null];
    }
  }));
  var out = {};
  pairs.forEach(function(p) { if (p[1]) out[p[0]] = p[1]; });
  return out;
}

// Close v3: load the latest non-superseded period close for a given month
// from `closes/period/{periodId}/v{n}`. Returns null if no period close yet.
async function _dcLoadLatestPeriodClose(monthStr) {
  try {
    var db = firebase.firestore();
    var base = 'tenants/' + MastDB.tenantId() + '/closes/period/' + monthStr;
    var snap = await db.collection(base).get();
    var latest = null;
    function adapt(d, id) {
      // Adapt A's field names to what renderPeriodClose expects.
      var closedAtIso = null;
      if (d.serverTs && typeof d.serverTs.toDate === 'function') {
        try { closedAtIso = d.serverTs.toDate().toISOString(); } catch (xerr) {}
      } else if (typeof d.closedAt === 'string') {
        closedAtIso = d.closedAt;
      }
      return Object.assign({}, d, {
        id: id,
        closedAt: d.status === 'closed' ? closedAtIso : (d.closedAt || null),
        autoClosedAt: d.status === 'auto-closed' ? closedAtIso : (d.autoClosedAt || null),
        closedBy: d.closedBy || d.operatorUid || null,
        rollup: d.rollup || {
          openingCashCentsSum: d.openingCashCents || 0,
          closingCashCentsSum: d.closingCashCents || 0,
          varianceCentsSum: d.varianceCents || 0
        }
      });
    }
    snap.forEach(function(doc) {
      var d = doc.data() || {};
      if (d.supersededBy != null) return;
      if (!latest || (d.version || 0) > (latest.version || 0)) {
        latest = adapt(d, doc.id);
      }
    });
    if (!latest && !snap.empty) {
      snap.forEach(function(doc) {
        var d = doc.data() || {};
        if (!latest || (d.version || 0) > (latest.version || 0)) {
          latest = adapt(d, doc.id);
        }
      });
    }
    return latest;
  } catch (xerr) { return null; }
}

// Close v3: collect all amendments across the last 12 months. Subcollection
// shape is `amendments/{periodId}/items/{amendmentId}` so we fan out one
// `.collection('items')` read per recent month. A collectionGroup query
// would be more efficient but requires a composite index — deferred per
// the build brief.
async function _dcLoadRecentAmendments() {
  var months = (typeof _pcLast12Months === 'function') ? _pcLast12Months() : [];
  if (months.length === 0) {
    // Fallback: compute last 12 months inline.
    var now = new Date();
    for (var i = 0; i < 12; i++) {
      var dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push(dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0'));
    }
  }
  var db = firebase.firestore();
  var base = 'tenants/' + MastDB.tenantId() + '/amendments';
  var all = [];
  await Promise.all(months.map(async function(periodId) {
    try {
      var snap = await db.collection(base + '/' + periodId + '/items').get();
      snap.forEach(function(doc) {
        var d = doc.data() || {};
        // Normalize submittedAt / approvedAt / rejectedAt timestamps so
        // the renderer's string-slice logic works for both Firestore
        // Timestamp objects and plain ISO strings.
        ['submittedAt', 'approvedAt', 'rejectedAt'].forEach(function(k) {
          var v = d[k];
          if (v && typeof v.toDate === 'function') {
            try { d[k] = v.toDate().toISOString(); } catch (xerr) {}
          }
        });
        all.push(Object.assign({}, d, { id: doc.id, periodId: d.periodId || periodId }));
      });
    } catch (xerr) { /* periodId may have no amendments */ }
  }));
  return all;
}

// Close v3: view a specific version of the form (read-only when not latest).
window.finDayCloseViewVersion = function(versionId) {
  window._dcViewVersionId = versionId || null;
  var date = (document.getElementById('dcDate') || {}).value || todayStr();
  renderDayCloseV2(date);
};

// Close v3: Re-close diff modal. Renders before/after for each changed field.
function _dcRenderDiff(latest, next) {
  var rows = [];
  function row(label, before, after) {
    if (before === after) return;
    rows.push({ label: label, before: before, after: after });
  }
  row('Opening cash', fmt$(latest.openingCashCents), fmt$(next.openingCashCents));
  row('Closing cash', fmt$(latest.closingCashCents), fmt$(next.closingCashCents));
  row('Variance', fmt$(latest.varianceCents), fmt$(next.varianceCents));
  row('Check total', fmt$(latest.checkTotalCents), fmt$(next.checkTotalCents));
  var prevChecks = Array.isArray(latest.checks) ? latest.checks.length : 0;
  var newChecks = next.checks.length;
  if (prevChecks !== newChecks) {
    row('Check count', String(prevChecks), String(newChecks) + ' (' + (newChecks > prevChecks ? '+' : '') + (newChecks - prevChecks) + ')');
  }
  row('Notes', (latest.notes || '(empty)'), (next.notes || '(empty)'));
  if (rows.length === 0) return '<div style="color:var(--warm-gray,#888);font-size:0.85rem;">No changes detected. Re-closing will still create a new version row for audit.</div>';
  var h = '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  h += '<thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.15);">Field</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.15);">v' + latest.version + ' (current)</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.15);">v' + (latest.version + 1) + ' (proposed)</th></tr></thead><tbody>';
  rows.forEach(function(r) {
    h += '<tr><td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);font-weight:600;">' + e(r.label) + '</td>';
    h += '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);color:#eab308;">' + e(r.before) + '</td>';
    h += '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);color:#22c55e;">' + e(r.after) + '</td></tr>';
  });
  h += '</tbody></table>';
  return h;
}

// Close v3: HTML-bodied confirm modal (mastConfirm escapes; we need rendered table).
// Built locally to match mastConfirm visual chrome.
function _dcShowDiffModal(date, nextVersion, innerHtml) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    var h = '<div style="background:var(--bg-secondary,#232323);border-radius:10px;max-width:640px;width:96%;padding:22px 24px;box-shadow:0 8px 30px rgba(0,0,0,0.4);color:var(--text,#fff);">';
    h += '<div style="font-size:1.0rem;font-weight:700;margin-bottom:10px;">Re-close ' + e(date) + ' &mdash; review changes</div>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:14px;">Creating an immutable v' + nextVersion + '. The current version is preserved in history.</div>';
    h += '<div style="max-height:340px;overflow-y:auto;margin-bottom:18px;">' + innerHtml + '</div>';
    h += '<div style="display:flex;justify-content:flex-end;gap:8px;">';
    h += '<button class="btn btn-secondary" id="dcDiffCancel">Cancel</button>';
    h += '<button class="btn btn-primary" id="dcDiffOK">Create v' + nextVersion + '</button>';
    h += '</div></div>';
    overlay.innerHTML = h;
    document.body.appendChild(overlay);
    function close(result) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(result); }
    overlay.querySelector('#dcDiffCancel').addEventListener('click', function() { close(false); });
    overlay.querySelector('#dcDiffOK').addEventListener('click', function() { close(true); });
    overlay.addEventListener('click', function(ev) { if (ev.target === overlay) close(false); });
  });
}

// Close v3: small wrapper that invokes one of the Close v3 CFs via
// firebase.functions().httpsCallable(name). Agent A's CFs are onCall and
// expect tid in data.tid (httpsCallable has no header concept). The httpsCallable
// invocation auto-injects the Firebase Auth ID token — no Authorization header
// needed. Returns the unwrapped `data` object (response is `{data: {ok, ...}}`).
async function _closeV3Call(name, payload) {
  var p = Object.assign({}, payload || {});
  if (!p.tid) p.tid = MastDB.tenantId();
  var fn = firebase.functions().httpsCallable(name);
  var res = await fn(p);
  return (res && res.data) ? res.data : {};
}

// Close v3: state-free save core — both the classic form and the V2 close hub
// call this. Builds the at-most-once requestId, invokes the writeDayClose CF
// (which performs version-bump + supersede + audit-row atomically), enforces
// the explicit ok===true contract (R2-F1), and writes the client-side audit
// row. Throws on any failure; resolves with the CF response on success.
async function _dayCloseSaveCore(payload, isReclose) {
  // Best-effort UUID (crypto.randomUUID is widely supported in supported browsers).
  var requestId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID()
    : ('rid-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  var p = Object.assign({}, payload, { requestId: requestId });
  var json = await _closeV3Call('writeDayClose', p);
  if (!json || json.ok !== true) {
    console.error('[close-v3] writeDayClose returned non-ok response:', json);
    var err = new Error((json && (json.message || json.error || json.code)) || 'CF returned no ok flag — check console');
    err.response = json;
    throw err;
  }
  // Audit: client-side row for cross-UI consistency. CF also writes its own
  // immutable audit row in `closes/audit/{...}` (Agent A) so this is belt-and-braces.
  try { await writeAudit(isReclose ? 'update' : 'create', 'dayClose', payload.date + ':v' + (json.version || '?')); } catch (xerr) {}
  return json;
}

// Close v3: Save — always goes through the writeDayClose CF (via the shared
// state-free core above; this wrapper owns the classic form's DOM gather +
// diff modal + re-render).
window.finDayCloseSave = async function(mode) {
  var el = document.getElementById('fCfContent');
  if (el && el._dcReadOnly) { showToast('Cannot edit a superseded version.', true); return; }
  var payload = _dcGatherPayload();
  var latest = el && el._dcLatest;
  // Re-close: show diff modal first; user confirms inside the modal.
  if (mode === 'reclose' && latest) {
    var diffHtml = _dcRenderDiff(latest, payload);
    var ok = await _dcShowDiffModal(payload.date, latest.version + 1, diffHtml);
    if (!ok) return;
  }
  try {
    var json = await _dayCloseSaveCore(payload, mode === 'reclose');
    showToast('Day Close v' + (json.version || '?') + ' saved for ' + payload.date);
    window._dcViewVersionId = null;
    // TODO(close-v3 fix-up Round 2): Morgan persona reported URL hash flips to
    // #settings after Create v2 confirm while Day Close tab stays rendered —
    // likely background nav from MastNavStack or a modal teardown side effect.
    // Investigate + restore hash to the captured pre-modal route.
    renderDayCloseV2(payload.date);
  } catch (err) {
    // httpsCallable throws HttpsError-shaped objects; surface .message + .code + .details.
    console.error('[close-v3] writeDayClose threw:', err);
    var msg = (err && err.message) || (err && err.code) || String(err) || 'unknown error';
    if (err && err.details && err.details.code) msg += ' (' + err.details.code + ')';
    showToast('Save failed: ' + msg, true);
  }
};
window.finDayCloseExportCsv = function() {
  var date = (document.getElementById('dcDate') || {}).value || todayStr();
  var openVal = parseFloat((document.getElementById('dcOpen') || {}).value);
  var closeVal = parseFloat((document.getElementById('dcClose') || {}).value);
  var notes = ((document.getElementById('dcNotes') || {}).value || '').trim();
  var checks = _dcChecks();
  var rows = [['Section','Field','Value']];
  rows.push(['Cash Drawer','Opening Cash', isNaN(openVal) ? '' : openVal.toFixed(2)]);
  rows.push(['Cash Drawer','Closing Cash', isNaN(closeVal) ? '' : closeVal.toFixed(2)]);
  if (!isNaN(openVal) && !isNaN(closeVal)) {
    // Close v3 R2-F2: variance = closing − opening − checkTotal (CPA convention).
    var _csvCheckTotal = checks.reduce(function(s, c) { return s + (parseFloat(c.amount) || 0); }, 0);
    rows.push(['Cash Drawer','Variance (closing − opening − checks)', (closeVal - openVal - _csvCheckTotal).toFixed(2)]);
  }
  rows.push([]);
  rows.push(['Checks','Check #','Amount','Payer Name','Memo','Invoice Ref']);
  checks.forEach(function(c) {
    if (!c.amount) return;
    var payer = (c.payerName != null) ? c.payerName : (c.payor || '');
    rows.push(['Check', c.number || '', parseFloat(c.amount).toFixed(2), payer, c.memo || '', c.invoiceRef || '']);
  });
  rows.push(['Checks','Total', checks.reduce(function(s, c) { return s + (parseFloat(c.amount) || 0); }, 0).toFixed(2)]);
  rows.push([]);
  if (notes) rows.push(['Notes','', notes]);
  _finDownloadCsv('dayclose-' + date, rows, 'Day Close for ' + date);
  showToast('Day Close CSV exported');
};

async function loadCashFlow() {
  var el = document.getElementById('fCfContent');
  if (!el) return;
  el.innerHTML = skeletonCards(3) + '<div style="margin-top:16px;">' + skeletonCards(2) + '</div>';

  try {
    var snap = await _computeCashSnapshot((typeof _cashHorizonDays === 'number') ? _cashHorizonDays : 30);
    _cfLastSnapshot = snap;
    el.innerHTML = renderCashFlow(snap.bankTotal, snap.bankAccounts, snap.staleItems, snap.arTotal,
      snap.arDueHorizon, snap.arCount, snap.apTotal, snap.apDueHorizon, snap.apCount, snap.netProjected, snap.asOf);
    _cfLoaded = true;
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Cash flow load failed: ' + err.message, true);
  }
}

// State-free cash projection core — shared by the legacy Cash Flow tab and the
// V2 statements hub (FinanceBridge.cashSnapshot). No DOM, no module state.
async function _computeCashSnapshot(horizonDays) {
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
    horizonDays = (typeof horizonDays === 'number') ? horizonDays : 30;
    var allOrders = Object.assign({}, sentRaw || {}, overdueRaw || {});
    var arTotal = 0, arDueHorizon = 0, arCount = 0;
    var arWholesaleHorizon = 0, arDirectHorizon = 0;
    Object.values(allOrders).forEach(function(o) {
      var cents = _orderRevenueCents(o);
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

    return {
      bankTotal: bankTotal, bankAccounts: bankAccounts, staleItems: staleItems,
      arTotal: arTotal, arDueHorizon: arDueHorizon, arCount: arCount,
      arWholesaleHorizon: arWholesaleHorizon, arDirectHorizon: arDirectHorizon,
      apTotal: apTotal, apDueHorizon: apDueHorizon, apCount: apCount,
      netProjected: netProjected, asOf: asOf, horizonDays: horizonDays
    };
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
    h += statCard('Cash on Hand', '$' + MastFormat.moneyRaw(bankTotal), '#22c55e', MastFormat.countNoun(bankAccounts.length, 'account'));
  } else {
    h += statCard('Cash on Hand', '—', 'var(--warm-gray,#888)', 'Connect a bank to track');
  }
  // W1.2: card sub-label now shows the projected portion explicitly so the
  // header and the projection cell reconcile visibly on the same panel.
  h += statCard('AR Outstanding', fmt$(arTotal), '#3b82f6',
    MastFormat.countNoun(arCount, 'invoice') + ' · ' + fmt$(arDueHorizon) + ' in ≤' + horizonDays + 'd');
  h += statCard('AP Due', fmt$(apTotal), '#f97316',
    MastFormat.countNoun(apCount, 'receipt') + ' · ' + fmt$(apDueHorizon) + ' in ≤' + horizonDays + 'd');
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
      h += '<div style="font-weight:700;font-size:1rem;color:#22c55e;">$' + MastFormat.moneyRaw(acct.balance) + '</div>';
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
  h += '<div style="font-size:1.15rem;font-weight:700;color:' + projColor + ';">$' + MastFormat.moneyRaw(Math.abs(netProjected)) + (netProjected < 0 ? ' deficit' : '') + '</div>';
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

// ── W2.4: AR Dunning Settings + Audit Log sub-views ──────────────────────────
// Settings persisted at admin/config/dunning (canonical 5-segment doc per
// W1.8 path lesson — tenants/{tid}/admin/config/dunning is valid). Customer
// opt-out lives on customer.marketing.dunningOptIn (default true).
// Audit log reads admin/ar_reminders/{key} written by finArSendReminder.
// The scheduled cron that sends 1d/7d/30d-post-due reminders is OWNED by
// Agent A's CF work — this UI configures it but does NOT deploy the CF.

async function renderArDunningSettings() {
  var el = document.getElementById('fArContent');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--warm-gray,#888);padding:20px;text-align:center;">Loading settings…</div>';
  try {
    var cfg = (await MastDB.get('admin/config/dunning')) || {};
    var cadence = cfg.cadence || { '1d': true, '7d': true, '30d': true };
    var enabled = cfg.enabled !== false;

    var h = '<div style="padding:20px;max-width:720px;">';
    h += '<a href="#finance-ar" style="color:var(--teal,#2a9d8f);font-size:0.85rem;text-decoration:none;">&larr; Back to AR aging</a>';
    h += '<h2 style="margin:12px 0 16px 0;font-size:1.15rem;font-weight:700;">Dunning Settings</h2>';
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:18px;">';
    h += '<label style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer;">' +
      '<input type="checkbox" id="dunEnabled"' + (enabled ? ' checked' : '') + '>' +
      '<span style="font-size:0.9rem;font-weight:600;">Enable automated reminders</span>' +
      '</label>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin:4px 0 14px 24px;">When enabled, the daily reminder job will queue an email for every overdue invoice that matches the cadence below (subject to customer opt-out).</div>';
    h += '<div style="font-weight:600;font-size:0.85rem;margin-bottom:8px;">Reminder cadence (days past due)</div>';
    [['1d', '1 day overdue'], ['7d', '7 days overdue'], ['30d', '30 days overdue']].forEach(function(kl) {
      h += '<label style="display:flex;align-items:center;gap:10px;padding:5px 0;cursor:pointer;margin-left:6px;">' +
        '<input type="checkbox" id="dun_' + kl[0] + '"' + (cadence[kl[0]] !== false ? ' checked' : '') + '>' +
        '<span style="font-size:0.85rem;">' + e(kl[1]) + '</span></label>';
    });
    h += '<div style="margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:flex-end;gap:8px;">';
    h += '<button class="btn btn-secondary btn-small" onclick="location.hash=\'#finance-ar\'">Cancel</button>';
    h += '<button class="btn btn-primary btn-small" onclick="finArSaveDunningSettings()">Save Settings</button>';
    h += '</div></div>';
    h += '<div style="margin-top:18px;padding:14px;background:var(--bg-secondary,#232323);border-radius:10px;font-size:0.78rem;color:var(--warm-gray,#888);">' +
      'Per-customer opt-out lives on the customer record (Marketing tab → Dunning emails). Default is ON for newly-created customers.' +
      '</div>';
    h += '</div>';
    el.innerHTML = h;
  } catch (err) {
    el.innerHTML = '<div style="padding:20px;color:var(--danger,#dc2626);">Failed to load settings: ' + e(err.message || err) + '</div>';
  }
}

// State-free settings core — both the classic sub-view and the V2 open-items
// hub call this. settings = { enabled: bool, cadence: {'1d','7d','30d'} }.
async function _arSaveDunningSettingsCore(settings) {
  await MastDB.set('admin/config/dunning', {
    enabled: !!settings.enabled,
    cadence: {
      '1d': !!(settings.cadence && settings.cadence['1d']),
      '7d': !!(settings.cadence && settings.cadence['7d']),
      '30d': !!(settings.cadence && settings.cadence['30d'])
    },
    updatedAt: new Date().toISOString()
  });
}

// Read core for the V2 hub: settings doc with the legacy defaults applied
// (enabled unless explicitly false; every cadence step on unless false).
async function _arDunningConfigCore() {
  var cfg = (await MastDB.get('admin/config/dunning')) || {};
  var cadence = cfg.cadence || {};
  return {
    enabled: cfg.enabled !== false,
    cadence: { '1d': cadence['1d'] !== false, '7d': cadence['7d'] !== false, '30d': cadence['30d'] !== false },
    updatedAt: cfg.updatedAt || null
  };
}

// Read core for the reminder audit log (written by finArSendReminder),
// newest first.
async function _arReminderLogCore() {
  var raw = (await MastDB.get('admin/ar_reminders')) || {};
  return Object.entries(raw)
    .map(function(kv) { return Object.assign({ _key: kv[0] }, kv[1]); })
    .sort(function(a, b) { return (b.sentAt || '').localeCompare(a.sentAt || ''); });
}

window.finArSaveDunningSettings = async function() {
  try {
    await _arSaveDunningSettingsCore({
      enabled: !!(document.getElementById('dunEnabled') && document.getElementById('dunEnabled').checked),
      cadence: {
        '1d': !!(document.getElementById('dun_1d') && document.getElementById('dun_1d').checked),
        '7d': !!(document.getElementById('dun_7d') && document.getElementById('dun_7d').checked),
        '30d': !!(document.getElementById('dun_30d') && document.getElementById('dun_30d').checked)
      }
    });
    showToast('Dunning settings saved');
    location.hash = '#finance-ar';
  } catch (err) {
    showToast('Save failed: ' + (err.message || err), true);
  }
};

async function renderArAuditLog() {
  var el = document.getElementById('fArContent');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--warm-gray,#888);padding:20px;text-align:center;">Loading audit log…</div>';
  try {
    var raw = (await MastDB.get('admin/ar_reminders')) || {};
    var rows = Object.entries(raw)
      .map(function(kv) { return Object.assign({ _key: kv[0] }, kv[1]); })
      .sort(function(a, b) { return (b.sentAt || '').localeCompare(a.sentAt || ''); });

    var h = '<div style="padding:20px;max-width:1100px;">';
    h += '<a href="#finance-ar" style="color:var(--teal,#2a9d8f);font-size:0.85rem;text-decoration:none;">&larr; Back to AR aging</a>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 16px 0;">';
    h += '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Reminder Audit Log</h2>';
    h += '<span style="color:var(--warm-gray,#888);font-size:0.78rem;">' + MastFormat.countNoun(rows.length, 'record') + '</span>';
    h += '</div>';

    if (rows.length === 0) {
      h += '<div style="text-align:center;padding:40px;color:var(--warm-gray,#888);">No reminders sent yet. Use the Send Reminder action on the AR aging view.</div>';
    } else {
      h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
      h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
      ['Sent','Invoice #','Customer Email','Amount Due','Status','Sent By'].forEach(function(c) {
        h += '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">' + c + '</th>';
      });
      h += '</tr></thead><tbody>';
      rows.forEach(function(r) {
        h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">';
        h += '<td style="padding:8px 10px;font-size:0.78rem;">' + e((r.sentAt || '').replace('T', ' ').slice(0, 16)) + '</td>';
        h += '<td style="padding:8px 10px;font-size:0.78rem;">' + e(r.invoiceNumber || (r.invoiceId ? r.invoiceId.slice(-8) : '—')) + '</td>';
        h += '<td style="padding:8px 10px;font-size:0.78rem;">' + e(r.customerEmail || '—') + '</td>';
        h += '<td style="padding:8px 10px;font-weight:600;">' + fmt$(r.amtDueCents || 0) + '</td>';
        h += '<td style="padding:8px 10px;font-size:0.78rem;">' + e(r.status || 'queued') + '</td>';
        h += '<td style="padding:8px 10px;font-size:0.78rem;color:var(--warm-gray,#888);">' + e(r.sentBy || '—') + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    el.innerHTML = h;
  } catch (err) {
    el.innerHTML = '<div style="padding:20px;color:var(--danger,#dc2626);">Failed to load audit log: ' + e(err.message || err) + '</div>';
  }
}

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
    renderFinancePeriodBar() +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
    '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Accounts Receivable</h2>' +
    '<div style="display:flex;gap:8px;">' + askAi +
    '<button class="btn btn-secondary btn-small" onclick="navigateTo(\'finance-ar?subView=settings\')">Dunning Settings</button>' +
    '<button class="btn btn-secondary btn-small" onclick="navigateTo(\'finance-ar?subView=audit\')">Audit Log</button>' +
    '<button class="btn btn-secondary btn-small" onclick="loadArData()">Refresh</button>' +
    '</div>' +
    '</div>' +
    '<div id="fArContent">' + skeletonCards(5) + '<div style="margin-top:16px;">' + skeletonTable(5,6) + '</div></div>' +
    '</div>';
  // W2.4 sub-view routing — settings + audit log surfaces co-located.
  var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  if (rp && rp.subView === 'settings') { renderArDunningSettings(); return; }
  if (rp && rp.subView === 'audit')    { renderArAuditLog(); return; }
  loadArData();
}

async function loadArData() {
  var el = document.getElementById('fArContent');
  if (!el) return;
  el.innerHTML = skeletonCards(5) + '<div style="margin-top:16px;">' + skeletonTable(5,6) + '</div>';
  // W1.10: clear reminder UI state on fresh load — historical reminders
  // live in admin/ar_reminders, not in this transient render-only map.
  _arReminderState = {};
  _arStatementState = {};
  // W2b.3 — preload QBO conflicts so inline [Conflict] chips render on first
  // paint. No-throw: chips simply won't appear if the preload fails.
  if (typeof window._qboPreloadConflicts === 'function') {
    try { await window._qboPreloadConflicts(); } catch (_) {}
  }

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
      var totalCents = _orderRevenueCents(o);
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

      // W1.7: snapshot wholesale flag + contact email for the row so the
      // table can show a Tier badge and W1.10 can queue a reminder.
      // W2 R2-F2: also snapshot customerId so the per-row "Send Statement"
      // button can mint a customer-statement token via the W2.6 CF.
      rows.push({
        orderId: orderId,
        invoiceNumber: o.invoiceNumber || '',
        customerId: o.customerId || (o.customer && o.customer.id) || null,
        customerName: o.customerName || 'Unknown',
        customerEmail: o.customerEmail || (o.customer && o.customer.email) || '',
        amtDue: amtDue,
        totalCents: totalCents,
        dueDate: o.invoiceDueDate || '',
        daysOverdue: daysOver,
        bucket: bucket,
        invoiceStatus: o.invoiceStatus,
        isWholesale: isWholesaleOrder(o),
        wholesaleAccountId: o.wholesaleAccountId || null
      });
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
      : 'Excluding test data (' + MastFormat.countNoun(testRows, 'invoice') + ', ' + fmt$(testAmtDue) + ')';
    var btnLabel = _includeTestData ? 'Exclude' : 'Include';
    h += '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">' +
         '<span style="background:' + chipBg + ';color:' + chipFg + ';padding:4px 10px;border-radius:999px;font-size:0.78rem;font-weight:600;">' + chipLabel + '</span>' +
         '<button type="button" onclick="window.toggleFinanceTestData()" style="background:transparent;border:1px solid var(--warm-gray,#666);color:var(--text,#fff);padding:3px 10px;border-radius:999px;font-size:0.78rem;cursor:pointer;">' + btnLabel + '</button>' +
         '</div>';
  }

  // Summary cards
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">';
  h += statCard('Total AR', fmt$(total), '#3b82f6', MastFormat.countNoun(rows.length, 'invoice'));
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

  // Sortable: apply current sort key/dir to filtered AR rows.
  if (typeof window.mastSortRows === 'function') {
    filtered = window.mastSortRows(filtered, _arSortKey, _arSortDir, function(row, key) {
      if (!row) return null;
      if (key === 'amtDue') return Number(row.amtDue) || 0;
      if (key === 'daysOver') return Number(row.daysOver) || 0;
      if (key === 'tier') return row.isWholesale ? 'wholesale' : 'direct';
      if (key === 'dueDate') return row.dueDate || '';
      if (key === 'status') return row.bucket || '';
      if (key === 'customerName') return row.customerName || '';
      return row[key];
    });
  }

  // Table
  // W1.7: Tier column. W1.10: per-row "Send Reminder" action.
  h += '<div style="overflow-x:auto;">';
  h += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
  if (typeof window.mastSortableTh === 'function') {
    var thStyle = 'font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;padding:8px 10px;';
    h += window.mastSortableTh('Customer',    'customerName', _arSortKey, _arSortDir, 'window._arSort', thStyle);
    h += window.mastSortableTh('Tier',        'tier',         _arSortKey, _arSortDir, 'window._arSort', thStyle);
    h += '<th style="text-align:left;padding:8px 10px;' + thStyle + '">Invoice #</th>';
    h += '<th style="text-align:left;padding:8px 10px;' + thStyle + '">Order</th>';
    h += window.mastSortableTh('Amount Due',  'amtDue',       _arSortKey, _arSortDir, 'window._arSort', thStyle);
    h += window.mastSortableTh('Due Date',    'dueDate',      _arSortKey, _arSortDir, 'window._arSort', thStyle);
    h += window.mastSortableTh('Age',         'daysOver',     _arSortKey, _arSortDir, 'window._arSort', thStyle);
    h += window.mastSortableTh('Status',      'status',       _arSortKey, _arSortDir, 'window._arSort', thStyle);
    h += '<th style="padding:8px 10px;' + thStyle + '"></th>';
  } else {
    ['Customer','Tier','Invoice #','Order','Amount Due','Due Date','Age','Status',''].forEach(function(col) {
      h += '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">' + col + '</th>';
    });
  }
  h += '</tr></thead><tbody>';

  filtered.forEach(function(r) {
    var reminderState = (_arReminderState && _arReminderState[r.orderId]) || null;
    var canRemind = !!r.customerEmail && r.customerEmail.indexOf('@') > 0;
    var orderIdAttr = (window._jsAttr ? window._jsAttr(r.orderId) : r.orderId);
    // W2 R2-F2: Send Statement state keyed by customerId. Button hidden if
    // the row has no customerId (legacy orders pre-customer linkage).
    var stmtState = (r.customerId && _arStatementState && _arStatementState[r.customerId]) || null;
    var customerIdAttr = r.customerId ? (window._jsAttr ? window._jsAttr(r.customerId) : r.customerId) : '';
    var customerEmailAttr = (window._jsAttr ? window._jsAttr(r.customerEmail || '') : (r.customerEmail || ''));
    var customerNameAttr = (window._jsAttr ? window._jsAttr(r.customerName || '') : (r.customerName || ''));
    h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">';
    h += '<td style="padding:10px;">' + e(r.customerName) + '</td>';
    // W1.7 Tier badge
    if (r.isWholesale) {
      h += '<td style="padding:10px;"><span style="background:rgba(139,92,246,0.18);color:#8b5cf6;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Wholesale</span></td>';
    } else {
      h += '<td style="padding:10px;"><span style="background:rgba(59,130,246,0.15);color:#3b82f6;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Direct</span></td>';
    }
    h += '<td style="padding:10px;font-size:0.78rem;color:var(--warm-gray,#888);">' + e(r.invoiceNumber || '—') + '</td>';
    h += '<td style="padding:10px;font-size:0.78rem;"><a href="#" style="color:var(--teal,#2a9d8f);" onclick="event.preventDefault();navigateTo(\'orders\')">' + e(r.orderId.slice(-8)) + '</a></td>';
    h += '<td style="padding:10px;font-weight:700;color:' + bucketColor(r.bucket) + ';">' + fmt$(r.amtDue) + '</td>';
    h += '<td style="padding:10px;font-size:0.78rem;">' + e(r.dueDate ? MastFormat.date(r.dueDate) : '—') + '</td>';
    h += '<td style="padding:10px;">' + agingBadge(r.daysOverdue) + '</td>';
    // W2b.3 — inline [Conflict] chip when this invoice has an unresolved QBO
    // conflict. Clicking opens the resolution modal directly. Chip is hidden
    // when no conflict pending (most rows).
    var arConflict = (typeof window._qboFindConflict === 'function') ? window._qboFindConflict('invoice', r.orderId) : null;
    var arConflictChip = arConflict
      ? ' <button class="btn btn-danger" style="font-size:0.72rem;padding:1px 6px;margin-left:4px;" onclick="window.openQboConflictModal(\'' + _jsAttrSafe(arConflict.conflictId || '') + '\')" title="QBO has different values for this invoice — click to resolve">⚠ Conflict</button>'
      : '';
    h += '<td style="padding:10px;"><span style="background:rgba(241,164,0,0.15);color:#f59e0b;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + e(r.invoiceStatus) + '</span>' + arConflictChip + '</td>';
    h += '<td style="padding:10px;white-space:nowrap;">';
    // W1.10 (-OtMNJdpUIMpbJcKQAY0): Send Reminder action. Only for overdue
    // rows (daysOverdue > 0) — current invoices don't need chasing.
    if (r.daysOverdue > 0) {
      if (reminderState === 'sent') {
        h += '<span style="background:rgba(34,197,94,0.15);color:#22c55e;padding:3px 10px;border-radius:999px;font-size:0.72rem;font-weight:600;margin-right:6px;">Reminder queued</span>';
      } else {
        var inFlight = reminderState === 'sending';
        var disabledAttr = (canRemind && !inFlight) ? '' : ' disabled';
        var titleAttr = canRemind ? 'Queue an email reminder to ' + r.customerEmail : 'No customer email on file';
        h += '<button class="btn btn-secondary btn-small"' + disabledAttr +
          ' title="' + e(titleAttr) + '"' +
          ' onclick="finArSendReminder(\'' + orderIdAttr + '\')"' +
          ' style="margin-right:6px;">' +
          (inFlight ? 'Sending…' : 'Send Reminder') +
          '</button>';
      }
    }
    // W2 R2-F2 (-OtMNKZ8c0Q3VlhqcaA0): Send Statement action — mints a
    // customer-statement share link via the W2.6 mintCustomerStatementToken CF
    // and opens an email composer (mailto:) so the operator can send to the
    // customer. Hidden when the row has no customerId (data-shape gap on
    // legacy orders pre-customer-linkage).
    if (r.customerId) {
      if (stmtState === 'sent') {
        h += '<span style="background:rgba(34,197,94,0.15);color:#22c55e;padding:3px 10px;border-radius:999px;font-size:0.72rem;font-weight:600;margin-right:6px;">Statement link sent</span>';
      } else {
        var stmtInFlight = stmtState === 'sending';
        var canStmt = !!r.customerEmail && r.customerEmail.indexOf('@') > 0;
        var stmtDisabledAttr = (canStmt && !stmtInFlight) ? '' : ' disabled';
        var stmtTitleAttr = canStmt ? 'Mint a customer-statement share link and open email to ' + r.customerEmail : 'No customer email on file';
        h += '<button class="btn btn-secondary btn-small"' + stmtDisabledAttr +
          ' title="' + e(stmtTitleAttr) + '"' +
          ' onclick="finArSendStatement(\'' + customerIdAttr + '\',\'' + customerEmailAttr + '\',\'' + customerNameAttr + '\')"' +
          ' style="margin-right:6px;">' +
          (stmtInFlight ? 'Sending…' : 'Send Statement') +
          '</button>';
      }
    }
    h += '<button class="btn btn-primary btn-small" data-order-id="' + e(r.orderId) + '" data-amt="' + r.totalCents + '" onclick="finArMarkPaid(this.dataset.orderId, parseInt(this.dataset.amt))">Mark Paid</button>';
    h += '</td></tr>';
  });

  h += '</tbody></table></div>';

  // W1.3 + R-FIN-1: CSV exporter + Period · Basis footer.
  _finExporters.ar = function() {
    var rows = [];
    rows.push(['Customer', 'Tier', 'Invoice #', 'Order ID', 'Amount Due (USD)', 'Due Date', 'Days Overdue', 'Bucket', 'Status', 'Customer Email']);
    filtered.forEach(function(r) {
      rows.push([
        r.customerName, r.isWholesale ? 'Wholesale' : 'Direct',
        r.invoiceNumber || '', r.orderId, (r.amtDue / 100).toFixed(2),
        r.dueDate || '', String(r.daysOverdue), r.bucket,
        r.invoiceStatus || '', r.customerEmail || ''
      ]);
    });
    _finDownloadCsv('ar', rows, 'As of ' + (_arData.asOf || todayStr()) + ' · Basis: orders.invoiceDueDate (invoiceStatus IN sent,overdue)');
  };
  h += _finFooter('ar', 'As of ' + (_arData.asOf || todayStr()), 'orders.invoiceDueDate (invoiceStatus IN sent,overdue)');

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

// State-free core (shared with the V2 open-items hub via FinanceBridge).
async function _arMarkPaidCore(orderId, totalCents) {
  var now = new Date().toISOString();
  await MastDB.update('orders/' + orderId, {
    invoiceStatus: 'paid',
    invoicePaidAt: now,
    invoicePaidAmount: totalCents,
    updatedAt: now
  });
}

window.finArMarkPaid = async function(orderId, totalCents) {
  try {
    await _arMarkPaidCore(orderId, totalCents);
    showToast('Invoice marked as paid');
    loadArData();
  } catch (err) {
    showToast('Error: ' + e(err.message), true);
  }
};

// W1.10 (-OtMNJdpUIMpbJcKQAY0): SHA-1 helper for idempotency key.
// Mirrors orders.js _commSha1Hex shape — daily idempotency window so a
// rapid double-click on Send Reminder doesn't queue two emails, but a
// genuine next-day reminder is allowed.
function _finSha1Hex(s) {
  var enc = new TextEncoder().encode(s);
  return crypto.subtle.digest('SHA-1', enc).then(function(buf) {
    var bytes = new Uint8Array(buf);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      if (h.length < 2) h = '0' + h;
      hex += h;
    }
    return hex;
  });
}

// W1.10: queue an AR reminder email. Writes to tenants/{tid}/emailQueue/
// (consumed by processEmailQueue CF — Marketing W3a-send pattern) and logs
// to admin/ar_reminders/. Plain-text body with invoice number + amount due
// + due date + optional pay link placeholder. No cadence config — that's
// deferred to W2.4. Idempotency: same orderId + email + day = same key.
window.finArSendReminder = async function(orderId) {
  if (!_arData || !_arData.rows) { showToast('AR data not loaded', true); return; }
  var row = null;
  for (var i = 0; i < _arData.rows.length; i++) {
    if (_arData.rows[i].orderId === orderId) { row = _arData.rows[i]; break; }
  }
  if (!row) { showToast('Invoice not found', true); return; }
  if (!row.customerEmail || row.customerEmail.indexOf('@') < 1) {
    showToast('No customer email on file for this invoice', true);
    return;
  }
  if (_arReminderState[orderId] === 'sending' || _arReminderState[orderId] === 'sent') return;

  _arReminderState[orderId] = 'sending';
  var el = document.getElementById('fArContent');
  if (el) el.innerHTML = renderArContent();

  try {
    var queued = await _arQueueReminderCore(orderId, row);
    _arReminderState[orderId] = 'sent';
    showToast('Reminder queued for ' + queued.to);
  } catch (err) {
    delete _arReminderState[orderId];
    showToast('Reminder failed: ' + (err && err.message ? err.message : err), true);
  } finally {
    var el2 = document.getElementById('fArContent');
    if (el2) el2.innerHTML = renderArContent();
  }
};

// State-free reminder core — builds + queues the AR reminder email and the
// admin/ar_reminders log row. Shared with the V2 open-items hub. `row` needs:
// customerEmail, customerName, invoiceNumber, amtDue (cents), dueDate,
// daysOverdue. Returns { idempotencyKey, to }.
async function _arQueueReminderCore(orderId, row) {
    var now = new Date().toISOString();
    var ymd = now.slice(0, 10).replace(/-/g, '');
    var brandName = (window.TENANT_CONFIG && window.TENANT_CONFIG.brand && window.TENANT_CONFIG.brand.name) || 'Our Studio';
    var user = firebase.auth().currentUser;
    var sentBy = (user && user.uid) || 'unknown';

    var idemSeed = orderId + '|' + row.customerEmail + '|' + ymd;
    var idempotencyKey = await _finSha1Hex(idemSeed);

    var amountDueStr = fmt$(row.amtDue);
    // MastFormat.dateLong builds LOCAL midnight for a bare 'YYYY-MM-DD' due date, so
    // the date the CUSTOMER sees in the reminder ("was due on June 30, 2026") is the
    // real due date — not a day early, as `+ 'T00:00:00Z'` (UTC midnight) rendered in
    // behind-UTC timezones. Empty/unparseable falls back to "as soon as possible".
    var dueDateStr = MastFormat.dateLong(row.dueDate) || 'as soon as possible';
    var invoiceLabel = row.invoiceNumber ? ('Invoice #' + row.invoiceNumber) : ('Order ' + orderId.slice(-8));
    var ageStr = row.daysOverdue > 0 ? (' (' + MastFormat.countNoun(row.daysOverdue, 'day') + ' overdue)') : '';

    var subject = 'Reminder: ' + invoiceLabel + ' — ' + amountDueStr + ' due';
    var textBody =
      'Hi ' + (row.customerName || 'there') + ',\n\n' +
      'This is a friendly reminder that ' + invoiceLabel + ' for ' + amountDueStr + ' was due on ' + dueDateStr + ageStr + '.\n\n' +
      'If you have already sent payment, please disregard this note. Otherwise, please reach out and we will arrange a pay link.\n\n' +
      'Thanks,\n' + brandName + '\n';
    var htmlBody =
      '<p>Hi ' + e(row.customerName || 'there') + ',</p>' +
      '<p>This is a friendly reminder that <strong>' + e(invoiceLabel) + '</strong> for <strong>' + amountDueStr + '</strong> was due on <strong>' + e(dueDateStr) + '</strong>' + e(ageStr) + '.</p>' +
      '<p>If you have already sent payment, please disregard this note. Otherwise, please reach out and we will arrange a pay link.</p>' +
      '<p>Thanks,<br>' + e(brandName) + '</p>';

    // Per Marketing W3a-send pattern: write to emailQueue with arbitrary
    // emailType — processEmailQueue accepts any string. Tenant-scoped path
    // (MastDB writes under tenants/{tid}/emailQueue/) means no rules widening.
    await MastDB.set('emailQueue/' + idempotencyKey, {
      id: idempotencyKey,
      emailType: 'ar_reminder',
      to: row.customerEmail,
      toName: row.customerName || null,
      subject: subject,
      htmlBody: htmlBody,
      textBody: textBody,
      fromName: brandName,
      idempotencyKey: idempotencyKey,
      queuedAt: now,
      queuedBy: sentBy,
      status: 'queued',
      attemptCount: 0,
      meta: {
        orderId: orderId,
        invoiceNumber: row.invoiceNumber || null,
        amtDueCents: row.amtDue,
        dueDate: row.dueDate || null,
        daysOverdue: row.daysOverdue
      }
    });

    // Local audit log so the user can see reminder history per invoice.
    await MastDB.set('admin/ar_reminders/' + idempotencyKey, {
      invoiceId: orderId,
      invoiceNumber: row.invoiceNumber || null,
      customerEmail: row.customerEmail,
      sentAt: now,
      sentBy: sentBy,
      status: 'queued',
      amtDueCents: row.amtDue,
      idempotencyKey: idempotencyKey
    });

    return { idempotencyKey: idempotencyKey, to: row.customerEmail };
}

// W2 R2-F2 (-OtMNKZ8c0Q3VlhqcaA0): Send Statement per-row action. Mints a
// share-link via the W2.6 mintCustomerStatementToken CF and opens an email
// composer (mailto:) pre-populated with the link. Reuses the W2.6 viewer
// flow that already ships customer-statement.html.
window.finArSendStatement = async function(customerId, customerEmail, customerName) {
  if (!customerId) { showToast('Customer link missing on this invoice', true); return; }
  if (!customerEmail || customerEmail.indexOf('@') < 1) {
    showToast('No customer email on file', true);
    return;
  }
  if (_arStatementState[customerId] === 'sending' || _arStatementState[customerId] === 'sent') return;

  _arStatementState[customerId] = 'sending';
  var el = document.getElementById('fArContent');
  if (el) el.innerHTML = renderArContent();

  try {
    var tenantId = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID || '';
    var brandName = (window.TENANT_CONFIG && window.TENANT_CONFIG.brand && window.TENANT_CONFIG.brand.name) || 'Our Studio';

    var mintFn = firebase.functions().httpsCallable('mintCustomerStatementToken');
    var result = await mintFn({
      tenantId: tenantId,
      customerId: customerId,
      expiresInDays: 30
    });
    var data = (result && result.data) || {};
    var url = data.url || data.shareUrl || data.statementUrl || '';
    if (!url) throw new Error('Mint CF did not return a URL');

    var subject = 'Your account statement from ' + brandName;
    var body =
      'Hi ' + (customerName || 'there') + ',\n\n' +
      'Here is your current account statement:\n\n' +
      url + '\n\n' +
      'This link is valid for 30 days. Please reach out with any questions.\n\n' +
      'Thanks,\n' + brandName + '\n';
    var mailto = 'mailto:' + encodeURIComponent(customerEmail) +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
    // Open the user's email client. window.location works in admin SPA
    // without losing the current view.
    window.location.href = mailto;

    _arStatementState[customerId] = 'sent';
    showToast('Statement link minted for ' + customerEmail);
  } catch (err) {
    delete _arStatementState[customerId];
    showToast('Statement failed: ' + (err && err.message ? err.message : err), true);
  } finally {
    var el2 = document.getElementById('fArContent');
    if (el2) el2.innerHTML = renderArContent();
  }
};

// ── AP Tab ────────────────────────────────────────────────────────────────────

function setupApTab() {
  injectFinancePulseCSS();
  _apFilter = 'all';
  var el = document.getElementById('financeApTab');
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    renderFinancePeriodBar() +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
    '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Accounts Payable</h2>' +
    '<div style="display:flex;gap:8px;">' +
    '<button class="btn btn-primary btn-small" onclick="finApNewVendor()">+ New Vendor</button>' +
    '<button class="btn btn-primary btn-small" onclick="finApNewBill()">+ New Bill</button>' +
    '<button class="btn btn-secondary btn-small" onclick="loadApData()">Refresh</button>' +
    '</div>' +
    '</div>' +
    '<div id="fApContent">' + skeletonCards(5) + '<div style="margin-top:16px;">' + skeletonTable(5,7) + '</div></div>' +
    '</div>';
  // W2.2 sub-view: vendor detail / ledger.
  var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  if (rp && rp.subView === 'vendor' && rp.vendorId) { renderApVendorDetail(rp.vendorId); return; }
  loadApData();
}

async function loadApData() {
  var el = document.getElementById('fApContent');
  if (!el) return;
  el.innerHTML = skeletonCards(5) + '<div style="margin-top:16px;">' + skeletonTable(5,7) + '</div>';
  // W2b.3 — preload QBO conflicts so inline [Conflict] chips render on first paint.
  if (typeof window._qboPreloadConflicts === 'function') {
    try { await window._qboPreloadConflicts(); } catch (_) {}
  }

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

      // W2.2: surface vendorId on row so the vendor name can deep-link to
      // #finance-ap?subView=vendor&vendorId=<id>.
      rows.push({ receiptId, vendorId: r.vendorId || null, vendorName, vendorInvoiceRef: r.vendorInvoiceRef || '', totalCents, paidCents, amtDue, dueDate: r.dueDate || '', daysOverdue: daysOver, bucket, paymentStatus: r.paymentStatus });
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
  h += statCard('Total AP', fmt$(total), '#f97316', MastFormat.countNoun(rows.length, 'receipt'));
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

  // W1 R2-F1: CSV exporter + Period · Basis footer. Mirrors AR pattern.
  _finExporters.ap = function() {
    var rows = [];
    rows.push(['Vendor', 'Invoice Ref', 'Total (USD)', 'Paid (USD)', 'Amount Due (USD)', 'Due Date', 'Days Overdue', 'Bucket', 'Payment Status']);
    filtered.forEach(function(r) {
      rows.push([
        r.vendorName, r.vendorInvoiceRef || r.receiptId,
        (r.totalCents / 100).toFixed(2), (r.paidCents / 100).toFixed(2),
        (r.amtDue / 100).toFixed(2), r.dueDate || '',
        String(r.daysOverdue), r.bucket, r.paymentStatus || ''
      ]);
    });
    _finDownloadCsv('finance-ap', rows, 'As of ' + (_apData.asOf || todayStr()) + ' · Basis: admin/purchaseReceipts.dueDate (paymentStatus IN unpaid,partial)');
  };
  h += _finFooter('finance-ap', 'As of ' + (_apData.asOf || todayStr()), 'admin/purchaseReceipts.dueDate (paymentStatus IN unpaid,partial)');

  return h;
}

function renderApFlat(filtered) {
  // Sortable: apply current sort key/dir to AP rows.
  if (typeof window.mastSortRows === 'function') {
    filtered = window.mastSortRows(filtered, _apSortKey, _apSortDir, function(row, key) {
      if (!row) return null;
      if (key === 'totalCents') return Number(row.totalCents) || 0;
      if (key === 'paidCents') return Number(row.paidCents) || 0;
      if (key === 'amtDue') return Number(row.amtDue) || 0;
      if (key === 'daysOver') return Number(row.daysOverdue) || 0;
      if (key === 'dueDate') return row.dueDate || '';
      if (key === 'status') return row.bucket || '';
      if (key === 'vendorName') return row.vendorName || '';
      return row[key];
    });
  }
  var h = '<div style="overflow-x:auto;">';
  h += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
  if (typeof window.mastSortableTh === 'function') {
    var thStyle = 'font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;padding:8px 10px;';
    h += window.mastSortableTh('Vendor',    'vendorName', _apSortKey, _apSortDir, 'window._apSort', thStyle);
    h += '<th style="text-align:left;padding:8px 10px;' + thStyle + '">Ref</th>';
    h += window.mastSortableTh('Total',     'totalCents',_apSortKey, _apSortDir, 'window._apSort', thStyle);
    h += window.mastSortableTh('Paid',      'paidCents', _apSortKey, _apSortDir, 'window._apSort', thStyle);
    h += window.mastSortableTh('Remaining', 'amtDue',    _apSortKey, _apSortDir, 'window._apSort', thStyle);
    h += window.mastSortableTh('Due Date',  'dueDate',   _apSortKey, _apSortDir, 'window._apSort', thStyle);
    h += window.mastSortableTh('Age',       'daysOver',  _apSortKey, _apSortDir, 'window._apSort', thStyle);
    h += window.mastSortableTh('Status',    'status',    _apSortKey, _apSortDir, 'window._apSort', thStyle);
    h += '<th style="padding:8px 10px;' + thStyle + '"></th>';
  } else {
    ['Vendor','Ref','Total','Paid','Remaining','Due Date','Age','Status',''].forEach(function(col) {
      h += '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">' + col + '</th>';
    });
  }
  h += '</tr></thead><tbody>';

  filtered.forEach(function(r) {
    h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">';
    // W2.2: clickable vendor name → detail
    if (r.vendorId) {
      h += '<td style="padding:10px;font-weight:600;"><a href="javascript:void(0)" onclick="finApOpenVendor(\'' + (window._jsAttr ? window._jsAttr(r.vendorId) : r.vendorId) + '\')" style="color:var(--teal,#2a9d8f);text-decoration:none;">' + e(r.vendorName) + '</a></td>';
    } else {
      h += '<td style="padding:10px;font-weight:600;">' + e(r.vendorName) + '</td>';
    }
    h += '<td style="padding:10px;font-size:0.78rem;color:var(--warm-gray,#888);">' + e(r.vendorInvoiceRef || r.receiptId.slice(-8)) + '</td>';
    h += '<td style="padding:10px;">' + fmt$(r.totalCents) + '</td>';
    h += '<td style="padding:10px;color:#22c55e;">' + fmt$(r.paidCents) + '</td>';
    h += '<td style="padding:10px;font-weight:700;color:' + bucketColor(r.bucket) + ';">' + fmt$(r.amtDue) + '</td>';
    h += '<td style="padding:10px;font-size:0.78rem;">' + e(r.dueDate ? MastFormat.date(r.dueDate) : '—') + '</td>';
    h += '<td style="padding:10px;">' + agingBadge(r.daysOverdue) + '</td>';
    // W2b.3 — inline [Conflict] chip when this bill has an unresolved QBO
    // conflict (entityType='bill'). receiptId is the mast-side id.
    var apConflict = (typeof window._qboFindConflict === 'function') ? window._qboFindConflict('bill', r.receiptId) : null;
    var apConflictChip = apConflict
      ? ' <button class="btn btn-danger" style="font-size:0.72rem;padding:1px 6px;margin-left:4px;" onclick="window.openQboConflictModal(\'' + _jsAttrSafe(apConflict.conflictId || '') + '\')" title="QBO has different values for this bill — click to resolve">⚠ Conflict</button>'
      : '';
    h += '<td style="padding:10px;"><span style="background:' + (r.paymentStatus === 'partial' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.12)') + ';color:' + (r.paymentStatus === 'partial' ? '#eab308' : '#ef4444') + ';padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + e(r.paymentStatus) + '</span>' + apConflictChip + '</td>';
    h += '<td style="padding:10px;white-space:nowrap;display:flex;gap:4px;">';
    h += '<button class="btn btn-primary btn-small" data-rid="' + e(r.receiptId) + '" data-total="' + r.totalCents + '" onclick="finApMarkPaid(this.dataset.rid, parseInt(this.dataset.total))">Paid</button>';
    h += '<button class="btn btn-secondary btn-small" data-rid="' + e(r.receiptId) + '" data-paid="' + r.paidCents + '" data-total="' + r.totalCents + '" onclick="finApShowPartial(this.dataset.rid, parseInt(this.dataset.paid), parseInt(this.dataset.total))">Partial</button>';
    // W2.2: inline edit
    h += '<button class="btn btn-secondary btn-small" data-rid="' + e(r.receiptId) + '" onclick="finApNewBill(this.dataset.rid)" title="Edit bill">✎</button>';
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
    var dueDateStr = g.oldestDueDate ? MastFormat.date(g.oldestDueDate) : '—';

    h += '<div style="border:1px solid rgba(255,255,255,0.1);border-radius:8px;overflow:hidden;">';

    // Vendor summary row (clickable)
    h += '<button type="button" onclick="finApToggleVendorExpand(' + JSON.stringify(k) + ')" ' +
      'style="all:unset;display:block;width:100%;box-sizing:border-box;cursor:pointer;' +
      'background:var(--bg-secondary,#232323);padding:12px 14px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;font-size:0.85rem;">';
    h += '<div style="display:flex;align-items:center;gap:10px;">';
    h += '<span style="font-weight:700;">' + e(g.vendorName) + '</span>';
    h += agingBadge(g.worstBucket === 'current' ? 0 : g.worstBucket === '1_to_30' ? 15 : g.worstBucket === '31_to_60' ? 45 : g.worstBucket === '61_to_90' ? 75 : 100);
    h += '<span style="color:var(--warm-gray,#888);font-size:0.78rem;">' + MastFormat.countNoun(g.rows.length, 'receipt') + '</span>';
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
        h += '<td style="padding:8px 10px;">' + e(r.dueDate ? MastFormat.date(r.dueDate) : '—') + '</td>';
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

// State-free AP cores (shared with the V2 open-items hub via FinanceBridge).
async function _apMarkPaidCore(receiptId, totalCents) {
  await MastDB.update('admin/purchaseReceipts/' + receiptId, {
    paymentStatus: 'paid',
    paidAmount: totalCents,
    updatedAt: new Date().toISOString()
  });
}
// addedCents on top of currentPaid; returns the new status. Throws on overpay.
async function _apRecordPaymentCore(receiptId, currentPaid, totalCents, addedCents) {
  var newPaid = (currentPaid || 0) + addedCents;
  if (addedCents <= 0) throw new Error('Payment must be > 0');
  if (newPaid > totalCents) throw new Error('Payment exceeds balance due');
  var newStatus = newPaid >= totalCents ? 'paid' : 'partial';
  await MastDB.update('admin/purchaseReceipts/' + receiptId, {
    paymentStatus: newStatus,
    paidAmount: newPaid,
    updatedAt: new Date().toISOString()
  });
  return newStatus;
}

window.finApMarkPaid = async function(receiptId, totalCents) {
  try {
    await _apMarkPaidCore(receiptId, totalCents);
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
  try {
    var newStatus = await _apRecordPaymentCore(receiptId, currentPaid, totalCents, addedCents);
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

// ── W2.2: Vendor + Bill CRUD ─────────────────────────────────────────────────
// Vendors at admin/vendors/{id} → tenants/{tid}/vendors/{id} after MastDB
// strips the prefix. Bills at admin/purchaseReceipts/{id} → tenants/{tid}/
// purchaseReceipts/{id}. Both writes respect existing rules (admin-only).

function _finOpenModal(title, bodyHtml) {
  var existing = document.getElementById('finW22Modal');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'finW22Modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:20px;max-width:520px;width:100%;max-height:90vh;overflow:auto;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
    '<div style="font-size:1rem;font-weight:700;">' + e(title) + '</div>' +
    '<button class="btn btn-secondary btn-small" onclick="finCloseModal()">✕</button>' +
    '</div>' +
    bodyHtml +
    '</div>';
  overlay.onclick = function() { _finCloseModal(); };
  document.body.appendChild(overlay);
}
function _finCloseModal() {
  var m = document.getElementById('finW22Modal');
  if (m) m.remove();
}
window.finCloseModal = _finCloseModal;

window.finApNewVendor = function(presetId) {
  var isEdit = !!presetId;
  // The Tax ID (EIN/SSN) is structured PII, now encrypted at rest via MastIntake
  // (identity-data). Load the provider catalog up front so the secure field renders
  // + hydrates inline (fail-closed: if it can't load, host() degrades gracefully).
  var ensureProviders = (window.MastAdmin && typeof MastAdmin.loadModule === 'function')
    ? Promise.resolve(MastAdmin.loadModule('connections-providers')).catch(function() {})
    : Promise.resolve();
  // Pre-populate on edit
  Promise.all([
    isEdit ? MastDB.get('admin/vendors/' + presetId) : Promise.resolve({}),
    ensureProviders
  ]).then(function(res) {
    var v = res[0] || {};
    // Secure field needs a saved vendor (stable id for the ref). On a new vendor it
    // prompts to save first; on edit it hosts the encrypted Tax ID for this record.
    // The host owns its own label + counsel, so it is emitted bare (no outer label).
    var taxIdHost = (window.VendorSecureId)
      ? '<div>' + window.VendorSecureId.host(isEdit ? presetId : null, 'taxId', v) + '</div>'
      : '';
    var body =
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
      _fInput('vName', 'Name *', v.name || '') +
      _fInput('vEmail', 'Email', v.email || '') +
      taxIdHost +
      _fSelect('vVendorType', 'Vendor Type', [['', '— Select —'], ['supplier', 'Supplier'], ['contractor', 'Contractor'], ['utility', 'Utility'], ['other', 'Other']], v.vendorType || v.payeeType || '') +
      _fInput('vPhone', 'Phone', v.phone || '') +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
      (isEdit ? '<button class="btn btn-secondary btn-small" onclick="finApDeleteVendor(\'' + (window._jsAttr ? window._jsAttr(presetId) : presetId) + '\')">Delete</button>' : '') +
      '<button class="btn btn-secondary btn-small" onclick="finCloseModal()">Cancel</button>' +
      '<button class="btn btn-primary btn-small" onclick="finApSaveVendor(' + (isEdit ? '\'' + (window._jsAttr ? window._jsAttr(presetId) : presetId) + '\'' : 'null') + ')">' + (isEdit ? 'Save' : 'Create Vendor') + '</button>' +
      '</div></div>';
    _finOpenModal(isEdit ? 'Edit Vendor' : 'New Vendor', body);
    // Bind/hydrate the secure Tax ID field (runs the fail-closed availability probe).
    if (window.MastIntake && typeof MastIntake.hydrate === 'function') {
      var modal = document.getElementById('finW22Modal');
      try { MastIntake.hydrate(modal || undefined); } catch (e) { /* fail-closed */ }
    }
  });
};

function _fInput(id, label, val, type) {
  return '<label style="display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--warm-gray,#888);">' + e(label) +
    '<input type="' + (type || 'text') + '" id="' + id + '" value="' + e(val || '') + '" style="background:var(--bg-secondary,#232323);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:7px 10px;font-size:0.85rem;">' +
    '</label>';
}
function _fSelect(id, label, opts, selVal) {
  var optHtml = '';
  opts.forEach(function(kv) {
    var v = kv[0], l = kv[1];
    optHtml += '<option value="' + e(v) + '"' + (v === selVal ? ' selected' : '') + '>' + e(l) + '</option>';
  });
  return '<label style="display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--warm-gray,#888);">' + e(label) +
    '<select id="' + id + '" style="background:var(--bg-secondary,#232323);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:7px 10px;font-size:0.85rem;">' + optHtml + '</select>' +
    '</label>';
}

window.finApSaveVendor = async function(vendorId) {
  var name = (document.getElementById('vName') || {}).value;
  if (!name || !name.trim()) { showToast('Name is required', true); return; }
  var now = new Date().toISOString();
  var payload = {
    name: name.trim(),
    email: ((document.getElementById('vEmail') || {}).value || '').trim() || null,
    // taxId (EIN/SSN) is no longer written here — it is encrypted at rest via the
    // MastIntake secure field, which persists taxIdRef/taxIdMasked on its own.
    vendorType: ((document.getElementById('vVendorType') || {}).value || '').trim() || null,
    phone: ((document.getElementById('vPhone') || {}).value || '').trim() || null,
    updatedAt: now
  };
  try {
    await _apSaveVendorCore(vendorId, payload);
    showToast(vendorId ? 'Vendor updated' : 'Vendor created');
    _finCloseModal();
    loadApData();
  } catch (err) {
    showToast('Save failed: ' + (err.message || err), true);
  }
};

// State-free vendor save core (CENTS-free record; payload is DB-shaped).
async function _apSaveVendorCore(vendorId, payload) {
  payload.updatedAt = payload.updatedAt || new Date().toISOString();
  if (!vendorId) {
    var id = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    payload.id = id; payload.createdAt = payload.updatedAt;
    await MastDB.set('admin/vendors/' + id, payload);
    return id;
  }
  await MastDB.update('admin/vendors/' + vendorId, payload);
  return vendorId;
}

window.finApDeleteVendor = async function(vendorId) {
  if (!vendorId) return;
  if (!window.confirm('Delete this vendor? Existing bills will be orphaned (their vendorId reference will dangle).')) return;
  try {
    await _apDeleteVendorCore(vendorId);
    showToast('Vendor deleted');
    _finCloseModal();
    // Navigate away from vendor detail to AP list.
    location.hash = '#finance-ap';
  } catch (err) {
    showToast('Delete failed: ' + (err.message || err), true);
  }
};

window.finApNewBill = function(presetBillId) {
  var isEdit = !!presetBillId;
  Promise.all([
    MastDB.get('admin/vendors'),
    isEdit ? MastDB.get('admin/purchaseReceipts/' + presetBillId) : Promise.resolve({})
  ]).then(function(results) {
    var vendors = results[0] || {};
    var bill = results[1] || {};
    var vendorOpts = [['', '— Choose vendor —']];
    Object.entries(vendors).forEach(function(kv) {
      var vid = kv[0], v = kv[1] || {};
      vendorOpts.push([vid, v.name || '(no name)']);
    });
    var body =
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
      _fSelect('bVendor', 'Vendor *', vendorOpts, bill.vendorId || '') +
      _fInput('bRef', 'Invoice Ref / PO #', bill.vendorInvoiceRef || '') +
      _fInput('bAmount', 'Amount (USD) *', bill.amountCents ? (bill.amountCents / 100).toFixed(2) : '', 'number') +
      _fInput('bReceivedAt', 'Received Date *', (bill.receivedAt || new Date().toISOString()).slice(0, 10), 'date') +
      _fInput('bDueDate', 'Due Date', (bill.dueDate || ''), 'date') +
      _fSelect('bStatus', 'Status', [['unpaid', 'Unpaid'], ['partial', 'Partially Paid'], ['paid', 'Paid']], bill.paymentStatus || 'unpaid') +
      '<label style="display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--warm-gray,#888);">Notes' +
      '<textarea id="bNotes" rows="2" style="background:var(--bg-secondary,#232323);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:7px 10px;font-size:0.85rem;font-family:inherit;">' + e(bill.notes || '') + '</textarea>' +
      '</label>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
      (isEdit ? '<button class="btn btn-secondary btn-small" onclick="finApDeleteBill(\'' + (window._jsAttr ? window._jsAttr(presetBillId) : presetBillId) + '\')">Delete</button>' : '') +
      '<button class="btn btn-secondary btn-small" onclick="finCloseModal()">Cancel</button>' +
      '<button class="btn btn-primary btn-small" onclick="finApSaveBill(' + (isEdit ? '\'' + (window._jsAttr ? window._jsAttr(presetBillId) : presetBillId) + '\'' : 'null') + ')">' + (isEdit ? 'Save' : 'Create Bill') + '</button>' +
      '</div></div>';
    _finOpenModal(isEdit ? 'Edit Bill' : 'New Bill', body);
  });
};

window.finApSaveBill = async function(billId) {
  var vendorId = (document.getElementById('bVendor') || {}).value;
  if (!vendorId) { showToast('Pick a vendor', true); return; }
  var amount = parseFloat((document.getElementById('bAmount') || {}).value);
  if (isNaN(amount) || amount <= 0) { showToast('Amount must be > 0', true); return; }
  var receivedAt = (document.getElementById('bReceivedAt') || {}).value;
  if (!receivedAt) { showToast('Received date required', true); return; }
  var amountCents = Math.round(amount * 100);
  var now = new Date().toISOString();
  var status = (document.getElementById('bStatus') || {}).value || 'unpaid';
  var payload = {
    vendorId: vendorId,
    vendorInvoiceRef: ((document.getElementById('bRef') || {}).value || '').trim() || null,
    amountCents: amountCents,
    receivedAt: receivedAt + 'T00:00:00Z',
    dueDate: ((document.getElementById('bDueDate') || {}).value || '').trim() || null,
    paymentStatus: status,
    notes: ((document.getElementById('bNotes') || {}).value || '').trim() || null,
    updatedAt: now
  };
  if (status === 'paid') payload.paidAmount = amountCents;
  else if (status !== 'partial') payload.paidAmount = 0;
  try {
    await _apSaveBillCore(billId, payload);
    showToast(billId ? 'Bill updated' : 'Bill created');
    _finCloseModal();
    loadApData();
  } catch (err) {
    showToast('Save failed: ' + (err.message || err), true);
  }
};

// State-free bill save core — payload is the validated, DB-shaped record
// (amountCents/paidAmount in CENTS). Mints the id on create, fires the
// best-effort QBO push on both paths. Returns the bill id.
async function _apSaveBillCore(billId, payload) {
  payload.updatedAt = payload.updatedAt || new Date().toISOString();
  if (!billId) {
    var id = 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    payload.id = id; payload.createdAt = payload.updatedAt;
    await MastDB.set('admin/purchaseReceipts/' + id, payload);
    _firTriggerQboPush('apBill', id);
    return id;
  }
  await MastDB.update('admin/purchaseReceipts/' + billId, payload);
  _firTriggerQboPush('apBill', billId);
  return billId;
}

window.finApDeleteBill = async function(billId) {
  if (!billId) return;
  if (!window.confirm('Delete this bill?')) return;
  try {
    await _apDeleteBillCore(billId);
    showToast('Bill deleted');
    _finCloseModal();
    loadApData();
  } catch (err) {
    showToast('Delete failed: ' + (err.message || err), true);
  }
};

// W2.2 vendor detail / ledger sub-view at #finance-ap?subView=vendor&vendorId=<id>
async function renderApVendorDetail(vendorId) {
  var el = document.getElementById('fApContent');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--warm-gray,#888);padding:30px;text-align:center;">Loading vendor…</div>';
  try {
    var [vendor, allReceiptsRaw] = await Promise.all([
      MastDB.get('admin/vendors/' + vendorId),
      MastDB.get('admin/purchaseReceipts')
    ]);
    if (!vendor) {
      el.innerHTML = '<div style="padding:20px;"><a href="#finance-ap" style="color:var(--teal,#2a9d8f);">&larr; Back to AP</a><div style="margin-top:12px;color:var(--danger,#dc2626);">Vendor not found.</div></div>';
      return;
    }
    var receipts = Object.entries(allReceiptsRaw || {})
      .map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); })
      .filter(function(r) { return r && r.vendorId === vendorId; })
      .sort(function(a, b) { return (b.receivedAt || '').localeCompare(a.receivedAt || ''); });

    var totalBilled = 0, totalPaid = 0, totalDue = 0;
    receipts.forEach(function(r) {
      var amt = r.amountCents || 0;
      var paid = r.paidAmount || 0;
      totalBilled += amt;
      totalPaid += paid;
      totalDue += Math.max(0, amt - paid);
    });

    var h = '<div style="padding:20px;max-width:1100px;">';
    h += '<a href="#finance-ap" style="color:var(--teal,#2a9d8f);font-size:0.85rem;text-decoration:none;">&larr; All vendors</a>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 16px 0;">';
    h += '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">' + e(vendor.name || 'Vendor') + '</h2>';
    h += '<div style="display:flex;gap:6px;">';
    h += '<button class="btn btn-secondary btn-small" onclick="finApNewVendor(\'' + (window._jsAttr ? window._jsAttr(vendorId) : vendorId) + '\')">Edit Vendor</button>';
    h += '<button class="btn btn-primary btn-small" onclick="finApNewBill()">+ New Bill</button>';
    h += '</div></div>';

    // Vendor info card
    h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:14px;margin-bottom:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;">';
    h += '<div><div style="font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">Type</div><div style="font-size:0.9rem;margin-top:3px;">' + e((vendor.vendorType || vendor.payeeType || '—').replace(/^\w/, function(c) { return c.toUpperCase(); })) + '</div></div>';
    h += '<div><div style="font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">Email</div><div style="font-size:0.9rem;margin-top:3px;">' + e(vendor.email || '—') + '</div></div>';
    h += '<div><div style="font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">Phone</div><div style="font-size:0.9rem;margin-top:3px;">' + e(vendor.phone || '—') + '</div></div>';
    h += '<div><div style="font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">Tax ID</div><div style="font-size:0.9rem;margin-top:3px;">' + (_vendorHasTaxId(vendor) ? e(_vendorTaxMask(vendor)) : '—') + '</div></div>';
    h += '</div>';

    // Summary
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">';
    h += statCard('Lifetime Billed', fmt$(totalBilled), 'var(--text,#fff)', MastFormat.countNoun(receipts.length, 'bill'));
    h += statCard('Paid', fmt$(totalPaid), '#22c55e');
    h += statCard('Outstanding', fmt$(totalDue), totalDue > 0 ? '#f97316' : '#22c55e');
    h += '</div>';

    // Ledger
    if (receipts.length === 0) {
      h += '<div style="text-align:center;padding:30px;color:var(--warm-gray,#888);">No bills for this vendor yet.</div>';
    } else {
      h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
      h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
      ['Received','Invoice Ref','Amount','Paid','Status','Due Date',''].forEach(function(col) {
        h += '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">' + col + '</th>';
      });
      h += '</tr></thead><tbody>';
      receipts.forEach(function(r) {
        h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">';
        h += '<td style="padding:8px 10px;">' + e((r.receivedAt || '').slice(0, 10)) + '</td>';
        h += '<td style="padding:8px 10px;">' + e(r.vendorInvoiceRef || r._id.slice(-8)) + '</td>';
        h += '<td style="padding:8px 10px;font-weight:600;">' + fmt$(r.amountCents || 0) + '</td>';
        h += '<td style="padding:8px 10px;">' + fmt$(r.paidAmount || 0) + '</td>';
        h += '<td style="padding:8px 10px;font-size:0.78rem;">' + e(r.paymentStatus || '—') + '</td>';
        h += '<td style="padding:8px 10px;font-size:0.78rem;">' + e(r.dueDate || '—') + '</td>';
        h += '<td style="padding:8px 10px;"><button class="btn btn-secondary btn-small" onclick="finApNewBill(\'' + (window._jsAttr ? window._jsAttr(r._id) : r._id) + '\')">Edit</button></td>';
        h += '</tr>';
      });
      h += '</tbody></table></div>';
    }

    h += _finFooter('finance-ap-vendor', 'Vendor ledger · all-time', 'admin/purchaseReceipts where vendorId === ' + vendorId);
    h += '</div>';

    el.innerHTML = h;
  } catch (err) {
    el.innerHTML = '<div style="padding:20px;color:var(--danger,#dc2626);">Failed to load vendor: ' + e(err.message || String(err)) + '</div>';
  }
}

// Also wire vendor name in flat/grouped AP list to navigate into detail.
// We patch renderApFlat/renderApGrouped onclick via a delegated helper; the
// simpler approach is a top-level handler that intercepts vendor-name clicks.
window.finApOpenVendor = function(vendorId) {
  if (!vendorId) return;
  location.hash = '#finance-ap?subView=vendor&vendorId=' + encodeURIComponent(vendorId);
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
  el.innerHTML = '<div style="padding:20px;max-width:1100px;">' + renderFinancePeriodBar() + renderTaxHeader() +
    '<div id="fTaxContent">' + skeletonTable(5,4) + '</div></div>';
  loadTaxSalesTax();
}

window.taxSection = function(section) {
  _taxSection = section;
  var el = document.getElementById('financeTaxTab');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;max-width:1100px;">' + renderFinancePeriodBar() + renderTaxHeader() +
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
    var tax = await _computeTaxByState(start, end);
    el.innerHTML = renderTaxSalesTax(tax.byState, tax.nexus, start, end, tax.missingStateOrders);
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Tax load failed: ' + err.message, true);
  }
}
window.loadTaxSalesTaxData = loadTaxSalesTaxData;

// State-free sales-tax-by-state core — shared by the legacy Tax tab and the
// V2 statements hub (FinanceBridge.taxByState). Dual-field tax read:
// `taxCents` (CENTS) preferred, legacy `tax` is DOLLARS × 100.
async function _computeTaxByState(start, end) {
  var [ordersRaw, nexusRaw] = await Promise.all([
    MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(start)).endAt(isoEnd(end)).limitToLast(2000).once(),
    MastDB.get('admin/nexusRegistrations')
  ]);
  var byState = {};
  var missingStateOrders = [];
  var ordersObj = ordersRaw || {};
  Object.keys(ordersObj).forEach(function(id) {
    var o = ordersObj[id]; if (!o) return;
    if (o.status === 'cancelled') return;
    var state = o.taxState || o.shippingState;
    if (!state) {
      // Don't silently drop: a stateless taxable order is an under-reported
      // sales-tax + nexus liability. Surface it for operator backfill instead.
      missingStateOrders.push({ id: id, order: o });
      return;
    }
    if (!byState[state]) byState[state] = { taxCollected: 0, orderCount: 0 };
    byState[state].taxCollected += (o.taxCents || Math.round((o.tax || 0) * 100));
    byState[state].orderCount++;
  });
  return { byState: byState, nexus: nexusRaw || {}, missingStateOrders: missingStateOrders };
}

// W6 F5: stateless-order triage. Lists orders excluded from sales-tax/nexus for
// lack of a jurisdiction, with an inline backfill. POS now captures this at sale
// time; this catches historical + phone/manual/import orders.
function _renderMissingStateTriage(missingStateOrders) {
  var list = missingStateOrders || [];
  if (!list.length) return '';
  function _cents(o) { return (typeof _orderRevenueCents === 'function') ? _orderRevenueCents(o) : (o.totalCents || Math.round((o.total || 0) * 100)); }
  var total = 0;
  var rows = list.map(function(m) {
    var o = m.order || {};
    total += _cents(o);
    var num = window.getOrderDisplayNumber ? window.getOrderDisplayNumber(o) : (o.orderNumber || m.id);
    var chLabel = (window.MastChannels && o.source) ? window.MastChannels.label(window.MastChannels.normalize(o.source)) : (o.source || '—');
    var when = o.placedAt ? toDateShort(String(o.placedAt).slice(0, 10)) : '—';
    var inputId = 'finBackfillState_' + m.id;
    return '<tr>' +
      '<td style="padding:6px 8px;">' + e(String(num)) + '</td>' +
      '<td style="padding:6px 8px;">' + e(chLabel) + '</td>' +
      '<td style="padding:6px 8px;color:var(--warm-gray);">' + e(when) + '</td>' +
      '<td style="padding:6px 8px;text-align:right;">' + fmt$(_cents(o)) + '</td>' +
      '<td style="padding:6px 8px;white-space:nowrap;">' +
        '<input id="' + inputId + '" maxlength="2" placeholder="ST" oninput="this.value=this.value.toUpperCase()" style="width:46px;padding:4px 6px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.78rem;">' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;" onclick="finBackfillOrderState(\'' + e(m.id) + '\',\'' + inputId + '\')">Save</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  return '<div style="border:1px solid var(--amber);background:rgba(196,133,60,0.10);border-radius:10px;padding:14px 16px;margin-bottom:20px;">' +
    '<div style="font-weight:600;color:var(--amber);margin-bottom:4px;">⚠️ ' + MastFormat.countNoun(list.length, 'order') + ' missing a tax jurisdiction (' + fmt$(total) + ')</div>' +
    '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:10px;">Excluded from the sales-tax and nexus figures above — set the state where each sale occurred to include it. POS sales now capture this automatically.</div>' +
    '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.78rem;">' +
      '<thead><tr style="text-align:left;color:var(--warm-gray);"><th style="padding:6px 8px;">Order</th><th style="padding:6px 8px;">Channel</th><th style="padding:6px 8px;">Date</th><th style="padding:6px 8px;text-align:right;">Total</th><th style="padding:6px 8px;">Jurisdiction</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>' +
  '</div>';
}

// Backfill a missing jurisdiction onto an order, then refresh the view.
window.finBackfillOrderState = function(orderId, inputId) {
  var el = document.getElementById(inputId);
  var st = el ? String(el.value || '').trim().toUpperCase() : '';
  if (!/^[A-Z]{2}$/.test(st)) { showToast('Enter a 2-letter state code (e.g. MA)', true); return; }
  MastDB.update('orders/' + orderId, { taxState: st }).then(function() {
    showToast('Jurisdiction set to ' + st);
    if (typeof loadTaxSalesTaxData === 'function') loadTaxSalesTaxData();
  }).catch(function(err) {
    showToast('Backfill failed: ' + (err && err.message ? err.message : err), true);
  });
};

function renderTaxSalesTax(byState, nexus, start, end, missingStateOrders) {
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

  // W6 F5: stateless orders are excluded from every figure above — surface them.
  h += _renderMissingStateTriage(missingStateOrders);

  // W1 R2-F3: register exporter early so footer button works even on empty state.
  _finExporters['finance-tax-sales'] = function() {
    var rows = [['State','Nexus Status','Tax Collected (USD)','Orders']];
    states.forEach(function(s) {
      var reg = nexus[s] && nexus[s].registered;
      rows.push([s, reg ? 'Registered' : 'Not Registered', (byState[s].taxCollected / 100).toFixed(2), String(byState[s].orderCount)]);
    });
    _finDownloadCsv('finance-tax-sales', rows, 'Period: ' + start + ' to ' + end + ' · Basis: orders.placedAt + orders.taxState/shippingState + admin/nexusRegistrations');
  };
  var _taxSalesFooter = _finFooter('finance-tax-sales', start + ' to ' + end, 'orders.placedAt + orders.taxState/shippingState + admin/nexusRegistrations');

  if (states.length === 0) {
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
      '<div style="font-size:1.6rem;margin-bottom:8px;">🧾</div>' +
      '<div style="font-size:0.9rem;font-weight:500;">No taxable orders in this period</div></div>' +
      _taxSalesFooter;
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
  h += _taxSalesFooter;
  return h;
}

// W2.5 (-OtMNKRrTLDvUa9Fv1wN): per-state economic nexus thresholds.
// Replaces single national $100K/200tx rule with per-state map. Conservative
// defaults — verify at Avalara state-by-state economic-nexus guide before
// relying on these for filing decisions. State legislatures revise periodically.
// Tenant override stored at admin/config/taxNexusThresholds (5-segment doc).
// Shape: { 'CA': { revenueCents:50000000, txnCount:null }, ... default applies
// to any state not listed }.
var _W25_DEFAULT_NEXUS_THRESHOLDS = {
  CA: { revenueCents: 50000000, txnCount: null },              // $500K, no txn floor (per Avalara, post-AB147)
  NY: { revenueCents: 50000000, txnCount: 100 },               // $500K + 100 txn (both required)
  TX: { revenueCents: 50000000, txnCount: null },              // $500K
  FL: { revenueCents: 10000000, txnCount: null },              // $100K
  WA: { revenueCents: 10000000, txnCount: 200 },               // $100K + 200 txn (legacy)
  __default: { revenueCents: 10000000, txnCount: 200 }         // pre-W2.5 national rule
};
function _W25_resolveThreshold(state, overrides) {
  var ov = (overrides && overrides[state]) || null;
  if (ov && (ov.revenueCents != null || ov.txnCount != null)) return ov;
  if (_W25_DEFAULT_NEXUS_THRESHOLDS[state]) return _W25_DEFAULT_NEXUS_THRESHOLDS[state];
  return (overrides && overrides.__default) || _W25_DEFAULT_NEXUS_THRESHOLDS.__default;
}
// Approaches-trigger ranking: how close (0-1) the state is to crossing.
// Uses the lesser of the two threshold ratios (whichever ceiling is nearer).
function _W25_proximity(stateData, thresh) {
  var revRatio = thresh.revenueCents ? (stateData.revenue / thresh.revenueCents) : 0;
  var txnRatio = thresh.txnCount ? (stateData.count / thresh.txnCount) : 0;
  return Math.max(revRatio, txnRatio);
}

async function loadTaxNexus() {
  var el = document.getElementById('fTaxContent');
  if (!el) return;
  el.innerHTML = skeletonCards(3) + '<div style="margin-top:16px;">' + skeletonTable(5,5) + '</div>';
  try {
    var endDate = todayStr();
    var d12 = new Date(); d12.setFullYear(d12.getFullYear() - 1);
    var startDate = d12.getFullYear() + '-' + String(d12.getMonth()+1).padStart(2,'0') + '-01';

    var [ordersRaw, nexusRaw, overridesRaw] = await Promise.all([
      MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(startDate)).endAt(isoEnd(endDate)).limitToLast(5000).once(),
      MastDB.get('admin/nexusRegistrations'),
      MastDB.get('admin/config/taxNexusThresholds').catch(function() { return null; })
    ]);
    var orders = Object.values(ordersRaw || {});
    var nexus = nexusRaw || {};
    var overrides = overridesRaw || {};

    var byState = {};
    orders.forEach(function(o) {
      if (o.status === 'cancelled') return;
      var state = o.taxState || o.shippingState; if (!state) return;
      var cents = _orderRevenueCents(o);
      if (!byState[state]) byState[state] = { revenue: 0, count: 0 };
      byState[state].revenue += cents;
      byState[state].count++;
    });
    Object.keys(nexus).forEach(function(s) { if (!byState[s]) byState[s] = { revenue: 0, count: 0 }; });
    // W2.5: sort by proximity to trigger (closest first) — operator's most
    // actionable signal, vs. raw revenue sort which buried near-trigger states.
    var states = Object.keys(byState).sort(function(a, b) {
      var pa = _W25_proximity(byState[a], _W25_resolveThreshold(a, overrides));
      var pb = _W25_proximity(byState[b], _W25_resolveThreshold(b, overrides));
      return pb - pa;
    });
    el.innerHTML = renderTaxNexus(states, byState, nexus, overrides, startDate, endDate);
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message) + '</div>';
    showToast('Nexus load failed: ' + err.message, true);
  }
}

function renderTaxNexus(states, byState, nexus, overrides, startDate, endDate) {
  // W2.5: per-state thresholds replace single national rule.
  var approachingPct = 0.75;
  var actionRequired = [], approaching = [], registered = [], below = [];
  states.forEach(function(state) {
    var d = byState[state];
    var reg = nexus[state] && nexus[state].registered;
    var t = _W25_resolveThreshold(state, overrides);
    var above = (t.revenueCents && d.revenue > t.revenueCents) || (t.txnCount && d.count > t.txnCount);
    var near = !above && (
      (t.revenueCents && d.revenue > t.revenueCents * approachingPct) ||
      (t.txnCount && d.count > t.txnCount * approachingPct)
    );
    if (above && !reg) actionRequired.push(state);
    else if (reg) registered.push(state);
    else if (near) approaching.push(state);
    else below.push(state);
  });

  var h = '';
  if (actionRequired.length > 0) {
    h += '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;padding:10px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">';
    h += '<span>⚠️</span><span style="font-size:0.85rem;font-weight:600;color:#ef4444;">Action required — you have nexus in ';
    h += MastFormat.countNoun(actionRequired.length, 'state') + ' where you are not registered: ' + e(actionRequired.join(', ')) + '</span></div>';
  }

  h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">';
  h += statCard('Registered', String(registered.length), '#22c55e');
  if (actionRequired.length > 0) h += statCard('Action Required', String(actionRequired.length), '#ef4444', 'above threshold, unregistered');
  if (approaching.length > 0) h += statCard('Approaching', String(approaching.length), '#eab308', '>75% of per-state threshold');
  h += statCard('Trailing 12mo', toDateShort(startDate) + ' – ' + toDateShort(endDate), 'var(--warm-gray,#888)');
  h += '</div>';

  // W1 R2-F3: register exporter early so footer button works on empty state too.
  // W2.5: per-state thresholds in CSV — most-actionable status (closest to trigger).
  _finExporters['finance-tax-nexus'] = function() {
    var rows = [['State','Revenue 12mo (USD)','Transactions','Revenue Threshold (USD)','Txn Threshold','% to Trigger','Status']];
    states.forEach(function(s) {
      var d = byState[s];
      var t = _W25_resolveThreshold(s, overrides);
      var reg = nexus[s] && nexus[s].registered;
      var above = (t.revenueCents && d.revenue > t.revenueCents) || (t.txnCount && d.count > t.txnCount);
      var status = reg ? 'Registered' : above ? 'Above threshold' : 'Below';
      var prox = _W25_proximity(d, t);
      rows.push([
        s, (d.revenue / 100).toFixed(2), String(d.count),
        t.revenueCents ? (t.revenueCents / 100).toFixed(0) : '',
        t.txnCount != null ? String(t.txnCount) : '',
        String(Math.round(prox * 100)), status
      ]);
    });
    _finDownloadCsv('finance-tax-nexus', rows, 'Period: trailing-12m (' + startDate + ' to ' + endDate + ') · Per-state thresholds · Basis: orders.placedAt by state + admin/nexusRegistrations + admin/config/taxNexusThresholds');
  };
  var _taxNexusFooter = _finFooter('finance-tax-nexus', 'trailing-12m (' + startDate + ' to ' + endDate + ')', 'orders.placedAt by state + admin/nexusRegistrations + admin/config/taxNexusThresholds (per-state)');

  if (states.length === 0) {
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);"><div style="font-size:0.9rem;font-weight:500;">No sales data found for trailing 12 months</div></div>' + _taxNexusFooter;
  }

  // W2.5: thresholds vary per state — show that explicitly.
  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:10px;">Per-state economic-nexus thresholds (CA/TX/NY $500K · FL $100K · WA $100K+200tx · default $100K+200tx). Sorted by closest to trigger. Tenant override: <code style="background:var(--bg-secondary,#232323);padding:1px 4px;border-radius:3px;">admin/config/taxNexusThresholds</code>. Verify at avalara.com state-by-state guide before filing.</div>';
  h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">';
  ['State', 'Revenue (12mo)', 'Transactions', 'Threshold', '% to Trigger', 'Status'].forEach(function(col) {
    h += '<th style="text-align:left;padding:8px 10px;font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">' + col + '</th>';
  });
  h += '</tr></thead><tbody>';
  states.forEach(function(state) {
    var d = byState[state];
    var t = _W25_resolveThreshold(state, overrides);
    var reg = nexus[state] && nexus[state].registered;
    var above = (t.revenueCents && d.revenue > t.revenueCents) || (t.txnCount && d.count > t.txnCount);
    var near = !above && (
      (t.revenueCents && d.revenue > t.revenueCents * approachingPct) ||
      (t.txnCount && d.count > t.txnCount * approachingPct)
    );
    var prox = _W25_proximity(d, t);
    var pct = Math.min(Math.round(prox * 100), 999);
    var barColor = reg ? '#22c55e' : above ? '#ef4444' : near ? '#eab308' : '#9ca3af';
    var badge;
    if (reg) badge = '<span style="background:rgba(34,197,94,0.15);color:#22c55e;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Registered</span>';
    else if (above) badge = '<span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Above threshold — register now</span>';
    else if (near) badge = '<span style="background:rgba(234,179,8,0.15);color:#eab308;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Approaching</span>';
    else badge = '<span style="background:rgba(156,163,175,0.08);color:#9ca3af;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">Below</span>';

    var threshLabel = '';
    if (t.revenueCents) threshLabel = '$' + Math.round(t.revenueCents / 100000) + 'K';
    if (t.txnCount != null) threshLabel += (threshLabel ? ' + ' : '') + t.txnCount + 'tx';
    if (!threshLabel) threshLabel = '—';

    h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">';
    h += '<td style="padding:10px;font-weight:600;">' + e(state) + '</td>';
    h += '<td style="padding:10px;font-weight:700;">' + fmt$(d.revenue) + '</td>';
    h += '<td style="padding:10px;">' + d.count + '</td>';
    h += '<td style="padding:10px;font-size:0.78rem;color:var(--warm-gray,#888);">' + e(threshLabel) + '</td>';
    h += '<td style="padding:10px;min-width:130px;"><div style="display:flex;align-items:center;gap:8px;">' +
      '<div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">' +
      '<div style="height:100%;width:' + Math.min(pct,100) + '%;background:' + barColor + ';border-radius:3px;"></div></div>' +
      '<span style="font-size:0.78rem;color:var(--warm-gray,#888);white-space:nowrap;">' + pct + '%</span></div></td>';
    h += '<td style="padding:10px;">' + badge + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  h += _taxNexusFooter;
  return h;
}

// Canonical mask for a vendor/contractor tax ID (EIN/SSN): last 4 digits only,
// e.g. "XXX-XX-1234". Single source of truth so the on-screen display and every
// downloadable export stay in lockstep — a raw TIN must NEVER reach a CSV. A
// working 1099-prep file is a human-facing reference, not the IRS e-file payload,
// so last-4 is enough to disambiguate a payee. Returns '' for an empty/garbage
// TIN; callers label the gap themselves (e.g. 'MISSING — request W-9').
function _maskTaxId(taxId) {
  var digits = String(taxId == null ? '' : taxId).replace(/[^0-9]/g, '');
  return digits ? 'XXX-XX-' + digits.slice(-4) : '';
}

// Vendor Tax ID is now PII encrypted at rest via MastIntake (identity-data): the
// record carries taxIdRef + taxIdMasked instead of plaintext taxId. These two
// helpers read either shape — the stored last-4 mask for an encrypted value, or a
// freshly-masked last-4 for a not-yet-migrated legacy plaintext — so the 1099 prep,
// vendor detail, and CSV exports stay correct through the migration. The plaintext
// is NEVER rendered in full and (post-migration) is no longer present to render.
function _vendorTaxMask(v) {
  if (!v) return '';
  if (v.taxIdMasked) return String(v.taxIdMasked);
  return v.taxId ? _maskTaxId(v.taxId) : '';
}
function _vendorHasTaxId(v) {
  return !!(v && (v.taxIdRef || (v.taxId != null && String(v.taxId).trim() !== '')));
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

// State-free 1099 core — both the classic Tax sub-view and the V2 statements
// hub call this. Returns the >$600 contractor list for a calendar year,
// sorted by total paid (paid receipts of vendorType/payeeType 'contractor').
async function _tax1099ForYearCore(year) {
  var startISO = year + '-01-01T00:00:00Z';
  var endISO   = year + '-12-31T23:59:59Z';
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
    var hasTaxId = _vendorHasTaxId(v);
    contractors.push({
      name: v.name || 'Unknown',
      maskedTaxId: hasTaxId ? _vendorTaxMask(v) : null,
      hasTaxId: hasTaxId, totalPaid: total
    });
  });
  contractors.sort(function(a,b) { return b.totalPaid - a.totalPaid; });
  return contractors;
}

// State-free nexus-registration cores (admin_nexusRegistrations is a per-state
// collection: one doc per state, read in bulk by MastDB.get's collection
// scan). The classic Tax page only ever READ these docs — the V2 statements
// hub is the first in-admin editor.
async function _nexusListCore() {
  return (await MastDB.get('admin/nexusRegistrations')) || {};
}
async function _nexusSaveCore(state, patch) {
  var st = String(state || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(st)) throw new Error('State must be a 2-letter code');
  var existing = (await MastDB.get('admin/nexusRegistrations/' + st).catch(function() { return null; })) || {};
  var doc = Object.assign({}, existing, patch, { updatedAt: new Date().toISOString() });
  await MastDB.set('admin/nexusRegistrations/' + st, doc);
  try { if (typeof writeAudit === 'function') await writeAudit(existing && Object.keys(existing).length ? 'update' : 'create', 'nexusRegistration', st); } catch (_) {}
  return doc;
}
async function _nexusDeleteCore(state) {
  var st = String(state || '').trim().toUpperCase();
  await MastDB.remove('admin/nexusRegistrations/' + st);
  try { if (typeof writeAudit === 'function') await writeAudit('delete', 'nexusRegistration', st); } catch (_) {}
}

window.loadTax1099Data = async function() {
  var el = document.getElementById('f1099Content');
  if (!el) return;
  el.innerHTML = skeletonTable(5,4);
  var year = _1099Year;
  try {
    var contractors = await _tax1099ForYearCore(year);
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

  // W1 R2-F3: register canonical exporter + footer (separate from legacy
  // fin1099Export button — we keep both so existing UI still works).
  _finExporters['finance-tax-1099'] = function() {
    var rows = [['Contractor','Tax ID (masked)','Total Paid (USD)','1099 Required']];
    contractors.forEach(function(c) {
      rows.push([c.name, c.hasTaxId ? c.maskedTaxId : 'MISSING', (c.totalPaid / 100).toFixed(2), 'Yes']);
    });
    _finDownloadCsv('finance-tax-1099', rows, 'Period: tax year ' + year + ' · Basis: admin/vendors + admin/purchaseReceipts');
  };
  var _tax1099Footer = _finFooter('finance-tax-1099', 'tax year ' + year, 'admin/vendors + admin/purchaseReceipts');

  if (contractors.length === 0) {
    return h + '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray,#888);">' +
      '<div style="font-size:1.6rem;margin-bottom:8px;">✅</div>' +
      '<div style="font-size:0.9rem;font-weight:500;">No contractors paid over $600 in ' + year + '</div>' +
      '<div style="font-size:0.85rem;margin-top:4px;">1099-NEC threshold is $600.01 or more.</div></div>' +
      _tax1099Footer;
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
  h += _tax1099Footer;
  return h;
}

window.fin1099Export = function() {
  if (!_1099ContractorData || _1099ContractorData.length === 0) {
    showToast('No 1099 data to export', true); return;
  }
  var rows = [['Name','Tax ID (masked)','Total Paid','1099 Required']];
  _1099ContractorData.forEach(function(c) {
    rows.push([c.name, c.hasTaxId ? c.maskedTaxId : 'MISSING', (c.totalPaid/100).toFixed(2), 'Yes']);
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
  h += renderFinancePeriodBar();
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

  // W2.9 (-OtMNL4nQ4s08pPaxYBu): AR/AP report variants. All read the global
  // _finPeriod selector for the snapshot date; customer/vendor dropdowns
  // hydrate from admin/customers + admin/vendors after first render.
  h += '<div style="background:var(--bg-secondary,#232323);border-radius:12px;padding:20px;margin-top:16px;">';
  h += '<div style="font-size:1rem;font-weight:700;margin-bottom:4px;">Receivables &amp; Payables Snapshots</div>';
  h += '<div style="font-size:0.85rem;color:var(--warm-gray,#888);margin-bottom:14px;">Period-end snapshots, per-customer statements, and vendor 1099-prep exports. Period anchor comes from the selector at the top of this page.</div>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">';
  h += '<button class="btn btn-secondary btn-small" onclick="finReportArAgingSnapshot()" style="text-align:left;padding:12px;">📊 AR Aging Snapshot CSV<div style="font-size:0.72rem;color:var(--warm-gray,#888);margin-top:4px;">Open invoices as of period end</div></button>';
  h += '<button class="btn btn-secondary btn-small" onclick="finReportApAgingSnapshot()" style="text-align:left;padding:12px;">📊 AP Aging Snapshot CSV<div style="font-size:0.72rem;color:var(--warm-gray,#888);margin-top:4px;">Open bills as of period end</div></button>';
  h += '<button class="btn btn-secondary btn-small" onclick="finReportStatementOfAccount()" style="text-align:left;padding:12px;">📄 Per-Customer Statement<div style="font-size:0.72rem;color:var(--warm-gray,#888);margin-top:4px;">Choose customer ▾</div></button>';
  h += '<button class="btn btn-secondary btn-small" onclick="finReportVendor1099Prep()" style="text-align:left;padding:12px;">📑 Vendor 1099-Prep Export<div style="font-size:0.72rem;color:var(--warm-gray,#888);margin-top:4px;">Period-windowed (not calendar year)</div></button>';
  h += '</div>';
  h += '<div id="fW29CustomerPicker" style="display:none;margin-top:14px;"></div>';
  h += '<div id="fW29VendorPicker" style="display:none;margin-top:14px;"></div>';
  h += '</div>';

  // W2 R2-F4: R-FIN-1 Period · Basis footer. Reports is the union of multiple
  // basis sources (loan/tax/AR/AP/statement/1099) — each report names its own
  // window inline. The footer documents that union and surfaces the global
  // period anchor used by the AR/AP/statement snapshot exports.
  _finExporters['finance-reports'] = function() {
    showToast('Use the per-report Generate / Export buttons above', true);
  };
  h += _finFooter('finance-reports',
    'Per-report (loan=12m · tax=year · AR/AP/statement=' + _finPeriodLabel(window._finPeriod) + ' · 1099=tax year)',
    'orders + admin/expenses + admin/vendors + admin/purchaseReceipts + orders.invoicePaidAt');

  h += '</div>';
  el.innerHTML = h;
}

// W2.9: snapshot CSVs read the global _finPeriod selector for the "as-of"
// boundary. AR/AP snapshots use period.end as the as-of date; customer
// statement uses [period.start, period.end] for the activity window.

// State-free AR aging snapshot core — returns CSV rows (header + data) for
// open invoices as of a date. Shared by the classic Reports tab and
// finance-reports-v2.
async function _arAgingSnapshotCore(asOf) {
  var [sentRaw, overdueRaw] = await Promise.all([
    MastDB.query('orders').orderByChild('invoiceStatus').equalTo('sent').limitToLast(2000).once(),
    MastDB.query('orders').orderByChild('invoiceStatus').equalTo('overdue').limitToLast(2000).once()
  ]);
  var rows = [['Customer','Customer Email','Invoice #','Order ID','Amount Due (USD)','Due Date','Days Overdue (as of ' + asOf + ')','Bucket','Status']];
  var asOfMs = new Date(asOf + 'T23:59:59Z').getTime();
  Object.entries(Object.assign({}, sentRaw || {}, overdueRaw || {})).forEach(function(kv) {
    var orderId = kv[0], o = kv[1];
    if (!o) return;
    var c = _orderRevenueCents(o);
    var paid = o.invoicePaidAmount || 0;
    var due = c - paid;
    if (due <= 0) return;
    if (isTestOrder(o) && !_includeTestData) return;
    var daysOver = 0, bucket = 'current';
    if (o.invoiceDueDate) {
      var dueMs = new Date(o.invoiceDueDate + 'T00:00:00Z').getTime();
      daysOver = Math.max(0, Math.floor((asOfMs - dueMs) / 86400000));
      if (daysOver <= 0) bucket = 'current';
      else if (daysOver <= 30) bucket = '1_to_30';
      else if (daysOver <= 60) bucket = '31_to_60';
      else if (daysOver <= 90) bucket = '61_to_90';
      else bucket = '90_plus';
    }
    rows.push([
      o.customerName || 'Unknown',
      o.customerEmail || (o.customer && o.customer.email) || '',
      o.invoiceNumber || '',
      orderId,
      (due / 100).toFixed(2),
      o.invoiceDueDate || '',
      String(daysOver),
      bucket,
      o.invoiceStatus || ''
    ]);
  });
  return rows;
}

window.finReportArAgingSnapshot = async function() {
  var period = _finResolvePeriod();
  var asOf = period.end;
  try {
    var rows = await _arAgingSnapshotCore(asOf);
    if (rows.length === 1) { showToast('No open invoices as of ' + asOf, true); return; }
    _finDownloadCsv('ar-aging-snapshot', rows, 'AR Aging as of ' + asOf + ' · Basis: orders.invoiceDueDate (invoiceStatus IN sent,overdue)');
    showToast('AR aging snapshot exported');
  } catch (err) {
    showToast('Snapshot failed: ' + (err.message || err), true);
  }
};

// State-free AP aging snapshot core — CSV rows for open bills as of a date.
async function _apAgingSnapshotCore(asOf) {
  var [unpaidRaw, partialRaw, vendorsRaw] = await Promise.all([
    MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('unpaid').limitToLast(2000).once(),
    MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('partial').limitToLast(2000).once(),
    MastDB.get('admin/vendors')
  ]);
  var vendors = vendorsRaw || {};
  var rows = [['Vendor','Vendor Email','Invoice Ref','Receipt ID','Amount Due (USD)','Due Date','Days Overdue (as of ' + asOf + ')','Bucket','Payment Status']];
  var asOfMs = new Date(asOf + 'T23:59:59Z').getTime();
  Object.entries(Object.assign({}, unpaidRaw || {}, partialRaw || {})).forEach(function(kv) {
    var receiptId = kv[0], r = kv[1];
    if (!r) return;
    var amt = r.amountCents || 0; var paid = r.paidAmount || 0;
    var due = amt - paid;
    if (due <= 0) return;
    var daysOver = 0, bucket = 'current';
    if (r.dueDate) {
      var dueMs = new Date(r.dueDate + 'T00:00:00Z').getTime();
      daysOver = Math.max(0, Math.floor((asOfMs - dueMs) / 86400000));
      if (daysOver <= 0) bucket = 'current';
      else if (daysOver <= 30) bucket = '1_to_30';
      else if (daysOver <= 60) bucket = '31_to_60';
      else if (daysOver <= 90) bucket = '61_to_90';
      else bucket = '90_plus';
    }
    var v = vendors[r.vendorId] || {};
    rows.push([
      v.name || 'Unknown Vendor',
      v.email || '',
      r.vendorInvoiceRef || '',
      receiptId,
      (due / 100).toFixed(2),
      r.dueDate || '',
      String(daysOver),
      bucket,
      r.paymentStatus || ''
    ]);
  });
  return rows;
}

window.finReportApAgingSnapshot = async function() {
  var period = _finResolvePeriod();
  var asOf = period.end;
  try {
    var rows = await _apAgingSnapshotCore(asOf);
    if (rows.length === 1) { showToast('No open bills as of ' + asOf, true); return; }
    _finDownloadCsv('ap-aging-snapshot', rows, 'AP Aging as of ' + asOf + ' · Basis: admin/purchaseReceipts.dueDate (paymentStatus IN unpaid,partial)');
    showToast('AP aging snapshot exported');
  } catch (err) {
    showToast('Snapshot failed: ' + (err.message || err), true);
  }
};

window.finReportStatementOfAccount = async function() {
  var picker = document.getElementById('fW29CustomerPicker');
  if (!picker) return;
  picker.style.display = 'block';
  picker.innerHTML = '<div style="color:var(--warm-gray,#888);font-size:0.85rem;">Loading customers…</div>';
  try {
    var customersRaw = (await MastDB.get('admin/customers')) || {};
    var customers = Object.entries(customersRaw)
      .map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); })
      .filter(function(c) { return c && (c.displayName || c.primaryEmail); })
      .sort(function(a, b) { return (a.displayName || '').localeCompare(b.displayName || ''); });
    if (customers.length === 0) { picker.innerHTML = '<div style="color:var(--warm-gray,#888);font-size:0.85rem;">No customers found.</div>'; return; }
    var opts = '<option value="">— Choose a customer —</option>';
    customers.forEach(function(c) {
      var label = (c.displayName || '(no name)') + (c.primaryEmail ? ' · ' + c.primaryEmail : '');
      opts += '<option value="' + e(c._id) + '">' + e(label) + '</option>';
    });
    picker.innerHTML =
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
      '<label style="font-size:0.78rem;color:var(--warm-gray,#888);">Customer:</label>' +
      '<select id="fW29CustomerSelect" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 8px;font-size:0.85rem;min-width:240px;">' + opts + '</select>' +
      '<button class="btn btn-primary btn-small" onclick="finReportStatementExport()">Export Statement CSV</button>' +
      '</div>';
  } catch (err) {
    picker.innerHTML = '<div style="color:var(--danger,#dc2626);font-size:0.85rem;">Failed to load customers: ' + e(err.message || String(err)) + '</div>';
  }
};

// State-free statement cores. _statementCustomersCore returns the pickable
// customer list; _statementRowsCore returns { customer, rows } for the
// activity window (running balance, total row appended).
async function _statementCustomersCore() {
  var customersRaw = (await MastDB.get('admin/customers')) || {};
  return Object.entries(customersRaw)
    .map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); })
    .filter(function(c) { return c && (c.displayName || c.primaryEmail); })
    .sort(function(a, b) { return (a.displayName || '').localeCompare(b.displayName || ''); });
}

async function _statementRowsCore(customerId, start, end) {
  var customer = (await MastDB.get('admin/customers/' + customerId)) || {};
  var ordersRaw = await MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(start)).endAt(isoEnd(end)).limitToLast(2000).once();
  var orders = Object.entries(ordersRaw || {})
    .map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); })
    .filter(function(o) {
      return o && (
        o.customerId === customerId ||
        (o.customerEmail && customer.primaryEmail && o.customerEmail.toLowerCase() === customer.primaryEmail.toLowerCase())
      );
    });
  orders.sort(function(a, b) { return (a.placedAt || '').localeCompare(b.placedAt || ''); });
  var rows = [['Date','Order #','Description','Charges (USD)','Payments (USD)','Balance (USD)','Invoice Status']];
  var balanceCents = 0;
  orders.forEach(function(o) {
    var totalCents = _orderRevenueCents(o);
    var paidCents = o.invoicePaidAmount || 0;
    balanceCents += (totalCents - paidCents);
    rows.push([
      (o.placedAt || '').slice(0, 10),
      o.orderNumber || o._id,
      o.customerName ? 'Order — ' + o.customerName : 'Order',
      (totalCents / 100).toFixed(2),
      (paidCents / 100).toFixed(2),
      (balanceCents / 100).toFixed(2),
      o.invoiceStatus || ''
    ]);
  });
  rows.push(['','','TOTAL BALANCE', '', '', (balanceCents / 100).toFixed(2), '']);
  return { customer: customer, rows: rows, orderCount: orders.length };
}

// State-free share-link mint (mintCustomerStatementToken CF) — extracted from
// the AR Send Statement flow so the V2 reports hub can mint without the
// mailto/DOM side effects.
async function _mintStatementLinkCore(customerId, expiresInDays) {
  var tenantId = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID || '';
  var mintFn = firebase.functions().httpsCallable('mintCustomerStatementToken');
  var result = await mintFn({ tenantId: tenantId, customerId: customerId, expiresInDays: expiresInDays || 30 });
  var data = (result && result.data) || {};
  var url = data.url || data.shareUrl || data.statementUrl || '';
  if (!url) throw new Error('Mint CF did not return a URL');
  return url;
}

window.finReportStatementExport = async function() {
  var sel = document.getElementById('fW29CustomerSelect');
  if (!sel) return;
  var customerId = sel.value;
  if (!customerId) { showToast('Pick a customer first', true); return; }
  var period = _finResolvePeriod();
  try {
    var st = await _statementRowsCore(customerId, period.start, period.end);
    var fname = 'statement-' + (st.customer.displayName || customerId).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    _finDownloadCsv(fname, st.rows, 'Statement for ' + (st.customer.displayName || customerId) + ' · ' + period.start + ' to ' + period.end);
    showToast('Statement exported');
  } catch (err) {
    showToast('Export failed: ' + (err.message || err), true);
  }
};

window.finReportVendor1099Prep = async function() {
  var picker = document.getElementById('fW29VendorPicker');
  if (!picker) return;
  picker.style.display = 'block';
  picker.innerHTML = '<div style="color:var(--warm-gray,#888);font-size:0.85rem;">Loading vendors…</div>';
  try {
    var vendorsRaw = (await MastDB.get('admin/vendors')) || {};
    var contractors = Object.entries(vendorsRaw)
      .map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); })
      .filter(function(v) { return v && ((v.vendorType || v.payeeType) === 'contractor'); })
      .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    if (contractors.length === 0) { picker.innerHTML = '<div style="color:var(--warm-gray,#888);font-size:0.85rem;">No contractor vendors found. Mark a vendor as type=contractor first.</div>'; return; }
    var opts = '<option value="__all__">— All contractors —</option>';
    contractors.forEach(function(v) {
      opts += '<option value="' + e(v._id) + '">' + e(v.name || '(no name)') + (_vendorHasTaxId(v) ? ' (TIN on file)' : ' (TIN MISSING)') + '</option>';
    });
    picker.innerHTML =
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
      '<label style="font-size:0.78rem;color:var(--warm-gray,#888);">Contractor:</label>' +
      '<select id="fW29VendorSelect" style="background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:5px 8px;font-size:0.85rem;min-width:240px;">' + opts + '</select>' +
      '<button class="btn btn-primary btn-small" onclick="finReportVendor1099Export()">Export 1099-Prep CSV</button>' +
      '</div>';
  } catch (err) {
    picker.innerHTML = '<div style="color:var(--danger,#dc2626);font-size:0.85rem;">Failed to load vendors: ' + e(err.message || String(err)) + '</div>';
  }
};

// State-free contractor-vendor list + period-windowed 1099 rows cores.
async function _contractorVendorsCore() {
  var vendorsRaw = (await MastDB.get('admin/vendors')) || {};
  return Object.entries(vendorsRaw)
    .map(function(kv) { return Object.assign({ _id: kv[0] }, kv[1]); })
    .filter(function(v) { return v && ((v.vendorType || v.payeeType) === 'contractor'); })
    .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
}

async function _vendor1099RowsCore(pick, start, end) {
  var [vendorsRaw, receiptsRaw] = await Promise.all([
    MastDB.get('admin/vendors'),
    MastDB.query('admin/purchaseReceipts').orderByChild('receivedAt').startAt(isoStart(start)).endAt(isoEnd(end)).limitToLast(5000).once()
  ]);
  var vendors = vendorsRaw || {};
  var receipts = Object.values(receiptsRaw || {});
  var totals = {};
  receipts.forEach(function(r) {
    if (!r) return;
    var v = vendors[r.vendorId];
    if (!v) return;
    if ((v.vendorType || v.payeeType) !== 'contractor') return;
    if (pick !== '__all__' && r.vendorId !== pick) return;
    if (r.paymentStatus !== 'paid') return;
    if (!totals[r.vendorId]) totals[r.vendorId] = { total: 0, vendor: v };
    totals[r.vendorId].total += r.amountCents || 0;
  });
  var rows = [['Contractor','Tax ID (masked)','TIN Status','Period Paid (USD)','Threshold','1099 Required (>$600)']];
  var keys = Object.keys(totals).sort(function(a, b) { return totals[b].total - totals[a].total; });
  keys.forEach(function(vid) {
    var d = totals[vid];
    var hasTaxId = _vendorHasTaxId(d.vendor);
    var masked = hasTaxId ? _vendorTaxMask(d.vendor) : '';
    var tinStatus = hasTaxId ? 'On file' : 'MISSING — request W-9';
    var required = d.total > 60000 ? 'Yes' : 'No (below threshold)';
    rows.push([d.vendor.name || 'Unknown', masked, tinStatus, (d.total / 100).toFixed(2), '$600 (period-windowed)', required]);
  });
  return rows;
}

window.finReportVendor1099Export = async function() {
  var sel = document.getElementById('fW29VendorSelect');
  if (!sel) return;
  var pick = sel.value;
  if (!pick) { showToast('Pick a vendor first', true); return; }
  var period = _finResolvePeriod();
  try {
    var rows = await _vendor1099RowsCore(pick, period.start, period.end);
    if (rows.length === 1) { showToast('No paid receipts in period for this vendor', true); return; }
    _finDownloadCsv('vendor-1099-prep', rows, '1099 Prep · ' + period.start + ' to ' + period.end + ' (period-windowed; legal threshold is calendar year)');
    showToast('1099-prep export downloaded');
  } catch (err) {
    showToast('Export failed: ' + (err.message || err), true);
  }
};

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
    if (!_salesRowCounts(s)) return; // skip voided + POS-square mirrors (orderId set → counted via its orders row)
    var c = _salesCents(s); if (c<=0) return; // `amount` is already CENTS — *100 over-reported this surface 100×
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

// State-free loan-report data core — trailing-12m monthly breakdown + bank
// balance. Shared by the classic Reports tab and finance-reports-v2 (which
// also reuses renderLoanReport for the printable HTML).
async function _loanReportDataCore() {
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
  return { monthly: monthly, bankTotal: bankTotal, startDate: startDate, endDate: endDate };
}

window.loadLoanReport = async function() {
  var el = document.getElementById('fLoanContent');
  if (!el) return;
  el.innerHTML = skeletonCards(4) + '<div style="margin-top:16px;">' + skeletonTable(12,3) + '</div>';
  try {
    var d = await _loanReportDataCore();
    el.innerHTML = renderLoanReport(d.monthly, d.bankTotal, d.startDate, d.endDate);
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
    bankTotal>0 ? 'Cash on Hand: $'+MastFormat.moneyRaw(bankTotal) : null
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
  if (bankTotal>0) h += statCard('Cash on Hand', '$'+MastFormat.moneyRaw(bankTotal), '#8b5cf6');
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
    h += '<div style="font-size:1.6rem;font-weight:700;color:#22c55e;">$' + MastFormat.moneyRaw(bankTotal) + '</div>';
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

// State-free year-end package data core — Schedule-C P&L, sales tax by
// state, >$600 contractors, and mileage for a calendar year.
async function _yearEndDataCore(year) {
  var startDate = year+'-01-01';
  var endDate   = year+'-12-31';
  var [pnlData, taxData, contractors, mileage] = await Promise.all([
    computePnlLocal(startDate, endDate),
    computeTaxSummaryForReport(startDate, endDate),
    compute1099DataForYear(year),
    computeMileageForYear(year)
  ]);
  return { pnlData:pnlData, taxData:taxData, contractors:contractors, mileage:mileage, year:year };
}

window.loadYearEndReport = async function() {
  var el = document.getElementById('fYearEndContent');
  if (!el) return;
  var year = _reportYear;
  el.innerHTML = skeletonCards(3) + '<div style="margin-top:16px;">' + skeletonTable(5,3) + '</div>';
  try {
    var d = await _yearEndDataCore(year);
    window._yearEndData = d;
    el.innerHTML = renderYearEndReport(d.pnlData, d.taxData, d.contractors, d.mileage, year);
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
    result.push({ name:d.vendor.name||'Unknown', maskedTaxId:_vendorTaxMask(d.vendor), hasTaxId:_vendorHasTaxId(d.vendor), totalPaid:d.total });
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
    h += statCard('IRS Rate', '$'+MastFormat.moneyRaw(IRS_RATE)+'/mi', 'var(--warm-gray,#888)', 'verify at irs.gov');
    h += statCard('Deductible Amount', '$'+MastFormat.moneyRaw(deductible), '#16a34a');
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
      h += '<td style="padding:7px 10px;font-size:0.78rem;">' + (c.hasTaxId?'<span style="font-family:monospace;">'+e(c.maskedTaxId)+'</span>':'<span style="color:#ef4444;">Missing</span>') + '</td>';
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
  // SECURITY (CSV formula injection): route every cell through the shell-global
  // _csvCell (app/index.html ~40372) — the same guard _finDownloadCsv uses. It
  // prefixes a "'" to cells starting with =,+,-,@ and applies RFC-4180 quoting.
  // Output is byte-identical to the prior inline serializer except injection-
  // prone cells gain the leading quote. Row DATA / order / headers unchanged.
  if (typeof window._csvCell !== 'function') {
    showToast('CSV export unavailable: _csvCell helper missing', true);
    return;
  }
  var cellFn = window._csvCell;
  var csv = rows.map(function(row) {
    return row.map(function(cell) { return cellFn(cell); }).join(',');
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

// Year-end CSV exports — parameterized on the data object so both the classic
// tab (window._yearEndData) and finance-reports-v2 (its own cache) can call.
function _yearEndExportPnlCsv(d) {
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
}
window.finExportPnlCsv = function() {
  var d = window._yearEndData; if (!d) { showToast('Generate the report first', true); return; }
  _yearEndExportPnlCsv(d);
};

function _yearEndExportTaxCsv(d) {
  var tax = d.taxData; var year = d.year;
  var rows = [['State','Tax Collected','Order Count','Registered']];
  Object.keys(tax.byState||{}).sort().forEach(function(state) {
    var s = tax.byState[state]; var reg = tax.nexus[state]&&tax.nexus[state].registered;
    rows.push([state,(s.taxCollected/100).toFixed(2),s.orderCount,reg?'Yes':'No']);
  });
  downloadCsv(rows, 'SalesTax_'+year+'.csv');
  showToast('SalesTax.csv downloaded');
}
window.finExportTaxCsv = function() {
  var d = window._yearEndData; if (!d) { showToast('Generate the report first', true); return; }
  _yearEndExportTaxCsv(d);
};

function _yearEndExport1099Csv(d) {
  var rows = [['Name','Tax ID (masked)','Total Paid','1099 Required']];
  d.contractors.forEach(function(c) {
    rows.push([c.name, c.hasTaxId?c.maskedTaxId:'MISSING', (c.totalPaid/100).toFixed(2), 'Yes']);
  });
  downloadCsv(rows, '1099s_'+d.year+'.csv');
  showToast('1099s.csv downloaded');
}
window.finExport1099Csv = function() {
  var d = window._yearEndData; if (!d) { showToast('Generate the report first', true); return; }
  _yearEndExport1099Csv(d);
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
  return sign + '$' + MastFormat.moneyRaw(Math.abs(cents), { cents: true });
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
    var amt = _orderRevenueCents(o);
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
      '<div style="font-size:0.9rem;font-weight:600;color:var(--text-primary);margin-bottom:2px;">' + esc(formatter(latest)) + '</div>' +
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
  html += buildCard('Net contribution', netVals, netVals[last], netVals[prevIdx], portfolioFmtMoney, 'var(--text-primary)');
  html += '</div>';
  html += '</div>';
  return html;
}

// W2 R2-F6: Portfolio is intrinsically trailing-12m (rolling-window quadrant
// model), so the global MTD/QTD/FYTD/Custom selector does NOT re-filter this
// view. Render an explicit note next to the bar so changing the chip doesn't
// silently mislead the operator. Fully wiring the selector to re-filter
// Portfolio would require runtime recompute from raw orders (customers carry
// only precomputed `stats.trailing12m*` fields) — out of scope for R2.
function _portfolioPeriodNote() {
  return '<div style="font-size:0.72rem;color:var(--warm-gray,#888);margin:-8px 0 14px 4px;">' +
    'Note: Portfolio is always trailing-12m regardless of selector — quadrant model is rolling-window.' +
    '</div>';
}

// State-free portfolio compute — customers + tickets + returns → quadrant rows
// + concentration stats. Shared with the V2 portfolio twin via FinanceBridge.
function _portfolioCompute() {
  return Promise.all([
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
    return { rows: rows, c2s: c2s, top5: top5, top10: top10, hhi: hhi, hhiBand: hhiBand, totalRev: totalRev, qCounts: qCounts };
  });
}

function renderCustomerPortfolio() {
  var el = document.getElementById('customerPortfolioContent');
  if (!el) return;
  // W2.8: period bar shown above loading state so user sees it during fetch.
  el.innerHTML = renderFinancePeriodBar() + _portfolioPeriodNote() +
    '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading portfolio…</div>';

  _portfolioCompute().then(function(d) {
    var rows = d.rows, c2s = d.c2s, top5 = d.top5, top10 = d.top10,
        hhi = d.hhi, hhiBand = d.hhiBand, totalRev = d.totalRev, qCounts = d.qCounts;

    portfolioState.rows = rows;
    portfolioState.thresholds = c2s;
    portfolioState.concentration = { top5: top5, top10: top10, hhi: hhi, hhiBand: hhiBand, totalRevenueCents: totalRev };

    // Render
    var html = '';
    html += renderFinancePeriodBar(); // W2.8
    html += _portfolioPeriodNote(); // W2 R2-F6
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px;">';
    html += '<h2 style="font-size:1.6rem;font-weight:700;color:var(--text-primary);margin:0;">Customer Portfolio</h2>';
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);">' +
      esc(String(rows.length)) + ' customers · trailing-12m · cost-to-serve $' + (c2s.perTicketCents/100).toFixed(0) +
      '/ticket, $' + (c2s.perReturnCents/100).toFixed(0) + '/return</div>';
    html += '</div>';

    // Concentration card
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;margin-bottom:16px;">';
    html += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:10px;">Concentration risk</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;">';
    html += '<div><div style="font-size:0.78rem;color:var(--warm-gray);">Top 5 share</div>' +
      '<div style="font-size:1.6rem;font-weight:600;color:' + (top5.sharePct > 0.4 ? '#f49aa3' : 'var(--text-primary)') + ';">' +
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
        '<td style="text-align:right;font-weight:600;color:' + (r.netContributionCents < 0 ? '#f49aa3' : 'var(--text-primary)') + ';">' +
          esc(portfolioFmtMoney(r.netContributionCents)) + '</td>' +
        '<td style="font-size:0.78rem;color:' + lapseColor + ';">' + esc(lapseLabel) + '</td>' +
        '</tr>';
    });
    if (displayRows.length === 0) {
      html += '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--warm-gray);">No customers in this quadrant.</td></tr>';
    }
    html += '</tbody></table></div>';

    // W1 R2-F3: canonical Period · Basis footer + CSV export.
    _finExporters['customer-portfolio'] = function() {
      var csvRows = [];
      csvRows.push(['Customer','Email','Quadrant','Revenue 12m (USD)','COGS 12m (USD)','Gross Margin (USD)','Net Margin %','Tickets','Returns','Cost to Serve (USD)','Net Contribution (USD)','Lapse Status','Tags']);
      displayRows.forEach(function(r) {
        csvRows.push([
          r.displayName || '', r.primaryEmail || '', r.quadrant || '',
          (r.revenueCents / 100).toFixed(2), (r.cogsCents / 100).toFixed(2),
          (r.grossMarginCents / 100).toFixed(2),
          typeof r.netMarginPct === 'number' ? (r.netMarginPct * 100).toFixed(1) : '',
          String(r.ticketCount || 0), String(r.returnCount || 0),
          (r.costToServeCents / 100).toFixed(2),
          (r.netContributionCents / 100).toFixed(2),
          r.lapseStatus || '', (r.tags || []).join('|')
        ]);
      });
      _finDownloadCsv('customer-portfolio', csvRows, 'Period: trailing-12m as of ' + todayStr() + ' · Basis: admin/customers.stats.trailing12m* + cs_tickets + admin/rma');
    };
    html += _finFooter('customer-portfolio', 'trailing-12m as of ' + todayStr(), 'admin/customers.stats.trailing12m* + cs_tickets + admin/rma');

    el.innerHTML = html;
    portfolioUpdateBulkBar();
  }).catch(function(err) {
    el.innerHTML = renderFinancePeriodBar() + _portfolioPeriodNote() + '<div style="color:var(--danger);padding:20px;">Error loading portfolio: ' + esc(err && err.message || String(err)) + '</div>';
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
  // PR1: customersOpenDetail moved to the lazy customers-core; ensure it's
  // loaded (in default V2 mode the V1 module isn't) before opening.
  if (window.MastAdmin && MastAdmin.loadModule) {
    MastAdmin.loadModule('customers-core').then(function() {
      setTimeout(function() { if (typeof window.customersOpenDetail === 'function') window.customersOpenDetail(cid); }, 50);
    });
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

// State-free bulk-tag core — both the classic view and customer-portfolio-v2
// call this. Reads each customer doc fresh (no dependence on a loaded list),
// merges/removes the tag, writes back. opts.remove=true removes the tag
// instead of adding it. Returns { changed, errors }.
async function _portfolioBulkTagCore(ids, tag, opts) {
  var remove = !!(opts && opts.remove);
  var now = new Date().toISOString();
  var changed = 0, errors = 0;
  for (var i = 0; i < ids.length; i++) {
    try {
      var cust = (await MastDB.get('admin/customers/' + ids[i])) || {};
      var existingTags = Array.isArray(cust.tags) ? cust.tags : [];
      var has = existingTags.indexOf(tag) !== -1;
      if (remove ? has : !has) {
        var newTags = remove
          ? existingTags.filter(function(t) { return t !== tag; })
          : existingTags.concat([tag]);
        await MastDB.update('admin/customers/' + ids[i], { tags: newTags, updatedAt: now });
        changed++;
      }
    } catch (e) { errors++; }
  }
  return { changed: changed, errors: errors };
}

async function portfolioBulkTag(tag) {
  var checked = Array.from(document.querySelectorAll('.pf-row-check:checked'));
  if (checked.length === 0) return;
  var ids = checked.map(function(cb) { return cb.dataset.customerId; });
  var confirmed = await (typeof mastConfirm === 'function'
    ? mastConfirm('Apply tag "' + tag + '" to ' + MastFormat.countNoun(ids.length, 'customer') + '?', { title: 'Bulk tag' })
    : Promise.resolve(window.confirm('Apply tag "' + tag + '" to ' + ids.length + ' customers?')));
  if (!confirmed) return;
  var res = await _portfolioBulkTagCore(ids, tag);
  if (typeof showToast === 'function') {
    showToast('Tagged ' + res.changed + (res.errors > 0 ? ' (' + res.errors + ' errored)' : '') + ' customer(s) as "' + tag + '".');
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
window._arSort = function(key) {
  if (_arSortKey === key) _arSortDir = (_arSortDir === 'asc') ? 'desc' : 'asc';
  else { _arSortKey = key; _arSortDir = ({ amtDue:1, daysOver:1, dueDate:1 })[key] ? 'desc' : 'asc'; }
  var el = document.getElementById('fArContent');
  if (el) el.innerHTML = renderArContent();
};
window._apSort = function(key) {
  if (_apSortKey === key) _apSortDir = (_apSortDir === 'asc') ? 'desc' : 'asc';
  else { _apSortKey = key; _apSortDir = ({ totalCents:1, paidCents:1, amtDue:1, daysOver:1, dueDate:1 })[key] ? 'desc' : 'asc'; }
  if (typeof renderApContent === 'function') {
    var el = document.getElementById('fApContent');
    if (el) el.innerHTML = renderApContent();
  } else if (typeof loadApData === 'function') {
    loadApData();
  }
};

// ── W2.1 Finance Overview (#financials) ──────────────────────────────────────
// Net-new landing dashboard for the Finance section. 6 KPI cards drawn from
// canonical helpers used elsewhere in the module (R-FIN-2 compliance: `—`
// + diagnostic when an input is 0/missing). Period footer respects global
// _finPeriod selector. Replaces legacy Square sales-sync route at #financials
// (financials.js was orphaned dead code — not in MODULE_MANIFEST, never
// script-loaded; the old Square sync surface lives behind Settings).

function renderFinanceOverview() {
  var el = document.getElementById('financeOverviewTab');
  if (!el) return;
  injectFinancePulseCSS();
  el.innerHTML =
    '<div style="padding:20px;max-width:1100px;">' +
    renderFinancePeriodBar() +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
    '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">Finance Overview</h2>' +
    '<button class="btn btn-secondary btn-small" onclick="renderFinanceOverview()">Refresh</button>' +
    '</div>' +
    '<div id="fOvContent">' + skeletonCards(6) + '</div>' +
    '</div>';
  _loadFinanceOverview();
}

async function _loadFinanceOverview() {
  var el = document.getElementById('fOvContent');
  if (!el) return;
  var period = _finResolvePeriod();
  // W2 R2-F1: Revenue card + Margin card both consume the GLOBAL period.
  // The "vs prior" delta compares to the equivalent prior window (prior MTD
  // when mode=mtd, prior QTD when mode=qtd, etc.) — driven by priorPeriod()
  // applied to the current selected window. Cash/AR/AP/runway remain point-
  // in-time. R-FIN-2 sentinel must apply to ALL periods, not just MTD.
  try {
    var prior = priorPeriod(period.start, period.end);

    var [plaidRaw, sentRaw, overdueRaw, unpaidRaw, partialRaw, periodAgg, priorAgg, pnlPeriod, integMeta, qboConn, xeroConn] = await Promise.all([
      MastDB.plaidItems.list().catch(function() { return {}; }),
      MastDB.query('orders').orderByChild('invoiceStatus').equalTo('sent').limitToLast(500).once().catch(function() { return {}; }),
      MastDB.query('orders').orderByChild('invoiceStatus').equalTo('overdue').limitToLast(500).once().catch(function() { return {}; }),
      MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('unpaid').limitToLast(500).once().catch(function() { return {}; }),
      MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('partial').limitToLast(500).once().catch(function() { return {}; }),
      _loadRevenueAggregate(period.start, period.end).catch(function() { return null; }),
      _loadRevenueAggregate(prior.start, prior.end).catch(function() { return null; }),
      computePnlLocal(period.start, period.end)
        .then(function(p) { return _w3EnrichPnlWithBurden(p, period.start, period.end); })
        .catch(function() { return null; }),
      // W2a.5: Integrations health card data sources.
      MastDB.get('admin/integrations/_meta').catch(function() { return null; }),
      MastDB.get('admin/integrations/qbo').catch(function() { return null; }),
      MastDB.get('admin/integrations/xero').catch(function() { return null; })
    ]);

    var bankConnected = false, bankTotal = 0;
    Object.values(plaidRaw || {}).forEach(function(it) {
      if (it && it.status === 'active') {
        bankConnected = true;
        (it.accounts || []).forEach(function(a) { bankTotal += (a.currentBalance || 0); });
      }
    });

    var arOutstandingCents = 0, arCount = 0;
    Object.values(Object.assign({}, sentRaw || {}, overdueRaw || {})).forEach(function(o) {
      if (!o) return;
      var c = _orderRevenueCents(o);
      var paid = o.invoicePaidAmount || 0;
      var due = c - paid;
      if (due <= 0) return;
      if (isTestOrder(o) && !_includeTestData) return;
      arOutstandingCents += due; arCount++;
    });

    var apOwedCents = 0, apCount = 0;
    Object.values(Object.assign({}, unpaidRaw || {}, partialRaw || {})).forEach(function(r) {
      if (!r) return;
      var amt = r.amountCents || 0; var paid = r.paidAmount || 0;
      var due = amt - paid;
      if (due <= 0) return;
      apOwedCents += due; apCount++;
    });

    var periodRev = periodAgg ? periodAgg.totalCents : 0;
    var priorRev = priorAgg ? priorAgg.totalCents : 0;
    var revDeltaPct = null;
    if (priorRev > 0) revDeltaPct = (periodRev - priorRev) / priorRev * 100;

    // R-FIN-2 sentinel: Margin renders `—` + diagnostic when revenue is 0 OR
    // any line items lack COGS (partial coverage → margin is structurally
    // unreliable, would mislead). Applied uniformly to MTD/QTD/FYTD/Custom —
    // a structurally-meaningless 99.9% margin must never render under any
    // selector state. W2 R3 fix: gate on cogsLineMissingCount > 0, not just
    // `cogs <= 0` — earlier check let QTD/FYTD show 99.9% when some line
    // items had snapshot cogsCents and others didn't.
    // W3.5: when burden is acknowledged + present, fold labor into COGS for
    // the Margin card too (mirrors renderPnl behavior). Mutate pnlPeriod so
    // downstream cards/exporters stay consistent.
    if (pnlPeriod && pnlPeriod._burden && pnlPeriod._burden.acknowledged) {
      var addLab = pnlPeriod._burden.effectiveLaborCogsCents || 0;
      var addOh  = pnlPeriod._burden.fixedOverheadCents || 0;
      if (addLab > 0) {
        pnlPeriod.cogs = (pnlPeriod.cogs || 0) + addLab;
        pnlPeriod.grossProfit = pnlPeriod.revenue - pnlPeriod.cogs;
      }
      if (addOh > 0) {
        pnlPeriod.opex = (pnlPeriod.opex || 0) + addOh;
        pnlPeriod.netProfit = pnlPeriod.grossProfit - pnlPeriod.opex;
      }
    }
    var marginCard;
    var cogsVal = pnlPeriod ? pnlPeriod.cogs : null;
    var revVal = pnlPeriod ? pnlPeriod.revenue : 0;
    var anyCogsMissing = pnlPeriod ? (pnlPeriod.cogsLineMissingCount || 0) > 0 : true;
    if (!pnlPeriod || (revVal || 0) <= 0) {
      marginCard = { value: '—', diag: 'No revenue in selected period', color: 'var(--warm-gray,#888)' };
    } else if (anyCogsMissing || cogsVal == null || isNaN(cogsVal) || cogsVal <= 0) {
      var missCount = pnlPeriod.cogsLineMissingCount || 0;
      var diag = missCount > 0
        ? (MastFormat.countNoun(missCount, 'line item') + ' missing COGS — set product costs in Maker')
        : 'COGS not yet tracked — set material costs in Products';
      marginCard = { value: '—', diag: diag, color: 'var(--warm-gray,#888)' };
    } else {
      var marginPct = ((revVal - cogsVal) / revVal) * 100;
      marginCard = { value: marginPct.toFixed(1) + '%', diag: 'Gross margin · period: ' + period.mode.toUpperCase(), color: marginPct >= 30 ? '#22c55e' : (marginPct >= 10 ? '#eab308' : '#ef4444') };
    }

    // Runway per R-FIN-2: `—` when cash is `—` (no bank connected).
    var runwayCard;
    if (!bankConnected) {
      runwayCard = { value: '—', diag: 'Connect a bank in Expenses to see runway', color: 'var(--warm-gray,#888)' };
    } else {
      // Burn rate: average daily opex from selected-period P&L; runway = bankTotal / avgDailyOpex
      var daysInPeriod = Math.max(1, Math.round((new Date(period.end).getTime() - new Date(period.start).getTime()) / 86400000) + 1);
      var opexCents = pnlPeriod ? (pnlPeriod.opex || 0) : 0;
      var avgDailyOpex = opexCents / daysInPeriod / 100; // $/day
      if (avgDailyOpex <= 0) {
        runwayCard = { value: '∞', diag: 'No tracked opex in period', color: '#22c55e' };
      } else {
        var days = Math.floor(bankTotal / avgDailyOpex);
        runwayCard = { value: String(days) + 'd', diag: '$' + bankTotal.toFixed(0) + ' / $' + avgDailyOpex.toFixed(0) + '/day', color: days >= 90 ? '#22c55e' : (days >= 30 ? '#eab308' : '#ef4444') };
      }
    }

    function card(label, value, color, sub, onclickRoute) {
      var clickAttr = onclickRoute ? ' onclick="navigateTo(\'' + onclickRoute + '\')" style="cursor:pointer;"' : '';
      return '<div' + clickAttr + ' style="background:var(--bg-secondary,#232323);border-radius:10px;padding:18px;border:1px solid rgba(255,255,255,0.06);' + (onclickRoute ? 'transition:border-color 0.15s;' : '') + '">' +
        '<div style="font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">' + e(label) + '</div>' +
        '<div style="font-size:1.6rem;font-weight:700;color:' + (color || 'var(--text,#fff)') + ';margin-bottom:6px;">' + value + '</div>' +
        '<div style="font-size:0.72rem;color:var(--warm-gray,#888);">' + sub + '</div>' +
        '</div>';
    }

    var cashCard, cashVal, cashSub, cashColor;
    if (!bankConnected) {
      cashVal = '—'; cashSub = 'Connect a bank in Expenses'; cashColor = 'var(--warm-gray,#888)';
    } else {
      cashVal = '$' + MastFormat.moneyRaw(bankTotal); cashSub = 'Across active accounts'; cashColor = '#22c55e';
    }

    // W2 R2-F1: card labels + sub-text template-bound to the active period
    // mode so MTD/QTD/FYTD/Custom all render coherently (no hardcoded "MTD").
    var periodTag = period.mode === 'mtd' ? 'MTD'
                  : period.mode === 'qtd' ? 'QTD'
                  : period.mode === 'fy'  ? 'FYTD'
                  : 'CUSTOM';
    var revSub = '';
    if (revDeltaPct == null) revSub = priorRev === 0 ? ('No prior ' + periodTag + ' comparison') : '—';
    else {
      var sign = revDeltaPct >= 0 ? '+' : '−';
      revSub = sign + Math.abs(Math.round(revDeltaPct)) + '% vs prior ' + periodTag;
    }

    // W3.9: one-time release banner (operator-acknowledged). Inserted ABOVE
    // the cards so it sits at the top of the page. Best-effort; no-throw.
    var w3Banner = '';
    try { w3Banner = await _w3RenderBurdenBannerHtml(); } catch (_) { w3Banner = ''; }

    var h = w3Banner + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">';
    h += card('Cash on Hand', cashVal, cashColor, cashSub, null);
    h += card('AR Outstanding', fmt$(arOutstandingCents), '#3b82f6', MastFormat.countNoun(arCount, 'open invoice'), 'finance-ar');
    h += card('AP Owed', fmt$(apOwedCents), '#f97316', MastFormat.countNoun(apCount, 'open bill'), 'finance-ap');
    h += card(periodTag + ' Revenue', fmt$(periodRev), '#16a34a', revSub, 'finance-revenue');
    h += card('Margin', marginCard.value, marginCard.color, marginCard.diag, 'finance-pl');
    h += card('Runway', runwayCard.value, runwayCard.color, runwayCard.diag, 'finance-cash-flow');
    h += '</div>';

    // W2a.5: Integrations health card — per-provider sync status pills.
    // Reads admin/integrations/_meta.lastSuccessfulSyncAt (provider -> ISO).
    // Color tiers: green if synced <24h, amber 1-7d, red >7d, gray=not-connected.
    h += renderIntegrationsHealthCard(integMeta, qboConn, xeroConn);

    // R-FIN-1 footer — period label is template-bound to the active selector
    // (W2 R2-F1: no hardcoded "MTD"). Dashboard mixes period-windowed
    // (revenue/margin/runway) and point-in-time (cash/AR/AP) data.
    var footerPeriodLabel = 'As of ' + todayStr() + ' · ' + _finPeriodLabel(period) + ' revenue/margin · point-in-time cash/AR/AP';
    _finExporters.financials = function() {
      var rows = [
        ['KPI','Value','Notes'],
        ['Cash on Hand', cashVal, cashSub],
        ['AR Outstanding', '$' + (arOutstandingCents/100).toFixed(2), arCount + ' invoices'],
        ['AP Owed', '$' + (apOwedCents/100).toFixed(2), apCount + ' bills'],
        [periodTag + ' Revenue', '$' + (periodRev/100).toFixed(2), revSub],
        ['Margin', marginCard.value, marginCard.diag],
        ['Runway', runwayCard.value, runwayCard.diag]
      ];
      _finDownloadCsv('financials', rows, 'As of ' + todayStr() + ' · Period: ' + _finPeriodLabel(period) + ' (revenue/margin) · point-in-time (cash/AR/AP)');
    };
    h += _finFooter('financials', footerPeriodLabel, 'plaidItems + orders + admin/purchaseReceipts + admin/expenses');

    el.innerHTML = h;
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px;">' + e(err.message || String(err)) + '</div>';
  }
}
window.renderFinanceOverview = renderFinanceOverview;

// ── W2a.5 Integrations health card ───────────────────────────────────────────
// Per-provider sync status, click-through to filtered Sync Log. Uses font sizes
// from the canonical 7-step rem scale (0.72 / 0.78 / 0.85 / 0.9 / 1.0 / 1.15 / 1.6).
// W2b.2 adds optional pull-direction sub-label (lastPollAt + lastWebhookAt).
function _integrationPill(label, lastSyncIso, status, _ignoredLegacyRouteHash, extras) {
  var color = 'var(--warm-gray,#888)';
  var pillText;
  if (!status || status === 'not-connected') {
    pillText = 'Not connected';
    color = 'var(--warm-gray,#888)';
  } else if (status === 'needs-reconnect') {
    pillText = 'Needs reconnect';
    color = '#ef4444';
  } else if (!lastSyncIso) {
    pillText = 'No sync yet';
    color = 'var(--warm-gray,#888)';
  } else {
    var ageMs = Date.now() - Date.parse(lastSyncIso);
    var ageH = ageMs / 3600000;
    var ageD = ageH / 24;
    if (ageH < 24) { pillText = '< 24h'; color = '#22c55e'; }
    else if (ageD <= 7) { pillText = Math.round(ageD) + 'd'; color = '#eab308'; }
    else { pillText = Math.round(ageD) + 'd'; color = '#ef4444'; }
  }
  // Deep-link: navigate to Settings, then activate the Integrations panel.
  // Use the canonical setTimeout-after-navigate pattern (see index.html:6171
  // and 10272). Plain navigateTo('settings') lands on the default General
  // panel, not Integrations — that bug was caught by Riley persona-verify.
  var clickAttr = ' onclick="navigateTo(\'settings\'); setTimeout(function(){ try { switchSettingsSubView(\'integrations\'); } catch(_) {} }, 50);" style="cursor:pointer;"';
  // W2b.2 — pull-direction sub-label. Always rendered when extras present,
  // even with — placeholders, so operator sees the dimensions exist.
  var subLabel = '';
  if (extras && (extras.lastPollAt || extras.lastWebhookAt || status === 'connected')) {
    function rel(iso) {
      if (!iso) return '—';
      var ms = (typeof iso === 'number') ? iso : Date.parse(iso);
      if (!isFinite(ms)) return '—';
      var minsAgo = (Date.now() - ms) / 60000;
      if (minsAgo < 1) return 'now';
      if (minsAgo < 60) return Math.round(minsAgo) + 'm';
      if (minsAgo < 1440) return Math.round(minsAgo / 60) + 'h';
      return Math.round(minsAgo / 1440) + 'd';
    }
    subLabel =
      '<div style="font-size:0.72rem;color:var(--warm-gray,#888);margin-top:4px;text-align:center;line-height:1.3;">' +
        'Push: ' + e(rel(lastSyncIso)) + ' · Poll: ' + e(rel(extras.lastPollAt || null)) + ' · Webhook: ' + e(rel(extras.lastWebhookAt || null)) +
      '</div>';
  }
  var pillHtml =
    '<div style="display:inline-flex;align-items:center;gap:8px;background:var(--bg-secondary,#232323);border:1px solid rgba(255,255,255,0.08);border-radius:999px;padding:6px 14px;font-size:0.78rem;">' +
      '<span style="font-weight:600;color:var(--text,#fff);">' + e(label) + '</span>' +
      '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';"></span>' +
      '<span style="color:var(--warm-gray,#888);">' + e(pillText) + '</span>' +
    '</div>';
  return '<div' + clickAttr + ' style="display:inline-flex;flex-direction:column;align-items:center;">' + pillHtml + subLabel + '</div>';
}

function renderIntegrationsHealthCard(integMeta, qboConn, xeroConn) {
  var meta = integMeta || {};
  var lastMap = meta.lastSuccessfulSyncAt || {};
  function statusOf(conn) {
    if (!conn || !conn.realmId && !conn.tenantId) return 'not-connected';
    if (conn.status === 'needs-reconnect') return 'needs-reconnect';
    if (conn.status === 'connected') return 'connected';
    return 'not-connected';
  }
  var qboStatus = statusOf(qboConn);
  var xeroStatus = statusOf(xeroConn);
  // W2b.2 — pull-direction sub-label data. lastPollAt + lastWebhookAt are
  // both QBO-only in W2b (Xero pull lands in W2c).
  var qboExtras = { lastPollAt: meta.lastPollAt || null, lastWebhookAt: meta.lastWebhookAt || null };
  var xeroExtras = null;
  var pills =
    _integrationPill('QuickBooks', lastMap.qbo || null, qboStatus, 'settings', qboExtras) +
    _integrationPill('Xero', lastMap.xero || null, xeroStatus, 'settings', xeroExtras);
  return '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:18px;margin-top:14px;border:1px solid rgba(255,255,255,0.06);">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<div style="font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;">Integrations health</div>' +
      '<div style="font-size:0.72rem;color:var(--warm-gray,#888);">Push · Poll · Webhook timestamps per provider · click to open Settings</div>' +
    '</div>' +
    '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">' + pills + '</div>' +
    '</div>';
}

window.renderIntegrationsHealthCard = renderIntegrationsHealthCard;
window._integrationPill = _integrationPill;

// ============================================================================
// Close v3 — Period Close tab (Idea -OtQH_uRXqz9jJBRsmrj, sub-task 3)
// ============================================================================
// Lists the last 12 months. Each row shows status (Open / Closed / Auto-closed),
// aggregate variance + opening + closing cash, and CTA. CF /writePeriodClose
// performs the actual close; on response.code==='unclosedDays' we surface a
// modal listing the offending dates with deep-links back to Day Close UI.

function _pcMonthRange(monthStr) {
  // monthStr = "YYYY-MM". Return {start, end} ISO date strings (inclusive).
  var parts = monthStr.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var start = new Date(Date.UTC(y, m - 1, 1));
  var end = new Date(Date.UTC(y, m, 0));
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return {
    start: start.getUTCFullYear() + '-' + pad(start.getUTCMonth() + 1) + '-' + pad(start.getUTCDate()),
    end:   end.getUTCFullYear()   + '-' + pad(end.getUTCMonth() + 1)   + '-' + pad(end.getUTCDate())
  };
}

function _pcLast12Months() {
  var out = [];
  var d = new Date();
  d.setUTCDate(1);
  for (var i = 0; i < 12; i++) {
    var y = d.getUTCFullYear();
    var m = d.getUTCMonth() + 1;
    out.push(y + '-' + (m < 10 ? '0' + m : '' + m));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function _pcMonthLabel(monthStr) {
  var parts = monthStr.split('-');
  var d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1));
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function renderPeriodClose() {
  var el = document.getElementById('financePeriodCloseTab');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--warm-gray,#888);padding:20px;text-align:center;">Loading period close…</div>';
  try {
    // Close v3: canonical paths are `closes/day/{date}/v{n}` subcollections
    // and `closes/period/{periodId}/v{n}`. Fan out per-month reads using
    // raw firebase.firestore() (MastDB can't reach subcollections).
    var months = _pcLast12Months();
    var perMonthDays = await Promise.all(months.map(_dcLoadLatestDayClosesForMonth));
    var perMonthClose = await Promise.all(months.map(_dcLoadLatestPeriodClose));
    var latestByDate = {};
    perMonthDays.forEach(function(map) {
      Object.keys(map).forEach(function(d) { latestByDate[d] = map[d]; });
    });
    var periodCloses = {};
    months.forEach(function(monthStr, idx) {
      if (perMonthClose[idx]) periodCloses[monthStr] = perMonthClose[idx];
    });
    var h = '<div style="max-width:960px;">';
    h += '<h3 style="margin:0 0 14px;font-size:1rem;font-weight:700;">Period Close — last 12 months</h3>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:14px;">Closing a period locks all day closes in the month. Day closes can still be re-closed (creates new versions) until the period is closed.</div>';
    h += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
    h += '<thead><tr style="text-align:left;color:var(--warm-gray,#888);font-size:0.78rem;">';
    h += '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.12);">Month</th>';
    h += '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.12);">Status</th>';
    h += '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.12);text-align:right;">Opening cash</th>';
    h += '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.12);text-align:right;">Closing cash</th>';
    h += '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.12);text-align:right;">Variance</th>';
    h += '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.12);"></th>';
    h += '</tr></thead><tbody>';
    months.forEach(function(monthStr) {
      var range = _pcMonthRange(monthStr);
      var openingSum = 0, closingSum = 0, varianceSum = 0, dayCount = 0;
      Object.keys(latestByDate).forEach(function(d) {
        if (d >= range.start && d <= range.end) {
          var v = latestByDate[d];
          openingSum += v.openingCashCents || 0;
          closingSum += v.closingCashCents || 0;
          varianceSum += v.varianceCents || 0;
          dayCount++;
        }
      });
      var pc = periodCloses[monthStr] || null;
      var statusChip = '';
      if (pc && pc.status === 'closed') {
        var ts = pc.closedAt ? String(pc.closedAt).replace('T',' ').slice(0,16) : '';
        statusChip = '<span style="background:rgba(34,197,94,0.18);color:#22c55e;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;">Closed</span>'
          + (ts ? ' <span style="color:var(--warm-gray,#888);font-size:0.72rem;">' + e(ts) + '</span>' : '');
      } else if (pc && pc.status === 'auto-closed') {
        var ats = pc.autoClosedAt ? String(pc.autoClosedAt).replace('T',' ').slice(0,16) : '';
        statusChip = '<span style="background:rgba(99,102,241,0.18);color:#818cf8;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;">Auto-closed</span>'
          + (ats ? ' <span style="color:var(--warm-gray,#888);font-size:0.72rem;">' + e(ats) + '</span>' : '');
      } else {
        statusChip = '<span style="background:rgba(234,179,8,0.18);color:#eab308;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;">Open</span>';
      }
      var rowClickAttr = (pc ? 'onclick="finPeriodCloseDrillDown(\'' + _jsAttrSafe(monthStr) + '\')" style="cursor:pointer;"' : '');
      h += '<tr ' + rowClickAttr + '>';
      h += '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);font-weight:600;">' + e(_pcMonthLabel(monthStr)) + '</td>';
      h += '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">' + statusChip + '</td>';
      h += '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);text-align:right;">' + e(fmt$(openingSum)) + '</td>';
      h += '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);text-align:right;">' + e(fmt$(closingSum)) + '</td>';
      h += '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);text-align:right;color:' + (varianceSum === 0 ? 'var(--warm-gray,#888)' : (Math.abs(varianceSum) < 500 ? '#22c55e' : '#eab308')) + ';">' + e(fmt$(varianceSum)) + '</td>';
      h += '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);text-align:right;">';
      if (!pc) {
        h += '<button class="btn btn-primary btn-small" onclick="event.stopPropagation();finPeriodCloseRun(\'' + _jsAttrSafe(monthStr) + '\')">Close ' + e(_pcMonthLabel(monthStr).split(' ')[0]) + '</button>';
      } else {
        h += '<span style="color:var(--warm-gray,#888);font-size:0.78rem;">' + MastFormat.countNoun(dayCount, 'day') + '</span>';
      }
      h += '</td></tr>';
    });
    h += '</tbody></table>';
    h += '</div>';
    el.innerHTML = h;
  } catch (err) {
    el.innerHTML = '<div style="padding:20px;color:var(--danger,#dc2626);">Failed to load period close: ' + e(err.message || err) + '</div>';
  }
}

// ── Close v3 state-free cores (shared with the V2 close hub via FinanceBridge) ──
function _closeV3RequestId() {
  return (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID()
    : ('rid-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}
// Throws on failure; the unclosedDays precondition surfaces as
// err.message === 'unclosedDays' with err.details.dates = [...].
async function _closePeriodCore(periodId) {
  var json = await _closeV3Call('writePeriodClose', { periodId: periodId, requestId: _closeV3RequestId() });
  if (!json || json.ok !== true) {
    console.error('[close-v3] writePeriodClose returned non-ok response:', json);
    throw new Error((json && (json.message || json.error || json.code)) || 'CF returned no ok flag');
  }
  try { await writeAudit('create', 'periodClose', periodId); } catch (xerr) {}
  return json;
}
async function _amendApproveCore(amendmentId, periodId) {
  // periodId is REQUIRED in practice: the CF's no-hint collection-group
  // fallback throws INTERNAL (FieldPath.documentId() rejects bare ids).
  var json = await _closeV3Call('approveAmendment', { amendmentId: amendmentId, periodId: periodId || null, requestId: _closeV3RequestId() });
  if (!json || json.ok !== true) {
    console.error('[close-v3] approveAmendment returned non-ok response:', json);
    throw new Error((json && (json.message || json.error || json.code)) || 'CF returned no ok flag');
  }
  try { await writeAudit('update', 'amendment', amendmentId + ':approved'); } catch (xerr) {}
  return json;
}
async function _amendRejectCore(amendmentId, reason, periodId) {
  var json = await _closeV3Call('rejectAmendment', { amendmentId: amendmentId, periodId: periodId || null, reason: (reason || '').trim(), requestId: _closeV3RequestId() });
  if (!json || json.ok !== true) {
    console.error('[close-v3] rejectAmendment returned non-ok response:', json);
    throw new Error((json && (json.message || json.error || json.code)) || 'CF returned no ok flag');
  }
  try { await writeAudit('update', 'amendment', amendmentId + ':rejected'); } catch (xerr) {}
  return json;
}

window.finPeriodCloseRun = async function(monthStr) {
  if (!_isSafeFbKey(monthStr.replace('-', ''))) { showToast('Invalid period.', true); return; }
  var ok = await mastConfirm('Close period ' + _pcMonthLabel(monthStr) + '? After closing, day closes in this month become read-only.', { title: 'Close period', confirmLabel: 'Close period' });
  if (!ok) return;
  try {
    await _closePeriodCore(monthStr);
    showToast('Closed ' + _pcMonthLabel(monthStr));
    renderPeriodClose();
  } catch (err) {
    console.error('[close-v3] writePeriodClose threw:', err);
    // Agent A throws HttpsError('failed-precondition', 'unclosedDays', {dates:[...]}).
    // httpsCallable surfaces this as err.code = 'failed-precondition',
    // err.message = 'unclosedDays', err.details = {code:'unclosedDays', dates:[...]}.
    var details = err && err.details;
    var dates = (details && Array.isArray(details.dates)) ? details.dates : null;
    if ((err && err.message === 'unclosedDays') && dates) {
      var listHtml = '<div style="margin-bottom:10px;color:var(--warm-gray,#888);font-size:0.85rem;">The following dates have no closed day. Close each, then re-run period close.</div>';
      listHtml += '<ul style="margin:0;padding-left:18px;font-size:0.85rem;">';
      dates.forEach(function(d) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          listHtml += '<li style="margin-bottom:4px;"><a href="#finance-cash-flow?subView=dayclose&date=' + e(d) + '" style="color:#22c55e;text-decoration:underline;">' + e(d) + '</a></li>';
        }
      });
      listHtml += '</ul>';
      _pcShowInfoModal('Cannot close ' + _pcMonthLabel(monthStr), listHtml);
      return;
    }
    showToast('Close failed: ' + (err.message || err), true);
  }
};

window.finPeriodCloseDrillDown = async function(monthStr) {
  if (!_isSafeFbKey(monthStr.replace('-', ''))) return;
  try {
    // Close v3: read from versioned subcollections via raw firebase.firestore().
    var pc = await _dcLoadLatestPeriodClose(monthStr);
    if (!pc) { showToast('No close record for ' + monthStr, true); return; }
    var latestByDate = await _dcLoadLatestDayClosesForMonth(monthStr);
    var rows = Object.keys(latestByDate).map(function(d) { return latestByDate[d]; });
    rows.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
    var rollup = pc.rollup || {};
    var inner = '<div style="margin-bottom:10px;font-size:0.85rem;">';
    inner += '<div>Status: <strong>' + e(pc.status || 'unknown') + '</strong></div>';
    if (pc.closedAt) inner += '<div>Closed at: ' + e(String(pc.closedAt).replace('T',' ').slice(0,16)) + '</div>';
    if (pc.closedByName || pc.closedBy) inner += '<div>Closed by: ' + _finRenderUserCell(pc.closedBy, pc.closedByName) + '</div>';
    inner += '<div>Rollup variance: <strong>' + e(fmt$(rollup.varianceCentsSum || 0)) + '</strong></div>';
    inner += '<div>Opening sum: ' + e(fmt$(rollup.openingCashCentsSum || 0)) + ' &middot; Closing sum: ' + e(fmt$(rollup.closingCashCentsSum || 0)) + '</div>';
    inner += '</div>';
    inner += '<div style="max-height:280px;overflow-y:auto;">';
    inner += '<table style="width:100%;font-size:0.78rem;border-collapse:collapse;">';
    inner += '<thead><tr><th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.12);">Date</th><th style="text-align:right;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.12);">Variance</th><th style="padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.12);"></th></tr></thead><tbody>';
    rows.forEach(function(v) {
      inner += '<tr><td style="padding:4px 6px;">' + e(v.date) + ' <span style="color:var(--warm-gray,#888);">v' + e(String(v.version || 1)) + '</span></td>';
      inner += '<td style="padding:4px 6px;text-align:right;">' + e(fmt$(v.varianceCents || 0)) + '</td>';
      inner += '<td style="padding:4px 6px;text-align:right;"><a href="#finance-cash-flow?subView=dayclose&date=' + e(v.date) + '" style="color:#22c55e;text-decoration:underline;font-size:0.72rem;">Open</a></td></tr>';
    });
    if (rows.length === 0) inner += '<tr><td colspan="3" style="padding:8px;color:var(--warm-gray,#888);">No day closes.</td></tr>';
    inner += '</tbody></table></div>';
    _pcShowInfoModal(_pcMonthLabel(monthStr) + ' — period close detail', inner);
  } catch (err) {
    showToast('Failed to load drill-down: ' + (err.message || err), true);
  }
};

function _pcShowInfoModal(title, innerHtml) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  var h = '<div style="background:var(--bg-secondary,#232323);border-radius:10px;max-width:640px;width:96%;padding:22px 24px;box-shadow:0 8px 30px rgba(0,0,0,0.4);color:var(--text,#fff);">';
  h += '<div style="font-size:1.0rem;font-weight:700;margin-bottom:14px;">' + e(title) + '</div>';
  h += '<div>' + innerHtml + '</div>';
  h += '<div style="display:flex;justify-content:flex-end;margin-top:18px;">';
  h += '<button class="btn btn-primary" id="pcInfoClose">Close</button>';
  h += '</div></div>';
  overlay.innerHTML = h;
  document.body.appendChild(overlay);
  // Close v3 fix-up: async-resolve any raw UIDs into displayName/email.
  _finPatchUidLabels(overlay);
  function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
  overlay.querySelector('#pcInfoClose').addEventListener('click', close);
  overlay.addEventListener('click', function(ev) { if (ev.target === overlay) close(); });
}

window.renderPeriodClose = renderPeriodClose;

// ============================================================================
// Close v3 — Amendments tab (Idea -OtQH_uRXqz9jJBRsmrj, sub-task 6)
// ============================================================================
// Operators submit amendments against closed-period records elsewhere; this UI
// surfaces the queue for approval/rejection. Approve writes a counter-entry
// to the next open period (Agent A's CF /approveAmendment); reject is a
// simple status update with optional reason. All actions audit-logged.

function _amDiffRows(before, after) {
  // Produce a list of {field, before, after} for keys that changed. Both args
  // are plain objects (typically a snapshot of the targeted Firebase doc).
  before = before || {};
  after = after || {};
  var keys = {};
  Object.keys(before).forEach(function(k) { keys[k] = true; });
  Object.keys(after).forEach(function(k) { keys[k] = true; });
  var rows = [];
  Object.keys(keys).forEach(function(k) {
    var b = before[k], a = after[k];
    var bStr = (typeof b === 'object' ? JSON.stringify(b) : (b == null ? '' : String(b)));
    var aStr = (typeof a === 'object' ? JSON.stringify(a) : (a == null ? '' : String(a)));
    if (bStr !== aStr) rows.push({ field: k, before: bStr, after: aStr });
  });
  return rows;
}

async function renderAmendments() {
  var el = document.getElementById('financeAmendmentsTab');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--warm-gray,#888);padding:20px;text-align:center;">Loading amendments…</div>';
  try {
    // Close v3: amendments live at `amendments/{periodId}/items/{id}` (subcollection).
    // Fan out the last-12-months periodIds and merge — collectionGroup is
    // available too but needs a composite index (deferred).
    var rows = await _dcLoadRecentAmendments();
    // Sort: pending first by submittedAt desc, then approved/rejected by submittedAt desc.
    rows.sort(function(a, b) {
      var aPending = a.status === 'pending' ? 0 : 1;
      var bPending = b.status === 'pending' ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      return (b.submittedAt || '') < (a.submittedAt || '') ? -1 : 1;
    });
    // Group by periodId.
    var groups = {};
    rows.forEach(function(r) {
      var p = r.periodId || '(no period)';
      if (!groups[p]) groups[p] = [];
      groups[p].push(r);
    });
    var canApprove = (typeof hasPermission === 'function') && hasPermission('finance', 'approveAmendment');
    var h = '<div style="max-width:960px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:8px;">';
    h += '<h3 style="margin:0;font-size:1rem;font-weight:700;">Amendments</h3>';
    h += '<button class="btn btn-primary btn-small" onclick="finAmendmentOpenSubmit()">+ Submit Amendment</button>';
    h += '</div>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:14px;">';
    h += 'Proposed changes to closed-period records. Approve writes a counter-entry to the next open period rather than mutating the immutable past.';
    if (!canApprove) {
      h += ' <strong style="color:#eab308;">You do not have the approveAmendment permission</strong> — Approve buttons are disabled.';
    }
    h += '</div>';
    if (rows.length === 0) {
      h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:24px;text-align:center;color:var(--warm-gray,#888);font-size:0.85rem;">No amendments submitted yet.</div>';
    }
    var groupKeys = Object.keys(groups).sort().reverse();
    groupKeys.forEach(function(p) {
      h += '<div style="margin-bottom:18px;">';
      h += '<div style="font-size:0.85rem;font-weight:700;margin-bottom:8px;color:var(--warm-gray,#888);">Period: ' + e(p) + ' <span style="font-weight:400;">(' + groups[p].length + ')</span></div>';
      groups[p].forEach(function(a) {
        h += '<div style="background:var(--bg-secondary,#232323);border-radius:10px;padding:14px 16px;margin-bottom:10px;">';
        // Header row: target + status + meta
        var statusColor = a.status === 'pending' ? '#eab308' : (a.status === 'approved' ? '#22c55e' : '#dc2626');
        var statusBg = a.status === 'pending' ? 'rgba(234,179,8,0.18)' : (a.status === 'approved' ? 'rgba(34,197,94,0.18)' : 'rgba(220,38,38,0.18)');
        h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">';
        h += '<div>';
        h += '<div style="font-size:0.85rem;font-weight:600;">' + e(a.targetCollection || 'unknown') + ' / <code style="font-size:0.78rem;">' + e(a.targetId || '?') + '</code></div>';
        var subCell = _finRenderUserCell(a.submittedBy, a.submittedByName);
        var subAt = a.submittedAt ? String(a.submittedAt).replace('T',' ').slice(0,16) : '';
        h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);margin-top:2px;">Submitted by ' + subCell + (subAt ? ' at ' + e(subAt) : '') + '</div>';
        h += '</div>';
        h += '<span style="background:' + statusBg + ';color:' + statusColor + ';padding:2px 10px;border-radius:10px;font-size:0.72rem;font-weight:700;">' + e((a.status || 'pending').toUpperCase()) + '</span>';
        h += '</div>';
        // Reason
        if (a.reason) {
          h += '<div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:8px 10px;font-size:0.85rem;margin-bottom:10px;"><strong style="color:var(--warm-gray,#888);">Reason:</strong> ' + e(a.reason) + '</div>';
        }
        // Diff table
        var diffs = _amDiffRows(a.before, a.after);
        if (diffs.length === 0) {
          h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:10px;">No field-level diff captured.</div>';
        } else {
          h += '<table style="width:100%;font-size:0.78rem;border-collapse:collapse;margin-bottom:10px;">';
          h += '<thead><tr><th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.12);">Field</th><th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.12);">Before</th><th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.12);">After</th></tr></thead><tbody>';
          diffs.forEach(function(d) {
            h += '<tr><td style="padding:4px 6px;font-weight:600;">' + e(d.field) + '</td>';
            h += '<td style="padding:4px 6px;color:#eab308;">' + e(d.before || '(empty)') + '</td>';
            h += '<td style="padding:4px 6px;color:#22c55e;">' + e(d.after || '(empty)') + '</td></tr>';
          });
          h += '</tbody></table>';
        }
        // Action row (pending only)
        if (a.status === 'pending') {
          h += '<div style="display:flex;justify-content:flex-end;gap:8px;align-items:center;">';
          var apprDisabled = canApprove ? '' : ' disabled style="opacity:0.5;cursor:not-allowed;"';
          h += '<button class="btn btn-secondary btn-small" onclick="finAmendmentReject(\'' + _jsAttrSafe(a.id) + '\',\'' + _jsAttrSafe(a.periodId || '') + '\')">Reject</button>';
          h += '<button class="btn btn-primary btn-small"' + apprDisabled + ' onclick="finAmendmentApprove(\'' + _jsAttrSafe(a.id) + '\',\'' + _jsAttrSafe(a.reason || '') + '\',\'' + _jsAttrSafe(a.periodId || '') + '\')">Approve</button>';
          h += '</div>';
        } else if (a.status === 'approved') {
          var apTs = a.approvedAt ? String(a.approvedAt).replace('T',' ').slice(0,16) : '';
          var apCell = _finRenderUserCell(a.approvedBy, a.approvedByName);
          h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);">Approved by ' + apCell + (apTs ? ' at ' + e(apTs) : '') + (a.counterEntryId ? ' &middot; counter-entry <code>' + e(a.counterEntryId) + '</code>' : '') + '</div>';
        } else if (a.status === 'rejected') {
          var rjTs = a.rejectedAt ? String(a.rejectedAt).replace('T',' ').slice(0,16) : '';
          var rjCell = _finRenderUserCell(a.rejectedBy, a.rejectedByName);
          h += '<div style="font-size:0.72rem;color:var(--warm-gray,#888);">Rejected by ' + rjCell + (rjTs ? ' at ' + e(rjTs) : '') + (a.rejectReason ? ' &middot; ' + e(a.rejectReason) : '') + '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    });
    h += '</div>';
    el.innerHTML = h;
    // Close v3 fix-up: async-resolve any raw UIDs into displayName/email.
    _finPatchUidLabels(el);
  } catch (err) {
    el.innerHTML = '<div style="padding:20px;color:var(--danger,#dc2626);">Failed to load amendments: ' + e(err.message || err) + '</div>';
  }
}

window.finAmendmentApprove = async function(amendmentId, reasonText, periodId) {
  if (!_isSafeFbKey(amendmentId)) { showToast('Invalid amendment ID.', true); return; }
  if (!hasPermission('finance', 'approveAmendment')) {
    showToast('You do not have permission to approve amendments.', true);
    return;
  }
  var ok = await mastConfirm('This writes a counter-entry to the next open period. Reason: ' + (reasonText || '(none provided)'), { title: 'Approve amendment', confirmLabel: 'Approve' });
  if (!ok) return;
  try {
    var json = await _amendApproveCore(amendmentId, periodId);
    showToast('Amendment approved' + (json.counterEntryId ? ' (counter-entry ' + json.counterEntryId + ')' : ''));
    renderAmendments();
  } catch (err) {
    console.error('[close-v3] approveAmendment threw:', err);
    var amsg = (err && err.message) || (err && err.code) || String(err) || 'unknown error';
    if (err && err.details && err.details.code) amsg += ' (' + err.details.code + ')';
    showToast('Approve failed: ' + amsg, true);
  }
};

window.finAmendmentReject = async function(amendmentId, periodId) {
  if (!_isSafeFbKey(amendmentId)) { showToast('Invalid amendment ID.', true); return; }
  var reason = await mastPrompt('Reject reason (optional):', { title: 'Reject amendment', confirmLabel: 'Reject', placeholder: 'e.g. duplicate, lacks supporting evidence' });
  if (reason === null) return; // cancelled
  try {
    await _amendRejectCore(amendmentId, reason, periodId);
    showToast('Amendment rejected');
    renderAmendments();
  } catch (err) {
    console.error('[close-v3] rejectAmendment threw:', err);
    var rmsg = (err && err.message) || (err && err.code) || String(err) || 'unknown error';
    if (err && err.details && err.details.code) rmsg += ' (' + err.details.code + ')';
    showToast('Reject failed: ' + rmsg, true);
  }
};

window.renderAmendments = renderAmendments;

// ─── Submit Amendment modal (Close v3 reconciliation, item 6) ─────────────────
// Admin/staff (finance:write) submits a proposed change against a record in
// a closed period. Inputs:
//   - target collection (orders | refunds | expenses | vendorBills)
//   - target doc id
//   - reason (>= 10 chars; the CF re-validates server-side)
//   - after-shape JSON (full proposed doc shape — NOT a delta)
//
// `before` is server-fetched by routeAmendment (we don't pre-fetch here —
// the CF rejects with not-found if the doc doesn't exist, which surfaces
// the right error to the operator). Gate matches Agent A's CF
// (_assertAdminOrStaff). The Approve perm is checked separately.

// State-free submit core — both the classic modal and the V2 close hub call
// this. Stamps submittedByName, invokes the routeAmendment CF, enforces the
// explicit ok===true contract (R2-F1), and writes the client audit row.
// Throws on any failure; resolves with the CF response ({amendmentId, periodId}).
async function _amendSubmitCore(args) {
  var subName = (firebase.auth().currentUser && (firebase.auth().currentUser.displayName || firebase.auth().currentUser.email)) || null;
  var json = await _closeV3Call('routeAmendment', {
    targetCollection: args.targetCollection,
    targetId: args.targetId,
    after: args.after,
    reason: args.reason,
    submittedByName: subName
  });
  // R2-F1: require explicit ok===true. Previously `ok === false` let
  // CF responses with no ok flag (or empty {}) silently pass through to the
  // success path — Sky observed Submit silently doing nothing on real order
  // -Op4nx9IgSynIRi89VZx. Surface non-ok responses as throws; console.error
  // the raw payload for diagnosis.
  if (!json || json.ok !== true) {
    console.error('[close-v3] routeAmendment returned non-ok response:', json);
    var err = new Error((json && (json.message || json.error || json.code)) || 'CF returned no ok flag — check console');
    err.response = json;
    throw err;
  }
  try { await writeAudit('create', 'amendment', json.amendmentId + ':submitted'); } catch (xerr) {}
  return json;
}

window.finAmendmentOpenSubmit = function() {
  // Permission check matches the CF gate (admin OR staff).
  // We don't have a sync `isAdmin` check separate from hasPermission, so
  // fall through to the CF — server is the source of truth — but warn if
  // we can detect the user isn't admin/staff client-side.
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  var collections = [
    { id: 'orders', label: 'Order' },
    { id: 'refunds', label: 'Refund' },
    { id: 'expenses', label: 'Expense' },
    { id: 'vendorBills', label: 'Vendor bill' }
  ];
  var optHtml = collections.map(function(c) {
    return '<option value="' + e(c.id) + '">' + e(c.label) + ' (' + e(c.id) + ')</option>';
  }).join('');
  var inputCss = 'background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text,#fff);padding:6px 8px;font-size:0.85rem;width:100%;box-sizing:border-box;font-family:inherit;';
  var h = '<div style="background:var(--bg-secondary,#232323);border-radius:10px;max-width:640px;width:96%;padding:22px 24px;box-shadow:0 8px 30px rgba(0,0,0,0.4);color:var(--text,#fff);">';
  h += '<div style="font-size:1rem;font-weight:700;margin-bottom:10px;">Submit amendment</div>';
  h += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-bottom:14px;">';
  h += 'Closed-period records cannot be edited directly. Submitting an amendment routes a proposed change to the approval queue. Approval writes a dated counter-entry in the next open period.';
  h += '</div>';
  h += '<div style="display:grid;grid-template-columns:140px 1fr;gap:10px 12px;align-items:center;margin-bottom:14px;">';
  h += '<label style="font-size:0.78rem;color:var(--warm-gray,#888);">Target collection</label>';
  h += '<select id="amSubCol" style="' + inputCss + '">' + optHtml + '</select>';
  h += '<label style="font-size:0.78rem;color:var(--warm-gray,#888);">Target doc ID</label>';
  h += '<input id="amSubId" type="text" placeholder="Firestore document id" style="' + inputCss + '">';
  h += '<label style="font-size:0.78rem;color:var(--warm-gray,#888);align-self:start;padding-top:6px;">Reason (≥ 10 chars)</label>';
  h += '<textarea id="amSubReason" rows="2" placeholder="Why this change?" style="' + inputCss + '"></textarea>';
  h += '<label style="font-size:0.78rem;color:var(--warm-gray,#888);align-self:start;padding-top:6px;">Proposed shape (JSON)</label>';
  h += '<textarea id="amSubAfter" rows="6" placeholder=\'{"amountCents": 12345, "memo": "corrected"}\' style="' + inputCss + 'font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:0.78rem;"></textarea>';
  h += '</div>';
  h += '<div id="amSubErr" style="font-size:0.78rem;color:#dc2626;margin-bottom:10px;min-height:14px;"></div>';
  h += '<div style="display:flex;justify-content:flex-end;gap:8px;">';
  h += '<button class="btn btn-secondary" id="amSubCancel">Cancel</button>';
  h += '<button class="btn btn-primary" id="amSubOK">Submit</button>';
  h += '</div></div>';
  overlay.innerHTML = h;
  document.body.appendChild(overlay);
  function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
  overlay.querySelector('#amSubCancel').addEventListener('click', close);
  overlay.addEventListener('click', function(ev) { if (ev.target === overlay) close(); });
  overlay.querySelector('#amSubOK').addEventListener('click', async function() {
    var errEl = overlay.querySelector('#amSubErr');
    errEl.textContent = '';
    var col = overlay.querySelector('#amSubCol').value;
    var id = (overlay.querySelector('#amSubId').value || '').trim();
    var reason = (overlay.querySelector('#amSubReason').value || '').trim();
    var afterStr = (overlay.querySelector('#amSubAfter').value || '').trim();
    if (!id) { errEl.textContent = 'Target doc ID required.'; return; }
    if (reason.length < 10) { errEl.textContent = 'Reason must be at least 10 characters.'; return; }
    var afterObj;
    try { afterObj = JSON.parse(afterStr); }
    catch (perr) { errEl.textContent = 'Proposed shape is not valid JSON: ' + perr.message; return; }
    if (!afterObj || typeof afterObj !== 'object' || Array.isArray(afterObj)) {
      errEl.textContent = 'Proposed shape must be a JSON object.'; return;
    }
    try {
      var json = await _amendSubmitCore({ targetCollection: col, targetId: id, after: afterObj, reason: reason });
      showToast('Amendment submitted for period ' + json.periodId);
      close();
      renderAmendments();
    } catch (err) {
      console.error('[close-v3] routeAmendment threw:', err);
      var emsg = (err && err.message) || (err && err.code) || String(err) || 'unknown error';
      if (err && err.details && err.details.code) emsg += ' (' + err.details.code + ')';
      errEl.textContent = 'Submit failed: ' + emsg;
      showToast('Amendment submit failed: ' + emsg, true);
    }
  });
};
window.finAmendmentSubmit = window.finAmendmentOpenSubmit; // alias

// ─────────────────────────────────────────────────────────────────────────────
// W3 — Burdened Labor Cost (Agent C surface)
// Concepts: D-FIN-W3-5 (COGS rollup), D-FIN-W3-6 (per-job/per-product surface),
// D-FIN-W3-9 (release-note banner), D-FIN-W3-11 (Fixed Overhead line),
// R-FIN-W3-1 (mixed-source surfaces lowest-confidence chip),
// D-FIN-W3-12 (confidence heuristic).
//
// POST-REWORK (W3-rework H1+cross-repo): flat-collection convention.
//   admin_burdenedLaborCost/{periodId}__{employeeId}
//     → { periodId, employeeId, totalBurden, source, payPeriodStart/End,
//         wages, employerFica, futa, suta, wcPremium, retirement, benefits[] }
//   admin_burdenedLaborByJob/{periodId}__{employeeId}__{jobId}
//     → { periodId, employeeId, jobId, allocatedBurden, hoursOnJob,
//         allocationMethod, computedAt }
//   admin_integrations/_meta.burdenSource → { defaultMode, estimatorMultipliers,
//                                             lastSeededAt, bannerState }
//
// MastDB.get('admin/burdenedLaborCost') translates to the flat collection and
// returns a map keyed by COMPOSITE ID. We group by `periodId` field (always
// denormalized) and key the per-period byEmployee map by `employeeId` field
// for downstream callers that still expect that shape.
//
// periodId is 'YYYY-MM-DD_YYYY-MM-DD' (Agent A canonical: pay-period range
// matching PERIOD_ID_RE in mast-architecture/functions/labor-burden.js).
// _overhead is a reserved jobId for un-attributable hours.

var _w3BurdenCache = {};       // { periodId: { byEmployee, byJob, fetchedAt } }
var _w3FlatCache = null;       // { byPeriod: {periodId: {byEmp, byJobByJobId}}, fetchedAt }
var _w3MetaCache  = null;
var _w3ConfidenceCache = null;
var _w3PeriodIdListCache = null; // { periodIds:[], fetchedAt }

var _W3_PERIOD_ID_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;

// M3 fix-up: single helper for invalidating every W3 cache layer at once.
// Mutation paths (banner enable/dismiss, estimator-config save, burden-entry
// write via MCP) all call this so a stale layer doesn't leak past a write.
function _w3InvalidateMetaCache() {
  _w3MetaCache = null;
  _w3BurdenCache = {};
  _w3FlatCache = null;
  _w3PeriodIdListCache = null;
  _w3ConfidenceCache = null;
}

// Load the entire flat collection ONCE, group by periodId. Cached for 30s.
async function _w3LoadFlat() {
  if (_w3FlatCache && (Date.now() - _w3FlatCache.fetchedAt) < 30000) return _w3FlatCache;
  var byPeriod = {};
  try {
    var allBurden = (await MastDB.get('admin/burdenedLaborCost')) || {};
    Object.keys(allBurden).forEach(function(compositeId) {
      var rec = allBurden[compositeId];
      if (!rec || typeof rec !== 'object') return;
      var pid = rec.periodId;
      var eid = rec.employeeId;
      // Tolerate legacy/older docs without denormalized fields by parsing
      // the composite id (periodId is YYYY-MM-DD_YYYY-MM-DD, contains no __).
      if (!pid || !eid) {
        var sep = compositeId.indexOf('__');
        if (sep > 0) {
          if (!pid) pid = compositeId.slice(0, sep);
          if (!eid) eid = compositeId.slice(sep + 2);
        }
      }
      if (!pid || !eid) return;
      if (!byPeriod[pid]) byPeriod[pid] = { byEmployee: {}, byJob: {} };
      byPeriod[pid].byEmployee[eid] = rec;
    });
  } catch (_) {}
  try {
    var allByJob = (await MastDB.get('admin/burdenedLaborByJob')) || {};
    Object.keys(allByJob).forEach(function(compositeId) {
      var rec = allByJob[compositeId];
      if (!rec || typeof rec !== 'object') return;
      var pid = rec.periodId;
      var eid = rec.employeeId;
      var jid = rec.jobId;
      if (!pid || !eid || !jid) {
        // Parse composite id `{periodId}__{employeeId}__{jobId}`.
        // periodId contains no __; employeeId could (defensively split from end).
        var parts = compositeId.split('__');
        if (parts.length >= 3) {
          if (!pid) pid = parts[0];
          if (!jid) jid = parts[parts.length - 1];
          if (!eid) eid = parts.slice(1, parts.length - 1).join('__');
        }
      }
      if (!pid || !jid) return;
      if (!byPeriod[pid]) byPeriod[pid] = { byEmployee: {}, byJob: {} };
      if (!byPeriod[pid].byJob[jid]) byPeriod[pid].byJob[jid] = {};
      // Key by `{employeeId}__{jobId}` row id so summarize can iterate
      // multiple employees per (period, job) tuple without colliding.
      var rowId = (eid || '_unknown') + '__' + jid;
      byPeriod[pid].byJob[jid][rowId] = rec;
    });
  } catch (_) {}
  _w3FlatCache = { byPeriod: byPeriod, fetchedAt: Date.now() };
  return _w3FlatCache;
}

async function _w3PeriodsForRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  // R2-H2: Enumerate periodIds from the actual collection (parse from composite
  // doc IDs `{periodId}__{employeeId}`) — not from a derived cache that may
  // miss recently-written entries. We deduplicate via a Set since multiple
  // employees share a periodId.
  var listing = _w3PeriodIdListCache;
  var fresh = listing && (Date.now() - listing.fetchedAt) < 30000;
  if (!fresh) {
    var periodSet = {};
    try {
      var allBurden = (await MastDB.get('admin/burdenedLaborCost')) || {};
      Object.keys(allBurden).forEach(function(compositeId) {
        var rec = allBurden[compositeId] || {};
        // Prefer denormalized periodId; fall back to parsing the composite ID.
        var pid = rec.periodId;
        if (!pid) {
          var sep = compositeId.indexOf('__');
          if (sep > 0) pid = compositeId.slice(0, sep);
        }
        if (pid && _W3_PERIOD_ID_RE.test(pid)) periodSet[pid] = true;
      });
    } catch (_) {}
    listing = { periodIds: Object.keys(periodSet), fetchedAt: Date.now() };
    _w3PeriodIdListCache = listing;
  }
  var out = [];
  for (var i = 0; i < listing.periodIds.length; i++) {
    var pid2 = listing.periodIds[i];
    var m = _W3_PERIOD_ID_RE.exec(pid2);
    if (!m) continue;
    var pStart = m[1], pEnd = m[2];
    // Overlap test on ISO YYYY-MM-DD strings — lexicographic compare is correct.
    if (pStart <= endDate && pEnd >= startDate) out.push(pid2);
    if (out.length > 200) break; // safety
  }
  return out;
}

async function _w3LoadBurdenForPeriod(periodId) {
  if (_w3BurdenCache[periodId]) return _w3BurdenCache[periodId];
  var flat = await _w3LoadFlat();
  var p = (flat.byPeriod || {})[periodId] || { byEmployee: {}, byJob: {} };
  var entry = { byEmployee: p.byEmployee || {}, byJob: p.byJob || {}, fetchedAt: Date.now() };
  _w3BurdenCache[periodId] = entry;
  return entry;
}

async function _w3LoadBurdenForRange(startDate, endDate) {
  var periods = await _w3PeriodsForRange(startDate, endDate);
  var all = await Promise.all(periods.map(_w3LoadBurdenForPeriod));
  return { periods: periods, perPeriod: all };
}

async function _w3LoadMeta() {
  if (_w3MetaCache) return _w3MetaCache;
  try {
    _w3MetaCache = (await MastDB.get('admin/integrations/_meta/burdenSource')) || {};
  } catch (_) { _w3MetaCache = {}; }
  return _w3MetaCache;
}

// D-FIN-W3-12 local confidence heuristic. Mirrors what Agent D's MCP tool
// finance_get_burden_estimator_config() returns. Start HIGH, drop one level
// per weakness: WC=0 with W2 employees, benefits=0 with W2 employees,
// SUTA = seeded default. Floor LOW.
//
// Post-rework (W3-rework cross-repo): canonical multiplier field names are
// `wc`, `benefits`, `retirement` (NOT `wcRate`/`benefitsRate`). `sutaIsDefault`
// is a COMPUTED signal — never persisted; we derive it locally by comparing
// the suta map to the seed table. Seed table is embedded here (synced annually
// with mast-architecture/functions/state-suta-seed.js STATE_SUTA_DEFAULT_RATES;
// next sync due 2027 January).
var _W3_STATE_SUTA_SEED = Object.freeze({
  AL: 0.0270, AK: 0.0231, AZ: 0.0200, AR: 0.0270, CA: 0.0340,
  CO: 0.0170, CT: 0.0250, DE: 0.0180, DC: 0.0270, FL: 0.0270,
  GA: 0.0264, HI: 0.0300, ID: 0.0097, IL: 0.0375, IN: 0.0250,
  IA: 0.0100, KS: 0.0260, KY: 0.0270, LA: 0.0119, ME: 0.0212,
  MD: 0.0260, MA: 0.0237, MI: 0.0270, MN: 0.0110, MS: 0.0120,
  MO: 0.0227, MT: 0.0130, NE: 0.0125, NV: 0.0295, NH: 0.0270,
  NJ: 0.0280, NM: 0.0100, NY: 0.04025, NC: 0.0100, ND: 0.0119,
  OH: 0.0270, OK: 0.0150, OR: 0.0240, PA: 0.03689, RI: 0.0098,
  SC: 0.0042, SD: 0.0120, TN: 0.0270, TX: 0.0270, UT: 0.0150,
  VT: 0.0100, VA: 0.0250, WA: 0.0118, WV: 0.0270, WI: 0.0305,
  WY: 0.0146
});
function _w3IsSutaDefault(sutaMap) {
  if (!sutaMap || typeof sutaMap !== 'object') return true;
  var keys = Object.keys(sutaMap);
  if (keys.length === 0) return true;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    // team.js writes shape {state: {rate, isOverride, defaultRate?}}; Agent A's
    // canonical estimatorMultipliers.suta is {state: rate}. Tolerate both.
    var v = sutaMap[k];
    if (v && typeof v === 'object' && v.isOverride) return false;
    var seedVal = _W3_STATE_SUTA_SEED[k];
    var cur = (v && typeof v === 'object') ? Number(v.rate) : Number(v);
    if (typeof seedVal !== 'number' || !isFinite(cur)) continue;
    if (Math.abs(seedVal - cur) > 1e-9) return false;
  }
  return true;
}
function _w3ComputeConfidence(meta, hasW2) {
  if (!meta) return 'LOW';
  var levels = ['HIGH', 'MED', 'LOW'];
  var idx = 0;
  var mults = meta.estimatorMultipliers || meta.defaults || meta;
  var wc = +(mults.wc != null ? mults.wc : mults.wcRate) || 0;
  var benefits = +(mults.benefits != null ? mults.benefits : mults.benefitsRate) || 0;
  var sutaIsDefault = _w3IsSutaDefault(mults.suta || mults.sutaByState);
  if (hasW2 && wc <= 0) idx += 1;
  if (hasW2 && benefits <= 0) idx += 1;
  if (sutaIsDefault) idx += 1;
  if (idx >= 2) idx = 2;
  return levels[idx];
}

// Reusable source-tag chip — Agent B and Agent E will copy this visual pattern.
// Signature: renderSourceTagChip(source, confidence) → HTML string.
// `source`: 'estimator' | 'manual' | 'partner-check' | 'partner-gusto' |
//           'partner-cutover' | 'mixed' | null
// `confidence`: 'HIGH' | 'MED' | 'LOW' (only meaningful for estimator + mixed)
function renderSourceTagChip(source, confidence) {
  var label, bg, fg, title = '';
  if (!source || source === 'none') {
    label = 'No data'; bg = 'rgba(107,114,128,0.15)'; fg = '#9ca3af';
  } else if (source === 'manual') {
    label = 'Entered'; bg = 'rgba(59,130,246,0.15)'; fg = '#3b82f6';
    title = 'Operator-entered burden value';
  } else if (source === 'partner-check') {
    label = 'From Check'; bg = 'rgba(34,197,94,0.15)'; fg = '#22c55e';
    title = 'Sourced from Check payroll integration';
  } else if (source === 'partner-gusto') {
    label = 'From Gusto'; bg = 'rgba(34,197,94,0.15)'; fg = '#22c55e';
    title = 'Sourced from Gusto payroll integration';
  } else if (source === 'partner-cutover') {
    label = 'Locked (historical)'; bg = 'rgba(168,85,247,0.15)'; fg = '#a855f7';
    title = 'Pre-partner-integration value — locked at cutover (estimator-locks-historical)';
  } else {
    // estimator or mixed → confidence-tinted
    var c = (confidence || 'MED').toUpperCase();
    var prefix = (source === 'mixed') ? 'Mixed' : 'Est.';
    if (c === 'HIGH') {
      label = prefix + ' (high)'; bg = 'rgba(107,114,128,0.18)'; fg = '#cbd5e1';
    } else if (c === 'LOW') {
      label = prefix + ' (low — configure for accuracy)';
      bg = 'rgba(239,68,68,0.15)'; fg = '#ef4444';
      title = 'Low-confidence burden estimate. Configure WC, benefits, SUTA in Team → Settings.';
    } else {
      label = prefix + ' (med)'; bg = 'rgba(245,158,11,0.15)'; fg = '#f59e0b';
      title = 'Estimator missing one input. Configure for higher confidence.';
    }
  }
  return '<span title="' + e(title) + '" style="background:' + bg + ';color:' + fg +
    ';padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:600;' +
    'white-space:nowrap;vertical-align:middle;">' + e(label) + '</span>';
}

// Aggregate burden across a range. Returns:
//   { totalBurden, byEmployee, byJob, overheadBurden, allocatedBurden,
//     sources (Set), mixedSource (bool), hasData (bool), hasW2 }
// Per O-FIN-W3-4 working assumption: estimator-locks-historical means historical
// periods keep their estimator values forever. Cutover values (source ===
// 'partner-cutover') represent the locked-historical bridge and ARE counted
// (they are real money paid). Operator option to exclude not yet wired.
function _w3SummarizeBurden(rangeResult) {
  var totalBurden = 0, overheadBurden = 0, allocatedBurden = 0;
  var byEmployee = {}, byJob = {};
  var sources = {};
  var hasData = false;
  rangeResult.perPeriod.forEach(function(p) {
    Object.keys(p.byEmployee || {}).forEach(function(eid) {
      var rec = p.byEmployee[eid] || {};
      var b = +rec.totalBurden || 0;
      if (b > 0) { hasData = true; }
      totalBurden += b;
      byEmployee[eid] = (byEmployee[eid] || 0) + b;
      if (rec.source) sources[rec.source] = true;
    });
    Object.keys(p.byJob || {}).forEach(function(jid) {
      var jobBucket = p.byJob[jid] || {};
      Object.keys(jobBucket).forEach(function(rowId) {
        var rec = jobBucket[rowId] || {};
        var a = +rec.allocatedBurden || 0;
        if (a <= 0) return;
        byJob[jid] = (byJob[jid] || 0) + a;
        if (jid === '_overhead') overheadBurden += a;
        else allocatedBurden += a;
        if (rec.source) sources[rec.source] = true;
      });
    });
  });
  var sourceList = Object.keys(sources);
  var mixedSource = sourceList.length > 1;
  // R-FIN-W3-1: when mixed, surface lowest-confidence flavor.
  var dominantSource = sourceList.length === 0 ? null
    : (mixedSource ? 'mixed' : sourceList[0]);
  return {
    totalBurden: totalBurden, overheadBurden: overheadBurden,
    allocatedBurden: allocatedBurden, byEmployee: byEmployee, byJob: byJob,
    sources: sourceList, mixedSource: mixedSource,
    dominantSource: dominantSource, hasData: hasData
    // hasW2 now computed in _w3EnrichPnlWithBurden via _w3HasW2Employees
    // (cross-repo fix: read admin/employees, match employmentType ∈
    // {full-time,part-time} && status !== 'terminated' — same heuristic as
    // MCP _hasAnyW2Employee). Old heuristic (presence of burden record)
    // labeled tenants LOW for W2 employees who hadn't yet entered burden.
  };
}

// Authoritative W2-employee check. Mirrors MCP _hasAnyW2Employee:
// employmentType ∈ {full-time, part-time} AND status !== 'terminated'.
async function _w3HasW2Employees() {
  try {
    var emps = (await MastDB.get('admin/employees')) || {};
    var keys = Object.keys(emps);
    for (var i = 0; i < keys.length; i++) {
      var e = emps[keys[i]];
      if (!e) continue;
      var t = e.employmentType;
      if ((t === 'full-time' || t === 'part-time') && e.status !== 'terminated') return true;
    }
  } catch (_) {}
  return false;
}

// Banner state helpers — admin/integrations/_meta/burdenSource.bannerState.
// { enabledAt, dismissedAt, dismissCount }. Until enabledAt is set, Finance
// READS both base-pay and burdened (computePnlLocal carries both) but
// DISPLAYS base-pay (preserves W1/W2 behavior).
async function _w3IsAcknowledged() {
  var meta = await _w3LoadMeta();
  var bs = (meta && meta.bannerState) || {};
  return !!bs.enabledAt;
}

async function _w3ShouldShowBanner() {
  var meta = await _w3LoadMeta();
  var bs = (meta && meta.bannerState) || {};
  if (bs.enabledAt) return false;
  if (bs.dismissedAt) {
    // Re-prompt 30 days after last dismissal.
    var ms = Date.now() - new Date(bs.dismissedAt).getTime();
    if (ms <= (30 * 24 * 3600 * 1000)) return false;
  }
  // W3.5-4: New tenants created after W3 deploy date never had base-pay COGS,
  // so we silently auto-enable burdened margins for them and skip the banner
  // entirely. Legacy tenants (created before the deploy) still see the
  // opt-in prompt to preserve their existing P&L numbers until they ratify.
  try {
    var W3_DEPLOY_DATE = new Date('2026-05-27T00:00:00Z').getTime();
    var tenantCreatedAt = null;
    if (window.MastDB && typeof window.MastDB.tenantCreatedAt === 'function') {
      tenantCreatedAt = window.MastDB.tenantCreatedAt();
    }
    if (!tenantCreatedAt) {
      // Fallback: read admin/businessEntity/createdAt — canonical creation
      // timestamp stamped by the entity-form save flow (shared/mastdb.js).
      var be = await MastDB.get('admin/businessEntity/createdAt').catch(function() { return null; });
      if (be) tenantCreatedAt = be;
    }
    if (tenantCreatedAt) {
      var tenantCreated = new Date(tenantCreatedAt).getTime();
      if (!isNaN(tenantCreated) && tenantCreated > W3_DEPLOY_DATE) {
        // Fire-and-forget; never block the banner check on this write.
        _w3AutoEnableForNewTenant();
        return false;
      }
    }
  } catch (e) {
    console.warn('[W3.5] tenant-age check failed; falling back to banner:', e);
  }
  // Legacy path: show if never dismissed, or if last dismissal was >30d ago
  // (the early-return above already filtered out within-30d dismissals).
  return true;
}

async function _w3AutoEnableForNewTenant() {
  try {
    var nowIso = new Date().toISOString();
    await MastDB.update('admin/integrations/_meta', {
      'burdenSource.bannerState.enabledAt': nowIso,
      'burdenSource.bannerState.autoEnabled': true
    });
    _w3InvalidateMetaCache();
  } catch (e) {
    console.warn('[W3.5] _w3AutoEnableForNewTenant failed:', e);
  }
}

async function w3EnableAccurateMargins() {
  try {
    var path = 'admin/integrations/_meta/burdenSource/bannerState';
    var now = new Date().toISOString();
    await MastDB.update(path, { enabledAt: now });
    _w3InvalidateMetaCache();
    showToast('Accurate margins enabled — burdened labor now appears in COGS');
    if (typeof renderFinanceOverview === 'function') renderFinanceOverview();
  } catch (err) {
    showToast('Failed to enable: ' + (err.message || err), true);
  }
}
window.w3EnableAccurateMargins = w3EnableAccurateMargins;

async function w3DismissBurdenBanner() {
  try {
    var path = 'admin/integrations/_meta/burdenSource/bannerState';
    var meta = await _w3LoadMeta();
    var bs = (meta && meta.bannerState) || {};
    var count = (+bs.dismissCount || 0) + 1;
    await MastDB.update(path, { dismissedAt: new Date().toISOString(), dismissCount: count });
    _w3InvalidateMetaCache();
    var el = document.getElementById('w3BurdenBanner');
    if (el) el.style.display = 'none';
  } catch (err) {
    showToast('Failed to dismiss: ' + (err.message || err), true);
  }
}
window.w3DismissBurdenBanner = w3DismissBurdenBanner;

// Render release-note banner. Inserted at top of Finance overview on first
// render after deploy. AI-personalized body fetched async via askAiProxy.
async function _w3RenderBurdenBannerHtml() {
  try {
    var show = await _w3ShouldShowBanner();
    if (!show) return '';
  } catch (_) { return ''; }
  var bannerId = 'w3BurdenBanner';
  // Kick off AI body fetch (best-effort; stub copy below renders immediately).
  setTimeout(function() {
    try {
      var tid = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID || null;
      var fn = (window.functions && window.functions.httpsCallable)
        ? window.functions.httpsCallable('askAiProxy') : null;
      if (!fn) return;
      var today = todayStr();
      fn({
        role: 'release-note-co-writer',
        context: { tenantId: tid, periodWindow: { end: today } }
      }).then(function(res) {
        var body = res && res.data && (res.data.body || res.data.text);
        if (!body) return;
        var el = document.getElementById(bannerId + '-body');
        if (el) el.innerHTML = e(body);
      }).catch(function() {});
    } catch (_) {}
  }, 50);
  return '<div id="' + bannerId + '" style="background:linear-gradient(135deg,rgba(20,184,166,0.10),rgba(59,130,246,0.10));' +
    'border:1px solid rgba(20,184,166,0.35);border-radius:10px;padding:14px 18px;margin-bottom:16px;">' +
    '<div style="display:flex;align-items:flex-start;gap:12px;">' +
    '<div style="flex:1;">' +
    '<div style="font-weight:700;font-size:0.9rem;margin-bottom:6px;color:#14b8a6;">' +
      'Mast now uses burdened labor cost for accurate margins.' +
    '</div>' +
    '<div id="' + bannerId + '-body" style="font-size:0.85rem;color:var(--text,#e5e7eb);line-height:1.45;margin-bottom:10px;">' +
      'Wages + employer taxes + benefits + workers&rsquo; comp are now included in COGS. ' +
      'Your gross margin will look more conservative — and more accurate. ' +
      '<em style="color:var(--warm-gray,#888);">Loading personalized explanation…</em>' +
    '</div>' +
    '<div style="display:flex;gap:8px;">' +
    '<button class="btn btn-primary btn-small" onclick="w3EnableAccurateMargins()">Enable accurate margins</button>' +
    '<button class="btn btn-secondary btn-small" onclick="w3DismissBurdenBanner()">Dismiss (re-prompt in 30 days)</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

// W3.5 — augment computePnlLocal output with burdened labor signal so renderPnl
// can fold it into COGS + render Fixed Overhead. Wrapper rather than inline
// rewrite to keep W1 R3-BLOCKER COGS gate logic untouched.
async function _w3EnrichPnlWithBurden(pnl, startDate, endDate) {
  if (!pnl) return pnl;
  try {
    var [rangeResult, ack, meta, hasW2] = await Promise.all([
      _w3LoadBurdenForRange(startDate, endDate),
      _w3IsAcknowledged(),
      _w3LoadMeta(),
      _w3HasW2Employees()
    ]);
    var summary = _w3SummarizeBurden(rangeResult);
    summary.hasW2 = hasW2; // back-compat for callers that still read this field
    var confidence = _w3ComputeConfidence(meta, hasW2);
    pnl._burden = {
      acknowledged: ack,
      hasData: summary.hasData,
      totalBurden: summary.totalBurden,
      overheadBurden: summary.overheadBurden,
      allocatedBurden: summary.allocatedBurden,
      byEmployee: summary.byEmployee,
      byJob: summary.byJob,
      sources: summary.sources,
      mixedSource: summary.mixedSource,
      dominantSource: summary.dominantSource,
      confidence: confidence,
      // What the UI should actually display:
      displayMode: ack ? 'burdened' : 'base-pay',
      // Effective COGS labor add: only counted when acknowledged AND has data.
      effectiveLaborCogsCents: (ack && summary.hasData) ? (summary.allocatedBurden || 0) : 0,
      // Fixed overhead is its own P&L line (D-FIN-W3-11), always separate.
      fixedOverheadCents: (ack && summary.hasData) ? (summary.overheadBurden || 0) : 0,
      // Fallback diagnostic when burden data is empty.
      fallback: !summary.hasData
    };
  } catch (err) {
    pnl._burden = { error: err.message || String(err), acknowledged: false, hasData: false,
      displayMode: 'base-pay', effectiveLaborCogsCents: 0, fixedOverheadCents: 0, fallback: true };
  }
  return pnl;
}

// Helper used by renderPnl to display the burden chip + line items.
function _w3BurdenChipFor(burden) {
  if (!burden) return '';
  if (!burden.hasData) {
    return '<span title="No burden data for this period — using base pay × hours fallback" ' +
      'style="background:rgba(107,114,128,0.15);color:#9ca3af;padding:2px 8px;border-radius:999px;' +
      'font-size:0.72rem;font-weight:600;vertical-align:middle;">No burden data — base pay × hours</span>';
  }
  // R-FIN-W3-1: mixed sources → render with confidence chip at the lowest tier.
  return renderSourceTagChip(burden.dominantSource, burden.confidence);
}

// Per-job/per-product info banner — when only _overhead is allocated (the
// VERIFIED schema reality: time-clock lacks jobId today).
function _w3PerJobOverheadBanner() {
  return '<div style="background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.30);' +
    'color:#f59e0b;padding:10px 14px;border-radius:8px;margin:8px 0;font-size:0.85rem;line-height:1.45;">' +
    '<strong>Per-job labor allocation is not yet available.</strong> ' +
    'Time-clock entries do not capture job attribution today, so all labor cost is currently rolled ' +
    'into <em>Fixed Overhead</em>. To populate per-job profitability, add Job tagging to time-clock ' +
    '(future enhancement) or use the per-employee manual entry form in Team → Burden to attribute ' +
    'burden to specific jobs.' +
    '</div>';
}

function _w3PerProductCaveatNote() {
  return '<div style="background:rgba(107,114,128,0.10);border:1px solid rgba(107,114,128,0.25);' +
    'color:var(--warm-gray,#9ca3af);padding:8px 12px;border-radius:6px;margin:6px 0;' +
    'font-size:0.78rem;line-height:1.4;">' +
    'Per-product labor cost requires per-job time-clock attribution, which is not yet captured. ' +
    'Labor for this SKU is absorbed in tenant-level <em>Fixed Overhead</em> until time-clock job ' +
    'tagging ships or manual per-job burden entries are made in Team → Burden.' +
    '</div>';
}

// ────────────────────────────────────────────────────────────────────────
// W3 — Burdened Labor Cost AI advisor roles (Agent E, sub-task W3.8)
// Idea -OtMKtFHnUZE2xD25BzV. Concepts: D-FIN-W3-8, D-FIN-W3-10.
// Relocated 2026-05-28 from app/modules/advisor.js (Job -OteH2BLijKcyZ5U9YXe,
// W3-H4): advisor.js is lazy-loaded only on the `advisor` route, but the
// W3 surfaces that consume these roles live on the Finance route. Registering
// here ensures MastAskAi._registry is populated when the roles are actually
// invoked.
//
// Five roles registered with MastAskAi:
//   1. cogs-jump-explainer       — auto-fire on Finance mount if |MoM| > 10%
//   2. estimator-tuner           — operator-invoked (future: weekly Pub/Sub)
//   3. anomaly-flagger           — invoked per admin/burdenedLaborCost write
//   4. release-note-co-writer    — invoked by W3.9 release-note banner
//   5. partner-cutover-co-pilot  — STUB (manual; activates with HR arc)
//
// VERIFIED reality (load-bearing): admin/timeEntries has NO jobId today.
// Allocation routes 100% to _overhead unless operator uses manual entry.
// Roles must NOT blame individual products when finance_get_labor_by_job
// returns hasOverheadOnly:true — instead explain the overhead-rollup.
//
// Roles consume Agent D's MCP tools via askAiProxy. The tool list per role
// is declared in `requiredTools` (metadata; askAiProxy reads these to scope
// its MCP grant). `trigger` declares auto-fire conditions for Agent C/A.
// `outputTemplate` documents the expected response shape so consumers can
// structure UI around it.
// ────────────────────────────────────────────────────────────────────────

// D-FIN-W3-10 threshold helper. Decides whether an estimator-tuning
// suggestion is worth surfacing as a mast_alerts entry.
//
// Surface only when ALL hold:
//   • |Δ| > 15% on the proposed multiplier
//   • pattern persists across 3+ pay periods
//   • 2+ employees show the same directional delta
//
// `comparisons` shape (from finance_compare_estimator_vs_actual):
//   [{ employeeId, periodId, field, estimator, actual, deltaPct, direction }]
// `employeeRoster` shape: [{ id, name, ... }] (used only for count).
//
// Returns { surface: boolean, reason: string, evidence: object }.
function shouldSurfaceEstimatorTuningAlert(comparisons, employeeRoster) {
  if (!Array.isArray(comparisons) || comparisons.length === 0) {
    return { surface: false, reason: 'no comparison data', evidence: {} };
  }
  // Group by field (e.g. 'suta.MA'), then by direction.
  var byField = {};
  comparisons.forEach(function(c) {
    if (!c || !c.field || typeof c.deltaPct !== 'number') return;
    if (Math.abs(c.deltaPct) <= 15) return; // |Δ| > 15% gate
    var key = c.field + '::' + (c.direction || (c.deltaPct >= 0 ? 'up' : 'down'));
    if (!byField[key]) byField[key] = { periods: {}, employees: {}, samples: [] };
    byField[key].periods[c.periodId] = true;
    byField[key].employees[c.employeeId] = true;
    byField[key].samples.push(c);
  });
  var winners = [];
  Object.keys(byField).forEach(function(k) {
    var g = byField[k];
    var periodCount = Object.keys(g.periods).length;
    var employeeCount = Object.keys(g.employees).length;
    if (periodCount >= 3 && employeeCount >= 2) {
      var avgDelta = g.samples.reduce(function(s, c) { return s + c.deltaPct; }, 0) / g.samples.length;
      winners.push({
        fieldKey: k,
        field: g.samples[0].field,
        direction: g.samples[0].direction || (avgDelta >= 0 ? 'up' : 'down'),
        periodCount: periodCount,
        employeeCount: employeeCount,
        avgDeltaPct: Math.round(avgDelta * 10) / 10,
        sampleCount: g.samples.length
      });
    }
  });
  if (winners.length === 0) {
    return {
      surface: false,
      reason: 'no field crossed all 3 thresholds (|Δ|>15%, 3+ periods, 2+ employees)',
      evidence: { fieldsConsidered: Object.keys(byField).length }
    };
  }
  return {
    surface: true,
    reason: winners.length + ' field(s) crossed all thresholds',
    evidence: { winners: winners }
  };
}

// Build a tenant snapshot for Ask AI role context. Each role calls this and
// overlays role-specific scoping (period filter, employee filter, etc).
// Kept inline so each role's buildContext stays cheap on construction —
// actual MCP fetches happen in the Claude session via askAiProxy.
function _w3BurdenBaseContext(scope) {
  scope = scope || {};
  return {
    moduleHint: 'finance.burdened-labor-cost',
    ideaId: '-OtMKtFHnUZE2xD25BzV',
    conceptIds: ['D-FIN-W3-8', 'D-FIN-W3-10'],
    verifiedReality: {
      timeEntriesHaveJobId: false,
      defaultAllocationBucket: '_overhead',
      perJobAttributionAvailable: 'manual-entry-only'
    },
    scope: scope
  };
}

if (window.MastAskAi && window.MastAskAi.register) {

  // ── Role 1: cogs-jump-explainer ────────────────────────────────────────
  // Agent C invokes this from finance.js on Finance view mount if
  // MoM COGS delta > 10%. Output is a 2–4 sentence natural-language
  // paragraph that names the driver and points at the fix.
  window.MastAskAi.register('w3-cogs-jump-explainer', {
    title: 'Why did COGS change this period?',
    placeholder: 'Click Ask AI — I will pull the burden breakdown, compare estimator vs actual, and explain the change.',
    requiredTools: [
      'finance_compare_estimator_vs_actual',
      'finance_get_burdened_labor_cost',
      'finance_get_burden_estimator_config',
      'finance_get_pnl',
      'finance_get_labor_by_job'
    ],
    trigger: {
      kind: 'auto',
      on: 'financeViewMount',
      condition: 'momCogsDeltaPct > 10 || momCogsDeltaPct < -10',
      invokedBy: 'finance.js (Agent C)'
    },
    outputTemplate: {
      shape: 'paragraph',
      lengthSentences: [2, 4],
      mustInclude: ['driver', 'directionalImpact', 'actionableNextStep'],
      honestyRule: 'If finance_get_labor_by_job returns hasOverheadOnly:true, explicitly say per-job COGS is rolled into Fixed Overhead and that time-clock does not capture job attribution yet.'
    },
    notes: [
      'Goal: explain WHY COGS moved this period in 2–4 plain sentences.',
      'ALWAYS call finance_compare_estimator_vs_actual first — the delta and direction live there.',
      'Then call finance_get_burdened_labor_cost to identify the biggest-mover employee or burden component (taxes, benefits, WC).',
      'Then call finance_get_burden_estimator_config to see whether the variance points at a stale multiplier the operator can update.',
      'If finance_get_labor_by_job has hasOverheadOnly:true, DO NOT name specific products as the culprit. Say so plainly: per-job attribution is not available because time-clock entries lack jobId.',
      'When the driver is a stale estimator multiplier, suggest the Settings path: Settings → Finance → Labor Burden Estimator. Frame as "consider updating" not "we changed".',
      'When the driver is real (raises, overtime, new hire), say so — do not blame the estimator if the estimator was correct.',
      'Tone: factual, calm, operator-respecting. No alarm language ("crisis", "huge problem"). No hypothetical examples — use the tenant\'s actual numbers.',
      'Sample (driver = stale SUTA): "Your COGS is up 23% this period. The biggest driver is the SUTA rate for MA — we defaulted to 1.2% but your actuals show 2.8%. Consider updating the estimator at Settings → Finance → Labor Burden Estimator."',
      'Sample (presentation shift): "COGS dropped 8% because your two highest-paid employees moved off the project bucket; their burden is now in Fixed Overhead. This is a presentation change, not a real cost decrease."',
      'Sample (hasOverheadOnly:true): "COGS rose 14% this period driven by $4,200 more burden across all employees. Per-job COGS is currently rolled into Fixed Overhead — your time-clock doesn\'t capture job attribution yet, so I can\'t tell you which jobs drove the change. To get per-job answers, enable jobId on time entries (Team → Time tracking settings)."'
    ],
    buildContext: function() {
      return _w3BurdenBaseContext({ period: 'current', comparisonWindow: 'mom' });
    }
  });

  // ── Role 2: estimator-tuner ────────────────────────────────────────────
  // Operator-invoked from Ask AI (future: scheduled weekly via Pub/Sub).
  // Surfaces a mast_alerts entry — NEVER mutates config silently.
  window.MastAskAi.register('w3-estimator-tuner', {
    title: 'Tune my burden estimator',
    placeholder: 'I\'ll compare estimator multipliers against actuals across recent pay periods and propose changes for your approval.',
    requiredTools: [
      'finance_compare_estimator_vs_actual',
      'finance_get_burden_estimator_config',
      'mast_alerts'
    ],
    trigger: {
      kind: 'manual',
      invokedBy: 'operator (Ask AI surface)',
      futurePlan: 'weekly Pub/Sub cron once W3.11 ships'
    },
    outputTemplate: {
      shape: 'alertPayload',
      suggestOnly: true,
      explicitText: 'Suggested change — click Approve to apply. Mast will not change this automatically.',
      example: {
        severity: 'medium',
        type: 'estimator-tuning',
        proposedChange: { field: 'suta.MA', from: 0.012, to: 0.028 },
        evidence: '3 employees, 5 periods, avg delta +2.8 percentage points',
        actionUrl: '/settings/finance/burden-estimator'
      }
    },
    thresholdHelper: 'shouldSurfaceEstimatorTuningAlert',
    notes: [
      'Goal: identify estimator multipliers whose actuals consistently diverge, and propose a single concrete change per surfaced field.',
      'BEFORE writing any mast_alerts entry, apply the D-FIN-W3-10 thresholds: |Δ| > 15% AND 3+ pay periods AND 2+ employees showing the same direction.',
      'The window.shouldSurfaceEstimatorTuningAlert(comparisons, roster) helper encapsulates this logic. Call it and only proceed if surface===true.',
      'NEVER silently mutate config. ALWAYS write to mast_alerts and let the operator ratify via Settings → Finance → Labor Burden Estimator.',
      'Always include the literal sentence "Suggested change — click Approve to apply. Mast will not change this automatically." in the alert body so the user knows the system is suggest-only.',
      'severity:"medium" is the default for tuning suggestions. Use "low" if avgDeltaPct is between 15 and 25; reserve "high" for tax-related fields where misalignment will cause filing errors (SUTA, FUTA, FICA).',
      'evidence must be a single human-readable sentence: "N employees, M periods, avg delta ±X percentage points".',
      'proposedChange.to should be the rolling-median of actuals over the qualifying periods, NOT the mean (resistant to outliers).',
      'actionUrl is always "/settings/finance/burden-estimator".',
      'If finance_compare_estimator_vs_actual returns no comparisons, respond plainly: "Not enough actual-pay-run data yet — need 3+ periods to suggest tuning." Do NOT write an alert in that case.'
    ],
    buildContext: function() {
      return _w3BurdenBaseContext({ window: 'last-6-periods' });
    }
  });

  // ── Role 3: anomaly-flagger ────────────────────────────────────────────
  // Trigger mechanism TBD by ops (per-write CF hook OR per-tenant cron).
  // Computes rolling median over prior 6 periods; flags 2x or 0.5x.
  window.MastAskAi.register('w3-anomaly-flagger', {
    title: 'Flag burden anomalies',
    placeholder: 'I\'ll scan the last 6 pay periods of burdened labor cost and flag any employee-period whose total burden is 2x or 0.5x the rolling median.',
    requiredTools: [
      'finance_get_burdened_labor_cost',
      'mast_alerts'
    ],
    trigger: {
      kind: 'scheduled',
      on: 'admin/burdenedLaborCost write',
      invokedBy: 'Agent A allocation CF OR per-tenant cron — orchestrator decides',
      openQuestion: 'Client-side per-render scan would be cheaper but misses writes from CFs. Server-side hook is correct but needs Agent A buy-in.'
    },
    outputTemplate: {
      shape: 'alertPayload',
      example: {
        severity: 'low',
        type: 'burden-anomaly',
        employeeId: 'emp_X',
        period: '2026-05',
        value: 'totalBurden $9,400 vs rolling median $4,200',
        possibleCauses: ['data-entry error', 'pay raise', 'overtime week', 'PTO recovery'],
        actionUrl: '/team/emp_X/burden/2026-05'
      }
    },
    notes: [
      'For each employee, fetch the prior 6 periods of finance_get_burdened_labor_cost and compute the rolling median of totalBurden.',
      'Flag when currentPeriod.totalBurden > 2 * rollingMedian OR currentPeriod.totalBurden < 0.5 * rollingMedian.',
      'Skip employees with fewer than 4 prior periods of history — median is unreliable with too few samples; emit no alert.',
      'severity:"low" by default. Anomaly flags are advisory, not blocking.',
      'possibleCauses must be 3–5 plain-English items that explain common reasons for the direction observed. Keep generic — do not speculate about specific employee circumstances.',
      'value field format: "totalBurden $A vs rolling median $B" (whole dollars, no cents).',
      'actionUrl pattern: "/team/{employeeId}/burden/{periodId}".',
      'Idempotency: include a deterministic alertId derived from (employeeId, periodId, "burden-anomaly") so re-runs do not stack duplicate alerts.',
      'When no anomalies exist, respond plainly: "No burden anomalies in the last period." Do NOT write an empty alert.'
    ],
    buildContext: function() {
      return _w3BurdenBaseContext({ window: 'last-6-periods', mode: 'scan-all-employees' });
    }
  });

  // ── Role 4: release-note-co-writer ─────────────────────────────────────
  // Invoked by W3.9 release-note banner on mount (Agent C wires the call
  // from finance.js). Personalized 2–3 sentence body for the banner.
  window.MastAskAi.register('w3-release-note-co-writer', {
    title: 'Write the burdened-cost release note',
    placeholder: 'I\'ll generate a personalized 2–3 sentence release note explaining the burdened-cost change using your actual last-30-day numbers.',
    requiredTools: [
      'finance_compare_estimator_vs_actual',
      'finance_get_burdened_labor_cost',
      'finance_get_pnl',
      'finance_get_labor_by_job'
    ],
    trigger: {
      kind: 'auto',
      on: 'releaseNoteBannerMount',
      invokedBy: 'finance.js W3.9 banner (Agent C)',
      openQuestion: 'Should this fire on every Finance mount until the operator dismisses the banner, or only once and then cached?'
    },
    outputTemplate: {
      shape: 'paragraph',
      lengthSentences: [2, 3],
      tone: 'factual, non-alarmist, framed as "more accurate" not "worse"',
      mustInclude: ['whatChanged', 'dollarImpact', 'topAffectedSkus', 'marginImpact'],
      mustExclude: ['hypothetical numbers', 'apology language', 'regression framing']
    },
    notes: [
      'Goal: a SHORT (2–3 sentence) banner body the operator reads once. Not a deep explainer.',
      'Open with what changed: "Mast now uses burdened labor cost (wages + employer taxes + benefits + WC) for accurate margins."',
      'Personalize the impact: pull the actual dollar delta from the tenant\'s last 30–90 days via finance_get_pnl + finance_get_burdened_labor_cost.',
      'Name 2–3 top affected SKUs from finance_get_labor_by_job. If hasOverheadOnly:true, skip SKU names and say "across all products" — do NOT fabricate per-SKU detail.',
      'End with the margin shift: "your margins on these products will drop by Y% — this is corrected reality, not a regression."',
      'NEVER use hypothetical placeholder numbers ($X, Y%) in the live response. If the tenant has insufficient data, say: "Once you run your first pay period after enabling, I\'ll come back with specific impact numbers for your products."',
      'Tone calibration: read like a software release note from a respected vendor, not a marketing email. No exclamation marks. No "exciting news!" framing.',
      'Sample (data-rich): "Mast now uses burdened labor cost (wages + employer taxes + benefits + WC) for accurate margins. Based on your last 30 days, your COGS will increase by approximately $3,400, concentrated in Pendant-Lg, Necklace-Std, and Ring-14k. Margins on these products will drop by 6–9% — this is corrected reality, not a regression."',
      'Sample (hasOverheadOnly:true): "Mast now uses burdened labor cost (wages + employer taxes + benefits + WC) for accurate margins. Based on your last 30 days, your overhead pool grows by approximately $2,100 across all products. Per-product impact will become visible once time entries capture jobId."'
    ],
    buildContext: function() {
      return _w3BurdenBaseContext({ window: 'last-30-days', mode: 'release-note' });
    }
  });

  // ── Role 5: partner-cutover-co-pilot (STUB) ────────────────────────────
  // Manual placeholder. Activates when HR Completion arc resumes
  // (currently tabled per D-HR-15).
  window.MastAskAi.register('w3-partner-cutover-co-pilot', {
    title: 'Payroll partner cutover co-pilot',
    placeholder: 'This role activates when payroll partner integration ships.',
    requiredTools: [],
    trigger: { kind: 'manual', invokedBy: 'operator (placeholder)' },
    stub: true,
    outputTemplate: {
      shape: 'static',
      body: 'Payroll partner integration is not yet enabled. This role becomes active when Mast\'s HR Completion arc resumes (currently tabled per D-HR-15). When that happens, I\'ll guide you through the estimator → partner cutover, surface deltas, and help you decide when to switch defaultMode.'
    },
    notes: [
      'STUB — do not implement full logic in W3. Forward-compatibility placeholder so the registry slot is reserved.',
      'Always respond with the exact body in outputTemplate. Do not call any MCP tools.',
      'When HR arc resumes, this role gains real tools (finance_set_burden_estimator_config, partner-specific connectors) and a delta-comparison flow.'
    ],
    buildContext: function() {
      return _w3BurdenBaseContext({ mode: 'stub' });
    }
  });
}

// Export the threshold helper so tests + Agent C/B surfaces can reuse it.
window.shouldSurfaceEstimatorTuningAlert = shouldSurfaceEstimatorTuningAlert;

// Public surface for orders.js / products surfaces / external callers.
window.MastFinanceW3 = {
  loadBurdenForRange: _w3LoadBurdenForRange,
  loadBurdenForPeriod: _w3LoadBurdenForPeriod,
  loadMeta: _w3LoadMeta,
  invalidateMetaCache: _w3InvalidateMetaCache,  // M3 fix: exposed for team.js
  hasW2Employees: _w3HasW2Employees,            // cross-repo: authoritative check
  summarize: _w3SummarizeBurden,
  computeConfidence: _w3ComputeConfidence,
  renderSourceTagChip: renderSourceTagChip,
  perJobOverheadBanner: _w3PerJobOverheadBanner,
  perProductCaveatNote: _w3PerProductCaveatNote,
  periodsForRange: _w3PeriodsForRange,
  isAcknowledged: _w3IsAcknowledged,
  // Per-job lookup convenience: returns { allocatedBurden, sources, mixed,
  // dominantSource, employees: [{employeeId, allocatedBurden, source}] }
  getJobBurden: async function(jobId, startDate, endDate) {
    var r = await _w3LoadBurdenForRange(startDate, endDate);
    var total = 0;
    var sources = {};
    var employees = [];
    r.perPeriod.forEach(function(p) {
      var jb = (p.byJob || {})[jobId] || {};
      Object.keys(jb).forEach(function(rowId) {
        var rec = jb[rowId] || {};
        var a = +rec.allocatedBurden || 0;
        if (a <= 0) return;
        total += a;
        if (rec.source) sources[rec.source] = true;
        employees.push({ employeeId: rec.employeeId || rowId.split('__')[0],
          allocatedBurden: a, source: rec.source || null });
      });
    });
    var sourceList = Object.keys(sources);
    return {
      allocatedBurden: total,
      sources: sourceList,
      mixedSource: sourceList.length > 1,
      dominantSource: sourceList.length === 0 ? null
        : (sourceList.length > 1 ? 'mixed' : sourceList[0]),
      employees: employees
    };
  },
  // Per-product convenience: aggregates over the product's job set. Returns
  // null when no linkage (caller renders perProductCaveatNote()).
  getProductLaborCost: async function(productId, productJobIds, startDate, endDate) {
    if (!productJobIds || !productJobIds.length) return null;
    var r = await _w3LoadBurdenForRange(startDate, endDate);
    var total = 0;
    var sources = {};
    productJobIds.forEach(function(jid) {
      r.perPeriod.forEach(function(p) {
        var jb = (p.byJob || {})[jid] || {};
        Object.keys(jb).forEach(function(rowId) {
          var rec = jb[rowId] || {};
          var a = +rec.allocatedBurden || 0;
          if (a <= 0) return;
          total += a;
          if (rec.source) sources[rec.source] = true;
        });
      });
    });
    var sourceList = Object.keys(sources);
    return {
      productId: productId,
      laborCogsCents: total,
      sources: sourceList,
      mixedSource: sourceList.length > 1,
      dominantSource: sourceList.length === 0 ? null
        : (sourceList.length > 1 ? 'mixed' : sourceList[0])
    };
  }
};
// Also expose chip helper at top level for Agent B/E reuse.
window.renderSourceTagChip = renderSourceTagChip;

// ── FinanceBridge — state-free cores for the V2 statements hub ───────────────
// Mapping/Studio/Channels bridge precedent: the V2 twin NEVER re-implements
// finance math (period resolution, money normalization, P&L/cash/tax compute);
// it calls these. No DOM, no module render state.

// Normalized revenue rows for the Revenue lens: orders + POS sales merged,
// money already in cents, test rows excluded per the global toggle (excluded
// volume reported so the chip can show it).
async function _loadRevenueRows(start, end) {
  var [ordersRaw, salesRaw] = await Promise.all([
    MastDB.query('orders').orderByChild('placedAt').startAt(isoStart(start)).endAt(isoEnd(end)).limitToLast(1000).once(),
    MastDB.query('admin/sales').orderByChild('createdAt').startAt(isoStart(start)).endAt(isoEnd(end)).limitToLast(500).once()
  ]);
  var rows = [], totalCents = 0, byChannel = {}, testCount = 0, testCents = 0;
  Object.entries(ordersRaw || {}).forEach(function(kv) {
    var o = kv[1]; if (!o || o.status === 'cancelled') return;
    var cents = _orderRevenueCents(o); if (cents <= 0) return;
    if (isTestOrder(o) && !_includeTestData) { testCount++; testCents += cents; return; }
    var ch = _chan(o.source || 'direct');
    rows.push({ id: kv[0], kind: 'order', date: o.placedAt || o.createdAt || '', label: o.orderNumber || kv[0], party: o.customerName || o.customerEmail || '', channel: ch, cents: cents });
    byChannel[ch] = (byChannel[ch] || 0) + cents; totalCents += cents;
  });
  Object.entries(salesRaw || {}).forEach(function(kv) {
    var s = kv[1]; if (!_salesRowCounts(s)) return; // skip voided + POS-square mirrors (orderId set → counted via its orders row)
    var cents = _salesCents(s); if (cents <= 0) return;
    if (isTestOrder(s) && !_includeTestData) { testCount++; testCents += cents; return; }
    var ch = _chan(s.source || 'pos');
    var item = (Array.isArray(s.items) && s.items[0] && s.items[0].productName) || 'POS sale';
    rows.push({ id: kv[0], kind: 'sale', date: s.createdAt || s.timestamp || '', label: item, party: '', channel: ch, cents: cents });
    byChannel[ch] = (byChannel[ch] || 0) + cents; totalCents += cents;
  });
  rows.sort(function(a, b) { return a.date < b.date ? 1 : -1; });
  return { rows: rows, totalCents: totalCents, byChannel: byChannel, txnCount: rows.length,
    testExcluded: { count: testCount, cents: testCents } };
}

// AR / AP outstanding totals (point-in-time) — same rules as the Overview
// cards: AR honors the test-data toggle, AP has no test-channel concept.
async function _loadOpenItemsTotals() {
  var [sentRaw, overdueRaw, unpaidRaw, partialRaw] = await Promise.all([
    MastDB.query('orders').orderByChild('invoiceStatus').equalTo('sent').limitToLast(500).once().catch(function() { return {}; }),
    MastDB.query('orders').orderByChild('invoiceStatus').equalTo('overdue').limitToLast(500).once().catch(function() { return {}; }),
    MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('unpaid').limitToLast(500).once().catch(function() { return {}; }),
    MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('partial').limitToLast(500).once().catch(function() { return {}; })
  ]);
  var arCents = 0, arCount = 0;
  Object.values(Object.assign({}, sentRaw || {}, overdueRaw || {})).forEach(function(o) {
    if (!o) return;
    var due = _orderRevenueCents(o) - (o.invoicePaidAmount || 0);
    if (due <= 0) return;
    if (isTestOrder(o) && !_includeTestData) return;
    arCents += due; arCount++;
  });
  var apCents = 0, apCount = 0;
  Object.values(Object.assign({}, unpaidRaw || {}, partialRaw || {})).forEach(function(r) {
    if (!r) return;
    var due = (r.amountCents || 0) - (r.paidAmount || 0);
    if (due <= 0) return;
    apCents += due; apCount++;
  });
  return { arCents: arCents, arCount: arCount, apCents: apCents, apCount: apCount };
}

// Aging bucket from days-overdue — the shared AR/AP rule.
function _agingBucket(daysOver) {
  if (daysOver <= 0) return 'current';
  if (daysOver <= 30) return '1_to_30';
  if (daysOver <= 60) return '31_to_60';
  if (daysOver <= 90) return '61_to_90';
  return '90_plus';
}
function _daysOverdue(dueDate, asOf) {
  if (!dueDate) return 0;
  var dueMs = new Date(dueDate + 'T00:00:00Z').getTime();
  var asOfMs = new Date(asOf + 'T00:00:00Z').getTime();
  return Math.max(0, Math.floor((asOfMs - dueMs) / 86400000));
}

// State-free AR open-items loader — same field rules as loadArData (cents via
// _orderRevenueCents, test-channel filter honored). Rows for the V2 queue.
async function _arOpenItems() {
  var asOf = todayStr();
  var [sentRaw, overdueRaw] = await Promise.all([
    MastDB.query('orders').orderByChild('invoiceStatus').equalTo('sent').limitToLast(500).once(),
    MastDB.query('orders').orderByChild('invoiceStatus').equalTo('overdue').limitToLast(500).once()
  ]);
  var rows = [];
  Object.entries(Object.assign({}, sentRaw || {}, overdueRaw || {})).forEach(function(kv) {
    var orderId = kv[0], o = kv[1]; if (!o) return;
    var totalCents = _orderRevenueCents(o);
    var paidCents = o.invoicePaidAmount || 0;
    var amtDue = totalCents - paidCents;
    if (amtDue <= 0) return;
    if (isTestOrder(o) && !_includeTestData) return;
    var daysOver = _daysOverdue(o.invoiceDueDate, asOf);
    rows.push({
      orderId: orderId, invoiceNumber: o.invoiceNumber || null,
      customerName: o.customerName || '', customerEmail: o.customerEmail || '',
      customerId: o.customerId || null,
      totalCents: totalCents, paidCents: paidCents, amtDue: amtDue,
      dueDate: o.invoiceDueDate || null, daysOverdue: daysOver,
      bucket: _agingBucket(o.invoiceDueDate ? daysOver : 0),
      wholesale: !!(o.wholesaleAccountId || (typeof isWholesaleOrder === 'function' && isWholesaleOrder(o))),
      invoiceStatus: o.invoiceStatus
    });
  });
  rows.sort(function(a, b) { return b.daysOverdue - a.daysOverdue || b.amtDue - a.amtDue; });
  return rows;
}

// State-free AP open-items loader — receipts with a balance due + vendor join.
async function _apOpenItems() {
  var asOf = todayStr();
  var [unpaidRaw, partialRaw, vendorsRaw] = await Promise.all([
    MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('unpaid').limitToLast(500).once(),
    MastDB.query('admin/purchaseReceipts').orderByChild('paymentStatus').equalTo('partial').limitToLast(500).once(),
    MastDB.get('admin/vendors').catch(function() { return {}; })
  ]);
  var vendors = vendorsRaw || {};
  var rows = [];
  Object.entries(Object.assign({}, unpaidRaw || {}, partialRaw || {})).forEach(function(kv) {
    var receiptId = kv[0], r = kv[1]; if (!r) return;
    var totalCents = r.amountCents || 0;
    var paidCents = r.paidAmount || 0;
    var amtDue = totalCents - paidCents;
    if (amtDue <= 0) return;
    var daysOver = _daysOverdue(r.dueDate, asOf);
    var v = r.vendorId ? (vendors[r.vendorId] || null) : null;
    rows.push({
      receiptId: receiptId, vendorId: r.vendorId || null,
      vendorName: (v && v.name) || r.vendorName || '(no vendor)',
      vendorInvoiceRef: r.vendorInvoiceRef || null,
      totalCents: totalCents, paidCents: paidCents, amtDue: amtDue,
      dueDate: r.dueDate || null, receivedAt: r.receivedAt || null,
      daysOverdue: daysOver, bucket: _agingBucket(r.dueDate ? daysOver : 0),
      paymentStatus: r.paymentStatus, notes: r.notes || null, poId: r.poId || null
    });
  });
  rows.sort(function(a, b) { return b.daysOverdue - a.daysOverdue || b.amtDue - a.amtDue; });
  return { rows: rows, vendors: vendors };
}

// Delete cores — audited (writeAudit) so both classic and V2 paths log.
async function _apDeleteBillCore(billId) {
  await MastDB.remove('admin/purchaseReceipts/' + billId);
  try { if (typeof writeAudit === 'function') await writeAudit('delete', 'apBill', billId); } catch (_) {}
}
async function _apDeleteVendorCore(vendorId) {
  await MastDB.remove('admin/vendors/' + vendorId);
  try { if (typeof writeAudit === 'function') await writeAudit('delete', 'vendor', vendorId); } catch (_) {}
}

window.FinanceBridge = {
  resolvePeriod: _finResolvePeriod,
  periodLabel: _finPeriodLabel,
  setPeriod: function(p) { window._finPeriod = p; },
  priorWindow: _priorRevenueWindow,
  orderRevenueCents: _orderRevenueCents,
  salesCents: _salesCents,
  isTestOrder: isTestOrder,
  includeTestData: function() { return !!_includeTestData; },
  loadRevenueAggregate: _loadRevenueAggregate,
  revenueRows: _loadRevenueRows,
  computePnl: function(start, end) {
    return computePnlLocal(start, end).then(function(p) { return _w3EnrichPnlWithBurden(p, start, end); });
  },
  cashSnapshot: _computeCashSnapshot,
  taxByState: _computeTaxByState,
  tax1099ForYear: _tax1099ForYearCore,
  nexusList: _nexusListCore,
  nexusSave: _nexusSaveCore,
  nexusDelete: _nexusDeleteCore,
  openItemsTotals: _loadOpenItemsTotals,
  downloadCsv: _finDownloadCsv,
  // Reports hub cores (classic burn-down 6/6):
  arAgingSnapshot: _arAgingSnapshotCore,
  apAgingSnapshot: _apAgingSnapshotCore,
  statementCustomers: _statementCustomersCore,
  statementRows: _statementRowsCore,
  mintStatementLink: _mintStatementLinkCore,
  contractorVendors: _contractorVendorsCore,
  vendor1099Rows: _vendor1099RowsCore,
  loanReportData: _loanReportDataCore,
  loanReportHtml: function(d) { return renderLoanReport(d.monthly, d.bankTotal, d.startDate, d.endDate); },
  yearEndData: _yearEndDataCore,
  yearEndHtml: function(d) { return renderYearEndReport(d.pnlData, d.taxData, d.contractors, d.mileage, d.year); },
  yearEndCsv: function(kind, d) {
    if (kind === 'pnl') _yearEndExportPnlCsv(d);
    else if (kind === 'tax') _yearEndExportTaxCsv(d);
    else if (kind === '1099') _yearEndExport1099Csv(d);
  },
  printElement: function(id) { injectFinPrintCss(id); window.print(); },
  copyLoanMetrics: function() { if (typeof window.finCopyMetrics === 'function') window.finCopyMetrics(); },
  // Wave 2 — open-items hub cores:
  arOpenItems: _arOpenItems,
  apOpenItems: _apOpenItems,
  arMarkPaid: _arMarkPaidCore,
  arQueueReminder: _arQueueReminderCore,
  arDunningConfig: _arDunningConfigCore,
  arSaveDunningSettings: _arSaveDunningSettingsCore,
  arReminderLog: _arReminderLogCore,
  apMarkPaid: _apMarkPaidCore,
  apRecordPayment: _apRecordPaymentCore,
  apSaveBill: _apSaveBillCore,
  apSaveVendor: _apSaveVendorCore,
  apDeleteBill: _apDeleteBillCore,
  apDeleteVendor: _apDeleteVendorCore,
  // Wave 3 — close hub cores:
  dayCloseVersions: _dcLoadVersionsForDate,
  saveDayClose: _dayCloseSaveCore,
  dayCloseDiffHtml: _dcRenderDiff,
  dayCloseDiffConfirm: _dcShowDiffModal,
  dayClosesForMonth: _dcLoadLatestDayClosesForMonth,
  periodCloseForMonth: _dcLoadLatestPeriodClose,
  recentAmendments: _dcLoadRecentAmendments,
  last12Months: function() { return _pcLast12Months(); },
  monthLabel: function(m) { return _pcMonthLabel(m); },
  closePeriod: _closePeriodCore,
  amendApprove: _amendApproveCore,
  amendReject: _amendRejectCore,
  submitAmendment: _amendSubmitCore,
  // Wave 4 — portfolio cores:
  portfolioBulkTag: _portfolioBulkTagCore,
  portfolioCompute: _portfolioCompute,
  portfolioClassify: portfolioClassify
};

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
    'customer-portfolio': { tab: 'customerPortfolioTab', setup: function() { renderCustomerPortfolio(); } },
    // W2.1: new #financials overview dashboard (replaces orphan Square sync route).
    'financials':         { tab: 'financeOverviewTab',   setup: function() { renderFinanceOverview(); } },
    // Close v3 (Idea -OtQH_uRXqz9jJBRsmrj):
    'finance-period-close': { tab: 'financePeriodCloseTab', setup: function() { renderPeriodClose(); } },
    'finance-amendments':   { tab: 'financeAmendmentsTab',  setup: function() { renderAmendments(); } }
  }
});

})();
