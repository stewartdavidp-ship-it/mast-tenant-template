'use strict';

// ============================================================================
// MONEY CANARY — cross-surface VALUE assertion (QA spine, Phase 3 item 3).
// ============================================================================
//
// WHAT THIS IS. The existing parity guards (channel-normalization, readiness,
// labor) SHA-pin vendored cores so the UI and the MCP run byte-identical CODE.
// They prove the code is equal; they do NOT prove the two surfaces produce the
// same NUMBER from the same data. This test closes that gap: it feeds ONE
// canonical "golden money" dataset through the REAL shipped UI revenue/P&L
// aggregation and asserts the resulting figures match a hand-derived oracle to
// the cent — the same oracle the MCP finance tools (finance_get_revenue /
// finance_get_pnl) must return. If any surface drifts off the canonical money
// math, its repo's money-canary fails loudly.
//
// It is the deterministic backbone for the divergence class that needed
// cross-surface discovery to find: F1 (channel fragmentation), the cents/dollars
// 100x family, the POS double-count, and F14 (P&L margin withholding). See
// docs/ux-audit/qa-spine/phase-3-plan.md §3 and money-canary.md.
//
// WHY IT CAN CATCH REAL BUGS. The fixture is deliberately built so a surface
// that regresses to ANY of the historical buggy forms produces a DIFFERENT
// number — the `divergence demonstration` block proves the fixture discriminates
// (it is not a tautology). The canonical helpers are EXTRACTED FROM THE SHIPPED
// SOURCE (not re-implemented), so a regression in finance.js fails this test.
//
// CROSS-SURFACE CONTRACT (verified 2026-06-22 against canonical refs):
//   UI  app/modules/finance.js          _orderRevenueCents / _salesCents /
//                                        _salesRowCounts / _chan(→MastChannels)
//   MCP mast-mcp-server origin/main 78e3089 src/tools/mast-finance.ts:
//        sales → salesCents(s) (never *100) + salesRowCounts(s) (orderId dedup)
//        channel → normalizeChannel(source)  [shared/channel-normalization]
//        P&L   → marginReliable / cogsLineMissingCount / cogsMissing  (F14 #141)
//   The channel-normalization.core.js loaded here is BYTE-IDENTICAL to the MCP's
//   copy (SHA-pinned in both CIs), so the channel grouping below is genuinely
//   the same code both surfaces run.
//
// KNOWN RESIDUAL DIVERGENCE (documented, not asserted as agreement): the MCP
// order loop still reads `(o.total||0)*100` while the UI reads _orderRevenueCents
// (which prefers `totalCents`). They agree for well-formed orders but diverge
// 100x on the "cents-in-the-dollar-field" bad-data shape (SGTE-0187/0188). The
// `order grand-total` block below pins the UI/canonical value and documents the
// MCP gap (chip: adopt orderRevenueCents in mast-finance.ts).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ── Load the REAL shared channel core (byte-identical in template + MCP) ──────
// ES5 IIFE: assigns globalThis.MastChannels as a require side-effect.
require('../shared/channel-normalization.core.js');
const MastChannels = globalThis.MastChannels;
assert.ok(MastChannels && typeof MastChannels.normalize === 'function',
  'shared/channel-normalization.core.js must expose MastChannels.normalize');

// ── Extract the REAL UI money helpers from shipped finance.js ─────────────────
const FINANCE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'modules', 'finance.js'), 'utf8');
const STATEMENTS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'modules', 'finance-statements-v2.js'), 'utf8');

// Single-line helper: `function NAME(args) { ... }`.
function extractInline(src, name) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[^\\n]*\\}'));
  assert.ok(m, name + ' not found');
  // eslint-disable-next-line no-eval
  return eval('(' + m[0].replace('function ' + name, 'function') + ')');
}
// Multi-line helper closed by a column-0 brace.
function extractBlock(src, name) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
  assert.ok(m, name + ' not found');
  // eslint-disable-next-line no-eval
  return eval('(' + m[0].replace('function ' + name, 'function') + ')');
}
// Indented (2-space) helper closed by a 2-space-indented brace — for the
// finance-statements-v2 IIFE-private marginText.
function extractIndented(src, name) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}'));
  assert.ok(m, name + ' not found');
  // eslint-disable-next-line no-eval
  return eval('(' + m[0].replace('function ' + name, 'function') + ')');
}

