# GLOOK-58: Replace hand-rolled SVG charts with Recharts v3

**Status:** design agreed 2026-09-25, pending implementation
**Ticket:** GLOOK-58
**Approach:** adopt Recharts v3 with a ported copy of the shadcn/ui `chart.tsx` wrapper. The minimal alternative (keep the hand-rolled charts, swap hex for CSS variables, dedupe `TimelineChart`) was rejected; see [Approaches considered](#approaches-considered).

## Problem

Glooker has no charting library. Every chart is hand-built inline SVG or a Tailwind `<div>` sized by `style={{ width: '%' }}`. That produces visible bugs:

- **Light mode is broken inside charts.** Light themes work by overriding Tailwind class colors under `[data-theme-mode="light"]` in `src/app/globals.css`. Chart grids, tooltips and labels use hex presentation attributes (`stroke="#1F2937"`, `report/[id]/org/page.tsx` lines 482, 529, 600, 868) and `fill-gray-*` classes, and no override exists for either. A card turns light while its chart internals stay dark. `ProgressRing` (`src/app/projects/progress-ring.tsx` lines 59-66) has no light path at all.
- **Values only appear on hover.** The donut (`PieChart`, `org/page.tsx:684`) has no resting legend values, and `TimelineChart` values live only in tooltips. A screenshot, PDF, phone or shared report shows charts with no numbers.
- **Axes are sparse.** The dev `TimelineChart` has three fixed x labels (`dev/[login]/page.tsx:830-838`) and y ticks that collapse to 2-3 irregular values (`:702-711`). `TrendChart` labels only its first and last dates (`trend-chart.tsx:32-33`).
- **`TimelineChart` exists twice and the copies have diverged.** The org copy (`org/page.tsx:785-921`) spaces bars by index and has an in-flight overlay. The dev copy (`dev/[login]/page.tsx:668-842`) spaces bars by date and has no overlay.
- **Fragile details.** Tooltip widths are guessed from character count (`org/page.tsx:524`, `dev/[login]/page.tsx:812`), so long labels overflow. `PieChart` computes `count / total` with no zero guard (`org/page.tsx:696`). Commit-type color maps are duplicated between the org and dev pages, and the dev copy lacks `in_flight`.
- **No tests for the report charts.** They live inside `page.tsx`, which may export only `default` (see CLAUDE.md), so nothing can import them.

## Goals

- Every data-encoding chart renders with Recharts v3, from modules outside `page.tsx`.
- Every chart is readable in all ten themes (six dark, four light).
- Key values and legends are readable without hovering.
- One `TimelineChart`, placed by date, with the in-flight overlay and hover synced across each page's grid.
- Behavioral tests for every chart, plus guard tests that stop literal colors from coming back.

## Non-goals

- API or data-shape changes. Charts consume the existing `timeline`, `TrendSeries[]` and `EpicRingStats` shapes.
- Migrating non-chart bars. The `ProjectsCard` volume bar (`src/components/ProjectsCard.tsx:208-262`, `~406-435`), the sync progress bars (`src/app/reports/page.tsx:451-479`, `src/app/reports/vulnerability-syncs-tab.tsx:124-139`) and the other inline data bars listed in Decision 1 stay as `<div>`s. Only the `ProjectsCard` colors and the sync tracks move to tokens. The rest change only if the screenshot pass shows them broken.
- Mobile layout redesign beyond what responsive containers give for free.
- Click-to-select series, chart export, or table views.
- Moving to Tailwind v4 or adopting shadcn/ui beyond the one wrapper file.

## Approaches considered

| | Minimal: patch the hand-rolled charts | **Chosen: Recharts v3 + ported shadcn wrapper** |
|---|---|---|
| Work | ~1 day: CSS variables, `fill-*` overrides, dedupe `TimelineChart` | Shared chart layer, 6 chart rewrites (two `TimelineChart` copies become one), tokens, tests |
| Fixes light mode | Yes | Yes |
| Fixes sparse axes, hover-only values, tooltip overflow | No, each needs more hand-written geometry | Yes: tick algorithm, legends and tooltip come with the library |
| Long-term | Every new chart is bespoke again | New charts are composition |

Libraries evaluated on 2026-09-25 against GitHub, npm and official docs:

- **Recharts 3.10.1** (released 2026-07-25). Active, supports React 19, SVG, and covers every chart type used here.
- **Rejected:**
  - **Tremor.** Stalled after the Vercel acquisition, and its peer dependency allows React 18 only.
  - **Nivo.** Its core package hasn't had a release in 16 months.
  - **ECharts.** Imperative API, a heavy bundle, and its heatmap strength isn't needed.
  - **MUI X Charts.** Requires Emotion, and its heatmap is paid.
  - **Chart.js.** Canvas-based, so it's hard to theme with CSS.
  - **visx, Observable Plot, Unovis, uPlot.** Primitives, niche, or performance-focused.

## Decisions

1. **Single library.** Every chart that encodes data uses Recharts, including `TrendChart`, `ProgressRing` and the Spend vs Impact scatter.
   - UI chrome (progress bars) and inline data bars in table or card rows stay HTML. That covers the `ProjectsCard` volume bar, the spend tab's top-20% and model-mix bars, the `usage-card.tsx` model cost bars, the Top/Active Repos bars and the dev page's p50/p95 marker bar.
   - Those inline bars are included in the screenshot pass. They get a colors-only fix **only if** the screenshots show them broken in a light theme.
   - **Exception: the dev page's "Commit Types" segmented bar** (`dev/[login]/page.tsx:262-288`) must change, because its `TYPE_COLORS` map is removed. Its segments take the commit-type **mark** tokens, and its count legend takes `commitTypeBadge`.
   - **Not charts, out of scope** (a full inventory on 2026-09-25 found no others):
     - The static explainer bars in `llm-findings.tsx:257-360`.
     - The threshold-colored Complexity/Impact/PR%/AI% badges on the org, dev, team and spend pages.
     - The vulnerability severity badges and the Jira status dots.

     They're covered only by the screenshot pass.
   - The sync progress bars keep their status fills (indigo running, red failed, orange warning) and move only their track to `--chart-track`.
2. **Recharts `^3.10`, with `clsx`, `tailwind-merge@^2.6` and `react-is@^19`.** Recharts imports `isFragment` from `react-is` as a peer dependency, and the installed 18.3.1 doesn't recognize React 19 fragments. tailwind-merge 3.x supports Tailwind v4 only. Its README says: "if you use Tailwind v3, use tailwind-merge v2.6.0".
3. **Port shadcn's Tailwind-v3 `new-york` `chart.tsx`, not `new-york-v4`.** The v4 variant uses `outline-hidden` and `border-(--color-border)`, which are v4-only syntax. The v3 variant pins recharts 2.15.4, so the port applies Recharts 3 type changes, such as `TooltipProps` → `TooltipContentProps` ([migration guide](https://github.com/recharts/recharts/wiki/3.0-migration-guide)).
4. **`THEMES = { dark: "", light: '[data-theme-mode="light"]' }`.** The app's unscoped styles are dark, and light is the override. Renaming shadcn's `.dark` key directly would invert every chart. `applyTheme()` (`src/app/themes.ts:93-104`) sets `data-theme-mode` on `<html>`. There is no system mode.
5. **No literal colors in chart code.** Every fill, stroke and text color comes from a CSS variable, defined under `:root` (dark) and `[data-theme-mode="light"]` (light).
6. **Scoped token names.** The wrapper's shadcn classes (`border-border`, `bg-background`, `text-muted-foreground`, `text-foreground`) are rewritten to a `chart.*` Tailwind color namespace, so the app theme gains no generic names.
7. **Single-metric timelines use `var(--accent)`,** so they follow the selected theme. Their in-flight segment is a diagonal hatch of the accent. This also removes the clash between today's in-flight cyan and Midnight Teal's accent.
8. **Multi-series charts use fixed semantic colors.** This covers commit types, lines added and removed, and the two `ProgressRing` arcs. Each has a dark step and a light step. Bug stays red and feature stays blue in every theme.
9. **In-flight is always hatched.** This holds in every chart that shows it: the single-metric timelines, `StackedTypesChart`, `LinesChangedChart`, and the donut's `in_flight` wedge and legend swatch. In multi-series charts the hatch uses the in-flight token color, and in single-metric timelines it uses the accent. The pattern is a second visual cue, so in-flight is never shown by color alone. The mechanics are in [Hatch](#hatch).
10. **Bars are placed by date, and the fill depends on the metric kind.** `aggregateWeekly` (`src/lib/report/timeline.ts:135`) emits **only weeks that have commits**. Its ratios come back as `0` when the denominator is zero, for example `avgLinesPerPr` at `:142`. `buildWeekDomain` returns every Monday-anchored week from the 90-day cutoff to the current week. `TimelineChart` then fills it according to a `kind` prop:
    - **`kind: 'count'`** covers commits, PRs, lines changed and in-flight commits. A week absent from `data` is a real zero, so it is filled with `0`.
    - **`kind: 'ratio'`** covers `avgLinesPerPr`, `avgImpact`, `avgComplexity` and `aiPercent`. A week absent from `data` has no defined value, so it is filled with `null` and renders as a gap.
      - For `avgLinesPerPr`, a present week with `prs === 0` is also `null`, via an optional `isDefined(d)` prop. The payload carries `prs`, so this needs no API change.
      - `avgComplexity` and `avgImpact` expose no denominator, so a present week reporting `0` is drawn as 0. See [Risks](#risks).

    Every chart on a page shares the same week array, which is what makes `syncId` work. Recharts' default `syncMethod="index"` matches on array index.

    **Week keys are computed in UTC, on both server and client.** `weekKeyForDate` (`timeline.ts:23-28`) currently does its day arithmetic in the server's local time zone but formats with `toISOString()`. On a server west of UTC, a Monday-evening commit therefore gets a Tuesday key, and one real week arrives as two buckets. This design fixes it at the source:
    - `weekKeyForDate` switches to `getUTCDay`/`setUTCDate`.
    - The client helpers (`buildWeekDomain`, the cutoff, "today") use `Date.UTC`/`getUTCDay` as well.

    No week keys are persisted anywhere: timelines are computed per request, and `summary.ts` caches only summary text. So the fix needs no data migration. On a non-UTC server, weeks become UTC Mondays.
11. **`TrendChart` colors follow the team, not its rank.** The caller, `vulnerabilities-content.tsx`, builds `colorByTeam = assignTeamColors(trend.series)` from the **unfiltered** series. It takes the series rather than bare names, because the fallback for more than 12 teams needs each team's open count. It must do this before applying the team filter at `:202-203`, and it passes the map in as a prop. `assignTeamColors` sorts the team names and gives each team a fixed slot in the existing `--vuln-series-1..12` palette. A team then keeps its color across syncs and when the filter narrows the chart. The only requirement from the product owner is that teams get distinct colors. This replaces GLOOK-43's rank-based assignment.
    **Assumption:** there are at most 12 teams with alerts. If there are more, the 12 teams with the most open alerts (ties broken by name) are chosen. Those 12 are then sorted by name into slots 1..12. The rest use `--vuln-series-other`, and the legend names them all. In this fallback, a team entering or leaving the top 12 can shift other teams' slots.
12. **Diverging lines-changed chart.** Lines added go above zero and lines removed go below, in a single stack with `stackOffset="sign"`. Removed values are negated. The in-flight part of each is hatched. A `ReferenceLine y={0}` draws the zero baseline in full `--chart-axis`, because on this chart the baseline carries meaning and isn't just a recessive gridline. Today all four layers stack upward.
13. **The donut's legend always shows count and %.** When nothing is hovered, the center shows the total. Hovering a slice or legend row still moves that type's figures into the center and dims the other slices. The center label is always chrome text (`--chart-tooltip-text`/`--chart-axis`). Type identity comes from a small color swatch beside it. Today the label is drawn in the series color (`style={{ fill: TYPE_HEX[...] }}`), which breaks the text rule. Slices and legend rows follow the fixed `COMMIT_TYPE_ORDER`, the same order as `StackedTypesChart`, not a sort by count. That way every pair of neighbors the donut can show is a pair the palette gate has checked.
14. **Palette validation is a gate, with two paths.** The validated values and the validator output go in this spec's [Palette](#palette) section. Producing them is the **first** implementation task, and every chart task depends on it.
    - **Fixed multi-color palettes** (commit types, lines, ring, and `--vuln-series-*` already validated) are checked against the dark card surface and the light card surface:
      - Adjacent-pair colorblind separation of ΔE ≥ 8. ΔE is perceived color distance in OKLab ×100.
      - The normal-vision floor.
      - 3:1 graphics contrast.

      Tailwind hexes that fail move to the nearest passing shade. The ring colors are additionally checked at 3:1 against `--chart-track`, the surface they're drawn over.
    - **`var(--accent)`** is a single color per theme and never appears beside another accent. So it gets only 3:1 graphics contrast against its own theme's card surface, for all ten themes. Colorblind separation between accents is meaningless.
    - **Chrome tokens:**
      - `--chart-axis` meets 4.5:1 text contrast against the card surface.
      - `--chart-tooltip-text` meets 4.5:1 against `--chart-tooltip-bg`.
      - Each is checked in both modes.
      - `--chart-grid` and `--chart-tooltip-border` are **exempt**. They're decorative, and WCAG 1.4.11 doesn't apply to them. Holding the grid to 3:1 would force a prominent gray line, against the "recessive grid" mark spec. An earlier revision of this spec required it; that was an error.
    - **Text-bearing badges.** Commit-type badges on the dev and team pages carry text on a colored fill. That's a different contrast requirement from a chart mark, so they don't reuse the mark tokens. `commit-types.ts` exports a separate badge treatment per type, in the same hue family: `commitTypeBadge(type) → { bg, text }`. Every type's badge text meets 4.5:1 against its badge fill, for all 8 types in both modes. This matters because the gate lightens `other` for marks: white text on the lightened gray would fall to about 2.5:1.

## Architecture

### New modules

| Module | Contents |
|---|---|
| `src/lib/cn.ts` | `cn(...inputs)`, using `clsx` and `tailwind-merge`. |
| `src/components/charts/chart.tsx` | The ported wrapper: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle`, and the `ChartConfig` type. |
| `src/components/charts/chart-format.ts` | Pure helpers: `toNum(v)`, `formatWeek(isoWeek)`, `formatValue(v, { suffix, decimals })`, and `buildWeekDomain(cutoff, today)`. They replace the per-chart inline closures. |
| `src/components/charts/commit-types.ts` | `COMMIT_TYPE_ORDER` (feature, bug, refactor, infra, docs, test, other, in_flight) and the type → token map. Unknown types map to `other`. It replaces all three copies of the map: `TYPE_HEX`/`TYPE_COLORS` in the org page, `TYPE_COLORS`/`TYPE_TEXT_COLORS` in the dev page, and `TYPE_COLORS` in `src/app/report/[id]/team/dev-table.tsx:27`. Otherwise the palette gate could move a hue in the charts while the team page's badges keep the old one. |
| `src/components/charts/hatch.tsx` | `useHatch(colorVar)` returns `{ id, defs }`. The pattern is described under [Hatch](#hatch). |
| `src/lib/__tests__/setup/resize-observer.ts` | A jsdom-only `ResizeObserver` stub, guarded by `typeof window !== 'undefined'`. It's registered through a new `setupFiles` entry in `jest.config.ts`. It has to be global because four existing tests (`vuln-content-trend-range`, `-team-dropdown`, `-repo-reset`, `-error`) render `VulnerabilitiesContent` without mocking `TrendChart`. Any of them that reaches the chart would break as soon as it uses a responsive container. |
| `src/components/charts/timeline-chart.tsx` | The single `TimelineChart`. |
| `src/components/charts/stacked-types-chart.tsx` | `StackedTypesChart`. |
| `src/components/charts/lines-changed-chart.tsx` | `LinesChangedChart`. |
| `src/components/charts/commit-type-donut.tsx` | `CommitTypeDonut`, which replaces `PieChart`. |

### Rewritten in place (import paths unchanged)

- `src/app/vulnerabilities/trend-chart.tsx`, plus `assignTeamColors` next to it.
- `src/app/projects/progress-ring.tsx`.

### Other files touched

- **`src/app/vulnerabilities/vulnerabilities-content.tsx`.** Builds `colorByTeam` from the unfiltered series (Decision 11).
- **`src/app/report/[id]/team/dev-table.tsx`.** Its type badges read `commit-types.ts`.
- **Non-chart bars, colors only.** `src/components/ProjectsCard.tsx`, `src/app/reports/page.tsx` and `src/app/reports/vulnerability-syncs-tab.tsx`.
- **`src/app/report/[id]/org/spend-tab.tsx`.** The scatter moves out to `spend-impact-scatter.tsx`.
- **`src/lib/report/timeline.ts`.** `weekKeyForDate` switches to UTC (Decision 10).
- **`scripts/seed-data.ts` and `scripts/seed.ts`.** The seed counts back from today's UTC midnight instead of the fixed anchor `2026-04-01`. That anchor had aged out of the 90-day window, so every mock timeline showed its empty state. The seed also gains an `unmerged_commits` section for in-flight data. Approved by the product owner on 2026-09-25.
- **Config and dependencies.**
  - `src/app/globals.css` (tokens) and `tailwind.config.ts` (`chart.*` colors).
  - `jest.config.ts` (`setupFiles`).
  - `package.json`: `recharts`, `clsx`, `tailwind-merge@^2.6`.

### Pages

`report/[id]/org/page.tsx` and `report/[id]/dev/[login]/page.tsx` keep only data fetching and layout. They lose roughly 500 and 175 lines of drawing code, and still export only `default`. The `{timeline.length >= 2 && ...}` guards stay.

## Theming

### Tokens (`src/app/globals.css`)

Each token is defined under `:root` (dark) and redefined under `[data-theme-mode="light"]`.

- **Chrome:** `--chart-grid`, `--chart-axis`, `--chart-cursor`, `--chart-tooltip-bg`, `--chart-tooltip-border`, `--chart-tooltip-text`, `--chart-track`, `--chart-surface`. `--chart-surface` is used for the 2px gap between segments.
- **Commit types:** `--chart-type-feature`, `-bug`, `-refactor`, `-infra`, `-docs`, `-test`, `-other`, `-in-flight`.
- **Lines:** `--chart-lines-added`, `--chart-lines-removed`.
- **Scatter:** `--chart-scatter-typical`, `--chart-scatter-outlier`.
- **Volume bar** (`ProjectsCard`): `--chart-volume-prs`, `--chart-volume-jiras`, `--chart-volume-commits`. Today's white-alpha commits segment is invisible in light mode.
- **Ring:** `--chart-ring-jira`, `--chart-ring-commits`.
- **Reused unchanged:** `--vuln-series-1..12`, `--vuln-series-other`, `--accent`.

`tailwind.config.ts` registers the chrome tokens under `theme.extend.colors.chart`, for example `chart-axis`.

### Palette

*Filled in by the first implementation task: the validated dark and light hex values, and the validator's output (Decision 14). No chart task starts before this section is complete.*

### Hatch

An in-flight segment is its own rect, wedge or swatch. Its `fill` is `url(#<id>)` **instead of** a solid color. It is never drawn on top of a solid mark of the same color, because a same-color pattern over a same-color fill is invisible.

The pattern itself:
- It has an explicit `--chart-surface` background, never a transparent one.
- It draws diagonal strokes in the given color variable, about 2px wide at 45°.

Each chart instance gets its own pattern ID from React `useId()`. A page shows up to six charts in one document-wide ID space, so a static `#hatch` would make the accent pattern and the in-flight-token pattern collide.

### Mark specs (from the dataviz skill)

- Bars have a 4px rounded top on the top segment only, and a 2px `--chart-surface` gap between stacked segments.
- The grid is horizontal only and recessive. Axis lines are hidden or faint. The one exception is the diverging chart's zero line (Decision 12).
- Trend lines are 2px, and hover markers are at least 8px.
- Text always uses the chrome text tokens, never the series color.
- Recharts' default `accessibilityLayer` stays on.

## Charts

**`TimelineChart`** (5 uses on org, 6 on dev, in `grid-cols-1 md:grid-cols-2` grids)

- **Props:**
  - `data`, and `valueKey` or `computeValue`, as used for the dev page's lines changed (`linesAdded + linesRemoved`).
  - `kind: 'count' | 'ratio'`, plus an optional `isDefined(d)`, per Decision 10.
  - `label`, `suffix`, `decimals`.
  - `inFlightValue?`. Today the org page passes it for commits, as `d.types?.in_flight ?? 0`.
  - `syncId`.
- **Keeps:**
  - The header, with the latest value and the change from the previous week. "Latest" means the last week with data.
  - The 90-day cutoff.
  - Weekly buckets.
- **Changes:**
  - Date placement (Decision 10).
  - The accent fill with the in-flight hatch.
  - Recharts ticks with `minTickGap` and rounded y ticks.
  - A tooltip showing the week, the value, and the shipped and in-flight split when present.
  - `syncId="org-timeline"` on the org page and `"dev-timeline"` on the dev page.

**`LinesChangedChart`** (org)

- **Keeps:** the `linesP95Added/Removed` and `inFlightLinesP95Added/Removed` fields.
- **Changes:** the diverging layout (Decision 12). Colors are the lines tokens, with in-flight hatched.

**`StackedTypesChart`** (org)

- **Keeps:**
  - One stacked bar per week, in `COMMIT_TYPE_ORDER`.
  - The static legend.
  - The per-type tooltip breakdown.
  - The 90-day cutoff.
- **Changes:** type tokens, with in-flight hatched.

**`CommitTypeDonut`** (org)

- **Keeps:** `entries` and `total` computed on the page. In-flight is already merged into `types` on the server (`org/page.tsx:88-90`).
- **Folds unknown types:** the page computes `entries` and `total` from `foldTypes(...)`, not a raw `Object.entries(week.types)` (`org/page.tsx:91-98`). An unrecognized type then joins `other`, instead of becoming a second, identically colored "other" wedge. The same rule applies to every place that **displays** `.types` on the org, dev and team pages. The CSV export in `team/page.tsx` is not a display surface, so it keeps writing the raw `type_breakdown`. Folding there would silently change exported data.
- **Behavior:** Decision 13.
- **Changes:**
  - `<ResponsiveContainer aspect={1}>` inside a `max-w-[320px]` wrapper replaces `min(320px, 50cqw)`.
  - The `in_flight` wedge and its legend swatch are hatched (Decision 9).
  - A total of 0 renders the empty state "No categorized commits".

**`TrendChart`** (vulnerabilities)

- **Form:** a `LineChart` with 2px lines, automatic date ticks, and a crosshair tooltip listing teams by value.
- **Keeps:** hovering a line or legend entry fades the other series.
- **Props:** `TrendChart({ series, colorByTeam })`. The chart no longer computes colors itself, because `series` may already be filtered (Decision 11).

**`ProgressRing`** (projects)

- **Form:** a fixed-size `RadialBarChart` with no responsive container.
  - It sets `<PolarAngleAxis type="number" domain={[0, 100]} tick={false} />`, `startAngle={90}` and `endAngle={-270}`, so each ring starts at the top and fills clockwise, as a share of 100%.
  - Without the fixed domain, `RadialBar` scales to the largest value in its data. At 40% Jira and 20% commits, the 40% ring would draw as a full circle.
  - Each ring's track is its `background` in `--chart-track`.
- **Keeps:**
  - The `Math.log`-based size of 22-48px.
  - Stroke width that scales inversely with size.
  - Jira on the outer ring, commits on the inner ring, and `devCount` in the center.
  - No divide-by-zero when `maxVolume = 0`.

**`SpendImpactScatter`** (org spend tab, replaces the `<div>`-positioned plot at `src/app/report/[id]/org/spend-tab.tsx:518-561`)

- **Form:** a `ScatterChart` with impact score on the x-axis and dollars on the y-axis, both with real tick values. It lives in `src/components/charts/spend-impact-scatter.tsx`.
- **Quadrants:** `ReferenceLine`s at the median impact and median cost, drawn in the **same scale as the dots**. Today the dots use `impact/max × 92 + 4` and `cost/max × 88 + 6` (`:537-538`), while the median lines use the raw ratio × 100 (`:527-528`). That puts the quadrant boundaries in the wrong place. The four quadrant labels stay, in the corners.
- **Two series with a legend:** "typical" and "outlier". Outliers use a different marker shape (a triangle) as well as a different color, so they don't depend on color alone. Neither color is the commit-type bug red. The tokens are `--chart-scatter-typical` and `--chart-scatter-outlier`, validated with the fixed palettes.
- **Keeps:**
  - The `isOutlier` rule (`:191-195`): cost per impact point more than 2× the median.
  - Clicking a dot navigates to `/report/[id]/dev/[login]`.
  - The tooltip: login, spend and impact.
- **Changes:** an empty state when no developer has spend, and `toNum()` on cost and impact.

### Every chart

- An explicit empty state. **Exception:** `ProgressRing`, whose 0% state (both tracks drawn, no arc) is its empty state. It must render without `NaN` when every value is 0.
- Every numeric value passes through `toNum()`, because `DECIMAL`/`REAL` columns may arrive as strings (CLAUDE.md gotcha).
- Charts never throw. `NaN` renders as 0.

## Testing

Tests go in `src/lib/__tests__/unit/` (Jest `roots` is `src/lib`) and use the `/** @jest-environment jsdom */` docblock.
- **Sizing.** The global `ResizeObserver` stub (see [Architecture](#new-modules)) keeps responsive containers from failing. Chart tests also need a non-zero size. `ResponsiveContainer`'s `initialDimension` is **not** enough in jsdom. In 3.10.1 the container measures itself with `getBoundingClientRect()` on mount, and the 0×0 result overwrites `initialDimension`. So a test helper, `fixChartSize()`, stubs `getBoundingClientRect` for chart tests. Fixed-size charts such as `ProgressRing` pass an explicit `width`/`height` instead.
- **Text layout.** jsdom has no SVG text layout: `getBoundingClientRect` and `getComputedTextLength` return 0. So tests assert on **data, props, fills and ARIA labels**. They never assert on tick counts, tick positions or label placement. Those are left to the screenshot pass.

**Behavior tests:**

| Subject | Asserts |
|---|---|
| `chart-format` | Weeks are Monday-anchored; for `kind: 'count'` a missing week is `0`, and for `kind: 'ratio'` a missing week is `null`; `isDefined` returning false gives `null`; every chart on a page gets an identical week array; `toNum("12.50") === 12.5`; the formatter respects `suffix` and `decimals` |
| `TimelineChart` | One bar per week that has a value, and gaps for `null`; the header shows the latest value and change; the hatch appears only with `inFlightValue`; bars use `var(--accent)`; two instances get different pattern IDs |
| `CommitTypeDonut` | The legend shows count and % with no hover; a total of 0 shows the empty state; hovering changes the center label, which stays chrome-colored; the `in_flight` wedge uses a pattern fill |
| `LinesChangedChart` | Removed lines render below the zero baseline, and the zero reference line is present |
| `TrendChart` | Colors are distinct; a team keeps its color after filtering and after a rank swap (tested through `assignTeamColors` and the caller) |
| `ProgressRing` | The existing size, stroke and zero-volume guarantees, rewritten against the new markup; the angle domain is fixed at 0-100, so 40% doesn't draw as a full ring; with every value at 0, both tracks draw and no path contains `NaN` |
| `SpendImpactScatter` | A developer at exactly the median impact and median cost sits on both reference lines; outliers use the triangle marker and the outlier series; clicking a dot navigates to that developer; no developer with spend shows the empty state |
| `weekKeyForDate` | A Monday-21:00 commit under `TZ=America/New_York` keys to that Monday, not Tuesday (the test runs the helper in a child process with `TZ=America/New_York`. Setting `process.env.TZ` inside a Jest test does not change the time zone in Node 24, because Jest gives each test a copy of `process.env`.) |
| `commitTypeBadge` | Every type returns a badge fill and text color; an unknown type returns `other`'s |

**Guard tests:**

1. **No literal colors.** Chart modules contain no hex color and no `fill-gray-*`/`stroke-gray-*` class. It's a static scan in the style of `logger-enforcement.test.ts`.
2. **Tokens in both modes.** Every `--chart-*` token is defined under both `:root` and `[data-theme-mode="light"]`, in the style of `vuln-trend-colors-css.test.ts`.
3. **Contrast.** In the style of `vuln-series-contrast.test.ts`, this test covers every threshold in Decision 14:
   - The fixed palettes at 3:1 against the card surface in each mode.
   - The ring colors at 3:1 against `--chart-track`.
   - All ten theme accents at 3:1 against their own mode's surface.
   - `--chart-axis` at 4.5:1 against the card, and `--chart-tooltip-text` at 4.5:1 against `--chart-tooltip-bg`.
   - Badge text at 4.5:1 against its badge fill, for all 8 commit types in both modes.
   - `--chart-grid` and `--chart-tooltip-border` are exempt (Decision 14).

   Colorblind separation is checked by the dataviz validator during the palette task, and its output is recorded in [Palette](#palette).

`vuln-trend-chart.test.tsx` and `progress-ring.test.tsx` are rewritten. Their rank-based and `<circle>`-count assertions describe the old implementation.

**Verification before done:**

- The full Jest suite passes.
- `npm run build` passes, which catches extra `page.tsx` exports.
- The mock-mode app (`npm run dev:mock`) is screenshotted on the org page (including its spend tab), the dev, team, home, reports, vulnerabilities and projects pages. That covers every chart and every inline data bar in Decision 1. That's done in one dark theme (Amber Glow) and two light themes: Daylight Blue, whose page background is white, and Fresh Mint, whose isn't (`#F0FDF4`). Fresh Mint shows translucent surfaces against a themed background. The mock seed data must contain in-flight commits (including a small in-flight count next to a large total) and at least one scatter outlier, so the hatch and the outlier marker are actually visible. If it doesn't, `scripts/seed-data.ts` is extended, per CLAUDE.md. The screenshots are checked for:
  - Label collisions, clipping and legibility.
  - Whether the hatch is legible on narrow bars.

## Risks

- **Recharts 3 details found only in the migration guide are unverified.** These are the `CartesianGrid` axis IDs and the `ResponsiveContainer` ref changes. They're confirmed during the wrapper port.
- **Negative bars in a `stackOffset="sign"` stack.**
  - Recharts [#6802](https://github.com/recharts/recharts/issues/6802) reported that negative values in a signed stack failed to render. The fix, PR #6806, was merged on 2025-12-19, before 3.10.1 shipped on 2026-07-25.
  - The wrapper task confirms this in the release notes. The "removed renders below zero" test catches any regression.
  - Two separate `stackId`s are **not** a fallback. They would place added and removed side by side instead of above and below one baseline.
- **Hover sync depends on identical week arrays.** `syncId` matches on index. `buildWeekDomain` guarantees identical arrays within a page, and a test asserts it.
- **`avgComplexity` and `avgImpact` can't tell "no data" from a real 0** within a week that is present, because the payload exposes no denominator (Decision 10). Fixing this needs an API change, which is out of scope.
- **More than 12 vulnerability teams** falls back per Decision 11. That's acceptable but not ideal.
