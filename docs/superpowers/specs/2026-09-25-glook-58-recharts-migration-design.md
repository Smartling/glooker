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
- Migrating non-chart bars. The `ProjectsCard` volume bar (`src/components/ProjectsCard.tsx:208-262`, `~406-435`) and the sync progress bars (`src/app/reports/page.tsx:451-479`, `src/app/reports/vulnerability-syncs-tab.tsx:124-139`) stay as `<div>`s. Only their colors move to tokens.
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

1. **Single library.** Every chart that encodes data uses Recharts, including `TrendChart` and `ProgressRing`. UI chrome (progress bars, the inline volume bar) stays HTML.
2. **Recharts `^3.10`, with `clsx` and `tailwind-merge@^2.6`.** tailwind-merge 3.x supports Tailwind v4 only. Its README says: "if you use Tailwind v3, use tailwind-merge v2.6.0".
3. **Port shadcn's Tailwind-v3 `new-york` `chart.tsx`, not `new-york-v4`.** The v4 variant uses `outline-hidden` and `border-(--color-border)`, which are v4-only syntax. The v3 variant pins recharts 2.15.4, so the port applies Recharts 3 type changes, such as `TooltipProps` → `TooltipContentProps` ([migration guide](https://github.com/recharts/recharts/wiki/3.0-migration-guide)).
4. **`THEMES = { dark: "", light: '[data-theme-mode="light"]' }`.** The app's unscoped styles are dark, and light is the override. Renaming shadcn's `.dark` key directly would invert every chart. `applyTheme()` (`src/app/themes.ts:93-104`) sets `data-theme-mode` on `<html>`. There is no system mode.
5. **No literal colors in chart code.** Every fill, stroke and text color comes from a CSS variable, defined under `:root` (dark) and `[data-theme-mode="light"]` (light).
6. **Scoped token names.** The wrapper's shadcn classes (`border-border`, `bg-background`, `text-muted-foreground`, `text-foreground`) are rewritten to a `chart.*` Tailwind color namespace, so the app theme gains no generic names.
7. **Single-metric timelines use `var(--accent)`,** so they follow the selected theme. Their in-flight segment is a diagonal hatch of the accent. This also removes the clash between today's in-flight cyan and Midnight Teal's accent.
8. **Multi-series charts use fixed semantic colors.** This covers commit types, lines added and removed, and the two `ProgressRing` arcs. Each has a dark step and a light step. Bug stays red and feature stays blue in every theme.
9. **In-flight is always hatched.** In multi-series charts, the hatch uses the in-flight token color. The pattern is a second visual cue, so in-flight is never shown by color alone.
10. **Bars are placed by date, and missing weeks are `null`.** `buildWeekDomain` returns every Monday-anchored week from the 90-day cutoff to the current week. A week with no data gets `null`, not `0`, because for averages such as lines per PR, "no PRs" isn't zero. Every chart on a page then shares the same x positions, which is what makes `syncId` work.
11. **`TrendChart` colors follow the team, not its rank.** `assignTeamColors(allTeamNames)` sorts the **unfiltered** team list by name and gives each team a fixed slot in the existing `--vuln-series-1..12` palette. A team keeps its color across syncs and filter changes. The only requirement from the product owner is that teams get distinct colors. This replaces GLOOK-43's rank-based assignment.
    **Assumption:** there are at most 12 teams with alerts. If there are more, the 12 teams with the most open alerts get colors, the rest use `--vuln-series-other`, and the legend names them all.
