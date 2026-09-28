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

- API or data-shape changes, with one exception. Charts consume the existing `timeline`, `TrendSeries[]` and `EpicRingStats` shapes. The exception is Decision 15: the org and dev report responses each gain two additive fields, `coveredWeeks` and `anchorWeek`.
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
7. **Single-metric timelines use `var(--accent)`,** so they follow the selected theme. Their in-flight segment is a diagonal hatch of the accent. This also removes the clash between today's in-flight cyan and Midnight Teal's accent. *(Amended 2026-09-28 by Decision 16: they read `var(--chart-accent)`, which equals `var(--accent)` unless the user picks a calmer chart color.)*
8. **Multi-series charts use fixed semantic colors.** This covers commit types, lines added and removed, and the two `ProgressRing` arcs. Each has a dark step and a light step. Bug stays red and feature stays blue in every theme.
9. **In-flight is always hatched.** This holds in every chart that shows it: the single-metric timelines, `StackedTypesChart`, `LinesChangedChart`, and the donut's `in_flight` wedge and legend swatch. In multi-series charts the hatch uses the in-flight token color, and in single-metric timelines it uses the accent. The pattern is a second visual cue, so in-flight is never shown by color alone. The mechanics are in [Hatch](#hatch).
10. **Bars are placed by date, and the fill depends on the metric kind.** `aggregateWeekly` (`src/lib/report/timeline.ts:135`) emits **only weeks that have commits**. Its ratios come back as `0` when the denominator is zero, for example `avgLinesPerPr` at `:142`. `buildWeekDomain` returns every Monday-anchored week from the 90-day cutoff to the anchor week, which is the report's own week under Decision 15. `TimelineChart` then fills it according to a `kind` prop:
    - **`kind: 'count'`** covers commits, PRs, lines changed and in-flight commits. A week absent from `data` is filled with `0`, which draws no bar. It is a real zero **only if some report measured it**: the row's `measured` flag says so, and the tooltip reads "Not measured" otherwise (Decision 15). *(Amended 2026-09-25. An earlier revision presented every absent week as a measured zero.)*
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
15. **The report timelines show only measured weeks, in the report's own era.** *(Added 2026-09-25, approved by the product owner.)*

    **Background.** The org and dev timelines are a history across reports:
    - `org.ts:56-68` merges `commit_analyses` from **every** report run for the org, deduplicated by SHA. `dev.ts:85-99` does the same per developer.
    - Each report fetched commits only for its own period, `[created_at − period_days, created_at]` (`report-runner.ts:44`).
    - So the history is continuous only where report periods touch. A week between two report periods was never measured.

    Two problems follow:
    - **False zeros.** Introduced by Decision 10's count fill. A count chart draws an unmeasured week as `0`, and a ratio chart beside it draws the same week as a gap.
    - **The window ends at today, not at the report.** This predates the branch. A report older than 90 days shows none of its own era.

    **The rule: coverage may under-claim, but never over-claim.** A week counts as measured only if it provably was.

    **The fix has three parts.** *(Revised after the Decision 15 review loop.)*
    1. **Coverage from the server.** Both responses gain two additive fields: `coveredWeeks: string[]` and `anchorWeek: string`. No existing field changes.
       - **Which reports count:** completed ones only (`status = 'completed'`).
         - Their window is `[completed_at − period_days × 1 day, created_at]`.
         - Why this is always inside what was searched:
           - Every run, resumed ones included, computes `since = runStart − period_days` (`report-runner.ts:44`).
           - It then searches each member from `since` with **no upper bound**, at some moment at or after `runStart`.
           - So every member's search covered `[runStart − period_days, runStart]`.
           - `created_at ≤ runStart ≤ completed_at`, so the left edge `completed_at − period_days ≥ since`, and the right edge `created_at ≤ runStart`.
         - The earlier right edge `completed_at` could over-claim the tail of a long run. A member searched early wasn't re-searched for commits made later in the same run. *(Corrected after the Task 12 review.)*
         - For a normal run, this loses only the run's own duration at the left. A report resumed long after creation may get an empty window, which under-claims.
         - Failed, stopped, pending and running reports contribute no coverage. Their shipped commits still appear, because a week with shipped data is always measured (part 2).
       - **Org page:** every completed report for the org.
       - **Dev page:** the same org-level coverage as the org page. *(Revised 2026-09-28 by the product owner. An earlier revision used only reports with a `developer_stats` row for this login.)*
         - Why: a `developer_stats` row exists only for developers who committed in that report (`report-runner.ts:131,670` build rows from `aggregate(commits, …)`). Per-login coverage therefore turned a developer's vacation weeks into "Not measured". The product owner's rule is that a week the org's reports covered is measured for every developer, so a week without commits reads 0.
         - Accepted cost: weeks before a developer joined the org, or weeks in a report that skipped them, read 0 rather than "Not measured". Reports run on a daily schedule, so skips are rare.
       - **Out of scope, by the product owner's decision:** test-mode runs (`?test=1`, or a schedule's test-mode toggle) stop after 3 active developers yet finish as `completed`, and they count as normal coverage. Test mode is a debugging aid, and production runs a daily full schedule.
       - **Whole days only:**
         - First take the **union** of all counted windows as time intervals. Two windows that meet mid-day then form one continuous interval, and don't lose the day they share.
         - Mark every UTC calendar day lying fully inside that union.
         - A week is in `coveredWeeks` only if all 7 of its days are marked.
         - A partly covered week is left out, so the edges of a gap never claim a zero.
         - The union never over-claims, because every instant in it was searched.
       - **`anchorWeek`:** `weekKeyForDate` of `completed_at` when `status = 'completed'`, and of `created_at` otherwise. `completed_at` is not a reliable completion marker for other statuses: failed runs set it, and a resumed run keeps its old value while running. It's computed on the server, which parses the SQLite local-time string on the same host that wrote it, so the client never re-parses a database timestamp.
       - **Unparseable timestamps:**
         - A window whose `completed_at` or `created_at` doesn't parse is skipped, which is conservative.
         - `anchorWeek` for a completed report with a missing or unparseable `completed_at` falls back to `created_at`, then to the current week.
         - An `anchorWeek` source that doesn't parse falls back to the current UTC week.
         - Nothing throws.
       - **Shared helper:** one helper in `timeline.ts` turns a list of `{ completedAt, createdAt, periodDays }` reports into windows and then into `coveredWeeks`. The org and dev services differ only in which reports they pass in.
    2. **Filling on the client.**
       - Row values stay **numeric**.
         - In these bar charts `0` and `null` draw the same nothing: `Rectangle` renders nothing at zero height, and `inFlightFloor` returns 0.
         - So the false zero only ever appears in the tooltip.
       - Every row of the three page-grid charts (`TimelineChart`, `LinesChangedChart`, `StackedTypesChart`) gains `measured: boolean`. It is true when the week has **shipped** data or is in `coveredWeeks`.
         - Shipped data means `commits − types.in_flight > 0`. The org timeline's in-flight overlay can create a week bucket holding only in-flight commits, and those prove nothing about shipped work.
         - On the org page, an uncovered in-flight-only week is therefore unmeasured. Its tooltip says shipped work wasn't measured and still shows the in-flight count, consistent with the hatch it draws.
         - The timeline header's "latest" and "previous" weeks follow the same rule, so no unmeasured week shows a value without hover.
         - The dev page has no overlay, so its behavior is unchanged. *(Corrected after the Decision 15 final review. An earlier revision counted any data as proof.)*
         - `fillWeeks` takes an optional `covered: ReadonlySet<string>` and sets `measured`.
         - `buildLinesRows` and the stacked chart's row builder do the same.
         - When `covered` is omitted, every week counts as measured. That's today's behavior, so existing tests and callers are unaffected.
         - Ratio timelines keep their `null` gaps as before. They never claimed a zero.
       - **All three tooltips** read "Not measured" when `measured` is false, instead of showing values.
         - The value stays `0`, which survives Recharts' default `filterNull`, so a real hover reaches the tooltip.
       - **Scope per page:**
         - The org page passes `coveredWeeks` to all seven of its page-grid charts.
         - The dev page has only `TimelineChart`, six instances, and passes it to each.
    3. **The window's anchor.**
       - An exported helper in `chart-format.ts`, `weekDomainEndingAt(anchorWeek)`, builds the 90-day domain ending at `` `${anchorWeek}T00:00:00Z` ``.
       - Both pages call it with the response's `anchorWeek`, instead of `recentWeekDomain(new Date())`. It's one array per page, so `syncId` alignment still holds.
       - The cross-report history still appears inside the window, `avgImpact` included. `avgImpact` is still merged only into weeks that have commits (`org.ts:102-105`).
       - The empty states become "No data in the 90 days before this report" and the matching wording for each chart.

    **What it costs.**
    - Viewing a report from July no longer shows commits that later reports gathered in September. The pages show "the 90 days up to this report" by design.
    - The "Download PDF" print of a historical report matches its era.
    - Weeks covered by only part of a report's period, and a developer's idle weeks, read "Not measured" even though some measurement happened. That's the price of never over-claiming.
