import db from '@/lib/db';
import { ReportNotFoundError } from './service';
import { dedupCommitsBySha, aggregateWeekly } from './timeline';

export class DeveloperNotFoundError extends Error {
  constructor(login: string) {
    super(`Developer not found: ${login}`);
    this.name = 'DeveloperNotFoundError';
  }
}

export async function getDevReport(reportId: string, login: string) {
  // Report metadata
  const [reportRows] = await db.execute(
    `SELECT id, org, period_days, status, created_at, completed_at
     FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];

  if (!reportRows.length) {
    throw new ReportNotFoundError(reportId);
  }

  const org = reportRows[0].org;

  // This developer's stats
  const [devRows] = await db.execute(
    `SELECT github_login, github_name, avatar_url,
            total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage,
            total_jira_issues,
            type_breakdown, active_repos
     FROM developer_stats
     WHERE report_id = ? AND github_login = ?`,
    [reportId, login],
  ) as [any[], any];

  if (!devRows.length) {
    throw new DeveloperNotFoundError(login);
  }

  // All developers' stats (for percentile computation)
  const [allDevRows] = await db.execute(
    `SELECT github_login, total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage,
            total_jira_issues
     FROM developer_stats
     WHERE report_id = ?
     ORDER BY impact_score DESC`,
    [reportId],
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
    [reportId, login],
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
    const placeholders = reportIds.map(() => '?').join(',');
    const [tlRows] = await db.execute(
      `SELECT commit_sha, committed_at, lines_added, lines_removed,
              complexity, type, ai_co_authored, maybe_ai
       FROM commit_analyses
       WHERE github_login = ? AND report_id IN (${placeholders})
       ORDER BY committed_at ASC`,
      [login, ...reportIds],
    ) as [any[], any];

    timelineCommits = dedupCommitsBySha(tlRows);
  }

  const timeline = aggregateWeekly(timelineCommits);

  const parseDev = (row: any) => ({
    ...row,
    type_breakdown: typeof row.type_breakdown === 'string' ? JSON.parse(row.type_breakdown || '{}') : (row.type_breakdown || {}),
    active_repos: typeof row.active_repos === 'string' ? JSON.parse(row.active_repos || '[]') : (row.active_repos || []),
  });

  return {
    report: reportRows[0],
    developer: parseDev(devRows[0]),
    allDevelopers: allDevRows,
    commits: commitRows,
    timeline,
  };
}