12. **Diverging lines-changed chart.** Lines added go above zero and lines removed go below, with the in-flight part of each hatched. Today all four layers stack upward.
13. **The donut's legend always shows count and %.** When nothing is hovered, the center shows the total. Hovering a slice or legend row still moves that type's figures into the center and dims the other slices.
14. **Palette validation is a gate.** Every fixed palette passes the dataviz validator, once against the dark card surface and once against the light one:
    - Adjacent-pair colorblind separation of ΔE ≥ 8. ΔE is perceived color distance in OKLab ×100.
    - The normal-vision floor.
    - Contrast.

    Tailwind hexes that fail move to the nearest passing shade. The validated values and the validator output go in this spec's [Palette](#palette) section during implementation. Each theme accent is checked against its theme's surface. A contrast warning is acceptable only because every timeline header prints its value as text.

## Architecture

### New modules

| Module | Contents |
|---|---|
| `src/lib/cn.ts` | `cn(...inputs)`, using `clsx` and `tailwind-merge`. |
| `src/components/charts/chart.tsx` | The ported wrapper: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle`, and the `ChartConfig` type. |
| `src/components/charts/chart-format.ts` | Pure helpers: `toNum(v)`, `formatWeek(isoWeek)`, `formatValue(v, { suffix, decimals })`, and `buildWeekDomain(cutoff, today)`. They replace the per-chart inline closures. |
| `src/components/charts/commit-types.ts` | `COMMIT_TYPE_ORDER` (feature, bug, refactor, infra, docs, test, other, in_flight) and the type → token map. Unknown types map to `other`. It replaces `TYPE_HEX`/`TYPE_COLORS` in both pages. |
| `src/components/charts/hatch.tsx` | An SVG `<pattern>` definition that takes a color variable, used for every in-flight segment. |
| `src/components/charts/timeline-chart.tsx` | The single `TimelineChart`. |
| `src/components/charts/stacked-types-chart.tsx` | `StackedTypesChart`. |
| `src/components/charts/lines-changed-chart.tsx` | `LinesChangedChart`. |
| `src/components/charts/commit-type-donut.tsx` | `CommitTypeDonut`, which replaces `PieChart`. |

### Rewritten in place (import paths unchanged)

- `src/app/vulnerabilities/trend-chart.tsx`, plus `assignTeamColors` next to it.
- `src/app/projects/progress-ring.tsx`.

### Pages

`report/[id]/org/page.tsx` and `report/[id]/dev/[login]/page.tsx` keep only data fetching and layout. They lose roughly 500 and 175 lines of drawing code, and still export only `default`. The `{timeline.length >= 2 && ...}` guards stay.

## Theming

### Tokens (`src/app/globals.css`)

Each token is defined under `:root` (dark) and redefined under `[data-theme-mode="light"]`.

- **Chrome:** `--chart-grid`, `--chart-axis`, `--chart-cursor`, `--chart-tooltip-bg`, `--chart-tooltip-border`, `--chart-tooltip-text`, `--chart-track`, `--chart-surface`. `--chart-surface` is used for the 2px gap between segments.
- **Commit types:** `--chart-type-feature`, `-bug`, `-refactor`, `-infra`, `-docs`, `-test`, `-other`, `-in-flight`.
- **Lines:** `--chart-lines-added`, `--chart-lines-removed`.
- **Ring:** `--chart-ring-jira`, `--chart-ring-commits`.
- **Reused unchanged:** `--vuln-series-1..12`, `--vuln-series-other`, `--accent`.

`tailwind.config.ts` registers the chrome tokens under `theme.extend.colors.chart`, for example `chart-axis`.

### Palette

*Filled in during implementation with validated dark and light hex values and the validator's output (Decision 14).*

### Mark specs (from the dataviz skill)

- Bars have a 4px rounded top on the top segment only, and a 2px `--chart-surface` gap between stacked segments.
- The grid is horizontal only and recessive. Axis lines are hidden or faint.
- Trend lines are 2px, and hover markers are at least 8px.
- Text always uses the chrome text tokens, never the series color.
- Recharts' default `accessibilityLayer` stays on.

## Charts

**`TimelineChart`** (5 uses on org, 6 on dev, in `grid-cols-1 md:grid-cols-2` grids)

- **Props:**
  - `data`, and `valueKey` or `computeValue`, as used for the dev page's lines changed (`linesAdded + linesRemoved`).
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
- **Behavior:** Decision 13.
- **Changes:**
  - A square responsive container, at most 320px wide, replaces `min(320px, 50cqw)`.
  - A total of 0 renders the empty state "No categorized commits".

**`TrendChart`** (vulnerabilities)

- **Form:** a `LineChart` with 2px lines, automatic date ticks, and a crosshair tooltip listing teams by value.
- **Keeps:** hovering a line or legend entry fades the other series.
- **Colors:** Decision 11. The plan must confirm whether the component ever receives filtered series. If it does, the caller passes the unfiltered team list in.

**`ProgressRing`** (projects)

- **Form:** a fixed-size `RadialBarChart` with no responsive container.
- **Keeps:**
  - The `Math.log`-based size of 22-48px.
  - Stroke width that scales inversely with size.
  - Jira on the outer ring, commits on the inner ring, and `devCount` in the center.
  - No divide-by-zero when `maxVolume = 0`.

### Every chart

- An explicit empty state.
- Every numeric value passes through `toNum()`, because `DECIMAL`/`REAL` columns may arrive as strings (CLAUDE.md gotcha).
- Charts never throw. `NaN` renders as 0.

## Testing

Tests go in `src/lib/__tests__/unit/` (Jest `roots` is `src/lib`) and use the `/** @jest-environment jsdom */` docblock. A shared helper stubs `ResizeObserver`, which jsdom lacks. If Recharts 3 supports `ResponsiveContainer`'s `initialDimension`, tests may use that instead. The plan must confirm it.

**Behavior tests:**

| Subject | Asserts |
|---|---|
| `chart-format` | Weeks are Monday-anchored; missing weeks are `null`, never `0`; `toNum("12.50") === 12.5`; the formatter respects `suffix` and `decimals` |
| `TimelineChart` | One bar per week with data, and gaps for `null`; the header shows the latest value and change; the hatch appears only with `inFlightValue`; bars use `var(--accent)` |
| `CommitTypeDonut` | The legend shows count and % with no hover; a total of 0 shows the empty state; hovering changes the center label |
| `LinesChangedChart` | Removed lines render below the zero baseline |
| `TrendChart` | Colors are distinct; a team keeps its color after filtering and after a rank swap |
| `ProgressRing` | The existing size, stroke and zero-volume guarantees, rewritten against the new markup |

**Guard tests:**

1. **No literal colors.** Chart modules contain no hex color and no `fill-gray-*`/`stroke-gray-*` class. It's a static scan in the style of `logger-enforcement.test.ts`.
2. **Tokens in both modes.** Every `--chart-*` token is defined under both `:root` and `[data-theme-mode="light"]`, in the style of `vuln-trend-colors-css.test.ts`.
3. **Contrast.** A test for the new fixed palettes, in the style of `vuln-series-contrast.test.ts`.

`vuln-trend-chart.test.tsx` and `progress-ring.test.tsx` are rewritten. Their rank-based and `<circle>`-count assertions describe the old implementation.

**Verification before done:**

- The full Jest suite passes.
- `npm run build` passes, which catches extra `page.tsx` exports.
- The mock-mode app (`npm run dev:mock`) is screenshotted on the org, dev, vulnerabilities and projects pages. That's done in one dark theme (Amber Glow) and one light theme (Daylight Blue). The screenshots are checked for label collisions, clipping and legibility.

## Risks

- **Recharts 3 details found only in the migration guide are unverified.** These are the `CartesianGrid` axis IDs and the `ResponsiveContainer` ref changes. They're confirmed during the wrapper port.
- **Hover sync depends on identical week arrays.** `syncId` matches on index. `buildWeekDomain` guarantees identical arrays within a page, and a test asserts it.
- **More than 12 vulnerability teams** falls back per Decision 11. That's acceptable but not ideal.
