'use strict';

// ============================================================================
// MONEY CANARY — cross-surface VALUE assertion (QA spine Phase 3 / ROADMAP 1.5).
// ============================================================================
//
// WHAT THIS IS. The three SHA-pinned parity guards (channel-normalization,
// readiness, labor) prove the UI and the MCP run BYTE-IDENTICAL code. They do
// NOT prove the two surfaces produce the same NUMBER from the same data. This
// test closes that gap: it feeds ONE frozen "golden money" fixture — grounded in
// the demo golden tenant "Auric & Oak" (golden-auric) and cross-checked live
// against the mast-mcp finance tools — through the REAL shipped UI finance
// aggregators and asserts every figure + reliability flag against a committed
// manifest, to the cent. The same figures the MCP finance_get_revenue /
// finance_get_pnl / finance_get_ar_aging / finance_get_tax_summary tools return
// on the same data (their byte-shared cores). If any surface drifts off the
// canonical money math, its repo's money-canary fails loudly.
//
// It is the deterministic backbone for the divergence class that needed
// cross-surface discovery to find — 3 of the program's 7 genuine bugs:
//   F1  channel-key fragmentation   (pos+direct-pos, online+"Online Store")
//   F5  missing tax jurisdiction    (stateless orders surfaced, not bucketed)
//   F14 P&L margin withholding      (UI withholds gross/net on incomplete COGS)
// plus the cents/dollars 100x family (SGTE-0187) and the POS double-count.
//
// HOW IT PINS THE REAL CODE (no production change). The pure helpers
// (_orderRevenueCents / _salesCents / _salesRowCounts / isTestOrder /
// _agingBucket) and the IIFE-private marginText are regex-extracted-and-eval'd
// from the shipped source. The four ENTANGLED async aggregators
// (_loadRevenueAggregate, computePnlLocal, _arAgingSnapshotCore,
// _computeTaxByState) are extracted WHOLE and run against a fake MastDB (the
// engine-hardening vm pattern, cf. test/customer-resolver.test.js) — so a
// regression in the real loop body (a dropped test-filter, a lost dedup, an
// un-normalized channel key, a withheld-vs-returned margin) turns this RED.
//
// CROSS-SURFACE CONTRACT (verified 2026-06-22 against canonical refs):
//   UI  app/modules/finance.js  _loadRevenueAggregate / computePnlLocal /
//       _arAgingSnapshotCore / _computeTaxByState + the helpers above;
//       finance-statements-v2.js marginText (the F14 withhold gate).
//   MCP mast-mcp-server origin/main src/tools/mast-finance.ts: salesCents /
//       salesRowCounts (dedup) / normalizeChannel [shared core] / and #141's
//       marginReliable / cogsLineMissingCount / cogsMissing (F14).
//   shared/channel-normalization.core.js is byte-identical in both repos
//   (SHA-pinned in both CIs), so the channel grouping here is genuinely the same
//   code both surfaces run.
//
// KNOWN RESIDUAL DIVERGENCE (documented, not asserted as agreement): the MCP
// order loop still reads `(o.total||0)*100` while the UI reads _orderRevenueCents
// (prefers totalCents). They agree for well-formed orders but diverge 100x on the
// SGTE-0187 cents-in-the-dollar-field shape (ao-o3). The cents-vs-dollars block
// pins the UI value and documents the MCP gap (cross-repo chip: adopt an
// orderRevenueCents helper in mast-finance.ts).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ── Load the REAL shared channel core (byte-identical in template + MCP) ──────
require('../shared/channel-normalization.core.js');
const MastChannels = globalThis.MastChannels;
assert.ok(MastChannels && typeof MastChannels.normalize === 'function',
  'shared/channel-normalization.core.js must expose MastChannels.normalize');

// ── Frozen golden fixture + expected manifest (committed, deterministic) ──────
const FX = path.join(__dirname, 'fixtures');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(FX, 'money-canary.golden.json'), 'utf8'));
const EXPECT = JSON.parse(fs.readFileSync(path.join(FX, 'money-canary.expected.json'), 'utf8'));

// ── Read the shipped finance source once ──────────────────────────────────────
const FINANCE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'modules', 'finance.js'), 'utf8');
const STATEMENTS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'modules', 'finance-statements-v2.js'), 'utf8');

