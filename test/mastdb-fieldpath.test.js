/**
 * Regression test for MastDB nested-field updates on the live Firestore backend.
 *
 * Context: orders.js reserveInventory/releaseInventory/pullFromStock used to bump
 * a product's stock counters with MastDB.update('admin/inventory/{pid}/stock', {
 *   '_default/committed': serverIncrement(qty), ... }). On Firestore, MastDB.update
 * prefixes each partial key with the 'stock.' fieldPath, yielding the field path
 * 'stock._default/committed'. Firestore forbids '/' in field paths
 * (FirebaseError: invalid field path), so every reserve/release/ship write threw,
 * was swallowed by the helper's try/catch, and inventory silently never moved.
 *
 * The fix routes those bumps through MastDB.multiUpdate with full slash paths
 * ('admin/inventory/{pid}/stock/_default/committed'), which MastDB translates into
 * a slash-free nested field update (dot-joined fieldPath via mergeFields) while
 * preserving the atomic FieldValue.increment.
 *
 * This pins that translation by loading the real shared/mastdb.js against a fake
 * Firestore and asserting (1) the legacy slash-keyed MastDB.update produces a '/'
 * in the field path (the bug), and (2) the multiUpdate path the fix uses never
 * does, and still carries the increment to the right nested leaves.
 *
 * Run: node test/mastdb-fieldpath.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- Minimal fake Firestore that records the field paths handed to it. ---
function makeHarness() {
  const writes = []; // { kind, docPath, fields:[{path,value}], mergeFields }

  function docRef(p) {
    return {
      path: p,
      collection: function (c) { return collRef(p + '/' + c); },
      // Object form: docRef.update({ 'a.b': v, ... })
      // Varargs form: docRef.update(field1, val1, field2, val2, ...)
      update: function () {
        const a = Array.prototype.slice.call(arguments);
        const fields = [];
        if (a.length === 1 && a[0] && typeof a[0] === 'object' && !(a[0] instanceof FakeFieldPath)) {
          Object.keys(a[0]).forEach(function (k) { fields.push({ path: k, value: a[0][k] }); });
        } else {
          for (let i = 0; i < a.length; i += 2) {
            fields.push({ path: String(a[i]), value: a[i + 1] });
          }
        }
        writes.push({ kind: 'update', docPath: p, fields: fields });
        return Promise.resolve();
      },
      set: function (data, opts) {
        writes.push({
          kind: 'set', docPath: p, data: data,
          mergeFields: opts && opts.mergeFields ? Array.from(opts.mergeFields, String) : null
        });
        return Promise.resolve();
      }
    };
  }
  function collRef(p) {
    return {
      doc: function (id) { return docRef(p + '/' + (id || 'AUTOID')); }
    };
  }

  function FakeFieldPath() { this.segments = Array.prototype.slice.call(arguments); }

  const fakeFs = {
    collection: function (c) { return collRef(c); },
    batch: function () {
      return {
        set: function (ref, data, opts) {
          writes.push({
            kind: 'set', docPath: ref.path, data: data,
            mergeFields: opts && opts.mergeFields ? Array.from(opts.mergeFields, String) : null
          });
        },
        delete: function (ref) { writes.push({ kind: 'delete', docPath: ref.path }); },
        commit: function () { return Promise.resolve(); }
      };
    }
  };

  const firebase = {
    firestore: Object.assign(function () { return fakeFs; }, {
      FieldValue: {
        increment: function (n) { return { __increment: n }; },
        serverTimestamp: function () { return { __serverTimestamp: true }; },
        delete: function () { return { __delete: true }; }
      },
      FieldPath: FakeFieldPath
    })
  };

  // Load the real module into a sandbox; grab the top-level `var MastDB`.
  const src = fs.readFileSync(path.join(__dirname, '../shared/mastdb.js'), 'utf8');
  const sandbox = { firebase: firebase, window: {}, console: console, Promise: Promise, setTimeout: setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const MastDB = sandbox.MastDB;
  MastDB.init({ firestore: fakeFs, tenantId: 't1' });

  return { MastDB: MastDB, writes: writes };
}

// Every '<field>.<path>' string Firestore receives, flattened across update()
// keys, varargs FieldPaths, and set() mergeFields.
function allFieldPaths(writes) {
  const out = [];
  writes.forEach(function (w) {
    if (w.kind === 'update') w.fields.forEach(function (f) { out.push(f.path); });
    if (w.kind === 'set' && w.mergeFields) w.mergeFields.forEach(function (p) { out.push(p); });
  });
  return out;
}

test('legacy slash-keyed MastDB.update leaks a "/" into the Firestore field path (the bug)', async () => {
  const h = makeHarness();
  await h.MastDB.update('admin/inventory/PID/stock', {
    '_default/committed': h.MastDB.serverIncrement(2)
  });
  const paths = allFieldPaths(h.writes);
  assert.ok(
    paths.some(function (p) { return p.indexOf('/') !== -1; }),
    'expected the pre-fix call to produce a "/"-bearing field path; got ' + JSON.stringify(paths)
  );
  assert.deepStrictEqual(paths, ['stock._default/committed']);
});

test('multiUpdate (the fix) translates slash paths to slash-free nested field updates', async () => {
  const h = makeHarness();
  await h.MastDB.multiUpdate({
    'admin/inventory/PID/stock/_default/committed': h.MastDB.serverIncrement(2),
    'admin/inventory/PID/stock/_default/onHand': h.MastDB.serverIncrement(-2),
    'admin/inventory/PID/stock/v_123/committed': h.MastDB.serverIncrement(2),
    'admin/inventory/PID/stock/v_123/onHand': h.MastDB.serverIncrement(-2)
  });

  const paths = allFieldPaths(h.writes);
  // The regression guard: NO field path may contain a '/'.
  paths.forEach(function (p) {
    assert.strictEqual(p.indexOf('/'), -1, 'field path must not contain "/": ' + p);
  });
  // All four leaves land as dot-joined nested field paths.
  assert.deepStrictEqual(paths.slice().sort(), [
    'stock._default.committed',
    'stock._default.onHand',
    'stock.v_123.committed',
    'stock.v_123.onHand'
  ]);
});

test('multiUpdate writes one doc carrying the atomic increments at the right leaves', async () => {
  const h = makeHarness();
  await h.MastDB.multiUpdate({
    'admin/inventory/PID/stock/_default/committed': h.MastDB.serverIncrement(3),
    'admin/inventory/PID/stock/v_123/onHand': h.MastDB.serverIncrement(-1)
  });

  const sets = h.writes.filter(function (w) { return w.kind === 'set'; });
  assert.strictEqual(sets.length, 1, 'both leaves on the same doc → a single batched set');
  assert.strictEqual(sets[0].docPath, 'tenants/t1/inventory/PID');
  // Increment sentinels survive translation and sit at the nested leaves.
  assert.deepStrictEqual(sets[0].data.stock._default.committed, { __increment: 3 });
  assert.deepStrictEqual(sets[0].data.stock.v_123.onHand, { __increment: -1 });
  // mergeFields scopes the write to exactly those leaves (siblings preserved).
  assert.deepStrictEqual(sets[0].mergeFields.slice().sort(), [
    'stock._default.committed',
    'stock.v_123.onHand'
  ]);
});
