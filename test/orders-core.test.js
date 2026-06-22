'use strict';

/**
 * Unit-test suite for shared/orders-core.js — the eager order display/format +
 * cache/lifecycle + OrdersBridge write-core engine (money-adjacent, previously
 * untested). Engine-hardening pins: meaningful logic, edge cases, and the known
 * money/Timestamp gotchas this codebase has been bitten by.
 *
 * Run: node test/orders-core.test.js
 *
 * Harness: orders-core.js is an IIFE exposing window.OrdersCore + back-compat
 * window.<name> aliases. We mirror test/mastdb-fieldpath.test.js: load the REAL
 * module into a vm sandbox whose global object carries the bare shell globals the
 * functions reference at call time (orders, inventory, MastDB, firebase, …) plus
 * the real shared/mast-ui.js as window.MastUI, then exercise the genuine exports.
 *
 * The status-badge fidelity block tests the REAL shared/mast-ui.js _statusRegistry
 * (order/invoice) — the registry orders-core's former ORDER_STATUS_BADGE_COLORS /
 * invoiceStatusBadgeStyle maps were captured into, and the one orders-core renders
 * its order + invoice badges through today (renderDashCard* / buildInvoiceSection
 * call window.MastUI.statusBadge(status, 'order'|'invoice')). A drift in those hues
 * or labels silently desyncs every badge orders-core paints, so we pin them here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');

// Real MastUI. Required headless (no `window` in this realm) so its module body
// skips injectStyles()/wireDelegates() and just hands back the pure exports.
const MastUI = require('../shared/mast-ui.js');

const ORDERS_CORE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'shared', 'orders-core.js'),
  'utf8'
);

// The REAL transition map (defined in app/index.html as a shell global). Extracted
// so transitionOrder is exercised against the shipped transitions, not a copy.
function loadOrderValidTransitions() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const m = src.match(/var ORDER_VALID_TRANSITIONS = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'ORDER_VALID_TRANSITIONS not found in app/index.html');
  // eslint-disable-next-line no-eval
  return eval('(' + m[1] + ')');
}
const ORDER_VALID_TRANSITIONS = loadOrderValidTransitions();

// ── Stubs ────────────────────────────────────────────────────────────────────
// A spying MastDB: records every write/read into rec.db; reads/transactions are
// configurable. Stateful transaction (rec.txnDocs) so the bulk-cancel ticket-race
// fix can be exercised across two sequential cancels.
function makeMastDB(rec) {
  function ref(prefix) {
    return {
      update: function (id, data) { rec.db.push({ op: prefix + '.update', id: id, data: data }); return Promise.resolve(); },
      set: function (id, data) { rec.db.push({ op: prefix + '.set', id: id, data: data }); return Promise.resolve(); },
      get: function (id) { rec.db.push({ op: prefix + '.get', id: id }); return Promise.resolve(rec.refGet ? rec.refGet(id) : null); },
      newKey: function () { return rec.newKey || 'req_fixed'; },
      subRef: function () {
        var segs = Array.prototype.slice.call(arguments);
        return { set: function (value) { rec.db.push({ op: prefix + '.subRef.set', segs: segs, value: value }); return Promise.resolve(); } };
      }
    };
  }
  return {
    tenantId: function () { return 't1'; },
    serverIncrement: function (n) { return { __inc: n }; },
    orders: ref('orders'),
    productionRequests: ref('pr'),
    businessEntity: { get: function (k) { rec.db.push({ op: 'biz.get', id: k }); return Promise.resolve(rec.bizEntity || { data: null }); } },
    multiUpdate: function (u) { rec.db.push({ op: 'multiUpdate', updates: u }); return Promise.resolve(); },
    push: function (p, d) { rec.db.push({ op: 'push', path: p, data: d }); return Promise.resolve(); },
    get: function (p) { rec.db.push({ op: 'get', path: p }); return Promise.resolve(rec.dbGet ? rec.dbGet(p) : null); },
    set: function (p, d) { rec.db.push({ op: 'set', path: p, data: d }); return Promise.resolve(); },
    update: function (p, d) { rec.db.push({ op: 'update', path: p, data: d }); return Promise.resolve(); },
    transaction: function (p, fn) {
      rec.db.push({ op: 'transaction', path: p });
      rec.txnDocs = rec.txnDocs || {};
      var next = fn(rec.txnDocs[p]);
      rec.txnDocs[p] = next;
      return Promise.resolve({ value: next });
    }
  };
}

// firebase.functions().httpsCallable(name)(payload) — records every CF invocation
// so we can assert WHICH cloud function fired with WHAT args (money-safety).
function makeFirebase(rec) {
  return {
    functions: function () {
      return {
        httpsCallable: function (name) {
          return function (payload) {
            rec.cf.push({ name: name, payload: payload });
            return Promise.resolve({ data: { success: true } });
          };
        }
      };
    }
  };
}

// Build a fresh module instance (isolates module-private _tenantTz between tests).
function makeCtx(opts) {
  opts = opts || {};
  const rec = { db: [], cf: [], audit: [], toasts: [], testing: [], mastflow: [] };
  rec.bizEntity = opts.bizEntity || null; // businessEntity.get() payload (tz source)
  const MastDB = opts.MastDB || makeMastDB(rec);
  const firebase = makeFirebase(rec);
  const mastFlow = ('mastFlow' in opts) ? opts.mastFlow : null;

  const sandbox = {
    console: console,
    setTimeout: function () { /* viewOrder poll — not exercised */ },
    module: { exports: {} },
    // Bare shell globals referenced inside the functions at call time:
    orders: opts.orders || {},
    inventory: opts.inventory || {},
    productionRequests: opts.productionRequests || {},
    getItemComboKey: opts.getItemComboKey || function () { return '_default'; },
    ORDER_VALID_TRANSITIONS: ORDER_VALID_TRANSITIONS,
    MastDB: MastDB,
    firebase: firebase,
    writeAudit: function () { rec.audit.push(Array.prototype.slice.call(arguments)); return Promise.resolve(); },
    emitTestingEvent: function (name, data) { rec.testing.push({ name: name, data: data }); },
    showToast: function (msg, isErr) { rec.toasts.push({ msg: msg, isErr: !!isErr }); },
    navigateTo: function () {},
    esc: MastUI.esc,
    ordersLoaded: ('ordersLoaded' in opts) ? opts.ordersLoaded : true
  };
  sandbox.window = {
    MastUI: ('noMastUI' in opts && opts.noMastUI) ? undefined : MastUI,
    MastDB: MastDB,
    MastFlow: mastFlow
  };
  if (mastFlow) sandbox.MastFlow = mastFlow;

  vm.createContext(sandbox);
  vm.runInContext(ORDERS_CORE_SRC, sandbox);
  return { OrdersCore: sandbox.window.OrdersCore, rec: rec, sandbox: sandbox, MastDB: MastDB };
}

