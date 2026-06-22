'use strict';

// ============================================================================
// WRITE-DELTA RUNNER — pure-transform unit tests (offline, deterministic).
// ============================================================================
//
// The unattended runner (scripts/qa-spine/write-delta-runner.mjs) reads the
// SHIPPED admin oracle in-page (FinanceBridge.loadRevenueAggregate / computePnl +
// MastDB.get('admin/inventory/{pid}')) and maps those RAW shapes into the canary
// snapshot the pure engine (write-delta-core.mjs) consumes. That in-page read is
// the one credentialed piece that only runs with the QA admin secret; the MAP is
// pure and is what this test pins — against the EXACT shapes captured live from
// the mast-mcp oracle + the shipped finance.js source, so a silent field-name or
// formula drift is caught offline.
//
// The load-bearing trap it guards: the shipped FinanceBridge returns revenue as
// `totalCents` and P&L OpEx as `opex`, while the engine asserts on
// `revenue.total` and `pnl.operatingExpenses`. If buildSnapshot stops mapping
// those, A4c (`netProfit == grossProfit - operatingExpenses`) silently reads NaN
// and the canary goes false-GREEN/false-RED. We assert the mapped snapshot makes
// the REAL engine pass A1–A5 on a clean sale.
//
// Run: node test/write-delta-runner.test.js   (exit 0 = pass)

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const RUNNER = path.join(__dirname, '..', 'scripts', 'qa-spine', 'write-delta-runner.mjs');
const CORE = path.join(__dirname, '..', 'scripts', 'qa-spine', 'write-delta-core.mjs');

// The runner is ESM; import its pure exports from a tiny ESM shim via dynamic import.
async function load() {
  const runner = await import(path.relative(__dirname, RUNNER).replace(/\\/g, '/').startsWith('.') ? RUNNER : RUNNER);
  const core = await import(CORE);
  return { ...runner, assertWriteDelta: core.assertWriteDelta, getCanonicalChannels: core.getCanonicalChannels };
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ✔', name); }
  catch (e) { failures++; console.log('  ✗ FAIL', name, '\n    ', e.message); }
}

