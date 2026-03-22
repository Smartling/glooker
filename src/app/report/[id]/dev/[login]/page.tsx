'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

const TYPE_COLORS: Record<string, string> = {
  feature: 'bg-blue-500', bug: 'bg-red-500', refactor: 'bg-purple-500',
  infra: 'bg-yellow-500', docs: 'bg-gray-500', test: 'bg-green-500', other: 'bg-gray-600',
};

const TYPE_TEXT_COLORS: Record<string, string> = {
  feature: 'text-blue-400', bug: 'text-red-400', refactor: 'text-purple-400',
  infra: 'text-yellow-400', docs: 'text-gray-400', test: 'text-green-400', other: 'text-gray-500',
};

interface DevStats {
  github_login: string; github_name: string; avatar_url: string;
  total_prs: number; total_commits: number; lines_added: number; lines_removed: number;
  avg_complexity: number; impact_score: number; pr_percentage: number; ai_percentage: number;
  type_breakdown: Record<string, number>; active_repos: string[];
  total_jira_issues: number;
}

interface JiraIssue {
  issue_key: string; project_key: string; issue_type: string; summary: string;
  description: string | null; status: string; labels: string[];
  story_points: number | null; issue_url: string;
  created_at: string; resolved_at: string | null;
}

interface CompactDev {
  github_login: string; total_prs: number; total_commits: number;
  lines_added: number; lines_removed: number;
  avg_complexity: number; impact_score: number; pr_percentage: number; ai_percentage: number;
  total_jira_issues: number;
}

interface Commit {
  commit_sha: string; repo: string; commit_message: string;
  pr_number: number | null; pr_title: string | null;
  type: string; complexity: number; risk_level: string; impact_summary: string;
  lines_added: number; lines_removed: number; committed_at: string;
  ai_co_authored: number; ai_tool_name: string | null; maybe_ai: number;
}

interface ReportMeta {
  id: string; org: string; period_days: number; status: string;
  created_at: string; completed_at: string | null;
}

