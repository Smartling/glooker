import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { runReport } from '@/lib/report-runner';
import { initProgress } from '@/lib/progress-store';

export async function POST(req: NextRequest) {
  const { org, periodDays, testMode } = await req.json();

  if (!org || !periodDays) {
    return NextResponse.json({ error: 'org and periodDays are required' }, { status: 400 });
  }

  if (![3, 14, 30, 90].includes(Number(periodDays))) {
    return NextResponse.json({ error: 'periodDays must be 3, 14, 30, or 90' }, { status: 400 });
  }

  const id = uuidv4();

  await db.execute(
    `INSERT INTO reports (id, org, period_days, status) VALUES (?, ?, ?, 'pending')`,
    [id, org, periodDays],
  );

  initProgress(id);

  // Fire and forget — no await
  runReport(id, org, Number(periodDays), false, Boolean(testMode)).catch(console.error);

  return NextResponse.json({ reportId: id });
}

export async function GET() {
  const [rows] = await db.execute(
    `SELECT id, org, period_days, status, created_at, completed_at
     FROM reports
     ORDER BY created_at DESC
     LIMIT 20`,
  ) as [any[], any];
  return NextResponse.json(rows);
}
