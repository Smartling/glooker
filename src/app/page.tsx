'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Developer {
  github_login:   string;
  github_name:    string;
  avatar_url:     string;
  total_prs:      number;
  total_commits:  number;
  lines_added:    number;
  lines_removed:  number;
  avg_complexity: number;
  impact_score:   number;
  pr_percentage:  number;
  ai_percentage:  number;
  type_breakdown: Record<string, number>;
  active_repos:   string[];
}

interface Progress {
  status:          string;
  step:            string;
  totalRepos:      number;
  processedRepos:  number;
  totalCommits:    number;
  analyzedCommits: number;
  error?:          string;
  logs?:           string[];
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

export default function Home() {
  const [org, setOrg]               = useState('');
  const [period, setPeriod]         = useState(30);
  const [running, setRunning]       = useState(false);
  const [reportId, setReportId]     = useState<string | null>(null);
  const [progress, setProgress]     = useState<Progress | null>(null);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [pastReports, setPastReports]   = useState<Report[]>([]);
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [orgs, setOrgs]             = useState<Array<{ login: string; avatar_url: string }>>([]);
  const [logs, setLogs]             = useState<string[]>([]);
  const [showLogs, setShowLogs]     = useState(true);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Load orgs and past reports on mount
  useEffect(() => {
    fetch('/api/orgs')
      .then((r) => r.json())
      .then((data: Array<{ login: string; avatar_url: string }>) => {
        setOrgs(data);
        if (data.length > 0 && !org) setOrg(data[0].login);
      })
      .catch(() => {});
    fetch('/api/report')
      .then((r) => r.json())
      .then(setPastReports)
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(id: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const prog = await fetch(`/api/report/${id}/progress`).then((r) => r.json());
        setProgress(prog);
        if (prog.logs) setLogs(prog.logs);

        if (prog.status === 'completed' || prog.status === 'failed' || prog.status === 'stopped') {
          stopPolling();
          setRunning(false);
          if (prog.status === 'completed') {
            const data = await fetch(`/api/report/${id}`).then((r) => r.json());
            setDevelopers(data.developers || []);
            setActiveReport(data.report);
            // Refresh past reports list
            fetch('/api/report').then((r) => r.json()).then(setPastReports).catch(() => {});
          }
        }
      } catch {
        // ignore transient errors
      }
    }, 1500);
  }

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (!org.trim()) return;

    setRunning(true);
    setDevelopers([]);
    setProgress(null);
    setActiveReport(null);
    setLogs([]);
    setShowLogs(true);

