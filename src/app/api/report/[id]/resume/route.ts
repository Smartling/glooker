import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { runReport } from '@/lib/report-runner';
import { initProgress } from '@/lib/progress-store';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [rows] = await db.execute<any[]>(
    `SELECT id, org, period_days, status FROM reports WHERE id = ?`,
    [id],
  );

  if (!rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const report = rows[0];
  if (report.status === 'completed') {
    return NextResponse.json({ error: 'Report already completed' }, { status: 400 });
  }
  if (report.status === 'pending' || report.status === 'running') {
    // Check if it's actually running (has progress in memory)
    // If not, it's stale — allow resume
  }

  // Reset status
  await db.execute(
    `UPDATE reports SET status = 'running', error = NULL WHERE id = ?`,
    [id],
  );

  initProgress(id);

  // Fire and forget with resume flag
  runReport(id, report.org, report.period_days, true).catch(console.error);

  return NextResponse.json({ resumed: true, reportId: id });
}
