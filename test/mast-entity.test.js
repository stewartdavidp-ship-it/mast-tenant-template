/** Unit tests for shared/mast-entity.js schema derivations. Run: node test/mast-entity.test.js */
const assert = require('assert');
const E = require('../shared/mast-entity.js');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }
console.log('MastEntity schema engine');

const ORDER = {
  label: 'Order', labelPlural: 'Orders',
  fields: [
    { name: 'number', label: 'Order', type: 'text', list: true, required: true },
    { name: 'customer', label: 'Customer', type: 'text', list: true },
    { name: 'items', label: 'Items', type: 'number', list: true },
    { name: 'total', label: 'Total', type: 'money', list: true },
    { name: 'placedAt', label: 'Placed', type: 'date' },
    { name: 'status', label: 'Status', type: 'status', list: true, tone: v => v === 'refunded' ? 'danger' : 'amber' },
  ]
};
E.define('order', ORDER);

// registration / validation of the SCHEMA (fail-loud)
t('define returns schema + get retrieves it', () => { assert.strictEqual(E.get('order').label, 'Order'); });
t('define throws on empty fields', () => assert.throws(() => E.define('bad', { fields: [] })));
t('define throws on duplicate field', () => assert.throws(() => E.define('bad', { fields: [{ name: 'a', label: 'A' }, { name: 'a', label: 'A2' }] })));
t('define throws on >1 status field', () => assert.throws(() => E.define('bad', { fields: [{ name: 's1', label: 'S1', type: 'status' }, { name: 's2', label: 'S2', type: 'status' }] })));

// list columns derived from list:true, with align inference + sortable default
t('listColumns picks list:true only, infers right-align for numerics', () => {
  const cols = E.listColumns('order');
  assert.deepStrictEqual(cols.map(c => c.key), ['number', 'customer', 'items', 'total', 'status']);
  assert.strictEqual(cols.find(c => c.key === 'total').align, 'right');
  assert.strictEqual(cols.find(c => c.key === 'items').align, 'right');
  assert.strictEqual(cols.find(c => c.key === 'customer').align, 'left');
  assert.strictEqual(cols[0].sortable, true);
});

// canonical export values — the round-trip guarantee (raw, no symbols)
t('canonicalGet money is raw 2dp (no $/commas)', () => assert.strictEqual(E.canonicalGet(ORDER.fields[3], { total: 102000 }), '102000.00'));
t('canonicalGet date is ISO', () => assert.strictEqual(E.canonicalGet(ORDER.fields[4], { placedAt: '2026-05-01T13:00:00Z' }), '2026-05-01'));
t('canonicalGet number is plain', () => assert.strictEqual(E.canonicalGet(ORDER.fields[2], { items: 12 }), '12'));
t('canonicalGet null → empty', () => assert.strictEqual(E.canonicalGet(ORDER.fields[3], {}), ''));

// exportColumns = every field, canonical (round-trips with import template)
t('exportColumns covers all fields with canonical get', () => {
  const cols = E.exportColumns('order');
  assert.strictEqual(cols.length, 6);
  assert.strictEqual(cols[3].get({ total: 7500 }), '7500.00');
});

// record validation
t('validate flags missing required', () => {
  const r = E.validate('order', { customer: 'x' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors[0].includes('Order'));
});
t('validate flags non-numeric money', () => assert.strictEqual(E.validate('order', { number: 'A1', total: 'abc' }).ok, false));
t('validate passes a good record', () => assert.strictEqual(E.validate('order', { number: 'SGTE-1', total: 45 }).ok, true));

console.log('\n' + pass + ' passed');
