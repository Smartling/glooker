import db from '../db/index';
import { ReportNotFoundError } from './service';
import { dedupCommitsBySha, aggregateWeekly } from './timeline';

export async function getOrgReport(reportId: string) {
  // 1. Report metadata
  const [reportRows] = await db.execute(
    `SELECT id, org, period_days, status, created_at, completed_at,
            cc_period_start, cc_period_end
     FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];
  if (!reportRows.length) throw new ReportNotFoundError(reportId);

  const org = reportRows[0].org;
  const ccStart: Date | string | null = reportRows[0].cc_period_start;
  const ccEnd: Date | string | null = reportRows[0].cc_period_end;

  // 2. Developer stats with JSON parsing
  const [devRows] = await db.execute(
    `SELECT github_login, github_name, avatar_url,
            total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage,
            total_jira_issues,
            type_breakdown, active_repos,
            cc_total_cost, cc_input_tokens, cc_output_tokens, cc_sessions
     FROM developer_stats WHERE report_id = ? ORDER BY impact_score DESC`,
    [reportId],
  ) as [any[], any];

  const developers = devRows.map((row: any) => ({
    ...row,
    type_breakdown: typeof row.type_breakdown === 'string' ? JSON.parse(row.type_breakdown || '{}') : (row.type_breakdown || {}),
    active_repos: typeof row.active_repos === 'string' ? JSON.parse(row.active_repos || '[]') : (row.active_repos || []),
  }));

  // 3. All commits across all reports for org, deduped
  const [allReportIds] = await db.execute(
    `SELECT id FROM reports WHERE org = ?`, [org],
  ) as [any[], any];
  const reportIds = allReportIds.map((r: any) => r.id);

  let timelineCommits: any[] = [];
  if (reportIds.length > 0) {
    const placeholders = reportIds.map(() => '?').join(',');
    const [tlRows] = await db.execute(
      `SELECT commit_sha, github_login, committed_at, lines_added, lines_removed,
              complexity, type, ai_co_authored, maybe_ai
       FROM commit_analyses WHERE report_id IN (${placeholders}) ORDER BY committed_at ASC`,
      [...reportIds],
    ) as [any[], any];
    timelineCommits = dedupCommitsBySha(tlRows);
  }

  // 4. Weekly aggregation with trackDevs
  const timeline = aggregateWeekly(timelineCommits, { trackDevs: true });

  // 4a. In-flight overlay: source from open-PR rows in unmerged_work.
  //     Each open PR contributes its `pr_commits` count and `pr_additions`/`pr_deletions`
  //     to the week of its `pr_updated_at`. Open-PR commits aren't in commit_analyses
  //     (GitHub commit search doesn't return branch-only commits), so this is the only
  //     way they show up in the org timeline.
  const [openPrRows] = await db.execute(
    `SELECT pr_commits, pr_additions, pr_deletions, pr_updated_at
     FROM unmerged_work
     WHERE report_id = ? AND kind = 'open_pr'`,
    [reportId],
  ) as [any[], any];

  if (openPrRows.length > 0) {
    const weekMap = new Map<string, any>();
    for (const w of timeline) weekMap.set(w.week, w);

    for (const pr of openPrRows) {
      if (!pr.pr_updated_at) continue;
      const d = new Date(pr.pr_updated_at);
      if (Number.isNaN(d.getTime())) continue;
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const weekKey = monday.toISOString().split('T')[0];

      let bucket = weekMap.get(weekKey);
      if (!bucket) {
        bucket = {
          week: weekKey,
          commits: 0,
          linesAdded: 0,
          linesRemoved: 0,
          linesP95Added: 0,
          linesP95Removed: 0,
          avgComplexity: 0,
          aiPercent: 0,
          types: {},
          inFlightLinesAdded: 0,
          inFlightLinesRemoved: 0,
          activeDevs: 0,
        };
        weekMap.set(weekKey, bucket);
        timeline.push(bucket);
      }

      const prCommits  = Number(pr.pr_commits  || 0);
      const prAdded    = Number(pr.pr_additions || 0);
      const prRemoved  = Number(pr.pr_deletions || 0);

      bucket.commits         += prCommits;
      bucket.linesAdded      += prAdded;
      bucket.linesRemoved    += prRemoved;
      bucket.linesP95Added   = (bucket.linesP95Added   || 0) + prAdded;
      bucket.linesP95Removed = (bucket.linesP95Removed || 0) + prRemoved;
      bucket.types           = { ...(bucket.types || {}) };
      bucket.types.in_flight = (bucket.types.in_flight || 0) + prCommits;
      bucket.inFlightLinesAdded   = (bucket.inFlightLinesAdded   || 0) + prAdded;
      bucket.inFlightLinesRemoved = (bucket.inFlightLinesRemoved || 0) + prRemoved;
    }

    // Re-sort by week key after potentially appending new buckets
    timeline.sort((a, b) => a.week.localeCompare(b.week));
  }

  // Unmerged-work summary KPI counts (single aggregation query).
  const [unmergedAggRows] = await db.execute(
    `SELECT
       SUM(CASE WHEN kind = 'open_pr' THEN 1 ELSE 0 END) AS openPrCount,
       COUNT(DISTINCT CASE WHEN kind = 'open_pr' THEN github_login END) AS openPrDevCount,
       SUM(CASE WHEN kind = 'bare_branch_commit' THEN 1 ELSE 0 END) AS bareBranchCount,
       COUNT(DISTINCT CASE WHEN kind = 'bare_branch_commit' THEN github_login END) AS bareBranchDevCount,
       COALESCE(SUM(CASE WHEN kind = 'open_pr' THEN pr_additions ELSE 0 END), 0) AS inFlightLinesAdded,
       COALESCE(SUM(CASE WHEN kind = 'open_pr' THEN pr_deletions ELSE 0 END), 0) AS inFlightLinesRemoved
     FROM unmerged_work
     WHERE report_id = ?`,
    [reportId],
  ) as [any[], any];

  const aggRow = unmergedAggRows[0] || {};
  const openPrCount = Number(aggRow.openPrCount || 0);
  const bareBranchCount = Number(aggRow.bareBranchCount || 0);
  const unmergedSummary = (openPrCount > 0 || bareBranchCount > 0)
    ? {
        openPrCount,
        openPrDevCount:       Number(aggRow.openPrDevCount || 0),
        bareBranchCount,
        bareBranchDevCount:   Number(aggRow.bareBranchDevCount || 0),
        inFlightLinesAdded:   Number(aggRow.inFlightLinesAdded || 0),
        inFlightLinesRemoved: Number(aggRow.inFlightLinesRemoved || 0),
      }
    : null;

  // 5. Spend-window per-developer stats (only when a period is set on the report)
  let spendWindow: {
    periodStart: string;
    periodEnd: string;
    firstCoveredDate: string | null;
    perDev: Record<string, { commits: number; prs: number; lines_added: number; lines_removed: number }>;
  } | null = null;

  const toIso = (v: Date | string): string =>
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

  if (ccStart && ccEnd && reportIds.length > 0) {
    const startStr = toIso(ccStart);
    const endStr = toIso(ccEnd);
    const placeholders = reportIds.map(() => '?').join(',');

    // Fetch commits in the spend window across all reports for the org, dedupe by sha
    const [winRows] = await db.execute(
      `SELECT commit_sha, github_login, pr_number, lines_added, lines_removed, committed_at
       FROM commit_analyses
       WHERE report_id IN (${placeholders})
         AND committed_at >= ?
         AND committed_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [...reportIds, startStr, endStr],
    ) as [any[], any];

    const seenSha = new Set<string>();
    const perDev = new Map<string, { commits: number; prSet: Set<number>; lines_added: number; lines_removed: number }>();
    for (const r of winRows) {
      if (seenSha.has(r.commit_sha)) continue;
      seenSha.add(r.commit_sha);
      const login = r.github_login;
      if (!perDev.has(login)) {
        perDev.set(login, { commits: 0, prSet: new Set(), lines_added: 0, lines_removed: 0 });
      }
      const dev = perDev.get(login)!;
      dev.commits++;
      dev.lines_added += Number(r.lines_added || 0);
      dev.lines_removed += Number(r.lines_removed || 0);
      if (r.pr_number != null) dev.prSet.add(Number(r.pr_number));
    }

    // Earliest commit date seen anywhere for the org (coverage check)
    const [coverRows] = await db.execute(
      `SELECT MIN(committed_at) AS first FROM commit_analyses WHERE report_id IN (${placeholders})`,
      [...reportIds],
    ) as [any[], any];
    const first = coverRows[0]?.first ? toIso(coverRows[0].first) : null;

    const perDevOut: Record<string, any> = {};
    for (const [login, v] of perDev.entries()) {
      perDevOut[login] = {
        commits: v.commits,
        prs: v.prSet.size,
        lines_added: v.lines_added,
        lines_removed: v.lines_removed,
      };
    }

    spendWindow = {
      periodStart: startStr,
      periodEnd: endStr,
      firstCoveredDate: first,
      perDev: perDevOut,
    };
  }

  return { report: reportRows[0], developers, timeline, spendWindow, unmergedSummary };
}
