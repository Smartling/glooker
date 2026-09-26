'use client';

// GLOOK-58 Decision 12: a diverging chart. Added lines stack above zero, removed lines are negated
// and stack below, in ONE stackOffset="sign" stack. Two stackIds would place them side by side
// instead. Shipped linesP95* and in-flight inFlightLinesP95* are separate additive layers, as today.
import { Bar, BarChart, CartesianGrid, Rectangle, ReferenceLine, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS, NotMeasuredTooltip } from './chart';
import { formatCompact, formatValue, formatWeek, indexByWeek, isMeasured, toNum } from './chart-format';
import { commitTypeColor } from './commit-types';
import { inFlightFloor, TypeSwatch, useHatch } from './hatch';

export interface LinesWeek {
  week: string;
  linesP95Added?: unknown;
  linesP95Removed?: unknown;
  inFlightLinesP95Added?: unknown;
  inFlightLinesP95Removed?: unknown;
}

interface LinesRow {
  week: string;
  added: number;
  inFlightAdded: number;
  removed: number;
  inFlightRemoved: number;
  /** Decision 15: false when the week has no data and no report measured it. */
  measured: boolean;
}

const ADDED = 'var(--chart-lines-added)';
const REMOVED = 'var(--chart-lines-removed)';
const TOP: [number, number, number, number] = [4, 4, 0, 0];
const BOTTOM: [number, number, number, number] = [0, 0, 4, 4];

export function LinesTooltip({ active, payload }: Partial<TooltipContentProps<TooltipValueType, string | number>>) {
  const row = payload?.[0]?.payload as LinesRow | undefined;
  if (!active || !row) return null;
  if (row.measured === false) return <NotMeasuredTooltip week={row.week} />;
  const fmt = (v: number) => formatValue(v);
  // Churn, not net change: "Lines Changed / Week" is added + removed as magnitudes.
  // removed/inFlightRemoved are negated for the diverging stack, so abs() them back.
  const total = row.added + row.inFlightAdded + Math.abs(row.removed) + Math.abs(row.inFlightRemoved);
  return (
    <div className={CHART_TOOLTIP_CLASS}>
      <div className="font-medium">{formatWeek(row.week)}</div>
      <div className="font-mono tabular-nums">+{fmt(row.added)} added</div>
      {row.inFlightAdded > 0 && <div className="font-mono tabular-nums">+{fmt(row.inFlightAdded)} added in flight</div>}
      <div className="font-mono tabular-nums">−{fmt(-row.removed)} removed</div>
      {row.inFlightRemoved < 0 && <div className="font-mono tabular-nums">−{fmt(-row.inFlightRemoved)} removed in flight</div>}
      <div className="font-mono tabular-nums">{fmt(total)} total</div>
    </div>
  );
}

function addedShape(props: BarShapeProps) {
  const row = props.payload as LinesRow;
  return <Rectangle {...(props as RectangleProps)} radius={row.inFlightAdded > 0 ? 0 : TOP} />;
}
function removedShape(props: BarShapeProps) {
  const row = props.payload as LinesRow;
  return <Rectangle {...(props as RectangleProps)} radius={row.inFlightRemoved < 0 ? 0 : BOTTOM} />;
}

/**
 * Builds the diverging rows from real week data: added/removed magnitudes go through toNum(),
 * then removed and inFlightRemoved are negated for the stackOffset="sign" stack. Exported so
 * tests can exercise this real sign-flip pipeline directly, instead of hand-building a row whose
 * signs the test author has to get right on their own (GLOOK-58 review, fix round 1: a hand-built
 * row is exactly how the tooltip's total-formula bug slipped through the first time).
 * `covered` (Decision 15) sets each row's `measured` and never changes a value.
 */
export function buildLinesRows(data: LinesWeek[], weeks: string[], covered?: ReadonlySet<string>): LinesRow[] {
  const byWeek = indexByWeek(data);
  return weeks.map(week => {
    const r = byWeek.get(week);
    return {
      week,
      added: toNum(r?.linesP95Added),
      inFlightAdded: toNum(r?.inFlightLinesP95Added),
      removed: -toNum(r?.linesP95Removed),
      inFlightRemoved: -toNum(r?.inFlightLinesP95Removed),
      measured: isMeasured(week, !!r, covered),
    };
  });
}

export function LinesChangedChart({ data, weeks, coveredWeeks, syncId }: { data: LinesWeek[]; weeks: string[]; coveredWeeks?: string[]; syncId?: string }) {
  const hatch = useHatch(commitTypeColor('in_flight'));
  const rows = buildLinesRows(data, weeks, coveredWeeks ? new Set(coveredWeeks) : undefined);
  const hasAny = rows.some(r => r.added || r.inFlightAdded || r.removed || r.inFlightRemoved);
  const hasInFlight = rows.some(r => r.inFlightAdded > 0 || r.inFlightRemoved < 0);

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <p className="text-xs text-gray-500 font-medium mb-2">
        Lines Changed / Week <span className="text-gray-600 font-normal">(outlier commits excluded)</span>
      </p>
      {!hasAny ? (
        <p className="text-xs text-chart-axis py-8 text-center">No line changes in the 90 days before this report</p>
      ) : (
        <ChartContainer config={{}} className="aspect-auto h-[160px] w-full">
          <BarChart data={rows} stackOffset="sign" syncId={syncId} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {hatch.defs}
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={formatWeek} />
            <YAxis tickLine={false} axisLine={false} width={44} tickCount={5} tickFormatter={formatCompact} />
            <ChartTooltip content={<LinesTooltip />} />
            <ReferenceLine y={0} stroke="var(--chart-axis)" strokeWidth={1} ifOverflow="extendDomain" />
            <Bar dataKey="added" stackId="lines" fill={ADDED} stroke="var(--chart-surface)" strokeWidth={2} shape={addedShape} isAnimationActive={false} />
            <Bar dataKey="inFlightAdded" stackId="lines" fill={hatch.fill} stroke="var(--chart-surface)" strokeWidth={2} radius={TOP} minPointSize={inFlightFloor(rows, 'inFlightAdded')} isAnimationActive={false} />
            <Bar dataKey="removed" stackId="lines" fill={REMOVED} stroke="var(--chart-surface)" strokeWidth={2} shape={removedShape} isAnimationActive={false} />
            <Bar dataKey="inFlightRemoved" stackId="lines" fill={hatch.fill} stroke="var(--chart-surface)" strokeWidth={2} radius={BOTTOM} minPointSize={inFlightFloor(rows, 'inFlightRemoved')} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      )}
      <div className="flex gap-4 mt-2 justify-end">
        <span className="flex items-center gap-1.5 text-[11px] text-chart-axis">
          <TypeSwatch colorVar={ADDED} /> Added
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-chart-axis">
          <TypeSwatch colorVar={REMOVED} /> Removed
        </span>
        {hasInFlight && (
          <span className="flex items-center gap-1.5 text-[11px] text-chart-axis">
            <TypeSwatch colorVar={commitTypeColor('in_flight')} hatched /> In flight
          </span>
        )}
      </div>
    </div>
  );
}
