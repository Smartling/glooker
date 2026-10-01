import { v4 as uuidv4 } from 'uuid';
import db from '../db/index';
import { registerSchedule, unregisterSchedule, getNextRun, type Schedule } from './manager';

// ── Types ──────────────────────────────────────────────────────────

export interface ScheduleInput {
  org: string;
  periodDays: number;
  cronExpr: string;
  timezone: string;
  testMode?: boolean;
  enabled?: boolean;
}

/** GLOOK-59: the Dependabot alerts sync schedule can be edited and paused, never deleted. */
export class ScheduleNotDeletableError extends Error {
  constructor(id: string) {
    super('The Dependabot alerts sync schedule cannot be deleted — pause it instead.');
    this.name = 'ScheduleNotDeletableError';
    void id;
  }
}

export class ScheduleNotFoundError extends Error {
  constructor(id: string) {
    super(`Schedule not found: ${id}`);
    this.name = 'ScheduleNotFoundError';
  }
}

// ── Service functions ──────────────────────────────────────────────

export async function listSchedules() {
  const [rows] = await db.execute(
    `SELECT s.*, r.status AS last_report_status
     FROM schedules s
     LEFT JOIN reports r ON s.last_report_id = r.id
     ORDER BY s.created_at DESC`,
  ) as [any[], any];

  const { isVulnerabilitiesEnabled, getVulnerabilitiesOrg } = await import('../vulnerabilities/config');
  const vulnOn = isVulnerabilitiesEnabled();
  // A vuln_sync row's last run is the latest Dependabot alerts sync, not a report.
  let lastSync: { status: string; started_at: string } | null = null;
  if (vulnOn && rows.some((r: any) => r.kind === 'vuln_sync')) {
    const [syncs] = await db.execute(
      `SELECT status, started_at FROM vulnerability_syncs WHERE org = ? ORDER BY id DESC LIMIT 1`,
      [getVulnerabilitiesOrg()],
    ) as [any[], any];
    lastSync = syncs[0] ?? null;
  }

  return rows
    .filter((row: any) => row.kind !== 'vuln_sync' || vulnOn)
    .map((row: any) => ({
      ...row,
      ...(row.kind === 'vuln_sync'
        ? { last_run_at: lastSync?.started_at ?? row.last_run_at ?? null, last_report_status: lastSync?.status ?? null }
        : {}),
      next_run_at: row.enabled ? getNextRun(row.cron_expr, row.timezone)?.toISOString() ?? null : null,
    }));
}

/** The stored kind of a schedule, or null when it doesn't exist. */
export async function getScheduleKind(id: string): Promise<'report' | 'vuln_sync' | null> {
  const [rows] = await db.execute(`SELECT kind FROM schedules WHERE id = ?`, [id]) as [any[], any];
  return rows[0] ? (rows[0].kind === 'vuln_sync' ? 'vuln_sync' : 'report') : null;
}

export async function createSchedule(input: ScheduleInput): Promise<string> {
  const { org, periodDays, cronExpr, timezone, testMode = false, enabled = true } = input;
  const id = uuidv4();

  await db.execute(
    `INSERT INTO schedules (id, org, period_days, cron_expr, timezone, enabled, test_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, org, Number(periodDays), cronExpr, timezone, enabled ? 1 : 0, testMode ? 1 : 0],
  );

  if (enabled) {
    registerSchedule(buildScheduleRow(id, input));
  }

  return id;
}

export async function updateSchedule(id: string, input: ScheduleInput): Promise<void> {
  const { org, periodDays, cronExpr, timezone, testMode = false, enabled = true } = input;

  const [existing] = await db.execute(`SELECT * FROM schedules WHERE id = ?`, [id]) as [any[], any];
  if (existing.length === 0) throw new ScheduleNotFoundError(id);

  if (existing[0].kind === 'vuln_sync') {
    // Only cadence, timezone and enabled are editable; org and period belong to the feature.
    await db.execute(
      `UPDATE schedules SET cron_expr = ?, timezone = ?, enabled = ? WHERE id = ?`,
      [cronExpr, timezone, enabled ? 1 : 0, id],
    );
    const row = { ...existing[0], cron_expr: cronExpr, timezone, enabled: enabled ? 1 : 0 };
    if (enabled) registerSchedule(row); else unregisterSchedule(id);
    return;
  }

  await db.execute(
    `UPDATE schedules SET org = ?, period_days = ?, cron_expr = ?, timezone = ?, enabled = ?, test_mode = ?
     WHERE id = ?`,
    [org, Number(periodDays), cronExpr, timezone, enabled ? 1 : 0, testMode ? 1 : 0, id],
  );

  if (enabled) {
    registerSchedule(buildScheduleRow(id, input));
  } else {
    unregisterSchedule(id);
  }
}

export async function deleteSchedule(id: string): Promise<void> {
  const [rows] = await db.execute(`SELECT kind FROM schedules WHERE id = ?`, [id]) as [any[], any];
  if (rows[0]?.kind === 'vuln_sync') throw new ScheduleNotDeletableError(id);
  unregisterSchedule(id);
  await db.execute(`DELETE FROM schedules WHERE id = ?`, [id]);
}

// ── Helpers ────────────────────────────────────────────────────────

function buildScheduleRow(id: string, input: ScheduleInput): Schedule {
  return {
    id,
    org: input.org,
    period_days: Number(input.periodDays),
    cron_expr: input.cronExpr,
    timezone: input.timezone,
    enabled: (input.enabled ?? true) ? 1 : 0,
    test_mode: (input.testMode ?? false) ? 1 : 0,
    kind: 'report',
    last_run_at: null,
    last_report_id: null,
    created_at: new Date().toISOString(),
  };
}
