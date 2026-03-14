import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { Cron } from 'croner';
import db from '@/lib/db';
import { registerSchedule, getNextRun, type Schedule } from '@/lib/schedule-manager';

function validateBody(body: any): string | null {
  const { org, periodDays, cronExpr, timezone } = body;
  if (!org || typeof org !== 'string') return 'org is required';
  if (![3, 14, 30, 90].includes(Number(periodDays))) return 'periodDays must be 3, 14, 30, or 90';
  if (!cronExpr || typeof cronExpr !== 'string') return 'cronExpr is required';
  if (!timezone || typeof timezone !== 'string') return 'timezone is required';

  // Validate cron expression
  try {
    const test = new Cron(cronExpr, { timezone });
    test.stop();
  } catch {
    return 'Invalid cron expression or timezone';
  }

  return null;
}

export async function GET() {
  const [rows] = await db.execute(
    `SELECT s.*, r.status AS last_report_status
     FROM schedules s
     LEFT JOIN reports r ON s.last_report_id = r.id
     ORDER BY s.created_at DESC`,
  ) as [any[], any];

  // Compute next run for each schedule
  const enriched = rows.map((row: any) => ({
    ...row,
    next_run_at: row.enabled ? getNextRun(row.cron_expr, row.timezone)?.toISOString() ?? null : null,
  }));

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const error = validateBody(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const { org, periodDays, cronExpr, timezone, testMode = false, enabled = true } = body;
  const id = uuidv4();

  await db.execute(
    `INSERT INTO schedules (id, org, period_days, cron_expr, timezone, enabled, test_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, org, Number(periodDays), cronExpr, timezone, enabled ? 1 : 0, testMode ? 1 : 0],
  );

  // Register the cron job if enabled
  if (enabled) {
    const schedule: Schedule = {
      id, org, period_days: Number(periodDays), cron_expr: cronExpr,
      timezone, enabled: 1, test_mode: testMode ? 1 : 0,
      last_run_at: null, last_report_id: null, created_at: new Date().toISOString(),
    };
    registerSchedule(schedule);
  }

  return NextResponse.json({ id }, { status: 201 });
}
