# customer-service-v2 — Build Plan

Status: **SHIPPED** (2026-06-10 — plan #413, Wave 1 #414+#415, Wave 2 #416,
Wave 3 #417+#418+#419, Wave 4 #420, walk-fix #421, holistic this PR; all merged &
verified on dev). Runs `v2-conversion-playbook.md` end-to-end for the
Customer Service section (sidebar `data-section="customer-service"`, 6 sub-items).
Companion to `sales-v2-build-plan.md` / `marketing-v2-build-plan.md` /
`operations-v2-build-plan.md` / `finance-v2-build-plan.md` (worked examples) and
`standard-record-ui.md` §10 (archetypes) — ratified decisions applied, not re-litigated.

**Operator directives (carried from the Finance round):** consolidate around hub
objects (don't twin 1:1); plain-language naming (owner vocabulary, not support-desk
jargon); V1 sunsets on V2 ratification — keep the `mastUiRedesign` flag-gating (lint
requires it) but spend zero effort on legacy-parity engineering.

**Recon amendments (verified against live code before planning):**
1. The earlier recon pass claimed all four twins lack `pageHeader` — wrong. Three of
   four (`cs-reviews-v2:267`, `cs-faqs-v2:259`, `cs-members-v2:256`) already call it;
   only `cs-tickets-v2` (the oldest twin, "conversion #7" of the slide-out backlog)
   predates the standard: hand-rolled `<h1>` header, no RBAC gates, direct un-bridged
   `MastDB` writes.
2. `cs_config/reviews|ticketing|automatedSurveys` are normal 2-segment coll/doc paths,
   NOT unregistered-singleton traps (`SINGLETON_COLLECTIONS` is for `admin/<x>`-style
   3-seg paths). No mastdb registration needed.
3. Visibility is governed by the LEGACY route ids (sidebar items keep
   `data-route="cs-tickets"` etc.; `MAST_V2_ROUTE_MAP` remaps inside `navigateTo`,
   index.html:20913). All 6 routes have `MODE_ROUTE_VISIBILITY` entries
   (business-entity-constants.js:771–776) — no Finance-style invisible-hub orphan.
   ⚠ `cs-members` is **bookings-mode only** (:776) — expected HIDDEN on sgtest15
   (maker studio); verify in the live sidebar, don't misread it as a regression.
