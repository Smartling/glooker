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
import { slotView } from './slot-view';
import RefreshNote from './refresh-note';
import type { TrendRange } from './security-state';
import { TREND_FIGURES_W, TREND_FOOT_GAP, TREND_LEGEND_MIN_W, TREND_PLOT_H, TREND_RANGE_W, TYPE } from './dimensions';
import { displayDate, utcToday } from './labels';
import { openChange } from './overview-format';
import { OTHER_TEAM_COLOR, TEAM_COLOR_SLOTS, assignTeamColors } from './team-colors';
import { buildLegend, dayNumber, isoOfDay, TREND_RANGES, trendDomain, trendRows, trendStatus, trendTicks, type TrendRow } from './trend-model';

const FOOTNOTE = `Each dot is one stored measurement (an imported CSV run or a sync). The ${TEAM_COLOR_SLOTS} owning teams with the most open alerts get a colour; the rest are grey.`;
/** The axes' labels: 11px, as the mockup's. */
const AXIS_TICK = { fontSize: 11 } as const;
const SUBTITLE = 'One point per stored measurement';

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
          tickFormatter={(t: number) => displayDate(isoOfDay(t), today)} tickLine={false} axisLine={false} allowDataOverflow tick={AXIS_TICK}
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} domain={[0, 'auto']} tick={AXIS_TICK} />
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
  // A selected team that has no point in the series draws no line at all: say so on one line, instead of a blank plot.
  const teamMissing = series && url.team !== null && !series.some(s => s.team === url.team) ? `No stored measurements for ${url.team}` : null;
  const change = openChange(summary.delta[sev], sev, today);
  const heading = `Open ${sev} alerts by owning team`;
  const openNow = `${dash(summary.pivot.total[sev].open)} open now`;

  return (
    <section aria-label="Trend" data-testid="trend-card" className="flex flex-col gap-3">
      <h2 className={`${TYPE.sectionLabel} text-gray-400`}>Trend</h2>
      <div className={`${TYPE.card} bg-gray-900 p-4`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white" title={heading}>{heading}</h3>
            <p className="truncate text-xs text-gray-400" title={SUBTITLE}>{SUBTITLE}</p>
          </div>
          {/* As the mockup: the Range select first, then the figures flush right at the card's edge. Both have a fixed width (the select's own, the
              figures' block TREND_FIGURES_W, measured for the widest sentence that fits), so neither moves when the range or a figure changes. The block
              is sized to that widest sentence, not wider, so the gap between the select and a short sentence is as small as a fixed box allows. Each
              figure is one line (cut with "…", the full text in the title). */}
          <div className="flex shrink-0 items-center gap-4">
            <select
              aria-label="Range" value={url.range} onChange={e => url.setRange(e.target.value as TrendRange)}
              className={`h-8 shrink-0 ${TYPE.control} border border-gray-700 bg-gray-800 px-2 text-xs text-gray-200`}
              style={{ width: TREND_RANGE_W }}
            >
              {TREND_RANGES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <div className={`shrink-0 text-right${stale || data.summary.stale ? ' opacity-60' : ''}`} style={{ width: TREND_FIGURES_W }}>
              <div data-testid="trend-open-now" className="truncate text-sm font-semibold text-white" title={openNow}>{openNow}</div>
              <div data-testid="trend-change" className={`h-4 truncate text-xs leading-4 ${change.toneClass}`} title={change.text}>{change.text}</div>
            </div>
          </div>
        </div>

        <div data-testid="trend-plot" className={`relative mt-3${stale ? ' opacity-60' : ''}`} style={{ height: TREND_PLOT_H }}>
          {view.kind === 'error' && <p className="flex h-full items-center justify-center text-xs text-red-400">{view.text}</p>}
          {view.kind === 'loading' && <p className="flex h-full items-center justify-center text-xs text-gray-500">Loading…</p>}
          {view.kind === 'unavailable' && <p data-testid="trend-unavailable" className="flex h-full items-center justify-center text-xs text-gray-500" title={view.title}>{view.text}</p>}
          {/* Live: the trend card owns the announcement for the trend request, unless Range = 90d makes it the sparkline's request (one key,
              one request): then the sparkline's note announces it and this one stays silent. Pointer events stay on, so the error shows in its title. */}
          <RefreshNote error={view.kind === 'data' ? view.refreshError : null} testId="trend-refresh-note" live={data.keys.trend !== data.keys.sparkline} className="absolute right-3 top-0" />
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
              {teamMissing && (
                <p data-testid="trend-team-missing" className="pointer-events-none absolute inset-x-12 top-1/2 -translate-y-1/2 truncate text-center text-xs text-gray-400" title={teamMissing}>{teamMissing}</p>
              )}
            </>
          )}
        </div>

        {/* Entries are keyed by position: keyed by team, a team click looked (to the layout-shift API)
            like the surviving entry sliding to the start of the row. Three lines are reserved, and a long team name is cut at 160px. */}
        <div data-testid="trend-legend-rule" className="mt-3 border-t border-gray-800" aria-hidden="true" />
        <div
          data-testid="trend-legend"
          className={`mt-1.5 grid min-h-[48px] content-start gap-x-4 gap-y-0 text-xs leading-4${stale ? ' opacity-60' : ''}`}
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TREND_LEGEND_MIN_W}px, 1fr))` }}
        >
          {legend.map((e, i) => (
            <span
              key={i} data-testid="trend-legend-entry" title={e.title} className="flex min-w-0 cursor-default items-center gap-1.5"
              style={{ opacity: e.dimmed ? 0.4 : 1 }}
            >
              <i aria-hidden="true" className="inline-block h-[3px] w-3 rounded-sm" style={{ background: e.color }} />
              <span className={`max-w-[160px] truncate text-chart-axis ${e.selected ? 'font-semibold' : ''}`} title={e.title}>{e.label}</span>
              <span className="text-gray-500">{dash(e.open)} open</span>
            </span>
          ))}
        </div>
        <p data-testid="trend-footnote" className="text-xs leading-4 text-gray-500" style={{ marginTop: TREND_FOOT_GAP }}>{FOOTNOTE}</p>
      </div>
    </section>
  );
}
