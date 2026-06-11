# Classic-Dependency Burn-down — every V1 link must die before V1 does

**Status:** RATIFIED DIRECTIVE (operator, 2026-06-10): "The plan was to always retire
V1. We need to go back and identify on every module the areas we have this issue and
fix it." The conversion rounds used a "single-source heavy sub-surfaces on legacy with
a link" pattern — that pattern was NEVER operator-sanctioned and is hereby retired.
Every capability behind a classic link needs a V2 home (or a conscious operator
decision to drop the feature). **V1 deletion (v1-removal-and-rollout-plumbing-plan.md)
is GATED on this burn-down: `grep -c "navigateToClassic(" app/modules/*.js` → 0.**

Audit date 2026-06-10: **43 `navigateToClassic()` call sites across 39 V2 modules**,
plus legacy-function reuse (e.g. the amendment submit modal). Inventory below is the
work plan; classifications: DELETE-LINK (V2 already covers it), REBUILD-S (small
form/list/action), REBUILD-M (real sub-surface w/ writes), REBUILD-L (major surface).

## Totals

| Class | Count | Notes |
|---|---|---|
| DELETE-LINK | 2 | analytics sources launcher; statements day-close nav (retargeted to the close hub in this PR) |
| REBUILD-S | 16 | forms/lists/actions: day-close form, amendment modal rehome, dunning settings, coupons share/QR, lookbook share, receipts match, instructors, passes, FAQs, wholesale, vendors, sales-events, inquiries, loyalty, team, portfolio bulk-tag |
| REBUILD-M | 11 | channels OAuth wizard, fulfillment label purchase (Shippo), consignment placements/payouts, cs-reviews reply+UGC, cs-members grants/config, cs-surveys, contacts interactions+Google/Drive sync, homepage editors, tax export, AR detail/payment posting, commissions detail+intake |
| REBUILD-L | 4 | **blog rich-text editor**, **classes schedule generator** (sessions/pricing/skills/waivers), **finance-reports 6 generators** (loan/tax wizards + 4 snapshot exports), commissions/channels borderline |

Estimated effort ~34–45 build-days equivalent; conversion-round velocity suggests
substantially less in practice (bridge cores already exist for most writes).

## Sequencing (recommendation)

1. **Quick wins + S-tier per section** rides each section's NEXT touch (Customer
   Service round picks up its 4 sites as in-scope work, not debt).
