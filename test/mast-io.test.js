/** Unit tests for shared/mast-io.js pure helpers. Run: node test/mast-io.test.js */
const assert = require('assert');
const { toCsv, filename, cell } = require('../shared/mast-io.js');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }
console.log('MastIO pure helpers');

// CSV-injection guard (the security-relevant one)
t('guards formula-injection cells (= + - @)', () => {
  assert.strictEqual(cell('=SUM(A1)'), "'=SUM(A1)");
  assert.strictEqual(cell('+1'), "'+1");
  assert.strictEqual(cell('-1'), "'-1");
  assert.strictEqual(cell('@x'), "'@x");
});
t('leaves safe cells untouched', () => assert.strictEqual(cell('Acme Co'), 'Acme Co'));

// RFC-4180 quoting
t('quotes commas', () => assert.strictEqual(cell('a,b'), '"a,b"'));
t('quotes + escapes embedded quotes', () => assert.strictEqual(cell('a"b'), '"a""b"'));
t('quotes newlines', () => assert.strictEqual(cell('a\nb'), '"a\nb"'));

// toCsv — header + canonical get()
t('toCsv builds header + rows with get()', () => {
  const csv = toCsv(
    [{ name: 'Acme', total: 102000 }],
    [{ key: 'name', label: 'Name' }, { key: 'total', label: 'Total', get: r => r.total.toFixed(2) }]
  );
  assert.strictEqual(csv, 'Name,Total\r\nAcme,102000.00');
});
t('toCsv empty rows → header only', () => {
  assert.strictEqual(toCsv([], [{ key: 'a', label: 'A' }]), 'A');
});
t('toCsv injection + comma combined in a data cell', () => {
  const csv = toCsv([{ x: '=1,2' }], [{ key: 'x', label: 'X' }]);
  assert.strictEqual(csv, 'X\r\n"\'=1,2"'); // guarded ('=...) then quoted (comma)
});

// filename convention {tenant}-{module}-{view}-{YYYY-MM-DD}.{ext}
t('filename is conventioned + slugged + dated', () => {
  const fn = filename('Retail Orders', 'Active', 'csv', new Date('2026-05-30T00:00:00Z'));
  assert.strictEqual(fn, 'mast-retail-orders-active-2026-05-30.csv'); // tenant falls back to 'mast' in node
});

console.log('\n' + pass + ' passed');