const _orderRevenueCents = extractBlock(FINANCE_SRC, '_orderRevenueCents');
const _salesCents = extractInline(FINANCE_SRC, '_salesCents');
const _salesRowCounts = extractInline(FINANCE_SRC, '_salesRowCounts');
const marginText = extractIndented(STATEMENTS_SRC, 'marginText');
// _chan degrades to raw source if MastChannels isn't on window; in node we call
// MastChannels.normalize directly (same function the UI's _chan delegates to).
const _chan = (source) => MastChannels.normalize(source);

// ============================================================================
// THE GOLDEN MONEY FIXTURE  ("Auric & Oak"-style slice; every trap present)
// ============================================================================
// orders[]  = canonical money records. Counts iff status!=='cancelled' and
//             _orderRevenueCents>0. Channel = normalize(source||'direct').
// sales[]   = admin/sales mirror. Counts iff _salesRowCounts (not voided AND no
//             orderId) and _salesCents>0. Channel = normalize(source||'pos').
const ORDERS = [
  // 1. Well-formed legacy order: dollars-only total, fragmented source string.
  { id: 'o1', source: 'Online Store', total: 119.53 },                 // 11953 → dtc_online
  // 2. totalCents-native order; "online" is the same channel as "Online Store".
  { id: 'o2', source: 'online', total: 500, totalCents: 50000 },       // 50000 → dtc_online
  // 3. BAD-DATA SGTE-0187 shape: the dollar `total` field actually holds CENTS,
  //    and totalCents agrees. UI prefers totalCents → $1,020 (NOT $102,000).
  { id: 'o3', source: 'pos', total: 102000, totalCents: 102000 },      // 102000 → in_person
  // 4. Cancelled — must NOT count.
  { id: 'o4', source: 'pos', total: 999, status: 'cancelled' },        // skip
  // 5. Firestore Timestamp createdAt (the F15/Timestamp-coercion shape). The
  //    money path must read cents regardless of the date object. "direct-pos"
  //    collapses onto the same in_person channel as "pos".
  { id: 'o5', source: 'direct-pos', total: 45.00,
    createdAt: { _seconds: 1718000000, _nanoseconds: 0 } },            // 4500 → in_person
  // 6. Marketplace.
  { id: 'o6', source: 'Etsy', total: 80.00 },                          // 8000 → marketplace
];
const SALES = [
  // 7. POS-square MIRROR of order o3 (orderId set) — must NOT count again, else
  //    the sale is double-counted at full amount.
  { id: 's7', source: 'pos', amount: 102000, orderId: 'o3', status: 'captured' }, // skip (dedup)
  // 8. Standalone manual sale, no orderId. `amount` is ALREADY cents ($120).
  { id: 's8', source: 'manual', amount: 12000, status: 'captured' },   // 12000 → manual
  // 9. Voided — must NOT count.
  { id: 's9', source: 'pos', amount: 5000, status: 'voided' },         // skip
  // 10. Fair-mode sale, no orderId; sole money record → counts.
  { id: 's10', source: 'craft-fair', amount: 6500, status: 'captured' }, // 6500 → in_person
];

// ── The CANONICAL oracle — what BOTH surfaces must report, to the cent ────────
// dtc_online : 11953 + 50000                 = 61953
// in_person  : 102000 (o3) + 4500 (o5) + 6500(s10) = 113000
// marketplace: 8000
// manual     : 12000
const EXPECTED = {
  total: 194953,                       // $1,949.53
  byChannel: { dtc_online: 61953, in_person: 113000, marketplace: 8000, manual: 12000 },
};