2. **Finance burn-down session**: ✅ **DONE 2026-06-10** (PRs #454, #456, #459,
   #463, #466, #467 + boot hotfix #468) — day-close drawer form, amendment-modal
   rehome, dunning settings + reminder audit log, portfolio bulk tagging (new
   engine selectable-rows primitive), nexus registration CRUD + 1099 prep panes,
   and all six report generators native. The amendment-modal legacy-function
   reuse (`FinanceBridge.openSubmitAmendment`) is also retired (state-free
   `submitAmendment` core).
3. **Marketing**: blog editor (largest single surface — needs its own session).
4. **Classes**: ~~schedule generator session~~ — ✅ DONE 2026-06-10 (#457 editor completion incl. publish, #461 run-session runtime, #462 instructors skills + Settings lens + pass Holders, #464 selector walk-fix). Classes-domain classic links: **0**.
5. **Ops/Sales sweep**: channels wizard, Shippo labels, consignments, contacts sync.

## Full inventory (per module)

See the audit table in this doc's source PR description and per-section plan debt
registers; the authoritative live check is the grep above. Key per-section counts:
<<<<<<< HEAD
Sales 4 · Marketing 7 · Operations 2 · Customer Service 4 · ~~Classes 3~~ **Classes 0** (✅ 2026-06-10) · ~~Finance 9~~ **Finance 0** (✅ 2026-06-10, incl. the amendment-submit legacy-function reuse) ·
Contacts 1 · Misc 5.
=======
<<<<<<< HEAD
Sales 4 · Marketing 7 · Operations 2 · Customer Service 4 · ~~Classes 3~~ **Classes 0** (✅ 2026-06-10) · ~~Finance 9~~ **Finance 0** (✅ 2026-06-10, incl. the amendment-submit legacy-function reuse) ·
Contacts 1 · Misc 5.
=======
Sales 4 · Marketing 7 · Operations 2 · **Customer Service 0 (✅ done 2026-06-10)** ·
Classes 3 · Finance 9 · Contacts 1 · Misc 5 (+ legacy-function reuse: finance
amendment submit modal).

### Customer Service — COMPLETE (4 → 0)

All four sites converted in one PR (`grep -c "navigateToClassic(" app/modules/cs-*.js` → 0):
- **cs-surveys-v2**: native sending-rule editor (create/edit/delete via
  CsSurveysBridge.saveTrigger/deleteTrigger cores), bulk send-to-a-saved-segment
  (segment picker + member count + capped batches w/ progress), response theme
  tags (inline editor, server-parity normalization in the bridge), and the VoC
  digest (the legacy generator was already route-agnostic — exposed as
  CsSurveysBridge.vocDigest).
- **cs-reviews-v2**: Draft-social and Ask-for-photo as native SO actions
  (CsReviewsBridge.draftSocial/askPhoto — both legacy helpers were
  document.body modals, route-agnostic) + the anonymous-review policy card on
  the page (cs_config/reviews + public mirror via the bridge).
- **cs-members-v2**: classifier correction — the legacy CS Members tab was
  ALSO read-only (no grant/revoke handlers exist in customer-service.js); the
  lifecycle lives on the Membership program surface. The classic link was a
  DELETE-LINK, replaced with a Membership cross-link. (Membership's own
  burn-down items belong to its section, not CS.)
- **cs-faqs-v2**: dead classic() handler deleted (its link died in CS Wave 4).
>>>>>>> abce384 (feat(cs): classic-dependency burn-down — Customer Service 4 → 0)
>>>>>>> 36fe251 (docs(finance): classic burn-down close-out — Finance 9 → 0, plan debt register, playbook lessons (#469))

## Standing rule for all future conversion work (playbook-enforced)

**No new classic escape hatches, ever.** A wave that can't rebuild a sub-surface
re-scopes the wave — it does not link to V1. The playbook's "single-sourced on
legacy" pattern is deleted as of this PR.

## Progress

- **2026-06-11 — Operations section: 0 classic sites remaining (incl. silent
  gaps).** Five PRs: contacts (interaction log / inquiry respond / Google sync
  native over ContactsBridge cores); team (the five sub-surfaces — Time Clock,
  PTO, Labor Burden, Documents, Onboarding — re-hosted INSIDE team-v2 as page
  lenses via a container-agnostic `TeamPanels` host with host-aware post-write
  refresh); channels (create / OAuth connect / product assignment native over
  ChannelsBridge cores; recon note: autoMatchSources + inventoryModel have no
  legacy editor and no disconnect flow exists — nothing to port); trips
  (SILENT gap — no link existed: flow modals are body-level and now reachable
  from trips-v2, + a re-hosted Tax-report lens); customers (SILENT gap:
  segments over the shared customer-filters matcher, tags/notes editors,
  wallet-adjust entry points, recompute; merge was already V2-homed in
  duplicates-v2). Party template gained additive `overviewActions` /
  `walletActions` hooks. **Carve-outs (operator-ratified):** `advisor.js` is
  PARKED — it is the current implementation (soft-hidden, awaiting Entity
  Phase 2 streams); Phase 2 V1-deletion must NOT sweep it. The mapping guided
  wizard is generation-agnostic (boot-trigger overlay) and already token-clean
  — it stays. NOTE for the gate: silent gaps don't show in the
  `navigateToClassic` grep — each section close-out should also assert
  "every legacy-only WRITE capability has a V2 entry point".
- **2026-06-10 — Admin section: 0 classic sites remaining.** Both admin hatches
  retired in one PR: (1) Site Traffic's "Sources & revenue" classic launcher →
  native Sources lens on analytics-v2 over the new shared
  `window.AnalyticsSources` compute core (the W2.5 roll-up extracted state-free;
  legacy panel re-uses it); (2) Team Access's "classic Permissions page" link →
  per-user override editing (per-area Level pickers + sensitive grants + access
  expiry) on the member edit form via `EmployeesBridge.saveUserOverrides`
  (legacy saveUserPermissionOverrides delegates to the same core).
  `grep -c "navigateToClassic(" app/modules/*.js` now counts the other
  sections' sites only.

## Classes-domain remainder (NOT a link — flagged for the Phase-2 gate)

`students-v2`'s Clearances / Documents facets are read-only; their CRUD (plus
waiver-template tooling) lives only in legacy `students.js` with no
navigateToClassic link, so the 43-site census never counted it. Before V1
deletion, that tooling needs a V2 home (clearances CRUD = S; documents involve
uploads/Drive = M; waiver templates are shared with the storefront e-sign flow = M).
