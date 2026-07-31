'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import ChatPanel from '@/app/chat-panel';
import { useUrlState, useUrlBatch } from '@/lib/url-state';
import TeamTable from './team-table';
import DevTable from './dev-table';
import type { Developer } from './dev-table';
import ProjectsCard from '@/components/ProjectsCard';
import IntegrityBadge from '@/components/IntegrityBadge';
import type { TeamProject } from '@/lib/team-pulse/types';
import type { RunMetadata } from '@/lib/report-runner/types';

interface Report {
  id:           string;
  org:          string;
  period_days:  number;
  status:       string;
  created_at:   string;
  completed_at: string | null;
  run_metadata?: RunMetadata | null;
}

interface Team {
  id:      string;
  name:    string;
  color:   string;
  members: string[];
}

export default function TeamSummaryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

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
            {activeReport.run_metadata?.state !== 'failed' && (
              <IntegrityBadge
                metadata={activeReport.run_metadata ?? null}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            {developers.length > 0 && activeReport.run_metadata?.state !== 'failed' && (
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

      {view === 'individuals' && activeReport?.run_metadata?.state === 'failed' && (
        <IntegrityBadge metadata={activeReport.run_metadata ?? null} />
      )}

      {view === 'individuals' && activeReport?.run_metadata?.state !== 'failed' && (
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
      <DevTable
        developers={developers}
        reportId={params.id}
        org={activeReport?.org ?? ''}
        filterLogins={filterLogins}
      />
      </>
      )}

      {view === 'teams' && activeReport && teamsData !== undefined && activeReport?.run_metadata?.state !== 'failed' && (
        <TeamTable
          developers={developers}
          teams={teams}
          reportId={params.id}
        />
      )}

      {view === 'teams' && activeReport?.run_metadata?.state === 'failed' && (
        <IntegrityBadge metadata={activeReport.run_metadata ?? null} />
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