// ── Extractors (regex-extract the REAL fn text from source, then eval) ────────
// Single-line helper: `function NAME(args) { ... }`.
function extractInline(src, name) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[^\\n]*\\}'));
  assert.ok(m, name + ' not found in source');
  // eslint-disable-next-line no-eval
  return eval('(' + m[0].replace('function ' + name, 'function') + ')');
}
// Multi-line helper closed by a column-0 brace.
function extractBlock(src, name) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
  assert.ok(m, name + ' not found in source');
  // eslint-disable-next-line no-eval
  return eval('(' + m[0].replace('function ' + name, 'function') + ')');
}
// Indented (2-space) helper closed by a 2-space brace — finance-statements-v2's
// IIFE-private marginText.
function extractIndented(src, name) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}'));
  assert.ok(m, name + ' not found in source');
  // eslint-disable-next-line no-eval
  return eval('(' + m[0].replace('function ' + name, 'function') + ')');
}
// Full text of a (possibly async) top-level fn, declaration through its column-0
// closing brace — for the entangled async aggregators we run against a fake DB.
function extractFnText(src, name) {
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'));
  assert.ok(m, name + ' not found in source');
  return m[0];
}
// Compile an extracted fn with its free variables injected as closure params, so
// the REAL body runs with our fakes (MastDB, the extracted helpers, stubs).
function compile(fnText, name, deps) {
  const depNames = Object.keys(deps);
  const anon = fnText.replace(new RegExp('function\\s+' + name), 'function');
  // eslint-disable-next-line no-new-func
  const factory = new Function(...depNames, 'return (' + anon + ');');
  return factory(...depNames.map((k) => deps[k]));
}

// ── The REAL pure helpers + the F14 UI withhold gate ──────────────────────────
const _orderRevenueCents = extractBlock(FINANCE_SRC, '_orderRevenueCents');
const _salesCents = extractInline(FINANCE_SRC, '_salesCents');
const _salesRowCounts = extractInline(FINANCE_SRC, '_salesRowCounts');
const isTestSource = extractBlock(FINANCE_SRC, 'isTestSource');
const isTestOrder = compile(extractFnText(FINANCE_SRC, 'isTestOrder'), 'isTestOrder', { isTestSource });
const _agingBucket = extractBlock(FINANCE_SRC, '_agingBucket');
const _daysOverdue = extractBlock(FINANCE_SRC, '_daysOverdue');
const marginText = extractIndented(STATEMENTS_SRC, 'marginText');
// _chan delegates to MastChannels.normalize in the browser; call it directly.
const _chan = (source) => MastChannels.normalize(source);

// ── Fake MastDB: chainable query that honors orderByChild/startAt/endAt range
//    filtering AND equalTo, plus get()/products.get(). The fixture rows are
//    pre-scoped to the window, but the range branch is genuinely exercised: AR
//    invoices carry NO placedAt, so the placedAt-range queries (revenue/pnl/tax)
//    drop them while the invoiceStatus equalTo query (AR) matches them — the same
//    separation a real Firestore collection gives. ──────────────────────────────
function keyedMap(arr) {
  const out = {};
  (arr || []).forEach((r) => { out[r.id] = r; });
  return out;
}
function fakeMastDB(data) {
  function chain(rows, field, lo, hi) {
    return {
      orderByChild(f) { return chain(rows, f, lo, hi); },
      startAt(v) { return chain(rows, field, v, hi); },
      endAt(v) { return chain(rows, field, lo, v); },
      limitToLast() { return chain(rows, field, lo, hi); },
      equalTo(v) {
        const out = {};
        Object.keys(rows).forEach((k) => { if (rows[k] && rows[k][field] === v) out[k] = rows[k]; });
        return chain(out, field, lo, hi);
      },
      once() {
        if (lo === undefined && hi === undefined) return Promise.resolve(rows);
        const out = {};
        Object.keys(rows).forEach((k) => {
          const val = rows[k] ? rows[k][field] : undefined;
          if (val === undefined || val === null) return;
          if (lo !== undefined && !(val >= lo)) return;
          if (hi !== undefined && !(val <= hi)) return;
          out[k] = rows[k];
        });
        return Promise.resolve(out);
      },
    };
  }
  return {
    query(path_) { return chain(data[path_] || {}, undefined, undefined, undefined); },
    get(path_) { return Promise.resolve(data[path_] || {}); },
    products: { get() { return Promise.resolve(data.products || {}); } },
  };
}

