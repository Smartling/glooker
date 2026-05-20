# GLOOK-8: Timeline Charts End at "This Week" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the line chart in `TimelineChart` with a bar chart whose X-axis always spans the last 90 days to today, so inactive developers show an empty right portion rather than a truncated axis.

**Architecture:** Single function rewrite in one file. The `TimelineChart` component in `src/app/report/[id]/dev/[login]/page.tsx` switches from SVG line+area paths to `<rect>` bars positioned by date on a fixed `[cutoff, today]` range. No data layer changes; gaps between bars are structural.

**Tech Stack:** React (SVG), TypeScript. No new dependencies. Jest (ts-jest, node environment) covers `src/lib` only — no automated component tests exist for this change; use visual verification via mock dev server.

---

### Task 1: Rewrite `TimelineChart` to bar chart

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx:652-804`

- [ ] **Step 1: Locate the function and understand what to replace**

Open `src/app/report/[id]/dev/[login]/page.tsx`. The `TimelineChart` function runs from line 652 to 804. The section to replace is everything inside the function body — the line/area SVG paths, the index-based `points` array, the old X-axis label logic, and the hover circle.

Keep unchanged: the function signature, the `cutoff`/`filtered` setup, the `values`/`max`/`min`/`range` computation, all `yTicks` logic, the `W/H/padL/padR/padT/padB/chartW/chartH` constants, the trend indicator, and the outer `<div>` and header JSX.

- [ ] **Step 2: Replace the `TimelineChart` function body**

Replace the entire `TimelineChart` function (lines 652–804) with the following:

```tsx
function TimelineChart({
  data,
  valueKey,
  label,
  color,
  suffix = '',
  decimals = 0,
  computeValue,
}: {
  data: WeeklyData[];
  valueKey: string;
  label: string;
  color: string;
  suffix?: string;
  decimals?: number;
  computeValue?: (d: WeeklyData) => number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Last 90 days of data
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const filtered = data.filter(d => d.week >= cutoffStr);

  if (filtered.length < 1) return null;

  const values = filtered.map(d => computeValue ? computeValue(d) : (d as any)[valueKey] as number);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  // Y-axis: pick nice round tick values
  const yTicks: number[] = [];
  const step = range <= 5 ? 1 : range <= 20 ? 5 : range <= 100 ? 20 : range <= 500 ? 100 : range <= 2000 ? 500 : Math.ceil(range / 5 / 100) * 100;
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    yTicks.push(v);
  }
  if (yTicks.length === 0) yTicks.push(min, max);
  if (yTicks.length > 6) {
    const keep = [yTicks[0], yTicks[Math.floor(yTicks.length / 2)], yTicks[yTicks.length - 1]];
    yTicks.length = 0;
    yTicks.push(...keep);
  }

  const W = 400;
  const H = 130;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // Fixed X-axis range: [cutoff, today].
  // d.week is a Monday-anchored ISO date string (YYYY-MM-DD) from weekKeyForDate() in timeline.ts.
  // Parse with T00:00:00 to stay in local time, consistent with formatWeek below.
  const today = new Date();
  const totalMs = today.getTime() - cutoff.getTime();
  const totalWeeks = totalMs / (7 * 24 * 3600 * 1000);
  const barWidth = (chartW / totalWeeks) * 0.85;

  const bars = filtered.map((d, i) => {
    const x = padL + ((new Date(d.week + 'T00:00:00').getTime() - cutoff.getTime()) / totalMs) * chartW;
    const v = values[i];
    const barH = ((v - min) / range) * chartH;
    const barY = padT + chartH - barH;
    return { x, barY, barH, v, week: d.week };
  });

  const formatWeek = (w: string) => {
    const d = new Date(w + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const formatVal = (v: number) => (decimals > 0 ? v.toFixed(decimals) : String(Math.round(v))) + suffix;

  // X-axis labels: left = cutoff (axis origin), middle = midpoint of range, right = "This week"
  const middleDate = new Date(cutoff.getTime() + totalMs / 2);
  const middleLabel = formatWeek(middleDate.toISOString().split('T')[0]);

  const latest = values[values.length - 1];
  const prev = values.length >= 2 ? values[values.length - 2] : latest;
  const trend = latest > prev ? '+' : latest < prev ? '' : '';
  const diff = latest - prev;

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-white">
            {formatVal(latest)}
          </span>
          {diff !== 0 && (
            <span className={`text-xs ${diff > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {trend}{formatVal(Math.abs(diff))}
            </span>
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Grid lines + Y-axis labels */}
        {yTicks.map(v => {
          const y = padT + chartH - ((v - min) / range) * chartH;
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#1F2937" strokeWidth="1" />
              <text x={padL - 6} y={y + 3.5} textAnchor="end" className="fill-gray-600" fontSize="9">
                {decimals > 0 ? v.toFixed(decimals) : v}{suffix}
              </text>
            </g>
          );
        })}
        {/* Bars — color prop, opacity 1, no corner radius */}
        {bars.map((bar, i) => (
          <rect
            key={i}
            x={bar.x - barWidth / 2}
            y={bar.barY}
            width={barWidth}
            height={bar.barH}
            fill={color}
            opacity={1}
          />
        ))}
        {/* Full-column invisible hover targets (rendered after bars to sit on top) */}
        {bars.map((bar, i) => (
          <rect
            key={i}
            x={bar.x - barWidth / 2}
            y={padT}
            width={barWidth}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}
        {/* Hover tooltip */}
        {hoverIdx !== null && (() => {
          const bar = bars[hoverIdx];
          const weekLabel = formatWeek(bar.week);
          const valLabel = formatVal(bar.v);
          const text = `${weekLabel}: ${valLabel}`;
          const textW = text.length * 6 + 16;
          const tooltipX = Math.min(Math.max(bar.x - textW / 2, 2), W - textW - 2);
          const above = bar.barY > padT + 30;
          const tooltipY = above ? bar.barY - 28 : bar.barY + 12;
          return (
            <g>
              {/* Vertical guide line */}
              <line x1={bar.x} y1={padT} x2={bar.x} y2={padT + chartH} stroke={color} strokeWidth="1" opacity="0.3" strokeDasharray="3,3" />
              {/* Tooltip background */}
              <rect x={tooltipX} y={tooltipY} width={textW} height={20} rx="4" fill="#1F2937" stroke="#374151" strokeWidth="1" />
              {/* Tooltip text */}
              <text x={tooltipX + textW / 2} y={tooltipY + 14} textAnchor="middle" className="fill-gray-200" fontSize="10" fontWeight="500">
                {text}
              </text>
            </g>
          );
        })()}
        {/* X-axis labels: left = cutoff, middle = midpoint, right = "This week" */}
        <text x={padL} y={H - 4} textAnchor="start" className="fill-gray-600" fontSize="10">
          {formatWeek(cutoffStr)}
        </text>
        <text x={padL + chartW / 2} y={H - 4} textAnchor="middle" className="fill-gray-600" fontSize="10">
          {middleLabel}
        </text>
        <text x={padL + chartW} y={H - 4} textAnchor="end" className="fill-gray-600" fontSize="10">
          This week
        </text>
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. If you see "Property 'linesChanged' does not exist on type 'WeeklyData'" — that's expected; `linesChanged` is computed via `computeValue` prop, not a direct key. Any other errors in `page.tsx` are a problem.

- [ ] **Step 4: Start mock dev server and verify visually**

```bash
npm run dev:mock
```

Navigate to `http://localhost:3000`. Open any report, then click on a developer. Verify:

1. **Four bar charts appear** in the "Activity Over Time" section
2. **Right edge label reads "This week"** on all four charts
3. **Left edge label shows a date ~90 days ago** (approximately Feb 19 if today is May 20)
4. **Bars are positioned across the full 90-day range** — not bunched at the left
5. **Hovering a bar shows a tooltip** with the week date and value
6. **Vertical guide line appears** on hover, aligned to the center of the hovered bar

- [ ] **Step 5: Commit**

```bash
git add src/app/report/[id]/dev/[login]/page.tsx
git commit -m "feat(glook-8): replace timeline line chart with date-anchored bar chart"
```
