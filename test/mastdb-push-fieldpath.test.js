/**
 * Regression test for MastDB.push on doc-scoped ("subcollection") paths.
 *
 * Context: MastDB.push(path) used to resolve `path` and then ALWAYS write to
 * _collRef(parsed).doc() — a fresh auto-id doc in the top-level mapped collection
 * — ignoring parsed.docId and parsed.fieldPath. So any push to a 3+ segment path
 * black-holed: push('admin/inventory/{pid}/history', e) wrote `e` as a stray
 * sibling doc in the `inventory` collection instead of appending it under the
 * product doc's `history` field. The per-product history was never retrievable,
 * and the stray docs polluted the collection. The same gap hit every doc-scoped
 * push (production builds, commission documents, wallet credits, …).
 *
 * The fix: a doc-scoped push (parsed.docId set) mints an auto key and appends the
 * value as a new keyed entry in the doc's (possibly nested) map field —
 * `set(_buildNestedSet(fieldPath + '.' + key, value), {mergeFields:[leaf]})` —
 * which is exactly the canonical newKey()+set('parent/{key}', value) pattern the
 * rest of the app uses. Collection-level pushes (no docId, e.g. 'admin/jobs')
 * keep minting a fresh top-level doc.
 *
 * This pins both: (1) collection push still creates a top-level doc, and
 * (2) doc-scoped push writes a keyed leaf on the TARGET doc (never a sibling),
 * with a slash-free merge field, returning the leaf key — and is byte-for-byte
 * equivalent to the canonical newKey()+set('parent/{key}', value) path.
 *
 * Run: node test/mastdb-push-fieldpath.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- Minimal fake Firestore that records writes and the keys/field paths used. ---
function makeHarness() {
  const writes = []; // { kind, docPath, data, mergeFields }
  let autoSeq = 0;

  function docRef(p, id) {
    return {
      path: p,
      id: id,
      collection: function (c) { return collRef(p + '/' + c); },
      set: function (data, opts) {
        writes.push({
          kind: 'set', docPath: p, data: data,
          mergeFields: opts && opts.mergeFields ? Array.from(opts.mergeFields, String) : null
        });
        return Promise.resolve();
      },
      update: function (partial) {
        writes.push({ kind: 'update', docPath: p, data: partial });
        return Promise.resolve();
      }
    };
  }
  function collRef(p) {
    return {
      // .doc() with no id mints a deterministic, unique auto id (AUTOID0, AUTOID1…)
      // so each push in a test gets a distinct key, mirroring Firestore.
      doc: function (id) {
        var realId = id || ('AUTOID' + (autoSeq++));
        return docRef(p + '/' + realId, realId);
      }
    };
  }

  function FakeFieldPath() { this.segments = Array.prototype.slice.call(arguments); }

  const fakeFs = {
    collection: function (c) { return collRef(c); },
    batch: function () {
      return {
        set: function () {}, delete: function () {},
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

  const src = fs.readFileSync(path.join(__dirname, '../shared/mastdb.js'), 'utf8');
  const sandbox = { firebase: firebase, window: {}, console: console, Promise: Promise, setTimeout: setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const MastDB = sandbox.MastDB;
  MastDB.init({ firestore: fakeFs, tenantId: 't1' });

  return { MastDB: MastDB, writes: writes };
}

// The fix builds the merged payload (via _buildNestedSet) inside the vm sandbox,
// so those objects carry the sandbox realm's Object.prototype and would trip
// assert.deepStrictEqual's prototype check against test-realm literals. The
// pushed values are plain JSON (no FieldValue sentinels), so round-tripping
// normalizes the prototype without losing anything. mergeFields/keys are already
// plain strings produced in the test realm and need no normalization.
function plain(x) { return JSON.parse(JSON.stringify(x)); }

test('collection-level push still mints a fresh top-level doc (unchanged)', async () => {
  const h = makeHarness();
  const res = await h.MastDB.push('admin/jobs', { title: 'Vase commission' });

  const sets = h.writes.filter(function (w) { return w.kind === 'set'; });
  assert.strictEqual(sets.length, 1);
  // A brand-new auto-id doc in the mapped collection — NOT a merge into an existing doc.
  assert.strictEqual(sets[0].docPath, 'tenants/t1/admin_jobs/AUTOID0');
  assert.strictEqual(sets[0].mergeFields, null, 'collection push is a full-doc set, not a scoped merge');
  assert.deepStrictEqual(plain(sets[0].data), { title: 'Vase commission' });
  assert.strictEqual(res.key, 'AUTOID0');
});

test('doc-scoped push appends a keyed entry to the TARGET doc, not a sibling (the bug)', async () => {
  const h = makeHarness();
  const entry = { action: 'committed', reason: 'order_placed', qty: 2 };
  const res = await h.MastDB.push('admin/inventory/PID/history', entry);

  const sets = h.writes.filter(function (w) { return w.kind === 'set'; });
  assert.strictEqual(sets.length, 1);
  // Regression guard: the write lands on the PRODUCT doc, never a stray sibling
  // doc like tenants/t1/inventory/AUTOID0.
  assert.strictEqual(sets[0].docPath, 'tenants/t1/inventory/PID');

  // One scoped merge leaf, slash-free, prefixed by the resolved field path, keyed
  // by the returned auto key.
  assert.deepStrictEqual(sets[0].mergeFields, ['history.' + res.key]);
  assert.strictEqual(sets[0].mergeFields[0].indexOf('/'), -1, 'field path must not contain "/"');
  assert.ok(res.key && typeof res.key === 'string', 'push returns the new entry key');

  // The value sits at history.<key> in the merged payload.
  assert.deepStrictEqual(plain(sets[0].data), { history: { [res.key]: entry } });
});

test('doc-scoped push to a NESTED field path keys into the nested map (wallet credits)', async () => {
  const h = makeHarness();
  const credit = { amountCents: 1500, source: 'cancellation', status: 'active' };
  const res = await h.MastDB.push('public/accounts/STU/wallet/credits', credit);

  const sets = h.writes.filter(function (w) { return w.kind === 'set'; });
  assert.strictEqual(sets.length, 1);
  assert.strictEqual(sets[0].docPath, 'tenants/t1/accounts/STU');
  assert.deepStrictEqual(sets[0].mergeFields, ['wallet.credits.' + res.key]);
  assert.deepStrictEqual(plain(sets[0].data), { wallet: { credits: { [res.key]: credit } } });
});

test('push is equivalent to the canonical newKey() + set(parent/{key}, value) pattern', async () => {
  // push('parent', v) must produce the SAME write as the pattern used elsewhere
  // in the app: const k = newKey('parent'); set('parent/' + k, v).
  const hPush = makeHarness();
  const entry = { action: 'shipped', qty: -1 };
  const res = await hPush.MastDB.push('admin/inventory/PID/history', entry);
  const pushSet = hPush.writes.filter(function (w) { return w.kind === 'set'; })[0];

  const hSet = makeHarness();
  await hSet.MastDB.set('admin/inventory/PID/history/' + res.key, entry);
  const canonicalSet = hSet.writes.filter(function (w) { return w.kind === 'set'; })[0];

  assert.strictEqual(pushSet.docPath, canonicalSet.docPath);
  assert.deepStrictEqual(pushSet.mergeFields, canonicalSet.mergeFields);
  assert.deepStrictEqual(plain(pushSet.data), plain(canonicalSet.data));
});

test('doc-scoped push with no field path keys onto the doc root (RTDB push-under-node)', async () => {
  const h = makeHarness();
  const trip = { driverId: 'STU', status: 'open' };
  const res = await h.MastDB.push('trips/STU', trip);

  const sets = h.writes.filter(function (w) { return w.kind === 'set'; });
  assert.strictEqual(sets.length, 1);
  assert.strictEqual(sets[0].docPath, 'tenants/t1/trips/STU');
  assert.deepStrictEqual(sets[0].mergeFields, [res.key]);
  assert.deepStrictEqual(plain(sets[0].data), { [res.key]: trip });
});

test('each push to the same field targets a distinct key (concurrent appends never clobber)', async () => {
  const h = makeHarness();
  const a = await h.MastDB.push('admin/inventory/PID/history', { action: 'committed' });
  const b = await h.MastDB.push('admin/inventory/PID/history', { action: 'released' });
  assert.notStrictEqual(a.key, b.key);
  const sets = h.writes.filter(function (w) { return w.kind === 'set'; });
  assert.deepStrictEqual(sets[0].mergeFields, ['history.' + a.key]);
  assert.deepStrictEqual(sets[1].mergeFields, ['history.' + b.key]);
});
