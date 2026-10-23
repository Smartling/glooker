# Security tab: filter chips and side-by-side Overview

**Date:** 2026-10-22
**Status:** approved design, pending implementation
**Mockup:** https://claude.ai/artifact/58FxoJUHQhPLax4LvXsYcW (option B)

## Goal

Make the Security (`/vulnerabilities`) tab consistent with the rest of Glooker and fix the cramped ownership panel:

1. Active filters appear as removable chips, as on Projects and Team.
2. "Open alerts by owner" shows an org's teams (10 today) without scrolling.
3. The Overview puts the ownership card and the trend card side by side.

The Alerts view is out of scope and does not change.

## 1. Filter chips

### Behaviour

- The four selects (Codebase, Owning team, Severity, Compare to) and the date input stay where they are. They keep their widths and their non-default accent styling.
- A **chip row** is added to the sticky bar, under the filters row. It shows one chip per filter that is not at its default, in this order:

  | Filter | Chip label | × does |
  |---|---|---|
  | Codebase | `Codebase: <group label>` | `setCodebase(default)` |
  | Owning team | `Team: <team>` | `setTeam(null)` |
  | Repository | `Repo: <repo>` | `setRepo(null)` |
  | Severity | `Severity: Critical` / `Severity: High` | `setSeverity('both')` |
  | Compare to | `Compare to: 7 days ago` / `30 days ago` / `<date>` | `setBaseline('last')` |

  Default-ness comes from the existing `url.isDefault.*` flags in `security-state.ts`. The labels reuse the strings the selects already show (`labels.ts`). No new URL keys are added.
- The **repository** filter has never had a control in the bar. It is set from the repository rail or a table row. Its chip is the first visible sign of it in the bar.
- **Clear all** sits at the end of the chip row. It replaces the "Reset filters" button and calls the same `url.resetFilters()`. It renders only when `!url.isDefault.all`. Its slot is always reserved, so the chips never move when it appears.
- After a chip's × is clicked, focus moves to the select of the same filter. For the Repo chip, focus moves to the Codebase select. Clear all moves focus to the Codebase select, as Reset does today.
- Each chip's × is a `<button>` with `aria-label="Remove <label> filter"`.

### Layout stability

- The chip row has a fixed height, `FILTER_CHIP_ROW_H = 28`, plus `FILTER_CHIP_ROW_GAP = 8` above it. It renders in every state. When no filter is active, an `aria-hidden` non-breaking space keeps the line.
- `FILTER_BAR_H` grows by 36 (127 → 163). The "Reset filters" slot (`RESET_SLOT_W`) is removed from the filters row, and `FILTER_ROW_W` is recomputed without it.
- The chip row is one line: `flex-nowrap overflow-hidden`. Each chip has `max-width: CHIP_MAX_W = 240`. A label longer than that ends in "…" and keeps its full text in `title`. With all 5 filters active and the longest labels, the row fits in the 1280px container. At 1024px the last chips may be clipped, which is accepted. Clear all is `shrink-0` and stays visible.

### Component

`src/components/filter-chip.tsx` (new). It uses the classes the other pages already use:

- Chip: `inline-flex items-center gap-1.5 bg-accent/20 text-accent-lighter text-xs font-medium px-2.5 py-1 rounded-lg border border-accent/30`
- ×: `text-accent-light hover:text-white ml-0.5`

Its props are `{ label: string; onRemove: () => void; maxWidth?: number; title?: string }`. Only the Security tab uses it in this change. Moving Projects, Team and Settings onto it is a separate follow-up.

## 2. Overview layout

### Grid

- The KPI tile row stays full width.
- Below it, the ownership card and the trend card share one grid: `grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)`, gap `PAGE_GAP` (24).
- Both cards are the **same height**, with the grid row stretched. The ownership card's content sets that height.
- **Below 1100px viewport width** (`OVERVIEW_STACK_BP = 1100`), the grid becomes one column. The ownership card comes first, and the trend card returns to its current full-width layout and its 220px plot.

