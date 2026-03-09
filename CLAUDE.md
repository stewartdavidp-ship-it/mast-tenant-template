# CLAUDE.md — Shir Glassworks

## What This App Is
Full website + studio admin platform for Shir Glassworks glass art studio. Covers: public storefront (shop, commissions, blog), Studio Companion PWA (camera-first POS, production management, inventory, QR scanning), and Market tools (social media content pipeline, newsletter/blog, stories). Firebase RTDB + Storage + Functions. GitHub Pages hosting.

## Current Idea
**Shir Glassworks Website + Storefront** — Full website redesign and storefront for Shir Glassworks. Phase 1: landing page, about, schedule, admin app with gallery management. Phase 2: shop with product catalog (6 categories, 31 products), analytics tracking. Phase 3: product detail pages with color variants, cart/checkout strategy. Phase 4: Studio Companion — camera-first PWA for production management and craft fair sales. Hybrid photo recognition (TensorFlow.js + Claude Vision), QR code system, GPS-based mode switching (studio/fair/packing), batch counting, new product onboarding via camera, travel inventory for events.

## RULEs — Do not violate these.

- No unbounded Firebase listeners. All reads must use limitToLast(N) or .once('value'). Prevents billing spikes (learned from $17/day incident on another project). _(from: Shir Glassworks Website + Storefront)_
- Admin writes go to shirglassworks/public/gallery (directly public). Firebase rules enforce admin-only writes (auth.uid check) and anonymous read access for public pages. Analytics writes are append-only with field validation. _(from: Shir Glassworks Website + Storefront)_
- generate_claude_md runs on job creation only when stale. Chat must call generate_claude_md(action="get") to check staleness before creating a draft job — if _stale: true, call generate_claude_md(action="push") to regenerate and deliver. If not stale, skip. Rules and constraints change infrequently — regenerating on every job is wasteful. The stale signal is the trigger, not the job creation event itself. _(from: Shir Glassworks Website + Storefront)_
- Shipping address entered at checkout must be validated via Google Places API before Square payment is taken and before CSV is generated for Pirate Ship. Invalid or unvalidated addresses must be corrected before the order can proceed. This prevents failed USPS deliveries on fragile glass shipments. _(from: Shir Glassworks Website + Storefront)_
- After every major build job (any job that adds new Firebase writes, new user inputs, new Firebase paths, new auth flows, new external API calls, or new UI that renders data from Firebase), Claude Code must create a follow-on Security Posture Review maintenance job before marking the build complete. The review must check: (1) Firebase rules for any new paths, (2) hasPermission() guards on all new writes, (3) esc() usage on all new innerHTML injections, (4) input validation on all new user-supplied values, (5) no sensitive data persisted beyond its immediate use. Critical and High findings must be fixed inline. Medium and Low findings must be captured as OPENs. The security job may be batched across multiple small builds but must not be skipped. _(from: Shir Glassworks Website + Storefront)_
- Market — Anti-Pattern: "Feels Helpful But Isn't" (finalized).

The Market feature must not create the illusion of help while leaving all the real work to the user. This is the primary design guardrail for every Market feature decision.

**The failure mode:**
A tool that generates a caption template with "[PRODUCT NAME]" placeholders, or produces a generic "beautiful handmade glass" caption that Madeline still has to rewrite from scratch, or shows an Instagram button that just opens the app home screen — these create friction theater. They look like automation but are just a clipboard with extra steps.

**The test for every feature:**
"After using this, has Madeline done less work than if she'd just opened Instagram directly?"

If the answer is no — cut the feature or don't build it.

**What "real help" looks like:**
- Caption uses the actual product name, actual price, actual materials from the catalog — not placeholders
- Hashtags are pre-selected and ready to paste — not a list Madeline still has to choose from
- Platform output is sized and formatted for the target platform — not generic text she has to trim
- "Open Instagram" means the caption is already on the clipboard before the app opens
- Content calendar shows real upcoming events and recently listed products as suggested posts — not empty slots Madeline has to fill

**Implication for AI vs templates:**
Template captions with real data injected are acceptable only if the output quality is high enough that Madeline would post it with minor edits. If templates produce generic output that requires significant rewriting, the Claude API approach becomes necessary — not a nice-to-have. _(from: Shir Glassworks Website + Storefront)_
- Market — Core Insight: Video-First, Capture-to-Post Pipeline (finalized).

Ori and Madeline have found that **video creates the most attention**. This is the most important product signal for the Market feature.

**What this means:**

The bottleneck is not caption writing. The bottleneck is **capture friction** — video feels like a "big production" so it doesn't happen. When it does happen, getting it from phone to published is enough steps that it either gets delayed or dropped.

The Market feature's primary job is:
1. **Remove the psychological barrier to capture** — make picking up the phone and shooting a video feel like a small, normal act, not a content production event
2. **Compress the path from captured video to published post** — every step between "I just shot this" and "it's live" is an opportunity to drop off
3. **Close the feedback loop** — help them identify when something is working so they do more of it, not just more of everything

**What this is NOT:**
- A caption generator bolted onto Instagram
- A content calendar that creates more planning overhead
- A tool that requires them to think about social media strategy to use

