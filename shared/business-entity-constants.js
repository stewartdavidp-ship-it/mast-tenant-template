/* business-entity-constants.js
 *
 * Constants and regulatory-locked UI copy for the Business Entity Phase 1 wizard
 * and Settings flows. Loaded globally as `window.BusinessEntityConstants`.
 *
 * DO NOT REMOVE OR EDIT THE DEFENSIVE-COPY STRINGS WITHOUT COUNSEL APPROVAL.
 * The EIN + DPA + Notice-at-Collection text below is regulatory non-negotiable
 * per ~/.claude/plans/mast-business-entity-spec.md §8.2. Stripping the inline
 * SSN warning creates trust failure before the server validator ever runs,
 * and the DPA click-through is a CCPA/CPA/VCDPA/CTDPA processor-terms gate.
 *
 * Cross-references:
 *   - processImportJob mode branch: mast-architecture/functions/import-job-mode.js
 *     VALID_MODES = ['storefront','pim-only','draft-only']. The ENGAGEMENT_MODE_TO_JOB_MODE
 *     table below MUST map exactly into that enum — drift breaks C3a.
 *   - Spec §3 activation required fields: mirrored in shared/mastdb.js REQUIRED_AT_ACTIVATE.
 *   - Spec §4 archetype taxonomy: mirrored in shared/mastdb.js ARCHETYPE_DEFAULTS.
 */
