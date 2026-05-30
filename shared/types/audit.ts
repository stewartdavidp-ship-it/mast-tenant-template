/**
 * Audit & Coaching Wedge V1 — shared types.
 *
 * Canonical TypeScript shapes for the three Firestore collections that
 * support the audit/coaching wedge. Sources of truth:
 *   - wedge §9 (channel_listings)
 *   - wedge §8 (rule_suppressions)
 *   - wedge §7 (audit_results — individual violations only; rollups are
 *     computed on read by J13, never persisted).
 *
 * Mast architecture repo owns the matching Firestore rules + composite
 * indexes (rules/firestore.rules, firestore.indexes.json).
 *
 * Ownership notes:
 *   - channel_listings: written by Cloud Functions (webhook + backfill
 *     paths) via Admin SDK. Clients read-only.
 *   - audit_results: written by the audit runner (J13) via Admin SDK.
 *     Clients read-only. Stateless — recomputed per run.
 *   - rule_suppressions: tenant-admin RW; reasonText capped at 140 chars
 *     and only valid when reason === 'other'.
 */

// ============================================================================
// channel_listings  — tenants/{tid}/channel_listings/{listingId}
// listingId convention: `${channel}_${externalId}`
// ============================================================================

export type ChannelKey = 'shopify' | 'etsy' | 'square';

export type ChannelTokenStatus = 'ok' | 'revoked' | 'expired';

export type ChannelIgnoredReason =
  | 'draft'
  | 'test'
  | 'retired'
  | 'tenant-marked'
  | null;

/**
 * Normalized photo entry in a channel listing.
 */
export interface NormalizedPhoto {
  externalId: string | null;
  url: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Normalized variant entry in a channel listing.
 * `price`/`compareAtPrice` are integer cents (avoid float comparison wobble).
 */
export interface NormalizedVariant {
  externalId: string | null;
  sku: string | null;
  title: string | null;
  price: number | null;
  compareAtPrice: number | null;
  stock: number | null;
  weight: number | null;
  weightUnit: string | null;
}

/**
 * Canonical projection of a channel listing. Drift rules consume this
 * shape exclusively — `raw` is forensic-only.
 */
export interface NormalizedChannelListing {
  title: string;
  descriptionPlain: string;
  descriptionHtml?: string;
  price: number | null;
  compareAtPrice?: number | null;
  stock: number | null;
  photos: NormalizedPhoto[];
  tags: string[];
  sku: string | null;
  variants: NormalizedVariant[];
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  weight: number | null;
}

/**
 * channel_listings doc shape (wedge §9).
 *
 * `_status` is reserved for the listing-side status flag (e.g. archived,
 * unlisted). J01 does not yet populate it — readers must treat it as
 * optional; the canonical status during the V1 phase lives at
 * `normalized.status`. See deviation log on Job J02.
 */
export interface ChannelListingDoc {
  _channel: ChannelKey;
  _externalId: string;
  _fetchedAt: string;
  _sourceVersion: string;
  _tokenStatus: ChannelTokenStatus;
  _ignored: boolean;
  _ignoredReason: ChannelIgnoredReason;
  _ignoredSetBy?: 'tenant' | 'heuristic';
  _status?: string;
  raw: unknown;
  normalized: NormalizedChannelListing | null;
}

export function channelListingDocId(
  channel: ChannelKey,
  externalId: string | number,
): string {
  return `${channel}_${externalId}`;
}

// ============================================================================
// rule_suppressions  — tenants/{tid}/rule_suppressions/{suppId}
// ============================================================================

export type SuppressionScope = 'product' | 'category' | 'tenant';

/**
 * Enumerated suppression reasons (wedge §8). `other` requires a
 * `reasonText` ≤140 chars; all other reasons must omit `reasonText`.
 * Update the Firestore rule field-cap when extending this enum.
 */
export type SuppressionReason =
  | 'not-applicable'
  | 'intentional'
  | 'temporary'
  | 'disagree'
  | 'other';

export interface RuleSuppressionDoc {
  ruleId: string;
  scope: SuppressionScope;
  scopeId: string;
  reason: SuppressionReason;
  /** ≤140 chars, only present when reason === 'other'. */
  reasonText?: string;
  createdAt: string;
  createdBy: string;
  /** Links a batch-per-product suppression set; null for one-offs. */
  batchId: string | null;
}

export const SUPPRESSION_REASON_TEXT_MAX = 140;

// ============================================================================
// audit_results  — tenants/{tid}/audit_results/{violationId}
// Stateless — individual violations only. Rollups are computed on read.
// ============================================================================

export type AuditSeverity = 'high' | 'medium' | 'low' | 'informational';

/**
 * Audit tier — categorizes the rule grouping for UI navigation. Concrete
 * tier values are defined by the rule catalog (J03+); kept open as
 * string here so the schema doesn't have to chase rule-catalog churn.
 */
export type AuditTier = string;

export type AuditViolationState =
  | 'active'
  | 'snoozed'
  | 'resolved-pending-recheck';

/** Rule family prefix. Mirrors wedge-rule-tiers.js FAMILIES. */
export type AuditFamily = 'LQ' | 'DR' | 'PP' | 'MM';

export interface AuditViolationDoc {
  ruleId: string;
  /** Rule-family prefix (LQ/DR/PP/MM) — denormalized from the rule registry. */
  family: AuditFamily;
  productId: string;
  /** Optional: which channel_listing triggered this (when applicable). */
  listingId?: string;
  /**
   * Channels the violation applies to. Stored as channel keys
   * (`'shopify'`, `'etsy'`, etc.) — not full channel_listing IDs — so the
   * audit UI can group by channel without a join. When a violation is
   * tied to a specific listing, `listingId` carries that pointer.
   */
  channels: ChannelKey[];
  severity: AuditSeverity;
  tier: AuditTier;

