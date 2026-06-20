/**
 * Unit tests for the pure helpers in shared/mast-ui.js (MastUI.Num, badge, tabs, list).
 * Run: node test/mast-ui.test.js
 */
const assert = require('assert');
const { Num, badge, tabs, list, esc, pageHeader, card, launchCard, cardGrid, sanitizeHtml, _safeUrl } = require('../shared/mast-ui.js');

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

// list — opt-in selectable rows (bulk actions)
t('list without selectable has no checkboxes', () => {
  const h = list({ columns: [{ key: 'n', label: 'N' }], rows: [{ id: 'a', n: 1 }] });
  assert.ok(!h.includes('mast-row-select') && !h.includes('mast-select-all'));
});
t('list selectable renders row checkbox + select-all, wires handlers, stops propagation', () => {
  const h = list({
    columns: [{ key: 'n', label: 'N' }],
    rows: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }],
    selectable: true, selectedIds: { a: true },
    onSelectFnName: 'P.sel', onSelectAllFnName: 'P.selAll',
    onRowClickFnName: 'P.open'
  });
  assert.ok(h.includes('mast-select-all'));
  assert.ok(h.includes("P.selAll(this.checked)"));
  assert.ok(h.includes("P.sel('a', this.checked)") && h.includes("P.sel('b', this.checked)"));
  assert.ok(h.includes('event.stopPropagation()'));
  // a is checked, b is not; not all rows selected so select-all unchecked
  assert.strictEqual((h.match(/mast-row-select" aria-label="Select row" checked/g) || []).length, 1);
  assert.ok(!/mast-select-all" aria-label="Select all" checked/.test(h));
});
t('list selectable select-all checked when every row selected', () => {
  const h = list({
    columns: [{ key: 'n', label: 'N' }],
    rows: [{ id: 'a', n: 1 }],
    selectable: true, selectedIds: { a: true },
    onSelectFnName: 'P.sel', onSelectAllFnName: 'P.selAll'
  });
  assert.ok(/mast-select-all" aria-label="Select all" checked/.test(h));
});

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

// card / launchCard / cardGrid — the producer-surface + grid-card primitives (doc 17 §13/§14b)
t('card renders mu-card with title + body', () => { const h = card('Logo', 'x'); assert.ok(h.indexOf('class="mu-card"') >= 0 && h.indexOf('Logo') >= 0 && h.indexOf('>x<') >= 0); });
t('card fill adds mu-card-fill', () => assert.ok(card('T', 'x', { fill: true }).indexOf('mu-card-fill') >= 0));
t('card headerRight renders a flex header with the right HTML', () => { const h = card('T', 'x', { headerRight: '<b>ON</b>' }); assert.ok(h.indexOf('mu-cardhead') >= 0 && h.indexOf('<b>ON</b>') >= 0); });
t('card escapes the title', () => assert.ok(card('<i>x</i>', '').indexOf('&lt;i&gt;') >= 0));
t('launchCard is a clickable fill-card with onClick(arg) + arrow', () => {
  const h = launchCard({ title: 'Gift Cards', body: 'b', onClickFnName: 'WalletV2.edit', arg: 'gc', arrow: 'Edit →' });
  assert.ok(h.indexOf('class="mu-launch"') >= 0 && h.indexOf("WalletV2.edit('gc')") >= 0 && h.indexOf('mu-card-fill') >= 0 && h.indexOf('Edit →') >= 0);
});
t('cardGrid wraps items (array or string) in mu-cardgrid', () => {
  assert.ok(cardGrid(['<a>', '<b>']).indexOf('class="mu-cardgrid"') >= 0 && cardGrid(['<a>', '<b>']).indexOf('<a><b>') >= 0);
  assert.ok(cardGrid('<c>').indexOf('<c>') >= 0);
});

console.log('\n' + pass + ' passed');

// repeatRows — engine-owned repeatable rows (operator-ratified engine-first)
const { repeatRows, validate } = require('../shared/mast-ui.js');
t('repeatRows renders rows + spare + Add button wired to engine handler', () => {
  const h = repeatRows({ id: 'rrTest', rows: [{ v: 'a' }], spares: 1, addLabel: '+ Add row',
    template: (item, i) => '<div data-rr-row="' + i + '">' + (item.v || '') + '</div>' });
  assert.ok(h.includes('id="rrTest"'));
  assert.ok(h.includes('data-rr-row="0"') && h.includes('data-rr-row="1"'), 'row + spare');
  assert.ok(h.includes("MastUI.repeatRowsAdd('rrTest')"));
  assert.ok(h.includes('+ Add row'));
});
t('repeatRows escapes container id', () => {
  const h = repeatRows({ id: '<x>', rows: [], template: () => '' });
  assert.ok(!h.includes('id="<x>"'));
});

// validate — shared format checks (empty passes; presence is the form's call)
t('validate.email accepts normal + empty, rejects malformed', () => {
  assert.ok(validate.email('jane@gallery.com'));
  assert.ok(validate.email(''));
  assert.ok(validate.email(null));
  assert.ok(!validate.email('jane@gallery'));
  assert.ok(!validate.email('not-an-email'));
  assert.ok(!validate.email('a b@c.com'));
});
t('validate.phone accepts common formats + empty, rejects junk', () => {
  assert.ok(validate.phone('(512) 555-0199'));
  assert.ok(validate.phone('+1 512.555.0199'));
  assert.ok(validate.phone(''));
  assert.ok(!validate.phone('555-12'));        // too short
  assert.ok(!validate.phone('call me maybe')); // letters
  assert.ok(!validate.phone('12345678901234567890')); // too long
});

// sanitizeHtml — _safeUrl URL-scheme policy (pure, runs in node)
t('_safeUrl allows http/https/mailto/tel + relative, strips unsafe schemes', () => {
  assert.strictEqual(_safeUrl('https://x.com/a'), 'https://x.com/a');
  assert.strictEqual(_safeUrl('http://x.com'), 'http://x.com');
  assert.strictEqual(_safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.strictEqual(_safeUrl('tel:+15125550199'), 'tel:+15125550199');
  assert.strictEqual(_safeUrl('/relative/path'), '/relative/path');
  assert.strictEqual(_safeUrl('#anchor'), '#anchor');
  assert.strictEqual(_safeUrl('?q=1'), '?q=1');
  assert.strictEqual(_safeUrl('//cdn.example.com/x.png'), '//cdn.example.com/x.png'); // protocol-relative
  assert.strictEqual(_safeUrl(''), '');
  assert.strictEqual(_safeUrl(null), '');
  // unsafe schemes → dropped to ''
  assert.strictEqual(_safeUrl('javascript:alert(1)'), '');
  assert.strictEqual(_safeUrl('JavaScript:alert(1)'), '');       // case-insensitive
  assert.strictEqual(_safeUrl('  javascript:alert(1)'), '');     // leading whitespace
  assert.strictEqual(_safeUrl('java\tscript:alert(1)'), '');     // embedded control char
  assert.strictEqual(_safeUrl('data:text/html,<script>1</script>'), '');
  assert.strictEqual(_safeUrl('vbscript:msgbox(1)'), '');
  assert.strictEqual(_safeUrl('file:///etc/passwd'), '');
});
// sanitizeHtml node fallback — without a DOM it MUST escape everything (never
// emit raw markup); the allow-list DOM walk is live-verified in the browser.
t('sanitizeHtml escapes (never emits raw markup) in a non-DOM context', () => {
  assert.strictEqual(sanitizeHtml(''), '');
  assert.strictEqual(sanitizeHtml(null), '');
  const a = sanitizeHtml('<b>hi</b>');
  assert.ok(!/<b>/.test(a) && /&lt;b&gt;/.test(a));
  const x = sanitizeHtml('<script>alert(1)</script>');
  assert.ok(!/<script>/.test(x) && /&lt;script&gt;/.test(x)); // tag escaped → inert
  const y = sanitizeHtml('<img src=x onerror=alert(1)>');
  assert.ok(!/<img/.test(y) && /&lt;img/.test(y));            // no live tag; escaped text is harmless
});

// ── statusBadge — flat per-domain registry (Track 5; master plan §7 + §12.3) ──
// Goldens for the canonical status pill. Colors + labels are captured VERBATIM
// from the source maps (order/invoice = orders-core.js, rma = rma-admin.js,
// ticket = customer-service.js, product/material = maker.js). These pin the
// build so later per-module adoption is a checkable swap, not a guess.
const { statusBadge, emptyState } = require('../shared/mast-ui.js');
t('statusBadge order: captured color + de-underscored label, soft-tint pill', () => {
  const h = statusBadge('packed', 'order');
  assert.ok(h.includes('class="mast-badge"'));                 // canonical pill markup (same as badge())
  assert.ok(h.includes('#66BB6A'));                            // ORDER_STATUS_BADGE_COLORS.packed.color
  assert.ok(h.includes('>packed</span>'));
  assert.ok(h.includes('color-mix(in srgb,#66BB6A 16%,transparent)')); // bg derived from the one color
});
t('statusBadge order de-underscores the label (replace(/_/g," "))', () => {
  const h = statusBadge('pending_payment', 'order');
  assert.ok(h.includes('#FFB74D') && h.includes('>pending payment</span>'));
});
t('statusBadge invoice: Title-Case label + captured color', () => {
  const h = statusBadge('paid', 'invoice');
  assert.ok(h.includes('#4ade80') && h.includes('>Paid</span>'));
});
t('statusBadge rma de-hyphenates the label (replace(/-/g," "))', () => {
  const h = statusBadge('shipped-back', 'rma');
  assert.ok(h.includes('#CE93D8') && h.includes('>shipped back</span>'));
});
t('statusBadge ticket: STATUS_LABELS label + captured color', () => {
  const h = statusBadge('in_progress', 'ticket');
  assert.ok(h.includes('#FFD54F') && h.includes('>In Progress</span>'));
});
t('statusBadge product label can diverge from status (ready → "Review")', () => {
  const h = statusBadge('ready', 'product');
  assert.ok(h.includes('#b45309') && h.includes('>Review</span>'));
});
t('statusBadge material uses a token color where the source did (var(--amber))', () => {
  const h = statusBadge('draft', 'material');
  assert.ok(h.includes('var(--amber)') && h.includes('>draft</span>'));
});
// per-domain registry: the SAME status word resolves differently by domain
// ("open" is a real ticket status; it is NOT an order status → neutral). This is
// the whole reason the registry is per-domain, not one global map (§12.3).
t('statusBadge is per-domain — "open" is a ticket status but not an order status', () => {
  assert.ok(statusBadge('open', 'ticket').includes('#64B5F6'));        // ticket.open
  const order = statusBadge('open', 'order');
  assert.ok(order.includes('var(--warm-gray)') && !order.includes('#64B5F6')); // unknown in order → neutral
});
t('statusBadge unknown domain → neutral, humanized label', () => {
  const h = statusBadge('whatever_now', 'no-such-domain');
  assert.ok(h.includes('var(--warm-gray)') && h.includes('>whatever now</span>'));
});
t('statusBadge unknown status → neutral, humanizes underscores AND hyphens', () => {
  const h = statusBadge('a_b-c', 'order');
  assert.ok(h.includes('var(--warm-gray)') && h.includes('>a b c</span>'));
});
t('statusBadge empty/null/undefined status → em-dash neutral, never throws', () => {
  assert.ok(statusBadge('', 'order').includes('>—</span>'));
  assert.ok(statusBadge(null, 'order').includes('>—</span>'));
  assert.doesNotThrow(() => statusBadge(undefined, undefined));
  assert.ok(statusBadge(undefined, undefined).includes('class="mast-badge"'));
});
t('statusBadge escapes the fallback label (XSS-safe)', () => {
  const h = statusBadge('<img src=x>', 'bogus');
  assert.ok(!h.includes('<img src=x>') && h.includes('&lt;img src=x&gt;'));
});

// ── emptyState — one canonical "no X yet" (replaces ~60 hand-rolled) ──────────
// Reuses the existing .empty-state / .empty-icon / .empty-title CSS in index.html.
t('emptyState renders icon + title + hint with the canonical classes', () => {
  const h = emptyState({ icon: '📦', title: 'No orders yet', hint: 'They show up here once placed.' });
  assert.ok(h.includes('class="empty-state"'));
  assert.ok(h.includes('class="empty-icon">📦</div>'));
  assert.ok(h.includes('class="empty-title">No orders yet</div>'));
  assert.ok(h.includes('<p>They show up here once placed.</p>'));
});
t('emptyState omits icon + hint when not given (title only)', () => {
  const h = emptyState({ title: 'Nothing here' });
  assert.ok(h.includes('class="empty-title">Nothing here</div>'));
  assert.ok(!h.includes('empty-icon') && !h.includes('<p>'));
});
t('emptyState with no opts is the bare wrapper (never throws)', () => {
  assert.strictEqual(emptyState(), '<div class="empty-state"></div>');
  assert.strictEqual(emptyState({}), '<div class="empty-state"></div>');
});
t('emptyState escapes icon, title AND hint (XSS-safe)', () => {
  const h = emptyState({ icon: '<x>', title: '<b>t</b>', hint: '<i>h</i>' });
  assert.ok(h.includes('&lt;x&gt;') && h.includes('&lt;b&gt;t&lt;/b&gt;') && h.includes('&lt;i&gt;h&lt;/i&gt;'));
  assert.ok(!h.includes('<b>t</b>') && !h.includes('<i>h</i>'));
});

console.log('\n' + pass + ' passed (incl. statusBadge + emptyState)');
