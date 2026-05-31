# Making the UI More Professional

Separate from *consistency* (covered in 02–04). This is about **craft and trust** — moving from "functional internal tool" to "polished product." Grounded in the live visual pass (tenant `sgtest15`, dark mode). Ordered by leverage: fixing what reads as *unfinished* first, then visual craft, then interaction feel, then enterprise/trust signals.

Mast already has real assets to protect: the Cormorant Garamond (serif headings) + DM Sans (body) pairing is genuinely sophisticated, the warm dark palette is tasteful, and spacing is generous. Don't lose those. The items below elevate around them.

---

## A. Stop looking *unfinished* (highest priority — these actively read as "beta")

1. **Replace emoji nav/section icons with a real icon set.** The sidebar uses 🏠 / 🏷️ / 💰 and the boot screens use emoji. Emoji-as-iconography is the single biggest "not enterprise-grade" tell — they render differently per-OS, don't inherit color/weight, and look consumer-casual. Adopt one consistent line-icon set (Lucide / Heroicons / Phosphor) sized to the type scale, inheriting `currentColor` so they theme correctly. *High impact, low effort.*
2. **Fix light mode** (see 02 §4b) — invisible sidebar in light mode is the most damaging "broken" signal. Both themes must be clean.
3. **Kill native browser dialogs.** `window.confirm/alert/prompt` (still in ~15 modules) instantly breaks the spell — the OS chrome looks nothing like the app. Use `mastConfirm/Alert/Prompt`.
4. **Eliminate right-edge clipping.** Orders (tracking col), Finance AR (action buttons), Dashboard ("View" links) clip at ~1475px. Content cut off by the viewport reads as broken. Set a sane max content width, make tables horizontally scroll within their container, and verify common laptop widths.
5. **Real loading & empty states everywhere.** Bare "Loading…" text and inline "nothing here" strings look unfinished. Use `.loading` skeletons that match the content shape, and `.empty-state` with an icon + one-line guidance + a CTA. (Almost no module uses `.empty-state` today.)
6. **No dead-ends / blocking interstitials** (mapping "Set up your audit"). A screen you can't leave is the opposite of professional.

---

## B. Visual craft (the details pros notice)

7. **Number & money formatting.** Live, orders show `$102000.00` — no thousands separators, noisy trailing cents. Adopt `Intl.NumberFormat`: `$102,000` (or `$102,000.00` only where cents matter), `1,234` for counts, compact `$1.2M` for KPI cards. **Right-align all numeric table columns** and use tabular/lining figures so columns line up. This single change makes finance/orders/reports look dramatically more credible.
8. **Refine status badges.** Today: bright solid fills in ALL-CAPS (`PLACED`, `REFUNDED`) — loud, and treatment varies (Finance AR mixes plain colored text with pills in one row). Move to one restrained badge: soft tinted background + readable text (e.g. `color-mix`/token tint), sentence case or small-caps rather than shouting caps, consistent size/radius. One component, both modes.
9. **A real spacing & type scale.** The heavy reliance on ad-hoc inline `style=` means spacing/padding drift between modules. Define a small scale (4/8/12/16/24/32) and a type scale (e.g. 12/14/16/20/28) as tokens; replace inline one-offs. Consistent vertical rhythm is most of what "designed" feels like.
10. **Elevation & borders, restrained.** Standardize 2–3 shadow levels and one border token; avoid mixing heavy shadows with hard borders. Cards/modals/slide-outs should share the same elevation language.
11. **Table polish.** Subtle row separators or zebra, a clear hover state, sticky header on scroll, comfortable-but-not-huge row height, aligned column types (text left, numbers right, status centered). Orders/customers are close — make it the table standard.
12. **Color restraint.** Reserve the amber accent for primary actions and key emphasis; right now amber + multiple semantic colors compete. A more limited, intentional palette (neutral surfaces, one accent, semantic colors only for status) reads as more premium.

---

## C. Interaction feel (motion & responsiveness)

13. **Skeleton loaders** instead of spinners/blank flashes on first paint — perceived performance and polish.
14. **Consistent, subtle motion.** Slide-outs and modals should share one easing/duration (e.g. 150–200ms ease-out); avoid instant pop-in. The shared `mastSlideOut`/`openModal` are the place to centralize this so it's uniform.
15. **Optimistic updates + toasts.** Reflect the change immediately, confirm with a toast, roll back on error. Feels fast and confident.
16. **Visible focus & hover states.** `:focus-visible` rings on inputs/buttons/rows, clear hover affordance on clickable rows. Cheap, and a major accessibility + polish win.
17. **Keyboard support.** Esc closes overlays (centralize in `MastOverlayNav`), Enter submits forms, arrow-key nav in lists. Power users read this as "made for work."

---

## D. Enterprise / trust signals

18. **Accessibility to WCAG AA.** Contrast ratios (the faint warm-gray labels are borderline even in dark), labels tied to inputs, semantic roles. Required for any serious B2B buyer, and it forces the contrast discipline that also looks better.
19. **Confident microcopy.** Consistent voice, sentence case, helpful empty/error text ("No invoices yet — create one to get started" beats "No data"). Tie to the terminology lexicon (02 §4).
20. **Consistent iconography & affordance language** — same icon means same thing everywhere; actions look like actions (buttons), info looks like info.
21. **Density option (later).** Power users of finance/orders may want a compact table density toggle. Nice-to-have once the base is solid.

---

## The highest-leverage shortlist
If only five things: **(1) real icons instead of emoji**, **(2) fix light mode**, **(7) number/money formatting + right-aligned numeric columns**, **(8) one refined badge component**, **(5) skeleton loading + real empty states**. Together these would move Mast's *perceived* quality the most for the least work — and four of the five are mechanical, not redesigns.

## How to sequence with the consistency plan (04)
- Fold **A2 (light mode)**, **A3 (native dialogs)**, **A4 (clipping)**, **A5 (loading/empty)** into Phase 1 — they overlap the consistency quick-wins.
- Treat **A1 (icons)**, **B7 (number formatting)**, **B8 (badges)** as a dedicated **"polish pass"** that can run in parallel — high visibility, low risk, great demo value.
- **B9 (spacing/type scale)** pairs naturally with the Phase-3 token/color work.
