// ============================================================
// MastDB — Phase B.5 Hybrid Data Access Abstraction Layer
// ------------------------------------------------------------
// Tenant operations → Firestore (tenants/{tenantId}/{collection})
// Platform operations → RTDB (mast-platform/...)
//
// Public API unchanged from Phase A. Only internals swapped.
// See ~/.claude/plans/mast-db-abstraction/phase-b-firestore-detailed.md
// ============================================================
var MastDB = (function() {
  var _fs = null;       // Firestore instance (tenant + platform operations)
  var _tenantId = null;

  function init(config) {
    _tenantId = config.tenantId;
    if (config.firestore) {
      _fs = config.firestore;
    } else if (config.db) {
      // Legacy callers still pass config.db (RTDB). Pull Firestore from same app.
      try {
        var app = config.db.app || config.app;
        if (app && app.firestore) _fs = app.firestore();
      } catch (e) { /* fall through */ }
    }
    if (!_fs && typeof firebase !== 'undefined' && firebase.firestore) {
      _fs = firebase.firestore();
    }
    _ensureStores();
  }

  // --- Backward-compat: wrap subscribe data with .val() for legacy snap.val() callers ---
  function _wrapSnap(data) {
    if (data == null) return { val: function() { return null; } };
    if (typeof data !== 'object') return { val: function() { return data; } };
    // Clone-ish: add .val() as non-enumerable so it doesn't pollute Object.keys/values
    Object.defineProperty(data, 'val', {
      value: function() { return data; },
      enumerable: false, configurable: true, writable: true
    });
    return data;
  }

  // --- Backward-compat: make Promises from get() behave like Firebase refs ---
  // Allows legacy patterns: MastDB.config.square().once('value').then(snap => snap.val())
  function _wrapPromise(promise, basePath) {
    // .once('value') — just return the promise with wrapped result
    promise.once = function() { return promise.then(_wrapSnap); };
    // .child(key) — return a new wrapped promise that drills into the result
    promise.child = function(key) {
      return _wrapPromise(promise.then(function(data) {
        if (data == null) return null;
        return (typeof data === 'object' && key in data) ? data[key] : null;
      }), basePath ? basePath + '/' + key : key);
    };
    // .on('value', cb) — one-shot listener compat (not real-time, but prevents crash)
    promise.on = function(event, cb) { promise.then(function(d) { cb(_wrapSnap(d)); }); return promise; };
    return promise;
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

  // Resolve sentinels for Firestore
  function _translateFs(value) {
    if (value === null || value === undefined) return value;
    if (_isSentinel(value)) {
      if (value.__sentinel === 'serverTimestamp') return firebase.firestore.FieldValue.serverTimestamp();
      return firebase.firestore.FieldValue.increment(value.n);
    }
    if (Array.isArray(value)) return value.map(_translateFs);
    if (typeof value === 'object') {
      var out = {};
      for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = _translateFs(value[k]);
      return out;
    }
    return value;
  }

  // --- Path translation tables ---

  var TENANT_COLLECTION_MAP = {
    'admin/contacts': 'contacts',
    'admin/customers': 'customers',
    'admin/customerIndexes': 'customer_indexes',
    'admin/customerDuplicates': 'customer_duplicates',
    'admin/enrollments': 'enrollments',
    'admin/inventory': 'inventory',
    'admin/materials': 'materials',
    'admin/recipes': 'recipes',
    'admin/users': 'admin_users',
    'admin/coupons': 'coupons',
    'admin/commissions': 'commissions',
    'admin/expenses': 'expenses',
    'admin/giftCards': 'gift_cards',
    'admin/historicalOrders': 'historical_orders',
    'admin/lookbooks': 'lookbooks',
    'admin/consignments': 'consignments',
    'admin/subscription': 'admin_subscription',
    'admin/auditLog': 'audit_log',
    'admin/auditIndex': 'audit_index',
    'public/products': 'products',
    'public/gallery': 'gallery',
    'public/classes': 'classes',
    'public/classSessions': 'class_sessions',
    'public/sales-promotions': 'sales_promotions',
    'public/config': 'config',
    'blog/posts': 'blog_posts',
    'blog/published': 'blog_published',
    'blog/ideas': 'blog_ideas',
    'newsletter/subscribers': 'newsletter_subscribers',
    'newsletter/issues': 'newsletter_issues',
    'newsletter/published': 'newsletter_published',
    'events/shows': 'events_shows',
    'events/booths': 'events_booths',
    'events/vendors': 'events_vendors',
    'events/submissions': 'events_submissions',
    'analytics/hits': 'analytics_hits',
    'tokenWallet': 'token_wallet',
    'tokenLog': 'token_log',
    'alertState': 'alert_state',
    'alertHistory': 'alert_history',
    'feedbackReports': 'feedback_reports',
    'webPresence': 'web_presence',
    'webPresence/importJobs': 'web_presence_importJobs',
    'quickActions': 'quick_actions',
    'tripLocations': 'trip_locations',
    'tripSettings': 'trip_settings',
    'orders': 'orders',
    'emails': 'emails',
    'images': 'images',
    'students': 'students',
    'users': 'users',
    'config': 'config',
    'settings': 'settings',
    'workflows': 'workflows',
    'inquiries': 'inquiries',
    'trips': 'trips'
  };

  var PLATFORM_COLLECTION_MAP = {
    'auth/oauth/clients': 'platform_auth_oauth_clients',
    'auth/oauth/tokenIndex': 'platform_auth_oauth_tokenIndex',
    'auth/oauth/userTokens': 'platform_auth_oauth_userTokens',
    'auth/oauth/auditLog': 'platform_auth_oauth_auditLog',
    'auth/oauth/refreshTokenIndex': 'platform_auth_oauth_refreshTokenIndex',
    'auth/oauth/userRefreshTokens': 'platform_auth_oauth_userRefreshTokens',
    'auth/apiKeys': 'platform_auth_apiKeys',
    'auth/tenantApiKeys': 'platform_auth_tenantApiKeys',
    'tenants': 'platform_tenants',
    'tenantsByDomain': 'platform_tenantsByDomain',
    'platformAdmins': 'platform_platformAdmins',
    'userTenantMap': 'platform_userTenantMap',
    'dashboardCards': 'platform_dashboardCards',
    'alertDefinitions': 'platform_alertDefinitions',
    'alertRuns': 'platform_alertRuns',
    'driftSeverityDefaults': 'platform_driftSeverityDefaults',
    'showIndex': 'platform_showIndex',
    'showSlugs': 'platform_showSlugs',
    'testingMissions': 'platform_testingMissions',
    'eventsInviteTokens': 'platform_eventsInviteTokens',
    'importJobs': 'platform_importJobs',
    'importCapabilities': 'platform_importCapabilities',
    'importPatterns': 'platform_importPatterns',
    'driftScans': 'platform_driftScans',
    'etsyPendingAuth': 'platform_etsyPendingAuth',
    'googleContactsPendingAuth': 'platform_googleContactsPendingAuth',
    'shopifyPendingAuth': 'platform_shopifyPendingAuth',
    'webhookRouting': 'platform_webhookRouting',
    'backfills': 'platform_backfills',
    'spotPrices': 'platform_spotPrices',
    'config': 'platform_config',
    'provisioning': 'platform_provisioning',
    'pendingOwners': 'platform_pendingOwners'
  };

  var SINGLETON_COLLECTIONS = {
    'token_wallet': true, 'alert_state': true,
    'trip_settings': true, 'newsletter_meta': true,
    'admin_subscription': true,
    'platform_driftSeverityDefaults': true
  };
  var SINGLETON_DOC_ID = '_data';

  function _lookupCollection(segs, map) {
    for (var i = 3; i >= 1; i--) {
      if (segs.length >= i) {
        var prefix = segs.slice(0, i).join('/');
        var mapped = map[prefix];
        if (mapped) return { collection: mapped, remaining: segs.slice(i) };
      }
    }
    return null;
  }

  var NAMESPACE_PREFIXES = { 'admin': true, 'public': true, 'newsletter': true, 'blog': true, 'events': true, 'analytics': true };

  function _buildResult(coll, rem) {
    if (SINGLETON_COLLECTIONS[coll]) {
      return { collection: coll, docId: SINGLETON_DOC_ID, fieldPath: rem.length > 0 ? rem.join('.') : null };
    }
    if (rem.length === 0) return { collection: coll, docId: null, fieldPath: null };
    if (rem.length === 1) return { collection: coll, docId: rem[0], fieldPath: null };
    return { collection: coll, docId: rem[0], fieldPath: rem.slice(1).join('.') };
  }

  function _translateTenantPath(path) {
    var segs = path.split('/').filter(Boolean);
    if (segs.length === 0) return { collection: '_root', docId: null, fieldPath: null };

    // 1. Try static map (handles known renames like giftCards → gift_cards)
    var match = _lookupCollection(segs, TENANT_COLLECTION_MAP);
    if (match) return _buildResult(match.collection, match.remaining);

    // 2. Namespace-aware fallback for unmapped paths
    if (segs.length >= 2 && NAMESPACE_PREFIXES[segs[0]]) {
      var ns = segs[0];
      var rest = segs.slice(1);
      // admin/* → admin_{collection} to avoid collision with root paths
      // public/* → {collection} (public is the public-facing namespace, safe to strip)
      var coll = (ns === 'admin') ? 'admin_' + rest[0] : rest[0];
      return _buildResult(coll, rest.slice(1));
    }

    // 3. Root-level fallback
    return _buildResult(segs[0], segs.slice(1));
  }

  function _translatePlatformPath(fullPath) {
    var stripped = fullPath.indexOf('mast-platform/') === 0
      ? fullPath.slice('mast-platform/'.length)
      : fullPath;
    var segs = stripped.split('/').filter(Boolean);
    if (segs.length === 0) return { collection: 'platform', docId: null, fieldPath: null };

    var match = _lookupCollection(segs, PLATFORM_COLLECTION_MAP);
    if (match) {
      var coll = match.collection;
      var rem = match.remaining;
      if (SINGLETON_COLLECTIONS[coll]) {
        return { collection: coll, docId: SINGLETON_DOC_ID, fieldPath: rem.length > 0 ? rem.join('.') : null };
      }
      if (rem.length === 0) return { collection: coll, docId: null, fieldPath: null };
      if (rem.length === 1) return { collection: coll, docId: rem[0], fieldPath: null };
      return { collection: coll, docId: rem[0], fieldPath: rem.slice(1).join('.') };
    }

    // Fallback: platform_{firstSegment}
    var fallbackColl = 'platform_' + segs[0];
    if (segs.length === 1) return { collection: fallbackColl, docId: null, fieldPath: null };
    if (segs.length === 2) return { collection: fallbackColl, docId: segs[1], fieldPath: null };
    return { collection: fallbackColl, docId: segs[1], fieldPath: segs.slice(2).join('.') };
  }

  function _tenantRoot() {
    return _fs.collection('tenants').doc(_tenantId);
  }

  function _collRef(parsed) {
    return _tenantRoot().collection(parsed.collection);
  }

  function _docRef(parsed) {
    if (!parsed.docId) throw new Error('MastDB: path requires doc ID: ' + parsed.collection);
    return _collRef(parsed).doc(parsed.docId);
  }

  function _platformCollRef(parsed) {
    return _fs.collection(parsed.collection);
  }

  function _platformDocRef(parsed) {
    if (!parsed.docId) throw new Error('MastDB: platform path requires doc ID: ' + parsed.collection);
    return _platformCollRef(parsed).doc(parsed.docId);
  }

  // --- Firestore query builder ---
  function _makeQuery(collectionRef, spec) {
    spec = spec || {};
    function extend(patch) {
      var next = {};
      for (var k in spec) next[k] = spec[k];
      for (var k2 in patch) next[k2] = patch[k2];
      return _makeQuery(collectionRef, next);
    }
    function _apply() {
      var q = collectionRef;
      if (spec.orderBy === 'child') {
        if (spec.equalTo !== undefined) {
          q = q.where(spec.orderByField, '==', spec.equalTo);
        } else {
          q = q.orderBy(spec.orderByField);
          if (spec.startAt !== undefined) q = q.startAt(spec.startAt);
          if (spec.startAfter !== undefined) q = q.startAfter(spec.startAfter);
          if (spec.endAt !== undefined) q = q.endAt(spec.endAt);
          if (spec.endBefore !== undefined) q = q.endBefore(spec.endBefore);
        }
      } else if (spec.orderBy === 'key') {
        q = q.orderBy(firebase.firestore.FieldPath.documentId());
      }
      if (spec.limitToFirst !== undefined) q = q.limit(spec.limitToFirst);
      if (spec.limitToLast !== undefined) {
        // Firestore limitToLast requires orderBy — fall back to limit() if none set
        if (!spec.orderBy) {
          q = q.limit(spec.limitToLast);
        } else {
          q = q.limitToLast(spec.limitToLast);
        }
      }
      return q;
    }
    function _snapToObj(snap) {
      var result = {};
      snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
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
      once: function() { return _fsGet(_apply(), { source: 'server' }).then(_snapToObj).then(_wrapSnap); },
      subscribe: function(cb) {
        return _apply().onSnapshot(function(snap) { cb(_wrapSnap(_snapToObj(snap))); });
      }
    };
  }

  // --- Firestore retry helper (handles cold-start connection failures) ---
  function _fsGet(ref, opts, attempt) {
    attempt = attempt || 0;
    return ref.get(opts).catch(function(err) {
      var isConnErr = err.code === 'unavailable' || err.code === 'failed-precondition' ||
        (err.message && (err.message.indexOf('offline') !== -1 || err.message.indexOf('unavailable') !== -1));
      if (isConnErr && attempt < 3) {
        var delay = [500, 1500, 3000][attempt];
        return new Promise(function(resolve) { setTimeout(resolve, delay); }).then(function() {
          return _fsGet(ref, opts, attempt + 1);
        });
      }
      throw err;
    });
  }

  // --- Build a nested object from a dotted fieldPath so set({merge:true}) writes
  //     into nested maps rather than a literal dotted-key field. ---
  function _buildNestedSet(fieldPath, value) {
    var segs = fieldPath.split('.');
    var root = {};
    var cur = root;
    for (var i = 0; i < segs.length - 1; i++) {
      cur[segs[i]] = {};
      cur = cur[segs[i]];
    }
    cur[segs[segs.length - 1]] = value;
    return root;
  }

  // --- Convert dotted-keyed field map into nested-object form (for multiUpdate). ---
  function _nestFields(fields) {
    var out = {};
    for (var k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
      if (k.indexOf('.') === -1) { out[k] = fields[k]; continue; }
      var segs = k.split('.');
      var cur = out;
      for (var i = 0; i < segs.length - 1; i++) {
        var seg = segs[i];
        if (typeof cur[seg] !== 'object' || cur[seg] === null || Array.isArray(cur[seg])) {
          cur[seg] = {};
        }
        cur = cur[seg];
      }
      cur[segs[segs.length - 1]] = fields[k];
    }
    return out;
  }

  // --- Unwrap _v sentinel used when storing primitives/arrays as Firestore docs ---
  function _unwrapV(data) {
    if (data && typeof data === 'object' && !Array.isArray(data) &&
        data._v !== undefined && Object.keys(data).length === 1) {
      return data._v;
    }
    return data;
  }

  // --- Firestore tenant store ---
  function _makeFirestoreStore() {
    return {
      get: function(path) {
        var parsed = _translateTenantPath(path);
        if (!parsed.docId) {
          return _wrapPromise(_fsGet(_collRef(parsed), { source: 'server' }).then(function(snap) {
            if (snap.empty) return null;
            var result = {};
            snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
            return result;
          }), path);
        }
        return _wrapPromise(_fsGet(_docRef(parsed), { source: 'server' }).then(function(doc) {
          if (!doc.exists) return null;
          var data = _unwrapV(doc.data());
          if (parsed.fieldPath) {
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val != null; i++) val = val[segs[i]];
            return val !== undefined ? val : null;
          }
          return data;
        }), path);
      },
      list: function(path, opts) {
        opts = opts || {};
        var parsed = _translateTenantPath(path);
        var q = _collRef(parsed);
        if (opts.limit) q = q.limit(opts.limit);
        return _fsGet(q, { source: 'server' }).then(function(snap) {
          var result = {};
          snap.forEach(function(doc) {
            result[doc.id] = opts.shallow ? true : _unwrapV(doc.data());
          });
          return result;
        });
      },
      set: function(path, value) {
        var parsed = _translateTenantPath(path);
        var resolved = _translateFs(value);
        if (parsed.fieldPath) {
          // mergeFields scopes the write to exactly parsed.fieldPath: that
          // field is replaced wholesale while sibling fields on the doc are
          // preserved. This matches RTDB's ref.set() semantics (set replaces
          // the targeted subtree) — plain {merge:true} recursively merges
          // into maps and leaks stale keys on removal.
          return _docRef(parsed).set(
            _buildNestedSet(parsed.fieldPath, resolved),
            { mergeFields: [parsed.fieldPath] }
          );
        }
        if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
          return _docRef(parsed).set(resolved);
        }
        return _docRef(parsed).set({ _v: resolved });
      },
      update: function(path, partial) {
        var parsed = _translateTenantPath(path);
        var resolved = _translateFs(partial);
        if (parsed.fieldPath) {
          var prefixed = {};
          for (var k in resolved) {
            if (Object.prototype.hasOwnProperty.call(resolved, k)) {
              prefixed[parsed.fieldPath + '.' + k] = resolved[k];
            }
          }
          return _docRef(parsed).update(prefixed);
        }
        return _docRef(parsed).update(resolved);
      },
      push: function(path, value) {
        var parsed = _translateTenantPath(path);
        var ref = _collRef(parsed).doc();
        var key = ref.id;
        return ref.set(_translateFs(value)).then(function() { return { key: key }; });
      },
      newKey: function(path) {
        var parsed = _translateTenantPath(path);
        return _collRef(parsed).doc().id;
      },
      remove: function(path) {
        var parsed = _translateTenantPath(path);
        if (parsed.fieldPath) {
          var upd = {};
          upd[parsed.fieldPath] = firebase.firestore.FieldValue.delete();
          return _docRef(parsed).update(upd);
        }
        if (parsed.docId) return _docRef(parsed).delete();
        return _collRef(parsed).get().then(function(snap) {
          var batch = _fs.batch();
          snap.forEach(function(doc) { batch.delete(doc.ref); });
          return batch.commit();
        });
      },
      multiUpdate: function(updates) {
        var batch = _fs.batch();
        var docUpdates = {};
        for (var p in updates) {
          if (!Object.prototype.hasOwnProperty.call(updates, p)) continue;
          var parsed = _translateTenantPath(p);
          if (!parsed.docId) continue;
          var ref = _docRef(parsed);
          var refPath = ref.path;
          if (!docUpdates[refPath]) docUpdates[refPath] = { ref: ref, fields: {} };
          var resolved = _translateFs(updates[p]);
          if (parsed.fieldPath) {
            docUpdates[refPath].fields[parsed.fieldPath] = resolved;
          } else if (resolved === null) {
            batch.delete(ref);
            delete docUpdates[refPath];
          } else if (typeof resolved === 'object' && !Array.isArray(resolved)) {
            docUpdates[refPath].fullReplace = resolved;
          } else {
            docUpdates[refPath].fullReplace = { _v: resolved };
          }
        }
        for (var rp in docUpdates) {
          var entry = docUpdates[rp];
          var nested = _nestFields(entry.fields);
          var fieldPaths = Object.keys(entry.fields);
          if (entry.fullReplace) {
            var merged = Object.assign({}, entry.fullReplace, nested);
            // Each top-level key of fullReplace is a full-replace target, and
            // each nested fieldPath is a scoped-replace target. Listing them
            // all in mergeFields preserves any sibling fields not touched.
            var mergeFields = Object.keys(entry.fullReplace).concat(fieldPaths);
            batch.set(entry.ref, merged, { mergeFields: mergeFields });
          } else if (fieldPaths.length > 0) {
            batch.set(entry.ref, nested, { mergeFields: fieldPaths });
          }
        }
        return batch.commit();
      },
      query: function(path) {
        var parsed = _translateTenantPath(path);
        return _makeQuery(_collRef(parsed), {});
      },
      subscribe: function(path, cb) {
        var parsed = _translateTenantPath(path);
        if (!parsed.docId) {
          return _collRef(parsed).onSnapshot(function(snap) {
            if (snap.empty) { cb(_wrapSnap(null)); return; }
            var result = {};
            snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
            cb(_wrapSnap(result));
          });
        }
        return _docRef(parsed).onSnapshot(function(doc) {
          if (!doc.exists) { cb(_wrapSnap(null)); return; }
          var data = _unwrapV(doc.data());
          if (parsed.fieldPath) {
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val != null; i++) val = val[segs[i]];
            cb(_wrapSnap(val !== undefined ? val : null));
          } else {
            cb(_wrapSnap(data));
          }
        });
      },
      subscribeChild: function(path, event, cb) {
        var parsed = _translateTenantPath(path);
        var seen = {};
        if (parsed.fieldPath) {
          return _docRef(parsed).onSnapshot(function(doc) {
            if (!doc.exists) return;
            var data = _unwrapV(doc.data());
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val != null; i++) val = val[segs[i]];
            if (!val || typeof val !== 'object') return;
            Object.keys(val).forEach(function(k) {
              var entry = val[k];
              if (event === 'child_added' && !seen[k]) { seen[k] = true; cb(entry, k); }
              else if (event === 'child_changed' && seen[k]) { cb(entry, k); }
              seen[k] = true;
            });
          });
        }
        return _collRef(parsed).onSnapshot(function(snap) {
          snap.forEach(function(doc) {
            var d = _unwrapV(doc.data());
            if (event === 'child_added' && !seen[doc.id]) {
              seen[doc.id] = true;
              cb(d, doc.id);
            } else if (event === 'child_changed' && seen[doc.id]) {
              cb(d, doc.id);
            }
            seen[doc.id] = true;
          });
        });
      },
      transaction: function(path, fn) {
        var parsed = _translateTenantPath(path);
        var ref = _docRef(parsed);
        return _fs.runTransaction(function(tx) {
          return tx.get(ref).then(function(doc) {
            var current = doc.exists ? doc.data() : null;
            var next = fn(current);
            if (next === undefined) return { committed: false, value: current };
            var resolved = _translateFs(next);
            if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
              tx.set(ref, resolved);
            } else {
              tx.set(ref, { _v: resolved });
            }
            return { committed: true, value: next };
          });
        });
      },
      serverTimestamp: serverTimestamp,
      serverIncrement: serverIncrement
    };
  }

  // --- Firestore platform store (mast-platform/* → top-level platform_* collections) ---
  function _makeFirestorePlatformStore() {
    function _platformQuery(collectionRef, spec) {
      spec = spec || {};
      function extend(patch) {
        var next = {};
        for (var k in spec) next[k] = spec[k];
        for (var k2 in patch) next[k2] = patch[k2];
        return _platformQuery(collectionRef, next);
      }
      function _apply() {
        var q = collectionRef;
        if (spec.orderBy === 'child') {
          if (spec.equalTo !== undefined) {
            q = q.where(spec.orderByField, '==', spec.equalTo);
          } else {
            q = q.orderBy(spec.orderByField);
          }
        } else if (spec.orderBy === 'key') {
          q = q.orderBy(firebase.firestore.FieldPath.documentId());
        }
        if (spec.limitToFirst !== undefined) q = q.limit(spec.limitToFirst);
        if (spec.limitToLast !== undefined) {
          if (!spec.orderBy) q = q.limit(spec.limitToLast);
          else q = q.limitToLast(spec.limitToLast);
        }
        return q;
      }
      function _snapToObj(snap) {
        var result = {};
        snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
        return result;
      }
      return {
        orderByChild: function(field) { return extend({ orderBy: 'child', orderByField: field }); },
        orderByKey: function() { return extend({ orderBy: 'key' }); },
        equalTo: function(v) { return extend({ equalTo: v }); },
        limitToFirst: function(n) { return extend({ limitToFirst: n }); },
        limitToLast: function(n) { return extend({ limitToLast: n }); },
        once: function() { return _fsGet(_apply(), { source: 'server' }).then(_snapToObj).then(_wrapSnap); },
        subscribe: function(cb) {
          return _apply().onSnapshot(function(snap) { cb(_wrapSnap(_snapToObj(snap))); });
        }
      };
    }

    return {
      get: function(path) {
        var parsed = _translatePlatformPath(path);
        if (!parsed.docId) {
          return _wrapPromise(_fsGet(_platformCollRef(parsed), { source: 'server' }).then(function(snap) {
            if (snap.empty) return null;
            var result = {};
            snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
            return result;
          }), path);
        }
        return _wrapPromise(_fsGet(_platformDocRef(parsed), { source: 'server' }).then(function(doc) {
          if (!doc.exists) return null;
          var data = _unwrapV(doc.data());
          if (parsed.fieldPath) {
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val != null; i++) val = val[segs[i]];
            return val !== undefined ? val : null;
          }
          return data;
        }), path);
      },
      list: function(path, opts) {
        opts = opts || {};
        var parsed = _translatePlatformPath(path);
        var q = _platformCollRef(parsed);
        if (opts.limit) q = q.limit(opts.limit);
        return _fsGet(q, { source: 'server' }).then(function(snap) {
          var result = {};
          snap.forEach(function(doc) {
            result[doc.id] = opts.shallow ? true : _unwrapV(doc.data());
          });
          return result;
        });
      },
      set: function(path, value) {
        var parsed = _translatePlatformPath(path);
        var resolved = _translateFs(value);
        if (parsed.fieldPath) {
          return _platformDocRef(parsed).set(
            _buildNestedSet(parsed.fieldPath, resolved),
            { mergeFields: [parsed.fieldPath] }
          );
        }
        if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
          return _platformDocRef(parsed).set(resolved);
        }
        return _platformDocRef(parsed).set({ _v: resolved });
      },
      update: function(path, partial) {
        var parsed = _translatePlatformPath(path);
        var resolved = _translateFs(partial);
        if (parsed.fieldPath) {
          var prefixed = {};
          for (var k in resolved) {
            if (Object.prototype.hasOwnProperty.call(resolved, k)) {
              prefixed[parsed.fieldPath + '.' + k] = resolved[k];
            }
          }
          return _platformDocRef(parsed).update(prefixed);
        }
        return _platformDocRef(parsed).set(resolved, { merge: true });
      },
      push: function(path, value) {
        var parsed = _translatePlatformPath(path);
        var ref = _platformCollRef(parsed).doc();
        var key = ref.id;
        return ref.set(_translateFs(value)).then(function() { return { key: key }; });
      },
      newKey: function(path) {
        var parsed = _translatePlatformPath(path);
        return _platformCollRef(parsed).doc().id;
      },
      remove: function(path) {
        var parsed = _translatePlatformPath(path);
        if (parsed.fieldPath) {
          var upd = {};
          upd[parsed.fieldPath] = firebase.firestore.FieldValue.delete();
          return _platformDocRef(parsed).update(upd);
        }
        if (parsed.docId) return _platformDocRef(parsed).delete();
        return _platformCollRef(parsed).get().then(function(snap) {
          var batch = _fs.batch();
          snap.forEach(function(doc) { batch.delete(doc.ref); });
          return batch.commit();
        });
      },
      multiUpdate: function(updates) {
        var batch = _fs.batch();
        for (var p in updates) {
          if (!Object.prototype.hasOwnProperty.call(updates, p)) continue;
          var parsed = _translatePlatformPath(p);
          if (!parsed.docId) continue;
          var ref = _platformDocRef(parsed);
          var resolved = _translateFs(updates[p]);
          if (resolved === null) {
            batch.delete(ref);
          } else if (parsed.fieldPath) {
            var upd = {};
            upd[parsed.fieldPath] = resolved;
            batch.set(ref, _buildNestedSet(parsed.fieldPath, resolved), { mergeFields: [parsed.fieldPath] });
          } else if (typeof resolved === 'object' && !Array.isArray(resolved)) {
            batch.set(ref, resolved);
          } else {
            batch.set(ref, { _v: resolved });
          }
        }
        return batch.commit();
      },
      query: function(path) {
        var parsed = _translatePlatformPath(path);
        return _platformQuery(_platformCollRef(parsed), {});
      },
      subscribe: function(path, cb) {
        var parsed = _translatePlatformPath(path);
        if (!parsed.docId) {
          return _platformCollRef(parsed).onSnapshot(function(snap) {
            if (snap.empty) { cb(_wrapSnap(null)); return; }
            var result = {};
            snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
            cb(_wrapSnap(result));
          });
        }
        return _platformDocRef(parsed).onSnapshot(function(doc) {
          if (!doc.exists) { cb(_wrapSnap(null)); return; }
          var data = _unwrapV(doc.data());
          if (parsed.fieldPath) {
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val != null; i++) val = val[segs[i]];
            cb(_wrapSnap(val !== undefined ? val : null));
          } else {
            cb(_wrapSnap(data));
          }
        });
      },
      transaction: function(path, fn) {
        var parsed = _translatePlatformPath(path);
        var ref = _platformDocRef(parsed);
        return _fs.runTransaction(function(tx) {
          return tx.get(ref).then(function(doc) {
            var current = doc.exists ? _unwrapV(doc.data()) : null;
            var next = fn(current);
            if (next === undefined) return { committed: false, value: current };
            var resolved = _translateFs(next);
            if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
              tx.set(ref, resolved);
            } else {
              tx.set(ref, { _v: resolved });
            }
            return { committed: true, value: next };
          });
        });
      },
      serverTimestamp: serverTimestamp,
      serverIncrement: serverIncrement
    };
  }

  // --- Escape hatches (deprecated — throw so misuse is caught at call site) ---
  function _ref() {
    throw new Error('[MastDB] _ref() escape hatch removed. Use MastDB.get/set/query/subscribe/etc.');
  }
  function _rootRef() {
    throw new Error('[MastDB] _rootRef() escape hatch removed. Use MastDB.get/set/query/subscribe/etc.');
  }
  function _newKey(path) {
    var parsed = _translateTenantPath(path);
    return _collRef(parsed).doc().id;
  }
  function _newRootKey() { return _fs.collection('_keys').doc().id; }
  function _prefixPaths(updates) { return updates; }
  async function _multiUpdate(updates) {
    // Delegate to the tenant store's multiUpdate
    return tenantStore.multiUpdate(updates);
  }

  // --- Public MastDB object ---
  var tenantStore = null;
  var platformStore = null;
  function _ensureStores() {
    // Lazy-init _fs from the default Firebase app if MastDB.init() hasn't been
    // called yet. Platform reads don't need a tenantId, so the auth callback can
    // hit MastDB.platform.get() before resolveTenant has chosen a tenant.
    if (!_fs && typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length && firebase.firestore) {
      try { _fs = firebase.firestore(); } catch (e) { /* firebase app not ready */ }
    }
    if (!tenantStore && _fs) tenantStore = _makeFirestoreStore();
    if (!platformStore && _fs) platformStore = _makeFirestorePlatformStore();
  }
  function _platform() {
    _ensureStores();
    if (!platformStore) throw new Error('MastDB: platform store unavailable (Firebase not initialized)');
    return platformStore;
  }

  return {
    init: function(config) {
      init(config);
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
    subscribeChild: function(p, e, cb) { return tenantStore.subscribeChild(p, e, cb); },
    transaction: function(p, fn) { return tenantStore.transaction(p, fn); },
    serverTimestamp: serverTimestamp,
    serverIncrement: serverIncrement,
    platform: {
      get: function(p) { return _platform().get(p); },
      list: function(p, o) { return _platform().list(p, o); },
      set: function(p, v) { return _platform().set(p, v); },
      update: function(p, x) { return _platform().update(p, x); },
      push: function(p, v) { return _platform().push(p, v); },
      newKey: function(p) { return _platform().newKey(p); },
      remove: function(p) { return _platform().remove(p); },
      multiUpdate: function(u) { return _platform().multiUpdate(u); },
      query: function(p) { return _platform().query(p); },
      subscribe: function(p, cb) { return _platform().subscribe(p, cb); },
      transaction: function(p, fn) { return _platform().transaction(p, fn); },
      serverTimestamp: serverTimestamp,
      serverIncrement: serverIncrement
    },
    businessEntity: (function() {
      // Spec §4 archetype defaults, mirrored on the client for pure lookup.
      // Server-side source of truth: entity.ts ARCHETYPE_DEFAULTS in tenant MCP.
      var UNIVERSAL_GOALS = ['increase-revenue','get-online-shop','sync-channels','take-bookings','track-inventory','reduce-admin-time'];
      var ARCHETYPE_DEFAULTS = {
        'glass-artisan':       { businessModel: 'retail', plannerBusinessTypeAlias: 'glassblowing', modulesShown: ['dashboard','products','orders','gallery','production','consignment','shows','maker'], goalsAvailable: UNIVERSAL_GOALS.concat(['consignment-tracking','wholesale-catalog','commission-management']) },
        'ceramics-pottery':    { businessModel: 'retail', plannerBusinessTypeAlias: 'pottery',     modulesShown: ['dashboard','products','orders','gallery','production','consignment','shows','maker'], goalsAvailable: UNIVERSAL_GOALS.concat(['consignment-tracking','wholesale-catalog','commission-management']) },
        'jewelry-maker':       { businessModel: 'retail', plannerBusinessTypeAlias: 'jewelry',     modulesShown: ['dashboard','products','orders','gallery','maker','consignment','wholesale'],            goalsAvailable: UNIVERSAL_GOALS.concat(['wholesale-catalog','edition-tracking']) },
        'fiber-textile':       { businessModel: 'retail', plannerBusinessTypeAlias: 'fiber',       modulesShown: ['dashboard','products','orders','gallery','production','maker','shows'],                  goalsAvailable: UNIVERSAL_GOALS.concat(['wholesale-catalog','edition-tracking']) },
        'woodworker':          { businessModel: 'retail', plannerBusinessTypeAlias: 'wood',        modulesShown: ['dashboard','products','orders','production','commissions','maker'],                      goalsAvailable: UNIVERSAL_GOALS.concat(['project-timeline','bespoke-quotes','commission-management']) },
        'painter-printmaker':  { businessModel: 'retail', plannerBusinessTypeAlias: 'art',         modulesShown: ['dashboard','products','orders','gallery','maker'],                                        goalsAvailable: UNIVERSAL_GOALS.concat(['edition-tracking','gallery-submissions','print-on-demand']) },
        'leather-metal':       { businessModel: 'retail', plannerBusinessTypeAlias: 'leather-metal',modulesShown: ['dashboard','products','orders','production','commissions','maker'],                     goalsAvailable: UNIVERSAL_GOALS.concat(['project-timeline','bespoke-quotes','commission-management']) },
        'mixed-media-artist':  { businessModel: 'hybrid', plannerBusinessTypeAlias: 'mixed-media', modulesShown: ['dashboard','products','orders','gallery','commissions','maker'],                          goalsAvailable: UNIVERSAL_GOALS.concat(['portfolio-display','commission-management','editorial-features']) },
        'instructor-studio':   { businessModel: 'education', plannerBusinessTypeAlias: 'education',modulesShown: ['dashboard','classes','students','orders','newsletter'],                                    goalsAvailable: UNIVERSAL_GOALS.concat(['class-registration','waitlist-management','student-communication']) },
        'commissioned-services':{businessModel: 'commission', plannerBusinessTypeAlias: 'services',modulesShown: ['dashboard','commissions','orders','contacts','newsletter'],                               goalsAvailable: UNIVERSAL_GOALS.concat(['lead-capture','project-pipeline','deposit-tracking','commission-management']) },
        'other-maker':         { businessModel: 'hybrid', plannerBusinessTypeAlias: 'other',       modulesShown: ['dashboard','products','orders','gallery','maker'],                                        goalsAvailable: UNIVERSAL_GOALS.slice() }
      };

      // Spec §3 activation required fields.
      var REQUIRED_AT_ACTIVATE = [
        { section: 'identity',   path: 'archetype',                         label: 'identity.archetype' },
        { section: 'identity',   path: 'businessName',                      label: 'identity.businessName' },
        { section: 'people',     path: 'primaryContact.name',               label: 'people.primaryContact.name' },
        { section: 'people',     path: 'primaryContact.email',              label: 'people.primaryContact.email' },
        { section: 'people',     path: 'primaryContact.dpaAcceptedAt',      label: 'people.primaryContact.dpaAcceptedAt' },
        { section: 'engagement', path: 'mode',                              label: 'engagement.mode' },
        { section: 'engagement', path: 'surface',                           label: 'engagement.surface' },
        { section: 'operations', path: 'localization.currency',             label: 'operations.localization.currency' },
        { section: 'operations', path: 'localization.timezone',             label: 'operations.localization.timezone' },
        { section: 'operations', path: 'localization.language',             label: 'operations.localization.language' },
        { section: 'operations', path: 'localization.fiscalYearStartMonth', label: 'operations.localization.fiscalYearStartMonth' }
      ];

      // Phase 2 PA-5: compliance + ui are now first-class updatable sections.
      // compliance holds licenses/insurance/certifications/taxJurisdictions
      // arrays. ui holds small UI-state flags like renewalSeedDismissedAt.
      var UPDATABLE_SECTIONS = { identity: 1, presence: 1, operations: 1, people: 1, engagement: 1, compliance: 1, ui: 1 };

      function _dig(obj, dotted) {
        if (!obj) return undefined;
        var parts = dotted.split('.');
        var cur = obj;
        for (var i = 0; i < parts.length; i++) {
          if (cur === null || cur === undefined) return undefined;
          cur = cur[parts[i]];
        }
        return cur;
      }

      function _latestImportJob() {
        return tenantStore.query('webPresence/importJobs')
          .orderByChild('completedAt').limitToLast(1).once()
          .then(function(jobs) {
            if (!jobs) return null;
            var keys = Object.keys(jobs);
            if (!keys.length) return null;
            var latest = jobs[keys[0]];
            var d = (latest && latest.discovered) || {};
            return {
              lastScrapeAt: latest && latest.completedAt || null,
              scrapeUrl: latest && latest.url || null,
              manifest: d.manifest || null,
              inferredArchetype: d.inferredArchetype || null,
              archetypeConfidence: d.archetypeConfidence || null,
              inferredProductTypes: d.inferredProductTypes || [],
              inferredChannels: d.inferredChannels || []
            };
          })
          .catch(function() { return null; });
      }

      function _flatten(prefix, data, out) {
        for (var key in data) {
          if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
          var value = data[key];
          var path = prefix + '/' + key;
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            _flatten(path, value, out);
          } else {
            out[path] = value;
          }
        }
      }

      return {
        // Full entity read-view per spec §6.4 — reads canonical admin/businessEntity/*,
        // synthesizes visual from config/brand, discovery from latest import job.
        // Strips compliance/* (Phase 2, D5).
        get: function(section) {
          var req = section || 'all';
          return Promise.all([
            tenantStore.get('admin/businessEntity'),
            tenantStore.get('config/brand'),
            _latestImportJob()
          ]).then(function(results) {
            var ent = results[0] || {};
            var visual = results[1] || null;
            var discovery = results[2];
            if (req === 'all') {
              // Phase 2 PA-5: compliance is now first-class; return it alongside
              // visual + discovery. entityStatus is hoisted to a top-level field
              // so callers don't need to reach into the subsection map.
              var out = {};
              for (var k in ent) if (Object.prototype.hasOwnProperty.call(ent, k)) out[k] = ent[k];
              out.entityStatus = ent.entityStatus || 'none';
              out.visual = visual;
              out.discovery = discovery;
              return out;
            }
            if (req === 'visual') return { entityStatus: ent.entityStatus || 'none', section: 'visual', data: visual, _note: 'pointer to config/brand' };
            if (req === 'discovery') return { entityStatus: ent.entityStatus || 'none', section: 'discovery', data: discovery, _note: 'synthesized from latest webPresence/importJobs' };
            return { entityStatus: ent.entityStatus || 'none', section: req, data: ent[req] || null };
          });
        },

        // Pure lookup over the archetype taxonomy — no Firebase round-trip.
        archetypeDefaults: function(archetype) {
          return ARCHETYPE_DEFAULTS[archetype] || null;
        },

        // Direct-write fallback (Phase 1 dev-env). Promotes entityStatus none→draft
        // on first write. Future: route through mcpProxyUpdateBusinessEntity callable
        // once B-layer lands it so server-side EIN validator + audit log fire.
        update: function(section, data) {
          if (!UPDATABLE_SECTIONS[section]) {
            return Promise.reject(new Error("Cannot update section '" + section + "'. Updatable: identity, presence, operations, people, engagement."));
          }
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return Promise.reject(new Error('data must be a non-empty object'));
          }
          return tenantStore.get('admin/businessEntity/entityStatus').then(function(current) {
            var updates = {};
            _flatten('admin/businessEntity/' + section, data, updates);
            var now = new Date().toISOString();
            updates['admin/businessEntity/' + section + '/updatedAt'] = now;
            updates['admin/businessEntity/updatedAt'] = now;
            if (!current || current === 'none') {
              updates['admin/businessEntity/entityStatus'] = 'draft';
              updates['admin/businessEntity/createdAt'] = now;
              updates['admin/businessEntity/schemaVersion'] = 1;
            }
            return tenantStore.multiUpdate(updates).then(function() {
              return { success: true, section: section, entityStatus: (!current || current === 'none') ? 'draft' : current, updatedFields: Object.keys(data) };
            });
          });
        },

        // Verify required fields per spec §3, then flip entityStatus to 'active'.
        activate: function() {
          return tenantStore.get('admin/businessEntity').then(function(ent) {
            ent = ent || {};
            var missing = [];
            for (var i = 0; i < REQUIRED_AT_ACTIVATE.length; i++) {
              var req = REQUIRED_AT_ACTIVATE[i];
              var sec = ent[req.section];
              var v = _dig(sec, req.path);
              if (v === null || v === undefined || v === '') missing.push(req.label);
            }
            if (missing.length > 0) {
              var err = new Error('Cannot activate business entity — required fields missing');
              err.missingFields = missing;
              err.currentStatus = ent.entityStatus || 'none';
              return Promise.reject(err);
            }
            var now = new Date().toISOString();
            return tenantStore.multiUpdate({
              'admin/businessEntity/entityStatus': 'active',
              'admin/businessEntity/updatedAt': now
            }).then(function() {
              return { success: true, entityStatus: 'active', activatedAt: now };
            });
          });
        },

        // Subscribe to entity changes — single listener, fires with synthesized
        // read-view on each change. Mitigates read-cost amplification (plan risk
        // flag on Build A1): advisor can hydrate once + auto-update instead of
        // re-reading 4 docs per tab click.
        subscribe: function(callback) {
          var self = this;
          return tenantStore.subscribe('admin/businessEntity', function() {
            self.get().then(callback).catch(function(err) { console.warn('[MastDB.businessEntity.subscribe] get failed:', err); });
          });
        },

        // ─── channels (Phase 2 P2B Build PB-1) ───
        // OAuth-authenticated sales-channel integrations (Shopify / Etsy /
        // Square). Distinct from the Channel-First sales-channel entity at
        // admin/channels/{channelId}; the two coexist. Writes go through
        // the server-side channels-oauth MCP tools (connect_channel,
        // disconnect_channel, sync_channel, update_channel_sync_config)
        // because OAuth code exchange must own the Secret Manager write +
        // Firestore write together. Client-side `connect` / `disconnect` /
        // `sync` methods below are provided for tenant UI ergonomics but
        // require a browser→MCP bridge (mcpProxy*) that lands in PB-3/4/5
        // adapter sessions. For now they return a hint object; the real
        // entry points are the OAuth initiate/callback Cloud Functions.
        channels: (function() {
          var BASE = 'admin/businessEntity/channels';
          var VALID_PLATFORMS = { shopify: 1, etsy: 1, square: 1 };

          function _maskTokenRefs(rec) {
            if (!rec) return rec;
            var out = {};
            for (var k in rec) {
              if (!Object.prototype.hasOwnProperty.call(rec, k)) continue;
              if (k === 'tokenRef' || k === 'refreshTokenRef' || k === 'webhookSecretRef') {
                out[k] = rec[k] ? '••masked••' : null;
              } else {
                out[k] = rec[k];
              }
            }
            return out;
          }

          return {
            // List all OAuth-channel connections for this tenant.
            list: function() {
              return tenantStore.get(BASE).then(function(tree) {
                tree = tree || {};
                var out = [];
                for (var channelId in tree) {
                  if (!Object.prototype.hasOwnProperty.call(tree, channelId)) continue;
                  var rec = tree[channelId];
                  if (!rec || typeof rec !== 'object') continue;
                  out.push(Object.assign({ channelId: channelId }, _maskTokenRefs(rec)));
                }
                return out;
              });
            },

            // Read a single channel record (masked).
            getHealth: function(channelId) {
              if (!VALID_PLATFORMS[channelId]) {
                return Promise.reject(new Error("Invalid channelId '" + channelId + "'. Valid: shopify, etsy, square."));
              }
              return tenantStore.get(BASE + '/' + channelId).then(function(rec) {
                if (!rec) return { channelId: channelId, status: 'not-connected' };
                var expiresInSeconds = null;
                if (rec.expiresAt) {
                  var t = Date.parse(rec.expiresAt);
                  if (isFinite(t)) expiresInSeconds = Math.max(0, Math.round((t - Date.now()) / 1000));
                }
                return {
                  channelId: channelId,
                  status: rec.status || 'unknown',
                  connectedAt: rec.connectedAt || null,
                  lastSyncAt: rec.lastSyncAt || null,
                  lastErrorMessage: rec.lastErrorMessage || null,
                  webhookSubscriptionCount: Array.isArray(rec.webhookSubscriptions) ? rec.webhookSubscriptions.length : 0,
                  expiresAt: rec.expiresAt || null,
                  expiresInSeconds: expiresInSeconds,
                  syncConfig: rec.syncConfig || null
                };
              });
            },

            // Subscribe to channel changes (fires with refreshed list() on every write).
            subscribe: function(callback) {
              var self = this;
              return tenantStore.subscribe(BASE, function() {
                self.list().then(callback).catch(function(err) {
                  console.warn('[MastDB.businessEntity.channels.subscribe] list failed:', err);
                });
              });
            },

            // Client-side OAuth initiate — returns a hint. The real flow is:
            // browser → shopifyOAuthInitiate / etsyOAuthInitiate / squareOAuthInitiate
            // Cloud Function → redirect to platform consent. PB-3/4/5 wire this.
            // PB-1 returns the OAuth-initiate URL pattern so UI code can target it.
            connect: function(platform /*, authCode (unused in PB-1) */) {
              if (!VALID_PLATFORMS[platform]) {
                return Promise.reject(new Error("Invalid platform '" + platform + "'. Valid: shopify, etsy, square."));
              }
              return Promise.resolve({
                ok: false,
                platform: platform,
                error: 'mcp-bridge-not-wired',
                hint: 'Call the OAuth initiate Cloud Function (' + platform + 'OAuthInitiate) to get the authorize URL + redirect the browser. The callback CF completes connect_channel via MCP. PB-1 ships the server side; UI wiring comes in PB-3/4/5.'
              });
            },

            // Client-side disconnect — same hint posture as connect().
            disconnect: function(channelId) {
              if (!VALID_PLATFORMS[channelId]) {
                return Promise.reject(new Error("Invalid channelId '" + channelId + "'. Valid: shopify, etsy, square."));
              }
              return Promise.resolve({
                ok: false,
                channelId: channelId,
                error: 'mcp-bridge-not-wired',
                hint: 'Disconnect runs on the server via the disconnect_channel MCP tool. PB-3/4/5 wire the browser → MCP bridge; PB-7 adds the cascading disconnect flow.'
              });
            },

            // Client-side manual sync — same hint posture.
            sync: function(channelId /*, direction */) {
              if (!VALID_PLATFORMS[channelId]) {
                return Promise.reject(new Error("Invalid channelId '" + channelId + "'. Valid: shopify, etsy, square."));
              }
              return Promise.resolve({
                ok: false,
                channelId: channelId,
                error: 'mcp-bridge-not-wired',
                hint: 'Manual sync runs on the server via the sync_channel MCP tool. PB-3/4/5 wire the handler per platform.'
              });
            },

            // Update syncConfig (direction/cadence) — writes directly (settings are
            // not OAuth-secret-dependent). Server-side mirror is the
            // update_channel_sync_config MCP tool; this direct write is the
            // ergonomic path used in Settings UI.
            updateSyncConfig: function(channelId, patch) {
              if (!VALID_PLATFORMS[channelId]) {
                return Promise.reject(new Error("Invalid channelId '" + channelId + "'. Valid: shopify, etsy, square."));
              }
              if (!patch || typeof patch !== 'object') {
                return Promise.reject(new Error('patch must be a non-empty object'));
              }
              return tenantStore.get(BASE + '/' + channelId).then(function(rec) {
                if (!rec) throw new Error('channel ' + channelId + ' not connected');
                var current = rec.syncConfig || { direction: 'pull-only', cadence: 'realtime' };
                var next = {
                  direction: patch.direction || current.direction,
                  cadence: patch.cadence || current.cadence
                };
                var now = new Date().toISOString();
                return tenantStore.multiUpdate({
                  [BASE + '/' + channelId + '/syncConfig']: next,
                  [BASE + '/' + channelId + '/updatedAt']: now
                }).then(function() {
                  return { ok: true, channelId: channelId, syncConfig: next };
                });
              });
            }
          };
        })(),

        // ──────────────────────────────────────────────────────────
        // Phase 2 PA-4 — documents sub-namespace.
        //
        // Metadata lives at admin/businessEntity_documents/{id} which the
        // namespace translator routes to collection admin_businessEntity_documents.
        // Blob lives at gs://mast-platform-prod.firebasestorage.app/{tenantId}/
        // compliance-documents/{id}/{filename}. Upload orchestrates a three-step
        // flow through Cloud Functions so the browser never holds raw admin
        // credentials.
        //
        // Spec references:
        //   - admin/businessEntity_documents path: spec §4.1 D8 + tenant MCP
        //     documents.ts storage layout
        //   - upload + finalize orchestration: PA-3 issueDocumentUploadUrl +
        //     finalizeDocumentUpload CFs
        //   - Signed URL TTL: 5 min for PUT, 30 sec for GET (spec §4.1 D8)
        //
        // What's direct-write vs. CF-mediated:
        //   - list/get/subscribe: direct Firestore reads
        //   - upload: CF issueDocumentUploadUrl → fetch PUT → CF
        //     finalizeDocumentUpload (admin SDK required for signed URL +
        //     blob verification)
        //   - link: direct Firestore write (mirrors Phase 1 A1 "direct-write
        //     fallback"; server-validation path is the tenant MCP
        //     link_document_to_entity tool for AI-assistant callers)
        //   - delete: direct Firestore write flipping status to
        //     deleted-pending-purge; PA-3 redactDocumentScheduled CF
        //     eventually purges the blob and flips status to redacted
        // ──────────────────────────────────────────────────────────
        documents: (function() {
          var COLLECTION_PATH = 'admin/businessEntity_documents';
          var VALID_SECTIONS = {
            'compliance.licenses': 1,
            'compliance.insurance': 1,
            'compliance.certifications': 1,
            'compliance.taxJurisdictions': 1
          };

          return {
            list: function(filter) {
              return tenantStore.list(COLLECTION_PATH).then(function(docs) {
                var out = [];
                for (var id in docs) {
                  if (!Object.prototype.hasOwnProperty.call(docs, id)) continue;
                  var d = docs[id];
                  if (!d) continue;
                  if (filter) {
                    if (filter.purpose && d.purpose !== filter.purpose) continue;
                    if (filter.status && d.status !== filter.status) continue;
                    if (filter.linkedSection) {
                      var ln = d.linkedTo;
                      if (!ln || ln.section !== filter.linkedSection) continue;
                    }
                    if (filter.unlinked === true && d.linkedTo) continue;
                  }
                  out.push(d);
                }
                out.sort(function(a, b) {
                  var ta = a.createdAt || '';
                  var tb = b.createdAt || '';
                  return tb < ta ? -1 : tb > ta ? 1 : 0;
                });
                return out;
              });
            },

            // Returns { metadata, signedGetUrl, _note }. signedGetUrl is null
            // in S2 — a browser-callable getDocument CF is deferred to PA-5.
            get: function(documentId) {
              if (!documentId || typeof documentId !== 'string') {
                return Promise.reject(new Error('documentId is required'));
              }
              return tenantStore.get(COLLECTION_PATH + '/' + documentId).then(function(meta) {
                if (!meta) return null;
                return { metadata: meta, signedGetUrl: null, _note: 'signedGetUrl unavailable in S2; PA-5 will add a getDocument CF.' };
              });
            },

            // Orchestrated upload.
            //   1. CF issueDocumentUploadUrl → {documentId, signedPutUrl}
            //   2. PUT blob to signedPutUrl (5-min TTL)
            //   3. CF finalizeDocumentUpload → flip status to 'uploaded'
            // Returns { success, documentId, status, sizeBytes } or
            // { success: false, step, error } indicating which step broke.
            upload: function(file, purpose) {
              if (!file || !(file instanceof File || file instanceof Blob)) {
                return Promise.reject(new Error('file must be a File or Blob instance'));
              }
              if (!purpose || typeof purpose !== 'string') {
                return Promise.reject(new Error('purpose is required'));
              }
              var filename = file.name || ('upload-' + Date.now());
              var mimeType = file.type || 'application/octet-stream';
              var sizeBytes = file.size;

              var issue = firebase.functions().httpsCallable('issueDocumentUploadUrl');
              return issue({
                tenantId: _tenantId,
                purpose: purpose,
                filename: filename,
                mimeType: mimeType,
                sizeBytes: sizeBytes
              }).then(function(res) {
                var d = (res && res.data) || {};
                if (!d.success || !d.documentId || !d.signedPutUrl) {
                  throw Object.assign(new Error('issueDocumentUploadUrl returned no URL'), { step: 'issue', cfResult: d });
                }
                return fetch(d.signedPutUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': mimeType },
                  body: file
                }).then(function(putRes) {
                  if (!putRes.ok) {
                    return putRes.text().then(function(body) {
                      throw Object.assign(new Error('PUT to signed URL failed: ' + putRes.status), { step: 'put', status: putRes.status, body: body && body.slice(0, 200) });
                    });
                  }
                  var finalize = firebase.functions().httpsCallable('finalizeDocumentUpload');
                  return finalize({ tenantId: _tenantId, documentId: d.documentId }).then(function(finRes) {
                    var f = (finRes && finRes.data) || {};
                    if (!f.success) {
                      throw Object.assign(new Error('finalizeDocumentUpload returned no success'), { step: 'finalize', cfResult: f });
                    }
                    return { success: true, documentId: d.documentId, status: f.status, sizeBytes: f.sizeBytes };
                  });
                });
              }).catch(function(err) {
                var step = err && err.step ? err.step : 'unknown';
                console.warn('[MastDB.businessEntity.documents.upload] step=' + step + ':', err && err.message);
                return { success: false, step: step, error: err && err.message };
              });
            },

            // Link a document to a compliance section item. Two-write sequence
            // (entity compliance array + document metadata); a partial write
            // can be recovered by re-running link.
            link: function(documentId, section, arrayIndex, field) {
              if (!documentId || typeof documentId !== 'string') return Promise.reject(new Error('documentId is required'));
              if (!VALID_SECTIONS[section]) return Promise.reject(new Error("Invalid section '" + section + "'. Allowed: " + Object.keys(VALID_SECTIONS).join(', ')));
              if (field !== 'documentId') return Promise.reject(new Error("field must be 'documentId'"));
              if (typeof arrayIndex !== 'number' || arrayIndex < 0 || !isFinite(arrayIndex)) return Promise.reject(new Error('arrayIndex must be a non-negative integer'));

              return tenantStore.get(COLLECTION_PATH + '/' + documentId).then(function(meta) {
                if (!meta) throw new Error('Document ' + documentId + ' not found');
                if (meta.linkedTo) throw new Error('Document already linked to ' + meta.linkedTo.section + '[' + meta.linkedTo.arrayIndex + '].' + meta.linkedTo.field);
                if (meta.status === 'redacted' || meta.status === 'deleted-pending-purge') {
                  throw new Error('Cannot link ' + meta.status + ' document');
                }

                var arrayField = section.split('.')[1];
                var compliancePath = 'admin/businessEntity/compliance';
                return tenantStore.get(compliancePath).then(function(comp) {
                  comp = comp || {};
                  var arr = Array.isArray(comp[arrayField]) ? comp[arrayField].slice() : [];
                  if (arrayIndex >= arr.length) throw new Error('arrayIndex ' + arrayIndex + ' out of bounds (' + arrayField + ' has ' + arr.length + ' items)');
                  arr[arrayIndex] = Object.assign({}, arr[arrayIndex], { documentId: documentId });
                  var now = new Date().toISOString();
                  var patch = {};
                  patch[arrayField] = arr;
                  patch.updatedAt = now;

                  return tenantStore.update(compliancePath, patch).then(function() {
                    var newStatus = meta.status === 'uploaded-pending' ? 'uploaded' : meta.status;
                    return tenantStore.update(COLLECTION_PATH + '/' + documentId, {
                      linkedTo: { section: section, arrayIndex: arrayIndex, field: field },
                      status: newStatus,
                      updatedAt: now
                    }).then(function() {
                      return { success: true, documentId: documentId, linkedTo: { section: section, arrayIndex: arrayIndex, field: field }, status: newStatus };
                    });
                  });
                });
              });
            },

            // Soft-delete: flips status to deleted-pending-purge. PA-3
            // redactDocumentScheduled runs every 6h, purges the blob, and
            // flips status to 'redacted'. Tombstone metadata stays for audit.
            delete: function(documentId) {
              if (!documentId || typeof documentId !== 'string') return Promise.reject(new Error('documentId is required'));
              return tenantStore.get(COLLECTION_PATH + '/' + documentId).then(function(meta) {
                if (!meta) throw new Error('Document ' + documentId + ' not found');
                if (meta.status === 'redacted') throw new Error('Document already redacted');
                if (meta.retentionPolicy === 'federal-floor') {
                  var createdAtMs = meta.createdAt ? Date.parse(meta.createdAt) : Date.now();
                  var earliestDelete = createdAtMs + 7 * 365 * 24 * 60 * 60 * 1000;
                  if (Date.now() < earliestDelete) {
                    var err = new Error('Document is under federal-floor retention until ' + new Date(earliestDelete).toISOString());
                    err.retentionPolicy = 'federal-floor';
                    err.earliestDeleteAt = new Date(earliestDelete).toISOString();
                    throw err;
                  }
                }
                var now = new Date().toISOString();
                return tenantStore.update(COLLECTION_PATH + '/' + documentId, {
                  status: 'deleted-pending-purge',
                  redactionRequestedAt: now,
                  updatedAt: now
                }).then(function() {
                  return { success: true, documentId: documentId, status: 'deleted-pending-purge' };
                });
              });
            },

            // Collection-level subscription. Fires on every document change
            // with the full sorted list. Consumers (Settings > Compliance,
            // advisor pending-doc card) should tear down via the returned
            // unsubscribe function to avoid read-cost amplification.
            subscribe: function(cb) {
              return tenantStore.subscribe(COLLECTION_PATH, function(snap) {
                var data = snap && typeof snap.val === 'function' ? snap.val() : snap;
                if (!data) { cb([]); return; }
                var list = [];
                for (var id in data) if (Object.prototype.hasOwnProperty.call(data, id)) list.push(data[id]);
                list.sort(function(a, b) {
                  var ta = (a && a.createdAt) || '';
                  var tb = (b && b.createdAt) || '';
                  return tb < ta ? -1 : tb > ta ? 1 : 0;
                });
                cb(list);
              });
            }
          };
        })(),

        // ──────────────────────────────────────────────────────────
        // Phase 2 PA-4 — renewals sub-namespace.
        //
        // Items: admin/businessEntity_renewalItems/{id} → collection
        //        admin_businessEntity_renewalItems.
        // Settings: admin/businessEntity/renewals → document in
        //           admin_businessEntity alongside identity/people/engagement.
        //
        // SMS is explicitly absent. spec-bugs 6b ratified 2026-04-23: email +
        // in-app only. No acceptSmsConsent method, no SMS-settings field in
        // updateSettings payload. Defense-in-depth: updateSettings and update
        // strip any legacy sms payload with a console warning.
        //
        // What's direct-write vs. CF-mediated:
        //   - listItems / getSettings / subscribeItems / subscribeSettings:
        //     direct Firestore reads
        //   - create / update / snooze / archive / markComplete: direct
        //     Firestore writes (Phase 1 A1 direct-write pattern — server
        //     validator lives in tenant MCP renewals.ts for AI-callers)
        //   - updateSettings / resetIcsFeedToken: direct Firestore writes
        //     (reset_ics_feed_token tenant MCP tool is parity path for AI)
        //   - seedFromCompliance: PA-3 seedRenewalsFromCompliance CF
        //     (admin-SDK-mediated so sourceRef idempotency is reliable)
        // ──────────────────────────────────────────────────────────
        renewals: (function() {
          var ITEMS_PATH = 'admin/businessEntity_renewalItems';
          var SETTINGS_PATH = 'admin/businessEntity/renewals';
          var VALID_SOURCE_TYPES = ['license','insurance','certification','tax-filing','domain','channel-token','other'];
          var VALID_CADENCES = ['short-fuse','long-fuse'];

          var DEFAULT_CADENCE_BY_SOURCE = {
            'domain': 'short-fuse',
            'tax-filing': 'short-fuse',
            'channel-token': 'short-fuse',
            'license': 'long-fuse',
            'insurance': 'long-fuse',
            'certification': 'long-fuse',
            'other': 'long-fuse'
          };

          // Mirrors RENEWAL_DEFAULT_TICKS in tenant MCP renewals.ts and
          // DEFAULT_TICKS in PA-3 renewals-scheduler.js. Keep in lockstep.
          var DEFAULT_TICKS = {
            shortFuse: [30, 14, 7, 1],
            longFuse: [60, 30, 14, 7, 1]
          };

          function _uuid() {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
            return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
          }

          function _computeInitialNextReminderAt(cadence, expiresAt) {
            var ticks = cadence === 'short-fuse' ? DEFAULT_TICKS.shortFuse : DEFAULT_TICKS.longFuse;
            var maxTick = Math.max.apply(null, ticks);
            var expiresMs = Date.parse(expiresAt);
            if (!isFinite(expiresMs)) return null;
            var reminderMs = expiresMs - maxTick * 24 * 60 * 60 * 1000;
            return new Date(Math.max(reminderMs, Date.now())).toISOString();
          }

          return {
            listItems: function(filter) {
              return tenantStore.list(ITEMS_PATH).then(function(items) {
                var out = [];
                for (var id in items) {
                  if (!Object.prototype.hasOwnProperty.call(items, id)) continue;
                  var it = items[id];
                  if (!it) continue;
                  if (filter) {
                    if (filter.status && it.status !== filter.status) continue;
                    if (filter.sourceType && it.sourceType !== filter.sourceType) continue;
                    if (filter.activeOnly && (it.archived === true || it.status === 'archived' || it.status === 'completed')) continue;
                  }
                  out.push(it);
                }
                out.sort(function(a, b) {
                  var ea = a.expiresAt || '';
                  var eb = b.expiresAt || '';
                  return ea < eb ? -1 : ea > eb ? 1 : 0;
                });
                return out;
              });
            },

            create: function(sourceType, title, expiresAt, cadence, sourceRef) {
              if (VALID_SOURCE_TYPES.indexOf(sourceType) === -1) {
                return Promise.reject(new Error("Invalid sourceType '" + sourceType + "'. Valid: " + VALID_SOURCE_TYPES.join(', ')));
              }
              if (typeof title !== 'string' || title.trim().length === 0) {
                return Promise.reject(new Error('title is required'));
              }
              if (!expiresAt || !isFinite(Date.parse(expiresAt))) {
                return Promise.reject(new Error('expiresAt must be an ISO 8601 timestamp'));
              }
              if (cadence !== undefined && cadence !== null && VALID_CADENCES.indexOf(cadence) === -1) {
                return Promise.reject(new Error("Invalid cadence '" + cadence + "'. Valid: " + VALID_CADENCES.join(', ')));
              }
              var resolvedCadence = cadence || DEFAULT_CADENCE_BY_SOURCE[sourceType] || 'long-fuse';
              var itemId = _uuid();
              var now = new Date().toISOString();
              var nextReminderAt = _computeInitialNextReminderAt(resolvedCadence, expiresAt);

              var record = {
                id: itemId,
                sourceType: sourceType,
                title: title.trim(),
                expiresAt: expiresAt,
                cadence: resolvedCadence,
                sourceRef: sourceRef || null,
                status: 'active',
                snoozeUntil: null,
                nextReminderAt: nextReminderAt,
                lastReminderFiredAt: null,
                deliveryErrors: [],
                reminderChannelOverride: null,
                createdAt: now,
                updatedAt: now
              };
              return tenantStore.set(ITEMS_PATH + '/' + itemId, record).then(function() {
                return { success: true, itemId: itemId, sourceType: sourceType, cadence: resolvedCadence, nextReminderAt: nextReminderAt };
              });
            },

            update: function(itemId, data) {
              if (!itemId || typeof itemId !== 'string') return Promise.reject(new Error('itemId is required'));
              if (!data || typeof data !== 'object') return Promise.reject(new Error('data must be an object'));
              var ALLOWED = { title: 1, expiresAt: 1, cadence: 1, sourceRef: 1, reminderChannelOverride: 1 };
              var patch = { updatedAt: new Date().toISOString() };
              for (var k in data) {
                if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
                if (!ALLOWED[k]) continue;
                // Defense in depth for spec-bugs 6b.
                if (k === 'reminderChannelOverride') {
                  var v = data[k];
                  if (v === 'sms' || (Array.isArray(v) && v.indexOf('sms') !== -1)) {
                    console.warn('[MastDB.businessEntity.renewals.update] dropping sms channel override (spec-bugs 6b)');
                    continue;
                  }
                }
                patch[k] = data[k];
              }
              return tenantStore.update(ITEMS_PATH + '/' + itemId, patch).then(function() {
                return { success: true, itemId: itemId, updatedFields: Object.keys(patch).filter(function(x){return x!=='updatedAt';}) };
              });
            },

            snooze: function(itemId, snoozeUntil) {
              if (!itemId || typeof itemId !== 'string') return Promise.reject(new Error('itemId is required'));
              if (!snoozeUntil || !isFinite(Date.parse(snoozeUntil))) return Promise.reject(new Error('snoozeUntil must be an ISO 8601 timestamp'));
              var now = new Date().toISOString();
              return tenantStore.update(ITEMS_PATH + '/' + itemId, {
                snoozeUntil: snoozeUntil,
                status: 'snoozed',
                nextReminderAt: snoozeUntil,
                updatedAt: now
              }).then(function() {
                return { success: true, itemId: itemId, snoozeUntil: snoozeUntil };
              });
            },

            archive: function(itemId) {
              if (!itemId || typeof itemId !== 'string') return Promise.reject(new Error('itemId is required'));
              var now = new Date().toISOString();
              return tenantStore.update(ITEMS_PATH + '/' + itemId, {
                status: 'archived',
                archived: true,
                nextReminderAt: null,
                updatedAt: now
              }).then(function() {
                return { success: true, itemId: itemId, status: 'archived' };
              });
            },

            markComplete: function(itemId, newExpiresAt) {
              if (!itemId || typeof itemId !== 'string') return Promise.reject(new Error('itemId is required'));
              if (newExpiresAt !== undefined && newExpiresAt !== null && !isFinite(Date.parse(newExpiresAt))) {
                return Promise.reject(new Error('newExpiresAt must be an ISO 8601 timestamp'));
              }
              var now = new Date().toISOString();
              return tenantStore.update(ITEMS_PATH + '/' + itemId, {
                status: 'completed',
                completedAt: now,
                nextReminderAt: null,
                updatedAt: now
              }).then(function() {
                return { success: true, itemId: itemId, status: 'completed', completedAt: now, _note: newExpiresAt ? 'Call create() for the new cycle using newExpiresAt' : null };
              });
            },

            getSettings: function() {
              return tenantStore.get(SETTINGS_PATH).then(function(s) { return s || {}; });
            },

            updateSettings: function(data) {
              if (!data || typeof data !== 'object') return Promise.reject(new Error('data must be an object'));
              var patch = Object.assign({}, data);
              // spec-bugs 6b: drop any SMS-related settings at write.
              if (patch.defaultChannels && typeof patch.defaultChannels === 'object') {
                if ('sms' in patch.defaultChannels) {
                  console.warn('[MastDB.businessEntity.renewals.updateSettings] dropping defaultChannels.sms (spec-bugs 6b)');
                  delete patch.defaultChannels.sms;
                }
              }
              if (patch.smsConsent) {
                console.warn('[MastDB.businessEntity.renewals.updateSettings] dropping smsConsent payload (spec-bugs 6b)');
                delete patch.smsConsent;
              }
              patch.updatedAt = new Date().toISOString();
              return tenantStore.update(SETTINGS_PATH, patch).then(function() {
                return { success: true, updatedFields: Object.keys(patch).filter(function(x){return x!=='updatedAt';}) };
              });
            },

            resetIcsFeedToken: function() {
              var now = new Date().toISOString();
              var newToken = _uuid().replace(/-/g, '');
              return tenantStore.get(SETTINGS_PATH).then(function(s) {
                s = s || {};
                var newIcsFeed = {
                  token: newToken,
                  enabledAt: (s.icsFeed && s.icsFeed.enabledAt) || now,
                  rotatedAt: now
                };
                return tenantStore.update(SETTINGS_PATH, {
                  icsFeed: newIcsFeed,
                  updatedAt: now
                }).then(function() {
                  return { success: true, token: newToken, rotatedAt: now };
                });
              });
            },

            seedFromCompliance: function(dryRun) {
              var fn = firebase.functions().httpsCallable('seedRenewalsFromCompliance');
              return fn({ tenantId: _tenantId, dryRun: dryRun !== false }).then(function(res) {
                return (res && res.data) || {};
              });
            },

            subscribeItems: function(cb) {
              return tenantStore.subscribe(ITEMS_PATH, function(snap) {
                var data = snap && typeof snap.val === 'function' ? snap.val() : snap;
                if (!data) { cb([]); return; }
                var list = [];
                for (var id in data) if (Object.prototype.hasOwnProperty.call(data, id)) list.push(data[id]);
                list.sort(function(a, b) {
                  var ea = (a && a.expiresAt) || '';
                  var eb = (b && b.expiresAt) || '';
                  return ea < eb ? -1 : ea > eb ? 1 : 0;
                });
                cb(list);
              });
            },

            subscribeSettings: function(cb) {
              return tenantStore.subscribe(SETTINGS_PATH, function(snap) {
                var data = snap && typeof snap.val === 'function' ? snap.val() : snap;
                cb(data || {});
              });
            }
          };
        })(),

        // ──────────────────────────────────────────────────────────
        // Phase 2 P2D-S1 — conversational capture sub-namespace.
        //
        // Collection: admin/businessEntity_capturePending/{captureId}
        //             → Firestore collection admin_businessEntity_capturePending.
        //
        // Pending-review workflow (per spec §3.4):
        //   pending-review --ratify--> ratified  (entity write fires here)
        //   pending-review --reject--> rejected
        //
        // CC's core RULE: "Claude proposes, CC captures, user ratifies."
        // Conversational skills (via tenant MCP) write ONLY to pending-review
        // state. User ratifies via the advisor diff-review modal, which calls
        // ratify() here — that's the single entry point that triggers the
        // actual entity write (through MastDB.businessEntity.update).
        //
        // Direct-write vs CF-mediated:
        //   - list / subscribe: direct Firestore reads (admin-only rules)
        //   - ratify: direct read of pending doc + direct call to
        //     MastDB.businessEntity.update(targetSection, filtered) + direct
        //     update of pending doc status. No CF wrapper — the browser is
        //     already admin-authenticated; entity writes go through the same
        //     PA-3 server-side validator that powers Settings.
        //   - reject: direct Firestore update of pending doc status.
        //
        // 'unknown' sentinel: the conversational AI writes literal string
        // 'unknown' for fields the user deferred. ratify() strips these
        // before the entity write so the sentinel doesn't pollute
        // identity/people/etc. Null is disallowed because null can't be
        // distinguished from "user never saw the prompt."
        // ──────────────────────────────────────────────────────────
        capture: (function() {
          var COLLECTION_PATH = 'admin/businessEntity_capturePending';
          var UNKNOWN_SENTINEL = 'unknown';
          var VALID_STATUSES = ['pending-review', 'ratified', 'rejected', 'expired'];
          // Mirror of UPDATABLE_ENTITY_SECTIONS in the tenant MCP entity.ts.
          var CAPTURE_TARGET_SECTIONS = ['identity', 'presence', 'operations', 'people', 'compliance', 'engagement'];

          // Recursively drop fields equal to the 'unknown' sentinel. Arrays
          // filter out sentinels (keep other items). Mirrors the tenant MCP
          // capture.ts stripUnknown helper.
          function _stripUnknown(data) {
            if (data === UNKNOWN_SENTINEL) return undefined;
            if (Array.isArray(data)) {
              var out = [];
              for (var i = 0; i < data.length; i++) {
                var v = _stripUnknown(data[i]);
                if (v !== undefined) out.push(v);
              }
              return out;
            }
            if (data !== null && typeof data === 'object') {
              var result = {};
              for (var k in data) {
                if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
                var sv = _stripUnknown(data[k]);
                if (sv !== undefined) result[k] = sv;
              }
              return result;
            }
            return data;
          }

          function _filterAcceptedFields(proposedData, acceptedFields) {
            if (!acceptedFields || !acceptedFields.length) return proposedData;
            var allowed = {};
            for (var i = 0; i < acceptedFields.length; i++) allowed[acceptedFields[i]] = true;
            var out = {};
            for (var k in proposedData) {
              if (!Object.prototype.hasOwnProperty.call(proposedData, k)) continue;
              if (allowed[k]) out[k] = proposedData[k];
            }
            return out;
          }

          function _sortByCreatedAtDesc(items) {
            items.sort(function(a, b) {
              var ta = (a && a.createdAt) || '';
              var tb = (b && b.createdAt) || '';
              return tb < ta ? -1 : tb > ta ? 1 : 0;
            });
          }

          return {
            list: function(filter) {
              return tenantStore.list(COLLECTION_PATH).then(function(items) {
                var out = [];
                var effStatus = (filter && filter.status) || 'pending-review';
                for (var id in items) {
                  if (!Object.prototype.hasOwnProperty.call(items, id)) continue;
                  var it = items[id];
                  if (!it) continue;
                  if (it.status !== effStatus) continue;
                  if (filter && filter.section && it.targetSection !== filter.section) continue;
                  out.push(it);
                }
                _sortByCreatedAtDesc(out);
                return out;
              });
            },

            get: function(captureId) {
              if (!captureId) return Promise.reject(new Error('captureId is required'));
              return tenantStore.get(COLLECTION_PATH + '/' + captureId);
            },

            // Ratify: user accepted the proposed capture via the diff-review
            // modal. Filter to acceptedFields[], strip 'unknown' sentinels,
            // delegate the surviving fields to MastDB.businessEntity.update.
            // If nothing remains after filtering, mark ratified but skip the
            // entity write (matches tenant MCP ratify_capture's
            // entityWriteSkipped path).
            ratify: function(captureId, acceptedFields) {
              if (!captureId) return Promise.reject(new Error('captureId is required'));
              if (acceptedFields !== undefined && !Array.isArray(acceptedFields)) {
                return Promise.reject(new Error('acceptedFields must be an array of top-level field names (or omit)'));
              }
              var docPath = COLLECTION_PATH + '/' + captureId;
              return tenantStore.get(docPath).then(function(cap) {
                if (!cap) throw new Error('Capture ' + captureId + ' not found');
                if (cap.status !== 'pending-review') {
                  throw new Error('Capture ' + captureId + ' is ' + cap.status + ' (only pending-review captures can be ratified)');
                }
                if (CAPTURE_TARGET_SECTIONS.indexOf(cap.targetSection) === -1) {
                  throw new Error("Refusing to ratify: invalid targetSection '" + cap.targetSection + "' on capture doc");
                }

                var filtered = _filterAcceptedFields(cap.proposedData || {}, acceptedFields);
                var writeData = _stripUnknown(filtered);
                var now = new Date().toISOString();

                if (!writeData || typeof writeData !== 'object' || !Object.keys(writeData).length) {
                  // Empty after filtering (all fields unknown or none accepted).
                  return tenantStore.update(docPath, {
                    status: 'ratified',
                    ratifiedAt: now,
                    ratifiedFields: [],
                    updatedAt: now
                  }).then(function() {
                    return { success: true, captureId: captureId, status: 'ratified', entityWriteSkipped: true };
                  });
                }

                // Delegate the entity write to the parent namespace's update().
                // window.MastDB is fully initialized by the time ratify is
                // invoked (user-triggered UI action post page-load).
                var parent = (typeof window !== 'undefined' && window.MastDB) ? window.MastDB.businessEntity : null;
                if (!parent || typeof parent.update !== 'function') {
                  throw new Error('MastDB.businessEntity.update is not available');
                }
                return parent.update(cap.targetSection, writeData).then(function(res) {
                  if (!res || !res.success) {
                    throw new Error('Entity write failed during ratification: ' + (res && res.error ? res.error : 'unknown'));
                  }
                  return tenantStore.update(docPath, {
                    status: 'ratified',
                    ratifiedAt: now,
                    ratifiedFields: Object.keys(writeData),
                    updatedAt: now
                  }).then(function() {
                    return {
                      success: true,
                      captureId: captureId,
                      status: 'ratified',
                      targetSection: cap.targetSection,
                      writtenFields: Object.keys(writeData)
                    };
                  });
                });
              });
            },

            // Reject: user declined the proposed capture. No entity write.
            // Optional free-text reason helps skill improvement; not surfaced
            // to other users.
            reject: function(captureId, reason) {
              if (!captureId) return Promise.reject(new Error('captureId is required'));
              var docPath = COLLECTION_PATH + '/' + captureId;
              return tenantStore.get(docPath).then(function(cap) {
                if (!cap) throw new Error('Capture ' + captureId + ' not found');
                if (cap.status !== 'pending-review') {
                  throw new Error('Capture ' + captureId + ' is ' + cap.status + ' (only pending-review captures can be rejected)');
                }
                var normalizedReason = (typeof reason === 'string' && reason.trim().length > 0) ? reason.trim() : null;
                var now = new Date().toISOString();
                return tenantStore.update(docPath, {
                  status: 'rejected',
                  rejectedAt: now,
                  rejectedReason: normalizedReason,
                  updatedAt: now
                }).then(function() {
                  return { success: true, captureId: captureId, status: 'rejected', rejectedReason: normalizedReason };
                });
              });
            },

            subscribe: function(cb) {
              return tenantStore.subscribe(COLLECTION_PATH, function(snap) {
                var data = snap && typeof snap.val === 'function' ? snap.val() : snap;
                if (!data) { cb([]); return; }
                var list = [];
                for (var id in data) if (Object.prototype.hasOwnProperty.call(data, id)) {
                  var it = data[id];
                  if (it && it.status === 'pending-review') list.push(it);
                }
                _sortByCreatedAtDesc(list);
                cb(list);
              });
            },

            UNKNOWN_SENTINEL: UNKNOWN_SENTINEL,
            VALID_STATUSES: VALID_STATUSES,
            TARGET_SECTIONS: CAPTURE_TARGET_SECTIONS
          };
        })()
      };
    })(),
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
