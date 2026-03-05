<!-- cc:app=shirglassworks idea=-OmgHr79DCEJbWnni1mt generated=2026-03-05T15:22:41.732Z -->
# CLAUDE.md — Shir Glassworks

> **Read cc-build-protocol before doing anything else.**

## Current State

- **App:** Shir Glassworks (`shirglassworks`)
- **Active Idea:** Shir Glassworks Website + Storefront (`-OmgHr79DCEJbWnni1mt`)
- **Idea Status:** active
- **Active Concepts:** 3 rules, 8 constraints, 17 decisions, 7 opens

## What This App Is
E-commerce website for Shir Glassworks — handmade glass art. Single-file HTML admin app with Firebase RTDB backend, public storefront on GitHub Pages, image pipeline via Cloud Functions, and Etsy integration for checkout.

## RULEs — Do not violate these.

- No unbounded Firebase listeners. All reads must use limitToLast(N) or .once('value'). Prevents billing spikes (learned from $17/day incident on another project). _(from: Shir Glassworks Website + Storefront)_
- Admin writes go to shirglassworks/public/gallery (directly public). Firebase rules enforce admin-only writes (auth.uid check) and anonymous read access for public pages. Analytics writes are append-only with field validation. _(from: Shir Glassworks Website + Storefront)_
- generate_claude_md is called automatically as part of job creation. When Chat creates a draft job, it must call generate_claude_md(action="push") for the target app before or alongside job creation. This ensures Code always has a current CLAUDE.md when it claims the job. Manual generation is no longer the expected path. _(from: Shir Glassworks Website + Storefront)_

## CONSTRAINTs — External realities. Work within these.

- GitHub Pages hosting — static files only, no server-side code. All dynamic behavior via client-side JS + Firebase RTDB. _(from: Shir Glassworks Website + Storefront)_
- Existing Etsy shop (ShirGlassworks) already handles payments, shipping, inventory, and buyer protection. Any checkout strategy must account for this existing sales channel. _(from: Shir Glassworks Website + Storefront)_
- Orders do not currently track variant-level combo keys. Fulfillment operates on stock._default only. Forecasting at the attribute level (e.g., "build more Short Blue cups") requires variant-level fulfillment to be built first. Until then, forecasting can only operate at the product level. _(from: Shir Glassworks Website + Storefront)_
- No historical inventory snapshots exist. Firebase only stores current stock state — no time-series of inventory levels. Cannot answer "what was our stock level 30 days ago" or calculate burn rate from inventory history. Forecasting must derive demand from order history, not inventory deltas. _(from: Shir Glassworks Website + Storefront)_
- Artisan-scale order volume limits statistical significance. This is not a high-volume retail business — a product may sell 2-5 units per month. Forecasting models that rely on large sample sizes (moving averages, regression) may produce noisy results. Simple heuristics may outperform statistical methods at this scale. _(from: Shir Glassworks Website + Storefront)_
- Etsy order history only exists from when sync was first enabled — not full historical data. Direct orders have complete history in Firebase, but Etsy orders before integration are missing. Forecasting must account for incomplete history on the Etsy channel. _(from: Shir Glassworks Website + Storefront)_
- No cost or margin data on products. Product records have selling price but no cost-of-materials, labor time, or margin fields. Forecasting cannot prioritize by profitability — only by demand volume or revenue. Adding cost data would require extending the product or inventory data model. _(from: Shir Glassworks Website + Storefront)_
- RBAC is role-level only — no row-level or attribute-level data filtering. All users with access to a function can see all records that function exposes. Shir Glassworks does not require per-user data scoping for internal roles (Admin, User).

The only data-scoped role is Guest, which is enforced by query design (customers query only their own records by uid), not by the permission matrix. This is not configurable — Guest data isolation is structural.

Do not implement row-level security, record ownership filters, or per-user data visibility controls for Admin or User roles. If this requirement emerges in the future (e.g. multi-location staff who should only see their location's data), it is a new architectural decision at that time. _(from: Shir Glassworks Website + Storefront)_
