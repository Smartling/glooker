import { Cron } from 'croner';
import db from '../db/index';
import { getGitHubProvider } from '../github';
import { insertRunningSync, runSync } from './sync';
import { getVulnerabilitiesOrg, getSyncSchedule } from './config';
import { toIsoSecond } from './time';
import type { TriggerKind } from './types';

// globalThis so the flag and the job survive Next.js HMR. Assumes a single app
// instance, the same as report schedules (spec: Non-goals).
const g = globalThis as typeof globalThis & {
  __glooker_vuln_sync_running?: boolean;
  __glooker_vuln_job?: Cron;
  __glooker_vuln_init?: boolean;
};

export function isSyncRunning(): boolean {
  return g.__glooker_vuln_sync_running === true;
}

export async function startSync(trigger: TriggerKind, triggeredBy: string | null):
  Promise<{ status: 'started'; syncId: number } | { status: 'already-running' } | { status: 'disabled' }> {
  const org = getVulnerabilitiesOrg();
  if (!org) return { status: 'disabled' };
  // Checked and set synchronously, BEFORE the first await, so two concurrent triggers can't both pass.
  if (g.__glooker_vuln_sync_running) return { status: 'already-running' };
  g.__glooker_vuln_sync_running = true;
  let syncId: number;
  try {
    // Watchdog: a HUNG run in THIS process is not what this covers. A
    // sync stuck on a slow GitHub request keeps `__glooker_vuln_sync_running` (and so
    // `isSyncRunning()`) true for as long as those requests take to time out — github.ts's
    // VULN_GITHUB_TIMEOUT_MS per request, on top of withRetry's retries — and then clears itself
    // normally when the run's promise settles. No watchdog involvement, and nothing here shortens
    // that wait. What this 2h sweep cleans up is a `running` row orphaned by a DIFFERENT (or dead)
    // process: this same app crashing or being killed mid-run and restarted by something other
    // than a fresh boot (which would otherwise go through initVulnerabilityScheduler's own
    // cleanup), or another instance's row despite the single-instance assumption. We just passed
    // the `already-running` check above, so this process has no sync of its own in flight; any
    // `running` row still older than 2h at this point can only be one of those orphans, and
    // cleaning it up here, right before starting a new one, keeps it from sitting forever.
    const cutoff = toIsoSecond(new Date(Date.now() - 2 * 3600 * 1000));
    await db.execute(
      `UPDATE vulnerability_syncs SET status = 'failed', finished_at = ?, issues = ? WHERE org = ? AND status = 'running' AND started_at < ?`,
      [toIsoSecond(new Date()), JSON.stringify([{ kind: 'watchdog', message: 'marked failed: still running after 2h' }]), org, cutoff],
    );
    syncId = await insertRunningSync(org, trigger, triggeredBy);
  } catch (err) {
    g.__glooker_vuln_sync_running = false;
    throw err;
  }
  // getGitHubProvider() and the runSync dispatch are wrapped so a synchronous throw here (e.g. no
  // token configured) can't leave the running flag stuck true forever — nothing would otherwise
  // ever attach the .finally() that clears it.
  try {
    const source = getGitHubProvider();
    void runSync(syncId, org, source)
      .catch(err => console.error('[vuln-sync] unexpected failure:', err))
      .finally(() => { g.__glooker_vuln_sync_running = false; });
  } catch (err) {
    g.__glooker_vuln_sync_running = false;
    const message = err instanceof Error ? err.message : String(err);
    try {
      await db.execute(`UPDATE vulnerability_syncs SET status = 'failed', finished_at = ?, issues = ? WHERE id = ?`,
        [toIsoSecond(new Date()), JSON.stringify([{ kind: 'fetch', message }]), syncId]);
    } catch (dbErr) {
      console.error('[vuln-sync] failed to mark sync row failed after a dispatch error:', dbErr);
    }
    throw err;
  }
  return { status: 'started', syncId };
}

export async function initVulnerabilityScheduler(): Promise<void> {
  if (g.__glooker_vuln_init) return;
  const org = getVulnerabilitiesOrg();
  if (!org) return;
  try {
    await db.execute(
      `UPDATE vulnerability_syncs SET status = 'failed', finished_at = ?, issues = ? WHERE status = 'running'`,
      [toIsoSecond(new Date()), JSON.stringify([{ kind: 'restart', message: 'interrupted by restart' }])],
    );
    const { cron, tz } = getSyncSchedule();
    g.__glooker_vuln_job?.stop();
    g.__glooker_vuln_job = new Cron(cron, { timezone: tz }, async () => {
      try {
        const r = await startSync('schedule', null);
        if (r.status === 'already-running') console.log('[vuln-sync] scheduled tick skipped: a sync is already running');
      } catch (err) {
        console.error('[vuln-sync] scheduled tick failed:', err);
      }
    });
    g.__glooker_vuln_init = true;
    console.log(`[vuln-sync] scheduled ${cron} (${tz}) for ${org}`);
  } catch (err) {
    console.error('[vuln-sync] scheduler init failed:', err);
  }
}

export function getNextSyncRun(): string | null {
  const next = g.__glooker_vuln_job?.nextRun();
  return next ? toIsoSecond(next) : null;
}