// helpers to slice the recorder
const ops = (rec, op) => rec.db.filter((w) => w.op === op);
const cf = (rec, name) => rec.cf.find((c) => c.name === name);

// ════════════════════════════════════════════════════════════════════════════
// 1. STATUS-BADGE STYLE FIDELITY  (registry orders-core renders through)
// ════════════════════════════════════════════════════════════════════════════
// Pin the TEXT color (hue carrier) + label for every order + invoice status. The
// hex literals live in shared/mast-ui.js _statusRegistry; orders-core.js's header
// comment is explicit that they were "captured VERBATIM from the former
// ORDER_STATUS_BADGE_COLORS / invoiceStatusBadgeStyle map". If anyone edits a hue
// or label, the corresponding assertion fails — flagging a registry drift that
// would desync every order/invoice badge orders-core paints.

const ORDER_BADGE_EXPECT = {
  pending_payment:    { color: '#FFB74D', label: 'pending payment' },
  payment_failed:     { color: '#EF5350', label: 'payment failed' },
  placed:             { color: '#FFB74D', label: 'placed' },
  confirmed:          { color: '#64B5F6', label: 'confirmed' },
  building:           { color: '#CE93D8', label: 'building' },
  ready:              { color: '#4DB6AC', label: 'ready' },
  pack:               { color: '#4DB6AC', label: 'pack' },
  packing:            { color: '#FFD54F', label: 'packing' },
  packed:             { color: '#66BB6A', label: 'packed' },
  handed_to_carrier:  { color: '#B39DDB', label: 'handed to carrier' },
  shipped:            { color: '#7986CB', label: 'shipped' },
  delivered:          { color: '#66BB6A', label: 'delivered' },
  cancelled:          { color: '#EF5350', label: 'cancelled' },
  return_requested:   { color: '#FFB74D', label: 'return requested' },
  return_approved:    { color: '#FFB74D', label: 'return approved' },
  return_shipped:     { color: '#B39DDB', label: 'return shipped' },
  return_received:    { color: '#64B5F6', label: 'return received' },
  partially_returned: { color: '#FFB74D', label: 'partially returned' },
  refunded:           { color: '#EF5350', label: 'refunded' }
};
const INVOICE_BADGE_EXPECT = {
  draft:   { color: '#9ca3af', label: 'Draft' },
  sent:    { color: '#60a5fa', label: 'Sent' },
  paid:    { color: '#4ade80', label: 'Paid' },
  overdue: { color: '#f87171', label: 'Overdue' }
};

Object.keys(ORDER_BADGE_EXPECT).forEach(function (status) {
  const e = ORDER_BADGE_EXPECT[status];
  test('order badge fidelity: ' + status + ' → ' + e.color + ' / "' + e.label + '"', () => {
    const html = MastUI.statusBadge(status, 'order');
    assert.ok(html.includes(e.color), status + ' must carry hue ' + e.color + '; got ' + html);
    assert.ok(html.includes('>' + e.label + '</span>'), status + ' label must render as "' + e.label + '"; got ' + html);
  });
});

test('order badge registry has exactly the 19 captured statuses (no silent add/remove)', () => {
  // The explicit per-status tests above are the per-entry guard; this pins the
  // cardinality so a wholesale registry edit can't slip an extra status past us.
  assert.strictEqual(Object.keys(ORDER_BADGE_EXPECT).length, 19);
});

Object.keys(INVOICE_BADGE_EXPECT).forEach(function (status) {
  const e = INVOICE_BADGE_EXPECT[status];
  test('invoice badge fidelity: ' + status + ' → ' + e.color + ' / "' + e.label + '"', () => {
    const html = MastUI.statusBadge(status, 'invoice');
    assert.ok(html.includes(e.color), status + ' must carry hue ' + e.color);
    assert.ok(html.includes('>' + e.label + '</span>'), status + ' label must render as "' + e.label + '"');
  });
});

test('unknown order status → neutral fallback badge, NOT a throw', () => {
  let html;
  assert.doesNotThrow(() => { html = MastUI.statusBadge('warp_drive_engaged', 'order'); });
  assert.ok(html.includes('var(--warm-gray)'), 'unknown status must use the neutral token');
  assert.ok(html.includes('warp drive engaged'), 'unknown status is humanized (underscores → spaces), still readable');
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(html), 'neutral fallback must not borrow a real status hue');
});

test('unknown invoice status + empty/null status → neutral, em-dash for empty, no throw', () => {
  assert.doesNotThrow(() => MastUI.statusBadge('bogus', 'invoice'));
  assert.ok(MastUI.statusBadge('', 'order').includes('—'), 'empty status → em-dash');
  assert.ok(MastUI.statusBadge(null, 'order').includes('—'), 'null status → em-dash');
  assert.ok(MastUI.statusBadge('placed', 'no_such_domain').includes('var(--warm-gray)'), 'unknown DOMAIN → neutral, not a throw');
});

test('etsySourceBadgeStyle is the pinned Etsy-orange source pill', () => {
  const { OrdersCore } = makeCtx();
  assert.strictEqual(OrdersCore.etsySourceBadgeStyle(), 'background:#F1641E;color:white;');
});

// ════════════════════════════════════════════════════════════════════════════
// 2. MONEY — order.total (DOLLARS) vs order.totalCents (CENTS); the load-bearing
//    gotcha. orderTotalDollars MUST read the grand total via the centralized
//    MastUI.Num.moneyVal(o,'totalCents','total'), never raw o.total.
// ════════════════════════════════════════════════════════════════════════════

test('orderTotalDollars: totalCents wins over total (cents → dollars)', () => {
  const { OrdersCore } = makeCtx();
  // total:5 (a stray dollar value) must be ignored in favor of totalCents.
  assert.strictEqual(OrdersCore.orderTotalDollars({ totalCents: 102000, total: 5 }), 1020);
});

test('orderTotalDollars: dollar-only order falls back to total (the common storefront shape)', () => {
  const { OrdersCore } = makeCtx();
  assert.strictEqual(OrdersCore.orderTotalDollars({ total: 49.5 }), 49.5);
});

test('orderTotalDollars: SGTE-0187 bad-seed (total AND totalCents both = 102000) reads $1,020, NOT $102,000', () => {
  const { OrdersCore } = makeCtx();
  // The exact record that drove the ~27x finance inflation. totalCents winning is
  // what makes the cents-in-`total` corruption harmless on every reader.
  assert.strictEqual(OrdersCore.orderTotalDollars({ total: 102000, totalCents: 102000 }), 1020);
});

test('orderTotalDollars: genuine totalCents:0 → $0 (not a fall-through to total)', () => {
  const { OrdersCore } = makeCtx();
  assert.strictEqual(OrdersCore.orderTotalDollars({ totalCents: 0, total: 50 }), 0);
});

test('orderTotalDollars: null/empty order → 0 (guard), {} → 0', () => {
  const { OrdersCore } = makeCtx();
  assert.strictEqual(OrdersCore.orderTotalDollars(null), 0);
  assert.strictEqual(OrdersCore.orderTotalDollars(undefined), 0);
  assert.strictEqual(OrdersCore.orderTotalDollars({}), 0);
});

