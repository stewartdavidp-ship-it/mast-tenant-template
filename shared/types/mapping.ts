/**
 * Audit & Coaching Wedge V1 — product↔listing mapping types (J04).
 *
 * The join between Mast products and per-channel listings.
 * Sources of truth:
 *   - wedge §12 (no product↔listing mapping blocks all drift rules)
 *   - mast-architecture rules/firestore.rules
 *       match /tenants/{tid}/product_listing_map/{mapId}
 *   - mast-architecture functions/lib/product-listing-map.js (CF-side helpers)
 *
 * Doc id convention: `${channel}_${externalId}` — same as channel_listings.
 * Same listing always lands on the same map doc, which structurally
 * enforces "one channel listing maps to at most one Mast product per
 * tenant" without a CF gate or transactional uniqueness check.
 *
 * Channel coverage here intentionally exceeds the V1 sync surface
 * (`ChannelKey` in audit.ts is `'shopify' | 'etsy' | 'square'`): tenants
 * may map Squarespace/Wix listings to Mast products even before those
 * channels have a live sync adapter, since the mapping table feeds
 * downstream UI (J11) and rule surfaces (J10/J16) independently.
 */

export type MapChannelKey =
  | 'etsy'
  | 'shopify'
  | 'square'
  | 'squarespace'
  | 'wix';

/**
 * Provenance of the (productId ↔ externalId) match. Persisted so the
 * downstream "low-confidence mappings to re-review" surface (J11) can
 * filter by provenance.
 *   - user-confirmed: an admin clicked confirm in the mapping UI
 *   - sku-exact:      heuristic auto-match on identical SKU
 *   - heuristic-high: title + price within 10% (or equivalent strong signal)
 *   - heuristic-low:  weaker title-similarity match — needs human review
 */
export type MappingConfidence =
  | 'user-confirmed'
  | 'sku-exact'
  | 'heuristic-high'
  | 'heuristic-low';

export interface ProductListingMapDoc {
  productId: string;
  channel: MapChannelKey;
  externalId: string;
  confidence: MappingConfidence;
  createdAt: string;
  createdBy: string;
  /**
   * Last time the mapping was re-verified (by user confirm or heuristic
   * re-evaluation). Defaults to createdAt on first write.
   */
  lastVerifiedAt: string;
  /** Links bulk operations (e.g. mass-confirm during onboarding); null for one-offs. */
  batchId: string | null;
}

export function productListingMapDocId(
  channel: MapChannelKey,
  externalId: string | number,
): string {
  return `${channel}_${externalId}`;
}

export const mappingCollections = {
  productListingMap: (tid: string) => `tenants/${tid}/product_listing_map`,
} as const;
