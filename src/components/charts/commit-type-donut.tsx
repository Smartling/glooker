'use client';

// GLOOK-58 Decision 13: the legend always shows count and %, the centre shows the total at rest
// and the hovered type's figures on hover. Centre text is chrome text; type identity comes from a
// swatch beside it, never from coloured text. Callers pass entries built with typeEntriesFrom(),
// so unknown types are already folded into `other`.
import { useState, type ReactElement } from 'react';
import { Pie, PieChart } from 'recharts';
import { ChartContainer } from './chart';
import { toNum } from './chart-format';
import { commitTypeColor } from './commit-types';
import { HatchSwatch, useHatch } from './hatch';

function Swatch({ type, size }: { type: string; size: number }): ReactElement {
  if (type === 'in_flight') return <HatchSwatch colorVar={commitTypeColor(type)} size={size} />;
  return <i aria-hidden="true" className="rounded-sm shrink-0 inline-block" style={{ width: size, height: size, background: commitTypeColor(type) }} />;
}

export function CommitTypeDonut({ entries, total }: { entries: [string, number][]; total: number | string }) {
  const [hover, setHover] = useState<string | null>(null);
  const hatch = useHatch(commitTypeColor('in_flight'));
  const sum = toNum(total);
  if (sum <= 0) return <p className="text-xs text-chart-axis">No categorized commits</p>;

  const pct = (n: number) => Math.round((n / sum) * 100);
  const data = entries.map(([type, count]) => ({
    type,
    count: toNum(count),
    fill: type === 'in_flight' ? hatch.fill : commitTypeColor(type),
    opacity: hover === null || hover === type ? 1 : 0.3,
  }));
  const hovered = hover === null ? undefined : data.find(d => d.type === hover);

  return (
    <div className="flex items-center justify-center gap-6 h-full w-full">
      <div className="relative w-full max-w-[320px] shrink-0">
        <ChartContainer config={{}} className="aspect-square w-full">
          <PieChart>
            {hatch.defs}
            <Pie
              data={data}
              dataKey="count"
              nameKey="type"
              innerRadius="60%"
              outerRadius="96%"
              stroke="var(--chart-surface)"
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={d => setHover(String(d?.payload?.type ?? ''))}
              onMouseLeave={() => setHover(null)}
            />
          </PieChart>
        </ChartContainer>
        <div data-testid="donut-center" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {hovered ? (
            <>
              <span className="text-xl font-bold text-chart-tooltip-text">{hovered.count.toLocaleString('en-US')}</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-chart-axis">
                <Swatch type={hovered.type} size={8} />
                {hovered.type}
              </span>
              <span className="text-xs text-chart-axis">{pct(hovered.count)}%</span>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold text-chart-tooltip-text">{sum.toLocaleString('en-US')}</span>
              <span className="text-xs text-chart-axis">commits</span>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col justify-center gap-1.5">
        {data.map(d => (
          <div
            key={d.type}
            data-testid={`donut-legend-${d.type}`}
            className={`flex items-center gap-2 text-sm cursor-default transition-opacity duration-150 ${hover !== null && hover !== d.type ? 'opacity-30' : ''}`}
            onMouseEnter={() => setHover(d.type)}
            onMouseLeave={() => setHover(null)}
          >
            <Swatch type={d.type} size={12} />
            <span className="text-chart-tooltip-text font-medium">{d.type}</span>
            <span className="text-chart-axis">{d.count.toLocaleString('en-US')} ({pct(d.count)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
