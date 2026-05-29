'use client';

import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { createPortal } from 'react-dom';
import ChatPanel from '@/app/chat-panel';
import { useAuth } from '@/app/auth-context';
import { useUrlState, useUrlBatch } from '@/lib/url-state';
import TeamTable from './team-table';
import ProjectsCard from '@/components/ProjectsCard';
import type { TeamProject } from '@/lib/team-pulse/types';

interface Developer {
  github_login:       string;
  github_name:        string;
  avatar_url:         string;
  total_prs:          number;
  total_commits:      number;
  lines_added:        number;
  lines_removed:      number;
  avg_complexity:     number;
  impact_score:       number;
  pr_percentage:      number;
  ai_percentage:      number;
  total_jira_issues?: number;
  cc_total_cost?:     number;
  cc_requests?:       number;
  type_breakdown:     Record<string, number>;
  active_repos:       string[];
}

interface Report {
  id:           string;
  org:          string;
  period_days:  number;
  status:       string;
  created_at:   string;
  completed_at: string | null;
}

interface Team {
  id:      string;
  name:    string;
  color:   string;
  members: string[];
}

const TYPE_COLORS: Record<string, string> = {
  feature:  'bg-blue-500',
  bug:      'bg-red-500',
  refactor: 'bg-purple-500',
  infra:    'bg-yellow-500',
  docs:     'bg-gray-500',
  test:     'bg-green-500',
  other:    'bg-gray-600',
};


