# List Views & List Controls (standard)

Companion to [02-standard.md](02-standard.md) (criteria B1–B4). Lists have drifted across data-tables, ad-hoc `div` grids, and cards; rows are sometimes single-line, sometimes multi-line; expand/collapse is used inconsistently; and large lists are silently truncated. This defines two list types, one row anatomy, one control set, and a clear rule for expand/collapse.

## Two sanctioned list presentations — pick by the item's identity

| Type | Use when | Mechanism |
|---|---|---|
| **Data table** (default) | The item is **scanned by reading fields** — records, transactions, people, orders, invoices, vendors, tickets | `.data-table` + `mastTabs`-consistent toolbar |
| **Card grid** (exception) | The item is **recognized by an image / is media-first** — products, lookbooks, gallery photos, brand logos, channels w/ logos | uniform card component in a responsive grid |

**The rule:** *If you'd find a row by reading a column, it's a table. If you'd find it by looking at a picture, it's a card.* Non-visual records use a table — full stop. This retires the card-for-plain-data pattern (team roster, contacts, customer-service tickets, events, sales → tables) and the ad-hoc `div` grids standing in for tables.

## Row anatomy (one shape — no free-form multi-line rows)
- **Single logical row per record.** Cells: text left-aligned, **numbers/money right-aligned & tabular** (06-B7), status as `.status-badge`, dates formatted.
- **One optional secondary subline**, only in the *primary* column, muted (e.g., name + email, order # + Etsy chip). That's the *only* sanctioned "multi-row" — not arbitrary stacked content.
- **Consistent row height** within a table; comfortable default, optional compact density toggle later (06-B21).
- **Primary click = open the record in the slide-out** ([05](05-surface-decision-record.md)). **Secondary actions = one overflow (⋯) menu** per row, not a scatter of inline buttons. Bulk actions via the selection bar (below).

## Expand / collapse — narrow, explicit rule
Today expand/collapse does three different jobs; split them:
1. **Grouping** (a group header that collapses its child rows — AP by vendor, lots by material): ✅ **allowed**, standardize one collapsible group-header pattern with a count and a chevron.
2. **Revealing record detail** (trips card expands, contacts signals, book enrollment drill, finance expense panel): ❌ **retire** — clicking the row opens the **slide-out** instead. Inline-expand-for-detail competes with the slide-out and is exactly the inconsistency to remove.
3. **Sections inside a record**: ✅ fine, but they live **inside the slide-out** as sections/accordion (panel content, see [08](08-slideout-component-spec.md)), not in the list.

## The standard list toolbar (same controls, same order, every list)
Above every list, one consistent bar:
1. **Search** (text) where the set is non-trivial.
2. **Filter pills** (`mastRenderFilterPills`) + advanced filter dropdowns; URL-reflected. *Filtering is pills, never tabs ([10](10-tab-and-navigation-hierarchy.md)).*
3. **Sort** — interactive column headers (`mastSortableTh`/`mastSortRows`) for tables; a sort `<select>` for card grids.
4. **Count + scope** — "Showing X of Y", and the active filter summary.
5. **Selection + bulk-action bar** — checkbox column; when ≥1 selected, a bar exposes bulk actions. One pattern (orders is the reference).
6. **Empty / loading** — `.empty-state` (icon + guidance + CTA) and `.loading` **skeleton rows matching the table shape** (06-A5).

## List controls contract (the common set every list has)
Same controls, same look, same order — no per-module variation:
| Control | Standard | Notes |
|---|---|---|
| **Filter** | `mastRenderFilterPills` + advanced dropdowns, URL-reflected | filtering is pills, never tabs ([10](10-tab-and-navigation-hierarchy.md)) |
| **Sort** | interactive column headers (`mastSortableTh`/`mastSortRows`) w/ indicator; sort `<select>` for card grids | every list >~10 rows sorts |
| **Search** | one text box, debounced | where the set warrants |
| **Click-to-action** | **row click → open the record in the slide-out** (read mode) | one consistent affordance; whole row is the hit target; cursor + hover state |
| **Line-level actions** | **one ⋯ overflow menu** per row + at most one inline *status control* | see policy below; never a scatter of inline buttons |
| **Bulk** | checkbox column → selection bar with bulk actions when ≥1 selected | orders is the reference |
| **Count / empty / loading** | "Showing X of Y" · `.empty-state` · `.loading` skeleton | |

## Inline editing — POLICY
**No inline *field* editing in lists.** Clicking a cell never turns it into a text input. All field editing happens in the **slide-out edit mode**. Reason: inline cell editing is a second editing surface with its own validation, dirty-state, and look — the exact fragmentation we're consolidating.

**Allowed: inline *actions* (not editing)** — a single control that triggers an immediate state change with no form:
- a **status control** in the status cell (dropdown/toggle) for a one-tap state change, and/or
- the **⋯ overflow menu** for line-level actions ("Mark shipped", "Void", "Delete" — destructive ones `mastConfirm`-gated).

Rule of thumb: *one control, one immediate action = inline action (✅). Typing into fields = editing → slide-out (❌ inline).* (Retire today's in-row edit toggles, e.g. campaigns/commission-terms inline editors → slide-out edit mode.)

## list → detail → edit — ONE collapse (not three screens)
Don't model detail and edit as separate destinations. The slide-out has **modes**, not screens:

```
list  ──row click──▶  slide-out: READ (the "detail")
                          │  Edit ▼
                          ▼
                      slide-out: EDIT  ──Save──▶ READ   ──close──▶ list
                                          └─Cancel─▶ READ
create ──"+ New"──▶  slide-out: CREATE ──Save──▶ list (or new record's READ)
```
- **One navigation step** (list → panel), then in-place mode swaps. No separate edit route/page.
- **Default entry = READ**, so a click never risks an accidental edit; **Edit** button enters edit; **Save** returns to read; **close** returns to the list (`MastDirty` guards unsaved).
- This is Paradigm-A (read→edit on the detail) realized **inside the slide-out** ([08](08-slideout-component-spec.md) modes).

## Large lists — stop silently truncating (important)
Most modules `limitToLast(200)` or load everything; only `email-log` has "load more". Standardize **one** approach and **never hide rows without saying so**:
- Default: **load-more / windowed** with an explicit "Showing X of Y" and a clear control to fetch more (email-log is the reference).
- For very large sets: server-side paging + search/filter to narrow first.
- **Flag `🚩 silent truncation`** anywhere a hard cap drops rows with no indication (today: finance, customer-service, orders, events, etc. cap at 200).

## Card spec (for the genuine card cases)
- Uniform card: thumbnail (consistent aspect ratio) + title + **≤3** meta lines + one `.status-badge`.
- Equal card sizes; responsive grid; same hover/active + slide-out-on-click behavior as table rows.
- No bespoke per-module card markup — one card component, themed for both modes.

## How this folds into the plan
- During each module's slide-out conversion ([09](09-conversion-inventory.md)): pick table vs card by the rule, normalize the row to the single shape, **remove inline-expand-for-detail** (→ slide-out), and add the standard toolbar.
- Heaviest cleanups (from grep): card-for-data → table on **channels (46), events (28), customer-service (27), shows (25), sales (18), procurement (15), social (14)**; expand-for-detail → slide-out on **book (34), team (33), finance (31), consignment/contacts/maker (14), fulfillment/orders (10)**.

## Conformance (per-screen checklist additions)
- List type chosen by the table-vs-card rule (no card-for-plain-data, no ad-hoc `div` grid).
- One logical row per record; numbers right-aligned/tabular; status = `.status-badge`.
- Row click → slide-out; secondary actions in one ⋯ menu.
- Expand/collapse only for grouping; record detail is in the slide-out.
- Standard toolbar present (search/pills/sort/count/bulk/empty/loading).
- Large lists paginate or load-more with visible count — no silent caps.
