'use client';

// GLOOK-58: a Recharts LineChart. Colours come from the caller (assignTeamColors over the
// unfiltered series, Decision 11). The chart no longer computes them, because `series` may
// already be filtered. Hovering a line or legend entry fades the others, as before.
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/charts/chart';
import { formatWeek, toNum } from '@/components/charts/chart-format';
import { OTHER_TEAM_COLOR } from './team-colors';

interface TrendRow {
  date: string;
  values: Record<string, number>;
}

// The plot box height, shared by the chart and the empty state. This constant reserves only the
// box; the legend row and the note under it are reserved by the shared skeleton (see TrendChart):
// both branches render the same three children in the same order, so a team filter that empties
// the chart (or fills it again) never resizes the panel.
const CHART_HEIGHT_CLASS = 'h-[200px]';

// The legend reserves TWO lines (min-h = 2 x the explicit 16px leading, zero row gap) in both
// branches. A team click can take a large org's legend from many entries down to one; two lines are
// reserved so that swing costs nothing up to two lines. A third line (much larger orgs, phone
// widths) still grows the row: an accepted residual.
const LEGEND_CLASS = 'flex flex-wrap content-start gap-x-3 gap-y-0 min-h-[32px] text-[11px] leading-4 mt-1';
const NOTE_CLASS = 'text-[10px] leading-[14px] text-gray-500 mt-1';
const TREND_NOTE = 'Each dot is one measurement (an imported CSV run or a sync). Lines start at the first measurement for this view.';

export default function TrendChart({ series, colorByTeam }: { series: TrendSeries[]; colorByTeam: Record<string, string> }) {
  const [hover, setHover] = useState<string | null>(null);
  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
  if (dates.length === 0) {
    // Same skeleton as the populated branch: the plot box, then the legend row and the note. Those
    // two are invisible placeholders (aria-hidden) that keep their height; the note carries the same
    // text as the populated one, so it wraps to the same number of lines at any width.
    return (
      <div data-testid="trend-panel">
        <div className={`${CHART_HEIGHT_CLASS} flex items-center justify-center`}>
          <p className="text-xs text-gray-500">No measurements yet for this view.</p>
        </div>
        <div data-testid="trend-legend" aria-hidden="true" className={`${LEGEND_CLASS} invisible`} />
        <p data-testid="trend-note" aria-hidden="true" className={`${NOTE_CLASS} invisible`}>{TREND_NOTE}</p>
      </div>
    );
  }

  const byDate = new Map<string, TrendRow>(dates.map(d => [d, { date: d, values: {} }]));
  for (const s of series) {
    for (const p of s.points) {
      const row = byDate.get(p.date);
      if (row) row.values[s.team] = toNum(p.open);
    }
  }
  const rows = [...byDate.values()];
  const latest = (s: TrendSeries) => toNum(s.points[s.points.length - 1]?.open);
  const ranked = [...series].sort((a, b) => latest(b) - latest(a) || a.team.localeCompare(b.team));
  const colorOf = (team: string) => colorByTeam[team] ?? OTHER_TEAM_COLOR;
  // Labels only: a colour here would make ChartStyle emit a --color-<team name> custom property
  // per team, keyed by arbitrary text.
  const config: ChartConfig = Object.fromEntries(series.map(s => [s.team, { label: s.team }]));
  // Legend entries are keyed by position, so a team swap can leave `hover` naming a team that is no
  // longer shown (its mouseleave never fires on the reused node). Ignore such a stale hover, or every
  // remaining line would stay dimmed by a team the user can't see.
  const activeHover = ranked.some(s => s.team === hover) ? hover : null;
  const opacity = (team: string) => (activeHover === null || activeHover === team ? 1 : 0.15);

  return (
    <div data-testid="trend-panel">
      <ChartContainer config={config} className={`aspect-auto ${CHART_HEIGHT_CLASS} w-full`}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={formatWeek} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
          <ChartTooltip
            itemSorter={item => -toNum(item.value)}
            content={<ChartTooltipContent indicator="line" labelFormatter={label => String(label)} />}
          />
          {ranked.map(s => (
            <Line
              key={s.team}
              type="linear"
              name={s.team}
              dataKey={(row: TrendRow) => row.values[s.team] ?? null}
              stroke={colorOf(s.team)}
              strokeWidth={2}
              strokeOpacity={opacity(s.team)}
              dot={{ r: 2, fill: colorOf(s.team), strokeWidth: 0, fillOpacity: opacity(s.team) }}
              activeDot={{ r: 4, fill: colorOf(s.team), strokeWidth: 0, fillOpacity: opacity(s.team) }}
              connectNulls
              isAnimationActive={false}
              onMouseEnter={() => setHover(s.team)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </LineChart>
      </ChartContainer>
      {/* Entries are keyed by position and `content-start` keeps them at their natural height: keyed by
          team, a team click looked (to the browser's layout-shift API) like the surviving entry sliding
          to the start of the row, and a stretched single line grew taller than a wrapped one. */}
      <div data-testid="trend-legend" className={LEGEND_CLASS}>
        {ranked.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5 cursor-default"
            onMouseEnter={() => setHover(s.team)} onMouseLeave={() => setHover(null)}>
            <i aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: colorOf(s.team) }} />
            <span className="text-chart-axis">{s.team}</span>
          </span>
        ))}
      </div>
      <p data-testid="trend-note" className={NOTE_CLASS}>{TREND_NOTE}</p>
    </div>
  );
}
