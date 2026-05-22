// ============================================================
// MODE_MODULE_INFO — Add-to-Mast page copy
// ============================================================
// Source of truth for every module card on the Add-to-Mast page.
// Migrated from app/index.html on 2026-05-22 (Idea -OtEQoFvlPAu90ghkDXu)
// so the core HTML stays thin and copy edits are diff-reviewable.
//
// Phase A: 1 fully-enriched entry (wholesale) + 83 stubs.
// Phase A continuation (E2) populates 9 more hero modules.
// Phase B (E3) backfills the long tail one PR per sidebar section.
//
// SCHEMA (see mode-module-info.schema.js for validator):
//   Required: label (≤24ch), section, tagline (≤90ch)
//   Optional: outcome (≤120ch), goodFitWhen (≤140ch), notAFitWhen (≤140ch),
//             automates (1–4 items ≤60ch each), replacesTools (0–4),
//             complementsTools (0–4), prerequisites (0–4), pairsWith (0–6
//             routeIds — must resolve), setupDepth (quick|moderate|heavy),
//             preview ({url, alt}), learnMoreUrl (https://help.runmast.com/#…)
//
// Cards without `outcome` render in the collapsed-only "legacy" mode —
// no "▾ Details" affordance, identical to the pre-enrichment UI.
//
// URLs use the canonical runmast.com domain — never mast.com.
// ============================================================
(function () {
  'use strict';

  var HELP_BASE = 'https://help.runmast.com/#';
  var ASSET_BASE = 'https://assets.runmast.com/modes/';

  var MODE_SECTION_LABELS = {
    'products':         'Products',
    'sales':            'Sales',
    'marketing':        'Marketing',
    'retention':        'Retention',
    'events':           'Shows & Markets',
    'classes':          'Bookings & Classes',
    'finance':          'Finance',
    'operations':       'Operations',
    'customer-service': 'Customer Service',
    'admin':            'Admin'
  };

  var MODE_MODULE_INFO = {

    // ── Products ──────────────────────────────────────────────
    'materials':          { label: 'Materials',           section: 'products', tagline: 'Track raw materials, suppliers, and unit costs.' },
    'forecast': {
      label:    'Forecast',
      section:  'products',
      tagline:  'Predict inventory needs based on sales velocity.',
      outcome:      "See which pieces will run out next week and how many to make, based on what's actually selling.",
      goodFitWhen:  "you make pieces in batches and want to stop guessing how many to make next.",
      notAFitWhen:  "every piece you make is one-of-a-kind and not a candidate for restock.",
      automates: [
        "Eyeballing your shelves and guessing",
        "Counting sales by hand to find the runners",
        "Restocking the wrong colors and ignoring the hits"
      ],
      replacesTools:    ["Inventory spreadsheet", "Notebook of best-sellers"],
      complementsTools: ["Shopify", "Square"],
      prerequisites: [
        "Products module enabled",
        "At least 30 days of sales data"
      ],
      pairsWith:  ["products", "inventory", "jobs", "procurement", "sales-by-product"],
      setupDepth: "quick",
      preview: {
        url: ASSET_BASE + 'forecast.png',
        alt: "Forecast view ranking products by days-of-supply with restock suggestions"
      },
      learnMoreUrl: HELP_BASE + 'forecast'
    },
    'jobs':               { label: 'Jobs',                section: 'products', tagline: 'Schedule production runs and batch work.' },
    'procurement':        { label: 'Procurement',         section: 'products', tagline: 'Manage purchase orders and supplier relationships.' },
    'inventory':          { label: 'Inventory',           section: 'products', tagline: 'Track stock levels across products and variants.' },
    'products':           { label: 'Products',            section: 'products', tagline: 'Browse and edit your product catalog.' },
    'develop-products':   { label: 'Develop Products',    section: 'products', tagline: 'Design new products, variants, and SKUs.' },
    'sales-by-product':   { label: 'Sales by Product',    section: 'products', tagline: 'See which products are selling and which aren’t.' },

    // ── Sales ─────────────────────────────────────────────────
    'pos':                { label: 'Point of Sale',       section: 'sales',    tagline: 'Ring up sales in person — phone, tablet, or laptop.' },
    'orders':             { label: 'Retail Orders',       section: 'sales',    tagline: 'View and process incoming customer orders.' },
    'commissions': {
      label:    'Custom Orders',
      section:  'sales',
      tagline:  'Manage custom orders, quotes, and bespoke work.',
      outcome:      "Take custom-piece requests through quote, deposit, build, and delivery without losing track of where each one stands.",
      goodFitWhen:  "you take commission work, custom sizes, or one-off pieces that need a quote before you start.",
      notAFitWhen:  "everything you sell is made-to-stock and listed in your shop.",
      automates: [
        "Tracking commission requests in email threads",
        "Calculating deposits and remaining balances",
        "Following up when a quote goes quiet"
      ],
      replacesTools:    ["Email threads", "Google Forms intake", "Trello commission board"],
      complementsTools: ["Square", "Stripe"],
      prerequisites: [
        "Products module enabled"
      ],
      pairsWith:  ["orders", "customers", "jobs", "pack", "ship", "finance-ar"],
      setupDepth: "quick",
      preview: {
        url: ASSET_BASE + 'commissions.png',
        alt: "Custom order detail with quote, deposit, and build status"
      },
      learnMoreUrl: HELP_BASE + 'commissions'
    },
    'rma':                { label: 'Returns',             section: 'sales',    tagline: 'Process returns, refunds, and replacements.' },

    // ── Sales — Wholesale (FULLY ENRICHED Phase A reference) ──
    'wholesale': {
      label:    'Wholesale',
      section:  'sales',
      tagline:  'Sell to other businesses at wholesale pricing.',

      outcome:      "Sell to shops and galleries at your wholesale price, and get paid on Net-30 without chasing invoices.",
      goodFitWhen:  "you sell to more than 3 buyers, or you're tired of tracking Net-30 in a notebook.",
      notAFitWhen:  "you only sell direct-to-consumer.",

      automates: [
        "Tracking who ordered what in a spreadsheet",
        "Sending invoices manually from Square",
        "Remembering whose Net-30 is due",
        "Generating line sheets for buyers"
      ],
      replacesTools:    ["Faire", "Google Sheets line sheet", "Square Invoices"],
      complementsTools: ["QuickBooks", "Shopify"],

      prerequisites: [
        "Products module enabled",
        "At least one wholesale price tier defined"
      ],
      pairsWith:  ["orders", "customers", "finance-ar", "lookbooks", "pack", "ship"],
      setupDepth: "moderate",

      preview: {
        url: ASSET_BASE + 'wholesale.png',
        alt: "Wholesale order entry with line items and Net-30 terms"
      },
      learnMoreUrl: HELP_BASE + 'wholesale'
    },

    'galleries':          { label: 'Galleries',           section: 'sales',    tagline: 'Track inventory placed on consignment at galleries.' },
    'lookbooks':          { label: 'Look Books',          section: 'sales',    tagline: 'Generate PDF line sheets and look books for buyers.' },
    'pack':               { label: 'Pack',                section: 'sales',    tagline: 'Pick and pack orders for shipment.' },
    'ship':               { label: 'Ship',                section: 'sales',    tagline: 'Buy shipping labels and track packages.' },

    // ── Marketing ─────────────────────────────────────────────
    'social':             { label: 'Social Media',        section: 'marketing', tagline: 'Schedule and publish social posts.' },
    'blog':               { label: 'Blog',                section: 'marketing', tagline: 'Publish long-form articles on your website.' },
    'newsletter': {
      label:    'Newsletter',
      section:  'marketing',
      tagline:  'Email your customer list with campaigns and updates.',
      outcome:      "Send a beautiful email to your customer list in 10 minutes, and see who opened it.",
      goodFitWhen:  "you have a customer list and something to say to it more than twice a year.",
      notAFitWhen:  "you only sell at in-person markets and don't collect emails.",
      automates: [
        "Copy-pasting customer emails into Mailchimp",
        "Designing a new layout for every send",
        "Keeping unsubscribes in sync across tools"
      ],
      replacesTools:    ["Mailchimp", "Klaviyo", "Buttondown"],
      complementsTools: ["Stories", "Blog"],
      prerequisites: [
        "Brand colors and logo set in the Brand module"
      ],
      pairsWith:  ["customers", "stories", "blog", "promotions", "gift-cards"],
      setupDepth: "quick",
      preview: {
        url: ASSET_BASE + 'newsletter.png',
        alt: "Newsletter composer with template preview and open-rate chart"
      },
      learnMoreUrl: HELP_BASE + 'newsletter'
    },
    'stories':            { label: 'Stories',             section: 'marketing', tagline: 'Behind-the-scenes posts that showcase your craft.' },
    'homepage':           { label: 'Page Builder',        section: 'marketing', tagline: 'Customize your storefront homepage layout.' },

    // ── Retention ─────────────────────────────────────────────
    'wallet':             { label: 'Wallet',              section: 'retention', tagline: 'Store credit, points, and pre-paid balances.' },
    'gift-cards': {
      label:    'Gift Cards',
      section:  'retention',
      tagline:  'Sell and redeem gift cards.',
      outcome:      "Sell gift cards online and in person, redeem them at checkout, and see what's still outstanding.",
      goodFitWhen:  "you want to capture holiday sales without picking out the actual gift, or your customers ask for them.",
      notAFitWhen:  "your average order is under $20 and customers don't ask about gift options.",
      automates: [
        "Selling physical gift cards through a separate POS",
        "Tracking redemption balances on a clipboard",
        "Emailing gift-card codes manually"
      ],
      replacesTools:    ["Square gift cards", "Shopify gift cards"],
      complementsTools: ["Square", "Stripe"],
      prerequisites: [],
      pairsWith:  ["pos", "orders", "wallet", "promotions", "finance-revenue"],
      setupDepth: "quick",
      preview: {
        url: ASSET_BASE + 'gift-cards.png',
        alt: "Gift card sales page with outstanding balance summary"
      },
      learnMoreUrl: HELP_BASE + 'gift-cards'
    },
    'coupons':            { label: 'Coupons',             section: 'retention', tagline: 'Discount codes for promotions.' },
    'loyalty': {
      label:    'Loyalty',
      section:  'retention',
      tagline:  'Reward repeat customers with points.',
      outcome:      "Give your best customers a reason to come back twice as often, without running a punch-card program by hand.",
      goodFitWhen:  "you have customers who buy from you more than once a year and you want them to buy more.",
      notAFitWhen:  "your work is a one-time purchase (e.g. wedding pieces, large commissions) with no repeat path.",
      automates: [
        "Stamping a paper punch card at the register",
        "Remembering who earned a discount last month",
        "Sending a thank-you to your best customers"
      ],
      replacesTools:    ["Punch cards", "Smile.io", "Yotpo Loyalty"],
      complementsTools: ["Square Loyalty"],
      prerequisites: [
        "Customers module enabled"
      ],
      pairsWith:  ["customers", "pos", "orders", "wallet", "newsletter"],
      setupDepth: "moderate",
      preview: {
        url: ASSET_BASE + 'loyalty.png',
        alt: "Loyalty program setup with tier rewards and customer leaderboard"
      },
      learnMoreUrl: HELP_BASE + 'loyalty'
    },
    'membership': {
      label:    'Membership',
      section:  'retention',
      tagline:  'Recurring subscription tiers with member perks.',
      outcome:      "Charge a monthly or annual fee for studio access, early drops, or member-only pricing, and collect it automatically.",
      goodFitWhen:  "you have a studio with regular open hours, or you'd offer member perks that work over time (early access, discounts, free pieces).",
      notAFitWhen:  "you've never had a customer ask about subscribing or paying for membership.",
      automates: [
        "Tracking who paid for studio access this month",
        "Charging members on a schedule",
        "Reminding members when their card expires"
      ],
      replacesTools:    ["Patreon", "Memberful", "Stripe billing pages"],
      complementsTools: ["Stripe", "QuickBooks"],
      prerequisites: [
        "Stripe account connected",
        "At least one membership tier defined"
      ],
      pairsWith:  ["customers", "wallet", "finance-revenue", "finance-ar", "promotions"],
      setupDepth: "moderate",
      preview: {
        url: ASSET_BASE + 'membership.png',
        alt: "Membership tiers with monthly billing schedule and active-member count"
      },
      learnMoreUrl: HELP_BASE + 'membership'
    },
    'promotions':         { label: 'Sale Promotions',     section: 'retention', tagline: 'Run sales and promotional campaigns.' },

    // ── Shows & Markets ───────────────────────────────────────
    'show-find': {
      label:    'Find Shows',
      section:  'events',
      tagline:  'Discover shows, markets, and fairs to apply to.',
      outcome:      "See upcoming shows in your area, filter by fit and fees, and apply without re-typing your artist statement every time.",
      goodFitWhen:  "you sell at markets, craft fairs, or art shows — even just a few a year.",
      notAFitWhen:  "you sell only online and don't do in-person events.",
      automates: [
        "Searching show listings across multiple sites",
        "Re-typing your artist statement and booth photos",
        "Tracking which shows you applied to and who replied"
      ],
      replacesTools:    ["ZAPP", "EntryThingy bookmarks", "Spreadsheet of show deadlines"],
      complementsTools: ["Mast Events"],
      prerequisites: [
        "Mast Events account (free — created automatically)"
      ],
      pairsWith:  ["show-apply", "show-prep", "show-execute", "show-history"],
      setupDepth: "quick",
      preview: {
        url: ASSET_BASE + 'show-find.png',
        alt: "Show finder with map view and application status chips"
      },
      learnMoreUrl: HELP_BASE + 'show-find'
    },
    'show-apply':         { label: 'Apply',               section: 'events',   tagline: 'Submit applications to upcoming shows.' },
    'show-prep':          { label: 'Prep',                section: 'events',   tagline: 'Plan inventory, packing, and logistics for shows.' },
    'show-execute':       { label: 'Execute',             section: 'events',   tagline: 'Run your booth — POS, restocks, traffic notes.' },
    'show-history':       { label: 'Show History',        section: 'events',   tagline: 'Past show records, sales, and lessons learned.' },
    'events-shows':       { label: 'Host Shows',          section: 'events',   tagline: 'Organize your own events as a show host.' },
    'events-settings':    { label: 'Show Settings',       section: 'events',   tagline: 'Configure your event hosting settings.' },

    // ── Bookings & Classes ────────────────────────────────────
    'book': {
      label:    'Classes',
      section:  'classes',
      tagline:  'Schedule classes, workshops, and appointments.',
      outcome:      "Run classes and workshops without losing track of who paid, who showed up, and who needs a refund.",
      goodFitWhen:  "you teach classes or run workshops — one-off or on a regular schedule.",
      notAFitWhen:  "you only sell finished pieces and don't teach.",
      automates: [
        "Taking sign-ups in DMs and spreadsheets",
        "Chasing down class fees",
        "Reminding students the night before",
        "Tracking waitlists and refunds"
      ],
      replacesTools:    ["Eventbrite", "Acuity Scheduling", "Square Appointments"],
      complementsTools: ["Stripe", "Google Calendar"],
      prerequisites: [
        "Studio location set in the Studio module"
      ],
      pairsWith:  ["calendar", "enrollments", "students", "instructors", "passes", "book-reports"],
      setupDepth: "moderate",
      preview: {
        url: ASSET_BASE + 'book.png',
        alt: "Class schedule grid with enrollment counts and waitlist indicators"
      },
      learnMoreUrl: HELP_BASE + 'book'
    },
    'calendar':           { label: 'Calendar',            section: 'classes',  tagline: 'View all upcoming bookings in calendar form.' },
    'enrollments':        { label: 'Enrollments',         section: 'classes',  tagline: 'Track student enrollments per class.' },
    'passes':             { label: 'Passes',              section: 'classes',  tagline: 'Multi-class passes and punch cards.' },
    'resources':          { label: 'Resources',           section: 'classes',  tagline: 'Manage rooms, equipment, and instructor time slots.' },
    'students':           { label: 'Students',            section: 'classes',  tagline: 'Student database with class history.' },
    'instructors':        { label: 'Instructors',         section: 'classes',  tagline: 'Manage instructor profiles and pay rates.' },
    'book-reports':       { label: 'Class Reports',       section: 'classes',  tagline: 'Attendance and revenue reports for classes.' },

    // ── Finance ───────────────────────────────────────────────
    'finance-pl':         { label: 'Profit & Loss',       section: 'finance',  tagline: 'Profit & loss statements and trend analysis.' },
    'finance-cash-flow':  { label: 'Cash Flow',           section: 'finance',  tagline: 'Cash flow tracking and projections.' },
    'finance-ar':         { label: 'Accounts Receivable', section: 'finance',  tagline: 'Money owed to you by customers and accounts.' },
    'finance-ap':         { label: 'Accounts Payable',    section: 'finance',  tagline: 'Bills and supplier invoices.' },
    'finance-reports':    { label: 'Financial Reports',   section: 'finance',  tagline: 'Tax-ready reports and ledger exports.' },
    'customer-portfolio': { label: 'Customer Portfolio',  section: 'finance',  tagline: 'Per-customer revenue and lifetime value.' },

    // ── Operations ────────────────────────────────────────────
    'trips':              { label: 'Trips',               section: 'operations', tagline: 'Track delivery trips and business mileage.' },
    'reports':            { label: 'Reports',             section: 'operations', tagline: 'Operational reports across the business.' },
    'advisor':            { label: 'Business Plan',       section: 'operations', tagline: 'AI business plan and growth recommendations.' },
    'studio':             { label: 'Studio',              section: 'operations', tagline: 'Configure studio locations and equipment.' },
    'channels': {
      label:    'Channels',
      section:  'operations',
      tagline:  'Manage Etsy, Shopify, and other sales channels.',
      outcome:      "See all your sales from Etsy, Shopify, and your Mast storefront in one place, and stop double-selling pieces.",
      goodFitWhen:  "you sell on more than one site and have ever oversold a piece because the count was off.",
      notAFitWhen:  "Mast is your only storefront and you don't sell anywhere else.",
      automates: [
        "Logging into 4 sites to check today's orders",
        "Updating inventory on each site after every sale",
        "Reconciling payouts from 3 different processors"
      ],
      replacesTools:    ["Etsy seller app", "Shopify admin", "Trunk inventory sync"],
      complementsTools: ["Etsy", "Shopify", "QuickBooks"],
      prerequisites: [
        "Products module enabled",
        "An active account on at least one external channel"
      ],
      pairsWith:  ["products", "inventory", "orders", "finance-revenue", "ship"],
      setupDepth: "heavy",
      preview: {
        url: ASSET_BASE + 'channels.png',
        alt: "Channels dashboard showing Etsy, Shopify, and storefront sales side-by-side"
      },
      learnMoreUrl: HELP_BASE + 'channels'
    },

    // ── Customer Service ──────────────────────────────────────
    'cs-inbox':           { label: 'Inbox',               section: 'customer-service', tagline: 'Customer messages and email inquiries.' },
    'cs-tickets':         { label: 'Tickets',             section: 'customer-service', tagline: 'Support ticket queue and resolution tracking.' },
    'cs-surveys':         { label: 'Surveys',             section: 'customer-service', tagline: 'Send post-purchase surveys to customers.' },
    'cs-reviews':         { label: 'Reviews',             section: 'customer-service', tagline: 'Customer reviews and ratings management.' },
    'cs-faqs':            { label: 'FAQs',                section: 'customer-service', tagline: 'Self-service knowledge base.' },
    'cs-members':         { label: 'Members',             section: 'customer-service', tagline: 'Member directory and lifecycle tracking.' },

    // ── Always-on (informational only; no toggle button) ──────
    // Sales (always-on)
    'receipts':           { label: 'Receipts',            section: 'sales',     tagline: 'Match payouts and reconcile receipts.' },
    'terms':              { label: 'Terms & Conditions',        section: 'sales',     tagline: 'Storefront legal copy and policies.' },
    // Marketing (always-on)
    'website':            { label: 'Website Content',     section: 'marketing', tagline: 'Public-facing storefront pages and copy.' },
    'brand':              { label: 'Brand',               section: 'marketing', tagline: 'Logo, colors, fonts, and brand identity.' },
    'images':             { label: 'Images',              section: 'marketing', tagline: 'Image library and asset management.' },
    // Finance (always-on)
    'finance-revenue':    { label: 'Revenue',             section: 'finance',   tagline: 'Revenue tracking and trend reports.' },
    'finance-expenses':   { label: 'Expenses',            section: 'finance',   tagline: 'Expense entry and categorization.' },
    'finance-tax':        { label: 'Tax',                 section: 'finance',   tagline: 'Sales tax configuration and remittance reports.' },
    // Operations (always-on)
    'contacts':           { label: 'Contacts',            section: 'operations', tagline: 'Contact database for non-customer relationships.' },
    'customers':          { label: 'Customers',           section: 'operations', tagline: 'Customer database, lifecycle, and history.' },
    'team':               { label: 'Team',                section: 'operations', tagline: 'Team members, roles, and time tracking.' },
    'business':           { label: 'Business',            section: 'operations', tagline: 'Business entity configuration and compliance.' },
    // Admin (always-on)
    'settings':           { label: 'Settings',            section: 'admin',     tagline: 'Tenant settings, integrations, and configuration.' },
    'employees':          { label: 'Permissions',         section: 'admin',     tagline: 'User roles, permissions, and RBAC.' },
    'analytics':          { label: 'Analytics',           section: 'admin',     tagline: 'Site analytics and operational metrics.' },
    'auditlog':           { label: 'Audit Log',           section: 'admin',     tagline: 'System audit trail for all admin actions.' },
    'subscription':       { label: 'Subscription',        section: 'admin',     tagline: 'Mast subscription, billing, and plan management.' },
    'about':              { label: 'About',               section: 'admin',     tagline: 'About this Mast tenant — version, support.' },
    'email-log':          { label: 'Email Log',           section: 'admin',     tagline: 'Outbound transactional email log.' }
    // Migration routes (migration, migration-confirm, migration-plan,
    // migration-import, historical-orders) are intentionally omitted —
    // they're system-managed, conditionally shown by migration state.
  };

  // Back-compat shim: existing renderer reads `info.desc`. New schema field is
  // `tagline`. Mirror it so we can deprecate `desc` gradually without churn.
  for (var routeId in MODE_MODULE_INFO) {
    if (Object.prototype.hasOwnProperty.call(MODE_MODULE_INFO, routeId)) {
      var entry = MODE_MODULE_INFO[routeId];
      if (entry && typeof entry.tagline === 'string' && typeof entry.desc !== 'string') {
        entry.desc = entry.tagline;
      }
    }
  }

  // Publish to globals (eager — needed for sidebar label resolution at boot
  // time, not just on the Add-to-Mast page). Lightweight: pure data, no DOM.
  window.MODE_MODULE_INFO = MODE_MODULE_INFO;
  window.MODE_SECTION_LABELS = MODE_SECTION_LABELS;

  // Run optional self-validation if schema loaded. Fails soft in prod —
  // logs warnings, never throws. Dev hooks/CI catch hard errors instead.
  if (typeof window.validateModuleEntry === 'function') {
    var registry = (window.BusinessEntityConstants && window.BusinessEntityConstants.MODE_ROUTE_VISIBILITY) || null;
    var problems = [];
    for (var rid in MODE_MODULE_INFO) {
      if (!Object.prototype.hasOwnProperty.call(MODE_MODULE_INFO, rid)) continue;
      var res = window.validateModuleEntry(rid, MODE_MODULE_INFO[rid], { routeRegistry: registry });
      if (res && !res.ok) {
        for (var pi = 0; pi < res.errors.length; pi++) {
          problems.push(rid + ': ' + res.errors[pi]);
        }
      }
    }
    if (problems.length > 0) {
      console.warn('[mode-module-info] ' + problems.length + ' validation warning(s):');
      problems.slice(0, 20).forEach(function (p) { console.warn('  ' + p); });
      if (problems.length > 20) console.warn('  …(+' + (problems.length - 20) + ' more)');
    }
  }
})();
