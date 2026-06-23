/**
 * Product↔Listing Mapping Module — J11
 *
 * Full-page interstitial that fires after first channel connect, plus a
 * Settings → "Channel mapping" re-entry surface.
 *
 * Reads:
 *   tenants/{tid}/public/products                — Mast products
 *   tenants/{tid}/channel_listings/{listingId}   — J02 raw + normalized
 *   tenants/{tid}/channel_config/{channel}       — _tokenStatus, connectedAt
 *   tenants/{tid}/product_listing_map/{mapId}    — J04 existing mappings
 *   tenants/{tid}/admin/mappingFlowState/state    — completedAt, dismissedAt
 *
 * Writes:
 *   tenants/{tid}/product_listing_map/{mapId}    — J04 schema, doc id
 *                                                  `${channel}_${externalId}`
 *   tenants/{tid}/channel_listings/{listingId}   — _ignored, _ignoredReason,
 *                                                  _ignoredSetBy (heuristic|tenant)
 *   tenants/{tid}/admin/mappingFlowState/state    — completedAt, lastBatchId
 *
 * Auto-match cascade (J11 §Deliverables):
 *   1. SKU-exact (normalized)              → confidence "sku-exact"
 *   2. Title fuzzy + price within 10%      → confidence "heuristic-high"
 *   3. Title fuzzy weak                    → confidence "heuristic-low"
 *      (presented as fuzzy review pane, persisted only on confirm)
 *
 * Heuristic catalog (mapping-heuristic-defaults-v1.md): 10 heuristics in
 * 3 confidence tiers (HIGH/MEDIUM/LOW). HIGH pre-selects "Ignore" radio;
 * MEDIUM appends hint; LOW annotates reason only. Suggestions never
 * persist without tenant confirmation.
 *
 * Bulk writes share one `batchId` per flow session so audit log groups
 * "confirmed 47 SKU-exact matches" as a single operation.
 *
 * Re-runnable: `_ignored: true` listings are NEVER re-prompted on
 * re-entry. New unmapped listings (J16) re-enter via Settings link.
 *
 * UX conformance (mast-ux-style-guide v10):
 *   - 7-step rem scale only (0.72/0.78/0.85/0.9/1.0/1.15/1.6) — enforced by
 *     scripts/lint-design-tokens.js PostToolUse hook
 *   - .section-header / .btn / .btn-primary / .btn-secondary / .loading
 *   - CSS vars only — no hardcoded hex
 *   - showToast() for transient feedback; no native alert/confirm
 *   - All user-derived strings (listing titles, SKUs, prices from Shopify
 *     /Etsy/etc.) interpolated through esc() — NEVER raw into innerHTML
 *
 * Spec: J11 instructions in CC job -OtgEhH-WsQQwHOOB8hK
 * Wireframe: /Downloads/sessions/product-mapping-flow-wireframe-v0.md
 * Heuristics: /Downloads/sessions/mapping-heuristic-defaults-v1.md
 */
