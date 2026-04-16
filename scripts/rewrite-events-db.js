#!/usr/bin/env node
// Rewrite events.js DB object to use MastDB operations instead of _ref
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'app', 'modules', 'events.js');
let src = fs.readFileSync(FILE, 'utf8');

// 1. Replace the DB object (lines 15-125) with MastDB-based version
const oldDB = `  var DB = {
    ref: function(path) { return MastDB._ref(path); },
    newKey: function(path) { return MastDB.newKey(path); },
    storagePath: function(sub) { return MastDB.tenantId() + '/' + sub; },

    shows: {
      ref: function(id) { return DB.ref('events/shows' + (id ? '/' + id : '')); },
      list: function(limit) { return this.ref().limitToLast(limit || 200).once('value'); },
      get: function(id) { return this.ref(id).once('value'); },
      set: function(id, data) { return this.ref(id).set(data); },
      update: function(id, data) { return this.ref(id).update(data); },
      remove: function(id) { return this.ref(id).remove(); },
      newKey: function() { return this.ref().push().key; },
      listen: function(limit, cb, errCb) { return this.ref().limitToLast(limit || 200).on('value', cb, errCb); },
      unlisten: function(h) { this.ref().off('value', h); }
    },
    booths: {
      ref: function(showId, boothId) { return DB.ref('events/booths/' + showId + (boothId ? '/' + boothId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 500).once('value'); },
      set: function(showId, boothId, data) { return this.ref(showId, boothId).set(data); },
      update: function(showId, boothId, data) { return this.ref(showId, boothId).update(data); },
      remove: function(showId, boothId) { return this.ref(showId, boothId).remove(); },
      newKey: function(showId) { return this.ref(showId).push().key; },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 500).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    boothPins: {
      ref: function(showId, boothId) { return DB.ref('events/boothPins/' + showId + (boothId ? '/' + boothId : '')); },
      get: function(showId) { return this.ref(showId).once('value'); },
      set: function(showId, boothId, data) { return this.ref(showId, boothId).set(data); },
      remove: function(showId, boothId) { if (boothId) return this.ref(showId, boothId).remove(); return this.ref(showId).remove(); },
      listen: function(showId, cb, errCb) { return this.ref(showId).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    showsBySlug: {
      ref: function(slug) { return DB.ref('events/showsBySlug' + (slug ? '/' + slug : '')); },
      set: function(slug, showId) { return this.ref(slug).set(showId); },
      remove: function(slug) { return this.ref(slug).remove(); }
    },
    vendors: {
      ref: function(showId, vendorId) { return DB.ref('events/vendors/' + showId + (vendorId ? '/' + vendorId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 500).once('value'); },
      set: function(showId, vendorId, data) { return this.ref(showId, vendorId).set(data); },
      update: function(showId, vendorId, data) { return this.ref(showId, vendorId).update(data); },
      remove: function(showId, vendorId) { return this.ref(showId, vendorId).remove(); },
      newKey: function(showId) { return this.ref(showId).push().key; },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 500).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    submissions: {
      ref: function(showId, subId) { return DB.ref('events/submissions/' + showId + (subId ? '/' + subId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 200).once('value'); },
      update: function(showId, subId, data) { return this.ref(showId, subId).update(data); },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 200).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    announcements: {
      ref: function(showId, annId) { return DB.ref('events/announcements/' + showId + (annId ? '/' + annId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 100).once('value'); },
      set: function(showId, annId, data) { return this.ref(showId, annId).set(data); },
      newKey: function(showId) { return this.ref(showId).push().key; },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 100).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    huntConfig: {
      ref: function(showId) { return DB.ref('events/huntConfig/' + showId); },
      get: function(showId) { return this.ref(showId).once('value'); },
      set: function(showId, data) { return this.ref(showId).set(data); }
    },
    huntStats: {
      ref: function(showId) { return DB.ref('events/huntStats/' + showId); },
      get: function(showId) { return this.ref(showId).once('value'); },
      listen: function(showId, cb, errCb) { return this.ref(showId).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    huntParticipants: {
      ref: function(showId) { return DB.ref('events/huntParticipants/' + showId); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 200).once('value'); }
    },
    showAdConfig: {
      ref: function(showId) { return DB.ref('events/showAdConfig/' + showId); },
      get: function(showId) { return this.ref(showId).once('value'); },
      set: function(showId, data) { return this.ref(showId).set(data); }
    },
    vendorWallets: {
      ref: function(showId, vendorId) { return DB.ref('events/vendorWallets/' + showId + (vendorId ? '/' + vendorId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 200).once('value'); },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 200).on('value', cb, errCb); },
      unlisten: function(showId, h) { this.ref(showId).off('value', h); }
    },
    vendorTransactions: {
      ref: function(showId, vendorId, txId) {
        var p = 'events/vendorTransactions/' + showId;
        if (vendorId) p += '/' + vendorId;
        if (txId) p += '/' + txId;
        return DB.ref(p);
      },
      list: function(showId, vendorId, limit) { return this.ref(showId, vendorId).limitToLast(limit || 50).once('value'); }
    },
    ads: {
      ref: function(showId, adId) { return DB.ref('events/ads/' + showId + (adId ? '/' + adId : '')); },
      list: function(showId, limit) { return this.ref(showId).limitToLast(limit || 200).once('value'); },
      set: function(showId, adId, data) { return this.ref(showId, adId).set(data); },
      update: function(showId, adId, data) { return this.ref(showId, adId).update(data); },
      remove: function(showId, adId) { return this.ref(showId, adId).remove(); },
      newKey: function(showId) { return this.ref(showId).push().key; },
      listen: function(showId, limit, cb, errCb) { return this.ref(showId).limitToLast(limit || 200).on('value', cb, errCb); },
      unlisten: function(showId, h) { return this.ref(showId).off('value', h); }
    }
  };`;

