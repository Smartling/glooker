'use client';

// GLOOK-58: the one TimelineChart (it used to exist twice, in the org and dev pages, and the
// copies had diverged). Bars are placed by date on the page's shared week domain, so every chart
// in a grid has the same array and hover sync (syncId, matched by index) lines up.
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS } from './chart';
import { fillWeeks, formatCompact, formatValue, formatWeek, type MetricKind } from './chart-format';
import { useHatch } from './hatch';

export interface TimelineRow {
  week: string;
}

export interface TimelinePoint {
  week: string;
  value: number | null;
  shipped: number | null;
  inFlight: number | null;
}

export interface TimelineChartProps<T extends TimelineRow> {
  data: T[];
  /** The page's shared week domain (recentWeekDomain()). */
  weeks: string[];
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

type TimelineTooltipProps = Partial<TooltipContentProps<TooltipValueType, string | number>> & {
  suffix?: string;
  decimals?: number;
  split?: boolean;
};

export function TimelineTooltip({ active, payload, suffix = '', decimals = 0, split = false }: TimelineTooltipProps) {
  const row = payload?.[0]?.payload as TimelinePoint | undefined;
  if (!active || !row || row.value === null) return null;
  const fmt = (v: number) => formatValue(v, { suffix, decimals });
  const inFlight = row.inFlight ?? 0;
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
  data, weeks, valueKey, computeValue, kind, isDefined, label, suffix = '', decimals = 0, inFlightValue, syncId,
}: TimelineChartProps<T>) {
  const hatch = useHatch('var(--accent)');
  const read = (row: T): unknown => (computeValue ? computeValue(row) : valueKey ? row[valueKey] : undefined);
  const points = fillWeeks(weeks, data, { value: read, kind, isDefined });
  const inFlight = inFlightValue ? fillWeeks(weeks, data, { value: inFlightValue, kind: 'count' }) : null;

  const rows: TimelinePoint[] = points.map((p, i) => {
    if (p.value === null) return { week: p.week, value: null, shipped: null, inFlight: null };
    const f = inFlight ? Math.min(Math.max(0, inFlight[i].value ?? 0), p.value) : 0;
    return { week: p.week, value: p.value, shipped: p.value - f, inFlight: f };
  });

  const withData = points.filter(p => p.hasData);
  const latest = withData.length > 0 ? withData[withData.length - 1].value : null;
  const prev = withData.length > 1 ? withData[withData.length - 2].value : null;
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
        <p className="text-xs text-chart-axis py-8 text-center">No data in the last 90 days</p>
      ) : (
        <ChartContainer config={{}} className="aspect-auto h-[140px] w-full">
          <BarChart data={rows} syncId={syncId} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {inFlightValue && hatch.defs}
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={formatWeek} />
            <YAxis tickLine={false} axisLine={false} width={40} tickCount={4} allowDecimals={decimals > 0} tickFormatter={formatCompact} />
            <ChartTooltip content={<TimelineTooltip suffix={suffix} decimals={decimals} split={!!inFlightValue} />} />
            <Bar dataKey="shipped" stackId="timeline" fill="var(--accent)" stroke="var(--chart-surface)" strokeWidth={2}
              shape={shippedShape} isAnimationActive={false} />
            {inFlightValue && (
              <Bar dataKey="inFlight" stackId="timeline" fill={hatch.fill} stroke="var(--chart-surface)" strokeWidth={2}
                radius={[4, 4, 0, 0]} isAnimationActive={false} />
            )}
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