// All orders (revenue + AR) live in ONE 'orders' collection, like Firestore.
const DATA = {
  orders: Object.assign({}, keyedMap(GOLDEN.orders), keyedMap(GOLDEN.arInvoices)),
  'admin/sales': keyedMap(GOLDEN.sales),
  'admin/expenses': keyedMap(GOLDEN.expenses),
  'admin/journalEntries': keyedMap(GOLDEN.journalEntries),
  'admin/nexusRegistrations': {},
  products: GOLDEN.products,
};
const MastDB = fakeMastDB(DATA);
const ID = (d) => d; // isoStart/isoEnd stub — identity; the mock's range branch
                     // still filters on the raw ISO-date bounds (lexicographic).

// ── The REAL entangled async aggregators, injected with our fakes ─────────────
const _loadRevenueAggregate = compile(
  extractFnText(FINANCE_SRC, '_loadRevenueAggregate'), '_loadRevenueAggregate',
  { MastDB, isoStart: ID, isoEnd: ID, _orderRevenueCents, _includeTestData: false, _chan, isTestOrder, _salesRowCounts, _salesCents });
const computePnlLocal = compile(
  extractFnText(FINANCE_SRC, 'computePnlLocal'), 'computePnlLocal',
  { MastDB, isoStart: ID, isoEnd: ID, _orderRevenueCents, _chan, isTestOrder, _includeTestData: false, _salesRowCounts, _salesCents });
const _arAgingSnapshotCore = compile(
  extractFnText(FINANCE_SRC, '_arAgingSnapshotCore'), '_arAgingSnapshotCore',
  { MastDB, _orderRevenueCents, isTestOrder, _includeTestData: false });
const _computeTaxByState = compile(
  extractFnText(FINANCE_SRC, '_computeTaxByState'), '_computeTaxByState',
  { MastDB, isoStart: ID, isoEnd: ID });

const WIN = ['2025-10-01', '2026-06-30'];
const order = (id) => GOLDEN.orders.find((o) => o.id === id);

// The MCP F14 reliability flag, stated once. Both surfaces honor the SAME gate:
//   UI  marginText:           withhold ('—') ⟺ (cogsLineMissingCount>0 || cogsMissing)
//   MCP finance_get_pnl:      marginReliable === !(cogsLineMissingCount>0 || cogsMissing)
function mcpMarginReliable(pnl) {
  return !(((pnl.cogsLineMissingCount || 0) > 0) || pnl.cogsMissing);
}

// ============================================================================
// 1. REVENUE — real _loadRevenueAggregate == the manifest, to the cent.
// ============================================================================
test('revenue: real UI aggregate == manifest (total, byChannel, txnCount)', async () => {
  const got = await _loadRevenueAggregate(WIN[0], WIN[1]);
  assert.strictEqual(got.totalCents, EXPECT.revenue.totalCents,
    'grand total must match to the cent — a divergence here is a money bug');
  assert.deepStrictEqual(got.byChannel, EXPECT.revenue.byChannel,
    'per-channel revenue must match exactly across surfaces');
  assert.strictEqual(got.txnCount, EXPECT.revenue.txnCount,
    'counted-transaction count must match (dedup + voided + cancelled + test all excluded)');
});

test('revenue (F1): every channel key is CANONICAL — no fragmentation', async () => {
  const { byChannel } = await _loadRevenueAggregate(WIN[0], WIN[1]);
  const canonical = new Set(MastChannels.CHANNELS);
  const bad = Object.keys(byChannel).filter((k) => !canonical.has(k));
  assert.deepStrictEqual(bad, [],
    'all revenue channel keys must be canonical (pos/direct-pos→in_person, online/"Online Store"→dtc_online)');
});

test('revenue: Σ byChannel == total (no leaked or dropped channel)', async () => {
  const { totalCents, byChannel } = await _loadRevenueAggregate(WIN[0], WIN[1]);
  const sum = Object.values(byChannel).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, totalCents);
});

