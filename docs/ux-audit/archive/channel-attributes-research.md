# Channel Attributes / "Channel Tags" — Research & Proposal

**Status:** ✅ **RATIFIED by operator 2026-06-06.** Model + the three open decisions are locked (see §4.1). Build in progress — product-level Attributes pane shipped first (authored editing + imported display + derived badges); projection + variant-level + facets follow.
**Date:** 2026-06-06.

> **Ratified decisions (the three open questions, §3.3 / §4):**
> 1. **`imported`** — **project a thin filterable slice** (tags + product_type/materials/occasion/style) onto `product.attributes.imported[channelId]`; keep the full `raw` payload in `channel_listings`. (List facets need the data on the product row.)
> 2. **`authored`** — **hybrid, start minimal: type only `tags[]` + `materials[]`; everything else in a `custom:{}` bag.** Graduate a custom key to a typed field only when a real consumer (facet / publish mapping) needs it.
> 3. **`derived`** — **compute at render, do not store.** Badges derive from the already-loaded stock/sales maps; storing them would require a recompute cron and risk staleness.
>
> Discriminator: store data that the list needs but isn't otherwise loaded AND doesn't go stale (imported); compute data that's already loaded and goes stale (derived).

> Operator ask: *"each variant may or may not be available in a specific channel… [and] do research on the shape of channel tags (or information being shared with Mast from channels that are not in our model). We want to match the ability to model that information — tags was an option."*

This doc maps **what external channels actually send into Mast today, what we keep, and what we drop**, then proposes how to model the dropped information. It is grounded in the current code (cites below), not aspiration.

---

## 1. The reality today — channels send rich metadata; Mast drops most of it

Inbound channel data is **normalized and stored**, but only a thin slice is projected onto the Mast product. The rest lands in `channel_listings` and dies there.

### Where inbound data lands
- **`channel_listings/{…}`** (mast-architecture) — holds BOTH `raw` (the full channel payload) and `normalized` (a cross-channel shape). Written by the poller/sync path (`channel-listing-write.js`, `shopify-polling-sync.js`, `etsy-poller.js`). **This is the key finding: the data is already in our system — it just never reaches the product object.**
- **`product.externalRefs[channelId]`** = `{ externalId, syncEnabled, … }` — the listing ID + sync flags. Written by `relationship-writer.js` `projectRelationship()`; read only by the maker readiness/publish checks. No descriptive attributes here.
- **`product.channelBindings[]`** = `{ channelId, excludedVariantIds[] }` — which channels the product sells on + per-variant opt-outs (the model behind the Channels tabs we just shipped). Availability, not attributes.

### What gets MAPPED onto the product (the thin slice)
`title→name`, `body_html/description→description`, `price→priceCents`, `sku→sku`, `images→images[]` (URLs only), `status→status`. That's essentially it.

### What gets DROPPED (normalized or raw, but never on the product)

| Source | Field | Today |
|---|---|---|
| Shopify | **tags** (comma-sep) | normalized then dropped (`channel-listing-normalize.js`) |
| Shopify | **product_type** | dropped (no `productType` field; could feed category) |
| Shopify | **vendor** | dropped (no vendor/maker field) |
| Shopify | **metafields** (arbitrary k/v) | not even extracted |
| Shopify | **collections** | dropped |
| Shopify | **compare_at_price** | kept in `channel_listings.normalized`, not on product (PP-04 audit rule reads it there) |
| Shopify | variant **weight / weight_unit**, **barcode**, image **alt/width/height** | dropped |
| Etsy | **tags[]** | normalized then dropped (`etsy-poller.js`) |
| Etsy | **materials[]** | dropped |
| Etsy | **occasion[]**, **style[]** | dropped |
| Etsy | **taxonomy_id / category** | dropped |
| Etsy | **personalization_fields** | dropped |
| Square | variations / **custom_attributes** / categories | per pattern, dropped (Square normalize not fully built) |

### The vestigial sink that's already there
`product.tags[]` **exists in the model but is read nowhere** — not by storefront, search, filters, or publish (confirmed: 0/50 products consume it; the only reference is dead binding code). It was clearly intended for exactly this and never wired. Same story, partially, for `makerAttributes` (only `.dimensions` is consumed) and fully for `imageIds[]` / `businessLine` (written, never read).

**So the gap is not "we have nowhere to put channel info" — it's "the inbound info stops at `channel_listings` and we never decided the product-level model."**

---

## 2. The three provenances (the distinction that should drive the model)

The operator already put a finger on this: *"'top seller' smells DERIVED (from sales) vs hand-set."* Channel/attribute data has **three different origins**, and conflating them is the trap:

1. **Imported** — read FROM a channel (Shopify tags, Etsy materials/occasion/style). Channel-owned; Mast is a mirror. Per-channel, can conflict across channels.
2. **Authored** — set by the maker IN Mast (hand-set merchandising tags, materials we track ourselves), intended to be pushed OUT to channels on publish.
3. **Derived** — computed by Mast (e.g. "top seller" from sales, "low stock", "new"). Never hand-edited; recomputed.

