/**
 * Regression test for MastDB.transaction on a nested fieldPath.
 *
 * Context (sgtest15 build-completion corruption): the admin UI starts a job with
 *   MastDB.transaction('admin/inventory/<pid>/stock/_default/incoming',
 *                       function(current){ return (current || 0) + qty; });
 * The tenant- and platform-store transaction() implementations IGNORED the
 * parsed fieldPath: they read the WHOLE document as `current`, so the callback
 * computed `(wholeDocObject || 0) + qty` === "[object Object]<qty>", and the
 * scalar branch then did `tx.set(ref, { _v: "[object Object]<qty>" })` — a FULL
 * document replace. That wiped `stock`/`stockType` and left the tell-tale
 * `_v: "[object Object]N"` field (later half-restored by the server autopush,
 * yielding onHand off-by-the-prior-value and stockType reverting to its default).
 *
 * The fix makes transaction() honor fieldPath exactly like get()/set(): read the
 * nested value, write it back via mergeFields. This pins that behavior against a
 * fake Firestore that stores doc state, so we can assert the post-transaction
 * document is intact (no `_v`, siblings preserved) and the leaf moved.
 *
 * Run: node test/mastdb-transaction-fieldpath.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Deep-merge `src` into `dst` (mergeFields emulation: `src` is the nested object
// produced by _buildNestedSet, scoped to the written leaf). Mutates dst.
function deepMerge(dst, src) {
  Object.keys(src).forEach(function (k) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!dst[k] || typeof dst[k] !== 'object' || Array.isArray(dst[k])) dst[k] = {};
      deepMerge(dst[k], v);
    } else {
      dst[k] = v;
    }
  });
}

function makeHarness(seed) {
  // In-memory doc store keyed by full Firestore path.
  const store = Object.create(null);
  if (seed) Object.keys(seed).forEach(function (p) { store[p] = JSON.parse(JSON.stringify(seed[p])); });
  const writes = [];

  function applySet(p, data, opts) {
    const merge = opts && (opts.merge || opts.mergeFields);
    writes.push({ docPath: p, data: data, mergeFields: opts && opts.mergeFields ? Array.from(opts.mergeFields, String) : null });
    if (merge) {
      if (!store[p] || typeof store[p] !== 'object') store[p] = {};
      deepMerge(store[p], data);
    } else {
      store[p] = JSON.parse(JSON.stringify(data));
    }
  }
  function snap(p) {
    const exists = Object.prototype.hasOwnProperty.call(store, p) && store[p] !== undefined;
    return { exists: exists, data: function () { return exists ? store[p] : undefined; } };
  }

  function docRef(p) {
    return {
      path: p,
      collection: function (c) { return collRef(p + '/' + c); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, opts) { applySet(p, data, opts); return Promise.resolve(); }
    };
  }
  function collRef(p) {
    return { doc: function (id) { return docRef(p + '/' + (id || 'AUTOID')); } };
  }

  const fakeFs = {
    collection: function (c) { return collRef(c); },
    runTransaction: function (fn) {
      const tx = {
        get: function (ref) { return Promise.resolve(snap(ref.path)); },
        set: function (ref, data, opts) { applySet(ref.path, data, opts); }
      };
      return Promise.resolve().then(function () { return fn(tx); });
    }
  };

  const firebase = {
    firestore: Object.assign(function () { return fakeFs; }, {
      FieldValue: {
        increment: function (n) { return { __increment: n }; },
        serverTimestamp: function () { return { __serverTimestamp: true }; },
        delete: function () { return { __delete: true }; }
      },
      FieldPath: function () { this.segments = Array.prototype.slice.call(arguments); }
    })
  };

  const src = fs.readFileSync(path.join(__dirname, '../shared/mastdb.js'), 'utf8');
  const sandbox = { firebase: firebase, window: {}, console: console, Promise: Promise, setTimeout: setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const MastDB = sandbox.MastDB;
  MastDB.init({ firestore: fakeFs, tenantId: 't1' });

  return { MastDB: MastDB, store: store, writes: writes };
}

const INV = 'tenants/t1/inventory/PID';

test('transaction on a nested fieldPath sees the leaf value, not the whole doc', async () => {
  let seen;
  const h = makeHarness({ [INV]: { stock: { _default: { onHand: 10, incoming: 0 } }, stockType: 'stock-to-build' } });
  await h.MastDB.transaction('admin/inventory/PID/stock/_default/incoming', function (current) {
    seen = current;
    return (current || 0) + 3;
  });
  // The callback must receive the nested number (0), NOT the inventory object.
  assert.strictEqual(seen, 0, 'transaction callback got ' + JSON.stringify(seen) + ', expected the nested leaf 0');
});

test('transaction preserves siblings and never writes a {_v} corruption field', async () => {
  const h = makeHarness({ [INV]: { stock: { _default: { onHand: 10, incoming: 0 } }, stockType: 'stock-to-build' } });
  await h.MastDB.transaction('admin/inventory/PID/stock/_default/incoming', function (current) {
    return (current || 0) + 3;
  });
  const doc = h.store[INV];
  assert.strictEqual(doc.stock._default.incoming, 3, 'nested leaf updated to 3');
  assert.strictEqual(doc.stock._default.onHand, 10, 'sibling onHand preserved (was wiped by the bug)');
  assert.strictEqual(doc.stockType, 'stock-to-build', 'stockType preserved (was wiped by the bug)');
  assert.ok(!('_v' in doc), 'no _v corruption field: ' + JSON.stringify(doc));
  // Every write must be scoped via mergeFields to the nested leaf.
  h.writes.forEach(function (w) {
    assert.deepStrictEqual(w.mergeFields, ['stock._default.incoming'], 'write must mergeFields the leaf, got ' + JSON.stringify(w));
    assert.ok(!('_v' in w.data), 'write must not carry _v: ' + JSON.stringify(w.data));
  });
});

test('transaction creates the nested field cleanly when the doc does not yet exist', async () => {
  const h = makeHarness(/* empty store */);
  await h.MastDB.transaction('admin/inventory/PID/stock/_default/incoming', function (current) {
    return (current || 0) + 3;
  });
  const doc = h.store[INV];
  assert.deepStrictEqual(doc, { stock: { _default: { incoming: 3 } } });
  assert.ok(!('_v' in doc));
});

test('corruption guard: a fieldPath transaction refuses to persist an object-coerced scalar', async () => {
  const h = makeHarness({ [INV]: { stock: { _default: { incoming: 0 } } } });
  await assert.rejects(
    h.MastDB.transaction('admin/inventory/PID/stock/_default/incoming', function () {
      return '[object Object]3'; // simulate the old object+number coercion reaching the write boundary
    }),
    /refusing to persist a corrupt scalar/
  );
});
