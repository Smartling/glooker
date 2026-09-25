'use client';

// GLOOK-58: a fixed-size Recharts RadialBarChart. The angle domain is pinned to 0-100: without it
// RadialBar scales to the largest value in its data, so at 40% Jira / 20% commits the 40% ring
// would draw as a full circle. At 0% the ring is its own empty state: both tracks, no arc.
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';
import { toNum } from '@/components/charts/chart-format';

export interface EpicRingStats {
  epicKey: string;
  totalJiras: number;
  resolvedJiras: number;
  remainingJiras: number;
  commitCount: number;
  devCount: number;
  linesAdded: number;
  linesRemoved: number;
  repos: string[];
  cached: boolean;
}

export interface ProgressRingProps {
  stats: EpicRingStats;
  /** Page-wide max of log(commits + jiras + 1), for relative sizing. */
  maxVolume: number;
  /** Page-wide commits-per-jira average, for the inner arc's expected rate. */
  avgCommitsPerJira: number;
}

export interface RingGeometry {
  px: number;
  stroke: number;
  jiraPct: number;
  commitPct: number;
}

export function ringGeometry(stats: EpicRingStats, maxVolume: number, avgCommitsPerJira: number): RingGeometry {
  const commits = toNum(stats.commitCount);
  const total = toNum(stats.totalJiras);
  const resolved = toNum(stats.resolvedJiras);
  const maxV = toNum(maxVolume);
  // Match the maxVolume metric (commits + jiras) so jira-only epics size correctly. Floor of 22px
  // so even a zero-volume epic shows a legible ring.
  const volume = Math.log(commits + total + 1);
  const sizePct = maxV > 0 ? volume / maxV : 0;
  const px = Math.max(22, Math.round(sizePct * 48));
  const jiraPct = total > 0 ? resolved / total : 0;
  const expectedCommits = total * toNum(avgCommitsPerJira);
  const commitPct = expectedCommits > 0 ? Math.min(1, commits / expectedCommits) : 0;
  // Stroke width scales inversely with size for readability.
  const stroke = Math.max(3, 8 - sizePct * 5);
  return { px, stroke, jiraPct, commitPct };
}

export function ProgressRing({ stats, maxVolume, avgCommitsPerJira }: ProgressRingProps) {
  const { px, stroke, jiraPct, commitPct } = ringGeometry(stats, maxVolume, avgCommitsPerJira);
  // The old ring was drawn in a 48-unit viewBox with arcs centred on r=13 (commits) and r=20 (Jira).
  const scale = px / 48;
  // First entry is innermost.
  const data = [
    { ring: 'commits', value: commitPct * 100, fill: 'var(--chart-ring-commits)' },
    { ring: 'jira', value: jiraPct * 100, fill: 'var(--chart-ring-jira)' },
  ];

  const jiraPctDisplay = Math.round(jiraPct * 100);
  const commitPctDisplay = Math.round(commitPct * 100);
  const totalLines = toNum(stats.linesAdded) + toNum(stats.linesRemoved);
  const devCount = toNum(stats.devCount);
  const linesPerDev = devCount > 0 ? totalLines / devCount : 0;
  const isAiSpeed = linesPerDev >= 20000;

  return (
    <div className="relative group" style={{ width: px, height: px }}>
      <RadialBarChart
        width={px}
        height={px}
        data={data}
        innerRadius={(13 - stroke / 2) * scale}
        outerRadius={(20 + stroke / 2) * scale}
        barSize={stroke * scale}
        startAngle={90}
        endAngle={-270}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
        <RadialBar dataKey="value" background={{ fill: 'var(--chart-track)' }} isAnimationActive={false} />
      </RadialBarChart>
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-bold text-gray-200 pointer-events-none"
        style={{ fontSize: Math.max(7, Math.round(px * 0.28)) }}>
        {devCount}
      </span>
      {isAiSpeed && (
        <span className="absolute -top-1 -left-1 text-[10px] leading-none" title="AI speed">⚡</span>
      )}
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20
        bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-xs text-gray-300 whitespace-nowrap shadow-lg">
        <i aria-hidden="true" className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: 'var(--chart-ring-jira)' }} />
        Jira: <span className="text-gray-200 font-semibold">{toNum(stats.resolvedJiras)}/{toNum(stats.totalJiras)}</span> closed ({jiraPctDisplay}%)
        {' · '}
        <i aria-hidden="true" className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: 'var(--chart-ring-commits)' }} />
        Commits: <span className="text-gray-200 font-semibold">{toNum(stats.commitCount)}</span> ({commitPctDisplay}% of expected)
        {' · '}<span className="text-gray-200 font-semibold">{devCount}</span> dev{devCount !== 1 ? 's' : ''}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700" />
      </div>
    </div>
  );
}
