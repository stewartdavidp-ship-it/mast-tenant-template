# V1 Editor Elimination — program plan

**Goal:** retire the last three V1 *rich editors* by giving their V2 twins native
authoring surfaces, so the admin app has **zero `navigateToClassic` escape hatches**.
This closes the gap left by the marketing-v2 native-*create* work (PR #496): create +
light edit are native, but **rich authoring still punts to V1** on three surfaces:

| Surface | V2 twin | Classic punt (to delete) | Legacy editor |
|---|---|---|---|
| Blog | `blog-v2.js` | `BlogV2.classic()` → `navigateToClassic('blog')` (button `blog-v2.js:212`) | `renderBlogEditor` `blog.js:305-623` (+helpers to ~2007) |
| Stories | `stories-v2.js` | `StoriesV2.classic()` → `navigateToClassic('stories')` (`:149-150,298`) | `openStoryCuration`/`buildStoryCurationHtml` `production.js:2673-3303` |
| Newsletter | `newsletter-v2.js` | `NewsletterV2.classic()` → `navigateToClassic('newsletter')` (`:243-254,445-449`) | `renderNLCompose` grid composer `newsletter.js:393-1980` |

## Principle: native UI, backend stays backend

"No V1 UI" means the **editor UI** must be native V2. A genuine backend service
(Cloud Function / queue / cron / external API) **stays a server call triggered from
the native UI** — rebuilding it is out of scope. What stays server-side:

- `socialAI` httpsCallable — AI polish / tag-suggest / section-polish (`blog.js:1701`, `newsletter.js:1198`). Real inference.
- `/uploadImage` CF (`callCF`, `index.html:16876`) — base64 upload + thumbnail.
- **Email send**: there is *no send CF* — the editor **enqueues** per-recipient docs to `tenants/{tid}/emailQueue/{idempotencyKey}` and a server `processEmailQueue` worker drains it (`newsletter.js:1910`, same pattern as finance/orders/procurement). Native UI keeps enqueuing; the worker + A/B winner cron stay backend.
- LabelKeeper print (stories QR "Print Card", `production.js:2455`) — optional, key-gated HTTP call.
- `MastAskAi.openWithReturn` — Claude Desktop deep-link.

## The native pattern (already proven in products-v2)

Every heavy surface follows the **"heavy edit → drilled slide-out"** rule
(memory `feedback_heavy_edit_drill_so`), implemented today by products-v2's image /
recipe / variant editors:

1. Define a dedicated `MastEntity` with **`route: null`** (drill-only, never a sidebar route), `size:'lg'`/`'xl'`. (`product-images-v2` `products-v2.js:1999`; `recipe-v2` `:1631`.)
2. Its `detail.render` builds the heavy editor body from `MastUI` primitives.
3. Open via `MastEntity.drill('<surface>-edit-v2', id)` from the twin's detail pane (replaces the classic button). `drill()` pushes the parent on `_panelStack` with a Back crumb (`mast-entity.js:382-422`).
4. **Every write goes through a `*Bridge`** in the legacy module (`lint-rbac` CHECK C blocks a route-owning module that does `MastDB.set/update/remove/push/newKey` without `can()` — so the v2 file must stay write-free and delegate). Gate inside the bridge on `can('<module>','edit')` (RBAC axes are `view/edit/delete` — **no `'create'` axis**).
5. Re-render in place via `MastEntity.openRecord(key, rec, 'read', true)` (the `true` keeps the drill stack) and sync the parent cache, mirroring `reopenImagesDrill` (`products-v2.js:2054`).

## Platform prerequisites (build these first — shared by blog + newsletter)

These don't exist today and block safe rich-text:

- **P0 — HTML sanitizer.** Repo has *no* DOMPurify/allow-list utility (grep: zero). Both blog `bodyHtml` and newsletter section HTML are injected **raw** into the storefront and email. Add a shared allow-list sanitizer (`b/i/u/a[href]/br/p/h2/h3/ul/ol/li/blockquote/img[src]/span` + strip `script/iframe/on*=/javascript:`), stronger than the current `blogSanitizeHtml` (`blog.js:763`), and call it **inside the Bridge write methods** so no authored HTML reaches a public surface unsanitized. *(Stories needs none — its data model is plain-text + image URLs, already escaped on the storefront via `escHtml` in `product.html`.)*
- **P1 — rich-text editor (decide reuse vs extract).** A `contenteditable` + `execCommand` toolbar exists **only** inside `blog.js` (and a second one in `newsletter.js` sections) — there is no shared `MastUI` primitive. Options: (A) **plain-text-with-wrap** (lowest risk; today's `blogPlainToHtml` floor), (B) host the legacy contenteditable DOM in the drilled pane behind a new `Bridge.setBody`, (C) extract a shared `MastUI.RichText`. Recommend **C** once, then reuse for blog + newsletter (avoids porting two divergent editors). `execCommand` is deprecated/brittle — port verbatim first, modernize later.

## Per-surface plans

### 1. Stories — `M` (~600-900 lines), do FIRST (lowest risk, proves the pattern)
- **Why first:** no CF, **no sanitizer needed** (plain-text data model; storefront already escapes), `StoriesBridge` already exists (`production.js:3452`), and products-v2's image-drill is a near-1:1 template.
- **Native surface:** `story-curation-v2` drilled entity (`size:'lg'`) replacing `openStoryCuration`. Reproduce `buildStoryCurationHtml`: title, the 3 photo sources (build-media grid via `MastDB.buildMedia.get`; content-composer images; freeform upload reusing `uploadStoryMediaFromInput` `:3040` verbatim — client compress + Storage, no CF), the entries assembler (milestone + caption + reorder + delete), Preview (`showStoryPreview`, window-exported).
- **Expand `StoriesBridge`** (all gated `can('stories','edit')`): `saveEntries(id,{title,entries})` (wrap `saveDraftStory` shape), `publish(id)` (wrap `publishStory`: operator-aggregation + `generateStoryQRCodes` + product `storyId` back-fill + audit, `:3172-3222`), `unpublish(id)` (wrap `:3238`). QR lib + Print/Copy/Print-Card render natively (LabelKeeper stays a triggered HTTP call).
- **Storefront contract unchanged** (status / entries map / `operators[]` / `qrCodes[]` / product `storyId` back-fill) → `product.html loadProductStory` needs zero changes.
- **Watch:** freeform upload hard-requires a saved `storyId` first (`:3045`) — auto-create the draft before first upload; QR/operators only exist for job-linked stories; call `reloadSoon()` after publish (twin uses one-shot reads, not the legacy live listener).

### 2. Blog — `L` (~700-1100 lines, ~2 PRs)
- **Native surface:** drilled `blog-editor-v2` (or extend the existing `editRender`). Port from `renderBlogEditor`: rich body (toolbar/slash/emoji/link/word-count/autosave), inline images (`openImagePicker` for library, `/uploadImage` for upload), coupon embed (`MastCouponCard`), featured image, author + author-photo, SEO/schema, excerpt, status, schedule, publish.
- **Expand `BlogBridge`** (currently `create`/`updateMeta`/`removeDraft`, `blog.js:2318`): add `setBody(id, html, inlineImages)` **with P0 sanitize**, `setInlineImages`, `setFeaturedImage`, `setAuthor`, `setAuthorPhoto` (cross-cutting write to `admin/users/{uid}/profile` — *must* be a bridge method), `setStatus`, `schedule(id, iso)`, `publishToWebsite(id)` (reproduce `blog.js:2128-2172` exactly — composes `bodyHtml`, denormalizes author **name**, writes `blog/published`), `unpublish(id)`; widen `updateMeta` to slug/metaDescription/canonical/ogImage/schemaType.
- **AI polish / suggest-tags / Draft-in-Claude:** native buttons triggering `socialAI` / `MastAskAi`; write results back via bridge.
- **XSS (high):** native rich editor emits real HTML → storefront injects `blog/published.bodyHtml` raw. `setBody` **must** sanitize (P0). Today's `BlogBridge.create` sidesteps this by taking plain text only — a rich editor cannot.
- **Watch:** marker round-trip (`[Image N]`/`[Coupon:CODE]` ↔ spans) must survive load→edit→save→publish (`blogLoadBodyToEditor`/`blogSaveBodyFromEditor`/`blogRenderBodyToHtml`); scheduled publish is **client-on-load only** (`blogCheckScheduledPosts:2011`), a pre-existing latent bug — flag, don't silently inherit; other deep-links into `blog` exist (`composer.js`, `marketing-calendar-v2`) — repoint before retiring the route.

### 3. Newsletter — `XL` (~1400-1800 lines + ~300 bridge, ~3-4 PRs) — operator priority ("full native composer")
- **Native surface:** drilled `newsletter-compose-v2`. Port `renderNLCompose`: list/grid views, the **2-col grid packer + drag/drop** (`nlRepackGrid:818`, `nlDrag*:832`), 9 section types + guided prompts, per-section rich-text (port `nlFormat*` `:680-759`), per-section AI polish (`socialAI` `newsletterPolish`), coupon/image/upcoming-events section helpers, card-size/char-limits, audience segment picker + live recipient estimate, A/B panel, Preview/Export.
- **Expand `NewsletterBridge`** (currently subscriber + `createIssue`/`updateIssue`/`removeIssue`): `addSection`/`updateSection`/`deleteSection`/`reorderSections`, `setSectionCoupon`/`setSectionImages`, `setAudienceSegment`, `setAbTest`, `publishToWebsite`, **`queueSend`/`queueTest`** (wrap `_nlQueueRecipients`/`nlSendTest` verbatim — keep the `sha1(issueId|segment|email|variant)` idempotency key identical), `pickWinnerNow`. **P0 sanitize** section HTML inside `updateSection`/`queueSend`/`publishToWebsite`.
- **Send stays backend:** native UI only writes `emailQueue` + `admin/emailSends`; `processEmailQueue` + A/B winner cron stay server-side and are triggered by those writes (no new CF).
- **XSS (highest):** section body is raw `contenteditable` HTML injected unescaped into **both** the email and the public `newsletter/published` `/news` doc. Sanitize in the bridge — top-priority correctness risk.
- **Watch:** A/B stashes `variantB.htmlBody` + `holdoutRecipients` on the issue at send (`:1838`) for the cron — native send must write the same shape; two divergent HTML builders exist (`nlExportHTML` preview vs `nlComposeIssueHtml` send) — unify to avoid preview/send drift; saved segments have no real filter engine (`nlMatchSubscribersForSegment` defaults to "all") — keep the documented limitation or implement real eval, don't silently imply filtering.

## Recommended sequencing

0. **(this PR)** Newsletter **Issues-first** default lens (newsletters lead, subscribers secondary) — shipped here alongside this plan.
1. **P0 sanitizer + P1 rich-text decision** — small shared PR; unblocks blog + newsletter safely.
2. **Stories** — cheapest, proves the drilled-canvas + bridge-expansion pattern end-to-end.
3. **Newsletter** (operator priority) — the XL composer, split across ~3-4 PRs (bridge → grid/sections → audience/A-B → send/publish + delete the punt).
4. **Blog** — the rich Builder.
5. **Cleanup** — once each twin is unflagged and parity-verified, delete the `*V2.classic()` punts + the legacy editor UI; legacy modules retain only the non-UI `*Bridge` + storefront-snapshot side effects.

> Newsletter can be pulled ahead of Stories if the operator wants it first — note it's the riskiest (XSS + grid + send), so doing the P0 sanitizer immediately before it is non-negotiable. Each PR touches `app/modules/*.js` → must bump `MAST_MODULES_V` + regen `docs/generated/admin-inventory.md`.

## Cross-cutting risks (all three)

- **`lint-rbac` CHECK C:** any `MastDB` write emitted directly from a `*-v2.js` file (not behind a `*Bridge`) fails the ratchet. All new writes route through the bridge in the (already-baselined) legacy module.
- **load-before-save race:** twins must `MastAdmin.loadModule('blog'|'production'|'newsletter')` so `window.*Bridge` exists before save; guard new bridge calls with the "engine still loading" toast (existing convention).
- **No second panel:** there is one slide-out; `drill` re-renders it with a Back stack (no parent+child split). Adequate for the pattern, but a constraint.
- **Audit:** legacy editors mostly omit `writeAudit`; add it consistently in the native onSave paths (don't double-audit create — the twins already audit it).
