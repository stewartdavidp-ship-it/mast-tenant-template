# COORDINATION

Running log of cross-agent / cross-session coordination notes for the Mast Tenant Template repo.
Most-recent entry first.

---

## [UX-polish agent] 2026-05-25 — QBO `#accounting` UX polish (W1)

Operator feedback: "not connected back to Settings, you need to go back to main NAV
to do anything, the tabs have a different feel from other buttons, and overall it is
not clear what you are supposed to do."

Three patches landed in one commit on `app/modules/accounting.js`:

1. **Canonical sub-view switcher.** Replaced the `<a class="subview-tab">` link row
   with the Mast canonical `btn btn-secondary btn-small` row (active tab promoted
   to `btn-primary`). Matches finance.js AR / Cash Flow sub-view pattern. The tabs
   now feel native to the rest of the admin.
2. **Breadcrumb / back-link.** Added a `← Settings · Integrations` link in muted
   color above the page header. Click navigates to `#settings` and opens the
   Integrations sub-view via `switchSettingsSubView('integrations')`, so users
   land on the QBO panel they came from instead of the top of the main nav.
3. **Per-sub-view guidance.** Each sub-view (Connection / COA Map / Sync Log)
   now opens with a `var(--text-secondary)` paragraph explaining what's on the
   tab and what to do next. Connection has two variants (not-connected vs
   connected). COA Map has two variants (saved vs unsaved mapping). The W1
   auto-suggest banner still renders above the table on the unsaved branch.

- Commit SHA: _(to be filled by commit step)_
- Deploy version SHA: _(to be filled by `mast_hosting deploy pod=dev` step)_

No public-page changes. No new MCP coverage required (UI polish only).
