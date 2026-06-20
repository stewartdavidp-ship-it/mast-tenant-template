/**
 * Unit tests for the centralized money/date core (shared/mast-format.js — Track 5).
 *
 * Mirrors test/format-goldens.test.js (which pins the CURRENT MastUI.Num behavior):
 * the money/lineTotalVal/date/dateRaw cases assert mast-format is BEHAVIOR-IDENTICAL
 * to Num for the non-Timestamp shapes, PLUS the NEW coerceDate behavior — a Firestore
 * Timestamp object now renders a real date instead of '' (the goldens-pinned gap that
 * Track 5 closes). Hand-rolled assert + t() helper, TZ pinned for determinism.
 *
 * Run: node test/mast-format.test.js
 */
'use strict';

// Pin TZ so date assertions are deterministic across CI runners. The calendar-date
// cases are TZ-robust by construction (date() builds them as local midnight), and
// the Timestamp-epoch cases below are chosen to land mid-day in America/New_York so
// they render the same calendar day regardless of the runner's zone.
process.env.TZ = 'America/New_York';

const assert = require('assert');
const F = require('../shared/mast-format.js');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }

console.log('mast-format core (money/date/coerceDate)');

// ── money / moneyRaw edge cases ──────────────────────────────────────────────
t('money(0) → "$0.00" (a real zero, not blank)', () =>
  assert.strictEqual(F.money(0), '$0.00'));
t('money(102000) → "$102,000.00" (separators)', () =>
  assert.strictEqual(F.money(102000), '$102,000.00'));
t('money cents mode: money(2250,{cents}) → "$22.50"', () =>
  assert.strictEqual(F.money(2250, { cents: true }), '$22.50'));
t('money(null) → "" and money(NaN) → ""', () => {
  assert.strictEqual(F.money(null), '');
  assert.strictEqual(F.money(NaN), '');
});
t('money(negative) → "$-1,234.50" (sign placement matches Num)', () =>
  assert.strictEqual(F.money(-1234.5), '$-1,234.50'));
t('moneyRaw(102000) → "102000.00" (no symbol/separators)', () =>
  assert.strictEqual(F.moneyRaw(102000), '102000.00'));
t('moneyRaw cents mode → "22.50"', () =>
  assert.strictEqual(F.moneyRaw(2250, { cents: true }), '22.50'));
t('moneyRaw(null) → ""', () =>
  assert.strictEqual(F.moneyRaw(null), ''));

// ── moneyVal — cents wins, dollar fallback, genuine-zero, absent ─────────────
t('moneyVal: cents field present → ÷100', () =>
  assert.strictEqual(F.moneyVal({ totalCents: 4950, total: 1 }, 'totalCents', 'total'), 49.5));
t('moneyVal: genuine 0 cents → 0 (not the dollar fallback)', () =>
  assert.strictEqual(F.moneyVal({ shippingCents: 0, shipping: 9 }, 'shippingCents', 'shipping'), 0));
t('moneyVal: cents absent → dollar field', () =>
  assert.strictEqual(F.moneyVal({ total: 12.5 }, 'totalCents', 'total'), 12.5));
t('moneyVal: absent on both → null', () =>
  assert.strictEqual(F.moneyVal({}, 'totalCents', 'total'), null));

// ── lineTotalVal — the 4 shapes (the $102k defuser) ──────────────────────────
t('lineTotalVal: lineTotal is CENTS×qty → ÷100', () =>
  assert.strictEqual(F.lineTotalVal({ lineTotal: 102000, quantity: 1 }), 1020));
t('lineTotalVal: priceCents × qty → ÷100', () =>
  assert.strictEqual(F.lineTotalVal({ priceCents: 510, quantity: 2 }), 10.2));
t('lineTotalVal: total is DOLLARS already', () =>
  assert.strictEqual(F.lineTotalVal({ total: 49.5 }), 49.5));
t('lineTotalVal: price × qty (dollars, per-unit)', () =>
  assert.strictEqual(F.lineTotalVal({ price: 10, qty: 3 }), 30));
