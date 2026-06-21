/**
 * Diagnostics L2 — slow-read timing on MastDB._fsGet (the universal one-shot READ
 * chokepoint: get / list / query().once() all route through it).
 *
 * _fsGet now times the top-level read and, via MastError, rings moderately-slow reads
 * (>=800ms) and captures the worst (>=1500ms) tagged by path, so the operator can
 * localize an expensive/unindexed query (the stated #1 perf pain). It is a no-op unless
 * MastError is present, and the timing must never disturb the read itself.
 *
 * Loads the real shared/mastdb.js against a fake Firestore whose ref.get() RESOLVES;
 * performance.now() is mocked for a deterministic elapsed time; a fake window.MastError
 * records what _fsGet reports. MastError is armed AFTER init so only the test read times.
 *
 * Run: node test/mastdb-slow-read.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSlowReadHarness() {
  const captures = [];
  const crumbs = [];
  let times = [];
  let ti = 0;
  function snap(p) { return { exists: true, id: p.split('/').pop(), data: function () { return { _v: 1 }; } }; }
  function mkRef(p) {
    return {
      path: p,
      get: function () { return Promise.resolve(snap(p)); },
      doc: function (d) { return mkRef(p + '/' + d); },
      collection: function (c) { return mkRef(p + '/' + c); },
      where: function () { return mkRef(p); }, orderBy: function () { return mkRef(p); }, limit: function () { return mkRef(p); }
    };
  }
  const fakeFs = { doc: function (p) { return mkRef(p); }, collection: function (p) { return mkRef(p); } };
  const firebase = { firestore: Object.assign(function () { return fakeFs; }, {
    FieldValue: { increment: function (n) { return { __increment: n }; }, serverTimestamp: function () { return { __ts: 1 }; }, delete: function () { return { __del: 1 }; } },
    FieldPath: function () {}
  }) };
  const sandbox = {
    firebase: firebase, console: console, window: {}, Promise: Promise,
    performance: { now: function () { return times.length ? times[Math.min(ti++, times.length - 1)] : 0; } },
    setTimeout: function (fn) { fn(); return 0; }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../shared/mastdb.js'), 'utf8'), sandbox);
  const MastDB = sandbox.MastDB;
  MastDB.init({ firestore: fakeFs, tenantId: 't1' });
  return {
    MastDB: MastDB, captures: captures, crumbs: crumbs,
    // arm AFTER init so only the subsequent read is timed; times = [t0, tEnd].
    arm: function (ms) {
      sandbox.window.MastError = {
        capture: function (e, ctx) { captures.push({ message: e && e.message, ctx: ctx }); },
        breadcrumb: function (k, d) { crumbs.push({ kind: k, data: d }); }
      };
      times = [0, ms];
      ti = 0;
    }
  };
}

test('slow read >=1500ms → MastError.capture {kind:slow-read, path, ms}, dedup-friendly message', async () => {
  const h = makeSlowReadHarness();
  h.arm(2000);
  await h.MastDB.get('admin/settings').catch(function () {});
  assert.strictEqual(h.captures.length, 1, 'exactly one slow-read capture');
  assert.strictEqual(h.captures[0].ctx.kind, 'slow-read');
  assert.strictEqual(h.captures[0].ctx.ms, 2000);
  assert.match(h.captures[0].ctx.path, /settings/, 'tagged by path');
  assert.match(h.captures[0].message, /^slow read:/, 'message omits the varying ms so reports dedup per-path');
  assert.strictEqual(h.crumbs.length, 0, 'captured (worst), not just ringed');
});

test('moderately slow read 800–1499ms → breadcrumb only (not persisted)', async () => {
  const h = makeSlowReadHarness();
  h.arm(1000);
  await h.MastDB.get('admin/settings').catch(function () {});
  assert.strictEqual(h.captures.length, 0, 'must NOT capture/persist a sub-1500ms read');
  assert.strictEqual(h.crumbs.length, 1, 'rings a breadcrumb');
  assert.strictEqual(h.crumbs[0].kind, 'slow-read');
  assert.strictEqual(h.crumbs[0].data.ms, 1000);
});

test('fast read <800ms → neither captured nor ringed', async () => {
  const h = makeSlowReadHarness();
  h.arm(120);
  await h.MastDB.get('admin/settings').catch(function () {});
  assert.strictEqual(h.captures.length, 0);
  assert.strictEqual(h.crumbs.length, 0);
});

test('with no MastError bound, a slow read is silently untimed (never throws)', async () => {
  const h = makeSlowReadHarness();
  // do NOT arm — window.MastError stays undefined, so timing is skipped entirely
  await assert.doesNotReject(function () { return h.MastDB.get('admin/settings').catch(function () {}); });
  assert.strictEqual(h.captures.length, 0);
});