test('orderTotalDollars: KNOWN BOUNDARY — cents-in-total with NO totalCents reads 100x high', () => {
  const { OrdersCore } = makeCtx();
  // moneyVal cannot disambiguate a cents value sitting in the dollar field when no
  // totalCents is present, so it returns 102000 ($102,000). This is not a bug to
  // "fix" by guessing — correctness relies on writers stamping totalCents (they
  // now do; SGTE-0187/0188 carry both). Pinned so a change to that contract is
  // surfaced rather than silent.
  assert.strictEqual(OrdersCore.orderTotalDollars({ total: 102000 }), 102000);
});

test('orderTotalDollars: degraded fallback when MastUI is absent → raw o.total (defensive path)', () => {
  const { OrdersCore } = makeCtx({ noMastUI: true });
  // Eager-load order makes this defensive in production; pinned so the fallback
  // branch (o.total || 0) keeps behaving when window.MastUI hasn't resolved.
  assert.strictEqual(OrdersCore.orderTotalDollars({ total: 49.5 }), 49.5);
  // A cents-native order (no dollar total) degrades to 0 without MastUI — the
  // reason MastUI is eager: only the canonical accessor sees totalCents.
  assert.strictEqual(OrdersCore.orderTotalDollars({ totalCents: 102000 }), 0);
});

// ════════════════════════════════════════════════════════════════════════════
// 3. DISPLAY / DATE HELPERS — timezone-aware, Timestamp-safe coercion.
// ════════════════════════════════════════════════════════════════════════════

test('formatOrderDate / formatOrderDateTime format in the tenant tz (UTC) deterministically', async () => {
  const { OrdersCore } = makeCtx({ bizEntity: { data: { localization: { timezone: 'UTC' } } } });
  await OrdersCore.ensureTenantTz(); // resolves + caches _tenantTz = 'UTC'
  assert.strictEqual(OrdersCore.formatOrderDate('2026-05-01T13:29:00Z'), 'May 1, 2026');
  assert.strictEqual(OrdersCore.formatOrderDateTime('2026-05-01T13:29:00Z'), 'May 1, 1:29 PM');
  // Midnight UTC → 12:00 AM (12-hour wrap), and a Dec date for month-table coverage.
  assert.strictEqual(OrdersCore.formatOrderDateTime('2026-12-31T00:00:00Z'), 'Dec 31, 12:00 AM');
});

test('ensureTenantTz tolerates a businessEntity with no localization (→ empty tz, no throw)', async () => {
  const { OrdersCore } = makeCtx({ bizEntity: { data: {} } });
  const tz = await OrdersCore.ensureTenantTz();
  assert.strictEqual(tz, '');
});

test('date helpers: missing input → empty string', () => {
  const { OrdersCore } = makeCtx();
  assert.strictEqual(OrdersCore.formatOrderDate(''), '');
  assert.strictEqual(OrdersCore.formatOrderDate(null), '');
  assert.strictEqual(OrdersCore.formatOrderDate(undefined), '');
  assert.strictEqual(OrdersCore.formatOrderDateTime(''), '');
});

test('date helpers: unparseable string is returned as-is (graceful, not "Invalid Date")', () => {
  const { OrdersCore } = makeCtx();
  assert.strictEqual(OrdersCore.formatOrderDate('not-a-date'), 'not-a-date');
  assert.strictEqual(OrdersCore.formatOrderDateTime('garbage'), 'garbage');
});

test('date helpers are Timestamp-SAFE: a Firestore Timestamp object never throws', () => {
  const { OrdersCore } = makeCtx();
  // .substring/.localeCompare on a Timestamp throws (the known crash class); the
  // formatters route through `new Date()` → Invalid Date → graceful return, so
  // they do NOT participate in that class. Pin the no-throw property.
  assert.doesNotThrow(() => OrdersCore.formatOrderDate({ seconds: 1717200000, nanoseconds: 0 }));
  assert.doesNotThrow(() => OrdersCore.formatOrderDateTime({ _seconds: 1717200000 }));
});

test('tzPartsFromIso returns null on empty / unparseable (the helper the formatters branch on)', () => {
  const { OrdersCore } = makeCtx();
  assert.strictEqual(OrdersCore.tzPartsFromIso(''), null);
  assert.strictEqual(OrdersCore.tzPartsFromIso('xyz'), null);
  const p = OrdersCore.tzPartsFromIso('2026-05-01T12:00:00Z');
  assert.ok(p && p.year === '2026', 'valid ISO yields parts');
});

// ════════════════════════════════════════════════════════════════════════════
// 4. ORDER CACHE + DISPLAY DERIVATIONS
// ════════════════════════════════════════════════════════════════════════════

test('getOrdersArray: stamps _key + sorts by placedAt DESC (newest first)', () => {
  const { OrdersCore } = makeCtx({ orders: {
    a: { placedAt: '2026-01-01T00:00:00Z' },
    b: { placedAt: '2026-03-01T00:00:00Z' },
    c: { placedAt: '2026-02-01T00:00:00Z' }
  } });
  const arr = OrdersCore.getOrdersArray();
  // .join → primitive (the array itself is vm-realm, which would trip deepStrictEqual).
  assert.strictEqual(arr.map((o) => o._key).join(','), 'b,c,a');
  assert.ok(arr.every((o) => typeof o._key === 'string'), 'every row carries its cache key');
});

test('getOrdersArray: missing placedAt does not throw (string-coalesced)', () => {
  const { OrdersCore } = makeCtx({ orders: { a: {}, b: { placedAt: '2026-01-01T00:00:00Z' } } });
  let arr;
  assert.doesNotThrow(() => { arr = OrdersCore.getOrdersArray(); });
  assert.strictEqual(arr.length, 2);
});

test('getOrdersArray: FLAG — throws on a Firestore Timestamp placedAt (localeCompare-on-Timestamp class)', () => {
  // KNOWN LATENT BUG (pinned, not fixed): the sort does
  // `(b.placedAt || '').localeCompare(...)`. A Firestore Timestamp object is
  // truthy and has no .localeCompare → TypeError, the same crash class as MCP
  // #140 (~30 sites). Today orders carry ISO-string placedAt so it's unreached,
  // but a Timestamp-shaped record would crash getOrdersArray → the New-Orders /
  // Ready-to-Ship dashboard cards that call it. This asserts CURRENT behavior so
  // a future coercion fix flips it to a green no-throw test.
  const { OrdersCore } = makeCtx({ orders: {
    a: { placedAt: { seconds: 1, nanoseconds: 0 } },
    b: { placedAt: { seconds: 2, nanoseconds: 0 } }
  } });
  assert.throws(() => OrdersCore.getOrdersArray(), /localeCompare is not a function/);
});

