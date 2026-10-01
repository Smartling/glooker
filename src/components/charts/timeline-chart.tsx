'use client';

// GLOOK-58: the one TimelineChart (it used to exist twice, in the org and dev pages, and the
// copies had diverged). Bars are placed by date on the page's shared week domain, so every chart
// in a grid has the same array and hover sync (syncId, matched by index) lines up.
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS, NotMeasuredTooltip } from './chart';
import { fillWeeks, formatCompact, formatValue, formatWeek, type MetricKind, type WeekPoint } from './chart-format';
import { inFlightFloor, useHatch } from './hatch';

export interface TimelineRow {
  week: string;
}

export interface TimelinePoint {
  week: string;
  value: number | null;
  shipped: number | null;
  inFlight: number | null;
  /** Decision 15: false when the week has no SHIPPED data and no report measured it. */
  measured: boolean;
}

export interface TimelineChartProps<T extends TimelineRow> {
  data: T[];
  /** The page's shared week domain (weekDomainEndingAt(anchorWeek)). */
  weeks: string[];
  /** Decision 15: the weeks some report provably measured. Omitted: every week counts as measured. */
  coveredWeeks?: string[];
  valueKey?: keyof T & string;
  computeValue?: (row: T) => unknown;
  kind: MetricKind;
  isDefined?: (row: T) => boolean;
  label: string;
  suffix?: string;
  decimals?: number;
  /** Per-week in-flight portion of the value (a part of the total, not an addition to it). */
  inFlightValue?: (row: T) => unknown;
  syncId: string;
}

export interface TimelineRowOptions<T> {
  value: (row: T) => unknown;
  kind: MetricKind;
  isDefined?: (row: T) => boolean;
  inFlightValue?: (row: T) => unknown;
  covered?: ReadonlySet<string>;
}

/**
 * The chart's rows from real week data. In-flight is a portion of the week's total, clamped to
 * [0, value]. Exported so tests can drive real rows into TimelineTooltip, as buildLinesRows does:
 * Recharts never activates its tooltip on a synthetic jsdom mouse event.
 */
export function buildTimelineRows<T extends TimelineRow>(
  weeks: string[],
  data: T[],
  opts: TimelineRowOptions<T>,
): { points: WeekPoint<T>[]; rows: TimelinePoint[] } {
  const points = fillWeeks(weeks, data, { value: opts.value, kind: opts.kind, isDefined: opts.isDefined, covered: opts.covered });
  const inFlight = opts.inFlightValue ? fillWeeks(weeks, data, { value: opts.inFlightValue, kind: 'count' }) : null;
  const rows: TimelinePoint[] = points.map((p, i) => {
    if (p.value === null) return { week: p.week, value: null, shipped: null, inFlight: null, measured: p.measured };
    const f = inFlight ? Math.min(Math.max(0, inFlight[i].value ?? 0), p.value) : 0;
    return { week: p.week, value: p.value, shipped: p.value - f, inFlight: f, measured: p.measured };
  });
  return { points, rows };
}

type TimelineTooltipProps = Partial<TooltipContentProps<TooltipValueType, string | number>> & {
  suffix?: string;
  decimals?: number;
  split?: boolean;
};

export function TimelineTooltip({ active, payload, suffix = '', decimals = 0, split = false }: TimelineTooltipProps) {
  const row = payload?.[0]?.payload as TimelinePoint | undefined;
  if (!active || !row) return null;
  const fmt = (v: number) => formatValue(v, { suffix, decimals });
  const inFlight = row.inFlight ?? 0;
  if (row.measured === false) {
    return <NotMeasuredTooltip week={row.week} inFlight={split && inFlight > 0 ? fmt(inFlight) : undefined} />;
  }
  if (row.value === null) return null;
  return (
    <div className={CHART_TOOLTIP_CLASS}>
      <div className="font-medium">{formatWeek(row.week)}</div>
      <div className="font-mono tabular-nums">{fmt(row.value)}</div>
      {split && inFlight > 0 && (
        <>
          <div className="flex justify-between gap-4"><span>Shipped</span><span className="font-mono tabular-nums">{fmt(row.shipped ?? 0)}</span></div>
          <div className="flex justify-between gap-4"><span>In flight</span><span className="font-mono tabular-nums">{fmt(inFlight)}</span></div>
        </>
      )}
    </div>
  );
}

function shippedShape(props: BarShapeProps) {
  const row = props.payload as TimelinePoint;
  const top = !((row.inFlight ?? 0) > 0);
  return <Rectangle {...(props as RectangleProps)} radius={top ? [4, 4, 0, 0] : 0} />;
}

export function TimelineChart<T extends TimelineRow>({
  data, weeks, coveredWeeks, valueKey, computeValue, kind, isDefined, label, suffix = '', decimals = 0, inFlightValue, syncId,
}: TimelineChartProps<T>) {
  // GLOOK-58 Decision 16: reads the user's chart-color preference (Vivid/Soft/Deep), which
  // defaults to the theme accent.
  const hatch = useHatch('var(--chart-accent)');
  const read = (row: T): unknown => (computeValue ? computeValue(row) : valueKey ? row[valueKey] : undefined);
  const covered = coveredWeeks ? new Set(coveredWeeks) : undefined;
  const { points, rows } = buildTimelineRows(weeks, data, { value: read, kind, isDefined, inFlightValue, covered });

  const withData = points.filter(p => p.hasData);
  // The header's latest and change skip unmeasured weeks (Decision 15): an in-flight-only week no
  // report covered would otherwise headline a false shipped 0. The empty state still reads plain
  // hasData, so such a week's in-flight hatch still draws.
  const headline = withData.filter(p => p.measured);
  const latest = headline.length > 0 ? headline[headline.length - 1].value : null;
  const prev = headline.length > 1 ? headline[headline.length - 2].value : null;
  const diff = latest !== null && prev !== null ? latest - prev : 0;
  const fmt = (v: number) => formatValue(v, { suffix, decimals });

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        {latest !== null && (
          <div className="flex items-baseline gap-2">
            <span data-testid="timeline-latest" className="text-sm font-bold text-white">{fmt(latest)}</span>
            {diff !== 0 && (
              <span data-testid="timeline-change" className={`text-xs ${diff > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {diff > 0 ? '+' : '−'}{fmt(Math.abs(diff))}
              </span>
            )}
          </div>
        )}
      </div>
      {withData.length === 0 ? (
        <p className="text-xs text-chart-axis py-8 text-center">No data in the 90 days before this report</p>
      ) : (
        <ChartContainer config={{}} className="aspect-auto h-[140px] w-full">
          <BarChart data={rows} syncId={syncId} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {inFlightValue && hatch.defs}
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={formatWeek} />
            <YAxis tickLine={false} axisLine={false} width={40} tickCount={4} allowDecimals={decimals > 0} tickFormatter={formatCompact} />
            <ChartTooltip content={<TimelineTooltip suffix={suffix} decimals={decimals} split={!!inFlightValue} />} />
            <Bar dataKey="shipped" stackId="timeline" fill="var(--chart-accent)" stroke="var(--chart-surface)" strokeWidth={2}
              shape={shippedShape} isAnimationActive={false} />
            {inFlightValue && (
              <Bar dataKey="inFlight" stackId="timeline" fill={hatch.fill} stroke="var(--chart-surface)" strokeWidth={2}
                radius={[4, 4, 0, 0]} minPointSize={inFlightFloor(rows, 'inFlight')} isAnimationActive={false} />
            )}
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
