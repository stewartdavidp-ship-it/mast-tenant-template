# Orders — North-Star (before → after)

A concrete visual target for the polish pass. Orders is the right screen to mock because it already scores highest (74/B) — the gap is *craft*, not *structure*, so the "after" shows what "professional" means without changing the IA.

**Open the mock:** [`orders-north-star.html`](orders-north-star.html) — static, not wired to data; use the **Dark/Light toggle** (top-right) to confirm both themes are clean. Faithful to Mast's real tokens (amber `#C4853C`, teal `#2A7C6F`, charcoal `#1A1A1A`, warm-grays) and fonts (Cormorant headings / DM Sans body / Archivo brand).

> The mock deliberately changes **only** presentation — same columns, same filter pills, same navigation, same data. Every delta below is a polish lever from [06-professional-polish.md](06-professional-polish.md), now made literal.

## Before (live `sgtest15`, dark) → After (mock)

| # | Element | Before (live) | After (mock) | Lever |
|---|---|---|---|---|
| 1 | Sidebar icons | Emoji 🏠 🏷️ 💰 | Line icons (inherit `currentColor`, theme-correct) | 06-A1 |
| 2 | Money | `$102000.00` (no separators) | `$102,000.00`, **right-aligned, tabular figures** so columns line up | 06-B7 |
| 3 | Status badges | Loud solid ALL-CAPS fills; treatment varies | One soft-tint dot-badge, sentence case, consistent size/radius | 06-B8 |
| 4 | Source marker | "ETSY" block badge | Quiet `Etsy` chip next to the order # | 06-B12 |
| 5 | Numeric columns | Left-aligned | Items + Total right-aligned, tabular | 06-B7/B11 |
| 6 | Table surface | Flat rows | Card container, sticky header, hover row, subtle separators, restrained shadow | 06-B10/B11 |
| 7 | Filter pills | OK; ALL-CAPS-ish | Sentence case, count de-emphasized, clear active state | 06-B12 |
| 8 | Source toggle | 3 separate buttons | One segmented control | 06-B12 |
| 9 | Header actions | Mixed | Icon+label buttons; Ask AI in teal, Export neutral, consistent height | 06-B12 |
| 10 | Loading | "Loading…" text | Skeleton rows matching the table shape | 06-A5/C13 |
| 11 | Empty | inline text | `.empty-state` icon + guidance + CTA | 06-A5 |
| 12 | **Light mode** | **Sidebar invisible (broken)** | **Fully legible — paired tokens switch together** | 02 §4b / 06-A2 |
| 13 | Right-edge clip | Tracking col cut off | Card respects content width | 06-A4 |

## What carries over unchanged (protect these)
Navigation model (detail page + "← Back" via `MastNavStack`), the Cormorant/DM Sans/Archivo type pairing, the warm dark palette, the filter-pill + sortable-table + URL-state pattern. The mock is orders' *own* good bones, polished.

## How the mock proves the dark/light principle
Every color is a **token pair** defined for both themes (`:root` = light, `body.dark` = dark), and **foreground never hardcoded against a mode-switched background**. Flip the toggle: nothing disappears. That single discipline is what fixes the real app's broken light mode (02 §4b) — the mock is the reference implementation of it.

## Using this as the north star
1. Treat the mock's CSS token block + badge + table + skeleton/empty as the **pattern source** for the shared components.
2. Apply to the reference modules first (orders, customers), then cascade via the migration plan ([04](04-divergence-and-plan.md)).
3. Keep the mock in the repo as the visual regression reference — re-mock other archetypes (a report screen, a builder screen) the same way if useful.

*Proof screenshots (both modes) captured during the audit; the mock is the living version — open the HTML.*