const newDB = `  var DB = {
    newKey: function(path) { return MastDB.newKey(path); },
    storagePath: function(sub) { return MastDB.tenantId() + '/' + sub; },

    shows: {
      PATH: 'events/shows',
      list: function(limit) { return MastDB.query('events/shows').limitToLast(limit || 200).once(); },
      get: function(id) { return MastDB.get('events/shows/' + id); },
      set: function(id, data) { return MastDB.set('events/shows/' + id, data); },
      update: function(id, data) { return MastDB.update('events/shows/' + id, data); },
      remove: function(id) { return MastDB.remove('events/shows/' + id); },
      newKey: function() { return MastDB.newKey('events/shows'); },
      listen: function(limit, cb) { return MastDB.query('events/shows').limitToLast(limit || 200).subscribe(cb); }
    },
    booths: {
      PATH: 'events/booths',
      list: function(showId, limit) { return MastDB.query('events/booths/' + showId).limitToLast(limit || 500).once(); },
      set: function(showId, boothId, data) { return MastDB.set('events/booths/' + showId + '/' + boothId, data); },
      update: function(showId, boothId, data) { return MastDB.update('events/booths/' + showId + '/' + boothId, data); },
      remove: function(showId, boothId) { return MastDB.remove('events/booths/' + showId + '/' + boothId); },
      newKey: function(showId) { return MastDB.newKey('events/booths/' + showId); },
      listen: function(showId, limit, cb) { return MastDB.query('events/booths/' + showId).limitToLast(limit || 500).subscribe(cb); }
    },
    boothPins: {
      PATH: 'events/boothPins',
      get: function(showId) { return MastDB.get('events/boothPins/' + showId); },
      set: function(showId, boothId, data) { return MastDB.set('events/boothPins/' + showId + '/' + boothId, data); },
      remove: function(showId, boothId) {
        if (boothId) return MastDB.remove('events/boothPins/' + showId + '/' + boothId);
        return MastDB.remove('events/boothPins/' + showId);
      },
      listen: function(showId, cb) { return MastDB.subscribe('events/boothPins/' + showId, cb); }
    },
    showsBySlug: {
      PATH: 'events/showsBySlug',
      set: function(slug, showId) { return MastDB.set('events/showsBySlug/' + slug, showId); },
      remove: function(slug) { return MastDB.remove('events/showsBySlug/' + slug); }
    },
    vendors: {
      PATH: 'events/vendors',
      list: function(showId, limit) { return MastDB.query('events/vendors/' + showId).limitToLast(limit || 500).once(); },
      set: function(showId, vendorId, data) { return MastDB.set('events/vendors/' + showId + '/' + vendorId, data); },
      update: function(showId, vendorId, data) { return MastDB.update('events/vendors/' + showId + '/' + vendorId, data); },
      remove: function(showId, vendorId) { return MastDB.remove('events/vendors/' + showId + '/' + vendorId); },
      newKey: function(showId) { return MastDB.newKey('events/vendors/' + showId); },
      listen: function(showId, limit, cb) { return MastDB.query('events/vendors/' + showId).limitToLast(limit || 500).subscribe(cb); }
    },
    submissions: {
      PATH: 'events/submissions',
      list: function(showId, limit) { return MastDB.query('events/submissions/' + showId).limitToLast(limit || 200).once(); },
      update: function(showId, subId, data) { return MastDB.update('events/submissions/' + showId + '/' + subId, data); },
      listen: function(showId, limit, cb) { return MastDB.query('events/submissions/' + showId).limitToLast(limit || 200).subscribe(cb); }
    },
    announcements: {
      PATH: 'events/announcements',
      list: function(showId, limit) { return MastDB.query('events/announcements/' + showId).limitToLast(limit || 100).once(); },
      set: function(showId, annId, data) { return MastDB.set('events/announcements/' + showId + '/' + annId, data); },
      newKey: function(showId) { return MastDB.newKey('events/announcements/' + showId); },
      listen: function(showId, limit, cb) { return MastDB.query('events/announcements/' + showId).limitToLast(limit || 100).subscribe(cb); }
    },
    huntConfig: {
      PATH: 'events/huntConfig',
      get: function(showId) { return MastDB.get('events/huntConfig/' + showId); },
      set: function(showId, data) { return MastDB.set('events/huntConfig/' + showId, data); }
    },
    huntStats: {
      PATH: 'events/huntStats',
      get: function(showId) { return MastDB.get('events/huntStats/' + showId); },
      listen: function(showId, cb) { return MastDB.subscribe('events/huntStats/' + showId, cb); }
    },
    huntParticipants: {
      PATH: 'events/huntParticipants',
      list: function(showId, limit) { return MastDB.query('events/huntParticipants/' + showId).limitToLast(limit || 200).once(); }
    },
    showAdConfig: {
      PATH: 'events/showAdConfig',
      get: function(showId) { return MastDB.get('events/showAdConfig/' + showId); },
      set: function(showId, data) { return MastDB.set('events/showAdConfig/' + showId, data); }
    },
    vendorWallets: {
      PATH: 'events/vendorWallets',
      list: function(showId, limit) { return MastDB.query('events/vendorWallets/' + showId).limitToLast(limit || 200).once(); },
      listen: function(showId, limit, cb) { return MastDB.query('events/vendorWallets/' + showId).limitToLast(limit || 200).subscribe(cb); }
    },
    vendorTransactions: {
      PATH: 'events/vendorTransactions',
      list: function(showId, vendorId, limit) {
        return MastDB.query('events/vendorTransactions/' + showId + '/' + vendorId).limitToLast(limit || 50).once();
      }
    },
    ads: {
      PATH: 'events/ads',
      list: function(showId, limit) { return MastDB.query('events/ads/' + showId).limitToLast(limit || 200).once(); },
      set: function(showId, adId, data) { return MastDB.set('events/ads/' + showId + '/' + adId, data); },
      update: function(showId, adId, data) { return MastDB.update('events/ads/' + showId + '/' + adId, data); },
      remove: function(showId, adId) { return MastDB.remove('events/ads/' + showId + '/' + adId); },
      newKey: function(showId) { return MastDB.newKey('events/ads/' + showId); },
      listen: function(showId, limit, cb) { return MastDB.query('events/ads/' + showId).limitToLast(limit || 200).subscribe(cb); }
    }
  };`;

