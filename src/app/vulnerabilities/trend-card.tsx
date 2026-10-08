// src/app/vulnerabilities/trend-card.tsx
'use client';
// GLOOK-64: "Open {severity} alerts by owning team". One line per team, one dot per STORED
// measurement, placed on a numeric time axis by the measurement's actual date. The series is the
// unscoped trend (so colours and the legend never depend on the selected team); a selected team draws
// only its own line and dims the other legend entries. The plot box is TREND_PLOT_H in every state.
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/charts/chart';
import { toNum } from '@/components/charts/chart-format';
import type { SecurityViewProps } from './view-props';
import { dash } from './format';
import { REFRESH_FAILED_NOTE, slotView } from './slot-view';
import type { TrendRange } from './security-state';
import { TREND_PLOT_H, TYPE } from './dimensions';
import { displayDate, utcToday } from './labels';
import { openChange } from './overview-format';
import { OTHER_TEAM_COLOR, assignTeamColors } from './team-colors';
import { buildLegend, dayNumber, isoOfDay, TREND_RANGES, trendDomain, trendRows, trendStatus, trendTicks, type TrendRow } from './trend-model';

const FOOTNOTE = 'Each dot is one stored measurement (an imported CSV run or a sync).';

function Plot({ series, team, range, today }: { series: TrendSeries[]; team: string | null; range: TrendRange; today: string }) {
  const colors = assignTeamColors(series);
  const drawn = team ? series.filter(s => s.team === team) : series;
  const rows = trendRows(drawn);
  const { start, end } = trendDomain(range, series, today);
  // The grey "other" lines go first, so the coloured top-12 lines are drawn over them.
  const ordered = [...drawn].sort((a, b) => Number(colors[b.team] === OTHER_TEAM_COLOR) - Number(colors[a.team] === OTHER_TEAM_COLOR));
  // Labels only: a colour here would make ChartStyle emit a --color-<team name> custom property per team.
  const config: ChartConfig = Object.fromEntries(drawn.map(s => [s.team, { label: s.team }]));
  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full">
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t" type="number" domain={[dayNumber(start), dayNumber(end)]} ticks={trendTicks(start, end)}
          tickFormatter={(t: number) => displayDate(isoOfDay(t), today)} tickLine={false} axisLine={false} allowDataOverflow
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} domain={[0, 'auto']} />
        <ChartTooltip
          itemSorter={item => -toNum(item.value)}
          content={<ChartTooltipContent indicator="line" labelFormatter={(_v, payload) => displayDate(String((payload?.[0]?.payload as TrendRow | undefined)?.date ?? ''), today)} />}
        />
        {ordered.map(s => {
          const other = colors[s.team] === OTHER_TEAM_COLOR;
          const color = colors[s.team] ?? OTHER_TEAM_COLOR;
          return (
            <Line
              key={s.team} type="linear" name={s.team} dataKey={(row: TrendRow) => row.values[s.team] ?? null}
              stroke={color} strokeWidth={other ? 1.25 : 2}
              dot={{ r: other ? 1.5 : 2.5, fill: color, strokeWidth: 0 }} activeDot={{ r: other ? 3 : 4, fill: color, strokeWidth: 0 }}
              connectNulls isAnimationActive={false}
            />
          );
        })}
      </LineChart>
    </ChartContainer>
  );
}

export default function TrendCard({ summary, data, url }: SecurityViewProps) {
  const sev = url.kSev;
  // Own data first (see slot-view.ts): a failed refresh keeps the plot and adds a small note, instead of replacing it.
  const view = slotView(data.trend);
  const series = view.kind === 'data' ? view.data.series : undefined;
  const stale = view.kind === 'data' && view.dimmed;
  const today = utcToday();
  const status = series ? trendStatus(series, url.range, today) : null;
  const legend = series ? buildLegend(series, url.team) : [];
  const change = openChange(summary.delta[sev], sev);

  return (
    <section aria-label="Trend" data-testid="trend-card" className="flex flex-col gap-3">
      <h2 className={`${TYPE.sectionLabel} text-gray-400`}>Trend</h2>
      <div className={`${TYPE.card} bg-gray-900 p-4`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">Open {sev} alerts by owning team</h3>
            <p className="text-xs text-gray-400">One point per stored measurement</p>
          </div>
          <div className="flex shrink-0 items-start gap-4">
            <select
              aria-label="Range" value={url.range} onChange={e => url.setRange(e.target.value as TrendRange)}
              className={`h-8 ${TYPE.control} border border-gray-700 bg-gray-800 px-2 text-xs text-gray-200`}
            >
              {TREND_RANGES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            {/* The figures dim with the plot while the previous key is on screen, and with the summary they come from. */}
            <div className={`text-right${stale || data.summary.stale ? ' opacity-60' : ''}`}>
              <div data-testid="trend-open-now" className="text-sm font-semibold text-white">{dash(summary.pivot.total[sev].open)} open now</div>
              <div data-testid="trend-change" className={`h-4 text-xs leading-4 ${change.toneClass}`}>{change.text}</div>
            </div>
          </div>
        </div>

        <div data-testid="trend-plot" className={`relative mt-3${stale ? ' opacity-60' : ''}`} style={{ height: TREND_PLOT_H }}>
          {view.kind === 'error' && <p className="flex h-full items-center justify-center text-xs text-red-400">{view.text}</p>}
          {view.kind === 'loading' && <p className="flex h-full items-center justify-center text-xs text-gray-500">Loading…</p>}
          {view.kind === 'unavailable' && <p data-testid="trend-unavailable" className="flex h-full items-center justify-center text-xs text-gray-500" title={view.title}>{view.text}</p>}
          {view.kind === 'data' && view.refreshError && (
            <p data-testid="trend-refresh-note" className="pointer-events-none absolute right-3 top-0 text-xs text-red-400" title={view.refreshError}>{REFRESH_FAILED_NOTE}</p>
          )}
          {series && status?.message && (
            <div data-testid="trend-message" className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-sm font-semibold text-gray-300">{status.message.title}</p>
              <p className="text-xs text-gray-500">{status.message.sub}</p>
            </div>
          )}
          {series && status && !status.message && (
            <>
              <Plot series={series} team={url.team} range={url.range} today={today} />
              {status.note && <p data-testid="trend-note" className="pointer-events-none absolute left-9 top-0 text-[11px] text-gray-500">{status.note}</p>}
            </>
          )}
        </div>

        {/* Entries are keyed by position: keyed by team, a team click looked (to the layout-shift API)
            like the surviving entry sliding to the start of the row. Two lines are reserved. */}
        <div data-testid="trend-legend" className={`mt-3 flex min-h-[32px] flex-wrap content-start gap-x-4 gap-y-0 text-[11px] leading-4${stale ? ' opacity-60' : ''}`}>
          {legend.map((e, i) => (
            <span
              key={i} data-testid="trend-legend-entry" title={e.title} className="flex cursor-default items-center gap-1.5"
              style={{ opacity: e.dimmed ? 0.4 : 1 }}
            >
              <i aria-hidden="true" className="inline-block h-[3px] w-3 rounded-sm" style={{ background: e.color }} />
              <span className={`text-chart-axis ${e.selected ? 'font-semibold' : ''}`}>{e.label}</span>
              <span className="text-gray-500">{dash(e.open)} open</span>
            </span>
          ))}
        </div>
        <p data-testid="trend-footnote" className="mt-1 text-[10px] leading-[14px] text-gray-500">{FOOTNOTE}</p>
      </div>
    </section>
  );
}