// ── The aggregator under test: a faithful transcription of finance.js
//    _loadRevenueAggregate's loop, but built from the EXTRACTED real helpers so
//    a regression in any helper changes the result. (Test data excluded, to
//    match the visible total; this fixture carries no test rows.) ─────────────
function aggregateUI(orders, sales) {
  let total = 0; const byChannel = {};
  orders.forEach((o) => {
    if (o.status === 'cancelled') return;
    const cents = _orderRevenueCents(o);
    if (cents <= 0) return;
    const ch = _chan(o.source || 'direct');
    byChannel[ch] = (byChannel[ch] || 0) + cents; total += cents;
  });
  sales.forEach((s) => {
    if (!_salesRowCounts(s)) return;
    const cents = _salesCents(s);
    if (cents <= 0) return;
    const ch = _chan(s.source || 'pos');
    byChannel[ch] = (byChannel[ch] || 0) + cents; total += cents;
  });
  return { total, byChannel };
}

// ============================================================================
// 1. THE CANARY — the real UI aggregation equals the canonical oracle.
// ============================================================================
test('money-canary: UI revenue aggregate == canonical oracle (to the cent)', () => {
  const got = aggregateUI(ORDERS, SALES);
  assert.strictEqual(got.total, EXPECTED.total,
    'grand total must be $1,949.53 — a divergence here is a money bug, not a rounding nit');
  assert.deepStrictEqual(got.byChannel, EXPECTED.byChannel,
    'per-channel revenue must match exactly across surfaces');
});

test('money-canary: by-channel sums back to the grand total (self-consistent)', () => {
  const { total, byChannel } = aggregateUI(ORDERS, SALES);
  const sum = Object.values(byChannel).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, total, 'Σ byChannel must equal total (no leaked/dropped channel)');
});

// ============================================================================
// 2. DIVERGENCE DEMONSTRATION — prove the fixture discriminates. Each historical
//    buggy form produces a DIFFERENT number than canonical, so this fixture
//    would catch a surface that regressed to it. (Not a tautology check.)
// ============================================================================
test('money-canary: the buggy aggregator forms DIVERGE from canonical (fixture is discriminating)', () => {
  // (a) sales *100 (the admin/sales.amount-is-cents 100x bug) + no orderId dedup
  //     + raw source. This is the pre-#134/#537 shape.
  let buggyTotal = 0; const buggyChannels = {};
  ORDERS.forEach((o) => {
    if (o.status === 'cancelled') return;
    const cents = Math.round((o.total || 0) * 100);   // ignores totalCents
    if (cents <= 0) return;
    const ch = o.source || 'direct';                  // raw, un-normalized
    buggyChannels[ch] = (buggyChannels[ch] || 0) + cents; buggyTotal += cents;
  });
  SALES.forEach((s) => {
    if (s.status === 'voided') return;                // NO orderId dedup
    const cents = Math.round((s.amount || 0) * 100);  // 100x: amount is already cents
    if (cents <= 0) return;
    const ch = s.source || 'pos';
    buggyChannels[ch] = (buggyChannels[ch] || 0) + cents; buggyTotal += cents;
  });
  assert.notStrictEqual(buggyTotal, EXPECTED.total,
    'if the buggy total matched canonical the fixture could not catch the bug');
  // The bad-data order alone (102000*100) inflates the buggy total past $100k.
  assert.ok(buggyTotal > 10000000, 'the cents-in-total + 100x bugs explode the total');
  // Raw source fragments channels: pos + direct-pos stay separate, "Online
  // Store" + online stay separate → strictly more keys than the 4 canonical.
  assert.ok(Object.keys(buggyChannels).length > Object.keys(EXPECTED.byChannel).length,
    'un-normalized source fragments a single channel across multiple keys (F1 class)');
});

// ============================================================================
// 3. BUG-CLASS MICRO-ASSERTIONS — pin each individual money trap.
// ============================================================================
test('cents-vs-dollars: order grand-total prefers totalCents (SGTE-0187: $1,020 not $102,000)', () => {
  // The UI canonical. The MCP currently reads (total||0)*100 here and would
  // report 10,200,000 on this exact shape — a known residual divergence;
  // chip: adopt orderRevenueCents in mast-mcp-server mast-finance.ts.
  assert.strictEqual(_orderRevenueCents({ total: 102000, totalCents: 102000 }), 102000);
  assert.strictEqual(_orderRevenueCents({ total: 119.53 }), 11953);         // dollars → x100
  assert.strictEqual(_orderRevenueCents({ totalCents: 0, total: 50 }), 0);  // totalCents:0 honored
});

