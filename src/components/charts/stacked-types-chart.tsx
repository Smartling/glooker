'use client';

import { type ReactElement } from 'react';
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS, NotMeasuredTooltip } from './chart';
import { formatCompact, formatWeek, indexByWeek, isMeasured, isTopOfStack } from './chart-format';
import { COMMIT_TYPE_ORDER, commitTypeColor, foldTypes, type CommitType } from './commit-types';
import { inFlightFloor, TypeSwatch, useHatch } from './hatch';

interface TypesWeek {
  week: string;
  types?: Record<string, unknown>;
}

type StackRow = { week: string; total: number; measured: boolean } & Record<CommitType, number>;

// Built once at module load, not per render (GLOOK-58 review, fix round 1): a fresh shape
// component per type per render remounts the Rectangle each time. COMMIT_TYPE_ORDER (the full
// fixed order, not the per-render `present` list) is safe here — a type excluded from `present`
// is zero in every row, so it always reads as zero in isTopOfStack regardless of which list is
// passed, and it never has its own Bar to apply this shape to anyway.
const typeShapes = Object.fromEntries(
  COMMIT_TYPE_ORDER.map(t => [
    t,
    (props: BarShapeProps): ReactElement => (
      <Rectangle {...(props as RectangleProps)} radius={isTopOfStack(props.payload, COMMIT_TYPE_ORDER, t) ? [4, 4, 0, 0] : 0} />
    ),
  ]),
) as Record<CommitType, (props: BarShapeProps) => ReactElement>;

/**
 * One row per domain week: the week's types folded into COMMIT_TYPE_ORDER, their total, and
 * whether the week was measured (Decision 15; `covered` never changes a value). Exported so tests
 * can drive real rows into StackedTypesTooltip, as buildLinesRows does.
 */
export function buildStackRows(data: TypesWeek[], weeks: string[], covered?: ReadonlySet<string>): StackRow[] {
  const byWeek = indexByWeek(data);
  return weeks.map(week => {
    const row = byWeek.get(week);
    const folded = foldTypes([row?.types ?? {}]);
    const total = COMMIT_TYPE_ORDER.reduce((s, t) => s + folded[t], 0);
    return { week, total, measured: isMeasured(week, !!row, covered), ...folded };
  });
}

export function StackedTypesTooltip({ active, payload }: Partial<TooltipContentProps<TooltipValueType, string | number>>) {
  const row = payload?.[0]?.payload as StackRow | undefined;
  if (!active || !row) return null;
  if (row.measured === false) return <NotMeasuredTooltip week={row.week} />;
  return (
    <div className={CHART_TOOLTIP_CLASS}>
      <div className="font-medium">{formatWeek(row.week)} · {row.total} total</div>
      {COMMIT_TYPE_ORDER.filter(t => row[t] > 0).map(t => (
        <div key={t} className="flex justify-between gap-4">
          <span>{t}</span>
          <span className="font-mono tabular-nums">{row[t]}</span>
        </div>
      ))}
    </div>
  );
}

export function StackedTypesChart({ data, weeks, coveredWeeks }: { data: TypesWeek[]; weeks: string[]; coveredWeeks?: string[] }) {
  const hatch = useHatch(commitTypeColor('in_flight'));
  const rows = buildStackRows(data, weeks, coveredWeeks ? new Set(coveredWeeks) : undefined);
  const present = COMMIT_TYPE_ORDER.filter(t => rows.some(r => r[t] > 0));
  const fillFor = (t: CommitType) => (t === 'in_flight' ? hatch.fill : commitTypeColor(t));

  return (
    <div className="bg-gray-900 rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <p className="text-xs text-gray-500 font-medium">Commit Types Over Time (weekly)</p>
        <div className="flex flex-wrap gap-3">
          {present.map(t => (
            <span key={t} className="flex items-center gap-1.5 text-[11px] text-chart-axis">
              <TypeSwatch colorVar={commitTypeColor(t)} hatched={t === 'in_flight'} />
              {t}
            </span>
          ))}
        </div>
      </div>
      {present.length === 0 ? (
        <p className="text-xs text-chart-axis py-8 text-center">No commits in the 90 days before this report</p>
      ) : (
        <ChartContainer config={{}} className="aspect-auto h-[200px] w-full">
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {hatch.defs}
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={formatWeek} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} tickFormatter={formatCompact} />
            <ChartTooltip content={<StackedTypesTooltip />} />
            {present.map(t => (
              <Bar key={t} dataKey={t} name={t} stackId="types" fill={fillFor(t)} stroke="var(--chart-surface)" strokeWidth={2}
                shape={typeShapes[t]} minPointSize={t === 'in_flight' ? inFlightFloor(rows, t) : undefined}
                isAnimationActive={false} />
            ))}
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
