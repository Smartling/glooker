'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth-context';
import { useIdleAwarePolling } from '@/hooks/use-idle-aware-polling';

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

export default function ReportsPage() {
  const { canAct } = useAuth();

  // Report generation state
  const [org, setOrg]               = useState('');
  const [period, setPeriod]         = useState(30);
  const [running, setRunning]       = useState(false);
  const [reportId, setReportId]     = useState<string | null>(null);
  const [progress, setProgress]     = useState<Progress | null>(null);

  // Report list state
  const [pastReports, setPastReports]   = useState<Report[]>([]);
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [orgs, setOrgs]             = useState<Array<{ login: string; avatar_url: string }>>([]);

  // Logs
  const [logs, setLogs]             = useState<string[]>([]);
  const [showLogs, setShowLogs]     = useState(true);

  // Form visibility
  const [showReportForm, setShowReportForm] = useState(false);

  // Refs
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const lastCompletedDevsRef = useRef(0);
  const activeReportRef = useRef<Report | null>(null);

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

  useEffect(() => { activeReportRef.current = activeReport; }, [activeReport]);

  // Poll reports list to pick up scheduled reports (idle-aware, 30s)
  function fetchReportList() {
    fetch('/api/report')
      .then((r) => r.json())
      .then((reports: Report[]) => {
        setPastReports(reports);
        const current = activeReportRef.current;
        if (current) {
          const updated = reports.find((r: Report) => r.id === current.id);
          if (updated && updated.status !== current.status) {
            setActiveReport((prev) => prev ? { ...prev, status: updated.status, completed_at: updated.completed_at } : prev);
            if (updated.status === 'completed' && current.status === 'running') {
              setRunning(false);
            }
          }
        }
      })
      .catch((err) => console.error('[glooker]', err));
  }
  useIdleAwarePolling(fetchReportList, 30_000, 120_000);

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
      if (gen !== generationRef.current) return;
      try {
        const prog = await fetch(`/api/report/${id}/progress`).then((r) => r.json());
        if (gen !== generationRef.current) return;
        setProgress(prog);
        if (prog.logs) setLogs(prog.logs);

        if (prog.status === 'completed' || prog.status === 'failed' || prog.status === 'stopped') {
          stopPolling();
          setRunning(false);
          // Refresh past reports list
          fetch('/api/report').then((r) => r.json()).then(setPastReports).catch((err) => console.error('[glooker]', err));
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
    // Add to list immediately
    const newReport: Report = {
      id: data.reportId,
      org: org.trim(),
      period_days: period,
      status: 'running',
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    setPastReports((prev) => [newReport, ...prev]);
    setActiveReport(newReport);
    startPolling(data.reportId);
  }

  async function deleteReport(id: string) {
    await fetch(`/api/report/${id}`, { method: 'DELETE' });
    setPastReports((prev) => prev.filter((r) => r.id !== id));
    setDeletingId(null);
    if (activeReport?.id === id) {
      setActiveReport(null);
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

    setActiveReport((prev) => {
      const found = pastReports.find((r) => r.id === id);
      return found ? { ...found, status: 'running' } : prev;
    });
    startPolling(id);
  }

  function viewReport(id: string) {
    window.location.href = `/report/${id}/org`;
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

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-white">Report History</h1>
          <p className="text-xs text-gray-500 mt-0.5">Generate and manage developer impact reports</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/settings#schedule" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Schedule
          </a>
          {canAct && (
            <button
              onClick={() => setShowReportForm(true)}
              disabled={orgs.length === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              + New Report
            </button>
          )}
        </div>
      </div>

      {/* New report modal */}
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
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    {orgs.length === 0 && <option value="">Loading...</option>}
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
                            ? 'bg-indigo-600 text-white'
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
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Run Report
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}

      {/* Running report progress */}
      {running && reportId && (
        <div className="bg-gray-900 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-300">Report is running...</span>
            {canAct && (
              <button
                type="button"
                onClick={() => reportId && stopReport(reportId)}
                className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition-colors"
              >
                Stop
              </button>
            )}
          </div>
          {progress && (
            <>
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
                    progress.status === 'failed' ? 'bg-red-500' : progress.status === 'stopped' ? 'bg-orange-500' : 'bg-indigo-500'
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
            </>
          )}
        </div>
      )}

      {/* Failed/stopped progress (when not running anymore) */}
      {!running && progress && (progress.status === 'failed' || progress.status === 'stopped') && (
        <div className="bg-gray-900 rounded-xl p-5 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-300">{progress.step}</span>
            <span className={`text-xs font-medium ${progress.status === 'failed' ? 'text-red-400' : 'text-orange-400'}`}>
              {progress.status}
            </span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${progress.status === 'failed' ? 'bg-red-500' : 'bg-orange-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
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
                      ? 'text-indigo-400'
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

      {/* Report list */}
      <div className="space-y-2">
        {pastReports.length === 0 && !running && (
          <div className="text-center text-gray-500 py-16">
            <p className="mb-2">No reports yet</p>
            <p className="text-xs text-gray-600">Click &quot;+ New Report&quot; to generate your first developer impact report.</p>
          </div>
        )}
        {pastReports.map((r) => {
          const isDeleting = deletingId === r.id;
          const statusColor =
            r.status === 'completed' ? 'text-green-400' :
            r.status === 'failed'    ? 'text-red-400' :
            r.status === 'stopped'   ? 'text-orange-400' :
            r.status === 'running'   ? 'text-indigo-400' :
            'text-gray-500';
          const statusBg =
            r.status === 'completed' ? 'bg-green-500/10' :
            r.status === 'failed'    ? 'bg-red-500/10' :
            r.status === 'stopped'   ? 'bg-orange-500/10' :
            r.status === 'running'   ? 'bg-indigo-500/10' :
            'bg-gray-800';
          const canResume = (r.status === 'failed' || r.status === 'stopped') && !running;

          if (isDeleting) {
            return (
              <div key={r.id} className="bg-red-950 border border-red-800 rounded-xl p-4">
                <p className="text-red-300 text-sm mb-3">Delete this report? This cannot be undone.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => deleteReport(r.id)}
                    className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setDeletingId(null)}
                    className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={r.id}
              className="group bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors cursor-pointer"
              onClick={() => viewReport(r.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor} ${statusBg}`}>
                    {r.status === 'completed' ? 'done' : r.status}
                  </span>
                  <span className="font-medium text-white">{r.org}</span>
                  <span className="text-sm text-gray-500">{r.period_days} days</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-600">
                    {new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    {canAct && canResume && (
                      <button
                        onClick={() => resumeReport(r.id)}
                        className="px-2 py-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 rounded transition-colors"
                      >
                        Resume
                      </button>
                    )}
                    {canAct && r.status === 'running' && (
                      <button
                        onClick={() => stopReport(r.id)}
                        className="px-2 py-1 text-xs font-medium text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 rounded transition-colors"
                      >
                        Stop
                      </button>
                    )}
                    {canAct && (
                      <button
                        onClick={() => setDeletingId(r.id)}
                        className="p-1 rounded text-gray-700 hover:text-red-400 transition-colors"
                        title="Delete report"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