test('getOrderDisplayNumber: orderNumber → orderId → _key precedence', () => {
  const { OrdersCore } = makeCtx();
  assert.strictEqual(OrdersCore.getOrderDisplayNumber({ orderNumber: 'ON', orderId: 'OID', _key: 'K' }), 'ON');
  assert.strictEqual(OrdersCore.getOrderDisplayNumber({ orderId: 'OID', _key: 'K' }), 'OID');
  assert.strictEqual(OrdersCore.getOrderDisplayNumber({ _key: 'K' }), 'K');
});

test('getOrderItemsLabel: sums qty, pluralizes, defaults qty→1, empty→"0 items"', () => {
  const { OrdersCore } = makeCtx();
  assert.strictEqual(OrdersCore.getOrderItemsLabel({ items: [{ qty: 2 }, { qty: 3 }] }), '5 items');
  assert.strictEqual(OrdersCore.getOrderItemsLabel({ items: [{ qty: 1 }] }), '1 item');
  assert.strictEqual(OrdersCore.getOrderItemsLabel({ items: [{}] }), '1 item');     // qty defaults to 1
  assert.strictEqual(OrdersCore.getOrderItemsLabel({ items: [{ qty: 1 }, {}] }), '2 items');
  assert.strictEqual(OrdersCore.getOrderItemsLabel({ items: [] }), '0 items');
  assert.strictEqual(OrdersCore.getOrderItemsLabel({}), '0 items');
});

test('getItemFulfillmentKey: pid + normalized option values (lowercase, non-alnum stripped)', () => {
  const { OrdersCore } = makeCtx();
  assert.strictEqual(OrdersCore.getItemFulfillmentKey({ pid: 'P1' }), 'P1');
  assert.strictEqual(OrdersCore.getItemFulfillmentKey({ pid: 'P1', options: { Color: 'Red', Size: 'L' } }), 'P1_red_l');
  assert.strictEqual(OrdersCore.getItemFulfillmentKey({ pid: 'P1', options: { Color: 'Sky Blue' } }), 'P1_skyblue');
});

test('renderOrderProgress: terminal/branch states render their dedicated step', () => {
  const { OrdersCore } = makeCtx();
  const cancelled = OrdersCore.renderOrderProgress('cancelled');
  assert.ok(cancelled.includes('order-progress-step cancelled') && cancelled.includes('Cancelled'));
  const pending = OrdersCore.renderOrderProgress('pending_payment');
  assert.ok(pending.includes('order-progress-step current') && pending.includes('Pending Payment'));
  assert.ok(OrdersCore.renderOrderProgress('payment_failed').includes('Payment Failed'));
});

test('renderOrderProgress: a mid-flow status marks Build as "skipped" when it jumped past it', () => {
  const { OrdersCore } = makeCtx();
  // 'shipped' is past 'building' and isn't 'building' itself → Build shown skipped.
  const html = OrdersCore.renderOrderProgress('shipped');
  assert.ok(html.includes('order-progress-step skipped'), 'Build step rendered as skipped');
  assert.ok(html.includes('order-progress-step current'), 'current step present');
});

// ════════════════════════════════════════════════════════════════════════════
// 5. INVOICE STATUS DERIVATIONS
// ════════════════════════════════════════════════════════════════════════════

test('isOrderInvoiceable: net terms (case-insensitive) OR wholesale, AND status draft/empty', () => {
  const { OrdersCore } = makeCtx();
  const f = OrdersCore.isOrderInvoiceable;
  assert.strictEqual(f({ paymentTerms: 'net30' }), true);
  assert.strictEqual(f({ paymentTerms: 'NET30' }), true);          // lowercased
  assert.strictEqual(f({ paymentTerms: 'net15' }), true);
  assert.strictEqual(f({ paymentTerms: 'net60' }), true);
  assert.strictEqual(f({ isWholesale: true }), true);
  assert.strictEqual(f({ orderType: 'wholesale' }), true);
  assert.strictEqual(f({ type: 'wholesale' }), true);              // W2c fix: checkout writes `type`
});

test('isOrderInvoiceable: rejects non-net terms, already-issued invoices, and plain retail', () => {
  const { OrdersCore } = makeCtx();
  const f = OrdersCore.isOrderInvoiceable;
  assert.strictEqual(f({ paymentTerms: 'net45' }), false);                       // net45 not recognized
  assert.strictEqual(f({ paymentTerms: 'net30', invoiceStatus: 'sent' }), false); // already issued
  assert.strictEqual(f({ paymentTerms: 'net30', invoiceStatus: 'draft' }), true); // draft can regenerate
  assert.strictEqual(f({}), false);                                              // retail, no terms
});

test('getEffectiveInvoiceStatus: sent + past due → overdue; future → sent; paid passthrough', () => {
  const { OrdersCore } = makeCtx();
  const f = OrdersCore.getEffectiveInvoiceStatus;
  assert.strictEqual(f({ invoiceStatus: 'sent', invoiceDueDate: '2020-01-01' }), 'overdue');
  assert.strictEqual(f({ invoiceStatus: 'sent', invoiceDueDate: '2999-01-01' }), 'sent');
  assert.strictEqual(f({ invoiceStatus: 'sent' }), 'sent');   // no due date → never overdue
  assert.strictEqual(f({ invoiceStatus: 'paid', invoiceDueDate: '2020-01-01' }), 'paid'); // paid is terminal
  assert.strictEqual(f({}), null);
});

test('buildInvoiceSection (draft): routes the grand total through orderTotalDollars + MastUI badge', () => {
  const orders = { o1: { invoiceStatus: 'draft', invoiceNumber: 'INV-2026-0001', totalCents: 102000, subtotal: 0, items: [] } };
  const { OrdersCore } = makeCtx({ orders: orders });
  const html = OrdersCore.buildInvoiceSection('o1');
  assert.ok(html.includes('INV-2026-0001'), 'invoice number rendered');
  assert.ok(html.includes('Total: $1020.00'), 'grand total read via canonical accessor (cents → $1,020), not raw total');
  assert.ok(html.includes('Draft'), 'invoice draft badge from MastUI registry');
});

// ════════════════════════════════════════════════════════════════════════════
// 6. INVENTORY MOVEMENT CLUSTER — reserve/release/pull go through multiUpdate
//    full-slash paths (NOT MastDB.update, which would leak a "/" into the field
//    path — the bug pinned at the MastDB layer in mastdb-fieldpath.test.js; here
//    pinned at the orders-core caller layer).
// ════════════════════════════════════════════════════════════════════════════

const STOCKED = { P1: { stockType: 'stock', stock: { _default: { onHand: 10, committed: 0, held: 0, damaged: 0 }, v1: { onHand: 4, committed: 0, held: 0, damaged: 0 } } } };