(function(global) {
  'use strict';

  var DPA_VERSION = '2026-05-v1';
  var DPA_URL = '/dpa';
  var PRIVACY_POLICY_URL = '/privacy';

  // Engagement mode × import-job mode mapping (spec §5 matrix + C3a helper).
  // DO NOT change without updating functions/import-job-mode.js VALID_MODES.
  var ENGAGEMENT_MODE_TO_JOB_MODE = {
    'storefront':    'storefront',
    'sync-channels': 'pim-only',
    'back-office':   'draft-only'
  };

  // Per spec §5 D3 matrix, defaults per mode.
  var DEFAULT_SURFACE_BY_MODE = {
    'storefront':    'hybrid',
    'sync-channels': 'ui-first',
    'back-office':   'ai-first',
    'hybrid':        'ui-first'
  };

  // Regulatory copy — DO NOT EDIT WITHOUT COUNSEL APPROVAL.
  // Source: spec §8.2 defensive UI copy, non-negotiable #7, #14.

  var EIN_COPY = {
    label: 'Business Tax ID (EIN) — optional',
    format: 'Format: XX-XXXXXXX',
    // The shield-emoji warning is load-bearing: it is the primary defense against
    // sole-prop users entering SSNs. Removing it creates trust failure before the
    // server validator runs (spec §8.2, regulatory non-negotiable #7).
    warning: '\uD83D\uDEE1\uFE0F If you\u2019re a sole proprietor without an EIN, leave this blank. Do not enter your Social Security Number. Mast does not need your SSN.',
    // Modal shown when user enters a bare 9-digit or SSN-area-range value.
    ssnModalTitle: 'That looks like an SSN',
    ssnModalBody: 'Mast only accepts EINs. If you don\u2019t have an EIN, leave the field blank.',
    ssnModalCta: 'Clear the field'
  };

  var DPA_COPY = {
    // Checkbox label rendered in B4. Submission BLOCKS until checked.
    checkbox: 'I\u2019ve read and agree to the Mast Data Processing Addendum.',
    // Required marker — displayed separately for accessibility (spec §8.4).
    requiredLabel: '(Required.)',
    linkText: 'Data Processing Addendum',
    linkUrl: DPA_URL,
    // Shown on unsuccessful activation when DPA is missing.
    missingError: 'You must accept the Data Processing Addendum to continue.'
  };

  var NOTICE_AT_COLLECTION_COPY = {
    // CCPA-required; harmless elsewhere. Rendered beneath primary-contact section
    // per spec §8.2.
    body: 'We collect your name and email to manage your Mast account and provide support. We don\u2019t sell your information.',
    privacyLinkText: 'Privacy Policy',
    dpaLinkText: 'Data Processing Addendum'
  };

  var WISH_STATEMENT_PLACEHOLDER =
    'e.g., \u201CGetting my Etsy and shows in one place is eating my weekends.\u201D ' +
    'Avoid including personal identifiers like SSN, passwords, or account numbers.';

  // Revenue bracket options (spec §8.1 calibration).
  var REVENUE_BRACKETS = [
    { value: 'under-10k', label: 'Under $10K / year' },
    { value: '10k-50k',   label: '$10K \u2013 $50K / year' },
    { value: '50k-250k',  label: '$50K \u2013 $250K / year' },
    { value: '250k-1m',   label: '$250K \u2013 $1M / year' },
    { value: '1m+',       label: '$1M+ / year' }
  ];

  // Primary-contact role options (spec §8.1).
  var PRIMARY_CONTACT_ROLES = [
    { value: 'owner',      label: 'Owner' },
    { value: 'partner',    label: 'Partner' },
    { value: 'employee',   label: 'Employee' },
    { value: 'accountant', label: 'Accountant' },
    { value: 'other',      label: 'Other' }
  ];

  var TEAM_SIZE_BANDS = [
    { value: 'solo',  label: 'Just me' },
    { value: '2-3',   label: '2\u20133' },
    { value: '4-10',  label: '4\u201310' },
    { value: '11+',   label: '11+' }
  ];

  // Channel enum for presence.declaredChannels[] and B9 multi-select.
  var DECLARED_CHANNELS = [
    { value: 'etsy',        label: 'Etsy' },
    { value: 'shopify',     label: 'Shopify' },
    { value: 'square',      label: 'Square' },
    { value: 'amazon',      label: 'Amazon' },
    { value: 'faire',       label: 'Faire' },
    { value: 'bigcartel',   label: 'Big Cartel' },
    { value: 'ebay',        label: 'eBay' },
    { value: 'in-person',   label: 'In-person / pop-ups' },
    { value: 'wholesale',   label: 'Wholesale' },
    { value: 'consignment', label: 'Consignment' },
    { value: 'other',       label: 'Other' }
  ];

  // Archetype enum display labels + helper descriptions (spec §4).
  // Grouped for the B1a searchable dropdown.
  var ARCHETYPES = [
    { value: 'glass-artisan',         label: 'Glass artisan',          group: 'Makers',  hint: 'Glassblowing, stained glass, slumped/cast glass.' },
    { value: 'ceramics-pottery',      label: 'Ceramics & pottery',     group: 'Makers',  hint: 'Wheel-thrown, hand-built, or slipcast pottery.' },
    { value: 'jewelry-maker',         label: 'Jewelry maker',          group: 'Makers',  hint: 'Metalsmithing, beadwork, wirework, resin.' },
    { value: 'fiber-textile',         label: 'Fiber & textile',        group: 'Makers',  hint: 'Weaving, knitting, quilting, sewn goods.' },
    { value: 'woodworker',            label: 'Woodworker',             group: 'Makers',  hint: 'Furniture, turnery, carved goods.' },
    { value: 'painter-printmaker',    label: 'Painter / printmaker',   group: 'Makers',  hint: 'Painting, screenprint, letterpress, giclée.' },
    { value: 'leather-metal',         label: 'Leather & metalwork',    group: 'Makers',  hint: 'Leathercraft, blacksmith, ironwork.' },
    { value: 'mixed-media-artist',    label: 'Mixed-media artist',     group: 'Makers',  hint: 'Assemblage, sculpture, multi-material.' },
    { value: 'instructor-studio',     label: 'Instructor / studio',    group: 'Service', hint: 'Classes + studio-time rentals.' },
    { value: 'commissioned-services', label: 'Commissioned services',  group: 'Service', hint: 'Custom-only or mostly-custom work.' },
    { value: 'other-maker',           label: 'Other / describe later', group: 'Other',   hint: 'Escape hatch — you can refine this later.' }
  ];

  // Engagement goals enum + human labels (spec §5 D4 + archetypeDefaults goalsAvailable).
  var GOAL_LABELS = {
    'increase-revenue':        'Increase revenue',
    'get-online-shop':         'Get an online shop up',
    'sync-channels':           'Sync existing channels',
    'take-bookings':           'Take bookings',
    'track-inventory':         'Track inventory',
    'reduce-admin-time':       'Reduce admin time',
    'consignment-tracking':    'Track consignment',
    'wholesale-catalog':       'Run a wholesale catalog',
    'commission-management':   'Manage commissions',
    'edition-tracking':        'Track print editions',
    'gallery-submissions':     'Manage gallery submissions',
    'print-on-demand':         'Print-on-demand',
    'project-timeline':        'Keep project timelines',
    'bespoke-quotes':          'Send bespoke quotes',
    'portfolio-display':       'Display a portfolio',
    'editorial-features':      'Pitch editorial features',
    'class-registration':      'Take class registrations',
    'waitlist-management':     'Manage waitlists',
    'student-communication':   'Communicate with students',
    'lead-capture':            'Capture leads',
    'project-pipeline':        'Run a project pipeline',
    'deposit-tracking':        'Track deposits'
  };

  // Engagement-mode card copy (spec §5 matrix).
  var ENGAGEMENT_MODE_CARDS = [
    {
      value: 'sync-channels',
      title: 'Sync My Channels',
      body: 'Mast as the source-of-truth for your existing storefront(s) on Etsy, Shopify, Square, and more.',
      defaultSurface: 'ui-first'
    },
    {
      value: 'back-office',
      title: 'Run My Back Office',
      body: 'POS, customers, orders, inventory \u2014 no online storefront.',
      defaultSurface: 'ai-first'
    },
    {
      value: 'storefront',
      title: 'Build Me a Storefront Too',
      body: 'We\u2019ll set up your public storefront alongside everything else.',
      defaultSurface: 'hybrid'
    }
  ];

  var SURFACE_OPTIONS = [
    { value: 'ai-first', label: 'AI-first',  hint: 'Dashboard + Advisor. Ask in plain English.' },
    { value: 'ui-first', label: 'UI-first',  hint: 'Classic menus and forms.' },
    { value: 'hybrid',   label: 'Hybrid',    hint: 'Both — Advisor banner + full nav.' }
  ];

  // Pure EIN validator matching the tenant MCP server-side helper. On-blur UX.
  // Returns { ok, reason }. Reason codes used by the modal.
  function validateEin(raw) {
    if (raw === null || raw === undefined) return { ok: true, reason: null };
    var v = String(raw).trim();
    if (v === '') return { ok: true, reason: null };
    // SSN-shaped: nine digits with 3-2-4 dashes OR bare 9 digits.
    if (/^\d{3}-\d{2}-\d{4}$/.test(v)) return { ok: false, reason: 'ssn-shaped' };
    if (/^\d{9}$/.test(v))             return { ok: false, reason: 'bare-9-digits' };
    if (!/^\d{2}-\d{7}$/.test(v))      return { ok: false, reason: 'malformed' };
    // Don't accept IRS-listed invalid prefixes; the server-side validator is authoritative.
    return { ok: true, reason: null };
  }

  global.BusinessEntityConstants = {
    DPA_VERSION: DPA_VERSION,
    DPA_URL: DPA_URL,
    PRIVACY_POLICY_URL: PRIVACY_POLICY_URL,
    ENGAGEMENT_MODE_TO_JOB_MODE: ENGAGEMENT_MODE_TO_JOB_MODE,
    DEFAULT_SURFACE_BY_MODE: DEFAULT_SURFACE_BY_MODE,
    EIN_COPY: EIN_COPY,
    DPA_COPY: DPA_COPY,
    NOTICE_AT_COLLECTION_COPY: NOTICE_AT_COLLECTION_COPY,
    WISH_STATEMENT_PLACEHOLDER: WISH_STATEMENT_PLACEHOLDER,
    REVENUE_BRACKETS: REVENUE_BRACKETS,
    PRIMARY_CONTACT_ROLES: PRIMARY_CONTACT_ROLES,
    TEAM_SIZE_BANDS: TEAM_SIZE_BANDS,
    DECLARED_CHANNELS: DECLARED_CHANNELS,
    ARCHETYPES: ARCHETYPES,
    GOAL_LABELS: GOAL_LABELS,
    ENGAGEMENT_MODE_CARDS: ENGAGEMENT_MODE_CARDS,
    SURFACE_OPTIONS: SURFACE_OPTIONS,
    validateEin: validateEin
  };
})(typeof window !== 'undefined' ? window : this);