    const res  = await fetch('/api/report', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ org: org.trim(), periodDays: period }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Failed to start report');
      setRunning(false);
      return;
    }

    setReportId(data.reportId);
    // Add to sidebar immediately
    setPastReports((prev) => [{
      id: data.reportId,
      org: org.trim(),
      period_days: period,
      status: 'running',
      created_at: new Date().toISOString(),
      completed_at: null,
    }, ...prev]);
    setActiveReport({
      id: data.reportId,
      org: org.trim(),
      period_days: period,
      status: 'running',
      created_at: new Date().toISOString(),
      completed_at: null,
    });
    startPolling(data.reportId);
  }

  async function loadReport(id: string) {
    const data = await fetch(`/api/report/${id}`).then((r) => r.json());
    setDevelopers(data.developers || []);
    setActiveReport(data.report);
    setReportId(id);

    // If report is still running, start polling for progress
    if (data.report.status === 'running') {
      setRunning(true);
      setProgress(null);
      setLogs([]);
      setShowLogs(true);
      startPolling(id);
    } else {
      setProgress(null);
      setRunning(false);
    }
  }

  async function deleteReport(id: string) {
    await fetch(`/api/report/${id}`, { method: 'DELETE' });
    setPastReports((prev) => prev.filter((r) => r.id !== id));
    setDeletingId(null);
    if (activeReport?.id === id) {
      setActiveReport(null);
      setDevelopers([]);
    }
  }

  async function stopReport(id: string) {
    await fetch(`/api/report/${id}/stop`, { method: 'POST' });
    stopPolling();
    setRunning(false);
    setPastReports((prev) => prev.map((r) => r.id === id ? { ...r, status: 'stopped' } : r));
  }

  async function resumeReport(id: string) {
    setRunning(true);
    setDevelopers([]);
    setProgress(null);
    setLogs([]);
    setShowLogs(true);
    setReportId(id);

    // Update local state
    setPastReports((prev) => prev.map((r) => r.id === id ? { ...r, status: 'running' } : r));

    const res = await fetch(`/api/report/${id}/resume`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Failed to resume');
      setRunning(false);
      return;
    }

    startPolling(id);
  }

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
    const blob = new Blob([csv], { type: 'text/csv' });

    // Use the /api/export endpoint to serve the CSV, then redirect to Google Sheets import
    // For simplicity, we create the CSV file and open Google Sheets with a paste prompt
    const csvDataUri = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

    // Open a new Google Sheet and provide instructions
    const title = encodeURIComponent(`Glooker: ${report.org} (${report.period_days}d) - ${new Date(report.created_at).toLocaleDateString()}`);
    // Google Sheets doesn't have a direct CSV import URL, so we:
    // 1. Copy CSV to clipboard
    // 2. Open a new sheet
    // 3. User pastes with Ctrl+V
    navigator.clipboard.writeText(csv).then(() => {
      window.open(`https://docs.google.com/spreadsheets/create?title=${title}`, '_blank');
      alert('Report data copied to clipboard!\\n\\nA new Google Sheet is opening.\\nPress Ctrl+V (or Cmd+V) in cell A1 to paste the data.');
    }).catch(() => {
      // Fallback: download CSV
      const a = document.createElement('a');
      a.href = csvDataUri;
      a.download = `glooker_${report.org}.csv`;
      a.click();
      alert('Could not copy to clipboard. CSV file downloaded instead.\\nYou can import it into Google Sheets via File > Import.');
    });
  }

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const pct = progress && progress.totalCommits > 0
    ? Math.round((progress.analyzedCommits / progress.totalCommits) * 100)
    : progress?.status === 'completed' ? 100 : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white">Glooker</h1>
        <p className="text-gray-400 mt-1">GitHub org developer impact analytics</p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar: past reports */}
        <div className="w-60 shrink-0">
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-3 font-semibold">Past Reports</p>
          <div className="space-y-1.5">
            {pastReports.length === 0 && (
              <p className="text-gray-600 text-sm">No reports yet</p>
            )}
            {pastReports.map((r) => {
              const isActive   = activeReport?.id === r.id;
              const isDeleting = deletingId === r.id;
              const statusColor =
                r.status === 'completed' ? 'text-green-400' :
                r.status === 'failed'    ? 'text-red-400' :
                r.status === 'stopped'   ? 'text-orange-400' :
                r.status === 'running'   ? 'text-blue-400' :
                'text-gray-500';
              const borderColor =
                r.status === 'completed' ? 'border-green-800' :
                r.status === 'failed'    ? 'border-red-900' :
                r.status === 'stopped'   ? 'border-orange-900' :
                'border-gray-800';
              const canResume = (r.status === 'failed' || r.status === 'stopped') && !running;

              return (
                <div key={r.id} className="group">
                  {isDeleting ? (
                    <div className={`px-3 py-2.5 rounded-lg text-sm bg-red-950 border border-red-800`}>
                      <p className="text-red-300 text-xs mb-2">Delete this report?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => deleteReport(r.id)}
                          className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => loadReport(r.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors border ${
                        isActive
                          ? `bg-gray-800 text-white ${borderColor}`
                          : `border-transparent hover:bg-gray-800/50 hover:border-gray-800`
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate">{r.org}</span>
                        <div className="flex items-center gap-1.5">
                          {canResume && (
                            <span
                              role="button"
                              onClick={(e) => { e.stopPropagation(); resumeReport(r.id); }}
                              className="text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer"
                              title="Resume this report"
                            >
                              resume
                            </span>
                          )}
                          <span className={`text-xs font-medium ${statusColor}`}>
                            {r.status === 'completed' ? 'done' : r.status === 'stopped' ? 'stopped' : r.status}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-gray-500">{r.period_days} days</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-600">
                            {new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                          <span
                            role="button"
                            onClick={(e) => { e.stopPropagation(); setDeletingId(r.id); }}
                            className="p-0.5 rounded text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            title="Delete report"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    </button>
                  )}
                  {/* Delete button — visible on hover */}
                </div>
              );
            })}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Run form */}
          <form onSubmit={handleRun} className="bg-gray-900 rounded-xl p-5 mb-6 flex items-end gap-4 flex-wrap">
            <div className="min-w-48">
              <label className="block text-xs text-gray-400 mb-1 font-medium">GitHub Org</label>
              <select
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                disabled={running || orgs.length === 0}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-8 text-sm text-white focus:outline-none focus:border-blue-500 appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%236b7280%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center] bg-[length:1.25rem]"
              >
                {orgs.length === 0 && <option value="">Loading…</option>}
                {orgs.map((o) => (
                  <option key={o.login} value={o.login}>{o.login}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1 font-medium">Period</label>
              <div className="flex gap-1">
                {[3, 14, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setPeriod(d)}
                    disabled={running}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      period === d
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            {running ? (
              <button
                type="button"
                onClick={() => reportId && stopReport(reportId)}
                className="px-5 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!org.trim()}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Run Report
              </button>
            )}
          </form>

          {/* Progress */}
          {(running || (progress && (progress.status === 'failed' || progress.status === 'stopped'))) && progress && (
            <div className="bg-gray-900 rounded-xl p-5 mb-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-300">{progress.step}</span>
                {progress.totalCommits > 0 && (
                  <span className="text-gray-500">
                    {progress.analyzedCommits} / {progress.totalCommits} commits
                  </span>
                )}
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    progress.status === 'failed' ? 'bg-red-500' : progress.status === 'stopped' ? 'bg-orange-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.max(pct, running ? 2 : 0)}%` }}
                />
              </div>
              {progress.totalRepos > 0 && (
                <p className="text-xs text-gray-600 mt-2">
                  Members: {progress.processedRepos}/{progress.totalRepos}
                </p>
              )}
              {progress.error && (
                <p className="text-xs text-red-400 mt-2">{progress.error}</p>
              )}
            </div>
          )}

          {/* Log panel */}
          {logs.length > 0 && (
            <div className="bg-gray-900 rounded-xl mb-6 overflow-hidden">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-400 hover:text-gray-300 bg-gray-800/50"
              >
                <span className="font-semibold uppercase tracking-wider">
                  Logs ({logs.length})
                </span>
                <span>{showLogs ? 'Hide' : 'Show'}</span>
              </button>
              {showLogs && (
                <div className="max-h-64 overflow-y-auto p-3 font-mono text-xs leading-relaxed">
                  {logs.map((line, i) => (
                    <div
                      key={i}
                      className={`${
                        line.includes('ERROR') || line.includes('FATAL')
                          ? 'text-red-400'
                          : line.includes('SKIP')
                          ? 'text-yellow-500'
                          : line.includes('LLM [')
                          ? 'text-blue-400'
                          : line.includes('DEV ')
                          ? 'text-green-400'
                          : 'text-gray-500'
                      }`}
                    >
                      {line}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          )}

          {/* Report header */}
          {activeReport && (
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-gray-300 font-medium">{activeReport.org}</span>
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

          {/* Developer table */}
          {developers.length > 0 && (
            <div className="bg-gray-900 rounded-xl overflow-hidden">
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
                    <th className="px-4 py-3">Types</th>
                    <th className="px-4 py-3 text-right">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {developers.map((dev, i) => (
                    <tr
                      key={dev.github_login}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-gray-600 text-xs w-5">{i + 1}</span>
                          {dev.avatar_url && (
                            <img
                              src={dev.avatar_url}
                              alt=""
                              className="w-7 h-7 rounded-full"
                            />
                          )}
                          <div>
                            <div className="font-medium text-white">{dev.github_name || dev.github_login}</div>
                            <div className="text-xs text-gray-500">@{dev.github_login}</div>
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
                      <td className="px-4 py-3 text-right">
                        <ComplexityBadge value={dev.avg_complexity} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <PrPercentBadge value={dev.pr_percentage} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <AiPercentBadge value={dev.ai_percentage} />
                      </td>
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
          )}

          {activeReport && developers.length === 0 && activeReport.status === 'completed' && (
            <div className="text-center text-gray-500 py-16">
              No commits found for this org in the selected period.
            </div>
          )}
        </div>
      </div>
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
    n >= 7 ? 'bg-blue-500' :
    n >= 4 ? 'bg-blue-700' :
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
