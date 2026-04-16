// ============================================================
// MastDB — Phase B Firestore Adapter (TEST)
// ------------------------------------------------------------
// Drop-in replacement for mastdb.js. Same public API surface.
// Uses Firestore instead of RTDB. For Phase B validation only.
//
// Path translation:
//   RTDB: {tenantId}/public/products/{pid}  (flat tree)
//   Firestore: tenants/{tenantId}/data/{path-segments-joined}
//   Strategy: single "data" collection per tenant, doc ID = path
//
// Simple approach: store every RTDB "leaf" as a Firestore doc
// in `tenants/{tenantId}/data/{pathKey}` where pathKey replaces
// "/" with "__" so it's a valid doc ID. The doc has { _v: value }.
// For collections (list/query), we use prefix queries on pathKey.
// ============================================================
var MastDB = (function() {
  var _fs = null;      // Firestore instance
  var _tenantId = null;
  var _testApp = null; // secondary Firebase app for test project

  function init(config) {
    // config.firestoreProject = { apiKey, projectId, ... }
    // config.tenantId = 'dev'
    _tenantId = config.tenantId;

    if (config.firestore) {
      // Direct Firestore instance passed
      _fs = config.firestore;
    } else if (config.firestoreProject) {
      // Initialize a secondary Firebase app for the Firestore project
      var fc = config.firestoreProject;
      _testApp = firebase.initializeApp(fc, 'firestore-test');
      _fs = _testApp.firestore();
    }
  }

  // --- Path helpers ---
  // Convert RTDB-style path to Firestore collection/doc reference.
  // Strategy: tenants/{tenantId} is the root doc.
  // Sub-paths map to subcollections: first segment = collection, rest = doc path.
  // e.g., "public/products/abc" -> collection "public_products", doc "abc"
  // e.g., "admin/customers/-xyz" -> collection "admin_customers", doc "-xyz"
  // e.g., "public/config/site" -> collection "public_config", doc "site"
  // e.g., "orders/-abc" -> collection "orders", doc "-abc"

  function _tenantRoot() {
    return _fs.collection('tenants').doc(_tenantId);
  }

  function _parseCollectionPath(path) {
    // Split path into segments
    var segs = path.split('/').filter(Boolean);
    if (segs.length === 0) return { collection: '_root', docId: null, fieldPath: null };

    if (segs.length === 1) {
      // "orders" -> collection "orders", no doc
      return { collection: segs[0], docId: null, fieldPath: null };
    }

    if (segs.length === 2) {
      // "public/products" -> collection "public__products", no doc
      // "orders/-abc" -> collection "orders", doc "-abc"
      // Heuristic: if first seg is "public" or "admin", merge into collection name
      if (segs[0] === 'public' || segs[0] === 'admin' || segs[0] === 'newsletter') {
        return { collection: segs[0] + '__' + segs[1], docId: null, fieldPath: null };
      }
      return { collection: segs[0], docId: segs[1], fieldPath: null };
    }

    // 3+ segments
    // "public/products/abc" -> collection "public__products", doc "abc"
    // "admin/customers/-xyz/linkedIds" -> collection "admin__customers", doc "-xyz", field "linkedIds"
    // "admin/customerIndexes/byEmail/foo" -> collection "admin__customerIndexes__byEmail", doc "foo"
    if (segs[0] === 'public' || segs[0] === 'admin' || segs[0] === 'newsletter') {
      // Merge namespace + next segment as collection
      var collection = segs[0] + '__' + segs[1];
      var remaining = segs.slice(2);
      if (remaining.length === 1) {
        return { collection: collection, docId: remaining[0], fieldPath: null };
      }
      // If remaining > 1, first is doc, rest is field path
      return { collection: collection, docId: remaining[0], fieldPath: remaining.slice(1).join('.') };
    }

    // Non-namespaced: "orders/-abc/items/0"
    return {
      collection: segs[0],
      docId: segs[1],
      fieldPath: segs.length > 2 ? segs.slice(2).join('.') : null
    };
  }

  function _docRef(path) {
    var parsed = _parseCollectionPath(path);
    if (!parsed.docId) throw new Error('MastDB-Firestore: path "' + path + '" has no document ID');
    return _tenantRoot().collection(parsed.collection).doc(parsed.docId);
  }

  function _collRef(path) {
    var parsed = _parseCollectionPath(path);
    return _tenantRoot().collection(parsed.collection);
  }

  // --- Sentinels ---
  var SERVER_TIMESTAMP = Object.freeze({ __sentinel: 'serverTimestamp' });
  function serverTimestamp() { return SERVER_TIMESTAMP; }
  function serverIncrement(n) {
    return Object.freeze({ __sentinel: 'serverIncrement', n: n });
  }
  function _isSentinel(v) {
    return v && typeof v === 'object' &&
      (v.__sentinel === 'serverTimestamp' || v.__sentinel === 'serverIncrement');
  }
  function _translate(value) {
    if (value === null || value === undefined) return value;
    if (_isSentinel(value)) {
      if (value.__sentinel === 'serverTimestamp') return firebase.firestore.FieldValue.serverTimestamp();
      return firebase.firestore.FieldValue.increment(value.n);
    }
    if (Array.isArray(value)) return value.map(_translate);
    if (typeof value === 'object') {
      var out = {};
      for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = _translate(value[k]);
      return out;
    }
    return value;
  }

  // --- Escape hatches (stub for compatibility — logs warning) ---
  function _ref(path) {
    console.warn('[MastDB-Firestore] _ref() escape hatch called — not supported in Firestore mode');
    return null;
  }
  function _rootRef() {
    console.warn('[MastDB-Firestore] _rootRef() escape hatch called — not supported in Firestore mode');
    return null;
  }
  function _newKey(path) {
    return _collRef(path).doc().id;
  }
  function _newRootKey() {
    return _fs.collection('_keys').doc().id;
  }
  function _prefixPaths(updates) { return updates; /* no-op in Firestore mode */ }
  async function _multiUpdate(updates) {
    var batch = _fs.batch();
    for (var key in updates) {
      if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
      var parsed = _parseCollectionPath(key);
      if (!parsed.docId) continue;
      var ref = _tenantRoot().collection(parsed.collection).doc(parsed.docId);
      var val = _translate(updates[key]);
      if (parsed.fieldPath) {
        var fieldUpdate = {};
        fieldUpdate[parsed.fieldPath] = val;
        batch.set(ref, fieldUpdate, { merge: true });
      } else if (val === null) {
        batch.delete(ref);
      } else {
        batch.set(ref, typeof val === 'object' && !Array.isArray(val) ? val : { _v: val }, { merge: true });
      }
    }
    return batch.commit();
  }

  // --- Query builder ---
  function _makeQuery(collectionRef, spec) {
    spec = spec || {};
    function extend(patch) {
      var next = {};
      for (var k in spec) next[k] = spec[k];
      for (var k in patch) next[k] = patch[k];
      return _makeQuery(collectionRef, next);
    }
    function _apply() {
      var q = collectionRef;
      if (spec.orderBy === 'child') q = q.orderBy(spec.orderByField);
      if (spec.equalTo !== undefined && spec.orderByField) {
        q = q.where(spec.orderByField, '==', spec.equalTo);
      }
      if (spec.startAt !== undefined) q = q.startAt(spec.startAt);
      if (spec.endAt !== undefined) q = q.endAt(spec.endAt);
      if (spec.limitToFirst !== undefined) q = q.limit(spec.limitToFirst);
      if (spec.limitToLast !== undefined) q = q.limitToLast(spec.limitToLast);
      return q;
    }
    function _snapToObj(snap) {
      var result = {};
      snap.forEach(function(doc) { result[doc.id] = doc.data(); });
      return result;
    }
    return {
      orderByChild: function(field) { return extend({ orderBy: 'child', orderByField: field }); },
      orderByKey: function() { return extend({ orderBy: 'key' }); },
      orderByValue: function() { return extend({ orderBy: 'value' }); },
      equalTo: function(v) { return extend({ equalTo: v }); },
      startAt: function(v) { return extend({ startAt: v }); },
      startAfter: function(v) { return extend({ startAfter: v }); },
      endAt: function(v) { return extend({ endAt: v }); },
      endBefore: function(v) { return extend({ endBefore: v }); },
      limitToFirst: function(n) { return extend({ limitToFirst: n }); },
      limitToLast: function(n) { return extend({ limitToLast: n }); },
      once: function() { return _apply().get().then(_snapToObj); },
      subscribe: function(cb) {
        return _apply().onSnapshot(function(snap) { cb(_snapToObj(snap)); });
      }
    };
  }

  // --- DataStore factory ---
  function _makeStore(scope) {
    function getDocRef(path) {
      if (scope.platform) {
        // Platform paths: "mast-platform/tenants/dev" -> collection "mast-platform__tenants", doc "dev"
        return _fs.collection('platform').doc(path.replace(/\//g, '__'));
      }
      return _docRef(path);
    }
    function getCollRef(path) {
      if (scope.platform) {
        return _fs.collection('platform');
      }
      return _collRef(path);
    }
    return {
      get: function(path) {
        var parsed = _parseCollectionPath(path);
        if (!parsed.docId) {
          // Collection-level read: return all docs as object
          return getCollRef(path).get().then(function(snap) {
            var result = {};
            snap.forEach(function(doc) { result[doc.id] = doc.data(); });
            return Object.keys(result).length > 0 ? result : null;
          });
        }
        return getDocRef(path).get().then(function(doc) {
          if (!doc.exists) return null;
          var data = doc.data();
          if (parsed.fieldPath) {
            // Navigate to nested field
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val; i++) val = val[segs[i]];
            return val !== undefined ? val : null;
          }
          return data._v !== undefined ? data._v : data;
        });
      },
      list: function(path, opts) {
        opts = opts || {};
        var q = getCollRef(path);
        if (opts.limit) q = q.limit(opts.limit);
        return q.get().then(function(snap) {
          var result = {};
          snap.forEach(function(doc) {
            result[doc.id] = opts.shallow ? true : (doc.data()._v !== undefined ? doc.data()._v : doc.data());
          });
          return result;
        });
      },
      set: function(path, value) {
        return getDocRef(path).set(_translate(value && typeof value === 'object' && !Array.isArray(value) ? value : { _v: value }));
      },
      update: function(path, partial) {
        return getDocRef(path).update(_translate(partial));
      },
      push: function(path, value) {
        var ref = getCollRef(path).doc();
        var key = ref.id;
        return ref.set(_translate(value)).then(function() { return { key: key }; });
      },
      newKey: function(path) { return getCollRef(path).doc().id; },
      remove: function(path) { return getDocRef(path).delete(); },
      multiUpdate: function(updates) {
        var batch = _fs.batch();
        for (var key in updates) {
          if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
          var fullPath = scope.platform ? key : key;
          var parsed = _parseCollectionPath(fullPath);
          if (!parsed.docId) continue;
          var ref = scope.platform
            ? _fs.collection('platform').doc(fullPath.replace(/\//g, '__'))
            : _tenantRoot().collection(parsed.collection).doc(parsed.docId);
          var val = _translate(updates[key]);
          if (parsed.fieldPath) {
            var fu = {};
            fu[parsed.fieldPath] = val;
            batch.set(ref, fu, { merge: true });
          } else if (val === null) {
            batch.delete(ref);
          } else {
            batch.set(ref, typeof val === 'object' && !Array.isArray(val) ? val : { _v: val }, { merge: true });
          }
        }
        return batch.commit();
      },
      query: function(path) { return _makeQuery(getCollRef(path), {}); },
      subscribe: function(path, cb) {
        var parsed = _parseCollectionPath(path);
        if (!parsed.docId) {
          // Collection subscription
          return getCollRef(path).onSnapshot(function(snap) {
            var result = {};
            snap.forEach(function(doc) { result[doc.id] = doc.data(); });
            cb(Object.keys(result).length > 0 ? result : null);
          });
        }
        return getDocRef(path).onSnapshot(function(doc) {
          if (!doc.exists) { cb(null); return; }
          var data = doc.data();
          cb(data._v !== undefined ? data._v : data);
        });
      },
      transaction: function(path, fn) {
        var ref = getDocRef(path);
        return _fs.runTransaction(function(tx) {
          return tx.get(ref).then(function(doc) {
            var current = doc.exists ? doc.data() : null;
            if (current && current._v !== undefined) current = current._v;
            var result = fn(current);
            if (result === undefined) return { committed: false, value: current };
            tx.set(ref, typeof result === 'object' && !Array.isArray(result) ? result : { _v: result });
            return { committed: true, value: result };
          });
        });
      },
      serverTimestamp: serverTimestamp,
      serverIncrement: serverIncrement
    };
  }

  // --- Public MastDB object ---
  var tenantStore = null;
  var platformStore = null;
  function _ensureStores() {
    if (!tenantStore) tenantStore = _makeStore({ tenantId: true });
    if (!platformStore) platformStore = _makeStore({ platform: true });
  }

  return {
    init: function(config) {
      init(config);
      _ensureStores();
    },
    get: function(p) { return tenantStore.get(p); },
    list: function(p, o) { return tenantStore.list(p, o); },
    set: function(p, v) { return tenantStore.set(p, v); },
    update: function(p, x) { return tenantStore.update(p, x); },
    push: function(p, v) { return tenantStore.push(p, v); },
    newKey: function(p) { return tenantStore.newKey(p); },
    remove: function(p) { return tenantStore.remove(p); },
    multiUpdate: function(u) { return tenantStore.multiUpdate(u); },
    query: function(p) { return tenantStore.query(p); },
    subscribe: function(p, cb) { return tenantStore.subscribe(p, cb); },
    transaction: function(p, fn) { return tenantStore.transaction(p, fn); },
    serverTimestamp: serverTimestamp,
    serverIncrement: serverIncrement,
    platform: {
      get: function(p) { return platformStore.get(p); },
      list: function(p, o) { return platformStore.list(p, o); },
      set: function(p, v) { return platformStore.set(p, v); },
      update: function(p, x) { return platformStore.update(p, x); },
      push: function(p, v) { return platformStore.push(p, v); },
      newKey: function(p) { return platformStore.newKey(p); },
      remove: function(p) { return platformStore.remove(p); },
      multiUpdate: function(u) { return platformStore.multiUpdate(u); },
      query: function(p) { return platformStore.query(p); },
      subscribe: function(p, cb) { return platformStore.subscribe(p, cb); },
      transaction: function(p, fn) { return platformStore.transaction(p, fn); },
      serverTimestamp: serverTimestamp,
      serverIncrement: serverIncrement
    },
    _ref: _ref,
    _rootRef: _rootRef,
    _newKey: _newKey,
    _newRootKey: _newRootKey,
    _prefixPaths: _prefixPaths,
    _multiUpdate: _multiUpdate,
    tenantId: function() { return _tenantId; },
    storagePath: function(subpath) { return _tenantId + '/' + subpath; }
  };
})();

if (typeof window !== 'undefined') window.MastDB = MastDB;
