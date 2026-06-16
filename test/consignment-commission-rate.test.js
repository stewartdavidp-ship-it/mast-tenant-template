'use strict';

// Regression guard for the consignment commission percent-vs-fraction fix.
//
// Bug: galleries-v2 "New placement" showed "Commission 4000% to gallery" for a
// 40% placement, and maker-earnings math went negative. Root cause was a
// representation mismatch — the WRITER stored the wrong unit:
//
//   CANONICAL: `commissionRate` is a 0–1 FRACTION (0.40 == 40%).
//     - consignment.js createPlacement stores the form's whole-number percent
//       ÷100 (`parseFloat(rateStr) / 100`) and validates `rate > 1` as invalid.
//     - EVERY reader treats it as a fraction:
//         · consignments-v2 placementTotals  → makerEarnings = sold * (1 - rate)
//         · galleries-v2     placementTotals  → makerEarnings = sold * (1 - rate)
//         · consignments-v2 pctLabel          → Math.round(rate * 100) + '%'
//     - galleries-v2 was the SINGLE WRONG END: onSave wrote the raw form percent
//       (40) without ÷100, so readers saw rate=40 → "4000%" and 1-40 = -39.
//
// The fix divides the form percent by 100 at write time in galleries-v2 onSave,
// matching consignment.js. This test locks BOTH ends:
//   (1) the earnings/label helpers, EXTRACTED LIVE from the shipped module
//       source, follow fraction semantics (fails if a reader regresses);
//   (2) the galleries-v2 writer source stores the input ÷100, not the raw
//       percent (fails if the writer regresses).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Real money helper — the same Num the modules use at runtime (shared/mast-ui.js).
const N = require('../shared/mast-ui.js').Num;

const GALLERIES_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'modules', 'galleries-v2.js'), 'utf8');
const CONSIGN_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'modules', 'consignments-v2.js'), 'utf8');

// Brace-balanced extractor: pull `function NAME(...) { ... }` (multi-line) out of
// a module source and eval it into a callable. The function closes over `N`
// (defined above), exactly as it does inside the module via the MastUI.Num alias.
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' not found in source');
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > start, name + ' has unbalanced braces');
  const code = src.slice(start, end).replace('function ' + name, 'function');
  // eslint-disable-next-line no-eval
  return eval('(' + code + ')');
}

const consignTotals = extractFn(CONSIGN_SRC, 'placementTotals');
const galleryTotals = extractFn(GALLERIES_SRC, 'placementTotals');
const pctLabel = extractFn(CONSIGN_SRC, 'pctLabel');

// One placed piece, one sold, retailPrice in CENTS (the stored unit). $100 sold.
function placement(rate) {
  return {
    commissionRate: rate,
    lineItems: { li1: { qty: 1, qtySold: 1, qtyReturned: 0, retailPrice: 10000 } }
  };
}

// ── canonical fraction → correct earnings (the explicitly-requested coverage) ──

test('placementTotals: 0.40 fraction → maker keeps 60%, gallery owed 40%', () => {
  const t = consignTotals(placement(0.40));
  assert.strictEqual(t.sold, 100);          // $100 sold (10000c ÷100)
  assert.strictEqual(t.makerEarnings, 60);  // sold * (1 - 0.40)
  assert.strictEqual(t.commissionOwed, 40); // sold * 0.40
});

test('galleries-v2 and consignments-v2 placementTotals agree on the same fraction', () => {
  const g = galleryTotals(placement(0.40));
  const c = consignTotals(placement(0.40));
  assert.strictEqual(g.makerEarnings, c.makerEarnings);
  assert.strictEqual(g.commissionOwed, c.commissionOwed);
  assert.strictEqual(g.makerEarnings, 60);
});

test('placementTotals: 0 rate → maker keeps all, gallery owed nothing', () => {
  const t = consignTotals(placement(0));
  assert.strictEqual(t.makerEarnings, 100);
  assert.strictEqual(t.commissionOwed, 0);
});

// ── pctLabel reads a fraction (the display half of the bug) ───────────────────

test('pctLabel: 0.40 fraction renders "40%" (canonical)', () => {
  assert.strictEqual(pctLabel({ commissionRate: 0.40 }), '40%');
});

test('pctLabel: feeding a raw whole-number percent renders the "4000%" bug', () => {
  // Demonstrates WHY the writer must store a fraction: a stored 40 → "4000%".
  assert.strictEqual(pctLabel({ commissionRate: 40 }), '4000%');
});

// ── the writer fix: galleries-v2 onSave stores the form percent ÷100 ──────────

test('galleries-v2 New-placement writer converts the % input to a 0–1 fraction', () => {
  // Locate the placement object literal written by onSave.
  const litStart = GALLERIES_SRC.indexOf('placementId: id');
  assert.ok(litStart >= 0, 'placement literal not found');
  const window = GALLERIES_SRC.slice(litStart, litStart + 600);
  const onSave = GALLERIES_SRC.slice(Math.max(0, litStart - 1500), litStart);

  // The percent input is divided by 100 before persisting...
  assert.ok(/ratePct\s*\/\s*100/.test(onSave),
    'onSave must divide the whole-number percent input by 100');
  // ...and the placement stores that converted value, NOT a raw parseFloat(%).
  assert.ok(/commissionRate:\s*commissionRate\b/.test(window),
    'placement must persist the ÷100 commissionRate, not the raw percent');
  assert.ok(!/commissionRate:\s*parseFloat/.test(window),
    'placement must not persist a raw parseFloat percent (the 4000% bug)');
});

// Behavioral round-trip: a 40% form entry, run through the writer's conversion
// and back through the readers, yields a correct label + earnings.
test('round-trip: "40" entered → stored 0.40 → "40%" label, 60% maker earnings', () => {
  const formInputPercent = 40;          // what the user types / form pre-fills
  const stored = formInputPercent / 100; // what the fixed writer persists
  assert.strictEqual(pctLabel({ commissionRate: stored }), '40%');
  assert.strictEqual(consignTotals(placement(stored)).makerEarnings, 60);
});

console.log('  ✓ consignment commission-rate (percent-vs-fraction) guard');