test('reserveInventory: +committed on _default via multiUpdate full-slash path + history row', async () => {
  const { OrdersCore, rec } = makeCtx({ inventory: STOCKED });
  await OrdersCore.reserveInventory('P1', 2, '_default', 'ORD1');
  const mu = ops(rec, 'multiUpdate');
  assert.strictEqual(mu.length, 1);
  assert.deepStrictEqual(mu[0].updates['admin/inventory/P1/stock/_default/committed'], { __inc: 2 });
  // No '/' must survive into a Firestore FIELD path — multiUpdate translates the
  // full slash path; the keys ARE slash paths (doc+field), not field paths.
  const hist = ops(rec, 'push');
  assert.strictEqual(hist[0].path, 'admin/inventory/P1/history');
  assert.strictEqual(hist[0].data.action, 'committed');
  assert.strictEqual(hist[0].data.orderId, 'ORD1');
});

test('reserveInventory: variant ck bumps BOTH _default and the variant bucket (variant-aware)', async () => {
  const { OrdersCore, rec } = makeCtx({ inventory: STOCKED });
  await OrdersCore.reserveInventory('P1', 1, 'v1', 'ORD1');
  const u = ops(rec, 'multiUpdate')[0].updates;
  assert.deepStrictEqual(u['admin/inventory/P1/stock/_default/committed'], { __inc: 1 });
  assert.deepStrictEqual(u['admin/inventory/P1/stock/v1/committed'], { __inc: 1 });
});

test('reserveInventory: no stock record → no-op (no multiUpdate, no audit, no history)', async () => {
  const { OrdersCore, rec } = makeCtx({ inventory: { P1: {} } });
  await OrdersCore.reserveInventory('P1', 2, '_default');
  assert.strictEqual(ops(rec, 'multiUpdate').length, 0);
  assert.strictEqual(rec.audit.length, 0);
  assert.strictEqual(ops(rec, 'push').length, 0);
});

test('releaseInventory: -committed (negative increment) + "released" history', async () => {
  const { OrdersCore, rec } = makeCtx({ inventory: STOCKED });
  await OrdersCore.releaseInventory('P1', 3, '_default', 'ORD1');
  assert.deepStrictEqual(ops(rec, 'multiUpdate')[0].updates['admin/inventory/P1/stock/_default/committed'], { __inc: -3 });
  assert.strictEqual(ops(rec, 'push')[0].data.action, 'released');
});

test('pullFromStock: decrements BOTH committed AND onHand; "shipped" history with negative qty', async () => {
  const { OrdersCore, rec } = makeCtx({ inventory: STOCKED });
  await OrdersCore.pullFromStock('P1', 1, '_default', 'ORD1');
  const u = ops(rec, 'multiUpdate')[0].updates;
  assert.deepStrictEqual(u['admin/inventory/P1/stock/_default/committed'], { __inc: -1 });
  assert.deepStrictEqual(u['admin/inventory/P1/stock/_default/onHand'], { __inc: -1 });
  const h = ops(rec, 'push')[0].data;
  assert.strictEqual(h.action, 'shipped');
  assert.strictEqual(h.qty, -1);
});

// ════════════════════════════════════════════════════════════════════════════
// 7. getItemInventoryStatus — per-item availability classification
// ════════════════════════════════════════════════════════════════════════════

test('getItemInventoryStatus: no inventory data → unknown', () => {
  const { OrdersCore } = makeCtx({ inventory: {} });
  const r = OrdersCore.getItemInventoryStatus({ pid: 'NOPE', qty: 1 });
  assert.strictEqual(r.status, 'unknown');
  assert.strictEqual(r.label, 'No inventory data');
  assert.strictEqual(r.available, 0);
});

test('getItemInventoryStatus: made-to-order family → build', () => {
  const mk = (st) => makeCtx({ inventory: { P1: { stockType: st } } }).OrdersCore.getItemInventoryStatus({ pid: 'P1', qty: 1 });
  ['made-to-order', 'made-to-order-only', 'build-to-order'].forEach((st) => {
    assert.strictEqual(mk(st).status, 'build', st + ' → build');
  });
});

test('getItemInventoryStatus: in-stock vs partial vs out (available = onHand-committed-held-damaged)', () => {
  const inv = { P1: { stockType: 'stock', stock: { _default: { onHand: 10, committed: 3, held: 1, damaged: 1 } } } }; // available = 5
  const { OrdersCore } = makeCtx({ inventory: inv });
  assert.strictEqual(OrdersCore.getItemInventoryStatus({ pid: 'P1', qty: 5 }).status, 'stock');   // 5 >= 5
  assert.strictEqual(OrdersCore.getItemInventoryStatus({ pid: 'P1', qty: 8 }).status, 'partial'); // 0 < 5 < 8
  const out = { P1: { stockType: 'stock', stock: { _default: { onHand: 1, committed: 1, held: 0, damaged: 0 } } } }; // available 0
  assert.strictEqual(makeCtx({ inventory: out }).OrdersCore.getItemInventoryStatus({ pid: 'P1', qty: 1 }).status, 'out');
});

test('getItemInventoryStatus: stock-to-build with depleted stock → build (made to order)', () => {
  const inv = { P1: { stockType: 'stock-to-build', stock: { _default: { onHand: 0, committed: 0, held: 0, damaged: 0 } } } };
  const { OrdersCore } = makeCtx({ inventory: inv });
  const r = OrdersCore.getItemInventoryStatus({ pid: 'P1', qty: 1 });
  assert.strictEqual(r.status, 'build');
  assert.ok(/stock depleted/.test(r.label));
});

// ════════════════════════════════════════════════════════════════════════════
// 8. LIFECYCLE — triageAndConfirmOrder + transitionOrder
// ════════════════════════════════════════════════════════════════════════════

// Confirm-time `committed` double-commit (companion to PR #810's backorder fix).
// A STOREFRONT order (arch submitOrder, non-POS) already reserved `committed` for
// every stock line at PLACEMENT, and carries NO `source`. Confirming it must route
// the line to 'stock' and advance to "pack" but must NOT re-reserve — re-reserving
// double-commits the line and leaks a phantom commit on ship (committed never falls
// back, understating availability forever). No build job opens.
test('triageAndConfirmOrder: all-stock storefront order (no source) → "pack", NO re-reserve (already committed at placement)', async () => {
  const orders = { ORD1: { items: [{ pid: 'P1', qty: 1 }] } }; // no source ⇒ storefront submitOrder
  const { OrdersCore, rec } = makeCtx({ orders: orders, inventory: STOCKED });
  await OrdersCore.triageAndConfirmOrder('ORD1', [{ item: { pid: 'P1', qty: 1 }, action: 'stock' }]);
  const upd = ops(rec, 'orders.update').find((w) => w.data.status);
  assert.strictEqual(upd.data.status, 'pack');
  assert.ok(upd.data.fulfillment, 'fulfillment map written');
  assert.strictEqual(ops(rec, 'multiUpdate').length, 0, 'NO re-reserve — submitOrder committed this line at placement');
  assert.strictEqual(ops(rec, 'pr.set').length, 0, 'no production request for an in-stock item');
});

