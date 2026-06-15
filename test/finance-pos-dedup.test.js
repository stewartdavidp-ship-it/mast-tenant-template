'use strict';

// Regression guard for the POS double-count fix + the admin/sales 100x cents
// bug in the Finance summation readers (#537). No test shipped with that fix;
// this locks it in.
//
// Context:
//   (1) Double-count. The POS-square checkout (pos/index.html _writeSaleToServer)
//       writes BOTH a canonical `orders` row (via submitOrder) AND an `admin/sales`
//       MIRROR for the same transaction, stamping the mirror with `orderId`. Finance
//       summed `orders` and `admin/sales` independently with no join, so every POS
//       sale that became an order counted twice across Revenue, P&L, the monthly
//       breakdown, the dashboard Revenue lens, and prior-period comparison.
//       Fix: the canonical `_salesRowCounts(s)` rule — count iff not voided AND no
//       linked orderId — applied to all five readers (_loadRevenueAggregate,
//       loadRevenue, computePnlLocal, computeMonthlyBreakdown, _loadRevenueRows).
//       The mirror WRITE is untouched: admin/sales is still the source for the Day
//       Close / Sales Ledger and Fair-mode reporting. Standalone admin/sales rows
//       (manual / Fair-mode / legacy POS) have NO orderId and remain the sole money
//       record — they still count.
//   (2) 100x cents. computeMonthlyBreakdown read `(s.amount||0)*100`, but
//       admin/sales.amount is ALREADY integer cents (live sgtest15: an $85 sale
//       stores amount:8500). Routed through the canonical `_salesCents` like every
//       other reader.
//
// Both helpers are extracted from the SHIPPED finance.js source (not hand-copied)
// so this test fails if either regresses.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'modules', 'finance.js'),
  'utf8'
);

function extractFn(name) {
  // Single-line helper: `function NAME(args) { ... }` up to the closing brace.
  const m = SRC.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[^\\n]*\\}'));
  assert.ok(m, name + ' not found in finance.js');
  // eslint-disable-next-line no-eval
  return eval('(' + m[0].replace('function ' + name, 'function') + ')');
}

const _salesCents = extractFn('_salesCents');
const _salesRowCounts = extractFn('_salesRowCounts');

// ── 100x cents fix ──────────────────────────────────────────────────────────

test('admin/sales.amount is read as cents, not x100 ($85 sale → 8500)', () => {
  assert.strictEqual(_salesCents({ amount: 8500 }), 8500);
  assert.strictEqual(_salesCents({ amount: 8500 }) / 100, 85);
});

test('_salesCents: missing / malformed amount → 0', () => {
  assert.strictEqual(_salesCents(null), 0);
  assert.strictEqual(_salesCents({}), 0);
  assert.strictEqual(_salesCents({ amount: 'x' }), 0);
});

// ── counting rule: voided + order-linked suppression ──────────────────────────

test('_salesRowCounts: a plain captured standalone sale counts', () => {
  assert.strictEqual(!!_salesRowCounts({ amount: 6500, status: 'captured' }), true);
  assert.strictEqual(!!_salesRowCounts({ amount: 6500, status: 'captured', orderId: null }), true);
});

test('_salesRowCounts: order-linked mirror does NOT count (canonical orders row)', () => {
  assert.strictEqual(!!_salesRowCounts({ amount: 8500, status: 'captured', orderId: 'ord_pos_1' }), false);
});

test('_salesRowCounts: voided does NOT count, with or without orderId', () => {
  assert.strictEqual(!!_salesRowCounts({ amount: 5000, status: 'voided' }), false);
  assert.strictEqual(!!_salesRowCounts({ amount: 5000, status: 'voided', orderId: 'ord_x' }), false);
});

test('_salesRowCounts: null/empty row does not count', () => {
  assert.strictEqual(!!_salesRowCounts(null), false);
});

// ── combined summation behavior (mirrors the reader loops) ────────────────────

// Replicates the guard order every patched reader uses: _salesRowCounts → add _salesCents.
function sumSales(rows) {
  let cents = 0;
  rows.forEach(function (s) {
    if (!_salesRowCounts(s)) return;
    cents += _salesCents(s);
  });
  return cents;
}

test('POS sale that also became an order is NOT double-counted', () => {
  // The order ($85) is summed from `orders`; its admin/sales mirror carries the
  // orderId and must be skipped. A standalone manual sale ($120, no orderId) and
  // a Fair-mode sale ($65, no orderId) are still counted.
  const orderRevenueCents = 8500; // the canonical orders row for the POS sale
  const salesRows = [
    { amount: 8500, orderId: 'ord_pos_1', status: 'captured' }, // mirror — skip
    { amount: 12000, orderId: null, status: 'captured' },       // manual — count
    { amount: 6500, status: 'captured' },                       // Fair-mode — count
  ];
  const salesContribution = sumSales(salesRows);
  assert.strictEqual(salesContribution, 18500, 'only the two order-less sales count');
  assert.strictEqual(orderRevenueCents + salesContribution, 27000,
    'grand total = $85 (order, once) + $120 + $65 = $270, NOT $355 (no double-count)');
});
