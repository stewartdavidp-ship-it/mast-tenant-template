/**
 * Comprehensive unit tests for shared/mastdb.js — the tenant data-access engine
 * EVERY vertical reads/writes through. These exercise the real public API
 * (get / list / set / update / remove / push / multiUpdate / query / transaction)
 * plus the recurring path-translation footguns that have each caused a live bug.
 *
 * The two existing mastdb tests pin the WRITE-translation of nested field paths
 * (mastdb-fieldpath) and doc-scoped push (mastdb-push-fieldpath). This file
 * complements them from the READ side and pins the engine's load-bearing
 * contracts + the documented gotchas as regressions:
 *
 *   - get() returns the RAW doc data object, NOT an RTDB .val() snapshot
 *     (the #627 T-0001 counter bug: a `.val()` call silently defaulted).
 *   - transaction() is the atomic read-modify-write fix: fn(rawCurrent) → full
 *     next doc; resolves { committed, value }.
 *   - SINGLETON_COLLECTIONS trap: a 2-seg admin/<x> config doc MUST be registered
 *     or get/set/update silently break ("path requires doc ID"); writes must be a
 *     field-scoped create-or-merge set(), not update() (which rejects on a missing
 *     singleton doc).
 *   - 3-seg admin/<x>/<y> = ONE doc (collection admin_<x>, doc <y>), read with
 *     get() — list() scans the whole admin_<x> collection → phantom sibling rows.
 *   - the supported obj.sub(...) accessor shape (the path-string the app/index.html
 *     entity literals hand to set/push/remove).
 *   - multiUpdate sentinel survival + mixed full-replace/field-path batching.
 *
 * The fake Firestore below is a stateful in-memory store: it both RECORDS writes
 * (for translation assertions) and SERVES reads that reflect prior writes/seeds
 * (for round-trip + read-divergence assertions). It models the two Firestore
 * behaviours the gotchas hinge on: set({mergeFields}) replaces exactly the named
 * leaves (siblings preserved), and update() REJECTS on a non-existent doc.
 *
 * NOTE: MastDB.products / productionJobs / _makeEntity / sub / subRef are defined
 * in app/index.html, not shared/mastdb.js — so the "ref accessor" test pins the
 * engine-level path contract those literals rely on, not the literals themselves.
 *
 * Run: node test/mastdb-core.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Objects the engine builds (via _buildNestedSet / _nestFields / _translateFs)
// are created INSIDE the vm sandbox, so they carry the sandbox realm's
// Object.prototype and would trip assert.deepStrictEqual's prototype check
// against test-realm literals. JSON round-trip normalizes the prototype; our
// payloads are plain JSON (sentinels are plain marker objects), so nothing is
// lost. (Same trick as mastdb-push-fieldpath.test.js.)
function plain(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

// FieldValue sentinel markers — SAME shapes the sibling mastdb harnesses use, so
// detection is consistent: increment {__increment:n}, serverTimestamp
// {__serverTimestamp:true}, delete {__delete:true}.
function isDelete(v) { return !!(v && typeof v === 'object' && v.__delete === true); }
function isIncrement(v) { return !!(v && typeof v === 'object' && typeof v.__increment === 'number'); }
function isServerTs(v) { return !!(v && typeof v === 'object' && v.__serverTimestamp === true); }
function isMarker(v) { return isDelete(v) || isIncrement(v) || isServerTs(v); }

// --- Stateful fake Firestore -------------------------------------------------
// docs: Map<fullDocPath, dataObject>. Reads reflect writes/seeds. Writes are
// also pushed onto `writes` for translation assertions.
function makeHarness(seed) {
  const docs = new Map();
  const writes = [];
  let autoSeq = 0;

  function deepClone(x) {
    if (x == null || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(deepClone);
    const o = {};
    for (const k in x) if (Object.prototype.hasOwnProperty.call(x, k)) o[k] = deepClone(x[k]);
    return o;
  }
  function ensureDoc(p) { if (!docs.has(p)) docs.set(p, {}); return docs.get(p); }
  function getAt(obj, segs) {
    let cur = obj;
    for (let i = 0; i < segs.length && cur != null; i++) cur = cur[segs[i]];
    return cur;
  }
  // Apply a (possibly marker) leaf value at a dotted path, creating intermediate maps.
  function applyLeaf(target, segs, value) {
    let cur = target;
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i];
      if (!cur[s] || typeof cur[s] !== 'object' || Array.isArray(cur[s])) cur[s] = {};
      cur = cur[s];
    }
    const leaf = segs[segs.length - 1];
    if (isDelete(value)) { delete cur[leaf]; }
    else if (isIncrement(value)) { cur[leaf] = (typeof cur[leaf] === 'number' ? cur[leaf] : 0) + value.__increment; }
    else if (isServerTs(value)) { cur[leaf] = '__ServerTime__'; }
    else { cur[leaf] = deepClone(value); }
  }
  // Recursively merge `src` into `target`, honouring sentinel markers at leaves.
  function deepApply(target, src) {
    for (const k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      const v = src[k];
      if (isMarker(v)) { applyLeaf(target, [k], v); }
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
        deepApply(target[k], v);
      } else { target[k] = deepClone(v); }
    }
  }

  // Store mutation ONLY (no write-recording) — shared by docRef.set and the
  // deferred batch-commit op so a batched set is recorded exactly once.
  function applySet(p, data, opts) {
    const mergeFields = opts && opts.mergeFields ? Array.from(opts.mergeFields, String) : null;
    const merge = !!(opts && opts.merge);
    if (mergeFields) {
      const tgt = ensureDoc(p);
      mergeFields.forEach(function (fp) {
        const segs = fp.split('.');
        applyLeaf(tgt, segs, getAt(data, segs));
      });
    } else if (merge) {
      deepApply(ensureDoc(p), data);
    } else {
      docs.set(p, {});
      deepApply(docs.get(p), data);
    }
  }

  function docRef(p) {
    const id = p.slice(p.lastIndexOf('/') + 1);
    return {
      path: p,
      id: id,
      ref: { path: p },
      collection: function (c) { return collRef(p + '/' + c); },
      get: function () {
        const exists = docs.has(p);
        const data = exists ? docs.get(p) : undefined;
        return Promise.resolve({ exists: exists, id: id, ref: { path: p }, data: function () { return data; } });
      },
      set: function (data, opts) {
        const mergeFields = opts && opts.mergeFields ? Array.from(opts.mergeFields, String) : null;
        writes.push({ kind: 'set', docPath: p, data: data, mergeFields: mergeFields, merge: !!(opts && opts.merge) });
        applySet(p, data, opts);
        return Promise.resolve();
      },
      update: function () {
        // Object form update({...}) or varargs update(f1, v1, f2, v2, ...).
        const a = Array.prototype.slice.call(arguments);
        const fields = {};
        if (a.length === 1 && a[0] && typeof a[0] === 'object') {
          Object.keys(a[0]).forEach(function (k) { fields[k] = a[0][k]; });
        } else {
          for (let i = 0; i < a.length; i += 2) fields[String(a[i])] = a[i + 1];
        }
        writes.push({ kind: 'update', docPath: p, fields: fields });
        // Firestore update() REJECTS on a non-existent doc — the crux of the
        // singleton "use field-scoped set, not update" gotcha.
        if (!docs.has(p)) return Promise.reject(new Error('No document to update: ' + p));
        const tgt = docs.get(p);
        Object.keys(fields).forEach(function (k) { applyLeaf(tgt, k.split('.'), fields[k]); });
        return Promise.resolve();
      },
      delete: function () {
        writes.push({ kind: 'delete', docPath: p });
        docs.delete(p);
        return Promise.resolve();
      }
    };
  }

  function runQuery(collPath, spec) {
    const prefix = collPath + '/';
    const rows = [];
    docs.forEach(function (data, p) {
      if (p.indexOf(prefix) !== 0) return;
      if (p.slice(prefix.length).indexOf('/') !== -1) return; // direct children only
      rows.push({ id: p.slice(prefix.length), path: p, data: data });
    });
    let out = rows;
    if (spec.where) {
      out = out.filter(function (r) { return getAt(r.data, spec.where.field.split('.')) === spec.where.value; });
    }
    if (spec.orderByField || spec.orderByDocId) {
      out = out.slice().sort(function (a, b) {
        const av = spec.orderByDocId ? a.id : getAt(a.data, spec.orderByField.split('.'));
        const bv = spec.orderByDocId ? b.id : getAt(b.data, spec.orderByField.split('.'));
        if (av < bv) return -1; if (av > bv) return 1; return 0;
      });
    }
    if (spec.limit !== undefined) out = out.slice(0, spec.limit);
    if (spec.limitToLast !== undefined) out = out.slice(-spec.limitToLast);
    return out;
  }
  function snapshot(rows) {
    return {
      empty: rows.length === 0,
      size: rows.length,
      forEach: function (cb) { rows.forEach(function (r) { cb({ id: r.id, ref: { path: r.path }, data: function () { return r.data; } }); }); }
    };
  }
  function collRef(p, spec) {
    spec = spec || {};
    function extend(patch) {
      const next = {}; for (const k in spec) next[k] = spec[k]; for (const k2 in patch) next[k2] = patch[k2];
      return collRef(p, next);
    }
    return {
      path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('AUTOID' + (autoSeq++)))); },
      where: function (field, op, value) { return extend({ where: { field: field, value: value } }); },
      orderBy: function (field) {
        if (field && field.__documentId) return extend({ orderByDocId: true });
        return extend({ orderByField: field });
      },
      limit: function (n) { return extend({ limit: n }); },
      limitToLast: function (n) { return extend({ limitToLast: n }); },
      startAt: function () { return extend({}); },
      startAfter: function () { return extend({}); },
      endAt: function () { return extend({}); },
      endBefore: function () { return extend({}); },
      get: function () { return Promise.resolve(snapshot(runQuery(p, spec))); }
    };
  }

  const fakeFs = {
    collection: function (c) { return collRef(c); },
    batch: function () {
      const ops = [];
      return {
        set: function (ref, data, opts) {
          const mergeFields = opts && opts.mergeFields ? Array.from(opts.mergeFields, String) : null;
          writes.push({ kind: 'set', docPath: ref.path, data: data, mergeFields: mergeFields, merge: !!(opts && opts.merge) });
          ops.push(function () { applySet(ref.path, data, opts); }); // apply only — recorded above
        },
        delete: function (ref) {
          writes.push({ kind: 'delete', docPath: ref.path });
          ops.push(function () { docs.delete(ref.path); });
        },
        commit: function () { ops.forEach(function (op) { op(); }); return Promise.resolve(); }
      };
    },
    runTransaction: function (fn) {
      const tx = {
        get: function (ref) { return ref.get(); },
        set: function (ref, data) { return ref.set(data); }
      };
      return Promise.resolve().then(function () { return fn(tx); });
    }
  };

  function FakeFieldPath() { this.segments = Array.prototype.slice.call(arguments); }
  FakeFieldPath.documentId = function () { return { __documentId: true }; };

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

  if (seed) for (const k in seed) if (Object.prototype.hasOwnProperty.call(seed, k)) docs.set(k, deepClone(seed[k]));

  return {
    MastDB: MastDB,
    writes: writes,
    sets: function () { return writes.filter(function (w) { return w.kind === 'set'; }); },
    seed: function (p, d) { docs.set(p, deepClone(d)); },
    read: function (p) { return docs.has(p) ? docs.get(p) : null; },
    has: function (p) { return docs.has(p); },
    docPaths: function () { return Array.from(docs.keys()); }
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A. get() — returns RAW doc data, NOT an RTDB .val() snapshot (#627 regression)
// ════════════════════════════════════════════════════════════════════════════

test('get(docPath) resolves to the raw data object directly; fields read straight off it', async () => {
  const h = makeHarness({ 'tenants/t1/config/ticketCounter': { prefix: 'T', nextNumber: 2 } });
  const data = await h.MastDB.get('config/ticketCounter');
  assert.deepStrictEqual(plain(data), { prefix: 'T', nextNumber: 2 });
  // The exact read the counter code needs — straight off the result, no snapshot.
  assert.strictEqual(data.nextNumber, 2);
  assert.strictEqual(data.prefix, 'T');
});

test('get result has NO .val() — the (snap && snap.val && snap.val()) pattern silently defaults (#627 footgun)', async () => {
  const h = makeHarness({ 'tenants/t1/config/ticketCounter': { prefix: 'T', nextNumber: 7 } });
  const snap = await h.MastDB.get('config/ticketCounter');
  // .val is undefined on the data object → the guarded legacy read short-circuits…
  assert.strictEqual(typeof snap.val, 'undefined');
  const legacyRead = (snap && snap.val && snap.val()) || {};
  assert.deepStrictEqual(plain(legacyRead), {}, 'the .val() pattern yields {} → counter resets to nextNumber=1 (the bug)');
  // …whereas the SUPPORTED ref-compat path .once("value") DOES carry .val().
  const compat = await h.MastDB.get('config/ticketCounter').once('value');
  assert.strictEqual(typeof compat.val, 'function');
  assert.strictEqual(compat.val().nextNumber, 7);
});

test('get(missingDoc) resolves to null; get(field subpath) digs the nested value', async () => {
  const h = makeHarness({ 'tenants/t1/config/brand': { colors: { primary: '#0a0' }, name: 'Studio' } });
  assert.strictEqual(await h.MastDB.get('config/doesNotExist'), null);
  assert.strictEqual(await h.MastDB.get('config/brand/name'), 'Studio');
  assert.strictEqual(await h.MastDB.get('config/brand/colors/primary'), '#0a0');
  // A field that isn't present digs to null (not undefined).
  assert.strictEqual(await h.MastDB.get('config/brand/colors/secondary'), null);
});

test('get round-trips a scalar through the {_v} wrap (set primitive → get primitive)', async () => {
  const h = makeHarness();
  await h.MastDB.set('config/featureFlag', true);
  assert.deepStrictEqual(plain(h.read('tenants/t1/config/featureFlag')), { _v: true }, 'scalar stored under _v');
  assert.strictEqual(await h.MastDB.get('config/featureFlag'), true, 'get unwraps _v back to the scalar');
});

// ════════════════════════════════════════════════════════════════════════════
// B. set / update / remove — happy paths + the write semantics
// ════════════════════════════════════════════════════════════════════════════

test('set(docPath, obj) writes a full-doc replace (no mergeFields)', async () => {
  const h = makeHarness();
  await h.MastDB.set('public/products/P1', { title: 'Vase', price: 40 });
  const s = h.sets();
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].docPath, 'tenants/t1/products/P1');
  assert.strictEqual(s[0].mergeFields, null, 'whole-doc set is not a scoped merge');
  assert.deepStrictEqual(plain(h.read('tenants/t1/products/P1')), { title: 'Vase', price: 40 });
});

test('set(fieldPath) is a field-scoped create-or-merge (mergeFields:[fieldPath], nested payload)', async () => {
  const h = makeHarness({ 'tenants/t1/products/P1': { title: 'Vase', price: 40 } });
  await h.MastDB.set('public/products/P1/price', 55);
  const s = h.sets();
  assert.strictEqual(s[0].docPath, 'tenants/t1/products/P1');
  assert.deepStrictEqual(s[0].mergeFields, ['price']);
  assert.deepStrictEqual(plain(s[0].data), { price: 55 });
  // Sibling field preserved (RTDB ref.set() subtree semantics, not a clobber).
  assert.deepStrictEqual(plain(h.read('tenants/t1/products/P1')), { title: 'Vase', price: 55 });
});

test('update(docPath, partial) updates top-level keys; update(fieldPath, partial) dot-prefixes them (no "/")', async () => {
  const h = makeHarness({ 'tenants/t1/inventory/PID': { name: 'Mug', stock: { committed: 0, onHand: 5 } } });
  await h.MastDB.update('admin/inventory/PID', { name: 'Mug v2' });
  const u1 = h.writes.filter(function (w) { return w.kind === 'update'; })[0];
  assert.deepStrictEqual(Object.keys(u1.fields), ['name']);

  await h.MastDB.update('admin/inventory/PID/stock', {
    committed: h.MastDB.serverIncrement(2),
    onHand: h.MastDB.serverIncrement(-2)
  });
  const u2 = h.writes.filter(function (w) { return w.kind === 'update'; })[1];
  const keys = Object.keys(u2.fields).sort();
  assert.deepStrictEqual(keys, ['stock.committed', 'stock.onHand'], 'fieldPath prefix is dot-joined');
  keys.forEach(function (k) { assert.strictEqual(k.indexOf('/'), -1, 'no "/" in a Firestore field path: ' + k); });
  assert.ok(isIncrement(u2.fields['stock.committed']), 'atomic increment sentinel survives');
  // The increments applied: 0+2 and 5-2.
  assert.deepStrictEqual(plain(h.read('tenants/t1/inventory/PID').stock), { committed: 2, onHand: 3 });
});

test('remove(docPath) deletes the doc; remove(fieldPath) issues FieldValue.delete; remove(collection) batch-deletes all', async () => {
  const h = makeHarness({
    'tenants/t1/products/P1': { title: 'A' },
    'tenants/t1/products/P2': { title: 'B', meta: { archived: false } }
  });
  await h.MastDB.remove('public/products/P1');
  assert.strictEqual(h.has('tenants/t1/products/P1'), false, 'doc deleted');

  await h.MastDB.remove('public/products/P2/meta');
  const fieldDel = h.writes.filter(function (w) { return w.kind === 'update'; }).pop();
  assert.ok(isDelete(fieldDel.fields['meta']), 'field removal is a FieldValue.delete on the field path');
  assert.strictEqual('meta' in h.read('tenants/t1/products/P2'), false, 'field gone, doc kept');

  // Collection-level remove scans the collection and batch-deletes every doc.
  h.seed('tenants/t1/products/P3', { title: 'C' });
  await h.MastDB.remove('public/products');
  assert.deepStrictEqual(h.docPaths().filter(function (p) { return p.indexOf('tenants/t1/products/') === 0; }), [],
    'collection emptied');
});

// ════════════════════════════════════════════════════════════════════════════
// C. transaction() — atomic read-modify-write (the CORRECT #627 fix)
// ════════════════════════════════════════════════════════════════════════════

test('transaction: fn receives the RAW current doc and returns the full next doc; resolves {committed,value}', async () => {
  const h = makeHarness({ 'tenants/t1/config/ticketCounter': { prefix: 'T', nextNumber: 2 } });
  let seenCurrent = null;
  const res = await h.MastDB.transaction('config/ticketCounter', function (current) {
    seenCurrent = current;
    // Copy existing fields forward (tx.set REPLACES) + bump the counter.
    return { prefix: current.prefix, nextNumber: current.nextNumber + 1 };
  });
  // fn saw the real data (the .val() bug handed it {} here).
  assert.deepStrictEqual(plain(seenCurrent), { prefix: 'T', nextNumber: 2 });
  assert.strictEqual(res.committed, true);
  assert.deepStrictEqual(plain(res.value), { prefix: 'T', nextNumber: 3 });
  // The allocated number is value.nextNumber - 1 === 2 (NOT a duplicate 1).
  assert.strictEqual(res.value.nextNumber - 1, 2);
  // Store reflects the committed write.
  assert.deepStrictEqual(plain(h.read('tenants/t1/config/ticketCounter')), { prefix: 'T', nextNumber: 3 });
});

test('transaction: missing doc → fn(null) seeds the initial doc', async () => {
  const h = makeHarness();
  let arg = 'unset';
  const res = await h.MastDB.transaction('config/ticketCounter', function (current) {
    arg = current;
    return { prefix: 'T', nextNumber: 1 };
  });
  assert.strictEqual(arg, null, 'fn receives null for a non-existent doc');
  assert.strictEqual(res.committed, true);
  assert.deepStrictEqual(plain(h.read('tenants/t1/config/ticketCounter')), { prefix: 'T', nextNumber: 1 });
});

test('transaction: fn returning undefined ABORTS — {committed:false}, store unchanged', async () => {
  const h = makeHarness({ 'tenants/t1/config/ticketCounter': { prefix: 'T', nextNumber: 9 } });
  const res = await h.MastDB.transaction('config/ticketCounter', function () { return undefined; });
  assert.strictEqual(res.committed, false);
  assert.deepStrictEqual(plain(res.value), { prefix: 'T', nextNumber: 9 }, 'value is the unchanged current');
  assert.deepStrictEqual(plain(h.read('tenants/t1/config/ticketCounter')), { prefix: 'T', nextNumber: 9 });
});

test('transaction: returning a scalar wraps it under {_v}', async () => {
  const h = makeHarness();
  const res = await h.MastDB.transaction('config/seq', function () { return 42; });
  assert.strictEqual(res.committed, true);
  assert.strictEqual(res.value, 42);
  assert.deepStrictEqual(plain(h.read('tenants/t1/config/seq')), { _v: 42 });
});

// ════════════════════════════════════════════════════════════════════════════
// D. multiUpdate — nested field paths, sentinels, mixed full-replace/field batches
// ════════════════════════════════════════════════════════════════════════════

test('multiUpdate: a full-doc-replace key + a nested fieldPath key on the SAME doc → one batched set', async () => {
  const h = makeHarness();
  await h.MastDB.multiUpdate({
    'admin/inventory/PID': { name: 'Mug', sku: 'M-1' },            // full-replace (docId, no fieldPath)
    'admin/inventory/PID/stock/_default/onHand': h.MastDB.serverIncrement(5) // nested fieldPath leaf
  });
  const sets = h.sets();
  assert.strictEqual(sets.length, 1, 'both target one doc → a single batched set');
  assert.strictEqual(sets[0].docPath, 'tenants/t1/inventory/PID');
  // mergeFields lists both the full-replace top keys AND the nested leaf — so untouched siblings survive.
  assert.deepStrictEqual(sets[0].mergeFields.slice().sort(), ['name', 'sku', 'stock._default.onHand']);
  assert.deepStrictEqual(plain(sets[0].data.name), 'Mug');
  assert.ok(isIncrement(sets[0].data.stock._default.onHand), 'increment sentinel sits at the nested leaf');
});

test('multiUpdate: a null value batch-deletes that doc', async () => {
  const h = makeHarness({ 'tenants/t1/orders/O1': { total: 10 }, 'tenants/t1/orders/O2': { total: 20 } });
  await h.MastDB.multiUpdate({
    'orders/O1': null,
    'orders/O2/status': 'paid'
  });
  assert.ok(h.writes.some(function (w) { return w.kind === 'delete' && w.docPath === 'tenants/t1/orders/O1'; }), 'O1 deleted');
  assert.strictEqual(h.has('tenants/t1/orders/O1'), false);
  assert.strictEqual(h.read('tenants/t1/orders/O2').status, 'paid');
});

test('multiUpdate: serverTimestamp + serverIncrement sentinels survive into the nested leaves', async () => {
  const h = makeHarness();
  await h.MastDB.multiUpdate({
    'admin/inventory/PID/stock/_default/committed': h.MastDB.serverIncrement(3),
    'admin/inventory/PID/audit/lastTouchedAt': h.MastDB.serverTimestamp()
  });
  const set = h.sets()[0];
  assert.ok(isIncrement(set.data.stock._default.committed));
  assert.ok(isServerTs(set.data.audit.lastTouchedAt));
  // No field path may contain a "/".
  set.mergeFields.forEach(function (p) { assert.strictEqual(p.indexOf('/'), -1, p); });
});

test('multiUpdate: a collection-level path (no docId) is silently skipped; two docs → two sets', async () => {
  const h = makeHarness();
  await h.MastDB.multiUpdate({
    'admin/inventory': { junk: true },          // no docId → skipped
    'orders/O1/status': 'paid',
    'orders/O2/status': 'shipped'
  });
  const sets = h.sets();
  const paths = sets.map(function (s) { return s.docPath; }).sort();
  assert.deepStrictEqual(paths, ['tenants/t1/orders/O1', 'tenants/t1/orders/O2']);
  assert.ok(!paths.some(function (p) { return p.indexOf('/inventory') !== -1; }), 'no-docId path produced no write');
});

test('CHARACTERIZATION: set(path, null) writes {_v:null} (no delete) — multiUpdate({path:null}) deletes (the engine disagrees with itself)', async () => {
  // Surfaced while writing these tests. set() and multiUpdate() handle a null
  // value OPPOSITELY: set wraps it as {_v:null} (the doc survives — a reader sees
  // get()→null because _unwrapV unwraps {_v:null}, but the doc is NOT removed),
  // whereas multiUpdate batch-deletes the doc. A caller migrating from RTDB —
  // where set(ref, null) DELETES — silently leaves a {_v:null} tombstone. This
  // pins the current behaviour so a future reconciliation of the two is caught.
  const hSet = makeHarness();
  await hSet.MastDB.set('config/x', null);
  assert.strictEqual(hSet.has('tenants/t1/config/x'), true, 'set(null) does NOT delete — doc survives');
  assert.deepStrictEqual(plain(hSet.read('tenants/t1/config/x')), { _v: null }, 'stored as a {_v:null} tombstone');
  assert.strictEqual(await hSet.MastDB.get('config/x'), null, 'yet get() reads null (unwrapped) — looks absent');

  const hMulti = makeHarness({ 'tenants/t1/config/x': { a: 1 } });
  await hMulti.MastDB.multiUpdate({ 'config/x': null });
  assert.strictEqual(hMulti.has('tenants/t1/config/x'), false, 'multiUpdate(null) DELETES the doc — the opposite');
});

// ════════════════════════════════════════════════════════════════════════════
// E. SINGLETON_COLLECTIONS trap — registered vs unregistered admin/<x> config doc
// ════════════════════════════════════════════════════════════════════════════

test('REGISTERED singleton (admin/subscription, admin/walletConfig): resolves to admin_<x>/_data', async () => {
  const h = makeHarness({ 'tenants/t1/admin_subscription/_data': { plan: 'pro', seats: 3 } });
  // get reads the single config doc (NOT a collection).
  assert.deepStrictEqual(plain(await h.MastDB.get('admin/subscription')), { plan: 'pro', seats: 3 });

  // Field-scoped set on a registered singleton create-or-merges the _data doc.
  await h.MastDB.set('admin/walletConfig/giftCardEnabled', true);
  const s = h.sets()[0];
  assert.strictEqual(s.docPath, 'tenants/t1/admin_walletConfig/_data', 'writes land on the _data singleton doc');
  assert.deepStrictEqual(s.mergeFields, ['giftCardEnabled']);
  assert.strictEqual(await h.MastDB.get('admin/walletConfig/giftCardEnabled'), true);
});

test('UNREGISTERED singleton (admin/fooConfig): set/update THROW "path requires doc ID"; get returns a collection map (silent break)', async () => {
  // A doc seeded under the (wrongly-inferred) collection — what an unregistered
  // singleton actually addresses.
  const h = makeHarness({ 'tenants/t1/admin_fooConfig/someChild': { x: 1 } });

  // set/update on a 2-seg unregistered admin path resolve to a COLLECTION (docId
  // null) → _docRef throws SYNCHRONOUSLY (most call sites swallow it in .catch).
  assert.throws(function () { h.MastDB.set('admin/fooConfig', { enabled: true }); },
    /path requires doc ID: admin_fooConfig/);
  assert.throws(function () { h.MastDB.update('admin/fooConfig', { enabled: true }); },
    /path requires doc ID: admin_fooConfig/);

  // get does NOT throw — it lists the collection, so consumers read a doc-map
  // where they expect a config blob: every config field comes back undefined.
  const got = await h.MastDB.get('admin/fooConfig');
  assert.deepStrictEqual(Object.keys(got), ['someChild'], 'a collection map, not the config doc');
  assert.strictEqual(got.enabled, undefined, 'reading a config field off the map silently yields undefined');
});

test('singleton write MUST be a field-scoped set, NOT update(): update() rejects on the not-yet-existing _data doc', async () => {
  // admin_walletConfig is registered, but its _data doc does not exist yet.
  const h = makeHarness();
  // The WRONG fix — whole-doc update() — rejects ("No document to update").
  await assert.rejects(function () { return h.MastDB.update('admin/walletConfig', { giftCardEnabled: true }); },
    /No document to update/);
  // The RIGHT fix — field-scoped create-or-merge set() — succeeds and creates the doc.
  await h.MastDB.set('admin/walletConfig/giftCardEnabled', true);
  await h.MastDB.set('admin/walletConfig/loyaltyEnabled', false);
  assert.strictEqual(await h.MastDB.get('admin/walletConfig/giftCardEnabled'), true);
  assert.strictEqual(await h.MastDB.get('admin/walletConfig/loyaltyEnabled'), false, 'sibling preserved across create-or-merge');
});

// ════════════════════════════════════════════════════════════════════════════
// F. 3-seg admin/<x>/<y> = ONE doc (collection admin_<x>, doc <y>), not a collection
// ════════════════════════════════════════════════════════════════════════════

test('3-seg admin path resolves to ONE doc: get reads the field-map; a per-item write lands as a FIELD on that doc', async () => {
  const h = makeHarness({
    'tenants/t1/admin_lpe/equipment': { EQ1: { name: 'Kiln', cost: 5000 } }
  });
  // get('admin/lpe/equipment') = the single doc admin_lpe/equipment (a {id: item} map).
  const equip = await h.MastDB.get('admin/lpe/equipment');
  assert.deepStrictEqual(plain(equip), { EQ1: { name: 'Kiln', cost: 5000 } });

  // Writing item EQ2 targets a FIELD on that same doc (field-scoped merge), not a new doc.
  await h.MastDB.set('admin/lpe/equipment/EQ2', { name: 'Torch', cost: 800 });
  const s = h.sets()[0];
  assert.strictEqual(s.docPath, 'tenants/t1/admin_lpe/equipment');
  assert.deepStrictEqual(s.mergeFields, ['EQ2']);
  assert.deepStrictEqual(plain(await h.MastDB.get('admin/lpe/equipment')), {
    EQ1: { name: 'Kiln', cost: 5000 }, EQ2: { name: 'Torch', cost: 800 }
  });
});

test('list() on a 3-seg admin path scans the WHOLE admin_<x> collection → phantom sibling rows (the footgun get() avoids)', async () => {
  // admin_lpe holds sibling container docs: equipment, founders, laborProfile.
  const h = makeHarness({
    'tenants/t1/admin_lpe/equipment': { EQ1: { name: 'Kiln' } },
    'tenants/t1/admin_lpe/founders': { F1: { name: 'Dana' } },
    'tenants/t1/admin_lpe/laborProfile': { rate: 25 }
  });
  // list ignores the docId and returns EVERY sibling doc as a row — founders &
  // laborProfile are phantom "rows" that per-item field writes can never touch.
  const listed = await h.MastDB.list('admin/lpe/equipment');
  assert.deepStrictEqual(Object.keys(listed).sort(), ['equipment', 'founders', 'laborProfile'],
    'list scanned the collection, surfacing phantom siblings');
  // get() returns ONLY the equipment doc's items — the correct read.
  const got = await h.MastDB.get('admin/lpe/equipment');
  assert.deepStrictEqual(Object.keys(got), ['EQ1']);
});

// ════════════════════════════════════════════════════════════════════════════
// G. ref accessors — the supported obj.sub(...) path-string shape
//    (sub/subRef live in app/index.html; this pins the engine contract behind them)
// ════════════════════════════════════════════════════════════════════════════

test('supported accessor shape: set/push/remove(obj.sub(...)) — a path STRING — drives correct doc-scoped writes', async () => {
  const h = makeHarness();
  // What MastDB.productionJobs.sub(jobId, 'milestones') returns in app/index.html:
  // a path STRING 'admin/jobs/<id>/milestones' (NOT a Firebase ref). The literals
  // expose sub() but NOT subRef()/<field>Ref() — call sites must route the STRING
  // through MastDB.set/push/remove. This pins that the engine handles that shape.
  const sub = function (jobId, field) { return 'admin/jobs/' + jobId + '/' + field; };

  // push(obj.sub(...)) → doc-scoped keyed-map append on admin_jobs/<id>.
  const res = await h.MastDB.push(sub('J1', 'milestones'), { label: 'Glaze', done: false });
  const s = h.sets()[0];
  assert.strictEqual(s.docPath, 'tenants/t1/admin_jobs/J1', 'append lands on the job doc, not a stray sibling');
  assert.deepStrictEqual(s.mergeFields, ['milestones.' + res.key]);
  // Retrievable back under its key (proves it is not black-holed).
  const milestones = await h.MastDB.get(sub('J1', 'milestones'));
  assert.deepStrictEqual(plain(milestones[res.key]), { label: 'Glaze', done: false });

  // remove(obj.sub(...)) on a leaf field → FieldValue.delete on that nested field.
  await h.MastDB.remove('admin/jobs/J1/milestones/' + res.key);
  const del = h.writes.filter(function (w) { return w.kind === 'update'; }).pop();
  assert.ok(isDelete(del.fields['milestones.' + res.key]), 'leaf removal is a scoped FieldValue.delete');
});

// ════════════════════════════════════════════════════════════════════════════
// H. query / list — filtering, ordering, the .once() path through _fsGet
// ════════════════════════════════════════════════════════════════════════════

test('query().orderByChild(f).equalTo(v).once() filters via where(==) and returns a .val()-wrapped map', async () => {
  const h = makeHarness({
    'tenants/t1/orders/O1': { status: 'open', total: 10 },
    'tenants/t1/orders/O2': { status: 'paid', total: 20 },
    'tenants/t1/orders/O3': { status: 'open', total: 30 }
  });
  const snap = await h.MastDB.query('orders').orderByChild('status').equalTo('open').once();
  // Wrapped result still has .val() for legacy callers AND is directly indexable.
  assert.strictEqual(typeof snap.val, 'function');
  const map = snap.val();
  assert.deepStrictEqual(Object.keys(map).sort(), ['O1', 'O3'], 'only matching docs');
  assert.strictEqual(map.O1.total, 10);
});

test('query().orderByChild(f).limitToLast(n).once() orders ascending and takes the last n', async () => {
  const h = makeHarness({
    'tenants/t1/orders/O1': { createdAt: 100 },
    'tenants/t1/orders/O2': { createdAt: 300 },
    'tenants/t1/orders/O3': { createdAt: 200 }
  });
  const snap = await h.MastDB.query('orders').orderByChild('createdAt').limitToLast(2).once();
  const map = snap.val();
  // Last 2 by ascending createdAt = the 200 and 300 docs (O3, O2).
  assert.deepStrictEqual(Object.keys(map).sort(), ['O2', 'O3']);
  assert.strictEqual(map.O1, undefined, 'the oldest (100) is dropped');
});

test('list() returns the full collection map; {limit} bounds it; {shallow:true} yields true values', async () => {
  const h = makeHarness({
    'tenants/t1/contacts/C1': { name: 'A' },
    'tenants/t1/contacts/C2': { name: 'B' }
  });
  assert.deepStrictEqual(Object.keys(await h.MastDB.list('admin/contacts')).sort(), ['C1', 'C2']);
  assert.strictEqual(Object.keys(await h.MastDB.list('admin/contacts', { limit: 1 })).length, 1);
  const shallow = await h.MastDB.list('admin/contacts', { shallow: true });
  assert.strictEqual(shallow.C1, true, 'shallow returns true sentinels, not the doc body');
});

// ════════════════════════════════════════════════════════════════════════════
// I. push — canonical keyed-map append; collection vs doc-scoped; #625 read-back
// ════════════════════════════════════════════════════════════════════════════

test('collection-level push mints a fresh auto-id doc; doc-scoped push is retrievable under its key (NOT black-holed) — #625', async () => {
  const h = makeHarness();
  // Collection push (no docId): a new top-level doc in the mapped collection.
  const c = await h.MastDB.push('admin/jobs', { title: 'Commission' });
  assert.strictEqual(h.has('tenants/t1/admin_jobs/' + c.key), true, 'collection push created a top-level doc');

  // Doc-scoped push (3+ seg): keyed-map append on the TARGET doc — and crucially,
  // a follow-up get() of the parent field returns the entry (the #625 read side).
  const a = await h.MastDB.push('admin/inventory/PID/history', { action: 'committed', qty: 2 });
  const b = await h.MastDB.push('admin/inventory/PID/history', { action: 'released', qty: -2 });
  assert.notStrictEqual(a.key, b.key, 'distinct keys → concurrent appends never clobber');
  // No stray sibling doc was minted in the inventory collection.
  assert.deepStrictEqual(
    h.docPaths().filter(function (p) { return p.indexOf('tenants/t1/inventory/') === 0; }),
    ['tenants/t1/inventory/PID'],
    'exactly one product doc — push did NOT black-hole into a sibling'
  );
  const history = await h.MastDB.get('admin/inventory/PID/history');
  assert.deepStrictEqual(plain(history[a.key]), { action: 'committed', qty: 2 });
  assert.deepStrictEqual(plain(history[b.key]), { action: 'released', qty: -2 });
});

test('newKey() returns a fresh id without writing anything', async () => {
  const h = makeHarness();
  const k1 = h.MastDB.newKey('admin/jobs');
  const k2 = h.MastDB.newKey('admin/jobs');
  assert.ok(k1 && k2 && k1 !== k2, 'distinct keys');
  assert.strictEqual(h.writes.length, 0, 'newKey is read-only — no writes');
});