// The flip side of the gate: an order created OUTSIDE the storefront checkout never
// got the placement `committed` reservation — wholesale pay-by-check (client-side
// MastDB.set, source 'wholesale_catalog'), an Etsy-sync order (source 'etsy'), etc.
// For these the confirm-time reserve is the FIRST/ONLY commit and MUST fire, or the
// sold stock is never held (oversell). The non-storefront `source` is the gate.
test('triageAndConfirmOrder: all-stock NON-storefront order (source set) → "pack" + reserves committed (first commit)', async () => {
  const orders = { ORD1: { source: 'etsy', items: [{ pid: 'P1', qty: 2 }] } };
  const { OrdersCore, rec } = makeCtx({ orders: orders, inventory: STOCKED });
  await OrdersCore.triageAndConfirmOrder('ORD1', [{ item: { pid: 'P1', qty: 2 }, action: 'stock' }]);
  assert.strictEqual(ops(rec, 'orders.update').find((w) => w.data.status).data.status, 'pack');
  const mu = ops(rec, 'multiUpdate');
  assert.strictEqual(mu.length, 1, 'never-committed line reserved at confirm (first commit)');
  assert.deepStrictEqual(mu[0].updates['admin/inventory/P1/stock/_default/committed'], { __inc: 2 }, 'committed += qty');
  assert.strictEqual(ops(rec, 'pr.set').length, 0, 'no production request for an in-stock item');
});

test('triageAndConfirmOrder: a build item → status "building" + opens a production request', async () => {
  const orders = { ORD1: { orderNumber: 'SO-1', items: [{ pid: 'P1', name: 'Mug', qty: 2 }] } };
  const { OrdersCore, rec } = makeCtx({ orders: orders, inventory: { P1: { stockType: 'made-to-order' } } });
  await OrdersCore.triageAndConfirmOrder('ORD1', [{ item: { pid: 'P1', name: 'Mug', qty: 2 }, action: 'build' }]);
  assert.strictEqual(ops(rec, 'orders.update').find((w) => w.data.status).data.status, 'building');
  const pr = ops(rec, 'pr.set');
  assert.strictEqual(pr.length, 1, 'one build job opened');
  assert.strictEqual(pr[0].data.productId, 'P1');
  assert.strictEqual(pr[0].data.qty, 2);
  // createProductionRequests links the job id back via MastDB.orders.subRef(...).
  assert.ok(ops(rec, 'orders.subRef.set').length === 1, 'fulfillment buildJobId linked back');
});

test('triageAndConfirmOrder: unknown order → throws "Order not found"', async () => {
  const { OrdersCore } = makeCtx({ orders: {} });
  await assert.rejects(() => OrdersCore.triageAndConfirmOrder('GHOST', []), /Order not found/);
});

// Tier 2 backorder: a resold out-of-stock line covered by an open PO must NOT be
// forced to Build. It records a 'backorder' fulfillment source, opens NO build
// job, does NOT re-reserve (submitOrder committed it at placement), and holds the
// order in Confirmed so the pickship backorder-stock gate governs release.
test('triageAndConfirmOrder: a backorder item → status "confirmed", NO build job, NO re-reserve', async () => {
  const orders = { ORD1: { items: [{ pid: 'P1', qty: 1, backorder: true }] } };
  const inv = { P1: { stockType: 'strict', stock: { _default: { onHand: 0, committed: 1 } } } };
  const { OrdersCore, rec } = makeCtx({ orders: orders, inventory: inv });
  await OrdersCore.triageAndConfirmOrder('ORD1', [{ item: { pid: 'P1', qty: 1, backorder: true }, action: 'backorder' }]);
  const upd = ops(rec, 'orders.update').find((w) => w.data.status);
  assert.strictEqual(upd.data.status, 'confirmed', 'backorder order holds in Confirmed (gate governs release), not Building');
  const ff = upd.data.fulfillment;
  const key = Object.keys(ff)[0];
  assert.strictEqual(ff[key].source, 'backorder', 'fulfillment source is backorder');
  assert.strictEqual(ff[key].buildJobId, null, 'no build job linked to the backorder line');
  assert.strictEqual(ops(rec, 'pr.set').length, 0, 'no production request for a backorder item');
  assert.strictEqual(ops(rec, 'multiUpdate').length, 0, 'no re-reserve — committed was already set at placement by submitOrder');
});

test('triageAndConfirmOrder: build + backorder mix → status "building", build job ONLY for the build line', async () => {
  const orders = { ORD1: { orderNumber: 'SO-2', items: [{ pid: 'P1', name: 'Mug', qty: 1 }, { pid: 'P2', name: 'Resold', qty: 1, backorder: true }] } };
  const inv = { P1: { stockType: 'made-to-order' }, P2: { stockType: 'strict', stock: { _default: { onHand: 0, committed: 1 } } } };
  const { OrdersCore, rec } = makeCtx({ orders: orders, inventory: inv });
  await OrdersCore.triageAndConfirmOrder('ORD1', [
    { item: { pid: 'P1', name: 'Mug', qty: 1 }, action: 'build' },
    { item: { pid: 'P2', name: 'Resold', qty: 1, backorder: true }, action: 'backorder' }
  ]);
  assert.strictEqual(ops(rec, 'orders.update').find((w) => w.data.status).data.status, 'building', 'a build line still drives Building');
  const pr = ops(rec, 'pr.set');
  assert.strictEqual(pr.length, 1, 'exactly one production request');
  assert.strictEqual(pr[0].data.productId, 'P1', 'only the build line P1 opens a build job — the backorder line P2 does not');
});

test('transitionOrder: INVALID transition is refused — error toast, NO db write, NO cloud call', async () => {
  const orders = { ORD1: { status: 'placed' } };
  const { OrdersCore, rec } = makeCtx({ orders: orders });
  await OrdersCore.transitionOrder('ORD1', 'shipped'); // placed → shipped not allowed
  assert.strictEqual(rec.db.length, 0, 'no DB writes on a refused transition');
  assert.strictEqual(rec.cf.length, 0, 'no cloud calls on a refused transition');
  const t = rec.toasts[rec.toasts.length - 1];
  assert.ok(t.isErr && /Cannot transition from placed to shipped/.test(t.msg));
});

test('transitionOrder: valid pack→packed writes status + fulfillmentLog, emits testing event, no CF', async () => {
  const orders = { ORD1: { status: 'pack' } };
  const { OrdersCore, rec } = makeCtx({ orders: orders });
  await OrdersCore.transitionOrder('ORD1', 'packed');
  const upd = ops(rec, 'orders.update')[0];
  assert.strictEqual(upd.data.status, 'packed');
  assert.ok(Array.isArray(upd.data.fulfillmentLog), 'packed is a fulfillment milestone → log appended');
  assert.strictEqual(orders.ORD1.status, 'packed', 'local cache mutated for re-render');
  assert.ok(rec.testing.find((e) => e.name === 'transitionOrder'), 'testing event emitted');
  assert.strictEqual(rec.cf.length, 0, 'packed is not a ship milestone → no cloud call');
});