// ============================================================================
// 2. P&L / F14 — real computePnlLocal == manifest; UI withholds margin ⟺ MCP
//    marginReliable:false. Live on golden-auric 2026-06-22: marginReliable:false,
//    cogsLineMissingCount:10, cogsLineCoveredCount:264 (same withhold condition).
// ============================================================================
test('pnl: real computePnlLocal == manifest (revenue/cogs/gross/opex/net + COGS counts)', async () => {
  const p = await computePnlLocal(WIN[0], WIN[1]);
  const e = EXPECT.pnl;
  assert.strictEqual(p.revenue, e.revenue, 'P&L revenue');
  assert.strictEqual(p.cogs, e.cogs, 'COGS (materials + cogs-adj JE + line-item attribution)');
  assert.strictEqual(p.grossProfit, e.grossProfit, 'gross profit');
  assert.strictEqual(p.opex, e.opex, 'opex (reviewed non-materials non-personal + payroll JE)');
  assert.strictEqual(p.netProfit, e.netProfit, 'net profit');
  assert.strictEqual(p.cogsLineMissingCount, e.cogsLineMissingCount, 'COGS missing line count');
  assert.strictEqual(p.cogsLineCoveredCount, e.cogsLineCoveredCount, 'COGS covered line count');
  assert.strictEqual(p.cogsMissing, e.cogsMissing, 'cogsMissing flag');
  assert.strictEqual(!!p.hasPayroll, e.hasPayroll, 'hasPayroll');
});

test('pnl revenue == revenue-tool total (the headline cross-tool agreement)', async () => {
  const [rev, pnl] = await Promise.all([_loadRevenueAggregate(WIN[0], WIN[1]), computePnlLocal(WIN[0], WIN[1])]);
  assert.strictEqual(rev.totalCents, pnl.revenue,
    'finance_get_revenue.total and finance_get_pnl.revenue sum the same orders+sales — must agree');
});

test('F14: incomplete COGS → UI withholds margin AND MCP marginReliable:false (real pnl)', async () => {
  const pnl = await computePnlLocal(WIN[0], WIN[1]);
  assert.ok(pnl.cogsLineMissingCount > 0, 'fixture must carry the missing-COGS condition');
  const ui = marginText(pnl);
  assert.strictEqual(ui.v, EXPECT.pnl.uiMarginText,
    'UI must withhold the gross-margin % when a sold line item has no COGS on file');
  assert.match(ui.note, /COGS incomplete on 1 line/);
  assert.strictEqual(mcpMarginReliable(pnl), EXPECT.pnl.marginReliable,
    'MCP marginReliable must be false on the SAME condition the UI withholds');
  assert.strictEqual(EXPECT.pnl.marginReliable, false);
});

// ============================================================================
// 3. F5 — tax by state. Real _computeTaxByState: stated orders bucket by state
//    (kept even at $0 tax, for nexus); stateless orders are SURFACED in
//    missingStateOrders, never silently dropped into a phantom bucket. Live on
//    golden-auric 2026-06-22: byState {} + missingState 227 (all stateless).
// ============================================================================
test('F5 tax: real _computeTaxByState byState + stateless count == manifest', async () => {
  const { byState, missingStateOrders } = await _computeTaxByState(WIN[0], WIN[1]);
  assert.deepStrictEqual(byState, EXPECT.tax.byState,
    'per-state {taxCollected, orderCount} must match — incl. OR at $0 (stated, kept) and the shippingState/cents-vs-dollars CA fallback');
  assert.strictEqual(missingStateOrders.length, EXPECT.tax.missingStateCount,
    'stateless orders must be SURFACED (not dropped) — F5: under-reported nexus liability');
  const totalTax = Object.values(byState).reduce((s, v) => s + v.taxCollected, 0);
  assert.strictEqual(totalTax, EXPECT.tax.totalTaxCollected);
});

test('F5 tax: NO stateless order leaks into a phantom "" / undefined state bucket', async () => {
  const { byState } = await _computeTaxByState(WIN[0], WIN[1]);
  assert.ok(!Object.prototype.hasOwnProperty.call(byState, ''), 'no empty-string state key');
  assert.ok(!Object.prototype.hasOwnProperty.call(byState, 'undefined'), 'no "undefined" state key');
  Object.keys(byState).forEach((k) => assert.match(k, /^[A-Z]{2}$/, 'state keys are 2-letter codes only'));
});

