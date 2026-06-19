/**
 * Unit tests for the centralized CSV-export core (shared/mast-export.js, Track 5).
 *
 * Runs with window/Papa UNDEFINED so it exercises the BUILT-IN RFC-4180 serializer
 * (the node-fallback path) rather than PapaParse. Covers: basic rows→CSV with a
 * header, RFC-4180 comma/quote/newline escaping, null/undefined → empty cells,
 * opts.columns ordering + subset, and the CSV formula-injection guard (mirrored
 * from shared/mast-io.js): a cell `=SUM(A1)` must become `'=SUM(A1)`.
 *
 * Hand-rolled assert + t() helper, matching test/format-goldens.test.js.
 *
 * Run: node test/mast-export.test.js
 */
'use strict';

const assert = require('assert');
const MastExport = require('../shared/mast-export.js');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }

console.log('CSV export core (MastExport — built-in serializer path)');

const { toCsv, download } = MastExport;

// ── basic rows → CSV with a header (keys → header row, order preserved) ──
t('basic: rows → header + value rows (\\r\\n line endings)', () =>
  assert.strictEqual(
    toCsv([{ name: 'Ada', qty: 2 }, { name: 'Boris', qty: 5 }]),
    'name,qty\r\nAda,2\r\nBoris,5'));

t('empty rows → just nothing (no header derivable)', () =>
  assert.strictEqual(toCsv([]), ''));

// ── RFC-4180 escaping: comma / quote / newline ──
t('escape: comma in a cell → field is double-quoted', () =>
  assert.strictEqual(
    toCsv([{ a: 'x,y', b: 'z' }]),
    'a,b\r\n"x,y",z'));

t('escape: embedded double-quote → doubled, field quoted', () =>
  assert.strictEqual(
    toCsv([{ a: 'say "hi"' }]),
    'a\r\n"say ""hi"""'));

t('escape: newline in a cell → field is double-quoted', () =>
  assert.strictEqual(
    toCsv([{ a: 'line1\nline2' }]),
    'a\r\n"line1\nline2"'));

t('escape: header label with a comma → header field quoted too', () =>
  assert.strictEqual(
    toCsv([{ 'a,b': 1 }]),
    '"a,b"\r\n1'));

// ── null / undefined cells → empty string ──
t('null / undefined cells → empty (not "null"/"undefined")', () =>
  assert.strictEqual(
    toCsv([{ a: null, b: undefined, c: 0 }]),
    'a,b,c\r\n,,0'));

t('missing key for a column → empty cell', () =>
  assert.strictEqual(
    toCsv([{ a: 1 }], { columns: ['a', 'b'] }),
    'a,b\r\n1,'));

// ── opts.columns: ordering + subset ──
t('opts.columns: reorders columns', () =>
  assert.strictEqual(
    toCsv([{ a: 1, b: 2, c: 3 }], { columns: ['c', 'a', 'b'] }),
    'c,a,b\r\n3,1,2'));

t('opts.columns: subset (drops un-listed keys)', () =>
  assert.strictEqual(
    toCsv([{ a: 1, b: 2, c: 3 }], { columns: ['a', 'c'] }),
    'a,c\r\n1,3'));

t('{columns,data} packaged shape is accepted', () =>
  assert.strictEqual(
    toCsv({ columns: ['b', 'a'], data: [{ a: 1, b: 2 }] }),
    'b,a\r\n2,1'));

// ── CSV formula-injection guard (mirrors shared/mast-io.js) ──
t('injection: =SUM(A1) → \'=SUM(A1) (leading apostrophe)', () =>
  assert.strictEqual(
    toCsv([{ f: '=SUM(A1)' }]),
    'f\r\n\'=SUM(A1)'));

t('injection: +,-,@ leading chars all get the apostrophe', () => {
  assert.strictEqual(toCsv([{ f: '+1' }]), 'f\r\n\'+1');
  assert.strictEqual(toCsv([{ f: '-1' }]), 'f\r\n\'-1');
  assert.strictEqual(toCsv([{ f: '@cmd' }]), 'f\r\n\'@cmd');
});

t('injection: tab / CR leading chars get the apostrophe', () => {
  // tab carries no RFC-4180 quote-trigger char → stays bare after the apostrophe.
  assert.strictEqual(toCsv([{ f: '\tx' }]), 'f\r\n\'\tx');
  // CR IS a quote-trigger char → after the apostrophe the field is also quoted.
  assert.strictEqual(toCsv([{ f: '\rx' }]), 'f\r\n"\'\rx"');
});

t('injection: a benign cell is NOT prefixed', () =>
  assert.strictEqual(toCsv([{ f: 'hello' }]), 'f\r\nhello'));

t('injection: guard + quoting compose (=A,B → quoted, apostrophed)', () =>
  // leading '=' → apostrophe first ("'=A,B"), then the comma forces quoting.
  assert.strictEqual(toCsv([{ f: '=A,B' }]), 'f\r\n"\'=A,B"'));

// ── download() in node (no document) → graceful no-op returning the CSV ──
t('download() in node → no throw, returns the CSV string', () => {
  assert.strictEqual(typeof document, 'undefined');
  assert.strictEqual(
    download('x.csv', [{ a: 1 }]),
    'a\r\n1');
});

console.log(`\n${pass} CSV export assertions passed.`);
