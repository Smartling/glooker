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
  const [rows] = await db.execute<any[]>(
    `SELECT status, error FROM reports WHERE id = ?`,
    [id],
  );

  if (!rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const report = rows[0];

  // If DB says running, count analyzed commits to show real progress
  if (report.status === 'running') {
    const [countRows] = await db.execute<any[]>(
      `SELECT COUNT(*) as total, SUM(CASE WHEN complexity IS NOT NULL THEN 1 ELSE 0 END) as analyzed
       FROM commit_analyses WHERE report_id = ?`,
      [id],
    );
    const { total, analyzed } = countRows[0] || { total: 0, analyzed: 0 };

    return NextResponse.json({
      status:          'running',
      step:            total > 0 ? `Analyzing commits… (${analyzed}/${total} from DB)` : 'Running…',
      totalRepos:      0,
      processedRepos:  0,
      totalCommits:    Number(total),
      analyzedCommits: Number(analyzed),
      logs:            [],
    });
  }

  return NextResponse.json({
    status:          report.status,
    step:            report.status,
    totalRepos:      0,
    processedRepos:  0,
    totalCommits:    0,
    analyzedCommits: 0,
    error:           report.error || undefined,
    logs:            [],
  });
}
