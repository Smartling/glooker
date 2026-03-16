import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; login: string }> },
) {
  const { id, login } = await params;

  // Report metadata
  const [reportRows] = await db.execute(
    `SELECT id, org, period_days, status, created_at, completed_at
     FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];

  if (!reportRows.length) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  // This developer's stats
  const [devRows] = await db.execute(
    `SELECT github_login, github_name, avatar_url,
            total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage,
            type_breakdown, active_repos
     FROM developer_stats
     WHERE report_id = ? AND github_login = ?`,
    [id, login],
  ) as [any[], any];

  if (!devRows.length) {
    return NextResponse.json({ error: 'Developer not found in this report' }, { status: 404 });
  }

  // All developers' stats (for percentile computation)
  const [allDevRows] = await db.execute(
    `SELECT github_login, total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage
     FROM developer_stats
     WHERE report_id = ?
     ORDER BY impact_score DESC`,
    [id],
  ) as [any[], any];

  // This developer's commits (full detail)
  const [commitRows] = await db.execute(
    `SELECT commit_sha, repo, commit_message, pr_number, pr_title,
            type, complexity, risk_level, impact_summary,
            lines_added, lines_removed, committed_at,
            ai_co_authored, ai_tool_name, maybe_ai
     FROM commit_analyses
     WHERE report_id = ? AND github_login = ?
     ORDER BY committed_at DESC`,
    [id, login],
  ) as [any[], any];

  const parseDev = (row: any) => ({
    ...row,
    type_breakdown: typeof row.type_breakdown === 'string' ? JSON.parse(row.type_breakdown || '{}') : (row.type_breakdown || {}),
    active_repos: typeof row.active_repos === 'string' ? JSON.parse(row.active_repos || '[]') : (row.active_repos || []),
  });

  return NextResponse.json({
    report: reportRows[0],
    developer: parseDev(devRows[0]),
    allDevelopers: allDevRows,
    commits: commitRows,
  });
}
