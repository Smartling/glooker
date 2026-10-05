'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import Link from 'next/link';
import { useIdleAwarePolling } from '@/hooks/use-idle-aware-polling';
import { fromReportStatus } from '@/lib/runs/status';
import { formatRunTime, triggerLabel } from '@/lib/runs/format';
import RunCard, { type RunProgressView } from '@/components/runs/RunCard';
import RunHealthBadge from '@/components/runs/RunHealthBadge';
import RunsToolbar from '@/components/runs/RunsToolbar';
import { useReportProgress } from './use-report-progress';
// Type-only: service.ts imports the DB, so a value import would pull DB drivers into the browser
// bundle (npm run build catches it; jest/tsc alone would not).
import type { ReportListRow } from '@/lib/report/service';

interface Schedule {
  id: number | string;
  org: string;
  period_days: number;
  enabled: number | boolean;
  next_run_at: string | null;
  kind?: 'report' | 'vuln_sync';
}

interface ReportStats {
  developers: number;
  commits: number;
  prs: number;
  linesAdded: number;
  linesRemoved: number;
  avgImpact: number;
  jiraIssues: number | null;
  reviews: number;
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-gray-600 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold text-white">{value}</div>
    </div>
  );
}

function ReportCard({
  r, canAct, isDeleting, onResume, onStop, onDeleteClick, onConfirmDelete, onCancelDelete,
  isExpanded, onToggle, stats, wasObservedRunning, listMutate, anyRunning, onRearmProgress,
}: {
  r: ReportListRow;
  canAct: boolean;
  isDeleting: boolean;
  onResume: () => void;
  onStop: () => void;
  onDeleteClick: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  isExpanded: boolean;
  onToggle: () => void;
  stats: ReportStats | undefined;
  wasObservedRunning: boolean;
  listMutate: () => void;
  anyRunning: boolean;
  // Called the moment this row's status transitions into running/pending (a Resume that succeeded,
  // or a fresh run reusing this id) — clears the shared `finishedFired` guard for this id.
  onRearmProgress: () => void;
}) {
  const isRunningNow = r.status === 'running' || r.status === 'pending';
  const showProgress = isRunningNow || wasObservedRunning;
  const { data: progress, mutate: mutateProgress } = useReportProgress(r.id, showProgress, listMutate);
  const { status, label } = fromReportStatus(r.status);
  const canResume = (r.status === 'failed' || r.status === 'stopped') && !anyRunning;

  // GLOOK-59 final-fix item 1: Resume (or a new run reusing this id) leaves the progress SWR key
  // unchanged — its cached data is still stopped/failed, so `refreshInterval` reads 0 and nothing
  // re-polls, and the hook's once-guard plus the shared `finishedFired` set already hold this id
  // from the earlier finish. On the observable transition into running/pending, re-arm the shared
  // guard and force a real revalidation of the progress key so the card starts polling again.
  const wasRunningRef = useRef(isRunningNow);
  useEffect(() => {
    if (isRunningNow && !wasRunningRef.current) {
      onRearmProgress();
      mutateProgress();
    }
    wasRunningRef.current = isRunningNow;
  }, [isRunningNow, onRearmProgress, mutateProgress]);

  const progressView: RunProgressView | null = progress ? {
    step: progress.step,
    counter: progress.totalDevelopers > 0
      ? `${progress.completedDevelopers} / ${progress.totalDevelopers} developers`
      : progress.completedDevelopers > 0
      ? `${progress.completedDevelopers} developers done`
      : progress.totalRepos > 0
      ? `Fetching: ${progress.processedRepos}/${progress.totalRepos} members`
      : null,
    pct: progress.status === 'completed'
      ? 100
      : progress.completedDevelopers > 0 && progress.totalDevelopers > 0
      ? Math.round((progress.completedDevelopers / progress.totalDevelopers) * 100)
      : 0,
    running: progress.status === 'running' || progress.status === 'pending',
    tone: progress.status === 'failed' ? 'failed' : progress.status === 'stopped' ? 'stopped' : 'normal',
    error: progress.error,
    logs: progress.logs ?? [],
  } : null;

  if (isDeleting) {
    return (
      <div className="bg-red-950 border border-red-800 rounded-xl p-4">
        <p className="text-red-300 text-sm mb-3">Delete this report? This cannot be undone.</p>
        <div className="flex gap-2">
          <button onClick={onConfirmDelete} className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded-lg transition-colors">
            Delete
          </button>
          <button onClick={onCancelDelete} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <RunCard
      status={status}
      label={label}
      subject={`${r.org} · ${r.period_days} days`}
      trigger={triggerLabel(r.trigger_kind, r.triggered_by)}
      startedAt={r.created_at}
      finishedAt={r.completed_at}
      health={<RunHealthBadge health={r.health} />}
      progress={progressView}
      expandable={r.status === 'completed'}
      expanded={isExpanded}
      onToggle={onToggle}
      actions={canAct && (
        <>
          {canResume && (
            <button onClick={onResume} className="px-2 py-1 text-xs font-medium text-accent-light bg-accent/10 hover:bg-accent/30 rounded transition-colors">
              Resume
            </button>
          )}
          {isRunningNow && (
            <button onClick={onStop} className="px-2 py-1 text-xs font-medium text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 rounded transition-colors">
              Stop
            </button>
          )}
          <button onClick={onDeleteClick} className="p-1 rounded text-gray-700 hover:text-red-400 transition-colors" title="Delete report">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </>
      )}
    >
      {!stats ? (
        <div className="text-xs text-gray-500 py-2">Loading stats...</div>
      ) : (
        <>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
            <StatCell label="Developers" value={stats.developers} />
            <StatCell label="Commits" value={stats.commits.toLocaleString()} />
            <StatCell label="PRs" value={stats.prs.toLocaleString()} />
            <StatCell label="Lines +/-" value={
              <>
                <span className="text-green-400">+{stats.linesAdded.toLocaleString()}</span>
                <span className="text-gray-600"> / </span>
                <span className="text-red-400">-{stats.linesRemoved.toLocaleString()}</span>
              </>
            } />
            {stats.jiraIssues !== null && <StatCell label="Jira Issues" value={stats.jiraIssues} />}
            <StatCell label="Avg Impact" value={<span className="text-accent-light">{stats.avgImpact.toFixed(1)}</span>} />
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/report/${r.id}/team`} className="text-xs text-accent-light hover:text-accent-lighter transition-colors font-medium">
              Team Summary &rarr;
            </Link>
            <Link href={`/report/${r.id}/org`} className="text-xs text-accent-light hover:text-accent-lighter transition-colors font-medium">
              Org Summary &rarr;
            </Link>
          </div>
        </>
      )}
    </RunCard>
  );
}

export default function ReportsTab({ canAct, observedRunning, finishedFired }: {
  canAct: boolean;
  observedRunning: Set<string>;
  // Ids whose finish side effect (list mutate + global cache bust) has already run. Owned by the
  // always-mounted ReportsTabs, like `observedRunning`, so it survives ReportsTab unmounting when
  // the syncs tab is shown — without it, switching back remounted every observed-finished card with
  // a fresh in-hook ref, and each refetched its now-finished progress and re-ran the global bust.
  // Optional with a local fallback so a standalone render (e.g. this component's own tests) still works.
  finishedFired?: Set<string>;
}) {
  const { data: reports, mutate } = useSWR<ReportListRow[]>('/api/report', { dedupingInterval: 2_000 });
  const { data: orgsData } = useSWR<Array<{ login: string }>>('/api/orgs');
  const { data: scheduleData } = useSWR<Schedule[]>('/api/schedule');
  const { mutate: globalMutate } = useSWRConfig();

  const orgs = orgsData ?? [];
  const list = reports ?? [];

  const [org, setOrg] = useState('');
  const [period, setPeriod] = useState(30);
  const [showReportForm, setShowReportForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reportStats, setReportStats] = useState<Record<string, ReportStats>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const localFinishedFired = useRef<Set<string>>(new Set());
  const finishedFiredSet = finishedFired ?? localFinishedFired.current;

  useEffect(() => {
    if (orgsData && orgsData.length > 0 && !org) setOrg(orgsData[0].login);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgsData]);

  useEffect(() => {
    if (!reports) return;
    const fresh = reports.filter(r => (r.status === 'running' || r.status === 'pending') && !observedRunning.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) observedRunning.add(r.id);
    forceRender(n => n + 1);
  }, [reports, observedRunning]);

  useIdleAwarePolling(() => mutate(), 30_000, 120_000);

  const anyRunning = list.some(r => r.status === 'running' || r.status === 'pending');

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!reportStats[id]) {
      fetch(`/api/report/${id}`)
        .then(r => r.json())
        .then(data => {
          if (data?.developers) {
            const devs = data.developers;
            const hasJira = devs.some((d: any) => (d.total_jira_issues ?? 0) > 0);
            setReportStats(prev => ({
              ...prev,
              [id]: {
                developers: devs.length,
                commits: devs.reduce((s: number, d: any) => s + d.total_commits, 0),
                prs: devs.reduce((s: number, d: any) => s + d.total_prs, 0),
                linesAdded: devs.reduce((s: number, d: any) => s + d.lines_added, 0),
                linesRemoved: devs.reduce((s: number, d: any) => s + d.lines_removed, 0),
                avgImpact: devs.length > 0
                  ? devs.reduce((s: number, d: any) => s + Number(d.impact_score || 0), 0) / devs.length
                  : 0,
                jiraIssues: hasJira ? devs.reduce((s: number, d: any) => s + (d.total_jira_issues ?? 0), 0) : null,
                reviews: devs.reduce((s: number, d: any) => s + (d.total_reviews ?? 0), 0),
              },
            }));
          }
        })
        .catch(() => {});
    }
  }

  // Called at most once per report id — a finished report's card can remount (unmounted while the
  // syncs tab is shown, remounted on return) and its progress poll will resolve "finished" again on
  // remount, but the global cache bust must not re-run every time that happens.
  function handleFinish(id: string) {
    if (finishedFiredSet.has(id)) return;
    finishedFiredSet.add(id);
    mutate();
    globalMutate(() => true, undefined, { revalidate: true });
  }

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (!org.trim()) return;
    setActionError(null);
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org: org.trim(), periodDays: period, testMode: new URLSearchParams(window.location.search).get('test') === '1' }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error || `HTTP ${res.status}`);
      return;
    }
    setShowReportForm(false);
    mutate();
  }

  async function deleteReport(id: string) {
    setActionError(null);
    const res = await fetch(`/api/report/${id}`, { method: 'DELETE' });
    setDeletingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error || `HTTP ${res.status}`);
      return;
    }
    mutate();
  }

  async function stopReport(id: string) {
    setActionError(null);
    const res = await fetch(`/api/report/${id}/stop`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error || `HTTP ${res.status}`);
      return;
    }
    mutate();
  }

  async function resumeReport(id: string) {
    setActionError(null);
    const res = await fetch(`/api/report/${id}/resume`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error || `HTTP ${res.status}`);
      return;
    }
    mutate();
  }

  const nextScheduled = useMemo(() => {
    const enabled = (scheduleData ?? []).filter(s => s.kind !== 'vuln_sync' && Boolean(s.enabled) && s.next_run_at);
    if (enabled.length === 0) return null;
    return enabled.reduce((a, b) => (new Date(a.next_run_at!).getTime() <= new Date(b.next_run_at!).getTime() ? a : b));
  }, [scheduleData]);

  const info = nextScheduled
    ? (
      <>
        {`Next scheduled: ${nextScheduled.org} · ${nextScheduled.period_days}d · ${formatRunTime(nextScheduled.next_run_at)}`}
        {canAct && <> · <Link href="/settings#schedules" className="text-accent-light hover:text-accent-lighter">Manage schedules</Link></>}
      </>
    )
    : 'No report schedule';

  return (
    <div>
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
              <form onSubmit={handleRun}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-medium">GitHub Org</label>
                    <select
                      value={org}
                      onChange={(e) => setOrg(e.target.value)}
                      disabled={anyRunning || orgs.length === 0}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
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
                          disabled={anyRunning}
                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            period === d ? 'bg-accent text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
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
                    disabled={!org.trim() || anyRunning}
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

      <RunsToolbar
        info={info}
        action={canAct && (
          <button
            onClick={() => setShowReportForm(true)}
            disabled={orgs.length === 0 || anyRunning}
            title={anyRunning ? 'A report is currently running' : undefined}
            className="px-4 py-2 bg-accent hover:bg-accent-dark disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {anyRunning ? 'Report running…' : '+ New report'}
          </button>
        )}
        error={actionError}
      />

      <div className="space-y-2">
        {list.length === 0 && (
          <div className="text-center text-gray-500 py-16">
            <p className="mb-2">No reports yet</p>
            <p className="text-xs text-gray-600">Click &quot;+ New report&quot; to generate your first developer impact report.</p>
          </div>
        )}
        {list.map((r) => (
          <ReportCard
            key={r.id}
            r={r}
            canAct={canAct}
            isDeleting={deletingId === r.id}
            onResume={() => resumeReport(r.id)}
            onStop={() => stopReport(r.id)}
            onDeleteClick={() => setDeletingId(r.id)}
            onConfirmDelete={() => deleteReport(r.id)}
            onCancelDelete={() => setDeletingId(null)}
            isExpanded={expandedId === r.id}
            onToggle={() => toggleExpand(r.id)}
            stats={reportStats[r.id]}
            wasObservedRunning={observedRunning.has(r.id)}
            listMutate={() => handleFinish(r.id)}
            anyRunning={anyRunning}
            onRearmProgress={() => finishedFiredSet.delete(r.id)}
          />
        ))}
      </div>
    </div>
  );
}
