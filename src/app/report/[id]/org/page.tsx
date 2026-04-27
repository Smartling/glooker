'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import ChatPanel from '@/app/chat-panel';
import { useAuth } from '@/app/auth-context';

const TYPE_COLORS: Record<string, string> = {
  feature:   'bg-blue-500',
  bug:       'bg-red-500',
  refactor:  'bg-purple-500',
  infra:     'bg-yellow-500',
  docs:      'bg-gray-500',
  test:      'bg-green-500',
  other:     'bg-gray-600',
  in_flight: 'bg-amber-400',
};

const TYPE_HEX: Record<string, string> = {
  feature:   '#3B82F6',
  bug:       '#EF4444',
  refactor:  '#A855F7',
  infra:     '#EAB308',
  docs:      '#6B7280',
  test:      '#22C55E',
  other:     '#4B5563',
  in_flight: '#FBBF24',
};

interface Developer {
  github_login: string; github_name: string; avatar_url: string;
  total_prs: number; total_commits: number; lines_added: number; lines_removed: number;
  avg_complexity: number; impact_score: number; pr_percentage: number; ai_percentage: number;
  type_breakdown: Record<string, number>; active_repos: string[];
  total_jira_issues?: number;
  cc_total_cost?: number;
  cc_input_tokens?: number;
  cc_output_tokens?: number;
  cc_sessions?: number;
}

interface WeeklyData {
  week: string; commits: number; linesAdded: number; linesRemoved: number;
  linesP95Added?: number; linesP95Removed?: number;
  avgComplexity: number; aiPercent: number; types: Record<string, number>; activeDevs: number;
  inFlightLinesAdded?: number; inFlightLinesRemoved?: number;
}

interface ReportMeta {
  id: string; org: string; period_days: number; status: string;
  created_at: string; completed_at: string | null;
  cc_period_start?: string | null;
  cc_period_end?: string | null;
}

interface SpendWindow {
  periodStart: string;
  periodEnd: string;
  firstCoveredDate: string | null;
  perDev: Record<string, { commits: number; prs: number; lines_added: number; lines_removed: number }>;
}

export default function OrgDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { canAct } = useAuth();
  const [activeTab, setActiveTab] = useState<'impact' | 'spend'>('impact');

  const { data, isLoading: loading, error: fetchError } = useSWR(`/api/report/${params.id}/org`);
  const report: ReportMeta | null = data?.report ?? null;
  const developers: Developer[] = data?.developers ?? [];
  const timeline: WeeklyData[] = data?.timeline ?? [];
  const spendWindow: SpendWindow | null = data?.spendWindow ?? null;
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

  // Type breakdown — sum across all timeline weeks. timeline already has the
  // per-commit in_flight override applied server-side in getOrgReport, so the
  // pie inherits the in_flight slice automatically.
  const orgTypes: Record<string, number> = {};
  for (const week of timeline) {
    for (const [type, count] of Object.entries(week.types || {})) {
      orgTypes[type] = (orgTypes[type] || 0) + (count as number);
    }
  }
  const typeEntries = Object.entries(orgTypes).sort((a, b) => b[1] - a[1]);
  const totalTyped = typeEntries.reduce((s, [, c]) => s + c, 0);

  const hasJira = developers.some(d => (d.total_jira_issues ?? 0) > 0);
  const hasSpend = canAct && developers.some(d => Number(d.cc_total_cost ?? 0) > 0);

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
      {hasSpend && activeTab === 'spend' && <SpendTab developers={developers} reportId={params.id} router={router} report={report} spendWindow={spendWindow} />}

      {/* Impact Tab (default) */}
      {(!hasSpend || activeTab === 'impact') && <>
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
        {/* Type Breakdown — Pie Chart */}
        <div className="bg-gray-900 rounded-xl p-5 flex flex-col" style={{ containerType: 'inline-size' }}>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-4 font-semibold">Commit Types (org-wide)</p>
          {totalTyped > 0 && <div className="flex-1 flex items-center"><PieChart entries={typeEntries} total={totalTyped} /></div>}
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
              <p className="text-2xl font-bold text-amber-400">{unmergedSummary.openPrCount.toLocaleString()}</p>
              <p className="text-xs text-gray-600 mt-1">across {unmergedSummary.openPrDevCount} dev{unmergedSummary.openPrDevCount === 1 ? '' : 's'}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Bare-branch commits</p>
              <p className="text-2xl font-bold text-amber-400">{unmergedSummary.bareBranchCount.toLocaleString()}</p>
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
              valueKey="commits"
              label="Commits / Week"
              color="#3B82F6"
              inFlightValue={d => d.types?.in_flight ?? 0}
            />
            <TimelineChart data={timeline} valueKey="activeDevs" label="Active Developers / Week" color="#10B981" />
            <LinesChangedChart data={timeline} />
            <TimelineChart data={timeline} valueKey="aiPercent" label="AI Assisted %" color="#A855F7" suffix="%" />
          </div>
        </div>
      )}

      {/* Stacked Commit Types Over Time */}
      {timeline.length >= 2 && <StackedTypesChart data={timeline} />}

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

