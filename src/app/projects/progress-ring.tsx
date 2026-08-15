'use client';

import type { BoardRingMode } from '@/lib/teams/board-config';

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
  /**
   * 'commits' (default) keeps both arcs. 'jira' drops the commit arc and the
   * developer count — GLOOK-38: a research team's commits mostly reference
   * standalone tasks rather than epic children, so both read as zero and the
   * ring looks broken rather than informative.
   */
  mode?: BoardRingMode;
}

export function ProgressRing({ stats, maxVolume, avgCommitsPerJira, mode = 'commits' }: ProgressRingProps) {
  const jiraOnly = mode === 'jira';

  // Match the maxVolume metric (commits + jiras) so jira-only epics size
  // correctly. Floor bumped to 22px so even a zero-volume epic shows a
  // legible ring if it has any progress at all.
  const volume = Math.log(stats.commitCount + stats.totalJiras + 1);
  const sizePct = maxVolume > 0 ? volume / maxVolume : 0;
  const px = Math.max(22, Math.round(sizePct * 48));

  const jiraPct = stats.totalJiras > 0 ? stats.resolvedJiras / stats.totalJiras : 0;
  const expectedCommits = stats.totalJiras * avgCommitsPerJira;
  const commitPct = expectedCommits > 0 ? Math.min(1, stats.commitCount / expectedCommits) : 0;

  // SVG ring math
  const outerR = 20;
  const innerR = 13;
  const outerCirc = 2 * Math.PI * outerR;
  const innerCirc = 2 * Math.PI * innerR;
  const outerOffset = outerCirc * (1 - jiraPct);
  const innerOffset = innerCirc * (1 - commitPct);

  // Stroke width scales inversely with size for readability
  const stroke = Math.max(3, 8 - sizePct * 5);

  const jiraPctDisplay = Math.round(jiraPct * 100);
  const commitPctDisplay = Math.round(commitPct * 100);

  const totalLines = stats.linesAdded + stats.linesRemoved;
  const linesPerDev = stats.devCount > 0 ? totalLines / stats.devCount : 0;
  const isAiSpeed = !jiraOnly && linesPerDev >= 20000;

  const centre = jiraOnly ? stats.totalJiras : stats.devCount;

  return (
    <div className="relative group" style={{ width: px, height: px }}>
      <svg width={px} height={px} viewBox="0 0 48 48" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="24" cy="24" r={outerR} fill="none" stroke="#1f2937" strokeWidth={stroke} />
        <circle cx="24" cy="24" r={outerR} fill="none" stroke="#D97706" strokeWidth={stroke}
          strokeDasharray={outerCirc} strokeDashoffset={outerOffset} strokeLinecap="round" />
        {!jiraOnly && (
          <>
            <circle cx="24" cy="24" r={innerR} fill="none" stroke="#1f2937" strokeWidth={stroke} />
            <circle cx="24" cy="24" r={innerR} fill="none" stroke="#10B981" strokeWidth={stroke}
              strokeDasharray={innerCirc} strokeDashoffset={innerOffset} strokeLinecap="round" />
          </>
        )}
      </svg>
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-bold text-gray-200"
        style={{ fontSize: Math.max(7, Math.round(px * 0.28)) }}>
        {centre}
      </span>
      {isAiSpeed && (
        <span className="absolute -top-1 -left-1 text-[10px] leading-none" title="AI speed">⚡</span>
      )}
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20
        bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-xs text-gray-300 whitespace-nowrap shadow-lg">
        Jira: <span className="text-amber-400 font-semibold">{stats.resolvedJiras}/{stats.totalJiras}</span> closed ({jiraPctDisplay}%)
        {!jiraOnly && (
          <>
            {' · '}Commits: <span className="text-emerald-400 font-semibold">{stats.commitCount}</span> ({commitPctDisplay}% of expected)
            {' · '}<span className="text-gray-200 font-semibold">{stats.devCount}</span> dev{stats.devCount !== 1 ? 's' : ''}
          </>
        )}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700" />
      </div>
    </div>
  );
}
