/**
 * Characterization goldens for the canonical money/date formatters
 * (shared/mast-ui.js → MastUI.Num). Safety net for the decomposition program:
 * these pin CURRENT behavior so a refactor that moves/centralizes the formatters
 * (Track 5 — mast-format.js) fails loudly if it changes a result by accident.
 *
 * Deliberately covers the HIGH-RISK surfaces the existing mast-ui.test.js does
 * NOT: lineTotalVal (the cents-vs-dollars line-item defuser behind the recurring
 * "$1,020 line renders as $102,000" class) and the Firestore-Timestamp gap in
 * Num.date (the recurring "createdAt is a Timestamp object" class). The latter is
 * pinned as the KNOWN CURRENT GAP ('' today); Track 5's coerceDate will close it,
 * and this golden will then flag that as the intended change to update here.
 *
 * Run: node test/format-goldens.test.js
 */
'use strict';

// Pin TZ so date goldens are deterministic across CI runners. The calendar-date
// cases below are TZ-robust by construction (Num.date builds them as local
// midnight), but this removes any doubt.
process.env.TZ = 'America/New_York';

const assert = require('assert');
const { Num } = require('../shared/mast-ui.js');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }

console.log('Format goldens (MastUI.Num money/date)');

// ── lineTotalVal — the cents-vs-dollars line-item defuser (UNTESTED before) ──
// A line item arrives in shapes that disagree on unit AND field name; reading any
// single field raw miscounts. cents-explicit fields must win.
t('lineTotalVal: lineTotal is CENTS×qty → ÷100', () =>
  assert.strictEqual(Num.lineTotalVal({ lineTotal: 102000, quantity: 1 }), 1020));
t('lineTotalVal: priceCents × qty → ÷100', () =>
  assert.strictEqual(Num.lineTotalVal({ priceCents: 510, quantity: 2 }), 10.2));
t('lineTotalVal: total is DOLLARS already', () =>
  assert.strictEqual(Num.lineTotalVal({ total: 49.5 }), 49.5));
t('lineTotalVal: price × qty (dollars, per-unit)', () =>
  assert.strictEqual(Num.lineTotalVal({ price: 10, qty: 3 }), 30));
t('lineTotalVal: cents field WINS over a dollar field (no $102k bug)', () =>
  assert.strictEqual(Num.lineTotalVal({ lineTotal: 102000, total: 5 }), 1020));
t('lineTotalVal: nothing usable → null (em-dash, not $0)', () =>
  assert.strictEqual(Num.lineTotalVal({}), null));
t('lineTotalVal: qty defaults to 1 when absent', () =>
  assert.strictEqual(Num.lineTotalVal({ priceCents: 250 }), 2.5));

// ── money / moneyRaw edge cases (separators covered elsewhere; pin the edges) ──
t('money(0) → "$0.00" (a real zero, not blank)', () =>
  assert.strictEqual(Num.money(0), '$0.00'));
t('money(null) → "" and money(NaN) → ""', () => {
  assert.strictEqual(Num.money(null), '');
  assert.strictEqual(Num.money(NaN), '');
});
t('money(negative) → "$-1,234.50" (current sign placement)', () =>
  assert.strictEqual(Num.money(-1234.5), '$-1,234.50'));
t('moneyRaw cents mode → "22.50"', () =>
  assert.strictEqual(Num.moneyRaw(2250, { cents: true }), '22.50'));

// ── moneyVal — cents wins, dollar fallback, genuine-zero, absent (the P0) ──
t('moneyVal: genuine 0 cents → 0 (not the dollar fallback)', () =>
  assert.strictEqual(Num.moneyVal({ shippingCents: 0, shipping: 9 }, 'shippingCents', 'shipping'), 0));
t('moneyVal: absent on both → null', () =>
  assert.strictEqual(Num.moneyVal({}, 'totalCents', 'total'), null));

// ── date — calendar-date off-by-one fix is TZ-robust (local midnight) ──
t('date: bare calendar "2026-06-07" → "Jun 7, 2026" (no off-by-one)', () =>
  assert.strictEqual(Num.date('2026-06-07'), 'Jun 7, 2026'));
t('date: midnight-UTC calendar string → same calendar day', () =>
  assert.strictEqual(Num.date('2026-06-07T00:00:00.000Z'), 'Jun 7, 2026'));
t('date: null/empty/garbage → "" (never the Unix epoch)', () => {
  assert.strictEqual(Num.date(null), '');
  assert.strictEqual(Num.date(''), '');
  assert.strictEqual(Num.date('xyz'), '');
});
t('dateRaw: timestamped string → ISO date', () =>
  assert.strictEqual(Num.dateRaw('2026-05-01T13:29:00Z'), '2026-05-01'));

// ── KNOWN CURRENT GAP: Num.date does NOT coerce a Firestore Timestamp ──
// Both a raw {seconds,nanoseconds} and one with .toDate() render '' today, which
// is why modules hand-roll their own dateStr() coercion. Track 5 (coerceDate)
// closes this; when it does, UPDATE these two assertions intentionally.
t('date GAP: {seconds,nanoseconds} Timestamp → "" today (Track 5 closes)', () =>
  assert.strictEqual(Num.date({ seconds: 1749225600, nanoseconds: 0 }), ''));
t('date GAP: Timestamp with .toDate() → "" today (Track 5 closes)', () =>
  assert.strictEqual(Num.date({ seconds: 1749225600, toDate() { return new Date(1749225600000); } }), ''));

console.log(`\n${pass} format goldens passed.`);