**The right mental model:**
Think of it as a **video post assistant** that lives in the moment of creation — capture → quick edit → platform-optimized output → publish → track what lands. The caption and hashtag tools exist to serve that pipeline, not as the pipeline themselves. _(from: Shir Glassworks Website + Storefront)_
- docs/workflows.md is owned by Claude Code. Claude Chat must not push updates to workflows.md directly. When workflows change, Chat can send a message to Code describing the needed updates — Code makes the edit and commits. This prevents Chat overwrites of Code's more accurate, build-time status updates. _(from: Shir Glassworks Website + Storefront)_
- UI Design System — Consistent Standards Applied Across All Views (finalized).

A UI design system was documented and added to CLAUDE.md as part of a compliance pass (Mar 6 2026). All new and existing views must conform to these standards:

- Typography, color, spacing, and component patterns are defined in CLAUDE.md under the UI Standards section
- Dark mode compliance is required on all views — any new UI must be tested in both light and dark modes
- Tab patterns, card patterns, badge/status patterns, and modal patterns follow documented standards
- Code must run a dark mode compliance check before marking any build job complete
- The design system lives in CLAUDE.md and is the authoritative reference for Claude Code during builds _(from: Shir Glassworks Website + Storefront)_
- Security — Firebase Rules for Invites Path: Hardened and Committed to Repo (finalized).

Firebase security rules for the invites path were hardened and the rules file was committed to the repo (not just deployed).

- The invites path previously had looser rules — now enforces auth.uid check for writes
- firebase.rules file is now tracked in the shirglassworks repo (not just a console-side deployment)
- Code must run firebase deploy --only firestore:rules (or RTDB equivalent) as part of any job that modifies data access patterns — rules file is the source of truth
- Built in Firebase Rules — Harden Invites Path + Commit Rules to Repo (Mar 6 2026) _(from: Shir Glassworks Website + Storefront)_

## CONSTRAINTs — External realities. Work within these.

- GitHub Pages hosting — static files only, no server-side code. All dynamic behavior via client-side JS + Firebase RTDB. _(from: Shir Glassworks Website + Storefront)_
- Existing Etsy shop (ShirGlassworks) already handles payments, shipping, inventory, and buyer protection. Any checkout strategy must account for this existing sales channel. _(from: Shir Glassworks Website + Storefront)_
- Orders do not currently track variant-level combo keys. Fulfillment operates on stock._default only. Forecasting at the attribute level (e.g., "build more Short Blue cups") requires variant-level fulfillment to be built first. Until then, forecasting can only operate at the product level. _(from: Shir Glassworks Website + Storefront)_
- No historical inventory snapshots exist. Firebase only stores current stock state — no time-series of inventory levels. Cannot answer "what was our stock level 30 days ago" or calculate burn rate from inventory history. Forecasting must derive demand from order history, not inventory deltas. _(from: Shir Glassworks Website + Storefront)_
- Etsy order history only exists from when sync was first enabled — not full historical data. Direct orders have complete history in Firebase, but Etsy orders before integration are missing. Forecasting must account for incomplete history on the Etsy channel. _(from: Shir Glassworks Website + Storefront)_
- No cost or margin data on products. Product records have selling price but no cost-of-materials, labor time, or margin fields. Forecasting cannot prioritize by profitability — only by demand volume or revenue. Adding cost data would require extending the product or inventory data model. _(from: Shir Glassworks Website + Storefront)_
- RBAC is role-level only — no row-level or attribute-level data filtering. All users with access to a function can see all records that function exposes. Shir Glassworks does not require per-user data scoping for internal roles (Admin, User).

The only data-scoped role is Guest, which is enforced by query design (customers query only their own records by uid), not by the permission matrix. This is not configurable — Guest data isolation is structural.

Do not implement row-level security, record ownership filters, or per-user data visibility controls for Admin or User roles. If this requirement emerges in the future (e.g. multi-location staff who should only see their location's data), it is a new architectural decision at that time. _(from: Shir Glassworks Website + Storefront)_
- Vendor Google integration assumes a single shared Google account used by both Ori and Madeline for Drive and Contacts. Domain accounts (shirglassworks.com) are a future goal but not a current blocker — treat as same-account for all integration design now. _(from: Shir Glassworks Website + Storefront)_
- Demand volume is bimodal across the product catalog. Top SKUs (hollow birds ~50/month, cups 10-30/month, seasonal items like pumpkins 100+/month in season) have meaningful 30-day signal. The long tail of slower or seasonal-only products may see 2-5 units/month or less outside their season. Forecasting logic must account for this range — a single time window or threshold does not apply uniformly across all products. Artisan-scale caution applies only to the slow-moving tail, not the catalog as a whole. _(from: Shir Glassworks Website + Storefront)_
- Sculpture pieces are unique objects — inventory quantity is always 0 or 1. The system must not allow stock counts > 1 for sculpture products, must not surface sculptures in Suggested Builds or production job creation flows, and must not apply velocity or demand rate calculations to them. When a sculpture sells, it is marked Sold (not deleted) — it remains visible in the catalog as a reference piece. A "Request Commission" CTA appears on the sold sculpture's product page and in the POS after a sale, allowing a customer who liked that piece to submit a commission inquiry for a similar work. The online store hides sold sculptures from the main shop grid but keeps them accessible via direct link for commission reference. _(from: Shir Glassworks Website + Storefront)_
