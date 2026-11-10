'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth-context';
import type { CanonicalBuild } from '@/lib/canonical/state';
import type { RebuildProgress } from '@/lib/canonical/progress';
import type { CanonicalOrgCheck, CanonicalCheckTable } from '@/lib/canonical/rebuild';

interface Status {
  builds: CanonicalBuild[];
  orgs?: string[];
  lock: { startedAt: string; holder: string } | null;
  progress: RebuildProgress;
}

const POLL_MS = 2000;
/** Slower poll while the lock is held by a rebuild this server is not running (CLI, another instance). */
const POLL_ELSEWHERE_MS = 15000;

export default function CanonicalCard() {
  const { canAct } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<CanonicalOrgCheck[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/settings/canonical');
      if (!res.ok) return false;
      setStatus(await res.json());
      return true;
    } catch { return false; /* keep last status */ }
  }, []);

  useEffect(() => {
    if (canAct) void load();
  }, [canAct, load]);

  const runningHere = started || !!status?.progress?.running;
  // The lock is held but not by this server's rebuild: the CLI, another instance, or a crashed run
  // whose lock has not gone stale yet.
  const lockedElsewhere = !runningHere && !!status?.lock;
  const running = runningHere || lockedElsewhere;

  useEffect(() => {
    if (!canAct || !running) return;
    const t = setInterval(async () => {
      await load();
    }, runningHere ? POLL_MS : POLL_ELSEWHERE_MS);
    return () => clearInterval(t);
  }, [canAct, running, runningHere, load]);

  if (!canAct) return null;

  async function runCheck() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/canonical/check');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || 'Check failed');
      else setCheck(data.orgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  async function runRebuild() {
    setConfirming(false);
    setError(null);
    setCheck(null);
    try {
      const res = await fetch('/api/settings/canonical/rebuild', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) setError(data.error || 'rebuild already running');
      else if (!res.ok) setError(data.error || 'Rebuild failed to start');
      else setStarted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // Any status read after the POST is authoritative, so the bridging flag
    // can never outlive a rebuild that finished before the first read.
    if (await load()) setStarted(false);
  }

  const progress = status?.progress;
  const orgList = status
    ? [...new Set([...(status.orgs ?? []), ...status.builds.map(b => b.org)])].sort()
    : [];
  const failed = (progress?.results ?? []).filter(r => !r.ok);
  const btn = 'px-4 py-2 text-sm font-medium rounded transition-colors disabled:opacity-50';

  return (
    <div className="bg-gray-900 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-1">De-duplicated data</h2>
      <p className="text-xs text-gray-500 mb-4">
        One copy of each commit and Jira issue, used by the 90-day and 12-month views.
      </p>

      {status && (
        <div className="space-y-1 mb-4">
          {orgList.map(org => {
            const b = status.builds.find(x => x.org === org);
            return (
              <div key={org} className="text-xs text-gray-400">
                <span className="text-gray-300 mr-2">{org}</span>
                <span>{b
                  ? `Last rebuild ${new Date(b.builtAt).toLocaleString()} · took ${(b.durationMs / 1000).toFixed(1)}s · ${b.commitRows} commits, ${b.jiraRows} issues`
                  : 'Not built yet — range views use the slower path'}</span>
              </div>
            );
          })}
        </div>
      )}

      {runningHere && (
        <div className="text-xs text-gray-300 mb-3">
          {`Rebuilding… ${progress?.orgsDone ?? 0}/${progress?.orgsTotal ?? 0} orgs`}
        </div>
      )}
      {lockedElsewhere && status?.lock && (
        <div className="text-xs text-gray-300 mb-3">
          {`A rebuild started elsewhere holds the lock (${status.lock.holder}, last active ${new Date(status.lock.startedAt).toLocaleString()}). It is released when that rebuild ends, or after 30 minutes without activity.`}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={runCheck}
          disabled={running || checking}
          className={`${btn} bg-gray-800 hover:bg-gray-700 text-white`}
        >
          Check
        </button>
        <button
          onClick={() => setConfirming(true)}
          disabled={running}
          className={`${btn} bg-accent hover:bg-accent-hover text-white`}
        >
          Rebuild
        </button>
      </div>

      {confirming && !running && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-gray-300">Rebuild both tables for every org? Range views keep working during the rebuild.</span>
          <button onClick={runRebuild} className={`${btn} bg-accent hover:bg-accent-hover text-white`}>Confirm rebuild</button>
          <button onClick={() => setConfirming(false)} className={`${btn} bg-gray-800 hover:bg-gray-700 text-white`}>Cancel</button>
        </div>
      )}

      {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
      {progress?.error && <div className="mt-3 text-xs text-red-400">{progress.error}</div>}
      {failed.map(r => (
        <div key={r.org} className="mt-1 text-xs text-red-400">{`${r.org}: ${r.error}`}</div>
      ))}

      {check && (
        <div className="mt-4 space-y-3">
          {check.map(o => (
            <div key={o.org}>
              <div className="text-xs text-gray-300 mb-1">{o.org}</div>
              <table className="text-xs text-gray-400 w-full">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="font-normal pr-4"></th>
                    <th className="font-normal pr-4">Stored</th>
                    <th className="font-normal pr-4">Expected</th>
                    <th className="font-normal">Differ</th>
                  </tr>
                </thead>
                <tbody>
                  <CheckRow label="Commits" t={o.commits} />
                  <CheckRow label="Jira issues" t={o.jira} />
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckRow({ label, t }: { label: string; t: CanonicalCheckTable }) {
  return (
    <>
      <tr>
        <td className="pr-4 text-gray-300">{label}</td>
        <td className="pr-4">{t.stored}</td>
        <td className="pr-4">{t.expected}</td>
        <td>{t.differ}</td>
      </tr>
      {t.differ > 0 && (
        <tr>
          <td colSpan={4} className="text-gray-500 break-all">{'Examples: ' + t.examples.join(', ')}</td>
        </tr>
      )}
    </>
  );
}