t('lineTotalVal: cents field WINS over a dollar field (no $102k bug)', () =>
  assert.strictEqual(F.lineTotalVal({ lineTotal: 102000, total: 5 }), 1020));
t('lineTotalVal: nothing usable → null (em-dash, not $0)', () =>
  assert.strictEqual(F.lineTotalVal({}), null));
t('lineTotalVal: qty defaults to 1 when absent', () =>
  assert.strictEqual(F.lineTotalVal({ priceCents: 250 }), 2.5));

// ── date — calendar-date off-by-one fix is TZ-robust (local midnight) ────────
t('date: bare calendar "2026-06-07" → "Jun 7, 2026" (no off-by-one)', () =>
  assert.strictEqual(F.date('2026-06-07'), 'Jun 7, 2026'));
t('date: midnight-UTC calendar string → same calendar day', () =>
  assert.strictEqual(F.date('2026-06-07T00:00:00.000Z'), 'Jun 7, 2026'));
t('date: a real Date → formatted', () =>
  assert.strictEqual(F.date(new Date(2026, 4, 1, 13, 0, 0)), 'May 1, 2026'));
t('date: null/empty/garbage → "" (never the Unix epoch)', () => {
  assert.strictEqual(F.date(null), '');
  assert.strictEqual(F.date(''), '');
  assert.strictEqual(F.date('xyz'), '');
});
t('dateRaw: timestamped string → ISO date', () =>
  assert.strictEqual(F.dateRaw('2026-05-01T13:29:00Z'), '2026-05-01'));
t('dateRaw: null → ""', () =>
  assert.strictEqual(F.dateRaw(null), ''));

// ── coerceDate — the NEW Firestore-Timestamp defuser (the gap, CLOSED) ───────
// Pick an epoch that is mid-day in America/New_York so the rendered calendar day
// is unambiguous: 2026-06-07T16:00:00Z == 12:00 EDT on Jun 7.
const MIDDAY_2026_06_07 = 1780848000; // seconds — 2026-06-07T12:00 EDT

t('coerceDate: a Date → itself', () => {
  const d = new Date(2026, 4, 1);
  assert.strictEqual(F.coerceDate(d), d);
});
t('coerceDate: an invalid Date → null', () =>
  assert.strictEqual(F.coerceDate(new Date('nope')), null));
t('coerceDate: null/empty → null', () => {
  assert.strictEqual(F.coerceDate(null), null);
  assert.strictEqual(F.coerceDate(''), null);
});
t('coerceDate: a string flows through UNCHANGED (date() owns calendar parsing)', () =>
  assert.strictEqual(F.coerceDate('2026-06-07'), '2026-06-07'));
t('coerceDate: {seconds,nanoseconds} Timestamp → a JS Date at that epoch', () => {
  const out = F.coerceDate({ seconds: MIDDAY_2026_06_07, nanoseconds: 0 });
  assert.ok(out instanceof Date);
  assert.strictEqual(out.getTime(), MIDDAY_2026_06_07 * 1000);
});
t('coerceDate: Timestamp .toDate() instance → its Date', () => {
  const ts = { seconds: MIDDAY_2026_06_07, toDate() { return new Date(MIDDAY_2026_06_07 * 1000); } };
  const out = F.coerceDate(ts);
  assert.ok(out instanceof Date);
  assert.strictEqual(out.getTime(), MIDDAY_2026_06_07 * 1000);
});
t('coerceDate: nanoseconds contribute milliseconds', () => {
  const out = F.coerceDate({ seconds: MIDDAY_2026_06_07, nanoseconds: 500000000 });
  assert.strictEqual(out.getTime(), MIDDAY_2026_06_07 * 1000 + 500);
});
t('coerceDate: junk object → null', () =>
  assert.strictEqual(F.coerceDate({ foo: 'bar' }), null));

