'use client';

// GLOOK-58: Spend vs Impact as a Recharts ScatterChart. The median reference lines share the dots'
// axes, so the quadrant boundaries are drawn in the same scale as the dots (the old <div> plot
// scaled dots by x*92+4 but the lines by x*100, which put the quadrants in the wrong place).
// Outliers differ by shape (triangle) as well as colour, so they never depend on colour alone.
import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS } from './chart';
import { formatCompact, toNum } from './chart-format';

export interface ScatterPoint {
  login: string;
  impact: number;
  /** Cents, as cc_total_cost. */
  cost: number;
  outlier: boolean;
}

const TYPICAL = 'var(--chart-scatter-typical)';
const OUTLIER = 'var(--chart-scatter-outlier)';
const dollars = (cents: number) => `$${(toNum(cents) / 100).toFixed(2)}`;
const axisDollars = (cents: number) => `$${formatCompact(toNum(cents) / 100)}`;

export function SpendImpactTooltip({ active, payload }: Partial<TooltipContentProps<TooltipValueType, string | number>>) {
  const p = payload?.[0]?.payload as ScatterPoint | undefined;
  if (!active || !p) return null;
  return (
    <div className={CHART_TOOLTIP_CLASS}>
      <div className="font-medium">@{p.login}</div>
      <div className="font-mono tabular-nums">{dollars(p.cost)} · {p.impact.toFixed(1)} impact</div>
      {p.outlier && <div>Cost per impact point over 2× the median</div>}
    </div>
  );
}

export function SpendImpactScatter({ points, medianImpact, medianCost, onSelect }: {
  points: ScatterPoint[];
  medianImpact: number;
  medianCost: number;
  onSelect: (login: string) => void;
}) {
  if (points.length === 0) {
    return <p className="text-xs text-chart-axis py-8 text-center">No developer has spend in this period</p>;
  }
  const clean = points.map(p => ({ ...p, impact: toNum(p.impact), cost: toNum(p.cost) }));
  const typical = clean.filter(p => !p.outlier);
  const outliers = clean.filter(p => p.outlier);
  const select = (item: unknown) => {
    const login = (item as { payload?: ScatterPoint } | undefined)?.payload?.login;
    if (login) onSelect(login);
  };

  return (
    <div>
      <div className="relative">
        <ChartContainer config={{}} className="aspect-auto h-[320px] w-full">
          <ScatterChart margin={{ top: 20, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis type="number" dataKey="impact" name="Impact" domain={[0, 'auto']} tickLine={false} axisLine={false} />
            <YAxis type="number" dataKey="cost" name="Spend" domain={[0, 'auto']} tickLine={false} axisLine={false} width={56} tickFormatter={axisDollars} />
            <ReferenceLine x={toNum(medianImpact)} stroke="var(--chart-axis)" strokeDasharray="4 4" />
            <ReferenceLine y={toNum(medianCost)} stroke="var(--chart-axis)" strokeDasharray="4 4" />
            <ChartTooltip cursor={false} content={<SpendImpactTooltip />} />
            <Scatter name="typical" className="scatter-typical cursor-pointer" data={typical} fill={TYPICAL} shape="circle"
              isAnimationActive={false} onClick={select} />
            <Scatter name="outlier" className="scatter-outlier cursor-pointer" data={outliers} fill={OUTLIER} shape="triangle"
              isAnimationActive={false} onClick={select} />
          </ScatterChart>
        </ChartContainer>
        <div className="pointer-events-none absolute top-1 left-16 text-[10px] text-chart-axis">High Spend / Low Impact</div>
        <div className="pointer-events-none absolute top-1 right-4 text-[10px] text-chart-axis">High Spend / High Impact</div>
        <div className="pointer-events-none absolute bottom-8 left-16 text-[10px] text-chart-axis">Low Spend / Low Impact</div>
        <div className="pointer-events-none absolute bottom-8 right-4 text-[10px] text-chart-axis">Low Spend / High Impact</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-2 text-[11px] text-chart-axis">
        <span>Impact score → · Spend ↑ · dashed lines are the medians</span>
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true"><circle cx={5} cy={5} r={4} style={{ fill: TYPICAL }} /></svg>
            <span>Typical</span>
          </span>
          <span className="flex items-center gap-1.5">
            <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 L9 9 L1 9 Z" style={{ fill: OUTLIER }} /></svg>
            <span>Outlier (cost per impact point over 2× the median)</span>
          </span>
        </span>
      </div>
    </div>
  );
}