(function() {
  'use strict';

  // ============================================================
  // Constants
  // ============================================================

  // Singleton state doc. NOTE the trailing `/state` doc id: MastDB maps a
  // 2-segment `admin/<x>` path to a *collection* (`admin_<x>`) with no doc id,
  // so the old `admin/mappingFlowState` resolved to an empty collection —
  // get() always returned null and update() threw "path requires doc ID",
  // which silently dropped every dismiss/complete write and re-fired the
  // takeover on each launch. The third segment gives it a real doc.
  var STATE_PATH = 'admin/mappingFlowState/state';

  // sessionStorage key used to suppress auto-launch of the interstitial for the
  // remainder of the current browser session (see checkAndMaybeShow).
  var SESSION_SUPPRESS_KEY = 'mast_mappingFlow_autoShown';

  // Fuzzy-match thresholds.
  var TITLE_SIM_HIGH = 0.70;   // title-similarity floor for heuristic-high
  var TITLE_SIM_LOW  = 0.50;   // title-similarity floor for heuristic-low
  var PRICE_BAND_PCT = 0.10;   // price within 10% → high-confidence

  // Heuristic catalog — mapping-heuristic-defaults-v1.md §3.
  // Each: id, tier (HIGH|MEDIUM|LOW), reasonEnum, reasonText, test(ctx)→bool.
  // `tier` governs UI: HIGH pre-selects "Ignore"; MEDIUM appends hint; LOW
  // annotates reason only. `reasonEnum` is closed set written to
  // channel_listings._ignoredReason.
  var IGNORE_REASON_ENUM = {
    draft:        'draft',
    test:         'test',
    retired:      'retired',
    tenant:       'tenant-marked'
  };

  var HEURISTICS = [
    // 3.1 Test / development listings
    {
      id: 'H-TEST-01',
      tier: 'HIGH',
      reasonEnum: IGNORE_REASON_ENUM.test,
      reasonText: 'looks like a test product',
      test: function(L) {
        var t = (L.normalized && L.normalized.title) || '';
        return /\b(test|do not (use|delete|publish|ship)|delete me|placeholder|sample only|sample sku|asdf|qwerty|xxx|tbd)\b/i.test(t);
      }
    },
    {
      id: 'H-TEST-02',
      tier: 'MEDIUM',
      reasonEnum: IGNORE_REASON_ENUM.test,
      reasonText: 'low price with no recent sales — likely a placeholder',
      test: function(L) {
        var p = L.normalized && L.normalized.price;
        if (p === null || p === undefined) return false;
        var pCents = Math.round(p);
        var lowPrice = pCents === 0 || pCents === 1 || pCents === 100 || pCents === 199;
        var sales90 = (L.normalized && typeof L.normalized.salesCountLast90d === 'number') ? L.normalized.salesCountLast90d : 0;
        return lowPrice && sales90 === 0;
      }
    },
    {
      id: 'H-TEST-03',
      tier: 'HIGH',
      reasonEnum: IGNORE_REASON_ENUM.test,
      reasonText: 'SKU pattern suggests a test product',
      test: function(L) {
        var s = (L.normalized && L.normalized.sku) || '';
        return /^(test[-_ ]?|temp[-_ ]?|tmp[-_ ]?|sample[-_ ]?)/i.test(s) || /DELETE/i.test(s);
      }
    },
    // 3.2 Draft / inactive listings
    {
      id: 'H-DRAFT-01',
      tier: 'HIGH',
      reasonEnum: IGNORE_REASON_ENUM.draft,
      reasonText: 'currently in draft — re-include when published',
      test: function(L) {
        var st = (L.normalized && (L.normalized.status || '')).toString().toLowerCase();
        if (st !== 'draft') return false;
        var createdAt = L.normalized && L.normalized.createdAt;
        if (!createdAt) return true;
        var ageDays = (Date.now() - Date.parse(createdAt)) / 86400000;
        return isFinite(ageDays) && ageDays > 7;
      }
    },
    {
      id: 'H-DRAFT-02',
      tier: 'HIGH',
      reasonEnum: IGNORE_REASON_ENUM.draft,
      reasonText: 'draft from 6+ months ago, no recent edits',
      test: function(L) {
        var st = (L.normalized && (L.normalized.status || '')).toString().toLowerCase();
        if (st !== 'draft') return false;
        var c = L.normalized && L.normalized.createdAt;
        var u = L.normalized && L.normalized.updatedAt;
        if (!c || !u) return false;
        var cAge = (Date.now() - Date.parse(c)) / 86400000;
        var uAge = (Date.now() - Date.parse(u)) / 86400000;
        return isFinite(cAge) && cAge > 180 && isFinite(uAge) && uAge > 90;
      }
    },
    {
      id: 'H-INACTIVE-01',
      tier: 'LOW',
      reasonEnum: IGNORE_REASON_ENUM.retired,
      reasonText: 'Etsy listing is inactive/expired — confirm whether retired or seasonal',
      test: function(L) {
        if (L._channel !== 'etsy') return false;
        var st = (L.normalized && (L.normalized.status || '')).toString().toLowerCase();
        return st === 'inactive' || st === 'expired';
      }
    },
    // 3.3 Archived / explicitly-retired listings
    {
      id: 'H-ARCHIVED-01',
      tier: 'HIGH',
      reasonEnum: IGNORE_REASON_ENUM.retired,
      reasonText: 'archived on Shopify — retained for SEO/history',
      test: function(L) {
        if (L._channel !== 'shopify') return false;
        var st = (L.normalized && (L.normalized.status || '')).toString().toLowerCase();
        return st === 'archived';
      }
    },
    {
      id: 'H-ARCHIVED-02',
      tier: 'HIGH',
      reasonEnum: IGNORE_REASON_ENUM.retired,
      reasonText: 'deleted on Square',
      test: function(L) {
        if (L._channel !== 'square') return false;
        return L.raw && L.raw.is_deleted === true;
      }
    },
    // 3.4 Stale / dormant active listings
    {
      id: 'H-STALE-01',
      tier: 'LOW',
      reasonEnum: IGNORE_REASON_ENUM.retired,
      reasonText: 'no sales in the last year — confirm whether to ignore or keep auditing',
      test: function(L) {
        var n = L.normalized || {};
        if ((n.status || '').toString().toLowerCase() !== 'active') return false;
        if (typeof n.salesCountLast365d !== 'number' || n.salesCountLast365d > 0) return false;
        if (!n.createdAt) return false;
        var ageDays = (Date.now() - Date.parse(n.createdAt)) / 86400000;
        return isFinite(ageDays) && ageDays > 365;
      }
    },
    {
      id: 'H-STALE-02',
      tier: 'LOW',
      reasonEnum: IGNORE_REASON_ENUM.retired,
      reasonText: 'out of stock and inactive for 6+ months',
      test: function(L) {
        var n = L.normalized || {};
        if (n.stock !== 0) return false;
        return typeof n.salesCountLast180d === 'number' && n.salesCountLast180d === 0;
      }
    }
  ];

  // ============================================================
  // Module-private state
  // ============================================================

  // Loaded data
  var loadedAt        = 0;
  var loadingPromise  = null;
  var products        = [];          // [{ id, title, sku, price, photos, status, ... }]
  var productsById    = Object.create(null);
  var listings        = [];          // [{ id, _channel, _externalId, _ignored, normalized, raw, _ignoredReason }]
  var existingMaps    = [];          // [{ id, productId, channel, externalId, confidence, ... }]
  var mappedListingIds = Object.create(null); // listingId → mapDoc
  var channelConfigs  = Object.create(null);
  var flowState       = { completedAt: null, dismissedAt: null, lastRunAt: null, lastBatchId: null };

  // Flow state machine
  var flowStep        = null;        // null when not in flow; 'welcome'|'auto'|'fuzzy'|'unmatched-listings'|'unmatched-products'|'done'
  var sessionBatchId  = null;        // shared across all writes in one flow session
  var fuzzyQueue      = [];          // pending fuzzy candidates {productId, listingId, score, reasons}
  var fuzzyIndex      = 0;
  var fuzzyDecisions  = Object.create(null); // listingId → 'confirm'|'reject'
  var skuMatchPairs   = [];          // [{ productId, listingId }]
  var unmatchedListings = [];        // [{ listing, suggestion: {action, reason, heuristicId, tier} }]
  var unmatchedDecisions = Object.create(null); // listingId → { action: 'import'|'match'|'ignore', reasonEnum, manualProductId? }
  var unmatchedProducts = [];        // [{ product, suggestionDecision: 'flag'|'wholesale'|'retired'|'in-dev' }]
  var unmatchedProductDecisions = Object.create(null); // productId → choice
  var skuCollisions   = [];          // [{ listingId, productIds[] }]
  var pendingCollisionResolution = null; // { listingId, productIds[] }

  // Drift previews counted during confirm — surfaced live to the tenant.
  var driftPreviewCount = 0;

  // Re-entry view (Screen H) state — used when route is /mapping (not interstitial).
  var reentryFilter   = 'all';       // all | sku-exact | heuristic-high | heuristic-low | user-confirmed
  var reentryChannel  = 'all';
  var reentrySearch   = '';

  // ============================================================
  // Helpers
  // ============================================================

  function esc(s) {
    if (s === null || s === undefined) return '';
    if (window.MastAdmin && typeof window.MastAdmin.esc === 'function') {
      return window.MastAdmin.esc(s);
    }
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, isError) {
    if (typeof window.showToast === 'function') window.showToast(msg, !!isError);
    else console[isError ? 'error' : 'log']('[Mapping] ' + msg);
  }

  function nowIso() { return new Date().toISOString(); }

  function mintBatchId() {
    return MastUtil.genId('batch_');
  }

  function currentUid() {
    try {
      if (window.MastAdmin && window.MastAdmin.currentUser) return window.MastAdmin.currentUser.uid;
      if (window.firebase && firebase.auth) {
        var u = firebase.auth().currentUser;
        if (u && u.uid) return u.uid;
      }
    } catch (e) {}
    return 'unknown';
  }

  function isValidIgnoredReason(r) {
    return r === IGNORE_REASON_ENUM.draft
        || r === IGNORE_REASON_ENUM.test
        || r === IGNORE_REASON_ENUM.retired
        || r === IGNORE_REASON_ENUM.tenant;
  }

  function fmtPrice(cents, channel) {
    if (cents === null || cents === undefined) return '';
    var dollars = Number(cents) / 100;
    if (!isFinite(dollars)) return '';
    return '$' + dollars.toFixed(2).replace(/\.00$/, '');
  }

  function normSku(s) {
    if (!s) return '';
    return String(s).trim().toLowerCase().replace(/\s+/g, '').replace(/[_]/g, '-');
  }

  function normTitle(s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Cheap title similarity: Jaccard on word sets. Robust enough for the
  // V1 fuzzy pass; tuneable post-launch from suggestion-acceptance telemetry.
  function titleSim(a, b) {
    var A = normTitle(a).split(' ').filter(Boolean);
    var B = normTitle(b).split(' ').filter(Boolean);
    if (!A.length || !B.length) return 0;
    var sA = Object.create(null);
    A.forEach(function(w) { sA[w] = true; });
    var inter = 0;
    var Bset = Object.create(null);
    B.forEach(function(w) {
      Bset[w] = true;
      if (sA[w]) inter++;
    });
    var unionCount = 0;
    for (var k in sA) { unionCount++; Bset[k] = true; }
    for (var k2 in Bset) if (!sA[k2]) unionCount++;
    return unionCount ? inter / unionCount : 0;
  }

  function priceCloseEnough(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    var hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi <= 0) return lo === 0;
    return ((hi - lo) / hi) <= PRICE_BAND_PCT;
  }

  function productPrice(p) {
    if (!p) return null;
    if (typeof p.price === 'number') return Math.round(p.price * 100);
    if (typeof p.priceCents === 'number') return p.priceCents;
    return null;
  }

  function productPhoto(p) {
    if (!p) return '';
    if (Array.isArray(p.photos) && p.photos.length) {
      var ph = p.photos[0];
      if (ph && typeof ph === 'object' && typeof ph.url === 'string') return ph.url;
      if (typeof ph === 'string') return ph;
    }
    if (typeof p.image === 'string') return p.image;
    if (typeof p.imageUrl === 'string') return p.imageUrl;
    return '';
  }

  function listingPhoto(L) {
    if (!L || !L.normalized) return '';
    var photos = L.normalized.photos;
    if (Array.isArray(photos) && photos.length && photos[0] && photos[0].url) return photos[0].url;
    return '';
  }

  function channelLabel(ch) {
    return ({
      shopify: 'Shopify', etsy: 'Etsy', square: 'Square',
      squarespace: 'Squarespace', wix: 'Wix'
    })[ch] || ch;
  }

  // ============================================================
  // Data loaders
  // ============================================================

  function loadAll(force) {
    if (loadingPromise) return loadingPromise;
    if (!force && loadedAt && (Date.now() - loadedAt) < 30000) return Promise.resolve();
    loadingPromise = Promise.all([
      _loadProducts(), _loadListings(), _loadMaps(), _loadChannelConfigs(), _loadState()
    ]).then(function() {
      loadedAt = Date.now();
      loadingPromise = null;
    }).catch(function(e) {
      loadingPromise = null;
      throw e;
    });
    return loadingPromise;
  }

  function _loadProducts() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') {
      products = []; return Promise.resolve();
    }
    return window.MastDB.get('public/products').then(function(raw) {
      var out = [];
      if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach(function(id) {
          var d = raw[id];
          if (!d || typeof d !== 'object') return;
          var p = {};
          for (var k in d) p[k] = d[k];
          p.id = id;
          out.push(p);
          productsById[id] = p;
        });
      }
      products = out;
    });
  }

  function _loadListings() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') {
      listings = []; return Promise.resolve();
    }
    return window.MastDB.get('channel_listings').then(function(raw) {
      var out = [];
      if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach(function(id) {
          var d = raw[id];
          if (!d || typeof d !== 'object') return;
          var L = {};
          for (var k in d) L[k] = d[k];
          L.id = id;
          out.push(L);
        });
      }
      listings = out;
    });
  }

  function _loadMaps() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') {
      existingMaps = []; return Promise.resolve();
    }
    return window.MastDB.get('product_listing_map').then(function(raw) {
      var out = [];
      mappedListingIds = Object.create(null);
      if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach(function(id) {
          var d = raw[id];
          if (!d || typeof d !== 'object') return;
          var m = {};
          for (var k in d) m[k] = d[k];
          m.id = id;
          out.push(m);
          mappedListingIds[id] = m;
        });
      }
      existingMaps = out;
    });
  }

  function _loadChannelConfigs() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') return Promise.resolve();
    return window.MastDB.get('channel_config').then(function(raw) {
      channelConfigs = (raw && typeof raw === 'object') ? raw : Object.create(null);
    }).catch(function() { channelConfigs = Object.create(null); });
  }

  function _loadState() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') return Promise.resolve();
    return window.MastDB.get(STATE_PATH).then(function(raw) {
      flowState = (raw && typeof raw === 'object') ? raw : { completedAt: null, dismissedAt: null, lastRunAt: null, lastBatchId: null };
    }).catch(function() {});
  }

  function _saveState(patch) {
    if (!window.MastDB || typeof window.MastDB.set !== 'function') return Promise.resolve();
    for (var k in patch) flowState[k] = patch[k];
    // Field-scoped set() (create-or-merge), NOT update(): the state doc does
    // not exist until the first write, and Firestore update() rejects on a
    // missing doc. A field-path set uses mergeFields — it creates the doc when
    // absent and preserves sibling fields (so writing dismissedAt never wipes
    // completedAt). Per-key keeps each write scoped to its own field.
    return Promise.all(Object.keys(patch).map(function(k) {
      return window.MastDB.set(STATE_PATH + '/' + k, patch[k]);
    })).catch(function(e) {
      console.warn('[Mapping] state save failed', e);
    });
  }

  // ============================================================
  // Matching cascade
  // ============================================================

  function computeMatches() {
    // Filter: ignore listings that are already mapped or explicitly ignored.
    var candidateListings = listings.filter(function(L) {
      if (L._ignored === true) return false;
      if (mappedListingIds[L.id]) return false;
      return true;
    });

    // Index products by normalized SKU (and variant SKUs).
    var prodBySku = Object.create(null);
    var skuCollisionMap = Object.create(null);
    products.forEach(function(p) {
      var keys = [];
      if (p.sku) keys.push(normSku(p.sku));
      if (Array.isArray(p.variants)) {
        p.variants.forEach(function(v) {
          if (v && v.sku) keys.push(normSku(v.sku));
        });
      }
      keys.forEach(function(k) {
        if (!k) return;
        if (!prodBySku[k]) prodBySku[k] = [];
        prodBySku[k].push(p.id);
      });
    });

    skuMatchPairs = [];
    skuCollisions = [];
    fuzzyQueue = [];
    unmatchedListings = [];
    unmatchedDecisions = Object.create(null);

    var matchedListingIds = Object.create(null);

    // Pass 1: SKU exact.
    candidateListings.forEach(function(L) {
      var lsku = L.normalized && L.normalized.sku ? normSku(L.normalized.sku) : '';
      if (!lsku) return;
      var hits = prodBySku[lsku];
      if (!hits || !hits.length) return;
      if (hits.length === 1) {
        skuMatchPairs.push({ productId: hits[0], listingId: L.id, listing: L });
        matchedListingIds[L.id] = true;
      } else {
        // SKU collision — defer to user (Screen I).
        skuCollisions.push({ listingId: L.id, listing: L, productIds: hits.slice() });
        matchedListingIds[L.id] = true; // hold out of fuzzy
      }
    });

    // Pass 2: title + price fuzzy on remaining.
    candidateListings.forEach(function(L) {
      if (matchedListingIds[L.id]) return;
      var lTitle = (L.normalized && L.normalized.title) || '';
      var lPrice = L.normalized && L.normalized.price;
      var best = null;
      products.forEach(function(p) {
        var sim = titleSim(lTitle, p.title || p.name || '');
        if (sim < TITLE_SIM_LOW) return;
        var pPrice = productPrice(p);
        var priceOk = priceCloseEnough(lPrice, pPrice);
        var tier = (sim >= TITLE_SIM_HIGH && priceOk) ? 'heuristic-high'
                 : (sim >= TITLE_SIM_HIGH || priceOk) ? 'heuristic-low'
                 : 'heuristic-low';
        var score = sim + (priceOk ? 0.2 : 0);
        if (!best || score > best.score) {
          best = {
            productId: p.id, listingId: L.id, listing: L, product: p,
            score: score, sim: sim, priceOk: priceOk, tier: tier
          };
        }
      });
      if (best) {
        fuzzyQueue.push(best);
        matchedListingIds[L.id] = true;
      }
    });

    // Pass 3: unmatched — channel listings with no Mast product.
    candidateListings.forEach(function(L) {
      if (matchedListingIds[L.id]) return;
      var suggestion = computeIgnoreSuggestion(L);
      unmatchedListings.push({ listing: L, suggestion: suggestion });
      // Pre-fill default decision (per heuristic tier).
      var pre = null;
      if (suggestion && suggestion.tier === 'HIGH') {
        pre = { action: 'ignore', reasonEnum: suggestion.reasonEnum };
      }
      if (pre) unmatchedDecisions[L.id] = pre;
    });

    // Pass 4: Mast products with no channel listing on any connected channel.
    var connectedChannels = Object.keys(channelConfigs).filter(function(ch) {
      var c = channelConfigs[ch];
      return c && c._tokenStatus === 'ok';
    });

    var productHasMatch = Object.create(null);
    skuMatchPairs.forEach(function(m) { productHasMatch[m.productId] = true; });
    fuzzyQueue.forEach(function(m) { productHasMatch[m.productId] = true; });
    existingMaps.forEach(function(m) {
      if (m.productId) productHasMatch[m.productId] = true;
    });
    skuCollisions.forEach(function(c) {
      c.productIds.forEach(function(pid) { productHasMatch[pid] = true; });
    });

    unmatchedProducts = [];
    unmatchedProductDecisions = Object.create(null);
    products.forEach(function(p) {
      if (!connectedChannels.length) return; // nothing to be off-of
      if (productHasMatch[p.id]) return;
      // Skip products explicitly opted out — `intendedChannels` empty array
      // means "off-channel"; not a gap.
      if (Array.isArray(p.intendedChannels) && p.intendedChannels.length === 0) return;
      unmatchedProducts.push({ product: p });
      unmatchedProductDecisions[p.id] = { choice: 'flag' };
    });
  }

  function computeIgnoreSuggestion(L) {
    for (var i = 0; i < HEURISTICS.length; i++) {
      var h = HEURISTICS[i];
      try {
        if (h.test(L)) {
          return { heuristicId: h.id, tier: h.tier, reasonEnum: h.reasonEnum, reasonText: h.reasonText };
        }
      } catch (e) { /* malformed listing — skip */ }
    }
    return null;
  }

  // Drift preview — surface side-by-side discrepancies during confirm so the
  // tenant sees the audit value DURING the flow (wedge §11 step 8).
  function driftBetween(productId, listing) {
    var p = productsById[productId];
    if (!p) return null;
    var n = listing && listing.normalized;
    if (!n) return null;
    var pPrice = productPrice(p);
    if (pPrice !== null && typeof n.price === 'number' && pPrice !== n.price) {
      var deltaCents = Math.abs(pPrice - n.price);
      if (deltaCents >= 100) { // at least $1 — avoid floating-point noise
        return {
          kind: 'price',
          msg: 'Price differs ' + fmtPrice(deltaCents) + ' between Mast and ' + channelLabel(listing._channel) +
               ' — we\'ll flag this in your audit'
        };
      }
    }
    if (typeof n.stock === 'number' && typeof p.stock === 'number' && p.stock !== n.stock) {
      return {
        kind: 'stock',
        msg: 'Stock differs (' + p.stock + ' in Mast vs ' + n.stock + ' on ' + channelLabel(listing._channel) +
             ') — we\'ll flag this in your audit'
      };
    }
    return null;
  }

  // ============================================================
  // Trigger — checkAndMaybeShow (called from index.html post-boot
  // and from channels.js post-connect)
  // ============================================================

  function checkAndMaybeShow() {
    // Per-session suppression: once the interstitial has been auto-shown (or
    // dismissed) in this browser session, never auto-take-over again — it must
    // not pop on every page load / hard refresh. Cross-session suppression is
    // handled separately by flowState.dismissedAt (7-day) below. sessionStorage
    // is per-origin, so it's already scoped to this tenant subdomain.
    try {
      if (window.sessionStorage && window.sessionStorage.getItem(SESSION_SUPPRESS_KEY) === '1') {
        return Promise.resolve(false);
      }
    } catch (e) {}
    return loadAll(false).then(function() {
      // Don't fire if user already completed or dismissed this session.
      if (flowState && flowState.completedAt) return false;
      var dismissed = flowState && flowState.dismissedAt;
      if (dismissed) {
        // Re-fire after 7 days if there are still unmapped listings.
        var sinceDays = (Date.now() - Date.parse(dismissed)) / 86400000;
        if (isFinite(sinceDays) && sinceDays < 7) return false;
      }
      // Need at least one connected channel.
      var connected = Object.keys(channelConfigs).some(function(ch) {
        return channelConfigs[ch] && channelConfigs[ch]._tokenStatus === 'ok';
      });
      if (!connected) return false;
      // Need at least one unmapped, non-ignored listing.
      computeMatches();
      var pending = skuMatchPairs.length + fuzzyQueue.length + unmatchedListings.length + skuCollisions.length;
      if (pending === 0) return false;
      // Mark suppressed for the rest of this session before showing, so a
      // mid-flow navigation / refresh doesn't re-trigger the takeover.
      try { if (window.sessionStorage) window.sessionStorage.setItem(SESSION_SUPPRESS_KEY, '1'); } catch (e) {}
      openInterstitial();
      return true;
    }).catch(function(e) {
      console.warn('[Mapping] checkAndMaybeShow failed', e);
      return false;
    });
  }

  // ============================================================
  // Interstitial overlay — Screens A/B/C/D/E/G
  // ============================================================

  function ensureOverlayHost() {
    var host = document.getElementById('mappingInterstitial');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'mappingInterstitial';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-labelledby', 'mappingInterstitialTitle');
    host.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9000',
      // Opaque full-screen takeover. `--bg` is NOT defined in the admin app
      // (only --bg-secondary/--bg-tertiary), so the old `var(--bg)` resolved
      // to its initial value `transparent` and the page bled through. Match
      // the admin body background (`--cream`, which inverts light/dark) with a
      // concrete dark fallback so it's always solid.
      'background:var(--cream, #1a1a1a)', 'overflow-y:auto',
      'font-size:0.9rem'
    ].join(';');
    document.body.appendChild(host);

    // Trap focus inside overlay; restore on close.
    host._prevFocus = document.activeElement;
    host._keyHandler = function(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (confirmDismiss()) closeInterstitial(true);
      }
    };
    document.addEventListener('keydown', host._keyHandler);
    document.body.style.overflow = 'hidden';
    return host;
  }

  function confirmDismiss() {
    // Tight non-modal confirmation — uses window.confirm only as last resort.
    // Simplest path: rely on the explicit "Skip" button instead; ESC == skip.
    return true;
  }

  function closeInterstitial(persistDismiss) {
    var host = document.getElementById('mappingInterstitial');
    if (!host) return;
    document.removeEventListener('keydown', host._keyHandler || function() {});
    document.body.style.overflow = '';
    if (host._prevFocus && typeof host._prevFocus.focus === 'function') {
      try { host._prevFocus.focus(); } catch (e) {}
    }
    if (host.parentNode) host.parentNode.removeChild(host);
    flowStep = null;
    if (persistDismiss) {
      _saveState({ dismissedAt: nowIso() });
    }
  }

  function openInterstitial() {
    sessionBatchId = mintBatchId();
    fuzzyIndex = 0;
    fuzzyDecisions = Object.create(null);
    driftPreviewCount = 0;
    flowStep = 'welcome';
    renderInterstitial();
  }

  function renderInterstitial() {
    var host = ensureOverlayHost();
    var body;
    switch (flowStep) {
      case 'welcome':              body = renderWelcome(); break;
      case 'auto':                 body = renderAutoMatch(); break;
      case 'fuzzy':                body = renderFuzzy(); break;
      case 'unmatched-listings':   body = renderUnmatchedListings(); break;
      case 'unmatched-products':   body = renderUnmatchedProducts(); break;
      case 'done':                 body = renderDone(); break;
      default:                     body = '<div class="loading">Loading…</div>';
    }
    host.innerHTML =
      '<div style="max-width:900px;margin:0 auto;padding:40px 20px 80px;">' +
        body +
      '</div>';
    attachOverlayHandlers(host);
    // Focus the primary CTA for keyboard users.
    var primary = host.querySelector('[data-focus-primary]');
    if (primary && typeof primary.focus === 'function') {
      try { primary.focus(); } catch (e) {}
    }
  }

  function renderWelcome() {
    // Counts
    var listingsByCh = Object.create(null);
    listings.forEach(function(L) {
      if (L._ignored) return;
      listingsByCh[L._channel] = (listingsByCh[L._channel] || 0) + 1;
    });
    var pending = skuMatchPairs.length + fuzzyQueue.length + unmatchedListings.length + skuCollisions.length;

    var byChHtml = Object.keys(listingsByCh).map(function(ch) {
      return '<div style="font-size:0.9rem;">' + esc(listingsByCh[ch]) + ' ' + esc(channelLabel(ch)) + ' listings</div>';
    }).join('');

    var estimate = pending < 20 ? 'under 5 minutes' : (pending < 100 ? '5–10 minutes' : '10–15 minutes');

    return [
      '<div class="section-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px;">',
      '  <h1 id="mappingInterstitialTitle" style="font-size:1.6rem;margin:0;">Set up your audit</h1>',
      '  <button type="button" class="btn btn-secondary" data-mapping-action="dismiss" aria-label="Close mapping setup">&times;</button>',
      '</div>',
      '<p style="font-size:1rem;line-height:1.5;max-width:640px;">',
      '  We need to know which of your channel listings correspond to which of your Mast products. ',
      '  This lets us detect when inventory, prices, or descriptions drift between channels.',
      '</p>',
      '<p style="font-size:0.9rem;color:var(--warm-gray);max-width:640px;">',
      '  Most of this is automatic. We\'ll match by SKU first, then by name and price for the ones without SKUs. You\'ll just confirm.',
      '</p>',
      '<div style="border:1px solid var(--border);border-radius:8px;padding:24px;margin:24px 0;background:var(--surface-card);">',
      '  <div style="font-size:0.9rem;">' + esc(products.length) + ' Mast products</div>',
      byChHtml,
      '  <div style="font-size:0.78rem;color:var(--warm-gray);margin-top:12px;">Estimated time: ' + esc(estimate) + '</div>',
      '</div>',
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">',
      '  <button type="button" class="btn btn-secondary" data-mapping-action="skip">Skip for now</button>',
      '  <button type="button" class="btn btn-primary" data-mapping-action="start-matching" data-focus-primary>Start matching &rarr;</button>',
      '</div>'
    ].join('');
  }

  function renderAutoMatch() {
    var rows = skuMatchPairs.map(function(m) {
      var p = productsById[m.productId];
      if (!p) return '';
      var drift = driftBetween(m.productId, m.listing);
      var pTitle = esc(p.title || p.name || '(no title)');
      var pSku = esc(p.sku || '(no SKU)');
      var lTitle = esc(m.listing.normalized && m.listing.normalized.title || '');
      var lPrice = esc(fmtPrice(m.listing.normalized && m.listing.normalized.price, m.listing._channel));
      var pPrice = esc(fmtPrice(productPrice(p)));
      var driftHtml = drift
        ? '<div style="margin-top:8px;font-size:0.78rem;color:var(--warning);">⚠ ' + esc(drift.msg) + '</div>'
        : '';
      return [
        '<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;background:var(--surface-card);">',
        '  <div style="display:flex;align-items:flex-start;gap:8px;">',
        '    <span style="color:var(--success);font-size:1rem;" aria-label="auto-matched">✓</span>',
        '    <div style="flex:1;">',
        '      <div style="font-size:0.9rem;font-weight:600;">' + pTitle + '</div>',
        '      <div style="font-size:0.78rem;color:var(--warm-gray);">SKU: ' + pSku + ' · ' + pPrice + '</div>',
        '      <div style="font-size:0.78rem;margin-top:6px;">' + esc(channelLabel(m.listing._channel)) + ': "' + lTitle + '" (' + lPrice + ')</div>',
        driftHtml,
        '    </div>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    var collisionWarn = skuCollisions.length
      ? '<div role="alert" style="border:1px solid var(--warning);border-radius:6px;padding:12px;margin-bottom:12px;font-size:0.85rem;">' +
        esc(skuCollisions.length) + ' SKU collision' + (skuCollisions.length === 1 ? '' : 's') +
        ' — you\'ll resolve these next.' +
        '</div>'
      : '';

    var nothing = !skuMatchPairs.length
      ? '<p style="font-size:0.9rem;color:var(--warm-gray);">No exact SKU matches. We\'ll show you close matches next.</p>'
      : '';

    return [
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">',
      '  <button type="button" class="btn btn-secondary" data-mapping-action="back-welcome" aria-label="Back to welcome">&larr; Back</button>',
      '  <div style="font-size:0.78rem;color:var(--warm-gray);">Step 1 of 4 — High-confidence</div>',
      '</div>',
      '<h2 style="font-size:1.15rem;margin:0 0 16px;">We matched ' + esc(skuMatchPairs.length) + ' product' +
        (skuMatchPairs.length === 1 ? '' : 's') + ' automatically by SKU</h2>',
      collisionWarn,
      '<p style="font-size:0.85rem;color:var(--warm-gray);">These match exactly on SKU. Scan and confirm.</p>',
      '<div style="max-height:50vh;overflow-y:auto;margin:16px 0;">',
      rows || nothing,
      '</div>',
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">',
      '  <button type="button" class="btn btn-secondary" data-mapping-action="skip-sku">Skip</button>',
      '  <button type="button" class="btn btn-primary" data-mapping-action="confirm-sku" data-focus-primary>' +
        (skuMatchPairs.length ? 'Confirm all ' + esc(skuMatchPairs.length) : 'Continue') + ' &rarr;</button>',
      '</div>'
    ].join('');
  }

  function renderFuzzy() {
    if (!fuzzyQueue.length) {
      // No fuzzy candidates — skip to unmatched listings.
      flowStep = 'unmatched-listings';
      return renderUnmatchedListings();
    }
    if (fuzzyIndex >= fuzzyQueue.length) {
      flowStep = 'unmatched-listings';
      return renderUnmatchedListings();
    }
    var m = fuzzyQueue[fuzzyIndex];
    var p = productsById[m.productId];
    if (!p) {
      fuzzyIndex++;
      return renderFuzzy();
    }
    var L = m.listing;
    var pct = Math.round(m.sim * 100);
    var pPriceDisp = esc(fmtPrice(productPrice(p)));
    var lPriceDisp = esc(fmtPrice(L.normalized && L.normalized.price));
    var pImg = productPhoto(p);
    var lImg = listingPhoto(L);
    var pImgHtml = pImg ? '<img src="' + esc(pImg) + '" alt="" style="width:100%;max-width:120px;border-radius:4px;" />' : '';
    var lImgHtml = lImg ? '<img src="' + esc(lImg) + '" alt="" style="width:100%;max-width:120px;border-radius:4px;" />' : '';
    var reasonBits = [];
    if (m.sim >= TITLE_SIM_HIGH) reasonBits.push('title match');
    if (m.priceOk) reasonBits.push('price within 10%');
    var reasonText = reasonBits.length ? reasonBits.join(', ') : 'weak title similarity';

    return [
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">',
      '  <button type="button" class="btn btn-secondary" data-mapping-action="back-auto" aria-label="Back to auto-match">&larr; Back</button>',
      '  <div style="font-size:0.78rem;color:var(--warm-gray);">Step 2 of 4 — Needs your eye</div>',
      '</div>',
      '<h2 style="font-size:1.15rem;margin:0 0 16px;">' + esc(fuzzyQueue.length) + ' product' +
        (fuzzyQueue.length === 1 ? '' : 's') + ' had close matches — confirm each</h2>',
      '<p style="font-size:0.85rem;color:var(--warm-gray);">SKU was missing or different. Confirm or reject.</p>',
      '<div style="border:1px solid var(--border);border-radius:8px;padding:20px;background:var(--surface-card);margin:16px 0;">',
      '  <div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:12px;">Match ' + esc(fuzzyIndex + 1) + ' of ' + esc(fuzzyQueue.length) + '</div>',
      '  <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:start;">',
      '    <div>',
      '      <div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Mast product</div>',
      '      <div style="font-size:0.9rem;font-weight:600;margin-bottom:4px;">' + esc(p.title || p.name || '') + '</div>',
      '      <div style="font-size:0.78rem;color:var(--warm-gray);">Price: ' + pPriceDisp + '</div>',
      '      <div style="font-size:0.78rem;color:var(--warm-gray);">SKU: ' + esc(p.sku || '(none)') + '</div>',
      pImgHtml ? '<div style="margin-top:8px;">' + pImgHtml + '</div>' : '',
      '    </div>',
      '    <div style="align-self:center;font-size:1.15rem;color:var(--warm-gray);" aria-hidden="true">≈→</div>',
      '    <div>',
      '      <div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">' + esc(channelLabel(L._channel)) + ' listing</div>',
      '      <div style="font-size:0.9rem;font-weight:600;margin-bottom:4px;">' + esc(L.normalized && L.normalized.title || '') + '</div>',
      '      <div style="font-size:0.78rem;color:var(--warm-gray);">Price: ' + lPriceDisp + '</div>',
      '      <div style="font-size:0.78rem;color:var(--warm-gray);">SKU: ' + esc(L.normalized && L.normalized.sku || '(none)') + '</div>',
      lImgHtml ? '<div style="margin-top:8px;">' + lImgHtml + '</div>' : '',
      '    </div>',
      '  </div>',
      '  <div style="font-size:0.78rem;color:var(--warm-gray);margin-top:12px;">Confidence: ' + esc(pct) + '% — ' + esc(reasonText) + '</div>',
      '  <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">',
      '    <button type="button" class="btn btn-secondary" data-mapping-action="fuzzy-reject">Reject — not this listing</button>',
      '    <button type="button" class="btn btn-primary" data-mapping-action="fuzzy-confirm" data-focus-primary>Confirm this match</button>',
      '  </div>',
      '</div>',
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">',
      '  <button type="button" class="btn btn-secondary" data-mapping-action="skip-fuzzy">Skip remaining</button>',
      '  <div style="font-size:0.78rem;color:var(--warm-gray);align-self:center;">' + esc(fuzzyIndex + 1) + ' of ' + esc(fuzzyQueue.length) + '</div>',
      '</div>'
    ].join('');
  }

  function renderUnmatchedListings() {
    if (!unmatchedListings.length) {
      flowStep = 'unmatched-products';
      return renderUnmatchedProducts();
    }
    var rows = unmatchedListings.map(function(item) {
      var L = item.listing;
      var s = item.suggestion;
      var dec = unmatchedDecisions[L.id] || {};
      var checked = function(a) { return dec.action === a ? 'checked' : ''; };
      var hint = '';
      if (s && s.tier === 'MEDIUM') {
        hint = '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:6px;">Mast suggests Ignore — ' + esc(s.reasonText) + '</div>';
      } else if (s && s.tier === 'LOW') {
        hint = '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:6px;">' + esc(s.reasonText) + '</div>';
      } else if (s && s.tier === 'HIGH') {
        hint = '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:6px;">← suggested: ' + esc(s.reasonText) + '</div>';
      }
      var name = 'ulist-' + L.id;
      var listingTitle = (L.normalized && L.normalized.title) || L.id;
      var listingPrice = fmtPrice(L.normalized && L.normalized.price);
      return [
        '<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;background:var(--surface-card);">',
        '  <div style="font-size:0.9rem;font-weight:600;">',
        '    ' + esc(channelLabel(L._channel)) + ' · "' + esc(listingTitle) + '" (' + esc(listingPrice) + ')',
        '  </div>',
        '  <fieldset style="border:0;padding:0;margin:8px 0 0;">',
        '    <legend class="sr-only">Action for ' + esc(listingTitle) + '</legend>',
        '    <label style="display:block;font-size:0.85rem;margin:4px 0;">',
        '      <input type="radio" name="' + esc(name) + '" data-mapping-action="ulist-radio" data-listing-id="' + esc(L.id) + '" data-choice="import" ' + checked('import') + ' /> Import as new Mast product',
        '    </label>',
        '    <label style="display:block;font-size:0.85rem;margin:4px 0;">',
        '      <input type="radio" name="' + esc(name) + '" data-mapping-action="ulist-radio" data-listing-id="' + esc(L.id) + '" data-choice="match" ' + checked('match') + ' /> Match to an existing Mast product…',
        '    </label>',
        '    <label style="display:block;font-size:0.85rem;margin:4px 0;">',
        '      <input type="radio" name="' + esc(name) + '" data-mapping-action="ulist-radio" data-listing-id="' + esc(L.id) + '" data-choice="ignore" ' + checked('ignore') + ' /> Ignore (don\'t include in audit)',
        '    </label>',
        hint,
        '  </fieldset>',
        '</div>'
      ].join('');
    }).join('');

    return [
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">',
      '  <button type="button" class="btn btn-secondary" data-mapping-action="back-fuzzy" aria-label="Back to fuzzy review">&larr; Back</button>',
      '  <div style="font-size:0.78rem;color:var(--warm-gray);">Step 3 of 4 — Listings without a home</div>',
      '</div>',
      '<h2 style="font-size:1.15rem;margin:0 0 16px;">' + esc(unmatchedListings.length) + ' channel listing' +
        (unmatchedListings.length === 1 ? '' : 's') + ' don\'t match any Mast product</h2>',
      '<p style="font-size:0.85rem;color:var(--warm-gray);">These exist on your channels but aren\'t tracked in Mast yet. Decide what each should be.</p>',
      '<div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap;">',
      '  <button type="button" class="btn btn-secondary" data-mapping-action="ulist-all-import">Import all as Mast products</button>',
      '  <button type="button" class="btn btn-secondary" data-mapping-action="ulist-all-ignore">Mark all as ignore</button>',
      '</div>',
      '<div style="max-height:50vh;overflow-y:auto;margin:16px 0;">',
      rows,
      '</div>',
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">',
      '  <div></div>',
      '  <button type="button" class="btn btn-primary" data-mapping-action="apply-unmatched-listings" data-focus-primary>Apply &amp; continue &rarr;</button>',
      '</div>'
    ].join('');
  }

  function renderUnmatchedProducts() {
    if (!unmatchedProducts.length) {
      flowStep = 'done';
      return renderDone();
    }
    var rows = unmatchedProducts.map(function(item) {
      var p = item.product;
      var d = unmatchedProductDecisions[p.id] || { choice: 'flag' };
      var nm = 'uprod-' + p.id;
      var checked = function(c) { return d.choice === c ? 'checked' : ''; };
      var status = p.status || 'active';
      return [
        '<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:8px;background:var(--surface-card);">',
        '  <div style="font-size:0.9rem;font-weight:600;">' + esc(p.title || p.name || '') + '</div>',
        '  <div style="font-size:0.78rem;color:var(--warm-gray);">Status: ' + esc(status) + '</div>',
        '  <p style="font-size:0.78rem;color:var(--warm-gray);margin:8px 0;">',
        '    This product is active in Mast but not listed on any connected channel. ',
        '    We\'ll flag this as a "channel gap" in your audit unless you mark it intentional.',
        '  </p>',
        '  <fieldset style="border:0;padding:0;margin:0;">',
        '    <legend class="sr-only">Reason for missing listing</legend>',
        '    <label style="display:block;font-size:0.85rem;margin:4px 0;">',
        '      <input type="radio" name="' + esc(nm) + '" data-mapping-action="uprod-radio" data-product-id="' + esc(p.id) + '" data-choice="flag" ' + checked('flag') + ' /> I plan to list it — flag in audit (default)',
        '    </label>',
        '    <label style="display:block;font-size:0.85rem;margin:4px 0;">',
        '      <input type="radio" name="' + esc(nm) + '" data-mapping-action="uprod-radio" data-product-id="' + esc(p.id) + '" data-choice="wholesale" ' + checked('wholesale') + ' /> Wholesale only — don\'t expect on retail channels',
        '    </label>',
        '    <label style="display:block;font-size:0.85rem;margin:4px 0;">',
        '      <input type="radio" name="' + esc(nm) + '" data-mapping-action="uprod-radio" data-product-id="' + esc(p.id) + '" data-choice="retired" ' + checked('retired') + ' /> Retired — don\'t expect on any channel',
        '    </label>',
        '    <label style="display:block;font-size:0.85rem;margin:4px 0;">',
        '      <input type="radio" name="' + esc(nm) + '" data-mapping-action="uprod-radio" data-product-id="' + esc(p.id) + '" data-choice="indev" ' + checked('indev') + ' /> In development — don\'t flag for now',
        '    </label>',
        '  </fieldset>',
        '</div>'
      ].join('');
    }).join('');

    return [
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">',
      '  <button type="button" class="btn btn-secondary" data-mapping-action="back-unmatched-listings" aria-label="Back to unmatched listings">&larr; Back</button>',
      '  <div style="font-size:0.78rem;color:var(--warm-gray);">Step 4 of 4 — Products missing online</div>',
      '</div>',
      '<h2 style="font-size:1.15rem;margin:0 0 16px;">' + esc(unmatchedProducts.length) + ' Mast product' +
        (unmatchedProducts.length === 1 ? '' : 's') + ' aren\'t on any connected channel</h2>',
      '<p style="font-size:0.85rem;color:var(--warm-gray);">Decide whether each should be listed, or whether it\'s an intentional gap.</p>',
      '<div style="max-height:50vh;overflow-y:auto;margin:16px 0;">',
      rows,
      '</div>',
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">',
      '  <div></div>',
      '  <button type="button" class="btn btn-primary" data-mapping-action="apply-unmatched-products" data-focus-primary>Apply &amp; finish &rarr;</button>',
      '</div>'
    ].join('');
  }

  function renderDone() {
    // Summary numbers — best-effort, derived from session decisions.
    var confirmedSku = skuMatchPairs.length;
    var confirmedFuzzy = 0;
    fuzzyQueue.forEach(function(m) {
      if (fuzzyDecisions[m.listingId] === 'confirm') confirmedFuzzy++;
    });
    var ignored = 0;
    var imported = 0;
    Object.keys(unmatchedDecisions).forEach(function(lid) {
      var d = unmatchedDecisions[lid];
      if (d.action === 'ignore') ignored++;
      else if (d.action === 'import') imported++;
    });
    var offChannel = 0;
    Object.keys(unmatchedProductDecisions).forEach(function(pid) {
      var d = unmatchedProductDecisions[pid];
      if (d.choice !== 'flag') offChannel++;
    });

    var driftLine = driftPreviewCount
      ? '<div style="font-size:0.85rem;color:var(--warning);margin-top:8px;">⚠ ' + esc(driftPreviewCount) + ' drift finding' +
        (driftPreviewCount === 1 ? '' : 's') + ' previewed — full audit ready in ~30 seconds.</div>'
      : '';

    return [
      '<div style="text-align:center;padding:40px 20px;">',
      '  <div style="font-size:1.6rem;margin-bottom:16px;">✓ Mapping complete</div>',
      '  <p style="font-size:1rem;max-width:520px;margin:0 auto 24px;">We\'re now watching ' +
        esc(confirmedSku + confirmedFuzzy) + ' products across your channels.</p>',
      '  <div style="border:1px solid var(--border);border-radius:8px;padding:20px;background:var(--surface-card);max-width:520px;margin:0 auto 24px;text-align:left;">',
      '    <div style="font-size:0.9rem;margin:4px 0;">✓ ' + esc(confirmedSku) + ' SKU-exact matches confirmed</div>',
      '    <div style="font-size:0.9rem;margin:4px 0;">✓ ' + esc(confirmedFuzzy) + ' close matches confirmed</div>',
      '    <div style="font-size:0.9rem;margin:4px 0;">✓ ' + esc(imported) + ' new products imported from channel listings</div>',
      '    <div style="font-size:0.9rem;margin:4px 0;">✓ ' + esc(offChannel) + ' products marked intentionally off-channel</div>',
      '    <div style="font-size:0.9rem;margin:4px 0;">✓ ' + esc(ignored) + ' channel listings marked as ignore</div>',
      driftLine,
      '  </div>',
      '  <p style="font-size:0.85rem;color:var(--warm-gray);max-width:520px;margin:0 auto 24px;">',
      '    Your first audit is ready in about 30 seconds while we run a full scan. ',
      '    We\'ll show drift findings as provisional for the first 72 hours while initial sync stabilizes.',
      '  </p>',
      '  <button type="button" class="btn btn-primary" data-mapping-action="see-audit" data-focus-primary>See your audit &rarr;</button>',
      '</div>'
    ].join('');
  }

  // ============================================================
  // Overlay action wiring
  // ============================================================

  function attachOverlayHandlers(host) {
    host.querySelectorAll('[data-mapping-action]').forEach(function(el) {
      var evt = (el.tagName === 'INPUT' && el.type === 'radio') ? 'change' : 'click';
      el.addEventListener(evt, function(e) {
        var action = el.getAttribute('data-mapping-action');
        switch (action) {
          case 'dismiss':
          case 'skip':
            _saveState({ dismissedAt: nowIso() });
            try { if (window.sessionStorage) window.sessionStorage.setItem(SESSION_SUPPRESS_KEY, '1'); } catch (e2) {}
            closeInterstitial(false);
            break;
          case 'start-matching':
            flowStep = 'auto';
            renderInterstitial();
            break;
          case 'back-welcome':
            flowStep = 'welcome'; renderInterstitial(); break;
          case 'back-auto':
            flowStep = 'auto'; renderInterstitial(); break;
          case 'back-fuzzy':
            flowStep = 'fuzzy'; fuzzyIndex = 0; renderInterstitial(); break;
          case 'back-unmatched-listings':
            flowStep = 'unmatched-listings'; renderInterstitial(); break;
          case 'skip-sku':
            flowStep = 'fuzzy'; renderInterstitial(); break;
          case 'confirm-sku':
            persistSkuMatches().then(function() {
              flowStep = 'fuzzy';
              renderInterstitial();
            }).catch(function(err) { toast('Failed to save matches: ' + (err.message || err), true); });
            break;
          case 'fuzzy-confirm':
            (function() {
              var m = fuzzyQueue[fuzzyIndex];
              if (!m) return;
              fuzzyDecisions[m.listingId] = 'confirm';
              // Drift preview side-effect — surface as a transient toast.
              var d = driftBetween(m.productId, m.listing);
              if (d) {
                driftPreviewCount++;
                toast('⚠ ' + d.msg);
              }
              persistMapping(m.productId, m.listing, m.tier).then(function() {
                fuzzyIndex++;
                renderInterstitial();
              }).catch(function(err) { toast('Save failed: ' + (err.message || err), true); });
            })();
            break;
          case 'fuzzy-reject':
            (function() {
              var m = fuzzyQueue[fuzzyIndex];
              if (m) fuzzyDecisions[m.listingId] = 'reject';
              fuzzyIndex++;
              renderInterstitial();
            })();
            break;
          case 'skip-fuzzy':
            flowStep = 'unmatched-listings'; renderInterstitial(); break;
          case 'ulist-radio':
            (function() {
              var lid = el.getAttribute('data-listing-id');
              var choice = el.getAttribute('data-choice');
              var prev = unmatchedDecisions[lid] || {};
              if (choice === 'ignore') {
                // Carry forward heuristic reason if present; default to tenant-marked.
                var item = unmatchedListings.find(function(u) { return u.listing.id === lid; });
                var reasonEnum = (item && item.suggestion && isValidIgnoredReason(item.suggestion.reasonEnum))
                  ? item.suggestion.reasonEnum
                  : IGNORE_REASON_ENUM.tenant;
                unmatchedDecisions[lid] = { action: 'ignore', reasonEnum: reasonEnum };
              } else if (choice === 'match') {
                unmatchedDecisions[lid] = { action: 'match' };
                openManualMatchModal(lid);
              } else {
                unmatchedDecisions[lid] = { action: choice };
              }
            })();
            break;
          case 'ulist-all-import':
            unmatchedListings.forEach(function(u) {
              unmatchedDecisions[u.listing.id] = { action: 'import' };
            });
            renderInterstitial();
            break;
          case 'ulist-all-ignore':
            unmatchedListings.forEach(function(u) {
              var rEnum = (u.suggestion && isValidIgnoredReason(u.suggestion.reasonEnum))
                ? u.suggestion.reasonEnum : IGNORE_REASON_ENUM.tenant;
              unmatchedDecisions[u.listing.id] = { action: 'ignore', reasonEnum: rEnum };
            });
            renderInterstitial();
            break;
          case 'apply-unmatched-listings':
            applyUnmatchedListings().then(function() {
              flowStep = 'unmatched-products';
              renderInterstitial();
            }).catch(function(err) { toast('Save failed: ' + (err.message || err), true); });
            break;
          case 'uprod-radio':
            (function() {
              var pid = el.getAttribute('data-product-id');
              var choice = el.getAttribute('data-choice');
              unmatchedProductDecisions[pid] = { choice: choice };
            })();
            break;
          case 'apply-unmatched-products':
            applyUnmatchedProducts().then(function() {
              flowStep = 'done';
              renderInterstitial();
            }).catch(function(err) { toast('Save failed: ' + (err.message || err), true); });
            break;
          case 'see-audit':
            _saveState({ completedAt: nowIso(), lastBatchId: sessionBatchId, lastRunAt: nowIso() }).then(function() {
              closeInterstitial(false);
              if (typeof window.navigateTo === 'function') {
                window.navigateTo('audit');
              }
            });
            break;
        }
      });
    });
  }

  // ============================================================
  // Persistence
  // ============================================================

  function mapDocId(channel, externalId) {
    return String(channel) + '_' + String(externalId);
  }

  function buildMapDoc(productId, listing, confidence) {
    var nowIsoStr = nowIso();
    return {
      productId:     String(productId),
      channel:       String(listing._channel),
      externalId:    String(listing._externalId),
      confidence:    confidence,
      createdAt:     nowIsoStr,
      createdBy:     currentUid(),
      lastVerifiedAt: nowIsoStr,
      batchId:       sessionBatchId
    };
  }

  function persistMapping(productId, listing, confidence) {
    if (!isValidConfidence(confidence)) {
      return Promise.reject(new Error('invalid confidence: ' + confidence));
    }
    var channel = String(listing._channel);
    var externalId = String(listing._externalId);
    var docId = mapDocId(channel, externalId);
    var doc = buildMapDoc(productId, listing, confidence);
    // WS2: route through the confirmListingMapping CF (→ upsertMapping →
    // projectRelationship) instead of writing product_listing_map directly. The
    // old direct MastDB.set bypassed the projection, so the legacy Drive fields
    // (channelBindings[] / channelId-keyed externalRefs / reverse index) and the
    // product↔recipe back-link never populated on the human mapping path — only
    // the auto-import consumer ran it. map ≠ bind: confirming does NOT bind (no
    // bind flag is sent; the CF preserves any prior bind state). Idempotent:
    // deterministic doc id server-side, safe to retry / double-click.
    if (window.firebase && firebase.functions) {
      var fn = firebase.functions().httpsCallable('confirmListingMapping');
      return fn({
        tenantId: window.TENANT_ID || (window.MastDB && MastDB.tenantId && MastDB.tenantId()),
        productId: String(productId),
        channel: channel,
        externalId: externalId,
        confidence: confidence,
        batchId: sessionBatchId || null
      }).then(function() {
        mappedListingIds[docId] = doc;
      });
    }
    // Fallback when the Functions SDK is unavailable (e.g. test shells): legacy
    // direct write keeps the UI working but skips the projection.
    if (!window.MastDB || typeof window.MastDB.set !== 'function') return Promise.resolve();
    return window.MastDB.set('product_listing_map/' + docId, doc).then(function() {
      mappedListingIds[docId] = doc;
    });
  }

  function isValidConfidence(c) {
    return c === 'sku-exact' || c === 'heuristic-high' || c === 'heuristic-low' || c === 'user-confirmed';
  }

  function persistSkuMatches() {
    if (!skuMatchPairs.length) return Promise.resolve();
    var chain = Promise.resolve();
    skuMatchPairs.forEach(function(m) {
      chain = chain.then(function() {
        // Surface drift preview during confirm — first wedge-§11 win.
        var d = driftBetween(m.productId, m.listing);
        if (d) driftPreviewCount++;
        return persistMapping(m.productId, m.listing, 'sku-exact');
      });
    });
    return chain.then(function() {
      toast('Confirmed ' + skuMatchPairs.length + ' SKU-exact match' + (skuMatchPairs.length === 1 ? '' : 'es'));
    });
  }

  function applyUnmatchedListings() {
    var chain = Promise.resolve();
    Object.keys(unmatchedDecisions).forEach(function(lid) {
      var d = unmatchedDecisions[lid];
      var item = unmatchedListings.find(function(u) { return u.listing.id === lid; });
      if (!item) return;
      var L = item.listing;
      if (d.action === 'ignore') {
        if (!isValidIgnoredReason(d.reasonEnum)) return; // closed-set validation
        chain = chain.then(function() {
          return window.MastDB.update('channel_listings/' + lid, {
            _ignored: true,
            _ignoredReason: d.reasonEnum,
            _ignoredSetBy: item.suggestion ? 'heuristic' : 'tenant'
          });
        });
      } else if (d.action === 'match' && d.manualProductId) {
        chain = chain.then(function() {
          return persistMapping(d.manualProductId, L, 'user-confirmed');
        });
      } else if (d.action === 'import') {
        // V1: stamp listing for downstream Import flow to consume. The actual
        // product-creation step lives outside J11 (out-of-scope per chip).
        chain = chain.then(function() {
          return window.MastDB.update('channel_listings/' + lid, {
            _importQueued: true,
            _importQueuedAt: nowIso(),
            _importBatchId: sessionBatchId
          });
        });
      }
    });
    return chain;
  }

  function applyUnmatchedProducts() {
    // Write `intendedChannels` decisions to product docs. `flag` = no change
    // (audit default fires "channel gap"). Other choices update the product
    // record so audit ignores or snoozes the gap.
    var chain = Promise.resolve();
    var connectedChannels = Object.keys(channelConfigs).filter(function(ch) {
      var c = channelConfigs[ch]; return c && c._tokenStatus === 'ok';
    });
    Object.keys(unmatchedProductDecisions).forEach(function(pid) {
      var d = unmatchedProductDecisions[pid];
      if (!d) return;
      var patch = null;
      if (d.choice === 'wholesale') {
        patch = { intendedChannels: ['wholesale'], offChannelReason: 'wholesale-only' };
      } else if (d.choice === 'retired') {
        patch = { intendedChannels: [], offChannelReason: 'retired' };
      } else if (d.choice === 'indev') {
        patch = { offChannelReason: 'in-development', offChannelSnoozeUntil: MastFormat.addDays(new Date(), 90).toISOString() };
      } else if (d.choice === 'flag') {
        // Explicit "do flag" — ensure intendedChannels lists connected retail channels.
        patch = { intendedChannels: connectedChannels };
      }
      if (patch) {
        chain = chain.then(function() {
          return window.MastDB.update('public/products/' + pid, patch);
        });
      }
    });
    return chain;
  }

  // ============================================================
  // Manual matching modal (Screen F)
  // ============================================================

  function openManualMatchModal(listingId) {
    var L = listings.find(function(x) { return x.id === listingId; });
    if (!L) return;
    var existing = document.getElementById('mappingManualMatchModal');
    if (existing) existing.parentNode.removeChild(existing);
    var modal = document.createElement('div');
    modal.id = 'mappingManualMatchModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'mappingManualMatchTitle');
    modal.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9500',
      'background:rgba(0,0,0,0.5)', 'display:flex',
      'align-items:center', 'justify-content:center', 'padding:20px'
    ].join(';');
    var lTitle = (L.normalized && L.normalized.title) || L.id;
    var lPrice = fmtPrice(L.normalized && L.normalized.price);
    modal.innerHTML = [
      '<div style="background:var(--surface-card);border-radius:8px;max-width:560px;width:100%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;">',
      '  <div style="padding:20px 20px 0;">',
      '    <h2 id="mappingManualMatchTitle" style="font-size:1.15rem;margin:0 0 8px;">Match this ' + esc(channelLabel(L._channel)) + ' listing to a Mast product</h2>',
      '    <p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 16px;">' + esc(channelLabel(L._channel)) + ': "' + esc(lTitle) + '" (' + esc(lPrice) + ')</p>',
      '    <input type="search" id="manualMatchSearch" placeholder="Search Mast products…" style="width:100%;padding:8px;font-size:0.9rem;border:1px solid var(--border);border-radius:4px;" autofocus />',
      '  </div>',
      '  <div id="manualMatchResults" style="flex:1;overflow-y:auto;padding:8px 20px;"></div>',
      '  <div style="padding:16px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;">',
      '    <button type="button" class="btn btn-secondary" id="manualMatchCancel">Cancel</button>',
      '    <button type="button" class="btn btn-primary" id="manualMatchSubmit" disabled>Match</button>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);

    var selectedProductId = null;
    function refreshResults() {
      var q = (document.getElementById('manualMatchSearch').value || '').toLowerCase().trim();
      var pool = products.filter(function(p) {
        if (!q) return true;
        var t = (p.title || p.name || '').toLowerCase();
        var s = (p.sku || '').toLowerCase();
        return t.indexOf(q) >= 0 || s.indexOf(q) >= 0;
      }).slice(0, 50);
      var resultsHtml = pool.map(function(p) {
        var sel = selectedProductId === p.id ? 'checked' : '';
        return [
          '<label style="display:block;padding:8px;border-bottom:1px solid var(--border);cursor:pointer;">',
          '  <input type="radio" name="manualMatchPick" value="' + esc(p.id) + '" ' + sel + ' style="margin-right:8px;" />',
          '  <span style="font-size:0.9rem;font-weight:600;">' + esc(p.title || p.name || '') + '</span><br />',
          '  <span style="font-size:0.78rem;color:var(--warm-gray);">SKU: ' + esc(p.sku || '(none)') + ' · ' + esc(fmtPrice(productPrice(p))) + '</span>',
          '</label>'
        ].join('');
      }).join('') || '<div style="padding:20px;font-size:0.85rem;color:var(--warm-gray);">No matches.</div>';
      document.getElementById('manualMatchResults').innerHTML = resultsHtml;
      document.querySelectorAll('input[name="manualMatchPick"]').forEach(function(r) {
        r.addEventListener('change', function() {
          selectedProductId = r.value;
          document.getElementById('manualMatchSubmit').disabled = false;
        });
      });
    }
    refreshResults();
    document.getElementById('manualMatchSearch').addEventListener('input', refreshResults);
    document.getElementById('manualMatchCancel').addEventListener('click', function() {
      modal.parentNode.removeChild(modal);
      // Revert the radio if user cancelled.
      var d = unmatchedDecisions[listingId];
      if (d && d.action === 'match' && !d.manualProductId) {
        delete unmatchedDecisions[listingId];
        renderInterstitial();
      }
    });
    document.getElementById('manualMatchSubmit').addEventListener('click', function() {
      if (!selectedProductId) return;
      unmatchedDecisions[listingId] = { action: 'match', manualProductId: selectedProductId };
      modal.parentNode.removeChild(modal);
      renderInterstitial();
    });
    modal.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { modal.parentNode.removeChild(modal); }
    });
  }

  // ============================================================
  // Settings re-entry view (Screen H) — route 'mapping'
  // ============================================================

  function renderReentryView() {
    var host = document.getElementById('mappingTabContent');
    if (!host) return;
    var connectedSet = Object.keys(channelConfigs).filter(function(ch) {
      return channelConfigs[ch] && channelConfigs[ch]._tokenStatus === 'ok';
    });

    var deltaListings = listings.filter(function(L) {
      if (L._ignored) return false;
      if (mappedListingIds[L.id]) return false;
      return true;
    });
    var deltaByCh = Object.create(null);
    deltaListings.forEach(function(L) {
      deltaByCh[L._channel] = (deltaByCh[L._channel] || 0) + 1;
    });
    var deltaProds = unmatchedProducts.length;

    var lastRun = flowState && (flowState.completedAt || flowState.lastRunAt);
    if (!lastRun) {
      // Fallback: a tenant with confirmed mappings shouldn't read "never" just
      // because the mappingFlowState doc lacks a completedAt stamp (it's only
      // written at the end of the full interstitial flow). Derive the most
      // recent confirmed-mapping verification time instead. Stays "never" only
      // when there are genuinely no mappings.
      var latestMs = 0;
      Object.keys(mappedListingIds).forEach(function(id) {
        var m = mappedListingIds[id];
        var t = m && (m.lastVerifiedAt || m.createdAt);
        if (t) { var ms = new Date(t).getTime(); if (ms > latestMs) latestMs = ms; }
      });
      if (latestMs > 0) lastRun = new Date(latestMs).toISOString();
    }
    var sinceText = lastRun ? relativeDateAgo(lastRun) : 'never';

    var deltaHtml = '';
    Object.keys(deltaByCh).forEach(function(ch) {
      deltaHtml +=
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:0.9rem;">' +
          '<span>' + esc(deltaByCh[ch]) + ' new ' + esc(channelLabel(ch)) + ' listing' +
          (deltaByCh[ch] === 1 ? '' : 's') + ' that haven\'t been mapped</span>' +
          '<button type="button" class="btn btn-secondary" data-mapping-action="review-deltas">Review &rarr;</button>' +
        '</div>';
    });
    if (deltaProds > 0) {
      deltaHtml +=
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:0.9rem;">' +
          '<span>' + esc(deltaProds) + ' new Mast product' + (deltaProds === 1 ? '' : 's') + ' without channel listings</span>' +
          '<button type="button" class="btn btn-secondary" data-mapping-action="review-deltas">Review &rarr;</button>' +
        '</div>';
    }
    if (!deltaHtml) {
      deltaHtml = '<div style="font-size:0.9rem;color:var(--success);padding:8px 0;">✓ All caught up — no new listings or products to map.</div>';
    }

    // All current mappings
    var allRows = existingMaps.filter(function(m) {
      if (reentryChannel !== 'all' && m.channel !== reentryChannel) return false;
      if (reentryFilter !== 'all' && m.confidence !== reentryFilter) return false;
      if (reentrySearch) {
        var p = productsById[m.productId];
        var hay = ((p && (p.title || p.name)) || '') + ' ' + ((p && p.sku) || '');
        if (hay.toLowerCase().indexOf(reentrySearch.toLowerCase()) < 0) return false;
      }
      return true;
    });

    // Group by productId for display.
    var byProduct = Object.create(null);
    allRows.forEach(function(m) {
      if (!byProduct[m.productId]) byProduct[m.productId] = [];
      byProduct[m.productId].push(m);
    });

    var listHtml = Object.keys(byProduct).map(function(pid) {
      var p = productsById[pid];
      var pTitle = p ? (p.title || p.name || pid) : pid;
      var entries = byProduct[pid].map(function(m) {
        return '<div style="font-size:0.78rem;color:var(--warm-gray);margin:2px 0;">' +
          esc(channelLabel(m.channel)) + ': ' + esc(m.externalId) +
          ' <span style="font-size:0.72rem;color:var(--warm-gray);">[' + esc(m.confidence) + ']</span>' +
          ' <button type="button" class="btn btn-secondary" style="font-size:0.72rem;padding:2px 6px;" data-mapping-action="unlink" data-map-id="' + esc(m.id) + '">unlink</button>' +
          '</div>';
      }).join('');
      return [
        '<div style="border-bottom:1px solid var(--border);padding:8px 0;">',
        '  <div style="font-size:0.9rem;font-weight:600;">' + esc(pTitle) + '</div>',
        entries,
        '</div>'
      ].join('');
    }).join('') || '<div style="padding:16px;font-size:0.85rem;color:var(--warm-gray);">No mappings match the current filter.</div>';

    var channelOpts = ['<option value="all">All channels</option>'].concat(
      connectedSet.map(function(ch) {
        return '<option value="' + esc(ch) + '"' + (reentryChannel === ch ? ' selected' : '') + '>' + esc(channelLabel(ch)) + '</option>';
      })
    ).join('');

    host.innerHTML = [
      '<div style="max-width:900px;margin:0 auto;padding:20px;">',
      '  <div style="font-size:1.6rem;margin-bottom:8px;">Channel Mapping</div>',
      '  <div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:24px;">Last full mapping: ' + esc(sinceText) + '</div>',
      '  <div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--surface-card);margin-bottom:24px;">',
      '    <div style="font-size:1rem;font-weight:600;margin-bottom:8px;">Since then we\'ve detected:</div>',
      deltaHtml,
      '  </div>',
      '  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">',
      '    <select id="mappingReentryFilter" style="font-size:0.85rem;padding:4px 8px;">',
      '      <option value="all"' + (reentryFilter === 'all' ? ' selected' : '') + '>All confidences</option>',
      '      <option value="sku-exact"' + (reentryFilter === 'sku-exact' ? ' selected' : '') + '>SKU exact</option>',
      '      <option value="heuristic-high"' + (reentryFilter === 'heuristic-high' ? ' selected' : '') + '>Heuristic high</option>',
      '      <option value="heuristic-low"' + (reentryFilter === 'heuristic-low' ? ' selected' : '') + '>Heuristic low</option>',
      '      <option value="user-confirmed"' + (reentryFilter === 'user-confirmed' ? ' selected' : '') + '>User-confirmed</option>',
      '    </select>',
      '    <select id="mappingReentryChannel" style="font-size:0.85rem;padding:4px 8px;">',
      channelOpts,
      '    </select>',
      '    <input id="mappingReentrySearch" type="search" placeholder="Search…" value="' + esc(reentrySearch) + '" style="font-size:0.85rem;padding:4px 8px;flex:1;min-width:120px;" />',
      '  </div>',
      '  <div style="border:1px solid var(--border);border-radius:8px;background:var(--surface-card);padding:0 16px;max-height:60vh;overflow-y:auto;">',
      listHtml,
      '  </div>',
      '  <div style="display:flex;justify-content:space-between;gap:8px;margin-top:16px;flex-wrap:wrap;">',
      '    <button type="button" class="btn btn-primary" data-mapping-action="rerun-auto-match">Re-run auto-match</button>',
      '    <button type="button" class="btn btn-secondary" data-mapping-action="export-csv">Export mapping CSV</button>',
      '  </div>',
      '</div>'
    ].join('');

    attachReentryHandlers(host);
  }

  function attachReentryHandlers(host) {
    var filter = document.getElementById('mappingReentryFilter');
    var chSel  = document.getElementById('mappingReentryChannel');
    var srch   = document.getElementById('mappingReentrySearch');
    if (filter) filter.addEventListener('change', function() { reentryFilter = filter.value; renderReentryView(); });
    if (chSel)  chSel.addEventListener('change', function() { reentryChannel = chSel.value; renderReentryView(); });
    if (srch)   srch.addEventListener('input', function() {
      reentrySearch = srch.value || '';
      // Debounce on input: simple re-render is fine at admin scale.
      renderReentryView();
      var s2 = document.getElementById('mappingReentrySearch');
      if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
    });
    host.querySelectorAll('[data-mapping-action]').forEach(function(el) {
      el.addEventListener('click', function() {
        var action = el.getAttribute('data-mapping-action');
        if (action === 'review-deltas' || action === 'rerun-auto-match') {
          computeMatches();
          openInterstitial();
        } else if (action === 'unlink') {
          var mid = el.getAttribute('data-map-id');
          if (!mid) return;
          unlinkMappingById(mid).then(function() {
            delete mappedListingIds[mid];
            existingMaps = existingMaps.filter(function(m) { return m.id !== mid; });
            renderReentryView();
            toast('Unlinked');
          }).catch(function(e) { toast('Failed to unlink: ' + (e.message || e), true); });
        } else if (action === 'export-csv') {
          exportMappingsCsv();
        }
      });
    });
  }

  function relativeDateAgo(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return iso;
    var days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    var mo = Math.floor(days / 30);
    return MastFormat.countNoun(mo, 'month') + ' ago';
  }

  function exportMappingsCsv() {
    var rows = [['productId', 'productTitle', 'channel', 'externalId', 'confidence', 'createdAt', 'batchId']];
    existingMaps.forEach(function(m) {
      var p = productsById[m.productId];
      rows.push([
        m.productId, (p && (p.title || p.name)) || '',
        m.channel, m.externalId, m.confidence,
        m.createdAt || '', m.batchId || ''
      ]);
    });
    // Cells run through the shared _csvCell guard (formula-injection-safe quoting:
    // prefixes "'" to =,+,-,@,tab,CR-leading cells + RFC-4180 quoting). Defensive
    // RFC-only fallback if the shell global is absent.
    var cell = (typeof window._csvCell === 'function')
      ? window._csvCell
      : function (s) { var v = String(s == null ? '' : s); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = rows.map(function(r) {
      return r.map(cell).join(',');
    }).join('\n');
    MastExport.downloadBlob('product-listing-mappings-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv');
  }

  // ============================================================
  // Module registration
  // ============================================================

  if (window.MastAdmin && typeof window.MastAdmin.registerModule === 'function') {
    window.MastAdmin.registerModule('mapping', {
      routes: {
        'mapping': {
          tab: 'mappingTab',
          setup: function() {
            var host = document.getElementById('mappingTabContent');
            // Scoped loader, deliberately NOT the global `.loading` class. The
            // re-entry view syncs FIVE collections (products, listings, maps,
            // channel_config, state) and on a cold cache can legitimately take
            // >8s — the global stalled-spinner watchdog (index.html, polls for
            // visible `.loading`) would otherwise auto-file a false
            // "spinner-timeout on mapping" bug report. Reuse the global `spin`
            // keyframe so it still reads as a spinner to the user.
            if (host) host.innerHTML = '<div style="padding:24px;color:var(--warm-gray);display:flex;align-items:center;gap:10px;">' +
              '<span style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--teal);border-radius:50%;display:inline-block;animation:spin 0.8s linear infinite;"></span>Loading mappings…</div>';
            loadAll(true).then(function() {
              computeMatches();
              renderReentryView();
            }).catch(function(err) {
              if (host) host.innerHTML = '<div style="padding:24px;color:var(--danger);">Failed to load: ' + esc(err.message || err) + '</div>';
            });
          }
        }
      },
      detachListeners: function() {
        loadedAt = 0;
        listings = []; products = []; existingMaps = [];
        productsById = Object.create(null);
        mappedListingIds = Object.create(null);
        channelConfigs = Object.create(null);
        flowStep = null;
      }
    });
  }

  // WS2: route unlink through deleteListingMapping (tears down the Drive
  // projection — binding + reverse index — before removing the identity
  // row) instead of a raw MastDB.remove that would strand a binding the
  // oversell Drive keeps pushing to. mid is `${channel}_${externalId}`;
  // channel never contains '_', externalId may, so split on the FIRST '_'.
  // Shared by the legacy re-entry view and MappingBridge (mapping-v2).
  function unlinkMappingById(mid) {
    var us = mid.indexOf('_');
    if (window.firebase && firebase.functions && us > 0) {
      return firebase.functions().httpsCallable('deleteListingMapping')({
        tenantId: window.TENANT_ID || (window.MastDB && MastDB.tenantId && MastDB.tenantId()),
        channel: mid.slice(0, us),
        externalId: mid.slice(us + 1)
      });
    }
    return window.MastDB.remove('product_listing_map/' + mid);
  }

  // ============================================================
  // V2 bridge — state-free core shared with mapping-v2 (playbook §4:
  // the twin never re-implements a write). All writes are the SAME paths
  // legacy uses: persistMapping → confirmListingMapping CF,
  // unlinkMappingById → deleteListingMapping CF, ignore/restore → the
  // closed-enum channel_listings field writes.
  // ============================================================
  window.MappingBridge = {
    IGNORE_REASONS: IGNORE_REASON_ENUM,
    isValidIgnoredReason: isValidIgnoredReason,
    // listing: the channel_listings row ({ id, _channel, _externalId, … }).
    confirmMapping: function(productId, listing) {
      return persistMapping(productId, listing, 'user-confirmed');
    },
    // mapId = `${channel}_${externalId}` (product_listing_map doc id).
    unlinkMapping: unlinkMappingById,
    setListingIgnored: function(listingId, reasonEnum) {
      if (!isValidIgnoredReason(reasonEnum)) {
        return Promise.reject(new Error('invalid ignore reason: ' + reasonEnum));
      }
      return window.MastDB.update('channel_listings/' + listingId, {
        _ignored: true, _ignoredReason: reasonEnum, _ignoredSetBy: 'tenant'
      });
    },
    restoreListing: function(listingId) {
      return window.MastDB.update('channel_listings/' + listingId, {
        _ignored: false, _ignoredReason: null, _ignoredSetBy: null
      });
    }
  };

  // Public API — consumed by index.html boot trigger and channels.js
  // post-connect handler.
  window.MastMappingFlow = {
    checkAndMaybeShow: checkAndMaybeShow,
    open: function() {
      return loadAll(true).then(function() {
        computeMatches();
        openInterstitial();
      });
    },
    isInFlow: function() { return flowStep !== null; },
    // Lightweight status read for the dashboard "Set Up Your Shop" checklist —
    // computes whether mapping is done / still has pending work WITHOUT mounting
    // the interstitial. `pending` is true only when a channel is connected and
    // there are unmapped, non-ignored listings. Dismissal does NOT mark it done,
    // so the dashboard entry stays available after the takeover is dismissed.
    status: function() {
      return loadAll(false).then(function() {
        if (flowState && flowState.completedAt) return { completed: true, pending: false };
        var connected = Object.keys(channelConfigs).some(function(ch) {
          return channelConfigs[ch] && channelConfigs[ch]._tokenStatus === 'ok';
        });
        if (!connected) return { completed: false, pending: false };
        computeMatches();
        var pending = skuMatchPairs.length + fuzzyQueue.length + unmatchedListings.length + skuCollisions.length;
        return { completed: false, pending: pending > 0 };
      }).catch(function() { return { completed: false, pending: false }; });
    },
    _heuristics: HEURISTICS  // exposed for test / debugging
  };

})();