// ── GAP CLOSED: date()/dateRaw() now render a Firestore Timestamp ─────────────
// These are the two assertions the goldens pin as '' TODAY for MastUI.Num; Track 5
// intentionally changes that result here.
t('date GAP CLOSED: {seconds,nanoseconds} Timestamp → "Jun 7, 2026"', () =>
  assert.strictEqual(F.date({ seconds: MIDDAY_2026_06_07, nanoseconds: 0 }), 'Jun 7, 2026'));
t('date GAP CLOSED: Timestamp with .toDate() → "Jun 7, 2026"', () =>
  assert.strictEqual(
    F.date({ seconds: MIDDAY_2026_06_07, toDate() { return new Date(MIDDAY_2026_06_07 * 1000); } }),
    'Jun 7, 2026'));
t('dateRaw GAP CLOSED: {seconds,nanoseconds} Timestamp → "2026-06-07"', () =>
  assert.strictEqual(F.dateRaw({ seconds: MIDDAY_2026_06_07, nanoseconds: 0 }), '2026-06-07'));

// ── numeric epoch (ms) — faithful to the original Num.date(new Date(number)) ──
t('coerceDate: epoch-ms number → Date (not null)', () =>
  assert.ok(F.coerceDate(MIDDAY_2026_06_07 * 1000) instanceof Date));
t('date: epoch-ms number → formatted (no regression vs Num)', () =>
  assert.strictEqual(F.date(MIDDAY_2026_06_07 * 1000), 'Jun 7, 2026'));

// ── dateShort / dateLong — no-year + long-month variants SHARE date()'s local-
// midnight calendar handling, so a bare 'YYYY-MM-DD' does NOT render a day early in
// behind-UTC zones (TZ is pinned to America/New_York above — exactly where the
// off-by-one bites). The naive `new Date('2026-06-30')`/`+ 'T00:00:00Z'` these
// replace would yield "Jun 6" / "June 29, 2026" here.
t('dateShort: bare calendar "2026-06-07" → "Jun 7" (no year, no off-by-one)', () =>
  assert.strictEqual(F.dateShort('2026-06-07'), 'Jun 7'));
t('dateShort: midnight-UTC calendar string → same calendar day', () =>
  assert.strictEqual(F.dateShort('2026-06-07T00:00:00.000Z'), 'Jun 7'));
t('dateShort: a real Date → "May 1" (no year)', () =>
  assert.strictEqual(F.dateShort(new Date(2026, 4, 1, 13, 0, 0)), 'May 1'));
t('dateShort: {seconds} Timestamp → coerced → "Jun 7"', () =>
  assert.strictEqual(F.dateShort({ seconds: MIDDAY_2026_06_07, nanoseconds: 0 }), 'Jun 7'));
t('dateShort: null/empty/garbage → "" (caller renders an em-dash)', () => {
  assert.strictEqual(F.dateShort(null), '');
  assert.strictEqual(F.dateShort(''), '');
  assert.strictEqual(F.dateShort('xyz'), '');
});
t('dateLong: bare calendar "2026-06-30" → "June 30, 2026" (long month, no off-by-one)', () =>
  assert.strictEqual(F.dateLong('2026-06-30'), 'June 30, 2026'));
t('dateLong: midnight-UTC calendar string → same calendar day', () =>
  assert.strictEqual(F.dateLong('2026-06-30T00:00:00.000Z'), 'June 30, 2026'));
t('dateLong: a real Date → "May 1, 2026"', () =>
  assert.strictEqual(F.dateLong(new Date(2026, 4, 1, 13, 0, 0)), 'May 1, 2026'));
t('dateLong: {seconds} Timestamp → coerced → "June 7, 2026"', () =>
  assert.strictEqual(F.dateLong({ seconds: MIDDAY_2026_06_07, nanoseconds: 0 }), 'June 7, 2026'));
t('dateLong: null/garbage → "" (AR reminder then falls back to "as soon as possible")', () => {
  assert.strictEqual(F.dateLong(null), '');
  assert.strictEqual(F.dateLong('xyz'), '');
});

console.log(`\n${pass} mast-format assertions passed.`);
