'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import ChatPanel from '@/app/chat-panel';
import IntegrityBadge from '@/components/IntegrityBadge';
import { useUrlState } from '@/lib/url-state';
import { SpendTab, type Developer, type ReportMeta, type SpendWindow, type ModelUsageRow, type SkillsUsageRow } from './spend-tab';
import { TimelineChart } from '@/components/charts/timeline-chart';
import { hasShippedData, toNum, weekDomainEndingAt } from '@/components/charts/chart-format';
import { StackedTypesChart } from '@/components/charts/stacked-types-chart';
import { LinesChangedChart } from '@/components/charts/lines-changed-chart';
import { CommitTypeDonut } from '@/components/charts/commit-type-donut';
import { typeEntriesFrom } from '@/components/charts/commit-types';

interface WeeklyData {
  week: string; commits: number; prs: number; avgLinesPerPr: number; linesAdded: number; linesRemoved: number;
  linesP95Added?: number; linesP95Removed?: number;
  avgComplexity: number; aiPercent: number; types: Record<string, number>; avgImpact?: number;
  inFlightLinesAdded?: number; inFlightLinesRemoved?: number;
  inFlightLinesP95Added?: number; inFlightLinesP95Removed?: number;
}

export default function OrgDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useUrlState<'impact' | 'spend'>({
    key: 'tab',
    type: 'enum',
    values: ['impact', 'spend'] as const,
    default: 'impact',
    history: 'push',
  });

  const { data, isLoading: loading, error: fetchError } = useSWR(`/api/report/${params.id}/org`);
  const report: ReportMeta | null = data?.report ?? null;
  const developers: Developer[] = data?.developers ?? [];
  const timeline: WeeklyData[] = data?.timeline ?? [];
  const spendWindow: SpendWindow | null = data?.spendWindow ?? null;
  const modelUsage: ModelUsageRow[] = data?.modelUsage ?? [];
  const skillsUsage: SkillsUsageRow[] = data?.skillsUsage ?? [];
  // GLOOK-58 Decision 15: the weeks some completed report measured, and the week this report's
  // charts end at. Both come from the server; the client never re-parses a DB timestamp. A
  // response without coveredWeeks gives [], so unmeasured weeks never claim a zero.
  const coveredWeeks: string[] = data?.coveredWeeks ?? [];
  const anchorWeek: string | undefined = data?.anchorWeek;
  const unmergedSummary: {
    openPrCount: number;
    openPrDevCount: number;
    bareBranchCount: number;
    bareBranchDevCount: number;
    inFlightLinesAdded: number;
    inFlightLinesRemoved: number;
  } | null = data?.unmergedSummary ?? null;

  const { data: config } = useSWR('/api/llm-config', { revalidateIfStale: false });
  const latestReportId = config?.latestReport?.id ?? null;

  if (loading) return <div className="max-w-7xl mx-auto px-4 py-16 text-gray-500">Loading...</div>;
  if (fetchError || !report) return <div className="max-w-7xl mx-auto px-4 py-16 text-red-400">Error: {fetchError?.message || 'Not found'}</div>;

  // Org-level aggregates
  const totalCommits = developers.reduce((s, d) => s + d.total_commits, 0);
  const totalPRs = developers.reduce((s, d) => s + d.total_prs, 0);
  const totalLinesAdded = developers.reduce((s, d) => s + d.lines_added, 0);
  const totalLinesRemoved = developers.reduce((s, d) => s + d.lines_removed, 0);
  const avgComplexity = developers.length > 0
    ? developers.reduce((s, d) => s + Number(d.avg_complexity), 0) / developers.length : 0;
  const avgPrPct = developers.length > 0
    ? Math.round(developers.reduce((s, d) => s + d.pr_percentage, 0) / developers.length) : 0;
  const avgAiPct = developers.length > 0
    ? Math.round(developers.reduce((s, d) => s + d.ai_percentage, 0) / developers.length) : 0;
  const avgImpact = developers.length > 0
    ? developers.reduce((s, d) => s + Number(d.impact_score), 0) / developers.length : 0;

  // Type breakdown — folded across all timeline weeks, so an unrecognized type joins `other`
  // instead of becoming a second, identically coloured wedge. timeline already carries the
  // per-commit in_flight override (applied server-side in getOrgReport).
  const typeEntries = typeEntriesFrom(timeline.map(w => w.types ?? {}));
  const totalTyped = typeEntries.reduce((s, [, c]) => s + c, 0);

  // One week domain per render, ending at this report's own week (Decision 15), shared by every
  // chart below so hover sync (syncId) lines up.
  const weeks = weekDomainEndingAt(anchorWeek);

  const hasJira = developers.some(d => (d.total_jira_issues ?? 0) > 0);
  // Spend tab exists only when there is real spend to show. `!= null` alone is
  // always true (cc_total_cost is NOT NULL DEFAULT 0), so installs with no
  // Anthropic data would otherwise render a $0 Spend tab.
  const hasSpend = developers.some(d => d.cc_total_cost != null && Number(d.cc_total_cost) > 0);

  // Repo breakdown across all developers
  const repoMap = new Map<string, number>();
  for (const d of developers) {
    for (const repo of (d.active_repos || [])) {
      repoMap.set(repo, (repoMap.get(repo) || 0) + 1);
    }
  }
  const repoEntries = [...repoMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const maxRepoDevs = repoEntries.length > 0 ? repoEntries[0][1] : 1;

  const summaryCards = [
    { label: 'Developers', value: developers.length },
    { label: 'Total Commits', value: totalCommits.toLocaleString() },
    { label: 'Total PRs', value: totalPRs.toLocaleString() },
    { label: 'Lines Added', value: `+${totalLinesAdded.toLocaleString()}` },
    { label: 'Lines Removed', value: `-${totalLinesRemoved.toLocaleString()}` },
    { label: 'Avg Complexity', value: avgComplexity.toFixed(1) },
    { label: 'Avg PR %', value: `${avgPrPct}%` },
    { label: 'Avg AI %', value: `${avgAiPct}%` },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Historical report notice */}
      {latestReportId && latestReportId !== params.id && (
        <div className="mb-4 px-4 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2 text-xs text-amber-400">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Viewing historical report from {new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — not the latest report.
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-900 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{report.org}</h1>
            <p className="text-gray-500 mt-1">
              {report.period_days} days &middot; {developers.length} developers &middot; {new Date(report.created_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
            <IntegrityBadge metadata={report.run_metadata ?? null} />
          </div>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors shrink-0 no-print"
          >
            Download PDF
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      {hasSpend && (
        <div className="flex gap-4 border-b border-gray-800 mb-6 no-print">
          <button
            onClick={() => setActiveTab('impact')}
            className={`pb-2 text-sm font-medium transition-colors ${activeTab === 'impact' ? 'text-white border-b-2 border-accent -mb-px' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Impact
          </button>
          <button
            onClick={() => setActiveTab('spend')}
            className={`pb-2 text-sm font-medium transition-colors ${activeTab === 'spend' ? 'text-white border-b-2 border-green-500 -mb-px' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Spend
          </button>
        </div>
      )}

      {/* Spend Tab */}
      {hasSpend && activeTab === 'spend' && report?.run_metadata?.state !== 'failed' && <SpendTab developers={developers} reportId={params.id} router={router} report={report} spendWindow={spendWindow} modelUsage={modelUsage} skillsUsage={skillsUsage} />}

      {/* Impact Tab (default) */}
      {(!hasSpend || activeTab === 'impact') && report?.run_metadata?.state !== 'failed' && <>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        {summaryCards.map(c => (
          <div key={c.label} className="bg-gray-900 rounded-xl p-4 flex flex-col">
            <p className="text-xs text-gray-500 uppercase tracking-wider h-8 flex items-end">{c.label}</p>
            <p className="text-lg font-bold text-white mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Type Breakdown + Active Repos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Type Breakdown — Donut */}
        <div className="bg-gray-900 rounded-xl p-5 flex flex-col">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-4 font-semibold">Commit Types (org-wide)</p>
          <div className="flex-1 flex items-center"><CommitTypeDonut entries={typeEntries} total={totalTyped} /></div>
        </div>

        {/* Active Repos */}
        <div className="bg-gray-900 rounded-xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">Top Repos (by active developers)</p>
          <div className="space-y-1.5">
            {repoEntries.map(([repo, devCount]) => (
              <div key={repo} className="flex items-center gap-3">
                <span className="text-sm text-gray-300 truncate min-w-0 flex-1">{repo}</span>
                <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden shrink-0">
                  <div className="h-full bg-accent-light rounded-full" style={{ width: `${(devCount / maxRepoDevs) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-600 w-8 text-right shrink-0">{devCount}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* In-flight Work KPI cards */}
      {unmergedSummary && (
        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">In-flight Work</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-900 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Open PRs</p>
              <p className="text-2xl font-bold text-cyan-400">{unmergedSummary.openPrCount.toLocaleString()}</p>
              <p className="text-xs text-gray-600 mt-1">across {unmergedSummary.openPrDevCount} dev{unmergedSummary.openPrDevCount === 1 ? '' : 's'}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Bare-branch commits</p>
              <p className="text-2xl font-bold text-cyan-400">{unmergedSummary.bareBranchCount.toLocaleString()}</p>
              <p className="text-xs text-gray-600 mt-1">
                {unmergedSummary.bareBranchCount === 0
                  ? 'no orphaned WIP'
                  : `across ${unmergedSummary.bareBranchDevCount} dev${unmergedSummary.bareBranchDevCount === 1 ? '' : 's'}`}
              </p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">In-flight lines</p>
              <p className="text-2xl font-bold">
                <span className="text-green-400">+{unmergedSummary.inFlightLinesAdded.toLocaleString()}</span>
                <span className="text-gray-500"> / </span>
                <span className="text-red-400">−{unmergedSummary.inFlightLinesRemoved.toLocaleString()}</span>
              </p>
              <p className="text-xs text-gray-600 mt-1">from open PRs</p>
            </div>
          </div>
        </div>
      )}

      {/* Timeline Charts */}
      {timeline.length >= 2 && (
        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Org Activity Over Time (weekly)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TimelineChart
              data={timeline}
              weeks={weeks}
              coveredWeeks={coveredWeeks}
              valueKey="commits"
              kind="count"
              label="Commits / Week"
              inFlightValue={d => d.types?.in_flight ?? 0}
              syncId="org-timeline"
            />
            <TimelineChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} valueKey="prs" kind="count" label="PRs / Week" syncId="org-timeline" />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              coveredWeeks={coveredWeeks}
              valueKey="avgLinesPerPr"
              kind="ratio"
              isDefined={d => toNum(d.prs) > 0}
              label="Avg Lines Changed / PR (outliers excluded)"
              suffix=" lines"
              syncId="org-timeline"
            />
            <TimelineChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} valueKey="avgImpact" kind="ratio" label="Avg Impact Score / Week" decimals={1} syncId="org-timeline" />
            <LinesChangedChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} syncId="org-timeline" />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              coveredWeeks={coveredWeeks}
              valueKey="aiPercent"
              kind="ratio"
              isDefined={hasShippedData}
              label="AI Assisted %"
              suffix="%"
              syncId="org-timeline"
            />
          </div>
        </div>
      )}

      {/* Stacked Commit Types Over Time */}
      {timeline.length >= 2 && <StackedTypesChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} />}

      {/* Top Developers Table — hidden, use Team Summary instead */}
      {false && <div className="bg-gray-900 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
            Developers ({developers.length})
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-4 py-3">Developer</th>
              <th className="px-4 py-3 text-right">PRs</th>
              <th className="px-4 py-3 text-right">Commits</th>
              <th className="px-4 py-3 text-right">Lines +/-</th>
              <th className="px-4 py-3 text-right">Complexity</th>
              <th className="px-4 py-3 text-right">PR%</th>
              <th className="px-4 py-3 text-right">AI%</th>
              {hasJira && <th className="px-4 py-3 text-right">Jira</th>}
              <th className="px-4 py-3 text-right" title="Impact = Commits (2.0) + PRs (2.7) + Complexity (3.5) + PR% (1.1) + Jira (0.5) + Reviews (0.5). Max: 9.3">Impact ⓘ</th>
            </tr>
          </thead>
          <tbody>
            {developers.map((dev, i) => {
              const complexity = Number(dev.avg_complexity) || 0;
              const complexColor = complexity >= 7 ? 'text-red-400' : complexity >= 4 ? 'text-yellow-400' : 'text-green-400';
              const impact = Number(dev.impact_score) || 0;
              const impactColor = impact >= 7 ? 'bg-accent-light' : impact >= 4 ? 'bg-accent-dark' : 'bg-gray-700';
              const prColor = dev.pr_percentage >= 80 ? 'text-green-400' : dev.pr_percentage >= 50 ? 'text-yellow-400' : 'text-red-400';

              return (
                <tr
                  key={dev.github_login}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                  onClick={() => router.push(`/report/${params.id}/dev/${dev.github_login}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-gray-600 text-xs w-5 shrink-0 text-right">{i + 1}</span>
                      {dev.avatar_url && (
                        <img src={dev.avatar_url} alt="" className="w-7 h-7 rounded-full shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{dev.github_name || dev.github_login}</div>
                        <div className="text-xs text-gray-500 truncate">@{dev.github_login}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">{dev.total_prs}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{dev.total_commits}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-green-400">+{dev.lines_added.toLocaleString()}</span>
                    <span className="text-gray-600"> / </span>
                    <span className="text-red-400">-{dev.lines_removed.toLocaleString()}</span>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-medium ${complexColor}`}>
                    {complexity.toFixed(1)}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-medium text-sm ${prColor}`}>
                    {dev.pr_percentage}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    {dev.ai_percentage > 0 ? (
                      <span className="font-mono font-medium text-sm text-purple-400">{dev.ai_percentage}%</span>
                    ) : (
                      <span className="text-gray-600 text-sm">—</span>
                    )}
                  </td>
                  {hasJira && (
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      {(dev.total_jira_issues ?? 0) > 0 ? (
                        <JiraIssuesPopover reportId={params.id} login={dev.github_login} count={dev.total_jira_issues!} />
                      ) : (
                        <span className="text-gray-600 text-sm">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold text-white ${impactColor}`}>
                      {impact.toFixed(1)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
      </>}
      {report?.org && <ChatPanel org={report.org} />}
    </div>
  );
}

function JiraIssuesPopover({ reportId, login, count }: { reportId: string; login: string; count: number }) {
  const [issues, setIssues] = useState<any[] | null>(null);
  const [show, setShow] = useState(false);

  const loadIssues = () => {
    if (issues) return;
    fetch(`/api/report/${reportId}/jira-issues?login=${login}`)
      .then(r => r.json())
      .then(setIssues)
      .catch(() => {});
  };

  return (
    <div className="relative inline-block" onMouseEnter={() => { setShow(true); loadIssues(); }} onMouseLeave={() => setShow(false)}>
      <span className="text-accent cursor-pointer">{count}</span>
      {show && issues && (
        <div className="absolute z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 w-80 max-h-60 overflow-y-auto -left-20 top-6">
          {issues.map((issue: any) => (
            <a
              key={issue.issue_key}
              href={issue.issue_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block py-1.5 px-2 hover:bg-gray-800 rounded text-sm"
            >
              <span className="text-accent font-mono">{issue.issue_key}</span>
              <span className="text-gray-400 ml-2">{issue.summary?.slice(0, 60)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
