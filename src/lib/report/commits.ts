import db from '../db/index';
import { getRangeCommits, loadReportRangeWindow, type ReportRange } from './range';

export async function getReportCommits(reportId: string, login: string, range: ReportRange = 'current') {
  if (range !== 'current') {
    const ctx = await loadReportRangeWindow(reportId, range);
    return ctx ? getRangeCommits(ctx.org, login, ctx.window) : [];
  }
  const [rows] = await db.execute(
    `SELECT commit_sha, repo, commit_message, type, complexity, risk_level,
            lines_added, lines_removed, committed_at
     FROM commit_analyses
     WHERE report_id = ? AND github_login = ?
     ORDER BY committed_at DESC`,
    [reportId, login],
  ) as [any[], any];
  return rows;
}
