# GLOOK-8: IC Details — Timeline Charts End at "This Week"

## Problem

The four `TimelineChart` instances on `/report/{id}/dev/{login}` position data points by array index, so the chart's right edge always falls on the last available data point. If a developer is on vacation for 2 weeks, the chart ends 2 weeks ago and visually implies recent activity.

## Scope

Single file: `src/app/report/[id]/dev/[login]/page.tsx`, `TimelineChart` function (lines 652–804).

The org report page (`src/app/report/[id]/org/page.tsx`) has a separate `TimelineChart` copy with the same bug; it is out of scope for this ticket.

## Design

### Switch line chart to bar chart

Replace the SVG line + area fill with `<rect>` bars. This makes gaps structural — a week with no data simply has no bar. No segment-building logic is needed.

### Fixed X-axis range

The X-axis always spans `[cutoff, today]` in milliseconds, where `cutoff` is today minus 90 days (unchanged). The right edge always represents the current week.

Point x-position:
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

### X-axis labels

Three labels:
- **Left:** first data point's week, formatted as `"Mon D"` (e.g. "Feb 24")
- **Middle:** the date at `cutoff + totalMs / 2`, formatted as `"Mon D"`
- **Right:** fixed string `"This week"`

### Hover interaction

The invisible hit target switches from `<circle>` to `<rect>` covering the bar's column. Tooltip content and positioning logic are unchanged.

### Unchanged

- Y-axis ticks, grid lines, and label formatting
- Trend indicator and latest-value display in the card header
- `filtered` array construction (still last-90-days filter)
- The `if (filtered.length < 2) return null` guard