// ════════════════════════════════════════════════════════════════════════════
// 9. MONEY-SAFETY — write cores delegate to cloud functions; NO client-side
//    money/stock decrement is done in the browser. (memory: "money-writes = a
//    gated CF, not a client bridge".)
// ════════════════════════════════════════════════════════════════════════════

test('_markOrderShippedCore: delegates inventory deduction to the onOrderShipped CF; NO client stock/money write', async () => {
  const orders = { ORD1: { status: 'packed', email: 'c@x.com' } };
  const { OrdersCore, rec } = makeCtx({ orders: orders });
  await OrdersCore._markOrderShippedCore('ORD1');
  // The cloud function is the inventory-deduction + shipped-email owner.
  const call = cf(rec, 'onOrderShipped');
  assert.ok(call, 'onOrderShipped CF invoked');
  // Field-wise (the payload is built inside the vm realm → its prototype differs
  // from this realm's, which would trip deepStrictEqual's prototype check).
  assert.strictEqual(call.payload.orderId, 'ORD1');
  assert.strictEqual(call.payload.tenantId, 't1');
  // The order doc gets a plain status flip — and NOTHING that moves money/stock
  // client-side: no multiUpdate (stock), no admin/sales write, no other CF.
  assert.strictEqual(ops(rec, 'orders.update')[0].data.status, 'shipped');
  assert.strictEqual(ops(rec, 'multiUpdate').length, 0, 'no client-side stock decrement (CF owns it)');
  assert.ok(!rec.db.some((w) => JSON.stringify(w).includes('admin/sales')), 'no client admin/sales write');
  assert.strictEqual(rec.cf.length, 1, 'exactly one CF call: onOrderShipped');
});

test('transitionOrder packed→shipped also delegates to onOrderShipped (single ship path)', async () => {
  const orders = { ORD1: { status: 'packed', email: 'c@x.com' } };
  const { OrdersCore, rec } = makeCtx({ orders: orders });
  await OrdersCore.transitionOrder('ORD1', 'shipped');
  assert.ok(cf(rec, 'onOrderShipped'), 'shipped transition fires onOrderShipped');
  assert.strictEqual(ops(rec, 'multiUpdate').length, 0, 'no client stock decrement on ship');
});

test('markOrderInvoicePaid: derives paid amount via canonical accessor (cents) and writes ONLY the order — no revenue CF', async () => {
  const orders = { ORD1: { totalCents: 102000, total: 5 } };
  const { OrdersCore, rec } = makeCtx({ orders: orders });
  await OrdersCore.markOrderInvoicePaid('ORD1');
  const upd = ops(rec, 'orders.update')[0];
  assert.strictEqual(upd.data.invoiceStatus, 'paid');
  // 1020 dollars (totalCents wins) → 102000 cents. NOT 500 (would be raw total*100).
  assert.strictEqual(upd.data.invoicePaidAmount, 102000, 'paid amount = round(orderTotalDollars*100), canonical');
  assert.strictEqual(rec.cf.length, 0, 'marking paid touches no cloud function (no revenue re-accrual client-side)');
});

test('sendInvoice (Square processor): routes through createSquareInvoice CF with tenant+order; no client money write', async () => {
  const orders = { ORD1: { invoiceNumber: 'INV-1', email: 'c@x.com' } };
  const { OrdersCore, rec } = makeCtx({ orders: orders });
  rec.dbGet = (p) => (p === 'config/paymentProcessor' ? 'square' : null);
  await OrdersCore.sendInvoice('ORD1');
  const sq = cf(rec, 'createSquareInvoice');
  assert.ok(sq, 'createSquareInvoice CF invoked for a Square tenant');
  assert.strictEqual(sq.payload.tenantId, 't1');
  assert.strictEqual(sq.payload.orderId, 'ORD1');
  assert.ok(!rec.db.some((w) => JSON.stringify(w).includes('admin/sales')), 'no client admin/sales write');
});

test('_cancelOrderCore: no money/refund CF; routes the status flip through MastFlow; writes cancel fields', async () => {
  const orders = { ORD1: { orderNumber: 'SO-9', status: 'placed', email: 'c@x.com' } };
  const mastFlow = { getDefinition: () => ({ id: 'pickship' }), transition: function () { var a = Array.prototype.slice.call(arguments); orders._mf = a; return Promise.resolve(); } };
  const { OrdersCore, rec } = makeCtx({ orders: orders, productionRequests: {}, mastFlow: mastFlow });
  rec.mastflow = orders._mf;
  await OrdersCore._cancelOrderCore('ORD1', 'changed mind');
  assert.strictEqual(rec.cf.length, 0, 'cancellation performs NO money/refund cloud call');
  const cancelUpd = ops(rec, 'orders.update').find((w) => w.data.cancelReason !== undefined);
  assert.ok(cancelUpd && cancelUpd.data.cancelReason === 'changed mind', 'cancel reason persisted');
  assert.strictEqual(orders._mf[0], 'pickship', 'MastFlow.transition driven on the pickship definition');
  assert.strictEqual(orders._mf[2], 'closed', 'transition target phase is "closed"');
});