  // ── Display triad (what the admin audit UI renders) ──────────────────
  // app/modules/audit.js reads `title` / `detail` / `suggestion` for every
  // finding. The writer (wedge-audit-writer.js) is the single source that
  // assembles them: `title` from the rule registry's `description`,
  // `detail` from the evaluator's per-finding specifics (e.g. the
  // "$25 (Shopify) vs $30 (Etsy)" cross-channel price comparison), and
  // `suggestion` from the rule registry's `suggestion` template. Keeping
  // them on the doc (rather than re-deriving on read) means the UI renders
  // the concrete values without re-running rules or joining the registry.

  /** Human-readable rule label — the finding heading. */
  title: string;
  /** Per-finding specifics with concrete values (the demo punchline). */
  detail: string;
  /** Recommended fix, from the rule registry's `suggestion` template. */
  suggestion?: string;

  // ── Forensic / raw evaluator output ──────────────────────────────────
  // The structured output the rule evaluator produced, retained for
  // analytics and debugging. `detail` above is the human rendering of this.
  /** Raw evaluator value (number | string | array | object), rule-specific. */
  value?: unknown;
  /** Raw evaluator output — a string (drift/LQ/PP rules) or object (MM-01). */
  details?: string | Record<string, unknown> | null;

  createdAt: string;
  lastSeenAt: string;
  /** Updated whenever `state` changes (create / fix / reopen). */
  lastChangedAt: string;
  state: AuditViolationState;
  /** Only meaningful when state === 'snoozed'. */
  snoozeUntil?: string;
  /** Per-violation dismissal counter. Rollup dismissals do NOT update this. */
  dismissCount: number;
}

// ============================================================================
// Collection path helpers
// ============================================================================

export const auditCollections = {
  channelListings: (tid: string) => `tenants/${tid}/channel_listings`,
  ruleSuppressions: (tid: string) => `tenants/${tid}/rule_suppressions`,
  auditResults: (tid: string) => `tenants/${tid}/audit_results`,
} as const;
