import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { registerSchedule, getNextRun, type Schedule } from '@/lib/schedule-manager';
import { validateScheduleBody } from '@/lib/schedule-validation';

export async function GET() {
  try {
    const [rows] = await db.execute(
      `SELECT s.*, r.status AS last_report_status
       FROM schedules s
       LEFT JOIN reports r ON s.last_report_id = r.id
       ORDER BY s.created_at DESC`,
    ) as [any[], any];

    const enriched = rows.map((row: any) => ({
      ...row,
      next_run_at: row.enabled ? getNextRun(row.cron_expr, row.timezone)?.toISOString() ?? null : null,
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    console.error('[api/schedule] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load schedules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const error = validateScheduleBody(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const { org, periodDays, cronExpr, timezone, testMode = false, enabled = true } = body;
    const id = uuidv4();

    await db.execute(
      `INSERT INTO schedules (id, org, period_days, cron_expr, timezone, enabled, test_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, org, Number(periodDays), cronExpr, timezone, enabled ? 1 : 0, testMode ? 1 : 0],
    );

    if (enabled) {
      const schedule: Schedule = {
        id, org, period_days: Number(periodDays), cron_expr: cronExpr,
        timezone, enabled: 1, test_mode: testMode ? 1 : 0,
        last_run_at: null, last_report_id: null, created_at: new Date().toISOString(),
      };
      registerSchedule(schedule);
    }

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('[api/schedule] POST failed:', err);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}