(async () => {
  const { computeStockTotals, buildSnapshot, assertWriteDelta, getCanonicalChannels } = await load();
  console.log('\n══ write-delta-runner pure transforms ══');

  // ── computeStockTotals — the canonical inventory formula on LIVE shapes ──
  console.log('\ncomputeStockTotals:');
  check('fixture _default doc (live qa-write-canary shape) → onHand/avail/committed', () => {
    // exactly the raw admin/inventory/qa-write-canary doc MastDB.get returns
    const doc = { updatedAt: 'x', stock: { _default: { onHand: 100, committed: 0, held: 0, damaged: 0, incoming: 0 } }, stockType: 'strict' };
    assert.deepEqual(computeStockTotals(doc), { stockType: 'strict', totalOnHand: 100, totalAvailable: 100, totalCommitted: 0 });
  });
  check('witness Light Orb shape (onHand 0) → all zero', () => {
    const doc = { stock: { _default: { onHand: 0 } }, stockType: 'stock-to-build' };
    assert.deepEqual(computeStockTotals(doc), { stockType: 'stock-to-build', totalOnHand: 0, totalAvailable: 0, totalCommitted: 0 });
  });
  check('committed + held draw down available (storefront reserve / hold)', () => {
    const doc = { stock: { _default: { onHand: 100, committed: 3, held: 1, damaged: 0 } }, stockType: 'strict' };
    assert.deepEqual(computeStockTotals(doc), { stockType: 'strict', totalOnHand: 100, totalAvailable: 96, totalCommitted: 3 });
  });
  check('variant combos sum across keys (ignores _default when variants present)', () => {
    const doc = { stock: { red: { onHand: 5, committed: 1 }, blue: { onHand: 3, committed: 0 } }, stockType: 'strict' };
    assert.deepEqual(computeStockTotals(doc), { stockType: 'strict', totalOnHand: 8, totalAvailable: 7, totalCommitted: 1 });
  });
  check('legacy flat numeric stock normalizes', () => {
    assert.deepEqual(computeStockTotals({ stock: 4, stockType: 'strict' }), { stockType: 'strict', totalOnHand: 4, totalAvailable: 4, totalCommitted: 0 });
  });
  check('available floors at 0 (never negative)', () => {
    const doc = { stock: { _default: { onHand: 1, committed: 5 } } };
    assert.equal(computeStockTotals(doc).totalAvailable, 0);
  });
  check('null doc → null (missing fixture surfaces as A3 failure, not a crash)', () => {
    assert.equal(computeStockTotals(null), null);
  });
  check('bare stock-map shape (no .stock wrapper) tolerated', () => {
    const bareMap = { _default: { onHand: 100, committed: 1 } }; // MastDB may return the map itself
    assert.deepEqual(computeStockTotals(bareMap), { stockType: 'build-to-order', totalOnHand: 100, totalAvailable: 99, totalCommitted: 1 });
  });

  // ── buildSnapshot — FinanceBridge/MastDB raw → engine snapshot, LIVE values ──
  console.log('\nbuildSnapshot (live sgtest15 figures, FinanceBridge field names):');
  // The shipped FinanceBridge returns { totalCents, byChannel } and computePnl
  // returns { revenue, cogs, grossProfit, opex, netProfit, cogsLineMissingCount,
  // cogsMissing }. These are the EXACT sgtest15 numbers read live (revenue 852351,
  // opex 891048, missing 22) but in the bridge's own key names.
  const rawBefore = {
    rev: { totalCents: 852351, byChannel: { dtc_online: 215856, in_person: 550995, phone: 48000, manual: 37500 }, txnCount: 53 },
    pnl: { revenue: 852351, cogs: 116930, grossProfit: 735421, opex: 891048, netProfit: -155627, cogsLineMissingCount: 22, cogsMissing: false },
    inv: { 'qa-write-canary': { stock: { _default: { onHand: 100, committed: 0 } }, stockType: 'strict' },
           'witness': { stock: { _default: { onHand: 0 } }, stockType: 'stock-to-build' } },
  };
  const before = buildSnapshot(rawBefore);
  check('revenue.totalCents → revenue.total', () => assert.equal(before.revenue.total, 852351));
  check('pnl.opex → operatingExpenses (the A4c NaN trap)', () => assert.equal(before.pnl.operatingExpenses, 891048));
  check('marginReliable derived from cogsLineMissingCount>0', () => assert.equal(before.pnl.marginReliable, false));
  check('fixture inventory mapped from raw admin/inventory doc', () => {
    assert.deepEqual(before.products['qa-write-canary'], { stockType: 'strict', totalOnHand: 100, totalAvailable: 100, totalCommitted: 0 });
  });
  check('A4 reconciliation holds on the mapped shape (gross=rev-cogs, net=gross-opex)', () => {
    assert.equal(before.pnl.grossProfit, before.pnl.revenue - before.pnl.cogs);
    assert.equal(before.pnl.netProfit, before.pnl.grossProfit - before.pnl.operatingExpenses);
  });

  // ── integration: a clean storefront sale through the mapped snapshot → engine GREEN ──
  console.log('\nintegration: mapped snapshot + a $25 storefront sale → engine A1–A5 GREEN:');
  const T = 2500;
  const rawAfter = {
    rev: { totalCents: 852351 + T, byChannel: { dtc_online: 215856 + T, in_person: 550995, phone: 48000, manual: 37500 } },
    pnl: { revenue: 852351 + T, cogs: 116930, grossProfit: 735421 + T, opex: 891048, netProfit: -155627 + T, cogsLineMissingCount: 22, cogsMissing: false },
    inv: { 'qa-write-canary': { stock: { _default: { onHand: 100, committed: 1 } }, stockType: 'strict' }, // storefront reserve: committed +1
           'witness': { stock: { _default: { onHand: 0 } }, stockType: 'stock-to-build' } },
  };
  const after = buildSnapshot(rawAfter);
  const CANON = getCanonicalChannels();
  const res = assertWriteDelta(before, after, { deltaCents: T, channel: 'dtc_online', fixturePid: 'qa-write-canary', qty: 1 }, CANON);
  check('engine verdict GREEN on the mapped real-shape snapshots', () => {
    assert.ok(res.pass, 'failed: ' + res.assertions.filter((a) => !a.pass).map((a) => a.name).join(', '));
  });
  check('A3b storefront reserve path: committed +1, onHand flat', () => {
    const a3b = res.assertions.find((a) => a.name.startsWith('A3b'));
    assert.ok(a3b && a3b.pass, 'A3b should pass for the reserve (committed) path');
  });

  // ── the runner imports cleanly without launching a live run ──
  console.log('\nimport guard:');
  check('importing the runner module does NOT execute main() (no env, no hang)', () => {
    // Executed implicitly: load() above imported the runner; if main() ran it
    // would have exited(2) on missing MAST_BASE_URL and this process would be dead.
    assert.ok(typeof buildSnapshot === 'function');
  });

  console.log(`\n══ write-delta-runner.test.js: ${failures === 0 ? 'PASS' : failures + ' FAILURE(S)'} ══`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('test harness error:', e); process.exit(1); });
