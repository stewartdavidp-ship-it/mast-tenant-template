# marketing-v2 — Build Plan

Status: **SHIPPED** (2026-06-10 — Waves 1–3 + holistic pass merged & verified on dev:
social-v2 #381, composer-v2 + engagement-inbox-v2 #382, depth/cross-links #383,
holistic #384). Original planning text below; the scorecard and CRUD table reflect
the shipped end-state. Runs the `v2-conversion-playbook.md` end-to-end for the
Marketing section. 5 of 8 Marketing sub-items already have a V2 surface (born clean against
`lint-v2-standard` — zero baseline debt); this plan covers the 3 missing twins, the depth
gaps in the existing 5, and the holistic pass. Companion to `sales-v2-build-plan.md` (the
worked example) and `standard-record-ui.md` §10 (archetypes) — this doc applies those
ratified decisions, it does not re-litigate them.

## Scorecard — the 8 Marketing routes (sidebar `data-section="marketing"`)

| # | Route | Sidebar label | V1 source | V2 file | Status |
|---|-------|---------------|-----------|---------|--------|
| 1 | `marketing-calendar` | Calendar | marketing-calendar.js (270L) | marketing-calendar-v2.js | ✅ calendar index control; all 4 drills land on V2 twins |
| 2 | `composer` | Composer | composer.js (434L) | composer-v2.js | ✅ W2 — native create/edit/publish/delete (ComposerBridge) |
| 3 | `engagement-inbox` | Engagement Inbox | engagement-inbox.js (485L) | engagement-inbox-v2.js | ✅ W2 — queue archetype (EngagementBridge) |
| 4 | `campaigns` | Campaigns | campaigns.js (527L) | campaigns-v2.js | ✅ native CRUD + W3 delete + refs drill to V2 SOs |
| 5 | `social` | Social Media | social.js (1,441L) | social-v2.js | ✅ W1 — record + clips chip + signal/mark-posted/edit (SocialBridge) |
| 6 | `blog` | Blog | blog.js (2,333L) | blog-v2.js | ✅ W3 — light meta edit (BlogBridge) + draft delete |
| 7 | `newsletter` | Newsletter | newsletter.js (2,336L) | newsletter-v2.js | ✅ W3 — Subscribers + Issues lenses; draft-issue delete |
| 8 | `stories` | Stories | production.js (#stories) | stories-v2.js | ✅ W3 — draft delete; curation stays in Production |

Recon notes that shaped the plan (vs. the Sales round):

- **No registry orphans.** All 8 routes have full `mode-module-info.js` entries AND
  `MODE_ROUTE_VISIBILITY` entries — no `commission-terms`-style Wave 0 fix needed.
  `blog` and `stories` are *soft-hidden* (`{}`) in the visibility matrix by design; the
  conversion does not change visibility policy.
- **`stories` has no dedicated V1 file** — the legacy surface lives inside
  `production.js` (`renderStoriesList`/`renderStoryDetail`). Authoring is deeply coupled
  to Production; stories-v2 stays a read twin with authoring single-sourced there.
- **`engagement-inbox` is a marketing-side roll-up of CS data** (cs_reviews + cs_tickets
  + ugc_submissions), permission-gated on `customerService:read`, with bulk actions that
  delegate to customer-service.js helpers. Its V2 twin keeps that delegation — it never
  reimplements review/ticket writes.
- **One pipeline, many screens** (the Pack+Ship lesson, marketing edition): Composer →
  Blog/Newsletter/Social/Stories is one *publish fan-out* (composer's `linkedArtifacts`
  + each module's "open from content" hook), and Campaigns points back INTO all four via
  `references[].refId`. We keep the modules separate (each artifact type is a real record
  with its own surface) but Wave 3 makes the seams navigable: campaign ↔ artifact drills
  both ways.
- **Weak FKs:** `campaign.references[].refId` is an unvalidated string; artifacts carry
  NO `campaignId` back-reference. The reverse link is computed (scan campaigns for a
  matching refId) — no schema change, consistent with the playbook's weak-FK rule
  (stamp real FKs at create going forward; the campaigns reference-add flow already does).

## Archetype per sub-item (standard-record-ui §10 — no bespoke layouts)

| Route | Archetype | Shape |
|---|---|---|
| marketing-calendar | **Calendar index control** ✅ | aggregator, drill to source artifact |
| campaigns | **Record** ✅ | faceted record, native CRUD via bridge |
| blog | **Record** (read + light edit) | Builder/canvas authoring stays legacy (classic link) |
| newsletter | **Record** ×2 lenses | subscribers ✅ native; issues = read detail, grid-builder compose stays legacy |
| stories | **Record** (read) | photo-curation canvas stays in Production |
| social | **Record + queue lens** | posts list (record) + pending-clips bucket; AI enhance/caption canvas stays legacy (temp-link debt) |
| composer | **Record** (native CRUD) | the editor is plain fields (title/body/channels/images) — small enough for a native engine edit form; publish fan-out delegates to a ComposerBridge |
| engagement-inbox | **Queue** | fulfillment-v2 pattern: sentiment/status buckets, count badges, bulk actions delegating to customer-service helpers; row click opens the underlying review/ticket record SO |

Deliberate non-goals (design discussions, not build tickets): rebuilding the blog
Builder, the newsletter grid-builder, the social enhance/AI-caption canvas, or the
stories photo curation as V2 surfaces. Each is a **Composer-archetype** candidate for a
later round; this conversion re-hosts lists/details/queues and keeps authoring
single-sourced on legacy (the blog-v2 precedent).

## Light/dark + standard compliance

The born-0 gates from the Sales round are live in CI (`lint-v2-standard`, hex/rgb token
lint). All 5 existing marketing V2 modules are debt-free; every new module must arrive
clean. Every wave's verify step includes one light + one dark screenshot.

## Demo data (sgtest15 / Shir Glassworks — audit BEFORE building)

Operator-ratified rules (2026-06-10): realistic names/content only — no test/demo/harness
strings anywhere customer-visible, **including `source`-type fields**. Audit scope for
marketing: `blog/posts`, `newsletter/issues` + `newsletter/subscribers`,
`market/{uid}/posts` + `market/{uid}/pendingClips`, `public/stories`, `admin/campaigns`,
`admin/content`, plus the engagement sources (`cs_reviews`, `cs_tickets`,
`admin/ugc_submissions`). Hard deletes are authorized on sgtest15 but reported. Seed
realistic glass-studio content for every surface being built (a campaign with references
into all four artifact types is the key fixture — it powers the cross-link demo).

## Waves (sequenced by end-to-end demo value)

### Wave 1 — social-v2 (the biggest hole)
`social` is the largest unconverted V1 (1,441L) and the only calendar drill target with
no V2 home. Record archetype over `market/{uid}/posts` (status / platforms / caption /
signal score) + a pending-clips bucket; native actions: signal score, mark-posted,
caption copy. The clip→enhance→AI-caption pipeline deep-links to classic (**temp-link
debt**, tracked below).
*Demo:* calendar → click a scheduled social post → V2 record SO → mark posted → score it.

### Wave 2 — composer-v2 + engagement-inbox-v2 (complete the route map)
After this wave every marketing route has a V2 home.
- **composer-v2**: record archetype with native CRUD (ComposerBridge for the
  publish-fan-out + `linkedArtifacts` write so channel hooks stay single-sourced).
- **engagement-inbox-v2**: queue archetype (fulfillment-v2 pattern) over
  reviews/tickets/ugc; bulk approve/reply/close delegate to customer-service helpers;
  RBAC stays `customerService:read` + action-level gates.
*Demo:* draft once in Composer → publish to blog + newsletter → both artifacts appear on
the calendar; a 5★ review lands in the inbox → approve it.

### Wave 3 — depth: issues, edit/delete, cross-links
- **newsletter-v2 issues lens**: issues list + read detail (subject / issue # / status /
  schedule / sent stats); grid-builder compose stays classic.
- **blog-v2 / stories-v2 light edit**: title / excerpt / tags / status via bridge
  delegation (body & canvas authoring stay legacy).
- **Deletes** where appropriate (confirm + `writeAudit` + RBAC `can(route,'delete')`):
  campaigns, composer drafts, blog drafts, newsletter draft issues, social
  drafts/pending clips, story drafts. **Immutability respected:** sent issues, published
  posts/stories never delete (unpublish first is a legacy-side action).
- **Campaign ↔ artifact cross-links**: campaign references drill to the V2 artifact SO
  (`MastEntity.drill` + cache-miss fetch fallback); artifact SOs grow a computed
  "Part of campaign" link back.
*Demo:* open the launch campaign → drill to its newsletter issue → back → the issue's
SO shows "Part of: Spring Launch".

### Wave 4 — holistic pass (final PR)
- **Operator walk**: every nav item, every record, create/edit/delete, every link.
- **Sidebar reorder** around the operator's process (plan → create → distribute →
  measure): Calendar, Campaigns · Composer · Blog, Newsletter, Social Media, Stories ·
  Engagement Inbox.
- CRUD parity table finalized (below), `lint-v2-standard` green, light+dark proof.

## CRUD parity — shipped end-state

| Route | C | R | U | D | Notes |
|---|---|---|---|---|---|
| campaigns | ✅ | ✅ | ✅ | ✅ | delete = confirm + writeAudit; artifacts survive |
| composer | ✅ | ✅ | ✅ | ✅ | full native; publish + delete via ComposerBridge |
| social | classic | ✅ | ✅ light | ✅ drafts | enhance/AI canvas classic (debt); posted = immutable history |
| blog | classic | ✅ | ✅ light | ✅ drafts | meta only (title/excerpt/tags); Builder owns body/publish |
| newsletter subscribers | ✅ | ✅ | ✅ | — | unsubscribe (status), not hard delete — by design |
| newsletter issues | classic | ✅ | — | ✅ drafts | compose/send classic; sent issues immutable |
| stories | classic | ✅ | — | ✅ drafts | curation in Production; published stories immutable |
| engagement-inbox | n/a | ✅ | ✅ (status) | n/a | queue over CS-owned records; UGC approve/reject native |
| marketing-calendar | n/a | ✅ | n/a | n/a | index control |

Every delete: `mastConfirm` + `writeAudit` + RBAC `can(route,'delete')`; immutability
respected (sent issues / published posts & stories / posted social records never delete).

## Debt / known leftovers (tracked, not blocking)

- [ ] **Social enhance/AI-caption canvas** deep-links to classic from social-v2
      (temp-link debt; composer-archetype rebuild is a future round).
- [ ] **Blog Builder / newsletter grid-builder / stories curation** stay legacy-authored
      (same class of debt; single-sourced, linked from the V2 twins).
- [ ] **No `campaignId` back-reference on artifacts** — reverse link is computed. If
      campaign volume ever makes the scan hot, add a stamped back-FK + audited backfill.
- [ ] `blog`/`stories` soft-hidden in `MODE_ROUTE_VISIBILITY` — revisit with IA, not here.
- [ ] Social posts are **uid-nested** (`market/{uid}/posts`) — single-operator assumption;
      a multi-staff tenant would only see their own posts. Data-model question, out of scope.