16. **Users can pick a calmer chart color in Settings → Appearance.** *(Added 2026-09-28, approved by the product owner after deploy feedback.)*

    **Why.** Feedback from the dev deploy: on dark themes, and on Amber Glow especially, the primary color "screams". Under Decision 7 every single-metric timeline draws a solid accent, which means five charts on the org page and six on the dev page. Main drew each one in a different hue at 70% opacity. Amber Glow's accent has the highest contrast of the ten themes: 5.57:1 against `#111827`, when a mark needs only 3:1.

    **What.** A "Chart colors" control in Settings → Appearance, below the theme cards, with three options:

    | Option | `--chart-accent` | Contrast vs. the card surface |
    |---|---|---|
    | **Vivid** (default) | `var(--accent)` | ≥ 3:1 on all ten themes (unchanged, still guarded) |
    | **Soft** | `color-mix(in srgb, var(--accent) 70%, var(--chart-surface))` | 2.13–3.33:1; main's 70%-opacity look |
    | **Deep** | `var(--accent-dark)` | 2.50–3.53:1 on dark themes, 5.48–7.09:1 on light ones |

    - **Scope:** only the accent-driven marks change, meaning `TimelineChart`'s bars and its in-flight hatch. Multi-series charts keep their semantic tokens (Decision 8). The rest of the UI keeps `--accent`.
    - **Storage:** the choice is saved in `localStorage` under `glooker-chart-accent`, beside `glooker-theme`. It is per browser, like the theme. There's no DB or API change. A missing, unknown or unreadable value means Vivid.
    - **Mechanism:** the theme provider sets `data-chart-accent="vivid|soft|deep"` on `<html>`, the same way `applyTheme` sets `data-theme-mode`. `globals.css` maps the attribute to `--chart-accent`, defaulting to `var(--accent)`. It's pure CSS, so a theme switch re-resolves it with no re-render.
    - **Contrast:** Vivid stays the default and keeps the Decision 14 floor. Soft and Deep are opt-in, and on some themes they fall below 3:1. The user trades legibility for calm, and the control's help text says so. The contrast guard keeps testing Vivid. It doesn't test the opt-in options.
    - **Rejected:**
      - A toggle on the chart section. It clutters two pages and needs its own persistence.
      - Per-theme chart defaults. That's the ideal long-term shape, and it can be layered on later without undoing this.
      - Opacity instead of `color-mix`. The hatch stripes and legend swatches wouldn't follow it.
      - Keeping main's hover brightening. Recharts' cursor band already marks the hovered week.

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