### Ownership card height

- Team rows go from 50px to 40px: `TEAM_ROW_H = 40`.
- `OWNERSHIP_BODY_H` is no longer a constant. It is computed by `ownershipBodyH(teamCount)` in `dimensions.ts`:

  ```
  TEAM_HEAD_H + min(max(teamCount, OWNERSHIP_MIN_ROWS), OWNERSHIP_MAX_ROWS) * TEAM_ROW_H
    + TEAM_ROW_H /* Total row */ + TEAM_FOOTNOTE_H
  ```

  The values are `OWNERSHIP_MIN_ROWS = 5` and `OWNERSHIP_MAX_ROWS = 12`.
- **`teamCount` is the org's known-team count** (`summary.knownTeams.length`, plus 1 for the "No team" row when the summary reports one). It is never the filtered row count. A filter change therefore never resizes the card.
- Until the summary has loaded, the body uses `OWNERSHIP_MIN_ROWS`. When the summary first loads, the card settles to its real height once. This is the same moment the KPI tiles fill in. The "Layout stability" doc records this as the one accepted size change, on first load only, never on a filter change.
- The Repositories tab uses the same body height. Its rows scroll inside it, as today.
- With 13 or more teams the team table scrolls inside the card, with the header and Total row pinned, as today.

### Trend card in the narrow column

When the card is in the two-column grid (`variant="compact"`):

- The header becomes two lines: the title and subtitle first, then the Range select (`TREND_RANGE_W`) and the figures block (`TREND_FIGURES_W`) on a second line.
- The plot takes the remaining height: `flex-1 min-h-[160px]` instead of the fixed `TREND_PLOT_H`.
- The legend's columns use `minmax(TREND_LEGEND_MIN_W, 1fr)`, which gives 2 columns at about 500px. The legend area is capped at `TREND_LEGEND_COMPACT_H = 7 × 16` and scrolls when the legend is longer.
- The footnote stays under the legend.

In the stacked layout, below 1100px, the trend card renders exactly as it does today.

The breakpoint is applied with CSS (a Tailwind `min-[1100px]:` class on the grid and the card's parts), not a JS media query, so the server and client render the same markup.

## Files

- `src/components/filter-chip.tsx`: new.
- `src/app/vulnerabilities/filter-bar.tsx`: the chip row, Clear all, and removal of the Reset slot.
- `src/app/vulnerabilities/dimensions.ts`: the new constants, `ownershipBodyH`, `TEAM_ROW_H = 40`, `FILTER_BAR_H`, and `FILTER_ROW_W`.
- `src/app/vulnerabilities/vulnerabilities-content.tsx`: the Overview grid, and passing the team count.
- `src/app/vulnerabilities/ownership-card.tsx`: the computed body height.
- `src/app/vulnerabilities/trend-card.tsx`: the compact variant.
- `docs/vulnerabilities-page.md`: the "Layout stability" table and rules.

## Testing

- `vuln-filter-bar.test.tsx`:
  - Chips appear for exactly the non-default filters, including the repository filter.
  - × resets only its own filter and moves focus as described.
  - Clear all is reserved but hidden at the defaults.
  - The chip row renders in every state.
- `vuln-security-dimensions.test.ts`:
  - The new constants and `FILTER_BAR_H` add up.
  - `ownershipBodyH` at 0, 5, 10, 12 and 30 teams.
- `vuln-ownership-card.test.tsx`: the body height follows the known-team count and does not change when the team or severity filter changes.
- `vuln-security-page.test.tsx`: the Overview renders the two cards inside one grid, in order.
- `vuln-docs-references.test.ts`: keeps passing, so the doc names the new constants.
- Manual check in the browser with Playwright against `dev:mock`:
  - Screenshots at 1440 and 1024 widths.
  - 10 seeded teams with no scroll.
  - No layout shift when filters change.

## Out of scope

- The Alerts view.
- Multi-select filters.
- A type-ahead "add filter" box.
- Moving other pages onto `FilterChip`.
