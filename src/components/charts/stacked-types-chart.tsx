'use client';

import { type ReactElement } from 'react';
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS } from './chart';
import { formatCompact, formatWeek, indexByWeek, isTopOfStack, toNum } from './chart-format';
import { COMMIT_TYPE_ORDER, commitTypeColor, foldTypes, type CommitType } from './commit-types';
import { TypeSwatch, useHatch } from './hatch';

interface TypesWeek {
  week: string;
  types?: Record<string, unknown>;
}

type StackRow = { week: string; total: number } & Record<CommitType, number>;

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

export function StackedTypesTooltip({ active, payload }: Partial<TooltipContentProps<TooltipValueType, string | number>>) {
  const row = payload?.[0]?.payload as StackRow | undefined;
  if (!active || !row) return null;
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

export function StackedTypesChart({ data, weeks }: { data: TypesWeek[]; weeks: string[] }) {
  const hatch = useHatch(commitTypeColor('in_flight'));
  const byWeek = indexByWeek(data);
  const rows: StackRow[] = weeks.map(week => {
    const folded = foldTypes([byWeek.get(week)?.types ?? {}]);
    const total = COMMIT_TYPE_ORDER.reduce((s, t) => s + folded[t], 0);
    return { week, total, ...folded };
  });
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
        <p className="text-xs text-chart-axis py-8 text-center">No commits in the last 90 days</p>
      ) : (
        <ChartContainer config={{}} className="aspect-auto h-[200px] w-full">
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {hatch.defs}
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={formatWeek} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} tickFormatter={formatCompact} />
            <ChartTooltip content={<StackedTypesTooltip />} />
            {present.map(t => (
              // minPointSize's `value` argument is this layer's cumulative stack top, not t's own
              // delta, so it can't tell a zero in_flight week from a non-zero one once another type
              // is stacked underneath. Read the row's own value for t by index instead.
              <Bar key={t} dataKey={t} name={t} stackId="types" fill={fillFor(t)} stroke="var(--chart-surface)" strokeWidth={2}
                shape={typeShapes[t]} minPointSize={t === 'in_flight' ? ((_, i) => (toNum(rows[i]?.[t]) !== 0 ? 4 : 0)) : undefined}
                isAnimationActive={false} />
            ))}
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