function StackedTypesChart({ data }: { data: WeeklyData[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const filtered = data.filter(d => d.week >= cutoffStr);
  if (filtered.length < 2) return null;

  const allTypes = new Set<string>();
  for (const w of filtered) { for (const t of Object.keys(w.types)) allTypes.add(t); }
  const typeOrder = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in_flight'].filter(t => allTypes.has(t));

  const stacked = filtered.map(w => {
    const total = typeOrder.reduce((s, t) => s + (w.types[t] || 0), 0);
    let cumulative = 0;
    const layers = typeOrder.map(t => {
      const val = w.types[t] || 0;
      const y0 = cumulative;
      cumulative += val;
      return { type: t, val, y0, y1: cumulative };
    });
    return { week: w.week, total, layers };
  });

  const maxTotal = Math.max(...stacked.map(s => s.total), 1);

  const W = 800;
  const H = 180;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const barW = Math.max(4, (chartW / filtered.length) * 0.75);
  const barGap = (chartW / filtered.length) - barW;
  const xFor = (i: number) => padL + i * (barW + barGap) + barGap / 2;
  const yFor = (val: number) => padT + chartH - (val / maxTotal) * chartH;

  const yTicks: number[] = [];
  const step = maxTotal <= 10 ? 2 : maxTotal <= 50 ? 10 : maxTotal <= 200 ? 50 : 100;
  for (let v = 0; v <= maxTotal; v += step) yTicks.push(v);

  const formatWeek = (w: string) => {
    const d = new Date(w + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const labelStep = Math.max(1, Math.floor(filtered.length / 6));
  const labelIndices = filtered.map((_, i) => i).filter(i => i % labelStep === 0 || i === filtered.length - 1);

  return (
    <div className="bg-gray-900 rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500 font-medium">Commit Types Over Time (weekly)</p>
        <div className="flex flex-wrap gap-3">
          {typeOrder.map(t => (
            <span key={t} className="flex items-center gap-1.5 text-[11px] text-white/40">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: TYPE_HEX[t] || '#4B5563' }} />
              {t}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Y grid + labels */}
        {yTicks.map(v => {
          const y = yFor(v);
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#1F2937" strokeWidth="1" />
              <text x={padL - 6} y={y + 3.5} textAnchor="end" className="fill-gray-600" fontSize="9">{v}</text>
            </g>
          );
        })}
        {/* Stacked bars */}
        {stacked.map((s, i) => (
          <g key={i}>
            {s.layers.map(layer => {
              if (layer.val === 0) return null;
              const barH = (layer.val / maxTotal) * chartH;
              const y = yFor(layer.y1);
              return (
                <rect
                  key={layer.type}
                  x={xFor(i)}
                  y={y}
                  width={barW}
                  height={barH}
                  rx={1.5}
                  fill={TYPE_HEX[layer.type] || '#4B5563'}
                  opacity={hoverIdx === i ? 1 : 0.8}
                />
              );
            })}
            {/* Invisible hover target */}
            <rect
              x={xFor(i) - barGap / 2}
              y={padT}
              width={barW + barGap}
              height={chartH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          </g>
        ))}
        {/* Hover tooltip */}
        {hoverIdx !== null && (() => {
          const s = stacked[hoverIdx];
          const x = xFor(hoverIdx) + barW / 2;
          const lines = [`${formatWeek(s.week)} — ${s.total} total`, ...s.layers.filter(l => l.val > 0).map(l => `${l.type}: ${l.val}`)];
          const textW = Math.max(...lines.map(l => l.length)) * 5.5 + 24;
          const tooltipX = Math.min(Math.max(x - textW / 2, 2), W - textW - 2);
          return (
            <g>
              <line x1={x} y1={padT} x2={x} y2={padT + chartH} stroke="white" strokeWidth="1" opacity="0.1" />
              <rect x={tooltipX} y={2} width={textW} height={lines.length * 13 + 8} rx="4" fill="#1F2937" stroke="#374151" strokeWidth="1" />
              {lines.map((line, li) => (
                <text key={li} x={tooltipX + 10} y={15 + li * 13} className={li === 0 ? 'fill-gray-200' : 'fill-gray-400'} fontSize="9.5" fontWeight={li === 0 ? '600' : '400'}>
                  {line}
                </text>
              ))}
            </g>
          );
        })()}
        {/* X labels */}
        {labelIndices.map(idx => (
          <text key={idx} x={xFor(idx) + barW / 2} y={H - 4} textAnchor="middle" className="fill-gray-600" fontSize="9">
            {formatWeek(filtered[idx].week)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function LinesChangedChart({ data }: { data: WeeklyData[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const filtered = data.filter(d => d.week >= cutoffStr);
  if (filtered.length < 2) return null;

  const maxTotal = Math.max(...filtered.map(d => (d.linesP95Added || 0) + (d.linesP95Removed || 0)), 1);

  const W = 800;
  const H = 180;
  const padL = 50;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const barW = Math.max(4, (chartW / filtered.length) * 0.75);
  const barGap = (chartW / filtered.length) - barW;
  const xFor = (i: number) => padL + i * (barW + barGap) + barGap / 2;
  const yFor = (val: number) => padT + chartH - (val / maxTotal) * chartH;

  const yTicks: number[] = [];
  const step = maxTotal <= 1000 ? 200 : maxTotal <= 5000 ? 1000 : maxTotal <= 20000 ? 5000 : maxTotal <= 100000 ? 20000 : 50000;
  for (let v = 0; v <= maxTotal; v += step) yTicks.push(v);

  const formatVal = (v: number) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : String(v);
  const formatWeek = (w: string) => {
    const d = new Date(w + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const labelStep = Math.max(1, Math.floor(filtered.length / 6));
  const labelIndices = filtered.map((_, i) => i).filter(i => i % labelStep === 0 || i === filtered.length - 1);

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <p className="text-xs text-gray-500 font-medium mb-2">Lines Changed / Week <span className="text-gray-600 font-normal">(outlier commits excluded)</span></p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {yTicks.map(v => (
          <g key={v}>
            <line x1={padL} y1={yFor(v)} x2={W - padR} y2={yFor(v)} stroke="#1F2937" strokeWidth="1" />
            <text x={padL - 6} y={yFor(v) + 3.5} textAnchor="end" className="fill-gray-600" fontSize="9">{formatVal(v)}</text>
          </g>
        ))}
        {filtered.map((d, i) => {
          const a = d.linesP95Added || 0;
          const r = d.linesP95Removed || 0;
          const inFlightA = Math.min(d.inFlightLinesAdded || 0, a);
          const inFlightR = Math.min(d.inFlightLinesRemoved || 0, r);
          const shippedA = Math.max(0, a - inFlightA);
          const shippedR = Math.max(0, r - inFlightR);

          const addedH        = a > 0 ? (a / maxTotal) * chartH : 0;
          const removedH      = r > 0 ? (r / maxTotal) * chartH : 0;
          const inFlightAH    = inFlightA > 0 ? (inFlightA / maxTotal) * chartH : 0;
          const inFlightRH    = inFlightR > 0 ? (inFlightR / maxTotal) * chartH : 0;
          const shippedAH     = Math.max(0, addedH - inFlightAH);
          const shippedRH     = Math.max(0, removedH - inFlightRH);

          const addedY        = padT + chartH - addedH - removedH;
          const inFlightAddedY = addedY;                        // amber sits on top
          const shippedAddedY  = addedY + inFlightAH;
          const removedY      = padT + chartH - removedH;
          const inFlightRemovedY = removedY;                    // amber on top of red
          const shippedRemovedY  = removedY + inFlightRH;

          return (
            <g key={i}>
              {/* added: in-flight (amber, top) + shipped (green, bottom of added stack) */}
              {inFlightAH > 0 && (
                <rect x={xFor(i)} y={inFlightAddedY} width={barW} height={inFlightAH} rx={1.5}
                  fill="#FBBF24" opacity={hoverIdx === i ? 1 : 0.85} />
              )}
              <rect x={xFor(i)} y={shippedAddedY} width={barW} height={shippedAH} rx={1.5}
                fill="#10B981" opacity={hoverIdx === i ? 0.8 : 0.55} />
              {/* removed: in-flight (amber muted, top of removed stack) + shipped (red, bottom) */}
              {inFlightRH > 0 && (
                <rect x={xFor(i)} y={inFlightRemovedY} width={barW} height={inFlightRH} rx={1.5}
                  fill="#FBBF24" opacity={hoverIdx === i ? 0.6 : 0.45} />
              )}
              <rect x={xFor(i)} y={shippedRemovedY} width={barW} height={shippedRH} rx={1.5}
                fill="#EF4444" opacity={hoverIdx === i ? 0.6 : 0.35} />
              <rect x={xFor(i) - barGap / 2} y={padT} width={barW + barGap} height={chartH}
                fill="transparent" onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
            </g>
          );
        })}
        {hoverIdx !== null && (() => {
          const d = filtered[hoverIdx];
          const x = xFor(hoverIdx) + barW / 2;
          const a = d.linesP95Added || 0;
          const r = d.linesP95Removed || 0;
          const lines = [`${formatWeek(d.week)}`, `+${formatVal(a)} added`, `-${formatVal(r)} removed`, `${formatVal(a + r)} total`];
          const textW = 110;
          const tooltipX = Math.min(Math.max(x - textW / 2, 2), W - textW - 2);
          return (
            <g>
              <line x1={x} y1={padT} x2={x} y2={padT + chartH} stroke="white" strokeWidth="1" opacity="0.1" />
              <rect x={tooltipX} y={2} width={textW} height={lines.length * 13 + 8} rx="4" fill="#1F2937" stroke="#374151" strokeWidth="1" />
              {lines.map((line, li) => (
                <text key={li} x={tooltipX + 8} y={15 + li * 13} className={li === 0 ? 'fill-gray-200' : 'fill-gray-400'} fontSize="9.5" fontWeight={li === 0 ? '600' : '400'}>
                  {line}
                </text>
              ))}
            </g>
          );
        })()}
        {labelIndices.map(idx => (
          <text key={idx} x={xFor(idx) + barW / 2} y={H - 4} textAnchor="middle" className="fill-gray-600" fontSize="9">
            {formatWeek(filtered[idx].week)}
          </text>
        ))}
      </svg>
      <div className="flex gap-4 mt-2 justify-end">
        <span className="flex items-center gap-1.5 text-[11px] text-white/40">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/60" /> Added
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/40">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500/40" /> Removed
        </span>
      </div>
    </div>
  );
}

function PieChart({ entries, total }: { entries: [string, number][]; total: number }) {
  const [hoverType, setHoverType] = useState<string | null>(null);

  // Use a fixed viewBox, SVG scales to chartSize
  const vb = 200;
  const cx = vb / 2;
  const cy = vb / 2;
  const r = 96;
  const innerR = 58;

  let startAngle = -Math.PI / 2;
  const slices = entries.map(([type, count]) => {
    const pct = count / total;
    const angle = pct * Math.PI * 2;
    const endAngle = startAngle + angle;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const ix1 = cx + innerR * Math.cos(startAngle);
    const iy1 = cy + innerR * Math.sin(startAngle);
    const ix2 = cx + innerR * Math.cos(endAngle);
    const iy2 = cy + innerR * Math.sin(endAngle);

    const largeArc = angle > Math.PI ? 1 : 0;
    const path = [
      `M ${ix1} ${iy1}`, `L ${x1} ${y1}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix2} ${iy2}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1}`, 'Z',
    ].join(' ');

    startAngle = endAngle;
    return { type, count, pct, path };
  });

  const hovered = hoverType ? slices.find(s => s.type === hoverType) : null;

  return (
    <div className="flex items-center justify-center gap-6 h-full">
        <svg
          viewBox={`0 0 ${vb} ${vb}`}
          className="shrink-0 aspect-square"
          style={{ width: 'min(320px, 50cqw)', height: 'auto' }}
        >
          {slices.map(s => (
            <path
              key={s.type}
              d={s.path}
              fill={TYPE_HEX[s.type] || '#4B5563'}
              opacity={hoverType === null || hoverType === s.type ? 1 : 0.3}
              stroke="#111827"
              strokeWidth="1.5"
              onMouseEnter={() => setHoverType(s.type)}
              onMouseLeave={() => setHoverType(null)}
              className="transition-opacity duration-150 cursor-default"
            />
          ))}
          {!hovered ? (
            <>
              <text x={cx} y={cy - 4} textAnchor="middle" className="fill-white" fontSize="22" fontWeight="bold">
                {total.toLocaleString()}
              </text>
              <text x={cx} y={cy + 14} textAnchor="middle" className="fill-gray-500" fontSize="11">
                commits
              </text>
            </>
          ) : (
            <>
              <text x={cx} y={cy - 8} textAnchor="middle" className="fill-white" fontSize="20" fontWeight="bold">
                {hovered.count.toLocaleString()}
              </text>
              <text x={cx} y={cy + 8} textAnchor="middle" style={{ fill: TYPE_HEX[hovered.type] }} fontSize="12" fontWeight="600">
                {hovered.type}
              </text>
              <text x={cx} y={cy + 22} textAnchor="middle" className="fill-gray-500" fontSize="11">
                {Math.round(hovered.pct * 100)}%
              </text>
            </>
          )}
        </svg>
      <div className="flex flex-col justify-center gap-1.5">
        {entries.map(([type, count]) => (
          <div
            key={type}
            className={`flex items-center gap-2 text-sm cursor-default transition-opacity duration-150 ${hoverType !== null && hoverType !== type ? 'opacity-30' : ''}`}
            onMouseEnter={() => setHoverType(type)}
            onMouseLeave={() => setHoverType(null)}
          >
            <span className={`w-3 h-3 rounded-sm shrink-0 ${TYPE_COLORS[type] || 'bg-gray-600'}`} />
            <span className="text-gray-300 font-medium">{type}</span>
            <span className="text-gray-500">{count} ({Math.round((count / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Reusable timeline chart (same as developer detail page)
function TimelineChart({
  data,
  valueKey,
  label,
  color,
  suffix = '',
  decimals = 0,
  computeValue,
  inFlightValue,
}: {
  data: WeeklyData[];
  valueKey: string;
  label: string;
  color: string;
  suffix?: string;
  decimals?: number;
  computeValue?: (d: WeeklyData) => number;
  // Optional: per-week in-flight portion. When provided, each bar is rendered as
  // a stacked pair: shipped (color, bottom) + in-flight (amber, top).
  inFlightValue?: (d: WeeklyData) => number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const filtered = data.filter(d => d.week >= cutoffStr);

  if (filtered.length < 2) return null;

  const values = filtered.map(d => computeValue ? computeValue(d) : (d as any)[valueKey] as number);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const yTicks: number[] = [];
  const step = range <= 5 ? 1 : range <= 20 ? 5 : range <= 100 ? 20 : range <= 500 ? 100 : range <= 2000 ? 500 : Math.ceil(range / 5 / 100) * 100;
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) yTicks.push(v);
  if (yTicks.length === 0) yTicks.push(min, max);
  if (yTicks.length > 6) {
    const keep = [yTicks[0], yTicks[Math.floor(yTicks.length / 2)], yTicks[yTicks.length - 1]];
    yTicks.length = 0;
    yTicks.push(...keep);
  }

  const W = 400, H = 130;
  const padL = 40, padR = 12, padT = 12, padB = 24;
  const chartW = W - padL - padR, chartH = H - padT - padB;

  const barW = Math.max(4, (chartW / values.length) * 0.75);
  const barGap = (chartW / values.length) - barW;
  const xFor = (i: number) => padL + i * (barW + barGap) + barW / 2;

  const labelIndices = [0, Math.floor(filtered.length / 2), filtered.length - 1];
  const formatWeek = (w: string) => {
    const d = new Date(w + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const formatVal = (v: number) => (decimals > 0 ? v.toFixed(decimals) : String(Math.round(v))) + suffix;

  const latest = values[values.length - 1];
  const prev = values.length >= 2 ? values[values.length - 2] : latest;
  const diff = latest - prev;
  const trend = latest > prev ? '+' : latest < prev ? '' : '';

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-white">{formatVal(latest)}</span>
          {diff !== 0 && (
            <span className={`text-xs ${diff > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {trend}{formatVal(Math.abs(diff))}
            </span>
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {yTicks.map(v => {
          const y = padT + chartH - ((v - min) / range) * chartH;
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#1F2937" strokeWidth="1" />
              <text x={padL - 6} y={y + 3.5} textAnchor="end" className="fill-gray-600" fontSize="9">
                {decimals > 0 ? v.toFixed(decimals) : v}{suffix}
              </text>
            </g>
          );
        })}
        {values.map((v, i) => {
          const barH = range > 0 ? ((v - min) / range) * chartH : 0;
          const x = xFor(i);
          const y = padT + chartH - barH;
          const inFlight = inFlightValue ? inFlightValue(filtered[i]) : 0;
          const inFlightH = range > 0 && inFlight > 0 ? (inFlight / range) * chartH : 0;
          const shippedH = Math.max(0, barH - inFlightH);
          return (
            <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}>
              <rect x={x - barGap / 2} y={padT} width={barW + barGap} height={chartH}
                fill="transparent" />
              {/* shipped portion (bottom) */}
              <rect x={x - barW / 2} y={y + inFlightH} width={barW} height={shippedH} rx={Math.min(2, barW / 2)}
                fill={color} opacity={hoverIdx === i ? 1 : 0.7} />
              {/* in-flight portion (top) */}
              {inFlightH > 0 && (
                <rect x={x - barW / 2} y={y} width={barW} height={inFlightH} rx={Math.min(2, barW / 2)}
                  fill="#FBBF24" opacity={hoverIdx === i ? 1 : 0.85} />
              )}
            </g>
          );
        })}
        {hoverIdx !== null && (() => {
          const v = values[hoverIdx];
          const barH = range > 0 ? ((v - min) / range) * chartH : 0;
          const x = xFor(hoverIdx);
          const y = padT + chartH - barH;
          const text = `${formatWeek(filtered[hoverIdx].week)}: ${formatVal(v)}`;
          const textW = text.length * 6 + 16;
          const tooltipX = Math.min(Math.max(x - textW / 2, 2), W - textW - 2);
          const above = y > padT + 30;
          const tooltipY = above ? y - 24 : y + barH + 8;
          return (
            <g>
              <rect x={tooltipX} y={tooltipY} width={textW} height={20} rx="4" fill="#1F2937" stroke="#374151" strokeWidth="1" />
              <text x={tooltipX + textW / 2} y={tooltipY + 14} textAnchor="middle" className="fill-gray-200" fontSize="10" fontWeight="500">{text}</text>
            </g>
          );
        })()}
        {labelIndices.map(idx => (
          <text key={idx} x={xFor(idx)} y={H - 4} textAnchor="middle" className="fill-gray-600" fontSize="10">
            {formatWeek(filtered[idx].week)}
          </text>
        ))}
      </svg>
    </div>
  );
}


// ============================================================================
// Spend Tab
// ============================================================================

function formatDollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function computeSpendMetrics(devs: Developer[]) {
  const withSpend = devs
    .filter(d => Number(d.cc_total_cost ?? 0) > 0)
    .sort((a, b) => Number(b.cc_total_cost ?? 0) - Number(a.cc_total_cost ?? 0));

  const total = withSpend.reduce((s, d) => s + Number(d.cc_total_cost ?? 0), 0);
  const avg = withSpend.length > 0 ? total / withSpend.length : 0;
  const sorted = withSpend.map(d => Number(d.cc_total_cost ?? 0)).sort((a, b) => a - b);
  const median = sorted.length > 0
    ? sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
    : 0;

  const top20Count = Math.max(1, Math.ceil(withSpend.length * 0.2));
  const top20Spend = withSpend.slice(0, top20Count).reduce((s, d) => s + Number(d.cc_total_cost ?? 0), 0);
  const top20Pct = total > 0 ? Math.round((top20Spend / total) * 100) : 0;

  const cpiValues = withSpend
    .filter(d => Number(d.impact_score) > 0)
    .map(d => Number(d.cc_total_cost ?? 0) / Number(d.impact_score));
  const medianCPI = cpiValues.length > 0
    ? [...cpiValues].sort((a, b) => a - b)[Math.floor(cpiValues.length / 2)]
    : 0;

  return { withSpend, total, avg, median, top20Count, top20Spend, top20Pct, medianCPI };
}

function formatDateRange(startIso: string, endIso: string): { label: string; days: number } {
  const s = new Date(startIso + 'T00:00:00');
  const e = new Date(endIso + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  const left = s.toLocaleDateString('en-US', opts);
  const right = e.toLocaleDateString('en-US', { ...opts, ...(sameYear ? {} : { year: 'numeric' }) });
  const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return { label: sameMonth ? `${left} – ${e.getDate()}, ${e.getFullYear()}` : `${left} – ${right}${sameYear ? `, ${e.getFullYear()}` : ''}`, days };
}

function SpendTab({ developers, reportId, router, report, spendWindow }: {
  developers: Developer[];
  reportId: string;
  router: ReturnType<typeof useRouter>;
  report: ReportMeta | null;
  spendWindow: SpendWindow | null;
}) {
  const [showCount, setShowCount] = useState<10 | 20 | 'all'>(10);

  const { withSpend, total, avg, median, top20Count, top20Spend, top20Pct, medianCPI } = computeSpendMetrics(developers);
  const bottom80Pct = 100 - top20Pct;

  const isOutlier = (d: Developer) => {
    const cost = Number(d.cc_total_cost ?? 0);
    const impact = Number(d.impact_score) || 0;
    return cost > 0 && impact > 0 && medianCPI > 0 && (cost / impact) > 2 * medianCPI;
  };

  const displayCount = showCount === 'all' ? withSpend.length : showCount;
  const visibleDevs = withSpend.slice(0, displayCount);
  const hiddenDevs = withSpend.slice(displayCount);
  const hiddenTotal = hiddenDevs.reduce((s, d) => s + Number(d.cc_total_cost ?? 0), 0);

  let cumulative = 0;

  const maxImpact = Math.max(...withSpend.map(d => Number(d.impact_score) || 0), 1);
  const maxCost = Math.max(...withSpend.map(d => Number(d.cc_total_cost ?? 0)), 1);
  const impactSorted = withSpend.map(d => Number(d.impact_score) || 0).sort((a, b) => a - b);
  const medianImpact = impactSorted.length > 0
    ? impactSorted.length % 2 === 0
      ? (impactSorted[impactSorted.length / 2 - 1] + impactSorted[impactSorted.length / 2]) / 2
      : impactSorted[Math.floor(impactSorted.length / 2)]
    : 0;
  const medianCost = median;

  // Window header / coverage
  const windowInfo = spendWindow ? formatDateRange(spendWindow.periodStart, spendWindow.periodEnd) : null;
  const reportPeriodDays = report?.period_days ?? 0;
  const windowDiffers = !!(windowInfo && reportPeriodDays && windowInfo.days !== reportPeriodDays);
  const partialCoverage = !!(spendWindow && spendWindow.firstCoveredDate && spendWindow.firstCoveredDate > spendWindow.periodStart);
  const partialDays = partialCoverage && spendWindow && windowInfo
    ? Math.max(0, Math.round((new Date(spendWindow.periodEnd).getTime() - new Date(spendWindow.firstCoveredDate!).getTime()) / 86400000) + 1)
    : 0;

  return (
    <div className="space-y-6">
      {/* Window header */}
      {windowInfo && (
        <div className="bg-gray-900 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] text-gray-600 uppercase tracking-wider">Spend Period</p>
            <p className="text-base font-bold text-white mt-0.5">{windowInfo.label} <span className="text-gray-500 font-normal">· {windowInfo.days} days</span></p>
          </div>
          <div className="flex flex-col items-end gap-1 text-[11px] text-right">
            {windowDiffers && (
              <span className="text-amber-400">
                Report window is {reportPeriodDays} days — comparisons below use the spend window ({windowInfo.days} days).
              </span>
            )}
            {partialCoverage && spendWindow?.firstCoveredDate && (
              <span className="text-amber-400">
                Partial coverage: commit data available from {spendWindow.firstCoveredDate} ({partialDays} of {windowInfo.days} days).
              </span>
            )}
          </div>
        </div>
      )}

      {/* Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Total Org Spend</p>
          <p className="text-lg font-bold text-green-400 mt-1">{formatDollars(total)}</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Avg / Developer</p>
          <p className="text-lg font-bold text-green-400 mt-1">{formatDollars(avg)}</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Median</p>
          <p className="text-lg font-bold text-green-400 mt-1">{formatDollars(median)}</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Top 20% Share</p>
          <p className="text-lg font-bold text-amber-400 mt-1">{top20Pct}%</p>
        </div>
      </div>

      {/* Pareto Concentration Bar */}
      <div className="bg-gray-900 rounded-xl p-5">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Spend Concentration</p>
        <div className="h-6 bg-gray-800 rounded-full overflow-hidden flex">
          <div className="h-full bg-amber-500 flex items-center justify-center text-xs font-bold text-gray-900 transition-all" style={{ width: `${top20Pct}%` }}>
            {top20Pct > 8 && `Top 20% — ${top20Pct}%`}
          </div>
          <div className="h-full bg-gray-600 flex items-center justify-center text-xs font-medium text-gray-300 transition-all" style={{ width: `${bottom80Pct}%` }}>
            {bottom80Pct > 15 && `Bottom 80% — ${bottom80Pct}%`}
          </div>
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>{top20Count} developer{top20Count !== 1 ? 's' : ''} ({formatDollars(top20Spend)})</span>
          <span>{withSpend.length - top20Count} developer{withSpend.length - top20Count !== 1 ? 's' : ''} ({formatDollars(total - top20Spend)})</span>
        </div>
      </div>

      {/* Top Spenders Table */}
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
            Top Spenders ({withSpend.length})
          </p>
          <div className="flex gap-1">
            {([10, 20, 'all'] as const).map(n => (
              <button
                key={String(n)}
                onClick={() => setShowCount(n)}
                className={`px-2.5 py-1 text-xs rounded ${showCount === n ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {n === 'all' ? 'All' : `Top ${n}`}
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-4 py-3 w-8">#</th>
              <th className="px-4 py-3">Developer</th>
              <th className="px-4 py-3 text-right">Spend</th>
              <th className="px-4 py-3 text-right">% of Total</th>
              <th className="px-4 py-3 text-right">Cumulative %</th>
              <th className="px-4 py-3 text-right">Requests</th>
              <th className="px-4 py-3 text-right">$/Request</th>
              {spendWindow && <th className="px-4 py-3 text-right" title="Commits by this developer within the spend window (deduped across all reports for this org)">Commits (window)</th>}
              {spendWindow && <th className="px-4 py-3 text-right" title="Distinct PRs authored in the spend window">PRs (window)</th>}
              {spendWindow && <th className="px-4 py-3 text-right" title="Total spend divided by commits in the spend window">$/Commit</th>}
              <th className="px-4 py-3 text-right">Impact</th>
            </tr>
          </thead>
          <tbody>
            {visibleDevs.map((dev, i) => {
              const cost = Number(dev.cc_total_cost ?? 0);
              const pctOfTotal = total > 0 ? (cost / total) * 100 : 0;
              cumulative += pctOfTotal;
              const sessions = Number(dev.cc_sessions ?? 0);
              const perSession = sessions > 0 ? cost / sessions : 0;
              const impact = Number(dev.impact_score) || 0;
              const outlier = isOutlier(dev);
              const win = spendWindow?.perDev[dev.github_login];
              const winCommits = win?.commits ?? 0;
              const winPrs = win?.prs ?? 0;
              const perCommit = winCommits > 0 ? cost / winCommits : 0;

              return (
                <tr
                  key={dev.github_login}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                  onClick={() => router.push(`/report/${reportId}/dev/${dev.github_login}`)}
                >
                  <td className="px-4 py-3 text-gray-600 text-xs">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {dev.avatar_url && <img src={dev.avatar_url} alt="" className="w-6 h-6 rounded-full shrink-0" />}
                      <span className="text-white font-medium truncate">@{dev.github_login}</span>
                      {outlier && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/20 text-red-400 rounded">
                          high $/impact
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-green-400">{formatDollars(cost)}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{pctOfTotal.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right text-gray-300">{cumulative.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right text-gray-300">{sessions > 0 ? sessions.toLocaleString() : <span className="text-gray-600">&mdash;</span>}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-300">{sessions > 0 ? formatDollars(perSession) : <span className="text-gray-600">&mdash;</span>}</td>
                  {spendWindow && (
                    <td className="px-4 py-3 text-right text-gray-300">{winCommits > 0 ? winCommits.toLocaleString() : <span className="text-gray-600">&mdash;</span>}</td>
                  )}
                  {spendWindow && (
                    <td className="px-4 py-3 text-right text-gray-300">{winPrs > 0 ? winPrs : <span className="text-gray-600">&mdash;</span>}</td>
                  )}
                  {spendWindow && (
                    <td className="px-4 py-3 text-right font-mono text-gray-300">{winCommits > 0 ? formatDollars(perCommit) : <span className="text-gray-600">&mdash;</span>}</td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold text-white ${impact >= 7 ? 'bg-accent-light' : impact >= 4 ? 'bg-accent-dark' : 'bg-gray-700'}`}>
                      {impact.toFixed(1)}
                    </span>
                  </td>
                </tr>
              );
            })}
            {hiddenDevs.length > 0 && (
              <tr className="border-b border-gray-800/50 bg-gray-800/20">
                <td colSpan={spendWindow ? 11 : 8} className="px-4 py-3 text-center text-xs text-gray-500">
                  +{hiddenDevs.length} more developer{hiddenDevs.length !== 1 ? 's' : ''} ({formatDollars(hiddenTotal)})
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Spend vs Impact Scatter Plot */}
      <div className="bg-gray-900 rounded-xl p-5">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">Spend vs Impact</p>
        <div className="relative w-full" style={{ height: 320 }}>
          <div className="absolute top-2 left-4 text-[10px] text-gray-600">High Spend / Low Impact</div>
          <div className="absolute top-2 right-4 text-[10px] text-gray-600">High Spend / High Impact</div>
          <div className="absolute bottom-8 left-4 text-[10px] text-gray-600">Low Spend / Low Impact</div>
          <div className="absolute bottom-8 right-4 text-[10px] text-gray-600">Low Spend / High Impact</div>

          <div className="absolute bg-gray-700" style={{ left: `${(medianImpact / maxImpact) * 100}%`, top: 0, width: 1, height: '100%', opacity: 0.4 }} />
          <div className="absolute bg-gray-700" style={{ top: `${100 - (medianCost / maxCost) * 100}%`, left: 0, width: '100%', height: 1, opacity: 0.4 }} />

          {withSpend.map(dev => {
            const cost = Number(dev.cc_total_cost ?? 0);
            const impact = Number(dev.impact_score) || 0;
            const x = (impact / maxImpact) * 92 + 4;
            const y = 100 - ((cost / maxCost) * 88 + 6);
            const outlier = isOutlier(dev);
            return (
              <div
                key={dev.github_login}
                className="absolute group cursor-pointer"
                style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
                onClick={() => router.push(`/report/${reportId}/dev/${dev.github_login}`)}
              >
                <div className={`w-3 h-3 rounded-full ${outlier ? 'bg-red-400' : 'bg-blue-400'} opacity-80 hover:opacity-100 transition-opacity`} />
                <div className="hidden group-hover:block absolute z-10 bottom-5 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded px-2 py-1 whitespace-nowrap text-xs">
                  <span className="text-white font-medium">@{dev.github_login}</span>
                  <span className="text-gray-400 ml-2">{formatDollars(cost)}</span>
                  <span className="text-gray-500 ml-1">/ {impact.toFixed(1)} impact</span>
                </div>
              </div>
            );
          })}

          <div className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-gray-500">Impact Score &rarr;</div>
          <div className="absolute top-0 left-0 bottom-0 flex items-center">
            <span className="text-[10px] text-gray-500 -rotate-90 whitespace-nowrap">Spend &rarr;</span>
          </div>
        </div>
      </div>
    </div>
  );
}
