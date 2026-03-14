import { NextRequest, NextResponse } from 'next/server';
import { Cron } from 'croner';
import db from '@/lib/db';
import { registerSchedule, unregisterSchedule, type Schedule } from '@/lib/schedule-manager';

function validateBody(body: any): string | null {
  const { org, periodDays, cronExpr, timezone } = body;
  if (!org || typeof org !== 'string') return 'org is required';
  if (![3, 14, 30, 90].includes(Number(periodDays))) return 'periodDays must be 3, 14, 30, or 90';
  if (!cronExpr || typeof cronExpr !== 'string') return 'cronExpr is required';
  if (!timezone || typeof timezone !== 'string') return 'timezone is required';

  try {
    const test = new Cron(cronExpr, { timezone });
    test.stop();
  } catch {
    return 'Invalid cron expression or timezone';
  }

  return null;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const error = validateBody(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const { org, periodDays, cronExpr, timezone, testMode, enabled } = body;

  // Verify schedule exists
  const [existing] = await db.execute(`SELECT id FROM schedules WHERE id = ?`, [id]) as [any[], any];
  if (existing.length === 0) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  await db.execute(
    `UPDATE schedules SET org = ?, period_days = ?, cron_expr = ?, timezone = ?, enabled = ?, test_mode = ?
     WHERE id = ?`,
    [org, Number(periodDays), cronExpr, timezone, enabled ? 1 : 0, testMode ? 1 : 0, id],
  );

  // Re-register (or unregister if disabled)
  const schedule: Schedule = {
    id, org, period_days: Number(periodDays), cron_expr: cronExpr,
    timezone, enabled: enabled ? 1 : 0, test_mode: testMode ? 1 : 0,
    last_run_at: null, last_report_id: null, created_at: '',
  };

  if (enabled) {
    registerSchedule(schedule);
  } else {
    unregisterSchedule(id);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  unregisterSchedule(id);
  await db.execute(`DELETE FROM schedules WHERE id = ?`, [id]);

  return NextResponse.json({ ok: true });
}
