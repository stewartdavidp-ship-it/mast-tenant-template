/**
 * Unit tests for the pure helpers in shared/mast-ui.js (MastUI.Num, badge, tabs, list).
 * Run: node test/mast-ui.test.js
 */
const assert = require('assert');
const { Num, badge, tabs, list, esc, pageHeader } = require('../shared/mast-ui.js');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }

console.log('MastUI pure helpers');

// Num — display vs canonical
t('money display adds separators + 2dp', () => assert.strictEqual(Num.money(102000), '$102,000.00'));
t('money cents mode', () => assert.strictEqual(Num.money(2250, { cents: true }), '$22.50'));
t('moneyRaw is symbol/separator-free (export-safe)', () => assert.strictEqual(Num.moneyRaw(102000), '102000.00'));
t('count adds separators', () => assert.strictEqual(Num.count(1234), '1,234'));
t('count handles null', () => assert.strictEqual(Num.count(null), ''));
t('dateRaw is ISO', () => assert.strictEqual(Num.dateRaw('2026-05-01T13:29:00Z'), '2026-05-01'));
t('date display is human', () => assert.strictEqual(Num.date('2026-05-01T12:00:00Z'), 'May 1, 2026'));
t('date handles garbage', () => assert.strictEqual(Num.date('not-a-date'), ''));

// badge — token-based, escaped, sentence-case label preserved
t('badge uses token (no hex)', () => { const h = badge('Placed', 'amber'); assert.ok(h.includes('var(--amber')); assert.ok(!/#[0-9a-f]{6}/i.test(h)); });
t('badge escapes label', () => assert.ok(badge('<x>', 'danger').includes('&lt;x&gt;')));
t('badge unknown tone falls back to neutral', () => assert.ok(badge('X', 'bogus').includes('--warm-gray')));

// tabs — active state + count + handler wiring
t('tabs marks active + wires handler', () => {
  const h = tabs([{ key: 'a', label: 'A' }, { key: 'b', label: 'B', count: 5 }], 'b', 'onSel');
  assert.ok(h.includes('aria-selected="true"'));
  assert.ok(h.includes("onSel('b')"));
  assert.ok(h.includes('5'));
});

// list — empty state, row click, numeric alignment, no sortable (no DOM dep)
t('list renders empty state', () => {
  const h = list({ rows: [], empty: { title: 'No orders', message: 'Clear filters' } });
  assert.ok(h.includes('No orders') && h.includes('Clear filters'));
});
t('list renders rows with row-click + right-align numerics', () => {
  const h = list({
    columns: [{ key: 'name', label: 'Name' }, { key: 'total', label: 'Total', align: 'right', render: r => Num.money(r.total) }],
    rows: [{ id: 'o1', name: 'Acme', total: 102000 }],
    onRowClickFnName: 'openRow'
  });
  assert.ok(h.includes("openRow('o1')"));
  assert.ok(h.includes('$102,000.00'));
  assert.ok(h.includes('tabular-nums'));
});
t('list loading state', () => assert.ok(list({ loading: true }).includes('Loading')));

// moneyVal — canonical dollar amount (the P0 fix): cents wins, dollar fallback,
// genuine zero kept, absent → null (so the UI can render an em-dash not $0.00).
t('moneyVal prefers cents field when present', () => assert.strictEqual(Num.moneyVal({ totalCents: 102000, total: 5 }, 'totalCents', 'total'), 1020));
t('moneyVal falls back to dollar field when no cents (the P0 case)', () => assert.strictEqual(Num.moneyVal({ total: 49.5 }, 'totalCents', 'total'), 49.5));
t('moneyVal genuine zero cents → 0 (not the dollar fallback)', () => assert.strictEqual(Num.moneyVal({ shippingCents: 0, shipping: 9 }, 'shippingCents', 'shipping'), 0));
t('moneyVal absent on both → null (renders em-dash, not $0.00)', () => assert.strictEqual(Num.moneyVal({}, 'totalCents', 'total'), null));

// pageHeader — the shared title/actions strip (doc 17 §13)
t('pageHeader renders the title in an h1', () => assert.ok(pageHeader({ title: 'Policies' }).indexOf('<h1') >= 0 && pageHeader({ title: 'Policies' }).indexOf('Policies') >= 0));
t('pageHeader shows count when given, omits otherwise', () => {
  assert.ok(pageHeader({ title: 'X', count: '3 open' }).indexOf('3 open') >= 0);
  assert.ok(pageHeader({ title: 'X' }).indexOf('span') === -1 || pageHeader({ title: 'X' }).indexOf('margin-left:auto') === -1);
});
t('pageHeader escapes the title', () => assert.ok(pageHeader({ title: '<b>x</b>' }).indexOf('&lt;b&gt;') >= 0));
t('pageHeader places actions right-aligned', () => assert.ok(pageHeader({ title: 'X', actionsHtml: '<button>Go</button>' }).indexOf('margin-left:auto') >= 0));

console.log('\n' + pass + ' passed');