test('_cancelOrderCore: CS-ticket number is allocated ATOMICALLY (bulk-cancel race fix) → distinct numbers', async () => {
  // Two sequential cancels (the bulkCancel shape) share one stateful txn doc. The
  // pre-fix get→compute→write minted T-0001 for every row; the txn allocator must
  // hand out T-0001 then T-0002.
  const orders = { O1: { orderNumber: 'A', status: 'placed' }, O2: { orderNumber: 'B', status: 'placed' } };
  const mastFlow = { getDefinition: () => ({ id: 'pickship' }), transition: () => Promise.resolve() };
  const { OrdersCore, rec } = makeCtx({ orders: orders, productionRequests: {}, mastFlow: mastFlow });
  await OrdersCore._cancelOrderCore('O1', 'r1');
  await OrdersCore._cancelOrderCore('O2', 'r2');
  assert.ok(ops(rec, 'transaction').some((w) => w.path === 'cs_config/ticketing'), 'counter advanced via a Firestore transaction');
  const ticketNums = rec.db
    .filter((w) => w.op === 'set' && /^cs_tickets\//.test(w.path || '') && !/\/messages\//.test(w.path) && w.data && w.data.ticketNumber)
    .map((w) => w.data.ticketNumber);
  assert.deepStrictEqual(ticketNums, ['T-0001', 'T-0002'], 'each concurrent cancel gets a distinct ticket number');
});

test('_cancelOrderCore: releases placement `committed` for a backorder line (keyed by backorderVariantKey) even with NO fulfillment map; clamps made-to-order to a no-op', async () => {
  // Pre-existing inventory-leak fix: submitOrder commits `committed` at PLACEMENT
  // for every stock-tracked line, so cancelling an order that was placed but never
  // confirmed (no o.fulfillment) must still release. Lines:
  //  - PBO: backorder line, qty 2, committed sits in the VARIANT bucket 'vRed'.
  //         arch keyed it via item.backorderVariantKey, which differs from the
  //         harness getItemComboKey ('_default') → proves we release the bucket
  //         arch actually committed, not the options-derived one.
  //  - PMTO: made-to-order line, qty 5, NO inventory record at all → release must
  //          be a no-op (never push committed negative).
  const inventory = {
    PBO: { stockType: 'strict', stock: {
      _default: { onHand: 0, committed: 2, held: 0, damaged: 0 },
      vRed:     { onHand: 0, committed: 2, held: 0, damaged: 0 }
    } }
    // PMTO intentionally absent (true made-to-order has no inventory record).
  };
  const orders = { ORD: {
    orderNumber: 'SO-1', status: 'placed', // placed but NOT confirmed → no fulfillment map
    items: [
      { pid: 'PBO', qty: 2, backorder: true, backorderVariantKey: 'vRed', options: { color: 'Red' } },
      { pid: 'PMTO', qty: 5 }
    ]
  } };
  const mastFlow = { getDefinition: () => ({ id: 'pickship' }), transition: () => Promise.resolve() };
  const { OrdersCore, rec } = makeCtx({ orders: orders, inventory: inventory, productionRequests: {}, mastFlow: mastFlow });
  await OrdersCore._cancelOrderCore('ORD', 'cust cancelled');

  const releases = ops(rec, 'multiUpdate').map((w) => w.updates);
  const boRelease = releases.find((u) => 'admin/inventory/PBO/stock/vRed/committed' in u);
  assert.ok(boRelease, 'backorder line released against its backorderVariantKey bucket (vRed), not getItemComboKey');
  assert.deepStrictEqual(boRelease['admin/inventory/PBO/stock/vRed/committed'], { __inc: -2 }, 'releases the full committed qty (2)');
  assert.deepStrictEqual(boRelease['admin/inventory/PBO/stock/_default/committed'], { __inc: -2 }, '_default aggregate moves in lockstep');
  assert.ok(!releases.some((u) => Object.keys(u).some((k) => k.indexOf('admin/inventory/PMTO/') === 0)), 'made-to-order line (no committed) releases nothing — clamp min(qty, 0) = 0');
  const relHist = ops(rec, 'push').find((w) => /\/inventory\/PBO\/history$/.test(w.path));
  assert.ok(relHist && relHist.data.action === 'released' && relHist.data.reason === 'order_cancelled', 'released history written for the backorder line');
  assert.strictEqual(relHist.data.orderId, 'ORD', 'release history records the cancelled orderId');
});

test('_cancelOrderCore: a confirmed build (stock-to-build) line releases its committed too, clamped to what was actually reserved', async () => {
  // The OLD gate released only source==='stock' && ready, so a 'build' line's
  // placement committed leaked. submitOrder commits min(qty, available) for a
  // stock-to-build line, so here committed (3) < line qty (5): the release must be
  // the committed 3, not the line qty 5 (no over-release, never negative).
  const inventory = {
    PSB: { stockType: 'stock-to-build', stock: { _default: { onHand: 3, committed: 3, held: 0, damaged: 0 } } }
  };
  const orders = { ORD: {
    orderNumber: 'SO-2', status: 'building',
    fulfillment: { PSB: { source: 'build', buildJobId: null, ready: false } },
    items: [ { pid: 'PSB', qty: 5 } ]
  } };
  const mastFlow = { getDefinition: () => ({ id: 'pickship' }), transition: () => Promise.resolve() };
  const { OrdersCore, rec } = makeCtx({ orders: orders, inventory: inventory, productionRequests: {}, mastFlow: mastFlow });
  await OrdersCore._cancelOrderCore('ORD', null);
  const rel = ops(rec, 'multiUpdate').map((w) => w.updates).find((u) => 'admin/inventory/PSB/stock/_default/committed' in u);
  assert.ok(rel, 'build (stock-to-build) line released its committed reservation (old code skipped non-stock sources)');
  assert.deepStrictEqual(rel['admin/inventory/PSB/stock/_default/committed'], { __inc: -3 }, 'released min(qty 5, committed 3) = 3 — clamped, never negative');
});

test('_addOrderNoteCore: ARRAY-shaped notes are appended as an array (preserves shape)', async () => {
  const orders = { ORD1: { notes: [{ text: 'old' }] } };
  const { OrdersCore, rec } = makeCtx({ orders: orders });
  await OrdersCore._addOrderNoteCore('ORD1', 'new note');
  const setCall = ops(rec, 'orders.subRef.set')[0];
  assert.ok(Array.isArray(setCall.value), 'array shape preserved');
  assert.strictEqual(setCall.value.length, 2);
  assert.strictEqual(setCall.value[1].text, 'new note');
  assert.strictEqual(setCall.value[1].by, 'admin');
});

test('_addOrderNoteCore: MAP-shaped notes (tenant-MCP) append a keyed entry (preserves map shape)', async () => {
  const orders = { ORD1: { notes: { n_existing: { text: 'old' } } } };
  const { OrdersCore, rec } = makeCtx({ orders: orders });
  await OrdersCore._addOrderNoteCore('ORD1', 'mapped note');
  const setCall = ops(rec, 'orders.subRef.set')[0];
  // subRef('notes', <newId>).set(note) → segs include the generated key, value is
  // the single note object (NOT an array) — map shape retained.
  assert.ok(setCall.segs.indexOf('notes') !== -1, 'wrote under notes/<id>');
  assert.strictEqual(setCall.value.text, 'mapped note');
  assert.ok(!Array.isArray(setCall.value), 'map entry, not an array overwrite');
});

// ── summary line ──────────────────────────────────────────────────────────────
test('orders-core exports the full PR1–PR4 surface (no accidental drop)', () => {
  const { OrdersCore } = makeCtx();
  ['etsySourceBadgeStyle', 'getOrderDisplayNumber', 'getOrderItemsLabel', 'formatOrderDate',
   'formatOrderDateTime', 'renderOrderProgress', 'ensureTenantTz', 'tzPartsFromIso',
   'getOrdersArray', 'getItemInventoryStatus', 'getItemFulfillmentKey', 'triageAndConfirmOrder',
   'reserveInventory', 'releaseInventory', 'pullFromStock', 'createProductionRequests',
   'orderTotalDollars', 'loadOrders', 'transitionOrder', 'isOrderInvoiceable',
   'getEffectiveInvoiceStatus', 'generateInvoice', 'sendInvoice', 'markOrderInvoicePaid',
   'resendInvoice', 'buildInvoiceSection', '_cancelOrderCore', '_addOrderNoteCore',
   '_markOrderShippedCore', 'viewOrder', 'renderDashCardNewOrders', 'renderDashCardReadyToShip']
    .forEach((name) => assert.strictEqual(typeof OrdersCore[name], 'function', name + ' export present'));
});
