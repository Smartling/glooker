'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import LlmFindings from './llm-findings';
import ChatPanel from './chat-panel';
import { useAuth } from './auth-context';

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

interface Progress {
  status:              string;
  step:                string;
  totalRepos:          number;
  processedRepos:      number;
  totalDevelopers:     number;
  completedDevelopers: number;
  error?:              string;
  logs?:               string[];
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
  const { canAct, ...auth } = useAuth();
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
  const commitCache = useRef<Map<string, any[]>>(new Map());
  const jiraCache = useRef<Map<string, any[]>>(new Map());
  const [filterLogins, setFilterLogins] = useState<Set<string>>(new Set());
  const [filterQuery, setFilterQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterHighlight, setFilterHighlight] = useState(0);
  const [teams, setTeams] = useState<Array<{ id: string; name: string; color: string; members: string[] }>>([]);
  const generationRef = useRef(0);
  const lastCompletedDevsRef = useRef(0);

  const [showReportForm, setShowReportForm] = useState(false);

  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // Initialize sidebar state from localStorage (must run client-side)
  useEffect(() => {
    const stored = localStorage.getItem('glooker-sidebar-expanded');
    if (stored === 'true') setSidebarExpanded(true);
  }, []);

  function toggleSidebar() {
    setSidebarExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('glooker-sidebar-expanded', String(next));
      return next;
    });
  }

  // Load orgs and past reports on mount
  useEffect(() => {
    fetch('/api/orgs')
      .then((r) => r.json())
      .then((data: Array<{ login: string; avatar_url: string }>) => {
        setOrgs(data);
        if (data.length > 0 && !org) setOrg(data[0].login);
      })
      .catch((err) => console.error('[glooker]', err));
    fetch('/api/report')
      .then((r) => r.json())
      .then(setPastReports)
      .catch((err) => console.error('[glooker]', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll reports list to pick up scheduled reports
  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/report')
        .then((r) => r.json())
        .then((reports: Report[]) => {
          setPastReports(reports);
          // If viewing a report that changed status, update it
          if (activeReport) {
            const updated = reports.find((r: Report) => r.id === activeReport.id);
            if (updated && updated.status !== activeReport.status) {
              setActiveReport((prev) => prev ? { ...prev, status: updated.status, completed_at: updated.completed_at } : prev);
              // If a report just completed and we're viewing it, load the full data
              if (updated.status === 'completed' && activeReport.status === 'running') {
                fetch(`/api/report/${updated.id}`).then((r) => r.json()).then((data) => {
                  setDevelopers(data.developers || []);
                  setActiveReport(data.report);
                }).catch((err) => console.error('[glooker] Failed to load completed report:', err));
              }
            }
          }
        })
        .catch((err) => console.error('[glooker]', err));
    }, 5000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReport?.id, activeReport?.status]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(id: string) {
    stopPolling();
    const gen = ++generationRef.current;
    lastCompletedDevsRef.current = 0;

    pollRef.current = setInterval(async () => {
      if (gen !== generationRef.current) return; // stale generation
      try {
        const prog = await fetch(`/api/report/${id}/progress`).then((r) => r.json());
        if (gen !== generationRef.current) return; // stale after await
        setProgress(prog);
        if (prog.logs) setLogs(prog.logs);

        // Fetch developers progressively when completedDevelopers increases
        if (prog.completedDevelopers > lastCompletedDevsRef.current) {
          lastCompletedDevsRef.current = prog.completedDevelopers;
          const data = await fetch(`/api/report/${id}`).then((r) => r.json());
          if (gen !== generationRef.current) return; // stale after await
          if (data.developers?.length > 0) {
            setDevelopers(data.developers);
            if (data.report) setActiveReport(data.report);
          }
        }

        if (prog.status === 'completed' || prog.status === 'failed' || prog.status === 'stopped') {
          stopPolling();
          setRunning(false);
          if (prog.status === 'completed') {
            const data = await fetch(`/api/report/${id}`).then((r) => r.json());
            if (gen !== generationRef.current) return;
            setDevelopers(data.developers || []);
            setActiveReport(data.report);
            // Refresh past reports list
            fetch('/api/report').then((r) => r.json()).then(setPastReports).catch((err) => console.error('[glooker]', err));
          } else if (prog.status === 'stopped') {
            // On stop, also refresh the developer list from DB (partial results)
            const data = await fetch(`/api/report/${id}`).then((r) => r.json());
            if (gen !== generationRef.current) return;
            if (data.developers?.length > 0) setDevelopers(data.developers);
            if (data.report) setActiveReport(data.report);
            fetch('/api/report').then((r) => r.json()).then(setPastReports).catch((err) => console.error('[glooker]', err));
          }
        }
      } catch (err) {
        console.error('[glooker] Polling error:', err);
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
      body:    JSON.stringify({ org: org.trim(), periodDays: period, testMode: new URLSearchParams(window.location.search).get('test') === '1' }),
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
    // Load teams for this org
    if (data.report?.org) {
      fetch(`/api/teams?org=${data.report.org}`).then(r => r.json()).then(setTeams).catch(() => {});
    }

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
      setLogs([]);
      setProgress(null);
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

  const pct = progress && progress.totalDevelopers > 0
    ? Math.round((progress.completedDevelopers / progress.totalDevelopers) * 100)
    : progress?.status === 'completed' ? 100 : 0;

  function formatCompactTime(dateStr: string): string {
    const d = new Date(dateStr);
    let h = d.getHours();
    const m = d.getMinutes();
    const suffix = h >= 12 ? 'p' : 'a';
    h = h % 12 || 12;
    return m === 0 ? `${h}${suffix}` : `${h}:${String(m).padStart(2, '0')}${suffix}`;
  }

  function statusBorderClass(status: string): string {
    switch (status) {
      case 'completed': return 'border-l-amber-500';
      case 'failed':    return 'border-l-red-500';
      case 'stopped':   return 'border-l-orange-500';
      case 'running':   return 'border-l-amber-300';
      default:          return 'border-l-gray-600';
    }
  }

  function statusOutlineClass(status: string): string {
    switch (status) {
      case 'completed': return 'ring-1 ring-amber-500/60';
      case 'failed':    return 'ring-1 ring-red-500/60';
      case 'stopped':   return 'ring-1 ring-orange-500/60';
      case 'running':   return 'ring-1 ring-amber-300/60';
      default:          return 'ring-1 ring-gray-600/60';
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white cursor-pointer hover:text-accent-light transition-colors" onClick={() => { setActiveReport(null); setDevelopers([]); setProgress(null); setRunning(false); stopPolling(); }}>Glooker</h1>
          <p className="text-gray-400 mt-1">GitHub org developer impact analytics</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => window.location.href = '/settings'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 bg-gray-900 hover:bg-gray-800 rounded-lg border border-gray-800 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
          {auth.enabled && auth.user && !auth.loading && (
            <a
              href="/profile"
              className="flex items-center gap-2 pl-1 pr-3 py-1 bg-gray-900 hover:bg-gray-800 rounded-full border border-gray-800 transition-colors"
            >
              {auth.user.avatarUrl ? (
                <img src={auth.user.avatarUrl} alt="" className="w-7 h-7 rounded-full border-2 border-gray-700" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400">
                  {(auth.user.name || auth.user.email)[0].toUpperCase()}
                </div>
              )}
              <span className="text-xs font-medium text-gray-300">
                {auth.user.githubLogin || auth.user.email}
              </span>
            </a>
          )}
        </div>
      </div>

      <div className={`flex ${sidebarExpanded ? 'gap-8' : 'gap-4'}`}>
        {/* Sidebar: past reports */}
        <div
          className={`shrink-0 no-print transition-all duration-300 ease-in-out overflow-hidden ${
            sidebarExpanded ? 'w-60' : 'w-[52px]'
          }`}
        >
          {!sidebarExpanded ? (
            <div className="flex flex-col items-center gap-1.5 pt-1">
              {/* Expand toggle */}
              <button
                onClick={toggleSidebar}
                className="w-9 h-7 flex items-center justify-center rounded-md bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors mb-1"
                title="Expand sidebar"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {/* + New button */}
              <button
                onClick={() => setShowReportForm(true)}
                disabled={orgs.length === 0}
                className="w-9 h-6 flex items-center justify-center rounded border border-dashed border-gray-700 hover:border-accent-light text-accent-light hover:text-accent-lighter disabled:text-gray-700 disabled:border-gray-800 disabled:cursor-not-allowed transition-colors mb-1"
                title="New report"
              >
                <span className="text-sm leading-none">+</span>
              </button>
              {/* Report date cards */}
              {pastReports.map((r) => {
                const isActive = activeReport?.id === r.id;
                const created = new Date(r.created_at);
                const month = created.toLocaleString('en-US', { month: 'short' });
                const day = created.getDate();
                const time = formatCompactTime(r.created_at);
                const tooltip = `${r.org} — ${r.status === 'completed' ? 'done' : r.status}\n${r.period_days} days\n${created.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;

                return (
                  <button
                    key={r.id}
                    onClick={() => loadReport(r.id)}
                    className={`w-9 rounded text-center border-l-2 ${statusBorderClass(r.status)} ${
                      isActive ? `bg-gray-800 ${statusOutlineClass(r.status)}` : 'bg-gray-800/50 hover:bg-gray-800'
                    } py-1.5 transition-colors`}
                    title={tooltip}
                  >
                    <div className="text-[9px] leading-tight text-gray-500">{month}</div>
                    <div className="text-[10px] leading-tight font-semibold text-gray-200">{day}</div>
                    <div className="text-[7px] leading-tight text-gray-600 mt-px">{time}</div>
                  </button>
                );
              })}
              {pastReports.length === 0 && (
                <p className="text-gray-700 text-[8px] text-center mt-1">No reports</p>
              )}
            </div>
          ) : (
            <>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSidebar}
                className="text-gray-500 hover:text-gray-300 transition-colors"
                title="Collapse sidebar"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Reports</p>
            </div>
            <button
              onClick={() => setShowReportForm(true)}
              disabled={orgs.length === 0}
              className="text-xs text-accent-light hover:text-accent-lighter disabled:text-gray-600 disabled:cursor-not-allowed"
            >
              + New
            </button>
          </div>
          <div className="space-y-1.5">
            {pastReports.length === 0 && (
              <p className="text-gray-600 text-sm">No reports yet</p>
            )}
            {pastReports.map((r) => {
              const isActive   = activeReport?.id === r.id;
              const isDeleting = deletingId === r.id;
              const statusColor =
                r.status === 'completed' ? 'text-accent-light' :
                r.status === 'failed'    ? 'text-red-400' :
                r.status === 'stopped'   ? 'text-orange-400' :
                r.status === 'running'   ? 'text-accent-lighter' :
                'text-gray-500';
              const borderColor =
                r.status === 'completed' ? 'border-accent-darker' :
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
                          {canAct && canResume && (
                            <span
                              role="button"
                              onClick={(e) => { e.stopPropagation(); resumeReport(r.id); }}
                              className="text-xs font-medium text-accent-light hover:text-accent-lighter cursor-pointer"
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
            </>
          )}

        </div>

        {/* Main content */}
        {/* Run report modal */}
        {showReportForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowReportForm(false)} />
            <div className="relative bg-gray-900 rounded-xl p-6 w-full max-w-lg border border-gray-800 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">New Report</h3>
                <button onClick={() => setShowReportForm(false)} className="text-gray-500 hover:text-gray-300">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {canAct && (
              <form onSubmit={(e) => { handleRun(e); setShowReportForm(false); }}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-medium">GitHub Org</label>
                    <select
                      value={org}
                      onChange={(e) => setOrg(e.target.value)}
                      disabled={running || orgs.length === 0}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
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
                              ? 'bg-accent text-white'
                              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                          }`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button
                    type="submit"
                    disabled={!org.trim() || running}
                    className="px-5 py-2 bg-accent hover:bg-accent-dark disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Run Report
                  </button>
                </div>
              </form>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Stop button for running report */}
          {canAct && running && (
            <div className="bg-gray-900 rounded-xl p-5 mb-6 flex items-center justify-between">
              <span className="text-sm text-gray-300">Report is running…</span>
              <button
                type="button"
                onClick={() => reportId && stopReport(reportId)}
                className="px-5 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Stop
              </button>
            </div>
          )}

          {/* Progress */}
          {(running || (progress && (progress.status === 'failed' || progress.status === 'stopped'))) && progress && (
            <div className="bg-gray-900 rounded-xl p-5 mb-6 no-print">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-300">{progress.step}</span>
                {progress.totalDevelopers > 0 ? (
                  <span className="text-gray-500">
                    {progress.completedDevelopers} / {progress.totalDevelopers} developers
                  </span>
                ) : progress.completedDevelopers > 0 ? (
                  <span className="text-gray-500">
                    {progress.completedDevelopers} developers done
                  </span>
                ) : null}
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    progress.status === 'failed' ? 'bg-red-500' : progress.status === 'stopped' ? 'bg-orange-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.max(pct, running ? 2 : 0)}%` }}
                />
              </div>
              {progress.totalRepos > 0 && progress.totalDevelopers === 0 && (
                <p className="text-xs text-gray-600 mt-2">
                  Fetching: {progress.processedRepos}/{progress.totalRepos} members
                </p>
              )}
              {progress.error && (
                <p className="text-xs text-red-400 mt-2">{progress.error}</p>
              )}
            </div>
          )}

          {/* Log panel */}
          {logs.length > 0 && (
            <div className="bg-gray-900 rounded-xl mb-6 overflow-hidden no-print">
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
                          ? 'text-accent-light'
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
                    <th className="px-4 py-3 text-right w-[7%]">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDevs.map((dev, i) => (
                    <tr
                      key={dev.github_login}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                      onClick={() => { if (activeReport) window.location.href = `/report/${activeReport.id}/dev/${dev.github_login}`; }}
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
                          reportId={reportId || activeReport?.id || ''}
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
                              reportId={reportId || activeReport?.id || ''}
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

          {!activeReport && !running && pastReports.length === 0 && (
            <div className="text-center text-gray-500 py-16">
              Create or schedule your first report
            </div>
          )}

          {!activeReport && !running && (
            <LlmFindings />
          )}

        </div>
      </div>
      {org && <ChatPanel org={org} />}
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
