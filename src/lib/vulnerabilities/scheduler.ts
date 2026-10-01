import { v4 as uuidv4 } from 'uuid';
import db from '../db/index';
import { getGitHubProvider } from '../github';
import { insertRunningSync, runSync } from './sync';
import { getVulnerabilitiesOrg, getSyncSchedule } from './config';
import { initSyncProgress, updateSyncProgress } from './progress';
import { toIsoSecond } from './time';
import type { TriggerKind } from './types';
import type { Schedule } from '../schedule/manager';

// globalThis so the flag and the job survive Next.js HMR. Assumes a single app
// instance, the same as report schedules (spec: Non-goals).
const g = globalThis as typeof globalThis & {
  __glooker_vuln_sync_running?: boolean;
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
    initSyncProgress(syncId);
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
      .catch(err => {
        console.error('[vuln-sync] unexpected failure:', err);
        // Reachable when runSync's own failure write throws (e.g. the DB is down): the row can't be
        // updated either, but the in-memory progress must not keep claiming `running`.
        updateSyncProgress(syncId, { status: 'failed', step: 'Failed' });
      })
      .finally(() => { g.__glooker_vuln_sync_running = false; });
  } catch (err) {
    g.__glooker_vuln_sync_running = false;
    updateSyncProgress(syncId, { status: 'failed', step: 'Failed' });
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

/**
 * GLOOK-59: the sync is scheduled through the shared `schedules` table and scheduler manager
 * (`src/lib/schedule/manager.ts`), as one `kind = 'vuln_sync'` row managed in Settings → Schedules.
 * VULN_SYNC_CRON / VULN_SYNC_TZ only SEED that row on the first boot with the feature on; after
 * that the row is the source of truth, so a Settings edit survives restarts and deploys.
 */
export async function initVulnerabilityScheduler(): Promise<void> {
  if (g.__glooker_vuln_init) return;
  const org = getVulnerabilitiesOrg();
  if (!org) return;
  try {
    await db.execute(
      `UPDATE vulnerability_syncs SET status = 'failed', finished_at = ?, issues = ? WHERE status = 'running'`,
      [toIsoSecond(new Date()), JSON.stringify([{ kind: 'restart', message: 'interrupted by restart' }])],
    );
    const row = await ensureVulnScheduleRow(org);
    const { registerSchedule } = await import('../schedule/manager');
    registerSchedule(row);
    g.__glooker_vuln_init = true;
    console.log(`[vuln-sync] schedule ${row.cron_expr} (${row.timezone})${row.enabled ? '' : ' [paused]'} for ${org}`);
  } catch (err) {
    console.error('[vuln-sync] scheduler init failed:', err);
  }
}

async function ensureVulnScheduleRow(org: string): Promise<Schedule> {
  const [rows] = await db.execute<Schedule>(`SELECT * FROM schedules WHERE kind = 'vuln_sync' LIMIT 1`);
  if (rows[0]) return rows[0];
  const { cron, tz } = getSyncSchedule();
  const id = uuidv4();
  await db.execute(
    `INSERT INTO schedules (id, org, period_days, cron_expr, timezone, enabled, test_mode, kind)
     VALUES (?, ?, 0, ?, ?, 1, 0, 'vuln_sync')`,
    [id, org, cron, tz],
  );
  const [created] = await db.execute<Schedule>(`SELECT * FROM schedules WHERE id = ?`, [id]);
  return created[0];
}

export interface VulnSchedule { id: string; cron: string; tz: string; enabled: boolean; next_run: string | null }

/** The managed vuln_sync schedule row, or null before it has been seeded. */
export async function getVulnSchedule(): Promise<VulnSchedule | null> {
  const [rows] = await db.execute<Schedule>(`SELECT * FROM schedules WHERE kind = 'vuln_sync' LIMIT 1`);
  const r = rows[0];
  if (!r) return null;
  const enabled = Number(r.enabled) === 1;
  const { getNextRun } = await import('../schedule/manager');
  const next = enabled ? getNextRun(r.cron_expr, r.timezone) : null;
  return { id: r.id, cron: r.cron_expr, tz: r.timezone, enabled, next_run: next ? toIsoSecond(next) : null };
}
