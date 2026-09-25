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

export default function TrendChart({ series, colorByTeam }: { series: TrendSeries[]; colorByTeam: Record<string, string> }) {
  const [hover, setHover] = useState<string | null>(null);
  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
  if (dates.length === 0) return <p className="text-xs text-gray-500">No measurements yet for this view.</p>;

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
  const opacity = (team: string) => (hover === null || hover === team ? 1 : 0.15);

  return (
    <div>
      <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
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
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
              onMouseEnter={() => setHover(s.team)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <div className="flex flex-wrap gap-3 text-[11px] mt-1">
        {ranked.map(s => (
          <span key={s.team} className="flex items-center gap-1.5 cursor-default"
            onMouseEnter={() => setHover(s.team)} onMouseLeave={() => setHover(null)}>
            <i aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: colorOf(s.team) }} />
            <span className="text-chart-axis">{s.team}</span>
          </span>
        ))}
      </div>
      <p className="text-[10px] text-gray-500 mt-1">Each dot is one measurement (an imported CSV run or a sync). Lines start at the first measurement for this view.</p>
    </div>
  );
}
