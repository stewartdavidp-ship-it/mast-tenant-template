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
2. **Finance burn-down session**: day-close form, amendment-modal rehome, dunning
   settings, AR detail, tax export, then the reports generators (largest single item).
3. **Marketing**: blog editor (largest single surface — needs its own session).
4. **Classes**: schedule generator session.
5. **Ops/Sales sweep**: channels wizard, Shippo labels, consignments, contacts sync.

## Full inventory (per module)

See the audit table in this doc's source PR description and per-section plan debt
registers; the authoritative live check is the grep above. Key per-section counts:
Sales 4 · Marketing 7 · Operations 2 · Customer Service 4 · Classes 3 · Finance 9 ·
Contacts 1 · Misc 5 (+ legacy-function reuse: finance amendment submit modal).

## Standing rule for all future conversion work (playbook-enforced)

**No new classic escape hatches, ever.** A wave that can't rebuild a sub-surface
re-scopes the wave — it does not link to V1. The playbook's "single-sourced on
legacy" pattern is deleted as of this PR.

## Progress

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
