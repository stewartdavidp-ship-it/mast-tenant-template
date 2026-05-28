/**
 * Product schema extensions — Audit & Coaching Wedge V1.
 *
 * J03 adds six tenant-declared fields to `tenants/{tid}/products/{pid}`.
 * These are co-located with audit.ts because the wedge audit rules read
 * them (DR-06 reads intendedChannels; conditional defaults read
 * productSubtype + technique; dimensions/weight feed mapping in J11).
 *
 * V1 contract:
 *   - All six fields are optional/nullable on read. Existing products
 *     written before J03 must read fine with these absent.
 *   - Legacy flat fields (weightOz, lengthIn, widthIn, heightIn) stay on
 *     the product doc as-is. New writes populate the structured shapes
 *     alongside; readers prefer structured and fall back to legacy.
 *   - `canonicalSource` is always null in V1. V2 master-of-truth
 *     graduation will populate it. Schema includes from day 1 to avoid
 *     a future backfill (per project_mast_audit_wedge_design_2026_05_27).
 *   - `technique` + `productSubtype` are archetype-aware enums sourced
 *     from the playbook content repo (J09). Until J09 ships, both are
 *     free-text. `playbookSubtypeRequired(archetype)` is the gate signal
 *     the create form will read once J09 publishes per-archetype enums.
 */

// ============================================================================
// Dimensions + weight (structured)
// ============================================================================

export type LengthUnit = 'in' | 'cm';
export type WeightUnit = 'g' | 'oz' | 'lb' | 'kg';

export interface ProductDimensions {
  l?: number;
  w?: number;
  h?: number;
  unit: LengthUnit;
}

export interface ProductWeight {
  value: number;
  unit: WeightUnit;
}

// ============================================================================
// Intended channels (DR-06 input)
// ============================================================================

/**
 * Broader than audit.ts ChannelKey (which is the audit-tracked subset).
 * Sourced from app/modules/channels.js PLATFORMS plus internal-only keys
 * (manual / consignment) the seller may declare intent against.
 */
export type ProductChannelKey =
  | 'manual'
  | 'consignment'
  | 'shopify'
  | 'etsy'
  | 'square'
  | 'squarespace'
  | 'amazon'
  | 'tiktok'
  | 'instagram';

/**
 * Intent semantics (DR-06 audit behavior per intent):
 *   - 'plan-to-list'    → expected on this channel; missing listing is a violation
 *   - 'wholesale-only'  → never expected on retail channels
 *   - 'retired'         → never expected anywhere; auto-suppresses listing-drift
 *   - 'in-development'  → snoozes audit checks for 90 days from declaration
 */
export type ProductChannelIntent =
  | 'plan-to-list'
  | 'wholesale-only'
  | 'retired'
  | 'in-development';

export interface IntendedChannel {
  channelKey: ProductChannelKey | string;
  intent: ProductChannelIntent;
}

// ============================================================================
// Product extensions
// ============================================================================

/**
 * The six J03 fields. Spread onto the existing product doc shape —
 * Product type elsewhere in the codebase is still vanilla-JS-shaped, so
 * this interface intentionally only describes the additions.
 */
export interface ProductWedgeFields {
  dimensions: ProductDimensions | null;
  weight: ProductWeight | null;
  technique: string | null;
  productSubtype: string | null;
  intendedChannels: IntendedChannel[];
  canonicalSource: string | null;
}

// ============================================================================
// Playbook gate signal (J09 will replace stub)
// ============================================================================

/**
 * Returns true when the given archetype's playbook declares a non-empty
 * productSubtype enum, which means the product-create form must gate
 * submission on selection.
 *
 * V1 stub: always returns false (J09 hasn't shipped a playbook content
 * repo yet, so the enum signal isn't reachable). Wire-up is complete —
 * the gate activates automatically when J09 lands and this helper reads
 * the playbook signal instead of returning false.
 */
export function playbookSubtypeRequired(_archetype: string | null | undefined): boolean {
  return false;
}
