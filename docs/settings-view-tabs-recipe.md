# Settings sub-view refactor — view-tabs recipe

Canonical pattern for refactoring a Settings sub-view from a long list of form-groups into a horizontal-tabs layout. Modeled on Settings → Integrations → Apps. Reference implementations already shipped: **General** (`#settingsSubGeneral`, 10 tabs) and **Display** (`#settingsSubStorefront`, 4 tabs).

All file paths below are inside `app/index.html` unless noted.

## Core principle — when to use tabs

**A tab is for a meaningfully different function under the same sub-view.** Not for every item.

- ✅ **Tab it** when each section is a different workflow, a different integration, or has its own credentials/state machine. Example: Display has Lead time (display affordance), Commission CTA (marketing flow), Badge labels (inventory labels), Legal links (compliance). Four genuinely different concerns.
- ❌ **Don't tab it** when items are just a series of on/off preferences, single-setting controls, or items that belong on one page conceptually. Example: Domains is one flow (list + add inline), not two tabs.
- ❌ **Don't tab a sub-view with only one block.** Just keep it as a single page with the new section header + purpose paragraph.

When in doubt: if a user would describe two items with the same verb ("I'm setting toggles"), they belong together, not in separate tabs.

## CSS — already in the file

These classes already exist near the existing `.view-tab` rules. Don't redefine them; reuse:

- `.view-tabs` — flex strip, scrolls horizontally, amber bottom border on active
- `.view-tab` — pill button; `.view-tab.active` adds amber underline
- `.view-tab .tab-status-dot[data-state="ok|partial|missing|info|none"]` — 8px colored dot before the label
- `.tab-section-title` — 1.15rem semibold flex row (title + status pill)
- `.tab-section-status[data-state="…"]` — small uppercase pill next to the title
- `.tab-section-purpose` — 0.85rem warm-gray paragraph under the title

Status colors:
- **ok** (green) — configured / value set / "On"
- **partial** (amber) — partially set / "On" for toggles
- **missing** (red) — credential not configured
- **info** (gray) — informational / read-only / defaults
- **none** — hides the dot (use when no status applies)

## Font-size lint contract

Every font-size in this repo must snap to: `0.72`, `0.78`, `0.85`, `0.9`, `1.0`, `1.15`, `1.6`. The pre-commit hook + CI lint reject off-scale values. The existing `.tab-section-*` classes already use on-scale values; if you add inline font-size styles, snap to the scale.

## HTML scaffold

```html
<div id="settingsSub<NAME>" style="display:none;max-width:720px;">
  <!-- Tab strip — only if there are 2+ genuinely distinct functions. -->
  <div class="view-tabs" id="<name>TabBar" style="margin-bottom:20px;">
    <button class="view-tab active" id="<name>TabBtn-<key1>" data-tab="<key1>" onclick="switch<Name>Tab('<key1>')"><span class="tab-status-dot" data-state="ok"></span>Label 1</button>
    <button class="view-tab" id="<name>TabBtn-<key2>" data-tab="<key2>" onclick="switch<Name>Tab('<key2>')"><span class="tab-status-dot" data-state="none"></span>Label 2</button>
    <!-- … -->
  </div>

  <!-- One body per tab. First is visible; rest display:none. -->
  <div id="<name>Tab-<key1>" class="<name>-tab-body">
    <div class="tab-section-title">Section title<span class="tab-section-status" data-state="info" id="<name>Status-<key1>">Status label</span></div>
    <p class="tab-section-purpose">One paragraph: what this section is for, what the user can change here, when they'd use it. Concrete and short.</p>
    <!-- existing form-group(s), inputs, buttons. PRESERVE all existing element IDs so existing JS keeps working. -->
  </div>
  <div id="<name>Tab-<key2>" class="<name>-tab-body" style="display:none;"> … </div>
</div>
```

## JS scaffold

Add next to `switchIntegrationsTab` (search for `window.switchIntegrationsTab = switchIntegrationsTab;` for the canonical insertion point — `switchGeneralTab` and `switchDisplayTab` are already there as references).

