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

  return rows.map((row: any) => ({
    ...row,
    next_run_at: row.enabled ? getNextRun(row.cron_expr, row.timezone)?.toISOString() ?? null : null,
  }));
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

  const [existing] = await db.execute(`SELECT id FROM schedules WHERE id = ?`, [id]) as [any[], any];
  if (existing.length === 0) throw new ScheduleNotFoundError(id);

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
    last_run_at: null,
    last_report_id: null,
    created_at: new Date().toISOString(),
  };
}
