#!/usr/bin/env node
// One-shot script: rewrites MastDB entity namespaces to use MastDB operation API
// instead of MastDB._ref() escape hatches. Run from repo root.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'app', 'index.html');
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

// Find section boundaries
const startIdx = lines.findIndex(l => l.trim() === '// --- MastDB Entity Namespaces ---');
const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes("// don't call _ref() until invoked after init."));
if (startIdx < 0 || endIdx < 0) { console.error('Could not find entity section boundaries'); process.exit(1); }

console.log(`Found entity section: lines ${startIdx + 1} to ${endIdx + 1}`);

// New entity definitions using MastDB operation API
const newSection = `// --- MastDB Entity Namespaces ---
// All entity methods use MastDB operation API (get/set/query/subscribe/etc.).
// Return types: get() → Promise<value|null>, list() → Promise<Record>,
// listen() → unsubscribe function, callbacks receive values (not snapshots).

// Factory for standard CRUD + listen entities
function _makeEntity(path, dl) {
  var e = {
    PATH: path,
    get: function(id) { return MastDB.get(path + '/' + id); },
    set: function(id, data) { return MastDB.set(path + '/' + id, data); },
    update: function(id, data) { return MastDB.update(path + '/' + id, data); },
    remove: function(id) { return MastDB.remove(path + '/' + id); },
    push: function(data) { return MastDB.push(path, data); },
    newKey: function() { return MastDB.newKey(path); },
    query: function() { return MastDB.query(path); }
  };
  if (dl) {
    e.list = function(limit) { return MastDB.query(path).limitToLast(limit || dl).once(); };
    e.listen = function(limit, cb) { return MastDB.query(path).limitToLast(limit || dl).subscribe(cb); };
  } else {
    e.list = function() { return MastDB.list(path); };
  }
  return e;
}

MastDB.events = _makeEntity('public/events', 200);

// Events Organizer Module entities moved to standalone app (../events/index.html)

MastDB.gallery = _makeEntity('public/gallery', 500);

MastDB.images = {
  PATH: 'images',
  listen: function(limit, cb) { return MastDB.query('images').limitToLast(limit || 500).subscribe(cb); }
};

MastDB.products = {
  PATH: 'public/products',
  list: function() { return MastDB.list('public/products'); },
  get: function(id) { return MastDB.get('public/products/' + id); },
  set: function(id, data) { return MastDB.set('public/products/' + id, data); },
  update: function(id, data) { return MastDB.update('public/products/' + id, data); },
  remove: function(id) { return MastDB.remove('public/products/' + id); },
  query: function() { return MastDB.query('public/products'); },
  setImages: function(id, images) { return MastDB.set('public/products/' + id + '/images', images); },
  setImageIds: function(id, imageIds) { return MastDB.set('public/products/' + id + '/imageIds', imageIds); },
  setStatus: function(id, status) { return MastDB.set('public/products/' + id + '/status', status); },
  removeStatus: function(id) { return MastDB.remove('public/products/' + id + '/status'); },
  getBuildIds: function(id) { return MastDB.get('public/products/' + id + '/buildIds'); },
  setBuildIds: function(id, buildIds) { return MastDB.set('public/products/' + id + '/buildIds', buildIds); },
  setStoryId: function(id, storyId) { return MastDB.set('public/products/' + id + '/storyId', storyId); },
  removeStoryId: function(id) { return MastDB.remove('public/products/' + id + '/storyId'); },
  setField: function(id, field, value) { return MastDB.set('public/products/' + id + '/' + field, value); }
};

MastDB.inventory = {
  PATH: 'admin/inventory',
  list: function(limit) { return MastDB.query('admin/inventory').limitToLast(limit || 500).once(); },
  get: function(id) { return MastDB.get('admin/inventory/' + id); },
  set: function(id, data) { return MastDB.set('admin/inventory/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/inventory/' + id, data); },
  remove: function(id) { return MastDB.remove('admin/inventory/' + id); },
  listen: function(limit, cb) { return MastDB.query('admin/inventory').limitToLast(limit || 500).subscribe(cb); },
  query: function() { return MastDB.query('admin/inventory'); },
  getStock: function(pid) { return MastDB.get('admin/inventory/' + pid + '/stock'); },
  updateStock: function(pid, data) { return MastDB.update('admin/inventory/' + pid + '/stock', data); },
  getStockOnHand: function(pid, variant) {
    return MastDB.get('admin/inventory/' + pid + '/stock/' + (variant || '_default') + '/onHand');
  },
  stockOnHandPath: function(pid, variant) {
    return 'admin/inventory/' + pid + '/stock/' + (variant || '_default') + '/onHand';
  },
  stockIncomingPath: function(pid, variant) {
    return 'admin/inventory/' + pid + '/stock/' + (variant || '_default') + '/incoming';
  },
  stockAvailablePath: function(pid, variant) {
    return 'admin/inventory/' + pid + '/stock/' + (variant || '_default') + '/available';
  },
  stockLocationsPath: function(pid, variant) {
    return 'admin/inventory/' + pid + '/stock/' + (variant || '_default') + '/locations';
  },
  sub: function() { return 'admin/inventory/' + Array.from(arguments).join('/'); }
};

MastDB.orders = _makeEntity('orders', 100);

MastDB.emails = {
  PATH: 'emails',
  list: function(limit) { return MastDB.query('emails').limitToLast(limit || 100).once(); },
  get: function(id) { return MastDB.get('emails/' + id); },
  listen: function(limit, cb) { return MastDB.query('emails').limitToLast(limit || 100).subscribe(cb); },
  queryByOrder: function(orderId) {
    return MastDB.query('emails').orderByChild('orderId').equalTo(orderId).once();
  }
};

MastDB.sales = _makeEntity('admin/sales', 200);

MastDB.squarePayments = {
  PATH: 'admin/square-payments',
  listen: function(limit, cb) { return MastDB.query('admin/square-payments').limitToLast(limit || 200).subscribe(cb); }
};

MastDB.coupons = _makeEntity('admin/coupons', 200);

MastDB.promotions = _makeEntity('public/sales-promotions', 200);

MastDB.giftCards = _makeEntity('admin/giftCards', 100);

MastDB.walletConfig = {
  PATH: 'admin/walletConfig',
  get: function() { return MastDB.get('admin/walletConfig'); },
  set: function(data) { return MastDB.set('admin/walletConfig', data); },
  update: function(data) { return MastDB.update('admin/walletConfig', data); }
};

MastDB.termsConfig = {
  PATH: 'admin/termsConfig',
  get: function() { return MastDB.get('admin/termsConfig'); },
  set: function(data) { return MastDB.set('admin/termsConfig', data); },
  update: function(data) { return MastDB.update('admin/termsConfig', data); }
};

MastDB.rma = _makeEntity('admin/rma', 100);

MastDB.salesEvents = {
  PATH: 'admin/salesEvents',
  list: function(limit) { return MastDB.query('admin/salesEvents').limitToLast(limit || 100).once(); },
  get: function(id) { return MastDB.get('admin/salesEvents/' + id); },
  set: function(id, data) { return MastDB.set('admin/salesEvents/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/salesEvents/' + id, data); },
  remove: function(id) { return MastDB.remove('admin/salesEvents/' + id); },
  listen: function(limit, cb) { return MastDB.query('admin/salesEvents').limitToLast(limit || 100).subscribe(cb); },
  query: function() { return MastDB.query('admin/salesEvents'); },
  removeAllocation: function(eventId, pid) { return MastDB.remove('admin/salesEvents/' + eventId + '/allocations/' + pid); },
  updateAllocation: function(eventId, pid, data) { return MastDB.update('admin/salesEvents/' + eventId + '/allocations/' + pid, data); },
  setAllocationField: function(eventId, pid, field, value) {
    return MastDB.set('admin/salesEvents/' + eventId + '/allocations/' + pid + '/' + field, value);
  },
  sub: function() { return 'admin/salesEvents/' + Array.from(arguments).join('/'); }
};

MastDB.shows = {
  PATH: 'admin/shows',
  list: function(limit) { return MastDB.query('admin/shows').limitToLast(limit || 100).once(); },
  get: function(id) { return MastDB.get('admin/shows/' + id); },
  set: function(id, data) { return MastDB.set('admin/shows/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/shows/' + id, data); },
  remove: function(id) { return MastDB.remove('admin/shows/' + id); },
  newKey: function() { return MastDB.newKey('admin/shows'); },
  listen: function(limit, cb) { return MastDB.query('admin/shows').limitToLast(limit || 100).subscribe(cb); },
  query: function() { return MastDB.query('admin/shows'); },
  pushApplicationHistory: function(showId, data) { return MastDB.push('admin/shows/' + showId + '/applicationHistory', data); },
  sub: function() { return 'admin/shows/' + Array.from(arguments).join('/'); }
};

MastDB.bundles = _makeEntity('admin/bundles', 50);

MastDB.productionRequests = _makeEntity('admin/buildJobs', 100);

MastDB.productionJobs = {
  PATH: 'admin/jobs',
  list: function(limit) { return MastDB.query('admin/jobs').limitToLast(limit || 100).once(); },
  get: function(id) { return MastDB.get('admin/jobs/' + id); },
  set: function(id, data) { return MastDB.set('admin/jobs/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/jobs/' + id, data); },
  remove: function(id) { return MastDB.remove('admin/jobs/' + id); },
  push: function(data) { return MastDB.push('admin/jobs', data); },
  newKey: function() { return MastDB.newKey('admin/jobs'); },
  listen: function(limit, cb) { return MastDB.query('admin/jobs').limitToLast(limit || 100).subscribe(cb); },
  query: function() { return MastDB.query('admin/jobs'); },
  pushLineItem: function(jobId, data) { return MastDB.push('admin/jobs/' + jobId + '/lineItems', data); },
  newLineItemKey: function(jobId) { return MastDB.newKey('admin/jobs/' + jobId + '/lineItems'); },
  setLineItem: function(jobId, liId, data) { return MastDB.set('admin/jobs/' + jobId + '/lineItems/' + liId, data); },
  updateLineItem: function(jobId, liId, data) { return MastDB.update('admin/jobs/' + jobId + '/lineItems/' + liId, data); },
  removeLineItem: function(jobId, liId) { return MastDB.remove('admin/jobs/' + jobId + '/lineItems/' + liId); },
  pushBuild: function(jobId, data) { return MastDB.push('admin/jobs/' + jobId + '/builds', data); },
  updateBuild: function(jobId, buildId, data) { return MastDB.update('admin/jobs/' + jobId + '/builds/' + buildId, data); },
  getBuildField: function(jobId, buildId, field) { return MastDB.get('admin/jobs/' + jobId + '/builds/' + buildId + '/' + field); },
  setBuildField: function(jobId, buildId, field, value) { return MastDB.set('admin/jobs/' + jobId + '/builds/' + buildId + '/' + field, value); },
  pushNote: function(jobId, data) { return MastDB.push('admin/jobs/' + jobId + '/notes', data); },
  sub: function() { return 'admin/jobs/' + Array.from(arguments).join('/'); }
};

MastDB.operators = _makeEntity('admin/operators', 50);

MastDB.buildMedia = {
  PATH: 'admin/buildMedia',
  get: function(buildId) { return MastDB.get('admin/buildMedia/' + buildId); },
  set: function(buildId, mediaId, data) { return MastDB.set('admin/buildMedia/' + buildId + '/' + mediaId, data); },
  remove: function(buildId, mediaId) { return MastDB.remove('admin/buildMedia/' + buildId + '/' + mediaId); },
  listAll: function() { return MastDB.list('admin/buildMedia'); }
};

MastDB.stories = Object.assign(_makeEntity('public/stories', 200), {
  queryByJob: function(jobId) {
    return MastDB.query('public/stories').orderByChild('jobId').equalTo(jobId).once();
  }
});

MastDB.contacts = {
  PATH: 'admin/contacts',
  list: function() { return MastDB.list('admin/contacts'); },
  get: function(id) { return MastDB.get('admin/contacts/' + id); },
  set: function(id, data) { return MastDB.set('admin/contacts/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/contacts/' + id, data); },
  remove: function(id) { return MastDB.remove('admin/contacts/' + id); },
  query: function() { return MastDB.query('admin/contacts'); },
  getInteraction: function(contactId, interactionId) {
    return MastDB.get('admin/contacts/' + contactId + '/interactions' + (interactionId ? '/' + interactionId : ''));
  },
  setInteraction: function(contactId, interactionId, data) {
    return MastDB.set('admin/contacts/' + contactId + '/interactions/' + interactionId, data);
  },
  listInteractions: function(contactId, opts) {
    var q = MastDB.query('admin/contacts/' + contactId + '/interactions');
    if (opts && opts.orderBy) q = q.orderByChild(opts.orderBy);
    if (opts && opts.limit) q = q.limitToLast(opts.limit);
    return q.once();
  },
  setGoogleContactId: function(id, resourceName) {
    return MastDB.set('admin/contacts/' + id + '/googleContactId', resourceName);
  },
  sub: function() { return 'admin/contacts/' + Array.from(arguments).join('/'); }
};

MastDB.expenses = {
  PATH: 'admin/expenses',
  list: function(opts) {
    var q = MastDB.query('admin/expenses');
    if (opts && opts.orderBy) q = q.orderByChild(opts.orderBy);
    if (opts && opts.limit) q = q.limitToLast(opts.limit);
    return q.once();
  },
  get: function(id) { return MastDB.get('admin/expenses/' + id); },
  set: function(id, data) { return MastDB.set('admin/expenses/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/expenses/' + id, data); },
  remove: function(id) { return MastDB.remove('admin/expenses/' + id); },
  query: function() { return MastDB.query('admin/expenses'); },
  summary: function(month) { return MastDB.get('admin/expenseSummary/byMonth/' + month); }
};

MastDB.plaidItems = {
  PATH: 'admin/plaidItems',
  list: function() { return MastDB.list('admin/plaidItems'); },
  get: function(id) { return MastDB.get('admin/plaidItems/' + id); },
  update: function(id, data) { return MastDB.update('admin/plaidItems/' + id, data); }
};

MastDB.lpe = {
  equipment: {
    PATH: 'admin/lpe/equipment',
    list: function() { return MastDB.list('admin/lpe/equipment'); },
    get: function(id) { return MastDB.get('admin/lpe/equipment/' + id); },
    set: function(id, data) { return MastDB.set('admin/lpe/equipment/' + id, data); },
    update: function(id, data) { return MastDB.update('admin/lpe/equipment/' + id, data); },
    remove: function(id) { return MastDB.remove('admin/lpe/equipment/' + id); }
  },
  laborProfile: {
    PATH: 'admin/lpe/laborProfile',
    get: function() { return MastDB.get('admin/lpe/laborProfile'); },
    update: function(data) { return MastDB.update('admin/lpe/laborProfile', data); }
  }
};

MastDB.commissions = {
  PATH: 'admin/commissions',
  get: function(id) { return MastDB.get('admin/commissions/' + id); },
  set: function(id, data) { return MastDB.set('admin/commissions/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/commissions/' + id, data); },
  query: function() { return MastDB.query('admin/commissions'); },
  pushDocument: function(commId, data) { return MastDB.push('admin/commissions/' + commId + '/documents', data); },
  removeDocument: function(commId, docId) { return MastDB.remove('admin/commissions/' + commId + '/documents/' + docId); },
  sub: function() { return 'admin/commissions/' + Array.from(arguments).join('/'); }
};

MastDB.locations = {
  PATH: 'admin/locations',
  list: function() { return MastDB.list('admin/locations'); },
  get: function(id) { return MastDB.get('admin/locations/' + id); },
  set: function(id, data) { return MastDB.set('admin/locations/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/locations/' + id, data); },
  remove: function(id) { return MastDB.remove('admin/locations/' + id); },
  sub: function() { return 'admin/locations/' + Array.from(arguments).join('/'); }
};

MastDB.studioLocations = {
  PATH: 'config/studioLocations',
  list: function() { return MastDB.list('config/studioLocations'); },
  get: function(id) { return MastDB.get('config/studioLocations/' + id); },
  set: function(id, data) { return MastDB.set('config/studioLocations/' + id, data); },
  remove: function(id) { return MastDB.remove('config/studioLocations/' + id); }
};

MastDB.newsletter = {
  issues: {
    PATH: 'newsletter/issues',
    list: function(limit) {
      return MastDB.query('newsletter/issues').orderByChild('issueNumber').limitToLast(limit || 50).once();
    },
    get: function(id) { return MastDB.get('newsletter/issues/' + id); },
    set: function(id, data) { return MastDB.set('newsletter/issues/' + id, data); },
    update: function(id, data) { return MastDB.update('newsletter/issues/' + id, data); },
    newKey: function() { return MastDB.newKey('newsletter/issues'); },
    query: function() { return MastDB.query('newsletter/issues'); },
    updateSection: function(issueId, secId, data) {
      return MastDB.update('newsletter/issues/' + issueId + '/sections/' + secId, data);
    },
    setSection: function(issueId, secId, data) {
      return MastDB.set('newsletter/issues/' + issueId + '/sections/' + secId, data);
    },
    setSectionField: function(issueId, secId, field, value) {
      return MastDB.set('newsletter/issues/' + issueId + '/sections/' + secId + '/' + field, value);
    }
  },
  subscribers: {
    PATH: 'newsletter/subscribers',
    list: function(limit) {
      return MastDB.query('newsletter/subscribers').orderByChild('subscribedAt').limitToLast(limit || 200).once();
    },
    get: function(id) { return MastDB.get('newsletter/subscribers/' + id); },
    set: function(id, data) { return MastDB.set('newsletter/subscribers/' + id, data); },
    update: function(id, data) { return MastDB.update('newsletter/subscribers/' + id, data); },
    newKey: function() { return MastDB.newKey('newsletter/subscribers'); },
    query: function() { return MastDB.query('newsletter/subscribers'); }
  },
  published: {
    PATH: 'newsletter/published',
    set: function(id, data) { return MastDB.set('newsletter/published/' + id, data); },
    remove: function(id) { return MastDB.remove('newsletter/published/' + id); }
  },
  meta: {
    PATH: 'newsletter/meta',
    issueCounterPath: 'newsletter/meta/issueCounter'
  }
};

MastDB.blog = {
  posts: {
    PATH: 'blog/posts',
    list: function(limit) {
      return MastDB.query('blog/posts').orderByChild('createdAt').limitToLast(limit || 100).once();
    },
    get: function(id) { return MastDB.get('blog/posts/' + id); },
    set: function(id, data) { return MastDB.set('blog/posts/' + id, data); },
    update: function(id, data) { return MastDB.update('blog/posts/' + id, data); },
    remove: function(id) { return MastDB.remove('blog/posts/' + id); },
    query: function() { return MastDB.query('blog/posts'); },
    setField: function(id, field, value) { return MastDB.set('blog/posts/' + id + '/' + field, value); }
  },
  ideas: {
    PATH: 'blog/ideas',
    list: function(limit) {
      return MastDB.query('blog/ideas').orderByChild('createdAt').limitToLast(limit || 50).once();
    },
    get: function(id) { return MastDB.get('blog/ideas/' + id); },
    set: function(id, data) { return MastDB.set('blog/ideas/' + id, data); },
    remove: function(id) { return MastDB.remove('blog/ideas/' + id); }
  },
  published: {
    PATH: 'blog/published',
    set: function(id, data) { return MastDB.set('blog/published/' + id, data); },
    remove: function(id) { return MastDB.remove('blog/published/' + id); }
  },
  meta: {
    PATH: 'blog/meta',
    postCounterPath: 'blog/meta/postCounter'
  }
};

MastDB.market = {
  pendingClips: {
    PATH: 'market/pendingClips',
    list: function(uid) { return MastDB.get('market/pendingClips/' + uid); },
    set: function(uid, clipId, data) { return MastDB.set('market/pendingClips/' + uid + '/' + clipId, data); },
    setStatus: function(uid, clipId, status) {
      return MastDB.set('market/pendingClips/' + uid + '/' + clipId + '/status', status);
    }
  },
  posts: {
    PATH: 'market/posts',
    list: function(uid) { return MastDB.get('market/posts/' + uid); },
    set: function(uid, postId, data) { return MastDB.set('market/posts/' + uid + '/' + postId, data); },
    update: function(uid, postId, data) { return MastDB.update('market/posts/' + uid + '/' + postId, data); }
  }
};

MastDB.adminUsers = {
  PATH: 'admin/users',
  list: function() { return MastDB.list('admin/users'); },
  get: function(id) { return MastDB.get('admin/users/' + id); },
  set: function(id, data) { return MastDB.set('admin/users/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/users/' + id, data); },
  sub: function() { return 'admin/users/' + Array.from(arguments).join('/'); }
};

MastDB.roles = {
  PATH: 'admin/roles',
  list: function() { return MastDB.list('admin/roles'); },
  get: function(id) { return MastDB.get('admin/roles/' + (id || '')); },
  set: function(id, data) {
    if (arguments.length === 1) return MastDB.set('admin/roles', id);
    return MastDB.set('admin/roles/' + id, data);
  },
  setPermissions: function(roleKey, permissions) {
    return MastDB.set('admin/roles/' + roleKey + '/permissions', permissions);
  }
};

MastDB.invites = {
  PATH: 'admin/invites',
  list: function() { return MastDB.list('admin/invites'); },
  get: function(id) { return MastDB.get('admin/invites/' + id); },
  set: function(id, data) { return MastDB.set('admin/invites/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/invites/' + id, data); },
  remove: function(id) { return MastDB.remove('admin/invites/' + id); },
  queryPending: function() {
    return MastDB.query('admin/invites').orderByChild('status').equalTo('pending').once();
  }
};

MastDB.auditLog = {
  PATH: 'admin/auditLog',
  push: function(data) { return MastDB.push('admin/auditLog', data); },
  newKey: function() { return MastDB.newKey('admin/auditLog'); },
  queryByKey: function(opts) {
    var q = MastDB.query('admin/auditLog').orderByKey();
    if (opts && opts.endBefore) q = q.endBefore(opts.endBefore);
    if (opts && opts.limit) q = q.limitToLast(opts.limit);
    return q.once();
  },
  queryByEntity: function(entity, entityId, opts) {
    var q = MastDB.query('admin/auditLog').orderByChild('objectId').equalTo(entity + ':' + entityId);
    if (opts && opts.limit) q = q.limitToLast(opts.limit);
    return q.once();
  }
};

MastDB.auditIndex = {
  PATH: 'admin/auditIndex',
  get: function(entity, entityId, opts) {
    var p = 'admin/auditIndex/' + entity + '/' + entityId;
    if (opts && opts.limit) {
      return MastDB.query(p).limitToLast(opts.limit).once();
    }
    return MastDB.list(p);
  }
};

MastDB.feedback = {
  PATH: 'feedbackReports',
  push: function(data) { return MastDB.push('feedbackReports', data); }
};

MastDB.feedbackSettings = {
  PATH: 'admin/feedbackSettings',
  get: function() { return MastDB.get('admin/feedbackSettings'); },
  set: function(data) { return MastDB.set('admin/feedbackSettings', data); }
};

MastDB.testingMissions = {
  PATH: 'mast-platform/testingMissions',
  list: function() { return MastDB.platform.get(this.PATH); }
};

MastDB.testingMode = {
  PATH: 'admin/testingMode',
  get: function(uid) { return MastDB.get('admin/testingMode/' + uid); },
  remove: function(uid) { return MastDB.remove('admin/testingMode/' + uid); },
  setReflection: function(uid, missionId, type, value) {
    return MastDB.set('admin/testingMode/' + uid + '/' + missionId + '/reflections/' + type, value);
  },
  setProgress: function(uid, missionId, taskIdx, value) {
    return MastDB.set('admin/testingMode/' + uid + '/' + missionId + '/progress/' + taskIdx, value);
  },
  pushQuestion: function(uid, missionId, data) {
    return MastDB.push('admin/testingMode/' + uid + '/' + missionId + '/questions', data);
  }
};

MastDB.trips = {
  PATH: 'trips',
  list: function(uid, opts) {
    var q = MastDB.query('trips/' + uid);
    if (opts && opts.orderBy) q = q.orderByChild(opts.orderBy);
    if (opts && opts.equalTo !== undefined) q = q.equalTo(opts.equalTo);
    if (opts && opts.limit) q = q.limitToLast(opts.limit);
    return q.once();
  },
  get: function(uid, tripId) { return MastDB.get('trips/' + uid + '/' + tripId); },
  set: function(uid, tripId, data) { return MastDB.set('trips/' + uid + '/' + tripId, data); },
  update: function(uid, tripId, data) { return MastDB.update('trips/' + uid + '/' + tripId, data); },
  push: function(uid, data) { return MastDB.push('trips/' + uid, data); },
  allDrivers: function() { return MastDB.list('trips'); }
};

MastDB.tripLocations = {
  PATH: 'tripLocations',
  list: function() { return MastDB.list('tripLocations'); },
  set: function(id, data) { return MastDB.set('tripLocations/' + id, data); },
  setAll: function(data) { return MastDB.set('tripLocations', data); },
  remove: function(id) { return MastDB.remove('tripLocations/' + id); }
};

MastDB.tripSettings = {
  PATH: 'settings/trips',
  get: function() { return MastDB.get('settings/trips'); },
  set: function(data) { return MastDB.set('settings/trips', data); },
  sub: function() { return 'settings/trips/' + Array.from(arguments).join('/'); }
};

MastDB.quickActions = {
  PATH: 'quickActions',
  get: function(uid) { return MastDB.get('quickActions/' + uid); },
  set: function(uid, data) { return MastDB.set('quickActions/' + uid, data); }
};

MastDB.dashboardPrefs = {
  PATH: 'admin/users',
  get: function(uid) { return MastDB.get('admin/users/' + uid + '/dashboardPrefs'); },
  setCard: function(uid, cardId, data) {
    return MastDB.update('admin/users/' + uid + '/dashboardPrefs/cards/' + cardId, data);
  },
  setCardActivity: function(uid, cardId, timestamp) {
    return MastDB.update('admin/users/' + uid + '/dashboardPrefs/cards/' + cardId, { lastActivity: timestamp });
  }
};

MastDB.tripCustomPurposes = {
  PATH: 'tripCustomPurposes',
  list: function() { return MastDB.list('tripCustomPurposes'); }
};

MastDB.materials = Object.assign(_makeEntity('admin/materials', 500), {
  setField: function(id, field, value) { return MastDB.set('admin/materials/' + id + '/' + field, value); }
});

MastDB.recipes = {
  PATH: 'admin/recipes',
  list: function(limit) { return MastDB.query('admin/recipes').limitToLast(limit || 200).once(); },
  get: function(id) { return MastDB.get('admin/recipes/' + id); },
  set: function(id, data) { return MastDB.set('admin/recipes/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/recipes/' + id, data); },
  remove: function(id) { return MastDB.remove('admin/recipes/' + id); },
  newKey: function() { return MastDB.newKey('admin/recipes'); },
  listen: function(limit, cb) { return MastDB.query('admin/recipes').limitToLast(limit || 200).subscribe(cb); },
  query: function() { return MastDB.query('admin/recipes'); },
  getLineItems: function(recipeId) { return MastDB.get('admin/recipes/' + recipeId + '/lineItems'); },
  setField: function(id, field, value) { return MastDB.set('admin/recipes/' + id + '/' + field, value); },
  sub: function() { return 'admin/recipes/' + Array.from(arguments).join('/'); }
};

MastDB.importLog = {
  PATH: 'admin/importLog',
  list: function(limit) { return MastDB.query('admin/importLog').limitToLast(limit || 20).once(); },
  set: function(id, data) { return MastDB.set('admin/importLog/' + id, data); },
  newKey: function() { return MastDB.newKey('admin/importLog'); }
};

MastDB.lookbooks = _makeEntity('admin/lookbooks', 100);

MastDB.consignments = Object.assign(_makeEntity('admin/consignments', 200), {
  getLineItems: function(placementId) { return MastDB.get('admin/consignments/' + placementId + '/lineItems'); },
  setField: function(id, field, value) { return MastDB.set('admin/consignments/' + id + '/' + field, value); }
});

MastDB.dismissedNudges = {
  PATH: 'admin/users',
  get: function(uid) { return MastDB.get('admin/users/' + uid + '/dismissedNudges'); },
  dismiss: function(uid, nudgeKey) {
    return MastDB.set('admin/users/' + uid + '/dismissedNudges/' + nudgeKey, new Date().toISOString());
  }
};

MastDB.config = {
  get: function(subpath) { return MastDB.get('config' + (subpath ? '/' + subpath : '')); },
  set: function(subpath, value) { return MastDB.set('config' + (subpath ? '/' + subpath : ''), value); },
  update: function(subpath, value) { return MastDB.update('config' + (subpath ? '/' + subpath : ''), value); },
  square: function() { return MastDB.get('config/square'); },
  setSquare: function(data) { return MastDB.set('config/square', data); },
  etsy: function() { return MastDB.get('config/etsy'); },
  removeEtsy: function() { return MastDB.remove('config/etsy'); },
  shipping: function() { return MastDB.get('public/config/shippingRates'); },
  setShipping: function(config) { return MastDB.set('public/config/shippingRates', config); },
  shippingProvider: function(subpath) {
    return MastDB.get('config/shipping' + (subpath ? '/' + subpath : ''));
  },
  setShippingProvider: function(subpath, value) {
    if (arguments.length === 1) return MastDB.set('config/shipping', subpath);
    return MastDB.set('config/shipping' + (subpath ? '/' + subpath : ''), value);
  },
  taxRates: function() { return MastDB.get('public/taxRates'); },
  setTaxRates: function(rates) { return MastDB.set('public/taxRates', rates); },
  removeTaxRates: function() { return MastDB.remove('public/taxRates'); },
  googleMaps: function() { return MastDB.get('public/config/googleMapsApiKey'); },
  setGoogleMaps: function(key) { return MastDB.set('public/config/googleMapsApiKey', key); },
  testMode: function() { return MastDB.get('public/config/testMode'); },
  setTestMode: function(val) { return MastDB.set('public/config/testMode', val); },
  githubToken: function() { return MastDB.get('admin/githubToken'); },
  setGithubToken: function(token) { return MastDB.set('admin/githubToken', token); },
  settings: function() { return MastDB.get('public/settings'); },
  settingsField: function(field) { return MastDB.get('public/settings/' + field); },
  setSettingsField: function(field, value) { return MastDB.set('public/settings/' + field, value); },
  migrationFlag: function() { return MastDB.get('admin/sectionsMigrated'); },
  analyticsHits: function() { return MastDB.get('analytics/hits'); },
  makerSettings: function() { return MastDB.get('admin/config/makerSettings'); },
  updateMakerSettings: function(data) { return MastDB.update('admin/config/makerSettings', data); },
  shopDisplay: function() { return MastDB.get('public/config/shopDisplay'); },
  setShopDisplay: function(cfg) { return MastDB.set('public/config/shopDisplay', cfg); }
};

MastDB.wholesaleTokens = {
  PATH: 'admin/wholesaleTokens',
  list: function(limit) { return MastDB.query('admin/wholesaleTokens').limitToLast(limit || 100).once(); },
  get: function(id) { return MastDB.get('admin/wholesaleTokens/' + id); },
  set: function(id, data) { return MastDB.set('admin/wholesaleTokens/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/wholesaleTokens/' + id, data); },
  remove: function(id) { return MastDB.remove('admin/wholesaleTokens/' + id); }
};

MastDB.wholesaleOrders = {
  // Wholesale orders live in the unified orders path with type: 'wholesale'
  PATH: 'orders',
  list: function(limit) {
    return MastDB.query('orders').orderByChild('type').equalTo('wholesale').limitToLast(limit || 100).once();
  },
  get: function(id) { return MastDB.get('orders/' + id); },
  set: function(id, data) { return MastDB.set('orders/' + id, data); },
  update: function(id, data) { return MastDB.update('orders/' + id, data); },
  listen: function(limit, cb) {
    return MastDB.query('orders').orderByChild('type').equalTo('wholesale').limitToLast(limit || 100).subscribe(cb);
  }
};

MastDB.subscription = {
  PATH: 'admin/subscription',
  get: function() { return MastDB.get('admin/subscription'); },
  set: function(data) { return MastDB.set('admin/subscription', data); },
  update: function(data) { return MastDB.update('admin/subscription', data); }
};

MastDB.tokenWallet = {
  PATH: 'tokenWallet',
  get: function() { return MastDB.get('tokenWallet'); },
  set: function(data) { return MastDB.set('tokenWallet', data); },
  update: function(data) { return MastDB.update('tokenWallet', data); },
  listen: function(cb) { return MastDB.subscribe('tokenWallet', cb); }
};

MastDB.tokenLog = {
  PATH: 'tokenLog',
  recent: function(limit) { return MastDB.query('tokenLog').limitToLast(limit || 50).once(); }
};

MastDB.showLight = {
  profile: {
    PATH: 'showLight/profile',
    get: function() { return MastDB.get('showLight/profile'); },
    set: function(data) { return MastDB.set('showLight/profile', data); },
    update: function(data) { return MastDB.update('showLight/profile', data); }
  },
  shows: {
    PATH: 'showLight/shows',
    get: function() { return MastDB.get('showLight/shows'); },
    set: function(data) { return MastDB.set('showLight/shows', data); },
    update: function(data) { return MastDB.update('showLight/shows', data); },
    newKey: function() { return MastDB.newKey('showLight/shows'); }
  },
  applications: {
    PATH: 'showLight/applications',
    get: function() { return MastDB.get('showLight/applications'); },
    set: function(data) { return MastDB.set('showLight/applications', data); },
    update: function(data) { return MastDB.update('showLight/applications', data); },
    newKey: function() { return MastDB.newKey('showLight/applications'); }
  }
};

// ── Book Module Entities ──
MastDB.classes = _makeEntity('public/classes', 200);
MastDB.classSessions = Object.assign(_makeEntity('public/classSessions', 500), {
  byClass: function(classId) {
    return MastDB.query('public/classSessions').orderByChild('classId').equalTo(classId).once();
  }
});
MastDB.enrollments = Object.assign(_makeEntity('admin/enrollments', 500), {
  bySession: function(sessionId) {
    return MastDB.query('admin/enrollments').orderByChild('sessionId').equalTo(sessionId).once();
  },
  byClass: function(classId) {
    return MastDB.query('admin/enrollments').orderByChild('classId').equalTo(classId).once();
  },
  byContact: function(contactId) {
    return MastDB.query('admin/enrollments').orderByChild('contactId').equalTo(contactId).once();
  }
});
MastDB.instructors = Object.assign(_makeEntity('public/instructors', 100), {
  byStatus: function(status) {
    return MastDB.query('public/instructors').orderByChild('status').equalTo(status).once();
  }
});
MastDB.resources = Object.assign(_makeEntity('admin/resources', 100), {
  byType: function(type) {
    return MastDB.query('admin/resources').orderByChild('type').equalTo(type).once();
  }
});
MastDB.accounts = {
  PATH: 'public/accounts',
  get: function(uid) { return MastDB.get('public/accounts/' + uid); },
  set: function(uid, data) { return MastDB.set('public/accounts/' + uid, data); },
  update: function(uid, data) { return MastDB.update('public/accounts/' + uid, data); },
  getPass: function(uid, passId) {
    return MastDB.get('public/accounts/' + uid + '/passes' + (passId ? '/' + passId : ''));
  },
  listPasses: function(uid, limit) {
    return MastDB.query('public/accounts/' + uid + '/passes').limitToLast(limit || 50).once();
  },
  newPassKey: function(uid) { return MastDB.newKey('public/accounts/' + uid + '/passes'); },
  getWalletCredit: function(uid, creditId) {
    return MastDB.get('public/accounts/' + uid + '/wallet/credits' + (creditId ? '/' + creditId : ''));
  },
  listWalletCredits: function(uid, limit) {
    return MastDB.query('public/accounts/' + uid + '/wallet/credits').limitToLast(limit || 50).once();
  },
  newWalletCreditKey: function(uid) { return MastDB.newKey('public/accounts/' + uid + '/wallet/credits'); }
};
MastDB.sessionLogs = {
  PATH: 'admin/sessionLogs',
  get: function(id) { return MastDB.get('admin/sessionLogs/' + id); },
  set: function(id, data) { return MastDB.set('admin/sessionLogs/' + id, data); },
  update: function(id, data) { return MastDB.update('admin/sessionLogs/' + id, data); },
  getStartup: function(sessionId) { return MastDB.get('admin/sessionLogs/' + sessionId + '/startup'); },
  setStartup: function(sessionId, data) { return MastDB.set('admin/sessionLogs/' + sessionId + '/startup', data); },
  getCompletion: function(sessionId) { return MastDB.get('admin/sessionLogs/' + sessionId + '/completion'); },
  setCompletion: function(sessionId, data) { return MastDB.set('admin/sessionLogs/' + sessionId + '/completion', data); },
  pushIncident: function(sessionId, data) { return MastDB.push('admin/sessionLogs/' + sessionId + '/incidents', data); },
  newIncidentKey: function(sessionId) { return MastDB.newKey('admin/sessionLogs/' + sessionId + '/incidents'); }
};
MastDB.passDefinitions = _makeEntity('admin/passDefinitions', 100);

// MastDB.init() is called dynamically in the auth flow after tenant resolution.
// Entity namespace definitions above are safe — they define functions but
// don't call MastDB operations until invoked after init.`;

// Perform the splice
const before = lines.slice(0, startIdx);
const after = lines.slice(endIdx + 1);
const result = before.join('\n') + '\n' + newSection + '\n' + after.join('\n');

fs.writeFileSync(FILE, result, 'utf8');
console.log(`Replaced ${endIdx - startIdx + 1} lines with new entity definitions.`);

// Verify no _ref in new section
const newLines = newSection.split('\n');
const refLines = newLines.filter(l => l.includes('_ref') || l.includes('_rootRef') || l.includes('_multiUpdate') || l.includes('_newKey') || l.includes('_newRootKey'));
if (refLines.length > 0) {
  console.error('WARNING: New section still contains escape hatches:');
  refLines.forEach(l => console.error('  ' + l.trim()));
} else {
  console.log('Verified: no escape hatches in new entity definitions.');
}
