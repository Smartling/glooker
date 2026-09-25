'use client';
import { useState } from 'react';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';

// Axis counts and dates are 9px text, so they need 4.5:1 contrast in both theme modes. They reuse
// the "other" series grey, which vuln-series-contrast.test.ts checks against every theme body.
const AXIS_TEXT = { fill: 'var(--vuln-series-other)' };

export default function TrendChart({ series }: { series: TrendSeries[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
  if (dates.length === 0) return <p className="text-xs text-gray-500">No measurements yet for this view.</p>;
  const latest = (s: TrendSeries) => s.points[s.points.length - 1]?.open ?? 0;
  const ranked = [...series].sort((a, b) => latest(b) - latest(a));
  // J2-1: up to 12 teams get a colour by rank (current open count, descending) from a CSS custom
  // property defined in globals.css — one dark palette at :root, overridden for light mode under
  // [data-theme-mode="light"], the app's existing convention (no component reads useTheme() for
  // colours). Rank 12 and beyond share the "other" grey, so an org with many teams still has
  // distinguishable lines for the ones that matter most.
  const color = new Map(ranked.map((s, i) => [s.team, i < 12 ? `var(--vuln-series-${i + 1})` : 'var(--vuln-series-other)']));
  const max = Math.max(1, ...series.flatMap(s => s.points.map(p => p.open)));
  const W = 560, Hh = 170, L = 40, B = 150, T = 15;
  const x = (d: string) => L + (dates.length === 1 ? 0 : (dates.indexOf(d) / (dates.length - 1)) * (W - L - 10));
  const y = (v: number) => B - (v / max) * (B - T);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full">
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={L} x2={W - 10} y1={y(max * f)} y2={y(max * f)} stroke="rgba(128,128,128,.2)" />
            <text x={4} y={y(max * f) + 3} fontSize="9" style={AXIS_TEXT} data-role="axis">{Math.round(max * f)}</text>
          </g>
        ))}
        <text x={L} y={Hh - 2} fontSize="9" style={AXIS_TEXT} data-role="axis">{dates[0]}</text>
        <text x={W - 70} y={Hh - 2} fontSize="9" style={AXIS_TEXT} data-role="axis">{dates[dates.length - 1]}</text>
        {ranked.map(s => (
          <g key={s.team} opacity={hover === null || hover === s.team ? 1 : 0.15}
            onMouseEnter={() => setHover(s.team)} onMouseLeave={() => setHover(null)}>
            {/* J2-1: the colour goes through the `style` prop, not the `stroke=`/`fill=`
                presentation attributes — those don't reliably resolve var(). */}
            <polyline fill="none" style={{ stroke: color.get(s.team) }} strokeWidth={hover === s.team ? 3 : 2}
              points={s.points.map(p => `${x(p.date)},${y(p.open)}`).join(' ')} />
            {s.points.map(p => <circle key={p.date} cx={x(p.date)} cy={y(p.open)} r={2} style={{ fill: color.get(s.team) }}><title>{`${s.team} · ${p.date}: ${p.open}`}</title></circle>)}
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-3 text-[11px] mt-1">
        {ranked.map(s => (
          <span key={s.team} style={{ color: color.get(s.team) }} className="cursor-default"
            onMouseEnter={() => setHover(s.team)} onMouseLeave={() => setHover(null)}>■ {s.team}</span>
        ))}
      </div>
      <p className="text-[10px] text-gray-500 mt-1">Each dot is one measurement (an imported CSV run or a sync). Lines start at the first measurement for this view.</p>
    </div>
  );
}
