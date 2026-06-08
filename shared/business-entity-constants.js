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

  var DPA_VERSION = '2026-07-v2';
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

  // DO NOT EDIT without counsel approval.
  // Source: Phase 2 spec §4.1 D8 SSN-prohibition + §6.3 MA WISP-avoidance posture.
  // Renders on every compliance document upload entry point to keep Mast out of
  // MA 201 CMR 17 WISP scope (attaches the moment Mast stores a MA resident
  // SSN/DL/financial account number). Counsel marker #2 (CT SB 1295 incidental
  // exposure) is unresolved — if CT threshold attaches, guidance may need to
  // become technical enforcement.
  var DOCUMENT_UPLOAD_SSN_WARNING = {
    headline: '\uD83D\uDEE1\uFE0F Do not upload documents containing Social Security Numbers.',
    body: 'Mast does not need SSN. For W-9 forms, redact the SSN before uploading. For photo ID (driver\u2019s license), only upload if the state ID serves as a compliance requirement; otherwise, skip.'
  };

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

  // Revenue channel categories for wizard step 2 — how the maker generates revenue today.
  // Distinct from DECLARED_CHANNELS (which tracks platform integrations in Settings).
  var REVENUE_CHANNELS = [
    { value: 'bm-own',        label: 'Brick & mortar store I own' },
    { value: 'bm-wholesale',  label: 'Wholesale / consignment into stores' },
    { value: 'online-own',    label: 'Online storefront I own',              promptUrl: true },
    { value: 'online-market', label: 'Online marketplace (Etsy, Amazon, Faire…)' },
    { value: 'commissions',   label: 'Commissions' },
    { value: 'events',        label: 'In-person events / pop-ups' },
    { value: 'live-events',   label: 'Online live events (IG Live, etc.)' },
    { value: 'other',         label: 'Other',                                promptText: true }
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
      value: 'storefront',
      title: 'Build a Mast storefront',
      body: 'Launch your public Mast website. Channel sync with Etsy, Shopify, and Square is always available alongside it.',
      defaultSurface: 'hybrid'
    },
    {
      value: 'sync-channels',
      title: 'Channel hub \u2014 no Mast website',
      body: 'Manage Etsy, Shopify, Square, and more from one place. I\u2019ll stay on my existing site \u2014 I don\u2019t need a Mast storefront.',
      defaultSurface: 'ui-first'
    },
    {
      value: 'back-office',
      title: 'Back-office only \u2014 no website',
      body: 'POS, customers, orders, inventory \u2014 no online storefront.',
      defaultSurface: 'ai-first'
    }
  ];

  var SURFACE_OPTIONS = [
    { value: 'ui-first', label: 'Click & menus',  hint: 'I prefer clicking through screens to get things done.' },
    { value: 'ai-first', label: 'Chat with AI',   hint: 'I’d rather tell an assistant what I need.' },
    { value: 'hybrid',   label: 'Mix of both',    hint: 'Menus when I want them, AI when I don’t.' }
  ];

  // New wizard constants — additive only, do not remove or rename existing constants above.

  var BUSINESS_TYPES = [
    { value: 'produce', label: 'I make or transform it',    description: 'Crafting, assembling, or adding value to raw materials or components' },
    { value: 'resell',  label: 'I source and resell',       description: 'Buying finished goods to resell, wholesale, or distribute' },
    { value: 'teach',   label: 'I teach or offer services', description: 'Classes, workshops, commissions, or custom services' },
    { value: 'mixed',   label: 'A mix',                     description: 'More than one — tell us what drives most of your revenue' }
  ];

  // Two-tier business classification used in wizard Step 2.
  // Each category has a derived businessType (produce/resell/teach) and a list of subtypes.
  var BUSINESS_CATEGORIES = [
    {
      value: 'makers', label: 'Makers & Crafts',
      description: 'Handmade and artisan goods',
      businessType: 'produce',
      subtypes: [
        { value: 'glass-artisan',      label: 'Glass artisan' },
        { value: 'ceramics-pottery',   label: 'Ceramics & pottery' },
        { value: 'jewelry-maker',      label: 'Jewelry maker' },
        { value: 'fiber-textile',      label: 'Fiber & textile' },
        { value: 'woodworker',         label: 'Woodworker' },
        { value: 'painter-printmaker', label: 'Painter / printmaker' },
        { value: 'leather-metal',      label: 'Leather & metalwork' },
        { value: 'mixed-media-artist', label: 'Mixed-media / sculpture' },
        { value: 'other-maker',        label: 'Other maker' }
      ]
    },
    {
      value: 'food-bev', label: 'Food & Beverage',
      description: 'Food producers, bakers, caterers',
      businessType: 'produce',
      subtypes: [
        { value: 'bakery',             label: 'Bakery / pastry' },
        { value: 'specialty-food',     label: 'Specialty food producer' },
        { value: 'beverage',           label: 'Coffee, tea & beverages' },
        { value: 'catering',           label: 'Caterer' },
        { value: 'food-market-vendor', label: 'Farmers market / pop-up vendor' },
        { value: 'other-food',         label: 'Other food & beverage' }
      ]
    },
    {
      value: 'health-beauty', label: 'Health & Beauty',
      description: 'Salons, spas, fitness, wellness',
      businessType: 'teach',
      subtypes: [
        { value: 'hair-salon',          label: 'Hair salon' },
        { value: 'nail-salon',          label: 'Nail salon' },
        { value: 'spa-massage',         label: 'Spa / massage' },
        { value: 'fitness-studio',      label: 'Yoga / fitness studio' },
        { value: 'personal-trainer',    label: 'Personal trainer / coach' },
        { value: 'esthetician',         label: 'Esthetician / skincare' },
        { value: 'other-health-beauty', label: 'Other health & beauty' }
      ]
    },
    {
      value: 'services', label: 'Services & Instruction',
      description: 'Classes, coaching, commissions, custom work',
      businessType: 'teach',
      subtypes: [
        { value: 'instructor-studio',     label: 'Art / craft instructor' },
        { value: 'music-teacher',         label: 'Music teacher' },
        { value: 'fitness-instructor',    label: 'Fitness / yoga instructor' },
        { value: 'commissioned-services', label: 'Commissioned / custom work' },
        { value: 'photographer',          label: 'Photographer' },
        { value: 'graphic-designer',      label: 'Graphic designer / illustrator' },
        { value: 'other-service',         label: 'Other service' }
      ]
    },
    {
      value: 'retail', label: 'Retail & Resale',
      description: 'Shops, boutiques, vintage, wholesale',
      businessType: 'resell',
      subtypes: [
        { value: 'boutique',              label: 'Boutique / specialty shop' },
        { value: 'vintage-antiques',      label: 'Vintage / antiques' },
        { value: 'gift-shop',             label: 'Gift shop' },
        { value: 'wholesale-distributor', label: 'Wholesale distributor' },
        { value: 'online-retailer',       label: 'Online-only retailer' },
        { value: 'other-retail',          label: 'Other retail' }
      ]
    },
    {
      value: 'hospitality', label: 'Hospitality & Events',
      description: 'Venues, experiences, event planning',
      businessType: 'teach',
      subtypes: [
        { value: 'event-venue',       label: 'Event venue' },
        { value: 'bed-breakfast',     label: 'Bed & breakfast / inn' },
        { value: 'tour-experience',   label: 'Tour / experience operator' },
        { value: 'event-planner',     label: 'Event / party planner' },
        { value: 'popup-experience',  label: 'Pop-up experience' },
        { value: 'other-hospitality', label: 'Other hospitality' }
      ]
    }
  ];

  // Primary outputs — only values that add config signal beyond what businessType already captures.
  // 'classes' and 'services' are derived from businessType='teach'; removed to avoid redundancy.
  var PRIMARY_OUTPUTS = [
    { value: 'physical', label: 'Physical products' },
    { value: 'digital',  label: 'Digital downloads' },
    { value: 'events',   label: 'Event tickets' }
  ];

  var CURRENT_TOOLS = [
    { value: 'square',       label: 'Square',       category: 'payment',   description: 'Payment processing & POS' },
    { value: 'stripe',       label: 'Stripe',       category: 'payment',   description: 'Online payment processing' },
    { value: 'shopify',      label: 'Shopify',      category: 'ecommerce', description: 'Online storefront' },
    { value: 'etsy',         label: 'Etsy',         category: 'ecommerce', description: 'Marketplace storefront' },
    { value: 'pirateship',   label: 'Pirate Ship',  category: 'shipping',  description: 'Discounted shipping labels' },
    { value: 'shippo',       label: 'Shippo',       category: 'shipping',  description: 'Multi-carrier shipping' },
    { value: 'shipstation',  label: 'ShipStation',  category: 'shipping',  description: 'Shipping management & automation' },
    { value: 'easypost',     label: 'EasyPost',     category: 'shipping',  description: 'Multi-carrier label printing' },
    { value: 'stamps',       label: 'Stamps.com',   category: 'shipping',  description: 'USPS & UPS labels' }
  ];

  var FEATURE_MODE_OPTIONS = [
    { value: 'full-storefront', label: 'Full Mast storefront',    description: 'Shop, blog, all customer pages' },
    { value: 'features-only',   label: 'Select Mast features',    description: 'Specific pages without the shop' },
    { value: 'none',            label: 'Back-office only',         description: 'No public Mast pages' }
  ];

  var FEATURE_PAGE_OPTIONS = [
    { value: 'surveys',      label: 'Customer surveys',    description: 'Send post-purchase survey links via email' },
    { value: 'gift-cards',   label: 'Gift cards',          description: 'Sell and redeem gift cards online' },
    { value: 'loyalty',      label: 'Loyalty & wallet',    description: 'Points, store credit, passes' },
    { value: 'booking',      label: 'Class booking',       description: 'Online class registration and schedules' },
    { value: 'commissions',  label: 'Commission requests', description: 'Public commission request form' }
  ];

  // ============================================================
  // Mast Modes — visibility-default architecture (Idea -OtADygKA_JhRmk1wUqN)
  // ============================================================
  //
  // Modes are SIMPLIFICATION DEFAULTS, not entitlement gates. Every tenant is
  // entitled to every route; modes only decide what's visible-by-default on
  // day one. Soft-hidden items live behind a "+ add" affordance.
  //
  // Working artifact: ~/Downloads/sessions/mast-modes-2026-05-21/matrix-v2.md
  // Derivation is over EXISTING wizard fields — no wizard rebuild needed.

  // Peer modes (multi-select; tenant's modeSet is the union of these flags).
  var MODE_ENUM = ['standard', 'retail', 'bookings', 'maker'];

  // Overlay flags (additive on top of any peer mode).
  var OVERLAY_ENUM = ['event'];

  // Versioned mapping — bump when canonical matrix changes, then tenants get
  // a non-blocking migration prompt to review new recommended modules.
  var MODE_VERSION = 1;

  // Highest-weight-first ordering for mode-aware label resolution (M4).
  var MODE_WEIGHT_ORDER = ['maker', 'bookings', 'retail', 'standard'];

  /**
   * Derive a tenant's mode-set from existing wizard fields.
   *
   * Pure function — no Firebase, no I/O. Safe to call from wizardComplete,
   * Settings re-classification flow, and backfill script alike.
   *
   * @param {Object} entity - shape of admin/businessEntity (subset is fine):
   *   { category: string,
   *     revenueChannels: string[],            // ordered, [0] = primary
   *     engagement: { mode: string, modulesShown: string[] } }
   * @param {Object} [opts] - { derivedFrom: 'wizard'|'settings'|'backfill' }
   * @returns {Object} {
   *   modes: string[],          // subset of MODE_ENUM
   *   overlays: string[],       // subset of OVERLAY_ENUM
   *   cohortFlag: boolean,      // bookings sub-flag (classes/cohorts present)
   *   modeVersion: number,      // MODE_VERSION at derivation time
   *   derivedAt: string,        // ISO timestamp
   *   derivedFrom: string       // provenance
   * }
   *
   * Empty / malformed inputs => { modes: ['standard'], ... }. Never throws.
   */
  function deriveModeSet(entity, opts) {
    opts = opts || {};
    entity = entity || {};
    var category = entity.category || null;
    var channels = Array.isArray(entity.revenueChannels) ? entity.revenueChannels : [];
    var primary = channels[0] || null;
    var engagement = entity.engagement || {};
    var modulesShown = Array.isArray(engagement.modulesShown) ? engagement.modulesShown : [];
    var engagementMode = engagement.mode || null;

    var modes = Object.create(null);
    var overlays = Object.create(null);
    var cohortFlag = false;

    // --- MAKER detection (producer categories + producer-ish channels) ---
    if (category === 'makers') {
      modes.maker = true;
    }
    if ((category === 'food-bev' || category === 'health-beauty') &&
        modulesShown.indexOf('products') !== -1) {
      // Bimodal categories — only Maker if they declared a products module.
      modes.maker = true;
    }
    if (channels.indexOf('bm-wholesale') !== -1 || channels.indexOf('commissions') !== -1) {
      modes.maker = true;
    }

    // --- RETAIL detection ---
    if (category === 'retail' && !modes.maker) {
      // Categories are exclusive — if user picked 'retail' they're not 'makers'.
      modes.retail = true;
    }
    if (primary === 'bm-own') {
      // Physical brick-and-mortar is a strong retail signal even for makers
      // (a maker with a storefront sees both maker + retail defaults).
      modes.retail = true;
    }
    if (engagementMode === 'storefront' && modulesShown.indexOf('sales') !== -1 &&
        !modes.maker && category !== 'services' && category !== 'hospitality') {
      // Weak retail signal — only fires when no stronger maker/bookings signal exists.
      modes.retail = true;
    }

    // --- BOOKINGS detection ---
    if (category === 'services') {
      modes.bookings = true;
    }
    if (category === 'hospitality') {
      // Ticketed events + venue rental fit the bookings shape.
      modes.bookings = true;
    }
    if (modulesShown.indexOf('classes') !== -1) {
      modes.bookings = true;
      cohortFlag = true;     // unlocks Students + Instructors per matrix v2
    }

    // --- EVENT overlay ---
    if (channels.indexOf('events') !== -1 || channels.indexOf('live-events') !== -1) {
      overlays.event = true;
    }
    if (modulesShown.indexOf('events') !== -1) {
      overlays.event = true;
    }

    // --- Fallback ---
    var modeList = Object.keys(modes);
    if (modeList.length === 0) {
      modeList = ['standard'];
    } else {
      // Stable order matching MODE_ENUM for deterministic modeSet_hash downstream.
      modeList = MODE_ENUM.filter(function(m) { return modes[m]; });
    }

    return {
      modes: modeList,
      overlays: Object.keys(overlays),
      cohortFlag: cohortFlag,
      engagementMode: engagementMode,
      modeVersion: MODE_VERSION,
      derivedAt: new Date().toISOString(),
      derivedFrom: opts.derivedFrom || 'wizard'
    };
  }

  /**
   * Self-tests for deriveModeSet. Idempotent; safe to call from dev console.
   * Returns { passed, failed, failures }. Logs to console.
   *
   * Run from a tenant admin console:
   *   BusinessEntityConstants._runDerivationSelfTests()
   */
  function _runDerivationSelfTests() {
    var cases = [
      // Worked examples from matrix-v2.md
      {
        name: 'Bakery selling at farmers markets',
        entity: { category: 'food-bev', revenueChannels: ['bm-own', 'events'],
                  engagement: { modulesShown: ['products', 'sales'] } },
        expect: { modes: ['retail', 'maker'], overlays: ['event'], cohortFlag: false }
      },
      {
        name: 'Bike shop with storefront',
        entity: { category: 'retail', revenueChannels: ['bm-own'],
                  engagement: { mode: 'storefront', modulesShown: ['sales'] } },
        expect: { modes: ['retail'], overlays: [], cohortFlag: false }
      },
      {
        name: 'Yoga studio',
        entity: { category: 'services',
                  engagement: { modulesShown: ['classes', 'sales'] } },
        expect: { modes: ['bookings'], overlays: [], cohortFlag: true }
      },
      {
        name: 'Solo consultant',
        entity: { category: 'services' },
        expect: { modes: ['bookings'], overlays: [], cohortFlag: false }
      },
      {
        name: 'Wholesale-only candle maker',
        entity: { category: 'makers', revenueChannels: ['bm-wholesale'] },
        expect: { modes: ['maker'], overlays: [], cohortFlag: false }
      },
      {
        name: 'Event venue',
        entity: { category: 'hospitality', revenueChannels: ['events'] },
        expect: { modes: ['bookings'], overlays: ['event'], cohortFlag: false }
      },
      {
        name: 'Marketplace Etsy seller',
        entity: { category: 'makers', revenueChannels: ['online-market'] },
        expect: { modes: ['maker'], overlays: [], cohortFlag: false }
      },
      {
        name: 'Coffee subscription box (food-bev with products)',
        entity: { category: 'food-bev',
                  engagement: { modulesShown: ['products', 'sales'] } },
        expect: { modes: ['maker'], overlays: [], cohortFlag: false }
      },
      {
        name: 'Empty entity falls back to standard',
        entity: {},
        expect: { modes: ['standard'], overlays: [], cohortFlag: false }
      },
      {
        name: 'Null entity falls back to standard (never throws)',
        entity: null,
        expect: { modes: ['standard'], overlays: [], cohortFlag: false }
      },
      {
        name: 'Hospitality with classes adds cohort flag',
        entity: { category: 'hospitality',
                  engagement: { modulesShown: ['classes'] } },
        expect: { modes: ['bookings'], overlays: [], cohortFlag: true }
      },
      {
        name: 'Maker with classes is multi-mode (maker + bookings cohort)',
        entity: { category: 'makers',
                  engagement: { modulesShown: ['classes'] } },
        expect: { modes: ['bookings', 'maker'], overlays: [], cohortFlag: true }
      },
      {
        name: 'health-beauty without products module is bookings (salon/spa)',
        entity: { category: 'health-beauty',
                  engagement: { modulesShown: ['sales'] } },
        expect: { modes: ['standard'], overlays: [], cohortFlag: false }
      },
      {
        name: 'health-beauty WITH products module is maker (skincare brand)',
        entity: { category: 'health-beauty',
                  engagement: { modulesShown: ['products', 'sales'] } },
        expect: { modes: ['maker'], overlays: [], cohortFlag: false }
      },
      {
        name: 'Commissions channel adds maker',
        entity: { category: 'services', revenueChannels: ['commissions'] },
        expect: { modes: ['bookings', 'maker'], overlays: [], cohortFlag: false }
      }
    ];

    var passed = 0, failed = 0, failures = [];
    cases.forEach(function(tc) {
      var result = deriveModeSet(tc.entity);
      var expectedModes = tc.expect.modes.slice().sort().join(',');
      var actualModes = result.modes.slice().sort().join(',');
      var expectedOverlays = tc.expect.overlays.slice().sort().join(',');
      var actualOverlays = result.overlays.slice().sort().join(',');
      var ok = expectedModes === actualModes &&
               expectedOverlays === actualOverlays &&
               result.cohortFlag === tc.expect.cohortFlag;
      if (ok) {
        passed++;
      } else {
        failed++;
        failures.push({
          name: tc.name,
          expected: { modes: expectedModes, overlays: expectedOverlays, cohortFlag: tc.expect.cohortFlag },
          actual: { modes: actualModes, overlays: actualOverlays, cohortFlag: result.cohortFlag }
        });
      }
    });

    if (failed === 0) {
      console.log('[deriveModeSet] All ' + passed + ' self-tests passed.');
    } else {
      console.warn('[deriveModeSet] ' + failed + ' of ' + cases.length + ' tests FAILED:');
      failures.forEach(function(f) {
        console.warn('  ✗ ' + f.name);
        console.warn('    expected:', f.expected);
        console.warn('    actual:  ', f.actual);
      });
    }
    return { passed: passed, failed: failed, failures: failures };
  }

  // ============================================================
  // Mast Modes — route visibility matrix (M2 of Idea -OtADygKA_JhRmk1wUqN)
  // ============================================================
  //
  // Source of truth for "which sidebar routes are VISIBLE BY DEFAULT for a
  // given mode-set." Mirrors matrix-v2.md adapted to the actual sidebar
  // data-route values in app/index.html. Routes not listed below are
  // SOFT-HIDDEN in all modes (always reachable via Add-to-Mast page in M3).
  //
  // Per the visibility-not-entitlement RULE: tenants are entitled to every
  // route; this matrix only decides what's visible on day one. Soft-hidden
  // routes appear when the user reveals them via the sidebar expand toggle
  // or enables them on the Add-to-Mast page (M3).
  //
  // Entry shapes:
  //   { anchor: true }                         — never hideable (recovery floor); only add-to-mast
  //   { alwaysOn: true }                       — default-ON in every mode, but REMOVABLE by the user
  //   { modes: ['maker', ...] }                — visible if any listed mode active
  //   { overlays: ['event', ...] }             — visible if any listed overlay active
  //   { modes: [...], cohortRequired: true }   — also requires cohortFlag=true
  //   {}                                        — soft-hidden in all modes
  var MODE_ROUTE_VISIBILITY = {
    // === Default-ON tier (formerly "always on"). Visible in every mode for a
    // sensible day-one sidebar, but now USER-REMOVABLE — hiding any of these is
    // the owner's choice (see the recovery anchor 'add-to-mast' below). ===
    'receipts':           { alwaysOn: true },
    'terms':              { alwaysOn: true },
    'website':            { alwaysOn: true },
    'brand':              { alwaysOn: true },
    'images':             { alwaysOn: true },
    'finance-revenue':    { alwaysOn: true },
    'finance-expenses':   { alwaysOn: true },
    'finance-tax':        { alwaysOn: true },
    'contacts':           { alwaysOn: true },
    'customers':          { alwaysOn: true },
    'team':               { alwaysOn: true },
    'settings':           { alwaysOn: true },

    // === Unlock surface — the RECOVERY ANCHOR (the one route that can never
    // be hidden). 'anchor: true' means: always visible AND not user-hideable,
    // so an owner can never lock themselves out of the module manager. This is
    // the ONLY anchor — every other route (including the former always-on tier:
    // Settings, Revenue, Day Close, Policies…) is now removable by user choice.
    // (alwaysOn here only preserves default-on visibility; anchor does the lock.)
    'add-to-mast':        { alwaysOn: true, anchor: true },

    // === Migration section — system-managed, conditionally shown ===
    // The sidebar Migration section has display:none unless an active
    // migration exists; sub-routes are alwaysOn here so the modes filter
    // doesn't soft-hide them when the migration UI is active. They're
    // excluded from Add-to-Mast (system-managed, not user-toggleable).
    'migration':           { alwaysOn: true, systemManaged: true },
    'migration-confirm':   { alwaysOn: true, systemManaged: true },
    'migration-plan':      { alwaysOn: true, systemManaged: true },
    'migration-import':    { alwaysOn: true, systemManaged: true },
    'historical-orders':   { alwaysOn: true, systemManaged: true },

    // === Catalog / Products section ===
    // develop-products: the Develop/Catalog lens split was merged into the
    // single Products surface (2026-05-22, Two-View Architecture). The route id
    // survives as an alias (→ products) and drives the std↔maker transition
    // diff, but it has no sidebar item and is not user-toggleable — systemManaged
    // keeps it off the Add-to-Mast manager (and out of the module-info lint).
    'develop-products':   { modes: ['maker'], systemManaged: true },
    'materials':          { modes: ['maker'] },
    'jobs':               { modes: ['maker'] },
    'procurement':        { modes: ['maker', 'retail'] },
    'products':           { modes: ['maker', 'retail'] },
    // RETIRED (2026-06-06) as standalone surfaces — their data is now folded into
    // the Products list facets + product detail tabs. Kept as systemManaged alias
    // routes (redirect → products in navigateTo): excluded from Add-to-Mast and
    // the sidebar, but bookmarked links still resolve.
    'forecast':           { systemManaged: true },
    'inventory':          { systemManaged: true },
    'sales-by-product':   { systemManaged: true },

    // === Sales section ===
    'pos':                { modes: ['standard', 'retail', 'bookings', 'maker'], overlays: ['event'] },
    'orders':             { modes: ['standard', 'retail', 'maker'] },
    'commissions':        { modes: ['bookings', 'maker'] },  // "Custom Orders" in matrix
    'rma':                { modes: ['retail', 'maker'] },    // "Returns" in matrix
    'wholesale':          { modes: ['maker'] },
    'galleries':          { modes: ['maker'] },
    'lookbooks':          { modes: ['maker'] },
    'pack':               { modes: ['retail', 'maker'], overlays: ['event'] },
    'ship':               { modes: ['retail', 'maker'], overlays: ['event'] },

    // === Marketing section ===
    // W2 marketing aggregators (calendar/composer/inbox/campaigns). Previously
    // absent from the matrix, so they defaulted to soft-hidden (unknown → false)
    // and were only reachable via "Show all modules". Registered here with the
    // broad social-tier visibility so they're visible by default in every mode
    // and now user-curatable on Add-to-Mast.
    'marketing-calendar': { modes: ['standard', 'retail', 'bookings', 'maker'] },
    'composer':           { modes: ['standard', 'retail', 'bookings', 'maker'] },
    'engagement-inbox':   { modes: ['standard', 'retail', 'bookings', 'maker'] },
    'campaigns':          { modes: ['standard', 'retail', 'bookings', 'maker'] },
    'social':             { modes: ['standard', 'retail', 'bookings', 'maker'] },
    'blog':               {},  // soft-hidden in all modes per matrix
    'newsletter':         { modes: ['retail', 'bookings', 'maker'], overlays: ['event'] },
    'stories':            {},  // soft-hidden in all modes per matrix
    'homepage':           { modes: ['retail', 'maker'], overlays: ['event'] },  // "Page Builder"

    // === Retention section (not in matrix-v2.md; conservative defaults) ===
    // engagementHidden: hide entirely when Mast is secondary to an external
    // primary site (sync-channels / back-office). These features require
    // write-back into the primary checkout (Shopify Discounts API, Gift Card
    // API, Functions, etc.) which is per-platform research. Re-enabled
    // per-feature per-platform once the Secondary-Mode Viability Matrix lands.
    'wallet':             { modes: ['bookings', 'retail'],           engagementHidden: ['sync-channels', 'back-office'] },
    'gift-cards':         { modes: ['retail', 'bookings'],           engagementHidden: ['sync-channels', 'back-office'] },
    'coupons':            { modes: ['retail', 'bookings', 'maker'],  engagementHidden: ['sync-channels', 'back-office'] },
    'loyalty':            { modes: ['retail', 'bookings'],           engagementHidden: ['sync-channels', 'back-office'] },
    'membership':         { modes: ['bookings'],                     engagementHidden: ['sync-channels', 'back-office'] },
    'promotions':         { modes: ['retail', 'maker'],              engagementHidden: ['sync-channels', 'back-office'] },

    // === Events section (vendor-side Shows flow) — gated entirely by event overlay ===
    'show-find':          { overlays: ['event'] },
    'show-apply':         { overlays: ['event'] },
    'show-prep':          { overlays: ['event'] },
    'show-execute':       { overlays: ['event'] },
    'show-history':       { overlays: ['event'] },
    'events-shows':       { overlays: ['event'] },
    'events-settings':    { overlays: ['event'] },

    // === Classes section (bookings + cohort sub-flag) ===
    'book':               { modes: ['bookings'] },
    'calendar':           { modes: ['bookings'] },
    'enrollments':        { modes: ['bookings'], cohortRequired: true },
    'passes':             { modes: ['bookings'], cohortRequired: true },
    'resources':          { modes: ['bookings'] },
    'students':           { modes: ['bookings'], cohortRequired: true },
    'instructors':        { modes: ['bookings'], cohortRequired: true },
    'book-reports':       { modes: ['bookings'] },

    // === Finance section beyond always-on tier ===
    // financials: the W2.1 Finance "Overview" dashboard. Previously absent from
    // the matrix (soft-hidden by default); registered with the finance-section
    // tier so it's visible by default for selling modes and user-curatable.
    'financials':         { modes: ['maker', 'retail', 'bookings'] },
    'finance-pl':         { modes: ['maker', 'retail', 'bookings'] },
    'finance-cash-flow':  { modes: ['maker', 'retail', 'bookings'] },
    'finance-ar':         { modes: ['maker'] },
    'finance-ap':         { modes: ['maker'] },
    'finance-reports':    { modes: ['maker', 'retail', 'bookings'] },
    'customer-portfolio': { modes: ['maker', 'retail', 'bookings'] },

    // === Operations section beyond always-on tier ===
    'trips':              { modes: ['maker', 'retail'], overlays: ['event'] },
    'reports':            { modes: ['maker', 'retail', 'bookings'] },
    'advisor':            {},  // Business Plan — soft-hidden by default
    'studio':             { modes: ['maker'] },
    'business':           { alwaysOn: true },  // entity setup — bookkeeping always available
    'channels':           { modes: ['maker', 'retail'] },
    'mapping':            { modes: ['maker', 'retail'] },  // Channel Mapping — sibling of channels; same visibility
    'audit':              { modes: ['maker', 'retail'] },  // Channel Audit — channel-consistency checks; sibling of channels/mapping

    // === Customer Service section (conservative) ===
    'cs-inbox':           { modes: ['retail', 'bookings', 'maker'] },
    'cs-tickets':         { modes: ['retail', 'bookings', 'maker'] },
    'cs-surveys':         { modes: ['retail', 'bookings', 'maker'] },
    'cs-reviews':         { modes: ['retail', 'bookings', 'maker'] },
    'cs-faqs':            {},  // long-tail
    'cs-members':         { modes: ['bookings'] },

    // === Admin section — operational, all always-on ===
    'employees':          { alwaysOn: true },
    'analytics':          { alwaysOn: true },
    'auditlog':           { alwaysOn: true },
    'subscription':       { alwaysOn: true },  // SaaS billing, not "subscription billing" in matrix
    'about':              { alwaysOn: true },
    'email-log':          { alwaysOn: true }
  };

  // ============================================================
  // Module dependency map — "route X needs route Y to be useful."
  // ============================================================
  // Now that every module is user-hideable, hiding a module that others rely
  // on (e.g. hiding Channels while Channel Mapping is shown) leaves the
  // dependents in the sidebar with no data behind them. This map powers a
  // non-blocking advisory when that happens. It does NOT block hiding — the
  // owner's choice always wins; we just name what they may want to keep.
  //
  // Seeded from the human-readable `prerequisites` ("X module enabled") already
  // declared per module in app/data/mode-module-info.js, formalized to route
  // ids. Keep this in sync when prerequisites change. Shape: route -> [requiredRouteId, ...].
  var MODULE_DEPENDENCIES = {
    'develop-products':  ['products'],
    'jobs':              ['products'],
    'procurement':       ['materials'],
    'pos':               ['products'],
    'orders':            ['products'],
    'commissions':       ['products'],
    'rma':               ['orders'],
    'wholesale':         ['products'],
    'galleries':         ['products'],
    'lookbooks':         ['products'],
    'pack':              ['orders'],
    'channels':          ['products'],
    'mapping':           ['channels'],
    'audit':             ['channels'],
    'wallet':            ['customers'],
    'loyalty':           ['customers'],
    'promotions':        ['products'],
    'customer-portfolio':['customers'],
    'cs-surveys':        ['customers'],
    'cs-reviews':        ['products'],
    'show-execute':      ['show-prep', 'products'],
    'calendar':          ['classes'],
    'enrollments':       ['classes'],
    'passes':            ['classes'],
    'resources':         ['classes'],
    'students':          ['classes'],
    'instructors':       ['classes'],
    'book-reports':      ['classes']
  };

  // What does this route require to be useful? -> [routeId, ...]
  function requiresOf(routeId) {
    var reqs = MODULE_DEPENDENCIES[routeId];
    return Array.isArray(reqs) ? reqs.slice() : [];
  }

  // Which routes depend on this one? (inverse map) -> [routeId, ...]
  function dependentsOf(routeId) {
    var out = [];
    for (var r in MODULE_DEPENDENCIES) {
      if (!Object.prototype.hasOwnProperty.call(MODULE_DEPENDENCIES, r)) continue;
      if (MODULE_DEPENDENCIES[r].indexOf(routeId) !== -1) out.push(r);
    }
    return out;
  }

  // Self-tests for the dependency map. Returns { passed, failed, failures }.
  function _runDependencySelfTests() {
    var failures = [];
    function eq(name, a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) failures.push({ name: name, expected: b, actual: a }); }
    // The canonical example: Channel Mapping needs Channels.
    eq('mapping requires channels', requiresOf('mapping'), ['channels']);
    eq('channels is depended on by mapping + audit', dependentsOf('channels'), ['mapping', 'audit']);
    // products is a hub — many dependents, list is non-empty and includes pos.
    var prodDeps = dependentsOf('products');
    if (prodDeps.indexOf('pos') === -1) failures.push({ name: 'products dependents include pos', expected: 'includes pos', actual: prodDeps });
    // unknown route → empty both ways
    eq('unknown route requires nothing', requiresOf('nonexistent'), []);
    eq('unknown route has no dependents', dependentsOf('nonexistent'), []);
    // No self-referential edge.
    for (var r in MODULE_DEPENDENCIES) {
      if (MODULE_DEPENDENCIES[r].indexOf(r) !== -1) failures.push({ name: 'no self-dependency: ' + r, expected: 'no ' + r, actual: 'self' });
    }
    return { passed: (6 - failures.length) + Object.keys(MODULE_DEPENDENCIES).length, failed: failures.length, failures: failures };
  }

  /**
   * Decide whether a single sidebar route is visible by default for a tenant.
   * Pure function. Per-tenant manual enables (modeOverrides) are merged by the
   * caller — this function returns the DEFAULT visibility only.
   *
   * Routes not in MODE_ROUTE_VISIBILITY are treated as soft-hidden (returns
   * false unless overridden) — safe default for routes added before the matrix
   * is updated.
   *
   * @param {string} routeId           - sidebar data-route value
   * @param {Object} modeSetDoc        - { modes: [], overlays: [], cohortFlag: bool }
   * @returns {boolean}
   */
  function isRouteVisibleByDefault(routeId, modeSetDoc) {
    var rule = MODE_ROUTE_VISIBILITY[routeId];
    if (!rule) return false;                            // unknown route → soft-hidden
    modeSetDoc = modeSetDoc || {};
    var modes = Array.isArray(modeSetDoc.modes) ? modeSetDoc.modes : [];
    var overlays = Array.isArray(modeSetDoc.overlays) ? modeSetDoc.overlays : [];
    var cohortFlag = !!modeSetDoc.cohortFlag;
    var engagementMode = modeSetDoc.engagementMode || null;

    // engagementHidden: routes that hide entirely under specific engagement
    // modes (e.g. retention features in secondary-site modes). Checked BEFORE
    // alwaysOn so the engagement axis can override the universal tier — a
    // tenant in sync-channels mode that can't write back to their primary
    // checkout shouldn't see a "Wallet" entry just because it's alwaysOn.
    if (engagementMode && Array.isArray(rule.engagementHidden) &&
        rule.engagementHidden.indexOf(engagementMode) !== -1) {
      return false;
    }

    if (rule.alwaysOn) return true;

    if (rule.cohortRequired && !cohortFlag) return false;

    if (rule.modes) {
      for (var i = 0; i < rule.modes.length; i++) {
        if (modes.indexOf(rule.modes[i]) !== -1) return true;
      }
    }
    if (rule.overlays) {
      for (var j = 0; j < rule.overlays.length; j++) {
        if (overlays.indexOf(rule.overlays[j]) !== -1) return true;
      }
    }
    return false;
  }

  /**
   * Resolved visibility for a route, including per-tenant manual overrides.
   * Only the anchor route (add-to-mast) is never hidden; every other route —
   * including the default-on tier — respects an explicit user-hide override.
   *
   * @param {string} routeId
   * @param {Object} modeSetDoc        - { modes, overlays, cohortFlag }
   * @param {Object} modeOverridesDoc  - { enabledRoutes: [], disabledRoutes: [] }
   *   enabledRoutes:  user-added overrides (force visible)
   *   disabledRoutes: user-hidden overrides (force hidden, except always-on)
   * @returns {boolean}
   */
  function isRouteVisible(routeId, modeSetDoc, modeOverridesDoc) {
    var rule = MODE_ROUTE_VISIBILITY[routeId];
    // engagementHidden short-circuits even alwaysOn — see isRouteVisibleByDefault.
    var engagementMode = modeSetDoc && modeSetDoc.engagementMode;
    if (rule && engagementMode && Array.isArray(rule.engagementHidden) &&
        rule.engagementHidden.indexOf(engagementMode) !== -1) {
      return false;
    }
    if (rule && rule.anchor) return true;       // anchor (add-to-mast) is never hideable; all else respects user override
    if (modeOverridesDoc) {
      if (Array.isArray(modeOverridesDoc.disabledRoutes) &&
          modeOverridesDoc.disabledRoutes.indexOf(routeId) !== -1) {
        return false;                            // explicit user-hide
      }
      if (Array.isArray(modeOverridesDoc.enabledRoutes) &&
          modeOverridesDoc.enabledRoutes.indexOf(routeId) !== -1) {
        return true;                             // explicit user-enable
      }
    }
    return isRouteVisibleByDefault(routeId, modeSetDoc);
  }

  /**
   * Compute the minimal modeOverrides doc after toggling a route's visibility.
   * Removes any pre-existing override for the route, then adds an enable/disable
   * entry only if the target state diverges from the mode-default. Keeps the
   * persisted overrides as small as possible (no redundant entries).
   *
   * The anchor route (add-to-mast) is a no-op — returns the overrides
   * unchanged. Every other route (incl. the default-on tier) is toggleable.
   *
   * @param {Object} overrides     - current { enabledRoutes: [], disabledRoutes: [] }
   * @param {string} routeId
   * @param {boolean} targetVisible - true to add, false to remove
   * @param {Object} modeSetDoc
   * @returns {Object} new { enabledRoutes: [], disabledRoutes: [] }
   */
  function setRouteVisibilityOverride(overrides, routeId, targetVisible, modeSetDoc) {
    overrides = overrides || {};
    var rule = MODE_ROUTE_VISIBILITY[routeId];
    if (rule && rule.anchor) {
      // No-op — the recovery anchor (add-to-mast) can't be toggled
      return {
        enabledRoutes: (overrides.enabledRoutes || []).slice(),
        disabledRoutes: (overrides.disabledRoutes || []).slice()
      };
    }
    var enabled = (overrides.enabledRoutes || []).filter(function(r) { return r !== routeId; });
    var disabled = (overrides.disabledRoutes || []).filter(function(r) { return r !== routeId; });
    var defaultVisible = isRouteVisibleByDefault(routeId, modeSetDoc);
    if (targetVisible && !defaultVisible) enabled.push(routeId);
    else if (!targetVisible && defaultVisible) disabled.push(routeId);
    // else: target matches default → no override needed (clean state)
    return { enabledRoutes: enabled, disabledRoutes: disabled };
  }

  // ============================================================
  // Mast Modes — mode-aware label overrides (M4 of Idea -OtADygKA_JhRmk1wUqN)
  // ============================================================
  //
  // Same underlying route module can render different visible labels per mode.
  // Source of truth for the matrix-v2.md "Naming overrides" table. Owner-facing
  // copy lives here so M2 (sidebar) + M3 (Add-to-Mast cards) + any future
  // call site (breadcrumbs, page titles) read from one place.
  //
  // Override entry shape:
  //   { default: 'Canonical Label',
  //     overrides: [ { match: fn(modeSetDoc) -> bool, label: 'Override Label' }, ... ] }
  //
  // First matching override wins. If none match, default is returned.
  // For multi-mode tenants where two modes "could" disagree, declare the
  // higher-weight match earlier (Maker > Bookings > Retail > Standard per
  // MODE_WEIGHT_ORDER). Composers/predicates can also call hasMode/etc. for
  // explicit weight resolution.

  var MODE_LABEL_OVERRIDES = {
    // "Custom Orders" → "Quotes" for service/booking shops that quote bespoke
    // work without producing it themselves. Makers keep "Custom Orders" because
    // the module's core flow (quote → accept → fulfill from materials) matches
    // commission-style production.
    'commissions': {
      default: 'Custom Orders',
      overrides: [
        {
          match: function(ms) {
            return _hasMode(ms, 'bookings') && !_hasMode(ms, 'maker');
          },
          label: 'Quotes'
        }
      ]
    },
    // Capacity route — forward-looking entry. When a capacity-management surface
    // is added it will render with this label-aware lookup automatically.
    'capacity': {
      default: 'Capacity',
      overrides: [
        {
          match: function(ms) { return _hasMode(ms, 'bookings') && _hasCohort(ms); },
          label: 'Class Size'
        },
        {
          match: function(ms) { return _hasMode(ms, 'bookings'); },
          label: 'Slots'
        }
      ]
    }
  };

  function _hasMode(modeSetDoc, modeName) {
    if (!modeSetDoc || !Array.isArray(modeSetDoc.modes)) return false;
    return modeSetDoc.modes.indexOf(modeName) !== -1;
  }
  function _hasCohort(modeSetDoc) {
    return !!(modeSetDoc && modeSetDoc.cohortFlag);
  }

  // Memoization for label resolution — keyed by (routeId + sorted modes +
  // sorted overlays + cohortFlag). Cleared automatically when modeSetDoc
  // identity changes (cache key embeds full state).
  var _labelCache = Object.create(null);
  function _labelCacheKey(routeId, modeSetDoc) {
    if (!modeSetDoc) return routeId + '|';
    var modes = Array.isArray(modeSetDoc.modes) ? modeSetDoc.modes.slice().sort().join(',') : '';
    var overlays = Array.isArray(modeSetDoc.overlays) ? modeSetDoc.overlays.slice().sort().join(',') : '';
    var cohort = modeSetDoc.cohortFlag ? '1' : '0';
    return routeId + '|' + modes + '|' + overlays + '|' + cohort;
  }

  /**
   * Resolve the visible label for a route given the tenant's mode-set.
   *
   * @param {string} routeId    - sidebar data-route value
   * @param {Object} modeSetDoc - { modes: [], overlays: [], cohortFlag: bool }
   * @param {string} [fallback] - label to return if no MODE_LABEL_OVERRIDES
   *                               entry exists (caller's default, usually the
   *                               sidebar's hardcoded text)
   * @returns {string} — override label, declared default, fallback, or routeId
   *
   * Pure function. Memoized — safe to call from hot render paths.
   */
  function labelFor(routeId, modeSetDoc, fallback) {
    var entry = MODE_LABEL_OVERRIDES[routeId];
    if (!entry) return fallback || routeId;

    var cacheKey = _labelCacheKey(routeId, modeSetDoc);
    if (cacheKey in _labelCache) return _labelCache[cacheKey];

    var resolved = entry.default || fallback || routeId;
    if (entry.overrides && modeSetDoc) {
      for (var i = 0; i < entry.overrides.length; i++) {
        var ov = entry.overrides[i];
        if (typeof ov.match === 'function' && ov.match(modeSetDoc)) {
          resolved = ov.label;
          break;
        }
      }
    }
    _labelCache[cacheKey] = resolved;
    return resolved;
  }

  // Clear the memo cache. Called when modeSet/overrides change (e.g., after
  // Settings re-derivation in M6 or "+ add" in M2/M3).
  function _clearLabelCache() {
    _labelCache = Object.create(null);
  }

  /**
   * Self-tests for labelFor. Returns { passed, failed, failures }.
   * Run from console:  BusinessEntityConstants._runLabelOverrideSelfTests()
   */
  function _runLabelOverrideSelfTests() {
    var ms = function(modes, overlays, cohortFlag) {
      return { modes: modes || [], overlays: overlays || [], cohortFlag: !!cohortFlag };
    };
    var cases = [
      // commissions → "Custom Orders" / "Quotes"
      { name: 'commissions default for maker',
        route: 'commissions', modeSet: ms(['maker']), expect: 'Custom Orders' },
      { name: 'commissions → Quotes for bookings-only',
        route: 'commissions', modeSet: ms(['bookings']), expect: 'Quotes' },
      { name: 'commissions stays Custom Orders for bookings+maker (maker wins)',
        route: 'commissions', modeSet: ms(['bookings', 'maker']), expect: 'Custom Orders' },
      { name: 'commissions default for standard',
        route: 'commissions', modeSet: ms(['standard']), expect: 'Custom Orders' },
      { name: 'commissions default for retail',
        route: 'commissions', modeSet: ms(['retail']), expect: 'Custom Orders' },

      // capacity → "Capacity" / "Slots" / "Class Size"
      { name: 'capacity default outside bookings',
        route: 'capacity', modeSet: ms(['maker']), expect: 'Capacity' },
      { name: 'capacity → Slots for bookings without cohort',
        route: 'capacity', modeSet: ms(['bookings'], [], false), expect: 'Slots' },
      { name: 'capacity → Class Size for bookings with cohort',
        route: 'capacity', modeSet: ms(['bookings'], [], true), expect: 'Class Size' },

      // routes with no override: returns fallback or routeId
      { name: 'unknown route returns fallback',
        route: 'pos', modeSet: ms(['retail']), fallback: 'Point of Sale', expect: 'Point of Sale' },
      { name: 'unknown route without fallback returns routeId',
        route: 'inventory', modeSet: ms(['maker']), expect: 'inventory' },

      // empty modeSet — falls to default
      { name: 'commissions with empty modeSet → default',
        route: 'commissions', modeSet: ms([]), expect: 'Custom Orders' },
      { name: 'null modeSet → default',
        route: 'commissions', modeSet: null, expect: 'Custom Orders' }
    ];

    var passed = 0, failed = 0, failures = [];
    cases.forEach(function(tc) {
      var actual = labelFor(tc.route, tc.modeSet, tc.fallback);
      if (actual === tc.expect) {
        passed++;
      } else {
        failed++;
        failures.push({ name: tc.name, expected: tc.expect, actual: actual });
      }
    });
    _clearLabelCache(); // don't pollute production cache after a test run

    if (failed === 0) {
      console.log('[mode-labels] All ' + passed + ' self-tests passed.');
    } else {
      console.warn('[mode-labels] ' + failed + ' of ' + cases.length + ' tests FAILED:');
      failures.forEach(function(f) {
        console.warn('  ✗ ' + f.name + ' — expected "' + f.expected + '", got "' + f.actual + '"');
      });
    }
    return { passed: passed, failed: failed, failures: failures };
  }

  /**
   * Self-tests for the visibility matrix. Returns { passed, failed, failures }.
   * Run from a tenant admin console:
   *   BusinessEntityConstants._runVisibilitySelfTests()
   */
  function _runVisibilitySelfTests() {
    var ms = function(modes, overlays, cohortFlag) {
      return { modes: modes || [], overlays: overlays || [], cohortFlag: !!cohortFlag };
    };
    var cases = [
      // Always-on tier survives empty modeSet
      { name: 'settings always visible (empty modeSet)', route: 'settings', modeSet: ms([]), expect: true },
      { name: 'receipts always visible (standard mode)', route: 'receipts', modeSet: ms(['standard']), expect: true },
      { name: 'team always visible (any mode)', route: 'team', modeSet: ms(['maker']), expect: true },

      // Maker-only routes
      { name: 'develop-products visible to maker', route: 'develop-products', modeSet: ms(['maker']), expect: true },
      { name: 'develop-products hidden from retail', route: 'develop-products', modeSet: ms(['retail']), expect: false },
      { name: 'wholesale visible to maker', route: 'wholesale', modeSet: ms(['maker']), expect: true },
      { name: 'wholesale hidden from standard', route: 'wholesale', modeSet: ms(['standard']), expect: false },

      // Multi-mode routes
      { name: 'inventory visible to retail', route: 'inventory', modeSet: ms(['retail']), expect: true },
      { name: 'inventory visible to maker', route: 'inventory', modeSet: ms(['maker']), expect: true },
      { name: 'inventory hidden from bookings', route: 'inventory', modeSet: ms(['bookings']), expect: false },
      { name: 'inventory visible via event overlay alone', route: 'inventory', modeSet: ms(['standard'], ['event']), expect: true },

      // Bookings + cohort gate
      { name: 'students visible only with cohort flag', route: 'students', modeSet: ms(['bookings'], [], true), expect: true },
      { name: 'students hidden without cohort flag', route: 'students', modeSet: ms(['bookings'], [], false), expect: false },
      { name: 'book visible to bookings without cohort', route: 'book', modeSet: ms(['bookings'], [], false), expect: true },

      // Event overlay
      { name: 'show-find requires event overlay', route: 'show-find', modeSet: ms(['maker']), expect: false },
      { name: 'show-find visible with event overlay', route: 'show-find', modeSet: ms(['maker'], ['event']), expect: true },

      // Soft-hidden in all modes
      { name: 'blog always soft-hidden', route: 'blog', modeSet: ms(['maker', 'retail', 'bookings']), expect: false },
      { name: 'stories always soft-hidden', route: 'stories', modeSet: ms(['maker', 'retail', 'bookings']), expect: false },

      // Standard mode is minimal
      { name: 'pos visible to standard', route: 'pos', modeSet: ms(['standard']), expect: true },
      { name: 'orders visible to standard', route: 'orders', modeSet: ms(['standard']), expect: true },
      { name: 'pack hidden from standard', route: 'pack', modeSet: ms(['standard']), expect: false },

      // Unknown route → soft-hidden
      { name: 'unknown route soft-hidden', route: 'nonexistent-route', modeSet: ms(['maker']), expect: false },

      // Override mechanism — enabledRoutes
      { name: 'override forces visible', route: 'blog', modeSet: ms(['standard']),
        overrides: { enabledRoutes: ['blog'] }, expect: true, useResolved: true },
      { name: 'no override keeps default', route: 'blog', modeSet: ms(['standard']),
        overrides: { enabledRoutes: ['stories'] }, expect: false, useResolved: true },

      // Override mechanism — disabledRoutes (force hide)
      { name: 'disabledRoutes forces hidden for default-visible route',
        route: 'pos', modeSet: ms(['retail']),
        overrides: { disabledRoutes: ['pos'] }, expect: false, useResolved: true },
      // NEW contract: the default-on tier is now user-hideable; only the
      // recovery anchor (add-to-mast) ignores a user-hide override.
      { name: 'default-on route IS now user-hideable (settings)',
        route: 'settings', modeSet: ms(['retail']),
        overrides: { disabledRoutes: ['settings'] }, expect: false, useResolved: true },
      { name: 'anchor (add-to-mast) ignores user-hide override',
        route: 'add-to-mast', modeSet: ms(['retail']),
        overrides: { disabledRoutes: ['add-to-mast'] }, expect: true, useResolved: true },
      { name: 'enabled wins over default-hidden when both lists touch different routes',
        route: 'blog', modeSet: ms(['standard']),
        overrides: { enabledRoutes: ['blog'], disabledRoutes: ['pos'] }, expect: true, useResolved: true },
      { name: 'disabled wins when same route appears in both (defensive)',
        route: 'pos', modeSet: ms(['retail']),
        overrides: { enabledRoutes: ['pos'], disabledRoutes: ['pos'] }, expect: false, useResolved: true }
    ];

    var passed = 0, failed = 0, failures = [];
    cases.forEach(function(tc) {
      var actual = tc.useResolved
        ? isRouteVisible(tc.route, tc.modeSet, tc.overrides)
        : isRouteVisibleByDefault(tc.route, tc.modeSet);
      if (actual === tc.expect) {
        passed++;
      } else {
        failed++;
        failures.push({ name: tc.name, expected: tc.expect, actual: actual });
      }
    });

    if (failed === 0) {
      console.log('[mode-visibility] All ' + passed + ' self-tests passed.');
    } else {
      console.warn('[mode-visibility] ' + failed + ' of ' + cases.length + ' tests FAILED:');
      failures.forEach(function(f) {
        console.warn('  ✗ ' + f.name + ' — expected ' + f.expected + ', got ' + f.actual);
      });
    }
    return { passed: passed, failed: failed, failures: failures };
  }

  // ============================================================
  // Mast Modes — clickstream event builder (M5 of Idea -OtADygKA_JhRmk1wUqN)
  // ============================================================
  //
  // Pure helper that constructs a mast.modes.module_enabled event payload.
  // The actual Firestore write lives in app/index.html (calls this for the
  // payload, then writes via MastDB.platform.set). Keeping the builder pure
  // means we can unit-test the event shape without a Firebase dep.

  var VALID_MODULE_ENABLED_CONTEXTS = {
    'sidebar_inline': 1,
    'add_to_mast_page': 1,
    'ai_suggestion': 1
  };

  /**
   * Build a mast.modes.module_enabled event payload.
   *
   * @param {Object} args
   *   tenantId     — string
   *   userId       — string | null
   *   modeSetDoc   — { modes: [], overlays: [], cohortFlag: bool, modeVersion: int }
   *   moduleId     — string (routeId)
   *   context      — one of: sidebar_inline | add_to_mast_page | ai_suggestion
   *   timestamp    — optional ISO string (default: now)
   * @returns {Object|null} — event payload, or null if required fields missing
   *
   * Returns null (rather than throwing) so a failed event build never breaks
   * the calling user flow — telemetry must be fire-and-forget.
   */
  function buildModuleEnabledEvent(args) {
    args = args || {};
    if (!args.tenantId || !args.moduleId) return null;
    var ctx = VALID_MODULE_ENABLED_CONTEXTS[args.context] ? args.context : 'sidebar_inline';
    var modeSet = args.modeSetDoc || {};
    var modesArr = Array.isArray(modeSet.modes) ? modeSet.modes.slice().sort() : [];
    var overlaysArr = Array.isArray(modeSet.overlays) ? modeSet.overlays.slice().sort() : [];
    return {
      eventType: 'mast.modes.module_enabled',
      tenantId: String(args.tenantId),
      userId: args.userId ? String(args.userId) : null,
      modeSet: modesArr,
      overlays: overlaysArr,
      cohortFlag: !!modeSet.cohortFlag,
      modeVersion: typeof modeSet.modeVersion === 'number' ? modeSet.modeVersion : MODE_VERSION,
      moduleId: String(args.moduleId),
      enabledFromContext: ctx,
      timestamp: args.timestamp || new Date().toISOString(),
      // Deterministic hash of modeSet for rollup keys — sort+join, no overlays
      // because peer modes carry the load-bearing shape information. M5 rollup
      // CF uses this to bucket events for the (modeSet_hash, moduleId) → rate
      // aggregation.
      modeSetHash: modesArr.length === 0 ? 'empty' : modesArr.join('__')
    };
  }

  /**
   * Self-tests for buildModuleEnabledEvent.
   * Run from console:  BusinessEntityConstants._runModuleEnabledEventSelfTests()
   */
  function _runModuleEnabledEventSelfTests() {
    var ev1 = buildModuleEnabledEvent({
      tenantId: 'shirglassworks', userId: 'uid_abc', moduleId: 'wholesale',
      modeSetDoc: { modes: ['maker'], overlays: ['event'], cohortFlag: false, modeVersion: 1 },
      context: 'sidebar_inline',
      timestamp: '2026-05-21T00:00:00.000Z'
    });
    var ev2 = buildModuleEnabledEvent({
      tenantId: 't', moduleId: 'inventory',
      modeSetDoc: { modes: ['retail', 'maker'] },
      context: 'add_to_mast_page'
    });
    var ev3 = buildModuleEnabledEvent({ moduleId: 'foo' }); // missing tenantId
    var ev4 = buildModuleEnabledEvent({ tenantId: 't' });   // missing moduleId
    var ev5 = buildModuleEnabledEvent({
      tenantId: 't', moduleId: 'x',
      modeSetDoc: { modes: [] }, context: 'bogus_context'
    });
    var ev6 = buildModuleEnabledEvent({
      tenantId: 't', moduleId: 'x',
      modeSetDoc: { modes: ['retail', 'maker', 'standard'] }, context: 'sidebar_inline'
    });

    var cases = [
      { name: 'ev1 eventType',          actual: ev1.eventType,                 expect: 'mast.modes.module_enabled' },
      { name: 'ev1 tenantId',           actual: ev1.tenantId,                  expect: 'shirglassworks' },
      { name: 'ev1 userId',             actual: ev1.userId,                    expect: 'uid_abc' },
      { name: 'ev1 modeSetHash',        actual: ev1.modeSetHash,               expect: 'maker' },
      { name: 'ev1 overlays sorted',    actual: ev1.overlays.join(','),        expect: 'event' },
      { name: 'ev1 context',            actual: ev1.enabledFromContext,        expect: 'sidebar_inline' },
      { name: 'ev1 modeVersion',        actual: ev1.modeVersion,               expect: 1 },
      { name: 'ev2 default userId null', actual: ev2.userId,                   expect: null },
      { name: 'ev2 hash deterministic order', actual: ev2.modeSetHash,         expect: 'maker__retail' },
      { name: 'ev2 modeVersion fallback', actual: ev2.modeVersion,             expect: MODE_VERSION },
      { name: 'ev3 missing tenantId returns null', actual: ev3,                expect: null },
      { name: 'ev4 missing moduleId returns null', actual: ev4,                expect: null },
      { name: 'ev5 invalid context falls back', actual: ev5.enabledFromContext, expect: 'sidebar_inline' },
      { name: 'ev5 empty modeSet hash',    actual: ev5.modeSetHash,            expect: 'empty' },
      { name: 'ev6 three-mode hash sorted', actual: ev6.modeSetHash,           expect: 'maker__retail__standard' }
    ];

    var passed = 0, failed = 0, failures = [];
    cases.forEach(function(tc) {
      if (tc.actual === tc.expect) {
        passed++;
      } else {
        failed++;
        failures.push({ name: tc.name, expected: tc.expect, actual: tc.actual });
      }
    });

    if (failed === 0) {
      console.log('[module-enabled-event] All ' + passed + ' self-tests passed.');
    } else {
      console.warn('[module-enabled-event] ' + failed + ' of ' + cases.length + ' FAILED:');
      failures.forEach(function(f) {
        console.warn('  ✗ ' + f.name + ' — expected ' + JSON.stringify(f.expected) + ', got ' + JSON.stringify(f.actual));
      });
    }
    return { passed: passed, failed: failed, failures: failures };
  }

  // ============================================================
  // Mast Modes — mode-change diff (M6 of Idea -OtADygKA_JhRmk1wUqN)
  // ============================================================
  //
  // Pure helper for "what changes when modeSet flips from A to B." Used by
  // the Settings "Change my business setup" flow to render a user-facing
  // diff before writing the new modeSet, and by the M7 reactive banner to
  // estimate the impact of a suggested mode change.
  //
  // Walks every route in MODE_ROUTE_VISIBILITY and classifies it as:
  //   - becomingVisible: hidden in current, visible in derived
  //   - becomingHidden:  visible in current, hidden in derived
  //   - unchanged:       same visibility either way
  //
  // The "always-on" tier is excluded — those routes don't change with modeSet.
  // The provided modeOverrides are honored on BOTH sides (a route enabled via
  // "+ add" stays visible across the diff; nothing the user manually enabled
  // gets retracted by a mode change — matches the M6 DECISION).

  /**
   * Compute visibility diff between two modeSet documents.
   *
   * @param {Object} currentModeSet — { modes, overlays, cohortFlag }
   * @param {Object} derivedModeSet — { modes, overlays, cohortFlag }
   * @param {Object} [modeOverrides] — { enabledRoutes: [] } honored on both sides
   * @returns {Object} {
   *   becomingVisible: string[] — route IDs newly visible after the change
   *   becomingHidden:  string[] — route IDs no longer visible after the change
   *                                (excludes anything in overrides — those stay visible)
   *   unchanged:       string[] — same visibility either way (for debugging only)
   * }
   */
  function diffModeSets(currentModeSet, derivedModeSet, modeOverrides) {
    var overrides = (modeOverrides && Array.isArray(modeOverrides.enabledRoutes))
      ? modeOverrides.enabledRoutes : [];
    var becomingVisible = [];
    var becomingHidden = [];
    var unchanged = [];
    for (var routeId in MODE_ROUTE_VISIBILITY) {
      if (!Object.prototype.hasOwnProperty.call(MODE_ROUTE_VISIBILITY, routeId)) continue;
      var rule = MODE_ROUTE_VISIBILITY[routeId];
      if (rule && rule.alwaysOn) continue;        // always-on never changes
      if (overrides.indexOf(routeId) !== -1) {    // user manually enabled — stays on
        continue;
      }
      var nowVisible = isRouteVisibleByDefault(routeId, currentModeSet);
      var nextVisible = isRouteVisibleByDefault(routeId, derivedModeSet);
      if (nowVisible && !nextVisible) becomingHidden.push(routeId);
      else if (!nowVisible && nextVisible) becomingVisible.push(routeId);
      else unchanged.push(routeId);
    }
    return {
      becomingVisible: becomingVisible,
      becomingHidden: becomingHidden,
      unchanged: unchanged
    };
  }

  /**
   * Self-tests for diffModeSets.
   * Run from console:  BusinessEntityConstants._runDiffModeSetsSelfTests()
   */
  function _runDiffModeSetsSelfTests() {
    var ms = function(modes, overlays, cohortFlag) {
      return { modes: modes || [], overlays: overlays || [], cohortFlag: !!cohortFlag };
    };

    // Standard → Maker should make many maker routes visible
    var d1 = diffModeSets(ms(['standard']), ms(['maker']));
    // Maker → Standard should hide many maker routes
    var d2 = diffModeSets(ms(['maker']), ms(['standard']));
    // Same modeSet: zero diff
    var d3 = diffModeSets(ms(['retail']), ms(['retail']));
    // Override honored: wholesale stays visible even when leaving maker
    var d4 = diffModeSets(ms(['maker']), ms(['standard']), { enabledRoutes: ['wholesale'] });
    // Adding cohortFlag reveals students/instructors
    var d5 = diffModeSets(ms(['bookings'], [], false), ms(['bookings'], [], true));
    // Adding event overlay reveals show-* routes
    var d6 = diffModeSets(ms(['maker'], []), ms(['maker'], ['event']));

    var cases = [
      { name: 'std→maker reveals develop-products',
        actual: d1.becomingVisible.indexOf('develop-products') !== -1, expect: true },
      { name: 'std→maker reveals wholesale',
        actual: d1.becomingVisible.indexOf('wholesale') !== -1, expect: true },
      { name: 'std→maker hides nothing',
        actual: d1.becomingHidden.length, expect: 0 },
      { name: 'maker→std hides develop-products',
        actual: d2.becomingHidden.indexOf('develop-products') !== -1, expect: true },
      { name: 'maker→std hides wholesale',
        actual: d2.becomingHidden.indexOf('wholesale') !== -1, expect: true },
      { name: 'no-change diff has zero visible delta',
        actual: d3.becomingVisible.length, expect: 0 },
      { name: 'no-change diff has zero hidden delta',
        actual: d3.becomingHidden.length, expect: 0 },
      { name: 'override preserves wholesale across maker→std',
        actual: d4.becomingHidden.indexOf('wholesale'), expect: -1 },
      { name: 'cohortFlag flip reveals students',
        actual: d5.becomingVisible.indexOf('students') !== -1, expect: true },
      { name: 'cohortFlag flip reveals instructors',
        actual: d5.becomingVisible.indexOf('instructors') !== -1, expect: true },
      { name: 'event overlay reveals show-find',
        actual: d6.becomingVisible.indexOf('show-find') !== -1, expect: true },
      { name: 'event overlay reveals shows route',
        actual: d6.becomingVisible.indexOf('show-apply') !== -1, expect: true }
    ];

    var passed = 0, failed = 0, failures = [];
    cases.forEach(function(tc) {
      if (tc.actual === tc.expect) passed++;
      else { failed++; failures.push(tc); }
    });
    if (failed === 0) console.log('[diff-mode-sets] All ' + passed + ' self-tests passed.');
    else {
      console.warn('[diff-mode-sets] ' + failed + ' of ' + cases.length + ' FAILED:');
      failures.forEach(function(f) { console.warn('  ✗ ' + f.name + ' — expected ' + JSON.stringify(f.expect) + ', got ' + JSON.stringify(f.actual)); });
    }
    return { passed: passed, failed: failed, failures: failures };
  }

  // ============================================================
  // Mast Modes — reactive banner thresholds (M7 of Idea -OtADygKA_JhRmk1wUqN)
  // ============================================================
  //
  // Pure helpers powering the M7 mode-change suggestion banner + modeVersion
  // migration prompt. Both banners are non-blocking and respect a 30-day
  // dismiss window.

  var MODE_SUGGEST_THRESHOLD_DEFAULT = 3;       // # overrides that trigger suggestion
  var MODE_DISMISS_COOLDOWN_DAYS = 30;          // re-show window after dismiss
  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  /**
   * Should we show the mode-change suggestion banner?
   *
   * Triggers when the tenant has manually enabled `threshold` or more modules
   * that aren't visible-by-default in their current modeSet — signal that
   * their actual usage has shifted away from their declared business shape.
   *
   * (Simplification vs spec: we count current overrides outside default
   * visibility rather than time-window the clickstream. Equivalent in steady
   * state because overrides only grow when an owner clicks "+ add" — there's
   * no auto-cleanup. Avoids a per-tenant Firestore query on every app load.)
   *
   * @param {Object} modeSetDoc        — current { modes, overlays, cohortFlag }
   * @param {Object} modeOverridesDoc  — { enabledRoutes: [] }
   * @param {Object} uiDoc             — { modeSuggestionDismissedAt: ISO|null }
   * @param {Object} [opts]            — { threshold, cooldownDays, now }
   * @returns {Object} {
   *   show: boolean,
   *   overflowingCount: number,         — how many overrides are outside default
   *   overflowingRoutes: string[],
   *   suppressedByDismiss: boolean,
   *   suppressedReason: string|null     — debug-friendly reason if !show
   * }
   */
  function shouldShowModeChangeSuggestion(modeSetDoc, modeOverridesDoc, uiDoc, opts) {
    opts = opts || {};
    var threshold = typeof opts.threshold === 'number' ? opts.threshold : MODE_SUGGEST_THRESHOLD_DEFAULT;
    var cooldownDays = typeof opts.cooldownDays === 'number' ? opts.cooldownDays : MODE_DISMISS_COOLDOWN_DAYS;
    var nowMs = opts.now instanceof Date ? opts.now.getTime() :
                typeof opts.now === 'number' ? opts.now :
                typeof opts.now === 'string' ? Date.parse(opts.now) : Date.now();

    var overrides = (modeOverridesDoc && Array.isArray(modeOverridesDoc.enabledRoutes))
      ? modeOverridesDoc.enabledRoutes : [];

    // Count overrides that are NOT visible-by-default in the current modeSet.
    var overflowing = [];
    for (var i = 0; i < overrides.length; i++) {
      var routeId = overrides[i];
      if (!isRouteVisibleByDefault(routeId, modeSetDoc)) overflowing.push(routeId);
    }

    var result = {
      show: false,
      overflowingCount: overflowing.length,
      overflowingRoutes: overflowing,
      suppressedByDismiss: false,
      suppressedReason: null
    };

    if (overflowing.length < threshold) {
      result.suppressedReason = 'below_threshold';
      return result;
    }

    // Respect dismiss cooldown
    if (uiDoc && uiDoc.modeSuggestionDismissedAt) {
      var dismissedMs = Date.parse(uiDoc.modeSuggestionDismissedAt);
      if (!isNaN(dismissedMs)) {
        var daysSince = (nowMs - dismissedMs) / MS_PER_DAY;
        if (daysSince < cooldownDays) {
          result.suppressedByDismiss = true;
          result.suppressedReason = 'within_dismiss_cooldown';
          return result;
        }
      }
    }

    result.show = true;
    return result;
  }

  /**
   * Should we show the modeVersion migration prompt?
   *
   * Triggers when the tenant's stored modeVersion < the canonical MODE_VERSION.
   * Fires zero times in v1 (canonical and stored both = 1); the mechanism is
   * shipped so a v1.1 matrix bump auto-surfaces the prompt to existing tenants.
   *
   * Respects the same 30-day dismiss cooldown.
   */
  function shouldShowModeMigrationPrompt(modeSetDoc, uiDoc, opts) {
    opts = opts || {};
    var cooldownDays = typeof opts.cooldownDays === 'number' ? opts.cooldownDays : MODE_DISMISS_COOLDOWN_DAYS;
    var nowMs = opts.now instanceof Date ? opts.now.getTime() :
                typeof opts.now === 'number' ? opts.now :
                typeof opts.now === 'string' ? Date.parse(opts.now) : Date.now();

    var tenantVersion = (modeSetDoc && typeof modeSetDoc.modeVersion === 'number') ? modeSetDoc.modeVersion : 0;
    var canonicalVersion = MODE_VERSION;
    var result = {
      show: false,
      tenantVersion: tenantVersion,
      canonicalVersion: canonicalVersion,
      suppressedReason: null
    };

    if (tenantVersion >= canonicalVersion) {
      result.suppressedReason = 'up_to_date';
      return result;
    }

    if (uiDoc && uiDoc.modeMigrationDismissedAt) {
      var dismissedMs = Date.parse(uiDoc.modeMigrationDismissedAt);
      if (!isNaN(dismissedMs)) {
        var daysSince = (nowMs - dismissedMs) / MS_PER_DAY;
        if (daysSince < cooldownDays) {
          result.suppressedReason = 'within_dismiss_cooldown';
          return result;
        }
      }
    }

    result.show = true;
    return result;
  }

  function _runBannerThresholdSelfTests() {
    var ms = function(modes, overlays, cohortFlag, modeVersion) {
      return {
        modes: modes || [],
        overlays: overlays || [],
        cohortFlag: !!cohortFlag,
        // Explicit undefined check — modeVersion: 0 is a valid test value (simulates legacy pre-migration tenant)
        modeVersion: (typeof modeVersion === 'number') ? modeVersion : 1
      };
    };
    var dayAgo = new Date(Date.now() - 1 * MS_PER_DAY).toISOString();
    var monthAgo = new Date(Date.now() - 31 * MS_PER_DAY).toISOString();

    var cases = [
      // Suggestion banner — below threshold (only 2 overrides outside default)
      { name: 'below threshold (2 overrides) → no show',
        fn: 'shouldShowModeChangeSuggestion',
        modeSet: ms(['standard']),
        overrides: { enabledRoutes: ['develop-products', 'materials'] },
        ui: null,
        expectShow: false },
      // At threshold
      { name: 'at threshold (3 overrides outside default) → show',
        fn: 'shouldShowModeChangeSuggestion',
        modeSet: ms(['standard']),
        overrides: { enabledRoutes: ['develop-products', 'materials', 'wholesale'] },
        ui: null,
        expectShow: true },
      // Overrides that ARE in default don't count
      { name: 'overrides inside default → no show',
        fn: 'shouldShowModeChangeSuggestion',
        modeSet: ms(['maker']),
        overrides: { enabledRoutes: ['develop-products', 'materials', 'wholesale'] },
        ui: null,
        expectShow: false },
      // Above threshold but dismissed recently
      { name: 'above threshold but dismissed yesterday → suppressed',
        fn: 'shouldShowModeChangeSuggestion',
        modeSet: ms(['standard']),
        overrides: { enabledRoutes: ['develop-products', 'materials', 'wholesale', 'jobs'] },
        ui: { modeSuggestionDismissedAt: dayAgo },
        expectShow: false },
      // Above threshold and dismissed >30 days ago → re-show
      { name: 'above threshold and dismissed 31d ago → re-show',
        fn: 'shouldShowModeChangeSuggestion',
        modeSet: ms(['standard']),
        overrides: { enabledRoutes: ['develop-products', 'materials', 'wholesale', 'jobs'] },
        ui: { modeSuggestionDismissedAt: monthAgo },
        expectShow: true },
      // Migration prompt — versions equal (the only v1 case) → no show
      { name: 'migration: tenant version == canonical → no show',
        fn: 'shouldShowModeMigrationPrompt',
        modeSet: ms(['retail'], [], false, 1),
        ui: null,
        expectShow: false },
      // Tenant version < canonical (simulating v1.1) → show
      { name: 'migration: tenant version < canonical → show',
        fn: 'shouldShowModeMigrationPrompt',
        modeSet: ms(['retail'], [], false, 0),
        ui: null,
        expectShow: true },
      // Migration: dismissed yesterday → suppressed
      { name: 'migration: tenant behind but dismissed yesterday → suppressed',
        fn: 'shouldShowModeMigrationPrompt',
        modeSet: ms(['retail'], [], false, 0),
        ui: { modeMigrationDismissedAt: dayAgo },
        expectShow: false }
    ];

    var passed = 0, failed = 0, failures = [];
    cases.forEach(function(tc) {
      var actual;
      if (tc.fn === 'shouldShowModeChangeSuggestion') {
        actual = shouldShowModeChangeSuggestion(tc.modeSet, tc.overrides, tc.ui);
      } else {
        actual = shouldShowModeMigrationPrompt(tc.modeSet, tc.ui);
      }
      if (actual.show === tc.expectShow) passed++;
      else { failed++; failures.push({ name: tc.name, expected: tc.expectShow, actual: actual.show, reason: actual.suppressedReason }); }
    });

    if (failed === 0) console.log('[banner-thresholds] All ' + passed + ' self-tests passed.');
    else {
      console.warn('[banner-thresholds] ' + failed + ' of ' + cases.length + ' FAILED:');
      failures.forEach(function(f) { console.warn('  ✗ ' + f.name + ' — expected show=' + f.expected + ', got ' + f.actual + ' (' + f.reason + ')'); });
    }
    return { passed: passed, failed: failed, failures: failures };
  }

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
    DOCUMENT_UPLOAD_SSN_WARNING: DOCUMENT_UPLOAD_SSN_WARNING,
    REVENUE_BRACKETS: REVENUE_BRACKETS,
    PRIMARY_CONTACT_ROLES: PRIMARY_CONTACT_ROLES,
    TEAM_SIZE_BANDS: TEAM_SIZE_BANDS,
    DECLARED_CHANNELS: DECLARED_CHANNELS,
    ARCHETYPES: ARCHETYPES,
    GOAL_LABELS: GOAL_LABELS,
    ENGAGEMENT_MODE_CARDS: ENGAGEMENT_MODE_CARDS,
    SURFACE_OPTIONS: SURFACE_OPTIONS,
    BUSINESS_TYPES: BUSINESS_TYPES,
    PRIMARY_OUTPUTS: PRIMARY_OUTPUTS,
    CURRENT_TOOLS: CURRENT_TOOLS,
    FEATURE_MODE_OPTIONS: FEATURE_MODE_OPTIONS,
    FEATURE_PAGE_OPTIONS: FEATURE_PAGE_OPTIONS,
    REVENUE_CHANNELS: REVENUE_CHANNELS,
    BUSINESS_CATEGORIES: BUSINESS_CATEGORIES,
    // Mast Modes (Idea -OtADygKA_JhRmk1wUqN) — see deriveModeSet above
    MODE_ENUM: MODE_ENUM,
    OVERLAY_ENUM: OVERLAY_ENUM,
    MODE_VERSION: MODE_VERSION,
    MODE_WEIGHT_ORDER: MODE_WEIGHT_ORDER,
    deriveModeSet: deriveModeSet,
    _runDerivationSelfTests: _runDerivationSelfTests,
    MODE_ROUTE_VISIBILITY: MODE_ROUTE_VISIBILITY,
    isRouteVisibleByDefault: isRouteVisibleByDefault,
    isRouteVisible: isRouteVisible,
    setRouteVisibilityOverride: setRouteVisibilityOverride,
    _runVisibilitySelfTests: _runVisibilitySelfTests,
    // Module dependency map — advisory "X needs Y" warnings on hide
    MODULE_DEPENDENCIES: MODULE_DEPENDENCIES,
    requiresOf: requiresOf,
    dependentsOf: dependentsOf,
    _runDependencySelfTests: _runDependencySelfTests,
    MODE_LABEL_OVERRIDES: MODE_LABEL_OVERRIDES,
    labelFor: labelFor,
    _clearLabelCache: _clearLabelCache,
    _runLabelOverrideSelfTests: _runLabelOverrideSelfTests,
    // M5 (Idea -OtADygKA_JhRmk1wUqN) — clickstream event builder
    VALID_MODULE_ENABLED_CONTEXTS: VALID_MODULE_ENABLED_CONTEXTS,
    buildModuleEnabledEvent: buildModuleEnabledEvent,
    _runModuleEnabledEventSelfTests: _runModuleEnabledEventSelfTests,
    // M6 (Idea -OtADygKA_JhRmk1wUqN) — mode-set diff helper
    diffModeSets: diffModeSets,
    _runDiffModeSetsSelfTests: _runDiffModeSetsSelfTests,
    // M7 (Idea -OtADygKA_JhRmk1wUqN) — reactive banner thresholds
    MODE_SUGGEST_THRESHOLD_DEFAULT: MODE_SUGGEST_THRESHOLD_DEFAULT,
    MODE_DISMISS_COOLDOWN_DAYS: MODE_DISMISS_COOLDOWN_DAYS,
    shouldShowModeChangeSuggestion: shouldShowModeChangeSuggestion,
    shouldShowModeMigrationPrompt: shouldShowModeMigrationPrompt,
    _runBannerThresholdSelfTests: _runBannerThresholdSelfTests,
    validateEin: validateEin
  };
})(typeof window !== 'undefined' ? window : this);
