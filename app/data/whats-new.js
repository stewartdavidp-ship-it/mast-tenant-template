// ============================================================
// MAST_WHATS_NEW — "What's New" release feed
// ============================================================
// Source of truth for the What's New viewer (Avatar menu → What's New,
// and the About screen). Curated content, maintained in-repo so edits ship
// with the same deploy as the feature and stay diff-reviewable — same pattern
// as app/data/mode-module-info.js.
//
// HOW TO MAINTAIN
//   When a release ships customer-facing capabilities, prepend ONE entry to
//   the top of this array (newest first). Group the capabilities that landed
//   in that release into a single, human-readable bullet list — these are the
//   things a customer can now DO, not commit messages. The viewer shows the
//   five most recent entries; older entries stay in the file as history.
//
// SCHEMA (one object per release)
//   date          ISO 'YYYY-MM-DD' the release shipped (required) — drives ordering + display
//   release       'weekly' | 'push-now' (required) — how it was deployed
//   title         short headline, ≤ ~48 chars (required)
//   summary       optional one-line lede shown under the title
//   version       optional build/release stamp (free-form string)
//   capabilities  array of strings — each a capability added in this release (required, ≥1)
//
// Keep entries newest-first. The viewer does NOT re-sort, so order here is the
// order shown.
window.MAST_WHATS_NEW = [
  {
    date: '2026-06-29',
    release: 'push-now',
    title: 'Website builder & dashboard polish',
    summary: 'A cleaner dashboard and finer control over your storefront hero.',
    capabilities: [
      'Dashboard value-score now collapses to a compact badge by the gear, reclaiming space.',
      'Storefront hero: toggle your brand logo on/off and pick a hero variant in Hero → Content.',
      'Live preview now shows a loading spinner while your site renders.',
    ],
  },
  {
    date: '2026-06-22',
    release: 'weekly',
    title: 'The My Website hub',
    summary: 'Everything about your storefront, gathered into one place.',
    capabilities: [
      'Website builder restructured into a sub-nav with panes — no more mega-scroll.',
      'Wallet & loyalty configuration moved into My Website.',
      'Site visibility and Homepage events relocated into My Website.',
      'Product Page Display and custom Domains relocated into My Website.',
      'New storefront Capabilities panel to switch features on per site.',
    ],
  },
  {
    date: '2026-06-15',
    release: 'weekly',
    title: 'Adoption scoring & frictionless demo',
    summary: 'See how much of Mast you are using — and try it with zero setup.',
    capabilities: [
      'New "Your Mast value score" — a 3-tier score across a ~40-capability catalog.',
      'Dedicated value-score breakdown view with a cohort benchmark.',
      'Frictionless admin auto-login for demo tenants.',
    ],
  },
  {
    date: '2026-06-08',
    release: 'push-now',
    title: 'Point of Sale upgrades',
    summary: 'Faster, thumb-friendly selling on the floor.',
    capabilities: [
      'Thumb-friendly catalog navigation with a breadcrumb and a bottom Back button.',
      'Customizable catalog tile size (Large / Medium / Small), with a phone-friendly override.',
      'Quantity-tier "X for $Y" deals.',
      'Promotions can be scoped to POS-only, Online-only, or both channels.',
      'Unified POS account menu — profile, theme, feedback, and sign out in one place.',
      'Inline Square card capture from POS.',
    ],
  },
  {
    date: '2026-06-01',
    release: 'weekly',
    title: 'Diagnostics & reliability',
    summary: 'Mast can now check its own health and report problems sooner.',
    capabilities: [
      'New live self-diagnosis surface with read-probe self-test cards.',
      'Centralized error capture across high-value modules and the engine for faster fixes.',
    ],
  },
];
