'use strict';

// Tests the dollars-vs-cents normalization used by every Finance Overview /
// #financials reader (MTD Revenue, AR Outstanding, P&L, Cash Flow, CSV exports).
//
// Regression context: sgtest15's #financials screen showed "MTD REVENUE
// $280,957.50" against a true all-time gross of ~$10,522 (~27x inflated). Root
// cause: the readers did `Math.round((o.total || 0) * 100)` unconditionally, but
// some orders store `total` ALREADY in cents (e.g. SGTE-0187/0188:
// total:102000 AND totalCents:102000, both meaning $1,020.00). Those few orders
// alone produced ~$280K. Fix mirrors mast-tenant-mcp-server order-money.ts
// orderRevenueCents (the same normalizer compare_channels uses).
//
// We extract the REAL _orderRevenueCents from the shipped finance.js source (not
// a hand-copied duplicate) so this test fails if the function regresses.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadOrderRevenueCents() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'modules', 'finance.js'),
    'utf8'
  );
  // Capture the self-contained helper: from its declaration to the first
  // column-0 closing brace.
  const m = src.match(/function _orderRevenueCents\(o\) \{[\s\S]*?\n\}/);
  assert.ok(m, '_orderRevenueCents not found in finance.js');
  // eslint-disable-next-line no-eval
  return eval('(' + m[0].replace('function _orderRevenueCents', 'function') + ')');
}

const _orderRevenueCents = loadOrderRevenueCents();

// W7 return/refund regression: revenue must REVERSE for cancelled / returned /
// fully-refunded orders, and NET DOWN by refundedCents for a partial refund.
// Before the fix, only `cancelled` was excluded, so a fully-refunded order kept
// contributing its full positive total to finance_get_revenue / P&L forever.
// We extract the REAL helper + constant from the shipped finance.js so this test
// fails if either regresses.
function loadOrderNetRevenueCents() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'modules', 'finance.js'),
    'utf8'
  );
  const fnSrc = src.match(/function _orderRevenueCents\(o\) \{[\s\S]*?\n\}/);
  assert.ok(fnSrc, '_orderRevenueCents not found in finance.js');
  const constSrc = src.match(/var REVENUE_REVERSING_STATUSES = \{[\s\S]*?\n\};/);
  assert.ok(constSrc, 'REVENUE_REVERSING_STATUSES not found in finance.js');
  const netSrc = src.match(/function _orderNetRevenueCents\(o\) \{[\s\S]*?\n\}/);
  assert.ok(netSrc, '_orderNetRevenueCents not found in finance.js');
  // eslint-disable-next-line no-eval
  return eval(
    '(function(){' +
    fnSrc[0] + '\n' +
    constSrc[0] + '\n' +
    netSrc[0] + '\n' +
    'return _orderNetRevenueCents;})()'
  );
}

const _orderNetRevenueCents = loadOrderNetRevenueCents();

test('live order recognizes full revenue (no refund)', () => {
  assert.strictEqual(_orderNetRevenueCents({ totalCents: 12000, status: 'fulfilled' }), 12000);
});

test('cancelled order reverses revenue to 0', () => {
  assert.strictEqual(_orderNetRevenueCents({ totalCents: 12000, status: 'cancelled' }), 0);
});

test('fully-refunded order reverses revenue to 0 (the W7 bug)', () => {
  // Confirmed live on sgtest15: status=refunded had been counting +$120.
  assert.strictEqual(_orderNetRevenueCents({ totalCents: 12000, status: 'refunded' }), 0);
});

test('returned / return_received orders reverse revenue to 0', () => {
  assert.strictEqual(_orderNetRevenueCents({ totalCents: 12000, status: 'returned' }), 0);
  assert.strictEqual(_orderNetRevenueCents({ totalCents: 12000, status: 'return_received' }), 0);
});

test('partial refund nets down by refundedCents, not zeroed', () => {
  // $120 order, $30 refunded, order still live → recognizes $90.
  assert.strictEqual(
    _orderNetRevenueCents({ totalCents: 12000, refundedCents: 3000, status: 'fulfilled' }),
    9000
  );
});

test('partial refund >= total nets to 0 (never negative)', () => {
  assert.strictEqual(
    _orderNetRevenueCents({ totalCents: 12000, refundedCents: 15000, status: 'fulfilled' }),
    0
  );
});

test('refundedCents on an already-reversed status still yields 0', () => {
  assert.strictEqual(
    _orderNetRevenueCents({ totalCents: 12000, refundedCents: 3000, status: 'refunded' }),
    0
  );
});

test('net helper inherits dollars/cents normalization for partials', () => {
  // legacy dollars total ($119.53) minus a $19.53 refund → $100.00.
  assert.strictEqual(
    _orderNetRevenueCents({ total: 119.53, refundedCents: 1953, status: 'fulfilled' }),
    10000
  );
});

test('SGTE-0187 case: total AND totalCents both hold cents → not 100x', () => {
  // The order that drove the inflation. Both fields = 102000 cents = $1,020.00.
  const order = { total: 102000, totalCents: 102000 };
  const cents = _orderRevenueCents(order);
  assert.strictEqual(cents, 102000, 'should be $1,020.00 in cents');
  assert.strictEqual(cents / 100, 1020, 'should contribute $1,020.00, not $102,000');
});

test('legacy storefront order: dollars-only total → x100', () => {
  // SGTE-0079 shape: total in dollars, no totalCents.
  assert.strictEqual(_orderRevenueCents({ total: 119.53 }), 11953);
});

test('totalCents is authoritative even if total disagrees', () => {
  assert.strictEqual(_orderRevenueCents({ total: 9999, totalCents: 4250 }), 4250);
});

test('totalCents: 0 is honored (not silently dropped to total*100)', () => {
  // The old `o.totalCents || total*100` form would mis-read this as $0... or
  // worse fall through to total. typeof guard keeps 0 meaning $0.00.
  assert.strictEqual(_orderRevenueCents({ totalCents: 0, total: 50 }), 0);
});

test('missing / malformed inputs → 0', () => {
  assert.strictEqual(_orderRevenueCents(null), 0);
  assert.strictEqual(_orderRevenueCents({}), 0);
  assert.strictEqual(_orderRevenueCents({ total: 'x' }), 0);
});

test('MTD aggregate of mixed-shape orders matches compare_channels scale', () => {
  // A realistic sgtest15-shaped slice: two big cents-in-total orders + a few
  // legacy dollar orders. The bug summed this to ~$280K; correct is ~$10K.
  const orders = [
    { total: 102000, totalCents: 102000 }, // SGTE-0187  $1,020.00
    { total: 102000, totalCents: 102000 }, // SGTE-0188  $1,020.00
    { total: 119.53 },                     // SGTE-0079  $119.53 (legacy dollars)
    { totalCents: 328756 },                // $3,287.56 (cents-native)
    { total: 4500, totalCents: 4500 },     // $45.00 (cents-in-total)
    { total: 250.0 },                      // $250.00 (legacy dollars)
  ];
  const totalCents = orders.reduce((s, o) => s + _orderRevenueCents(o), 0);
  const dollars = totalCents / 100;
  assert.strictEqual(dollars, 1020 + 1020 + 119.53 + 3287.56 + 45 + 250);
  assert.ok(dollars < 11000, 'corrected total stays in the ~$10K range, not ~$280K');
});
