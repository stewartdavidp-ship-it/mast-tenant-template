/* MAST revenue channel normalization — CANONICAL. Byte-identical in:
 *   mast-tenant-template/shared/channel-normalization.core.js
 *   mast-mcp-server/src/shared/channel-normalization.core.js
 *
 * Parity is enforced by a SHA-256 check in BOTH repos' CI (the template's
 * scripts/lint-channel-normalization-parity.js and the MCP's vitest fixture
 * test channel-normalization.test.ts), so the finance revenue UI and the MCP
 * finance_get_revenue / finance_get_pnl aggregators cannot drift apart.
 * To change the channel taxonomy:
 *   1. edit BOTH copies identically,
 *   2. re-bless the SHA constant in both repos' parity checks,
 *   3. bump MAST_MODULES_V in mast-tenant-template (cache-bust guard).
 *
 * WHY THIS EXISTS: revenue records carry a free-form `source` string written
 * by many code paths (Shopify sync writes "Online Store", POS writes "pos" or
 * the legacy "direct-pos", phone/manual entry write their own). Grouping
 * revenue on the raw string fragments a single real-world channel across
 * several keys (pos + direct-pos, online + "Online Store"), so per-channel
 * reporting is unreliable even though the grand total is correct. normalize()
 * collapses every known synonym onto ONE canonical channel key aligned with the
 * channels.js taxonomy (dtc_online / marketplace / in_person / wholesale /
 * social), plus the operational buckets phone / manual / test. It is applied at
 * READ/aggregation time so it also repairs historical mixed-source data.
 *
 * PURE: no I/O, no DOM, no globals beyond the namespace assignment below.
 *
 * Classic-script-safe ES5 IIFE (no import/export/module syntax) so it loads as
 * a browser <script> in the template AND runs as a Node side-effect import in
 * the MCP. It assigns its API onto the global (window in the browser,
 * globalThis in Node) as `MastChannels`.
 */
(function (root) {
  'use strict';

  // Canonical channel keys + presentation. Order = display order (most
  // owned/direct first). Keys intentionally match the channels.js route-level
  // taxonomy so the finance breakdown and the channels config speak the same
  // language; phone / manual / test are operational buckets with no channel
  // route, and `other` is the fallback presentation for an unmapped key.
  var CANONICAL = {
    dtc_online:  { label: 'Online Store',  color: '#3b82f6' },
    marketplace: { label: 'Marketplace',   color: '#8b5cf6' },
    in_person:   { label: 'In-Person',     color: '#16a34a' },
    wholesale:   { label: 'Wholesale',     color: '#22c55e' },
    social:      { label: 'Social / Live', color: '#ec4899' },
    phone:       { label: 'Phone',         color: '#0ea5e9' },
    manual:      { label: 'Manual',        color: '#6b7280' },
    test:        { label: 'Test',          color: '#f59e0b' },
    other:       { label: 'Other',         color: '#888888' }
  };

  // Display order for the canonical keys above.
  var CHANNELS = ['dtc_online', 'marketplace', 'in_person', 'wholesale', 'social', 'phone', 'manual', 'test', 'other'];

  // Raw `source` synonym -> canonical key. Map keys are already in canonicalize()
  // form (lowercased, separator runs collapsed to a single '-'). Add a row here
  // when a new source string shows up in the data rather than letting it
  // fragment a channel. Payment processors map to their dominant channel
  // (square -> in-person reader, stripe -> online checkout).
  var SOURCE_MAP = {
    // dtc_online — the maker's own online storefront / web checkout
    'online': 'dtc_online',
    'online-store': 'dtc_online',
    'dtc-online': 'dtc_online',
    'dtc': 'dtc_online',
    'web': 'dtc_online',
    'website': 'dtc_online',
    'storefront': 'dtc_online',
    'shopify': 'dtc_online',
    'stripe': 'dtc_online',
    // marketplace — third-party platforms
    'marketplace': 'marketplace',
    'etsy': 'marketplace',
    'amazon': 'marketplace',
    'ebay': 'marketplace',
    // in_person — POS, craft fairs, walk-in, legacy "direct" / "direct-pos"
    'pos': 'in_person',
    'direct-pos': 'in_person',
    'direct': 'in_person',
    'in-person': 'in_person',
    'square': 'in_person',
    'craft-fair': 'in_person',
    'craft-fairs': 'in_person',
    'fair': 'in_person',
    'market': 'in_person',
    'mobile-events': 'in_person',
    'own-storefront': 'in_person',
    'retail': 'in_person',
    'register': 'in_person',
    'walk-in': 'in_person',
    // wholesale — retailers, galleries, consignment, prebuy
    'wholesale': 'wholesale',
    'wholesale-prebuy': 'wholesale',
    'retail-prebuy': 'wholesale',
    'consignment': 'wholesale',
    'prebuy': 'wholesale',
    // social — live / social selling
    'social': 'social',
    'social-live': 'social',
    'instagram': 'social',
    'tiktok': 'social',
    'live': 'social',
    // operational buckets (no channel route)
    'phone': 'phone',
    'call': 'phone',
    'telephone': 'phone',
    'manual': 'manual',
    'adjustment': 'manual',
    'test': 'test'
  };

  // Lowercase, trim, collapse runs of whitespace / underscores / hyphens to a
  // single '-'. "Online Store" -> "online-store"; "direct_pos" -> "direct-pos".
  function canonicalize(source) {
    var raw = (source === null || source === undefined) ? '' : String(source);
    raw = raw.replace(/^\s+|\s+$/g, '').toLowerCase();
    raw = raw.replace(/[\s_\-]+/g, '-');
    raw = raw.replace(/^-+|-+$/g, '');
    return raw;
  }

  // Map a raw source string to its canonical channel key. Known synonyms
  // collapse to one key; an unmapped source falls through as its cleaned form
  // (so a brand-new channel still shows up by name rather than vanishing into a
  // generic bucket, while never re-fragmenting on case/whitespace). An empty or
  // missing source returns 'other'.
  function normalize(source) {
    var key = canonicalize(source);
    if (!key) return 'other';
    if (Object.prototype.hasOwnProperty.call(SOURCE_MAP, key)) return SOURCE_MAP[key];
    return key;
  }

  function titleCase(key) {
    return String(key).replace(/[-_]+/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }

  // Display label for a canonical (or passthrough) key.
  function label(key) {
    if (Object.prototype.hasOwnProperty.call(CANONICAL, key)) return CANONICAL[key].label;
    return titleCase(key);
  }

  // Display color for a canonical (or passthrough) key.
  function color(key) {
    if (Object.prototype.hasOwnProperty.call(CANONICAL, key)) return CANONICAL[key].color;
    return '#888888';
  }

  root.MastChannels = {
    normalize: normalize,
    canonicalize: canonicalize,
    label: label,
    color: color,
    CHANNELS: CHANNELS,
    CANONICAL: CANONICAL,
    SOURCE_MAP: SOURCE_MAP
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