interface WeeklyData {
  week: string;
  commits: number;
  linesAdded: number;
  linesRemoved: number;
  avgComplexity: number;
  aiPercent: number;
  types: Record<string, number>;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const frac = idx - lower;
  if (lower + 1 < sorted.length) return sorted[lower] + frac * (sorted[lower + 1] - sorted[lower]);
  return sorted[lower];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function pctRank(values: number[], value: number): number {
  const below = values.filter(v => v < value).length;
  return Math.round((below / Math.max(values.length - 1, 1)) * 100);
}

export default function DevDetailPage() {
  const params = useParams<{ id: string; login: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportMeta | null>(null);
  const [dev, setDev] = useState<DevStats | null>(null);
  const [allDevs, setAllDevs] = useState<CompactDev[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<WeeklyData[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [badges, setBadges] = useState<Array<{ icon: string; title: string; description: string }>>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);

  useEffect(() => {
    fetch(`/api/report/${params.id}/dev/${params.login}`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then(data => {
        setReport(data.report);
        setDev(data.developer);
        setAllDevs(data.allDevelopers);
        setCommits(data.commits);
        setTimeline(data.timeline || []);
        // Fetch summary (generates via LLM if not cached)
        setSummaryLoading(true);
        setSummaryError(null);
        fetch(`/api/report/${params.id}/dev/${params.login}/summary`)
          .then(async r => {
            const text = await r.text();
            let json: any;
            try { json = JSON.parse(text); } catch { throw new Error('Invalid response from server'); }
            if (!r.ok) throw new Error(json.error || 'Failed to generate summary');
            return json;
          })
          .then(s => { setSummary(s.summary); setBadges(s.badges || []); })
          .catch(e => setSummaryError(e.message))
          .finally(() => setSummaryLoading(false));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id, params.login]);

  useEffect(() => {
    if ((dev?.total_jira_issues ?? 0) > 0) {
      fetch(`/api/report/${params.id}/jira-issues?login=${params.login}`)
        .then(r => r.json())
        .then(setJiraIssues)
        .catch(() => {});
    }
  }, [params.id, params.login, dev?.total_jira_issues]);

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-16 text-gray-500">Loading...</div>;
  if (error || !dev || !report) return <div className="max-w-6xl mx-auto px-4 py-16 text-red-400">Error: {error || 'Not found'}</div>;

  const rank = allDevs.findIndex(d => d.github_login === dev.github_login) + 1;

  // Percentile data
  const hasJiraData = allDevs.some(d => (d.total_jira_issues ?? 0) > 0);
  const metrics = [
    { label: 'Commits', value: dev.total_commits, values: allDevs.map(d => d.total_commits), higherIsBetter: true },
    { label: 'PRs', value: dev.total_prs, values: allDevs.map(d => d.total_prs), higherIsBetter: true },
    { label: 'Lines Changed', value: dev.lines_added + dev.lines_removed, values: allDevs.map(d => d.lines_added + d.lines_removed), higherIsBetter: true },
    { label: 'Complexity', value: Number(dev.avg_complexity), values: allDevs.map(d => Number(d.avg_complexity)), higherIsBetter: true },
    { label: 'PR %', value: dev.pr_percentage, values: allDevs.map(d => d.pr_percentage), higherIsBetter: true },
    ...(hasJiraData ? [{ label: 'Jira Issues', value: dev.total_jira_issues, values: allDevs.map(d => d.total_jira_issues ?? 0), higherIsBetter: true }] : []),
    { label: 'Impact', value: Number(dev.impact_score), values: allDevs.map(d => Number(d.impact_score)), higherIsBetter: true },
  ];

  // Type breakdown for stacked bar
  const typeEntries = Object.entries(dev.type_breakdown || {}).sort((a, b) => b[1] - a[1]);
  const totalTyped = typeEntries.reduce((s, [, c]) => s + c, 0);

  // Repo commit counts
  const repoMap = new Map<string, number>();
  for (const c of commits) {
    repoMap.set(c.repo, (repoMap.get(c.repo) || 0) + 1);
  }
  const repoEntries = [...repoMap.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Back link */}
      <div className="flex items-center justify-between mb-6 no-print">
        <button
          onClick={() => router.back()}
          className="text-sm text-gray-500 hover:text-gray-300 flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to report
        </button>
        <span className="text-xl font-bold text-white cursor-pointer hover:text-accent-light transition-colors" onClick={() => router.push('/')}>Glooker</span>
      </div>

      {/* Header */}
      <div className="bg-gray-900 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between">
        <div className="flex items-center gap-5">
          {dev.avatar_url && (
            <img src={dev.avatar_url} alt="" className="w-16 h-16 rounded-full shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white truncate">{dev.github_name || dev.github_login}</h1>
              <span className="px-2.5 py-0.5 bg-accent text-white text-xs font-bold rounded-full shrink-0">
                #{rank}
              </span>
            </div>
            <p className="text-gray-500 mt-0.5">@{dev.github_login}</p>
            <p className="text-gray-600 text-sm mt-1">
              {report.org} &middot; {report.period_days} days &middot; {new Date(report.created_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors shrink-0 no-print"
          >
            Download PDF
          </button>
        </div>
      </div>

      {/* Percentile Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {metrics.map(m => {
          const p50 = percentile(m.values, 50);
          const p95 = percentile(m.values, 95);
          const mean = avg(m.values);
          const max = Math.max(...m.values, 1);
          const rank = pctRank(m.values, m.value);
          const color = rank >= 75 ? 'text-green-400' : rank >= 40 ? 'text-yellow-400' : 'text-red-400';

          return (
            <div key={m.label} className="bg-gray-900 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{m.label}</p>
              <p className={`text-xl font-bold ${color}`}>
                {m.label === 'Complexity' || m.label === 'Impact'
                  ? Number(m.value).toFixed(1)
                  : m.label === 'PR %'
                  ? `${m.value}%`
                  : m.value.toLocaleString()
                }
              </p>
              <p className="text-xs text-gray-600 mt-0.5">p{rank} of {allDevs.length}</p>
              {/* Bar visualization */}
              <div className="mt-2 h-2 bg-gray-800 rounded-full relative overflow-hidden">
                {/* p50 marker */}
                <div className="absolute top-0 h-full w-px bg-gray-600" style={{ left: `${(p50 / max) * 100}%` }} />
                {/* p95 marker */}
                <div className="absolute top-0 h-full w-px bg-gray-600" style={{ left: `${(p95 / max) * 100}%` }} />
                {/* This dev's position */}
                <div
                  className={`h-full rounded-full ${rank >= 75 ? 'bg-green-500' : rank >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min((m.value / max) * 100, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                <span>avg {m.label === 'Complexity' || m.label === 'Impact' ? mean.toFixed(1) : m.label === 'PR %' ? `${Math.round(mean)}%` : Math.round(mean)}</span>
                <span>p95 {m.label === 'Complexity' || m.label === 'Impact' ? p95.toFixed(1) : m.label === 'PR %' ? `${Math.round(p95)}%` : Math.round(p95)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Type Breakdown + Active Repos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Type Breakdown */}
        <div className="bg-gray-900 rounded-xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">Commit Types</p>
          {totalTyped > 0 && (
            <div className="h-4 rounded-full overflow-hidden flex mb-3">
              {typeEntries.map(([type, count]) => (
                <div
                  key={type}
                  className={`${TYPE_COLORS[type] || 'bg-gray-600'} h-full`}
                  style={{ width: `${(count / totalTyped) * 100}%` }}
                  title={`${type}: ${count}`}
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {typeEntries.map(([type, count]) => (
              <div key={type} className="flex items-center gap-1.5 text-xs">
                <span className={`w-2.5 h-2.5 rounded-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`} />
                <span className="text-gray-400">{type}</span>
                <span className="text-gray-600">{count} ({Math.round((count / totalTyped) * 100)}%)</span>
              </div>
            ))}
          </div>
        </div>

        {/* Active Repos */}
        <div className="bg-gray-900 rounded-xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">Active Repos</p>
          <div className="space-y-1.5">
            {repoEntries.map(([repo, count]) => {
              const pct = (count / commits.length) * 100;
              return (
                <div key={repo} className="flex items-center gap-3">
                  <span className="text-sm text-gray-300 truncate min-w-0 flex-1">{repo}</span>
                  <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden shrink-0">
                    <div className="h-full bg-accent-light rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-600 w-8 text-right shrink-0">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Timeline Charts */}
      {timeline.length >= 2 && (
        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Activity Over Time (weekly)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TimelineChart
              data={timeline}
              valueKey="commits"
              label="Commits / Week"
              color="#3B82F6"
            />
            <TimelineChart
              data={timeline}
              valueKey="linesChanged"
              label="Lines Changed / Week"
              color="#10B981"
              computeValue={d => d.linesAdded + d.linesRemoved}
            />
            <TimelineChart
              data={timeline}
              valueKey="avgComplexity"
              label="Avg Complexity / Week"
              color="#F59E0B"
              decimals={1}
            />
            <TimelineChart
              data={timeline}
              valueKey="aiPercent"
              label="AI Assisted %"
              color="#A855F7"
              suffix="%"
            />
          </div>
        </div>
      )}

      {/* AI Summary + Badges */}
      <div className="bg-gray-900 rounded-xl p-6 mb-6">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">Performance Summary</p>
        {summaryLoading && (
          <div>
            <div className="flex items-center gap-3 text-gray-500 mb-3">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">Generating performance summary...</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-accent-light rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        )}
        {summaryError && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {summaryError}
          </div>
        )}
        {!summaryLoading && !summaryError && badges.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-5">
            {badges.map((b, i) => (
              <div
                key={i}
                className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700/50"
                title={b.description}
              >
                <span className="text-xl">{b.icon}</span>
                <div>
                  <p className="text-xs font-semibold text-white leading-tight">{b.title}</p>
                  <p className="text-[10px] text-gray-500 leading-tight">{b.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {!summaryLoading && !summaryError && summary && (
          <div className="prose prose-invert prose-sm max-w-none text-gray-300 [&>p]:mb-3 [&>p:last-child]:mb-0">
            {summary.split('\n\n').map((para, i) => (
              <p key={i} dangerouslySetInnerHTML={{ __html: para.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>') }} />
            ))}
          </div>
        )}
      </div>

      {/* Commits Table */}
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
            Commits ({commits.length})
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">SHA</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">PR</th>
                <th className="px-4 py-3">Repo</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Cmplx</th>
                <th className="px-4 py-3">Risk</th>
                <th className="px-4 py-3 text-right">Lines</th>
                <th className="px-4 py-3">AI</th>
              </tr>
            </thead>
            <tbody>
              {commits.map(c => {
                const isExpanded = expandedSha === c.commit_sha;
                const complexity = Number(c.complexity) || 0;
                const complexColor = complexity >= 7 ? 'text-red-400' : complexity >= 4 ? 'text-yellow-400' : 'text-green-400';
                const riskColor = c.risk_level === 'high' ? 'text-red-400 bg-red-950' : c.risk_level === 'medium' ? 'text-yellow-400 bg-yellow-950' : 'text-green-400 bg-green-950';
                const hasAi = c.ai_co_authored || c.maybe_ai;

                return (
                  <tr
                    key={c.commit_sha}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                    onClick={() => setExpandedSha(isExpanded ? null : c.commit_sha)}
                  >
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                      {c.committed_at ? new Date(c.committed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                      <a
                        href={`https://github.com/${report.org}/${c.repo}/commit/${c.commit_sha}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-light hover:text-accent-lighter hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        {c.commit_sha.slice(0, 7)}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-gray-300 max-w-[240px]">
                      <div className="truncate" title={c.commit_message}>
                        {c.commit_message?.split('\n')[0] || '—'}
                      </div>
                      {isExpanded && c.impact_summary && (
                        <p className="text-xs text-gray-500 mt-1 whitespace-normal">{c.impact_summary}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {c.pr_number ? (
                        <a
                          href={`https://github.com/${report.org}/${c.repo}/pull/${c.pr_number}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-light hover:text-accent-lighter hover:underline text-xs"
                          onClick={e => e.stopPropagation()}
                          title={c.pr_title || ''}
                        >
                          #{c.pr_number}
                        </a>
                      ) : (
                        <span className="text-gray-700 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">{c.repo}</td>
                    <td className="px-4 py-2.5">
                      {c.type && (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs text-white ${TYPE_COLORS[c.type] || 'bg-gray-600'}`}>
                          {c.type}
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono font-medium ${complexColor}`}>
                      {complexity || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {c.risk_level && (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${riskColor}`}>
                          {c.risk_level}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <span className="text-green-400 text-xs">+{c.lines_added}</span>
                      <span className="text-gray-600 text-xs"> / </span>
                      <span className="text-red-400 text-xs">-{c.lines_removed}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {hasAi ? (
                        <span
                          className={`text-xs font-medium ${c.ai_co_authored ? 'text-purple-400' : 'text-purple-600'}`}
                          title={c.ai_co_authored ? `AI: ${c.ai_tool_name || 'confirmed'}` : 'Suspected AI'}
                        >
                          {c.ai_co_authored ? c.ai_tool_name || 'AI' : '~AI'}
                        </span>
                      ) : (
                        <span className="text-gray-700 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Jira Issues Table */}
      {jiraIssues.length > 0 && (
        <div className="bg-gray-900 rounded-xl overflow-hidden mt-6">
          <div className="px-5 py-3 border-b border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
              Jira Issues ({jiraIssues.length})
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="px-4 py-3">Issue Key</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3 text-right">Story Points</th>
                  <th className="px-4 py-3">Labels</th>
                  <th className="px-4 py-3">Resolved Date</th>
                </tr>
              </thead>
              <tbody>
                {jiraIssues.map(issue => {
                  const isExpanded = expandedIssueKey === issue.issue_key;
                  return (
                    <tr
                      key={issue.issue_key}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                      onClick={() => setExpandedIssueKey(isExpanded ? null : issue.issue_key)}
                    >
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                        <a
                          href={issue.issue_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-light hover:text-accent-lighter hover:underline"
                          onClick={e => e.stopPropagation()}
                        >
                          {issue.issue_key}
                        </a>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap text-xs">{issue.issue_type}</td>
                      <td className="px-4 py-2.5 text-gray-300 max-w-[320px]">
                        {isExpanded ? (
                          <div className="whitespace-normal">{issue.summary}</div>
                        ) : (
                          <div className="truncate" title={issue.summary}>{issue.summary}</div>
                        )}
                        {isExpanded && issue.description && (
                          <p className="text-xs text-gray-500 mt-1 whitespace-normal">{issue.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-300 font-mono">
                        {issue.story_points != null ? Number(issue.story_points) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {issue.labels.map(label => (
                            <span key={label} className="px-1.5 py-0.5 bg-gray-800 text-gray-400 text-xs rounded">
                              {label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                        {issue.resolved_at ? new Date(issue.resolved_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineChart({
  data,
  valueKey,
  label,
  color,
  suffix = '',
  decimals = 0,
  computeValue,
}: {
  data: WeeklyData[];
  valueKey: string;
  label: string;
  color: string;
  suffix?: string;
  decimals?: number;
  computeValue?: (d: WeeklyData) => number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Last 90 days of data
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const filtered = data.filter(d => d.week >= cutoffStr);

  if (filtered.length < 2) return null;

  const values = filtered.map(d => computeValue ? computeValue(d) : (d as any)[valueKey] as number);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  // Y-axis: pick nice round tick values
  const yTicks: number[] = [];
  const step = range <= 5 ? 1 : range <= 20 ? 5 : range <= 100 ? 20 : range <= 500 ? 100 : range <= 2000 ? 500 : Math.ceil(range / 5 / 100) * 100;
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    yTicks.push(v);
  }
  if (yTicks.length === 0) yTicks.push(min, max);
  if (yTicks.length > 6) {
    const keep = [yTicks[0], yTicks[Math.floor(yTicks.length / 2)], yTicks[yTicks.length - 1]];
    yTicks.length = 0;
    yTicks.push(...keep);
  }

  const W = 400;
  const H = 130;
  const padL = 40; // left padding for Y-axis labels
  const padR = 12;
  const padT = 12;
  const padB = 24; // bottom for X labels
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const points = values.map((v, i) => {
    const x = padL + (i / (values.length - 1)) * chartW;
    const y = padT + chartH - ((v - min) / range) * chartH;
    return { x, y, v };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${padT + chartH} L${points[0].x},${padT + chartH} Z`;

  // X-axis labels: first, middle, last week
  const labelIndices = [0, Math.floor(filtered.length / 2), filtered.length - 1];
  const formatWeek = (w: string) => {
    const d = new Date(w + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const formatVal = (v: number) => (decimals > 0 ? v.toFixed(decimals) : String(Math.round(v))) + suffix;

  const latest = values[values.length - 1];
  const prev = values.length >= 2 ? values[values.length - 2] : latest;
  const trend = latest > prev ? '+' : latest < prev ? '' : '';
  const diff = latest - prev;

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-white">
            {formatVal(latest)}
          </span>
          {diff !== 0 && (
            <span className={`text-xs ${diff > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {trend}{formatVal(Math.abs(diff))}
            </span>
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Grid lines + Y-axis labels */}
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
        {/* Area fill */}
        <path d={areaPath} fill={color} opacity="0.1" />
        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Data points + hover targets */}
        {points.map((p, i) => (
          <g key={i}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Invisible wider hit target */}
            <circle cx={p.x} cy={p.y} r="10" fill="transparent" />
            {/* Visible dot */}
            <circle cx={p.x} cy={p.y} r={hoverIdx === i ? 5 : 3} fill={color} opacity={hoverIdx === i ? 1 : i === points.length - 1 ? 1 : 0.5} />
          </g>
        ))}
        {/* Hover tooltip */}
        {hoverIdx !== null && (() => {
          const p = points[hoverIdx];
          const weekLabel = formatWeek(filtered[hoverIdx].week);
          const valLabel = formatVal(p.v);
          const text = `${weekLabel}: ${valLabel}`;
          const textW = text.length * 6 + 16;
          const tooltipX = Math.min(Math.max(p.x - textW / 2, 2), W - textW - 2);
          const above = p.y > padT + 30;
          const tooltipY = above ? p.y - 28 : p.y + 12;
          return (
            <g>
              {/* Vertical guide line */}
              <line x1={p.x} y1={padT} x2={p.x} y2={padT + chartH} stroke={color} strokeWidth="1" opacity="0.3" strokeDasharray="3,3" />
              {/* Tooltip background */}
              <rect x={tooltipX} y={tooltipY} width={textW} height={20} rx="4" fill="#1F2937" stroke="#374151" strokeWidth="1" />
              {/* Tooltip text */}
              <text x={tooltipX + textW / 2} y={tooltipY + 14} textAnchor="middle" className="fill-gray-200" fontSize="10" fontWeight="500">
                {text}
              </text>
            </g>
          );
        })()}
        {/* X-axis labels */}
        {labelIndices.map(idx => (
          <text key={idx} x={points[idx].x} y={H - 4} textAnchor="middle" className="fill-gray-600" fontSize="10">
            {formatWeek(filtered[idx].week)}
          </text>
        ))}
      </svg>
    </div>
  );
}