```javascript
var <NAME>_TABS = ['<key1>','<key2>', /* … */];

function switch<Name>Tab(tab) {
  window.__<name>ActiveTab = tab;
  <NAME>_TABS.forEach(function(t) {
    var body = document.getElementById('<name>Tab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#<name>TabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switch<Name>Tab = switch<Name>Tab;

function refresh<Name>TabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('<name>TabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('<name>Status-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // Per-tab: read the current state and call setDot+setPill.
  // Example for a credential tab:
  //   var hasKey = !!(typeof someToken !== 'undefined' && someToken);
  //   setDot('keyTab', hasKey ? 'ok' : 'missing');
  //   setPill('keyTab', hasKey ? 'ok' : 'missing', hasKey ? 'Configured' : 'Not configured');
}
window.refresh<Name>TabStatus = refresh<Name>TabStatus;

// Optional: only needed when some tabs hide conditionally (rare).
// function apply<Name>TabGating() { … toggle button.style.display … }
```

## Wiring — three insertion points

1. **Route-load** in `lazyLoadForRoute(route)` (search for the `view === 'storefront'` line). Add a refresh call after the existing loaders:
   ```javascript
   if (view === '<settingsKey>') { existingLoaders(); if (typeof refresh<Name>TabStatus === 'function') refresh<Name>TabStatus(); }
   ```
   Where `<settingsKey>` is the value passed to `switchSettingsSubView(...)` — find it in the sidebar nav (`data-nav-key="…"` around line 8000-8100).

2. **Each save handler** — at the bottom of every `save<Foo>(…)` function that mutates a tab's underlying state, add:
   ```javascript
   if (typeof refresh<Name>TabStatus === 'function') refresh<Name>TabStatus();
   ```

3. **Each load handler** — at the bottom of every `load<Foo>(…)` function, same line.

## Pre-flight checklist for each sub-view

1. **Inventory the items.** Read the sub-view markup top to bottom. List every visually distinct block (each `form-group`, each section header).
2. **Decide tab vs. single-page.** Apply the core principle. If you end up with 1 tab, scrap the strip — just add the section header + purpose paragraph to the single page.
3. **Decide tab groupings.** Combine items that share a function. Example: 4 toggles that are all "admin preferences" → one "Preferences" tab, not 4 tabs.
4. **For each tab, identify the existing load + save handlers** so you can hook `refresh<Name>TabStatus` into them.
5. **Identify conditional visibility** — if any tab/section should only appear under certain conditions (image-storage backend, tenant business type, etc.), find the gating function and add `apply<Name>TabGating()` calls there.

## What to preserve, what to change

- **Preserve** every existing element ID (input IDs, status div IDs, section container IDs). Existing JS reads/writes those.
- **Preserve** every `onclick` handler name.
- **Preserve** the outer `<div id="settingsSub<Name>" ...>` wrapper (the settings nav code switches on this).
- **Change** the inner markup: wrap related form-groups in `<div id="<name>Tab-<key>" class="<name>-tab-body" …>`, replace large standalone `<label>` headings with `.tab-section-title`, replace standalone description `<p>` with `.tab-section-purpose`.
- **Change** the outer `max-width` to `720px` so tab strips have room (the old views often used 500-600px).

## Anti-patterns

- ❌ One tab per toggle. Toggles belong grouped under "Preferences" or whatever the umbrella is.
- ❌ Adding a tab strip for a sub-view with one logical concern (use single-page layout).
- ❌ Renaming or deleting existing element IDs — breaks the save/load wiring.
- ❌ Adding off-scale font-size values (`0.95rem`, `1.4rem`, etc.) — lint will reject.
- ❌ Inline-coloring status indicators with arbitrary hex — use the `.tab-status-dot[data-state="…"]` CSS attribute.
- ❌ Building a tab body from scratch when the existing form-groups already work — wrap, don't rewrite.

## Reference commits

- `5fedf9c` — Settings → General: view-tabs (10 tabs — note: in retrospect this is over-tabbed at the preferences end; principle was refined after).
- `a735df8` — Settings → Display + Domains: view-tabs (Display has 4 tabs; Domains was initially 2 tabs).
- `39e4fc6` — Settings → Domains revert: single page (correct shape — list + add inline, one concern).

When in doubt, read those three diffs to see the exact shape.

## Deploy after each sub-view

1. `node scripts/lint-design-tokens.js` — must exit 0.
2. `git add app/index.html && git commit …` — pre-commit hook auto-bumps `MAST_MODULES_V`.
3. `git push origin main`.
4. Caller's responsibility — deploys are operator-gated via `mast_hosting` MCP. Don't deploy from the working agent.
