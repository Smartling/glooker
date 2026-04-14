'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import LlmFindings from '@/app/llm-findings';
import ChatPanel from '@/app/chat-panel';

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
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const commitCache = useRef<Map<string, any[]>>(new Map());
  const jiraCache = useRef<Map<string, any[]>>(new Map());
  const [filterLogins, setFilterLogins] = useState<Set<string>>(new Set());
  const [filterQuery, setFilterQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterHighlight, setFilterHighlight] = useState(0);
  const [teams, setTeams] = useState<Array<{ id: string; name: string; color: string; members: string[] }>>([]);

  // Load report data on mount
  useEffect(() => {
    fetch(`/api/report/${params.id}`)
      .then(r => r.json())
      .then(data => {
        setDevelopers(data.developers || []);
        setActiveReport(data.report);
        if (data.report?.org) {
          fetch(`/api/teams?org=${data.report.org}`).then(r => r.json()).then(setTeams).catch(() => {});
        }
      })
      .catch(err => console.error('[glooker] Failed to load report:', err));
  }, [params.id]);

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
      {/* Report header */}
      {activeReport && (
        <div className="flex items-center justify-between mb-4">
          <div>
            <span
              className="text-gray-300 font-medium hover:text-accent-light cursor-pointer transition-colors"
              onClick={() => window.location.href = `/report/${activeReport.id}/org`}
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
                  if (team) setFilterLogins(new Set(team.members));
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
                  <button onClick={() => setFilterLogins(prev => { const n = new Set(prev); n.delete(login); return n; })} className="text-accent-light hover:text-white ml-0.5">&times;</button>
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
                  setFilterLogins(prev => new Set(prev).add(login));
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
                          setFilterLogins(prev => { const n = new Set(prev); n.delete(last); return n; });
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
              <button onClick={() => setFilterLogins(new Set())} className="text-xs text-gray-600 hover:text-gray-400">Clear all</button>
            )}
          </div>
        </div>
      )}

      {/* Developer table */}
      {(() => {
        const filteredDevs = filterLogins.size > 0 ? developers.filter(d => filterLogins.has(d.github_login)) : developers;
        const hasJira = developers.some(d => (d.total_jira_issues ?? 0) > 0);
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
                <th className="px-4 py-3 w-[24%]">Types</th>
                <th className="px-4 py-3 text-right w-[7%]" title="Impact = Commits (2.0) + PRs (2.7) + Complexity (3.5) + PR% (1.1) + Jira (0.5) + Reviews (0.5). Max: 9.3">Impact &#9432;</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevs.map((dev, i) => (
                <tr
                  key={dev.github_login}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                  onClick={() => window.location.href = `/report/${params.id}/dev/${dev.github_login}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-gray-600 text-xs w-5 shrink-0 text-right">{i + 1}</span>
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

      {activeReport && developers.length === 0 && activeReport.status === 'completed' && (
        <div className="text-center text-gray-500 py-16">
          No commits found for this org in the selected period.
        </div>
      )}

      <LlmFindings />

      {activeReport?.org && <ChatPanel org={activeReport.org} />}
    </div>
  );
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