- **Decision 15:**
  - The server: `src/lib/report/timeline.ts` (the shared coverage helper), and `src/lib/report/org.ts` and `src/lib/report/dev.ts` (`coveredWeeks` and `anchorWeek`, and their response types).
  - The client: `chart-format.ts` (`fillWeeks`'s `covered` option and `weekDomainEndingAt`), plus the three charts' rows, tooltips and empty-state text.
  - The org and dev pages read `coveredWeeks` and `anchorWeek` from the response and pass them to their charts.

- **Decision 16:** `src/app/themes.ts` (the chart-accent type, get/save/apply helpers), `src/app/theme-context.tsx` (state plus setter, applied on mount), `src/app/globals.css` (`--chart-accent` and its three rules), `src/components/charts/timeline-chart.tsx` (bars and hatch read `var(--chart-accent)`), and `src/app/settings/page.tsx` (the control in `AppearanceTab`).
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
- **Timeline accent (Decision 16):** `--chart-accent`, defined in both modes as `var(--accent)`. `:root[data-chart-accent="soft"]` and `:root[data-chart-accent="deep"]` override it; their `(0,2,0)` specificity beats both mode blocks.
- **Reused unchanged:** `--vuln-series-1..12`, `--vuln-series-other`, `--accent`.

`tailwind.config.ts` registers the chrome tokens under `theme.extend.colors.chart`, for example `chart-axis`.

### Palette

**Token table.** One row per `--chart-*` token.

| Token | Dark | Light | Colors |
|---|---|---|---|
| `--chart-grid` | `#1f2937` | `#e5e7eb` | Horizontal grid lines (decorative, exempt) |
| `--chart-axis` | `#9ca3af` | `#4b5563` | Axis tick text |
| `--chart-cursor` | `#1f2937` | `#f3f4f6` | Hover cursor fill |
| `--chart-tooltip-bg` | `#1f2937` | `#ffffff` | Tooltip background |
| `--chart-tooltip-border` | `#374151` | `#e5e7eb` | Tooltip border (decorative, exempt) |
| `--chart-tooltip-text` | `#e5e7eb` | `#111827` | Tooltip text |
| `--chart-track` | `#1f2937` | `#e5e7eb` | Ring track / unfilled background the ring colors sit on |
| `--chart-surface` | `#111827` | `#ffffff` | The card color every chart sits on; also the 2px gap between stacked bar segments |
| `--chart-type-feature` | `#3b82f6` | `#2563eb` | Commit type: feature |
| `--chart-type-bug` | `#ef4444` | `#dc2626` | Commit type: bug |
| `--chart-type-refactor` | `#a855f7` | `#9333ea` | Commit type: refactor |
| `--chart-type-infra` | `#eab308` | `#a16207` | Commit type: infra |
| `--chart-type-docs` | `#6b7280` | `#4b5563` | Commit type: docs |
| `--chart-type-test` | `#22c55e` | `#15803d` | Commit type: test |
| `--chart-type-other` | `#d1d5db` | `#374151` | Commit type: other (unrecognized types fold in) |
| `--chart-type-in-flight` | `#06b6d4` | `#0891b2` | Commit type: in-flight (always hatched) |
| `--chart-lines-added` | `#84cc16` | `#65a30d` | Lines-changed chart: added |
| `--chart-lines-removed` | `#ef4444` | `#b91c1c` | Lines-changed chart: removed |
| `--chart-ring-jira` | `#d97706` | `#92400e` | `ProgressRing` Jira arc |
| `--chart-ring-commits` | `#10b981` | `#047857` | `ProgressRing` commits arc |
| `--chart-scatter-typical` | `#60a5fa` | `#2563eb` | Spend vs impact scatter: typical dot |
| `--chart-scatter-outlier` | `#fb923c` | `#c2410c` | Spend vs impact scatter: outlier dot |
| `--chart-volume-prs` | `#06b6d4` | `#0e7490` | `ProjectsCard` volume bar: PR segment |
| `--chart-volume-jiras` | `#a855f7` | `#9333ea` | `ProjectsCard` volume bar: Jira segment |
| `--chart-volume-commits` | `#374151` | `#d1d5db` | `ProjectsCard` volume bar: commits segment (de-emphasized remainder, exempt) |
| `--chart-badge-feature-bg` / `-text` | `#2563eb` / `#ffffff` | `#dbeafe` / `#1e40af` | Feature badge fill/text |
| `--chart-badge-bug-bg` / `-text` | `#dc2626` / `#ffffff` | `#fee2e2` / `#991b1b` | Bug badge fill/text |
| `--chart-badge-refactor-bg` / `-text` | `#9333ea` / `#ffffff` | `#f3e8ff` / `#6b21a8` | Refactor badge fill/text |
| `--chart-badge-infra-bg` / `-text` | `#ca8a04` / `#111827` | `#fef9c3` / `#854d0e` | Infra badge fill/text |
| `--chart-badge-docs-bg` / `-text` | `#4b5563` / `#ffffff` | `#f3f4f6` / `#374151` | Docs badge fill/text |
| `--chart-badge-test-bg` / `-text` | `#15803d` / `#ffffff` | `#dcfce7` / `#166534` | Test badge fill/text |
| `--chart-badge-other-bg` / `-text` | `#374151` / `#ffffff` | `#e5e7eb` / `#1f2937` | Other badge fill/text |
| `--chart-badge-in-flight-bg` / `-text` | `#0e7490` / `#ffffff` | `#cffafe` / `#155e75` | In-flight badge fill/text |

**Moves list.** Every value that moved from its Task 1 starting hex, with the reason.

- `--chart-type-other` (dark) `#4B5563` → `#D1D5DB`: 2.35:1 on `#111827`, below the 3:1 mark-contrast floor.
- `--chart-type-docs` (light) `#6B7280` → `#4B5563`: took the old `other` grey to make room for `other` moving darker below.
- `--chart-type-other` (light) `#4B5563` → `#374151`: `other`/`in_flight` at the original `#0E7490` in-flight failed the normal-vision floor (ΔE 10.4); moving `other` darker, paired with the in-flight hue change below, clears it (isolation ΔE 23.6 colorblind / 25.2 normal).
- `--chart-type-in-flight` (light) `#0E7490` → `#0891B2`: the `docs`/`other` re-step above needed a lighter, more saturated cyan to keep `other`/`in-flight` separated; `infra`/`docs` (`#A16207`/`#6B7280`) also failed the normal-vision floor (ΔE 14.3) at the original grey, which the `docs` move above also fixes.
- `--chart-lines-added` (dark) `#10B981` → `#84CC16`: emerald vs. the in-flight cyan `#06B6D4` failed the normal-vision floor (ΔE 12.5, below 15). Lime clears every pair (worst normal ΔE 23.5, worst colorblind ΔE 12.7). This is a hue change, not just a shade move — see reason 4 below.
- `--chart-lines-added` (light) `#047857` → `#65A30D`: emerald vs. the new in-flight teal `#0891B2` still failed the normal-vision floor (ΔE 14.3, just under 15). Lime (same hue family as the dark move) clears it once `removed` also moves (next row).
- `--chart-lines-removed` (light) `#DC2626` → `#B91C1C`: lime `added` vs. `#DC2626` failed colorblind separation (ΔE 6.1) — that pair is added/removed, which has no in-flight exception, so it needs the full 8 floor. Red one shade darker (red-700) clears it (ΔE 13.3) without moving `added` again.
- `--chart-ring-jira` (light) `#B45309` → `#92400E`: `ring-jira`/`ring-commits` (`#B45309`/`#047857`) scored colorblind ΔE 7.9 — just under the 8 floor, and the ring has no hatch to justify the 6-8 allowance (that allowance is in-flight-only, and the ring has no in-flight color). Amber one shade darker (amber-800) clears it (ΔE 8.1). This was not in Task 1's known-failures list; it surfaced during this task's validator run.

**Validator output**, one fenced block per palette/mode/run, all from Step 4's final (passing) candidates:

Commit types, dark, full order:
```
Palette (dark, surface #111827, categorical): 8 slots
  [FAIL] Lightness band         outside band: [["#EAB308",0.795],["#22C55E",0.723],["#D1D5DB",0.872],["#06B6D4",0.715]]
  [FAIL] Chroma floor           below floor (reads gray): [["#6B7280",0.023],["#D1D5DB",0.009]]
  [PASS] CVD separation         worst adjacent #06B6D4↔#D1D5DB ΔE 12.5 (protan) · tritan 18.1
  [PASS] Normal-vision floor    worst adjacent #06B6D4↔#D1D5DB ΔE 19.7 (normal)
  [PASS] Contrast vs surface    all 8 >= 3:1
```

Commit types, light, full order:
```
Palette (light, surface #ffffff, categorical): 8 slots
  [FAIL] Lightness band         outside band: [["#374151",0.373]]
  [FAIL] Chroma floor           below floor (reads gray): [["#4B5563",0.026],["#374151",0.031]]
  [PASS] CVD separation         worst adjacent #15803D↔#4B5563 ΔE 12.2 (deutan) · tritan 11.3
  [PASS] Normal-vision floor    worst adjacent #15803D↔#4B5563 ΔE 16.8 (normal)
  [PASS] Contrast vs surface    all 8 >= 3:1
```

Commit types, dark, without in-flight:
```
Palette (dark, surface #111827, categorical): 7 slots
  [FAIL] Lightness band         outside band: [["#EAB308",0.795],["#22C55E",0.723],["#D1D5DB",0.872]]
  [FAIL] Chroma floor           below floor (reads gray): [["#6B7280",0.023],["#D1D5DB",0.009]]
  [PASS] CVD separation         worst adjacent #D1D5DB↔#22C55E ΔE 16.6 (protan) · tritan 18.8
  [PASS] Normal-vision floor    worst adjacent #D1D5DB↔#22C55E ΔE 24.6 (normal)
  [PASS] Contrast vs surface    all 7 >= 3:1
```

Commit types, light, without in-flight:
```
Palette (light, surface #ffffff, categorical): 7 slots
  [FAIL] Lightness band         outside band: [["#374151",0.373]]
  [FAIL] Chroma floor           below floor (reads gray): [["#4B5563",0.026],["#374151",0.031]]
  [PASS] CVD separation         worst adjacent #15803D↔#4B5563 ΔE 12.2 (deutan) · tritan 11.3
  [PASS] Normal-vision floor    worst adjacent #15803D↔#4B5563 ΔE 16.8 (normal)
  [PASS] Contrast vs surface    all 7 >= 3:1
```

`other`/`in_flight` in isolation, dark (uses the 6-8 colorblind allowance's headroom, well clear of it):
```
Palette (dark, surface #111827, categorical): 2 slots
  [FAIL] Lightness band         outside band: [["#D1D5DB",0.872],["#06B6D4",0.715]]
  [FAIL] Chroma floor           below floor (reads gray): [["#D1D5DB",0.009]]
  [PASS] CVD separation         worst adjacent #06B6D4↔#D1D5DB ΔE 12.5 (protan) · tritan 18.1
  [PASS] Normal-vision floor    worst adjacent #06B6D4↔#D1D5DB ΔE 19.7 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

`other`/`in_flight` in isolation, light:
```
Palette (light, surface #ffffff, categorical): 2 slots
  [FAIL] Lightness band         outside band: [["#374151",0.373]]
  [FAIL] Chroma floor           below floor (reads gray): [["#374151",0.031]]
  [PASS] CVD separation         worst adjacent #0891B2↔#374151 ΔE 23.6 (deutan) · tritan 26.6
  [PASS] Normal-vision floor    worst adjacent #0891B2↔#374151 ΔE 25.2 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Lines, dark, all pairs (added, in-flight, removed):
```
Palette (dark, surface #111827, categorical): 3 slots
  [FAIL] Lightness band         outside band: [["#84CC16",0.768],["#06B6D4",0.715]]
  [PASS] Chroma floor           all 3 >= 0.1
  [PASS] CVD separation         worst all-pairs #EF4444↔#84CC16 ΔE 12.7 (deutan) · tritan 7.7
  [PASS] Normal-vision floor    worst all-pairs #06B6D4↔#84CC16 ΔE 23.5 (normal)
  [PASS] Contrast vs surface    all 3 >= 3:1
```
The worst-CVD pair here is `added`/`removed` (no in-flight exception, and it clears 8 anyway at 12.7). The tritan 7.7 belongs to a different pair; see the `added`/`in-flight` isolation run below, which confirms it and that it's within the allowed 6-8 band.

Lines, light, all pairs (added, in-flight, removed):
```
Palette (light, surface #ffffff, categorical): 3 slots
  [PASS] Lightness band         all 3 inside L 0.43–0.77
  [PASS] Chroma floor           all 3 >= 0.1
  [PASS] CVD separation         worst all-pairs #B91C1C↔#65A30D ΔE 13.3 (deutan) · tritan 6.0
  [PASS] Normal-vision floor    worst all-pairs #0891B2↔#65A30D ΔE 21.1 (normal)
  [PASS] Contrast vs surface    all 3 >= 3:1
```
The tritan 6.0 belongs to `added`/`in-flight` (`#65A30D`/`#0891B2`), confirmed by the `added`/`in-flight` isolation run below — that pair includes in-flight, so 6.0 is within the allowed 6-8 band. The `added`/`removed` pair (no exception) is 13.3, well clear.

Lines, `added`/`removed` alone (the pair with no in-flight exception), dark:
```
Palette (dark, surface #111827, categorical): 2 slots
  [FAIL] Lightness band         outside band: [["#84CC16",0.768]]
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #EF4444↔#84CC16 ΔE 12.7 (deutan) · tritan 34.5
  [PASS] Normal-vision floor    worst adjacent #EF4444↔#84CC16 ΔE 35.3 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Lines, `added`/`removed` alone, light:
```
Palette (light, surface #ffffff, categorical): 2 slots
  [PASS] Lightness band         all 2 inside L 0.43–0.77
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #B91C1C↔#65A30D ΔE 13.3 (deutan) · tritan 29.4
  [PASS] Normal-vision floor    worst adjacent #B91C1C↔#65A30D ΔE 32.2 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Lines, `added`/`in-flight` in isolation, dark (confirms the full-order run's tritan 7.7 belongs to this pair, within the allowed 6-8 band):
```
Palette (dark, surface #111827, categorical): 2 slots
  [FAIL] Lightness band         outside band: [["#84CC16",0.768],["#06B6D4",0.715]]
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #06B6D4↔#84CC16 ΔE 22.3 (protan) · tritan 7.7
  [PASS] Normal-vision floor    worst adjacent #06B6D4↔#84CC16 ΔE 23.5 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Lines, `removed`/`in-flight` in isolation, dark (clears every check with no allowance needed):
```
Palette (dark, surface #111827, categorical): 2 slots
  [FAIL] Lightness band         outside band: [["#06B6D4",0.715]]
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #06B6D4↔#EF4444 ΔE 19.3 (deutan) · tritan 39.2
  [PASS] Normal-vision floor    worst adjacent #06B6D4↔#EF4444 ΔE 34.1 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Lines, `added`/`in-flight` in isolation, light (confirms the full-order run's tritan 6.0 belongs to this pair, within the allowed 6-8 band):
```
Palette (light, surface #ffffff, categorical): 2 slots
  [PASS] Lightness band         all 2 inside L 0.43–0.77
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #0891B2↔#65A30D ΔE 20.0 (protan) · tritan 6.0
  [PASS] Normal-vision floor    worst adjacent #0891B2↔#65A30D ΔE 21.1 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Lines, `removed`/`in-flight` in isolation, light (clears every check with no allowance needed):
```
Palette (light, surface #ffffff, categorical): 2 slots
  [PASS] Lightness band         all 2 inside L 0.43–0.77
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #0891B2↔#B91C1C ΔE 19.9 (deutan) · tritan 33.5
  [PASS] Normal-vision floor    worst adjacent #0891B2↔#B91C1C ΔE 31.7 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Ring, dark:
```
Palette (dark, surface #111827, categorical): 2 slots
  [FAIL] Lightness band         outside band: [["#10B981",0.696]]
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #10B981↔#D97706 ΔE 10.7 (deutan) · tritan 29.9
  [PASS] Normal-vision floor    worst adjacent #10B981↔#D97706 ΔE 24.4 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Ring, light (after the `ring-jira` move to `#92400E`):
```
Palette (light, surface #ffffff, categorical): 2 slots
  [PASS] Lightness band         all 2 inside L 0.43–0.77
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #047857↔#92400E ΔE 8.1 (deutan) · tritan 24.4
  [PASS] Normal-vision floor    worst adjacent #047857↔#92400E ΔE 20.2 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```
The pre-move candidate (`#B45309`/`#047857`) scored colorblind ΔE 7.9 here — inside the 6-8 band, which is legal only with secondary encoding. The ring has none, so this needed a move; see the Moves list.

Scatter, dark:
```
Palette (dark, surface #111827, categorical): 2 slots
  [FAIL] Lightness band         outside band: [["#60A5FA",0.714],["#FB923C",0.758]]
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #FB923C↔#60A5FA ΔE 25.8 (protan) · tritan 28.3
  [PASS] Normal-vision floor    worst adjacent #FB923C↔#60A5FA ΔE 30.2 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Scatter, light:
```
Palette (light, surface #ffffff, categorical): 2 slots
  [PASS] Lightness band         all 2 inside L 0.43–0.77
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #C2410C↔#2563EB ΔE 31.7 (protan) · tritan 31.6
  [PASS] Normal-vision floor    worst adjacent #C2410C↔#2563EB ΔE 36.1 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Volume (`prs`, `jiras`), dark:
```
Palette (dark, surface #111827, categorical): 2 slots
  [FAIL] Lightness band         outside band: [["#06B6D4",0.715]]
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #A855F7↔#06B6D4 ΔE 15.1 (deutan) · tritan 20.8
  [PASS] Normal-vision floor    worst adjacent #A855F7↔#06B6D4 ΔE 27.6 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Volume (`prs`, `jiras`), light:
```
Palette (light, surface #ffffff, categorical): 2 slots
  [PASS] Lightness band         all 2 inside L 0.43–0.77
  [FAIL] Chroma floor           below floor (reads gray): [["#0E7490",0.094]]
  [PASS] CVD separation         worst adjacent #9333EA↔#0E7490 ΔE 14.2 (deutan) · tritan 14.1
  [PASS] Normal-vision floor    worst adjacent #9333EA↔#0E7490 ΔE 25.5 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

**Hue changes.** Two colors moved outside a simple same-hue-family shade snap:
- `--chart-type-in-flight` (light) moved from `#0E7490` to the more saturated `#0891B2`, both cyan/teal — a shade move within the same hue, not a new hue, driven by the `other`/`docs` re-step above.
- `--chart-lines-added` (both modes) moved from emerald (`#10B981`/`#047857`) to lime (`#84CC16`/`#65A30D`). This is a hue shift within the broad green family (still recognizably green, per the controller's instruction to keep it green where possible) — emerald sits too close to the cyan in-flight token in both modes to clear the normal-vision floor, and lime was the only green-family shade found that clears every pair, including `added`/`removed` in light mode once `removed` also moved one shade darker.

**Not gated.** The **lightness band** and **chroma floor** checks are recorded above but not gated — `docs` and `other` are grays by design and always fail the chroma floor, which is why the validator exits 1 on otherwise-passing runs; only the CVD separation, normal-vision floor and 3:1 contrast lines are enforced. `--chart-grid` and `--chart-tooltip-border` are exempt from contrast (decorative). `--chart-volume-commits` is exempt from contrast (de-emphasized remainder).

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
| Coverage, server (Decision 15) | Only fully covered UTC weeks are listed: a 14-day window from a Wednesday lists only the weeks all 7 of whose days are inside it. Two completed reports with a gap leave the gap's weeks out. Overlapping windows don't duplicate keys. Failed, stopped and running reports add nothing. A window is `[completed_at − period_days, created_at]`: a long run doesn't claim its own tail, and a report resumed long after creation contributes nothing. The dev page returns the same `coveredWeeks` as the org page for the report's org. A developer with no commits in a covered week gets a measured 0, not "Not measured". Two windows meeting mid-day leave no hole. `anchorWeek` is `completed_at`'s week for a completed report and `created_at`'s otherwise, including for a resumed running report with a stale `completed_at`. An unparseable timestamp doesn't throw. No existing test asserts the exact response shape with `toEqual` in a way the additive fields would break; adjust any that does |
| Coverage, client (Decision 15) | `measured` is true for a week with shipped data (`commits − in_flight > 0`) or in `covered`, false otherwise. An uncovered in-flight-only week is unmeasured, and its tooltip shows the in-flight count. The header's latest and change skip unmeasured weeks. Ratio `isDefined` gates key on shipped work, so a covered in-flight-only week is a gap, not 0%. `measured` is and true everywhere when `covered` is omitted, on the rows of all three charts. All three tooltips, rendered directly, read "Not measured" when `measured` is false and show values otherwise. `weekDomainEndingAt(anchorWeek)` ends at that week, and the same array reaches every chart on the page. Plus ONE real hover over an unmeasured week on the org page in headless Chrome, showing "Not measured", as part of the screenshot pass |
| `chart-format` | Weeks are Monday-anchored; for `kind: 'count'` a missing week is `0`, and for `kind: 'ratio'` a missing week is `null`; `isDefined` returning false gives `null`; every chart on a page gets an identical week array; `toNum("12.50") === 12.5`; the formatter respects `suffix` and `decimals` |
| `TimelineChart` | One bar per week that has a value, and gaps for `null`; the header shows the latest value and change; the hatch appears only with `inFlightValue`; bars and hatch stripes use `var(--chart-accent)` (Decision 16), never `var(--accent)` directly; two instances get different pattern IDs |
| Chart color preference (Decision 16) | The saved value round-trips through `localStorage`; a missing or unknown value, or a `localStorage` that throws, reads as `vivid`; applying it sets `data-chart-accent` on `<html>`; the provider applies the saved value on mount; the Settings control shows three options with Vivid selected by default, and clicking one saves it and sets the attribute; `globals.css` defines `--chart-accent` as `var(--accent)` in both modes, and the `soft` and `deep` rules resolve to the table's values |
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
   - All ten theme accents at 3:1 against their own mode's surface. This is the Vivid default of `--chart-accent`. The opt-in Soft and Deep options aren't held to it (Decision 16).
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
