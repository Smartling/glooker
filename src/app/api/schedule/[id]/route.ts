import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { registerSchedule, unregisterSchedule, type Schedule } from '@/lib/schedule-manager';
import { validateScheduleBody } from '@/lib/schedule-validation';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const error = validateScheduleBody(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const { org, periodDays, cronExpr, timezone, testMode, enabled } = body;

    const [existing] = await db.execute(`SELECT id FROM schedules WHERE id = ?`, [id]) as [any[], any];
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    }

    await db.execute(
      `UPDATE schedules SET org = ?, period_days = ?, cron_expr = ?, timezone = ?, enabled = ?, test_mode = ?
       WHERE id = ?`,
      [org, Number(periodDays), cronExpr, timezone, enabled ? 1 : 0, testMode ? 1 : 0, id],
    );

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
  } catch (err) {
    console.error('[api/schedule] PUT failed:', err);
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    unregisterSchedule(id);
    await db.execute(`DELETE FROM schedules WHERE id = ?`, [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/schedule] DELETE failed:', err);
    return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 });
  }
}