if (!src.includes(oldDB)) {
  console.error('Could not find old DB object in events.js');
  process.exit(1);
}

src = src.replace(oldDB, newDB);

// 2. Fix unlisten calls — DB.entity.unlisten(args, handle) → handle() (unsub fn)
// Pattern: DB.shows.unlisten(showsListener) → showsListener()
// Pattern: DB.booths.unlisten(showId, boothsListener) → boothsListener()
// The listener variables store the unsub fn now (returned by listen)

// Simple unlisten(handle) — no showId
src = src.replace(/DB\.shows\.unlisten\((\w+)\)/g, '$1()');
src = src.replace(/DB\.huntStats\.unlisten\((\w+),\s*(\w+)\)/g, '$2()');

// unlisten(showId, handle) — has showId arg
const entities2arg = ['booths', 'boothPins', 'vendors', 'submissions', 'announcements', 'vendorWallets', 'ads'];
for (const ent of entities2arg) {
  src = src.replace(new RegExp(`DB\\.${ent}\\.unlisten\\(\\w+,\\s*(\\w+)\\)`, 'g'), '$1()');
}

// 3. Fix listen calls — callers pass errCb (3rd arg) but new listen doesn't accept it
// listen(limit, cb, errCb) → listen(limit, cb) — just drop errCb
// Most callers don't pass errCb, but check
src = src.replace(/DB\.(\w+)\.listen\((\d+|[a-zA-Z_.]+), (function\([^)]*\)\s*\{)/g, 'DB.$1.listen($2, $3');

// 4. Fix snap.val() in listen/get/list callbacks
// listen callbacks: function(snap) { ... snap.val() ... } → function(val) { ... val ... }
// This is complex — let's handle the common patterns

// In listen callbacks, snap is typically the first arg. Since listen now returns values,
// we need to rename snap → val and remove .val() calls.
// These are embedded in larger blocks so we need to be careful.

// For now, replace snap.val() || {} patterns in known callback contexts
// Actually, the get/list methods now return values directly, so any snap.val() after
// DB.xxx.get/list is wrong. Let's do a targeted replacement.

// Pattern: .then(function(snap) { var x = snap.val() ...
src = src.replace(/\.then\(function\(snap\)\s*\{\s*var (\w+) = snap\.val\(\)( \|\| \{\})?;/g,
  function(match, varName, defaultEmpty) {
    return `.then(function(${varName}) {`;
  });

// Pattern: var snap = await DB.xxx.get(...); var x = snap.val();
src = src.replace(/var (\w+) = await (DB\.\w+\.(?:get|list)\([^)]*\));\s*\n(\s*)var (\w+) = \1\.val\(\)( \|\| \{\})?;/g,
  function(match, snapVar, call, indent, valVar, defaultEmpty) {
    if (defaultEmpty) return `var ${valVar} = (await ${call}) || {};`;
    return `var ${valVar} = await ${call};`;
  });

// Pattern: DB.xxx.get(id).then(function(snap) { ... snap.val()
// These are harder — flag remaining snap.val() for awareness
const remaining = (src.match(/snap\.val\(\)/g) || []).length;
if (remaining > 0) {
  console.log(`Note: ${remaining} snap.val() calls remain in events.js — may need manual update`);
}

fs.writeFileSync(FILE, src, 'utf8');
console.log('events.js DB object rewritten. Verify snap.val() callers manually.');
