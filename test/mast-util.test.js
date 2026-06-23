/**
 * Unit tests for shared/mast-util.js — genId + slugify.
 * Run: node test/mast-util.test.js
 */
'use strict';

const assert = require('assert');
const { genId, slugify } = require('../shared/mast-util.js');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }

console.log('MastUtil (genId / slugify)');

// ── genId ──────────────────────────────────────────────────────────────────
t('genId: includes the verbatim prefix', () =>
  assert.ok(genId('cert_').indexOf('cert_') === 0));
t('genId: no prefix → no leading separator', () =>
  assert.ok(/^[a-z0-9]+_[a-z0-9]+$/.test(genId())));
t('genId: shape is <prefix><ts36>_<rand>', () =>
  assert.ok(/^bat_[a-z0-9]+_[a-z0-9]{1,8}$/.test(genId('bat_'))));
t('genId: 1000 ids are all unique', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(genId('x_'));
  assert.strictEqual(seen.size, 1000);
});
t('genId: null/undefined prefix → empty prefix (no "null"/"undefined")', () => {
  assert.ok(!genId(null).includes('null'));
  assert.ok(!genId(undefined).includes('undefined'));
});

// ── slugify ────────────────────────────────────────────────────────────────
t('slugify: spaces + case → hyphen lowercase', () =>
  assert.strictEqual(slugify('Hello World'), 'hello-world'));
t('slugify: collapses runs of non-alnum to one hyphen', () =>
  assert.strictEqual(slugify('a  --  b!!!c'), 'a-b-c'));
t('slugify: trims leading/trailing hyphens', () =>
  assert.strictEqual(slugify('  !Hello!  '), 'hello'));
t('slugify: drops accented/non-ASCII (matches the idiom it replaces)', () =>
  assert.strictEqual(slugify('Café Olé'), 'caf-ol'));
t('slugify: digits kept', () =>
  assert.strictEqual(slugify('Product 42 v2'), 'product-42-v2'));
t('slugify: null/empty/garbage → ""', () => {
  assert.strictEqual(slugify(null), '');
  assert.strictEqual(slugify(''), '');
  assert.strictEqual(slugify('!!!'), '');
});
// Parity with the exact inline idiom it replaces, across a spread of inputs.
t('slugify: byte-identical to name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")', () => {
  const idiom = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  ['My Gallery', 'A/B Test', '2026 Report!', '  spaced  ', 'CAPS', 'a-b-c'].forEach(s =>
    assert.strictEqual(slugify(s), idiom(s)));
});

// ── clone ──────────────────────────────────────────────────────────────────
const { clone } = require('../shared/mast-util.js');
t('clone: deep copy is equal but not the same reference', () => {
  const src = { a: 1, b: { c: [2, 3] } };
  const out = clone(src);
  assert.deepStrictEqual(out, src);
  assert.notStrictEqual(out, src);
  assert.notStrictEqual(out.b, src.b);
  out.b.c.push(4);
  assert.deepStrictEqual(src.b.c, [2, 3]); // original untouched
});
t('clone: primitives/null pass through (idiom-identical)', () => {
  assert.strictEqual(clone(5), 5);
  assert.strictEqual(clone('x'), 'x');
  assert.strictEqual(clone(null), null);
  assert.strictEqual(clone(true), true);
});
t('clone: undefined → undefined (null-safe; raw idiom would throw)', () =>
  assert.strictEqual(clone(undefined), undefined));
t('clone: byte-identical to JSON.parse(JSON.stringify(x)) for plain data', () => {
  [{ a: 1 }, [1, { b: 2 }], { d: new Date(0).toISOString(), n: null }].forEach(x =>
    assert.deepStrictEqual(clone(x), JSON.parse(JSON.stringify(x))));
});

console.log('\n' + pass + ' MastUtil assertions passed.');