These have different edit affordances (imported = read-only mirror; authored = editable; derived = recomputed, never editable), different conflict semantics, and different sync directions. A single flat `tags[]` array cannot represent them honestly — which is why the vestigial one was never wired.

---

## 3. Proposal — `attributes`, namespaced by provenance, id-keyed for variants

### 3.1 Shape

Model attributes as a small structured object on the product (and, where it differs, on the variant — first-class, id-keyed per the cornerstone principle):

```
product.attributes = {
  authored: {                         // set in Mast, pushed out on publish
    tags: ["handmade", "gift"],
    materials: ["sterling silver"],
    custom: { occasion: ["wedding"] } // open k/v for things we choose to track
  },
  imported: {                         // mirror of what each channel sent (read-only)
    "<channelId>": {
      tags: ["bestseller"],           // Shopify tags / Etsy tags
      productType: "Necklaces",       // Shopify product_type
      vendor: "Studio X",             // Shopify vendor
      materials: ["silver","resin"],  // Etsy materials
      occasion: ["wedding"], style: ["minimalist"],
      raw: { … }                      // escape hatch; mirrors channel_listings.normalized
    }
  },
  derived: {                          // computed by Mast, never hand-edited
    badges: ["top-seller","low-stock"]
  }
}

variant.attributes = { authored: {…}, imported: {…}, derived: {…} }  // same shape; only overrides
```

- **`imported`** is a straight projection of `channel_listings.normalized` onto the product, keyed by channel. This is the cheap, high-value first step — the data already exists; we just start copying the descriptive fields across (not only title/price). Read-only in the UI; refreshes on poll.
- **`authored`** reclaims the intent of the dead `tags[]` (we can migrate/retire the flat field) and is the only editable bucket. It's also what a future publish flow would push OUT.
- **`derived`** is owned by compute jobs (sales → "top-seller", inventory → "low-stock"). The UI shows them as badges; no edit control. Resolves the operator's "top seller is derived" point structurally.

### 3.2 Why namespaced rather than one flat `tags[]`
- Honest about provenance → correct edit affordances and no accidental "editing" of a channel mirror.
- No cross-channel collision (Shopify "bestseller" tag ≠ Etsy "bestseller" tag ≠ our derived "top-seller" badge).
- Variant-first-class falls out naturally (same shape, id-keyed, override-or-inherit — exactly like the fulfillment/channel overrides we just shipped).
- Backwards path: the vestigial `product.tags[]` maps to `attributes.authored.tags`; `makerAttributes.dimensions` stays where it is (or migrates to `authored.custom.dimensions` later).

### 3.3 What gets consumed (so this isn't vestigial-redux)
A model nobody reads is the exact trap we keep hitting. Minimum consumers to commit to **before** building:
- **Admin UI** — a variant/product **Attributes** pane (read the `imported` mirror per channel; edit `authored`; show `derived` as badges). This is the cornerstone surface and the guaranteed first consumer.
- **Faceted list / search** — `authored` + `derived` tags become filter facets in the product list (the lens model already exists).
- **(Later, integration)** publish pushes `authored` OUT to channels; poll refreshes `imported`. That's #2b territory (OAuth/publish-coupled) — not blind.

---

## 4. Recommendation & sequencing

1. **Decide the model** (this doc) — operator ratifies `attributes.{authored,imported,derived}`, id-keyed, or adjusts.
2. **Project `imported`** — extend the channel normalizer→product projection (mast-architecture) to copy descriptive fields (tags, product_type, vendor, materials, occasion, style) from `channel_listings.normalized` into `product.attributes.imported[channelId]`. Pure additive; data already exists.
3. **Attributes pane (admin)** — read-only `imported` per channel + editable `authored` + `derived` badges, on both the product and the variant SO (cornerstone standard). Reclaim/migrate the dead `tags[]`.
4. **Facets** — wire `authored`/`derived` tags as list filter facets.
5. **(Gated, later)** publish `authored` out / honor on channels — with the #2b integration pass.

**Open questions for the operator:**
- Is `imported` worth mirroring per-channel on the product, or is reading `channel_listings` on demand enough? (Projection = simpler UI + facets; on-demand = no duplication.)
- Which `authored` attributes are first-class typed fields (materials, occasion, style) vs a free `custom` k/v bag?
- Should `derived` badges live here at all, or stay computed-at-render (the memory note's instinct)? Storing them enables faceting/sorting; computing avoids staleness.

---

## 5. Citations
- Inbound normalize/drop: `mast-architecture/functions/lib/channel-listing-normalize.js` (Shopify, ~70–135), `etsy-poller.js` (~63–92), `shopify-polling-sync.js` (~149–182).
- Landing zone: `channel-listing-write.js` (~92–102, raw+normalized), no product projection of descriptive fields.
- externalRefs: `relationship-writer.js` `projectRelationship()` (~256–289); read in `mast-tenant-template/app/modules/maker.js` (~3020–3120).
- Vestigial `tags`/`imageIds`/`businessLine`, partial `makerAttributes`: `mast-tenant-template/app/modules/products-v2.js` (info pane ~710–721, `makerAttributes.dimensions` ~785/2061), `maker.js` (~6695–6878).
