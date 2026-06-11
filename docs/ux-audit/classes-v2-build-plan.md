# classes-v2 — Build Plan

Status: **SHIPPED** (2026-06-10 — plan #426, Wave 1 #427, Wave 2 #428, Wave 3 #429,
Wave 4 #430, walk-fixes #431 + #432, holistic #433, 8→6 merge #435; classic
burn-down Waves 6–8 #457/#461/#462 + walk-fix #464; all merged & verified on dev). Runs `v2-conversion-playbook.md` end-to-end for the
Classes section (sidebar `data-section="classes"`, 8 sub-items). Companion to
`sales-v2-build-plan.md` / `marketing-v2-build-plan.md` / `operations-v2-build-plan.md` /
`finance-v2-build-plan.md` / `customer-service-v2-build-plan.md` (worked examples) and
`standard-record-ui.md` §10 (archetypes) — ratified decisions applied, not re-litigated.

**Operator directives (carried from the Finance + CS rounds):** consolidate around hub
objects (don't twin 1:1); plain-language naming (owner vocabulary); V1 sunsets on V2
ratification — keep the `mastUiRedesign` flag-gating (lint requires it) but spend zero
effort on legacy-parity engineering. Sidebar merges ship after operator ratification
(Finance 12→7 and CS 6→5 were ratified same-day); module consolidation proceeds
regardless.

**Recon amendments (verified against live code before planning):**
1. The recon pass claimed `MAST_V2_ROUTE_MAP` "does not exist" — wrong. It lives at
   index.html:20834 and already maps SIX classes routes: `book→classes-v2`,
   `instructors→instructors-v2`, `resources→resources-v2`, `passes→passes-v2`,
   `enrollments→enrollments-v2`, `students→students-v2`. **`calendar` is NOT mapped**
   even though `calendar-v2.js` exists and is manifest-wired — with Legacy UI off,
   #calendar still lands on the legacy book.js calendar tab. One-line Wave-0 fix.
2. The recon missed **`sessions-v2.js`** (272L, manifest index.html:22164) — a third,
   fully built lens over `public/classSessions` (flat sortable list → read SO). It is
   ORPHANED: no sidebar item, no route-map entry, and nothing drills to it. It becomes
   the session SO for the schedule surface instead of staying dead code.
3. The recon missed **`book-settings`** — a 9th sub-surface (tab button
   index.html:11550, route registered book.js:6044) with no sidebar item and no
   `MODE_ROUTE_VISIBILITY` entry. Soft-hidden for every tenant via direct nav only
   (the Finance invisible-hub shape). Deliberately deferred — see debt register.
4. The §0c CS gotchas do NOT apply here: all 8 existing twins have static tab divs in
   index.html (`classesV2Tab` … `sessionsV2Tab`) and call `MastEntity.define` at module
   load. The twins are post-standard in chrome (pageHeader, bridges, escape hatches) —
   contrary to the "pre-standard, probably need rebuilds" prior, **five of six are
   re-usable as-is**; the gaps are write-depth, not surface quality.
5. All 8 sidebar routes are bookings-mode-gated (business-entity-constants.js:733–741;
   four also `cohortRequired:true`). sgtest15's mode set includes bookings (proven by
   the CS round's members-visibility walk finding) — verify each item in the LIVE
   sidebar during the walk anyway.

## The V1 reality

ONE 6,073-line `app/modules/book.js` serves seven of the eight routes as sub-tabs
(book.js:2012 tabMap: classes/instructors/resources/passes/enrollments/calendar/
book-reports/book-settings); `students.js` (1,563L) serves the eighth from its own
root-level `students` collection. Key facts:

- **The whole section is one scheduling pipeline**: classes (`public/classes`) are
  templates; `materializeSessions` in book.js generates occurrences
  (`public/classSessions`, FK `classId`); enrollments (`public/enrollments`, FKs
  `classId`+`sessionId`+`studentId`/`customerId`) fill seats; calendar and reports are
  lenses over the same three collections.
- **Roster actions are status writes, not a Process**: `_bookMarkAttended` /
  `_bookMarkNoShow` / `_bookPromoteWaitlist` / `_bookCancelEnrollment` SET
  status (`confirmed/waitlisted/cancelled/no-show/completed/late`) with seat-count and
  waitlist side effects. Faceted Record, not MastFlow (ratified in the twins' headers).
- **Write bridges already exist for four objects** (book.js): `ClassesBridge` (:2443),
  `InstructorsBridge` (:2502), `ResourcesBridge` (:2575), `PassesBridge` (:2616), plus
  `StudentsBridge` on students.js. **No EnrollmentsBridge and no sessions bridge** —
  the two with real side effects are exactly the two not yet extracted.
- **book-reports** (`loadReports`, book.js:5088) computes sessions-completed,
  attendance rate, active enrollments, class revenue (joins `orders`), overdue
  session-completion reports, per-class fill/revenue, repeat students — plus reads
  `sessionLogs` and incidents. A pure computed lens; no writes.
- **Pass instances vs definitions**: passes admin manages `admin/passDefinitions`
  (dual-write `syncPassDefToPublic`); purchased pass balances live per-user at
  `public/accounts/{uid}/wallet/passes` and aggregates at
  `admin/passDefinitionAggregates/{id}` (read by passes-v2 Sales facet).
- **Class reviews** live in `cs_reviews` with `source=post_class_my_classes` (owned by
  the CS round's surfaces; we cross-link, not re-host).
- **Students are their own roster** (root `students` collection: waivers, emergency
  contacts, medical/allergy notes, clearances, documents, onboarding checklist) — NOT
  a lens on `admin/customers`. Enrollments carry BOTH `studentId` and `customerId`.

### Cross-module contracts (do not break)

| Consumer | Read | Contract |
|---|---|---|
| Reports tab / future lens | `orders` (class revenue join) | order line-item shape; money via cents helpers |
| CS reviews | `cs_reviews` `source=post_class_my_classes` | class name/FK on review rows |
| cs-members-v2 | `admin/customers` `membership.*` | separate from students; no overlap action |
| Storefront booking | `public/classes` / `classSessions` / `enrollments` | status vocab + `enrolledCount` denorm; `hasBackorder`-style gates N/A |
| Wallet | `public/accounts/{uid}/wallet/passes` | pass redemption shape; definitions dual-write `syncPassDefToPublic` |

## Scorecard — the 8 routes (+2 hidden surfaces)

| # | Route | Sidebar label | V1 source | V2 home (planned) | Existing twin state |
|---|-------|---------------|-----------|-------------------|---------------------|
| 1 | `book` | Classes | book.js | classes-v2 deepened (+ schedule fields, generate-sessions, assignment, Reports lens) | classes-v2 (469L) **meets standard**; create/edit native via ClassesBridge; schedule/assignment/skills/waiver/images classic-only |
| 2 | `instructors` | Instructors | book.js | instructors-v2 (+delete, skills picker) | instructors-v2 (339L) meets standard; skills picker classic-only |
| 3 | `resources` | Resources | book.js | resources-v2 (+delete) | resources-v2 (308L) meets standard; minimal |
| 4 | `passes` | Passes | book.js | passes-v2 (+delete/archive) | passes-v2 (423L) meets standard; Sales facet reads aggregates |
| 5 | `enrollments` | Enrollments | book.js | **enrollments-v2 + write path** (roster actions, CREATE) | enrollments-v2 (288L) read-only BY DESIGN — the design no longer holds (V1 sunsets) |
| 6 | `calendar` | Calendar | book.js | **calendar-v2 — Month lens** of the schedule surface | calendar-v2 (119L) modern index control; NOT in route map (unreachable under V2) |
| 7 | `students` | Students | students.js | students-v2 (+enrollment cross-links) | students-v2 (406L) meets standard |
| 8 | `book-reports` | Class Reports | book.js tab | **Reports lens on the classes hub** | none |
| — | (`sessions-v2`) | — | book.js | **List lens / session SO** of the schedule surface | sessions-v2 (272L) built but orphaned |
| — | (`book-settings`) | — | book.js tab | deferred (debt register) | none; hidden for all tenants today |

## CONSOLIDATION

### One schedule surface — calendar-v2 absorbs sessions (2 lenses: Month · List)
*Evidence:* calendar-v2 and sessions-v2 are two views of the same
`public/classSessions` read (month grid vs flat sortable list); both already join
`public/classes` for names. The orphaned sessions-v2 *is* the missing List lens and
the missing session slide-out.
*Shape:* `calendar` route maps to the schedule surface; lens pills **Month · List**;
clicking either opens the session SO (sessions-v2's entity, kept). Session ops
(cancel / complete) move into the SO via a new bridge core on book.js.

### One classes hub — classes-v2 absorbs Class Reports (2 routes: book, book-reports)
*Evidence:* book-reports is already just a tab of book.js — a computed lens over
classes+sessions+enrollments(+orders) with zero writes. The finance-statements-v2
precedent applies: one module, the route picks the entry lens (**Catalog · Reports**).
`book-reports` stays live as a deep link.

### Evaluated, decided AGAINST consolidating
- **Students into Customers** (the cs-members question): students is a real root
  collection carrying safety-critical data (waivers, emergency contacts, medical,
  clearances) with its own lifecycle — NOT a derived lens like cs-members. Keep the
  roster; add enrollment cross-links and surface `customerId` drills where stamped.
- **Instructors + Resources + Passes into one "setup" hub**: three different
  collections, three different jobs (people you pay / rooms & equipment / products you
  sell). The CS surveys-vs-reviews precedent (different schemas, different jobs → keep
  separate) applies. Propose a *sidebar* pairing only (below), not a module merge.
- **Enrollments into Classes**: the roster is the section's daily-work queue with its
  own status filters and volume; burying it as a class facet would hide the
  operator's most-used surface. The per-class roster remains a facet; the global
  roster keeps its route.

### Sidebar proposal — for ratification (8 → 6 under the V2 nav)

Ordered around the operator's process (define classes → schedule → take bookings →
run sessions → know your students → configure):

1. **Classes** (`book`; Catalog · Reports lenses — absorbs Class Reports)
2. **Schedule** (`calendar`; Month · List lenses — absorbs the sessions lens)
3. **Enrollments** (`enrollments`)
4. **Students** (`students`)
5. **Instructors** (`instructors`)
6. **Passes & Rooms** — `passes` + `resources` as one *sidebar* group? **NO — keep
   separate items** (module-merge rejected above; a label-only group buys little).
   Final proposal is therefore **8 → 6**: Classes · Schedule · Enrollments · Students
   · Instructors · Passes, with **Resources folded under Classes' setup links** OR
   kept as item 7 if the operator prefers. Both variants prepared; operator picks at
   ratification. Legacy UI keeps all 8 items byte-identical (CS `body.nav-v2` CSS-gate
   precedent).

### Plain-language naming table

| Surface | Jargon (current) | Proposed owner vocabulary |
|---|---|---|
| Section | Classes | Classes (already plain) |
| Item 1 / hub title | Classes | **Classes** · lens pills **Catalog · Reports** |
| Item 6 label | Calendar | **Schedule** (Month · List) |
| `resources` label | Resources | **Rooms & Equipment** |
| `passes` label | Passes | **Class Passes** |
| `book-reports` label | Class Reports | (folds into Classes → Reports lens) |
| Enrollment statuses | confirmed/waitlisted/cancelled/no-show/completed/late | Confirmed · Waitlist · Cancelled · No-show · Attended · Late — `format(v)` labels only; stored vocab unchanged (storefront + reports read it) |
| Class statuses | draft/active/published/completed/archived | Draft · Active · Published · Completed · Archived (already plain) |
| Session statuses | scheduled/cancelled/completed | Scheduled · Cancelled · Completed (already plain) |

## Waves (sequenced by end-to-end demo value)

### Wave 0 — demo-data audit + scrub (sgtest15) + route-map fix
Audit `public/classes`, `public/classSessions`, `public/enrollments`, root `students`,
`public/instructors`, `public/resources`, `admin/passDefinitions` (+aggregates),
`admin/waiverSignatures`. No test/demo/harness strings incl. source-type fields;
RENAME FK-referenced placeholders (enrollments↔classes↔students↔orders FK watch),
hard-delete only unreferenced junk (report all). Seed: ~4 classes across types/statuses
("Intro to Wheel Throwing" exists at `classes/-OpAY8Tob_l-gPPBNTGy`) with generated
sessions past+future, ~10 enrollments across all six statuses (incl. a waitlist),
students with waiver/clearance variety, 2–3 instructors with skills/pay rates, rooms +
kiln resources, 2 pass definitions. Code item: `calendar: 'calendar-v2'` in
`MAST_V2_ROUTE_MAP` (ships with Wave 1 if no standalone PR is warranted).

### Wave 1 — enrollments write path (the daily-work surface)
Extract **`EnrollmentsBridge`** on book.js (state-free cores from `_bookMarkAttended`,
`_bookMarkNoShow`, `_bookPromoteWaitlist`, `_bookCancelEnrollment`, + create from
`saveEnrollment` — seat-count/waitlist side effects single-sourced; per-record actions
fresh-read on cache miss per §0c-3). enrollments-v2 SO gains the roster actions +
CREATE (class/session/student pickers), `format(v)` status labels, RBAC
`can('enrollments','edit')`. Respect immutability: completed/attended enrollments get
no edit; cancel ≠ delete.
*Demo:* student calls to book → CREATE enrollment → session fills → promote from
waitlist → after class, mark attended/no-show.

### Wave 2 — the Schedule surface (calendar + sessions + session ops)
Route map `calendar → calendar-v2`; calendar-v2 gains **Month · List** lens pills (List
= the orphaned sessions-v2 list, de-orphaned); session SO (sessions-v2 entity) gains
cancel/complete via a `SessionsBridge` core (cancel reflows enrollments — single-source
it); classes-v2 Sessions facet rows drill to the session SO; session SO drills to its
class and its roster (filtered enrollments).
*Demo:* open Schedule → next week's sessions → one session → see its roster → cancel a
session (enrollment side effects visible) → complete one.

### Wave 3 — classes hub deepening (generate sessions, assignment, Reports lens)
classes-v2 edit gains schedule fields (recurring days/time, once-date) +
instructor/resource pickers (dropdowns over the loaded rosters); **Generate sessions**
action on the class SO delegating to a `materializeSessions` bridge core; the classes
module becomes the 2-route hub (`book`, `book-reports`) with the **Reports lens**
(report tiles + per-class fill/revenue table + repeat students, `loadReports` logic
extracted to a state-free core). Skills/certs pickers, series pricing, waiver picker,
image library: classic-linked (debt register).
*Demo:* new class start-to-finish — create → assign instructor + room → generate
sessions → see them on Schedule → check Reports.

### Wave 4 — setup rosters + cross-links + delete parity
Delete verbs with `mastConfirm` + `writeAudit` + RBAC `can(route,'delete')` + FK
checks: instructors (warn when assigned to classes), resources (warn when referenced
by name), passes (archive over delete when instances/aggregates exist), classes
(draft-only delete; otherwise archive), students (warn when enrollments reference).
Cross-drills via `MastEntity.drill` with `ensureLoaded()`-gated fetch: enrollment →
class / session / student / customer; instructor → classes; student → enrollments
facet; class → roster.

### Wave 5 — holistic (walk FIRST, then PR)
Operator walk: every route, every record, every CRUD verb incl. CREATE on fresh
records, cold cross-drills both directions, both themes, console every time. Then:
sidebar reorder + 8→6 consolidation + naming proposal for ratification, CRUD parity
table, debt register close-out, plan doc status → SHIPPED.

## CRUD parity — target end-state

| Surface | C | R | U | D | Notes |
|---|---|---|---|---|---|
| classes | ✅ | ✅ | ✅ (+schedule, assignment, generate) | ✅ draft-only; else archive | publish stays a status write |
| sessions | ✅ via generate | ✅ | ✅ cancel/complete | ⬜ no hard delete (enrollment FKs) | cancel reflows enrollments |
| enrollments | ✅ | ✅ | ✅ roster status actions | ⬜ cancel, never delete | completed/attended immutable |
| calendar | n/a (lens) | ✅ | n/a | n/a | Month · List |
| reports | n/a (lens) | ✅ | n/a | n/a | computed |
| instructors | ✅ | ✅ | ✅ | ✅ w/ assignment warn | skills picker classic for now |
| resources | ✅ | ✅ | ✅ | ✅ w/ reference warn | name-string FK from classes |
| passes | ✅ | ✅ | ✅ | ✅ archive-preferred | dual-write via PassesBridge |
| students | ✅ | ✅ | ✅ | ✅ w/ enrollment warn | waiver/clearance tooling classic |

Every delete: `mastConfirm` + `writeAudit` + RBAC `can(route,'delete')`.

## Debt / known leftovers (tracked, not blocking)

- [ ] `book-settings` hidden tab (waiver templates, booking policies?) — no visibility
      entry anywhere today; needs its own design decision, not a silent twin.
- [ ] Skills/certs pickers, series pricing form, waiver template picker, class image
      library: classic-linked from classes-v2.
- [ ] Student clearance-types mgmt, business documents, waiver template tooling:
      classic-linked from students-v2.
- [ ] `sessionLogs` / incidents reporting depth (reports lens shows the tiles; the
      per-session completion-report flow stays classic).
- [ ] `classes.resourceName` is a name-string pseudo-FK — real-FK backfill candidate.
- [ ] Enrollment list reads are bounded windows (500/1000/2000) — no pagination.
- [ ] Pass INSTANCE admin (per-user wallet passes) has no admin surface — out of
      scope; definitions only.


## Walk findings (2026-06-10 — every route, every CRUD verb incl. CREATE, cold cross-drills, both themes)

1. **Session generation was dead in LEGACY** — `materializeSessions` batch-wrote
   via an RTDB-style root multi-path `MastDB.update('', {…})`, which throws
   `path requires doc ID: _root` on Firestore MastDB. Broken since the
   migration; only the walk's Generate-sessions click surfaced it. Fixed #431
   (per-doc writes); the V2 Generate action then produced a correct session
   (1:00–3:30 PM from a 150-min duration, instructor/room denormalized).
2. **Waitlist renumbering never worked either** — `renumberWaitlist` fanned out
   to `admin/enrollments` (wrong collection + multi-path); every promote/cancel
   warned and positions never compacted. Fixed #431.
3. **resources-v2 and instructors-v2 CREATE were dead since their conversion**
   — `required:true` on the name field + custom editRender inputs without
   `name=` attributes → the engine pre-validate collects an empty record and
   blocks onSave (the contacts-v2 gotcha, **third occurrence**). Fixed #432.
4. **`MastDB.resources.PATH` is `admin/resources`, not `public/resources`** —
   the recon (and the Wave-0 seed) used the wrong home; seeded resources were
   invisible to every reader. Healed by migrating the 3 docs to
   `admin_resources` (Firestore REST, reported below).
5. Exercised end-to-end: class CREATE (record + schedule + assignment in one
   form) → Generate sessions → session visible on Schedule; enrollment intake
   CREATE (dependent class→session picker, student autofill, capacity-aware);
   waitlist promote (seat counter bumped, SO re-rendered Confirmed); mark
   attended; session mark-completed; resource CREATE → mastConfirm DELETE
   (`#mastDialogOK`-scoped) → re-create kept as demo data ("Annealing Oven");
   instructor → class drill, calendar → session SO cold drill (module
   lazy-loaded), session roster → enrollment drill, student Enrollments facet
   (studentId OR email join — both seed and walk-created rows joined). Both
   themes screenshot-verified; console clean on every clean boot.

## Scrub report (Wave 0 + walk, sgtest15 — standing authorization, all hard deletes listed)

**Hard deletes (449 docs):** 64 junk classes (45 E2E/Retest/Break/validation-fixture
names incl. XSS/AAAA…/Bad Type/Negative Price + 19 more matched fixtures; 2
operator-named duplicates: second "Morning Clay Workshop", "Evening Wheel Throwing
with Dave"); 101 sessions + 151 enrollments belonging to those classes; 2 junk-named
enrollments in kept classes (Test Student / E2E Student); 125 harness students
(`stu_*` @test.com); 4 orphaned waiver signatures (security-test signers referencing
deleted students). Walk fixture: 1 resource ("Annealing Oven") created and deleted to
prove the delete verb, then re-created as demo data.

**Renames in place (FK-referenced):** class "Dave's Wheel Throwing" → "Advanced
Wheel Throwing" (2 enrollments reference it); instructor `Af6fCNEf…` "harness-test-…
Real Instructor" → "Maya Brennan" (slug healed too); pass defs "harness-l3-sp-… 5-Class
Glass Pass" → "5-Class Glass Pass", "B9 Verify Pass" → "10-Visit Studio Pass"
(visitCount 5→10, description rewritten); student Maria Rodriguez `contactId`
'test-contact-001' → null.

**FK heals (docs recreated at the ids live records reference):** instructor
`-OpB3FF5…` "David Stewart" (21 classes), instructor `-Ooyt3sd…` "Sarah Chen" (kept
sessions), resource `-Ooyt49k…` "Main Studio" (kept sessions). Recurring schedules
extended to late July (3 classes).

**Seeds:** resources Kiln Room + Fusing Lab (later migrated to `admin_resources`
with Main Studio — walk finding 4); instructor Jonah Reyes; 6 students (waiver
variety, one minor w/ emergency contact, allergy note); 10 future sessions
(Jun 11–Jul); 10 enrollments across confirmed/waitlisted/cancelled. Walk writes kept
as fixtures: class "Glass Bead Making" (+1 generated session), Carlos Mejia fusing
enrollment, Jenny Park promoted seat, Elena Vasquez attended seat, 1 completed April
session, resource "Annealing Oven".

## CRUD parity — SHIPPED state

| Surface | C | R | U | D | Notes |
|---|---|---|---|---|---|
| classes | ✅ V2 (record+schedule+assignment) | ✅ | ✅ (+⚙ Generate sessions) | ✅ draft-only, no-enrollments, session cascade | publish/unpublish stays classic (checklist) |
| sessions | ✅ via Generate | ✅ (3 lenses + SO w/ roster) | ✅ complete / cancel | ⬜ no hard delete (enrollment FKs) | |
| enrollments | ✅ intake (capacity-aware → waitlist) | ✅ | ✅ attended/late/no-show/promote/cancel | ⬜ cancel, never delete | attended/cancelled rows immutable (no actions) |
| calendar / reports | n/a (lenses) | ✅ | n/a | n/a | Month·List; Catalog·Reports |
| instructors | ✅ (#432) | ✅ | ✅ | ✅ w/ assignment warn | skills picker classic |
| resources | ✅ (#432) | ✅ | ✅ | ✅ w/ reference warn | |
| passes | ✅ | ✅ | ✅ | ✅ archived-only + public-mirror cascade | |
| students | ✅ | ✅ (+Enrollments facet) | ✅ | ✅ w/ enrollment warn | clearances/documents/waivers classic |

Every delete: `mastConfirm` + `writeAudit` (bridge core) + RBAC `can(route,'delete')`.

## Holistic (this PR)

Sidebar reordered around the operator's process (classes → schedule → enrollments →
students → instructors → rooms → passes → reports) with plain-language labels
(**Schedule**, **Rooms & Equipment**, **Class Passes** — registry labels updated to
match). The **8 → 6 consolidation** (Class Reports folds into Classes, Rooms &
Equipment folds under Classes setup) was **RATIFIED same-day (Option B: Rooms as a hub lens)** and shipped in the
follow-up PR (CS `data-route-alt` precedent).

## Debt register — close-out

- [x] calendar-v2 unreachable under V2 → route-mapped (#427).
- [x] sessions-v2 orphan → de-orphaned as the Schedule List lens (#428).
- [x] enrollments read-only → full roster verbs + intake (#427).
- [x] Generate sessions / schedule / assignment classic-only → native (#429); legacy generation was BROKEN — fixed (#431).
- [x] resources/instructors CREATE dead → fixed (#432).
- [ ] `book-settings` hidden tab — needs its own design decision.
- [ ] Skills/certs pickers, series pricing, waiver picker, image library: classic-linked from classes-v2.
- [ ] Student clearance-types mgmt, business documents, waiver tooling: classic-linked from students-v2.
- [ ] Reports lens uses seat revenue (enrollment pricePaidCents); legacy order-line join + sessionLogs/incidents depth stays classic.
- [ ] Publish/unpublish (pre-publish checklist) stays classic — candidate for a guided V2 action.
- [ ] `classes.resourceName` name-string pseudo-FK — backfill candidate (resourceId now stamped by the V2 assignment picker).
- [ ] Enrollment list reads are bounded windows (500/1000/2000) — no pagination.
- [ ] Pass INSTANCE admin (per-user wallet passes) — out of scope; definitions only.
- [x] 8→6 sidebar merge — **RATIFIED + SHIPPED 2026-06-10 (Option B)**: Class Reports + Rooms & Equipment fold into the Classes hub (Catalog · Rooms & equipment · Reports lenses); one "Classes" item claims `book-reports` + `resources` via `data-route-alt`; legacy keeps all eight items byte-identical (`.classes-merged-v1/-v2`).

## Classic burn-down (operator directive: V1 is being REMOVED — escape hatches convert, 2026-06-10)

- **Wave 6 (#457)** — classes-v2 editor completion: Series pricing & rules, Policies
  (waiver template picker, enrollment window), Required certifications, Required
  skills (+add-new via the catalog core), Class image (shared openImagePicker +
  /uploadImage CF), Publish/Unpublish on the SO (`ClassesBridge.setExtras/publish/
  unpublish/ensureSkill`). All classes-v2 + sessions-v2 'classic view' copy removed.
- **Wave 7 (#461)** — Run-session runtime on the session SO: check-in (one/all),
  start class, close-out (attended/no-show w/ soft waiver enforcement), complete
  session (auto-completes open seats + notes), incident recording, walk-in via the
  enrollment intake preset. `SessionsBridge` run cores; survey side effect resolves
  classId from the enrollment.
- **Wave 8 (#462)** — instructors-v2 native skills picker; classes hub **Settings
  lens** (the hidden legacy book-settings tab's V2 home: cancellation window +
  cert-types CRUD via `ClassSettingsBridge`; `book-settings` remaps); passes-v2
  **Holders facet** (per-instance cohorts via `PassesBridge.cohortDefs/
  instanceMatches/loadInstances`). Classes-domain classic links: **0**.
- **Walk-fix 3 (#464)** — checkbox collectors were scoped to a non-existent
  `#mastSlideOut` (body is `#mastSlideOutBody`): recurring schedule days (since
  Wave 3), required certs/skills and instructor skills silently saved empty.
- **Walk proof (live)**: skill added through the catalog core → checked → saved;
  cert requirement saved; class published through the checklist (status
  `published` + `publishedAt`); run-session check-in-all → start → close-out
  exercised on sess_wtb_0616 then HEALED back to pre-run state (session
  classStartedAt/By cleared; 3 enrollments → confirmed, stamps cleared — reported);
  Settings lens loads config 48h + cert type with Edit/Archive; Holders cohorts
  render with live counts (1 revoked instance).
- **Remainder (flagged in classic-dependency-burndown.md)**: students.js deep
  tooling (clearances/documents/waiver templates CRUD) has no V2 write path and
  no classic link — Phase-2 gate item, not a link.
