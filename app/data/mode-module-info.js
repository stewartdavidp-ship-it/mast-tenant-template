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
    'forecast':           { label: 'Forecast',            section: 'products', tagline: 'Predict inventory needs based on sales velocity.' },
    'jobs':               { label: 'Jobs',                section: 'products', tagline: 'Schedule production runs and batch work.' },
    'procurement':        { label: 'Procurement',         section: 'products', tagline: 'Manage purchase orders and supplier relationships.' },
    'inventory':          { label: 'Inventory',           section: 'products', tagline: 'Track stock levels across products and variants.' },
    'products':           { label: 'Products',            section: 'products', tagline: 'Browse and edit your product catalog.' },
    'develop-products':   { label: 'Develop Products',    section: 'products', tagline: 'Design new products, variants, and SKUs.' },
    'sales-by-product':   { label: 'Sales by Product',    section: 'products', tagline: 'See which products are selling and which aren’t.' },

    // ── Sales ─────────────────────────────────────────────────
    'pos':                { label: 'Point of Sale',       section: 'sales',    tagline: 'Ring up sales in person — phone, tablet, or laptop.' },
    'orders':             { label: 'Retail Orders',       section: 'sales',    tagline: 'View and process incoming customer orders.' },
    'commissions':        { label: 'Custom Orders',       section: 'sales',    tagline: 'Manage custom orders, quotes, and bespoke work.' },
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
    'newsletter':         { label: 'Newsletter',          section: 'marketing', tagline: 'Email your customer list with campaigns and updates.' },
    'stories':            { label: 'Stories',             section: 'marketing', tagline: 'Behind-the-scenes posts that showcase your craft.' },
    'homepage':           { label: 'Page Builder',        section: 'marketing', tagline: 'Customize your storefront homepage layout.' },

    // ── Retention ─────────────────────────────────────────────
    'wallet':             { label: 'Wallet',              section: 'retention', tagline: 'Store credit, points, and pre-paid balances.' },
    'gift-cards':         { label: 'Gift Cards',          section: 'retention', tagline: 'Sell and redeem gift cards.' },
    'coupons':            { label: 'Coupons',             section: 'retention', tagline: 'Discount codes for promotions.' },
    'loyalty':            { label: 'Loyalty',             section: 'retention', tagline: 'Reward repeat customers with points.' },
    'membership':         { label: 'Membership',          section: 'retention', tagline: 'Recurring subscription tiers with member perks.' },
    'promotions':         { label: 'Sale Promotions',     section: 'retention', tagline: 'Run sales and promotional campaigns.' },

    // ── Shows & Markets ───────────────────────────────────────
    'show-find':          { label: 'Find Shows',          section: 'events',   tagline: 'Discover shows, markets, and fairs to apply to.' },
    'show-apply':         { label: 'Apply',               section: 'events',   tagline: 'Submit applications to upcoming shows.' },
    'show-prep':          { label: 'Prep',                section: 'events',   tagline: 'Plan inventory, packing, and logistics for shows.' },
    'show-execute':       { label: 'Execute',             section: 'events',   tagline: 'Run your booth — POS, restocks, traffic notes.' },
    'show-history':       { label: 'Show History',        section: 'events',   tagline: 'Past show records, sales, and lessons learned.' },
    'events-shows':       { label: 'Host Shows',          section: 'events',   tagline: 'Organize your own events as a show host.' },
    'events-settings':    { label: 'Show Settings',       section: 'events',   tagline: 'Configure your event hosting settings.' },

    // ── Bookings & Classes ────────────────────────────────────
    'book':               { label: 'Classes',             section: 'classes',  tagline: 'Schedule classes, workshops, and appointments.' },
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
    'channels':           { label: 'Channels',            section: 'operations', tagline: 'Manage Etsy, Shopify, and other sales channels.' },

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