4. `cs-policies` (the MCP tool's namesake) has an admin surface already: the FAQs
   route. `cs_policies` is ONE collection shared with Sales — CS owns `kind='faq'`
   rows, Sales owns `kind='policy'` rows, legacy rows partition by slug pattern
   (cs-faqs-v2.js:59). No separate cs-policies route is needed; the partition contract
   is the thing to protect.

## The V1 reality

One 3,290-line `app/modules/customer-service.js` serves all six routes (module
registry, customer-service.js:3204–3288). Zero MastUI/MastEntity usage. Key facts:

- **Inbox and Tickets are already one surface.** Both routes share `ticketsData`,
  `renderCurrentView()`, and `renderList()`; Inbox is just a "not resolved/closed"
  filter with All/Open/In-Progress sub-tabs (customer-service.js:191–204). This is
  the Pack+Ship shape: one module, the route picks the entry lens.
- **Tickets are a Faceted Record, not a Process.** Status is a free `<select>` (any →
  any, no exit checklist, no `statusHistory`); cs-tickets-v2's header comment already
  ratified this ("5th doc Process tag that turned out to be Faceted").
- **Replies do NOT email the customer** — a reply appends to
  `cs_tickets/{id}/messages` and bumps `updatedAt`, nothing more (verified; noted in
  cs-tickets-v2.js:17–19). Don't accidentally promise otherwise in copy.
- **Surveys is a 4-collection subsystem**: `cs_survey_questions` (library) →
  `cs_survey_groups` (question sets w/ eventType) → `cs_surveys` (instances w/
  status/closesAt) + `cs_config/automatedSurveys` (automation toggle) +
  `generateSurveyLink` CF (the only CS Cloud Function besides `mintUgcUploadToken`).
  All writes DOM-coupled (`csQAddOrUpdate`:1686, `csGroupAddOrUpdate`:1743,
  `csSurveyAddOrUpdate`:1802).
- **Reviews** moderation: approve/reject/respond/feature-on-site. Respond dual-writes
  `cs_review_responses` (audit sink) + denormalized `cs_reviews.response`. Feature
  mirrors into `public/testimonials/{id}` (storefront); unfeature removes the mirror.
  Existing bridges on legacy: `CsFaqsBridge` (:2786), `CsReviewsBridge` (:2821).
- **Members is a derived read-only roster** (filters `admin/customers` by
  `membership.*`); grant/revoke lifecycle lives on Membership admin, not CS.
- **Ticket numbering**: `cs_config/ticketing` `{prefix, nextNumber}` increment at
  create (`csSubmitCreate`:513, :3017–3057) — the create bridge must own this.

### Cross-module contracts (do not break)

| Consumer | Read | Contract |
|---|---|---|
| Finance customer-portfolio (cost-to-serve) | `cs_tickets` limitToLast(2000) (finance.js:6003) | field names `contactEmail`, `status`, `updatedAt`; status vocab `open/in_progress/waiting/resolved/closed` |
| Engagement Inbox (marketing roll-up) | `cs_reviews` + `cs_tickets` limitToLast(200) (engagement-inbox-v2.js:16) | status enums + rating; writes delegate to CsReviewsBridge/CsTicketsV2 handlers |
| Contacts profile | `cs_tickets` by `contactEmail`, `cs_reviews` by `authorEmail` | exact-match email fields |
| Sales Policies route | `cs_policies` `kind='policy'` rows | FAQ writes MUST stamp `kind:'faq'` (CsFaqsBridge does) |
| Storefront | `public/testimonials/*`, `public/config/reviews` | feature/unfeature mirror lifecycle; anonymous-review policy doc |

## Scorecard — the 6 CS routes (+ cs-policies)

| # | Route | Sidebar label | V1 source | V2 home (planned) | Existing twin state |
|---|-------|---------------|-----------|-------------------|---------------------|
| 1 | `cs-inbox` | Inbox | customer-service.js (lens of tickets) | **cs-support-v2 — Needs-reply lens** | none |
| 2 | `cs-tickets` | Tickets | customer-service.js | **cs-support-v2 — All-conversations lens** | cs-tickets-v2 (254L) pre-standard: no pageHeader, no RBAC, un-bridged writes, no CREATE |
| 3 | `cs-surveys` | Surveys | customer-service.js | **cs-surveys-v2** (new) | none |
| 4 | `cs-reviews` | Reviews | customer-service.js | cs-reviews-v2 deepened | pageHeader ✓ bridge ✓; respond/edit/delete-response still legacy-only; no RBAC |
| 5 | `cs-faqs` | FAQs | customer-service.js | cs-faqs-v2 deepened | pageHeader ✓ bridge ✓ create/edit ✓; publish-toggle + delete still legacy-only; no RBAC |
| 6 | `cs-members` | Members | customer-service.js | cs-members-v2 (read-only lens, kept) | pageHeader ✓; read-only BY DESIGN (lifecycle on Membership admin); bookings-mode only |
| — | (`cs-policies`) | — | FAQs route (kind partition) | no new route — partition contract enforced in CsFaqsBridge | n/a |

## CONSOLIDATION

### Hub — `cs-support-v2` (2 routes: cs-inbox, cs-tickets)
*Evidence:* V1 already serves both from one renderer over one collection; Inbox is a
status filter, not a different object. The "two routes, one pipeline" call is made by
the code itself.
*Shape:* **Queue** archetype over `cs_tickets`, lens pills (**Needs reply · All
conversations**), status/priority filters, search; row click opens the conversation
SO (thread + composer + inline status/priority/category controls — the good part of
cs-tickets-v2, kept). `pageHeader` + CSV export + **New conversation** (CREATE in the
SO, ticket number minted by the bridge). cs-tickets-v2.js is rebuilt in place into
cs-support-v2 (same file renamed, or superseded) — both route ids map to it in
`MAST_V2_ROUTE_MAP`.
*Writes:* extract **`CsTicketsBridge`** on the legacy module (create w/ ticket-number
mint, reply append + updatedAt bump, setField status/priority/category) — V1 handlers
and V2 both call it (FinanceBridge precedent). All gated `can('cs-tickets','edit')`.

### Evaluated, decided AGAINST consolidating
- **Surveys + Reviews as one "customer feedback" hub:** different schemas
  (instrument-config vs user-generated moderation), different collections
  (`cs_surveys*` vs `cs_reviews`), zero cross-reference in code, different jobs
  (author-and-send vs moderate-and-publish). Keep separate.
- **Inbox into the Marketing Engagement Inbox:** engagement-inbox-v2 is a roll-up that
  reads reviews+tickets+UGC for the marketing persona; CS support work needs the full
  thread + writes. Different persona, keep both; the hub remains the detail surface
  the roll-up drills into.
- **Members elsewhere:** it's a CS *lens* on membership health; lifecycle stays on
  Membership admin. Keep as read-only twin.

### Sidebar proposal — ✅ RATIFIED + SHIPPED (2026-06-10)
Operator ratified the merge same-day (finance precedent). Under the V2 nav the 6
items collapse to **5**: **Inbox · Reviews · Surveys · FAQs · Members** — one
"Inbox" item serves both routes and claims `cs-tickets` via `data-route-alt` so
the active highlight follows deep links. Legacy UI keeps the original two items
byte-identical (`.cs-merged-v1`/`.cs-merged-v2` + `body.nav-v2` CSS gate). Both
routes stay live as deep links into the cs-support-v2 hub.

### Plain-language naming table

| Surface | Jargon (current) | Proposed owner vocabulary |
|---|---|---|
| Sidebar item 1 | Inbox / Tickets (two items) | **Inbox** (one item) |
| Hub page title | Tickets | **Customer Messages** |
| Lens pills | Inbox / All | **Needs reply · All conversations** |
| Record noun (SO title) | Ticket | **Conversation** (ticket # kept as the reference number) |
| Status labels | open/in_progress/waiting/resolved/closed | Open · Working on it · Waiting on customer · Resolved · Closed (labels only; stored vocab unchanged — finance cost-to-serve reads it) |
| Reviews | Reviews | Reviews (already plain) |
| Surveys | Surveys | Surveys (already plain) |
| FAQs | FAQs | FAQs (already plain) |
| Members | Members | Members (already plain) |

## Waves (sequenced by end-to-end demo value)

### Wave 0 — demo-data audit + scrub (sgtest15, before building)
Audit: `cs_tickets` (+ messages subtrees), `cs_reviews`, `cs_review_responses`,
`cs_surveys` / `cs_survey_groups` / `cs_survey_questions`, `cs_policies` (faq rows),
`cs_config/*`, `public/testimonials`. No test/demo/harness strings incl. `source`
fields; RENAME FK-referenced placeholders, hard-delete only unreferenced junk
(report all). Key fixtures: ~8 tickets across statuses/priorities/sources with real
threads (incl. internal notes), ~10 reviews across pending/approved/rejected w/ one
responded + one featured, a survey with a question group + questions, 4–6 glass-care
FAQs, members state as-is (bookings-only).

### Wave 1 — `cs-support-v2` hub (the daily-work surface)
Rebuild cs-tickets-v2 → standard + absorb Inbox. `pageHeader`, lens pills, KPI tiles
(needs reply / open / median age), CREATE conversation, `CsTicketsBridge` extraction,
RBAC gates, drill contact email → customers-v2 (cold-drill safe), export.
*Demo:* open Inbox → answer a customer → internal note → set status → create a fresh
conversation for a phone inquiry → drill to the customer record.

### Wave 2 — `cs-reviews-v2` deepened (moderate → respond → publish)
Respond/edit/delete-response moves into the SO (bridge cores extracted from
`csSaveReviewResponse`/`csDeleteReviewResponse`); RBAC gates on all moderation;
delete-review (mastConfirm + writeAudit + testimonial-mirror cascade); "More actions
on legacy" link removed. Published/approved reviews: respect immutability of the
*review body* (operator never edits customer words — moderation + response only).
*Demo:* pending review → approve → respond → feature on site → see it on the
storefront testimonials.

### Wave 3 — `cs-surveys-v2` (greenfield)
**Record** archetype, lens pills (**Surveys · Question sets · Question library**) over
the three collections + automation toggle card (`cs_config/automatedSurveys`) +
`generateSurveyLink` CF action. `CsSurveysBridge` extraction (create/update/delete for
all three levels). Sent/closed surveys immutable-ish: editing a closed survey's
definition is blocked; question sets referenced by surveys warn before delete.
*Demo:* new question → add to a post-purchase set → create survey → copy its link.

### Wave 4 — `cs-faqs-v2` completion + members polish + cross-links
FAQs: publish/hide toggle + delete into V2 (bridge-delegated, RBAC, confirm+audit);
kind='faq' partition asserted in bridge. Members: verify against live sidebar
(bookings-only), keep read-only, ensure standard list/SO chrome. Cross-links: support
SO → customers-v2; reviews SO → products-v2; members SO → customers-v2 (all
`MastEntity.drill` + ensureLoaded()-gated fetch).

### Wave 5 — holistic (walk FIRST, then PR)
Operator walk: every route, every record, every CRUD verb incl. CREATE on fresh
records, cold cross-drills both directions (customers-v2 → tickets? check contacts
profile path), both themes. Then: sidebar reorder + Inbox/Tickets merge + naming,
CRUD parity table, debt register close-out, plan doc → SHIPPED.

## CRUD parity — target end-state

| Surface | C | R | U | D | Notes |
|---|---|---|---|---|---|
| support conversations | ✅ (new conversation) | ✅ | ✅ (reply, status/priority/category) | ⬜ defer | no delete in V1 either; archive = closed status |
| reviews | n/a (user-generated) | ✅ | ✅ (moderate, respond, feature) | ✅ | delete cascades testimonial mirror; customer's words never edited |
| surveys / sets / questions | ✅ | ✅ | ✅ | ✅ | closed surveys not editable; referenced sets warn on delete |
| faqs | ✅ | ✅ | ✅ (+publish/hide) | ✅ | kind='faq' stamped by bridge; partition contract with Sales |
| members | n/a | ✅ | n/a | n/a | read-only lens; lifecycle on Membership admin |

Every delete: `mastConfirm` + `writeAudit` + RBAC `can(route,'delete')`.

## Debt / known leftovers (tracked, not blocking)

- [ ] Ticket reply does not email the customer (V1 parity) — outbound email is a
      product decision + CF, not this round.
- [ ] `cs_tickets` reads are limitToLast(50/200/2000) windows — no pagination; fine at
      sgtest15 scale, engine-level concern later.
- [ ] `cs_review_responses` audit sink is write-only legacy duplication — keep
      dual-write in the bridge for now; candidate for retirement when V1 dies.
- [ ] `engagement-inbox-v2` keeps its own thin readers of cs collections — converge on
      CsTicketsBridge/CsReviewsBridge reads when marketing round revisits.
- [ ] `mintUgcUploadToken` "Ask for photo" flow stays as-is (already CF-backed).
- [ ] Survey *responses* (answers) have no admin surface anywhere — out of scope;
      surveys remain send-side only.
- [ ] cs-members bookings-only visibility means the twin is undemoable on sgtest15 —
      acceptable; verified-by-code + lint, not by walk.

## Walk findings (2026-06-10 — every route, every CRUD verb incl. CREATE, cold cross-drills, both themes)

1. **cs-tickets-v2 had no static tab container** — `applyRoute` shows
   `config.tab` BEFORE `setup()` runs, so the first in-session navigation threw
   and bounced to dashboard. The scaffold step writes the static div; skipping
   the scaffold skipped the div. Fixed #415 (and cs-surveys-v2 shipped with its
   div from the start).
2. **cs-surveys-v2 defined entities but never registered them** —
   `defineEntities()` existed and was never invoked; rows/SO/create were dead.
   Fixed #419: define at module load (also needed for cold cross-drills).
3. **CsReviewsBridge cache-miss no-op** — `reviewsData` is a load-once bounded
   window; feature/respond/remove on a review created after load silently did
   nothing ("Review not found"). Fixed #421: `ensureReviewInCache(id)`
   fresh-reads the single doc before every per-review action. Proven live:
   create → approve → feature (mirror minted) → delete (review gone, mirror
   cascaded).
4. Sending-rule rows read "→ —": sgtest15's triggers were CF/MCP-created and
   carry `surveyGroupId`, not the legacy admin's `surveyId`. Fixed #418
   (resolve both).
5. `cs-members` IS visible on sgtest15 (its mode set includes bookings — the
   studio runs classes); the "undemoable" caveat in the debt register was
   wrong and is struck.
6. Exercised end-to-end: conversation CREATE (T-0011 minted sequentially),
   reply + internal note, status/priority writes (stored vocab intact),
   support→customer cold drill (stacked SO + back-link); review approve →
   public reply post/edit → feature (testimonial mirror verified in
   `testimonials/`) → delete cascade; survey question CREATE (engine textarea),
   question-set edit via checkbox picker (set 1→2 questions), trigger off→on,
   response→conversation cold drill; FAQ publish→hide round-trip + create +
   mastConfirm delete. Both themes screenshot-verified; console clean on a
   clean boot (one interrupted boot produced app-wide unrelated noise — the
   "tolerate ONE messy boot" rule held).

## Scrub report (Wave 0 + walk, sgtest15 — standing authorization, all deletes listed)

**Hard deletes:** 6 admin-cancel test tickets (`ticket_mppv*`, "Actor-capture /
MastFlow verification" bodies, all duplicate T-0001); 14 junk survey responses
(`preview@preview.internal`, `dave+*test@test.com`, `smoketest@`, `test@`,
`backorder-e2e@` Pat Tester); 1 walk-fixture review (`e6EdfMRtezPbDkyKsg69`,
Walk Check) + 1 walk-fixture FAQ (`LyDwac7LvzAOZ79ctt2a`) created and deleted
by the walk itself to prove the delete verbs.

**Renames in place (FK-referenced):** survey "Full Nav Test Survey (8
questions)" → "Studio Experience Survey" (referenced by tickets/responses);
contactName "Dave" → "David Stewart" on 2 follow-up tickets + 5 survey
responses; review `923b2091` authorEmail `dave@test.com` →
`dave.sutton.pdx@gmail.com` + "(D1 verify)" strings scrubbed from the response
and its `cs_review_responses` audit row.

**Heals:** `cs_config/ticketing.nextNumber` 2 → 5 (six duplicate T-0001s; T-4
existed); review `5a85efc9` empty `productName` → "Intro to Wheel Throwing"
(class FK) with body made coherent.

**Seeds:** 6 tickets T-5…T-10 with real threads (incl. internal note) across
all five statuses/sources/priorities; 6 product reviews across
pending/approved/rejected (one 1★ with a phone number left REJECTED as the
moderation example); 5 glass-care FAQs (4 live, 1 hidden); +1 conversation
(T-0011) and +1 question (multiple-choice) created through the V2 UI by the
walk and kept as demo data.

## CRUD parity — SHIPPED state

| Surface | C | R | U | D | Notes |
|---|---|---|---|---|---|
| support conversations | ✅ V2 (number minted by bridge) | ✅ | ✅ reply/note/status/priority/category | ⬜ deferred | no delete in V1 either; archive = Closed |
| reviews | n/a (user-generated) | ✅ | ✅ moderate + public reply (post/edit/delete) + feature | ✅ w/ testimonial cascade | customer's words never editable |
| surveys | ✅ | ✅ | ✅ (+send-one, preview, closes-date) | ✅ responses remain | bulk segment send + VoC stay classic |
| question sets | ✅ | ✅ | ✅ checkbox picker | ✅ warns w/ affected surveys | |
| question library | ✅ | ✅ | ✅ | ✅ warns w/ affected sets | |
| survey responses | n/a | ✅ | theme tags stay classic | n/a | answers are facts |
| sending rules (triggers) | classic | ✅ | ✅ on/off + master automation toggle | classic | full editor stays classic |
| faqs | ✅ | ✅ | ✅ (+publish/hide) | ✅ | kind='faq' stamped by bridge |
| members | n/a | ✅ | n/a | n/a | read-only lens; lifecycle on Membership admin |

Every delete: `mastConfirm` + `writeAudit` + RBAC `can(route,'delete')`.

## Holistic (this PR)

Sidebar reordered around the operator's process (messages → reviews → surveys
→ FAQs → members). The **Inbox ⊃ Tickets sidebar merge** was ratified same-day
and shipped in the follow-up PR (one "Inbox" item, `data-route-alt`, legacy
byte-identical).

## Debt register — close-out

- [x] cs-tickets-v2 pre-standard twin → superseded by cs-support-v2 (#414).
- [x] Reviews reply/delete classic-only → native (#416).
- [x] FAQs publish/delete classic-only → native (#420).
- [x] ~~cs-members undemoable on sgtest15~~ — wrong; bookings is in the mode set.
- [ ] Ticket reply does not email the customer (V1 parity; product decision + CF).
- [ ] `cs_tickets` reads are bounded windows (50/200/2000) — no pagination.
- [ ] `cs_review_responses` audit sink retire-with-V1 candidate.
- [ ] engagement-inbox-v2 keeps its own thin readers of cs collections.
- [ ] Survey bulk send-to-segment, VoC digest, response theme tags, trigger
      full editor, anonymous-review policy card: classic, linked.
- [ ] Support→customer drill only when `customerId` is stamped (most manual
      tickets aren't email-resolved to a customer yet — resolver backfill
      candidate).
