import { Cron } from 'croner';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/index';
import { runReport } from '../report-runner';
import { initProgress } from '../progress-store';

// ── Types ──────────────────────────────────────────────────────────

export type ScheduleKind = 'report' | 'vuln_sync';

export interface Schedule {
  id:             string;
  org:            string;
  period_days:    number;
  cron_expr:      string;
  timezone:       string;
  enabled:        number;
  test_mode:      number;
  /** GLOOK-59: 'report' runs a GitHub report; 'vuln_sync' runs the Dependabot alerts sync. */
  kind:           ScheduleKind;
  last_run_at:    string | null;
  last_report_id: string | null;
  created_at:     string;
}

// ── GlobalThis store (survives HMR) ───────────────────────────────

const g = globalThis as typeof globalThis & {
  __glooker_schedules?: Map<string, Cron>;
  __glooker_scheduler_init?: boolean;
};
if (!g.__glooker_schedules) g.__glooker_schedules = new Map();
const jobs = g.__glooker_schedules;

// ── Public API ────────────────────────────────────────────────────

export async function initScheduler(): Promise<void> {
  if (g.__glooker_scheduler_init) return; // guard against double-init in dev

  console.log('[scheduler] Initializing…');

  try {
    // Recovery: mark orphaned "running" reports as "failed"
    await db.execute(
      `UPDATE reports SET status = 'failed', error = 'Server restarted during execution' WHERE status = 'running'`,
    );

    // Load all enabled schedules
    const [rows] = await db.execute<Schedule>(
      `SELECT * FROM schedules WHERE enabled = 1`,
    );

    // A vuln_sync row only runs while the feature is enabled; its own init seeds and
    // registers it (initVulnerabilityScheduler), so skip it here when the feature is off.
    const vulnOn = await vulnerabilitiesEnabled();
    for (const schedule of rows) {
      if (schedule.kind === 'vuln_sync' && !vulnOn) continue;
      try {
        registerSchedule(schedule);
      } catch (err) {
        console.error(`[scheduler] Failed to register schedule ${schedule.id}:`, err);
      }
    }

    g.__glooker_scheduler_init = true;
    console.log(`[scheduler] ${rows.length} schedule(s) registered`);
  } catch (err) {
    console.error('[scheduler] Initialization failed:', err);
  }
}

export function registerSchedule(schedule: Schedule): void {
  // Stop existing job if any
  unregisterSchedule(schedule.id);

  if (!schedule.enabled) return;

  const job = new Cron(schedule.cron_expr, { timezone: schedule.timezone }, async () => {
    await triggerSchedule(schedule);
  });

  jobs.set(schedule.id, job);
  console.log(`[scheduler] Registered: ${schedule.id} (${schedule.cron_expr} ${schedule.timezone})`);
}

export function unregisterSchedule(id: string): void {
  const existing = jobs.get(id);
  if (existing) {
    existing.stop();
    jobs.delete(id);
    console.log(`[scheduler] Unregistered: ${id}`);
  }
}

export function getNextRun(cronExpr: string, timezone: string): Date | null {
  try {
    const job = new Cron(cronExpr, { timezone });
    const next = job.nextRun();
    job.stop();
    return next;
  } catch (err) {
    console.error(`[scheduler] getNextRun failed for "${cronExpr}" (${timezone}):`, err);
    return null;
  }
}

// ── Trigger logic ─────────────────────────────────────────────────

async function vulnerabilitiesEnabled(): Promise<boolean> {
  const { isVulnerabilitiesEnabled } = await import('../vulnerabilities/config');
  return isVulnerabilitiesEnabled();
}

/** Exported for tests. Dispatches on the schedule's kind. */
export async function triggerSchedule(schedule: Schedule): Promise<void> {
  if (schedule.kind === 'vuln_sync') return triggerVulnSync(schedule);
  const { id, org, period_days, test_mode } = schedule;

  try {
    // Concurrency check: skip if a report is already running for this org
    const [running] = await db.execute<{ id: string }>(
      `SELECT id FROM reports WHERE org = ? AND status = 'running' LIMIT 1`,
      [org],
    );
    if (running.length > 0) {
      console.log(`[scheduler] Skipping ${id}: report ${running[0].id} already running for ${org}`);
      return;
    }

    // Create a new report
    const reportId = uuidv4();
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status, trigger_kind) VALUES (?, ?, ?, 'pending', 'schedule')`,
      [reportId, org, period_days],
    );
    initProgress(reportId);

    // Update schedule tracking
    await db.execute(
      `UPDATE schedules SET last_run_at = NOW(), last_report_id = ? WHERE id = ?`,
      [reportId, id],
    );

    console.log(`[scheduler] Triggered: schedule=${id}, report=${reportId}, org=${org}`);

    // Fire and forget — errors handled inside runReport, but wrap for safety
    runReport(reportId, org, period_days, false, Boolean(test_mode)).catch(async (err) => {
      console.error(`[scheduler] Report ${reportId} failed:`, err);
      try {
        await db.execute(
          `UPDATE reports SET status = 'failed', error = ? WHERE id = ?`,
          [err instanceof Error ? err.message : String(err), reportId],
        );
      } catch (dbErr) {
        console.error(`[scheduler] Failed to mark report ${reportId} as failed:`, dbErr);
      }
    });
  } catch (err) {
    console.error(`[scheduler] Trigger error for schedule ${id}:`, err);
  }
}

// The sync itself (single-flight, fetch-then-one-transaction write) is owned by the
// vulnerabilities module; the scheduler only decides when to call it.
async function triggerVulnSync(schedule: Schedule): Promise<void> {
  try {
    const { startSync } = await import('../vulnerabilities/scheduler');
    const r = await startSync('schedule', null);
    if (r.status === 'already-running') {
      console.log('[scheduler] Dependabot alerts sync skipped: a sync is already running');
      return;
    }
    if (r.status === 'disabled') return;
    await db.execute(`UPDATE schedules SET last_run_at = NOW() WHERE id = ?`, [schedule.id]);
    console.log(`[scheduler] Triggered: schedule=${schedule.id}, Dependabot alerts sync=${r.syncId}`);
  } catch (err) {
    console.error(`[scheduler] Dependabot alerts sync trigger failed for schedule ${schedule.id}:`, err);
  }
}
