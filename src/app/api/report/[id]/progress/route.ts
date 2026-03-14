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

  // Fallback: reconstruct progress from DB
  const [rows] = await db.execute(
    `SELECT status, error FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];

  if (!rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const report = rows[0] as { status: string; error: string | null };

  // If DB says running, count completed developers to show real progress
  if (report.status === 'running') {
    const [devRows] = await db.execute(
      `SELECT COUNT(*) as completed FROM developer_stats WHERE report_id = ?`,
      [id],
    ) as [any[], any];
    const completed = Number((devRows[0] as any)?.completed || 0);

    return NextResponse.json({
      status:              'running',
      step:                completed > 0 ? `Analyzing... (${completed} developers done from DB)` : 'Running...',
      totalRepos:          0,
      processedRepos:      0,
      totalDevelopers:     0,
      completedDevelopers: completed,
      logs:                [],
    });
  }

  return NextResponse.json({
    status:              report.status,
    step:                report.status,
    totalRepos:          0,
    processedRepos:      0,
    totalDevelopers:     0,
    completedDevelopers: 0,
    error:               report.error || undefined,
    logs:                [],
  });
}
