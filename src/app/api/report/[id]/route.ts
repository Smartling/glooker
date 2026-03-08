import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [reportRows] = await db.execute<any[]>(
    `SELECT id, org, period_days, status, error, created_at, completed_at
     FROM reports WHERE id = ?`,
    [id],
  );

  if (!reportRows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [devRows] = await db.execute<any[]>(
    `SELECT github_login, github_name, avatar_url,
            total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage, type_breakdown, active_repos
     FROM developer_stats
     WHERE report_id = ?
     ORDER BY impact_score DESC`,
    [id],
  );

  return NextResponse.json({
    report:     reportRows[0],
    developers: devRows,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // ON DELETE CASCADE handles developer_stats and commit_analyses
  const [result] = await db.execute<any>(
    `DELETE FROM reports WHERE id = ?`,
    [id],
  );

  if (result.affectedRows === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