// ============================================================================
// 4. AR AGING — real _arAgingSnapshotCore(asOf) rolls up to the manifest buckets.
//    Live on golden-auric: one 'current' invoice (Harbor Goods $540 due 2026-07-12);
//    the fixture reproduces it + spans every overdue bucket.
// ============================================================================
test('AR aging: real _arAgingSnapshotCore == manifest buckets (asOf 2026-06-22)', async () => {
  const rows = await _arAgingSnapshotCore(EXPECT.arAging.asOf);
  const body = rows.slice(1); // drop header row
  const byBucket = {};
  body.forEach((r) => {
    const cents = Math.round(parseFloat(r[4]) * 100); // r[4] = amount due (USD, 2dp)
    const bucket = r[7];
    byBucket[bucket] = (byBucket[bucket] || 0) + cents;
  });
  assert.strictEqual(body.length, EXPECT.arAging.openCount,
    'open-invoice count must match (paid-in-full + test invoices excluded)');
  assert.deepStrictEqual(byBucket, EXPECT.arAging.buckets,
    'AR aging bucket totals must match to the cent (incl. partial-payment due = total - paid)');
  const total = Object.values(byBucket).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, EXPECT.arAging.totalOpenCents);
});

test('AR aging: the real open Harbor Goods invoice ($540) lands in current', async () => {
  const rows = await _arAgingSnapshotCore(EXPECT.arAging.asOf);
  const harbor = rows.find((r) => r[2] === 'INV-2026-0005'); // r[2] = invoice #
  assert.ok(harbor, 'the grounded golden-tenant invoice must be present');
  assert.strictEqual(harbor[7], 'current', 'due 2026-07-12 is not yet overdue as of 2026-06-22');
  assert.strictEqual(harbor[4], '540.00', 'amount due $540.00');
});

// ============================================================================
// 5. DIVERGENCE DEMONSTRATION — the fixture DISCRIMINATES. Each historical buggy
//    form yields a DIFFERENT number than canonical, so the canary would catch a
//    surface that regressed to it. (Proves §1 is not a tautology.)
// ============================================================================
test('divergence: the buggy aggregator forms diverge from canonical (fixture discriminates)', () => {
  let buggyTotal = 0; const buggyChannels = {};
  GOLDEN.orders.forEach((o) => {
    if (o.status === 'cancelled') return;
    if (isTestOrder(o)) return;
    const cents = Math.round((o.total || 0) * 100); // BUG: ignores totalCents (100x on ao-o3)
    if (cents <= 0) return;
    const ch = o.source || 'direct';                // BUG: raw, un-normalized (F1)
    buggyChannels[ch] = (buggyChannels[ch] || 0) + cents; buggyTotal += cents;
  });
  GOLDEN.sales.forEach((s) => {
    if (s.status === 'voided') return;              // BUG: no orderId dedup
    const cents = Math.round((s.amount || 0) * 100); // BUG: amount is already cents (100x)
    if (cents <= 0) return;
    const ch = s.source || 'pos';
    buggyChannels[ch] = (buggyChannels[ch] || 0) + cents; buggyTotal += cents;
  });
  assert.notStrictEqual(buggyTotal, EXPECT.revenue.totalCents,
    'if the buggy total equalled canonical the fixture could not catch the bug');
  assert.ok(buggyTotal > 10000000, 'the cents-in-total + 100x bugs explode the total past $100k');
  assert.ok(Object.keys(buggyChannels).length > Object.keys(EXPECT.revenue.byChannel).length,
    'un-normalized source fragments one real channel across multiple keys (F1 class)');
});

// ============================================================================
// 6. BUG-CLASS MICRO-ASSERTIONS — pin each individual money trap on the REAL
//    extracted helpers, tied to the committed fixture records.
// ============================================================================
test('cents-vs-dollars: order total prefers totalCents (SGTE-0187: $1,020 not $102,000)', () => {
  assert.strictEqual(_orderRevenueCents(order('ao-o3')), 102000);          // both fields = cents
  assert.strictEqual(_orderRevenueCents(order('ao-o1')), 11953);           // dollars-only → x100
  assert.strictEqual(_orderRevenueCents({ totalCents: 0, total: 50 }), 0); // totalCents:0 honored
});

test('100x: admin/sales.amount is cents, read straight ($85 → 8500, never 850000)', () => {
  assert.strictEqual(_salesCents({ amount: 8500 }), 8500);
  assert.strictEqual(_salesCents(GOLDEN.sales.find((s) => s.id === 'ao-s2')), 12000);
});