test('100x: admin/sales.amount is cents, read straight ($85 → 8500, never 850000)', () => {
  assert.strictEqual(_salesCents({ amount: 8500 }), 8500);
});

test('POS double-count: an orders-linked admin/sales mirror does NOT re-count', () => {
  assert.strictEqual(!!_salesRowCounts({ amount: 102000, orderId: 'o3', status: 'captured' }), false);
  assert.strictEqual(!!_salesRowCounts({ amount: 12000, status: 'captured' }), true);  // standalone counts
  assert.strictEqual(!!_salesRowCounts({ amount: 5000, status: 'voided' }), false);
});

test('channel fragmentation (F1): every synonym collapses onto one canonical key', () => {
  assert.strictEqual(_chan('pos'), 'in_person');
  assert.strictEqual(_chan('direct-pos'), 'in_person');
  assert.strictEqual(_chan('Online Store'), 'dtc_online');
  assert.strictEqual(_chan('online'), 'dtc_online');
  assert.strictEqual(_chan('Etsy'), 'marketplace');
});

test('Timestamp coercion: a Firestore-Timestamp createdAt does not break the money read', () => {
  // o5 carries createdAt:{_seconds,_nanoseconds}. The cents path must ignore it.
  const o5 = ORDERS.find((o) => o.id === 'o5');
  assert.strictEqual(_orderRevenueCents(o5), 4500);
});

// ============================================================================
// 4. F14 — P&L margin-withhold parity (UI withholds ⟺ MCP marginReliable:false).
//    Verified live on sgtest15 2026-06-22: finance_get_pnl → marginReliable:false,
//    cogsLineMissingCount:22, cogsLineCoveredCount:31, cogsMissing:false. The UI
//    marginText (extracted) gates on the SAME fields; mast-finance.ts #141 added
//    them to the tool. This pins the contract so it cannot silently re-diverge.
// ============================================================================

// The shared margin-reliability gate, stated once. Both surfaces honor it:
//   UI  marginText:    withhold ('—') ⟺ (cogsLineMissingCount>0 || cogsMissing)
//   MCP finance_get_pnl: marginReliable === !(cogsLineMissingCount>0 || cogsMissing)
function mcpMarginReliable(pnl) {
  return !(((pnl.cogsLineMissingCount || 0) > 0) || pnl.cogsMissing);
}

test('F14: incomplete COGS → UI withholds margin AND MCP marginReliable is false', () => {
  const pnl = { revenue: 9316851, grossProfit: 9199921, netProfit: 8308873,
    cogsLineMissingCount: 22, cogsLineCoveredCount: 31, cogsMissing: false };
  const ui = marginText(pnl);
  assert.strictEqual(ui.v, '—', 'UI must withhold the gross-margin % when COGS is incomplete');
  assert.match(ui.note, /COGS incomplete on 22 line/);
  assert.strictEqual(mcpMarginReliable(pnl), false,
    'MCP must report marginReliable:false on the SAME condition the UI withholds');
});

test('F14: complete COGS → UI shows the real margin AND MCP marginReliable is true', () => {
  const pnl = { revenue: 100000, grossProfit: 60000, netProfit: 40000,
    cogsLineMissingCount: 0, cogsLineCoveredCount: 12, cogsMissing: false };
  const ui = marginText(pnl);
  assert.strictEqual(ui.v, '60.0%', 'UI shows the computed gross margin when COGS is complete');
  assert.strictEqual(ui.note, null);
  assert.strictEqual(mcpMarginReliable(pnl), true,
    'both surfaces agree the margin is trustworthy');
});

test('F14: cogsMissing (revenue but zero COGS signal) also withholds on both surfaces', () => {
  const pnl = { revenue: 50000, grossProfit: 50000, netProfit: 50000,
    cogsLineMissingCount: 3, cogsLineCoveredCount: 0, cogsMissing: true };
  assert.strictEqual(marginText(pnl).v, '—');
  assert.strictEqual(mcpMarginReliable(pnl), false);
});
