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
    'site':             'Site',
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
    'materials': {
      // 2026-05-22 audit: dropped "Reorder reminders for low stock" from
      // automates — reorderThreshold IS stored on each material but is never
      // read to fire a reminder anywhere. Trimmed outcome to match.
      label: 'Materials', section: 'products',
      tagline: 'Track raw materials, suppliers, and unit costs.',
      outcome: "Know exactly what a piece costs to make and keep your reorder thresholds in one place.",
      goodFitWhen: "you buy raw materials in bulk and want true cost-per-piece numbers.",
      notAFitWhen: "you only resell finished goods you don't make.",
      automates: ["Guessing unit cost from invoices", "Calculating material cost per piece", "Re-typing supplier prices into spreadsheets"],
      complementsTools: ["QuickBooks"],
      prerequisites: [],
      pairsWith: ["procurement", "inventory", "jobs", "products", "studio"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'materials.png', alt: "Materials list with cost-per-unit and on-hand quantities" },
      learnMoreUrl: HELP_BASE + 'materials'
    },
    // forecast: card removed 2026-06-06 — retired as a standalone surface; its
    // data is now the Products "Forecast" facet + the product Forecast tab.
    // systemManaged in MODE_ROUTE_VISIBILITY excludes it from this manager.
    'jobs': {
      label: 'Jobs', section: 'products',
      tagline: 'Schedule production runs and batch work.',
      outcome: "Plan what to make this week, see how long each batch takes, and stop double-booking the kiln.",
      goodFitWhen: "you make pieces in batches and need to plan studio time around drying, firing, or curing.",
      notAFitWhen: "every piece is one-off custom work with no batched production.",
      automates: ["Whiteboard schedules that get erased", "Mental math on kiln capacity", "Forgetting which batch needs what step next"],
      complementsTools: ["Google Calendar"],
      prerequisites: ["Products module enabled"],
      pairsWith: ["products", "materials", "inventory", "studio", "team"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'jobs.png', alt: "Production schedule with batch sizes and kiln availability" },
      learnMoreUrl: HELP_BASE + 'jobs'
    },
    'procurement': {
      label: 'Procurement', section: 'products',
      tagline: 'Manage purchase orders and supplier relationships.',
      outcome: "Send POs to suppliers, track what's en route, and have your material costs coded before the invoice lands.",
      goodFitWhen: "you order from more than 2 suppliers and lose track of what's coming and when.",
      notAFitWhen: "you buy your supplies at the craft store as you need them.",
      automates: ["Re-typing supplier orders into email every time", "Tracking what's been ordered vs. delivered", "Hand-keying invoices into QuickBooks"],
      replacesTools: ["Supplier email threads", "Inventory spreadsheet"],
      complementsTools: ["QuickBooks"],
      prerequisites: ["Materials module enabled"],
      pairsWith: ["materials", "inventory", "finance-ap", "contacts"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'procurement.png', alt: "Open purchase orders with expected delivery dates and supplier contacts" },
      learnMoreUrl: HELP_BASE + 'procurement'
    },
    // inventory: card removed 2026-06-06 — retired as a standalone surface; its
    // data is now the Products "Inventory" facet + the product Inventory tab.
    // systemManaged in MODE_ROUTE_VISIBILITY excludes it from this manager.
    'products': {
      label: 'Products', section: 'products',
      tagline: 'Browse and edit your product catalog.',
      outcome: "One place to add a piece, update a price, swap a photo, or mark something sold out — synced everywhere you sell.",
      goodFitWhen: "you sell pieces with names, prices, and photos — i.e., almost everyone.",
      notAFitWhen: "you only do commissions and don't have a stock catalog.",
      automates: ["Re-uploading the same photos to Etsy and Shopify", "Updating prices in 4 places", "Marking sold-outs by hand"],
      replacesTools: ["Etsy listing manager", "Shopify products page", "Square catalog"],
      complementsTools: ["Shopify", "Etsy", "Square"],
      prerequisites: [],
      pairsWith: ["inventory", "channels", "orders", "lookbooks", "pos", "homepage"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'products.png', alt: "Product catalog grid with photos, prices, and channel sync status" },
      learnMoreUrl: HELP_BASE + 'products'
    },
    // develop-products: card removed 2026-06-05. The Develop/Catalog lens split
    // was merged into the single Products surface (Two-View Architecture), so the
    // route has no sidebar item and is no longer user-toggleable. It is marked
    // systemManaged in MODE_ROUTE_VISIBILITY (kept only as a → products alias and
    // for the std↔maker transition diff), which excludes it from this manager.
    // sales-by-product: card removed 2026-06-06 — retired as a standalone surface;
    // its data is now the Products "Sales" facet + the product Sales tab.
    // systemManaged in MODE_ROUTE_VISIBILITY excludes it from this manager.

    // ── Sales ─────────────────────────────────────────────────
    'pos': {
      label: 'Point of Sale', section: 'sales',
      tagline: 'Ring up sales in person — phone, tablet, or laptop.',
      outcome: "Take card and cash payments at the booth or in the studio without juggling Square, Stripe, and a notebook.",
      goodFitWhen: "you sell at markets, in your studio, or to walk-up customers.",
      notAFitWhen: "you only sell online and never take payment in person.",
      automates: ["Switching between Square and your sales notebook", "Updating inventory after each in-person sale", "Reconciling cash vs. card at the end of the day"],
      replacesTools: ["Square POS", "Shopify POS"],
      complementsTools: ["Square reader", "Stripe Terminal"],
      prerequisites: ["Products module enabled"],
      pairsWith: ["products", "inventory", "orders", "receipts", "finance-revenue", "wallet"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'pos.png', alt: "POS checkout screen with cart, payment method selector, and receipt option" },
      learnMoreUrl: HELP_BASE + 'pos'
    },
    'orders': {
      label: 'Retail Orders', section: 'sales',
      tagline: 'View and process incoming customer orders.',
      outcome: "See every order — online, in person, wholesale — in one queue, with what's paid, what's packed, and what's shipped.",
      goodFitWhen: "you take orders from more than one place and want a single inbox.",
      notAFitWhen: "you sell only in person and don't track orders after the sale.",
      automates: ["Hopping between Shopify, Etsy, and Square admin", "Re-typing order info to print labels", "Wondering if you already shipped that piece"],
      complementsTools: ["Shopify", "Etsy", "Square"],
      prerequisites: ["Products module enabled"],
      pairsWith: ["pos", "pack", "ship", "customers", "rma", "wholesale"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'orders.png', alt: "Order queue with status chips for paid, packed, and shipped" },
      learnMoreUrl: HELP_BASE + 'orders'
    },
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
    'rma': {
      label: 'Returns', section: 'sales',
      tagline: 'Process returns, refunds, and replacements.',
      outcome: "Issue a refund or send a replacement in a few clicks, with the inventory and the books updated for you.",
      goodFitWhen: "you take returns and want to stop refunding through Stripe by hand and re-counting stock.",
      notAFitWhen: "your work is final-sale and you never take returns.",
      automates: ["Issuing refunds in the payment processor", "Hand-adjusting inventory after a return", "Tracking RMA shipping labels"],
      complementsTools: ["Stripe", "Square"],
      prerequisites: ["Orders module enabled"],
      pairsWith: ["orders", "ship", "customers", "finance-revenue", "inventory"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'rma.png', alt: "Returns queue with refund and restock actions per RMA" },
      learnMoreUrl: HELP_BASE + 'rma'
    },

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

    'galleries': {
      label: 'Galleries', section: 'sales',
      tagline: 'Track inventory placed on consignment at galleries.',
      outcome: "Know which pieces are at which gallery, when they sold, and what you're owed — without driving over to count shelves.",
      goodFitWhen: "you place work on consignment at galleries, shops, or showrooms.",
      notAFitWhen: "you sell only direct to customers and don't consign anywhere.",
      automates: ["Spreadsheet of which gallery has which piece", "Calling to ask if a piece sold", "Reconciling consignment splits"],
      replacesTools: ["Consignment tracking spreadsheet"],
      complementsTools: ["QuickBooks"],
      prerequisites: ["Products module enabled"],
      pairsWith: ["products", "inventory", "contacts", "finance-ar", "wholesale"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'galleries.png', alt: "Galleries dashboard showing consigned pieces per location and balances owed" },
      learnMoreUrl: HELP_BASE + 'galleries'
    },
    'lookbooks': {
      label: 'Look Books', section: 'sales',
      tagline: 'Generate PDF line sheets and look books for buyers.',
      outcome: "Send a buyer a branded PDF with your current collection and wholesale prices in two minutes, not two hours.",
      goodFitWhen: "you send line sheets to wholesale buyers, galleries, or press contacts.",
      notAFitWhen: "you don't have anyone asking for a line sheet right now.",
      automates: ["Re-doing the line sheet in InDesign for every season", "Manually updating prices on the PDF", "Hunting for the latest photos"],
      replacesTools: ["InDesign line sheets", "Canva templates"],
      complementsTools: ["Canva"],
      prerequisites: ["Products module enabled"],
      pairsWith: ["products", "wholesale", "brand", "blog"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'lookbooks.png', alt: "Line sheet PDF preview with product grid, wholesale prices, and brand header" },
      learnMoreUrl: HELP_BASE + 'lookbooks'
    },
    'pack': {
      label: 'Pack', section: 'sales',
      tagline: 'Pick and pack orders for shipment.',
      outcome: "Pick list, packing slip, and label from one screen — kitchen-table shipping runs take minutes, not hours.",
      goodFitWhen: "you ship more than 5 orders a week and want to stop printing forms from 4 different tabs.",
      notAFitWhen: "you only ship one or two pieces a week and the current flow is fine.",
      automates: ["Hand-writing packing slips", "Pulling pieces in random order", "Printing shipping labels separately"],
      complementsTools: ["ShipStation"],
      prerequisites: ["Orders module enabled"],
      pairsWith: ["orders", "ship", "inventory", "wholesale"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'pack.png', alt: "Pick-and-pack screen with order items, packing slip preview, and print actions" },
      learnMoreUrl: HELP_BASE + 'pack'
    },
    'ship': {
      label: 'Ship', section: 'sales',
      tagline: 'Buy shipping labels and track packages.',
      outcome: "Buy USPS, UPS, and FedEx labels at the best rate, with tracking numbers emailed to your customer automatically.",
      goodFitWhen: "you ship anything beyond an occasional order.",
      notAFitWhen: "you only do local pickup or in-person sales.",
      automates: ["Logging into Pirate Ship for every label", "Copying tracking numbers into emails", "Filing customs forms by hand for international orders"],
      replacesTools: ["Pirate Ship", "Stamps.com", "ShipStation"],
      complementsTools: ["USPS", "UPS", "FedEx"],
      prerequisites: [],
      pairsWith: ["orders", "pack", "rma", "wholesale", "customers"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'ship.png', alt: "Shipping label purchase screen with rate comparison and tracking" },
      learnMoreUrl: HELP_BASE + 'ship'
    },

    // ── Marketing ─────────────────────────────────────────────
    // W2 marketing aggregators. Registered in MODE_ROUTE_VISIBILITY 2026-06-05
    // so they're curatable here (previously matrix-absent → soft-hidden, only
    // reachable via "Show all modules").
    'marketing-calendar': {
      label: 'Calendar', section: 'marketing',
      tagline: 'Plan all your marketing on one calendar.',
      outcome: "See every post, email, and campaign on one calendar so you stop double-booking and going quiet for weeks.",
      goodFitWhen: "you run marketing across more than one channel and lose track of what's going out when.",
      notAFitWhen: "you post occasionally and keep the whole plan in your head.",
      automates: ["Marketing plans scattered across notebooks", "Forgetting to post for two weeks", "Clashing sends on the same day"],
      pairsWith: ["composer", "campaigns", "social", "newsletter", "blog"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'marketing-calendar.png', alt: "Marketing calendar with scheduled posts, emails, and campaigns" },
      learnMoreUrl: HELP_BASE + 'marketing-calendar'
    },
    'composer': {
      label: 'Composer', section: 'marketing',
      tagline: 'Draft posts and emails before they go out.',
      outcome: "Write and stage your posts, captions, and emails in one place instead of jumping between four different tools.",
      goodFitWhen: "you write your own marketing copy and want a single drafting surface.",
      notAFitWhen: "someone else writes all your marketing in their own tools.",
      automates: ["Copy scattered across Notes and DMs", "Re-writing the same blurb per channel", "Lost drafts you can't find later"],
      pairsWith: ["marketing-calendar", "social", "newsletter", "campaigns", "blog"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'composer.png', alt: "Content composer drafting a post with channel options" },
      learnMoreUrl: HELP_BASE + 'composer'
    },
    'engagement-inbox': {
      label: 'Engagement Inbox', section: 'marketing',
      tagline: 'Replies, comments, and reviews in one inbox.',
      outcome: "Catch every reply, comment, and review in one inbox so nothing from a customer slips through unanswered.",
      goodFitWhen: "people reach out across several channels and you want one place to answer them.",
      notAFitWhen: "you only get the occasional message and email already covers it.",
      automates: ["Checking five apps for replies", "Missing a review for days", "Losing a comment in the feed"],
      pairsWith: ["social", "campaigns", "cs-reviews", "cs-inbox"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'engagement-inbox.png', alt: "Unified engagement inbox with replies, comments, and reviews" },
      learnMoreUrl: HELP_BASE + 'engagement-inbox'
    },
    'campaigns': {
      label: 'Campaigns', section: 'marketing',
      tagline: 'Run multi-step marketing campaigns end to end.',
      outcome: "Plan a launch or promotion as a set of timed steps and track how it performed, instead of one-off posts.",
      goodFitWhen: "you run launches or seasonal pushes that span several posts and emails.",
      notAFitWhen: "your marketing is a single channel posted ad hoc.",
      automates: ["Tracking a launch across sticky notes", "Forgetting the follow-up email", "Guessing whether a push worked"],
      pairsWith: ["composer", "marketing-calendar", "newsletter", "social"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'campaigns.png', alt: "Campaign builder showing timed steps across channels" },
      learnMoreUrl: HELP_BASE + 'campaigns'
    },
    'social': {
      // Card rewritten 2026-05-22 to match reality. Original copy sold scheduling
      // + cross-posting (Later/Buffer/Hootsuite replacement) but the module is
      // actually an AI caption + shoot-card generator. Restore the scheduler
      // framing when scheduling/publish ships.
      label: 'Social Media', section: 'marketing',
      tagline: 'AI captions and shoot cards for Instagram.',
      outcome: "Turn your product photos into Instagram-ready captions and shoot cards in seconds — pick your best one and post.",
      goodFitWhen: "you post to Instagram regularly and the bottleneck is writing captions, not deciding when to post.",
      notAFitWhen: "you don't post to social, or you need an actual scheduler that publishes for you.",
      automates: ["Staring at a blank caption box", "Coming up with new caption angles", "Designing shoot cards in Canva"],
      replacesTools: ["ChatGPT for captions", "Canva text overlays"],
      complementsTools: ["Instagram"],
      prerequisites: ["Brand colors and logo set"],
      pairsWith: ["stories", "blog", "newsletter", "images", "homepage"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'social.png', alt: "AI caption generator with product photo and shoot-card options" },
      learnMoreUrl: HELP_BASE + 'social'
    },
    'blog': {
      label: 'Blog', section: 'marketing',
      tagline: 'Publish long-form articles on your website.',
      outcome: "Tell the story behind a piece, a series, or your process — published to your site with good search-engine markup.",
      goodFitWhen: "you have stories to tell about your work and want people to find them on Google.",
      notAFitWhen: "you don't write and don't plan to.",
      automates: ["Editing posts in a separate CMS", "Re-pasting images between Drive and your site", "SEO tags by hand"],
      replacesTools: ["Squarespace blog", "WordPress"],
      complementsTools: ["Newsletter", "Stories"],
      prerequisites: [],
      pairsWith: ["stories", "newsletter", "homepage", "website", "images"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'blog.png', alt: "Blog post editor with featured image, body content, and publish controls" },
      learnMoreUrl: HELP_BASE + 'blog'
    },
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
    'stories': {
      label: 'Stories', section: 'marketing',
      tagline: 'Behind-the-scenes posts that showcase your craft.',
      outcome: "Share short behind-the-scenes posts — a kiln load, a sketch, a market setup — that build a following over time.",
      goodFitWhen: "you want to show your process and don't want to write a full blog post for every moment.",
      notAFitWhen: "you don't want to share anything but the finished work.",
      automates: ["Posting the same photo to 4 platforms", "Forgetting the photos that explain the work"],
      complementsTools: ["Instagram", "Newsletter"],
      prerequisites: [],
      pairsWith: ["blog", "social", "newsletter", "images", "homepage"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'stories.png', alt: "Stories feed with quick post composer and image grid" },
      learnMoreUrl: HELP_BASE + 'stories'
    },
    'homepage': {
      label: 'Page Builder', section: 'site',
      tagline: 'Customize your storefront homepage layout.',
      outcome: "Rearrange your homepage — hero image, featured products, story blocks — without touching code or hiring a designer.",
      goodFitWhen: "you want to refresh your storefront seasonally or test a new layout.",
      notAFitWhen: "your homepage is fine and you don't want to mess with it.",
      automates: ["Asking a designer to swap your hero image", "Re-uploading photos to update featured pieces"],
      replacesTools: ["Squarespace editor", "Wix editor"],
      complementsTools: ["Brand", "Images"],
      prerequisites: ["Brand colors and logo set"],
      pairsWith: ["brand", "images", "products", "blog", "stories", "website"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'homepage.png', alt: "Drag-and-drop homepage builder with section library and live preview" },
      learnMoreUrl: HELP_BASE + 'homepage'
    },

    // ── Retention ─────────────────────────────────────────────
    // secondaryViability (schema, populated 2026-05-28 — D10): per-feature
    // per-platform viability when Mast runs as secondary surface to an external
    // primary site. Tier: 'full' | 'partial' | 'blocked' | 'tbd'. All retention
    // features are Layer-3 (write-back to primary checkout). Sidebar visibility
    // is gated separately via MODE_ROUTE_VISIBILITY.engagementHidden until the
    // Secondary-Mode Viability Matrix Idea ships per-platform adapters.
    'wallet': {
      label: 'Wallet', section: 'retention',
      viabilityLayer: 3,
      secondaryViability: { shopify: 'partial', squarespace: 'blocked', wix: 'blocked', weebly: 'blocked', etsy: 'blocked', default: 'blocked' },
      tagline: 'Store credit, points, and pre-paid balances.',
      outcome: "Give customers store credit from a return, a loyalty bonus, or a deposit — and let them spend it at checkout.",
      goodFitWhen: "you issue refunds as store credit, run a loyalty program, or take deposits.",
      notAFitWhen: "every transaction is a one-time card payment with no credit-back flow.",
      automates: ["Tracking who has store credit on a sticky note", "Manually applying credit at the register"],
      complementsTools: ["Loyalty", "Membership"],
      prerequisites: ["Customers module enabled"],
      pairsWith: ["customers", "loyalty", "gift-cards", "rma", "pos", "membership"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'wallet.png', alt: "Customer wallet balance with credit history and redemption activity" },
      learnMoreUrl: HELP_BASE + 'wallet'
    },
    'gift-cards': {
      label:    'Gift Cards',
      section:  'retention',
      viabilityLayer: 3,
      secondaryViability: { shopify: 'partial', squarespace: 'blocked', wix: 'blocked', weebly: 'blocked', etsy: 'blocked', default: 'blocked' },
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
    'coupons': {
      // 2026-05-22 audit: alt-text + automates overclaimed revenue
      // attribution. Module tracks claim/usage count per code; no per-code
      // revenue surface exists. Trimmed claims to match.
      label: 'Coupons', section: 'retention',
      viabilityLayer: 3,
      secondaryViability: { shopify: 'full', squarespace: 'partial', wix: 'partial', weebly: 'partial', etsy: 'blocked', default: 'partial' },
      tagline: 'Discount codes for promotions.',
      outcome: "Create a discount code in 30 seconds for a holiday sale, a podcast sponsorship, or a friends-and-family run.",
      goodFitWhen: "you run promotions or partner with creators and want to know how many people claimed each code.",
      notAFitWhen: "you never discount your work and don't plan to.",
      automates: ["Tracking codes in a spreadsheet", "Manually adjusting prices at checkout", "Wondering how many people claimed your code"],
      replacesTools: ["Shopify discounts", "Square discounts"],
      complementsTools: ["Newsletter", "Social Media"],
      prerequisites: [],
      pairsWith: ["orders", "pos", "promotions", "newsletter", "customers"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'coupons.png', alt: "Discount code list with claim counts and edit actions" },
      learnMoreUrl: HELP_BASE + 'coupons'
    },
    'loyalty': {
      label:    'Loyalty',
      section:  'retention',
      viabilityLayer: 3,
      secondaryViability: { shopify: 'partial', squarespace: 'blocked', wix: 'blocked', weebly: 'blocked', etsy: 'blocked', default: 'blocked' },
      tagline:  'Reward repeat customers with points.',
      outcome:      "Reward repeat customers with points — set up tier rewards and thresholds in ~10 minutes in Settings.",
      goodFitWhen:  "you have customers who buy more than once a year, and you're up for a short setup to get rewards live.",
      notAFitWhen:  "your work is a one-time purchase (e.g. wedding pieces, large commissions) with no repeat path.",
      automates: [
        "Stamping a paper punch card at the register",
        "Remembering who earned a discount last month",
        "Sending a thank-you to your best customers"
      ],
      replacesTools:    ["Punch cards", "Smile.io", "Yotpo Loyalty"],
      complementsTools: ["Square Loyalty"],
      prerequisites: [
        "Customers module enabled",
        "Loyalty program enabled in Settings after adding"
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
      viabilityLayer: 3,
      secondaryViability: { shopify: 'partial', squarespace: 'blocked', wix: 'blocked', weebly: 'blocked', etsy: 'blocked', default: 'blocked' },
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
    'promotions': {
      label: 'Sale Promotions', section: 'retention',
      viabilityLayer: 3,
      secondaryViability: { shopify: 'full', squarespace: 'partial', wix: 'partial', weebly: 'blocked', etsy: 'blocked', default: 'partial' },
      tagline: 'Run sales and promotional campaigns.',
      outcome: "Run a Black Friday sale, a studio clearance, or a member-only preview without rebuilding prices by hand.",
      goodFitWhen: "you run scheduled sales, BOGO, or tiered discounts more than once a year.",
      notAFitWhen: "you never run sales and stick to one price all year.",
      automates: ["Manually marking down each piece", "Reverting prices at midnight when the sale ends", "Promoting the sale across email and social"],
      replacesTools: ["Shopify promotions", "Square promotions"],
      complementsTools: ["Newsletter", "Social Media"],
      prerequisites: ["Products module enabled"],
      pairsWith: ["products", "coupons", "newsletter", "social", "membership", "orders"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'promotions.png', alt: "Promotion scheduler with discount type, products included, and active window" },
      learnMoreUrl: HELP_BASE + 'promotions'
    },

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
    'show-apply': {
      label: 'Apply', section: 'events',
      tagline: 'Submit applications to upcoming shows.',
      outcome: "Apply to a juried show in 10 minutes — your artist statement, booth photos, and bio are already on file.",
      goodFitWhen: "you apply to more than 2 shows a year and hate retyping the same info.",
      notAFitWhen: "you only do invitational shows that don't require applications.",
      automates: ["Re-typing artist statement for each show", "Hunting for the right booth photos", "Tracking application deadlines"],
      replacesTools: ["ZAPP", "EntryThingy"],
      complementsTools: ["Mast Events"],
      prerequisites: ["Find Shows enabled"],
      pairsWith: ["show-find", "show-prep", "show-execute", "show-history"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'show-apply.png', alt: "Show application form with pre-filled artist statement and photo library" },
      learnMoreUrl: HELP_BASE + 'show-apply'
    },
    'show-prep': {
      label: 'Prep', section: 'events',
      tagline: 'Plan inventory, packing, and logistics for shows.',
      outcome: "A checklist of what to pack, what to make, and what to bring — so you don't leave the racks at home the morning of.",
      goodFitWhen: "you do shows and want to stop scrambling the night before.",
      notAFitWhen: "you don't do shows.",
      automates: ["The shipping crate inventory you do from memory", "Packing-list spreadsheet rebuilt every show", "Forgetting which pieces went to last weekend's show"],
      complementsTools: ["Notion", "Google Sheets"],
      prerequisites: ["Apply or Find Shows enabled"],
      pairsWith: ["show-find", "show-apply", "show-execute", "show-history", "inventory", "jobs"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'show-prep.png', alt: "Show prep checklist with packing list, inventory pull, and logistics" },
      learnMoreUrl: HELP_BASE + 'show-prep'
    },
    'show-execute': {
      label: 'Execute', section: 'events',
      tagline: 'Run your booth — POS, restocks, traffic notes.',
      outcome: "Ring up sales, restock the table, and jot notes on which pieces drew traffic — all from your phone at the booth.",
      goodFitWhen: "you're at the show right now and want a single screen for everything.",
      notAFitWhen: "you don't do shows.",
      automates: ["Juggling Square, a notebook, and your phone at the booth", "Forgetting what sold by Sunday night", "Reconciling cash and card at the end of the show"],
      replacesTools: ["Square POS", "Sales notebook"],
      complementsTools: ["Square reader", "Stripe Terminal"],
      prerequisites: ["Prep enabled", "Products module enabled"],
      pairsWith: ["pos", "show-prep", "show-history", "inventory", "receipts"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'show-execute.png', alt: "Booth-mode POS with quick-add buttons and live inventory" },
      learnMoreUrl: HELP_BASE + 'show-execute'
    },
    'show-history': {
      label: 'Show History', section: 'events',
      tagline: 'Past show records, sales, and lessons learned.',
      outcome: "Look back at last year's shows to decide which to reapply to — sales, traffic, jury fees, and your notes on each one.",
      goodFitWhen: "you've done shows before and want data to decide which to skip this year.",
      notAFitWhen: "this is your first season and you have nothing to look back on yet.",
      automates: ["Trying to remember which show was actually worth it", "Spreadsheet of past shows that never quite stays up to date"],
      complementsTools: ["QuickBooks", "Google Sheets"],
      prerequisites: ["At least one completed show in Execute"],
      pairsWith: ["show-execute", "show-find", "show-apply", "finance-revenue"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'show-history.png', alt: "Show history list with per-show sales, fees, and ROI" },
      learnMoreUrl: HELP_BASE + 'show-history'
    },
    'events-shows': {
      label: 'Host Shows', section: 'events',
      tagline: 'Organize your own events as a show host.',
      outcome: "Run a holiday market, an open studio weekend, or a guest-artist event — applications, booth assignments, the whole flow.",
      goodFitWhen: "you host events at your studio or organize a market.",
      notAFitWhen: "you only attend shows; you don't run them.",
      automates: ["Vendor applications in Google Forms", "Booth map drawn on a napkin", "Collecting booth fees via Venmo"],
      replacesTools: ["Eventbrite for hosting", "Google Forms applications"],
      complementsTools: ["Mast Events"],
      prerequisites: ["Mast Events account"],
      pairsWith: ["events-settings", "show-find", "calendar", "studio", "contacts"],
      setupDepth: "heavy",
      preview: { url: ASSET_BASE + 'events-shows.png', alt: "Hosted-show dashboard with applications, booth map, and vendor list" },
      learnMoreUrl: HELP_BASE + 'events-shows'
    },
    'events-settings': {
      label: 'Show Settings', section: 'events',
      tagline: 'Configure your event hosting settings.',
      outcome: "Set application fees, booth pricing, and the rules of your hosted events once — they apply across every show you run.",
      goodFitWhen: "you host shows and want consistent fees and policies across them.",
      notAFitWhen: "you don't host shows.",
      automates: ["Re-typing booth fees and policies per show", "Inconsistent application questions across events"],
      prerequisites: ["Host Shows enabled"],
      pairsWith: ["events-shows", "terms", "brand"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'events-settings.png', alt: "Event hosting defaults: fees, deadlines, contract template" },
      learnMoreUrl: HELP_BASE + 'events-settings'
    },

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
    'calendar': {
      label: 'Schedule', section: 'classes',
      tagline: 'View all upcoming bookings in calendar form.',
      outcome: "See every class, workshop, and appointment in one calendar — week, month, or instructor view.",
      goodFitWhen: "you teach more than 2 classes a week and want a calendar that updates itself.",
      notAFitWhen: "you teach one workshop a quarter and Google Calendar is fine.",
      automates: ["Manually mirroring class schedule into Google Calendar", "Double-booking the same room"],
      complementsTools: ["Google Calendar", "iCal"],
      prerequisites: ["Classes module enabled"],
      pairsWith: ["book", "enrollments", "resources", "instructors", "students"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'calendar.png', alt: "Calendar view with classes, workshops, and appointments by week" },
      learnMoreUrl: HELP_BASE + 'calendar'
    },
    'enrollments': {
      label: 'Enrollments', section: 'classes',
      tagline: 'Track student enrollments per class.',
      outcome: "Roster, waitlist, paid/unpaid status, and dietary or accessibility notes for every class — in one place.",
      goodFitWhen: "you run classes with paid enrollments and need to know who's coming on Saturday.",
      notAFitWhen: "you don't teach.",
      automates: ["Hand-keying signups into a spreadsheet", "Cross-checking who paid against who showed up", "Re-doing the waitlist email each week"],
      complementsTools: ["Mailchimp"],
      prerequisites: ["Classes module enabled"],
      pairsWith: ["book", "students", "passes", "calendar", "book-reports"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'enrollments.png', alt: "Class roster with paid status, waitlist, and student notes" },
      learnMoreUrl: HELP_BASE + 'enrollments'
    },
    'passes': {
      // 2026-05-22 audit: the module is a CRUD list of pass DEFINITIONS
      // (name, type, price, visits, validity). Per-student balance + punch
      // ledger surfaces aren't built in admin yet. Redemption may be in
      // cart.js checkout but no admin tally view exists. Softened outcome
      // + dropped the "active balances per student" alt-text claim.
      label: 'Class Passes', section: 'classes',
      tagline: 'Multi-class pass and punch-card pricing.',
      outcome: "Sell a 5-class pass or a monthly studio pass — define pricing and visit counts here, sold at checkout.",
      goodFitWhen: "you offer bundled class pricing and want a price list students can buy from.",
      notAFitWhen: "you only sell single-class drop-ins.",
      automates: ["Setting pass prices on a price sheet you re-print", "Re-pricing every season"],
      replacesTools: ["MindBody pass definitions"],
      complementsTools: ["Membership", "Wallet"],
      prerequisites: ["Classes module enabled"],
      pairsWith: ["book", "students", "wallet", "membership", "enrollments"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'passes.png', alt: "Pass types with price, visit count, validity, and active status" },
      learnMoreUrl: HELP_BASE + 'passes'
    },
    'resources': {
      label: 'Rooms & Equipment', section: 'classes',
      tagline: 'Manage rooms, equipment, and instructor time slots.',
      outcome: "Make sure two classes aren't fighting over the same kiln, wheel, or instructor — bookings check availability for you.",
      goodFitWhen: "you have shared studio gear or rooms and want to stop overbooking.",
      notAFitWhen: "you teach in one room with no shared gear.",
      automates: ["Double-checking the kiln calendar before scheduling", "Asking the other instructor if their slot is free", "Cancelling a class when the room turns out to be booked"],
      prerequisites: ["Classes module enabled"],
      pairsWith: ["book", "calendar", "instructors", "studio", "jobs"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'resources.png', alt: "Resource calendar showing rooms and equipment availability across classes" },
      learnMoreUrl: HELP_BASE + 'resources'
    },
    'students': {
      label: 'Students', section: 'classes',
      tagline: 'Student database with class history.',
      outcome: "See every class a student has taken, what they've paid, and which they no-showed — in one record.",
      goodFitWhen: "you teach repeat students and want to know them by name without a notebook.",
      notAFitWhen: "you teach one-off workshops and don't track who returns.",
      automates: ["Looking up a student's history in past spreadsheets", "Forgetting if they prefer wheel or handbuilding", "Re-asking allergies every session"],
      prerequisites: ["Classes module enabled"],
      pairsWith: ["enrollments", "book", "passes", "customers", "calendar"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'students.png', alt: "Student profile with class history, payment record, and notes" },
      learnMoreUrl: HELP_BASE + 'students'
    },
    'instructors': {
      // 2026-05-22 audit: removed "running tally of what you owe them" — the
      // module stores payRateCents but doesn't tally payouts anywhere.
      // Restore the tally framing when that surface ships.
      label: 'Instructors', section: 'classes',
      tagline: 'Manage instructor profiles and pay rates.',
      outcome: "Track which classes each instructor teaches and store their pay rate — payouts stay a manual export today.",
      goodFitWhen: "you have guest instructors or assistant teachers and need a single place for their rate + assignments.",
      notAFitWhen: "you're the only instructor.",
      automates: ["Tracking which class each instructor taught", "Remembering pay-rate agreements"],
      complementsTools: ["QuickBooks"],
      prerequisites: ["Classes module enabled"],
      pairsWith: ["book", "team", "resources", "book-reports", "finance-ap"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'instructors.png', alt: "Instructor profiles with assigned classes and pay rate" },
      learnMoreUrl: HELP_BASE + 'instructors'
    },
    'book-reports': {
      label: 'Class Reports', section: 'classes',
      tagline: 'Attendance and revenue reports for classes.',
      outcome: "See which classes fill, which lose money, and which instructors drive repeat students — without rebuilding the report.",
      goodFitWhen: "you teach more than 5 classes a month and want to know what's working.",
      notAFitWhen: "you teach a single workshop occasionally.",
      automates: ["Tallying attendance from sign-in sheets", "Calculating per-class revenue and instructor cost", "Guessing which class to repeat next season"],
      complementsTools: ["QuickBooks"],
      prerequisites: ["Classes module enabled", "At least one completed class with enrollments"],
      pairsWith: ["book", "enrollments", "instructors", "finance-revenue", "customer-portfolio"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'book-reports.png', alt: "Class performance dashboard with fill rate, revenue, and repeat-rate" },
      learnMoreUrl: HELP_BASE + 'book-reports'
    },

    // ── Finance ───────────────────────────────────────────────
    // financials: the W2.1 Finance "Overview" dashboard. Registered in
    // MODE_ROUTE_VISIBILITY 2026-06-05 so it's curatable here.
    'financials': {
      label: 'Overview', section: 'finance',
      tagline: 'One dashboard for revenue, costs, and cash.',
      outcome: "Open one screen for how the business is doing this month — revenue, costs, and cash — without digging through reports.",
      goodFitWhen: "you want a quick financial pulse without opening every finance report.",
      notAFitWhen: "you only ever look at one specific report and skip the rest.",
      automates: ["Opening five reports to get one picture", "Re-totaling the month by hand", "Guessing where the money went"],
      pairsWith: ["finance-revenue", "finance-expenses", "finance-pl", "finance-cash-flow", "finance-reports"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'financials.png', alt: "Finance overview dashboard with revenue, cost, and cash summary cards" },
      learnMoreUrl: HELP_BASE + 'financials'
    },
    'finance-pl': {
      label: 'Profit & Loss', section: 'finance',
      tagline: 'Profit & loss statements and trend analysis.',
      outcome: "See if you actually made money this month — revenue minus the real cost of materials, labor, and overhead.",
      goodFitWhen: "you want to know your real profit, not just your revenue.",
      notAFitWhen: "your bookkeeper handles all reporting and you don't look at it in-app.",
      automates: ["Building P&L in a spreadsheet from scratch", "Forgetting to deduct material cost from gross sales", "Comparing months by eyeball"],
      replacesTools: ["QuickBooks P&L"],
      complementsTools: ["QuickBooks"],
      prerequisites: ["At least 30 days of sales + expenses data"],
      pairsWith: ["finance-revenue", "finance-expenses", "finance-cash-flow", "finance-reports", "materials"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'finance-pl.png', alt: "Profit & loss statement with month-over-month trend chart" },
      learnMoreUrl: HELP_BASE + 'finance-pl'
    },
    'finance-period-close': {
      label: 'Period Close', section: 'finance',
      tagline: 'Close each month so the books stop moving.',
      outcome: "Lock a finished month — daily drawer counts roll into one closed period your accountant can trust.",
      goodFitWhen: "you count the drawer (or want to start) and want month-end to be a button, not a weekend.",
      notAFitWhen: "you don't reconcile cash and your accountant closes the books for you elsewhere.",
      automates: ["Month-end spreadsheet roll-ups of daily counts", "Last month's numbers quietly changing after you sent them"],
      complementsTools: ["QuickBooks", "your accountant"],
      prerequisites: ["Receipts module enabled"],
      pairsWith: ["receipts", "finance-cash-flow", "finance-amendments"],
      setupDepth: "moderate",
      learnMoreUrl: HELP_BASE + 'finance-period-close'
    },
    'finance-amendments': {
      label: 'Amendments', section: 'finance',
      tagline: 'Fix mistakes in closed months without rewriting history.',
      outcome: "Fix an error found after close: approve the correction and a dated counter-entry lands in the open month.",
      goodFitWhen: "you close your months and occasionally find a late return or mis-entered sale afterward.",
      notAFitWhen: "you aren't closing periods yet — turn on Period Close first.",
      automates: ["Quiet edits to last month's numbers nobody can trace", "Email threads with your accountant about \"that one fix\""],
      complementsTools: ["your accountant"],
      prerequisites: ["Period Close enabled"],
      pairsWith: ["finance-period-close"],
      setupDepth: "quick",
      learnMoreUrl: HELP_BASE + 'finance-amendments'
    },
    'finance-cash-flow': {
      // 2026-05-22 audit: Cash on Hand reads from Plaid; shows "—" until
      // bank connected. Added Plaid prereq.
      label: 'Cash Flow', section: 'finance',
      tagline: 'Cash flow tracking and projections.',
      outcome: "See what's actually in the bank this week vs. what you'll owe — so you don't get blindsided by a quiet month.",
      goodFitWhen: "your income has slow seasons and you want a heads-up before things get tight.",
      notAFitWhen: "you have plenty of runway and don't track cash by week.",
      automates: ["Mental math on \"can I afford this kiln repair right now\"", "Surprise overdraft after a slow week"],
      complementsTools: ["QuickBooks", "your bank"],
      prerequisites: ["Receipts module enabled", "Bank account connected via Plaid (in Expenses)"],
      pairsWith: ["finance-revenue", "finance-expenses", "finance-ap", "finance-ar", "receipts"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'finance-cash-flow.png', alt: "Cash flow chart with weekly in/out and projected balance" },
      learnMoreUrl: HELP_BASE + 'finance-cash-flow'
    },
    'finance-ar': {
      label: 'Accounts Receivable', section: 'finance',
      tagline: 'Money owed to you by customers and accounts.',
      outcome: "Know exactly which wholesale invoices are overdue, by how much, and get a one-click nudge sent to the buyer.",
      goodFitWhen: "you invoice anyone — wholesale buyers, galleries, commissioners — and have to chase payment.",
      notAFitWhen: "every sale is paid up front and you never invoice.",
      automates: ["Tracking who owes what in a notebook", "Writing the same \"just checking in\" email", "Forgetting that 60-day-overdue invoice"],
      replacesTools: ["QuickBooks A/R aging"],
      complementsTools: ["QuickBooks", "Stripe Invoices"],
      prerequisites: [],
      pairsWith: ["wholesale", "commissions", "galleries", "customers", "finance-revenue", "finance-cash-flow"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'finance-ar.png', alt: "Open invoices grouped by aging bucket with quick-nudge actions" },
      learnMoreUrl: HELP_BASE + 'finance-ar'
    },
    'finance-ap': {
      label: 'Accounts Payable', section: 'finance',
      tagline: 'Bills and supplier invoices.',
      outcome: "See every bill you owe — rent, suppliers, contractors — sorted by due date, so nothing slips and nothing pays twice.",
      goodFitWhen: "you have monthly bills or supplier invoices beyond a couple of subscriptions.",
      notAFitWhen: "your expenses are all swiped on a card and there's nothing to track.",
      automates: ["Stacking bills on the desk", "Forgetting which supplier you already paid", "Late fees from missed due dates"],
      replacesTools: ["QuickBooks A/P"],
      complementsTools: ["QuickBooks", "Bill.com"],
      prerequisites: [],
      pairsWith: ["procurement", "contacts", "finance-cash-flow", "finance-expenses", "team"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'finance-ap.png', alt: "Bills queue sorted by due date with paid/unpaid status" },
      learnMoreUrl: HELP_BASE + 'finance-ap'
    },
    'finance-reports': {
      label: 'Financial Reports', section: 'finance',
      tagline: 'Tax-ready reports and ledger exports.',
      outcome: "Hand your accountant a clean P&L, ledger, and sales-tax summary at year-end — no spreadsheet wrangling.",
      goodFitWhen: "you work with an accountant or file your own taxes and want clean numbers.",
      notAFitWhen: "your bookkeeper handles everything and exports from QuickBooks directly.",
      automates: ["Rebuilding tax summaries in a spreadsheet", "Exporting and stitching reports from 3 tools", "Emailing screenshots to your accountant"],
      complementsTools: ["QuickBooks", "TurboTax"],
      prerequisites: ["At least 30 days of sales + expenses data"],
      pairsWith: ["finance-pl", "finance-revenue", "finance-expenses", "finance-tax", "auditlog"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'finance-reports.png', alt: "Year-end report bundle with P&L, ledger, and tax summary export buttons" },
      learnMoreUrl: HELP_BASE + 'finance-reports'
    },
    'customer-portfolio': {
      label: 'Customer Portfolio', section: 'finance',
      tagline: 'Per-customer revenue and lifetime value.',
      outcome: "See who your top 20 buyers are by lifetime spend, and which used to buy but haven't in a while.",
      goodFitWhen: "you have repeat customers and want to focus marketing on the ones who actually spend.",
      notAFitWhen: "almost every sale is a one-time stranger and there's no repeat pattern.",
      automates: ["Sorting customers by spend in a spreadsheet", "Trying to remember who your best buyers are", "Missing the cue when a regular goes quiet"],
      complementsTools: ["QuickBooks", "Mailchimp"],
      prerequisites: ["Customers module enabled"],
      pairsWith: ["customers", "newsletter", "loyalty", "finance-revenue", "cs-members"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'customer-portfolio.png', alt: "Top customers ranked by lifetime spend with lapsed-buyer alerts" },
      learnMoreUrl: HELP_BASE + 'customer-portfolio'
    },

    // ── Operations ────────────────────────────────────────────
    'trips': {
      label: 'Trips', section: 'operations',
      tagline: 'Track delivery trips and business mileage.',
      outcome: "Log a delivery, a supply run, or a show drive in 10 seconds — and get an IRS-ready mileage report at year-end.",
      goodFitWhen: "you drive for business and want to claim the standard mileage deduction.",
      notAFitWhen: "you don't drive for business or don't claim mileage.",
      automates: ["The mileage notebook in the glovebox", "Adding up trips at year-end", "Forgetting that supply run last March"],
      replacesTools: ["MileIQ", "Everlance"],
      complementsTools: ["QuickBooks"],
      prerequisites: [],
      pairsWith: ["finance-expenses", "ship", "events-shows", "show-execute"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'trips.png', alt: "Trip log with miles, purpose, and per-trip deductible amount" },
      learnMoreUrl: HELP_BASE + 'trips'
    },
    'reports': {
      // Card softened 2026-05-22: the underlying module currently shows
      // "feature on roadmap" — copy now matches reality. Restore the
      // value-prop framing (automates, replacesTools) when the report
      // builder actually ships.
      label: 'Reports', section: 'operations',
      tagline: 'Cross-section reports — coming soon.',
      outcome: "Coming soon: a report builder for slow sellers, top customers, and fulfillment time. Add it now to be early.",
      goodFitWhen: "you want answers a spreadsheet won't easily give — and don't mind waiting for the build.",
      notAFitWhen: "you need reporting today — the per-section reports already cover most of what you need.",
      prerequisites: [],
      pairsWith: ["finance-reports", "sales-by-product", "book-reports", "show-history", "customer-portfolio"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'reports.png', alt: "Report builder coming-soon placeholder" },
      learnMoreUrl: HELP_BASE + 'reports'
    },
    'advisor': {
      // 2026-05-22 audit: the advisor view is hollow until a business plan
      // is built in Claude Chat (external). Added the Claude Chat prereq +
      // adjusted goodFitWhen to set expectations.
      label: 'Business Plan', section: 'operations',
      tagline: 'AI business plan and growth recommendations.',
      outcome: "Build your plan in Claude Chat once; this view surfaces and tracks it alongside your real sales and costs.",
      goodFitWhen: "you want a second opinion on what to focus on next quarter, and you'll spend an hour with Claude Chat to set it up.",
      notAFitWhen: "you already work with a business coach or have a clear plan.",
      automates: ["Wondering if you should raise prices", "Guessing which channel to invest in", "Building a business plan in a doc nobody reads"],
      complementsTools: ["ChatGPT", "Claude"],
      prerequisites: ["At least 60 days of data", "Business plan created in Claude Chat"],
      pairsWith: ["finance-pl", "sales-by-product", "customer-portfolio", "show-history", "channels"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'advisor.png', alt: "AI advisor chat with current recommendations and supporting metrics" },
      learnMoreUrl: HELP_BASE + 'advisor'
    },
    'studio': {
      label: 'Studio', section: 'operations',
      tagline: 'Configure studio locations and equipment.',
      outcome: "Set up your studio address, hours, kilns, wheels, and shared gear — everything else that needs them inherits it.",
      goodFitWhen: "you have a physical studio with gear other features need to know about.",
      notAFitWhen: "you work from a single room with one tool and no scheduling.",
      automates: ["Re-entering the address on every invoice", "Manually keeping resource lists in sync"],
      prerequisites: [],
      pairsWith: ["resources", "jobs", "team", "calendar", "events-shows"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'studio.png', alt: "Studio profile with location, hours, and equipment list" },
      learnMoreUrl: HELP_BASE + 'studio'
    },
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

    'mapping': {
      label:    'Channel Mapping',
      section:  'operations',
      tagline:  'Match every channel listing to one product record.',
      outcome:      "Every channel listing is matched to one product record, so your catalog reconciles to a single source of truth.",
      goodFitWhen:  "you have the same piece listed on more than one channel and want one place that knows they're the same product.",
      notAFitWhen:  "Mast is your only storefront and there are no external listings to map.",
      automates: [
        "Matching Etsy listings to Shopify products by hand",
        "Spotting unmapped or duplicate listings by eye"
      ],
      replacesTools:    ["Cross-channel SKU spreadsheets"],
      complementsTools: ["Etsy", "Shopify"],
      prerequisites: [
        "Channels module enabled",
        "At least one connected external channel"
      ],
      pairsWith:  ["channels", "products", "inventory"],
      setupDepth: "moderate",
      preview: {
        url: ASSET_BASE + 'mapping.png',
        alt: "Channel mapping screen showing listings matched to canonical products across Etsy and Shopify"
      },
      learnMoreUrl: HELP_BASE + 'mapping'
    },

    'audit': {
      label:    'Channel Audit',
      section:  'operations',
      tagline:  'Cross-channel checkups on listings, pricing, and stock.',
      outcome:      "Catch cross-channel drift — mismatched prices, stale syncs, diverging stock — before it costs a sale.",
      goodFitWhen:  "you sell the same products on more than one channel and want them kept consistent.",
      notAFitWhen:  "Mast is your only sales channel, so there's nothing to reconcile across.",
      automates: [
        "Eyeballing each channel for price or stock gaps",
        "Hunting for listings that drifted out of sync"
      ],
      replacesTools:    ["Manual channel spot-checks"],
      complementsTools: ["Etsy", "Shopify"],
      prerequisites: [
        "Channels module enabled",
        "At least one connected external channel"
      ],
      pairsWith:  ["channels", "mapping", "products", "inventory"],
      setupDepth: "quick",
      preview: {
        url: ASSET_BASE + 'audit.png',
        alt: "Channel Audit dashboard grouping cross-channel findings by impact"
      },
      learnMoreUrl: HELP_BASE + 'audit'
    },

    // ── Customer Service ──────────────────────────────────────
    'cs-inbox': {
      label: 'Inbox', section: 'customer-service',
      tagline: 'Customer messages and email inquiries.',
      outcome: "One inbox for customer emails, shop-page contact forms, and DMs — with order context attached to each thread.",
      goodFitWhen: "you answer customer questions across email, your site, and social.",
      notAFitWhen: "you handle everything in personal email and it's working.",
      automates: ["Switching between Gmail and your shop's contact form", "Re-typing order numbers to look them up", "Losing track of which DM you already replied to"],
      replacesTools: ["Help Scout", "Front", "Gmail labels"],
      complementsTools: ["Gmail", "Instagram"],
      prerequisites: [],
      pairsWith: ["cs-tickets", "customers", "orders", "cs-faqs"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'cs-inbox.png', alt: "Unified inbox with email, contact form, and DM threads with order context" },
      learnMoreUrl: HELP_BASE + 'cs-inbox'
    },
    'cs-tickets': {
      label: 'Tickets', section: 'customer-service',
      tagline: 'Support ticket queue and resolution tracking.',
      outcome: "Turn a customer question into a tracked ticket so it doesn't fall through the cracks while you're shipping orders.",
      goodFitWhen: "you handle more than 5 customer issues a week and want a queue, not a to-do list in your head.",
      notAFitWhen: "your customer issues are rare and email is enough.",
      automates: ["Tracking open issues in your inbox", "Forgetting to circle back on a refund request", "Wondering if you already replied"],
      replacesTools: ["Zendesk", "Help Scout"],
      complementsTools: ["Gmail"],
      prerequisites: [],
      pairsWith: ["cs-inbox", "rma", "orders", "customers", "cs-faqs"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'cs-tickets.png', alt: "Ticket queue with priority, status, and last-touch time" },
      learnMoreUrl: HELP_BASE + 'cs-tickets'
    },
    'cs-surveys': {
      label: 'Surveys', section: 'customer-service',
      tagline: 'Send post-purchase surveys to customers.',
      outcome: "A simple \"how was it\" email after each order or class, with the answers in one dashboard you can actually scan.",
      goodFitWhen: "you want to know what customers think and you'd never get around to typing the emails yourself.",
      notAFitWhen: "you already get plenty of unprompted feedback.",
      automates: ["Crafting individual follow-up emails", "Reading reviews scattered across Etsy, Google, and email", "Wondering why someone didn't come back"],
      replacesTools: ["SurveyMonkey", "Typeform", "Google Forms"],
      complementsTools: ["Mailchimp"],
      prerequisites: ["Customers module enabled"],
      pairsWith: ["customers", "cs-reviews", "cs-tickets", "newsletter", "orders"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'cs-surveys.png', alt: "Survey response dashboard with NPS, comments, and trend over time" },
      learnMoreUrl: HELP_BASE + 'cs-surveys'
    },
    'cs-reviews': {
      label: 'Reviews', section: 'customer-service',
      tagline: 'Customer reviews and ratings management.',
      outcome: "Collect reviews on your storefront and surface the good ones on product pages — without paying a SaaS for it.",
      goodFitWhen: "you sell pieces where buyer reviews would help future buyers.",
      notAFitWhen: "your work is one-of-a-kind and reviews don't carry across to new pieces.",
      automates: ["Manually quoting testimonials in product copy", "Asking Etsy for review exports", "Tracking complaints across email and DMs"],
      replacesTools: ["Yotpo", "Trustpilot embeds"],
      complementsTools: ["Google reviews"],
      prerequisites: ["Products module enabled"],
      pairsWith: ["products", "cs-surveys", "customers", "homepage", "cs-tickets"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'cs-reviews.png', alt: "Reviews dashboard with star rating, response actions, and product link" },
      learnMoreUrl: HELP_BASE + 'cs-reviews'
    },
    'cs-faqs': {
      label: 'FAQs', section: 'customer-service',
      tagline: 'Self-service knowledge base.',
      outcome: "Write the answer once, link to it from your inbox and storefront — stop typing the same shipping policy 10 times.",
      goodFitWhen: "you keep typing the same answer about shipping, returns, or class policies.",
      notAFitWhen: "every customer question is unique and a knowledge base wouldn't help.",
      automates: ["Re-typing common answers", "Pointing customers to a Notion page that's out of date", "Forgetting to update FAQs when policy changes"],
      complementsTools: ["Notion", "Help Scout"],
      prerequisites: [],
      pairsWith: ["cs-inbox", "cs-tickets", "terms", "website", "homepage"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'cs-faqs.png', alt: "FAQ list with categories, view counts, and edit actions" },
      learnMoreUrl: HELP_BASE + 'cs-faqs'
    },
    'cs-members': {
      label: 'Members', section: 'customer-service',
      tagline: 'Member directory and lifecycle tracking.',
      outcome: "See your active members, their tier, how long they've been with you, and who's about to churn — before they do.",
      goodFitWhen: "you run a membership program and want to keep good members from quietly leaving.",
      notAFitWhen: "you don't have a membership program.",
      automates: ["Pulling member lists from Stripe by hand", "Missing the cue when a member stops engaging", "Renewal reminders by memory"],
      complementsTools: ["Stripe"],
      prerequisites: ["Membership module enabled"],
      pairsWith: ["membership", "customers", "wallet", "newsletter", "customer-portfolio"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'cs-members.png', alt: "Members directory with tier, tenure, and churn-risk score" },
      learnMoreUrl: HELP_BASE + 'cs-members'
    },

    // ── Always-on (informational only; no toggle button) ──────
    // Sales (always-on)
    'receipts': {
      label: 'Receipts', section: 'sales',
      tagline: 'Match payouts and reconcile receipts.',
      outcome: "See which sales are tied to which Stripe payout, and catch fees, refunds, or missing transfers before they trip you up.",
      goodFitWhen: "this is on for everyone — every shop needs to reconcile payouts to sales.",
      automates: ["Cross-checking the Stripe dashboard against your sales", "Hunting for which sale a payout came from"],
      complementsTools: ["Stripe", "Square", "QuickBooks"],
      pairsWith: ["orders", "pos", "finance-revenue", "finance-cash-flow"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'receipts.png', alt: "Payout reconciliation view with matched sales and fee breakdown" },
      learnMoreUrl: HELP_BASE + 'receipts'
    },
    'terms': {
      label: 'Terms & Conditions', section: 'sales',
      tagline: 'Storefront legal copy and policies.',
      outcome: "Your shipping, returns, and privacy policies in one place, linked from your storefront footer and checkout flow.",
      goodFitWhen: "this is on for everyone — every storefront needs published terms.",
      automates: ["Copy-pasting policies into separate pages", "Forgetting to update the privacy page when you change a tool"],
      pairsWith: ["website", "homepage", "rma", "membership"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'terms.png', alt: "Editable terms pages with versioning and last-updated dates" },
      learnMoreUrl: HELP_BASE + 'terms'
    },
    'commission-terms': {
      label: 'Commission Terms', section: 'sales',
      tagline: 'Versioned terms for custom-order work.',
      outcome: "Publish the terms customers accept when commissioning work — versioned, so each order points at the exact terms agreed.",
      goodFitWhen: "you take commissions or custom orders and want the agreement in writing.",
      notAFitWhen: "you only sell ready-made inventory.",
      automates: ["Re-attaching the latest terms to every quote", "Wondering which terms an old commission agreed to"],
      pairsWith: ["commissions", "terms", "orders"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'commission-terms.png', alt: "Versioned commission terms with draft and published states" },
      learnMoreUrl: HELP_BASE + 'commission-terms'
    },
    // Marketing (always-on)
    'website': {
      label: 'Website Content', section: 'site',
      tagline: 'Public-facing storefront pages and copy.',
      outcome: "Edit your About page, contact info, and storefront copy without filing a ticket or learning HTML.",
      goodFitWhen: "this is on for everyone — every storefront has pages that need updating.",
      automates: ["Asking a developer to change a phone number", "Re-uploading the About page after a typo"],
      pairsWith: ["homepage", "brand", "terms", "blog"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'website.png', alt: "Page editor with About, Contact, and Policies entries" },
      learnMoreUrl: HELP_BASE + 'website'
    },
    'brand': {
      label: 'Brand', section: 'site',
      tagline: 'Logo, colors, fonts, and brand identity.',
      outcome: "Set your colors, logo, and fonts once — they flow into your storefront, line sheets, emails, and packing slips.",
      goodFitWhen: "this is on for everyone — every shop has a brand identity, even a simple one.",
      automates: ["Re-uploading the logo to 5 different tools", "Choosing brand colors from memory each time"],
      pairsWith: ["homepage", "lookbooks", "newsletter", "images", "website"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'brand.png', alt: "Brand editor with logo upload, color palette, and font picker" },
      learnMoreUrl: HELP_BASE + 'brand'
    },
    'images': {
      label: 'Images', section: 'site',
      tagline: 'Image library and asset management.',
      outcome: "One library for every photo — products, process, behind-the-scenes — no more hunting through folders for a shot.",
      goodFitWhen: "this is on for everyone — every shop has photos to organize.",
      automates: ["Hunting through Drive folders for a product shot", "Re-uploading the same image to 4 places"],
      pairsWith: ["products", "homepage", "blog", "social", "stories", "lookbooks"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'images.png', alt: "Image library grid with tags and usage counts per asset" },
      learnMoreUrl: HELP_BASE + 'images'
    },
    // Finance (always-on)
    'finance-revenue': {
      label: 'Revenue', section: 'finance',
      tagline: 'Revenue tracking and trend reports.',
      outcome: "See what came in today, this week, this month — broken out by channel, product, and customer type.",
      goodFitWhen: "this is on for everyone — every shop needs to see top-line revenue.",
      automates: ["Adding up sales by hand from 4 channels", "Comparing this month to last by memory"],
      complementsTools: ["QuickBooks"],
      pairsWith: ["orders", "pos", "wholesale", "finance-pl", "channels"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'finance-revenue.png', alt: "Revenue dashboard with channel breakdown and trend chart" },
      learnMoreUrl: HELP_BASE + 'finance-revenue'
    },
    'finance-expenses': {
      label: 'Expenses', section: 'finance',
      tagline: 'Expense entry and categorization.',
      outcome: "Log a receipt with a photo, tag it to the right category, and have it ready for taxes without a year-end scramble.",
      goodFitWhen: "this is on for everyone — every business has expenses to track.",
      automates: ["The shoebox of receipts", "Re-typing receipts into QuickBooks", "Guessing categories at year-end"],
      complementsTools: ["QuickBooks", "Expensify"],
      pairsWith: ["finance-ap", "finance-pl", "trips", "team", "studio"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'finance-expenses.png', alt: "Expense entry with receipt photo and category dropdown" },
      learnMoreUrl: HELP_BASE + 'finance-expenses'
    },
    'finance-tax': {
      label: 'Tax', section: 'finance',
      tagline: 'Sales tax configuration and remittance reports.',
      outcome: "Collect the right sales tax per state, county, or city — and get a clean remittance report when it's time to file.",
      goodFitWhen: "this is on for everyone — every shop has sales tax to handle, even if just one state.",
      automates: ["Looking up tax rates per state", "Building remittance reports by hand", "Forgetting to register in a new state when you cross nexus"],
      complementsTools: ["TaxJar", "Avalara", "QuickBooks"],
      pairsWith: ["orders", "pos", "finance-revenue", "finance-reports", "business"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'finance-tax.png', alt: "Sales tax dashboard with per-state rates and remittance due dates" },
      learnMoreUrl: HELP_BASE + 'finance-tax'
    },
    // Operations (always-on)
    'contacts': {
      label: 'Contacts', section: 'operations',
      tagline: 'Contact database for non-customer relationships.',
      outcome: "One place for suppliers, instructors, press, jurors, and everyone else who isn't a customer but matters.",
      goodFitWhen: "this is on for everyone — every shop has non-customer relationships to track.",
      automates: ["Hunting through email for a supplier's phone number", "Forgetting which juror you met at which show"],
      pairsWith: ["customers", "procurement", "galleries", "instructors", "team"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'contacts.png', alt: "Contacts list with tags for supplier, juror, press, and partner" },
      learnMoreUrl: HELP_BASE + 'contacts'
    },
    'customers': {
      label: 'Customers', section: 'operations',
      tagline: 'Customer database, lifecycle, and history.',
      outcome: "Every customer with their orders, classes, wallet balance, and notes — without piecing it together from 5 tools.",
      goodFitWhen: "this is on for everyone — every shop has customers to remember.",
      automates: ["Looking up past orders in Shopify and Etsy separately", "Forgetting that customer is also a student"],
      complementsTools: ["Mailchimp", "QuickBooks"],
      pairsWith: ["orders", "students", "wallet", "newsletter", "loyalty", "customer-portfolio"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'customers.png', alt: "Customer profile with orders, classes, wallet, and contact history" },
      learnMoreUrl: HELP_BASE + 'customers'
    },
    'team': {
      label: 'Team', section: 'operations',
      tagline: 'Team members, roles, and time tracking.',
      outcome: "Add a helper, an apprentice, or a contract bookkeeper — set what they can see, track their hours, pay them right.",
      goodFitWhen: "this is on for everyone — even solo shops who hire a part-time helper.",
      automates: ["Sharing your password to give someone access", "Tracking helper hours on a notepad", "Calculating PTO by hand"],
      complementsTools: ["QuickBooks", "Gusto"],
      pairsWith: ["employees", "instructors", "finance-ap", "studio", "finance-expenses"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'team.png', alt: "Team list with roles, hours this week, and PTO balance" },
      learnMoreUrl: HELP_BASE + 'team'
    },
    'business': {
      label: 'Business', section: 'operations',
      tagline: 'Business entity configuration and compliance.',
      outcome: "Your legal business info — name, EIN, address, tax registration states — set once and used wherever Mast needs it.",
      goodFitWhen: "this is on for everyone — every shop has business info that flows into invoices and tax forms.",
      automates: ["Re-typing your EIN on every 1099", "Updating address in 5 places when you move"],
      pairsWith: ["finance-tax", "settings", "team", "terms", "subscription"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'business.png', alt: "Business entity profile with EIN, address, and tax registration states" },
      learnMoreUrl: HELP_BASE + 'business'
    },
    // Admin (always-on)
    'settings': {
      label: 'Settings', section: 'admin',
      tagline: 'Tenant settings, integrations, and configuration.',
      outcome: "How your Mast is set up — integrations, defaults, business mode — in one place you touch maybe once a month.",
      goodFitWhen: "this is on for everyone — every Mast shop has configuration to manage.",
      automates: ["Hunting through every module for one toggle", "Setting the same defaults across multiple tools"],
      pairsWith: ["business", "employees", "subscription", "channels", "brand"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'settings.png', alt: "Settings landing page with integration, defaults, and business mode sections" },
      learnMoreUrl: HELP_BASE + 'settings'
    },
    'employees': {
      label: 'Permissions', section: 'admin',
      tagline: 'User roles, permissions, and RBAC.',
      outcome: "Decide who on your team can see sales, edit prices, or refund orders — without giving everyone the admin keys.",
      goodFitWhen: "this is on for everyone — even solo shops eventually add a helper who shouldn't see everything.",
      automates: ["Sharing your login password", "Giving someone full access just to update one thing", "Wondering who changed a price"],
      pairsWith: ["team", "auditlog", "settings", "subscription"],
      setupDepth: "moderate",
      preview: { url: ASSET_BASE + 'employees.png', alt: "Role matrix with users, role assignments, and per-module access" },
      learnMoreUrl: HELP_BASE + 'employees'
    },
    'analytics': {
      label: 'Analytics', section: 'admin',
      tagline: 'Site analytics and operational metrics.',
      outcome: "See how many people visited your storefront, which pages they hit, and where they came from — without setting up GA4.",
      goodFitWhen: "this is on for everyone — every storefront needs basic traffic visibility.",
      automates: ["Setting up Google Analytics", "Decoding GA4 reports", "Wondering if anyone actually clicks that homepage banner"],
      complementsTools: ["Google Analytics", "Plausible"],
      pairsWith: ["homepage", "blog", "social", "newsletter"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'analytics.png', alt: "Storefront traffic dashboard with top pages, sources, and conversions" },
      learnMoreUrl: HELP_BASE + 'analytics'
    },
    'auditlog': {
      label: 'Audit Log', section: 'admin',
      tagline: 'System audit trail for all admin actions.',
      outcome: "Look up who changed what and when — useful when a price looks wrong or a refund seems off.",
      goodFitWhen: "this is on for everyone — but more useful when you have more than one user.",
      automates: ["Asking the team \"did anyone change this?\"", "Reconstructing what happened from memory"],
      pairsWith: ["employees", "team", "settings", "subscription"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'auditlog.png', alt: "Audit log filtered by user, action type, and time range" },
      learnMoreUrl: HELP_BASE + 'auditlog'
    },
    'subscription': {
      label: 'Subscription', section: 'admin',
      tagline: 'Mast subscription, billing, and plan management.',
      outcome: "See your current Mast plan, next bill, and token usage — and change plans without emailing support.",
      goodFitWhen: "this is on for everyone — every Mast shop has a subscription to manage.",
      automates: ["Emailing support to change plan", "Hunting for the last Stripe invoice", "Wondering if you're about to overrun your token allowance"],
      complementsTools: ["Stripe"],
      pairsWith: ["business", "settings", "team", "auditlog"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'subscription.png', alt: "Subscription dashboard with current plan, next bill, and token usage" },
      learnMoreUrl: HELP_BASE + 'subscription'
    },
    'about': {
      label: 'About', section: 'admin',
      tagline: 'About this Mast tenant — version, support.',
      outcome: "Your Mast version, support contact, and quick links to docs — for when something looks wrong and you need to ask.",
      goodFitWhen: "this is on for everyone — useful when contacting support.",
      automates: ["Hunting for the version number to include in a bug report"],
      pairsWith: ["subscription", "auditlog", "settings"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'about.png', alt: "About page with Mast version, support contact, and docs links" },
      learnMoreUrl: HELP_BASE + 'about'
    },
    'email-log': {
      label: 'Email Log', section: 'admin',
      tagline: 'Outbound transactional email log.',
      outcome: "Confirm whether a customer actually got their order confirmation, receipt, or shipping update — and resend if not.",
      goodFitWhen: "this is on for everyone — useful any time a customer says \"I never got the email\".",
      automates: ["Wondering if Mast actually sent that email", "Forwarding the receipt manually when it bounced"],
      complementsTools: ["Mailgun", "SendGrid"],
      pairsWith: ["orders", "customers", "newsletter", "auditlog", "settings"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'email-log.png', alt: "Outbound email log with recipient, subject, status, and resend action" },
      learnMoreUrl: HELP_BASE + 'email-log'
    },
    'ask-ai': {
      label: 'Ask AI', section: 'admin',
      tagline: 'Chat with Mast about your own store data.',
      outcome: "Get a straight answer about your orders, products, or customers without digging through screens yourself.",
      goodFitWhen: "you'd rather ask a question in plain words than learn where every report lives.",
      automates: ["Hunting through tabs to answer a one-off question", "Exporting data just to eyeball a number"],
      complementsTools: ["ChatGPT", "Claude"],
      pairsWith: ["orders", "products", "customers", "analytics", "settings"],
      setupDepth: "quick",
      preview: { url: ASSET_BASE + 'ask-ai.png', alt: "Ask AI chat answering a question about recent orders" },
      learnMoreUrl: HELP_BASE + 'ask-ai'
    }
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