test('POS double-count: an orders-linked admin/sales mirror does NOT re-count', () => {
  assert.strictEqual(!!_salesRowCounts(GOLDEN.sales.find((s) => s.id === 'ao-s1')), false); // orderId → dedup
  assert.strictEqual(!!_salesRowCounts(GOLDEN.sales.find((s) => s.id === 'ao-s2')), true);  // standalone counts
  assert.strictEqual(!!_salesRowCounts(GOLDEN.sales.find((s) => s.id === 'ao-s3')), false); // voided
});

test('channel fragmentation (F1): every synonym collapses onto one canonical key', () => {
  assert.strictEqual(_chan('pos'), 'in_person');
  assert.strictEqual(_chan('direct-pos'), 'in_person');
  assert.strictEqual(_chan('craft-fair'), 'in_person');
  assert.strictEqual(_chan('Online Store'), 'dtc_online');
  assert.strictEqual(_chan('online'), 'dtc_online');
  assert.strictEqual(_chan('Etsy'), 'marketplace');
  assert.strictEqual(_chan('wholesale'), 'wholesale');
});

test('Timestamp coercion: a Firestore-Timestamp createdAt does not break the money read', () => {
  const o5 = order('ao-o5');
  assert.ok(o5.createdAt && typeof o5.createdAt === 'object', 'fixture row carries a {_seconds} Timestamp');
  assert.strictEqual(_orderRevenueCents(o5), 4500);
});

test('AR bucket thresholds: the shared _agingBucket / _daysOverdue rule', () => {
  assert.strictEqual(_agingBucket(0), 'current');
  assert.strictEqual(_agingBucket(30), '1_to_30');
  assert.strictEqual(_agingBucket(31), '31_to_60');
  assert.strictEqual(_agingBucket(90), '61_to_90');
  assert.strictEqual(_agingBucket(91), '90_plus');
  assert.strictEqual(_daysOverdue('2026-06-05', '2026-06-22'), 17);
  assert.strictEqual(_daysOverdue('2026-07-12', '2026-06-22'), 0); // future due → not overdue
});

test('test-channel exclusion: the revenue loop drops a source:test order', () => {
  assert.strictEqual(isTestOrder(order('ao-o8')), true);
  assert.strictEqual(isTestSource('test'), true);
  assert.strictEqual(isTestSource('online'), false);
});

// ============================================================================
// 7. F14 margin-gate unit cases (the UI marginText, isolated) — hand-built P&L
//    shapes so the withhold/show boundary is pinned independent of the fixture.
// ============================================================================
test('F14 unit: incomplete COGS withholds; complete COGS shows; zero-revenue dashes', () => {
  assert.strictEqual(marginText({ revenue: 9316851, grossProfit: 9199921, cogsLineMissingCount: 22, cogsMissing: false }).v, '—');
  assert.strictEqual(marginText({ revenue: 100000, grossProfit: 60000, cogsLineMissingCount: 0, cogsMissing: false }).v, '60.0%');
  assert.strictEqual(marginText({ revenue: 50000, grossProfit: 50000, cogsLineMissingCount: 3, cogsLineCoveredCount: 0, cogsMissing: true }).v, '—');
  assert.strictEqual(marginText({ revenue: 0 }).v, '—');
});

// ============================================================================
// 8. MANIFEST SELF-CONSISTENCY — the committed contract is internally sound.
// ============================================================================
test('manifest: cross-surface self-checks hold (gross=rev-cogs, net=gross-opex, Σchannel=total)', () => {
  const r = EXPECT.revenue; const p = EXPECT.pnl;
  assert.strictEqual(r.totalCents, p.revenue, 'revenue.total == pnl.revenue');
  assert.strictEqual(p.grossProfit, p.revenue - p.cogs, 'gross == revenue - cogs');
  assert.strictEqual(p.netProfit, p.grossProfit - p.opex, 'net == gross - opex');
  assert.strictEqual(Object.values(r.byChannel).reduce((a, b) => a + b, 0), r.totalCents, 'Σ byChannel == total');
  assert.strictEqual(Object.values(EXPECT.arAging.buckets).reduce((a, b) => a + b, 0), EXPECT.arAging.totalOpenCents);
});