export default function TeamSummaryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { canAct } = useAuth();

  // Main report data
  const { data: reportData, isLoading } = useSWR(`/api/report/${params.id}`);
  const developers: Developer[] = reportData?.developers ?? [];
  const activeReport: Report | null = reportData?.report ?? null;

  // Teams (dependent on org from report)
  const org = activeReport?.org;
  const { data: teamsData } = useSWR(org ? `/api/teams?org=${org}` : null);
  const teams: Team[] = teamsData ?? [];

  // Latest report ID (for historical warning)
  const { data: config } = useSWR('/api/llm-config', { revalidateIfStale: false });
  const latestReportId = config?.latestReport?.id ?? null;

  const commitCache = useRef<Map<string, any[]>>(new Map());
  const jiraCache = useRef<Map<string, any[]>>(new Map());
  const [view, setView] = useUrlState<'individuals' | 'teams'>({
    key: 'view',
    type: 'enum',
    values: ['individuals', 'teams'] as const,
    default: 'individuals',
    history: 'push',
  });
  const [selectedTeamName, setSelectedTeamName] = useUrlState<string | null>({
    key: 'team',
    type: 'string',
    default: null,
    history: 'replace',
  });
  const [filterLogins, setFilterLogins] = useUrlState<Set<string>>({
    key: 'dev',
    type: 'string-set',
    default: new Set(),
    history: 'replace',
  });
  const urlBatch = useUrlBatch();
  const [filterQuery, setFilterQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterHighlight, setFilterHighlight] = useState(0);

  // Projects card is lazy: no fetch (and no LLM call) until the user expands
  // the card. The pulse summary continues to use its own SWR fetch inside
  // <TeamPulseCard>. When expanded, we hit the same endpoint with
  // ?withProjects=true so the service tops up the cached row's projects field.
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  // Same gate as <TeamPulseCard>: the endpoint refuses period_days < 14 with a
  // 400. Don't bother rendering or firing SWR on short-window reports.
  const projectsAvailable = !!activeReport && activeReport.period_days >= 14;
  const projectsUrl = (projectsAvailable && selectedTeamName && projectsExpanded)
    ? `/api/report/${params.id}/team-pulse?team=${encodeURIComponent(selectedTeamName!)}&org=${encodeURIComponent(activeReport!.org)}&withProjects=true`
    : null;
  const { data: teamPulse, isLoading: teamPulseLoading } = useSWR<{
    summary: string;
    health: { activeRatio: string; trending: string; trendDirection: 'up' | 'down' | 'stable' };
    projects: TeamProject[];
    generatedAt: string;
    cached: boolean;
  }>(projectsUrl, { revalidateOnFocus: false });

  function exportCsv(devs: Developer[], report: Report) {
    const headers = ['Rank','Developer','Login','PRs','Commits','Lines Added','Lines Removed','Avg Complexity','PR%','AI%','Impact Score','Types','Active Repos'];
    const rows = devs.map((d, i) => [
      i + 1,
      d.github_name || d.github_login,
      d.github_login,
      d.total_prs,
      d.total_commits,
      d.lines_added,
      d.lines_removed,
      Number(d.avg_complexity || 0).toFixed(1),
      Number(d.pr_percentage || 0),
      Number(d.ai_percentage || 0),
      Number(d.impact_score || 0).toFixed(1),
      Object.entries(d.type_breakdown || {}).map(([t, c]) => `${t}:${c}`).join('; '),
      (Array.isArray(d.active_repos) ? d.active_repos : []).join('; '),
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `glooker_${report.org}_${report.period_days}d_${new Date(report.created_at).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportGoogleSheet(devs: Developer[], report: Report) {
    const headers = ['Rank','Developer','Login','PRs','Commits','Lines Added','Lines Removed','Avg Complexity','PR%','AI%','Impact Score','Types','Active Repos'];
    const rows = devs.map((d, i) => [
      i + 1,
      d.github_name || d.github_login,
      d.github_login,
      d.total_prs,
      d.total_commits,
      d.lines_added,
      d.lines_removed,
      Number(d.avg_complexity || 0).toFixed(1),
      Number(d.pr_percentage || 0),
      Number(d.ai_percentage || 0),
      Number(d.impact_score || 0).toFixed(1),
      Object.entries(d.type_breakdown || {}).map(([t, c]) => `${t}:${c}`).join('; '),
      (Array.isArray(d.active_repos) ? d.active_repos : []).join('; '),
    ]);

    // Build a CSV string for Google Sheets import via URL
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');

    // Copy CSV to clipboard and open a new Google Sheet
    const title = encodeURIComponent(`Glooker: ${report.org} (${report.period_days}d) - ${new Date(report.created_at).toLocaleDateString()}`);
    navigator.clipboard.writeText(csv).then(() => {
      window.open(`https://docs.google.com/spreadsheets/create?title=${title}`, '_blank');
      alert('Report data copied to clipboard!\\n\\nA new Google Sheet is opening.\\nPress Ctrl+V (or Cmd+V) in cell A1 to paste the data.');
    }).catch(() => {
      // Fallback: download CSV
      const csvDataUri = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
      const a = document.createElement('a');
      a.href = csvDataUri;
      a.download = `glooker_${report.org}.csv`;
      a.click();
      alert('Could not copy to clipboard. CSV file downloaded instead.\\nYou can import it into Google Sheets via File > Import.');
    });
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Historical report notice */}
      {activeReport && latestReportId && latestReportId !== params.id && (
        <div className="mb-4 px-4 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2 text-xs text-amber-400">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Viewing historical report from {new Date(activeReport.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — not the latest report.
        </div>
      )}

      {/* Report header */}
      {activeReport && (
        <div className="flex items-center justify-between mb-4">
          <div>
            <span
              className="text-gray-300 font-medium hover:text-accent-light cursor-pointer transition-colors"
              onClick={() => router.push(`/report/${activeReport!.id}/org`)}
            >{activeReport.org}</span>
            <span className="text-gray-500 text-sm ml-2">
              last {activeReport.period_days} days &middot; {developers.length} developers
            </span>
          </div>
          <div className="flex items-center gap-3">
            {developers.length > 0 && (
              <>
                <button
                  onClick={() => exportCsv(developers, activeReport)}
                  className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
                >
                  Export CSV
                </button>
                <button
                  onClick={() => exportGoogleSheet(developers, activeReport)}
                  className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
                >
                  Export to Google Sheet
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors no-print"
                >
                  Download PDF
                </button>
              </>
            )}
            <span className="text-xs text-gray-600">
              {activeReport.completed_at
                ? `Completed ${new Date(activeReport.completed_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}`
                : ''}
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-800 mb-6">
        <div className="flex gap-6">
          <button
            onClick={() => setView('individuals')}
            className={`pb-2 text-sm font-medium transition-colors ${view === 'individuals' ? 'text-white border-b-2 border-accent -mb-px' : 'text-gray-500 hover:text-gray-300'}`}
          >Individuals</button>
          <button
            onClick={() => setView('teams')}
            className={`pb-2 text-sm font-medium transition-colors ${view === 'teams' ? 'text-white border-b-2 border-accent -mb-px' : 'text-gray-500 hover:text-gray-300'}`}
          >Teams</button>
        </div>
      </div>

      {view === 'individuals' && (
      <>
      {/* User filter */}
      {developers.length > 0 && (
        <div className="mb-3 relative">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Team filter */}
            {teams.length > 0 && (
              <select
                value=""
                onChange={e => {
                  const team = teams.find(t => t.id === e.target.value);
                  if (team) {
                    urlBatch(() => {
                      setFilterLogins(new Set(team.members));
                      setSelectedTeamName(team.name);
                    });
                  }
                  e.target.value = '';
                }}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="">Filter by team...</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.members.length})</option>
                ))}
              </select>
            )}
            {[...filterLogins].map(login => {
              const dev = developers.find(d => d.github_login === login);
              return (
                <span key={login} className="inline-flex items-center gap-1.5 bg-accent/20 text-accent-lighter text-xs font-medium px-2.5 py-1 rounded-lg border border-accent/30">
                  {dev?.avatar_url && <img src={dev.avatar_url} alt="" className="w-4 h-4 rounded-full" />}
                  {dev?.github_name || login}
                  <button onClick={() => { const n = new Set(filterLogins); n.delete(login); setFilterLogins(n); }} className="text-accent-light hover:text-white ml-0.5">&times;</button>
                </span>
              );
            })}
            <div className="relative">
              {(() => {
                const q = filterQuery.toLowerCase();
                const matches = filterOpen && q.length > 0
                  ? developers.filter(d =>
                      !filterLogins.has(d.github_login) && (
                        d.github_login.toLowerCase().includes(q) ||
                        (d.github_name || '').toLowerCase().includes(q)
                      )
                    ).slice(0, 8)
                  : [];
                const selectMatch = (login: string) => {
                  setFilterLogins(new Set(filterLogins).add(login));
                  setFilterQuery('');
                  setFilterOpen(false);
                  setFilterHighlight(0);
                };
                return (
                  <>
                    <input
                      type="text"
                      value={filterQuery}
                      onChange={e => { setFilterQuery(e.target.value); setFilterOpen(true); setFilterHighlight(0); }}
                      onFocus={() => { setFilterOpen(true); setFilterHighlight(0); }}
                      onBlur={() => setTimeout(() => setFilterOpen(false), 150)}
                      onKeyDown={e => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setFilterHighlight(h => Math.min(h + 1, matches.length - 1)); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setFilterHighlight(h => Math.max(h - 1, 0)); }
                        else if (e.key === 'Enter' && matches.length > 0) { e.preventDefault(); selectMatch(matches[filterHighlight]?.github_login); }
                        else if (e.key === 'Escape') { setFilterOpen(false); }
                        else if (e.key === 'Backspace' && filterQuery === '' && filterLogins.size > 0) {
                          const last = [...filterLogins].pop()!;
                          const n = new Set(filterLogins); n.delete(last); setFilterLogins(n);
                        }
                      }}
                      placeholder={filterLogins.size > 0 ? 'Add more...' : 'Filter by developer...'}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent w-48"
                    />
                    {matches.length > 0 && (
                      <div className="absolute z-40 top-full mt-1 left-0 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                        {matches.map((d, idx) => (
                          <button
                            key={d.github_login}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${idx === filterHighlight ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
                            onMouseEnter={() => setFilterHighlight(idx)}
                            onClick={() => selectMatch(d.github_login)}
                          >
                            {d.avatar_url && <img src={d.avatar_url} alt="" className="w-5 h-5 rounded-full" />}
                            <div>
                              <span className="text-white">{d.github_name || d.github_login}</span>
                              {d.github_name && <span className="text-gray-500 ml-1.5">@{d.github_login}</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            {filterLogins.size > 0 && (
              <button onClick={() => urlBatch(() => {
                setFilterLogins(new Set());
                setSelectedTeamName(null);
              })} className="text-xs text-gray-600 hover:text-gray-400">Clear all</button>
            )}
          </div>
        </div>
      )}

      {selectedTeamName && activeReport && activeReport.period_days >= 14 && (
        <TeamPulseCard
          reportId={params.id}
          teamName={selectedTeamName}
          org={activeReport.org}
          periodDays={activeReport.period_days}
        />
      )}

      {selectedTeamName && projectsAvailable && (
        <div className="mb-4">
          <ProjectsCard
            projects={teamPulse?.projects ?? []}
            loading={projectsExpanded && teamPulseLoading && !teamPulse}
            title="Current Projects"
            subtitle={`${selectedTeamName} · ${activeReport!.period_days}d`}
            developerHref={(login) => `/report/${params.id}/dev/${login}`}
            collapsible
            expanded={projectsExpanded}
            onExpandedChange={setProjectsExpanded}
          />
        </div>
      )}

      {/* Developer table */}
      {(() => {
        const filteredDevs = filterLogins.size > 0 ? developers.filter(d => filterLogins.has(d.github_login)) : developers;
        const hasJira = developers.some(d => (d.total_jira_issues ?? 0) > 0);
        const hasSpend = canAct && developers.some(d => Number(d.cc_total_cost ?? 0) > 0);
        // Absolute rank across the full server-sorted developer list — shown
        // alongside the filter-relative rank so users can still see where a
        // developer sits across the whole team even when filtered down.
        const absoluteRanks = new Map<string, number>();
        developers.forEach((d, idx) => absoluteRanks.set(d.github_login, idx + 1));
        const showAbsolute = filterLogins.size > 0;
        return filteredDevs.length > 0 && (
        <div className="bg-gray-900 rounded-xl overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-4 py-3 w-[24%]">Developer</th>
                <th className="px-4 py-3 text-right w-[5%]">PRs</th>
                <th className="px-4 py-3 text-right w-[7%]">Commits</th>
                <th className="px-4 py-3 text-right w-[11%]">Lines +/-</th>
                <th className="px-4 py-3 text-right w-[7%]">Cmplx</th>
                <th className="px-4 py-3 text-right w-[5%]">PR%</th>
                <th className="px-4 py-3 text-right w-[5%]">AI%</th>
                {hasJira && <th className="px-4 py-3 text-right w-[5%]">Jira</th>}
                {hasSpend && <th className="px-4 py-3 text-right w-[7%]" title="Anthropic API spend (last uploaded period)">Spend</th>}
                <th className="px-4 py-3 w-[24%]">Types</th>
                <th className="px-4 py-3 text-right w-[7%]" title="Impact = Commits (2.0) + PRs (2.7) + Complexity (3.5) + PR% (1.1) + Jira (0.5) + Reviews (0.5). Max: 9.3">Impact &#9432;</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevs.map((dev, i) => (
                <tr
                  key={dev.github_login}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                  onClick={() => router.push(`/report/${params.id}/dev/${dev.github_login}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="text-gray-600 text-xs shrink-0 text-right tabular-nums"
                        style={{ minWidth: showAbsolute ? '3rem' : '1.25rem' }}
                        title={showAbsolute ? `Position within filter (overall: #${absoluteRanks.get(dev.github_login)})` : undefined}
                      >
                        {i + 1}
                        {showAbsolute && absoluteRanks.has(dev.github_login) && (
                          <span className="text-gray-700 ml-0.5">({absoluteRanks.get(dev.github_login)})</span>
                        )}
                      </span>
                      {dev.avatar_url && (
                        <img
                          src={dev.avatar_url}
                          alt=""
                          className="w-7 h-7 rounded-full shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{dev.github_name || dev.github_login}</div>
                        <div className="text-xs text-gray-500 truncate">@{dev.github_login}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">{dev.total_prs}</td>
                  <td className="px-4 py-3 text-right">
                    <CommitCountWithTooltip
                      count={dev.total_commits}
                      reportId={params.id}
                      login={dev.github_login}
                      org={activeReport?.org || ''}
                      cacheRef={commitCache}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-green-400">+{dev.lines_added.toLocaleString()}</span>
                    <span className="text-gray-600"> / </span>
                    <span className="text-red-400">-{dev.lines_removed.toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ComplexityBadge value={dev.avg_complexity} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PrPercentBadge value={dev.pr_percentage} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <AiPercentBadge value={dev.ai_percentage} />
                  </td>
                  {hasJira && (
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      {(dev.total_jira_issues ?? 0) > 0 ? (
                        <JiraCountWithTooltip
                          count={dev.total_jira_issues!}
                          reportId={params.id}
                          login={dev.github_login}
                          cacheRef={jiraCache}
                        />
                      ) : (
                        <span className="text-gray-600 text-sm">—</span>
                      )}
                    </td>
                  )}
                  {hasSpend && (
                    <td className="px-4 py-3 text-right">
                      {Number(dev.cc_total_cost ?? 0) > 0 ? (
                        <span className="text-green-400 font-mono text-sm">${(Number(dev.cc_total_cost) / 100).toFixed(2)}</span>
                      ) : (
                        <span className="text-gray-600 text-sm">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <TypeBreakdown breakdown={dev.type_breakdown} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ImpactBadge value={dev.impact_score} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      })()}
      </>
      )}

      {view === 'teams' && activeReport && teamsData !== undefined && (
        <TeamTable
          developers={developers}
          teams={teams}
          reportId={params.id}
          canAct={canAct}
        />
      )}

      {activeReport && developers.length === 0 && activeReport.status === 'completed' && (
        <div className="text-center text-gray-500 py-16">
          No commits found for this org in the selected period.
        </div>
      )}

      {activeReport?.org && <ChatPanel org={activeReport.org} />}
    </div>
  );
}

function TeamPulseCard({ reportId, teamName, org, periodDays }: {
  reportId: string;
  teamName: string;
  org: string;
  periodDays: number;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(`team-pulse-collapsed-${teamName}`) !== 'false';
    }
    return false;
  });

  const { data, isLoading, error } = useSWR(
    periodDays >= 14
      ? `/api/report/${reportId}/team-pulse?team=${encodeURIComponent(teamName)}&org=${encodeURIComponent(org)}`
      : null,
    { revalidateIfStale: false },
  );

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    sessionStorage.setItem(`team-pulse-collapsed-${teamName}`, String(next));
  };

  if (!data && !isLoading && !error) return null;

  const trendColor = data?.health?.trendDirection === 'up' ? 'text-green-400'
    : data?.health?.trendDirection === 'down' ? 'text-red-400'
    : 'text-gray-500';
  const trendArrow = data?.health?.trendDirection === 'up' ? '▲'
    : data?.health?.trendDirection === 'down' ? '▼'
    : '—';

  return (
    <div className="bg-gray-900 rounded-xl mb-4 overflow-hidden">
      <button
        onClick={toggleCollapse}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-semibold text-white">Team Pulse: {teamName}</span>
          {isLoading && <span className="text-xs text-gray-500 animate-pulse">Generating...</span>}
        </div>
        {data?.health && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-400">{data.health.activeRatio} active</span>
            <span className={trendColor}>{trendArrow} {data.health.trending}</span>
          </div>
        )}
      </button>
      {!collapsed && (
        <div className="px-5 pb-4 border-t border-gray-800">
          {isLoading && (
            <div className="py-6 text-center text-sm text-gray-500 animate-pulse">Generating team pulse...</div>
          )}
          {error && (
            <div className="py-4 text-center text-sm text-red-400">Failed to generate summary</div>
          )}
          {data?.summary && (
            <div
              className="mt-3 text-sm text-gray-300 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderPulseMarkdown(data.summary) }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function renderPulseMarkdown(md: string): string {
  return md
    .replace(/^## (.+)$/gm, '<h3 class="text-xs font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">$1</h3>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-gray-300 mb-1">$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
    .replace(/@(\w[\w-]*)/g, '<span class="text-accent-light font-medium">@$1</span>')
    .replace(/\n/g, '');
}

function ComplexityBadge({ value }: { value: number }) {
  const n = Number(value) || 0;
  const color =
    n >= 7 ? 'text-red-400' :
    n >= 4 ? 'text-yellow-400' :
    'text-green-400';
  return (
    <span className={`font-mono font-medium ${color}`}>
      {n.toFixed(1)}
    </span>
  );
}

function ImpactBadge({ value }: { value: number }) {
  const n = Number(value) || 0;
  const color =
    n >= 7 ? 'bg-accent-light' :
    n >= 4 ? 'bg-accent-dark' :
    'bg-gray-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold text-white ${color}`}>
      {n.toFixed(1)}
    </span>
  );
}

function AiPercentBadge({ value }: { value: number }) {
  const n = Number(value) || 0;
  if (n === 0) return <span className="text-gray-600 text-sm">—</span>;
  const color = n >= 50 ? 'text-purple-400' : 'text-purple-600';
  return (
    <span className={`font-mono font-medium text-sm ${color}`}>
      {n}%
    </span>
  );
}

function PrPercentBadge({ value }: { value: number }) {
  const n = Number(value) || 0;
  const color =
    n >= 80 ? 'text-green-400' :
    n >= 50 ? 'text-yellow-400' :
    'text-red-400';
  return (
    <span className={`font-mono font-medium text-sm ${color}`}>
      {n}%
    </span>
  );
}


function TypeBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([type, count]) => (
        <span
          key={type}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-white ${TYPE_COLORS[type] || 'bg-gray-600'}`}
        >
          {type} <span className="opacity-75">{count}</span>
        </span>
      ))}
    </div>
  );
}

function CommitCountWithTooltip({
  count,
  reportId,
  login,
  org,
  cacheRef,
}: {
  count: number;
  reportId: string;
  login: string;
  org: string;
  cacheRef: React.RefObject<Map<string, any[]>>;
}) {
  const [commits, setCommits] = useState<any[] | null>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flipDown: boolean }>({ top: 0, left: 0, flipDown: false });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleMouseEnter() {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    // Position tooltip above the trigger, right-aligned
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const flipDown = rect.top < 300; // not enough room above
      setPos({
        top: flipDown ? rect.bottom + 8 : rect.top - 8,
        left: rect.right,
        flipDown,
      });
    }
    setShow(true);
    const key = `${reportId}:${login}`;
    if (cacheRef.current!.has(key)) {
      setCommits(cacheRef.current!.get(key)!);
      return;
    }
    setLoading(true);
    try {
      const rows = await fetch(`/api/report/${reportId}/commits?login=${login}`).then(r => r.json());
      cacheRef.current!.set(key, rows);
      setCommits(rows);
    } catch {
      setCommits([]);
    }
    setLoading(false);
  }

  function handleMouseLeave() {
    hideTimeout.current = setTimeout(() => setShow(false), 200);
  }

  const tooltip = show && typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed z-[9999] w-[420px] max-h-72 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-2xl text-xs text-left"
      style={{
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        transform: pos.flipDown ? 'translate(-100%, 0)' : 'translate(-100%, -100%)',
      }}
      onMouseEnter={() => { if (hideTimeout.current) clearTimeout(hideTimeout.current); }}
      onMouseLeave={handleMouseLeave}
    >
      <div className="px-3 py-2 border-b border-gray-700 text-gray-400 font-medium">
        {count} commits by @{login}
      </div>
      <div className="p-2">
        {loading && <p className="text-gray-500 px-1 py-2">Loading...</p>}
        {!loading && commits && commits.length === 0 && <p className="text-gray-500 px-1 py-2">No commits</p>}
        {!loading && commits && commits.length > 0 && (
          <table className="w-full">
            <tbody>
              {commits.map((c: any) => (
                <tr key={c.commit_sha} className="border-b border-gray-700/30 last:border-0">
                  <td className="py-1.5 px-1 font-mono whitespace-nowrap align-top">
                    <a href={`https://github.com/${org}/${c.repo}/commit/${c.commit_sha}`} target="_blank" rel="noopener noreferrer" className="text-accent-light hover:text-accent-lighter hover:underline">{c.commit_sha.slice(0, 7)}</a>
                  </td>
                  <td className="py-1.5 px-1 text-gray-400 align-top" style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.commit_message}>
                    {c.commit_message?.split('\n')[0]?.slice(0, 60) || '\u2014'}
                  </td>
                  <td className="py-1.5 px-1 text-gray-600 whitespace-nowrap align-top">{c.repo?.split('/')[1] || c.repo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <span className="inline-block" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <span ref={triggerRef} className="text-gray-300 cursor-default underline decoration-dotted decoration-gray-600 underline-offset-4">
        {count}
      </span>
      {tooltip}
    </span>
  );
}

function JiraCountWithTooltip({
  count,
  reportId,
  login,
  cacheRef,
}: {
  count: number;
  reportId: string;
  login: string;
  cacheRef: React.RefObject<Map<string, any[]>>;
}) {
  const [issues, setIssues] = useState<any[] | null>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flipDown: boolean }>({ top: 0, left: 0, flipDown: false });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleMouseEnter() {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const flipDown = rect.top < 300;
      setPos({ top: flipDown ? rect.bottom + 8 : rect.top - 8, left: rect.right, flipDown });
    }
    setShow(true);
    const key = `jira:${reportId}:${login}`;
    if (cacheRef.current!.has(key)) { setIssues(cacheRef.current!.get(key)!); return; }
    setLoading(true);
    try {
      const rows = await fetch(`/api/report/${reportId}/jira-issues?login=${login}`).then(r => r.json());
      cacheRef.current!.set(key, rows);
      setIssues(rows);
    } catch { setIssues([]); }
    setLoading(false);
  }

  function handleMouseLeave() {
    hideTimeout.current = setTimeout(() => setShow(false), 200);
  }

  const tooltip = show && typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed z-[9999] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-3 w-80 max-h-60 overflow-y-auto text-sm"
      style={{ top: pos.flipDown ? pos.top : undefined, bottom: pos.flipDown ? undefined : `${window.innerHeight - pos.top}px`, left: Math.max(pos.left - 320, 8) }}
      onMouseEnter={() => { if (hideTimeout.current) clearTimeout(hideTimeout.current); }}
      onMouseLeave={handleMouseLeave}
    >
      {loading && <div className="text-gray-500 text-xs py-2">Loading...</div>}
      {issues && issues.length === 0 && <div className="text-gray-500 text-xs py-2">No issues found</div>}
      {issues && issues.map((issue: any) => (
        <a
          key={issue.issue_key}
          href={issue.issue_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block py-1.5 px-2 hover:bg-gray-800 rounded"
        >
          <span className="text-accent-light font-mono text-xs">{issue.issue_key}</span>
          <span className="text-gray-400 ml-2 text-xs">{issue.summary?.slice(0, 50)}</span>
        </a>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <span className="inline-block" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <span ref={triggerRef} className="text-gray-300 cursor-default underline decoration-dotted decoration-gray-600 underline-offset-4">
        {count}
      </span>
      {tooltip}
    </span>
  );
}
