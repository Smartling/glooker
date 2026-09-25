'use client';

import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS } from './chart';
import { formatCompact, formatWeek, indexByWeek, isTopOfStack } from './chart-format';
import { COMMIT_TYPE_ORDER, commitTypeColor, foldTypes, type CommitType } from './commit-types';
import { HatchSwatch, useHatch } from './hatch';

interface TypesWeek {
  week: string;
  types?: Record<string, unknown>;
}

type StackRow = { week: string; total: number } & Record<CommitType, number>;

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
  const shapeFor = (t: CommitType) => {
    function TypeSegment(props: BarShapeProps) {
      return <Rectangle {...(props as RectangleProps)} radius={isTopOfStack(props.payload, present, t) ? [4, 4, 0, 0] : 0} />;
    }
    return TypeSegment;
  };

  return (
    <div className="bg-gray-900 rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <p className="text-xs text-gray-500 font-medium">Commit Types Over Time (weekly)</p>
        <div className="flex flex-wrap gap-3">
          {present.map(t => (
            <span key={t} className="flex items-center gap-1.5 text-[11px] text-chart-axis">
              {t === 'in_flight'
                ? <HatchSwatch colorVar={commitTypeColor(t)} />
                : <i aria-hidden="true" className="w-2.5 h-2.5 rounded-sm" style={{ background: commitTypeColor(t) }} />}
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
              <Bar key={t} dataKey={t} name={t} stackId="types" fill={fillFor(t)} stroke="var(--chart-surface)" strokeWidth={2}
                shape={shapeFor(t)} isAnimationActive={false} />
            ))}
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
