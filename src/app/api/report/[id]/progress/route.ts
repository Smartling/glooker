import { NextRequest, NextResponse } from 'next/server';
import { getProgress } from '@/lib/progress-store';
import db from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const progress = getProgress(id);

  if (progress) {
    return NextResponse.json(progress);
  }

  // Fallback: reconstruct progress from DB (covers server restart mid-run)
  const [rows] = await db.execute<any[]>(
    `SELECT status, error FROM reports WHERE id = ?`,
    [id],
  );

  if (!rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const report = rows[0];
  return NextResponse.json({
    status:          report.status === 'running' ? 'failed' : report.status,
    step:            report.status === 'running' ? 'Lost progress (server restarted)' : report.status,
    totalRepos:      0,
    processedRepos:  0,
    totalCommits:    0,
    analyzedCommits: 0,
    error:           report.error || (report.status === 'running' ? 'Server restarted during run. Please try again.' : undefined),
  });
}
