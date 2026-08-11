import db from '@/lib/db';
import { ReportNotFoundError } from './service';
import { dedupCommitsBySha, aggregateWeekly } from './timeline';
import { UNMERGED_LOOKBACK_DAYS } from './unmerged-window';

export class DeveloperNotFoundError extends Error {
  constructor(login: string) {
    super(`Developer not found: ${login}`);
    this.name = 'DeveloperNotFoundError';
  }
}

/**
 * Per-model usage as returned over the wire. `cost`/`requests` are typed
 * optional even though this function's DB read always produces numbers,
 * because the route strips both fields for viewers who may not see this
 * developer's cost (see `stripModelCost` in cost-visibility.ts). Typing them
 * as required here would contradict that contract and force a cast at the
 * route's reassignment; every consumer of this shape must handle their
 * absence regardless.
 */
export interface DevModelUsage {
  model: string;
  cost?: number;
  requests?: number;
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
            total_jira_issues, total_reviews,
            cc_total_cost, cc_requests, cc_skills_used,
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
            total_jira_issues, total_reviews
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
              complexity, type, ai_co_authored, maybe_ai, pr_number
       FROM commit_analyses
       WHERE github_login = ? AND report_id IN (${placeholders})
       ORDER BY committed_at ASC`,
      [login, ...reportIds],
    ) as [any[], any];

    timelineCommits = dedupCommitsBySha(tlRows);
  }

  const timeline = aggregateWeekly(timelineCommits);

  // Unmerged work: PR-level metadata and per-commit data live in two tables now.
  // Use the same lookback the runner uses (UNMERGED_LOOKBACK_DAYS) so we don't
  // silently drop PRs the runner just inserted. The shipped-work `period_days`
  // window doesn't apply to in-flight work — long-running drafts older than the
  // report period are the *most* actionable signal.
  const reportCreatedAt = new Date(reportRows[0].created_at);
  const unmergedSince = Number.isNaN(reportCreatedAt.getTime())
    ? new Date(0).toISOString()
    : new Date(reportCreatedAt.getTime() - UNMERGED_LOOKBACK_DAYS * 86400_000).toISOString();

  const [unmergedPrRows] = await db.execute(
    `SELECT pr_number, pr_title, pr_url, repo, is_draft,
            pr_commits, pr_additions, pr_deletions, pr_created_at, pr_updated_at
     FROM unmerged_prs
     WHERE report_id = ? AND github_login = ?
       AND pr_updated_at >= ?
     ORDER BY pr_updated_at DESC`,
    [reportId, login, unmergedSince],
  ) as [any[], any];

  const [unmergedCommitRows] = await db.execute(
    `SELECT commit_sha, repo, branch, pr_number, commit_message,
            lines_added, lines_removed, committed_at
     FROM unmerged_commits
     WHERE report_id = ? AND github_login = ? AND pr_number IS NULL
       AND committed_at >= ?
     ORDER BY committed_at DESC`,
    [reportId, login, unmergedSince],
  ) as [any[], any];

  const openPrs = unmergedPrRows.map((r: any) => ({
    repo:       r.repo,
    number:     r.pr_number,
    title:      r.pr_title,
    url:        r.pr_url,
    draft:      Boolean(r.is_draft),
    commits:    r.pr_commits,
    additions:  r.pr_additions,
    deletions:  r.pr_deletions,
    createdAt:  r.pr_created_at,
    updatedAt:  r.pr_updated_at,
  }));
  const branchCommits = unmergedCommitRows.map((r: any) => ({
    repo:        r.repo,
    sha:         r.commit_sha,
    message:     r.commit_message,
    branchName:  r.branch,
    additions:   r.lines_added,
    deletions:   r.lines_removed,
    committedAt: r.committed_at,
  }));

  const parseDev = (row: any) => ({
    ...row,
    type_breakdown: typeof row.type_breakdown === 'string' ? JSON.parse(row.type_breakdown || '{}') : (row.type_breakdown || {}),
    active_repos: typeof row.active_repos === 'string' ? JSON.parse(row.active_repos || '[]') : (row.active_repos || []),
  });

  const [skillsRows] = await db.execute(
    `SELECT product, skills_used, skills_distinct
     FROM cc_skills_usage WHERE report_id = ? AND github_login = ?
     ORDER BY skills_used DESC, product`,
    [reportId, login],
  ) as [any[], any];

  const [modelRows] = await db.execute(
    `SELECT model, cost, requests
     FROM cc_model_usage WHERE report_id = ? AND github_login = ?
     ORDER BY cost DESC, model`,
    [reportId, login],
  ) as [any[], any];

  return {
    report: reportRows[0],
    developer: parseDev(devRows[0]),
    allDevelopers: allDevRows,
    commits: commitRows,
    timeline,
    unmergedWork: { openPrs, branchCommits },
    skills: skillsRows.map((r: any) => ({
      product: String(r.product),
      skills_used: Number(r.skills_used) || 0,
      skills_distinct: Number(r.skills_distinct) || 0,
    })),
    models: modelRows.map((r: any): DevModelUsage => ({
      model: String(r.model),
      cost: Number(r.cost) || 0,
      requests: Number(r.requests) || 0,
    })),
  };
}
