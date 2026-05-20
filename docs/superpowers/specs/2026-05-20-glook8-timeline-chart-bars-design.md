# GLOOK-8: IC Details — Timeline Charts End at "This Week"

## Problem

The four `TimelineChart` instances on `/report/{id}/dev/{login}` position data points by array index, so the chart's right edge always falls on the last available data point. If a developer is on vacation for 2 weeks, the chart ends 2 weeks ago and visually implies recent activity.

## Scope

Single file: `src/app/report/[id]/dev/[login]/page.tsx`, `TimelineChart` function (lines 652–804).

The org report page (`src/app/report/[id]/org/page.tsx`) has a separate `TimelineChart` copy with the same bug; it is explicitly out of scope for this ticket.

## Design

### Switch line chart to bar chart

Replace the SVG line + area fill with `<rect>` bars. This makes gaps structural — a week with no data simply has no bar. No segment-building logic is needed.

### Fixed X-axis range

The X-axis always spans `[cutoff, today]` in milliseconds, where `cutoff` is today minus 90 days (unchanged). The right edge always represents the current week.

Bar x-position (`d.week` is a Monday-anchored ISO date string `YYYY-MM-DD`, produced by `weekKeyForDate()` in `timeline.ts`):
```ts
const today = new Date();
const totalMs = today.getTime() - cutoff.getTime();
const x = padL + ((new Date(d.week).getTime() - cutoff.getTime()) / totalMs) * chartW;
```

### Bar dimensions

Bar width is proportional to one week's share of the full date range, at 85% fill (15% gap between bars):
```ts
const totalWeeks = totalMs / (7 * 24 * 3600 * 1000);
const barWidth = (chartW / totalWeeks) * 0.85;
```

Each bar is centered on its week's Monday x-position:
```ts
const barX = x - barWidth / 2;
const barH = ((v - min) / range) * chartH;
const barY = padT + chartH - barH;  // top-left corner of rect
```

All four metrics (commits, lines changed, avg complexity, AI %) are non-negative, so `min = Math.min(...values, 0)` always equals 0 and bars always start from the baseline. No explicit clamping at the right axis edge is required.

Bars are rendered using the `color` prop, opacity 1, no corner radius.

### X-axis labels

Three labels:
- **Left:** cutoff date, formatted as `"Mon D"` (e.g. "Feb 19") — anchored to the axis origin, not the first data point
- **Middle:** the date at `cutoff + totalMs / 2`, formatted as `"Mon D"`
- **Right:** fixed string `"This week"`

### Hover interaction

The invisible hit target is a full-column `<rect>` spanning `padT` to `padT + chartH` (full chart height), centered on the bar's x-position with width equal to `barWidth`. The vertical guide line x-position is the bar's `x`. The tooltip vertical position anchor is `barY` (top of the bar). Tooltip content is unchanged.

### Empty state guard

Changed from `filtered.length < 2` to `filtered.length < 1` — a single bar is valid and should render.

### Unchanged

- Y-axis ticks, grid lines, and label formatting
- Trend indicator and latest-value display in the card header
- `filtered` array construction (still last-90-days filter)
