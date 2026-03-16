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

  const org = reportRows[0].org;

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

  // Timeline: all commits for this developer across ALL reports for this org,
  // deduped by commit_sha, for weekly aggregation graphs
  const [allReportIds] = await db.execute(
    `SELECT id FROM reports WHERE org = ?`,
    [org],
  ) as [any[], any];
  const reportIds = allReportIds.map((r: any) => r.id);

  let timelineCommits: any[] = [];
  if (reportIds.length > 0) {
    // Query in batches to avoid parameter limits
    const placeholders = reportIds.map(() => '?').join(',');
    const [tlRows] = await db.execute(
      `SELECT commit_sha, committed_at, lines_added, lines_removed,
              complexity, type, ai_co_authored, maybe_ai
       FROM commit_analyses
       WHERE github_login = ? AND report_id IN (${placeholders})
       ORDER BY committed_at ASC`,
      [login, ...reportIds],
    ) as [any[], any];

    // Deduplicate by commit_sha (keep first occurrence)
    const seen = new Set<string>();
    for (const row of tlRows) {
      if (!seen.has(row.commit_sha)) {
        seen.add(row.commit_sha);
        timelineCommits.push(row);
      }
    }
  }

  // Aggregate into weekly buckets
  const weeklyMap = new Map<string, {
    week: string;
    commits: number;
    linesAdded: number;
    linesRemoved: number;
    totalComplexity: number;
    complexityCount: number;
    aiCount: number;
    types: Record<string, number>;
  }>();

  for (const c of timelineCommits) {
    if (!c.committed_at) continue;
    const d = new Date(c.committed_at);
    // ISO week start (Monday)
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const weekKey = monday.toISOString().split('T')[0];

    if (!weeklyMap.has(weekKey)) {
      weeklyMap.set(weekKey, {
        week: weekKey,
        commits: 0, linesAdded: 0, linesRemoved: 0,
        totalComplexity: 0, complexityCount: 0, aiCount: 0,
        types: {},
      });
    }
    const w = weeklyMap.get(weekKey)!;
    w.commits++;
    w.linesAdded += Number(c.lines_added) || 0;
    w.linesRemoved += Number(c.lines_removed) || 0;
    if (c.complexity != null) {
      w.totalComplexity += Number(c.complexity);
      w.complexityCount++;
    }
    if (c.ai_co_authored || c.maybe_ai) w.aiCount++;
    if (c.type) w.types[c.type] = (w.types[c.type] || 0) + 1;
  }

  const timeline = [...weeklyMap.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map(w => ({
      week: w.week,
      commits: w.commits,
      linesAdded: w.linesAdded,
      linesRemoved: w.linesRemoved,
      avgComplexity: w.complexityCount > 0 ? Math.round((w.totalComplexity / w.complexityCount) * 10) / 10 : 0,
      aiPercent: w.commits > 0 ? Math.round((w.aiCount / w.commits) * 100) : 0,
      types: w.types,
    }));

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
    timeline,
  });
}
